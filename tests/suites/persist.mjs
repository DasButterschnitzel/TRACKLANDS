// Save/load with live edits (signals, waypoints, platform extension, consist
// change, manual schedule, templates) and offline progress rules.
import { openPage, loadSave, productionSave } from '../lib.mjs';

export const name = 'persist';
export async function run({ browser, base }) {
  const { ctx, page, errors } = await openPage(browser, base);
  await loadSave(page, productionSave());
  const lines = [];
  let ok = true;
  const check = (cond, msg) => { lines.push((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) ok = false; };
  const snapFn = () => {
    const gg = window.__tracklands.game;
    return JSON.stringify({
      trains: gg.trains.trains.map((x) => [x.id, x.name, (x.pendingVeh || x.veh).map((v) => v.id).join('+'), x.mode, JSON.stringify(x.route.map((r) => Object.keys(r).sort().map((k) => [k, r[k]]))), x.earned, x.trips, x.cargo.map((l) => l.c + l.n).join()]),
      sig: [...gg.net.signals.entries()].map(([k, v]) => k + ':' + v.type).join(), wp: [...gg.net.waypoints.keys()].join(),
      tracks: gg.stations.list.map((s) => s.id + ':' + s.tracks.map((t) => t.tiles.join('.')).join('|')).join(), tpl: JSON.stringify(gg.progression.templates || []),
      coins: Math.round(gg.economy.coins),
    });
  };
  const a = await page.evaluate(async (snapSrc) => {
    const snap = eval(snapSrc);
    const g = window.__tracklands.game;
    const S = await import('./src/save/Save.js');
    for (let i = 0; i < 30 * 60; i++) g.tick(1 / 30);
    g.progression.research.add('block_signals'); g.progression.research.add('platform_extension');
    let sig = null, wp = null;
    for (let i = 0; i < 4096 && (!sig || !wp); i++) {
      if (!g.net.conn[i] || g.net.degree(i) !== 2 || g.net.special.has(i) || g.trains.tileReserved(i)) continue;
      let d = -1; for (let k = 0; k < 8; k++) if (g.net.hasDir(i, k)) { d = k; break; }
      if (!sig) { g.net.signals.set(i * 8 + d, { type: 'block', oneway: true }); sig = i * 8 + d; continue; }
      if (!wp) { g.net.waypoints.set(i, { id: g.net.nextWp++, name: 'WP test' }); wp = i; }
    }
    g.net.bumpVersion();
    const ext = g.stations.extendPlatform(g.stations.byId(7), 0, 0);
    const t = g.trains.byId(4);
    g.trains.applyConsist(t, [...t.veh, { k: 'W', id: 'coach', r: false }]);
    t.mode = 'manual'; t.route = [{ st: 10, act: 'unload', dwell: 5, full: false, skip: false, plat: null, cargo: null }, { st: 13, act: 'auto', dwell: 0, full: true, skip: false, plat: 0, cargo: ['PASSENGERS'] }];
    g.progression.templates = [{ name: 'Tpl', veh: ['L:atlas', 'W:timber'] }];
    const data = JSON.parse(JSON.stringify(g.serialize()));
    window.__saved = data;
    return { ext: ext.error || 'ok', idem: JSON.stringify(S.migrate(JSON.parse(JSON.stringify(data)))) === JSON.stringify(data), before: snap() };
  }, `(${snapFn.toString()})`);
  await loadSave(page, await page.evaluate(() => window.__saved));
  const b = await page.evaluate(snapFn);
  check(a.idem, 'current save format migrates as a no-op');
  check(a.before === b, `edits survive save/reload (platform extension: ${a.ext})`);
  if (a.before !== b) { const A = JSON.parse(a.before), B = JSON.parse(b); for (const k of Object.keys(A)) if (JSON.stringify(A[k]) !== JSON.stringify(B[k])) lines.push(`     ${k}: before ${JSON.stringify(A[k]).slice(0, 400)}\n     ${k}: after  ${JSON.stringify(B[k]).slice(0, 400)}`); }

  // offline progress: aggregate math, capped, claimable once, never negative
  const off = await page.evaluate(() => {
    const g = window.__tracklands.game;
    const d = JSON.parse(JSON.stringify(g.serialize()));
    const res = {};
    d.savedAt = Date.now() - 2 * 3600 * 1000; const o2 = g.computeOffline(d);
    d.savedAt = Date.now() - 400 * 24 * 3600 * 1000; const oMax = g.computeOffline(d);
    d.savedAt = Date.now() + 3600 * 1000; const oFuture = g.computeOffline(d);
    res.two = o2 ? o2.coins : 0; res.max = oMax ? oMax.coins : 0; res.maxAway = oMax ? oMax.away : 0; res.future = oFuture;
    res.perMin = g.economy.avgIncomePerMin();
    g.offline = o2; const c0 = g.economy.coins; g.claimOffline(); const c1 = g.economy.coins; g.claimOffline(); const c2 = g.economy.coins;
    res.claimed = c1 - c0; res.second = c2 - c1;
    return res;
  });
  check(off.future === null, 'clock set back (save from the future): no offline reward');
  check(off.maxAway <= 4 * 3600 + 1 && off.max <= off.perMin * 240 * 0.61 + 1, `offline capped at 4 h (${Math.round(off.max)} coins)`);
  check(off.two > 0 && off.two <= off.perMin * 120 * 0.61 + 1, `2 h away pays ${Math.round(off.two)} (<= 60% of ${Math.round(off.perMin)}/min)`);
  check(off.claimed === off.two && off.second === 0, 'offline reward is claimed exactly once');
  if (errors.length) { ok = false; lines.push('page errors: ' + errors.slice(0, 3).join(' | ')); }
  await ctx.close();
  return { ok, lines };
}
