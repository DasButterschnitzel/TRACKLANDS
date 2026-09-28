// Rail network data model: per-tile 8-direction connections, track tiers,
// construction planning (A*), train routing (Dijkstra over tile+heading states),
// automatic block reservation (per tile lane) and step geometry sampling.
import { N, TILE, DX, DZ, DLEN, opp, turnOf, idx, tx, tz, step, inMap, tileCX, tileCZ, clamp, LAYERS, layerOf, baseTile, onLayer, L_SURFACE, L_SHALLOW, L_DEEP, L_ELEVATED } from '../util.js';
import { TRACK_TIERS } from '../config.js';
import { packYear, unpackYear, rleEncode, rleDecode } from '../world/VisualEra.js';

// the extra cost per tile of a track with a role for a train of a class
// (rows: 0 -, 1 local, 2 express, 3 freight; columns: the track's role)
export const TRACK_ROLES = ['any', 'local', 'express', 'freight'];
const ROLE_COST = [[0, 0, 0, 0], [0, 0, 0.45, 0.5], [0, 0.5, 0, 0.7], [0, 0.4, 0.9, 0]];
export const K_NORMAL = 0, K_BRIDGE = 1, K_TUNNEL = 2, K_UNDER = 3, K_ELEV = 4, K_DEEP = 5;
// how deep each layer runs below the ground (rail height), and how high a viaduct
export const LAYER_DEPTH = [0, 1.7, 3.6, 0];
export const ELEV_HEIGHT = 1.7;

class Heap {
  constructor(cap) { this.k = new Float64Array(cap); this.v = new Int32Array(cap); this.n = 0; }
  clear() { this.n = 0; }
  push(key, val) {
    if (this.n >= this.k.length) { const k2 = new Float64Array(this.k.length * 2); k2.set(this.k); this.k = k2; const v2 = new Int32Array(this.v.length * 2); v2.set(this.v); this.v = v2; }
    let i = this.n++;
    const k = this.k, v = this.v;
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v; const top = v[0];
    const lk = k[--this.n], lv = v[this.n];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1; if (c >= this.n) break;
      if (c + 1 < this.n && k[c + 1] < k[c]) c++;
      if (k[c] >= lk) break;
      k[i] = k[c]; v[i] = v[c]; i = c;
    }
    k[i] = lk; v[i] = lv;
    return top;
  }
}

export class RailNetwork {
  constructor(game) {
    this.game = game;
    this.world = game.world;
    this.conn = new Uint8Array(N * N * LAYERS);
    this.tier = new Uint8Array(N * N * LAYERS);
    this.special = new Map(); // tile -> {type:'station'|'depot', id}
    this.version = 1;
    this.resv = new Int32Array(N * N * LAYERS * 2);
    this.single = new Uint8Array(N * N * LAYERS);        // 1 = single track (one shared lane)
    // who owns a track or station tile: 0 the player, k the k-th rival company
    // (src/world/RailRivals.js). Companies never build on, through or into each
    // other's tiles, so their networks never touch and share no signals.
    this.own = new Uint8Array(N * N * LAYERS);
    // track roles (Phase 11, four-track corridors): 0 any, 1 local, 2 express,
    // 3 freight. A soft preference in routing: a train takes another track
    // when its own is missing or blocked (never a hard rule)
    this.role = new Uint8Array(N * N * LAYERS);
    // the year each tile was built and electrified (Phase 12; packed, 0 =
    // unknown: older saves show the world's start year)
    this.yb = new Uint8Array(N * N * LAYERS);
    this.ey = new Uint8Array(N * N * LAYERS);
    this.signals = new Map();                   // tile*8+dir -> {type:'block'|'path', oneway}
    this.waypoints = new Map();                 // tile -> {id, name}
    this.jres = new Map();                      // junction tile -> Map(trainId -> [a, b])
    this.switches = new Map();                  // junction tile -> {a, b, pa, pb, t}
    this.runId = new Int32Array(N * N * LAYERS).fill(-1);
    this.runDir = new Int8Array(N * N * LAYERS).fill(-1);
    this.runLocks = new Map();                  // runId -> {sense, ids:Set}
    this._runsVersion = -1;
    this.nextWp = 1;
    this.traffic = new Float32Array(N * N * LAYERS);
    this.waitHeat = new Float32Array(N * N * LAYERS);
    this.routeCache = new Map();
    this.cacheVersion = 0;
    this._comp = null; this._compVersion = -1;
    const S = N * N * LAYERS * 9;
    this._g = new Float64Array(S); this._prev = new Int32Array(S); this._seen = new Uint32Array(S); this._stamp = 0;
    this._heap = new Heap(4096);
    this._rg = new Float64Array(N * N * LAYERS * 8); this._rprev = new Int32Array(N * N * LAYERS * 8); this._rseen = new Uint32Array(N * N * LAYERS * 8); this._rstamp = 0;
    // links between layers: tile*8+dir -> the tile on the other layer
    // (portals into a tunnel, ramps onto a viaduct), both ways
    this.links = new Map();
    this.hasLink = new Uint8Array(N * N * LAYERS);
    this.NN = N * N;
    this.precomputeHeights();
  }

  // the next tile of the railway from i in direction d: across a portal or
  // ramp to another layer, else the neighbour on the same layer
  nb(i, d) {
    if (this.hasLink[i]) { const l = this.links.get(i * 8 + d); if (l !== undefined) return l; }
    return step(i, d);
  }
  layer(i) { return layerOf(i); }

  precomputeHeights() {
    const W = this.world;
    this.kindArr = new Uint8Array(N * N * LAYERS);
    this.hArr = new Float32Array(N * N * LAYERS);
    for (let i = 0; i < N * N; i++) {
      const t = W.type[i];
      this.kindArr[i] = t === 1 ? K_BRIDGE : t === 2 ? K_TUNNEL : K_NORMAL;
    }
    for (let i = 0; i < N * N; i++) {
      const k = this.kindArr[i];
      if (k === K_NORMAL) { this.hArr[i] = Math.max(W.tileH[i], 0.22); continue; }
      let s = 0, c = 0, mx = 0;
      for (let d = 0; d < 8; d++) {
        const j = step(i, d); if (j < 0) continue;
        if (W.type[j] === 0) { s += Math.max(W.tileH[j], 0.22); c++; mx = Math.max(mx, W.tileH[j]); }
      }
      if (k === K_BRIDGE) this.hArr[i] = clamp(Math.max(1.15, mx), 1.15, 3.2);
      else this.hArr[i] = c ? s / c : 1.6;
    }
    // smooth tunnel heights through contiguous mountain tiles
    for (let pass = 0; pass < 6; pass++) for (let i = 0; i < N * N; i++) {
      if (this.kindArr[i] !== K_TUNNEL) continue;
      let s = 0, c = 0;
      for (let d = 0; d < 8; d += 2) { const j = step(i, d); if (j >= 0) { s += this.hArr[j]; c++; } }
      if (c) this.hArr[i] = Math.min(this.hArr[i] * 0.5 + (s / c) * 0.5, 3.5);
    }
    this.layerHeights();
  }
  // underground layers run a fixed depth below the ground (below the water on
  // rivers and lakes), viaducts a fixed height above the surface railway
  layerHeights() {
    const W = this.world, NN = N * N;
    for (let i = 0; i < NN; i++) {
      const ground = Math.min(W.tileH[i], this.hArr[i], W.type[i] === 1 ? -0.8 : 9);
      const g0 = W.type[i] === 2 ? Math.min(this.hArr[i], W.tileH[i]) : ground;
      this.hArr[NN + i] = g0 - LAYER_DEPTH[L_SHALLOW];
      this.hArr[2 * NN + i] = Math.min(g0, 0.4) - LAYER_DEPTH[L_DEEP];
      this.kindArr[NN + i] = K_UNDER; this.kindArr[2 * NN + i] = K_DEEP;
      this.hArr[3 * NN + i] = Math.max(this.hArr[i], W.tileH[i], 0.22) + ELEV_HEIGHT;
      this.kindArr[3 * NN + i] = K_ELEV;
    }
    // smooth the shallow layer along the ground so tunnels do not jump
    for (let pass = 0; pass < 3; pass++) for (let i = NN; i < 2 * NN; i++) {
      let s = 0, c = 0;
      for (let d = 0; d < 8; d += 2) { const j = step(i, d); if (j >= 0) { s += this.hArr[j]; c++; } }
      if (c) this.hArr[i] = Math.min(this.hArr[i], this.hArr[i] * 0.5 + (s / c) * 0.5);
    }
    // the deep layer stays below the shallow one everywhere
    for (let i = 0; i < NN; i++) this.hArr[2 * NN + i] = Math.min(this.hArr[2 * NN + i], this.hArr[NN + i] - 1.4);
    this.h0 = this.hArr.slice();
  }

