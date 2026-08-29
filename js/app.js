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
  const changeVideoBtn = document.getElementById('changeVideoBtn');
  const sceneColumn = document.querySelector('.scene-column');
  const autoDetectBtn = document.getElementById('autoDetectBtn');
  const sensitivity = document.getElementById('detectSensitivity');
  const detectionStatus = document.getElementById('detectionStatus');
  const detectionProgress = document.getElementById('detectionProgress');
  const detectionProgressText = document.getElementById('detectionProgressText');
  const detectionMessage = document.getElementById('detectionMessage');
  const detectionWarning = document.getElementById('detectionWarning');
  const feedbackBtn = document.getElementById('feedbackPackageBtn');
  const feedbackNotes = document.getElementById('feedbackNotes');
  const feedbackStatus = document.getElementById('feedbackStatus');
  const feedbackProgress = document.getElementById('feedbackProgress');
  const feedbackProgressText = document.getElementById('feedbackProgressText');
  const feedbackMessage = document.getElementById('feedbackMessage');
  if (!input || !dropzone || !workspace || !preview) return;

  let currentFile = null;
  let currentVideoData = null;
  let detecting = false;
  let exportingFeedback = false;
  let lastDetectionRun = null;

  const setDetectionState = (progress, message, isActive = true) => {
    if (detectionStatus) detectionStatus.classList.toggle('hidden', !isActive);
    const value = Math.round(clamp(progress, 0, 1) * 100);
    if (detectionProgress) detectionProgress.value = value;
    if (detectionProgressText) detectionProgressText.textContent = isActive ? `${value}%` : '';
    if (detectionMessage) detectionMessage.textContent = message || '';
  };

  const setFeedbackState = (progress, message, isActive = true) => {
    if (feedbackStatus) feedbackStatus.classList.toggle('hidden', !isActive);
    const value = Math.round(clamp(progress, 0, 1) * 100);
    if (feedbackProgress) feedbackProgress.value = value;
    if (feedbackProgressText) feedbackProgressText.textContent = isActive ? `${value}%` : '';
    if (feedbackMessage) feedbackMessage.textContent = message || '';
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
      lastDetectionRun = null;
      workspace.classList.remove('hidden');
      document.body.classList.add('review-loaded');
      window.VReviewUI?.clearScenes();
      window.VReviewUI?.setDuration(data.duration);
      if (sceneColumn) sceneColumn.scrollTop = 0;
      if (autoDetectBtn) {
        autoDetectBtn.disabled = false;
        autoDetectBtn.textContent = 'Combat Sceneを自動検出';
      }
      if (feedbackBtn) feedbackBtn.disabled = true;
      if (feedbackNotes) feedbackNotes.value = '';
      if (detectionWarning) detectionWarning.textContent = '音声ピークと画面変化を組み合わせて候補を作ります。確定ではないので、検出後にSceneを確認してください。';
      setDetectionState(0, '自動検出の準備ができました。', false);
      setFeedbackState(0, '', false);
      if (meta) {
        const mb = (file.size / 1024 / 1024).toFixed(1);
        meta.innerHTML = `<span>${escapeHtml(file.name)}</span><span>${window.VReviewVideo.formatTime(data.duration)}</span><span>${data.width}×${data.height}</span><span>${mb} MB</span>`;
      }
    } catch (error) {
      alert(error.message || '動画を読み込めませんでした。');
    }
  };

  changeVideoBtn?.addEventListener('click', () => {
    if (detecting || exportingFeedback) return;
    input.value = '';
    input.click();
  });

  autoDetectBtn?.addEventListener('click', async () => {
    if (!currentFile || !currentVideoData || detecting) return;
    const existing = window.VReviewUI?.getScenes?.() || [];
    if (existing.length && !confirm('現在のSceneを自動検出結果で置き換えます。続けますか？')) return;

    detecting = true;
    autoDetectBtn.disabled = true;
    if (feedbackBtn) feedbackBtn.disabled = true;
    preview.pause();
    if (detectionWarning) detectionWarning.textContent = '';
    setDetectionState(0.01, 'Combat Scene自動検出を開始しています…');

    try {
      const result = await window.VReviewSceneDetection.detect(currentFile, {
        duration: currentVideoData.duration,
        sensitivity: sensitivity?.value || 'standard',
        onProgress: info => setDetectionState(info.progress, info.message)
      });
      lastDetectionRun = {
        ...result,
        scenes: (result.scenes || []).map(scene => ({ ...scene })),
        sensitivity: sensitivity?.value || result.sensitivity || 'standard'
      };
      window.VReviewUI?.replaceScenes(result.scenes);
      if (detectionWarning) {
        detectionWarning.textContent = result.warnings?.join(' ') || (result.scenes.length ? '候補を確認してください。誤検出は削除、見逃しは手動追加、範囲ズレは開始/終了を直してから提出用ZIPを作成できます。' : '候補を検出できませんでした。正しいCombat Sceneを手動追加してから提出用ZIPを作成できます。');
      }
      autoDetectBtn.textContent = '自動検出をやり直す';
      if (feedbackBtn) feedbackBtn.disabled = false;
      if (sceneColumn) sceneColumn.scrollTop = 0;
    } catch (error) {
      lastDetectionRun = null;
      setDetectionState(0, '自動検出に失敗しました。', true);
      if (detectionWarning) detectionWarning.textContent = error.message || '解析中にエラーが発生しました。';
    } finally {
      detecting = false;
      autoDetectBtn.disabled = false;
    }
  });

  feedbackBtn?.addEventListener('click', async () => {
    if (!currentFile || !currentVideoData || !lastDetectionRun || exportingFeedback) return;
    const correctedScenes = window.VReviewUI?.getScenes?.() || [];
    if (!correctedScenes.length && !confirm('修正後Sceneが0件です。この状態で提出用ZIPを作成しますか？')) return;

    exportingFeedback = true;
    feedbackBtn.disabled = true;
    preview.pause();
    setFeedbackState(0.01, '検出改善用パッケージを準備しています…');

    try {
      const result = await window.VReviewFeedbackPackage.build({
        file: currentFile,
        videoData: currentVideoData,
        detectionRun: lastDetectionRun,
        correctedScenes,
        notes: feedbackNotes?.value?.trim() || '',
        onProgress: (progress, message) => setFeedbackState(progress, message)
      });
      window.VReviewFeedbackPackage.download(result.blob, result.filename);
      setFeedbackState(1, `${result.filename} を作成しました。これをこのチャットにアップロードしてください。`);
    } catch (error) {
      setFeedbackState(0, error.message || '提出用ZIPの作成に失敗しました。');
    } finally {
      exportingFeedback = false;
      feedbackBtn.disabled = false;
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
