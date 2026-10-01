// Phase 8 QA: content (every vehicle, cargo, industry, achievement and
// handbook page named in English and German, sane numbers), pathfinding under
// load (hundreds of random route requests: valid, repeatable, fast), a long
// game (six game years with trains running, chaos edits and save/load round
// trips on the way: health check stays clean, money stays finite), economic
// stability on three worlds, the Phase 8 achievements and statistics, and
// photo mode.
import { openPage, startTestGame } from '../lib.mjs';

export const name = 'qa';
export async function run({ browser, base, quick }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 1280, height: 800 } });
  await startTestGame(page, 4401);

  // ---- content QA ----
  const c = await page.evaluate(async () => {
    const C = await import('./src/config.js');
    const I = await import('./src/i18n.js');
    const { HANDBOOK } = await import('./src/ui/Handbook.js').catch(() => ({}));
    const { makerOf } = await import('./src/content/Makers.js');
    const out = { miss: [], bad: [] };
    const need = (k) => { for (const l of ['en', 'de']) if (!I.hasIn(l, k)) out.miss.push(l + ':' + k); };
    for (const cg of C.CARGO_IDS) need('cargo_' + cg);
    for (const it of C.INDUSTRY_TYPES) need('ind_' + it);
    for (const a of C.ACHIEVEMENTS) { need('ach_' + a.id); need('ach_' + a.id + '_desc'); }
    const num = (x) => typeof x === 'number' && Number.isFinite(x) && x > 0;
    for (const m of C.LOCOS) { if (!m.name || !num(m.speed) || !num(m.price) || !makerOf({ type: 'L', m })) out.bad.push('loco ' + m.id); }
    for (const [id, w] of Object.entries(C.WAGONS)) { if (!(Number.isFinite(w.cap ?? 0) && (w.cap ?? 0) >= 0) || !num(w.price ?? 1)) out.bad.push('wagon ' + id); }   // brake vans carry nothing
    for (const m of C.ROAD_VEHICLES) { if (!m.name || !num(m.speed) || !num(m.price) || !num(m.cap)) out.bad.push('road ' + m.id); }
    out.handbook = !!HANDBOOK;
    if (HANDBOOK) for (const tp of HANDBOOK) { need('hb_' + tp.id + '_title'); for (let i = 1; i <= tp.n; i++) need(`hb_${tp.id}_${i}`); }
    out.counts = { locos: C.LOCOS.length, wagons: Object.keys(C.WAGONS).length, road: C.ROAD_VEHICLES.length, cargo: C.CARGO_IDS.length, industries: C.INDUSTRY_TYPES.length, achievements: C.ACHIEVEMENTS.length };
    return out;
  });
  check(c.miss.length === 0, `every name in English and German (${JSON.stringify(c.counts)})${c.miss.length ? ': missing ' + c.miss.slice(0, 8).join(', ') : ''}`);
  check(c.bad.length === 0, `vehicle data is sane${c.bad.length ? ': ' + c.bad.slice(0, 6).join(', ') : ''}`);

  // ---- pathfinding under load ----
  const pf = await page.evaluate(async (n) => {
    const g = window.__tracklands.game, net = g.net;
    const { RailFuzz } = await import('./src/debug/RailFuzz.js');
    const { DX, DZ } = await import('./src/util.js');
    const F = new RailFuzz(g, 77); F.setup(); F.buildNetwork(); window.__qaF = F;
    const tiles = []; for (let i = 0; i < net.conn.length; i++) if (net.conn[i]) tiles.push(i);
    let rnd = 12345; const r = (k) => { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; return rnd % k; };
    const M = g.mapSize;
    let found = 0, invalid = 0, differ = 0, ms = 0, worst = 0;
    for (let q = 0; q < n; q++) {
      const a = tiles[r(tiles.length)], b = tiles[r(tiles.length)];
      const start = { tile: a, heading: r(8), fromCenter: true };
      net.routeCache.clear();
      const t0 = performance.now();
      const res = net.findRoute(start, b, { allowReverse: true });
      const dt = performance.now() - t0; ms += dt; worst = Math.max(worst, dt);
      if (!res) continue;
      found++;
      for (let k = 0; k + 1 < res.steps.length; k++) {
        const s0 = res.steps[k], s1 = res.steps[k + 1];
        const expect = s0.tile + DX[s0.outH] + DZ[s0.outH] * M;
        if (s1.tile !== expect || !net.conn[s1.tile]) { invalid++; break; }
      }
      net.routeCache.clear();
      const again = net.findRoute(start, b, { allowReverse: true });
      if (JSON.stringify(again && again.steps.map((s) => s.tile)) !== JSON.stringify(res.steps.map((s) => s.tile))) differ++;
    }
    return { n, tiles: tiles.length, found, invalid, differ, avg: ms / n, worst };
  }, quick ? 150 : 600);
  check(pf.found > pf.n * 0.2 && pf.invalid === 0 && pf.differ === 0 && pf.avg < 8, `pathfinding: ${pf.n} random requests on ${pf.tiles} track tiles, ${pf.found} routes, ${pf.invalid} invalid, ${pf.differ} not repeatable, avg ${pf.avg.toFixed(2)} ms, worst ${pf.worst.toFixed(1)} ms`);

  // ---- long game with chaos and save/load round trips ----
  const years = quick ? 2 : 6;
  const lg = await page.evaluate(async (Y) => {
    const g0 = window.__tracklands.game;
    const { healthOfGame } = await import('./src/save/Backups.js');
    const F = window.__qaF;              // the network built for the pathfinding check
    let guard = 0;
    while (g0.trains.trains.length < 10 && guard++ < 300) { F.buyRandom(); for (let k = 0; k < 10; k++) g0.tick(1 / 30); }
    const out = { years: [], issues: [], chaos: 0, loads: 0 };
    let g = g0;
    for (let y = 0; y < Y; y++) {
      for (let m = 0; m < 12; m++) {
        for (let k = 0; k < 60 * 30 / 4; k++) g.tick(4 / 30);
        // chaos: live edits while trains run
        if (m % 3 === 1) { try { F.game = g; F.mutate ? F.mutate() : F.buyRandom(); out.chaos++; } catch (e) { out.issues.push('chaos: ' + e.message); } }
      }
      const h = healthOfGame(g);
      if (!h.ok) out.issues.push(`year ${y}: ` + JSON.stringify(h.issues));
      out.years.push({ y: g.ledger.year(), coins: Math.round(g.economy.coins), trains: g.trains.trains.length, value: Math.round(g.ledger.companyValue().total) });
      // save and load every other year
      if (y % 2 === 1) {
        const app = window.__tracklands, data = g.serialize();
        app.ui.detach(); g.dispose(); app.game = null;
        app.startGame({ save: JSON.parse(JSON.stringify(data)), test: true, paused: true });
        while (!(app.game && app.game.running)) await new Promise((r) => setTimeout(r, 50));
        g = app.game; g.tutorial.skip(); document.querySelectorAll('.modal-wrap').forEach((x) => x.remove());
        F.game = g; out.loads++;
      }
    }
    out.finite = out.years.every((r) => Number.isFinite(r.coins) && Number.isFinite(r.value));
    return out;
  }, years);
  check(lg.issues.length === 0 && lg.finite && lg.years.length === years, `long game: ${years} years, ${lg.chaos} chaos edits, ${lg.loads} save/load round trips; ${lg.years.map((r) => `${r.y}: ${r.coins}● ${r.trains} trains`).join(' · ')}${lg.issues.length ? ' — ' + lg.issues.slice(0, 3).join(' | ') : ''}`);

  // ---- economic stability on three worlds ----
  for (const seed of quick ? [11] : [11, 23, 57]) {
    await startTestGame(page, seed * 7919, { difficulty: 'standard' });
    const e = await page.evaluate(async (sd) => {
      const g = window.__tracklands.game;
      const { RailFuzz } = await import('./src/debug/RailFuzz.js');
      const F = new RailFuzz(g, sd); F.setup(); F.buildNetwork();
      let guard = 0;
      while (g.trains.trains.length < 8 && guard++ < 300) { F.buyRandom(); for (let k = 0; k < 10; k++) g.tick(1 / 30); }
      g.economy.coins = 200000;         // a real company's cash, not the test network's budget
      const r = null;
      const hist = [];
      for (let m = 0; m < 24; m++) { for (let k = 0; k < 60 * 30 / 4; k++) g.tick(4 / 30); hist.push(Math.round(g.economy.coins)); }
      const d = hist.slice(1).map((v, i) => v - hist[i]);
      const maxJump = Math.max(...d.map(Math.abs));
      return { sim: r ? (r.ok !== false) : true, hist, finite: hist.every(Number.isFinite), maxJump, start: hist[0], end: hist[hist.length - 1] };
    }, seed);
    const sane = e.finite && e.end > -5e6 && e.end < 5e8 && e.maxJump < Math.max(2e6, Math.abs(e.start) * 5);
    check(e.sim && sane, `economy seed ${seed}: two game years ${e.start}● → ${e.end}●, largest monthly change ${e.maxJump}●`);
  }

  // ---- achievements, statistics and photo mode ----
  await startTestGame(page, 4402);
  const a = await page.evaluate(async () => {
    const g = window.__tracklands.game, ui = g.ui, out = {};
    const C = await import('./src/config.js');
    const { MONTH_S } = await import('./src/economy/Ledger.js');
    g.time += 12 * 12 * MONTH_S;                      // twelve years in business
    g.progression.tick(1.1);
    out.decade = g.progression.achievements.has('decade') && !g.progression.achievements.has('half_century');
    out.years = g.stats.data.yearsInBusiness;
    ui.openPanel('achievements');
    await new Promise((r) => setTimeout(r, 50));
    out.count = document.querySelectorAll('#panel .ach').length === C.ACHIEVEMENTS.length;
    ui.closePanel();
    ui.openPanel('stats');
    await new Promise((r) => setTimeout(r, 50));
    out.stats = /12/.test(document.getElementById('panel').textContent);
    ui.closePanel();
    // photo mode
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p' })); window.dispatchEvent(new KeyboardEvent('keyup', { key: 'p' }));
    out.on = document.body.classList.contains('photo-mode') && !!document.getElementById('photo-bar') && getComputedStyle(document.getElementById('hud')).display === 'none';
    const shot = ui.photoShot();
    out.shot = shot && shot.bytes > 1000 && /\.png$/.test(shot.name);
    const az = g.camera.azGoal;
    document.querySelector('[data-act="photoCine"]').click();
    for (let f = 0; f < 30; f++) g.frame(1 / 30);
    out.cine = g.camera.azGoal > az;
    document.querySelector('[data-act="photoLabels"]').click();
    out.nolabels = getComputedStyle(document.getElementById('labels')).display === 'none';
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape' }));
    out.off = !document.body.classList.contains('photo-mode') && !document.getElementById('photo-bar') && getComputedStyle(document.getElementById('hud')).display !== 'none';
    return out;
  });
  check(a.decade && a.years === 12 && a.count, `achievements: "a decade of service" after ${a.years} years; the list shows every achievement`);
  check(a.stats, 'the statistics page shows the years in business');
  check(a.on && a.shot && a.cine && a.nolabels && a.off, 'photo mode: P hides the interface, a picture is taken, the cinematic camera turns, names hide, Esc leaves');
  if (errors.length) { ok = false; lines.push('errors: ' + errors.slice(0, 3).join(' | ')); }
  await ctx.close();
  return { ok, lines };
}
