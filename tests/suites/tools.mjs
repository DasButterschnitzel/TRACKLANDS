// Phase 7 tools: FIND (press F, type, pick a result: selected and in view),
// bookmarks (add, jump, delete, saved), the sandbox tools of builder games
// (money, regions, level, weather, town event, authority) and their absence
// in normal games; the 8× button with real clicks.
import { openPage, startTestGame, loadSave } from '../lib.mjs';

export const name = 'tools';
export async function run({ browser, base }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 1280, height: 800 } });
  await startTestGame(page, 777);
  const town = await page.evaluate(() => { const g = window.__tracklands.game; for (let i = 0; i < 8; i++) g.progression.regions.add(i); const t = g.towns.list.slice().sort((a, b) => b.pop - a.pop)[0]; return { id: t.id, name: t.name }; });
  // F opens FIND; typing filters; a click selects and focuses
  await page.mouse.click(640, 400);
  await page.keyboard.press('f');
  await page.waitForSelector('#find-q', { timeout: 5000 });
  await page.fill('#find-q', town.name.slice(0, 4));
  await page.waitForTimeout(100);
  const rows = await page.$$eval('.find-row', (els) => els.map((e) => e.textContent));
  check(rows.some((t) => t.includes(town.name)), `FIND lists ${town.name} for “${town.name.slice(0, 4)}” (${rows.length} results)`);
  await page.click(`.find-row[data-arg="town:${town.id}"]`);
  // the camera clears its goal once it arrives, which a fast machine can do
  // before the next check; so wait for the camera to be at the town instead
  const at = await page.waitForFunction((id) => { const g = window.__tracklands.game, p = g.entityPos({ type: 'town', id }), c = g.camera; const goal = c.focusGoal || c.target; const d = Math.hypot(goal.x - p.x, goal.z - p.z); return d < 1 ? { d } : false; }, town.id, { timeout: 5000, polling: 50 }).then(async (h) => (await h.jsonValue()).d).catch(() => null);
  const sel = await page.evaluate(() => window.__tracklands.game.selection);
  check(sel && sel.type === 'town' && sel.id === town.id && at !== null, `picking a result selects it and moves the camera there (${at === null ? 'camera not at the town' : 'camera ' + at.toFixed(1) + ' from the town centre'})`);
  // bookmarks
  const bm = await page.evaluate(async () => {
    const g = window.__tracklands.game, u = g.ui;
    g.camera.target.set(30, 0, 40);
    u.closePanel(); u.openPanel('search');
    document.querySelector('[data-act="bmAdd"]').click();
    await new Promise((r) => setTimeout(r, 30));
    const b = g.bookmarks[0];
    g.camera.target.set(90, 0, 90); g.camera.focusGoal = null;
    document.querySelector('[data-act="bmGo"]').click();
    const goal = g.camera.focusGoal ? [Math.round(g.camera.focusGoal.x), Math.round(g.camera.focusGoal.z)] : null;
    u.actions.bmAdd();
    return { n: g.bookmarks.length, name: b.name, goal, save: g.serialize() };
  });
  check(bm.n === 2 && bm.goal && bm.goal[0] === 30 && bm.goal[1] === 40, `bookmarks: “${bm.name}”, jumping back to (${bm.goal})`);
  // sandbox tools in a builder game
  const sb = await page.evaluate(async () => {
    const g = window.__tracklands.game, u = g.ui;
    const c0 = g.economy.coins, l0 = g.progression.level;
    u.actions.sbMoney(1000000); u.actions.sbLevel(5);
    u.inputs.sbWeather({ value: 'storm' });
    u.actions.sbEvent();
    const t = g.towns.list[0];
    g.authority.ensure(t).rating = 0;
    const before = g.authority.allowed(t, 'demolish');
    u.inputs.sbAuthority({ checked: true });
    const after = g.authority.allowed(t, 'demolish');
    u.closePanel(); u.openPanel('search');
    await new Promise((r) => setTimeout(r, 30));
    return { money: g.economy.coins - c0, level: g.progression.level - l0, weather: g.env.weather, events: g.urban.events.length, before, after, block: !!document.querySelector('[data-act="sbMoney"]') };
  });
  check(sb.money === 1000000 && sb.level === 5 && sb.weather === 'storm' && sb.events >= 1 && sb.block, 'sandbox: money, level, weather and a town event');
  check(!sb.before && sb.after, 'sandbox: towns allow everything when switched on');
  // bookmarks are saved; a normal game has no sandbox
  await loadSave(page, bm.save);
  const l = await page.evaluate(() => (window.__tracklands.game.bookmarks || []).length);
  check(l === 2, `bookmarks are saved (${l})`);
  await startTestGame(page, 777, { difficulty: 'standard' });
  const std = await page.evaluate(async () => {
    const g = window.__tracklands.game, u = g.ui, c0 = g.economy.coins;
    u.openPanel('search');
    await new Promise((r) => setTimeout(r, 30));
    u.actions.sbMoney(1000000);
    return { block: !!document.querySelector('[data-act="sbMoney"]'), money: g.economy.coins - c0 };
  });
  check(!std.block && std.money === 0, 'no sandbox tools in a normal game');
  // the 8× button, clicked
  await page.evaluate(() => { const g = window.__tracklands.game; g.ui.closePanel(); g.running = true; });
  await page.click('.spd[data-arg="8"]');
  const sp = await page.evaluate(() => window.__tracklands.game.speed);
  check(sp === 8, `the 8× button (${sp})`);
  await page.evaluate(() => window.__tracklands.game.setSpeed(0));
  if (errors.length) { ok = false; lines.push('errors: ' + errors.slice(0, 3).join(' | ')); }
  await ctx.close();
  return { ok, lines };
}
