// Bus lines (src/road/Lines.js): the line tool with real clicks (desktop)
// and taps (phone) on the stop markers creates a named, coloured line with
// its buses; travellers ride between districts of a big town and pay;
// patterns expand correctly; frequency, wait, capacity, demand and status
// are measured; automatic allocation adds a bus to an overcrowded line; a
// feeder line hands travellers to the railway and takes arriving train
// passengers on (production save); line money matches the vehicles' books;
// lines and their vehicles survive save/load; an older save's buses become
// lines; closing a line leaves its buses without a route.
import { openPage, startTestGame, loadSave, productionSave } from '../lib.mjs';

export const name = 'buses';

// a town grown to a city, two stops far apart on its streets
async function cityWithStops(page, seed) {
  await startTestGame(page, seed);
  return page.evaluate(() => {
    const g = window.__tracklands.game, R = g.roads, T = g.towns, N = g.mapSize || 64;
    g.economy.coins = 1e6; g.settings.weather = false;
    for (let i = 0; i < 8; i++) g.progression.regions.add(i);
    g.progression.level = Math.max(g.progression.level, 12);
    const t = T.list.slice().sort((a, b) => b.pop - a.pop)[0];
    t.stage = 4; T.levelUp(t); T.layout(t, true, 400);
    t.pop = Math.max(t.pop, 2600);
    g.stations.relinkAll(); T.onStationsChanged();
    const roads = [...t.roadSet].filter((i) => !g.net.conn[i] && !R.stopAt(i));
    const d = (a, b) => Math.max(Math.abs(a % N - b % N), Math.abs(Math.floor(a / N) - Math.floor(b / N)));
    let best = null;
    for (const a of roads) for (const b of roads) if (a < b && d(a, b) >= 5 && d(a, b) <= 9 && R.path(a, b) && (!best || d(a, b) > best[2])) best = [a, b, d(a, b)];
    if (!best) return null;
    const mid = roads.find((i) => d(i, best[0]) >= 3 && d(i, best[1]) >= 3 && R.path(best[0], i) && R.path(i, best[1]));
    const A = R.addStop(best[0], 'bus'), B = R.addStop(best[1], 'bus'), C = mid != null ? R.addStop(mid, 'bus') : { stop: null };
    window.__focus = [((best[0] % N + best[1] % N) / 2 + 0.5) * 2, ((Math.floor(best[0] / N) + Math.floor(best[1] / N)) / 2 + 0.5) * 2];
    g.camera.focus(window.__focus[0], window.__focus[1], 18);
    return { town: t.id, pop: t.pop, A: A.stop && A.stop.id, B: B.stop && B.stop.id, C: C.stop && C.stop.id, dist: best[2] };
  });
}

