#!/usr/bin/env node
// Checks the Android build outputs and copies them under release names.
//
//   node tools/ci/android-verify.mjs --out out [--label ci-test] [--expect-cert <sha256>]
//
// Universal APK: signed (apksigner, v2+ scheme), package id, versionName and
//   versionCode as configured, the four ABIs present, the 64-bit native
//   libraries aligned for 16 KB memory pages (ELF segments and zip alignment).
// AAB: signed (jarsigner), same id/version (bundletool), the four ABIs.
// Writes out/TRACKLANDS-<version>-android-universal.apk and
//        out/TRACKLANDS-<version>-android.aab (+ "-<label>" for test builds),
// and out/android-verify.json with what was checked.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import zlib from 'zlib';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { versionCode } from '../version.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : undefined; };
const outDir = path.resolve(opt('out') || 'out');
const label = opt('label');
const expectCert = opt('expect-cert');
fs.mkdirSync(outDir, { recursive: true });
const SDK = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
if (!SDK) throw new Error('ANDROID_HOME not set');
const bt = fs.readdirSync(path.join(SDK, 'build-tools')).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop();
const tool = (n) => path.join(SDK, 'build-tools', bt, n);
const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const conf = JSON.parse(fs.readFileSync(path.join(ROOT, 'src-tauri/tauri.conf.json'), 'utf8'));
const want = { id: conf.identifier, versionName: version, versionCode: versionCode(version) };
const ABIS = ['arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64'];
const gen = path.join(ROOT, 'src-tauri/gen/android/app/build/outputs');
const apk = path.join(gen, 'apk/universal/release/app-universal-release.apk');
const aab = path.join(gen, 'bundle/universalRelease/app-universal-release.aab');
const report = { version, want, checks: [] };
const problems = [];
const check = (ok, what, detail = '') => { report.checks.push({ ok, what, detail }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ' — ' + detail : ''}`); if (!ok) problems.push(what); };

// minimal zip reader (central directory) for listing and extracting entries
function zipEntries(file) {
  const b = fs.readFileSync(file);
  let e = b.length - 22; while (e >= 0 && b.readUInt32LE(e) !== 0x06054b50) e--;
  const n = b.readUInt16LE(e + 10); let p = b.readUInt32LE(e + 16);
  const out = [];
  for (let i = 0; i < n; i++) {
    const method = b.readUInt16LE(p + 10), csize = b.readUInt32LE(p + 20), nameLen = b.readUInt16LE(p + 28), extra = b.readUInt16LE(p + 30), comment = b.readUInt16LE(p + 32), off = b.readUInt32LE(p + 42);
    const name = b.toString('utf8', p + 46, p + 46 + nameLen);
    const lnl = b.readUInt16LE(off + 26), lex = b.readUInt16LE(off + 28), dataOff = off + 30 + lnl + lex;
    out.push({ name, method, dataOff, data: () => { const raw = b.subarray(dataOff, dataOff + csize); return method === 8 ? zlib.inflateRawSync(raw) : raw; } });
    p += 46 + nameLen + extra + comment;
  }
  return out;
}
// smallest p_align over PT_LOAD segments of an ELF file
function elfLoadAlign(buf) {
  const is64 = buf[4] === 2, le = buf[5] === 1;
  const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o)), u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  const u64 = (o) => Number(le ? buf.readBigUInt64LE(o) : buf.readBigUInt64BE(o));
  const phoff = is64 ? u64(0x20) : u32(0x1c), phentsize = u16(is64 ? 0x36 : 0x2a), phnum = u16(is64 ? 0x38 : 0x2c);
  let min = Infinity;
  for (let i = 0; i < phnum; i++) {
    const o = phoff + i * phentsize;
    if (u32(o) !== 1) continue; // PT_LOAD
    min = Math.min(min, is64 ? u64(o + 0x30) : u32(o + 0x1c));
  }
  return min;
}

// ---- APK ----
check(fs.existsSync(apk), 'universal release APK built', path.relative(ROOT, apk));
if (fs.existsSync(apk)) {
  let certs = '';
  try { certs = run(tool('apksigner'), ['verify', '--verbose', '--print-certs', apk]); check(/Verified using v2 scheme \(APK Signature Scheme v2\): true|Verified using v3 scheme.*: true/.test(certs), 'APK signature verifies (apksigner, v2/v3 scheme)'); } catch (e) { check(false, 'APK signature verifies (apksigner)', (e.stderr || e.message).split('\n')[0]); }
  const sha = (certs.match(/Signer #1 certificate SHA-256 digest: ([0-9a-f]+)/) || [])[1];
  report.apkCertSha256 = sha || null;
  if (expectCert) check(sha === expectCert.toLowerCase().replace(/:/g, ''), 'APK signed with the expected release certificate', sha || 'none');
  const badging = run(tool('aapt2'), ['dump', 'badging', apk]);
  const pkg = /package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/.exec(badging) || [];
  check(pkg[1] === want.id, 'APK package id', `${pkg[1]} (expected ${want.id})`);
  check(pkg[3] === want.versionName && +pkg[2] === want.versionCode, 'APK versionName and versionCode', `${pkg[3]} / ${pkg[2]} (expected ${want.versionName} / ${want.versionCode})`);
  const sdk = { min: (badging.match(/(?:minSdkVersion|sdkVersion):'(\d+)'/) || [])[1], target: (badging.match(/targetSdkVersion:'(\d+)'/) || [])[1] };
  report.apkSdk = sdk;
  check(!!sdk.min && !!sdk.target, 'APK min / target SDK', `minSdk ${sdk.min}, targetSdk ${sdk.target}`);
  check(/application-label:'TRACKLANDS'/.test(badging), 'APK app name TRACKLANDS');
  check(!/application-debuggable/.test(badging), 'APK is a release build (not debuggable)');
  const ents = zipEntries(apk);
  const libs = ents.filter((e) => /^lib\/[^/]+\/.+\.so$/.test(e.name));
  const abis = [...new Set(libs.map((e) => e.name.split('/')[1]))].sort();
  report.apkAbis = abis;
  check(ABIS.every((a) => abis.includes(a)), 'APK contains all four ABIs', abis.join(', '));
  // 16 KB memory pages exist only on 64-bit devices, so the 64-bit libraries
  // must be 16 KB aligned (NDK r28+ does this by default). 32-bit libraries
  // only ever run with 4 KB pages; they need 4 KB, and the value is recorded.
  const misaligned = [];
  report.libAlign = {};
  for (const l of libs) {
    const abi = l.name.split('/')[1];
    const need = /64/.test(abi) ? 16384 : 4096;
    const al = elfLoadAlign(l.data());
    report.libAlign[l.name] = al;
    if (al < need) misaligned.push(`${l.name} (ELF align ${al}, needs ${need})`);
    if (l.method === 0 && l.dataOff % need !== 0) misaligned.push(`${l.name} (zip offset ${l.dataOff}, needs ${need})`);
  }
  check(misaligned.length === 0, 'native libraries page-aligned: 16 KB for 64-bit ABIs, 4 KB for 32-bit (ELF PT_LOAD and uncompressed zip offset)', misaligned.slice(0, 4).join('; ') || `${libs.length} libraries`);
  const name = `TRACKLANDS-${version}-android-universal${label ? '-' + label : ''}.apk`;
  fs.copyFileSync(apk, path.join(outDir, name));
  report.apk = { name, bytes: fs.statSync(apk).size, sha256: crypto.createHash('sha256').update(fs.readFileSync(apk)).digest('hex') };
}

// ---- AAB ----
check(fs.existsSync(aab), 'release AAB built', path.relative(ROOT, aab));
if (fs.existsSync(aab)) {
  try {
    const v = run('jarsigner', ['-verify', '-verbose', '-certs', aab]);
    check(/jar verified\./.test(v) && !/unsigned/i.test(v.split('jar verified')[0].slice(-200)), 'AAB signature verifies (jarsigner)');
  } catch (e) { check(false, 'AAB signature verifies (jarsigner)', (e.stdout || e.message).split('\n').slice(-3).join(' ')); }
  const ents = zipEntries(aab);
  const abis = [...new Set(ents.filter((e) => /^base\/lib\/[^/]+\/.+\.so$/.test(e.name)).map((e) => e.name.split('/')[2]))].sort();
  report.aabAbis = abis;
  check(ABIS.every((a) => abis.includes(a)), 'AAB contains all four ABIs', abis.join(', '));
  const bundletool = process.env.BUNDLETOOL_JAR;
  if (bundletool && fs.existsSync(bundletool)) {
    const man = run('java', ['-jar', bundletool, 'dump', 'manifest', '--bundle', aab]);
    const id = (man.match(/package="([^"]+)"/) || [])[1], vc = (man.match(/android:versionCode="(\d+)"/) || [])[1], vn = (man.match(/android:versionName="([^"]+)"/) || [])[1];
    check(id === want.id, 'AAB package id (bundletool)', id);
    check(vn === want.versionName && +vc === want.versionCode, 'AAB versionName and versionCode (bundletool)', `${vn} / ${vc}`);
  } else check(false, 'AAB manifest read with bundletool', 'BUNDLETOOL_JAR not set');
  const name = `TRACKLANDS-${version}-android${label ? '-' + label : ''}.aab`;
  fs.copyFileSync(aab, path.join(outDir, name));
  report.aab = { name, bytes: fs.statSync(aab).size, sha256: crypto.createHash('sha256').update(fs.readFileSync(aab)).digest('hex') };
}

fs.writeFileSync(path.join(outDir, 'android-verify.json'), JSON.stringify(report, null, 2) + '\n');
if (problems.length) { console.error(`\nAndroid verification failed: ${problems.length} problem(s)`); process.exit(1); }
console.log('\nAndroid packages verified');
