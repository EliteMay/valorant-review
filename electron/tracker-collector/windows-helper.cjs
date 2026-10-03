const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

class TrackerWindowsHelper {
  constructor({ app, logger }) {
    this.app = app;
    this.logger = logger;
  }

  get helperPath() {
    if (this.app.isPackaged) {
      return path.join(process.resourcesPath, 'tracker-helper', 'vreview-tracker-helper.exe');
    }
    return path.join(this.app.getAppPath(), 'native', 'bin', 'vreview-tracker-helper.exe');
  }

  async listWindows() {
    const result = await this.#run(['list']);
    return Array.isArray(result.windows) ? result.windows : [];
  }

  async status(windowId) {
    return this.#run(['status', validateWindowId(windowId)]);
  }

  async scroll(windowId, notches) {
    return this.#run(['scroll', validateWindowId(windowId), String(clampInt(notches, -20, 20))]);
  }

  async click(windowId, point) {
    const x = clampInt(point?.x, 0, 10000);
    const y = clampInt(point?.y, 0, 10000);
    return this.#run(['click', validateWindowId(windowId), String(x), String(y)]);
  }

  async home(windowId) {
    return this.#run(['home', validateWindowId(windowId)]);
  }

  async #run(args) {
    const executable = this.helperPath;
    try {
      const { stdout } = await execFileAsync(executable, args, {
        windowsHide: true,
        encoding: 'utf8',
        timeout: 5000,
        maxBuffer: 2 * 1024 * 1024
      });
      const text = String(stdout || '').trim();
      if (!text) throw new Error('Tracker helper returned no output.');
      return JSON.parse(text);
    } catch (error) {
      this.logger?.warn('tracker.helper.failed', {
        command: args[0] || '',
        message: String(error?.message || error).slice(0, 220)
      });
      throw error;
    }
  }
}

function validateWindowId(value) {
  const id = String(value || '');
  if (!/^\d{1,20}$/.test(id) || id === '0') throw new Error('Invalid Tracker target window ID.');
  return id;
}

function clampInt(value, min, max) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

module.exports = { TrackerWindowsHelper, validateWindowId };
