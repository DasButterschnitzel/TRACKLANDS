// First public session (Phase 15): what a new player does first, through
// the real title screen and real input — Start Journey opens a standard
// world with the tutorial, the tutorial can be skipped, a track is dragged
// with the mouse, a mistake is undone (and refunded), the company is saved,
// the page is closed and opened again, and Continue brings back the same
// company with the same track and money.
import path from 'path';
import { openPage, ensureOut } from '../lib.mjs';

export const name = 'rcflow';
export async function run({ browser, base }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 1366, height: 768 } });
  const title = await page.evaluate(() => [...document.querySelectorAll('#title [data-t]')].map((b) => b.dataset.t));
  check(title[0] === 'quick' && title[1] === 'new' && !title.includes('continue') && !title.includes('stats'), `fresh title: Start Journey first, then New game…, no Continue or Statistics (${title.join(', ')})`);
  // (Start Journey picks a random seed; the test pins it so the same land is free every run)
  await page.evaluate(() => { const a = window.__tracklands, s = a.startGame.bind(a); a.startGame = (o) => { a.startGame = s; return s({ ...o, seed: o.save ? o.seed : 4711 }); }; });
  await page.click('#title [data-t=quick]');
  await page.waitForFunction(() => window.__tracklands.game && window.__tracklands.game.running, null, { timeout: 120000 });
  await page.waitForTimeout(800);
  const tut = await page.evaluate(() => { const e = document.querySelector('#tutorial'); return !!e && !e.hidden && getComputedStyle(e).display !== 'none' && !!e.querySelector('[data-act=tutSkip]'); });
  check(tut, 'Start Journey: a standard world with the tutorial and a visible Skip');
  await page.click('#tutorial [data-act=tutSkip]');
  await page.waitForTimeout(400);
  // a straight run of free land near the camera, dragged with the mouse
  const pick = await page.evaluate(() => {
    const g = window.__tracklands.game, N = g.mapSize || 64;
    const free = (t) => { const x = t % N, z = Math.floor(t / N); return x > 1 && z > 1 && x < N - 2 && z < N - 2 && !g.net.conn[t] && g.world.type[t] === 0 && g.progression.regionUnlocked(g.world.region[t]) && !(g.world.trees && g.world.trees[t]) && !g.stations.atTile?.(t) && !g.construction.blockedTile?.(t); };
    const town = g.towns.byId(g.tutorial.townId) || g.towns.list[0], cx = town.x, cz = town.z;
    for (let r = 0; r < N; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx, z = cz + dz, t = z * N + x;
      if (x < 2 || z < 2 || x + 5 >= N - 2) continue;
      let okRun = true; for (let k = 0; k <= 4; k++) if (!free(t + k)) { okRun = false; break; }
      if (!okRun) continue;
      if (Math.abs(g.world.tileH[t] - g.world.tileH[t + 4]) > 0.01) continue;
      // only a run the track planner itself accepts (slopes between the ends included)
      const plan = g.construction.planTrack(t, t + 4, g.construction.tier);
      if (!plan || !plan.ok) continue;
      g.camera.focus((x + 2) * 2 + 1, z * 2 + 1, 16);   // (world units: two per tile)
      return [t, t + 4];
    }
    return null;
  });
  check(!!pick, 'found free flat land for a first track');
  if (!pick) { await ctx.close(); return { ok: false, lines }; }
  await page.click('#tool-track');
  await page.waitForTimeout(2500);
  const pts = () => page.evaluate(([a, b]) => { const g = window.__tracklands.game, N = g.mapSize || 64, cam = g.camera.camera; const P = (t) => { const v = new cam.position.constructor((t % N + 0.5) * 2, g.net.railH(t) + 0.1, (Math.floor(t / N) + 0.5) * 2).project(cam); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; }; return [P(a), P(b)]; }, pick);
  const state = () => page.evaluate(() => { const g = window.__tracklands.game; return { track: g.net.conn.reduce((s, c) => s + (c ? 1 : 0), 0), coins: Math.round(g.economy.coins) }; });
  // the camera must have come to rest before screen points are taken: a zoom
  // still easing out moved the end of the drag onto another tile (seen in CI)
  const settled = async () => { await page.waitForFunction(() => { const c = window.__tracklands.game.camera; return !c.focusGoal && Math.abs(c.viewSize - c.zoomGoal) < 0.005 && Math.abs(c.azimuth - c.azGoal) < 1e-4; }, null, { polling: 100, timeout: 15000 }); let prev = null; for (let i = 0; i < 30; i++) { const sp = await pts(); if (prev && Math.hypot(sp[0][0] - prev[0][0], sp[0][1] - prev[0][1]) < 0.5) return sp; prev = sp; await page.waitForTimeout(150); } return prev; };
  // what the pointer meets, for the failure message
  const diag = (sp) => page.evaluate(([sp, pick]) => { const g = window.__tracklands.game, under = sp.map(([x, y]) => { const e = document.elementFromPoint(x, y); return e ? (e.id || e.className || e.tagName) : '-'; }); return { tool: g.construction.tool, under, at: sp.map((p) => p.map(Math.round)), tiles: pick.map((t) => ({ conn: !!g.net.conn[t], type: g.world.type[t] })), hit: sp.map(([x, y]) => g.input.tileAt(x, y).tile), want: pick, lt: pick.map((t) => g.construction.lt(t)), plan: (() => { const pl = g.construction.planTrack(pick[0], pick[1], g.construction.tier); return pl ? { ok: pl.ok, reason: pl.reason, cost: pl.cost } : null; })(), coins: Math.round(g.economy.coins) }; }, [sp, pick]);
  let lastDiag = null;
  const drag = async () => { const sp = await settled(); lastDiag = await diag(sp); await page.mouse.move(sp[0][0], sp[0][1]); await page.mouse.down(); await page.mouse.move(sp[1][0], sp[1][1], { steps: 12 }); await page.waitForTimeout(300); await page.mouse.up(); await page.waitForTimeout(800); };
  const s0 = await state();
  await drag();
  const s1 = await state();
  const built = s1.track >= s0.track + 4 && s1.coins < s0.coins;
  if (!built) lastDiag.toasts = await page.evaluate(() => [...document.querySelectorAll('#toasts > *')].map((e) => e.dataset.text || e.textContent).slice(-3));
  if (!built) await page.screenshot({ path: path.join(ensureOut(), 'rcflow-drag-failed.png') });
  check(built, `a mouse-dragged track is built and paid (${s1.track - s0.track} tiles, ${s0.coins - s1.coins} coins)${built ? '' : ' — ' + JSON.stringify(lastDiag)}`);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(600);
  const s2 = await state();
  check(s2.track === s0.track && s2.coins === s0.coins, `Ctrl+Z takes the mistake back and refunds it (${s2.track} tiles, ${s2.coins} coins)`);
  await drag();
  const s3 = await state();
  await page.keyboard.press('Escape');
  // close and open again: the save is written when the page goes away
  await page.evaluate(() => window.__tracklands.flushSave());
  await page.waitForTimeout(500);
  await page.reload();
  await page.waitForFunction(() => window.__tracklands && window.__tracklands.renderer && document.querySelector('#title [data-t]'), null, { timeout: 60000 });
  await page.waitForTimeout(600);
  const t2 = await page.evaluate(() => [...document.querySelectorAll('#title [data-t]')].map((b) => b.dataset.t));
  check(t2[0] === 'continue' && t2.includes('stats') && t2.includes('quick'), `after reopening: Continue first, Statistics and Quick start shown (${t2.join(', ')})`);
  await page.click('#title [data-t=continue]');
  await page.waitForFunction(() => window.__tracklands.game && window.__tracklands.game.running, null, { timeout: 120000 });
  await page.waitForTimeout(800);
  const s4 = await state();
  check(s4.track === s3.track && Math.abs(s4.coins - s3.coins) <= Math.max(50, s3.coins * 0.02), `Continue brings back the same company: ${s4.track} track tiles (${s3.track}), ${s4.coins} coins (${s3.coins})`);
  const tutAgain = await page.evaluate(() => { const g = window.__tracklands.game; return !!(g.tutorial && !g.tutorial.finished && !g.tutorial.skipped && document.querySelector('#tutorial:not([hidden])')); });
  check(!tutAgain, 'a skipped tutorial stays skipped after reopening');
  const errs = errors.filter((e) => !/404/.test(e));
  if (errs.length) { ok = false; lines.push('errors: ' + errs.slice(0, 3).join(' | ')); }
  await ctx.close();
  return { ok, lines };
}
