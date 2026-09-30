// Accessibility (Phase 14): meaning never by colour alone — every overlay
// class has its own pattern and a legend in words, a light signal shows stop
// and clear at different heights; touch targets are at least 24 px
// everywhere and 32 px in the top bar and tool strip on a phone; Escape
// closes one layer at a time (dialog, popover, panel, tool), also from a text
// field, and a cancelled dialog answers its caller; dialogs are modal
// dialogs and take the focus.
import { openPage, startTestGame, ROOT } from '../lib.mjs';
import fs from 'node:fs';
import path from 'node:path';

export const name = 'access';

export async function run({ browser, base }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 1280, height: 800 } });
  await startTestGame(page, 3030);
  const r = await page.evaluate(async () => {
    const app = window.__tracklands, g = app.game, ui = app.ui, O = await import('./src/ui/Overlays.js'), F = await import('./src/rail/RailFurniture.js');
    const out = { legends: [] };
    // legends: distinct (pattern) per class, words for each, shown while the overlay is on
    for (const [ov, L] of Object.entries(O.OVERLAY_LEGEND)) {
      const pats = L.map((x) => x[1]);
      ui.actions.overlay(ov);
      for (let i = 0; i < 3; i++) g.overlays.update(1);
      const el = document.querySelector('#ov-legend');
      const items = el ? [...el.querySelectorAll('[data-field="legend-item"]')].map((e) => e.textContent.trim()) : [];
      const used = new Set([...g.overlays.pat.slice(0, g.overlays.quads.count)]);
      out.legends.push({ ov, n: L.length, distinct: new Set(pats).size === pats.length, items: items.length, words: items.every((t) => t && !/^[a-z]+_[a-z_]+$/.test(t)), onMap: g.overlays.quads.count, patsOnMap: used.size });
      ui.actions.overlay(ov);
    }
    out.legendGone = !document.querySelector('#ov-legend');
    out.lampY = F.LAMP_Y || null;
    // Escape, one layer at a time
    const esc = (target = document) => target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const tick = () => new Promise((res) => setTimeout(res, 40));
    const E = {};
    g.construction.setTool('track'); ui.openPanel('finance'); ui.actions.overlayMenu();
    const p = ui.confirm('Test?', 'OK'); await tick();
    const dlg = document.querySelector('#modal-root [role="dialog"]');
    E.dialog = !!dlg && dlg.getAttribute('aria-modal') === 'true';
    E.focusIn = !!dlg && dlg.contains(document.activeElement);
    esc(); await tick();
    E.answer = await Promise.race([p, new Promise((res) => setTimeout(() => res('pending'), 500))]);
    E.afterDialog = [!document.querySelector('#modal-root .modal-wrap'), !document.querySelector('#overlay-menu').hidden, ui.panel, g.construction.tool];
    esc(); await tick(); E.afterMenu = [document.querySelector('#overlay-menu').hidden, ui.panel, g.construction.tool];
    esc(); await tick(); E.afterPanel = [ui.panel, g.construction.tool];
    esc(); await tick(); E.afterTool = g.construction.tool;
    // from inside a text field (FIND)
    ui.openPanel('search'); await tick();
    const inp = document.querySelector('#panel input');
    if (inp) { inp.focus(); esc(inp); await tick(); }
    E.fromField = { hadField: !!inp, panel: ui.panel, focusLeft: document.activeElement !== inp };
    out.E = E;
    // an error says what to do: the toast's second line and the build hint
    g.economy.coins = 0;
    ui.error('err_no_money');
    await tick();
    const toast = [...document.querySelectorAll('#toasts .toast.error')].pop();
    out.fix = { toast: !!(toast && toast.querySelector('[data-field="error-fix"]')), text: toast ? toast.textContent.trim() : '' };
    const I = await import('./src/i18n.js');
    const errs = I.keysOf('en').filter((k) => /^err_.*_fix$/.test(k));
    out.fix.orphans = errs.filter((k) => I.rawIn('en', k.replace(/_fix$/, '')) == null);
    out.fix.n = errs.length;
    out.fix.core = ['err_no_money', 'err_no_path', 'err_occupied', 'err_no_depot', 'err_depot_unconnected', 'err_needs_electric', 'err_tier_locked', 'err_train_on_track', 'err_layer_locked', 'err_save_invalid', 'err_permit_denied', 'err_generic'].filter((k) => I.rawIn('en', k + '_fix') == null || I.rawIn('de', k + '_fix') == null);
    out.fix.line = ui.errLine('err_occupied');
    // the advisor explains and never acts: its own run and its panel change nothing
    g.runRailFuzz && g.runRailFuzz(4, 2);
    for (let i = 0; i < 600; i++) g.tick(1 / 30);
    const snap = () => JSON.stringify([g.net.version, Math.round(g.economy.coins), g.trains.trains.length, g.stations.list.length, g.construction.tool, g.works ? g.works.list.length : 0, g.roads.stops.length]);
    const before = snap();
    ui.openPanel('trains');
    for (let i = 0; i < 20; i++) { g.advisor(); g.transport.problems(); ui.actions.trainsTab(i % 2 ? 'problems' : 'overview'); }
    const A = { same: snap() === before, real: g.advisor().map((a) => a.key) };
    const real = g.advisor;
    g.advisor = () => [{ key: 'adv_passing_loop', tile: 5, p: { n: 80, len: 6 } }];
    ui.actions.trainsTab('problems'); ui.refreshPanel(); await tick();
    A.note = !!document.querySelector('#panel [data-field="advisor-note"]');
    const I2 = await import('./src/i18n.js');
    const known = new Set(I2.keysOf('en').filter((k) => /^adv_.*_why$/.test(k)).map((k) => I2.t(k)));
    const whys = [...document.querySelectorAll('#panel [data-field="advice-why"] small')].map((e) => e.textContent);
    A.whyN = whys.length; A.whyKnown = whys.every((w) => known.has(w)); A.why = whys[0] || '';
    g.advisor = real; ui.closePanel();
    // finance → world: a train's row in Finance takes you to the train
    const t0 = g.trains.mine()[0];
    if (t0) { ui.openPanel('finance'); ui.actions.finFocus('train:' + t0.id); }
    A.finJump = !!t0 && ui.panel == null && g.selection && g.selection.type === 'train' && g.selection.id === t0.id;
    // problem → action: every problem in the transport overview can be shown or acted on
    const P = g.transport ? g.transport.problems() : (ui.transport ? ui.transport.problems() : []);
    A.probs = P.length; A.probsActionable = P.every((p) => p.sel || p.tile >= 0 || p.act);
    g.select(null);
    out.A = A;
    return out;
  });
  for (const L of r.legends) check(L.distinct && L.items === L.n && L.words, `${L.ov}: ${L.n} classes, each with its own pattern and a word in the legend${L.onMap ? ` (${L.onMap} tiles, ${L.patsOnMap} patterns on the map)` : ''}`);
  check(r.legendGone, 'the legend goes with the overlay');
  check(r.lampY && r.lampY.stop !== r.lampY.clear, `light signals: stop and clear at different heights (${r.lampY && r.lampY.stop} / ${r.lampY && r.lampY.clear}), not colour alone`);
  const E = r.E;
  check(E.dialog && E.focusIn, 'a dialog is a modal dialog and takes the focus');
  check(E.answer === false, `Escape on a question answers "no" to its caller (${E.answer})`);
  check(E.afterDialog[0] && E.afterDialog[1] && E.afterDialog[2] === 'finance' && E.afterDialog[3] === 'track', 'Escape 1: only the dialog closes');
  check(E.afterMenu[0] && E.afterMenu[1] === 'finance' && E.afterMenu[2] === 'track', 'Escape 2: the overlay menu closes, the panel stays');
  check(E.afterPanel[0] == null && E.afterPanel[1] === 'track', 'Escape 3: the panel closes, the tool stays');
  check(E.afterTool === 'select', 'Escape 4: back to the select tool');
  check(r.fix.toast && r.fix.n >= 40 && !r.fix.orphans.length && !r.fix.core.length && / → /.test(r.fix.line), `errors say what to do: ${r.fix.n} "what to do" texts in both languages, shown under the error (“${r.fix.text}”) and after the build hint (“${r.fix.line}”)${r.fix.core.length ? '; missing ' + r.fix.core.join(', ') : ''}${r.fix.orphans.length ? '; orphans ' + r.fix.orphans.join(', ') : ''}`);
  // every advice the code can give has its "why" in both languages
  const srcKeys = new Set();
  for (const f of ['src/Game.js', 'src/rail/Stations.js']) for (const m of fs.readFileSync(path.join(ROOT, f), 'utf8').matchAll(/key: '(adv_[a-z_]+)'/g)) srcKeys.add(m[1]);
  const I = await import(path.join(ROOT, 'src/i18n.js'));
  const noWhy = [...srcKeys].filter((k) => I.rawIn('en', k + '_why') == null || I.rawIn('de', k + '_why') == null);
  check(srcKeys.size >= 10 && !noWhy.length, `the advisor explains its measure for all ${srcKeys.size} kinds of advice (“Why?”)${noWhy.length ? ': missing ' + noWhy.join(', ') : ''}`);
  check(r.A.same && r.A.note && r.A.whyN > 0 && r.A.whyKnown, `the advisor only points out (${r.A.real.length} advice now; state unchanged ${r.A.same}; note ${r.A.note}; ${r.A.whyN} whys, known ${r.A.whyKnown}) and shows why: “${r.A.why.slice(0, 80)}…”`);
  check(r.A.finJump, 'Finance → world: a train in the finance list opens that train in the world');
  check(r.A.probsActionable, `problem → action: all ${r.A.probs} problems in the transport overview can be shown on the map or acted on`);
  check(E.fromField.hadField && E.fromField.panel == null && E.fromField.focusLeft, 'Escape in the FIND field leaves the field and closes FIND');

  // touch targets on a phone
  const m = await openPage(browser, base, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  await startTestGame(m.page, 3030);
  const t = await m.page.evaluate(async () => {
    const ui = window.__tracklands.ui;
    // the target: the element, or the label around it
    const size = (e) => { const lab = e.closest('label'); const b = (lab || e).getBoundingClientRect(); return { w: b.width, h: b.height }; };
    const scan = (root) => [...document.querySelectorAll(`${root} button, ${root} [role=button], ${root} input:not([type=hidden]), ${root} select`)]
      .filter((e) => e.offsetParent && e.getBoundingClientRect().width > 2)
      .map((e) => ({ ...size(e), t: (e.getAttribute('aria-label') || e.textContent || e.name || e.type || '').trim().slice(0, 20), root }));
    const small = [], chrome = [];
    for (const x of [...scan('#topbar'), ...scan('#toolbar')]) if (Math.round(x.w) < 32 || Math.round(x.h) < 32) chrome.push(x);
    let n = 0;
    for (const p of ['finance', 'trains', 'settings', 'collection', 'search', 'research', 'lists']) {
      ui.openPanel(p); await new Promise((res) => setTimeout(res, 60));
      for (const x of scan('#panel')) { n++; if (Math.round(x.w) < 24 || Math.round(x.h) < 24) small.push({ ...x, p }); }
    }
    ui.closePanel();
    return { n, small: small.slice(0, 8), nSmall: small.length, chrome };
  });
  check(!t.chrome.length, `phone: every top bar and tool strip control at least 32 px${t.chrome.length ? ': ' + t.chrome.map((x) => `${x.t} ${Math.round(x.w)}×${Math.round(x.h)}`).join(', ') : ''}`);
  check(!t.nSmall, `phone: ${t.n} controls in seven panels, none below 24 px${t.nSmall ? ` (${t.nSmall}): ` + t.small.map((x) => `${x.p}/${x.t} ${Math.round(x.w)}×${Math.round(x.h)}`).join(', ') : ''}`);
  await m.ctx.close();
  if (errors.length || m.errors.length) { ok = false; lines.push('errors: ' + [...errors, ...m.errors].slice(0, 3).join(' | ')); }
  await ctx.close();
  return { ok, lines };
}
