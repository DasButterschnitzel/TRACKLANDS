// Planning mode and blueprints (Phase 11): drawing while planning builds and
// charges nothing and reserves no land; a project shows its steps, cost
// breakdown and state; BUILD PROJECT charges exactly the estimate once and
// is all or nothing (a step failing half way takes the others back); the
// valid part can be built alone; a plan turns invalid when the ground is
// taken; projects survive a save; blueprints place as plans (rotated,
// mirrored), a captured piece of track places again the same, and JSON
// import rejects anything that is not plain numbers.
import { openPage, loadSave, ensureOut } from '../lib.mjs';
import path from 'path';

export const name = 'planning';
export async function run({ browser, base }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 1280, height: 800 } });
  await page.evaluate(() => { const app = window.__tracklands; document.querySelectorAll('.modal-wrap').forEach((m) => m.remove()); if (app.game) { app.ui.detach(); app.game.dispose(); app.game = null; } app.startGame({ seed: 6161, difficulty: 'builder', test: true, paused: true, mapSize: 192, terrain: { preset: 'plains', towns: 0.2 } }); });
  await page.waitForFunction(() => window.__tracklands.game && window.__tracklands.game.running, null, { timeout: 60000 });
  await page.evaluate(() => { const g = window.__tracklands.game; g.tutorial.skip(); for (let r = 0; r < 8; r++) g.progression.regions.add(r); try { localStorage.removeItem('tracklands.blueprints'); } catch { /* */ } g.blueprints.list = []; });
  const r = await page.evaluate(async () => {
    const g = window.__tracklands.game, U = await import('./src/util.js'), net = g.net, C = g.construction, P = g.plans, B = g.blueprints;
    const { N, idx } = U;
    for (const id of ['electric_rail', 'block_signals', 'path_signals']) g.progression.research.add(id);
    g.progression.level = 50;
    g.economy.coins = 1e6;
    const free = (x, z) => { const i = idx(x, z); return x >= 1 && z >= 1 && x < N - 1 && z < N - 1 && g.world.type[i] === 0 && !g.occupancy.blocked[i] && !net.conn[i] && g.net.isUnlocked(i) && !(g.roads.hasRoad && g.roads.hasRoad(i)) && g.world.mtn[i] < 0.05; };
    let X = -1, Z = -1;
    for (let z = 6; z < N - 20 && X < 0; z++) for (let x = 2; x < N - 26 && X < 0; x++) {
      let okA = true;
      for (let dz = 0; dz <= 14 && okA; dz++) for (let dx = 0; dx < 22 && okA; dx++) if (!free(x + dx, z + dz)) okA = false;
      if (okA) { X = x; Z = z; }
    }
    if (X < 0) return { error: 'no free area' };
    const T = (x, z) => idx(X + x, Z + z);
    const connSum = () => { let s = 0; for (let i = 0; i < net.conn.length; i++) if (net.conn[i]) s += net.conn[i].toString(2).split('1').length - 1; return s; };
    const drag = (a, b) => { C.setTool('track'); C.drag = { a, b }; C.previewTrack(); C.buildTrack(); C.drag = null; C.clearPreview(); };
    const out = {};
    // ---- planning builds and charges nothing ----
    const coins0 = g.economy.coins, conn0 = connSum();
    P.setOn(true);
    drag(T(0, 1), T(20, 1));
    C.buildStationDrag(T(6, 1), T(9, 1));
    C.placeDepot(T(2, 2));
    const p1 = P.byId(P.active);
    g.planView.update(5);
    out.free = { coins: Math.round(g.economy.coins - coins0), conn: connSum() - conn0, steps: p1.steps.map((s) => s.op).join(','), ghosts: g.planView.shown, stations: g.stations.list.length };
    const v1 = P.check(p1);
    out.v1 = { state: v1.state, total: v1.cost.total, parts: v1.cost.track + v1.cost.structure + v1.cost.station + v1.cost.signal };
    // ---- build: charged exactly once, the estimate ----
    P.setOn(false);
    const c1 = g.economy.coins, led0 = g.ledger.cur.exp.construction || 0;
    const b1 = P.build(p1);
    out.build1 = { ok: !!b1.ok, spent: Math.round(c1 - g.economy.coins), booked: Math.round((g.ledger.cur.exp.construction || 0) - led0), est: v1.cost.total, reported: b1.spent, gone: !P.byId(p1.id), stn: g.stations.list.some((s) => s.tile >= T(6, 1) && s.tile <= T(9, 1)), dep: g.stations.depots.length, graph: net.validateGraph(5).length };
    // ---- all or nothing: a step failing half way takes the rest back ----
    const p2 = P.create('rollback');
    P.addStep({ op: 'track', a: T(0, 4), b: T(20, 4), tier: 0, mode: 'double', L: 0 }, p2);
    P.addStep({ op: 'track', a: T(0, 6), b: T(20, 6), tier: 0, mode: 'double', L: 0 }, p2);
    const realApply = P.apply.bind(P);
    let n = 0;
    P.apply = (s) => (++n === 2 ? { error: 'err_occupied' } : realApply(s));
    const c2 = g.economy.coins, k2 = connSum();
    const b2 = P.build(p2);
    P.apply = realApply;
    out.rollback = { err: b2.error, coins: Math.round(g.economy.coins - c2), conn: connSum() - k2, kept: !!P.byId(p2.id) && p2.steps.length === 2 };
    // ---- the ground taken: blocked; the valid part alone ----
    const p3 = P.create('partial');
    P.addStep({ op: 'track', a: T(0, 8), b: T(20, 8), tier: 0, mode: 'double', L: 0 }, p3);
    P.addStep({ op: 'track', a: T(0, 10), b: T(20, 10), tier: 0, mode: 'double', L: 0 }, p3);
    P.invalidate();
    const s3a = P.check(p3).state;
    g.occupancy.blocked[T(20, 10)] = 1;           // a town building appears where the plan ends
    P.invalidate();
    const v3 = P.check(p3);
    const full = P.build(p3);
    const c3 = g.economy.coins;
    const part = P.build(p3, true);
    out.partial = { before: s3a, after: v3.state, bad: v3.bad, reason: v3.steps[1].error, full: full.error, part: part.ok && part.built === 1 && part.left === 1, spent: Math.round(c3 - g.economy.coins), built: !!net.conn[T(10, 8)], notBuilt: !net.conn[T(10, 10)] };
    g.occupancy.blocked[T(20, 10)] = 0;
    // ---- duplicate and compare ----
    const q = P.duplicate(p2);
    const cmp = P.compare(p2, q);
    out.dup = { steps: q.steps.length, same: cmp.a.cost.total === cmp.b.cost.total && cmp.a.tiles === cmp.b.tiles };
    // ---- blueprints: a built-in loop placed as a plan, turned and mirrored ----
    const loop = B.byId('d_loop');
    const st0 = B.steps(loop, T(4, 13), 0, false).steps, st1 = B.steps(loop, T(4, 13), 1, false).steps, stm = B.steps(loop, T(4, 13), 0, true).steps;
    const d = (s) => [U.tx(s.b) - U.tx(s.a), U.tz(s.b) - U.tz(s.a)];
    out.turn = { r0: d(st0[1]).join(','), r1: d(st1[1]).join(','), m: d(stm[1]).join(',') };
    const pl = B.place(loop, T(2, 12), 0, false);
    const vb = P.check(pl.project);
    const kb = connSum();
    const bb = P.build(pl.project);
    const loopBits = connSum() - kb;
    const grid = []; for (let z = 10; z <= 15; z++) { let row = ''; for (let x = 0; x < 20; x++) { const c = net.conn[T(x, z)]; row += c ? c.toString(16).padStart(2, '0') + ' ' : '.. '; } grid.push(row); }
    out.grid = grid;
    out.bp = { steps: pl.project.steps ? vb.steps.length : 0, state: vb.state, built: !!bb.ok, bits: loopBits, graph: net.validateGraph(5).length };
    // ---- capture that loop and place it again elsewhere: the same track ----
    const cap = B.capture(T(1, 12), T(17, 14));
    out.cap = cap.error || cap.bp.runs.length;
    const ex = B.exportJSON(cap.bp);
    const im = B.importJSON(ex);
    const bad = [
      B.importJSON('{"tracklandsBlueprint":1,"blueprint":{"name":"x","runs":[[0,0,"alert(1)",0,0]]}}').error,
      B.importJSON('{"tracklandsBlueprint":1,"blueprint":{"name":"<img onerror=1>","runs":[[0,0,3,0,9]]}}').error,
      B.importJSON('function(){}').error,
      B.importJSON('{"tracklandsBlueprint":2,"blueprint":{"runs":[[0,0,3,0,0]]}}').error,
    ];
    out.io = { im: !!im.ok, name: im.ok && !/[<>]/.test(im.bp.name), bad };
    // placed again far away
    let AX = -1, AZ = -1;
    for (let z = 6; z < N - 12 && AX < 0; z++) for (let x = 2; x < N - 24 && AX < 0; x++) {
      if (Math.abs(x - X) < 40 && Math.abs(z - Z) < 40) continue;
      let okA = true;
      for (let dz = 0; dz <= 5 && okA; dz++) for (let dx = 0; dx < 20 && okA; dx++) if (!free(x + dx, z + dz)) okA = false;
      if (okA) { AX = x; AZ = z; }
    }
    if (AX >= 0 && im.ok) {
      const p5 = B.place(im.bp, idx(AX + 1, AZ + 1), 0, false);
      const k5 = connSum();
      const b5 = P.build(p5.project);
      out.again = { ok: !!b5.ok, bits: connSum() - k5, err: b5.error || '' };
    }
    out.lib = B.all().length;
    // ---- a project with a second-pair step builds and undoes as one (once crashed: nested undo collection) ----
    const p6 = P.create('pair');
    P.addStep({ op: 'pair', a: T(10, 1), b: T(20, 1), tier: 0, side: 1, roles: 'express', L: 0 }, p6);
    const k6 = connSum(), u6 = C.undoStack.length;
    let b6;
    try { b6 = P.build(p6); } catch (e) { b6 = { error: 'threw ' + e.message }; }
    out.pairStep = { ok: !!b6.ok, err: b6.error || '', bits: connSum() - k6, undo: C.undoStack.length - u6, role: net.roleOf(T(15, 2)) };
    C.undo();
    out.pairStep.after = connSum() - k6; out.pairStep.roleAfter = net.roleOf(T(15, 1)); out.pairStep.graph = net.validateGraph(5).length;
    // ---- saved with the game ----
    const keep = P.create('kept');
    P.addStep({ op: 'track', a: T(0, 0), b: T(8, 0), tier: 0, mode: 'single', L: 0 }, keep);
    out.saved = P.list.map((p) => p.name + ':' + p.steps.length).join('|');
    return out;
  });
  if (r.error) { check(false, r.error); await ctx.close(); return { ok, lines }; }
  check(r.free.coins === 0 && r.free.conn === 0 && r.free.steps === 'track,station,depot' && r.free.ghosts > 10, `planning builds nothing and charges nothing (${JSON.stringify(r.free)})`);
  check(r.v1.state === 'ok' && r.v1.total > 0 && r.v1.total === r.v1.parts, `the project is ready, its cost broken down (${r.v1.total} ●)`);
  check(r.build1.ok && r.build1.spent > 0 && r.build1.spent === r.build1.est && r.build1.reported === r.build1.spent && r.build1.booked === r.build1.spent && r.build1.gone && r.build1.stn && r.build1.dep >= 1 && r.build1.graph === 0, `BUILD PROJECT charges exactly the estimate, once (${r.build1.spent} ● paid and booked ${r.build1.booked} ●, estimate ${r.build1.est} ●), and builds track, station and depot`);
  check(r.rollback.err && r.rollback.coins === 0 && r.rollback.conn === 0 && r.rollback.kept, `a step failing half way takes back the others: nothing built, nothing paid (${JSON.stringify(r.rollback)})`);
  check(r.partial.before === 'ok' && r.partial.after === 'blocked' && r.partial.bad.join() === '1' && r.partial.full, `a plan turns blocked when the ground is taken (${r.partial.reason}); building it all is refused`);
  check(r.partial.part && r.partial.built && r.partial.notBuilt && r.partial.spent > 0, `the valid part is built alone, the blocked step stays planned (${r.partial.spent} ●)`);
  check(r.dup.steps === 2 && r.dup.same, 'a duplicated project compares equal');
  check(r.turn.r0 === '2,2' && r.turn.r1 === '-2,2' && r.turn.m === '-2,2', `blueprints turn and mirror (${JSON.stringify(r.turn)})`);
  check(r.bp.state === 'ok' && r.bp.built && r.bp.bits > 30 && r.bp.graph === 0, `a built-in passing loop placed as a plan and built (${r.bp.bits} track legs)` + (r.bp.bits !== 48 ? '\n' + r.grid.join('\n') : ''));
  check(Number.isInteger(r.cap) && r.cap >= 3 && r.io.im && r.io.name && r.io.bad.every(Boolean), `captured (${r.cap} runs), exported and imported; bad imports refused (${r.io.bad.join(', ')})`);
  check(r.again && r.again.ok && r.again.bits === r.bp.bits, `the captured loop placed elsewhere builds the same track (${r.again && r.again.bits} vs ${r.bp.bits} legs${r.again && r.again.err ? ', ' + r.again.err : ''})`);
  check(r.pairStep.ok && r.pairStep.bits >= 16 && r.pairStep.undo === 1 && r.pairStep.role === 2 && r.pairStep.after === 0 && r.pairStep.roleAfter === 0 && r.pairStep.graph === 0, `a project with a second-pair step builds, and one undo takes it all back with its roles (${JSON.stringify(r.pairStep)})`);
  // save and load keep the projects
  const sv = await page.evaluate(async () => { const g = window.__tracklands.game, S = await import('./src/save/Save.js'); window.__psave = S.migrate(JSON.parse(JSON.stringify(g.serialize()))); return g.plans.list.map((p) => p.name + ':' + p.steps.length).join('|'); });
  await loadSave(page, await page.evaluate(() => window.__psave));
  const ld = await page.evaluate(() => { const g = window.__tracklands.game; return { names: g.plans.list.map((p) => p.name + ':' + p.steps.length).join('|'), on: g.plans.on }; });
  check(sv === r.saved && ld.names === sv && !ld.on, `projects survive a save (${ld.names}); planning mode starts off`);
  // the panel and the toolbar switch
  const ui = await page.evaluate(() => { const g = window.__tracklands.game; document.querySelectorAll('.modal-wrap').forEach((m) => m.remove()); if (g.ui.panel !== 'plans') g.ui.openPanel('plans'); const h = document.querySelector('#panel').innerHTML; return { build: /data-act="planBuild"/.test(h), bp: /data-act="bpPlace"/.test(h), sw: !!document.querySelector('.tool.planmode') }; });
  check(ui.build && ui.bp && ui.sw, `the PLAN panel lists projects and blueprints; the toolbar has the planning switch (${JSON.stringify(ui)})`);
  const out = ensureOut();
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(out, 'planning-panel.png') });
  if (errors.length) { ok = false; lines.push('errors: ' + errors.slice(0, 3).join(' | ')); }
  await ctx.close();
  return { ok, lines };
}
