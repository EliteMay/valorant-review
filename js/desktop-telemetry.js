document.addEventListener('DOMContentLoaded', async () => {
  const root = document.getElementById('telemetryPanel');
  if (!root) return;

  const api = window.vreviewDesktop;
  const status = document.getElementById('telemetryStatus');
  const detail = document.getElementById('telemetryDetail');
  const count = document.getElementById('telemetryEventCount');
  const mouse = document.getElementById('telemetryMouseCount');
  const buttons = document.getElementById('telemetryButtonCount');
  const keys = document.getElementById('telemetryKeyCount');
  const start = document.getElementById('telemetryStartBtn');
  const stop = document.getElementById('telemetryStopBtn');
  const open = document.getElementById('telemetryOpenFolderBtn');

  if (!api?.isDesktop) {
    status.textContent = 'Electron版のみ';
    detail.textContent = 'Web版ではInput Telemetryを記録しません。';
    [start, stop, open].forEach(button => { if (button) button.disabled = true; });
    return;
  }

  function render(state) {
    if (!state) return;
    count.textContent = String(state.inputEvents || 0);
    mouse.textContent = String(state.mouseSamples || 0);
    buttons.textContent = String(state.buttonEvents || 0);
    keys.textContent = String(state.keyEvents || 0);

    start.disabled = Boolean(state.active) || !state.supported || !state.helperAvailable;
    stop.disabled = !state.active;
    open.disabled = !state.sessionId;

    if (!state.helperAvailable) {
      status.textContent = 'Helperなし';
      detail.textContent = '最新版VReviewへ更新してください。';
      return;
    }

    if (state.phase === 'failed') {
      status.textContent = 'エラー';
      detail.textContent = state.lastError || 'Telemetry Helperが停止しました。';
      return;
    }

    if (state.active && state.valorantForeground) {
      status.textContent = '記録中 · VALORANT';
      detail.textContent = 'Mouse dx/dy・LMB・WASDだけを記録しています。';
      return;
    }

    if (state.active) {
      status.textContent = state.phase === 'starting' ? '起動中' : '記録中 · VALORANT待機';
      detail.textContent = 'VALORANTを前面にすると記録します。他アプリの入力は保存しません。';
      return;
    }

    status.textContent = '停止中';
    detail.textContent = state.sessionId
      ? '前回Sessionは保存済みです。'
      : '開始後にVALORANTへ戻ってプレイしてください。';
  }

  async function refresh() {
    try {
      render(await api.getTelemetryStatus());
    } catch (error) {
      status.textContent = '取得失敗';
      detail.textContent = error.message || String(error);
    }
  }

  start?.addEventListener('click', async () => {
    start.disabled = true;
    detail.textContent = 'Telemetry Helperを起動しています…';
    try {
      render(await api.startTelemetry());
    } catch (error) {
      status.textContent = '開始失敗';
      detail.textContent = error.message || String(error);
      await refresh();
    }
  });

  stop?.addEventListener('click', async () => {
    stop.disabled = true;
    detail.textContent = '記録を保存しています…';
    try {
      render(await api.stopTelemetry());
    } catch (error) {
      status.textContent = '停止失敗';
      detail.textContent = error.message || String(error);
      await refresh();
    }
  });

  open?.addEventListener('click', async () => {
    const result = await api.openTelemetryFolder();
    if (!result?.ok && result?.error) detail.textContent = result.error;
  });

  api.onTelemetryStatus(state => render(state));
  await refresh();
});
