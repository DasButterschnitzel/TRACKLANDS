// Cargo flows (Phase 7): where every load comes from, where it is heading and
// what it earns.
//
// A load (a "lot" on a vehicle, a "packet" waiting at a station or stop)
// remembers
//   o / ot  the node where it first entered the network and that node's tile
//   t0      when it entered (its age; delivery-time payment)
//   fd      the node it is heading for (travellers: their destination;
//           freight: where the network expects it to be taken in)
//   to      where the vehicle it is on drops it (its destination or a change)
//   lg      its finished legs: [refType, refId, tiles, mode, fare] per earlier
//           vehicle (at most MAX_LEGS; older legs merge into the first)
//   x       how many times it changed vehicle
//   p       travellers: the purpose of the trip (PaxFlow)
//   op      travellers who take any train from here (no timetable to plan by)
// Every field is optional: loads from older saves and fresh cargo carry none
// of them and behave exactly as before.
//
// Payment happens once, when a load is delivered: the fare for the whole
// journey (origin to delivery point, by the total time it took) is split over
// the legs by the distance each covered, and each share is booked on the
// vehicle that drove that leg (so a feeder bus earns its part when the
// travellers arrive). Changing vehicles pays nothing, so carrying a load back
// and forth never earns more than delivering it.
//
// Waiting packets are always a subset of the node's stock (stock[c] counts
// everything waiting; packets only add history to part of it).
import { cheb } from '../util.js';
import { modeFit, CARGO } from '../config.js';
import { nodeKey, RS } from './Network.js';

export const MAX_LEGS = 6;
const MAX_PK = 160;            // packets kept per node (the smallest merge beyond)
const TICK = 2;

export class CargoFlows {
  constructor(game) {
    this.game = game;
    this._t = 0;
    this.stats = { settled: 0, legs: 0, transfers: 0, xferUnits: 0, pending: 0 };
  }
  get net() { return this.game.network; }

  // ---------- nodes ----------
  nodes() { const g = this.game; return g.roads ? g.stations.list.concat(g.roads.stops) : g.stations.list; }
  packets(node, c) { return node.pk ? (c ? node.pk.filter((p) => p.c === c) : node.pk) : []; }
  pkTotal(node, c, pred = null) { let n = 0; if (node.pk) for (const p of node.pk) if (p.c === c && (!pred || pred(p))) n += p.n; return n; }
  fresh(node, c) { return Math.max(0, Math.floor((node.stock[c] || 0) - this.pkTotal(node, c))); }

  // a new lot from the plain stock of a node (cargo that starts its journey here)
  lotAt(node, c, n, extra) {
    const g = this.game;
    const lot = { c, n, from: node.id, t0: g.time, o: nodeKey(node), ot: node.tile };
    if (extra) Object.assign(lot, extra);
    return lot;
  }

  // Take up to n of cargo c from a node: matching packets first (oldest
  // first), then plain stock. accept(packet) -> false skips a packet;
  // fresh: whether plain stock may be taken. Returns lots (without `to`).
  take(node, c, n, { accept = null, fresh = true, extra = null } = {}) {
    const out = [];
    n = Math.floor(Math.min(n, node.stock[c] || 0));
    if (n <= 0) return out;
    if (node.pk && node.pk.length) {
      const list = node.pk.filter((p) => p.c === c && (!accept || accept(p))).sort((a, b) => (a.t0 ?? 0) - (b.t0 ?? 0));
      for (const p of list) {
        if (n <= 0) break;
        const k = Math.min(n, Math.floor(p.n));
        if (k <= 0) continue;
        p.n -= k; n -= k;
        node.stock[c] -= k;
        const lot = { ...p, n: k, from: node.id };
        if (extra) Object.assign(lot, extra);
        out.push(lot);
      }
      node.pk = node.pk.filter((p) => p.n >= 1);
      if (!node.pk.length) delete node.pk;
    }
    if (n > 0 && fresh) {
      const k = Math.min(n, this.fresh(node, c));
      if (k > 0) { node.stock[c] -= k; out.push(this.lotAt(node, c, k, extra)); }
    }
    return out;
  }

  // ---------- changing vehicle ----------
  // The finished leg of a lot on vehicle ref (from node `fromObj` to node `here`)
  addLeg(lot, ref, fromObj, here, mode, fare = 1) {
    const d = Math.max(1, fromObj ? cheb(fromObj.tile, here.tile) : 1);
    if (lot.o == null) { lot.o = fromObj ? nodeKey(fromObj) : nodeKey(here); lot.ot = fromObj ? fromObj.tile : here.tile; }
    const lg = lot.lg ? lot.lg.slice() : [];
    lg.push([ref ? ref.type : '', ref ? ref.id : -1, d, mode, Math.round(fare * 1000) / 1000]);
    // keep the first legs' distance in one entry when a load changes very often
    while (lg.length > MAX_LEGS) { const a = lg.shift(), b = lg.shift(); lg.unshift([a[0], a[1], a[2] + b[2], a[3], a[4]]); }
    lot.lg = lg;
    lot.x = (lot.x | 0) + 1;
  }