  kind(i) { return this.kindArr[i]; }
  railH(i) { return this.hArr[i]; }
  has(i) { return this.conn[i] !== 0; }
  degree(i) { let c = 0, m = this.conn[i]; while (m) { c += m & 1; m >>= 1; } return c; }
  hasDir(i, d) { return (this.conn[i] >> d) & 1; }
  bumpVersion() { this.version++; this.routeCache.clear(); }

  // ---------- geometry ----------
  edgePoint(i, d, out) {
    const j = this.nb(i, d);
    const h = j >= 0 ? (this.hArr[i] + this.hArr[j]) / 2 : this.hArr[i];
    out.x = tileCX(i) + DX[d] * TILE / 2; out.y = h; out.z = tileCZ(i) + DZ[d] * TILE / 2;
    return out;
  }
  // Sample a traversal of tile i entering with heading inH (null = from center)
  // and leaving with heading outH (null = stop at center). Pushes points into
  // xs/ys/zs (skipping the first point when skipFirst). Returns index offset of center.
  sampleStep(i, inH, outH, xs, ys, zs, skipFirst) {
    const cx = tileCX(i), cz = tileCZ(i), cy = this.hArr[i];
    const p0 = inH == null ? { x: cx, y: cy, z: cz } : this.edgePoint(i, opp(inH), {});
    const p2 = outH == null ? { x: cx, y: cy, z: cz } : this.edgePoint(i, outH, {});
    let segs, curve;
    if (inH == null || outH == null) { segs = 3; curve = false; }
    else if (inH === outH) { segs = 4; curve = false; }
    else { segs = 8; curve = true; }
    let centerIdx = -1;
    for (let k = skipFirst ? 1 : 0; k <= segs; k++) {
      const t = k / segs;
      let x, y, z;
      if (!curve) { x = p0.x + (p2.x - p0.x) * t; y = p0.y + (p2.y - p0.y) * t; z = p0.z + (p2.z - p0.z) * t; }
      else {
        const a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t;
        x = a * p0.x + b * cx + c * p2.x; y = a * p0.y + b * cy + c * p2.y; z = a * p0.z + b * cz + c * p2.z;
      }
      xs.push(x); ys.push(y); zs.push(z);
    }
    if (inH == null) centerIdx = 0; else if (outH == null) centerIdx = segs; else centerIdx = segs / 2;
    return { segs, centerIdx };
  }

  // Valid through-routes on a tile: pairs of connections with angle >= 90°
  tilePairs(i) {
    const m = this.conn[i];
    const res = [];
    const dirs = [];
    for (let d = 0; d < 8; d++) if ((m >> d) & 1) dirs.push(d);
    const paired = new Set();
    for (let a = 0; a < dirs.length; a++) for (let b = a + 1; b < dirs.length; b++) {
      if (turnOf(opp(dirs[a]), dirs[b]) <= 2) { res.push([dirs[a], dirs[b]]); paired.add(dirs[a]); paired.add(dirs[b]); }
    }
    const stubs = dirs.filter((d) => !paired.has(d));
    return { pairs: res, stubs, dirs };
  }

  // ---------- graph validation ----------
  // The directed rail graph must be consistent: every connection has its
  // reverse on the neighbour and points inside the map; station platforms sit
  // on track; signals face a connection. Returns a list of {kind, tile, dir};
  // empty when the graph is sound. With notes, also lists 'sharp' ends: arms
  // that no other arm of their tile continues (two track ends sharing a tile
  // at an angle, e.g. after a junction's third arm was removed) - valid, but
  // worth showing to the player.
  validateGraph(max = 50, notes = false) {
    const out = [];
    const add = (kind, tile, dir = null) => { if (out.length < max) out.push({ kind, tile, dir }); };
    for (let i = 0; i < N * N * LAYERS; i++) {
      const m = this.conn[i];
      if (!m) continue;
      let n = 0;
      for (let d = 0; d < 8; d++) {
        if (!((m >> d) & 1)) continue;
        n++;
        const j = this.nb(i, d);
        if (j < 0) { add('outside', i, d); continue; }
        if (!((this.conn[j] >> opp(d)) & 1)) add('oneway', i, d);
        // a link must be answered by its partner, and never joins a layer to itself
        if (this.hasLink[i] && this.links.has(i * 8 + d) && (layerOf(j) === layerOf(i) || this.links.get(j * 8 + opp(d)) !== i)) add('bad_link', i, d);
        // two layers only ever meet through a link
        if (layerOf(j) !== layerOf(i) && !(this.hasLink[i] && this.links.has(i * 8 + d))) add('layer_leak', i, d);
      }
      // (a station or depot tile may end tracks at an angle: trains stop there and reverse)
      if (notes && n >= 2 && !this.special.has(i)) { const { stubs } = this.tilePairs(i); for (const d of stubs) add('sharp', i, d); }
    }
    for (const [t, sp] of this.special) {
      if (sp.type === 'station' && !this.conn[t] && this.game.stations.byId(sp.id) && this.game.stations.byId(sp.id).tracks.some((tk) => tk.tiles.length > 1)) add('station_off_track', t);
    }
    for (const key of this.signals.keys()) { const t = Math.floor(key / 8), d = key % 8; if (!((this.conn[t] >> d) & 1)) add('signal_no_track', t, d); }
    return out;
  }

  // ---------- buildability ----------
  isUnlocked(i) { return this.game.progression.regionUnlocked(this.world.region[baseTile(i)]); }
  // the company acting now (a rival while its planner builds), as an owner index
  actorIdx() { const a = this.game.actor; return a ? a.idx : 0; }
  // a track/station tile that belongs to another company
  foreign(i) { return (this.conn[i] !== 0 || this.special.has(i)) && this.own[i] !== this.actorIdx(); }
  tileBlockedReason(i) {
    if (i < 0) return 'err_out_of_map';
    if (!this.isUnlocked(i)) return 'err_locked_region';
    if (this.foreign(i)) return 'err_not_yours';
    const L = layerOf(i);
    // underground: nothing on the surface is in the way; the shallow layer
    // cannot pass under the sea or a lake (only the deep one can), and never
    // under a station's box on the other underground layer
    if (L === L_SHALLOW || L === L_DEEP) {
      const b0 = baseTile(i);
      if (L === L_SHALLOW && this.world.type[b0] === 1) return 'err_tunnel_water';
      const other = onLayer(b0, L === L_SHALLOW ? L_DEEP : L_SHALLOW), so = this.special.get(other);
      if (so && so.type === 'station') return 'err_under_station';
      return null;
    }
    // viaducts pass over roads, track and water but not over buildings or works
    const b = this.game.occupancy.blocked[baseTile(i)];
    if (b === 1) return 'err_town_building';
    if (b === 2) return 'err_industry';
    if (b === 3) return 'err_occupied';   // docks and airports
    return null;
  }

