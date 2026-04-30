'use strict';

class ChatInput {
  constructor() {
    this.buffer = '';
    this.cursor = 0;
    this.focused = false;
    this.history = [];
    this.historyIdx = -1;
    this.lastError = '';
    this.lastSent = '';
    this.busy = false;
  }

  focus() {
    this.focused = true;
    this.historyIdx = -1;
  }

  blur() {
    this.focused = false;
  }

  setError(msg) {
    this.lastError = msg || '';
  }

  setSent(text) {
    this.lastSent = text || '';
    this.lastError = '';
  }

  setBusy(b) {
    this.busy = !!b;
  }

  /**
   * Returns one of:
   *   { kind: 'submit', text }    user pressed Enter with non-empty input
   *   { kind: 'cancel' }          user pressed Esc
   *   { kind: 'quit' }            user pressed Ctrl+C
   *   { kind: 'consumed' }        key was handled, no external action
   *   null                        key was not handled (caller may use it)
   */
  handleKey(key) {
    if (key === '\x03') return { kind: 'quit' };

    if (!this.focused) {
      if (key === '/' || key === 'c' || key === 'C' || key === 'i' || key === 'I') {
        this.focus();
        return { kind: 'consumed' };
      }
      return null;
    }

    if (key === '\x1b' || key === '\x1b\x1b') {
      this.buffer = '';
      this.cursor = 0;
      this.blur();
      return { kind: 'cancel' };
    }

    if (key === '\r' || key === '\n') {
      const text = this.buffer.trim();
      this.buffer = '';
      this.cursor = 0;
      this.blur();
      if (!text) return { kind: 'cancel' };
      this.history.unshift(text);
      if (this.history.length > 100) this.history.length = 100;
      return { kind: 'submit', text };
    }

    if (key === '\x7f' || key === '\b') {
      if (this.cursor > 0) {
        this.buffer = this.buffer.slice(0, this.cursor - 1) + this.buffer.slice(this.cursor);
        this.cursor--;
      }
      return { kind: 'consumed' };
    }

    if (key === '\x1b[A') {
      if (this.history.length && this.historyIdx < this.history.length - 1) {
        this.historyIdx++;
        this.buffer = this.history[this.historyIdx];
        this.cursor = this.buffer.length;
      }
      return { kind: 'consumed' };
    }

    if (key === '\x1b[B') {
      if (this.historyIdx > 0) {
        this.historyIdx--;
        this.buffer = this.history[this.historyIdx];
        this.cursor = this.buffer.length;
      } else {
        this.historyIdx = -1;
        this.buffer = '';
        this.cursor = 0;
      }
      return { kind: 'consumed' };
    }

    if (key === '\x1b[D') {
      if (this.cursor > 0) this.cursor--;
      return { kind: 'consumed' };
    }
    if (key === '\x1b[C') {
      if (this.cursor < this.buffer.length) this.cursor++;
      return { kind: 'consumed' };
    }
    if (key === '\x01') { this.cursor = 0; return { kind: 'consumed' }; }
    if (key === '\x05') { this.cursor = this.buffer.length; return { kind: 'consumed' }; }
    if (key === '\x15') { this.buffer = this.buffer.slice(this.cursor); this.cursor = 0; return { kind: 'consumed' }; }

    if (key.length === 1 && key >= ' ' && key !== '\x7f') {
      this.buffer = this.buffer.slice(0, this.cursor) + key + this.buffer.slice(this.cursor);
      this.cursor++;
      return { kind: 'consumed' };
    }

    if (key.length > 1 && !key.startsWith('\x1b')) {
      const safe = key.replace(/[\x00-\x1f\x7f]/g, '');
      if (safe) {
        this.buffer = this.buffer.slice(0, this.cursor) + safe + this.buffer.slice(this.cursor);
        this.cursor += safe.length;
      }
      return { kind: 'consumed' };
    }

    return { kind: 'consumed' };
  }
}

module.exports = { ChatInput };
