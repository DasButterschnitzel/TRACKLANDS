// Construction with real input (mouse and touch), no shortcuts through the
// game API: pick the station tool in the toolbar, set the track count in the
// sub bar, drag a station with the mouse, extend a platform by dragging with
// a finger, undo with the toolbar button. Also checks the ghost preview text.
// Then, on the production save: bulldozing track under a train asks for a
// pending construction; confirming pays once, shows the site, undo refunds.
import { openPage, startTestGame, loadSave, productionSave, ensureOut } from '../lib.mjs';
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

async function touchTap(page, cdp, at) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: at[0], y: at[1], id: 1 }] });
  await page.waitForTimeout(60);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(60);
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
      // touch: tap the start (a handle appears there), drag the handle to the
      // end, read the ghost text, then confirm with Build in the sub bar
      await touchTap(page, cdp, p0);
      const handle = await page.waitForSelector('#bhandles .bhandle', { timeout: 3000 }).then(() => true, () => false);
      check(handle, `${label}: a tap sets the start and shows a drag handle`);
      await touchDrag(page, cdp, p0, p4, 10);
      await page.waitForTimeout(150);
      info = await page.evaluate(() => document.querySelector('#cursorinfo').textContent);
      const none = await page.evaluate((a) => !window.__tracklands.game.stations.stationAt(a), a);
      check(none, `${label}: nothing is built before confirming`);
      await page.screenshot({ path: path.join(out, `build-${label}-drag.png`) });
      await page.click('#subbar [data-act=buildConfirm]');
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
      if (cdp) { await touchTap(page, cdp, e0); await touchDrag(page, cdp, e0, e1); await page.waitForTimeout(150); await page.click('#subbar [data-act=buildConfirm]'); }
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
  // pending construction on occupied track, real mouse on the production save
  {
    const { page, ctx, errors } = await openPage(browser, base, { viewport: { width: 1280, height: 800 } });
    await loadSave(page, productionSave());
    const tile = await page.evaluate(() => {
      const g = window.__tracklands.game, T = g.trains, net = g.net;
      for (let i = 0; i < 90; i++) g.tick(1 / 30);
      let best = -1;
      for (const t of T.trains) for (const st of t.steps) {
        const i = st.tile;
        if (net.degree(i) === 2 && !net.special.has(i) && !net.isJunction(i) && T.tileOccupied(i) === t && !g.decor.at(i)) { best = i; break; }
        if (best >= 0) break;
      }
      if (best < 0) return -1;
      window.__focus = [((best % 64) + 0.5) * 2, (Math.floor(best / 64) + 0.5) * 2];
      g.camera.focus(window.__focus[0], window.__focus[1], 22);
      return best;
    });
    check(tile >= 0, `works: found track under a train on the production save (${tile})`);
    if (tile >= 0) {
      await page.waitForFunction(() => { const t = window.__tracklands.game.camera.target, f = window.__focus; return Math.abs(t.x - f[0]) + Math.abs(t.z - f[1]) < 0.15; }, null, { polling: 100, timeout: 30000 });
      await page.click('#tool-bulldoze');
      const p = await screenOf(page, tile);
      const c0 = await page.evaluate(() => window.__tracklands.game.economy.coins);
      await page.mouse.click(p[0], p[1]);
      const modal = await page.waitForSelector('.modal.works', { timeout: 3000 }).then(() => true, () => false);
      check(modal, 'works: bulldozing under a train opens the pending-construction dialog');
      if (modal) {
        await page.waitForTimeout(400);
        await page.screenshot({ path: path.join(out, 'build-works-dialog.png') });
        await page.click('.modal.works [data-mbtn=ok]');
        await page.waitForTimeout(200);
        const st = await page.evaluate((t) => { const g = window.__tracklands.game; return { n: g.works.list.length, zone: g.works.zone.has(t), conn: !!g.net.conn[t] }; }, tile);
        await page.waitForTimeout(200);
        const label = await page.waitForSelector('.wlabel.works', { state: 'attached', timeout: 3000 }).then(() => true, async () => { lines.push('labels: ' + await page.evaluate(() => [...document.querySelectorAll('#labels .wlabel')].map((e) => e.dataset.key).join(' '))); return false; });
        check(st.n === 1 && st.zone && st.conn && !!label, `works: confirmed → 1 pending site, track still there, site label shown (${JSON.stringify(st)} label ${!!label})`);
        await page.screenshot({ path: path.join(out, 'build-works-pending.png') });
        await page.click('#toolbar [data-act=undo]');
        await page.waitForTimeout(200);
        const after = await page.evaluate(() => { const g = window.__tracklands.game; return { n: g.works.list.length, coins: g.economy.coins }; });
        check(after.n === 0 && Math.abs(after.coins - c0) < 1, `works: undo cancels it with a full refund (${after.n} left, Δ${Math.round(after.coins - c0)})`);
      }
    }
    if (errors.length) { ok = false; lines.push('errors (works): ' + errors.slice(0, 2).join(' | ')); }
    await ctx.close();
  }
  return { ok, lines };
}
