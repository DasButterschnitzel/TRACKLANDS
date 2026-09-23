// Chunked procedural rail geometry: double track with ballast, sleepers, rails,
// bridges, tunnel portals, electrification and high speed details. Rebuilds only
// dirty chunks. New track pieces animate into place.
import * as THREE from 'three';
import { N, TILE, DX, DZ, step, tx, tz, idx, tileCX, tileCZ, opp } from '../util.js';
import { K_BRIDGE, K_TUNNEL } from './RailNetwork.js';

const CH = 16;
const LANE = 0.34;
const _c = new THREE.Color();

const TIER_STYLE = [
  { ballast: 0x8d8279, sleeper: 0x6b4a33, rail: 0xa8adb3, bridge: 0x7a5a3f },
  { ballast: 0x7d7a78, sleeper: 0x9a968e, rail: 0xb8bdc3, bridge: 0x6a7078 },
  { ballast: 0x7a7876, sleeper: 0xa09c94, rail: 0xc0c5ca, bridge: 0x5f6870 },
  { ballast: 0xc4c2bc, sleeper: 0xd8d6d0, rail: 0xd0d5da, bridge: 0xd8d4cc },
];

class GeoBuf {
  constructor() { this.p = []; this.c = []; this.d = null; }
  tri(a, b, c, col, delay) {
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    _c.set(col);
    for (let i = 0; i < 3; i++) this.c.push(_c.r, _c.g, _c.b);
    if (this.d) this.d.push(delay, delay, delay);
  }
  quad(a, b, c, d, col, delay = 0) { this.tri(a, b, c, col, delay); this.tri(a, c, d, col, delay); }
  box(cx, cy, cz, hx, hy, hz, yaw, col, delay = 0) {
    const cs = Math.cos(yaw), sn = Math.sin(yaw);
    const P = (x, y, z) => [cx + x * cs + z * sn, cy + y, cz - x * sn + z * cs];
    const v = [P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, hy, -hz), P(-hx, hy, -hz), P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz)];
    this.quad(v[3], v[7], v[6], v[2], col, delay); // top
    this.quad(v[4], v[5], v[6], v[7], col, delay); // +z
    this.quad(v[1], v[0], v[3], v[2], col, delay); // -z
    this.quad(v[5], v[1], v[2], v[6], col, delay); // +x
    this.quad(v[0], v[4], v[7], v[3], col, delay); // -x
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    if (this.d) g.setAttribute('aDelay', new THREE.Float32BufferAttribute(this.d, 1));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

