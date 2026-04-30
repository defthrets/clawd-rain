'use strict';

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { execFileSync } = require('child_process');

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

function findClawdPid() {
  if (process.platform !== 'linux') return null;

  for (const pattern of ['openclaw-gateway', 'openclaw', 'clawd']) {
    const out = safeExec('pgrep', ['-f', pattern]);
    if (out && out.trim()) {
      const pids = out.trim().split('\n').map((s) => parseInt(s, 10)).filter(Boolean);
      const self = process.pid;
      const filtered = pids.filter((p) => p !== self);
      if (filtered.length) return filtered[0];
    }
  }

  const probes = [
    ['systemctl', ['--user', 'show', 'openclaw-gateway', '-p', 'MainPID', '--value']],
    ['systemctl', ['show', 'openclaw-gateway', '-p', 'MainPID', '--value']],
    ['systemctl', ['--user', 'show', 'openclaw', '-p', 'MainPID', '--value']],
    ['systemctl', ['show', 'openclaw', '-p', 'MainPID', '--value']],
  ];
  for (const [cmd, args] of probes) {
    const out = safeExec(cmd, args);
    if (!out) continue;
    const p = parseInt(out.trim(), 10);
    if (p > 0) return p;
  }
  return null;
}

function pidAlive(pid) {
  if (!pid) return false;
  try {
    fs.accessSync(`/proc/${pid}`);
    return true;
  } catch (_) {
    return false;
  }
}

function readCmdline(pid) {
  try {
    const data = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
    const flat = data.replace(/\0+$/, '').replace(/\0/g, ' ').trim();
    return flat || null;
  } catch (_) {
    return null;
  }
}

function readChildren(pid) {
  const result = [];
  let tasks;
  try { tasks = fs.readdirSync(`/proc/${pid}/task`); }
  catch (_) { return result; }
  for (const tid of tasks) {
    try {
      const data = fs.readFileSync(`/proc/${pid}/task/${tid}/children`, 'utf8');
      for (const tok of data.trim().split(/\s+/)) {
        const c = parseInt(tok, 10);
        if (c) result.push(c);
      }
    } catch (_) {}
  }
  return result;
}

function allDescendants(rootPid, max = 4096) {
  const visited = new Set();
  const stack = [rootPid];
  while (stack.length && visited.size < max) {
    const p = stack.pop();
    if (visited.has(p)) continue;
    visited.add(p);
    for (const c of readChildren(p)) if (!visited.has(c)) stack.push(c);
  }
  visited.delete(rootPid);
  return visited;
}

function ssAvailable() {
  return safeExec('ss', ['-V']) != null;
}

class ProcWatch extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.pid = opts.pid || null;
    this.intervalMs = opts.intervalMs || 750;
    this.connected = false;
    this._poll = null;
    this._lastChildren = new Map();
    this._lastConns = new Set();
    this._haveSs = ssAvailable();
    this._selfPid = process.pid;
  }

  start() {
    if (process.platform !== 'linux') {
      this._setConnected(false);
      return;
    }
    this._tick();
    this._poll = setInterval(() => this._tick(), this.intervalMs);
  }

  stop() {
    if (this._poll) clearInterval(this._poll);
    this._poll = null;
    this._setConnected(false);
  }

  _setConnected(v) {
    if (this.connected !== v) {
      this.connected = v;
      this.emit('status', v);
    }
  }

  _emit(evt) {
    this.emit('line', JSON.stringify(evt));
  }

  _tick() {
    if (!this.pid || !pidAlive(this.pid)) {
      this.pid = findClawdPid();
      if (!this.pid) { this._setConnected(false); return; }
    }
    this._setConnected(true);
    this._scanChildren();
    this._scanConns();
  }

  _scanChildren() {
    const descendants = allDescendants(this.pid);
    const current = new Map();
    for (const pid of descendants) {
      if (pid === this._selfPid) continue;
      const cmd = readCmdline(pid);
      if (!cmd) continue;
      current.set(pid, cmd);
      if (!this._lastChildren.has(pid)) {
        this._emit({
          time: new Date().toISOString(),
          level: 'debug',
          subsystem: 'shell',
          pid,
          cmd,
          message: cmd,
        });
      }
    }
    for (const [pid, cmd] of this._lastChildren) {
      if (!current.has(pid)) {
        this._emit({
          time: new Date().toISOString(),
          level: 'debug',
          subsystem: 'shell',
          pid,
          cmd,
          message: `exit: ${cmd}`,
        });
      }
    }
    this._lastChildren = current;
  }

  _scanConns() {
    if (!this._haveSs) return;
    const out = safeExec('ss', ['-tnpHo']);
    if (!out) return;

    const ourPids = new Set([this.pid, ...this._lastChildren.keys()]);
    const current = new Set();

    for (const line of out.split('\n')) {
      if (!line.trim()) continue;
      const pidMatch = line.match(/pid=(\d+)/);
      if (!pidMatch) continue;
      const pid = parseInt(pidMatch[1], 10);
      if (!ourPids.has(pid)) continue;

      const cols = line.trim().split(/\s+/);
      const state = cols[0] || '';
      const local = cols[3] || '';
      const peer = cols[4] || '';
      if (!peer || peer === '0.0.0.0:*' || peer === '[::]:*') continue;

      const key = `${pid}:${local}->${peer}`;
      current.add(key);
      if (!this._lastConns.has(key)) {
        this._emit({
          time: new Date().toISOString(),
          level: 'info',
          subsystem: 'net',
          direction: 'out',
          peer,
          local,
          state,
          pid,
          message: `${state} ${peer}`,
        });
      }
    }

    for (const key of this._lastConns) {
      if (!current.has(key)) {
        const m = key.match(/^(\d+):(.+?)->(.+)$/);
        if (m) {
          this._emit({
            time: new Date().toISOString(),
            level: 'info',
            subsystem: 'net',
            direction: 'out',
            peer: m[3],
            local: m[2],
            state: 'CLOSED',
            pid: parseInt(m[1], 10),
            message: `CLOSED ${m[3]}`,
          });
        }
      }
    }
    this._lastConns = current;
  }
}

module.exports = { ProcWatch, findClawdPid, ssAvailable };
