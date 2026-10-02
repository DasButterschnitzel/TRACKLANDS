// Release packaging and the native (Tauri) shell, checked from the browser:
// - the staged web and native trees hold exactly the runtime files, every
//   reference resolves inside them, development folders are absent, the
//   native tree has no service worker; the web zip is reproducible;
// - music is optional and any file put into assets/music/ ships automatically;
// - the native build, run with the Tauri globals present, registers no
//   service worker, exports through the native save dialog and handles the
//   Android Back button in Escape order;
// - the wrapper changes nothing in the simulation: the production save, run
//   for the same ticks with the same random sequence, serialises identically
//   in the repository, the staged web build and the staged native build.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { ROOT, startServer, productionSave } from '../lib.mjs';
import { runtimeFiles } from '../../tools/runtime-files.mjs';
import { stage, verify, zipDir } from '../../tools/build-web.mjs';
import * as V from '../../tools/version.mjs';

export const name = 'nativebuild';

// fake Tauri globals: just enough of the injected API to watch the adapter
const FAKE_TAURI = () => {
  window.__TAURI_INTERNALS__ = {};
  window.isTauri = true;
  window.__nat = { saves: [], writes: [], back: null, exited: false };
  window.__TAURI__ = {
    dialog: { save: async (o) => { window.__nat.saves.push(o); return '/picked/' + o.defaultPath; } },
    fs: { writeTextFile: async (p, d) => { window.__nat.writes.push({ p, n: d.length }); }, writeFile: async (p, d) => { window.__nat.writes.push({ p, n: d.length }); } },
    app: { onBackButtonPress: async (h) => { window.__nat.back = h; return { unregister() {} }; }, exit: async () => { window.__nat.exited = true; } },
  };
};
// the Tauri API arriving after the game's modules have run (seen on Android)
const LATE_TAURI = () => {
  window.__TAURI_INTERNALS__ = {};
  window.__late = { back: null };
  // only once the title screen is up, i.e. well after main.js asked for Back
  const inject = () => { if (!(window.__tracklands && window.__tracklands.title)) { setTimeout(inject, 50); return; } window.__late.missingAtStart = !window.__TAURI__; setTimeout(() => { window.__TAURI__ = { app: { onBackButtonPress: async (h) => { window.__late.back = h; return { unregister() {} }; }, exit: async () => {} } }; }, 500); };
  inject();
};
// a registration that fails on the JS side but still reached Android: the
// retry leaves two listeners, both called on every Back
const FLAKY_REGISTER = () => {
  window.isTauri = true;
  window.__flaky = { listeners: [], exited: false };
  window.__TAURI__ = { app: {
    onBackButtonPress: async (h) => { window.__flaky.listeners.push(h); if (window.__flaky.listeners.length === 1) throw new Error('ipc not ready'); return { unregister() {} }; },
    exit: async () => { window.__flaky.exited = true; },
  } };
};
// the first registration reaches Android but its answer never comes back
const HUNG_REGISTER = () => {
  window.isTauri = true;
  window.__flaky = { listeners: [], exited: false };
  window.__TAURI__ = { app: {
    onBackButtonPress: (h) => { window.__flaky.listeners.push(h); return window.__flaky.listeners.length === 1 ? new Promise(() => {}) : Promise.resolve({ unregister() {} }); },
    exit: async () => { window.__flaky.exited = true; },
  } };
};
const SEEDED_RANDOM = () => {
  let s = 20261002;
  Math.random = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
};

