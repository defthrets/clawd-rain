# clawd-rain

Matrix-rain terminal viewer for the [openclaw](https://github.com/openclaw/openclaw) agent (clawd). Auto-detects clawd's JSONL log on the homelab and renders the agent's activity as **decoded streams** falling through digital rain.

```
ｦﾐ█ﾜ4ｴﾙｵﾈﾅxｲﾝﾊｦA│q░▒K%ｾｱｴｵﾜﾞﾝ7Eｲｸﾚﾊﾇｮ
ﾐｶｱOﾉｦﾑｴﾐ&Hｿｮｲ█ﾐｴﾊ@ﾄｴｸﾞｦｬﾌﾆﾐﾑｦ7ｦﾈｸ
   T              [               L
   O              t               L
   O              o               M
   L              o
   :              l                p
   p              ]                =
   r                                 1
   e              p                  8
   s              r                  9
   e              e                  7
   n              s
   c              e
   e              n
[TOOL] [tool] presence_scanner.scan → 200 142ms
[CHAN] [whatsapp] ← inbound text
[LLM ] [model] inference claude-sonnet-4-6 p=1872 c=311
 ● connected · 27 ev/min · clawd · /tmp/openclaw/openclaw-2026-04-26.log     q quit · p pause
```

Decoded streams use **category colors** by openclaw subsystem:

| Kind | Color | Subsystems |
|---|---|---|
| `TOOL` | cyan | `tool/*` |
| `LLM` | yellow | `model`, `inference` |
| `HTTP` | green-cyan | gateway HTTP entries |
| `CHAN` | magenta | `whatsapp`, `telegram`, `slack`, etc. |
| `MEM` | violet | `memory` |
| `CRON` | orange | `cron`, `scheduler` |
| `GATE` | pale cyan | `gateway` |
| `SYS` | soft cyan | `agent`, `canvas`, `tailscale`, `auth` |
| `WARN` | amber | `level=warn` |
| `ERR` | red | `level=error` / `ok=false` / status≥400 |
| `INFO` | white | everything else |

## Install

```sh
git clone https://github.com/defthrets/clawd-rain.git ~/clawd-rain
cd ~/clawd-rain && npm install -g .
```

No runtime dependencies. Node 18+.

## Run it

Just:

```sh
clawd-rain
```

That's it. Auto-detect probes (in order):

1. `~/.openclaw/openclaw.json` → `logging.file` if you have a config override
2. **systemd unit** matching `openclaw-gateway`, `openclaw`, or `clawd` (system, then user)
3. `/tmp/openclaw/openclaw-YYYY-MM-DD.log` (the openclaw default — follows daily rotation automatically)
4. `journalctl -t openclaw` (syslog identifier fallback)
5. piped stdin

### Check what it would attach to

```sh
clawd-rain --explain
```

Prints the chosen source plus the full probe list, and exits.

### Force a specific source

```sh
clawd-rain --file /path/to/agent.log
clawd-rain --journal openclaw-gateway
some-cmd | clawd-rain
```

### Demo with a synthetic feed

```sh
npm run demo
```

Generates realistic openclaw-format JSONL events (tool calls, model inference, channel messages, errors) every ~220ms so you can see the rain in action without a real clawd running.

## Options

| Flag | Description | Default |
|---|---|---|
| `--file <path>` | tail an explicit log file | — |
| `--journal <unit>` | follow a systemd unit (system, then user) | — |
| `--source <type>` | force `stdin` \| `file` \| `journal` | auto-detect |
| `--title <name>` | name shown in status bar | `clawd` |
| `--frame-ms <n>` | frame interval (lower = smoother, more CPU) | `60` |
| `--explain` | print what auto-detect would pick, then exit | — |
| `-h`, `--help` | show help | — |

## Keys

| Key | Action |
|---|---|
| `q` / `Ctrl+C` | quit |
| `p` | pause / resume the rain |

When stdin is the log source, the terminal can't capture keystrokes — use `Ctrl+C` to quit. Other sources support all keys.

## Capture *everything* clawd does

clawd-rain only sees what clawd writes to the log. By default openclaw runs at `info` level, which means **Telegram message bodies, tool args/results, and most internal checks are hidden** (they live at `debug`).

To see every chat, every check, every action, edit `~/.openclaw/openclaw.json` on the homelab:

```json
{
  "logging": {
    "level": "debug"
  }
}
```

Then restart the gateway:

```sh
systemctl --user restart openclaw-gateway
# or whichever scope you installed under
```

For maximum verbosity (every internal step), use `"trace"`. Trace is loud — clawd-rain handles it fine, but the bottom log strip will scroll fast. Pause with `p` if you need to read.

If `logging.redactSensitive` is on, leave it on — clawd-rain doesn't fight redaction. Tokens and credentials still get masked.

## How it parses

Targets the openclaw JSONL schema directly: `time`, `level`, `subsystem`, `message`. Subsystem prefixes are mapped to colored kinds via [`src/parser.js`](src/parser.js). Falls back to a regex pass for plain-text lines like `[gateway] heartbeat ok` or `Exec presence_scanner.scan`. Emojis in messages (e.g. `🛠️ Exec:`) are stripped so the rain alignment stays clean.

If clawd writes a subsystem the parser doesn't know yet, it shows up as `INFO` — extend the `kindForSubsystem` switch in [`src/parser.js`](src/parser.js) to add new categories.

## File layout

```
clawd-rain/
├── bin/clawd-rain           # node shebang launcher
├── src/
│   ├── main.js              # arg parsing, autodetect wiring
│   ├── autodetect.js        # config / systemd / log-dir / journal probes
│   ├── ingest.js            # stdin / file / glob (rotation) / journalctl
│   ├── parser.js            # categorize JSONL + plain text
│   ├── rain.js              # rain engine (background + decoded streams)
│   ├── render.js            # frame loop, ANSI output, status bar
│   └── chars.js             # character pool + 24-bit color helpers
└── test/demo-feed.js        # synthetic openclaw-format feed
```

## Notes

- Layout is split 50/50: rain takes the top half of the terminal, the live log strip fills the bottom half (minus the 1-row status bar). Resize the terminal and the split adjusts.
- 24-bit truecolor ANSI. Modern Linux terminals support it; older terminals will show approximated colors.
- Uses the alternate screen buffer — quitting restores your original terminal contents.
- Designed to run on the homelab next to clawd. SSH into the box and run it in tmux/screen.
- File-tailing follows daily rotation: when `openclaw-2026-04-27.log` appears, clawd-rain switches to it without restart.
