// Phase 7 cities: accessibility, land value, districts, metropolitan
// regions, commuter belts, tourism, events and the effect of transit on
// traffic.
import { openPage, startTestGame, loadSave } from '../lib.mjs';

export const name = 'urban';

export async function run({ browser, base }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 1280, height: 800 } });
  await startTestGame(page, 4242);
  const r = await page.evaluate(() => {
    const g = window.__tracklands.game, R = g.roads, U = g.urban, N = g.mapSize, out = {};
    g.economy.coins = 1e8; g.progression.level = 40; g.settings.weather = false;
    for (let i = 0; i < 8; i++) g.progression.regions.add(i);
    const t = g.towns.list.slice().sort((a, b) => b.pop - a.pop)[0];
    // grow the town into a city so it has streets, districts and density
    t.stage = 4; t.pop = 8000; g.towns.layout(t, false);
    U.invalidate();
    const a0 = U.town(t);
    out.before = { score: a0.score, none: a0.share.none, lv: a0.lv };
    out.cars0 = g.traffic.wanted(t);
    // a bus line across the town
    const streets = [...t.roadSet].filter((i) => !g.net.conn[i]);
    const d = (a, b) => Math.max(Math.abs(a % N - b % N), Math.abs(Math.floor(a / N) - Math.floor(b / N)));
    const pairs = [];
    for (const a of streets) for (const b of streets) if (a < b && d(a, b) >= 4) pairs.push([a, b, d(a, b)]);
    pairs.sort((p, q) => q[2] - p[2]);
    let A = null, B = null;
    for (const [a, b] of pairs) { if (!R.path(a, b)) continue; const x = R.addStop(a, 'bus'), y = R.addStop(b, 'bus'); if (x.stop && y.stop) { A = x.stop; B = y.stop; break; } if (x.stop) R.removeStop(x.stop, 0); if (y.stop) R.removeStop(y.stop, 0); }
    if (!A) return { none: true };
    const l = R.lines.create({ kind: 'bus', stops: [A.id, B.id] }).line;
    for (let k = 0; k < 4; k++) R.buy('citybus', A, null, l);
    for (let i = 0; i < 30 * 90; i++) g.tick(1 / 30);
    U.invalidate();
    const a1 = U.town(t);
    out.after = { score: a1.score, none: a1.share.none, good: a1.share.good + a1.share.medium, lv: a1.lv };
    out.cars1 = g.traffic.wanted(t);
    out.districts = U.districts(t).map((x) => x.kind);
    // land value is higher next to the stop than at the edge of town
    const near = t.buildings.filter((b) => d(b.tile, A.tile) <= 1).map((b) => b.lv);
    out.lvNear = near.length ? Math.max(...near) : 0;
    // a second town touching this one: a metropolitan region
    const o = g.towns.list.filter((x) => x !== t).sort((p, q) => Math.hypot(p.x - t.x, p.z - t.z) - Math.hypot(q.x - t.x, q.z - t.z))[0];
    const ox = o.x, oz = o.z;
    o.x = t.x + 9; o.z = t.z; o.stage = 3; U.invalidate();
    out.metro = U.metros().map((m) => ({ name: m.name, n: m.towns.length, pop: m.pop }));
    o.x = ox; o.z = oz; U.invalidate();
    // events: announced a month ahead, more travellers while on
    U.events.push({ id: 99, kind: 'festival', town: t.id, start: g.time + 1, end: g.time + 61 });
    out.mulBefore = U.eventMul(t);
    for (let i = 0; i < 60; i++) g.tick(1 / 30);
    out.mulOn = U.eventMul(t);
    out.tour = U.tourism(t);
    // demolition compensation follows land value
    out.save = JSON.parse(JSON.stringify(g.serialize())).urban;
    return out;
  });
  check(!r.none, 'a city with a bus line');
  if (!r.none) {
    check(r.after.score > r.before.score && r.after.good > 0 && r.after.none < r.before.none, `a bus line raises accessibility: score ${r.before.score.toFixed(2)} → ${r.after.score.toFixed(2)}, no access ${Math.round(r.before.none * 100)}% → ${Math.round(r.after.none * 100)}%`);
    check(r.after.lv > r.before.lv && r.lvNear > r.after.lv * 0.9, `land value rises with access: ${r.before.lv.toFixed(2)} → ${r.after.lv.toFixed(2)} (next to the stop ${r.lvNear})`);
    check(r.cars1 <= r.cars0, `good transit takes cars off the streets: ${r.cars0} → ${r.cars1}`);
    check(r.districts.length >= 3, `districts: ${r.districts.join(', ')}`);
    check(r.metro.length >= 1 && r.metro[0].n >= 2, `touching towns form a metropolitan region: ${JSON.stringify(r.metro)}`);
    check(r.mulBefore === 1 && r.mulOn > 1, `an event brings more travellers once it starts (×${r.mulOn})`);
    check(r.save && Array.isArray(r.save.events) && r.save.events.some((e) => e.id === 99), 'events are saved');
  }
  if (errors.length) { ok = false; lines.push('errors: ' + errors.slice(0, 3).join(' | ')); }
  await ctx.close();
  return { ok, lines };
}
