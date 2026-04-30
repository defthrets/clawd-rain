# clawd-rain

Hacker-rain terminal viewer **and chat client** for the [openclaw](https://github.com/openclaw/openclaw) agent (clawd). Watches every live source at once and renders them as falling text:

- **Every shell command** clawd spawns (live from `/proc/<pid>/task/*/children`)
- **Every TCP connection** clawd or its children open (live from `ss -tnp`)
- **Every log entry** from openclaw's JSONL (tools, LLM inference, channel messages)
- **Your own messages**, sent via the built-in chat input — replies stream back through the log

No random characters — every falling glyph is a real piece of telemetry.

```
[                T                                            i
T                E                  [                          n
O                L                  C                          f
O                E                  H                          e
L                G                  A                          r
]                R                  N                          e
                 A                  ]                          n
[                M                                             c
t                ]                  [                          e
o                                   t
o                [                  e                          c
l                t                  l                          l
]                e                  e                          a
                 l                  g                          u
p                e                  r                          d
[TOOL] [tool] presence_scanner.scan → 200 142ms args={"zone":"home"}
[CHAN] [telegram] ← from:alice "hey clawd whats the weather"
[LLM ] [model] inference claude-sonnet-4-6 p=1872 c=311
[ERR ] [gateway] connection refused 127.0.0.1:7777
 ● connected · 47 ev/min · clawd · /tmp/openclaw/openclaw-2026-04-26.log     q quit · p pause
```

Each falling column is a complete log entry, rendered top-down with a brighter leader at the bottom. Streams use **category colors** by openclaw subsystem:

| Kind | Color | Subsystems |
|---|---|---|
| `SHEL` | lime | every shell command clawd spawns (live from `/proc`) |
| `NET` | blue | every TCP connection clawd opens (live from `ss`) |
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

That's it. clawd-rain runs **three sources at once**, all merged into the same falling rain:

**Log source** — auto-detected:
1. `~/.openclaw/openclaw.json` → `logging.file` if you have a config override
2. **systemd unit** matching `openclaw-gateway`, `openclaw`, or `clawd` (system, then user)
3. `/tmp/openclaw/openclaw-YYYY-MM-DD.log` (the openclaw default — follows daily rotation automatically)
4. `journalctl -t openclaw` (syslog identifier fallback)
5. piped stdin

**Process watch** — every shell command clawd spawns. Auto-detected via:
1. `pgrep -f openclaw-gateway` / `openclaw` / `clawd`
2. `systemctl show openclaw-gateway -p MainPID`

Walks `/proc/<pid>/task/*/children` recursively every 750ms and emits a `SHEL` stream for every new descendant process: `[shell] [12345] $ curl -sS https://api.anthropic.com/v1/messages`.

**Network watch** — every TCP connection clawd or its children open. Runs `ss -tnpH` every 750ms, filters by clawd's PID and descendants, diffs against the last snapshot, and emits a `NET` stream for every new socket: `[net] 10.0.0.5:54012 → 104.18.27.92:443 (ESTAB)`. Closed sockets show as `(CLOSED)`.

Requires `pgrep`, `ps`, and `ss` (standard procps-ng + iproute2 — present on every Linux distro). On macOS or non-Linux, proc/net watching is silently skipped and clawd-rain falls back to log-only.

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
| `--watch-pid <pid>` | watch this PID for spawned procs + TCP conns | auto-detect |
| `--no-watch` | disable proc/net watching even if a PID is found | — |
| `--watch-ms <n>` | proc/net poll interval in ms | `750` |
| `--chat-agent <id>` | enable chat input via `openclaw agent --agent <id>` | — |
| `--chat-cmd <cmd>` | enable chat input via custom command (text appended as last argv) | — |
| `--chat-timeout <s>` | kill any in-flight send after this many seconds (`0` = no timeout) | `0` |
| `--title <name>` | name shown in status bar | `clawd` |
| `--frame-ms <n>` | frame interval (lower = smoother, more CPU) | `60` |
| `--explain` | print what auto-detect would pick, then exit | — |
| `-h`, `--help` | show help | — |

## Chat with clawd

clawd-rain has a built-in chat input bar at the bottom of the screen. Press `/` (or `c`) to focus it, type a message, press `Enter` to send. The default sender shells out to:

```sh
openclaw agent --agent <id> --deliver --message "<your text>"
```

Pass `--chat-agent <id>` to enable it. List yours first to get the right format:

```sh
openclaw agent list                        # find the actual IDs registered
clawd-rain --chat-agent <one-of-those-ids>
```

**Sends are fire-and-forget.** clawd-rain spawns the subprocess but doesn't block the input on it — your message echoes into the rain immediately, and the subprocess runs in the background. Real agent work (LLM inference + channel delivery) routinely takes 30–90 seconds and that's fine; the agent's reply appears as a `[CHAN]` stream when it's ready, because clawd-rain is tailing the openclaw log.

If openclaw writes anything to stderr (e.g. `EMBEDDED FALLBACK: Gateway agent failed; running embedded agent: Error: Unknown agent id "..."`), it streams in real time as red `[ERR ]` falling streams plus a banner in the chat row.

By default there is no kill-timeout — if you want one, pass `--chat-timeout 120` (or whatever) and any send still running after that many seconds will be SIGTERM'd. `Esc` (when the chat input isn't focused) cancels every in-flight send immediately.

