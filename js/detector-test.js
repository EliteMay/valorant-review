document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('testZipInput');
  const dropzone = document.getElementById('testDropzone');
  const results = document.getElementById('testResults');
  const summary = document.getElementById('testSummary');
  if (!input || !dropzone || !results || !summary) return;

  const diagnostics = window.VReviewDiagnostics;
  diagnostics?.breadcrumb('detector-test.init');
  const schemaPromise = loadFeedbackSchema();

  const processFiles = async files => {
    const list = [...files].filter(file => /\.zip$/i.test(file.name));
    if (!list.length) {
      diagnostics?.breadcrumb('detector-test.import-rejected', { selectedCount: Number(files?.length || 0) });
      renderMessage(summary, 'VReview Feedback ZIPを選択してください。', 'pending');
      results.replaceChildren();
      return;
    }

    const totalMB = Math.round(list.reduce((sum, file) => sum + file.size, 0) / 1024 / 1024 * 10) / 10;
    diagnostics?.breadcrumb('detector-test.import-start', { zipCount: list.length, totalMB });
    renderMessage(summary, `${list.length}件のZIPを検証しています… Batch ZIPもそのまま読み込めます。`, 'pending');
    results.replaceChildren();

    let schema;
    try {
      schema = await schemaPromise;
    } catch (error) {
      const code = diagnostics?.captureError(error, 'DETECTOR-TEST-SCHEMA-001') || 'DETECTOR-TEST-SCHEMA-001';
      renderMessage(summary, `Schemaを読み込めませんでした: ${error.message || error} ページを再読み込みして再試行してください。 Error: ${code}`, 'pending');
      return;
    }

    const records = [];
    const errors = [];
    for (const [index, file] of list.entries()) {
      try {
        const analyzed = await analyzeFeedbackZip(file, schema);
        records.push(...analyzed);
      } catch (error) {
        diagnostics?.captureError(error, 'DETECTOR-TEST-IMPORT-001', {
          index: index + 1,
          sizeMB: Math.round(file.size / 1024 / 1024 * 10) / 10
        });
        errors.push(`${file.name}: ${error.message || error}`);
      }
      await yieldToMain();
    }

    diagnostics?.breadcrumb('detector-test.import-complete', {
      selected: list.length,
      acceptedClips: records.length,
      failed: errors.length
    });
    renderResults(records, errors, results, summary);
  };

  input.addEventListener('change', () => processFiles(input.files || []));
  ['dragenter', 'dragover'].forEach(type => dropzone.addEventListener(type, event => {
    event.preventDefault();
    dropzone.classList.add('dragover');
  }));
  ['dragleave', 'drop'].forEach(type => dropzone.addEventListener(type, event => {
    event.preventDefault();
    dropzone.classList.remove('dragover');
  }));
  dropzone.addEventListener('drop', event => processFiles(event.dataTransfer?.files || []));
  dropzone.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    input.click();
  });
});

async function loadFeedbackSchema() {
  let response;
  try {
    response = await fetch('data/detector-feedback-schema.json');
  } catch (error) {
    window.VReviewDiagnostics?.networkFailure({ resource: 'data/detector-feedback-schema.json', reason: error.message || 'fetch failed' });
    throw error;
  }
  if (!response.ok) {
    window.VReviewDiagnostics?.networkFailure({ resource: 'data/detector-feedback-schema.json', status: response.status, reason: 'schema fetch failed' });
    throw new Error(`HTTP ${response.status}`);
  }
  const schema = await response.json();
  if (!schema || schema.packageSchema !== 'vreview-detector-feedback' || !schema.batchSchema) {
    throw new Error('Detector Feedback Schemaが不正です。');
  }
  return schema;
}

async function analyzeFeedbackZip(file, schema) {
  const maxBatchBytes = Number(schema?.limits?.maxBatchZipBytes || 419430400);
  if (file.size > maxBatchBytes) {
    throw new Error(`ZIPが大きすぎます（上限 ${(maxBatchBytes / 1024 / 1024).toFixed(0)}MB）。`);
  }

  const entries = parseStoredZipJson(await file.arrayBuffer(), schema);
  if (entries.has('batch-manifest.json')) return analyzeBatchEntries(file, entries, schema);

  const maxZipBytes = Number(schema?.limits?.maxZipBytes || 262144000);
  if (file.size > maxZipBytes) {
    throw new Error(`単体Feedback ZIPが大きすぎます（上限 ${(maxZipBytes / 1024 / 1024).toFixed(0)}MB）。`);
  }
  const manifest = readJson(entries, 'manifest.json', schema);
  const corrected = readJson(entries, 'corrected-scenes.json', schema);
  validateFeedbackData(manifest, corrected, schema);
  return [summarizeFeedback(manifest, corrected, file.name)];
}

