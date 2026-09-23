// In-game railway scenarios (same as index.html?railtest).
import { openPage, startTestGame } from '../lib.mjs';

export const name = 'rail';
export async function run({ browser, base }) {
  const { ctx, page, errors } = await openPage(browser, base);
  await startTestGame(page, 424242);
  const res = await page.evaluate(() => window.__tracklands.game.runRailTests());
  await ctx.close();
  const lines = res.map((x) => `${x.ok ? 'ok  ' : 'FAIL'} ${x.name} — ${x.detail}`);
  if (errors.length) lines.push('errors: ' + errors.slice(0, 3).join(' | '));
  return { ok: res.length >= 8 && res.every((x) => x.ok) && !errors.length, lines };
}
