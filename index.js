const R = require('ramda')
const Bluebird = require('bluebird')
const simplex = new (require('simplex-noise'))
const fs = require('fs')
const child_process = require('child_process')
const util = require('util')
const program = require('commander')

program
  .version('1.0.0')
  .option('-c, --config [filename]', 'Specify configuration file')
  .option('-o, --output [filename]', 'Specify ndjson log file (defaults to stdout)')
  .option('-v, --verbose', 'Extra output on stderr')
  .option('-g, --graphics', 'Output ascii art visualization of effect')
  .option('-d, --dry-run', 'Finish immediately; do not manipulate iptables')
  .option('-i, --interval [ms]', 'How often to wake up and manipulate iptables')
  .option('-r, --root', 'Use sudo(1)')
  .option('-s, --seed [seed]', 'Specify PRNG seed')
  .option('--debug', 'Get debugging output')
  .parse(process.argv)

if (program.args.length) {
  console.error('invalid arguments:', program.args.join(' '))
  process.exit(1)
}

if (!program.config) {
  console.error('error: please specify configuration file')
  process.exit(1)
}

const getConfig = filename => {
  try {
    const config = JSON.parse(fs.readFileSync(filename, 'utf8'))
    return config
  } catch (err) {
    console.error('error reading configuration file', filename)
    console.error(err)
    process.exit(1)
  }
}

const config = getConfig(program.config)

const outputStream = program.output ? fs.createWriteStream(program.output) : process.stdout

const verbose = program.verbose ?
  function() { console.error.apply(console, arguments) } :
  Function.prototype

const debug = program.debug ?
  function() { console.error.apply(console, arguments) } :
  Function.prototype

const wakeupIntervalTime = program.interval

const sudo = program.root ? 'sudo' : ''

const execRawP = util.promisify(child_process.exec)

const exec = async cmd => {
  verbose('executing command: ', cmd)
  const { stdout, stderr } = await execRawP(cmd)
  verbose('command output for:', cmd)
  verbose('stdout:', stdout)
  verbose('stderr:', stderr)
}

/* initialize storm state */
const stormState = R.map(
  () => ({
    /* Initial packet delivery rate. `undefined` here indicates we should not
     * attempt to delete a corresponding rule. */
    rate: undefined,
  }),
  config.storms,
)

const clamp = (low, x, high) =>
  Math.max(Math.min(x, high), low)

const getStormPacketDeliveryRate = (t, storm) => {
  switch (storm.type) {
    case 'simplex':
      /* clamp just in case */
      const rate = clamp(
        0,
        simplex.noise2D(
          t * storm.simplex_time_coef,
          storm.simplex_y,
        ) / 2 + 0.5,
        1,
      )
      /* if threshold specified, return only 0 or 1 */
      if (storm.simplex_threshold !== undefined) {
        return rate < storm.simplex_threshold ? 1 : 0
      }
      /* otherwise return the normalized simplex result */
      return rate
    default:
      throw new Error(`unknown storm type "${storm.type}"`)
  }
}

/* wakingUp indicates if the last wake up completed */
let wakingUp = false
let issuedSlowWarning = false
const wakeUp = () => {
  if (wakingUp) {
    if (!issuedSlowWarning) {
      console.warn()
      console.warn("the previous interval's calculation did not complete before the current interval's calculations needed to start")
      console.warn("possible causes:")
      console.warn(" - your chosen interval is too short")
      console.warn(" - system load too high")
      console.warn(" - something causing iptables(1) to take a long time")
      console.warn(" - sudo(1) waiting for user input")
      console.warn()
      console.warn("this warning will not be issued a second time")
      console.warn()
      issuedSlowWarning = true
    }

    /* yield execution and let previous wakeUp complete */
    verbose("verbose: wake up taking too long for interval")
    return
  }

  verbose("woke up")
  wakingUp = true

  const t = Date.now()

  const commands = []

  config.storms.forEach(
    (storm, iStorm) => {
      debug("examining state %d %o", iStorm, storm)
      const state = stormState[iStorm]
      /* Calculate packet delivery rate for each storm */
      const rate = getStormPacketDeliveryRate(t, storm)
      /* If it doesn't match, queue iptables commands to update it */
      if (rate !== state.rate) {
        storm.iptables.forEach(
          iptables => {
            debug("examining iptables %o", iptables)
            /* Queue command to remove previous iptables rule */
            if (state.rate !== undefined) {
              commands.push(
                `${sudo} iptables -p tcp -D ${iptables} -m statistic --mode random --probability ${state.rate} -j DROP`
              )
            }
            /* Add new iptables rule */
            commands.push(
              `${sudo} iptables -p tcp -A ${iptables} -m statistic --mode random --probability ${rate} -j DROP`
            )
            /* Write to ndjson log */
            outputStream.write(
              JSON.stringify({
                name: storm.name,
                rate,
                rateDelta: state.rate - rate,
                '@timestamp': t,
              }) + '\n'
            )
          }
        )
      }
      /* Update state */
      state.rate = rate
    }
  )

  verbose("queued %d commands this interval", commands.length)

  if (program.debug) {
    commands.forEach(
      command => debug(command)
    )
  }

  /* Issue iptables commands */
  Bluebird.map(
    commands,
    command => exec(command),
    { concurrency: 1 },
  )
  .then(() => {
    verbose('command queue drained; sleeping')
    wakingUp = false
  })
  .catch(err => {
    console.error('fatal error:', err)
    process.exit(1)
  })
}

setInterval(wakeUp, Number(program.interval))
verbose("starting...")
