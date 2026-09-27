// Company standing (Phase 7): reputation, contracts 2.0, concessions and the
// optional industry dynamics.
//   reputation  – 0..100 from how the towns the company serves rate it, how
//                 good its lines are and its contract record (contracts
//                 finished raise it, contracts let lapse lower it). It scales
//                 contract rewards and decides which offers towns make.
//   contracts   – besides the older kinds: supplying one industry before a
//                 deadline, keeping a line at a service level for months,
//                 and town concessions (run good local transit for three
//                 months: the town keeps rival bus companies out for a year
//                 and rates the company higher)
//   industries  – a world rule, off by default: industries nobody serves
//                 for a long time announce their closure, close half a year
//                 later and are redeveloped (reopened) a year after that.
//                 Industries with a company stake never close.
import { MONTH_S } from './Ledger.js';
import { INDUSTRIES } from '../config.js';

const YEAR_S = MONTH_S * 12;
export const INDUSTRY_RULES = ['off', 'on'];
const CLOSE_AFTER = 18;       // months with little or nothing transported
const CLOSE_WARN = 6;         // months between the announcement and the closure
const REOPEN_AFTER = 12;      // months a closed site stands empty

export class Standing {
  constructor(game) {
    this.game = game;
    this.done = 0; this.failed = 0;       // contract record (decays monthly)
    this.hist = [];                        // reputation at each month's end
    this.industryRule = 'off';
    this.concessions = {};                 // town id → until (game time)
    this.month = -1;
    this._rep = null; this._t = -1;
  }

  // ---------- reputation ----------
  servedTowns() {
    const g = this.game, set = new Set();
    for (const s of g.stations.list) if (s.links) for (const id of s.links.towns) set.add(id);
    if (g.roads) for (const s of g.roads.stops) if (!s.owner && s.links) for (const id of s.links.towns || []) set.add(id);
    return [...set].map((id) => g.towns.byId(id)).filter(Boolean);
  }
  lineQuality() {
    const g = this.game, q = [];
    if (g.lines) for (const L of g.lines.list()) { const m = g.lines.metrics(L); if (m && m.quality != null) q.push(m.quality); }
    if (g.roads) for (const l of g.roads.lines.list) { if (!g.roads.lines.vehicles(l).length) continue; const m = g.roads.lines.metrics(l); if (m && m.quality != null) q.push(m.quality); }
    return q.length ? q.reduce((a, b) => a + b, 0) / q.length : null;
  }
  // the reputation and what it is made of (cached a few seconds)
  reputation() {
    const g = this.game, now = Math.floor(g.time / 5);
    if (this._rep && this._t === now) return this._rep;
    const towns = this.servedTowns();
    const towns01 = towns.length && g.authority ? towns.reduce((a, t) => a + g.authority.rating(t), 0) / towns.length / 100 : 0.5;
    const lq = this.lineQuality();
    const lines01 = lq == null ? 0.6 : lq;
    const record01 = Math.max(0, Math.min(1, 0.5 + 0.05 * this.done - 0.1 * this.failed));
    const score = Math.round(100 * (0.45 * towns01 + 0.3 * lines01 + 0.25 * record01));
    this._rep = { score, towns: towns01, lines: lines01, record: record01, nTowns: towns.length, band: score >= 75 ? 'excellent' : score >= 55 ? 'good' : score >= 35 ? 'fair' : 'poor' };
    this._t = now;
    return this._rep;
  }
  // contract rewards: × 0.85 (poor) … × 1.15 (excellent)
  rewardMul() { return 0.85 + 0.3 * this.reputation().score / 100; }
  onDone() { this.done++; this._t = -1; }
  onFailed(k) {
    this.failed++; this._t = -1;
    const g = this.game;
    if (k && k.town != null && g.authority) { const t = g.towns.byId(k.town); if (t) g.authority.change(t, -4, 'auth_contract_failed'); }
  }

