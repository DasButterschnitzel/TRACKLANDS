#!/usr/bin/env node
// Stages the game for release from the one runtime file list
// (tools/runtime-files.mjs), so nothing but the game is shipped.
//
//   node tools/build-web.mjs --target=web      → dist/web/      (browser / PWA, with service worker)
//   node tools/build-web.mjs --target=native   → dist/native/   (Tauri frontendDist, no service worker)
//   node tools/build-web.mjs --target=web --zip → also dist/TRACKLANDS-<version>-web.zip
//
// Options: --sha=<commit> (default: git HEAD, or empty outside git).
// The staged copy of src/buildinfo.js carries the commit; nothing else differs
// from the repository files. Every staged module import, stylesheet and
// index.html reference is checked to resolve inside the staged tree, and
// development folders are asserted absent.
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { ROOT, runtimeFiles, gameVersion, WEB_ONLY_FILES } from './runtime-files.mjs';

const FORBIDDEN = ['tests', 'trailer', 'docs', '.github', '.git', 'node_modules', 'tools', 'src-tauri', 'dist', '.cache'];

export function stage(target, { sha } = {}) {
  if (!['web', 'native'].includes(target)) throw new Error('target must be web or native');
  const out = path.join(ROOT, 'dist', target);
  fs.rmSync(out, { recursive: true, force: true });
  const files = [...runtimeFiles(), ...(target === 'web' ? WEB_ONLY_FILES : [])].sort();
  for (const f of files) {
    const dst = path.join(out, f);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(ROOT, f), dst);
  }
  if (sha === undefined) { try { sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch (e) { sha = ''; } }
  if (sha && !/^[0-9a-f]{7,40}$/.test(sha)) throw new Error('bad --sha ' + sha);
  fs.writeFileSync(path.join(out, 'src/buildinfo.js'), `// Build metadata, written by tools/build-web.mjs.\nexport const BUILD = { sha: '${sha}' };\n`);
  const problems = verify(out, target);
  if (problems.length) throw new Error('staging check failed:\n  ' + problems.join('\n  '));
  return { out, files };
}

// every reference inside the staged tree must resolve inside it
export function verify(out, target) {
  const problems = [];
  const exists = (rel) => fs.existsSync(path.join(out, rel));
  for (const d of FORBIDDEN) if (exists(d)) problems.push(`development folder shipped: ${d}/`);
  if (target === 'native' && exists('service-worker.js')) problems.push('service-worker.js in the native build');
  if (target === 'web' && !exists('service-worker.js')) problems.push('service-worker.js missing from the web build');
  for (const need of ['index.html', 'src/main.js', 'styles/main.css', 'vendor/three/three.module.js', 'assets/music/music.json']) if (!exists(need)) problems.push('missing ' + need);
  const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  for (const m of html.matchAll(/(?:src|href)="([^"#:]+)"/g)) if (!exists(m[1].replace(/^\.\//, ''))) problems.push(`index.html → ${m[1]} missing`);
  for (const m of html.matchAll(/"three":\s*"([^"]+)"/g)) if (!exists(m[1].replace(/^\.\//, ''))) problems.push(`importmap → ${m[1]} missing`);
  const walk = (dir) => fs.readdirSync(path.join(out, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.posix.join(dir, e.name)) : [path.posix.join(dir, e.name)]));
  for (const f of walk('src').filter((f) => f.endsWith('.js'))) {
    const code = fs.readFileSync(path.join(out, f), 'utf8');
    for (const m of code.matchAll(/(?:import|export)\s[^'"]*?from\s*['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)|new URL\(\s*['"](\.[^'"]+)['"]\s*,\s*import\.meta\.url/g)) {
      const spec = m[1] || m[2] || m[3];
      const rel = path.posix.normalize(path.posix.join(path.posix.dirname(f), spec));
      if (!exists(rel)) problems.push(`${f} → ${spec} missing`);
    }
  }
  for (const f of walk('styles').filter((f) => f.endsWith('.css'))) {
    const css = fs.readFileSync(path.join(out, f), 'utf8');
    for (const m of css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
      if (/^(data:|https?:|#)/.test(m[1])) continue;
      const rel = path.posix.normalize(path.posix.join(path.posix.dirname(f), m[1]));
      if (!exists(rel)) problems.push(`${f} → ${m[1]} missing`);
    }
  }
  // music: every track listed in the playlist must be shipped
  try {
    const mj = JSON.parse(fs.readFileSync(path.join(out, 'assets/music/music.json'), 'utf8'));
    for (const tr of mj.tracks || []) if (tr.file && !exists(path.posix.join('assets/music', tr.file))) problems.push(`music.json → ${tr.file} missing`);
  } catch (e) { problems.push('assets/music/music.json unreadable: ' + e.message); }
  return problems;
}

// A small deterministic ZIP writer (deflate, fixed timestamps, sorted entries),
// so the same source always gives the same archive.
export function zipDir(dir, file, prefix) {
  const walk = (d) => fs.readdirSync(path.join(dir, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.posix.join(d, e.name)) : [path.posix.join(d, e.name)]));
  const entries = walk('.').map((f) => f.replace(/^\.\//, '')).sort();
  const parts = [], central = [];
  let off = 0;
  const DOS_TIME = 0, DOS_DATE = (1 << 5) | 1; // 1980-01-01 00:00
  for (const rel of entries) {
    const data = fs.readFileSync(path.join(dir, rel));
    const comp = zlib.deflateRawSync(data, { level: 9 });
    const name = Buffer.from((prefix ? prefix + '/' : '') + rel, 'utf8');
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(DOS_TIME, 10); lh.writeUInt16LE(DOS_DATE, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    parts.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(0x031e, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(DOS_TIME, 12); ch.writeUInt16LE(DOS_DATE, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE((0o100644 << 16) >>> 0, 38); ch.writeUInt32LE(off, 42);
    central.push(ch, name);
    off += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  fs.writeFileSync(file, Buffer.concat([...parts, cd, end]));
  return { entries: entries.length, sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') };
}
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(buf) { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
  const target = args.target || 'web';
  try {
    const { out, files } = stage(target, { sha: typeof args.sha === 'string' ? args.sha : undefined });
    const bytes = files.reduce((n, f) => n + fs.statSync(path.join(out, f)).size, 0);
    console.log(`staged ${target}: ${files.length} files, ${(bytes / 1048576).toFixed(1)} MB → ${path.relative(ROOT, out)}/`);
    if (args.zip) {
      const name = `TRACKLANDS-${gameVersion()}-web.zip`;
      const z = zipDir(out, path.join(ROOT, 'dist', name), `TRACKLANDS-${gameVersion()}`);
      console.log(`wrote dist/${name}: ${z.entries} files, ${(fs.statSync(path.join(ROOT, 'dist', name)).size / 1048576).toFixed(1)} MB, sha256 ${z.sha256}`);
    }
  } catch (e) { console.error(e.message); process.exit(1); }
}
