// Offline, static and private (Phase 14): once the service worker holds the
// release, the whole game plays with the network switched off — a new game,
// loading a save, FIND, the catalogue description, the metro tool, road
// traffic, saving — without a console error. Over the whole session no
// request leaves the local origin, and nothing the player types (FIND, the
// catalogue description) appears in any request. With STATIC_ROOT the same
// runs against the unpacked release artifact.
import { openPage, startTestGame, loadSave } from '../lib.mjs';

export const name = 'offline';
const SECRET = 'zqprivacy42';

export async function run({ browser, base }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 1280, height: 800 } });
  const origin = new URL(base).origin;
  const reqs = [];
  ctx.on('request', (r) => reqs.push({ url: r.url(), post: r.postData() || '', offline: false }));
  // (the listener sees the whole session: reload once online)
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__tracklands && window.__tracklands.renderer, null, { timeout: 30000 });
  const ready = await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    for (let i = 0; i < 150 && !navigator.serviceWorker.controller; i++) await new Promise((r) => setTimeout(r, 100));
    return !!navigator.serviceWorker.controller;
  }).catch(() => false);
  check(ready, 'the service worker controls the page (the release is cached)');

  await ctx.setOffline(true);
  const mark = reqs.length;
  let r = null;
  try {
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__tracklands && window.__tracklands.renderer, null, { timeout: 30000 });
    await startTestGame(page, 4040);
    r = await page.evaluate(async (SECRET) => {
      const app = window.__tracklands, g = app.game, ui = app.ui, C = await import('./src/config.js');
      const out = {};
      for (let i = 0; i < 120; i++) g.tick(1 / 30);
      out.newGame = g.running && g.towns.list.length > 0;
      // FIND and the catalogue description, with a word no server may ever see
      out.find = ui.searchResults('Bahnhof ' + SECRET).length >= 0 && ui.searchResults('money').length > 0;
      ui.openPanel('search'); ui.searchQuery = SECRET + ' demolish'; ui.refreshPanel(); ui.closePanel();
      ui.openPanel('collection'); const c = ui.catApplyNl('fast electric freight loco ' + SECRET); ui.refreshPanel();
      out.catalog = c.sort === 'speed' && c.energy === 'electric' && (c.nl.unknown || []).includes(SECRET);
      ui.closePanel();
      // the metro tool
      for (const x of C.RESEARCH) g.progression.research.add(x.id);
      g.progression.recomputeFx && g.progression.recomputeFx();
      ui.actions.findCmd('metro:1');
      out.metro = g.construction.tool === 'track' && g.construction.layer === 1;
      g.construction.setTool('select'); g.construction.setLayer(0); while (g.layerView.showsUnderground()) g.layerView.cycle();
      // road traffic
      for (const t of g.towns.list) t.pop *= 4;
      for (let i = 0; i < 900; i++) g.tick(1 / 30);
      out.cars = g.traffic ? g.traffic.cars.length : 0;
      // save to the browser's storage and read it back
      await app.store.put('offline_probe', JSON.parse(JSON.stringify(g.serialize())));
      const back = await app.store.get('offline_probe');
      out.saved = !!(back && back.net && back.seed === g.world.seed && back.towns);
      window.__osave = back;
      await app.store.remove('offline_probe');
      return out;
    }, SECRET);
    // load that save, offline
    await loadSave(page, await page.evaluate(() => window.__osave));
    r.loaded = await page.evaluate(() => { const g = window.__tracklands.game; for (let i = 0; i < 60; i++) g.tick(1 / 30); return g.running && g.towns.list.length > 0; });
  } catch (e) { lines.push('offline session failed: ' + e.message.split('\n')[0]); }
  if (r) {
    check(r.newGame, 'offline: a new game starts and runs');
    check(r.loaded, 'offline: a saved game loads and runs');
    check(r.find && r.catalog, 'offline: FIND and the catalogue description work');
    check(r.metro, 'offline: the metro tool opens on the tunnel level');
    check(r.cars > 0, `offline: road traffic runs (${r.cars} cars)`);
    check(r.saved, 'offline: the game saves to browser storage and reads back');
  } else check(false, 'offline session');
  await ctx.setOffline(false);
  const off = reqs.slice(mark);
  const foreign = reqs.filter((q) => !q.url.startsWith(origin) && !q.url.startsWith('data:') && !q.url.startsWith('blob:'));
  const leak = reqs.filter((q) => q.url.includes(SECRET) || q.post.includes(SECRET));
  check(!foreign.length, `${reqs.length} requests in the session (${off.length} while offline), none to another host${foreign.length ? ': ' + foreign.slice(0, 3).map((q) => q.url).join(', ') : ''}`);
  check(!leak.length, `nothing typed into FIND or the catalogue appears in any request${leak.length ? ': ' + leak.slice(0, 2).map((q) => q.url).join(', ') : ''}`);
  const consoleErr = errors.filter((e) => !/net::ERR_INTERNET_DISCONNECTED|Failed to fetch|NetworkError|Load failed/.test(e));
  check(!consoleErr.length, `no console or page errors${consoleErr.length ? ': ' + consoleErr.slice(0, 3).join(' | ') : ''}${errors.length > consoleErr.length ? ` (${errors.length - consoleErr.length} expected offline fetch notices)` : ''}`);
  await ctx.close();
  return { ok, lines };
}
