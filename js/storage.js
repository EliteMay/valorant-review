window.VReviewStorage = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(`vreview:${key}`);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`vreview:${key}`, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
  remove(key) {
    localStorage.removeItem(`vreview:${key}`);
  }
};
