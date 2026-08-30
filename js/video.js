window.VReviewVideo = (() => {
  const activeUrls = new WeakMap();

  function release(videoElement) {
    if (!videoElement) return;
    const currentUrl = activeUrls.get(videoElement);
    if (currentUrl) {
      URL.revokeObjectURL(currentUrl);
      activeUrls.delete(videoElement);
    }
    videoElement.removeAttribute('src');
    videoElement.load();
  }

  function loadFile(videoElement, file) {
    return new Promise((resolve, reject) => {
      if (!videoElement) return reject(new Error('動画プレイヤーがありません。'));
      if (!file) return reject(new Error('動画ファイルがありません。'));

      const previousUrl = activeUrls.get(videoElement);
      if (previousUrl) {
        URL.revokeObjectURL(previousUrl);
        activeUrls.delete(videoElement);
      }

      const url = URL.createObjectURL(file);
      activeUrls.set(videoElement, url);

      const cleanupListeners = () => {
        videoElement.onloadedmetadata = null;
        videoElement.onerror = null;
      };

      videoElement.onloadedmetadata = () => {
        cleanupListeners();
        resolve({
          file,
          url,
          duration: Number(videoElement.duration || 0),
          width: videoElement.videoWidth,
          height: videoElement.videoHeight
        });
      };

      videoElement.onerror = () => {
        cleanupListeners();
        const currentUrl = activeUrls.get(videoElement);
        if (currentUrl === url) {
          URL.revokeObjectURL(url);
          activeUrls.delete(videoElement);
        }
        reject(new Error('動画を読み込めませんでした。'));
      };

      videoElement.src = url;
    });
  }

  function formatTime(seconds) {
    if (!Number.isFinite(seconds)) return '00:00.000';
    const m = Math.floor(seconds / 60);
    const s = seconds - m * 60;
    return `${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
  }

  function makeFingerprint(file, videoData) {
    const raw = [
      file?.name || '',
      file?.size || 0,
      file?.lastModified || 0,
      Number(videoData?.duration || 0).toFixed(3),
      `${videoData?.width || 0}x${videoData?.height || 0}`
    ].join('|');

    let hash = 2166136261;
    for (let i = 0; i < raw.length; i++) {
      hash ^= raw.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return `clip-${(hash >>> 0).toString(16)}`;
  }

  return { loadFile, release, formatTime, makeFingerprint };
})();