  // Does a load that got off at `here` end its journey there? (its
  // destination; freight also anywhere that takes it; loads without a plan
  // wherever they are accepted)
  endsHere(lot, here) {
    const k = nodeKey(here);
    const acc = this.net ? this.net.accepts(k, lot.c) : false;
    if (lot.fd == null) return acc || lot.c === 'PASSENGERS';
    if (lot.fd === k) return !lot.op;
    if (lot.c !== 'PASSENGERS' && acc) return true;
    // a destination that is gone: end here if this place takes it
    if (this.net && !this.net.obj(lot.fd)) return acc;
    return false;
  }
  // where a load that changes at `node` waits: here, or at the next stop of
  // its journey when that starts with a short walk (a bus stop at a station)
  walkOn(node, lot) {
    const NW = this.net;
    if (!NW) return null;
    const k = nodeKey(node);
    let e = null;
    if (lot.c === 'PASSENGERS') { if (lot.fd == null || lot.fd === k) return null; const r = NW.reach(k).get(lot.fd); e = r && r.first; }
    else { const r = NW.toAcc(lot.c).get(k); e = r && r.e; }
    return e && e.walk && e.from === k ? NW.obj(e.to) : null;
  }
  // A load changes vehicle at `node`: it waits there (or walks on) for the
  // next service. Returns how many units found room.
  change(node, lot, ref, fromObj, mode, fare = 1) {
    const at = this.walkOn(node, lot) || node;
    return this.drop(at, lot, ref, fromObj, mode, fare, node);
  }

  // A lot leaves vehicle `ref` at `node` to continue on another vehicle
  // (legEnd: where the vehicle stopped, if the load walked on from there).
  // Returns how many units the node took (it may be full).
  drop(node, lot, ref, fromObj, mode, fare = 1, legEnd = node) {
    const g = this.game;
    const took = g.stations.receive(node, lot.c, lot.n);
    if (took <= 0) return 0;
    const p = { ...lot, n: took };
    delete p.to; delete p.via; delete p.rail; delete p.from;
    this.addLeg(p, ref, fromObj, legEnd, mode, fare);
    this.addPacket(node, p);
    g.stations.noteTransfer(node, lot.c, took);
    this.stats.transfers++; this.stats.xferUnits += took;
    if (lot.c === 'PASSENGERS') g.stats.inc('paxTransfers', took);
    else g.stats.inc('cargoTransfers', took);
    if (g.economy.onTransfer) g.economy.onTransfer(took, lot.c);
    return took;
  }
  addPacket(node, p) {
    if (!node.pk) node.pk = [];
    const sig = (q) => `${q.c}|${q.fd ?? ''}|${q.ot ?? ''}|${q.p || ''}|${q.op ? 1 : 0}|${(q.lg || []).map((l) => l[0] + l[1]).join(',')}`;
    const s = sig(p);
    const same = node.pk.find((q) => sig(q) === s);
    if (same) { same.t0 = ((same.t0 ?? 0) * same.n + (p.t0 ?? 0) * p.n) / (same.n + p.n); same.n += p.n; same.x = Math.max(same.x | 0, p.x | 0); return; }
    node.pk.push(p);
    if (node.pk.length > MAX_PK) this.compact(node);
  }
  // too many packets: the smallest merge into a bigger one of the same cargo and destination
  compact(node) {
    node.pk.sort((a, b) => b.n - a.n);
    while (node.pk.length > MAX_PK) {
      const p = node.pk.pop();
      const q = node.pk.find((x) => x.c === p.c && x.fd === p.fd) || node.pk.find((x) => x.c === p.c);
      if (q) { q.t0 = ((q.t0 ?? 0) * q.n + (p.t0 ?? 0) * p.n) / (q.n + p.n); q.n += p.n; }
    }
  }
  // packets can never exceed what waits (stock may have been reduced elsewhere)
  clamp(node) {
    if (!node.pk) return;
    const by = {};
    for (const p of node.pk) { if (!(p.n >= 1) || !CARGO[p.c]) p.n = 0; by[p.c] = (by[p.c] || 0) + p.n; }
    for (const c in by) {
      let over = by[c] - Math.floor(node.stock[c] || 0);
      if (over <= 0) continue;
      for (const p of node.pk.filter((x) => x.c === c).sort((a, b) => a.n - b.n)) { const k = Math.min(over, p.n); p.n -= k; over -= k; if (over <= 0) break; }
    }
    node.pk = node.pk.filter((p) => p.n >= 1).map((p) => { p.n = Math.floor(p.n); return p; });
    if (!node.pk.length) delete node.pk;
  }
  // destinations that no longer exist: those loads wait with no plan (freight
  // finds another place; travellers take any service)
  forget(key) {
    for (const n of this.nodes()) if (n.pk) for (const p of n.pk) if (p.fd === key) { delete p.fd; delete p.p; }
  }

