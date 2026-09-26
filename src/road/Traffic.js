// Road traffic: the town's own cars (a simplified simulation next to the
// company's vehicles), right of way at junctions, traffic lights on the big
// crossroads of cities, light congestion and bus lanes.
//  - Cars: how many drive in a town follows its population, how dense it is
//    (flats, offices, shops) and the time of day (rush hours, quiet nights).
//    They run in game time for every town in an unlocked region, whatever the
//    camera shows, so buses meet the same traffic near or far; only drawing
//    is limited to what is in view.
//  - Every mover (car, bus, truck, tram) keeps its distance to the one ahead
//    on the same stretch, waits at the stop line while another vehicle holds
//    the junction ahead, stops at red lights and at closed level crossings.
//    Nobody waits forever: after GIVE_UP seconds a vehicle squeezes through
//    (no gridlock).
//  - Congestion: a company vehicle on a street busy with cars drives slower
//    (lightly); a bus lane takes buses and coaches out of it.
//  - Bus priority (research): a bus waiting at red shortens the red phase.
import * as THREE from 'three';
import { N, TILE, tx, tz, clamp } from '../util.js';
import { ModelBuilder, MATS } from '../core/ModelBuilder.js';
import { heightAt } from '../world/WorldGen.js';

export const MAX_CARS = 480;      // simulated everywhere
const CAR_GAP = 0.42;             // tile lengths to the mover ahead
const STOP_AT = 0.55;             // stop line before a junction or a red light
const LIGHT_GREEN = 5;            // seconds of green per axis
const GIVE_UP = 15;               // seconds of waiting (not at red) before squeezing through
const HOLD_T = 1.6;               // a junction reservation lapses unless refreshed
const CAR_COLORS = [0xc94f4f, 0x3f6e9a, 0xe0a33a, 0xe8e2d4, 0x5aa66a, 0x2b2b2b, 0x8a8f96, 0x6a4a8a];
const DENSE = { apartment: 1, block: 1, office: 1, tower: 1, skyscraper: 1, shop: 1, townhouse: 0.4, terrace: 0.5, hotel: 1, glasstower: 1, factory: 0.6, boathouse: 0.4, stadium: 1, convention: 1, market_hall: 1, university: 1 };
const bump = (t, c, w) => Math.exp(-((t - c) ** 2) / (2 * w * w));
const axisOf = (a, b) => (tx(b) !== tx(a) ? 0 : 1);

export class Traffic {
  constructor(game) {
    this.game = game;
    this.cars = [];
    this.seq = 1;
    this._r = 0x51f15e;
    this.res = new Map();       // junction tile -> { k, until }
    this.jn = new Map();        // tile -> 1 junction, 2 junction with traffic lights
    this.lights = new Map();    // tile -> { axis (green), t (left), pri }
    this.load = new Map();      // tile -> cars on or next to it this step
    this.edges = new Map();     // directed edge -> movers on it this step
    this._jv = null;
    this._adj = 0;
    this.stats = { squeezed: 0, redStops: 0 };
    // cars and traffic light heads, instanced
    const cm = new ModelBuilder();
    cm.box(0.36, 0.12, 0.18, 0xffffff, { y: 0.05 });
    cm.box(0.2, 0.1, 0.16, 0xdde8f0, { x: -0.03, y: 0.17 });
    cm.box(0.03, 0.04, 0.12, 0xfff6c0, { x: 0.18, y: 0.1, glow: true });
    this.carMesh = new THREE.InstancedMesh(cm.build(), MATS, MAX_CARS);
    this.carMesh.count = 0; this.carMesh.frustumCulled = false; this.carMesh.castShadow = false; this.carMesh.receiveShadow = true;
    const pm = new ModelBuilder();
    pm.cyl(0.018, 0.022, 0.62, 5, 0x2f3338);
    this.postMesh = new THREE.InstancedMesh(pm.build(), MATS, 400);
    const hm = new ModelBuilder();
    hm.box(0.07, 0.1, 0.07, 0xffffff, { y: 0.6, glow: true });
    this.headMesh = new THREE.InstancedMesh(hm.build(), MATS, 400);
    for (const m of [this.postMesh, this.headMesh]) { m.count = 0; m.frustumCulled = false; m.castShadow = false; }
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(); this._up = new THREE.Vector3(0, 1, 0); this._c = new THREE.Color();
    this._zero = new THREE.Matrix4().makeScale(0, 0, 0);
    const grp = game.towns && game.towns.group;
    if (grp) grp.add(this.carMesh, this.postMesh, this.headMesh);
  }
  rand() { this._r = (Math.imul(this._r, 1103515245) + 12345) >>> 0; return (this._r >>> 8) / 16777216; }

