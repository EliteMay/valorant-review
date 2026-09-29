import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { compareVersions } = require('../electron/updater.cjs');

assert.equal(compareVersions('0.10.0', '0.9.0'), 1);
assert.equal(compareVersions('0.10.1', '0.10.0'), 1);
assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
assert.equal(compareVersions('0.9.9', '0.10.0'), -1);
assert.equal(compareVersions('1.2.0-beta.1', '1.1.9'), 1);

console.log('Updater version comparison tests passed.');
