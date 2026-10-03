document.addEventListener('DOMContentLoaded', () => {
  const api = window.vreviewDesktop;
  const $ = id => document.getElementById(id);
  const els = {
    notice: $('desktopOnlyNotice'), list: $('trackerWindowList'), previewShell: $('trackerPreviewShell'), preview: $('trackerPreview'),
    selection: $('trackerSelectionStatus'), refresh: $('refreshTrackerWindows'), history: $('collectHistoryBtn'),
    current: $('collectCurrentMatchBtn'), calibrate: $('startCalibrationBtn'), calibrationStatus: $('trackerCalibrationStatus'),
    marker: $('trackerCalibrationMarker'), phase: $('trackerPhase'), target: $('trackerTarget'), mode: $('trackerMode'),
    currentState: $('trackerCurrent'), count: $('trackerCaptureCount'), elapsed: $('trackerElapsed'), save: $('trackerSaveState'),
    message: $('trackerMessage'), error: $('trackerError'), stop: $('trackerStopBtn'), result: $('trackerResultPanel'),
    resultSummary: $('trackerResultSummary'), openFolder: $('openTrackerFolderBtn'), packageBtn: $('createTrackerPackageBtn'), discardRecovery: $('discardRecoveredSessionBtn'),
    packageStatus: $('trackerPackageStatus')
  };
  let state = null;
  let selectedCandidateId = null;
  let startedAt = null;
  let calibrationStep = -1;
  let calibrationPoints = {};
  const tabs = ['scoreboard', 'performance', 'economy', 'rounds', 'duels'];

  if (!api?.isDesktop || typeof api.listTrackerWindows !== 'function') {
    els.notice.classList.add('pending');
    els.notice.innerHTML = '<strong>Tracker CollectorはDesktop版で使用できます。</strong>GitHub Pages版ではWindowsのブラウザウィンドウ操作を行いません。';
    disableControls();
    return;
  }

  function disableControls() {
    [els.refresh, els.history, els.current, els.calibrate, els.stop, els.openFolder, els.packageBtn].forEach(el => { if (el) el.disabled = true; });
  }

  function renderStatus(next) {
    state = next || state || {};
    if (state.startedAt) startedAt = new Date(state.startedAt).getTime();
    const labels = { idle:'待機中', ready:'準備完了', running:'実行中', 'paused-focus':'Pause', stopping:'停止中', completed:'完了', interrupted:'中断', failed:'失敗' };
    els.phase.textContent = labels[state.phase] || state.phase || '待機中';
    els.target.textContent = state.target?.title || '未選択';
    els.mode.textContent = state.captureMode || '-';
    els.currentState.textContent = state.currentScreen || '-';
    els.count.textContent = String(state.captureCount || 0);
    els.save.textContent = state.sessionDirectory ? 'Local Session' : '-';
    els.stop.disabled = !state.active;
    els.history.disabled = !state.target || state.active;
    els.current.disabled = !state.target || state.active;
    els.calibrate.disabled = !state.target || state.active;

    if (state.message) {
      els.message.textContent = state.message;
      els.message.classList.remove('hidden');
      els.message.classList.toggle('success', state.phase === 'completed');
    } else {
      els.message.classList.add('hidden');
    }

    if (state.lastError) {
      els.error.innerHTML = '<strong>' + escapeHtml(state.lastError.id || 'TC-ERROR') + '</strong><br>' +
        escapeHtml(state.lastError.message || '') + '<br><span>' + escapeHtml(state.lastError.action || '') + '</span>';
      els.error.classList.remove('hidden');
    } else {
      els.error.classList.add('hidden');
    }

    if (['completed','interrupted','failed'].includes(state.phase) && state.sessionDirectory) {
      els.result.classList.remove('hidden');
      els.resultSummary.textContent = `${state.captureCount || 0}枚を保存 · 終了理由: ${state.stopReason || state.phase}`;
      els.discardRecovery?.classList.toggle('hidden', !state.recoveredSession);
    }
    if (state.packageStatus === 'completed') {
      els.packageStatus.textContent = `ZIP作成済み · ${formatBytes(state.packageBytes || 0)}`;
    } else if (state.packageStatus === 'creating') {
      els.packageStatus.textContent = 'ZIPを作成中…';
    } else if (state.packageStatus === 'failed') {
      els.packageStatus.textContent = 'ZIP作成に失敗しました。Diagnosticsを確認してください。';
    }
  }

  async function refreshWindows() {
    els.refresh.disabled = true;
    els.list.innerHTML = '<div class="muted">ウィンドウを確認中…</div>';
    try {
      const windows = await api.listTrackerWindows();
      els.list.innerHTML = '';
      if (!windows.length) {
        els.list.innerHTML = '<div class="status-callout pending">候補が見つかりません。ChromeでTracker.ggを開き、最小化せずに再試行してください。</div>';
        return;
      }
      for (const item of windows) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'tracker-window-option';
        button.dataset.candidateId = item.candidateId;
        const rank = /tracker/i.test(item.title || '') ? '<em>Tracker候補</em>' : '';
        button.innerHTML = '<strong>' + escapeHtml(item.title || 'Untitled') + '</strong>' + rank +
          '<span>' + escapeHtml((item.browser || 'unknown') + ' · ' + item.bounds.width + '×' + item.bounds.height) + '</span>';
        button.addEventListener('click', () => chooseWindow(item.candidateId, button));
        els.list.appendChild(button);
      }
    } catch (error) {
      els.list.innerHTML = '<div class="tracker-error">' + escapeHtml(error.message || String(error)) + '</div>';
    } finally {
      els.refresh.disabled = false;
    }
  }

  async function chooseWindow(candidateId, button) {
    const preview = await api.previewTrackerWindow(candidateId);
    selectedCandidateId = candidateId;
    document.querySelectorAll('.tracker-window-option').forEach(el => el.classList.toggle('selected', el === button));
    if (preview.previewDataUrl) {
      els.preview.src = preview.previewDataUrl;
      els.previewShell.classList.add('ready');
    }
    state = await api.selectTrackerWindow(candidateId);
    els.selection.textContent = '対象を確定: ' + (state.target?.title || preview.title);
    els.selection.classList.remove('hidden');
    renderStatus(state);
    const calibration = await api.getTrackerCalibration();
    els.calibrationStatus.textContent = calibration ? '保存済み · 必要ならやり直せます' : '未設定 · Current Match収集前に設定してください';
  }

  async function run(action) {
    els.result.classList.add('hidden');
    try {
      await action();
    } catch (error) {
      els.error.textContent = error.message || String(error);
      els.error.classList.remove('hidden');
    }
  }

  els.history.addEventListener('click', () => run(() => api.startTrackerHistory()));
  els.current.addEventListener('click', () => run(() => api.startTrackerCurrentMatch()));
  els.stop.addEventListener('click', () => api.stopTrackerCollector('user-stop'));
  els.refresh.addEventListener('click', refreshWindows);
  els.openFolder.addEventListener('click', () => api.openTrackerFolder());
  els.discardRecovery?.addEventListener('click', async () => {
    if (!confirm('途中終了したTracker SessionとRaw Captureを削除します。よろしいですか？')) return;
    try {
      await api.discardRecoveredTrackerSession();
      els.result.classList.add('hidden');
      els.discardRecovery.classList.add('hidden');
      renderStatus(await api.getTrackerStatus());
    } catch (error) {
      els.packageStatus.textContent = error.message || String(error);
    }
  });

  els.packageBtn.addEventListener('click', async () => {
    els.packageBtn.disabled = true;
    try {
      const result = await api.createTrackerPackage();
      els.packageStatus.textContent = 'ZIP作成済み · ' + formatBytes(result.bytes || 0);
    } catch (error) {
      els.packageStatus.textContent = error.message || String(error);
    } finally {
      els.packageBtn.disabled = false;
    }
  });

  els.calibrate.addEventListener('click', () => {
    if (!selectedCandidateId || !els.preview.src) return;
    calibrationStep = 0;
    calibrationPoints = {};
    els.calibrationStatus.textContent = 'プレビュー上の Scoreboard をクリックしてください';
    els.preview.style.cursor = 'crosshair';
  });

  els.preview.addEventListener('click', async event => {
    if (calibrationStep < 0 || calibrationStep >= tabs.length) return;
    const rect = els.preview.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    const key = tabs[calibrationStep];
    calibrationPoints[key] = { x, y };
    els.marker.style.left = (x * 100) + '%';
    els.marker.style.top = (y * 100) + '%';
    els.marker.classList.remove('hidden');
    calibrationStep++;
    if (calibrationStep < tabs.length) {
      els.calibrationStatus.textContent = '次に ' + tabs[calibrationStep] + ' をクリックしてください';
      return;
    }
    try {
      await api.saveTrackerCalibration({ points: calibrationPoints });
      els.calibrationStatus.textContent = 'Calibrationを保存しました。Current Match収集を開始できます。';
    } catch (error) {
      els.calibrationStatus.textContent = '保存失敗: ' + (error.message || String(error));
    } finally {
      calibrationStep = -1;
      els.preview.style.cursor = '';
      setTimeout(() => els.marker.classList.add('hidden'), 800);
    }
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && state?.active) {
      event.preventDefault();
      api.stopTrackerCollector('escape-key');
    }
  });

  api.onTrackerStatus?.(renderStatus);
  setInterval(() => {
    if (!startedAt || !state?.active) return;
    const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    els.elapsed.textContent = String(Math.floor(seconds / 60)).padStart(2,'0') + ':' + String(seconds % 60).padStart(2,'0');
  }, 500);

  Promise.all([api.getTrackerStatus(), refreshWindows()])
    .then(([initial]) => renderStatus(initial))
    .catch(error => { els.error.textContent = error.message || String(error); els.error.classList.remove('hidden'); });

  function formatBytes(bytes) {
    if (!bytes) return '0 B';
    if (bytes >= 1024 * 1024 * 1024) return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
    if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    return Math.round(bytes / 1024) + ' KB';
  }
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }
});