  // ---------- construction planning ----------
  planConstruction(a, b, tierId) {
    const res = { ok: false, tiles: [], dirs: [], cost: 0, bridges: 0, tunnels: 0, newTiles: 0, reason: null, invalid: [] };
    if (a < 0 || b < 0) { res.reason = 'err_out_of_map'; return res; }
    const ra = this.tileBlockedReason(a), rb = this.tileBlockedReason(b);
    if (ra) { res.reason = ra; res.invalid.push(a); res.tiles = [a]; return res; }
    if (rb) { res.reason = rb; res.invalid.push(b); res.tiles = [a, b]; return res; }
    if (a === b) { res.reason = 'err_drag_track'; res.tiles = [a]; return res; }
    const sa = this.special.get(a), sb = this.special.get(b);
    const path = this.astar(a, b);
    if (!path) { res.reason = 'err_no_path'; res.tiles = [a, b]; res.invalid.push(b); return res; }
    res.tiles = path.tiles; res.dirs = path.dirs;
    // depot rules
    if (sa && sa.type === 'depot' && this.conn[a] && !this.hasDir(a, path.dirs[0])) { res.reason = 'err_depot_connected'; res.invalid.push(a); return res; }
    if (sb && sb.type === 'depot' && this.conn[b] && !this.hasDir(b, opp(path.dirs[path.dirs.length - 1]))) { res.reason = 'err_depot_connected'; res.invalid.push(b); return res; }
    let total = 0, prevBridge = false, prevTunnel = false;
    for (let k = 0; k < res.tiles.length; k++) {
      const i = res.tiles[k];
      const kd = this.kindArr[i];
      const q = this.trackTileCost(i, tierId, kd);
      total += q.cost;
      if (q.fresh) res.newTiles++;
      if (kd === K_BRIDGE && q.fresh) { if (!prevBridge) res.bridges++; }
      if (kd === K_TUNNEL && q.fresh) { if (!prevTunnel) res.tunnels++; }
      prevBridge = kd === K_BRIDGE; prevTunnel = kd === K_TUNNEL;
    }
    res.cost = Math.round(total);
    res.ok = true;
    return res;
  }

  // A drag on another layer (Phase 11): the surface tiles aS -> bS are
  // mapped onto layer L and routed there. Where the tile above (or below)
  // an end already carries a track end, the new line joins it through a
  // portal or ramp: that end's own tile is replaced by the upper tile,
  // linked to the second tile of the route. Returns a plan like
  // planConstruction with plan.links = [{i, d, L}].
  planLayered(aS, bS, tierId, L) {
    const res = { ok: false, tiles: [], dirs: [], cost: 0, bridges: 0, tunnels: 0, newTiles: 0, reason: null, invalid: [], links: [], layer: L };
    if (aS < 0 || bS < 0) { res.reason = 'err_out_of_map'; return res; }
    if (L === L_SURFACE) return this.planConstruction(aS, bS, tierId);
    const up = L === L_DEEP ? L_SHALLOW : L_SURFACE;
    const A = onLayer(aS, L), B = onLayer(bS, L);
    // a track end on the level above (below for a viaduct) joins through a portal
    const joins = (t) => { const u = onLayer(t, up); return this.conn[u] && this.degree(u) === 1 && !this.special.has(u) && !this.hasLink[u] ? u : -1; };
    const ua = joins(aS), ub = joins(bS);
    const base = this.planConstruction(A, B, tierId);
    if (!base.ok) return Object.assign(res, base, { links: [], layer: L });
    let tiles = base.tiles.slice(), dirs = base.dirs.slice();
    const links = [];
    if (ua >= 0 && tiles.length >= 3) {
      const d0 = dirs[0];
      // the portal leaves the upper track end straight on (its existing leg is behind it)
      if (!this.hasDir(ua, opp(d0))) { res.reason = 'err_portal_angle'; res.invalid.push(aS); res.tiles = tiles; return res; }
      const err = this.canLink(ua, d0, L);
      if (err) { res.reason = err; res.invalid.push(aS); res.tiles = tiles; return res; }
      tiles = [ua, ...tiles.slice(1)]; links.push({ i: ua, d: d0, L });
    }
    if (ub >= 0 && tiles.length >= 3) {
      const n = tiles.length, dl = dirs[dirs.length - 1];
      if (!this.hasDir(ub, dl)) { res.reason = 'err_portal_angle'; res.invalid.push(bS); res.tiles = tiles; return res; }
      const err = this.canLink(ub, opp(dl), L);
      if (err) { res.reason = err; res.invalid.push(bS); res.tiles = tiles; return res; }
      tiles = [...tiles.slice(0, n - 1), ub]; links.push({ i: ub, d: opp(dl), L });
    }
    // cost: the layer's track, plus each portal
    const cost = this.game.economy.costs;
    let total = 0, newTiles = 0;
    for (const t of tiles) {
      if (layerOf(t) !== L) continue;
      const q = this.trackTileCost(t, tierId);
      total += q.cost;
      if (q.fresh) newTiles++;
    }
    total += links.length * cost.portal(L);
    Object.assign(res, { ok: true, tiles, dirs, links, cost: Math.round(total), newTiles, tunnels: L === L_ELEVATED ? 0 : 1, bridges: L === L_ELEVATED ? 1 : 0 });
    return res;
  }

  // a straight run exactly from a to b (blueprints: the track goes where the
  // pattern says, not where the path finder would prefer); bridges and
  // tunnels where the ground needs them. Not straight or diagonal: the
  // ordinary planner.
  planStraight(a, b, tierId) {
    const res = { ok: false, tiles: [a], dirs: [], cost: 0, bridges: 0, tunnels: 0, newTiles: 0, reason: null, invalid: [], straight: true };
    if (a < 0 || b < 0) { res.reason = 'err_out_of_map'; return res; }
    if (a === b) { res.reason = 'err_drag_track'; return res; }
    const dx = tx(b) - tx(a), dz = tz(b) - tz(a);
    if (layerOf(a) !== layerOf(b) || (dx && dz && Math.abs(dx) !== Math.abs(dz))) return this.planConstruction(a, b, tierId);
    const d = dirOf(Math.sign(dx), Math.sign(dz));
    const ra = this.tileBlockedReason(a);
    if (ra) { res.reason = ra; res.invalid.push(a); return res; }
    let i = a, guard = 0;
    while (i !== b && guard++ < 400) {
      const j = this.nb(i, d);
      if (j < 0) { res.reason = 'err_out_of_map'; return res; }
      if (!this.passable(j, j === b)) { res.reason = this.tileBlockedReason(j) || 'err_occupied'; res.invalid.push(j); res.tiles.push(j); return res; }
      // (no diagonal through a crossing diagonal)
      if (d & 1) { const x = tx(i), z = tz(i), i1 = i - baseTile(i) + idx(x + DX[d], z); if (this.hasDir(i1, dirOf(-DX[d], DZ[d])) && !this.hasDir(i, d)) { res.reason = 'err_occupied'; res.invalid.push(j); return res; } }
      res.dirs.push(d); res.tiles.push(j); i = j;
    }
    let total = 0, prevBridge = false, prevTunnel = false;
    for (const t of res.tiles) {
      const kd = this.kindArr[t], q = this.trackTileCost(t, tierId, kd);
      total += q.cost;
      if (q.fresh) res.newTiles++;
      if (kd === K_BRIDGE && q.fresh && !prevBridge) res.bridges++;
      if (kd === K_TUNNEL && q.fresh && !prevTunnel) res.tunnels++;
      prevBridge = kd === K_BRIDGE; prevTunnel = kd === K_TUNNEL;
    }
    res.cost = Math.round(total);
    res.ok = true;
    return res;
  }

