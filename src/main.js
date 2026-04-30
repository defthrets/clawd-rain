'use strict';

const { parseArgs } = require('node:util');
const { spawn } = require('child_process');
const { Rain } = require('./rain');
const { Renderer, rainHeightFor } = require('./render');
const { fromOptions, fromDetected } = require('./ingest');
const { categorize } = require('./parser');
const autodetect = require('./autodetect');
const { ProcWatch, findClawdPid, ssAvailable } = require('./proc-watch');
const { ChatInput } = require('./chat');

const HELP = `
clawd-rain — Hacker-rain terminal viewer for the openclaw agent

Watches multiple streams at once and renders them as falling rain:
  • clawd's JSONL log (tool calls, LLM inference, channel messages)
  • shell commands clawd spawns (every child process)
  • TCP connections clawd opens (every outgoing socket)
  • your replies typed into the built-in chat input

Usage:
  clawd-rain                              auto-detect everything
  clawd-rain --chat-agent agent:main:main enable chat with a specific agent
  clawd-rain --file /path/to/agent.log    explicit log file
  clawd-rain --journal openclaw-gateway   follow a systemd unit
  clawd-rain --watch-pid 1234             watch a specific PID's procs/sockets
  clawd-rain --no-watch                   log only, skip proc/net watching
  some-cmd | clawd-rain                   read JSONL from stdin

Chat:
  Press / or c to focus the input bar at the bottom. Type, then Enter
  to send. Esc cancels. Up/down browses recent messages.
  Default sender:  openclaw agent --agent <chat-agent> --deliver --message "<text>"
  Override entirely with --chat-cmd to use the gateway HTTP/WS API or
  any other transport.

Auto-detection probes (in order):
  Log:
    1. ~/.openclaw/openclaw.json -> logging.file (config override)
    2. systemd unit /openclaw-gateway|openclaw|clawd/  (system, then user)
    3. /tmp/openclaw/openclaw-YYYY-MM-DD.log  (default openclaw log dir)
    4. journalctl -t openclaw  (syslog identifier)
    5. stdin (if piped)
  Process/network:
    1. pgrep -f openclaw-gateway / openclaw / clawd
    2. systemctl MainPID for openclaw-gateway

Options:
  --file <path>       tail an explicit log file (overrides auto-detect)
  --journal <unit>    follow a systemd unit (overrides auto-detect)
  --source <type>     stdin | file | journal  (force a specific source)
  --watch-pid <pid>   watch this PID for spawned processes + TCP conns
  --no-watch          disable proc/net watching even if a PID is found
  --watch-ms <n>      proc/net poll interval in ms (default: 750)
  --chat-agent <id>   enable chat input via 'openclaw agent --agent <id>'
  --chat-cmd <cmd>    enable chat input via custom command; the message
                      text is appended as the final argv. Use shell-style
                      quoting for args, e.g. 'curl -X POST http://...'
  --title <name>      name shown in status bar (default: clawd)
  --frame-ms <n>      frame interval in ms (default: 60)
  --explain           print what auto-detect would pick, then exit
  -h, --help          show this help
`;

function parse() {
  const { values } = parseArgs({
    options: {
      source:       { type: 'string' },
      file:         { type: 'string' },
      journal:      { type: 'string' },
      title:        { type: 'string' },
      'frame-ms':   { type: 'string' },
      'watch-pid':  { type: 'string' },
      'watch-ms':   { type: 'string' },
      'no-watch':   { type: 'boolean' },
      'chat-agent': { type: 'string' },
      'chat-cmd':   { type: 'string' },
      explain:      { type: 'boolean' },
      help:         { type: 'boolean', short: 'h' },
    },
    allowPositionals: false,
    strict: true,
  });

  if (values.help) {
    process.stdout.write(HELP);
    process.exit(0);
  }

  let source = values.source;
  if (!source) {
    if (values.file) source = 'file';
    else if (values.journal) source = 'journal';
  }
  if (source === 'file' && !values.file) fail('--source file requires --file <path>');
  if (source === 'journal' && !values.journal) fail('--source journal requires --journal <unit>');

  return {
    source,
    file: values.file,
    journal: values.journal,
    title: values.title || 'clawd',
    frameMs: values['frame-ms'] ? Math.max(20, Number(values['frame-ms'])) : 60,
    watchPid: values['watch-pid'] ? parseInt(values['watch-pid'], 10) : null,
    watchMs: values['watch-ms'] ? Math.max(200, Number(values['watch-ms'])) : 750,
    noWatch: !!values['no-watch'],
    chatAgent: values['chat-agent'] || '',
    chatCmd: values['chat-cmd'] || '',
    explain: !!values.explain,
  };
}

