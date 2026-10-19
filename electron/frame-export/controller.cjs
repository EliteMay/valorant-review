'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);

const MAX_FRAMES = 180;
const MAX_BYTES = 100 * 1024 * 1024;

function planNativeFrames({ start, end, fps }) {
  start = Number(start);
  end = Number(end);
  fps = Number(fps);
  if (![start, end, fps].every(Number.isFinite) || start < 0 ||
      end <= start || ![10, 30, 60].includes(fps)) {
    throw new Error('抽出する時間と頻度を確認してください。');
  }
  if (Math.ceil((end - start) * fps - 1e-8) > MAX_FRAMES) {
    throw new Error('最大180枚です。抽出範囲を短くしてください。');
  }
  return { start, end, fps };
}

async function run(command, args, signal, timeout) {
  if (signal?.aborted) throw Object.assign(new Error('中止しました。'), { name: 'AbortError' });
  try {
    return await execute(command, args, {
      signal, timeout, windowsHide: true, maxBuffer: 2 * 1024 * 1024
    });
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(command + ' が見つかりません。FFmpeg / FFprobeをインストールし、PATHを確認してください。');
    }
    if (error.name === 'AbortError' || error.code === 'ABORT_ERR') {
      throw Object.assign(new Error('中止しました。'), { name: 'AbortError' });
    }
    if (error.killed) throw new Error('フレーム抽出が制限時間を超えました。');
    throw new Error('動画処理に失敗しました: ' + String(error.stderr || error.message).slice(-400));
  }
}

async function exportNativeFrames(settings, {
  outputPath, ffmpeg = 'ffmpeg', ffprobe = 'ffprobe',
  zipScript = path.join(__dirname, 'create-zip.ps1'),
  powershell = 'powershell.exe', tempRoot = os.tmpdir(), signal,
  onProgress = () => {}
} = {}) {
  const { start, end, fps } = planNativeFrames(settings);
  const requestedSource = String(settings.sourcePath || '');
  if (!requestedSource || !/\.(mp4|webm)$/i.test(requestedSource)) {
    throw new Error('MP4 / WebMを選択してください。');
  }
  const sourcePath = await fs.realpath(requestedSource);
  if (!(await fs.stat(sourcePath)).isFile()) throw new Error('動画ファイルではありません。');
  if (!outputPath || path.extname(outputPath).toLowerCase() !== '.zip') {
    throw new Error('保存先のZIPファイル名を確認してください。');
  }

  const probe = await run(ffprobe, [
    '-v', 'error', '-show_entries', 'format=duration:stream=avg_frame_rate',
    '-select_streams', 'v:0', '-of', 'json', sourcePath
  ], signal, 20000);
  let metadata;
  try { metadata = JSON.parse(probe.stdout); }
  catch { throw new Error('動画の長さを読み取れませんでした。'); }
  const duration = Number(metadata.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0 || end > duration + 0.005) {
    throw new Error('終了時刻が動画の長さを超えています。');
  }

  const work = await fs.mkdtemp(path.join(tempRoot, 'vreview-frame-'));
  try {
    const imagesDir = path.join(work, 'package', 'frames');
    await fs.mkdir(imagesDir, { recursive: true });
    const interval = Math.max(0, 1 / fps - 0.0005).toFixed(7);
    const filter = "select='isnan(prev_selected_t)+gte(t-prev_selected_t," + interval + ")',showinfo";
    onProgress({ stage: 'decode', detail: '元映像をFFmpegで抽出中…' });
    const result = await run(ffmpeg, [
      '-hide_banner', '-nostdin', '-y', '-loglevel', 'info',
      '-ss', String(start), '-i', sourcePath,
      '-t', String(end - start), '-an',
      '-vf', filter, '-fps_mode', 'passthrough', '-q:v', '3',
      '-frames:v', String(MAX_FRAMES + 1), path.join(imagesDir, 'frame_%06d.jpg')
    ], signal, 180000);

    const names = (await fs.readdir(imagesDir)).filter(name => /^frame_\d{6}\.jpg$/.test(name)).sort();
    if (!names.length) throw new Error('抽出できるフレームがありませんでした。');
    if (names.length > MAX_FRAMES) throw new Error('画像が180枚を超えました。時間範囲を短くしてください。');
    let totalBytes = 0;
    for (const name of names) totalBytes += (await fs.stat(path.join(imagesDir, name))).size;
    if (totalBytes > MAX_BYTES) throw new Error('画像が100MBを超えました。抽出範囲を短くしてください。');

    const pts = Array.from(result.stderr.matchAll(/\bpts_time:\s*(-?\d+(?:\.\d+)?)/g), m => Number(m[1]));
    const manifest = {
      schema: 'vreview-native-frame-evidence', version: 1,
      source: path.basename(sourcePath),
      source_duration_seconds: duration,
      source_fps: metadata.streams?.[0]?.avg_frame_rate || null,
      requested_range_seconds: [start, end],
      requested_maximum_fps: fps,
      method: 'FFmpeg native decode, select (no upsampling), showinfo',
      warning: '元動画の実フレームを抽出します。PTSはシーク後の相対時刻であり、元動画の絶対PTSと同一とは限りません。',
      total_frames: names.length,
      frames: names.map((name, i) => ({
        file: 'frames/' + name,
        sequence: i + 1,
        seek_relative_pts_seconds: Number.isFinite(pts[i]) ? pts[i] : null
      }))
    };
    const root = path.join(work, 'package');
    await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
    await fs.writeFile(path.join(root, 'README.txt'),
      'VReview フレーム証拠ZIP\r\n元動画や音声は含まれません。\r\n' +
      '元動画の実フレームから抽出。シーク相対PTSは元の絶対時刻とは限りません。\r\n', 'utf8');

    onProgress({ stage: 'zip', detail: names.length + '枚をZIPにまとめています…' });
    const temporaryZip = path.join(work, 'frames.zip');
    await run(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', zipScript, '-Source', root, '-Destination', temporaryZip
    ], signal, 180000);
    await fs.copyFile(temporaryZip, outputPath);
    onProgress({ stage: 'done', detail: names.length + '枚を保存しました。' });
    return { frameCount: names.length, byteCount: totalBytes, savedPath: outputPath, manifest };
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}

module.exports = { MAX_FRAMES, MAX_BYTES, planNativeFrames, exportNativeFrames };
