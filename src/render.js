'use strict';

const {
  rainColor,
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

const STATUS_ROWS = 4;
const LOG_ROWS = STATUS_ROWS - 1;

class Renderer {
  constructor(rain, opts = {}) {
    this.rain = rain;
    this.title = opts.title || 'clawd';
    this.source = opts.source || '';
    this.frameMs = opts.frameMs || 60;
    this.recent = [];
    this.eventCount = 0;
    this.windowStart = Date.now();
    this.connected = false;
    this.paused = false;
    this._timer = null;
    this._lastFrame = '';
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
    if (this.recent.length > 32) this.recent.shift();
  }

  _onResize() {
    const w = process.stdout.columns || 80;
    const h = process.stdout.rows || 24;
    this.rain.resize(w, h - STATUS_ROWS);
    process.stdout.write(CLEAR_SCREEN + HOME);
    this._lastFrame = '';
  }

  frame() {
    if (!this.paused) this.rain.tick();
    this._render();
  }

  _render() {
    const w = this.rain.width;
    const rainH = this.rain.height;
    const totalH = rainH + STATUS_ROWS;

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
        const color = cell.decoded
          ? decodedColor(cell.kind, cell.brightness, cell.isLeader)
          : rainColor(cell.brightness, cell.isLeader);
        if (color !== lastColor) {
          line += color;
          lastColor = color;
        }
        line += cell.char;
      }
      out += line + RESET;
    }

    out += this._renderLogStrip(rainH, w);
    out += this._renderStatusBar(totalH, w);

    process.stdout.write(out);
  }

  _renderLogStrip(startY, width) {
    const recent = this.recent.slice(-LOG_ROWS);
    let out = '';
    for (let i = 0; i < LOG_ROWS; i++) {
      const row = startY + 1 + i;
      out += moveTo(row, 1);
      const evt = recent[recent.length - LOG_ROWS + i];
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
    const right = `${fg(120, 160, 120)}q quit · p pause${this.paused ? ' [PAUSED]' : ''}${RESET} `;
    const visibleLeft = ` ● ${status} · ${rate} ev/min · ${this.title}` + (sourceText ? ` · ${sourceText}` : '');
    const visibleRight = `q quit · p pause${this.paused ? ' [PAUSED]' : ''} `;
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

module.exports = { Renderer, STATUS_ROWS };
