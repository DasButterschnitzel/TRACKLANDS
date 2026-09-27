// Infrastructure layers (Phase 11): a tunnel dug from a track end gets a
// portal; surface track built across it does not connect (grade separation);
// a train runs from a surface station through the portal to a metro station
// underground and back; a viaduct crosses a surface line without joining it;
// the graph stays valid; undo removes a tunnel with its portal; saves keep
// the layers and links; an older save loads on the surface only.
import { openPage, loadSave, productionSave, ensureOut } from '../lib.mjs';
import path from 'path';
import fs from 'fs';

export const name = 'layers';
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
    // a free straight strip of open land in the start region, 24 x 9 tiles
    const free = (x, z) => { const i = idx(x, z); return x >= 1 && z >= 1 && x < N - 1 && z < N - 1 && g.world.type[i] === 0 && !g.occupancy.blocked[i] && !net.conn[i] && g.net.isUnlocked(i) && !(g.roads.hasRoad && g.roads.hasRoad(i)) && g.world.mtn[i] < 0.05; };
    let X = -1, Z = -1;
    for (let z = 5; z < N - 12 && X < 0; z++) for (let x = 2; x < N - 26 && X < 0; x++) {
      let okA = true;
      for (let dz = -4; dz <= 4 && okA; dz++) for (let dx = 0; dx < 24 && okA; dx++) if (!free(x + dx, z + dz)) okA = false;
      if (okA) { X = x; Z = z; }
    }
    if (X < 0) return { error: 'no free strip' };
    const T = (x, z) => idx(X + x, Z + z);
    const out = { X, Z };
    // surface: station at 1..2, track to 6 (a dead end at 6)
    let st = S.build(T(1, 0), 0); out.st1 = st.error || 'ok';
    S.extendPlatform(S.byId(st.station ? st.station.id : S.list[S.list.length - 1].id), 0, 1);
    C.setLayer(0);
    out.t1 = C.trackOp(T(2, 0), T(6, 0), 2, 'double').error || 'ok';
    // tunnel from the track end at 6 to 16: a portal at 6
    C.setLayer(1);
    const plan = C.planTrack(T(6, 0), T(16, 0), 2);
    out.plan = { ok: plan.ok, links: (plan.links || []).length, reason: plan.reason, cost: plan.cost, layers: [...new Set(plan.tiles.map(layerOf))].join(',') };
    out.t2 = C.trackOp(T(6, 0), T(16, 0), 2, 'double', false, 1).error || 'ok';
    out.portal = !!net.linkOf(T(6, 0));
    // an underground station at the far end of the tunnel
    const ugTile = onLayer(T(15, 0), 1);
    st = S.build(ugTile, 0); out.ugSt = st.error || 'ok';
    const ug = S.list.find((s) => s.tile === ugTile);
    out.ugEntrance = ug ? ug.entrance : -1;
    // surface track across the tunnel at 11 (north-south): it must not join the tunnel
    C.setLayer(0);
    out.t3 = C.trackOp(T(11, -3), T(11, 3), 0, 'double').error || 'ok';
    out.cross = { surf: net.conn[T(11, 0)], tun: net.conn[onLayer(T(11, 0), 1)] };
    out.crossSeparate = !!out.cross.surf && !!out.cross.tun && (out.cross.surf & 0b00010001) === 0 && (out.cross.tun & 0b01000100) === 0;
    // a viaduct over that north-south line from a new surface track end
    out.t4 = C.trackOp(T(8, -4), T(9, -4), 0, 'double').error || 'ok';
    C.setLayer(3);
    out.t5 = C.trackOp(T(9, -4), T(15, -4), 1, 'double', false, 3).error || 'ok';
    out.viaduct = !!net.linkOf(T(9, -4)) || !!net.linkOf(onLayer(T(10, -4), 3));
    C.setLayer(0);
    out.graph = net.validateGraph(20).map((e) => `${e.kind}@${e.tile}`);
    // depot and a train between the surface station and the metro station
    let dep = null;
    for (const t of [T(3, 1), T(3, -1), T(4, 1), T(4, -1)]) { const d = S.buildDepot(t); if (d.depot && net.conn[t]) { dep = d.depot; break; } if (d.depot) S.removeDepot(d.depot); }
    out.depot = !!dep;
    const s1 = S.list.find((s) => s.tile === T(1, 0)) || S.list[0];
    let t = null;
    if (dep && ug) {
      const res = g.trains.buy('citylink', dep);
      out.buy = res.error || 'ok';
      t = res.train;
      if (t) { t.mode = 'manual'; t.route = [{ st: s1.id, act: 'auto', dwell: 0, full: false, skip: false, plat: null, cargo: null }, { st: ug.id, act: 'auto', dwell: 0, full: false, skip: false, plat: null, cargo: null }]; t.routeIdx = 0; }
    }
    // run and watch the layers the train's head visits
    const seenLayers = new Set();
    let arrivedUg = 0;
    g.paused = false;
    for (let k = 0; k < 4000 && t; k++) {
      g.tick(1 / 20);
      const head = t.steps && t.steps.length ? t.steps[t.steps.length - 1].tile : null;
      if (head != null) seenLayers.add(layerOf(head));
      if (k % 50 === 0 && ug.stats.arrivals > arrivedUg) arrivedUg = ug.stats.arrivals;
    }
    out.trips = t ? t.trips : 0;
    out.tstate = t ? `${t.state} ${t.stuckT || ''} steps ${t.steps ? t.steps.length : 'none'} ${Object.keys(t).filter((k) => /step|trail|path/.test(k)).join('/')}` : 'no train';
    out.seenLayers = [...seenLayers].sort().join(',');
    out.ugArrivals = ug ? ug.stats.arrivals : 0;
    out.cost = g.economy.costs.station(ugTile) > g.economy.costs.station(T(1, 0));
    // undo: a short second tunnel from a new dead end comes back out with its portal
    C.setLayer(0);
    C.trackOp(T(18, 3), T(20, 3), 0, 'double');
    C.setLayer(1);
    const before = net.links.size;
    const tt = C.planTrack(T(20, 3), T(23, 3), 0);
    C.plan = tt; C.drag = { a: T(20, 3), b: T(23, 3) }; C.buildTrack(); C.drag = null;
    const mid = net.links.size;
    C.undo();
    out.undo = { before, mid, after: net.links.size, ug: net.conn[onLayer(T(22, 3), 1)], graph: net.validateGraph(5).length };
    C.setLayer(0);
    return out;
  });
  if (r.error) { check(false, r.error); await ctx.close(); return { ok, lines }; }
  check(r.t1 === 'ok' && r.plan.ok && r.plan.links === 1 && r.t2 === 'ok' && r.portal, `a tunnel dug from a track end gets a portal (${r.plan.layers}; ${r.plan.cost} ●)`);
  check(r.ugSt === 'ok' && r.ugEntrance >= 0, `a metro station underground, its entrance on the surface (tile ${r.ugEntrance})`);
  check(r.t3 === 'ok' && r.crossSeparate, `surface track across the tunnel does not join it (surface ${r.cross.surf.toString(2)}, tunnel ${r.cross.tun.toString(2)})`);
  check(r.t5 === 'ok' && r.viaduct, `a viaduct rises from a track end and crosses the line below (${r.t4}, ${r.t5})`);
  check(r.graph.length === 0, `the rail graph is valid on every layer${r.graph.length ? ': ' + r.graph.join(', ') : ''}`);
  check(r.depot && r.buy === 'ok' && r.trips >= 2 && r.seenLayers === '0,1' && r.ugArrivals >= 1, `a train runs through the portal: ${r.trips} trips, layers visited ${r.seenLayers}, ${r.ugArrivals} arrivals at the metro station (depot ${r.depot}, buy ${r.buy}, state ${r.tstate})`);
  check(r.cost, 'an underground station costs more than one on the surface');
  check(r.undo.mid === r.undo.before + 2 && r.undo.after === r.undo.before && !r.undo.ug && r.undo.graph === 0, `undo removes a tunnel with its portal (links ${r.undo.before} → ${r.undo.mid} → ${r.undo.after})`);
  // save and load keep the layers
  const sv = await page.evaluate(async () => {
    const g = window.__tracklands.game, S = await import('./src/save/Save.js');
    const d = S.migrate(JSON.parse(JSON.stringify(g.serialize())));
    window.__lsave = d;
    let ug = 0; for (let i = g.net.NN; i < g.net.conn.length; i++) if (g.net.conn[i]) ug++;
    return { ug, links: g.net.links.size, st: g.stations.list.filter((s) => g.stations.isUnderground(s)).length };
  });
  // (WRITE_FIXTURE=1 refreshes the save-fuzz base with layers: tests/fixtures/save-layers.json)
  if (process.env.WRITE_FIXTURE) fs.writeFileSync(path.join('tests', 'fixtures', 'save-layers.json'), JSON.stringify(await page.evaluate(() => window.__lsave)));
  await loadSave(page, await page.evaluate(() => window.__lsave));
  const ld = await page.evaluate(() => {
    const g = window.__tracklands.game;
    let ug = 0; for (let i = g.net.NN; i < g.net.conn.length; i++) if (g.net.conn[i]) ug++;
    return { ug, links: g.net.links.size, st: g.stations.list.filter((s) => g.stations.isUnderground(s)).length, graph: g.net.validateGraph(5).length };
  });
  check(sv.ug > 10 && ld.ug === sv.ug && ld.links === sv.links && ld.st === sv.st && ld.graph === 0, `save and load keep ${sv.ug} tunnel and viaduct tiles, ${sv.links / 2} links and ${sv.st} metro station (loaded ${ld.ug}/${ld.links}/${ld.st}, graph ${ld.graph})`);
  // the underground view
  const out = ensureOut();
  const view = await page.evaluate(() => { const g = window.__tracklands.game; const L = g.net.links.keys().next().value; if (L != null) { const i = L >> 3; g.camera.focus(((i % g.mapSize) + 5) * 2, (Math.floor((i % (g.mapSize * g.mapSize)) / g.mapSize)) * 2, 26); } g.layerView.set('underground'); return { ug: g.railView.ugGroup.visible, children: g.railView.ugGroup.children.length }; });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(out, 'layers-underground.png') });
  await page.evaluate(() => window.__tracklands.game.layerView.set('surface'));
  check(view.ug && view.children >= 1, `the underground view shows the tunnels (${view.children} meshes)`);
  // an older save stays on the surface
  await loadSave(page, productionSave());
  const old = await page.evaluate(() => { const g = window.__tracklands.game; let ug = 0; for (let i = g.net.NN; i < g.net.conn.length; i++) if (g.net.conn[i]) ug++; const s = g.serialize(); return { ug, ly: s.net.ly === undefined && s.net.links === undefined }; });
  check(old.ug === 0 && old.ly, 'the production save stays on the surface and saves without layer data');
  if (errors.length) { ok = false; lines.push('errors: ' + errors.slice(0, 3).join(' | ')); }
  await ctx.close();
  return { ok, lines };
}
