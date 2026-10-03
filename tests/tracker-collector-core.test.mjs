import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../electron/tracker-collector/core.cjs');

const settings = core.normalizeTrackerSettings({
  maxCaptures: 999,
  stableWaitMs: 10,
  scrollStepRatio: 0.2,
  browserTarget: 'unknown'
});
assert.equal(settings.maxCaptures, 100);
assert.equal(settings.stableWaitMs, 250);
assert.equal(settings.scrollStepRatio, 0.65);
assert.equal(settings.browserTarget, 'chrome');

const calibration = core.normalizeCalibration({
  trackerProfileVersion: 1,
  geometry: { x: 100, y: 80, width: 1600, height: 900, scaleFactor: 1.25 },
  points: {
    scoreboard: { x: 0.2, y: 0.15 },
    performance: { x: 0.35, y: 0.15 },
    economy: { x: 0.5, y: 0.15 },
    rounds: { x: 0.65, y: 0.15 },
    duels: { x: 0.8, y: 0.15 }
  }
});
assert.ok(calibration);
assert.equal(core.calibrationFits(calibration, { width: 1680, height: 920, scaleFactor: 1.25 }), true);
assert.equal(core.calibrationFits(calibration, { width: 1920, height: 1080, scaleFactor: 1.25 }), false);
assert.deepEqual(core.normalizedPointToPermille({ x: 0.1234, y: 0.9876 }), { x: 1234, y: 9876 });

const same = Buffer.alloc(4000, 50);
const changed = Buffer.alloc(4000, 240);
let result = core.evaluateBottom(same, same, 0);
assert.equal(result.atBottom, false);
result = core.evaluateBottom(same, same, result.streak);
assert.equal(result.atBottom, true);
assert.ok(core.sampleDifference(same, changed) > 0.5);

const required = core.estimateRequiredBytes({ width: 1920, height: 1080, scaleFactor: 1 }, 20);
assert.ok(required > 512 * 1024 * 1024);

const root = path.resolve('tmp', 'collector-root');
assert.equal(core.isSafeChildPath(root, path.join(root, 'session-a')), true);
assert.equal(core.isSafeChildPath(root, path.resolve(root, '..', 'outside')), false);

assert.equal(core.errorInfo('TC-FOCUS-001').id, 'TC-FOCUS-001');
assert.match(core.errorInfo('TC-FOCUS-001').action, /ブラウザ/);

console.log('Tracker Collector core tests passed.');
