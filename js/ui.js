window.VReviewUI = (() => {
  const state = {
    duration: 0,
    scenes: [],
    draftStart: null,
    draftEnd: null
  };

  const els = {};

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
      addScene(start, end, { source: 'manual', confidence: null });
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
      id: createId(),
      start,
      end,
      fps: 'auto',
      source: 'manual',
      confidence: null,
      ...extra
    });
    if (!scene) return;
    state.scenes.push(scene);
    sortAndPersist();
  }

  function replaceScenes(scenes) {
    state.scenes = (Array.isArray(scenes) ? scenes : [])
      .map(item => normalizeScene({ id: createId(), fps: 'auto', source: 'auto', ...item }))
      .filter(Boolean);
    sortAndPersist();
  }

  function updateScene(id, patch) {
    const scene = state.scenes.find(item => item.id === id);
    if (!scene) return;
    Object.assign(scene, patch);
    const normalized = normalizeScene(scene);
    if (!normalized) return;
    Object.assign(scene, normalized, { source: scene.source === 'auto' ? 'edited' : scene.source, confidence: scene.confidence });
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
    els.sceneCount.textContent = `${state.scenes.length} scene${state.scenes.length === 1 ? '' : 's'}`;
    els.sceneList.innerHTML = '';
    els.timeline.innerHTML = '';

    if (!state.scenes.length) {
      const empty = document.createElement('p');
      empty.className = 'helper scene-empty';
      empty.textContent = 'Sceneはまだありません。自動検出するか、動画から手動で追加してください。';
      els.sceneList.appendChild(empty);
    }

    state.scenes.forEach((scene, index) => {
      const card = document.createElement('article');
      card.className = 'scene-card';
      const detectionBadge = getDetectionBadge(scene);
      card.innerHTML = `
        <header>
          <strong>Scene ${String(index + 1).padStart(2, '0')}</strong>
          <div class="scene-badges">
            ${detectionBadge}
            <span class="badge">${scene.fps === 'auto' ? 'Auto FPS' : `${scene.fps}fps`}</span>
          </div>
        </header>
        <div class="time-row">
          <label>Start<input data-role="start" type="number" min="0" step="0.01" value="${scene.start.toFixed(2)}"></label>
          <label>End<input data-role="end" type="number" min="0" step="0.01" value="${scene.end.toFixed(2)}"></label>
        </div>
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
      card.querySelector('[data-action="play"]').addEventListener('click', () => seek(scene.start));
      card.querySelector('[data-action="minus-start"]').addEventListener('click', () => updateScene(scene.id, { start: scene.start - 0.1 }));
      card.querySelector('[data-action="plus-start"]').addEventListener('click', () => updateScene(scene.id, { start: scene.start + 0.1 }));
      card.querySelector('[data-action="minus-end"]').addEventListener('click', () => updateScene(scene.id, { end: scene.end - 0.1 }));
      card.querySelector('[data-action="plus-end"]').addEventListener('click', () => updateScene(scene.id, { end: scene.end + 0.1 }));
      card.querySelector('[data-action="delete"]').addEventListener('click', () => removeScene(scene.id));
      els.sceneList.appendChild(card);

      if (state.duration > 0) {
        const bar = document.createElement('button');
        bar.className = `timeline-scene${scene.source === 'manual' ? ' manual' : ''}`;
        bar.style.left = `${(scene.start / state.duration) * 100}%`;
        bar.style.width = `${Math.max(((scene.end - scene.start) / state.duration) * 100, .4)}%`;
        bar.title = `Scene ${index + 1} ${formatShort(scene.start)} - ${formatShort(scene.end)}`;
        bar.addEventListener('click', () => seek(scene.start));
        els.timeline.appendChild(bar);
      }
    });
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
    return {
      ...scene,
      start,
      end,
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

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  return { init, setDuration, addScene, replaceScenes, clearScenes, getScenes };
})();

document.addEventListener('DOMContentLoaded', () => window.VReviewUI.init());
