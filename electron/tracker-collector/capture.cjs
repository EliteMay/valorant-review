const { desktopCapturer } = require('electron');
const { sampleDifference } = require('./core.cjs');

class TrackerWindowCapture {
  constructor({ logger }) {
    this.logger = logger;
  }

  async listSources(thumbnailWidth = 480) {
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: thumbnailWidth, height: Math.round(thumbnailWidth * 0.7) },
      fetchWindowIcons: true
    });
    return sources.map(source => ({
      id: source.id,
      name: source.name,
      displayId: source.display_id || '',
      thumbnailDataUrl: source.thumbnail?.isEmpty?.() ? null : source.thumbnail.toDataURL()
    }));
  }

  async grab(sourceId, bounds) {
    const width = Math.max(320, Math.min(7680, Math.round(Number(bounds?.width) || 1280)));
    const height = Math.max(200, Math.min(4320, Math.round(Number(bounds?.height) || 720)));
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width, height },
      fetchWindowIcons: false
    });
    const source = sources.find(item => item.id === sourceId);
    if (!source || !source.thumbnail || source.thumbnail.isEmpty()) {
      throw new Error('Target window capture source is unavailable.');
    }
    const image = source.thumbnail;
    const size = image.getSize();
    return {
      image,
      bitmap: image.toBitmap(),
      width: size.width,
      height: size.height
    };
  }

  async waitStable(sourceId, bounds, options = {}) {
    const stableForMs = Math.max(250, Number(options.stableWaitMs) || 400);
    const maxWaitMs = Math.max(stableForMs, Number(options.stableMaxWaitMs) || 3000);
    const intervalMs = 160;
    const threshold = Number.isFinite(Number(options.threshold)) ? Number(options.threshold) : 0.006;
    const started = Date.now();
    let last = await this.grab(sourceId, bounds);
    let stableSince = Date.now();

    while (Date.now() - started < maxWaitMs) {
      await delay(intervalMs);
      const current = await this.grab(sourceId, bounds);
      const diff = sampleDifference(last.bitmap, current.bitmap);
      if (diff <= threshold) {
        if (Date.now() - stableSince >= stableForMs) {
          return { ...current, stable: true, waitedMs: Date.now() - started, difference: diff };
        }
      } else {
        stableSince = Date.now();
      }
      last = current;
    }

    return { ...last, stable: false, waitedMs: Date.now() - started, difference: null };
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { TrackerWindowCapture };
