// Town traffic performance and equivalence (Phase 13): the street traffic
// step measured with about 100, 250 and 400+ cars (average, p95, p99 per
// step), and a behaviour fingerprint of two fixed worlds — a city with a
// bus line, lights and four buses, and the 192 × 192 benchmark world with
// its railway — compared with tests/fixtures/traffic-fingerprint.json and
// between two identical runs. The fingerprint covers every car's stretch,
// position and waiting time, the buses, the lights, junction holds, the
// squeeze counter, the trains and the traffic and waiting heat, so an
// optimization that changes what happens on the streets fails here.
// After an intended change of behaviour: TRAFFIC_FP_UPDATE=1 node tests/run.mjs trafficperf
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPage, startTestGame } from '../lib.mjs';

export const name = 'trafficperf';
const FP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'traffic-fingerprint.json');

// a city with lights, a bus line and four buses
async function cityFingerprint(page) {
  await startTestGame(page, 4242);
  return page.evaluate(() => {
    const g = window.__tracklands.game, R = g.roads, T = g.towns, N = g.mapSize || 64, TR = g.traffic;
    g.economy.coins = 1e6; g.settings.weather = false;
    for (let i = 0; i < 8; i++) g.progression.regions.add(i);
    g.progression.level = Math.max(g.progression.level, 14);
    const t = T.list.slice().sort((a, b) => b.pop - a.pop)[0];
    t.stage = 4; T.levelUp(t); T.layout(t, true, 400); t.pop = Math.max(t.pop, 2600);
    g.stations.relinkAll(); T.onStationsChanged();
    const roads = [...t.roadSet].filter((i) => !g.net.conn[i] && !R.stopAt(i));
    const d = (a, b) => Math.max(Math.abs(a % N - b % N), Math.abs(Math.floor(a / N) - Math.floor(b / N)));
    let best = null;
    for (const a of roads) for (const b of roads) if (a < b && d(a, b) >= 6 && d(a, b) <= 10 && R.path(a, b) && (!best || R.path(a, b).length > best[2])) best = [a, b, R.path(a, b).length];
    const A = R.addStop(best[0], 'bus').stop, B = R.addStop(best[1], 'bus').stop;
    g.env.timeOfDay = 0.33; TR._adj = 0;
    const l = R.lines.create({ stops: [A.id, B.id], pattern: 'outback' }).line;
    for (let k = 0; k < 4; k++) R.buy('citybus', A, null, l);
    for (let k = 0; k < 30 * 120; k++) g.tick(1 / 30);
    const s = JSON.stringify({ cars: TR.cars.map((c) => [c.id, c.town, c.from, c.to, c.nx, +c.f.toFixed(9), +c.wait.toFixed(6)]), veh: R.vehicles.map((v) => [v.id, v.tile, v.state, +(v.f || 0).toFixed(9), v.trips, Math.round(v.earned)]), lights: [...TR.lights].map(([k, L]) => [k, L.axis, +L.t.toFixed(6)]), res: [...TR.res].map(([k, v]) => [k, v.k]), st: TR.stats, coins: Math.round(g.economy.coins) });
    let h = 0; for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
    return { hash: h, cars: TR.cars.length, buses: R.vehicles.length, trips: R.vehicles.map((v) => v.trips).join('/'), squeezed: TR.stats.squeezed };
  });
}

// the 192² benchmark world (railway, 36 trains, 124 towns)
async function benchWorld(page) {
  await page.evaluate(() => { const app = window.__tracklands; document.querySelectorAll('.modal-wrap').forEach((m) => m.remove()); if (app.game) { app.ui.detach(); app.game.dispose(); app.game = null; } app.startGame({ difficulty: 'builder', test: true, paused: true, seed: 5303, mapSize: 192 }); });
  await page.waitForFunction(() => window.__tracklands.game && window.__tracklands.game.running, null, { timeout: 180000 });
  return page.evaluate(async () => {
    const g = window.__tracklands.game; g.tutorial.skip();
    const { RailFuzz } = await import('./src/debug/RailFuzz.js');
    const F = new RailFuzz(g, 5303); F.setup(); F.buildNetwork();
    let guard = 0; while (g.trains.trains.length < 36 && guard++ < 600) { F.buyRandom(); for (let k = 0; k < 15; k++) g.tick(1 / 30); }
    for (let k = 0; k < 2400; k++) g.tick(1 / 30);
    const TR = g.traffic;
    const heat = (() => { let a = 0, b = 0, n = 0; const T = g.net.traffic, H = g.net.waitHeat; for (let i = 0; i < T.length; i++) { a += T[i] * (1 + (i % 7)); b += H[i] * (1 + (i % 5)); if (T[i] > 0 || H[i] > 0) n++; } return [a.toFixed(4), b.toFixed(4), n]; })();
    const s = JSON.stringify({ cars: TR.cars.map((c) => [c.id, c.town, c.from, c.to, c.nx, +c.f.toFixed(9), +c.wait.toFixed(6)]), lights: [...TR.lights].map(([k, L]) => [k, L.axis, +L.t.toFixed(6)]), res: [...TR.res].map(([k, v]) => [k, v.k]), sq: TR.stats, trains: g.trains.trains.map((t) => [t.id, +t.s.toFixed(6), +t.v.toFixed(6)]), coins: Math.round(g.economy.coins), heat });
    let h = 0; for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
    return { hash: h, cars: TR.cars.length, trains: g.trains.trains.length };
  });
}

