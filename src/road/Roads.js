// Road transport: company roads (drag-built like track), bus and truck stops,
// buses and trucks. Stops behave like small stations towards the rest of the
// game: towns and industries in reach supply and accept at them (with cargo
// ratings), deliveries pay like trains, finance books them per vehicle. A
// stop within reach of a railway station hands passengers and freight over
// to the railway (feeder service, paid for the road leg). Vehicles drive on
// company roads and town streets, wait at level crossings and never enter
// one while it warns or is closed.
import * as THREE from 'three';
import { N, TILE, idx, tx, tz, inMap, tileCX, tileCZ, cheb } from '../util.js';
import { heightAt } from '../world/WorldGen.js';
import { CARGO, KMH_PER_TILE_S, ROAD_VEHICLES, ROAD_COSTS } from '../config.js';
import { ModelBuilder, MATS } from '../core/ModelBuilder.js';

const D4 = [[1, 0, 1], [0, 1, 2], [-1, 0, 4], [0, -1, 8]];   // dx, dz, bit  (E S W N)
const opp4 = (b) => (b === 1 ? 4 : b === 4 ? 1 : b === 2 ? 8 : 2);
const MAXV = 300;

export function roadModel(id) { return ROAD_VEHICLES.find((m) => m.id === id) || null; }
// what a road vehicle can carry: {cargo: capacity}
export function roadCaps(m) {
  const out = {};
  if (!m) return out;
  if (m.kind === 'bus') { out.PASSENGERS = m.cap; if (m.mail) out.MAIL = m.mail; return out; }
  for (const c in CARGO) if (m.groups.includes(CARGO[c].group)) out[c] = m.cap;
  return out;
}

export class Roads {
  constructor(game) {
    this.game = game;
    this.bits = new Uint8Array(N * N);   // company roads: links to E S W N
    this.stops = [];
    this.vehicles = [];
    this.nextStop = 1; this.nextVeh = 1;
    this.version = 0;
    this._town = null;
    this.buildView();
  }

  // ---------- network ----------
  townRoads() {
    if (this._town) return this._town;
    const s = new Set();
    for (const t of this.game.towns.list) if (t.roadSet) for (const i of t.roadSet) s.add(i);
    this._town = s;
    return s;
  }
  townsChanged() { this._town = null; this.version++; }
  hasRoad(i) { return i >= 0 && (this.bits[i] !== 0 || this.townRoads().has(i)); }
  // can traffic go from i to its neighbour j in direction bit b?
  linked(i, j, b) {
    if (!this.hasRoad(i) || !this.hasRoad(j)) return false;
    const T = this.townRoads();
    const own = (this.bits[i] & b) || (this.bits[j] & opp4(b));
    const town = T.has(i) && T.has(j);
    if (!own && !town) return false;
    // over a level crossing only straight across the railway
    const X = this.game.crossings, ax = b === 1 || b === 4 ? 0 : 2;
    for (const k of [i, j]) { const c = X && X.at(k); if (c && c.axis !== ax) return false; if (!c && this.game.net.conn[k]) return false; }
    return true;
  }
  neighbours(i) {
    const out = [];
    const x = tx(i), z = tz(i);
    for (const [dx, dz, b] of D4) { const X = x + dx, Z = z + dz; if (!inMap(X, Z)) continue; const j = idx(X, Z); if (this.linked(i, j, b)) out.push(j); }
    return out;
  }
  // shortest road path (BFS over tiles; small maps)
  path(a, b) {
    if (a === b) return [a];
    const prev = new Map([[a, -1]]);
    const q = [a];
    for (let h = 0; h < q.length; h++) {
      const i = q[h];
      for (const j of this.neighbours(i)) {
        if (prev.has(j)) continue;
        prev.set(j, i);
        if (j === b) { const out = [b]; let k = i; while (k !== -1) { out.push(k); k = prev.get(k); } return out.reverse(); }
        q.push(j);
      }
    }
    return null;
  }

