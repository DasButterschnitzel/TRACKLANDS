// Stress tests. Buses: a dense city with bus stations, many stops and
// transfer lines runs 10, 50, 100 and 200 buses with the town's traffic;
// measured per step: the whole simulation and the road part, route finding,
// the road renderer and a full frame, and the Transport panel with every
// vehicle listed; money and passengers keep flowing and nothing goes NaN.
// Rendering LOD: zooming out swaps town buildings to simpler shared
// geometry (fewer triangles, same instances). Touch: pan, pinch, build and
// cancel, select, menu, panel scroll, close, orientation changes and
// background/resume, over and over, and afterwards no finger is stuck and a
// tap and a swipe still work.
import { openPage, startTestGame } from '../lib.mjs';

export const name = 'stress';

let clock = 0;
const now = () => (clock = Math.max(clock + 0.001, Date.now() / 1000));
const T = (cdp, type, pts, ts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i + 1 })), timestamp: ts ?? now() });
async function swipe(page, cdp, a, b, steps = 8) {
  const t0 = now();
  await T(cdp, 'touchStart', [a], t0);
  for (let i = 1; i <= steps; i++) await T(cdp, 'touchMove', [[a[0] + (b[0] - a[0]) * i / steps, a[1] + (b[1] - a[1]) * i / steps]], t0 + i * 0.016);
  clock = Math.max(clock, t0 + steps * 0.016 + 0.02);
  await T(cdp, 'touchEnd', []);
  await page.waitForTimeout(40);
}
async function pinch(page, cdp, c, d0, d1, steps = 6) {
  const t0 = now();
  await T(cdp, 'touchStart', [[c[0] - d0, c[1]], [c[0] + d0, c[1]]], t0);
  for (let i = 1; i <= steps; i++) { const d = d0 + (d1 - d0) * i / steps; await T(cdp, 'touchMove', [[c[0] - d, c[1]], [c[0] + d, c[1]]], t0 + i * 0.016); }
  clock = Math.max(clock, t0 + steps * 0.016 + 0.02);
  await T(cdp, 'touchEnd', []);
  await page.waitForTimeout(40);
}
async function tap(page, cdp, a) { const t0 = now(); await T(cdp, 'touchStart', [a], t0); clock = Math.max(clock, t0 + 0.06); await T(cdp, 'touchEnd', []); await page.waitForTimeout(60); }

