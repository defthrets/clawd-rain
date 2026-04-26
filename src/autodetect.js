'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HOME = os.homedir();
const OPENCLAW_LOG_DIR = '/tmp/openclaw';
const OPENCLAW_LOG_RE = /^openclaw-\d{4}-\d{2}-\d{2}\.log$/;
const SYSTEMD_UNIT_RE = /^(openclaw-gateway|openclaw|clawd)(\.service)?$/i;

function safeExec(cmd, args, timeoutMs = 1500) {
  try {
    return execFileSync(cmd, args, {
      encoding: 'utf8',
      timeout: timeoutMs,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (_) {
    return null;
  }
}

function findUnits(scope) {
  const out = safeExec('systemctl', [
    ...(scope === 'user' ? ['--user'] : []),
    'list-units',
    '--type=service',
    '--state=active',
    '--no-legend',
    '--plain',
    '--no-pager',
  ]);
  if (!out) return [];
  const units = [];
  for (const line of out.split('\n')) {
    const name = line.trim().split(/\s+/)[0];
    if (name && SYSTEMD_UNIT_RE.test(name)) units.push(name);
  }
  return units;
}

function journalctlAvailable() {
  return safeExec('journalctl', ['--version'], 800) != null;
}

function readConfigOverride() {
  const cfg = path.join(HOME, '.openclaw', 'openclaw.json');
  try {
    const raw = fs.readFileSync(cfg, 'utf8');
    const obj = JSON.parse(raw);
    const f = obj && obj.logging && obj.logging.file;
    if (f && typeof f === 'string') return f;
  } catch (_) {}
  return null;
}

function newestOpenclawLog() {
  let entries;
  try {
    entries = fs.readdirSync(OPENCLAW_LOG_DIR);
  } catch (_) {
    return null;
  }
  let best = null;
  for (const name of entries) {
    if (!OPENCLAW_LOG_RE.test(name)) continue;
    const full = path.join(OPENCLAW_LOG_DIR, name);
    let st;
    try { st = fs.statSync(full); } catch (_) { continue; }
    if (!st.isFile()) continue;
    if (!best || st.mtimeMs > best.mtimeMs) best = { path: full, mtimeMs: st.mtimeMs };
  }
  return best ? best.path : null;
}

function fileExists(p) {
  try { return fs.statSync(p).isFile(); }
  catch (_) { return false; }
}

function detect() {
  const override = readConfigOverride();
  if (override && fileExists(override)) {
    return { type: 'file', file: override, label: `${override} (config)` };
  }

  const sysUnits = findUnits('system');
  if (sysUnits.length) {
    return { type: 'journal-unit', unit: sysUnits[0], scope: 'system', label: `journalctl -u ${sysUnits[0]}` };
  }
  const userUnits = findUnits('user');
  if (userUnits.length) {
    return { type: 'journal-unit', unit: userUnits[0], scope: 'user', label: `journalctl --user -u ${userUnits[0]}` };
  }

  const newest = newestOpenclawLog();
  if (newest) return { type: 'glob', dir: OPENCLAW_LOG_DIR, pattern: OPENCLAW_LOG_RE, file: newest, label: newest };

  if (journalctlAvailable()) {
    return { type: 'journal-tag', tag: 'openclaw', label: 'journalctl -t openclaw' };
  }

  if (process.stdin && process.stdin.isTTY === false) {
    return { type: 'stdin', label: 'stdin (piped)' };
  }
  return null;
}

function describeSearched() {
  return [
    'Auto-detect tried (in order):',
    `  1. config override: ${path.join(HOME, '.openclaw', 'openclaw.json')} -> logging.file`,
    '  2. systemd units matching /openclaw-gateway|openclaw|clawd/  (system + user)',
    `  3. newest log file in ${OPENCLAW_LOG_DIR}/ matching openclaw-YYYY-MM-DD.log`,
    '  4. journalctl -t openclaw  (syslog identifier)',
    '  5. stdin (piped data)',
    '',
    'If none of these apply on your homelab, point clawdrain at the right source:',
    '  clawdrain --file /path/to/clawd.log',
    '  clawdrain --journal openclaw-gateway',
    '  some-cmd | clawdrain',
  ].join('\n');
}

module.exports = { detect, describeSearched, OPENCLAW_LOG_DIR, OPENCLAW_LOG_RE };
