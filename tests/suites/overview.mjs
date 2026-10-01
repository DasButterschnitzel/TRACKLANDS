// Transport panel (src/economy/Transport.js, src/ui/TransportUI.js) on the
// production save with a bus line added: the per-mode figures match the
// books (vehicles, money, units carried), every line appears as a service
// with frequency, capacity and load, problems are detected (a line without
// vehicles, a stop without a line) and their quick action fixes them, the
// vehicle list filters (line, status, search) and its batch actions work
// with real clicks (assign to another line, send to the garage), the panel
// fits a phone with no sideways scrolling, and delay and units carried
// survive save/load.
import { openPage, loadSave, productionSave } from '../lib.mjs';

export const name = 'overview';

async function setup(page) {
  await loadSave(page, productionSave(), { paused: true });
  return page.evaluate(() => {
    const g = window.__tracklands.game, R = g.roads, T = g.towns, N = g.mapSize || 64;
    g.economy.coins = 1e6; g.settings.weather = false;
    g.progression.level = Math.max(g.progression.level, 12);
    const d = (a, b) => Math.max(Math.abs(a % N - b % N), Math.abs(Math.floor(a / N) - Math.floor(b / N)));
    const towns = T.list.filter((t) => g.progression.regionUnlocked(t.region)).sort((a, b) => b.pop - a.pop);
    for (const t of towns) {
      const roads = [...(t.roadSet || [])].filter((i) => !g.net.conn[i] && !R.stopAt(i));
      let best = null;
      for (const a of roads) for (const b of roads) if (a < b && d(a, b) >= 4 && d(a, b) <= 9 && R.path(a, b) && (!best || d(a, b) > best[2])) best = [a, b, d(a, b)];
      if (!best) continue;
      const A = R.addStop(best[0], 'bus'), B = R.addStop(best[1], 'bus');
      if (!A.stop || !B.stop) continue;
      const l = R.lines.create({ stops: [A.stop.id, B.stop.id] }).line;
      for (let k = 0; k < 3; k++) R.buy(R.lines.model(l).id, A.stop, null, l);
      // a garage on free land by the road
      let gar = null;
      for (let dz = -4; dz <= 4 && !gar; dz++) for (let dx = -4; dx <= 4 && !gar; dx++) {
        const i = best[0] + dx + dz * N;
        if (i >= 0 && i < N * N && !R.stopError(i, 'garage')) { const r = R.addStop(i, 'garage'); if (r.stop) gar = r.stop; }
      }
      g.stations.relinkAll(); T.onStationsChanged();
      return { town: t.name, line: l.id, A: A.stop.id, B: B.stop.id, garage: gar && gar.id };
    }
    return null;
  });
}

