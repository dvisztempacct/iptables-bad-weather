# iptables-bad-weather
Randomly manipulate your firewall to simulate unreliable networks/hosts.

## Work in Progress
**Warning** The interface is not stable! Configuration and invocation may change!

This tool is very new and some of the command line options are not implemented
yet.

## Goals
1. Support rich control over the randomness.
2. Support repeatability.
2. Support both real-valued packet delivery rate as well as boolean-valued
   packet delivery rate.

There is one currently supported PRNG and that is simplex noise. This has a few
advantages as PRNG for simulating unreliable networks/hosts.  As compared to
the more common white noise PRNGs, availability is somewhat inertial, and can
be correlated between multiple networks/hosts/ports in useful ways.

## Example Usage
Randomly turn local `mariadb` or `mysql` server and `memcached` on and off.

```bash
node ./index -c example-config.json -o /dev/null -i 500
```

Most of the behavior of `iptables-bad-weather` is described in a configuration
file, the path to which must be specified on the command line with the `-c`
option. Below is the example configuration file.

## Example Configuration File
Notice 
```json
{
  "storms": [
    {
      "name": "mariadb",
      "type": "simplex",
      "iptables": [
        "INPUT --destination-port 3306 --destination 127.0.0.1",
        "INPUT --source-port 3306 --source 127.0.0.1"
      ],
      "simplex_time_coef": 0.001,
      "simplex_threshold": 0.05,
      "simplex_y": 0
    },
    {
      "name": "memcached",
      "type": "simplex",
      "iptables": [
        "INPUT --destination-port 11211 --destination 127.0.0.1",
        "INPUT --source-port 11211 --source 127.0.0.1"
      ],
      "simplex_time_coef": 0.001,
      "simplex_threshold": 0.1,
      "simplex_y": 0
    }
  ]
}
```

## Invocation
The following options are not yet implemented:

1. `-g`
2. `-d`
3. `-s`

```
$ node ./index --help
Usage: index [options]

Options:
  -V, --version            output the version number
  -c, --config [filename]  Specify configuration file
  -o, --output [filename]  Specify ndjson log file (defaults to stdout)
  -v, --verbose            Extra output on stderr
  -g, --graphics           Output ascii art visualization of effect
  -d, --dry-run            Finish immediately; do not manipulate iptables
  -i, --interval [ms]      How often to wake up and manipulate iptables
  -r, --root               Use sudo(1)
  -s, --seed [seed]        Specify PRNG seed
  --debug                  Get debugging output
  -h, --help               output usage information
```
