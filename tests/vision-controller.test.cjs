'use strict';
const assert = require('node:assert/strict');
const { validateSettings, resolvePython } = require('../electron/vision/controller.cjs');
assert.deepEqual(validateSettings({ start: 1, end: 2, fps: 10 }), { start: 1, end: 2, fps: 10 });
for(const options of [
  { start:-1,end:1,fps:10 }, { start:2,end:1,fps:10 },
  { start:0,end:31,fps:10 }, { start:0,end:2,fps:31 },
  { start:0,end:2,fps:0 }, { start:0,end:2,fps:'wat' }
]) assert.throws(() => validateSettings(options));
assert.equal(typeof resolvePython('C:\\tmp',{}).command,'string');
console.log('Vision settings validation: passed');
