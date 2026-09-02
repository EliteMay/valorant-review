window.VReviewVersion = Object.freeze({
  app: '0.7.0',
  detector: '0.5.0',
  feedback: '5',
  storageSchema: 1,
  feedbackSchema: 1,
  diagnosticsSchema: 1,
  build: '20260902-1',
  guide: '1.13.0'
});

(function applyVReviewVersion() {
  const version = window.VReviewVersion;

  function apply() {
    document.body?.setAttribute('data-vreview-version', `v${version.app}`);
    document.querySelectorAll('.sidebar').forEach(el => {
      el.setAttribute('data-vreview-version', `v${version.app}`);
    });
    document.querySelectorAll('[data-app-version]').forEach(el => { el.textContent = `v${version.app}`; });
    document.querySelectorAll('[data-build-version]').forEach(el => { el.textContent = version.build; });
    document.querySelectorAll('[data-detector-version]').forEach(el => { el.textContent = `v${version.detector}`; });
    document.querySelectorAll('[data-feedback-version]').forEach(el => { el.textContent = `v${version.feedback}`; });
    document.querySelectorAll('[data-guide-version]').forEach(el => { el.textContent = `v${version.guide}`; });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply, { once: true });
  else apply();
})();