export async function run({ browser, base }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  // ---------- desktop ----------
  {
    const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 1280, height: 800 } });
    const w = await setup(page);
    check(!!(w && w.line), `a bus line with 3 buses in ${w && w.town}${w && w.garage ? ' and a garage' : ''}`);
    await page.evaluate(() => { const g = window.__tracklands.game; for (let i = 0; i < 30 * 60 * 3; i++) g.tick(1 / 30); g.transport.invalidate(); });
    // figures = the books
    const f = await page.evaluate(() => {
      const g = window.__tracklands.game, T = g.transport, L = g.ledger;
      const rail = T.summary('rail'), bus = T.summary('bus'), all = T.summary('all');
      const tr = g.trains.trains, bv = g.roads.vehicles.filter((v) => !v.owner);
      const sum = (xs, k) => Math.round(xs.reduce((a, o) => a + (L.objFin(o)[k] || 0), 0));
      const svc = T.services('bus').find((s) => s.line);
      return { rail: { n: rail.vehicles, rev: Math.round(rail.rev), pu: rail.pu, cu: rail.cu }, trains: tr.length, trainRev: sum(tr, 'lastRev'), trainPu: sum(tr, 'lastPu'), trainCu: sum(tr, 'lastCu'),
        bus: { n: bus.vehicles, rev: Math.round(bus.rev), pu: bus.pu, profit: Math.round(bus.profit) }, buses: bv.length, busRev: sum(bv, 'lastRev'), busCost: sum(bv, 'lastCost'),
        all: { n: all.vehicles, rev: Math.round(all.rev) }, svc: svc && { n: svc.n, headway: svc.headway, capacity: svc.capacity, load: svc.load, pu: svc.pu, stops: svc.stops.length },
        railSvc: T.services('rail').length, railLines: g.lines.list().length, auto: g.trains.trains.filter((t) => t.mode !== 'manual').length };
    });
    check(f.rail.n === f.trains && f.rail.rev === f.trainRev && f.rail.pu === f.trainPu && f.rail.cu === f.trainCu && f.rail.pu + f.rail.cu > 0, `rail: ${f.rail.n} trains, ${f.rail.rev} ● and ${f.rail.pu} passengers · ${f.rail.cu} cargo last month = their books`);
    check(f.bus.n === f.buses && f.bus.rev === f.busRev && f.bus.pu > 0 && f.bus.profit === f.busRev - f.busCost, `bus: ${f.bus.n} buses, ${f.bus.rev} ● revenue, ${f.bus.pu} passengers, profit ${f.bus.profit} = their books`);
    check(f.all.n === f.rail.n + f.bus.n && f.all.rev === f.rail.rev + f.bus.rev, `all modes add up (${f.all.n} vehicles, ${f.all.rev} ●)`);
    check(f.svc && f.svc.n === 3 && f.svc.headway > 0 && f.svc.capacity > 0 && f.svc.stops === 2 && f.svc.pu > 0, `the bus line is a service: ${JSON.stringify(f.svc)}`);
    check(f.railSvc > 0 && f.railSvc === f.railLines + g0(f), `rail services: ${f.railSvc} (${f.railLines} lines, ${f.auto} trains on automatic orders)`);
    // problems: a stop with no line, a line with no vehicles (with its fix)
    const p = await page.evaluate(({ A, B }) => {
      const g = window.__tracklands.game, R = g.roads, T = g.transport, N = g.mapSize || 64;
      const a = R.stopById(A);
      let lone = null;
      for (const i of [...g.towns.list.find((t) => a.links.towns.includes(t.id)).roadSet]) if (!R.stopAt(i) && !g.net.conn[i] && Math.max(Math.abs(i % N - a.tile % N), Math.abs(Math.floor(i / N) - Math.floor(a.tile / N))) >= 3) { const r = R.addStop(i, 'bus'); if (r.stop) { lone = r.stop; break; } }
      const empty = R.lines.create({ stops: [A, B], name: 'Empty 9' }).line;
      T.invalidate();
      const ps = T.problems();
      return { lone: lone && lone.id, empty: empty.id, unserved: ps.some((x) => x.key === 'pb_stop_unserved' && x.sel === `roadstop:${lone && lone.id}`), noVeh: ps.find((x) => x.key === 'pb_line_empty' && x.sel === `line:${empty.id}`), keys: [...new Set(ps.map((x) => x.key))] };
    }, w);
    check(p.unserved && p.noVeh && p.noVeh.sev === 'bad' && p.noVeh.act, `problems found: a stop without a line, a line without vehicles (urgent, with a fix) — ${p.keys.join(', ')}`);
    // UI: the menu button opens the panel, with a badge for the urgent problem
    await page.waitForFunction(() => { const b = document.querySelector('#badge-trains'); return b && !b.hidden; }, null, { polling: 200, timeout: 8000 }).catch(() => {});
    const badge = await page.evaluate(() => { const b = document.querySelector('#badge-trains'); return b && !b.hidden ? +b.textContent || b.textContent : 0; });
    check(!!badge, `the Transport button shows the urgent problems (${badge})`);
    await page.click('#menu-rail [data-arg=trains]');
    await page.waitForSelector('#panel .tmodes');
    await page.click('#panel .tmodes [data-arg=bus]');
    await page.click('#panel .ttabs [data-arg=problems]');
    const fixSel = `#panel .tprob [data-act=tFix][data-arg^="rlAdd|${p.empty}:"]`;
    const hasFix = await page.$(fixSel);
    if (hasFix) await page.click(fixSel);
    await page.waitForTimeout(200);
    const fixed = await page.evaluate((id) => { const L = window.__tracklands.game.roads.lines; return L.vehicles(L.byId(id)).length; }, p.empty);
    check(!!hasFix && fixed >= 1, `the problem's quick action buys vehicles for the empty line (${fixed})`);
    // services tab: cards with figures
    await page.click('#panel .ttabs [data-arg=lines]');
    const svcs = await page.evaluate(() => [...document.querySelectorAll('#panel .svc')].map((e) => e.querySelectorAll('.svc-grid > div').length));
    check(svcs.length >= 2 && svcs.every((n) => n >= 6), `services tab: ${svcs.length} line cards with ${svcs.join('/')} figures`);
    // vehicles tab: filter by line, search, pick with real clicks, batch assign
    await page.click('#panel .ttabs [data-arg=vehicles]');
    await page.selectOption('#panel select[data-id=line]', `rl:${w.line}`);
    const byLine = await page.evaluate(() => document.querySelectorAll('#panel .tvrow').length);
    check(byLine === 3, `line filter: ${byLine} buses of line ${w.line}`);
    // (locators re-resolve: the live panel may redraw between finding and tapping)
    const boxes = page.locator('#panel .tvrow input[type=checkbox]');
    await boxes.nth(0).click(); await page.waitForTimeout(100);
    await boxes.nth(1).click(); await page.waitForTimeout(100);
    const picked = await page.evaluate(() => window.__tracklands.ui.tv().picked.size);
    const bar = await page.$('#panel .tbatch');
    check(picked === 2 && !!bar, `two buses picked by tapping their boxes, batch bar shown (${picked})`);
    await page.selectOption('#panel select[data-change=tvAssign]', String(p.empty));
    const moved = await page.evaluate((id) => { const L = window.__tracklands.game.roads.lines; return L.vehicles(L.byId(id)).length; }, p.empty);
    check(moved === fixed + 2, `batch: assign the picked buses to another line (${fixed} → ${moved})`);
    if (w.garage) {
      await page.click('#panel .tbatch [data-act=tvBatch][data-arg=depot]');
      const gar = await page.evaluate((gid) => window.__tracklands.game.roads.vehicles.filter((v) => v.goGarage === gid || v.state === 'stored').length, w.garage);
      check(gar === 2, `batch: the picked buses head for the garage (${gar})`);
    }
    await page.click('#panel .tbatch [data-act=tvPickNone]');
    await page.selectOption('#panel select[data-id=line]', 'all');
    const name0 = await page.evaluate(() => window.__tracklands.game.roads.vehicles[0].name);
    await page.fill('#panel input[data-input=tvQuery]', name0);
    const found = await page.evaluate(() => [...document.querySelectorAll('#panel .tvrow .trow-main b')].map((b) => b.textContent.trim()));
    check(found.length >= 1 && found.every((t) => t.includes(name0)), `search "${name0}": ${found.length} row(s)`);
    // save/load keeps delay and units carried
    const before = await page.evaluate(() => { const g = window.__tracklands.game; const v = g.roads.vehicles[0]; v.dly = 3.5; g.transport.invalidate(); const s = g.transport.summary('bus'); return { id: v.id, dly: Math.round(v.dly * 10) / 10, pu: s.pu, rev: Math.round(s.rev), n: s.vehicles }; });
    await page.evaluate(() => { window.__osave = JSON.parse(JSON.stringify(window.__tracklands.game.serialize())); });
    await loadSave(page, await page.evaluate(() => window.__osave));
    const after = await page.evaluate((id) => {
      const G = window.__tracklands.game; G.transport.invalidate();
      const s = G.transport.summary('bus'), v = G.roads.byId(id);
      return { dly: v && Math.round(v.dly * 10) / 10, pu: s.pu, rev: Math.round(s.rev), n: s.vehicles };
    }, before.id);
    check(after.dly === before.dly && after.pu === before.pu && after.rev === before.rev && after.n === before.n, `save/load keeps delay (${before.dly}), units (${before.pu}) and money (${before.rev}): ${JSON.stringify(after)}`);
    check(!errors.length, `no errors (${errors.slice(0, 2).join(' | ')})`);
    await ctx.close();
  }
  // ---------- phone ----------
  {
    const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await setup(page);
    await page.evaluate(() => { const g = window.__tracklands.game; for (let i = 0; i < 30 * 60; i++) g.tick(1 / 30); window.__tracklands.ui.openPanel('trains'); });
    const over = [];
    for (const mode of ['all', 'bus', 'rail']) for (const tab of ['overview', 'lines', 'vehicles', 'problems', 'fleet']) {
      await page.evaluate(([m, t]) => { const u = window.__tracklands.ui; u.transportMode = m; u.trainsTab = t; u.refreshPanel(); }, [mode, tab]);
      const o = await page.evaluate(() => { const b = document.querySelector('#panel .pbody'); const wide = [...b.querySelectorAll('*')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.right > innerWidth + 1; }).map((e) => e.className || e.tagName).slice(0, 3); return { doc: document.documentElement.scrollWidth > innerWidth + 1, body: b.scrollWidth > b.clientWidth + 1, wide }; });
      if (o.doc || o.body || o.wide.length) over.push(`${mode}/${tab}: ${o.wide.join(',')}`);
    }
    check(!over.length, `phone: every mode and tab fits the screen width${over.length ? ' — ' + over.slice(0, 4).join('; ') : ''}`);
    // a tap on a mode chip and a tab works on touch
    await page.tap('#panel .tmodes [data-arg=bus]');
    await page.tap('#panel .ttabs [data-arg=vehicles]');
    const st = await page.evaluate(() => ({ mode: window.__tracklands.ui.tMode(), tab: window.__tracklands.ui.tTab(), rows: document.querySelectorAll('#panel .tvrow').length }));
    check(st.mode === 'bus' && st.tab === 'vehicles' && st.rows === 3, `phone taps: bus mode, vehicles tab, ${st.rows} rows`);
    check(!errors.length, `phone: no errors (${errors.slice(0, 2).join(' | ')})`);
    await ctx.close();
  }
  return { ok, lines };
}
function g0(f) { return f.auto; }
