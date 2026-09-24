// Local authorities (src/world/Authority.js): rating changes with logged
// reasons, permits, demolition with compensation, station projects that buy
// town property, persistence; the demolition dialog with real mouse input.
import { openPage, loadSave, productionSave } from '../lib.mjs';

export const name = 'authority';
export async function run({ browser, base }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 1280, height: 800 } });
  await loadSave(page, productionSave());
  const r = await page.evaluate(async () => {
    const g = window.__tracklands.game, A = g.authority, L = g.ledger, N = 64;
    const out = {};
    g.economy.coins = 1e6;
    const town = g.towns.list.filter((t) => g.progression.regionUnlocked(t.region)).sort((a, b) => b.buildings.length - a.buildings.length)[0];
    out.town = town.name;
    // demolish a home: compensation booked once, rating falls by the shown impact
    const home = town.buildings.find((b) => ['house', 'house2', 'cottage', 'townhouse'].includes(b.arch));
    const info = A.demolishInfo(home.tile);
    const r0 = A.ensure(town).rating, n0 = L.log.length, c0 = g.economy.coins;
    const d = A.demolish(home.tile);
    out.demolish = !!d.ok && L.log.length === n0 + 1 && L.log[L.log.length - 1].cat === 'compensation' && Math.round(c0 - g.economy.coins) === info.cost && Math.abs(A.ensure(town).rating - (r0 + info.impact)) < 0.01 && !town.buildings.includes(home) && g.occupancy.blocked[home.tile] === 0;
    out.logged = A.ensure(town).log.some((e) => e.key === 'auth_demolished');
    // the town does not rebuild on the cleared site at its next re-layout
    g.towns.layout(town, false);
    out.cleared = !town.buildings.some((b) => b.tile === home.tile);
    // refusal when the relationship is poor
    A.ensure(town).rating = 12;
    const other = town.buildings.find((b) => b.arch !== 'civic' && b.arch !== 'plaza');
    const ref = A.demolish(other.tile);
    out.refused = ref.error === 'err_permit_denied' && town.buildings.includes(other);
    // heritage: needs a partner-level rating
    const civic = town.buildings.find((b) => b.arch === 'civic');
    A.ensure(town).rating = 80;
    out.heritage = civic ? !A.demolishInfo(civic.tile).allowed : true;
    // trees near town
    const r1 = A.ensure(town).rating;
    A.onTreesCleared(idx(town.x + 2, town.z + 2), 5);
    out.trees = A.ensure(town).rating < r1;
    function idx(x, z) { return z * N + x; }
    // good service over two months raises the rating (monthly review)
    A.ensure(town).rating = 50;
    const sts = g.stations.list.filter((s) => s.links && s.links.towns.includes(town.id));
    for (let i = 0; i < 30 * 190; i++) g.tick(1 / 30);
    out.service = { served: sts.length, rating: Math.round(A.ensure(town).rating), keys: A.ensure(town).log.slice(-4).map((e) => e.key) };
    // a station drag across town buildings: the project buys them
    A.ensure(town).rating = 80;
    let plan = null, from = -1, to = -1;
    const S = g.stations;
    for (const b of town.buildings) {
      if (b.arch === 'civic' || b.arch === 'plaza') continue;
      for (const dx of [-1, 1]) {
        const a = b.tile - dx * 2, e = b.tile + dx;
        const p = S.planDrag(a, e, 1);
        if (!p.error && p.acquire && p.acquire.length) { plan = p; from = a; to = e; break; }
      }
      if (plan) break;
    }
    out.project = !!plan;
    if (plan) {
      const cost = plan.cost, comp = plan.compensation, nAcq = plan.acquire.length, n1 = L.log.length, c1 = g.economy.coins;
      const res = g.construction.stationOp(from, to, 1, false, true);
      const booked = L.log.slice(n1).filter((e) => e.cat === 'compensation').length;
      out.projectBuilt = !!res.ok && booked === nAcq && Math.abs((c1 - g.economy.coins) - cost) < 2 && comp > 0 && !!S.stationAt(from) && plan.acquire.every((x) => !town.buildings.includes(x.b));
      out.projectInfo = `${nAcq} buildings, compensation ${comp}, total ${cost}, booked ${booked}`;
    }
    // persistence
    const Sv = await import('./src/save/Save.js');
    const d2 = Sv.migrate(JSON.parse(JSON.stringify(g.serialize())));
    const tt = d2.towns.find((x) => x.id === town.id);
    out.saved = Sv.validate(d2) === null && !!tt.auth && Math.abs(tt.auth.rating - A.ensure(town).rating) < 0.2 && !!tt.cleared && tt.cleared[home.tile] > 0;
    window.__authSave = d2; window.__authTown = town.id; window.__authHome = home.tile;
    return out;
  });
  check(r.demolish, `${r.town}: demolishing a home books the compensation once and lowers the rating by the shown amount`);
  check(r.logged, 'the change is logged with its reason');
  check(r.cleared, 'the town leaves the cleared site empty for a while');
  check(r.refused, 'a hostile town refuses demolition');
  check(r.heritage, 'heritage buildings need a partner-level relationship');
  check(r.trees, 'clearing trees near town lowers the rating');
  check(r.service.served === 0 || r.service.keys.some((k) => /_service$/.test(k)), `monthly review with service: ${JSON.stringify(r.service)}`);
  check(r.project && r.projectBuilt, `station drag across town buildings buys them as one project (${r.projectInfo || 'no site found'})`);
  check(r.saved, 'rating, log and cleared sites are saved');
  // reload the save: nothing lost, nothing rebuilt on the cleared site
  await page.evaluate(() => { window.__keep = { s: window.__authSave, t: window.__authTown, h: window.__authHome }; });
  const keep = await page.evaluate(() => window.__keep);
  await loadSave(page, keep.s);
  const after = await page.evaluate(([tid, home]) => { const g = window.__tracklands.game; const t = g.towns.byId(tid); return { rating: g.authority.rating(t), log: g.authority.ensure(t).log.length, rebuilt: t.buildings.some((b) => b.tile === home) }; }, [keep.t, keep.h]);
  check(after.log > 0 && !after.rebuilt, `after reload: rating ${after.rating}, ${after.log} log lines, cleared site still empty`);
  // real input: bulldozer on a town building opens the dialog, confirming demolishes
  const tile = await page.evaluate(() => {
    const g = window.__tracklands.game; g.economy.coins = 1e6;
    const t = g.towns.list.filter((x) => g.progression.regionUnlocked(x.region)).sort((a, b) => b.buildings.length - a.buildings.length)[0];
    g.authority.ensure(t).rating = 70;
    const b = t.buildings.find((x) => x.arch !== 'civic' && x.arch !== 'plaza');
    window.__focus = [((b.tile % 64) + 0.5) * 2, (Math.floor(b.tile / 64) + 0.5) * 2];
    g.camera.focus(window.__focus[0], window.__focus[1], 16);
    return b.tile;
  });
  await page.waitForFunction(() => { const t = window.__tracklands.game.camera.target, f = window.__focus; return Math.abs(t.x - f[0]) + Math.abs(t.z - f[1]) < 0.15; }, null, { polling: 100, timeout: 30000 });
  await page.click('#tool-bulldoze');
  const p = await page.evaluate((t) => { const g = window.__tracklands.game, cam = g.camera.camera; const v = new cam.position.constructor(((t % 64) + 0.5) * 2, g.world.view.heightAt(((t % 64) + 0.5) * 2, (Math.floor(t / 64) + 0.5) * 2) + 0.4, (Math.floor(t / 64) + 0.5) * 2).project(cam); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; }, tile);
  await page.mouse.click(p[0], p[1]);
  const dlg = await page.waitForSelector('.modal.demolish', { timeout: 3000 }).then(() => true, () => false);
  check(dlg, 'bulldozer on a town building opens the demolition dialog');
  if (dlg) {
    const txt = await page.evaluate(() => document.querySelector('.modal.demolish').textContent);
    check(/●/.test(txt) && /(Compensation|Entschädigung)/.test(txt), 'the dialog shows compensation, people affected, impact and permit');
    await page.click('.modal.demolish [data-mbtn=ok]');
    await page.waitForTimeout(200);
    const gone = await page.evaluate((t) => !window.__tracklands.game.towns.list.some((x) => x.buildings.some((b) => b.tile === t)), tile);
    check(gone, 'confirming demolishes the building');
  }
  if (errors.length) { ok = false; lines.push('errors: ' + errors.slice(0, 2).join(' | ')); }
  await ctx.close();
  return { ok, lines };
}
