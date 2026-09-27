// Cross-browser smoke (Phase 9): the same flows in Chromium, Firefox and
// WebKit (BROWSER=firefox|webkit; Firefox needs a display, run it under
// xvfb-run). Desktop, phone and tablet viewports at device pixel ratios 1,
// 1.5, 2 and 3; touch taps never build; turning the device; reduced motion;
// IndexedDB/localStorage; save and load; hiding and showing the page.
// Everything here is emulation in a desktop browser engine, not a real device.
import { openPage, startTestGame, loadSave, ENGINE } from '../lib.mjs';

const VIEWS = [
  { id: 'desktop', viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 },
  { id: 'desktop-1.5x', viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 },
  { id: 'phone-3x', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, mobile: true },
  { id: 'tablet-2x', viewport: { width: 1024, height: 768 }, deviceScaleFactor: 2, hasTouch: true, mobile: true },
];

export const name = 'xbrowser';
export async function run({ browser, base, quick }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  lines.push(`engine ${ENGINE} ${browser.version()} (emulated viewports, not real devices)`);
  for (const v of quick ? [VIEWS[0], VIEWS[2]] : VIEWS) {
    const opts = { viewport: v.viewport, deviceScaleFactor: v.deviceScaleFactor, hasTouch: !!v.hasTouch, reducedMotion: v.id.startsWith('phone') ? 'reduce' : 'no-preference' };
    if (v.mobile && ENGINE !== 'firefox') opts.isMobile = true;       // Firefox has no mobile emulation
    const { ctx, page, errors } = await openPage(browser, base, opts);
    await startTestGame(page, 3301);
    const r = await page.evaluate(async () => {
      const app = window.__tracklands, g = app.game, out = {};
      for (let f = 0; f < 20; f++) g.frame(1 / 30);
      const cv = app.renderer.domElement;
      out.canvas = [cv.width, cv.height, innerWidth, innerHeight, devicePixelRatio];
      out.overflow = document.documentElement.scrollWidth > innerWidth + 1;
      out.hud = !document.getElementById('hud').hidden;
      // panels open and close
      out.panels = [];
      for (const p of ['finance', 'trains', 'settings', 'lists']) { g.ui.openPanel(p); await new Promise((res) => setTimeout(res, 30)); out.panels.push(!!document.querySelector('#panel:not([hidden])')); g.ui.closePanel(); }
      // storage round trip (IndexedDB, or localStorage where IndexedDB is missing)
      await app.store.put('xb_probe', { a: 1 });
      const got = await app.store.get('xb_probe');
      out.store = !!(got && got.a === 1); out.idb = !!app.store.db && !app.store.useLS;
      await app.store.remove('xb_probe');
      out.towns = g.towns.list.length;
      out.save = JSON.parse(JSON.stringify(g.serialize()));
      return out;
    });
    const [cw, ch, iw, ih, dpr] = r.canvas;
    check(cw > 0 && ch > 0 && !r.overflow && r.hud && r.panels.every(Boolean), `${v.id}: canvas ${cw}×${ch} for ${iw}×${ih} @${dpr}x, no page overflow, HUD and four panels`);
    check(r.store, `${v.id}: saves stored in ${r.idb ? 'IndexedDB' : 'localStorage'}`);
    if (v.hasTouch) {
      // a tap with the track tool picks a start point and never builds by itself
      const tap = await page.evaluate(() => { const g = window.__tracklands.game; g.construction.setTool('track'); let n = 0; for (const c of g.net.conn) if (c) n++; return n; });
      await page.touchscreen.tap(v.viewport.width / 2, v.viewport.height / 2);
      await page.touchscreen.tap(v.viewport.width / 2 + 60, v.viewport.height / 2 + 20);
      const after = await page.evaluate(() => { const g = window.__tracklands.game; for (let f = 0; f < 5; f++) g.frame(1 / 30); let n = 0; for (const c of g.net.conn) if (c) n++; g.construction.setTool('select'); return n; });
      check(after === tap, `${v.id}: two taps with the track tool build nothing on their own (${tap} → ${after} track tiles)`);
      // turn the device
      await page.setViewportSize({ width: v.viewport.height, height: v.viewport.width });
      await page.waitForFunction((w) => innerWidth === w && document.getElementById('view').clientWidth === w, v.viewport.height, { timeout: 3000 }).catch(() => {});
      const rot = await page.evaluate(() => { const app = window.__tracklands; app.game.frame(1 / 30); const cv = app.renderer.domElement; return { w: cv.clientWidth, h: cv.clientHeight, iw: innerWidth, ih: innerHeight, over: document.documentElement.scrollWidth > innerWidth + 1 }; });
      check(Math.abs(rot.w - rot.iw) <= 2 && Math.abs(rot.h - rot.ih) <= 2 && !rot.over, `${v.id}: turned to ${rot.iw}×${rot.ih}, the view follows (canvas ${rot.w}×${rot.h})`);
    }
    // save and load
    await loadSave(page, r.save);
    const back = await page.evaluate(() => { const g = window.__tracklands.game; for (let f = 0; f < 10; f++) g.frame(1 / 30); return { ok: !!g && g.running, towns: g.towns.list.length, coins: g.economy.coins }; });
    check(back.ok && back.towns === r.towns, `${v.id}: save and load (${back.towns} towns)`);
    // hidden and shown again: the page saves when hidden and does not jump ahead
    const vis = await page.evaluate(async () => {
      const app = window.__tracklands, g = app.game, t0 = g.time;
      const set = (h) => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => h }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') }); document.dispatchEvent(new Event('visibilitychange')); };
      set(true); await new Promise((res) => setTimeout(res, 300)); set(false);
      for (let f = 0; f < 5; f++) g.frame(1 / 30);
      delete document.hidden; delete document.visibilityState;
      return { dt: g.time - t0, finite: Number.isFinite(g.time) && Number.isFinite(g.economy.coins) };
    });
    check(vis.finite && vis.dt < 5, `${v.id}: hidden and shown again, the simulation moved ${vis.dt.toFixed(2)} s (no jump)`);
    const hard = errors.filter((e) => !/WebGL|GPU stall|swiftshader|Automatic fallback/i.test(e));
    check(hard.length === 0, `${v.id}: no page errors${hard.length ? ': ' + hard.slice(0, 2).join(' | ') : ''}`);
    await ctx.close();
  }
  return { ok, lines };
}
