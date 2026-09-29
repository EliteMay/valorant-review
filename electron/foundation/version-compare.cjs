function compareVersions(a, b) {
  const left = String(a || '').split('-')[0].split('.').map(part => Number.parseInt(part, 10) || 0);
  const right = String(b || '').split('-')[0].split('.').map(part => Number.parseInt(part, 10) || 0);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index++) {
    const l = left[index] || 0;
    const r = right[index] || 0;
    if (l > r) return 1;
    if (l < r) return -1;
  }
  return 0;
}

module.exports = { compareVersions };
