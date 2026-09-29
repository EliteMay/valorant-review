import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const errors = [];
const warnings = [];
const EXPECTED_GUIDE = '1.22.0';
const EXPECTED_BASE_PATH = '/valorant-review/';

const requiredFiles = [
  'README.md',
  'SPEC.md',
  'PROJECT_LEARNINGS.md',
  'AGENTS.md',
  '作業報告書.md',
  'project-meta.json',
  'index.html',
  'review.html',
  'detector-test.html',
  'diagnostics.html',
  'js/version.js',
  'js/diagnostics.js',
  'js/detector.js',
  'js/feedback-library.js',
  'js/feedback-package-v5.js',
  'js/storage.js',
  'css/base.css',
  'css/layout.css',
  'css/components.css',
  'css/feedback-queue.css',
  'css/diagnostics.css',
  'data/detector-feedback-schema.json',
  'data/diagnostics-schema.json',
  'tests/BROWSER_CHECKLIST.md',
  'package.json',
  'electron/main.cjs',
  'electron/preload.cjs',
  'electron/foundation/settings-store.cjs',
  'electron/foundation/logger.cjs',
  'electron/foundation/window-state.cjs',
  'electron/foundation/task-registry.cjs',
  'electron/foundation/diagnostics.cjs',
  'electron/foundation/version-compare.cjs',
  'electron/updater.cjs',
  'js/detector-metrics.js',
  'tests/detector-metrics.test.mjs',
  'data/session-schema.json',
  'data/duel-schema.json',
  'data/analysis-run-schema.json',
  'docs/V1_ELECTRON_ARCHITECTURE.md',
  '.github/workflows/electron.yml',
  '.github/workflows/release.yml',
  'electron/telemetry/controller.cjs',
  'electron/telemetry/event-normalizer.cjs',
  'js/desktop-telemetry.js',
  'tests/telemetry-event.test.mjs',
  'tests/updater-version.test.mjs',
  'data/input-telemetry-schema.json',
  'native/input-telemetry/main.cpp',
  'scripts/build-input-helper.ps1',
  'electron/recording/controller.cjs',
  'tests/recording-controller.test.mjs',
  'tests/settings-store.test.mjs',
  'data/recording-schema.json'
];

for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(root, file))) errors.push(`missing required file: ${file}`);
}

const version = readVersionFile(path.join(root, 'js/version.js'));
const projectMeta = readJsonFile('project-meta.json');
const feedbackSchema = readJsonFile('data/detector-feedback-schema.json');
const diagnosticsSchema = readJsonFile('data/diagnostics-schema.json');
const packageJson = readJsonFile('package.json');

if (version) {
  if (packageJson?.version && packageJson.version !== version.app) errors.push('package.json version does not match js/version.js app');
  if (version.guide !== EXPECTED_GUIDE) errors.push(`js/version.js guide must be ${EXPECTED_GUIDE}, got ${version.guide ?? 'missing'}`);
  if (!version.app) errors.push('js/version.js app is missing');
  if (!version.detector) errors.push('js/version.js detector is missing');
  if (!version.telemetry) errors.push('js/version.js telemetry is missing');
  if (!version.recording) errors.push('js/version.js recording is missing');
  if (!version.build) errors.push('js/version.js build is missing');
  if (!Number.isInteger(version.storageSchema)) errors.push('js/version.js storageSchema must be an integer');
  if (!Number.isInteger(version.feedbackSchema)) errors.push('js/version.js feedbackSchema must be an integer');
  if (!Number.isInteger(version.feedbackBatchSchema)) errors.push('js/version.js feedbackBatchSchema must be an integer');
  if (!Number.isInteger(version.diagnosticsSchema)) errors.push('js/version.js diagnosticsSchema must be an integer');
}

