// Rival companies: computer-run bus companies competing for the towns'
// passengers. Each rival has its own money and books (never the player's
// ledger). Once a month it may open a line: a company road between two
// nearby towns in open regions, a stop in each and a bus; later it adds buses
// to busy lines and closes nothing. Its stops share each town's travellers
// with the player's stations by cargo rating, like any competing station.
// The player cannot edit or remove a rival's stops or buses.
// Phase 7: each rival follows a strategy – intercity coaches between towns,
// local buses within a big town, or freight haulage by truck from an
// industry to one that takes its cargo. Rivals pay for everything they
// build and run (the player's books never see it), keep out of towns that
// gave the player a concession, and never build railways (a rival railway
// could not share the player's signalling safely, so they stay on the
// roads). A rival that stays in debt for three months puts itself up for
// sale; the player can buy any rival (its stops and vehicles become the
// player's), at a premium while it is healthy.
// Phase 9: railway companies. A rival with a railway personality plans,
// builds and runs railways through src/world/RailAI.js, with the same
// systems, prices and interest as the player and networks that never touch
// anyone else's. See RailAI.js for the planner.
import { N, RNG, hashStr, cheb } from '../util.js';
import { ROAD_VEHICLES, DIFFICULTY } from '../config.js';
import { roadCaps } from '../road/Roads.js';
import { RailPlanner, PERSONALITIES, AI_LEVEL_IDS, ALL_RESEARCH } from './RailAI.js';
import { customToken } from '../trains/Livery.js';
import { MONTH_S } from '../economy/Ledger.js';

// strategy: intercity | local | freight (road) or rail (with a personality)
const RIVAL_DEFS = [
  { id: 'r1', name: 'Bluebird Coaches', short: 'Bluebird', color: 0x2f7ad0, strategy: 'intercity' },
  { id: 'r2', name: 'Crimson Motor Lines', short: 'Crimson', color: 0xc0392b, strategy: 'local' },
  { id: 'r3', name: 'Northline Haulage', short: 'Northline', color: 0x3a8a4a, strategy: 'freight' },
  { id: 'r4', name: 'Atlas Rail Freight', short: 'Atlas', color: 0x7a5a2e, strategy: 'rail', personality: 'freight', trim: 0xe0b050 },
  { id: 'r5', name: 'Northstar Railways', short: 'Northstar', color: 0x1f4f8a, strategy: 'rail', personality: 'railway', trim: 0xe8e2d4 },
  { id: 'r6', name: 'MetroLink Regional', short: 'MetroLink', color: 0x2e8a7a, strategy: 'rail', personality: 'regional', trim: 0xf2d06b },
  { id: 'r7', name: 'Meridian Express', short: 'Meridian', color: 0x8a2e5a, strategy: 'rail', personality: 'premium', trim: 0xd8d8d8 },
  { id: 'r8', name: 'Keystone Transport', short: 'Keystone', color: 0x5a6a2e, strategy: 'rail', personality: 'conservative', trim: 0xe8c860 },
];
export const RIVAL_MAX = RIVAL_DEFS.length;
// which companies a new game gets: 'mixed' puts the railway companies first
// (the default), 'road' keeps the Phase 5–8 bus and truck companies
const MIX = { mixed: ['r5', 'r4', 'r1', 'r6', 'r2', 'r7', 'r3', 'r8'], road: ['r1', 'r2', 'r3'] };
export const RIVAL_COUNTS = [0, 1, 2, 3, 4, 8];
export const RIVAL_TIMINGS = ['together', 'staggered', 'late'];
const START_MONEY = 12000;
const ACQUIRE_LEVEL = 8;
const LOAN_STEP = 5000;
const AI_PER_TICK = 2;                 // companies doing their month's work in one simulation step

