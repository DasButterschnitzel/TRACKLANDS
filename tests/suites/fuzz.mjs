// Seeded railway simulation fuzzer (src/debug/RailFuzz.js).
//   seeds: permanent regression seeds (tests/regression-seeds.json)
//   fuzz:  a seed range (default 1-40, quick 1-8)
import { openPage, startTestGame, regressionSeeds } from '../lib.mjs';

async function runSeeds(browser, base, seeds, minutes) {
  const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 800, height: 600 } });
  const lines = [];
  let ok = true;
  for (const seed of seeds) {
    await startTestGame(page, seed * 1013);
    const r = await page.evaluate(([s, m]) => { const t0 = performance.now(); const r = window.__tracklands.game.runRailFuzz(s, m); r.ms = Math.round(performance.now() - t0); delete r.trace; return r; }, [seed, minutes]);
    if (!r.ok) ok = false;
    lines.push(`${r.ok ? 'ok  ' : 'FAIL'} seed ${seed} ${r.skipped ? '(no network) ' : ''}${r.detail} ${r.ms}ms`);
    for (const k of ['firstGraph', 'firstHeading', 'firstGeo', 'firstGap', 'firstOverlap', 'stuckInfo', 'lastError', 'states']) if (!r.ok && r[k]) lines.push('     ' + k + ': ' + String(r[k]).slice(0, 700));
    if (errors.length) { ok = false; lines.push('     page errors: ' + errors.splice(0).slice(0, 3).join(' | ')); }
  }
  await ctx.close();
  return { ok, lines };
}

export const seeds = {
  name: 'seeds',
  async run({ browser, base, quick }) {
    const list = regressionSeeds().rail;
    return runSeeds(browser, base, quick ? list.filter((s) => [2, 20, 23, 46].includes(s)) : list, 12);
  },
};
export const fuzz = {
  name: 'fuzz',
  async run({ browser, base, quick, args }) {
    const a = +(args.from || 1), b = +(args.to || (quick ? 8 : 40));
    const list = []; for (let s = a; s <= b; s++) list.push(s);
    return runSeeds(browser, base, list, +(args.minutes || 12));
  },
};
