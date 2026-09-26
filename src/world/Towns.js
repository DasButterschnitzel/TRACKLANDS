// Towns: needs, growth stages, passenger/mail production and procedural
// instanced buildings, streets and street lamps.
import * as THREE from 'three';
import { N, TILE, idx, tx, tz, inMap, cheb, RNG, hashStr, easeOutBack, clamp, lerp } from '../util.js';
import { TOWN_REQ, TOWN_POP, TOWN_RADIUS, TOWN_BUILDINGS, TOWN_PRODUCTION, BIOMES, REGIONS, MATERIALS_GROWTH } from '../config.js';
import { ModelBuilder, MATS, shade } from '../core/ModelBuilder.js';
import { heightAt } from './WorldGen.js';
import { ARCHETYPES, FAMILIES, LANDMARKS, LANDMARK_STAGE, HEIGHT_ORDER, pickArchetype, streetAt, planDist } from './CityStyle.js';

const CLASSES = ['hamlet', 'village', 'small_town', 'town', 'large_town', 'city', 'large_city', 'metropolis', 'megalopolis'];
// (saves store the index: new types only ever go at the end)
const ARCH = ['cottage', 'house', 'house2', 'townhouse', 'shop', 'apartment', 'block', 'office', 'tower', 'skyscraper', 'civic', 'warehouse', 'plaza',
  'terrace', 'chalet', 'farmhouse', 'factory', 'hotel', 'glasstower', 'bungalow', 'boathouse', ...LANDMARKS];
