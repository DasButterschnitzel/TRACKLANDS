// UI screenshot regression across the responsive matrix, with automatic
// layout checks: no horizontal page overflow, HUD bars inside the viewport,
// panels/inspectors inside the viewport, touch target size on touch devices,
// and no missing translations. Screenshots go to tests/output/ui/.
import { openPage, loadSave, productionSave, ensureOut, devices } from '../lib.mjs';
import path from 'path';
import fs from 'fs';

const SCREENS = [
  ['main', () => {}],
  ['trains', () => window.__tracklands.ui.openPanel('trains')],
  ['builder', () => window.__tracklands.ui.openBuilder({ trainId: 3 })],
  ['research', () => { const u = window.__tracklands.ui; u.closePanel(); u.openPanel('research'); }],
  ['contracts', () => { const u = window.__tracklands.ui; u.closePanel(); u.openPanel('contracts'); }],
  ['map', () => { const u = window.__tracklands.ui; u.closePanel(); u.openPanel('map'); }],
  ['settings', () => { const u = window.__tracklands.ui; u.closePanel(); u.openPanel('settings'); }],
  ['station', () => { const u = window.__tracklands.ui, g = window.__tracklands.game; u.closePanel(); g.select({ type: 'station', id: 7 }); g.focusOn({ type: 'station', id: 7 }, 14); }],
  ['train', () => { const g = window.__tracklands.game; g.select({ type: 'train', id: 4 }); g.focusOn({ type: 'train', id: 4 }, 12); }],
  ['industry', () => { const g = window.__tracklands.game; const i = g.industries.list.find((x) => g.industries.linkedStations(x).length) || g.industries.list[0]; g.select({ type: 'industry', id: i.id }); g.focusOn({ type: 'industry', id: i.id }, 14); }],
  ['town', () => { const g = window.__tracklands.game; const t = g.towns.list.reduce((a, b) => (b.stage > a.stage ? b : a)); g.select({ type: 'town', id: t.id }); g.focusOn({ type: 'town', id: t.id }, 16); }],
  // passenger lines: two timetabled trains sharing a stop, so the station
  // shows service frequency, destinations and connections with a change
  ['pax', () => {
    const g = window.__tracklands.game, S = g.stations;
    const px = S.list.filter((s) => S.accepts(s, 'PASSENGERS'));
    if (px.length >= 3 && !g._uiPax) {
      g._uiPax = true;
      const mk = (t, a, b) => { t.mode = 'manual'; t.route = [a, b].map((s) => ({ st: s.id, act: 'auto', dwell: 0, full: false, skip: false, plat: null, cargo: null })); t.routeIdx = 0; };
      // only stations the network actually connects (the save has separate networks)
      const reach = (a, b) => !!g.net.findRoute({ tile: a.tile, heading: null, fromCenter: true }, b.tile, { allowReverse: true });
      let pair = null;
      for (const a of px) for (const b of px) if (!pair && a !== b && reach(a, b) && reach(b, a)) pair = [a, b];
      const [a, b] = pair || px;
      mk(g.trains.trains[2], a, b); mk(g.trains.trains[1], b, a); g.trains.trains[1].spacing = -1; g.trains.trains[2].spacing = -1;
      for (let i = 0; i < 30 * 240; i++) g.tick(1 / 30);
      g._uiPaxStn = b.id;
    }
    const id = g._uiPaxStn || (px[0] && px[0].id) || 7;
    g.select({ type: 'station', id }); g.focusOn({ type: 'station', id }, 14);
  }],
  ['lines', () => { const u = window.__tracklands.ui, g = window.__tracklands.game; g.select(null); u.closePanel(); u.trainsTab = 'lines'; u.openPanel('trains'); }],
  ['fleet', () => { const u = window.__tracklands.ui; u.trainsTab = 'fleet'; u.refreshPanel(); }],
  ['netmap', () => { const u = window.__tracklands.ui; u.trainsTab = 'trains'; u.closePanel(); u.mapMode = 'lines'; u.openPanel('map'); }],
  ['overlay', () => { window.__tracklands.ui.closePanel(); const g = window.__tracklands.game; g.select(null); g.overlays.set('routes'); }],
  ['handbook', () => { const u = window.__tracklands.ui; u.closePanel(); u.handbookTopic = 'signals'; u.openPanel('handbook'); }],
  ['signal-tool', () => { const g = window.__tracklands.game; g.overlays.set(null); window.__tracklands.ui.closePanel(); g.construction.setTool('signal'); }],
  ['blocks', () => { const g = window.__tracklands.game; g.construction.setTool('select'); g.overlays.set('blocks'); }],
  ['night-rain', () => { const g = window.__tracklands.game; g.overlays.set(null); g.env.timeOfDay = 0.95; g.env.weather = g.env.weatherTarget = 'rain'; }],
];

