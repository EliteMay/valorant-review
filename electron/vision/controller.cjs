'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

function validateSettings({ start, end, fps }) {
  const values = [start, end, fps].map(Number);
  if (!values.every(Number.isFinite) || values[0] < 0 ||
      values[1] <= values[0] || values[1] - values[0] > 30 ||
      values[2] < 1 || values[2] > 30) {
    throw new Error('解析範囲は30秒以内、解析頻度は1～30fpsにしてください。');
  }
  return { start: values[0], end: values[1], fps: values[2] };
}

function resolvePython(userDataDir, environment = process.env) {
  if (environment.VREVIEW_VISION_PYTHON) {
    const full = path.resolve(environment.VREVIEW_VISION_PYTHON);
    if (!fs.existsSync(full)) throw new Error('指定したOpenCV用Pythonが見つかりません。');
    return { command: full, prefix: [] };
  }
  const local = path.join(userDataDir, 'vision-python', 'Scripts', 'python.exe');
  if (fs.existsSync(local)) return { command: local, prefix: [] };
  return { command: process.platform === 'win32' ? 'py' : 'python3',
    prefix: process.platform === 'win32' ? ['-3'] : [] };
}

async function scan({ sourcePath, start, end, fps }, {
  userDataDir, scriptPath, signal, python
} = {}) {
  const settings = validateSettings({ start, end, fps });
  if (!userDataDir || !scriptPath) throw new Error('Vision analyzer is not configured.');
  if (!/\.(mp4|webm)$/i.test(sourcePath || '')) throw new Error('MP4 / WebMを選択してください。');
  const real = await fsp.realpath(sourcePath);
  if (!(await fsp.stat(real)).isFile()) throw new Error('動画ファイルがありません。');
  if (!fs.existsSync(scriptPath)) throw new Error('Vision workerが見つかりません。');
  const saved = path.join(userDataDir, 'VisionRuns');
  await fsp.mkdir(saved, { recursive: true });
  const work = await fsp.mkdtemp(path.join(saved, '.partial-'));
  const target = path.join(saved, crypto.randomUUID());
  const py = python || resolvePython(userDataDir);
  let success = false;
  try {
    const args = [...py.prefix, scriptPath, '--video', real, '--output', work,
      '--start', String(settings.start), '--end', String(settings.end), '--fps', String(settings.fps)];
    const result = await new Promise((resolve, reject) => {
      const child = spawn(py.command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '', err = '', done = false;
      const abort = () => child.kill();
      if (signal?.aborted) abort();
      signal?.addEventListener('abort', abort, { once: true });
      const timeout = setTimeout(() => child.kill(), 120000);
      child.stdout.on('data', chunk => {
        out += chunk.toString('utf8');
        if (out.length > 2_000_000) child.kill();
      });
      child.stderr.on('data', chunk => {
        err += chunk.toString('utf8');
        if (err.length > 65536) child.kill();
      });
      child.once('error', error => finish(error));
      child.once('close', code => {
        if (signal?.aborted) return finish(Object.assign(new Error('解析を中止しました。'), { name: 'AbortError' }));
        let obj;
        try { obj = JSON.parse(out.trim()); } catch {}
        if (code !== 0 || !obj?.ok) {
          return finish(new Error(obj?.error || (code === 0
            ? '解析結果が不正です。' : 'OpenCVを実行できません。Pythonとcv2を確認してください。')));
        }
        finish(null, obj);
      });
      function finish(error, value) {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        signal?.removeEventListener('abort', abort);
        if (error) reject(error); else resolve(value);
      }
    });
    await fsp.rename(work, target);
    success = true;
    return { ...result.summary, saved_directory: target };
  } finally {
    if (!success) await fsp.rm(work, { force: true, recursive: true });
  }
}

module.exports = { validateSettings, resolvePython, scan };