  // ---------- junctions and lights ----------
  refreshJunctions() {
    const g = this.game, R = g.roads;
    if (!R) return;
    const key = `${R.version}|${g.towns.list.map((t) => t.stage).join('')}`;
    if (key === this._jv) return;
    this._jv = key;
    const old = this.lights;
    this.jn = new Map(); this.lights = new Map();
    const T = R.townRoads();
    const tiles = new Set(T);
    for (let i = 0; i < R.bits.length; i++) if (R.bits[i]) tiles.add(i);
    // lights: the four-way crossroads in the centre of a city
    const city = new Set();
    for (const t of g.towns.list) if (t.stage >= 4 && t.roadSet) { const r = 1 + (t.stage >= 6 ? 1 : 0); for (const i of t.roadSet) if (Math.max(Math.abs(tx(i) - t.x), Math.abs(tz(i) - t.z)) <= r) city.add(i); }
    for (const i of tiles) {
      const d = R.neighbours(i).length;
      if (d < 3) continue;
      const lit = d === 4 && city.has(i) && !g.crossings.at(i);
      this.jn.set(i, lit ? 2 : 1);
      if (lit) this.lights.set(i, old.get(i) || { axis: (tx(i) + tz(i)) & 1, t: LIGHT_GREEN * (0.3 + 0.7 * ((i * 7919) % 97) / 97), pri: false });
    }
    this._lightsDirty = true;
  }
  isJunction(i) { return this.jn.has(i); }
  lightAt(i) { return this.lights.get(i) || null; }
  // is the way from a into b red?
  red(a, b) { const L = this.lights.get(b); return !!L && L.axis !== axisOf(a, b); }

  // hold junction tile j for mover k (true when it is free or already ours)
  reserve(j, k) {
    const now = this.game.time, r = this.res.get(j);
    if (r && r.k !== k && r.until > now) return false;
    this.res.set(j, { k, until: now + HOLD_T });
    return true;
  }
  release(j, k) { const r = this.res.get(j); if (r && r.k === k) this.res.delete(j); }

