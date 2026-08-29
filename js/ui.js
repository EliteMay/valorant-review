window.VReviewUI = (() => {
  const state = {
    duration: 0,
    scenes: [],
    draftStart: null,
    draftEnd: null
  };

  const els = {};
  const FEEDBACK_VALUES = ['unreviewed', 'kill', 'death', 'fight', 'false_positive'];

  function init() {
    els.video = document.getElementById('videoPreview');
    els.timeline = document.getElementById('timeline');
    els.sceneList = document.getElementById('sceneList');
    els.sceneCount = document.getElementById('sceneCount');
    els.setStartBtn = document.getElementById('setStartBtn');
    els.setEndBtn = document.getElementById('setEndBtn');
    els.addSceneBtn = document.getElementById('addSceneBtn');

    if (!els.video) return;

    els.setStartBtn?.addEventListener('click', () => {
      state.draftStart = Number(els.video.currentTime || 0);
      flashButton(els.setStartBtn, `開始 ${formatShort(state.draftStart)}`);
    });

    els.setEndBtn?.addEventListener('click', () => {
      state.draftEnd = Number(els.video.currentTime || 0);
      flashButton(els.setEndBtn, `終了 ${formatShort(state.draftEnd)}`);
    });

    els.addSceneBtn?.addEventListener('click', () => {
      const start = state.draftStart;
      const end = state.draftEnd;
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        alert('開始位置と終了位置を正しい順番で設定してください。');
        return;
      }
      addScene(start, end, { source: 'manual', confidence: null, feedbackLabel: 'unreviewed', reviewTier: 'primary' });
      state.draftStart = null;
      state.draftEnd = null;
    });
  }

  function setDuration(duration) {
    state.duration = Math.max(0, Number(duration || 0));
    render();
  }

  function addScene(start, end, extra = {}) {
    const scene = normalizeScene({
      id: createId(), start, end, fps: 'auto', source: 'manual', confidence: null,
      feedbackLabel: 'unreviewed', reviewTier: 'primary', ...extra
    });
    if (!scene) return;
    state.scenes.push(scene);
    sortAndPersist();
  }

  function replaceScenes(scenes) {
    state.scenes = (Array.isArray(scenes) ? scenes : [])
      .map(item => normalizeScene({ id: createId(), fps: 'auto', source: 'auto', feedbackLabel: 'unreviewed', ...item }))
      .filter(Boolean);
    sortAndPersist();
  }

  function updateScene(id, patch) {
    const scene = state.scenes.find(item => item.id === id);
    if (!scene) return;
    const timingChanged = Object.prototype.hasOwnProperty.call(patch, 'start') || Object.prototype.hasOwnProperty.call(patch, 'end');
    Object.assign(scene, patch);
    const normalized = normalizeScene(scene);
    if (!normalized) return;
    const nextSource = timingChanged && scene.source === 'auto' ? 'edited' : scene.source;
    Object.assign(scene, normalized, { source: nextSource, confidence: scene.confidence });
    sortAndPersist();
  }

  function removeScene(id) {
    state.scenes = state.scenes.filter(item => item.id !== id);
    persist();
    render();
  }

  function seek(seconds) {
    if (!els.video) return;
    els.video.currentTime = clamp(seconds, 0, state.duration);
    els.video.play().catch(() => {});
  }

  function render() {
    if (!els.sceneList || !els.timeline) return;

    const primaryScenes = state.scenes.filter(scene => scene.reviewTier !== 'weak');
    const weakScenes = state.scenes.filter(scene => scene.reviewTier === 'weak');
    els.sceneCount.textContent = weakScenes.length
      ? `${primaryScenes.length} main + ${weakScenes.length} check`
      : `${primaryScenes.length} scene${primaryScenes.length === 1 ? '' : 's'}`;

    els.sceneList.innerHTML = '';
    els.timeline.innerHTML = '';

    if (!state.scenes.length) {
      const empty = document.createElement('p');
      empty.className = 'helper scene-empty';
      empty.textContent = 'Sceneはまだありません。自動検出するか、動画から手動で追加してください。';
      els.sceneList.appendChild(empty);
      return;
    }

    const primaryWrap = document.createElement('div');
    primaryWrap.className = 'scene-primary-list';
    primaryScenes.forEach(scene => primaryWrap.appendChild(createSceneCard(scene)));
    els.sceneList.appendChild(primaryWrap);

    if (weakScenes.length) {
      const details = document.createElement('details');
      details.className = 'weak-scenes-panel';
      details.innerHTML = `<summary><span>要確認候補</span><strong>${weakScenes.length}件</strong><small>見逃し防止のため残している弱い候補</small></summary>`;
      const weakWrap = document.createElement('div');
      weakWrap.className = 'weak-scenes-list';
      weakScenes.forEach(scene => weakWrap.appendChild(createSceneCard(scene, true)));
      details.appendChild(weakWrap);
      els.sceneList.appendChild(details);
    }

    state.scenes.forEach((scene, index) => {
      if (state.duration <= 0) return;
      const bar = document.createElement('button');
      bar.className = `timeline-scene${scene.source === 'manual' ? ' manual' : ''}${scene.feedbackLabel === 'false_positive' ? ' rejected' : ''}${scene.reviewTier === 'weak' ? ' weak' : ''}`;
      bar.style.left = `${(scene.start / state.duration) * 100}%`;
      bar.style.width = `${Math.max(((scene.end - scene.start) / state.duration) * 100, .4)}%`;
      bar.title = `${scene.reviewTier === 'weak' ? '要確認候補' : `Scene ${index + 1}`} ${formatShort(scene.start)} - ${formatShort(scene.end)}`;
      bar.addEventListener('click', () => seek(scene.start));
      els.timeline.appendChild(bar);
    });
  }

  function createSceneCard(scene, weak = false) {
    const chronologicalIndex = state.scenes.indexOf(scene) + 1;
    const card = document.createElement('article');
    card.className = `scene-card feedback-${scene.feedbackLabel || 'unreviewed'}${weak ? ' weak-scene-card' : ''}`;
    const detectionBadge = getDetectionBadge(scene);
    const reasonBadge = scene.detectorReason ? `<span class="badge badge-reason">${escapeHtml(scene.detectorReason)}</span>` : '';
    const weakBadge = weak ? `<span class="badge candidate-badge">CHECK</span>` : '';

    card.innerHTML = `
      <header>
        <strong>${weak ? '候補' : 'Scene'} ${String(chronologicalIndex).padStart(2, '0')}</strong>
        <div class="scene-badges">
          ${weakBadge}${detectionBadge}${reasonBadge}
          <span class="badge">${scene.fps === 'auto' ? 'Auto FPS' : `${scene.fps}fps`}</span>
        </div>
      </header>
      ${weak && scene.weakReason ? `<p class="weak-reason">${escapeHtml(weakReasonText(scene.weakReason))}</p>` : ''}
      <div class="time-row">
        <label>Start<input data-role="start" type="number" min="0" step="0.01" value="${scene.start.toFixed(2)}"></label>
        <label>End<input data-role="end" type="number" min="0" step="0.01" value="${scene.end.toFixed(2)}"></label>
      </div>
      <label class="scene-feedback-field">
        <span>このSceneは？</span>
        <select data-role="feedback">
          <option value="unreviewed"${scene.feedbackLabel === 'unreviewed' ? ' selected' : ''}>未確認</option>
          <option value="kill"${scene.feedbackLabel === 'kill' ? ' selected' : ''}>キルScene（欲しい）</option>
          <option value="death"${scene.feedbackLabel === 'death' ? ' selected' : ''}>デスScene（欲しい）</option>
          <option value="fight"${scene.feedbackLabel === 'fight' ? ' selected' : ''}>戦闘のみ</option>
          <option value="false_positive"${scene.feedbackLabel === 'false_positive' ? ' selected' : ''}>不要・誤検出</option>
        </select>
      </label>
      <div class="scene-actions">
        <button class="btn btn-secondary" data-action="play">再生</button>
        <button class="btn btn-secondary" data-action="minus-start">開始 -0.1</button>
        <button class="btn btn-secondary" data-action="plus-start">開始 +0.1</button>
        <button class="btn btn-secondary" data-action="minus-end">終了 -0.1</button>
        <button class="btn btn-secondary" data-action="plus-end">終了 +0.1</button>
        <button class="btn btn-secondary danger-text" data-action="delete">削除</button>
      </div>`;

    card.querySelector('[data-role="start"]').addEventListener('change', e => updateScene(scene.id, { start: Number(e.target.value) }));
    card.querySelector('[data-role="end"]').addEventListener('change', e => updateScene(scene.id, { end: Number(e.target.value) }));
    card.querySelector('[data-role="feedback"]').addEventListener('change', e => updateScene(scene.id, { feedbackLabel: e.target.value }));
    card.querySelector('[data-action="play"]').addEventListener('click', () => seek(scene.start));
    card.querySelector('[data-action="minus-start"]').addEventListener('click', () => updateScene(scene.id, { start: scene.start - 0.1 }));
    card.querySelector('[data-action="plus-start"]').addEventListener('click', () => updateScene(scene.id, { start: scene.start + 0.1 }));
    card.querySelector('[data-action="minus-end"]').addEventListener('click', () => updateScene(scene.id, { end: scene.end - 0.1 }));
    card.querySelector('[data-action="plus-end"]').addEventListener('click', () => updateScene(scene.id, { end: scene.end + 0.1 }));
    card.querySelector('[data-action="delete"]').addEventListener('click', () => removeScene(scene.id));
    return card;
  }

  function weakReasonText(reason) {
    if (reason === 'recovered-without-combat-support') return '一度除外された候補を見逃し防止のため残しています。戦闘証拠は弱めです。';
    if (reason === 'no-shot-evidence') return '射撃HUDの裏付けが取れていないため、要確認候補として分離しています。';
    return '検出根拠が弱いため確認が必要です。';
  }

  function getDetectionBadge(scene) {
    if (!Number.isFinite(scene.confidence)) return '<span class="badge badge-manual">MANUAL</span>';
    const percent = Math.round(scene.confidence * 100);
    const level = percent >= 80 ? 'HIGH' : percent >= 60 ? 'MEDIUM' : 'LOW';
    return `<span class="badge confidence-${level.toLowerCase()}">${level} ${percent}%</span>`;
  }

  function normalizeScene(scene) {
    const start = clamp(Number(scene.start || 0), 0, state.duration);
    const end = clamp(Number(scene.end || 0), 0, state.duration);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    const feedbackLabel = FEEDBACK_VALUES.includes(scene.feedbackLabel) ? scene.feedbackLabel : 'unreviewed';
    return {
      ...scene,
      start,
      end,
      feedbackLabel,
      reviewTier: scene.reviewTier === 'weak' ? 'weak' : 'primary',
      fps: ['auto', 30, 60, '30', '60'].includes(scene.fps) ? scene.fps : 'auto'
    };
  }

  function sortAndPersist() {
    state.scenes.sort((a, b) => a.start - b.start);
    persist();
    render();
  }

  function persist() {
    window.VReviewStorage?.set('draft-scenes', state.scenes);
  }

  function clearScenes() {
    state.scenes = [];
    state.draftStart = null;
    state.draftEnd = null;
    persist();
    render();
  }

  function getScenes() {
    return state.scenes.map(scene => ({ ...scene }));
  }

  function createId() {
    return crypto.randomUUID ? crypto.randomUUID() : `scene-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function flashButton(button, text) {
    if (!button) return;
    const original = button.dataset.originalLabel || button.textContent;
    button.dataset.originalLabel = original;
    button.textContent = text;
    clearTimeout(Number(button.dataset.resetTimer || 0));
    const timer = setTimeout(() => { button.textContent = original; }, 1200);
    button.dataset.resetTimer = String(timer);
  }

  function formatShort(seconds) {
    return window.VReviewVideo?.formatTime(seconds) || Number(seconds).toFixed(2);
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>'\"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '\"': '&quot;' })[char]);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  return { init, setDuration, addScene, replaceScenes, clearScenes, getScenes };
})();

document.addEventListener('DOMContentLoaded', () => window.VReviewUI.init());