  // ---------- payment ----------
  // A lot is delivered at `here` by the vehicle `ref` (train: the train
  // object, for its bonuses) that picked it up at `fromObj`; mode and fare
  // of that last leg. Pays the whole journey once, split over the legs.
  // Returns { rev, res (town / industry that took it), dist, shares }.
  settle(lot, here, { train = null, ref = null, fromObj = null, mode = 'rail', fare = 1, rival = null } = {}) {
    const g = this.game, E = g.economy, S = g.stations;
    const c = lot.c, n = lot.n;
    const legs = (lot.lg || []).map((l) => ({ ref: l[0] ? { type: l[0], id: l[1] } : null, d: l[2] || 1, m: l[3] || 'rail', f: l[4] || 1 }));
    legs.push({ ref, d: Math.max(1, fromObj ? cheb(fromObj.tile, here.tile) : 1), m: mode, f: fare, last: true });
    const ot = lot.ot != null ? lot.ot : fromObj ? fromObj.tile : here.tile;
    const dist = cheb(ot, here.tile);
    const town = here.links && here.links.towns.length ? g.towns.byId(here.links.towns[0]) : here.cargoTown != null ? g.towns.byId(here.cargoTown) : null;
    const needed = town ? g.towns.needs(town, c) : false;
    const transit = lot.t0 != null ? Math.max(0, g.time - lot.t0) : 0;
    const base = E.revenue(c, n, dist, train, needed, transit) * (lot.p ? purposeFare(lot.p) : 1);
    const legD = legs.reduce((a, l) => a + l.d, 0);
    const shares = legs.map((l) => Math.round(base * (l.d / legD) * modeFit(l.m, c) * l.f));
    const rev = shares.reduce((a, b) => a + b, 0);
    const res = S.distribute(here, c, n, { planned: lot.fd != null });
    const from = lot.o != null ? this.net.obj(lot.o) : fromObj;
    if (rival) { rival.earn(rev); return { rev, res, dist, shares }; }
    // bookings: every leg's share on its vehicle, the station figures once
    const note = `~dlv|${c}|${n}|${from ? from.name : ''}|${here.name || ''}`;
    legs.forEach((l, i) => {
      const s = shares[i];
      if (s <= 0) return;
      E.earn(s, E.revCat(c), true, l.ref, note);
      if (l.ref) {
        g.ledger.objUnits(l.ref, c, n);
        const o = g.ledger.objOf(l.ref);
        if (o) {
          o.earned = (o.earned || 0) + s;
          if (l.ref.type === 'road' && o.line != null && g.roads) { g.roads.lines.note(o, 'rev', s); g.roads.lines.note(o, 'pax', n); }
        }
      }
    });
    const L = g.ledger;
    if (rev > 0) { L.objBook({ type: here.road ? 'roadstop' : 'station', id: here.id }, rev, E.revCat(c)); if (from && from !== here) L.objBook({ type: from.road ? 'roadstop' : 'station', id: from.id }, rev * 0.5, E.revCat(c)); }
    // statistics and contracts, once per delivery
    const St = g.stats;
    St.inc('deliveries');
    St.incCargo(c, n);
    if (c === 'PASSENGERS') St.inc('passengers', n); else St.inc('freightIncome', rev);
    St.inc('cargoUnits', n);
    St.max('longestRoute', dist);
    if (legs.length > 1) { St.inc('multiLeg', 1); St.max('mostLegs', legs.length); }
    E.bucket.income += rev;
    E.bucket.deliveries++;
    if (res.town) { const tb = E.bucket.towns[res.town.id] || (E.bucket.towns[res.town.id] = {}); tb[c] = (tb[c] || 0) + n; }
    E.noteDelivery(c, n, rev, res, from, here);
    this.stats.settled++; this.stats.legs += legs.length;
    return { rev, res, dist, shares, legs: legs.length };
  }

  // the value a load would fetch if delivered now at `here` (UI: what a
  // feeder vehicle is owed when its loads arrive)
  estimate(lot, here) {
    const g = this.game;
    const ot = lot.ot != null ? lot.ot : here.tile;
    return Math.round(g.economy.revenue(lot.c, lot.n, cheb(ot, here.tile), null, false, 0));
  }