function analyzeBatchEntries(file, entries, schema) {
  const batch = readJson(entries, 'batch-manifest.json', schema);
  if (!batch || typeof batch !== 'object' || Array.isArray(batch)) throw new Error('batch-manifest.jsonが不正です。');
  if (batch.schema !== schema.batchSchema) throw new Error('VReview Feedback Batch形式ではありません。');
  const supported = new Set((schema.supportedBatchVersions || []).map(Number));
  if (!supported.has(Number(batch.version))) throw new Error(`Feedback Batch v${String(batch.version || '?')}は未対応です。`);

  const clips = Array.isArray(batch.clips) ? batch.clips : [];
  const maxClips = Number(schema?.limits?.maxBatchClips || 20);
  if (!clips.length) throw new Error('Batch内にクリップがありません。');
  if (clips.length > maxClips) throw new Error(`Batch内クリップ数が多すぎます（上限 ${maxClips}）。`);
  if (Number(batch.clip_count) !== clips.length) throw new Error('Batchのclip_countとclips配列が一致しません。');

  const seen = new Set();
  return clips.map((clip, index) => {
    const folder = normalizeFolder(clip?.folder);
    if (!folder || !folder.startsWith('clips/')) throw new Error(`Batch Clip ${index + 1} のfolderが不正です。`);
    if (seen.has(folder)) throw new Error(`Batch内folderが重複しています: ${folder}`);
    seen.add(folder);

    const manifestName = `${folder}/manifest.json`;
    const correctedName = `${folder}/corrected-scenes.json`;
    const manifest = readJson(entries, manifestName, schema);
    const corrected = readJson(entries, correctedName, schema);
    validateFeedbackData(manifest, corrected, schema);
    return summarizeFeedback(manifest, corrected, `${file.name} / ${folder}`);
  });
}

function summarizeFeedback(manifest, corrected, sourceName) {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let primaryUseful = 0;
  let primaryFalse = 0;
  let weakUseful = 0;
  let weakFalse = 0;
  let unreviewed = 0;

  for (const scene of corrected) {
    const label = scene.feedback_label || scene.feedbackLabel || 'unreviewed';
    const source = scene.source || '';
    const tier = scene.review_tier || scene.reviewTier || (source === 'manual' ? 'manual' : 'primary');
    const useful = label === 'kill' || label === 'death' || label === 'fight';

    if (label === 'unreviewed') unreviewed++;
    if (source === 'manual' || tier === 'manual') {
      if (useful) fn++;
      continue;
    }

    if (useful) tp++;
    else if (label === 'false_positive') fp++;

    if (tier === 'weak') {
      if (useful) weakUseful++;
      else if (label === 'false_positive') weakFalse++;
    } else {
      if (useful) primaryUseful++;
      else if (label === 'false_positive') primaryFalse++;
    }
  }

  return {
    file: sourceName,
    detector: manifest?.detection?.detector_version || 'unknown',
    packageVersion: manifest?.version || '?',
    clip: manifest?.video?.name || sourceName,
    tp,
    fp,
    fn,
    primaryUseful,
    primaryFalse,
    weakUseful,
    weakFalse,
    unreviewed,
    precision: ratio(tp, tp + fp),
    recall: ratio(tp, tp + fn),
    primaryPrecision: ratio(primaryUseful, primaryUseful + primaryFalse)
  };
}