export class RailRenderer {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
    this.chunks = new Map();
    this.dirty = new Set();
    this.animTiles = new Set();
    this.anims = [];
    this.heat = null; this.heatOn = false; this._heatT = 0;
    this.animMat = this.mat.clone();
    this.animMat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = { value: 0 };
      this.animMat.userData.shader = sh;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aDelay;\nuniform float uTime;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nfloat k = clamp((uTime - aDelay) / 0.35, 0.0, 1.0);\nfloat e = 1.0 - pow(1.0 - k, 3.0);\ntransformed.y += (1.0 - e) * 1.6;');
    };
  }

  markDirty(tile) { if (tile >= 0) this.dirty.add(((tz(tile) / CH) | 0) * 100 + ((tx(tile) / CH) | 0)); }
  markAll() { for (let cz = 0; cz < N / CH; cz++) for (let cx = 0; cx < N / CH; cx++) this.dirty.add(cz * 100 + cx); }

  update(dt) {
    if (this.dirty.size) {
      for (const key of this.dirty) this.rebuildChunk(key);
      this.dirty.clear();
    }
    if (this.anims.length) {
      for (const a of this.anims) {
        a.t += dt;
        const sh = this.animMat.userData.shader;
        if (sh) sh.uniforms.uTime.value = a.t;
      }
      const done = this.anims.filter((a) => a.t > a.dur);
      for (const a of done) {
        this.group.remove(a.mesh); a.mesh.geometry.dispose();
        for (const t of a.tiles) { this.animTiles.delete(t); this.markDirty(t); }
      }
      if (done.length) this.anims = this.anims.filter((a) => a.t <= a.dur);
    }
    if (this.heatOn) {
      this._heatT -= dt;
      if (this._heatT <= 0) { this._heatT = 1.5; this.buildHeat(); }
    }
  }

  rebuildChunk(key) {
    const cz = Math.floor(key / 100), cx = key % 100;
    const old = this.chunks.get(key);
    if (old) { this.group.remove(old); old.geometry.dispose(); this.chunks.delete(key); }
    const gb = new GeoBuf();
    const net = this.game.net;
    for (let z = cz * CH; z < cz * CH + CH; z++) for (let x = cx * CH; x < cx * CH + CH; x++) {
      const i = idx(x, z);
      if (!net.conn[i] || this.animTiles.has(i)) continue;
      this.tileGeometry(gb, i, 0);
    }
    if (!gb.p.length) return;
    const mesh = new THREE.Mesh(gb.build(), this.mat);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    this.chunks.set(key, mesh);
    this.group.add(mesh);
  }

  animateBuild(tiles) {
    const net = this.game.net;
    const gb = new GeoBuf();
    gb.d = [];
    const list = tiles.filter((t) => net.conn[t]);
    list.forEach((t, k) => { this.tileGeometry(gb, t, k * 0.035); this.animTiles.add(t); });
    // neighbors of animated tiles keep their old look until done; rebuild their chunks now
    for (const t of list) this.markDirty(t);
    if (!gb.p.length) return;
    const mesh = new THREE.Mesh(gb.build(), this.animMat);
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    const reduced = this.game.settings.reducedMotion;
    this.anims.push({ mesh, tiles: list, t: reduced ? 99 : 0, dur: reduced ? 0 : list.length * 0.035 + 0.45 });
  }

  // centerline samples for a curve through tile i between connection dirs a and b (null = center)
  curve(i, a, b) {
    const net = this.game.net;
    const cx = tileCX(i), cz = tileCZ(i), cy = net.railH(i);
    const P0 = a == null ? [cx, cy, cz] : edge(net, i, a);
    const P2 = b == null ? [cx, cy, cz] : edge(net, i, b);
    const straight = a == null || b == null || opp(a) === b;
    const n = straight ? 2 : 8;
    const pts = [];
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      if (straight) pts.push([P0[0] + (P2[0] - P0[0]) * t, P0[1] + (P2[1] - P0[1]) * t, P0[2] + (P2[2] - P0[2]) * t]);
      else {
        const A = (1 - t) * (1 - t), B = 2 * (1 - t) * t, C = t * t;
        pts.push([A * P0[0] + B * cx + C * P2[0], A * P0[1] + B * cy + C * P2[1], A * P0[2] + B * cz + C * P2[2]]);
      }
    }
    // tangents/normals
    const out = [];
    for (let k = 0; k < pts.length; k++) {
      const p = pts[Math.max(0, k - 1)], q = pts[Math.min(pts.length - 1, k + 1)];
      let tx_ = q[0] - p[0], tz_ = q[2] - p[2];
      const l = Math.hypot(tx_, tz_) || 1; tx_ /= l; tz_ /= l;
      out.push({ x: pts[k][0], y: pts[k][1], z: pts[k][2], tx: tx_, tz: tz_, nx: -tz_, nz: tx_ });
    }
    return out;
  }

  tileGeometry(gb, i, delay) {
    const net = this.game.net;
    const kind = net.kind(i);
    const tier = net.tier[i];
    const S = TIER_STYLE[tier];
    const { pairs, stubs } = net.tilePairs(i);
    const curves = pairs.map(([a, b]) => this.curve(i, a, b));
    for (const s of stubs) curves.push(this.curve(i, s, null));
    if (kind === K_TUNNEL) {
      // portals where the tunnel meets open ground
      for (let d = 0; d < 8; d++) {
        if (!net.hasDir(i, d)) continue;
        const j = step(i, d);
        if (j >= 0 && net.kind(j) === K_TUNNEL) continue;
        const e = edge(net, i, d);
        const yaw = Math.atan2(-DZ[d], DX[d]);
        this.portal(gb, e[0] - DX[d] * 0.15, e[1], e[2] - DZ[d] * 0.15, yaw, delay);
      }
      return;
    }
    const bridge = kind === K_BRIDGE;
    for (const cv of curves) {
      // ballast or bridge deck
      for (let k = 0; k < cv.length - 1; k++) {
        const p = cv[k], q = cv[k + 1];
        if (bridge) {
          const w = 0.78, y0 = p.y - 0.02, y1 = q.y - 0.02, th = 0.22;
          const L0 = [p.x + p.nx * w, y0, p.z + p.nz * w], R0 = [p.x - p.nx * w, y0, p.z - p.nz * w];
          const L1 = [q.x + q.nx * w, y1, q.z + q.nz * w], R1 = [q.x - q.nx * w, y1, q.z - q.nz * w];
          gb.quad(R0, R1, L1, L0, S.bridge, delay);
          gb.quad([L0[0], y0 - th, L0[2]], L0, L1, [L1[0], y1 - th, L1[2]], shadeHex(S.bridge, 0.8), delay);
          gb.quad(R0, [R0[0], y0 - th, R0[2]], [R1[0], y1 - th, R1[2]], R1, shadeHex(S.bridge, 0.8), delay);
          // railings
          const rh = 0.28;
          for (const sgn of [1, -1]) {
            const a0 = [p.x + p.nx * w * sgn, y0, p.z + p.nz * w * sgn], a1 = [q.x + q.nx * w * sgn, y1, q.z + q.nz * w * sgn];
            gb.quad(a0, a1, [a1[0], y1 + rh, a1[2]], [a0[0], y0 + rh, a0[2]], tier >= 1 ? 0x5a6068 : 0x6b4a33, delay);
            gb.quad(a1, a0, [a0[0], y0 + rh, a0[2]], [a1[0], y1 + rh, a1[2]], tier >= 1 ? 0x5a6068 : 0x6b4a33, delay);
          }
        } else {
          const wt = tier === 3 ? 0.7 : 0.62, wb = 0.8, y0 = p.y + 0.08, y1 = q.y + 0.08, yb0 = p.y - 0.1, yb1 = q.y - 0.1;
          const col = S.ballast;
          const Lt0 = [p.x + p.nx * wt, y0, p.z + p.nz * wt], Rt0 = [p.x - p.nx * wt, y0, p.z - p.nz * wt];
          const Lt1 = [q.x + q.nx * wt, y1, q.z + q.nz * wt], Rt1 = [q.x - q.nx * wt, y1, q.z - q.nz * wt];
          const Lb0 = [p.x + p.nx * wb, yb0, p.z + p.nz * wb], Rb0 = [p.x - p.nx * wb, yb0, p.z - p.nz * wb];
          const Lb1 = [q.x + q.nx * wb, yb1, q.z + q.nz * wb], Rb1 = [q.x - q.nx * wb, yb1, q.z - q.nz * wb];
          gb.quad(Rt0, Rt1, Lt1, Lt0, col, delay);
          gb.quad(Lt0, Lt1, Lb1, Lb0, shadeHex(col, 0.85), delay);
          gb.quad(Rb0, Rb1, Rt1, Rt0, shadeHex(col, 0.85), delay);
          if (tier === 3) {
            for (const sgn of [1, -1]) {
              const a0 = [p.x + p.nx * 0.74 * sgn, y0, p.z + p.nz * 0.74 * sgn], a1 = [q.x + q.nx * 0.74 * sgn, y1, q.z + q.nz * 0.74 * sgn];
              gb.quad(a0, a1, [a1[0], y1 + 0.16, a1[2]], [a0[0], y0 + 0.16, a0[2]], 0xe8e6e0, delay);
              gb.quad(a1, a0, [a0[0], y0 + 0.16, a0[2]], [a1[0], y1 + 0.16, a1[2]], 0xe8e6e0, delay);
            }
          }
        }
      }
      // sleepers and rails for both lanes
      const top = bridge ? 0.0 : 0.08;
      for (const lane of [LANE, -LANE]) {
        let acc = 0.15;
        for (let k = 0; k < cv.length - 1; k++) {
          const p = cv[k], q = cv[k + 1];
          const seg = Math.hypot(q.x - p.x, q.z - p.z);
          while (acc < seg) {
            const f = acc / seg;
            const x = p.x + (q.x - p.x) * f + p.nx * lane, z = p.z + (q.z - p.z) * f + p.nz * lane, y = p.y + (q.y - p.y) * f + top + 0.02;
            gb.box(x, y, z, 0.05, 0.022, 0.25, Math.atan2(-p.tz, p.tx), tier === 3 ? S.sleeper : S.sleeper, delay);
            acc += tier === 3 ? 0.36 : 0.3;
          }
          acc -= seg;
        }
        for (const r of [0.12, -0.12]) {
          const off = lane + r;
          for (let k = 0; k < cv.length - 1; k++) {
            const p = cv[k], q = cv[k + 1];
            const a0 = [p.x + p.nx * (off - 0.022), p.y + top + 0.09, p.z + p.nz * (off - 0.022)];
            const b0 = [p.x + p.nx * (off + 0.022), p.y + top + 0.09, p.z + p.nz * (off + 0.022)];
            const a1 = [q.x + q.nx * (off - 0.022), q.y + top + 0.09, q.z + q.nz * (off - 0.022)];
            const b1 = [q.x + q.nx * (off + 0.022), q.y + top + 0.09, q.z + q.nz * (off + 0.022)];
            gb.quad(a0, a1, b1, b0, S.rail, delay);
            const lo = -0.05;
            gb.quad([b0[0], b0[1] + lo, b0[2]], b0, b1, [b1[0], b1[1] + lo, b1[2]], 0x6a6e74, delay);
            gb.quad(a0, [a0[0], a0[1] + lo, a0[2]], [a1[0], a1[1] + lo, a1[2]], a1, 0x6a6e74, delay);
          }
        }
      }
      // overhead line for electric / high speed
      if (tier >= 2) {
        for (const lane of [LANE, -LANE]) {
          for (let k = 0; k < cv.length - 1; k++) {
            const p = cv[k], q = cv[k + 1];
            const h = 1.32;
            const a0 = [p.x + p.nx * (lane - 0.012), p.y + h, p.z + p.nz * (lane - 0.012)], b0 = [p.x + p.nx * (lane + 0.012), p.y + h, p.z + p.nz * (lane + 0.012)];
            const a1 = [q.x + q.nx * (lane - 0.012), q.y + h, q.z + q.nz * (lane - 0.012)], b1 = [q.x + q.nx * (lane + 0.012), q.y + h, q.z + q.nz * (lane + 0.012)];
            gb.quad(a0, a1, b1, b0, 0x3a3d42, delay);
            gb.quad(b0, b1, a1, a0, 0x3a3d42, delay);
          }
        }
      }
    }
    // catenary masts
    if (tier >= 2 && curves.length) {
      const cv = curves[0], m = cv[Math.floor(cv.length / 2)];
      for (const sgn of [1, -1]) {
        const x = m.x + m.nx * 0.9 * sgn, z = m.z + m.nz * 0.9 * sgn;
        gb.box(x, m.y + 0.72, z, 0.035, 0.72, 0.035, 0, 0x6a7078, delay);
      }
      gb.box(m.x, m.y + 1.42, m.z, 0.03, 0.03, 0.92, Math.atan2(-m.tz, m.tx), 0x6a7078, delay);
    }
    // bridge piers
    if (bridge && curves.length) {
      const cv = curves[0], m = cv[Math.floor(cv.length / 2)];
      const yaw = Math.atan2(-m.tz, m.tx);
      const col = TIER_STYLE[tier].bridge;
      const h = m.y + 0.9;
      if (tier === 0) {
        for (const sgn of [0.55, -0.55]) gb.box(m.x + m.nx * sgn, m.y - 0.25 - h / 2, m.z + m.nz * sgn, 0.06, h / 2, 0.06, yaw, 0x5a4030, delay);
        gb.box(m.x, m.y - 0.6, m.z, 0.05, 0.04, 0.6, yaw, 0x5a4030, delay);
      } else if (tier === 3) {
        gb.box(m.x, m.y - 0.25 - h / 2, m.z, 0.22, h / 2, 0.22, yaw, 0xcac6be, delay);
      } else {
        for (const sgn of [0.5, -0.5]) gb.box(m.x + m.nx * sgn, m.y - 0.25 - h / 2, m.z + m.nz * sgn, 0.1, h / 2, 0.1, yaw, col, delay);
        // truss diagonals
        for (const sgn of [0.8, -0.8]) {
          gb.box(m.x + m.nx * sgn, m.y + 0.45, m.z + m.nz * sgn, 0.9, 0.03, 0.03, yaw, col, delay);
          gb.box(m.x + m.nx * sgn - m.tx * 0.45, m.y + 0.22, m.z + m.nz * sgn - m.tz * 0.45, 0.03, 0.25, 0.03, yaw, col, delay);
          gb.box(m.x + m.nx * sgn + m.tx * 0.45, m.y + 0.22, m.z + m.nz * sgn + m.tz * 0.45, 0.03, 0.25, 0.03, yaw, col, delay);
        }
      }
    }
    // buffer stops on dead ends (not at stations/depots)
    const sp = net.special.get(i);
    for (const s of stubs) {
      if (sp || net.degree(i) > 1) break;
      const e = edge(net, i, s);
      const cx = tileCX(i), cz = tileCZ(i);
      const x = cx + (e[0] - cx) * 0.1, z = cz + (e[2] - cz) * 0.1;
      const yaw = Math.atan2(-DZ[s], DX[s]);
      for (const lane of [LANE, -LANE]) {
        const nx = -Math.sin(-yaw) * 0, lx = Math.sin(yaw) * lane, lz = Math.cos(yaw) * lane;
        void nx;
        gb.box(x + lx, net.railH(i) + 0.22, z + lz, 0.06, 0.1, 0.18, yaw, 0xc94f4f, delay);
      }
    }
  }

  portal(gb, x, y, z, yaw, delay) {
    const stone = 0x8a8178, dark = 0x121316;
    const cs = Math.cos(yaw), sn = Math.sin(yaw);
    // facade perpendicular to track direction; local x = along track
    gb.box(x, y + 0.75, z, 0.12, 0.85, 1.0, yaw, stone, delay);
    gb.box(x - cs * 0.02, y + 0.55, z + sn * 0.02, 0.13, 0.55, 0.72, yaw, dark, delay);
    gb.box(x, y + 1.62, z, 0.16, 0.08, 1.08, yaw, shadeHex(stone, 0.85), delay);
  }

  // ---------- heatmap ----------
  setHeatmap(on) {
    this.heatOn = on;
    if (!on && this.heat) { this.group.remove(this.heat); this.heat.geometry.dispose(); this.heat = null; }
    if (on) this._heatT = 0;
  }
  buildHeat() {
    const net = this.game.net;
    if (this.heat) { this.group.remove(this.heat); this.heat.geometry.dispose(); this.heat = null; }
    let max = 1;
    for (let i = 0; i < N * N; i++) if (net.conn[i] && net.traffic[i] > max) max = net.traffic[i];
    const gb = new GeoBuf();
    for (let i = 0; i < N * N; i++) {
      if (!net.conn[i] || net.kind(i) === K_TUNNEL) continue;
      const v = net.traffic[i] / max;
      const level = v > 0.66 ? 2 : v > 0.3 ? 1 : 0;
      const w = [0.16, 0.36, 0.62][level];
      const col = [0x3fb8c8, 0xe0a33a, 0xd0503f][level];
      const { pairs, stubs } = net.tilePairs(i);
      const curves = pairs.map(([a, b]) => this.curve(i, a, b));
      for (const s of stubs) curves.push(this.curve(i, s, null));
      for (const cv of curves) for (let k = 0; k < cv.length - 1; k++) {
        const p = cv[k], q = cv[k + 1];
        // dashed pattern for low traffic, striped for high congestion
        if (level === 0 && k % 2 === 1) continue;
        const c = level === 2 && k % 2 ? 0x8a2f2f : col;
        const y0 = p.y + 0.45, y1 = q.y + 0.45;
        gb.quad([p.x - p.nx * w, y0, p.z - p.nz * w], [q.x - q.nx * w, y1, q.z - q.nz * w], [q.x + q.nx * w, y1, q.z + q.nz * w], [p.x + p.nx * w, y0, p.z + p.nz * w], c, 0);
      }
    }
    if (!gb.p.length) return;
    const m = new THREE.Mesh(gb.build(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }));
    m.renderOrder = 5;
    this.heat = m;
    this.group.add(m);
  }
}

function edge(net, i, d) {
  const j = step(i, d);
  const h = j >= 0 ? (net.railH(i) + net.railH(j)) / 2 : net.railH(i);
  return [tileCX(i) + DX[d] * TILE / 2, h, tileCZ(i) + DZ[d] * TILE / 2];
}

function shadeHex(hex, f) {
  _c.set(hex);
  return new THREE.Color(Math.min(1, _c.r * f), Math.min(1, _c.g * f), Math.min(1, _c.b * f)).getHex();
}
