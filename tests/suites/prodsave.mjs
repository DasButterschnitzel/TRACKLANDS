// Production save regression (permanent fixture: the real TRKL1 export).
// Checks that every piece of progress survives migration, that the network
// keeps earning in the expected band, and that a save round-trip is lossless.
import { openPage, loadSave, productionSave } from '../lib.mjs';

// Income over 20 simulated minutes, coins per minute. Legacy build: ~1239.
// The band is wide enough for dispatcher/weather variance but catches
// duplicated payments (> 2x) or lost income (< 0.75x).
const INCOME_BAND = [900, 2000];

export const name = 'prodsave';
export async function run({ browser, base, quick }) {
  const raw = productionSave();
  const { ctx, page, errors } = await openPage(browser, base);
  await loadSave(page, raw);
  const lines = [];
  let ok = true;
  const check = (cond, msg) => { lines.push((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) ok = false; };

  const st = await page.evaluate(() => {
    const g = window.__tracklands.game;
    return {
      coins: g.economy.coins, level: g.progression.level, xp: g.progression.xp, rp: g.progression.rp,
      research: [...g.progression.research].sort(), regions: [...g.progression.regions].sort(),
      trains: g.trains.trains.map((t) => ({ id: t.id, name: t.name, model: t.model, earned: t.earned, trips: t.trips, livery: t.livery, cargo: t.cargo.map((l) => l.c + ':' + l.n).join(','), veh: t.veh.map((v) => v.id).join('+'), mode: t.mode, route: t.route.length, depot: t.homeDepot, onTrack: !!t.steps.length })),
      stations: g.stations.list.map((s) => ({ id: s.id, tile: s.tile, name: s.name, stock: JSON.stringify(Object.fromEntries(Object.entries(s.stock).filter((e) => e[1] > 0))), level: s.level })),
      depots: g.stations.depots.length, track: g.net.conn.reduce((a, c) => a + (c ? 1 : 0), 0),
      industries: g.industries.list.map((i) => i.id + ':' + i.level).join(','), towns: g.towns.list.map((t) => t.id + ':' + t.stage + ':' + Math.round(t.pop)).join(','),
      contracts: g.economy.contracts.length, stats: g.stats.data.deliveries,
    };
  });
  const trackRaw = (() => { const b = Buffer.from(raw.net.conn, 'base64'); let n = 0; for (const v of b) if (v) n++; return n; })();
  check(st.coins === raw.economy.coins, `coins ${st.coins}`);
  check(st.level === raw.progression.level && Math.abs(st.xp - raw.progression.xp) < 1e-6 && st.rp === raw.progression.rp, `level ${st.level}, xp, research points`);
  check(JSON.stringify(st.research) === JSON.stringify([...raw.progression.research].sort()), `research (${st.research.length} nodes)`);
  check(st.regions.length === raw.progression.regions.length, `regions (${st.regions.length})`);
  check(st.trains.map((t) => t.name).join(',') === 'Pioneer 1,Atlas 1,Atlas 2', 'trains: ' + st.trains.map((t) => t.name).join(', '));
  for (const t of st.trains) {
    const r = raw.trains.find((x) => x.id === t.id);
    check(!!r && t.model === r.model && t.earned === r.earned && t.trips === r.trips && t.livery === r.livery && t.depot === r.depotId, `${t.name}: model ${t.model}, earned ${t.earned}, trips ${t.trips}, depot ${t.depot}`);
    check(r && t.cargo === r.cargo.map((l) => l.c + ':' + l.n).join(','), `${t.name}: cargo ${t.cargo || '(empty)'}`);
    check(t.veh.startsWith(r.model) && t.onTrack, `${t.name}: consist ${t.veh}, placed on track`);
  }
  check(st.stations.length === raw.stations.stations.length && st.stations.every((s) => { const r = raw.stations.stations.find((x) => x.id === s.id); return r && r.tile === s.tile && JSON.stringify(r.stock) === s.stock; }), `stations (${st.stations.length}) with stock`);
  check(st.track === trackRaw, `track tiles ${st.track}`);
  check(st.industries === raw.industries.map((i) => i.id + ':' + i.level).join(','), 'industries and levels');
  check(st.towns === raw.towns.map((t) => t.id + ':' + t.stage + ':' + t.pop).join(','), 'towns, stages, population');
  check(st.contracts === raw.economy.contracts.length && st.stats === raw.stats.deliveries, 'contracts and statistics');

  // run the network: no reservation conflicts, income in band
  const minutes = quick ? 8 : 20;
  const run = await page.evaluate((mins) => {
    const g = window.__tracklands.game;
    const c0 = g.economy.coins, col0 = g.trains.collisions, trips0 = g.trains.trains.reduce((a, t) => a + t.trips, 0);
    for (let m = 0; m < mins; m++) for (let i = 0; i < 30 * 60; i++) g.tick(1 / 30);
    return {
      perMin: (g.economy.coins - c0) / mins, conflicts: g.trains.collisions - col0, errors: g.trains.errors || 0,
      trips: g.trains.trains.reduce((a, t) => a + t.trips, 0) - trips0, stuck: g.trains.trains.filter((t) => t.state === 'run' && t.wait > 120).map((t) => t.name),
      nan: g.trains.trains.some((t) => !Number.isFinite(t.s)),
    };
  }, minutes);
  check(run.conflicts === 0 && run.errors === 0 && !run.nan, `simulated ${minutes} min: conflicts ${run.conflicts}, tick errors ${run.errors}`);
  check(run.stuck.length === 0 && run.trips > minutes, `trips ${run.trips}, stuck ${run.stuck.join(',') || 0}`);
  check(run.perMin >= INCOME_BAND[0] && run.perMin <= INCOME_BAND[1], `income ${run.perMin.toFixed(0)} coins/min (band ${INCOME_BAND.join('-')}, legacy ~1239)`);

  // lossless round trip after running
  const rt = await page.evaluate(async () => {
    const S = await import('./src/save/Save.js');
    const d = JSON.parse(JSON.stringify(window.__tracklands.game.serialize()));
    const again = S.migrate(JSON.parse(JSON.stringify(d)));
    window.__rt = d;
    const snap = (g) => JSON.stringify({ c: Math.round(g.economy.coins), t: g.trains.trains.map((x) => [x.id, x.name, x.veh.map((v) => v.id).join('+'), x.earned, x.trips, x.cargo.map((l) => l.c + l.n).join(), x.mode]), s: g.stations.list.map((s) => [s.id, JSON.stringify(Object.fromEntries(Object.entries(s.stock).filter((e) => e[1] > 0))), s.tracks.length]), r: [...g.progression.research].length });
    return { idem: JSON.stringify(again) === JSON.stringify(d), before: snap(window.__tracklands.game) };
  });
  await loadSave(page, await page.evaluate(() => window.__rt));
  const after = await page.evaluate(() => { const g = window.__tracklands.game; return JSON.stringify({ c: Math.round(g.economy.coins), t: g.trains.trains.map((x) => [x.id, x.name, x.veh.map((v) => v.id).join('+'), x.earned, x.trips, x.cargo.map((l) => l.c + l.n).join(), x.mode]), s: g.stations.list.map((s) => [s.id, JSON.stringify(Object.fromEntries(Object.entries(s.stock).filter((e) => e[1] > 0))), s.tracks.length]), r: [...g.progression.research].length }); });
  check(rt.idem, 'migration of the current save is a no-op');
  check(rt.before === after, 'save -> reload keeps coins, trains, cargo, stations, research');
  if (errors.length) { ok = false; lines.push('page errors: ' + errors.slice(0, 3).join(' | ')); }
  await ctx.close();
  return { ok, lines };
}
