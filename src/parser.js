'use strict';

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
  if (json && typeof json === 'object') return categorizeJson(json, line);
  return categorizeText(line);
}

function categorizeJson(obj, raw) {
  const level = String(obj.level || obj.lvl || obj.severity || '').toLowerCase();
  const status = obj.status || obj.statusCode || obj.status_code;
  const tool = obj.tool || obj.tool_name;
  const method = obj.method || obj.http_method;
  const url = obj.url || obj.path;
  const dur = obj.duration_ms || obj.durationMs || obj.elapsed_ms || obj.latency_ms;
  const tokens = obj.tokens || obj.prompt_tokens || obj.completion_tokens;
  const msg = obj.msg || obj.message || obj.text || '';

  let kind = 'info';
  if (level === 'error' || level === 'err' || level === 'fatal') kind = 'error';
  else if (level === 'warn' || level === 'warning') kind = 'warn';
  else if (status && Number(status) >= 400) kind = 'error';
  else if (tool) kind = 'tool';
  else if (method && url) kind = 'http';
  else if (tokens || obj.prompt || obj.completion || obj.model) kind = 'llm';

  let label = '';
  let body = '';

  if (kind === 'tool') {
    label = 'TOOL';
    const action = obj.action || obj.fn || obj.endpoint || '';
    const code = status ? ` ${status}` : '';
    const ms = dur ? ` ${Math.round(Number(dur))}ms` : '';
    body = `${tool}${action ? '.' + action : ''}${code ? ' →' + code : ''}${ms}`;
  } else if (kind === 'http') {
    label = 'HTTP';
    const code = status ? ` → ${status}` : '';
    const ms = dur ? ` ${Math.round(Number(dur))}ms` : '';
    body = `${method} ${url}${code}${ms}`;
  } else if (kind === 'llm') {
    label = 'LLM ';
    const model = obj.model ? ` ${obj.model}` : '';
    const pt = obj.prompt_tokens ? ` p=${obj.prompt_tokens}` : '';
    const ct = obj.completion_tokens ? ` c=${obj.completion_tokens}` : '';
    body = `${msg || 'inference'}${model}${pt}${ct}`.trim();
  } else if (kind === 'error') {
    label = 'ERR ';
    body = obj.error || obj.err || msg || raw;
  } else if (kind === 'warn') {
    label = 'WARN';
    body = msg || raw;
  } else {
    label = 'INFO';
    body = msg || compactJson(obj);
  }

  return { kind, label, text: body.trim() };
}

function compactJson(obj) {
  try {
    const parts = [];
    for (const [k, v] of Object.entries(obj)) {
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
  const lower = line.toLowerCase();

  let kind = 'info';
  if (/\[(error|err|fatal)\]/i.test(line) || /\b(error|exception|traceback|panic)\b/i.test(line)) kind = 'error';
  else if (/\[(warn|warning)\]/i.test(line) || /\bwarn(ing)?\b/i.test(line)) kind = 'warn';
  else if (/\btool[:= ]/i.test(line) || /\bcalling tool\b/i.test(lower)) kind = 'tool';
  else if (/\b(GET|POST|PUT|PATCH|DELETE|HEAD)\s+\/?\S+/i.test(line)) kind = 'http';
  else if (/\b(prompt|completion|tokens|model=|llm|inference)\b/i.test(lower)) kind = 'llm';

  const labelMap = {
    tool: 'TOOL',
    http: 'HTTP',
    llm:  'LLM ',
    error: 'ERR ',
    warn: 'WARN',
    info: 'INFO',
  };

  let text = line.trim();
  text = text.replace(/^\[(info|debug|trace)\]\s*/i, '');
  text = text.replace(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?\s*/, '');

  return { kind, label: labelMap[kind], text };
}

module.exports = { categorize };
