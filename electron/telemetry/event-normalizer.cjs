const ALLOWED_KEYS = new Set(['W', 'A', 'S', 'D']);
const ALLOWED_STATES = new Set(['down', 'up']);

function normalizeTelemetryEvent(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const type = String(input.type || '');
  const tUs = normalizeTimestamp(input.t_us);

  if (type === 'ready') {
    if (tUs == null) return null;
    return {
      type,
      t_us: tUs,
      helperVersion: safeText(input.helperVersion, 32),
      qpcFrequency: normalizePositiveInteger(input.qpcFrequency)
    };
  }

  if (type === 'stopped') {
    if (tUs == null) return null;
    return { type, t_us: tUs };
  }

  if (type === 'focus') {
    if (tUs == null) return null;
    return {
      type,
      t_us: tUs,
      valorant: Boolean(input.valorant),
      process: safeProcessName(input.process)
    };
  }

  if (type === 'mouse') {
    if (tUs == null) return null;
    const dx = normalizeDelta(input.dx);
    const dy = normalizeDelta(input.dy);
    if (dx == null || dy == null || (dx === 0 && dy === 0)) return null;
    return { type, t_us: tUs, dx, dy };
  }

  if (type === 'button') {
    if (tUs == null || input.button !== 'LMB' || !ALLOWED_STATES.has(input.state)) return null;
    return { type, t_us: tUs, button: 'LMB', state: input.state };
  }

  if (type === 'key') {
    const key = String(input.key || '').toUpperCase();
    if (tUs == null || !ALLOWED_KEYS.has(key) || !ALLOWED_STATES.has(input.state)) return null;
    return { type, t_us: tUs, key, state: input.state };
  }

  return null;
}

function normalizeTimestamp(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) return null;
  return number;
}

function normalizePositiveInteger(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) return null;
  return number;
}

function normalizeDelta(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < -65535 || number > 65535) return null;
  return number;
}

function safeText(value, maxLength) {
  return String(value || '').replace(/[\r\n\0]/g, '').slice(0, maxLength);
}

function safeProcessName(value) {
  const text = safeText(value, 96);
  return text.replace(/^.*[\\/]/, '');
}

module.exports = {
  normalizeTelemetryEvent,
  ALLOWED_KEYS: Object.freeze([...ALLOWED_KEYS])
};
