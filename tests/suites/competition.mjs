// Phase 7 competitors: three strategies (intercity coaches, town buses,
// truck freight between industries), rivals paying their own way, going up
// for sale when in debt, being bought by the player (stops and vehicles
// change hands, the price is booked), market shares, the company panel.
import { openPage, loadSave } from '../lib.mjs';

export const name = 'competition';
export async function run({ browser, base }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 1280, height: 800 } });
  await page.evaluate(() => {
    const app = window.__tracklands;
    document.querySelectorAll('.modal-wrap').forEach((m) => m.remove());
    if (app.game) { app.ui.detach(); app.game.dispose(); app.game = null; }
    app.startGame({ seed: 4242, difficulty: 'standard', test: true, paused: true, rivals: 3 });
  });
  await page.waitForFunction(() => window.__tracklands.game && window.__tracklands.game.running, null, { timeout: 60000 });
  const r = await page.evaluate(async () => {
    const g = window.__tracklands.game, R = g.roads, Rv = g.rivals, out = {};
    g.tutorial.skip();
    document.querySelectorAll('.modal-wrap').forEach((m) => m.remove());
    g.settings.weather = false;
    for (let i = 0; i < 8; i++) g.progression.regions.add(i);
    g.progression.level = 20;
    out.strategies = Rv.list.map((x) => x.strategy);
    const coins0 = g.economy.coins;
    // each plans for a few months with money to spend
    for (const x of Rv.list) { x.money = 60000; for (let m = 1; m <= 12 && !x.lines.length; m++) Rv.plan(x, 100 + m); }
    out.lines = Rv.list.map((x) => ({ id: x.id, s: x.strategy, lines: x.lines.map((l) => l.kind + (l.cargo ? ':' + l.cargo : '')), v: x.vehicles().length }));
    for (let i = 0; i < 30 * 150; i++) g.tick(1 / 30);
    out.earned = Rv.list.map((x) => Math.round(x.vehicles().reduce((a, v) => a + v.earned, 0)));
    const fr = Rv.list.find((x) => x.strategy === 'freight');
    out.freightTrips = fr ? fr.vehicles().reduce((a, v) => a + v.trips, 0) : 0;
    out.playerUntouched = Math.round(g.economy.coins - coins0);
    // market share where a rival runs
    const town = g.towns.list.find((t) => R.stops.some((s) => s.owner && s.links && (s.links.towns || []).includes(t.id)));
    out.share = town ? Rv.marketShare(town) : null;
    // in debt for three months: up for sale
    const loser = Rv.list[1];
    loser.money = -500;
    for (let k = 0; k < 3; k++) { loser.money = -500; Rv.month = g.ledger.monthIndex() - 1; Rv.tick(); }
    out.forSale = loser.forSale;
    out.cheap = Rv.acquirePrice(loser) < loser.value() * 1.5;
    // the company panel
    g.ui.closePanel(); g.ui.openPanel('company');
    await new Promise((res) => setTimeout(res, 60));
    out.panel = { buy: document.querySelectorAll('[data-act="rivalBuy"]').length, sale: document.body.textContent.includes(g.ui.tr('rival_for_sale')) };
    g.ui.closePanel();
    // buy the first rival
    const target = Rv.list[0];
    const tid = target.id, vs = target.vehicles().map((v) => v.id), ss = target.stops().map((s) => s.id);
    g.economy.coins = 1e7;
    const c1 = g.economy.coins;
    const res = Rv.acquire(target);
    out.buy = { ok: res.ok, price: res.price, paid: Math.round(c1 - g.economy.coins), gone: !Rv.byId(tid), mine: vs.every((id) => R.byId(id) && !R.byId(id).owner) && ss.every((id) => R.stopById(id) && !R.stopById(id).owner), n: vs.length + ss.length };
    out.booked = (g.ledger.cur.exp.acquisition || 0) > 0 || (g.ledger.cur.inc.sale || 0) > 0;
    // bought vehicles run for the company now
    const e0 = g.ledger.transportRevenue();
    for (let i = 0; i < 30 * 60; i++) g.tick(1 / 30);
    out.after = vs.length ? R.vehicles.filter((v) => vs.includes(v.id)).reduce((a, v) => a + v.trips, 0) : 0;
    out.save = g.serialize();
    out.tid = tid; out.rest = Rv.list.map((x) => x.id);
    return out;
  });
  check(r.strategies.join(',') === 'intercity,local,freight', `three strategies: ${r.strategies.join(', ')}`);
  check(r.lines.every((x) => x.lines.length >= 1 && x.v >= 1), `each rival opens a line: ${r.lines.map((x) => `${x.id} ${x.lines.join('/')} (${x.v})`).join('; ')}`);
  check(r.lines.find((x) => x.s === 'freight').lines.some((l) => l.startsWith('truck:')), 'the freight rival runs trucks between industries');
  check(r.freightTrips >= 2 && r.earned.some((e) => e > 0), `rivals run and earn (${r.earned.join(', ')}; freight stops served ${r.freightTrips})`);
  check(r.playerUntouched === 0, `rivals never touch the player's money (${r.playerUntouched})`);
  check(!!r.share && r.share.tot >= 0 && r.share.by.you != null, `market shares: ${JSON.stringify(r.share && r.share.by)}`);
  check(r.forSale && r.cheap, 'a rival in debt for three months goes up for sale, cheaply');
  check(r.panel.buy >= 1 && r.panel.sale, `the company panel offers takeovers (${r.panel.buy} buttons)`);
  check(r.buy.ok && r.buy.gone && r.buy.mine && r.buy.n > 0 && r.booked, `taking over a rival: price ${r.buy.price}, ${r.buy.n} stops and vehicles change hands`);
  check(r.after > 0, `the bought vehicles serve their stops for the company (${r.after})`);
  await loadSave(page, r.save);
  const l = await page.evaluate(() => window.__tracklands.game.rivals.list.map((x) => x.id + (x.forSale ? '!' : '')));
  check(l.length === r.rest.length && !l.some((id) => id.startsWith(r.tid)) && l.some((id) => id.endsWith('!')), `rivals after loading: ${l.join(', ')}`);
  if (errors.length) { ok = false; lines.push('errors: ' + errors.slice(0, 3).join(' | ')); }
  await ctx.close();
  return { ok, lines };
}
