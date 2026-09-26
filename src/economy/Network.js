// Transport network: the company's services as one graph (Phase 7).
//
// Nodes are the company's railway stations and road stops (bus, lorry, tram,
// dock, airport). Every service that runs a regular pattern adds directed
// rides between the nodes it calls at:
//   - a railway line: timetabled trains calling at the same stations (Lines)
//   - a bus, tram, lorry, ferry, ship or air line (RoadLines)
//   - trains without a timetable ("auto") on one rail network: an irregular
//     service linking the stations they may serve (freight only; travellers
//     who take them wait at the station as before, see Flows)
// plus transfer links between nodes close enough to change on foot or to
// hand freight over (a lorry stop beside a freight terminal, a bus stop at a
// railway station, a dock beside a lorry depot, two stations side by side).
//
// Freight asks: from here, what is the cheapest way to any place that takes
// this cargo? (one search per cargo, backwards from every accepting node).
// Travellers ask: from here, where can I get to and how long does it take?
// (one search per origin). Costs are in game seconds: waiting counts half a
// service interval (and feels longer than riding), in-vehicle time counts by
// the mode's comfort, each change adds a penalty (walking, handling). Results
// are cached until the services change (at most MAX_AGE seconds of game time).
import { cheb, tx, tz } from '../util.js';
import { KMH_PER_TILE_S, ROAD_VEHICLES, CARGO, STOP_MODE } from '../config.js';

export const RS = 1000000;                              // road stop keys start here
export const nodeKey = (s) => (s ? (s.road ? RS + s.id : s.id) : null);
export const isStopKey = (k) => k >= RS;

// perceived in-vehicle time by mode (a comfortable ride feels shorter)
export const COMFORT = { rail: 1.0, tram: 1.05, road: 1.15, water: 1.0, air: 0.9 };
const WAIT_W = 1.5;          // waiting feels longer than riding
export const XFER = { pax: 45, freight: 30 };   // seconds per change of vehicle
const WALK_S = 6;            // seconds per tile on foot (or moving freight across a yard)
const MAX_AGE = 12;          // rebuild at least this often (game seconds)
const AUTO_WAIT = 90;        // trains without a timetable: an irregular service
const AUTO_LINKS = 40;       // links per station of an auto service (nearest first)
const REACH_CACHE = 400;
const LINK_REACH = 3;        // tiles: two nodes this close are one interchange
const DWELL_RAIL = 8, DWELL_ROAD = 3, AIR_TURN = 6;
const AIR_SPEED = 0.6;       // (as Roads: aircraft cover this share of their speed on the map)

// a tiny binary heap of [cost, key]
class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(c, k) {
    const a = this.a; a.push([c, k]);
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
}

const euclid = (a, b) => Math.hypot(tx(a) - tx(b), tz(a) - tz(b));
const manh = (a, b) => Math.abs(tx(a) - tx(b)) + Math.abs(tz(a) - tz(b));

export class TransportNetwork {
  constructor(game) {
    this.game = game;
    this.nodes = new Map();
    this.svcs = [];
    this.byTrain = new Map();     // train id -> service
    this.byLine = new Map();      // road line id -> service
    this.ver = 0;
    this.t = -1e9;
    this.dirty = true;
    this._acc = new Map();
    this._reach = new Map();
    const E = game.events;
    for (const ev of ['linesChanged', 'stationBuilt', 'stationEdited', 'stationRemoved', 'stationsRelinked', 'trainBought', 'trainSold', 'routeChanged']) E.on(ev, () => { this.dirty = true; });
  }
  invalidate() { this.dirty = true; }

  // ---------- nodes ----------
  obj(k) {
    if (k == null) return null;
    const g = this.game;
    return k >= RS ? (g.roads ? g.roads.stopById(k - RS) : null) : g.stations.byId(k);
  }
  node(k) { this.ensure(); return this.nodes.get(k) || null; }
  tileOf(k) { const o = this.obj(k); return o ? o.tile : -1; }
  name(k) { const o = this.obj(k); return o ? o.name : '?'; }
  accepts(k, c) {
    const o = this.obj(k);
    if (!o) return false;
    return o.road ? !!(o.accepts && o.accepts.has(c)) : this.game.stations.accepts(o, c);
  }
  // the towns a node serves (for travellers)
  townsOf(k) { const o = this.obj(k); return o && o.links ? o.links.towns || [] : []; }