  // ---------- building roads ----------
  // may a company road use this tile, and in which axis (null = any)?
  tileOk(i) {
    const g = this.game, W = g.world, net = g.net;
    if (i < 0 || W.type[i] !== 0) return false;
    if (!g.progression.regionUnlocked(W.region[i])) return false;
    if (g.occupancy.blocked[i]) return false;
    if (net.special.has(i) || net.waypoints.has(i)) return false;
    if (g.decor && g.decor.at(i)) return false;
    if (this.stopAt(i)) return true;
    return true;
  }
  railAxis(i) { const X = this.game.crossings; return this.game.net.conn[i] ? X.roadAxisThrough(i) : null; }
  plan(a, b) {
    const res = { ok: false, tiles: [], cost: 0, crossings: 0, reason: null };
    if (!this.tileOk(a) || !this.tileOk(b)) { res.reason = 'err_road_blocked'; return res; }
    // A* on the 4-grid; rail only straight across plain track
    const g = this.game, costs = g.economy.costs, mul = costs.mul();
    const open = [[0, a]], gS = new Map([[a, 0]]), from = new Map([[a, -1]]), dirIn = new Map([[a, 0]]);
    const hgt = (i) => Math.abs(tx(i) - tx(b)) + Math.abs(tz(i) - tz(b));
    let found = false, it = 0;
    while (open.length && it++ < 20000) {
      open.sort((p, q) => p[0] - q[0]);
      const [, i] = open.shift();
      if (i === b) { found = true; break; }
      for (const [dx, dz, bit] of D4) {
        const X = tx(i) + dx, Z = tz(i) + dz;
        if (!inMap(X, Z)) continue;
        const j = idx(X, Z);
        if (!this.tileOk(j)) continue;
        const ax = bit === 1 || bit === 4 ? 0 : 2;
        const ra = this.railAxis(j), ri = this.railAxis(i);
        if (ra === -1 || (ra != null && ra !== ax) || (ri != null && ri !== ax)) continue;
        const step = (this.hasRoad(j) ? 0.35 : 1) + (ra != null ? 3 : 0) + (dirIn.get(i) && dirIn.get(i) !== bit ? 0.2 : 0);
        const ng = gS.get(i) + step;
        if (ng < (gS.get(j) ?? Infinity)) { gS.set(j, ng); from.set(j, i); dirIn.set(j, bit); open.push([ng + hgt(j), j]); }
      }
    }
    if (!found) { res.reason = 'err_road_no_path'; return res; }
    const tiles = [];
    for (let k = b; k !== -1; k = from.get(k)) tiles.push(k);
    tiles.reverse();
    res.tiles = tiles;
    for (let k = 0; k < tiles.length; k++) {
      const i = tiles[k];
      const exists = k > 0 && this.linked(tiles[k - 1], i, this.bitBetween(tiles[k - 1], i));
      if (!exists) res.cost += ROAD_COSTS.tile * mul;
      if (this.game.net.conn[i]) { res.crossings++; if (!exists) res.cost += ROAD_COSTS.crossing * mul; }
    }
    res.cost = Math.round(res.cost);
    res.ok = true;
    return res;
  }
  bitBetween(i, j) { const dx = tx(j) - tx(i), dz = tz(j) - tz(i); return dx === 1 ? 1 : dx === -1 ? 4 : dz === 1 ? 2 : 8; }
  build(plan) {
    const g = this.game;
    if (!plan || !plan.ok) return { error: plan ? plan.reason : 'err_unknown' };
    if (!g.economy.canAfford(plan.cost)) return { error: 'err_no_money' };
    const prev = plan.tiles.map((t) => [t, this.bits[t]]);
    for (let k = 1; k < plan.tiles.length; k++) {
      const i = plan.tiles[k - 1], j = plan.tiles[k], b = this.bitBetween(i, j);
      this.bits[i] |= b; this.bits[j] |= opp4(b);
    }
    if (plan.cost > 0) g.economy.spend(plan.cost, 'construction', { type: 'tile', id: plan.tiles[Math.floor(plan.tiles.length / 2)] }, `~fin_n_road:${plan.tiles.length}`);
    const wooded = plan.tiles.filter((t) => g.world.view.hasTrees(t));
    g.world.view.clearTreesMany(plan.tiles);
    if (wooded.length && g.authority) g.authority.onTreesCleared(wooded[0], wooded.length);
    this.changed();
    g.construction.pushUndo({ type: 'road', prev, cost: plan.cost });
    g.audio.play('construct');
    return { ok: true };
  }
  undo(e) {
    for (const [t, b] of e.prev) this.bits[t] = b;
    // the neighbours' links back to these tiles
    for (const [t] of e.prev) for (const [dx, dz, b] of D4) { const X = tx(t) + dx, Z = tz(t) + dz; if (!inMap(X, Z)) continue; const j = idx(X, Z); if (!(this.bits[t] & b)) this.bits[j] &= ~opp4(b); }
    this.changed();
  }
  removeTile(i) {
    const g = this.game;
    if (!this.bits[i]) return { error: 'err_unknown' };
    if (this.vehicles.some((v) => v.tile === i || v.next === i)) return { error: 'err_road_in_use' };
    if (this.stopAt(i)) return { error: 'err_road_stop_here' };
    for (const [dx, dz, b] of D4) { const X = tx(i) + dx, Z = tz(i) + dz; if (inMap(X, Z)) this.bits[idx(X, Z)] &= ~opp4(b); }
    this.bits[i] = 0;
    g.economy.earn(Math.round(ROAD_COSTS.tile * g.economy.costs.mul() * 0.5), 'refund', false, { type: 'tile', id: i });
    this.changed();
    return { ok: true };
  }
  changed() {
    this.version++;
    if (this.game.crossings) this.game.crossings.version = -1;
    this.rebuildRoadMesh();
    for (const v of this.vehicles) v.path = null;   // re-route
  }

