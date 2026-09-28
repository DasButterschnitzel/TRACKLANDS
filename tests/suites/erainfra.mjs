// Infrastructure by era (Phase 12): one central resolver (VisualEra) names a
// model family per category and band; airports and ports keep the look of
// the year they opened as the calendar moves on, renovation brings today's
// look (charged, capacity unchanged) and survives a save; ports show their
// specialization; level crossings, catenary, tunnel portals, metro stations
// and bus stops take the family of their year; parallel electrified lines
// share one gantry; an older save gets sane defaults. Screenshots per era.
import { openPage, loadSave, productionSave, ensureOut } from '../lib.mjs';
import path from 'path';

export const name = 'erainfra';

async function world(page, o) {
  await page.evaluate((opts) => { const app = window.__tracklands; document.querySelectorAll('.modal-wrap').forEach((m) => m.remove()); if (app.game) { app.ui.detach(); app.game.dispose(); app.game = null; } app.startGame({ difficulty: 'builder', test: true, paused: true, ...opts }); }, o);
  await page.waitForFunction(() => window.__tracklands.game && window.__tracklands.game.running, null, { timeout: 60000 });
  await page.evaluate(async () => {
    const g = window.__tracklands.game, C = await import('./src/config.js');
    g.tutorial.skip(); document.querySelectorAll('.modal-wrap').forEach((m) => m.remove());
    for (let r = 0; r < 8; r++) g.progression.regions.add(r);
    for (const r of C.RESEARCH) g.progression.research.add(r.id);
    g.progression.level = 60; g.economy.coins = 5e7;
  });
}

