// Tutorial from a fresh world with real UI input: stations, a mouse-dragged
// track, depot, buying through the Train Builder, first deliveries, finish.
import { openPage, ensureOut } from '../lib.mjs';
import path from 'path';

export const name = 'tutorial';
export async function run({ browser, base, args }) {
  const out = ensureOut();
  const { ctx, page, errors } = await openPage(browser, base);
  const lines = [];
  const snap = async (label) => { const s = await page.evaluate(() => { const T = window.__tracklands.game.tutorial; return T.step + (T.finished ? ':done' : '') + ' ' + (document.querySelector('.tut-title')?.textContent || ''); }); lines.push(`${label} -> ${s}`); };
  await page.click('[data-t=new]'); await page.waitForTimeout(300);
  await page.fill('#ng-seed', String(args.seed || 99)); await page.click('[data-mbtn=go]');
  await page.waitForFunction(() => window.__tracklands.game && window.__tracklands.game.running, null, { timeout: 60000 });
  await page.waitForTimeout(800);
  await snap('start');
  await page.click('[data-act=tutNext]'); await page.waitForTimeout(400); await snap('next');
  await page.evaluate(() => { const g = window.__tracklands.game; g.select({ type: 'industry', id: g.tutorial.forestId }); }); await page.waitForTimeout(400); await snap('select forest');
  await page.click('#tool-station'); await page.waitForTimeout(200);
  const place = (wantInd) => {
    const g = window.__tracklands.game, N = 64;
    const ind = g.industries.byId(g.tutorial.forestId), town = g.towns.byId(g.tutorial.townId);
    let best = null, bd = 1e9;
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
      const t = z * N + x;
      if (g.stations.placeError(t, 'station')) continue;
      const L = g.stations.previewLinks(t);
      if (wantInd ? (!L.inds.includes(ind) || L.towns.includes(town)) : (!L.towns.includes(town) || L.inds.includes(ind))) continue;
      const d = Math.hypot(x - ind.x, z - ind.z);
      if (d < bd) { bd = d; best = t; }
    }
    g.construction.placeStation(best);
    return best;
  };
  const A = await page.evaluate(place, true); await page.waitForTimeout(400); await snap('station at forest');
  await page.evaluate(() => { const g = window.__tracklands.game; g.construction.setTool('select'); g.select({ type: 'town', id: g.tutorial.townId }); }); await page.waitForTimeout(400); await snap('select town');
  const B = await page.evaluate(place, false); await page.waitForTimeout(400); await snap('station at town');
  await page.click('#tool-track'); await page.waitForTimeout(400); await snap('track tool');
  await page.evaluate(([a, b]) => { window.__tracklands.game.camera.focus((a % 64) + (b % 64) + 1, Math.floor(a / 64) + Math.floor(b / 64) + 1, 18); }, [A, B]);
  await page.waitForTimeout(2500);
  const sp = await page.evaluate(([a, b]) => { const g = window.__tracklands.game; const cam = g.camera.camera; const P = (t) => { const v = new cam.position.constructor((t % 64 + 0.5) * 2, g.net.railH(t) + 0.1, (Math.floor(t / 64) + 0.5) * 2).project(cam); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; }; return [P(a), P(b)]; }, [A, B]);
  await page.mouse.move(sp[0][0], sp[0][1]); await page.mouse.down(); await page.mouse.move(sp[1][0], sp[1][1], { steps: 12 }); await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, 'tutorial-drag.png') });
  await page.mouse.up(); await page.waitForTimeout(800); await snap('connected');
  await page.evaluate(() => { const g = window.__tracklands.game, N = 64; for (let i = 0; i < N * N; i++) { if (!g.net.conn[i] || g.net.special.has(i)) continue; for (const d of [1, -1, N, -N]) { const j = i + d; if (g.net.conn[j] || g.stations.placeError(j, 'depot')) continue; g.construction.placeDepot(j); if (g.stations.depots.length && g.net.conn[g.stations.depots[0].tile]) return; if (g.stations.depots.length) g.stations.removeDepot(g.stations.depots[0]); } } });
  await page.waitForTimeout(400); await snap('depot');
  await page.click('#tool-train'); await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, 'tutorial-builder.png') });
  await page.click('[data-act=bldBuy]'); await page.waitForTimeout(800); await snap('bought');
  await page.evaluate(() => { const g = window.__tracklands.game; g.select(null); for (let i = 0; i < 30 * 180; i++) g.tick(1 / 30); }); await page.waitForTimeout(600); await snap('ran 3 min');
  for (let k = 0; k < 3; k++) {
    const btn = page.locator('#tutorial [data-act=tutNext]');
    if (!(await btn.count()) || !(await btn.first().isVisible())) { lines.push('(tutorial bubble: ' + await page.evaluate(() => { const e = document.querySelector('#tutorial'); return e ? `hidden=${e.hidden} display=${getComputedStyle(e).display} class=${e.className}` : 'none'; }) + ')'); break; }
    await btn.first().click({ timeout: 5000 }).catch((e) => lines.push('click failed: ' + e.message.split('\n')[0]));
    await page.waitForTimeout(500); await snap('next');
  }
  const fin = await page.evaluate(() => { const g = window.__tracklands.game; return { done: g.tutorial.finished, trains: g.trains.trains.length, del: g.stats.data.deliveries, trips: g.trains.trains.reduce((a, t) => a + t.trips, 0), problems: g.trains.trains.map((t) => t.problem).filter(Boolean) }; });
  lines.push(`result: finished=${fin.done} trains=${fin.trains} trips=${fin.trips} deliveries=${fin.del} problems=${fin.problems.join(',') || 0}`);
  if (errors.length) lines.push('page errors: ' + errors.slice(0, 3).join(' | '));
  await ctx.close();
  return { ok: fin.done && fin.trains === 1 && fin.trips > 0 && fin.del > 0 && !errors.length, lines };
}
