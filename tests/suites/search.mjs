// FIND understands everyday words, offline (Phase 13): an English and a
// German corpus of what players type, each expected to list the right
// command among the first three results in either interface language;
// typos within one or two letters; named towns and stations still come
// first; a query never carries anything out; normalisation (accents,
// hyphens, ß) behaves the same everywhere.
import { openPage, startTestGame } from '../lib.mjs';

export const name = 'search';

const EN = [
  ['money', 'panel:finance'], ['cash', 'panel:finance'], ['demolish', 'tool:bulldoze'], ['bus stop', 'tool:roadstop'],
  ['traffic jam', 'overlay:congestion'], ['vehicle catalogue', 'panel:collection'], ['send train to depot', 'panel:trains'],
  ['metro map', 'metromap:'], ['blueprint', 'panel:plans'], ['subway', 'metro:1'], ['underground', 'metro:1'],
  ['four track', 'trackmode:pair'], ['express tracks', 'trackmode:pair'], ['planning mode', 'planmode:1'],
];
const DE = [
  ['Geld', 'panel:finance'], ['Kasse', 'panel:finance'], ['abreißen', 'tool:bulldoze'], ['Bushaltestelle', 'tool:roadstop'],
  ['Stau', 'overlay:congestion'], ['Fahrzeugkatalog', 'panel:collection'], ['Zug ins Depot', 'panel:trains'],
  ['U-Bahn-Karte', 'metromap:'], ['Blaupause', 'panel:plans'], ['U-Bahn', 'metro:1'], ['Metro', 'metro:1'],
  ['viergleisig', 'trackmode:pair'], ['zweites Gleispaar', 'trackmode:pair'], ['Planungsmodus', 'planmode:1'],
];
const TYPOS = [['finannzen', 'panel:finance'], ['vehcle catalogue', 'panel:collection'], ['bahnof', 'tool:station'], ['blaupase', 'panel:plans']];

export async function run({ browser, base }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 1100, height: 760 } });
  await startTestGame(page, 1313);

  for (const lang of ['en', 'de']) {
    const r = await page.evaluate(async ([lang, corpus, typos]) => {
      const app = window.__tracklands, ui = app.ui, g = app.game;
      app.setSetting('lang', lang);
      const tool0 = g.construction.tool, coins0 = g.economy.coins, panel0 = ui.panel;
      const top = (q) => ui.searchResults(q).slice(0, 3).map((x) => (x.cmd ? x.cmd.act + ':' + x.cmd.arg : x.kind));
      const miss = [];
      for (const [q, want] of corpus) { const t = top(q); if (!t.includes(want)) miss.push(`${q} → ${t.join(', ') || 'nothing'}`); }
      const typoMiss = [];
      for (const [q, want] of typos) { const t = top(q); if (!t.includes(want)) typoMiss.push(`${q} → ${t.join(', ') || 'nothing'}`); }
      // nonsense finds nothing absurd; a town's own name comes first
      const junk = ui.searchResults('qqqzzz').length;
      const town = g.towns.list.find((t) => g.progression.regionUnlocked(t.region));
      const first = ui.searchResults(town.name)[0];
      // typing a query changes nothing in the game
      ui.openPanel('search'); ui.searchQuery = lang === 'de' ? 'abreißen' : 'demolish'; ui.refreshPanel();
      const same = g.construction.tool === tool0 && g.economy.coins === coins0;
      const rows = document.querySelectorAll('#find-body .find-row').length;
      const kinds = [...document.querySelectorAll('#find-body .find-row small')].slice(0, 3).map((e) => e.textContent.trim());
      ui.closePanel();
      return { lang: document.documentElement.lang, findTitle: ui.tr('settings'), n: corpus.length, miss, typoMiss, junk, townFirst: first && first.kind === 'town' && first.name === town.name, same, rows, kinds, panel0 };
    }, [lang, lang === 'en' ? [...EN, ...DE] : [...DE, ...EN], TYPOS]);
    // (a bug found once: the language setting did not switch the interface)
    check(r.lang === lang, `${lang.toUpperCase()} interface really active (html lang ${r.lang}, “settings” reads “${r.findTitle}”)`);
    check(!r.miss.length, `${lang.toUpperCase()} interface: ${r.n - r.miss.length}/${r.n} everyday queries (English and German) list the right command in the top three${r.miss.length ? ': ' + r.miss.join(' · ') : ''}`);
    check(!r.typoMiss.length, `${lang.toUpperCase()}: typos found (${TYPOS.map((t) => t[0]).join(', ')})${r.typoMiss.length ? ': ' + r.typoMiss.join(' · ') : ''}`);
    check(r.junk === 0 && r.townFirst, `${lang.toUpperCase()}: nonsense finds nothing; a town's name finds the town first`);
    check(r.same && r.rows > 0 && r.kinds.length > 0, `${lang.toUpperCase()}: a query only lists (${r.rows} rows, kinds ${r.kinds.join(' / ')}); nothing is carried out`);
  }
  // choosing a result: the metro command opens the track tool on the tunnel level with the underground view
  const m = await page.evaluate(async () => {
    const app = window.__tracklands, ui = app.ui, g = app.game, C = await import('./src/config.js');
    for (const r of C.RESEARCH) g.progression.research.add(r.id);
    g.progression.recomputeFx && g.progression.recomputeFx();
    ui.actions.findCmd('metro:1');
    const a = { tool: g.construction.tool, layer: g.construction.layer, under: g.layerView.showsUnderground() };
    ui.actions.findCmd('trackmode:pair');
    a.mode = g.construction.trackMode;
    ui.actions.findCmd('metromap:');
    a.map = ui.panel === 'map' && ui.mapFilter === 'metro';
    ui.closePanel(); g.construction.setTool('select'); g.construction.trackMode = 'double'; g.construction.setLayer(0); while (g.layerView.showsUnderground()) g.layerView.cycle();
    return a;
  });
  check(m.tool === 'track' && m.layer === 1 && m.under && m.mode === 'pair' && m.map, `chosen results: metro → track tool on layer ${m.layer} with the underground view; four tracks → ${m.mode}; metro map → map panel filtered to the metro`);
  // normalisation is plain JavaScript (the same in every engine)
  const nrm = await page.evaluate(async () => { const T = await import('./src/ui/ToolsUI.js'); return [T.norm('U-Bahn-Karte'), T.norm('Straße'), T.norm('ABREIẞEN'), T.norm('Bahnhöfe'), T.stem('stations'), T.stem('bahnhoefe'), T.editDistance('bahnof', 'bahnhof')]; });
  check(nrm.join('|') === 'u bahn karte|strasse|abreissen|bahnhofe|station|bahnhoef|1', `normalisation: ${nrm.join(' | ')}`);
  await page.evaluate(() => window.__tracklands.setSetting('lang', 'en'));
  if (errors.length) { ok = false; lines.push('errors: ' + errors.slice(0, 3).join(' | ')); }
  await ctx.close();
  return { ok, lines };
}