  passable(i, isEnd) {
    if (i < 0) return false;
    if (this.tileBlockedReason(i)) return false;
    // a rival laying a new line keeps it separate from existing track (lines
    // meet at stations only), so its network stays readable
    if (this.game.aiNewLine && !isEnd && (this.conn[i] || this.special.has(i))) return false;
    const s = this.special.get(i);
    if (s && s.type === 'depot' && !isEnd) return false;
    return true;
  }

  astar(a, b) {
    const stamp = ++this._stamp;
    const g = this._g, prev = this._prev, seen = this._seen, heap = this._heap;
    heap.clear();
    const bx = tx(b), bz = tz(b);
    const hfun = (i) => { const dx = Math.abs(tx(i) - bx), dz = Math.abs(tz(i) - bz); return (Math.max(dx, dz) + 0.414 * Math.min(dx, dz)) * 0.35; };
    const pushS = (s, cost, from) => {
      if (seen[s] === stamp && g[s] <= cost) return;
      seen[s] = stamp; g[s] = cost; prev[s] = from;
      heap.push(cost + hfun((s / 9) | 0), s);
    };
    const sa = this.special.get(a);
    const aDepot = sa && sa.type === 'depot';
    if (this.conn[a] && !aDepot) {
      for (let d = 0; d < 8; d++) if (this.hasDir(a, d)) pushS(a * 9 + opp(d), 0, -1);
      pushS(a * 9 + 8, 2.5, -1);
    } else pushS(a * 9 + 8, 0, -1);
    const closed = new Uint8Array(0); void closed;
    let found = -1, iter = 0;
    while (heap.n > 0 && iter++ < 60000) {
      const s = heap.pop();
      const i = (s / 9) | 0, h = s % 9;
      const gs = g[s];
      if (i === b) { found = s; break; }
      const sd = this.special.get(i);
      const isDepot = sd && sd.type === 'depot';
      if (isDepot && i !== a) continue;
      for (let d = 0; d < 8; d++) {
        if (h !== 8 && turnOf(h, d) > 2) continue;
        if (isDepot && this.conn[i] && !this.hasDir(i, d)) continue;
        const j = this.nb(i, d);
        if (j < 0) continue;
        const isEnd = j === b;
        if (!this.passable(j, isEnd)) continue;
        const sj = this.special.get(j);
        if (sj && sj.type === 'depot' && this.conn[j] && !this.hasDir(j, opp(d))) continue;
        // diagonal crossing check
        if (d & 1) {
          const x = tx(i), z = tz(i);
          const L0 = i - baseTile(i);
          const i1 = L0 + idx(x + DX[d], z), i2 = L0 + idx(x, z + DZ[d]);
          const cross = dirOf(-DX[d], DZ[d]);
          if (this.hasDir(i1, cross) && !(this.hasDir(i, d))) continue;
          void i2;
        }
        let c = DLEN[d];
        const existing = this.hasDir(i, d);
        if (existing) c *= 0.3;
        else {
          const kd = this.kindArr[j];
          if (kd === K_BRIDGE) c += 3.5; else if (kd === K_TUNNEL) c += 6;
          if (this.conn[j] && !isEnd) c += 0.6; // prefer not to create extra junctions
          c += Math.abs(this.hArr[j] - this.hArr[i]) * 1.2;
        }
        if (h !== 8) { const t = turnOf(h, d); c += t === 1 ? 0.25 : t === 2 ? 1.1 : 0; }
        if (isEnd && this.conn[j] && !(sj && sj.type === 'depot')) {
          let okc = false;
          for (let e = 0; e < 8; e++) if (this.hasDir(j, e) && e !== opp(d) && turnOf(d, e) <= 2) okc = true;
          if (!okc && !this.hasDir(j, opp(d))) c += 2.5;
        }
        pushS(j * 9 + d, gs + c, s);
      }
    }
    if (found < 0) return null;
    const states = [];
    for (let s = found; s !== -1; s = prev[s]) states.push(s);
    states.reverse();
    const tiles = states.map((s) => (s / 9) | 0);
    const dirs = [];
    for (let k = 1; k < states.length; k++) dirs.push(states[k] % 9);
    return { tiles, dirs };
  }

  // ---------- mutations ----------
  connect(i, d) {
    const j = this.nb(i, d);
    if (j < 0) return;
    const a = this.actorIdx();
    if (!this.conn[i] && !this.special.has(i)) this.own[i] = a;
    if (!this.conn[j] && !this.special.has(j)) this.own[j] = a;
    this.conn[i] |= 1 << d;
    this.conn[j] |= 1 << opp(d);
  }
  disconnectTile(i) {
    const m = this.conn[i];
    for (let d = 0; d < 8; d++) if ((m >> d) & 1) { const j = this.nb(i, d); if (j >= 0) { this.conn[j] &= ~(1 << opp(d)); this.signals.delete(j * 8 + opp(d)); if (!this.conn[j]) { this.tier[j] = 0; this.single[j] = 0; this.waypoints.delete(j); } } }
    this.conn[i] = 0;
    this.tier[i] = 0;
    this.single[i] = 0;
    if (!this.special.has(i)) this.own[i] = 0;
    for (let d = 0; d < 8; d++) { const j = this.nb(i, d); if (j >= 0 && !this.conn[j] && !this.special.has(j)) this.own[j] = 0; }
    for (let d = 0; d < 8; d++) this.signals.delete(i * 8 + d);
    this.waypoints.delete(i);
    // a portal or ramp goes with its track
    if (this.hasLink[i]) for (let d = 0; d < 8; d++) { const l = this.links.get(i * 8 + d); if (l !== undefined) this.unlink(i, d); }
  }

