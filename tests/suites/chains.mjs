// Industry chains (config INDUSTRIES / CARGO, world generation v3): a new
// world holds the newer industries; every input some site needs is produced
// somewhere and every output has a buyer; sites sit where they make sense
// (fisheries on the coast, farms on flat land, quarries by hills where the
// region has any); each chain actually runs (cement, bricks, food,
// chemistry, automotive, electronics, power); building materials make a town
// grow faster; every cargo has a wagon and a road vehicle; the modes that
// suit a cargo pay more for it; the same industry type looks different at
// different sites; stocks survive save/load; an older save keeps its world.
import { openPage, startTestGame, loadSave, productionSave } from '../lib.mjs';

export const name = 'chains';

export async function run({ browser, base }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 1280, height: 800 } });
  await startTestGame(page, 4242);
  // ---------- the world's industries ----------
  const w = await page.evaluate(async () => {
    const g = window.__tracklands.game, I = g.industries, W = g.world, N = g.mapSize || 64;
    const { INDUSTRIES, TOWN_ACCEPTS, CARGO, WAGONS, ROAD_VEHICLES } = await import('./src/config.js');
    const types = new Set(I.list.map((i) => i.type));
    const prod = new Set(), acc = new Set(TOWN_ACCEPTS);
    for (const i of I.list) { for (const r of INDUSTRIES[i.type].recipes) { for (const c in r.out) prod.add(c); for (const c in r.in) acc.add(c); } for (const c of INDUSTRIES[i.type].accepts || []) acc.add(c); }
    const noSource = [], noBuyer = [];
    for (const i of I.list) for (const r of INDUSTRIES[i.type].recipes) { for (const c in r.in) if (!prod.has(c)) noSource.push(`${i.type}:${c}`); for (const c in r.out) if (!acc.has(c)) noBuyer.push(`${i.type}:${c}`); }
    const near = (i, pred, rad) => { let n = 0; for (let dz = -rad; dz <= rad + 1; dz++) for (let dx = -rad; dx <= rad + 1; dx++) { const x = i.x + dx, z = i.z + dz; if (x >= 0 && z >= 0 && x < N && z < N && pred(x + z * N)) n++; } return n; };
    const fish = I.list.filter((i) => i.type === 'FISHERY').map((i) => near(i, (k) => W.type[k] === 1, 2));
    const farms = I.list.filter((i) => ['ORCHARD', 'LIVESTOCK_FARM', 'DAIRY_FARM'].includes(i.type)).map((i) => near(i, (k) => W.type[k] === 1, 0));
    // quarries and copper by hills, where their region has hills at all
    const regionHills = (r) => { let n = 0; for (let k = 0; k < N * N; k++) if (W.region[k] === r && (W.type[k] === 2 || W.tileH[k] > 1.2)) n++; return n; };
    const hills = I.list.filter((i) => (i.type === 'QUARRY' || i.type === 'COPPER_MINE') && regionHills(i.region) > 20).map((i) => near(i, (k) => W.type[k] === 2 || W.tileH[k] > 0.9, 4));
    // every cargo can be carried by rail and by road
    const road = (c) => ROAD_VEHICLES.some((m) => (m.kind === 'truck' || m.kind === 'bus' || m.pax) && (c === 'PASSENGERS' || c === 'MAIL' ? m.pax || m.kind === 'bus' || (m.groups || []).includes('mail') : (m.groups || []).includes(CARGO[c].group)));
    const noWagon = Object.keys(CARGO).filter((c) => !Object.values(WAGONS).some((wg) => wg.carries.includes(c)));
    const noTruck = Object.keys(CARGO).filter((c) => !road(c));
    return { n: I.list.length, types: types.size, v3: g.world.genVersion, noSource: [...new Set(noSource)], noBuyer: [...new Set(noBuyer)], fish, farms, hills, noWagon, noTruck };
  });
  check(w.v3 === 3 && w.n >= 48 && w.types >= 28, `a new world (generation ${w.v3}) has ${w.n} industries of ${w.types} kinds`);
  check(!w.noSource.length && !w.noBuyer.length, `every input is produced somewhere and every output has a buyer${w.noSource.length ? ' — no source: ' + w.noSource.join(', ') : ''}${w.noBuyer.length ? ' — no buyer: ' + w.noBuyer.join(', ') : ''}`);
  check(w.fish.length && w.fish.every((n) => n >= 3) && w.farms.every((n) => n === 0), `fisheries on the coast (water tiles ${w.fish.join('/')}), farms and orchards on dry land`);
  check(!w.hills.length || w.hills.filter((n) => n >= 2).length >= Math.ceil(w.hills.length / 2), `quarries and copper mines by the hills where their region has any (${w.hills.join('/') || 'no hilly region'})`);
  check(!w.noWagon.length && !w.noTruck.length, `every cargo has a wagon and a road vehicle${w.noWagon.length ? ' — no wagon: ' + w.noWagon.join(',') : ''}${w.noTruck.length ? ' — no truck: ' + w.noTruck.join(',') : ''}`);
  // ---------- the chains run ----------
  const run = await page.evaluate(() => {
    const g = window.__tracklands.game, I = g.industries;
    for (let i = 0; i < 8; i++) g.progression.regions.add(i);
    const out = {};
    const feed = (type, lots) => { const ind = I.list.find((i) => i.type === type); if (!ind) return null; ind._sts = []; ind.out = {}; for (const [c, n] of lots) I.receive(ind, c, n); return ind; };
    const cases = { CEMENT_WORKS: [['STONE', 30], ['SAND', 30]], BRICKWORKS: [['CLAY', 40]], FOOD_PROC: [['LIVESTOCK', 20], ['FISH', 10], ['FRUIT', 10]], CHEM_PLANT: [['OIL', 30]], AUTO_PLANT: [['STEEL', 20], ['CHEMICALS', 20], ['MACHINERY', 20]], ELECTRONICS_PLANT: [['COPPER', 20], ['CHEMICALS', 20]], PAPER_MILL: [['WOOD', 40]], DAIRY: [['MILK', 30]], WIND_FACTORY: [['STEEL', 20], ['ELECTRONICS', 20]], POWER_PLANT: [['COAL', 40]], DATA_CENTER: [['ELECTRONICS', 20]] };
    const inds = {};
    for (const [t, lots] of Object.entries(cases)) inds[t] = feed(t, lots);
    const inp0 = inds.POWER_PLANT ? inds.POWER_PLANT.inp.COAL : 0;
    for (let i = 0; i < 30 * 60; i++) I.tick(1 / 30);
    for (const [t, ind] of Object.entries(inds)) if (ind) out[t] = { out: Object.fromEntries(Object.entries(ind.out).map(([c, n]) => [c, Math.round(n)])), inp: Object.fromEntries(Object.entries(ind.inp).map(([c, n]) => [c, Math.round(n)])) };
    out.coalUsed = inp0 - (inds.POWER_PLANT ? inds.POWER_PLANT.inp.COAL || 0 : 0);
    return out;
  });
  const made = { CEMENT_WORKS: 'MATERIALS', BRICKWORKS: 'MATERIALS', FOOD_PROC: 'FOOD', CHEM_PLANT: 'CHEMICALS', AUTO_PLANT: 'VEHICLES', ELECTRONICS_PLANT: 'ELECTRONICS', PAPER_MILL: 'PAPER', DAIRY: 'FOOD', WIND_FACTORY: 'MACHINERY', DATA_CENTER: 'MAIL' };
  const res = Object.entries(made).map(([t, c]) => [t, c, run[t] ? run[t].out[c] || 0 : -1]);
  check(res.every((e) => e[2] > 0), `the chains produce: ${res.map((e) => `${e[0]} → ${e[2]} ${e[1]}`).join(', ')}`);
  check(run.coalUsed > 10 && !Object.keys((run.POWER_PLANT || {}).out || {}).length, `a power station burns coal (${run.coalUsed} in a month) and sends nothing on`);
  // ---------- building materials speed up a town ----------
  const mat = await page.evaluate(() => {
    const g = window.__tracklands.game, T = g.towns;
    const ts = T.list.filter((t) => g.progression.regionUnlocked(t.region)).slice(0, 2);
    for (const t of ts) { t.stage = 3; T.levelUp(t); t.progress = {}; }
    // (both served: a stand-in stop, set after the level-ups relinked the stations)
    for (const t of ts) t._sts = [{ links: { towns: [t.id] } }];
    // same stage, same target: one gets materials
    const [a, b] = ts;
    a.buildings.slice(-6).forEach((x) => { T.removeBuilding(x); }); a.buildings = a.buildings.slice(0, -6);
    b.buildings.slice(-6).forEach((x) => { T.removeBuilding(x); }); b.buildings = b.buildings.slice(0, -6);
    const n0 = [a.buildings.length, b.buildings.length];
    T.receive(a, 'MATERIALS', 60);
    // one month of growth (only these two towns count)
    const keep = T.list.filter((t) => t !== a && t !== b).map((t) => [t, t.region]);
    T.growMonth();
    void keep;
    return { a: a.lastBudget, b: b.lastBudget, built: a.buildings.length - n0[0], matLast: a.matLast };
  });
  check(mat.a > mat.b && mat.built >= 0, `building materials make a town grow faster: ${mat.a} building works this month with ${mat.matLast} materials, ${mat.b} without`);
  // ---------- modes that fit ----------
  const fit = await page.evaluate(async () => {
    const { modeFit, bestModes } = await import('./src/config.js');
    const g = window.__tracklands.game;
    const ind = g.industries.list.find((i) => i.type === 'QUARRY');
    g.select({ type: 'industry', id: ind.id });
    await new Promise((r) => setTimeout(r, 300));
    const panel = document.querySelector('#inspector .fit');
    return { stoneRail: modeFit('rail', 'STONE'), stoneRoad: modeFit('road', 'STONE'), elecAir: modeFit('air', 'ELECTRONICS'), elecRail: modeFit('rail', 'ELECTRONICS'), best: bestModes('STONE'), shown: panel ? panel.textContent.trim() : '' };
  });
  check(fit.stoneRail > fit.stoneRoad && fit.elecAir > fit.elecRail && fit.best.includes('rail') && fit.shown.length > 5, `bulk pays more by rail (${fit.stoneRail} vs road ${fit.stoneRoad}), valuables by air (${fit.elecAir}); the industry panel says "${fit.shown}"`);
  // ---------- variants ----------
  const vr = await page.evaluate(() => {
    const g = window.__tracklands.game, I = g.industries;
    const count = (ind) => { let n = 0; ind.obj.traverse((o) => { if (o.geometry && o.geometry.attributes.position) n += o.geometry.attributes.position.count; }); return n; };
    const sig = (type) => [...new Set(I.list.filter((i) => i.type === type).map(count))].length;
    return { MINE: sig('MINE'), COAL_MINE: sig('COAL_MINE'), COPPER_MINE: sig('COPPER_MINE') };
  });
  check(vr.MINE + vr.COAL_MINE + vr.COPPER_MINE >= 5, `the same industry looks different at different sites (variants: mines ${vr.MINE}, coal ${vr.COAL_MINE}, copper ${vr.COPPER_MINE})`);
  // ---------- save/load ----------
  const snap = () => { const st = (o) => Object.keys(o).filter((c) => o[c] > 0.001).sort().map((c) => `${c}=${o[c].toFixed(2)}`).join(','); return window.__tracklands.game.industries.list.map((i) => `${i.type}:${st(i.out)}:${st(i.inp)}`).join(';'); };
  const s0 = await page.evaluate((f) => { window.__isave = JSON.parse(JSON.stringify(window.__tracklands.game.serialize())); return eval(f)(); }, `(${snap.toString()})`);
  await loadSave(page, await page.evaluate(() => window.__isave));
  const s1 = await page.evaluate((f) => eval(f)(), `(${snap.toString()})`);
  check(s0 === s1, `the new industries and their stocks survive save/load${s0 === s1 ? '' : ' — ' + s0.split(';').filter((x, i) => x !== s1.split(';')[i]).slice(0, 2).join(' | ') + ' → ' + s1.split(';').filter((x, i) => x !== s0.split(';')[i]).slice(0, 2).join(' | ')}`);
  await loadSave(page, productionSave());
  const old = await page.evaluate(() => { const g = window.__tracklands.game; return { v: g.world.genVersion, n: g.industries.list.length, types: [...new Set(g.industries.list.map((i) => i.type))].length }; });
  check(old.v < 3 && old.types <= 12, `an older save keeps the world it was made with (generation ${old.v}, ${old.n} industries of ${old.types} kinds)`);
  check(!errors.length, `no errors (${errors.slice(0, 2).join(' | ')})`);
  await ctx.close();
  return { ok, lines };
}