function validateFeedbackData(manifest, corrected, schema) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('manifest.jsonがありません。');
  if (manifest.schema !== schema.packageSchema) throw new Error(`VReview Feedback形式ではありません（schema: ${String(manifest.schema || 'missing')}）。`);

  const supported = Array.isArray(schema.supportedPackageVersions) ? schema.supportedPackageVersions.map(Number) : [];
  if (!supported.includes(Number(manifest.version))) throw new Error(`Feedback Package v${String(manifest.version || '?')}は未対応です。`);
  if (!Array.isArray(corrected)) throw new Error('corrected-scenes.jsonがありません。');

  const maxScenes = Number(schema?.limits?.maxScenesPerClip || 2000);
  if (corrected.length > maxScenes) throw new Error(`Scene数が多すぎます（上限 ${maxScenes}）。`);

  const labels = new Set(schema.feedbackLabels || []);
  const tiers = new Set(schema.reviewTiers || []);
  const sources = new Set(schema.sceneSources || []);
  const videoDuration = Number(manifest?.video?.duration);

  corrected.forEach((scene, index) => {
    if (!scene || typeof scene !== 'object' || Array.isArray(scene)) throw new Error(`Scene ${index + 1} がObjectではありません。`);
    const start = Number(scene.start);
    const end = Number(scene.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) throw new Error(`Scene ${index + 1} のStart / Endが不正です。`);
    if (Number.isFinite(videoDuration) && end > videoDuration + 1.5) throw new Error(`Scene ${index + 1} が動画時間を大きく超えています。`);

    const label = scene.feedback_label || scene.feedbackLabel || 'unreviewed';
    if (!labels.has(label)) throw new Error(`Scene ${index + 1} のfeedback labelが不正です。`);
    const source = scene.source || null;
    if (source && !sources.has(source)) throw new Error(`Scene ${index + 1} のsourceが不正です。`);
    const tier = scene.review_tier || scene.reviewTier || (source === 'manual' ? 'manual' : 'primary');
    if (!tiers.has(tier)) throw new Error(`Scene ${index + 1} のreview tierが不正です。`);

    if (scene.confidence != null) {
      const confidence = Number(scene.confidence);
      if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error(`Scene ${index + 1} のconfidenceが不正です。`);
    }
  });
}

function renderResults(records, errors, results, summary) {
  results.replaceChildren();
  if (!records.length) {
    renderMessage(summary, `有効なFeedback ZIPを読み込めませんでした。${errors.length ? ` ${errors.join(' / ')}` : ''}`, 'pending');
    return;
  }

  const totals = records.reduce((acc, item) => {
    for (const key of ['tp', 'fp', 'fn', 'primaryUseful', 'primaryFalse', 'weakUseful', 'weakFalse', 'unreviewed']) acc[key] += item[key];
    return acc;
  }, { tp: 0, fp: 0, fn: 0, primaryUseful: 0, primaryFalse: 0, weakUseful: 0, weakFalse: 0, unreviewed: 0 });

  const precision = ratio(totals.tp, totals.tp + totals.fp);
  const recall = ratio(totals.tp, totals.tp + totals.fn);
  const primaryPrecision = ratio(totals.primaryUseful, totals.primaryUseful + totals.primaryFalse);

  summary.replaceChildren();
  const stats = document.createElement('div');
  stats.className = 'stats-grid';
  stats.append(
    makeMetricCard('PRECISION', pct(precision), 'TP / (TP + FP)', scoreClass(precision)),
    makeMetricCard('RECALL', pct(recall), 'TP / (TP + FN)', scoreClass(recall)),
    makeMetricCard('PRIMARY PRECISION', pct(primaryPrecision), '本命Sceneだけ', scoreClass(primaryPrecision)),
    makeMetricCard('WEAK TRUE', String(totals.weakUseful), 'weakへ落ちた有効Scene', '')
  );
  summary.appendChild(stats);

  if (totals.unreviewed) appendMessage(summary, `未確認ラベルが ${totals.unreviewed}件あります。Precision / Recallは確定値ではありません。`, 'pending');
  if (errors.length) appendMessage(summary, `読込エラー: ${errors.join(' / ')}`, 'pending');

  const tableWrap = document.createElement('div');
  tableWrap.className = 'test-table-wrap panel';
  const table = document.createElement('table');
  table.className = 'test-table';
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const title of ['Clip', 'Detector', 'Precision', 'Recall', 'Primary', 'TP', 'FP', 'FN', 'Weak True', 'Unreviewed']) {
    const th = document.createElement('th');
    th.textContent = title;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  records.forEach(item => {
    const row = document.createElement('tr');
    const values = [item.clip, `v${item.detector}`, pct(item.precision), pct(item.recall), pct(item.primaryPrecision), item.tp, item.fp, item.fn, item.weakUseful, item.unreviewed];
    values.forEach(value => {
      const td = document.createElement('td');
      td.textContent = String(value);
      row.appendChild(td);
    });
    tbody.appendChild(row);
  });
  table.appendChild(tbody);
  tableWrap.appendChild(table);
  results.appendChild(tableWrap);

  const grouped = groupByDetector(records);
  const versionPanel = document.createElement('div');
  versionPanel.className = 'panel';
  const heading = document.createElement('div');
  heading.className = 'section-heading';
  const headingInner = document.createElement('div');
  const eyebrow = document.createElement('p');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = 'BY DETECTOR';
  const title = document.createElement('h2');
  title.textContent = 'Detector別集計';
  headingInner.append(eyebrow, title);
  heading.appendChild(headingInner);
  const statusList = document.createElement('div');
  statusList.className = 'status-list';
  for (const [version, data] of grouped.entries()) {
    const p = ratio(data.tp, data.tp + data.fp);
    const r = ratio(data.tp, data.tp + data.fn);
    const row = document.createElement('div');
    row.className = 'status-row';
    const label = document.createElement('span');
    label.textContent = `v${version} · ${data.clips} clips`;
    const score = document.createElement('strong');
    score.textContent = `Precision ${pct(p)} / Recall ${pct(r)}`;
    row.append(label, score);
    statusList.appendChild(row);
  }
  versionPanel.append(heading, statusList);
  results.appendChild(versionPanel);
}

