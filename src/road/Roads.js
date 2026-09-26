// Road transport: company roads (drag-built like track), bus and truck stops,
// buses and trucks. Stops behave like small stations towards the rest of the
// game: towns and industries in reach supply and accept at them (with cargo
// ratings), deliveries pay like trains, finance books them per vehicle. A
// stop within reach of a railway station hands passengers and freight over
// to the railway (feeder service, paid for the road leg). Vehicles drive on
// company roads and town streets, wait at level crossings and never enter
// one while it warns or is closed.
//
// The same stops-and-vehicles model also runs trams (on tram track laid along
// roads and streets), ships (between docks on connected water) and aircraft
// (straight between airports). STOP_MODE maps a stop kind to how its
// vehicles move: road, tram, water or air.
import * as THREE from 'three';
import { N, TILE, idx, tx, tz, inMap, tileCX, tileCZ, cheb, WATER_LEVEL } from '../util.js';
import { heightAt } from '../world/WorldGen.js';
import { CARGO, KMH_PER_TILE_S, ROAD_VEHICLES, ROAD_COSTS, STOP_MODE, STOP_TYPES, STOP_ORDER, STOP_FACILITIES } from '../config.js';
import { ModelBuilder, MATS } from '../core/ModelBuilder.js';
import { RoadLines } from './Lines.js';
import { BUS_SHAPES, stopModel, garageModel, personModel, doorModel, signModel } from './RoadModels.js';
import { cleanFin } from '../economy/Ledger.js';

const D4 = [[1, 0, 1], [0, 1, 2], [-1, 0, 4], [0, -1, 8]];   // dx, dz, bit  (E S W N)
const opp4 = (b) => (b === 1 ? 4 : b === 4 ? 1 : b === 2 ? 8 : 2);
const MAXV = 300;
const MIN_HOP = 3;           // a ride shorter than this (tiles) within one town pays nothing
const RAIL_SHARE = 0.4;      // travellers at a stop with a railway in reach who head for the train
export const STOP_KINDS = ['bus', 'truck', 'tram', 'dock', 'airport', 'garage'];
const AIR_SPEED = 0.6;       // aircraft cover this share of their nominal speed on the small map
const STOP_SUFFIX = { bus: 'Bus', truck: 'Truck', tram: 'Tram', dock: 'Docks', airport: 'Airport', garage: 'Garage' };
const YEAR = 720;             // game seconds per year
const DOOR = 0.4;             // seconds a door takes to open or close
const BOARD_RATE = 9;         // travellers per second through one door at an ordinary stop
const NEAR4 = [[1, 0], [0, 1], [-1, 0], [0, -1]];
export const modeOf = (kind) => STOP_MODE[kind] || 'road';
// the 3x3 airport around its centre tile
const around = (i) => { const out = []; for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const x = tx(i) + dx, z = tz(i) + dz; out.push(inMap(x, z) ? idx(x, z) : -1); } return out; };

export function roadModel(id) { return ROAD_VEHICLES.find((m) => m.id === id) || null; }
// what a road vehicle can carry: {cargo: capacity}
export function roadCaps(m) {
  const out = {};
  if (!m) return out;
  if (m.kind === 'bus' || m.pax) { out.PASSENGERS = m.cap; if (m.mail) out.MAIL = m.mail; return out; }
  for (const c in CARGO) if (m.groups.includes(CARGO[c].group)) out[c] = m.cap;
  return out;
}

export class Roads {
  constructor(game) {
    this.game = game;
    this.bits = new Uint8Array(N * N);   // company roads: links to E S W N
    this.tram = new Uint8Array(N * N);   // tram track on a road tile
    this._wpath = new Map();             // water routes between docks (water never changes)
    this.stops = [];
    this.vehicles = [];
    this.nextStop = 1; this.nextVeh = 1;
    this.version = 0;
    this._town = null;
    this.lines = new RoadLines(game);
    this.rules = [];         // road vehicle replacement: { from, to, age (years) }
    this._month = null;
    this.buildView();
  }
  modeOfKind(kind) { return modeOf(kind); }
  capOf(v) { const m = roadModel(v.model); return m ? m.cap : 0; }

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
  neighbours(i, tram = false) {
    const out = [];
    const x = tx(i), z = tz(i);
    for (const [dx, dz, b] of D4) { const X = x + dx, Z = z + dz; if (!inMap(X, Z)) continue; const j = idx(X, Z); if (this.linked(i, j, b) && (!tram || (this.tram[i] && this.tram[j]))) out.push(j); }
    return out;
  }
  // shortest road path (BFS over tiles; small maps); tram: only along tram track
  path(a, b, tram = false) {
    if (a === b) return [a];
    const prev = new Map([[a, -1]]);
    const q = [a];
    for (let h = 0; h < q.length; h++) {
      const i = q[h];
      for (const j of this.neighbours(i, tram)) {
        if (prev.has(j)) continue;
        prev.set(j, i);
        if (j === b) { const out = [b]; let k = i; while (k !== -1) { out.push(k); k = prev.get(k); } return out.reverse(); }
        q.push(j);
      }
    }
    return null;
  }

  // water route between two docks: over water tiles (4-grid), from the water
  // beside one dock to the water beside the other
  waterPath(a, b) {
    const key = a + ':' + b;
    if (this._wpath.has(key)) return this._wpath.get(key);
    const W = this.game.world;
    const wet = (i) => W.type[i] === 1;
    const prev = new Map([[a, -1]]);
    const q = [a];
    let out = null;
    for (let h = 0; h < q.length && !out; h++) {
      const i = q[h];
      for (const [dx, dz] of D4) {
        const X = tx(i) + dx, Z = tz(i) + dz;
        if (!inMap(X, Z)) continue;
        const j = idx(X, Z);
        if (prev.has(j)) continue;
        if (j === b && i !== a) { out = [b]; let k = i; while (k !== -1) { out.push(k); k = prev.get(k); } out.reverse(); break; }
        if (!wet(j)) continue;
        prev.set(j, i);
        q.push(j);
      }
    }
    this._wpath.set(key, out);
    return out;
  }
  // the route a vehicle takes from tile a to stop tile b by its mode
  route(mode, a, b) {
    if (mode === 'water') return this.waterPath(a, b);
    if (mode === 'tram') return this.path(a, b, true);
    if (mode === 'air') return [a, b];
    return this.path(a, b);
  }

