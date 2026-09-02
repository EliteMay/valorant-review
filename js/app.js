document.addEventListener('DOMContentLoaded', () => {
  hydrateDashboard();
  initReviewPage();
});

function hydrateDashboard() {
  const last = window.VReviewStorage?.getVersioned('last-detector-summary', null, { schemaVersion: 1 });
  const detector = document.getElementById('detectorVersionCard');
  const main = document.getElementById('lastPrimaryCount');
  const weak = document.getElementById('lastWeakCount');

  if (detector) detector.textContent = `v${window.VReviewVersion?.detector || '--'}`;
  if (!last) return;
  if (main) main.textContent = String(last.primary ?? '--');
  if (weak) weak.textContent = String(last.weak ?? '--');
}

function initReviewPage() {
  const input = document.getElementById('videoInput');
  const dropzone = document.getElementById('dropzone');
  const uploadStatus = document.getElementById('uploadStatus');
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
  const savedFeedbackCount = document.getElementById('savedFeedbackCount');
  const savedFeedbackSize = document.getElementById('savedFeedbackSize');
  const feedbackQueueList = document.getElementById('feedbackQueueList');
  const exportFeedbackBatchBtn = document.getElementById('exportFeedbackBatchBtn');
  const clearFeedbackQueueBtn = document.getElementById('clearFeedbackQueueBtn');
  const resumeNotice = document.getElementById('resumeNotice');
  const storageStatus = document.getElementById('storageStatus');
  if (!input || !dropzone || !workspace || !preview) return;

  const diagnostics = window.VReviewDiagnostics;
  diagnostics?.breadcrumb('review.init');

  let currentFile = null;
  let currentVideoData = null;
  let currentFingerprint = null;
  let detecting = false;
  let exportingFeedback = false;
  let batchExporting = false;
  let lastDetectionRun = null;
  let detectionController = null;

  const isFeedbackBusy = () => exportingFeedback || batchExporting;

  const setCallout = (element, message = '', tone = 'pending') => {
    if (!element) return;
    element.textContent = message;
    element.classList.remove('pending', 'success');
    element.classList.add(tone === 'success' ? 'success' : 'pending');
    element.classList.toggle('hidden', !message);
  };

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
    if (!currentFingerprint) return true;
    return Boolean(window.VReviewStorage?.setVersioned(`draft-meta:${currentFingerprint}`, {
      sensitivity: sensitivity?.value || 'standard',
      notes: feedbackNotes?.value || '',
      fileName: currentFile?.name || '',
      updatedAt: new Date().toISOString()
    }, { schemaVersion: 1 }));
  };

  const backupSessionMeta = fingerprint => {
    if (!fingerprint) return false;
    return Boolean(window.VReviewStorage?.copy(`draft-meta:${fingerprint}`, `draft-backup-meta:${fingerprint}`));
  };

  const readSessionMeta = (fingerprint, backup = false) => {
    if (!fingerprint) return null;
    const key = backup ? `draft-backup-meta:${fingerprint}` : `draft-meta:${fingerprint}`;
    return window.VReviewStorage?.getVersioned(key, null, { schemaVersion: 1 }) ?? null;
  };

  const refreshFeedbackQueue = async () => {
    if (!window.VReviewFeedbackLibrary || !feedbackQueueList) return [];
    try {
      const items = await window.VReviewFeedbackLibrary.list();
      const bytes = items.reduce((sum, item) => sum + Number(item.byteSize || 0), 0);
      if (savedFeedbackCount) savedFeedbackCount.textContent = String(items.length);
      if (savedFeedbackSize) savedFeedbackSize.textContent = formatBytes(bytes);
      if (exportFeedbackBatchBtn) exportFeedbackBatchBtn.disabled = !items.length || isFeedbackBusy();
      if (clearFeedbackQueueBtn) clearFeedbackQueueBtn.disabled = !items.length || isFeedbackBusy();

      feedbackQueueList.replaceChildren();
      if (!items.length) {
        const empty = document.createElement('p');
        empty.className = 'helper';
        empty.textContent = '保存済みデータはまだありません。';
        feedbackQueueList.appendChild(empty);
      } else {
        items.forEach(item => feedbackQueueList.appendChild(createFeedbackQueueRow(item)));
      }

      if (feedbackBtn && currentFingerprint && lastDetectionRun) {
        const saved = items.some(item => item.id === currentFingerprint);
        feedbackBtn.textContent = saved ? 'このクリップの保存データを更新' : 'このクリップの改善データを保存';
      }
      return items;
    } catch (error) {
      const code = diagnostics?.captureError(error, 'FEEDBACK-LIBRARY-001', { action: 'list' }) || 'FEEDBACK-LIBRARY-001';
      if (feedbackQueueList) {
        feedbackQueueList.replaceChildren();
        const message = document.createElement('p');
        message.className = 'helper danger-text';
        message.textContent = `保存済みFeedbackを読み込めませんでした。 Error: ${code}`;
        feedbackQueueList.appendChild(message);
      }
      if (exportFeedbackBatchBtn) exportFeedbackBatchBtn.disabled = true;
      if (clearFeedbackQueueBtn) clearFeedbackQueueBtn.disabled = true;
      return [];
    }
  };

  const createFeedbackQueueRow = item => {
    const row = document.createElement('div');
    row.className = 'feedback-queue-row';

    const info = document.createElement('div');
    info.className = 'feedback-queue-info';
    const name = document.createElement('strong');
    name.textContent = item.displayName || 'clip';
    name.title = item.displayName || 'clip';
    const detail = document.createElement('span');
    detail.textContent = `${item.sceneCount} scenes · ${formatBytes(item.byteSize)}`;
    info.append(name, detail);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'feedback-queue-remove';
    remove.textContent = '削除';
    remove.setAttribute('aria-label', `${item.displayName || 'clip'} の保存済みFeedbackを削除`);
    remove.addEventListener('click', async () => {
      if (isFeedbackBusy()) return;
      if (!confirm('この保存済みFeedbackを削除しますか？')) return;
      try {
        await window.VReviewFeedbackLibrary.remove(item.id);
        diagnostics?.breadcrumb('feedback.queue-remove', { bytes: item.byteSize || 0 });
        await refreshFeedbackQueue();
      } catch (error) {
        const code = diagnostics?.captureError(error, 'FEEDBACK-LIBRARY-001', { action: 'remove' }) || 'FEEDBACK-LIBRARY-001';
        setFeedbackState(0, `保存済みFeedbackを削除できませんでした。 Error: ${code}`);
      }
    });

    row.append(info, remove);
    return row;
  };

  const handleFile = async file => {
    if (!file || !isSupportedVideo(file)) {
      diagnostics?.breadcrumb('video.load.rejected', { mediaType: file?.type || 'unknown', extension: fileExtension(file?.name) });
      setCallout(uploadStatus, 'MP4 または WebM を選択してください。ファイルを選び直せます。');
      return;
    }
    if (detecting || isFeedbackBusy()) return;

    const sizeMB = round1(file.size / 1024 / 1024);
    diagnostics?.breadcrumb('video.load.start', { mediaType: file.type || 'unknown', extension: fileExtension(file.name), sizeMB });
    setCallout(uploadStatus, '動画を読み込んでいます…', 'pending');

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
      setCallout(uploadStatus, '', 'success');
      setCallout(storageStatus, '', 'pending');
      diagnostics?.breadcrumb('video.load.success', {
        mediaType: file.type || 'unknown', sizeMB, duration: round1(data.duration), width: data.width, height: data.height
      });

      const savedMeta = readSessionMeta(currentFingerprint, false);
      const backupMeta = readSessionMeta(currentFingerprint, true);
      const hasDraft = window.VReviewUI?.hasSavedDraft(currentFingerprint);
      const hasBackup = window.VReviewUI?.hasSavedBackup(currentFingerprint);
      let restored = false;
      let restoredBackup = false;
      let freshBackupCreated = false;

      if (hasDraft) {
        restored = confirm('この動画には前回のScene編集データがあります。\n\nOK: 続きから再開\nキャンセル: 新規開始（前回データはBackupへ残します）');
        if (!restored) {
          const sceneBackup = window.VReviewUI?.backupSavedDraft(currentFingerprint);
          const metaBackup = backupSessionMeta(currentFingerprint);
          freshBackupCreated = Boolean(sceneBackup || metaBackup);
          window.VReviewUI?.clearSavedDraft(currentFingerprint);
          window.VReviewUI?.clearScenes({ persist: false });
          diagnostics?.breadcrumb('draft.start-new', { backupCreated: freshBackupCreated });
        }
      } else if (hasBackup) {
        restoredBackup = confirm('この動画には以前のScene Backupがあります。復元しますか？');
      }

      let activeMeta = null;
      if (restored) {
        const count = window.VReviewUI?.restoreSavedDraft(currentFingerprint) || 0;
        activeMeta = savedMeta;
        diagnostics?.breadcrumb('draft.restore', { sceneCount: count });
        setCallout(resumeNotice, `前回のScene ${count}件を復元しました。改善データを保存する場合は自動検出をもう一度実行してください。`, 'success');
      } else if (restoredBackup) {
        const count = window.VReviewUI?.restoreSavedBackup(currentFingerprint) || 0;
        activeMeta = backupMeta;
        diagnostics?.breadcrumb('draft.restore-backup', { sceneCount: count });
        setCallout(resumeNotice, `BackupからScene ${count}件を復元しました。復元後の状態は現在Draftとして保存されます。`, 'success');
      } else {
        window.VReviewUI?.clearScenes({ persist: false });
        activeMeta = null;
        setCallout(resumeNotice, freshBackupCreated ? '新規開始しました。前回のSceneはBackupとして残しています。' : '', freshBackupCreated ? 'pending' : 'success');
      }

      if (sensitivity) sensitivity.value = activeMeta?.sensitivity || 'standard';
      if (feedbackNotes) feedbackNotes.value = activeMeta?.notes || '';
      sceneColumn && (sceneColumn.scrollTop = 0);

      if (autoDetectBtn) {
        autoDetectBtn.disabled = false;
        autoDetectBtn.textContent = (restored || restoredBackup) ? '自動検出を実行して更新' : 'キルSceneを自動検出';
      }
      cancelDetectBtn?.classList.add('hidden');
      if (feedbackBtn) {
        feedbackBtn.disabled = true;
        feedbackBtn.textContent = 'このクリップの改善データを保存';
      }
      setDetectionState(0, '', false);
      setFeedbackState(0, '', false);

      if (detectionWarning) {
        detectionWarning.textContent = (restored || restoredBackup)
          ? 'Scene編集は復元済みです。Detector診断は保存していないため、改善データを保存する前に自動検出を再実行してください。'
          : `Detector v${window.VReviewVersion?.detector || '--'}で本命Sceneと要確認候補を検出します。`;
      }

      if (meta) {
        const mb = (file.size / 1024 / 1024).toFixed(1);
        meta.replaceChildren(
          makeMetaChip(file.name),
          makeMetaChip(window.VReviewVideo.formatTime(data.duration)),
          makeMetaChip(`${data.width}×${data.height}`),
          makeMetaChip(`${mb} MB`)
        );
      }
      persistSessionMeta();
      await refreshFeedbackQueue();
    } catch (error) {
      const code = diagnostics?.captureError(error, 'MEDIA-LOAD-001', { mediaType: file.type || 'unknown', extension: fileExtension(file.name), sizeMB }) || 'MEDIA-LOAD-001';
      setCallout(uploadStatus, `${error.message || '動画を読み込めませんでした。'} 別のMP4 / WebMを選んで再試行してください。 Error: ${code}`);
    }
  };

  changeVideoBtn?.addEventListener('click', () => {
    if (detecting || isFeedbackBusy()) return;
    diagnostics?.breadcrumb('video.change-requested');
    input.value = '';
    input.click();
  });

  sensitivity?.addEventListener('change', () => {
    diagnostics?.breadcrumb('detector.sensitivity-changed', { sensitivity: sensitivity.value });
    persistSessionMeta();
  });
  feedbackNotes?.addEventListener('input', debounce(persistSessionMeta, 250));

  autoDetectBtn?.addEventListener('click', async () => {
    if (!currentFile || !currentVideoData || detecting || isFeedbackBusy()) return;
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
    diagnostics?.breadcrumb('detector.start', {
      sensitivity: sensitivity?.value || 'standard', duration: round1(currentVideoData.duration), width: currentVideoData.width, height: currentVideoData.height
    });

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
      window.VReviewStorage?.setVersioned('last-detector-summary', {
        fileName: currentFile.name,
        detectorVersion: result.detectorVersion,
        primary,
        weak,
        createdAt: new Date().toISOString()
      }, { schemaVersion: 1 });

      diagnostics?.breadcrumb('detector.success', {
        detectorVersion: result.detectorVersion, primary, weak, total: result.scenes.length,
        warnings: Array.isArray(result.warnings) ? result.warnings.length : 0
      });

      if (detectionWarning) {
        detectionWarning.textContent = result.warnings?.length
          ? result.warnings.join(' ')
          : `本命 ${primary}件 / 要確認 ${weak}件。誤検出は「不要」、見逃しは手動追加、範囲ズレはStart / Endを修正してください。`;
      }
      autoDetectBtn.textContent = '自動検出をやり直す';
      if (feedbackBtn) feedbackBtn.disabled = false;
      sceneColumn && (sceneColumn.scrollTop = 0);
      await refreshFeedbackQueue();
    } catch (error) {
      lastDetectionRun = null;
      if (error?.name === 'AbortError') {
        diagnostics?.breadcrumb('detector.cancelled');
        setDetectionState(0, '解析をキャンセルしました。', true);
        if (detectionWarning) detectionWarning.textContent = 'キャンセルしました。Scene編集データはそのまま残っています。';
      } else {
        const code = diagnostics?.captureError(error, 'DETECTOR-RUN-001', { sensitivity: sensitivity?.value || 'standard', duration: round1(currentVideoData.duration) }) || 'DETECTOR-RUN-001';
        setDetectionState(0, `自動検出に失敗しました。 Error: ${code}`, true);
        if (detectionWarning) detectionWarning.textContent = `${error.message || '解析中にエラーが発生しました。'} 手動Scene追加は引き続き利用できます。`;
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
    diagnostics?.breadcrumb('detector.cancel-requested');
    cancelDetectBtn.disabled = true;
    detectionController?.abort();
    setTimeout(() => { cancelDetectBtn.disabled = false; }, 300);
  });

  feedbackBtn?.addEventListener('click', async () => {
    if (!currentFile || !currentVideoData || !lastDetectionRun || isFeedbackBusy()) return;
    const correctedScenes = window.VReviewUI?.getScenes?.() || [];
    if (!correctedScenes.length && !confirm('修正後Sceneが0件です。この状態で改善データを保存しますか？')) return;

    exportingFeedback = true;
    feedbackBtn.disabled = true;
    if (exportFeedbackBatchBtn) exportFeedbackBatchBtn.disabled = true;
    if (clearFeedbackQueueBtn) clearFeedbackQueueBtn.disabled = true;
    preview.pause();
    persistSessionMeta();
    setFeedbackState(0.01, 'このクリップの改善データを準備しています…');
    diagnostics?.breadcrumb('feedback.queue-save-start', { sceneCount: correctedScenes.length, packageVersion: window.VReviewVersion?.feedback || '' });

    try {
      const prepared = await window.VReviewFeedbackPackage.prepare({
        file: currentFile,
        videoData: currentVideoData,
        detectionRun: lastDetectionRun,
        correctedScenes,
        notes: feedbackNotes?.value?.trim() || '',
        onProgress: (progress, message) => setFeedbackState(progress * 0.92, message)
      });
      setFeedbackState(0.94, 'ブラウザへ保存しています…');
      const summary = await window.VReviewFeedbackLibrary.save(currentFingerprint, prepared);
      diagnostics?.breadcrumb('feedback.queue-save-success', {
        sceneCount: correctedScenes.length,
        bytes: summary.byteSize || 0,
        packageVersion: window.VReviewVersion?.feedback || ''
      });
      setFeedbackState(1, `保存しました。最後に「保存済みをまとめてZIP作成」を1回押せばOKです。`, true);
    } catch (error) {
      const code = diagnostics?.captureError(error, 'FEEDBACK-SAVE-001', {
        sceneCount: correctedScenes.length,
        packageVersion: window.VReviewVersion?.feedback || ''
      }) || 'FEEDBACK-SAVE-001';
      setFeedbackState(0, `${error.message || '改善データを保存できませんでした。'} Scene編集は残っています。 Error: ${code}`);
    } finally {
      exportingFeedback = false;
      feedbackBtn.disabled = false;
      await refreshFeedbackQueue();
    }
  });

  exportFeedbackBatchBtn?.addEventListener('click', async () => {
    if (isFeedbackBusy() || detecting) return;
    batchExporting = true;
    if (feedbackBtn) feedbackBtn.disabled = true;
    exportFeedbackBatchBtn.disabled = true;
    if (clearFeedbackQueueBtn) clearFeedbackQueueBtn.disabled = true;
    setFeedbackState(0.01, '保存済みFeedbackを読み込んでいます…');
    diagnostics?.breadcrumb('feedback.batch-export-start');

    try {
      const packages = await window.VReviewFeedbackLibrary.getAll();
      const result = await window.VReviewFeedbackPackage.buildBatch(packages, {
        onProgress: (progress, message) => setFeedbackState(progress, message)
      });
      window.VReviewFeedbackPackage.download(result.blob, result.filename);
      diagnostics?.breadcrumb('feedback.batch-export-success', { clipCount: packages.length, bytes: result.blob?.size || 0 });
      setFeedbackState(1, `${packages.length}クリップを ${result.filename} にまとめました。保存済みデータはまだ残っています。`, true);
    } catch (error) {
      const code = diagnostics?.captureError(error, 'FEEDBACK-BATCH-EXPORT-001', { packageVersion: window.VReviewVersion?.feedback || '' }) || 'FEEDBACK-BATCH-EXPORT-001';
      setFeedbackState(0, `${error.message || 'まとめZIPを作成できませんでした。'} 保存済みデータは消えていません。 Error: ${code}`);
    } finally {
      batchExporting = false;
      if (feedbackBtn) feedbackBtn.disabled = !lastDetectionRun;
      await refreshFeedbackQueue();
    }
  });

  clearFeedbackQueueBtn?.addEventListener('click', async () => {
    if (isFeedbackBusy() || detecting) return;
    const items = await window.VReviewFeedbackLibrary.list().catch(() => []);
    if (!items.length) return;
    if (!confirm(`保存済みFeedback ${items.length}件をすべて削除しますか？\nこの操作は元に戻せません。`)) return;
    try {
      await window.VReviewFeedbackLibrary.clear();
      diagnostics?.breadcrumb('feedback.queue-clear', { count: items.length });
      setFeedbackState(1, '保存済みFeedbackをすべて削除しました。', true);
      await refreshFeedbackQueue();
    } catch (error) {
      const code = diagnostics?.captureError(error, 'FEEDBACK-LIBRARY-001', { action: 'clear' }) || 'FEEDBACK-LIBRARY-001';
      setFeedbackState(0, `保存済みFeedbackを削除できませんでした。 Error: ${code}`);
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
  dropzone.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    input.click();
  });

  window.addEventListener('vreview:storage-error', event => {
    const detail = event.detail || {};
    setCallout(storageStatus, `保存に失敗しました: ${detail.message || 'ブラウザStorageを利用できません。'} ページを閉じる前にScene内容を確認してください。Diagnosticsにも記録しています。`);
  });

  window.addEventListener('storage', event => {
    if (!currentFingerprint || !window.VReviewStorage?.keyFor) return;
    const draftKey = window.VReviewStorage.keyFor(`draft-scenes:${currentFingerprint}`);
    if (event.key !== draftKey) return;
    diagnostics?.breadcrumb('storage.tab-conflict');
    setCallout(storageStatus, '同じ動画のDraftが別タブで更新されました。このタブの保存で上書きする可能性があります。片方のタブだけで編集してください。');
  });

  window.addEventListener('beforeunload', () => {
    persistSessionMeta();
    detectionController?.abort();
    window.VReviewVideo?.release(preview);
  });

  refreshFeedbackQueue();
}

function makeMetaChip(text) {
  const span = document.createElement('span');
  span.textContent = text;
  return span;
}

function isSupportedVideo(file) {
  if (['video/mp4', 'video/webm'].includes(file.type)) return true;
  return /\.(mp4|webm)$/i.test(file.name || '');
}

function fileExtension(name) {
  return String(name || '').match(/\.([A-Za-z0-9]+)$/)?.[1]?.toLowerCase() || '';
}

function formatBytes(value) {
  const bytes = Math.max(0, Number(value || 0));
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function round1(value) {
  return Number.isFinite(Number(value)) ? Math.round(Number(value) * 10) / 10 : null;
}

function debounce(fn, wait) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
