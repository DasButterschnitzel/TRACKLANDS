// Towns: needs, growth stages, passenger/mail production and procedural
// instanced buildings, streets, street lamps and ambient cars.
import * as THREE from 'three';
import { N, TILE, idx, tx, tz, inMap, cheb, RNG, hashStr, easeOutBack, clamp, lerp } from '../util.js';
import { TOWN_REQ, TOWN_POP, TOWN_RADIUS, TOWN_BUILDINGS, TOWN_PRODUCTION, BIOMES, REGIONS } from '../config.js';
import { ModelBuilder, MATS, shade } from '../core/ModelBuilder.js';
import { heightAt } from './WorldGen.js';

const CLASSES = ['hamlet', 'village', 'small_town', 'town', 'large_town', 'city', 'large_city', 'metropolis', 'megalopolis'];
const ARCH = ['cottage', 'house', 'house2', 'townhouse', 'shop', 'apartment', 'block', 'office', 'tower', 'skyscraper', 'civic', 'warehouse', 'plaza'];
// how many travellers a building stands for (catchment coverage)
const ARCH_W = { cottage: 1, house: 1.5, house2: 1.5, townhouse: 2.5, shop: 1.5, apartment: 4, block: 6, office: 4, tower: 8, skyscraper: 12, civic: 2, warehouse: 1, plaza: 0.5 };
// Travellers come from the buildings the company's stations and stops reach:
// a town sends COV_FLOOR of its travellers to any station in it, plus
// COV_SPAN times the share of its buildings within walking distance of a
// stop or station (so bus and tram stops in districts the railway does not
// reach add travellers of their own; a well-covered town gives the most)
const COV_FLOOR = 0.6, COV_SPAN = 0.55;
const WALL = 0xf4efe6, GL = 0x34465a, TRIM = 0xd8d2c8;

class InstancePool {
  constructor(geo, mats, cap, shadow = true, key = 'slot') {
    this.key = key;
    this.mesh = new THREE.InstancedMesh(geo, mats, cap);
    this.mesh.count = 0;
    this.mesh.castShadow = shadow; this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.owners = [];
    this.cap = cap;
    this._m = new THREE.Matrix4(); this._c = new THREE.Color();
    this.mesh.setColorAt(0, this._c.set(0xffffff));
  }
  add(owner) {
    if (this.mesh.count >= this.cap) return -1;
    const i = this.mesh.count++;
    this.owners[i] = owner;
    return i;
  }
  remove(owner) {
    const key = this.key;
    const slot = owner[key];
    if (slot == null || slot < 0) return;
    const last = this.mesh.count - 1;
    if (slot !== last) {
      const lo = this.owners[last];
      this.mesh.getMatrixAt(last, this._m); this.mesh.setMatrixAt(slot, this._m);
      this.mesh.getColorAt(last, this._c); this.mesh.setColorAt(slot, this._c);
      this.owners[slot] = lo;
      lo[key] = slot;
    }
    this.owners.length = last;
    this.mesh.count = last;
    owner[key] = -1;
    this.dirty();
  }
  set(slot, m, color) { this.mesh.setMatrixAt(slot, m); if (color != null) this.mesh.setColorAt(slot, this._c.set(color)); }
  dirty() { this.mesh.instanceMatrix.needsUpdate = true; if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true; }
}

