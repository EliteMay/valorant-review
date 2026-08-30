document.addEventListener('DOMContentLoaded', () => {
  hydrateDashboard();
  initReviewPage();
});

function hydrateDashboard() {
  const last = window.VReviewStorage?.get('last-detector-summary', null);
  const file = document.getElementById('lastClipName');
  const detector = document.getElementById('detectorVersionCard');
  const main = document.getElementById('lastPrimaryCount');
  const weak = document.getElementById('lastWeakCount');

  if (detector) detector.textContent = `v${window.VReviewVersion?.detector || '--'}`;
  if (!last) return;
  if (file) file.textContent = last.fileName || 'Unknown clip';
  if (main) main.textContent = String(last.primary ?? '--');
  if (weak) weak.textContent = String(last.weak ?? '--');
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
  const cancelDetectBtn = document.getElementById('cancelDetectBtn');
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
  const resumeNotice = document.getElementById('resumeNotice');
  if (!input || !dropzone || !workspace || !preview) return;

  let currentFile = null;
  let currentVideoData = null;
  let currentFingerprint = null;
  let detecting = false;
  let exportingFeedback = false;
  let lastDetectionRun = null;
  let detectionController = null;

  const setDetectionState = (progress, message, isActive = true) => {
    detectionStatus?.classList.toggle('hidden', !isActive);
    const value = Math.round(clamp(progress, 0, 1) * 100);
    if (detectionProgress) detectionProgress.value = value;
    if (detectionProgressText) detectionProgressText.textContent = isActive ? `${value}%` : '';
    if (detectionMessage) detectionMessage.textContent = message || '';
  };

  const setFeedbackState = (progress, message, isActive = true) => {
    feedbackStatus?.classList.toggle('hidden', !isActive);
    const value = Math.round(clamp(progress, 0, 1) * 100);
    if (feedbackProgress) feedbackProgress.value = value;
    if (feedbackProgressText) feedbackProgressText.textContent = isActive ? `${value}%` : '';
    if (feedbackMessage) feedbackMessage.textContent = message || '';
  };

  const persistSessionMeta = () => {
    if (!currentFingerprint) return;
    window.VReviewStorage?.set(`draft-meta:${currentFingerprint}`, {
      sensitivity: sensitivity?.value || 'standard',
      notes: feedbackNotes?.value || '',
      fileName: currentFile?.name || '',
      updatedAt: new Date().toISOString()
    });
  };

  const handleFile = async file => {
    if (!file || !isSupportedVideo(file)) {
      alert('MP4 または WebM を選択してください。');
      return;
    }
    if (detecting || exportingFeedback) return;

    try {
      const data = await window.VReviewVideo.loadFile(preview, file);
      currentFile = file;
      currentVideoData = data;
      currentFingerprint = window.VReviewVideo.makeFingerprint(file, data);
      lastDetectionRun = null;

      workspace.classList.remove('hidden');
      document.body.classList.add('review-loaded');
      window.VReviewUI?.setDuration(data.duration);
      window.VReviewUI?.setDraftKey(currentFingerprint);

      const savedMeta = window.VReviewStorage?.get(`draft-meta:${currentFingerprint}`, null);
      const hasDraft = window.VReviewUI?.hasSavedDraft(currentFingerprint);
      let restored = false;
      if (hasDraft) {
        restored = confirm('この動画には前回のScene編集データがあります。続きから再開しますか？');
      }

      if (restored) {
        const count = window.VReviewUI?.restoreSavedDraft(currentFingerprint) || 0;
        if (resumeNotice) {
          resumeNotice.textContent = `前回のScene ${count}件を復元しました。検出改善ZIPを作る場合は自動検出をもう一度実行してください。`;
          resumeNotice.classList.remove('hidden');
        }
      } else {
        if (hasDraft) window.VReviewUI?.clearSavedDraft(currentFingerprint);
        window.VReviewUI?.clearScenes({ persist: false });
        resumeNotice?.classList.add('hidden');
      }

      if (savedMeta?.sensitivity && sensitivity) sensitivity.value = savedMeta.sensitivity;
      if (feedbackNotes) feedbackNotes.value = savedMeta?.notes || '';
      sceneColumn && (sceneColumn.scrollTop = 0);

      if (autoDetectBtn) {
        autoDetectBtn.disabled = false;
        autoDetectBtn.textContent = restored ? '自動検出を実行して更新' : 'キルSceneを自動検出';
      }
      cancelDetectBtn?.classList.add('hidden');
      if (feedbackBtn) feedbackBtn.disabled = true;
      setDetectionState(0, '', false);
      setFeedbackState(0, '', false);

      if (detectionWarning) {
        detectionWarning.textContent = restored
          ? 'Scene編集は復元済みです。Detector診断は保存していないため、Feedback ZIPを作る前に自動検出を再実行してください。'
          : `Detector v${window.VReviewVersion?.detector || '0.5.0'}で本命Sceneと要確認候補を検出します。`;
      }

      if (meta) {
        const mb = (file.size / 1024 / 1024).toFixed(1);
        meta.innerHTML = `<span>${escapeHtml(file.name)}</span><span>${window.VReviewVideo.formatTime(data.duration)}</span><span>${data.width}×${data.height}</span><span>${mb} MB</span>`;
      }
      persistSessionMeta();
    } catch (error) {
      alert(error.message || '動画を読み込めませんでした。');
    }
  };

  changeVideoBtn?.addEventListener('click', () => {
    if (detecting || exportingFeedback) return;
    input.value = '';
    input.click();
  });

  sensitivity?.addEventListener('change', persistSessionMeta);
  feedbackNotes?.addEventListener('input', debounce(persistSessionMeta, 250));

  autoDetectBtn?.addEventListener('click', async () => {
    if (!currentFile || !currentVideoData || detecting) return;
    const existing = window.VReviewUI?.getScenes?.() || [];
    if (existing.length && !confirm('現在のSceneを新しい自動検出結果で置き換えます。続けますか？')) return;

    detecting = true;
    detectionController = new AbortController();
    autoDetectBtn.disabled = true;
    cancelDetectBtn?.classList.remove('hidden');
    if (feedbackBtn) feedbackBtn.disabled = true;
    preview.pause();
    resumeNotice?.classList.add('hidden');
    if (detectionWarning) detectionWarning.textContent = '';
    setDetectionState(0.01, '自動検出を開始しています…');

    try {
      const result = await window.VReviewSceneDetection.detect(currentFile, {
        duration: currentVideoData.duration,
        sensitivity: sensitivity?.value || 'standard',
        signal: detectionController.signal,
        onProgress: info => setDetectionState(info.progress, info.message)
      });

      lastDetectionRun = {
        ...result,
        scenes: (result.scenes || []).map(scene => ({ ...scene })),
        sensitivity: sensitivity?.value || result.sensitivity || 'standard'
      };
      window.VReviewUI?.replaceScenes(result.scenes);
      persistSessionMeta();

      const primary = result.scenes.filter(scene => scene.reviewTier !== 'weak').length;
      const weak = result.scenes.length - primary;
      window.VReviewStorage?.set('last-detector-summary', {
        fileName: currentFile.name,
        detectorVersion: result.detectorVersion,
        primary,
        weak,
        createdAt: new Date().toISOString()
      });

      if (detectionWarning) {
        detectionWarning.textContent = result.warnings?.length
          ? result.warnings.join(' ')
          : `本命 ${primary}件 / 要確認 ${weak}件。誤検出は「不要」、見逃しは手動追加、範囲ズレはStart / Endを修正してください。`;
      }
      autoDetectBtn.textContent = '自動検出をやり直す';
      if (feedbackBtn) feedbackBtn.disabled = false;
      sceneColumn && (sceneColumn.scrollTop = 0);
    } catch (error) {
      lastDetectionRun = null;
      if (error?.name === 'AbortError') {
        setDetectionState(0, '解析をキャンセルしました。', true);
        if (detectionWarning) detectionWarning.textContent = 'キャンセルしました。Scene編集データはそのまま残っています。';
      } else {
        setDetectionState(0, '自動検出に失敗しました。', true);
        if (detectionWarning) detectionWarning.textContent = error.message || '解析中にエラーが発生しました。';
      }
    } finally {
      detecting = false;
      detectionController = null;
      autoDetectBtn.disabled = false;
      cancelDetectBtn?.classList.add('hidden');
    }
  });

  cancelDetectBtn?.addEventListener('click', () => {
    if (!detecting) return;
    cancelDetectBtn.disabled = true;
    detectionController?.abort();
    setTimeout(() => { cancelDetectBtn.disabled = false; }, 300);
  });

  feedbackBtn?.addEventListener('click', async () => {
    if (!currentFile || !currentVideoData || !lastDetectionRun || exportingFeedback) return;
    const correctedScenes = window.VReviewUI?.getScenes?.() || [];
    if (!correctedScenes.length && !confirm('修正後Sceneが0件です。この状態で提出用ZIPを作成しますか？')) return;

    exportingFeedback = true;
    feedbackBtn.disabled = true;
    preview.pause();
    persistSessionMeta();
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
      setFeedbackState(1, `${result.filename} を作成しました。`);
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

  window.addEventListener('beforeunload', () => {
    persistSessionMeta();
    detectionController?.abort();
    window.VReviewVideo?.release(preview);
  });
}

function isSupportedVideo(file) {
  if (['video/mp4', 'video/webm'].includes(file.type)) return true;
  return /\.(mp4|webm)$/i.test(file.name || '');
}

function debounce(fn, wait) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
