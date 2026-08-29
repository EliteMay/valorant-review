window.VReviewSceneDetection = (() => {
  const SENSITIVITY = {
    low: { threshold: 1.18, audioGate: 0.95, visualGate: 0.48 },
    standard: { threshold: 0.92, audioGate: 0.72, visualGate: 0.34 },
    high: { threshold: 0.72, audioGate: 0.55, visualGate: 0.25 }
  };

  async function detect(file, options = {}) {
    if (!file) throw new Error('解析する動画がありません。');
    const duration = Math.max(0, Number(options.duration || 0));
    if (!duration) throw new Error('動画時間を取得できませんでした。');

    const sensitivityName = options.sensitivity || 'standard';
    const sensitivity = SENSITIVITY[sensitivityName] || SENSITIVITY.standard;
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
    const warnings = [];

    onProgress({ phase: 'audio', progress: 0.04, message: '音声ピークを解析しています…' });
    let audio = [];
    try {
      audio = await analyzeAudio(file, duration, value => {
        onProgress({ phase: 'audio', progress: 0.04 + value * 0.31, message: '音声ピークを解析しています…' });
      });
    } catch (error) {
      warnings.push('音声解析を利用できなかったため、映像変化を中心に検出しました。');
    }

    onProgress({ phase: 'visual', progress: 0.36, message: '画面変化を解析しています…' });
    const visual = await analyzeVisual(file, duration, value => {
      onProgress({ phase: 'visual', progress: 0.36 + value * 0.48, message: '画面変化を解析しています…' });
    });

    onProgress({ phase: 'build', progress: 0.88, message: 'Combat Scene候補をまとめています…' });
    const events = buildEvents(audio, visual, sensitivity, duration);
    const scenes = buildScenes(events, duration);

    onProgress({ phase: 'done', progress: 1, message: `${scenes.length}件のCombat Scene候補を検出しました。` });
    return {
      scenes,
      warnings,
      sensitivity: sensitivityName,
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
          centerMotion: round(item.centerMotion, 5)
        })),
        events: events.map(item => ({
          time: round(item.time, 3),
          score: round(item.score, 4),
          audio: round(item.audio, 4),
          visual: round(item.visual, 4)
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
      const width = 96;
      const height = Math.max(48, Math.round(width * (video.videoHeight / Math.max(1, video.videoWidth))));
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('Canvasを初期化できませんでした。');

      const stepSeconds = duration > 45 ? 0.3 : 0.25;
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

        let diff = 0;
        let centerDiff = 0;
        let centerCount = 0;
        if (previous) {
          for (let y = 0; y < height; y += 2) {
            for (let x = 0; x < width; x += 2) {
              const pos = y * width + x;
              const delta = Math.abs(current[pos] - previous[pos]) / 255;
              diff += delta;
              if (x >= width * 0.2 && x <= width * 0.8 && y >= height * 0.18 && y <= height * 0.82) {
                centerDiff += delta;
                centerCount++;
              }
            }
          }
        }
        const overallCount = Math.ceil(width / 2) * Math.ceil(height / 2);
        samples.push({
          time,
          motion: previous ? diff / overallCount : 0,
          centerMotion: previous ? centerDiff / Math.max(1, centerCount) : 0
        });
        previous = current;
        if (index % 8 === 0) onProgress(Math.min(1, index / total));
      }

      const motionHigh = Math.max(percentile(samples.map(item => item.motion), 0.92), 0.001);
      const centerHigh = Math.max(percentile(samples.map(item => item.centerMotion), 0.92), 0.001);
      samples.forEach(item => {
        item.score = clamp(item.motion / motionHigh, 0, 1.7) * 0.45 + clamp(item.centerMotion / centerHigh, 0, 1.7) * 0.55;
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
        const visualScore = visualSample?.score || 0;
        const combined = sample.score * 0.74 + visualScore * 0.26;
        const strongAudio = sample.score >= sensitivity.audioGate;
        const strongVisual = visualScore >= sensitivity.visualGate;
        if (combined >= sensitivity.threshold || (strongAudio && strongVisual)) {
          events.push({ time: sample.time, score: combined, audio: sample.score, visual: visualScore });
        }
      }
    } else {
      for (const sample of visual) {
        if (sample.score >= sensitivity.visualGate * 1.45) {
          events.push({ time: sample.time, score: sample.score * 0.85, audio: 0, visual: sample.score });
        }
      }
    }

    const peaks = [];
    for (const event of events) {
      const last = peaks[peaks.length - 1];
      if (!last || event.time - last.time > 0.18) {
        peaks.push(event);
      } else if (event.score > last.score) {
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
      if (events[i].time - current[current.length - 1].time <= 1.5) current.push(events[i]);
      else {
        groups.push(current);
        current = [events[i]];
      }
    }
    groups.push(current);

    const scenes = [];
    for (const group of groups) {
      const start = clamp(group[0].time - 0.7, 0, duration);
      const end = clamp(group[group.length - 1].time + 0.8, 0, duration);
      if (end - start < 0.75) continue;
      const maxScore = Math.max(...group.map(item => item.score));
      const avgScore = group.reduce((sum, item) => sum + item.score, 0) / group.length;
      const confidence = clamp(0.45 + maxScore * 0.22 + avgScore * 0.11 + Math.min(group.length, 6) * 0.025, 0.45, 0.98);

      if (end - start <= 6.2) {
        scenes.push({ start, end, confidence, source: 'auto', fps: 'auto' });
        continue;
      }

      let segmentStart = start;
      let segmentEvents = [];
      for (const event of group) {
        if (event.time - segmentStart > 5.2 && segmentEvents.length) {
          const segmentEnd = clamp(segmentEvents[segmentEvents.length - 1].time + 0.8, segmentStart + 0.75, duration);
          scenes.push({ start: segmentStart, end: segmentEnd, confidence, source: 'auto', fps: 'auto' });
          segmentStart = clamp(event.time - 0.7, 0, duration);
          segmentEvents = [event];
        } else {
          segmentEvents.push(event);
        }
      }
      if (segmentEvents.length) {
        const segmentEnd = clamp(segmentEvents[segmentEvents.length - 1].time + 0.8, segmentStart + 0.75, duration);
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
      if (scene.start <= last.end + 0.18 && Math.max(last.end, scene.end) - last.start <= 6.4) {
        last.end = clamp(Math.max(last.end, scene.end), 0, duration);
        last.confidence = Math.max(last.confidence, scene.confidence);
      } else {
        merged.push({ ...scene });
      }
    }
    return merged;
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
      }, 4000);
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
      video.currentTime = time;
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
    const p = 10 ** digits;
    return Math.round(Number(value || 0) * p) / p;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  return { detect };
})();