window.VReviewSceneDetection = (() => {
  const VERSION = '0.5.0';

  const SENSITIVITY = {
    low: {
      audioMedium: 0.48, centerMedium: 0.34, crestGate: 2.25,
      killfeedGate: 1.05, killfeedAbsolute: 0.012, killfeedRatio: 1.12,
      ammoGate: 0.92, ammoAbsolute: 0.009, ammoRatio: 1.06, ammoAudioMin: 0.56,
      killConfirmGate: 0.98, killConfirmAbsolute: 0.010, killConfirmRatio: 1.08,
      killConfirmAudioMin: 0.34, killfeedShotWindow: 1.55,
      topCenterBlock: 1.10, topCenterAudioMax: 0.24
    },
    standard: {
      audioMedium: 0.38, centerMedium: 0.27, crestGate: 2.00,
      killfeedGate: 0.82, killfeedAbsolute: 0.008, killfeedRatio: 1.07,
      ammoGate: 0.72, ammoAbsolute: 0.006, ammoRatio: 1.03, ammoAudioMin: 0.44,
      killConfirmGate: 0.76, killConfirmAbsolute: 0.0065, killConfirmRatio: 1.04,
      killConfirmAudioMin: 0.24, killfeedShotWindow: 1.85,
      topCenterBlock: 0.98, topCenterAudioMax: 0.20
    },
    high: {
      audioMedium: 0.30, centerMedium: 0.21, crestGate: 1.85,
      killfeedGate: 0.66, killfeedAbsolute: 0.006, killfeedRatio: 1.04,
      ammoGate: 0.58, ammoAbsolute: 0.0045, ammoRatio: 1.01, ammoAudioMin: 0.34,
      killConfirmGate: 0.60, killConfirmAbsolute: 0.0045, killConfirmRatio: 1.02,
      killConfirmAudioMin: 0.18, killfeedShotWindow: 2.10,
      topCenterBlock: 1.12, topCenterAudioMax: 0.18
    }
  };

  const REFINER_PROFILE = {
    low: { extraPreRoll: 0.65, longSceneLimit: 9.5, focusWindow: 6.2 },
    standard: { extraPreRoll: 0.90, longSceneLimit: 8.8, focusWindow: 5.8 },
    high: { extraPreRoll: 1.10, longSceneLimit: 8.4, focusWindow: 6.2 }
  };

  const RECALL_PROFILE = {
    low: { recoveredConfidence: 0.42, tailPad: 0.45 },
    standard: { recoveredConfidence: 0.46, tailPad: 0.55 },
    high: { recoveredConfidence: 0.52, tailPad: 0.65 }
  };

  async function detect(file, options = {}) {
    if (!file) throw new Error('解析する動画がありません。');
    const duration = Math.max(0, Number(options.duration || 0));
    if (!duration) throw new Error('動画時間を取得できませんでした。');

    const sensitivityName = SENSITIVITY[options.sensitivity] ? options.sensitivity : 'standard';
    const sensitivity = SENSITIVITY[sensitivityName];
    const signal = options.signal || null;
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
    const warnings = [];
    if (duration > 120) warnings.push('長尺動画のため解析間隔を広げています。短いクリップより検出精度が下がる可能性があります。');

    throwIfAborted(signal);
    onProgress({ phase: 'audio', progress: 0.02, message: '音声を解析しています…' });
    let audio = [];
    try {
      audio = await analyzeAudio(file, duration, value => {
        onProgress({ phase: 'audio', progress: 0.02 + value * 0.24, message: '音声を解析しています…' });
      }, signal);
    } catch (error) {
      if (isAbortError(error)) throw error;
      warnings.push('音声解析を利用できなかったため、映像証拠を中心に検出しました。');
    }

    throwIfAborted(signal);
    onProgress({ phase: 'visual', progress: 0.27, message: 'HUDと画面変化を解析しています…' });
    const visual = await analyzeVisual(file, duration, value => {
      onProgress({ phase: 'visual', progress: 0.27 + value * 0.48, message: 'HUDと画面変化を解析しています…' });
    }, signal);

    throwIfAborted(signal);
    onProgress({ phase: 'evidence', progress: 0.77, message: '戦闘証拠を組み立てています…' });
    const evidenceResult = buildEvidence(audio, visual, sensitivity, duration);

    throwIfAborted(signal);
    const baseScenes = buildBaseScenes(evidenceResult.events, sensitivityName, sensitivity, duration);
    onProgress({ phase: 'refine', progress: 0.84, message: 'Scene範囲を調整しています…' });
    const refinement = refineScenes(baseScenes, evidenceResult.events, duration, REFINER_PROFILE[sensitivityName]);

    throwIfAborted(signal);
    onProgress({ phase: 'recall', progress: 0.90, message: '見逃し防止候補を確認しています…' });
    const guard = applyRecallGuard(
      refinement.scenes,
      refinement,
      evidenceResult.events,
      duration,
      RECALL_PROFILE[sensitivityName]
    );

    throwIfAborted(signal);
    onProgress({ phase: 'classify', progress: 0.96, message: '本命Sceneと要確認候補を分類しています…' });
    const classification = classifyScenes(guard.scenes, evidenceResult.events);

    const scenes = classification.scenes;
    onProgress({ phase: 'done', progress: 1, message: `${classification.primary.length}件の本命Scene、${classification.weak.length}件の要確認候補を検出しました。` });

    return {
      scenes,
      warnings,
      sensitivity: sensitivityName,
      detectorVersion: VERSION,
      diagnostics: {
        pipelineVersion: VERSION,
        audioSamples: audio.length,
        visualSamples: visual.length,
        eventCount: evidenceResult.events.length,
        suppressedCount: evidenceResult.suppressed.length,
        baseSceneCount: baseScenes.length,
        refinedSceneCount: refinement.scenes.length,
        droppedSceneCount: refinement.dropped.length,
        recoveredSceneCount: guard.recovered.length,
        expandedTailCount: guard.expanded.length,
        primarySceneCount: classification.primary.length,
        weakSceneCount: classification.weak.length,
        thresholds: { ...sensitivity }
      },
      diagnosticData: {
        audio: audio.map(cleanAudioSample),
        visual: visual.map(cleanVisualSample),
        events: evidenceResult.events.map(cleanEvent),
        suppressed: evidenceResult.suppressed.map(cleanEvent),
        refiner: { dropped: refinement.dropped, adjusted: refinement.adjusted },
        recallGuard: { recovered: guard.recovered, expanded: guard.expanded },
        candidateClassifier: {
          primary: classification.primary.map(toDiagnostic),
          weak: classification.weak.map(toDiagnostic)
        }
      }
    };
  }

  async function analyzeAudio(file, duration, onProgress, signal) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('Web Audio APIに対応していません。');
    const context = new AudioContextClass();
    try {
      throwIfAborted(signal);
      const buffer = await context.decodeAudioData(await file.arrayBuffer());
      throwIfAborted(signal);
      const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
      const sampleRate = buffer.sampleRate;
      const stepSeconds = duration > 120 ? 0.08 : 0.05;
      const windowSeconds = 0.035;
      const step = Math.max(1, Math.floor(sampleRate * stepSeconds));
      const windowSize = Math.max(1, Math.floor(sampleRate * windowSeconds));
      const length = Math.min(buffer.length, Math.floor(duration * sampleRate));
      const samples = [];
      let previousRms = 0;

      for (let start = 0, index = 0; start < length; start += step, index++) {
        if (index % 80 === 0) throwIfAborted(signal);
        const end = Math.min(length, start + windowSize);
        let sumSquares = 0, peak = 0, count = 0;
        for (let i = start; i < end; i += 2) {
          let value = 0;
          for (const channel of channels) value += Math.abs(channel[i] || 0);
          value /= Math.max(1, channels.length);
          sumSquares += value * value;
          peak = Math.max(peak, value);
          count++;
        }
        const rms = Math.sqrt(sumSquares / Math.max(1, count));
        samples.push({ time: start / sampleRate, rms, peak, rise: Math.max(0, rms - previousRms), crest: peak / Math.max(rms, 0.00001) });
        previousRms = rms;
        if (index % 90 === 0) onProgress(Math.min(1, start / Math.max(1, length)));
      }

      const rmsBase = percentile(samples.map(item => item.rms), 0.55);
      const rmsHigh = Math.max(percentile(samples.map(item => item.rms), 0.96), rmsBase + 0.0001);
      const riseHigh = Math.max(percentile(samples.map(item => item.rise), 0.94), 0.0001);
      for (const item of samples) {
        const loudness = clamp((item.rms - rmsBase) / (rmsHigh - rmsBase), 0, 1.8);
        const rise = clamp(item.rise / riseHigh, 0, 1.8);
        const crest = clamp((item.crest - 1.55) / 4.2, 0, 1.1);
        item.score = loudness * 0.54 + rise * 0.32 + crest * 0.14;
      }
      onProgress(1);
      return samples;
    } finally {
      await context.close().catch(() => {});
    }
  }

  async function analyzeVisual(file, duration, onProgress, signal) {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = url;

    try {
      await waitFor(video, 'loadeddata', 10000, signal);
      const canvas = document.createElement('canvas');
      const width = 160;
      const height = Math.max(80, Math.round(width * (video.videoHeight / Math.max(1, video.videoWidth))));
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('Canvasを初期化できませんでした。');

      const stepSeconds = duration <= 35 ? 0.12 : duration <= 75 ? 0.16 : duration <= 120 ? 0.22 : 0.30;
      const total = Math.max(1, Math.ceil(duration / stepSeconds));
      const samples = [];
      let previous = null;
      let index = 0;

      for (let time = 0; time < duration; time += stepSeconds, index++) {
        if (index % 8 === 0) throwIfAborted(signal);
        await seekVideo(video, Math.min(time, Math.max(0, duration - 0.02)), signal);
        ctx.drawImage(video, 0, 0, width, height);
        const data = ctx.getImageData(0, 0, width, height).data;
        const current = new Uint8Array(width * height);
        let cursor = 0;
        for (let i = 0; i < data.length; i += 4) current[cursor++] = Math.round(data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722);

        let motion = 0, centerMotion = 0, killfeedMotion = 0, ammoMotion = 0, killConfirmMotion = 0, topCenterMotion = 0;
        if (previous) {
          motion = regionDiff(current, previous, width, height, 0, 1, 0, 1, 2);
          centerMotion = regionDiff(current, previous, width, height, 0.18, 0.82, 0.16, 0.80, 2);
          killfeedMotion = regionDiff(current, previous, width, height, 0.66, 0.995, 0.035, 0.31, 1);
          ammoMotion = regionDiff(current, previous, width, height, 0.80, 0.985, 0.77, 0.985, 1);
          killConfirmMotion = regionDiff(current, previous, width, height, 0.42, 0.58, 0.70, 0.91, 1);
          topCenterMotion = regionDiff(current, previous, width, height, 0.31, 0.69, 0.00, 0.18, 1);
        }
        samples.push({ time, motion, centerMotion, killfeedMotion, ammoMotion, killConfirmMotion, topCenterMotion });
        previous = current;
        if (index % 10 === 0) onProgress(Math.min(1, index / total));
      }

      normalizeVisualScores(samples);
      onProgress(1);
      return samples;
    } finally {
      URL.revokeObjectURL(url);
      video.removeAttribute('src');
      video.load();
    }
  }

  function normalizeVisualScores(samples) {
    const motionHigh = Math.max(percentile(samples.map(item => item.motion), 0.92), 0.001);
    const centerHigh = Math.max(percentile(samples.map(item => item.centerMotion), 0.92), 0.001);
    const killfeedHigh = Math.max(percentile(samples.map(item => Math.max(0, item.killfeedMotion - item.motion * 0.76)), 0.90), 0.006);
    const ammoHigh = Math.max(percentile(samples.map(item => Math.max(0, item.ammoMotion - item.motion * 0.68)), 0.88), 0.005);
    const killConfirmHigh = Math.max(percentile(samples.map(item => Math.max(0, item.killConfirmMotion - item.motion * 0.62)), 0.88), 0.0045);
    const topCenterHigh = Math.max(percentile(samples.map(item => Math.max(0, item.topCenterMotion - item.motion * 0.72)), 0.90), 0.006);

    for (const item of samples) {
      const overallScore = clamp(item.motion / motionHigh, 0, 1.8);
      item.centerScore = clamp(item.centerMotion / centerHigh, 0, 1.8);
      item.killfeedExcess = Math.max(0, item.killfeedMotion - item.motion * 0.76);
      item.ammoExcess = Math.max(0, item.ammoMotion - item.motion * 0.68);
      item.killConfirmExcess = Math.max(0, item.killConfirmMotion - item.motion * 0.62);
      item.topCenterExcess = Math.max(0, item.topCenterMotion - item.motion * 0.72);
      item.killfeedRatio = item.killfeedMotion / Math.max(0.002, item.motion);
      item.ammoRatio = item.ammoMotion / Math.max(0.002, item.motion);
      item.killConfirmRatio = item.killConfirmMotion / Math.max(0.002, item.motion);
      item.killfeedScore = clamp(item.killfeedExcess / killfeedHigh, 0, 2.2);
      item.ammoScore = clamp(item.ammoExcess / ammoHigh, 0, 2.2);
      item.killConfirmScore = clamp(item.killConfirmExcess / killConfirmHigh, 0, 2.2);
      item.topCenterScore = clamp(item.topCenterExcess / topCenterHigh, 0, 2.2);
      item.score = overallScore * 0.24 + item.centerScore * 0.43 + item.ammoScore * 0.12 + item.killConfirmScore * 0.16 + item.killfeedScore * 0.05;
    }
  }

  function buildEvidence(audio, visual, sensitivity, duration) {
    const events = [], suppressed = [];
    const source = audio.length ? audio : visual.map(item => ({ time: item.time, score: 0, crest: 0 }));

    for (const sample of source) {
      const v = nearestByTime(visual, sample.time);
      if (!v) continue;
      const audioScore = sample.score || 0, crest = sample.crest || 0, centerScore = v.centerScore || 0;
      const killfeedScore = v.killfeedScore || 0, ammoScore = v.ammoScore || 0, killConfirmScore = v.killConfirmScore || 0, topCenterScore = v.topCenterScore || 0;
      const uiTransition = topCenterScore >= sensitivity.topCenterBlock && audioScore <= sensitivity.topCenterAudioMax && killConfirmScore < sensitivity.killConfirmGate;
      const killConfirm = v.killConfirmExcess >= sensitivity.killConfirmAbsolute && v.killConfirmRatio >= sensitivity.killConfirmRatio && killConfirmScore >= sensitivity.killConfirmGate && (audioScore >= sensitivity.killConfirmAudioMin || killfeedScore >= sensitivity.killfeedGate * 0.65 || ammoScore >= sensitivity.ammoGate * 0.65);
      const shotHud = v.ammoExcess >= sensitivity.ammoAbsolute && v.ammoRatio >= sensitivity.ammoRatio && ammoScore >= sensitivity.ammoGate && audioScore >= sensitivity.ammoAudioMin && centerScore >= sensitivity.centerMedium * 0.72;
      const killfeed = v.killfeedExcess >= sensitivity.killfeedAbsolute && v.killfeedRatio >= sensitivity.killfeedRatio && killfeedScore >= sensitivity.killfeedGate;
      const combatSupport = audioScore >= sensitivity.audioMedium && centerScore >= sensitivity.centerMedium && crest >= sensitivity.crestGate;
      const score = audioScore * 0.34 + centerScore * 0.28 + ammoScore * 0.13 + killConfirmScore * 0.20 + killfeedScore * 0.05;
      const base = { time: sample.time, score, audio: audioScore, visual: v.score || 0, center: centerScore, killfeed: killfeedScore, ammo: ammoScore, killConfirm: killConfirmScore, topCenter: topCenterScore };

      if (uiTransition && !killConfirm && !shotHud) suppressed.push({ ...base, kind: 'suppressed-round-ui' });
      else if (killConfirm) events.push({ ...base, kind: 'kill-confirm' });
      else if (shotHud) events.push({ ...base, kind: 'shot-hud' });
      else if (killfeed) events.push({ ...base, kind: 'killfeed-support' });
      else if (combatSupport) events.push({ ...base, kind: 'combat-support' });
      else if (audioScore >= 0.85 && centerScore < sensitivity.centerMedium * 0.65 && ammoScore < sensitivity.ammoGate * 0.5) suppressed.push({ ...base, kind: 'suppressed-ability-audio' });
      else if (ammoScore >= sensitivity.ammoGate && audioScore < sensitivity.ammoAudioMin * 0.65) suppressed.push({ ...base, kind: 'suppressed-ammo-ui' });
      else suppressed.push({ ...base, kind: 'suppressed-weak' });
    }

    return { events: collapseEvents(events).filter(item => item.time >= 0 && item.time <= duration), suppressed: collapseEvents(suppressed, 0.12) };
  }

  function buildBaseScenes(events, sensitivityName, sensitivity, duration) {
    if (!events.length) return [];
    const sorted = [...events].sort((a, b) => a.time - b.time);
    const anchors = [];
    for (const event of sorted) {
      if (event.kind === 'kill-confirm') anchors.push({ ...event, anchorKind: 'kill-confirm' });
      else if (event.kind === 'killfeed-support') {
        const nearbyShots = sorted.filter(item => item.kind === 'shot-hud' && Math.abs(item.time - event.time) <= sensitivity.killfeedShotWindow);
        const nearbyCombat = sorted.filter(item => item.kind === 'combat-support' && Math.abs(item.time - event.time) <= Math.min(1.4, sensitivity.killfeedShotWindow));
        if (nearbyShots.length || nearbyCombat.length >= 2) anchors.push({ ...event, anchorKind: 'killfeed-with-shots' });
      }
    }

    if (sensitivityName === 'high') {
      for (const group of groupByGap(sorted.filter(item => item.kind === 'shot-hud'), 1.0)) {
        if (group.length < 3) continue;
        const best = group.reduce((a, b) => a.score >= b.score ? a : b);
        if (!anchors.some(anchor => Math.abs(anchor.time - best.time) <= 1.3)) anchors.push({ ...best, anchorKind: 'dense-shot-fallback' });
      }
    }

    if (!anchors.length) return [];
    anchors.sort((a, b) => a.time - b.time);
    const scenes = [];
    for (const group of groupByGap(anchors, 4.4)) {
      const firstAnchor = group[0].time, lastAnchor = group[group.length - 1].time;
      const support = sorted.filter(item => item.time >= firstAnchor - 2.0 && item.time <= lastAnchor + 1.15 && item.kind !== 'killfeed-support');
      const pre = support.filter(item => item.time <= firstAnchor), post = support.filter(item => item.time >= lastAnchor);
      let start = pre.length ? Math.max(firstAnchor - 2.0, pre[0].time - 0.38) : firstAnchor - 1.35;
      let end = post.length ? Math.min(lastAnchor + 1.25, post[post.length - 1].time + 0.35) : lastAnchor + 0.82;
      start = clamp(start, 0, duration);
      end = clamp(Math.max(end, start + 0.9), 0, duration);

      if (end - start > 8.5 && group.length > 1) {
        const splitGroups = groupByGap(group, 2.8);
        if (splitGroups.length > 1) {
          for (const sub of splitGroups) scenes.push(sceneFromAnchorGroup(sub, sorted, duration));
          continue;
        }
      }

      const shotCount = support.filter(item => item.kind === 'shot-hud').length;
      const killConfirmCount = group.filter(item => item.anchorKind === 'kill-confirm').length;
      const killfeedCount = group.filter(item => item.anchorKind === 'killfeed-with-shots').length;
      const fallbackCount = group.filter(item => item.anchorKind === 'dense-shot-fallback').length;
      const maxScore = Math.max(...group.map(item => item.score));
      const confidence = clamp(0.54 + killConfirmCount * 0.17 + killfeedCount * 0.12 + Math.min(shotCount, 4) * 0.035 + maxScore * 0.08 - fallbackCount * 0.12, 0.48, 0.98);
      scenes.push({ start, end, confidence, source: 'auto', fps: 'auto', detectorReason: killConfirmCount ? 'kill-confirm' : killfeedCount ? 'killfeed-with-shots' : 'dense-shot-fallback', anchorCount: group.length, shotEvidenceCount: shotCount });
    }
    return mergeBaseScenes(scenes, duration);
  }

  function sceneFromAnchorGroup(group, events, duration) {
    const first = group[0].time, last = group[group.length - 1].time;
    const support = events.filter(item => item.time >= first - 1.8 && item.time <= last + 1.0 && item.kind !== 'killfeed-support');
    const start = clamp((support[0]?.time ?? first - 1.25) - 0.35, 0, duration);
    const end = clamp(Math.min(last + 1.15, (support[support.length - 1]?.time ?? last) + 0.35), start + 0.9, duration);
    const killConfirmCount = group.filter(item => item.anchorKind === 'kill-confirm').length;
    const killfeedCount = group.filter(item => item.anchorKind === 'killfeed-with-shots').length;
    return { start, end, confidence: clamp(0.60 + killConfirmCount * 0.17 + killfeedCount * 0.12, 0.50, 0.96), source: 'auto', fps: 'auto', detectorReason: killConfirmCount ? 'kill-confirm' : 'killfeed-with-shots', anchorCount: group.length, shotEvidenceCount: support.filter(item => item.kind === 'shot-hud').length };
  }

  function refineScenes(inputScenes, events, duration, profile) {
    const scenes = [], dropped = [], adjusted = [];
    for (let index = 0; index < inputScenes.length; index++) {
      const original = { ...inputScenes[index] };
      const start = clamp(Number(original.start || 0), 0, duration), end = clamp(Number(original.end || 0), 0, duration);
      if (!(end > start)) continue;
      const sceneEvents = events.filter(event => event.time >= start - 0.15 && event.time <= end + 0.15);
      const evidence = summarizeRefinerEvidence(sceneEvents, events);
      if (shouldDropScene(original, evidence)) {
        dropped.push({ index: index + 1, start: round(start, 3), end: round(end, 3), reason: 'no-shot-and-no-local-kill-confirmation', shotEvidenceCount: Number(original.shotEvidenceCount || 0), localKillConfirmCount: evidence.localKillConfirmCount, verifiedKillfeedCount: evidence.verifiedKillfeedCount });
        continue;
      }
      let nextStart = start, nextEnd = end, reason = 'pre-roll-expanded';
      if (end - start > profile.longSceneLimit && sceneEvents.length) {
        const focus = findBestFocusWindow(start, end, sceneEvents, profile.focusWindow);
        if (focus) { nextStart = clamp(focus.start - 0.60, 0, duration); nextEnd = clamp(focus.end + 0.40, nextStart + 1.0, duration); reason = 'long-scene-focus-window'; }
      } else nextStart = clamp(start - profile.extraPreRoll, 0, duration);
      scenes.push({ ...original, start: nextStart, end: nextEnd, originalStart: start, originalEnd: end, refinerReason: reason });
      if (Math.abs(nextStart - start) > 0.001 || Math.abs(nextEnd - end) > 0.001) adjusted.push({ index: index + 1, originalStart: round(start, 3), originalEnd: round(end, 3), refinedStart: round(nextStart, 3), refinedEnd: round(nextEnd, 3), reason });
    }
    return { scenes: mergeRefinedScenes(scenes, duration), dropped, adjusted };
  }

  function shouldDropScene(scene, evidence) {
    if (Number(scene.shotEvidenceCount || 0) > 0) return false;
    if (scene.detectorReason === 'kill-confirm') return evidence.localKillConfirmCount === 0;
    if (evidence.localKillConfirmCount > 0 || evidence.verifiedKillfeedCount > 0) return false;
    if (scene.detectorReason === 'killfeed-with-shots' && evidence.combatSupportCount >= 3) return false;
    return true;
  }

  function summarizeRefinerEvidence(sceneEvents, allEvents) {
    let localKillConfirmCount = 0, verifiedKillfeedCount = 0, combatSupportCount = 0;
    for (const event of sceneEvents) {
      if (event.kind === 'combat-support') combatSupportCount++;
      if (event.kind === 'kill-confirm' && Number(event.killfeed || 0) >= 0.68 && (Number(event.audio || 0) >= 0.30 || Number(event.ammo || 0) >= 0.45)) localKillConfirmCount++;
      if (event.kind === 'killfeed-support') {
        const nearShot = allEvents.some(other => other.kind === 'shot-hud' && Math.abs(Number(other.time) - Number(event.time)) <= 1.35);
        const nearbyCombat = allEvents.filter(other => other.kind === 'combat-support' && Math.abs(Number(other.time) - Number(event.time)) <= 1.05).length;
        if (nearShot || nearbyCombat >= 2) verifiedKillfeedCount++;
      }
    }
    return { localKillConfirmCount, verifiedKillfeedCount, combatSupportCount };
  }

  function findBestFocusWindow(sceneStart, sceneEnd, events, windowSize) {
    if (!(sceneEnd - sceneStart > windowSize)) return { start: sceneStart, end: sceneEnd };
    let best = null;
    for (let start = sceneStart; start <= sceneEnd - windowSize + 0.0001; start += 0.10) {
      const end = start + windowSize, score = scoreWindow(events, start, end);
      if (!best || score > best.score) best = { start, end, score };
    }
    return best;
  }

  function scoreWindow(events, start, end) {
    let score = 0;
    for (const event of events) {
      if (event.time < start || event.time > end) continue;
      const kindWeight = event.kind === 'shot-hud' ? 2.4 : event.kind === 'combat-support' ? 1.30 : event.kind === 'killfeed-support' ? 1.20 : event.kind === 'kill-confirm' ? 0.22 : 0;
      score += kindWeight + Math.min(Number(event.audio || 0), 1.5) * 0.70 + Math.min(Number(event.center || 0), 1.5) * 0.15 - Math.min(Number(event.topCenter || 0), 2.2) * 0.08;
    }
    return score;
  }

  function applyRecallGuard(inputScenes, refinerData, events, duration, profile) {
    let scenes = inputScenes.map(scene => ({ ...scene }));
    const recovered = [], expanded = [];
    for (const adjustment of refinerData.adjusted || []) {
      if (adjustment.reason !== 'long-scene-focus-window') continue;
      const current = findClosestScene(scenes, adjustment.refinedStart, adjustment.refinedEnd);
      if (!current) continue;
      const omittedStart = Math.max(Number(current.end || 0), Number(adjustment.refinedEnd || 0));
      const omittedEnd = Number(adjustment.originalEnd || omittedStart);
      if (!(omittedEnd > omittedStart + 0.15)) continue;
      const omittedEvents = events.filter(event => Number(event.time) >= omittedStart - 0.05 && Number(event.time) <= omittedEnd + 0.05);
      const tailEvidence = summarizeTailEvidence(omittedEvents);
      if (!tailEvidence.shouldRecover) continue;
      const oldEnd = Number(current.end || 0);
      current.end = clamp(omittedEnd + profile.tailPad, current.start + 0.9, duration);
      current.recallGuard = 'tail-recovery';
      expanded.push({ originalIndex: Number(adjustment.index || 0), previousEnd: round(oldEnd, 3), recoveredEnd: round(current.end, 3), omittedStart: round(omittedStart, 3), omittedEnd: round(omittedEnd, 3), evidence: tailEvidence });
    }

    for (const item of refinerData.dropped || []) {
      const start = clamp(Number(item.start || 0), 0, duration), end = clamp(Number(item.end || 0), 0, duration);
      if (!(end > start) || overlapsExistingScene(scenes, start, end, 0.62)) continue;
      const localEvents = events.filter(event => Number(event.time) >= start - 0.25 && Number(event.time) <= end + 0.25);
      if (!localEvents.length) continue;
      const evidence = summarizeCandidateEvidence(localEvents);
      const confidence = clamp(profile.recoveredConfidence + Math.min(evidence.killConfirmCount, 2) * 0.025 + Math.min(evidence.killfeedCount, 2) * 0.02 + Math.min(evidence.combatCount, 4) * 0.01, 0.42, 0.59);
      scenes.push({ start, end, confidence, source: 'auto', fps: 'auto', detectorReason: 'recovered-low-confidence', anchorCount: evidence.killConfirmCount + evidence.killfeedCount, shotEvidenceCount: evidence.shotCount, needsReview: true, recallGuard: 'recovered-refiner-drop' });
      recovered.push({ originalIndex: Number(item.index || 0), start: round(start, 3), end: round(end, 3), confidence: round(confidence, 4), previousDropReason: item.reason || null, evidence });
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
    const supportedKillCluster = killConfirm.some(event => Number(event.audio || 0) >= 0.75 && Number(event.killfeed || 0) >= 0.70 && Number(event.ammo || 0) >= 0.65);
    const multipleKillSignals = killConfirm.filter(event => Number(event.audio || 0) >= 0.45 || Number(event.ammo || 0) >= 0.80 || Number(event.killfeed || 0) >= 0.90).length >= 2 && (shotTimes.length >= 1 || killfeed.length >= 1);
    return { shouldRecover: denseShotCluster || supportedKillCluster || multipleKillSignals, shotCount: shotTimes.length, killConfirmCount: killConfirm.length, killfeedCount: killfeed.length, denseShotCluster, supportedKillCluster, multipleKillSignals };
  }

  function summarizeCandidateEvidence(events) {
    const killConfirm = events.filter(event => event.kind === 'kill-confirm'), killfeed = events.filter(event => event.kind === 'killfeed-support'), shot = events.filter(event => event.kind === 'shot-hud'), combat = events.filter(event => event.kind === 'combat-support');
    return { eventCount: events.length, killConfirmCount: killConfirm.length, killfeedCount: killfeed.length, shotCount: shot.length, combatCount: combat.length, maxKillConfirm: round(maxOf(events, 'killConfirm'), 4), maxKillfeed: round(maxOf(events, 'killfeed'), 4), maxAmmo: round(maxOf(events, 'ammo'), 4), maxAudio: round(maxOf(events, 'audio'), 4), maxCenter: round(maxOf(events, 'center'), 4) };
  }

  function classifyScenes(inputScenes, events) {
    const scenes = inputScenes.map((scene, index) => {
      const evidence = summarizeClassifierEvidence(scene, events);
      const tier = classifyScene(scene, evidence);
      return { ...scene, reviewTier: tier.tier, needsReview: tier.tier === 'weak' || Boolean(scene.needsReview), weakReason: tier.reason, classifierEvidence: evidence, classifierIndex: index + 1 };
    });
    return { scenes, primary: scenes.filter(scene => scene.reviewTier !== 'weak'), weak: scenes.filter(scene => scene.reviewTier === 'weak') };
  }

  function classifyScene(scene, evidence) {
    const reason = String(scene.detectorReason || '');
    if (reason.includes('recovered-low-confidence')) {
      const strongRecovered = evidence.shotCount >= 1 || evidence.combatCount >= 2 || (evidence.killfeedCount >= 1 && evidence.maxAudio >= 0.45 && evidence.maxCenter >= 0.65);
      return strongRecovered ? { tier: 'primary', reason: 'recovered-with-combat-support' } : { tier: 'weak', reason: 'recovered-without-combat-support' };
    }
    if (Number(scene.shotEvidenceCount || 0) <= 0) return { tier: 'weak', reason: 'no-shot-evidence' };
    return { tier: 'primary', reason: 'normal' };
  }

  function summarizeClassifierEvidence(scene, events) {
    const local = events.filter(event => Number(event.time) >= Number(scene.start || 0) - 0.05 && Number(event.time) <= Number(scene.end || 0) + 0.05);
    const counts = { shotCount: 0, combatCount: 0, killfeedCount: 0, killConfirmCount: 0 };
    let maxAudio = 0, maxCenter = 0, maxKillfeed = 0, maxAmmo = 0, maxKillConfirm = 0;
    for (const event of local) {
      if (event.kind === 'shot-hud') counts.shotCount++;
      else if (event.kind === 'combat-support') counts.combatCount++;
      else if (event.kind === 'killfeed-support') counts.killfeedCount++;
      else if (event.kind === 'kill-confirm') counts.killConfirmCount++;
      maxAudio = Math.max(maxAudio, Number(event.audio || 0)); maxCenter = Math.max(maxCenter, Number(event.center || 0)); maxKillfeed = Math.max(maxKillfeed, Number(event.killfeed || 0)); maxAmmo = Math.max(maxAmmo, Number(event.ammo || 0)); maxKillConfirm = Math.max(maxKillConfirm, Number(event.killConfirm || 0));
    }
    return { eventCount: local.length, ...counts, maxAudio: round(maxAudio, 4), maxCenter: round(maxCenter, 4), maxKillfeed: round(maxKillfeed, 4), maxAmmo: round(maxAmmo, 4), maxKillConfirm: round(maxKillConfirm, 4) };
  }

  function mergeBaseScenes(scenes, duration) {
    if (!scenes.length) return [];
    const sorted = [...scenes].sort((a, b) => a.start - b.start), merged = [{ ...sorted[0] }];
    for (let i = 1; i < sorted.length; i++) {
      const scene = sorted[i], last = merged[merged.length - 1];
      if (scene.start <= last.end + 0.45 && Math.max(last.end, scene.end) - Math.min(last.start, scene.start) <= 8.5) {
        last.start = Math.min(last.start, scene.start); last.end = clamp(Math.max(last.end, scene.end), 0, duration); last.confidence = Math.max(last.confidence, scene.confidence); last.anchorCount = Number(last.anchorCount || 0) + Number(scene.anchorCount || 0); last.shotEvidenceCount = Number(last.shotEvidenceCount || 0) + Number(scene.shotEvidenceCount || 0); if (scene.detectorReason === 'kill-confirm') last.detectorReason = 'kill-confirm';
      } else merged.push({ ...scene });
    }
    return merged;
  }

  function mergeRefinedScenes(scenes, duration) {
    if (!scenes.length) return [];
    const sorted = [...scenes].sort((a, b) => a.start - b.start), merged = [{ ...sorted[0] }];
    for (let i = 1; i < sorted.length; i++) {
      const scene = sorted[i], last = merged[merged.length - 1], unionStart = Math.min(last.start, scene.start), unionEnd = Math.max(last.end, scene.end);
      if (scene.start <= last.end + 0.18 && unionEnd - unionStart <= 8.8) {
        last.start = unionStart; last.end = clamp(unionEnd, 0, duration); last.confidence = Math.max(Number(last.confidence || 0), Number(scene.confidence || 0)); last.anchorCount = Number(last.anchorCount || 0) + Number(scene.anchorCount || 0); last.shotEvidenceCount = Number(last.shotEvidenceCount || 0) + Number(scene.shotEvidenceCount || 0);
      } else merged.push({ ...scene });
    }
    return merged;
  }

  function mergeNearDuplicates(scenes, duration) {
    if (!scenes.length) return [];
    const sorted = [...scenes].sort((a, b) => Number(a.start) - Number(b.start)), output = [];
    for (const scene of sorted) {
      const last = output[output.length - 1];
      if (!last) { output.push({ ...scene }); continue; }
      const intersection = Math.max(0, Math.min(Number(last.end), Number(scene.end)) - Math.max(Number(last.start), Number(scene.start)));
      const shorter = Math.min(Number(last.end) - Number(last.start), Number(scene.end) - Number(scene.start));
      const overlapRatio = shorter > 0 ? intersection / shorter : 0;
      if (overlapRatio >= 0.72) {
        const stronger = Number(last.confidence || 0) >= Number(scene.confidence || 0) ? { ...last } : { ...scene };
        stronger.start = Math.min(Number(last.start), Number(scene.start)); stronger.end = clamp(Math.max(Number(last.end), Number(scene.end)), 0, duration); stronger.confidence = Math.max(Number(last.confidence || 0), Number(scene.confidence || 0)); stronger.anchorCount = Math.max(Number(last.anchorCount || 0), Number(scene.anchorCount || 0)); stronger.shotEvidenceCount = Math.max(Number(last.shotEvidenceCount || 0), Number(scene.shotEvidenceCount || 0)); output[output.length - 1] = stronger;
      } else output.push({ ...scene });
    }
    return output;
  }

  function findClosestScene(scenes, start, end) {
    let best = null, bestDistance = Infinity;
    for (const scene of scenes) {
      const distance = Math.abs(Number(scene.start || 0) - Number(start || 0)) + Math.abs(Number(scene.end || 0) - Number(end || 0));
      if (distance < bestDistance) { best = scene; bestDistance = distance; }
    }
    return bestDistance <= 2.5 ? best : null;
  }

  function overlapsExistingScene(scenes, start, end, ratioThreshold) {
    return scenes.some(scene => {
      const overlap = Math.max(0, Math.min(end, Number(scene.end || 0)) - Math.max(start, Number(scene.start || 0)));
      const shorter = Math.min(end - start, Number(scene.end || 0) - Number(scene.start || 0));
      return shorter > 0 && overlap / shorter >= ratioThreshold;
    });
  }

  function hasDenseCluster(times, minCount, windowSeconds) {
    if (times.length < minCount) return false;
    const sorted = [...times].sort((a, b) => a - b); let left = 0;
    for (let right = 0; right < sorted.length; right++) { while (sorted[right] - sorted[left] > windowSeconds) left++; if (right - left + 1 >= minCount) return true; }
    return false;
  }

  function collapseEvents(events, gap = 0.14) {
    if (!events.length) return [];
    const sorted = [...events].sort((a, b) => a.time - b.time), result = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      const current = sorted[i], last = result[result.length - 1];
      if (current.time - last.time > gap || current.kind !== last.kind) result.push(current);
      else if (current.score > last.score) result[result.length - 1] = current;
    }
    return result;
  }

  function groupByGap(items, maxGap) {
    if (!items.length) return [];
    const sorted = [...items].sort((a, b) => a.time - b.time), groups = [[sorted[0]]];
    for (let i = 1; i < sorted.length; i++) { const group = groups[groups.length - 1]; if (sorted[i].time - group[group.length - 1].time <= maxGap) group.push(sorted[i]); else groups.push([sorted[i]]); }
    return groups;
  }

  function regionDiff(current, previous, width, height, x1, x2, y1, y2, stride = 1) {
    const minX = Math.max(0, Math.floor(width * x1)), maxX = Math.min(width, Math.ceil(width * x2)), minY = Math.max(0, Math.floor(height * y1)), maxY = Math.min(height, Math.ceil(height * y2));
    let sum = 0, count = 0;
    for (let y = minY; y < maxY; y += stride) for (let x = minX; x < maxX; x += stride) { const pos = y * width + x; sum += Math.abs(current[pos] - previous[pos]) / 255; count++; }
    return sum / Math.max(1, count);
  }

  function nearestByTime(items, time) {
    if (!items.length) return null;
    let low = 0, high = items.length - 1;
    while (low < high) { const mid = Math.floor((low + high) / 2); if (items[mid].time < time) low = mid + 1; else high = mid; }
    const current = items[low], previous = items[Math.max(0, low - 1)];
    return Math.abs((previous?.time ?? Infinity) - time) <= Math.abs((current?.time ?? Infinity) - time) ? previous : current;
  }

  function percentile(values, ratio) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * ratio)))];
  }

  function seekVideo(video, time, signal) {
    return new Promise((resolve, reject) => {
      throwIfAborted(signal);
      if (Math.abs(video.currentTime - time) < 0.008 && video.readyState >= 2) return resolve();
      const timer = setTimeout(() => { cleanup(); reject(new Error('動画フレームの読み込みがタイムアウトしました。')); }, 5000);
      const abort = () => { cleanup(); reject(makeAbortError()); };
      const cleanup = () => { clearTimeout(timer); video.removeEventListener('seeked', done); video.removeEventListener('error', fail); signal?.removeEventListener('abort', abort); };
      const done = () => { cleanup(); resolve(); }, fail = () => { cleanup(); reject(new Error('動画フレームを読み込めませんでした。')); };
      video.addEventListener('seeked', done, { once: true }); video.addEventListener('error', fail, { once: true }); signal?.addEventListener('abort', abort, { once: true });
      try { video.currentTime = Math.max(0, time); } catch (error) { cleanup(); reject(error); }
    });
  }

  function waitFor(target, eventName, timeoutMs, signal) {
    return new Promise((resolve, reject) => {
      throwIfAborted(signal);
      if (eventName === 'loadeddata' && target.readyState >= 2) return resolve();
      const timer = setTimeout(() => { cleanup(); reject(new Error('動画情報の読み込みがタイムアウトしました。')); }, timeoutMs);
      const abort = () => { cleanup(); reject(makeAbortError()); };
      const cleanup = () => { clearTimeout(timer); target.removeEventListener(eventName, done); target.removeEventListener('error', fail); signal?.removeEventListener('abort', abort); };
      const done = () => { cleanup(); resolve(); }, fail = () => { cleanup(); reject(new Error('動画を読み込めませんでした。')); };
      target.addEventListener(eventName, done, { once: true }); target.addEventListener('error', fail, { once: true }); signal?.addEventListener('abort', abort, { once: true });
    });
  }

  function toDiagnostic(scene) { return { index: Number(scene.classifierIndex || 0), start: round(scene.start, 3), end: round(scene.end, 3), tier: scene.reviewTier || 'primary', weakReason: scene.weakReason || null, detectorReason: scene.detectorReason || null, confidence: Number.isFinite(scene.confidence) ? round(scene.confidence, 4) : null, evidence: scene.classifierEvidence || null }; }
  function cleanAudioSample(item) { return { time: round(item.time, 3), score: round(item.score, 4), rms: round(item.rms, 6), peak: round(item.peak, 6), rise: round(item.rise, 6), crest: round(item.crest, 4) }; }
  function cleanVisualSample(item) { return { time: round(item.time, 3), score: round(item.score, 4), motion: round(item.motion, 5), centerMotion: round(item.centerMotion, 5), centerScore: round(item.centerScore, 4), killfeedMotion: round(item.killfeedMotion, 5), killfeedScore: round(item.killfeedScore, 4), ammoMotion: round(item.ammoMotion, 5), ammoScore: round(item.ammoScore, 4), killConfirmMotion: round(item.killConfirmMotion, 5), killConfirmScore: round(item.killConfirmScore, 4), topCenterMotion: round(item.topCenterMotion, 5), topCenterScore: round(item.topCenterScore, 4) }; }
  function cleanEvent(item) { return { time: round(item.time, 3), score: round(item.score, 4), audio: round(item.audio, 4), visual: round(item.visual, 4), center: round(item.center, 4), killfeed: round(item.killfeed, 4), ammo: round(item.ammo, 4), killConfirm: round(item.killConfirm, 4), topCenter: round(item.topCenter, 4), kind: item.kind }; }
  function maxOf(events, key) { let max = 0; for (const event of events) max = Math.max(max, Number(event[key] || 0)); return max; }
  function round(value, digits) { const p = 10 ** digits; return Math.round(Number(value || 0) * p) / p; }
  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
  function makeAbortError() { const error = new Error('解析をキャンセルしました。'); error.name = 'AbortError'; return error; }
  function throwIfAborted(signal) { if (signal?.aborted) throw makeAbortError(); }
  function isAbortError(error) { return error?.name === 'AbortError'; }

  return { detect, version: VERSION };
})();