async function matrix() {
  const d = await devices();
  return [
    ['1920x1080', { viewport: { width: 1920, height: 1080 } }],
    ['2560x1440', { viewport: { width: 2560, height: 1440 } }],
    ['3440x1440', { viewport: { width: 3440, height: 1440 } }],
    ['1366x768', { viewport: { width: 1366, height: 768 } }],
    ['1280x800', { viewport: { width: 1280, height: 800 } }],
    ['tablet-landscape', { ...d['iPad (gen 7) landscape'] }],
    ['tablet-portrait', { ...d['iPad (gen 7)'] }],
    ['phone-landscape', { ...d['Pixel 7 landscape'] }],
    ['phone-portrait', { ...d['Pixel 7'], locale: 'de-DE' }],
    ['small-phone', { ...d['iPhone SE'] }],
  ];
}

const layoutCheck = () => {
  const W = innerWidth, H = innerHeight, probs = [];
  if (document.documentElement.scrollWidth > W + 1) probs.push(`page overflows horizontally (${document.documentElement.scrollWidth} > ${W})`);
  const inView = (sel, label) => {
    const e = document.querySelector(sel);
    if (!e || e.hidden || getComputedStyle(e).display === 'none') return;
    const b = e.getBoundingClientRect();
    if (b.width === 0 || b.height === 0) return;
    if (b.left < -1 || b.top < -1 || b.right > W + 1 || b.bottom > H + 1) probs.push(`${label} outside viewport (${Math.round(b.left)},${Math.round(b.top)} ${Math.round(b.width)}x${Math.round(b.height)})`);
  };
  inView('#topbar', 'top bar');
  for (const c of document.querySelectorAll('#topbar > *')) if (!c.classList.contains('spacer')) inView(`#topbar > ${c.id ? '#' + c.id : '.' + [...c.classList].join('.')}`, 'top bar ' + (c.id || c.className));
  inView('#toolbar', 'toolbar'); inView('#panel.open', 'panel'); inView('#inspector:not([hidden])', 'inspector');
  // children of the toolbar must be reachable (inside viewport or in a scroll container)
  const tb = document.querySelector('#toolbar');
  if (tb) for (const btn of tb.querySelectorAll('button')) {
    const b = btn.getBoundingClientRect();
    if (b.width === 0) continue;
    let sc = btn.parentElement;
    while (sc && sc !== document.body && !/(auto|scroll)/.test(getComputedStyle(sc).overflowX)) sc = sc.parentElement;
    const scrollable = sc && sc !== document.body && sc.scrollWidth > sc.clientWidth + 1;
    const r = scrollable ? sc.getBoundingClientRect() : { left: 0, right: W };
    const hidden = b.right > r.right + 1 || b.left < r.left - 1;
    if (hidden && !scrollable) probs.push('toolbar button clipped: ' + (btn.id || btn.dataset.act || ''));
    else if (hidden && !sc.classList.contains(b.left < r.left ? 'more-l' : 'more-r')) probs.push('scrollable toolbar without edge hint: ' + (btn.id || ''));
    if (matchMedia('(pointer: coarse)').matches && (b.width < 36 || b.height < 36)) probs.push(`small touch target ${Math.round(b.width)}x${Math.round(b.height)}: ` + (btn.id || btn.dataset.act || ''));
  }
  // an open side panel must not cover toolbar buttons (on phones the panel
  // is a bottom sheet and replaces the toolbar on purpose)
  // (only the visible part of a button counts: tools scrolled out of the strip are clipped)
  const visible = (btn) => {
    let b = btn.getBoundingClientRect();
    for (let sc = btn.parentElement; sc && sc !== document.body; sc = sc.parentElement) {
      const cs = getComputedStyle(sc);
      if (!/(auto|scroll|hidden)/.test(cs.overflowX + cs.overflowY)) continue;
      const r = sc.getBoundingClientRect();
      b = { left: Math.max(b.left, r.left), right: Math.min(b.right, r.right), top: Math.max(b.top, r.top), bottom: Math.min(b.bottom, r.bottom) };
    }
    return b.right - b.left > 2 && b.bottom - b.top > 2 ? b : null;
  };
  const hit = (a, p) => a.right > p.left + 2 && a.left < p.right - 2 && a.bottom > p.top + 2 && a.top < p.bottom - 2;
  const pn = document.querySelector('#panel.open');
  if (pn && tb && W > 760) {
    const p = pn.getBoundingClientRect();
    for (const btn of tb.querySelectorAll('button')) { const b = visible(btn); if (b && hit(b, p)) { probs.push('toolbar button under the panel: ' + (btn.id || btn.dataset.act || '')); break; } }
  }
  // the menu rail and the toolbar must not overlap
  const rail = document.querySelector('#menu-rail');
  if (rail && tb && getComputedStyle(rail).display !== 'none') {
    const tbs = [...tb.querySelectorAll('button')].map(visible).filter(Boolean);
    for (const rb of rail.querySelectorAll('.rail-btn')) { const r = visible(rb); if (r && r.left >= 0 && tbs.some((b) => hit(b, r))) { probs.push('menu rail overlaps the toolbar: ' + rb.dataset.arg); break; } }
  }
  return [...new Set(probs)].slice(0, 6);
};

