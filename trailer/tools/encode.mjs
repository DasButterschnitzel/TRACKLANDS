// Distribution files from an assembled master (development only):
//   node trailer/tools/encode.mjs <master.mov> [--webm]
// MP4: H.264 High, CRF 16, yuv420p, BT.709, AAC 320 kb/s, fast start.
// WebM: VP9 (CRF 24) + Opus 192 kb/s.
// The sound is loudness-normalised in two passes to -14 LUFS integrated with
// the true peak at most -1.5 dBTP (common for online video); the dynamics
// stay (linear normalisation, no squashing).
import fs from 'fs';
import { spawnSync, execFileSync } from 'child_process';

const args = process.argv.slice(2);
const src = args.find((a) => !a.startsWith('--'));
const webm = args.includes('--webm');
const base = src.replace(/\.mov$/, '');
const TARGET = 'I=-14:TP=-1.5:LRA=11';

function loudness(file) {
  const p = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-vn', '-af', `loudnorm=${TARGET}:print_format=json`, '-f', 'null', '-'], { encoding: 'utf8' });
  return JSON.parse((p.stderr || '').match(/\{[^{}]*"input_i"[^{}]*\}/)[0]);
}

const m = loudness(src);
console.log(`loudness in: ${m.input_i} LUFS, true peak ${m.input_tp} dBTP`);
const af = `loudnorm=${TARGET}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true,aresample=48000`;
const color = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709'];

const mp4 = base + '.mp4';
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-af', af, '-vf', 'format=yuv420p', '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-crf', '16', '-g', '120', ...color,
  '-c:a', 'aac', '-b:a', '320k', '-movflags', '+faststart', mp4], { stdio: 'inherit' });
console.log('wrote', mp4, (fs.statSync(mp4).size / 1048576).toFixed(1), 'MB');
if (webm) {
  const w = base + '.webm';
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-af', af, '-vf', 'format=yuv420p', '-c:v', 'libvpx-vp9', '-crf', '24', '-b:v', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2', ...color,
    '-c:a', 'libopus', '-b:a', '192k', w], { stdio: 'inherit' });
  console.log('wrote', w, (fs.statSync(w).size / 1048576).toFixed(1), 'MB');
}
const o = loudness(mp4);
console.log(`loudness out: ${o.input_i} LUFS, true peak ${o.input_tp} dBTP`);
