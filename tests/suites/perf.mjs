// Performance: simulation tick cost vs. train count on random networks,
// long-session leak check (heap, GPU objects, listeners) and render cost.
import { openPage, startTestGame } from '../lib.mjs';

export const name = 'perf';
export async function run({ browser, base, quick }) {
  const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 1280, height: 800 } });
  const lines = [];
  let ok = true;
  const targets = quick ? [8, 24] : [8, 24, 50];
  for (const seed of quick ? [18] : [11, 18]) {
    await startTestGame(page, seed * 1013);
    const res = await page.evaluate(async ([sd, targets]) => {
      const g = window.__tracklands.game;
      const { RailFuzz } = await import('./src/debug/RailFuzz.js');
      const F = new RailFuzz(g, sd); F.setup(); F.buildNetwork();
      const out = [];
      for (const target of targets) {
        let guard = 0;
        while (g.trains.trains.length < target && guard++ < 400) { F.buyRandom(); for (let k = 0; k < 20; k++) g.tick(1 / 30); }
        for (let k = 0; k < 600; k++) g.tick(1 / 30);
        const N = 1800, times = [];
        for (let k = 0; k < N; k++) { const a = performance.now(); g.tick(1 / 30); times.push(performance.now() - a); }
        times.sort((a, b) => a - b);
        const avg = times.reduce((a, b) => a + b, 0) / N;
        let v0 = performance.now(); for (let k = 0; k < 60; k++) g.trains.updateVisuals(1 / 60); const vis = (performance.now() - v0) / 60;
        out.push({ trains: g.trains.trains.length, avg, p99: times[Math.floor(N * 0.99)], vis, conflicts: g.trains.collisions, trips: g.trains.trains.reduce((a, t) => a + t.trips, 0) });
      }
      return out;
    }, [seed, targets]);
    for (const r of res) {
      // budget: a 1/30 s simulation step must stay far below one frame
      const good = r.avg < 4 && r.p99 < 16 && r.conflicts === 0;
      if (!good) ok = false;
      lines.push(`${good ? 'ok  ' : 'FAIL'} seed ${seed}: ${r.trains} trains  tick avg ${r.avg.toFixed(2)} ms  p99 ${r.p99.toFixed(2)} ms  visuals ${r.vis.toFixed(2)} ms  trips ${r.trips}  conflicts ${r.conflicts}`);
    }
  }
  // long session: 60 game minutes at 4x with rendering, then compare memory
  const minutes = quick ? 10 : 60;
  const mem = await page.evaluate(async (mins) => {
    const app = window.__tracklands, g = app.game;
    const snap = () => ({ heap: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : 0, geo: app.renderer.info.memory.geometries, tex: app.renderer.info.memory.textures, scene: (() => { let n = 0; g.scene.traverse(() => n++); return n; })(), dom: document.getElementsByTagName('*').length });
    for (let k = 0; k < 30 * 60 * 2; k++) g.tick(1 / 30);
    for (let f = 0; f < 30; f++) g.frame(1 / 60);
    const a = snap();
    for (let m = 0; m < mins; m++) { for (let k = 0; k < 30 * 60; k++) g.tick(1 / 30); for (let f = 0; f < 10; f++) g.frame(1 / 60); }
    if (window.gc) window.gc();
    const b = snap();
    return { a, b };
  }, minutes);
  const grow = mem.b.heap - mem.a.heap;
  const leak = grow > 40 || mem.b.geo > mem.a.geo * 1.6 + 60 || mem.b.scene > mem.a.scene * 1.6 + 400;
  if (leak) ok = false;
  lines.push(`${leak ? 'FAIL' : 'ok  '} long session ${minutes} game-min: heap ${mem.a.heap.toFixed(0)}→${mem.b.heap.toFixed(0)} MB, geometries ${mem.a.geo}→${mem.b.geo}, textures ${mem.a.tex}→${mem.b.tex}, scene objects ${mem.a.scene}→${mem.b.scene}, DOM ${mem.a.dom}→${mem.b.dom}`);
  if (errors.length) { ok = false; lines.push('errors: ' + errors.slice(0, 3).join(' | ')); }
  await ctx.close();
  return { ok, lines };
}
