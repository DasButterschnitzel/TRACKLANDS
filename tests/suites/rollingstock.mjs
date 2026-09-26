// Rolling stock (config LOCOS / WAGONS, TrainModels.js, Consist.js,
// CatalogUI.js): the roster offers at least 8 steam, 8 diesel, 8 electric and
// 6 high-speed types, 4 specialised freight engines and several multiple
// units, covering every role; each model in a traction family has its own
// silhouette and every wagon builds for every load; multiple units carry
// passengers in the power car, run as a set, board faster, keep their
// acceleration and really run a line (turning without a turntable); the
// consist rules (unit cars, freight, double stacks under wires) hold; the
// passenger composition and new traits pay what they say; later high-speed
// trains are not better at everything; the vehicle catalogue filters,
// searches, stars favourites (kept in the save) and compares 2-4 models with
// real clicks; the builder puts favourites first and searches; older saves
// load with no favourites.
import { openPage, startTestGame, loadSave, productionSave } from '../lib.mjs';

export const name = 'rollingstock';

export async function run({ browser, base }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 1280, height: 800 } });
  await startTestGame(page, 4242);
  // ---------- roster ----------
  const ro = await page.evaluate(async () => {
    const { LOCOS, WAGONS, DUTIES } = await import('./src/config.js');
    const fam = (m) => (m.kind.startsWith('steam') ? 'steam' : m.kind);
    const n = {};
    for (const m of LOCOS) n[fam(m)] = (n[fam(m)] || 0) + 1;
    const duties = new Set(LOCOS.map((m) => m.duty));
    const ids = new Set(LOCOS.map((m) => m.id));
    return { n, special: LOCOS.filter((m) => m.special).length, mu: LOCOS.filter((m) => m.mu).map((m) => m.kind), duties: [...duties], missingDuty: DUTIES.filter((d) => !duties.has(d)), noDuty: LOCOS.filter((m) => !m.duty || !DUTIES.includes(m.duty)).map((m) => m.id), unique: ids.size === LOCOS.length, wagons: Object.keys(WAGONS).length, noShape: LOCOS.filter((m) => !m.shape).map((m) => m.id) };
  });
  check(ro.n.steam >= 8 && ro.n.diesel >= 8 && ro.n.electric >= 8 && ro.n.hst >= 6 && ro.special >= 4 && ro.unique, `roster: ${ro.n.steam} steam, ${ro.n.diesel} diesel, ${ro.n.electric} electric, ${ro.n.hst} high-speed, ${ro.n.maglev} maglev, ${ro.special} specialised freight`);
  check(ro.mu.length >= 5 && ['diesel', 'electric', 'hst'].every((k) => ro.mu.includes(k)), `multiple units: ${ro.mu.length} (${[...new Set(ro.mu)].join(', ')})`);
  check(!ro.missingDuty.length && !ro.noDuty.length && !ro.noShape.length, `every role has a locomotive (${ro.duties.length} roles) and every model a role and a silhouette${ro.missingDuty.length ? ' — no loco for ' + ro.missingDuty : ''}${ro.noDuty.length ? ' — no role: ' + ro.noDuty : ''}`);
  check(ro.wagons >= 34, `${ro.wagons} wagon types`);
  // ---------- models ----------
  const mo = await page.evaluate(async () => {
    const { LOCOS, WAGONS, locoLen } = await import('./src/config.js');
    const TM = await import('./src/trains/TrainModels.js');
    const fam = (m) => (m.kind.startsWith('steam') ? 'steam' : m.kind);
    const sig = {}, bad = [], dup = [];
    for (const m of LOCOS) {
      let geo;
      try { geo = TM.locoGeometry(m.id, 'classic_green', 0); } catch (e) { bad.push(m.id + ': ' + e.message); continue; }
      const b = geo.boundingBox, L = locoLen(m);
      const len = b.max.x - b.min.x, wid = b.max.z - b.min.z, h = b.max.y - b.min.y;
      if (!(len > L * 0.85 && len < L + 0.3) || wid > 0.9 || h > 1.3 || geo.attributes.position.count < 200) bad.push(`${m.id} ${len.toFixed(2)}/${L} w${wid.toFixed(2)} h${h.toFixed(2)} v${geo.attributes.position.count}`);
      // silhouette: side profile sampled on a grid (x along, y up)
      const pos = geo.attributes.position, cells = new Set();
      for (let i = 0; i < pos.count; i++) cells.add(Math.round((pos.getX(i) - b.min.x) / 0.08) + ':' + Math.round(pos.getY(i) / 0.06));
      const key = fam(m) + '|' + [...cells].sort().join(',');
      if (sig[key]) dup.push(sig[key] + '=' + m.id); else sig[key] = m.id;
    }
    const wbad = [];
    let wn = 0;
    for (const id of Object.keys(WAGONS)) {
      const w = WAGONS[id];
      for (const c of [null, ...w.carries]) for (const fill of c ? [1, 3] : [0]) for (const era of ['steam', 'diesel', 'electric', 'hst']) {
        try {
          const geo = TM.wagonGeometry(id, c, fill, era, { body: 0x2f6b4a, trim: 0xd8c070, accent: null, roof: null, stripe: 'none' }, null, 1);
          const b = geo.boundingBox, len = b.max.x - b.min.x;
          if (!(len > w.len * 0.8 && len < w.len + 0.25) || !(geo.attributes.position.count > 30)) wbad.push(`${id}/${c}/${fill}/${era} len ${len.toFixed(2)}/${w.len}`);
          wn++;
        } catch (e) { wbad.push(`${id}/${c}: ${e.message}`); }
      }
    }
    return { bad, dup, wbad: wbad.slice(0, 6), wn };
  });
  check(!mo.bad.length, `every locomotive builds at its length and within the loading gauge${mo.bad.length ? ': ' + mo.bad.slice(0, 5).join('; ') : ''}`);
  check(!mo.dup.length, `each model in a traction family has its own silhouette${mo.dup.length ? ' — same as: ' + mo.dup.join(', ') : ''}`);
  check(!mo.wbad.length && mo.wn > 300, `${mo.wn} wagon models (every wagon × load × era) build at their length${mo.wbad.length ? ': ' + mo.wbad.join('; ') : ''}`);
  // ---------- multiple units: consist rules and stats ----------
  const mu = await page.evaluate(async () => {
    const C = await import('./src/trains/Consist.js');
    const g = window.__tracklands.game;
    const R = new Set(['heavy_haul', 'passenger_comfort', 'specialized_wagons', 'containerization', 'high_speed_coaches', 'push_pull']);
    const fx = g.progression.fx;
    const set = C.autoBuild('sprinter', ['PASSENGERS'], { research: R, fx });
    const st = C.computeStats(set, null, fx);
    const trailers = set.filter((v) => v.k === 'W');
    const trailerCap = trailers.reduce((a, v) => a + C.WAGONS[v.id].cap, 0);
    const loco = C.computeStats(C.parseConsist(['L:trailmaster', 'W:coach', 'W:coach', 'W:coach']), null, fx);
    const V = (arr) => C.validateConsist(C.parseConsist(arr), R);
    const lots = [{ c: 'PASSENGERS', n: st.caps.PASSENGERS, from: 0 }];
    const loads = C.assignLoads(st, lots);
    return {
      layout: set.map((v) => `${v.k}:${v.id}${v.r ? ':r' : ''}`).join(' '), pax: st.caps.PASSENGERS, trailerCap, lead: set[0].id, rear: set[set.length - 1],
      loadMu: st.load, loadLoco: loco.load, full: loads.overflow.PASSENGERS || 0, seatsUsed: loads.wagons.filter((w) => w.id[0] === '@' && w.n > 0).length,
      tfMu: C.tractionFactor(1.5, true), tfLoco: C.tractionFactor(1.5, false),
      errFreight: V(['L:sprinter', 'W:boxcar']), errCar: V(['L:trailmaster', 'W:mu_car']), errMixed: V(['L:sprinter', 'W:mu_car', 'L:trailmaster:r']),
      errTall: V(['L:voltstream_e1', 'W:double_stack']), okTall: V(['L:cargoking', 'W:double_stack', 'W:double_stack']), okMu: V(set.map((v) => `${v.k}:${v.id}${v.r ? ':r' : ''}`)),
      autoElectric: C.autoBuild('voltstream_e3', ['GOODS'], { research: R, fx }).some((v) => v.id === 'double_stack'),
      hsmu: C.autoBuild('swift', ['PASSENGERS'], { research: R, fx }).map((v) => v.id).join(','),
      parcel: C.autoBuild('mailstar', ['MAIL'], { research: R, fx }).map((v) => v.id).join(','),
    };
  });
  check(mu.pax > mu.trailerCap && mu.lead === 'sprinter' && mu.rear.k === 'L' && mu.rear.r && mu.okMu === null, `a DMU set: ${mu.layout} — ${mu.pax} seats, ${mu.pax - mu.trailerCap} of them in the power cars`);
  check(mu.full === 0 && mu.seatsUsed >= 1, `passengers ride in the power cars too (${mu.seatsUsed} power cars loaded, overflow ${mu.full})`);
  check(mu.loadMu > mu.loadLoco * 1.15 && mu.tfMu > mu.tfLoco, `a unit boards faster (×${mu.loadMu.toFixed(2)} vs ×${mu.loadLoco.toFixed(2)}) and keeps its acceleration when heavy (${mu.tfMu.toFixed(2)} vs ${mu.tfLoco.toFixed(2)})`);
  check(mu.errFreight === 'err_mu_freight' && mu.errCar === 'err_mu_car' && mu.errMixed === 'err_mu_mixed', `unit rules: no freight wagons (${mu.errFreight}), unit cars need a unit (${mu.errCar}), no mixing with locomotives (${mu.errMixed})`);
  check(mu.errTall === 'err_tall_wires' && mu.okTall === null && !mu.autoElectric, `double stacks: refused under an electric locomotive (${mu.errTall}), fine behind a diesel, never auto-built for an electric`);
  check(/^swift,(hs_coach,)+swift$/.test(mu.hsmu) && /^mailstar,(parcel_van,)+mailstar$/.test(mu.parcel), `high-speed unit ${mu.hsmu}; parcel unit ${mu.parcel}`);
  // ---------- a unit runs a line ----------
  const line = await page.evaluate(async () => {
    const g = window.__tracklands.game, N = g.mapSize || 64;
    const { RailTests } = await import('./src/debug/RailTests.js');
    const RT = new RailTests(g);
    g.economy.coins = 1e7; g.progression.level = 30;
    for (let i = 0; i < 8; i++) g.progression.regions.add(i);
    for (const r of ['heavy_haul', 'passenger_comfort', 'push_pull']) g.progression.research.add(r);
    g.progression.recompute && g.progression.recompute();
    const a = RT.findArea(18, 5);
    if (!a) return { none: true };
    const z = a.z0 + 2, x0 = a.x0 + 1;
    RT.line(x0, z, x0 + 15, z); RT.finish();
    const sA = RT.station(x0 + 2, z), sB = RT.station(x0 + 13, z);
    const D = RT.depot(x0 + 15, z);
    g.net.connect(z * N + x0 + 14, 0); RT.finish();
    const C = await import('./src/trains/Consist.js');
    const set = C.serializeConsist(C.autoBuild('sprinter', ['PASSENGERS'], { research: g.progression.research, fx: g.progression.fx, count: 3 }));
    const t = RT.train(set, D, [sA, sB], { act: 'auto' });
    for (const s of [sA, sB]) { s.accepts = new Set(['PASSENGERS']); s.supplies = new Set(['PASSENGERS']); }
    let maxLoad = 0, seatUse = 0, reversals = 0, lastDir = null;
    const earned0 = t.earned;
    for (let i = 0; i < 30 * 200; i++) {
      if (i % 30 === 0) for (const s of [sA, sB]) s.stock.PASSENGERS = Math.max(s.stock.PASSENGERS || 0, 40);
      g.tick(1 / 30);
      const n = t.cargo.reduce((x, l) => x + l.n, 0);
      maxLoad = Math.max(maxLoad, n);
      if (n) { const L = C.assignLoads(t._st, t.cargo); seatUse = Math.max(seatUse, L.wagons.filter((w) => w.id[0] === '@').reduce((x, w) => x + w.n, 0)); }
      const lead = t.veh[0];
      if (lastDir != null && lead !== lastDir) reversals++;
      lastDir = lead;
    }
    return { trips: t.trips, earned: t.earned - earned0, maxLoad, seatUse, cap: t._st.capFull, problem: t.problem || null, layout: t.veh.map((v) => v.id + (v.r ? ':r' : '')).join(' ') };
  });
  check(!line.none && line.trips >= 3 && line.earned > 0 && line.seatUse > 0 && !line.problem, `a DMU (${line.layout}) shuttles between two stations: ${line.trips} stops, ${line.earned} ● earned, up to ${line.maxLoad}/${line.cap} passengers with ${line.seatUse} in the power cars${line.problem ? ' — problem ' + line.problem : ''}`);
  // ---------- composition bonuses and traits ----------
  const rev = await page.evaluate(async () => {
    const g = window.__tracklands.game, E = g.economy;
    const C = await import('./src/trains/Consist.js');
    const fx = g.progression.fx;
    const tr = (arr) => ({ _st: C.computeStats(C.parseConsist(arr), null, fx) });
    const base = tr(['L:trailmaster', 'W:coach', 'W:coach']);
    const sleeper = tr(['L:trailmaster', 'W:coach', 'W:sleeper']);
    const dining = tr(['L:trailmaster', 'W:coach', 'W:dining']);
    const im = tr(['L:boxline', 'W:container']), plain = tr(['L:voltstream_e1', 'W:container']);
    const r = (t, c, d) => E.revenue(c, 10, d, t, false);
    return {
      sleeperLong: r(sleeper, 'PASSENGERS', 40) / r(base, 'PASSENGERS', 40), sleeperShort: r(sleeper, 'PASSENGERS', 10) / r(base, 'PASSENGERS', 10),
      dining: r(dining, 'PASSENGERS', 20) / r(base, 'PASSENGERS', 20), inter: r(im, 'GOODS', 20) / r(plain, 'GOODS', 20), interBulk: r(im, 'FOOD', 20) / r(plain, 'FOOD', 20),
    };
  });
  check(rev.sleeperLong > 1.15 && Math.abs(rev.sleeperShort - 1) < 0.01, `sleeping car: fares ×${rev.sleeperLong.toFixed(2)} over 40 tiles, unchanged over 10 (×${rev.sleeperShort.toFixed(2)})`);
  check(rev.dining > 1.03 && rev.inter > 1.1 && Math.abs(rev.interBulk - 1) < 0.01, `dining car ×${rev.dining.toFixed(2)} on every fare; intermodal locomotive ×${rev.inter.toFixed(2)} on goods, ×${rev.interBulk.toFixed(2)} on food`);
  // ---------- balance: later is not simply better ----------
  const bal = await page.evaluate(async () => {
    const { LOCOS } = await import('./src/config.js');
    const g = window.__tracklands.game;
    const price = (m) => g.economy.costs.train(m);
    const cap = (m) => (m.mu ? m.mu.cap * 4 : 0) + m.pax + m.freight;
    const dominated = [];
    for (const kind of ['steam', 'diesel', 'electric', 'hst']) {
      const ms = LOCOS.filter((m) => (kind === 'steam' ? m.kind.startsWith('steam') : m.kind === kind));
      for (const a of ms) for (const b of ms) {
        if (b.level <= a.level || a.duty !== b.duty) continue;
        if (b.speed >= a.speed && b.accel >= a.accel && b.power >= a.power && cap(b) >= cap(a) && b.reliability >= a.reliability && price(b) <= price(a) && b.op <= a.op) dominated.push(`${b.id}>${a.id}`);
      }
    }
    const hst = LOCOS.filter((m) => m.kind === 'hst').map((m) => ({ id: m.id, v: m.speed, a: m.accel, p: price(m) }));
    const fastest = hst.slice().sort((x, y) => y.v - x.v)[0], quickest = hst.slice().sort((x, y) => y.a - x.a)[0], cheapest = hst.slice().sort((x, y) => x.p - y.p)[0];
    return { dominated, fastest: fastest.id, quickest: quickest.id, cheapest: cheapest.id };
  });
  check(!bal.dominated.length, `no later model of the same role beats an earlier one in every figure${bal.dominated.length ? ': ' + bal.dominated.join(', ') : ''}`);
  check(new Set([bal.fastest, bal.quickest, bal.cheapest]).size >= 2, `high speed: fastest ${bal.fastest}, quickest off the mark ${bal.quickest}, cheapest ${bal.cheapest}`);
  // ---------- catalogue with real clicks ----------
  await page.evaluate(() => { const g = window.__tracklands.game; g.progression.level = 25; g.progression.research.add('electric_rail'); });
  await page.click('#menu-rail [data-arg=collection]');
  await page.waitForSelector('#panel .cat-card');
  const c0 = await page.evaluate(() => ({ cards: document.querySelectorAll('#panel .cat-card').length, count: document.querySelector('#panel .cat-count').textContent, img: [...document.querySelectorAll('#panel .cat-card img')].filter((i) => i.src.startsWith('data:image/png')).length, pro: document.querySelectorAll('#panel .cat-card .good').length }));
  check(c0.cards === 24 && /\d+/.test(c0.count) && c0.img === c0.cards && c0.pro > 0, `the vehicle catalogue opens from the menu: ${c0.count}, first ${c0.cards} cards with 3D previews and strengths`);
  await page.click('#panel [data-act=catMode][data-arg=bus]');
  const buses = await page.evaluate(() => [...document.querySelectorAll('#panel .cat-card')].map((e) => e.dataset.key));
  check(buses.length >= 8 && buses.every((k) => k.startsWith('R:')), `mode filter "bus": ${buses.length} buses only`);
  await page.click('#panel [data-act=catMode][data-arg=rail]');
  await page.fill('#panel input[data-input=catQuery]', 'tank');
  await page.waitForTimeout(150);
  const found = await page.evaluate(() => [...document.querySelectorAll('#panel .cat-card')].map((e) => e.dataset.key));
  check(found.length >= 1 && found.every((k) => k === 'L:meadow_tank' || k === 'L:pioneer' || /tank/i.test(k)), `search "tank": ${found.join(', ')}`);
  await page.fill('#panel input[data-input=catQuery]', '');
  await page.waitForTimeout(100);
  await page.selectOption('#panel select[data-change=catRole]', 'duty_highspeed');
  const hs = await page.evaluate(() => [...document.querySelectorAll('#panel .cat-card')].length);
  await page.selectOption('#panel select[data-change=catRole]', '');
  await page.selectOption('#panel select[data-change=catEra]', '1');
  const e1 = await page.evaluate(() => [...document.querySelectorAll('#panel .cat-card')].map((e) => e.dataset.key));
  await page.selectOption('#panel select[data-change=catEra]', '');
  check(hs >= 6 && e1.length >= 3 && e1.every((k) => ['L:pioneer', 'L:ironhill', 'L:meadow_tank'].includes(k)), `role filter "high speed": ${hs}; era filter "Steam": ${e1.length}`);
  // favourite: star a model with a click, it moves to the top and stays in the save
  await page.click('#panel .cat-card[data-key="L:ironhill"] [data-act=catFav]');
  const fav = await page.evaluate(() => ({ first: document.querySelector('#panel .cat-card').dataset.key, set: [...window.__tracklands.game.progression.favs] }));
  check(fav.first === 'L:ironhill' && fav.set.includes('L:ironhill'), `starring a model puts it first (${fav.first})`);
  // compare two with their check boxes
  await page.locator('#panel .cat-card[data-key="L:ironhill"] input[data-change=catCmp]').check();
  await page.locator('#panel .cat-card[data-key="L:pioneer"] input[data-change=catCmp]').check();
  await page.click('#panel .cat-tray [data-act=catTab][data-arg=compare]');
  const cmp = await page.evaluate(() => { const t = document.querySelector('#panel table.cmp'); return t ? { cols: t.querySelectorAll('tr:first-child th').length - 1, rows: t.querySelectorAll('tr').length, best: t.querySelectorAll('b.good').length } : null; });
  check(cmp && cmp.cols === 2 && cmp.rows >= 12 && cmp.best >= 3, `compare: ${cmp && cmp.cols} models side by side, ${cmp && cmp.rows} rows, best values marked (${cmp && cmp.best})`);
  // ---------- builder: favourites first, search ----------
  await page.evaluate(() => window.__tracklands.ui.closePanel());
  await page.evaluate(() => { const g = window.__tracklands.game; if (!g.stations.depots.length) { for (let t = 0; t < 64 * 64; t++) if (!g.stations.placeError(t, 'depot') && g.net.conn[t] === 0) { g.construction.placeDepot(t); if (g.stations.depots.length) break; } } window.__tracklands.ui.openBuilder({ depotId: g.stations.depots[0] ? g.stations.depots[0].id : null }); });
  await page.waitForSelector('#panel .palette .pitem');
  const pal = await page.evaluate(() => [...document.querySelectorAll('#panel .palette .pitem')].slice(0, 2).map((e) => e.dataset.arg));
  await page.fill('#panel input[data-input=bldQuery]', 'Volt');
  await page.waitForTimeout(150);
  const q = await page.evaluate(() => [...document.querySelectorAll('#panel .palette .pitem')].map((e) => e.dataset.arg));
  check(pal[0] === 'L:ironhill' && q.length >= 2 && q.every((a) => /volt/i.test(a)), `builder: favourite first (${pal[0]}), search "Volt" → ${q.join(', ')}`);
  // ---------- save / load ----------
  const saved = await page.evaluate(() => JSON.parse(JSON.stringify(window.__tracklands.game.serialize())));
  saved.progression.favs.push('L:no_such_loco', 'X:1');
  await loadSave(page, saved);
  const favs2 = await page.evaluate(() => [...window.__tracklands.game.progression.favs]);
  check(favs2.length === 1 && favs2[0] === 'L:ironhill', `favourites survive save/load, unknown entries dropped (${favs2.join(',')})`);
  await loadSave(page, productionSave());
  const prod = await page.evaluate(() => ({ favs: window.__tracklands.game.progression.favs.size, trains: window.__tracklands.game.trains.trains.length }));
  check(prod.favs === 0 && prod.trains > 0, `the production save loads without favourites (${prod.trains} trains)`);
  if (errors.length) { ok = false; lines.push('errors: ' + errors.slice(0, 3).join(' | ')); }
  await ctx.close();
  return { ok, lines };
}