export class Rival {
  constructor(game, def) {
    this.game = game;
    Object.assign(this, def);
    this.idx = +def.id.slice(1);
    this.rail = def.strategy === 'rail' ? {} : null;
    // a railway company starts like the player: the difficulty's start money
    // plus a founding capital, and borrows on the player's terms
    this.money = this.rail ? START_MONEY + ((DIFFICULTY[game.difficultyId] || DIFFICULTY.standard).money | 0) : START_MONEY;
    if (this.money > 100000) this.money = 60000;      // (builder games: not the sandbox fortune)
    this.lines = [];          // [{a, b, stops:[id,id], kind, cargo}]
    this.inc = 0; this.exp = 0; this.lastProfit = 0;
    this.debtM = 0; this.forSale = false;
    this.loan = 0; this.spent = 0;
    this.paxCarried = 0; this.cargoCarried = 0;
    this.rel = {};            // town id -> relations with this company (0..100)
    this.startAt = 0;         // month the company becomes active
    this.hist = [];           // yearly: {y, rev, profit, value}
  }
  earn(n) { this.money += n; this.inc += n; }
  pay(n) { this.money -= n; this.exp += n; this.spent += n; }
  // it spends its own money only, keeping nothing back for construction the
  // planner checks against its reserve itself
  canSpend(n) { return this.money >= n - 1e-6; }
  carried(c, n) { if (c === 'PASSENGERS') this.paxCarried += n; else this.cargoCarried += n; }
  research() { return ALL_RESEARCH; }
  get livery() { return customToken({ body: this.color, trim: this.trim || 0xe8e2d4, stripe: 'band' }); }
  townRel(id) { return this.rel[id] ?? 60; }
  onTreesCleared(tile, n) {
    const t = this.game.towns.list.reduce((b, x) => (!b || cheb(tile, x.z * N + x.x) < cheb(tile, b.z * N + b.x) ? x : b), null);
    if (t && cheb(tile, t.z * N + t.x) <= 8) this.rel[t.id] = Math.max(0, this.townRel(t.id) - Math.min(8, Math.ceil(n / 4)));
  }
  // the loan: the player's rate and a limit from the company's assets
  rate() { const d = this.game.difficulty || {}; return d.interest ?? 0.06; }
  loanRoom() { return Math.max(0, Math.floor((5000 + this.assets() * 0.3) / LOAN_STEP) * LOAN_STEP - this.loan); }
  borrow(n) { const k = Math.min(this.loanRoom(), Math.ceil(n / LOAN_STEP) * LOAN_STEP); if (k <= 0) return 0; this.loan += k; this.money += k; return k; }
  repay() { const k = Math.min(this.loan, Math.floor(Math.max(0, this.money - 20000) / LOAN_STEP) * LOAN_STEP); if (k > 0) { this.loan -= k; this.money -= k; } }
  vehicles() { return this.game.roads.vehicles.filter((v) => v.owner === this.id); }
  stops() { return this.game.roads.stops.filter((s) => s.owner === this.id); }
  trains() { return this.game.trains.trains.filter((t) => t.owner === this.id); }
  stations() { return this.game.stations.list.filter((s) => s.owner === this.id); }
  trackTiles() { const net = this.game.net; let n = 0; for (let i = 0; i < net.conn.length; i++) if (net.conn[i] && net.own[i] === this.idx) n++; return n; }
  // what it owns besides cash: vehicles, trains, stops, stations and track
  assets() {
    const g = this.game, E = g.economy;
    const vs = this.vehicles().reduce((a, v) => { const m = ROAD_VEHICLES.find((x) => x.id === v.model); return a + (m ? m.price * 0.6 : 0); }, 0);
    let rail = 0;
    if (this.rail) {
      for (const t of this.trains()) rail += g.ledger.vehicleValue ? g.ledger.vehicleValue(t) : 0;
      rail += this.stations().length * E.costs.station() * 0.5 + this.trackTiles() * E.costs.trackTile(0, 0) * 0.5;
    }
    return vs + this.stops().length * 90 + rail;
  }
  value() { return Math.round(Math.max(0, this.money - this.loan + this.assets())); }
}