  // ---------- one step ----------
  // called by Roads.tick before its vehicles move (they share the edges)
  tick(dt) {
    const g = this.game, R = g.roads;
    if (!R) return;
    this.refreshJunctions();
    // lights change
    for (const L of this.lights.values()) { L.t -= dt; if (L.t <= 0) { L.axis ^= 1; L.t = LIGHT_GREEN; L.pri = false; this._lightsDirty = true; } }
    // car numbers follow the towns (checked once a second)
    this._adj -= dt;
    if (this._adj <= 0) { this._adj = 1; this.adjustCars(); }
    // who is on which stretch
    const E = this.edges; E.clear();
    const add = (a, b, f, o) => { if (b == null || b < 0 || a === b) return; const k = a * 131072 + b; let l = E.get(k); if (!l) E.set(k, l = []); l.push({ f, o }); };
    for (const c of this.cars) add(c.from, c.to, c.f, c);
    for (const v of R.vehicles) if ((v.state === 'run' || v.state === 'broken') && v.path) add(v.tile, v.path[v.pi + 1], v.f, v);
    this.load.clear();
    for (const c of this.cars) { this.load.set(c.from, (this.load.get(c.from) || 0) + 1); if (c.to >= 0) this.load.set(c.to, (this.load.get(c.to) || 0) + 0.5); }
    this.moveCars(dt);
  }
  // the nearest mover ahead of f on the stretch a→b (its f), or null;
  // cars: only the town's cars count (company vehicles keep their own distance)
  ahead(a, b, f, self, carsOnly = false, noCars = false) {
    const l = this.edges.get(a * 131072 + b);
    if (!l) return null;
    let best = null, obj = null;
    // (two at the same spot: the older one counts as ahead, so they part)
    const sid = self ? (self.town != null ? 1e6 : 0) + self.id : -1;
    for (const m of l) {
      if (m.o === self || (carsOnly && m.o.town == null) || (noCars && m.o.town != null)) continue;
      if (m.f > f || (m.f === f && (m.o.town != null ? 1e6 : 0) + m.o.id < sid)) { if (best == null || m.f < best) { best = m.f; obj = m.o; } }
    }
    this._aheadObj = obj;
    return best;
  }
  // someone just past the junction on the way out: wait before entering it
  exitBusy(j, nx) {
    if (nx == null || nx < 0 || nx === j) return false;
    const l = this.edges.get(j * 131072 + nx);
    return !!l && l.some((m) => m.f < CAR_GAP * 0.8);
  }
  moveCars(dt) {
    const g = this.game, T = g.towns, X = g.crossings, R = g.roads;
    for (const c of this.cars) {
      const t = T.byId(c.town);
      if (!t || !t.roadSet || !t.roadSet.size) continue;
      if (c.to < 0 || !t.roadSet.has(c.from) || !t.roadSet.has(c.to)) {
        c.from = t.roadSet.has(c.from) ? c.from : [...t.roadSet][Math.floor(this.rand() * t.roadSet.size)];
        c.to = T.nextRoad(t, c.from, -1);
        c.nx = -1; c.f = 0;
      }
      // where it turns after the next tile (chosen ahead: don't block the box)
      if (c.nx == null || c.nx < 0 || !t.roadSet.has(c.nx)) c.nx = T.nextRoad(t, c.to, c.from);
      const key = 'c' + c.id;
      // clear a level crossing that starts to warn quickly
      const rush = X && X.isBlocked(c.from) && c.f < 0.5 ? 3 : 1;
      const step = dt * c.speed * rush;
      let nf = c.f + step;
      // closed level crossing ahead (waiting there never gives up)
      const atCross = !!(X && X.isBlocked(c.to) && c.f < 0.4);
      if (atCross) nf = Math.min(nf, 0.34);
      // keep the distance to the vehicle ahead on this stretch
      const ah = this.ahead(c.from, c.to, c.f, c);
      // (queued behind a car that waits at red or at a crossing: we wait as long)
      let queued = false;
      if (ah != null && nf > ah - CAR_GAP) { nf = ah - CAR_GAP; const o = this._aheadObj; queued = !!(o && o.town != null && o.fixed); }
      // and to the last one on the next stretch (across the tile edge)
      else if (ah == null && nf > 1 - CAR_GAP && c.nx >= 0) { const nx = this.ahead(c.to, c.nx, -1, c); if (nx != null && nf > 1 + nx - CAR_GAP) { nf = 1 + nx - CAR_GAP; const o = this._aheadObj; queued = !!(o && o.town != null && o.fixed); } }
      // a bus at a kerbside stop on the next tile (same direction) holds us
      if (nf > 0.4) { const st = R.stopAt(c.to); if (st && st.kind === 'bus' && !R.stopProps(st).pullIn && R.vehicles.some((v) => v.state === 'load' && v.tile === c.to && v.prev === c.from)) nf = Math.min(nf, 0.4); }
      // the stop line: red light, or someone else in the junction ahead
      let atRed = atCross || queued;
      if (c.f <= STOP_AT && nf > STOP_AT) {
        if (this.red(c.from, c.to)) { nf = STOP_AT; atRed = true; }
        else if (this.jn.has(c.to) && (this.exitBusy(c.to, c.nx) || !this.reserve(c.to, key))) nf = STOP_AT;
      } else if (c.f > STOP_AT && this.jn.has(c.to)) this.reserve(c.to, key);
      // (a red light and a level crossing always open again: that wait never counts)
      const held = nf < c.f + step * 0.5 && !atRed;
      if (atRed) c.wait = 0;
      c.fixed = atRed && nf <= c.f + 1e-6;
      if (held) {
        c.wait += dt;
        if (c.wait > GIVE_UP) { nf = c.f + step; c.wait = 0; this.stats.squeezed++; }
      } else c.wait = 0;
      c.f = Math.max(c.f, nf);
      if (c.f >= 1) {
        this.release(c.from, key);
        const prev = c.from; c.from = c.to; c.to = c.nx >= 0 && c.nx !== c.from ? c.nx : T.nextRoad(t, c.from, prev); c.nx = -1; c.f -= 1;
      }
      // inside a junction: keep it until we are through
      if (this.jn.has(c.from)) { if (c.f < 0.45) this.reserve(c.from, key); else this.release(c.from, key); }
    }
  }

