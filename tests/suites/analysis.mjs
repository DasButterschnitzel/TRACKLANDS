// Phase 7 finance analysis: divisions, services, towns, cargo revenue (the
// sum matches the ledger's transport revenue), cash flow (operating +
// investing + financing = the month's net cash change), vehicle returns, the
// ANALYSIS tab and the profit overlay; cargo revenue is saved with the months.
import { openPage, loadSave, productionSave } from '../lib.mjs';

export const name = 'analysis';
export async function run({ browser, base }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 1280, height: 800 } });
  await loadSave(page, productionSave());
  const r = await page.evaluate(async () => {
    const g = window.__tracklands.game, A = g.analytics, L = g.ledger, out = {};
    // run into a fresh month and through it
    const m0 = L.monthIndex();
    while (L.monthIndex() === m0) g.tick(1 / 30);
    const cash0 = g.economy.coins;
    const m1 = L.monthIndex();
    while (L.monthIndex() === m1) g.tick(1 / 30);
    const last = L.months[L.months.length - 1];
    out.cashDelta = Math.round(g.economy.coins - cash0);
    const cf = A.cashFlow(last);
    out.cf = cf;
    out.transport = (last.inc.pax || 0) + (last.inc.mail || 0) + (last.inc.freight || 0);
    out.cargoSum = Object.values(last.cargo || {}).reduce((a, b) => a + b, 0);
    out.cargo = A.cargo().slice(0, 3);
    out.div = A.divisions().map((d) => ({ id: d.id, n: d.n, last: Math.round(d.last) }));
    out.svc = A.services().length;
    out.towns = A.towns().length;
    const R = A.returns(3);
    out.ret = { n: R.n, best: R.best.length, roi: R.best[0] ? R.best[0].roi : null };
    // the ANALYSIS tab
    g.ui.closePanel(); g.ui.finTab = 'analysis'; g.ui.openPanel('finance');
    await new Promise((res) => setTimeout(res, 60));
    const txt = document.body.textContent;
    out.tab = txt.includes(g.ui.tr('an_divisions')) && txt.includes(g.ui.tr('an_cashflow')) && txt.includes(g.ui.tr('an_cargo'));
    g.ui.closePanel();
    // the profit overlay
    g.overlays.set('profit');
    g.tick(1 / 30); g.overlays.update && g.overlays.update(1);
    out.overlay = { mode: g.overlays.mode, quads: g.overlays.quads.count };
    g.overlays.set('profit');
    out.save = g.serialize();
    out.lastM = last.m;
    return out;
  });
  check(r.div.length >= 1 && r.div[0].n > 0, `divisions: ${r.div.map((d) => `${d.id} ×${d.n} ${d.last}`).join(', ')}`);
  check(r.svc >= 1 && r.towns >= 1, `services ${r.svc}, towns ${r.towns}`);
  check(r.transport > 0 && Math.abs(r.cargoSum - r.transport) <= Math.max(3, r.transport * 0.01), `revenue by cargo adds up to transport revenue (${r.cargoSum} vs ${r.transport}): ${r.cargo.map((c) => c.c + ' ' + c.last).join(', ')}`);
  check(Math.abs(r.cf.net - r.cashDelta) <= Math.max(5, Math.abs(r.cashDelta) * 0.02), `cash flow: operating ${Math.round(r.cf.operating)} + investing ${Math.round(r.cf.investing)} + financing ${Math.round(r.cf.financing)} = ${Math.round(r.cf.net)} (cash moved ${r.cashDelta})`);
  check(r.ret.n > 0 && r.ret.best > 0 && r.ret.roi != null, `vehicle returns: ${r.ret.n} vehicles, best ${Math.round((r.ret.roi || 0) * 100)} %`);
  check(r.tab, 'the finance panel has the ANALYSIS tab');
  check(r.overlay.mode === 'profit' && r.overlay.quads > 0, `the profit overlay colours ${r.overlay.quads} tiles`);
  await loadSave(page, r.save);
  const l = await page.evaluate((m) => { const L = window.__tracklands.game.ledger; const p = L.months.find((x) => x.m === m); return p ? Object.keys(p.cargo || {}).length : -1; }, r.lastM);
  check(l > 0, `cargo revenue is saved with the month (${l} cargos)`);
  if (errors.length) { ok = false; lines.push('errors: ' + errors.slice(0, 3).join(' | ')); }
  await ctx.close();
  return { ok, lines };
}
