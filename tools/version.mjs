#!/usr/bin/env node
// One release version for every distribution (web, Windows, Android).
//
//   node tools/version.mjs set 6.2.0        write it everywhere (then: changelog entry)
//   node tools/version.mjs check            all declarations agree (CI)
//   node tools/version.mjs check --tag=v6.2.0   … and match the release tag
//   node tools/version.mjs code 6.2.0-rc.1  print the Android versionCode
//
// Declarations: package.json (+ package-lock.json), src/config.js GAME_VERSION,
// src-tauri/Cargo.toml (+ Cargo.lock), src-tauri/tauri.conf.json (reads the
// version from package.json; its Android versionCode is derived below), the
// service worker cache name (rebuilt), and the newest changelog entry
// (src/changelog.js, checked: release notes must exist for the version).
//
// Android versionCode = (major·10000 + minor·100 + patch)·100 + (rc number, or 99 for a final release)
//   6.2.0-rc.1 → 6020001 · 6.2.0-rc.2 → 6020002 · 6.2.0 → 6020099 · 6.2.1 → 6020199
// Always increasing, a final release above its release candidates. Limits:
// minor and patch below 100, prerelease "rc.N" with N from 1 to 98.
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const R = (f) => path.join(ROOT, f);
const read = (f) => fs.readFileSync(R(f), 'utf8');
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?$/;

export function versionCode(v) {
  const m = SEMVER.exec(v);
  if (!m) throw new Error(`version "${v}" must look like 6.2.0 or 6.2.0-rc.1`);
  const [maj, min, pat, rc] = [+m[1], +m[2], +m[3], m[4] === undefined ? null : +m[4]];
  if (min > 99 || pat > 99) throw new Error('minor and patch must be below 100 for the Android versionCode');
  if (rc !== null && (rc < 1 || rc > 98)) throw new Error('rc number must be 1..98');
  return (maj * 10000 + min * 100 + pat) * 100 + (rc === null ? 99 : rc);
}

export function declarations() {
  const pkg = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  const conf = JSON.parse(read('src-tauri/tauri.conf.json'));
  const cargo = (read('src-tauri/Cargo.toml').match(/^\[package\][^[]*?^version\s*=\s*"([^"]+)"/m) || [])[1];
  const cargoLock = fs.existsSync(R('src-tauri/Cargo.lock')) ? (read('src-tauri/Cargo.lock').match(/\[\[package\]\]\nname = "tracklands"\nversion = "([^"]+)"/) || [])[1] : '(no Cargo.lock)';
  const game = (read('src/config.js').match(/GAME_VERSION = '([^']+)'/) || [])[1];
  const changelog = (read('src/changelog.js').match(/v:\s*'([^']+)'/) || [])[1];
  const sw = (read('service-worker.js').match(/const CACHE = 'tracklands-(.+)-[0-9a-f]{10}'/) || [])[1];
  return {
    'package.json': pkg.version, 'package-lock.json': lock.version, 'package-lock.json (root package)': lock.packages && lock.packages[''] && lock.packages[''].version,
    'src/config.js GAME_VERSION': game, 'src-tauri/Cargo.toml': cargo, 'src-tauri/Cargo.lock': cargoLock,
    'tauri.conf.json version': conf.version === '../package.json' ? pkg.version : `${conf.version} (must be "../package.json")`,
    'service-worker.js cache': sw, 'newest changelog entry (src/changelog.js)': changelog,
    _versionCode: conf.bundle && conf.bundle.android && conf.bundle.android.versionCode,
  };
}

export function check(tag) {
  const d = declarations();
  const v = d['package.json'];
  const problems = [];
  if (!SEMVER.test(v || '')) problems.push(`package.json version "${v}" is not X.Y.Z or X.Y.Z-rc.N`);
  for (const [k, x] of Object.entries(d)) if (!k.startsWith('_') && x !== v) problems.push(`${k} is "${x}", expected "${v}"`);
  try { if (d._versionCode !== versionCode(v)) problems.push(`tauri.conf.json bundle.android.versionCode is ${d._versionCode}, expected ${versionCode(v)}`); } catch (e) { problems.push(e.message); }
  if (tag !== undefined && tag !== 'v' + v) problems.push(`release tag "${tag}" does not match the version v${v}`);
  return { version: v, problems, declarations: d };
}

export function set(v) {
  versionCode(v); // validates
  const edit = (f, fn) => { const s = read(f), t = fn(s); if (t === s) throw new Error(`no version found in ${f}`); fs.writeFileSync(R(f), t); };
  const json = (f, fn) => { const o = JSON.parse(read(f)); fn(o); fs.writeFileSync(R(f), JSON.stringify(o, null, 2) + '\n'); };
  json('package.json', (o) => { o.version = v; });
  json('package-lock.json', (o) => { o.version = v; if (o.packages && o.packages['']) o.packages[''].version = v; });
  edit('src/config.js', (s) => s.replace(/GAME_VERSION = '[^']+'/, `GAME_VERSION = '${v}'`));
  edit('src-tauri/Cargo.toml', (s) => s.replace(/^(\[package\][^[]*?^version\s*=\s*)"[^"]+"/m, `$1"${v}"`));
  if (fs.existsSync(R('src-tauri/Cargo.lock'))) edit('src-tauri/Cargo.lock', (s) => s.replace(/(\[\[package\]\]\nname = "tracklands"\nversion = )"[^"]+"/, `$1"${v}"`));
  json('src-tauri/tauri.conf.json', (o) => { o.version = '../package.json'; o.bundle.android.versionCode = versionCode(v); });
  execFileSync(process.execPath, [R('tools/build-sw.mjs')], { stdio: 'inherit' });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [cmd, arg] = process.argv.slice(2);
  const tag = (process.argv.find((a) => a.startsWith('--tag=')) || '').slice(6) || undefined;
  try {
    if (cmd === 'set') {
      if (!arg) throw new Error('usage: node tools/version.mjs set X.Y.Z');
      set(arg);
      const r = check();
      console.log(`version set to ${arg} (Android versionCode ${versionCode(arg)})`);
      if (r.problems.length) console.log('still to do:\n  ' + r.problems.join('\n  '));
    } else if (cmd === 'code') {
      console.log(versionCode(arg));
    } else if (cmd === 'check') {
      const r = check(tag);
      if (r.problems.length) { console.error(`✗ version check failed (${r.version}):\n  ` + r.problems.join('\n  ')); process.exit(1); }
      console.log(`✓ version ${r.version} consistent everywhere (Android versionCode ${versionCode(r.version)})${tag ? `, tag ${tag} matches` : ''}`);
    } else throw new Error('usage: node tools/version.mjs set X.Y.Z | check [--tag=vX.Y.Z] | code X.Y.Z');
  } catch (e) { console.error(e.message); process.exit(1); }
}
