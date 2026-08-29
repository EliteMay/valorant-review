document.addEventListener('DOMContentLoaded', () => {
  hydrateDashboard();
  initReviewPage();
});

function hydrateDashboard() {
  const last = window.VReviewStorage?.get('last-result', null);
  if (!last) return;
  const aim = document.getElementById('aimAvg');
  const movement = document.getElementById('movementAvg');
  const priority = document.getElementById('priorityTraining');
  if (aim && Number.isFinite(last?.clip?.aim_score)) aim.textContent = Math.round(last.clip.aim_score);
  if (movement && Number.isFinite(last?.clip?.movement_score)) movement.textContent = Math.round(last.clip.movement_score);
  if (priority && last?.summary?.priority_training) priority.textContent = last.summary.priority_training;
}

function initReviewPage() {
  const input = document.getElementById('videoInput');
  const dropzone = document.getElementById('dropzone');
  const workspace = document.getElementById('workspace');
  const preview = document.getElementById('videoPreview');
  const meta = document.getElementById('videoMeta');
  const autoDetectBtn = document.getElementById('autoDetectBtn');
  const sensitivity = document.getElementById('detectSensitivity');
  const detectionStatus = document.getElementById('detectionStatus');
  const detectionProgress = document.getElementById('detectionProgress');
  const detectionMessage = document.getElementById('detectionMessage');
  const detectionWarning = document.getElementById('detectionWarning');
  if (!input || !dropzone || !workspace || !preview) return;

  let currentFile = null;
  let currentVideoData = null;
  let detecting = false;

  const setDetectionState = (progress, message, isActive = true) => {
    if (detectionStatus) detectionStatus.classList.toggle('hidden', !isActive);
    if (detectionProgress) detectionProgress.value = Math.round(clamp(progress, 0, 1) * 100);
    if (detectionMessage) detectionMessage.textContent = message || '';
  };

  const handleFile = async file => {
    if (!file || !['video/mp4', 'video/webm'].includes(file.type)) {
      alert('MP4 または WebM を選択してください。');
      return;
    }

    try {
      const data = await window.VReviewVideo.loadFile(preview, file);
      currentFile = file;
      currentVideoData = data;
      workspace.classList.remove('hidden');
      window.VReviewUI?.clearScenes();
      window.VReviewUI?.setDuration(data.duration);
      if (autoDetectBtn) autoDetectBtn.disabled = false;
      if (detectionWarning) detectionWarning.textContent = '';
      setDetectionState(0, '自動検出の準備ができました。', false);
      if (meta) {
        const mb = (file.size / 1024 / 1024).toFixed(1);
        meta.innerHTML = `<span>${escapeHtml(file.name)}</span><span>${window.VReviewVideo.formatTime(data.duration)}</span><span>${data.width}×${data.height}</span><span>${mb} MB</span>`;
      }
      window.scrollTo({ top: workspace.offsetTop - 20, behavior: 'smooth' });
    } catch (error) {
      alert(error.message || '動画を読み込めませんでした。');
    }
  };

  autoDetectBtn?.addEventListener('click', async () => {
    if (!currentFile || !currentVideoData || detecting) return;
    const existing = window.VReviewUI?.getScenes?.() || [];
    if (existing.length && !confirm('現在のSceneを自動検出結果で置き換えます。続けますか？')) return;

    detecting = true;
    autoDetectBtn.disabled = true;
    preview.pause();
    if (detectionWarning) detectionWarning.textContent = '';
    setDetectionState(0.01, 'Combat Scene自動検出を開始しています…');

    try {
      const result = await window.VReviewSceneDetection.detect(currentFile, {
        duration: currentVideoData.duration,
        sensitivity: sensitivity?.value || 'standard',
        onProgress: info => setDetectionState(info.progress, info.message)
      });
      window.VReviewUI?.replaceScenes(result.scenes);
      if (detectionWarning) {
        detectionWarning.textContent = result.warnings?.join(' ') || (result.scenes.length ? '候補を確認し、ずれているSceneは手動で修正してください。' : '候補を検出できませんでした。手動でSceneを追加してください。');
      }
      autoDetectBtn.textContent = '自動検出をやり直す';
    } catch (error) {
      setDetectionState(0, '自動検出に失敗しました。', true);
      if (detectionWarning) detectionWarning.textContent = error.message || '解析中にエラーが発生しました。';
    } finally {
      detecting = false;
      autoDetectBtn.disabled = false;
    }
  });

  input.addEventListener('change', () => handleFile(input.files?.[0]));
  ['dragenter', 'dragover'].forEach(type => dropzone.addEventListener(type, event => {
    event.preventDefault();
    dropzone.classList.add('dragover');
  }));
  ['dragleave', 'drop'].forEach(type => dropzone.addEventListener(type, event => {
    event.preventDefault();
    dropzone.classList.remove('dragover');
  }));
  dropzone.addEventListener('drop', event => handleFile(event.dataTransfer?.files?.[0]));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[char]);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
