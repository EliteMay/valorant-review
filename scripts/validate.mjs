import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const errors = [];
const warnings = [];

const requiredFiles = [
  'README.md',
  'SPEC.md',
  'project-meta.json',
  'index.html',
  'review.html',
  'detector-test.html',
  'js/version.js',
  'js/detector.js',
  'js/feedback-package-v5.js',
  'js/storage.js',
  'data/detector-feedback-schema.json'
];

for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(root, file))) errors.push(`missing required file: ${file}`);
}

const version = readVersionFile(path.join(root, 'js/version.js'));
const projectMeta = readJsonFile('project-meta.json');
const feedbackSchema = readJsonFile('data/detector-feedback-schema.json');

if (version) {
  if (version.guide !== '1.1.0') errors.push(`js/version.js guide must be 1.1.0, got ${version.guide ?? 'missing'}`);
  if (!version.build) errors.push('js/version.js build is missing');
  if (!Number.isInteger(version.storageSchema)) errors.push('js/version.js storageSchema must be an integer');
  if (!Number.isInteger(version.feedbackSchema)) errors.push('js/version.js feedbackSchema must be an integer');
}

if (projectMeta && version) {
  if (projectMeta.guideVersion !== version.guide) errors.push('project-meta.json guideVersion does not match js/version.js');
  const requiredProfiles = ['STATIC', 'MEDIA', 'AI-HANDOFF', 'TOOL'];
  const profiles = new Set(Array.isArray(projectMeta.profiles) ? projectMeta.profiles : []);
  for (const profile of requiredProfiles) {
    if (!profiles.has(profile)) errors.push(`project-meta.json missing profile: ${profile}`);
  }
  if (Number(projectMeta?.storage?.schemaVersion) !== version.storageSchema) errors.push('project-meta storage schemaVersion does not match js/version.js');
  if (Number(projectMeta?.aiHandoff?.feedbackSchemaVersion) !== version.feedbackSchema) errors.push('project-meta feedbackSchemaVersion does not match js/version.js');
  if (String(projectMeta?.aiHandoff?.packageVersion) !== String(version.feedback)) errors.push('project-meta packageVersion does not match js/version.js feedback');
}

if (feedbackSchema && version) {
  if (feedbackSchema.packageSchema !== 'vreview-detector-feedback') errors.push('detector feedback packageSchema is invalid');
  if (Number(feedbackSchema.schemaVersion) !== version.feedbackSchema) errors.push('detector feedback schemaVersion does not match js/version.js');
  if (!Array.isArray(feedbackSchema.supportedPackageVersions) || !feedbackSchema.supportedPackageVersions.map(String).includes(String(version.feedback))) {
    errors.push('detector feedback schema does not support current feedback package version');
  }
}

const htmlFiles = fs.readdirSync(root).filter(name => name.endsWith('.html'));
for (const htmlFile of htmlFiles) validateHtml(htmlFile);

const runtimeFiles = collectFiles(['js', 'data'], file => /\.(?:js|json)$/i.test(file));
for (const relative of runtimeFiles) {
  const content = fs.readFileSync(path.join(root, relative), 'utf8');
  validatePublicRuntime(relative, content);
}

const jsonFiles = collectFiles(['data'], file => file.endsWith('.json'));
for (const file of ['project-meta.json', ...jsonFiles]) readJsonFile(file);

const jsDir = path.join(root, 'js');
if (fs.existsSync(jsDir)) {
  for (const name of fs.readdirSync(jsDir)) {
    if (/^scene-detection-v/i.test(name)) errors.push(`legacy versioned detector runtime present: js/${name}`);
  }
}

const reviewPath = path.join(root, 'review.html');
if (fs.existsSync(reviewPath)) {
  const review = fs.readFileSync(reviewPath, 'utf8');
  if (!review.includes('js/detector.js')) errors.push('review.html must load js/detector.js');
  if (!review.includes('js/feedback-package-v5.js')) errors.push('review.html must load current feedback package runtime');
  if (/scene-detection-v0\d+/i.test(review)) errors.push('review.html still loads legacy versioned detector scripts');
}

const detectorPath = path.join(root, 'js/detector.js');
if (fs.existsSync(detectorPath) && version?.detector) {
  const detectorText = fs.readFileSync(detectorPath, 'utf8');
  const match = detectorText.match(/const\s+VERSION\s*=\s*['"]([^'"]+)['"]/);
  if (match && match[1] !== String(version.detector)) errors.push(`js/detector.js VERSION ${match[1]} does not match js/version.js detector ${version.detector}`);
}

