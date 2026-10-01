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
import { visualFamily, renewedYear } from '../world/VisualEra.js';

const MAX = 160;

export class Crossings {
  constructor(game) {
    this.game = game;
    this.map = new Map();        // tile -> { tile, axis, closed, arm (0 up … 1 down), t, town }
    this.version = -1;
    // Phase 12: four looks by era (VisualEra 'crossing'): early gates, then
    // warning lights, half barriers, full barriers with a control cabinet.
    // The crossing works the same in all of them (the look only).
    const cross = (b, y) => { b.box(0.34, 0.07, 0.03, 0xf4f4f4, { y, rz: 0.6 }); b.box(0.34, 0.07, 0.03, 0xf4f4f4, { y, rz: -0.6 }); b.box(0.3, 0.02, 0.031, 0xd23c32, { y, rz: 0.6 }); };
    const armModel = (len, gate) => {
      const b = new ModelBuilder();
      if (gate) {
        // a timber gate: two rails and uprights, white with a red disc
        b.box(len, 0.05, 0.05, 0xf0ece2, { x: len / 2, y: -0.03 });
        b.box(len, 0.04, 0.04, 0xf0ece2, { x: len / 2, y: -0.22 });
        for (let k = 0; k <= 4; k++) b.box(0.04, 0.23, 0.04, 0xf0ece2, { x: 0.04 + k * (len - 0.08) / 4, y: -0.13 });
        b.box(0.14, 0.14, 0.03, 0xd23c32, { x: len * 0.55, y: -0.12 });
      } else {
        b.box(len, 0.06, 0.06, 0xf4f4f4, { x: len / 2, y: -0.03 });
        const n = Math.round(len / 0.31);
        for (let k = 0; k < n; k++) b.box(0.14, 0.066, 0.066, 0xd23c32, { x: 0.2 + k * 0.3, y: -0.033 });
      }
      return b.build();
    };
    const postModel = (fam) => {
      const b = new ModelBuilder();
      if (fam === 'gate') { b.box(0.08, 0.5, 0.08, 0xe8e2d4, { y: 0.25 }); b.cyl(0.02, 0.02, 0.8, 5, 0x3a3f45, { x: 0.2 }); cross(b, 0.82); b.xo = 0; return b.build(); }
      b.cyl(0.045, 0.05, 0.7, 6, 0x3a3f45);
      cross(b, 0.72);
      b.box(0.28, 0.1, 0.07, 0x22262b, { y: 0.52 });
      b.box(0.16, 0.2, 0.16, 0x3a3f45, { y: 0.24 });
      if (fam === 'full') { b.box(0.2, 0.34, 0.16, 0x9aa3ab, { x: 0.32, z: 0.1, y: 0.17 }); b.box(0.21, 0.03, 0.17, 0x6a7078, { x: 0.32, z: 0.1, y: 0.35 }); }
      return b.build();
    };
    const lamp = new ModelBuilder();
    lamp.box(0.08, 0.08, 0.04, 0xff3a2a, { glow: true });
    const lampGeo = lamp.build();
    this.fams = {};
    for (const fam of ['gate', 'lights', 'half', 'full']) {
      const F = {
        posts: new THREE.InstancedMesh(postModel(fam), MATS, MAX * 2),
        arms: fam === 'lights' ? null : new THREE.InstancedMesh(armModel(fam === 'half' ? 0.66 : 1.25, fam === 'gate'), MATS, MAX * 2),
        lamps: fam === 'gate' ? null : new THREE.InstancedMesh(lampGeo, MATS, MAX * 4),
      };
      for (const m of [F.posts, F.arms, F.lamps]) if (m) { m.count = 0; m.frustumCulled = false; game.scene.add(m); }
      this.fams[fam] = F;
    }
    // (the full-barrier set under the old names, for code that counts them)
    this.arms = this.fams.full.arms; this.posts = this.fams.full.posts; this.lamps = this.fams.full.lamps;
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
  // (kept current on demand: the simulation also runs without frames)
  fresh() { if (this.version !== this.game.net.version && !this._rebuilding) { this._rebuilding = true; try { this.rebuild(); } finally { this._rebuilding = false; } } }
  at(tile) { this.fresh(); return this.map.get(tile) || null; }
  isClosed(tile) { this.fresh(); const c = this.map.get(tile); return !!c && c.closed; }
  // road traffic stops entering as soon as the warning starts
  isBlocked(tile) { if (this.flag && !this.flag[tile]) return false; const c = this.map.get(tile); return !!c && (c.closed || c.warn || c.request > this.game.time); }
  // Interlock: a train may only reserve a crossing that is clear of road
  // traffic. Asking starts the warning (no car enters, cars on it hurry off).
  // A town car still on it after a few seconds (stuck behind the queue on
  // the far side) is moved off it: back behind the stop line if it was
  // about to cross, on to the far side if it was crossing.
  roadBusy(tile) {
    const c = this.map.get(tile);
    if (!c) return false;
    const g = this.game, T = g.traffic;
    const cars = T ? T.cars.filter((k) => (k.from === tile && k.f < 0.5) || (k.to === tile && k.f >= 0.4)) : [];
    const lorry = g.roads && g.roads.onTile(tile);
    // clear: the train takes it now, so from this very step no one enters
    if (!cars.length && !lorry) { c.busySince = null; c.request = Math.max(c.request || 0, g.time + 1.5); return false; }
    c.request = g.time + 1.5;
    if (c.busySince == null || g.time - c.busySince > 30) c.busySince = g.time;
    if (cars.length && g.time - c.busySince > 4) {
      for (const k of cars) { if (k.to === tile) k.f = 0.3; else k.f = 0.52; }
      return !!lorry;   // company vehicles are simulated: they clear out themselves
    }
    return true;
  }

  // rebuild the crossing list from the towns' streets (after track changes)
  rebuild() {
    const g = this.game, old = this.map;
    // track changed: streets re-route around new switches / across new lines
    if (this.version >= 0 && this.version !== g.net.version) for (const t of g.towns.list) if (t.roadSet && g.towns.roadTiles(t).some((i) => g.net.conn[i] || t.roadSet.has(i) !== (this.roadAxisThrough(i) !== -1))) g.towns.buildRoads(t);
    this.map = new Map();
    // company roads over railway tiles
    if (g.roads) for (let i = 0; i < g.roads.bits.length; i++) {
      if (!g.roads.bits[i] || !g.net.conn[i] || g.roads.br[i] === 2) continue;
      const ax = this.roadAxisThrough(i);
      if (ax == null || ax < 0) continue;
      const prev = old.get(i);
      this.map.set(i, { tile: i, axis: ax, closed: prev ? prev.closed : false, arm: prev ? prev.arm : 0, t: 0, town: 0 });
    }
    for (const t of g.towns.list) {
      if (!t.roadSet) continue;
      for (const i of t.roadSet) {
        const ax = this.roadAxisThrough(i);
        if (ax == null || ax < 0) continue;
        const prev = old.get(i);
        this.map.set(i, { tile: i, axis: ax, closed: prev ? prev.closed : false, arm: prev ? prev.arm : 0, t: 0, town: t.id });
      }
    }
    // a flag per tile: the town's cars ask about every tile they drive onto
    const n = g.world && g.world.type ? g.world.type.length : 0;
    if (!this.flag || this.flag.length !== n) this.flag = new Uint8Array(n); else this.flag.fill(0);
    for (const i of this.map.keys()) if (i >= 0 && i < n) this.flag[i] = 1;
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

  // the look of a crossing: the year its track was laid, renewed by the
  // authority every 40 years
  family(c) {
    const g = this.game, now = g.ledger ? g.ledger.year() : 1950;
    if (c.famY !== now) { c.famY = now; c.fam = visualFamily('crossing', renewedYear(g.net.yearBuilt(c.tile, g.ledger ? g.ledger.startYear : now), now)); }
    return c.fam;
  }
  update(dt, force) {
    const g = this.game;
    if (dt > 0) this.lastFrame = g.time;
    if (g.net.version !== this.version && !force) { this.rebuild(); return; }
    const cnt = {};
    for (const f in this.fams) cnt[f] = { a: 0, p: 0, l: 0 };
    let anyClosing = null;
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
      const fam = this.family(c), F = this.fams[fam], n = cnt[fam];
      if (n.p + 2 > MAX * 2) continue;
      const x = tileCX(c.tile), z = tileCZ(c.tile), y = g.net.railH(c.tile);
      // posts at two opposite corners, barrier arms across the street
      const along = c.axis === 0 ? [1, 0] : [0, 1];      // street direction
      const across = [along[1], along[0]];
      for (const s of [-1, 1]) {
        const px = x + along[0] * s * 0.7 + across[0] * s * 0.62, pz = z + along[1] * s * 0.7 + across[1] * s * 0.62;
        const yaw = Math.atan2(-across[1] * -s, across[0] * -s);
        this._p.set(px, y, pz); this._q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
        this._m.compose(this._p, this._q, this._s);
        F.posts.setMatrixAt(n.p++, this._m);
        if (F.arms) {
          // arm: raised = pointing up (rotated about its own long axis end); a gate swings aside
          if (fam === 'gate') this._e.set(0, yaw + (1 - c.arm) * 1.4 * s, 0, 'YXZ');
          else this._e.set(0, yaw, (1 - c.arm) * 1.45, 'YXZ');
          this._q.setFromEuler(this._e);
          this._p.set(px, y + 0.3, pz);
          this._m.compose(this._p, this._q, this._s);
          F.arms.setMatrixAt(n.a++, this._m);
        }
        // two lamps per post, alternating while closed
        if (F.lamps) for (const k of [0, 1]) {
          const on = lit && ((blink + k) % 2 === 0);
          const off = 0.08 * (k ? 1 : -1);
          this._p.set(px + across[0] * off * 1.6 * s, y + 0.53, pz + across[1] * off * 1.6 * s);
          this._q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
          this._m.compose(this._p, this._q, on ? this._s : this._s.set(0.001, 0.001, 0.001));
          this._s.set(1, 1, 1);
          F.lamps.setMatrixAt(n.l++, this._m);
        }
      }
    }
    for (const f in this.fams) {
      const F = this.fams[f], n = cnt[f];
      for (const [m, k] of [[F.posts, n.p], [F.arms, n.a], [F.lamps, n.l]]) if (m) { m.count = k; m.instanceMatrix.needsUpdate = true; }
    }
    this.counts = cnt;
    // the bell, only for a crossing near the view
    if (anyClosing && g.audio && !force) {
      const cam = g.camera.target, d = Math.hypot(tileCX(anyClosing.tile) - cam.x, tileCZ(anyClosing.tile) - cam.z);
      const vol = Math.max(0, 1 - d / (g.camera.viewSize * 0.9));
      if (vol > 0.05) { g.audio.play('crossing', { vol, world: true, dur: 1.4 }); g.audio.play('barrier', { vol: vol * 0.8, world: true }); }
    }
  }
  closedCount() { let n = 0; for (const c of this.map.values()) if (c.closed) n++; return n; }
}

export { TILE, tx, tz };
