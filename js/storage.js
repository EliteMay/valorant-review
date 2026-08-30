window.VReviewStorage = (() => {
  const PREFIX = 'vreview:';
  const ENVELOPE = 'vreview-storage';
  let lastError = null;

  function fullKey(key) {
    return `${PREFIX}${key}`;
  }

  function notify(type, key, error) {
    lastError = {
      type,
      key,
      message: error?.message || String(error || type),
      at: new Date().toISOString()
    };
    try {
      window.dispatchEvent(new CustomEvent('vreview:storage-error', { detail: lastError }));
    } catch {
      // Storage failure reporting must never break the main workflow.
    }
  }

  function preserveCorruptRaw(key, raw) {
    if (raw == null) return;
    try {
      const safeKey = String(key).replace(/[^a-zA-Z0-9:_-]+/g, '_').slice(0, 120);
      localStorage.setItem(`${PREFIX}recovery:${safeKey}:${Date.now()}`, raw);
    } catch {
      // If quota/storage itself is unavailable, keeping the original key untouched is the fallback.
    }
  }

  function parseRaw(key, fallback) {
    let raw = null;
    try {
      raw = localStorage.getItem(fullKey(key));
      if (raw == null) return fallback;
      return JSON.parse(raw);
    } catch (error) {
      preserveCorruptRaw(key, raw);
      notify('read', key, error);
      return fallback;
    }
  }

  function get(key, fallback = null) {
    return parseRaw(key, fallback);
  }

  function set(key, value) {
    try {
      localStorage.setItem(fullKey(key), JSON.stringify(value));
      return true;
    } catch (error) {
      notify('write', key, error);
      return false;
    }
  }

  function getVersioned(key, fallback = null, options = {}) {
    const expectedSchema = Number(options.schemaVersion ?? window.VReviewVersion?.storageSchema ?? 1);
    const parsed = parseRaw(key, fallback);
    if (parsed === fallback) return fallback;

    // Backward compatibility: v0.5.0 and older stored plain arrays/objects.
    if (!parsed || parsed.__type !== ENVELOPE) return parsed;

    const storedSchema = Number(parsed.schemaVersion || 0);
    if (!Number.isInteger(storedSchema) || storedSchema < 1) {
      notify('schema', key, new Error('保存データのSchema Versionが不正です。'));
      return fallback;
    }
    if (storedSchema > expectedSchema) {
      notify('schema', key, new Error(`保存データSchema v${storedSchema}は、このVReviewでは新しすぎます。`));
      return fallback;
    }

    let data = parsed.data;
    if (storedSchema < expectedSchema && typeof options.migrate === 'function') {
      try {
        data = options.migrate(data, storedSchema, expectedSchema);
      } catch (error) {
        notify('migration', key, error);
        return fallback;
      }
    }
    return data;
  }

  function setVersioned(key, data, options = {}) {
    const schemaVersion = Number(options.schemaVersion ?? window.VReviewVersion?.storageSchema ?? 1);
    let revision = 1;
    const existing = parseRaw(key, null);
    if (existing?.__type === ENVELOPE && Number.isInteger(Number(existing.revision))) {
      revision = Number(existing.revision) + 1;
    }
    return set(key, {
      __type: ENVELOPE,
      schemaVersion,
      revision,
      updatedAt: new Date().toISOString(),
      data
    });
  }

  function copy(sourceKey, targetKey) {
    try {
      const raw = localStorage.getItem(fullKey(sourceKey));
      if (raw == null) return false;
      localStorage.setItem(fullKey(targetKey), raw);
      return true;
    } catch (error) {
      notify('backup', sourceKey, error);
      return false;
    }
  }

  function remove(key) {
    try {
      localStorage.removeItem(fullKey(key));
      return true;
    } catch (error) {
      notify('remove', key, error);
      return false;
    }
  }

  function exists(key) {
    try {
      return localStorage.getItem(fullKey(key)) != null;
    } catch (error) {
      notify('read', key, error);
      return false;
    }
  }

  return {
    get,
    set,
    getVersioned,
    setVersioned,
    copy,
    remove,
    exists,
    getLastError: () => lastError,
    keyFor: fullKey
  };
})();
