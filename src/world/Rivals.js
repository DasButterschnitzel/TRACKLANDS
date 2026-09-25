// Rival companies: computer-run bus companies competing for the towns'
// passengers. Each rival has its own money and books (never the player's
// ledger). Once a month it may open a line: a company road between two
// nearby towns in open regions, a stop in each and a bus; later it adds buses
// to busy lines and closes nothing. Its stops share each town's travellers
// with the player's stations by cargo rating, like any competing station.
// The player cannot edit or remove a rival's stops or buses.
import { N, RNG, hashStr } from '../util.js';
import { ROAD_VEHICLES } from '../config.js';

const RIVAL_DEFS = [
  { id: 'r1', name: 'Bluebird Coaches', short: 'Bluebird', color: 0x2f7ad0 },
  { id: 'r2', name: 'Crimson Motor Lines', short: 'Crimson', color: 0xc0392b },
];
const START_MONEY = 12000;

export class Rival {
  constructor(game, def) {
    this.game = game;
    Object.assign(this, def);
    this.money = START_MONEY;
    this.lines = [];          // [{a, b, stops:[id,id]}]
    this.inc = 0; this.exp = 0; this.lastProfit = 0;
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
  start(count) { this.list = RIVAL_DEFS.slice(0, Math.max(0, Math.min(2, count | 0))).map((d) => new Rival(this.game, d)); }

  tick() {
    const g = this.game;
    if (!this.list.length || !g.ledger) return;
    const m = g.ledger.monthIndex();
    if (m === this.month) return;
    const first = this.month < 0;
    this.month = m;
    if (first) return;
    for (const r of this.list) { r.lastProfit = Math.round(r.inc - r.exp); r.inc = 0; r.exp = 0; this.plan(r, m); }
  }

  // a month's decision: open a line, or add a bus to a busy one
  plan(r, m) {
    const g = this.game, R = g.roads, rng = new RNG(hashStr(`rival:${g.world.seed}:${r.id}:${m}`));
    if (r.money < 2500) return;
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
    const towns = g.towns.list.filter((t) => P.regionUnlocked(t.region) && t.roadSet && t.roadSet.size);
    const served = new Set(r.lines.flatMap((l) => [l.a, l.b]));
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
    r.lines.push({ a: a.id, b: b.id, stops: [A.stop.id, B.stop.id] });
    this.addBus(r, A.stop, B.stop);
    g.events.emit('rivalLine', r, a, b);
  }
  addBus(r, A, B) {
    const R = this.game.roads, lvl = this.game.progression.level;
    const model = lvl >= 8 && r.money > 5000 ? 'coach' : 'citybus';
    const res = R.buy(model, A, r);
    if (res.vehicle) res.vehicle.stops.push(B.id);
  }

  serialize() { return this.list.map((r) => ({ id: r.id, money: Math.round(r.money), lines: r.lines, lastProfit: r.lastProfit })); }
  deserialize(d) {
    if (!Array.isArray(d)) return;
    this.list = [];
    for (const x of d) {
      const def = RIVAL_DEFS.find((q) => x && q.id === x.id);
      if (!def) continue;
      const r = new Rival(this.game, def);
      r.money = Number.isFinite(+x.money) ? +x.money : START_MONEY;
      r.lastProfit = +x.lastProfit || 0;
      r.lines = (Array.isArray(x.lines) ? x.lines : []).filter((l) => l && Array.isArray(l.stops)).map((l) => ({ a: l.a | 0, b: l.b | 0, stops: l.stops.map((s) => s | 0) }));
      this.list.push(r);
    }
  }
}
