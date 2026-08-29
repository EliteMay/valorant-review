(() => {
  const previousDetector = window.VReviewSceneDetection;
  if (!previousDetector || typeof previousDetector.detect !== 'function') {
    console.error('VReview Detector v0.4.4: v0.4.3 is not loaded.');
    return;
  }

  const PROFILE = {
    low: { recoveredConfidence: 0.42, tailPad: 0.45 },
    standard: { recoveredConfidence: 0.46, tailPad: 0.55 },
    high: { recoveredConfidence: 0.52, tailPad: 0.65 }
  };

  async function detect(file, options = {}) {
    const result = await previousDetector.detect(file, options);
    const duration = Math.max(0, Number(options.duration || 0));
    const sensitivityName = options.sensitivity || result.sensitivity || 'standard';
    const profile = PROFILE[sensitivityName] || PROFILE.standard;
    const events = Array.isArray(result?.diagnosticData?.events)
      ? [...result.diagnosticData.events].sort((a, b) => Number(a.time) - Number(b.time))
      : [];

    const guard = applyRecallGuard(
      result.scenes || [],
      result?.diagnosticData?.refiner || {},
      events,
      duration,
      profile
    );

    result.scenes = guard.scenes;
    result.detectorVersion = '0.4.4';
    result.diagnostics = {
      ...(result.diagnostics || {}),
      previousDetectorVersion: '0.4.3',
      recallGuardVersion: '0.4.4',
      recoveredSceneCount: guard.recovered.length,
      expandedTailCount: guard.expanded.length,
      recallGuardProfile: { ...profile }
    };
    result.diagnosticData = {
      ...(result.diagnosticData || {}),
      recallGuard: {
        recovered: guard.recovered,
        expanded: guard.expanded
      }
    };

    return result;
  }

  function applyRecallGuard(inputScenes, refinerData, events, duration, profile) {
    let scenes = (Array.isArray(inputScenes) ? inputScenes : []).map(scene => ({ ...scene }));
    const recovered = [];
    const expanded = [];

    const adjustments = Array.isArray(refinerData.adjusted) ? refinerData.adjusted : [];
    for (const adjustment of adjustments) {
      if (adjustment.reason !== 'long-scene-focus-window') continue;

      const current = findClosestScene(scenes, adjustment.refinedStart, adjustment.refinedEnd);
      if (!current) continue;

      const omittedStart = Math.max(Number(current.end || 0), Number(adjustment.refinedEnd || 0));
      const omittedEnd = Number(adjustment.originalEnd || omittedStart);
      if (!(omittedEnd > omittedStart + 0.15)) continue;

      const omittedEvents = events.filter(event =>
        Number(event.time) >= omittedStart - 0.05 &&
        Number(event.time) <= omittedEnd + 0.05
      );

      const tailEvidence = summarizeTailEvidence(omittedEvents);
      if (!tailEvidence.shouldRecover) continue;

      const oldEnd = Number(current.end || 0);
      current.end = clamp(omittedEnd + profile.tailPad, current.start + 0.9, duration);
      current.detectorReason = `${current.detectorReason || 'auto'}+tail-recovery`;
      current.recallGuard = 'tail-recovery';

      expanded.push({
        originalIndex: Number(adjustment.index || 0),
        previousEnd: round(oldEnd, 3),
        recoveredEnd: round(current.end, 3),
        omittedStart: round(omittedStart, 3),
        omittedEnd: round(omittedEnd, 3),
        evidence: tailEvidence
      });
    }

    const dropped = Array.isArray(refinerData.dropped) ? refinerData.dropped : [];
    for (const item of dropped) {
      const start = clamp(Number(item.start || 0), 0, duration);
      const end = clamp(Number(item.end || 0), 0, duration);
      if (!(end > start)) continue;
      if (overlapsExistingScene(scenes, start, end, 0.62)) continue;

      const localEvents = events.filter(event =>
        Number(event.time) >= start - 0.25 &&
        Number(event.time) <= end + 0.25
      );
      const evidence = summarizeCandidateEvidence(localEvents);
      if (localEvents.length === 0) continue;

      const confidence = clamp(
        profile.recoveredConfidence +
          Math.min(evidence.killConfirmCount, 2) * 0.025 +
          Math.min(evidence.killfeedCount, 2) * 0.02 +
          Math.min(evidence.combatCount, 4) * 0.01,
        0.42,
        0.59
      );

      scenes.push({
        start,
        end,
        confidence,
        source: 'auto',
        fps: 'auto',
        detectorReason: 'recovered-low-confidence',
        anchorCount: evidence.killConfirmCount + evidence.killfeedCount,
        shotEvidenceCount: evidence.shotCount,
        needsReview: true,
        recallGuard: 'recovered-v043-drop'
      });

      recovered.push({
        originalIndex: Number(item.index || 0),
        start: round(start, 3),
        end: round(end, 3),
        confidence: round(confidence, 4),
        previousDropReason: item.reason || null,
        evidence
      });
    }

    scenes = mergeNearDuplicates(scenes, duration);
    scenes.sort((a, b) => Number(a.start) - Number(b.start));
    return { scenes, recovered, expanded };
  }

  function summarizeTailEvidence(events) {
    const shotTimes = events.filter(event => event.kind === 'shot-hud').map(event => Number(event.time));
    const killConfirm = events.filter(event => event.kind === 'kill-confirm');
    const killfeed = events.filter(event => event.kind === 'killfeed-support');

    const denseShotCluster = hasDenseCluster(shotTimes, 3, 1.35);
    const supportedKillCluster = killConfirm.some(event =>
      Number(event.audio || 0) >= 0.75 &&
      Number(event.killfeed || 0) >= 0.70 &&
      Number(event.ammo || 0) >= 0.65
    );
    const multipleKillSignals = killConfirm.filter(event =>
      Number(event.audio || 0) >= 0.45 ||
      Number(event.ammo || 0) >= 0.80 ||
      Number(event.killfeed || 0) >= 0.90
    ).length >= 2 && (shotTimes.length >= 1 || killfeed.length >= 1);

    return {
      shouldRecover: denseShotCluster || supportedKillCluster || multipleKillSignals,
      shotCount: shotTimes.length,
      killConfirmCount: killConfirm.length,
      killfeedCount: killfeed.length,
      denseShotCluster,
      supportedKillCluster,
      multipleKillSignals
    };
  }

  function summarizeCandidateEvidence(events) {
    const killConfirm = events.filter(event => event.kind === 'kill-confirm');
    const killfeed = events.filter(event => event.kind === 'killfeed-support');
    const shot = events.filter(event => event.kind === 'shot-hud');
    const combat = events.filter(event => event.kind === 'combat-support');

    return {
      eventCount: events.length,
      killConfirmCount: killConfirm.length,
      killfeedCount: killfeed.length,
      shotCount: shot.length,
      combatCount: combat.length,
      maxKillConfirm: round(maxOf(events, 'killConfirm'), 4),
      maxKillfeed: round(maxOf(events, 'killfeed'), 4),
      maxAmmo: round(maxOf(events, 'ammo'), 4),
      maxAudio: round(maxOf(events, 'audio'), 4),
      maxCenter: round(maxOf(events, 'center'), 4)
    };
  }

  function findClosestScene(scenes, start, end) {
    let best = null;
    let bestDistance = Infinity;
    for (const scene of scenes) {
      const distance =
        Math.abs(Number(scene.start || 0) - Number(start || 0)) +
        Math.abs(Number(scene.end || 0) - Number(end || 0));
      if (distance < bestDistance) {
        best = scene;
        bestDistance = distance;
      }
    }
    return bestDistance <= 2.5 ? best : null;
  }

  function overlapsExistingScene(scenes, start, end, ratioThreshold) {
    for (const scene of scenes) {
      const left = Math.max(start, Number(scene.start || 0));
      const right = Math.min(end, Number(scene.end || 0));
      const overlap = Math.max(0, right - left);
      const shorter = Math.min(end - start, Number(scene.end || 0) - Number(scene.start || 0));
      if (shorter > 0 && overlap / shorter >= ratioThreshold) return true;
    }
    return false;
  }

  function mergeNearDuplicates(scenes, duration) {
    if (!scenes.length) return [];
    const sorted = [...scenes].sort((a, b) => Number(a.start) - Number(b.start));
    const output = [];

    for (const scene of sorted) {
      const last = output[output.length - 1];
      if (!last) {
        output.push({ ...scene });
        continue;
      }

      const intersection = Math.max(
        0,
        Math.min(Number(last.end), Number(scene.end)) -
          Math.max(Number(last.start), Number(scene.start))
      );
      const shorter = Math.min(
        Number(last.end) - Number(last.start),
        Number(scene.end) - Number(scene.start)
      );
      const overlapRatio = shorter > 0 ? intersection / shorter : 0;

      if (overlapRatio >= 0.72) {
        const stronger = Number(last.confidence || 0) >= Number(scene.confidence || 0) ? last : scene;
        const weaker = stronger === last ? scene : last;
        stronger.start = Math.min(Number(last.start), Number(scene.start));
        stronger.end = clamp(Math.max(Number(last.end), Number(scene.end)), 0, duration);
        stronger.confidence = Math.max(Number(last.confidence || 0), Number(scene.confidence || 0));
        stronger.anchorCount = Math.max(Number(last.anchorCount || 0), Number(scene.anchorCount || 0));
        stronger.shotEvidenceCount = Math.max(Number(last.shotEvidenceCount || 0), Number(scene.shotEvidenceCount || 0));
        if (weaker.needsReview && !stronger.needsReview) stronger.recallGuardMergedCandidate = true;
        output[output.length - 1] = { ...stronger };
      } else {
        output.push({ ...scene });
      }
    }

    return output;
  }

  function hasDenseCluster(times, minCount, windowSeconds) {
    if (times.length < minCount) return false;
    const sorted = [...times].sort((a, b) => a - b);
    let left = 0;
    for (let right = 0; right < sorted.length; right++) {
      while (sorted[right] - sorted[left] > windowSeconds) left++;
      if (right - left + 1 >= minCount) return true;
    }
    return false;
  }

  function maxOf(events, key) {
    let max = 0;
    for (const event of events) max = Math.max(max, Number(event[key] || 0));
    return max;
  }

  function round(value, digits) {
    const n = Number(value || 0);
    const p = 10 ** digits;
    return Math.round(n * p) / p;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  window.VReviewSceneDetection = { detect };
})();