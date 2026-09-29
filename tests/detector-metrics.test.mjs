import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const metrics = require('../js/detector-metrics.js');

{
  const auto = [{ start: 10, end: 16, review_tier: 'primary' }];
  const corrected = [{ start: 12.2, end: 13.0, source: 'edited', feedback_label: 'fight', review_tier: 'primary' }];
  const result = metrics.evaluate(auto, corrected);
  assert.equal(result.tp, 0, 'very broad scene must not become a strict TP after human boundary correction');
  assert.equal(result.fp, 1);
  assert.equal(result.fn, 1);
  assert.equal(result.looseRecall, 1, 'loose recall should show that the event was roughly found');
  assert.ok(result.meanBoundaryErrorMs > 1000, 'boundary error should expose the poor scene boundary');
}

{
  const auto = [
    { start: 4.0, end: 5.0, review_tier: 'primary' },
    { start: 4.1, end: 5.1, review_tier: 'weak' }
  ];
  const corrected = [{ start: 4.05, end: 5.05, source: 'edited', feedback_label: 'kill', review_tier: 'primary' }];
  const result = metrics.evaluate(auto, corrected);
  assert.equal(result.tp, 1);
  assert.equal(result.fp, 1, 'duplicate auto scene must remain visible as a false positive');
  assert.equal(result.duplicatePredictions, 1);
  assert.equal(result.splitTruths, 1);
}

{
  const auto = [{ start: 1, end: 2, review_tier: 'primary' }];
  const corrected = [];
  const result = metrics.evaluate(auto, corrected);
  assert.equal(result.tp, 0);
  assert.equal(result.fp, 1, 'deleted false-positive scene must still count through auto-scenes ground truth comparison');
  assert.equal(result.fn, 0);
}

{
  const auto = [];
  const corrected = [{ start: 7, end: 8, source: 'manual', feedback_label: 'death', review_tier: 'manual' }];
  const result = metrics.evaluate(auto, corrected);
  assert.equal(result.tp, 0);
  assert.equal(result.fp, 0);
  assert.equal(result.fn, 1, 'manual valid scene is a detector miss');
}

console.log('Detector temporal metrics regression tests passed.');