  // ---------- company vehicles ----------
  // Where may road vehicle v get to on the stretch a→b this step (from f0,
  // wanting nf)? Stops at red lights and while another vehicle holds the
  // junction ahead; buses, trucks: behind the town's cars (a bus in a bus
  // lane passes them). Trams keep to the lights and junctions only.
  limitVehicle(v, a, b, f0, nf, kind, dt) {
    const g = this.game, R = g.roads, key = 'v' + v.id, bus = kind === 'bus';
    if (this.jn.has(a)) { if (f0 < 0.45) this.reserve(a, key); else this.release(a, key); }
    let lim = nf;
    // the vehicle ahead: company vehicles always; the town's cars unless a
    // bus runs in its lane (trams keep to their track in the middle)
    const passCars = kind === 'tram' || (bus && R.lane[a]);
    const ah = this.ahead(a, b, f0, v, false, passCars);
    if (ah != null) lim = Math.min(lim, ah - CAR_GAP);
    else if (lim > 1 - CAR_GAP && v.path && v.path[v.pi + 2] != null) { const nx = this.ahead(b, v.path[v.pi + 2], -1, v, false, passCars || (bus && R.lane[b])); if (nx != null) lim = Math.min(lim, 1 + nx - CAR_GAP); }
    let red = false;
    if (f0 <= STOP_AT && lim > STOP_AT) {
      const L = this.lights.get(b);
      if (L && L.axis !== axisOf(a, b)) {
        lim = STOP_AT; red = true;
        if (!v._red) this.stats.redStops++;
        // bus priority: the light turns for the waiting bus sooner
        if (bus && g.progression.fx.busPriority > 0 && !L.pri && L.t > 1.2) { L.t = 1.2; L.pri = true; }
      } else if (this.jn.has(b) && (this.exitBusy(b, v.path ? v.path[v.pi + 2] : -1) || !this.reserve(b, key))) lim = STOP_AT;
    } else if (f0 > STOP_AT && this.jn.has(b)) this.reserve(b, key);
    v._red = red;
    // (a red light always turns: that wait never counts)
    if (!red && lim < nf - 1e-6 && lim <= f0 + (nf - f0) * 0.5) {
      v._tw = (v._tw || 0) + dt;
      if (v._tw > GIVE_UP) { v._tw = 0; this.stats.squeezed++; return nf; }
    } else v._tw = 0;
    return Math.max(f0, lim);
  }
  // leaving tile a for good (arrived, sold, sent elsewhere)
  vehicleGone(v) { const k = 'v' + v.id; for (const [j, r] of this.res) if (r.k === k) this.res.delete(j); }
  // how freely a company vehicle drives on tile a (1 free … 0.7 busy street)
  speedMul(a, bus) {
    const R = this.game.roads;
    if (bus && R.lane[a]) return 1;
    const n = this.load.get(a) || 0;
    return clamp(1.1 - 0.06 * n, 0.7, 1);
  }

  // ---------- car numbers ----------
  // cars a town wants now: population, density, time of day
  wanted(t) {
    const g = this.game;
    if (!g.progression.regionUnlocked(t.region) || !t.roadSet || t.roadSet.size < 2) return 0;
    let dense = 0, tot = 0;
    for (const b of t.buildings) { tot++; dense += DENSE[b.arch] || 0; }
    const dens = 0.75 + 0.9 * (tot ? dense / tot : 0);
    const tod = this.timeFactor();
    return Math.max(1, Math.min(Math.round((2 + t.pop / 150) * dens * tod), Math.floor(t.roadSet.size * 0.55), 70));
  }
  timeFactor() {
    const env = this.game.env, t = env ? env.timeOfDay : 0.4;
    const day = clamp((t - 0.2) / 0.08, 0, 1) * clamp((0.88 - t) / 0.08, 0, 1);
    return 0.22 + 0.6 * day + 0.45 * (bump(t, 0.33, 0.035) + bump(t, 0.71, 0.045));
  }
  adjustCars() {
    const T = this.game.towns;
    const want = new Map();
    let sum = 0;
    for (const t of T.list) { const n = this.wanted(t); if (n) { want.set(t.id, n); sum += n; } }
    const scale = sum > MAX_CARS ? MAX_CARS / sum : 1;
    const have = new Map();
    for (const c of this.cars) have.set(c.town, (have.get(c.town) || 0) + 1);
    const first = !this._filled;
    this._filled = true;
    for (const t of T.list) {
      const w = Math.floor((want.get(t.id) || 0) * scale), h = have.get(t.id) || 0;
      // a few at a time, except when the world is first populated
      if (w > h) { const n = first ? w - h : Math.min(2, w - h); for (let k = 0; k < n && this.cars.length < MAX_CARS; k++) this.spawn(t); }
      else if (w < h) { let n = first ? h - w : Math.min(2, h - w); for (let i = this.cars.length - 1; i >= 0 && n > 0; i--) if (this.cars[i].town === t.id) { this.despawn(i); n--; } }
    }
  }
  spawn(t) {
    const roads = [...t.roadSet];
    // (somewhere with room: not on top of another vehicle)
    let from = -1, to = -1;
    for (let k = 0; k < 6 && from < 0; k++) {
      const a = roads[Math.floor(this.rand() * roads.length)], b = this.game.towns.nextRoad(t, a, -1);
      const l = this.edges.get(a * 131072 + b);
      if (!l || l.every((m) => m.f > 0.2 + CAR_GAP)) { from = a; to = b; }
    }
    if (from < 0) return;
    const c = { id: this.seq++, town: t.id, from, to, f: this.rand() * 0.2, speed: 1.0 + this.rand() * 0.45, wait: 0, color: CAR_COLORS[Math.floor(this.rand() * CAR_COLORS.length)], slot: this.cars.length };
    this.cars.push(c);
    const k = from * 131072 + to; let l = this.edges.get(k); if (!l) this.edges.set(k, l = []); l.push({ f: c.f, o: c });
    this.carMesh.setColorAt(c.slot, this._c.set(c.color));
    if (this.carMesh.instanceColor) this.carMesh.instanceColor.needsUpdate = true;
  }
  despawn(i) {
    const c = this.cars[i];
    for (const [j, r] of this.res) if (r.k === 'c' + c.id) this.res.delete(j);
    const last = this.cars.pop();
    if (last !== c) { this.cars[i] = last; last.slot = i; this.carMesh.setColorAt(i, this._c.set(last.color)); if (this.carMesh.instanceColor) this.carMesh.instanceColor.needsUpdate = true; }
  }
  townChanged() { this._adj = Math.min(this._adj, 0.2); }
  // a reloaded or new world: start over
  reset() { this.cars = []; this.res.clear(); this._jv = null; this._filled = false; this._adj = 0; this.carMesh.count = 0; }

