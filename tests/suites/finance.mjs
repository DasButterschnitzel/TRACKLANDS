// Company books (src/economy/Ledger.js): every coin that moves is booked
// exactly once; loans, interest, company value; save/load of the books; the
// finance panel with real mouse and touch input.
import { openPage, loadSave, productionSave } from '../lib.mjs';

export const name = 'finance';
export async function run({ browser, base }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };

  const { ctx, page, errors } = await openPage(browser, base);
  await loadSave(page, productionSave());
  const r = await page.evaluate(async () => {
    const g = window.__tracklands.game, L = g.ledger, E = g.economy, T = g.trains, C = g.construction, net = g.net;
    const out = {};
    // every booking, signed
    let booked = 0;
    const ob = L.book.bind(L), orr = L.bookRunning.bind(L);
    L.book = (amt, ...a) => { booked += amt; return ob(amt, ...a); };
    L.bookRunning = (amt, ...a) => { booked -= amt; return orr(amt, ...a); };
    // interest is booked inside closeMonth: count it from the month records
    const interestSoFar = () => [...L.months, L.cur].reduce((a, p) => a + (p.exp.interest || 0), 0);
    const i0 = interestSoFar();
    const c0 = E.coins;
    const logN = () => L.log.length;
    const lastCat = () => L.log[L.log.length - 1]?.cat;
    // loan
    let n0 = logN();
    const b = L.borrow(3000);
    out.borrow = b.ok && L.loan === 3000 && logN() === n0 + 1 && lastCat() === 'loan_in';
    // buy a train at the first depot
    const dep = g.stations.depots[0];
    n0 = logN();
    const bt = T.buy(T.trains[0].model, dep);
    out.buy = !!bt.train && logN() === n0 + 1 && lastCat() === 'vehicles' && L.log[L.log.length - 1].ref?.id === bt.train.id;
    // build a short track stub somewhere free
    let a = -1;
    for (let i = 70; i < 4000 && a < 0; i++) { if (net.conn[i] || net.special.has(i) || net.tileBlockedReason(i) || g.decor.at(i)) continue; let free = true; for (let k = 1; k <= 3; k++) if (net.conn[i + k] || net.special.has(i + k) || net.tileBlockedReason(i + k) || (i + k) % 64 < 3) free = false; if (free && i % 64 < 58) a = i; }
    n0 = logN();
    const tr = a >= 0 ? C.trackOp(a, a + 3, 0, 'double') : { error: 'no space' };
    out.track = !!tr.ok && logN() === n0 + 1 && lastCat() === 'construction';
    // undo refunds and is booked once
    n0 = logN();
    if (C.undoStack.length) C.undoStack[C.undoStack.length - 1].time = g.clock;
    C.undo();
    out.undo = logN() === n0 + 1 && lastCat() === 'refund';
    // run three months
    for (let i = 0; i < 30 * 185; i++) g.tick(1 / 30);
    out.months = L.months.length;
    // interest: one booking per closed month, amount = loan × rate / 12
    const due = Math.round(3000 * L.rate() / 12);
    const ints = L.log.filter((e) => e.cat === 'interest');
    out.interest = ints.length === 3 && ints.every((e) => e.amt === -due);
    // sell the bought train
    n0 = logN();
    T.sell(bt.train);
    out.sell = logN() === n0 + 1 && lastCat() === 'sale';
    // repay
    const rp = L.repay(3000);
    out.repay = rp.ok && L.loan === 0 && lastCat() === 'loan_out';
    // exactly once: cash moved by precisely what was booked
    const moved = E.coins - c0;
    out.balance = { moved: Math.round(moved), booked: Math.round(booked - (interestSoFar() - i0)) };
    // every month's books add up to what the months record
    const sumPeriods = [...L.months.filter((p) => p.m >= L.months[0].m), L.cur].reduce((acc, p) => acc + Object.values(p.inc).reduce((x, y) => x + y, 0) - Object.values(p.exp).reduce((x, y) => x + y, 0), 0);
    out.periods = Math.round(sumPeriods);
    // company value = sum of its parts
    const v = L.companyValue();
    out.value = v.total === Math.max(0, v.cash - v.debt + v.vehicles + v.track + v.stations + v.earnings);
    // per-train figures
    const t0 = T.trains[0], f = L.objFin(t0);
    out.trainFin = f.lifeRev > 0 && f.lifeCost > 0;
    // books survive a save/load round trip
    const S = await import('./src/save/Save.js');
    const d = S.migrate(JSON.parse(JSON.stringify(g.serialize())));
    out.saveValid = S.validate(d) === null;
    out.saved = { months: d.ledger.months.length, log: d.ledger.log.length, loan: d.ledger.loan, fin: !!d.trains[0].fin };
    out.idem = JSON.stringify(S.migrate(JSON.parse(JSON.stringify(d)))) === JSON.stringify(d);
    return out;
  });
  check(r.borrow, 'borrowing 3,000: loan recorded, one "loan taken" booking');
  check(r.buy, 'buying a train: one "vehicle purchase" booking that points at the train');
  check(r.track, 'building track: one "construction" booking');
  check(r.undo, 'undo: one "refund" booking');
  check(r.months >= 3, `three months close (${r.months})`);
  check(r.interest, 'interest: one booking per month, loan × rate / 12');
  check(r.sell, 'selling a train: one "vehicle sale" booking');
  check(r.repay, 'repaying the loan in full');
  check(Math.abs(r.balance.moved - r.balance.booked) <= 2, `cash moved = everything booked (moved ${r.balance.moved}, booked ${r.balance.booked})`);
  check(r.saveValid && r.saved.months === r.months && r.saved.loan === 0 && r.saved.fin && r.idem, `books saved: ${JSON.stringify(r.saved)}, migrate idempotent ${r.idem}`);
  check(r.value, 'company value is the sum of its listed parts');
  check(r.trainFin, 'trains carry lifetime revenue and running costs');
  if (errors.length) { ok = false; lines.push('errors: ' + errors.slice(0, 2).join(' | ')); }
  await ctx.close();

  // the panel with real input: desktop mouse and phone touch
  for (const [label, opts] of [['desktop', { viewport: { width: 1280, height: 800 } }], ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }]]) {
    const { ctx: c2, page: p2, errors: e2 } = await openPage(browser, base, opts);
    await loadSave(p2, productionSave());
    await p2.evaluate(() => { const g = window.__tracklands.game; for (let i = 0; i < 30 * 70; i++) g.tick(1 / 30); });
    const tap = (sel) => (label === 'phone' ? p2.tap(sel) : p2.click(sel));
    await tap('#topbar .res.coins');
    await p2.waitForSelector('#panel .fin-tabs', { timeout: 3000 });
    const kpis = await p2.$$eval('#panel .kv-grid.fin > div', (els) => els.length);
    check(kpis >= 10, `${label}: the coin display opens Finance with ${kpis} key figures`);
    const loan0 = await p2.evaluate(() => window.__tracklands.game.ledger.loan);
    await tap('#panel [data-act=finBorrow]');
    const loan1 = await p2.evaluate(() => window.__tracklands.game.ledger.loan);
    check(loan1 === loan0 + 1000, `${label}: "+1,000" takes a loan (${loan0} → ${loan1})`);
    let logRows = 0;
    for (const tab of ['ledger', 'history', 'log', 'value']) {
      await tap(`#panel [data-act=finTab][data-arg=${tab}]`);
      await p2.waitForTimeout(150);
      if (tab === 'log') logRows = await p2.$$eval('#panel .fin-row.log', (els) => els.length);
    }
    await tap('#panel [data-act=finTab][data-arg=history]');
    const bars = await p2.$$eval('#panel .fchart .fbar', (els) => els.length);
    check(logRows > 0 && bars >= 2, `${label}: every tab renders (log ${logRows} lines, chart ${bars} bars)`);
    const overflow = await p2.evaluate(() => document.querySelector('#panel').scrollWidth > document.querySelector('#panel').clientWidth + 1);
    check(!overflow, `${label}: no horizontal overflow in the panel`);
    if (e2.length) { ok = false; lines.push(`errors (${label}): ` + e2.slice(0, 2).join(' | ')); }
    await c2.close();
  }
  return { ok, lines };
}