  ensure() {
    const g = this.game;
    const lv = g.lines ? g.lines.version : 0;
    if (!this.dirty && lv === this._lv && g.time >= this.t && g.time - this.t < MAX_AGE) return;
    this._lv = lv;
    this.build();
  }

  // ---------- build ----------
  build() {
    const g = this.game, S = g.stations, R = g.roads;
    this.nodes = new Map();
    this.svcs = [];
    this.byTrain = new Map(); this.byLine = new Map();
    const add = (o) => { const k = nodeKey(o); this.nodes.set(k, { key: k, o, tile: o.tile, out: [], inn: [] }); };
    for (const s of S.list) add(s);
    if (R) for (const s of R.stops) if (!s.owner && s.kind !== 'garage') add(s);
    if (g.lines) { g.lines.invalidate(); for (const L of g.lines.list()) this.addRailLine(L); }
    this.addAuto();
    if (R) for (const l of R.lines.list) this.addRoadLine(l);
    this.addTransfers();
    this.ver++;
    this.t = g.time;
    this.dirty = false;
    this._acc.clear();
    this._reach.clear();
  }

  svcBase(o) {
    const s = { id: this.svcs.length, stops: [], carries: new Set(), cap: {}, n: 0, cycle: 0, headway: 0, wait: 0, hop: new Map(), ...o };
    this.svcs.push(s);
    return s;
  }

  // rides from every boarding stop to every later stop of the cycle (the
  // same vehicle, no change), with the in-vehicle time along the way
  addRides(svc, segs) {
    const st = svc.stops, m = st.length;
    if (m < 2 || !svc.n) return;
    for (let i = 0; i < m; i++) {
      if (!st[i].board) continue;
      const a = st[i].k;
      if (!this.nodes.has(a)) continue;
      let acc = 0;
      for (let step = 1; step < m; step++) {
        const j = (i + step) % m;
        if (svc.oneway && j <= i) break;          // a one-way service ends at its last stop
        acc += segs[(i + step - 1) % m];
        const b = st[j].k;
        if (b === a) break;
        if (!st[j].drop || !this.nodes.has(b)) continue;
        let h = svc.hop.get(a);
        if (!h) svc.hop.set(a, h = new Map());
        const prev = h.get(b);
        if (prev != null && prev <= acc) continue;
        h.set(b, acc);
      }
    }
    for (const [a, h] of svc.hop) for (const [b, ivt] of h) this.edge(a, b, { svc: svc.id, mode: svc.mode, ivt, wait: svc.wait, dist: cheb(this.nodes.get(a).tile, this.nodes.get(b).tile) });
  }
  // handover speed at a node (stations: their equipment)
  handling(k) { const o = this.obj(k); return o && !o.road && this.game.stations.handling ? this.game.stations.handling(o) : 1; }
  edge(a, b, e) {
    const A = this.nodes.get(a), B = this.nodes.get(b);
    if (!A || !B || a === b) return;
    const x = { from: a, to: b, ...e };
    if (x.h == null) { const h = x.walk ? Math.min(this.handling(a), this.handling(b)) : this.handling(a); if (h !== 1) x.h = h; }
    A.out.push(x); B.inn.push(x);
  }

