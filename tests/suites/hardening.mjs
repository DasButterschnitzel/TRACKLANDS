// Phase 9 browser hardening, tested without real devices (all emulation):
//  - the graphics reset by the browser (WEBGL_lose_context): the game saves at
//    once, says so, and after the context is back reloads straight into it
//  - no WebGL: a clear message instead of a crash
//  - no IndexedDB, a full localStorage, no service worker: the game still
//    starts, saves and loads
//  - audio: the voice budget holds under a flood of sounds, mute, suspend on
//    hide and resume on show, unlock only after a gesture
//  - a real 4.0.0 save (tests/fixtures/save-4.0.0.json, made with the 4.0.0
//    release) loads and runs in this build
//  - an update between two builds: the new release installs in the
//    background, the game offers it, switches after saving, and only the new
//    cache is left (never a mix of old and new files)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPage, loadSave, ENGINE } from '../lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.md': 'text/markdown', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg' };

// a static server whose "release" can be switched: build B differs from A by
// its version and service-worker cache name, like two published releases
function releaseServer() {
  const st = { build: 'A' };
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    let body = fs.readFileSync(f);
    if (st.build === 'B' && (p === '/service-worker.js' || p === '/src/config.js')) {
      body = Buffer.from(body.toString().replace(/const CACHE = 'tracklands-([^']+)'/, "const CACHE = 'tracklands-$1-b'").replace(/GAME_VERSION = '([^']+)'/, "GAME_VERSION = '$1-b'"));
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(body);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, st, url: `http://127.0.0.1:${server.address().port}` })));
}