// how many travellers a building stands for (catchment coverage)
const ARCH_W = { cottage: 1, house: 1.5, house2: 1.5, townhouse: 2.5, shop: 1.5, apartment: 4, block: 6, office: 4, tower: 8, skyscraper: 12, civic: 2, warehouse: 1, plaza: 0.5,
  terrace: 3, chalet: 1.5, farmhouse: 1.2, factory: 1.5, hotel: 5, glasstower: 9, bungalow: 1.2, boathouse: 1, cathedral: 2, museum: 2, monument: 0.5, stadium: 3, clocktower: 1.5, tv_tower: 1, park: 0.5, convention: 3, lighthouse: 0.5, market_hall: 2, university: 5 };
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
    this.mesh.visible = false;   // (shown once it holds something: no empty draw calls)
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
    this.mesh.visible = true;
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
    this.mesh.visible = last > 0;
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
    // ---------- local building types (architecture families) ----------
    case 'terrace':
      // traditional / brick: three narrow row houses, steep roofs, dormers
      for (const [x, h] of [[-0.34, 0.95], [0, 1.05], [0.34, 0.9]]) {
        w.box(0.32, h, 0.78, WALL, { x });
        w.box(0.12, 0.3, 0.02, 0x5a3a2a, { x: x - 0.06, z: 0.4 });
        win(w, x + 0.08, 0.24, 0.4, 0, 0.1); win(w, x, 0.62, 0.4, 0, 0.1);
        r.roof(0.34, 0.36, 0.84, 0xffffff, { x, y: h });
        r.box(0.12, 0.12, 0.1, 0xffffff, { x, y: h + 0.06, z: 0.3 });
      }
      w.box(1.04, 0.05, 0.04, TRIM, { y: 0.48, z: 0.41 });
      break;
    case 'chalet':
      // mountain: timber chalet, wide overhanging roof, balcony
      w.box(0.84, 0.3, 0.74, 0xd8d0c4);
      w.box(0.84, 0.36, 0.74, WALL, { y: 0.3 });
      w.box(0.9, 0.04, 0.2, 0x6a4a2a, { y: 0.36, z: 0.46 });
      for (let k = 0; k < 5; k++) w.box(0.02, 0.14, 0.02, 0x6a4a2a, { x: -0.4 + k * 0.2, y: 0.4, z: 0.55 });
      win(w, -0.2, 0.14, 0.38); win(w, 0.2, 0.14, 0.38); win(w, 0, 0.5, 0.38, 0, 0.18);
      r.roof(1.12, 0.34, 1.0, 0xffffff, { y: 0.66 });
      break;
    case 'farmhouse':
      // rural: long farmhouse with a barn wing and a silo
      w.box(0.9, 0.5, 0.6, WALL, { x: -0.1 });
      w.box(0.46, 0.6, 0.64, 0xb0503a, { x: 0.52 });
      w.box(0.2, 0.34, 0.02, 0x5a3a2a, { x: 0.52, z: 0.33 });
      win(w, -0.3, 0.26, 0.31); win(w, 0.05, 0.26, 0.31);
      w.cyl(0.13, 0.13, 0.9, 8, 0xd8d0c0, { x: 0.52, z: -0.45 });
      r.roof(0.96, 0.32, 0.66, 0xffffff, { x: -0.1, y: 0.5 });
      r.roof(0.5, 0.3, 0.7, 0xffffff, { x: 0.52, y: 0.6 });
      r.cone(0.15, 0.14, 8, 0xffffff, { x: 0.52, y: 0.9, z: -0.45 });
      break;
    case 'factory':
      // brick: works hall with a saw-tooth roof and a chimney
      w.box(1.3, 0.62, 1.0, WALL);
      for (const x of [-0.42, 0, 0.42]) { w.box(0.3, 0.44, 0.02, 0x4a3a2a, { x, z: 0.51 }); r.roof(0.42, 0.26, 1.04, 0xffffff, { x, y: 0.62, rz: 0.35 }); }
      w.cyl(0.08, 0.1, 1.1, 8, 0x8a5a4a, { x: 0.5, z: -0.35 });
      w.box(0.2, 0.05, 0.2, 0x5a3a2a, { x: 0.5, y: 1.1, z: -0.35 });
      break;
    case 'hotel':
      // resort: hotel with balconies, a canopy and a rooftop sign
      w.box(1.1, 1.9, 0.9, WALL);
      w.box(0.9, 0.24, 0.02, GL, { y: 0.04, z: 0.46, glow: true });
      w.box(0.8, 0.04, 0.34, 0xc94f4f, { y: 0.32, z: 0.6 });
      for (let f = 1; f < 6; f++) for (const x of [-0.34, 0, 0.34]) { win(w, x, 0.1 + f * 0.3, 0.46); w.box(0.26, 0.03, 0.12, TRIM, { x, y: f * 0.3 + 0.01, z: 0.52 }); }
      w.box(0.6, 0.18, 0.04, 0xe0a33a, { y: 1.94, z: 0.2, glow: true });
      r.box(1.14, 0.06, 0.94, 0xffffff, { y: 1.9 });
      break;
    case 'glasstower':
      // glass: a slim tower of glass bands with a crown
      w.box(0.9, 3.6, 0.9, GL, { glow: true });
      for (let f = 0; f < 12; f++) w.box(0.92, 0.04, 0.92, WALL, { y: 0.3 * f + 0.28 });
      for (const [x, z] of [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]]) w.box(0.05, 3.6, 0.05, WALL, { x, z });
      w.box(0.6, 0.4, 0.6, WALL, { y: 3.6 });
      w.cyl(0.02, 0.03, 0.7, 5, 0x9aa0a6, { y: 4.0 });
      r.box(0.66, 0.05, 0.66, 0xffffff, { y: 4.0 });
      break;
    case 'bungalow':
      // suburban: bungalow with a garage and a hedge
      w.box(0.78, 0.36, 0.6, WALL, { x: -0.08 });
      w.box(0.36, 0.3, 0.5, WALL, { x: 0.5, z: -0.05 });
      w.box(0.3, 0.22, 0.02, 0xdcdcd8, { x: 0.5, z: 0.21 });
      w.box(0.14, 0.24, 0.02, 0x7a5a3a, { x: -0.2, z: 0.31 });
      win(w, 0.12, 0.2, 0.31, 0, 0.18);
      w.box(1.2, 0.12, 0.08, 0x4f8a4a, { z: 0.5 });
      r.roof(0.86, 0.26, 0.68, 0xffffff, { x: -0.08, y: 0.36 });
      r.box(0.4, 0.04, 0.54, 0xffffff, { x: 0.5, y: 0.3, z: -0.05 });
      break;
    case 'boathouse':
      // waterfront: harbour shed with a crane and bollards
      w.box(1.2, 0.56, 0.84, WALL);
      w.box(0.5, 0.42, 0.02, 0x3f5a7a, { x: -0.25, z: 0.43 });
      w.box(0.2, 0.3, 0.02, 0x5a4a3a, { x: 0.35, z: 0.43 });
      w.box(0.06, 1.1, 0.06, 0xe0a33a, { x: 0.55, z: 0.55 });
      w.box(0.7, 0.05, 0.05, 0xe0a33a, { x: 0.3, y: 1.08, z: 0.55 });
      for (const x of [-0.5, -0.1]) w.cyl(0.04, 0.05, 0.12, 6, 0x3a3f45, { x, z: 0.62 });
      r.roof(1.26, 0.22, 0.9, 0xffffff, { y: 0.56 });
      break;
    // ---------- landmarks ----------
    case 'cathedral':
      w.box(0.9, 0.95, 1.5, WALL, { z: 0.1 });
      w.box(1.4, 0.8, 0.5, WALL, { z: 0.15 });
      w.box(0.42, 1.8, 0.42, WALL, { z: -0.72 });
      for (const z of [-0.2, 0.2, 0.55]) { win(w, 0.46, 0.5, z, Math.PI / 2, 0.1, 0.34); win(w, -0.46, 0.5, z, Math.PI / 2, 0.1, 0.34); }
      w.cyl(0.14, 0.14, 0.02, 14, 0xd8c8f0, { y: 0.7, z: 0.86, rx: Math.PI / 2, center: true, glow: true });
      r.roof(0.96, 0.46, 1.56, 0xffffff, { y: 0.95, z: 0.1, ry: Math.PI / 2 });
      r.roof(1.46, 0.36, 0.56, 0xffffff, { y: 0.8, z: 0.15 });
      r.cone(0.3, 0.9, 4, 0xffffff, { y: 1.8, z: -0.72, ry: Math.PI / 4 });
      break;
    case 'museum':
      w.box(1.5, 0.12, 1.1, TRIM);
      w.box(1.3, 0.7, 0.9, WALL, { y: 0.12 });
      for (let k = 0; k < 6; k++) w.cyl(0.05, 0.05, 0.62, 8, TRIM, { x: -0.55 + k * 0.22, y: 0.12, z: 0.52 });
      r.roof(1.44, 0.26, 0.4, 0xffffff, { y: 0.82, z: 0.48 });
      r.sphere(0.36, 1, 0xffffff, { y: 0.9, sy: 0.7 });
      r.box(1.34, 0.06, 0.94, 0xffffff, { y: 0.82 });
      break;
    case 'monument':
      w.box(1.2, 0.06, 1.2, 0xcfc6b4);
      w.box(0.46, 0.2, 0.46, TRIM, { y: 0.06 });
      w.box(0.16, 1.5, 0.16, WALL, { y: 0.26 });
      w.cone(0.12, 0.2, 4, WALL, { y: 1.76, ry: Math.PI / 4 });
      for (const [x, z] of [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]]) { w.cyl(0.03, 0.04, 0.3, 5, 0x6b4a33, { x, z }); r.sphere(0.2, 0, 0xffffff, { x, y: 0.42, z }); }
      break;
    case 'stadium':
      w.box(1.7, 0.36, 1.3, WALL);
      w.box(1.3, 0.02, 0.9, 0x4f9a4a, { y: 0.36 });
      for (const [x, z, ry] of [[0, 0.58, 0], [0, -0.58, 0], [0.78, 0, Math.PI / 2], [-0.78, 0, Math.PI / 2]]) w.box(ry ? 1.1 : 1.6, 0.2, 0.18, TRIM, { x, y: 0.36, z, ry });
      for (const [x, z] of [[-0.8, -0.6], [0.8, -0.6], [-0.8, 0.6], [0.8, 0.6]]) { w.box(0.04, 0.9, 0.04, 0x6a6f76, { x, z }); w.box(0.16, 0.06, 0.08, 0xfff6c0, { x, y: 0.9, z, glow: true }); }
      r.box(1.66, 0.04, 0.2, 0xffffff, { y: 0.62, z: -0.6 });
      break;
    case 'clocktower':
      w.box(1.3, 0.6, 0.8, WALL);
      w.box(0.4, 1.7, 0.4, WALL, { x: 0.35 });
      for (const [x, z, ry] of [[0.35, 0.21, 0], [0.35, -0.21, Math.PI], [0.56, 0, Math.PI / 2], [0.14, 0, -Math.PI / 2]]) w.cyl(0.13, 0.13, 0.02, 12, 0xf4f0e6, { x, y: 1.45, z, rx: Math.PI / 2, ry, center: true, glow: true });
      for (const x of [-0.45, -0.15]) win(w, x, 0.3, 0.41, 0, 0.14, 0.2);
      r.roof(1.36, 0.28, 0.86, 0xffffff, { y: 0.6 });
      r.cone(0.3, 0.5, 4, 0xffffff, { x: 0.35, y: 1.7, ry: Math.PI / 4 });
      break;
    case 'tv_tower':
      w.cyl(0.4, 0.5, 0.12, 10, 0xcfc6b4);
      w.cyl(0.07, 0.14, 4.4, 8, WALL, { y: 0.12 });
      w.sphere(0.3, 1, GL, { y: 3.2, sy: 0.8, glow: true });
      w.cyl(0.32, 0.32, 0.08, 12, WALL, { y: 3.3 });
      w.cyl(0.02, 0.03, 1.0, 5, 0x9aa0a6, { y: 4.5 });
      w.sphere(0.05, 0, 0xff5040, { y: 5.5, glow: true });
      r.cyl(0.34, 0.3, 0.06, 12, 0xffffff, { y: 3.42 });
      break;
    case 'park':
      w.box(1.6, 0.03, 1.6, 0x6aa84f);
      w.box(1.5, 0.035, 0.12, 0xd8ccb0);
      w.box(0.12, 0.035, 1.5, 0xd8ccb0);
      w.cyl(0.2, 0.22, 0.08, 10, 0xb8b0a0, { y: 0.03 });
      w.cyl(0.16, 0.16, 0.02, 10, 0x5aa6d8, { y: 0.1, glow: true });
      for (const [x, z, s] of [[-0.5, -0.5, 1], [0.5, -0.45, 0.8], [-0.45, 0.5, 0.9], [0.55, 0.5, 1.1], [-0.15, -0.6, 0.7]]) { w.cyl(0.03, 0.04, 0.3 * s, 5, 0x6b4a33, { x, z }); r.sphere(0.24 * s, 0, 0xffffff, { x, y: 0.4 * s, z, sy: 0.9 }); }
      break;
    case 'convention':
      w.box(1.6, 0.5, 1.2, WALL);
      w.box(1.4, 0.4, 0.02, GL, { y: 0.06, z: 0.61, glow: true });
      w.box(1.7, 0.06, 1.3, TRIM, { y: 0.5 });
      r.sphere(0.8, 1, 0xffffff, { y: 0.5, sy: 0.35, sz: 0.75 });
      break;
    case 'lighthouse':
      w.cyl(0.32, 0.36, 0.2, 10, 0xb8b0a0);
      w.cyl(0.18, 0.26, 1.6, 10, WALL, { y: 0.2 });
      for (const y of [0.55, 1.1]) w.cyl(0.24, 0.24, 0.12, 10, 0xc94f4f, { y });
      w.cyl(0.2, 0.2, 0.24, 10, 0xfff6c0, { y: 1.8, glow: true });
      w.box(0.36, 0.3, 0.3, WALL, { x: 0.36, z: 0.1 });
      r.cone(0.24, 0.26, 10, 0xffffff, { y: 2.04 });
      r.roof(0.4, 0.14, 0.34, 0xffffff, { x: 0.36, y: 0.3, z: 0.1 });
      break;
    case 'market_hall':
      w.box(1.5, 0.08, 1.1, 0xcfc6b4);
      for (let k = 0; k < 5; k++) for (const z of [-0.45, 0.45]) w.cyl(0.04, 0.04, 0.55, 6, TRIM, { x: -0.6 + k * 0.3, y: 0.08, z });
      for (let k = 0; k < 4; k++) w.box(0.22, 0.14, 0.14, [0xc94f4f, 0xe0a33a, 0x5aa66a, 0x3f6e9a][k], { x: -0.45 + k * 0.3, y: 0.08 });
      r.roof(1.6, 0.4, 1.2, 0xffffff, { y: 0.63 });
      break;
    case 'university':
      w.box(1.6, 0.8, 0.7, WALL, { z: -0.2 });
      w.box(0.5, 0.6, 0.5, WALL, { x: -0.55, z: 0.4 });
      w.box(0.5, 0.6, 0.5, WALL, { x: 0.55, z: 0.4 });
      w.box(0.36, 1.3, 0.36, WALL, { z: -0.2 });
      w.cyl(0.1, 0.1, 0.02, 12, 0xf4f0e6, { y: 1.1, z: -0.02, rx: Math.PI / 2, center: true, glow: true });
      for (let k = 0; k < 5; k++) { win(w, -0.6 + k * 0.3, 0.3, 0.16); win(w, -0.6 + k * 0.3, 0.58, 0.16); }
      w.box(0.8, 0.02, 0.4, 0x6aa84f, { z: 0.45 });
      r.roof(1.66, 0.3, 0.76, 0xffffff, { y: 0.8, z: -0.2 });
      r.cone(0.26, 0.4, 4, 0xffffff, { y: 1.3, z: -0.2, ry: Math.PI / 4 });
      r.roof(0.54, 0.24, 0.54, 0xffffff, { x: -0.55, y: 0.6, z: 0.4 });
      r.roof(0.54, 0.24, 0.54, 0xffffff, { x: 0.55, y: 0.6, z: 0.4 });
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

