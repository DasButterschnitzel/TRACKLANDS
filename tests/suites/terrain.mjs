// Terrain presets in the game (Phase 10): the new-game dialog on a phone
// (preset, advanced parameters, preview with towns and a cost breakdown, the
// mega-map warning), a preset game started by touch that saves its terrain
// and rebuilds the same world, the climates reaching the regions, farmland
// on the ground, and a classic production save that is left as it was.
import { openPage, loadSave, productionSave, ensureOut, ENGINE } from '../lib.mjs';
import path from 'path';

export const name = 'terrain';
export async function run({ browser, base }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  const out = ensureOut();
  // (Firefox has no mobile emulation)
  const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 390, height: 844 }, hasTouch: true, deviceScaleFactor: 2, ...(ENGINE !== 'firefox' ? { isMobile: true } : {}) });
  await page.waitForFunction(() => window.__tracklands && window.__tracklands.ui, null, { timeout: 30000 });
  await page.evaluate(() => { const app = window.__tracklands; if (app.game) { app.ui.detach(); app.game.dispose(); app.game = null; } app.newGameDialog(); });
  await page.waitForSelector('#ng-terrain');
  const opts = await page.$$eval('#ng-terrain option', (os) => os.map((o) => o.value));
  check(opts.length >= 13 && opts[0] === 'classic', `the dialog offers ${opts.length} terrains (${opts.join(', ')})`);
  await page.selectOption('#ng-terrain', 'alpine');
  await page.waitForFunction(() => /\d+%/.test((document.querySelector('#ng-tstats') || {}).textContent || ''), null, { timeout: 10000 });
  const a = await page.evaluate(() => ({
    desc: document.querySelector('#ng-tdesc').textContent,
    relief: document.querySelector('[data-tp=relief]').value, passes: document.querySelector('[data-tp=passes]').checked,
    stats: document.querySelector('#ng-tstats').textContent,
  }));
  check(a.relief === '2.1' && a.passes && a.desc.length > 20, `choosing Alpine fills its parameters (relief ${a.relief}, passes ${a.passes})`);
  check(/Tunnel|tunnel/.test(a.stats), `the preview shows shares and a cost breakdown: “${a.stats.slice(0, 120)}…”`);
  // advanced: open, move a slider with a tap-sized control
  await page.tap('#ng-tadv summary');
  await page.evaluate(() => { const r = document.querySelector('[data-tp=rivers]'); r.value = '4'; r.dispatchEvent(new Event('input', { bubbles: true })); });
  const o = await page.$eval('[data-tpo=rivers]', (e) => e.textContent);
  check(o === '4', 'an advanced slider shows its value');
  const overflow = await page.evaluate(() => { const m = document.querySelector('.modal'); return m ? m.scrollWidth - m.clientWidth : 99; });
  check(overflow <= 1, `the dialog fits a phone without sideways scrolling (${overflow}px)`);
  await page.screenshot({ path: path.join(out, 'terrain-dialog-phone.png') });
  // the mega preset suggests the biggest map and warns about it
  await page.selectOption('#ng-terrain', 'continental');
  const m = await page.evaluate(() => ({ size: document.querySelector('input[name=size]:checked').value, warn: !document.querySelector('#ng-mega').hidden }));
  check(m.size === '192' && m.warn, `Continental picks 192 × 192 and warns (size ${m.size}, warning ${m.warn})`);
  await page.tap('.modal input[name=size][value="64"]');
  check(await page.evaluate(() => document.querySelector('#ng-mega').hidden), 'a smaller map hides the warning');
  // start an alpine game with four rivers, by touch
  await page.selectOption('#ng-terrain', 'alpine');
  await page.evaluate(() => { const r = document.querySelector('[data-tp=rivers]'); r.value = '4'; r.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.fill('#ng-seed', '2024');
  await page.tap('.modal [data-mbtn=go]');
  await page.waitForFunction(() => window.__tracklands.game && window.__tracklands.game.running, null, { timeout: 60000 });
  const g1 = await page.evaluate(async () => {
    const g = window.__tracklands.game, S = await import('./src/save/Save.js');
    g.tutorial.skip && g.tutorial.skip();
    const d = S.migrate(JSON.parse(JSON.stringify(g.serialize())));
    window.__tsave = d;
    let mtn = 0; for (let i = 0; i < g.world.type.length; i++) if (g.world.type[i] === 2) mtn++;
    return { terrain: d.terrain, worldGen: d.worldGen, sig: JSON.stringify([[...g.world.type].join(''), g.world.towns.map((t) => [t.x, t.z])]), mtn: Math.round(mtn / g.world.type.length * 100) };
  });
  check(g1.terrain && g1.terrain.preset === 'alpine' && g1.terrain.rivers === 4 && g1.worldGen === 4, `the save keeps the terrain (${JSON.stringify(g1.terrain)}, generator v${g1.worldGen}); ${g1.mtn}% mountains`);
  await loadSave(page, await page.evaluate(() => window.__tsave));
  const sig2 = await page.evaluate(() => { const W = window.__tracklands.game.world; return JSON.stringify([[...W.type].join(''), W.towns.map((t) => [t.x, t.z])]); });
  check(sig2 === g1.sig, 'loading it rebuilds the same world');
  await page.screenshot({ path: path.join(out, 'terrain-alpine-phone.png') });
  // climates and farmland
  const worlds = {};
  for (const p of ['snowland', 'plains', 'archipelago']) {
    await page.evaluate((preset) => {
      const app = window.__tracklands;
      document.querySelectorAll('.modal-wrap').forEach((x) => x.remove());
      if (app.game) { app.ui.detach(); app.game.dispose(); app.game = null; }
      app.startGame({ seed: 4242, difficulty: 'builder', test: true, paused: true, mapSize: 64, terrain: { preset } });
    }, p);
    await page.waitForFunction(() => window.__tracklands.game && window.__tracklands.game.running, null, { timeout: 60000 });
    worlds[p] = await page.evaluate(() => {
      const g = window.__tracklands.game, W = g.world;
      let f = 0, w = 0; for (let i = 0; i < W.type.length; i++) { if (W.fields && W.fields[i]) f++; if (W.type[i] === 1) w++; }
      const card = g.app ? null : null; // eslint-disable-line no-unused-vars
      return { biomes: W.biomes, fields: f, water: Math.round(w / W.type.length * 100), roofs: g.towns.list.length };
    });
    await page.screenshot({ path: path.join(out, `terrain-${p}-phone.png`) });
  }
  check(worlds.snowland.biomes.every((b) => ['pine', 'snow', 'industrial'].includes(b)), `snowland regions are cold (${[...new Set(worlds.snowland.biomes)].join(', ')})`);
  check(worlds.plains.fields > 100, `the plains have farmland on the ground (${worlds.plains.fields} tiles)`);
  check(worlds.archipelago.water > 20, `the archipelago is mostly islands (${worlds.archipelago.water}% water)`);
  // a classic save stays classic
  await loadSave(page, productionSave());
  const pc = await page.evaluate(() => { const g = window.__tracklands.game; return { terrain: g.serialize().terrain, fields: !!g.world.fields, biomes: g.world.biomes.join(',') }; });
  check(pc.terrain === undefined && !pc.fields, `the production save keeps its classic world (no terrain spec, no farmland; ${pc.biomes})`);
  if (errors.length) { ok = false; lines.push('errors: ' + errors.slice(0, 3).join(' | ')); }
  await ctx.close();
  return { ok, lines };
}