  // ---------- stops ----------
  stopAt(i) { return this.stops.find((s) => s.tile === i) || null; }
  stopById(id) { return this.stops.find((s) => s.id === id) || null; }
  byId(id) { return this.vehicles.find((v) => v.id === id) || null; }
  stopError(i, kind) {
    const g = this.game;
    if (!this.hasRoad(i)) return 'err_stop_needs_road';
    if (g.net.conn[i]) return 'err_stop_on_rail';
    if (this.stopAt(i)) return 'err_occupied';
    if (!g.economy.canAfford(this.stopCost())) return 'err_no_money';
    void kind;
    return null;
  }
  stopCost() { return Math.round(ROAD_COSTS.stop * this.game.economy.costs.mul()); }
  addStop(i, kind = 'bus') {
    const g = this.game;
    const err = this.stopError(i, kind);
    if (err) return { error: err };
    const s = {
      id: this.nextStop++, tile: i, kind, road: true, name: '', level: 0, stock: {}, claimed: {}, facilities: [], delivered: 0, picked: 0, created: g.time,
      stats: { arrivals: 0, wait: 0, _lastWait: 0, waitEma: 0, transfers: 0, recent: [], util: [] }, links: null, accepts: null, supplies: null, warn: false,
    };
    this.relink(s);
    s.name = this.stopName(s);
    this.stops.push(s);
    g.economy.spend(this.stopCost(), 'construction', { type: 'roadstop', id: s.id }, `~fin_n_stop_${kind}:1`);
    g.towns.onStationsChanged(); g.industries.onStationsChanged();
    this.rebuildStopMesh();
    g.construction.pushUndo({ type: 'roadstop', id: s.id, cost: this.stopCost() });
    g.audio.play('construct');
    return { ok: true, stop: s };
  }
  removeStop(s, refund = 0.5) {
    const g = this.game;
    if (this.vehicles.some((v) => v.stops.includes(s.id))) return { error: 'err_stop_in_use' };
    this.stops = this.stops.filter((x) => x !== s);
    if (refund) g.economy.earn(Math.round(this.stopCost() * refund), 'refund', false, null, s.name);
    g.towns.onStationsChanged(); g.industries.onStationsChanged();
    this.rebuildStopMesh();
    return { ok: true };
  }
  stopName(s) {
    const L = s.links;
    const t = L && L.towns.length ? this.game.towns.byId(L.towns[0]) : null;
    const base = t ? t.name : L && L.industries.length ? this.game.industries.displayName(this.game.industries.byId(L.industries[0])) : 'Halt';
    let n = 1, name = `${base} ${s.kind === 'bus' ? 'Bus' : 'Truck'}`;
    while (this.stops.some((x) => x.name === name)) name = `${base} ${s.kind === 'bus' ? 'Bus' : 'Truck'} ${++n}`;
    return name;
  }
  relink(s) {
    const S = this.game.stations;
    const { towns, inds } = S.previewLinks([s.tile], 0);
    s.links = { towns: s.kind === 'bus' ? towns.map((t) => t.id) : [], industries: s.kind === 'truck' ? inds.map((i) => i.id) : [] };
    const acc = new Set(), sup = new Set();
    if (s.links.towns.length) { acc.add('PASSENGERS'); acc.add('MAIL'); sup.add('PASSENGERS'); sup.add('MAIL'); }
    for (const id of s.links.industries) {
      const ind = this.game.industries.byId(id);
      const cfg = ind && this.game.industries.cfg ? this.game.industries.cfg(ind) : null;
      void cfg;
      if (ind) { for (const c in CARGO) { if (this.game.industries.accepts(ind, c)) acc.add(c); } for (const c in ind.out || {}) sup.add(c); }
    }
    s.accepts = acc; s.supplies = sup;
    // a railway station in reach: the feeder link
    let best = null, bd = 4;
    for (const st of S.list) { const d = Math.min(...S.allTiles(st).map((t) => cheb(t, s.tile))); if (d < bd) { bd = d; best = st; } }
    s.rail = best ? best.id : null;
  }
  relinkAll() { for (const s of this.stops) this.relink(s); }