if (projectMeta && version) {
  if (projectMeta.guideVersion !== version.guide) errors.push('project-meta.json guideVersion does not match js/version.js');
  const requiredProfiles = ['STATIC', 'MEDIA', 'AI-HANDOFF', 'TOOL'];
  const profiles = new Set(Array.isArray(projectMeta.profiles) ? projectMeta.profiles : []);
  for (const profile of requiredProfiles) {
    if (!profiles.has(profile)) errors.push(`project-meta.json missing profile: ${profile}`);
  }

  const sourceOfTruth = projectMeta.sourceOfTruth || {};
  const requiredSources = {
    runtimeVersion: 'js/version.js',
    projectSpecification: 'SPEC.md',
    currentOverview: 'README.md',
    projectLearnings: 'PROJECT_LEARNINGS.md',
    agentRouter: 'AGENTS.md',
    workHistory: '作業報告書.md'
  };
  for (const [key, expected] of Object.entries(requiredSources)) {
    if (sourceOfTruth[key] !== expected) errors.push(`project-meta sourceOfTruth.${key} must be ${expected}`);
  }

  if (Number(projectMeta?.storage?.schemaVersion) !== version.storageSchema) errors.push('project-meta storage schemaVersion does not match js/version.js');
  const queue = projectMeta?.storage?.feedbackQueue || {};
  if (queue.backend !== 'IndexedDB') errors.push('project-meta feedbackQueue.backend must be IndexedDB');
  if (queue.database !== 'vreview-feedback-library') errors.push('project-meta feedbackQueue.database is invalid');
  if (Number(queue.schemaVersion) !== 1) errors.push('project-meta feedbackQueue.schemaVersion must be 1');
  if (Number(queue.maxItems) !== 20) errors.push('project-meta feedbackQueue.maxItems must be 20');
  if (Number(queue.maxBytes) !== 367001600) errors.push('project-meta feedbackQueue.maxBytes must be 367001600');
  if (queue.storesSourceVideo !== false) errors.push('feedback queue must not store source video');
  if (queue.storesGeneratedImages !== true) errors.push('feedback queue generated image policy is missing');

  if (Number(projectMeta?.aiHandoff?.feedbackSchemaVersion) !== version.feedbackSchema) errors.push('project-meta feedbackSchemaVersion does not match js/version.js');
  if (String(projectMeta?.aiHandoff?.packageVersion) !== String(version.feedback)) errors.push('project-meta packageVersion does not match js/version.js feedback');
  if (projectMeta?.aiHandoff?.batchSchema !== 'vreview-detector-feedback-batch') errors.push('project-meta batchSchema is invalid');
  if (Number(projectMeta?.aiHandoff?.batchSchemaVersion) !== version.feedbackBatchSchema) errors.push('project-meta batchSchemaVersion does not match js/version.js');

  const diagnostics = projectMeta.diagnostics || {};
  if (Number(diagnostics.schemaVersion) !== version.diagnosticsSchema) errors.push('project-meta diagnostics schemaVersion does not match js/version.js');
  if (diagnostics.runtime !== 'js/diagnostics.js') errors.push('project-meta diagnostics runtime must be js/diagnostics.js');
  if (diagnostics.view !== 'diagnostics.html') errors.push('project-meta diagnostics view must be diagnostics.html');
  if (diagnostics.storage !== 'sessionStorage') errors.push('project-meta diagnostics storage must be sessionStorage');
  if (diagnostics.storesMedia !== false) errors.push('project-meta diagnostics must not store media');
  if (diagnostics.autoUpload !== false) errors.push('project-meta diagnostics must not auto upload');

  const visual = projectMeta.visual || {};
  if (visual.direction !== 'review-workbench') errors.push('project-meta visual.direction must be review-workbench');
  if (visual.primaryDevice !== 'desktop') errors.push('project-meta visual.primaryDevice must be desktop');
  if (visual.primaryContent !== 'video') errors.push('project-meta visual.primaryContent must be video');
  if (visual.desktopComposition !== 'fixed-video-right-inspector-scroll') errors.push('project-meta visual.desktopComposition is invalid');

  if (projectMeta?.deployment?.type !== 'github-pages') errors.push('project-meta deployment.type must be github-pages');
  if (projectMeta?.deployment?.basePath !== EXPECTED_BASE_PATH) errors.push(`project-meta deployment.basePath must be ${EXPECTED_BASE_PATH}`);
}

if (feedbackSchema && version) {
  if (feedbackSchema.packageSchema !== 'vreview-detector-feedback') errors.push('detector feedback packageSchema is invalid');
  if (Number(feedbackSchema.schemaVersion) !== version.feedbackSchema) errors.push('detector feedback schemaVersion does not match js/version.js');
  if (!Array.isArray(feedbackSchema.supportedPackageVersions) || !feedbackSchema.supportedPackageVersions.map(String).includes(String(version.feedback))) {
    errors.push('detector feedback schema does not support current feedback package version');
  }
  if (feedbackSchema.batchSchema !== 'vreview-detector-feedback-batch') errors.push('detector feedback batchSchema is invalid');
  if (!Array.isArray(feedbackSchema.supportedBatchVersions) || !feedbackSchema.supportedBatchVersions.map(Number).includes(Number(version.feedbackBatchSchema))) {
    errors.push('detector feedback schema does not support current batch schema version');
  }
  if (Number(feedbackSchema?.limits?.maxBatchClips) !== 20) errors.push('feedback schema maxBatchClips must be 20');
  if (Number(feedbackSchema?.limits?.maxBatchZipBytes) < 367001600) errors.push('feedback schema maxBatchZipBytes is too small for queue limit');
}

