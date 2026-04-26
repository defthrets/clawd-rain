'use strict';

const SPEED_MIN = 0.5;
const SPEED_MAX = 1.6;
const TAIL_MIN = 10;
const TAIL_MAX = 18;
const MAX_TEXT_CHARS = 240;

function rand(min, max) { return min + Math.random() * (max - min); }
function randInt(min, max) { return Math.floor(rand(min, max + 1)); }

class Stream {
  constructor(x, text, kind, screenHeight) {
    this.x = x;
    this.text = String(text || '').slice(0, MAX_TEXT_CHARS);
    this.kind = kind;
    this.screenHeight = screenHeight;
    this.headRow = -1;
    this.speed = rand(SPEED_MIN, SPEED_MAX);
    this.tailLength = randInt(TAIL_MIN, TAIL_MAX);
  }

  tick() { this.headRow += this.speed; }

  charAt(y) {
    if (y < 0 || y >= this.screenHeight) return null;
    const headFloor = Math.floor(this.headRow);
    const distFromHead = headFloor - y;
    if (distFromHead < 0 || distFromHead > this.tailLength) return null;
    const idx = this.text.length - 1 - distFromHead;
    if (idx < 0 || idx >= this.text.length) return null;
    const ch = this.text[idx];
    if (ch === ' ') return '·';
    if (ch === '\t') return '→';
    const code = ch.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) return '·';
    return ch;
  }

  brightnessAt(y) {
    const dist = Math.floor(this.headRow) - y;
    if (dist < 0) return 0;
    if (dist === 0) return 1.0;
    if (dist <= 1) return 0.92;
    if (dist <= 3) return 0.75;
    if (dist <= 6) return 0.55;
    if (dist <= 10) return 0.38;
    if (dist <= this.tailLength) return 0.22;
    return 0;
  }

  isLeaderAt(y) { return Math.floor(this.headRow) === y; }

  get done() { return this.headRow - this.tailLength > this.screenHeight; }
}

class Rain {
  constructor(width, height) {
    this.resize(width, height);
    this.tickCount = 0;
  }

  resize(width, height) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.streams = this.streams || [];
    for (const s of this.streams) s.screenHeight = this.height;
  }

  tick() {
    this.tickCount++;
    for (const s of this.streams) s.tick();
    this.streams = this.streams.filter((s) => !s.done);
  }

  injectDecoded(text, kind) { this.injectLine(text, kind); }

  injectLine(text, kind) {
    const trimmed = String(text || '').replace(/\s+/g, ' ').trim();
    if (!trimmed) return;
    const cap = Math.max(this.width, this.width * 2);
    if (this.streams.length >= cap) {
      let evictIdx = 0;
      let maxHead = -Infinity;
      for (let i = 0; i < this.streams.length; i++) {
        if (this.streams[i].headRow > maxHead) {
          maxHead = this.streams[i].headRow;
          evictIdx = i;
        }
      }
      this.streams.splice(evictIdx, 1);
    }
    const x = this._pickColumn();
    this.streams.push(new Stream(x, trimmed, kind, this.height));
  }

  _pickColumn() {
    const youngOccupied = new Set();
    for (const s of this.streams) {
      const head = s.headRow;
      if (head < 4) youngOccupied.add(s.x);
    }
    for (let i = 0; i < 24; i++) {
      const candidate = randInt(0, this.width - 1);
      if (!youngOccupied.has(candidate)) return candidate;
    }
    return randInt(0, this.width - 1);
  }

  cellAt(x, y) {
    let best = null;
    for (const s of this.streams) {
      if (s.x !== x) continue;
      const ch = s.charAt(y);
      if (ch == null) continue;
      const brightness = s.brightnessAt(y);
      if (brightness <= 0) continue;
      const isLeader = s.isLeaderAt(y);
      if (!best || brightness > best.brightness || (brightness === best.brightness && isLeader)) {
        best = { char: ch, brightness, isLeader, decoded: true, kind: s.kind };
      }
    }
    return best;
  }
}

module.exports = { Rain };
