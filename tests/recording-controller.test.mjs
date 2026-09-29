import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { normalizeMimeType } = require('../electron/recording/controller.cjs');

assert.equal(normalizeMimeType('video/webm;codecs=vp9,opus'), 'video/webm;codecs=vp9,opus');
assert.equal(normalizeMimeType('VIDEO/WEBM'), 'video/webm');
assert.equal(normalizeMimeType('video/mp4'), 'video/webm');
assert.equal(normalizeMimeType(''), 'video/webm');

console.log('Recording controller validation tests passed.');
