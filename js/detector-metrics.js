(function attach(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.VReviewDetectorMetrics = api;
})(typeof window !== 'undefined' ? window : null, () => {
  const USEFUL = new Set(['kill', 'death', 'fight']);
  const STRICT_IOU = 0.30;
  const LOOSE_TRUTH_COVERAGE = 0.25;
  const LOOSE_CENTER_SECONDS = 0.75;
  const STRUCTURE_OVERLAP = 0.10;

  function evaluate(autoScenes = [], correctedScenes = []) {
    const predictions = normalizeScenes(autoScenes, false);
    const truth = normalizeScenes(correctedScenes, true).filter(scene => USEFUL.has(scene.label));
    const unreviewed = normalizeScenes(correctedScenes, true).filter(scene => scene.label === 'unreviewed').length;

    const strict = greedyMatch(predictions, truth, pair => pair.iou >= STRICT_IOU, pair => pair.iou);
    const loose = greedyMatch(
      predictions,
      truth,
      pair => pair.truthCoverage >= LOOSE_TRUTH_COVERAGE || pair.centerDistance <= LOOSE_CENTER_SECONDS,
      pair => pair.truthCoverage * 0.7 + pair.iou * 0.3 - Math.min(pair.centerDistance, 3) * 0.01
    );

    const primaryPredictions = predictions.filter(scene => scene.tier !== 'weak');
    const weakPredictions = predictions.filter(scene => scene.tier === 'weak');
    const primary = greedyMatch(primaryPredictions, truth, pair => pair.iou >= STRICT_IOU, pair => pair.iou);
    const weak = greedyMatch(weakPredictions, truth, pair => pair.iou >= STRICT_IOU, pair => pair.iou);

    const boundary = boundaryStats(loose.matches);
    const structure = structureStats(predictions, truth);

    return {
      mode: 'temporal-ground-truth-v1',
      thresholds: {
        strictIou: STRICT_IOU,
        looseTruthCoverage: LOOSE_TRUTH_COVERAGE,
        looseCenterSeconds: LOOSE_CENTER_SECONDS
      },
      predictions: predictions.length,
      truth: truth.length,
      unreviewed,
      tp: strict.matches.length,
      fp: strict.unmatchedPredictions.length,
      fn: strict.unmatchedTruth.length,
      precision: ratio(strict.matches.length, predictions.length),
      recall: ratio(strict.matches.length, truth.length),
      looseTp: loose.matches.length,
      looseRecall: ratio(loose.matches.length, truth.length),
      primaryPredictions: primaryPredictions.length,
      primaryMatches: primary.matches.length,
      primaryPrecision: ratio(primary.matches.length, primaryPredictions.length),
      weakPredictions: weakPredictions.length,
      weakUseful: weak.matches.length,
      boundaryMatchCount: loose.matches.length,
      duplicatePredictions: structure.duplicatePredictions,
      mergedPredictions: structure.mergedPredictions,
      splitTruths: structure.splitTruths,
      meanStartErrorMs: boundary.meanStartErrorMs,
      meanEndErrorMs: boundary.meanEndErrorMs,
      meanBoundaryErrorMs: boundary.meanBoundaryErrorMs,
      medianIou: median(strict.matches.map(match => match.iou)),
      strictMatches: strict.matches
    };
  }

  function normalizeScenes(items, includeLabels) {
    return (Array.isArray(items) ? items : []).map((scene, index) => {
      const start = Number(scene?.start);
      const end = Number(scene?.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
      const source = String(scene?.source || '');
      const label = includeLabels ? String(scene?.feedback_label || scene?.feedbackLabel || 'unreviewed') : null;
      const tier = String(scene?.review_tier || scene?.reviewTier || (source === 'manual' ? 'manual' : 'primary'));
      return {
        index,
        start,
        end,
        source,
        label,
        tier,
        duration: end - start
      };
    }).filter(Boolean);
  }

  function greedyMatch(predictions, truth, accept, score) {
    const pairs = [];
    for (let pi = 0; pi < predictions.length; pi++) {
      for (let ti = 0; ti < truth.length; ti++) {
        const pair = compare(predictions[pi], truth[ti], pi, ti);
        if (!accept(pair)) continue;
        pairs.push({ ...pair, score: score(pair) });
      }
    }
    pairs.sort((a, b) => b.score - a.score || b.iou - a.iou || a.centerDistance - b.centerDistance);

    const usedPredictions = new Set();
    const usedTruth = new Set();
    const matches = [];
    for (const pair of pairs) {
      if (usedPredictions.has(pair.predictionIndex) || usedTruth.has(pair.truthIndex)) continue;
      usedPredictions.add(pair.predictionIndex);
      usedTruth.add(pair.truthIndex);
      matches.push(pair);
    }

    return {
      matches,
      unmatchedPredictions: predictions.filter((_item, index) => !usedPredictions.has(index)),
      unmatchedTruth: truth.filter((_item, index) => !usedTruth.has(index))
    };
  }

  function compare(prediction, truth, predictionIndex, truthIndex) {
    const intersection = Math.max(0, Math.min(prediction.end, truth.end) - Math.max(prediction.start, truth.start));
    const union = Math.max(prediction.end, truth.end) - Math.min(prediction.start, truth.start);
    const predictionCenter = (prediction.start + prediction.end) / 2;
    const truthCenter = (truth.start + truth.end) / 2;
    return {
      predictionIndex,
      truthIndex,
      prediction,
      truth,
      intersection,
      iou: union > 0 ? intersection / union : 0,
      truthCoverage: truth.duration > 0 ? intersection / truth.duration : 0,
      predictionCoverage: prediction.duration > 0 ? intersection / prediction.duration : 0,
      centerDistance: Math.abs(predictionCenter - truthCenter),
      startErrorMs: Math.abs(prediction.start - truth.start) * 1000,
      endErrorMs: Math.abs(prediction.end - truth.end) * 1000
    };
  }

  function boundaryStats(matches) {
    if (!matches.length) {
      return { meanStartErrorMs: null, meanEndErrorMs: null, meanBoundaryErrorMs: null };
    }
    const start = mean(matches.map(item => item.startErrorMs));
    const end = mean(matches.map(item => item.endErrorMs));
    return {
      meanStartErrorMs: start,
      meanEndErrorMs: end,
      meanBoundaryErrorMs: (start + end) / 2
    };
  }

  function structureStats(predictions, truth) {
    const truthToPredictionCount = truth.map(target =>
      predictions.filter(prediction => compare(prediction, target, 0, 0).iou >= STRUCTURE_OVERLAP).length
    );
    const predictionToTruthCount = predictions.map(prediction =>
      truth.filter(target => compare(prediction, target, 0, 0).iou >= STRUCTURE_OVERLAP).length
    );
    return {
      duplicatePredictions: truthToPredictionCount.reduce((sum, count) => sum + Math.max(0, count - 1), 0),
      splitTruths: truthToPredictionCount.filter(count => count > 1).length,
      mergedPredictions: predictionToTruthCount.filter(count => count > 1).length
    };
  }

  function mean(values) {
    const valid = values.filter(Number.isFinite);
    return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
  }

  function median(values) {
    const valid = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!valid.length) return null;
    const middle = Math.floor(valid.length / 2);
    return valid.length % 2 ? valid[middle] : (valid[middle - 1] + valid[middle]) / 2;
  }

  function ratio(a, b) {
    return b > 0 ? a / b : null;
  }

  return Object.freeze({ evaluate });
});
