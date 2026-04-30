'use strict';

const {
  decodedColor,
  fg,
  bg,
  RESET,
  BOLD,
  CURSOR_HIDE,
  CURSOR_SHOW,
  ALT_SCREEN_ON,
  ALT_SCREEN_OFF,
  CLEAR_SCREEN,
  HOME,
  moveTo,
  KIND_COLOR,
} = require('./chars');

const STATUS_BAR_ROWS = 1;
const CHAT_ROW_ROWS = 1;
const RAIN_FRACTION = 0.5;

function layout(totalH) {
  const total = Math.max(7, totalH);
  const rainH = Math.max(3, Math.floor(total * RAIN_FRACTION));
  const logH = Math.max(1, total - rainH - CHAT_ROW_ROWS - STATUS_BAR_ROWS);
  return { rainH, logH, chatH: CHAT_ROW_ROWS, statusH: STATUS_BAR_ROWS, totalH: total };
}

function rainHeightFor(totalH) {
  return layout(totalH).rainH;
}

class Renderer {
  constructor(rain, opts = {}) {
    this.rain = rain;
    this.title = opts.title || 'clawd';
    this.source = opts.source || '';
    this.frameMs = opts.frameMs || 60;
    this.chat = opts.chat || null;
    this.chatEnabled = !!opts.chatEnabled;
    this.recent = [];
    this.eventCount = 0;
    this.windowStart = Date.now();
    this.connected = false;
    this.paused = false;
    this._timer = null;
    this._lastFrame = '';
    this._layout = layout(process.stdout.rows || 24);
  }

  start() {
    process.stdout.write(ALT_SCREEN_ON + CURSOR_HIDE + CLEAR_SCREEN + HOME);
    this._handleResize = () => this._onResize();
    process.stdout.on('resize', this._handleResize);
    this._timer = setInterval(() => this.frame(), this.frameMs);
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    if (this._handleResize) process.stdout.removeListener('resize', this._handleResize);
    process.stdout.write(RESET + CURSOR_SHOW + ALT_SCREEN_OFF);
  }

  setConnected(c) { this.connected = c; }
  togglePause() { this.paused = !this.paused; }

  pushEvent(evt) {
    this.eventCount++;
    this.recent.push({ ...evt, t: Date.now() });
    const cap = Math.max(64, (this._layout?.logH || 4) * 8);
    if (this.recent.length > cap) this.recent.shift();
  }

  _onResize() {
    const w = process.stdout.columns || 80;
    const h = process.stdout.rows || 24;
    this._layout = layout(h);
    this.rain.resize(w, this._layout.rainH);
    process.stdout.write(CLEAR_SCREEN + HOME);
    this._lastFrame = '';
  }

  frame() {
    if (!this.paused) this.rain.tick();
    this._render();
  }

  _render() {
    const w = this.rain.width;
    const { rainH, logH, chatH } = this._layout;
    const totalH = rainH + logH + chatH + STATUS_BAR_ROWS;

    let out = HOME;

    for (let y = 0; y < rainH; y++) {
      out += moveTo(y + 1, 1);
      let lastColor = '';
      let line = '';
      for (let x = 0; x < w; x++) {
        const cell = this.rain.cellAt(x, y);
        if (!cell) {
          if (lastColor !== '') { line += RESET; lastColor = ''; }
          line += ' ';
          continue;
        }
        const color = decodedColor(cell.kind, cell.brightness, cell.isLeader);
        if (color !== lastColor) {
          line += color;
          lastColor = color;
        }
        line += cell.char;
      }
      out += line + RESET;
    }

    out += this._renderLogStrip(rainH, w, logH);
    out += this._renderChatRow(rainH + logH + 1, w);
    out += this._renderStatusBar(totalH, w);

    process.stdout.write(out);
  }

  _renderLogStrip(startY, width, logRows) {
    const recent = this.recent.slice(-logRows);
    let out = '';
    for (let i = 0; i < logRows; i++) {
      const row = startY + 1 + i;
      out += moveTo(row, 1);
      const evt = recent[recent.length - logRows + i];
      if (!evt) {
        out += RESET + ' '.repeat(width);
        continue;
      }
      const c = KIND_COLOR[evt.kind] || KIND_COLOR.unknown;
      const tag = `[${evt.label}]`;
      const tagStr = BOLD + fg(c[0], c[1], c[2]) + tag + RESET;
      const rest = ' ' + evt.text;
      const visibleLen = tag.length + rest.length;
      const padded = visibleLen < width
        ? rest + ' '.repeat(width - visibleLen)
        : rest.slice(0, width - tag.length);
      out += tagStr + fg(200, 230, 200) + padded + RESET;
    }
    return out;
  }

