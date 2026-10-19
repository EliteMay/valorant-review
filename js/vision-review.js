window.VReviewVisionReview = (() => {
  function init({ preview, getVideo }) {
    const ids = ['visionStart', 'visionEnd', 'visionFps', 'visionRunBtn', 'visionCancelBtn',
      'visionStatus', 'visionResults', 'visionOpenFolder'];
    const [start, end, fps, run, cancel, status, results, openFolder] =
      ids.map(id => document.getElementById(id));
    if (ids.some(id => !document.getElementById(id))) return null;
    const desktop = window.vreviewDesktop;
    if (!desktop?.scanVision) {
      status.textContent = 'この解析はWindowsアプリ専用です。';
      return { isBusy: () => false, reset() {} };
    }
    let busy = false;
    function validate() {
      const video = getVideo();
      const a = Number(start.value), b = Number(end.value);
      const valid = video?.file && Number.isFinite(a) && Number.isFinite(b) &&
        a >= 0 && b > a && b <= video.videoData?.duration + 0.005 &&
        b - a <= 30 && Number(fps.value) > 0;
      run.disabled = !valid || busy;
    }
    for (const el of [start, end, fps]) el.addEventListener('input', validate);
    openFolder.addEventListener('click', () => desktop.openVisionFolder().catch(() => {
      status.textContent = '保存先フォルダを開けませんでした。';
    }));
    cancel.addEventListener('click', async () => {
      if (busy) await desktop.cancelVision();
    });
    run.addEventListener('click', async () => {
      if (busy || run.disabled) return;
      busy = true;
      validate();
      cancel.disabled = false;
      results.replaceChildren();
      status.textContent = 'OpenCVで解析中…';
      try {
        const value = getVideo();
        const summary = await desktop.scanVision(value.file, {
          start: Number(start.value), end: Number(end.value), fps: Number(fps.value)
        });
        const events = Object.entries(summary.events || {}).flatMap(([region, items]) =>
          items.map(item => ({ ...item, region }))).sort((a, b) => a.time_seconds - b.time_seconds);
        const count = document.createElement('p');
        count.className = 'helper';
        count.textContent = events.length + '件の画面変化候補。キル数やHP値ではありません。';
        results.appendChild(count);
        for (const event of events) {
          const button = document.createElement('button');
          button.className = 'btn btn-ghost btn-small';
          button.type = 'button';
          button.textContent = Number(event.time_seconds).toFixed(2) + '秒 / ' +
            (event.region === 'killfeed_area' ? 'キルログ周辺' : 'HP周辺') +
            ' / 変化率' + Math.round(event.change_fraction * 100) + '%';
          button.addEventListener('click', () => { preview.currentTime = event.time_seconds; });
          results.appendChild(button);
        }
        status.textContent = '解析完了。根拠画像・JSONはPC内に保存済みです。';
        openFolder.disabled = false;
      } catch (error) {
        status.textContent = error?.message || '画像解析を実行できませんでした。';
      } finally {
        busy = false;
        cancel.disabled = true;
        validate();
      }
    });
    return {
      isBusy: () => busy,
      reset(duration) {
        start.value = '0';
        end.value = String(Math.min(3, Math.max(0, Number(duration) || 0)));
        status.textContent = 'HP・キルログ周辺の変化候補を検出します。';
        results.replaceChildren();
        openFolder.disabled = true;
        validate();
      }
    };
  }
  return { init };
})();