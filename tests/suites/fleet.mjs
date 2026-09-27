// Phase 7 fleet care: refurbishment in a depot or garage (age and condition,
// price), heritage services (only old vehicles, higher leisure fares, running
// costs, tourism), servicing of trams, ships and aircraft where they call,
// the inspector controls, save/load.
import { openPage, loadSave, productionSave } from '../lib.mjs';

export const name = 'fleet';
export async function run({ browser, base }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 1280, height: 800 } });
  await loadSave(page, productionSave());
  const r = await page.evaluate(async () => {
    const g = window.__tracklands.game, F = g.fleet, out = {};
    const { heritageFare } = await import('./src/economy/Fleet.js');
    const YEAR = 720;
    g.economy.coins = 1e7;
    const stopsOf = (x) => x.route && x.route.length ? x.route.map((q) => q.st) : ((g.network.svcOfTrain(x) || {}).stops || []).map((q) => q.k);
    const townOf = (x) => stopsOf(x).map((id) => g.stations.byId(id)).find((s) => s && s.links && s.links.towns.length);
    const t = g.trains.trains.find((x) => !x.owner && townOf(x)) || g.trains.trains[0];
    out.hasTownTrain = !!townOf(t);
    // heritage: only old trains
    t.bought = g.time - 3 * YEAR;
    out.youngHeritage = F.setHeritage(t, true).error;
    t.bought = g.time - 20 * YEAR;
    out.oldHeritage = F.setHeritage(t, true).ok && t.heritage;
    out.fares = [heritageFare(t, { c: 'PASSENGERS', p: 'leisure' }), heritageFare(t, { c: 'PASSENGERS', p: 'commute' }), heritageFare(t, { c: 'COAL' }), heritageFare({}, { c: 'PASSENGERS', p: 'leisure' })];
    // towns it serves draw more tourists
    const town = townOf(t) ? g.towns.byId(townOf(t).links.towns[0]) : null;
    if (town) { F.setHeritage(t, false); const a = g.urban.tourism(town); F.setHeritage(t, true); F._t = -1; out.tour = [a, g.urban.tourism(town)]; }
    // refurbishment: only in the depot
    out.refurbRunning = F.refurbError(t, true);
    const stateWas = t.state;
    t.state = 'stored';
    const cost = F.refurbCost(t, true), coins = g.economy.coins;
    const rf = F.refurbish(t, true);
    out.refurb = { ok: rf.ok, before: rf.before, after: rf.after, paid: Math.round(coins - g.economy.coins), cost, heritageAfter: !!t.heritage, count: t.refurb };
    t.state = stateWas;
    // the inspector shows the controls
    t.bought = g.time - 20 * YEAR;
    g.select({ type: 'train', id: t.id });
    await new Promise((res) => setTimeout(res, 50));
    out.ui = { refurb: !!document.querySelector('[data-act="refurb"]'), heritage: !!document.querySelector('[data-change="heritage"]') };
    F.setHeritage(t, true);
    // a road vehicle in a garage
    const R = g.roads;
    let v = R.vehicles.find((x) => !x.owner);
    if (!v) {
      // a bus at a new stop in a town
      g.progression.level = Math.max(g.progression.level, 5);
      for (const tw of g.towns.list) { if (v) break; for (const i of tw.roadSet || []) { if (g.net.conn[i]) continue; const a = R.addStop(i, 'bus'); if (a.stop) { v = R.buy('citybus', a.stop).vehicle; break; } } }
    }
    if (v) {
      v.bought = g.time - 15 * YEAR; const st = v.state; v.state = 'stored';
      const r2 = F.refurbish(v, false);
      out.road = { ok: r2.ok, after: r2.after };
      v.state = st;
      v.bought = g.time - 14 * YEAR;
      out.roadHeritage = F.setHeritage(v, true).ok;
    }
    out.id = t.id; out.vid = v ? v.id : null;
    out.save = g.serialize();
    return out;
  });
  check(r.youngHeritage === 'err_heritage_age' && r.oldHeritage, 'heritage services need an old vehicle');
  check(r.fares[0] === 1.6 && r.fares[1] === 1.1 && r.fares[2] === 1 && r.fares[3] === 1, `heritage fares: leisure ×${r.fares[0]}, commute ×${r.fares[1]}, freight ×${r.fares[2]}`);
  check(r.hasTownTrain, 'a train serving a town was found');
  if (r.tour) check(r.tour[1] > r.tour[0], `a heritage service draws tourists: ${r.tour[0].toFixed(2)} → ${r.tour[1].toFixed(2)}`);
  check(r.refurbRunning === 'err_refurb_depot', 'refurbishment only in the depot');
  check(r.refurb.ok && r.refurb.after < r.refurb.before * 0.5 && r.refurb.paid === r.refurb.cost && r.refurb.count === 1 && !r.refurb.heritageAfter, `refurbished: ${r.refurb.before.toFixed(1)} → ${r.refurb.after.toFixed(1)} years for ${r.refurb.cost}`);
  check(r.ui.refurb && r.ui.heritage, 'the train inspector offers refurbishment and heritage service');
  check(!!r.road, 'a road vehicle to refurbish');
  if (r.road) check(r.road.ok && r.roadHeritage, 'road vehicles can be refurbished and run heritage services');
  await loadSave(page, r.save);
  const l = await page.evaluate(([id, vid]) => { const g = window.__tracklands.game; const t = g.trains.byId(id), v = vid != null ? g.roads.byId(vid) : null; return { t: !!(t && t.heritage && t.refurb === 1), v: vid == null || !!(v && v.heritage && v.refurb === 1) }; }, [r.id, r.vid]);
  check(l.t && l.v, 'heritage and refurbishment are saved');
  if (errors.length) { ok = false; lines.push('errors: ' + errors.slice(0, 3).join(' | ')); }
  await ctx.close();
  return { ok, lines };
}
