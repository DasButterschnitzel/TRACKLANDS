// Investing in industries (src/world/Industries.js): buying and selling
// stakes, monthly dividends, the majority production bonus, funding an
// expansion, founding a new site, all booked in the ledger; save/load of
// stakes and founded sites; the investment buttons and the industry tool with
// real mouse input.
import { openPage, loadSave, productionSave } from '../lib.mjs';

export const name = 'industry';
export async function run({ browser, base }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 1280, height: 800 } });
  await loadSave(page, productionSave());
  const r = await page.evaluate(async () => {
    const g = window.__tracklands.game, I = g.industries, L = g.ledger, out = {};
    out.noStakes = I.list.every((i) => !i.stake);
    g.economy.coins = 2e6;
    // a producing site in an open region
    const ind = I.list.filter((i) => g.progression.regionUnlocked(i.region) && i.level < 3).sort((a, b) => b.produced - a.produced)[0];
    out.ind = I.displayName(ind);
    // buy a quarter
    const c0 = g.economy.coins, cost = I.stakeCost(ind);
    const b = I.buyStake(ind);
    out.buy = { ok: !!b.ok, paid: Math.round(c0 - g.economy.coins), cost, stake: ind.stake, booked: L.log.some((e) => e.cat === 'shares' && e.ref && e.ref.type === 'industry' && e.ref.id === ind.id && e.amt === -cost) };
    out.buyNotPL = L.thisMonth().exp === L.profitOf({ inc: L.cur.inc, exp: Object.fromEntries(Object.entries(L.cur.exp).filter(([k]) => k !== 'shares')) }).exp;
    out.value = L.companyValue().shares;
    // majority: +10 % production
    const r1 = I.rate(ind);
    I.buyStake(ind);
    out.bonus = Math.round((I.rate(ind) / r1) * 100) / 100;
    // two month ends: dividends
    const m0 = L.monthIndex();
    let n = 0;
    while (L.monthIndex() < m0 + 2 && n < 30 * 200) { g.tick(1 / 30); n++; }
    const div = L.log.filter((e) => e.cat === 'dividend' && e.ref && e.ref.id === ind.id);
    out.div = { n: div.length, amt: div.map((e) => e.amt), lastPv: ind.lastPv, est: I.dividendEstimate(ind), fin: L.objFin(ind).lifeRev };
    // sell a quarter
    const c1 = g.economy.coins, sale = I.stakeSale(ind);
    I.sellStake(ind);
    out.sell = { got: Math.round(g.economy.coins - c1), sale, stake: ind.stake };
    // fund an expansion
    const lv = ind.level, ec = I.expandCost(ind), c2 = g.economy.coins;
    const e = I.expand(ind);
    out.expand = { ok: !!e.ok, from: lv, to: ind.level, paid: Math.round(c2 - g.economy.coins), cost: ec, booked: L.log.some((x) => x.cat === 'industry_fund' && x.ref && x.ref.id === ind.id) };
    for (let i = 0; i < 300; i++) g.tick(1 / 30);
    out.expandKept = ind.level === lv + 1;
    // found a new site
    const type = I.foundTypes()[0];
    let tile = -1;
    for (let z = 2; z < 60 && tile < 0; z++) for (let x = 2; x < 60 && tile < 0; x++) if (!I.foundError(z * 64 + x, type)) tile = z * 64 + x;
    out.foundTile = tile;
    if (tile >= 0) {
      const count = I.list.length, fc = I.foundCost(type), c3 = g.economy.coins;
      const f = I.found(tile, type);
      out.found = { ok: !!f.ok, count: I.list.length - count, paid: Math.round(c3 - g.economy.coins), cost: fc, stake: f.ind && f.ind.stake, blocked: g.occupancy.blocked[tile] === 2, again: I.foundError(tile, type), visual: !!(f.ind && f.ind.obj) };
      window.__fid = f.ind.id;
      window.__ftile = tile;
      f.ind.stake = 0.75;
    }
    // save / load
    const S = await import('./src/save/Save.js');
    const d = S.migrate(JSON.parse(JSON.stringify(g.serialize())));
    out.valid = S.validate(d) === null;
    window.__isave = d;
    out.sig = JSON.stringify(I.list.map((i) => [i.id, i.x, i.z, i.level, i.stake]));
    return out;
  });
  check(r.noStakes, 'the production save loads with no stakes');
  check(r.buy.ok && r.buy.paid === r.buy.cost && r.buy.stake === 0.25 && r.buy.booked, `buying a quarter of ${r.ind} costs ${r.buy.cost} ● and is booked with the industry: ${JSON.stringify(r.buy)}`);
  check(r.buyNotPL, 'a stake purchase is not an expense in profit and loss');
  check(r.value > 0, `company value includes the stake (${r.value} ●)`);
  check(r.bonus === 1.1, `a 50 % stake runs the site: production ×${r.bonus}`);
  check(r.div.n >= 1 && r.div.amt.every((a) => a > 0) && r.div.fin > 0, `dividends paid at month end and booked with the industry: ${JSON.stringify(r.div)}`);
  check(r.sell.got === r.sell.sale && r.sell.stake === 0.25, `selling a quarter pays ${r.sell.sale} ●: ${JSON.stringify(r.sell)}`);
  check(r.expand.ok && r.expand.to === r.expand.from + 1 && r.expand.paid === r.expand.cost && r.expand.booked && r.expandKept, `funding an expansion raises the level at once: ${JSON.stringify(r.expand)}`);
  check(r.foundTile >= 0 && r.found && r.found.ok && r.found.count === 1 && r.found.paid === r.found.cost && r.found.stake === 0.25 && r.found.blocked && r.found.again && r.found.visual, `founding a new site: ${JSON.stringify(r.found)}`);
  check(r.valid, 'the save validates');
  const keep = await page.evaluate(() => window.__isave);
  await loadSave(page, keep);
  const back = await page.evaluate(() => {
    const g = window.__tracklands.game, I = g.industries;
    const f = I.byId(window.__fid);
    return { sig: JSON.stringify(I.list.map((i) => [i.id, i.x, i.z, i.level, i.stake])), blocked: g.occupancy.blocked[window.__ftile] === 2, visual: !!(f && f.obj), linked: f ? g.stations.list.filter((s) => s.links.industries.includes(f.id)).length : -1 };
  });
  check(back.sig === r.sig && back.blocked && back.visual, `after reload the stakes, levels and the founded site are the same (${JSON.stringify({ blocked: back.blocked, visual: back.visual })})`);

  // the buttons and the tool with the mouse
  const ui = await page.evaluate(() => {
    const g = window.__tracklands.game, I = g.industries;
    g.economy.coins = 2e6;
    const ind = I.list.find((i) => g.progression.regionUnlocked(i.region) && !i.stake && i.id !== window.__fid);
    g.select({ type: 'industry', id: ind.id });
    return { id: ind.id };
  });
  await page.waitForTimeout(300);
  const btn = await page.$('#inspector [data-act=indBuy]:not([disabled])');
  if (btn) { await btn.scrollIntoViewIfNeeded(); await btn.click(); await page.waitForTimeout(250); }
  const bought = await page.evaluate((id) => window.__tracklands.game.industries.byId(id).stake, ui.id);
  check(!!btn && bought === 0.25, `the industry panel buys a stake with a click (stake ${bought})`);
  const exp = await page.$('#inspector [data-act=indExpand]:not([disabled])');
  const lv0 = await page.evaluate((id) => window.__tracklands.game.industries.byId(id).level, ui.id);
  if (exp) { await exp.scrollIntoViewIfNeeded(); await exp.click(); await page.waitForTimeout(250); }
  const lv1 = await page.evaluate((id) => window.__tracklands.game.industries.byId(id).level, ui.id);
  check(!!exp && lv1 === lv0 + 1, `the industry panel funds an expansion (${lv0} → ${lv1})`);
  await page.keyboard.press('Escape');
  const spot = await page.evaluate(() => {
    const g = window.__tracklands.game, I = g.industries;
    const type = I.foundTypes()[0];
    for (let z = 4; z < 58; z++) for (let x = 4; x < 58; x++) {
      const t = z * 64 + x;
      if (!I.foundError(t, type)) { window.__focus = [(x + 0.5) * 2, (z + 0.5) * 2]; g.camera.focus(window.__focus[0], window.__focus[1], 18); return { t, n: I.list.length }; }
    }
    return null;
  });
  if (spot) {
    await page.waitForFunction(() => { const t = window.__tracklands.game.camera.target, f = window.__focus; return Math.abs(t.x - f[0]) + Math.abs(t.z - f[1]) < 0.15; }, null, { polling: 100, timeout: 30000 });
    const p = await page.evaluate((tt) => { const g = window.__tracklands.game, cam = g.camera.camera; const x = ((tt % 64) + 0.5) * 2, z = (Math.floor(tt / 64) + 0.5) * 2; const v = new cam.position.constructor(x, g.world.view.heightAt(x, z), z).project(cam); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; }, spot.t);
    await page.click('#tool-industry');
    await page.waitForTimeout(150);
    const chips = await page.$$eval('#subbar [data-act=fundType]', (els) => els.length);
    await page.mouse.move(p[0], p[1]);
    await page.waitForTimeout(100);
    await page.mouse.click(p[0], p[1]);
    await page.waitForTimeout(300);
    const res = await page.evaluate((n) => { const g = window.__tracklands.game; return { added: g.industries.list.length - n, sel: g.selection && g.selection.type, tool: g.construction.tool }; }, spot.n);
    check(chips >= 1 && res.added === 1 && res.sel === 'industry', `the industry tool founds a site with a click (${chips} kinds, ${JSON.stringify(res)})`);
  } else check(false, 'no free site for the tool test');
  // the finance panel lists the stakes
  await page.evaluate(() => { const u = window.__tracklands.game.ui; u.finTab = 'invest'; u.openPanel('finance'); });
  await page.waitForTimeout(300);
  const rows = await page.$$eval('#panel .fin-row[data-arg^="industry:"]', (els) => els.length);
  check(rows >= 2, `the finance panel lists the stakes (${rows})`);
  if (errors.length) { ok = false; lines.push('errors: ' + errors.slice(0, 2).join(' | ')); }
  await ctx.close();
  return { ok, lines };
}
