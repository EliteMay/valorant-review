window.VREVIEW_VERSION = '0.4.1';

document.addEventListener('DOMContentLoaded', () => {
  const existing = document.querySelector('.app-version-badge');
  if (existing) {
    existing.textContent = `VReview v${window.VREVIEW_VERSION}`;
    return;
  }

  const badge = document.createElement('div');
  badge.className = 'app-version-badge';
  badge.textContent = `VReview v${window.VREVIEW_VERSION}`;
  badge.setAttribute('aria-label', `VReview version ${window.VREVIEW_VERSION}`);
  document.body.appendChild(badge);
});