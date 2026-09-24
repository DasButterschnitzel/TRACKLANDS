// Level crossings (src/road/Crossings.js) on the production save, where a
// town street crosses the main line: the crossing is closed whenever a train
// is on it, no car is ever on the crossing tile while a train is, it opens
// again after the train, at 1× and coarse 4× steps; high-speed track and
// switches cut the street instead; save/load keeps working.
import { openPage, loadSave, productionSave } from '../lib.mjs';

export const name = 'crossings';
export async function run({ browser, base }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  const { ctx, page, errors } = await openPage(browser, base);
  for (const [label, dt] of [['1×', 1 / 30], ['4× coarse', 0.1]]) {
    await loadSave(page, productionSave());
    const r = await page.evaluate((dt) => {
      const g = window.__tracklands.game, X = g.crossings, T = g.towns;
      X.update(0, true);
      const tiles = [...X.map.keys()];
      if (!tiles.length) return { none: true };
      const out = { crossings: tiles.length, violations: 0, openWhileTrain: 0, closings: 0, openings: 0, maxClosed: 0, maxIdle: 0, samples: 0 };
      const idleFor = new Map();
      const closedFor = new Map();
      const carOn = (tile) => T.carList.some((c) => (c.from === tile && c.f < 0.5) || (c.to === tile && c.f >= 0.5));
      const steps = Math.round(240 / dt);
      for (let i = 0; i < steps; i++) {
        g.tick(dt);
        // the road side runs every frame in the game; here once per step
        T.updateVisuals(dt, g.clock); X.update(dt);
        for (const tile of tiles) {
          const c = X.at(tile);
          if (!c) continue;
          const train = g.trains.tileOccupied(tile);
          if (train && !c.closed) out.openWhileTrain++;
          if (train && carOn(tile)) out.violations++;
          const was = closedFor.get(tile);
          // closed with no train on the crossing (waiting for one to arrive)
          if (c.closed && !train) { idleFor.set(tile, (idleFor.get(tile) || 0) + dt); out.maxIdle = Math.max(out.maxIdle, idleFor.get(tile)); } else idleFor.delete(tile);
          if (c.closed) { if (was == null) { out.closings++; closedFor.set(tile, 0); } else closedFor.set(tile, was + dt); out.maxClosed = Math.max(out.maxClosed, closedFor.get(tile)); }
          else if (was != null) { out.openings++; closedFor.delete(tile); }
        }
        out.samples++;
      }
      return out;
    }, dt);
    if (r.none) { check(false, `${label}: the production save has no level crossing`); continue; }
    check(r.closings > 0 && r.openings > 0, `${label}: ${r.crossings} crossing(s) closed ${r.closings}× and opened ${r.openings}× in 4 minutes`);
    check(r.openWhileTrain === 0, `${label}: never open while a train is on it (${r.openWhileTrain})`);
    check(r.violations === 0, `${label}: no car on the crossing while a train is (${r.violations})`);
    check(r.maxIdle < 12, `${label}: barriers down without a train on the crossing for at most ${r.maxIdle.toFixed(1)} s (longest closure ${r.maxClosed.toFixed(1)} s, includes trains standing on it at the platform)`);
  }
  // save/load while closed; high-speed track and switches cut the street
  const s = await page.evaluate(async () => {
    const g = window.__tracklands.game, X = g.crossings;
    let tile = [...X.map.keys()][0], guard = 0;
    while (!X.isClosed(tile) && guard++ < 3000) { g.tick(1 / 30); X.update(1 / 30); }
    const closed = X.isClosed(tile);
    const Sv = await import('./src/save/Save.js');
    window.__xs = Sv.migrate(JSON.parse(JSON.stringify(g.serialize())));
    window.__xt = tile;
    return { closed, tile };
  });
  await page.evaluate(() => { window.__keepX = { s: window.__xs, t: window.__xt }; });
  const keep = await page.evaluate(() => window.__keepX);
  await loadSave(page, keep.s);
  const after = await page.evaluate((tile) => {
    const g = window.__tracklands.game, X = g.crossings;
    X.update(0, true);
    const closedNow = X.isClosed(tile), occ = !!g.trains.tileOccupied(tile), resv = !!(g.net.resv[tile * 2] || g.net.resv[tile * 2 + 1]);
    // high-speed track: no level crossing, the street is cut
    const tier = g.net.tier[tile];
    g.net.tier[tile] = 3; g.net.bumpVersion(); X.update(0);
    const town = g.towns.byId(X.map.size ? [...X.map.values()][0].town : 0) || g.towns.list.find((t) => t.roadSet && t.roadSet.size);
    const cut = !X.at(tile) && !(town && town.roadSet.has(tile));
    g.net.tier[tile] = tier; g.net.bumpVersion(); X.update(0);
    const back = !!X.at(tile);
    return { closedNow, occ, resv, cut, back };
  }, keep.t);
  check(s.closed && after.closedNow === (after.occ || after.resv), `after reload the crossing state follows the trains (closed ${after.closedNow}, train there ${after.occ || after.resv})`);
  check(after.cut && after.back, 'high-speed track cuts the street (no level crossing); normal track restores it');
  if (errors.length) { ok = false; lines.push('errors: ' + errors.slice(0, 2).join(' | ')); }
  await ctx.close();
  return { ok, lines };
}
