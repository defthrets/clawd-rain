'use strict';

const { randChar } = require('./chars');

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function randInt(min, max) {
  return Math.floor(rand(min, max + 1));
}

class RainColumn {
  constructor(x, height) {
    this.x = x;
    this.height = height;
    this.reset(true);
  }

  reset(initial) {
    this.length = randInt(6, Math.min(28, Math.max(8, Math.floor(this.height * 0.6))));
    this.speed = rand(0.25, 1.2);
    this.head = initial
      ? rand(-this.height, this.height * 0.5)
      : rand(-this.length * 1.5, -1);
    this.idleUntil = 0;
    this.charsByY = new Map();
    this.mutateRate = rand(0.02, 0.10);
  }

  charAt(y) {
    if (!this.charsByY.has(y)) this.charsByY.set(y, randChar());
    return this.charsByY.get(y);
  }

  tick(now) {
    if (now < this.idleUntil) return;
    this.head += this.speed;

    const headY = Math.floor(this.head);
    for (let i = 0; i < this.length; i++) {
      const y = headY - i;
      if (y < 0 || y >= this.height) continue;
      if (Math.random() < this.mutateRate) {
        this.charsByY.set(y, randChar());
      }
    }

    if (this.head - this.length > this.height) {
      this.reset(false);
      this.idleUntil = now + randInt(0, 60);
    }
  }
}

class DecodedStream {
  constructor(x, text, kind, height) {
    this.x = x;
    this.text = text;
    this.kind = kind;
    this.height = height;
    this.length = Math.max(text.length + 2, 8);
    this.speed = rand(0.4, 0.9);
    this.head = -1;
    this.dead = false;
  }

  tick() {
    this.head += this.speed;
    if (this.head - this.length > this.height) this.dead = true;
  }

  charAt(y) {
    const headY = Math.floor(this.head);
    const idxFromHead = headY - y;
    if (idxFromHead < 0 || idxFromHead >= this.length) return null;
    const textIdx = this.text.length - 1 - idxFromHead;
    if (textIdx < 0 || textIdx >= this.text.length) return randChar();
    const ch = this.text[textIdx];
    return ch === ' ' ? '·' : ch;
  }
}

class Rain {
  constructor(width, height) {
    this.resize(width, height);
    this.tickCount = 0;
  }

  resize(width, height) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.columns = Array.from({ length: this.width }, (_, x) => new RainColumn(x, this.height));
    this.streams = [];
  }

  tick() {
    this.tickCount++;
    for (const c of this.columns) c.tick(this.tickCount);
    for (const s of this.streams) s.tick();
    this.streams = this.streams.filter((s) => !s.dead);
  }

  injectDecoded(text, kind) {
    const trimmed = (text || '').slice(0, Math.max(8, this.height - 4));
    if (!trimmed) return;
    const taken = new Set(this.streams.map((s) => s.x));
    let x;
    for (let i = 0; i < 16; i++) {
      const candidate = randInt(0, this.width - 1);
      if (!taken.has(candidate)) { x = candidate; break; }
    }
    if (x == null) x = randInt(0, this.width - 1);
    this.streams.push(new DecodedStream(x, trimmed, kind, this.height));
  }

  cellAt(x, y) {
    for (const s of this.streams) {
      if (s.x !== x) continue;
      const ch = s.charAt(y);
      if (ch != null) {
        const headY = Math.floor(s.head);
        const distFromHead = headY - y;
        const isLeader = distFromHead === 0;
        const brightness = 1 - Math.min(1, distFromHead / s.length);
        return { char: ch, brightness, isLeader, decoded: true, kind: s.kind };
      }
    }

    const col = this.columns[x];
    if (!col) return null;
    if (this.tickCount < col.idleUntil) return null;
    const headY = Math.floor(col.head);
    const distFromHead = headY - y;
    if (distFromHead < 0 || distFromHead >= col.length) return null;
    if (y < 0 || y >= this.height) return null;
    const isLeader = distFromHead === 0;
    const brightness = 1 - distFromHead / col.length;
    return { char: col.charAt(y), brightness, isLeader, decoded: false, kind: null };
  }
}

module.exports = { Rain };
