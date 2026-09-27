// Phase 8 performance: benchmark worlds (three map sizes with a railway
// network and trains) measured frame by frame against the budgets, and
// against a stored baseline (tests/perf-baseline.json: draw calls and scene
// size must not creep up); a memory audit over repeated game starts (nothing
// kept from the previous game); the performance overlay; windowed long lists.
// Update the baseline after an intended change: BENCH_UPDATE=1 node tests/run.mjs bench
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPage } from '../lib.mjs';

const BASELINE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'perf-baseline.json');
const WORLDS = [{ id: 'w64', map: 64, seed: 5101, trains: 12 }, { id: 'w128', map: 128, seed: 5202, trains: 24 }, { id: 'w192', map: 192, seed: 5303, trains: 36 }];

async function start(page, opts) {
  await page.evaluate((o) => {
    const app = window.__tracklands;
    document.querySelectorAll('.modal-wrap').forEach((m) => m.remove());
    if (app.game) { app.ui.detach(); app.game.dispose(); app.game = null; }
    app.startGame({ difficulty: 'builder', test: true, paused: true, ...o });
  }, opts);
  await page.waitForFunction(() => window.__tracklands.game && window.__tracklands.game.running, null, { timeout: 120000 });
  await page.evaluate(() => { const g = window.__tracklands.game; g.tutorial.skip(); document.querySelectorAll('.modal-wrap').forEach((m) => m.remove()); });
}