const BUILDING_H = { cottage: 0.8, house: 0.9, house2: 1.2, townhouse: 1.2, shop: 0.7, apartment: 1.6, block: 1.6, office: 2.6, tower: 4.2, skyscraper: 7.2, civic: 1.8, warehouse: 0.9, plaza: 0.6,
  terrace: 1.4, chalet: 1.0, farmhouse: 1.0, factory: 1.2, hotel: 2.0, glasstower: 4.4, bungalow: 0.6, boathouse: 1.1, cathedral: 2.7, museum: 1.2, monument: 1.9, stadium: 0.9, clocktower: 2.2, tv_tower: 5.6, park: 0.6, convention: 1.1, lighthouse: 2.3, market_hall: 1.0, university: 1.7 };

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
      const cap = a === 'house' || a === 'house2' || a === 'cottage' || a === 'townhouse' ? 900 : a === 'plaza' ? 80 : LANDMARKS.includes(a) ? 40 : ARCH.indexOf(a) >= 13 ? 300 : 500;
      this.pools[a] = new InstancePool(g.walls, MATS, cap);
      this.roofPools[a] = new InstancePool(g.roof, MATS, cap, true, 'rslot');
      this.group.add(this.pools[a].mesh, this.roofPools[a].mesh);
    }
    // street lamps (the town's cars: road/Traffic.js)
    const lm = new ModelBuilder();
    lm.cyl(0.02, 0.025, 0.7, 5, 0x3a3f45);
    lm.box(0.16, 0.03, 0.04, 0x3a3f45, { y: 0.68, x: 0.06 });
    lm.box(0.08, 0.04, 0.06, 0xfff0c0, { y: 0.64, x: 0.12, glow: true });
    this.lamps = new InstancePool(lm.build(), MATS, 1500, false);
    this.group.add(this.lamps.mesh);
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
      const a = b.arch;
      const k = LANDMARKS.includes(a) || a === 'hotel' ? (t.kind === 'tourism' || a === 'hotel' || a === 'museum' || a === 'monument' ? 'tourist' : a === 'university' ? 'campus' : 'core')
        : a === 'civic' || a === 'plaza' || (d <= 1 && (a === 'townhouse' || a === 'shop' || a === 'terrace')) ? 'core'
          : quarter.has(b.tile) && a !== 'warehouse' && a !== 'factory' ? 'station'
            : a === 'factory' ? 'industry'
              : a === 'warehouse' || a === 'boathouse' ? 'logistics'
                : a === 'office' || a === 'shop' || a === 'glasstower' ? 'business'
                  : a === 'apartment' || a === 'block' || a === 'tower' || a === 'skyscraper' ? 'dense'
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
    const used = {};
    this.list = world.towns.map((s, k) => {
      const u = used[s.region] || (used[s.region] = {});
      const a = pickArchetype(s, world, REGIONS, k, u);
      u[a.kind] = (u[a.kind] || 0) + 1;
      return {
        id: 1 + k, name: s.name, x: s.x, z: s.z, region: s.region, tourist: s.tourist, seed: s.seed,
        stage: 0, progress: {}, pop: TOWN_POP[0], paxAcc: 0, mailAcc: 0, delivered: 0, buildings: [], lampsList: [],
        received: {}, kind: a.kind, plan: ARCHETYPES[a.kind].plan, axis: a.axis,
      };
    });
  }
  // the town's archetype and architecture family (a bias for everything it does)
  arch(t) { return ARCHETYPES[t.kind] || ARCHETYPES.commuter; }
  family(t) { return FAMILIES[this.arch(t).family] || FAMILIES.traditional; }
  // travellers: the archetype, the season for tourist towns, and a shared
  // urban area with neighbouring big towns (commuter flows)
  paxMul(t) {
    const A = this.arch(t);
    let m = A.pax;
    if (A.seasonal && this.game.env && this.game.env.season) { const se = this.game.env.season(); m *= se === 'summer' ? 1.3 : se === 'winter' ? 0.85 : 1; }
    if (t.stage >= 4) m *= 1 + Math.min(0.3, 0.1 * this.metroWith(t).filter((o) => o.stage >= 4).length);
    return m;
  }

  requirement(t) {
    if (t.stage >= TOWN_REQ.length) return null;
    const base = TOWN_REQ[t.stage];
    const g = this.game;
    const mul = (1 + g.progression.fx.townReq) * g.difficulty.growthMul;
    const A = this.arch(t).req || {};
    const r = {};
    for (const c in base) r[c] = Math.max(5, Math.round(base[c] * mul * (A[c] || 1)));
    return r;
  }
  needs(t, c) {
    const r = this.requirement(t);
    return !!(r && r[c] && (t.progress[c] || 0) < r[c]);
  }

  receive(t, c, n) {
    t.delivered += n;
    // building materials: the town builds faster next month
    if (c === 'MATERIALS') t.mat = (t.mat || 0) + n;
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
      // building materials delivered last month: extra plots and renewals
      t.matLast = t.mat || 0; t.mat = 0;
      if (sts.length && t.matLast > 0) budget += Math.min(MATERIALS_GROWTH.max, Math.floor(t.matLast / MATERIALS_GROWTH.per) + 1);
      t.lastBudget = budget;
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
      const pax = (P.paxBase + t.pop * P.paxPerPop) * (1 + fx.paxProd + (ev.paxProd || 0)) * (t.tourist ? 1.5 : 1) * (g.pax ? g.pax.townMul(sts) : 1) * this.paxMul(t);
      const mail = (P.mailBase + t.pop * P.mailPerPop) * (1 + fx.mailProd) * this.arch(t).mail;
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
  onStationsChanged() { for (const t of this.list) { t._sts = null; t._cov = null; t._gap = null; } }
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
  // Parts of a town no stop or station reaches (Transport advisor): the
  // largest uncovered quarter (north, east, south, west, centre) by building
  // weight, or none: no public transport at all. Cached a while.
  gaps(t) {
    const g = this.game;
    if (t._gap && g.time >= t._gap.t && g.time - t._gap.t < 20 && t._gap.n === t.buildings.length) return t._gap.v;
    const S = g.stations, R = g.roads;
    const sts = [...S.list, ...(R ? R.stops : [])].filter((s) => !s.owner && s.links && s.links.towns.includes(t.id) && (!s.road || s.kind === 'bus' || s.kind === 'tram'));
    let v = null;
    if (!sts.length) v = { none: true };
    else {
      const shapes = sts.map((s) => ({ tiles: s.road ? R.stopTiles(s) : S.allTiles(s), r: s.road ? R.stopRadius(s) : S.radius(s) }));
      const areas = {};
      let tot = 0;
      for (const b of t.buildings) {
        const w = ARCH_W[b.arch] || 1;
        tot += w;
        if (shapes.some((sh) => sh.tiles.some((u) => cheb(u, b.tile) <= sh.r))) continue;
        const dx = tx(b.tile) - t.x, dz = tz(b.tile) - t.z;
        const k = Math.max(Math.abs(dx), Math.abs(dz)) <= 1 ? 'centre' : Math.abs(dx) >= Math.abs(dz) ? (dx > 0 ? 'east' : 'west') : (dz > 0 ? 'south' : 'north');
        const a = areas[k] || (areas[k] = { w: 0, tile: b.tile });
        a.w += w;
      }
      const best = Object.entries(areas).sort((a, b) => b[1].w - a[1].w)[0];
      v = best && tot ? { area: best[0], share: best[1].w / tot, weight: best[1].w, tile: best[1].tile } : { share: 0 };
    }
    t._gap = { t: g.time, n: t.buildings.length, v };
    return v;
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
  // the town's street plan (older saves: the plain grid)
  isRoad(t, x, z) { return streetAt(t.plan || 'grid3', x - t.x, z - t.z, t.axis || 0); }

  candidateTiles(t) {
    if (t._cands) return t._cands;
    const out = [];
    const plan = t.plan || 'grid3', ax = t.axis || 0;
    const R = plan === 'linear' ? 10 : 6;
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      const x = t.x + dx, z = t.z + dz;
      if (!inMap(x, z) || x < 1 || z < 1 || x > N - 2 || z > N - 2) continue;
      const d = planDist(plan, dx, dz, ax);
      if (d > 6) continue;
      const h = (hashStr(`${t.seed}:${dx}:${dz}`) % 1000) / 1000;
      out.push({ x, z, dx, dz, d, h, road: streetAt(plan, dx, dz, ax) });
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
    let a = this.baseArch(t, c);
    // the town's height limit (a historic centre, a market town, a valley);
    // a big city's second centre may rise above it
    const cap = this.arch(t).cap;
    if (cap && HEIGHT_ORDER.indexOf(a) > HEIGHT_ORDER.indexOf(cap)) {
      const sc = t.stage >= 5 ? this.subCentre(t) : null;
      if (!sc || Math.max(Math.abs(c.x - sc[0]), Math.abs(c.z - sc[1])) > 1) a = cap;
    }
    // the local architecture family replaces most common types
    const sub = this.family(t).subs[a];
    return sub && (c.h * 13.7) % 1 < 0.7 ? sub : a;
  }
  baseArch(t, c) {
    const s = t.stage, A = this.arch(t);
    const rail = this.railInfluence(t, c);
    if (rail.goods && s >= 2 && c.h > 0.3 && c.h < 0.75) return 'warehouse';
    // industrial towns: works and sheds on the outskirts; ports: sheds by the water
    if (t.kind === 'industrial' && s >= 1 && c.d >= Math.max(2, TOWN_RADIUS[s] - 1) && c.h > 0.62) return c.h > 0.82 ? 'factory' : 'warehouse';
    if (t.kind === 'port' && s >= 1 && c.h > 0.4 && this.nearWater(c)) return 'boathouse';
    let dens = s - c.d * 0.75 + c.h * 0.8 + rail.boost + A.dens;
    // commuter towns: wide low suburbs around a denser core
    if (t.kind === 'commuter' && c.d >= 3) dens -= 1.3;
    // big cities grow a second centre of high buildings
    if (s >= 5) { const sc = this.subCentre(t); dens += Math.max(0, 1.8 - Math.max(Math.abs(c.x - sc[0]), Math.abs(c.z - sc[1])) * 0.6); }
    if (dens < 0.2) return c.h > 0.5 ? 'house' : 'cottage';
    if (dens < 0.8) return c.h > 0.6 ? 'house2' : c.h > 0.3 ? 'house' : 'cottage';
    if (dens < 1.5) return c.h > 0.55 ? 'house2' : c.h > 0.3 ? 'townhouse' : 'shop';
    if (dens < 2.4) return c.h > 0.6 ? 'apartment' : c.h > 0.3 ? 'townhouse' : 'shop';
    if (dens < 3.3) return c.h > 0.5 ? 'apartment' : 'block';
    if (dens < 4.3) return c.h > 0.55 ? 'office' : 'block';
    if (dens < 5.2) return c.h > 0.4 ? 'tower' : c.h > 0.2 ? 'office' : 'block';
    return c.h > 0.35 ? 'skyscraper' : 'tower';
  }
  nearWater(c) {
    const W = this.game.world;
    for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2]]) { const x = c.x + ox, z = c.z + oz; if (inMap(x, z) && W.type[idx(x, z)] === 1) return true; }
    return false;
  }
  // a second centre for big cities: along the town's axis, or by its busiest station
  subCentre(t) {
    if (t._sub) return t._sub;
    const S = this.game.stations;
    let best = null, bn = 0;
    for (const st of S.list) { if (!st.links || !st.links.towns.includes(t.id)) continue; const d = Math.max(Math.abs(tx(st.tile) - t.x), Math.abs(tz(st.tile) - t.z)); const n = (st.stats && st.stats.arrivals) || 0; if (d >= 3 && d <= 6 && n >= bn) { bn = n; best = [tx(st.tile), tz(st.tile)]; } }
    if (!best) { const k = (hashStr('sub:' + t.seed) % 4); best = t.axis ? [t.x + (k < 2 ? 0 : k === 2 ? 2 : -2), t.z + (k % 2 ? 4 : -4)] : [t.x + (k % 2 ? 4 : -4), t.z + (k < 2 ? 0 : k === 2 ? 2 : -2)]; }
    t._sub = best;
    return best;
  }
  // passenger stations serving this town raise density around them (more with
  // level and traffic; railway towns most); goods stations within 2 tiles attract warehouses
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
      boost = Math.max(boost, (0.5 + 0.18 * st.level + 0.4 * busy) * (1 - d / 5) * this.arch(t).rail);
    }
    return { boost, goods };
  }

  // how many buildings the town is heading for: its stage, plus infill while
  // it works towards the next stage
  buildTarget(t) {
    const a = TOWN_BUILDINGS[t.stage], b = TOWN_BUILDINGS[Math.min(6, t.stage + 1)];
    return Math.round((a + Math.floor((b - a) * 0.6 * this.progressFrac(t))) * this.arch(t).growth);
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
    // landmarks: one as a town, a second as a city, a third as a metropolis
    const lms = this.arch(t).landmarks.filter((id, k) => t.stage >= LANDMARK_STAGE[k]);
    const lmDone = lms.map(() => false);
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
      else { const k = lmDone.findIndex((done, j) => !done && c.d === 2 + j && c.h >= 0.5); if (k >= 0) { arch = lms[k]; lmDone[k] = true; } }
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
      if (b) { keep.push(b); occ.blocked[tile] = 1; occ.owner[tile] = t.id; if (animate && LANDMARKS.includes(arch)) this.game.events.emit('townLandmark', t, arch); }
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
    // face the nearest road (towards the centre where there are several)
    const dx = x - t.x, dz = z - t.z;
    let rot = 0;
    if (!t.plan || t.plan === 'grid3') {
      const mx = ((dx % 3) + 3) % 3, mz = ((dz % 3) + 3) % 3;
      if (mz === 1) rot = Math.PI; else if (mz === 2) rot = 0;
      if (Math.abs(dx) > Math.abs(dz)) rot = mx === 1 ? -Math.PI / 2 : Math.PI / 2;
    } else {
      let best = 1e9;
      for (const [ox, oz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        if (!this.isRoad(t, x + ox, z + oz)) continue;
        const d = planDist(t.plan, dx + ox, dz + oz, t.axis || 0);
        if (d < best) { best = d; rot = Math.atan2(ox, oz); }
      }
    }
    const wx = (x + 0.5) * TILE + rng.range(-0.2, 0.2), wz = (z + 0.5) * TILE + rng.range(-0.2, 0.2);
    // sit on the lowest corner so buildings never float
    let h = 1e9;
    for (const [ox, oz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) h = Math.min(h, heightAt(W, wx + ox, wz + oz));
    const biome = BIOMES[REGIONS[t.region].biome];
    const F = this.family(t);
    b.pos = [wx, h - 0.05, wz];
    b.rot = rot;
    const lm = LANDMARKS.includes(arch);
    b.scale = arch === 'house' || arch === 'house2' || arch === 'cottage' || arch === 'chalet' || arch === 'bungalow' ? rng.range(1.2, 1.45) : arch === 'plaza' || lm ? 1.3 : rng.range(1.25, 1.45);
    // colours: the town's architecture family, blended with the region's roofs
    // (subtle: the same family varies from house to house)
    const pitched = arch === 'house' || arch === 'house2' || arch === 'civic' || arch === 'cottage' || arch === 'townhouse' || arch === 'terrace' || arch === 'chalet' || arch === 'farmhouse' || arch === 'bungalow' || arch === 'boathouse' || arch === 'factory';
    b.wall = shade(rng.pick(F.walls), rng.range(0.96, 1.04));
    b.roofC = arch === 'plaza' || arch === 'park' || arch === 'monument' ? shade(0x4f8a4a, rng.range(0.9, 1.1)) : pitched || lm ? (rng.chance(0.6) ? rng.pick(F.roofs) : rng.pick(biome.roof)) : shade(0x8a8f96, rng.range(0.8, 1.1));
    if (arch === 'office' || arch === 'tower' || arch === 'skyscraper' || arch === 'glasstower') b.wall = rng.pick(F.towers);
    if (arch === 'block' || arch === 'hotel') b.wall = shade(rng.pick(F.walls), rng.range(0.9, 1.0));
    if (arch === 'warehouse' || arch === 'plaza' || arch === 'park' || arch === 'stadium' || arch === 'tv_tower' || arch === 'lighthouse') b.wall = 0xffffff;
    if (lm && b.wall !== 0xffffff) b.wall = shade(F.walls[0], 1.02);
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
    if (this.game.traffic) this.game.traffic.townChanged(t);
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
      return { id: t.id, mat: t.mat ? Math.round(t.mat) : undefined, kind: t.kind, plan: t.plan || 'grid3', axis: t.axis || undefined, stage: t.stage, progress: t.progress, pop: Math.round(t.pop), delivered: t.delivered, received: t.received, bld: t.buildings.map((b) => [b.tile, ARCH.indexOf(b.arch)]), renewed: t.renewed || undefined, auth: this.game.authority ? this.game.authority.serializeTown(t) : undefined, cleared: Object.keys(cl).length ? cl : undefined };
    });
  }
  deserialize(arr) {
    if (!Array.isArray(arr)) return;
    for (const d of arr) {
      const t = this.byId(d.id);
      if (!t) continue;
      // archetype (older saves: from the surroundings, as for a new world) and
      // street plan (older saves: the plain grid the buildings stand on)
      if (ARCHETYPES[d.kind]) t.kind = d.kind;
      t.plan = ['grid3', 'grid4', 'radial', 'organic', 'linear'].includes(d.plan) ? d.plan : 'grid3';
      t.axis = d.axis === 1 ? 1 : 0;
      t._cands = null; t._sub = null;
      t.stage = Math.max(0, Math.min(6, d.stage | 0));
      t.mat = Number.isFinite(+d.mat) && d.mat > 0 ? Math.min(1e5, +d.mat) : 0;
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
