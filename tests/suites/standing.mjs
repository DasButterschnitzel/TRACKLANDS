// Phase 7 company standing: reputation (towns, lines, contract record),
// contracts 2.0 (supplying an industry, service levels, concessions, lapsed
// deadlines), concessions keeping rival buses out, the optional industry
// dynamics (closure announced, closed, redeveloped), the panels, save/load.
import { openPage, loadSave, productionSave } from '../lib.mjs';

export const name = 'standing';
export async function run({ browser, base }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 1280, height: 800 } });
  await loadSave(page, productionSave());
  const r = await page.evaluate(async () => {
    const g = window.__tracklands.game, S = g.standing, E = g.economy, out = {};
    const { RNG } = await import('./src/util.js');
    out.rep0 = S.reputation();
    // a bus line in a town (for the service level)
    const R0 = g.roads, N = g.mapSize;
    g.progression.level = Math.max(g.progression.level, 5); E.coins = 1e7;
    const dd = (a, b) => Math.max(Math.abs(a % N - b % N), Math.abs(Math.floor(a / N) - Math.floor(b / N)));
    for (const tw of g.towns.list.slice().sort((a, b) => b.pop - a.pop)) {
      const st = [...(tw.roadSet || [])].filter((i) => !g.net.conn[i]);
      const pairs = [];
      for (const a of st) for (const b of st) if (a < b && dd(a, b) >= 2) pairs.push([a, b, dd(a, b)]);
      pairs.sort((p, q) => q[2] - p[2]);
      for (const [a, b] of pairs) {
        if (!R0.path(a, b)) continue;
        const x = R0.addStop(a, 'bus'), y = R0.addStop(b, 'bus');
        if (x.stop && y.stop) { const l = R0.lines.create({ kind: 'bus', stops: [x.stop.id, y.stop.id] }).line; R0.buy('citybus', x.stop, null, l); R0.buy('citybus', x.stop, null, l); out.busLine = l.id; break; }
        if (x.stop) R0.removeStop(x.stop, 0); if (y.stop) R0.removeStop(y.stop, 0);
      }
      if (out.busLine) break;
    }
    // contracts 2.0 on offer
    const kinds = new Set();
    for (let i = 0; i < 40; i++) for (const x of S.extraContracts(new RNG(1000 + i), g.progression.level)) kinds.add(x.type);
    out.kinds = [...kinds];
    // supply an industry: counted only for that industry
    const sup = S.extraContracts(new RNG(7), g.progression.level).find((x) => x.type === 'supply_industry');
    if (sup) {
      const k = { id: 9001, progress: 0, done: false, claimed: false, ...sup };
      E.contracts.push(k);
      const ind = g.industries.byId(k.ind);
      E.noteDelivery(k.cargo, 5, 100, { industry: ind }, null, null);
      E.noteDelivery(k.cargo, 5, 100, { industry: g.industries.list.find((i) => i.id !== k.ind) }, null, null);
      out.supply = { progress: k.progress, timer: k.left > 0 };
      // it lapses at its deadline: the record and reputation suffer
      const rec0 = S.reputation().record;
      k.left = 0.01;
      E.tick(0.05);
      S._t = -1;
      out.lapsed = { claimed: k.claimed, failed: S.failed, rec: [rec0, S.reputation().record] };
    }
    // a service level on a line: counted per month
    const sl = S.extraContracts(new RNG(3), g.progression.level).find((x) => x.type === 'service_level');
    if (sl) {
      const k = { id: 9002, progress: 0, done: false, claimed: false, ...sl, q: 0 };
      E.contracts.push(k);
      S.monthContracts(); S.monthContracts();
      out.service = { progress: k.progress, done: k.done, last: k.last };
    }
    // a concession: granted on claiming, rival buses stay out, saved
    const town = g.towns.list.find((t) => t.roadSet && t.roadSet.size);
    const kc = { id: 9003, type: 'concession', town: town.id, townName: town.name, amount: 3, need: 2, q: 0.55, progress: 3, done: true, claimed: false, coins: 100, xp: 10 };
    E.contracts.push(kc);
    const auth0 = g.authority.rating(town);
    E.claimContract(kc);
    out.concession = { active: S.concessionActive(town), auth: [auth0, g.authority.rating(town)] };
    // rivals never pick that town for a new line
    const R = g.rivals;
    let picked = false;
    if (R && R.list.length) {
      const rv = R.list[0], before = rv.lines.length, money = rv.money;
      rv.money = 1e6;
      for (let i = 0; i < 40; i++) { R.plan(rv, i); }
      picked = rv.lines.slice(before).some((l) => l.a === town.id || l.b === town.id);
      rv.money = money;
    }
    out.rivalPicked = picked;
    // industry dynamics: off by default; on: announce, close, reopen
    out.ruleDefault = S.industryRule;
    S.industryRule = 'on';
    const ind = g.industries.list.find((i) => !i.stake && i.level === 0 && g.progression.regionUnlocked(i.region));
    if (ind) {
      ind.idleM = 17; ind._lastTr = ind.transported;
      S.industryMonth();
      out.closing = ind.closing;
      ind.closing = 1; ind._lastTr = ind.transported;
      S.industryMonth();
      out.closed = { closed: ind.closed, rate: g.industries.rate(ind), accepts: g.industries.inputs(ind).some((c) => g.industries.accepts(ind, c)) };
      g.select({ type: 'industry', id: ind.id });
      await new Promise((res) => setTimeout(res, 50));
      out.closedCard = document.body.innerText.includes(g.ui.tr('ind_closed_card', { n: 12 }).slice(0, 8));
      ind.closedM = 11;
      S.industryMonth();
      out.reopened = !ind.closed && g.industries.rate(ind) > 0;
      ind.closed = true; ind.closedM = 2;   // (saved below)
      out.indId = ind.id;
    }
    // panels
    g.ui.closePanel(); g.ui.openPanel('contracts');
    await new Promise((res) => setTimeout(res, 50));
    out.repCard = !!document.querySelector('.card.rep');
    g.ui.closePanel(); g.ui.openPanel('settings');
    await new Promise((res) => setTimeout(res, 50));
    out.ruleSelect = !!document.querySelector('[data-change="indRule"]');
    g.ui.closePanel();
    out.townId = town.id;
    out.save = g.serialize();
    return out;
  });
  check(r.rep0 && r.rep0.score >= 0 && r.rep0.score <= 100 && r.rep0.band, `reputation ${r.rep0.score} (${r.rep0.band}): towns ${Math.round(r.rep0.towns * 100)}, lines ${Math.round(r.rep0.lines * 100)}, record ${Math.round(r.rep0.record * 100)}`);
  check(r.kinds.includes("supply_industry") && r.kinds.includes("service_level"), `contracts 2.0 on offer: ${r.kinds.join(", ")} (bus line ${r.busLine})`);
  if (r.supply) {
    check(r.supply.progress === 5 && r.supply.timer, 'supplying an industry counts only deliveries to it');
    check(r.lapsed.claimed && r.lapsed.failed >= 1 && r.lapsed.rec[1] < r.lapsed.rec[0], `a lapsed contract hurts the record (${r.lapsed.rec[0].toFixed(2)} → ${r.lapsed.rec[1].toFixed(2)})`);
  }
  if (r.service) check(r.service.done && r.service.last != null, `a service level is kept month by month (last ${r.service.last} %)`);
  check(r.concession.active && r.concession.auth[1] > r.concession.auth[0], `a concession: active, town rating ${r.concession.auth[0]} → ${r.concession.auth[1]}`);
  check(!r.rivalPicked, 'rivals keep out of a concession town');
  check(r.ruleDefault === 'off', 'industry dynamics are off by default');
  if (r.closing != null) {
    check(r.closing === 6, 'an idle industry announces its closure');
    check(r.closed.closed && r.closed.rate === 0 && !r.closed.accepts && r.closedCard, 'a closed industry produces and accepts nothing, the inspector says so');
    check(r.reopened, 'the site is redeveloped a year later');
  }
  check(r.repCard && r.ruleSelect, 'the contracts panel shows the reputation, the settings the industry rule');
  await loadSave(page, r.save);
  const l = await page.evaluate(([tid, iid]) => { const g = window.__tracklands.game; const t = g.towns.byId(tid), i = iid != null ? g.industries.byId(iid) : null; return { con: g.standing.concessionActive(t), rule: g.standing.industryRule, closed: iid == null || !!(i && i.closed && i.closedM === 2) }; }, [r.townId, r.indId ?? null]);
  check(l.con && l.rule === 'on' && l.closed, 'concessions, the industry rule and closed sites are saved');
  if (errors.length) { ok = false; lines.push('errors: ' + errors.slice(0, 3).join(' | ')); }
  await ctx.close();
  return { ok, lines };
}
