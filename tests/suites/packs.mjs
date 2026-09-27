// Phase 8 content packs: a pack served at assets/packs is checked entry by
// entry; good vehicles join the game under "<pack>.<id>" and can be bought,
// bad ones are left out with the reason in Settings; pack scenarios appear
// in the scenario menu; a pack can never replace a built-in vehicle.

export const name = 'packs';
export async function run({ browser, base }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const pack = {
    id: 'testpack', name: 'Test Pack', version: '1.2',
    vehicles: [
      { id: 'blue_bus', name: 'Blue Bus 40', kind: 'bus', cap: 40, speed: 60, price: 1200, op: 12, level: 1, color: '#2f6bd0', shape: 'urban' },
      { id: 'salt_truck', name: 'Salt Truck', kind: 'truck', groups: ['bulk'], cap: 20, speed: 55, price: 1400, op: 14 },
      { id: 'citybus', name: 'Fake', kind: 'bus', cap: 99, speed: 60, price: 1, op: 1 },
      { id: 'Bad Id', name: 'x', kind: 'bus', cap: 10, speed: 50, price: 100, op: 1 },
      { id: 'no_groups', name: 'Truck', kind: 'truck', cap: 10, speed: 50, price: 100, op: 1 },
      { id: 'too_fast', name: 'Rocket', kind: 'bus', cap: 10, speed: 99999, price: 100, op: 1, wings: true },
    ],
    scenarios: [{ id: 'salt_coast', name: 'Salt Coast', seed: 4242, mapSize: 64, difficulty: 'standard', startYear: 1950, deadline: 1970, money: 0, goals: [{ k: 'value', n: 80000 }] }, { id: 'broken', goals: [] }],
  };
  await ctx.route('**/assets/packs/index.json', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ packs: ['test.json'] }) }));
  await ctx.route('**/assets/packs/test.json', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(pack) }));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text().slice(0, 300)); });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.__tracklands && window.__tracklands.renderer, null, { timeout: 60000 });
  await page.waitForTimeout(500);
  const r = await page.evaluate(async () => {
    const { PACKS } = await import('./src/content/Packs.js');
    const { ROAD_VEHICLES } = await import('./src/config.js');
    const p = PACKS.list[0], out = {};
    out.loaded = { id: p.id, v: p.vehicles.map((m) => m.id), s: p.scenarios.map((s) => s.id), errors: p.errors.map((e) => e.where + ': ' + e.what) };
    out.citybus = ROAD_VEHICLES.find((m) => m.id === 'citybus').cap;
    out.inGame = ROAD_VEHICLES.some((m) => m.id === 'testpack.blue_bus') && ROAD_VEHICLES.some((m) => m.id === 'testpack.salt_truck');
    // settings list the pack and its problems
    const app = window.__tracklands;
    app.ui.openPanel('settings');
    await new Promise((res) => setTimeout(res, 50));
    const txt = document.body.textContent;
    out.settings = txt.includes('Test Pack') && txt.includes('bad:speed') && txt.includes('unknown:wings');
    app.ui.closePanel();
    // the scenario menu lists the pack scenario
    document.querySelector('#title [data-t="scenarios"]').click();
    await new Promise((res) => setTimeout(res, 100));
    out.scn = !!document.querySelector('[data-play="testpack_salt_coast"]');
    document.querySelectorAll('.modal-wrap').forEach((m) => m.remove());
    return out;
  });
  check(r.loaded.v.join() === 'testpack.blue_bus,testpack.salt_truck,testpack.citybus', `good vehicles load under the pack's name: ${r.loaded.v.join(', ')}`);
  check(r.citybus === 30, `a pack never replaces a built-in vehicle (citybus still ${r.citybus} seats)`);
  check(r.loaded.errors.length === 4 && r.loaded.errors.some((e) => e.includes('Bad Id') || e.includes('bad:id')) && r.loaded.errors.some((e) => e.includes('missing:groups')) && r.loaded.errors.some((e) => e.includes('bad:speed')), `bad entries are left out with a reason: ${r.loaded.errors.join(' | ')}`);
  check(r.loaded.s.join() === 'testpack_salt_coast', 'a good pack scenario loads, a broken one does not');
  check(r.inGame && r.settings && r.scn, 'pack vehicles are in the game, Settings lists the pack and its problems, the scenario menu offers its scenario');
  // buy a pack bus in a game
  await page.evaluate(() => { const app = window.__tracklands; app.startGame({ seed: 777, difficulty: 'builder', test: true, paused: true }); });
  await page.waitForFunction(() => window.__tracklands.game && window.__tracklands.game.running, null, { timeout: 60000 });
  const b = await page.evaluate(() => {
    const g = window.__tracklands.game, R = g.roads;
    g.tutorial.skip(); document.querySelectorAll('.modal-wrap').forEach((m) => m.remove());
    const t = g.towns.list.slice().sort((a, b) => b.pop - a.pop)[0];
    let s = null;
    for (const i of t.roadSet) { const x = R.addStop(i, 'bus'); if (x.stop) { s = x.stop; break; } }
    const v = s ? R.buy('testpack.blue_bus', s) : null;
    for (let i = 0; i < 30; i++) g.tick(1 / 30);
    g.roads.updateVisuals(0.03);
    return { bought: !!(v && v.vehicle), cap: v && v.vehicle ? R.capOf(v.vehicle) : 0, save: !!JSON.stringify(g.serialize()).includes('testpack.blue_bus') };
  });
  check(b.bought && b.cap === 40 && b.save, 'a pack bus can be bought, runs and is saved');
  if (errors.length) { ok = false; lines.push('errors: ' + errors.slice(0, 3).join(' | ')); }
  await ctx.close();
  return { ok, lines };
}
