// Road transport (src/road/Roads.js): company roads, stops, buses and trucks.
// A bus line between two towns earns and books per vehicle; a feeder stop
// hands passengers to a railway station; a road across a busy railway gets a
// level crossing and no bus is ever on it while a train is; save/load; the
// road and stop tools with real mouse input.
import { openPage, loadSave, productionSave, startTestGame } from '../lib.mjs';

export const name = 'roads';
export async function run({ browser, base }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 1280, height: 800 } });
  await loadSave(page, productionSave());
  const r = await page.evaluate(async () => {
    const g = window.__tracklands.game, R = g.roads, N = 64, out = {};
    g.economy.coins = 1e6;
    const open = g.towns.list.filter((t) => g.progression.regionUnlocked(t.region) && t.roadSet && t.roadSet.size);
    // two towns joined by a new road: a bus line between them
    let pair = null;
    for (let i = 0; i < open.length && !pair; i++) for (let j = i + 1; j < open.length && !pair; j++) {
      const a = [...open[i].roadSet].find((k) => !g.net.conn[k]), b = [...open[j].roadSet].find((k) => !g.net.conn[k]);
      const p = R.plan(a, b);
      if (p.ok) pair = { a, b, p, ta: open[i], tb: open[j] };
    }
    out.pair = !!pair;
    if (!pair) return out;
    R.build(pair.p);
    out.crossingsOnRoute = pair.p.crossings;
    const A = R.addStop(pair.a, 'bus').stop, B = R.addStop(pair.b, 'bus').stop;
    const bus = R.buy('citybus', A).vehicle;
    bus.stops.push(B.id);
    const pax0 = g.stats.data.passengers || 0;
    for (let i = 0; i < 30 * 300; i++) g.tick(1 / 30);
    const f = g.ledger.objFin(bus);
    out.line = { towns: `${pair.ta.name} → ${pair.tb.name}`, tiles: pair.p.tiles.length, trips: bus.trips, earned: Math.round(bus.earned), rev: Math.round(f.lifeRev), cost: Math.round(f.lifeCost), pax: (g.stats.data.passengers || 0) - pax0 };
    out.booked = g.ledger.log.some((e) => e.ref && e.ref.type === 'road' && e.cat === 'pax') && (g.ledger.cur.exp.op_road || 0) + g.ledger.months.reduce((s, m) => s + (m.exp.op_road || 0), 0) > 0;
    // feeder: a stop next to a railway station hands its passengers over
    // (a station of the same town as a bus stop: its passengers change to the trains)
    let home = B, st = g.stations.list.find((s) => s.links && s.links.towns.includes(pair.tb.id));
    if (!st) { home = A; st = g.stations.list.find((s) => s.links && s.links.towns.includes(pair.ta.id)); }
    if (!st) return out;
    let near = -1;
    for (let d = 1; d <= 3 && near < 0; d++) for (let dz = -d; dz <= d && near < 0; dz++) for (let dx = -d; dx <= d && near < 0; dx++) { const i = st.tile + dz * N + dx; if (R.tileOk(i) && !g.net.conn[i] && !R.stopAt(i)) near = i; }
    const p2 = R.plan(home.tile, near);
    if (p2.ok) {
      R.build(p2);
      const F = R.addStop(near, 'bus').stop;
      st.stock = {};   // room at the station
      const feeder = R.buy('citybus', home).vehicle;
      feeder.stops.push(F.id);
      // (trains take the station's passengers away; here: every second)
      for (let i = 0; i < 30 * 240; i++) { g.tick(1 / 30); if (i % 30 === 0) st.stock = {}; }
      out.feeder = { rail: F.rail === st.id, transfers: F.stats.transfers + home.stats.transfers, earned: Math.round(feeder.earned), home: home.name + JSON.stringify(home.links.towns), F: JSON.stringify(F.links.towns), st: st.name + ' stock ' + JSON.stringify(st.stock) + ' cap ' + g.stations.storage(st), cargo: JSON.stringify(feeder.cargo.map((l) => l.c + l.n + '@' + l.from)) };
    }
    // save/load
    const S = await import('./src/save/Save.js');
    const d = S.migrate(JSON.parse(JSON.stringify(g.serialize())));
    out.saved = { valid: S.validate(d) === null, roads: d.road.roads.length / 2, stops: d.road.stops.length, vehicles: d.road.vehicles.length };
    window.__rs = d;
    out.sig = JSON.stringify([R.stops.map((s) => s.tile), R.vehicles.map((v) => v.stops)]);
    return out;
  });
  check(r.pair, 'two towns can be joined by road');
  if (r.pair) {
    check(r.line.trips >= 4 && r.line.pax > 0 && r.line.rev > 0, `bus line ${r.line.towns} (${r.line.tiles} tiles): ${r.line.trips} stops, ${r.line.pax} passengers, revenue ${r.line.rev}, running costs ${r.line.cost}`);
    check(r.booked, 'bus revenue and running costs are booked in the ledger per vehicle');
    check(!r.feeder || (r.feeder.rail && r.feeder.transfers > 0), `feeder stop hands passengers to the railway: ${JSON.stringify(r.feeder)}`);
    check(r.saved.valid && r.saved.roads > 0 && r.saved.stops >= 2 && r.saved.vehicles >= 1, `roads, stops and vehicles saved: ${JSON.stringify(r.saved)}`);
    const keep = await page.evaluate(() => window.__rs);
    await loadSave(page, keep);
    const sig2 = await page.evaluate(() => { const R = window.__tracklands.game.roads; return JSON.stringify([R.stops.map((s) => s.tile), R.vehicles.map((v) => v.stops)]); });
    check(sig2 === r.sig, 'after reload the stops and routes are the same');
  }
  // a road across a busy railway: level crossing, never a bus on it with a train
  await startTestGame(page, 7);
  const x = await page.evaluate(async () => {
    const g = window.__tracklands.game, R = g.roads, T = g.trains, N = 64;
    const { RailTests } = await import('./src/debug/RailTests.js');
    const RT = new RailTests(g);
    g.economy.coins = 1e6;
    for (let i = 0; i < 8; i++) g.progression.regions.add(i);
    const a = RT.findArea(18, 9);
    if (!a) return { none: true };
    const z = a.z0 + 4, x0 = a.x0 + 1;
    RT.line(x0, z, x0 + 13, z);
    RT.finish();
    const sA = RT.station(x0 + 2, z), sB = RT.station(x0 + 12, z);
    const D = RT.depot(x0 + 14, z);
    g.net.connect(z * N + x0 + 13, 0);
    RT.finish();
    const t = RT.train(['L:pioneer', 'W:coach', 'W:coach'], D, [sA, sB]);
    // road across the line at x0+7, stops either side
    const n = (z - 3) * N + x0 + 7, s = (z + 3) * N + x0 + 7;
    const plan = R.plan(n, s);
    if (!plan.ok) return { road: plan.reason };
    R.build(plan);
    const sa = R.addStop(n, 'bus'), sb = R.addStop(s, 'bus');
    if (sa.error || sb.error) return { stop: sa.error || sb.error };
    const buses = [R.buy('citybus', sa.stop).vehicle, R.buy('citybus', sb.stop).vehicle];
    buses[0].stops.push(sb.stop.id); buses[1].stops.push(sa.stop.id);
    const xt = z * N + x0 + 7;
    let bad = 0, both = 0, closed = 0;
    for (let i = 0; i < 30 * 240; i++) {
      g.tick(1 / 30);
      if (i % 2 === 0) g.crossings.update(2 / 30);
      const train = T.tileOccupied(xt);
      // on the crossing: its centre past the near edge, or its rear not yet past the far edge
      const bus = R.vehicles.some((v) => (v.tile === xt && (!v.path || v.f - R.halfLen(v) < 0.5)) || (v.path && v.path[v.pi + 1] === xt && v.f > 0.5));
      if (train && bus) bad++;
      if (train) both++;
      if (g.crossings.isClosed(xt)) closed++;
    }
    return { crossing: !!g.crossings.at(xt), bad, trainOn: both, closed, busTrips: R.vehicles.reduce((s2, v) => s2 + v.trips, 0), trainTrips: t ? t.trips : 0 };
  });
  check(!x.none && x.crossing, `a road across the line gets a level crossing (${JSON.stringify(x)})`);
  if (x.crossing) {
    check(x.trainTrips >= 2 && x.busTrips >= 4 && x.trainOn > 0, `trains and buses both keep running across it (train trips ${x.trainTrips}, bus stops ${x.busTrips})`);
    check(x.bad === 0, `no bus on the crossing while a train is (${x.bad})`);
  }
  // the tools with the mouse: road drag, stop tap, inspector buy
  const ui = await page.evaluate(() => {
    const g = window.__tracklands.game, R = g.roads, N = 64;
    const t = g.towns.list.find((x) => g.progression.regionUnlocked(x.region) && x.roadSet && x.roadSet.size);
    const street = [...t.roadSet].find((k) => !g.net.conn[k]);
    // an empty stretch west or east of the street
    for (const dx of [3, -3, 4, -4]) { const b = street + dx; if (R.tileOk(b) && R.plan(street, b).ok) { window.__focus = [((street % N) + 0.5) * 2, (Math.floor(street / N) + 0.5) * 2]; g.camera.focus(window.__focus[0], window.__focus[1], 18); return { a: street, b }; } }
    return null;
  });
  if (ui) {
    await page.waitForFunction(() => { const t = window.__tracklands.game.camera.target, f = window.__focus; return Math.abs(t.x - f[0]) + Math.abs(t.z - f[1]) < 0.15; }, null, { polling: 100, timeout: 30000 });
    const scr = (tile) => page.evaluate((tt) => { const g = window.__tracklands.game, cam = g.camera.camera; const v = new cam.position.constructor(((tt % 64) + 0.5) * 2, g.world.view.heightAt(((tt % 64) + 0.5) * 2, (Math.floor(tt / 64) + 0.5) * 2), (Math.floor(tt / 64) + 0.5) * 2).project(cam); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; }, tile);
    const pa = await scr(ui.a), pb = await scr(ui.b);
    await page.click('#tool-road');
    await page.mouse.move(pa[0], pa[1]); await page.mouse.down(); await page.mouse.move(pb[0], pb[1], { steps: 10 }); await page.mouse.up();
    await page.waitForTimeout(200);
    const built = await page.evaluate((b) => window.__tracklands.game.roads.hasRoad(b), ui.b);
    check(built, 'road tool: dragging with the mouse builds a road');
    await page.click('#tool-roadstop');
    await page.mouse.click(pb[0], pb[1]);
    await page.waitForTimeout(300);
    const stop = await page.evaluate((b) => !!window.__tracklands.game.roads.stopAt(b), ui.b);
    check(stop, 'stop tool: tapping a road tile builds a bus stop and opens it');
    const buy = await page.$('#inspector [data-act=rvBuy]:not([disabled])');
    if (buy) { await page.click('#inspector [data-act=rvBuy]:not([disabled])'); await page.waitForTimeout(200); }
    const vehs = await page.evaluate(() => window.__tracklands.game.roads.vehicles.length);
    check(!!buy && vehs >= 1, 'the stop panel buys a bus');
  }
  if (errors.length) { ok = false; lines.push('errors: ' + errors.slice(0, 2).join(' | ')); }
  await ctx.close();
  return { ok, lines };
}
