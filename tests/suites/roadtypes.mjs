// Phase 7 roads: road types (speed limit, capacity, unlocks), bridges over
// water, tunnels under hills, overpasses over railways, one-way streets,
// busways, undo, the road-type chips of the road tool, save/load.
import { openPage, startTestGame, loadSave, productionSave } from '../lib.mjs';

export const name = 'roadtypes';

export async function run({ browser, base }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 1280, height: 800 } });
  await startTestGame(page, 4242);
  const r = await page.evaluate(() => {
    const g = window.__tracklands.game, R = g.roads, W = g.world, N = g.mapSize, out = {};
    g.economy.coins = 1e8; g.settings.weather = false;
    for (let i = 0; i < 8; i++) g.progression.regions.add(i);
    const idx = (x, z) => z * N + x;
    // locks: a highway needs its research and level
    g.progression.level = 3;
    out.lockedLevel = R.typeLocked('four_lane');
    g.progression.level = 40;
    out.lockedResearch = R.typeLocked('highway');
    out.planLocked = R.plan(idx(5, 5), idx(9, 5), 'highway').reason;
    g.progression.research.add('highways'); g.progression.research.add('bus_lanes');
    out.unlocked = R.typeLocked('highway');
    const free = (i) => R.tileOk(i) && !R.bits[i] && W.type[i] !== 1;
    // a bridge: land, 2–6 tiles of water in a straight line, land
    let bridge = null;
    for (let z = 2; z < N - 2 && !bridge; z++) for (let x = 2; x < N - 10 && !bridge; x++) {
      const a = idx(x, z);
      if (!free(a) || W.type[idx(x + 1, z)] !== 1) continue;
      let k = 1;
      while (k <= 7 && W.type[idx(x + k, z)] === 1) k++;
      if (k < 3 || k > 7 || x + k >= N) continue;
      const b = idx(x + k, z);
      if (!free(b)) continue;
      const p = R.plan(a, b, 'local');
      if (p.ok && p.bridges >= 2) bridge = { a, b, p };
    }
    out.bridge = !!bridge;
    if (bridge) {
      const res = R.build(bridge.p);
      const wet = bridge.p.tiles.filter((t) => W.type[t] === 1);
      out.bridgeBuilt = res.ok;
      out.bridgeFlags = wet.every((t) => R.br[t] === 1);
      out.deckAbove = wet.every((t) => R.deckH(t) > 0.4);
      out.bridgePath = !!R.path(bridge.a, bridge.b);
      R.rebuildRoadMesh();
      out.bridgeMesh = !!R.bridgeMesh;
    }
    // a tunnel: a straight line under a hill
    let tunnel = null;
    for (let z = 2; z < N - 2 && !tunnel; z++) for (let x = 2; x < N - 14 && !tunnel; x++) for (let n = 4; n <= 12 && !tunnel; n++) {
      const a = idx(x, z), b = idx(x + n, z);
      if (!free(a) || !free(b) || !R.planTunnel(a, b)) continue;
      const p = R.plan(a, b, 'local');
      if (p.ok && p.tunnel > 0) tunnel = { a, b, p };
    }
    out.tunnel = !!tunnel;
    if (tunnel) {
      out.tunnelLen = tunnel.p.tunnel;
      R.build(tunnel.p);
      const inner = tunnel.p.tiles.slice(1, -1);
      out.tunnelFlags = inner.every((t) => R.br[t] === 3);
      out.tunnelPath = !!R.path(tunnel.a, tunnel.b);
      out.tunnelSaved = JSON.parse(JSON.stringify(R.serialize())).br;
    }
    // open, flat land for straight test roads
    const strip = (n, avoid = new Set()) => {
      for (let z = 3; z < N - 3; z++) for (let x = 3; x < N - n - 3; x++) {
        let good = true;
        for (let k = 0; k <= n && good; k++) for (const dz of [-1, 0, 1]) { const t = idx(x + k, z + dz); if (!free(t) || avoid.has(t) || R.townRoads().has(t)) good = false; }
        if (good) return [idx(x, z), idx(x + n, z)];
      }
      return null;
    };
    const used = new Set();
    const mark = (a, b) => { for (let t = a; t <= b; t++) for (const dz of [-2, -1, 0, 1, 2]) used.add(t + dz * N); };
    // one-way: only with the flow
    const s1 = strip(6);
    if (s1) {
      const p = R.plan(s1[0], s1[1], 'oneway');
      R.build(p); mark(s1[0], s1[1]);
      out.oneway = { fwd: !!R.path(s1[0], s1[1]), back: !!R.path(s1[1], s1[0]), limit: R.limitAt(s1[0] + 2) };
    }
    // busway: buses only
    const s2 = strip(6, used);
    if (s2) {
      R.build(R.plan(s2[0], s2[1], 'busway')); mark(s2[0], s2[1]);
      out.busway = { bus: !!R.path(s2[0], s2[1], false, 'bus'), truck: !!R.path(s2[0], s2[1], false, 'truck') };
    }
    // upgrade: a dirt track becomes an avenue for the difference in price
    const s3 = strip(6, used);
    if (s3) {
      const fresh = R.plan(s3[0], s3[1], 'avenue');
      R.build(R.plan(s3[0], s3[1], 'dirt')); mark(s3[0], s3[1]);
      const dirtLimit = R.limitAt(s3[0] + 3), dirtCap = R.capAt(s3[0] + 3);
      const up = R.plan(s3[0], s3[1], 'avenue');
      R.build(up);
      out.upgrade = { dirtLimit, dirtCap, aveLimit: R.limitAt(s3[0] + 3), aveCap: R.capAt(s3[0] + 3), upCost: up.cost, freshCost: fresh.ok ? fresh.cost : null };
      // undo restores the dirt track
      g.construction.undo();
      out.undoType = R.typeAt(s3[0] + 3);
    }
    out.typesSaved = JSON.parse(JSON.stringify(R.serialize())).rtype;
    R.rebuildRoadMesh();
    // the road tool shows a chip per road type
    g.construction.setTool('road'); g.construction.roadMode = 'road'; g.ui.renderToolbar();
    out.chips = document.querySelectorAll('[data-act="roadType"]').length;
    document.querySelector('[data-act="roadType"][data-arg="avenue"]').click();
    out.chosen = g.construction.roadType;
    g.construction.setTool('select');
    out.save = g.serialize();
    return out;
  });
  check(r.lockedLevel && r.lockedLevel.key === 'unlock_level', `four-lane roads unlock by level (${JSON.stringify(r.lockedLevel)})`);
  check(r.lockedResearch && r.lockedResearch.key === 'road_type_needs_research' && r.planLocked === 'err_research_required' && !r.unlocked, 'highways need their research');
  check(r.bridge, 'a river to bridge was found');
  if (r.bridge) check(r.bridgeBuilt && r.bridgeFlags && r.deckAbove && r.bridgePath && r.bridgeMesh, `a road bridge over water: built ${r.bridgeBuilt}, deck ${r.deckAbove}, drivable ${r.bridgePath}, piers ${r.bridgeMesh}`);
  check(r.tunnel, 'a hill to tunnel was found');
  if (r.tunnel) check(r.tunnelFlags && r.tunnelPath && Array.isArray(r.tunnelSaved), `a ${r.tunnelLen}-tile road tunnel is drivable and saved`);
  check(r.oneway && r.oneway.fwd && !r.oneway.back && r.oneway.limit === 70, `one-way street: with the flow ${r.oneway && r.oneway.fwd}, against ${r.oneway && r.oneway.back}`);
  check(r.busway && r.busway.bus && !r.busway.truck, `busway: buses ${r.busway && r.busway.bus}, trucks ${r.busway && r.busway.truck}`);
  check(r.upgrade && r.upgrade.aveLimit > r.upgrade.dirtLimit && r.upgrade.aveCap > r.upgrade.dirtCap && r.upgrade.upCost < r.upgrade.freshCost, `upgrading dirt to avenue: ${JSON.stringify(r.upgrade)}`);
  check(r.undoType === 'dirt', `undo restores the old road type (${r.undoType})`);
  check(r.chips === 8 && r.chosen === 'avenue', `road tool: ${r.chips} type chips, chosen ${r.chosen}`);
  // save and load: types, one-way flags, bridges and tunnels survive
  lines.push(...(r.lines || []));
  await loadSave(page, r.save);
  const l = await page.evaluate((before) => {
    const R = window.__tracklands.game.roads;
    const s = JSON.parse(JSON.stringify(R.serialize()));
    return { rtype: JSON.stringify(s.rtype) === JSON.stringify(before.road.rtype), ow: JSON.stringify(s.ow) === JSON.stringify(before.road.ow), br: JSON.stringify(s.br) === JSON.stringify(before.road.br) };
  }, r.save);
  check(l.rtype && l.ow && l.br, `save/load keeps road types ${l.rtype}, one-way ${l.ow}, bridges/tunnels ${l.br}`);

  // an overpass: a four-lane road over a busy railway in the production save
  await loadSave(page, productionSave());
  const o = await page.evaluate(() => {
    const g = window.__tracklands.game, R = g.roads, N = g.mapSize, out = {};
    g.economy.coins = 1e8; g.progression.level = 40;
    const idx = (x, z) => z * N + x;
    for (let i = 0; i < N * N && !out.plan; i++) {
      if (!g.net.conn[i] || g.net.special.has(i)) continue;
      const x = i % N, z = Math.floor(i / N);
      for (const [dx, dz] of [[0, 1], [1, 0]]) {
        const a = idx(x - dx * 2, z - dz * 2), b = idx(x + dx * 2, z + dz * 2);
        if (x - 2 < 0 || z - 2 < 0 || x + 2 >= N || z + 2 >= N) continue;
        if (!R.tileOk(a) || !R.tileOk(b) || R.bits[a] || R.bits[b] || g.net.conn[a] || g.net.conn[b]) continue;
        const p = R.plan(a, b, 'four_lane');
        if (p.ok && p.overpasses > 0 && p.tiles.length <= 7) { out.plan = { a, b, n: p.overpasses, cost: p.cost, crossings: p.crossings }; R.build(p); out.rail = p.tiles.filter((t) => g.net.conn[t]); break; }
      }
    }
    if (!out.plan) return out;
    out.flags = out.rail.every((t) => R.br[t] === 2);
    g.crossings.rebuild();
    out.noCrossing = out.rail.every((t) => !g.crossings.at || !g.crossings.at(t));
    out.deck = out.rail.every((t) => R.deckH(t) > g.net.railH(t) + 0.5);
    out.path = !!R.path(out.plan.a, out.plan.b);
    for (let i = 0; i < 30 * 20; i++) g.tick(1 / 30);
    return out;
  });
  check(!!o.plan, 'a railway to cross was found in the production save');
  if (o.plan) check(o.flags && o.noCrossing && o.deck && o.path && o.plan.crossings === 0, `a four-lane road crosses the railway on an overpass (${o.plan.n}), no level crossing`);
  if (errors.length) { ok = false; lines.push('errors: ' + errors.slice(0, 3).join(' | ')); }
  await ctx.close();
  return { ok, lines };
}
