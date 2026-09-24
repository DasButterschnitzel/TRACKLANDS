// Construction with real input (mouse and touch), no shortcuts through the
// game API: pick the station tool in the toolbar, set the track count in the
// sub bar, drag a station with the mouse, extend a platform by dragging with
// a finger, undo with the toolbar button. Also checks the ghost preview text.
import { openPage, startTestGame, ensureOut } from '../lib.mjs';
import path from 'path';

export const name = 'build';

// screen position of a tile centre
const screenOf = (page, tile) => page.evaluate((t) => {
  const g = window.__tracklands.game, cam = g.camera.camera;
  const v = new cam.position.constructor(((t % 64) + 0.5) * 2, g.net.conn[t] ? g.net.railH(t) : g.world.view.heightAt(((t % 64) + 0.5) * 2, (Math.floor(t / 64) + 0.5) * 2), (Math.floor(t / 64) + 0.5) * 2).project(cam);
  return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight];
}, tile);

async function touchDrag(page, cdp, from, to, steps = 12) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from[0], y: from[1], id: 1 }] });
  for (let i = 1; i <= steps; i++) {
    const x = from[0] + (to[0] - from[0]) * i / steps, y = from[1] + (to[1] - from[1]) * i / steps;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 1 }] });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

export async function run({ browser, base }) {
  const lines = [];
  let ok = true;
  const out = ensureOut();
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  for (const [label, opts] of [['desktop', { viewport: { width: 1280, height: 800 } }], ['touch', { viewport: { width: 412, height: 860 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }]]) {
    const { ctx, page, errors } = await openPage(browser, base, opts);
    await startTestGame(page, 7);
    const a = await page.evaluate(() => {
      const g = window.__tracklands.game, S = g.stations, N = 64;
      g.economy.coins = 1e6;
      g.progression.research.add('platform_extension'); g.progression.research.add('station_expansion');
      let a = -1;
      for (let z = 12; z < 50 && a < 0; z++) for (let x = 12; x < 44 && a < 0; x++) {
        let free = true;
        for (let i = -1; i < 9 && free; i++) for (const dz of [-3, -2, -1, 0, 1, 2, 3]) { const t = (z + dz) * N + x + i; if (S.placeError(t, 'station') || g.decor.at(t)) free = false; }
        if (free) a = z * N + x;
      }
      window.__focus = [((a % N) + 3) * 2, (Math.floor(a / N) + 0.5) * 2];
      g.camera.focus(window.__focus[0], window.__focus[1], 26);
      return a;
    });
    // let the camera glide all the way to its target before measuring screen positions
    await page.waitForFunction(() => { const t = window.__tracklands.game.camera.target, f = window.__focus; return Math.abs(t.x - f[0]) + Math.abs(t.z - f[1]) < 0.15; }, null, { polling: 100, timeout: 30000 });
    const cdp = label === 'touch' ? await ctx.newCDPSession(page) : null;
    // station tool from the toolbar, two tracks from the sub bar
    await page.click('#tool-station');
    await page.click('#subbar [data-act=stTracks][data-arg="1"]');
    const tracksShown = await page.evaluate(() => document.querySelector('#subbar .sub-num')?.textContent);
    check(tracksShown === '2', `${label}: sub bar sets 2 platform tracks (${tracksShown})`);
    await page.evaluate(() => { const C = window.__tracklands.game.construction; if (!C.__wrapped) { const o = C.pointerDown.bind(C); C.pointerDown = (t, p) => { window.__downs = (window.__downs || []).concat([t]); return o(t, p); }; C.__wrapped = true; } });
    const p0 = await screenOf(page, a), p4 = await screenOf(page, a + 4);
    let info = '';
    if (cdp) {
      // hold mid-drag to read the ghost text, then finish
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p0[0], y: p0[1], id: 1 }] });
      for (let i = 1; i <= 10; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p0[0] + (p4[0] - p0[0]) * i / 10, y: p0[1] + (p4[1] - p0[1]) * i / 10, id: 1 }] }); await page.waitForTimeout(16); }
      info = await page.evaluate(() => document.querySelector('#cursorinfo').textContent);
      await page.screenshot({ path: path.join(out, `build-${label}-drag.png`) });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.mouse.move(p0[0], p0[1]); await page.mouse.down();
      for (let i = 1; i <= 10; i++) { await page.mouse.move(p0[0] + (p4[0] - p0[0]) * i / 10, p0[1] + (p4[1] - p0[1]) * i / 10); await page.waitForTimeout(16); }
      info = await page.evaluate(() => document.querySelector('#cursorinfo').textContent);
      await page.screenshot({ path: path.join(out, `build-${label}-drag.png`) });
      await page.mouse.up();
    }
    await page.waitForTimeout(300);
    check(/5/.test(info) && /●/.test(info) && /m/.test(info), `${label}: ghost shows length, fit and cost ("${info}")`);
    const st = await page.evaluate((a) => { const s = window.__tracklands.game.stations.stationAt(a); return s ? { id: s.id, lens: s.tracks.map((t) => t.tiles.length) } : null; }, a);
    const why = st ? '' : await page.evaluate((a) => { const g = window.__tracklands.game; return `stations ${g.stations.list.map((s) => s.tile + ':' + s.tracks.map((t) => t.tiles.length).join('/')).join(' ')} a=${a} tool=${g.construction.tool} mode=${g.input.mode} ptrs=${g.input.pointers.size} downs=${(window.__downs || []).join(',')} cam=${g.camera.camera.position.toArray().map((v) => v.toFixed(2))} vw=${innerWidth}x${innerHeight} rect=${JSON.stringify(document.querySelector("#view").getBoundingClientRect())} scroll=${scrollX},${scrollY} vv=${visualViewport ? visualViewport.offsetTop + "/" + visualViewport.scale : "-"}`; }, a);
    check(!!st && st.lens[0] === 5 && st.lens.length === 2, `${label}: dragged a 5-tile station with 2 tracks (${st ? st.lens.join('/') : 'none ' + why})`);
    if (st) {
      // extend: drag outward from the platform end
      const endTile = await page.evaluate((id) => { const s = window.__tracklands.game.stations.byId(id); const tk = s.tracks[0].tiles; return tk[tk.length - 1]; }, st.id);
      const e0 = await screenOf(page, endTile), e1 = await screenOf(page, endTile + 1);
      const c0 = await page.evaluate(() => window.__tracklands.game.economy.coins);
      if (cdp) await touchDrag(page, cdp, e0, e1);
      else { await page.mouse.move(e0[0], e0[1]); await page.mouse.down(); await page.mouse.move(e1[0], e1[1], { steps: 8 }); await page.mouse.up(); }
      await page.waitForTimeout(300);
      const after = await page.evaluate((id) => window.__tracklands.game.stations.byId(id).tracks.map((t) => t.tiles.length), st.id);
      const spent = c0 - await page.evaluate(() => window.__tracklands.game.economy.coins);
      check(after[0] === 6 && after[1] === 5 && spent > 0, `${label}: dragging from the platform end extends it (${after.join('/')}, ${Math.round(spent)}●)`);
      // undo from the toolbar
      await page.click('#toolbar [data-act=undo]');
      await page.waitForTimeout(300);
      const undone = await page.evaluate((id) => window.__tracklands.game.stations.byId(id).tracks.map((t) => t.tiles.length), st.id);
      const refunded = await page.evaluate(() => window.__tracklands.game.economy.coins) - (c0 - spent);
      check(undone[0] === 5 && Math.abs(refunded - spent) < 1, `${label}: undo shrinks it back and refunds (${undone.join('/')})`);
    }
    if (errors.length) { ok = false; lines.push(`errors (${label}): ` + errors.slice(0, 2).join(' | ')); }
    await ctx.close();
  }
  return { ok, lines };
}
