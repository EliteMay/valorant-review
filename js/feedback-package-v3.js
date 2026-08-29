window.VReviewFeedbackPackage = (() => {
  async function build(options = {}) {
    const { file, videoData, detectionRun, correctedScenes = [], notes = '', onProgress = () => {} } = options;
    if (!file || !videoData) throw new Error('元動画を読み込んでから提出用パッケージを作成してください。');
    if (!detectionRun) throw new Error('先にCombat Scene自動検出を実行してください。');

    const originalScenes = Array.isArray(detectionRun.scenes) ? detectionRun.scenes : [];
    const corrected = Array.isArray(correctedScenes) ? correctedScenes : [];
    const files = [];
    const timestamp = new Date().toISOString();
    const labelCounts = corrected.reduce((acc, scene) => {
      const key = scene.feedbackLabel || 'unreviewed';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    const manifest = {
      schema: 'vreview-detector-feedback',
      version: 3,
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
        detector_version: detectionRun.detectorVersion || null,
        sensitivity: detectionRun.sensitivity || 'standard',
        warnings: detectionRun.warnings || [],
        diagnostics: detectionRun.diagnostics || {}
      },
      counts: {
        auto_scenes: originalScenes.length,
        corrected_scenes: corrected.length,
        manual_scenes: corrected.filter(scene => scene.source === 'manual').length,
        edited_scenes: corrected.filter(scene => scene.source === 'edited').length,
        labels: labelCounts
      }
    };

    addText(files, 'README.txt', buildReadme());
    addText(files, 'manifest.json', JSON.stringify(manifest, null, 2));
    addText(files, 'auto-scenes.json', JSON.stringify(cleanScenes(originalScenes), null, 2));
    addText(files, 'corrected-scenes.json', JSON.stringify(cleanScenes(corrected), null, 2));
    addText(files, 'detector-diagnostics.json', JSON.stringify(detectionRun.diagnosticData || {}, null, 2));
    addText(files, 'notes.txt', notes || 'ユーザーメモなし');

    let imageWarning = null;
    const totalSheets = originalScenes.length + corrected.length;
    let sheetIndex = 0;

    try {
      const source = await createVideoSource(file);
      try {
        for (let i = 0; i < originalScenes.length; i++) {
          onProgress(progressPart(sheetIndex, totalSheets), `自動検出Scene ${i + 1}/${originalScenes.length} の確認画像を作成しています…`);
          const blob = await createSceneSheet(source.video, originalScenes[i], videoData.duration, `AUTO ${String(i + 1).padStart(2, '0')}`);
          files.push({ name: `auto-scenes/auto_${String(i + 1).padStart(2, '0')}.jpg`, data: new Uint8Array(await blob.arrayBuffer()) });
          sheetIndex++;
        }
        for (let i = 0; i < corrected.length; i++) {
          const scene = corrected[i];
          onProgress(progressPart(sheetIndex, totalSheets), `修正後Scene ${i + 1}/${corrected.length} の確認画像を作成しています…`);
          const label = String(scene.feedbackLabel || 'unreviewed').toUpperCase();
          const blob = await createSceneSheet(source.video, scene, videoData.duration, `${label} ${String(i + 1).padStart(2, '0')}`);
          files.push({ name: `corrected-scenes/corrected_${String(i + 1).padStart(2, '0')}.jpg`, data: new Uint8Array(await blob.arrayBuffer()) });
          sheetIndex++;
        }
      } finally {
        source.cleanup();
      }
    } catch (error) {
      imageWarning = `確認画像の生成に失敗したため、JSON中心のZIPを作成しました: ${error.message || error}`;
      addText(files, 'image-generation-warning.txt', imageWarning);
    }

    onProgress(0.9, 'ZIPを作成しています…');
    const blob = buildStoreZip(files, value => onProgress(0.9 + value * 0.1, 'ZIPを作成しています…'));
    const base = sanitizeBaseName(file.name.replace(/\.[^.]+$/, '')) || 'clip';
    onProgress(1, imageWarning || '検出改善用ZIPを作成しました。');
    return { blob, filename: `vreview_feedback_${base}.zip`, manifest, warning: imageWarning };
  }

  function buildReadme() {
    return [
      'VReview Detector Feedback Package v3',
      '',
      'このZIPは自動検出精度の改善用です。',
      'corrected-scenes.json の feedback_label がユーザーによる正解ラベルです。',
      '',
      'feedback_label:',
      '- kill: 欲しいキルScene',
      '- death: 欲しいデスScene',
      '- fight: 戦闘ではあるがキル/デスではない',
      '- false_positive: 不要・誤検出',
      '- unreviewed: 未確認',
      '',
      'detector-diagnostics.json には採用イベントと抑制イベントの両方を保存します。',
      '元動画そのものはZIPに含めていません。'
    ].join('\n');
  }

  async function createSceneSheet(video, scene, duration, label) {
    const columns = 4, rows = 4, cellW = 320, cellH = 180;
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
      ctx.fillText(`${label} F${String(i + 1).padStart(2, '0')} ${formatTime(time)} ${marker}`, x + 8, y + 17);
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
    return { video, cleanup() { URL.revokeObjectURL(url); video.removeAttribute('src'); video.load(); } };
  }

  function drawCover(ctx, video, x, y, w, h) {
    const vw = video.videoWidth || w, vh = video.videoHeight || h;
    const scale = Math.max(w / vw, h / vh);
    const dw = vw * scale, dh = vh * scale;
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
      const timer = setTimeout(() => { cleanup(); reject(new Error('提出用画像のフレーム取得がタイムアウトしました。')); }, 5000);
      const cleanup = () => { clearTimeout(timer); video.removeEventListener('seeked', done); video.removeEventListener('error', fail); };
      const done = () => { cleanup(); resolve(); };
      const fail = () => { cleanup(); reject(new Error('提出用画像のフレーム取得に失敗しました。')); };
      video.addEventListener('seeked', done, { once: true });
      video.addEventListener('error', fail, { once: true });
      try { video.currentTime = Math.max(0, time); } catch (error) { cleanup(); reject(error); }
    });
  }

  function waitFor(target, eventName, timeoutMs) {
    return new Promise((resolve, reject) => {
      if (eventName === 'loadeddata' && target.readyState >= 2) return resolve();
      const timer = setTimeout(() => { cleanup(); reject(new Error('動画の準備がタイムアウトしました。')); }, timeoutMs);
      const cleanup = () => { clearTimeout(timer); target.removeEventListener(eventName, done); target.removeEventListener('error', fail); };
      const done = () => { cleanup(); resolve(); };
      const fail = () => { cleanup(); reject(new Error('動画を読み込めませんでした。')); };
      target.addEventListener(eventName, done, { once: true });
      target.addEventListener('error', fail, { once: true });
    });
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('画像の書き出しに失敗しました。')), type, quality));
  }

  function addText(files, name, text) {
    files.push({ name, data: new TextEncoder().encode(text) });
  }

  function buildStoreZip(files, onProgress = () => {}) {
    const encoder = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    const dos = dosDateTime(new Date());

    files.forEach((file, index) => {
      const nameBytes = encoder.encode(file.name);
      const data = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data);
      const crc = crc32(data);

      const local = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x0800, true);
      lv.setUint16(8, 0, true);
      lv.setUint16(10, dos.time, true);
      lv.setUint16(12, dos.date, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);
      local.set(nameBytes, 30);
      localParts.push(local, data);

      const central = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(central.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, dos.time, true);
      cv.setUint16(14, dos.date, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);
      central.set(nameBytes, 46);
      centralParts.push(central);
      offset += local.length + data.length;
      onProgress((index + 1) / Math.max(1, files.length));
    });

    const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);
    ev.setUint16(20, 0, true);

    return new Blob([...localParts, ...centralParts, end], { type: 'application/zip' });
  }

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(data) {
    let crc = 0xffffffff;
    for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(date) {
    const year = Math.max(1980, date.getFullYear());
    return {
      time: ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5) | (Math.floor(date.getSeconds() / 2) & 31),
      date: (((year - 1980) & 127) << 9) | (((date.getMonth() + 1) & 15) << 5) | (date.getDate() & 31)
    };
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
      feedback_label: scene.feedbackLabel || 'unreviewed',
      detector_reason: scene.detectorReason || null,
      anchor_count: Number(scene.anchorCount || 0),
      shot_evidence_count: Number(scene.shotEvidenceCount || 0),
      fps: scene.fps || 'auto'
    }));
  }

  function progressPart(index, total) {
    return total ? 0.08 + (index / total) * 0.78 : 0.15;
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
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
