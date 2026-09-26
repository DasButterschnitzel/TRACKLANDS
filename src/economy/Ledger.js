// Company books. Every coin that enters or leaves the company passes through
// Economy.spend/earn/operatingCost and is booked here exactly once, under a
// category and (where known) the object it belongs to. The ledger keeps:
//  - the calendar (one game month = MONTH_S seconds of game time),
//  - the current month and the last 24 closed months (income and expenses by
//    category, cash, debt and company value at month end), the last 10 years,
//  - a transaction log of the last 250 bookings (running costs are booked
//    continuously into the month and logged once per month as one line),
//  - the loan (credit line, interest charged monthly),
//  - per-train and per-station figures (this month, last month, lifetime).
// Nothing here changes how much anything earns or costs: it only records,
// plus loans, which the player takes and repays explicitly.
import { consistCost } from '../trains/Consist.js';

export const MONTH_S = 60;                 // game seconds per month
export const LOG_MAX = 250;
export const MONTHS_KEPT = 24;
export const YEARS_KEPT = 10;
export const LOAN_STEP = 1000;

// income / expense categories (i18n: fin_<id>)
export const INCOME_CATS = ['pax', 'mail', 'freight', 'contract', 'objective', 'grant', 'sale', 'refund', 'other', 'loan_in', 'deposit_back', 'dividend', 'share_sale'];
export const EXPENSE_CATS = ['op_trains', 'op_road', 'maint_vehicles', 'maint_track', 'maint_station', 'interest', 'construction', 'vehicles', 'road_vehicles', 'upgrades', 'regions', 'decor', 'compensation', 'other', 'loan_out', 'deposit', 'industry_fund', 'shares'];
// categories that are not profit or loss (cash moves between company and bank,
// or money coming back for something that was spent)
export const NON_PL = new Set(['loan_in', 'loan_out', 'deposit', 'deposit_back', 'shares', 'share_sale']);

// old Economy categories → ledger categories
const MAP_IN = { delivery: 'freight', pax: 'pax', mail: 'mail', objective: 'objective', tutorial: 'objective', offline: 'other', grant: 'grant', sale: 'sale', refund: 'refund', contract: 'contract', daily: 'contract' };
const MAP_OUT = { construction: 'construction', trains: 'vehicles', road_vehicles: 'road_vehicles', upgrades: 'upgrades', regions: 'regions', decor: 'decor', compensation: 'compensation' };

// per-object figures from a save (trains, stations)
export function cleanFin(f) {
  if (!f || typeof f !== 'object') return undefined;
  const n = (v) => (typeof v === 'number' && isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : 0);
  return { m: Number.isInteger(f.m) && f.m >= 0 ? f.m : 0, rev: n(f.rev), cost: n(f.cost), lastRev: n(f.lastRev), lastCost: n(f.lastCost), lifeRev: n(f.lifeRev), lifeCost: n(f.lifeCost), pu: n(f.pu), cu: n(f.cu), lastPu: n(f.lastPu), lastCu: n(f.lastCu) };
}
const blankMonth = (m) => ({ m, inc: {}, exp: {}, cash: 0, debt: 0, value: 0 });
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);

export class Ledger {
  constructor(game) {
    this.game = game;
    this.startYear = 1950;
    this.cur = blankMonth(0);
    this.months = [];        // closed months, oldest first
    this.years = [];         // closed years {y, inc, exp, cash, debt, value}
    this.log = [];           // {t, m, amt, cat, ref, note}
    this.loan = 0;
    this.opAcc = 0;          // running costs not yet logged this month
    this.seq = 1;
  }

  // ---------- calendar ----------
  monthIndex(time = this.game.time) { return Math.floor(Math.max(0, time) / MONTH_S); }
  year(m = this.monthIndex()) { return this.startYear + Math.floor(m / 12); }
  monthOfYear(m = this.monthIndex()) { return m % 12; }
  monthFrac() { return (Math.max(0, this.game.time) % MONTH_S) / MONTH_S; }

  // ---------- booking ----------
  mapCat(cat, dir) { return dir > 0 ? (MAP_IN[cat] || (INCOME_CATS.includes(cat) ? cat : 'other')) : (MAP_OUT[cat] || (EXPENSE_CATS.includes(cat) ? cat : 'other')); }

