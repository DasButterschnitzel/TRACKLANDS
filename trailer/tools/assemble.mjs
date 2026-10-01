// Assembles the trailer (development only) from captured clips, text cards
// and sound with FFmpeg — no proprietary editor. The edit is trailer/edit.json:
//
//   { "shots": [ { "clip": "s01-steam", "in": 0.5, "dur": 4, "x": 0.5 },  … ],
//     "cards": [ { "id": "first", "at": 2.0, "dur": 2.6 }, … ],
//     "sfx":   [ { "file": "whistle-steam", "at": 3.1, "gain": -8 }, … ],
//     "fadeIn": 1.2, "fadeOut": 2.0 }
//
// shots play in order; "x" is a crossfade (seconds) into the NEXT shot (0 =
// straight cut, "black": true fades through black). A clip is
// captures/<clip>-<lang>.mp4 with its sound beside it; UI clips exist per
// language, clean ones as <clip>-none.mp4 (used by every language).
//
//   node trailer/tools/assemble.mjs --lang=en|de|clean [--edit=edit.json] [--out=name]
//
// Output: trailer/output/<name>-<lang>.mov (ProRes 422 HQ master with PCM
// sound) — encode.mjs makes the distribution files from it.
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { ROOT } from '../../tests/lib.mjs';

const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; }));
const lang = args.lang || 'en';
const TR = path.join(ROOT, 'trailer');
const edit = JSON.parse(fs.readFileSync(path.join(TR, args.edit || 'edit.json'), 'utf8'));
const outName = args.out || edit.name || 'tracklands-trailer';
const fps = edit.fps || 60;
const out = path.join(TR, 'output');
fs.mkdirSync(out, { recursive: true });

const clipFile = (c, ext) => {
  for (const l of [lang === 'clean' ? 'en' : lang, 'none']) {
    const f = path.join(TR, 'captures', `${c}-${l}.${ext}`);
    if (fs.existsSync(f)) return f;
  }
  throw new Error(`missing capture ${c} (${ext}) for ${lang}`);
};

// ---- video: trimmed shots joined with cuts / crossfades / dips to black ----
const inputs = [];
const fc = [];
let t = 0;            // running timeline position (start of current shot)
const starts = [];
edit.shots.forEach((s, i) => {
  inputs.push('-i', clipFile(s.clip, 'mp4'));
  fc.push(`[${i}:v]trim=start=${s.in || 0}:duration=${s.dur},setpts=PTS-STARTPTS,fps=${fps},format=yuv420p,settb=1/${fps}[v${i}]`);
});
let last = 'v0';
let pos = edit.shots[0].dur;
starts.push(0);
for (let i = 1; i < edit.shots.length; i++) {
  const prev = edit.shots[i - 1];
  const x = prev.x || 0;
  const tr = prev.black ? 'fadeblack' : 'fade';
  const offset = pos - (x || 0);
  starts.push(offset);
  if (x > 0) fc.push(`[${last}][v${i}]xfade=transition=${tr}:duration=${x}:offset=${offset.toFixed(4)}[j${i}]`);
  else fc.push(`[${last}][v${i}]concat=n=2:v=1:a=0[j${i}]`);
  last = `j${i}`;
  pos = offset + edit.shots[i].dur;
}
const total = pos;
t = total;

// ---- cards: transparent PNG overlays faded in and out ----
const nIn = edit.shots.length;
const cardLang = lang === 'clean' ? null : lang;
let ci = nIn;
if (cardLang) for (const c of edit.cards || []) {
  inputs.push('-loop', '1', '-t', String(c.dur + 0.1), '-i', path.join(TR, 'cards', cardLang, `${c.id}.png`));
  const fi = c.fadeIn ?? 0.45, fo = c.fadeOut ?? 0.5;
  fc.push(`[${ci}:v]format=rgba,fade=t=in:st=0:d=${fi}:alpha=1,fade=t=out:st=${(c.dur - fo).toFixed(3)}:d=${fo}:alpha=1,setpts=PTS-STARTPTS+${c.at}/TB[c${ci}]`);
  fc.push(`[${last}][c${ci}]overlay=0:0:eof_action=pass:enable='between(t,${c.at},${(c.at + c.dur).toFixed(3)})'[o${ci}]`);
  last = `o${ci}`;
  ci++;
}
// fade in from / out to black
fc.push(`[${last}]fade=t=in:st=0:d=${edit.fadeIn ?? 1}:color=black,fade=t=out:st=${(total - (edit.fadeOut ?? 1.5)).toFixed(3)}:d=${edit.fadeOut ?? 1.5}:color=black,format=yuv422p10le[vout]`);

// ---- sound: each shot's own game sound, placed and cross-faded; accents ----
const aParts = [];
edit.shots.forEach((s, i) => {
  const wav = clipFile(s.clip, 'wav');
  inputs.push('-i', wav);
  const k = ci++;
  const x = s.x || 0, xp = i > 0 ? edit.shots[i - 1].x || 0 : 0;
  const g = s.gain ?? 0;
  const fadeA = Math.max(0.04, xp), fadeB = Math.max(0.04, x);
  aParts.push(`[${k}:a]atrim=start=${s.in || 0}:duration=${s.dur},asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo,volume=${g}dB,afade=t=in:st=0:d=${fadeA},afade=t=out:st=${(s.dur - fadeB).toFixed(3)}:d=${fadeB},adelay=${Math.round(starts[i] * 1000)}|${Math.round(starts[i] * 1000)}[a${i}]`);
});
for (const [j, a] of (edit.sfx || []).entries()) {
  inputs.push('-i', path.join(TR, 'audio', 'sfx', `${a.file}.wav`));
  const k = ci++;
  aParts.push(`[${k}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${a.gain ?? 0}dB,adelay=${Math.round(a.at * 1000)}|${Math.round(a.at * 1000)}[s${j}]`);
}
const aLabels = edit.shots.map((_, i) => `[a${i}]`).concat((edit.sfx || []).map((_, j) => `[s${j}]`));
fc.push(...aParts);
fc.push(`${aLabels.join('')}amix=inputs=${aLabels.length}:normalize=0:dropout_transition=0,atrim=duration=${total.toFixed(3)},afade=t=in:st=0:d=${edit.fadeIn ?? 1},afade=t=out:st=${(total - (edit.fadeOut ?? 1.5)).toFixed(3)}:d=${edit.fadeOut ?? 1.5}[aout]`);

const file = path.join(out, `${outName}-${lang}.mov`);
const script = path.join(out, `${outName}-${lang}.filter.txt`);
fs.writeFileSync(script, fc.join(';\n'));
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex_script', script, '-map', '[vout]', '-map', '[aout]',
  '-c:v', 'prores_ks', '-profile:v', '3', '-c:a', 'pcm_s24le', '-r', String(fps), '-t', total.toFixed(3), file], { stdio: 'inherit' });
console.log(`wrote ${path.relative(ROOT, file)} (${total.toFixed(2)} s)`);
