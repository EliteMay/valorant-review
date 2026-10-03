const path = require('node:path');

const COLLECTOR_VERSION = '0.1.0';
const TAB_KEYS = Object.freeze(['scoreboard', 'performance', 'economy', 'rounds', 'duels']);
const ERROR_CATALOG = Object.freeze({
  'TC-WINDOW-001': ['対象ブラウザが見つかりません。', 'Tracker.ggをChromeで開き、対象ウィンドウを選び直してください。'],
  'TC-WINDOW-002': ['対象ブラウザが閉じられました。', 'Tracker.ggを開き直して対象ウィンドウを選び直してください。'],
  'TC-WINDOW-003': ['対象ブラウザが最小化されています。', '対象ブラウザを復元してから再開してください。'],
  'TC-FOCUS-001': ['対象ブラウザからフォーカスが外れました。', '選択したTracker.ggのブラウザを前面に戻してください。'],
  'TC-CAPTURE-001': ['対象ウィンドウのCaptureに失敗しました。', 'ウィンドウを表示した状態で再試行してください。'],
  'TC-SCROLL-002': ['スクロール後に画面変化を確認できませんでした。', 'ページ最下部なら正常終了です。途中ならScroll設定を見直してください。'],
  'TC-TAB-003': ['Tabへの切替を確認できませんでした。', 'Calibrationをやり直してから再試行してください。'],
  'TC-CAL-001': ['Current Match用Calibrationがありません。', '5つのTab位置をCalibrationしてください。'],
  'TC-CAL-002': ['ウィンドウサイズがCalibration時から大きく変わっています。', '現在のサイズでCalibrationをやり直してください。'],
  'TC-DISK-001': ['保存先の空き容量が不足しています。', '保存先を変更するか、空き容量を増やしてください。'],
  'TC-PACKAGE-001': ['ChatGPT用Packageの作成に失敗しました。', '保存Folderを確認してから再試行してください。'],
  'TC-STOP-001': ['Tracker収集を安全停止しました。', '途中までのCaptureは保存されています。']
});

const DEFAULT_TRACKER_SETTINGS = Object.freeze({
  saveDirectory: '',
  captureFormat: 'png',
  scrollStepRatio: 0.8,
  stableWaitMs: 400,
  stableMaxWaitMs: 3000,
  maxCaptures: 100,
  maxMatches: 5,
  browserTarget: 'chrome',
  autoOpenResultFolder: false,
  packageCompression: 'standard',
  maxDurationMs: 15 * 60 * 1000
});

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizeTrackerSettings(input = {}) {
  const captureFormat = input.captureFormat === 'webp-lossless' ? 'webp-lossless' : 'png';
  const browserTarget = ['chrome', 'edge', 'firefox'].includes(input.browserTarget) ? input.browserTarget : 'chrome';
  const packageCompression = ['fast', 'standard', 'maximum'].includes(input.packageCompression)
    ? input.packageCompression
    : 'standard';
  return {
    saveDirectory: typeof input.saveDirectory === 'string' ? input.saveDirectory.trim() : '',
    captureFormat,
    scrollStepRatio: clampNumber(input.scrollStepRatio, 0.65, 0.9, DEFAULT_TRACKER_SETTINGS.scrollStepRatio),
    stableWaitMs: Math.round(clampNumber(input.stableWaitMs, 250, 1200, DEFAULT_TRACKER_SETTINGS.stableWaitMs)),
    stableMaxWaitMs: Math.round(clampNumber(input.stableMaxWaitMs, 1500, 6000, DEFAULT_TRACKER_SETTINGS.stableMaxWaitMs)),
    maxCaptures: Math.round(clampNumber(input.maxCaptures, 5, 100, DEFAULT_TRACKER_SETTINGS.maxCaptures)),
    maxMatches: Math.round(clampNumber(input.maxMatches, 1, 20, DEFAULT_TRACKER_SETTINGS.maxMatches)),
    browserTarget,
    autoOpenResultFolder: input.autoOpenResultFolder === true,
    packageCompression,
    maxDurationMs: Math.round(clampNumber(input.maxDurationMs, 60_000, 60 * 60 * 1000, DEFAULT_TRACKER_SETTINGS.maxDurationMs))
  };
}