  // amt > 0 income, < 0 expense. ref: {type, id} of the object; note: short text
  book(amt, cat, ref = null, note = null, log = true) {
    if (!amt || !isFinite(amt)) return;
    this.roll();
    const dir = amt > 0 ? 1 : -1;
    const c = this.mapCat(cat, dir);
    const bag = dir > 0 ? this.cur.inc : this.cur.exp;
    bag[c] = (bag[c] || 0) + Math.abs(amt);
    if (ref) this.objBook(ref, amt, c);
    if (log) {
      this.log.push({ id: this.seq++, t: this.game.time, amt: Math.round(amt), cat: c, ref, note });
      if (this.log.length > LOG_MAX) this.log.splice(0, this.log.length - LOG_MAX);
    }
    return c;
  }
  // continuous costs (running costs, maintenance): into the month, logged monthly
  bookRunning(amt, cat, ref = null) {
    if (!(amt > 0)) return;
    this.roll();
    this.cur.exp[cat] = (this.cur.exp[cat] || 0) + amt;
    this.opAcc += amt;
    if (ref) this.objBook(ref, -amt, cat);
  }

  // per-object figures (trains, road vehicles, stations)
  objOf(ref) {
    const g = this.game;
    if (ref.type === 'train') return g.trains.byId(ref.id);
    if (ref.type === 'station') return g.stations.byId(ref.id);
    if (ref.type === 'road' && g.roads) return g.roads.byId(ref.id);
    if (ref.type === 'roadstop' && g.roads) return g.roads.stopById(ref.id);
    if (ref.type === 'industry' && g.industries) return g.industries.byId(ref.id);
    return null;
  }
  objFinOf(o) {
    const f = o.fin || (o.fin = { m: this.monthIndex(), rev: 0, cost: 0, lastRev: 0, lastCost: 0, lifeRev: 0, lifeCost: 0, pu: 0, cu: 0, lastPu: 0, lastCu: 0 });
    this.objRoll(f);
    return f;
  }
  objBook(ref, amt, cat) {
    const o = this.objOf(ref);
    if (!o) return;
    const f = this.objFinOf(o);
    if (NON_PL.has(cat)) return;
    if (amt > 0) { f.rev += amt; f.lifeRev += amt; } else { f.cost -= amt; f.lifeCost -= amt; }
  }
  // travellers (and mail) or cargo units a vehicle delivered this month
  objUnits(ref, c, n) {
    const o = ref && this.objOf(ref);
    if (!o || !(n > 0)) return;
    const f = this.objFinOf(o);
    if (c === 'PASSENGERS' || c === 'MAIL') f.pu = (f.pu || 0) + n; else f.cu = (f.cu || 0) + n;
  }
  objRoll(f) {
    const m = this.monthIndex();
    if (f.m === m) return;
    if (f.m === m - 1) { f.lastRev = f.rev; f.lastCost = f.cost; f.lastPu = f.pu || 0; f.lastCu = f.cu || 0; } else { f.lastRev = 0; f.lastCost = 0; f.lastPu = 0; f.lastCu = 0; }
    f.rev = 0; f.cost = 0; f.pu = 0; f.cu = 0; f.m = m;
  }
  objFin(o) {
    if (!o.fin) return { rev: 0, cost: 0, lastRev: 0, lastCost: 0, lifeRev: 0, lifeCost: 0, pu: 0, cu: 0, lastPu: 0, lastCu: 0 };
    this.objRoll(o.fin);
    return o.fin;
  }

