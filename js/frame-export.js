// Local timestamp-sampled export. Browser seeking does not guarantee exact frames.
window.VReviewFrameExport = (() => {
  const MAX_FRAMES = 180;
  const MAX_BYTES = 100 * 1024 * 1024;
  const round = n => Math.round(n * 1000) / 1000;
  const abortError = () => new DOMException('中止しました。', 'AbortError');
  function planFrames(start, end, fps, duration) {
    [start, end, fps, duration] = [start, end, fps, duration].map(Number);
    if (![start, end, fps, duration].every(Number.isFinite) ||
        duration <= 0 || start < 0 || end <= start || end > duration + 0.001 ||
        ![10, 30, 60].includes(fps)) throw new Error('時間範囲または抽出頻度を確認してください。');
    const count = Math.ceil((end - start) * fps - 1e-8);
    if (count < 1 || count > MAX_FRAMES) throw new Error('最大180枚です。範囲を短くするかfpsを下げてください。');
    return Array.from({ length: count }, (_, i) => start + i / fps);
  }
  function waitFor(video, eventName, signal, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      let timer;
      const cleanup = () => {
        clearTimeout(timer);
        video.removeEventListener(eventName, succeed);
        video.removeEventListener('error', fail);
        signal?.removeEventListener('abort', abort);
      };
      const succeed = () => { cleanup(); resolve(); };
      const fail = () => { cleanup(); reject(new Error('動画の読み取りに失敗しました。')); };
      const abort = () => { cleanup(); reject(abortError()); };
      if (signal?.aborted) return abort();
      video.addEventListener(eventName, succeed, { once: true });
      video.addEventListener('error', fail, { once: true });
      signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => { cleanup(); reject(new Error('フレーム取得がタイムアウトしました。')); }, timeoutMs);
    });
  }
  const toJpeg = canvas => new Promise((resolve, reject) =>
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('JPEG変換に失敗しました。')), 'image/jpeg', 0.91)
  );
  async function exportFrames({ file, videoData, start, end, fps, signal, onProgress = () => {} }) {
    if (!file || !videoData) throw new Error('先に動画を読み込んでください。');
    const times = planFrames(start, end, fps, videoData.duration);
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'auto';
    video.playsInline = true;
    video.muted = true;
    const canvas = document.createElement('canvas');
    const files = [];
    let byteCount = 0;
    const manifest = {
      schema: 'vreview-sampled-frame-evidence', version: 1,
      source: file.name, source_duration_seconds: round(videoData.duration),
      range_seconds: [Number(start), Number(end)], requested_fps: Number(fps),
      method: 'HTMLVideoElement seek + Canvas',
      warning: '要求時刻へのseek抽出であり、厳密なフレーム番号・表示時刻を保証しません。',
      frames: []
    };
    try {
      video.src = url;
      if (video.readyState < 2) await waitFor(video, 'loadeddata', signal, 15000);
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx || !canvas.width || !canvas.height) throw new Error('動画画像を取得できません。');
      manifest.width = canvas.width;
      manifest.height = canvas.height;
      for (let i = 0; i < times.length; i++) {
        if (signal?.aborted) throw abortError();
        const time = times[i];
        if (Math.abs(video.currentTime - time) >= 0.0005) {
          const seeked = waitFor(video, 'seeked', signal);
          video.currentTime = time;
          await seeked;
        }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const jpg = await toJpeg(canvas);
        byteCount += jpg.size;
        if (byteCount > MAX_BYTES) throw new Error('画像が合計100MBを超えました。範囲を短くしてください。');
        const name = 'frames/' + String(i + 1).padStart(4, '0') +
          '_' + String(Math.round(time * 1000)).padStart(9, '0') + 'ms.jpg';
        files.push({ name, data: new Uint8Array(await jpg.arrayBuffer()) });
        manifest.frames.push({ name, requested_seconds: Math.round(time * 1e6) / 1e6, seek_seconds: round(video.currentTime) });
        onProgress(0.90 * (i + 1) / times.length, (i + 1) + '/' + times.length + '枚を抽出中');
      }
      if (signal?.aborted) throw abortError();
      const encode = new TextEncoder();
      files.push({ name: 'manifest.json', data: encode.encode(JSON.stringify(manifest, null, 2)) });
      files.push({ name: 'README.txt', data: encode.encode(
        'VReview ローカル画像抽出\n元動画や音声はZIPに含まれません。\n画像は要求時刻で抽出したものです。厳密なフレーム番号や時刻ではありません。\nキル数・HPなどは複数画像で照合してください。\n'
      ) });
      const archive = window.VReviewFeedbackPackage?.createArchive;
      if (typeof archive !== 'function') throw new Error('ZIP作成機能が使えません。');
      const blob = archive(files, p => onProgress(0.9 + 0.1 * p, 'ZIPを作成中'));
      onProgress(1, '完了');
      return { blob, manifest, filename: 'vreview_frames_' + Date.now() + '.zip' };
    } finally {
      URL.revokeObjectURL(url);
      video.removeAttribute('src');
      video.load();
      canvas.width = canvas.height = 0;
    }
  }
  function init({ preview, getVideo }) {
    const ids = ['frameStart', 'frameEnd', 'frameFps', 'frameExportBtn',
      'frameCancelBtn', 'frameProgress', 'frameStatus', 'frameCount'];
    const [start, end, fps, button, cancel, progress, status, count] =
      ids.map(id => document.getElementById(id));
    if (ids.some(id => !document.getElementById(id))) return null;
    let controller = null;
    const validate = () => {
      try {
        const source = getVideo();
        const countValue = planFrames(start.value, end.value, fps.value, source?.videoData?.duration).length;
        count.textContent = countValue + '枚出力予定（上限180枚）';
        button.disabled = Boolean(controller);
      } catch (error) {
        count.textContent = error.message;
        button.disabled = true;
      }
    };
    [start, end, fps].forEach(el => el.addEventListener('input', validate));
    document.getElementById('frameUseStart')?.addEventListener('click', () => {
      start.value = String(round(preview.currentTime)); validate();
    });
    document.getElementById('frameUseEnd')?.addEventListener('click', () => {
      end.value = String(round(preview.currentTime)); validate();
    });
    cancel.addEventListener('click', () => controller?.abort());
    button.addEventListener('click', async () => {
      if (controller) return;
      const source = getVideo();
      controller = new AbortController();
      button.disabled = true;
      cancel.disabled = false;
      progress.value = 0;
      status.textContent = '画像化の準備中…';
      try {
        const result = await exportFrames({
          ...source, start: start.value, end: end.value, fps: fps.value,
          signal: controller.signal,
          onProgress: (value, text) => {
            progress.value = Math.round(value * 100);
            status.textContent = text;
          }
        });
        if (controller.signal.aborted) throw abortError();
        window.VReviewFeedbackPackage.download(result.blob, result.filename);
        status.textContent = result.manifest.frames.length + '枚をZIP化しました。ダウンロードをご確認ください。';
      } catch (error) {
        status.textContent = error.name === 'AbortError' ? '画像化を中止しました。' :
          (error.message || '画像化に失敗しました。');
      } finally {
        controller = null;
        cancel.disabled = true;
        validate();
      }
    });
    return {
      isBusy: () => Boolean(controller),
      reset(duration) {
        start.value = '0';
        end.value = String(round(Math.min(3, Number(duration))));
        progress.value = 0;
        status.textContent = '';
        validate();
      }
    };
  }
  return { MAX_FRAMES, planFrames, exportFrames, init };
})();
