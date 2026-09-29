import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { RecordingController, normalizeMimeType } = require('../electron/recording/controller.cjs');

assert.equal(normalizeMimeType('video/webm;codecs=vp9,opus'), 'video/webm;codecs=vp9,opus');
assert.equal(normalizeMimeType('VIDEO/WEBM'), 'video/webm');
assert.equal(normalizeMimeType('video/mp4'), 'video/webm');
assert.equal(normalizeMimeType(''), 'video/webm');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vreview-recording-'));
const logger = { info() {}, warn() {}, error() {} };

try {
  const controller = new RecordingController({ logger });
  const prepared = controller.prepare({
    sessionDir: tempRoot,
    sessionId: 'session-test',
    mimeType: 'video/webm;codecs=vp8,opus',
    video: { width: 1920, height: 1080, frameRate: 60, requestedFrameRate: 60 },
    audio: { enabled: true, systemLoopback: true }
  });

  assert.equal(prepared.active, true);
  assert.equal(prepared.fileName, 'gameplay.webm');

  assert.equal(controller.appendChunk(new Uint8Array([1, 2, 3])), true);
  assert.equal(controller.appendChunk(new Uint8Array([4, 5])), true);
  assert.equal(controller.appendChunk(new Uint8Array()), false);

  const finished = await controller.finish({
    video: { width: 1920, height: 1080, frameRate: 60, requestedFrameRate: 60 },
    audio: { enabled: true, systemLoopback: true }
  });

  assert.equal(finished.active, false);
  assert.equal(finished.phase, 'completed');
  assert.equal(finished.bytesWritten, 5);
  assert.equal(finished.chunksWritten, 2);

  const videoBytes = fs.readFileSync(path.join(tempRoot, 'gameplay.webm'));
  assert.deepEqual([...videoBytes], [1, 2, 3, 4, 5]);

  const manifest = JSON.parse(fs.readFileSync(path.join(tempRoot, 'recording.json'), 'utf8'));
  assert.equal(manifest.schema, 'vreview-gameplay-recording');
  assert.equal(manifest.outcome, 'completed');
  assert.equal(manifest.bytesWritten, 5);
  assert.equal(manifest.capturePolicy.processMemoryRead, false);
  assert.equal(manifest.capturePolicy.processInjection, false);
  assert.equal(manifest.capturePolicy.inputAutomation, false);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log('Recording controller validation tests passed.');
