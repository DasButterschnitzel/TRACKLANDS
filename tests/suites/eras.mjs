// Era visuals (Phase 10): towns have a history (an old centre, newer edges;
// no towers in 1900), buildings keep their year through a save, older saves
// get a made-up past, stations are renovated or listed, signals are
// semaphores before 1960 and colour lights later, the eras turn with news,
// works fittings and street surfaces, towns and the company keep a history,
// the catalogue filters by era, and the sandbox moves the calendar.
import { openPage, loadSave, productionSave, ensureOut } from '../lib.mjs';
import path from 'path';

export const name = 'eras';

async function world(page, opts) {
  await page.evaluate((o) => {
    const app = window.__tracklands;
    document.querySelectorAll('.modal-wrap').forEach((m) => m.remove());
    if (app.game) { app.ui.detach(); app.game.dispose(); app.game = null; }
    app.startGame({ difficulty: 'builder', test: true, paused: true, ...o });
  }, opts);
  await page.waitForFunction(() => window.__tracklands.game && window.__tracklands.game.running, null, { timeout: 60000 });
  await page.evaluate(() => { const g = window.__tracklands.game; g.tutorial.skip(); document.querySelectorAll('.modal-wrap').forEach((m) => m.remove()); });
}

export async function run({ browser, base }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  const out = ensureOut();
  const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 1280, height: 800 } });
  const townInfo = () => page.evaluate(async () => {
    const g = window.__tracklands.game, E = await import('./src/world/Eras.js');
    const bands = new Array(6).fill(0), tall = [];
    let coreY = 0, coreN = 0, edgeY = 0, edgeN = 0;
    for (const t of g.towns.list) for (const b of t.buildings) {
      bands[E.bandOf(b.y)]++;
      if (['tower', 'skyscraper', 'glasstower'].includes(b.arch)) tall.push(b.arch + '@' + b.y);
      const d = Math.max(Math.abs(b.tile % g.mapSize - t.x), Math.abs(Math.floor(b.tile / g.mapSize) - t.z));
      if (d <= 1) { coreY += b.y; coreN++; } else if (d >= 2) { edgeY += b.y; edgeN++; }
    }
    return { bands, tall, core: Math.round(coreY / Math.max(1, coreN)), edge: Math.round(edgeY / Math.max(1, edgeN)), n: bands.reduce((a, b) => a + b, 0) };
  });

  // ---- a world in 1900 and the same world in 1990 ----
  await world(page, { seed: 4040, mapSize: 96, startYear: 1900 });
  const w1900 = await townInfo();
  await page.screenshot({ path: path.join(out, 'eras-1900.png') });
  await world(page, { seed: 4040, mapSize: 96, startYear: 1990 });
  const w1990 = await townInfo();
  await page.screenshot({ path: path.join(out, 'eras-1990.png') });
  check(w1900.bands[0] + w1900.bands[1] === w1900.n && w1900.tall.length === 0, `1900: all ${w1900.n} buildings from the early eras, no towers (${w1900.bands.join('/')})`);
  check(w1990.bands.filter(Boolean).length >= 3 && w1990.core < w1990.edge, `1990: towns in layers (${w1990.bands.join('/')} per era), the centre older than the edge (${w1990.core} vs ${w1990.edge})`);
  // building years survive a save
  const saved = await page.evaluate(async () => {
    const g = window.__tracklands.game, S = await import('./src/save/Save.js');
    window.__esave = S.migrate(JSON.parse(JSON.stringify(g.serialize())));
    return g.towns.list.map((t) => t.buildings.map((b) => `${b.tile}:${b.arch}:${b.y}:${b.base || ''}`).sort().join(',')).join('|');
  });
  await loadSave(page, await page.evaluate(() => window.__esave));
  const loaded = await page.evaluate(() => window.__tracklands.game.towns.list.map((t) => t.buildings.map((b) => `${b.tile}:${b.arch}:${b.y}:${b.base || ''}`).sort().join(',')).join('|'));
  check(saved === loaded, 'building years and kinds are the same after a save and load');

  // ---- an older save: its buildings get a past, nothing else changes ----
  const prod = productionSave();
  await loadSave(page, prod);
  const pr = await page.evaluate((sv) => {
    const g = window.__tracklands.game;
    const before = sv.towns.map((t) => (t.bld || []).length).reduce((a, b) => a + b, 0);
    const now = g.towns.list.reduce((a, t) => a + t.buildings.length, 0);
    const ys = g.towns.list.flatMap((t) => t.buildings.map((b) => b.y));
    return { before, now, allYears: ys.every((y) => Number.isInteger(y) && y > 1700 && y <= g.ledger.year()), stationsYb: g.stations.list.every((s) => Number.isInteger(s.yb)), sigs: g.net.signals.size };
  }, prod);
  check(pr.now > 0 && (pr.before === 0 || pr.now === pr.before) && pr.allYears && pr.stationsYb, `the production save loads with a made-up past: ${pr.now} buildings${pr.before ? ` (as saved: ${pr.before})` : ' (rebuilt from the town stages, as before)'} and station years`);

  // ---- stations, signals and the turning eras in a 1950 game ----
  await world(page, { seed: 777, mapSize: 64, startYear: 1950 });
  const st = await page.evaluate(async () => {
    const g = window.__tracklands.game, ui = g.ui;
    const { RailFuzz } = await import('./src/debug/RailFuzz.js');
    const F = new RailFuzz(g, 5); F.setup(); F.buildNetwork();
    const S = g.stations, s = S.mine()[0];
    // a signal put up now
    let key = null;
    for (let i = 0; i < g.net.conn.length && key == null; i++) if (g.net.conn[i] && !g.net.special.has(i) && !g.net.isJunction(i)) for (let d = 0; d < 8; d++) if (g.net.hasDir(i, d)) { key = i * 8 + d; break; }
    g.net.signals.set(key, { type: 'block', oneway: false, y: g.ledger.year() });
    g.furniture.update(0.3);
    const sem1950 = g.furniture.semas.count;
    const out = { yb: s.yb, canRen0: S.canRenovate(s), canList0: S.canList(s), sem1950, news0: g.news.items ? g.news.items.length : 0 };
    // thirty years on (sandbox calendar): a new era
    ui.actions.sbYear('25'); ui.actions.sbYear('10');
    out.year = g.ledger.year();
    out.canRen = S.canRenovate(s);
    out.lookBefore = S.lookYear(s);
    const coins = g.economy.coins, cost = S.renovateCost(s);
    out.err = S.renovate(s);
    out.paid = Math.round(coins - g.economy.coins) === cost;
    out.reno = s.reno; out.canRenAfter = S.canRenovate(s);
    const s2 = S.mine().find((x) => x !== s);
    out.canList35 = s2 ? S.canList(s2) : true;
    // the signal from 1950 is still a semaphore in 1985; by 2000 all are colour lights
    g.furniture.update(0.3);
    out.sem1985 = g.furniture.semas.count;
    ui.actions.sbYear('25');
    // a station over 40 years old can be listed and then keeps its look
    out.canList2 = s2 ? S.canList(s2) : false;
    out.listErr = s2 ? S.setHeritage(s2, true) : 'none';
    out.listedNoReno = s2 ? !S.canRenovate(s2) : false;
    g.furniture.update(0.3);
    out.sem2010 = g.furniture.semas.count; out.masts2010 = g.furniture.masts.count;
    out.news = (g.news.items || g.news.list || []).map((n) => n.key).slice(-12);
    out.hist = g.history.company.map((e) => e[1]);
    // the station inspector shows the block
    g.select({ type: 'station', id: s.id }); ui.inspect && ui.inspect();
    out.card = !!document.querySelector('#st-era') || /st-era/.test(ui.iStation ? ui.iStation(s) : '');
    return out;
  });
  check(st.yb === 1950 && !st.canRen0 && !st.canList0, `a new station opens in ${st.yb}; nothing to renovate or list yet`);
  check(st.canRen && !st.err && st.paid && st.reno === st.year && !st.canRenAfter, `in ${st.year} it can be renovated (paid, renovated ${st.reno}); afterwards not again`);
  check(!st.canList35 && st.canList2 && !st.listErr && st.listedNoReno, 'a station 35 years old cannot be listed yet; at 60 it is listed and then keeps its look (no renovation)');
  check(st.sem1950 >= 1 && st.sem1985 >= 1 && st.sem2010 === 0 && st.masts2010 >= 1, `signals: semaphore in 1950 (${st.sem1950}) and 1985 (${st.sem1985}), colour lights by 2010 (${st.masts2010})`);
  check(st.news.includes('news_era_band') && st.news.includes('news_st_renovated') && st.news.includes('news_st_listed'), `news: ${st.news.filter((k) => /era|st_/.test(k)).join(', ')}`);
  check(st.hist.includes('first_station') && st.hist.includes('first_renovation') && st.hist.includes('era'), `company milestones: ${[...new Set(st.hist)].join(', ')}`);

  // ---- town history, catalogue filters, UI ----
  const ui = await page.evaluate(() => {
    const g = window.__tracklands.game, ui = g.ui;
    const t = g.towns.list[0];
    g.towns.levelUp(t);
    const h = ui.townHistory(t);
    ui.openPanel('collection');
    const counts = {};
    for (const sp of ['', 'current', 'historic', 'locked']) { ui.catState().span = sp; counts[sp || 'all'] = ui.catFiltered().length; }
    counts.lockedWant = ui.catItems().filter((it) => !it.unlocked).length;
    ui.catState().span = '';
    ui.openPanel('company');
    const ms = !!document.querySelector('.panel details.history') || /company_milestones|Milestones|Meilensteine/.test(document.body.innerHTML);
    return { h: /history|Geschichte/.test(h) && /era-bar/.test(h), log: g.history.townLog(t).map((e) => e[1]), counts, ms };
  });
  check(ui.h && ui.log.includes('stage'), `the town inspector shows its history and building eras (${ui.log.join(', ')})`);
  check(ui.counts.all > ui.counts.current && ui.counts.historic > 0 && ui.counts.current > 0 && ui.counts.locked === ui.counts.lockedWant, `catalogue era filter: all ${ui.counts.all}, current ${ui.counts.current}, historic ${ui.counts.historic}, locked ${ui.counts.locked} (builder game)`);
  check(ui.ms, 'the company panel lists the milestones');
  await page.screenshot({ path: path.join(out, 'eras-2010.png') });
  if (errors.length) { ok = false; lines.push('errors: ' + errors.slice(0, 3).join(' | ')); }
  await ctx.close();
  return { ok, lines };
}
