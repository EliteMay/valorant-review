const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);

async function createTrackerPackage({ sessionDir, compression = 'standard', logger }) {
  if (process.platform !== 'win32') {
    throw new Error('Tracker PackageはWindows版VReviewで作成してください。');
  }
  const manifestPath = path.join(sessionDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error('Tracker session manifest was not found.');

  const parent = path.dirname(sessionDir);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').replace(/\.\d{3}Z$/, 'Z');
  const outputPath = path.join(parent, `VReview-Tracker-${stamp}.zip`);
  const scriptPath = path.join(__dirname, 'create-package.ps1');

  try {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-File', scriptPath,
      '-SessionPath', sessionDir,
      '-OutputPath', outputPath,
      '-Compression', compression
    ], {
      windowsHide: true,
      encoding: 'utf8',
      timeout: 10 * 60 * 1000,
      maxBuffer: 1024 * 1024
    });
    const result = JSON.parse(String(stdout || '').trim());
    if (!result.ok || !fs.existsSync(result.outputPath)) throw new Error('ZIP output was not created.');
    return {
      ok: true,
      outputPath: result.outputPath,
      bytes: Number(result.bytes || fs.statSync(result.outputPath).size)
    };
  } catch (error) {
    logger?.warn('tracker.package.failed', { message: String(error?.message || error).slice(0, 220) });
    throw error;
  }
}

module.exports = { createTrackerPackage };
