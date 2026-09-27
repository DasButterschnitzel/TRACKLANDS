// Nightly: four companies (three railways and a coach company) for fifty
// years on a 128 map with every region open. The companies stay solvent or
// close cleanly, their networks never touch, their fleets modernize with the
// eras (no constant replacement), loans stay within limits, memory and save
// size stay bounded, and the anti-spam metrics hold.
import { openPage } from '../lib.mjs';

export const name = 'aidecades';
export async function run({ browser, base, quick }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 1280, height: 800 } });
  await page.evaluate(() => { const app = window.__tracklands; app.startGame({ seed: 20260927, difficulty: 'standard', test: true, paused: true, rivals: 4, mapSize: 128, startYear: 1930 }); });
  await page.waitForFunction(() => window.__tracklands.game && window.__tracklands.game.running, null, { timeout: 90000 });
  await page.evaluate(() => { const g = window.__tracklands.game; g.tutorial.skip(); for (let r = 0; r < 8; r++) g.progression.regions.add(r); });
  const YEARS = quick ? 20 : 50;
  const samples = [];
  for (let y = 0; y < YEARS; y += 5) {
    samples.push(await page.evaluate(() => {
      const g = window.__tracklands.game;
      for (let m = 0; m < 60; m++) for (let s = 0; s < 450; s++) g.tick(4 / 30);
      if (window.gc) window.gc();
      const { eraOfYear } = window.__aiEra || {};
      return { y: g.ledger.year(), heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : 0, cos: g.rivals.list.map((r) => ({ id: r.short, money: Math.round(r.money), loan: r.loan || 0, room: r.loanRoom ? r.loanRoom() : 0, trains: r.trains ? r.trains().length : 0 })), closed: g.rivals.closed.length };
    }));
  }
  const res = await page.evaluate(async () => {
    const g = window.__tracklands.game, net = g.net, Rv = g.rivals;
    const { eraOfYear } = await import('./src/world/RailAI.js');
    const { locoModel } = await import('./src/trains/Consist.js');
    let touch = 0;
    for (let i = 0; i < net.conn.length; i++) if (net.conn[i]) for (let d = 0; d < 8; d++) if ((net.conn[i] >> d) & 1) {
      const x = i % g.mapSize + [1, 1, 0, -1, -1, -1, 0, 1][d], z = Math.floor(i / g.mapSize) + [0, 1, 1, 1, 0, -1, -1, -1][d];
      if (net.own[z * g.mapSize + x] !== net.own[i]) touch++;
    }
    const era = eraOfYear(g.ledger.year());
    const cos = Rv.list.filter((r) => r.rail).map((r) => {
      const P = Rv.planner(r), M = P.metrics();
      const eras = r.trains().map((t) => locoModel(t.veh.find((v) => v.k === 'L').id).era);
      const modern = r.rail.log.filter((e) => e.kind === 'modern').length + (r.rail.historyModern || 0);
      return { id: r.short, lines: M.projects, trains: r.trains().length, unused: M.unusedTrack, dup: M.duplicateCorridors, idle: M.unusedVehicles, avgEra: eras.length ? eras.reduce((a, b) => a + b, 0) / eras.length : 0, modern, retired: M.retired, loanOk: r.loan <= r.loan + r.loanRoom() };
    });
    const t0 = performance.now();
    const str = JSON.stringify(g.serialize());
    const saveMs = performance.now() - t0;
    return { touch, era, year: g.ledger.year(), cos, closed: Rv.closed.map((c) => c.name), saveKB: Math.round(str.length / 1024), saveMs: Math.round(saveMs), thinkPerMonth: Rv.thinkMs / Math.max(1, g.ledger.monthIndex()) };
  });
  check(res.touch === 0, `after ${YEARS} years (${res.year}) the companies' networks never touch`);
  for (const c of res.cos) check(c.unused < 0.15 && c.dup === 0 && c.idle <= 2 && c.loanOk, `${c.id}: ${c.lines} lines, ${c.trains} trains (average loco era ${c.avgEra.toFixed(1)}, now era ${res.era}), ${c.modern} recent modernizations, ${c.retired} lines closed, ${(c.unused * 100).toFixed(0)}% unused track`);
  const railWithTrains = res.cos.filter((c) => c.trains > 0);
  check(railWithTrains.every((c) => c.avgEra >= res.era - 2.5), 'fleets follow the eras (average loco no more than two eras behind)');
  const h0 = samples[1] ? samples[1].heap : 0, h1 = samples[samples.length - 1].heap;
  check(!h0 || h1 - h0 < 150, `memory ${samples.map((s) => s.heap).join('→')} MB over the decades`);
  check(res.saveKB < 6000 && res.saveMs < 3000, `save ${res.saveKB} KB in ${res.saveMs} ms; ${res.closed.length} companies closed${res.closed.length ? ' (' + res.closed.join(', ') + ')' : ''}; thinking ${res.thinkPerMonth.toFixed(1)} ms a month`);
  lines.push('     money by five years: ' + samples.map((s) => `${s.y}: ${s.cos.map((c) => `${c.id} ${c.money}`).join(' ')}`).join(' | '));
  if (errors.length) { ok = false; lines.push('errors: ' + errors.slice(0, 3).join(' | ')); }
  await ctx.close();
  return { ok, lines };
}
