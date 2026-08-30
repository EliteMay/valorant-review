document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('testZipInput');
  const dropzone = document.getElementById('testDropzone');
  const results = document.getElementById('testResults');
  const summary = document.getElementById('testSummary');
  if (!input || !dropzone || !results || !summary) return;

  const processFiles = async files => {
    const list = [...files].filter(file => /\.zip$/i.test(file.name));
    if (!list.length) return;
    const records = [];
    const errors = [];

    for (const file of list) {
      try {
        records.push(await analyzeFeedbackZip(file));
      } catch (error) {
        errors.push(`${file.name}: ${error.message || error}`);
      }
    }
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
});

async function analyzeFeedbackZip(file) {
  const entries = parseStoredZip(await file.arrayBuffer());
  const manifest = readJson(entries, 'manifest.json');
  const corrected = readJson(entries, 'corrected-scenes.json');
  if (!Array.isArray(corrected)) throw new Error('corrected-scenes.jsonがありません。');

  let tp = 0, fp = 0, fn = 0, primaryUseful = 0, primaryFalse = 0, weakUseful = 0, weakFalse = 0, unreviewed = 0;
  for (const scene of corrected) {
    const label = scene.feedback_label || scene.feedbackLabel || 'unreviewed';
    const source = scene.source || '';
    const tier = scene.review_tier || (source === 'manual' ? 'manual' : 'primary');
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
    file: file.name,
    detector: manifest?.detection?.detector_version || 'unknown',
    packageVersion: manifest?.version || '?',
    clip: manifest?.video?.name || file.name,
    tp, fp, fn, primaryUseful, primaryFalse, weakUseful, weakFalse, unreviewed,
    precision: ratio(tp, tp + fp),
    recall: ratio(tp, tp + fn),
    primaryPrecision: ratio(primaryUseful, primaryUseful + primaryFalse)
  };
}

function renderResults(records, errors, results, summary) {
  results.innerHTML = '';
  if (!records.length) {
    summary.innerHTML = `<div class="status-callout pending">有効なFeedback ZIPを読み込めませんでした。${errors.length ? `<br>${escapeHtml(errors.join(' / '))}` : ''}</div>`;
    return;
  }

  const totals = records.reduce((acc, item) => {
    for (const key of ['tp','fp','fn','primaryUseful','primaryFalse','weakUseful','weakFalse','unreviewed']) acc[key] += item[key];
    return acc;
  }, { tp:0, fp:0, fn:0, primaryUseful:0, primaryFalse:0, weakUseful:0, weakFalse:0, unreviewed:0 });

  const precision = ratio(totals.tp, totals.tp + totals.fp);
  const recall = ratio(totals.tp, totals.tp + totals.fn);
  const primaryPrecision = ratio(totals.primaryUseful, totals.primaryUseful + totals.primaryFalse);

  summary.innerHTML = `
    <div class="stats-grid">
      <article class="stat-card"><span class="stat-label">PRECISION</span><strong class="stat-value ${scoreClass(precision)}">${pct(precision)}</strong><span class="stat-note">TP / (TP + FP)</span></article>
      <article class="stat-card"><span class="stat-label">RECALL</span><strong class="stat-value ${scoreClass(recall)}">${pct(recall)}</strong><span class="stat-note">TP / (TP + FN)</span></article>
      <article class="stat-card"><span class="stat-label">PRIMARY PRECISION</span><strong class="stat-value ${scoreClass(primaryPrecision)}">${pct(primaryPrecision)}</strong><span class="stat-note">本命Sceneだけ</span></article>
      <article class="stat-card"><span class="stat-label">WEAK TRUE</span><strong class="stat-value">${totals.weakUseful}</strong><span class="stat-note">weakへ落ちた有効Scene</span></article>
    </div>
    ${totals.unreviewed ? `<div class="status-callout pending">未確認ラベルが ${totals.unreviewed}件あります。Precision / Recallは確定値ではありません。</div>` : ''}
    ${errors.length ? `<div class="status-callout pending">読込エラー: ${escapeHtml(errors.join(' / '))}</div>` : ''}`;

  const table = document.createElement('div');
  table.className = 'test-table-wrap panel';
  table.innerHTML = `<table class="test-table"><thead><tr><th>Clip</th><th>Detector</th><th>Precision</th><th>Recall</th><th>Primary</th><th>TP</th><th>FP</th><th>FN</th><th>Weak True</th><th>Unreviewed</th></tr></thead><tbody>${records.map(item => `
    <tr>
      <td>${escapeHtml(item.clip)}</td>
      <td>v${escapeHtml(item.detector)}</td>
      <td>${pct(item.precision)}</td>
      <td>${pct(item.recall)}</td>
      <td>${pct(item.primaryPrecision)}</td>
      <td>${item.tp}</td><td>${item.fp}</td><td>${item.fn}</td><td>${item.weakUseful}</td><td>${item.unreviewed}</td>
    </tr>`).join('')}</tbody></table>`;
  results.appendChild(table);

  const grouped = groupByDetector(records);
  const versionPanel = document.createElement('div');
  versionPanel.className = 'panel';
  versionPanel.innerHTML = `<div class="section-heading"><div><p class="eyebrow">BY DETECTOR</p><h2>Detector別集計</h2></div></div><div class="status-list">${[...grouped.entries()].map(([version, data]) => {
    const p = ratio(data.tp, data.tp + data.fp), r = ratio(data.tp, data.tp + data.fn);
    return `<div class="status-row"><span>v${escapeHtml(version)} · ${data.clips} clips</span><strong>Precision ${pct(p)} / Recall ${pct(r)}</strong></div>`;
  }).join('')}</div>`;
  results.appendChild(versionPanel);
}

function groupByDetector(records) {
  const map = new Map();
  for (const item of records) {
    const data = map.get(item.detector) || { clips:0, tp:0, fp:0, fn:0 };
    data.clips++; data.tp += item.tp; data.fp += item.fp; data.fn += item.fn;
    map.set(item.detector, data);
  }
  return map;
}

function parseStoredZip(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const decoder = new TextDecoder('utf-8');
  const entries = new Map();
  let offset = 0;

  while (offset + 30 <= bytes.length) {
    const signature = view.getUint32(offset, true);
    if (signature === 0x02014b50 || signature === 0x06054b50) break;
    if (signature !== 0x04034b50) { offset++; continue; }

    const flags = view.getUint16(offset + 6, true);
    const method = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    if (flags & 0x0008) throw new Error('Data Descriptor形式のZIPには未対応です。');
    if (method !== 0) throw new Error('圧縮ZIPには未対応です。VReview Feedback ZIPを使用してください。');

    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > bytes.length) throw new Error('ZIPが壊れています。');
    const name = decoder.decode(bytes.slice(nameStart, nameStart + nameLength));
    entries.set(name, bytes.slice(dataStart, dataEnd));
    offset = dataEnd;
  }
  return entries;
}

function readJson(entries, name) {
  const data = entries.get(name);
  if (!data) return null;
  return JSON.parse(new TextDecoder('utf-8').decode(data));
}

function ratio(a, b) { return b > 0 ? a / b : null; }
function pct(value) { return value == null ? '--' : `${(value * 100).toFixed(1)}%`; }
function scoreClass(value) { return value == null ? '' : value >= 0.9 ? 'metric-good' : value >= 0.75 ? 'metric-warn' : ''; }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[ch]); }
