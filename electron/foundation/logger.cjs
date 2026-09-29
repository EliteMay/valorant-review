const fs = require('node:fs');
const path = require('node:path');

class Logger {
  constructor(logDir) {
    this.logDir = logDir;
    this.file = path.join(logDir, 'vreview.log');
    fs.mkdirSync(logDir, { recursive: true });
    this.#rotate();
  }

  info(event, details = {}) { this.#write('INFO', event, details); }
  warn(event, details = {}) { this.#write('WARN', event, details); }
  error(event, details = {}) { this.#write('ERROR', event, details); }

  #write(level, event, details) {
    try {
      const line = JSON.stringify({
        at: new Date().toISOString(),
        level,
        event,
        details: sanitize(details)
      });
      fs.appendFileSync(this.file, `${line}\n`, 'utf8');
    } catch {
      // Logging must never break the app.
    }
  }

  #rotate() {
    try {
      if (!fs.existsSync(this.file)) return;
      const size = fs.statSync(this.file).size;
      if (size < 2 * 1024 * 1024) return;
      const old = path.join(this.logDir, 'vreview.log.1');
      if (fs.existsSync(old)) fs.rmSync(old, { force: true });
      fs.renameSync(this.file, old);
    } catch {
      // Best-effort retention only.
    }
  }
}

function sanitize(input) {
  if (!input || typeof input !== 'object') return {};
  const output = {};
  for (const [key, value] of Object.entries(input)) {
    if (/token|secret|password|authorization|cookie|content|body/i.test(key)) continue;
    if (typeof value === 'string') output[key] = value.slice(0, 240);
    else if (typeof value === 'number' || typeof value === 'boolean' || value == null) output[key] = value;
  }
  return output;
}

module.exports = { Logger };
