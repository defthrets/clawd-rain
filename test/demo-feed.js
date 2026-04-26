#!/usr/bin/env node
'use strict';

const TOOLS = ['presence_scanner', 'timekeeper', 'weather', 'calendar', 'memory'];
const ACTIONS = {
  presence_scanner: ['scan', 'list', 'identify'],
  timekeeper: ['now', 'sunset', 'tz'],
  weather: ['current', 'forecast'],
  calendar: ['next', 'today'],
  memory: ['recall', 'store'],
};
const PATHS = ['/healthz', '/api/agents', '/api/messages', '/v1/chat/completions', '/internal/queue'];
const METHODS = ['GET', 'POST', 'PUT'];
const MODELS = ['claude-haiku-4-5', 'claude-sonnet-4-6', 'claude-opus-4-7'];
const CHANNELS = ['whatsapp', 'telegram', 'slack', 'discord', 'signal'];
const ERRORS = [
  'connection refused: 127.0.0.1:7777',
  'rate limit exceeded',
  'timeout after 30000ms',
  'unauthorized: missing token',
  'parse error: unexpected token',
];
const GATEWAY_MSGS = [
  'agent loop tick',
  'planner: 3 tools available',
  'queue depth 0',
  'heartbeat ok',
  'context window 12% used',
];
const MEM_MSGS = ['indexed 1 markdown', 'recall hit', 'compaction skipped', 'embedding refresh'];
const CRON_MSGS = ['fired daily-summary', 'reminder check', 'health probe'];
const CHANNEL_MSGS = ['inbound text', 'delivered', 'typing indicator', 'reaction received', 'media uploaded'];

function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }
function randInt(min, max) { return Math.floor(min + Math.random() * (max - min + 1)); }
function nowISO() { return new Date().toISOString(); }

function emit() {
  const r = Math.random();
  let evt;

  if (r < 0.20) {
    const tool = pick(TOOLS);
    const action = pick(ACTIONS[tool]);
    evt = {
      time: nowISO(), level: 'info', subsystem: 'tool',
      tool, action,
      status: Math.random() < 0.92 ? 200 : pick([404, 500, 502]),
      duration_ms: randInt(8, 480),
      message: `Exec ${tool}.${action}`,
    };
  } else if (r < 0.32) {
    const method = pick(METHODS);
    const path = pick(PATHS);
    const status = Math.random() < 0.9 ? 200 : pick([301, 404, 500]);
    evt = {
      time: nowISO(), level: 'info', subsystem: 'gateway',
      method, url: path, status, duration_ms: randInt(2, 320),
      message: `${method} ${path}`,
    };
  } else if (r < 0.45) {
    evt = {
      time: nowISO(), level: 'info', subsystem: 'model',
      model: pick(MODELS),
      prompt_tokens: randInt(120, 4200),
      completion_tokens: randInt(20, 600),
      message: 'inference',
    };
  } else if (r < 0.58) {
    const ch = pick(CHANNELS);
    const dir = Math.random() < 0.5 ? 'inbound' : 'outbound';
    evt = {
      time: nowISO(), level: 'info',
      subsystem: `${ch}/${dir}`,
      direction: dir === 'inbound' ? 'in' : 'out',
      message: pick(CHANNEL_MSGS),
    };
  } else if (r < 0.66) {
    evt = {
      time: nowISO(), level: 'info', subsystem: 'memory',
      message: pick(MEM_MSGS),
    };
  } else if (r < 0.72) {
    evt = {
      time: nowISO(), level: 'info', subsystem: 'cron',
      message: pick(CRON_MSGS),
    };
  } else if (r < 0.78) {
    evt = {
      time: nowISO(), level: 'error', subsystem: pick(['gateway', 'tool', 'model', 'whatsapp']),
      error: pick(ERRORS),
    };
  } else if (r < 0.84) {
    evt = {
      time: nowISO(), level: 'warn', subsystem: pick(['gateway', 'model']),
      message: pick(['retry 1/3', 'slow response 1.2s', 'cache miss']),
    };
  } else {
    evt = {
      time: nowISO(), level: 'info', subsystem: 'gateway',
      message: pick(GATEWAY_MSGS),
    };
  }

  process.stdout.write(JSON.stringify(evt) + '\n');
}

const interval = Number(process.argv[2]) || 220;
setInterval(emit, interval);
process.stdin.resume();
