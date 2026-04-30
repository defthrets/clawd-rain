'use strict';

const { parseArgs } = require('node:util');
const { Rain } = require('./rain');
const { Renderer, rainHeightFor } = require('./render');
const { fromOptions, fromDetected } = require('./ingest');
const { categorize } = require('./parser');
const autodetect = require('./autodetect');
const { ProcWatch, findClawdPid, ssAvailable } = require('./proc-watch');

const HELP = `
clawd-rain — Hacker-rain terminal viewer for the openclaw agent

Watches three streams at once and renders them as falling rain:
  • clawd's JSONL log (tool calls, LLM inference, channel messages)
  • shell commands clawd spawns (every child process)
  • TCP connections clawd opens (every outgoing socket)

Usage:
  clawd-rain                              auto-detect everything
  clawd-rain --file /path/to/agent.log    explicit log file
  clawd-rain --journal openclaw-gateway   follow a systemd unit
  clawd-rain --watch-pid 1234             watch a specific PID's procs/sockets
  clawd-rain --no-watch                   log only, skip proc/net watching
  some-cmd | clawd-rain                   read JSONL from stdin

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
  --file <path>      tail an explicit log file (overrides auto-detect)
  --journal <unit>   follow a systemd unit (overrides auto-detect)
  --source <type>    stdin | file | journal  (force a specific source)
  --watch-pid <pid>  watch this PID for spawned processes + TCP conns
  --no-watch         disable proc/net watching even if a PID is found
  --watch-ms <n>     proc/net poll interval in ms (default: 750)
  --title <name>     name shown in status bar (default: clawd)
  --frame-ms <n>     frame interval in ms (default: 60)
  --explain          print what auto-detect would pick, then exit
  -h, --help         show this help
`;

function parse() {
  const { values } = parseArgs({
    options: {
      source:      { type: 'string' },
      file:        { type: 'string' },
      journal:     { type: 'string' },
      title:       { type: 'string' },
      'frame-ms':  { type: 'string' },
      'watch-pid': { type: 'string' },
      'watch-ms':  { type: 'string' },
      'no-watch':  { type: 'boolean' },
      explain:     { type: 'boolean' },
      help:        { type: 'boolean', short: 'h' },
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
    explain: !!values.explain,
  };
}

function fail(msg) {
  process.stderr.write(`clawd-rain: ${msg}\n${HELP}`);
  process.exit(2);
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

  if (opts.explain) {
    process.stdout.write(`Log source:    ${sourceLabel}\n`);
    if (opts.noWatch) {
      process.stdout.write('Proc/net watch: disabled (--no-watch)\n');
    } else if (!watchPid) {
      process.stdout.write('Proc/net watch: not enabled (no clawd PID found)\n');
    } else {
      process.stdout.write(`Proc/net watch: pid ${watchPid}${ssAvailable() ? ' (ss available)' : ' (ss missing — net disabled)'}\n`);
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

  const renderer = new Renderer(rain, {
    title: opts.title,
    source: displaySource,
    frameMs: opts.frameMs,
  });

  const handleLine = (line) => {
    const evt = categorize(line);
    if (!evt) return;
    renderer.pushEvent(evt);
    rain.injectDecoded(`${evt.label} ${evt.text}`, evt.kind);
  };

  ingest.on('line', handleLine);
  ingest.on('status', (c) => renderer.setConnected(c));

  let procWatch = null;
  if (!opts.noWatch && watchPid) {
    procWatch = new ProcWatch({ pid: watchPid, intervalMs: opts.watchMs });
    procWatch.on('line', handleLine);
  }

  setupInput(renderer, ingest, procWatch);
  renderer.start();
  ingest.start();
  if (procWatch) procWatch.start();
}

function setupInput(renderer, ingest, procWatch) {
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
      if (key === '' || key === 'q' || key === 'Q') shutdown(0);
      else if (key === 'p' || key === 'P') renderer.togglePause();
    });
  }
}

main();
