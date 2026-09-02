window.VReviewFeedbackLibrary = (() => {
  const DB_NAME = 'vreview-feedback-library';
  const DB_VERSION = 1;
  const STORE = 'packages';
  const SCHEMA_VERSION = 1;
  const MAX_ITEMS = 20;
  const MAX_TOTAL_BYTES = 350 * 1024 * 1024;
  let dbPromise = null;

  function isAvailable() {
    return typeof indexedDB !== 'undefined';
  }

  function open() {
    if (!isAvailable()) return Promise.reject(new Error('このブラウザではIndexedDBを利用できません。'));
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('createdAt', 'createdAt');
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      request.onerror = () => {
        dbPromise = null;
        reject(request.error || new Error('Feedback保存領域を開けませんでした。'));
      };
      request.onblocked = () => reject(new Error('別タブが古い保存領域を使用中です。VReviewの他タブを閉じて再試行してください。'));
    });

    return dbPromise;
  }

  async function save(id, prepared) {
    if (!id) throw new Error('保存対象のクリップIDを作成できませんでした。');
    if (!prepared?.manifest || !Array.isArray(prepared.files)) throw new Error('保存するFeedbackデータが不正です。');

    const normalizedFiles = [];
    let byteSize = 0;
    for (const file of prepared.files) {
      const name = normalizePath(file?.name);
      if (!name) throw new Error('Feedback内に不正なファイル名があります。');
      const blob = toBlob(file?.data);
      byteSize += blob.size;
      normalizedFiles.push({ name, blob, size: blob.size });
    }

    const summaries = await list();
    const existing = summaries.find(item => item.id === id) || null;
    const projectedCount = summaries.length + (existing ? 0 : 1);
    const projectedBytes = summaries.reduce((sum, item) => sum + Number(item.byteSize || 0), 0)
      - Number(existing?.byteSize || 0) + byteSize;

    if (projectedCount > MAX_ITEMS) {
      throw new Error(`保存できるFeedbackは最大${MAX_ITEMS}件です。不要な保存データを削除してください。`);
    }
    if (projectedBytes > MAX_TOTAL_BYTES) {
      throw new Error('保存済みFeedbackが350MBを超えるため追加できません。まとめてZIPを作成して不要分を削除してください。');
    }

    await ensureQuota(byteSize - Number(existing?.byteSize || 0));

    const record = {
      id,
      schemaVersion: SCHEMA_VERSION,
      packageVersion: Number(prepared.manifest.version || window.VReviewVersion?.feedback || 5),
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      displayName: String(prepared.manifest?.video?.name || prepared.baseName || 'clip').slice(0, 180),
      baseName: String(prepared.baseName || 'clip').slice(0, 80),
      byteSize,
      warning: prepared.warning || null,
      manifest: prepared.manifest,
      files: normalizedFiles
    };

    const db = await open();
    await transactionPromise(db, 'readwrite', store => store.put(record));
    return summarize(record);
  }

  async function list() {
    const db = await open();
    const records = await requestPromise(db.transaction(STORE, 'readonly').objectStore(STORE).getAll());
    return (Array.isArray(records) ? records : [])
      .map(summarize)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  async function getAll() {
    const db = await open();
    const records = await requestPromise(db.transaction(STORE, 'readonly').objectStore(STORE).getAll());
    return (Array.isArray(records) ? records : [])
      .filter(record => record?.schemaVersion === SCHEMA_VERSION && Array.isArray(record.files))
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  }

  async function has(id) {
    if (!id) return false;
    const db = await open();
    const result = await requestPromise(db.transaction(STORE, 'readonly').objectStore(STORE).getKey(id));
    return result != null;
  }

  async function remove(id) {
    if (!id) return false;
    const db = await open();
    await transactionPromise(db, 'readwrite', store => store.delete(id));
    return true;
  }

  async function clear() {
    const db = await open();
    await transactionPromise(db, 'readwrite', store => store.clear());
    return true;
  }

  async function estimate() {
    const summaries = await list();
    return {
      count: summaries.length,
      bytes: summaries.reduce((sum, item) => sum + Number(item.byteSize || 0), 0),
      maxItems: MAX_ITEMS,
      maxBytes: MAX_TOTAL_BYTES
    };
  }

  async function ensureQuota(deltaBytes) {
    if (deltaBytes <= 0 || !navigator.storage?.estimate) return;
    try {
      const estimate = await navigator.storage.estimate();
      const quota = Number(estimate.quota || 0);
      const usage = Number(estimate.usage || 0);
      if (quota > 0 && usage + deltaBytes > quota * 0.92) {
        throw new Error('ブラウザの保存容量が不足しています。保存済みFeedbackをZIP化して削除するか、空き容量を確保してください。');
      }
    } catch (error) {
      if (/保存容量が不足/.test(String(error?.message || ''))) throw error;
    }
  }

  function summarize(record) {
    return {
      id: record.id,
      schemaVersion: record.schemaVersion,
      packageVersion: record.packageVersion,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      displayName: record.displayName || 'clip',
      baseName: record.baseName || 'clip',
      byteSize: Number(record.byteSize || 0),
      warning: record.warning || null,
      sceneCount: Number(record.manifest?.counts?.corrected_scenes || 0),
      primaryCount: Number(record.manifest?.counts?.review_tiers?.primary || 0),
      weakCount: Number(record.manifest?.counts?.review_tiers?.weak || 0)
    };
  }

  function transactionPromise(db, mode, action) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      try {
        action(store);
      } catch (error) {
        tx.abort();
        reject(error);
        return;
      }
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error || new Error('Feedback保存処理に失敗しました。'));
      tx.onabort = () => reject(tx.error || new Error('Feedback保存処理が中断されました。'));
    });
  }

  function requestPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Feedback保存領域の読み込みに失敗しました。'));
    });
  }

  function toBlob(data) {
    if (data instanceof Blob) return data;
    if (data instanceof Uint8Array) return new Blob([data]);
    if (data instanceof ArrayBuffer) return new Blob([data]);
    if (ArrayBuffer.isView(data)) return new Blob([data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)]);
    throw new Error('Feedback内に保存できないデータがあります。');
  }

  function normalizePath(value) {
    const path = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!path || path.includes('../') || path.startsWith('..')) return '';
    return path;
  }

  return {
    isAvailable,
    save,
    list,
    getAll,
    has,
    remove,
    clear,
    estimate,
    limits: Object.freeze({ maxItems: MAX_ITEMS, maxBytes: MAX_TOTAL_BYTES })
  };
})();
