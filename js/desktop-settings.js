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
  const status = document.getElementById('desktopSettingsStatus');

  async function refresh() {
    const [settings, runtime] = await Promise.all([api.getSettings(), api.getInfo()]);
    autoCheck.checked = settings.update.autoCheck;
    channel.value = settings.update.channel;
    concurrency.value = String(settings.analysis.workerConcurrency);
    info.textContent = `VReview ${runtime.appVersion} · Electron ${runtime.electronVersion} · ${runtime.platform}/${runtime.arch}`;
    if (mode) mode.textContent = 'Electron Desktop mode';
  }

  async function save() {
    await api.updateSettings({
      update: { autoCheck: autoCheck.checked, channel: channel.value },
      analysis: { workerConcurrency: Number(concurrency.value) }
    });
    setStatus('設定を保存しました。');
    await refresh();
  }

  function setStatus(message) {
    if (!status) return;
    status.textContent = message;
    status.classList.remove('hidden');
  }

  document.getElementById('saveDesktopSettings')?.addEventListener('click', () => save().catch(error => setStatus(`保存に失敗しました: ${error.message}`)));
  document.getElementById('resetDesktopSettings')?.addEventListener('click', async () => {
    await api.resetSettings();
    setStatus('既定値へ戻しました。');
    await refresh();
  });
  document.getElementById('openDesktopLogs')?.addEventListener('click', () => api.openLogFolder());
  document.getElementById('checkDesktopUpdates')?.addEventListener('click', async () => {
    const result = await api.checkForUpdates();
    setStatus(result.status === 'checked' && result.version ? `確認完了: ${result.version}` : `Update確認: ${result.status}`);
  });

  await refresh();
});
