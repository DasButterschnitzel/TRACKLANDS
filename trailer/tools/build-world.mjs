// Builds the trailer's showcase world (development only) through the game's
// own code and writes a save after each era to trailer/saves/:
//
//   node trailer/tools/build-world.mjs [--from=<save>] --phases=A,B,... [--stills]
//
// The phases are in trailer/tools/world.page.js. --from continues from a
// save written by an earlier phase, so each era can be rebuilt on its own.
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { startServer, launchBrowser, ROOT } from '../../tests/lib.mjs';

const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; }));
const TR = path.join(ROOT, 'trailer');
const phases = String(args.phases || 'A').split(',');
const W = 1600, H = 900;

const { server, url } = await startServer();
const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: W, height: H } });
await ctx.addInitScript(() => {
  localStorage.setItem('tracklands.settings', JSON.stringify({ graphics: 'high', shadows: 'high', lang: 'en', tutorial: false, tips: false }));
  let s = 4242; Math.random = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); else if (m.text().startsWith('[w]')) console.log(m.text()); });
page.on('dialog', (d) => d.dismiss().catch(() => {}));
await page.goto(url + '/index.html');
await page.waitForFunction(() => window.__tracklands && window.__tracklands.renderer, null, { timeout: 90000 });

if (args.from) {
  const raw = fs.readFileSync(path.join(TR, 'saves', args.from));
  const save = JSON.parse(zlib.gunzipSync(raw).toString('utf8'));
  await page.evaluate((s) => { const app = window.__tracklands; document.querySelectorAll('.modal-wrap').forEach((m) => m.remove()); app.startGame({ save: s, test: true, paused: true }); }, save);
} else {
  await page.evaluate(() => {
    const app = window.__tracklands;
    document.querySelectorAll('.modal-wrap').forEach((m) => m.remove());
    app.startGame({ seed: 515, difficulty: 'builder', test: true, paused: true, mapSize: 128, startYear: 1900, rivals: 2, rivalTiming: 'late',
      terrain: { preset: 'continental', towns: 0.6, fields: 0.7, forest: -0.1, lakes: 0 } });
  });
}
await page.waitForFunction(() => window.__tracklands.game && window.__tracklands.game.running, null, { timeout: 180000 });
await page.evaluate(() => { const g = window.__tracklands.game; g.tutorial.skip(); g.speed = 0; g.news.mute = true; document.querySelectorAll('.modal-wrap').forEach((m) => m.remove()); });

for (const ph of phases) {
  const t0 = Date.now();
  const res = await page.evaluate(async (ph) => {
    const W = await import('/trailer/tools/world.page.js');
    try { const out = await W['phase' + ph](); return { ok: true, out, sum: W.S.summary() }; } catch (e) { return { ok: false, err: String(e && e.stack || e), sum: W.S.summary() }; }
  }, ph);
  console.log(`== phase ${ph} (${Math.round((Date.now() - t0) / 1000)} s)`, JSON.stringify(res, null, 1).slice(0, 6000));
  if (!res.ok) break;
  const save = await page.evaluate(() => JSON.stringify(window.__tracklands.game.serialize()));
  const name = res.out && res.out.save;
  if (name) {
    fs.writeFileSync(path.join(TR, 'saves', name), zlib.gzipSync(save, { level: 9 }));
    console.log(`wrote saves/${name} (${Math.round(save.length / 1024)} KB raw)`);
  }
  // review stills: [label, x, z, zoom, az]
  for (const [label, x, z, zoom, az, ui] of (res.out && res.out.stills) || []) {
    if (!args.stills) break;
    await page.evaluate(([x, z, zoom, az, ui]) => {
      const g = window.__tracklands.game, C = g.camera;
      document.body.classList.toggle('photo-mode', !ui); document.body.classList.toggle('photo-nolabels', ui === 0);
      C.target.set(x, 0, z); C.viewSize = C.zoomGoal = zoom; C.azimuth = C.azGoal = az * Math.PI / 180; C.focusGoal = null;
      g.env.timeOfDay = 0.4; g.env.weather = 'clear';
      for (let k = 0; k < 4; k++) g.frame(1 / 30);
      for (let k = 0; k < 40; k++) g.world.view.update(0.25, k);
    }, [x, z, zoom, az, ui]);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `/tmp/still-${ph}-${label}.png` });
    console.log(`still /tmp/still-${ph}-${label}.png`);
  }
}
if (errors.length) console.log('PAGE ERRORS:', errors.slice(0, 8).join('\n'));
await browser.close();
server.close();
