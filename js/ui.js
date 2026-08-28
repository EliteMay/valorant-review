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
    });

    els.setEndBtn?.addEventListener('click', () => {
      state.draftEnd = Number(els.video.currentTime || 0);
    });

    els.addSceneBtn?.addEventListener('click', () => {
      const start = state.draftStart;
      const end = state.draftEnd;
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        alert('開始位置と終了位置を正しい順番で設定してください。');
        return;
      }
      addScene(start, end);
      state.draftStart = null;
      state.draftEnd = null;
    });
  }

  function setDuration(duration) {
    state.duration = Math.max(0, Number(duration || 0));
    render();
  }

  function addScene(start, end) {
    const scene = {
      id: crypto.randomUUID ? crypto.randomUUID() : `scene-${Date.now()}-${Math.random()}`,
      start: clamp(start, 0, state.duration),
      end: clamp(end, 0, state.duration),
      fps: 'auto'
    };
    state.scenes.push(scene);
    state.scenes.sort((a, b) => a.start - b.start);
    persist();
    render();
  }

  function updateScene(id, patch) {
    const scene = state.scenes.find(item => item.id === id);
    if (!scene) return;
    Object.assign(scene, patch);
    scene.start = clamp(Number(scene.start || 0), 0, state.duration);
    scene.end = clamp(Number(scene.end || 0), 0, state.duration);
    if (scene.end <= scene.start) scene.end = Math.min(state.duration, scene.start + 0.1);
    state.scenes.sort((a, b) => a.start - b.start);
    persist();
    render();
  }

  function removeScene(id) {
    state.scenes = state.scenes.filter(item => item.id !== id);
    persist();
    render();
  }

  function seek(seconds) {
    els.video.currentTime = clamp(seconds, 0, state.duration);
    els.video.play().catch(() => {});
  }

  function render() {
    if (!els.sceneList || !els.timeline) return;
    els.sceneCount.textContent = `${state.scenes.length} scene${state.scenes.length === 1 ? '' : 's'}`;
    els.sceneList.innerHTML = '';
    els.timeline.innerHTML = '';

    state.scenes.forEach((scene, index) => {
      const card = document.createElement('article');
      card.className = 'scene-card';
      card.innerHTML = `
        <header><strong>Scene ${String(index + 1).padStart(2, '0')}</strong><span class="badge">${scene.fps === 'auto' ? 'Auto FPS' : `${scene.fps}fps`}</span></header>
        <div class="time-row">
          <label>Start<input data-role="start" type="number" min="0" step="0.01" value="${scene.start.toFixed(2)}"></label>
          <label>End<input data-role="end" type="number" min="0" step="0.01" value="${scene.end.toFixed(2)}"></label>
        </div>
        <div class="scene-actions">
          <button class="btn btn-secondary" data-action="play">再生</button>
          <button class="btn btn-secondary" data-action="minus-start">開始 -0.1</button>
          <button class="btn btn-secondary" data-action="plus-end">終了 +0.1</button>
          <button class="btn btn-secondary" data-action="delete">削除</button>
        </div>`;

      card.querySelector('[data-role="start"]').addEventListener('change', e => updateScene(scene.id, { start: Number(e.target.value) }));
      card.querySelector('[data-role="end"]').addEventListener('change', e => updateScene(scene.id, { end: Number(e.target.value) }));
      card.querySelector('[data-action="play"]').addEventListener('click', () => seek(scene.start));
      card.querySelector('[data-action="minus-start"]').addEventListener('click', () => updateScene(scene.id, { start: scene.start - 0.1 }));
      card.querySelector('[data-action="plus-end"]').addEventListener('click', () => updateScene(scene.id, { end: scene.end + 0.1 }));
      card.querySelector('[data-action="delete"]').addEventListener('click', () => removeScene(scene.id));
      els.sceneList.appendChild(card);

      if (state.duration > 0) {
        const bar = document.createElement('button');
        bar.className = 'timeline-scene';
        bar.style.left = `${(scene.start / state.duration) * 100}%`;
        bar.style.width = `${Math.max(((scene.end - scene.start) / state.duration) * 100, .4)}%`;
        bar.title = `Scene ${index + 1}`;
        bar.addEventListener('click', () => seek(scene.start));
        els.timeline.appendChild(bar);
      }
    });
  }

  function persist() {
    window.VReviewStorage?.set('draft-scenes', state.scenes);
  }

  function clearScenes() {
    state.scenes = [];
    persist();
    render();
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  return { init, setDuration, addScene, clearScenes };
})();

document.addEventListener('DOMContentLoaded', () => window.VReviewUI.init());
