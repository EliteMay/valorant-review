window.VReviewFeedbackPackage = (() => {
  async function build(options = {}) {
    const { file, videoData, detectionRun, correctedScenes = [], notes = '', onProgress = () => {} } = options;
    if (!file || !videoData) throw new Error('元動画を読み込んでから提出用パッケージを作成してください。');
    if (!window.JSZip) throw new Error('ZIPライブラリを読み込めませんでした。ページを再読み込みしてもう一度試してください。');
    if (!detectionRun) throw new Error('先にCombat Scene自動検出を実行してください。');

    const zip = new JSZip();
    const originalScenes = Array.isArray(detectionRun.scenes) ? detectionRun.scenes : [];
    const corrected = Array.isArray(correctedScenes) ? correctedScenes : [];
    const timestamp = new Date().toISOString();

    const manifest = {
      schema: 'vreview-detector-feedback',
      version: 1,
      created_at: timestamp,
      video: {
        name: file.name,
        type: file.type,
        size_bytes: file.size,
        duration: round(videoData.duration, 3),
        width: videoData.width,
        height: videoData.height
      },
      detection: {
        sensitivity: detectionRun.sensitivity || 'standard',
        warnings: detectionRun.warnings || [],
        diagnostics: detectionRun.diagnostics || {}
      },
      counts: {
        auto_scenes: originalScenes.length,
        corrected_scenes: corrected.length,
        manual_scenes: corrected.filter(scene => scene.source === 'manual').length,
        edited_scenes: corrected.filter(scene => scene.source === 'edited').length
      }
    };

    zip.file('README.txt', buildReadme());
    zip.file('manifest.json', JSON.stringify(manifest, null, 2));
    zip.file('auto-scenes.json', JSON.stringify(cleanScenes(originalScenes), null, 2));
    zip.file('corrected-scenes.json', JSON.stringify(cleanScenes(corrected), null, 2));
    zip.file('detector-diagnostics.json', JSON.stringify(detectionRun.diagnosticData || {}, null, 2));
    zip.file('notes.txt', notes || 'ユーザーメモなし');

    const totalSheets = originalScenes.length + corrected.length;
    let sheetIndex = 0;
    const source = await createVideoSource(file);
    try {
      const autoFolder = zip.folder('auto-scenes');
      for (let i = 0; i < originalScenes.length; i++) {
        const scene = originalScenes[i];
        onProgress(progressPart(sheetIndex, totalSheets), `自動検出Scene ${i + 1}/${originalScenes.length} の確認画像を作成しています…`);
        const blob = await createSceneSheet(source.video, scene, videoData.duration, `AUTO ${String(i + 1).padStart(2, '0')}`);
        autoFolder.file(`auto_${String(i + 1).padStart(2, '0')}.jpg`, blob);
        sheetIndex++;
      }

      const correctedFolder = zip.folder('corrected-scenes');
      for (let i = 0; i < corrected.length; i++) {
        const scene = corrected[i];
        onProgress(progressPart(sheetIndex, totalSheets), `修正後Scene ${i + 1}/${corrected.length} の確認画像を作成しています…`);
        const blob = await createSceneSheet(source.video, scene, videoData.duration, `${String(scene.source || 'corrected').toUpperCase()} ${String(i + 1).padStart(2, '0')}`);
        correctedFolder.file(`corrected_${String(i + 1).padStart(2, '0')}.jpg`, blob);
        sheetIndex++;
      }
    } finally {
      source.cleanup();
    }

    onProgress(0.9, 'ZIPを作成しています…');
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 5 } }, meta => {
      onProgress(0.9 + (meta.percent / 100) * 0.1, 'ZIPを作成しています…');
    });

    const base = sanitizeBaseName(file.name.replace(/\.[^.]+$/, '')) || 'clip';
    return {
      blob,
      filename: `vreview_feedback_${base}.zip`,
      manifest
    };
  }

  function buildReadme() {
    return [
      'VReview Combat Scene Detector Feedback Package',
      '',
      '目的:',
      'このZIPはCombat Scene自動検出の精度改善用です。',
      '',
      'ChatGPTへこのZIPをそのままアップロードして、',
      '「VReviewの自動検出を改善したい。auto-scenes と corrected-scenes の差、detector-diagnostics、画像を比較して原因を分析して」',
      'と伝えてください。',
      '',
      'ファイル:',
      '- manifest.json: 動画と検出設定の概要',
      '- auto-scenes.json: 自動検出直後のScene',
      '- corrected-scenes.json: ユーザー確認・修正後のScene',
      '- detector-diagnostics.json: 音声/映像/イベントの検出スコア',
      '- auto-scenes/*.jpg: 自動検出Sceneの確認画像',
      '- corrected-scenes/*.jpg: 修正後Sceneの確認画像',
      '- notes.txt: ユーザーメモ',
      '',
      '注意: 元動画そのものはZIPに含めていません。'
    ].join('\n');
  }

  async function createSceneSheet(video, scene, duration, label) {
    const columns = 4;
    const rows = 4;
    const cellW = 320;
    const cellH = 180;
    const canvas = document.createElement('canvas');
    canvas.width = columns * cellW;
    canvas.height = rows * cellH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('コンタクトシートを作成できませんでした。');

    ctx.fillStyle = '#080a0d';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const start = clamp(Number(scene.start || 0), 0, duration);
    const end = clamp(Number(scene.end || 0), 0, duration);
    const rangeStart = clamp(start - 0.65, 0, duration);
    const rangeEnd = clamp(end + 0.65, 0, duration);
    const times = evenlySpaced(rangeStart, Math.max(rangeStart, rangeEnd), columns * rows);

    for (let i = 0; i < times.length; i++) {
      const time = times[i];
      await seekVideo(video, Math.min(time, Math.max(0, duration - 0.02)));
      const x = (i % columns) * cellW;
      const y = Math.floor(i / columns) * cellH;
      drawCover(ctx, video, x, y, cellW, cellH);

      ctx.fillStyle = 'rgba(0,0,0,.72)';
      ctx.fillRect(x, y, cellW, 24);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 14px system-ui, sans-serif';
      const marker = time < start ? 'PRE' : time > end ? 'POST' : 'IN';
      ctx.fillText(`${label}  F${String(i + 1).padStart(2, '0')}  ${formatTime(time)}  ${marker}`, x + 8, y + 17);

      if (Math.abs(time - start) <= Math.max(0.12, (rangeEnd - rangeStart) / 15)) {
        ctx.strokeStyle = '#57d38c';
        ctx.lineWidth = 4;
        ctx.strokeRect(x + 2, y + 2, cellW - 4, cellH - 4);
      }
      if (Math.abs(time - end) <= Math.max(0.12, (rangeEnd - rangeStart) / 15)) {
        ctx.strokeStyle = '#ffb15a';
        ctx.lineWidth = 4;
        ctx.strokeRect(x + 4, y + 4, cellW - 8, cellH - 8);
      }
    }

    return canvasToBlob(canvas, 'image/jpeg', 0.82);
  }

  async function createVideoSource(file) {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = url;
    await waitFor(video, 'loadeddata', 10000);
    return {
      video,
      cleanup() {
        URL.revokeObjectURL(url);
        video.removeAttribute('src');
        video.load();
      }
    };
  }

  function drawCover(ctx, video, x, y, w, h) {
    const vw = video.videoWidth || w;
    const vh = video.videoHeight || h;
    const scale = Math.max(w / vw, h / vh);
    const dw = vw * scale;
    const dh = vh * scale;
    ctx.drawImage(video, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }

  function evenlySpaced(start, end, count) {
    if (count <= 1) return [start];
    if (end <= start) return Array.from({ length: count }, () => start);
    return Array.from({ length: count }, (_, i) => start + (end - start) * (i / (count - 1)));
  }

  function seekVideo(video, time) {
    return new Promise((resolve, reject) => {
      if (video.readyState >= 2 && Math.abs(video.currentTime - time) < 0.01) return resolve();
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('提出用画像のフレーム取得がタイムアウトしました。'));
      }, 5000);
      const cleanup = () => {
        clearTimeout(timer);
        video.removeEventListener('seeked', done);
        video.removeEventListener('error', fail);
      };
      const done = () => { cleanup(); resolve(); };
      const fail = () => { cleanup(); reject(new Error('提出用画像のフレーム取得に失敗しました。')); };
      video.addEventListener('seeked', done, { once: true });
      video.addEventListener('error', fail, { once: true });
      video.currentTime = time;
    });
  }

  function waitFor(target, eventName, timeoutMs) {
    return new Promise((resolve, reject) => {
      if (eventName === 'loadeddata' && target.readyState >= 2) return resolve();
      const timer = setTimeout(() => { cleanup(); reject(new Error('動画の準備がタイムアウトしました。')); }, timeoutMs);
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

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('画像の書き出しに失敗しました。')), type, quality);
    });
  }

  function cleanScenes(scenes) {
    return (scenes || []).map((scene, index) => ({
      index: index + 1,
      id: scene.id || null,
      start: round(scene.start, 3),
      end: round(scene.end, 3),
      duration: round(Number(scene.end || 0) - Number(scene.start || 0), 3),
      confidence: Number.isFinite(scene.confidence) ? round(scene.confidence, 4) : null,
      source: scene.source || null,
      fps: scene.fps || 'auto'
    }));
  }

  function progressPart(index, total) {
    if (!total) return 0.15;
    return 0.08 + (index / total) * 0.78;
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds - m * 60;
    return `${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
  }

  function sanitizeBaseName(value) {
    return String(value || '').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  }

  function round(value, digits) {
    const n = Number(value || 0);
    const p = 10 ** digits;
    return Math.round(n * p) / p;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  return { build, download };
})();