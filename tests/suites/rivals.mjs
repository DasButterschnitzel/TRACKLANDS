// Rival companies (src/world/Rivals.js): a rival opens a bus line between
// two towns with its own money, its buses carry and earn for it (never in
// the player's books), its stops cannot be removed or used by the player,
// it is saved, and the company panel ranks it against the player.
import { openPage, loadSave } from '../lib.mjs';

export const name = 'rivals';
export async function run({ browser, base }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 1280, height: 800 } });
  await page.evaluate(() => {
    const app = window.__tracklands;
    document.querySelectorAll('.modal-wrap').forEach((m) => m.remove());
    if (app.game) { app.ui.detach(); app.game.dispose(); app.game = null; }
    app.startGame({ seed: 4242, difficulty: 'standard', test: true, paused: true, rivals: 1 });
  });
  await page.waitForFunction(() => window.__tracklands.game && window.__tracklands.game.running, null, { timeout: 60000 });
  const r = await page.evaluate(async () => {
    const g = window.__tracklands.game, R = g.roads, Rv = g.rivals;
    g.tutorial.skip();
    document.querySelectorAll('.modal-wrap').forEach((m) => m.remove());
    g.settings.weather = false;
    for (let i = 0; i < 8; i++) g.progression.regions.add(i);
    const rival = Rv.list[0];
    const coins0 = g.economy.coins, log0 = g.ledger.log.length;
    let months = 0;
    for (let i = 0; i < 30 * 60 * 14 && !(rival.lines.length && R.vehicles.some((v) => v.owner === rival.id && v.trips >= 3)); i++) { g.tick(1 / 30); months = g.ledger.monthIndex(); }
    for (let i = 0; i < 30 * 120; i++) g.tick(1 / 30);
    const buses = R.vehicles.filter((v) => v.owner === rival.id);
    const stops = R.stops.filter((s) => s.owner === rival.id);
    const out = {
      name: rival.name, lines: rival.lines.length, buses: buses.length, stops: stops.length, trips: buses.reduce((a, v) => a + v.trips, 0), earned: Math.round(buses.reduce((a, v) => a + v.earned, 0)),
      money: Math.round(rival.money), months,
      playerCoins: Math.round(g.economy.coins - coins0), playerLog: g.ledger.log.slice(log0).filter((e) => e.ref && e.ref.type === 'road').length,
      news: g.news.items.some((it) => it.key === 'news_rival_line'),
    };
    // the player may not remove or use a rival stop
    out.remove = stops[0] ? R.removeStop(stops[0]).error : null;
    out.buy = stops[0] ? R.buy('citybus', stops[0]).error : null;
    const S = await import('./src/save/Save.js');
    const d = S.migrate(JSON.parse(JSON.stringify(g.serialize())));
    out.valid = S.validate(d) === null;
    window.__rvsave = d;
    out.sig = JSON.stringify([R.stops.filter((s) => s.owner).map((s) => [s.id, s.owner]), R.vehicles.filter((v) => v.owner).map((v) => [v.id, v.owner]), Math.round(rival.money)]);
    window.__rstop = stops[0] && stops[0].id;
    return out;
  });
  check(r.lines >= 1 && r.stops >= 2 && r.buses >= 1, `${r.name} opens a bus line (${r.lines} lines, ${r.stops} stops, ${r.buses} buses by month ${r.months})`);
  check(r.trips >= 3 && r.earned > 0, `its buses run and earn for it (${r.trips} stops served, ${r.earned} ●; rival cash ${r.money} ●)`);
  check(r.playerCoins === 0 && r.playerLog === 0, `nothing of it touches the player's money or books (${r.playerCoins} ●, ${r.playerLog} lines)`);
  check(r.remove === 'err_rival_stop' && r.buy === 'err_rival_stop', `the player cannot remove or use a rival stop (${r.remove}, ${r.buy})`);
  check(r.news, 'the newspaper reports the new line');
  check(r.valid, 'the save validates');
  await loadSave(page, await page.evaluate(() => window.__rvsave));
  const back = await page.evaluate(() => { const g = window.__tracklands.game, R = g.roads, rv = g.rivals.list[0]; return rv ? JSON.stringify([R.stops.filter((s) => s.owner).map((s) => [s.id, s.owner]), R.vehicles.filter((v) => v.owner).map((v) => [v.id, v.owner]), Math.round(rv.money)]) : null; });
  check(back === r.sig, 'the rival, its stops and buses are saved');
  // the inspector and the company panel
  await page.evaluate((id) => window.__tracklands.game.select({ type: 'roadstop', id }), await page.evaluate(() => window.__rstop));
  await page.waitForTimeout(300);
  const insp = await page.evaluate(() => ({ card: !!document.querySelector('#inspector .card.rival'), buy: !!document.querySelector('#inspector [data-act=rvBuy]'), remove: !!document.querySelector('#inspector [data-act=rvStopRemove]') }));
  check(insp.card && !insp.buy && !insp.remove, `a rival stop opens read-only (${JSON.stringify(insp)})`);
  await page.evaluate(() => window.__tracklands.ui.openPanel('company'));
  await page.waitForTimeout(300);
  const rank = await page.$$eval('#panel .fin-row .rdot', (els) => els.length);
  check(rank === 2, `the company panel ranks the player against the rival (${rank} rows)`);
  if (errors.length) { ok = false; lines.push('errors: ' + errors.slice(0, 2).join(' | ')); }
  await ctx.close();
  return { ok, lines };
}
