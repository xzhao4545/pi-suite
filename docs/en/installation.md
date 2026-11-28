# Installation

[Documentation index](index.md)

## Requirements

- Node.js 24 or later.
- Official, unmodified Pi **1.6.1** or later. The suite is developed and tested against 1.6.1 and follows Pi releases.

## Install from npm

```sh
pi install npm:pi-suite
pi list
```

Pi installs the latest published version and its runtime dependencies under the Pi npm directory, loads `src/index.ts` through `pi.extensions`, and discovers the bundled skills and theme. The source is written to your user-level Pi `settings.json`. Add `-l` to write it to the project-level settings instead; project resources follow Pi's trust rules.

Update later with:

```sh
pi update npm:pi-suite
```

A source pinned to a version, such as `npm:pi-suite@0.3.0`, is not updated; install the new version to move to it.

After installing or updating, run `/reload` in an open session or restart Pi. All modules are enabled by default and no configuration file is needed.

Pi's `/reload` reloads extensions only. After upgrading Pi or the suite's dependencies, quit Pi and start it again; use `--resume` to continue the same session.
