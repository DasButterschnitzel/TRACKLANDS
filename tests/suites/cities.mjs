// City variety (src/world/CityStyle.js, src/world/Towns.js): new worlds get
// towns of several archetypes with different street plans; every plan keeps
// its streets connected as the town grows; each archetype builds its own
// kind of buildings in its own palette and raises its landmarks (protected
// ones can never be demolished); archetypes bias travellers, cargo demand,
// land value and the council's policy; a height limit keeps historic and
// market towns low (a big city's second centre may rise above it); the town
// panel shows the town's identity; archetype, plan and buildings survive
// save/load, and older saves keep the grid they were built on.
import { openPage, startTestGame, loadSave, productionSave } from '../lib.mjs';

export const name = 'cities';

export async function run({ browser, base }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 1280, height: 800 } });
  // ---------- archetypes across worlds ----------
  const kinds = {}, plans = {};
  for (const seed of [4242, 44, 33]) {
    await startTestGame(page, seed);
    const r = await page.evaluate(() => window.__tracklands.game.towns.list.map((t) => [t.kind, t.plan]));
    for (const [k, p] of r) { kinds[k] = (kinds[k] || 0) + 1; plans[p] = (plans[p] || 0) + 1; }
  }
  const nk = Object.keys(kinds).length, maxShare = Math.max(...Object.values(kinds)) / Object.values(kinds).reduce((a, b) => a + b, 0);
  check(nk >= 7 && maxShare < 0.35, `three worlds: ${nk} archetypes (${JSON.stringify(kinds)}), the most common ${Math.round(maxShare * 100)} %`);
  check(Object.keys(plans).length >= 4, `street plans: ${JSON.stringify(plans)}`);
  // ---------- grow one town of each kind ----------
  const grown = await page.evaluate(() => {
    const g = window.__tracklands.game, T = g.towns, N = g.mapSize || 64;
    for (let i = 0; i < 8; i++) g.progression.regions.add(i);
    const out = {};
    for (const t of T.list) {
      if (out[t.kind]) continue;
      t.stage = 5; T.levelUp(t); T.layout(t, false);
      const rs = t.roadSet, centre = [...rs].sort((a, b) => Math.hypot(a % N - t.x, Math.floor(a / N) - t.z) - Math.hypot(b % N - t.x, Math.floor(b / N) - t.z))[0];
      const seen = new Set([centre]), q = [centre];
      while (q.length) { const i = q.pop(); for (const j of [i + 1, i - 1, i + N, i - N]) if (rs.has(j) && !seen.has(j)) { seen.add(j); q.push(j); } }
      const arch = {}; for (const b of t.buildings) arch[b.arch] = (arch[b.arch] || 0) + 1;
      const walls = [...new Set(t.buildings.map((b) => b.wall))];
      out[t.kind] = { id: t.id, plan: t.plan, conn: seen.size / rs.size, arch, walls: walls.length, wall0: t.buildings.find((b) => b.arch === 'apartment' || b.arch === 'house' || b.arch === 'townhouse')?.wall, tall: t.buildings.filter((b) => ['office', 'tower', 'skyscraper', 'glasstower'].includes(b.arch)).length, stage: t.stage };
    }
    return out;
  });
  const conn = Object.entries(grown).map(([k, v]) => `${k}/${v.plan} ${Math.round(v.conn * 100)}%`);
  check(Object.values(grown).every((v) => v.conn >= 0.85), `streets stay connected as towns grow: ${conn.join(', ')}`);
  const sig = { industrial: 'factory', port: 'boathouse', tech: 'glasstower', mountain: 'chalet', tourism: 'hotel', market: 'farmhouse', commuter: 'bungalow', historic: 'terrace' };
  const own = Object.entries(sig).filter(([k]) => grown[k]).map(([k, a]) => [k, a, grown[k].arch[a] || 0]);
  check(own.length >= 4 && own.every((e) => e[2] > 0), `each archetype builds its own types: ${own.map((e) => `${e[0]} ${e[1]}×${e[2]}`).join(', ')}`);
  const lowT = ['historic', 'market', 'mountain'].filter((k) => grown[k]).map((k) => [k, grown[k].tall]);
  const hiT = ['tech', 'commuter', 'railway', 'industrial'].filter((k) => grown[k]).map((k) => grown[k].tall);
  check(lowT.every((e) => e[1] <= 6) && hiT.some((n) => n >= 10), `height limits: ${lowT.map((e) => e.join(' ')).join(', ')} tall buildings vs ${hiT.join('/')} in open cities`);
  // ---------- landmarks ----------
  const lm = await page.evaluate((grown) => {
    const g = window.__tracklands.game, T = g.towns, A = g.authority;
    const LM = ['cathedral', 'museum', 'monument', 'stadium', 'clocktower', 'tv_tower', 'park', 'convention', 'lighthouse', 'market_hall', 'university'];
    const out = { per: {} };
    for (const k in grown) { const t = T.byId(grown[k].id); out.per[k] = t.buildings.filter((b) => LM.includes(b.arch)).map((b) => b.arch); }
    // a fresh town at stage 2 gets its first landmark
    const t2 = T.list.find((t) => t.stage < 2 && g.progression.regionUnlocked(t.region));
    if (t2) { t2.stage = 1; T.levelUp(t2); T.layout(t2, false); out.first = { kind: t2.kind, want: T.arch(t2).landmarks[0], has: t2.buildings.some((b) => b.arch === T.arch(t2).landmarks[0]) }; }
    // protected and heritage landmarks
    let prot = null, herit = null;
    for (const t of T.list) for (const b of t.buildings) { if (!prot && ['cathedral', 'monument', 'lighthouse'].includes(b.arch)) prot = b; if (!herit && ['museum', 'park', 'stadium', 'market_hall', 'clocktower', 'convention', 'university', 'tv_tower'].includes(b.arch)) herit = b; }
    g.economy.coins = 1e7;
    if (prot) { const tn = T.byId(prot.town); A.ensure(tn).rating = 100; const r = A.demolish(prot.tile); out.prot = { arch: prot.arch, err: r.error || 'ok', still: tn.buildings.includes(prot) }; }
    if (herit) { const tn = T.byId(herit.town); A.ensure(tn).rating = 60; const info = A.demolishInfo(herit.tile); out.herit = { arch: herit.arch, permit: info.permit, allowed: info.allowed, need: info.need }; }
    return out;
  }, grown);
  const withLm = Object.entries(lm.per).filter(([, v]) => v.length >= 2);
  check(withLm.length >= Math.min(4, Object.keys(lm.per).length - 1), `grown cities raise their landmarks: ${Object.entries(lm.per).map(([k, v]) => `${k}: ${v.join('+')}`).join('; ')}`);
  check(lm.first && lm.first.has, `a town (${lm.first && lm.first.kind}) gets its first landmark (${lm.first && lm.first.want}) as it becomes a town`);
  check(lm.prot && lm.prot.err === 'err_protected' && lm.prot.still, `a protected ${lm.prot && lm.prot.arch} is never demolished (${lm.prot && lm.prot.err}), even with a perfect rating`);
  check(!lm.herit || (lm.herit.permit === 'demolish_heritage' && !lm.herit.allowed), `other landmarks need the heritage permit (${lm.herit ? `${lm.herit.arch}: ${lm.herit.need}+` : 'none found'})`);
  // ---------- effects ----------
  const fx = await page.evaluate(() => {
    const g = window.__tracklands.game, T = g.towns, A = g.authority;
    const mk = (kind) => { const t = T.list[0]; const k0 = t.kind; t.kind = kind; const r = { pax: T.paxMul(t), req: T.requirement({ ...t, stage: 2 }), land: null }; t.kind = k0; return r; };
    const uni = mk('university'), market = mk('market'), ind = mk('industrial'), base = mk('commuter');
    // tourist towns: summer against winter
    const t = T.list[0], k0 = t.kind; t.kind = 'tourism';
    const L = g.ledger, m0 = L.monthOfYear; L.monthOfYear = () => 6; const summer = T.paxMul(t); L.monthOfYear = () => 0; const winter = T.paxMul(t); L.monthOfYear = m0; t.kind = k0;
    // land value: the same building costs more to buy out in a historic town
    const b = t.buildings.find((x) => x.arch === 'house' || x.arch === 'cottage' || x.arch === 'apartment' || x.arch === 'townhouse');
    let land = null;
    if (b) { t.kind = 'historic'; const h = A.demolishInfo(b.tile).cost; t.kind = 'market'; const m = A.demolishInfo(b.tile).cost; t.kind = k0; land = { h, m }; }
    // council policy follows the archetype for most towns
    const P = { historic: 'heritage', industrial: 'industrial', commuter: 'commuter', tourism: 'tourism', port: 'industrial', university: 'green', tech: 'growth', market: 'green', mountain: 'green', railway: 'commuter' };
    const match = T.list.filter((x) => A.policy(x) === P[x.kind] || (x.tourist && A.policy(x) === 'tourism')).length / T.list.length;
    return { uni: uni.pax, market: market.pax, goodsInd: ind.req.GOODS, goodsBase: base.req.GOODS, summer, winter, land, match };
  });
  check(fx.uni > fx.market, `travellers by archetype: university ×${fx.uni}, market town ×${fx.market}`);
  check(fx.summer > fx.winter, `tourist towns: summer ×${fx.summer.toFixed(2)}, winter ×${fx.winter.toFixed(2)}`);
  check(fx.goodsInd > fx.goodsBase, `cargo demand: an industrial town asks for ${fx.goodsInd} goods to grow (others ${fx.goodsBase})`);
  check(fx.land && fx.land.h > fx.land.m, `land value: buying out the same building costs ${fx.land && fx.land.h} ● in a historic town, ${fx.land && fx.land.m} ● in a market town`);
  check(fx.match >= 0.6, `the council's policy follows the town's character for ${Math.round(fx.match * 100)} % of towns`);
  // ---------- identity panel ----------
  await page.evaluate((id) => { const g = window.__tracklands.game; g.select({ type: 'town', id }); }, Object.values(grown)[0].id);
  await page.waitForSelector('#inspector .card.identity', { timeout: 5000 }).catch(() => {});
  const idc = await page.evaluate(() => { const c = document.querySelector('#inspector .card.identity'); return c ? { head: c.querySelector('.id-head b').textContent, rows: c.querySelectorAll('.kv-list > div').length } : null; });
  check(idc && idc.head.length > 3 && idc.rows >= 3, `the town panel shows its identity: "${idc && idc.head}" with ${idc && idc.rows} facts (landmarks, transport, relationship …)`);
  // ---------- save/load and older saves ----------
  const before = await page.evaluate(() => { const g = window.__tracklands.game; window.__csave = JSON.parse(JSON.stringify(g.serialize())); return g.towns.list.map((t) => `${t.kind}|${t.plan}|${t.axis}|${t.buildings.map((b) => b.tile + b.arch).join(',')}`).join(';'); });
  await loadSave(page, await page.evaluate(() => window.__csave));
  const after = await page.evaluate(() => window.__tracklands.game.towns.list.map((t) => `${t.kind}|${t.plan}|${t.axis}|${t.buildings.map((b) => b.tile + b.arch).join(',')}`).join(';'));
  check(before === after, 'archetypes, street plans and every building survive save/load');
  await loadSave(page, productionSave());
  const legacy = await page.evaluate(() => { const T = window.__tracklands.game.towns; return { plans: [...new Set(T.list.map((t) => t.plan))], kinds: T.list.filter((t) => t.kind).length, n: T.list.length }; });
  check(legacy.plans.length === 1 && legacy.plans[0] === 'grid3' && legacy.kinds === legacy.n, `an older save keeps the grid its towns stand on (${legacy.plans.join(',')}) and every town gets an archetype`);
  // ---------- draw calls ----------
  const dc = await page.evaluate(() => { const T = window.__tracklands.game.towns; let v = 0, all = 0; T.group.traverse((o) => { if (o.isInstancedMesh) { all++; if (o.visible) v++; } }); return { v, all }; });
  check(dc.v < dc.all, `empty building pools are not drawn (${dc.v} of ${dc.all} instanced meshes visible)`);
  check(!errors.length, `no errors (${errors.slice(0, 2).join(' | ')})`);
  await ctx.close();
  return { ok, lines };
}
