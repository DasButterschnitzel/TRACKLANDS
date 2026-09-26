// Cross-phase audit checks for systems that span several modes: airport
// sizes (regional → international, the biggest aircraft need international
// airports at every stop, faster turnaround, saved), cargo aircraft carrying
// goods between airports into a town, freight continuing from a railway
// station by lorry into a town (rail → road transfer), and a lorry depot in
// town taking goods for the town (it counts for the town's deliveries).
import { openPage, startTestGame, loadSave } from '../lib.mjs';

export const name = 'audit';

export async function run({ browser, base }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 1280, height: 800 } });
  await startTestGame(page, 4242);
  // ---------- airports ----------
  const air = await page.evaluate(() => {
    const g = window.__tracklands.game, R = g.roads, N = g.mapSize || 64, out = {};
    g.economy.coins = 1e8; g.progression.level = 40; g.settings.weather = false;
    for (let i = 0; i < 8; i++) g.progression.regions.add(i);
    const towns = g.towns.list.slice().sort((a, b) => b.pop - a.pop);
    const place = (t) => {
      for (let r = 3; r <= 7; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = t.x + dx, z = t.z + dz;
        if (x < 2 || z < 2 || x > N - 3 || z > N - 3) continue;
        const res = R.addStop(z * N + x, 'airport');
        if (res.stop) return res.stop;
      }
      return null;
    };
    let A = null, B = null;
    for (const t of towns) { if (!A) { A = place(t); continue; } if (Math.abs(t.x - A.tile % N) + Math.abs(t.z - Math.floor(A.tile / N)) >= 14) { B = place(t); if (B) break; } }
    if (!A || !B) return { none: true };
    out.sizes0 = [A.size, B.size];
    out.jumboSmall = R.buy('jumbo', A).error;
    const c0 = g.economy.coins;
    out.up = R.upgradeAirport(A);
    out.paid = Math.round(c0 - g.economy.coins);
    out.booked = g.ledger.log.some((e) => e.ref && e.ref.type === 'roadstop' && e.ref.id === A.id && e.amt < 0);
    out.again = R.upgradeAirport(A).error;
    const L = R.lines.create({ kind: 'airport', stops: [A.id, B.id] }).line;
    out.jumboLine = R.buy('jumbo', A, null, L).error;
    R.upgradeAirport(B);
    const j = R.buy('jumbo', A, null, L);
    out.jumbo = !!j.vehicle;
    out.reach = [R.stopRadius(A), g.stations.previewLinks(R.stopTiles(A), 1).radius];
    // cargo: goods waiting at A, flown to B (its town takes goods)
    const F = R.buy('freighter', A, null, L);
    out.freighter = !!F.vehicle;
    out.acceptsGoods = B.accepts.has('GOODS');
    const d0 = g.stats.data.deliveries;
    let goodsRev = 0;
    const on = (d) => { if (d.cargo === 'GOODS') goodsRev += d.revenue; };
    g.events.on('roadDelivery', on);
    for (let i = 0; i < 30 * 150; i++) { if (i % 60 === 0) A.stock.GOODS = Math.max(A.stock.GOODS || 0, 40); g.tick(1 / 30); }
    out.goodsRev = goodsRev; out.deliveries = g.stats.data.deliveries - d0;
    out.fEarned = F.vehicle.earned; out.jEarned = j.vehicle.earned;
    const S = JSON.parse(JSON.stringify(g.serialize()));
    window.__asave = S;
    out.ids = [A.id, B.id];
    return out;
  });
  check(!air.none, 'two airports near towns 14+ tiles apart');
  if (!air.none) {
    check(air.sizes0.join() === '1,1' && air.jumboSmall === 'err_airport_small', `new airports are regional; the Skyliner 300 is refused there (${air.jumboSmall})`);
    check(air.up.ok && air.paid > 0 && air.booked && air.again === 'err_max_level', `expanding to international costs ${air.paid} ● (booked with the airport), once`);
    check(air.jumboLine === 'err_airport_small' && air.jumbo, `a big aircraft needs international airports at every stop of its line (${air.jumboLine}, then bought)`);
    check(air.freighter && air.acceptsGoods && air.goodsRev > 0 && air.fEarned > 0, `the freighter flies goods into the other town (${air.goodsRev} ● for goods, ${air.deliveries} deliveries)`);
    check(air.jEarned > 0, `the Skyliner carries passengers (${air.jEarned} ●)`);
    await loadSave(page, await page.evaluate(() => window.__asave));
    const back = await page.evaluate((ids) => { const R = window.__tracklands.game.roads; return ids.map((id) => (R.stopById(id) || {}).size); }, air.ids);
    check(back.join() === '2,2', `airport sizes survive save/load (${back.join(',')})`);
  }
  // ---------- rail → road freight ----------
  await startTestGame(page, 4242);
  const fr = await page.evaluate(async () => {
    const g = window.__tracklands.game, R = g.roads, N = g.mapSize || 64, out = {};
    const { RailTests } = await import('./src/debug/RailTests.js');
    const RT = new RailTests(g);
    g.economy.coins = 1e8; g.progression.level = 40; g.settings.weather = false;
    for (let i = 0; i < 8; i++) g.progression.regions.add(i);
    const town = g.towns.list.slice().sort((a, b) => b.pop - a.pop)[0];
    const streets = [...town.roadSet].filter((i) => !g.net.conn[i]);
    // a railway station out in the country with a lorry stop beside it
    const a = RT.findArea(6, 5);
    if (!a) return { none: 'area' };
    RT.line(a.x0 + 1, a.z0 + 2, a.x0 + 5, a.z0 + 2); RT.finish();
    const st = RT.station(a.x0 + 3, a.z0 + 2);
    const ts = (a.z0 + 4) * N + a.x0 + 3;
    // road from beside the station to the town
    let plan = null, dest = null;
    for (const s of streets.sort((p, q) => Math.abs(p % N - ts % N) + Math.abs(Math.floor(p / N) - Math.floor(ts / N)) - Math.abs(q % N - ts % N) - Math.abs(Math.floor(q / N) - Math.floor(ts / N)))) { const p = R.plan(ts, s); if (p.ok) { plan = p; dest = s; break; } }
    if (!plan) return { none: 'road' };
    R.build(plan);
    const A = R.addStop(ts, 'truck').stop;
    let B = null;
    for (const s of streets) { if (s === dest || R.stopAt(s)) continue; const r = R.addStop(s, 'truck'); if (r.stop) { if (R.path(A.tile, r.stop.tile)) { B = r.stop; break; } R.removeStop && R.removeStop(r.stop); } }
    if (!A || !B) return { none: 'stops' };
    out.rail = A.rail === st.id; out.cargoTown = B.cargoTown === town.id; out.acc = B.accepts.has('GOODS');
    const L = R.lines.create({ kind: 'truck', stops: [A.id, B.id] }).line;
    const v = R.buy('box_truck', A, null, L).vehicle;
    st.stock.GOODS = 80;
    const got0 = town.got ? { ...town.got } : null;
    let rev = 0;
    g.events.on('roadDelivery', (d) => { if (d.cargo === 'GOODS' && d.vehicle === v) rev += d.revenue; });
    for (let i = 0; i < 30 * 120; i++) g.tick(1 / 30);
    out.left = Math.round(st.stock.GOODS || 0); out.fromRail = A.stats.fromRail || 0; out.rev = rev; out.trips = v.trips;
    out.transfers = st.stats.transfers;
    void got0;
    return out;
  });
  check(!fr.none, `a railway station with a lorry stop beside it and a lorry depot in town (${fr.none || 'ok'})`);
  if (!fr.none) {
    check(fr.rail && fr.cargoTown && fr.acc, 'the lorry stop feeds from the station; the town depot takes goods for its town');
    check(fr.fromRail > 0 && fr.left < 80 && fr.rev > 0, `goods left at the station continue by lorry into town: ${fr.fromRail} taken from the station (${fr.left} left), ${fr.rev} ● earned`);
  }
  if (errors.length) { ok = false; lines.push('errors: ' + errors.slice(0, 3).join(' | ')); }
  await ctx.close();
  return { ok, lines };
}
