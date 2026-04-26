'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');

class Ingest extends EventEmitter {
  constructor() {
    super();
    this.connected = false;
    this._stop = null;
  }

  start() { throw new Error('subclass must implement'); }

  stop() {
    if (this._stop) {
      try { this._stop(); } catch (_) {}
      this._stop = null;
    }
    this._setConnected(false);
  }

  _setConnected(v) {
    if (this.connected !== v) {
      this.connected = v;
      this.emit('status', v);
    }
  }

  _emitLine(line) {
    if (line == null) return;
    this.emit('line', line);
  }
}

class StdinIngest extends Ingest {
  start() {
    const rl = readline.createInterface({ input: process.stdin });
    rl.on('line', (l) => this._emitLine(l));
    rl.on('close', () => this._setConnected(false));
    this._setConnected(true);
    this._stop = () => rl.close();
  }
}

class FileIngest extends Ingest {
  constructor(filePath) {
    super();
    this.path = filePath;
    this._buffer = '';
    this._fd = null;
    this._pos = 0;
    this._poll = null;
  }

  start() {
    this._open(true);
  }

  _open(seekEnd) {
    fs.open(this.path, 'r', (err, fd) => {
      if (err) {
        this._setConnected(false);
        this._retryTimer = setTimeout(() => this._open(true), 2000);
        return;
      }
      this._fd = fd;
      fs.fstat(fd, (sErr, st) => {
        if (sErr) { this._reopen(); return; }
        this._pos = seekEnd ? st.size : 0;
        this._setConnected(true);
        this._readChunk();
        this._poll = setInterval(() => this._readChunk(), 250);
      });
    });
    this._stop = () => {
      if (this._retryTimer) clearTimeout(this._retryTimer);
      if (this._poll) clearInterval(this._poll);
      if (this._fd != null) { try { fs.closeSync(this._fd); } catch (_) {} this._fd = null; }
    };
  }

  _reopen() {
    if (this._poll) clearInterval(this._poll);
    if (this._fd != null) { try { fs.closeSync(this._fd); } catch (_) {} this._fd = null; }
    this._setConnected(false);
    this._retryTimer = setTimeout(() => this._open(true), 1000);
  }

  _readChunk() {
    if (this._fd == null) return;
    fs.fstat(this._fd, (err, st) => {
      if (err) { this._reopen(); return; }
      if (st.size < this._pos) this._pos = 0;
      if (st.size === this._pos) return;
      const len = Math.min(st.size - this._pos, 1 << 16);
      const buf = Buffer.alloc(len);
      fs.read(this._fd, buf, 0, len, this._pos, (rErr, bytes) => {
        if (rErr) { this._reopen(); return; }
        this._pos += bytes;
        this._buffer += buf.slice(0, bytes).toString('utf8');
        let idx;
        while ((idx = this._buffer.indexOf('\n')) >= 0) {
          this._emitLine(this._buffer.slice(0, idx));
          this._buffer = this._buffer.slice(idx + 1);
        }
      });
    });
  }
}

class GlobIngest extends Ingest {
  constructor(dir, pattern) {
    super();
    this.dir = dir;
    this.pattern = pattern;
    this._currentFile = null;
    this._inner = null;
    this._poll = null;
  }

  start() {
    this._switchToNewest();
    this._poll = setInterval(() => this._maybeSwitch(), 5000);
    this._stop = () => {
      if (this._poll) clearInterval(this._poll);
      if (this._inner) this._inner.stop();
    };
  }

  _findNewest() {
    let entries;
    try { entries = fs.readdirSync(this.dir); }
    catch (_) { return null; }
    let best = null;
    for (const name of entries) {
      if (!this.pattern.test(name)) continue;
      const full = path.join(this.dir, name);
      let st;
      try { st = fs.statSync(full); } catch (_) { continue; }
      if (!st.isFile()) continue;
      if (!best || st.mtimeMs > best.mtimeMs) best = { path: full, mtimeMs: st.mtimeMs };
    }
    return best ? best.path : null;
  }

  _switchToNewest() {
    const newest = this._findNewest();
    if (!newest || newest === this._currentFile) {
      if (!newest) this._setConnected(false);
      return;
    }
    if (this._inner) this._inner.stop();
    this._currentFile = newest;
    const fi = new FileIngest(newest);
    fi.on('line', (l) => this._emitLine(l));
    fi.on('status', (s) => this._setConnected(s));
    fi.start();
    this._inner = fi;
  }

  _maybeSwitch() {
    const newest = this._findNewest();
    if (newest && newest !== this._currentFile) this._switchToNewest();
  }
}

class JournalIngest extends Ingest {
  constructor(args, label) {
    super();
    this.args = args;
    this.label = label;
    this._proc = null;
  }

  start() {
    this._spawn();
    this._stop = () => {
      if (this._respawn) clearTimeout(this._respawn);
      if (this._proc) { try { this._proc.kill(); } catch (_) {} }
    };
  }

  _spawn() {
    const proc = spawn('journalctl', this.args, { stdio: ['ignore', 'pipe', 'ignore'] });
    this._proc = proc;
    this._setConnected(true);

    const rl = readline.createInterface({ input: proc.stdout });
    rl.on('line', (l) => this._emitLine(l));
    proc.on('close', () => {
      this._setConnected(false);
      this._respawn = setTimeout(() => this._spawn(), 2000);
    });
    proc.on('error', () => {
      this._setConnected(false);
      this._respawn = setTimeout(() => this._spawn(), 2000);
    });
  }
}

function fromDetected(d) {
  if (!d) return null;
  if (d.type === 'stdin') return new StdinIngest();
  if (d.type === 'file') return new FileIngest(d.file);
  if (d.type === 'glob') return new GlobIngest(d.dir, d.pattern);
  if (d.type === 'journal-unit') {
    const args = [
      ...(d.scope === 'user' ? ['--user'] : []),
      '-u', d.unit, '--output=cat', '-f', '-n', '0',
    ];
    return new JournalIngest(args, d.label);
  }
  if (d.type === 'journal-tag') {
    const args = ['-t', d.tag, '--output=cat', '-f', '-n', '0'];
    return new JournalIngest(args, d.label);
  }
  return null;
}

function fromOptions(opts) {
  if (opts.source === 'file') return new FileIngest(opts.file);
  if (opts.source === 'journal') {
    return new JournalIngest(['-u', opts.journal, '--output=cat', '-f', '-n', '0'], `journalctl -u ${opts.journal}`);
  }
  if (opts.source === 'stdin') return new StdinIngest();
  return null;
}

module.exports = { fromOptions, fromDetected, StdinIngest, FileIngest, JournalIngest, GlobIngest };
