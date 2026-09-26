// Seasons and weather (src/world/Environment.js): the seeded state machine in
// game time (valid states and durations, no snow outside winter and autumn,
// the same sequence for the same seed), the effect on train speed, snow that
// settles in winter and melts in spring, farm output by season, save/load, and
// the weather chip in the top bar (mouse and phone).
import path from 'path';
import { openPage, startTestGame, loadSave, ensureOut } from '../lib.mjs';

export const name = 'weather';
export async function run({ browser, base }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  const out = ensureOut();
  const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 1280, height: 800 } });

  // a year of weather, twice with the same seed
  const year = async () => {
    await startTestGame(page, 31);
    return page.evaluate(async () => {
      const g = window.__tracklands.game, E = g.env;
      const { WEATHER, SEASON_OF_MONTH } = await import('./src/world/Environment.js');
      g.settings.weather = true;
      const seq = [];
      let cur = E.weather, since = g.time, bad = [];
      for (let i = 0; i < 30 * 60 * 12; i++) {
        g.tick(1 / 30);
        if (E.weather !== cur) {
          const len = g.time - since;
          if (seq.length && (len < WEATHER[cur].dur[0] - 0.1 || len > WEATHER[cur].dur[1] + 0.1)) bad.push(cur + ' ' + len.toFixed(0));
          const season = SEASON_OF_MONTH[g.ledger.monthOfYear()];
          seq.push(E.weather + '@' + season);
          if (!WEATHER[E.weather]) bad.push('unknown ' + E.weather);
          if (E.weather === 'snow' && (season === 'spring' || season === 'summer')) bad.push('snow in ' + season);
          cur = E.weather; since = g.time;
        }
      }
      return { seq, bad, kinds: [...new Set(seq.map((s) => s.split('@')[0]))] };
    });
  };
  const y1 = await year(), y2 = await year();
  check(y1.seq.length >= 8 && y1.bad.length === 0, `a year of weather: ${y1.seq.length} changes, kinds ${y1.kinds.join(', ')}; problems: ${JSON.stringify(y1.bad.slice(0, 4))}`);
  check(y1.kinds.length >= 4, `the year sees at least four kinds of weather (${y1.kinds.length})`);
  check(JSON.stringify(y1.seq) === JSON.stringify(y2.seq), 'the same seed gives the same weather');

  // effects, snow cover, farms, save/load
  await startTestGame(page, 7);
  const r = await page.evaluate(async () => {
    const g = window.__tracklands.game, E = g.env, out = {};
    const { RailTests } = await import('./src/debug/RailTests.js');
    const RT = new RailTests(g);
    g.economy.coins = 1e6;
    g.settings.weather = true;
    for (let i = 0; i < 8; i++) g.progression.regions.add(i);
    const a = RT.findArea(30, 7);
    if (!a) return { none: true };
    const z = a.z0 + 3, x0 = a.x0 + 1;
    RT.line(x0, z, x0 + 27, z);
    RT.finish();
    const sA = RT.station(x0 + 2, z), sB = RT.station(x0 + 26, z);
    const D = RT.depot(x0 + 28, z);
    g.net.connect(z * 64 + x0 + 27, 0);
    RT.finish();
    const t = RT.train(['L:pioneer', 'W:coach'], D, [sA, sB]);
    const top = (w) => {
      E.weather = w; E.nextWeather = 1e6; E.effects.speed = 1; E.effects.accel = 1;
      let vmax = 0;
      // (the weather's effect eases in: only the top speed once it has settled counts)
      for (let i = 0; i < 30 * 150; i++) { g.tick(1 / 30); if (i > 30 * 40) vmax = Math.max(vmax, t.v || 0); }
      return vmax;
    };
    out.vClear = top('clear');
    out.fxStorm = null;
    out.vStorm = top('storm');
    out.fxStorm = E.effects.speed;
    // snow: set the calendar to January, let it snow for a month
    const Y = 720, y0 = Math.ceil(g.time / Y) * Y;
    g.time = y0 + 5;
    E.weather = 'snow'; E.nextWeather = 1e6;
    for (let i = 0; i < 30 * 70; i++) g.tick(1 / 30);
    out.season = E.season();
    out.cover = E.snowCover;
    const farm = g.industries.list.find((i) => i.type === 'FARM');
    out.farmWinter = farm ? g.industries.rate(farm) : 0;
    // save/load in winter with snow
    const S = await import('./src/save/Save.js');
    window.__wsave = S.migrate(JSON.parse(JSON.stringify(g.serialize())));
    out.saved = { w: E.weather, f: E.forecast, c: Math.round(E.snowCover * 1000) / 1000 };
    // March: it melts
    g.time = y0 + 2 * 60 + 5;
    E.weather = 'clear'; E.nextWeather = 1e6;
    for (let i = 0; i < 30 * 80; i++) g.tick(1 / 30);
    out.season2 = E.season();
    out.cover2 = E.snowCover;
    g.time = y0 + 9 * 60 + 5;
    out.farmAutumn = farm ? g.industries.rate(farm) : 0;
    out.season3 = E.season();
    return out;
  });
  check(!r.none, 'test layout built');
  if (!r.none) {
    check(r.vStorm < r.vClear * 0.97 && r.fxStorm < 0.92, `a storm slows trains (top speed ${r.vClear.toFixed(2)} → ${r.vStorm.toFixed(2)}, factor ${r.fxStorm && r.fxStorm.toFixed(3)})`);
    check(r.season === 'winter' && r.cover > 0.9, `snow settles in winter (cover ${r.cover.toFixed(2)})`);
    check(r.season2 === 'spring' && r.cover2 < 0.1, `snow melts in spring (${r.cover2.toFixed(2)})`);
    check(r.season3 === 'autumn' && r.farmAutumn > r.farmWinter * 1.5, `farms produce more at harvest (${r.farmWinter.toFixed(1)} in winter, ${r.farmAutumn.toFixed(1)} in autumn)`);
    const keep = await page.evaluate(() => window.__wsave);
    await loadSave(page, keep);
    const back = await page.evaluate(() => { const E = window.__tracklands.game.env; return { w: E.weather, f: E.forecast, c: Math.round(E.snowCover * 1000) / 1000 }; });
    check(JSON.stringify(back) === JSON.stringify(r.saved), `weather, forecast and snow cover are saved (${JSON.stringify(back)})`);
    // the snowy diorama, rendered
    await page.evaluate(() => { const g = window.__tracklands.game; g.settings.weather = true; g.speed = 1; });
    await page.waitForTimeout(1500);
    const u = await page.evaluate(() => window.__tracklands.game.world.view.uniforms.uSnow.value);
    check(u > 0.9, `the terrain shows the snow (uSnow ${u.toFixed(2)})`);
    await page.screenshot({ path: path.join(out, 'weather-snow.png') });
    // the chip in the top bar
    const chip = await page.$('#wx');
    const tip = chip ? await chip.getAttribute('data-tip') : '';
    check(!!chip && /Winter/.test(tip) && /Next|Danach/.test(tip), `the top bar shows weather and season: "${tip}"`);
    if (chip) { await chip.click(); await page.waitForTimeout(300); }
    const toast = await page.$$eval('.toast', (els) => els.map((e) => e.textContent).join(' | '));
    check(/Winter/.test(toast), 'clicking the weather chip explains it');
    await page.evaluate(() => { window.__tracklands.game.speed = 0; });
  }
  if (errors.length) { ok = false; lines.push('errors: ' + errors.slice(0, 2).join(' | ')); }
  await ctx.close();

  // phone: the chip fits in the top bar
  const ph = await openPage(browser, base, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await startTestGame(ph.page, 7);
  await ph.page.waitForTimeout(500);
  const fit = await ph.page.evaluate(() => { const tb = document.querySelector('#topbar'), wx = document.querySelector('#wx'); const r = wx && wx.getBoundingClientRect(); return { over: tb.scrollWidth - tb.clientWidth, wx: !!r && r.width > 0 && r.right <= innerWidth }; });
  check(fit.over <= 1 && fit.wx, `phone: the weather chip fits in the top bar (${JSON.stringify(fit)})`);
  if (fit.wx) { await ph.page.tap('#wx'); await ph.page.waitForTimeout(300); }
  const t2 = await ph.page.$$eval('.toast', (els) => els.length);
  check(t2 > 0, 'phone: tapping the chip explains the weather');
  if (ph.errors.length) { ok = false; lines.push('errors: ' + ph.errors.slice(0, 2).join(' | ')); }
  await ph.ctx.close();
  return { ok, lines };
}
