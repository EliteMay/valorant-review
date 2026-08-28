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
  if (!input || !dropzone || !workspace || !preview) return;

  const handleFile = async file => {
    if (!file || !['video/mp4', 'video/webm'].includes(file.type)) {
      alert('MP4 または WebM を選択してください。');
      return;
    }

    try {
      const data = await window.VReviewVideo.loadFile(preview, file);
      workspace.classList.remove('hidden');
      window.VReviewUI?.clearScenes();
      window.VReviewUI?.setDuration(data.duration);
      if (meta) {
        const mb = (file.size / 1024 / 1024).toFixed(1);
        meta.innerHTML = `<span>${escapeHtml(file.name)}</span><span>${window.VReviewVideo.formatTime(data.duration)}</span><span>${data.width}×${data.height}</span><span>${mb} MB</span>`;
      }
      window.scrollTo({ top: workspace.offsetTop - 20, behavior: 'smooth' });
    } catch (error) {
      alert(error.message || '動画を読み込めませんでした。');
    }
  };

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