  _renderChatRow(rowY, width) {
    let out = moveTo(rowY, 1);
    const chat = this.chat;

    if (chat && chat.focused) {
      const promptStr = '> ';
      const promptColored = fg(0, 255, 200) + BOLD + promptStr + RESET;
      const usable = Math.max(8, width - promptStr.length - 1);
      let buf = chat.buffer;
      let cursor = chat.cursor;
      if (buf.length >= usable) {
        const overflow = buf.length - usable + 1;
        buf = buf.slice(overflow);
        cursor = Math.max(0, cursor - overflow);
      }
      const before = buf.slice(0, cursor);
      const at = buf.slice(cursor, cursor + 1) || ' ';
      const after = buf.slice(cursor + 1);
      const inputColored = fg(220, 240, 220) + before + RESET +
        bg(120, 220, 255) + fg(0, 0, 0) + at + RESET +
        fg(220, 240, 220) + after + RESET;
      const usedLen = promptStr.length + buf.length + (cursor >= buf.length ? 1 : 0);
      const pad = Math.max(0, width - usedLen);
      out += promptColored + inputColored + ' '.repeat(pad);
      return out;
    }

    let hint = '';
    if (chat && chat.lastError) {
      hint = `${fg(255, 100, 100)}chat error: ${chat.lastError}${RESET}`;
    } else if (chat && chat.busy) {
      hint = `${fg(180, 220, 180)}sending…${RESET}`;
    } else if (chat && chat.lastSent) {
      hint = `${fg(100, 200, 200)}→ sent: ${truncate(chat.lastSent, Math.max(20, width - 30))}${RESET}`;
    } else if (this.chatEnabled) {
      hint = `${fg(100, 160, 100)} / chat with clawd · q quit · p pause${RESET}`;
    } else {
      hint = `${fg(80, 100, 80)} chat disabled — pass --chat-agent <id> or --chat-cmd "<cmd>"${RESET}`;
    }
    const visibleLen = stripAnsi(hint).length;
    const pad = Math.max(0, width - visibleLen);
    return out + hint + ' '.repeat(pad);
  }

  _renderStatusBar(totalH, width) {
    const elapsed = (Date.now() - this.windowStart) / 1000;
    const rate = elapsed > 0 ? Math.round((this.eventCount / elapsed) * 60) : 0;
    const dot = this.connected ? fg(0, 255, 100) + '●' : fg(255, 80, 80) + '●';
    const status = this.connected ? 'connected' : 'waiting';
    const sourceText = this.source ? truncate(this.source, Math.max(12, Math.floor(width * 0.35))) : '';
    const left = ` ${dot}${RESET} ${fg(180, 220, 180)}${status}${RESET}` +
      `${fg(80, 140, 80)} · ${RESET}${fg(220, 230, 220)}${rate} ev/min${RESET}` +
      `${fg(80, 140, 80)} · ${RESET}${fg(0, 255, 200)}${this.title}${RESET}` +
      (sourceText ? `${fg(80, 140, 80)} · ${RESET}${fg(160, 200, 160)}${sourceText}${RESET}` : '');
    const rightHint = this.paused ? ' [PAUSED]' : '';
    const right = `${fg(120, 160, 120)}enter send · esc cancel${rightHint}${RESET} `;
    const visibleLeft = ` ● ${status} · ${rate} ev/min · ${this.title}` + (sourceText ? ` · ${sourceText}` : '');
    const visibleRight = `enter send · esc cancel${rightHint} `;
    const padLen = Math.max(1, width - visibleLeft.length - visibleRight.length);
    const barBg = bg(0, 25, 5);
    return moveTo(totalH, 1) + barBg + left + ' '.repeat(padLen) + right + RESET;
  }
}

function truncate(s, max) {
  if (!s) return '';
  if (s.length <= max) return s;
  return '…' + s.slice(s.length - max + 1);
}

function stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

module.exports = { Renderer, layout, rainHeightFor };