if (diagnosticsSchema && version && projectMeta) {
  if (diagnosticsSchema.schema !== 'vreview-development-diagnostics') errors.push('diagnostics schema name is invalid');
  if (Number(diagnosticsSchema.schemaVersion) !== version.diagnosticsSchema) errors.push('diagnostics schemaVersion does not match js/version.js');
  const requiredTopLevel = new Set(diagnosticsSchema.requiredTopLevel || []);
  for (const key of ['schema', 'schemaVersion', 'project', 'capture', 'environment', 'runtime', 'breadcrumbs', 'errors', 'networkFailures', 'storage', 'performance', 'notes']) {
    if (!requiredTopLevel.has(key)) errors.push(`diagnostics requiredTopLevel missing ${key}`);
  }
  const limits = diagnosticsSchema.limits || {};
  const meta = projectMeta.diagnostics || {};
  if (Number(limits.maxBreadcrumbs) !== Number(meta.maxBreadcrumbs)) errors.push('diagnostics maxBreadcrumbs does not match project-meta');
  if (Number(limits.maxErrors) !== Number(meta.maxErrors)) errors.push('diagnostics maxErrors does not match project-meta');
  if (Number(limits.maxNetworkFailures) !== 30) errors.push('diagnostics maxNetworkFailures must be 30');
  const privacy = diagnosticsSchema.privacy || {};
  for (const key of ['includeMediaBody', 'includeStorageValues', 'includeUserInputBody', 'includeFileName', 'autoUpload']) {
    if (privacy[key] !== false) errors.push(`diagnostics privacy.${key} must be false`);
  }
}

const htmlFiles = fs.readdirSync(root).filter(name => name.endsWith('.html'));
for (const htmlFile of htmlFiles) validateHtml(htmlFile);

const activeDiagnosticPages = ['index.html', 'review.html', 'detector-test.html', 'diagnostics.html'];
for (const htmlFile of activeDiagnosticPages) {
  const file = path.join(root, htmlFile);
  if (!fs.existsSync(file)) continue;
  const html = fs.readFileSync(file, 'utf8');
  if (!html.includes('js/diagnostics.js')) errors.push(`${htmlFile}: active page must load js/diagnostics.js`);
  if (!html.includes('diagnostics.html')) errors.push(`${htmlFile}: Diagnostics navigation/link is missing`);
}

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

validateReviewRuntime();
validateVisualWorkbench();
validateFeedbackQueue();
validateElectronFoundation();

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
  const batchMatch = feedbackText.match(/const\s+BATCH_VERSION\s*=\s*(\d+)/);
  if (!batchMatch || Number(batchMatch[1]) !== Number(version.feedbackBatchSchema)) errors.push('feedback package BATCH_VERSION does not match js/version.js');
}

