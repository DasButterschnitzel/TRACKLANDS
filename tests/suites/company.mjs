// Company identity and driver mode: rename and recolour the company, place
// the headquarters with the mouse (town relationship, land claim, company
// value), save/load; drive a train from the inspector: the power lever sets
// the speed, the brake stops it, line limits still apply, Esc leaves.
import { openPage, startTestGame, loadSave } from '../lib.mjs';

export const name = 'company';
export async function run({ browser, base }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 1280, height: 800 } });
  await startTestGame(page, 7);
  await page.evaluate(() => { const g = window.__tracklands.game; g.economy.coins = 1e6; g.settings.weather = false; });
  // identity in the company panel
  await page.click('.rail-btn[data-arg=company]');
  await page.waitForTimeout(300);
  await page.fill('#panel input[data-change=companyName]', 'Northern Lines');
  await page.press('#panel input[data-change=companyName]', 'Enter');
  await page.locator('#panel input[data-change=companyName]').blur();
  await page.waitForTimeout(200);
  await page.click('#panel .cswatch[data-arg="' + 0x9a2f3a + '"]');
  await page.waitForTimeout(200);
  const id = await page.evaluate(() => { const C = window.__tracklands.game.company; return { name: C.name, color: C.color }; });
  check(id.name === 'Northern Lines' && id.color === 0x9a2f3a, `the company panel renames and recolours the company (${JSON.stringify(id)})`);
  // HQ: button → tool → click on free land near a town
  const spot = await page.evaluate(() => {
    const g = window.__tracklands.game, C = g.company, t = g.towns.list[0];
    let best = -1, bd = 1e9;
    for (let i = 0; i < 64 * 64; i++) { if (C.hqError(i)) continue; const d = Math.abs(i % 64 - t.x) + Math.abs(Math.floor(i / 64) - t.z); if (d < bd) { bd = d; best = i; } }
    return { tile: best, town: t.id, rating: g.authority.rating(t), value: g.ledger.companyValue().stations };
  });
  await page.click('#panel [data-act=hqPlace]');
  await page.evaluate((tt) => { const g = window.__tracklands.game; window.__focus = [(tt % 64 + 1) * 2, (Math.floor(tt / 64) + 1) * 2]; g.camera.focus(window.__focus[0], window.__focus[1], 16); }, spot.tile);
  await page.waitForFunction(() => { const t = window.__tracklands.game.camera.target, f = window.__focus; return Math.abs(t.x - f[0]) + Math.abs(t.z - f[1]) < 0.15; }, null, { polling: 100, timeout: 30000 });
  const p = await page.evaluate((tt) => { const g = window.__tracklands.game, cam = g.camera.camera; const x = ((tt % 64) + 0.5) * 2, z = (Math.floor(tt / 64) + 0.5) * 2; const v = new cam.position.constructor(x, g.world.view.heightAt(x, z), z).project(cam); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; }, spot.tile);
  await page.mouse.move(p[0], p[1]);
  await page.waitForTimeout(150);
  await page.mouse.click(p[0], p[1]);
  await page.waitForTimeout(300);
  const hq = await page.evaluate((s) => {
    const g = window.__tracklands.game, C = g.company, t = g.towns.byId(s.town);
    return { hq: C.hq && C.hq.tile, blocked: C.hq ? g.occupancy.blocked[C.hq.tile] === 3 : false, mesh: !!C.mesh, rating: g.authority.rating(t), value: g.ledger.companyValue().stations, tool: g.construction.tool };
  }, spot);
  check(hq.hq === spot.tile && hq.blocked && hq.mesh && hq.tool === 'select', `the headquarters is placed with the mouse and claims its land (${JSON.stringify(hq)})`);
  check(hq.value > spot.value && (hq.rating > spot.rating || spot.rating >= 92), `it adds to company value (${spot.value} → ${hq.value}) and the town likes it (${spot.rating} → ${hq.rating})`);
  // save / load
  const S = await page.evaluate(async () => { const Sv = await import('./src/save/Save.js'); return Sv.migrate(JSON.parse(JSON.stringify(window.__tracklands.game.serialize()))); });
  await loadSave(page, S);
  const back = await page.evaluate(() => { const g = window.__tracklands.game, C = g.company; return { name: C.name, color: C.color, hq: C.hq && C.hq.tile, blocked: C.hq ? g.occupancy.blocked[C.hq.tile] === 3 : false, mesh: !!C.mesh }; });
  check(back.name === 'Northern Lines' && back.color === 0x9a2f3a && back.hq === spot.tile && back.blocked && back.mesh, `name, colour and headquarters are saved (${JSON.stringify(back)})`);

  // driver mode on a test line
  await startTestGame(page, 7);
  const tid = await page.evaluate(async () => {
    const g = window.__tracklands.game;
    const { RailTests } = await import('./src/debug/RailTests.js');
    const RT = new RailTests(g);
    g.economy.coins = 1e6; g.settings.weather = false;
    for (let i = 0; i < 8; i++) g.progression.regions.add(i);
    const a = RT.findArea(30, 7);
    const z = a.z0 + 3, x0 = a.x0 + 1;
    RT.line(x0, z, x0 + 27, z); RT.finish();
    const sA = RT.station(x0 + 2, z), sB = RT.station(x0 + 26, z);
    const D = RT.depot(x0 + 28, z);
    g.net.connect(z * 64 + x0 + 27, 0); RT.finish();
    const t = RT.train(['L:pioneer', 'W:coach'], D, [sA, sB]);
    for (let i = 0; i < 30 * 20; i++) g.tick(1 / 30);
    g.select({ type: 'train', id: t.id });
    return t.id;
  });
  await page.waitForTimeout(400);
  const dbtn = await page.$('#inspector [data-act=drive]');
  if (dbtn) { await dbtn.scrollIntoViewIfNeeded(); await dbtn.click(); await page.waitForTimeout(300); }
  const drv = await page.evaluate(() => { const g = window.__tracklands.game; return { id: g.ui.driveId, hud: !document.getElementById('driver').hidden, follow: g.ui.followId }; });
  check(!!dbtn && drv.id != null && drv.hud && drv.follow === drv.id, 'the inspector puts the player in the cab (panel shown, camera follows)');
  const top = async (throttle) => {
    await page.fill('#driver input[type=range]', String(throttle));
    await page.dispatchEvent('#driver input[type=range]', 'input');
    return page.evaluate((tt) => { const g = window.__tracklands.game, t = g.trains.byId(tt); let vmax = 0, over = 0; for (let i = 0; i < 30 * 60; i++) { g.tick(1 / 30); if (i > 30 * 40) vmax = Math.max(vmax, t.v); if (t.drive && t.v > t.drive.limit + 0.05) over++; } return { vmax, over, thr: t.drive.throttle }; }, tid);
  };
  const full = await top(100), low = await top(30);
  check(full.thr === 1 && low.thr === 0.3 && low.vmax < full.vmax * 0.6 && full.over === 0 && low.over === 0, `the power lever sets the speed (100 %: ${full.vmax.toFixed(2)}, 30 %: ${low.vmax.toFixed(2)}), never above the line limit`);
  await page.click('#driver [data-act=driveBrake]');
  const braked = await page.evaluate((tt) => { const g = window.__tracklands.game, t = g.trains.byId(tt); for (let i = 0; i < 30 * 10; i++) g.tick(1 / 30); return t.v; }, tid);
  check(braked < 0.01, `the brake stops the train (${braked.toFixed(3)})`);
  await page.keyboard.press('w');
  const kb = await page.evaluate((tt) => { const t = window.__tracklands.game.trains.byId(tt); return { brake: t.drive.brake, thr: t.drive.throttle }; }, tid);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const left = await page.evaluate((tt) => { const g = window.__tracklands.game; return { id: g.ui.driveId, drive: g.trains.byId(tt).drive, hud: document.getElementById('driver').hidden }; }, tid);
  check(!kb.brake && Math.abs(kb.thr - 0.4) < 1e-6 && left.id == null && !left.drive && left.hud, `W raises the power (${kb.thr}) and releases the brake; Esc leaves the cab`);
  if (errors.length) { ok = false; lines.push('errors: ' + errors.slice(0, 2).join(' | ')); }
  await ctx.close();
  return { ok, lines };
}
