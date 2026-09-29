const fs = require('node:fs');
const path = require('node:path');

class WindowStateStore {
  constructor(userDataPath, screen, logger) {
    this.file = path.join(userDataPath, 'window-state.json');
    this.screen = screen;
    this.logger = logger;
  }

  load() {
    const fallback = { width: 1440, height: 900, maximized: false };
    try {
      if (!fs.existsSync(this.file)) return fallback;
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return this.#normalize(parsed, fallback);
    } catch (error) {
      this.logger?.warn('window-state.load.failed', { message: error.message });
      return fallback;
    }
  }

  save(win) {
    try {
      const bounds = win.getNormalBounds();
      const value = {
        ...bounds,
        maximized: win.isMaximized()
      };
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const temp = `${this.file}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
      fs.renameSync(temp, this.file);
    } catch (error) {
      this.logger?.warn('window-state.save.failed', { message: error.message });
    }
  }

  #normalize(input, fallback) {
    const width = clampInt(input?.width, 900, 3840, fallback.width);
    const height = clampInt(input?.height, 640, 2160, fallback.height);
    const x = Number.isFinite(Number(input?.x)) ? Number(input.x) : undefined;
    const y = Number.isFinite(Number(input?.y)) ? Number(input.y) : undefined;
    const candidate = { width, height, x, y, maximized: Boolean(input?.maximized) };
    if (x == null || y == null) return candidate;

    const displays = this.screen.getAllDisplays();
    const visible = displays.some(display => intersects(candidate, display.workArea));
    return visible ? candidate : { width, height, maximized: candidate.maximized };
  }
}

function intersects(a, b) {
  const aw = Number(a.width || 0), ah = Number(a.height || 0);
  return a.x < b.x + b.width && a.x + aw > b.x && a.y < b.y + b.height && a.y + ah > b.y;
}

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

module.exports = { WindowStateStore };
