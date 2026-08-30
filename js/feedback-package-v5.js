window.VReviewFeedbackPackage = (() => {
  const VERSION = 5;
  const ROI = {
    killfeed: [0.66, 0.995, 0.035, 0.31],
    ammo: [0.80, 0.985, 0.77, 0.985],
    killConfirm: [0.42, 0.58, 0.70, 0.91],
    topCenter: [0.31, 0.69, 0.00, 0.18]
  };

  async function build(options = {}) {
    const { file, videoData, detectionRun, correctedScenes = [], notes = '', onProgress = () => {} } = options;
    if (!file || !videoData) throw new Error('元動画を読み込んでから提出用パッケージを作成してください。');
    if (!detectionRun) throw new Error('先に自動検出を実行してください。');

    const originalScenes = Array.isArray(detectionRun.scenes) ? detectionRun.scenes : [];
    const corrected = Array.isArray(correctedScenes) ? correctedScenes : [];
    const events = Array.isArray(detectionRun?.diagnosticData?.events) ? detectionRun.diagnosticData.events : [];
    const files = [];
    const timestamp = new Date().toISOString();

    const unique = buildUniqueSceneIndex(originalScenes, corrected);
    const labelCounts = countBy(corrected, scene => scene.feedbackLabel || 'unreviewed');
    const tierCounts = countBy(corrected, getReviewTier);

    const manifest = {
      schema: 'vreview-detector-feedback',
      version: VERSION,
      created_at: timestamp,
      app_version: window.VReviewVersion?.app || null,
      video: {
        name: file.name,
        type: file.type,
        size_bytes: file.size,
        duration: round(videoData.duration, 3),
        width: videoData.width,
        height: videoData.height
      },
      detection: {
        detector_version: detectionRun.detectorVersion || window.VReviewVersion?.detector || null,
        sensitivity: detectionRun.sensitivity || 'standard',
        warnings: detectionRun.warnings || [],
        diagnostics: detectionRun.diagnostics || {}
      },
      counts: {
        auto_scenes: originalScenes.length,
        corrected_scenes: corrected.length,
        unique_scene_images: unique.items.length,
        manual_scenes: corrected.filter(scene => scene.source === 'manual').length,
        edited_scenes: corrected.filter(scene => scene.source === 'edited').length,
        labels: labelCounts,
        review_tiers: tierCounts
      }
    };

    addText(files, 'README.txt', buildReadme());
    addText(files, 'manifest.json', JSON.stringify(manifest, null, 2));
    addText(files, 'auto-scenes.json', JSON.stringify(cleanScenes(originalScenes), null, 2));
    addText(files, 'corrected-scenes.json', JSON.stringify(cleanScenes(corrected), null, 2));
    addText(files, 'detector-diagnostics.json', JSON.stringify(detectionRun.diagnosticData || {}, null, 2));
    addText(files, 'scene-image-map.json', JSON.stringify(unique.map, null, 2));
    addText(files, 'notes.txt', notes || 'ユーザーメモなし');

    let imageWarning = null;
    try {
      const source = await createVideoSource(file);
      try {
        for (let i = 0; i < unique.items.length; i++) {
          const item = unique.items[i];
          const progressBase = i / Math.max(1, unique.items.length);
          onProgress(0.06 + progressBase * 0.78, `Scene画像 ${i + 1}/${unique.items.length} を作成しています…`);

          const sceneEvents = events.filter(event => Number(event.time) >= item.scene.start - 0.65 && Number(event.time) <= item.scene.end + 0.65);
          const times = buildEventAwareTimes(item.scene, sceneEvents, videoData.duration, 16);
          const fullBlob = await createFullFrameSheet(source.video, item.scene, times, item.id);
          files.push({ name: `scene-images/${item.id}_full.jpg`, data: new Uint8Array(await fullBlob.arrayBuffer()) });

          const roiTime = chooseRepresentativeTime(item.scene, sceneEvents, videoData.duration);
          const roiBlob = await createRoiSheet(source.video, roiTime, item.id, videoData.duration);
          files.push({ name: `scene-images/${item.id}_roi.jpg`, data: new Uint8Array(await roiBlob.arrayBuffer()) });
        }
      } finally {
        source.cleanup();
      }
    } catch (error) {
      imageWarning = `確認画像の生成に失敗したため、JSON中心のZIPを作成しました: ${error.message || error}`;
      addText(files, 'image-generation-warning.txt', imageWarning);
    }

    onProgress(0.86, 'ZIPを作成しています…');
    const blob = buildStoreZip(files, value => onProgress(0.86 + value * 0.14, 'ZIPを作成しています…'));
    const base = sanitizeBaseName(file.name.replace(/\.[^.]+$/, '')) || 'clip';
    onProgress(1, imageWarning || '検出改善用ZIPを作成しました。');

    return { blob, filename: `vreview_feedback_${base}.zip`, manifest, warning: imageWarning };
  }

  function buildReadme() {
    return [
      'VReview Detector Feedback Package v5',
      '',
      '目的: Detectorの見逃し・誤検出・Scene範囲を実クリップで改善するための提出パッケージです。',
      '',
      '主要ファイル:',
      '- corrected-scenes.json: ユーザー修正後Sceneと正解ラベル',
      '- auto-scenes.json: 自動検出直後のScene',
      '- detector-diagnostics.json: Detectorのイベント・抑制・分類診断',
      '- scene-image-map.json: auto/corrected Sceneと共有画像の対応',
      '- scene-images/*_full.jpg: Event時刻優先の16フレーム全画面シート',
      '- scene-images/*_roi.jpg: Killfeed / Ammo / Kill Confirm / Round UIの拡大確認',
      '',
      'v5変更点:',
      '- auto/correctedで同一範囲の画像を二重生成しない',
      '- 画像はcoverではなくcontainで描画し、HUDを切らない',
      '- 均等サンプリングよりDetectorイベント時刻を優先',
      '- 固定ROIそのものが合っているか確認できる拡大画像を追加',
      '',
      'feedback_label: kill / death / fight / false_positive / unreviewed',
      'review_tier: primary / weak / manual',
      '元動画そのものはZIPに含めていません。'
    ].join('\n');
  }

  function buildUniqueSceneIndex(autoScenes, correctedScenes) {
    const byKey = new Map();
    const map = { auto: [], corrected: [] };

    const add = (scene, type, index) => {
      const key = sceneKey(scene);
      let item = byKey.get(key);
      if (!item) {
        item = { id: `scene_${String(byKey.size + 1).padStart(3, '0')}`, scene: { ...scene }, refs: [] };
        byKey.set(key, item);
      }
      item.refs.push({ type, index: index + 1 });
      map[type].push({ index: index + 1, image_id: item.id, start: round(scene.start, 3), end: round(scene.end, 3) });
    };

    autoScenes.forEach((scene, index) => add(scene, 'auto', index));
    correctedScenes.forEach((scene, index) => add(scene, 'corrected', index));
    return { items: [...byKey.values()], map };
  }

  function sceneKey(scene) {
    return `${round(scene.start, 2).toFixed(2)}-${round(scene.end, 2).toFixed(2)}`;
  }

  function buildEventAwareTimes(scene, events, duration, count) {
    const start = clamp(Number(scene.start || 0), 0, duration);
    const end = clamp(Number(scene.end || 0), 0, duration);
    const candidates = [];

    const add = (time, priority, label) => {
      const t = clamp(Number(time || 0), 0, Math.max(0, duration - 0.02));
      if (candidates.some(item => Math.abs(item.time - t) < 0.045)) return;
      candidates.push({ time: t, priority, label });
    };

    add(start - 0.50, 6, 'PRE');
    add(start, 8, 'START');
    add(end, 8, 'END');
    add(end + 0.50, 6, 'POST');

    for (const event of events) {
      const priority = event.kind === 'kill-confirm' ? 10
        : event.kind === 'shot-hud' ? 9
          : event.kind === 'killfeed-support' ? 8
            : event.kind === 'combat-support' ? 6
              : 3;
      add(event.time, priority + Math.min(Number(event.score || 0), 2), event.kind || 'event');
    }

    const selected = candidates.sort((a, b) => b.priority - a.priority || a.time - b.time).slice(0, count);
    if (selected.length < count) {
      const fillers = evenlySpaced(clamp(start - 0.55, 0, duration), clamp(end + 0.55, 0, duration), count * 2);
      for (const time of fillers) {
        if (selected.length >= count) break;
        if (selected.some(item => Math.abs(item.time - time) < 0.08)) continue;
        selected.push({ time, priority: 1, label: 'FILL' });
      }
    }

    return selected.sort((a, b) => a.time - b.time).slice(0, count);
  }

  function chooseRepresentativeTime(scene, events, duration) {
    if (events.length) {
      const best = [...events].sort((a, b) => eventWeight(b) - eventWeight(a))[0];
      return clamp(Number(best.time || 0), 0, Math.max(0, duration - 0.02));
    }
    return clamp((Number(scene.start || 0) + Number(scene.end || 0)) / 2, 0, Math.max(0, duration - 0.02));
  }

  function eventWeight(event) {
    const kind = event.kind === 'kill-confirm' ? 5 : event.kind === 'shot-hud' ? 4 : event.kind === 'killfeed-support' ? 3 : event.kind === 'combat-support' ? 2 : 1;
    return kind + Number(event.score || 0);
  }

  async function createFullFrameSheet(video, scene, timeItems, label) {
    const columns = 4, rows = 4, cellW = 320, cellH = 180;
    const canvas = document.createElement('canvas');
    canvas.width = columns * cellW;
    canvas.height = rows * cellH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('コンタクトシートを作成できませんでした。');
    ctx.fillStyle = '#07090c';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let i = 0; i < timeItems.length; i++) {
      const item = timeItems[i];
      await seekVideo(video, item.time);
      const x = (i % columns) * cellW;
      const y = Math.floor(i / columns) * cellH;
      drawContain(ctx, video, x, y, cellW, cellH);
      ctx.fillStyle = 'rgba(0,0,0,.78)';
      ctx.fillRect(x, y, cellW, 25);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 13px system-ui, sans-serif';
      const marker = item.time < scene.start ? 'PRE' : item.time > scene.end ? 'POST' : 'IN';
      ctx.fillText(`${label} F${String(i + 1).padStart(2, '0')} ${formatTime(item.time)} ${marker} ${item.label}`, x + 7, y + 17);
    }
    return canvasToBlob(canvas, 'image/jpeg', 0.86);
  }

  async function createRoiSheet(video, time, label, duration) {
    await seekVideo(video, clamp(time, 0, Math.max(0, duration - 0.02)));
    const cellW = 480, cellH = 270;
    const canvas = document.createElement('canvas');
    canvas.width = cellW * 2;
    canvas.height = cellH * 2;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('ROI画像を作成できませんでした。');
    ctx.fillStyle = '#07090c';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const entries = [
      ['KILLFEED', ROI.killfeed],
      ['AMMO', ROI.ammo],
      ['KILL CONFIRM', ROI.killConfirm],
      ['ROUND UI', ROI.topCenter]
    ];

    entries.forEach(([name, roi], index) => {
      const x = (index % 2) * cellW;
      const y = Math.floor(index / 2) * cellH;
      drawRoi(ctx, video, roi, x, y, cellW, cellH);
      ctx.fillStyle = 'rgba(0,0,0,.78)';
      ctx.fillRect(x, y, cellW, 28);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 14px system-ui, sans-serif';
      ctx.fillText(`${label} ${name} ${formatTime(time)}`, x + 8, y + 19);
    });

    return canvasToBlob(canvas, 'image/jpeg', 0.88);
  }

  function drawContain(ctx, video, x, y, w, h) {
    const vw = video.videoWidth || w, vh = video.videoHeight || h;
    const scale = Math.min(w / vw, h / vh);
    const dw = vw * scale, dh = vh * scale;
    ctx.fillStyle = '#000';
    ctx.fillRect(x, y, w, h);
    ctx.drawImage(video, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }

  function drawRoi(ctx, video, roi, x, y, w, h) {
    const vw = video.videoWidth || 1, vh = video.videoHeight || 1;
    const sx = Math.floor(vw * roi[0]), sy = Math.floor(vh * roi[2]);
    const sw = Math.max(1, Math.floor(vw * (roi[1] - roi[0]))), sh = Math.max(1, Math.floor(vh * (roi[3] - roi[2])));
    ctx.fillStyle = '#000';
    ctx.fillRect(x, y, w, h);
    const scale = Math.min(w / sw, h / sh);
    const dw = sw * scale, dh = sh * scale;
    ctx.drawImage(video, sx, sy, sw, sh, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
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
      review_tier: getReviewTier(scene),
      needs_review: Boolean(scene.needsReview),
      weak_reason: scene.weakReason || null,
      detector_reason: scene.detectorReason || null,
      recall_guard: scene.recallGuard || null,
      classifier_index: Number(scene.classifierIndex || 0) || null,
      classifier_evidence: scene.classifierEvidence || null,
      anchor_count: Number(scene.anchorCount || 0),
      shot_evidence_count: Number(scene.shotEvidenceCount || 0),
      fps: scene.fps || 'auto'
    }));
  }

  function getReviewTier(scene) {
    if (scene?.source === 'manual') return 'manual';
    return scene?.reviewTier === 'weak' ? 'weak' : 'primary';
  }

  function countBy(items, getter) {
    return (items || []).reduce((acc, item) => {
      const key = getter(item) || 'unknown';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
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
    const localParts = [], centralParts = [];
    let offset = 0;
    const dos = dosDateTime(new Date());

    files.forEach((file, index) => {
      const nameBytes = encoder.encode(file.name);
      const data = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data);
      const crc = crc32(data);

      const local = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true); lv.setUint16(8, 0, true);
      lv.setUint16(10, dos.time, true); lv.setUint16(12, dos.date, true); lv.setUint32(14, crc, true); lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true); lv.setUint16(26, nameBytes.length, true); lv.setUint16(28, 0, true); local.set(nameBytes, 30);
      localParts.push(local, data);

      const central = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(central.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true); cv.setUint16(10, 0, true); cv.setUint16(12, dos.time, true); cv.setUint16(14, dos.date, true); cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, nameBytes.length, true); cv.setUint16(30, 0, true); cv.setUint16(32, 0, true); cv.setUint16(34, 0, true); cv.setUint16(36, 0, true); cv.setUint32(38, 0, true); cv.setUint32(42, offset, true); central.set(nameBytes, 46);
      centralParts.push(central);
      offset += local.length + data.length;
      onProgress((index + 1) / Math.max(1, files.length));
    });

    const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(4, 0, true); ev.setUint16(6, 0, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true); ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true); ev.setUint16(20, 0, true);
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

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  function formatTime(seconds) {
    const m = Math.floor(seconds / 60), s = seconds - m * 60;
    return `${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
  }

  function sanitizeBaseName(value) {
    return String(value || '').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  }

  function round(value, digits) {
    const p = 10 ** digits;
    return Math.round(Number(value || 0) * p) / p;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  return { build, download };
})();
