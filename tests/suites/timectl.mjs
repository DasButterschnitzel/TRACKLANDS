// Phase 7 time: game speeds up to 8× run the same simulation (fixed steps;
// 60 game seconds at 8× match 60 at 1×, no collisions or deadlocks), the
// day length setting changes only the day/night cycle, extreme weather
// (off by setting) and the weather's effect on travel demand, eras.
import { openPage, loadSave, productionSave } from '../lib.mjs';

export const name = 'timectl';
export async function run({ browser, base }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 1280, height: 800 } });
  const runAt = async (speed) => {
    await loadSave(page, productionSave());
    return page.evaluate((sp) => {
      const g = window.__tracklands.game;
      g.settings.weather = false;
      const inc0 = g.ledger.transportRevenue(), t0 = g.time, dl0 = g.trains.incidents.length, col0 = g.trains.collisions;
      g.running = true;
      if (sp === 1) { while (g.time - t0 < 60) g.tick(1 / 30); } else { g.setSpeed(sp); while (g.time - t0 < 60 - 1e-6) g.frame(1 / 30); g.setSpeed(0); }
      return { dt: g.time - t0, rev: Math.round(g.ledger.transportRevenue() - inc0), deadlocks: g.trains.incidents.length - dl0, collisions: g.trains.collisions - col0, eff: g.effSpeed, pos: g.trains.trains.map((t) => t.steps.length ? t.steps[0].tile ?? 0 : 0).join(',') };
    }, speed);
  };
  const a = await runAt(1);
  const b = await runAt(8);
  check(Math.abs(b.dt - a.dt) < 0.05, `the same game time at 1× and 8× (${a.dt.toFixed(2)} / ${b.dt.toFixed(2)} s)`);
  check(Math.abs(a.rev - b.rev) <= Math.max(20, a.rev * 0.05), `8× earns what 1× does (${a.rev} vs ${b.rev})`);
  check(b.collisions === 0 && a.collisions === 0 && b.deadlocks <= a.deadlocks, `8×: no collisions (${b.collisions}), no more deadlock recoveries than 1× (${b.deadlocks} vs ${a.deadlocks})`);
  check(a.pos === b.pos, 'trains stand at the same places after the same time at 1× and 8×');
  check(b.eff > 1, `effective speed reported (${b.eff.toFixed(1)}×)`);
  const r = await page.evaluate(async () => {
    const g = window.__tracklands.game, E = g.env, out = {};
    const { WEATHER } = await import('./src/world/Environment.js');
    out.speeds = [0, 1, 2, 4, 8].map((s) => { g.setSpeed(s); return g.speed; });
    g.setSpeed(3); out.bad = g.speed; g.setSpeed(0);
    // day length: only the day/night cycle
    g.settings.dayNight = true;
    const cyc = (mode) => { g.settings.dayLength = mode; E.timeOfDay = 0.1; const m0 = g.ledger.monthIndex(); E.update(0.016, 60, 0); return { d: E.timeOfDay - 0.1, m: g.ledger.monthIndex() - m0 }; };
    out.day = { short: cyc('short').d, normal: cyc('normal').d, long: cyc('long').d };
    g.settings.dayLength = 'normal';
    // extreme weather: never drawn when off; drawn in summer/winter when on
    g.settings.weather = true;
    const draws = (on, season) => { g.settings.extremeWeather = on; const s = new Set(); for (let i = 0; i < 400; i++) s.add(E.draw('clear', season)); return [...s]; };
    out.offSummer = draws(false, 'summer'); out.onSummer = draws(true, 'summer'); out.onWinter = draws(true, 'winter');
    out.extremeSafe = WEATHER.heatwave.speed > 0.5 && WEATHER.blizzard.speed > 0.5;
    E.weather = 'blizzard'; out.blizzardDemand = E.demandMul();
    E.weather = 'clear'; out.clearDemand = E.demandMul();
    g.ui.closePanel(); g.ui.openPanel('settings');
    await new Promise((res) => setTimeout(res, 50));
    out.ui = { day: !!document.querySelector('[data-key="dayLength"]'), ext: !!document.querySelector('[data-key="extremeWeather"]'), eight: !!document.querySelector('.spd[data-arg="8"]') };
    g.ui.closePanel();
    // eras: a new one is announced
    out.eras = [1955, 1965, 1985, 2010, 2040].map((y) => g.ledger.era(y));
    const L = g.ledger, n0 = g.news.items.length;
    L.startYear = 1959 - Math.floor(L.monthIndex() / 12);
    const m = L.monthIndex();
    const toDec = (11 - (m % 12) + 12) % 12;
    g.time = (m + toDec + 1) * 60 - 0.5;
    L.roll();
    g.tick(1);
    out.eraNews = g.news.items.slice(n0).some((it) => it.key === 'news_era');
    out.era = L.era();
    return out;
  });
  check(r.speeds.join(',') === '0,1,2,4,8' && r.bad === 1, `speeds ${r.speeds.join('/')} (invalid → ${r.bad})`);
  check(r.day.short > r.day.normal * 1.9 && r.day.long < r.day.normal * 0.55, `day length: short ${r.day.short.toFixed(3)}, normal ${r.day.normal.toFixed(3)}, long ${r.day.long.toFixed(3)} of a day per minute`);
  check(!r.offSummer.includes('heatwave') && r.onSummer.includes('heatwave') && r.onWinter.includes('blizzard') && r.extremeSafe, `extreme weather only when on: summer ${r.onSummer.join('/')}, winter ${r.onWinter.join('/')}`);
  check(r.blizzardDemand < r.clearDemand, `fewer trips in a blizzard (×${r.blizzardDemand})`);
  check(r.ui.day && r.ui.ext && r.ui.eight, 'settings for day length and extreme weather, an 8× button');
  check(r.eras.join(',') === 'steam,diesel,electric,modern,future' && r.eraNews && r.era === 'diesel', `eras ${r.eras.join(', ')}; a new era is announced (${r.era})`);
  if (errors.length) { ok = false; lines.push('errors: ' + errors.slice(0, 3).join(' | ')); }
  await ctx.close();
  return { ok, lines };
}
