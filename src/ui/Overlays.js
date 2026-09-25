// Information overlays drawn over the world: TRAFFIC, SIGNALS, BLOCKS, ROUTES,
// CONGESTION, CARGO, ELECTRIFICATION, STATION, TOWNS (relationship with the
// company), RATINGS (station cargo ratings) and INDUSTRY (share carried away,
// company stakes). Tile tints use one instanced
// quad mesh, routes use line segments, cargo uses instanced columns.
import * as THREE from 'three';
import { N, TILE, tileCX, tileCZ } from '../util.js';
import { CARGO } from '../config.js';

export const OVERLAYS = ['traffic', 'signals', 'blocks', 'routes', 'congestion', 'cargo', 'electrification', 'station', 'towns', 'ratings', 'industry', 'trackcheck'];
// bad → fair → good (the same scale for every overlay that grades something)
const grade = (v) => (v < 0.35 ? 0xe04a3a : v < 0.6 ? 0xf0b040 : 0x3ac070);
const SECTION_COLS = [0x5ab0e0, 0x6ad08a, 0xb08ae0, 0x4ad0c0, 0x8ab0ff, 0xa0d060, 0xe08ac0, 0x60c0a0, 0x7a9ae0, 0xc0b0f0];
const ROUTE_COLS = [0xffd24a, 0x4ad0ff, 0xff7a4a, 0x8aff6a, 0xd07aff, 0xff4a9a, 0x4affd0, 0xffffff];

