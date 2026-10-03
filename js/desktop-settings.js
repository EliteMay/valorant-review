document.addEventListener('DOMContentLoaded', async () => {
  const root = document.getElementById('desktopSettingsRoot');
  if (!root) return;

  const api = window.vreviewDesktop;
  const mode = document.getElementById('desktopModeStatus');
  if (!api?.isDesktop) {
    if (mode) mode.textContent = 'Web版ではDesktop設定は利用できません。Electron版で開いてください。';
    root.querySelectorAll('input,select,button[data-desktop-action]').forEach(el => { el.disabled = true; });
    return;
  }

  const autoCheck = document.getElementById('settingAutoCheck');
  const channel = document.getElementById('settingUpdateChannel');
  const concurrency = document.getElementById('settingWorkerConcurrency');
  const info = document.getElementById('desktopRuntimeInfo');
  const recordingDirectory = document.getElementById('recordingSaveDirectory');
  const status = document.getElementById('desktopSettingsStatus');
  const updateButton = document.getElementById('checkDesktopUpdates');
  const trackerDirectory = document.getElementById('trackerSaveDirectory');
  const trackerMaxCaptures = document.getElementById('trackerMaxCaptures');
  const trackerStableWait = document.getElementById('trackerStableWait');
  const trackerScrollRatio = document.getElementById('trackerScrollRatio');
  const trackerBrowser = document.getElementById('trackerBrowser');
  const trackerCompression = document.getElementById('trackerCompression');
  const trackerAutoOpen = document.getElementById('trackerAutoOpen');

  async function refresh() {
    const [settings, runtime] = await Promise.all([api.getSettings(), api.getInfo()]);
    autoCheck.checked = settings.update.autoCheck;
    channel.value = settings.update.channel;
    concurrency.value = String(settings.analysis.workerConcurrency);
    recordingDirectory.textContent = settings.recording?.saveDirectory || '既定: Windows Videos / VReview';
    recordingDirectory.title = settings.recording?.saveDirectory || '';
    trackerDirectory.textContent = settings.tracker?.saveDirectory || '既定: VReview userData / TrackerCaptures';
    trackerDirectory.title = settings.tracker?.saveDirectory || '';
    trackerMaxCaptures.value = String(settings.tracker?.maxCaptures || 100);
    trackerStableWait.value = String(settings.tracker?.stableWaitMs || 400);
    trackerScrollRatio.value = String(settings.tracker?.scrollStepRatio || 0.8);
    trackerBrowser.value = settings.tracker?.browserTarget || 'chrome';
    trackerCompression.value = settings.tracker?.packageCompression || 'standard';
    trackerAutoOpen.checked = settings.tracker?.autoOpenResultFolder === true;
    info.textContent = `VReview ${runtime.appVersion} · Electron ${runtime.electronVersion} · ${runtime.platform}/${runtime.arch}`;
    if (mode) mode.textContent = 'Electron Desktop mode';
  }

  async function save() {
    await api.updateSettings({
      update: { autoCheck: autoCheck.checked, channel: channel.value },
      analysis: { workerConcurrency: Number(concurrency.value) },
      tracker: {
        maxCaptures: Number(trackerMaxCaptures.value),
        stableWaitMs: Number(trackerStableWait.value),
        scrollStepRatio: Number(trackerScrollRatio.value),
        browserTarget: trackerBrowser.value,
        packageCompression: trackerCompression.value,
        autoOpenResultFolder: trackerAutoOpen.checked
      }
    });
    setStatus('設定を保存しました。');
    await refresh();
  }

  function setStatus(message) {
    if (!status) return;
    status.textContent = message;
    status.classList.remove('hidden');
  }

  function renderUpdateState(state) {
    if (!state) return;
    const percent = Number.isFinite(Number(state.percent)) ? Math.round(Number(state.percent)) : null;

    if (state.status === 'checking') {
      setStatus('Updateを確認しています…');
      if (updateButton) updateButton.disabled = true;
      return;
    }
    if (state.status === 'available') {
      setStatus(`v${state.version} が利用できます。`);
      if (updateButton) {
        updateButton.disabled = false;
        updateButton.textContent = `v${state.version}へ更新`;
      }
      return;
    }
    if (state.status === 'downloading') {
      setStatus(percent == null ? 'Updateをダウンロードしています…' : `Updateをダウンロード中… ${percent}%`);
      if (updateButton) updateButton.disabled = true;
      return;
    }
    if (state.status === 'downloaded') {
      setStatus('Updateのダウンロード完了。再起動準備中です…');
      if (updateButton) updateButton.disabled = true;
      return;
    }
    if (state.status === 'installing') {
      setStatus('Updateを適用して再起動します…');
      if (updateButton) updateButton.disabled = true;
      return;
    }
    if (state.status === 'up-to-date') {
      setStatus(`最新版です（v${state.currentVersion || state.version}）。`);
      if (updateButton) {
        updateButton.disabled = false;
        updateButton.textContent = 'Update確認・適用';
      }
      return;
    }
    if (state.status === 'failed') {
      setStatus(`Update失敗: ${state.message || '不明なエラー'}`);
      if (updateButton) {
        updateButton.disabled = false;
        updateButton.textContent = 'Update再試行';
      }
      return;
    }
    if (state.status === 'development') {
      setStatus('Development buildでは自動Updateしません。');
      if (updateButton) updateButton.disabled = false;
    }
  }

  document.getElementById('saveDesktopSettings')?.addEventListener('click', () => save().catch(error => setStatus(`保存に失敗しました: ${error.message}`)));
  document.getElementById('resetDesktopSettings')?.addEventListener('click', async () => {
    await api.resetSettings();
    setStatus('既定値へ戻しました。');
    await refresh();
  });
  document.getElementById('chooseRecordingFolder')?.addEventListener('click', async () => {
    try {
      await api.chooseRecordingFolder();
      setStatus('録画保存先を更新しました。');
      await refresh();
    } catch (error) {
      setStatus(`録画保存先の変更に失敗しました: ${error.message || String(error)}`);
    }
  });
  document.getElementById('chooseTrackerFolder')?.addEventListener('click', async () => {
    try {
      await api.chooseTrackerFolder();
      setStatus('Tracker収集の保存先を更新しました。');
      await refresh();
    } catch (error) {
      setStatus(`Tracker保存先の変更に失敗しました: ${error.message || String(error)}`);
    }
  });
  document.getElementById('openDesktopLogs')?.addEventListener('click', () => api.openLogFolder());
  document.getElementById('checkDesktopUpdates')?.addEventListener('click', async () => {
    if (updateButton) updateButton.disabled = true;
    setStatus('Updateを確認しています…');
    try {
      const result = await api.updateNow();
      renderUpdateState(result);
    } catch (error) {
      renderUpdateState({ status: 'failed', message: error.message || String(error) });
    }
  });

  api.onUpdateStatus?.(state => renderUpdateState(state));

  await refresh();
  try {
    renderUpdateState(await api.getUpdateStatus());
  } catch {
    // Settings remain usable even if updater status cannot be read.
  }
});
