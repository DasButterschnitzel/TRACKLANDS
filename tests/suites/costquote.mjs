// One price for plan and build (Phase 12): a project's estimate equals what
// building it charges when the world has not changed — station over planned
// track (the old 860/720 mismatch), station with new track, metro and
// elevated stations, platform extension, a multi-track station, a second
// pair, a partial build and a placed blueprint. When the world changes
// between quote and build, the revalidated quote shows the new amount and
// the build charges that. A failing build charges nothing; nothing is
// charged twice (the ledger books what the coins lost).
import { openPage } from '../lib.mjs';

export const name = 'costquote';
export async function run({ browser, base }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 1280, height: 800 } });
  await page.evaluate(() => { const app = window.__tracklands; document.querySelectorAll('.modal-wrap').forEach((m) => m.remove()); if (app.game) { app.ui.detach(); app.game.dispose(); app.game = null; } app.startGame({ seed: 6161, difficulty: 'builder', test: true, paused: true, mapSize: 192, terrain: { preset: 'plains', towns: 0.2 } }); });
  await page.waitForFunction(() => window.__tracklands.game && window.__tracklands.game.running, null, { timeout: 60000 });
  const r = await page.evaluate(async () => {
    const g = window.__tracklands.game, U = await import('./src/util.js'), C0 = await import('./src/config.js');
    const net = g.net, P = g.plans, B = g.blueprints, C = g.construction;
    g.tutorial.skip();
    for (let k = 0; k < 8; k++) g.progression.regions.add(k);
    for (const x of C0.RESEARCH) g.progression.research.add(x.id);
    g.progression.level = 60; g.economy.coins = 5e7;
    const { N, idx, onLayer } = U;
    const free = (x, z) => { const i = idx(x, z); return x >= 1 && z >= 1 && x < N - 1 && z < N - 1 && g.world.type[i] === 0 && !g.occupancy.blocked[i] && !net.conn[i] && net.isUnlocked(i) && !(g.roads.hasRoad && g.roads.hasRoad(i)) && g.world.mtn[i] < 0.05; };
    const areas = [];
    for (let z = 4; z < N - 14 && areas.length < 12; z += 1) for (let x = 2; x < N - 24 && areas.length < 12; x += 1) {
      if (areas.some(([X, Z]) => Math.abs(X - x) < 24 && Math.abs(Z - z) < 12)) continue;
      let o = true; for (let dz = 0; dz <= 9 && o; dz++) for (let dx = 0; dx < 22 && o; dx++) if (!free(x + dx, z + dz)) o = false;
      if (o) areas.push([x, z]);
    }
    if (areas.length < 9) return { error: 'only ' + areas.length + ' free areas' };
    const out = {};
    const ledger = () => g.ledger.cur.exp.construction || 0;
    // quote a project, build it, compare
    const run = (name, steps, partial = false) => {
      const p = P.create(name);
      for (const s of steps) P.addStep(s, p);
      P.invalidate();
      const v = P.check(p);
      const c0 = g.economy.coins, l0 = ledger();
      const b = P.build(p, partial);
      return { state: v.state, quoted: partial ? b.quoted : v.cost.total, charged: Math.round(c0 - g.economy.coins), booked: Math.round(ledger() - l0), err: b.error || '', spent: b.spent, bad: v.bad };
    };
    let A = 0;
    const T = (x, z) => idx(areas[A][0] + x, areas[A][1] + z);
    // 1. a station over track planned in the same project (the old mismatch)
    out.stationOverTrack = run('s1', [{ op: 'track', a: T(0, 2), b: T(20, 2), tier: 0, mode: 'double', L: 0 }, { op: 'station', a: T(6, 2), b: T(9, 2), tracks: 1 }]);
    // 2. a station on open ground (its own track)
    A = 1; out.stationNew = run('s2', [{ op: 'station', a: T(4, 2), b: T(8, 2), tracks: 1 }]);
    // 3. a metro line with a station below the ground
    A = 2; C.trackOp(T(0, 2), T(3, 2), 2, 'double');
    out.metro = run('s3', [{ op: 'track', a: T(3, 2), b: T(18, 2), tier: 2, mode: 'double', L: 1 }, { op: 'station', a: onLayer(T(10, 2), 1), b: onLayer(T(12, 2), 1), tracks: 1 }]);
    // 4. a viaduct with a station on it
    A = 3; C.trackOp(T(0, 2), T(3, 2), 2, 'double');
    out.elevated = run('s4', [{ op: 'track', a: T(3, 2), b: T(18, 2), tier: 2, mode: 'double', L: 3 }, { op: 'station', a: onLayer(T(10, 2), 3), b: onLayer(T(12, 2), 3), tracks: 1 }]);
    // 5. a platform extended along existing track
    A = 4; C.trackOp(T(0, 2), T(20, 2), 0, 'double'); C.stationOp(T(5, 2), T(7, 2), 1, false, true);
    out.extend = run('s5', [{ op: 'station', a: T(7, 2), b: T(10, 2), tracks: 1 }]);
    // 6. a two-track station over planned track
    A = 5; out.twoTrack = run('s6', [{ op: 'track', a: T(0, 4), b: T(20, 4), tier: 0, mode: 'double', L: 0 }, { op: 'station', a: T(6, 4), b: T(9, 4), tracks: 2 }]);
    // 7. a second pair in a project
    A = 6; C.trackOp(T(0, 2), T(20, 2), 1, 'double');
    out.pair = run('s7', [{ op: 'pair', a: T(3, 2), b: T(17, 2), tier: 1, side: 1, roles: 'express', L: 0 }]);
    // 8. a partial build (one step blocked): the quote of the valid part equals the charge
    A = 7;
    g.occupancy.blocked[T(20, 6)] = 1;
    out.partial = run('s8', [{ op: 'track', a: T(0, 2), b: T(20, 2), tier: 0, mode: 'double', L: 0 }, { op: 'track', a: T(0, 6), b: T(20, 6), tier: 0, mode: 'double', L: 0 }, { op: 'station', a: T(6, 2), b: T(9, 2), tracks: 1 }], true);
    g.occupancy.blocked[T(20, 6)] = 0;
    // 9. a placed blueprint (the terminus throat)
    A = 8; const pl = B.place(B.byId('d_throat'), T(2, 2), 0, false);
    const vq = P.check(pl.project).cost.total, c9 = g.economy.coins, l9 = ledger();
    const b9 = P.build(pl.project);
    out.blueprint = { quoted: vq, charged: Math.round(c9 - g.economy.coins), booked: Math.round(ledger() - l9), err: b9.error || '' };
    // 10. the world changes between quote and build: the quote follows, the build charges the new quote
    A = 9 < areas.length ? 9 : 0;
    const p10 = P.create('changed');
    P.addStep({ op: 'track', a: T(0, 8), b: T(12, 8), tier: 0, mode: 'double', L: 0 }, p10);
    P.addStep({ op: 'station', a: T(4, 8), b: T(7, 8), tracks: 1 }, p10);
    P.invalidate();
    const q1 = P.check(p10).cost.total;
    C.trackOp(T(0, 8), T(6, 8), 0, 'double');     // someone lays part of it first
    P.invalidate();
    const q2 = P.check(p10).cost.total, c10 = g.economy.coins;
    const b10 = P.build(p10);
    out.changed = { q1, q2, charged: Math.round(c10 - g.economy.coins), err: b10.error || '' };
    // 11. a build failing half way charges nothing
    const p11 = P.create('fails');
    P.addStep({ op: 'track', a: T(0, 1), b: T(12, 1), tier: 0, mode: 'double', L: 0 }, p11);
    P.addStep({ op: 'track', a: T(14, 1), b: T(20, 1), tier: 0, mode: 'double', L: 0 }, p11);
    const real = P.apply.bind(P); let n = 0;
    P.apply = (s) => (++n === 2 ? { error: 'err_occupied' } : real(s));
    const c11 = g.economy.coins, l11 = ledger();
    const b11 = P.build(p11);
    P.apply = real;
    out.fail = { err: b11.error, coins: Math.round(g.economy.coins - c11), net: Math.round(ledger() - l11) };
    // 12. a direct drag: the preview price is the charge
    const d0 = C.trackOp(T(0, 9), T(15, 9), 1, 'double', true), c12 = g.economy.coins;
    C.trackOp(T(0, 9), T(15, 9), 1, 'double');
    out.direct = { quoted: d0.cost, charged: Math.round(c12 - g.economy.coins) };
    out.graph = net.validateGraph(5).length;
    return out;
  });
  if (r.error) { check(false, r.error); await ctx.close(); return { ok, lines }; }
  const same = (x) => x && !x.err && x.quoted > 0 && x.quoted === x.charged && (x.booked === undefined || x.booked === x.charged);
  for (const [k, label] of [['stationOverTrack', 'a station over track planned in the same project (once 860 vs 720)'], ['stationNew', 'a station with its own new track'], ['metro', 'a metro line and station below the ground'], ['elevated', 'a viaduct and a station on it'], ['extend', 'a platform extended along existing track'], ['twoTrack', 'a two-track station over planned track'], ['pair', 'a second pair'], ['partial', 'the valid part of a partly blocked project'], ['blueprint', 'a placed blueprint']]) {
    const x = r[k];
    check(same(x), `${label}: estimate ${x && x.quoted} ●, charged ${x && x.charged} ●${x && x.booked !== undefined ? `, booked ${x.booked} ●` : ''}${x && x.err ? ' — ' + x.err : ''}`);
  }
  check(r.changed.q2 < r.changed.q1 && r.changed.charged === r.changed.q2 && !r.changed.err, `the world changed: the quote follows (${r.changed.q1} → ${r.changed.q2} ●) and the build charges the new quote (${r.changed.charged} ●)`);
  check(r.fail.err && r.fail.coins === 0 && r.fail.net === 0, `a build failing half way charges nothing (${JSON.stringify(r.fail)})`);
  check(r.direct.quoted === r.direct.charged && r.direct.quoted > 0, `a direct drag charges its preview price (${r.direct.quoted} ●)`);
  check(r.graph === 0, 'the rail graph stays valid');
  if (errors.length) { ok = false; lines.push('errors: ' + errors.slice(0, 3).join(' | ')); }
  await ctx.close();
  return { ok, lines };
}
