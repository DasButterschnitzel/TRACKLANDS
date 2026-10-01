// Phase 8 save safety: rolling backups (rotation, index, restore data valid),
// the health check (clean production save; money that is not a number and a
// vehicle calling at a removed stop are found), the crash snapshot and the
// notice after it, the settings (autosave interval, backups kept), the
// changelog, and diagnostics without the company's name.
import { openPage, loadSave, productionSave } from '../lib.mjs';

export const name = 'savesafety';
export async function run({ browser, base }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 1280, height: 800 } });
  await loadSave(page, productionSave());
  const r = await page.evaluate(async () => {
    const app = window.__tracklands, g = app.game, B = app.backups, out = {};
    const { healthOfGame } = await import('./src/save/Backups.js');
    // rolling backups: keep 3, oldest overwritten
    for (const k of await B.index()) await B.remove(k.key);
    for (let i = 0; i < 5; i++) { g.economy.coins = 1000 + i; await B.snapshot(g.serialize(), 'manual', 3); await new Promise((res) => setTimeout(res, 5)); }
    const idx = await B.index();
    out.kept = idx.length;
    out.coins = idx.map((e) => e.coins).sort();
    const newest = idx.sort((a, b) => b.savedAt - a.savedAt)[0];
    const d = await B.load(newest.key);
    out.restorable = !!d && Math.round(d.economy.coins) === 1004;
    // fewer allowed: the oldest go
    await B.snapshot(g.serialize(), 'manual', 2);
    out.afterShrink = (await B.index()).length;
    // health: clean, then broken on purpose
    out.clean = healthOfGame(g);
    const coins = g.economy.coins;
    g.economy.coins = NaN;
    const v = g.roads.vehicles[0];
    let restoreStops = null;
    if (v) { restoreStops = v.stops.slice(); v.stops.push(99999); }
    const fake = { id: 99998, name: 'x', kind: 'bus', stops: [99999], color: 0 };
    g.roads.lines.list.push(fake);
    out.broken = healthOfGame(g).issues.map((i) => i.key);
    g.roads.lines.list = g.roads.lines.list.filter((l) => l !== fake);
    g.economy.coins = coins; if (v) v.stops = restoreStops;
    out.hasRoadVeh = !!v;
    // the health report in the settings
    g.ui.openPanel('settings');
    await new Promise((res) => setTimeout(res, 50));
    out.buttons = { backups: !!document.querySelector('[data-act="backups"]'), health: !!document.querySelector('[data-act="saveHealth"]'), autosave: !!document.querySelector('[data-key="autosave"]'), keep: !!document.querySelector('[data-key="backups"]') };
    const sel = document.querySelector('[data-key="autosave"]');
    sel.value = '60'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    out.autosave = app.settings.autosave;
    document.querySelector('[data-act="saveHealth"]').click();
    await new Promise((res) => setTimeout(res, 50));
    out.healthModal = document.body.textContent.includes(g.ui.tr('health_ok'));
    document.querySelectorAll('.modal-wrap').forEach((m) => m.remove());
    // the changelog
    g.ui.closePanel(); g.ui.openPanel('changelog');
    await new Promise((res) => setTimeout(res, 50));
    out.changelog = document.body.textContent.includes('v4.0.0');
    g.ui.closePanel();
    // a crash: one snapshot, then a notice next time
    g.testMode = false; app._crashSaved = false;
    app.crashSnapshot(new Error('boom'));
    await new Promise((res) => setTimeout(res, 100));
    g.testMode = true;
    out.crashSaved = !!(await app.store.get('crash'));
    out.flag = !!localStorage.getItem('tracklands.crash');
    app.crashNotice();
    await new Promise((res) => setTimeout(res, 50));
    out.notice = document.body.textContent.includes(g.ui.tr('crash_title'));
    out.flagCleared = !localStorage.getItem('tracklands.crash');
    document.querySelectorAll('.modal-wrap').forEach((m) => m.remove());
    // the backups list includes the crash snapshot
    await app.backupDialog();
    await new Promise((res) => setTimeout(res, 50));
    out.listRows = document.querySelectorAll('[data-bk]').length;
    out.crashRow = !!document.querySelector('[data-bk="crash"]');
    document.querySelectorAll('.modal-wrap').forEach((m) => m.remove());
    // diagnostics: health and settings, never the company name
    g.company.name = 'Private Name Ltd';
    const diag = app.diagnostics();
    out.diag = { parse: !!JSON.parse(diag), health: JSON.parse(diag).health != null, name: diag.includes('Private Name Ltd') };
    await app.store.remove('crash');
    return out;
  });
  check(r.kept === 3 && r.coins.join() === '1002,1003,1004', `rolling backups keep the newest 3 (${r.coins.join(', ')})`);
  check(r.restorable, 'a backup loads back as a valid save');
  check(r.afterShrink === 2, `keeping fewer drops the oldest (${r.afterShrink})`);
  check(r.clean.ok && r.clean.issues.filter((i) => i.sev === 'bad').length === 0, `the production save is healthy (${JSON.stringify(r.clean.issues)})`);
  check(r.broken.includes('money') && r.broken.includes('line_stops') && (!r.hasRoadVeh || r.broken.includes('vehicle_stops')), `the health check finds problems: ${r.broken.join(', ')}`);
  check(r.buttons.backups && r.buttons.health && r.buttons.autosave && r.buttons.keep && r.autosave === 60, 'settings: backups, health check, autosave interval (60 s), backups kept');
  check(r.healthModal, 'the health report opens');
  check(r.changelog, 'the changelog lists v4.0.0');
  check(r.crashSaved && r.flag && r.notice && r.flagCleared, 'a crash keeps a snapshot and the next start says so, once');
  check(r.listRows >= 2 && r.crashRow, `the backup list offers ${r.listRows} saves to restore, the crash snapshot among them`);
  check(r.diag.parse && r.diag.health && !r.diag.name, 'diagnostics include the health check and never the company name');
  if (errors.length) { ok = false; lines.push('errors: ' + errors.slice(0, 3).join(' | ')); }
  await ctx.close();
  return { ok, lines };
}
