// Line-side furniture: animated switch blades with lever stands (lamp shows
// set / moving / locked), manual block & path signals with live aspects,
// automatic signals (shown in the SIGNALS overlay) and waypoint markers.
import * as THREE from 'three';
import { N, TILE, DX, DZ, step, opp, tileCX, tileCZ, turnOf } from '../util.js';
import { ModelBuilder } from '../core/ModelBuilder.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _e = new THREE.Euler(), _c = new THREE.Color();
const RED = 0xff4a3a, GREEN = 0x4ae07a, AMBER = 0xffc040, WHITE = 0xe8eef2;

function inst(geo, mat, n) { const m = new THREE.InstancedMesh(geo, mat, n); m.count = 0; m.frustumCulled = false; m.setColorAt(0, new THREE.Color(1, 1, 1)); return m; }

export class RailFurniture {
  constructor(game) {
    this.game = game;
    const vc = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    // blade: thin bar pivoting at the tile center
    const bg = new THREE.BoxGeometry(0.85, 0.03, 0.05); bg.translate(0.425, 0, 0);
    this.blades = inst(bg, new THREE.MeshLambertMaterial({ color: 0xd8dde2 }), 1200);
    const sm = new ModelBuilder(); sm.box(0.1, 0.26, 0.1, 0x4a4f55); sm.box(0.18, 0.06, 0.06, 0x2a2c30, { y: 0.26 });
    this.stands = inst(sm.build(), vc, 600);
    const lg = new THREE.SphereGeometry(0.065, 8, 6);
    this.lamps = inst(lg, lampMat, 2400);
    const mm = new ModelBuilder();
    mm.cyl(0.03, 0.035, 0.95, 6, 0x3a3d42);
    mm.box(0.12, 0.3, 0.1, 0x1e2024, { y: 0.8 });
    mm.box(0.2, 0.03, 0.14, 0x2a2c30, { y: 1.1 });
    this.masts = inst(mm.build(), vc, 600);
    const pm = new ModelBuilder();
    pm.cyl(0.02, 0.02, 0.8, 5, 0x5a5f66);
    pm.box(0.02, 0.18, 0.28, 0xe0a33a, { y: 0.6, z: 0.14 });
    this.flags = inst(pm.build(), vc, 200);
    for (const m of [this.blades, this.stands, this.lamps, this.masts, this.flags]) game.scene.add(m);
    this.showAuto = false;
    this._t = 0;
    this.aspects = new Map();   // signal key -> 'red'|'green'
  }

  edge(i, d) {
    const net = this.game.net;
    const j = step(i, d);
    const h = j >= 0 ? (net.railH(i) + net.railH(j)) / 2 : net.railH(i);
    return { x: tileCX(i) + DX[d] * TILE / 2, y: h, z: tileCZ(i) + DZ[d] * TILE / 2 };
  }

  // the leg of a switch that has a sibling within 45° is the one that moves
  bladeDir(i, a, b) {
    const net = this.game.net;
    for (const d of [a, b]) {
      if (d === 8) continue;
      for (let e = 0; e < 8; e++) if (e !== d && net.hasDir(i, e) && turnOf(d, e) === 1) return d;
    }
    return b === 8 ? a : b;
  }

  signalAspect(key) {
    const net = this.game.net;
    const tile = key >> 3, dir = key & 7;
    const own = net.laneKeys({ tile, inH: opp(dir), outH: dir });
    const approaching = net.keyHolder(own[0]);
    let cur = tile, h = dir;
    for (let n = 0; n < 12; n++) {
      const j = step(cur, h);
      if (j < 0 || !net.hasDir(cur, h)) break;
      const out = net.smoothExit(j, h);
      const keys = net.laneKeys({ tile: j, inH: h, outH: out });
      for (const k of keys) {
        const hd = k >= 0 ? net.resv[k] : net.keyHolder(k);
        if (hd && hd !== approaching) return 'red';
      }
      if (out == null || net.signals.has(j * 8 + out) || net.isJunction(j) || net.special.has(j)) break;
      cur = j; h = out;
    }
    return 'green';
  }

