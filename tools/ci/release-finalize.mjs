#!/usr/bin/env node
// Final release step (CI): independent checks over the collected artifacts,
// then SHA256SUMS.txt and release-manifest.json.
//
//   node tools/ci/release-finalize.mjs --dir release --version 6.2.0 --commit <sha> [--dry-run]
//
// - exactly the expected public files are present, none empty
// - every checksum is computed here from the bytes on disk
// - Windows installer is a PE executable; APK/AAB/ZIP are zip archives
// - secret scan: no signing material inside any artifact (keystore, PFX,
//   private keys, keystore.properties), no value of a secret passed in
//   SCAN_SECRET_* environment variables (also base64 forms), no CI runner paths
// - signing status per artifact comes from the platform jobs' reports
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import zlib from 'zlib';

const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : undefined; };
const dir = path.resolve(opt('dir') || 'release');
const version = opt('version'), commit = opt('commit');
const dryRun = argv.includes('--dry-run');
if (!version || !commit) { console.error('usage: --dir --version --commit [--dry-run]'); process.exit(2); }
// test-key builds carry a label in their Android file names: 'dryrun' (never
// published) or 'preview' (published as a marked pre-release)
const labelArg = (() => { const i = argv.indexOf('--label'); return i >= 0 ? argv[i + 1] : ''; })();
const label = labelArg || (dryRun ? 'dryrun' : '');
const sfx = label ? '-' + label : '';
const testKeyNote = label === 'preview' ? ' — PREVIEW: test signing key, not the release key; an official release cannot update this install' : ' — DRY RUN: throwaway key, not for distribution';
const expected = {
  web: `TRACKLANDS-${version}-web.zip`,
  windows: `TRACKLANDS-${version}-windows-x64-setup.exe`,
  apk: `TRACKLANDS-${version}-android-universal${sfx}.apk`,
  aab: `TRACKLANDS-${version}-android${sfx}.aab`,
};
const problems = [];
const say = (ok, what, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ' — ' + detail : ''}`); if (!ok) problems.push(what); };
const readJSON = (f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { return null; } };

// zip entry names (central directory) and contents
function zipEntries(buf) {
  let e = buf.length - 22; while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) return null;
  const n = buf.readUInt16LE(e + 10); let p = buf.readUInt32LE(e + 16);
  const out = [];
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), ex = buf.readUInt16LE(p + 30), cm = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nl);
    const dataOff = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    out.push({ name, data: () => { const raw = buf.subarray(dataOff, dataOff + csize); try { return method === 8 ? zlib.inflateRawSync(raw) : raw; } catch (err) { return Buffer.alloc(0); } } });
    p += 46 + nl + ex + cm;
  }
  return out;
}

const secrets = Object.entries(process.env).filter(([k, v]) => k.startsWith('SCAN_SECRET_') && v && v.length >= 6).map(([k, v]) => [k, v]);
const needles = [];
for (const [k, v] of secrets) {
  needles.push([k, Buffer.from(v)]);
  if (v.length > 64) needles.push([k + ' (fragment)', Buffer.from(v.replace(/\s+/g, '').slice(40, 104))]);
}
const PATTERNS = [/-----BEGIN (?:RSA |EC |ENCRYPTED )?PRIVATE KEY-----/, /storePassword\s*=/, /keyPassword\s*=/, /ANDROID_KEYSTORE_BASE64/, /WINDOWS_CERTIFICATE_PASSWORD/, /ghp_[A-Za-z0-9]{30,}/, /github_pat_[A-Za-z0-9_]{40,}/, /\/home\/runner\/work\//, /D:\\a\\_temp/];
const BAD_NAMES = /(\.jks|\.keystore|\.p12|\.pfx|keystore\.properties|key\.properties)$/i;
function scan(label, buf) {
  for (const [k, n] of needles) if (buf.indexOf(n) >= 0) return `contains the value of ${k}`;
  const s = buf.toString('latin1');
  for (const re of PATTERNS) if (re.test(s)) return `matches ${re}`;
  return null;
}

const artifacts = [];
for (const [kind, name] of Object.entries(expected)) {
  const f = path.join(dir, name);
  if (!fs.existsSync(f)) { say(false, `${kind} artifact present`, name); continue; }
  const buf = fs.readFileSync(f);
  say(buf.length > 100000, `${name} is not trivially small`, `${(buf.length / 1048576).toFixed(1)} MB`);
  if (kind === 'windows') say(buf[0] === 0x4d && buf[1] === 0x5a && buf.readUInt32LE(buf.readUInt32LE(0x3c)) === 0x00004550, `${name} is a PE executable`);
  let leak = scan(name, buf);
  if (kind !== 'windows') {
    const ents = zipEntries(buf);
    say(!!ents && ents.length > 0, `${name} is a readable zip archive`, ents ? `${ents.length} entries` : '');
    for (const e of ents || []) {
      if (BAD_NAMES.test(e.name)) { leak = leak || `contains file ${e.name}`; break; }
      if (/\.(js|json|html|properties|xml|txt|pro|cfg)$/i.test(e.name)) { const r = scan(e.name, e.data()); if (r) { leak = leak || `${e.name} ${r}`; break; } }
    }
    if (kind === 'web') {
      const names = (ents || []).map((e) => e.name.replace(/^[^/]+\//, ''));
      say(names.includes('index.html') && names.includes('service-worker.js') && names.includes('src/main.js'), 'web zip holds the game (index.html, src/main.js, service worker)');
      say(!names.some((n) => /^(tests|trailer|docs|tools|src-tauri|\.github)\//.test(n)), 'web zip holds no development folders');
    }
  }
  say(!leak, `secret scan: ${name}`, leak || 'clean');
  artifacts.push({ kind, name, bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex') });
}
const extras = fs.readdirSync(dir).filter((f) => !Object.values(expected).includes(f) && !/\.json$/.test(f));
say(extras.length === 0, 'no unexpected files in the release folder', extras.join(', '));

const win = readJSON('windows-report.json') || {}, android = readJSON('android-verify.json') || {}, web = readJSON('web-report.json') || {};
const signed = {
  web: 'not applicable',
  windows: win.signature || 'unknown',
  apk: android.apkCertSha256 ? `signed (certificate SHA-256 ${android.apkCertSha256})${dryRun ? testKeyNote : ''}` : 'unsigned',
  aab: android.aabCertSha256 ? `signed (certificate SHA-256 ${android.aabCertSha256})${dryRun ? testKeyNote : ''}` : 'unsigned',
};
if (!dryRun) say(!!android.apkCertSha256 && android.aabCertSha256 === android.apkCertSha256, 'Android release artifacts are signed, APK and AAB with the same certificate');
const platform = { web: 'web', windows: 'windows-x64', apk: 'android', aab: 'android' };

if (problems.length) { console.error(`\nrelease verification failed (${problems.length}):\n  ${problems.join('\n  ')}`); process.exit(1); }

fs.writeFileSync(path.join(dir, 'SHA256SUMS.txt'), artifacts.map((a) => `${a.sha256}  ${a.name}`).join('\n') + '\n');
const manifest = {
  product: 'TRACKLANDS', version, commit, dryRun, preview: label === 'preview',
  built: new Date().toISOString(),
  artifacts: artifacts.map((a) => ({ file: a.name, platform: platform[a.kind], bytes: a.bytes, sha256: a.sha256, signing: signed[a.kind] })),
  android: { applicationId: android.want && android.want.id, versionName: android.want && android.want.versionName, versionCode: android.want && android.want.versionCode, minSdk: android.apkSdk && android.apkSdk.min, targetSdk: android.apkSdk && android.apkSdk.target, abis: android.apkAbis },
  tools: { ...(web.tools || {}), ...(win.tools || {}), ...(android.tools || {}) },
};
fs.writeFileSync(path.join(dir, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
for (const f of ['windows-report.json', 'android-verify.json', 'web-report.json']) fs.rmSync(path.join(dir, f), { force: true });
console.log(`\nverified ${artifacts.length} artifacts; wrote SHA256SUMS.txt and release-manifest.json`);
