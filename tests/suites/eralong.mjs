// Era long game (Phase 12, release gate): a world started in 1900 runs for
// sixty years (thirty in quick mode) with two railway companies. What was
// built early keeps its look (no global swap), what is built later looks its
// own age, the towns grow in layers of several eras, renovation stays rare
// (at most one station a year per company), memory and save size stay
// bounded, and a save at the end brings every look back unchanged.
import { openPage, loadSave } from '../lib.mjs';

export const name = 'eralong';
export async function run({ browser, base, quick }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 1100, height: 720 } });
  await page.evaluate(() => { window.__tracklands.startGame({ seed: 19000101, difficulty: 'standard', test: true, paused: true, rivals: 2, mapSize: 96, startYear: 1900 }); });
  await page.waitForFunction(() => window.__tracklands.game && window.__tracklands.game.running, null, { timeout: 90000 });
  // the player's own terminals and stops: one set in 1900, one later
  const place = () => page.evaluate(() => {
    const g = window.__tracklands.game, R = g.roads, N = g.mapSize;
    g.economy.coins = 1e8;
    const out = {};
    for (const kind of ['airport', 'dock']) for (let i = N * 5 + (g.ledger.year() % 7); i < N * N - N * 5; i += 5) if (!R.stopError(i, kind)) { const r = R.addStop(i, kind); if (r.stop) { out[kind] = r.stop.id; break; } }
    return { y: g.ledger.year(), ...out };
  });
  await page.evaluate(async () => {
    const g = window.__tracklands.game, C = await import('./src/config.js');
    g.tutorial.skip(); for (let r = 0; r < 8; r++) g.progression.regions.add(r);
    for (const r of C.RESEARCH) g.progression.research.add(r.id);
    g.progression.level = 60;
  });
  const early = await place();
  const YEARS = quick ? 30 : 60;
  const samples = [];
  let late = null;
  const t0 = Date.now();
  for (let y = 0; y < YEARS; y += 10) {
    samples.push(await page.evaluate(() => {
      const g = window.__tracklands.game;
      for (let m = 0; m < 120; m++) for (let s = 0; s < 450; s++) g.tick(4 / 30);
      if (window.gc) window.gc();
      return { y: g.ledger.year(), heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : 0, geo: window.__tracklands.renderer.info.memory.geometries, save: JSON.stringify(g.serialize()).length };
    }));
    if (!late && samples[samples.length - 1].y >= 1955) late = await place();
  }
  lines.push(`     ${samples.map((s) => `${s.y}: heap ${s.heap} MB, ${s.geo} geometries, save ${Math.round(s.save / 1024)} KB`).join(' | ')} (${Math.round((Date.now() - t0) / 1000)} s)`);
  const res = await page.evaluate(({ early, late }) => {
    const g = window.__tracklands.game, R = g.roads, S = g.stations, net = g.net;
    const fam = (id) => { const s = id != null && R.stopById(id); return s ? R.termFamily(s) : null; };
    const out = { early: { air: fam(early.airport), dock: fam(early.dock) }, late: late ? { y: late.y, air: fam(late.airport), dock: fam(late.dock) } : null };
    // rail companies' stations: opened across the decades, few renovations
    const rs = S.list.filter((s) => s && s.owner);
    out.stations = rs.length;
    out.bands = [...new Set(rs.map((s) => Math.min(5, Math.floor(Math.max(0, (s.yb || 0) - 1900) / 25))))].length;
    out.renos = rs.filter((s) => s.reno).length;
    // per-tile years: track laid in many different years
    const ys = new Set(); for (let i = 0; i < net.NN; i++) if (net.conn[i] && net.yb[i]) ys.add(net.yb[i]);
    out.trackYears = ys.size;
    // towns grow in layers of several eras
    // buildings put up during the game carry the year they were built (the
    // towns of a 1900 world are hamlets and grow slowly without the player)
    const band = (y) => [1920, 1945, 1970, 1995, 2025].filter((b) => y >= b).length;
    const all = g.towns.list.flatMap((t) => t.buildings);
    const built = all.filter((b) => (b.y || 0) > 1900);
    out.built = built.length;
    out.badYear = built.filter((b) => b.y > g.ledger.year()).length;
    out.layers = new Set(all.map((b) => band(b.y || 0))).size;
    out.looks = [...R.termMeshes.keys()];
    out.snap = JSON.stringify(R.stops.filter((s) => s.kind === 'airport' || s.kind === 'dock').map((s) => `${s.id}:${R.termFamily(s)}`));
    out.save = JSON.parse(JSON.stringify(g.serialize()));
    return out;
  }, { early, late });
  check(early.airport != null && early.dock != null && res.early.air === 'pioneer' && res.early.dock === 'early', `the 1900 airport and port still look it after ${YEARS} years (${res.early.air}, ${res.early.dock})`);
  if (!quick) check(res.late && res.late.air && res.late.air !== res.early.air, `an airport built in ${res.late && res.late.y} looks its own age (${res.late && res.late.air})`);
  check(res.stations > 0 && res.bands >= 2 && res.renos <= YEARS * 2, `rail companies: ${res.stations} stations opened across ${res.bands} quarter-centuries, ${res.renos} renovated`);
  check(res.trackYears >= 3, `track laid in ${res.trackYears} different years`);
  check(res.built > 0 && !res.badYear && (quick || res.layers >= 2), `${res.built} buildings put up during the game, each dated (${res.layers} building eras on the map)`);
  const heapGrowth = samples.length > 1 && samples[0].heap ? samples[samples.length - 1].heap - samples[0].heap : 0;
  const geoGrowth = samples[samples.length - 1].geo - samples[0].geo;
  check(heapGrowth < 150 && samples[samples.length - 1].save < 8 * 1024 * 1024, `memory: heap +${heapGrowth} MB, geometries +${geoGrowth}, save ${Math.round(samples[samples.length - 1].save / 1024)} KB`);
  await loadSave(page, res.save);
  const back = await page.evaluate(() => { const R = window.__tracklands.game.roads; return JSON.stringify(R.stops.filter((s) => s.kind === 'airport' || s.kind === 'dock').map((s) => `${s.id}:${R.termFamily(s)}`)); });
  check(back === res.snap, `save and load at the end bring back every terminal's look (${JSON.parse(back).length} terminals)`);
  if (errors.length) { ok = false; lines.push('errors: ' + errors.slice(0, 3).join(' | ')); }
  await ctx.close();
  return { ok, lines };
}
