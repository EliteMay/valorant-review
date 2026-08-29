(() => {
  const baseDetector = window.VReviewSceneDetection;
  if (!baseDetector || typeof baseDetector.detect !== 'function') {
    console.error('VReview Detector v0.4.3: base detector v0.4.2 is not loaded.');
    return;
  }

  const PROFILE = {
    low: { extraPreRoll: 0.65, longSceneLimit: 9.5, focusWindow: 6.2 },
    standard: { extraPreRoll: 0.90, longSceneLimit: 8.8, focusWindow: 5.8 },
    high: { extraPreRoll: 1.10, longSceneLimit: 8.4, focusWindow: 6.2 }
  };

  async function detect(file, options = {}) {
    const result = await baseDetector.detect(file, options);
    const duration = Math.max(0, Number(options.duration || 0));
    const sensitivityName = options.sensitivity || result.sensitivity || 'standard';
    const profile = PROFILE[sensitivityName] || PROFILE.standard;
    const events = Array.isArray(result?.diagnosticData?.events)
      ? [...result.diagnosticData.events].sort((a, b) => Number(a.time) - Number(b.time))
      : [];

    const refinement = refineScenes(result.scenes || [], events, duration, profile);

    result.scenes = refinement.scenes;
    result.detectorVersion = '0.4.3';
    result.diagnostics = {
      ...(result.diagnostics || {}),
      baseDetectorVersion: '0.4.2',
      refinerVersion: '0.4.3',
      refinedSceneCount: refinement.scenes.length,
      droppedSceneCount: refinement.dropped.length,
      adjustedSceneCount: refinement.adjusted.length,
      refinerProfile: { ...profile }
    };
    result.diagnosticData = {
      ...(result.diagnosticData || {}),
      refiner: {
        dropped: refinement.dropped,
        adjusted: refinement.adjusted
      }
    };

    return result;
  }

  function refineScenes(inputScenes, events, duration, profile) {
    const scenes = [];
    const dropped = [];
    const adjusted = [];

    for (let index = 0; index < inputScenes.length; index++) {
      const original = { ...inputScenes[index] };
      const start = clamp(Number(original.start || 0), 0, duration);
      const end = clamp(Number(original.end || 0), 0, duration);
      if (!(end > start)) continue;

      const sceneEvents = events.filter(event => event.time >= start - 0.15 && event.time <= end + 0.15);
      const evidence = summarizeEvidence(sceneEvents, events);

      if (shouldDropScene(original, evidence)) {
        dropped.push({
          index: index + 1,
          start: round(start, 3),
          end: round(end, 3),
          reason: 'no-shot-and-no-local-kill-confirmation',
          shotEvidenceCount: Number(original.shotEvidenceCount || 0),
          localKillConfirmCount: evidence.localKillConfirmCount,
          verifiedKillfeedCount: evidence.verifiedKillfeedCount
        });
        continue;
      }

      let nextStart = start;
      let nextEnd = end;
      let reason = 'pre-roll-expanded';
      const span = end - start;

      if (span > profile.longSceneLimit && sceneEvents.length) {
        const focus = findBestFocusWindow(start, end, sceneEvents, profile.focusWindow);
        if (focus) {
          nextStart = clamp(focus.start - 0.60, 0, duration);
          nextEnd = clamp(focus.end + 0.40, nextStart + 1.0, duration);
          reason = 'long-scene-focus-window';
        }
      } else {
        nextStart = clamp(start - profile.extraPreRoll, 0, duration);
      }

      const refined = {
        ...original,
        start: nextStart,
        end: nextEnd,
        originalStart: start,
        originalEnd: end,
        refinerReason: reason,
        detectorReason: `${original.detectorReason || 'auto'}+v043`
      };
      scenes.push(refined);

      if (Math.abs(nextStart - start) > 0.001 || Math.abs(nextEnd - end) > 0.001) {
        adjusted.push({
          index: index + 1,
          originalStart: round(start, 3),
          originalEnd: round(end, 3),
          refinedStart: round(nextStart, 3),
          refinedEnd: round(nextEnd, 3),
          reason
        });
      }
    }

    return { scenes: mergeRefinedScenes(scenes, duration), dropped, adjusted };
  }

  function shouldDropScene(scene, evidence) {
    const shotCount = Number(scene.shotEvidenceCount || 0);
    if (shotCount > 0) return false;

    if (evidence.localKillConfirmCount > 0) return false;
    if (evidence.verifiedKillfeedCount > 0) return false;

    if (scene.detectorReason === 'killfeed-with-shots' && evidence.combatSupportCount >= 3) return false;

    return true;
  }

  function summarizeEvidence(sceneEvents, allEvents) {
    let localKillConfirmCount = 0;
    let verifiedKillfeedCount = 0;
    let combatSupportCount = 0;

    for (const event of sceneEvents) {
      if (event.kind === 'combat-support') combatSupportCount++;

      if (event.kind === 'kill-confirm') {
        const strongLocal = Number(event.killfeed || 0) >= 0.68
          && (Number(event.audio || 0) >= 0.30 || Number(event.ammo || 0) >= 0.45);
        if (strongLocal) localKillConfirmCount++;
      }

      if (event.kind === 'killfeed-support') {
        const nearShot = allEvents.some(other => other.kind === 'shot-hud' && Math.abs(Number(other.time) - Number(event.time)) <= 1.35);
        const nearbyCombat = allEvents.filter(other => other.kind === 'combat-support' && Math.abs(Number(other.time) - Number(event.time)) <= 1.05).length;
        if (nearShot || nearbyCombat >= 2) verifiedKillfeedCount++;
      }
    }

    return { localKillConfirmCount, verifiedKillfeedCount, combatSupportCount };
  }

  function findBestFocusWindow(sceneStart, sceneEnd, events, windowSize) {
    const span = sceneEnd - sceneStart;
    if (!(span > windowSize)) return { start: sceneStart, end: sceneEnd };

    let best = null;
    const step = 0.10;
    const latestStart = sceneEnd - windowSize;

    for (let start = sceneStart; start <= latestStart + 0.0001; start += step) {
      const end = start + windowSize;
      const score = scoreWindow(events, start, end);
      if (!best || score > best.score) best = { start, end, score };
    }

    return best;
  }

  function scoreWindow(events, start, end) {
    let score = 0;
    for (const event of events) {
      if (event.time < start || event.time > end) continue;

      const kindWeight = event.kind === 'shot-hud' ? 2.4
        : event.kind === 'combat-support' ? 1.30
          : event.kind === 'killfeed-support' ? 1.20
            : event.kind === 'kill-confirm' ? 0.22
              : 0;

      score += kindWeight;
      score += Math.min(Number(event.audio || 0), 1.5) * 0.70;
      score += Math.min(Number(event.center || 0), 1.5) * 0.15;
      score -= Math.min(Number(event.topCenter || 0), 2.2) * 0.08;
    }
    return score;
  }

  function mergeRefinedScenes(scenes, duration) {
    if (!scenes.length) return [];
    const sorted = [...scenes].sort((a, b) => a.start - b.start);
    const merged = [{ ...sorted[0] }];

    for (let i = 1; i < sorted.length; i++) {
      const scene = sorted[i];
      const last = merged[merged.length - 1];
      const unionStart = Math.min(last.start, scene.start);
      const unionEnd = Math.max(last.end, scene.end);

      if (scene.start <= last.end + 0.18 && unionEnd - unionStart <= 8.8) {
        last.start = unionStart;
        last.end = clamp(unionEnd, 0, duration);
        last.confidence = Math.max(Number(last.confidence || 0), Number(scene.confidence || 0));
        last.anchorCount = Number(last.anchorCount || 0) + Number(scene.anchorCount || 0);
        last.shotEvidenceCount = Number(last.shotEvidenceCount || 0) + Number(scene.shotEvidenceCount || 0);
        last.refinerReason = `${last.refinerReason || 'refined'}+merged`;
      } else {
        merged.push({ ...scene });
      }
    }

    return merged;
  }

  function round(value, digits) {
    const number = Number(value || 0);
    const power = 10 ** digits;
    return Math.round(number * power) / power;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  window.VReviewSceneDetection = { detect };
})();
