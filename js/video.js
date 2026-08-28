window.VReviewVideo = {
  loadFile(videoElement, file) {
    return new Promise((resolve, reject) => {
      if (!file) return reject(new Error('動画ファイルがありません。'));
      const url = URL.createObjectURL(file);
      const cleanup = () => URL.revokeObjectURL(url);
      videoElement.src = url;
      videoElement.onloadedmetadata = () => {
        resolve({
          file,
          url,
          duration: Number(videoElement.duration || 0),
          width: videoElement.videoWidth,
          height: videoElement.videoHeight
        });
      };
      videoElement.onerror = () => {
        cleanup();
        reject(new Error('動画を読み込めませんでした。'));
      };
    });
  },
  formatTime(seconds) {
    if (!Number.isFinite(seconds)) return '0.000';
    const m = Math.floor(seconds / 60);
    const s = seconds - m * 60;
    return `${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
  }
};
