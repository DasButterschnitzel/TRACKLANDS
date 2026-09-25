// The newspaper (src/world/News.js), the business cycle (Economy.cycleMonth)
// and the world lists: an old save starts with no news and no false "firsts";
// game events become dated items; the cycle changes by the seed and changes
// payments; items and the cycle are saved; the news panel (badge, filter,
// tap to show) and the lists panel (search, tabs, tap to go) with the mouse
// and on a phone.
import { openPage, loadSave, productionSave } from '../lib.mjs';

export const name = 'news';
export async function run({ browser, base }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 1280, height: 800 } });
  await loadSave(page, productionSave());
  const r = await page.evaluate(async () => {
    const g = window.__tracklands.game, N = g.news, E = g.economy, out = {};
    out.start = { items: N.items.length, unread: N.unread, firsts: N.firsts.size };
    g.economy.coins = 1e6;
    // run a while: the existing network must not produce "first service" news
    for (let i = 0; i < 30 * 60; i++) g.tick(1 / 30);
    out.falseFirsts = N.items.filter((it) => it.key === 'news_first_train' || it.key === 'news_first_cargo').map((it) => JSON.stringify(it.p));
    // events become news
    const ind = g.industries.list.find((i) => g.progression.regionUnlocked(i.region) && i.level < 4);
    g.industries.expand(ind);
    const n1 = N.items.length;
    out.lvlNews = N.items.some((it) => it.key === 'news_ind_level' && it.ref && it.ref.id === ind.id);
    const t = g.towns.list.find((x) => g.progression.regionUnlocked(x.region));
    g.events.emit('townLevel', t);
    out.townNews = N.items.some((it) => it.key === 'news_town_stage' && it.ref && it.ref.id === t.id);
    out.unread = N.unread;
    // business cycle: walk months until it changes
    const C = E.cycle;
    const rev0 = E.revenue('GOODS', 10, 20, null, false);
    let changed = null, m = g.ledger.monthIndex();
    for (let k = 0; k < 240 && !changed; k++) {
      g.time = (m + 1) * 60 + 1; m++;
      E.cycleMonth();
      if (C.state !== 'normal') changed = { state: C.state, month: m };
    }
    out.cycle = changed;
    out.revRatio = changed ? Math.round((E.revenue('GOODS', 10, 20, null, false) / rev0) * 1000) / 1000 : 0;
    out.cycleNews = N.items.some((it) => it.key === 'news_cycle_' + (changed && changed.state));
    // deterministic: the same seed, the same month → the same draw
    const S = await import('./src/save/Save.js');
    const d = S.migrate(JSON.parse(JSON.stringify(g.serialize())));
    out.valid = S.validate(d) === null;
    window.__nsave = d;
    out.sig = JSON.stringify({ items: N.items.map((it) => [it.key, it.kind]), cycle: C.state });
    out.n1 = n1;
    return out;
  });
  check(r.start.items === 0 && r.start.firsts > 0, `an old save starts with no news and knows what is already served (${JSON.stringify(r.start)})`);
  check(r.falseFirsts.length === 0, `no false "first service" news for an existing network (${r.falseFirsts.slice(0, 2).join(' ')})`);
  check(r.lvlNews && r.townNews && r.unread >= 2, `industry and town events become news (unread ${r.unread})`);
  check(!!r.cycle && r.cycleNews, `the business cycle changes by the seed: ${JSON.stringify(r.cycle)}`);
  check(r.cycle && Math.abs(r.revRatio - (r.cycle.state === 'boom' ? 1.12 : 0.88)) < 0.005, `the cycle changes payments (×${r.revRatio})`);
  check(r.valid, 'the save validates');
  await loadSave(page, await page.evaluate(() => window.__nsave));
  const back = await page.evaluate(() => { const g = window.__tracklands.game; return JSON.stringify({ items: g.news.items.map((it) => [it.key, it.kind]), cycle: g.economy.cycle.state }); });
  check(back === r.sig, 'news and the cycle are saved');

  // every menu entry is visible without scrolling the rail (1280×800), and at 1366×768
  const railFit = async () => page.evaluate(() => { const r = document.querySelector('#menu-rail'); const tb = document.querySelector('#toolbar').getBoundingClientRect(); const last = [...r.querySelectorAll('.rail-btn')].filter((b) => b.offsetParent).pop().getBoundingClientRect(); return { scroll: r.scrollHeight - r.clientHeight, lastBottom: Math.round(last.bottom), h: innerHeight, toolbarTop: Math.round(tb.top), toolbarLeft: Math.round(tb.left), railRight: Math.round(last.right) }; });
  const f1 = await railFit();
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.waitForTimeout(300);
  const f2 = await railFit();
  await page.setViewportSize({ width: 1280, height: 800 });
  const railOk = (f) => f.scroll <= 1 && f.lastBottom <= f.h && (f.lastBottom <= f.toolbarTop || f.railRight <= f.toolbarLeft);
  check(railOk(f1) && railOk(f2), `the menu rail shows every entry without scrolling or covering the toolbar (${JSON.stringify(f1)} ${JSON.stringify(f2)})`);
  // every tool is in view on the desktop toolbar; the new handbook topics open from their "?" buttons
  const tools = await page.evaluate(() => { const s = document.querySelector('#toolbar .tools'), sr = s.getBoundingClientRect(); return [...s.querySelectorAll('.tool')].filter((b) => { const r = b.getBoundingClientRect(); return r.right > sr.right + 1 || r.left < sr.left - 1; }).map((b) => b.id); });
  check(tools.length === 0, `every tool is in view on the toolbar at 1280×800 (hidden: ${tools.join(', ') || 'none'})`);
  await page.evaluate(() => window.__tracklands.ui.openPanel('finance'));
  await page.waitForTimeout(250);
  await page.click('#panel .fin-head [data-act=help]');
  await page.waitForTimeout(250);
  const hb = await page.evaluate(() => ({ panel: window.__tracklands.ui.panel, topic: window.__tracklands.ui.handbookTopic, n: document.querySelectorAll('#panel .hb-topics .chip').length }));
  check(hb.panel === 'handbook' && hb.topic === 'tycoon' && hb.n === 12, `the finance "?" opens the handbook at the new topic (${JSON.stringify(hb)})`);
  await page.evaluate(() => window.__tracklands.ui.closePanel());
  // news panel with the mouse
  await page.waitForTimeout(400);
  const badge = await page.$eval('#badge-news', (b) => (b.hidden ? '' : b.textContent));
  await page.click('.rail-btn[data-arg=news]');
  await page.waitForTimeout(300);
  const items = await page.$$eval('#panel .fin-row.news', (els) => els.length);
  await page.waitForTimeout(700);
  const badge2 = await page.$eval('#badge-news', (b) => (b.hidden ? '' : b.textContent));
  check(!!badge && items >= 3 && !badge2, `news panel: badge "${badge}" before, ${items} items, badge cleared after opening`);
  await page.click('#panel [data-act=newsFilter][data-arg=industry]');
  await page.waitForTimeout(200);
  const kinds = await page.$$eval('#panel .fin-row.news', (els) => els.length);
  check(kinds >= 1 && kinds < items, `the filter narrows the list (${kinds} of ${items})`);
  await page.click('#panel [data-act=newsFocus]');
  await page.waitForTimeout(300);
  const sel = await page.evaluate(() => { const g = window.__tracklands.game; return { sel: g.selection && g.selection.type, panel: g.ui.panel }; });
  check(sel.sel === 'industry' && !sel.panel, `tapping an item shows it (${JSON.stringify(sel)})`);

  // lists panel: search and tabs
  await page.click('.rail-btn[data-arg=lists]');
  await page.waitForTimeout(300);
  const all = await page.$$eval('#list-body .fin-row', (els) => els.length);
  await page.fill('#panel input.search', 'Green');
  await page.waitForTimeout(200);
  const found = await page.$$eval('#list-body .fin-row', (els) => els.map((e) => e.textContent));
  check(all >= 2 && found.length >= 1 && found.length <= all && found.every((t) => /green/i.test(t)), `search filters the towns (${found.length} of ${all})`);
  await page.fill('#panel input.search', '');
  await page.click('#panel [data-act=listTab][data-arg=industries]');
  await page.waitForTimeout(200);
  const inds = await page.$$eval('#list-body .fin-row', (els) => els.length);
  await page.click('#list-body .fin-row');
  await page.waitForTimeout(300);
  const sel2 = await page.evaluate(() => window.__tracklands.game.selection && window.__tracklands.game.selection.type);
  check(inds >= 3 && sel2 === 'industry', `the industries tab lists ${inds} sites and a click goes there`);
  if (errors.length) { ok = false; lines.push('errors: ' + errors.slice(0, 2).join(' | ')); }
  await ctx.close();

  // phone: open the lists from the menu drawer and search
  const ph = await openPage(browser, base, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await loadSave(ph.page, productionSave());
  await ph.page.tap('.menu-btn');
  await ph.page.waitForTimeout(300);
  await ph.page.tap('.rail-btn[data-arg=lists]');
  await ph.page.waitForTimeout(300);
  await ph.page.tap('#panel input.search');
  await ph.page.keyboard.type('Green');
  await ph.page.waitForTimeout(200);
  const pf = await ph.page.$$eval('#list-body .fin-row', (els) => els.length);
  const fits = await ph.page.evaluate(() => { const p = document.querySelector('#panel'); return p && p.getBoundingClientRect().right <= innerWidth + 1 && document.documentElement.scrollWidth <= innerWidth; });
  check(pf >= 1 && fits, `phone: lists open from the menu, search works (${pf} rows), no overflow`);
  if (ph.errors.length) { ok = false; lines.push('errors: ' + ph.errors.slice(0, 2).join(' | ')); }
  await ph.ctx.close();
  return { ok, lines };
}
