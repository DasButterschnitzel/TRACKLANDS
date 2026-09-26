// Scenarios (src/world/Scenarios.js, src/ui/ScenarioMenu.js): the title menu
// lists the built-in scenarios and starts one with its world, year and goals;
// the objectives panel shows the goals; reaching every goal wins, passing the
// deadline loses (play on freely); the run is saved; the editor makes a
// scenario that is kept, exported, imported and played.
import { openPage, loadSave } from '../lib.mjs';

export const name = 'scenarios';
export async function run({ browser, base }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 1280, height: 800 } });
  await page.evaluate(() => { try { localStorage.removeItem('tracklands.scenarios'); } catch (e) { /* ignore */ } });
  await page.waitForSelector('#title [data-t=scenarios]', { timeout: 30000 });
  await page.click('#title [data-t=scenarios]');
  await page.waitForTimeout(300);
  const list = await page.$$eval('.scn-list [data-play]', (els) => els.map((e) => e.dataset.play));
  check(list.join(',') === 'valley_link,coal_country,grand_network,modern_express', `the title menu lists the built-in scenarios (${list.join(', ')})`);
  await page.click('.scn-list [data-play=valley_link]');
  await page.waitForFunction(() => window.__tracklands.game && window.__tracklands.game.running, null, { timeout: 60000 });
  const st = await page.evaluate(() => { const g = window.__tracklands.game; g.tutorial.skip(); document.querySelectorAll('.modal-wrap').forEach((m) => m.remove()); return { sc: g.scenario && g.scenario.sc.id, year: g.ledger.year(), deadline: g.scenario && g.scenario.sc.deadline, goals: g.scenario && g.scenario.sc.goals.length, size: g.mapSize, seed: g.world.seed }; });
  check(st.sc === 'valley_link' && st.year === 1930 && st.deadline === 1945 && st.goals === 3 && st.size === 64 && st.seed === 1001, `Valley Link starts in its world and year (${JSON.stringify(st)})`);
  await page.click('.rail-btn[data-arg=objectives]');
  await page.waitForTimeout(300);
  const card = await page.$$eval('#panel .scn-card .chk', (els) => els.length);
  check(card === 3, `the objectives panel shows the ${card} scenario goals`);
  await page.evaluate(() => window.__tracklands.ui.closePanel());
  // win: make every goal reachable, then tick
  const won = await page.evaluate(() => {
    const g = window.__tracklands.game, R = g.scenario;
    R.sc.goals = [{ k: 'passengers', n: 10 }];
    g.stats.data.passengers = 12;
    for (let i = 0; i < 60; i++) g.tick(1 / 30);
    return { state: R.state, modal: !!document.querySelector('.modal-wrap .modal h2') };
  });
  check(won.state === 'won' && won.modal, `reaching every goal completes the scenario (${JSON.stringify(won)})`);
  await page.click('.modal [data-mbtn=ok]');
  // save / load keeps the run
  const save = await page.evaluate(async () => { const S = await import('./src/save/Save.js'); return S.migrate(JSON.parse(JSON.stringify(window.__tracklands.game.serialize()))); });
  await loadSave(page, save);
  const back = await page.evaluate(() => { const R = window.__tracklands.game.scenario; return R && { id: R.sc.id, state: R.state, custom: R.sc.custom }; });
  check(back && back.id === 'valley_link' && back.state === 'won' && back.custom === false, `the scenario run is saved (${JSON.stringify(back)})`);
  // lose: the deadline passes
  const lost = await page.evaluate(() => {
    const g = window.__tracklands.game, R = g.scenario;
    R.state = 'running'; R.sc.goals = [{ k: 'passengers', n: 1e9 }];
    g.time = (R.sc.deadline - g.ledger.startYear) * 12 * 60 + 1;
    for (let i = 0; i < 60; i++) g.tick(1 / 30);
    return R.state;
  });
  await page.waitForTimeout(200);
  await page.click('.modal [data-mbtn=ok]').catch(() => {});
  const free = await page.evaluate(() => window.__tracklands.game.scenario.state);
  check(lost === 'lost' && free === 'free', `passing the deadline ends it, then play on freely (${lost} → ${free})`);

  // editor: make, keep, export, import, play
  await page.evaluate(async () => { const { scenarioEditor } = await import('./src/ui/ScenarioMenu.js'); scenarioEditor(window.__tracklands); });
  await page.waitForTimeout(300);
  await page.fill('#se-name', 'Ore Rush');
  await page.selectOption('#se-size', '96');
  await page.fill('#se-year', '1920'); await page.fill('#se-dead', '1935');
  await page.click('#se-add');
  const rows = await page.$$('.goal-row');
  const last = rows[rows.length - 1];
  await (await last.$('[data-g=k]')).selectOption('cargo');
  await (await last.$('[data-g=c]')).selectOption('ORE');
  await (await last.$('[data-g=n]')).fill('1500');
  await page.click('.modal [data-mbtn=save]');
  await page.waitForTimeout(300);
  const own = await page.evaluate(() => JSON.parse(localStorage.getItem('tracklands.scenarios') || '[]'));
  const listed = await page.$$eval('.scn-list .scn b', (els) => els.map((e) => e.textContent));
  check(own.length === 1 && own[0].name === 'Ore Rush' && own[0].mapSize === 96 && own[0].goals.some((g) => g.k === 'cargo' && g.c === 'ORE' && g.n === 1500) && listed.includes('Ore Rush'), `the editor keeps a scenario and lists it (${JSON.stringify(own[0] && own[0].goals)})`);
  await page.click('.scn-list [data-export]');
  await page.waitForTimeout(200);
  const text = await page.$eval('.modal textarea', (e) => e.value);
  await page.click('.modal-wrap:last-child [data-mbtn=ok]');
  await page.click('.modal [data-mbtn=import]');
  await page.fill('#scn-in', text);
  await page.click('.modal-wrap:last-child [data-mbtn=ok]');
  await page.waitForTimeout(300);
  const n2 = await page.evaluate(() => JSON.parse(localStorage.getItem('tracklands.scenarios') || '[]').length);
  check(n2 === 2, `an exported scenario imports again (${n2} own scenarios)`);
  const pid = await page.$$eval('.scn-list [data-play]', (els) => els.map((e) => e.dataset.play).filter((x) => x.startsWith('custom_'))[0]);
  await page.click(`.scn-list [data-play="${pid}"]`);
  await page.waitForFunction(() => window.__tracklands.game && window.__tracklands.game.running && window.__tracklands.game.scenario && window.__tracklands.game.scenario.sc.custom, null, { timeout: 60000 }).catch(() => {});
  const cs = await page.evaluate(() => { const g = window.__tracklands.game; return g.scenario && { name: g.scenario.sc.name, size: g.mapSize, year: g.ledger.year() }; });
  check(cs && cs.name === 'Ore Rush' && cs.size === 96 && cs.year === 1920, `the own scenario plays (${JSON.stringify(cs)})`);
  if (errors.length) { ok = false; lines.push('errors: ' + errors.slice(0, 2).join(' | ')); }
  await ctx.close();
  return { ok, lines };
}