export class Overlays {
  constructor(game) {
    this.game = game;
    this.mode = null;
    const g = new THREE.PlaneGeometry(TILE * 0.9, TILE * 0.9); g.rotateX(-Math.PI / 2);
    this.quads = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, depthWrite: false }), N * N);
    this.quads.count = 0; this.quads.frustumCulled = false; this.quads.renderOrder = 4;
    this.quads.setColorAt(0, new THREE.Color(1, 1, 1));
    this.lineGeo = new THREE.BufferGeometry();
    this.lines = new THREE.LineSegments(this.lineGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, depthTest: false }));
    this.lines.renderOrder = 9; this.lines.frustumCulled = false;
    const cg = new THREE.BoxGeometry(0.28, 1, 0.28); cg.translate(0, 0.5, 0);
    this.cols = new THREE.InstancedMesh(cg, new THREE.MeshLambertMaterial({ color: 0xffffff }), 800);
    this.cols.count = 0; this.cols.frustumCulled = false; this.cols.setColorAt(0, new THREE.Color(1, 1, 1));
    game.scene.add(this.quads, this.lines, this.cols);
    this._t = 0;
    this._m = new THREE.Matrix4(); this._c = new THREE.Color();
  }

  set(mode) {
    const g = this.game;
    if (this.mode === mode) mode = null;
    this.mode = mode;
    g.railView.setHeatmap(mode === 'traffic');
    g.furniture.showAuto = mode === 'signals' || mode === 'blocks';
    this._t = 0;
    if (!mode) this.clear();
    g.events.emit('overlay', mode);
  }
  clear() { this.quads.count = 0; this.cols.count = 0; this.lineGeo.setAttribute('position', new THREE.Float32BufferAttribute([], 3)); this.lineGeo.setAttribute('color', new THREE.Float32BufferAttribute([], 3)); }

  quad(k, tile, col, lift = 0.5) {
    const net = this.game.net;
    this._m.makeTranslation(tileCX(tile), net.railH(tile) + lift, tileCZ(tile));
    this.quads.setMatrixAt(k, this._m);
    this.quads.setColorAt(k, this._c.set(col));
  }

  update(dt) {
    if (!this.mode) return;
    this._t -= dt;
    if (this.mode === 'routes' || this.mode === 'blocks') { if (this._t > 0.1) this._t = 0.1; }
    if (this._t > 0) return;
    this._t = 0.3;
    this.clear();
    const g = this.game, net = g.net;
    let k = 0;
    const T = g.trains;
    switch (this.mode) {
      case 'blocks': {
        const bodies = new Set();
        for (const t of T.trains) {
          if (!t.steps.length) continue;
          const L = T.trainLength(t);
          for (const s of t.steps) if (s.s1 >= t.s - L && s.s0 <= t.s) bodies.add(s.tile);
        }
        // every signal section in its own soft colour; junctions grey,
        // stations sand; occupied tiles red, reserved tiles amber
        const sec = net.sections();
        for (let i = 0; i < N * N; i++) {
          if (!net.conn[i]) continue;
          const held = net.tileHolder(i);
          const s = sec[i];
          const base = s === -2 ? 0x9aa3ad : s === -3 ? 0xd8c7a0 : SECTION_COLS[(s * 2654435761 >>> 0) % SECTION_COLS.length];
          const col = bodies.has(i) ? 0xe04a3a : held ? 0xf0c040 : base;
          this.quad(k++, i, col);
        }
        break;
      }
      case 'congestion': {
        let max = 5;
        for (let i = 0; i < N * N; i++) if (net.waitHeat[i] > max) max = net.waitHeat[i];
        for (let i = 0; i < N * N; i++) {
          if (!net.conn[i]) continue;
          const v = net.waitHeat[i] / max;
          if (v < 0.03) { this.quad(k++, i, 0x3a8a5a, 0.45); continue; }
          this.quad(k++, i, v > 0.6 ? 0xe03a2a : v > 0.25 ? 0xf09030 : 0xf0d040);
        }
        break;
      }
      case 'electrification': {
        const cols = [0x8a7a6a, 0x7a8aa0, 0x3a8af0, 0xd060f0];
        for (let i = 0; i < N * N; i++) if (net.conn[i]) this.quad(k++, i, cols[net.tier[i]]);
        break;
      }
      case 'station': {
        const roleCol = { any: 0x4ad07a, passenger: 0x4a9af0, freight: 0xd08a3a, express: 0xe04a6a, through: 0x9a9aa0 };
        for (const s of g.stations.list) for (const tk of s.tracks) for (const t of tk.tiles) this.quad(k++, t, roleCol[tk.role] || 0xffffff);
        for (const d of g.stations.depots) this.quad(k++, d.tile, 0xe0a33a);
        for (const [t] of net.waypoints) this.quad(k++, t, 0xffffff);
        break;
      }
      case 'towns': {
        for (const t of g.towns.list) {
          if (!g.progression.regionUnlocked(t.region)) continue;
          const col = grade((g.authority ? g.authority.rating(t) : 50) / 100);
          for (const i of t.roadSet || []) if (k < N * N) this.quad(k++, i, col, 0.35);
          if (t.buildings) for (const b of t.buildings) if (k < N * N && b.tile != null) this.quad(k++, b.tile, col, 0.35);
        }
        break;
      }
      case 'ratings': {
        const R = g.ratings;
        const all = [...g.stations.list, ...(g.roads ? g.roads.stops : [])];
        for (const s of all) {
          const cs = Object.keys(s.ratings || {});
          if (!cs.length || !R) continue;
          const v = Math.min(...cs.map((c) => R.rating(s, c)));
          const tiles = s.tracks ? s.tracks.flatMap((tk) => tk.tiles) : [s.tile];
          for (const t of tiles) if (k < N * N) this.quad(k++, t, grade(v));
        }
        break;
      }
      case 'industry': {
        let n = 0;
        const I = g.industries;
        for (const ind of I.list) {
          if (!g.progression.regionUnlocked(ind.region)) continue;
          const col = I.linkedStations(ind).length ? grade(I.transportShare(ind)) : 0x8a8f96;
          for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) this.quad(k++, (ind.z + dz) * N + ind.x + dx, col, 0.9);
          if (ind.stake > 0 && n < this.cols.instanceMatrix.count) {
            this._m.makeScale(2.2, 0.3 + ind.stake * 3.2, 2.2).setPosition((ind.x + 1) * TILE, I.baseHeight(ind) + 2.6, (ind.z + 1) * TILE);
            this.cols.setMatrixAt(n, this._m); this.cols.setColorAt(n, this._c.set(0x3a7ae0)); n++;
          }
        }
        this.cols.count = n;
        this.cols.instanceMatrix.needsUpdate = true;
        if (this.cols.instanceColor) this.cols.instanceColor.needsUpdate = true;
        break;
      }
      case 'trackcheck': {
        // the graph validator: errors red, angled track ends amber, open track ends grey
        const seen = new Set();
        for (const x of net.validateGraph(400, true)) { if (seen.has(x.tile)) continue; seen.add(x.tile); this.quad(k++, x.tile, x.kind === 'sharp' ? 0xf0b040 : 0xe04a3a, 0.6); }
        for (let i = 0; i < N * N && k < N * N; i++) {
          if (!net.conn[i] || seen.has(i) || net.special.has(i)) continue;
          let n = 0; for (let d = 0; d < 8; d++) if ((net.conn[i] >> d) & 1) n++;
          if (n === 1) this.quad(k++, i, 0x9aa3ad, 0.5);
        }
        this._check = { issues: seen.size };
        break;
      }
      case 'signals': {
        for (let i = 0; i < N * N; i++) {
          if (!net.conn[i]) continue;
          if (net.isJunction(i)) this.quad(k++, i, 0xf0c040, 0.45);
          else if (net.runId[i] >= 0) this.quad(k++, i, 0x4ab0e0, 0.45);
        }
        break;
      }
      case 'routes': {
        const pos = [], col = [];
        const sel = g.selection && g.selection.type === 'train' ? g.selection.id : null;
        const v = new THREE.Vector3(), w = new THREE.Vector3();
        for (const t of T.trains) {
          if (!t.steps.length || (sel != null && t.id !== sel && T.trains.length > 6)) continue;
          const c = this._c.set(ROUTE_COLS[t.id % ROUTE_COLS.length]);
          const end = Math.min(t.stopS, t.ss[t.ss.length - 1]);
          const resEnd = t.steps[t.resvEnd] ? t.steps[t.resvEnd].s1 : t.s;
          for (let s = t.s; s < end; s += 0.5) {
            T.sampleAt(t, s, v); T.sampleAt(t, Math.min(end, s + 0.5), w);
            const f = s < resEnd ? 1 : 0.45;
            pos.push(v.x, v.y + 0.7, v.z, w.x, w.y + 0.7, w.z);
            col.push(c.r * f, c.g * f, c.b * f, c.r * f, c.g * f, c.b * f);
          }
          // target marker
          T.sampleAt(t, end, v);
          pos.push(v.x, v.y + 0.3, v.z, v.x, v.y + 2.2, v.z);
          col.push(c.r, c.g, c.b, c.r, c.g, c.b);
        }
        this.lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        this.lineGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
        break;
      }
      case 'cargo': {
        let n = 0;
        for (const s of g.stations.list) {
          const cap = g.stations.storage(s);
          const cs = Object.keys(s.stock).filter((c) => s.stock[c] >= 1);
          cs.forEach((c, j) => {
            if (n >= this.cols.instanceMatrix.count) return;
            const h = 0.2 + (s.stock[c] / cap) * 3;
            this._m.makeScale(1, h, 1).setPosition(tileCX(s.tile) + (j - cs.length / 2) * 0.32, net.railH(s.tile) + 1.2, tileCZ(s.tile) - 1.2);
            this.cols.setMatrixAt(n, this._m); this.cols.setColorAt(n, this._c.set(CARGO[c].color)); n++;
          });
        }
        for (const ind of g.industries.list) {
          if (!g.progression.regionUnlocked(ind.region)) continue;
          const outs = Object.keys(ind.out || {}).filter((c) => ind.out[c] >= 1);
          const cap = g.industries.capacity(ind);
          outs.forEach((c, j) => {
            if (n >= this.cols.instanceMatrix.count) return;
            const h = 0.2 + (ind.out[c] / cap) * 3;
            this._m.makeScale(1, h, 1).setPosition((ind.x + 1) * TILE + j * 0.32, g.industries.baseHeight(ind) + 2.4, (ind.z + 1) * TILE);
            this.cols.setMatrixAt(n, this._m); this.cols.setColorAt(n, this._c.set(CARGO[c].color)); n++;
          });
        }
        this.cols.count = n;
        this.cols.instanceMatrix.needsUpdate = true;
        if (this.cols.instanceColor) this.cols.instanceColor.needsUpdate = true;
        break;
      }
      default: break;
    }
    this.quads.count = k;
    this.quads.instanceMatrix.needsUpdate = true;
    if (this.quads.instanceColor) this.quads.instanceColor.needsUpdate = true;
  }
}