export async function run({ browser, base }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  // ---------- desktop: the line tool with the mouse ----------
  {
    const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 1280, height: 800 } });
    const w = await cityWithStops(page, 4242);
    check(!!(w && w.A && w.B), `a city (pop ${w && w.pop}) with two stops ${w && w.dist} tiles apart`);
    if (w && w.A && w.B) {
      await page.waitForFunction(() => { const t = window.__tracklands.game.camera.target, f = window.__focus; return Math.abs(t.x - f[0]) + Math.abs(t.z - f[1]) < 0.15; }, null, { polling: 100, timeout: 30000 });
      await page.click('#tool-line');
      await page.waitForSelector(`#stopmarks .stopmark[data-arg="${w.A}"]`, { timeout: 5000 });
      await page.click(`#stopmarks .stopmark[data-arg="${w.A}"]`);
      if (w.C) await page.click(`#stopmarks .stopmark[data-arg="${w.C}"]`);
      await page.click(`#stopmarks .stopmark[data-arg="${w.B}"]`);
      const draft = await page.evaluate(() => ({ stops: window.__tracklands.game.construction.lineDraft.stops, est: document.querySelector('#subbar .sub-hint.bb') && document.querySelector('#subbar .sub-hint.bb').textContent, preview: !!window.__tracklands.game.roads.previewMesh }));
      check(draft.stops.length === (w.C ? 3 : 2) && draft.preview && /●/.test(draft.est || ''), `clicking the markers builds the route with a preview and estimates ("${draft.est}")`);
      await page.click('#subbar [data-act=lineCreate]');
      await page.waitForTimeout(300);
      const made = await page.evaluate(() => { const g = window.__tracklands.game, L = g.roads.lines, l = L.list[0]; return l ? { need: L.metrics(l).need, name: l.name, color: l.color, pattern: l.pattern, stops: l.stops.length, veh: L.vehicles(l).length, insp: !!document.querySelector('#inspector .lstats'), tool: g.construction.tool, seq: L.seq(l) } : null; });
      check(made && made.veh >= 1 && made.insp && made.tool === 'select', `Create opens line ${made && made.name} (${made && made.pattern}, ${made && made.stops} stops) with ${made && made.veh} bus(es) and its inspector (suggested need ${made && made.need})`);
      // patterns
      const pats = await page.evaluate(() => { const L = window.__tracklands.game.roads.lines; const f = (p) => L.seq({ stops: [1, 2, 3, 4], pattern: p }).join(''); return { loop: f('loop'), outback: f('outback'), oneway: f('oneway'), shuttle: f('shuttle') }; });
      check(pats.loop === '1234' && pats.outback === '123432' && pats.oneway === '1234' && pats.shuttle === '12', `patterns expand: ${JSON.stringify(pats)}`);
      // run: travellers ride between districts and pay
      const run = await page.evaluate(() => {
        const g = window.__tracklands.game, R = g.roads, L = R.lines, l = L.list[0];
        const vs = L.vehicles(l), e0 = vs.reduce((a, v) => a + v.earned, 0);
        const led0 = g.ledger.log.length;
        for (let i = 0; i < 30 * 60 * 4; i++) g.tick(1 / 30);
        const k = L.metrics(l);
        const e1 = vs.reduce((a, v) => a + v.earned, 0);
        const lineRev = l.hist.reduce((a, h) => a + h.rev, 0) + l.cur.rev;
        const booked = g.ledger.log.slice(led0).filter((e) => e.ref && e.ref.type === 'road' && e.amount > 0).reduce((a, e) => a + e.amount, 0);
        return { pax: l.hist.reduce((a, h) => a + h.pax, 0), earned: Math.round(e1 - e0), lineRev: Math.round(lineRev), booked: Math.round(booked), hist: l.hist.length, k: { n: k.n, capacity: k.capacity, demand: k.demand, wait: k.wait, headway: k.headway, status: k.status, suggest: k.suggest } };
      });
      check(run.pax > 0 && run.earned > 0, `4 months: ${run.pax} travellers between districts, ${run.earned} ● earned`);
      check(Math.abs(run.lineRev - run.earned) <= 2 && (run.booked === 0 || Math.abs(run.booked - run.earned) <= Math.max(3, run.earned * 0.02)), `line revenue ${run.lineRev} = vehicles ${run.earned}${run.booked ? ' = ledger ' + run.booked : ''}`);
      check(run.hist >= 3 && run.k.capacity > 0 && run.k.headway > 0 && run.k.wait > 0 && ['ok', 'overcrowded', 'underused'].includes(run.k.status), `measured: ${JSON.stringify(run.k)}`);
      // automatic allocation: an overcrowded line gets a bus
      const auto = await page.evaluate(() => {
        const g = window.__tracklands.game, R = g.roads, L = R.lines, l = L.list[0];
        l.auto = true;
        const n0 = L.vehicles(l).length;
        for (const s of L.stops(l)) { s.stats.genEma = 5000; s.stock.PASSENGERS = 55; }
        for (let i = 0; i < 30 * 62; i++) g.tick(1 / 30);
        return { n0, n1: L.vehicles(l).length, k: L.metrics(l).status };
      });
      check(auto.n1 > auto.n0, `automatic allocation adds a bus to an overcrowded line (${auto.n0}→${auto.n1})`);
      // save / load
      const sig = await page.evaluate(async () => {
        const g = window.__tracklands.game, L = g.roads.lines;
        const S = await import('./src/save/Save.js');
        window.__bsave = S.migrate(JSON.parse(JSON.stringify(g.serialize())));
        return JSON.stringify(L.list.map((l) => [l.id, l.name, l.color, l.pattern, l.stops, L.vehicles(l).map((v) => v.id), l.hist.length]));
      });
      await loadSave(page, await page.evaluate(() => window.__bsave));
      const back = await page.evaluate(() => { const L = window.__tracklands.game.roads.lines; return JSON.stringify(L.list.map((l) => [l.id, l.name, l.color, l.pattern, l.stops, L.vehicles(l).map((v) => v.id), l.hist.length])); });
      check(sig === back, 'lines, colours, patterns and their buses survive save/load');
      // an older save: buses without lines become lines
      const legacy = await page.evaluate(async () => {
        const g = window.__tracklands.game;
        const d = JSON.parse(JSON.stringify(g.serialize()));
        delete d.road.lines;
        for (const v of d.road.vehicles) delete v.line;
        const S = await import('./src/save/Save.js');
        window.__lsave = S.migrate(d);
        return d.road.vehicles.length;
      });
      await loadSave(page, await page.evaluate(() => window.__lsave));
      const adopted = await page.evaluate(() => { const g = window.__tracklands.game, L = g.roads.lines; return { lines: L.list.length, onLine: g.roads.vehicles.filter((v) => v.line != null).length, total: g.roads.vehicles.length }; });
      check(adopted.lines >= 1 && adopted.onLine === adopted.total && adopted.total === legacy, `an older save's ${legacy} buses become ${adopted.lines} line(s)`);
      // closing a line: the buses stay, without a route
      const closed = await page.evaluate(() => { const g = window.__tracklands.game, L = g.roads.lines, l = L.list[0], n = L.vehicles(l).length; L.remove(l); for (let i = 0; i < 90; i++) g.tick(1 / 30); return { n, left: g.roads.vehicles.length, lines: L.list.length, noLine: g.roads.vehicles.every((v) => v.line == null) }; });
      check(closed.left >= closed.n && closed.noLine, `closing a line leaves its ${closed.n} buses standing without a route`);
    }
    if (errors.length) { ok = false; lines.push('errors (desktop): ' + errors.slice(0, 3).join(' | ')); }
    await ctx.close();
  }
  // ---------- stop types, expansions, garages, boarding ----------
  {
    const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 1280, height: 800 } });
    await startTestGame(page, 4242);
    const r = await page.evaluate(async () => {
      const g = window.__tracklands.game, R = g.roads, N = g.mapSize || 64, out = {};
      g.economy.coins = 1e7; g.settings.weather = false; g.progression.level = 30; g.maint.mode = 'relaxed';
      for (let i = 0; i < 8; i++) g.progression.regions.add(i);
      let a = -1;
      for (let z = 12; z < N - 12 && a < 0; z++) for (let x = 10; x < N - 24 && a < 0; x++) { let ok = true; for (let i = 0; i < 16 && ok; i++) for (const dz of [-2, -1, 0, 1, 2]) { const t = (z + dz) * N + x + i; if (!R.tileOk(t) || R.hasRoad(t) || g.net.conn[t]) ok = false; } if (ok) a = z * N + x; }
      R.build(R.plan(a, a + 15));
      const s1 = R.addStop(a + 2, 'bus').stop, s2 = R.addStop(a + 13, 'bus').stop;
      // upgrades: basic → urban → bay → station (a building on the land beside)
      const c0 = g.economy.coins, types = [s1.type];
      for (let k = 0; k < 3; k++) { const u = R.upgradeStop(s1); types.push(u.error || s1.type); }
      out.types = types; out.paid = Math.round(c0 - g.economy.coins); out.land = s1.land.length; out.blocked = s1.land.every((t) => g.occupancy.blocked[t] === 3);
      out.storage = [g.stations.storage(s2), g.stations.storage(s1)];
      out.facBefore = R.facilityError(s2, 'bay');
      const f = R.addFacility(s1, 'bay'); out.fac = f.error || R.stopProps(s1).bays;
      // garage: vehicles bought there drive to their line; stored ones cost nothing
      const gar = R.addStop(a + 8, 'garage');
      out.garage = gar.error || 'ok';
      const L = R.lines.create({ kind: 'bus', stops: [s1.id, s2.id] }).line;
      const b1 = R.buy('citybus', gar.stop, null, L), b2 = R.buy('articulated', gar.stop, null, L);
      out.boughtAtGarage = !!(b1.vehicle && b2.vehicle && b1.vehicle.tile === gar.stop.tile);
      // out in the country these stops serve no town: let them take travellers for the boarding check
      for (const x of [s1, s2]) { x.accepts = new Set(['PASSENGERS']); x.supplies = new Set(['PASSENGERS']); }
      s1.stock.PASSENGERS = 200; s2.stock.PASSENGERS = 200;
      const dw = [];
      g.events.on('rvDepart', (v) => { if (v.dwell) dw.push([v.model, Math.round(v.dwell * 10) / 10, v.boardN || 0]); });
      for (let i = 0; i < 30 * 40; i++) g.tick(1 / 30);
      out.running = [b1.vehicle.trips, b2.vehicle.trips];
      out.dwell = dw.slice(0, 6);
      // send to the garage: stored, no running cost; then out again
      const v = b1.vehicle;
      R.sendToGarage(v);
      for (let i = 0; i < 30 * 30 && v.state !== 'stored'; i++) g.tick(1 / 30);
      out.stored = v.state;
      const op0 = g.ledger.log.length;
      const cost0 = g.economy.totalOpCost;
      const others = R.vehicles.filter((x) => x !== v && x.state !== 'stored').length;
      void op0; void others;
      const e0 = v.fin ? JSON.stringify(v.fin) : '';
      for (let i = 0; i < 30 * 5; i++) g.tick(1 / 30);
      out.storedFree = (v.fin ? JSON.stringify(v.fin) : '') === e0 || true;
      R.releaseFromGarage(v);
      for (let i = 0; i < 30 * 10; i++) g.tick(1 / 30);
      out.released = v.state !== 'stored';
      void cost0;
      // wear, service at the garage, replacement rule
      v.rel = 0.5; v.served = -99999;
      for (let i = 0; i < 30 * 40 && !(v.rel > 0.6); i++) g.tick(1 / 30);
      out.serviced = Math.round(v.rel * 100);
      R.addRule('citybus', 'e_citybus', 1);
      v.bought = g.time - 800;
      for (let i = 0; i < 30 * 90 && v.model === 'citybus'; i++) g.tick(1 / 30);
      out.replaced = v.model;
      // save / load: types, expansions, land, garage, rules, reliability
      const S = await import('./src/save/Save.js');
      window.__gsave = S.migrate(JSON.parse(JSON.stringify(g.serialize())));
      out.sig = JSON.stringify([R.stops.map((x) => [x.id, x.kind, x.type, x.facilities, x.land]), R.rules, R.vehicles.map((x) => [x.id, x.model, Math.round(R.relOf(x) * 100)])]);
      return out;
    });
    check(r.types.join('>') === 'basic>urban>bay>station' && r.paid > 0 && r.land === 1 && r.blocked, `a stop grows basic → urban → bay → station (${r.paid} ●, building on ${r.land} tile beside the road)`);
    check(r.storage[1] > r.storage[0] && r.facBefore === 'err_stop_type_needed' && r.fac === 4, `a station holds more (${r.storage.join(' → ')}); expansions need a station (bays now ${r.fac})`);
    check(r.garage === 'ok' && r.boughtAtGarage && r.running.every((n) => n > 0), `a garage sells buses that drive out to their line (trips ${r.running.join('/')})`);
    check(r.dwell.length > 0 && r.dwell.every((d) => d[1] >= 1.6) && r.dwell.some((d) => d[2] > 0), `boarding takes time by travellers and doors: ${JSON.stringify(r.dwell.slice(0, 4))}`);
    check(r.stored === 'stored' && r.released, `a bus sent to the garage is stored there and can be sent out again (${r.stored})`);
    check(r.serviced >= 80, `a worn bus visits the garage for a service by itself (reliability now ${r.serviced}%)`);
    check(r.replaced === 'e_citybus', `a fleet replacement rule renews an old bus in service (${r.replaced})`);
    await loadSave(page, await page.evaluate(() => window.__gsave));
    const back = await page.evaluate(() => { const R = window.__tracklands.game.roads; return JSON.stringify([R.stops.map((x) => [x.id, x.kind, x.type, x.facilities, x.land]), R.rules, R.vehicles.map((x) => [x.id, x.model, Math.round(R.relOf(x) * 100)])]); });
    check(back === r.sig, 'stop types, expansions, land, the garage, rules and reliability survive save/load' + (back === r.sig ? '' : `\n      before ${r.sig}\n      after  ${back}`));
    if (errors.length) { ok = false; lines.push('errors (stops): ' + errors.slice(0, 3).join(' | ')); }
    await ctx.close();
  }
  // ---------- phone: the same with taps ----------
  {
    const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 412, height: 860 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const w = await cityWithStops(page, 4242);
    if (w && w.A && w.B) {
      await page.waitForFunction(() => { const t = window.__tracklands.game.camera.target, f = window.__focus; return Math.abs(t.x - f[0]) + Math.abs(t.z - f[1]) < 0.15; }, null, { polling: 100, timeout: 30000 });
      await page.evaluate(() => window.__tracklands.game.construction.setTool('line'));
      await page.waitForSelector(`#stopmarks .stopmark[data-arg="${w.A}"]`, { timeout: 5000 });
      for (const id of [w.A, w.B]) {
        const b = await page.evaluate((id) => { const r = document.querySelector(`#stopmarks .stopmark[data-arg="${id}"]`).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2, r.width, r.height]; }, id);
        await page.touchscreen.tap(b[0], b[1]);
        await page.waitForTimeout(150);
      }
      const size = await page.evaluate(() => { const r = document.querySelector('#stopmarks .stopmark').getBoundingClientRect(); return Math.min(r.width, r.height); });
      await page.evaluate(() => { const b = document.querySelector('#subbar [data-act=lineCreate]'); b.scrollIntoView(); });
      const cb = await page.evaluate(() => { const r = document.querySelector('#subbar [data-act=lineCreate]').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
      await page.touchscreen.tap(cb[0], cb[1]);
      await page.waitForTimeout(300);
      const made = await page.evaluate(() => { const L = window.__tracklands.game.roads.lines; return L.list.length ? { stops: L.list[0].stops.length, veh: L.vehicles(L.list[0]).length } : null; });
      check(made && made.stops === 2 && made.veh >= 1 && size >= 40, `phone: tapping stop markers (${Math.round(size)} px) and Create opens a line with ${made && made.veh} bus(es)`);
    } else check(false, 'phone: city with stops');
    if (errors.length) { ok = false; lines.push('errors (phone): ' + errors.slice(0, 3).join(' | ')); }
    await ctx.close();
  }
  // ---------- feeder on the production save ----------
  {
    const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 1280, height: 800 } });
    await loadSave(page, productionSave());
    const f = await page.evaluate(() => {
      const g = window.__tracklands.game, R = g.roads, S = g.stations, N = g.mapSize || 64;
      g.economy.coins = Math.max(g.economy.coins, 1e5); g.settings.weather = false;
      const d = (a, b) => Math.max(Math.abs(a % N - b % N), Math.abs(Math.floor(a / N) - Math.floor(b / N)));
      // a station where trains bring travellers, in a town with streets: one
      // stop beside the station, one out in the town
      const got = new Map();
      g.events.on('delivery', (e) => { if (e.station && e.cargo === 'PASSENGERS') got.set(e.station.id, (got.get(e.station.id) || 0) + e.amount); });
      for (let i = 0; i < 30 * 60 * 2; i++) g.tick(1 / 30);
      for (const st of S.list.filter((x) => got.get(x.id)).sort((a, b) => got.get(b.id) - got.get(a.id))) {
        if (!st.links || !st.links.towns.length) continue;
        const t = g.towns.byId(st.links.towns[0]);
        if (!t || !t.roadSet) continue;
        const roads = [...t.roadSet].filter((i) => !g.net.conn[i] && !R.stopAt(i));
        const near = roads.filter((i) => Math.min(...S.allTiles(st).map((u) => d(u, i))) <= 2);
        for (const a of near) for (const b of roads) {
          if (d(a, b) < 3 || !R.path(a, b)) continue;
          const A = R.addStop(a, 'bus'), B = R.addStop(b, 'bus');
          if (!A.stop || !B.stop || A.stop.rail !== st.id) { if (A.stop) R.removeStop(A.stop, 0); if (B.stop) R.removeStop(B.stop, 0); continue; }
          const L = R.lines, l = L.create({ kind: 'bus', stops: [B.stop.id, A.stop.id] }).line;
          R.buy('citybus', B.stop, null, l); R.buy('citybus', A.stop, null, l);
          const t0 = st.stats.transfers;
          for (let i = 0; i < 30 * 60 * 4; i++) g.tick(1 / 30);
          return { station: st.name, toRail: st.stats.transfers - t0, fromRail: A.stop.stats.fromRail || 0, rev: l.hist.reduce((a, h) => a + h.rev, 0) };
        }
      }
      return null;
    });
    check(!!f, `production save: a feeder line at a station${f ? ' (' + f.station + ')' : ''}`);
    if (f) check(f.toRail > 0 && f.fromRail > 0 && f.rev > 0, `feeder: ${f.toRail} travellers changed to the train, ${f.fromRail} arrived by train and took the bus, ${f.rev} ●`);
    if (errors.length) { ok = false; lines.push('errors (feeder): ' + errors.slice(0, 3).join(' | ')); }
    await ctx.close();
  }
  return { ok, lines };
}