const feedbackPath = path.join(root, 'js/feedback-package-v5.js');
if (fs.existsSync(feedbackPath) && version?.feedback) {
  const feedbackText = fs.readFileSync(feedbackPath, 'utf8');
  const match = feedbackText.match(/const\s+VERSION\s*=\s*(\d+)/);
  if (match && match[1] !== String(version.feedback)) errors.push(`feedback package VERSION ${match[1]} does not match js/version.js feedback ${version.feedback}`);
}

if (errors.length) {
  console.error('VReview validation failed:');
  for (const error of errors) console.error(`- ${error}`);
  if (warnings.length) {
    console.error('Warnings:');
    for (const warning of warnings) console.error(`- ${warning}`);
  }
  process.exit(1);
}

console.log(`VReview validation passed (${htmlFiles.length} HTML, ${runtimeFiles.length} runtime/data files checked).`);
for (const warning of warnings) console.warn(`Warning: ${warning}`);

function validateHtml(htmlFile) {
  const html = fs.readFileSync(path.join(root, htmlFile), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map(match => match[1]);

  for (const ref of refs) {
    if (/^(?:https?:|mailto:|#|javascript:)/i.test(ref)) continue;
    const clean = ref.split(/[?#]/)[0];
    if (!clean) continue;
    const target = path.resolve(root, path.dirname(htmlFile), clean);
    if (!fs.existsSync(target)) errors.push(`${htmlFile}: missing ${ref}`);

    const queryMatch = ref.match(/\?v=([^&#]+)/);
    if (queryMatch && /\.(?:css|js)(?:\?|$)/i.test(ref) && version?.build && queryMatch[1] !== String(version.build)) {
      errors.push(`${htmlFile}: cache version ${queryMatch[1]} does not match build ${version.build} for ${ref}`);
    }
  }

  const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]);
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) errors.push(`${htmlFile}: duplicate id="${id}"`);
    seen.add(id);
  }

  if (!html.includes('js/version.js')) errors.push(`${htmlFile}: js/version.js is not loaded`);
  if (/\blocalhost(?::\d+)?\b/i.test(html)) errors.push(`${htmlFile}: localhost dependency found`);
  if (/(?:[A-Za-z]:\\|file:\/\/\/)/.test(html)) errors.push(`${htmlFile}: PC-specific absolute path found`);
}

function validatePublicRuntime(relative, content) {
  if (/\blocalhost(?::\d+)?\b/i.test(content)) errors.push(`${relative}: localhost dependency found`);
  if (/(?:[A-Za-z]:\\|file:\/\/\/)/.test(content)) errors.push(`${relative}: PC-specific absolute path found`);

  const secretPatterns = [
    /sk-proj-[A-Za-z0-9_-]{16,}/,
    /\bghp_[A-Za-z0-9]{20,}/,
    /\bgithub_pat_[A-Za-z0-9_]{20,}/,
    /\bxox[baprs]-[A-Za-z0-9-]{16,}/
  ];
  if (secretPatterns.some(pattern => pattern.test(content))) errors.push(`${relative}: possible secret token found`);

  if (relative.endsWith('.json')) {
    const dataUrlMatches = content.match(/data:[^;]+;base64,/g) || [];
    if (dataUrlMatches.length) errors.push(`${relative}: public JSON contains Data URL/base64 payload`);
  }
}

function readVersionFile(file) {
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8');
  const readString = name => text.match(new RegExp(`${name}\\s*:\\s*['\"]([^'\"]+)['\"]`))?.[1] ?? null;
  const readNumber = name => {
    const raw = text.match(new RegExp(`${name}\\s*:\\s*(\\d+)`))?.[1];
    return raw == null ? null : Number(raw);
  };
  return {
    app: readString('app'),
    detector: readString('detector'),
    feedback: readString('feedback'),
    build: readString('build'),
    guide: readString('guide'),
    storageSchema: readNumber('storageSchema'),
    feedbackSchema: readNumber('feedbackSchema')
  };
}

function readJsonFile(relative) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) {
    errors.push(`missing JSON file: ${relative}`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    errors.push(`${relative}: invalid JSON (${error.message})`);
    return null;
  }
}

function collectFiles(dirs, predicate) {
  const output = [];
  for (const dir of dirs) {
    const base = path.join(root, dir);
    if (!fs.existsSync(base)) continue;
    walk(base, dir);
  }
  return output;

  function walk(current, relativeBase) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join('/');
      if (entry.isDirectory()) walk(absolute, relative);
      else if (predicate(relative)) output.push(relative);
    }
  }
}
