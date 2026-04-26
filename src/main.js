'use strict';

const { parseArgs } = require('node:util');
const { Rain } = require('./rain');
const { Renderer, STATUS_ROWS } = require('./render');
const { fromOptions } = require('./ingest');
const { categorize } = require('./parser');

const HELP = `
openclaw-rain — Matrix-rain viewer for the openclaw agent

Usage:
  openclaw-rain [options]
  some-command | openclaw-rain
  openclaw-rain --file /var/log/clawd.log
  openclaw-rain --journal clawd

Options:
  --source <type>   stdin | file | journal   (default: stdin if piped, else stdin)
  --file <path>     log file to tail (sets --source file)
  --journal <unit>  systemd unit to follow (sets --source journal)
  --title <name>    override the agent name shown in the status bar
  --frame-ms <n>    frame interval in milliseconds (default: 60)
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
    else source = 'stdin';
  }
  if (source === 'file' && !values.file) {
    fail('--source file requires --file <path>');
  }
  if (source === 'journal' && !values.journal) {
    fail('--source journal requires --journal <unit>');
  }

  return {
    source,
    file: values.file,
    journal: values.journal,
    title: values.title || 'clawd',
    frameMs: values['frame-ms'] ? Math.max(20, Number(values['frame-ms'])) : 60,
  };
}

function fail(msg) {
  process.stderr.write(`openclaw-rain: ${msg}\n${HELP}`);
  process.exit(2);
}

function main() {
  let opts;
  try { opts = parse(); } catch (e) { fail(e.message); }

  if (!process.stdout.isTTY) {
    process.stderr.write('openclaw-rain: stdout is not a TTY — refusing to render\n');
    process.exit(1);
  }

  const w = process.stdout.columns || 80;
  const h = process.stdout.rows || 24;
  const rain = new Rain(w, Math.max(4, h - STATUS_ROWS));
  const renderer = new Renderer(rain, { title: opts.title, frameMs: opts.frameMs });

  const ingest = fromOptions(opts);
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
      if (key === '' || key === 'q' || key === 'Q') shutdown(0);
      else if (key === 'p' || key === 'P') renderer.togglePause();
    });
  }
}

main();
