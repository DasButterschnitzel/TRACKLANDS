// Phase 8 campaign and new games: medals by how early a scenario is won
// (kept, only improved), the campaign opening chapter by chapter, the new
// goal kinds, winning with a medal in a running game, the new-game presets
// and map preview, quick start from the title.
import { openPage, startTestGame } from '../lib.mjs';

export const name = 'campaign';
export async function run({ browser, base }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 1280, height: 800 } });
  await startTestGame(page, 777);
  const r = await page.evaluate(async () => {
    const out = {};
    const S = await import('./src/world/Scenarios.js');
    const M = await import('./src/ui/ScenarioMenu.js');
    localStorage.removeItem('tracklands.medals');
    const vl = S.SCENARIOS[0];
    out.medals = [vl.startYear + 5, vl.startYear + 10, vl.startYear + 14].map((y) => S.medalFor(vl, y));
    out.open0 = S.SCENARIOS.map((_, i) => M.campaignOpen(i));
    M.awardMedal('valley_link', 'silver');
    M.awardMedal('valley_link', 'bronze');          // never a worse one
    out.kept = M.loadMedals().valley_link;
    out.open1 = S.SCENARIOS.map((_, i) => M.campaignOpen(i));
    // the new goal kinds count in a game
    const g = window.__tracklands.game;
    const run = new S.ScenarioRun(g, { ...S.cleanScenario(S.SCENARIOS[5]), custom: false });
    out.goalKinds = run.goals().map((x) => x.k + ':' + Math.round(x.have));
    // winning a scenario in the game: a medal, the next chapter
    localStorage.removeItem('tracklands.medals');
    const sc = { ...S.cleanScenario(S.SCENARIOS[0]), custom: false };
    g.scenario = new S.ScenarioRun(g, sc);
    g.ledger.startYear = sc.startYear - Math.floor(g.ledger.monthIndex() / 12);   // the first year of the scenario
    g.scenario.goals = () => sc.goals.map((x) => ({ ...x, have: x.n, done: true }));
    g.scenario.tick(2);
    await new Promise((res) => setTimeout(res, 60));
    out.state = g.scenario.state;
    out.medal = g.scenario.medal;
    out.stored = M.loadMedals().valley_link;
    out.modal = document.body.textContent.includes(g.ui.tr('medal_won', { m: g.ui.tr('medal_gold') }));
    document.querySelectorAll('.modal-wrap').forEach((m) => m.remove());
    return out;
  });
  check(r.medals.join() === 'gold,silver,bronze', `medals by how early: ${r.medals.join(', ')}`);
  check(r.open0[0] && !r.open0[1], 'only the first chapter is open at first');
  check(r.kept === 'silver' && r.open1[1] && !r.open1[2], 'a medal is kept (never replaced by a worse one) and opens the next chapter');
  check(r.goalKinds.some((x) => x.startsWith('reputation:')) && r.goalKinds.length === 3, `new goal kinds count: ${r.goalKinds.join(', ')}`);
  check(r.state === 'won' && r.medal === 'gold' && r.stored === 'gold' && r.modal, 'winning early in a game earns gold, shown and kept');
  // the title: new game presets and preview, quick start
  const t = await page.evaluate(async () => {
    const app = window.__tracklands, out = {};
    app.ui.detach(); app.game.dispose(); app.game = null; app.save = null;
    app.showTitle();
    await new Promise((res) => setTimeout(res, 50));
    out.quick = !!document.querySelector('#title [data-t="quick"]');
    app.newGameDialog();
    await new Promise((res) => setTimeout(res, 400));
    const c = document.querySelector('#ng-map');
    const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let colours = new Set();
    for (let i = 0; i < px.length; i += 4 * 37) colours.add(px[i] + ',' + px[i + 1] + ',' + px[i + 2]);
    out.preview = { w: c.width, colours: colours.size };
    document.querySelector('input[name=size][value="96"]').checked = true;
    document.querySelector('input[name=size][value="96"]').dispatchEvent(new Event('change'));
    await new Promise((res) => setTimeout(res, 500));
    out.preview96 = document.querySelector('#ng-map').width;
    document.querySelector('[data-preset="tycoon"]').click();
    out.tycoon = { rel: document.querySelector('#ng-rel').value, rivals: document.querySelector('#ng-rivals').value, ind: document.querySelector('#ng-ind').value };
    document.querySelector('[data-preset="builder"]').click();
    out.builder = { diff: document.querySelector('input[name=diff]:checked').value, rivals: document.querySelector('#ng-rivals').value };
    document.querySelectorAll('.modal-wrap').forEach((m) => m.remove());
    return out;
  });
  check(t.quick, 'the title offers a quick start');
  check(t.preview.w === 64 && t.preview.colours > 3 && t.preview96 === 96, `the map preview draws the world (${t.preview.colours} colours; 96 after choosing the size)`);
  check(t.tycoon.rel === 'tycoon' && t.tycoon.rivals === '3' && t.tycoon.ind === 'on' && t.builder.diff === 'relaxed' && t.builder.rivals === '0', 'presets fill in the choices');
  await page.click('#title [data-t="quick"]');
  await page.waitForFunction(() => window.__tracklands.game && window.__tracklands.game.running, null, { timeout: 60000 });
  const q = await page.evaluate(() => { const g = window.__tracklands.game; return { size: g.mapSize, rivals: g.rivals.list.length, diff: g.difficultyId }; });
  check(q.size === 64 && q.rivals === 1 && q.diff === 'standard', `quick start: a classic game (${JSON.stringify(q)})`);
  if (errors.length) { ok = false; lines.push('errors: ' + errors.slice(0, 3).join(' | ')); }
  await ctx.close();
  return { ok, lines };
}
