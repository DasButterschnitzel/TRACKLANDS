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
import { N, RNG, hashStr, cheb } from '../util.js';
import { ROAD_VEHICLES } from '../config.js';
import { roadCaps } from '../road/Roads.js';

const RIVAL_DEFS = [
  { id: 'r1', name: 'Bluebird Coaches', short: 'Bluebird', color: 0x2f7ad0, strategy: 'intercity' },
  { id: 'r2', name: 'Crimson Motor Lines', short: 'Crimson', color: 0xc0392b, strategy: 'local' },
  { id: 'r3', name: 'Northline Haulage', short: 'Northline', color: 0x3a8a4a, strategy: 'freight' },
];
export const RIVAL_MAX = RIVAL_DEFS.length;
const START_MONEY = 12000;
const ACQUIRE_LEVEL = 8;

export class Rival {
  constructor(game, def) {
    this.game = game;
    Object.assign(this, def);
    this.money = START_MONEY;
    this.lines = [];          // [{a, b, stops:[id,id], kind, cargo}]
    this.inc = 0; this.exp = 0; this.lastProfit = 0;
    this.debtM = 0; this.forSale = false;
  }
  earn(n) { this.money += n; this.inc += n; }
  pay(n) { this.money -= n; this.exp += n; }
  vehicles() { return this.game.roads.vehicles.filter((v) => v.owner === this.id); }
  stops() { return this.game.roads.stops.filter((s) => s.owner === this.id); }
  value() {
    const vs = this.vehicles().reduce((a, v) => { const m = ROAD_VEHICLES.find((x) => x.id === v.model); return a + (m ? m.price * 0.6 : 0); }, 0);
    return Math.round(Math.max(0, this.money + vs + this.stops().length * 90));
  }
}

export class Rivals {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.month = -1;
  }
  byId(id) { return this.list.find((r) => r.id === id) || null; }
  start(count) { this.list = RIVAL_DEFS.slice(0, Math.max(0, Math.min(RIVAL_MAX, count | 0))).map((d) => new Rival(this.game, d)); }

  tick() {
    const g = this.game;
    if (!this.list.length || !g.ledger) return;
    const m = g.ledger.monthIndex();
    if (m === this.month) return;
    const first = this.month < 0;
    this.month = m;
    if (first) return;
    for (const r of this.list) {
      r.lastProfit = Math.round(r.inc - r.exp); r.inc = 0; r.exp = 0;
      // in debt for three months: up for sale
      r.debtM = r.money < 0 ? r.debtM + 1 : 0;
      if (r.debtM >= 3 && !r.forSale) { r.forSale = true; g.events.emit('rivalForSale', r); } else if (r.money > 2000) r.forSale = false;
      this.plan(r, m);
    }
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
    const net = price - Math.max(0, Math.round(r.money));
    if (net > 0) g.economy.spend(net, 'acquisition', null, r.name); else if (net < 0) g.economy.earn(-net, 'sale', false, null, r.name);
    const vs = r.vehicles(), ss = r.stops();
    for (const s of ss) { delete s.owner; s.fin = null; }
    for (const v of vs) { delete v.owner; v.fin = null; v.cargo = []; v.bought = g.time - 3 * 720; }
    this.list = this.list.filter((x) => x !== r);
    R.rebuildStopMesh();
    g.towns.onStationsChanged(); g.industries.onStationsChanged();
    if (g.network) g.network.invalidate && g.network.invalidate();
    g.stats.inc('rivalsAcquired');
    g.events.emit('rivalAcquired', r, { stops: ss.length, vehicles: vs.length, price });
    return { ok: true, price, stops: ss.length, vehicles: vs.length };
  }

  // who carries a town's passengers: the company and each rival (stops and
  // stations serving the town, by travellers picked up there)
  marketShare(town) {
    const g = this.game, by = { you: 0 };
    for (const s of g.stations.list) if (s.links && s.links.towns.includes(town.id)) by.you += s.picked || 0;
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

  serialize() { return this.list.map((r) => ({ id: r.id, money: Math.round(r.money), lines: r.lines, lastProfit: r.lastProfit, debtM: r.debtM || undefined, forSale: r.forSale || undefined })); }
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
      this.list.push(r);
    }
  }
}