function fail(msg) {
  process.stderr.write(`clawd-rain: ${msg}\n${HELP}`);
  process.exit(2);
}

function shellSplit(s) {
  const out = [];
  let cur = '';
  let i = 0;
  let quote = null;
  while (i < s.length) {
    const c = s[i];
    if (quote) {
      if (c === quote) { quote = null; i++; continue; }
      if (c === '\\' && quote === '"' && i + 1 < s.length) {
        cur += s[i + 1]; i += 2; continue;
      }
      cur += c; i++; continue;
    }
    if (c === '"' || c === "'") { quote = c; i++; continue; }
    if (c === ' ' || c === '\t') {
      if (cur) { out.push(cur); cur = ''; }
      i++; continue;
    }
    if (c === '\\' && i + 1 < s.length) { cur += s[i + 1]; i += 2; continue; }
    cur += c; i++;
  }
  if (cur) out.push(cur);
  return out;
}

function buildSendCommand(opts, text) {
  if (opts.chatCmd) {
    const parts = shellSplit(opts.chatCmd);
    if (!parts.length) return null;
    return { cmd: parts[0], args: [...parts.slice(1), text] };
  }
  if (opts.chatAgent) {
    return {
      cmd: 'openclaw',
      args: ['agent', '--agent', opts.chatAgent, '--deliver', '--message', text],
    };
  }
  return null;
}

