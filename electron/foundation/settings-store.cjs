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
  tracker: {
    saveDirectory: '',
    captureFormat: 'png',
    scrollStepRatio: 0.8,
    stableWaitMs: 400,
    stableMaxWaitMs: 3000,
    maxCaptures: 100,
    maxMatches: 5,
    browserTarget: 'chrome',
    calibration: null,
    autoOpenResultFolder: false,
    packageCompression: 'standard',
    maxDurationMs: 900000
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
      tracker: { ...this.value.tracker, ...(patch?.tracker || {}) },
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
  const browserTarget = ['chrome', 'edge', 'firefox'].includes(input?.tracker?.browserTarget)
    ? input.tracker.browserTarget
    : 'chrome';
  const packageCompression = ['fast', 'standard', 'maximum'].includes(input?.tracker?.packageCompression)
    ? input.tracker.packageCompression
    : 'standard';
  const captureFormat = 'png';

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
    tracker: {
      saveDirectory: normalizeDirectory(input?.tracker?.saveDirectory),
      captureFormat,
      scrollStepRatio: clampNumber(input?.tracker?.scrollStepRatio, 0.65, 0.9, 0.8),
      stableWaitMs: clampInt(input?.tracker?.stableWaitMs, 250, 1200, 400),
      stableMaxWaitMs: clampInt(input?.tracker?.stableMaxWaitMs, 1500, 6000, 3000),
      maxCaptures: clampInt(input?.tracker?.maxCaptures, 5, 100, 100),
      maxMatches: clampInt(input?.tracker?.maxMatches, 1, 20, 5),
      browserTarget,
      calibration: normalizeCalibration(input?.tracker?.calibration),
      autoOpenResultFolder: input?.tracker?.autoOpenResultFolder === true,
      packageCompression,
      maxDurationMs: clampInt(input?.tracker?.maxDurationMs, 60000, 3600000, 900000)
    },
    privacy: {
      includeFileNamesInDiagnostics: Boolean(input?.privacy?.includeFileNamesInDiagnostics)
    }
  };
}

function normalizeCalibration(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.schemaVersion !== 1 || !value.geometry || !value.points) return null;
  const required = ['scoreboard', 'performance', 'economy', 'rounds', 'duels'];
  for (const key of required) {
    const point = value.points[key];
    if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) return null;
    if (Number(point.x) < 0 || Number(point.x) > 1 || Number(point.y) < 0 || Number(point.y) > 1) return null;
  }
  return structuredClone(value);
}

function normalizeDirectory(value) {
  return String(value || '').replace(/[\r\n\0]/g, '').slice(0, 1024);
}

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

module.exports = { SettingsStore, DEFAULT_SETTINGS };
