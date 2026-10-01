// Train recovery (found while capturing the release trailer): a train that is
// recovered (lost too long, or moved out of a deadlock) is put back at a
// station of its own company, on the network its route runs on — never at
// the nearest station of any company or any level. It used to land a rival's
// train on the player's platform and a main-line train in a metro tunnel,
// where each stayed with "no route" for good.
import { openPage } from '../lib.mjs';

export const name = 'recovery';
export async function run({ browser, base }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 1100, height: 700 } });
  await page.evaluate(() => { const app = window.__tracklands; document.querySelectorAll('.modal-wrap').forEach((m) => m.remove()); if (app.game) { app.ui.detach(); app.game.dispose(); app.game = null; } app.startGame({ seed: 6161, difficulty: 'builder', test: true, paused: true, mapSize: 128, rivals: 1, terrain: { preset: 'plains', towns: 0.5 } }); });
  await page.waitForFunction(() => window.__tracklands.game && window.__tracklands.game.running, null, { timeout: 60000 });
  const r = await page.evaluate(async () => {
    const g = window.__tracklands.game, U = await import('./src/util.js'), net = g.net, C = g.construction, S = g.stations;
    const { N, idx, cheb } = U;
    g.tutorial.skip(); for (let i = 0; i < 8; i++) g.progression.regions.add(i);
    g.progression.level = 50; g.economy.coins = 5e7;
    const R = g.rivals.list.find((x) => x.rail) || g.rivals.list[0];
    if (!R) return { error: 'no rival company' };
    R.money = 5e7;
    const free = (x, z) => { const i = idx(x, z); return x >= 1 && z >= 1 && x < N - 1 && z < N - 1 && g.world.type[i] === 0 && !g.occupancy.blocked[i] && !net.conn[i] && net.isUnlocked(i) && !g.roads.hasRoad(i) && g.world.mtn[i] < 0.05; };
    let X = -1, Z = -1;
    for (let z = 8; z < N - 8 && X < 0; z++) for (let x = 2; x < N - 34 && X < 0; x++) {
      let fine = true;
      for (let dz = -5; dz <= 5 && fine; dz++) for (let dx = 0; dx < 32 && fine; dx++) if (!free(x + dx, z + dz)) fine = false;
      if (fine) { X = x; Z = z; }
    }
    if (X < 0) return { error: 'no free land' };
    const T = (x, z) => idx(X + x, Z + z);
    // the player's long line A ... B
    C.trackOp(T(0, 0), T(31, 0), 0, 'double');
    const A = S.build(T(2, 0), 0).station, B = S.build(T(29, 0), 0).station;
    // a player station on a separate little line beside the middle (closer than A and B)
    C.trackOp(T(12, 3), T(18, 3), 0, 'double');
    const island = S.build(T(15, 3), 0).station;
    // a rival line with its station on the other side of the middle
    g.actor = R;
    C.trackOp(T(10, -3), T(20, -3), 0, 'double');
    const rs = S.build(T(15, -3), 0).station;
    const rs2 = S.build(T(11, -3), 0).station;
    let rdep = null;
    for (const t of [T(19, -2), T(19, -4), T(20, -2), T(20, -4)]) { const d = S.buildDepot(t); if (d.depot && net.conn[t]) { rdep = d.depot; break; } if (d.depot) S.removeDepot(d.depot); }
    const rt = rdep ? g.trains.buy('pioneer', rdep).train : null;
    g.actor = null;
    let dep = null;
    for (const t of [T(4, 1), T(4, -1), T(5, 1), T(5, -1)]) { const d = S.buildDepot(t); if (d.depot && net.conn[t]) { dep = d.depot; break; } if (d.depot) S.removeDepot(d.depot); }
    const pt = dep ? g.trains.buy('pioneer', dep).train : null;
    if (!A || !B || !island || !rs || !rt || !pt) return { error: `setup ${!!A}/${!!B}/${!!island}/${!!rs}/${!!rt}/${!!pt}` };
    pt.mode = 'manual'; pt.route = [A, B].map((s) => ({ st: s.id, act: 'auto', dwell: 0, full: false, skip: false, plat: null, cargo: null })); pt.routeIdx = 0;
    if (rs2) { rt.mode = 'manual'; rt.route = [rs, rs2].map((s) => ({ st: s.id, act: 'auto', dwell: 0, full: false, skip: false, plat: null, cargo: null })); rt.routeIdx = 0; }
    for (let k = 0; k < 200; k++) g.tick(1 / 20);
    const stnOf = (t) => { const head = t.steps.length ? t.steps[g.trains.stepAt(t, t.s)].tile : -1; const sp = net.special.get(head); return sp && sp.type === 'station' ? S.byId(sp.id) : null; };
    // the player's train lost in the middle of its line: recovered onto A or B
    g.trains.placeAt(pt, T(15, 0), 0);
    g.trains.recoverTrain(pt);
    const pAt = stnOf(pt);
    // the rival's train lost in the middle of its line: recovered onto its own station
    g.trains.placeAt(rt, T(15, -3) + 0, 0);
    g.trains.clearTrail(rt); g.trains.placeAt(rt, T(14, -3), 0);
    g.trains.recoverTrain(rt);
    const rAt = stnOf(rt);
    // and they run on afterwards
    for (let k = 0; k < 600; k++) g.tick(1 / 20);
    return {
      pAt: pAt ? pAt.name + (pAt === A || pAt === B ? ' (own line)' : pAt === island ? ' (island)' : ' (rival)') : 'none',
      pOk: pAt === A || pAt === B, rAt: rAt ? rAt.name + ((rAt.owner || null) === (rt.owner || null) ? ' (own)' : ' (player)') : 'none',
      rOk: !!rAt && (rAt.owner || null) === (rt.owner || null), pProblem: pt.problem || null, rProblem: rt.problem || null,
      dist: [cheb(T(15, 0), island.tile), cheb(T(15, 0), A.tile), cheb(T(15, 0), B.tile)],
    };
  });
  if (r.error) { check(false, r.error); await ctx.close(); return { ok, lines }; }
  check(r.pOk, `a lost player train is put back on its own line, not at the nearer island station or a rival's (${r.pAt}; distances island/A/B ${r.dist.join('/')})`);
  check(r.rOk, `a lost rival train is put back at its own company's station (${r.rAt})`);
  check(r.pProblem !== 'no_route', `the recovered player train finds its route again (problem ${r.pProblem})`);
  if (errors.length) { ok = false; lines.push('errors: ' + errors.slice(0, 3).join(' | ')); }
  await ctx.close();
  return { ok, lines };
}