  update(dt) {
    const g = this.game, net = g.net;
    this._t -= dt;
    const refreshAspects = this._t <= 0;
    if (refreshAspects) this._t = 0.25;
    let nb = 0, ns = 0, nl = 0, nm = 0, nf = 0;
    const lamp = (x, y, z, col) => {
      if (nl >= this.lamps.instanceMatrix.count) return;
      _m.makeTranslation(x, y, z);
      this.lamps.setMatrixAt(nl, _m); this.lamps.setColorAt(nl, _c.set(col)); nl++;
    };
    // switches
    for (const [tile, sw] of net.switches) {
      if (!net.conn[tile] || nb >= this.blades.instanceMatrix.count) continue;
      const cur = this.bladeDir(tile, sw.a, sw.b), prev = this.bladeDir(tile, sw.pa, sw.pb);
      const ya = Math.atan2(-DZ[cur], DX[cur]), yp = Math.atan2(-DZ[prev], DX[prev]);
      let dy = ya - yp; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
      const k = sw.t < 1 ? sw.t * sw.t * (3 - 2 * sw.t) : 1;
      const yaw = yp + dy * k;
      const cx = tileCX(tile), cz = tileCZ(tile), y = net.railH(tile) + 0.2;
      _q.setFromEuler(_e.set(0, yaw, 0)); _p.set(cx, y, cz); _m.compose(_p, _q, _s);
      this.blades.setMatrixAt(nb++, _m);
      // lever stand at a corner
      const sx = cx + TILE * 0.38, sz = cz + TILE * 0.38;
      _q.identity(); _p.set(sx, net.railH(tile) + 0.05, sz); _m.compose(_p, _q, _s);
      if (ns < this.stands.instanceMatrix.count) this.stands.setMatrixAt(ns++, _m);
      const locked = net.jres.has(tile);
      lamp(sx, net.railH(tile) + 0.4, sz, sw.t < 1 ? AMBER : locked ? RED : GREEN);
    }
    // manual signals
    for (const [key, sg] of net.signals) {
      if (nm >= this.masts.instanceMatrix.count) break;
      const tile = key >> 3, d = key & 7;
      const e = this.edge(tile, d);
      const len = Math.hypot(DX[d], DZ[d]);
      const rx = -DZ[d] / len, rz = DX[d] / len;
      const x = e.x + rx * 0.95 - DX[d] / len * 0.15, z = e.z + rz * 0.95 - DZ[d] / len * 0.15;
      _q.setFromEuler(_e.set(0, Math.atan2(-DZ[d], DX[d]) + Math.PI / 2, 0)); _p.set(x, e.y + 0.05, z); _m.compose(_p, _q, _s);
      this.masts.setMatrixAt(nm++, _m);
      if (refreshAspects) this.aspects.set(key, this.signalAspect(key));
      const asp = this.aspects.get(key) || 'green';
      const col = asp === 'red' ? RED : sg.type === 'path' && asp === 'green' ? WHITE : GREEN;
      lamp(x - DX[d] / len * 0.07, e.y + 0.05 + 0.95, z - DZ[d] / len * 0.07, col);
      if (sg.oneway) lamp(x - DX[d] / len * 0.07, e.y + 0.05 + 0.82, z - DZ[d] / len * 0.07, AMBER);
    }
    // automatic signals (station exits, junction approaches, single-track entries)
    if (this.showAuto) {
      if (refreshAspects || !this._auto) this._auto = this.autoSignals();
      for (const a of this._auto) {
        const hd = net.tileHolder(a.next);
        lamp(a.x, a.y + 0.55, a.z, hd ? RED : GREEN);
      }
    }
    // waypoints
    for (const [tile] of net.waypoints) {
      if (nf >= this.flags.instanceMatrix.count) break;
      _q.identity(); _p.set(tileCX(tile) + 0.8, net.railH(tile) + 0.05, tileCZ(tile) + 0.8); _m.compose(_p, _q, _s);
      this.flags.setMatrixAt(nf++, _m);
    }
    for (const [m, n] of [[this.blades, nb], [this.stands, ns], [this.lamps, nl], [this.masts, nm], [this.flags, nf]]) {
      m.count = n; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  autoSignals() {
    const net = this.game.net, out = [];
    net.computeRuns();
    for (let i = 0; i < N * N && out.length < 900; i++) {
      if (!net.conn[i]) continue;
      const sp = net.special.get(i);
      for (let d = 0; d < 8; d++) {
        if (!net.hasDir(i, d)) continue;
        const j = step(i, d);
        if (j < 0) continue;
        const spj = net.special.get(j);
        const leavingStation = sp && sp.type === 'station' && !(spj && spj.type === 'station' && spj.id === sp.id);
        const enteringJunction = net.isJunction(j) && !net.isJunction(i);
        const enteringRun = net.runId[j] >= 0 && net.runId[i] !== net.runId[j];
        if (!leavingStation && !enteringJunction && !enteringRun) continue;
        const e = this.edge(i, d);
        const len = Math.hypot(DX[d], DZ[d]);
        out.push({ x: e.x - DZ[d] / len * 0.85, y: e.y, z: e.z + DX[d] / len * 0.85, next: j });
      }
    }
    return out;
  }
}