  // ---------- concessions ----------
  concessionActive(town) { const u = this.concessions[town.id]; return u != null && u > this.game.time; }
  grantConcession(town) {
    const g = this.game;
    this.concessions[town.id] = g.time + YEAR_S;
    if (g.authority) g.authority.change(town, 6, 'auth_concession');
    g.events.emit('concessionGranted', town);
  }
  // company buses and trams serving a town, and their mean line quality
  localTransit(town) {
    const g = this.game, R = g.roads;
    if (!R) return { n: 0, q: 0 };
    let n = 0, qs = 0, lines = 0;
    for (const l of R.lines.list) {
      if (l.kind !== 'bus' && l.kind !== 'tram') continue;
      const inTown = l.stops.some((id) => { const s = R.stopById(id); return s && !s.owner && s.links && (s.links.towns || []).includes(town.id); });
      if (!inTown) continue;
      const vs = R.lines.vehicles(l).length;
      if (!vs) continue;
      n += vs; lines++;
      const m = R.lines.metrics(l); qs += m && m.quality != null ? m.quality : 0;
    }
    return { n, q: lines ? qs / lines : 0 };
  }

  // ---------- contracts 2.0 (made by Economy.makeContract) ----------
  // extra kinds that fit the current game, with their setup
  extraContracts(rng, lvl) {
    const g = this.game, out = [];
    const rep = this.reputation().score;
    // supply one industry that takes a cargo the map produces
    const inputs = (i) => g.industries.inputs(i).filter((c) => c !== 'PASSENGERS' && c !== 'MAIL');
    const inds = g.industries.list.filter((i) => g.progression.regionUnlocked(i.region) && !i.closed && inputs(i).length);
    if (inds.length) {
      const ind = rng.pick(inds), c = rng.pick(inputs(ind));
      out.push({ type: 'supply_industry', ind: ind.id, indName: g.industries.displayName(ind), cargo: c, amount: Math.round((20 + lvl * 5) / 5) * 5, time: 900, left: 900, coins: Math.round(60 * (20 + lvl * 5) * (1 + lvl * 0.1)) });
    }
    // keep a line at a service level
    const lines = [];
    if (g.lines) for (const L of g.lines.list()) if (L.trains.length) lines.push({ rail: true, key: L.key, name: g.lines.name(L) });
    if (g.roads) for (const l of g.roads.lines.list) if (g.roads.lines.vehicles(l).length) lines.push({ rail: false, id: l.id, name: l.name });
    if (lines.length) {
      const L = rng.pick(lines);
      out.push({ type: 'service_level', line: L.rail ? { rail: true, key: L.key } : { rail: false, id: L.id }, lineName: L.name, q: 0.65, amount: 2, coins: Math.round(900 * (1 + lvl * 0.25)) });
    }
    // a concession: a town that rates the company well enough
    if (rep >= 40 && g.roads && g.progression.level >= 3) {
      const towns = this.servedTowns().filter((t) => t.stage >= 2 && !this.concessionActive(t) && (!g.authority || g.authority.rating(t) >= 55));
      if (towns.length) { const t = rng.pick(towns); out.push({ type: 'concession', town: t.id, townName: t.name, amount: 3, need: 2, q: 0.55, coins: Math.round(1200 * (1 + lvl * 0.2)) }); }
    }
    return out;
  }
  // month end: service levels and concessions advance (or reset)
  monthContracts() {
    const g = this.game, E = g.economy;
    for (const k of E.contracts) {
      if (k.done || k.claimed) continue;
      if (k.type === 'service_level') {
        const q = this.lineQ(k.line);
        if (q == null) { k.claimed = true; continue; }        // the line is gone
        k.progress = q >= k.q ? k.progress + 1 : 0;
        k.last = Math.round(q * 100);
        if (k.progress >= k.amount) E.completeContract(k);
      } else if (k.type === 'concession') {
        const t = g.towns.byId(k.town);
        if (!t) { k.claimed = true; continue; }
        const L = this.localTransit(t);
        k.last = { n: L.n, q: Math.round(L.q * 100) };
        k.progress = L.n >= k.need && L.q >= k.q ? k.progress + 1 : 0;
        if (k.progress >= k.amount) E.completeContract(k);
      }
    }
  }
  lineQ(ref) {
    const g = this.game;
    if (!ref) return null;
    if (ref.rail) { const L = g.lines ? g.lines.list().find((x) => x.key === ref.key) : null; if (!L) return null; const m = g.lines.metrics(L); return m && m.quality != null ? m.quality : 0; }
    const l = g.roads ? g.roads.lines.byId(ref.id) : null;
    if (!l) return null;
    const m = g.roads.lines.metrics(l);
    return m && m.quality != null ? m.quality : 0;
  }
  // a finished contract's lasting effect (claimed)
  onClaimed(k) {
    if (k.type === 'concession') { const t = this.game.towns.byId(k.town); if (t) this.grantConcession(t); }
  }