function makeMetricCard(label, value, note, className) {
  const card = document.createElement('article');
  card.className = 'stat-card';
  const labelEl = document.createElement('span');
  labelEl.className = 'stat-label';
  labelEl.textContent = label;
  const valueEl = document.createElement('strong');
  valueEl.className = `stat-value${className ? ` ${className}` : ''}`;
  valueEl.textContent = value;
  const noteEl = document.createElement('span');
  noteEl.className = 'stat-note';
  noteEl.textContent = note;
  card.append(labelEl, valueEl, noteEl);
  return card;
}

function renderMessage(container, message, tone) {
  container.replaceChildren();
  appendMessage(container, message, tone);
}

function appendMessage(container, message, tone) {
  const callout = document.createElement('div');
  callout.className = `status-callout ${tone === 'success' ? 'success' : 'pending'}`;
  callout.textContent = message;
  container.appendChild(callout);
}

function groupByDetector(records) {
  const map = new Map();
  for (const item of records) {
    const data = map.get(item.detector) || { clips: 0, tp: 0, fp: 0, fn: 0 };
    data.clips++;
    data.tp += item.tp;
    data.fp += item.fp;
    data.fn += item.fn;
    map.set(item.detector, data);
  }
  return map;
}

function parseStoredZipJson(buffer, schema) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const decoder = new TextDecoder('utf-8');
  const entries = new Map();
  const maxEntries = Number(schema?.limits?.maxEntries || 5000);
  const maxJsonBytes = Number(schema?.limits?.maxJsonBytes || 8388608);
  let offset = 0;
  let entryCount = 0;

  while (offset + 30 <= bytes.length) {
    const signature = view.getUint32(offset, true);
    if (signature === 0x02014b50 || signature === 0x06054b50) break;
    if (signature !== 0x04034b50) throw new Error('ZIP local headerが不正です。');

    entryCount++;
    if (entryCount > maxEntries) throw new Error(`ZIP内ファイル数が多すぎます（上限 ${maxEntries}）。`);

    const flags = view.getUint16(offset + 6, true);
    const method = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    if (flags & 0x0008) throw new Error('Data Descriptor形式のZIPには未対応です。VReview Feedback ZIPを使用してください。');
    if (method !== 0) throw new Error('圧縮ZIPには未対応です。VReview Feedback ZIPを使用してください。');

    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > bytes.length) throw new Error('ZIPが壊れています。');

    const name = decoder.decode(bytes.slice(nameStart, nameStart + nameLength));
    if (name.includes('../') || name.startsWith('/') || name.includes('\\')) throw new Error('ZIP内Pathが不正です。');

    if (/\.json$/i.test(name)) {
      if (compressedSize > maxJsonBytes) throw new Error(`${name}が大きすぎます。`);
      if (entries.has(name)) throw new Error(`${name}が重複しています。`);
      entries.set(name, bytes.slice(dataStart, dataEnd));
    }
    offset = dataEnd;
  }

  return entries;
}

function readJson(entries, name, schema) {
  const data = entries.get(name);
  if (!data) throw new Error(`${name}がありません。`);
  const maxJsonBytes = Number(schema?.limits?.maxJsonBytes || 8388608);
  if (data.byteLength > maxJsonBytes) throw new Error(`${name}が大きすぎます。`);
  try {
    return JSON.parse(new TextDecoder('utf-8').decode(data));
  } catch {
    throw new Error(`${name}のJSONが壊れています。`);
  }
}

function normalizeFolder(value) {
  const folder = String(value || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!folder || folder.includes('../') || folder.startsWith('..')) return '';
  return folder;
}

function ratio(a, b) {
  return b > 0 ? a / b : null;
}

function pct(value) {
  return value == null ? '--' : `${(value * 100).toFixed(1)}%`;
}

function scoreClass(value) {
  return value == null ? '' : value >= 0.9 ? 'metric-good' : value >= 0.75 ? 'metric-warn' : '';
}

function yieldToMain() {
  return new Promise(resolve => setTimeout(resolve, 0));
}
