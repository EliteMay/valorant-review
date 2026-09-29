const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

class RecordingController extends EventEmitter {
  constructor({ logger }) {
    super();
    this.logger = logger;
    this.stream = null;
    this.sessionDir = null;
    this.lastSessionDir = null;
    this.filePath = null;
    this.state = this.#emptyState();
  }

  getStatus() {
    return { ...this.state };
  }

  prepare({ sessionDir, sessionId, mimeType, video, audio }) {
    if (this.stream) throw new Error('Gameplay録画はすでに開始されています。');
    if (!sessionDir || !sessionId) throw new Error('Telemetry Sessionが準備されていません。');

    const normalizedMime = normalizeMimeType(mimeType);
    const extension = normalizedMime.includes('webm') ? 'webm' : 'webm';
    const fileName = `gameplay.${extension}`;
    const filePath = path.join(sessionDir, fileName);
    const stream = fs.createWriteStream(filePath, { flags: 'wx' });

    this.stream = stream;
    this.sessionDir = sessionDir;
    this.lastSessionDir = sessionDir;
    this.filePath = filePath;
    this.state = {
      active: true,
      phase: 'recording',
      sessionId,
      startedAt: new Date().toISOString(),
      endedAt: null,
      durationMs: null,
      fileName,
      mimeType: normalizedMime,
      bytesWritten: 0,
      chunksWritten: 0,
      video: normalizeVideoMeta(video),
      audio: normalizeAudioMeta(audio),
      lastError: null
    };

    stream.on('error', error => {
      this.state.lastError = String(error?.message || error).slice(0, 180);
      this.state.phase = 'failed';
      this.logger?.error('recording.stream.error', { message: this.state.lastError });
      this.emit('status', this.getStatus());
    });

    this.#writeManifest('recording');
    this.emit('status', this.getStatus());
    return this.getStatus();
  }

  appendChunk(value) {
    if (!this.stream || !this.state.active) return false;
    const chunk = toBuffer(value);
    if (!chunk || chunk.length === 0) return false;
    if (chunk.length > 32 * 1024 * 1024) {
      this.logger?.warn('recording.chunk.rejected', { bytes: chunk.length });
      return false;
    }

    this.stream.write(chunk);
    this.state.bytesWritten += chunk.length;
    this.state.chunksWritten += 1;

    if (this.state.chunksWritten % 5 === 0) {
      this.emit('status', this.getStatus());
    }
    return true;
  }

  async finish(meta = {}) {
    if (!this.stream) return this.getStatus();
    this.state.phase = 'finalizing';
    this.state.video = { ...this.state.video, ...normalizeVideoMeta(meta.video) };
    this.state.audio = { ...this.state.audio, ...normalizeAudioMeta(meta.audio) };
    this.emit('status', this.getStatus());

    await this.#closeStream();
    this.state.active = false;
    this.state.phase = this.state.lastError ? 'failed' : 'completed';
    this.state.endedAt = new Date().toISOString();
    this.state.durationMs = durationBetween(this.state.startedAt, this.state.endedAt);
    this.#writeManifest(this.state.phase);
    this.logger?.info('recording.finish', {
      sessionId: this.state.sessionId || '',
      bytesWritten: this.state.bytesWritten,
      chunksWritten: this.state.chunksWritten
    });
    this.sessionDir = null;
    this.emit('status', this.getStatus());
    return this.getStatus();
  }

  async abort(reason = 'interrupted') {
    if (!this.stream) return this.getStatus();

    this.state.phase = 'interrupted';
    this.state.lastError = String(reason || 'interrupted').slice(0, 180);
    await this.#closeStream();

    this.state.active = false;
    this.state.endedAt = new Date().toISOString();
    this.state.durationMs = durationBetween(this.state.startedAt, this.state.endedAt);
    this.#writeManifest('interrupted');
    this.logger?.warn('recording.abort', {
      sessionId: this.state.sessionId || '',
      reason: this.state.lastError
    });
    this.sessionDir = null;
    this.emit('status', this.getStatus());
    return this.getStatus();
  }

  getSessionDirectory() {
    return this.sessionDir || this.lastSessionDir || null;
  }

  async #closeStream() {
    const stream = this.stream;
    this.stream = null;
    if (!stream) return;

    await new Promise(resolve => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      stream.once('finish', finish);
      stream.once('close', finish);
      stream.once('error', finish);
      stream.end();
      setTimeout(finish, 2000).unref?.();
    });
  }

  #writeManifest(outcome) {
    const dir = this.sessionDir || this.lastSessionDir;
    if (!dir) return;

    const manifest = {
      schema: 'vreview-gameplay-recording',
      schemaVersion: 1,
      sessionId: this.state.sessionId,
      startedAt: this.state.startedAt,
      endedAt: this.state.endedAt,
      durationMs: this.state.durationMs,
      outcome,
      file: this.state.fileName,
      mimeType: this.state.mimeType,
      bytesWritten: this.state.bytesWritten,
      chunksWritten: this.state.chunksWritten,
      video: this.state.video,
      audio: this.state.audio,
      capturePolicy: {
        source: 'electron-desktop-capture',
        processMemoryRead: false,
        processInjection: false,
        inputAutomation: false,
        overlay: false
      }
    };

    const file = path.join(dir, 'recording.json');
    const temp = `${file}.tmp`;
    try {
      fs.writeFileSync(temp, JSON.stringify(manifest, null, 2), 'utf8');
      fs.renameSync(temp, file);
    } catch (error) {
      this.logger?.warn('recording.manifest.failed', { message: error.message });
    }
  }

  #emptyState() {
    return {
      active: false,
      phase: 'inactive',
      sessionId: null,
      startedAt: null,
      endedAt: null,
      durationMs: null,
      fileName: null,
      mimeType: null,
      bytesWritten: 0,
      chunksWritten: 0,
      video: {},
      audio: {},
      lastError: null
    };
  }
}

function durationBetween(startedAt, endedAt) {
  const start = Date.parse(startedAt || '');
  const end = Date.parse(endedAt || '');
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, end - start);
}

function normalizeMimeType(value) {
  const text = String(value || '').toLowerCase().slice(0, 120);
  return text.startsWith('video/webm') ? text : 'video/webm';
}

function normalizeVideoMeta(value = {}) {
  return {
    width: clampInt(value?.width, 0, 7680),
    height: clampInt(value?.height, 0, 4320),
    frameRate: clampNumber(value?.frameRate, 0, 240),
    requestedFrameRate: clampNumber(value?.requestedFrameRate, 0, 240)
  };
}

function normalizeAudioMeta(value = {}) {
  return {
    enabled: Boolean(value?.enabled),
    systemLoopback: Boolean(value?.systemLoopback)
  };
}

function clampInt(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(max, Math.max(min, number));
}

function toBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

module.exports = { RecordingController, normalizeMimeType };