export const name = 'bench';
export async function run({ browser, base, quick }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 1280, height: 800 } });
  const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : { worlds: {} };
  const measured = {};
  for (const w of quick ? WORLDS.slice(0, 2) : WORLDS) {
    await start(page, { seed: w.seed, mapSize: w.map });
    const r = await page.evaluate(async ([sd, n]) => {
      const app = window.__tracklands, g = app.game;
      const { RailFuzz } = await import('./src/debug/RailFuzz.js');
      const { PERF_BUDGET } = await import('./src/debug/PerfHud.js');
      const F = new RailFuzz(g, sd); F.setup(); F.buildNetwork();
      let guard = 0;
      while (g.trains.trains.length < n && guard++ < 600) { F.buyRandom(); for (let k = 0; k < 15; k++) g.tick(1 / 30); }
      for (let k = 0; k < 900; k++) g.tick(1 / 30);
      g.speed = 4; g.running = true;
      // a fixed camera: the whole-map view is the worst case for draw calls
      for (let f = 0; f < 30; f++) g.frame(1 / 60);
      g.perf = new g.perf.constructor();
      const t0 = performance.now();
      for (let f = 0; f < 90; f++) g.frame(1 / 30);
      const wall = (performance.now() - t0) / 90;
      const p = g.perf.report(g);
      let scene = 0; g.scene.traverse(() => scene++);
      return { trains: g.trains.trains.length, sim: p.sim, vis: p.vis, render: p.render, calls: p.calls, tris: p.tris, geos: p.geos, scene, wall, budget: PERF_BUDGET, conflicts: g.trains.collisions };
    }, [w.seed, w.trains]);
    measured[w.id] = { calls: r.calls, scene: r.scene, geos: r.geos };
    const b = baseline.worlds[w.id];
    // SwiftShader renders on the CPU, so only the simulation and visuals are
    // held to the frame budget here; draw calls and scene size are compared
    // with the baseline (they do not depend on the machine)
    const inBudget = r.sim < r.budget.sim && r.vis < r.budget.vis * 2 && r.calls < r.budget.calls;
    check(inBudget && r.conflicts === 0, `${w.id} (${w.map}², ${r.trains} trains, 4×): sim ${r.sim.toFixed(2)} ms, visuals ${r.vis.toFixed(2)} ms, render ${r.render.toFixed(1)} ms (CPU), ${r.calls} draw calls, ${Math.round(r.tris / 1000)}k triangles, ${r.geos} geometries, ${r.scene} scene objects`);
    if (b) check(r.calls <= b.calls * 1.25 + 10 && r.scene <= b.scene * 1.25 + 50, `${w.id} against the baseline: calls ${b.calls}→${r.calls}, scene ${b.scene}→${r.scene}`);
    else lines.push(`note ${w.id}: no baseline yet`);
  }
  if (process.env.BENCH_UPDATE) { fs.writeFileSync(BASELINE, JSON.stringify({ note: 'draw calls and scene objects of the benchmark worlds (tests/suites/bench.mjs)', worlds: { ...baseline.worlds, ...measured } }, null, 2) + '\n'); lines.push('baseline written'); }

  // memory audit: four game starts in a row keep nothing from the game before
  const mem = [];
  for (let i = 0; i < 4; i++) {
    await start(page, { seed: 6100 + (i % 2), mapSize: 96 });
    mem.push(await page.evaluate(() => { const app = window.__tracklands, g = app.game; for (let f = 0; f < 10; f++) g.frame(1 / 60); if (window.gc) window.gc(); return { geo: app.renderer.info.memory.geometries, tex: app.renderer.info.memory.textures, heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : 0, hud: document.querySelectorAll('#perf-hud').length, canvases: document.querySelectorAll('canvas').length }; }));
  }
  const [m0, m1, m2, m3] = mem;
  check(m3.geo <= m2.geo * 1.1 + 20 && m2.tex === m0.tex && m3.tex === m1.tex && m2.geo <= m0.geo * 1.2 + 40 && m3.heap <= m0.heap + 60 && m3.canvases === m0.canvases,
    `memory over four starts: geometries ${mem.map((m) => m.geo).join('→')}, textures ${mem.map((m) => m.tex).join('→')}, heap ${mem.map((m) => m.heap).join('→')} MB, canvases ${mem.map((m) => m.canvases).join('→')}`);

  // the performance overlay (setting and F3) and windowed long lists
  const hud = await page.evaluate(async () => {
    const app = window.__tracklands, g = app.game, out = {};
    app.setSetting('perfHud', true);
    for (let f = 0; f < 40; f++) g.frame(1 / 30);
    const el = document.getElementById('perf-hud');
    out.on = !!el && /fps/.test(el.textContent) && /calls/.test(el.textContent);
    app.setSetting('perfHud', false); g.frame(1 / 30);
    out.off = !document.getElementById('perf-hud');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F3' })); g.frame(1 / 30);
    out.f3 = !!document.getElementById('perf-hud') && app.settings.perfHud === true;
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'F3' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F3' })); g.frame(1 / 30);
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'F3' }));
    out.f3off = !document.getElementById('perf-hud');
    // a long list shows 60 rows and a "show more" button, then 120
    const ui = g.ui, rows = Array.from({ length: 150 }, (_, i) => `<i class="r">${i}</i>`);
    ui._win = {};
    const div = document.createElement('div');
    div.innerHTML = ui.windowRows('probe', rows);
    out.first = div.querySelectorAll('.r').length; out.more = !!div.querySelector('[data-act="winMore"]');
    ui.actions.winMore('probe');
    div.innerHTML = ui.windowRows('probe', rows);
    out.second = div.querySelectorAll('.r').length;
    const d = JSON.parse(app.diagnostics());
    out.diag = !!d.perf && typeof d.perf.calls === 'number' && d.startMs > 0;
    return out;
  });
  check(hud.on && hud.off && hud.f3 && hud.f3off, 'the performance overlay: Settings switch and F3 turn it on and off');
  check(hud.first === 60 && hud.more && hud.second === 120, `long lists are windowed: ${hud.first} rows, then ${hud.second}`);
  check(hud.diag, 'diagnostics carry the frame breakdown and the world build time');
  if (errors.length) { ok = false; lines.push('errors: ' + errors.slice(0, 3).join(' | ')); }
  await ctx.close();
  return { ok, lines };
}