  addRailLine(L) {
    const g = this.game, S = g.stations;
    const t0 = L.trains[0];
    if (!t0) return;
    const stops = t0.route.filter((r) => !r.skip && r.st != null && S.byId(r.st)).map((r) => ({ k: r.st, board: r.act !== 'unload' && r.act !== 'none', drop: r.act !== 'load' && r.act !== 'none', xfer: r.act === 'transfer' }));
    if (new Set(stops.map((s) => s.k)).size < 2) return;
    const svc = this.svcBase({ kind: 'rail', mode: 'rail', ref: L.key, stops, n: L.trains.length });
    let vsum = 0;
    for (const t of L.trains) {
      this.byTrain.set(t.id, svc);
      for (const c in t._st.caps) if (t._st.caps[c] > 0) { svc.carries.add(c); svc.cap[c] = (svc.cap[c] || 0) + t._st.caps[c] / L.trains.length; }
      vsum += t._st.speed;
    }
    const v = Math.max(0.3, (vsum / L.trains.length / KMH_PER_TILE_S) * 0.75);
    const segs = stops.map((s, i) => { const a = S.byId(s.k).tile, b = S.byId(stops[(i + 1) % stops.length].k).tile; return (euclid(a, b) * 1.25) / v + DWELL_RAIL; });
    // measured round trips (timing point to timing point) scale the estimate
    const cyc = L.trains.map((t) => t.cycleEma || 0).filter((c) => c > 0);
    const est = segs.reduce((a, b) => a + b, 0);
    const meas = cyc.length ? cyc.reduce((a, b) => a + b, 0) / cyc.length : 0;
    const k = meas > 0 ? Math.max(0.5, Math.min(3, meas / est)) : 1;
    for (let i = 0; i < segs.length; i++) segs[i] *= k;
    svc.cycle = est * k;
    svc.headway = svc.cycle / svc.n;
    svc.wait = Math.max(3, Math.min(900, svc.headway / 2));
    this.addRides(svc, segs);
  }

  // trains without a timetable, per rail network: they serve every station
  // there, irregularly (freight may route through them)
  addAuto() {
    const g = this.game, S = g.stations;
    const auto = g.trains.trains.filter((t) => t.mode !== 'manual' && t.state !== 'stored' && !t.depotIn);
    if (!auto.length) return;
    const comp = g.net.components();
    const groups = new Map();
    for (const t of auto) {
      const tile = t.steps && t.steps.length ? t.steps[t.steps.length - 1].tile : null;
      let k = tile != null ? comp[tile] : -1;
      if (k == null || k < 0) { const d = S.depotById ? S.depotById(t.depotId) : null; k = d ? comp[d.tile] : -1; }
      if (k == null || k < 0) continue;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(t);
    }
    for (const [k, trains] of groups) {
      const sts = S.list.filter((s) => comp[s.tile] === k);
      if (sts.length < 2) continue;
      const svc = this.svcBase({ kind: 'auto', mode: 'rail', ref: 'auto:' + k, stops: sts.map((s) => ({ k: s.id, board: true, drop: true })), n: trains.length, auto: true });
      let vsum = 0;
      for (const t of trains) {
        this.byTrain.set(t.id, svc);
        for (const c in t._st.caps) if (t._st.caps[c] > 0) { svc.carries.add(c); svc.cap[c] = (svc.cap[c] || 0) + t._st.caps[c] / trains.length; }
        vsum += t._st.speed;
      }
      const v = Math.max(0.3, (vsum / trains.length / KMH_PER_TILE_S) * 0.7);
      svc.wait = AUTO_WAIT / Math.min(4, Math.sqrt(trains.length));
      svc.headway = svc.wait * 2;
      for (const a of sts) {
        const near = sts.filter((b) => b !== a).sort((p, q) => cheb(a.tile, p.tile) - cheb(a.tile, q.tile)).slice(0, AUTO_LINKS);
        const h = new Map();
        svc.hop.set(a.id, h);
        for (const b of near) {
          const ivt = (euclid(a.tile, b.tile) * 1.3) / v + DWELL_RAIL;
          h.set(b.id, ivt);
          this.edge(a.id, b.id, { svc: svc.id, mode: 'rail', ivt, wait: svc.wait, dist: cheb(a.tile, b.tile), auto: true });
        }
      }
    }
  }

