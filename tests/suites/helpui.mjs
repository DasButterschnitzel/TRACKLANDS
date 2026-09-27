// Phase 8 help and controls: Ctrl+K opens FIND, which also runs commands
// (open a panel, pick a tool); speeds in km/h or mph everywhere; the haptics
// switch; the handbook covers the newer systems and lists the shortcuts.
import { openPage, loadSave, productionSave } from '../lib.mjs';

export const name = 'helpui';
export async function run({ browser, base }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 1280, height: 800 } });
  await loadSave(page, productionSave());
  // Ctrl+K and a command
  await page.mouse.click(640, 400);
  await page.keyboard.press('Control+k');
  await page.waitForSelector('#find-q', { timeout: 5000 });
  const de = await page.evaluate(() => window.__tracklands.ui.tr('menu_finance'));
  await page.fill('#find-q', de.slice(0, 5));
  await page.waitForTimeout(100);
  const cmd = await page.$('.find-row.cmd[data-arg="panel:finance"]');
  check(!!cmd, `Ctrl+K opens FIND and “${de.slice(0, 5)}” offers the finance command`);
  if (cmd) await cmd.click();
  const panel = await page.evaluate(() => window.__tracklands.ui.panel);
  check(panel === 'finance', `the command opens the panel (${panel})`);
  const tool = await page.evaluate(async () => {
    const u = window.__tracklands.ui, g = window.__tracklands.game;
    u.closePanel(); u.openPanel('search');
    u.searchQuery = u.tr('tool_track'); document.getElementById('find-body').innerHTML = u.searchRows();
    const b = document.querySelector('.find-row.cmd[data-arg="tool:track"]');
    if (b) b.click();
    return g.construction.tool;
  });
  check(tool === 'track', `a tool command picks the tool (${tool})`);
  // units
  const u = await page.evaluate(async () => {
    const app = window.__tracklands, g = app.game, ui = app.ui;
    g.construction.setTool('select');
    const t = g.trains.trains[0];
    g.select({ type: 'train', id: t.id });
    await new Promise((r) => setTimeout(r, 50));
    const km = document.querySelector('#inspector') ? document.querySelector('#inspector').textContent.includes('km/h') : false;
    app.setSetting('units', 'imperial');
    ui.renderInspector();
    await new Promise((r) => setTimeout(r, 50));
    const txt = document.querySelector('#inspector').textContent;
    const out = { km, mph: txt.includes('mph'), noKm: !txt.includes('km/h'), conv: ui.spd(100) };
    app.setSetting('units', 'metric');
    ui.openPanel('settings');
    await new Promise((r) => setTimeout(r, 50));
    out.settings = { units: !!document.querySelector('[data-key="units"]'), haptics: !!document.querySelector('[data-key="haptics"]') };
    ui.closePanel();
    // handbook
    const { HANDBOOK } = await import('./src/ui/Handbook.js');
    out.topics = HANDBOOK.map((h) => h.id);
    ui.handbookTopic = 'shortcuts'; ui.openPanel('handbook');
    await new Promise((r) => setTimeout(r, 50));
    out.shortcuts = document.querySelectorAll('.hb-page li').length;
    out.missing = [];
    for (const h of HANDBOOK) for (let i = 1; i <= h.n; i++) { const k = 'hb_' + h.id + '_' + i; if (ui.tr(k) === k) out.missing.push(k); }
    ui.closePanel();
    return out;
  });
  check(u.km && u.mph && u.noKm && u.conv === '62 mph', `speeds follow the unit setting (100 km/h = ${u.conv})`);
  check(u.settings.units && u.settings.haptics, 'settings: units and haptics');
  check(['roads', 'terminals', 'standing', 'fleetcare', 'saves', 'shortcuts'].every((x) => u.topics.includes(x)) && u.shortcuts === 8, `the handbook covers the newer systems and lists shortcuts (${u.topics.length} topics)`);
  check(!u.missing.length, `every handbook line has a text (${u.missing.slice(0, 3).join(', ')})`);
  if (errors.length) { ok = false; lines.push('errors: ' + errors.slice(0, 3).join(' | ')); }
  await ctx.close();
  return { ok, lines };
}
