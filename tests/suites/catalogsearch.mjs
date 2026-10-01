// The vehicle catalogue reads a description (Phase 13): everyday English and
// German fill the catalogue's own filters (mode, duty, power type, era,
// maker, sort order), shown as chips the player can clear; unknown words are
// reported; a name nothing in the lexicon knows falls back to the plain name
// search; every listed vehicle matches the filters; works on a phone.
import { openPage, startTestGame } from '../lib.mjs';

export const name = 'catalogsearch';

const CASES = [
  ['fast electric freight loco from the 60s by Voltaris', { mode: 'rail', role: 'duty_freight', energy: 'electric', maker: 'voltaris', sort: 'speed', year: 1965 }],
  ['schnelle elektrische Güterlok aus den 60ern von Voltaris', { mode: 'rail', role: 'duty_freight', energy: 'electric', maker: 'voltaris', sort: 'speed', year: 1965 }],
  ['cheap diesel regional train', { mode: 'rail', role: 'duty_regional', energy: 'diesel', sort: 'price' }],
  ['günstiger Diesel-Regionalzug', { mode: 'rail', role: 'duty_regional', energy: 'diesel', sort: 'price' }],
  ['fast electric freight loco 1990', { mode: 'rail', role: 'duty_freight', energy: 'electric', sort: 'speed', year: 1990 }],
  ['schnelle Güter-E-Lok aus den 90ern', { mode: 'rail', role: 'duty_freight', energy: 'electric', sort: 'speed', year: 1995 }],
  ['big passenger ship', { mode: 'ship', cargo: 'PASSENGERS', sort: 'cap' }],
  ['Dampflok aus den 1920ern', { mode: 'rail', energy: 'steam', year: 1925 }],
  ['sixties steam engine', { mode: 'rail', energy: 'steam', year: 1965 }],
];

export async function run({ browser, base }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 1200, height: 800 } });
  await startTestGame(page, 2727);
  const r = await page.evaluate(async (CASES) => {
    const app = window.__tracklands, ui = app.ui, { eraOfYear } = await import('./src/world/RailAI.js');
    ui.openPanel('collection');
    const out = [];
    for (const [q, want] of CASES) {
      const c = ui.catApplyNl(q);
      const got = { mode: c.mode, role: c.role, energy: c.energy, maker: c.maker, sort: c.sort, cargo: c.cargo, era: c.era };
      const bad = [];
      for (const k of ['mode', 'role', 'energy', 'maker', 'sort', 'cargo']) if (want[k] != null && got[k] !== want[k]) bad.push(`${k} ${got[k]}≠${want[k]}`);
      if (want.year && got.era !== String(eraOfYear(want.year))) bad.push(`era ${got.era}≠${eraOfYear(want.year)}`);
      // everything listed fits the filters
      const list = ui.catFiltered();
      const fits = list.every((it) => (c.mode === 'all' || it.mode === c.mode) && (!c.role || it.role === c.role) && ui.catEnergyOk(it, c.energy) && (!c.maker || it.maker === c.maker) && (!c.era || it.era === +c.era));
      ui.refreshPanel();
      const chips = document.querySelectorAll('#panel [data-section="catalog-interpretation"] .chip').length;
      out.push({ q, bad, n: list.length, fits, chips, unknown: (c.nl && c.nl.unknown) || [] });
    }
    // nothing known: the plain name search
    const p0 = ui.catApplyNl('Pioneer');
    const namesearch = { q: p0.q, n: ui.catFiltered().length, none: !!(p0.nl && p0.nl.none) };
    // partly known: the unknown word is shown, the known one applied
    const p1 = ui.catApplyNl('fast zorblax');
    const partial = { sort: p1.sort, unknown: p1.nl.unknown.join(',') };
    ui.refreshPanel();
    const shown = /zorblax/.test(document.querySelector('#panel [data-section="catalog-interpretation"]').textContent);
    // clear: every filter back to all
    ui.actions.catClear();
    const s = ui.catState();
    const cleared = s.mode === 'all' && !s.role && !s.energy && !s.maker && !s.era && s.sort === 'level' && !s.nl && !s.q;
    // the power type dropdown exists and filters
    const sel = !!document.querySelector('#panel select[data-change="catEnergy"]');
    ui.closePanel();
    return { out, namesearch, partial, shown, cleared, sel };
  }, CASES);
  for (const x of r.out) check(!x.bad.length && x.fits && x.chips >= 3, `"${x.q}" → ${x.n} vehicles, ${x.chips} chips${x.unknown.length ? `, unknown: ${x.unknown.join(', ')}` : ''}${x.bad.length ? ' — ' + x.bad.join('; ') : ''}${x.fits ? '' : ' — a listed vehicle does not fit'}`);
  check(r.namesearch.none && r.namesearch.q === 'Pioneer' && r.namesearch.n >= 1, `nothing recognised in "Pioneer": the name search finds ${r.namesearch.n}`);
  check(r.partial.sort === 'speed' && r.partial.unknown === 'zorblax' && r.shown, `"fast zorblax": fastest first, "zorblax" reported as not understood`);
  check(r.cleared && r.sel, 'Clear filters resets everything; the power type is a normal dropdown too');

  // a phone: the description field and chips are touch-sized
  const m = await openPage(browser, base, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  await startTestGame(m.page, 2727);
  const ph = await m.page.evaluate(() => {
    const ui = window.__tracklands.ui;
    ui.openPanel('collection'); ui.catApplyNl('schnelle elektrische Güterlok'); ui.refreshPanel();
    const inp = document.querySelector('#panel .cat-nl input'), btn = document.querySelector('#panel [data-act="catClear"]');
    const chip = document.querySelector('#panel [data-section="catalog-interpretation"] .chip');
    const R = (e) => e.getBoundingClientRect();
    return { inp: R(inp).height, clear: R(btn).height, chip: R(chip).height, overflow: document.querySelector('#panel').scrollWidth > window.innerWidth + 1 };
  });
  check(ph.inp >= 40 && ph.clear >= 32 && ph.chip >= 30 && !ph.overflow, `phone: field ${Math.round(ph.inp)} px, clear button ${Math.round(ph.clear)} px, chips ${Math.round(ph.chip)} px, no sideways scroll`);
  await m.ctx.close();
  if (errors.length || m.errors.length) { ok = false; lines.push('errors: ' + [...errors, ...m.errors].slice(0, 3).join(' | ')); }
  await ctx.close();
  return { ok, lines };
}
