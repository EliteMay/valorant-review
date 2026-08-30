import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const storageSource = fs.readFileSync(new URL('../js/storage.js', import.meta.url), 'utf8');

function makeRuntime() {
  const map = new Map();
  const events = [];
  let failWrites = false;

  const localStorage = {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      if (failWrites) throw new Error('quota exceeded');
      map.set(String(key), String(value));
    },
    removeItem(key) {
      map.delete(key);
    }
  };

  class CustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  }

  const window = {
    VReviewVersion: { storageSchema: 1 },
    dispatchEvent(event) {
      events.push(event);
      return true;
    }
  };

  const context = { window, localStorage, CustomEvent, Date, JSON, String, Number, Object, Array, Error };
  vm.runInNewContext(storageSource, context, { filename: 'js/storage.js' });

  return {
    api: window.VReviewStorage,
    map,
    events,
    setFailWrites(value) { failWrites = Boolean(value); }
  };
}

{
  const runtime = makeRuntime();
  runtime.map.set('vreview:draft-scenes:legacy', JSON.stringify([{ start: 1, end: 2 }]));
  const value = runtime.api.getVersioned('draft-scenes:legacy', []);
  assert.equal(Array.isArray(value), true, 'legacy plain array must remain readable');
  assert.equal(value.length, 1);
  assert.equal(value[0].start, 1);
}

{
  const runtime = makeRuntime();
  assert.equal(runtime.api.setVersioned('draft-scenes:test', [{ start: 3, end: 4 }]), true);
  const raw = JSON.parse(runtime.map.get('vreview:draft-scenes:test'));
  assert.equal(raw.__type, 'vreview-storage');
  assert.equal(raw.schemaVersion, 1);
  assert.equal(raw.revision, 1);
  assert.deepEqual(runtime.api.getVersioned('draft-scenes:test', []), [{ start: 3, end: 4 }]);

  runtime.api.setVersioned('draft-scenes:test', [{ start: 5, end: 6 }]);
  const updated = JSON.parse(runtime.map.get('vreview:draft-scenes:test'));
  assert.equal(updated.revision, 2, 'revision must increase on subsequent saves');
}

{
  const runtime = makeRuntime();
  runtime.api.setVersioned('draft-scenes:source', [{ start: 7, end: 8 }]);
  assert.equal(runtime.api.copy('draft-scenes:source', 'draft-backup:source'), true);
  assert.deepEqual(runtime.api.getVersioned('draft-backup:source', []), [{ start: 7, end: 8 }]);
}

{
  const runtime = makeRuntime();
  runtime.map.set('vreview:draft-scenes:broken', '{broken json');
  const fallback = runtime.api.getVersioned('draft-scenes:broken', ['fallback']);
  assert.deepEqual(fallback, ['fallback']);
  assert.equal(runtime.events.some(event => event.type === 'vreview:storage-error' && event.detail?.type === 'read'), true);
  assert.equal([...runtime.map.keys()].some(key => key.startsWith('vreview:recovery:draft-scenes:broken:')), true, 'corrupt raw data should be preserved when possible');
  assert.equal(runtime.map.get('vreview:draft-scenes:broken'), '{broken json', 'corrupt original must not be overwritten');
}

{
  const runtime = makeRuntime();
  runtime.setFailWrites(true);
  assert.equal(runtime.api.setVersioned('draft-scenes:full', [{ start: 1, end: 2 }]), false);
  assert.equal(runtime.events.some(event => event.type === 'vreview:storage-error' && event.detail?.type === 'write'), true, 'write failure must be observable');
}

console.log('Storage regression tests passed.');
