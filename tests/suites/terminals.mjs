// Phase 7 ports and airports: three sizes each (reach, turnaround, berths or
// runway slots), the biggest ships and aircraft need the bigger sizes,
// aircraft wait for runway slots (at the gate or circling), ships wait for a
// free berth, the inspector shows it, sizes are saved.
import { openPage, startTestGame, loadSave } from '../lib.mjs';

export const name = 'terminals';
export async function run({ browser, base }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 1280, height: 800 } });
  await startTestGame(page, 11);
  const r = await page.evaluate(() => {
    const g = window.__tracklands.game, R = g.roads, N = g.mapSize, out = {};
    g.economy.coins = 5e7; g.settings.weather = false;
    for (let i = 0; i < 8; i++) g.progression.regions.add(i);
    g.progression.level = 40;
    if (g.maint) g.maint.mode = 'off';
    for (const t of g.towns.list) g.authority.ensure(t).rating = 100;
    const dist = (a, b) => Math.max(Math.abs(a % N - b % N), Math.abs(Math.floor(a / N) - Math.floor(b / N)));
    // --- airports
    const sites = [];
    for (let i = 0; i < N * N; i++) if (!R.stopError(i, 'airport') && R.nearTown(i)) sites.push(i);
    let air = null;
    for (let a = 0; a < sites.length && !air; a++) for (let b = sites.length - 1; b > a && !air; b--) if (dist(sites[a], sites[b]) >= 16 && R.nearTown(sites[a]) !== R.nearTown(sites[b])) air = [sites[a], sites[b]];
    out.air = !!air;
    if (air) {
      const A = R.addStop(air[0], 'airport').stop, B = R.addStop(air[1], 'airport').stop;
      out.wideSmall = R.buy('widebody', A).error;
      // many aircraft on one route: the regional runway runs out of slots
      for (let k = 0; k < 12; k++) { const v = R.buy('commuter_prop', A).vehicle; v.stops.push(B.id); }
      let maxCircle = 0, maxWait = 0;
      for (let i = 0; i < 30 * 150; i++) { g.tick(1 / 30); if (i % 30 === 0) { const w = R.runway(A), w2 = R.runway(B); maxCircle = Math.max(maxCircle, w.circling + w2.circling); maxWait = Math.max(maxWait, w.waiting + w2.waiting); } }
      const W = R.runway(A);
      out.runway = { mov: W.mov, cap: W.cap, maxCircle, maxWait };
      // the gap between movements never falls below the slot time
      const t = (A._mov || []).slice().sort((a, b) => a - b);
      let minGap = Infinity; for (let k = 1; k < t.length; k++) minGap = Math.min(minGap, t[k] - t[k - 1]);
      out.minGap = minGap; out.slot = W.slot;
      // expand both airports to hubs
      out.up1 = R.upgradeTerminal(A).ok && R.upgradeTerminal(B).ok;
      out.up2 = R.upgradeTerminal(A).ok && R.upgradeTerminal(B).ok;
      out.up3 = R.upgradeTerminal(A).error;
      out.hubCap = R.runway(A).cap;
      out.wideHub = !!R.buy('widebody', A).vehicle;
      out.sizeA = A.size;
      // (Phase 12: a hub is its own model, second runway included, drawn by size)
      R.rebuildStopMesh();
      out.hubMesh = [...R.termMeshes].filter(([k, m]) => /^airport:[a-z]+:3:/.test(k)).reduce((a, [, m]) => a + m.count, 0);
      g.select({ type: 'roadstop', id: A.id });
      out.panel = !!document.querySelector('[data-tip*="runway"], .kvrow') && document.body.innerText.includes(g.ui.tr('runway_use'));
    }
    // --- ports
    const shore = [];
    for (let i = 0; i < N * N; i++) if (!R.stopError(i, 'dock')) shore.push(i);
    let docks = null;
    for (let a = 0; a < shore.length && !docks; a++) for (let b = shore.length - 1; b > a && !docks; b--) if (dist(shore[a], shore[b]) >= 6 && R.waterPath(shore[a], shore[b])) docks = [shore[a], shore[b]];
    out.docks = !!docks;
    if (docks) {
      const A = R.addStop(docks[0], 'dock').stop, B = R.addStop(docks[1], 'dock').stop;
      out.bulkSmall = R.buy('bulk_carrier', A).error;
      out.berths0 = R.berths(A).cap;
      for (let k = 0; k < 6; k++) { const v = R.buy('ferry', A).vehicle; v.stops.push(B.id); }
      let maxUsed = 0, maxQueued = 0;
      for (let i = 0; i < 30 * 160; i++) { g.tick(1 / 30); if (i % 15 === 0 && i > 30 * 30) for (const s of [A, B]) { const b = R.berths(s); maxUsed = Math.max(maxUsed, b.used); maxQueued = Math.max(maxQueued, b.queued); } }
      out.port = { maxUsed, maxQueued, cap: R.berths(A).cap };
      out.portUp = R.upgradeTerminal(A).ok && R.upgradeTerminal(B).ok;
      out.berths1 = R.berths(A).cap;
      out.bulkPort = !!R.buy('bulk_carrier', A).vehicle;
      out.containerPort = R.buy('container_ship', A).error;
      // (Phase 12: cranes are part of the port model, one per size step)
      R.rebuildStopMesh();
      out.cranes = [...R.termMeshes].filter(([k, m]) => /^dock:[a-z]+:[23]:/.test(k)).reduce((a, [, m]) => a + m.count, 0) * (A.size || 1);
      out.reach = R.stopRadius(A);
    }
    out.save = g.serialize();
    return out;
  });
  check(r.air, 'two airports placed');
  if (r.air) {
    check(r.wideSmall === 'err_airport_small', `the Widebody needs a hub (${r.wideSmall})`);
    check(r.runway.mov <= r.runway.cap + 1 && (r.runway.maxCircle > 0 || r.runway.maxWait > 0), `a busy regional runway: ${JSON.stringify(r.runway)}`);
    check(r.minGap >= r.slot - 0.05, `movements are at least a slot apart (${r.minGap.toFixed(2)} s ≥ ${r.slot} s)`);
    check(r.up1 && r.up2 && r.up3 === 'err_max_level' && r.sizeA === 3, 'airports grow regional → international → hub');
    check(r.hubCap > r.runway.cap && r.wideHub && r.hubMesh >= 1, `a hub has more slots (${r.hubCap}) and takes the Widebody`);
    check(r.panel, 'the airport inspector shows runway use');
  }
  check(r.docks, 'two docks on the same water placed');
  if (r.docks) {
    check(r.bulkSmall === 'err_port_small', `bulk carriers need a port (${r.bulkSmall})`);
    check(r.port.maxUsed <= r.berths0 && r.port.maxQueued > 0, `berths limit the ships served at once: ${JSON.stringify(r.port)}`);
    check(r.portUp && r.berths1 > r.berths0 && r.bulkPort && r.containerPort === 'err_port_small' && r.cranes >= 2, `a port with cranes: ${r.berths1} berths, cranes ${r.cranes}, container ships need deep water`);
  }
  await loadSave(page, r.save);
  const l = await page.evaluate(() => { const R = window.__tracklands.game.roads; return R.stops.filter((s) => s.kind === 'airport' || s.kind === 'dock').map((s) => s.kind + s.size); });
  check(l.includes('airport3') && l.includes('dock2'), `sizes are saved: ${l.join(', ')}`);
  if (errors.length) { ok = false; lines.push('errors: ' + errors.slice(0, 3).join(' | ')); }
  await ctx.close();
  return { ok, lines };
}