export class Rivals {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.month = -1;
    this.aiLevel = 'standard';
    this.planners = new Map();
    this.closed = [];          // companies that went out of business: {id, name, m}
    this.thinkMs = 0;          // time spent planning (performance budget)
  }
  byId(id) { return this.list.find((r) => r.id === id) || null; }
  // count companies; mix 'mixed' (railways first) or 'road'; timing: all
  // together, staggered (one every six months) or late entrants (from year 2)
  start(count, opts = {}) {
    const ids = (MIX[opts.mix] || MIX.mixed).slice(0, Math.max(0, Math.min(RIVAL_MAX, count | 0)));
    this.aiLevel = AI_LEVEL_IDS.includes(opts.aiLevel) ? opts.aiLevel : 'standard';
    this.list = ids.map((id) => new Rival(this.game, RIVAL_DEFS.find((d) => d.id === id)));
    const timing = RIVAL_TIMINGS.includes(opts.timing) ? opts.timing : 'together';
    this.list.forEach((r, k) => { r.startAt = timing === 'staggered' ? k * 6 : timing === 'late' ? 24 + k * 12 : 0; });
  }
  // after loading: anything owned by a company that no longer exists (a
  // damaged save) — its trains are removed, its infrastructure falls to the
  // player so no tile stays blocked by nobody
  orphans() {
    const g = this.game, ids = new Set(this.list.map((r) => r.id)), idxs = new Set(this.list.map((r) => r.idx));
    for (const t of g.trains.trains.slice()) if (t.owner && !ids.has(t.owner)) g.trains.sell(t);
    for (const s of g.stations.list) if (s.owner && !ids.has(s.owner)) delete s.owner;
    for (const d of g.stations.depots) if (d.owner && !ids.has(d.owner)) delete d.owner;
    const own = g.net.own;
    for (let i = 0; i < own.length; i++) if (own[i] && !idxs.has(own[i])) own[i] = 0;
  }
  planner(r) {
    if (!r.rail) return null;
    let p = this.planners.get(r.id);
    if (!p || p.r !== r) { p = new RailPlanner(this.game, r); this.planners.set(r.id, p); }
    return p;
  }

  // (the month's work is queued, at most AI_PER_TICK companies per simulation
  // step, so eight companies never plan in one frame; counted rather than
  // timed, so a world plays out the same on any machine)
  tick() {
    const g = this.game;
    if (!this.list.length || !g.ledger) return;
    const m = g.ledger.monthIndex();
    if (m !== this.month) {
      const first = this.month < 0;
      this.month = m;
      if (!first) this.queue = this.list.map((r) => r.id);
    }
    if (!this.queue || !this.queue.length) return;
    for (let k = 0; k < AI_PER_TICK && this.queue.length; k++) {
      const r = this.byId(this.queue.shift());
      if (r) this.companyMonth(r, m);
    }
  }
  companyMonth(r, m) {
    const g = this.game;
    {
      if (m < r.startAt) return;
      // interest on its loan, on the player's terms
      if (r.loan > 0) r.pay(Math.round(r.loan * r.rate() / 12));
      r.lastProfit = Math.round(r.inc - r.exp); r.inc = 0; r.exp = 0;
      if (m % 12 === 0) { r.hist.push({ y: g.ledger.year() - 1, profit: r.lastProfit, value: r.value(), pax: r.paxCarried, cargo: r.cargoCarried }); if (r.hist.length > 60) r.hist.shift(); }
      // served towns think better of the company over time
      if (r.rail) for (const s of r.stations()) if (s.picked > 0 && s.links) for (const id of s.links.towns) r.rel[id] = Math.min(100, r.townRel(id) + 0.5);
      // in debt for three months: up for sale
      r.debtM = r.money < 0 ? r.debtM + 1 : 0;
      if (r.debtM >= 3 && !r.forSale) { r.forSale = true; g.events.emit('rivalForSale', r); } else if (r.money > 2000) r.forSale = false;
      if (r.rail) {
        const t0 = performance.now();
        this.railMonth(r, m);
        this.thinkMs += performance.now() - t0;
      } else this.plan(r, m);
    }
  }
  // a railway company's month: survive first (cut costs, sell idle trains,
  // close the worst line), then operate and plan
  railMonth(r, m) {
    const P = this.planner(r);
    if (r.money < 0) {
      // borrow to stay afloat within its limit, else shrink
      if (r.borrow(-r.money + 2000) <= 0) {
        const worst = r.rail.projects.filter((p) => p.stage === 'operate').sort((a, b) => (a.lastYear || 0) - (b.lastYear || 0))[0];
        if (worst && r.debtM >= 2) P.retire(worst, 'cutting losses');
      }
      if (r.debtM >= 12) { this.liquidate(r); return; }
    } else if (r.money > 40000 && r.loan > 0) r.repay();
    P.monthly(m);
  }
  // a company that cannot recover closes: every train is sold, every station,
  // depot and track tile removed (nothing is left broken on the map)
  liquidate(r) {
    const g = this.game, S = g.stations, net = g.net, P = this.planner(r);
    P.as(() => {
      for (const t of r.trains()) g.trains.sell(t);
      for (const d of S.depots.filter((x) => x.owner === r.id)) S.removeDepot(d);
      for (const s of r.stations()) S.remove(s);
      for (let i = 0; i < net.conn.length; i++) if (net.conn[i] && net.own[i] === r.idx && !net.special.has(i)) g.construction.removeTrackOp(i);
    });
    for (const v of r.vehicles()) g.roads.sell(v);
    for (const s of r.stops()) g.roads.removeStop(s, 0);
    this.list = this.list.filter((x) => x !== r);
    this.planners.delete(r.id);
    this.closed.push({ id: r.id, name: r.name, m: g.ledger.monthIndex() });
    g.events.emit('rivalClosed', r);
  }

  // ---------- acquisition ----------
  acquirePrice(r) { return Math.round(Math.max(3000, r.value() * (r.forSale ? 0.8 : 1.5))); }
  acquireError(r) {
    const g = this.game;
    if (!r || !this.list.includes(r)) return 'err_unknown';
    if (g.progression.level < ACQUIRE_LEVEL) return 'err_locked';
    if (!g.economy.canAfford(this.acquirePrice(r))) return 'err_no_money';
    return null;
  }
  // its stops and vehicles become the company's, its cash comes along
  acquire(r) {
    const g = this.game, R = g.roads;
    const err = this.acquireError(r);
    if (err) return { error: err };
    const price = this.acquirePrice(r);
    // the price less the cash that comes with the company
    const net = price - Math.max(0, Math.round(r.money)) + Math.round(r.loan || 0);
    if (net > 0) g.economy.spend(net, 'acquisition', null, r.name); else if (net < 0) g.economy.earn(-net, 'sale', false, null, r.name);
    const vs = r.vehicles(), ss = r.stops();
    for (const s of ss) { delete s.owner; s.fin = null; }
    for (const v of vs) { delete v.owner; v.fin = null; v.cargo = []; v.bought = g.time - 3 * 720; }
    // a railway company: its trains, stations, depots and track become the
    // player's (a separate network until the player joins it up); its loan comes along
    const ts = r.trains(), sts = r.stations();
    for (const t of ts) { delete t.owner; t.fin = null; t.name = t.name.replace(`${r.short} `, ''); g.trains.refreshStats(t); }
    for (const s of sts) { delete s.owner; s.fin = null; }
    for (const d of g.stations.depots) if (d.owner === r.id) delete d.owner;
    const own = g.net.own;
    for (let i = 0; i < own.length; i++) if (own[i] === r.idx) own[i] = 0;
    if (r.loan > 0) { g.ledger.loan += r.loan; }
    this.list = this.list.filter((x) => x !== r);
    this.planners.delete(r.id);
    R.rebuildStopMesh();
    g.towns.onStationsChanged(); g.industries.onStationsChanged();
    if (g.network) g.network.invalidate && g.network.invalidate();
    g.stats.inc('rivalsAcquired');
    g.events.emit('rivalAcquired', r, { stops: ss.length, vehicles: vs.length, price });
    return { ok: true, price, stops: ss.length, vehicles: vs.length + ts.length, stations: sts.length };
  }

  // who carries a town's passengers: the company and each rival (stops and
  // stations serving the town, by travellers picked up there)
  marketShare(town) {
    const g = this.game, by = { you: 0 };
    for (const s of g.stations.list) if (s.links && s.links.towns.includes(town.id)) { const k = s.owner || 'you'; by[k] = (by[k] || 0) + (s.picked || 0); }
    for (const s of g.roads.stops) {
      if (!s.links || !(s.links.towns || []).includes(town.id)) continue;
      const k = s.owner || 'you';
      by[k] = (by[k] || 0) + (s.picked || 0);
    }
    const tot = Object.values(by).reduce((a, b) => a + b, 0);
    return { by, tot };
  }

  // a month's decision: open a line, or add a bus to a busy one
  plan(r, m) {
    const g = this.game, R = g.roads, rng = new RNG(hashStr(`rival:${g.world.seed}:${r.id}:${m}`));
    if (r.money < 2500) return;
    if (r.strategy === 'freight') { this.planFreight(r, rng); return; }
    // a busy line (full buses, waiting travellers): add a bus
    for (const ln of r.lines) {
      const st = ln.stops.map((id) => R.stopById(id)).filter(Boolean);
      const waiting = st.reduce((a, s) => a + (s.stock.PASSENGERS || 0), 0);
      const buses = R.vehicles.filter((v) => v.owner === r.id && v.stops.includes(ln.stops[0])).length;
      if (st.length === 2 && waiting > 40 && buses < 4 && r.money > 3000) { this.addBus(r, st[0], st[1]); return; }
    }
    if (rng.next() < 0.35) return;
    // a new line between two towns 5..16 tiles apart that this rival does not serve yet
    const P = g.progression;
    // (a town that gave the player a concession keeps rival buses out)
    const towns = g.towns.list.filter((t) => P.regionUnlocked(t.region) && t.roadSet && t.roadSet.size && !(g.standing && g.standing.concessionActive(t)));
    const served = new Set(r.lines.filter((l) => l.kind !== 'truck').flatMap((l) => [l.a, l.b]));
    // (town buses where a town is big enough, otherwise between towns)
    if (r.strategy === 'local' && this.planLocal(r, rng, towns, served)) return;
    const pairs = [];
    for (const a of towns) for (const b of towns) {
      if (a.id >= b.id || served.has(a.id) || served.has(b.id)) continue;
      const d = Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
      if (d >= 5 && d <= 16) pairs.push([a, b, d]);
    }
    if (!pairs.length) return;
    const [a, b] = pairs[Math.floor(rng.next() * pairs.length)];
    const street = (t) => [...t.roadSet].filter((i) => !g.net.conn[i] && !R.stopAt(i)).sort((x, y) => Math.abs(x % N - t.x) + Math.abs(Math.floor(x / N) - t.z) - (Math.abs(y % N - t.x) + Math.abs(Math.floor(y / N) - t.z)))[0];
    const sa = street(a), sb = street(b);
    if (sa == null || sb == null) return;
    // join them by road unless they already are
    if (!R.path(sa, sb)) {
      const plan = R.plan(sa, sb);
      if (!plan.ok || plan.cost > r.money - 2200 || plan.crossings > 0) return;   // never across the player's railway
      const res = R.build(plan, r);
      if (res.error) return;
    }
    const A = R.addStop(sa, 'bus', r), B = R.addStop(sb, 'bus', r);
    if (!A.stop || !B.stop) return;
    r.lines.push({ a: a.id, b: b.id, stops: [A.stop.id, B.stop.id], kind: 'bus' });
    this.addBus(r, A.stop, B.stop);
    g.events.emit('rivalLine', r, a, b);
  }
  // local buses: a line across one big town this rival does not serve yet
  planLocal(r, rng, towns, served) {
    const g = this.game, R = g.roads;
    const big = towns.filter((t) => !served.has(t.id) && t.stage >= 1 && t.roadSet.size >= 8);
    if (!big.length) return false;
    const t = big[Math.floor(rng.next() * big.length)];
    const st = [...t.roadSet].filter((i) => !g.net.conn[i] && !R.stopAt(i));
    let best = null;
    for (let k = 0; k < 40 && st.length > 1; k++) {
      const a = st[Math.floor(rng.next() * st.length)], b = st[Math.floor(rng.next() * st.length)];
      const d = cheb(a, b);
      if (d >= 3 && (!best || d > best.d) && R.path(a, b)) best = { a, b, d };
    }
    if (!best) return false;
    const A = R.addStop(best.a, 'bus', r), B = R.addStop(best.b, 'bus', r);
    if (!A.stop || !B.stop) { if (A.stop) R.removeStop(A.stop, 0); if (B.stop) R.removeStop(B.stop, 0); return false; }
    r.lines.push({ a: t.id, b: t.id, stops: [A.stop.id, B.stop.id], kind: 'bus' });
    this.addBus(r, A.stop, B.stop);
    g.events.emit('rivalLine', r, t, t);
    return true;
  }
  // freight: trucks from an industry to another that takes its cargo
  planFreight(r, rng) {
    const g = this.game, R = g.roads, I = g.industries, P = g.progression;
    // a busy freight line first: another truck
    for (const ln of r.lines) {
      if (ln.kind !== 'truck') continue;
      const A = R.stopById(ln.stops[0]);
      const n = R.vehicles.filter((v) => v.owner === r.id && v.stops.includes(ln.stops[0])).length;
      if (A && (A.stock[ln.cargo] || 0) > 30 && n < 4 && r.money > 4000) { const m = this.truckFor(ln.cargo); if (m) { const res = R.buy(m.id, A, r); if (res.vehicle) res.vehicle.stops.push(ln.stops[1]); } return; }
    }
    if (rng.next() < 0.3) return;
    const busy = new Set(r.lines.filter((l) => l.kind === 'truck').map((l) => l.a));
    const cands = [];
    for (const ind of I.list) {
      if (!P.regionUnlocked(ind.region) || ind.closed || busy.has(ind.id)) continue;
      for (const c of I.outputs(ind)) {
        if (!this.truckFor(c)) continue;
        for (const d of I.list) {
          if (d === ind || d.closed || !P.regionUnlocked(d.region) || !I.accepts(d, c)) continue;
          const dist = Math.max(Math.abs(d.x - ind.x), Math.abs(d.z - ind.z));
          if (dist >= 5 && dist <= 16) cands.push({ ind, d, c });
        }
      }
    }
    if (!cands.length) return;
    const { ind, d, c } = cands[Math.floor(rng.next() * cands.length)];
    const a = this.beside(ind), b = this.beside(d);
    if (a == null || b == null) return;
    if (!R.path(a, b)) {
      const plan = R.plan(a, b);
      if (!plan.ok || plan.cost > r.money - 3000 || plan.crossings > 0) return;   // never across the player's railway
      if (R.build(plan, r).error) return;
    }
    const A = R.addStop(a, 'truck', r), B = R.addStop(b, 'truck', r);
    const good = A.stop && B.stop && (A.stop.links.industries || []).includes(ind.id) && B.stop.accepts && B.stop.accepts.has(c);
    if (!good) { if (A.stop) R.removeStop(A.stop, 0); if (B.stop) R.removeStop(B.stop, 0); return; }
    const m = this.truckFor(c);
    const res = R.buy(m.id, A.stop, r);
    if (res.vehicle) res.vehicle.stops.push(B.stop.id);
    r.lines.push({ a: ind.id, b: d.id, stops: [A.stop.id, B.stop.id], kind: 'truck', cargo: c });
    g.events.emit('rivalFreight', r, ind, d, c);
  }
  truckFor(c) {
    const L = this.game.progression.level;
    return ROAD_VEHICLES.filter((m) => m.kind === 'truck' && m.level <= L && roadCaps(m)[c]).sort((a, b) => b.cap - a.cap)[0] || null;
  }
  // a free tile next to an industry's 2×2 site (the stop and road go there)
  beside(ind) {
    const R = this.game.roads;
    for (let dz = -1; dz <= 2; dz++) for (let dx = -1; dx <= 2; dx++) {
      if (dx >= 0 && dx <= 1 && dz >= 0 && dz <= 1) continue;
      const x = ind.x + dx, z = ind.z + dz;
      if (x < 0 || z < 0 || x >= N || z >= N) continue;
      const i = z * N + x;
      if ((R.hasRoad(i) && !R.stopAt(i) && !this.game.net.conn[i]) || R.tileOk(i)) return i;
    }
    return null;
  }
  addBus(r, A, B) {
    const R = this.game.roads, lvl = this.game.progression.level;
    const model = lvl >= 8 && r.money > 5000 ? 'coach' : 'citybus';
    const res = R.buy(model, A, r);
    if (res.vehicle) res.vehicle.stops.push(B.id);
  }

  serialize() {
    return this.list.map((r) => ({
      id: r.id, money: Math.round(r.money), lines: r.lines, lastProfit: r.lastProfit, debtM: r.debtM || undefined, forSale: r.forSale || undefined,
      loan: r.loan || undefined, startAt: r.startAt || undefined, pax: r.paxCarried || undefined, cargo: r.cargoCarried || undefined, rel: Object.keys(r.rel).length ? r.rel : undefined,
      home: r.home || undefined, hist: r.hist.length ? r.hist : undefined, aiLevel: this.aiLevel !== 'standard' ? this.aiLevel : undefined,
      rail: r.rail ? { ...r.rail, cands: undefined, candM: undefined } : undefined,
    }));
  }
  deserialize(d) {
    if (!Array.isArray(d)) return;
    this.list = [];
    for (const x of d) {
      const def = RIVAL_DEFS.find((q) => x && q.id === x.id);
      if (!def) continue;
      const r = new Rival(this.game, def);
      r.money = Number.isFinite(+x.money) ? +x.money : START_MONEY;
      r.lastProfit = +x.lastProfit || 0;
      r.lines = (Array.isArray(x.lines) ? x.lines : []).filter((l) => l && Array.isArray(l.stops)).map((l) => ({ a: l.a | 0, b: l.b | 0, stops: l.stops.map((s) => s | 0), kind: l.kind === 'truck' ? 'truck' : 'bus', cargo: l.kind === 'truck' && typeof l.cargo === 'string' ? l.cargo : undefined }));
      r.debtM = Math.max(0, Math.min(99, x.debtM | 0)); r.forSale = !!x.forSale;
      r.loan = Math.max(0, +x.loan || 0); r.startAt = Math.max(0, x.startAt | 0);
      r.paxCarried = Math.max(0, +x.pax || 0); r.cargoCarried = Math.max(0, +x.cargo || 0);
      if (x.rel && typeof x.rel === 'object') for (const k in x.rel) { const v = +x.rel[k]; if (/^\d+$/.test(k) && Number.isFinite(v)) r.rel[k] = Math.max(0, Math.min(100, v)); }
      if (x.home && Number.isFinite(+x.home.x) && Number.isFinite(+x.home.z)) r.home = { region: x.home.region | 0, x: x.home.x | 0, z: x.home.z | 0 };
      if (Array.isArray(x.hist)) r.hist = x.hist.filter((h) => h && Number.isFinite(+h.y)).slice(-60);
      if (AI_LEVEL_IDS.includes(x.aiLevel)) this.aiLevel = x.aiLevel;
      if (r.rail) r.rail = cleanRail(x.rail, this.game);
      this.list.push(r);
    }
  }
}

