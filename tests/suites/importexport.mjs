// Import/export through the real UI: import the production TRKL1 export
// (legacy v2 -> v3 with pre_v3 backup), malformed text, cancel, export -> import.
import { openPage, fixtureText } from '../lib.mjs';

export const name = 'import';
export async function run({ browser, base }) {
  const { ctx, page, errors } = await openPage(browser, base);
  const lines = [];
  let ok = true;
  const check = (cond, msg) => { lines.push((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) ok = false; };
  const openImport = async () => {
    await page.evaluate(() => { const u = window.__tracklands.ui; if (u.panel !== 'settings') document.querySelector('[data-t=settings]').click(); });
    await page.waitForTimeout(300); await page.click('[data-act=importSave]'); await page.waitForTimeout(300);
  };

  // malformed text: readable error, nothing loaded
  await openImport();
  await page.fill('.modal textarea', 'TRKL1:not-a-save');
  await page.click('.modal [data-mbtn=go]'); await page.waitForTimeout(400);
  const bad = await page.evaluate(() => ({ game: !!window.__tracklands.game, toast: [...document.querySelectorAll('#toasts *')].map((e) => e.textContent).join(' ') }));
  check(!bad.game && /invalid|ungültig|damaged|beschädigt|save/i.test(bad.toast), 'malformed import shows an error and loads nothing: ' + bad.toast.slice(0, 80));
  // cancel at the confirmation: nothing loaded
  await page.fill('.modal textarea', fixtureText());
  await page.click('.modal [data-mbtn=go]'); await page.waitForTimeout(400);
  await page.click('.modal-wrap:last-child [data-mbtn=no]'); await page.waitForTimeout(300);
  check(!(await page.evaluate(() => !!window.__tracklands.game)), 'cancel at the overwrite confirmation leaves the current state untouched');
  await page.evaluate(() => document.querySelectorAll('.modal-wrap').forEach((m) => m.remove()));

  // real import
  await openImport();
  await page.fill('.modal textarea', fixtureText());
  await page.click('.modal [data-mbtn=go]'); await page.waitForTimeout(400);
  await page.click('.modal [data-mbtn=yes]');
  await page.waitForFunction(() => window.__tracklands.game && window.__tracklands.game.running, null, { timeout: 60000 });
  const imp = await page.evaluate(async () => { const g = window.__tracklands.game; const pre = await window.__tracklands.store.get('pre_v3'); return { v: g.serialize().saveVersion, trains: g.trains.trains.map((t) => t.name).join(','), backup: pre ? pre.saveVersion : null, coins: Math.round(g.economy.coins) }; });
  check(imp.v === 3 && imp.trains === 'Pioneer 1,Atlas 1,Atlas 2', `imported and migrated to v${imp.v}: ${imp.trains}`);
  check(imp.backup === 2, 'untouched v2 original kept as pre_v3 backup');

  // export -> import round trip of the current game
  const exported = await page.evaluate(async () => { const S = await import('./src/save/Save.js'); return S.exportText(window.__tracklands.game.serialize()); });
  const back = await page.evaluate(async (txt) => { const S = await import('./src/save/Save.js'); const d = S.migrate(S.importText(txt)); return d && !S.validate(d) ? d.trains.length : -1; }, exported);
  check(exported.startsWith('TRKL1:') && back === 3, 'export produces a TRKL1 string that imports again');

  // persistence across reload: title offers Continue
  await page.reload(); await page.waitForTimeout(2500);
  const cont = await page.evaluate(() => !!document.querySelector('[data-t=continue]'));
  check(cont, 'after reload the title screen offers Continue');
  if (errors.length) { ok = false; lines.push('page errors: ' + errors.slice(0, 3).join(' | ')); }
  await ctx.close();
  return { ok, lines };
}
