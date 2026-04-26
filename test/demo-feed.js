#!/usr/bin/env node
'use strict';

const TOOLS = ['presence_scanner', 'timekeeper', 'weather', 'calendar', 'memory'];
const ACTIONS = { presence_scanner: ['scan', 'list', 'identify'], timekeeper: ['now', 'sunset', 'tz'], weather: ['current', 'forecast'], calendar: ['next', 'today'], memory: ['recall', 'store'] };
const PATHS = ['/healthz', '/api/agents', '/api/messages', '/v1/chat/completions', '/internal/queue'];
const METHODS = ['GET', 'POST', 'PUT'];
const MODELS = ['claude-haiku-4-5', 'claude-sonnet-4-6', 'claude-opus-4-7'];
const ERRORS = [
  'connection refused: 127.0.0.1:7777',
  'rate limit exceeded',
  'timeout after 30000ms',
  'unauthorized: missing token',
  'parse error: unexpected token',
];
const INFO = [
  'agent loop tick',
  'planner: 3 tools available',
  'queue depth 0',
  'heartbeat ok',
  'context window 12% used',
];

function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }
function randInt(min, max) { return Math.floor(min + Math.random() * (max - min + 1)); }

function emit() {
  const r = Math.random();
  let line;

  if (r < 0.30) {
    const tool = pick(TOOLS);
    const action = pick(ACTIONS[tool]);
    line = JSON.stringify({
      level: 'info',
      tool, action,
      status: Math.random() < 0.92 ? 200 : pick([404, 500, 502]),
      duration_ms: randInt(8, 480),
    });
  } else if (r < 0.50) {
    const method = pick(METHODS);
    const path = pick(PATHS);
    const status = Math.random() < 0.9 ? 200 : pick([301, 404, 500]);
    line = JSON.stringify({
      level: 'info',
      method, url: path, status,
      duration_ms: randInt(2, 320),
    });
  } else if (r < 0.65) {
    line = JSON.stringify({
      level: 'info',
      msg: 'inference',
      model: pick(MODELS),
      prompt_tokens: randInt(120, 4200),
      completion_tokens: randInt(20, 600),
    });
  } else if (r < 0.72) {
    line = JSON.stringify({ level: 'error', error: pick(ERRORS) });
  } else if (r < 0.78) {
    line = JSON.stringify({ level: 'warn', msg: pick(['retry 1/3', 'slow response 1.2s', 'cache miss']) });
  } else {
    line = `[INFO] ${pick(INFO)}`;
  }

  process.stdout.write(line + '\n');
}

const interval = Number(process.argv[2]) || 220;
setInterval(emit, interval);
process.stdin.resume();
