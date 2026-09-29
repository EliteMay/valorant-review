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
  const bytes = document.getElementById('recordingBytes');
  const videoState = document.getElementById('recordingVideoState');
  const start = document.getElementById('telemetryStartBtn');
  const stop = document.getElementById('telemetryStopBtn');
  const open = document.getElementById('telemetryOpenFolderBtn');

  let mediaRecorder = null;
  let mediaStream = null;
  let chunkQueue = Promise.resolve();
  let telemetryState = null;
  let recordingState = null;
  let stopInFlight = null;

  if (!api?.isDesktop) {
    status.textContent = 'Electron版のみ';
    detail.textContent = 'Web版では画面録画 / Input Telemetryを利用できません。';
    [start, stop, open].forEach(button => { if (button) button.disabled = true; });
    return;
  }

  root.classList.remove('hidden');

  function chooseMimeType() {
    const candidates = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm'
    ];
    return candidates.find(type => window.MediaRecorder?.isTypeSupported?.(type)) || '';
  }

  function getVideoMeta() {
    const track = mediaStream?.getVideoTracks?.()[0];
    const settings = track?.getSettings?.() || {};
    return {
      width: Number(settings.width) || null,
      height: Number(settings.height) || null,
      frameRate: Number(settings.frameRate) || null,
      requestedFrameRate: 60
    };
  }

  function getAudioMeta() {
    return {
      enabled: Boolean(mediaStream?.getAudioTracks?.().length),
      systemLoopback: true
    };
  }

  function formatBytes(value) {
    const number = Number(value || 0);
    if (number < 1024 * 1024) return `${Math.round(number / 1024)} KB`;
    return `${(number / 1024 / 1024).toFixed(1)} MB`;
  }

  function render() {
    const telemetry = telemetryState || {};
    const recording = recordingState || {};

    count.textContent = String(telemetry.inputEvents || 0);
    mouse.textContent = String(telemetry.mouseSamples || 0);
    buttons.textContent = String(telemetry.buttonEvents || 0);
    keys.textContent = String(telemetry.keyEvents || 0);
    if (bytes) bytes.textContent = formatBytes(recording.bytesWritten || 0);

    if (videoState) {
      if (recording.active) {
        const video = recording.video || {};
        const size = video.width && video.height ? `${video.width}×${video.height}` : '画面取得中';
        videoState.textContent = `${size} · WebM`;
      } else if (recording.fileName) {
        videoState.textContent = recording.phase === 'completed' ? '保存済み' : recording.phase || '停止中';
      } else {
        videoState.textContent = '未開始';
      }
    }

    const captureActive = Boolean(recording.active || mediaRecorder?.state === 'recording');
    start.disabled = captureActive || Boolean(stopInFlight) || telemetry.helperAvailable === false;
    stop.disabled = !captureActive || Boolean(stopInFlight);
    open.disabled = !(recording.sessionId || telemetry.sessionId);

    if (telemetry.helperAvailable === false) {
      status.textContent = 'Helperなし';
      detail.textContent = '最新版VReviewへ更新してください。';
      return;
    }

    if (recording.phase === 'failed' || telemetry.phase === 'failed') {
      status.textContent = 'エラー';
      detail.textContent = recording.lastError || telemetry.lastError || '記録処理が停止しました。';
      return;
    }

    if (stopInFlight) {
      status.textContent = '保存中';
      detail.textContent = '最後の録画Chunkと入力ログを書き込んでいます…';
      return;
    }

    if (captureActive && telemetry.valorantForeground) {
      status.textContent = '録画中 · VALORANT';
      detail.textContent = 'Primary画面 + System Audio + Mouse/LMB/WASDを同じSessionへ保存しています。';
      return;
    }

    if (captureActive) {
      status.textContent = '録画中 · VALORANT待機';
      detail.textContent = '画面録画は継続中です。VALORANTが前面の時だけInput Telemetryを保存します。';
      return;
    }

    status.textContent = '停止中';
    detail.textContent = recording.sessionId || telemetry.sessionId
      ? '前回Sessionは保存済みです。'
      : '「録画＋入力 開始」を押してからVALORANTへ戻ってください。';
  }

  async function refresh() {
    try {
      const [telemetry, recording] = await Promise.all([
        api.getTelemetryStatus(),
        api.getRecordingStatus()
      ]);
      telemetryState = telemetry;
      recordingState = recording;
      render();
    } catch (error) {
      status.textContent = '取得失敗';
      detail.textContent = error.message || String(error);
    }
  }

  async function stopMediaRecorder() {
    const recorder = mediaRecorder;
    if (!recorder) return;

    if (recorder.state !== 'inactive') {
      const result = await Promise.race([
        new Promise(resolve => {
          recorder.addEventListener('stop', () => resolve('stopped'), { once: true });
          try {
            recorder.stop();
          } catch {
            resolve('stopped');
          }
        }),
        new Promise(resolve => setTimeout(() => resolve('timeout'), 5000))
      ]);
      if (result === 'timeout' && recorder.state !== 'inactive') {
        throw new Error('MediaRecorderの停止がタイムアウトしました。');
      }
    }

    mediaRecorder = null;
  }

  function stopTracks() {
    for (const track of mediaStream?.getTracks?.() || []) {
      try { track.stop(); } catch {}
    }
    mediaStream = null;
  }

  async function stopCapture(reason = 'user') {
    if (stopInFlight) return stopInFlight;

    stopInFlight = (async () => {
      render();
      try {
        await stopMediaRecorder();
        await chunkQueue;
        const video = getVideoMeta();
        const audio = getAudioMeta();
        stopTracks();

        const result = await api.finishRecording({
          reason,
          video,
          audio
        });
        recordingState = result?.recording || recordingState;
        telemetryState = result?.telemetry || telemetryState;
      } catch (error) {
        try {
          const result = await api.abortRecording(error.message || reason);
          recordingState = result?.recording || recordingState;
          telemetryState = result?.telemetry || telemetryState;
        } catch {}
        detail.textContent = `保存に失敗しました: ${error.message || String(error)}`;
      } finally {
        stopTracks();
        stopInFlight = null;
        await refresh();
      }
    })();

    return stopInFlight;
  }

  async function startCapture() {
    if (mediaRecorder?.state === 'recording') return;

    start.disabled = true;
    status.textContent = '準備中';
    detail.textContent = 'Primary画面とSystem Audioを準備しています…';

    let stream = null;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 60, max: 60 }
        },
        audio: true
      });

      mediaStream = stream;
      const mimeType = chooseMimeType();
      const video = getVideoMeta();
      const audio = getAudioMeta();

      recordingState = await api.prepareRecording({
        mimeType: mimeType || 'video/webm',
        video,
        audio
      });
      telemetryState = await api.getTelemetryStatus();

      const options = {
        videoBitsPerSecond: 12000000,
        audioBitsPerSecond: 160000
      };
      if (mimeType) options.mimeType = mimeType;

      let recorder;
      try {
        recorder = new MediaRecorder(stream, options);
      } catch {
        recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      }

      chunkQueue = Promise.resolve();
      recorder.addEventListener('dataavailable', event => {
        if (!event.data || event.data.size === 0) return;
        chunkQueue = chunkQueue
          .then(() => event.data.arrayBuffer())
          .then(buffer => api.appendRecordingChunk(new Uint8Array(buffer)))
          .then(saved => {
            if (saved === false) throw new Error('録画Chunkを保存できませんでした。');
          })
          .catch(error => {
            detail.textContent = `録画Chunk保存エラー: ${error.message || String(error)}`;
          });
      });

      recorder.addEventListener('error', event => {
        const error = event.error || new Error('MediaRecorder error');
        detail.textContent = `画面録画エラー: ${error.message || String(error)}`;
        stopCapture('media-recorder-error').catch(() => {});
      });

      const videoTrack = stream.getVideoTracks()[0];
      videoTrack?.addEventListener('ended', () => {
        if (mediaRecorder?.state === 'recording') stopCapture('display-track-ended').catch(() => {});
      });

      mediaRecorder = recorder;
      recorder.start(1000);
      render();
    } catch (error) {
      for (const track of stream?.getTracks?.() || []) {
        try { track.stop(); } catch {}
      }
      mediaStream = null;
      mediaRecorder = null;

      try {
        const result = await api.abortRecording(error.message || 'capture-start-failed');
        recordingState = result?.recording || recordingState;
        telemetryState = result?.telemetry || telemetryState;
      } catch {}

      status.textContent = '開始失敗';
      detail.textContent = error.message || String(error);
      await refresh();
    }
  }

  start?.addEventListener('click', () => startCapture());
  stop?.addEventListener('click', () => stopCapture('user'));
  open?.addEventListener('click', async () => {
    const result = await api.openRecordingFolder();
    if (!result?.ok && result?.error) detail.textContent = result.error;
  });

  api.onTelemetryStatus(state => {
    telemetryState = state;
    render();
  });
  api.onRecordingStatus(state => {
    recordingState = state;
    render();
  });

  document.addEventListener('click', event => {
    const link = event.target.closest?.('a[href]');
    if (!link) return;
    if (mediaRecorder?.state !== 'recording' && !recordingState?.active) return;
    event.preventDefault();
    detail.textContent = '録画中はページ移動できません。「録画＋入力 停止」を押してから移動してください。';
  }, true);

  await refresh();
});
