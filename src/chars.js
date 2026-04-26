'use strict';

const ASCII_POOL =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ' +
  'abcdefghijklmnopqrstuvwxyz' +
  '0123456789' +
  '!@#$%^&*()_+-=[]{};:<>,.?/|\\~';

const KATAKANA_POOL =
  'ｦｧｨｩｪｫｬｭｮｯｰｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ';

const POOL = ASCII_POOL + KATAKANA_POOL;

function randChar() {
  return POOL[(Math.random() * POOL.length) | 0];
}

const KIND_COLOR = {
  tool:    [0, 255, 255],
  http:    [120, 255, 200],
  llm:     [255, 220, 0],
  error:   [255, 80, 80],
  warn:    [255, 170, 60],
  channel: [220, 100, 255],
  memory:  [180, 140, 255],
  cron:    [255, 140, 80],
  webhook: [255, 200, 120],
  gateway: [120, 220, 255],
  system:  [140, 200, 200],
  info:    [220, 220, 220],
  unknown: [150, 200, 150],
};

function fg(r, g, b) {
  return `\x1b[38;2;${r};${g};${b}m`;
}

function bg(r, g, b) {
  return `\x1b[48;2;${r};${g};${b}m`;
}

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

function rainColor(brightness, isLeader) {
  if (isLeader) return fg(220, 255, 220);
  const b = Math.max(0, Math.min(1, brightness));
  if (b > 0.85) return fg(80, 255, 130);
  if (b > 0.6)  return fg(40, 220, 90);
  if (b > 0.35) return fg(20, 170, 60);
  if (b > 0.15) return fg(10, 110, 35);
  return fg(5, 60, 20);
}

function decodedColor(kind, brightness, isLeader) {
  const c = KIND_COLOR[kind] || KIND_COLOR.unknown;
  if (isLeader) return BOLD + fg(255, 255, 255);
  const b = Math.max(0.25, Math.min(1, brightness));
  const r = Math.round(c[0] * b);
  const g = Math.round(c[1] * b);
  const bl = Math.round(c[2] * b);
  return fg(r, g, bl);
}

const CURSOR_HIDE = '\x1b[?25l';
const CURSOR_SHOW = '\x1b[?25h';
const ALT_SCREEN_ON = '\x1b[?1049h';
const ALT_SCREEN_OFF = '\x1b[?1049l';
const CLEAR_SCREEN = '\x1b[2J';
const HOME = '\x1b[H';

function moveTo(row, col) {
  return `\x1b[${row};${col}H`;
}

module.exports = {
  randChar,
  rainColor,
  decodedColor,
  fg,
  bg,
  RESET,
  BOLD,
  DIM,
  CURSOR_HIDE,
  CURSOR_SHOW,
  ALT_SCREEN_ON,
  ALT_SCREEN_OFF,
  CLEAR_SCREEN,
  HOME,
  moveTo,
  KIND_COLOR,
};
