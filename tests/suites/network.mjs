// Phase 7 transport network: one economy across services and modes.
//  - freight routes itself across two train lines (a change at H), pays
//    nothing when it changes and the whole journey once at delivery, split
//    between the two trains by distance
//  - carrying freight back and forth between two feeder stops earns nothing
//  - travellers get trips with a purpose and a destination, change trains at
//    H and pay the whole journey on arrival (both trains get a share)
//  - loads keep their journey through save/load; older saves' passengers
//    waiting for a connection (paxTo) become packets bound there
import { openPage, startTestGame, loadSave } from '../lib.mjs';

export const name = 'network';

export async function run({ browser, base }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 1280, height: 800 } });
  await startTestGame(page, 777);
  // ---------- freight across two lines ----------
  const fr = await page.evaluate(async () => {
    const g = window.__tracklands.game, S = g.stations, out = {};
    const { RailTests } = await import('./src/debug/RailTests.js');
    const RT = new RailTests(g);
    g.economy.coins = 1e8; g.progression.level = 40; g.settings.weather = false;
    for (let i = 0; i < 8; i++) g.progression.regions.add(i);
    for (const r of ['specialized_wagons', 'electric_rail']) g.progression.research.add(r);
    const hub = RT.buildPaxHub();
    if (!hub) return { none: true };
    const { A, H, C, D } = hub;
    // C takes coal (and nothing else here does)
    const acc = S.accepts;
    S.accepts = function (stn, c) { if (c === 'COAL') return stn === C; return acc.call(this, stn, c); };
    g.network.invalidate();
    const t1 = RT.train(['L:trailmaster', 'W:hopper', 'W:hopper'], D, [A, H], { act: 'auto' });
    const t2 = RT.train(['L:trailmaster', 'W:hopper', 'W:hopper'], D, [H, C], { act: 'auto' });
    A.stock.COAL = 60;
    g.network.invalidate();
    // routing: from A the coal goes to C via H
    const acc0 = g.network.toAcc('COAL');
    out.route = acc0.get(A.id) ? { dest: acc0.get(A.id).dest, via: acc0.get(A.id).e && acc0.get(A.id).e.to } : null;
    out.ids = { A: A.id, H: H.id, C: C.id };
    // every coal booking in the books, and when the first packet waits at H
    const book = [];
    const L = g.ledger, b0 = L.book.bind(L);
    L.book = (amt, cat, ref, note, log) => { if (typeof note === 'string' && note.includes('COAL')) book.push({ t: g.time, amt, ref }); return b0(amt, cat, ref, note, log); };
    let firstAtH = null, firstAtC = null;
    const deliver = g.economy.deliver.bind(g.economy);
    let delivered = 0, legs = 0;
    // (C may also get coal from a mine near H: only A's coal counts here)
    g.economy.deliver = (train, stn, lot) => { const r = deliver(train, stn, lot); if (lot.c === 'COAL' && lot.o === A.id) { delivered += lot.n; legs = Math.max(legs, (lot.lg || []).length + 1); if (firstAtC == null) firstAtC = g.time; out.lastLot = { o: lot.o, fd: lot.fd, x: lot.x, lg: lot.lg }; } return r; };
    for (let i = 0; i < 30 * 480; i++) {
      g.tick(1 / 30);
      if (firstAtH == null && H.pk && H.pk.some((p) => p.c === 'COAL' && p.o === A.id)) { firstAtH = g.time; out.pk = H.pk.filter((p) => p.c === 'COAL').map((p) => ({ n: p.n, o: p.o, fd: p.fd, lg: p.lg })); }
      if (i % 30 === 0 && A.stock.COAL < 30) A.stock.COAL += 20;
    }
    L.book = b0; S.accepts = acc; g.economy.deliver = deliver;
    // the A – H train is paid nothing for coal until A's coal arrives at C
    const paidBeforeC = book.filter((x) => x.amt > 0 && x.ref && x.ref.id === t1.id && (firstAtC == null || x.t < firstAtC)).length;
    out.firstAtH = firstAtH; out.firstAtC = firstAtC; out.paidBeforeC = paidBeforeC; out.delivered = delivered; out.legs = legs;
    const pos = book.filter((x) => x.amt > 0);
    out.t1 = pos.filter((x) => x.ref && x.ref.id === t1.id).reduce((a, x) => a + x.amt, 0);
    out.t2 = pos.filter((x) => x.ref && x.ref.id === t2.id).reduce((a, x) => a + x.amt, 0);
    out.dAH = Math.abs(A.tile % 64 - H.tile % 64); out.dHC = Math.abs(H.tile % 64 - C.tile % 64);
    out.transfers = g.stats.data.cargoTransfers;
    RT.cleanup([t1, t2]);
    return out;
  });
  check(!fr.none, 'a line A – H – C with two train lines');
  if (!fr.none) {
    check(fr.route && fr.route.dest === fr.ids.C, `the network routes coal from A to C (the only place that takes it) via H (${JSON.stringify(fr.route)})`);
    check(fr.firstAtH != null && fr.firstAtC > fr.firstAtH && fr.paidBeforeC === 0, `coal changes trains at H (first at ${fr.firstAtH && fr.firstAtH.toFixed(0)} s: ${JSON.stringify(fr.pk)}); the A – H train is paid nothing before A's coal arrives at C (${fr.firstAtC && fr.firstAtC.toFixed(0)} s; ${fr.paidBeforeC} bookings)`);
    check(fr.delivered > 0 && fr.legs === 2, `delivered at C: ${fr.delivered} units over ${fr.legs} legs (${JSON.stringify(fr.lastLot)})`);
    const share = fr.t1 / Math.max(1, fr.t1 + fr.t2), want = fr.dAH / Math.max(1, fr.dAH + fr.dHC);
    check(fr.t1 > 0 && fr.t2 > 0 && Math.abs(share - want) < 0.12, `both trains are paid for their leg: A–H ${fr.t1} ●, H–C ${fr.t2} ● (share ${share.toFixed(2)}, distance share ${want.toFixed(2)})`);
  }
  // ---------- no money from carrying things back and forth ----------
  await startTestGame(page, 777);
  const bounce = await page.evaluate(async () => {
    const g = window.__tracklands.game, S = g.stations;
    const { RailTests } = await import('./src/debug/RailTests.js');
    const RT = new RailTests(g);
    g.economy.coins = 1e8; g.progression.level = 40; g.settings.weather = false;
    for (let i = 0; i < 8; i++) g.progression.regions.add(i);
    g.progression.research.add('specialized_wagons');
    const hub = RT.buildPaxHub();
    if (!hub) return { none: true };
    const { A, H, D } = hub;
    const acc = S.accepts;
    S.accepts = function (stn, c) { if (c === 'COAL') return false; return acc.call(this, stn, c); };
    // a feeder order at both ends: the coal is handed over again and again
    const t = RT.train(['L:trailmaster', 'W:hopper', 'W:hopper'], D, [A, H], { act: 'transfer' });
    A.stock.COAL = 40;
    let income = 0;
    const L = g.ledger, b0 = L.book.bind(L);
    L.book = (amt, cat, ref, note, log) => { if (amt > 0 && (cat === 'freight' || cat === 'delivery')) income += amt; return b0(amt, cat, ref, note, log); };
    const tr0 = g.stats.data.cargoTransfers || 0;
    for (let i = 0; i < 30 * 300; i++) g.tick(1 / 30);
    L.book = b0; S.accepts = acc;
    const transfers = (g.stats.data.cargoTransfers || 0) - tr0;
    RT.cleanup([t]);
    return { income, transfers, trips: t.trips };
  });
  check(!bounce.none && bounce.transfers >= 40 && bounce.income === 0, `feeder orders at both ends: ${bounce.transfers} units handed over on ${bounce.trips} trips earn ${bounce.income} ● (nothing until a delivery)`);
  // ---------- travellers: trips, purposes, a change at H ----------
  await startTestGame(page, 777);
  const px = await page.evaluate(async () => {
    const g = window.__tracklands.game, S = g.stations;
    const { RailTests } = await import('./src/debug/RailTests.js');
    const RT = new RailTests(g);
    g.economy.coins = 1e8; g.progression.level = 40; g.settings.weather = false;
    for (let i = 0; i < 8; i++) g.progression.regions.add(i);
    const hub = RT.buildPaxHub();
    if (!hub) return { none: true };
    const { A, H, C, D } = hub;
    const mine = new Set([A.id, H.id, C.id]);
    const acc = S.accepts;
    S.accepts = function (stn, c) { return (c === 'PASSENGERS' && mine.has(stn.id)) || acc.call(this, stn, c); };
    const t1 = RT.train(['L:trailmaster', 'W:coach', 'W:coach'], D, [A, H], { act: 'auto' });
    const t2 = RT.train(['L:trailmaster', 'W:coach', 'W:coach'], D, [H, C], { act: 'auto' });
    g.network.invalidate();
    A.stock.PASSENGERS = 150;
    // the first trip assignment at A
    g.pax.assign(A);
    const pk = (A.pk || []).filter((p) => p.c === 'PASSENGERS');
    const out = { purposes: [...new Set(pk.map((p) => p.p).filter(Boolean))], dests: [...new Set(pk.map((p) => p.fd))], tagged: g.pax.tagged(A) };
    out.conn = g.pax.connections(A).map((c) => (c.st === C.id ? 'C' + (c.via === H.id ? '~H' : '') : c.st === H.id ? 'H' : c.st));
    let atC = 0, both = 0, viaH = 0;
    const earned = new Map();
    const d0 = g.economy.deliver.bind(g.economy);
    g.economy.deliver = (train, stn, lot) => { const r = d0(train, stn, lot); if (lot.c === 'PASSENGERS' && stn === C && lot.o === A.id) { atC += lot.n; if ((lot.lg || []).length >= 1) viaH += lot.n; } return r; };
    const L = g.ledger, b0 = L.book.bind(L);
    L.book = (amt, cat, ref, note, log) => { if (amt > 0 && cat === 'pax' && ref) earned.set(ref.id, (earned.get(ref.id) || 0) + amt); return b0(amt, cat, ref, note, log); };
    for (let i = 0; i < 30 * 480; i++) { g.tick(1 / 30); if (i % 60 === 0 && A.stock.PASSENGERS < 60) A.stock.PASSENGERS += 30; }
    g.economy.deliver = d0; L.book = b0; S.accepts = acc;
    both = (earned.get(t1.id) || 0) > 0 && (earned.get(t2.id) || 0) > 0;
    Object.assign(out, { atC, viaH, both, e1: earned.get(t1.id) || 0, e2: earned.get(t2.id) || 0, transfers: H.stats.transfers });
    // a save with passengers waiting at H and loads with a journey aboard
    const save = JSON.parse(JSON.stringify(g.serialize()));
    const hS = save.stations.stations.find((s) => s.id === H.id);
    out.savedPk = hS.pk ? hS.pk.length : 0;
    out.savedLots = save.trains.reduce((a, t) => a + t.cargo.filter((l) => l.o != null).length, 0);
    // an older save: passengers waiting at H for C in the old form
    hS.paxTo = { [C.id]: 25 }; delete hS.pk; hS.stock.PASSENGERS = Math.max(hS.stock.PASSENGERS || 0, 25);
    window.__nsave = save; window.__nids = { H: H.id, C: C.id };
    return out;
  });
  check(!px.none, 'travellers on A – H – C');
  if (!px.none) {
    check(px.purposes.length >= 3 && px.dests.length >= 2 && px.tagged > 0, `travellers at A get trips: purposes ${px.purposes.join(', ')}; destinations ${px.dests.length}; ${px.tagged} with a destination`);
    check(px.conn.includes('C~H') && px.conn.includes('H'), `A connects to H directly and to C with a change at H (${px.conn.join(', ')})`);
    check(px.atC > 0 && px.viaH > 0 && px.transfers > 0, `${px.atC} travellers from A arrived at C (${px.viaH} after changing at H; ${px.transfers} changes at H)`);
    check(px.both, `both trains are paid for journeys to C: A–H ${px.e1} ●, H–C ${px.e2} ●`);
    check(px.savedPk > 0 || px.savedLots > 0, `waiting packets (${px.savedPk}) and loads with a journey aboard (${px.savedLots}) are saved`);
    await loadSave(page, await page.evaluate(() => window.__nsave));
    const back = await page.evaluate((ids) => { const g = window.__tracklands.game; const H = g.stations.byId(ids.H); return { pk: (H.pk || []).filter((p) => p.c === 'PASSENGERS' && p.fd === ids.C).reduce((a, p) => a + p.n, 0), stock: H.stock.PASSENGERS || 0 }; }, await page.evaluate(() => window.__nids));
    check(back.pk >= 25 && back.pk <= back.stock, `an older save's travellers waiting at H for C (paxTo) are packets bound for C after loading (${back.pk} of ${back.stock} waiting)`);
  }
  // ---------- storage classes, handling equipment, containerization ----------
  await startTestGame(page, 777);
  const st = await page.evaluate(async () => {
    const g = window.__tracklands.game, S = g.stations, out = {};
    const { RailTests } = await import('./src/debug/RailTests.js');
    const RT = new RailTests(g);
    g.economy.coins = 1e8; g.progression.level = 40; g.settings.weather = false;
    for (let i = 0; i < 8; i++) g.progression.regions.add(i);
    const a = RT.findArea(8, 3);
    if (!a) return { none: true };
    RT.line(a.x0 + 1, a.z0 + 1, a.x0 + 6, a.z0 + 1); RT.finish();
    const X = RT.station(a.x0 + 3, a.z0 + 1);
    // coal and ore share the bulk room; goods have their own (general)
    const bulk = S.classCap(X, 'bulk');
    out.coal = S.receive(X, 'COAL', bulk - 10); out.ore = S.receive(X, 'ORE', 50); out.goods = S.receive(X, 'GOODS', 30);
    out.bulk = bulk; out.base = S.storage(X);
    out.useBulk = S.classUse(X, 'bulk');
    // a bulk loader adds room (research: freight terminals)
    out.noResearch = S.facilityError(X, 'coal_loader');
    g.progression.research.add('freight_terminals');
    out.built = S.buildFacility(X, 'coal_loader');
    out.bulk2 = S.classCap(X, 'bulk');
    out.ore2 = S.receive(X, 'ORE', 50);
    // container terminal: needs containerization; goods then use the container yard and load faster
    out.contLocked = S.facilityError(X, 'container_crane');
    g.progression.research.add('containerization');
    out.slots = [S.facilityError(X, 'container_crane'), X.facilities.length];
    S.buildFacility(X, 'container_crane');
    out.goodsClass = S.storeClass(X, 'GOODS');
    out.rate = [S.loadRate(X, ['COAL']), S.loadRate(X, ['GOODS'])];
    out.baseRate = X.level != null ? S.loadRate({ ...X, facilities: [] }, ['GOODS']) : 0;
    out.handling = S.handling(X);
    // three facilities need a bigger station
    out.third = S.facilityError(X, 'warehouse');
    X.level = 2;
    out.thirdL2 = S.facilityError(X, 'warehouse');
    const save = JSON.parse(JSON.stringify(g.serialize()));
    out.savedFac = save.stations.stations.find((s) => s.id === X.id).facilities;
    return out;
  });
  check(!st.none, 'a freight station for the storage checks');
  if (!st.none) {
    check(st.coal === st.bulk - 10 && st.ore === 10 && st.useBulk === st.bulk && st.goods === 30, `storage classes: coal and ore share the bulk room (${st.coal} + ${st.ore} of ${st.bulk}), goods have their own room (${st.goods})`);
    check(st.noResearch === 'err_research_required' && !st.built && st.bulk2 >= st.bulk * 1.7 && st.ore2 === 50, `a bulk loader (freight terminals) adds bulk room: ${st.bulk} → ${st.bulk2}, and 50 more ore fit`);
    check(st.contLocked === 'err_research_required' && st.slots[0] == null && st.goodsClass === 'container', `the container terminal needs containerization; goods then go to the container yard (${st.goodsClass})`);
    check(st.rate[1] >= st.baseRate * 2.3 && st.handling <= 0.5, `containers load ${Math.round(st.rate[1] / st.baseRate * 100)}% as fast as without equipment; handover takes ×${st.handling}`);
    check(st.third === 'err_max_facilities' && st.thirdL2 == null && st.savedFac.join() === 'coal_loader,container_crane', `a small station takes two facilities, a level 3 station three (${st.third}); facilities are saved`);
  }
  if (errors.length) { ok = false; lines.push('errors: ' + errors.slice(0, 3).join(' | ')); }
  await ctx.close();
  return { ok, lines };
}
