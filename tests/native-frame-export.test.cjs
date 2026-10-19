const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { planNativeFrames, exportNativeFrames } = require('../electron/frame-export/controller.cjs');

assert.deepEqual(planNativeFrames({ start: 1, end: 1.5, fps: 60 }), { start: 1, end: 1.5, fps: 60 });
for (const params of [
  { start: -1, end: 1, fps: 60 }, { start: 1, end: 1, fps: 60 },
  { start: 1, end: 5, fps: 60 }, { start: 1, end: 2, fps: 12 }
]) assert.throws(() => planNativeFrames(params));

async function main() {
  if (process.argv[2]) {
    const sourcePath = path.resolve(process.argv[2]);
    const destination = path.resolve(process.argv[3] || 'native-frame-test.zip');
    const outcome = await exportNativeFrames(
      { sourcePath, start: 1, end: 1.5, fps: 60 }, { outputPath: destination }
    );
    assert.equal(outcome.frameCount, 30);
    assert.ok(fs.statSync(destination).size > 1024);
    console.log('Native frame extraction smoke passed:', outcome.frameCount, 'frames');
  } else {
    console.log('Native frame validation passed. Run with a 60fps MP4 for media smoke.');
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
