// Road traffic (src/road/Traffic.js): the town's cars follow population,
// density and the time of day; nobody drives through the vehicle ahead or
// through a red light, junctions hold one crossing movement at a time; a
// crowded street slows buses a little and a bus lane takes them out of it;
// bus lanes need research and, in a city, the council's approval, cost money,
// can be undone, are painted with a mouse drag and are saved; bus priority
// shortens the red phase for a waiting bus; what the camera looks at changes
// nothing in the simulation (bus earnings identical near or far); and the
// cars cost little time per step.
import { openPage, startTestGame, loadSave } from '../lib.mjs';

export const name = 'traffic';

async function city(page, seed) {
  await startTestGame(page, seed);
  return page.evaluate(() => {
    const g = window.__tracklands.game, R = g.roads, T = g.towns, N = g.mapSize || 64;
    g.economy.coins = 1e6; g.settings.weather = false;
    for (let i = 0; i < 8; i++) g.progression.regions.add(i);
    g.progression.level = Math.max(g.progression.level, 14);
    const t = T.list.slice().sort((a, b) => b.pop - a.pop)[0];
    t.stage = 4; T.levelUp(t); T.layout(t, true, 400); t.pop = Math.max(t.pop, 2600);
    g.stations.relinkAll(); T.onStationsChanged();
    const roads = [...t.roadSet].filter((i) => !g.net.conn[i] && !R.stopAt(i));
    const d = (a, b) => Math.max(Math.abs(a % N - b % N), Math.abs(Math.floor(a / N) - Math.floor(b / N)));
    let best = null;
    for (const a of roads) for (const b of roads) if (a < b && d(a, b) >= 6 && d(a, b) <= 10 && R.path(a, b) && (!best || R.path(a, b).length > best[2])) best = [a, b, R.path(a, b).length];
    const A = R.addStop(best[0], 'bus').stop, B = R.addStop(best[1], 'bus').stop;
    g.camera.focus((t.x + 0.5) * 2, (t.z + 0.5) * 2, 18);
    return { town: t.id, name: t.name, A: A.id, B: B.id, a: best[0], b: best[1], len: best[2] };
  });
}

