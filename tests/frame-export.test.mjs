import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

let revoked = 0;
const requested = [];
class Video {
  constructor() {
    this.readyState = 2; this.videoWidth = 320; this.videoHeight = 180;
    this.time = 0; this.listeners = new Map();
  }
  set currentTime(time) {
    this.time = time; requested.push(time);
    queueMicrotask(() => this.listeners.get('seeked')?.());
  }
  get currentTime() { return this.time; }
  addEventListener(name, fn) { this.listeners.set(name, fn); }
  removeEventListener(name, fn) { if (this.listeners.get(name) === fn) this.listeners.delete(name); }
  removeAttribute() {}
  load() {}
}
const filesInZip = [];
const window = { VReviewFeedbackPackage: {
  createArchive(files) { filesInZip.push(...files); return new Blob([new Uint8Array([1])]); }
} };
const context = {
  window,
  URL: { createObjectURL: () => 'blob:fake', revokeObjectURL: () => revoked++ },
  document: { createElement(tag) {
    if (tag === 'video') return new Video();
    return { width: 0, height: 0, getContext: () => ({ drawImage() {} }),
      toBlob: cb => cb(new Blob([new Uint8Array([1, 2, 3])])) };
  }},
  TextEncoder, Uint8Array, Blob, DOMException, Date,
  setTimeout, clearTimeout, queueMicrotask
};
vm.runInNewContext(fs.readFileSync('js/frame-export.js', 'utf8'), context);
const { planFrames, exportFrames } = window.VReviewFrameExport;

assert.equal(planFrames(26.5, 26.8, 10, 32.2).length, 3);
assert.equal(planFrames(0, 3, 60, 32.2).length, 180);
assert.equal(planFrames(1, 2, 30, 32.2).length, 30);
for (const args of [[0, 4, 60, 32.2], [-1, 3, 10, 32.2],
  [2, 1, 10, 32.2], [0, 2, 15, 32.2], [0, 34, 10, 32.2]]) {
  assert.throws(() => planFrames(...args));
}
const result = await exportFrames({
  file: { name: 'test.mp4' }, videoData: { duration: 30 },
  start: 1, end: 1.3, fps: 10
});
assert.equal(result.manifest.frames.length, 3);
assert.equal(filesInZip.length, 5);
assert.equal(result.manifest.frames[1].requested_seconds, 1.1);
assert.equal(requested.length, 3);
assert.ok(Math.abs(requested[0] - 1.05) < 1e-6, 'seek to center of source frame');
assert.ok(Math.abs(requested[1] - 1.15) < 1e-6);
assert.equal(revoked, 1);
assert.ok(filesInZip.find(file => file.name === 'manifest.json'));
assert.ok(!filesInZip.some(file => file.name.endsWith('.mp4')));
const controller = new AbortController();
controller.abort();
await assert.rejects(exportFrames({
  file: { name: 'test.mp4' }, videoData: { duration: 30 },
  start: 1, end: 1.3, fps: 10, signal: controller.signal
}), error => error.name === 'AbortError');
assert.equal(revoked, 2);
console.log('Frame export planner, cleanup, cancellation: passed');
