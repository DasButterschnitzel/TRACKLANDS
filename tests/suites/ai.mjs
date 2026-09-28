// Phase 9 competitor railways (src/world/RailAI.js). A railway company plays
// alongside a player network for fifteen years:
//  - it finds, designs, builds and runs lines that earn money (real revenue)
//  - the player's track, stations, depots and trains are untouched, its
//    network never touches anyone else's, and it keeps clear of the player's
//    stations and depots (courtesy distance)
//  - anti-spam: little unused track, no duplicate corridors, no idle trains
//    or stations, no build/demolish loops
//  - its plans survive save and load, it plays out the same way twice
//  - its thinking stays within a time budget
// Then four companies share one world for ten years, and a screenshot of a
// company network is written to tests/output for inspection.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPage } from '../lib.mjs';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'output');

async function world(page, opts) {
  await page.evaluate((o) => {
    const app = window.__tracklands;
    document.querySelectorAll('.modal-wrap').forEach((m) => m.remove());
    if (app.game) { app.ui.detach(); app.game.dispose(); app.game = null; }
    app.startGame({ difficulty: 'standard', test: true, paused: true, ...o });
  }, opts);
  await page.waitForFunction(() => window.__tracklands.game && window.__tracklands.game.running, null, { timeout: 90000 });
  await page.evaluate(() => { const g = window.__tracklands.game; g.tutorial.skip(); document.querySelectorAll('.modal-wrap').forEach((m) => m.remove()); });
}
// months of simulation in coarse steps (the AI thinks once a month)
const months = (page, n) => page.evaluate((k) => { const g = window.__tracklands.game; for (let m = 0; m < k; m++) for (let s = 0; s < 450; s++) g.tick(4 / 30); return g.ledger.monthIndex(); }, n);

