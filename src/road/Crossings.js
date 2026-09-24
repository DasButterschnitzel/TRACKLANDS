// Level crossings: wherever a town street meets a straight plain railway
// tile at right angles. A crossing closes as soon as a train has reserved
// the crossing tile (the reservation runs ahead by the train's braking
// distance) and opens when the rear of the whole train has cleared it and
// the reservation is released. While closed: lights flash, the bell rings
// (near the camera), barriers are down and road traffic waits in front.
// High-speed and maglev lines never get level crossings (the street is cut:
// grade separation needed); nor do switches, diagonals, stations, depots.
import * as THREE from 'three';
import { TILE, tx, tz, tileCX, tileCZ } from '../util.js';
import { ModelBuilder, MATS } from '../core/ModelBuilder.js';

const MAX = 160;

export class Crossings {
  constructor(game) {
    this.game = game;
    this.map = new Map();        // tile -> { tile, axis, closed, arm (0 up … 1 down), t, town }
    this.version = -1;
    // barrier arm (pivot at the post), post with lights
    const arm = new ModelBuilder();
    arm.box(1.25, 0.06, 0.06, 0xf4f4f4, { x: 0.62, y: -0.03 });
    for (let k = 0; k < 4; k++) arm.box(0.14, 0.066, 0.066, 0xd23c32, { x: 0.2 + k * 0.3, y: -0.033 });
    const post = new ModelBuilder();
    post.cyl(0.045, 0.05, 0.7, 6, 0x3a3f45);
    post.box(0.34, 0.07, 0.03, 0xf4f4f4, { y: 0.72, rz: 0.6 });
    post.box(0.34, 0.07, 0.03, 0xf4f4f4, { y: 0.72, rz: -0.6 });
    post.box(0.28, 0.1, 0.07, 0x22262b, { y: 0.52 });
    post.box(0.16, 0.2, 0.16, 0x3a3f45, { y: 0.24 });
    const lamp = new ModelBuilder();
    lamp.box(0.08, 0.08, 0.04, 0xff3a2a, { glow: true });
    this.arms = new THREE.InstancedMesh(arm.build(), MATS, MAX * 2);
    this.posts = new THREE.InstancedMesh(post.build(), MATS, MAX * 2);
    this.lamps = new THREE.InstancedMesh(lamp.build(), MATS, MAX * 4);
    for (const m of [this.arms, this.posts, this.lamps]) { m.count = 0; m.frustumCulled = false; game.scene.add(m); }
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1);
    this._e = new THREE.Euler();
    this.bellT = 0;
  }

  // may a street pass this railway tile? (axis of the street, or -1 = cut)
  roadAxisThrough(tile) {
    const net = this.game.net;
    if (!net.conn[tile]) return null;          // no railway: an ordinary street
    if (net.special.has(tile) || net.waypoints.has(tile)) return -1;
    if (net.degree(tile) !== 2) return -1;
    if ((net.tier[tile] | 0) >= 3) return -1;  // high-speed / maglev: grade separation only
    if (net.hasDir(tile, 0) && net.hasDir(tile, 4)) return 2;   // rail E–W, street N–S
    if (net.hasDir(tile, 2) && net.hasDir(tile, 6)) return 0;   // rail N–S, street E–W
    return -1;
  }
  at(tile) { return this.map.get(tile) || null; }
  isClosed(tile) { const c = this.map.get(tile); return !!c && c.closed; }
  // road traffic stops entering as soon as the warning starts
  isBlocked(tile) { const c = this.map.get(tile); return !!c && (c.closed || c.warn || c.request > this.game.time); }
  // Interlock: a train may only reserve a crossing that is clear of road
  // traffic. Asking starts the warning (no car enters, cars on it clear
  // out). Without animation (headless runs) cars do not move: then the
  // crossing clears them off at once, back to the side they came from.
  roadBusy(tile) {
    const c = this.map.get(tile);
    if (!c) return false;
    const g = this.game, cars = g.towns.carList.filter((k) => (k.from === tile && k.f < 0.5) || (k.to === tile && k.f >= 0.4));
    if (!cars.length) return false;
    c.request = g.time + 1.5;
    if (g.time - (this.lastFrame ?? -1e9) > 1) {
      for (const k of cars) { if (k.to === tile) k.f = 0.3; else { const p = k.from; k.from = k.to; k.to = p; k.f = 0.7; } }
      return false;
    }
    return true;
  }

  // rebuild the crossing list from the towns' streets (after track changes)
  rebuild() {
    const g = this.game, old = this.map;
    // track changed: streets re-route around new switches / across new lines
    if (this.version >= 0 && this.version !== g.net.version) for (const t of g.towns.list) if (t.roadSet && g.towns.roadTiles(t).some((i) => g.net.conn[i] || t.roadSet.has(i) !== (this.roadAxisThrough(i) !== -1))) g.towns.buildRoads(t);
    this.map = new Map();
    for (const t of g.towns.list) {
      if (!t.roadSet) continue;
      for (const i of t.roadSet) {
        const ax = this.roadAxisThrough(i);
        if (ax == null || ax < 0) continue;
        const prev = old.get(i);
        this.map.set(i, { tile: i, axis: ax, closed: prev ? prev.closed : false, arm: prev ? prev.arm : 0, t: 0, town: t.id });
      }
    }
    this.version = g.net.version;
    this.update(0, true);
  }

  // How far (world units along its path) the nearest train that has the
  // crossing reserved is from it: 0 when a train stands on it. Reservations
  // run ahead of trains; a train waiting far back does not close the road.
  approach(c) {
    const g = this.game, net = g.net, T = g.trains, i = c.tile;
    if (T.tileOccupied(i)) return { d: 0, v: 0 };
    const ids = new Set([net.resv[i * 2], net.resv[i * 2 + 1]].filter(Boolean));
    let best = null;
    for (const id of ids) {
      const t = T.byId(id);
      if (!t || !t.steps.length) { best = { d: 0, v: 0 }; continue; }
      const st = t.steps.find((s) => s.tile === i && s.s1 > t.s - 0.01);
      const d = st ? Math.max(0, st.s0 - t.s) : 0;
      if (!best || d < best.d) best = { d, v: t.v };
    }
    return best;
  }
  sense(c) {
    const a = this.approach(c);
    if (!a) return { closed: false, warn: false };
    // warning: a few seconds before the train; barriers: shortly before
    return { warn: a.d < 7 + a.v * 4, closed: a.d < 3.5 + a.v * 2.2 };
  }

  update(dt, force) {
    const g = this.game;
    if (dt > 0) this.lastFrame = g.time;
    if (g.net.version !== this.version && !force) { this.rebuild(); return; }
    let a = 0, p = 0, l = 0, anyClosing = null;
    const blink = Math.floor(g.clock * 2.2) % 2;
    for (const c of this.map.values()) {
      const sn = this.sense(c);
      const closed = sn.closed || sn.warn || c.request > g.time;
      if (closed && !c.closed && !c.warn) { c.t = 0; anyClosing = c; }
      c.warn = (sn.warn || c.request > g.time) && !sn.closed;
      c.closed = sn.closed;
      const lit = c.closed || c.warn;
      // barriers lower after a short warning, rise once clear
      c.t += dt;
      const down = c.closed && c.t > 0.6;
      c.arm += ((down ? 1 : 0) - c.arm) * Math.min(1, dt * 3.2);
      if (force) c.arm = down ? 1 : 0;
      if (a + 2 > MAX * 2) continue;
      const x = tileCX(c.tile), z = tileCZ(c.tile), y = g.net.railH(c.tile);
      // posts at two opposite corners, barrier arms across the street
      const along = c.axis === 0 ? [1, 0] : [0, 1];      // street direction
      const across = [along[1], along[0]];
      for (const s of [-1, 1]) {
        const px = x + along[0] * s * 0.7 + across[0] * s * 0.62, pz = z + along[1] * s * 0.7 + across[1] * s * 0.62;
        const yaw = Math.atan2(-across[1] * -s, across[0] * -s);
        this._p.set(px, y, pz); this._q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
        this._m.compose(this._p, this._q, this._s);
        this.posts.setMatrixAt(p++, this._m);
        // arm: raised = pointing up (rotated about its own long axis end)
        this._e.set(0, yaw, (1 - c.arm) * 1.45, 'YXZ');
        this._q.setFromEuler(this._e);
        this._p.set(px, y + 0.3, pz);
        this._m.compose(this._p, this._q, this._s);
        this.arms.setMatrixAt(a++, this._m);
        // two lamps per post, alternating while closed
        for (const k of [0, 1]) {
          const on = lit && ((blink + k) % 2 === 0);
          const off = 0.08 * (k ? 1 : -1);
          this._p.set(px + across[0] * off * 1.6 * s, y + 0.53, pz + across[1] * off * 1.6 * s);
          this._q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
          this._m.compose(this._p, this._q, on ? this._s : this._s.set(0.001, 0.001, 0.001));
          this._s.set(1, 1, 1);
          this.lamps.setMatrixAt(l++, this._m);
        }
      }
    }
    this.arms.count = a; this.posts.count = p; this.lamps.count = l;
    this.arms.instanceMatrix.needsUpdate = true; this.posts.instanceMatrix.needsUpdate = true; this.lamps.instanceMatrix.needsUpdate = true;
    // the bell, only for a crossing near the view
    if (anyClosing && g.audio && !force) {
      const cam = g.camera.target, d = Math.hypot(tileCX(anyClosing.tile) - cam.x, tileCZ(anyClosing.tile) - cam.z);
      const vol = Math.max(0, 1 - d / (g.camera.viewSize * 0.9));
      if (vol > 0.05) g.audio.play('crossing', { vol });
    }
  }
  closedCount() { let n = 0; for (const c of this.map.values()) if (c.closed) n++; return n; }
}

export { TILE, tx, tz };