function buildArch(name) {
  const w = new ModelBuilder(), r = new ModelBuilder();
  const win = (mb, x, y, z, ry = 0, sx = 0.13, sy = 0.14) => mb.box(sx, sy, 0.02, GL, { x, y, z, ry, glow: true });
  switch (name) {
    case 'cottage':
      // hamlet: tiny cottage with a porch and chimney
      w.box(0.62, 0.4, 0.55, WALL);
      w.box(0.16, 0.26, 0.02, 0x6a4a2a, { x: -0.1, z: 0.28 });
      win(w, 0.16, 0.22, 0.28);
      w.box(0.36, 0.03, 0.2, 0x8a6a4a, { x: -0.1, y: 0.3, z: 0.38 });
      for (const x of [-0.26, 0.06]) w.box(0.03, 0.3, 0.03, 0x8a6a4a, { x, z: 0.46 });
      w.box(0.09, 0.26, 0.09, 0x8a5a4a, { x: 0.18, y: 0.6, z: -0.1 });
      r.roof(0.72, 0.34, 0.66, 0xffffff, { y: 0.4 });
      break;
    case 'townhouse':
      // town: pair of narrow two-storey row houses
      for (const [x, h] of [[-0.24, 0.84], [0.24, 0.92]]) {
        w.box(0.46, h, 0.8, WALL, { x });
        w.box(0.14, 0.3, 0.02, 0x5a3a2a, { x: x - 0.08, z: 0.41 });
        win(w, x + 0.1, 0.22, 0.41, 0, 0.12); win(w, x - 0.06, 0.58, 0.41, 0, 0.12); win(w, x + 0.12, 0.58, 0.41, 0, 0.12);
        r.roof(0.5, 0.3, 0.86, 0xffffff, { x, y: h });
      }
      w.box(0.94, 0.04, 0.04, TRIM, { y: 0.44, z: 0.42 });
      break;
    case 'block':
      // city: mid-rise perimeter block, shops at street level, balconies
      w.box(1.2, 1.3, 1.1, WALL);
      w.box(1.0, 0.24, 0.02, GL, { y: 0.04, z: 0.56, glow: true });
      w.box(1.22, 0.05, 0.3, 0x3f7a6a, { y: 0.32, z: 0.66, rx: 0.3 });
      for (let f = 1; f < 4; f++) for (const x of [-0.38, 0, 0.38]) {
        win(w, x, 0.12 + f * 0.3, 0.56); win(w, x, 0.12 + f * 0.3, -0.56);
        w.box(0.24, 0.03, 0.1, TRIM, { x, y: f * 0.3 + 0.02, z: 0.6 });
      }
      for (let f = 1; f < 4; f++) for (const z of [-0.3, 0.3]) { win(w, 0.61, 0.12 + f * 0.3, z, Math.PI / 2); win(w, -0.61, 0.12 + f * 0.3, z, Math.PI / 2); }
      w.box(1.26, 0.07, 1.16, TRIM, { y: 1.3 });
      r.box(1.1, 0.05, 1.0, 0xffffff, { y: 1.34 });
      r.box(0.4, 0.2, 0.3, 0xffffff, { y: 1.38, x: -0.3 });
      break;
    case 'warehouse':
      // rail-side depot district: brick shed with loading doors
      w.box(1.3, 0.66, 0.9, 0xb07a5a);
      for (const x of [-0.4, 0, 0.4]) w.box(0.26, 0.42, 0.02, 0x4a3a2a, { x, z: 0.46 });
      w.box(1.3, 0.14, 0.26, 0x9a948a, { z: 0.58 });
      win(w, -0.5, 0.52, -0.46, 0, 0.16, 0.1); win(w, 0.5, 0.52, -0.46, 0, 0.16, 0.1);
      r.roof(1.4, 0.24, 1.0, 0xffffff, { y: 0.66 });
      break;
    case 'plaza':
      // town square: paving, fountain, benches; trees in the roof pool (green tint)
      w.box(1.5, 0.04, 1.5, 0xcfc6b4);
      w.cyl(0.32, 0.34, 0.14, 12, 0xb8b0a0, { y: 0.04 });
      w.cyl(0.26, 0.26, 0.02, 12, 0x5aa6d8, { y: 0.17, glow: true });
      w.cyl(0.05, 0.06, 0.3, 6, 0xb8b0a0, { y: 0.18 });
      for (const [x, z] of [[-0.5, 0.2], [0.5, -0.2]]) w.box(0.3, 0.06, 0.1, 0x7a5a3a, { x, y: 0.12, z });
      for (const [x, z] of [[-0.55, -0.55], [0.55, -0.55], [-0.55, 0.55], [0.55, 0.55]]) { w.cyl(0.03, 0.04, 0.34, 5, 0x6b4a33, { x, z }); r.sphere(0.24, 0, 0xffffff, { x, y: 0.5, z, sy: 0.9 }); }
      break;
    case 'house':
      w.box(0.8, 0.5, 0.7, WALL);
      w.box(0.16, 0.3, 0.02, 0x7a5a3a, { x: -0.15, z: 0.36 });
      win(w, 0.18, 0.28, 0.36); win(w, 0.41, 0.28, 0, Math.PI / 2);
      r.roof(0.9, 0.38, 0.8, 0xffffff, { y: 0.5 });
      break;
    case 'house2':
      w.box(1.0, 0.8, 0.8, WALL);
      w.box(0.18, 0.32, 0.02, 0x6a4a2a, { x: 0, z: 0.41 });
      for (const x of [-0.3, 0.3]) { win(w, x, 0.25, 0.41); win(w, x, 0.58, 0.41); }
      w.box(0.12, 0.35, 0.12, 0x8a5a4a, { x: 0.3, y: 0.95, z: -0.15 });
      r.roof(1.1, 0.42, 0.9, 0xffffff, { y: 0.8 });
      break;
    case 'shop':
      w.box(1.0, 0.62, 0.85, WALL);
      w.box(0.8, 0.26, 0.02, GL, { y: 0.06, z: 0.43, glow: true });
      w.box(1.02, 0.05, 0.3, 0xc94f4f, { y: 0.4, z: 0.55, rx: 0.3 });
      w.box(0.5, 0.1, 0.02, 0xe0a33a, { y: 0.52, z: 0.43 });
      r.box(1.06, 0.08, 0.9, 0xffffff, { y: 0.62 });
      break;
    case 'apartment':
      w.box(1.0, 1.5, 0.9, WALL);
      for (let f = 0; f < 4; f++) for (const x of [-0.3, 0, 0.3]) { win(w, x, 0.2 + f * 0.34, 0.46); win(w, x, 0.2 + f * 0.34, -0.46); }
      w.box(1.06, 0.08, 0.96, TRIM, { y: 1.5 });
      r.box(0.3, 0.2, 0.3, 0xffffff, { y: 1.55, x: 0.25 });
      break;
    case 'office':
      w.box(1.1, 2.4, 1.0, WALL);
      for (let f = 0; f < 7; f++) { w.box(1.12, 0.12, 1.02, GL, { y: 0.2 + f * 0.32, glow: true }); }
      w.box(1.16, 0.08, 1.06, TRIM, { y: 2.4 });
      r.box(0.5, 0.25, 0.4, 0xffffff, { y: 2.45 });
      break;
    case 'tower':
      w.box(0.95, 3.2, 0.95, WALL);
      w.box(0.75, 0.8, 0.75, WALL, { y: 3.2 });
      for (let f = 0; f < 10; f++) { w.box(0.97, 0.1, 0.97, GL, { y: 0.2 + f * 0.3, glow: true }); }
      w.box(0.02, 0.6, 0.02, 0x6a6a6a, { y: 4.0 });
      r.box(0.8, 0.06, 0.8, 0xffffff, { y: 4.0 });
      break;
    case 'skyscraper':
      w.box(1.15, 4.4, 1.15, WALL);
      w.box(0.95, 1.2, 0.95, WALL, { y: 4.4 });
      w.box(0.7, 0.6, 0.7, WALL, { y: 5.6 });
      for (let f = 0; f < 18; f++) { w.box(1.17, 0.1, 1.17, GL, { y: 0.2 + f * 0.24, glow: true }); }
      for (let f = 0; f < 4; f++) { w.box(0.97, 0.1, 0.97, GL, { y: 4.5 + f * 0.26, glow: true }); }
      w.cyl(0.02, 0.03, 1.0, 5, 0x9aa0a6, { y: 6.2 });
      w.sphere(0.05, 0, 0xff5040, { y: 7.2, glow: true });
      r.box(0.75, 0.08, 0.75, 0xffffff, { y: 6.2 });
      break;
    case 'civic':
    default:
      w.box(1.5, 0.75, 1.0, WALL);
      w.box(1.6, 0.1, 1.1, TRIM, { y: 0.75 });
      for (let k = 0; k < 5; k++) w.cyl(0.05, 0.05, 0.62, 6, TRIM, { x: -0.6 + k * 0.3, z: 0.56 });
      w.box(1.6, 0.08, 0.3, TRIM, { y: 0.62, z: 0.56 });
      w.box(0.4, 0.8, 0.4, WALL, { y: 0.85 });
      w.cyl(0.13, 0.13, 0.02, 12, 0xf4f0e6, { y: 1.35, z: 0.21, rx: Math.PI / 2, center: true, glow: true });
      r.cone(0.38, 0.45, 4, 0xffffff, { y: 1.65, ry: Math.PI / 4 });
      r.roof(1.6, 0.3, 1.1, 0xffffff, { y: 0.85 });
      break;
  }
  return { walls: w.build(), roof: r.build() };
}

