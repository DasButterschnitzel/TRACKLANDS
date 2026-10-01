// Economy balance: a scripted early game with real money (standard
// difficulty, starting region) on several worlds. Checks that the start is
// affordable, the first line pays for itself within minutes, money never
// runs dry, operating costs stay well below income and the player levels up.
import { openPage, startTestGame } from '../lib.mjs';

const SEEDS = [11, 23, 57, 90, 314];
export const name = 'economy';
export async function run({ browser, base, quick }) {
  const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 800, height: 600 } });
  const lines = [];
  let ok = true;
  for (const seed of quick ? SEEDS.slice(0, 2) : SEEDS) {
    await startTestGame(page, seed, { difficulty: 'standard' });
    const r = await page.evaluate(() => window.__tracklands.game.runEconomySim(30, 1));
    if (r.error) { lines.push(`FAIL seed ${seed}: ${r.error} ${r.log.join(' | ')}`); ok = false; continue; }
    // intended balance (measured on 5 worlds when this suite was written):
    // a cozy start (first line costs ~60% of the starting money and a first
    // train pays for itself in 1.5-2 min), break-even of the whole setup in
    // 5-7 min, operating costs a small share of income, level ~9-11 after
    // 30 min. Bands leave room for tuning without breaking the pacing.
    const checks = [
      ['setup <= 75% of start money', r.setupPax <= r.start * 0.75],
      ['money never negative', r.minMoney >= 0],
      ['break-even 3-15 min', r.breakEven != null && r.breakEven >= 3 && r.breakEven <= 15],
      ['first train payback 1-6 min', r.paxPayback != null && r.paxPayback >= 1 && r.paxPayback <= 6],
      ['operating < 25% of income', r.incomeLast10 > 4 * r.opPerMin],
      ['level 5-16 after 30 min', r.level >= 5 && r.level <= 16],
    ];
    const bad = checks.filter(([, v]) => !v).map(([k]) => k);
    if (bad.length) ok = false;
    lines.push(`${bad.length ? 'FAIL' : 'ok  '} seed ${seed}: start ${r.start} setup ${r.setupPax}${r.setupFreight ? ` +freight ${r.setupFreight}@${r.freightAt}m` : ''} · dist ${r.paxDist} · min ${r.minMoney} · break-even ${r.breakEven}m · pax ${r.paxTrainPerMin}/min payback ${r.paxPayback}m · income ${r.incomeLast10}/min op ${r.opPerMin}/min · level ${r.level} · trips ${r.trips.join('/')}${bad.length ? ' · ' + bad.join(', ') : ''}`);
  }
  // diminishing returns: a line's passengers are limited, so extra trains on
  // the same line add far less than the first one did (no train spam)
  for (const seed of quick ? SEEDS.slice(0, 1) : SEEDS.slice(0, 2)) {
    await startTestGame(page, seed, { difficulty: 'standard' });
    const base = await page.evaluate(() => window.__tracklands.game.runEconomySim(30, 1));
    await startTestGame(page, seed, { difficulty: 'standard' });
    const more = await page.evaluate(() => window.__tracklands.game.runEconomySim(30, 1, { extraPax: [8, 12, 16] }));
    const gain = more.incomeLast10 / Math.max(1, base.incomeLast10);
    const good = gain < 1.8 && more.perTrain[0] < base.perTrain[0];
    if (!good) ok = false;
    lines.push(`${good ? 'ok  ' : 'FAIL'} seed ${seed}: 4 trains on one line earn ${gain.toFixed(2)}x one train (${more.incomeLast10} vs ${base.incomeLast10}/min; per train ${more.perTrain.join('/')})`);
  }
  if (errors.length) { ok = false; lines.push('errors: ' + errors.slice(0, 3).join(' | ')); }
  await ctx.close();
  return { ok, lines };
}