  // ---------- layers: portals and ramps ----------
  // A link joins tile i (direction d) to the tile over or under its neighbour
  // on another layer: a tunnel portal (surface -> shallow), a shaft ramp
  // (shallow -> deep) or a viaduct ramp (surface -> elevated). The tile on
  // the upper side becomes a ramp: its rail height is halfway, so no train
  // ever jumps a level on one tile.
  linkTarget(i, d, L) { const j = step(i, d); return j < 0 ? -1 : onLayer(j, L); }
  // which layers a link may join: surface-tunnel, tunnel-deep tunnel, surface-viaduct
  canLinkLayers(a, b) {
    const k = a < b ? `${a}${b}` : `${b}${a}`;
    return k === `${L_SURFACE}${L_SHALLOW}` || k === `${L_SHALLOW}${L_DEEP}` || k === `${L_SURFACE}${L_ELEVATED}`;
  }
  canLink(i, d, L) {
    const Li = layerOf(i);
    if (L === Li || L < 0 || L >= LAYERS || !this.canLinkLayers(Li, L)) return 'err_bad_layer';
    const j = this.linkTarget(i, d, L);
    if (j < 0) return 'err_out_of_map';
    // a ramp tile carries one straight track only (no junction, no station)
    if (this.special.has(i) || this.degree(i) > 1 || (this.conn[i] && !this.hasDir(i, opp(d)))) return 'err_ramp_tile';
    if (this.special.has(j) || this.degree(j) > 1 || (this.conn[j] && !this.hasDir(j, d))) return 'err_ramp_tile';
    if (this.hasLink[i] || this.hasLink[j]) return 'err_ramp_tile';
    // a portal needs open ground on the surface side (no water)
    if (Li === L_SURFACE && this.world.type[baseTile(i)] === 1) return 'err_tunnel_water';
    return this.tileBlockedReason(i) || this.tileBlockedReason(j);
  }
  link(i, d, L) {
    const j = this.linkTarget(i, d, L);
    if (j < 0) return false;
    this.links.set(i * 8 + d, j); this.links.set(j * 8 + opp(d), i);
    this.hasLink[i] = 1; this.hasLink[j] = 1;
    const a = this.actorIdx();
    if (!this.conn[i] && !this.special.has(i)) this.own[i] = a;
    if (!this.conn[j] && !this.special.has(j)) this.own[j] = a;
    this.conn[i] |= 1 << d; this.conn[j] |= 1 << opp(d);
    this.rampHeights(i, j);
    return true;
  }
  // the upper tile of a link sits halfway between the two levels
  rampHeights(i, j) {
    const up = this.h0[i] >= this.h0[j] ? i : j, dn = up === i ? j : i;
    if (layerOf(up) === L_ELEVATED || layerOf(dn) === L_ELEVATED) { const lo = layerOf(up) === L_ELEVATED ? dn : up; this.hArr[lo] = (this.h0[lo] + this.h0[lo === up ? dn : up]) / 2; return; }
    this.hArr[up] = (this.h0[up] + this.h0[dn]) / 2;
  }
  unlink(i, d) {
    const j = this.links.get(i * 8 + d);
    if (j === undefined) return;
    this.links.delete(i * 8 + d); this.links.delete(j * 8 + opp(d));
    this.conn[i] &= ~(1 << d); this.conn[j] &= ~(1 << opp(d));
    for (const t of [i, j]) {
      let any = false;
      for (let e = 0; e < 8; e++) if (this.links.has(t * 8 + e)) any = true;
      if (!any) { this.hasLink[t] = 0; this.hArr[t] = this.h0[t]; }
    }
  }
  // the link a tile carries: {d, to} or null
  linkOf(i) { if (!this.hasLink[i]) return null; for (let d = 0; d < 8; d++) { const l = this.links.get(i * 8 + d); if (l !== undefined) return { d, to: l }; } return null; }

  // ---------- routing ----------
  // start: {tile, heading, fromCenter}. fromCenter: head at the tile center with `heading` (may be null)
  // If !fromCenter, state = head entering `tile` with `heading`.
  findRoute(start, target, opts = {}) {
    const minTier = opts.minTier || 0;
    const avoid = opts.avoid || null;
    const rev = !!opts.allowReverse;
    const th = opts.targetHeading == null ? -1 : opts.targetHeading;
    const cls = opts.cls | 0;
    const key = !avoid ? `${start.tile},${start.heading},${start.fromCenter ? 1 : 0},${target},${minTier},${rev ? 1 : 0},${th},${opts.stopStations ? 1 : 0},${cls}` : null;
    if (key && this.routeCache.has(key)) return this.routeCache.get(key);
    const res = this._route(start, target, minTier, avoid, rev, th, cls);
    if (key) { if (this.routeCache.size > 3000) this.routeCache.clear(); this.routeCache.set(key, res); }
    return res;
  }

  _enterOk(j, minTier, target) {
    if (!this.conn[j]) return false;
    if (minTier && this.tier[j] < minTier) return false;
    const s = this.special.get(j);
    if (s && s.type === 'depot' && j !== target) return false;
    return true;
  }

  // one-way signals forbid leaving a tile against their direction
  exitAllowed(i, d) {
    const sg = this.onewayAt.get(i);
    return sg == null || sg === d;
  }
  get onewayAt() {
    if (this._owV !== this.version) {
      this._ow = new Map();
      for (const [k, sg] of this.signals) if (sg.oneway) this._ow.set(k >> 3, k & 7);
      this._owV = this.version;
    }
    return this._ow;
  }

  _route(start, target, minTier, avoid, allowRev, th = -1, cls = 0) {
    const stamp = ++this._rstamp;
    const g = this._rg, prev = this._rprev, seen = this._rseen, heap = this._heap;
    heap.clear();
    const push = (s, cost, from) => {
      if (seen[s] === stamp && g[s] <= cost) return;
      seen[s] = stamp; g[s] = cost; prev[s] = from; heap.push(cost, s);
    };
    const tierSpeed = (i) => TRACK_TIERS[this.tier[i]].speed;
    const stepCost = (i, hin, d) => {
      let c = DLEN[d] * Math.sqrt(80 / tierSpeed(i));
      if (hin != null && hin !== 8) { const t = turnOf(hin, d); if (t === 3) c += 5; else if (t === 2) c += 0.35; else if (t === 1) c += 0.08; }
      if (avoid && avoid.has(i)) c += 12;
      // prefer bypass tracks over occupied platforms when passing through stations
      const sp = this.special.get(i);
      if (sp && sp.type === 'station' && i !== target) c += sp.role === 'through' ? -0.2 : 1.2;
      if (this.single[i]) c += 0.15;
      if (cls && this.role[i]) c += ROLE_COST[cls][this.role[i]];
      return c;
    };
    // initial expansion
    const si = start.tile;
    if (start.fromCenter) {
      if (si === target) return { steps: [], length: 0 };
      for (let d = 0; d < 8; d++) {
        if (!this.hasDir(si, d)) continue;
        if (start.heading != null && turnOf(start.heading, d) > 3) continue;
        if (!this.exitAllowed(si, d)) continue;
        const j = this.nb(si, d);
        if (j < 0 || !this._enterOk(j, minTier, target)) continue;
        push(j * 8 + d, stepCost(si, start.heading, d) * 0.5, -2 - d);
      }
    } else {
      if (si < 0 || !this._enterOk(si, minTier, target)) return null;
      push(si * 8 + start.heading, 0, -1);
    }
    let found = -1, iter = 0;
    while (heap.n > 0 && iter++ < 80000) {
      const s = heap.pop();
      const gs = g[s];
      if (gs > g[s] + 1e-9) continue;
      const i = s >> 3, h = s & 7;
      if (i === target && (th < 0 || h === th)) { found = s; break; }
      const m = this.conn[i];
      for (let d = 0; d < 8; d++) {
        if (!((m >> d) & 1)) continue;
        if (turnOf(h, d) > 3) continue;
        if (!this.exitAllowed(i, d)) continue;
        const j = this.nb(i, d);
        if (j < 0 || !this._enterOk(j, minTier, target)) continue;
        push(j * 8 + d, gs + stepCost(i, h, d), s);
      }
      // shunting: stop at this tile's center, reverse and continue the other way
      if (allowRev && !this.onewayAt.has(i)) push(i * 8 + opp(h), gs + 10, s);
    }
    if (found < 0) return null;
    let states = [];
    let s = found, firstOut = null;
    for (;;) {
      states.push(s);
      const p = prev[s];
      if (p === -1) break;
      if (p <= -2) { firstOut = -2 - p; break; }
      s = p;
    }
    states.reverse();
    let reverse = false;
    for (let k = 1; k < states.length; k++) {
      if ((states[k] >> 3) === (states[k - 1] >> 3)) { states = states.slice(0, k); reverse = true; break; }
    }
    const steps = [];
    for (let k = 0; k < states.length; k++) {
      const i = states[k] >> 3, h = states[k] & 7;
      const outH = k + 1 < states.length ? (states[k + 1] & 7) : null;
      steps.push({ tile: i, inH: h, outH });
    }
    // choose a smooth continuation at the final tile for nicer geometry
    const last = steps[steps.length - 1];
    last.outH = this.smoothExit(last.tile, last.inH);
    return { steps, length: g[found], firstOut, reverse };
  }