  // loads a vehicle handed over that are still on their way (count, units)
  pendingFor(ref) {
    let n = 0, u = 0;
    const m = (lots) => { for (const p of lots || []) if (p.lg && p.lg.some((l) => l[0] === ref.type && l[1] === ref.id)) { n++; u += p.n; } };
    for (const s of this.nodes()) m(s.pk);
    for (const t of this.game.trains.trains) m(t.cargo);
    if (this.game.roads) for (const v of this.game.roads.vehicles) m(v.cargo);
    return { lots: n, units: u };
  }

  // after loading a save: packets bound for places that no longer exist wait
  // with no plan, and no node holds more packets than stock
  afterLoad() {
    const NW = this.net;
    for (const s of this.nodes()) {
      if (!s.pk) continue;
      for (const p of s.pk) if (p.fd != null && (!NW || !NW.obj(p.fd) || p.fd === nodeKey(s))) { delete p.fd; delete p.p; delete p.op; }
      this.clamp(s);
    }
  }

  tick(dt) {
    this._t -= dt;
    if (this._t > 0) return;
    this._t = TICK;
    for (const s of this.nodes()) if (s.pk) this.clamp(s);
  }

  // ---------- save ----------
  // loads that may share one entry (same cargo, journey and history)
  static sig(q) { return `${q.c}|${q.to ?? ''}|${q.fd ?? ''}|${q.ot ?? ''}|${q.p || ''}|${q.op ? 1 : 0}|${q.rail ? 1 : 0}|${(q.lg || []).map((l) => l[0] + l[1]).join(',')}`; }
  static cleanLot(l) {
    if (!l || typeof l !== 'object' || !CARGO[l.c] || !(l.n > 0)) return null;
    const o = { c: l.c, n: Math.floor(l.n) };
    if (!(o.n > 0)) return null;
    if (Number.isInteger(l.from)) o.from = l.from;
    if (typeof l.t0 === 'number' && isFinite(l.t0)) o.t0 = l.t0;
    if (Number.isInteger(l.to)) o.to = l.to;
    if (Number.isInteger(l.via) && l.via !== l.to) o.via = l.via;
    if (l.rail === true) o.rail = true;
    if (Number.isInteger(l.o) && l.o >= 0) o.o = l.o;
    if (Number.isInteger(l.ot) && l.ot >= 0) o.ot = l.ot;
    if (Number.isInteger(l.fd) && l.fd >= 0) o.fd = l.fd;
    if (Number.isInteger(l.x) && l.x > 0) o.x = Math.min(99, l.x);
    if (typeof l.p === 'string' && PURPOSE_IDS.includes(l.p)) o.p = l.p;
    if (l.op === true || l.op === 1) o.op = 1;
    if (Array.isArray(l.lg)) {
      const lg = l.lg.filter((e) => Array.isArray(e) && typeof e[0] === 'string' && Number.isFinite(+e[1]) && Number.isFinite(+e[2]) && +e[2] > 0).slice(-MAX_LEGS).map((e) => [e[0].slice(0, 12), +e[1] | 0, Math.min(9999, +e[2]), typeof e[3] === 'string' ? e[3].slice(0, 8) : 'rail', Number.isFinite(+e[4]) && +e[4] > 0 ? Math.min(5, +e[4]) : 1]);
      if (lg.length) o.lg = lg;
    }
    return o;
  }
  static cleanPackets(arr) {
    if (!Array.isArray(arr)) return undefined;
    const out = arr.map((p) => CargoFlows.cleanLot(p)).filter(Boolean).map((p) => { delete p.from; delete p.to; delete p.via; delete p.rail; return p; }).slice(0, MAX_PK);
    return out.length ? out : undefined;
  }
}

// trip purposes (PaxFlow): what share of travellers make each kind of trip,
// what attracts them, how far they are willing to go (seconds of travel,
// generalised: waiting and changes count) and what they pay (× fare)
export const PURPOSES = {
  commute:   { share: 0.32, attr: 'jobs',    tau: 160,  max: 480,  fare: 1.0 },
  shopping:  { share: 0.14, attr: 'shops',   tau: 100,  max: 300,  fare: 0.9 },
  education: { share: 0.08, attr: 'edu',     tau: 170,  max: 480,  fare: 0.85 },
  leisure:   { share: 0.14, attr: 'leisure', tau: 260,  max: 720,  fare: 1.0 },
  tourism:   { share: 0.06, attr: 'tour',    tau: 900,  max: 2400, fare: 1.2 },
  business:  { share: 0.12, attr: 'biz',     tau: 450,  max: 1500, fare: 1.25 },
  intercity: { share: 0.14, attr: 'pop',     tau: 1400, max: 3600, fare: 1.1, near: 45 },
};
export const PURPOSE_IDS = Object.keys(PURPOSES);
export function purposeFare(p) { return (PURPOSES[p] && PURPOSES[p].fare) || 1; }

export { RS };
