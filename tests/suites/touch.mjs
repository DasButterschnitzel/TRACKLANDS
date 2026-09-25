// Touch gesture state machine with real (CDP) touch input on a phone viewport:
// a swipe never builds anything whatever tool is active; a tap sets a
// construction anchor, a second tap the end, Build commits, Cancel drops it; a
// pinch in the middle of a construction keeps the plan; a long press starts a
// drawing; a finger in a scrolling panel scrolls the panel and never the
// world; hiding the app releases every finger. The mouse still builds at once
// on release (desktop is unchanged).
import { openPage, startTestGame } from '../lib.mjs';

export const name = 'touch';

// Touch events carry their own timestamps (seconds): the software renderer
// here draws a phone frame in ~0.5 s, so real-time stamps would say every
// finger held still. These stamp a finger moving at a real finger's pace.
let clock = 0;
const now = () => (clock = Math.max(clock + 0.001, Date.now() / 1000));
const T = (cdp, type, pts, ts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i + 1 })), timestamp: ts ?? now() });
async function swipe(page, cdp, a, b, steps = 10, hold = 0) {
  const t0 = now();
  await T(cdp, 'touchStart', [a], t0);
  for (let i = 1; i <= steps; i++) { await T(cdp, 'touchMove', [[a[0] + (b[0] - a[0]) * i / steps, a[1] + (b[1] - a[1]) * i / steps]], t0 + hold + i * 0.016); await page.waitForTimeout(16); }
  clock = Math.max(clock, t0 + hold + steps * 0.016 + 0.02);
  await T(cdp, 'touchEnd', []);
  await page.waitForTimeout(80);
}
async function tap(page, cdp, a) { const t0 = now(); await T(cdp, 'touchStart', [a], t0); await page.waitForTimeout(50); clock = Math.max(clock, t0 + 0.08); await T(cdp, 'touchEnd', []); await page.waitForTimeout(80); }
async function refocus(page) {
  await page.evaluate(() => { const g = window.__tracklands.game; g.camera.vel.set(0, 0); g.camera.focus(window.__focus[0], window.__focus[1], 20); });
  await page.waitForFunction(() => { const c = window.__tracklands.game.camera, t = c.target, f = window.__focus; return !c.focusGoal && Math.abs(t.x - f[0]) + Math.abs(t.z - f[1]) < 0.1 && Math.abs(c.viewSize - c.zoomGoal) < 0.05; }, null, { polling: 100, timeout: 30000 });
}
const scr = (page, t) => page.evaluate((t) => { const p = window.__tracklands.game.input.tileScreen(t); return [p.x, p.y]; }, t);
const state = (page) => page.evaluate(() => { const g = window.__tracklands.game, C = g.construction; let conn = 0; for (let i = 0; i < g.net.conn.length; i++) if (g.net.conn[i]) conn++; return { conn, depots: g.stations.depots.length, drag: C.drag ? { a: C.drag.a, b: C.drag.b, point: C.drag.point, marks: C.drag.tiles ? C.drag.tiles.size : 0 } : null, cam: [g.camera.target.x, g.camera.target.z], ptrs: g.input.pointers.size, gesture: g.input.gesture && g.input.gesture.state, bar: !!document.querySelector('#subbar.confirm'), coins: g.economy.coins }; });