const BUILDING_H = { cottage: 0.8, house: 0.9, house2: 1.2, townhouse: 1.2, shop: 0.7, apartment: 1.6, block: 1.6, office: 2.6, tower: 4.2, skyscraper: 7.2, civic: 1.8, warehouse: 0.9, plaza: 0.6 };

export class TownSystem {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.pools = {};
    this.roofPools = {};
    for (const a of ARCH) {
      const g = buildArch(a);
      const cap = a === 'house' || a === 'house2' || a === 'cottage' || a === 'townhouse' ? 900 : a === 'plaza' ? 80 : 500;
      this.pools[a] = new InstancePool(g.walls, MATS, cap);
      this.roofPools[a] = new InstancePool(g.roof, MATS, cap, true, 'rslot');
      this.group.add(this.pools[a].mesh, this.roofPools[a].mesh);
    }
    // street lamps & cars
    const lm = new ModelBuilder();
    lm.cyl(0.02, 0.025, 0.7, 5, 0x3a3f45);
    lm.box(0.16, 0.03, 0.04, 0x3a3f45, { y: 0.68, x: 0.06 });
    lm.box(0.08, 0.04, 0.06, 0xfff0c0, { y: 0.64, x: 0.12, glow: true });
    this.lamps = new InstancePool(lm.build(), MATS, 1500, false);
    const cm = new ModelBuilder();
    cm.box(0.36, 0.12, 0.18, 0xffffff, { y: 0.05 });
    cm.box(0.2, 0.1, 0.16, 0xdde8f0, { x: -0.03, y: 0.17 });
    cm.box(0.03, 0.04, 0.12, 0xfff6c0, { x: 0.18, y: 0.1, glow: true });
    this.cars = new InstancePool(cm.build(), MATS, 400, false);
    this.group.add(this.lamps.mesh, this.cars.mesh);
    this.carList = [];
    this.roadMat = new THREE.MeshLambertMaterial({ color: 0x6f6a66, flatShading: true, side: THREE.DoubleSide });
    this.animating = [];
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(); this._up = new THREE.Vector3(0, 1, 0);
  }

  byId(id) { return this.list.find((t) => t.id === id); }
  // street traffic uses its own seeded generator (reproducible tests)
  rand() { this._r = (Math.imul(this._r ?? 0x2f6b4a1, 1103515245) + 12345) >>> 0; return (this._r >>> 8) / 16777216; }
  // population class (nine steps, from the head count)
  classOf(t) { const L = [0, 150, 500, 1200, 3000, 7000, 15000, 35000, 80000]; let k = 0; for (let i = 0; i < L.length; i++) if (t.pop >= L[i]) k = i; return CLASSES[k]; }
  // districts: what the buildings of the town are used for, by area
  districts(t) {
    const S = this.game.stations, out = {};
    const quarter = new Set();
    for (const s of S.list) if (s.links && s.links.towns.includes(t.id)) for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) quarter.add(idx(tx(s.tile) + dx, tz(s.tile) + dz));
    for (const b of t.buildings) {
      const d = Math.max(Math.abs(tx(b.tile) - t.x), Math.abs(tz(b.tile) - t.z));
      const k = b.arch === 'civic' || b.arch === 'plaza' || (d <= 1 && (b.arch === 'townhouse' || b.arch === 'shop')) ? 'core'
        : quarter.has(b.tile) && b.arch !== 'warehouse' ? 'station'
          : b.arch === 'warehouse' ? 'logistics'
            : b.arch === 'office' || b.arch === 'shop' ? 'business'
              : b.arch === 'apartment' || b.arch === 'block' || b.arch === 'tower' || b.arch === 'skyscraper' ? 'dense'
                : 'residential';
      out[k] = (out[k] || 0) + 1;
    }
    return out;
  }
  // towns whose built-up areas touch this one (metropolitan area)
  metroWith(t) {
    return this.list.filter((o) => o !== t && Math.max(Math.abs(o.x - t.x), Math.abs(o.z - t.z)) <= TOWN_RADIUS[t.stage] + TOWN_RADIUS[o.stage] + 2 && this.game.progression.regionUnlocked(o.region));
  }
  radius(t) { return TOWN_RADIUS[t.stage]; }
  stageName(t) { return ['hamlet', 'village', 'town', 'large_town', 'city', 'major_city', 'metropolis'][t.stage]; }

  init(world) {
    this.list = world.towns.map((s, k) => ({
      id: 1 + k, name: s.name, x: s.x, z: s.z, region: s.region, tourist: s.tourist, seed: s.seed,
      stage: 0, progress: {}, pop: TOWN_POP[0], paxAcc: 0, mailAcc: 0, delivered: 0, buildings: [], lampsList: [],
      received: {},
    }));
  }

  requirement(t) {
    if (t.stage >= TOWN_REQ.length) return null;
    const base = TOWN_REQ[t.stage];
    const g = this.game;
    const mul = (1 + g.progression.fx.townReq) * g.difficulty.growthMul;
    const r = {};
    for (const c in base) r[c] = Math.max(5, Math.round(base[c] * mul));
    return r;
  }
  needs(t, c) {
    const r = this.requirement(t);
    return !!(r && r[c] && (t.progress[c] || 0) < r[c]);
  }

  receive(t, c, n) {
    t.delivered += n;
    t.received[c] = (t.received[c] || 0) + n;
    const req = this.requirement(t);
    if (req && req[c]) {
      t.progress[c] = Math.min(req[c], (t.progress[c] || 0) + n);
      this.game.events.emit('townProgress', t, c);
      this.checkGrowth(t);
    }
    const nextPop = TOWN_POP[Math.min(6, t.stage + 1)];
    t.pop = Math.min(nextPop - 1, t.pop + n * 0.4);
  }

  progressFrac(t) {
    const req = this.requirement(t);
    if (!req) return 1;
    let have = 0, need = 0;
    for (const c in req) { have += Math.min(req[c], t.progress[c] || 0); need += req[c]; }
    return need ? have / need : 1;
  }

  checkGrowth(t) {
    const req = this.requirement(t);
    if (!req) return;
    for (const c in req) if ((t.progress[c] || 0) < req[c]) return;
    this.levelUp(t);
  }

  levelUp(t) {
    if (t.stage >= 6) return;
    t.stage++;
    t.progress = {};
    t.pop = Math.max(t.pop, TOWN_POP[t.stage]);
    // the new stage shows at once in a few buildings; the rest grows monthly
    this.layout(t, true, 4);
    this.game.stations.relinkAll();
    this.game.industries.onStationsChanged();
    this.game.stats.max('maxTownStage', t.stage);
    this.game.stats.inc('townLevelUps');
    this.game.events.emit('townLevel', t);
  }

  // Monthly: towns build towards their target, faster with good service
  // and a good relationship; towns without a station grow very slowly.
  growMonth() {
    const g = this.game, A = g.authority;
    for (const t of this.list) {
      if (!g.progression.regionUnlocked(t.region)) continue;
      const sts = t._sts || (t._sts = [...g.stations.list, ...(g.roads ? g.roads.stops : [])].filter((s) => s.links && s.links.towns.includes(t.id)));
      const r = A ? A.rating(t) : 50;
      let budget = sts.length ? 1 + (r >= 60 ? 1 : 0) + (r >= 80 ? 1 : 0) + Math.min(2, sts.length - 1) : ((t.idleMonths = (t.idleMonths || 0) + 1) % 4 === 0 ? 1 : 0);
      if (r < 20) budget = Math.min(budget, 1);
      if (budget > 0) { const n0 = t.buildings.length; this.layout(t, true, budget); if (t.buildings.length !== n0 || t.renewed) g.events.emit('townGrew', t); }
    }
  }

  tick(dt) {
    const g = this.game, fx = g.progression.fx, ev = g.economy.eventFx;
    const m = g.ledger ? g.ledger.monthIndex() : 0;
    if (this._month == null) this._month = m;
    else if (m !== this._month) { this._month = m; this.growMonth(); }
    for (const t of this.list) {
      if (!g.progression.regionUnlocked(t.region)) continue;
      const sts = t._sts || (t._sts = [...g.stations.list, ...(g.roads ? g.roads.stops : [])].filter((s) => s.links && s.links.towns.includes(t.id)));
      if (!sts.length) continue;
      const P = TOWN_PRODUCTION;
      // frequent, well-connected service attracts more travellers (PaxFlow)
      const pax = (P.paxBase + t.pop * P.paxPerPop) * (1 + fx.paxProd + (ev.paxProd || 0)) * (t.tourist ? 1.5 : 1) * (g.pax ? g.pax.townMul(sts) : 1);
      const mail = (P.mailBase + t.pop * P.mailPerPop) * (1 + fx.mailProd);
      const cov = this.coverage(t, sts);
      t.paxAcc += (pax * COV_FLOOR / 60) * dt;
      t.paxCovAcc = (t.paxCovAcc || 0) + (pax * COV_SPAN * cov.share / 60) * dt;
      t.mailAcc += (mail / 60) * dt;
      if (t.paxAcc >= 1) { const n = Math.floor(t.paxAcc); t.paxAcc -= n; this.push(sts, 'PASSENGERS', n); }
      if (t.paxCovAcc >= 1) { const n = Math.floor(t.paxCovAcc); t.paxCovAcc -= n; this.pushCovered(cov, n); }
      if (t.mailAcc >= 1) { const n = Math.floor(t.mailAcc); t.mailAcc -= n; this.push(sts, 'MAIL', n); }
    }
  }
  // travellers pick the better-served station (cargo rating), all of them go
  push(sts, c, n) {
    const S = this.game.stations;
    if (sts.some((s) => s.service)) { sts = sts.filter((s) => S.serves(s, c)); if (!sts.length) return; }
    const R = this.game.ratings;
    if (!R || sts.length === 1) { const per = Math.ceil(n / sts.length); for (const s of sts) { if (n <= 0) break; const k = Math.min(per, n); this.game.stations.receive(s, c, k); n -= k; } return; }
    const w = sts.map((s) => Math.max(0.05, R.rating(s, c)));
    const sum = w.reduce((a, b) => a + b, 0);
    let left = n;
    sts.forEach((s, i) => { const k = i === sts.length - 1 ? left : Math.min(left, Math.round(n * w[i] / sum)); if (k > 0) { this.game.stations.receive(s, c, k); left -= k; } });
  }
  onStationsChanged() { for (const t of this.list) { t._sts = null; t._cov = null; } }
  // which stations and stops reach which of the town's buildings
  coverage(t, sts) {
    if (t._cov && t._cov.n === t.buildings.length) return t._cov;
    const g = this.game, S = g.stations, R = g.roads;
    const shapes = (sts || []).filter((s) => !s.service || S.serves(s, 'PASSENGERS')).map((s) => ({ s, tiles: s.road ? R.stopTiles(s) : S.allTiles(s), r: s.road ? R.stopRadius(s) : S.radius(s) }));
    let tot = 0, cov = 0;
    const w = new Map();
    for (const b of t.buildings) {
      const bw = ARCH_W[b.arch] || 1;
      tot += bw;
      const hit = shapes.filter((sh) => sh.tiles.some((u) => cheb(u, b.tile) <= sh.r));
      if (!hit.length) continue;
      cov += bw;
      for (const h of hit) w.set(h.s, (w.get(h.s) || 0) + bw / hit.length);
    }
    t._cov = { share: tot ? cov / tot : 1, w, weight: cov, total: tot, n: t.buildings.length };
    return t._cov;
  }
  // the travellers from reached buildings go to the stop or station that reaches them
  pushCovered(cov, n) {
    if (!cov.w.size) return;
    const list = [...cov.w.entries()];
    const sum = list.reduce((a, e) => a + e[1], 0);
    let left = n;
    list.forEach(([s, w], i) => { const k = i === list.length - 1 ? left : Math.min(left, Math.round((n * w) / sum)); if (k > 0) { this.game.stations.receive(s, 'PASSENGERS', k); left -= k; } });
  }
  // a new or bigger station reshapes the town around it (rail influence)
  onStationGrew(stn) {
    for (const t of this.list) if (Math.max(Math.abs(tx(stn.tile) - t.x), Math.abs(tz(stn.tile) - t.z)) <= 7) this.layout(t, true, 2);
  }

  // ---------- layout ----------
  isRoad(t, x, z) { const dx = x - t.x, dz = z - t.z; return (dx % 3 === 0 || dz % 3 === 0); }

  candidateTiles(t) {
    if (t._cands) return t._cands;
    const out = [];
    const R = 6;
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      const x = t.x + dx, z = t.z + dz;
      if (!inMap(x, z) || x < 1 || z < 1 || x > N - 2 || z > N - 2) continue;
      const d = Math.max(Math.abs(dx), Math.abs(dz));
      const h = (hashStr(`${t.seed}:${dx}:${dz}`) % 1000) / 1000;
      out.push({ x, z, dx, dz, d, h, road: dx % 3 === 0 || dz % 3 === 0 });
    }
    out.sort((a, b) => a.d + a.h * 0.9 - (b.d + b.h * 0.9));
    t._cands = out;
    return out;
  }

  tileFree(t, i) {
    const g = this.game;
    const W = g.world;
    if (W.type[i] !== 0) return false;
    if (g.net.conn[i] || g.net.special.has(i)) return false;
    const occ = g.occupancy;
    if (occ.blocked[i] && occ.owner[i] !== t.id) return false;
    if (occ.owner[i] && occ.owner[i] !== t.id && occ.owner[i] < 1000) return false;
    if (g.decor && g.decor.at(i)) return false;
    // demolished by the company: the site stays empty for a while
    if (t.cleared && t.cleared[i] > g.time) return false;
    return true;
  }

  // Architectural generations: density grows with the town stage and falls
  // off with distance from the centre; the railway pulls density towards busy
  // passenger stations and brings warehouses next to goods stations.
  archFor(t, c) {
    const s = t.stage;
    const rail = this.railInfluence(t, c);
    if (rail.goods && s >= 2 && c.h > 0.3 && c.h < 0.75) return 'warehouse';
    const dens = s - c.d * 0.75 + c.h * 0.8 + rail.boost;
    if (dens < 0.2) return c.h > 0.5 ? 'house' : 'cottage';
    if (dens < 0.8) return c.h > 0.6 ? 'house2' : c.h > 0.3 ? 'house' : 'cottage';
    if (dens < 1.5) return c.h > 0.55 ? 'house2' : c.h > 0.3 ? 'townhouse' : 'shop';
    if (dens < 2.4) return c.h > 0.6 ? 'apartment' : c.h > 0.3 ? 'townhouse' : 'shop';
    if (dens < 3.3) return c.h > 0.5 ? 'apartment' : 'block';
    if (dens < 4.3) return c.h > 0.55 ? 'office' : 'block';
    if (dens < 5.2) return c.h > 0.4 ? 'tower' : c.h > 0.2 ? 'office' : 'block';
    return c.h > 0.35 ? 'skyscraper' : 'tower';
  }
  // passenger stations serving this town raise density around them (more with
  // level and traffic); goods stations within 2 tiles attract warehouses
  railInfluence(t, c) {
    const S = this.game.stations;
    let boost = 0, goods = false;
    if (!S || !S.list) return { boost, goods };
    for (const st of S.list) {
      const d = Math.max(Math.abs(tx(st.tile) - c.x), Math.abs(tz(st.tile) - c.z));
      if (d > 4) continue;
      const kind = st.kind || (S.stationKind ? S.stationKind(st).kind : '');
      if (kind === 'freight' || kind === 'yard' || kind === 'intermodal') { if (d <= 2) goods = true; continue; }
      if (!st.links || !(st.links.towns || []).includes(t.id)) continue;
      const busy = Math.min(1, (st.stats && st.stats.arrivals ? st.stats.arrivals : 0) / 60);
      boost = Math.max(boost, (0.5 + 0.18 * st.level + 0.4 * busy) * (1 - d / 5));
    }
    return { boost, goods };
  }

  // how many buildings the town is heading for: its stage, plus infill while
  // it works towards the next stage
  buildTarget(t) {
    const a = TOWN_BUILDINGS[t.stage], b = TOWN_BUILDINGS[Math.min(6, t.stage + 1)];
    return a + Math.floor((b - a) * 0.6 * this.progressFrac(t));
  }
  // Physical growth: the town moves towards its target layout at most
  // `budget` buildings at a time (new plots from the centre out, then
  // replacements by denser buildings), so growth is visible month by month.
  layout(t, animate, budget = Infinity) {
    const g = this.game;
    const occ = g.occupancy;
    const R = TOWN_RADIUS[t.stage];
    const target = this.buildTarget(t);
    const cands = this.candidateTiles(t);
    const want = new Map();
    let civicPlaced = false, plazaPlaced = false;
    // road tiles within radius belong to the town (for picking), never blocked
    for (const c of cands) {
      if (c.d > R) continue;
      const i = idx(c.x, c.z);
      if (c.road && (!occ.owner[i] || occ.owner[i] === t.id) && g.world.type[i] === 0) occ.owner[i] = t.id;
    }
    for (const c of cands) {
      if (want.size >= target) break;
      if (c.d > R || c.road) continue;
      const i = idx(c.x, c.z);
      if (!this.tileFree(t, i)) continue;
      let arch = this.archFor(t, c);
      if (!civicPlaced && t.stage >= 1 && c.d === 1) { arch = 'civic'; civicPlaced = true; }
      else if (!plazaPlaced && t.stage >= 3 && c.d === 2 && c.h < 0.5) { arch = 'plaza'; plazaPlaced = true; }
      want.set(i, arch);
    }
    // keep matching buildings; the rest are changes, done within the budget
    const keep = [], stale = [];
    const has = new Map(t.buildings.map((b) => [b.tile, b]));
    for (const b of t.buildings) {
      if (want.get(b.tile) === b.arch) { keep.push(b); want.delete(b.tile); } else stale.push(b);
    }
    // new plots first (nearest the centre), then replacements, then clear-outs
    const adds = [...want].filter(([tile]) => !has.has(tile));
    const reps = [...want].filter(([tile]) => has.has(tile));
    const outs = stale.filter((b) => !want.has(b.tile));
    let left = budget, k = 0;
    const place = (tile, arch) => {
      const b = this.addBuilding(t, tile, arch, animate ? 0.15 + k * 0.06 : -1);
      if (b) { keep.push(b); occ.blocked[tile] = 1; occ.owner[tile] = t.id; }
      k++;
    };
    for (const [tile, arch] of adds) { if (left <= 0) break; place(tile, arch); left--; }
    for (const [tile, arch] of reps) {
      const old = has.get(tile);
      if (left <= 0) { keep.push(old); continue; }
      this.removeBuilding(old); place(tile, arch); left--;
      if (old.arch !== arch) t.renewed = (t.renewed || 0) + 1;
    }
    for (const b of outs) {
      if (left <= 0) { keep.push(b); continue; }
      this.removeBuilding(b); occ.blocked[b.tile] = 0; left--;
    }
    t.buildings = keep;
    t.growing = adds.length + reps.length + outs.length > budget;
    this.buildRoads(t);
    this.game.world.view && this.game.world.view.clearTreesMany(t.buildings.map((b) => b.tile).concat(this.roadTiles(t)));
  }

  roadTiles(t) {
    const R = TOWN_RADIUS[t.stage];
    const out = [];
    for (const c of this.candidateTiles(t)) if (c.road && c.d <= R && this.game.world.type[idx(c.x, c.z)] === 0) out.push(idx(c.x, c.z));
    return out;
  }

  addBuilding(t, tile, arch, delay) {
    const pool = this.pools[arch], rpool = this.roofPools[arch];
    const b = { tile, arch, town: t.id, pool, rpool, slot: -1, rslot: -1 };
    b.slot = pool.add(b); b.rslot = rpool.add(b);
    if (b.slot < 0 || b.rslot < 0) { if (b.slot >= 0) pool.remove(b); if (b.rslot >= 0) rpool.remove(b); return null; }
    const x = tx(tile), z = tz(tile);
    const W = this.game.world;
    const rng = new RNG(hashStr(`${t.seed}:${tile}:${arch}`));
    // face the nearest road
    const dx = x - t.x, dz = z - t.z;
    const mx = ((dx % 3) + 3) % 3, mz = ((dz % 3) + 3) % 3;
    let rot = 0;
    if (mz === 1) rot = Math.PI; else if (mz === 2) rot = 0;
    if (Math.abs(dx) > Math.abs(dz)) rot = mx === 1 ? -Math.PI / 2 : Math.PI / 2;
    const wx = (x + 0.5) * TILE + rng.range(-0.2, 0.2), wz = (z + 0.5) * TILE + rng.range(-0.2, 0.2);
    // sit on the lowest corner so buildings never float
    let h = 1e9;
    for (const [ox, oz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) h = Math.min(h, heightAt(W, wx + ox, wz + oz));
    const biome = BIOMES[REGIONS[t.region].biome];
    const tints = [0xffffff, 0xfbeede, 0xeef2f6, 0xf6e6d6, 0xe8efe4, 0xf7f0dc];
    b.pos = [wx, h - 0.05, wz];
    b.rot = rot;
    b.scale = arch === 'house' || arch === 'house2' || arch === 'cottage' ? rng.range(1.2, 1.45) : arch === 'plaza' ? 1.25 : rng.range(1.25, 1.45);
    b.wall = tints[rng.int(0, tints.length - 1)];
    b.roofC = arch === 'plaza' ? shade(0x4f8a4a, rng.range(0.9, 1.1)) : arch === 'house' || arch === 'house2' || arch === 'civic' || arch === 'cottage' || arch === 'townhouse' ? rng.pick(biome.roof) : shade(0x8a8f96, rng.range(0.8, 1.1));
    if (arch === 'office' || arch === 'tower' || arch === 'skyscraper') b.wall = rng.pick([0xdfe6ea, 0xcfd8de, 0xe8e2d8, 0xd6dce4]);
    if (arch === 'block') b.wall = rng.pick([0xe8d8c0, 0xd8c0a8, 0xe6e0d4, 0xc8b8a8, 0xdcc8b0]);
    if (arch === 'warehouse' || arch === 'plaza') b.wall = 0xffffff;
    b.t = delay >= 0 ? -delay : 1;
    this.writeBuilding(b, delay >= 0 ? 0 : 1);
    pool.set(b.slot, this._m, b.wall); rpool.set(b.rslot, this._m, b.roofC);
    pool.dirty(); rpool.dirty();
    if (delay >= 0) this.animating.push(b);
    // street lamp next to some buildings
    if (rng.chance(0.35)) {
      const L = { slot: -1 };
      L.slot = this.lamps.add(L);
      if (L.slot >= 0) {
        this._p.set(wx + Math.sin(rot) * 0.8, h, wz + Math.cos(rot) * 0.8);
        this._q.setFromAxisAngle(this._up, rot); this._s.set(1.2, 1.2, 1.2);
        this._m.compose(this._p, this._q, this._s);
        this.lamps.set(L.slot, this._m, 0xffffff); this.lamps.dirty();
        b.lamp = L;
      }
    }
    return b;
  }

  writeBuilding(b, k) {
    const e = k >= 1 ? 1 : Math.max(0.001, easeOutBack(clamp(k, 0, 1)));
    this._p.set(b.pos[0], b.pos[1], b.pos[2]);
    this._q.setFromAxisAngle(this._up, b.rot);
    this._s.set(b.scale, b.scale * e, b.scale);
    this._m.compose(this._p, this._q, this._s);
    b.pool.mesh.setMatrixAt(b.slot, this._m);
    b.rpool.mesh.setMatrixAt(b.rslot, this._m);
  }

  removeBuilding(b) {
    b.pool.remove(b);
    b.rpool.remove(b);
    if (b.lamp) { this.lamps.remove(b.lamp); b.lamp = null; }
    this.animating = this.animating.filter((x) => x !== b);
  }

  buildRoads(t) {
    if (t.roadMesh) { this.group.remove(t.roadMesh); t.roadMesh.geometry.dispose(); }
    const W = this.game.world;
    const X = this.game.crossings;
    // streets cannot cross switches, diagonals, stations or high-speed lines
    const tiles = new Set(this.roadTiles(t).filter((i) => !X || X.roadAxisThrough(i) !== -1));
    const pos = [];
    const H = (x, z) => heightAt(W, x, z) + 0.04;
    const quad = (x0, z0, x1, z1) => {
      const a = [x0, H(x0, z0), z0], b = [x1, H(x1, z0), z0], c = [x1, H(x1, z1), z1], d = [x0, H(x0, z1), z1];
      pos.push(...a, ...d, ...b, ...b, ...d, ...c);
    };
    const hw = 0.42;
    for (const i of tiles) {
      const cx = (tx(i) + 0.5) * TILE, cz = (tz(i) + 0.5) * TILE;
      quad(cx - hw, cz - hw, cx + hw, cz + hw);
      const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (const [ox, oz] of nb) {
        const x = tx(i) + ox, z = tz(i) + oz;
        if (!inMap(x, z) || !tiles.has(idx(x, z))) continue;
        if (ox === 1) quad(cx + hw, cz - hw, cx + TILE / 2, cz + hw);
        if (ox === -1) quad(cx - TILE / 2, cz - hw, cx - hw, cz + hw);
        if (oz === 1) quad(cx - hw, cz + hw, cx + hw, cz + TILE / 2);
        if (oz === -1) quad(cx - hw, cz - TILE / 2, cx + hw, cz - hw);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, this.roadMat);
    m.receiveShadow = true;
    t.roadMesh = m;
    t.roadSet = tiles;
    if (X) X.version = -1;
    if (this.game.roads) this.game.roads.townsChanged();
    this.group.add(m);
    // cars
    const want = Math.min(2 + t.stage * 3, 20);
    const mine = this.carList.filter((c) => c.town === t.id);
    const roadArr = [...tiles];
    for (let k = mine.length; k < want && roadArr.length > 1; k++) {
      const c = { town: t.id, slot: -1, from: roadArr[k % roadArr.length], to: -1, f: 0, speed: 0.6 + this.rand() * 0.5, color: [0xc94f4f, 0x3f6e9a, 0xe0a33a, 0xe8e2d4, 0x5aa66a, 0x2b2b2b][k % 6] };
      c.slot = this.cars.add(c);
      if (c.slot < 0) break;
      this.cars.mesh.setColorAt(c.slot, new THREE.Color(c.color));
      this.carList.push(c);
    }
  }

  buildAll() {
    for (const t of this.list) {
      if (t.savedBld && t.savedBld.length) this.restoreBuildings(t);
      else this.layout(t, false);
      t.savedBld = null;
    }
  }
  restoreBuildings(t) {
    const g = this.game, occ = g.occupancy, W = g.world;
    for (const b of t.buildings) this.removeBuilding(b);
    t.buildings = [];
    // road tiles within the radius belong to the town (as in layout)
    for (const c of this.candidateTiles(t)) { if (c.d > TOWN_RADIUS[t.stage]) continue; const i = idx(c.x, c.z); if (c.road && (!occ.owner[i] || occ.owner[i] === t.id) && W.type[i] === 0) occ.owner[i] = t.id; }
    for (const [tile, a] of t.savedBld) {
      if (W.type[tile] !== 0 || g.net.conn[tile] || g.net.special.has(tile) || (occ.blocked[tile] && occ.owner[tile] !== t.id)) continue;
      const b = this.addBuilding(t, tile, ARCH[a], -1);
      if (b) { t.buildings.push(b); occ.blocked[tile] = 1; occ.owner[tile] = t.id; }
    }
    this.buildRoads(t);
    g.world.view && g.world.view.clearTreesMany(t.buildings.map((b) => b.tile).concat(this.roadTiles(t)));
  }

  updateVisuals(dt, time) {
    const g = this.game;
    // rising buildings
    if (this.animating.length) {
      const done = [];
      for (const b of this.animating) {
        b.t += dt * 1.4;
        this.writeBuilding(b, Math.max(0, b.t));
        if (b.t >= 1) done.push(b);
        if (b.t > 0 && b.t - dt * 1.4 <= 0 && g.particles) g.particles.emit('dust', b.pos[0], b.pos[1] + 0.1, b.pos[2], 4);
      }
      for (const a of ARCH) { this.pools[a].dirty(); this.roofPools[a].dirty(); }
      if (done.length) this.animating = this.animating.filter((b) => !done.includes(b));
    }
    // cars drive along streets
    const W = g.world;
    const speedMul = g.speed || 1;
    for (const c of this.carList) {
      const t = this.byId(c.town);
      if (!t || !t.roadSet || !t.roadSet.size) continue;
      if (c.to < 0 || !t.roadSet.has(c.from)) {
        c.from = t.roadSet.has(c.from) ? c.from : [...t.roadSet][0];
        c.to = this.nextRoad(t, c.from, -1);
        c.f = 0;
      }
      // a closed level crossing ahead: wait before the tile edge
      const X = g.crossings;
      const hold = X && X.isBlocked(c.to) && c.f < 0.4;
      // on a crossing that starts to warn: clear it quickly
      const rush = X && X.isBlocked(c.from) && c.f < 0.5 ? 4 : 1;
      if (!hold) c.f += dt * c.speed * 0.6 * Math.min(speedMul, 2) * rush;
      if (hold && c.f > 0.34) c.f = 0.34;
      if (c.f >= 1) { const prev = c.from; c.from = c.to; c.to = this.nextRoad(t, c.from, prev); c.f = 0; }
      const ax = (tx(c.from) + 0.5) * TILE, az = (tz(c.from) + 0.5) * TILE, bx = (tx(c.to) + 0.5) * TILE, bz = (tz(c.to) + 0.5) * TILE;
      const dx = bx - ax, dz = bz - az;
      const len = Math.hypot(dx, dz) || 1;
      const nx = -dz / len, nz = dx / len;
      const x = lerp(ax, bx, c.f) + nx * 0.18, z = lerp(az, bz, c.f) + nz * 0.18;
      this._p.set(x, heightAt(W, x, z) + 0.05, z);
      this._q.setFromAxisAngle(this._up, Math.atan2(-dz, dx));
      this._s.set(1, 1, 1);
      this._m.compose(this._p, this._q, this._s);
      this.cars.mesh.setMatrixAt(c.slot, this._m);
    }
    this.cars.dirty();
    void time;
  }

  nextRoad(t, from, prev) {
    const opts = [];
    for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = tx(from) + ox, z = tz(from) + oz;
      if (!inMap(x, z)) continue;
      const i = idx(x, z);
      if (!t.roadSet.has(i) || i === prev) continue;
      // over a level crossing only straight across the railway
      const X = this.game.crossings;
      const ax = ox ? 0 : 2;
      if (X && ((X.at(i) && X.at(i).axis !== ax) || (X.at(from) && X.at(from).axis !== ax))) continue;
      opts.push(i);
    }
    if (!opts.length) return prev >= 0 ? prev : from;
    return opts[Math.floor(this.rand() * opts.length)];
  }

  largest() { let b = null; for (const t of this.list) if (!b || t.pop > b.pop) b = t; return b; }

  serialize() {
    const now = this.game.time;
    return this.list.map((t) => {
      const cl = {};
      for (const k in t.cleared || {}) if (t.cleared[k] > now) cl[k] = Math.round(t.cleared[k]);
      return { id: t.id, stage: t.stage, progress: t.progress, pop: Math.round(t.pop), delivered: t.delivered, received: t.received, bld: t.buildings.map((b) => [b.tile, ARCH.indexOf(b.arch)]), renewed: t.renewed || undefined, auth: this.game.authority ? this.game.authority.serializeTown(t) : undefined, cleared: Object.keys(cl).length ? cl : undefined };
    });
  }
  deserialize(arr) {
    if (!Array.isArray(arr)) return;
    for (const d of arr) {
      const t = this.byId(d.id);
      if (!t) continue;
      t.stage = Math.max(0, Math.min(6, d.stage | 0));
      t.progress = {};
      for (const c in d.progress || {}) if (typeof d.progress[c] === 'number') t.progress[c] = d.progress[c];
      t.pop = Math.max(TOWN_POP[t.stage], +d.pop || 0);
      t.delivered = +d.delivered || 0;
      t.received = d.received && typeof d.received === 'object' ? d.received : {};
      if (this.game.authority) this.game.authority.deserializeTown(t, d.auth);
      // the buildings as they stood (older saves: rebuilt from the stage)
      t.savedBld = Array.isArray(d.bld) ? d.bld.filter((e) => Array.isArray(e) && Number.isInteger(e[0]) && e[0] >= 0 && e[0] < N * N && ARCH[e[1]]).slice(0, 200) : null;
      t.renewed = d.renewed | 0;
      t.cleared = {};
      if (d.cleared && typeof d.cleared === 'object') for (const k in d.cleared) { const i = +k, v = +d.cleared[k]; if (Number.isInteger(i) && i >= 0 && i < N * N && isFinite(v)) t.cleared[i] = v; }
    }
  }
}

export { cheb, MATS };