export const name = 'ui';
export async function run({ browser, base, quick, args = {} }) {
  const dir = path.join(ensureOut(), 'ui');
  fs.mkdirSync(dir, { recursive: true });
  const save = productionSave();
  const lines = [];
  let ok = true;
  const list = await matrix();
  // --viewports=1366x768,tablet-portrait picks viewports; --quick: one desktop + one phone
  const pick = args.viewports ? String(args.viewports).split(',') : quick ? ['1280x800', 'phone-portrait'] : null;
  for (const [label, ctxOpts] of pick ? list.filter(([l]) => pick.includes(l)) : list) {
    const { ctx, page, errors } = await openPage(browser, base, ctxOpts);
    await loadSave(page, save, { paused: false });
    await page.evaluate(() => { const g = window.__tracklands.game; g.speed = 0; for (let i = 0; i < 30 * 30; i++) g.tick(1 / 30); g.speed = 1; });
    const probs = new Set();
    for (const [screen, fn] of SCREENS) {
      await page.evaluate(fn);
      await page.waitForTimeout(700);
      await page.screenshot({ path: path.join(dir, `${label}-${screen}.png`) });
      for (const p of await page.evaluate(layoutCheck)) probs.add(`${screen}: ${p}`);
    }
    // touch: a tap just beside a world label (touch adjustment snaps it onto
    // the label) must reach the world at the finger position, not the label
    if (ctxOpts.hasTouch) {
      await page.evaluate(() => { const g = window.__tracklands.game; g.select(null); g.ui.closePanel && g.ui.closePanel(); g.speed = 0; g.ui.toast = () => {}; document.querySelector('#toasts').innerHTML = ''; g.ui.updateLabels(); g.ui.updateLabels = () => {}; document.querySelectorAll('#labels .wlabel').forEach((el) => el.classList.remove('pulse')); window.__taps = []; const o = g.input.tap.bind(g.input); g.input.tap = (x, y) => { window.__taps.push([x, y]); return o(x, y); }; });
      await page.waitForTimeout(300);
      const at = await page.evaluate(() => { for (const el of document.querySelectorAll('#labels .wlabel')) { const r = el.getBoundingClientRect(); if (!r.width || r.top < 120 || r.bottom > innerHeight - 160) continue; for (const dy of [6, 9, 12]) { const x = r.left + r.width / 2, y = r.bottom + dy, e = document.elementFromPoint(x, y); if (e && e.id === 'view') return [x, y, el.dataset.key]; } } return null; });
      if (at) {
        await page.touchscreen.tap(at[0], at[1]); await page.waitForTimeout(400);
        const taps = await page.evaluate(() => window.__taps);
        if (!taps.some(([x, y]) => Math.hypot(x - at[0], y - at[1]) < 3)) probs.add(`touch: tap beside a label at ${at.slice(0, 2).map(Math.round)} (${at[2]}) did not reach the world; under the finger now: ${await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e ? e.id || e.className : '-'; }, at)}`);
      }
    }
    const miss = await page.evaluate(async () => { const m = await import('./src/i18n.js'); return [...m.missing]; });
    const bad = probs.size || miss.length || errors.length;
    if (bad) ok = false;
    lines.push(`${bad ? 'FAIL' : 'ok  '} ${label}${probs.size ? ' — ' + [...probs].slice(0, 8).join('; ') : ''}${miss.length ? ' — missing i18n: ' + miss.slice(0, 8).join(',') : ''}${errors.length ? ' — errors: ' + errors.slice(0, 2).join(' | ') : ''}`);
    await ctx.close();
  }
  lines.push(`screenshots: ${path.relative(process.cwd(), dir)}`);
  return { ok, lines };
}