  smoothExit(tile, inH) {
    let best = null, bt = 9;
    for (let d = 0; d < 8; d++) if (this.hasDir(tile, d) && turnOf(inH, d) <= 3 && turnOf(inH, d) < bt) { bt = turnOf(inH, d); best = d; }
    return best;
  }

  components() {
    if (this._compVersion === this.version && this._comp) return this._comp;
    const comp = new Int32Array(N * N * LAYERS).fill(-1);
    let c = 0;
    const q = new Int32Array(N * N * LAYERS);
    for (let i = 0; i < N * N * LAYERS; i++) {
      if (!this.conn[i] || comp[i] >= 0) continue;
      let qh = 0, qt = 0; q[qt++] = i; comp[i] = c;
      while (qh < qt) {
        const u = q[qh++], m = this.conn[u];
        for (let d = 0; d < 8; d++) if ((m >> d) & 1) { const v = this.nb(u, d); if (v >= 0 && comp[v] < 0 && this.conn[v]) { comp[v] = c; q[qt++] = v; } }
      }
      c++;
    }
    this._comp = comp; this._compVersion = this.version;
    return comp;
  }
  connected(a, b) { const c = this.components(); return c[a] >= 0 && c[a] === c[b]; }

  // ---------- reservations ----------
  // Keys: >= 0 index into resv (tile*2 + lane sense). Junction steps use a
  // negative path key (see jkey) checked for compatibility against other paths.
  isJunction(i) { const sp = this.special.get(i); return this.degree(i) >= 3 && !(sp && sp.type === 'station'); }
  laneKeys(stepObj) {
    const keys = this._laneKeys(stepObj);
    // fouling points: a diagonal leg passes a tile corner that neighbouring
    // tracks also run close to; reserve those neighbours as well
    const i = stepObj.tile;
    for (const leg of [stepObj.inH == null ? null : opp(stepObj.inH), stepObj.outH]) {
      if (leg == null || !(leg & 1)) continue;
      for (const o of [(leg + 7) & 7, (leg + 1) & 7]) {
        const r = step(i, o);
        if (r < 0 || !this.conn[r]) continue;
        const c = dirOf(DX[leg] - DX[o], DZ[leg] - DZ[o]);
        if (!(this.hasDir(r, c) || this.hasDir(r, (c + 1) & 7) || this.hasDir(r, (c + 7) & 7))) continue;
        if (this.isJunction(r)) keys.push(-(1 + r * 81 + 8 * 9 + 8));
        else keys.push(r * 2, r * 2 + 1);
      }
    }
    return keys;
  }
  _laneKeys(stepObj) {
    const i = stepObj.tile;
    const sp = this.special.get(i);
    const a = stepObj.inH == null ? 8 : opp(stepObj.inH);
    const b = stepObj.outH == null ? 8 : stepObj.outH;
    // any tile with 3+ legs (plain junction or a platform tile with a switch) uses path keys
    if (this.degree(i) >= 3) return [-(1 + i * 81 + a * 9 + b)];
    if (this.single[i] && !(sp && sp.type === 'station')) return [i * 2];
    let sense;
    if (a !== 8 && b !== 8) sense = a < b ? 0 : 1;
    else if (a !== 8) sense = 0; else sense = 1;
    return [i * 2 + sense];
  }
  static decodeJ(k) { const v = -k - 1; return { tile: Math.floor(v / 81), a: Math.floor(v / 9) % 9, b: v % 9 }; }
  // two paths through a junction can coexist only when they use the same pair
  // of legs in opposite directions (double track: each on its own lane)
  pathsCompatible(p, q) {
    if (p[0] === 8 || p[1] === 8 || q[0] === 8 || q[1] === 8) return false;
    return p[0] === q[1] && p[1] === q[0];
  }
  _jOk(k, id) {
    const { tile, a, b } = RailNetwork.decodeJ(k);
    const m = this.jres.get(tile);
    if (!m) return true;
    for (const [tid, paths] of m) {
      if (tid === id) continue;
      for (const p of paths) if (!this.pathsCompatible(p, [a, b])) return false;
    }
    return true;
  }
  canReserve(keys, id) {
    for (const k of keys) {
      if (k < 0) { if (!this._jOk(k, id)) return false; continue; }
      const r = this.resv[k]; if (r !== 0 && r !== id) return false;
    }
    return true;
  }
  reserve(keys, id) {
    for (const k of keys) {
      if (k >= 0) { this.resv[k] = id; continue; }
      const { tile, a, b } = RailNetwork.decodeJ(k);
      let m = this.jres.get(tile);
      if (!m) { m = new Map(); this.jres.set(tile, m); }
      const list = m.get(id) || [];
      if (!list.some((p) => p[0] === a && p[1] === b)) list.push([a, b]);
      m.set(id, list);
      if (a !== 8 && b !== 8 && this.isJunction(tile)) this.setSwitch(tile, a, b);
    }
  }
  release(keys, id) {
    for (const k of keys) {
      if (k >= 0) { if (this.resv[k] === id) this.resv[k] = 0; continue; }
      const { tile, a, b } = RailNetwork.decodeJ(k);
      const m = this.jres.get(tile);
      if (!m) continue;
      const list = m.get(id);
      if (!list) continue;
      const nl = list.filter((p) => !(p[0] === a && p[1] === b));
      if (nl.length) m.set(id, nl); else m.delete(id);
      if (!m.size) this.jres.delete(tile);
    }
  }
  holder(keys, id) {
    for (const k of keys) {
      if (k < 0) {
        const { tile, a, b } = RailNetwork.decodeJ(k);
        const m = this.jres.get(tile);
        if (m) for (const [tid, paths] of m) if (tid !== id && paths.some((p) => !this.pathsCompatible(p, [a, b]))) return tid;
        continue;
      }
      const r = this.resv[k]; if (r !== 0 && r !== id) return r;
    }
    return 0;
  }
  holds(k, id) {
    if (k >= 0) return this.resv[k] === id;
    const { tile, a, b } = RailNetwork.decodeJ(k);
    const m = this.jres.get(tile);
    const l = m && m.get(id);
    return !!(l && l.some((p) => p[0] === a && p[1] === b));
  }
  keyHolder(k) {
    if (k >= 0) return this.resv[k];
    const { tile } = RailNetwork.decodeJ(k);
    const m = this.jres.get(tile);
    if (m) for (const tid of m.keys()) return tid;
    return 0;
  }
  // holder of any lane on a tile (for overlays)
  tileHolder(i) {
    if (this.resv[i * 2]) return this.resv[i * 2];
    if (this.resv[i * 2 + 1]) return this.resv[i * 2 + 1];
    const m = this.jres.get(i);
    if (m) for (const tid of m.keys()) return tid;
    return 0;
  }
  clearReservations() { this.resv.fill(0); this.jres.clear(); this.runLocks.clear(); }

