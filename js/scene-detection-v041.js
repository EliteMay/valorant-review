window.VReviewSceneDetection = (() => {
  const SENSITIVITY = {
    low: {
      balancedThreshold: 0.58,
      audioMedium: 0.50,
      visualMedium: 0.36,
      visualStrong: 1.00,
      visualAudioMin: 0.46,
      visualFloor: 0.36,
      audioStrong: 0.98,
      transientCrest: 2.40,
      visualCrest: 2.10,
      killfeedGate: 1.10,
      killfeedAbsolute: 0.014,
      killfeedRatio: 1.15,
      ammoGate: 1.00,
      ammoAbsolute: 0.010,
      ammoRatio: 1.08,
      ammoAudioMin: 0.60
    },
    standard: {
      balancedThreshold: 0.46,
      audioMedium: 0.42,
      visualMedium: 0.33,
      visualStrong: 0.86,
      visualAudioMin: 0.42,
      visualFloor: 0.34,
      audioStrong: 0.90,
      transientCrest: 2.20,
      visualCrest: 1.95,
      killfeedGate: 0.88,
      killfeedAbsolute: 0.009,
      killfeedRatio: 1.10,
      ammoGate: 0.78,
      ammoAbsolute: 0.007,
      ammoRatio: 1.04,
      ammoAudioMin: 0.50
    },
    high: {
      balancedThreshold: 0.38,
      audioMedium: 0.34,
      visualMedium: 0.27,
      visualStrong: 0.72,
      visualAudioMin: 0.34,
      visualFloor: 0.28,
      audioStrong: 0.78,
      transientCrest: 2.00,
      visualCrest: 1.80,
      killfeedGate: 0.72,
      killfeedAbsolute: 0.007,
      killfeedRatio: 1.06,
      ammoGate: 0.62,
      ammoAbsolute: 0.005,
      ammoRatio: 1.02,
      ammoAudioMin: 0.36
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

    onProgress({ phase: 'audio', progress: 0.03, message: '音声ピークを解析しています…' });
    let audio = [];
    try {
      audio = await analyzeAudio(file, duration, value => {
        onProgress({ phase: 'audio', progress: 0.03 + value * 0.28, message: '音声ピークを解析しています…' });
      });
    } catch (error) {
      warnings.push('音声解析を利用できなかったため、映像変化を中心に検出しました。');
    }

    onProgress({ phase: 'visual', progress: 0.32, message: '画面・キルフィード・弾数HUDを解析しています…' });
    const visual = await analyzeVisual(file, duration, value => {
      onProgress({ phase: 'visual', progress: 0.32 + value * 0.53, message: '画面・キルフィード・弾数HUDを解析しています…' });
    });

    onProgress({ phase: 'build', progress: 0.88, message: 'Combat Scene候補をまとめています…' });
    const { events, suppressed } = buildEvents(audio, visual, sensitivity, duration);
    const scenes = buildScenes(events, duration);

    onProgress({ phase: 'done', progress: 1, message: `${scenes.length}件のCombat Scene候補を検出しました。` });
    return {
      scenes,
      warnings,
      sensitivity: sensitivityName,
      detectorVersion: '0.4.1',
      diagnostics: {
        audioSamples: audio.length,
        visualSamples: visual.length,
        eventCount: events.length,
        suppressedCount: suppressed.length,
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
          killfeedMotion: round(item.killfeedMotion, 5),
          killfeedExcess: round(item.killfeedExcess, 5),
          killfeedRatio: round(item.killfeedRatio, 4),
          killfeedScore: round(item.killfeedScore, 4),
          ammoMotion: round(item.ammoMotion, 5),
          ammoExcess: round(item.ammoExcess, 5),
          ammoRatio: round(item.ammoRatio, 4),
          ammoScore: round(item.ammoScore, 4),
          topCenterMotion: round(item.topCenterMotion, 5),
          topCenterScore: round(item.topCenterScore, 4)
        })),
        events: events.map(cleanEvent),
        suppressed: suppressed.map(cleanEvent)
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
        const stride = 2;

        for (let i = start; i < end; i += stride) {
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

        if (index % 80 === 0) onProgress(Math.min(1, start / Math.max(1, length)));
      }

      const rmsBase = percentile(samples.map(item => item.rms), 0.55);
      const rmsHigh = Math.max(percentile(samples.map(item => item.rms), 0.96), rmsBase + 0.0001);
      const riseHigh = Math.max(percentile(samples.map(item => item.rise), 0.94), 0.0001);

      samples.forEach(item => {
        const loudness = clamp((item.rms - rmsBase) / (rmsHigh - rmsBase), 0, 1.8);
        const rise = clamp(item.rise / riseHigh, 0, 1.8);
        const crest = clamp((item.crest - 1.6) / 4.2, 0, 1);
        item.score = loudness * 0.55 + rise * 0.32 + crest * 0.13;
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
      const width = 144;
      const height = Math.max(72, Math.round(width * (video.videoHeight / Math.max(1, video.videoWidth))));
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('Canvasを初期化できませんでした。');

      const stepSeconds = duration <= 35 ? 0.16 : duration <= 75 ? 0.20 : 0.25;
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
        let topCenterMotion = 0;

        if (previous) {
          motion = regionDiff(current, previous, width, height, 0, 1, 0, 1, 2);
          centerMotion = regionDiff(current, previous, width, height, 0.22, 0.78, 0.18, 0.82, 2);
          killfeedMotion = regionDiff(current, previous, width, height, 0.72, 0.995, 0.045, 0.235, 1);
          ammoMotion = regionDiff(current, previous, width, height, 0.64, 0.76, 0.875, 0.995, 1);
          topCenterMotion = regionDiff(current, previous, width, height, 0.34, 0.66, 0.00, 0.20, 1);
        }

        const killfeedExcess = previous ? Math.max(0, killfeedMotion - motion * 0.76) : 0;
        const killfeedRatio = previous ? killfeedMotion / Math.max(0.002, motion) : 0;
        const ammoExcess = previous ? Math.max(0, ammoMotion - motion * 0.38) : 0;
        const ammoRatio = previous ? ammoMotion / Math.max(0.002, motion) : 0;

        samples.push({
          time,
          motion,
          centerMotion,
          killfeedMotion,
          killfeedExcess,
          killfeedRatio,
          ammoMotion,
          ammoExcess,
          ammoRatio,
          topCenterMotion
        });

        previous = current;
        if (index % 8 === 0) onProgress(Math.min(1, index / total));
      }

      const motionHigh = Math.max(percentile(samples.map(item => item.motion), 0.92), 0.001);
      const centerHigh = Math.max(percentile(samples.map(item => item.centerMotion), 0.92), 0.001);
      const killfeedValues = samples.map(item => item.killfeedExcess).filter(value => value > 0.001);
      const killfeedHigh = Math.max(percentile(killfeedValues, 0.88), 0.006);
      const ammoValues = samples.map(item => item.ammoExcess).filter(value => value > 0.0007);
      const ammoHigh = Math.max(percentile(ammoValues, 0.86), 0.0045);
      const topCenterHigh = Math.max(percentile(samples.map(item => item.topCenterMotion), 0.92), 0.001);

      samples.forEach(item => {
        const overallScore = clamp(item.motion / motionHigh, 0, 1.8);
        const centerScore = clamp(item.centerMotion / centerHigh, 0, 1.8);
        item.killfeedScore = clamp(item.killfeedExcess / killfeedHigh, 0, 2.2);
        item.ammoScore = clamp(item.ammoExcess / ammoHigh, 0, 2.2);
        item.topCenterScore = clamp(item.topCenterMotion / topCenterHigh, 0, 2.0);
        item.score =
          overallScore * 0.29 +
          centerScore * 0.49 +
          item.killfeedScore * 0.08 +
          item.ammoScore * 0.14;
      });

      onProgress(1);
      return samples;
    } finally {
      URL.revokeObjectURL(url);
      video.removeAttribute('src');
      video.load();
    }
  }

  function buildEvents(audio, visual, sensitivity, duration) {
    const raw = [];
    const suppressed = [];

    if (audio.length) {
      for (const sample of audio) {
        const v = nearestByTime(visual, sample.time);
        if (!v) continue;

        const audioScore = sample.score || 0;
        const visualScore = v.score || 0;
        const killfeedScore = v.killfeedScore || 0;
        const ammoScore = v.ammoScore || 0;
        const weighted = audioScore * 0.50 + visualScore * 0.50;

        const killfeedEvent =
          v.killfeedExcess >= sensitivity.killfeedAbsolute &&
          killfeedScore >= sensitivity.killfeedGate &&
          v.killfeedRatio >= sensitivity.killfeedRatio;

        const ammoEvent =
          v.ammoExcess >= sensitivity.ammoAbsolute &&
          ammoScore >= sensitivity.ammoGate &&
          v.ammoRatio >= sensitivity.ammoRatio;

        const shotHud =
          ammoEvent &&
          audioScore >= sensitivity.ammoAudioMin &&
          sample.crest >= 1.70 &&
          visualScore >= sensitivity.visualFloor * 0.72;

        const balanced =
          audioScore >= sensitivity.audioMedium &&
          visualScore >= sensitivity.visualMedium &&
          weighted >= sensitivity.balancedThreshold &&
          sample.crest >= sensitivity.transientCrest;

        const visualHeavy =
          visualScore >= sensitivity.visualStrong &&
          audioScore >= sensitivity.visualAudioMin &&
          sample.crest >= sensitivity.visualCrest &&
          (ammoEvent || killfeedEvent || audioScore >= sensitivity.audioStrong * 0.82);

        const audioDriven =
          audioScore >= sensitivity.audioStrong &&
          visualScore >= sensitivity.visualFloor &&
          sample.crest >= sensitivity.transientCrest &&
          (ammoEvent || visualScore >= sensitivity.visualMedium * 1.25);

        const localCombat =
          shotHud ||
          balanced ||
          visualHeavy ||
          audioDriven ||
          (audioScore >= sensitivity.audioMedium * 0.90 && visualScore >= sensitivity.visualMedium);

        const roundTransitionLike =
          v.topCenterScore >= 1.25 &&
          audioScore < sensitivity.audioMedium * 0.65 &&
          !ammoEvent;

        const killfeedSupported = killfeedEvent && localCombat && !roundTransitionLike;

        if (!shotHud && !balanced && !visualHeavy && !audioDriven && !killfeedSupported) {
          if (killfeedEvent || ammoEvent || visualScore >= sensitivity.visualStrong || audioScore >= sensitivity.audioStrong) {
            suppressed.push({
              time: sample.time,
              score: weighted,
              audio: audioScore,
              visual: visualScore,
              killfeed: killfeedScore,
              ammo: ammoScore,
              topCenter: v.topCenterScore || 0,
              kind: roundTransitionLike ? 'suppressed-round-ui' : killfeedEvent ? 'suppressed-killfeed-only' : ammoEvent ? 'suppressed-ammo-only' : 'suppressed-weak'
            });
          }
          continue;
        }

        let kind = 'balanced';
        if (shotHud) kind = 'shot-hud';
        else if (killfeedSupported) kind = 'killfeed-combat';
        else if (visualHeavy) kind = 'visual-combat';
        else if (audioDriven) kind = 'audio-visual';

        const score =
          weighted +
          (shotHud ? Math.min(0.30, ammoScore * 0.13) : 0) +
          (killfeedSupported ? Math.min(0.32, killfeedScore * 0.13) : 0);

        raw.push({
          time: sample.time,
          score,
          audio: audioScore,
          visual: visualScore,
          killfeed: killfeedScore,
          ammo: ammoScore,
          topCenter: v.topCenterScore || 0,
          kind
        });
      }
    } else {
      for (const v of visual) {
        const ammoEvent =
          v.ammoExcess >= sensitivity.ammoAbsolute &&
          v.ammoScore >= sensitivity.ammoGate &&
          v.ammoRatio >= sensitivity.ammoRatio;

        const visualOnly = ammoEvent && v.score >= sensitivity.visualStrong * 0.90;
        if (!visualOnly) continue;

        raw.push({
          time: v.time,
          score: v.score + Math.min(0.25, v.ammoScore * 0.12),
          audio: 0,
          visual: v.score,
          killfeed: v.killfeedScore || 0,
          ammo: v.ammoScore || 0,
          topCenter: v.topCenterScore || 0,
          kind: 'visual-ammo'
        });
      }
    }

    const peaks = [];
    for (const event of raw.sort((a, b) => a.time - b.time)) {
      const last = peaks[peaks.length - 1];
      if (!last || event.time - last.time > 0.16) {
        peaks.push(event);
      } else if (
        event.score > last.score ||
        event.kind === 'killfeed-combat' ||
        event.kind === 'shot-hud'
      ) {
        peaks[peaks.length - 1] = event;
      }
    }

    return {
      events: peaks.filter(item => item.time >= 0 && item.time <= duration),
      suppressed
    };
  }

  function buildScenes(events, duration) {
    if (!events.length) return [];

    const groups = [];
    let current = [events[0]];

    for (let i = 1; i < events.length; i++) {
      const gap = events[i].time - current[current.length - 1].time;
      if (gap <= 1.45) {
        current.push(events[i]);
      } else {
        groups.push(current);
        current = [events[i]];
      }
    }
    groups.push(current);

    const scenes = [];

    for (const group of groups) {
      const hasKill = group.some(item => item.kind === 'killfeed-combat');
      const hasShotHud = group.some(item => item.kind === 'shot-hud' || item.kind === 'visual-ammo');
      const highEvidence = group.filter(item =>
        item.kind === 'shot-hud' ||
        item.kind === 'balanced' ||
        item.kind === 'audio-visual' ||
        item.kind === 'visual-combat' ||
        item.kind === 'visual-ammo'
      );

      if (group.length < 2 && !(hasKill && hasShotHud)) continue;

      const first = group[0].time;
      const last = group[group.length - 1].time;
      const span = Math.max(0.001, last - first);

      if (!hasKill && !hasShotHud && highEvidence.length < 3 && span > 1.60) continue;

      const start = clamp(first - 0.70, 0, duration);
      const end = clamp(last + 0.80, 0, duration);
      if (end - start < 0.65) continue;

      const maxScore = Math.max(...group.map(item => item.score));
      const avgScore = group.reduce((sum, item) => sum + item.score, 0) / group.length;
      const evidenceBonus =
        Math.min(group.length, 8) * 0.025 +
        (hasKill ? 0.07 : 0) +
        (hasShotHud ? 0.07 : 0);

      const confidence = clamp(0.42 + maxScore * 0.18 + avgScore * 0.10 + evidenceBonus, 0.45, 0.98);

      scenes.push({
        start,
        end,
        confidence,
        source: 'auto',
        fps: 'auto',
        detectorEvidence: {
          events: group.length,
          killfeed: hasKill,
          ammo: hasShotHud
        }
      });
    }

    return mergeOverlaps(scenes, duration);
  }

  function mergeOverlaps(scenes, duration) {
    if (!scenes.length) return [];

    const sorted = [...scenes].sort((a, b) => a.start - b.start);
    const merged = [{ ...sorted[0] }];

    for (let i = 1; i < sorted.length; i++) {
      const scene = sorted[i];
      const last = merged[merged.length - 1];

      if (scene.start <= last.end + 0.20 && Math.max(last.end, scene.end) - last.start <= 8.5) {
        last.end = clamp(Math.max(last.end, scene.end), 0, duration);
        last.confidence = Math.max(last.confidence, scene.confidence);
        last.detectorEvidence = {
          events: (last.detectorEvidence?.events || 0) + (scene.detectorEvidence?.events || 0),
          killfeed: Boolean(last.detectorEvidence?.killfeed || scene.detectorEvidence?.killfeed),
          ammo: Boolean(last.detectorEvidence?.ammo || scene.detectorEvidence?.ammo)
        };
      } else {
        merged.push({ ...scene });
      }
    }

    return merged;
  }

  function regionDiff(current, previous, width, height, x0, x1, y0, y1, stride = 1) {
    const startX = clamp(Math.floor(width * x0), 0, width - 1);
    const endX = clamp(Math.ceil(width * x1), startX + 1, width);
    const startY = clamp(Math.floor(height * y0), 0, height - 1);
    const endY = clamp(Math.ceil(height * y1), startY + 1, height);

    let sum = 0;
    let count = 0;

    for (let y = startY; y < endY; y += stride) {
      for (let x = startX; x < endX; x += stride) {
        const pos = y * width + x;
        sum += Math.abs(current[pos] - previous[pos]) / 255;
        count++;
      }
    }

    return count ? sum / count : 0;
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
    return Math.abs((previous?.time ?? Infinity) - time) <= Math.abs((current?.time ?? Infinity) - time)
      ? previous
      : current;
  }

  function percentile(values, ratio) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * ratio)));
    return sorted[index];
  }

  function seekVideo(video, time) {
    return new Promise((resolve, reject) => {
      if (Math.abs(video.currentTime - time) < 0.012 && video.readyState >= 2) {
        resolve();
        return;
      }

      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('動画フレームの読み込みがタイムアウトしました。'));
      }, 4500);

      const onSeeked = () => {
        cleanup();
        resolve();
      };

      const onError = () => {
        cleanup();
        reject(new Error('動画フレームを読み込めませんでした。'));
      };

      const cleanup = () => {
        clearTimeout(timer);
        video.removeEventListener('seeked', onSeeked);
        video.removeEventListener('error', onError);
      };

      video.addEventListener('seeked', onSeeked, { once: true });
      video.addEventListener('error', onError, { once: true });

      try {
        video.currentTime = Math.max(0, time);
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  }

  function waitFor(target, eventName, timeoutMs) {
    return new Promise((resolve, reject) => {
      if (eventName === 'loadedmetadata' && target.readyState >= 1) {
        resolve();
        return;
      }
      if (eventName === 'loadeddata' && target.readyState >= 2) {
        resolve();
        return;
      }

      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('動画情報の読み込みがタイムアウトしました。'));
      }, timeoutMs);

      const onDone = () => {
        cleanup();
        resolve();
      };

      const onError = () => {
        cleanup();
        reject(new Error('動画を読み込めませんでした。'));
      };

      const cleanup = () => {
        clearTimeout(timer);
        target.removeEventListener(eventName, onDone);
        target.removeEventListener('error', onError);
      };

      target.addEventListener(eventName, onDone, { once: true });
      target.addEventListener('error', onError, { once: true });
    });
  }

  function cleanEvent(item) {
    return {
      time: round(item.time, 3),
      score: round(item.score, 4),
      audio: round(item.audio, 4),
      visual: round(item.visual, 4),
      killfeed: round(item.killfeed, 4),
      ammo: round(item.ammo, 4),
      topCenter: round(item.topCenter, 4),
      kind: item.kind
    };
  }

  function round(value, digits) {
    const number = Number(value || 0);
    const p = 10 ** digits;
    return Math.round(number * p) / p;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  return { detect };
})();