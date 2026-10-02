// Phone without mouse or keyboard (Android): no keyboard shortcuts anywhere in
// the interface; the tutorial card never covers the build bar (Build /
// Cancel) while a build tool is active; the settings panel stays open when
// Android's Back gesture cuts off a slider drag, and Back on the title screen
// closes an open panel. A desktop keeps its shortcut hints.
import { openPage } from '../lib.mjs';

export const name = 'mobile';

const KEY_HINT = /\((?:[A-Z0-9]|F\d{1,2}|Esc|Ctrl\+[A-Z]|Strg\+[A-Z])\)|\bF\d{1,2}\b|Strg\+|Ctrl\+|\bEsc\b|Leertaste|\bSpace\b|W \/ S/;
const PHONE = { viewport: { width: 412, height: 860 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, locale: 'de-DE' };

// every text and tooltip a player can see on the page now
const visibleTexts = (page) => page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') continue;
    if (el.dataset && el.dataset.tip) out.push(el.dataset.tip);
    if (!el.children.length && el.textContent.trim()) out.push(el.textContent.trim());
  }
  return out;
});

export async function run({ browser, base }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  const { ctx, page, errors } = await openPage(browser, base, PHONE);
  try {
    await page.waitForFunction(() => window.__tracklands && window.__tracklands.title, null, { timeout: 60000 });
    // Back on the title screen closes the settings panel first
    await page.evaluate(() => window.__tracklands.ui.openPanel('settings'));
    const tb = await page.evaluate(() => ({ back: window.__tracklands.nativeBack(), panel: window.__tracklands.ui.panel }));
    check(tb.back === true && tb.panel === null, `title: Back closes the open settings panel (${JSON.stringify(tb)})`);
    // a Start Journey game with the tutorial
    await page.evaluate(() => { document.querySelector('#title [data-t=quick]').click(); });
    await page.waitForFunction(() => window.__tracklands.game && window.__tracklands.game.running, null, { timeout: 120000 });
    await page.waitForTimeout(800);
    const kb = await page.evaluate(() => window.__tracklands.ui.keyboard());
    check(kb === false, 'a phone without mouse counts as "no keyboard"');
    // tooltips of the tool bars, the settings, the handbook: no shortcuts
    const hits = new Set();
    const scan = async (where) => { for (const s of await visibleTexts(page)) if (KEY_HINT.test(s)) hits.add(where + ': ' + s.slice(0, 80)); };
    await scan('game');
    for (const tool of ['track', 'station', 'blueprint']) { await page.evaluate((t) => window.__tracklands.game.construction.setTool(t), tool); await page.waitForTimeout(150); await scan('tool ' + tool); }
    await page.evaluate(() => window.__tracklands.game.construction.setTool('select'));
    await page.evaluate(() => window.__tracklands.ui.openPanel('settings')); await page.waitForTimeout(200); await scan('settings');
    const topics = await page.evaluate(() => window.__tracklands.ui.hbTopics().map((h) => h.id));
    for (const id of topics) { await page.evaluate((id) => { const u = window.__tracklands.ui; u.handbookTopic = id; u.openPanel('handbook'); u.refreshPanel(); }, id); await scan('handbook ' + id); }
    check(!topics.includes('shortcuts'), `the handbook has no keyboard shortcut page on a phone (${topics.length} topics)`);
    check(hits.size === 0, `no keyboard shortcuts in tooltips, settings, build bars or the handbook${hits.size ? ': ' + [...hits].slice(0, 4).join(' | ') : ''}`);
    await page.evaluate(() => window.__tracklands.ui.closePanel());
    // the tutorial card and the build bar
    const lay = await page.evaluate(async () => {
      const g = window.__tracklands.game, out = {};
      for (const tool of ['station', 'track', 'depot']) {
        g.construction.setTool(tool);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const tut = document.getElementById('tutorial'), bar = document.getElementById('subbar');
        const tv = tut && !tut.hidden && getComputedStyle(tut).display !== 'none';
        const a = tv ? tut.getBoundingClientRect() : null, b = bar.getBoundingClientRect();
        const btn = bar.querySelector('.bb-go') || bar;
        const r = btn.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        out[tool] = { tutorial: !!tv, overlap: !!a && a.bottom > b.top && a.top < b.bottom && a.right > b.left && a.left < b.right, barReachable: !!hit && bar.contains(hit) };
      }
      g.construction.setTool('select');
      return out;
    });
    check(Object.values(lay).every((x) => x.tutorial), `the tutorial card is shown during the test (${Object.keys(lay).join(', ')})`);
    check(Object.values(lay).every((x) => !x.overlap && x.barReachable), `while building (station, track, depot) the tutorial card leaves the build bar free and tappable (${JSON.stringify(lay)})`);
    // Back gesture that cuts off a slider drag in the settings: panel stays
    await page.evaluate(() => window.__tracklands.ui.openPanel('settings'));
    const bs = await page.evaluate(() => {
      const r = document.querySelector('#panel input[type=range]');
      r.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerType: 'touch' }));
      const first = window.__tracklands.nativeBack();
      const p1 = window.__tracklands.ui.panel;
      return { first, p1 };
    });
    check(bs.first === true && bs.p1 === 'settings', `a Back gesture that interrupts a slider leaves the settings open (${JSON.stringify(bs)})`);
    await page.waitForTimeout(900);
    const later = await page.evaluate(() => ({ back: window.__tracklands.nativeBack(), panel: window.__tracklands.ui.panel }));
    check(later.back === true && later.panel === null, `a deliberate Back afterwards still closes the settings (${JSON.stringify(later)})`);
    await page.evaluate(() => window.__tracklands.ui.openPanel('settings')); await page.waitForTimeout(200);
    const edge = await page.evaluate(() => { const x = document.querySelector('#panel input[type=range]').getBoundingClientRect(); return x.width ? Math.round(innerWidth - x.right) : -1; });
    check(edge >= 24, `volume sliders end ${edge} px before the right screen edge (Android's Back gesture zone)`);
    check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.slice(0, 2).join(' | ') : ''}`);
  } catch (e) { ok = false; lines.push('EXCEPTION ' + (e.stack || e.message).split('\n').slice(0, 3).join(' ')); }
  await ctx.close();
  // a desktop keeps its hints
  const d = await openPage(browser, base, { viewport: { width: 1280, height: 800 } });
  try {
    await d.page.waitForFunction(() => window.__tracklands && window.__tracklands.title, null, { timeout: 60000 });
    await d.page.evaluate(() => document.querySelector('#title [data-t=quick]').click());
    await d.page.waitForFunction(() => window.__tracklands.game && window.__tracklands.game.running, null, { timeout: 120000 });
    const tip = await d.page.evaluate(() => (document.querySelector('#tool-track') || {}).dataset.tip || '');
    check(/\(2\)/.test(tip), `desktop: tool tooltips keep their key ("${tip}")`);
  } catch (e) { ok = false; lines.push('EXCEPTION desktop ' + e.message.split('\n')[0]); }
  await d.ctx.close();
  return { ok, lines };
}