  // close months that have passed
  roll() {
    const m = this.monthIndex();
    // (a long jump, e.g. a clock reset: start the books again at the new month)
    if (this.cur.m > m || m - this.cur.m > MONTHS_KEPT) { this.cur = blankMonth(m); return; }
    while (this.cur.m < m) this.closeMonth();
  }
  closeMonth() {
    const g = this.game;
    // interest on the loan for the month that ends
    if (this.loan > 0) {
      const due = Math.round(this.loan * this.rate() / 12);
      if (due > 0) {
        g.economy.coins = Math.max(0, g.economy.coins - due);
        this.cur.exp.interest = (this.cur.exp.interest || 0) + due;
        this.log.push({ id: this.seq++, t: (this.cur.m + 1) * MONTH_S, amt: -due, cat: 'interest', ref: null, note: null });
      }
    }
    if (this.opAcc > 0) {
      this.log.push({ id: this.seq++, t: (this.cur.m + 1) * MONTH_S, amt: -Math.round(this.opAcc), cat: 'op_trains', ref: null, note: 'month' });
      this.opAcc = 0;
    }
    if (this.log.length > LOG_MAX) this.log.splice(0, this.log.length - LOG_MAX);
    const c = this.cur;
    c.cash = Math.round(g.economy.coins); c.debt = this.loan; c.value = Math.round(this.companyValue().total);
    for (const k of Object.keys(c.inc)) c.inc[k] = Math.round(c.inc[k]);
    for (const k of Object.keys(c.exp)) c.exp[k] = Math.round(c.exp[k]);
    this.months.push(c);
    if (this.months.length > MONTHS_KEPT) this.months.splice(0, this.months.length - MONTHS_KEPT);
    // a full year closed: fold its months
    if (c.m % 12 === 11) {
      const ms = this.months.filter((x) => Math.floor(x.m / 12) === Math.floor(c.m / 12));
      const y = { y: this.startYear + Math.floor(c.m / 12), inc: {}, exp: {}, cash: c.cash, debt: c.debt, value: c.value };
      for (const x of ms) { for (const [k, v] of Object.entries(x.inc)) y.inc[k] = (y.inc[k] || 0) + v; for (const [k, v] of Object.entries(x.exp)) y.exp[k] = (y.exp[k] || 0) + v; }
      this.years.push(y);
      if (this.years.length > YEARS_KEPT) this.years.shift();
    }
    this.cur = blankMonth(c.m + 1);
    g.events.emit('monthClosed', c);
  }

  // ---------- figures ----------
  profitOf(p) { let inc = 0, exp = 0; for (const [k, v] of Object.entries(p.inc)) if (!NON_PL.has(k)) inc += v; for (const [k, v] of Object.entries(p.exp)) if (!NON_PL.has(k)) exp += v; return { inc, exp, profit: inc - exp }; }
  thisMonth() { this.roll(); return this.profitOf(this.cur); }
  lastMonth() { const p = this.months[this.months.length - 1]; return p ? this.profitOf(p) : { inc: 0, exp: 0, profit: 0 }; }
  yearToDate() {
    this.roll();
    const y = Math.floor(this.cur.m / 12);
    let inc = 0, exp = 0;
    for (const p of [...this.months.filter((x) => Math.floor(x.m / 12) === y), this.cur]) { const r = this.profitOf(p); inc += r.inc; exp += r.exp; }
    return { inc, exp, profit: inc - exp };
  }
  transportRevenue(p = this.cur) { return (p.inc.pax || 0) + (p.inc.mail || 0) + (p.inc.freight || 0); }

  // ---------- company value ----------
  // Every part is listed so the panel can show how the value is made up.
  companyValue() {
    const g = this.game, net = g.net, E = g.economy;
    let vehicles = 0;
    for (const t of g.trains.trains) vehicles += this.vehicleValue(t);
    let track = 0;
    for (let i = 0; i < net.conn.length; i++) if (net.conn[i]) track += E.costs.trackTile(net.tier[i] | 0, net.kind(i)) * 0.5;
    let stations = 0;
    for (const s of g.stations.list) stations += E.costs.station() * 0.5 * (1 + (s.level | 0) * 0.5) * Math.max(1, s.tracks ? s.tracks.length : 1);
    stations += g.stations.depots.length * E.costs.depot() * 0.5;
    if (g.company) stations += g.company.value();
    const shares = g.industries ? g.industries.stakeValue() : 0;
    const recent = this.months.slice(-6);
    const avgProfit = recent.length ? recent.reduce((a, p) => a + this.profitOf(p).profit, 0) / recent.length : 0;
    const earnings = Math.max(0, avgProfit) * 12;
    const cash = Math.round(E.coins), debt = this.loan;
    const total = Math.max(0, cash - debt + vehicles + track + stations + shares + earnings);
    return { cash, debt, vehicles: Math.round(vehicles), track: Math.round(track), stations: Math.round(stations), shares: Math.round(shares), earnings: Math.round(earnings), total: Math.round(total) };
  }
  // purchase price, depreciated 4 % per year of age, never below 25 %
  vehicleValue(t) {
    let price = 0;
    try { price = consistCost(t.veh, this.game.economy.costs); } catch (e) { price = 0; }
    const ageY = Math.max(0, (this.game.time - (t.bought ?? 0)) / (MONTH_S * 12));
    return price * Math.max(0.25, 1 - ageY * 0.04);
  }

