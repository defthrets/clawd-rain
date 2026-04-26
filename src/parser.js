'use strict';

const CHANNEL_NAMES = new Set([
  'whatsapp', 'telegram', 'slack', 'discord', 'signal', 'imessage', 'irc', 'teams',
  'matrix', 'feishu', 'line', 'mattermost', 'nextcloud', 'nostr', 'twitch', 'zalo',
  'wechat', 'qq', 'webchat', 'googlechat', 'bluebubbles', 'sms', 'email',
]);

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}️‍]/gu;

function stripEmoji(s) {
  return (s || '').replace(EMOJI_RE, '').replace(/\s{2,}/g, ' ').trim();
}

function tryJson(line) {
  const t = line.trim();
  if (t.length < 2 || t[0] !== '{') return null;
  try {
    return JSON.parse(t);
  } catch (_) {
    return null;
  }
}

function categorize(rawLine) {
  const line = (rawLine || '').replace(/\r$/, '');
  if (!line.trim()) return null;
  const json = tryJson(line);
  if (json && typeof json === 'object') return categorizeOpenClaw(json);
  return categorizeText(line);
}

function rootSubsystem(s) {
  if (!s) return '';
  return String(s).split('/')[0].toLowerCase();
}

function kindForSubsystem(sub) {
  const root = rootSubsystem(sub);
  if (!root) return null;
  if (root === 'tool' || root === 'tools' || root.startsWith('tool-')) return 'tool';
  if (root === 'model' || root === 'models' || root === 'llm' || root === 'inference') return 'llm';
  if (root === 'memory' || root === 'mem') return 'memory';
  if (root === 'cron' || root === 'scheduler') return 'cron';
  if (root === 'webhook' || root === 'webhooks') return 'webhook';
  if (root === 'gateway') return 'gateway';
  if (root === 'agent' || root === 'agents' || root === 'loop') return 'system';
  if (root === 'canvas' || root === 'tailscale' || root === 'auth') return 'system';
  if (CHANNEL_NAMES.has(root)) return 'channel';
  return null;
}

const LABELS = {
  tool:    'TOOL',
  http:    'HTTP',
  llm:     'LLM ',
  error:   'ERR ',
  warn:    'WARN',
  channel: 'CHAN',
  memory:  'MEM ',
  cron:    'CRON',
  webhook: 'HOOK',
  gateway: 'GATE',
  system:  'SYS ',
  info:    'INFO',
  unknown: '... ',
};

function categorizeOpenClaw(obj) {
  const level = String(obj.level || obj.lvl || obj.severity || '').toLowerCase();
  const subsystem = obj.subsystem || obj.sub || obj.module || obj.component || '';
  const message = stripEmoji(obj.message || obj.msg || obj.text || '');

  let kind = kindForSubsystem(subsystem);

  if (level === 'error' || level === 'err' || level === 'fatal') kind = 'error';
  else if (level === 'warn' || level === 'warning') kind = 'warn';

  const status = obj.status || obj.statusCode || obj.status_code;
  if (status && Number(status) >= 400) kind = 'error';
  if (obj.ok === false) kind = 'error';

  if (!kind) {
    if (/^Exec\b/i.test(message) || /^calling tool\b/i.test(message)) kind = 'tool';
    else if (obj.tool || obj.tool_name) kind = 'tool';
    else if (obj.method && (obj.url || obj.path)) kind = 'http';
    else if (obj.model || obj.prompt_tokens || obj.completion_tokens) kind = 'llm';
    else kind = 'info';
  }

  const label = LABELS[kind] || 'INFO';
  const text = formatBody(kind, subsystem, message, obj);
  return { kind, label, text, subsystem: rootSubsystem(subsystem) };
}

function formatBody(kind, subsystem, message, obj) {
  const sub = rootSubsystem(subsystem);
  const subTag = sub ? `[${sub}] ` : '';
  const dur = obj.duration_ms || obj.durationMs || obj.elapsed_ms || obj.latency_ms;

  if (kind === 'tool') {
    const tool = obj.tool || obj.tool_name || '';
    const action = obj.action || obj.fn || obj.endpoint || '';
    const status = obj.status || obj.statusCode;
    const code = status ? ` → ${status}` : '';
    const ms = dur ? ` ${Math.round(Number(dur))}ms` : '';
    if (tool) return `${subTag}${tool}${action ? '.' + action : ''}${code}${ms}`.trim();
    return `${subTag}${message}${ms}`.trim();
  }
  if (kind === 'http') {
    const method = obj.method;
    const url = obj.url || obj.path || '';
    const status = obj.status;
    const code = status ? ` → ${status}` : '';
    const ms = dur ? ` ${Math.round(Number(dur))}ms` : '';
    return `${subTag}${method || ''} ${url}${code}${ms}`.trim();
  }
  if (kind === 'llm') {
    const model = obj.model ? ` ${obj.model}` : '';
    const pt = obj.prompt_tokens ? ` p=${obj.prompt_tokens}` : '';
    const ct = obj.completion_tokens ? ` c=${obj.completion_tokens}` : '';
    return `${subTag}${message || 'inference'}${model}${pt}${ct}`.trim();
  }
  if (kind === 'error') {
    const err = obj.error || obj.err || obj.exception || message || '';
    return `${subTag}${err}`.trim();
  }
  if (kind === 'channel') {
    const dir = obj.direction || (subsystem.includes('/outbound') ? 'out' : subsystem.includes('/inbound') ? 'in' : '');
    const arrow = dir === 'out' ? '→' : dir === 'in' ? '←' : '·';
    return `${subTag}${arrow} ${message}`.trim();
  }
  return `${subTag}${message || compactJson(obj)}`.trim();
}

function compactJson(obj) {
  try {
    const parts = [];
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'time' || k === 'level' || k === 'subsystem' || k === 'message') continue;
      if (v && typeof v === 'object') continue;
      parts.push(`${k}=${v}`);
      if (parts.length >= 5) break;
    }
    return parts.join(' ');
  } catch (_) {
    return '';
  }
}

function categorizeText(line) {
  const stripped = stripEmoji(line);
  let kind = 'info';

  const subMatch = stripped.match(/^\[([\w\-/]+)\]\s*/);
  let sub = '';
  let body = stripped;
  if (subMatch) {
    sub = subMatch[1];
    body = stripped.slice(subMatch[0].length);
    const k = kindForSubsystem(sub);
    if (k) kind = k;
  }

  if (/\b(error|exception|traceback|panic|fatal)\b/i.test(body) || /^err(\s|:)/i.test(body)) kind = 'error';
  else if (/\bwarn(ing)?\b/i.test(body)) kind = 'warn';
  else if (/^Exec\s/i.test(body) || /\bcalling tool\b/i.test(body)) kind = 'tool';
  else if (kind === 'info' && /\b(GET|POST|PUT|PATCH|DELETE|HEAD)\s+\/?\S+/i.test(body)) kind = 'http';
  else if (kind === 'info' && /\b(prompt|completion|tokens|model=|llm|inference)\b/i.test(body)) kind = 'llm';

  body = body.replace(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?\s*/, '');
  body = body.replace(/^\[(info|debug|trace)\]\s*/i, '');

  const text = sub ? `[${sub}] ${body}` : body;
  return { kind, label: LABELS[kind], text: text.trim(), subsystem: rootSubsystem(sub) };
}

module.exports = { categorize };
