// The metro (Phase 11): a line dug from a surface depot through a portal to
// two underground stations, run by a metro set (short dwell, quick reversal);
// a surface station beside a metro station is a walking transfer with stairs;
// tunnels and metro stations cost upkeep each month in the ledger; the
// inspector shows the level, platforms, entrance and upkeep; save and load.
import { openPage, loadSave, ensureOut } from '../lib.mjs';
import path from 'path';

export const name = 'metro';
export async function run({ browser, base }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 1280, height: 800 } });
  await page.evaluate(() => { const app = window.__tracklands; document.querySelectorAll('.modal-wrap').forEach((m) => m.remove()); if (app.game) { app.ui.detach(); app.game.dispose(); app.game = null; } app.startGame({ seed: 6161, difficulty: 'builder', test: true, paused: true, mapSize: 128, terrain: { preset: 'plains', towns: 0.5 } }); });
  await page.waitForFunction(() => window.__tracklands.game && window.__tracklands.game.running, null, { timeout: 60000 });
  await page.evaluate(() => { const g = window.__tracklands.game; g.tutorial.skip(); for (let r = 0; r < 8; r++) g.progression.regions.add(r); });
  const r = await page.evaluate(async () => {
    const g = window.__tracklands.game, U = await import('./src/util.js'), net = g.net, C = g.construction, S = g.stations;
    const { N, idx, onLayer, layerOf } = U;
    for (const id of ['urban_rail', 'deep_tunnelling', 'electric_rail', 'block_signals']) g.progression.research.add(id);
    g.progression.level = 50;
    g.economy.coins = 5e7;
    const free = (x, z) => { const i = idx(x, z); return x >= 1 && z >= 1 && x < N - 1 && z < N - 1 && g.world.type[i] === 0 && !g.occupancy.blocked[i] && !net.conn[i] && g.net.isUnlocked(i) && !(g.roads.hasRoad && g.roads.hasRoad(i)) && g.world.mtn[i] < 0.05; };
    let X = -1, Z = -1;
    for (let z = 5; z < N - 12 && X < 0; z++) for (let x = 2; x < N - 30 && X < 0; x++) {
      let okA = true;
      for (let dz = -4; dz <= 4 && okA; dz++) for (let dx = 0; dx < 28 && okA; dx++) if (!free(x + dx, z + dz)) okA = false;
      if (okA) { X = x; Z = z; }
    }
    if (X < 0) return { error: 'no free strip' };
    const T = (x, z) => idx(X + x, Z + z);
    const out = {};
    // a surface stub with the depot, a portal at 4, the metro line to 25
    C.setLayer(0);
    out.t0 = C.trackOp(T(1, 0), T(4, 0), 2, 'double').error || 'ok';
    C.setLayer(1);
    out.t1 = C.trackOp(T(4, 0), T(25, 0), 2, 'double', false, 1).error || 'ok';
    const A = onLayer(T(9, 0), 1), B = onLayer(T(21, 0), 1);
    out.sa = S.build(A, 0).error || 'ok';
    out.sb = S.build(B, 0).error || 'ok';
    const sA = S.list.find((s) => s.tile === A), sB = S.list.find((s) => s.tile === B);
    if (sA) S.extendPlatform(sA, 0, 1);
    if (sB) S.extendPlatform(sB, 0, 1);
    // a surface station beside metro station A (a separate little line)
    C.setLayer(0);
    C.trackOp(T(8, 3), T(13, 3), 0, 'double');
    out.ss = S.build(T(10, 3), 0).error || 'ok';
    const sS = S.list.find((s) => s.tile === T(10, 3));
    out.plat = [sA, sB].map((s) => s ? s.tracks[0].tiles.length : 0);
    out.kinds = [sA, sB].map((s) => s && S.stationKind(s).kind);
    out.entr = [sA, sB].map((s) => s ? s.entrance : -1);
    out.graph = net.validateGraph(10).map((e) => `${e.kind}@${e.tile}`);
    // the depot on the surface stub and a metro set
    let dep = null;
    for (const t of [T(2, 1), T(2, -1), T(3, 1), T(3, -1)]) { const d = S.buildDepot(t); if (d.depot && net.conn[t]) { dep = d.depot; break; } if (d.depot) S.removeDepot(d.depot); }
    out.depot = !!dep;
    let t = null;
    if (dep && sA && sB) {
      const res = g.trains.buy('metro_classic_a', dep);
      out.buy = res.error || 'ok';
      t = res.train;
      if (t) { t.mode = 'manual'; t.route = [sA, sB].map((s) => ({ st: s.id, act: 'auto', dwell: 0, full: false, skip: false, plat: null, cargo: null })); t.routeIdx = 0; }
    }
    out.metro = t ? g.trains.isMetro(t) : false;
    // a surface train on the same stub would not be a metro
    g.paused = false;
    let maxLoad = 0, maxRev = 0;
    for (let k = 0; k < 5000 && t; k++) {
      g.tick(1 / 20);
      if (t.state === 'loading' && t.loadTime) maxLoad = Math.max(maxLoad, t.loadTime);
      if (t.rev && t.rev.dur) maxRev = Math.max(maxRev, t.rev.dur);
    }
    out.trips = t ? t.trips : 0;
    out.rev = maxRev;
    out.arrA = sA ? sA.stats.arrivals : 0; out.arrB = sB ? sB.stats.arrivals : 0;
    // the transfer between the metro platform and the surface station: a walk with stairs
    g.network.dirty = true; g.network.ensure();
    const nk = (s) => [...g.network.nodes.keys()].find((k) => g.network.nodes.get(k).o === s);
    const ka = sA && nk(sA), ks = sS && nk(sS);
    const walk = ka && ks ? g.network.nodes.get(ka).out.find((e) => e.walk && (e.to === ks || e.b === ks || e.dst === ks)) : null;
    out.walk = walk ? Math.round(walk.ivt) : null;
    out.walkKeys = walk ? Object.keys(walk).join(',') : (ka && g.network.nodes.get(ka).out[0] ? Object.keys(g.network.nodes.get(ka).out[0]).join(',') : 'none');
    // upkeep: one month of tunnels and stations in the ledger
    const L = g.ledger, c0 = (L.cur.exp.maint_track || 0), s0 = (L.cur.exp.maint_station || 0);
    const sums = g.economy.infraUpkeep();
    out.upkeep = { sums: sums[0], track: Math.round((L.cur.exp.maint_track || 0) - c0), station: Math.round((L.cur.exp.maint_station || 0) - s0) };
    // the inspector
    g.select({ type: 'station', id: sA.id });
    g.ui.openInspector && g.ui.openInspector();
    await new Promise((res) => setTimeout(res, 50));
    out.pills = document.querySelector('.metro-pills') ? document.querySelector('.metro-pills').textContent : (g.ui.metroPills ? g.ui.metroPills(sA).replace(/<[^>]+>/g, ' ') : '');
    out.cost = { ug: g.economy.costs.station(A), surf: g.economy.costs.station(T(10, 3)) };
    // picking across levels: the underground view picks the metro station under the ground tile;
    // the surface view picks it through its entrance and the surface station where it stands
    const pick = (t) => { g.select(null); g.selectTile(t); return g.selection ? g.selection.type + ':' + g.selection.id : 'none'; };
    g.layerView.set('underground');
    out.pickUg = pick(T(9, 0)) === 'station:' + sA.id;
    g.layerView.set('surface');
    out.pickEntrance = pick(sA.entrance) === 'station:' + sA.id;
    out.pickSurface = pick(T(10, 3)) === 'station:' + sS.id;
    out.pickUgFromSurface = pick(T(20, 5));
    return out;
  });
  if (r.error) { check(false, r.error); await ctx.close(); return { ok, lines }; }
  check(r.t0 === 'ok' && r.t1 === 'ok' && r.sa === 'ok' && r.sb === 'ok' && r.ss === 'ok', `a metro line through a portal with two underground stations and a surface station beside one (${r.t0}/${r.t1}/${r.sa}/${r.sb}/${r.ss})`);
  check(r.kinds.every((k) => k === 'metro_cut') && r.entr.every((e) => e >= 0), `both are cut-and-cover metro stations with a street entrance (${r.kinds.join(', ')}; entrances ${r.entr.join(', ')})`);
  check(r.plat.every((n) => n >= 2), `metro platforms can be lengthened underground (${r.plat.join(', ')} tiles; once refused as bad terrain)`);
  check(r.graph.length === 0, `the rail graph is valid${r.graph.length ? ': ' + r.graph.join(', ') : ''}`);
  check(r.depot && r.buy === 'ok' && r.metro, `a metro set from a surface depot (buy ${r.buy})`);
  check(r.trips >= 4 && r.arrA >= 2 && r.arrB >= 2, `it shuttles between the metro stations: ${r.trips} trips, arrivals ${r.arrA}/${r.arrB}`);
  check(r.rev > 0 && r.rev <= 0.5, `a metro set reverses quickly (${r.rev} s)`);
  check(r.walk != null && r.walk > 20 + 12, `the surface station is a walking transfer with a flight of stairs (${r.walk} s; edge ${r.walkKeys})`);
  check(r.upkeep.sums && r.upkeep.sums.track > 20 && r.upkeep.track > 0 && r.upkeep.station > 0, `upkeep for tunnels and metro stations is booked (${r.upkeep.track} ● track, ${r.upkeep.station} ● stations)`);
  check(/Tunnel|tunnel/.test(r.pills) && /Depth|Ebene/.test(r.pills) && /Upkeep|Unterhalt/.test(r.pills), `the inspector shows level and upkeep: “${r.pills.trim().replace(/\s+/g, ' ')}”`);
  check(r.pickUg && r.pickEntrance && r.pickSurface, `picking across levels: the underground view finds the metro station (${r.pickUg}), its street entrance picks it (${r.pickEntrance}), the surface station stays pickable (${r.pickSurface})`);
  check(r.cost.ug > r.cost.surf * 3, `a metro station costs more than a surface one (${r.cost.ug} vs ${r.cost.surf})`);
  const out = ensureOut();
  await page.evaluate(() => { const g = window.__tracklands.game; g.layerView.set('underground'); });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, 'metro-underground.png') });
  await page.evaluate(() => window.__tracklands.game.layerView.set('surface'));
  // save and load
  const sv = await page.evaluate(async () => {
    const g = window.__tracklands.game, S = await import('./src/save/Save.js');
    window.__msave = S.migrate(JSON.parse(JSON.stringify(g.serialize())));
    return { st: g.stations.list.filter((s) => g.stations.isUnderground(s)).map((s) => s.tile + ':' + s.entrance).join(','), trains: g.trains.trains.length };
  });
  await loadSave(page, await page.evaluate(() => window.__msave));
  const ld = await page.evaluate(() => { const g = window.__tracklands.game; return { st: g.stations.list.filter((s) => g.stations.isUnderground(s)).map((s) => s.tile + ':' + s.entrance).join(','), trains: g.trains.trains.length, metro: g.trains.trains.some((t) => g.trains.isMetro(t)), graph: g.net.validateGraph(5).length }; });
  check(ld.st === sv.st && ld.trains === sv.trains && ld.metro && ld.graph === 0, `save and load keep the metro stations, entrances and the metro set (${ld.st})`);
  // ---- a rival builds a metro: only for a city, paid by itself, once ----
  await page.evaluate(() => { const app = window.__tracklands; document.querySelectorAll('.modal-wrap').forEach((m) => m.remove()); app.ui.detach(); app.game.dispose(); app.game = null; app.startGame({ seed: 8181, difficulty: 'standard', test: true, paused: true, mapSize: 128, rivals: 1, startYear: 1970, terrain: { preset: 'plains', towns: 0.6 } }); });
  await page.waitForFunction(() => window.__tracklands.game && window.__tracklands.game.running, null, { timeout: 60000 });
  const ai = await page.evaluate(async () => {
    const g = window.__tracklands.game;
    g.tutorial.skip();
    for (let k = 0; k < 8; k++) g.progression.regions.add(k);
    const r = g.rivals.list.find((x) => x.rail) || g.rivals.list[0];
    if (!r.rail) r.rail = {};
    const P = g.rivals.planner(r);
    const out = { rail: !!P };
    if (!P) return out;
    // small towns only: no metro
    r.money = 5e6;
    out.small = P.metroIdea();
    delete r.rail.memory.metro;
    // one town grows into a city
    const t = g.towns.list.slice().sort((a, b) => b.pop - a.pop)[0];
    for (let k = 0; k < 6 && t.stage < 4; k++) g.towns.levelUp(t);
    out.stage = t.stage;
    const coins0 = g.economy.coins, money0 = r.money;
    out.built = P.metroIdea();
    const p = r.rail.projects.find((x) => x.kind === 'metro');
    out.log = r.rail.log.slice(-3).map((e) => e.text);
    if (!p) return out;
    out.stations = p.stations.map((id) => g.stations.byId(id)).map((s) => s && `${s.owner}:${g.stations.isUnderground(s)}:${s.entrance >= 0}`);
    out.paid = Math.round(money0 - r.money);
    out.playerPaid = Math.round(coins0 - g.economy.coins);
    out.graph = g.net.validateGraph(5).map((e) => e.kind + '@' + e.tile);
    const tr = p.trains.map((id) => g.trains.byId(id)).filter(Boolean);
    out.train = tr.map((x) => x.veh.find((v) => v.k === 'L').id).join(',');
    delete r.rail.memory.metro;
    out.second = P.metroIdea();
    // it runs: two months
    for (let s = 0; s < 900; s++) g.tick(4 / 30);
    out.trips = tr.reduce((a, x) => a + x.trips, 0);
    // the rival pays its own upkeep
    const m1 = r.money, c1 = g.economy.coins;
    const sums = g.economy.infraUpkeep();
    out.upkeep = { rival: Math.round(m1 - r.money), player: Math.round(c1 - g.economy.coins), sums: JSON.stringify(sums) };
    return out;
  });
  check(ai.rail && !ai.small, `a rival railway builds no metro while its towns are small (${ai.small})`);
  check(ai.built && ai.stations && ai.stations.every((x) => /^r\d:true:true$/.test(x)), `once a town is a city (stage ${ai.stage}) it opens a metro: stations ${JSON.stringify(ai.stations)}; ${JSON.stringify(ai.log)}`);
  check(ai.paid > 0 && ai.playerPaid === 0 && ai.graph && ai.graph.length === 0, `the rival paid ${ai.paid} ●, the player nothing (${ai.playerPaid}); graph ${ai.graph ? ai.graph.join(',') || 'valid' : '-'}`);
  check(/metro/.test(ai.train || '') && ai.trips >= 2 && !ai.second, `its metro set (${ai.train}) runs (${ai.trips} trips); no second metro`);
  check(ai.upkeep && ai.upkeep.rival > 0 && ai.upkeep.player === 0, `the rival pays its own upkeep (${ai.upkeep && ai.upkeep.rival} ●, player ${ai.upkeep && ai.upkeep.player})`);
  if (errors.length) { ok = false; lines.push('errors: ' + errors.slice(0, 3).join(' | ')); }
  await ctx.close();
  return { ok, lines };
}