// the traffic step alone, per step, at the current car count
async function measure(page, label) {
  return page.evaluate((label) => {
    const g = window.__tracklands.game, TR = g.traffic, per = [];
    for (let k = 0; k < 60; k++) g.tick(1 / 30);
    for (let k = 0; k < 400; k++) { const t = performance.now(); TR.tick(1 / 30); per.push(performance.now() - t); }
    per.sort((a, b) => a - b);
    return { label, cars: TR.cars.length, avg: per.reduce((a, b) => a + b, 0) / per.length, p95: per[Math.floor(per.length * 0.95)], p99: per[Math.floor(per.length * 0.99)] };
  }, label);
}

export async function run({ browser, base }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  const want = fs.existsSync(FP) ? JSON.parse(fs.readFileSync(FP, 'utf8')) : {};
  const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 900, height: 650 } });

  // ---- equivalence: the city, twice ----
  const c1 = await cityFingerprint(page), c2 = await cityFingerprint(page);
  check(c1.hash === c2.hash, `the city runs the same twice (${c1.cars} cars, ${c1.buses} buses, trips ${c1.trips}, squeezed ${c1.squeezed})`);
  if (want.city != null) check(c1.hash === want.city, `city traffic unchanged against the fixture (${c1.hash} / ${want.city})`);

  // ---- the benchmark world: fingerprint and timings at three car counts ----
  // (a fresh browser context: the city above switched weather off in the settings)
  await ctx.close();
  const P2 = await openPage(browser, base, { viewport: { width: 900, height: 650 } });
  const page2 = P2.page;
  const b = await benchWorld(page2);
  if (want.bench != null) check(b.hash === want.bench, `192² benchmark world unchanged against the fixture (${b.hash} / ${want.bench}): ${b.cars} cars, ${b.trains} trains`);
  const m250 = await measure(page2, 'benchmark world');
  // 400+ cars: the towns grown eightfold at rush hour (MAX_CARS caps at 480)
  await page2.evaluate(() => { const g = window.__tracklands.game; for (const t of g.towns.list) t.pop *= 8; g.env.timeOfDay = 0.33; g.traffic._adj = 0; for (let k = 0; k < 30 * 20; k++) g.tick(1 / 30); });
  const m400 = await measure(page2, 'towns ×8, rush hour');
  // about 100 cars: night (fewer cars on the same streets)
  await page2.evaluate(() => { const g = window.__tracklands.game; for (const t of g.towns.list) t.pop /= 8; g.env.timeOfDay = 0.02; g.traffic._adj = 0; for (let k = 0; k < 30 * 40; k++) g.tick(1 / 30); });
  const m100 = await measure(page2, 'night');
  for (const m of [m100, m250, m400]) lines.push(`     ${m.label}: ${m.cars} cars — traffic step avg ${m.avg.toFixed(3)} ms, p95 ${m.p95.toFixed(3)}, p99 ${m.p99.toFixed(3)}`);
  check(m400.cars >= 400 && m100.cars < m250.cars && m250.cars < m400.cars, `car counts ${m100.cars} / ${m250.cars} / ${m400.cars}`);
  // (per step at 30 steps a second; the whole frame budget is 33 ms)
  check(m400.avg < 2.5 && m250.avg < 1.5, `traffic stays cheap: ${m400.cars} cars in ${m400.avg.toFixed(2)} ms a step`);

  if (process.env.TRAFFIC_FP_UPDATE) { fs.writeFileSync(FP, JSON.stringify({ note: 'traffic behaviour fingerprints (tests/suites/trafficperf.mjs); update only after an intended change of behaviour', city: c1.hash, bench: b.hash }, null, 2) + '\n'); lines.push('fingerprints written'); }
  else if (want.city == null) check(false, 'no fingerprint fixture: run with TRAFFIC_FP_UPDATE=1 on a validated commit');
  const errs = [...errors, ...P2.errors];
  if (errs.length) { ok = false; lines.push('errors: ' + errs.slice(0, 3).join(' | ')); }
  await P2.ctx.close();
  return { ok, lines };
}