export async function run({ browser }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };

  // ---- staging ----
  const web = stage('web', { sha: 'abcdef1' }), nat = stage('native', { sha: 'abcdef1' });
  const rel = (dir) => { const w = (d) => fs.readdirSync(path.join(dir, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? w(path.posix.join(d, e.name)) : [path.posix.join(d, e.name)])); return w('.').map((f) => f.replace(/^\.\//, '')).sort(); };
  const wf = rel(web.out), nf = rel(nat.out);
  check(wf.length === runtimeFiles().length + 1 && wf.includes('service-worker.js'), `web build = runtime list + service worker (${wf.length} files)`);
  check(nf.length === runtimeFiles().length && !nf.includes('service-worker.js'), `native build = runtime list, no service worker (${nf.length} files)`);
  check(!nf.some((f) => /^(tests|trailer|docs|tools|\.github|node_modules|src-tauri)\//.test(f)), 'no development folders in the native build');
  check(fs.readFileSync(path.join(nat.out, 'src/buildinfo.js'), 'utf8').includes("sha: 'abcdef1'"), 'the staged build carries the commit');
  check(verify(nat.out, 'native').length === 0 && verify(web.out, 'web').length === 0, 'every module import, stylesheet and page reference resolves in the staged trees');
  // a broken reference is caught
  fs.writeFileSync(path.join(nat.out, 'src/zz-broken.js'), 'imp' + "ort { x } from './does-not-exist.js';\n");
  check(verify(nat.out, 'native').some((p) => p.includes('does-not-exist')), 'a missing module in the staged tree is reported');
  fs.unlinkSync(path.join(nat.out, 'src/zz-broken.js'));
  // music: optional, and new files ship without any change
  const probe = path.join(ROOT, 'assets/music/zz-probe-track.ogg');
  try {
    fs.writeFileSync(probe, 'probe');
    check(runtimeFiles().includes('assets/music/zz-probe-track.ogg'), 'a file put into assets/music/ is in the runtime list (no configuration)');
  } finally { fs.rmSync(probe, { force: true }); }
  const mj = path.join(nat.out, 'assets/music/music.json');
  const mjOrig = fs.readFileSync(mj, 'utf8');
  fs.writeFileSync(mj, JSON.stringify({ tracks: [{ title: 'x', file: 'missing.ogg' }] }));
  check(verify(nat.out, 'native').some((p) => p.includes('missing.ogg')), 'a playlist entry without its file is reported');
  fs.writeFileSync(mj, mjOrig);
  // reproducible zip
  const z1 = zipDir(web.out, path.join(ROOT, 'dist', 'zz-a.zip'), 'T'), z2 = zipDir(web.out, path.join(ROOT, 'dist', 'zz-b.zip'), 'T');
  check(z1.sha256 === z2.sha256 && z1.entries === wf.length, `the web zip is byte-identical across runs (${z1.sha256.slice(0, 12)}…)`);
  fs.rmSync(path.join(ROOT, 'dist', 'zz-a.zip')); fs.rmSync(path.join(ROOT, 'dist', 'zz-b.zip'));

  // ---- one version everywhere: a drifted declaration and a wrong tag are caught ----
  const v0 = V.check();
  check(v0.problems.length === 0, `all version declarations agree (${v0.version}): ${v0.problems.join('; ') || 'ok'}`);
  const cargoToml = path.join(ROOT, 'src-tauri/Cargo.toml'), cargoOrig = fs.readFileSync(cargoToml, 'utf8');
  try {
    fs.writeFileSync(cargoToml, cargoOrig.replace(/^(\[package\][^[]*?^version\s*=\s*)"[^"]+"/m, '$1"0.0.1"'));
    check(V.check().problems.some((p) => p.includes('Cargo.toml')), 'a drifted Cargo.toml version fails the version check');
  } finally { fs.writeFileSync(cargoToml, cargoOrig); }
  check(V.check('v0.0.0').problems.some((p) => p.includes('tag')), 'a release tag that is not the version fails the check');
  check(V.versionCode('6.2.0-rc.1') < V.versionCode('6.2.0-rc.2') && V.versionCode('6.2.0-rc.2') < V.versionCode('6.2.0') && V.versionCode('6.2.0') < V.versionCode('6.2.1'), 'Android versionCodes increase: rc.1 < rc.2 < final < next patch');

  // ---- the native build in a browser with the Tauri globals ----
  const sNat = await startServer(nat.out), sWeb = await startServer(web.out), sRepo = await startServer(ROOT);
  const save = productionSave();
  const fingerprint = async (base, native) => {
    const ctx0 = await browser.newContext({ viewport: { width: 1100, height: 700 } });
    await ctx0.addInitScript(SEEDED_RANDOM);
    if (native) await ctx0.addInitScript(FAKE_TAURI);
    const page = await ctx0.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base + '/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => window.__tracklands && window.__tracklands.renderer && window.__tracklands.title, null, { timeout: 90000 });
    await page.evaluate((sv) => { const app = window.__tracklands; document.querySelectorAll('.modal-wrap').forEach((m) => m.remove()); app.startGame({ save: sv, test: true, paused: true }); }, JSON.parse(JSON.stringify(save)));
    await page.waitForFunction(() => window.__tracklands.game && window.__tracklands.game.running, null, { timeout: 90000, polling: 250 });
    await page.evaluate(() => document.querySelectorAll('.modal-wrap').forEach((m) => m.remove()));
    const fp = await page.evaluate(() => {
      const g = window.__tracklands.game;
      for (let k = 0; k < 2400; k++) g.tick(1 / 20);
      const s = g.serialize(); delete s.savedAt;
      return { json: JSON.stringify(s), coins: Math.round(g.economy.coins), trains: g.trains.trains.length, pop: g.towns.list.reduce((n, t) => n + (t.pop || 0), 0) };
    });
    const extra = native ? await page.evaluate(() => ({ sw: navigator.serviceWorker ? navigator.serviceWorker.controller : null, regs: navigator.serviceWorker ? (navigator.serviceWorker.getRegistrations ? 'n/a' : 'n/a') : 'n/a' })) : null;
    return { page, ctx: ctx0, fp: { ...fp, hash: crypto.createHash('sha256').update(fp.json).digest('hex') }, errors, extra };
  };
  // one game at a time: each page is closed once its part is done, so a slow
  // CI runner never renders three production saves at once
  const done = async (x) => { if (x.errors.length) { ok = false; lines.push('errors: ' + x.errors.slice(0, 3).join(' | ')); } await x.ctx.close(); };
  const a = await fingerprint(sRepo.url, false);
  await done(a);
  const b = await fingerprint(sWeb.url, false);
  // the web build keeps the service worker
  const wsw = await b.page.evaluate(async () => { for (let i = 0; i < 100; i++) { if ((await navigator.serviceWorker.getRegistrations()).length) return true; await new Promise((r) => setTimeout(r, 100)); } return false; });
  await done(b);
  const c = await fingerprint(sNat.url, true);
  check(a.fp.hash === b.fp.hash && a.fp.hash === c.fp.hash, `same simulation in repository, web build and native build after 120 s of play (${a.fp.hash.slice(0, 12)}…; coins ${a.fp.coins}/${b.fp.coins}/${c.fp.coins}, population ${a.fp.pop}/${c.fp.pop})`);

  // native behaviour (page c runs the native build with the fake Tauri API)
  const page = c.page;
  const regs = await page.evaluate(async () => (navigator.serviceWorker ? (await navigator.serviceWorker.getRegistrations()).length : 0));
  check(regs === 0, `the native build registers no service worker (${regs})`);
  const plat = await page.evaluate(async () => { const P = await import('./src/platform.js'); return { native: P.isNative(), label: P.buildLabel('9.9.9') }; });
  check(plat.native && plat.label.includes('Build abcdef1'), `the native build knows it is native and shows its build (${plat.label})`);
  const exp = await page.evaluate(async () => { const S = await import('./src/save/Save.js'); await S.downloadJSON({ a: 1 }, 'tracklands-test.json'); return window.__nat; });
  check(exp.saves.length === 1 && exp.saves[0].defaultPath === 'tracklands-test.json' && exp.writes.length === 1 && exp.writes[0].p === '/picked/tracklands-test.json', 'a save export goes through the native save dialog and file write');
  const back = await page.evaluate(async () => {
    const app = window.__tracklands, g = app.game, n = window.__nat, out = [];
    if (!n.back) return { missing: true };
    app.ui.openPanel('finance'); n.back({ canGoBack: false }); out.push(app.ui.panel === null);
    g.construction.setTool('track'); n.back({ canGoBack: false }); out.push(g.construction.tool === 'select');
    g.layerView.set('underground'); n.back({ canGoBack: false }); out.push(g.layerView.mode === 'surface');
    n.back({ canGoBack: false }); out.push(!n.exited && !!document.querySelector('#toasts .toast'));
    n.back({ canGoBack: false }); out.push(n.exited);
    return { out };
  });
  check(!back.missing && back.out.every(Boolean), `Android Back closes the panel, puts the tool down, leaves the underground view, then asks once and only then exits (${JSON.stringify(back)})`);
  check(wsw, 'the web build still registers its service worker');
  // Back must still be taken over when the Tauri API is injected late
  {
    const ctxL = await browser.newContext({ viewport: { width: 900, height: 600 } });
    await ctxL.addInitScript(LATE_TAURI);
    const pl = await ctxL.newPage();
    await pl.goto(sNat.url + '/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await pl.waitForFunction(() => window.__tracklands && window.__tracklands.title, null, { timeout: 90000 });
    const late = await pl.evaluate(async () => ({ missingAtStart: window.__late.missingAtStart, ready: await window.__tracklands.nativeBackReady, hooked: typeof window.__late.back === 'function', sw: navigator.serviceWorker ? (await navigator.serviceWorker.getRegistrations()).length : 0 }));
    check(late.missingAtStart === true && late.ready === true && late.hooked && late.sw === 0, `Android Back is taken over even when the Tauri API arrives after the game started (${JSON.stringify(late)})`);
    await ctxL.close();
  }
  // one Back is one press, even with two listeners left by a retried registration
  for (const [name, script] of [['failed', FLAKY_REGISTER], ['unanswered', HUNG_REGISTER]]) {
    const ctxF = await browser.newContext({ viewport: { width: 900, height: 600 } });
    await ctxF.addInitScript(script);
    const pf = await ctxF.newPage();
    await pf.goto(sNat.url + '/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await pf.waitForFunction(() => window.__tracklands && window.__tracklands.title, null, { timeout: 90000 });
    const fl = await pf.evaluate(async () => {
      const ready = await window.__tracklands.nativeBackReady;
      const f = window.__flaky, press = () => f.listeners.forEach((h) => h({ canGoBack: false }));
      press(); const afterOne = f.exited;
      press(); return { ready, listeners: f.listeners.length, afterOne, afterTwo: f.exited };
    });
    check(fl.ready === true && fl.listeners === 2 && fl.afterOne === false && fl.afterTwo === true, `one Back is one press when a retried registration (first try ${name}) left two listeners: the first only asks, the second leaves (${JSON.stringify(fl)})`);
    await ctxF.close();
  }
  await done(c);
  sNat.server.close(); sWeb.server.close(); sRepo.server.close();
  return { ok, lines };
}
