// Distribution files from an assembled master (development only):
//   node trailer/tools/encode.mjs <master.mov> [--webm] [--webm-only] [--drop-master]
// (--drop-master deletes the ProRes file afterwards: for cutdowns, to save disk)
// MP4: H.264 High, CRF 16, yuv420p, BT.709, AAC 320 kb/s, fast start.
// WebM: VP9 (CRF 24) + Opus 192 kb/s.
// The sound is loudness-normalised in two passes to -14 LUFS integrated with
// the true peak at most -1.5 dBTP (common for online video); the dynamics
// stay (linear normalisation, no squashing).
import fs from 'fs';
import { spawnSync, execFileSync } from 'child_process';

const args = process.argv.slice(2);
const src = args.find((a) => !a.startsWith('--'));
const webmOnly = args.includes('--webm-only');
const webm = webmOnly || args.includes('--webm');
const base = src.replace(/\.mov$/, '');
const TARGET = 'I=-14:TP=-2:LRA=11';
// a gentle peak limiter first (single transients such as a whistle onset
// would otherwise cap the linear gain below the target), and -2 dBTP inside
// so the true peak stays at or below -1.5 dBTP after AAC/Opus encoding
const PRE = 'alimiter=limit=0.5:attack=4:release=80:level=disabled,';

function loudness(file) {
  const p = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-vn', '-af', `${file === src ? PRE : ''}loudnorm=${TARGET}:print_format=json`, '-f', 'null', '-'], { encoding: 'utf8' });
  return JSON.parse((p.stderr || '').match(/\{[^{}]*"input_i"[^{}]*\}/)[0]);
}

const m = loudness(src);
console.log(`loudness in: ${m.input_i} LUFS, true peak ${m.input_tp} dBTP`);
const af = `${PRE}loudnorm=${TARGET}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true,aresample=48000`;
const color = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709'];

const mp4 = base + '.mp4';
if (!webmOnly) execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-af', af, '-vf', 'format=yuv420p', '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-crf', '16', '-g', '120', ...color,
  '-c:a', 'aac', '-b:a', '320k', '-movflags', '+faststart', mp4], { stdio: 'inherit' });
if (!webmOnly) console.log('wrote', mp4, (fs.statSync(mp4).size / 1048576).toFixed(1), 'MB');
if (webm) {
  const w = base + '.webm';
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-af', af, '-vf', 'format=yuv420p', '-c:v', 'libvpx-vp9', '-crf', '24', '-b:v', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4', '-tile-columns', '2', '-threads', '4', ...color,
    '-c:a', 'libopus', '-b:a', '192k', w], { stdio: 'inherit' });
  console.log('wrote', w, (fs.statSync(w).size / 1048576).toFixed(1), 'MB');
}
const o = loudness(webmOnly ? base + '.webm' : mp4);
console.log(`loudness out: ${o.input_i} LUFS, true peak ${o.input_tp} dBTP`);
if (args.includes('--drop-master')) fs.unlinkSync(src);