function normalizeBounds(input = {}) {
  return {
    x: Math.round(clampNumber(input.x, -100000, 100000, 0)),
    y: Math.round(clampNumber(input.y, -100000, 100000, 0)),
    width: Math.round(clampNumber(input.width, 1, 16384, 1)),
    height: Math.round(clampNumber(input.height, 1, 16384, 1)),
    scaleFactor: clampNumber(input.scaleFactor, 0.5, 4, 1)
  };
}

function normalizePoint(point) {
  if (!point || typeof point !== 'object') return null;
  const x = Number(point.x);
  const y = Number(point.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x, y };
}

function normalizeCalibration(input = {}) {
  const geometry = normalizeBounds(input.geometry || {});
  const points = {};
  for (const key of TAB_KEYS) {
    const point = normalizePoint(input?.points?.[key]);
    if (!point) return null;
    points[key] = point;
  }
  return {
    schemaVersion: 1,
    trackerProfileVersion: Number.isInteger(input.trackerProfileVersion) ? input.trackerProfileVersion : 1,
    createdAt: typeof input.createdAt === 'string' ? input.createdAt : new Date().toISOString(),
    geometry,
    points
  };
}

function calibrationFits(calibration, bounds, tolerance = 0.12) {
  const normalized = normalizeCalibration(calibration);
  if (!normalized) return false;
  const current = normalizeBounds(bounds);
  const widthDelta = Math.abs(current.width - normalized.geometry.width) / Math.max(1, normalized.geometry.width);
  const heightDelta = Math.abs(current.height - normalized.geometry.height) / Math.max(1, normalized.geometry.height);
  const scaleDelta = Math.abs(current.scaleFactor - normalized.geometry.scaleFactor) / Math.max(0.5, normalized.geometry.scaleFactor);
  return widthDelta <= tolerance && heightDelta <= tolerance && scaleDelta <= tolerance;
}

function normalizedPointToPermille(point) {
  const normalized = normalizePoint(point);
  if (!normalized) return null;
  return { x: Math.round(normalized.x * 10000), y: Math.round(normalized.y * 10000) };
}

function sampleDifference(a, b, startRatio = 0) {
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b) || a.length !== b.length || a.length < 16) return 1;
  const start = Math.floor(a.length * Math.min(0.95, Math.max(0, startRatio)));
  const step = 97;
  let total = 0;
  let samples = 0;
  for (let i = start; i < a.length; i += step) {
    total += Math.abs(a[i] - b[i]);
    samples++;
  }
  return samples ? total / (samples * 255) : 1;
}

function evaluateBottom(previous, current, streak = 0, threshold = 0.008) {
  const fullDiff = sampleDifference(previous, current, 0);
  const lowerDiff = sampleDifference(previous, current, 0.66);
  const unchanged = fullDiff <= threshold;
  const lowerUnchanged = lowerDiff <= threshold;
  const nextStreak = unchanged && lowerUnchanged ? streak + 1 : 0;
  return {
    fullDiff,
    lowerDiff,
    unchanged,
    lowerUnchanged,
    streak: nextStreak,
    atBottom: nextStreak >= 2
  };
}

function estimateRequiredBytes(bounds, maxCaptures) {
  const b = normalizeBounds(bounds);
  const frames = Math.max(1, Math.min(100, Number(maxCaptures) || 1));
  const estimatedPng = Math.min(10 * 1024 * 1024, Math.max(1 * 1024 * 1024, b.width * b.height * 1.25));
  return Math.ceil(estimatedPng * frames + 512 * 1024 * 1024);
}

function isSafeChildPath(root, candidate) {
  const rootPath = path.resolve(root);
  const candidatePath = path.resolve(candidate);
  return candidatePath === rootPath || candidatePath.startsWith(rootPath + path.sep);
}

function errorInfo(id, detail = null) {
  const base = ERROR_CATALOG[id] || ['Tracker Collectorでエラーが発生しました。', 'Diagnosticsを確認して再試行してください。'];
  return { id, message: base[0], action: base[1], detail: detail ? String(detail).slice(0, 240) : null };
}

module.exports = {
  COLLECTOR_VERSION,
  TAB_KEYS,
  ERROR_CATALOG,
  DEFAULT_TRACKER_SETTINGS,
  normalizeTrackerSettings,
  normalizeBounds,
  normalizeCalibration,
  calibrationFits,
  normalizedPointToPermille,
  sampleDifference,
  evaluateBottom,
  estimateRequiredBytes,
  isSafeChildPath,
  errorInfo
};
