# Claude Usage

GNOME Shell top-bar indicator for Claude Pro/Max usage. Shows the current
session percentage in the panel, plus a dropdown with every active limit
(session, weekly, per-model) and their reset times.

![screenshot](screenshot.png)

## How it gets the data

There is no public API for claude.ai/Claude Pro subscription usage. This
extension reads the OAuth session that the [Claude Code](https://claude.com/claude-code)
CLI already stores locally at `~/.claude/.credentials.json` and calls the
same usage endpoint the `claude` CLI itself uses. You need to have run
`claude` at least once and be logged in for data to show up.

No credentials are entered into this extension directly, and nothing is sent
anywhere except a GET request to `api.anthropic.com` using your existing
local session token.

## Features

- Session usage percentage in the top bar
- Dropdown with session / weekly / per-model limits and reset countdowns
- Fully customizable panel icon (pick any local image file)
- Configurable refresh interval
- Optional credentials file path override

## Settings

Open via the gear icon in the dropdown, or:

```
gnome-extensions prefs claude-usage@michilapsiodev
```

## Supported GNOME Shell versions

Tested on GNOME Shell 3.36. Written against the legacy
`imports.misc.extensionUtils` extension API, which is compatible with
GNOME Shell 3.34 through 44 (GNOME 45 switched to ES modules and dropped
this API).

## License

MIT — see [LICENSE](LICENSE).