  // ---------- industry dynamics (world rule) ----------
  industryMonth() {
    const g = this.game, I = g.industries;
    if (this.industryRule !== 'on') return;
    for (const ind of I.list) {
      if (!g.progression.regionUnlocked(ind.region)) continue;
      if (ind.closed) {
        ind.closedM = (ind.closedM || 0) + 1;
        if (ind.closedM >= REOPEN_AFTER) this.reopen(ind);
        continue;
      }
      const moved = ind.transported - (ind._lastTr ?? ind.transported);
      ind._lastTr = ind.transported;
      const idle = moved < 5 && ind.level === 0 && !(ind.stake > 0) && !!INDUSTRIES[ind.type];
      ind.idleM = idle ? (ind.idleM || 0) + 1 : 0;
      if (ind.closing != null) {
        if (!idle) { ind.closing = null; g.events.emit('industrySaved', ind); continue; }
        ind.closing--;
        if (ind.closing <= 0) this.close(ind);
      } else if (ind.idleM >= CLOSE_AFTER) {
        ind.closing = CLOSE_WARN;
        g.events.emit('industryClosing', ind);
      }
    }
  }
  close(ind) {
    const g = this.game;
    ind.closed = true; ind.closing = null; ind.closedM = 0; ind.idleM = 0;
    ind.out = {}; ind.inp = {}; ind.cycles = 0; ind.active = 0;
    g.industries.buildVisual(ind);
    g.events.emit('industryClosed', ind);
  }
  // redevelopment: the site reopens, as the same kind of works
  reopen(ind) {
    const g = this.game;
    ind.closed = false; ind.closedM = 0; ind.idleM = 0; ind.level = 0; ind._lastTr = ind.transported;
    g.industries.buildVisual(ind);
    g.events.emit('industryReopened', ind);
  }

  tick() {
    const g = this.game;
    if (!g.ledger) return;
    const m = g.ledger.monthIndex();
    if (m === this.month) return;
    const first = this.month < 0;
    this.month = m;
    if (first) return;
    this.monthContracts();
    this.industryMonth();
    // the record fades: old successes and failures count for less
    this.done *= 0.95; this.failed *= 0.9;
    this._t = -1;
    this.hist.push(this.reputation().score);
    if (this.hist.length > 24) this.hist.shift();
    for (const id in this.concessions) if (this.concessions[id] <= g.time) delete this.concessions[id];
  }

  serialize() {
    return { done: Math.round(this.done * 100) / 100, failed: Math.round(this.failed * 100) / 100, hist: this.hist, industryRule: this.industryRule, concessions: this.concessions };
  }
  deserialize(d) {
    if (!d || typeof d !== 'object') return;
    const num = (x, max) => (Number.isFinite(+x) ? Math.max(0, Math.min(max, +x)) : 0);
    this.done = num(d.done, 1000); this.failed = num(d.failed, 1000);
    this.hist = Array.isArray(d.hist) ? d.hist.filter((x) => Number.isFinite(x)).slice(-24).map((x) => Math.max(0, Math.min(100, x))) : [];
    this.industryRule = INDUSTRY_RULES.includes(d.industryRule) ? d.industryRule : 'off';
    this.concessions = {};
    if (d.concessions && typeof d.concessions === 'object') for (const k in d.concessions) if (Number.isFinite(+d.concessions[k]) && /^\d+$/.test(k)) this.concessions[k] = +d.concessions[k];
  }
}
