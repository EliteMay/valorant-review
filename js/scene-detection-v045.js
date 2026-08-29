(() => {
  const previousDetector = window.VReviewSceneDetection;
  if (!previousDetector || typeof previousDetector.detect !== 'function') {
    console.error('VReview Detector v0.4.5: v0.4.4 is not loaded.');
    return;
  }

  async function detect(file, options = {}) {
    const result = await previousDetector.detect(file, options);
    const events = Array.isArray(result?.diagnosticData?.events)
      ? result.diagnosticData.events
      : [];

    const classified = (result.scenes || []).map((scene, index) => {
      const evidence = summarizeScene(scene, events);
      const tier = classifyScene(scene, evidence);
      return {
        ...scene,
        reviewTier: tier.tier,
        needsReview: tier.tier === 'weak' || Boolean(scene.needsReview),
        weakReason: tier.reason,
        classifierEvidence: evidence,
        classifierIndex: index + 1
      };
    });

    const primary = classified.filter(scene => scene.reviewTier !== 'weak');
    const weak = classified.filter(scene => scene.reviewTier === 'weak');

    result.scenes = classified;
    result.detectorVersion = '0.4.5';
    result.diagnostics = {
      ...(result.diagnostics || {}),
      candidateClassifierVersion: '0.4.5',
      primarySceneCount: primary.length,
      weakSceneCount: weak.length
    };
    result.diagnosticData = {
      ...(result.diagnosticData || {}),
      candidateClassifier: {
        primary: primary.map(toDiagnostic),
        weak: weak.map(toDiagnostic)
      }
    };
    return result;
  }

  function classifyScene(scene, evidence) {
    const reason = String(scene.detectorReason || '');
    const shotEvidence = Number(scene.shotEvidenceCount || 0);

    if (reason.includes('recovered-low-confidence')) {
      const strongRecovered =
        evidence.shotCount >= 1 ||
        evidence.combatCount >= 2 ||
        (evidence.killfeedCount >= 1 && evidence.maxAudio >= 0.45 && evidence.maxCenter >= 0.65);

      return strongRecovered
        ? { tier: 'primary', reason: 'recovered-with-combat-support' }
        : { tier: 'weak', reason: 'recovered-without-combat-support' };
    }

    if (shotEvidence <= 0) {
      return { tier: 'weak', reason: 'no-shot-evidence' };
    }

    return { tier: 'primary', reason: 'normal' };
  }

  function summarizeScene(scene, events) {
    const start = Number(scene.start || 0);
    const end = Number(scene.end || 0);
    const local = events.filter(event => Number(event.time) >= start - 0.05 && Number(event.time) <= end + 0.05);
    const counts = { shotCount: 0, combatCount: 0, killfeedCount: 0, killConfirmCount: 0 };
    let maxAudio = 0, maxCenter = 0, maxKillfeed = 0, maxAmmo = 0, maxKillConfirm = 0;

    for (const event of local) {
      if (event.kind === 'shot-hud') counts.shotCount++;
      else if (event.kind === 'combat-support') counts.combatCount++;
      else if (event.kind === 'killfeed-support') counts.killfeedCount++;
      else if (event.kind === 'kill-confirm') counts.killConfirmCount++;

      maxAudio = Math.max(maxAudio, Number(event.audio || 0));
      maxCenter = Math.max(maxCenter, Number(event.center || 0));
      maxKillfeed = Math.max(maxKillfeed, Number(event.killfeed || 0));
      maxAmmo = Math.max(maxAmmo, Number(event.ammo || 0));
      maxKillConfirm = Math.max(maxKillConfirm, Number(event.killConfirm || 0));
    }

    return {
      eventCount: local.length,
      ...counts,
      maxAudio: round(maxAudio, 4),
      maxCenter: round(maxCenter, 4),
      maxKillfeed: round(maxKillfeed, 4),
      maxAmmo: round(maxAmmo, 4),
      maxKillConfirm: round(maxKillConfirm, 4)
    };
  }

  function toDiagnostic(scene) {
    return {
      index: Number(scene.classifierIndex || 0),
      start: round(scene.start, 3),
      end: round(scene.end, 3),
      tier: scene.reviewTier || 'primary',
      weakReason: scene.weakReason || null,
      detectorReason: scene.detectorReason || null,
      confidence: Number.isFinite(scene.confidence) ? round(scene.confidence, 4) : null,
      evidence: scene.classifierEvidence || null
    };
  }

  function round(value, digits) {
    const p = 10 ** digits;
    return Math.round(Number(value || 0) * p) / p;
  }

  window.VReviewSceneDetection = { detect };
})();
