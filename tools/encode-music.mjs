#!/usr/bin/env node
// Turns the music masters in Music/ (WAV, kept with Git LFS) into the files
// the game ships in assets/music/, and writes assets/music/music.json.
//
//   node tools/encode-music.mjs            encode what is missing or changed
//   node tools/encode-music.mjs --force    encode everything again
//   node tools/encode-music.mjs --list     only rewrite music.json
//
// Music/Early  ~1900–1950    Music/Mid  ~1950–2000    Music/Late  2000 on
//
// Each master: leading and trailing silence trimmed, loudness evened out
// (EBU R128, -18 LUFS, peaks at most -2 dBTP) so no track jumps out, a short
// fade at both ends, then Opus at 64 kbit/s in WebM (about 0.5 MB a minute).
// The game crossfades from one track into the next (MusicManager).
// Needs ffmpeg with libopus.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFileSync, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import os from 'os';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'Music');
const OUT = path.join(ROOT, 'assets', 'music');
const BITRATE = '64k';
const ENCODER = 1;   // bump to re-encode everything when the recipe changes

export const PERIODS = {
  early: { dir: 'Early', from: 1800, to: 1949 },
  mid: { dir: 'Mid', from: 1950, to: 1999 },
  late: { dir: 'Late', from: 2000, to: 9999 },
};

// "TTFrenchHouse (2).wav" → style "FrenchHouse", number 2
const STYLE = {
  '': { title: 'Early Days', mood: ['peaceful', 'menu'] },
  Bigmap: { title: 'Big Map', mood: ['busy'] },
  Break: { title: 'Break', mood: ['peaceful'] },
  City: { title: 'City', mood: ['city'] },
  Corpo: { title: 'Corporate', mood: ['busy', 'city'] },
  Funk: { title: 'Funk', mood: ['busy'] },
  Industrial: { title: 'Industrial', mood: ['industrial'] },
  Nighttime: { title: 'Nighttime', mood: ['night'] },
  Ambientech: { title: 'Ambient Tech', mood: ['peaceful', 'menu'] },
  FrenchHouse: { title: 'French House', mood: ['city'] },
  House: { title: 'House', mood: ['busy', 'city'] },
  IDM: { title: 'IDM', mood: ['industrial'] },
  LoFi: { title: 'Lo-Fi', mood: ['peaceful', 'night'] },
  Minimal: { title: 'Minimal', mood: ['peaceful'] },
  Synth: { title: 'Synth', mood: ['night'] },
  Sypop: { title: 'Synth Pop', mood: ['city'] },
  UKGarage: { title: 'UK Garage', mood: ['busy'] },
  Y2K: { title: 'Y2K', mood: ['city'] },
};

function parse(name) {
  const m = /^TT([A-Za-z0-9]*)\s*(?:\((\d+)\))?\.wav$/i.exec(name);
  if (!m) return null;
  return { style: m[1], n: m[2] ? +m[2] + 1 : 1 };
}
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function masters() {
  const list = [];
  for (const [period, P] of Object.entries(PERIODS)) {
    const dir = path.join(SRC, P.dir);
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter((f) => /\.wav$/i.test(f)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    const count = {};
    for (const f of files) { const p = parse(f); if (p) count[p.style] = (count[p.style] || 0) + 1; }
    for (const f of files) {
      const p = parse(f);
      if (!p) { console.warn(`skipped (name not recognised): ${P.dir}/${f}`); continue; }
      const st = STYLE[p.style] || { title: p.style.replace(/([a-z])([A-Z])/g, '$1 $2'), mood: [] };
      const title = count[p.style] > 1 ? `${st.title} ${p.n}` : st.title;
      const id = slug(title).startsWith(period) ? slug(title) : `${period}-${slug(title)}`;
      list.push({ src: path.join(dir, f), id, file: id + '.webm', title, period, mood: st.mood });
    }
  }
  return list;
}

const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// where the music starts and ends: leading and trailing silence below -55 dBFS
function trimPoints(src) {
  const r = ffmpegLog('ffmpeg', ['-hide_banner', '-nostats', '-i', src, '-af', 'silencedetect=n=-55dB:d=0.1', '-f', 'null', '-']);
  const total = (() => { const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(r); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0; })();
  const starts = [...r.matchAll(/silence_start: ([\d.]+)/g)].map((x) => +x[1]);
  const ends = [...r.matchAll(/silence_end: ([\d.]+)/g)].map((x) => +x[1]);
  let a = 0, b = total;
  if (starts.length && starts[0] < 0.05 && ends.length) a = ends[0];
  // a silence that runs to the end has a start but no end (or ends at the end)
  if (starts.length) { const last = starts[starts.length - 1]; const lastEnd = ends.length >= starts.length ? ends[starts.length - 1] : total; if (last > a && total - lastEnd < 0.05) b = last; }
  return { a: Math.max(0, a - 0.02), b: Math.min(total, b + 0.05), total };
}
// ffmpeg writes its analysis to stderr
function ffmpegLog(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return String(r.stderr || '') + String(r.stdout || '');
}

function encode(t) {
  const out = path.join(OUT, t.file);
  const { a, b } = trimPoints(t.src);
  const len = Math.max(1, b - a);
  const af = [
    `atrim=start=${a.toFixed(3)}:end=${b.toFixed(3)}`, 'asetpts=PTS-STARTPTS',
    'loudnorm=I=-18:TP=-2:LRA=14',
    'aresample=48000',
    'afade=t=in:d=0.6',
    `afade=t=out:st=${Math.max(0, len - 1.5).toFixed(2)}:d=1.5`,
  ].join(',');
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', t.src, '-af', af, '-ac', '2',
    '-c:a', 'libopus', '-b:a', BITRATE, '-vbr', 'on', '-application', 'audio', '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact',
    '-metadata', `title=${t.title}`, out]);
  return probeDuration(out);
}
function probeDuration(file) {
  const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(ffmpegLog('ffmpeg', ['-hide_banner', '-i', file]));
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0;
}

