// Phase 8 manufacturers: every vehicle in the catalogue has a (fictional)
// maker and a generation within that maker's family; the catalogue shows
// them, filters by maker and finds models by maker name.
import { openPage, startTestGame } from '../lib.mjs';

export const name = 'makers';
export async function run({ browser, base }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 1280, height: 800 } });
  await startTestGame(page, 777);
  const r = await page.evaluate(async () => {
    const ui = window.__tracklands.ui, out = {};
    const items = ui.catItems();
    out.n = items.length;
    out.noMaker = items.filter((it) => !it.maker).map((it) => it.key);
    out.makers = [...new Set(items.map((it) => it.maker))];
    const nv = items.filter((it) => it.maker === 'northvale').sort((a, b) => a.era - b.era);
    out.gens = [...new Set(nv.map((it) => it.era + ':' + it.gen))];
    ui.openPanel('collection');
    await new Promise((res) => setTimeout(res, 100));
    out.label = !!document.querySelector('.lc-maker') && document.querySelector('.lc-maker').textContent.length > 3;
    ui.inputs.catMaker({ value: 'skyhaven' });
    await new Promise((res) => setTimeout(res, 50));
    out.filtered = ui.catFiltered().every((it) => it.maker === 'skyhaven') && ui.catFiltered().length > 0;
    ui.inputs.catMaker({ value: '' });
    ui.catState().q = 'voltaris';
    out.search = ui.catFiltered().length > 0 && ui.catFiltered().every((it) => it.maker === 'voltaris');
    ui.catState().q = '';
    ui.closePanel();
    return out;
  });
  check(r.n > 100 && r.noMaker.length === 0, `all ${r.n} models have a maker`);
  check(r.makers.length >= 10, `${r.makers.length} makers: ${r.makers.join(', ')}`);
  check(r.gens.length >= 2 && r.gens[0].endsWith(':I') && r.gens[1].endsWith(':II'), `generations follow the eras within a maker (${r.gens.join(', ')})`);
  check(r.label && r.filtered && r.search, 'the catalogue shows the maker, filters by maker and finds by maker name');
  if (errors.length) { ok = false; lines.push('errors: ' + errors.slice(0, 3).join(' | ')); }
  await ctx.close();
  return { ok, lines };
}