When you send, you see your message echoed in the rain as a `[CHAT] [me] → "..."` stream. The agent's reply flows back through the openclaw log — clawd-rain is already tailing it, so the response shows up automatically as a `[CHAN]` stream a moment later. One terminal, full conversation loop.

For full control over the transport, use `--chat-cmd` instead — clawd-rain shell-splits the value, then appends your message text as the final argv. Handy for hitting the gateway HTTP API directly:

```sh
clawd-rain --chat-cmd 'curl -sS -H "Authorization: Bearer $TOKEN" \
  -X POST http://localhost:18789/v1/chat/completions -d'
```

Chat keys (only when input is focused):

| Key | Action |
|---|---|
| `/` or `c` | focus the chat input |
| `Enter` | send the message |
| `Esc` | cancel and unfocus |
| `↑` / `↓` | browse recent messages |
| `←` / `→` | move cursor in buffer |
| `Backspace` | delete previous char |
| `Ctrl+A` / `Ctrl+E` | jump to start / end |
| `Ctrl+U` | clear text before cursor |

## Keys

| Key | Action |
|---|---|
| `q` / `Ctrl+C` | quit |
| `p` | pause / resume the rain |
| `/` or `c` | focus chat input (when chat is enabled) |

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

## How the rain works

Every column is a real log line. When clawd writes one, clawd-rain spawns a falling stream at a random x position; the text scrolls top-down (first char at the top, last char at the leader) at a randomised speed. Multiple streams running simultaneously at different speeds give the matrix-rain density.

The volume of falling text scales with how chatty clawd is. With `info` logging it's a sparse drizzle. With `debug` (Telegram bodies, tool args, internal checks) it's proper rain. With `trace` it's a downpour — turn it on if you want to see literally every step the agent takes.

If clawd is genuinely idle, the screen goes quiet. That's honest — clawd-rain doesn't fake activity with random characters.

### Caveats on proc/net polling

The proc/net watcher is **polling-based at 750ms** (configurable). Implications:

- **Short-lived commands may be missed.** A shell command that runs and exits in under 750ms (`true`, `pwd`, etc.) won't appear. Drop the interval (`--watch-ms 250`) for finer resolution at the cost of CPU.
- **For lossless capture**, layer in `auditd` or eBPF and pipe it into clawd-rain via stdin. Quick recipes:

  ```sh
  # auditd: catch every execve from clawd's user
  sudo auditctl -a always,exit -F arch=b64 -S execve -F auid=$(id -u clawd) -k clawd_exec
  sudo ausearch -k clawd_exec --format text -i | clawd-rain   # already-recorded
  # for live tail you'd post-process /var/log/audit/audit.log

  # bpftrace (kernel-level, real-time, every execve and connect):
  sudo bpftrace -e 'tracepoint:syscalls:sys_enter_execve { printf("{\"subsystem\":\"shell\",\"pid\":%d,\"cmd\":\"%s\"}\n", pid, str(args->filename)); }' \
    | clawd-rain --no-watch --source stdin
  ```

  These give you every syscall, not just snapshots. Polling is just the zero-config default.

## How it parses

Targets the openclaw JSONL schema directly: `time`, `level`, `subsystem`, `message`. Subsystem prefixes are mapped to colored kinds via [`src/parser.js`](src/parser.js). Falls back to a regex pass for plain-text lines like `[gateway] heartbeat ok` or `Exec presence_scanner.scan`. Emojis in messages (e.g. `🛠️ Exec:`) are stripped so the rain alignment stays clean.

If clawd writes a subsystem the parser doesn't know yet, it shows up as `INFO` — extend the `kindForSubsystem` switch in [`src/parser.js`](src/parser.js) to add new categories.

## File layout

```
clawd-rain/
├── bin/clawd-rain           # node shebang launcher
├── src/
│   ├── main.js              # arg parsing, autodetect wiring, multi-source merge
│   ├── autodetect.js        # config / systemd / log-dir / journal probes
│   ├── ingest.js            # stdin / file / glob (rotation) / journalctl
│   ├── proc-watch.js        # /proc child-tree + ss TCP conn polling
│   ├── chat.js              # ChatInput state machine (focus, buffer, history)
│   ├── parser.js            # categorize JSONL + plain text
│   ├── rain.js              # falling-stream engine (real text, no garbage)
│   ├── render.js            # frame loop, ANSI output, status bar
│   └── chars.js             # 24-bit color helpers + per-kind palette
└── test/demo-feed.js        # synthetic feed covering all 10 kinds
```

## Notes

- Layout is split 50/50: rain takes the top half of the terminal, the live log strip fills the bottom half (minus the 1-row status bar). Resize the terminal and the split adjusts.
- 24-bit truecolor ANSI. Modern Linux terminals support it; older terminals will show approximated colors.
- Uses the alternate screen buffer — quitting restores your original terminal contents.
- Designed to run on the homelab next to clawd. SSH into the box and run it in tmux/screen.
- File-tailing follows daily rotation: when `openclaw-2026-04-27.log` appears, clawd-rain switches to it without restart.