  // ---------- tram track ----------
  // lay tram track along the road route from a to b (existing roads and streets)
  planTram(a, b) {
    const res = { ok: false, tiles: [], cost: 0, reason: null };
    if (!this.hasRoad(a) || !this.hasRoad(b)) { res.reason = 'err_tram_needs_road'; return res; }
    const p = this.path(a, b);
    if (!p) { res.reason = 'err_road_no_path'; return res; }
    const g = this.game;
    if (p.some((i) => !g.progression.regionUnlocked(g.world.region[i]))) { res.reason = 'err_locked_region'; return res; }
    res.tiles = p;
    res.cost = Math.round(p.filter((i) => !this.tram[i]).length * ROAD_COSTS.tram * g.economy.costs.mul());
    res.ok = true;
    return res;
  }
  buildTram(plan) {
    const g = this.game;
    if (!plan || !plan.ok) return { error: plan ? plan.reason : 'err_unknown' };
    if (!g.economy.canAfford(plan.cost)) return { error: 'err_no_money' };
    const prev = plan.tiles.filter((t) => !this.tram[t]);
    for (const t of plan.tiles) this.tram[t] = 1;
    if (plan.cost > 0) g.economy.spend(plan.cost, 'construction', { type: 'tile', id: plan.tiles[Math.floor(plan.tiles.length / 2)] }, `~fin_n_tram:${prev.length}`);
    this.changed();
    g.construction.pushUndo({ type: 'tram', tiles: prev, cost: plan.cost });
    g.audio.play('road');
    return { ok: true };
  }
  undoTram(e) { for (const t of e.tiles) this.tram[t] = 0; this.changed(); }

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
  // owner: a rival company (src/world/Rivals.js) that pays for it itself
  build(plan, owner = null) {
    const g = this.game;
    if (!plan || !plan.ok) return { error: plan ? plan.reason : 'err_unknown' };
    if (owner ? owner.money < plan.cost : !g.economy.canAfford(plan.cost)) return { error: 'err_no_money' };
    const prev = plan.tiles.map((t) => [t, this.bits[t]]);
    for (let k = 1; k < plan.tiles.length; k++) {
      const i = plan.tiles[k - 1], j = plan.tiles[k], b = this.bitBetween(i, j);
      this.bits[i] |= b; this.bits[j] |= opp4(b);
    }
    if (owner) owner.money -= plan.cost;
    else if (plan.cost > 0) g.economy.spend(plan.cost, 'construction', { type: 'tile', id: plan.tiles[Math.floor(plan.tiles.length / 2)] }, `~fin_n_road:${plan.tiles.length}`);
    const wooded = plan.tiles.filter((t) => g.world.view.hasTrees(t));
    g.world.view.clearTreesMany(plan.tiles);
    if (wooded.length && g.authority && !owner) g.authority.onTreesCleared(wooded[0], wooded.length);
    this.changed();
    if (!owner) { g.construction.pushUndo({ type: 'road', prev, cost: plan.cost }); g.audio.play('road'); }
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
    if (!this.townRoads().has(i)) this.tram[i] = 0;
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
  stopAt(i) { return this.stops.find((s) => s.tile === i || (s.kind === 'airport' && cheb(s.tile, i) <= 1)) || null; }
  // walking distance around a stop (catchment for the town's travellers)
  stopRadius(s) { return s.kind === 'airport' ? 4 : s.kind === 'dock' ? 3 : (this.stopProps ? this.stopProps(s).radius : 2); }
  stopTiles(s) { return s.kind === 'airport' ? around(s.tile).filter((t) => t >= 0) : [s.tile]; }
  stopById(id) { return this.stops.find((s) => s.id === id) || null; }
  // ---------- stop types, expansions, garages ----------
  stopProps(s) {
    const T = (s.kind === 'bus' && STOP_TYPES[s.type]) || STOP_TYPES.basic;
    const f = (id) => (s.facilities || []).filter((x) => x === id).length;
    return { ...T, bays: T.bays + f('bay'), board: T.board * (1 + 0.15 * f('entrance')), transfer: T.transfer + 0.25 * f('transfer'), pullIn: !!T.pullIn || f('turning') > 0, storageMul: 1 + 0.5 * f('capacity') };
  }
  nextType(s) { if (s.kind !== 'bus') return null; const i = STOP_ORDER.indexOf(s.type || 'basic'); return STOP_ORDER[i + 1] || null; }
  upgradeCost(type) { return Math.round(ROAD_COSTS.stop * STOP_TYPES[type].cost * this.game.economy.costs.mul()); }
  // land beside the stop for a station building (off the road, in order):
  // free land first; otherwise town buildings the town lets the company buy
  findLand(s, n, buy = true) {
    if (!n) return [];
    const A = this.game.authority;
    const okFree = (t) => t >= 0 && !this.hasRoad(t) && !this.landFree(t);
    const okBuy = (t) => { if (!buy || !A || t < 0 || this.hasRoad(t)) return false; const d = A.demolishInfo(t); return !!(d && d.allowed && !this.game.net.conn[t] && !this.stopAt(t)); };
    const x = tx(s.tile), z = tz(s.tile);
    for (const pass of buy ? [0, 1] : [0]) {
      const ok = (t) => okFree(t) || (pass === 1 && okBuy(t));
      for (const [dx, dz] of NEAR4) {
        const X = x + dx, Z = z + dz;
        if (!inMap(X, Z)) continue;
        const have = (s.land || []).filter((t) => cheb(t, idx(X, Z)) <= 1);
        const a = idx(X, Z);
        const out = have.includes(a) ? have.slice() : ok(a) ? [a] : null;
        if (!out) continue;
        if (out.length < n && inMap(X + dx, Z + dz)) { const b2 = idx(X + dx, Z + dz); if (out.includes(b2) || ok(b2)) { if (!out.includes(b2)) out.push(b2); } }
        if (out.length >= n) return out.slice(0, n);
      }
    }
    return null;
  }
  // what the land costs: compensation for the buildings on it
  landCost(tiles) {
    const A = this.game.authority;
    let c = 0;
    for (const t of tiles || []) { const d = A && !this.landFree(t) ? null : A ? A.demolishInfo(t) : null; if (d) c += d.cost; }
    return c;
  }
  upgradeError(s, type) {
    const g = this.game, T = STOP_TYPES[type];
    if (!T || s.kind !== 'bus' || s.owner) return 'err_unknown';
    if (g.progression.level < T.level) return 'err_locked';
    const land = T.land ? this.findLand(s, T.land) : [];
    if (!land) return 'err_stop_no_room';
    if (!g.economy.canAfford(this.upgradeCost(type) + this.landCost(land))) return 'err_no_money';
    return null;
  }
  upgradeStop(s, type = this.nextType(s)) {
    const g = this.game;
    const err = type ? this.upgradeError(s, type) : 'err_unknown';
    if (err) return { error: err };
    const T = STOP_TYPES[type], cost = this.upgradeCost(type);
    const land = this.findLand(s, T.land);
    if (land && land.length) {
      // buildings on the new land are bought from the town first
      for (const t of land) if (!(s.land || []).includes(t) && g.authority && g.authority.demolishInfo(t)) { const r = g.authority.demolish(t, true); if (r.error) return r; }
      this.claimLand(s, false); s.land = land; this.claimLand(s, true);
    }
    s.type = type;
    s.level = STOP_ORDER.indexOf(type);
    g.economy.spend(cost, 'construction', { type: 'roadstop', id: s.id }, `~stype_${type}`);
    this.relink(s);
    g.towns.onStationsChanged();
    this.rebuildStopMesh();
    g.audio.play('construct');
    g.events.emit('stopUpgraded', s);
    return { ok: true, cost };
  }
  facilityError(s, id) {
    const F = STOP_FACILITIES[id];
    if (!F || s.kind !== 'bus') return 'err_unknown';
    if (STOP_ORDER.indexOf(s.type || 'basic') < STOP_ORDER.indexOf(F.from)) return 'err_stop_type_needed';
    if ((s.facilities || []).filter((x) => x === id).length >= F.max) return 'err_facility_max';
    if (!this.game.economy.canAfford(this.facilityCost(id))) return 'err_no_money';
    return null;
  }
  facilityCost(id) { return Math.round(ROAD_COSTS.stop * STOP_FACILITIES[id].cost * this.game.economy.costs.mul()); }
  addFacility(s, id) {
    const err = this.facilityError(s, id);
    if (err) return { error: err };
    const cost = this.facilityCost(id);
    s.facilities = (s.facilities || []).concat([id]);
    this.game.economy.spend(cost, 'construction', { type: 'roadstop', id: s.id }, `~sfac_${id}`);
    if (id === 'transfer') this.relink(s);
    this.rebuildStopMesh();
    this.game.audio.play('construct');
    return { ok: true, cost };
  }
  garages() { return this.stops.filter((x) => x.kind === 'garage' && !x.owner); }
  // the nearest garage a line's vehicles can reach by road
  garageFor(line) {
    const first = line && this.stopById(line.stops[0]);
    if (!first || modeOf(line.kind) !== 'road') return null;
    let best = null, bd = Infinity;
    for (const gr of this.garages()) { const d = cheb(gr.tile, first.tile); if (d < bd && d <= 24 && this.path(gr.tile, first.tile)) { bd = d; best = gr; } }
    return best;
  }
  garageNear(v) {
    let best = null, bd = Infinity;
    for (const gr of this.garages()) { const d = cheb(gr.tile, v.tile); if (d < bd && d <= 30 && this.path(v.tile, gr.tile)) { bd = d; best = gr; } }
    return best;
  }
  byId(id) { return this.vehicles.find((v) => v.id === id) || null; }
  // can a stop of this kind go here? (airport: i is the centre of 3x3)
  landFree(i) {
    const g = this.game, W = g.world, net = g.net;
    if (i < 0 || W.type[i] !== 0) return 'err_bad_terrain';
    if (!g.progression.regionUnlocked(W.region[i])) return 'err_locked_region';
    if (g.occupancy.blocked[i]) return 'err_occupied';
    if (net.conn[i] || net.special.has(i) || net.waypoints.has(i)) return 'err_occupied';
    if (g.decor && g.decor.at(i)) return 'err_occupied';
    if (this.stopAt(i)) return 'err_occupied';
    return null;
  }
  stopError(i, kind) {
    const g = this.game, W = g.world;
    if (i < 0) return 'err_out_of_map';
    const mode = modeOf(kind);
    if (!this.kindUnlocked(kind)) return 'err_locked';
    if (mode === 'road' || mode === 'tram') {
      if (!this.hasRoad(i)) return 'err_stop_needs_road';
      if (mode === 'tram' && !this.tram[i]) return 'err_stop_needs_tram';
      if (g.net.conn[i]) return 'err_stop_on_rail';
      if (this.stopAt(i)) return 'err_occupied';
      if (kind === 'garage' && !this.findLand({ tile: i, land: [] }, 1, false)) return 'err_stop_no_room';
    } else if (mode === 'water') {
      const e = this.landFree(i);
      if (e) return e;
      if (this.hasRoad(i)) return 'err_occupied';
      if (!D4.some(([dx, dz]) => { const X = tx(i) + dx, Z = tz(i) + dz; return inMap(X, Z) && W.type[idx(X, Z)] === 1; })) return 'err_dock_water';
    } else {
      const tiles = around(i);
      if (tiles.some((t) => t < 0)) return 'err_out_of_map';
      for (const t of tiles) { const e = this.landFree(t); if (e) return e; if (this.hasRoad(t)) return 'err_occupied'; }
      const hs = tiles.map((t) => W.tileH[t]);
      if (Math.max(...hs) - Math.min(...hs) > 1.2) return 'err_too_steep';
      if (this.stops.some((s) => s.kind === 'airport' && cheb(s.tile, i) < 8)) return 'err_airport_near';
      const t = this.nearTown(i);
      if (t && g.authority && !g.authority.allowed(t, 'airport_near_town')) return 'err_permit_denied';
    }
    if (!g.economy.canAfford(this.stopCost(kind))) return 'err_no_money';
    return null;
  }
  // a town whose edge is within 3 tiles (airport noise)
  nearTown(i) {
    for (const t of this.game.towns.list) if (cheb(idx(t.x, t.z), i) <= this.game.towns.radius(t) + 3) return t;
    return null;
  }
  kindUnlocked(kind) { if (kind === 'garage') return this.kindUnlocked('bus') || this.kindUnlocked('truck'); const L = this.game.progression.level; return ROAD_VEHICLES.some((m) => m.kind === kind && m.level <= L); }
  stopCost(kind = 'bus') { const c = kind === 'dock' ? ROAD_COSTS.dock : kind === 'airport' ? ROAD_COSTS.airport : kind === 'garage' ? ROAD_COSTS.garage : ROAD_COSTS.stop; return Math.round(c * this.game.economy.costs.mul()); }
  addStop(i, kind = 'bus', owner = null) {
    const g = this.game;
    const err = owner ? (this.hasRoad(i) && !this.stopAt(i) && !g.net.conn[i] && owner.money >= this.stopCost(kind) ? null : 'err_occupied') : this.stopError(i, kind);
    if (err) return { error: err };
    const s = {
      id: this.nextStop++, tile: i, kind, road: true, name: '', level: 0, type: 'basic', land: [], stock: {}, claimed: {}, facilities: [], delivered: 0, picked: 0, created: g.time,
      stats: { arrivals: 0, wait: 0, _lastWait: 0, waitEma: 0, transfers: 0, recent: [], util: [] }, links: null, accepts: null, supplies: null, warn: false,
    };
    if (owner) s.owner = owner.id;
    if (kind === 'garage') s.land = this.findLand(s, 1, false) || [];
    this.relink(s);
    s.name = this.stopName(s);
    this.stops.push(s);
    this.claimLand(s, true);
    if (owner) { owner.money -= this.stopCost(kind); g.towns.onStationsChanged(); g.industries.onStationsChanged(); this.rebuildStopMesh(); return { ok: true, stop: s }; }
    g.economy.spend(this.stopCost(kind), 'construction', { type: 'roadstop', id: s.id }, `~fin_n_stop_${kind}:1`);
    if (kind === 'airport') { const t = this.nearTown(i); if (t && g.authority) g.authority.change(t, -3, 'auth_airport'); }
    g.towns.onStationsChanged(); g.industries.onStationsChanged();
    this.rebuildStopMesh();
    g.construction.pushUndo({ type: 'roadstop', id: s.id, cost: this.stopCost(kind) });
    g.audio.play('station');
    return { ok: true, stop: s };
  }
  removeStop(s, refund = 0.5) {
    const g = this.game;
    if (s.owner) return { error: 'err_rival_stop' };
    if (this.vehicles.some((v) => v.stops.includes(s.id))) return { error: 'err_stop_in_use' };
    this.stops = this.stops.filter((x) => x !== s);
    this.lines.onStopRemoved(s.id);
    this.claimLand(s, false);
    if (refund) g.economy.earn(Math.round(this.stopCost(s.kind) * refund), 'refund', false, null, s.name);
    g.towns.onStationsChanged(); g.industries.onStationsChanged();
    this.rebuildStopMesh();
    return { ok: true };
  }
  // docks and airports stand on their own land (towns do not build there)
  claimLand(s, on) {
    const tiles = s.kind === 'dock' || s.kind === 'airport' ? this.stopTiles(s) : (s.land || []);
    if (!tiles.length) return;
    const occ = this.game.occupancy;
    for (const t of tiles) { occ.blocked[t] = on ? 3 : 0; occ.owner[t] = on ? -s.id : 0; }
    if (on && this.game.world.view) this.game.world.view.clearTreesMany(tiles);
  }
  stopName(s) {
    const L = s.links;
    const t = L && L.towns.length ? this.game.towns.byId(L.towns[0]) : null;
    const base = t ? t.name : L && L.industries.length ? this.game.industries.displayName(this.game.industries.byId(L.industries[0])) : 'Halt';
    const suf = STOP_SUFFIX[s.kind] || 'Stop';
    let n = 1, name = `${base} ${suf}`;
    while (this.stops.some((x) => x.name === name)) name = `${base} ${suf} ${++n}`;
    return name;
  }
  relink(s) {
    const S = this.game.stations;
    // airports draw from further away; docks serve both towns and industries
    const { towns, inds } = S.previewLinks(this.stopTiles(s), s.kind === 'airport' ? 3 : s.kind === 'dock' ? 1 : 0);
    const people = s.kind === 'bus' || s.kind === 'tram' || s.kind === 'airport' || s.kind === 'dock';
    if (s.kind === 'garage') { s.links = { towns: [], industries: [] }; s.accepts = new Set(); s.supplies = new Set(); s.rail = null; return; }
    const goods = s.kind === 'truck' || s.kind === 'dock';
    s.links = { towns: people ? towns.map((t) => t.id) : [], industries: goods ? inds.map((i) => i.id) : [] };
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
    let best = null, bd = this.stopProps(s).railReach || 4;
    for (const st of S.list) { const d = Math.min(...S.allTiles(st).flatMap((t) => this.stopTiles(s).map((u) => cheb(t, u)))); if (d < bd) { bd = d; best = st; } }
    s.rail = best ? best.id : null;
  }
  relinkAll() { for (const s of this.stops) this.relink(s); }
  // Travellers leaving a train at a railway station: a share of them (better
  // with frequent service and a short walk) changes to the company's bus and
  // tram lines that start in reach of the station. They are the same people
  // continuing their journey: each leg pays for its own distance.
  onward(stn, n) {
    if (n < 2) return;
    const cands = this.stops.filter((s) => s.rail === stn.id && !s.owner && (s.kind === 'bus' || s.kind === 'tram') && this.lines.linesAt(s.id).some((l) => this.lines.vehicles(l).length));
    if (!cands.length) return;
    let q = 0;
    for (const s of cands) {
      const walk = Math.min(...this.game.stations.allTiles(stn).map((t) => cheb(t, s.tile)));
      const freq = Math.min(1, this.lines.linesAt(s.id).reduce((a, l) => a + this.lines.vehicles(l).length, 0) / 4);
      s._onQ = (0.5 + 0.5 * freq) * (walk <= 1 ? 1 : walk <= 3 ? 0.8 : 0.55) * (this.stopProps ? this.stopProps(s).transfer : 1);
      q = Math.max(q, s._onQ);
    }
    stn._onAcc = (stn._onAcc || 0) + n * 0.3 * q;
    let k = Math.floor(stn._onAcc);
    if (k <= 0) return;
    stn._onAcc -= k;
    const sum = cands.reduce((a, s) => a + s._onQ, 0);
    for (const s of cands) {
      const share = Math.round((k * s._onQ) / sum);
      if (share <= 0) continue;
      const took = this.game.stations.receive(s, 'PASSENGERS', share);
      s.stats.fromRail = (s.stats.fromRail || 0) + took;
      k -= took;
      if (k <= 0) break;
    }
  }

  // ---------- vehicles ----------
  buy(modelId, stop, owner = null, line = null) {
    const g = this.game, m = roadModel(modelId);
    if (!m || !stop) return { error: 'err_unknown' };
    if (line && line.kind !== m.kind) return { error: 'err_wrong_stop' };
    if (m.kind !== stop.kind && !(stop.kind === 'garage' && modeOf(m.kind) === 'road')) return { error: 'err_wrong_stop' };
    const price = Math.round(m.price * g.difficulty.costMul);
    if (owner ? owner.money < price : !g.economy.canAfford(price)) return { error: 'err_no_money' };
    if (stop.owner && !owner) return { error: 'err_rival_stop' };
    let n = 1; while (this.vehicles.some((v) => v.name === `${m.name.split(' ')[0]} ${n}`)) n++;
    const v = { id: this.nextVeh++, model: m.id, name: `${m.name.split(' ')[0]} ${n}`, stops: [stop.id], idx: 0, tile: stop.tile, prev: -1, next: -1, f: 0, path: null, state: 'load', t: 2, cargo: [], earned: 0, trips: 0, bought: g.time, fin: null, v: 0 };
    this.vehicles.push(v);
    if (owner) { v.owner = owner.id; v.name = `${owner.short} ${n}`; owner.money -= price; return { ok: true, vehicle: v }; }
    g.economy.spend(price, 'road_vehicles', { type: 'road', id: v.id }, v.name);
    this.ensureVehMesh();
    if (line) this.lines.assign(v, line);
    return { ok: true, vehicle: v };
  }
  sell(v) {
    const g = this.game, m = roadModel(v.model);
    this.vehicles = this.vehicles.filter((x) => x !== v);
    if (v.line != null) this.lines.changed();
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
    const mi = g.ledger ? g.ledger.monthIndex() : 0;
    if (this._month == null) this._month = mi;
    else if (mi !== this._month) { this._month = mi; this.monthly(); this.lines.closeMonth(); }
    // who is where this step (blocking, queues at stops)
    const at = new Map();
    for (const v of this.vehicles) { if (v.state === 'run' || v.state === 'load' || v.state === 'broken') { let l = at.get(v.tile); if (!l) at.set(v.tile, l = []); l.push(v); } }
    const envSpeed = g.env ? g.env.effects.speed : 1, envAccel = g.env && g.env.effects.accel ? g.env.effects.accel : 1;
    for (const v of this.vehicles) {
      const m = roadModel(v.model);
      if (!m) continue;
      // running costs, booked per vehicle (a stored vehicle costs nothing)
      const op = v.state === 'stored' ? 0 : (m.op / 60) * dt * (v.state === 'idle' ? 0.3 : 1);
      if (op > 0) { if (v.owner) { const r = this.rival(v); if (r) r.pay(op); } else { g.economy.operatingCost(op, this.ref(v)); if (v.line != null) this.lines.note(v, 'cost', op); } }
      if (v.state === 'stored') continue;
      if (v.state === 'load') {
        v.t -= dt;
        if (v.boardLeft > 0 && v.dwell > 0) v.boardLeft = Math.max(0, v.boardLeft - (dt / v.dwell) * (v.boardN || 1) * 1.3);
        if (v.t > 0) continue;
        this.leave(v);
        continue;
      }
      if (v.state === 'idle') { v.t -= dt; if (v.t <= 0) this.leave(v); continue; }
      if (v.state === 'broken') { v.t -= dt; v.v = 0; if (v.t <= 0) { v.state = 'run'; v.problem = null; } continue; }
      const mode = modeOf(m.kind);
      // aircraft: straight flight, arrive at the end
      if (mode === 'air') {
        if (!v.fly) { this.arrive(v); continue; }
        v.v = Math.min((m.speed / KMH_PER_TILE_S) * AIR_SPEED * envSpeed, v.v + dt * 2);
        v.fly.s += v.v * dt;
        if (v.fly.s >= v.fly.d) { v.tile = v.fly.to; v.fly = null; this.arrive(v); }
        continue;
      }
      // run along the path, one tile edge at a time
      if (!v.path || v.pi >= v.path.length - 1) { this.arrive(v); continue; }
      const next = v.path[v.pi + 1];
      const X = g.crossings, onLand = mode !== 'water';
      const last = v.pi + 1 === v.path.length - 1;
      let blocked = onLand && X && X.isBlocked(next) && v.f < 0.4;
      if (onLand && !blocked) {
        const here = at.get(next);
        if (here) for (const o of here) {
          if (o === v || modeOf((roadModel(o.model) || {}).kind) !== mode) continue;
          // someone ahead in the same lane, not yet clear of the tile
          if ((o.state === 'run' || o.state === 'broken') && o.path && o.path[o.pi + 1] !== v.tile && o.f < 0.3) { blocked = true; break; }
          // a bus standing at a kerbside stop holds the traffic behind it
          if (o.state === 'load' && o.prev === v.tile && !last) { const st = this.stopAt(next); if (st && !this.stopProps(st).pullIn) { blocked = true; break; } }
        }
        // the stop ahead has every bay taken: queue before it
        if (!blocked && last) {
          const st = this.targetStop(v);
          if (st && st.tile === next && here) { const busy = here.filter((o) => o !== v && o.state === 'load').length; if (busy >= this.stopProps(st).bays) blocked = true; }
        }
      }
      // time lost standing in traffic (delay per trip, congestion)
      if (blocked) v.jam = (v.jam || 0) + dt;
      const vmax = (m.speed / KMH_PER_TILE_S) * envSpeed * this.turnMul(v, m);
      // brake for the stop at the end of the path, accelerate by the model
      const remain = v.path.length - 1 - v.pi - v.f;
      const vstop = mode === 'water' ? vmax : Math.sqrt(2 * 1.6 * (m.brake || 1) * Math.max(0, remain - 0.05)) + 0.05;
      v.v = blocked ? 0 : Math.min(vmax, vstop, v.v + dt * 1.2 * (m.accel || 1) * envAccel);
      if (blocked && v.f > 0.35) v.f = Math.max(v.f, 0.35);
      v.f += v.v * dt;
      if (blocked && v.f > 0.38) v.f = 0.38;
      while (v.f >= 1 && v.pi < v.path.length - 1) { v.f -= 1; v.pi++; v.prev = v.tile; v.tile = v.path[v.pi]; }
    }
  }
  // long vehicles slow down in bends
  turnMul(v, m) {
    if (!m.turn || !v.path) return 1;
    const a = v.path[v.pi], b = v.path[v.pi + 1], c = v.path[v.pi + 2];
    if (c == null) return 1;
    return (tx(b) - tx(a)) * (tz(c) - tz(b)) - (tz(b) - tz(a)) * (tx(c) - tx(b)) !== 0 ? m.turn : 1;
  }
  rival(o) { return o.owner && this.game.rivals ? this.game.rivals.byId(o.owner) : null; }
  targetStop(v) { if (v.goGarage) { const gr = this.stopById(v.goGarage); if (gr) return gr; } return this.stopById(v.stops[v.idx % v.stops.length]); }
  // ---------- age, reliability, service, garages ----------
  ageYears(v) { return Math.max(0, (this.game.time - (v.bought || 0)) / YEAR); }
  baseRel(v) { const m = roadModel(v.model) || {}; return (m.rel || 0.9) * (1 - Math.min(0.3, (this.ageYears(v) / (m.life || 16)) * 0.3)); }
  relOf(v) { return v.rel == null ? this.baseRel(v) : v.rel; }
  needsService(v) {
    const g = this.game;
    if (v.owner || !g.maint || g.maint.mode === 'off') return false;
    return this.relOf(v) < 0.72 && g.time - (v.served || v.bought || 0) > YEAR / 2;
  }
  serviceVehicle(v) {
    const g = this.game, m = roadModel(v.model);
    v.rel = this.baseRel(v); v.served = g.time;
    const fee = Math.round((m ? m.price : 500) * 0.03 * g.economy.costs.mul());
    if (!v.owner && fee > 0) g.economy.spend(fee, 'maint_vehicles', this.ref(v), v.name);
  }
  sendToGarage(v, gr = this.garageNear(v)) {
    if (!gr) return { error: 'err_no_garage' };
    v.goGarage = gr.id; v.service = false;
    if (v.state === 'stored') return { ok: true };
    if (v.state === 'load' || v.state === 'idle') v.t = Math.min(v.t, 0.2);
    else { const p = this.route('road', v.path && v.path[v.pi + 1] != null ? v.path[v.pi + 1] : v.tile, gr.tile); if (p) { v.path = [v.tile, ...p]; v.pi = 0; } }
    return { ok: true };
  }
  releaseFromGarage(v) {
    if (v.state !== 'stored') return;
    v.goGarage = null; v.state = 'load'; v.t = 0.5; v.dwell = 0.5; v.problem = null;
  }
  // a month: vehicles wear, break down (tycoon wear), are replaced by rule
  monthly() {
    const g = this.game, mode = g.maint ? g.maint.mode : 'off';
    for (const v of this.vehicles) {
      if (v.owner || v.state === 'stored') continue;
      const age = this.ageYears(v);
      v.rel = Math.max(0.3, this.relOf(v) - (mode === 'off' ? 0 : 0.012 + age * 0.0015));
      if (mode === 'tycoon' && v.state === 'run') {
        const h = ((v.id * 2654435761) ^ (this._month * 40503)) >>> 0;
        if ((h % 1000) / 1000 < (1 - v.rel) * 0.5) { v.state = 'broken'; v.t = 8; v.problem = 'broken'; v.breakdowns = (v.breakdowns || 0) + 1; g.events.emit('rvBreakdown', v); }
      }
    }
  }
  // fleet replacement: an old vehicle of a model with a rule is renewed at its next stop
  checkRule(v) {
    if (v.owner || !this.rules.length) return;
    const r = this.rules.find((x) => x.from === v.model);
    if (r && this.ageYears(v) >= r.age) this.replaceVehicle(v, r.to);
  }
  replaceVehicle(v, toId) {
    const g = this.game, m = roadModel(v.model), m2 = roadModel(toId);
    if (!m || !m2 || m2.kind !== m.kind || m2.level > g.progression.level) return { error: 'err_unknown' };
    const price = Math.round(m2.price * g.difficulty.costMul), refund = Math.round(m.price * g.difficulty.costMul * 0.5);
    if (!g.economy.canAfford(price - refund)) return { error: 'err_no_money' };
    g.economy.earn(refund, 'sale', false, this.ref(v), v.name);
    g.economy.spend(price, 'road_vehicles', this.ref(v), v.name);
    v.model = toId; v.bought = g.time; v.rel = m2.rel || 0.9; v.served = g.time; v.replaced = (v.replaced || 0) + 1;
    const caps = roadCaps(m2);
    v.cargo = v.cargo.filter((l) => caps[l.c]);
    if (v.line != null) this.lines.changed();
    g.events.emit('rvReplaced', v, m, m2);
    return { ok: true };
  }
  addRule(from, to, age) { this.rules = this.rules.filter((r) => r.from !== from); this.rules.push({ from, to, age: Math.max(1, age | 0) }); }
  removeRule(from) { this.rules = this.rules.filter((r) => r.from !== from); }
  leave(v) {
    const g = this.game, m = roadModel(v.model), mode = modeOf(m.kind);
    // due for a service: the nearest garage first, then back to the route
    if (!v.goGarage && mode === 'road' && this.needsService(v)) { const gr = this.garageNear(v); if (gr) { v.goGarage = gr.id; v.service = true; } }
    if (v.goGarage) {
      const gr = this.stopById(v.goGarage);
      const p = gr ? this.route('road', v.tile, gr.tile) : null;
      if (p) { v.path = p; v.pi = 0; v.f = 0; v.state = 'run'; v.problem = null; return; }
      v.goGarage = null; v.service = false;
    }
    if (v.stops.length < 2) { v.state = 'idle'; v.t = 3; v.problem = 'no_route'; return; }
    v.idx = (v.idx + 1) % v.stops.length;
    const s = this.targetStop(v);
    const p = s ? this.route(mode, v.tile, s.tile) : null;
    if (!p) { v.state = 'idle'; v.t = 4; v.problem = mode === 'water' ? 'no_water' : mode === 'tram' ? 'no_tram' : 'no_road'; return; }
    v.problem = null;
    if (mode === 'air') { v.fly = { from: v.tile, to: s.tile, s: 0, d: Math.max(1, Math.hypot(tx(s.tile) - tx(v.tile), tz(s.tile) - tz(v.tile))) }; v.path = null; v.state = 'run'; v.v = 0; g.events.emit('rvDepart', v, mode); return; }
    v.path = p; v.pi = 0; v.f = 0; v.state = 'run';
    g.events.emit('rvDepart', v, mode);
  }
  arrive(v) {
    const g = this.game, s = this.targetStop(v), m = roadModel(v.model);
    v.state = 'load'; v.t = 3; v.dwell = 3; v.v = 0; v.path = null; v.boardLeft = 0;
    if (!s || s.tile !== v.tile) { v.t = v.dwell = 1; return; }
    // at a garage: serviced; stored unless it only came for the service
    if (s.kind === 'garage' && v.goGarage === s.id) {
      this.serviceVehicle(v);
      v.goGarage = null;
      if (v.service) { v.service = false; v.t = v.dwell = 2; return; }
      v.state = 'stored'; v.t = 0; g.events.emit('rvStored', v, s);
      return;
    }
    this.checkRule(v);
    // seconds lost in traffic on the way here, smoothed over the last trips
    const lost = v.jam || 0; v.jam = 0;
    v.dly = v.dly == null ? lost : v.dly * 0.7 + lost * 0.3;
    const md = modeOf(m.kind);
    if (md !== 'road') g.events.emit('rvArrive', v, md);
    s.stats.arrivals++;
    v.trips++;
    if (v.line != null) this.lines.note(v, 'trip', 1);
    const n0 = this.load(v);
    this.unload(v, s);
    const n1 = this.load(v);
    this.loadAt(v, s);
    const n2 = this.load(v);
    // doors open, people get off and on (through every door of the model, faster at a better stop), doors close
    const moved = (n0 - n1) + (n2 - n1);
    const rate = BOARD_RATE * (m.doors || 1) * (m.board || 1) * this.stopProps(s).board;
    v.dwell = v.t = Math.max(md === 'air' ? 4 : 1.6, DOOR * 2 + 0.4 + moved / rate);
    v.boardLeft = v.boardN = n2 - n1;
    v.boardAt = s.id;
    const taken = new Set(this.vehicles.filter((o) => o !== v && o.state === 'load' && o.tile === v.tile).map((o) => o.bay || 0));
    v.bay = 0; while (taken.has(v.bay)) v.bay++;
  }
  // Travellers and goods leave at their destination stop (chosen when they
  // boarded); travellers heading for the train change to the railway station
  // in reach. Lots from older saves (no destination) leave at the first stop
  // that takes them. A ride within one town shorter than MIN_HOP tiles is no
  // journey at all.
  unload(v, s) {
    const g = this.game, E = g.economy, S = g.stations;
    const keep = [];
    const m = roadModel(v.model);
    for (const lot of v.cargo) {
      if (lot.from === s.id) { keep.push(lot); continue; }
      if (lot.to != null && lot.to !== s.id && v.stops.includes(lot.to)) { keep.push(lot); continue; }
      const from = this.stopById(lot.from) || S.byId(lot.from);
      const dist = from ? cheb(from.tile, s.tile) : 6;
      const transit = lot.t0 != null ? Math.max(0, g.time - lot.t0) : 0;
      const people = lot.c === 'PASSENGERS' || lot.c === 'MAIL';
      const sameTown = from && from.links && s.links && from.links.towns.some((id) => s.links.towns.includes(id));
      const local = people && sameTown && dist < MIN_HOP;
      const rail = s.rail != null && !v.owner ? S.byId(s.rail) : null;
      const toRail = !!(lot.rail && rail);
      if (!toRail && s.accepts && s.accepts.has(lot.c) && !local) {
        const town = s.links.towns.length ? g.towns.byId(s.links.towns[0]) : null;
        const needed = town ? g.towns.needs(town, lot.c) : false;
        const rev = Math.round(E.revenue(lot.c, lot.n, dist, null, needed, transit) * 0.9 * this.fareMul(m, from, s));
        if (v.owner) { const r = this.rival(v); if (r) r.earn(rev); v.earned += rev; S.distribute(s, lot.c, lot.n); continue; }
        E.bookDelivery(rev, lot.c, lot.n, null, from, s, this.ref(v));
        S.distribute(s, lot.c, lot.n);
        v.earned += rev; E.bucket.income += rev; E.bucket.deliveries++;
        g.stats.inc('deliveries'); g.stats.incCargo(lot.c, lot.n); if (lot.c === 'PASSENGERS') g.stats.inc('passengers', lot.n);
        if (v.line != null) { this.lines.note(v, 'rev', rev); this.lines.note(v, 'pax', lot.n); }
        g.events.emit('roadDelivery', { vehicle: v, stop: s, cargo: lot.c, amount: lot.n, revenue: rev });
        continue;
      }
      // feeder: hand over to the railway station in reach, paid for this leg
      if (rail && (toRail || lot.to == null || lot.to === s.id)) {
        const took = S.receive(rail, lot.c, lot.n);
        if (took > 0) {
          const share = Math.round(E.revenue(lot.c, took, Math.max(dist, 1), null, false, transit) * 0.45 * this.fareMul(m, from, s));
          E.bookDelivery(share, lot.c, took, null, from, rail, this.ref(v));
          v.earned += share; E.bucket.income += share;
          S.noteTransfer(rail, lot.c, took); s.stats.transfers += took;
          if (v.line != null) { this.lines.note(v, 'rev', share); this.lines.note(v, 'pax', took); }
          g.events.emit('roadDelivery', { vehicle: v, stop: s, cargo: lot.c, amount: took, revenue: share, transfer: rail });
        }
        if (took < lot.n) keep.push({ ...lot, n: lot.n - took, to: undefined, rail: false });
        continue;
      }
      // it could not get off where it meant to: ride on to wherever takes it
      keep.push(lot.to === s.id ? { ...lot, to: undefined, rail: false } : lot);
    }
    v.cargo = keep;
  }
  // fares: comfort, and the airport shuttle's luggage bonus on airport legs
  fareMul(m, from, to) {
    if (!m) return 1;
    let k = m.comfort || 1;
    if (m.airport && ((from && this.nearAirport(from)) || this.nearAirport(to))) k += m.airport;
    return k;
  }
  nearAirport(s) {
    if (!s || !s.tile) return false;
    if (s._apT === this.version) return s._ap;
    s._apT = this.version;
    s._ap = this.stops.some((a) => a.kind === 'airport' && cheb(a.tile, s.tile) <= 4);
    return s._ap;
  }
  // The stops still ahead of a vehicle on its run (in order, each once),
  // until it comes back here; a one-way line ends at its last stop.
  aheadOf(v, s) {
    const seq = v.stops, n = seq.length, line = this.lines.lineOf(v);
    const here = ((v.idx % n) + n) % n;
    const out = [];
    for (let k = 1; k < n; k++) {
      const i = (here + k) % n;
      if (line && line.pattern === 'oneway' && i === 0) break;
      const id = seq[i];
      if (id === s.id) break;
      if (!out.includes(id)) out.push(id);
    }
    return out.map((id) => this.stopById(id)).filter(Boolean);
  }
  // Boarding: every group picks a destination among the stops ahead: a
  // stop in another town, another part of this town (at least MIN_HOP tiles
  // away) or a stop with a railway station in reach (for the train).
  loadAt(v, s) {
    const g = this.game, caps = this.caps(v);
    const line = this.lines.lineOf(v);
    if (line && !this.lines.boards(line, v.idx % v.stops.length)) return;
    const ahead = this.aheadOf(v, s);
    const townOf = (x) => (x.links ? x.links.towns : []);
    for (const c in caps) {
      const have = v.cargo.filter((l) => l.c === c).reduce((a, l) => a + l.n, 0);
      const room = caps[c] - have;
      if (room <= 0 || !(s.stock[c] >= 1)) continue;
      const people = c === 'PASSENGERS' || c === 'MAIL';
      const dests = [];
      for (const o of ahead) {
        const d = cheb(o.tile, s.tile);
        const same = townOf(o).some((id) => townOf(s).includes(id));
        if (o.accepts && o.accepts.has(c) && !(people && same && d < MIN_HOP)) {
          const w = !people ? 1 : same ? Math.max(0.5, Math.min(1.5, d / 6)) : 1.6;
          dests.push({ o, rail: false, w });
        }
        if (o.rail != null && !v.owner) dests.push({ o, rail: true, w: people ? (o.accepts && o.accepts.has(c) ? RAIL_SHARE * 2 : 1.2) : 1 });
      }
      if (!dests.length) continue;
      let n = Math.min(room, Math.floor(s.stock[c]));
      s.stock[c] -= n; s.picked += n;
      const sum = dests.reduce((a, d) => a + d.w, 0);
      // split the group by weight (largest remainder)
      const parts = dests.map((d) => ({ d, k: Math.floor((n * d.w) / sum), r: ((n * d.w) / sum) % 1 }));
      let left = n - parts.reduce((a, p) => a + p.k, 0);
      parts.sort((a, b) => b.r - a.r);
      for (const p of parts) { if (left <= 0) break; p.k++; left--; }
      for (const p of parts) if (p.k > 0) v.cargo.push({ c, n: p.k, from: s.id, t0: g.time, to: p.d.o.id, rail: p.d.rail || undefined });
      if (g.ratings) g.ratings.onPickup(s, c, { _st: { speed: roadModel(v.model).speed } });
    }
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
    const tram = new ModelBuilder();
    tram.box(0.95, 0.26, 0.26, 0xffffff, { y: 0.06 });
    tram.box(0.85, 0.09, 0.27, 0xbfdcec, { y: 0.19 });
    tram.box(0.95, 0.03, 0.2, 0x3a4250, { y: 0.33 });
    tram.box(0.02, 0.2, 0.02, 0x3a4250, { x: 0.1, y: 0.44, rz: 0.5 });
    tram.box(0.04, 0.06, 0.2, 0xfff2c0, { x: 0.48, y: 0.12, glow: true });
    const ship = new ModelBuilder();
    ship.box(1.5, 0.22, 0.46, 0xffffff, { y: 0.0 });
    ship.box(0.22, 0.2, 0.3, 0xffffff, { x: 0.82, y: 0.0 });
    ship.box(0.46, 0.26, 0.36, 0xeef0f2, { x: -0.4, y: 0.22 });
    ship.box(0.4, 0.06, 0.3, 0x3a4a5a, { x: -0.4, y: 0.34, glow: true });
    ship.cyl(0.06, 0.07, 0.3, 6, 0x3a3d42, { x: -0.55, y: 0.48 });
    ship.box(0.7, 0.1, 0.34, 0x8a6f63, { x: 0.3, y: 0.16 });
    const plane = new ModelBuilder();
    plane.cyl(0.1, 0.1, 1.4, 8, 0xffffff, { rz: Math.PI / 2, center: true });
    plane.cone(0.1, 0.24, 8, 0xffffff, { x: 0.82, rz: -Math.PI / 2, center: true });
    plane.box(0.34, 0.03, 1.6, 0xffffff, { x: 0.05 });
    plane.box(0.18, 0.03, 0.6, 0xffffff, { x: -0.62, y: 0.04 });
    plane.box(0.2, 0.28, 0.03, 0xffffff, { x: -0.62, y: 0.16 });
    plane.box(0.5, 0.05, 0.2, 0x3a4a5a, { x: 0.25, y: 0.06 });
    const dock = new ModelBuilder();
    dock.box(1.6, 0.12, 0.8, 0x8a6a4a, { y: 0.02 });
    for (const x of [-0.7, 0, 0.7]) dock.cyl(0.05, 0.05, 0.5, 5, 0x5a4a3a, { x, y: -0.35, z: 0.35 });
    dock.box(0.5, 0.4, 0.4, 0xd8d2c4, { x: -0.4, y: 0.14, z: -0.2 });
    dock.roof(0.56, 0.2, 0.46, 0x7a3f33, { x: -0.4, y: 0.54, z: -0.2 });
    dock.box(0.06, 0.9, 0.06, 0xd0a030, { x: 0.5, y: 0.1, z: -0.2 });
    dock.box(0.7, 0.05, 0.05, 0xd0a030, { x: 0.35, y: 0.98, z: -0.2 });
    const air = new ModelBuilder();
    air.box(5.6, 0.06, 1.2, 0x4a4e54, { y: 0.02 });
    for (let k = -2; k <= 2; k++) air.box(0.5, 0.01, 0.06, 0xf4f4f4, { x: k * 1.1, y: 0.06 });
    air.box(5.6, 0.04, 4.6, 0x8a9a6a, { y: -0.02 });
    air.box(1.6, 0.5, 0.9, 0xd8dde2, { x: -1.4, z: 1.6, y: 0.2 });
    air.box(1.7, 0.08, 1.0, 0x5a6470, { x: -1.4, z: 1.6, y: 0.46 });
    air.box(1.4, 0.2, 0.02, 0x3a4a5a, { x: -1.4, z: 1.14, y: 0.3, glow: true });
    air.cyl(0.14, 0.18, 1.4, 8, 0xe8e2d4, { x: 1.6, z: 1.6, y: 0.0 });
    air.box(0.46, 0.3, 0.46, 0x3a4a5a, { x: 1.6, z: 1.6, y: 1.45, glow: true });
    air.box(1.2, 0.3, 0.9, 0x9aa3ac, { x: 0.4, z: -1.6, y: 0.14 });
    this.busMesh = new THREE.InstancedMesh(bus.build(), MATS, MAXV);
    this.tramMesh = new THREE.InstancedMesh(tram.build(), MATS, MAXV);
    this.shipMesh = new THREE.InstancedMesh(ship.build(), MATS, 120);
    this.planeMesh = new THREE.InstancedMesh(plane.build(), MATS, 120);
    this.dockMesh = new THREE.InstancedMesh(dock.build(), MATS, 60);
    this.airMesh = new THREE.InstancedMesh(air.build(), MATS, 20);
    for (const m of [this.tramMesh, this.shipMesh, this.planeMesh, this.dockMesh, this.airMesh]) { m.count = 0; m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true; }
    this.tramRailMat = new THREE.MeshLambertMaterial({ color: 0x3a3d42 });
    this.truckMesh = new THREE.InstancedMesh(truck.build(), MATS, MAXV);
    this.stopMesh = new THREE.InstancedMesh(stop.build(), MATS, 200);
    for (const m of [this.busMesh, this.truckMesh, this.stopMesh]) { m.count = 0; m.frustumCulled = false; m.castShadow = true; this.group.add(m); }
    // one mesh per bus family, per stop type; garages, doors, signs, crowds
    const inst = (geo, n, shadow = true) => { const m = new THREE.InstancedMesh(geo, MATS, n); m.count = 0; m.frustumCulled = false; m.castShadow = shadow; m.receiveShadow = true; this.group.add(m); return m; };
    this.busMeshes = {};
    for (const k in BUS_SHAPES) { const b = new ModelBuilder(); BUS_SHAPES[k].build(b); this.busMeshes[k] = inst(b.build(), 200); }
    const STOP_CAP = { basic: 200, urban: 200, bay: 120, station: 60, terminal: 30, interchange: 30 };
    this.stopTypeMeshes = {};
    for (const k in STOP_CAP) this.stopTypeMeshes[k] = inst(stopModel(k), STOP_CAP[k]);
    this.garageMesh = inst(garageModel(), 40);
    this.doorMesh = inst(doorModel(), 900, false);
    this.signMesh = inst(signModel(), 700, false);
    this.crowdMesh = inst(personModel(), 900, false);
    this._crowdT = 0;
    this.group.add(this.tramMesh, this.shipMesh, this.planeMesh, this.dockMesh, this.airMesh);
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
    // tram track: two dark rails along each tram tile's links
    if (this.tramRails) { this.group.remove(this.tramRails); this.tramRails.geometry.dispose(); this.tramRails = null; }
    const rp = [];
    const Hr = (x, z) => heightAt(W, x, z) + 0.06;
    const rail = (x0, z0, x1, z1) => { rp.push(x0, Hr(x0, z0), z0, x0, Hr(x0, z1), z1, x1, Hr(x1, z0), z0, x1, Hr(x1, z0), z0, x0, Hr(x0, z1), z1, x1, Hr(x1, z1), z1); };
    for (let i = 0; i < N * N; i++) {
      if (!this.tram[i]) continue;
      const cx = tileCX(i), cz = tileCZ(i);
      for (const [dx, dz] of D4) {
        const X = tx(i) + dx, Z = tz(i) + dz;
        if (!inMap(X, Z) || !this.tram[idx(X, Z)]) continue;
        if (dx) for (const o of [-0.13, 0.13]) rail(cx, cz + o - 0.025, cx + dx * TILE / 2, cz + o + 0.025);
        else for (const o of [-0.13, 0.13]) rail(cx + o - 0.025, cz, cx + o + 0.025, cz + dz * TILE / 2);
      }
    }
    if (rp.length) {
      const rg = new THREE.BufferGeometry();
      rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
      rg.computeVertexNormals();
      this.tramRails = new THREE.Mesh(rg, this.tramRailMat);
      this.group.add(this.tramRails);
    }
    if (!pos.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    this.roadMesh = new THREE.Mesh(geo, this.roadMat);
    this.roadMesh.receiveShadow = true;
    this.group.add(this.roadMesh);
  }
  // Ribbons along the routes of lines, in their colours: the line tool's
  // preview (one item) and the lines overlay (all lines, side by side).
  ribbon(items) {
    const W = this.game.world, pos = [], col = [];
    const c = new THREE.Color();
    items.forEach((it, k) => {
      if (!it.stops || it.stops.length < 2) return;
      c.set(it.color);
      const seq = this.lines.seq({ stops: it.stops, pattern: it.pattern || 'loop' });
      const mode = modeOf(it.kind);
      const lane = ((k % 5) - 2) * 0.13;
      const legs = seq.length === 2 ? 1 : seq.length;
      for (let i = 0; i < legs; i++) {
        const a = this.stopById(seq[i]), b = this.stopById(seq[(i + 1) % seq.length]);
        if (!a || !b) continue;
        const p = mode === 'air' ? [a.tile, b.tile] : this.route(mode, a.tile, b.tile) || [a.tile, b.tile];
        for (let j = 0; j + 1 < p.length; j++) {
          const x0 = tileCX(p[j]), z0 = tileCZ(p[j]), x1 = tileCX(p[j + 1]), z1 = tileCZ(p[j + 1]);
          const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz) || 1, nx = -dz / len, nz = dx / len;
          const w = 0.11, o = lane;
          const y0 = (mode === 'water' ? WATER_LEVEL : heightAt(W, x0, z0)) + (mode === 'air' ? 2.5 : 0.32), y1 = (mode === 'water' ? WATER_LEVEL : heightAt(W, x1, z1)) + (mode === 'air' ? 2.5 : 0.32);
          const A = [x0 + nx * (o - w), y0, z0 + nz * (o - w)], B = [x0 + nx * (o + w), y0, z0 + nz * (o + w)], C = [x1 + nx * (o + w), y1, z1 + nz * (o + w)], D = [x1 + nx * (o - w), y1, z1 + nz * (o - w)];
          for (const v of [A, B, C, A, C, D]) { pos.push(v[0], v[1], v[2]); col.push(c.r, c.g, c.b); }
        }
      }
    });
    if (!pos.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const m = new THREE.Mesh(geo, this.ribbonMat || (this.ribbonMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, depthTest: false, side: THREE.DoubleSide })));
    m.renderOrder = 7;
    m.frustumCulled = false;
    return m;
  }
  previewRoute(item) {
    if (this.previewMesh) { this.group.remove(this.previewMesh); this.previewMesh.geometry.dispose(); this.previewMesh = null; }
    if (!item) return;
    this.previewMesh = this.ribbon([item]);
    if (this.previewMesh) this.group.add(this.previewMesh);
  }
  // the lines overlay: every line's route
  showLines(on) {
    if (this.linesMesh) { this.group.remove(this.linesMesh); this.linesMesh.geometry.dispose(); this.linesMesh = null; }
    if (!on) return;
    this.linesMesh = this.ribbon(this.lines.list.map((l) => ({ stops: l.stops, kind: l.kind, pattern: l.pattern, color: l.color })));
    if (this.linesMesh) this.group.add(this.linesMesh);
  }
  // which way a stop faces: its local +z toward the land beside the road
  stopYaw(s) {
    const t = s.land && s.land.length ? s.land[0] : -1;
    let dx = 0, dz = 1;
    if (t >= 0) { dx = tx(t) - tx(s.tile); dz = tz(t) - tz(s.tile); }
    else {
      // the side of the street without road
      const b = this.bits[s.tile] || (this.townRoads().has(s.tile) ? 0 : 1);
      const cands = [[0, 1], [0, -1], [1, 0], [-1, 0]];
      const alongX = (b & 5) !== 0 || (!b && [[1, 0], [-1, 0]].some(([ox, oz]) => inMap(tx(s.tile) + ox, tz(s.tile) + oz) && this.hasRoad(idx(tx(s.tile) + ox, tz(s.tile) + oz))));
      for (const [ox, oz] of cands) {
        if (alongX ? ox !== 0 : oz !== 0) continue;
        const X = tx(s.tile) + ox, Z = tz(s.tile) + oz;
        if (inMap(X, Z) && !this.hasRoad(idx(X, Z))) { dx = ox; dz = oz; break; }
        dx = ox; dz = oz;
      }
    }
    return Math.atan2(dx, dz);
  }
  placeTypedStop(s, cnt) {
    const W = this.game.world;
    const yaw = this.stopYaw(s);
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const x = tileCX(s.tile) + fx * 0.45, z = tileCZ(s.tile) + fz * 0.45;
    this._p.set(x, heightAt(W, x, z), z);
    this._q.setFromAxisAngle(this._up, yaw);
    const big = s.kind === 'garage' || ['station', 'terminal', 'interchange'].includes(s.type);
    const sc = big ? 1 : 1.3;
    this._s.set(sc, sc, sc);
    this._m.compose(this._p, this._q, this._s);
    const mesh = s.kind === 'garage' ? this.garageMesh : this.stopTypeMeshes[s.type] || this.stopTypeMeshes.basic;
    const key = s.kind === 'garage' ? 'garage' : this.stopTypeMeshes[s.type] ? s.type : 'basic';
    const n = cnt[key]++;
    if (n >= mesh.instanceMatrix.count) return;
    mesh.setMatrixAt(n, this._m);
    mesh.setColorAt(n, this._c.set(s.owner && this.rival(s) ? this.rival(s).color : 0xffffff));
    // the lines that call here, as colour plates on the stop sign
    if (s.kind !== 'bus') return;
    const SIGN = { basic: [0, 0.42], urban: [0.3, 0.44], bay: [0.46, 0.44], station: [0.9, 0.58], terminal: [1.2, 0.68], interchange: [1.2, 0.68] }[s.type] || [0, 0.42];
    const ls = this.lines.linesAt(s.id).slice(0, 3);
    ls.forEach((l, i) => {
      if (cnt.sign >= this.signMesh.instanceMatrix.count) return;
      const lx = SIGN[0] * sc, ly = (SIGN[1] - 0.05 * i) * sc, lz = -0.1 * sc;
      const wx = x + Math.cos(yaw) * lx + Math.sin(yaw) * lz, wz = z - Math.sin(yaw) * lx + Math.cos(yaw) * lz;
      this._p.set(wx, heightAt(W, x, z) + ly, wz);
      this._q.setFromAxisAngle(this._up, yaw + Math.PI / 2);
      this._s.set(1, 1, 1.2);
      this._m.compose(this._p, this._q, this._s);
      this.signMesh.setMatrixAt(cnt.sign, this._m);
      this.signMesh.setColorAt(cnt.sign, this._c.set(l.color));
      cnt.sign++;
    });
  }
  rebuildStopMesh() {
    const W = this.game.world;
    let k = 0, kd = 0, ka = 0;
    const cnt = { garage: 0, sign: 0 };
    for (const t in this.stopTypeMeshes) cnt[t] = 0;
    for (const s of this.stops) {
      if (k >= 200) break;
      if (s.kind === 'dock' || s.kind === 'airport') {
        const x = tileCX(s.tile), z = tileCZ(s.tile);
        let yaw = 0;
        if (s.kind === 'dock') {
          // the pier reaches out over the water
          for (const [dx, dz] of D4) { const X = tx(s.tile) + dx, Z = tz(s.tile) + dz; if (inMap(X, Z) && W.type[idx(X, Z)] === 1) { yaw = Math.atan2(-dz, dx) + Math.PI / 2; break; } }
        }
        this._p.set(x, Math.max(heightAt(W, x, z), WATER_LEVEL) + 0.02, z);
        this._q.setFromAxisAngle(this._up, yaw);
        this._s.set(1, 1, 1);
        this._m.compose(this._p, this._q, this._s);
        const mesh = s.kind === 'dock' ? this.dockMesh : this.airMesh;
        const n = s.kind === 'dock' ? kd++ : ka++;
        if (n < mesh.instanceMatrix.count) { mesh.setMatrixAt(n, this._m); mesh.setColorAt(n, this._c.set(0xffffff)); }
        continue;
      }
      if (s.kind === 'bus' || s.kind === 'garage') { this.placeTypedStop(s, cnt); continue; }
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
      this.stopMesh.setColorAt(k, this._c.set(s.owner && this.rival(s) ? this.rival(s).color : s.kind === 'bus' ? 0xffffff : 0xe8d8b0));
      k++;
    }
    this.stopMesh.count = k;
    for (const t in this.stopTypeMeshes) { const M = this.stopTypeMeshes[t]; M.count = Math.min(cnt[t], M.instanceMatrix.count); M.instanceMatrix.needsUpdate = true; if (M.instanceColor) M.instanceColor.needsUpdate = true; }
    this.garageMesh.count = cnt.garage; this.garageMesh.instanceMatrix.needsUpdate = true; if (this.garageMesh.instanceColor) this.garageMesh.instanceColor.needsUpdate = true;
    this._stopSigns = cnt.sign;
    this.dockMesh.count = Math.min(kd, 60); this.airMesh.count = Math.min(ka, 20);
    for (const m of [this.dockMesh, this.airMesh]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    this.stopMesh.instanceMatrix.needsUpdate = true;
    if (this.stopMesh.instanceColor) this.stopMesh.instanceColor.needsUpdate = true;
  }
  // world position of a vehicle (keep right)
  vehPos(v, out) {
    const W = this.game.world;
    const md = modeOf((roadModel(v.model) || {}).kind);
    if (md === 'air') {
      // on the runway while loading; in flight: climb, cruise, descend
      if (v.fly) {
        const f = v.fly, k = f.s / f.d;
        const ax = tileCX(f.from), az = tileCZ(f.from), bx = tileCX(f.to), bz = tileCZ(f.to);
        out.x = ax + (bx - ax) * k; out.z = az + (bz - az) * k;
        const alt = Math.min(4.5, f.s * 1.1, (f.d - f.s) * 1.1);
        out.y = Math.max(heightAt(W, out.x, out.z), 0) + 0.25 + alt;
        out.yaw = Math.atan2(-(bz - az), bx - ax);
        v.yaw = out.yaw;
        return out;
      }
      out.x = tileCX(v.tile); out.z = tileCZ(v.tile); out.y = heightAt(W, out.x, out.z) + 0.2; out.yaw = v.yaw || 0;
      return out;
    }
    const a = v.tile, b = v.path && v.pi < v.path.length - 1 ? v.path[v.pi + 1] : a;
    // standing at a bus stop: in its bay (pulled in at bays and stations)
    if (b === a && v.state === 'load' && md === 'road') {
      const st = this.stopAt(a);
      if (st && st.kind !== 'garage') {
        const P = this.stopProps(st), yaw = v.yaw || 0, cy = Math.cos(yaw), sy = -Math.sin(yaw);
        const slot = v.bay || 0, span = Math.min(P.bays, 4);
        const along = (slot % span - (span - 1) / 2) * 0.55;
        const side = 0.2 + (P.pullIn ? 0.16 : 0);
        out.x = tileCX(a) + cy * along - sy * side; out.z = tileCZ(a) + sy * along + cy * side;
        out.y = heightAt(W, out.x, out.z) + 0.03; out.yaw = yaw;
        return out;
      }
    }
    const ax = tileCX(a), az = tileCZ(a), bx = tileCX(b), bz = tileCZ(b);
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len, nz = dx / len;
    const f = b === a ? 0 : v.f;
    const side = md === 'tram' ? 0 : md === 'water' ? 0 : 0.2;
    const x = ax + dx * f + nx * side, z = az + dz * f + nz * side;
    out.x = x; out.z = z; out.y = md === 'water' ? WATER_LEVEL + 0.08 : heightAt(W, x, z) + 0.03; out.yaw = b === a ? (v.yaw || 0) : Math.atan2(-dz, dx);
    v.yaw = out.yaw;
    return out;
  }
  // the colour a vehicle wears: its own, its line's (if the line dresses its
  // vehicles), the rival's, the company's (buses) or the model's
  vehColor(v, m) {
    if (v.owner && this.rival(v)) return this.rival(v).color;
    if (v.color != null) return v.color;
    const l = v.line != null ? this.lines.byId(v.line) : null;
    if (l && l.livery) return l.color;
    return m.color || (this.game.company ? this.game.company.color : 0x2f6b4a);
  }
  updateVisuals(dt = 0) {
    const n = { bus: 0, truck: 0, tram: 0, dock: 0, airport: 0 };
    const mesh = { bus: this.busMesh, truck: this.truckMesh, tram: this.tramMesh, dock: this.shipMesh, airport: this.planeMesh };
    const scale = { bus: 1.4, truck: 1.4, tram: 1.4, dock: 1.2, airport: 1.3 };
    const nb = {};
    for (const k in this.busMeshes) nb[k] = 0;
    let nd = 0, ns = this._stopSigns || 0;
    const o = {};
    for (const v of this.vehicles) {
      const m = roadModel(v.model);
      if (!m || !mesh[m.kind]) continue;
      if (v.state === 'stored') continue;
      const shape = m.kind === 'bus' ? BUS_SHAPES[m.shape] : null;
      const M = shape ? this.busMeshes[m.shape] : mesh[m.kind];
      const slot = shape ? nb[m.shape] : n[m.kind];
      if (slot >= M.instanceMatrix.count) continue;
      this.vehPos(v, o);
      const sc = scale[m.kind];
      this._p.set(o.x, o.y, o.z); this._q.setFromAxisAngle(this._up, o.yaw); this._s.set(sc, sc, sc);
      this._m.compose(this._p, this._q, this._s);
      M.setMatrixAt(slot, this._m); M.setColorAt(slot, this._c.set(this.vehColor(v, m)));
      if (shape) nb[m.shape]++; else n[m.kind]++;
      if (!shape) continue;
      const cy = Math.cos(o.yaw), sy = Math.sin(o.yaw);
      const at = (lx, ly, lz) => { this._p.set(o.x + (cy * lx + sy * lz) * sc, o.y + ly * sc, o.z + (-sy * lx + cy * lz) * sc); };
      // destination sign in the line colour
      const line = v.line != null ? this.lines.byId(v.line) : null;
      if (line && ns < this.signMesh.instanceMatrix.count) {
        at(shape.sign[0], shape.sign[1] - 0.03, 0);
        this._q.setFromAxisAngle(this._up, o.yaw); this._s.set(sc, sc, sc);
        this._m.compose(this._p, this._q, this._s);
        this.signMesh.setMatrixAt(ns, this._m); this.signMesh.setColorAt(ns, this._c.set(line.color)); ns++;
      }
      // doors on the kerb side: they slide open while the bus stands at a stop
      let open = 0;
      if (v.state === 'load' && v.dwell > 0) { const el = v.dwell - v.t; open = Math.max(0, Math.min(1, Math.min(el, v.t) / DOOR)); }
      for (const dx of shape.doors) {
        if (nd >= this.doorMesh.instanceMatrix.count) break;
        at(dx - open * 0.07, 0.07, 0.132);
        this._q.setFromAxisAngle(this._up, o.yaw); this._s.set(sc, sc, sc);
        this._m.compose(this._p, this._q, this._s);
        this.doorMesh.setMatrixAt(nd, this._m); this.doorMesh.setColorAt(nd, this._c.set(open > 0.3 ? 0xffe6a8 : 0x3a4250)); nd++;
      }
    }
    for (const k in mesh) { const M = mesh[k]; M.count = n[k]; M.instanceMatrix.needsUpdate = true; if (M.instanceColor) M.instanceColor.needsUpdate = true; }
    for (const k in this.busMeshes) { const M = this.busMeshes[k]; M.count = nb[k]; M.instanceMatrix.needsUpdate = true; if (M.instanceColor) M.instanceColor.needsUpdate = true; }
    for (const M of [this.doorMesh, this.signMesh]) { M.count = M === this.doorMesh ? nd : ns; M.instanceMatrix.needsUpdate = true; if (M.instanceColor) M.instanceColor.needsUpdate = true; }
    this._crowdT -= dt;
    if (this._crowdT <= 0) { this._crowdT = 0.4; this.updateCrowds(); }
  }
  // people waiting at bus and tram stops: a few figures per stop, more when busy
  // (travellers still boarding a bus count until they are aboard)
  updateCrowds() {
    const W = this.game.world, M = this.crowdMesh;
    let k = 0;
    const board = new Map();
    for (const v of this.vehicles) if (v.state === 'load' && v.boardLeft > 0) board.set(v.boardAt, (board.get(v.boardAt) || 0) + v.boardLeft);
    const SHIRTS = [0xd8483a, 0x2f7ad0, 0x3fae5a, 0xe0a33a, 0x8a4fc0, 0xe8e2d4, 0x4a5568, 0xe36fa0];
    for (const s of this.stops) {
      if (s.kind !== 'bus' && s.kind !== 'tram') continue;
      const waiting = (s.stock.PASSENGERS || 0) + (board.get(s.id) || 0);
      const cap = s.kind === 'bus' ? [4, 6, 8, 12, 18, 18][s.level | 0] : 6;
      const nfig = Math.min(cap, Math.ceil(waiting / 6));
      if (!nfig) continue;
      const yaw = s.kind === 'bus' ? this.stopYaw(s) : 0;
      const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
      const bx = tileCX(s.tile) + fx * 0.5, bz = tileCZ(s.tile) + fz * 0.5;
      for (let i = 0; i < nfig && k < M.instanceMatrix.count; i++) {
        const h = ((s.id * 73856093) ^ (i * 19349663)) >>> 0;
        const along = ((i % 6) - 2.5) * 0.14 + ((h % 7) - 3) * 0.01, out = Math.floor(i / 6) * 0.13 + ((h >> 3) % 5) * 0.01;
        const x = bx + rx * along + fx * out, z = bz + rz * along + fz * out;
        this._p.set(x, heightAt(W, x, z) + 0.02, z);
        this._q.setFromAxisAngle(this._up, (h % 628) / 100);
        this._s.set(1.3, 1.3 * (0.9 + (h % 5) * 0.04), 1.3);
        this._m.compose(this._p, this._q, this._s);
        M.setMatrixAt(k, this._m); M.setColorAt(k, this._c.set(SHIRTS[h % SHIRTS.length])); k++;
      }
    }
    M.count = k;
    M.instanceMatrix.needsUpdate = true;
    if (M.instanceColor) M.instanceColor.needsUpdate = true;
  }
  // the road vehicle nearest a ground point (tap / click), within reach
  pickAt(p) {
    let best = null, bd = 0.9;
    const o = {};
    for (const v of this.vehicles) { this.vehPos(v, o); const d = Math.hypot(o.x - p.x, o.z - p.z); if (d < bd) { bd = d; best = v; } }
    return best;
  }
  // is any road vehicle on (or entering) this tile? (level crossing interlock)
  onTile(tile) {
    return this.vehicles.some((v) => {
      const md = modeOf((roadModel(v.model) || {}).kind);
      if (md !== 'road' && md !== 'tram') return false;
      return (v.tile === tile && (v.f < 0.5 || !v.path)) || (v.path && v.path[v.pi + 1] === tile && v.f >= 0.4);
    });
  }

  // ---------- save ----------
  serialize() {
    const roads = [];
    const tram = [];
    for (let i = 0; i < N * N; i++) { if (this.bits[i]) roads.push(i, this.bits[i]); if (this.tram[i]) tram.push(i); }
    return {
      roads, tram, nextStop: this.nextStop, nextVeh: this.nextVeh,
      stops: this.stops.map((s) => ({ id: s.id, tile: s.tile, kind: s.kind, owner: s.owner || undefined, name: s.name, type: s.type && s.type !== 'basic' ? s.type : undefined, fac: s.facilities && s.facilities.length ? s.facilities : undefined, land: s.land && s.land.length ? s.land : undefined, stock: s.stock, delivered: s.delivered, picked: s.picked, created: s.created, arrivals: s.stats.arrivals, transfers: s.stats.transfers, ratings: this.game.ratings ? this.game.ratings.serialize(s) : undefined, fin: cleanFin(s.fin) })),
      lines: this.lines.serialize(),
      vehicles: this.vehicles.map((v) => ({ id: v.id, model: v.model, owner: v.owner || undefined, line: v.line ?? undefined, name: v.name, stops: v.stops, idx: v.idx, tile: v.tile, cargo: v.cargo, earned: Math.round(v.earned), trips: v.trips, bought: Math.round(v.bought || 0), fin: cleanFin(v.fin), dly: v.dly ? Math.round(v.dly * 10) / 10 : undefined, state: v.state === 'run' || v.state === 'broken' ? 'load' : v.state, rel: v.rel != null ? Math.round(v.rel * 1000) / 1000 : undefined, served: v.served != null ? Math.round(v.served) : undefined, goGarage: v.goGarage || undefined, service: v.service || undefined, color: v.color != null ? v.color : undefined, breakdowns: v.breakdowns || undefined })),
      rules: this.rules.length ? this.rules : undefined,
    };
  }
  deserialize(d) {
    if (!d || typeof d !== 'object') return;
    const okTile = (t) => Number.isInteger(t) && t >= 0 && t < N * N;
    if (Array.isArray(d.roads)) for (let k = 0; k + 1 < d.roads.length; k += 2) if (okTile(d.roads[k])) this.bits[d.roads[k]] = d.roads[k + 1] & 15;
    if (Array.isArray(d.tram)) for (const t of d.tram) if (okTile(t)) this.tram[t] = 1;
    this.stops = [];
    for (const s of Array.isArray(d.stops) ? d.stops : []) {
      if (!s || !okTile(s.tile) || !STOP_KINDS.includes(s.kind)) continue;
      const stop = { id: s.id | 0, tile: s.tile, kind: s.kind, road: true, name: String(s.name || 'Stop').slice(0, 40), level: 0, stock: {}, claimed: {}, facilities: [], delivered: +s.delivered || 0, picked: +s.picked || 0, created: +s.created || 0,
        stats: { arrivals: s.arrivals | 0, wait: 0, _lastWait: 0, waitEma: 0, transfers: s.transfers | 0, recent: [], util: [] }, links: null, accepts: null, supplies: null, warn: false, fin: cleanFin(s.fin) || null };
      for (const c in s.stock || {}) if (CARGO[c] && s.stock[c] > 0) stop.stock[c] = Math.min(9999, +s.stock[c]);
      if (s.ratings && this.game.ratings) this.game.ratings.deserialize(stop, s.ratings);
      if (typeof s.owner === 'string' && /^r\d{1,2}$/.test(s.owner)) stop.owner = s.owner;
      stop.type = stop.kind === 'bus' && STOP_TYPES[s.type] ? s.type : 'basic';
      stop.level = stop.kind === 'bus' ? STOP_ORDER.indexOf(stop.type) : 0;
      stop.facilities = (Array.isArray(s.fac) ? s.fac : []).filter((f) => STOP_FACILITIES[f]).slice(0, 12);
      stop.land = (Array.isArray(s.land) ? s.land : []).filter((t) => okTile(t) && t !== stop.tile).slice(0, 2);
      this.stops.push(stop);
      this.claimLand(stop, true);
    }
    this.vehicles = [];
    for (const v of Array.isArray(d.vehicles) ? d.vehicles : []) {
      if (!v || !roadModel(v.model) || !okTile(v.tile)) continue;
      const stops = (Array.isArray(v.stops) ? v.stops : []).filter((id) => this.stops.some((s) => s.id === id));
      this.vehicles.push({ id: v.id | 0, model: v.model, name: String(v.name || 'Bus').slice(0, 40), stops, idx: Math.max(0, v.idx | 0), tile: v.tile, prev: -1, next: -1, f: 0, path: null, state: v.state === 'idle' ? 'idle' : v.state === 'stored' ? 'stored' : 'load', t: 1, dwell: 1, cargo: (Array.isArray(v.cargo) ? v.cargo : []).filter((l) => l && CARGO[l.c] && l.n > 0).map((l) => ({ c: l.c, n: Math.floor(l.n), from: l.from | 0, t0: Number.isFinite(l.t0) ? l.t0 : undefined, to: Number.isInteger(l.to) && this.stops.some((s) => s.id === l.to) ? l.to : undefined, rail: l.rail ? true : undefined })), line: Number.isInteger(v.line) ? v.line : null, earned: +v.earned || 0, trips: v.trips | 0, bought: +v.bought || 0, fin: cleanFin(v.fin) || null, dly: Number.isFinite(+v.dly) && v.dly > 0 ? Math.min(600, +v.dly) : undefined, v: 0, owner: typeof v.owner === 'string' && /^r\d{1,2}$/.test(v.owner) ? v.owner : undefined, rel: Number.isFinite(+v.rel) && v.rel != null ? Math.max(0.2, Math.min(1, +v.rel)) : undefined, served: Number.isFinite(+v.served) && v.served != null ? +v.served : undefined, goGarage: Number.isInteger(v.goGarage) && this.stops.some((s) => s.id === v.goGarage && s.kind === 'garage') ? v.goGarage : null, service: !!v.service, color: v.color != null && Number.isFinite(+v.color) ? (+v.color >>> 0) & 0xffffff : null, breakdowns: v.breakdowns | 0 });
    }
    this.nextStop = Math.max(d.nextStop | 0, 1, ...this.stops.map((s) => s.id + 1));
    this.nextVeh = Math.max(d.nextVeh | 0, 1, ...this.vehicles.map((v) => v.id + 1));
    this.rules = (Array.isArray(d.rules) ? d.rules : []).filter((r) => r && roadModel(r.from) && roadModel(r.to)).map((r) => ({ from: r.from, to: r.to, age: Math.max(1, r.age | 0) }));
    this.lines.deserialize(d.lines);
    // vehicles whose line is gone (or never existed) become lines of their own
    for (const v of this.vehicles) if (v.line != null && !this.lines.byId(v.line)) v.line = null;
    this.lines.adoptVehicles();
  }
  afterLoad() { this.relinkAll(); this.rebuildRoadMesh(); this.rebuildStopMesh(); }
}
