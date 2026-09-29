import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { SettingsStore } = require('../electron/foundation/settings-store.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vreview-settings-'));
const logger = { warn() {}, info() {}, error() {} };

try {
  const store = new SettingsStore(root, logger);
  assert.equal(store.get().recording.saveDirectory, '');

  const custom = path.join(root, 'recordings');
  store.update({ recording: { saveDirectory: custom } });
  assert.equal(store.get().recording.saveDirectory, custom);

  const reopened = new SettingsStore(root, logger);
  assert.equal(reopened.get().recording.saveDirectory, custom);

  reopened.reset();
  assert.equal(reopened.get().recording.saveDirectory, '');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('Settings store recording path tests passed.');