  // ---------- loan ----------
  rate() { const d = this.game.difficulty || {}; return d.interest ?? 0.06; }
  maxLoan() {
    const v = this.companyValue();
    const base = 5000 + (v.total - v.cash + v.debt) * 0.3;
    return Math.max(LOAN_STEP, Math.floor(base / LOAN_STEP) * LOAN_STEP);
  }
  borrow(n = LOAN_STEP) {
    const room = this.maxLoan() - this.loan;
    n = Math.min(Math.floor(n / LOAN_STEP) * LOAN_STEP, Math.floor(room / LOAN_STEP) * LOAN_STEP);
    if (n <= 0) return { error: 'err_loan_max' };
    this.loan += n;
    this.game.economy.coins += n;
    this.book(n, 'loan_in', null, null);
    this.game.events.emit('coins', n, 'loan');
    return { ok: true, n };
  }
  repay(n = LOAN_STEP) {
    const E = this.game.economy;
    n = Math.min(this.loan, Math.floor(n / LOAN_STEP) * LOAN_STEP || this.loan, Math.floor(E.coins / LOAN_STEP) * LOAN_STEP);
    if (this.loan > 0 && this.loan < LOAN_STEP && E.coins >= this.loan) n = this.loan;
    if (n <= 0) return { error: this.loan ? 'err_no_money' : 'err_no_loan' };
    this.loan -= n;
    E.coins -= n;
    this.book(-n, 'loan_out', null, null);
    this.game.events.emit('coins', -n, 'loan');
    return { ok: true, n };
  }

  // ---------- save ----------
  serialize() {
    return { startYear: this.startYear, cur: this.cur, months: this.months, years: this.years, log: this.log.slice(-LOG_MAX), loan: this.loan, opAcc: Math.round(this.opAcc * 100) / 100, seq: this.seq };
  }
  deserialize(d) {
    if (!d || typeof d !== 'object') return;
    const num = (v, def = 0) => (typeof v === 'number' && isFinite(v) ? v : def);
    const bag = (o) => { const r = {}; if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) if (typeof v === 'number' && isFinite(v) && v >= 0) r[k] = v; return r; };
    const period = (p, key = 'm') => (p && typeof p === 'object' ? { [key]: num(p[key]) | 0, inc: bag(p.inc), exp: bag(p.exp), cash: num(p.cash), debt: num(p.debt), value: num(p.value) } : null);
    this.startYear = Math.min(2100, Math.max(1800, num(d.startYear, 1950) | 0));
    this.cur = period(d.cur) || blankMonth(this.monthIndex());
    this.months = (Array.isArray(d.months) ? d.months : []).map((p) => period(p)).filter(Boolean).slice(-MONTHS_KEPT);
    this.years = (Array.isArray(d.years) ? d.years : []).map((p) => period(p, 'y')).filter(Boolean).slice(-YEARS_KEPT);
    this.log = (Array.isArray(d.log) ? d.log : []).filter((e) => e && typeof e === 'object' && isFinite(e.amt)).slice(-LOG_MAX)
      .map((e) => ({ id: num(e.id) | 0, t: num(e.t), amt: Math.round(e.amt), cat: String(e.cat || 'other'), ref: e.ref && typeof e.ref === 'object' && typeof e.ref.type === 'string' ? { type: e.ref.type, id: num(e.ref.id) } : null, note: typeof e.note === 'string' ? e.note.slice(0, 80) : null }));
    this.loan = Math.max(0, Math.round(num(d.loan)));
    this.opAcc = Math.max(0, num(d.opAcc));
    this.seq = Math.max(num(d.seq, 1) | 0, 1, ...this.log.map((e) => e.id + 1));
  }
}

export { sum };
