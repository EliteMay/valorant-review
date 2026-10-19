'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { scan } = require('../electron/vision/controller.cjs');
async function main() {
  const sourcePath = path.resolve(process.argv[2]);
  const command = process.argv[3];
  const folder = path.join(path.dirname(sourcePath), 'user-data');
  const out = await scan({ sourcePath, start: 0, end: 4, fps: 10 }, {
    userDataDir: folder,
    scriptPath: path.resolve(__dirname, '../electron/vision/hud_change_scan.py'),
    python: { command, prefix: [] }
  });
  assert.equal(out.schema, 'vreview-roi-motion-candidates');
  assert.ok(out.events.hp_shield_area.length > 0);
  assert.ok(out.events.killfeed_area.length > 0);
  assert.ok(fs.existsSync(path.join(out.saved_directory, 'summary.json')));
  const entries = fs.readdirSync(path.join(folder, 'VisionRuns'));
  assert.equal(entries.filter(n => !n.startsWith('.')).length, 1);
  console.log('Electron Vision Node->OpenCV worker->file storage E2E passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
