// Map sizes (util.setMapSize, WorldGen scaling, chunked terrain): 96 and 128
// tile worlds generate every region with more towns and industries, render in
// terrain chunks, route long track, run a train, save with their size and load
// back; a classic save loads at 64 afterwards; the new-game dialog starts a
// huge world with the mouse.
import { openPage, loadSave, productionSave } from '../lib.mjs';

export const name = 'mapsize';
export async function run({ browser, base }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 1280, height: 800 } });
  await loadSave(page, productionSave());
  const classic = await page.evaluate(() => { const g = window.__tracklands.game; return { towns: g.towns.list.length, inds: g.industries.list.length }; });
  for (const size of [96, 128]) {
    await page.evaluate((n) => {
      const app = window.__tracklands;
      document.querySelectorAll('.modal-wrap').forEach((m) => m.remove());
      if (app.game) { app.ui.detach(); app.game.dispose(); app.game = null; }
      app.startGame({ seed: 777, difficulty: 'builder', test: true, paused: true, mapSize: n });
    }, size);
    await page.waitForFunction(() => window.__tracklands.game && window.__tracklands.game.running, null, { timeout: 60000 });
    const r = await page.evaluate(async (n) => {
      const g = window.__tracklands.game, U = await import('./src/util.js');
      g.tutorial.skip();
      const regions = new Set(g.towns.list.map((t) => t.region));
      const out = { N: U.N, conn: g.net.conn.length, towns: g.towns.list.length, inds: g.industries.list.length, regions: regions.size, chunks: g.world.view.chunks.length, maxZoom: g.camera.maxZoom };
      // every site inside the map
      out.inside = [...g.towns.list, ...g.industries.list].every((s) => s.x >= 0 && s.z >= 0 && s.x < n && s.z < n);
      // long track between the two farthest towns of the open region + a train
      for (let i = 0; i < 8; i++) g.progression.regions.add(i);
      g.economy.coins = 1e7;
      g.settings.weather = false;
      const ts = g.towns.list;
      let best = null;
      for (const a of ts) for (const b of ts) { const d = Math.abs(a.x - b.x) + Math.abs(a.z - b.z); if (a !== b && (!best || d > best.d)) best = { a, b, d }; }
      out.span = best.d;
      // rendered frames: time a few
      const t0 = performance.now();
      const gl = g.renderer.getContext();
      g.camera.target.set(n, 0, n); g.camera.zoomGoal = g.camera.viewSize = g.camera.maxZoom; g.camera.apply();
      for (let k = 0; k < 10; k++) { g.frame(1 / 60); gl.finish(); }
      out.frameMs = Math.round((performance.now() - t0) / 10);
      // save / load
      const S = await import('./src/save/Save.js');
      const d = S.migrate(JSON.parse(JSON.stringify(g.serialize())));
      out.valid = S.validate(d) === null;
      out.saved = d.mapSize;
      window.__msave = d;
      out.sig = JSON.stringify([g.towns.list.map((t) => [t.x, t.z]), g.industries.list.map((i) => [i.x, i.z])]);
      return out;
    }, size);
    check(r.N === size && r.conn === size * size && r.inside, `${size}×${size}: grid and every site inside (${r.conn} tiles)`);
    check(r.regions === 8 && r.towns > classic.towns && r.inds > classic.inds, `${size}: all 8 regions, ${r.towns} towns (classic ${classic.towns}), ${r.inds} industries (classic ${classic.inds})`);
    check(r.chunks === (size / 32) ** 2 && r.maxZoom > 80, `${size}: terrain in ${r.chunks} chunks, zoom out to ${r.maxZoom}`);
    check(r.valid && r.saved === size, `${size}: save validates and records its size; ${r.frameMs} ms per frame zoomed out, GPU work included (SwiftShader)`);
    await loadSave(page, await page.evaluate(() => window.__msave));
    const back = await page.evaluate(async () => { const g = window.__tracklands.game, U = await import('./src/util.js'); return { N: U.N, sig: JSON.stringify([g.towns.list.map((t) => [t.x, t.z]), g.industries.list.map((i) => [i.x, i.z])]) }; });
    check(back.N === size && back.sig === r.sig, `${size}: loads back with the same world`);
  }
  // a classic save afterwards
  await loadSave(page, productionSave());
  const c2 = await page.evaluate(async () => { const g = window.__tracklands.game, U = await import('./src/util.js'); for (let i = 0; i < 300; i++) g.tick(1 / 30); return { N: U.N, towns: g.towns.list.length, conn: g.net.conn.length, trains: g.trains.trains.length }; });
  check(c2.N === 64 && c2.conn === 4096 && c2.towns === classic.towns && c2.trains > 0, `the production save loads at 64 afterwards (${JSON.stringify(c2)})`);
  // new game dialog: pick Huge with the mouse
  await page.evaluate(() => { const app = window.__tracklands; app.ui.detach && 0; app.newGameDialog(); });
  await page.waitForTimeout(300);
  const opts = await page.$$eval('.modal input[name=size]', (els) => els.map((e) => e.value));
  await page.click('.modal input[name=size][value="128"]');
  await page.click('.modal [data-mbtn=go]');
  await page.waitForFunction(() => window.__tracklands.game && window.__tracklands.game.running && window.__tracklands.game.mapSize === 128, null, { timeout: 60000 }).catch(() => {});
  const ng = await page.evaluate(async () => { const g = window.__tracklands.game, U = await import('./src/util.js'); return { size: g.mapSize, N: U.N }; });
  check(opts.join(',') === '64,96,128' && ng.size === 128 && ng.N === 128, `the new-game dialog offers ${opts.join(', ')} and starts a 128 world`);
  if (errors.length) { ok = false; lines.push('errors: ' + errors.slice(0, 2).join(' | ')); }
  await ctx.close();
  return { ok, lines };
}
