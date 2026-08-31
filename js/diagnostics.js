window.VReviewDiagnostics = (() => {
  const SESSION_KEY = 'vreview:diagnostics:v1';
  const MAX_BREADCRUMBS = 120;
  const MAX_ERRORS = 40;
  const MAX_NETWORK = 30;
  const MAX_TEXT = 180;
  const session = loadSession();

  function loadSession() {
    const fallback = createSession();
    try {
      const parsed = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
      if (!parsed || parsed.schemaVersion !== 1) return fallback;
      return {
        ...fallback,
        ...parsed,
        breadcrumbs: Array.isArray(parsed.breadcrumbs) ? parsed.breadcrumbs.slice(-MAX_BREADCRUMBS) : [],
        errors: Array.isArray(parsed.errors) ? parsed.errors.slice(-MAX_ERRORS) : [],
        networkFailures: Array.isArray(parsed.networkFailures) ? parsed.networkFailures.slice(-MAX_NETWORK) : []
      };
    } catch {
      return fallback;
    }
  }

  function createSession() {
    return {
      schemaVersion: 1,
      sessionId: createId(),
      startedAt: new Date().toISOString(),
      breadcrumbs: [],
      errors: [],
      networkFailures: []
    };
  }

  function persist() {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch {
      // Diagnostics must never break the application when browser storage is unavailable.
    }
  }

  function breadcrumb(action, details = {}) {
    session.breadcrumbs.push({
      at: new Date().toISOString(),
      action: cleanText(action, 72),
      details: sanitizeDetails(details)
    });
    if (session.breadcrumbs.length > MAX_BREADCRUMBS) {
      session.breadcrumbs.splice(0, session.breadcrumbs.length - MAX_BREADCRUMBS);
    }
    persist();
    renderPage();
  }

  function captureError(error, code = 'RUNTIME-UNEXPECTED-001', context = {}) {
    const normalized = normalizeError(error);
    const entry = {
      at: new Date().toISOString(),
      code: cleanText(code, 64),
      name: cleanText(normalized.name || 'Error', 64),
      message: cleanText(normalized.message || 'Unknown error', MAX_TEXT),
      route: currentRoute(),
      context: sanitizeDetails(context)
    };
    session.errors.push(entry);
    if (session.errors.length > MAX_ERRORS) session.errors.splice(0, session.errors.length - MAX_ERRORS);
    persist();
    renderPage();
    return entry.code;
  }

  function networkFailure(summary = {}) {
    session.networkFailures.push({
      at: new Date().toISOString(),
      method: cleanText(summary.method || 'GET', 12),
      resource: sanitizeResource(summary.resource),
      status: Number.isFinite(Number(summary.status)) ? Number(summary.status) : null,
      reason: cleanText(summary.reason || '', MAX_TEXT)
    });
    if (session.networkFailures.length > MAX_NETWORK) {
      session.networkFailures.splice(0, session.networkFailures.length - MAX_NETWORK);
    }
    persist();
    renderPage();
  }

  async function snapshot(reason = 'manual') {
    const version = window.VReviewVersion || {};
    const storage = await storageSummary();
    return {
      schemaVersion: 1,
      project: {
        name: 'VReview',
        appVersion: String(version.app || ''),
        build: String(version.build || ''),
        dataSchemaVersion: Number.isInteger(version.storageSchema) ? version.storageSchema : null,
        detectorVersion: String(version.detector || ''),
        feedbackVersion: String(version.feedback || ''),
        guideVersion: String(version.guide || '')
      },
      capture: {
        capturedAt: new Date().toISOString(),
        sessionId: session.sessionId,
        sessionStartedAt: session.startedAt,
        route: currentRoute(),
        reason
      },
      environment: {
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          devicePixelRatio: Number(window.devicePixelRatio || 1)
        },
        language: navigator.language || '',
        online: navigator.onLine,
        platformSummary: platformSummary(),
        features: featureSupport()
      },
      runtime: {
        initialization: [],
        featureFlags: {},
        serviceWorker: 'serviceWorker' in navigator ? Boolean(navigator.serviceWorker?.controller) : null
      },
      breadcrumbs: session.breadcrumbs.slice(-MAX_BREADCRUMBS),
      errors: session.errors.slice(-MAX_ERRORS),
      networkFailures: session.networkFailures.slice(-MAX_NETWORK),
      storage,
      performance: {
        summary: navigationPerformance()
      },
      notes: [
        'No video/media body is included.',
        'No localStorage/sessionStorage values are included.',
        'User-entered notes and file names are not included.'
      ]
    };
  }

  async function exportJson() {
    const data = await snapshot('manual-export');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vreview_diagnostics_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    breadcrumb('diagnostics.export', { errors: session.errors.length, breadcrumbs: session.breadcrumbs.length });
  }

  async function copyReport() {
    const data = await snapshot('manual-copy');
    const text = JSON.stringify(data, null, 2);
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard API is not available.');
    await navigator.clipboard.writeText(text);
    breadcrumb('diagnostics.copy', { errors: session.errors.length, breadcrumbs: session.breadcrumbs.length });
  }

  function clear() {
    const fresh = createSession();
    session.sessionId = fresh.sessionId;
    session.startedAt = fresh.startedAt;
    session.breadcrumbs = [];
    session.errors = [];
    session.networkFailures = [];
    persist();
    breadcrumb('diagnostics.cleared');
  }

  async function storageSummary() {
    let available = true;
    let keyCount = 0;
    let approximateBytes = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i) || '';
        if (!key.startsWith('vreview:')) continue;
        keyCount++;
        approximateBytes += key.length * 2;
        const value = localStorage.getItem(key) || '';
        approximateBytes += value.length * 2;
      }
    } catch {
      available = false;
    }

    let estimate = null;
    try {
      estimate = await navigator.storage?.estimate?.();
    } catch {
      estimate = null;
    }

    return {
      available,
      types: ['sessionStorage', 'localStorage'],
      estimatedUsageBytes: Number.isFinite(Number(estimate?.usage)) ? Number(estimate.usage) : null,
      estimatedQuotaBytes: Number.isFinite(Number(estimate?.quota)) ? Number(estimate.quota) : null,
      summary: {
        vreviewLocalStorageKeyCount: keyCount,
        vreviewLocalStorageApproxBytes: approximateBytes,
        diagnosticsBreadcrumbLimit: MAX_BREADCRUMBS,
        diagnosticsErrorLimit: MAX_ERRORS
      }
    };
  }

  function featureSupport() {
    return {
      webAudio: Boolean(window.AudioContext || window.webkitAudioContext),
      canvas: Boolean(document.createElement('canvas').getContext),
      objectUrl: Boolean(URL?.createObjectURL && URL?.revokeObjectURL),
      abortController: 'AbortController' in window,
      cryptoRandomUUID: Boolean(window.crypto?.randomUUID),
      storageEstimate: Boolean(navigator.storage?.estimate),
      clipboardWrite: Boolean(navigator.clipboard?.writeText)
    };
  }

  function navigationPerformance() {
    try {
      const nav = performance.getEntriesByType?.('navigation')?.[0];
      if (!nav) return {};
      return {
        domContentLoadedMs: round(nav.domContentLoadedEventEnd),
        loadEventMs: round(nav.loadEventEnd),
        transferSize: Number(nav.transferSize || 0)
      };
    } catch {
      return {};
    }
  }

  function currentRoute() {
    const pathname = location.pathname || '/';
    return pathname.endsWith('/') ? `${pathname}index.html` : pathname;
  }

  function platformSummary() {
    const platform = navigator.userAgentData?.platform || navigator.platform || 'unknown';
    const ua = navigator.userAgent || '';
    const browser = /Firefox\/(\d+)/.test(ua)
      ? `Firefox ${RegExp.$1}`
      : /Edg\/(\d+)/.test(ua)
        ? `Edge ${RegExp.$1}`
        : /Chrome\/(\d+)/.test(ua)
          ? `Chromium ${RegExp.$1}`
          : /Safari\/(\d+)/.test(ua)
            ? 'Safari'
            : 'Unknown browser';
    return `${platform} / ${browser}`;
  }

  function sanitizeDetails(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
    const output = {};
    for (const [key, value] of Object.entries(input)) {
      if (/token|password|secret|authorization|cookie|query|fragment|notes?|filename|filepath|content|body/i.test(key)) continue;
      if (typeof value === 'string') output[key] = cleanText(value, MAX_TEXT);
      else if (typeof value === 'number' || typeof value === 'boolean' || value == null) output[key] = value;
      else if (Array.isArray(value)) output[key] = value.slice(0, 12).map(item => typeof item === 'string' ? cleanText(item, 80) : item);
    }
    return output;
  }

  function sanitizeResource(resource) {
    const value = String(resource || '');
    try {
      const url = new URL(value, location.origin);
      return url.origin === location.origin ? url.pathname : `${url.origin}${url.pathname}`;
    } catch {
      return cleanText(value.split(/[?#]/)[0], 120);
    }
  }

  function normalizeError(error) {
    if (error instanceof Error) return error;
    if (typeof error === 'string') return { name: 'Error', message: error };
    try {
      return { name: String(error?.name || 'Error'), message: String(error?.message || JSON.stringify(error)) };
    } catch {
      return { name: 'Error', message: 'Unknown error' };
    }
  }

  function cleanText(value, max = MAX_TEXT) {
    return String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);
  }

  function createId() {
    return window.crypto?.randomUUID?.() || `diag-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function round(value) {
    return Number.isFinite(Number(value)) ? Math.round(Number(value) * 10) / 10 : null;
  }

  function renderPage() {
    const root = document.getElementById('diagnosticsRoot');
    if (!root) return;
    const version = window.VReviewVersion || {};
    setText('diagAppVersion', `v${version.app || '--'}`);
    setText('diagBuild', version.build || '--');
    setText('diagGuide', `v${version.guide || '--'}`);
    setText('diagRoute', currentRoute());
    setText('diagSession', session.sessionId.slice(0, 8));
    setText('diagBreadcrumbCount', String(session.breadcrumbs.length));
    setText('diagErrorCount', String(session.errors.length));

    const errors = document.getElementById('diagnosticErrors');
    if (errors) {
      errors.replaceChildren();
      if (!session.errors.length) appendEmpty(errors, 'このSessionではRuntime Errorを記録していません。');
      session.errors.slice(-12).reverse().forEach(item => errors.appendChild(makeLogRow(item.at, item.code, item.message)));
    }

    const crumbs = document.getElementById('diagnosticBreadcrumbs');
    if (crumbs) {
      crumbs.replaceChildren();
      if (!session.breadcrumbs.length) appendEmpty(crumbs, 'まだBreadcrumbはありません。');
      session.breadcrumbs.slice(-20).reverse().forEach(item => {
        const detail = Object.keys(item.details || {}).length ? ` ${JSON.stringify(item.details)}` : '';
        crumbs.appendChild(makeLogRow(item.at, item.action, detail));
      });
    }
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function makeLogRow(at, label, message) {
    const row = document.createElement('div');
    row.className = 'diagnostic-log-row';
    const time = document.createElement('time');
    time.textContent = formatTime(at);
    const strong = document.createElement('strong');
    strong.textContent = label;
    const text = document.createElement('span');
    text.textContent = message || '';
    row.append(time, strong, text);
    return row;
  }

  function appendEmpty(parent, text) {
    const p = document.createElement('p');
    p.className = 'helper';
    p.textContent = text;
    parent.appendChild(p);
  }

  function formatTime(value) {
    try {
      return new Date(value).toLocaleTimeString('ja-JP', { hour12: false });
    } catch {
      return '--:--:--';
    }
  }

  window.addEventListener('error', event => {
    captureError(event.error || event.message, 'JS-UNEXPECTED-001', { source: sanitizeResource(event.filename || '') });
  });

  window.addEventListener('unhandledrejection', event => {
    captureError(event.reason, 'JS-PROMISE-001');
  });

  window.addEventListener('vreview:storage-error', event => {
    captureError(event.detail?.message || 'Storage failure', 'STORAGE-001', { operation: event.detail?.operation || 'unknown' });
  });

  window.addEventListener('online', () => breadcrumb('network.online'));
  window.addEventListener('offline', () => breadcrumb('network.offline'));

  document.addEventListener('DOMContentLoaded', () => {
    breadcrumb('page.open', { route: currentRoute(), width: window.innerWidth, height: window.innerHeight });
    renderPage();
    document.getElementById('exportDiagnosticsBtn')?.addEventListener('click', () => {
      exportJson().catch(error => captureError(error, 'DIAGNOSTICS-EXPORT-001'));
    });
    document.getElementById('copyDiagnosticsBtn')?.addEventListener('click', async () => {
      const status = document.getElementById('diagnosticsStatus');
      try {
        await copyReport();
        if (status) status.textContent = '診断JSONをClipboardへコピーしました。';
      } catch (error) {
        const code = captureError(error, 'DIAGNOSTICS-COPY-001');
        if (status) status.textContent = `コピーに失敗しました。Error: ${code}`;
      }
    });
    document.getElementById('clearDiagnosticsBtn')?.addEventListener('click', () => {
      if (!confirm('このタブの診断履歴を消去しますか？')) return;
      clear();
      const status = document.getElementById('diagnosticsStatus');
      if (status) status.textContent = '診断履歴を消去しました。';
    });
  });

  return { breadcrumb, captureError, networkFailure, snapshot, exportJson, copyReport, clear, renderPage };
})();
