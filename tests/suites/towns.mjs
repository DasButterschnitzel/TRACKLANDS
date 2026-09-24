// Town growth (src/world/Towns.js): towns grow physically month by month
// towards their stage, faster with service; a new stage appears gradually;
// buildings survive save/load exactly; classes, districts, metro areas.
import { openPage, loadSave, productionSave, startTestGame } from '../lib.mjs';

export const name = 'towns';
export async function run({ browser, base }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  const { ctx, page, errors } = await openPage(browser, base);
  await loadSave(page, productionSave());
  const r = await page.evaluate(async () => {
    const g = window.__tracklands.game, T = g.towns;
    const out = {};
    const open = T.list.filter((t) => g.progression.regionUnlocked(t.region));
    const served = open.find((t) => g.stations.list.some((s) => s.links && s.links.towns.includes(t.id)));
    const unserved = open.find((t) => !g.stations.list.some((s) => s.links && s.links.towns.includes(t.id)));
    // a stage-up shows in a few buildings at once, the rest follows monthly
    const before = served.buildings.length;
    const target0 = T.buildTarget(served);
    served.stage = Math.min(5, served.stage); T.levelUp(served);
    const target = T.buildTarget(served);
    out.stageUp = { before, after: served.buildings.length, target, target0 };
    // two stages ahead of its buildings: it builds its way up month by month
    served.stage = Math.min(6, served.stage + 2); served.progress = {};
    const counts = [served.buildings.length];
    out.bigTarget = T.buildTarget(served);
    const u0 = unserved ? unserved.buildings.length : 0;
    if (unserved) { unserved.stage = Math.min(5, unserved.stage + 1); }
    for (let m = 0; m < 6; m++) { for (let i = 0; i < 30 * 60; i++) g.tick(1 / 30); counts.push(served.buildings.length); }
    out.counts = counts;
    out.unservedGrowth = unserved ? unserved.buildings.length - u0 : null;
    out.cls = T.classOf(served);
    out.districts = T.districts(served);
    // exact buildings survive save/load
    out.sig = served.buildings.map((b) => b.tile + b.arch).sort().join();
    const S = await import('./src/save/Save.js');
    window.__tsave = S.migrate(JSON.parse(JSON.stringify(g.serialize())));
    window.__tid = served.id; window.__tsig = out.sig;
    // metropolitan area: two big towns next to each other
    const [a, b] = open.slice().sort((x, y) => Math.max(Math.abs(x.x - open[0].x), Math.abs(x.z - open[0].z)) - Math.max(Math.abs(y.x - open[0].x), Math.abs(y.z - open[0].z)));
    const sa = a.stage, sb = b.stage; a.stage = 6; b.stage = 6;
    out.metro = T.metroWith(a).includes(b) === (Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z)) <= 14);
    a.stage = sa; b.stage = sb;
    return out;
  });
  const grew = r.counts[r.counts.length - 1] - r.counts[0];
  check(r.stageUp.after - r.stageUp.before <= 4 + 1 && r.stageUp.target > r.stageUp.before, `stage-up appears gradually (${r.stageUp.before} → ${r.stageUp.after} at once, target ${r.stageUp.target})`);
  check(grew >= 3 && r.counts.filter((c, i) => i > 0 && c > r.counts[i - 1]).length >= 3, `served town grows month by month towards ${r.bigTarget}: ${r.counts.join(' → ')}`);
  check(r.unservedGrowth === null || r.unservedGrowth <= Math.max(1, grew / 2), `a town without a station grows far slower (${r.unservedGrowth} vs ${grew})`);
  check(!!r.cls && Object.keys(r.districts).length >= 2, `class ${r.cls}, districts ${JSON.stringify(r.districts)}`);
  check(r.metro, 'neighbouring big towns form a metropolitan area');
  await page.evaluate(() => { window.__keepT = { s: window.__tsave, id: window.__tid, sig: window.__tsig }; });
  const keep = await page.evaluate(() => window.__keepT);
  await loadSave(page, keep.s);
  const sig2 = await page.evaluate((id) => window.__tracklands.game.towns.byId(id).buildings.map((b) => b.tile + b.arch).sort().join(), keep.id);
  check(sig2 === keep.sig, 'the buildings are exactly the same after save/load');
  // a fresh world still lays out every town completely at the start
  await startTestGame(page, 7);
  const fresh = await page.evaluate(() => { const T = window.__tracklands.game.towns; return T.list.every((t) => t.buildings.length >= Math.min(T.buildTarget(t), 3)); });
  check(fresh, 'new worlds start with complete towns');
  if (errors.length) { ok = false; lines.push('errors: ' + errors.slice(0, 2).join(' | ')); }
  await ctx.close();
  return { ok, lines };
}