export async function run({ browser, base }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 1280, height: 800 } });
  const w = await city(page, 4242);
  check(!!(w && w.A && w.B), `a city (${w && w.name}) with two bus stops ${w && w.len} tiles apart by road`);
  // ---------- how many cars ----------
  const n = await page.evaluate((w) => {
    const g = window.__tracklands.game, TR = g.traffic, T = g.towns;
    for (let i = 0; i < 60; i++) g.tick(1 / 30);
    const t = T.byId(w.town), small = T.list.filter((x) => x.id !== t.id && g.progression.regionUnlocked(x.region)).sort((a, b) => a.pop - b.pop)[0];
    const city = TR.wanted(t), cars = TR.cars.filter((c) => c.town === t.id).length;
    // (a smaller population, so the street space does not cap the count)
    const pop = t.pop; t.pop = 900;
    const at = (tod) => { g.env.timeOfDay = tod; return TR.wanted(t); };
    const out = { city, small: small ? TR.wanted(small) : 0, cars, rush: at(0.33), noon: at(0.5), night: at(0.02), lights: TR.lights.size, junctions: TR.jn.size };
    t.pop = pop; g.env.timeOfDay = 0.33;
    return out;
  }, w);
  check(n.city > n.small * 3 && n.cars === n.city, `cars follow the population: city ${n.city} (driving ${n.cars}), hamlet ${n.small}`);
  check(n.rush > n.noon && n.noon > n.night * 2, `and the time of day: rush hour ${n.rush}, noon ${n.noon}, night ${n.night}`);
  check(n.junctions > 0 && n.lights > 0, `${n.junctions} junctions, ${n.lights} with traffic lights in the city`);
  // ---------- rules of the road ----------
  const r = await page.evaluate((w) => {
    const g = window.__tracklands.game, TR = g.traffic, R = g.roads, L = R.lines, N = g.mapSize || 64;
    g.env.timeOfDay = 0.33; TR._adj = 0;
    const l = L.create({ stops: [w.A, w.B], pattern: 'outback' }).line;
    for (let k = 0; k < 4; k++) R.buy('citybus', R.stopById(w.A), null, l);
    const out = { gap: 9, gapN: 0, redRun: 0, box: 0, samples: 0 };
    const tx = (i) => i % N, ax = (a, b) => (tx(b) !== tx(a) ? 0 : 1);
    const prev = new Map();
    for (let i = 0; i < 30 * 90; i++) {
      g.tick(1 / 30);
      // distance on each stretch (no one drives through the one ahead)
      // (a bus still standing at its stop while the one before pulls away is no overlap)
      for (const l2 of TR.edges.values()) { if (l2.length < 2) continue; const fs = l2.slice().sort((a, b) => a.f - b.f); for (let k = 1; k < fs.length; k++) { if (fs[k - 1].o.town == null && fs[k - 1].f < 0.02) continue; out.gap = Math.min(out.gap, fs[k].f - fs[k - 1].f); out.gapN++; } }
      // red lights: nobody crosses the stop line on red
      for (const c of TR.cars) {
        const p = prev.get(c.id);
        const L2 = TR.lights.get(c.to);
        if (p && p.to === c.to && L2 && L2.axis !== ax(c.from, c.to) && p.f <= 0.55 && c.f > 0.56 && L2.t < 6.9) out.redRun++;
        prev.set(c.id, { to: c.to, f: c.f });
      }
      // junction boxes: never two crossing movements inside at once
      const inBox = new Map();
      const put = (j, axis) => { let s = inBox.get(j); if (!s) inBox.set(j, s = new Set()); s.add(axis); };
      for (const c of TR.cars) { if (TR.jn.has(c.from) && c.f < 0.3) put(c.from, ax(c.from, c.to)); if (TR.jn.has(c.to) && c.f > 0.8) put(c.to, ax(c.from, c.to)); }
      for (const s of inBox.values()) if (s.size > 1) out.box++;
      out.samples++;
    }
    out.squeezed = TR.stats.squeezed; out.redStops = TR.stats.redStops;
    out.trips = L.vehicles(l).reduce((a, v) => a + v.trips, 0);
    out.earned = Math.round(L.vehicles(l).reduce((a, v) => a + v.earned, 0));
    out.dly = L.vehicles(l).reduce((a, v) => a + (v.dly || 0), 0) / 4;
    out.line = l.id;
    return out;
  }, w);
  check(r.gap >= 0.3 || r.squeezed > 0 && r.gap >= 0.05, `vehicles keep their distance on every stretch (closest ${r.gap.toFixed(2)} tiles over ${r.gapN} pairs, ${r.squeezed} squeezed through a jam)`);
  check(r.redRun === 0, `no car crosses the stop line on red (${r.redRun} in ${r.samples} steps)`);
  check(r.box <= r.squeezed * 3, `junctions hold one crossing movement at a time (${r.box} conflicts, ${r.squeezed} squeezes)`);
  check(r.trips > 8 && r.earned > 0, `buses run through the traffic: ${r.trips} stops, ${r.earned} ● earned, ~${r.dly.toFixed(1)} s lost per trip, ${r.redStops} stops at red`);
  // ---------- congestion and bus lanes ----------
  const c = await page.evaluate((w) => {
    const g = window.__tracklands.game, TR = g.traffic, R = g.roads, A = g.authority, T = g.towns;
    const t = T.byId(w.town);
    const out = {};
    // a street with cars on it slows a bus, unless it has a bus lane
    const tile = [...TR.load.keys()].sort((a, b) => TR.load.get(b) - TR.load.get(a))[0];
    out.load = TR.load.get(tile);
    out.slow = TR.speedMul(tile, true);
    const had = R.lane[tile]; R.lane[tile] = 1; out.laneFast = TR.speedMul(tile, true); out.truck = TR.speedMul(tile, false); R.lane[tile] = had;
    // planning: research first, then the council of a city
    out.noResearch = R.planLane(w.a, w.b).reason;
    g.progression.research.add('bus_lanes');
    A.ensure(t).rating = 10;
    const p1 = R.planLane(w.a, w.b);
    out.noPermit = p1.reason; out.need = p1.need;
    A.ensure(t).rating = 80;
    const p2 = R.planLane(w.a, w.b);
    out.plan = { ok: p2.ok, tiles: p2.tiles.length, cost: p2.cost };
    return out;
  }, w);
  check(c.slow < 1 && c.laneFast === 1 && c.truck === c.slow, `a busy street (${c.load} cars) slows buses and trucks to ${Math.round(c.slow * 100)}%; in a bus lane a bus keeps full speed`);
  check(c.noResearch === 'err_lane_research' && c.noPermit === 'err_lane_permit' && c.need > 10 && c.plan.ok && c.plan.cost > 0, `bus lanes need research, then the city's approval (rating ${c.need}+): plan ${JSON.stringify(c.plan)}`);
  // paint it with the mouse: road tool, Bus lane, drag from stop to stop
  await page.evaluate(() => { const g = window.__tracklands.game; g.construction.setTool('road'); g.construction.roadMode = 'lane'; g.ui.renderToolbar(); });
  await page.evaluate((w) => { const g = window.__tracklands.game, N = g.mapSize || 64; window.__focus = [((w.a % N + w.b % N) / 2 + 0.5) * 2, ((Math.floor(w.a / N) + Math.floor(w.b / N)) / 2 + 0.5) * 2]; g.camera.focus(window.__focus[0], window.__focus[1], 16); }, w);
  await page.waitForFunction(() => { const t = window.__tracklands.game.camera.target, f = window.__focus; return Math.abs(t.x - f[0]) + Math.abs(t.z - f[1]) < 0.15; }, null, { polling: 100, timeout: 30000 });
  const chip = await page.$('#subbar [data-act=roadMode][data-arg=lane].on');
  const pa = await page.evaluate((w) => window.__tracklands.game.input.tileScreen(w.a), w);
  const pb = await page.evaluate((w) => window.__tracklands.game.input.tileScreen(w.b), w);
  const coins0 = await page.evaluate(() => window.__tracklands.game.economy.coins);
  await page.mouse.move(pa.x, pa.y); await page.mouse.down();
  for (let k = 1; k <= 8; k++) await page.mouse.move(pa.x + (pb.x - pa.x) * k / 8, pa.y + (pb.y - pa.y) * k / 8);
  await page.mouse.up();
  await page.waitForTimeout(200);
  const lane = await page.evaluate((w) => { const g = window.__tracklands.game, R = g.roads; const p = R.path(w.a, w.b); return { on: p.filter((i) => R.lane[i]).length, of: p.length, mesh: !!R.laneMesh, coins: g.economy.coins }; }, w);
  check(!!chip && lane.on === lane.of && lane.mesh && lane.coins < coins0, `road tool, Bus lane: a mouse drag paints ${lane.on}/${lane.of} tiles (${Math.round(coins0 - lane.coins)} ●)`);
  // buses in their lane: not slowed by the cars
  const b = await page.evaluate((line) => {
    const g = window.__tracklands.game, L = g.roads.lines, l = L.byId(line);
    for (const v of L.vehicles(l)) v.dly = 0;
    for (let i = 0; i < 30 * 90; i++) g.tick(1 / 30);
    return { dly: L.vehicles(l).reduce((a, v) => a + (v.dly || 0), 0) / L.vehicles(l).length };
  }, r.line);
  check(b.dly <= r.dly + 0.5, `with the bus lane the line loses ${b.dly.toFixed(1)} s per trip (before ${r.dly.toFixed(1)} s)`);
  // undo refunds, save/load keeps the lane
  const u = await page.evaluate(async (w) => {
    const g = window.__tracklands.game, R = g.roads;
    const c0 = g.economy.coins; g.construction.undo();
    const p = R.path(w.a, w.b), off = p.every((i) => !R.lane[i]), refund = g.economy.coins - c0;
    R.buildLane(R.planLane(w.a, w.b));
    window.__tsave = JSON.parse(JSON.stringify(g.serialize()));
    return { off, refund: Math.round(refund) };
  }, w);
  check(u.off && u.refund > 0, `undo removes the lane and refunds ${u.refund} ●`);
  await loadSave(page, await page.evaluate(() => window.__tsave));
  const kept = await page.evaluate((w) => { const R = window.__tracklands.game.roads; const p = R.path(w.a, w.b); return p.filter((i) => R.lane[i]).length === p.length; }, w);
  check(kept, 'bus lanes survive save/load');
  // ---------- bus priority ----------
  const pr = await page.evaluate(() => {
    const g = window.__tracklands.game, TR = g.traffic, N = g.mapSize || 64;
    for (let i = 0; i < 10; i++) g.tick(1 / 30);
    const [j, L] = [...TR.lights.entries()][0] || [];
    if (j == null) return null;
    const R = g.roads, nb = R.neighbours(j);
    // approach on the red axis
    const red = nb.find((a) => ((a % N) !== (j % N) ? 0 : 1) !== L.axis);
    const bus = { id: 9999, f: 0.5, path: [red, j], pi: 0 };
    const test = (research) => { if (research) g.progression.research.add('bus_priority'); else g.progression.research.delete('bus_priority'); g.progression.recomputeFx(); L.t = 5; L.pri = false; const lim = TR.limitVehicle(bus, red, j, 0.5, 0.6, 'bus', 1 / 30); return { lim, t: L.t }; };
    const off = test(false), on = test(true);
    g.progression.research.delete('bus_priority'); g.progression.recomputeFx();
    return { off, on };
  });
  check(pr && pr.off.lim <= 0.55 && pr.off.t === 5 && pr.on.lim <= 0.55 && pr.on.t <= 1.2, `bus priority: a bus at red waits, and with the research the light turns sooner (${pr && pr.off.t} → ${pr && pr.on.t} s)`);
  // ---------- the camera changes nothing ----------
  await page.evaluate(() => { window.__csave = JSON.parse(JSON.stringify(window.__tracklands.game.serialize())); });
  const runFrames = async (near) => {
    await loadSave(page, await page.evaluate(() => window.__csave));
    return page.evaluate((near) => {
      const g = window.__tracklands.game, R = g.roads;
      const s = R.stopById(R.lines.list[0].stops[0]);
      if (near) g.camera.focus((s.tile % (g.mapSize || 64) + 0.5) * 2, (Math.floor(s.tile / (g.mapSize || 64)) + 0.5) * 2, 10); else g.camera.focus(4, 4, 10);
      g.speed = 1; g.running = true;
      for (let i = 0; i < 300; i++) g.frame(1 / 30);
      g.speed = 0;
      return { earned: Math.round(R.vehicles.reduce((a, v) => a + v.earned, 0) * 100) / 100, pos: R.vehicles.map((v) => `${v.tile}:${v.f.toFixed(3)}`).join(','), visible: g.traffic.visibleCars, lod: R.lod };
    }, near);
  };
  const near = await runFrames(true), far = await runFrames(false);
  check(near.earned === far.earned && near.pos === far.pos && near.visible > far.visible, `camera near or far: the same bus positions and earnings (${near.earned} ●); cars drawn ${near.visible} vs ${far.visible}`);
  check(near.lod.near > 0 && far.lod.far > 0 && far.lod.near === 0, `buses drawn by distance: near ${JSON.stringify(near.lod)}, far ${JSON.stringify(far.lod)}`);
  // ---------- cost ----------
  const perf = await page.evaluate(() => {
    const g = window.__tracklands.game, T = g.towns, TR = g.traffic;
    for (const t of T.list) { if (!g.progression.regionUnlocked(t.region)) continue; t.stage = Math.max(t.stage, 3); t.pop = Math.max(t.pop, 6000); }
    TR._filled = false; TR._adj = 0;
    for (let i = 0; i < 40; i++) g.tick(1 / 30);
    const t0 = performance.now();
    for (let i = 0; i < 600; i++) TR.tick(1 / 30);
    return { cars: TR.cars.length, ms: (performance.now() - t0) / 600 };
  });
  check(perf.cars > 60 && perf.ms < 1.0, `${perf.cars} cars cost ${perf.ms.toFixed(3)} ms per step`);
  check(!errors.length, `no errors (${errors.slice(0, 2).join(' | ')})`);
  await ctx.close();
  return { ok, lines };
}