export const name = 'ai';
export async function run({ browser, base, quick }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 1280, height: 800 } });
  const YEARS = quick ? 8 : 15;

  // ---- one railway company beside a player network ----
  await world(page, { seed: 777001, rivals: 1, mapSize: 96 });
  const setup = await page.evaluate(async () => {
    const g = window.__tracklands.game;
    // the player's network: a few stations, track, a depot and trains
    const { RailFuzz } = await import('./src/debug/RailFuzz.js');
    const F = new RailFuzz(g, 5); F.setup(); F.buildNetwork();
    for (let k = 0; k < 3; k++) F.buyRandom();
    const net = g.net, snap = [];
    for (let i = 0; i < net.conn.length; i++) if (net.conn[i]) snap.push([i, net.conn[i], net.tier[i]]);
    return {
      tiles: snap, stations: g.stations.list.map((s) => [s.id, g.stations.allTiles(s).join(',')]),
      depots: g.stations.depots.map((d) => [d.id, d.tile]), trains: g.trains.trains.map((t) => t.id), rival: g.rivals.list[0].name,
    };
  });
  const snapshot = new Map(setup.tiles.map(([i, c, t]) => [i, c + ':' + t]));
  let half = null;
  for (let y = 0; y < YEARS; y++) {
    await months(page, 12);
    // a save and load half way: the company carries on with its plans
    if (y === Math.floor(YEARS / 2)) {
      half = await page.evaluate(async () => {
        const app = window.__tracklands, g = app.game, r = g.rivals.list[0];
        const before = { projects: r.rail.projects.map((p) => p.id + ':' + p.stage).join(','), trains: r.trains().length, money: Math.round(r.money) };
        const data = JSON.parse(JSON.stringify(g.serialize()));
        app.ui.detach(); g.dispose(); app.game = null;
        app.startGame({ save: data, test: true, paused: true });
        while (!(app.game && app.game.running)) await new Promise((res) => setTimeout(res, 50));
        const g2 = app.game, r2 = g2.rivals.list[0];
        return { before, after: { projects: r2.rail.projects.map((p) => p.id + ':' + p.stage).join(','), trains: r2.trains().length, money: Math.round(r2.money) } };
      });
    }
  }
  const res = await page.evaluate(() => {
    const g = window.__tracklands.game, net = g.net, r = g.rivals.list[0], P = g.rivals.planner(r);
    // other companies' tiles joined to the rival's (should be none)
    let touch = 0;
    for (let i = 0; i < net.conn.length; i++) if (net.conn[i]) for (let d = 0; d < 8; d++) if ((net.conn[i] >> d) & 1) {
      const x = i % g.mapSize + [1, 1, 0, -1, -1, -1, 0, 1][d], z = Math.floor(i / g.mapSize) + [0, 1, 1, 1, 0, -1, -1, -1][d];
      const j = z * g.mapSize + x;
      if (net.own[j] !== net.own[i]) touch++;
    }
    // rival stations and depots next to the player's (courtesy)
    let close = 0;
    for (const s of g.stations.list.filter((x) => x.owner)) for (const t of g.stations.allTiles(s)) for (const o of g.stations.list.filter((x) => !x.owner)) for (const u of g.stations.allTiles(o)) if (Math.max(Math.abs(t % g.mapSize - u % g.mapSize), Math.abs(Math.floor(t / g.mapSize) - Math.floor(u / g.mapSize))) <= 2) close++;
    const tiles = [];
    for (let i = 0; i < net.conn.length; i++) if (net.conn[i] && !net.own[i]) tiles.push([i, net.conn[i] + ':' + net.tier[i]]);
    const ops = r.rail.projects.filter((p) => p.stage === 'operate');
    const pairs = r.rail.history.filter((h) => h.outcome === 'retired').map((h) => h.a + '|' + h.b);
    return {
      money: Math.round(r.money), loan: r.loan, value: r.value(), ops: ops.length, trains: r.trains().length,
      rev: ops.reduce((a, p) => a + p.rev.slice(-12).reduce((x, y) => x + y, 0), 0), trips: r.trains().reduce((a, t) => a + t.trips, 0),
      metrics: P.metrics(), touch, close, tiles, stations: g.stations.list.filter((s) => !s.owner).map((s) => [s.id, g.stations.allTiles(s).join(',')]),
      depots: g.stations.depots.filter((d) => !d.owner).map((d) => [d.id, d.tile]), trainIds: g.trains.mine().map((t) => t.id),
      retiredTwice: pairs.length - new Set(pairs).size, log: r.rail.log.slice(-12).map((e) => `${e.m} ${e.text}`),
      thinkMs: g.rivals.thinkMs, monthsRun: g.ledger.monthIndex(), playerCoins: g.economy.coins, rivalInLedger: g.ledger.log.some((e) => e.note && String(e.note).includes(r.short)),
      kinds: [...new Set(ops.map((p) => p.mode))].join('/'), loops: ops.reduce((a, p) => a + p.loops, 0),
    };
  });
  check(res.ops >= 2 && res.trains >= 2 && res.rev > 0 && res.trips > 50, `${setup.rival}: ${res.ops} lines (${res.kinds} track, ${res.loops} passing loops), ${res.trains} trains, ${res.trips} trips, ${res.rev} earned in the last year, value ${res.value}, cash ${res.money}, loan ${res.loan}`);
  const changed = res.tiles.filter(([i, v]) => snapshot.get(i) !== v).length + [...snapshot.keys()].filter((i) => !res.tiles.some(([j]) => j === i)).length;
  const stSame = JSON.stringify(res.stations) === JSON.stringify(setup.stations), depSame = JSON.stringify(res.depots) === JSON.stringify(setup.depots);
  const trainsSame = setup.trains.every((id) => res.trainIds.includes(id));
  check(changed === 0 && stSame && depSame && trainsSame, `the player's ${snapshot.size} track tiles, ${setup.stations.length} stations, ${setup.depots.length} depots and ${setup.trains.length} trains are untouched (${changed} tiles changed)`);
  check(res.touch === 0 && res.close === 0, `networks never touch (${res.touch} links across owners); no rival station within 2 tiles of the player's (${res.close})`);
  const M = res.metrics;
  check(M.unusedTrack < 0.1 && M.duplicateCorridors === 0 && M.unusedVehicles <= 1 && M.idleStations <= 1 && res.retiredTwice === 0,
    `anti-spam: ${M.trackTiles} track tiles, ${(M.unusedTrack * 100).toFixed(0)}% unused, ${M.duplicateCorridors} duplicate corridors, ${M.unusedVehicles} idle trains, ${M.idleStations} idle stations, ${M.retired} lines closed, ${res.retiredTwice} rebuilt-and-closed again, ${M.trackPerKUnit ? M.trackPerKUnit.toFixed(1) : '-'} tiles per 1000 units carried`);
  check(!!half && half.before.projects === half.after.projects && half.before.trains === half.after.trains && half.before.money === half.after.money, `save and load keeps its plans (${half && half.before.projects} → ${half && half.after.projects}), trains (${half && half.after.trains}) and money (${half && half.before.money} → ${half && half.after.money})`);
  const perMonth = res.thinkMs / Math.max(1, res.monthsRun);
  check(perMonth < 25, `thinking time ${perMonth.toFixed(1)} ms a month on average (budget 25)`);
  check(!res.rivalInLedger && Number.isFinite(res.playerCoins), 'the rival\'s money never appears in the player\'s books');
  lines.push('     last decisions: ' + res.log.join(' · '));

  // ---- the same world twice: the same decisions ----
  const runLog = async () => { await world(page, { seed: 555, rivals: 1, mapSize: 64 }); await months(page, 48); return page.evaluate(() => window.__tracklands.game.rivals.list[0].rail.log.map((e) => e.m + e.text).join('|')); };
  const l1 = await runLog(), l2 = await runLog();
  check(l1 === l2 && l1.length > 20, `deterministic: two runs of the same world make the same ${l1.split('|').length} decisions`);

  // ---- four companies, ten years ----
  await world(page, { seed: 909090, rivals: 4, mapSize: 128 });
  await page.evaluate(() => { const g = window.__tracklands.game; for (let r = 0; r < 8; r++) g.progression.regions.add(r); });
  await months(page, quick ? 72 : 120);
  const four = await page.evaluate(() => {
    const g = window.__tracklands.game, net = g.net;
    let touch = 0;
    for (let i = 0; i < net.conn.length; i++) if (net.conn[i]) for (let d = 0; d < 8; d++) if ((net.conn[i] >> d) & 1) {
      const x = i % g.mapSize + [1, 1, 0, -1, -1, -1, 0, 1][d], z = Math.floor(i / g.mapSize) + [0, 1, 1, 1, 0, -1, -1, -1][d];
      if (net.own[z * g.mapSize + x] !== net.own[i]) touch++;
    }
    return {
      touch, closed: g.rivals.closed.length, thinkMs: g.rivals.thinkMs, m: g.ledger.monthIndex(),
      cos: g.rivals.list.map((r) => { const P = g.rivals.planner(r); const M = P ? P.metrics() : null; return { name: r.short, rail: !!r.rail, money: Math.round(r.money), value: r.value(), trains: r.trains().length, buses: r.vehicles().length, lines: r.rail ? r.rail.projects.filter((p) => p.stage === 'operate').length : r.lines.length, unused: M ? M.unusedTrack : 0, dup: M ? M.duplicateCorridors : 0, finite: Number.isFinite(r.money) }; }),
    };
  });
  const railCos = four.cos.filter((c) => c.rail);
  check(four.touch === 0 && four.cos.every((c) => c.finite) && railCos.every((c) => c.unused < 0.15 && c.dup === 0) && railCos.some((c) => c.lines >= 2),
    `four companies, ten years: ${four.cos.map((c) => `${c.name} ${c.lines} lines ${c.trains + c.buses} vehicles value ${c.value}${c.rail ? ` unused ${(c.unused * 100).toFixed(0)}% dup ${c.dup}` : ''}`).join(' · ')}; ${four.closed} closed; ${four.touch} links across owners`);
  check(four.thinkMs / Math.max(1, four.m) < 60, `four companies think ${(four.thinkMs / Math.max(1, four.m)).toFixed(1)} ms a month together`);

  // ---- what the player sees: company page, read-only cards, overlay, news ----
  const ui = await page.evaluate(async () => {
    const g = window.__tracklands.game, ui = g.ui, out = {};
    const r = g.rivals.list.find((x) => x.rail && x.trains().length);
    ui.openPanel('company'); await new Promise((res) => setTimeout(res, 50));
    const link = document.querySelector(`#panel [data-act="rivalPage"][data-arg="${r.id}"]`);
    out.link = !!link;
    if (link) link.click();
    await new Promise((res) => setTimeout(res, 50));
    const txt = document.getElementById('panel').textContent;
    const facts = document.querySelector('#panel [data-section="company-facts"]');
    out.page = txt.includes(r.name) && !!facts && 'founded' in facts.dataset && +facts.dataset.trains === r.trains().length;
    ui.closePanel();
    // a rival train and station: only the company card, no controls
    const acts = (sel) => { g.select(sel); ui.renderInspector(); return [...document.querySelectorAll('#inspector [data-act]')].map((e) => e.dataset.act).filter((a) => !['rivalPage', 'focusSel', 'closeInspector'].includes(a)); };
    out.trainActs = acts({ type: 'train', id: r.trains()[0].id });
    out.stationActs = acts({ type: 'station', id: r.stations()[0].id });
    out.card = !!document.querySelector('#inspector .card.rival');
    g.select(null);
    ui.actions.overlay('owners'); g.frame(1 / 30);
    out.overlay = g.overlays.mode === 'owners' && g.overlays.quads.count > 0;
    ui.actions.overlay('owners');
    out.news = g.news.items.some((n) => String(n.key || '').startsWith('news_rival_'));
    return out;
  });
  check(ui.link && ui.page, 'the company panel links to a competitor page with its figures');
  check(ui.card && !ui.trainActs.length && !ui.stationActs.length, `a rival's train and station show a company card and no controls (${ui.trainActs.concat(ui.stationActs).join(', ') || 'none'})`);
  check(ui.overlay && ui.news, 'the companies overlay colours owners; the news reports competitor lines');

  // ---- a company that fails closes cleanly; the player can buy another ----
  const corp = await page.evaluate(() => {
    const g = window.__tracklands.game, Rv = g.rivals, net = g.net, out = {};
    const rails = Rv.list.filter((r) => r.rail && r.trains().length);
    if (rails.length < 2) return { skip: true };
    const dead = rails[0], buy = rails[1];
    const idxDead = dead.idx;
    Rv.liquidate(dead);
    let left = 0; for (let i = 0; i < net.conn.length; i++) if (net.own[i] === idxDead) left++;
    out.liq = { gone: !Rv.byId(dead.id), trains: g.trains.trains.filter((t) => t.owner === dead.id).length, stations: g.stations.list.filter((s) => s.owner === dead.id).length, depots: g.stations.depots.filter((d) => d.owner === dead.id).length, tiles: left, closed: Rv.closed.some((c) => c.id === dead.id) };
    g.progression.level = Math.max(g.progression.level, 8); g.economy.coins = 1e8;
    const nT = buy.trains().length, nS = buy.stations().length, idxB = buy.idx, mine0 = g.trains.mine().length;
    const res = Rv.acquire(buy);
    let own = 0; for (let i = 0; i < net.conn.length; i++) if (net.own[i] === idxB) own++;
    out.acq = { ok: !!res.ok, gone: !Rv.byId(buy.id), trains: g.trains.mine().length - mine0, expect: nT, stations: nS, tilesLeft: own, graph: g.net.validateGraph(20).length };
    return out;
  });
  check(corp.skip || (corp.liq.gone && corp.liq.closed && !corp.liq.trains && !corp.liq.stations && !corp.liq.depots && !corp.liq.tiles), `a failed company closes cleanly: no trains, stations, depots or track left behind${corp.liq ? ` (${JSON.stringify(corp.liq)})` : ''}`);
  check(corp.skip || (corp.acq.ok && corp.acq.gone && corp.acq.trains === corp.acq.expect && corp.acq.tilesLeft === 0 && corp.acq.graph === 0), `buying a railway company: its ${corp.acq ? corp.acq.expect : 0} trains, ${corp.acq ? corp.acq.stations : 0} stations and track become the player's`);

  // ---- a picture of a company network (for inspection) ----
  await page.evaluate(() => {
    const g = window.__tracklands.game, r = g.rivals.list.find((x) => x.rail && x.stations().length);
    if (!r) return;
    const ss = r.stations(); let x = 0, z = 0; for (const s of ss) { x += s.tile % g.mapSize; z += Math.floor(s.tile / g.mapSize); }
    g.camera.focus((x / ss.length) * 2, (z / ss.length) * 2, 34); g.camera.update(1); g.frame(1 / 30); g.frame(1 / 30);
  });
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, 'ai-network.png') });
  lines.push('     screenshot: tests/output/ai-network.png');

  // ---- hard terrain (Phase 10): mountains and islands ----
  // the planner reads the same terrain costs as the player: in the Alps it
  // builds along valleys and pays for tunnels, on islands for bridges, and it
  // still builds lines that pay and never touches anyone else's network
  for (const preset of ['alpine', 'archipelago']) {
    await world(page, { seed: 31013, rivals: 1, mapSize: 96, terrain: { preset } });
    await months(page, quick ? 72 : 120);
    const tr = await page.evaluate(() => {
      const g = window.__tracklands.game, net = g.net, r = g.rivals.list[0], P = g.rivals.planner(r), M = P.metrics();
      let bridges = 0, tunnels = 0, touch = 0;
      for (let i = 0; i < net.conn.length; i++) {
        if (!net.conn[i] || !net.own[i]) continue;
        if (g.world.type[i] === 1) bridges++; else if (g.world.type[i] === 2) tunnels++;
        for (let d = 0; d < 8; d++) if ((net.conn[i] >> d) & 1) {
          const x = i % g.mapSize + [1, 1, 0, -1, -1, -1, 0, 1][d], z = Math.floor(i / g.mapSize) + [0, 1, 1, 1, 0, -1, -1, -1][d];
          if (net.own[z * g.mapSize + x] !== net.own[i]) touch++;
        }
      }
      const ops = r.rail.projects.filter((p) => p.stage === 'operate');
      return { lines: ops.length, trains: r.trains().length, trips: r.trains().reduce((a, t) => a + t.trips, 0), value: r.value(), money: Math.round(r.money), bridges, tunnels, touch, unused: M.unusedTrack, dup: M.duplicateCorridors, finite: Number.isFinite(r.money), rejected: r.rail.history.filter((h) => h.outcome === 'rejected').length };
    });
    check(tr.finite && tr.touch === 0 && tr.dup === 0 && tr.unused < 0.15 && tr.lines >= 1 && tr.trips > 20,
      `${preset}: ${tr.lines} lines, ${tr.trains} trains, ${tr.trips} trips, ${tr.bridges} bridge and ${tr.tunnels} tunnel tiles, ${(tr.unused * 100).toFixed(0)}% unused, ${tr.rejected} ideas turned down, value ${tr.value}`);
  }
  if (errors.length) { ok = false; lines.push('errors: ' + errors.slice(0, 3).join(' | ')); }
  await ctx.close();
  return { ok, lines };
}