  // ---------- vehicles ----------
  buy(modelId, stop) {
    const g = this.game, m = roadModel(modelId);
    if (!m || !stop) return { error: 'err_unknown' };
    if (m.kind !== stop.kind) return { error: 'err_wrong_stop' };
    const price = Math.round(m.price * g.difficulty.costMul);
    if (!g.economy.canAfford(price)) return { error: 'err_no_money' };
    let n = 1; while (this.vehicles.some((v) => v.name === `${m.name.split(' ')[0]} ${n}`)) n++;
    const v = { id: this.nextVeh++, model: m.id, name: `${m.name.split(' ')[0]} ${n}`, stops: [stop.id], idx: 0, tile: stop.tile, prev: -1, next: -1, f: 0, path: null, state: 'load', t: 2, cargo: [], earned: 0, trips: 0, bought: g.time, fin: null, v: 0 };
    this.vehicles.push(v);
    g.economy.spend(price, 'road_vehicles', { type: 'road', id: v.id }, v.name);
    this.ensureVehMesh();
    return { ok: true, vehicle: v };
  }
  sell(v) {
    const g = this.game, m = roadModel(v.model);
    this.vehicles = this.vehicles.filter((x) => x !== v);
    const refund = Math.round((m ? m.price : 0) * g.difficulty.costMul * 0.5);
    g.economy.earn(refund, 'sale', false, null, v.name);
    return refund;
  }
  caps(v) { return roadCaps(roadModel(v.model)); }
  load(v) { return v.cargo.reduce((a, l) => a + l.n, 0); }
  // ref / _st so road vehicles can go through the shared delivery code
  ref(v) { return { type: 'road', id: v.id }; }