export async function run({ browser, base }) { return runT({ browser, base, dbg: false }); }
export async function runT({ browser, base, dbg }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 412, height: 860 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  try {
  await startTestGame(page, 7);
  const cdp = await ctx.newCDPSession(page);
  // the software renderer here delivers finger moves ~0.5 s apart: a longer
  // hold time keeps quick swipes from reading as long presses (the long-press
  // step below sets the real value back)
  await page.evaluate(() => { window.__tracklands.game.input.longPressMs = 2500; });
  // a free straight run of land near the middle, camera on it
  const run0 = await page.evaluate(() => {
    const g = window.__tracklands.game, N = g.mapSize || 64;
    g.economy.coins = 1e6;
    g.settings.instantBuild = false; g.settings.keepTool = true;
    for (let z = 20; z < N - 20; z++) for (let x = 14; x < N - 24; x++) {
      let free = true;
      for (let i = 0; i < 8 && free; i++) for (const dz of [-1, 0, 1]) { const t = (z + dz) * N + x + i; if (g.net.tileBlockedReason(t) || g.decor.at(t) || g.roads.hasRoad(t) || g.stations.placeError(t, 'depot')) free = false; }
      if (free) { const a = z * N + x; window.__focus = [(x + 4) * 2, (z + 0.5) * 2]; g.camera.focus(window.__focus[0], window.__focus[1], 20); return a; }
    }
    return -1;
  });
  check(run0 >= 0, `found free land (${run0})`);
  await page.waitForFunction(() => { const t = window.__tracklands.game.camera.target, f = window.__focus; return Math.abs(t.x - f[0]) + Math.abs(t.z - f[1]) < 0.1; }, null, { polling: 100, timeout: 30000 });
  await page.click('#tool-track');
  // 1. a swipe with the track tool only pans
  let s0 = await state(page);
  let a = await scr(page, run0), b = await scr(page, run0 + 5);
  await swipe(page, cdp, a, b);
  let s1 = await state(page);
  check(s1.conn === s0.conn && !s1.drag && Math.hypot(s1.cam[0] - s0.cam[0], s1.cam[1] - s0.cam[1]) > 0.5, `track tool: a swipe pans the camera and builds nothing (moved ${Math.hypot(s1.cam[0] - s0.cam[0], s1.cam[1] - s0.cam[1]).toFixed(1)}, conn ${s0.conn}→${s1.conn})`);
  // re-centre
  await page.evaluate(() => { const g = window.__tracklands.game; g.camera.focus(window.__focus[0], window.__focus[1], 20); });
  await page.waitForFunction(() => { const t = window.__tracklands.game.camera.target, f = window.__focus; return Math.abs(t.x - f[0]) + Math.abs(t.z - f[1]) < 0.1; }, null, { polling: 100, timeout: 30000 });
  // 2. tap start, tap end: a plan, nothing built; Build commits
  a = await scr(page, run0); b = await scr(page, run0 + 5);
  if (dbg) await page.evaluate(() => { window.__ev = []; for (const t of ['pointerdown','pointerup','pointercancel']) window.addEventListener(t, (e) => window.__ev.push(t + ':' + e.pointerId + ':' + Math.round(e.clientX) + ',' + Math.round(e.clientY) + '@' + Math.round(e.timeStamp)), true); const I = window.__tracklands.game.input; const o = I.touchTap.bind(I); I.touchTap = (x, y) => { window.__ev.push('TAP ' + x + ' ' + JSON.stringify(window.__tracklands.game.construction.drag)); return o(x, y); }; const od = I.touchDown.bind(I); I.touchDown = (e) => { od(e); window.__ev.push('TD ' + JSON.stringify(I.gesture) + ' n' + I.pointers.size); }; });
  await tap(page, cdp, a);
  await tap(page, cdp, b);
  s1 = await state(page);
  if (dbg) console.log(JSON.stringify(a), JSON.stringify(b), JSON.stringify(await page.evaluate(() => window.__ev)));
  check(s1.drag && s1.drag.a === run0 && s1.drag.b === run0 + 5 && s1.conn === s0.conn && s1.bar, `tap start + tap end: a plan of 6 tiles waits for confirmation (${JSON.stringify(s1.drag)}, bar ${s1.bar})`);
  const handles = await page.waitForFunction(() => document.querySelectorAll('#bhandles .bhandle:not([hidden])').length === 2, null, { timeout: 5000 }).then(() => 2, () => page.$$eval('#bhandles .bhandle', (els) => els.length));
  check(handles === 2, `both ends show a drag handle (${handles})`);
  // 3. pinch in the middle keeps the plan
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 120];
  const p0 = now();
  await T(cdp, 'touchStart', [[mid[0] - 40, mid[1]]], p0);
  await T(cdp, 'touchStart', [[mid[0] - 40, mid[1]], [mid[0] + 40, mid[1]]], p0 + 0.03);
  for (let i = 1; i <= 8; i++) { await T(cdp, 'touchMove', [[mid[0] - 40 - i * 8, mid[1]], [mid[0] + 40 + i * 8, mid[1]]], p0 + 0.03 + i * 0.016); await page.waitForTimeout(16); }
  clock = Math.max(clock, p0 + 0.3);
  await T(cdp, 'touchEnd', []);
  await page.waitForTimeout(100);
  const s2 = await state(page);
  check(s2.drag && s2.drag.a === run0 && s2.drag.b === run0 + 5 && s2.conn === s0.conn && s2.ptrs === 0, `a pinch during construction zooms and keeps the plan (${JSON.stringify(s2.drag)}, fingers ${s2.ptrs})`);
  // 4. drag the end handle one tile further, then Build
  b = await scr(page, run0 + 5);
  const b2 = await scr(page, run0 + 6);
  await swipe(page, cdp, b, b2, 8);
  const s3 = await state(page);
  check(s3.drag && s3.drag.b === run0 + 6 && s3.conn === s0.conn, `dragging the end handle moves the end (${s3.drag && s3.drag.b}) and still builds nothing`);
  await page.click('#subbar [data-act=buildConfirm]', { timeout: 3000 });
  await page.waitForTimeout(200);
  const s4 = await state(page);
  check(s4.conn >= s0.conn + 7 && !s4.drag && s4.coins < s0.coins, `Build commits the track (conn ${s0.conn}→${s4.conn}, paid ${Math.round(s0.coins - s4.coins)})`);
  // 5. a swipe that starts on the new track pans; it never grabs the rail
  const onRail = await scr(page, run0 + 3);
  await swipe(page, cdp, onRail, [onRail[0] + 90, onRail[1] - 140]);
  const s5 = await state(page);
  check(s5.conn === s4.conn && !s5.drag, `a swipe that starts on track pans (conn ${s4.conn}→${s5.conn}, plan ${!!s5.drag})`);
  await page.evaluate(() => { const g = window.__tracklands.game; g.camera.focus(window.__focus[0], window.__focus[1], 20); });
  await page.waitForFunction(() => { const t = window.__tracklands.game.camera.target, f = window.__focus; return Math.abs(t.x - f[0]) + Math.abs(t.z - f[1]) < 0.1; }, null, { polling: 100, timeout: 30000 });
  // 6. long press then drag starts a drawing; Cancel drops it
  const n = await page.evaluate(() => (window.__tracklands.game.mapSize || 64));
  const lp = await scr(page, run0 + n), lp2 = await scr(page, run0 + n + 4);
  await page.evaluate(() => { window.__tracklands.game.input.longPressMs = 450; });
  await T(cdp, 'touchStart', [lp]);
  await page.waitForTimeout(700);
  for (let i = 1; i <= 8; i++) { await T(cdp, 'touchMove', [[lp[0] + (lp2[0] - lp[0]) * i / 8, lp[1] + (lp2[1] - lp[1]) * i / 8]]); await page.waitForTimeout(16); }
  await T(cdp, 'touchEnd', []);
  await page.waitForTimeout(100);
  await page.evaluate(() => { window.__tracklands.game.input.longPressMs = 2500; });
  const s6 = await state(page);
  check(s6.drag && s6.drag.a === run0 + n && s6.drag.b === run0 + n + 4 && s6.conn === s5.conn && s6.bar, `long press + drag draws a plan without building (${JSON.stringify(s6.drag)})`);
  await page.click('#subbar [data-act=buildCancel]', { timeout: 3000 });
  await page.waitForTimeout(100);
  const s7 = await state(page);
  check(!s7.drag && s7.conn === s5.conn && !s7.bar, 'Cancel drops the plan');
  // 7. depot: a tap shows the site; Build places it
  await page.click('#tool-depot');
  const dt = run0 - n * 1 + 2;
  await refocus(page);
  const d0 = await state(page);
  await swipe(page, cdp, await scr(page, dt), await scr(page, dt + 3));
  const d1 = await state(page);
  check(d1.depots === d0.depots && !d1.drag, `depot tool: a swipe builds no depot (${d0.depots}→${d1.depots})`);
  await refocus(page);
  if (dbg) await page.evaluate(() => { window.__ev = []; const I = window.__tracklands.game.input; const C = window.__tracklands.game.construction; const o = C.touchTap.bind(C); C.touchTap = (t, p) => { window.__ev.push('CT ' + t + ' ' + C.tool + ' ' + C.touchKind()); return o(t, p); }; const od = I.touchDown.bind(I); I.touchDown = (e) => { od(e); window.__ev.push('TD ' + JSON.stringify(I.gesture) + ' n' + I.pointers.size); }; for (const t of ['pointerdown','pointerup']) window.addEventListener(t, (e) => window.__ev.push(t + ' ' + (e.target.id || e.target.className)), true); });
  await tap(page, cdp, await scr(page, dt));
  const d2 = await state(page);
  if (dbg) console.log(dt, JSON.stringify(await page.evaluate(() => [window.__ev, window.__tracklands.game.construction.drag, window.__tracklands.game.construction.tool])));
  check(d2.drag && d2.drag.point != null && d2.depots === d0.depots && d2.bar, `depot tool: a tap shows the site and waits (${JSON.stringify(d2.drag)})`);
  await page.click('#subbar [data-act=buildConfirm]', { timeout: 3000 });
  await page.waitForTimeout(150);
  const d3 = await state(page);
  check(d3.depots === d0.depots + 1, `Build places the depot (${d0.depots}→${d3.depots})`);
  // 8. bulldozer: a swipe over track removes nothing; tap marks, Demolish clears
  await page.click('#tool-bulldoze');
  await refocus(page);
  const r0 = await state(page);
  await swipe(page, cdp, await scr(page, run0 + 1), await scr(page, run0 + 4));
  const r1 = await state(page);
  check(r1.conn === r0.conn, `bulldozer: a swipe along track removes nothing (${r0.conn}→${r1.conn})`);
  await refocus(page);
  await tap(page, cdp, await scr(page, run0 + 2));
  const r2 = await state(page);
  check(r2.drag && r2.drag.marks === 1 && r2.conn === r0.conn, `bulldozer: a tap marks one tile (${r2.drag && r2.drag.marks})`);
  await page.click('#subbar [data-act=buildConfirm]', { timeout: 3000 });
  await page.waitForTimeout(200);
  const r3 = await state(page);
  check(r3.conn < r0.conn, `Demolish clears the marked tile (${r0.conn}→${r3.conn})`);
  await page.click('#tool-select');
  // 9. a finger in a scrolling panel scrolls it and leaves the world alone
  await page.evaluate(() => window.__tracklands.ui.openPanel('handbook'));
  await page.waitForTimeout(400);
  const box = await page.evaluate(() => { const b = document.querySelector('#panel .pbody'); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height * 0.7, h: b.scrollHeight - b.clientHeight }; });
  const c0 = (await state(page)).cam;
  await swipe(page, cdp, [box.x, box.y], [box.x, box.y - 260], 12);
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => document.querySelector('#panel .pbody').scrollTop);
  const c1 = (await state(page)).cam;
  check(Math.hypot(c1[0] - c0[0], c1[1] - c0[1]) < 0.01 && (box.h <= 0 || after > 0), `a swipe inside a panel scrolls it (scrollTop ${after}) and never moves the world`);
  await page.evaluate(() => window.__tracklands.ui.closePanel());
  // 10. hiding the app releases the finger
  await T(cdp, 'touchStart', [[200, 400]]);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  const v = await state(page);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); });
  await T(cdp, 'touchEnd', []);
  check(v.ptrs === 0 && !v.gesture, `going to the background releases every finger (${v.ptrs}, ${v.gesture})`);
  } catch (e) { ok = false; lines.push('EXCEPTION ' + String(e.message || e).split('\n')[0]); }
  if (errors.length) { ok = false; lines.push('errors: ' + errors.slice(0, 3).join(' | ')); }
  await ctx.close();
  // desktop: the mouse still builds on release
  {
    const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 1280, height: 800 } });
    await startTestGame(page, 7);
    const a0 = await page.evaluate(() => {
      const g = window.__tracklands.game, N = g.mapSize || 64;
      g.economy.coins = 1e6;
      for (let z = 20; z < N - 20; z++) for (let x = 14; x < N - 24; x++) {
        let free = true;
        for (let i = 0; i < 6 && free; i++) if (g.net.tileBlockedReason(z * N + x + i) || g.decor.at(z * N + x + i)) free = false;
        if (free) { window.__focus = [(x + 3) * 2, (z + 0.5) * 2]; g.camera.focus(window.__focus[0], window.__focus[1], 20); return z * N + x; }
      }
      return -1;
    });
    await page.waitForFunction(() => { const t = window.__tracklands.game.camera.target, f = window.__focus; return Math.abs(t.x - f[0]) + Math.abs(t.z - f[1]) < 0.1; }, null, { polling: 100, timeout: 30000 });
    await page.click('#tool-track');
    const m0 = await state(page);
    const p0 = await scr(page, a0), p1 = await scr(page, a0 + 4);
    await page.mouse.move(p0[0], p0[1]); await page.mouse.down(); await page.mouse.move(p1[0], p1[1], { steps: 8 }); await page.mouse.up();
    await page.waitForTimeout(200);
    const m1 = await state(page);
    check(m1.conn >= m0.conn + 5 && !m1.drag, `desktop: a mouse drag builds on release as before (conn ${m0.conn}→${m1.conn})`);
    const exit = await page.$('#subbar [data-act=tool][data-arg=select]');
    check(!!exit, 'desktop: the sub bar names the tool and offers a way out');
    if (errors.length) { ok = false; lines.push('errors (desktop): ' + errors.slice(0, 3).join(' | ')); }
    await ctx.close();
  }
  return { ok, lines };
}