  addRoadLine(l) {
    const g = this.game, R = g.roads;
    const vs = R.lines.vehicles(l).filter((v) => v.state !== 'stored');
    const seq = R.lines.seq(l);
    if (seq.length < 2) return;
    const m = seq.length;
    const stops = seq.map((id, i) => ({ k: RS + id, board: R.lines.boards(l, i), drop: true }));
    const mode = STOP_MODE[l.kind] || 'road';
    const svc = this.svcBase({ kind: 'road', mode, ref: l.id, stops, n: vs.length, oneway: l.pattern === 'oneway', line: l });
    this.byLine.set(l.id, svc);
    const models = vs.length ? vs.map((v) => ROAD_VEHICLES.find((x) => x.id === v.model)).filter(Boolean) : [];
    const m0 = models[0] || R.lines.model(l);
    if (!m0) return;
    for (const md of models.length ? models : [m0]) {
      const caps = roadCapsOf(md);
      for (const c in caps) { svc.carries.add(c); svc.cap[c] = (svc.cap[c] || 0) + caps[c] / Math.max(1, models.length); }
    }
    const kmh = models.length ? models.reduce((a, x) => a + x.speed, 0) / models.length : m0.speed;
    const v = Math.max(0.2, (kmh / KMH_PER_TILE_S) * (mode === 'air' ? AIR_SPEED : 0.85));
    const tiles = seq.map((id, i) => {
      const a = R.stopById(id), b = R.stopById(seq[(i + 1) % m]);
      if (!a || !b) return 1;
      return mode === 'air' ? euclid(a.tile, b.tile) : manh(a.tile, b.tile) * (mode === 'water' ? 1.35 : 1.15);
    });
    const segs = tiles.map((n) => n / v + (mode === 'air' ? AIR_TURN : DWELL_ROAD));
    const est = segs.reduce((a, b) => a + b, 0);
    const k = l.cycEma > 0 ? Math.max(0.5, Math.min(3, l.cycEma / est)) : 1;
    for (let i = 0; i < m; i++) segs[i] *= k;
    svc.cycle = est * k;
    svc.headway = svc.n ? svc.cycle / svc.n : 0;
    svc.wait = svc.n ? Math.max(2, Math.min(900, svc.headway / 2)) : 0;
    this.addRides(svc, segs);
  }