const diagnosticsPath = path.join(root, 'js/diagnostics.js');
if (fs.existsSync(diagnosticsPath)) {
  const text = fs.readFileSync(diagnosticsPath, 'utf8');
  if (!text.includes("const SCHEMA = 'vreview-development-diagnostics'")) errors.push('diagnostics runtime schema constant is missing');
  if (!text.includes('const MAX_BREADCRUMBS = 120')) errors.push('diagnostics breadcrumb ring limit is not 120');
  if (!text.includes('const MAX_ERRORS = 40')) errors.push('diagnostics error ring limit is not 40');
  if (!text.includes('const MAX_NETWORK = 30')) errors.push('diagnostics network ring limit is not 30');
  if (!text.includes('sessionStorage')) errors.push('diagnostics runtime must use sessionStorage');
  if (/\bsendBeacon\s*\(/.test(text) || /\bXMLHttpRequest\b/.test(text) || /\bfetch\s*\(/.test(text)) errors.push('diagnostics runtime must not automatically send telemetry');
  if (!text.includes('User-entered notes and file names are not included.')) errors.push('diagnostics export privacy note is missing');
}

validateDocumentationSnapshots();

if (errors.length) {
  console.error('VReview validation failed:');
  for (const error of [...new Set(errors)]) console.error(`- ${error}`);
  if (warnings.length) {
    console.error('Warnings:');
    for (const warning of warnings) console.error(`- ${warning}`);
  }
  process.exit(1);
}

console.log(`VReview validation passed (${htmlFiles.length} HTML, ${runtimeFiles.length} runtime/data files checked, guide ${version?.guide || '?'}).`);
for (const warning of warnings) console.warn(`Warning: ${warning}`);


function validateElectronFoundation() {
  const pkg = readText('package.json');
  const main = readText('electron/main.cjs');
  const preload = readText('electron/preload.cjs');
  const settings = readText('settings.html');
  const workflow = readText('.github/workflows/electron.yml');
  const metrics = readText('js/detector-metrics.js');
  const detectorTest = readText('js/detector-test.js');
  const telemetryController = readText('electron/telemetry/controller.cjs');
  const telemetryNormalizer = readText('electron/telemetry/event-normalizer.cjs');
  const review = readText('review.html');
  const inputHelper = readText('native/input-telemetry/main.cpp');
  const recordingController = readText('electron/recording/controller.cjs');
  const desktopTelemetry = readText('js/desktop-telemetry.js');
  const recordingSchema = readText('data/recording-schema.json');
  if (!pkg || !main || !preload) return;

  if (!pkg.includes('"main": "electron/main.cjs"')) errors.push('package.json Electron main entry is invalid');
  if (!pkg.includes('"appId": "io.github.elitemay.vreview"')) errors.push('package.json appId is invalid');
  if (!main.includes('contextIsolation: true')) errors.push('Electron contextIsolation must be true');
  if (!main.includes('sandbox: true')) errors.push('Electron sandbox must be true');
  if (!main.includes('nodeIntegration: false')) errors.push('Electron nodeIntegration must be false');
  if (!main.includes('requestSingleInstanceLock')) errors.push('Electron single-instance guard is missing');
  if (!preload.includes('contextBridge.exposeInMainWorld')) errors.push('Electron preload bridge is missing');
  if (!preload.includes('updateNow:')) errors.push('Electron preload update action is missing');
  if (!main.includes("ipcMain.handle('updates:update-now'")) errors.push('Electron update-now IPC is missing');
  if (!settings.includes('js/desktop-settings.js')) errors.push('Desktop settings screen is not wired');
  if (!workflow.includes('windows-latest')) errors.push('Electron Windows CI is missing');
  if (!metrics.includes("mode: 'temporal-ground-truth-v1'")) errors.push('Temporal detector metrics are missing');
  if (!detectorTest.includes('auto-scenes.json')) errors.push('Detector Test must evaluate auto-scenes.json when available');
  if (!pkg.includes('"extraResources"')) errors.push('Electron package must bundle the input telemetry helper');
  if (!telemetryController.includes("spawn(helper")) errors.push('Telemetry controller must spawn the packaged helper');
  if (!telemetryNormalizer.includes("ALLOWED_KEYS = new Set(['W', 'A', 'S', 'D'])")) errors.push('Telemetry key allowlist changed unexpectedly');
  if (!review.includes('telemetryStartBtn') || !review.includes('js/desktop-telemetry.js')) errors.push('Review page telemetry controls are not wired');
  if (!inputHelper.includes('RIDEV_INPUTSINK')) errors.push('Windows Raw Input telemetry helper is missing');
  if (inputHelper.includes('SetWindowsHookEx')) errors.push('Telemetry helper must not use global keyboard/mouse hooks');
  if (inputHelper.includes('WriteProcessMemory') || inputHelper.includes('ReadProcessMemory')) errors.push('Telemetry helper must not read/write game process memory');
  if (inputHelper.includes('OpenProcess(') || inputHelper.includes('QueryFullProcessImageName')) errors.push('Telemetry helper must not open or inspect the VALORANT process');
  if (!inputHelper.includes('GetForegroundWindow') || !inputHelper.includes('GetWindowTextW')) errors.push('Telemetry foreground gating must use public window metadata only');
  if (!main.includes('setDisplayMediaRequestHandler')) errors.push('Electron display-media grant handler is missing');
  if (!main.includes("types: ['screen']")) errors.push('Gameplay recording must use screen capture sources only');
  if (!main.includes('backgroundThrottling: false')) errors.push('Gameplay recording requires backgroundThrottling=false');
  if (!preload.includes('appendRecordingChunk:')) errors.push('Recording chunk bridge is missing');
  if (!preload.includes('chooseRecordingFolder:')) errors.push('Recording directory chooser bridge is missing');
  if (!main.includes("settings:choose-recording-folder")) errors.push('Recording directory chooser IPC is missing');
  if (!main.includes('ensureRecordingSpace')) errors.push('Recording free-space guard is missing');
  if (!recordingController.includes("gameplay.") || !recordingController.includes("recording.json")) errors.push('Recording controller output contract is missing');
  if (!desktopTelemetry.includes('navigator.mediaDevices.getDisplayMedia')) errors.push('Review runtime does not request display capture');
  if (!desktopTelemetry.includes('new MediaRecorder')) errors.push('Review runtime does not use MediaRecorder');
  if (!review.includes('recordingVideoState') || !review.includes('recordingBytes')) errors.push('Review recording status UI is missing');
  if (!recordingSchema.includes('"schema": "vreview-gameplay-recording"')) errors.push('Recording schema is invalid');
  if (recordingController.includes('OpenProcess(') || recordingController.includes('ReadProcessMemory') || recordingController.includes('WriteProcessMemory')) errors.push('Recording controller must not access game process memory');
}

function validateReviewRuntime() {
  const review = readText('review.html');
  if (!review) return;
  if (!review.includes('js/detector.js')) errors.push('review.html must load js/detector.js');
  if (!review.includes('js/feedback-library.js')) errors.push('review.html must load js/feedback-library.js');
  if (!review.includes('js/feedback-package-v5.js')) errors.push('review.html must load current feedback package runtime');
  if (/scene-detection-v0\d+/i.test(review)) errors.push('review.html still loads legacy versioned detector scripts');
  const diagIndex = review.indexOf('js/diagnostics.js');
  const libraryIndex = review.indexOf('js/feedback-library.js');
  const appIndex = review.indexOf('js/app.js');
  if (diagIndex < 0 || appIndex < 0 || diagIndex > appIndex) errors.push('review.html must load diagnostics before app.js');
  if (libraryIndex < 0 || libraryIndex > appIndex) errors.push('review.html must load feedback-library before app.js');
}

function validateVisualWorkbench() {
  const review = readText('review.html');
  const index = readText('index.html');
  const layout = readText('css/layout.css');
  const components = readText('css/components.css');
  if (!review || !index || !layout || !components) return;

  const requiredReviewMarkers = ['review-workspace', 'video-column', 'player-shell', 'timeline-zone', 'scene-column', 'inspector-section', 'sceneList', 'feedbackPackageBtn'];
  for (const marker of requiredReviewMarkers) {
    if (!review.includes(marker)) errors.push(`review workbench missing marker: ${marker}`);
  }
  if (review.includes('aiPackageDisabledReason')) errors.push('review.html must not restore the large disabled AI package card');
  if (!index.includes('metric-strip')) errors.push('index.html must use compact metric-strip for detector summary');
  if (!index.includes('dashboard-grid')) errors.push('index.html must use review-oriented dashboard-grid');
  if (!layout.includes('body.review-page.review-loaded .scene-column')) errors.push('layout.css missing loaded scene-column rule');
  if (!layout.includes('overflow-y: auto')) errors.push('layout.css missing scrollable inspector behavior');
  if (!layout.includes('.player-shell')) errors.push('layout.css missing player-shell sizing rule');
  if (!layout.includes('@media (max-width: 980px)')) errors.push('layout.css missing narrow viewport fallback');
  if (!components.includes('.scene-column > .panel') || !components.includes('.inspector-section')) errors.push('components.css missing continuous inspector section styling');
  if (!components.includes('.scene-card.selected::before')) errors.push('components.css missing selected scene visual marker');
  if (!components.includes('.timeline-playhead')) errors.push('components.css missing timeline playhead styling');
  if (projectMeta?.visual?.direction === 'review-workbench' && !readText('tests/BROWSER_CHECKLIST.md').includes('Visual Review')) errors.push('Browser checklist must include Visual Review for review-workbench direction');
}

function validateFeedbackQueue() {
  const review = readText('review.html');
  const app = readText('js/app.js');
  const library = readText('js/feedback-library.js');
  const feedback = readText('js/feedback-package-v5.js');
  const detectorTest = readText('js/detector-test.js');
  if (!review || !app || !library || !feedback || !detectorTest) return;

  for (const marker of ['savedFeedbackCount', 'feedbackQueueList', 'exportFeedbackBatchBtn', 'clearFeedbackQueueBtn']) {
    if (!review.includes(marker)) errors.push(`review feedback queue missing marker: ${marker}`);
  }
  if (!review.includes('css/feedback-queue.css')) errors.push('review.html must load feedback queue styles');
  if (!library.includes("const DB_NAME = 'vreview-feedback-library'")) errors.push('feedback library DB name changed unexpectedly');
  if (!library.includes('indexedDB.open')) errors.push('feedback library must use IndexedDB');
  if (!library.includes('const MAX_ITEMS = 20')) errors.push('feedback library max item guard is missing');
  if (!library.includes('const MAX_TOTAL_BYTES = 350 * 1024 * 1024')) errors.push('feedback library total size guard is missing');
  if (/localStorage\.setItem/.test(library)) errors.push('feedback library must not store package blobs in localStorage');
  if (!feedback.includes('async function prepare')) errors.push('feedback package must separate prepare from ZIP build');
  if (!feedback.includes('async function buildBatch')) errors.push('feedback package batch builder is missing');
  if (!feedback.includes("schema: 'vreview-detector-feedback-batch'")) errors.push('feedback batch manifest schema is missing');
  if (!app.includes('VReviewFeedbackLibrary.save')) errors.push('app does not save prepared feedback to IndexedDB');
  if (!app.includes('VReviewFeedbackPackage.buildBatch')) errors.push('app does not export saved feedback as batch ZIP');
  if (!detectorTest.includes('batch-manifest.json')) errors.push('Detector Test does not support batch ZIP');
}

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
  const secretPatterns = [/sk-proj-[A-Za-z0-9_-]{16,}/, /\bghp_[A-Za-z0-9]{20,}/, /\bgithub_pat_[A-Za-z0-9_]{20,}/, /\bxox[baprs]-[A-Za-z0-9-]{16,}/];
  if (secretPatterns.some(pattern => pattern.test(content))) errors.push(`${relative}: possible secret token found`);
  if (relative.endsWith('.json')) {
    const dataUrlMatches = content.match(/data:[^;]+;base64,/g) || [];
    if (dataUrlMatches.length) errors.push(`${relative}: public JSON contains Data URL/base64 payload`);
  }
}

function validateDocumentationSnapshots() {
  if (!version) return;
  const readme = readText('README.md');
  const spec = readText('SPEC.md');
  const browser = readText('tests/BROWSER_CHECKLIST.md');
  if (!readme.includes(`VReview: **v${version.app}**`)) errors.push('README app version snapshot does not match js/version.js');
  if (!readme.includes(`Adopted Web Project Guide: **v${version.guide}**`)) errors.push('README guide version snapshot does not match js/version.js');
  if (!spec.includes(`- App Version: ${version.app}`)) errors.push('SPEC app version does not match js/version.js');
  if (!spec.includes(`- Guide Version: ${version.guide}`)) errors.push('SPEC guide version does not match js/version.js');
  if (!browser.includes(`v${version.guide}`)) errors.push('Browser checklist guide version does not match js/version.js');
  if (!readme.includes('PROJECT_LEARNINGS.md')) errors.push('README must link to PROJECT_LEARNINGS.md');
  if (!readme.includes('AGENTS.md')) errors.push('README must link to AGENTS.md');
  if (!readme.includes('https://elitemay.github.io/valorant-review/')) errors.push('README public URL is stale');
  if (!readme.includes('IndexedDB')) errors.push('README must document IndexedDB feedback queue');
  if (!spec.includes('repository subpath `/valorant-review/`')) errors.push('SPEC GitHub Pages base path is stale');
  if (!spec.includes('vreview-detector-feedback-batch')) errors.push('SPEC must document feedback batch schema');
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
    telemetry: readString('telemetry'),
    recording: readString('recording'),
    feedback: readString('feedback'),
    build: readString('build'),
    guide: readString('guide'),
    storageSchema: readNumber('storageSchema'),
    feedbackSchema: readNumber('feedbackSchema'),
    feedbackBatchSchema: readNumber('feedbackBatchSchema'),
    diagnosticsSchema: readNumber('diagnosticsSchema')
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

function readText(relative) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) return '';
  return fs.readFileSync(file, 'utf8');
}

function collectFiles(dirs, predicate) {
  const output = [];
  for (const dir of dirs) {
    const base = path.join(root, dir);
    if (!fs.existsSync(base)) continue;
    walk(base);
  }
  return output;
  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join('/');
      if (entry.isDirectory()) walk(absolute);
      else if (predicate(relative)) output.push(relative);
    }
  }
}
