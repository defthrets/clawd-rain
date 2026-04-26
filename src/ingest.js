'use strict';

const fs = require('fs');
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
  constructor(path) {
    super();
    this.path = path;
    this._buffer = '';
    this._fd = null;
    this._pos = 0;
    this._watcher = null;
    this._poll = null;
  }

  start() {
    this._open(true);
  }

  _open(seekEnd) {
    fs.open(this.path, 'r', (err, fd) => {
      if (err) {
        this._setConnected(false);
        setTimeout(() => this._open(true), 2000);
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
      if (this._poll) clearInterval(this._poll);
      if (this._fd != null) { try { fs.closeSync(this._fd); } catch (_) {} }
    };
  }

  _reopen() {
    if (this._poll) clearInterval(this._poll);
    if (this._fd != null) { try { fs.closeSync(this._fd); } catch (_) {} this._fd = null; }
    this._setConnected(false);
    setTimeout(() => this._open(true), 1000);
  }

  _readChunk() {
    if (this._fd == null) return;
    fs.fstat(this._fd, (err, st) => {
      if (err) { this._reopen(); return; }
      if (st.size < this._pos) {
        this._pos = 0;
      }
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

class JournalIngest extends Ingest {
  constructor(unit) {
    super();
    this.unit = unit;
    this._proc = null;
  }

  start() {
    this._spawn();
    this._stop = () => {
      if (this._proc) { try { this._proc.kill(); } catch (_) {} }
    };
  }

  _spawn() {
    const args = ['-u', this.unit, '--output=cat', '-f', '-n', '0'];
    const proc = spawn('journalctl', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    this._proc = proc;
    this._setConnected(true);

    const rl = readline.createInterface({ input: proc.stdout });
    rl.on('line', (l) => this._emitLine(l));
    proc.on('close', () => {
      this._setConnected(false);
      setTimeout(() => this._spawn(), 2000);
    });
    proc.on('error', () => {
      this._setConnected(false);
      setTimeout(() => this._spawn(), 2000);
    });
  }
}

function fromOptions(opts) {
  if (opts.source === 'file') return new FileIngest(opts.file);
  if (opts.source === 'journal') return new JournalIngest(opts.journal);
  return new StdinIngest();
}

module.exports = { fromOptions, StdinIngest, FileIngest, JournalIngest };