// a railway company's saved plans, sanitized (unknown stations, depots and
// trains are dropped; projects that lost their stations are dropped)
function cleanRail(d, g) {
  const st = { projects: [], nextId: 1, memory: {}, history: [], log: [], lastNew: -99, founded: null };
  if (!d || typeof d !== 'object') return st;
  st.nextId = Math.max(1, d.nextId | 0);
  st.lastNew = Number.isFinite(+d.lastNew) ? +d.lastNew : -99;
  st.founded = Number.isFinite(+d.founded) ? +d.founded : null;
  if (d.memory && typeof d.memory === 'object') for (const k in d.memory) if (typeof k === 'string' && k.length < 80 && Number.isFinite(+d.memory[k])) st.memory[k] = +d.memory[k];
  st.history = (Array.isArray(d.history) ? d.history : []).filter((h) => h && typeof h === 'object').slice(-40);
  st.log = (Array.isArray(d.log) ? d.log : []).filter((h) => h && typeof h.text === 'string').slice(-60);
  const STAGES = ['discover', 'evaluate', 'design', 'budget', 'approve', 'construct', 'operate', 'review'];
  for (const p of Array.isArray(d.projects) ? d.projects : []) {
    if (!p || !STAGES.includes(p.stage) || !p.a || !p.b) continue;
    const q = { ...p };
    q.trains = (Array.isArray(p.trains) ? p.trains : []).filter((id) => g.trains.byId(id));
    q.stations = (Array.isArray(p.stations) ? p.stations : []).filter((id) => g.stations.byId(id));
    q.rev = (Array.isArray(p.rev) ? p.rev : []).map(Number).filter(Number.isFinite).slice(-24);
    q.cd = p.cd && typeof p.cd === 'object' ? p.cd : {};
    q.hist = [];
    if ((q.stage === 'operate' || q.stage === 'review') && q.stations.length < 2) continue;
    // (construction is one step, never half done in a save)
    if (q.stage === 'construct') q.stage = 'approve';
    st.projects.push(q);
  }
  return st;
}
void MONTH_S; void PERSONALITIES;