export async function run({ browser, base, quick }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  // ---------- buses ----------
  {
    const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 1280, height: 800 } });
    await startTestGame(page, 4242);
    const setup = await page.evaluate(() => {
      const g = window.__tracklands.game, R = g.roads, Tn = g.towns, N = g.mapSize || 64;
      g.economy.coins = 1e9; g.settings.weather = false; g.progression.level = 40;
      for (let i = 0; i < 8; i++) g.progression.regions.add(i);
      const t = Tn.list.slice().sort((a, b) => b.pop - a.pop)[0];
      t.stage = 5; Tn.levelUp(t); Tn.layout(t, true, 700); t.pop = Math.max(t.pop, 9000);
      g.stations.relinkAll(); Tn.onStationsChanged();
      const roads = [...t.roadSet].filter((i) => !g.net.conn[i] && !R.stopAt(i));
      const d = (a, b) => Math.max(Math.abs(a % N - b % N), Math.abs(Math.floor(a / N) - Math.floor(b / N)));
      // spread stops over the streets, at least 3 tiles apart
      const picks = [];
      for (const i of roads.sort((a, b) => (a * 7919) % 104729 - (b * 7919) % 104729)) if (picks.every((p) => d(p, i) >= 3)) { picks.push(i); if (picks.length >= 16) break; }
      const stops = [];
      for (const i of picks) { const r = R.addStop(i, 'bus'); if (r.stop) stops.push(r.stop); }
      // two bus stations (hubs): upgrade two stops until they are stations
      const hubs = stops.slice(0, 2);
      for (const h of hubs) for (let k = 0; k < 3; k++) R.upgradeStop(h);
      // lines through a hub: transfers between them
      const reach = (a, b) => !!R.path(a.tile, b.tile);
      const lines = [];
      const rest = stops.slice(2);
      for (let k = 0; k < 6 && rest.length; k++) {
        const hub = hubs[k % 2];
        const a = rest[(k * 2) % rest.length], b = rest[(k * 2 + 1) % rest.length];
        const seq = [a, hub, b].filter((s, i, arr) => arr.indexOf(s) === i);
        if (seq.every((s, i) => i === 0 || reach(seq[i - 1], s))) { const l = R.lines.create({ kind: 'bus', stops: seq.map((s) => s.id) }).line; if (l) lines.push(l); }
      }
      g.camera.focus((t.x + 0.5) * 2, (t.z + 0.5) * 2, 22);
      window.__stress = { lines: lines.map((l) => l.id), town: t.id };
      return { town: t.name, stage: t.stage, roads: t.roadSet.size, stops: stops.length, hubs: hubs.map((h) => h.type), lines: lines.length, cars: g.traffic.cars.length };
    });
    check(setup.stops >= 10 && setup.lines >= 3 && setup.hubs.every((t) => t === 'station'), `dense city ${setup.town} (${setup.roads} street tiles): ${setup.stops} stops, 2 bus stations, ${setup.lines} lines through them`);
    const levels = quick ? [10, 50, 100, 200] : [10, 50, 100, 200];
    const res = [];
    for (const n of levels) {
      const r = await page.evaluate(async (n) => {
        const g = window.__tracklands.game, R = g.roads, L = R.lines;
        const lines = window.__stress.lines.map((id) => L.byId(id)).filter(Boolean);
        const models = ['citybus', 'urban_bus', 'articulated', 'double_decker', 'minibus'];
        let k = R.vehicles.filter((v) => !v.owner).length;
        while (k < n) { const l = lines[k % lines.length]; const st = R.stopById(l.stops[0]); const b = R.buy(models[k % models.length], st, null, l); if (b.error) break; k++; }
        // travellers waiting everywhere: boarding, crowding and transfers under load
        for (const s of R.stops) if (s.kind === 'bus') s.stock.PASSENGERS = Math.max(s.stock.PASSENGERS || 0, 80);
        const buses = R.vehicles.filter((v) => !v.owner).length;
        // simulation: whole step and the road part
        const rt0 = R.tick.bind(R);
        let roadMs = 0;
        R.tick = (dt) => { const a = performance.now(); rt0(dt); roadMs += performance.now() - a; };
        for (let i = 0; i < 60; i++) g.tick(1 / 30);   // settle
        roadMs = 0;
        const t0 = performance.now();
        const steps = 240;
        for (let i = 0; i < steps; i++) g.tick(1 / 30);
        const tickMs = (performance.now() - t0) / steps;
        delete R.tick;
        // route finding between random stops
        const stops = R.stops.filter((s) => s.kind === 'bus');
        const p0 = performance.now();
        let found = 0;
        for (let i = 0; i < 100; i++) { const a = stops[(i * 7) % stops.length], b = stops[(i * 13 + 5) % stops.length]; if (R.path(a.tile, b.tile)) found++; }
        const pathMs = (performance.now() - p0) / 100;
        // rendering: road visuals and a full frame
        const v0 = performance.now();
        for (let i = 0; i < 20; i++) R.updateVisuals(1 / 30);
        const visMs = (performance.now() - v0) / 20;
        const sp = g.speed; g.speed = 0;
        for (let i = 0; i < 4; i++) g.frame(1 / 30);   // (first frames upload new meshes and compile shaders)
        const rr = g.renderer.render;
        let renderMs = 0;
        g.renderer.render = function (...a) { const s = performance.now(); rr.apply(this, a); renderMs += performance.now() - s; };
        const f0 = performance.now();
        for (let i = 0; i < 8; i++) g.frame(1 / 30);
        g.speed = sp;
        const frameMs = (performance.now() - f0) / 8;
        g.renderer.render = rr;
        renderMs /= 8;
        const info = g.renderer.info.render;
        // UI: the Transport panel with every vehicle listed
        const ui = window.__tracklands.ui;
        const u0 = performance.now();
        ui.transportMode = 'bus'; ui.trainsTab = 'vehicles';
        const tv = ui.tv(); tv.limit = 400;
        ui.openPanel('trains');
        const rows = document.querySelectorAll('#panel .tvrow').length;
        const uiMs = performance.now() - u0;
        ui.closePanel();
        const bad = R.vehicles.some((v) => !isFinite(v.f) || v.f < -0.01 || (v.path && v.pi > v.path.length));
        const trips = R.vehicles.reduce((a, v) => a + (v.trips || 0), 0);
        const pax = lines.reduce((a, l) => a + (l.cur.pax || 0) + l.hist.reduce((x, h) => x + (h.pax || 0), 0), 0);
        return { n, buses, tickMs, roadMs: roadMs / steps, pathMs, found, visMs, frameMs, renderMs, calls: info.calls, tris: info.triangles, uiMs, rows, bad, trips, pax, cars: g.traffic.cars.length, lod: R.lod ? { ...R.lod } : null };
      }, n);
      res.push(r);
      lines.push(`     ${r.buses} buses, ${r.cars} cars: step ${r.tickMs.toFixed(2)} ms (roads ${r.roadMs.toFixed(2)}), route ${r.pathMs.toFixed(2)} ms, road visuals ${r.visMs.toFixed(2)} ms, frame ${r.frameMs.toFixed(1)} ms (drawing ${r.renderMs.toFixed(1)} ms, ${r.calls} draw calls, ${Math.round(r.tris / 1000)}k triangles), Transport panel ${r.uiMs.toFixed(0)} ms`);
    }
    const last = res[res.length - 1], first = res[0];
    check(res.every((r) => r.buses === r.n), `bought ${res.map((r) => r.buses).join(' / ')} buses`);
    check(res.every((r) => !r.bad) && last.trips > last.buses && last.pax > 0, `all running: ${last.trips} stops served, ${last.pax} passengers, no vehicle out of bounds`);
    check(last.roadMs < 6 && last.tickMs < 25, `200 buses: road simulation ${last.roadMs.toFixed(2)} ms per step, whole step ${last.tickMs.toFixed(2)} ms`);
    check(res.every((r) => r.pathMs < 5 && r.found >= 90), `route finding ${res.map((r) => r.pathMs.toFixed(2)).join('/')} ms per route, ${last.found}/100 found`);
    // (wall-clock frame times of the headless software renderer swing by
    // 100x between identical frames, so the scene cost is checked by what is
    // submitted: draw calls stay flat with instancing, triangles grow little)
    check(last.calls <= first.calls + 10 && last.calls < 400 && last.tris < first.tris * 1.4, `200 buses and the town's cars cost ${last.calls - first.calls} more draw calls (${last.calls}) and ${Math.round((last.tris / first.tris - 1) * 100)} % more triangles than 10 buses`);
    check(last.visMs < 10 && last.uiMs < 800 && last.rows >= 200, `200 buses drawn in ${last.visMs.toFixed(2)} ms (near/mid/far ${last.lod ? [last.lod.near, last.lod.mid, last.lod.far].join('/') : '?'}), Transport panel listing ${last.rows} of them in ${last.uiMs.toFixed(0)} ms`);
    // scaling: 20× the buses must not cost 20× the road step
    check(last.roadMs < Math.max(0.5, first.roadMs) * 12, `road step grows ${(last.roadMs / Math.max(0.01, first.roadMs)).toFixed(1)}× from 10 to 200 buses`);
    // building LOD by zoom
    const lod = await page.evaluate(() => {
      const g = window.__tracklands.game, Tn = g.towns;
      const tri = Tn.lodStats();
      const out = { tri, bands: [] };
      for (const vs of [20, 38, 70, 20]) { g.camera.viewSize = g.camera.zoomGoal = vs; g.frame(1 / 30); out.bands.push(Tn.lod); }
      const a = Tn.list[0] && Tn.list[0].buildings && Tn.list[0].buildings[0];
      out.same = !a || a.slot >= 0;
      return out;
    });
    check(lod.bands.join() === '0,1,2,0' && lod.tri[1] < lod.tri[0] * 0.8 && lod.tri[2] < lod.tri[1] && lod.same, `town buildings by zoom: near/mid/far levels ${lod.bands.join('→')}, triangles ${lod.tri.join(' / ')}`);
    if (errors.length) { ok = false; lines.push('errors: ' + errors.slice(0, 3).join(' | ')); }
    await ctx.close();
  }
  // ---------- touch ----------
  {
    const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 412, height: 860 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    await startTestGame(page, 7);
    const cdp = await ctx.newCDPSession(page);
    await page.evaluate(() => { const g = window.__tracklands.game; g.economy.coins = 1e6; g.settings.instantBuild = false; window.__tracklands.game.input.longPressMs = 2500; });
    const rounds = quick ? 6 : 15;
    let stuck = 0, errs = 0;
    for (let r = 0; r < rounds; r++) {
      const portrait = r % 2 === 0;
      const W = portrait ? 412 : 860, H = portrait ? 860 : 412;
      const c = [W / 2, H / 2];
      await swipe(page, cdp, [c[0] - 60, c[1]], [c[0] + 60, c[1] + 30]);
      await pinch(page, cdp, c, 60, 120);
      await pinch(page, cdp, c, 120, 70);
      // build: pick a tool, tap twice, cancel
      await page.evaluate(() => window.__tracklands.game.construction.setTool('track'));
      await tap(page, cdp, [c[0] - 40, c[1]]);
      await tap(page, cdp, [c[0] + 40, c[1]]);
      const cancel = await page.$('#subbar [data-act=touchCancel], #subbar .cancel, [data-act=buildCancel]');
      if (cancel) await cancel.tap().catch(() => {}); else await page.evaluate(() => window.__tracklands.game.construction.cancelDrag && window.__tracklands.game.construction.cancelDrag());
      await page.evaluate(() => window.__tracklands.game.construction.setTool('select'));
      await tap(page, cdp, c);                                  // select whatever is there
      // menu, panel scroll, close
      await page.evaluate(() => window.__tracklands.ui.openPanel('handbook'));
      await page.waitForTimeout(60);
      const box = await page.evaluate(() => { const b = document.querySelector('#panel .pbody'); if (!b) return null; const q = b.getBoundingClientRect(); return [q.left + q.width / 2, q.top + q.height * 0.7]; });
      if (box) await swipe(page, cdp, box, [box[0], box[1] - 150]);
      await page.evaluate(() => window.__tracklands.ui.closePanel());
      // rotate, background and resume, sometimes with a finger down
      await page.setViewportSize({ width: portrait ? 860 : 412, height: portrait ? 412 : 860 });
      await page.evaluate(() => window.dispatchEvent(new Event('resize')));
      if (r % 3 === 0) await T(cdp, 'touchStart', [[100, 200]]);
      await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
      await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
      if (r % 3 === 0) await T(cdp, 'touchEnd', []);
      await page.waitForTimeout(60);
      const st = await page.evaluate(() => { const I = window.__tracklands.game.input; return { p: I.pointers.size, g: I.gesture ? I.gesture.state : null, m: I.mode }; });
      if (st.p || (st.g && st.g !== 'pending')) stuck++;
      errs = errors.length;
    }
    const fin = await page.evaluate(() => { const g = window.__tracklands.game, I = g.input; return { p: I.pointers.size, gesture: I.gesture ? I.gesture.state : null, drag: !!g.construction.drag, tool: g.construction.tool, cam: [g.camera.target.x, g.camera.target.z] }; });
    check(!stuck && !fin.p && !fin.gesture && !fin.drag, `${rounds} rounds of pan, pinch, build+cancel, select, menu, scroll, close, rotate, background/resume: no finger or gesture stuck (${stuck} stuck, pointers ${fin.p}, gesture ${fin.gesture})`);
    // still works: a swipe pans the map (nothing selected, no panel over it)
    await page.evaluate(() => { const g = window.__tracklands.game; g.select(null); window.__tracklands.ui.closePanel(); g.construction.setTool('select'); });
    await page.waitForTimeout(200);
    const vp = page.viewportSize();
    await swipe(page, cdp, [vp.width / 2 - 80, vp.height / 2], [vp.width / 2 + 80, vp.height / 2], 10);
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => [window.__tracklands.game.camera.target.x, window.__tracklands.game.camera.target.z]);
    check(Math.hypot(after[0] - fin.cam[0], after[1] - fin.cam[1]) > 0.3, `afterwards a swipe still pans the map (moved ${Math.hypot(after[0] - fin.cam[0], after[1] - fin.cam[1]).toFixed(2)})`);
    check(!errs, `no errors${errs ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
    await ctx.close();
  }
  return { ok, lines };
}