  tick(dt) {
    const g = this.game;
    for (const v of this.vehicles) {
      const m = roadModel(v.model);
      if (!m) continue;
      // running costs, booked per vehicle
      g.economy.operatingCost((m.op / 60) * dt * (v.state === 'idle' ? 0.3 : 1), this.ref(v));
      if (v.state === 'load') {
        v.t -= dt;
        if (v.t > 0) continue;
        this.leave(v);
        continue;
      }
      if (v.state === 'idle') { v.t -= dt; if (v.t <= 0) this.leave(v); continue; }
      // run along the path, one tile edge at a time
      if (!v.path || v.pi >= v.path.length - 1) { this.arrive(v); continue; }
      const next = v.path[v.pi + 1];
      const X = g.crossings;
      const blocked = (X && X.isBlocked(next) && v.f < 0.4) || this.vehicles.some((o) => o !== v && o.tile === next && o.path && o.path[o.pi + 1] !== v.tile && o.f < 0.3 && o.state === 'run');
      const vmax = (m.speed / KMH_PER_TILE_S) * (g.env ? g.env.effects.speed : 1);
      v.v = blocked ? 0 : Math.min(vmax, v.v + dt * 1.2);
      if (blocked && v.f > 0.35) v.f = Math.max(v.f, 0.35);
      v.f += v.v * dt;
      if (blocked && v.f > 0.38) v.f = 0.38;
      while (v.f >= 1 && v.pi < v.path.length - 1) { v.f -= 1; v.pi++; v.prev = v.tile; v.tile = v.path[v.pi]; }
    }
  }
  targetStop(v) { return this.stopById(v.stops[v.idx % v.stops.length]); }
  leave(v) {
    if (v.stops.length < 2) { v.state = 'idle'; v.t = 3; v.problem = 'no_route'; return; }
    v.idx = (v.idx + 1) % v.stops.length;
    const s = this.targetStop(v);
    const p = s ? this.path(v.tile, s.tile) : null;
    if (!p) { v.state = 'idle'; v.t = 4; v.problem = 'no_road'; return; }
    v.problem = null;
    v.path = p; v.pi = 0; v.f = 0; v.state = 'run';
  }
  arrive(v) {
    const g = this.game, s = this.targetStop(v);
    v.state = 'load'; v.t = 3; v.v = 0; v.path = null;
    if (!s || s.tile !== v.tile) { v.t = 1; return; }
    s.stats.arrivals++;
    v.trips++;
    this.unload(v, s);
    this.loadAt(v, s);
  }
  unload(v, s) {
    const g = this.game, E = g.economy, S = g.stations;
    const keep = [];
    for (const lot of v.cargo) {
      if (lot.from === s.id) { keep.push(lot); continue; }
      const from = this.stopById(lot.from) || S.byId(lot.from);
      const dist = from ? cheb(from.tile, s.tile) : 6;
      const transit = lot.t0 != null ? Math.max(0, g.time - lot.t0) : 0;
      // travellers from this same town do not "arrive" here: they change to
      // the railway if there is one (or stay aboard)
      const sameTown = from && from.links && s.links && from.links.towns.some((id) => s.links.towns.includes(id)) && (lot.c === 'PASSENGERS' || lot.c === 'MAIL');
      if (s.accepts && s.accepts.has(lot.c) && !sameTown) {
        const town = s.links.towns.length ? g.towns.byId(s.links.towns[0]) : null;
        const needed = town ? g.towns.needs(town, lot.c) : false;
        const rev = Math.round(E.revenue(lot.c, lot.n, dist, null, needed, transit) * 0.9);
        E.bookDelivery(rev, lot.c, lot.n, null, from, s, this.ref(v));
        S.distribute(s, lot.c, lot.n);
        v.earned += rev; E.bucket.income += rev; E.bucket.deliveries++;
        g.stats.inc('deliveries'); g.stats.incCargo(lot.c, lot.n); if (lot.c === 'PASSENGERS') g.stats.inc('passengers', lot.n);
        g.events.emit('roadDelivery', { vehicle: v, stop: s, cargo: lot.c, amount: lot.n, revenue: rev });
        continue;
      }
      // feeder: hand over to the railway station in reach, paid for this leg
      const rail = s.rail != null ? S.byId(s.rail) : null;
      if (rail) {
        const took = S.receive(rail, lot.c, lot.n);
        if (took > 0) {
          const share = Math.round(E.revenue(lot.c, took, Math.max(dist, 1), null, false, transit) * 0.45);
          E.bookDelivery(share, lot.c, took, null, from, rail, this.ref(v));
          v.earned += share; E.bucket.income += share;
          S.noteTransfer(rail, lot.c, took); s.stats.transfers += took;
          g.events.emit('roadDelivery', { vehicle: v, stop: s, cargo: lot.c, amount: took, revenue: share, transfer: rail });
        }
        if (took < lot.n) keep.push({ ...lot, n: lot.n - took });
        continue;
      }
      keep.push(lot);
    }
    v.cargo = keep;
  }
  loadAt(v, s) {
    const g = this.game, caps = this.caps(v);
    // only cargo that some other stop on the route can take (or feed to rail)
    const others = v.stops.filter((id) => id !== s.id).map((id) => this.stopById(id)).filter(Boolean);
    for (const c in caps) {
      const have = v.cargo.filter((l) => l.c === c).reduce((a, l) => a + l.n, 0);
      const room = caps[c] - have;
      if (room <= 0 || !(s.stock[c] >= 1)) continue;
      const townOf = (x) => (x.links ? x.links.towns : []);
      const useful = (o) => o.rail != null || (o.accepts && o.accepts.has(c) && !((c === 'PASSENGERS' || c === 'MAIL') && townOf(o).some((id) => townOf(s).includes(id))));
      if (!others.some(useful)) continue;
      const n = Math.min(room, Math.floor(s.stock[c]));
      s.stock[c] -= n; s.picked += n;
      v.cargo.push({ c, n, from: s.id, t0: g.time });
      if (g.ratings) g.ratings.onPickup(s, c, { _st: { speed: roadModel(v.model).speed } });
    }
    v.t = 2 + Math.min(4, this.load(v) / 12);
  }

