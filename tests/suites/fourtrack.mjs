// Four-track corridors (Phase 11): a second pair built beside a line in one
// transaction (crossovers at both ends, one undo step, charged once), track
// roles (the old pair local, the new one express), an express train that
// keeps to its pair and runs past a slow freight train that keeps to the
// local pair, a train falling back to the other pair when its own is cut,
// a flyover crossing the corridor without joining it, and roles kept by a
// save. Regression guards: wrong track, double charging, graph errors.
import { openPage, loadSave, ensureOut } from '../lib.mjs';
import path from 'path';

export const name = 'fourtrack';
export async function run({ browser, base }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 1280, height: 800 } });
  await page.evaluate(() => { const app = window.__tracklands; document.querySelectorAll('.modal-wrap').forEach((m) => m.remove()); if (app.game) { app.ui.detach(); app.game.dispose(); app.game = null; } app.startGame({ seed: 6161, difficulty: 'builder', test: true, paused: true, mapSize: 192, terrain: { preset: 'plains', towns: 0.2 } }); });
  await page.waitForFunction(() => window.__tracklands.game && window.__tracklands.game.running, null, { timeout: 60000 });
  await page.evaluate(() => { const g = window.__tracklands.game; g.tutorial.skip(); for (let r = 0; r < 8; r++) g.progression.regions.add(r); });
  const r = await page.evaluate(async () => {
    const g = window.__tracklands.game, U = await import('./src/util.js'), net = g.net, C = g.construction, S = g.stations;
    const { N, idx } = U;
    for (const id of ['urban_rail', 'electric_rail', 'block_signals', 'path_signals']) g.progression.research.add(id);
    g.progression.level = 50;
    g.economy.coins = 5e7;
    const free = (x, z) => { const i = idx(x, z); return x >= 1 && z >= 1 && x < N - 1 && z < N - 1 && g.world.type[i] === 0 && !g.occupancy.blocked[i] && !net.conn[i] && g.net.isUnlocked(i) && !(g.roads.hasRoad && g.roads.hasRoad(i)) && g.world.mtn[i] < 0.05; };
    let X = -1, Z = -1;
    for (let z = 6; z < N - 12 && X < 0; z++) for (let x = 2; x < N - 34 && X < 0; x++) {
      let okA = true;
      for (let dz = -5; dz <= 5 && okA; dz++) for (let dx = 0; dx < 32 && okA; dx++) if (!free(x + dx, z + dz)) okA = false;
      if (okA) { X = x; Z = z; }
    }
    if (X < 0) return { error: 'no free strip' };
    const T = (x, z) => idx(X + x, Z + z);
    const out = {};
    // the line with a station at each end (two platforms each)
    out.line = C.trackOp(T(0, 0), T(31, 0), 1, 'double').error || 'ok';
    const sA = S.build(T(2, 0), 0).station, sB = S.build(T(28, 0), 0).station;
    for (const s of [sA, sB]) { S.extendPlatform(s, 0, 1); S.extendPlatform(s, 0, 1); S.extendPlatform(s, 0, 0); S.addTrack(s, 1); }
    out.plats = [sA, sB].map((s) => s.tracks.length + 'x' + s.tracks[0].tiles.length);
    // the second pair on the south side, express roles
    C.pairSide = 1; C.pairRoles = 'express';
    const dry = C.trackOp(T(8, 0), T(22, 0), 1, 'pair', true);
    const coins0 = g.economy.coins, u0 = C.undoStack.length;
    const res = C.trackOp(T(8, 0), T(22, 0), 1, 'pair');
    out.pair = res.error || 'ok';
    out.charged = Math.round(coins0 - g.economy.coins);
    out.dryCost = dry.cost;
    out.undoSteps = C.undoStack.length - u0;
    const side = net.conn[T(15, 1)] ? 1 : net.conn[T(15, -1)] ? -1 : 0;
    out.side = side;
    out.roles = { local: net.roleOf(T(15, 0)), express: net.roleOf(T(15, side)) };
    out.graph = net.validateGraph(10).map((e) => `${e.kind}@${e.tile}`);
    // undo and build again: the same result, charged again once
    C.undo();
    out.afterUndo = { conn: net.conn[T(15, side)], role: net.roleOf(T(15, 0)), coins: Math.round(g.economy.coins - coins0) };
    C.trackOp(T(8, 0), T(22, 0), 1, 'pair');
    out.rebuilt = !!net.conn[T(15, side)] && net.roleOf(T(15, side)) === 2;
    // the depot and two trains: a slow freight train first, an express after it
    let dep = null;
    for (const t of [T(1, 1), T(1, -1), T(0, 1), T(0, -1), T(31, 1)]) { const d = S.buildDepot(t); if (d.depot && net.conn[t]) { dep = d.depot; break; } if (d.depot) S.removeDepot(d.depot); }
    out.depot = !!dep;
    const buy = (loco) => { const r = g.trains.buy(loco, dep); const t = r.train; if (t) { t.mode = 'manual'; t.route = [sA, sB].map((s) => ({ st: s.id, act: 'auto', dwell: 0, full: false, skip: false, plat: null, cargo: null })); t.routeIdx = 0; } return t; };
    const fr = buy('coalgate');
    for (let k = 0; k < 200; k++) g.tick(1 / 20);
    const ex = buy('silverline');
    out.cls = [fr, ex].map((t) => t ? g.trains.roleClass(t) : -1);
    const pairTiles = new Set(), localTiles = new Set();
    for (let x = 10; x <= 20; x++) { pairTiles.add(T(x, side)); localTiles.add(T(x, 0)); }
    const seen = { exPair: 0, exLocal: 0, frPair: 0, frLocal: 0, side: 0 };
    g.paused = false;
    const heads = (t) => (t && t.steps && t.steps.length ? t.steps[g.trains.stepAt(t, t.s)].tile : -1);
    for (let k = 0; k < 9000; k++) {
      g.tick(1 / 20);
      if (k % 5) continue;
      const he = heads(ex), hf = heads(fr);
      if (pairTiles.has(he)) seen.exPair++; if (localTiles.has(he)) seen.exLocal++;
      if (pairTiles.has(hf)) seen.frPair++; if (localTiles.has(hf)) seen.frLocal++;
      // side by side: both between the crossovers at once
      if (pairTiles.has(he) && localTiles.has(hf)) seen.side++;
    }
    out.seen = seen;
    out.trips = { ex: ex ? ex.trips : 0, fr: fr ? fr.trips : 0 };
    out.collisions = g.trains.collisions;
    // fallback: the express pair is cut in the middle; the express still runs
    const trips0 = ex.trips;
    let cut = C.removeTrackOp(T(15, side));
    for (let k = 0; k < 3000 && cut.error === 'err_train_on_track'; k++) { g.tick(1 / 20); cut = C.removeTrackOp(T(15, side)); }
    out.cut = cut.error || 'ok';
    for (let k = 0; k < 6000; k++) g.tick(1 / 20);
    out.fallback = ex.trips - trips0;
    out.stuck = [ex, fr].filter((t) => t.state === 'run' && t.wait > 150).map((t) => t.name);
    // a flyover: a viaduct from a line on the north side crosses both pairs
    C.trackOp(T(15, -5), T(15, -3), 1, 'double');
    C.setLayer(3);
    out.fly = C.trackOp(T(15, -3), T(15, 4), 1, 'double', false, 3).error || 'ok';
    C.setLayer(0);
    out.flyGraph = net.validateGraph(10).length;
    out.flyApart = [T(15, 0), T(15, side)].every((t) => (net.conn[t] & 0b01000100) === 0);
    out.cost = { pairRow: g.ui.tr('track_pair'), roles: net.serialize().roles ? 'saved' : 'missing' };
    return out;
  });
  if (r.error) { check(false, r.error); await ctx.close(); return { ok, lines }; }
  check(r.line === 'ok' && r.plats.every((p) => /^2x/.test(p)), `a double-track line between two two-platform stations (${r.plats.join(', ')})`);
  check(r.pair === 'ok' && r.side !== 0 && r.graph.length === 0, `a second pair beside it (side ${r.side}); the graph is valid${r.graph.length ? ': ' + r.graph.join(',') : ''}`);
  check(r.charged === r.dryCost && r.charged > 0 && r.undoSteps === 1, `charged once for the whole pair (${r.charged} ● = estimate ${r.dryCost} ●), one undo step`);
  check(r.roles.local === 1 && r.roles.express === 2, `roles: the old pair local, the new pair express (${JSON.stringify(r.roles)})`);
  check(!r.afterUndo.conn && r.afterUndo.role === 0 && r.afterUndo.coins === 0 && r.rebuilt, `undo removes the pair and its roles and refunds it (${JSON.stringify(r.afterUndo)}); built again`);
  check(r.depot && r.cls[0] === 3 && r.cls[1] === 2, `a freight train and an express train (classes ${r.cls.join(', ')})`);
  check(r.seen.exPair > 0 && r.seen.exLocal === 0, `the express keeps to the express pair (${r.seen.exPair} samples on it, ${r.seen.exLocal} on the local pair)`);
  check(r.seen.frLocal > 0 && r.seen.frPair === 0, `the freight train keeps to the local pair (${r.seen.frLocal} / ${r.seen.frPair})`);
  check(r.seen.side > 0 && r.trips.ex > r.trips.fr && r.collisions === 0, `they run side by side (${r.seen.side} samples); the express makes more trips (${r.trips.ex} vs ${r.trips.fr}); no collisions`);
  check(r.cut === 'ok' && r.fallback >= 1 && r.stuck.length === 0, `with the express pair cut the express falls back to the local pair (${r.fallback} more trips, stuck: ${r.stuck.join(',') || 'none'})`);
  check(r.fly === 'ok' && r.flyGraph === 0 && r.flyApart, `a flyover crosses both pairs without joining them (${r.fly})`);
  const out = ensureOut();
  await page.evaluate(() => { const g = window.__tracklands.game; g.overlays.set('roles'); });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, 'fourtrack-roles.png') });
  // roles survive a save
  const sv = await page.evaluate(async () => {
    const g = window.__tracklands.game, S = await import('./src/save/Save.js');
    window.__fsave = S.migrate(JSON.parse(JSON.stringify(g.serialize())));
    let n = 0; for (let i = 0; i < g.net.role.length; i++) if (g.net.roleOf(i)) n++;
    return n;
  });
  await loadSave(page, await page.evaluate(() => window.__fsave));
  const ld = await page.evaluate(() => { const g = window.__tracklands.game; let n = 0; for (let i = 0; i < g.net.role.length; i++) if (g.net.roleOf(i)) n++; return { n, graph: g.net.validateGraph(5).length }; });
  check(sv > 20 && ld.n === sv && ld.graph === 0, `save and load keep ${sv} tiles with a role`);
  // the build bar offers the modes
  const ui = await page.evaluate(() => { const g = window.__tracklands.game; g.construction.setTool('track'); g.construction.setTrackMode('pair'); g.ui.renderToolbar && g.ui.renderToolbar(); const html = document.body.innerHTML; g.construction.setTrackMode('double'); return { pair: /data-arg="pair"/.test(html), role: /data-arg="role"/.test(html), side: /data-act="pairSide"/.test(html) }; });
  check(ui.pair && ui.role && ui.side, `the track bar offers “second pair” and “track role” (${JSON.stringify(ui)})`);
  if (errors.length) { ok = false; lines.push('errors: ' + errors.slice(0, 3).join(' | ')); }
  await ctx.close();
  return { ok, lines };
}
