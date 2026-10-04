import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

if (process.platform !== 'win32') {
  console.log('Tracker package Windows PowerShell regression test skipped on non-Windows.');
  process.exit(0);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vreview-tracker-package-'));
const session = path.join(root, 'session');
const captures = path.join(session, 'captures', 'match-history');
const output = path.join(root, 'tracker-package.zip');
fs.mkdirSync(captures, { recursive: true });
fs.writeFileSync(path.join(session, 'manifest.json'), JSON.stringify({
  schema: 'vreview-tracker-capture-session',
  schemaVersion: 1,
  status: 'completed',
  captures: [{ path: 'captures/match-history/raw-001.png' }]
}, null, 2));
fs.writeFileSync(path.join(session, 'README.txt'), 'Tracker package smoke test\r\n', 'utf8');
fs.writeFileSync(path.join(captures, 'raw-001.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

try {
  const script = path.resolve('electron', 'tracker-collector', 'create-package.ps1');
  const stdout = execFileSync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-File', script,
    '-SessionPath', session,
    '-OutputPath', output,
    '-Compression', 'standard'
  ], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60_000
  });

  const text = String(stdout || '').replace(/^\uFEFF/, '').trim();
  const result = JSON.parse(text);
  assert.equal(result.ok, true);
  assert.equal(path.resolve(result.outputPath), path.resolve(output));
  assert.equal(fs.existsSync(output), true);
  assert.ok(fs.statSync(output).size > 0);
  console.log('Tracker package Windows PowerShell regression test passed.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