export const name = 'hardening';
export async function run({ browser, base }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  lines.push(`engine ${ENGINE} (emulated conditions, not real devices)`);

  // ---- the graphics reset: save, message, resume ----
  {
    const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 1100, height: 700 } });
    const r1 = await page.evaluate(async () => {
      const app = window.__tracklands;
      app.startGame({ seed: 919191, difficulty: 'standard', paused: true, rivals: 0 });
      while (!(app.game && app.game.running)) await new Promise((res) => setTimeout(res, 50));
      const g = app.game; g.tutorial.skip();
      for (let k = 0; k < 900; k++) g.tick(1 / 30);
      const t = g.time;
      const ext = app.renderer.getContext().getExtension('WEBGL_lose_context');
      if (!ext) return { skip: true };
      window.__ext = ext;
      ext.loseContext();
      await new Promise((res) => setTimeout(res, 300));
      const saved = JSON.parse(localStorage.getItem('tracklands.save') || 'null');
      return { t, savedT: saved && saved.time, seed: saved && saved.seed, toast: document.getElementById('toasts').textContent, flag: sessionStorage.getItem('tracklands.resume') };
    });
    if (r1.skip) lines.push('     (WEBGL_lose_context not available in this engine: graphics reset not tested)');
    else {
      check(r1.savedT >= r1.t - 1 && r1.flag === '1' && r1.toast.length > 10, `graphics reset: the game was saved at ${Math.round(r1.savedT)} s and the player told (“${r1.toast.slice(0, 60)}…”)`);
      await Promise.all([page.waitForEvent('load', { timeout: 30000 }).catch(() => null), page.evaluate(() => window.__ext.restoreContext())]);
      await page.waitForFunction(() => window.__tracklands && window.__tracklands.game && window.__tracklands.game.running, null, { timeout: 60000 }).catch(() => null);
      const r2 = await page.evaluate(() => { const g = window.__tracklands.game; return g ? { seed: g.world.seed, t: g.time } : null; });
      check(!!r2 && r2.seed === r1.seed && r2.t >= r1.savedT - 1, `after the graphics come back the game reloads straight into the save (seed ${r2 && r2.seed}, ${r2 ? Math.round(r2.t) : '-'} s)`);
    }
    await page.evaluate(() => { localStorage.clear(); });
    if (errors.filter((e) => !/WebGL|context/i.test(e)).length) { ok = false; lines.push('errors: ' + errors.slice(0, 3).join(' | ')); }
    await ctx.close();
  }

  // ---- broken browser environments ----
  const env = async (label, init, fn) => {
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
    await ctx.addInitScript(init);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base + '/index.html');
    await page.waitForTimeout(2500);
    const r = await page.evaluate(fn).catch((e) => ({ error: e.message }));
    await ctx.close();
    return { r, errors };
  };
  const noGl = await env('no WebGL', () => { const o = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (k, a) { return /webgl/.test(k) ? null : o.call(this, k, a); }; },
    () => ({ text: (document.getElementById('loading') || {}).textContent || '' }));
  check(/WebGL/i.test(noGl.r.text) && !noGl.errors.length, `no WebGL: a clear message (“${noGl.r.text.trim().slice(0, 60)}”), no crash`);
  const playable = async () => {
    const app = window.__tracklands;
    if (!app || !app.renderer) return { boot: false };
    app.startGame({ seed: 4242, difficulty: 'standard', paused: true, rivals: 0 });
    for (let i = 0; i < 200 && !(app.game && app.game.running); i++) await new Promise((res) => setTimeout(res, 50));
    const g = app.game; if (!g) return { boot: true, game: false };
    for (let k = 0; k < 60; k++) g.tick(1 / 30);
    await app.store.put('main', g.serialize());
    const back = await app.store.get('main');
    return { boot: true, game: true, saved: !!back && back.seed === g.world.seed, useLS: app.store.useLS };
  };
  const noIdb = await env('no IndexedDB', () => { Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true }); }, playable);
  check(noIdb.r.game && noIdb.r.saved && noIdb.r.useLS && !noIdb.errors.length, 'no IndexedDB: the game starts and saves to localStorage instead');
  const fullLs = await env('full localStorage', () => { Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError'); }; }, playable);
  check(fullLs.r.game && fullLs.r.saved && !fullLs.errors.length, 'a full localStorage (quota exceeded): the game starts and saves to IndexedDB');
  const noSw = await env('no service worker', () => { Object.defineProperty(navigator, 'serviceWorker', { value: undefined, configurable: true }); }, playable);
  check(noSw.r.game && !noSw.errors.length, 'no service worker: the game starts (online only)');

  // ---- audio ----
  {
    const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 1000, height: 700 } });
    const before = await page.evaluate(() => { const A = window.__tracklands.audio; return { ctx: A.ctx ? A.ctx.state : 'none' }; });
    await page.mouse.click(500, 350);
    await page.waitForTimeout(300);
    const a = await page.evaluate(async () => {
      const app = window.__tracklands, A = app.audio, out = {};
      out.after = A.ctx ? A.ctx.state : 'none';
      for (let k = 0; k < 600; k++) A.play(['click', 'rail', 'whistle', 'coins'][k % 4]);
      out.voices = A.voices.length; out.limit = A.voiceLimit ? A.voiceLimit() : 16;
      app.setSetting('volMaster', 0);
      await new Promise((res) => setTimeout(res, 400));      // (volume changes fade over ~50 ms)
      out.muted = A.master ? A.master.gain.value : 0;
      app.setSetting('volMaster', 0.8);
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange'));
      await new Promise((res) => setTimeout(res, 200));
      out.hidden = A.ctx ? A.ctx.state : 'none';
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange'));
      await new Promise((res) => setTimeout(res, 200));
      out.shown = A.ctx ? A.ctx.state : 'none';
      delete document.hidden;
      return out;
    });
    // (a bare AudioContext started from a real click: if even that stays
    // suspended, this environment has no audio output and audio cannot be tested here)
    const probe = a.after === 'running' ? 'running' : await (async () => {
      await page.evaluate(() => { const b = document.createElement('button'); b.id = 'ac-probe'; b.style.cssText = 'position:fixed;left:0;top:0;width:80px;height:40px;z-index:99999'; b.onclick = () => { window.__probeCtx = new AudioContext(); window.__probeCtx.resume().catch(() => {}); }; document.body.appendChild(b); });
      await page.click('#ac-probe'); await page.waitForTimeout(500);
      return page.evaluate(() => window.__probeCtx ? window.__probeCtx.state : 'none');
    })();
    if (probe !== 'running') lines.push(`     NOT TESTED: audio — this ${ENGINE} environment has no audio output (even a bare AudioContext stays ${probe} after a click)`);
    else {
      check(before.ctx !== 'running' && a.after === 'running', `audio starts only after a gesture (${before.ctx} → ${a.after})`);
      check(a.voices <= Math.max(24, a.limit), `600 sounds at once keep ${a.voices} voices (budget ${a.limit})`);
      check(a.muted < 0.01 && a.hidden === 'suspended' && a.shown === 'running', `mute silences (gain ${a.muted}); hidden page suspends audio, visible resumes (${a.hidden} → ${a.shown})`);
    }
    lines.push('     (acoustic quality on real speakers is not tested)');
    if (errors.length) { ok = false; lines.push('errors: ' + errors.slice(0, 3).join(' | ')); }
    await ctx.close();
  }

  // ---- a real 4.0.0 save ----
  {
    const fx = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'save-4.0.0.json'), 'utf8'));
    const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 1000, height: 700 } });
    await loadSave(page, fx);
    const r = await page.evaluate(() => {
      const g = window.__tracklands.game;
      for (let k = 0; k < 600; k++) g.tick(1 / 30);
      const d = g.serialize();
      return { trains: g.trains.trains.length, rivals: g.rivals.list.map((x) => x.id).join(','), stations: g.stations.list.length, time: Math.round(g.time), ownerless: g.trains.trains.every((t) => !t.owner), save: d.saveVersion };
    });
    check(r.trains === fx.trains.length && r.stations === fx.stations.stations.length && r.rivals === fx.rivals.map((x) => x.id).join(',') && r.ownerless, `a 4.0.0 save loads and runs: ${r.trains} trains, ${r.stations} stations, companies ${r.rivals}, all trains the player's`);
    if (errors.length) { ok = false; lines.push('errors: ' + errors.slice(0, 3).join(' | ')); }
    await ctx.close();
  }

  // ---- an update between two builds (Chromium: service worker control in tests) ----
  if (ENGINE === 'chromium') {
    const R = await releaseServer();
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(R.url + '/index.html');
    await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 60000 }).catch(() => null);
    await page.reload();
    await page.waitForFunction(() => window.__tracklands && window.__tracklands.ui, null, { timeout: 60000 });
    const a = await page.evaluate(async () => ({ keys: await caches.keys(), v: (await import('./src/config.js')).GAME_VERSION }));
    R.st.build = 'B';
    await page.evaluate(async () => { const reg = await navigator.serviceWorker.getRegistration(); await reg.update(); });
    await page.waitForSelector('#update-ready .btn', { timeout: 60000 }).catch(() => null);
    const offered = await page.$('#update-ready .btn');
    if (offered) await Promise.all([page.waitForEvent('load', { timeout: 30000 }).catch(() => null), offered.click()]);
    await page.waitForFunction(() => window.__tracklands && window.__tracklands.ui, null, { timeout: 60000 }).catch(() => null);
    await page.waitForTimeout(1000);
    const b = await page.evaluate(async () => ({ keys: await caches.keys(), v: (await import('./src/config.js')).GAME_VERSION }));
    const oneCache = b.keys.filter((k) => k.startsWith('tracklands-')).length === 1 && b.keys[0].endsWith('-b');
    check(!!offered && b.v.endsWith('-b') && !a.v.endsWith('-b') && oneCache, `update between two builds: offered, switched (${a.v} → ${b.v}), one cache left (${b.keys.join(', ')})`);
    if (errors.length) { ok = false; lines.push('errors: ' + errors.slice(0, 3).join(' | ')); }
    await ctx.close();
    R.server.close();
  } else lines.push('     (update between builds: tested in Chromium)');
  return { ok, lines };
}
