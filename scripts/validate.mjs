import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const errors = [];
const htmlFiles = fs.readdirSync(root).filter(name => name.endsWith('.html'));

for (const htmlFile of htmlFiles) {
  const html = fs.readFileSync(path.join(root, htmlFile), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map(match => match[1]);
  for (const ref of refs) {
    if (/^(?:https?:|mailto:|#|javascript:)/i.test(ref)) continue;
    const clean = ref.split(/[?#]/)[0];
    if (!clean) continue;
    const target = path.resolve(root, path.dirname(htmlFile), clean);
    if (!fs.existsSync(target)) errors.push(`${htmlFile}: missing ${ref}`);
  }
}

const reviewPath = path.join(root, 'review.html');
if (fs.existsSync(reviewPath)) {
  const review = fs.readFileSync(reviewPath, 'utf8');
  if (!review.includes('js/detector.js')) errors.push('review.html must load js/detector.js');
  if (!review.includes('js/feedback-package-v5.js')) errors.push('review.html must load feedback-package-v5.js');
  if (/scene-detection-v0\d+/i.test(review)) errors.push('review.html still loads legacy versioned detector scripts');
}

const versionPath = path.join(root, 'js/version.js');
if (!fs.existsSync(versionPath)) errors.push('js/version.js is missing');

if (errors.length) {
  console.error('VReview validation failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`VReview validation passed (${htmlFiles.length} HTML files checked).`);