  // ---------- switches (animated blades, locked while a path is reserved) ----------
  setSwitch(tile, a, b) {
    const key = a < b ? [a, b] : [b, a];
    let sw = this.switches.get(tile);
    if (!sw) { sw = { a: key[0], b: key[1], pa: key[0], pb: key[1], t: 1 }; this.switches.set(tile, sw); return; }
    if (sw.a === key[0] && sw.b === key[1]) return;
    sw.pa = sw.a; sw.pb = sw.b; sw.a = key[0]; sw.b = key[1]; sw.t = 0;
    const g = this.game;
    if (g.audio && g.camera) { const v = g.near({ x: tileCX(tile), z: tileCZ(tile) }); if (v > 0.4) g.audio.play('switch', { vol: v * 0.6 }); }
  }
  switchReady(tile, a, b) {
    const sw = this.switches.get(tile);
    if (!sw) return true;
    const key = a < b ? [a, b] : [b, a];
    return sw.t >= 1 && sw.a === key[0] && sw.b === key[1];
  }
  switchTime() { return 0.7 * (1 + (this.game.progression.fx.switchTime || 0)); }
  tickSwitches(dt) {
    const T = this.switchTime();
    for (const [tile, sw] of this.switches) {
      if (!this.isJunction(tile)) { this.switches.delete(tile); continue; }
      if (sw.t < 1) sw.t = Math.min(1, sw.t + dt / T);
    }
  }

  // ---------- single-track runs (direction locks) ----------
  computeRuns() {
    if (this._runsVersion === this.version) return;
    this._runsVersion = this.version;
    this.runId.fill(-1); this.runDir.fill(-1);
    const isRun = (i) => i >= 0 && this.conn[i] && this.single[i] && !this.isJunction(i) && !this.special.has(i);
    let rid = 0;
    for (let i = 0; i < N * N * LAYERS; i++) {
      if (!isRun(i) || this.runId[i] >= 0) continue;
      // walk to one end of the chain
      let start = i, prevT = -1, guard = 0;
      for (;;) {
        let nxt = -1;
        for (let d = 0; d < 8; d++) if (this.hasDir(start, d)) { const j = this.nb(start, d); if (j !== prevT && isRun(j) && j !== i) { nxt = j; break; } }
        if (nxt < 0 || guard++ > N * N * LAYERS) break;
        prevT = start; start = nxt;
        if (start === i) break;
      }
      // walk forward assigning ids and forward direction
      let cur = start, prev = -1; guard = 0;
      while (cur >= 0 && this.runId[cur] < 0 && guard++ < N * N * LAYERS) {
        this.runId[cur] = rid;
        let fwd = -1, nextT = -1;
        // continue along the chain (unassigned run neighbour first), else any exit away from prev
        for (let d = 0; d < 8; d++) {
          if (!this.hasDir(cur, d)) continue;
          const j = this.nb(cur, d);
          if (j !== prev && isRun(j) && this.runId[j] < 0) { fwd = d; nextT = j; break; }
        }
        if (fwd < 0) for (let d = 0; d < 8; d++) if (this.hasDir(cur, d) && this.nb(cur, d) !== prev) { fwd = d; break; }
        if (fwd < 0) for (let d = 0; d < 8; d++) if (this.hasDir(cur, d) && this.nb(cur, d) === prev) fwd = opp(d);
        this.runDir[cur] = fwd;
        prev = cur; cur = nextT;
      }
      rid++;
    }
    this.runLocks.clear();
  }
  // tiles of a single-track run in order along the track
  runTiles(rid) {
    const set = [];
    for (let i = 0; i < N * N * LAYERS; i++) if (this.runId[i] === rid) set.push(i);
    if (set.length < 2) return set;
    const inRun = new Set(set);
    const nb = (i) => { const o = []; for (let d = 0; d < 8; d++) if (this.hasDir(i, d)) { const j = this.nb(i, d); if (inRun.has(j)) o.push(j); } return o; };
    let start = set.find((i) => nb(i).length <= 1);
    if (start == null) start = set[0];
    const out = [], seen = new Set();
    for (let cur = start; cur != null && !seen.has(cur);) { out.push(cur); seen.add(cur); cur = nb(cur).find((j) => !seen.has(j)); }
    for (const i of set) if (!seen.has(i)) out.push(i);
    return out;
  }
  runSense(stepObj) {
    const f = this.runDir[stepObj.tile];
    if (stepObj.outH != null) return stepObj.outH === f ? 0 : 1;
    if (stepObj.inH != null) return opp(stepObj.inH) === f ? 1 : 0;
    return 0;
  }
  runLockOk(rid, sense, id) {
    const L = this.runLocks.get(rid);
    if (!L || !L.ids.size) return true;
    if (L.sense === sense) return true;
    return L.ids.size === 1 && L.ids.has(id);
  }
  runLockAdd(rid, sense, id) {
    let L = this.runLocks.get(rid);
    if (!L || !L.ids.size || (L.ids.size === 1 && L.ids.has(id))) { L = { sense, ids: new Set() }; this.runLocks.set(rid, L); }
    if (L.sense !== sense && !(L.ids.size === 1 && L.ids.has(id))) { this.runConflicts = (this.runConflicts || 0) + 1; }
    L.ids.add(id);
  }
  runLockDrop(rid, id) {
    const L = this.runLocks.get(rid);
    if (L) { L.ids.delete(id); if (!L.ids.size) this.runLocks.delete(rid); }
  }

  // ---------- signal sections (block display) ----------
  // Track split at signals, junctions and stations. Returns an Int32Array:
  // section id per tile, -2 junction, -3 station, -1 no track.
  sections() {
    if (this._secVersion === this.version && this._sec) return this._sec;
    const sec = new Int32Array(N * N * LAYERS).fill(-1);
    const parent = new Int32Array(N * N * LAYERS);
    for (let i = 0; i < N * N * LAYERS; i++) parent[i] = i;
    const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    const plain = (i) => this.conn[i] && !this.isJunction(i) && !this.special.has(i);
    for (let i = 0; i < N * N * LAYERS; i++) {
      if (!plain(i)) continue;
      for (let d = 0; d < 4; d++) {
        if (!this.hasDir(i, d)) continue;
        const j = this.nb(i, d);
        if (j < 0 || !plain(j)) continue;
        if (this.signals.has(i * 8 + d) || this.signals.has(j * 8 + opp(d))) continue;
        const a = find(i), b = find(j);
        if (a !== b) parent[a] = b;
      }
    }
    for (let i = 0; i < N * N * LAYERS; i++) {
      if (!this.conn[i]) continue;
      sec[i] = this.special.has(i) ? -3 : this.isJunction(i) ? -2 : find(i);
    }
    this._sec = sec; this._secVersion = this.version;
    return sec;
  }

  // ---------- signals ----------
  signalAt(tile, dir) { return dir == null ? null : this.signals.get(tile * 8 + dir) || null; }
  canPlaceSignal(tile, dir) {
    if (this.foreign(tile)) return 'err_not_yours';
    if (!this.conn[tile] || !this.hasDir(tile, dir)) return 'err_signal_no_track';
    if (this.isJunction(tile)) return 'err_signal_junction';
    if (this.special.has(tile)) return 'err_signal_station';
    return null;
  }

  // ---------- construction price (Phase 12: one source for build and plan) ----------
  // the price of track on a tile: new track, or the upgrade to a better tier.
  // Every estimate and every build prices track through here. A project quote
  // (Plans.quote) marks the tiles its earlier steps lay as already there
  // (virt: tile → tier), so a station planned over planned track is priced
  // as it will be built.
  trackTileCost(i, tierId, kd = this.kindArr[i]) {
    const cost = this.game.economy.costs;
    const vt = this.virt ? this.virt.get(i) : undefined;
    if (!this.conn[i] && vt === undefined) return { cost: cost.trackTile(tierId, kd), fresh: true };
    const cur = this.conn[i] ? Math.max(this.tier[i], vt ?? -1) : vt;
    return { cost: cur < tierId ? cost.trackTile(tierId, K_NORMAL) - cost.trackTile(cur, K_NORMAL) : 0, fresh: false };
  }
  hasTrack(i) { return this.conn[i] !== 0 || (!!this.virt && this.virt.has(i)); }

