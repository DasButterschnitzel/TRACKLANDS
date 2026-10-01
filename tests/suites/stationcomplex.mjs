// Station complexes and access (Phase 11): a metro station below a surface
// station and a bus stop beside it form one complex (walking times with
// stairs); bike parking and park & ride widen what a station serves and are
// charged once; the line diagram marks interchanges and metro stops; the
// network map filters railway and metro lines and draws metro stations as
// squares; the terminus-throat blueprint builds; amenities survive a save.
import { openPage, loadSave, ensureOut } from '../lib.mjs';
import path from 'path';

export const name = 'stationcomplex';
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
    const { N, idx, onLayer } = U;
    for (const id of ['urban_rail', 'electric_rail']) g.progression.research.add(id);
    g.progression.level = 50; g.economy.coins = 5e7;
    const free = (x, z) => { const i = idx(x, z); return x >= 1 && z >= 1 && x < N - 1 && z < N - 1 && g.world.type[i] === 0 && !g.occupancy.blocked[i] && !net.conn[i] && g.net.isUnlocked(i) && !(g.roads.hasRoad && g.roads.hasRoad(i)); };
    // near a town (so the stations serve it), a free strip
    let X = -1, Z = -1, best = 1e9;
    for (let z = 5; z < N - 12; z++) for (let x = 2; x < N - 26; x++) {
      let okA = true;
      for (let dz = -1; dz <= 5 && okA; dz++) for (let dx = 0; dx < 24 && okA; dx++) if (!free(x + dx, z + dz)) okA = false;
      if (!okA) continue;
      const d = Math.min(...g.towns.list.map((t) => Math.max(Math.abs(t.x - (x + 12)), Math.abs(t.z - z))));
      if (d < best) { best = d; X = x; Z = z; }
    }
    if (X < 0) return { error: 'no free strip' };
    const T = (x, z) => idx(X + x, Z + z);
    const out = { townDist: best };
    // a surface line with a station, and a metro line below it with a station
    C.trackOp(T(0, 0), T(20, 0), 2, 'double');
    const surf = S.build(T(8, 0), 0).station; S.extendPlatform(surf, 0, 1); S.extendPlatform(surf, 0, 1);
    C.trackOp(T(0, 3), T(4, 3), 2, 'double');
    C.trackOp(T(4, 3), T(22, 3), 2, 'double', false, 1);
    const ug = S.build(onLayer(T(10, 3), 1), 0).station; S.extendPlatform(ug, 0, 1); S.extendPlatform(ug, 0, 1);
    // a second surface station far away on the line, and trains on two lines through the surface station
    const far = S.build(T(18, 0), 0).station; S.extendPlatform(far, 0, 0);
    const ugFar = S.build(onLayer(T(19, 3), 1), 0).station; S.extendPlatform(ugFar, 0, 0);
    let dep = null;
    for (const t of [T(2, -1), T(3, -1), T(1, -1), T(5, -1)]) { const d = S.buildDepot(t); if (d.depot && net.conn[t]) { dep = d.depot; break; } if (d.depot) S.removeDepot(d.depot); }
    let dep2 = null;
    for (const t of [T(2, 4), T(3, 4), T(1, 4)]) { const d = S.buildDepot(t); if (d.depot && net.conn[t]) { dep2 = d.depot; break; } if (d.depot) S.removeDepot(d.depot); }
    const errs = []; const buy = (loco, d, a, b) => { const res = g.trains.buy(loco, d); errs.push(res.error); const t = res.train; if (t) { t.mode = 'manual'; t.route = [a, b].map((s) => ({ st: s.id, act: 'auto', dwell: 0, full: false, skip: false, plat: null, cargo: null })); t.routeIdx = 0; } return t; };
    const t1 = dep && buy('citylink', dep, surf, far), t2 = dep2 && buy('metro_classic_a', dep2, ug, ugFar);
    out.trains = [!!t1, !!t2]; out.deps = [!!dep, !!dep2, ...errs];
    g.lines.version++; g.network.dirty = true;
    // the complex: the metro station a walk away with stairs
    const cx = g.network.complex(surf);
    out.complex = cx.map((c) => `${c.o.name}:${c.walk}`);
    out.hasUg = cx.some((c) => c.o === ug);
    const w = cx.find((c) => c.o === ug);
    out.walk = w ? w.walk : null;
    // amenities: charged once, widen the reach; not twice
    const links0 = (surf.links.towns || []).length, rad0 = S.radius(surf);
    const c0 = g.economy.coins;
    const e1 = S.buildAmenity(surf, 'bike'), e2 = S.buildAmenity(surf, 'pr'), e3 = S.buildAmenity(surf, 'bike');
    out.amen = { e1, e2, e3, paid: Math.round(c0 - g.economy.coins), cost: S.amenityCost('bike') + S.amenityCost('pr'), rad: S.radius(surf) - rad0, links: (surf.links.towns || []).length - links0 };
    // lifts and escalators (Phase 13): only where levels meet; each shortens
    // the change of level, costs once and has its own upkeep
    const vw = () => { const c = g.network.complex(surf).find((x) => x.o === ug); return c ? c.walk : null; };
    const V = { w0: vw(), levelsSurf: S.otherLevels(surf).length };
    V.gate = S.list.every((s) => (S.amenityError(s, 'lift') === 'err_amen_one_level') === (S.otherLevels(s).length === 0 && !s.owner && s.service !== 'freight'));
    V.single = S.list.filter((s) => !S.otherLevels(s).length).length;
    // a station whose complex has nothing on another level (the complex seen as surface-only)
    { const cx0 = g.network.complex; g.network.complex = (o) => cx0.call(g.network, o).filter((c) => U.layerOf(c.o.tile) === U.layerOf(o.tile)); V.oneLevel = S.amenityError(surf, 'lift') + '/' + S.amenityError(surf, 'escal'); g.network.complex = cx0; }
    { const y0 = g.ledger.year; g.ledger.year = () => 1880; V.early = S.amenityError(surf, 'lift'); g.ledger.year = () => 1900; V.earlyEsc = S.amenityError(surf, 'escal'); g.ledger.year = y0; }
    const cv0 = g.economy.coins, up0 = (g.economy.infraSums()[0] || {}).station || 0;
    V.e1 = S.buildAmenity(surf, 'lift'); V.w1 = vw();
    V.e2 = S.buildAmenity(surf, 'escal'); V.w2 = vw();
    V.paid = Math.round(cv0 - g.economy.coins); V.cost = S.amenityCost('lift') + S.amenityCost('escal');
    const sums = g.economy.infraSums()[0] || {};
    V.vertical = sums.vertical || 0; V.upkeepAdded = Math.round((sums.station || 0) - up0);
    V.flight = S.flightS(surf);
    out.V = V;
    // the inspector
    g.select({ type: 'station', id: surf.id });
    await new Promise((res) => setTimeout(res, 60));
    const insp = document.body.innerHTML;
    out.insp = { complex: /class="pill-row complex"/.test(insp), amen: /data-act="stAmen"/.test(insp) };
    const q = (sel) => document.querySelector('#inspector ' + sel);
    out.insp.lift = (q('[data-field="amenity"][data-value="lift"]') || {}).dataset?.state || '';
    out.insp.escal = (q('[data-field="amenity"][data-value="escal"]') || {}).dataset?.state || '';
    out.insp.flight = +((q('[data-field="level-change"]') || {}).dataset?.value || 0);
    // a rival railway (Phase 13 rules): lifts only at a busy station where
    // levels meet, with healthy finances; renovation only for an important,
    // long outdated station, never twice within six years, never changing capacity
    g.rivals.start(8);
    const rv = g.rivals.list.find((x) => x.rail), P = g.rivals.planner(rv);
    const A = { rival: !!rv };
    if (rv) {
      rv.money = 5e6; rv.loan = 0; rv.hist = [{ y: 1950, profit: 20000 }]; rv.forSale = false;
      ug.owner = rv.id; far.owner = rv.id;
      P.vertical();                               // first look: the flow baseline only
      A.first = S.hasAmenity(ug, 'lift') || S.hasAmenity(ug, 'escal');
      ug.picked = (ug.picked || 0) + 3000; far.picked = (far.picked || 0) + 3000;
      P.st.memory = {};
      P.vertical();
      A.ug = (ug.amen || []).join('+'); A.farV = (far.amen || []).filter((a) => a === 'lift' || a === 'escal').join('+'); A.farLevels = S.otherLevels(far).length;
      A.log = P.st.log.filter((e) => e.kind === 'vertical').map((e) => e.text);
      // quiet or poor: nothing
      const ugAmen = (ug.amen || []).slice();
      P.st.memory = {}; ug.picked += 10; P.vertical(); A.quiet = (ug.amen || []).join('+') === ugAmen.join('+');
      rv.hist = [{ y: 1950, profit: -5 }]; ug.picked += 5000; P.st.memory = {}; P.vertical(); A.poor = (ug.amen || []).join('+') === ugAmen.join('+');
      // renovation: an important old station, then the cooldown
      rv.hist = [{ y: 1950, profit: 20000 }];
      const yr = g.ledger.year; g.ledger.year = () => 2010;
      ug.yb = 1935; ug.reno = 0; far.yb = 1935; far.reno = 0;
      const cap = (s) => `${s.level}:${s.tracks.length}:${S.storage(s)}`;
      const cap0 = cap(ug);
      P.st.memory = {}; P.renovate();
      const renFirst = [ug, far].filter((s) => s.reno === 2010 || s.heritage).length;
      A.ren1 = renFirst; A.capSame = cap(ug) === cap0;
      far.reno = 0; far.heritage = false; ug.reno = ug.reno === 2010 ? 2010 : 0;
      P.renovate();                               // within the cooldown: nothing more
      A.cool = [ug, far].filter((s) => s.reno === 2010 || s.heritage).length === renFirst;
      A.renLog = P.st.log.filter((e) => e.kind === 'renovate' || e.kind === 'heritage').map((e) => e.text);
      g.ledger.year = yr;
      ug.owner = undefined; far.owner = undefined;
    }
    out.A = A;
    // the line diagram marks the metro stop
    const lm = g.lines.list().find((l) => l.stops.includes(ug.id));
    out.diag = lm ? g.ui.lineDiagram(lm, null) : '';
    // the network map filters
    const { networkMapSVG, isMetroLine } = await import('./src/ui/NetworkMap.js');
    const L = g.lines.list().map((l) => ({ ...l, name: g.lines.name(l) }));
    out.map = { lines: L.length, metro: L.filter((l) => isMetroLine(g, l)).length, allSq: (networkMapSVG(g, L, { filter: 'all' }).match(/<rect /g) || []).length, metroSvg: networkMapSVG(g, L, { filter: 'metro' }), mainSvg: networkMapSVG(g, L, { filter: 'main' }) };
    out.map.metroHasUg = out.map.metroSvg.includes(ug.name.replace(/&/g, '&amp;')) && !out.map.metroSvg.includes(far.name);
    out.map.mainNoUg = !out.map.mainSvg.includes(`station:${ug.id}"`);
    delete out.map.metroSvg; delete out.map.mainSvg;
    // the terminus throat blueprint
    const bp = g.blueprints.byId('d_throat');
    let AX = -1, AZ = -1;
    for (let z = 5; z < N - 8 && AX < 0; z++) for (let x = 2; x < N - 16 && AX < 0; x++) {
      if (Math.abs(x - X) < 30 && Math.abs(z - Z) < 12) continue;
      let okA = true; for (let dz = 0; dz <= 3 && okA; dz++) for (let dx = 0; dx < 14 && okA; dx++) if (!free(x + dx, z + dz)) okA = false;
      if (okA) { AX = x; AZ = z; }
    }
    const pl = g.blueprints.place(bp, idx(AX, AZ), 0, false);
    const bb = g.plans.build(pl.project);
    let ends = 0; for (const z of [0, 1, 2]) if (net.degree(idx(AX + 12, AZ + z)) === 1) ends++;
    out.throat = { ok: !!bb.ok, ends, graph: net.validateGraph(5).length };
    return out;
  });
  if (r.error) { check(false, r.error); await ctx.close(); return { ok, lines }; }
  check(r.trains.every(Boolean), `a surface line and a metro line with their trains (depots ${r.deps})`);
  check(r.hasUg && r.walk > 20, `the metro station belongs to the surface station's complex (${r.complex.join(', ')}; ${r.walk} s on foot with stairs)`);
  check(!r.amen.e1 && !r.amen.e2 && r.amen.e3 === 'err_done' && r.amen.paid === r.amen.cost && r.amen.rad === 1 && r.amen.links >= 0, `bike parking and park & ride: charged once (${r.amen.paid} ●), reach +${r.amen.rad}, towns +${r.amen.links}; a second one refused (${r.amen.e3})`);
  check(r.insp.complex && r.insp.amen, `the inspector shows the complex and the amenities (${JSON.stringify(r.insp)})`);
  const V = r.V;
  check(V.levelsSurf > 0 && V.gate && V.oneLevel === 'err_amen_one_level/err_amen_one_level' && V.early === 'err_amen_too_early' && V.earlyEsc === 'err_amen_too_early', `lifts and escalators only where levels meet (${V.levelsSurf} on another level here; a single-level complex refuses them: ${V.oneLevel}) and not before they exist`);
  check(!V.e1 && !V.e2 && V.w0 > V.w1 && V.w1 > V.w2 && V.flight === 7, `the change of level gets quicker: stairs ${V.w0} s → lifts ${V.w1} s → escalators ${V.w2} s on foot to the metro`);
  check(V.paid === V.cost && V.vertical === 22 && V.upkeepAdded === 22, `charged once (${V.paid} ●), upkeep ${V.vertical} ● a month in the station upkeep`);
  check(r.insp.lift === 'built' && r.insp.escal === 'built' && r.insp.flight === 7, `the hub inspector shows them (lifts ${r.insp.lift}, escalators ${r.insp.escal}, ${r.insp.flight} s per level)`);
  const A = r.A;
  check(A.rival && !A.first && /lift|escal/.test(A.ug) && (A.farLevels > 0 || !A.farV) && A.quiet && A.poor, `a rival railway adds ${A.ug} at its busy metro station (${A.log.join('; ')}); none after a quiet year, none when it lost money${A.farLevels ? '' : ', none at a single-level station'}`);
  check(A.ren1 === 1 && A.capSame && A.cool, `a rival renovates or lists one important old station (${A.renLog.join('; ')}); capacity unchanged; not again within six years`);
  check(/xm metro/.test(r.diag) && /xm walk/.test(r.diag), 'the line diagram marks the metro stop and walking interchanges');
  check(r.map.lines >= 2 && r.map.metro >= 1 && r.map.allSq >= 1 && r.map.metroHasUg && r.map.mainNoUg, `the network map: ${r.map.lines} lines, ${r.map.metro} metro; metro stations as squares; filters for railway and metro`);
  check(r.throat.ok && r.throat.ends === 3 && r.throat.graph === 0, `the terminus-throat blueprint builds three dead-end tracks (${r.throat.ends})`);
  // the map panel with the metro filter
  await page.evaluate(() => { const u = window.__tracklands.ui; u.mapMode = 'lines'; u.mapFilter = 'metro'; u.openPanel('map'); });
  await page.waitForTimeout(800);
  const out = ensureOut();
  await page.screenshot({ path: path.join(out, 'stationcomplex-map.png') });
  const chips = await page.evaluate(() => document.querySelectorAll('.nm-filter [data-act=mapFilter]').length);
  check(chips === 3, 'the map panel offers the three line filters');
  // saved
  const sv = await page.evaluate(async () => { const g = window.__tracklands.game, S = await import('./src/save/Save.js'); window.__csave = S.migrate(JSON.parse(JSON.stringify(g.serialize()))); return g.stations.list.filter((s) => s.amen).map((s) => s.id + ':' + s.amen.join('+')).join(','); });
  await loadSave(page, await page.evaluate(() => window.__csave));
  const ld = await page.evaluate(() => window.__tracklands.game.stations.list.filter((s) => s.amen).map((s) => s.id + ':' + s.amen.join('+')).join(','));
  check(sv && ld === sv, `amenities survive a save (${ld})`);
  if (errors.length) { ok = false; lines.push('errors: ' + errors.slice(0, 3).join(' | ')); }
  await ctx.close();
  return { ok, lines };
}
