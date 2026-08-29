window.VReviewSceneDetection = (() => {
  const SENSITIVITY = {
    low: {
      audioMedium: 0.48,
      centerMedium: 0.34,
      crestGate: 2.25,
      killfeedGate: 1.05,
      killfeedAbsolute: 0.012,
      killfeedRatio: 1.12,
      ammoGate: 0.92,
      ammoAbsolute: 0.009,
      ammoRatio: 1.06,
      ammoAudioMin: 0.56,
      killConfirmGate: 0.98,
      killConfirmAbsolute: 0.010,
      killConfirmRatio: 1.08,
      killConfirmAudioMin: 0.34,
      killfeedShotWindow: 1.55,
      topCenterBlock: 1.10,
      topCenterAudioMax: 0.24
    },
    standard: {
      audioMedium: 0.38,
      centerMedium: 0.27,
      crestGate: 2.00,
      killfeedGate: 0.82,
      killfeedAbsolute: 0.008,
      killfeedRatio: 1.07,
      ammoGate: 0.72,
      ammoAbsolute: 0.006,
      ammoRatio: 1.03,
      ammoAudioMin: 0.44,
      killConfirmGate: 0.76,
      killConfirmAbsolute: 0.0065,
      killConfirmRatio: 1.04,
      killConfirmAudioMin: 0.24,
      killfeedShotWindow: 1.85,
      topCenterBlock: 0.98,
      topCenterAudioMax: 0.20
    },
    high: {
      audioMedium: 0.30,
      centerMedium: 0.21,
      crestGate: 1.85,
      killfeedGate: 0.66,
      killfeedAbsolute: 0.006,
      killfeedRatio: 1.04,
      ammoGate: 0.58,
      ammoAbsolute: 0.0045,
      ammoRatio: 1.01,
      ammoAudioMin: 0.34,
      killConfirmGate: 0.60,
      killConfirmAbsolute: 0.0045,
      killConfirmRatio: 1.02,
      killConfirmAudioMin: 0.18,
      killfeedShotWindow: 2.10,
      topCenterBlock: 1.12,
      topCenterAudioMax: 0.18
    }
  };

  async function detect(file, options = {}) {
    if (!file) throw new Error('解析する動画がありません。');
    const duration = Math.max(0, Number(options.duration || 0));
    if (!duration) throw new Error('動画時間を取得できませんでした。');

    const sensitivityName = options.sensitivity || 'standard';
    const sensitivity = SENSITIVITY[sensitivityName] || SENSITIVITY.standard;
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
    const warnings = [];

    onProgress({ phase: 'audio', progress: 0.03, message: '音声を解析しています…' });
    let audio = [];
    try {
      audio = await analyzeAudio(file, duration, value => {
        onProgress({ phase: 'audio', progress: 0.03 + value * 0.27, message: '音声を解析しています…' });
      });
    } catch (error) {
      warnings.push('音声解析を利用できなかったため、映像証拠を中心に検出しました。');
    }

    onProgress({ phase: 'visual', progress: 0.31, message: 'キル確認UI・弾数HUD・キルフィードを解析しています…' });
    const visual = await analyzeVisual(file, duration, value => {
      onProgress({ phase: 'visual', progress: 0.31 + value * 0.54, message: 'キル確認UI・弾数HUD・キルフィードを解析しています…' });
    });

    onProgress({ phase: 'build', progress: 0.87, message: 'キルScene候補を組み立てています…' });
    const evidenceResult = buildEvidence(audio, visual, sensitivity, duration);
    const scenes = buildScenes(evidenceResult.events, sensitivityName, sensitivity, duration);

    onProgress({ phase: 'done', progress: 1, message: `${scenes.length}件のキルScene候補を検出しました。` });
    return {
      scenes,
      warnings,
      sensitivity: sensitivityName,
      detectorVersion: '0.4.2',
      diagnostics: {
        audioSamples: audio.length,
        visualSamples: visual.length,
        eventCount: evidenceResult.events.length,
        suppressedCount: evidenceResult.suppressed.length,
        thresholds: { ...sensitivity }
      },
      diagnosticData: {
        audio: audio.map(item => ({
          time: round(item.time, 3),
          score: round(item.score, 4),
          rms: round(item.rms, 6),
          peak: round(item.peak, 6),
          rise: round(item.rise, 6),
          crest: round(item.crest, 4)
        })),
        visual: visual.map(item => ({
          time: round(item.time, 3),
          score: round(item.score, 4),
          motion: round(item.motion, 5),
          centerMotion: round(item.centerMotion, 5),
          centerScore: round(item.centerScore, 4),
          killfeedMotion: round(item.killfeedMotion, 5),
          killfeedScore: round(item.killfeedScore, 4),
          ammoMotion: round(item.ammoMotion, 5),
          ammoScore: round(item.ammoScore, 4),
          killConfirmMotion: round(item.killConfirmMotion, 5),
          killConfirmScore: round(item.killConfirmScore, 4),
          topCenterMotion: round(item.topCenterMotion, 5),
          topCenterScore: round(item.topCenterScore, 4)
        })),
        events: evidenceResult.events.map(cleanEvent),
        suppressed: evidenceResult.suppressed.map(cleanEvent)
      }
    };
  }

  async function analyzeAudio(file, duration, onProgress) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('Web Audio APIに対応していません。');
    const context = new AudioContextClass();
    try {
      const buffer = await context.decodeAudioData(await file.arrayBuffer());
      const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
      const sampleRate = buffer.sampleRate;
      const stepSeconds = 0.05;
      const windowSeconds = 0.035;
      const step = Math.max(1, Math.floor(sampleRate * stepSeconds));
      const windowSize = Math.max(1, Math.floor(sampleRate * windowSeconds));
      const length = Math.min(buffer.length, Math.floor(duration * sampleRate));
      const samples = [];
      let previousRms = 0;

      for (let start = 0, index = 0; start < length; start += step, index++) {
        const end = Math.min(length, start + windowSize);
        let sumSquares = 0;
        let peak = 0;
        let count = 0;
        for (let i = start; i < end; i += 2) {
          let value = 0;
          for (const channel of channels) value += Math.abs(channel[i] || 0);
          value /= Math.max(1, channels.length);
          sumSquares += value * value;
          peak = Math.max(peak, value);
          count++;
        }
        const rms = Math.sqrt(sumSquares / Math.max(1, count));
        samples.push({
          time: start / sampleRate,
          rms,
          peak,
          rise: Math.max(0, rms - previousRms),
          crest: peak / Math.max(rms, 0.00001)
        });
        previousRms = rms;
        if (index % 90 === 0) onProgress(Math.min(1, start / Math.max(1, length)));
      }

      const rmsBase = percentile(samples.map(item => item.rms), 0.55);
      const rmsHigh = Math.max(percentile(samples.map(item => item.rms), 0.96), rmsBase + 0.0001);
      const riseHigh = Math.max(percentile(samples.map(item => item.rise), 0.94), 0.0001);
      samples.forEach(item => {
        const loudness = clamp((item.rms - rmsBase) / (rmsHigh - rmsBase), 0, 1.8);
        const rise = clamp(item.rise / riseHigh, 0, 1.8);
        const crest = clamp((item.crest - 1.55) / 4.2, 0, 1.1);
        item.score = loudness * 0.54 + rise * 0.32 + crest * 0.14;
      });
      onProgress(1);
      return samples;
    } finally {
      await context.close().catch(() => {});
    }
  }

  async function analyzeVisual(file, duration, onProgress) {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = url;

    try {
      await waitFor(video, 'loadeddata', 10000);
      const canvas = document.createElement('canvas');
      const width = 160;
      const height = Math.max(80, Math.round(width * (video.videoHeight / Math.max(1, video.videoWidth))));
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('Canvasを初期化できませんでした。');

      const stepSeconds = duration <= 35 ? 0.12 : duration <= 75 ? 0.16 : 0.22;
      const total = Math.max(1, Math.ceil(duration / stepSeconds));
      const samples = [];
      let previous = null;
      let index = 0;

      for (let time = 0; time < duration; time += stepSeconds, index++) {
        await seekVideo(video, Math.min(time, Math.max(0, duration - 0.02)));
        ctx.drawImage(video, 0, 0, width, height);
        const data = ctx.getImageData(0, 0, width, height).data;
        const current = new Uint8Array(width * height);
        let cursor = 0;
        for (let i = 0; i < data.length; i += 4) {
          current[cursor++] = Math.round(data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722);
        }

        let motion = 0;
        let centerMotion = 0;
        let killfeedMotion = 0;
        let ammoMotion = 0;
        let killConfirmMotion = 0;
        let topCenterMotion = 0;
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

    samples.forEach(item => {
      const overallScore = clamp(item.motion / motionHigh, 0, 1.8);
      item.centerScore = clamp(item.centerMotion / centerHigh, 0, 1.8);
      const killfeedExcess = Math.max(0, item.killfeedMotion - item.motion * 0.76);
      const ammoExcess = Math.max(0, item.ammoMotion - item.motion * 0.68);
      const killConfirmExcess = Math.max(0, item.killConfirmMotion - item.motion * 0.62);
      const topCenterExcess = Math.max(0, item.topCenterMotion - item.motion * 0.72);
      item.killfeedExcess = killfeedExcess;
      item.ammoExcess = ammoExcess;
      item.killConfirmExcess = killConfirmExcess;
      item.topCenterExcess = topCenterExcess;
      item.killfeedRatio = item.killfeedMotion / Math.max(0.002, item.motion);
      item.ammoRatio = item.ammoMotion / Math.max(0.002, item.motion);
      item.killConfirmRatio = item.killConfirmMotion / Math.max(0.002, item.motion);
      item.killfeedScore = clamp(killfeedExcess / killfeedHigh, 0, 2.2);
      item.ammoScore = clamp(ammoExcess / ammoHigh, 0, 2.2);
      item.killConfirmScore = clamp(killConfirmExcess / killConfirmHigh, 0, 2.2);
      item.topCenterScore = clamp(topCenterExcess / topCenterHigh, 0, 2.2);
      item.score = overallScore * 0.24 + item.centerScore * 0.43 + item.ammoScore * 0.12 + item.killConfirmScore * 0.16 + item.killfeedScore * 0.05;
    });
  }

  function buildEvidence(audio, visual, sensitivity, duration) {
    const events = [];
    const suppressed = [];
    const source = audio.length ? audio : visual.map(item => ({ time: item.time, score: 0, crest: 0 }));

    for (const sample of source) {
      const v = nearestByTime(visual, sample.time);
      if (!v) continue;
      const audioScore = sample.score || 0;
      const crest = sample.crest || 0;
      const centerScore = v.centerScore || 0;
      const killfeedScore = v.killfeedScore || 0;
      const ammoScore = v.ammoScore || 0;
      const killConfirmScore = v.killConfirmScore || 0;
      const topCenterScore = v.topCenterScore || 0;
      const uiTransition = topCenterScore >= sensitivity.topCenterBlock && audioScore <= sensitivity.topCenterAudioMax && killConfirmScore < sensitivity.killConfirmGate;

      const killConfirm = v.killConfirmExcess >= sensitivity.killConfirmAbsolute
        && v.killConfirmRatio >= sensitivity.killConfirmRatio
        && killConfirmScore >= sensitivity.killConfirmGate
        && (audioScore >= sensitivity.killConfirmAudioMin || killfeedScore >= sensitivity.killfeedGate * 0.65 || ammoScore >= sensitivity.ammoGate * 0.65);

      const shotHud = v.ammoExcess >= sensitivity.ammoAbsolute
        && v.ammoRatio >= sensitivity.ammoRatio
        && ammoScore >= sensitivity.ammoGate
        && audioScore >= sensitivity.ammoAudioMin
        && centerScore >= sensitivity.centerMedium * 0.72;

      const killfeed = v.killfeedExcess >= sensitivity.killfeedAbsolute
        && v.killfeedRatio >= sensitivity.killfeedRatio
        && killfeedScore >= sensitivity.killfeedGate;

      const combatSupport = audioScore >= sensitivity.audioMedium
        && centerScore >= sensitivity.centerMedium
        && crest >= sensitivity.crestGate;

      const score = audioScore * 0.34 + centerScore * 0.28 + ammoScore * 0.13 + killConfirmScore * 0.20 + killfeedScore * 0.05;
      const base = {
        time: sample.time,
        score,
        audio: audioScore,
        visual: v.score || 0,
        center: centerScore,
        killfeed: killfeedScore,
        ammo: ammoScore,
        killConfirm: killConfirmScore,
        topCenter: topCenterScore
      };

      if (uiTransition && !killConfirm && !shotHud) {
        suppressed.push({ ...base, kind: 'suppressed-round-ui' });
        continue;
      }
      if (killConfirm) {
        events.push({ ...base, kind: 'kill-confirm' });
        continue;
      }
      if (shotHud) {
        events.push({ ...base, kind: 'shot-hud' });
        continue;
      }
      if (killfeed) {
        events.push({ ...base, kind: 'killfeed-support' });
        continue;
      }
      if (combatSupport) {
        events.push({ ...base, kind: 'combat-support' });
        continue;
      }

      if (audioScore >= 0.85 && centerScore < sensitivity.centerMedium * 0.65 && ammoScore < sensitivity.ammoGate * 0.5) {
        suppressed.push({ ...base, kind: 'suppressed-ability-audio' });
      } else if (ammoScore >= sensitivity.ammoGate && audioScore < sensitivity.ammoAudioMin * 0.65) {
        suppressed.push({ ...base, kind: 'suppressed-ammo-ui' });
      } else if (killfeed) {
        suppressed.push({ ...base, kind: 'suppressed-killfeed-only' });
      } else {
        suppressed.push({ ...base, kind: 'suppressed-weak' });
      }
    }

    return {
      events: collapseEvents(events).filter(item => item.time >= 0 && item.time <= duration),
      suppressed: collapseEvents(suppressed, 0.12)
    };
  }

  function buildScenes(events, sensitivityName, sensitivity, duration) {
    if (!events.length) return [];
    const sorted = [...events].sort((a, b) => a.time - b.time);
    const anchors = [];

    for (const event of sorted) {
      if (event.kind === 'kill-confirm') {
        anchors.push({ ...event, anchorKind: 'kill-confirm' });
        continue;
      }
      if (event.kind !== 'killfeed-support') continue;
      const nearbyShots = sorted.filter(item => item.kind === 'shot-hud' && Math.abs(item.time - event.time) <= sensitivity.killfeedShotWindow);
      const nearbyCombat = sorted.filter(item => item.kind === 'combat-support' && Math.abs(item.time - event.time) <= Math.min(1.4, sensitivity.killfeedShotWindow));
      if (nearbyShots.length || nearbyCombat.length >= 2) {
        anchors.push({ ...event, anchorKind: 'killfeed-with-shots' });
      }
    }

    if (sensitivityName === 'high') {
      const shotEvents = sorted.filter(item => item.kind === 'shot-hud');
      const shotGroups = groupByGap(shotEvents, 1.0);
      for (const group of shotGroups) {
        if (group.length < 3) continue;
        const best = group.reduce((a, b) => a.score >= b.score ? a : b);
        if (!anchors.some(anchor => Math.abs(anchor.time - best.time) <= 1.3)) {
          anchors.push({ ...best, anchorKind: 'dense-shot-fallback' });
        }
      }
    }

    if (!anchors.length) return [];
    anchors.sort((a, b) => a.time - b.time);
    const anchorGroups = groupByGap(anchors, 4.4);
    const scenes = [];

    for (const group of anchorGroups) {
      const firstAnchor = group[0].time;
      const lastAnchor = group[group.length - 1].time;
      const support = sorted.filter(item => item.time >= firstAnchor - 2.0 && item.time <= lastAnchor + 1.15 && item.kind !== 'killfeed-support');
      const pre = support.filter(item => item.time <= firstAnchor);
      const post = support.filter(item => item.time >= lastAnchor);
      let start = pre.length ? Math.max(firstAnchor - 2.0, pre[0].time - 0.38) : firstAnchor - 1.35;
      let end = post.length ? Math.min(lastAnchor + 1.25, post[post.length - 1].time + 0.35) : lastAnchor + 0.82;
      start = clamp(start, 0, duration);
      end = clamp(Math.max(end, start + 0.9), 0, duration);

      const span = end - start;
      if (span > 8.5 && group.length > 1) {
        const splitGroups = groupByGap(group, 2.8);
        if (splitGroups.length > 1) {
          for (const sub of splitGroups) {
            scenes.push(sceneFromAnchorGroup(sub, sorted, duration));
          }
          continue;
        }
      }

      const shotCount = support.filter(item => item.kind === 'shot-hud').length;
      const killConfirmCount = group.filter(item => item.anchorKind === 'kill-confirm').length;
      const killfeedCount = group.filter(item => item.anchorKind === 'killfeed-with-shots').length;
      const fallbackCount = group.filter(item => item.anchorKind === 'dense-shot-fallback').length;
      const maxScore = Math.max(...group.map(item => item.score));
      const confidence = clamp(0.54 + killConfirmCount * 0.17 + killfeedCount * 0.12 + Math.min(shotCount, 4) * 0.035 + maxScore * 0.08 - fallbackCount * 0.12, 0.48, 0.98);
      scenes.push({
        start,
        end,
        confidence,
        source: 'auto',
        fps: 'auto',
        detectorReason: killConfirmCount ? 'kill-confirm' : killfeedCount ? 'killfeed-with-shots' : 'dense-shot-fallback',
        anchorCount: group.length,
        shotEvidenceCount: shotCount
      });
    }

    return mergeScenes(scenes, duration);
  }

  function sceneFromAnchorGroup(group, events, duration) {
    const first = group[0].time;
    const last = group[group.length - 1].time;
    const support = events.filter(item => item.time >= first - 1.8 && item.time <= last + 1.0 && item.kind !== 'killfeed-support');
    const start = clamp((support[0]?.time ?? first - 1.25) - 0.35, 0, duration);
    const end = clamp(Math.min(last + 1.15, (support[support.length - 1]?.time ?? last) + 0.35), start + 0.9, duration);
    const killConfirmCount = group.filter(item => item.anchorKind === 'kill-confirm').length;
    const killfeedCount = group.filter(item => item.anchorKind === 'killfeed-with-shots').length;
    const confidence = clamp(0.60 + killConfirmCount * 0.17 + killfeedCount * 0.12, 0.50, 0.96);
    return {
      start,
      end,
      confidence,
      source: 'auto',
      fps: 'auto',
      detectorReason: killConfirmCount ? 'kill-confirm' : 'killfeed-with-shots',
      anchorCount: group.length,
      shotEvidenceCount: support.filter(item => item.kind === 'shot-hud').length
    };
  }

  function collapseEvents(events, gap = 0.14) {
    if (!events.length) return [];
    const sorted = [...events].sort((a, b) => a.time - b.time);
    const result = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      const current = sorted[i];
      const last = result[result.length - 1];
      if (current.time - last.time > gap || current.kind !== last.kind) {
        result.push(current);
      } else if (current.score > last.score) {
        result[result.length - 1] = current;
      }
    }
    return result;
  }

  function groupByGap(items, maxGap) {
    if (!items.length) return [];
    const sorted = [...items].sort((a, b) => a.time - b.time);
    const groups = [[sorted[0]]];
    for (let i = 1; i < sorted.length; i++) {
      const group = groups[groups.length - 1];
      if (sorted[i].time - group[group.length - 1].time <= maxGap) group.push(sorted[i]);
      else groups.push([sorted[i]]);
    }
    return groups;
  }

  function mergeScenes(scenes, duration) {
    if (!scenes.length) return [];
    const sorted = [...scenes].sort((a, b) => a.start - b.start);
    const merged = [{ ...sorted[0] }];
    for (let i = 1; i < sorted.length; i++) {
      const scene = sorted[i];
      const last = merged[merged.length - 1];
      if (scene.start <= last.end + 0.45 && Math.max(last.end, scene.end) - Math.min(last.start, scene.start) <= 8.5) {
        last.start = Math.min(last.start, scene.start);
        last.end = clamp(Math.max(last.end, scene.end), 0, duration);
        last.confidence = Math.max(last.confidence, scene.confidence);
        last.anchorCount = Number(last.anchorCount || 0) + Number(scene.anchorCount || 0);
        last.shotEvidenceCount = Number(last.shotEvidenceCount || 0) + Number(scene.shotEvidenceCount || 0);
        if (scene.detectorReason === 'kill-confirm') last.detectorReason = 'kill-confirm';
      } else {
        merged.push({ ...scene });
      }
    }
    return merged;
  }

  function regionDiff(current, previous, width, height, x1, x2, y1, y2, stride = 1) {
    const minX = Math.max(0, Math.floor(width * x1));
    const maxX = Math.min(width, Math.ceil(width * x2));
    const minY = Math.max(0, Math.floor(height * y1));
    const maxY = Math.min(height, Math.ceil(height * y2));
    let sum = 0;
    let count = 0;
    for (let y = minY; y < maxY; y += stride) {
      for (let x = minX; x < maxX; x += stride) {
        const pos = y * width + x;
        sum += Math.abs(current[pos] - previous[pos]) / 255;
        count++;
      }
    }
    return sum / Math.max(1, count);
  }

  function nearestByTime(items, time) {
    if (!items.length) return null;
    let low = 0;
    let high = items.length - 1;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (items[mid].time < time) low = mid + 1;
      else high = mid;
    }
    const current = items[low];
    const previous = items[Math.max(0, low - 1)];
    return Math.abs((previous?.time ?? Infinity) - time) <= Math.abs((current?.time ?? Infinity) - time) ? previous : current;
  }

  function percentile(values, ratio) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * ratio)))];
  }

  function seekVideo(video, time) {
    return new Promise((resolve, reject) => {
      if (Math.abs(video.currentTime - time) < 0.008 && video.readyState >= 2) return resolve();
      const timer = setTimeout(() => { cleanup(); reject(new Error('動画フレームの読み込みがタイムアウトしました。')); }, 5000);
      const cleanup = () => {
        clearTimeout(timer);
        video.removeEventListener('seeked', done);
        video.removeEventListener('error', fail);
      };
      const done = () => { cleanup(); resolve(); };
      const fail = () => { cleanup(); reject(new Error('動画フレームを読み込めませんでした。')); };
      video.addEventListener('seeked', done, { once: true });
      video.addEventListener('error', fail, { once: true });
      try { video.currentTime = Math.max(0, time); } catch (error) { cleanup(); reject(error); }
    });
  }

  function waitFor(target, eventName, timeoutMs) {
    return new Promise((resolve, reject) => {
      if (eventName === 'loadeddata' && target.readyState >= 2) return resolve();
      const timer = setTimeout(() => { cleanup(); reject(new Error('動画情報の読み込みがタイムアウトしました。')); }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        target.removeEventListener(eventName, done);
        target.removeEventListener('error', fail);
      };
      const done = () => { cleanup(); resolve(); };
      const fail = () => { cleanup(); reject(new Error('動画を読み込めませんでした。')); };
      target.addEventListener(eventName, done, { once: true });
      target.addEventListener('error', fail, { once: true });
    });
  }

  function cleanEvent(item) {
    return {
      time: round(item.time, 3),
      score: round(item.score, 4),
      audio: round(item.audio, 4),
      visual: round(item.visual, 4),
      center: round(item.center, 4),
      killfeed: round(item.killfeed, 4),
      ammo: round(item.ammo, 4),
      killConfirm: round(item.killConfirm, 4),
      topCenter: round(item.topCenter, 4),
      kind: item.kind
    };
  }

  function round(value, digits) {
    const n = Number(value || 0);
    const p = 10 ** digits;
    return Math.round(n * p) / p;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  return { detect };
})();
