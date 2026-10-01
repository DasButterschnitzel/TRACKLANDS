// Release security (Phase 15): names written by the player or carried in an
// imported save, blueprint, scenario or content pack never become markup —
// the characters that open a tag or leave an attribute are dropped where the
// text comes in; nothing in a hostile save runs script in any panel or
// inspector; oversized or malformed imports are refused.
import { openPage, loadSave, productionSave } from '../lib.mjs';

export const name = 'security';
const P = '<img src=x onerror="window.__xss=(window.__xss||0)+1">"\'`';

// put the payload into every name-like string of an object
function poison(o, d = 0) {
  if (!o || typeof o !== 'object' || d > 12) return;
  for (const k of Object.keys(o)) {
    if (typeof o[k] === 'string' && /(^|_)(name|title|label)s?$/i.test(k)) o[k] = P + o[k];
    else if (o[k] && typeof o[k] === 'object') poison(o[k], d + 1);
  }
}

export async function run({ browser, base }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  const raw = productionSave();
  poison(raw);
  const { ctx, page, errors } = await openPage(browser, base);
  await loadSave(page, raw);
  const r = await page.evaluate(async () => {
    const app = window.__tracklands, g = app.game, ui = app.ui;
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const names = [g.company.name, ...g.trains.trains.map((t) => t.name), ...g.stations.list.map((s) => s.name), ...g.towns.list.map((t) => t.name)];
    for (const p of ['trains', 'company', 'finance', 'objectives', 'map', 'research', 'stats', 'lists', 'search', 'collection', 'settings']) { try { ui.closePanel(); ui.openPanel(p); await sleep(120); } catch (e) { /* not every panel in every game */ } }
    ui.closePanel();
    for (const [type, id] of [['train', g.trains.trains[0].id], ['station', g.stations.list[0].id], ['town', g.towns.list[0].id], ['depot', g.stations.depots[0] && g.stations.depots[0].id]]) { if (id == null) continue; g.select({ type, id }); await sleep(300); }
    g.select(null);
    // a prompt (every rename goes through it) hands back clean text
    const pr = ui.prompt('x', '');
    const inp = document.querySelector('.modal-wrap input.inp'); inp.value = 'Rail <b>"one"</b>';
    document.querySelector('.modal-wrap [data-mbtn=yes]').click();
    const prompted = await pr;
    // blueprint and scenario imports
    const bp = g.blueprints.importJSON(JSON.stringify({ tracklandsBlueprint: 1, blueprint: { name: 'X<script>"', runs: [[0, 0, 4, 0, 0]], stations: [], depots: [], signals: [] } }));
    const Sc = await import('./src/world/Scenarios.js');
    const sc = Sc.cleanScenario({ id: 'custom_x', name: 'S<img>"', seed: 1, mapSize: 64, difficulty: 'standard', startYear: 1950, deadline: 1970, money: 0, goals: [{ k: 'towns', n: 2 }] });
    const Sv = await import('./src/save/Save.js');
    const big = Sv.importText('{' + ' '.repeat(Sv.MAX_IMPORT + 10) + '}');
    const bad = Sv.importText('TRKL1:%%%not-base64');
    return { xss: window.__xss || 0, imgs: document.querySelectorAll('img[src="x"]').length, dirty: names.filter((n) => /[<>"`]/.test(n)).length, n: names.length, prompted, bp: bp.bp ? bp.bp.name : bp.error, sc: sc && sc.name, big, bad };
  });
  check(r.dirty === 0 && r.n > 10, `${r.n} names from a hostile save hold no markup characters`);
  check(r.xss === 0 && r.imgs === 0, `no script ran and no injected element exists after 11 panels and 4 inspectors (${r.xss} runs, ${r.imgs} elements)`);
  check(r.prompted === 'Rail bone/b', `a rename prompt hands back clean text ("${r.prompted}")`);
  check(typeof r.bp === 'string' && !/[<>"]/.test(r.bp), `an imported blueprint's name is cleaned ("${r.bp}")`);
  check(typeof r.sc === 'string' && !/[<>"]/.test(r.sc), `an imported scenario's name is cleaned ("${r.sc}")`);
  check(r.big === null && r.bad === null, 'an oversized import and a malformed TRKL1 text are refused');
  const errs = errors.filter((e) => !/404/.test(e));
  if (errs.length) { ok = false; lines.push('errors: ' + errs.slice(0, 3).join(' | ')); }
  await ctx.close();
  return { ok, lines };
}