export function writeList(tracks) {
  const json = { tracks: tracks.map((t) => ({ id: t.id, file: t.file, title: t.title, artist: '', period: t.period, years: [PERIODS[t.period].from, PERIODS[t.period].to], mood: t.mood, duration: Math.round(t.duration || 0), weight: 1 })) };
  fs.writeFileSync(path.join(OUT, 'music.json'), JSON.stringify(json, null, 1) + '\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) && process.argv[2] !== '--one') {
  const force = process.argv.includes('--force'), listOnly = process.argv.includes('--list');
  const tracks = masters();
  if (!tracks.length) { console.error('no masters in Music/ (fetched with Git LFS? run: git lfs pull)'); process.exit(1); }
  const stampFile = path.join(OUT, '.encoded.json');
  const stamps = fs.existsSync(stampFile) ? JSON.parse(fs.readFileSync(stampFile, 'utf8')) : {};
  const todo = [];
  for (const t of tracks) {
    const head = fs.readFileSync(t.src).subarray(0, 64).toString('utf8');
    if (head.startsWith('version https://git-lfs')) { console.error(`${t.src} is a Git LFS pointer; run: git lfs pull`); process.exit(1); }
    t.key = `${ENCODER}:${BITRATE}:${sha(t.src)}`;
    const out = path.join(OUT, t.file);
    if (!listOnly && (force || stamps[t.id] !== t.key || !fs.existsSync(out))) todo.push(t);
    else t.duration = probeDuration(out);
  }
  const jobs = Math.max(1, Math.min(os.cpus().length, 8));
  console.log(`${tracks.length} masters, ${todo.length} to encode (${jobs} at a time)`);
  // encode in parallel child processes
  const { spawn } = await import('child_process');
  let next = 0, done = 0;
  await new Promise((resolve, reject) => {
    if (!todo.length) { resolve(); return; }
    const start = () => {
      if (next >= todo.length) { if (done === todo.length) resolve(); return; }
      const t = todo[next++];
      const p = spawn(process.execPath, [fileURLToPath(import.meta.url), '--one', t.src, t.id, t.file, t.title], { stdio: ['ignore', 'pipe', 'inherit'] });
      let outp = '';
      p.stdout.on('data', (d) => { outp += d; });
      p.on('exit', (code) => {
        if (code) { reject(new Error('ffmpeg failed for ' + t.src)); return; }
        t.duration = +outp.trim() || 0; stamps[t.id] = t.key; done++;
        console.log(`  ${done}/${todo.length} ${t.file} (${Math.round(t.duration)} s)`);
        start();
      });
    };
    for (let i = 0; i < jobs; i++) start();
  });
  // drop outputs of masters that are gone
  const keep = new Set(tracks.map((t) => t.file));
  for (const f of fs.readdirSync(OUT)) if (/\.webm$/.test(f) && !keep.has(f)) { fs.rmSync(path.join(OUT, f)); delete stamps[f.replace(/\.webm$/, '')]; }
  for (const id of Object.keys(stamps)) if (!tracks.some((t) => t.id === id)) delete stamps[id];
  fs.writeFileSync(stampFile, JSON.stringify(stamps, null, 1) + '\n');
  writeList(tracks);
  const bytes = tracks.reduce((s, t) => s + fs.statSync(path.join(OUT, t.file)).size, 0);
  console.log(`music.json: ${tracks.length} tracks, ${(tracks.reduce((s, t) => s + (t.duration || 0), 0) / 60).toFixed(1)} min, ${(bytes / 1e6).toFixed(1)} MB`);
}

// worker entry: encode one master and print its duration
//   node encode-music.mjs --one <src> <id> <file> <title>
if (process.argv[2] === '--one') {
  const [, , , src, id, file, title] = process.argv;
  process.stdout.write(String(encode({ src, id, file, title })));
}