export async function run({ browser, base }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  const out = ensureOut();
  const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 1280, height: 800 } });

  // ---- the matrix itself ----
  const mx = await page.evaluate(async () => {
    const V = await import('./src/world/VisualEra.js');
    const cats = Object.keys(V.VISUAL_MATRIX);
    return { cats, rows: cats.every((c) => V.VISUAL_MATRIX[c].length === 6), notes: cats.every((c) => V.FALLBACK_NOTES[c]), distinct: Object.fromEntries(cats.map((c) => [c, new Set(V.VISUAL_MATRIX[c]).size])), y: [1900, 1935, 1960, 1985, 2005, 2025, 2060].map((y) => V.visualFamily('airport', y) + '/' + V.visualFamily('port', y) + '/' + V.visualFamily('catenary', y) + '/' + V.visualFamily('portal', y) + '/' + V.visualFamily('metro', y) + '/' + V.visualFamily('crossing', y)), rle: (() => { const a = new Uint8Array(1000); a.fill(7, 100, 400); a[999] = 3; const r = V.rleEncode(a), b = new Uint8Array(1000); return V.rleDecode(r, b) && b.every((x, i) => x === a[i]) && !V.rleDecode([1, 5000], b); })() };
  });
  check(mx.rows && mx.notes && mx.cats.length >= 9, `one resolver for ${mx.cats.length} categories, six bands each, every shared family explained`);
  check(mx.distinct.airport >= 5 && mx.distinct.port >= 4 && mx.distinct.crossing >= 4 && mx.distinct.catenary >= 3 && mx.distinct.portal >= 4 && mx.distinct.metro >= 4, `distinct families: ${JSON.stringify(mx.distinct)}`);
  check(new Set(mx.y).size >= 6, `1900 … 2060 resolve to different looks: ${mx.y.join(' | ')}`);
  check(mx.rle, 'the per-tile year store round-trips and refuses bad runs');

  // ---- a world that starts in 1905: airport, port, stop, track, tunnel ----
  await world(page, { seed: 5151, mapSize: 96, startYear: 1905, terrain: { preset: 'coastal', towns: 0.5 } });
  const a = await page.evaluate(async () => {
    const g = window.__tracklands.game, R = g.roads, N = g.mapSize, out = {};
    const find = (kind) => { for (let i = N * 6; i < N * N - N * 6; i += 3) if (!R.stopError(i, kind)) return i; return -1; };
    const at = find('airport'), dt = find('dock');
    out.air = at >= 0 ? R.addStop(at, 'airport') : { error: 'no airport site' };
    out.dock = dt >= 0 ? R.addStop(dt, 'dock') : { error: 'no dock site' };
    const air = out.air.stop, dock = out.dock.stop;
    out.y0 = g.ledger.year();
    out.fam0 = [air && R.termFamily(air), dock && R.termFamily(dock)];
    out.meshes0 = [...R.termMeshes.keys()];
    const cap0 = air ? JSON.stringify([air.size, R.stopRadius(air), R.runway(air).cap]) : '';
    // eighty years on (sandbox calendar)
    for (let k = 0; k < 8; k++) g.ui.actions.sbYear('10');
    out.y1 = g.ledger.year();
    out.fam1 = [air && R.termFamily(air), dock && R.termFamily(dock)];
    out.info = air ? R.renovateInfo(air) : null;
    const c0 = g.economy.coins;
    out.renErr = air ? R.renovateTerminal(air) : 'none';
    out.paid = Math.round(c0 - g.economy.coins);
    out.fam2 = air ? R.termFamily(air) : null;
    out.cap = air ? cap0 === JSON.stringify([air.size, R.stopRadius(air), R.runway(air).cap]) : false;
    out.again = air ? R.renovateTerminal(air) : 'none';
    out.dockReno = dock ? R.renovateTerminal(dock) : 'none';
    out.variants = [air && R.termVariant(air), dock && R.termVariant(dock)];
    out.keys = [...R.termMeshes.keys()];
    return out;
  });
  check(!a.air.error && !a.dock.error, `an airport and a port opened in ${a.y0} (${a.air.error || 'ok'}, ${a.dock.error || 'ok'})`);
  check(a.fam0[0] === 'pioneer' && a.fam0[1] === 'early', `they look their age: ${a.fam0.join(', ')}`);
  check(a.fam1[0] === 'pioneer' && a.fam1[1] === 'early', `in ${a.y1} they still look as they were built (${a.fam1.join(', ')}): no global swap`);
  check(a.info && !a.info.error && a.info.to === 'jet' && !a.renErr && a.paid === a.info.cost && a.fam2 === 'jet' && a.cap, `renovation: ${a.info && a.info.from} → ${a.fam2} for ${a.paid} ● (capacity unchanged: ${a.cap})`);
  check(a.again === 'err_reno_same' && !a.dockReno, `a second renovation is refused (${a.again}); the port renovates too`);
  check(a.keys.some((k) => /^airport:jet:/.test(k)) && a.keys.some((k) => /^dock:container:/.test(k)) && a.keys.some((k) => /^airport:pioneer:/.test(k)), `model cache keys by look: ${a.keys.join(', ')}`);
  await page.screenshot({ path: path.join(out, 'erainfra-renovated.png') });
  // saved and loaded
  const sv = await page.evaluate(async () => { const g = window.__tracklands.game, S = await import('./src/save/Save.js'); window.__esave = S.migrate(JSON.parse(JSON.stringify(g.serialize()))); return g.roads.stops.filter((s) => s.kind === 'airport' || s.kind === 'dock').map((s) => `${s.kind}:${s.yb}:${s.reno}:${g.roads.termFamily(s)}`).join(','); });
  await loadSave(page, await page.evaluate(() => window.__esave));
  const ld = await page.evaluate(() => { const g = window.__tracklands.game; return g.roads.stops.filter((s) => s.kind === 'airport' || s.kind === 'dock').map((s) => `${s.kind}:${s.yb}:${s.reno}:${g.roads.termFamily(s)}`).join(','); });
  check(sv && ld === sv, `save and load keep opened and renovated years and the look (${ld})`);

  // ---- rail infrastructure by year: catenary, portals, crossings, gantries ----
  const r = await page.evaluate(async () => {
    const g = window.__tracklands.game, net = g.net, V = await import('./src/world/VisualEra.js'), RV = g.railView;
    const out = {};
    // a tile electrified in 1930, 1960, 2010 and a high-speed tile
    let t = -1; for (let i = 0; i < net.NN && t < 0; i++) if (!net.conn[i] && g.world.type[i] === 0) t = i;
    net.conn[t] = 0b00010001; net.tier[t] = 2;
    const fam = (y) => { net.ey[t] = V.packYear(y); return RV.catenaryFamily(t); };
    out.cat = [fam(1930), fam(1960), fam(2010)];
    net.tier[t] = 3; out.cat.push(RV.catenaryFamily(t)); net.tier[t] = 2;
    const pfam = (y) => { net.yb[t] = V.packYear(y); return RV.portalFamily(t); };
    out.portal = [pfam(1900), pfam(1955), pfam(1980), pfam(2010)];
    // crossings: laid 1905, renewed by the authority every 40 years
    const X = g.crossings, c = { tile: t };
    net.yb[t] = V.packYear(1905);
    const cf = (y) => { g.ledger.startYear += y - g.ledger.year(); c.famY = null; return X.family(c); };
    out.cross = [cf(1910), cf(1950), cf(1990), cf(2030)];
    // two parallel electrified lines: one shared gantry (no inner masts)
    const gb = { boxes: 0, box() { this.boxes++; }, quad() {} };
    const lineAt = (tt) => { net.conn[tt] = 0b00010001; net.tier[tt] = 2; };
    let a0 = -1; for (let i = 3 * g.mapSize; i < net.NN - 3 * g.mapSize && a0 < 0; i++) if ((i % g.mapSize) % 2 === 0 && !net.conn[i] && !net.conn[i + g.mapSize] && !net.conn[i - g.mapSize] && g.world.type[i] === 0) a0 = i;
    lineAt(a0);
    const cv = RV.curve(a0, 0, 4, 2);
    const count = () => { gb.boxes = 0; RV.catenary(gb, a0, cv, [[0, 4]], 2, 0); return gb.boxes; };
    net.ey[a0] = V.packYear(1990);
    const single = count();
    lineAt(a0 + g.mapSize);
    out.parallel = RV.parallelTo(a0, 0, 4, 2) || RV.parallelTo(a0, 0, 4, 6);
    const shared = count();
    out.masts = { single, shared };
    net.conn[a0] = 0; net.conn[a0 + g.mapSize] = 0; net.conn[t] = 0; net.bumpVersion();
    return out;
  });
  check(r.cat.join() === 'lattice,standard,modern,hs', `catenary by the year of electrification: ${r.cat.join(', ')}`);
  check(r.portal.join() === 'masonry,industrial,concrete,modern', `tunnel portals by the year built: ${r.portal.join(', ')}`);
  check(r.cross.join() === 'gate,lights,half,full', `a crossing laid in 1905 is renewed every 40 years (1910, 1950, 1990, 2030): ${r.cross.join(', ')}`);
  check(r.parallel && r.masts.shared < r.masts.single, `parallel electrified lines share one gantry (${r.masts.single} → ${r.masts.shared} parts)`);

  // ---- metro stations and bus stops by era ----
  const m = await page.evaluate(async () => {
    const g = window.__tracklands.game, V = await import('./src/world/VisualEra.js');
    return { metro: [1910, 1960, 1985, 2015].map((y) => V.VISUAL_MATRIX.metro[V.visualBand(y)]), stop: [1910, 1960, 1985, 2015].map((y) => V.visualFamily('stop', y)), stopMeshes: [...g.roads.stopEraMeshes.keys()] };
  });
  check(m.metro.join() === 'tile,concrete,modern,contemporary' && m.stop.join() === 'early,postwar,late,modern', `metro ${m.metro.join('/')}, bus stops ${m.stop.join('/')}`);

  // ---- screenshots: the same airport and port in 1910, 1960, 2010 ----
  for (const y of [1910, 1960, 2010]) {
    await world(page, { seed: 5151, mapSize: 96, startYear: y, terrain: { preset: 'coastal', towns: 0.5 } });
    const at = await page.evaluate(async () => {
      const g = window.__tracklands.game, R = g.roads, N = g.mapSize, U = await import('./src/util.js');
      window.__look = (t, z) => { g.camera.focus(U.tileCX(t), U.tileCZ(t), z); for (let k = 0; k < 40; k++) g.camera.update(0.25); };
      let air = null, dock = null;
      for (let i = N * 6; i < N * N - N * 6 && !air; i += 3) if (!R.stopError(i, 'airport')) air = R.addStop(i, 'airport').stop;
      for (let i = N * 6; i < N * N - N * 6 && !dock; i += 3) if (!R.stopError(i, 'dock')) dock = R.addStop(i, 'dock').stop;
      if (air) window.__look(air.tile, 16);
      return { air: air && R.termFamily(air), dock: dock && R.termFamily(dock), dockTile: dock && dock.tile };
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(out, `erainfra-airport-${y}.png`) });
    if (at.dockTile != null) { await page.evaluate((t) => window.__look(t, 10), at.dockTile); await page.waitForTimeout(400); await page.screenshot({ path: path.join(out, `erainfra-port-${y}.png`) }); }
    lines.push(`     ${y}: airport ${at.air}, port ${at.dock}`);
  }

  // ---- an older save: sane defaults, nothing missing ----
  await loadSave(page, productionSave());
  const old = await page.evaluate(() => {
    const g = window.__tracklands.game, R = g.roads;
    const terms = R.stops.filter((s) => s.kind === 'airport' || s.kind === 'dock');
    let tiles = 0; for (let i = 0; i < g.net.NN; i++) if (g.net.conn[i]) { tiles++; if (g.railView.catenaryFamily(i) == null) return { bad: 'catenary ' + i }; }
    const s = g.serialize();
    return { terms: terms.map((t) => R.termFamily(t)).join(','), tiles, years: s.net.years === undefined, start: g.ledger.startYear };
  });
  check(!old.bad && old.years, `the production save loads with sane defaults (${old.tiles} track tiles; airports/ports: ${old.terms || 'none'}; start ${old.start}); nothing new is written until something is built`);
  if (errors.length) { ok = false; lines.push('errors: ' + errors.slice(0, 3).join(' | ')); }
  await ctx.close();
  return { ok, lines };
}
