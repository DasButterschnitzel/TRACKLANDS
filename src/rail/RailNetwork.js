// Rail network data model: per-tile 8-direction connections, track tiers,
// construction planning (A*), train routing (Dijkstra over tile+heading states),
// automatic block reservation (per tile lane) and step geometry sampling.
import { N, TILE, DX, DZ, DLEN, opp, turnOf, idx, tx, tz, step, inMap, tileCX, tileCZ, clamp } from '../util.js';
import { TRACK_TIERS } from '../config.js';

export const K_NORMAL = 0, K_BRIDGE = 1, K_TUNNEL = 2;

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
    this.conn = new Uint8Array(N * N);
    this.tier = new Uint8Array(N * N);
    this.special = new Map(); // tile -> {type:'station'|'depot', id}
    this.version = 1;
    this.resv = new Int32Array(N * N * 2);
    this.traffic = new Float32Array(N * N);
    this.routeCache = new Map();
    this.cacheVersion = 0;
    this._comp = null; this._compVersion = -1;
    const S = N * N * 9;
    this._g = new Float64Array(S); this._prev = new Int32Array(S); this._seen = new Uint32Array(S); this._stamp = 0;
    this._heap = new Heap(4096);
    this._rg = new Float64Array(N * N * 8); this._rprev = new Int32Array(N * N * 8); this._rseen = new Uint32Array(N * N * 8); this._rstamp = 0;
    this.precomputeHeights();
  }

  precomputeHeights() {
    const W = this.world;
    this.kindArr = new Uint8Array(N * N);
    this.hArr = new Float32Array(N * N);
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
  }

  kind(i) { return this.kindArr[i]; }
  railH(i) { return this.hArr[i]; }
  has(i) { return this.conn[i] !== 0; }
  degree(i) { let c = 0, m = this.conn[i]; while (m) { c += m & 1; m >>= 1; } return c; }
  hasDir(i, d) { return (this.conn[i] >> d) & 1; }
  bumpVersion() { this.version++; this.routeCache.clear(); }

  // ---------- geometry ----------
  edgePoint(i, d, out) {
    const j = step(i, d);
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

  // ---------- buildability ----------
  isUnlocked(i) { return this.game.progression.regionUnlocked(this.world.region[i]); }
  tileBlockedReason(i) {
    if (i < 0) return 'err_out_of_map';
    if (!this.isUnlocked(i)) return 'err_locked_region';
    const b = this.game.occupancy.blocked[i];
    if (b === 1) return 'err_town_building';
    if (b === 2) return 'err_industry';
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
    const cost = this.game.economy.costs;
    let total = 0, prevBridge = false, prevTunnel = false;
    for (let k = 0; k < res.tiles.length; k++) {
      const i = res.tiles[k];
      const kd = this.kindArr[i];
      const has = this.conn[i] !== 0 || this.special.has(i);
      const curTier = this.conn[i] ? this.tier[i] : -1;
      if (!this.conn[i]) {
        res.newTiles++;
        total += cost.trackTile(tierId, kd);
      } else if (curTier < tierId) {
        total += cost.trackTile(tierId, K_NORMAL) - cost.trackTile(curTier, K_NORMAL);
      }
      if (kd === K_BRIDGE && !this.conn[i]) { if (!prevBridge) res.bridges++; }
      if (kd === K_TUNNEL && !this.conn[i]) { if (!prevTunnel) res.tunnels++; }
      prevBridge = kd === K_BRIDGE; prevTunnel = kd === K_TUNNEL;
      void has;
    }
    res.cost = Math.round(total);
    res.ok = true;
    return res;
  }

  passable(i, isEnd) {
    if (i < 0) return false;
    if (this.tileBlockedReason(i)) return false;
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
        const j = step(i, d);
        if (j < 0) continue;
        const isEnd = j === b;
        if (!this.passable(j, isEnd)) continue;
        const sj = this.special.get(j);
        if (sj && sj.type === 'depot' && this.conn[j] && !this.hasDir(j, opp(d))) continue;
        // diagonal crossing check
        if (d & 1) {
          const x = tx(i), z = tz(i);
          const i1 = idx(x + DX[d], z), i2 = idx(x, z + DZ[d]);
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
    const j = step(i, d);
    if (j < 0) return;
    this.conn[i] |= 1 << d;
    this.conn[j] |= 1 << opp(d);
  }
  disconnectTile(i) {
    const m = this.conn[i];
    for (let d = 0; d < 8; d++) if ((m >> d) & 1) { const j = step(i, d); if (j >= 0) { this.conn[j] &= ~(1 << opp(d)); if (!this.conn[j]) this.tier[j] = 0; } }
    this.conn[i] = 0;
    this.tier[i] = 0;
  }

  // ---------- routing ----------
  // start: {tile, heading, fromCenter}. fromCenter: head at the tile center with `heading` (may be null)
  // If !fromCenter, state = head entering `tile` with `heading`.
  findRoute(start, target, opts = {}) {
    const minTier = opts.minTier || 0;
    const avoid = opts.avoid || null;
    const rev = !!opts.allowReverse;
    const key = !avoid ? `${start.tile},${start.heading},${start.fromCenter ? 1 : 0},${target},${minTier},${rev ? 1 : 0}` : null;
    if (key && this.routeCache.has(key)) return this.routeCache.get(key);
    const res = this._route(start, target, minTier, avoid, rev);
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

  _route(start, target, minTier, avoid, allowRev) {
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
      return c;
    };
    // initial expansion
    const si = start.tile;
    if (start.fromCenter) {
      if (si === target) return { steps: [], length: 0 };
      for (let d = 0; d < 8; d++) {
        if (!this.hasDir(si, d)) continue;
        if (start.heading != null && turnOf(start.heading, d) > 3) continue;
        const j = step(si, d);
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
      if (i === target) { found = s; break; }
      const m = this.conn[i];
      for (let d = 0; d < 8; d++) {
        if (!((m >> d) & 1)) continue;
        if (turnOf(h, d) > 3) continue;
        const j = step(i, d);
        if (j < 0 || !this._enterOk(j, minTier, target)) continue;
        push(j * 8 + d, gs + stepCost(i, h, d), s);
      }
      // shunting: stop at this tile's center, reverse and continue the other way
      if (allowRev) push(i * 8 + opp(h), gs + 10, s);
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
    let best = null, bt = 9;
    for (let d = 0; d < 8; d++) if (this.hasDir(last.tile, d) && turnOf(last.inH, d) <= 3 && turnOf(last.inH, d) < bt) { bt = turnOf(last.inH, d); best = d; }
    last.outH = best;
    return { steps, length: g[found], firstOut, reverse };
  }

  components() {
    if (this._compVersion === this.version && this._comp) return this._comp;
    const comp = new Int32Array(N * N).fill(-1);
    let c = 0;
    const q = new Int32Array(N * N);
    for (let i = 0; i < N * N; i++) {
      if (!this.conn[i] || comp[i] >= 0) continue;
      let qh = 0, qt = 0; q[qt++] = i; comp[i] = c;
      while (qh < qt) {
        const u = q[qh++], m = this.conn[u];
        for (let d = 0; d < 8; d++) if ((m >> d) & 1) { const v = step(u, d); if (v >= 0 && comp[v] < 0 && this.conn[v]) { comp[v] = c; q[qt++] = v; } }
      }
      c++;
    }
    this._comp = comp; this._compVersion = this.version;
    return comp;
  }
  connected(a, b) { const c = this.components(); return c[a] >= 0 && c[a] === c[b]; }

  // ---------- reservations ----------
  laneKeys(stepObj) {
    const i = stepObj.tile;
    const sp = this.special.get(i);
    // junctions are exclusive; station platforms keep one lane per direction
    if (this.degree(i) >= 3 && !(sp && sp.type === 'station')) return [i * 2, i * 2 + 1];
    const a = stepObj.inH == null ? null : opp(stepObj.inH);
    const b = stepObj.outH;
    if (sp && sp.type === 'station' && a != null && b != null && this.degree(i) >= 3) return [i * 2 + ((stepObj.inH & 7) < 4 ? 0 : 1)];
    let sense;
    if (a != null && b != null) sense = a < b ? 0 : 1;
    else if (a != null) sense = 0; else sense = 1;
    return [i * 2 + sense];
  }
  canReserve(keys, id) { for (const k of keys) { const r = this.resv[k]; if (r !== 0 && r !== id) return false; } return true; }
  reserve(keys, id) { for (const k of keys) this.resv[k] = id; }
  release(keys, id) { for (const k of keys) if (this.resv[k] === id) this.resv[k] = 0; }
  holder(keys, id) { for (const k of keys) { const r = this.resv[k]; if (r !== 0 && r !== id) return r; } return 0; }

  // ---------- serialization ----------
  serialize() {
    return { conn: b64(this.conn), tier: b64(this.tier) };
  }
  deserialize(d) {
    if (!d) return;
    const c = unb64(d.conn), t = unb64(d.tier);
    if (c.length === N * N) this.conn.set(c);
    if (t.length === N * N) this.tier.set(t);
    // sanitize: connections must be reciprocal and in-map
    for (let i = 0; i < N * N; i++) {
      for (let dd = 0; dd < 8; dd++) if (this.hasDir(i, dd)) {
        const j = step(i, dd);
        if (j < 0 || !this.hasDir(j, opp(dd))) this.conn[i] &= ~(1 << dd);
      }
      if (this.tier[i] > 3) this.tier[i] = 0;
    }
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
