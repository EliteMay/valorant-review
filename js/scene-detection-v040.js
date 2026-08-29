window.VReviewSceneDetection = (() => {
  const SENSITIVITY = {
    low: {
      balancedThreshold: 0.60,
      audioMedium: 0.52,
      visualMedium: 0.36,
      visualStrong: 1.15,
      visualAudioMin: 0.52,
      visualFloor: 0.34,
      audioStrong: 1.05,
      transientCrest: 2.45,
      visualCrest: 2.15,
      killfeedGate: 1.10,
      killfeedAbsolute: 0.018,
      killfeedRatio: 1.12
    },
    standard: {
      balancedThreshold: 0.45,
      audioMedium: 0.40,
      visualMedium: 0.28,
      visualStrong: 0.78,
      visualAudioMin: 0.40,
      visualFloor: 0.28,
      audioStrong: 0.82,
      transientCrest: 2.25,
      visualCrest: 2.00,
      killfeedGate: 0.90,
      killfeedAbsolute: 0.010,
      killfeedRatio: 1.08
    },
    high: {
      balancedThreshold: 0.37,
      audioMedium: 0.31,
      visualMedium: 0.22,
      visualStrong: 0.68,
      visualAudioMin: 0.31,
      visualFloor: 0.22,
      audioStrong: 0.72,
      transientCrest: 2.10,
      visualCrest: 1.85,
      killfeedGate: 0.72,
      killfeedAbsolute: 0.008,
      killfeedRatio: 1.05
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
        onProgress({ phase: 'audio', progress: 0.03 + value * 0.29, message: '音声ピークを解析しています…' });
      });
    } catch (error) {
      warnings.push('音声解析を利用できなかったため、映像変化を中心に検出しました。');
    }

    onProgress({ phase: 'visual', progress: 0.33, message: '画面・キルフィード変化を解析しています…' });
    const visual = await analyzeVisual(file, duration, value => {
      onProgress({ phase: 'visual', progress: 0.33 + value * 0.52, message: '画面・キルフィード変化を解析しています…' });
    });

    onProgress({ phase: 'build', progress: 0.88, message: 'Combat Scene候補をまとめています…' });
    const events = buildEvents(audio, visual, sensitivity, duration);
    const scenes = buildScenes(events, duration);

    onProgress({ phase: 'done', progress: 1, message: `${scenes.length}件のCombat Scene候補を検出しました。` });
    return {
      scenes,
      warnings,
      sensitivity: sensitivityName,
      detectorVersion: '0.4.0',
      diagnostics: {
        audioSamples: audio.length,
        visualSamples: visual.length,
        eventCount: events.length,
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
          killfeedScore: round(item.killfeedScore, 4)
        })),
        events: events.map(item => ({
          time: round(item.time, 3),
          score: round(item.score, 4),
          audio: round(item.audio, 4),
          visual: round(item.visual, 4),
          killfeed: round(item.killfeed, 4),
          kind: item.kind
        }))
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
      const width = 128;
      const height = Math.max(64, Math.round(width * (video.videoHeight / Math.max(1, video.videoWidth))));
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('Canvasを初期化できませんでした。');

      const stepSeconds = duration <= 35 ? 0.20 : duration <= 75 ? 0.25 : 0.30;
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
        if (previous) {
          motion = regionDiff(current, previous, width, height, 0, 1, 0, 1, 2);
          centerMotion = regionDiff(current, previous, width, height, 0.20, 0.80, 0.18, 0.82, 2);
          killfeedMotion = regionDiff(current, previous, width, height, 0.67, 0.995, 0.035, 0.30, 1);
        }

        const killfeedExcess = previous ? Math.max(0, killfeedMotion - motion * 0.78) : 0;
        const killfeedRatio = previous ? killfeedMotion / Math.max(0.002, motion) : 0;
        samples.push({ time, motion, centerMotion, killfeedMotion, killfeedExcess, killfeedRatio });
        previous = current;
        if (index % 8 === 0) onProgress(Math.min(1, index / total));
      }

      const motionHigh = Math.max(percentile(samples.map(item => item.motion), 0.92), 0.001);
      const centerHigh = Math.max(percentile(samples.map(item => item.centerMotion), 0.92), 0.001);
      const killfeedCandidates = samples.map(item => item.killfeedExcess).filter(value => value > 0.001);
      const killfeedHigh = Math.max(percentile(killfeedCandidates, 0.88), 0.008);

      samples.forEach(item => {
        const overallScore = clamp(item.motion / motionHigh, 0, 1.8);
        const centerScore = clamp(item.centerMotion / centerHigh, 0, 1.8);
        item.killfeedScore = clamp(item.killfeedExcess / killfeedHigh, 0, 2.2);
        item.score = overallScore * 0.36 + centerScore * 0.54 + item.killfeedScore * 0.10;
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
    const events = [];

    if (audio.length) {
      for (const sample of audio) {
        const visualSample = nearestByTime(visual, sample.time);
        if (!visualSample) continue;

        const audioScore = sample.score || 0;
        const visualScore = visualSample.score || 0;
        const killfeedScore = visualSample.killfeedScore || 0;
        const weighted = audioScore * 0.52 + visualScore * 0.48;
        const killfeedEvent = visualSample.killfeedExcess >= sensitivity.killfeedAbsolute
          && killfeedScore >= sensitivity.killfeedGate
          && visualSample.killfeedRatio >= sensitivity.killfeedRatio;

        const visualHeavy = visualScore >= sensitivity.visualStrong
          && audioScore >= sensitivity.visualAudioMin
          && (sample.crest >= sensitivity.visualCrest || killfeedEvent);

        const balanced = audioScore >= sensitivity.audioMedium
          && visualScore >= sensitivity.visualMedium
          && weighted >= sensitivity.balancedThreshold
          && (sample.crest >= sensitivity.transientCrest || killfeedEvent);

        const audioDriven = audioScore >= sensitivity.audioStrong
          && visualScore >= sensitivity.visualFloor
          && (sample.crest >= sensitivity.transientCrest || killfeedEvent);

        if (!killfeedEvent && !visualHeavy && !balanced && !audioDriven) continue;

        let kind = 'balanced';
        if (killfeedEvent) kind = 'killfeed';
        else if (visualHeavy) kind = 'visual';
        else if (audioDriven) kind = 'audio-visual';

        const score = weighted + (killfeedEvent ? Math.min(0.42, killfeedScore * 0.16) : 0);
        events.push({
          time: sample.time,
          score,
          audio: audioScore,
          visual: visualScore,
          killfeed: killfeedScore,
          kind
        });
      }
    } else {
      for (const sample of visual) {
        const killfeedEvent = sample.killfeedExcess >= sensitivity.killfeedAbsolute
          && sample.killfeedScore >= sensitivity.killfeedGate
          && sample.killfeedRatio >= sensitivity.killfeedRatio;
        if (killfeedEvent || sample.score >= sensitivity.visualStrong * 1.18) {
          events.push({
            time: sample.time,
            score: sample.score + (killfeedEvent ? 0.25 : 0),
            audio: 0,
            visual: sample.score,
            killfeed: sample.killfeedScore || 0,
            kind: killfeedEvent ? 'killfeed' : 'visual-only'
          });
        }
      }
    }

    const peaks = [];
    for (const event of events.sort((a, b) => a.time - b.time)) {
      const last = peaks[peaks.length - 1];
      if (!last || event.time - last.time > 0.18) {
        peaks.push(event);
      } else if (event.score > last.score || event.kind === 'killfeed') {
        peaks[peaks.length - 1] = event;
      }
    }

    return peaks.filter(item => item.time >= 0 && item.time <= duration);
  }

  function buildScenes(events, duration) {
    if (!events.length) return [];
    const groups = [];
    let current = [events[0]];

    for (let i = 1; i < events.length; i++) {
      const gap = events[i].time - current[current.length - 1].time;
      if (gap <= 1.55) current.push(events[i]);
      else {
        groups.push(current);
        current = [events[i]];
      }
    }
    groups.push(current);

    const scenes = [];
    for (const group of groups) {
      const start = clamp(group[0].time - 0.8, 0, duration);
      const end = clamp(group[group.length - 1].time + 0.9, 0, duration);
      if (end - start < 0.75) continue;

      const maxScore = Math.max(...group.map(item => item.score));
      const avgScore = group.reduce((sum, item) => sum + item.score, 0) / group.length;
      const hasKillfeed = group.some(item => item.kind === 'killfeed');
      const evidenceKinds = new Set(group.map(item => item.kind)).size;
      const confidence = clamp(
        0.40
        + maxScore * 0.20
        + avgScore * 0.10
        + Math.min(group.length, 6) * 0.025
        + (hasKillfeed ? 0.10 : 0)
        + (evidenceKinds >= 2 ? 0.04 : 0),
        0.45,
        0.98
      );

      if (end - start <= 6.4) {
        scenes.push({ start, end, confidence, source: 'auto', fps: 'auto' });
        continue;
      }

      let segmentStart = start;
      let segmentEvents = [];
      for (const event of group) {
        if (event.time - segmentStart > 5.35 && segmentEvents.length) {
          const segmentEnd = clamp(segmentEvents[segmentEvents.length - 1].time + 0.9, segmentStart + 0.75, duration);
          scenes.push({ start: segmentStart, end: segmentEnd, confidence, source: 'auto', fps: 'auto' });
          segmentStart = clamp(event.time - 0.8, 0, duration);
          segmentEvents = [event];
        } else {
          segmentEvents.push(event);
        }
      }
      if (segmentEvents.length) {
        const segmentEnd = clamp(segmentEvents[segmentEvents.length - 1].time + 0.9, segmentStart + 0.75, duration);
        scenes.push({ start: segmentStart, end: segmentEnd, confidence, source: 'auto', fps: 'auto' });
      }
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
      if (scene.start <= last.end + 0.18 && Math.max(last.end, scene.end) - last.start <= 6.5) {
        last.end = clamp(Math.max(last.end, scene.end), 0, duration);
        last.confidence = Math.max(last.confidence, scene.confidence);
      } else {
        merged.push({ ...scene });
      }
    }
    return merged;
  }

  function regionDiff(current, previous, width, height, xMinRatio, xMaxRatio, yMinRatio, yMaxRatio, stride = 1) {
    const xMin = Math.max(0, Math.floor(width * xMinRatio));
    const xMax = Math.min(width, Math.ceil(width * xMaxRatio));
    const yMin = Math.max(0, Math.floor(height * yMinRatio));
    const yMax = Math.min(height, Math.ceil(height * yMaxRatio));
    let total = 0;
    let count = 0;

    for (let y = yMin; y < yMax; y += stride) {
      for (let x = xMin; x < xMax; x += stride) {
        const pos = y * width + x;
        total += Math.abs(current[pos] - previous[pos]) / 255;
        count++;
      }
    }
    return total / Math.max(1, count);
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
      if (Math.abs(video.currentTime - time) < 0.012 && video.readyState >= 2) return resolve();
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
        video.currentTime = time;
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  }

  function waitFor(target, eventName, timeoutMs) {
    return new Promise((resolve, reject) => {
      if (eventName === 'loadedmetadata' && target.readyState >= 1) return resolve();
      if (eventName === 'loadeddata' && target.readyState >= 2) return resolve();
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

  function round(value, digits) {
    if (!Number.isFinite(value)) return 0;
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  return { detect };
})();