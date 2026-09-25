// Trams, ships and aircraft (src/road/Roads.js modes): a tram line on tram
// track through a town, a ferry between two docks on the same water, a
// propliner between two airports; each carries, earns and is booked per
// vehicle; docks and airports claim their land; everything is saved; the stop
// tool offers the new kinds and places an airport with the mouse.
import { openPage, startTestGame, loadSave } from '../lib.mjs';

export const name = 'transport';
export async function run({ browser, base }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 1280, height: 800 } });
  await startTestGame(page, 11);
  const r = await page.evaluate(async () => {
    const g = window.__tracklands.game, R = g.roads, W = g.world, N = 64, out = {};
    g.economy.coins = 5e6;
    g.settings.weather = false;
    for (let i = 0; i < 8; i++) g.progression.regions.add(i);
    g.progression.level = 30;
    for (const t of g.towns.list) g.authority.ensure(t).rating = 100;
    const dist = (a, b) => Math.max(Math.abs(a % N - b % N), Math.abs(Math.floor(a / N) - Math.floor(b / N)));
    // --- tram: along a town's streets
    const towns = g.towns.list.filter((t) => t.roadSet && t.roadSet.size > 6).sort((a, b) => b.roadSet.size - a.roadSet.size);
    let tram = null;
    for (const t of towns) {
      const st = [...t.roadSet].filter((i) => !g.net.conn[i]);
      for (let a = 0; a < st.length && !tram; a++) for (let b = st.length - 1; b > a && !tram; b--) {
        if (dist(st[a], st[b]) < 4) continue;
        const p = R.planTram(st[a], st[b]);
        if (p.ok) tram = { a: st[a], b: st[b], p, town: t.name };
      }
      if (tram) break;
    }
    out.tramFound = !!tram;
    if (tram) {
      const b = R.buildTram(tram.p);
      const A = R.addStop(tram.a, 'tram'), B = R.addStop(tram.b, 'tram');
      out.tramStops = [A.error || 'ok', B.error || 'ok'];
      if (A.stop && B.stop) {
        const v = R.buy('tram', A.stop).vehicle;
        v.stops.push(B.stop.id);
        window.__tramv = v.id;
      }
      out.tramBuilt = !!b.ok;
      out.noTramStopOffTrack = R.stopError([...towns[0].roadSet].find((i) => !R.tram[i] && !g.net.conn[i]) ?? -1, 'tram');
    }
    // --- docks: two shore tiles on the same water, far apart
    const shore = [];
    for (let i = 0; i < N * N; i++) if (!R.stopError(i, 'dock') && g.stations.previewLinks([i], 1).towns.length) shore.push(i);
    let docks = null;
    for (let a = 0; a < shore.length && !docks; a++) for (let b = shore.length - 1; b > a && !docks; b--) {
      if (dist(shore[a], shore[b]) < 8) continue;
      const ta = g.stations.previewLinks([shore[a]], 1).towns.map((t) => t.id), tb = g.stations.previewLinks([shore[b]], 1).towns.map((t) => t.id);
      if (ta.some((id) => tb.includes(id))) continue;
      if (R.waterPath(shore[a], shore[b])) docks = [shore[a], shore[b]];
    }
    out.docksFound = !!docks;
    if (docks) {
      const A = R.addStop(docks[0], 'dock').stop, B = R.addStop(docks[1], 'dock').stop;
      out.dockClaim = g.occupancy.blocked[docks[0]] === 3 && !!g.net.tileBlockedReason(docks[0]);
      const v = R.buy('ferry', A).vehicle; v.stops.push(B.id);
      window.__shipv = v.id;
      out.dockLinks = [A.links.towns.length + A.links.industries.length, B.links.towns.length + B.links.industries.length];
      out.shipPath = R.waterPath(docks[0], docks[1]).length;
    }
    // --- airports near two towns, far apart
    const sites = [];
    for (let i = 0; i < N * N; i += 1) { if (!R.stopError(i, 'airport') && R.nearTown(i)) sites.push(i); }
    let air = null;
    for (let a = 0; a < sites.length && !air; a++) for (let b = sites.length - 1; b > a && !air; b--) if (dist(sites[a], sites[b]) >= 20 && R.nearTown(sites[a]) !== R.nearTown(sites[b])) air = [sites[a], sites[b]];
    out.airFound = !!air;
    if (air) {
      const A = R.addStop(air[0], 'airport').stop, B = R.addStop(air[1], 'airport').stop;
      out.airClaim = [-1, 0, 1].every((d) => g.occupancy.blocked[air[0] + d] === 3) && R.stopAt(air[0] + N + 1) === A;
      out.airBlocksAnother = R.stopError(air[0] + 3, 'airport');
      const v = R.buy('propliner', A).vehicle; v.stops.push(B.id);
      window.__airv = v.id;
      out.airLinks = [A.links.towns.length, B.links.towns.length];
    }
    // run 5 game minutes; watch aircraft altitude
    let maxAlt = 0;
    for (let i = 0; i < 30 * 300; i++) {
      g.tick(1 / 30);
      const pv = R.byId(window.__airv);
      if (pv && pv.fly) { const o = R.vehPos(pv, {}); maxAlt = Math.max(maxAlt, o.y - Math.max(0, g.world.view.heightAt(o.x, o.z))); }
    }
    const stat = (id) => { const v = R.byId(id); if (!v) return null; const f = g.ledger.objFin(v); return { trips: v.trips, earned: Math.round(v.earned), rev: Math.round(f.lifeRev), cost: Math.round(f.lifeCost), problem: v.problem || null }; };
    out.tram = stat(window.__tramv); out.ship = stat(window.__shipv); out.air = stat(window.__airv); out.maxAlt = Math.round(maxAlt * 10) / 10;
    // save / load
    const S = await import('./src/save/Save.js');
    const d = S.migrate(JSON.parse(JSON.stringify(g.serialize())));
    out.valid = S.validate(d) === null;
    window.__tsave = d;
    out.sig = JSON.stringify([R.stops.map((s) => [s.kind, s.tile]), R.vehicles.map((v) => [v.model, v.stops]), [...R.tram].reduce((a, b) => a + b, 0)]);
    out.air0 = air ? air[0] : -1;
    return out;
  });
  check(r.tramFound && r.tramBuilt && r.tramStops.every((x) => x === 'ok') && r.noTramStopOffTrack === 'err_stop_needs_tram', `tram track and stops in ${r.tramFound ? 'a town' : '-'} (${JSON.stringify(r.tramStops)}, off track: ${r.noTramStopOffTrack})`);
  check(r.tram && r.tram.trips >= 3 && r.tram.rev > 0 && r.tram.cost > 0, `the tram runs and earns: ${JSON.stringify(r.tram)}`);
  check(r.docksFound && r.dockClaim, `two docks on the same water (route ${r.shipPath} tiles), land claimed`);
  check(r.ship && r.ship.trips >= 2 && !r.ship.problem && r.ship.rev > 0, `the ferry sails between them: ${JSON.stringify(r.ship)}`);
  check(r.airFound && r.airClaim && r.airBlocksAnother === 'err_occupied' || r.airBlocksAnother === 'err_airport_near', `two airports near towns, 3×3 land claimed (${JSON.stringify({ found: r.airFound, claim: r.airClaim, next: r.airBlocksAnother, links: r.airLinks })})`);
  check(r.air && r.air.trips >= 2 && r.air.rev > 0 && r.maxAlt > 2, `the propliner flies and earns: ${JSON.stringify(r.air)}, cruise height ${r.maxAlt}`);
  check(r.valid, 'the save validates');
  await loadSave(page, await page.evaluate(() => window.__tsave));
  const back = await page.evaluate((a0) => {
    const g = window.__tracklands.game, R = g.roads;
    return { sig: JSON.stringify([R.stops.map((s) => [s.kind, s.tile]), R.vehicles.map((v) => [v.model, v.stops]), [...R.tram].reduce((a, b) => a + b, 0)]), claim: a0 < 0 || g.occupancy.blocked[a0] === 3 };
  }, r.air0);
  check(back.sig === r.sig && back.claim, 'tram track, docks, airports and their vehicles are saved (land claimed again)');
  // the stop tool: kinds and an airport by mouse
  await page.evaluate(() => { const g = window.__tracklands.game; g.progression.level = 30; g.economy.coins = 5e6; });
  await page.click('#tool-roadstop');
  await page.waitForTimeout(200);
  const chips = await page.$$eval('#subbar [data-act=stopKind]', (els) => els.map((e) => e.dataset.arg));
  await page.click('#subbar [data-act=stopKind][data-arg=airport]');
  const spot = await page.evaluate(() => {
    const g = window.__tracklands.game, R = g.roads;
    for (let i = 64 * 5; i < 64 * 58; i++) if (!R.stopError(i, 'airport')) { window.__focus = [((i % 64) + 0.5) * 2, (Math.floor(i / 64) + 0.5) * 2]; g.camera.focus(window.__focus[0], window.__focus[1], 20); return i; }
    return -1;
  });
  let placed = false;
  if (spot >= 0) {
    await page.waitForFunction(() => { const t = window.__tracklands.game.camera.target, f = window.__focus; return Math.abs(t.x - f[0]) + Math.abs(t.z - f[1]) < 0.15; }, null, { polling: 100, timeout: 30000 });
    const p = await page.evaluate((tt) => { const g = window.__tracklands.game, cam = g.camera.camera; const x = ((tt % 64) + 0.5) * 2, z = (Math.floor(tt / 64) + 0.5) * 2; const v = new cam.position.constructor(x, g.world.view.heightAt(x, z), z).project(cam); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; }, spot);
    await page.mouse.move(p[0], p[1]);
    await page.waitForTimeout(150);
    const ghost = await page.evaluate(() => window.__tracklands.game.construction.ghost.count);
    await page.mouse.click(p[0], p[1]);
    await page.waitForTimeout(300);
    placed = await page.evaluate((i) => { const s = window.__tracklands.game.roads.stopAt(i); return !!s && s.kind === 'airport'; }, spot);
    check(ghost === 9, `the airport preview covers 3×3 (${ghost})`);
  }
  check(chips.join(',') === 'bus,truck,tram,dock,airport,garage' && placed, `stop tool offers ${chips.join(', ')}; an airport placed with the mouse: ${placed}`);
  if (errors.length) { ok = false; lines.push('errors: ' + errors.slice(0, 2).join(' | ')); }
  await ctx.close();
  return { ok, lines };
}
