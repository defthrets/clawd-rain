'use strict';

const { parseArgs } = require('node:util');
const { Rain } = require('./rain');
const { Renderer, rainHeightFor } = require('./render');
const { fromOptions, fromDetected } = require('./ingest');
const { categorize } = require('./parser');
const autodetect = require('./autodetect');

const HELP = `
clawd-rain — Matrix-rain terminal viewer for the openclaw agent

Usage:
  clawd-rain                              auto-detect clawd's log source
  clawd-rain --file /path/to/agent.log    tail an explicit file
  clawd-rain --journal openclaw-gateway   follow a systemd unit
  some-cmd | clawd-rain                   read JSONL from stdin

Auto-detection probes (in order):
  1. ~/.openclaw/openclaw.json -> logging.file (config override)
  2. systemd unit /openclaw-gateway|openclaw|clawd/  (system, then user)
  3. /tmp/openclaw/openclaw-YYYY-MM-DD.log  (default openclaw log dir, follows rotation)
  4. journalctl -t openclaw  (syslog identifier)
  5. stdin (if piped)

Options:
  --file <path>     tail an explicit log file (overrides auto-detect)
  --journal <unit>  follow a systemd unit (overrides auto-detect)
  --source <type>   stdin | file | journal  (force a specific source)
  --title <name>    name shown in status bar (default: clawd)
  --frame-ms <n>    frame interval in ms (default: 60)
  --explain         print what auto-detect would pick, then exit
  -h, --help        show this help
`;

function parse() {
  const { values } = parseArgs({
    options: {
      source:     { type: 'string' },
      file:       { type: 'string' },
      journal:    { type: 'string' },
      title:      { type: 'string' },
      'frame-ms': { type: 'string' },
      explain:    { type: 'boolean' },
      help:       { type: 'boolean', short: 'h' },
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
    if (opts.explain) {
      if (detected) {
        process.stdout.write(`clawd-rain would use: ${detected.label}\n`);
      } else {
        process.stdout.write('clawd-rain found nothing to attach to.\n');
      }
      process.stdout.write('\n' + autodetect.describeSearched() + '\n');
      process.exit(detected ? 0 : 1);
    }
    if (!detected) {
      process.stderr.write('clawd-rain: could not find clawd to follow.\n\n');
      process.stderr.write(autodetect.describeSearched() + '\n');
      process.exit(1);
    }
    ingest = fromDetected(detected);
    sourceLabel = detected.label;
  }

  if (opts.explain) {
    process.stdout.write(`clawd-rain would use: ${sourceLabel}\n`);
    process.exit(0);
  }

  if (!process.stdout.isTTY) {
    process.stderr.write('clawd-rain: stdout is not a TTY — refusing to render\n');
    process.exit(1);
  }

  const w = process.stdout.columns || 80;
  const h = process.stdout.rows || 24;
  const rain = new Rain(w, rainHeightFor(h));
  const renderer = new Renderer(rain, {
    title: opts.title,
    source: sourceLabel,
    frameMs: opts.frameMs,
  });

  ingest.on('line', (line) => {
    const evt = categorize(line);
    if (!evt) return;
    renderer.pushEvent(evt);
    rain.injectDecoded(`${evt.label} ${evt.text}`, evt.kind);
  });
  ingest.on('status', (c) => renderer.setConnected(c));

  setupInput(renderer, ingest);
  renderer.start();
  ingest.start();
}

function setupInput(renderer, ingest) {
  const shutdown = (code) => {
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