  // ---------- visuals ----------
  buildView() {
    const g = this.game;
    this.group = new THREE.Group();
    g.scene.add(this.group);
    this.roadMat = new THREE.MeshLambertMaterial({ color: 0x74706b, flatShading: true, side: THREE.DoubleSide });
    const bus = new ModelBuilder();
    bus.box(0.62, 0.24, 0.26, 0xffffff, { y: 0.05 });
    bus.box(0.5, 0.08, 0.27, 0x9fc8e6, { x: 0.02, y: 0.18 });
    bus.box(0.04, 0.06, 0.2, 0xfff2c0, { x: 0.31, y: 0.1, glow: true });
    const truck = new ModelBuilder();
    truck.box(0.18, 0.22, 0.24, 0xffffff, { x: 0.22, y: 0.05 });
    truck.box(0.4, 0.2, 0.26, 0xd8d2c4, { x: -0.1, y: 0.07 });
    truck.box(0.04, 0.05, 0.18, 0xfff2c0, { x: 0.31, y: 0.1, glow: true });
    const stop = new ModelBuilder();
    stop.box(0.5, 0.03, 0.2, 0x3a4250, { y: 0.34 });
    stop.cyl(0.02, 0.02, 0.34, 5, 0x3a4250, { x: -0.22, z: -0.08 });
    stop.cyl(0.02, 0.02, 0.34, 5, 0x3a4250, { x: 0.22, z: -0.08 });
    stop.box(0.46, 0.22, 0.02, 0xbfd8e6, { z: -0.09, y: 0.1 });
    stop.cyl(0.015, 0.015, 0.46, 5, 0x3a4250, { x: 0.3, z: 0.12 });
    stop.box(0.12, 0.12, 0.02, 0x2fb3a3, { x: 0.3, z: 0.12, y: 0.4 });
    this.busMesh = new THREE.InstancedMesh(bus.build(), MATS, MAXV);
    this.truckMesh = new THREE.InstancedMesh(truck.build(), MATS, MAXV);
    this.stopMesh = new THREE.InstancedMesh(stop.build(), MATS, 200);
    for (const m of [this.busMesh, this.truckMesh, this.stopMesh]) { m.count = 0; m.frustumCulled = false; m.castShadow = true; this.group.add(m); }
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(1.3, 1.3, 1.3); this._c = new THREE.Color();
    this._up = new THREE.Vector3(0, 1, 0);
  }
  ensureVehMesh() { /* instanced meshes sized for MAXV */ }
  rebuildRoadMesh() {
    if (this.roadMesh) { this.group.remove(this.roadMesh); this.roadMesh.geometry.dispose(); this.roadMesh = null; }
    const W = this.game.world, pos = [];
    const H = (x, z) => heightAt(W, x, z) + 0.045;
    const quad = (x0, z0, x1, z1) => { pos.push(x0, H(x0, z0), z0, x0, H(x0, z1), z1, x1, H(x1, z0), z0, x1, H(x1, z0), z0, x0, H(x0, z1), z1, x1, H(x1, z1), z1); };
    const hw = 0.4;
    for (let i = 0; i < N * N; i++) {
      const b = this.bits[i];
      if (!b) continue;
      const cx = tileCX(i), cz = tileCZ(i);
      quad(cx - hw, cz - hw, cx + hw, cz + hw);
      if (b & 1) quad(cx + hw, cz - hw, cx + TILE / 2, cz + hw);
      if (b & 4) quad(cx - TILE / 2, cz - hw, cx - hw, cz + hw);
      if (b & 2) quad(cx - hw, cz + hw, cx + hw, cz + TILE / 2);
      if (b & 8) quad(cx - hw, cz - TILE / 2, cx + hw, cz - hw);
    }
    if (!pos.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    this.roadMesh = new THREE.Mesh(geo, this.roadMat);
    this.roadMesh.receiveShadow = true;
    this.group.add(this.roadMesh);
  }
  rebuildStopMesh() {
    const W = this.game.world;
    let k = 0;
    for (const s of this.stops) {
      if (k >= 200) break;
      const x = tileCX(s.tile), z = tileCZ(s.tile);
      // the shelter stands at the side of the street
      const b = this.bits[s.tile] || 1;
      const alongX = (b & 5) !== 0;
      const ox = alongX ? 0 : 0.62, oz = alongX ? 0.62 : 0;
      this._p.set(x + ox, heightAt(W, x + ox, z + oz), z + oz);
      this._q.setFromAxisAngle(this._up, alongX ? 0 : Math.PI / 2);
      this._s.set(1.3, 1.3, 1.3);
      this._m.compose(this._p, this._q, this._s);
      this.stopMesh.setMatrixAt(k, this._m);
      this.stopMesh.setColorAt(k, this._c.set(s.kind === 'bus' ? 0xffffff : 0xe8d8b0));
      k++;
    }
    this.stopMesh.count = k;
    this.stopMesh.instanceMatrix.needsUpdate = true;
    if (this.stopMesh.instanceColor) this.stopMesh.instanceColor.needsUpdate = true;
  }
  // world position of a vehicle (keep right)
  vehPos(v, out) {
    const W = this.game.world;
    const a = v.tile, b = v.path && v.pi < v.path.length - 1 ? v.path[v.pi + 1] : a;
    const ax = tileCX(a), az = tileCZ(a), bx = tileCX(b), bz = tileCZ(b);
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len, nz = dx / len;
    const f = b === a ? 0 : v.f;
    const x = ax + dx * f + nx * 0.2, z = az + dz * f + nz * 0.2;
    out.x = x; out.z = z; out.y = heightAt(W, x, z) + 0.03; out.yaw = b === a ? (v.yaw || 0) : Math.atan2(-dz, dx);
    v.yaw = out.yaw;
    return out;
  }
  updateVisuals() {
    let nb = 0, nt = 0;
    const o = {};
    const livery = this.game.progression.companyColor ? this.game.progression.companyColor() : 0x2f6b4a;
    for (const v of this.vehicles) {
      const m = roadModel(v.model);
      if (!m) continue;
      this.vehPos(v, o);
      this._p.set(o.x, o.y, o.z); this._q.setFromAxisAngle(this._up, o.yaw); this._s.set(1.4, 1.4, 1.4);
      this._m.compose(this._p, this._q, this._s);
      if (m.kind === 'bus') { if (nb < MAXV) { this.busMesh.setMatrixAt(nb, this._m); this.busMesh.setColorAt(nb, this._c.set(m.color || livery)); nb++; } }
      else if (nt < MAXV) { this.truckMesh.setMatrixAt(nt, this._m); this.truckMesh.setColorAt(nt, this._c.set(m.color || 0xc9793a)); nt++; }
    }
    this.busMesh.count = nb; this.truckMesh.count = nt;
    for (const mesh of [this.busMesh, this.truckMesh]) { mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; }
  }
  // the road vehicle nearest a ground point (tap / click), within reach
  pickAt(p) {
    let best = null, bd = 0.9;
    const o = {};
    for (const v of this.vehicles) { this.vehPos(v, o); const d = Math.hypot(o.x - p.x, o.z - p.z); if (d < bd) { bd = d; best = v; } }
    return best;
  }
  // is any road vehicle on (or entering) this tile? (level crossing interlock)
  onTile(tile) { return this.vehicles.some((v) => (v.tile === tile && (v.f < 0.5 || !v.path)) || (v.path && v.path[v.pi + 1] === tile && v.f >= 0.4)); }

  // ---------- save ----------
  serialize() {
    const roads = [];
    for (let i = 0; i < N * N; i++) if (this.bits[i]) roads.push(i, this.bits[i]);
    return {
      roads, nextStop: this.nextStop, nextVeh: this.nextVeh,
      stops: this.stops.map((s) => ({ id: s.id, tile: s.tile, kind: s.kind, name: s.name, stock: s.stock, delivered: s.delivered, picked: s.picked, created: s.created, arrivals: s.stats.arrivals, transfers: s.stats.transfers, ratings: this.game.ratings ? this.game.ratings.serialize(s) : undefined, fin: s.fin || undefined })),
      vehicles: this.vehicles.map((v) => ({ id: v.id, model: v.model, name: v.name, stops: v.stops, idx: v.idx, tile: v.tile, cargo: v.cargo, earned: Math.round(v.earned), trips: v.trips, bought: Math.round(v.bought || 0), fin: v.fin || undefined, state: v.state === 'run' ? 'load' : v.state })),
    };
  }
  deserialize(d) {
    if (!d || typeof d !== 'object') return;
    const okTile = (t) => Number.isInteger(t) && t >= 0 && t < N * N;
    if (Array.isArray(d.roads)) for (let k = 0; k + 1 < d.roads.length; k += 2) if (okTile(d.roads[k])) this.bits[d.roads[k]] = d.roads[k + 1] & 15;
    this.stops = [];
    for (const s of Array.isArray(d.stops) ? d.stops : []) {
      if (!s || !okTile(s.tile) || !['bus', 'truck'].includes(s.kind)) continue;
      const stop = { id: s.id | 0, tile: s.tile, kind: s.kind, road: true, name: String(s.name || 'Stop').slice(0, 40), level: 0, stock: {}, claimed: {}, facilities: [], delivered: +s.delivered || 0, picked: +s.picked || 0, created: +s.created || 0,
        stats: { arrivals: s.arrivals | 0, wait: 0, _lastWait: 0, waitEma: 0, transfers: s.transfers | 0, recent: [], util: [] }, links: null, accepts: null, supplies: null, warn: false, fin: s.fin && typeof s.fin === 'object' ? s.fin : null };
      for (const c in s.stock || {}) if (CARGO[c] && s.stock[c] > 0) stop.stock[c] = Math.min(9999, +s.stock[c]);
      if (s.ratings && this.game.ratings) this.game.ratings.deserialize(stop, s.ratings);
      this.stops.push(stop);
    }
    this.vehicles = [];
    for (const v of Array.isArray(d.vehicles) ? d.vehicles : []) {
      if (!v || !roadModel(v.model) || !okTile(v.tile)) continue;
      const stops = (Array.isArray(v.stops) ? v.stops : []).filter((id) => this.stops.some((s) => s.id === id));
      this.vehicles.push({ id: v.id | 0, model: v.model, name: String(v.name || 'Bus').slice(0, 40), stops, idx: Math.max(0, v.idx | 0), tile: v.tile, prev: -1, next: -1, f: 0, path: null, state: v.state === 'idle' ? 'idle' : 'load', t: 1, cargo: (Array.isArray(v.cargo) ? v.cargo : []).filter((l) => l && CARGO[l.c] && l.n > 0).map((l) => ({ c: l.c, n: Math.floor(l.n), from: l.from | 0, t0: Number.isFinite(l.t0) ? l.t0 : undefined })), earned: +v.earned || 0, trips: v.trips | 0, bought: +v.bought || 0, fin: v.fin && typeof v.fin === 'object' ? v.fin : null, v: 0 });
    }
    this.nextStop = Math.max(d.nextStop | 0, 1, ...this.stops.map((s) => s.id + 1));
    this.nextVeh = Math.max(d.nextVeh | 0, 1, ...this.vehicles.map((v) => v.id + 1));
  }
  afterLoad() { this.relinkAll(); this.rebuildRoadMesh(); this.rebuildStopMesh(); }
}
