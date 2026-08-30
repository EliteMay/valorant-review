window.VReviewUI = (() => {
  const DRAFT_SCHEMA = 1;
  const state = {
    duration: 0,
    scenes: [],
    draftStart: null,
    draftEnd: null,
    draftKey: null,
    selectedId: null,
    weakPanelOpen: false,
    lastRemoved: null
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

    els.setStartBtn?.addEventListener('click', setDraftStart);
    els.setEndBtn?.addEventListener('click', setDraftEnd);
    els.addSceneBtn?.addEventListener('click', addDraftScene);

    els.timeline?.addEventListener('click', event => {
      if (event.target.closest('.timeline-scene')) return;
      const rect = els.timeline.getBoundingClientRect();
      if (!rect.width || state.duration <= 0) return;
      seek(((event.clientX - rect.left) / rect.width) * state.duration, false);
    });

    els.video.addEventListener('timeupdate', updatePlayhead);
    els.video.addEventListener('loadedmetadata', updatePlayhead);
    document.addEventListener('keydown', handleKeyboardShortcuts);
  }

  function setDraftStart() {
    state.draftStart = Number(els.video?.currentTime || 0);
    flashButton(els.setStartBtn, `開始 ${formatShort(state.draftStart)}`);
  }

  function setDraftEnd() {
    state.draftEnd = Number(els.video?.currentTime || 0);
    flashButton(els.setEndBtn, `終了 ${formatShort(state.draftEnd)}`);
  }

  function addDraftScene() {
    const start = state.draftStart;
    const end = state.draftEnd;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      alert('開始位置と終了位置を正しい順番で設定してください。');
      return;
    }
    addScene(start, end, { source: 'manual', confidence: null, feedbackLabel: 'unreviewed', reviewTier: 'primary' });
    state.draftStart = null;
    state.draftEnd = null;
  }

  function handleKeyboardShortcuts(event) {
    if (!els.video || isTypingTarget(event.target)) return;
    if (!document.body.classList.contains('review-loaded')) return;

    if (event.code === 'Space') {
      event.preventDefault();
      if (els.video.paused) els.video.play().catch(() => {});
      else els.video.pause();
      return;
    }
    if (event.key.toLowerCase() === 'i') {
      event.preventDefault();
      setDraftStart();
      return;
    }
    if (event.key.toLowerCase() === 'o') {
      event.preventDefault();
      setDraftEnd();
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const amount = event.shiftKey ? 0.5 : 0.1;
      seek(Number(els.video.currentTime || 0) + (event.key === 'ArrowRight' ? amount : -amount), false);
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && state.selectedId) {
      event.preventDefault();
      removeScene(state.selectedId);
    }
  }

  function isTypingTarget(target) {
    const tag = target?.tagName?.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable;
  }

  function setDuration(duration) {
    state.duration = Math.max(0, Number(duration || 0));
    render();
  }

  function setDraftKey(key) {
    state.draftKey = key || null;
  }

  function readSavedScenes(storageKey) {
    const saved = window.VReviewStorage?.getVersioned(storageKey, [], { schemaVersion: DRAFT_SCHEMA }) ?? [];
    return Array.isArray(saved) ? saved : [];
  }

  function hasSavedDraft(key = state.draftKey) {
    if (!key) return false;
    return readSavedScenes(`draft-scenes:${key}`).length > 0;
  }

  function hasSavedBackup(key = state.draftKey) {
    if (!key) return false;
    return readSavedScenes(`draft-backup:${key}`).length > 0;
  }

  function applySavedScenes(saved) {
    state.scenes = saved.map(item => normalizeScene({ ...item })).filter(Boolean);
    state.selectedId = null;
    state.lastRemoved = null;
    state.scenes.sort((a, b) => a.start - b.start);
    render();
    return state.scenes.length;
  }

  function restoreSavedDraft(key = state.draftKey) {
    if (!key) return 0;
    return applySavedScenes(readSavedScenes(`draft-scenes:${key}`));
  }

  function restoreSavedBackup(key = state.draftKey) {
    if (!key) return 0;
    const count = applySavedScenes(readSavedScenes(`draft-backup:${key}`));
    if (count) persist();
    return count;
  }

  function backupSavedDraft(key = state.draftKey) {
    if (!key || !hasSavedDraft(key)) return false;
    return Boolean(window.VReviewStorage?.copy(`draft-scenes:${key}`, `draft-backup:${key}`));
  }

  function addScene(start, end, extra = {}) {
    const scene = normalizeScene({
      id: createId(), start, end, fps: 'auto', source: 'manual', confidence: null,
      feedbackLabel: 'unreviewed', reviewTier: 'primary', ...extra
    });
    if (!scene) return false;
    state.scenes.push(scene);
    state.selectedId = scene.id;
    state.lastRemoved = null;
    sortAndPersist();
    return true;
  }

  function replaceScenes(scenes) {
    state.scenes = (Array.isArray(scenes) ? scenes : [])
      .map(item => normalizeScene({ id: createId(), fps: 'auto', source: 'auto', feedbackLabel: 'unreviewed', ...item }))
      .filter(Boolean);
    state.selectedId = state.scenes[0]?.id || null;
    state.lastRemoved = null;
    sortAndPersist();
  }

  function updateScene(id, patch) {
    const scene = state.scenes.find(item => item.id === id);
    if (!scene) return false;

    const timingChanged = Object.prototype.hasOwnProperty.call(patch, 'start') || Object.prototype.hasOwnProperty.call(patch, 'end');
    const candidate = normalizeScene({ ...scene, ...patch });
    if (!candidate) {
      render();
      return false;
    }

    candidate.source = timingChanged && scene.source === 'auto' ? 'edited' : scene.source;
    candidate.confidence = scene.confidence;
    Object.assign(scene, candidate);
    state.selectedId = id;
    sortAndPersist();
    return true;
  }

  function removeScene(id) {
    const index = state.scenes.findIndex(item => item.id === id);
    if (index < 0) return;
    state.lastRemoved = { scene: { ...state.scenes[index] }, index };
    state.scenes.splice(index, 1);
    if (state.selectedId === id) state.selectedId = state.scenes[Math.min(index, state.scenes.length - 1)]?.id || null;
    persist();
    render();
  }

  function undoRemoveScene() {
    if (!state.lastRemoved) return;
    const { scene, index } = state.lastRemoved;
    state.scenes.splice(Math.min(Math.max(index, 0), state.scenes.length), 0, scene);
    state.selectedId = scene.id;
    state.lastRemoved = null;
    sortAndPersist();
  }

  function selectScene(id, seekToStart = false) {
    state.selectedId = id;
    const scene = state.scenes.find(item => item.id === id);
    if (seekToStart && scene) seek(scene.start, false);
    render();
  }

  function seek(seconds, autoplay = true) {
    if (!els.video) return;
    els.video.currentTime = clamp(Number(seconds || 0), 0, state.duration);
    updatePlayhead();
    if (autoplay) els.video.play().catch(() => {});
  }

  function renderUndo() {
    if (!state.lastRemoved || !els.sceneList) return;
    const wrap = document.createElement('div');
    wrap.className = 'status-callout pending scene-undo';
    const text = document.createElement('span');
    text.textContent = 'Sceneを削除しました。';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-secondary btn-small';
    button.textContent = '元に戻す';
    button.addEventListener('click', undoRemoveScene);
    wrap.append(text, button);
    els.sceneList.appendChild(wrap);
  }

  function render() {
    if (!els.sceneList || !els.timeline) return;

    const openDetails = els.sceneList.querySelector('.weak-scenes-panel');
    if (openDetails) state.weakPanelOpen = openDetails.open;

    const primaryScenes = state.scenes.filter(scene => scene.reviewTier !== 'weak');
    const weakScenes = state.scenes.filter(scene => scene.reviewTier === 'weak');
    els.sceneCount.textContent = weakScenes.length
      ? `${primaryScenes.length} main + ${weakScenes.length} check`
      : `${primaryScenes.length} scene${primaryScenes.length === 1 ? '' : 's'}`;

    els.sceneList.innerHTML = '';
    els.timeline.innerHTML = '';

    const playhead = document.createElement('div');
    playhead.className = 'timeline-playhead';
    playhead.id = 'timelinePlayhead';
    els.timeline.appendChild(playhead);

    renderUndo();

    if (!state.scenes.length) {
      const empty = document.createElement('p');
      empty.className = 'helper scene-empty';
      empty.textContent = 'Sceneはまだありません。自動検出するか、動画から手動で追加してください。';
      els.sceneList.appendChild(empty);
      updatePlayhead();
      return;
    }

    const primaryWrap = document.createElement('div');
    primaryWrap.className = 'scene-primary-list';
    primaryScenes.forEach(scene => primaryWrap.appendChild(createSceneCard(scene, false)));
    els.sceneList.appendChild(primaryWrap);

    if (weakScenes.length) {
      const details = document.createElement('details');
      details.className = 'weak-scenes-panel';
      details.open = state.weakPanelOpen;
      const summary = document.createElement('summary');
      summary.innerHTML = `<span>要確認候補</span><strong>${weakScenes.length}件</strong><small>見逃し防止のため残している弱い候補</small>`;
      details.appendChild(summary);
      const weakWrap = document.createElement('div');
      weakWrap.className = 'weak-scenes-list';
      weakScenes.forEach(scene => weakWrap.appendChild(createSceneCard(scene, true)));
      details.appendChild(weakWrap);
      details.addEventListener('toggle', () => { state.weakPanelOpen = details.open; });
      els.sceneList.appendChild(details);
    }

    state.scenes.forEach((scene, index) => {
      if (state.duration <= 0) return;
      const bar = document.createElement('button');
      bar.type = 'button';
      bar.className = `timeline-scene${scene.source === 'manual' ? ' manual' : ''}${scene.feedbackLabel === 'false_positive' ? ' rejected' : ''}${scene.reviewTier === 'weak' ? ' weak' : ''}${scene.id === state.selectedId ? ' selected' : ''}`;
      bar.style.left = `${(scene.start / state.duration) * 100}%`;
      bar.style.width = `${Math.max(((scene.end - scene.start) / state.duration) * 100, .4)}%`;
      bar.title = `${scene.reviewTier === 'weak' ? '要確認候補' : `Scene ${index + 1}`} ${formatShort(scene.start)} - ${formatShort(scene.end)}`;
      bar.setAttribute('aria-label', bar.title);
      bar.addEventListener('click', event => {
        event.stopPropagation();
        selectScene(scene.id, true);
      });
      els.timeline.appendChild(bar);
    });

    updatePlayhead();
  }

  function createSceneCard(scene, weak) {
    const chronologicalIndex = state.scenes.indexOf(scene) + 1;
    const card = document.createElement('article');
    card.className = `scene-card feedback-${scene.feedbackLabel || 'unreviewed'}${weak ? ' weak-scene-card' : ''}${scene.id === state.selectedId ? ' selected' : ''}`;
    card.dataset.sceneId = scene.id;

    const detectionBadge = getDetectionBadge(scene);
    const reasonBadge = scene.detectorReason ? `<span class="badge badge-reason">${escapeHtml(scene.detectorReason)}</span>` : '';
    const weakBadge = weak ? '<span class="badge candidate-badge">CHECK</span>' : '';

    card.innerHTML = `
      <header>
        <strong>${weak ? '候補' : 'Scene'} ${String(chronologicalIndex).padStart(2, '0')}</strong>
        <div class="scene-badges">${weakBadge}${detectionBadge}${reasonBadge}<span class="badge">${scene.fps === 'auto' ? 'Auto FPS' : `${scene.fps}fps`}</span></div>
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

    card.addEventListener('click', event => {
      if (event.target.closest('input,select,button')) return;
      state.selectedId = scene.id;
      render();
    });
    card.querySelector('[data-role="start"]').addEventListener('change', e => updateScene(scene.id, { start: Number(e.target.value) }));
    card.querySelector('[data-role="end"]').addEventListener('change', e => updateScene(scene.id, { end: Number(e.target.value) }));
    card.querySelector('[data-role="feedback"]').addEventListener('change', e => updateScene(scene.id, { feedbackLabel: e.target.value }));
    card.querySelector('[data-action="play"]').addEventListener('click', () => { state.selectedId = scene.id; seek(scene.start); });
    card.querySelector('[data-action="minus-start"]').addEventListener('click', () => updateScene(scene.id, { start: scene.start - 0.1 }));
    card.querySelector('[data-action="plus-start"]').addEventListener('click', () => updateScene(scene.id, { start: scene.start + 0.1 }));
    card.querySelector('[data-action="minus-end"]').addEventListener('click', () => updateScene(scene.id, { end: scene.end - 0.1 }));
    card.querySelector('[data-action="plus-end"]').addEventListener('click', () => updateScene(scene.id, { end: scene.end + 0.1 }));
    card.querySelector('[data-action="delete"]').addEventListener('click', () => removeScene(scene.id));
    return card;
  }

  function updatePlayhead() {
    const playhead = document.getElementById('timelinePlayhead');
    if (!playhead || state.duration <= 0 || !els.video) return;
    playhead.style.left = `${clamp(Number(els.video.currentTime || 0) / state.duration, 0, 1) * 100}%`;
  }

  function weakReasonText(reason) {
    if (reason === 'recovered-without-combat-support') return '一度除外された候補を、見逃し防止のため残しています。戦闘証拠は弱めです。';
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
    const start = clamp(Number(scene.start), 0, state.duration);
    const end = clamp(Number(scene.end), 0, state.duration);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    const feedbackLabel = FEEDBACK_VALUES.includes(scene.feedbackLabel) ? scene.feedbackLabel : 'unreviewed';
    return {
      ...scene,
      id: scene.id || createId(),
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
    if (!state.draftKey) return true;
    return Boolean(window.VReviewStorage?.setVersioned(`draft-scenes:${state.draftKey}`, state.scenes, { schemaVersion: DRAFT_SCHEMA }));
  }

  function clearScenes(options = {}) {
    state.scenes = [];
    state.draftStart = null;
    state.draftEnd = null;
    state.selectedId = null;
    state.lastRemoved = null;
    if (options.persist !== false) persist();
    render();
  }

  function clearSavedDraft(key = state.draftKey) {
    if (!key) return false;
    return Boolean(window.VReviewStorage?.remove(`draft-scenes:${key}`));
  }

  function clearSavedBackup(key = state.draftKey) {
    if (!key) return false;
    return Boolean(window.VReviewStorage?.remove(`draft-backup:${key}`));
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
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  return {
    init, setDuration, setDraftKey,
    hasSavedDraft, hasSavedBackup, restoreSavedDraft, restoreSavedBackup, backupSavedDraft,
    addScene, replaceScenes, clearScenes, clearSavedDraft, clearSavedBackup, getScenes
  };
})();

document.addEventListener('DOMContentLoaded', () => window.VReviewUI.init());