  // change points: a stop beside a railway station, stops side by side,
  // stations side by side (walking, or freight moved across the yard)
  addTransfers() {
    const g = this.game, S = g.stations, R = g.roads;
    const keys = [...this.nodes.keys()];
    const tilesOf = (k) => { const o = this.obj(k); return o.road ? (R ? R.stopTiles(o) : [o.tile]) : S.allTiles(o); };
    const T = new Map(keys.map((k) => [k, tilesOf(k)]));
    const dist = (a, b) => { let d = Infinity; for (const u of T.get(a)) for (const w of T.get(b)) { const x = cheb(u, w); if (x < d) d = x; } return d; };
    const link = (a, b, d, mul = 1) => {
      const w = (12 + WALK_S * d) / mul;
      this.edge(a, b, { svc: -1, mode: 'walk', ivt: w, wait: 0, dist: d, walk: true });
      this.edge(b, a, { svc: -1, mode: 'walk', ivt: w, wait: 0, dist: d, walk: true });
    };
    const done = new Set();
    // road stops: their railway station in reach (the feeder link)
    if (R) for (const s of R.stops) {
      if (s.owner || s.kind === 'garage' || s.rail == null || !this.nodes.has(s.rail)) continue;
      const a = RS + s.id, b = s.rail;
      done.add(a + ':' + b);
      link(a, b, dist(a, b), R.stopProps ? R.stopProps(s).transfer || 1 : 1);
    }
    // anything else within LINK_REACH tiles (bucketed by coarse cell)
    const cell = new Map();
    const C = 8;
    for (const k of keys) { const t = this.nodes.get(k).tile, key = Math.floor(tx(t) / C) + ':' + Math.floor(tz(t) / C); if (!cell.has(key)) cell.set(key, []); cell.get(key).push(k); }
    for (const k of keys) {
      const t = this.nodes.get(k).tile, cx = Math.floor(tx(t) / C), cz = Math.floor(tz(t) / C);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) for (const j of cell.get((cx + dx) + ':' + (cz + dz)) || []) {
        if (j <= k) continue;
        const pk = k + ':' + j, pj = j + ':' + k;
        if (done.has(pk) || done.has(pj)) continue;
        if (cheb(t, this.nodes.get(j).tile) > LINK_REACH + 3) continue;
        const d = dist(k, j);
        if (d > LINK_REACH) continue;
        done.add(pk);
        link(k, j, d);
      }
    }
  }

  // ---------- queries ----------
  svcOfTrain(t) { this.ensure(); return this.byTrain.get(t.id) || null; }
  svcOfLine(id) { this.ensure(); return this.byLine.get(id) || null; }
  svcOfRoad(v) { return v && v.line != null ? this.svcOfLine(v.line) : null; }

  // what a ride or link costs (seconds, generalised); freight handover is
  // quicker at stations with handling equipment (e.h, Stations.handling)
  rideCost(e, pax, first) {
    if (e.walk) return pax ? e.ivt : (e.ivt + XFER.freight) * (e.h || 1);
    if (pax) return e.ivt * (COMFORT[e.mode] || 1) + e.wait * WAIT_W + (first ? 0 : XFER.pax);
    return e.ivt + e.wait * 0.5 + XFER.freight * (e.h || 1);
  }

  // freight: for every node, the cheapest way to any node that takes cargo c
  // (cost, the accepting node it leads to, and the first ride or link)
  toAcc(c) {
    this.ensure();
    let r = this._acc.get(c);
    if (r) return r;
    r = new Map();
    const h = new Heap();
    for (const [k] of this.nodes) if (this.accepts(k, c)) { r.set(k, { cost: 0, dest: k, e: null }); h.push(0, k); }
    while (h.size) {
      const [d, u] = h.pop();
      const cur = r.get(u);
      if (!cur || d > cur.cost) continue;
      for (const e of this.nodes.get(u).inn) {
        if (e.svc >= 0 && !this.svcs[e.svc].carries.has(c)) continue;
        const nd = d + this.rideCost(e, false, false);
        const x = r.get(e.from);
        if (x && x.cost <= nd) continue;
        r.set(e.from, { cost: nd, dest: cur.dest, e });
        h.push(nd, e.from);
      }
    }
    this._acc.set(c, r);
    return r;
  }

  // travellers: every node reachable from `from` over timetabled services and
  // walking links (not trains without a timetable): Map key -> {cost, first
  // (the first ride or link), ivt, wait, xfers, dist}
  reach(from, c = 'PASSENGERS') {
    this.ensure();
    const ck = from + '|' + c;
    let r = this._reach.get(ck);
    if (r) return r;
    r = new Map();
    if (!this.nodes.has(from)) return r;
    r.set(from, { cost: 0, first: null, ivt: 0, wait: 0, xfers: 0, rides: 0 });
    const h = new Heap();
    h.push(0, from);
    while (h.size) {
      const [d, u] = h.pop();
      const cur = r.get(u);
      if (!cur || d > cur.cost) continue;
      for (const e of this.nodes.get(u).out) {
        if (e.svc >= 0) { const s = this.svcs[e.svc]; if (s.auto || !s.carries.has(c)) continue; }
        const first = cur.rides === 0;
        const nd = d + this.rideCost(e, true, first);
        const x = r.get(e.to);
        if (x && x.cost <= nd) continue;
        r.set(e.to, { cost: nd, first: u === from ? e : cur.first, ivt: cur.ivt + (e.walk ? 0 : e.ivt), wait: cur.wait + (e.walk ? 0 : e.wait), walk: (cur.walk || 0) + (e.walk ? e.ivt : 0), xfers: cur.xfers + (e.walk || first ? 0 : 1), rides: cur.rides + (e.walk ? 0 : 1) });
        h.push(nd, e.to);
      }
    }
    if (this._reach.size > REACH_CACHE) this._reach.clear();
    this._reach.set(ck, r);
    return r;
  }

  // the stops ahead of a vehicle's service from node `k` (drop allowed),
  // with the in-vehicle time to each: Map key -> seconds
  hopsFrom(svc, k) { return svc ? svc.hop.get(k) || null : null; }

  // a short summary for the UI: services, links, nodes
  summary() {
    this.ensure();
    let rides = 0, links = 0;
    for (const n of this.nodes.values()) for (const e of n.out) { if (e.walk) links++; else rides++; }
    return { nodes: this.nodes.size, services: this.svcs.length, rides, links: links / 2, ver: this.ver };
  }
}

// what a road vehicle model carries (cargo -> capacity), as Roads.roadCaps
function roadCapsOf(m) {
  const out = {};
  if (!m) return out;
  if (m.kind === 'bus' || m.pax) { out.PASSENGERS = m.cap; if (m.mail) out.MAIL = m.mail; return out; }
  for (const c in CARGO) if ((m.groups || []).includes(CARGO[c].group)) out[c] = m.cap;
  return out;
}