function main() {
  let opts;
  try { opts = parse(); } catch (e) { fail(e.message); }

  let ingest = null;
  let sourceLabel = '';

  if (opts.source) {
    ingest = fromOptions(opts);
    if (opts.source === 'file') sourceLabel = opts.file;
    else if (opts.source === 'journal') sourceLabel = `journalctl -u ${opts.journal}`;
    else if (opts.source === 'stdin') sourceLabel = 'stdin';
  } else {
    const detected = autodetect.detect();
    if (!detected) {
      if (opts.explain) {
        process.stdout.write('clawd-rain found no log source.\n\n' + autodetect.describeSearched() + '\n');
        process.exit(1);
      }
      process.stderr.write('clawd-rain: could not find clawd to follow.\n\n');
      process.stderr.write(autodetect.describeSearched() + '\n');
      process.exit(1);
    }
    ingest = fromDetected(detected);
    sourceLabel = detected.label;
  }

  let watchPid = opts.watchPid;
  if (!opts.noWatch && !watchPid) watchPid = findClawdPid();

  const chatEnabled = !!(opts.chatAgent || opts.chatCmd);

  if (opts.explain) {
    process.stdout.write(`Log source:     ${sourceLabel}\n`);
    if (opts.noWatch) {
      process.stdout.write('Proc/net watch: disabled (--no-watch)\n');
    } else if (!watchPid) {
      process.stdout.write('Proc/net watch: not enabled (no clawd PID found)\n');
    } else {
      process.stdout.write(`Proc/net watch: pid ${watchPid}${ssAvailable() ? ' (ss available)' : ' (ss missing — net disabled)'}\n`);
    }
    if (chatEnabled) {
      const c = buildSendCommand(opts, '<your message>');
      process.stdout.write(`Chat sender:    ${c ? c.cmd + ' ' + c.args.map(quoteIfNeeded).join(' ') : '(none)'}\n`);
    } else {
      process.stdout.write('Chat sender:    disabled (no --chat-agent or --chat-cmd)\n');
    }
    process.stdout.write('\n' + autodetect.describeSearched() + '\n');
    process.exit(0);
  }

  if (!process.stdout.isTTY) {
    process.stderr.write('clawd-rain: stdout is not a TTY — refusing to render\n');
    process.exit(1);
  }

  const w = process.stdout.columns || 80;
  const h = process.stdout.rows || 24;
  const rain = new Rain(w, rainHeightFor(h));

  let displaySource = sourceLabel;
  if (watchPid) displaySource += ` + proc:${watchPid}`;

  const chat = new ChatInput();

  const renderer = new Renderer(rain, {
    title: opts.title,
    source: displaySource,
    frameMs: opts.frameMs,
    chat,
    chatEnabled,
  });

  const handleLine = (line) => {
    const evt = categorize(line);
    if (!evt) return;
    renderer.pushEvent(evt);
    rain.injectDecoded(`${evt.label} ${evt.text}`, evt.kind);
  };

  const echoSent = (text) => {
    const evt = { kind: 'channel', label: 'CHAT', text: `[me] → "${text}"`, subsystem: 'me' };
    renderer.pushEvent(evt);
    rain.injectDecoded(`${evt.label} ${evt.text}`, evt.kind);
  };

  const echoError = (msg) => {
    const evt = { kind: 'error', label: 'ERR ', text: `[chat] ${msg}`, subsystem: 'chat' };
    renderer.pushEvent(evt);
    rain.injectDecoded(`${evt.label} ${evt.text}`, evt.kind);
  };

  const sendChat = (text) => {
    const cmd = buildSendCommand(opts, text);
    if (!cmd) {
      chat.setError('no --chat-agent or --chat-cmd configured');
      return;
    }
    chat.setBusy(true);
    chat.setError('');
    let stdoutBuf = '';
    let stderrBuf = '';
    try {
      const proc = spawn(cmd.cmd, cmd.args, { stdio: ['ignore', 'pipe', 'pipe'] });
      proc.stdout.on('data', (d) => { stdoutBuf += d.toString(); });
      proc.stderr.on('data', (d) => { stderrBuf += d.toString(); });
      proc.on('close', (code) => {
        chat.setBusy(false);
        if (code === 0) {
          chat.setSent(text);
          echoSent(text);
        } else {
          const reason = (stderrBuf || stdoutBuf || `exit ${code}`).trim().split('\n')[0].slice(0, 200);
          chat.setError(reason);
          echoError(`send failed: ${reason}`);
        }
      });
      proc.on('error', (err) => {
        chat.setBusy(false);
        chat.setError(err.message);
        echoError(`spawn ${cmd.cmd}: ${err.message}`);
      });
    } catch (err) {
      chat.setBusy(false);
      chat.setError(err.message);
      echoError(`spawn ${cmd.cmd}: ${err.message}`);
    }
  };

  ingest.on('line', handleLine);
  ingest.on('status', (c) => renderer.setConnected(c));

  let procWatch = null;
  if (!opts.noWatch && watchPid) {
    procWatch = new ProcWatch({ pid: watchPid, intervalMs: opts.watchMs });
    procWatch.on('line', handleLine);
  }

  setupInput(renderer, chat, sendChat, ingest, procWatch);
  renderer.start();
  ingest.start();
  if (procWatch) procWatch.start();
}

function quoteIfNeeded(s) {
  if (!/[\s"'`$]/.test(s)) return s;
  return `"${s.replace(/"/g, '\\"')}"`;
}

function setupInput(renderer, chat, sendChat, ingest, procWatch) {
  const shutdown = (code) => {
    try { if (procWatch) procWatch.stop(); } catch (_) {}
    try { ingest.stop(); } catch (_) {}
    try { renderer.stop(); } catch (_) {}
    process.exit(code || 0);
  };

  process.on('SIGINT', () => shutdown(130));
  process.on('SIGTERM', () => shutdown(143));

  if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (key) => {
      const handled = chat.handleKey(key);
      if (handled) {
        if (handled.kind === 'quit') return shutdown(0);
        if (handled.kind === 'submit') {
          sendChat(handled.text);
          return;
        }
        return;
      }
      if (key === 'q' || key === 'Q') shutdown(0);
      else if (key === 'p' || key === 'P') renderer.togglePause();
    });
  }
}

main();
