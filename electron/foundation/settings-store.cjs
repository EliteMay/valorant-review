const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_SETTINGS = Object.freeze({
  schemaVersion: 1,
  theme: 'dark',
  update: {
    autoCheck: true,
    channel: 'latest'
  },
  analysis: {
    workerConcurrency: 1
  },
  recording: {
    saveDirectory: ''
  },
  privacy: {
    includeFileNamesInDiagnostics: false
  }
});

class SettingsStore {
  constructor(userDataPath, logger) {
    this.logger = logger;
    this.file = path.join(userDataPath, 'settings.json');
    this.backup = path.join(userDataPath, 'settings.backup.json');
    this.value = this.#load();
  }

  get() {
    return structuredClone(this.value);
  }

  update(patch) {
    const next = normalizeSettings({
      ...this.value,
      ...patch,
      update: { ...this.value.update, ...(patch?.update || {}) },
      analysis: { ...this.value.analysis, ...(patch?.analysis || {}) },
      recording: { ...this.value.recording, ...(patch?.recording || {}) },
      privacy: { ...this.value.privacy, ...(patch?.privacy || {}) }
    });
    this.#write(next);
    this.value = next;
    return this.get();
  }

  reset() {
    const next = structuredClone(DEFAULT_SETTINGS);
    this.#write(next);
    this.value = next;
    return this.get();
  }

  #load() {
    const fallback = structuredClone(DEFAULT_SETTINGS);
    for (const candidate of [this.file, this.backup]) {
      try {
        if (!fs.existsSync(candidate)) continue;
        const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'));
        return normalizeSettings(parsed);
      } catch (error) {
        this.logger?.warn('settings.load.failed', { file: path.basename(candidate), message: error.message });
      }
    }
    return fallback;
  }

  #write(value) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    const json = JSON.stringify(value, null, 2);
    if (fs.existsSync(this.file)) {
      try {
        fs.copyFileSync(this.file, this.backup);
      } catch (error) {
        this.logger?.warn('settings.backup.failed', { message: error.message });
      }
    }
    fs.writeFileSync(temp, json, 'utf8');
    fs.renameSync(temp, this.file);
  }
}

function normalizeSettings(input = {}) {
  const workerConcurrency = clampInt(input?.analysis?.workerConcurrency, 1, 4, 1);
  return {
    schemaVersion: 1,
    theme: input.theme === 'system' ? 'system' : 'dark',
    update: {
      autoCheck: input?.update?.autoCheck !== false,
      channel: input?.update?.channel === 'beta' ? 'beta' : 'latest'
    },
    analysis: {
      workerConcurrency
    },
    recording: {
      saveDirectory: normalizeDirectory(input?.recording?.saveDirectory)
    },
    privacy: {
      includeFileNamesInDiagnostics: Boolean(input?.privacy?.includeFileNamesInDiagnostics)
    }
  };
}

function normalizeDirectory(value) {
  return String(value || '').replace(/[\r\n\0]/g, '').slice(0, 1024);
}

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

module.exports = { SettingsStore, DEFAULT_SETTINGS };