  // ---------- track roles ----------
  roleOf(i) { return this.conn[i] ? this.role[i] : 0; }
  setRole(i, r) { if (!this.conn[i] || r < 0 || r > 3) return false; if (this.role[i] === r) return false; this.role[i] = r; this.routeCache.clear(); this.bumpVersion(); return true; }
  // years a tile was built / electrified (Phase 12 visual eras)
  yearBuilt(i, fallback) { return unpackYear(this.yb[i]) || fallback; }
  yearElectrified(i, fallback) { return unpackYear(this.ey[i]) || unpackYear(this.yb[i]) || fallback; }
  markBuilt(i, year, electrified) {
    if (!this.yb[i]) this.yb[i] = packYear(year);
    if (electrified && !this.ey[i]) this.ey[i] = packYear(year);
  }
  yearsOut() {
    let any = false;
    for (let i = 0; i < this.yb.length; i++) {
      if (!this.conn[i] && !this.special.has(i)) { this.yb[i] = 0; this.ey[i] = 0; continue; }
      if (this.yb[i] || this.ey[i]) any = true;
    }
    return any ? { b: rleEncode(this.yb), e: rleEncode(this.ey) } : undefined;
  }
  rolesB64() {
    let any = false;
    for (let i = 0; i < this.role.length; i++) if (this.role[i]) { if (!this.conn[i]) this.role[i] = 0; else any = true; }
    return any ? b64(this.role) : undefined;
  }

  // ---------- serialization ----------
  serialize() {
    const NN = N * N, sub = (a) => a.subarray(0, NN);
    // the other layers (tunnels, viaducts) only when something was built there
    const up = this.conn.subarray(NN).some((x) => x);
    const ly = up ? { conn: b64(this.conn.subarray(NN)), tier: b64(this.tier.subarray(NN)), single: b64(this.single.subarray(NN)), own: b64(this.own.subarray(NN)) } : undefined;
    const links = [];
    for (const [k, j] of this.links) { const i = k >> 3; if (i < j) links.push([i, k & 7, j]); }
    return {
      conn: b64(sub(this.conn)), tier: b64(sub(this.tier)), single: b64(sub(this.single)), own: sub(this.own).some((x) => x) ? b64(sub(this.own)) : undefined,
      ly, links: links.length ? links : undefined, roles: this.rolesB64(), years: this.yearsOut(),
      signals: [...this.signals].map(([k, v]) => (v.y ? [k, v.type, v.oneway ? 1 : 0, v.y] : [k, v.type, v.oneway ? 1 : 0])),
      waypoints: [...this.waypoints].map(([t, w]) => [t, w.id, w.name]), nextWp: this.nextWp,
    };
  }
  deserialize(d) {
    if (!d) return;
    const NN = N * N, ALL = NN * LAYERS;
    const c = unb64(d.conn), t = unb64(d.tier);
    if (c.length === NN) this.conn.set(c);
    if (t.length === NN) this.tier.set(t);
    this.own.fill(0);
    if (typeof d.single === 'string' && d.single) { const sg = unb64(d.single); if (sg.length === NN) this.single.set(sg); }
    if (typeof d.own === 'string' && d.own) { const ow = unb64(d.own); if (ow.length === NN) for (let i = 0; i < NN; i++) this.own[i] = ow[i] <= 8 ? ow[i] : 0; }
    // the other layers (Phase 11; older saves have none: everything on the surface)
    const L = d.ly && typeof d.ly === 'object' ? d.ly : null;
    if (L) {
      const set = (arr, str, clampTo) => { if (typeof str !== 'string') return; const u = unb64(str); if (u.length !== ALL - NN) return; for (let k = 0; k < u.length; k++) arr[NN + k] = clampTo != null && u[k] > clampTo ? 0 : u[k]; };
      set(this.conn, L.conn); set(this.tier, L.tier, 3); set(this.single, L.single, 1); set(this.own, L.own, 8);
    }
    this.yb.fill(0); this.ey.fill(0);
    if (d.years && typeof d.years === 'object') for (const [k, arr] of [['b', this.yb], ['e', this.ey]]) { if (!rleDecode(d.years[k], arr)) arr.fill(0); }
    for (let k = 0; k < ALL; k++) if (!this.conn[k] && !this.special.has(k)) { this.yb[k] = 0; this.ey[k] = 0; }
    this.role.fill(0);
    if (typeof d.roles === 'string' && d.roles) { const u = unb64(d.roles); if (u.length === ALL) for (let k = 0; k < ALL; k++) this.role[k] = u[k] <= 3 && this.conn[k] ? u[k] : 0; }
    if (Array.isArray(d.links)) for (const e of d.links) {
      if (!Array.isArray(e)) continue;
      const [i, dd, j] = e;
      if (!Number.isInteger(i) || !Number.isInteger(j) || !Number.isInteger(dd) || dd < 0 || dd > 7 || i < 0 || j < 0 || i >= ALL || j >= ALL) continue;
      const Lj = layerOf(j);
      if (Lj === layerOf(i) || this.linkTarget(i, dd, Lj) !== j || this.links.has(i * 8 + dd) || this.links.has(j * 8 + opp(dd))) continue;
      if (this.canLinkLayers(layerOf(i), Lj)) this.link(i, dd, Lj);
    }
    // sanitize: connections must be reciprocal, in the map, and cross layers only at links
    for (let i = 0; i < ALL; i++) {
      if (!this.conn[i]) continue;
      for (let dd = 0; dd < 8; dd++) if (this.hasDir(i, dd)) {
        const j = this.nb(i, dd);
        if (j < 0 || !this.hasDir(j, opp(dd))) this.conn[i] &= ~(1 << dd);
      }
      if (this.tier[i] > 3) this.tier[i] = 0;
    }
    for (const [k, j] of [...this.links]) { const i = k >> 3, dd = k & 7; if (!this.hasDir(i, dd) || !this.hasDir(j, opp(dd))) this.unlink(i, dd); }
    for (let i = 0; i < ALL; i++) if (!this.conn[i]) this.single[i] = 0; else if (this.single[i] > 1) this.single[i] = 1;
    if (Array.isArray(d.signals)) for (const e of d.signals) {
      if (!Array.isArray(e)) continue;
      const [k, type, ow, y] = e;
      if (typeof k !== 'number' || (type !== 'block' && type !== 'path')) continue;
      if (!this.hasDir(k >> 3, k & 7)) continue;
      // (the year it was put up decides semaphore or colour light; older saves have none)
      this.signals.set(k, Number.isInteger(y) && y >= 1700 && y <= 2300 ? { type, oneway: !!ow, y } : { type, oneway: !!ow });
    }
    if (Array.isArray(d.waypoints)) for (const e of d.waypoints) {
      if (!Array.isArray(e) || !this.conn[e[0]]) continue;
      this.waypoints.set(e[0], { id: e[1] | 0, name: String(e[2] || 'Waypoint') });
      this.nextWp = Math.max(this.nextWp, (e[1] | 0) + 1);
    }
    if (d.nextWp) this.nextWp = Math.max(this.nextWp, d.nextWp | 0);
    this.bumpVersion();
  }
}

function dirOf(dx, dz) { for (let d = 0; d < 8; d++) if (DX[d] === dx && DZ[d] === dz) return d; return 0; }

export function b64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
export function unb64(str) {
  try {
    const s = atob(str); const u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return u;
  } catch (e) { return new Uint8Array(0); }
}
export { inMap };
