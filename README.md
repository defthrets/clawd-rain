# openclaw-rain

Matrix-rain terminal viewer for the openclaw agent. Watches the agent's log/event stream and renders activity as **decoded streams** (real log lines) falling through digital rain, so you can confirm the agent is working — in hacker-aesthetic style.

```
ｦﾐ█ﾜ4ｴﾙｵﾈﾅxｲﾝﾊｦA│q░▒K%ｾｱｴｵﾜﾞﾝ7Eｲｸﾚﾊﾇｮ
ﾐｶｱOﾉｦﾑｴﾐ&Hｿｮｲ█ﾐｴﾊ@ﾄｴｸﾞｦｬﾌﾆﾐﾑｦ7ｦﾈｸ
   T            S                       L
   O            C                       L
   O            A                       M
   L            N                       
   :            (                       p
   p            )                       =
   r                                    1
   e                                    8
   s                                    9
   e                                    7
   n                                    
   c
   e
[TOOL] presence_scanner.scan() → 200 142ms
[HTTP] GET /healthz → 200 4ms
[LLM ] inference claude-sonnet-4-6 p=1872 c=311
 ● connected · 27 ev/min · clawd                       q quit · p pause
```

(Rain is green by default; decoded streams use category colors — cyan for tool, yellow for LLM, red for error, etc.)

## Install

```sh
git clone https://github.com/<your-github>/openclaw-rain.git
cd openclaw-rain
npm install -g .
```

No runtime dependencies — Node 18+ only.

## Usage

It accepts log lines on stdin, from a file, or directly from a systemd unit. Every line is categorized (`tool`, `http`, `llm`, `error`, `warn`, `info`) and injected into the rain as a falling decoded stream.

### Pipe anything into it

```sh
journalctl -u clawd -f --output=cat | openclaw-rain
tail -F /var/log/clawd/agent.log | openclaw-rain
```

### Tail a file directly

```sh
openclaw-rain --file /var/log/clawd/agent.log
```

Survives log rotation by reopening the file when the inode changes.

### Follow a systemd unit directly

```sh
openclaw-rain --journal clawd
```

Spawns `journalctl -u clawd --output=cat -f` internally and respawns it if it dies.

### Demo with a synthetic feed

```sh
node test/demo-feed.js | node bin/openclaw-rain
# or
npm run demo
```

This emits realistic-looking JSON events (tool calls, HTTP, LLM inference, errors) every ~220ms so you can see how the rain looks.

## Options

| Flag | Description | Default |
|---|---|---|
| `--source <type>` | `stdin` \| `file` \| `journal` | inferred |
| `--file <path>` | log file to tail | — |
| `--journal <unit>` | systemd unit to follow | — |
| `--title <name>` | name shown in status bar | `clawd` |
| `--frame-ms <n>` | frame interval (lower = smoother, more CPU) | `60` |
| `-h`, `--help` | show help | — |

## Keys

| Key | Action |
|---|---|
| `q` / `Ctrl+C` | quit |
| `p` | pause / resume the rain |

Note: when stdin is being used as the log source (i.e. data is piped in), the terminal can't capture keystrokes — use `Ctrl+C` to quit. In `--file` and `--journal` modes, the keys above work normally.

## How it categorizes lines

The parser handles **JSON log lines** and **plain text**:

- **JSON**: looks at `level`, `status`, `tool`, `method`, `url`, `model`, `prompt_tokens`, `error`, `msg` etc. Any line starting with `{` is tried as JSON first.
- **Plain text**: regex sniffs for `[ERROR]`, `[WARN]`, `tool: ...`, `GET /path`, `tokens`, `prompt`, `completion`, etc.

Anything unmatched is shown as `[INFO]` in the dim white channel — still visible, just not colored as a specific category.

If you want a different categorization, edit [`src/parser.js`](src/parser.js) — it's intentionally a single small file.

## File layout

```
openclaw-rain/
├── bin/openclaw-rain        # node shebang launcher
├── src/
│   ├── main.js              # entry: arg parsing, wiring
│   ├── ingest.js            # stdin / file-tail / journalctl readers
│   ├── parser.js            # categorize log lines → {kind, label, text}
│   ├── rain.js              # rain engine (background columns + decoded streams)
│   ├── render.js            # frame loop, ANSI output, status bar
│   └── chars.js             # character pool + 24-bit color helpers
└── test/demo-feed.js        # synthetic feed for visual testing
```

## Notes

- Renders with **24-bit truecolor ANSI**. Most modern Linux terminals support this; older ones will show approximated colors.
- Uses the **alternate screen buffer**, so quitting restores your original terminal contents.
- Designed to live next to `clawd` on the homelab. Run it in its own SSH session/tmux pane.