  // ---------- drawing (only what is in view) ----------
  updateVisuals() {
    const g = this.game, W = g.world, cam = g.camera, S = g.settings || {};
    const cx = cam.target.x, cz = cam.target.z, rr = (cam.viewSize || 30) * 1.7 + 6 * TILE;
    const skip = S.graphics === 'low' ? 2 : 1;
    const R = g.roads;
    let k = 0;
    for (const c of this.cars) {
      const ax = (tx(c.from) + 0.5) * TILE, az = (tz(c.from) + 0.5) * TILE, bx = (tx(c.to) + 0.5) * TILE, bz = (tz(c.to) + 0.5) * TILE;
      const x0 = ax + (bx - ax) * c.f, z0 = az + (bz - az) * c.f;
      if ((c.id % skip) || Math.abs(x0 - cx) > rr || Math.abs(z0 - cz) > rr) { this.carMesh.setMatrixAt(c.slot, this._zero); continue; }
      const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz) || 1;
      const side = R && R.lane[c.from] ? 0.12 : 0.17;
      const x = x0 - dz / len * side, z = z0 + dx / len * side;
      this._p.set(x, heightAt(W, x, z) + 0.05, z);
      this._q.setFromAxisAngle(this._up, Math.atan2(-dz, dx));
      this._s.set(1, 1, 1);
      this._m.compose(this._p, this._q, this._s);
      this.carMesh.setMatrixAt(c.slot, this._m);
      k++;
    }
    this.carMesh.count = this.cars.length;
    this.carMesh.instanceMatrix.needsUpdate = true;
    this.visibleCars = k;
    if (this._lightsDirty) this.drawLights();
  }
  drawLights() {
    this._lightsDirty = false;
    const W = this.game.world;
    let n = 0;
    for (const [i, L] of this.lights) {
      if (n + 2 > this.headMesh.instanceMatrix.count) break;
      const cx = (tx(i) + 0.5) * TILE, cz = (tz(i) + 0.5) * TILE;
      // one post per axis on opposite corners, green for the moving axis
      for (const ax of [0, 1]) {
        const ox = ax ? -0.46 : 0.46, oz = ax ? 0.46 : -0.46;
        this._p.set(cx + ox, heightAt(W, cx + ox, cz + oz), cz + oz);
        this._m.makeTranslation(this._p.x, this._p.y, this._p.z);
        this.postMesh.setMatrixAt(n, this._m); this.headMesh.setMatrixAt(n, this._m);
        this.headMesh.setColorAt(n, this._c.set(L.axis === ax ? 0x3fd06a : 0xe0443a));
        n++;
      }
    }
    this.postMesh.count = this.headMesh.count = n;
    for (const m of [this.postMesh, this.headMesh]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  }
}
void N;
