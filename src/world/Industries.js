// Industries: production chains, storage, station supply, level growth and
// procedural animated visuals.
import * as THREE from 'three';
import { N, TILE, idx, cheb } from '../util.js';
import { INDUSTRIES, INDUSTRY_LEVEL_THRESH, TOWN_ACCEPTS } from '../config.js';
import { ModelBuilder, meshFrom, shade, MATS } from '../core/ModelBuilder.js';
import { t as tr } from '../i18n.js';

export class IndustrySystem {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.cropMat = new THREE.MeshLambertMaterial({ color: 0x8ab04a, flatShading: true });
  }

  byId(id) { return this.list.find((i) => i.id === id); }
  displayName(ind) { return `${ind.townName} ${tr('ind_' + ind.type)}`; }

  init(world) {
    this.list = world.industries.map((s, k) => ({
      id: 1000 + k, type: s.type, x: s.x, z: s.z, region: s.region, townName: s.townName,
      level: 0, inp: {}, out: {}, cycles: 0, every: {}, transported: 0, produced: 0, idle: 0,
    }));
    for (const ind of this.list) this.markFootprint(ind);
  }

  markFootprint(ind) {
    const occ = this.game.occupancy;
    for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) {
      const i = idx(ind.x + dx, ind.z + dz);
      occ.blocked[i] = 2; occ.owner[i] = ind.id;
    }
  }

  capacity(ind) { return INDUSTRIES[ind.type].storage * (1 + ind.level); }
  accepts(ind, c) {
    const cfg = INDUSTRIES[ind.type];
    if (cfg.accepts && cfg.accepts.includes(c)) return true;
    return cfg.recipes.some((r) => c in r.in);
  }
  inputs(ind) { const s = new Set(); const cfg = INDUSTRIES[ind.type]; for (const r of cfg.recipes) for (const c in r.in) s.add(c); if (cfg.accepts) for (const c of cfg.accepts) s.add(c); return [...s]; }
  outputs(ind) { const s = new Set(); for (const r of INDUSTRIES[ind.type].recipes) for (const c in r.out) s.add(c); return [...s]; }

  receive(ind, c, n) {
    const cfg = INDUSTRIES[ind.type];
    if (cfg.accepts && cfg.accepts.includes(c) && !cfg.recipes.some((r) => c in r.in)) {
      // export sink (port): counts toward growth
      ind.transported += n * 0.5;
      this.checkLevel(ind);
      return;
    }
    ind.inp[c] = Math.min((ind.inp[c] || 0) + n, this.capacity(ind) * 2);
    ind.transported += n * 0.5;
    this.checkLevel(ind);
  }

  linkedStations(ind) { return [...this.game.stations.list, ...(this.game.roads ? this.game.roads.stops : [])].filter((s) => s.links && s.links.industries.includes(ind.id)); }
  // Where each output could go: consumers (towns / industries) by distance,
  // with the connection state and an estimated income for a 10-unit load.
  //   served: both ends have a station on the same rail network
  //   station: the destination has a station, not yet connected
  //   none: no station at the destination yet
  opportunities(ind, max = 3) {
    const g = this.game, net = g.net;
    const comp = net.components();
    const mine = this.linkedStations(ind);
    const myComps = new Set(mine.map((s) => comp[s.tile]).filter((c) => c >= 0));
    const cx = ind.x + 1, cz = ind.z + 1;
    const out = [];
    for (const c of this.outputs(ind)) {
      const dests = [];
      for (const t of g.towns.list) if (TOWN_ACCEPTS.includes(c)) dests.push({ kind: 'town', id: t.id, name: t.name, x: t.x, z: t.z, region: t.region });
      for (const o of this.list) if (o !== ind && this.inputs(o).includes(c)) dests.push({ kind: 'industry', id: o.id, name: this.displayName(o), x: o.x + 1, z: o.z + 1, region: o.region });
      for (const d of dests) {
        d.dist = Math.max(Math.abs(d.x - cx), Math.abs(d.z - cz));
        const sts = g.stations.list.filter((s) => s.links && (d.kind === 'town' ? (s.links.towns || []).includes(d.id) : (s.links.industries || []).includes(d.id)));
        d.state = sts.some((s) => myComps.has(comp[s.tile])) ? 'served' : sts.length ? 'station' : 'none';
        d.value = Math.round(g.economy.revenue(c, 10, d.dist, null, false));
        d.locked = !g.progression.regionUnlocked(d.region);
      }
      dests.sort((a, b) => (a.locked - b.locked) || ((a.state === 'served' ? 0 : 1) - (b.state === 'served' ? 0 : 1)) || (b.value / (8 + b.dist) - a.value / (8 + a.dist)));
      out.push({ c, dests: dests.slice(0, max) });
    }
    return out;
  }
  transportShare(ind) { return ind.produced > 0 ? Math.min(1, ind.transported / ind.produced) : 0; }

  rate(ind) {
    const g = this.game, cfg = INDUSTRIES[ind.type], fx = g.progression.fx, ev = g.economy.eventFx;
    let r = cfg.rate * (1 + 0.5 * ind.level) * (1 + fx.industryProd);
    if (!cfg.primary) r *= 1 + fx.processing;
    if (ind.type === 'FARM') r *= 1 + (ev.farmProd || 0);
    if (ind.type === 'MINE' || ind.type === 'COAL_MINE') r *= 1 + (ev.mineProd || 0);
    return r * g.difficulty.growthMul ** 0;
  }

  tick(dt) {
    const g = this.game;
    for (const ind of this.list) {
      if (!g.progression.regionUnlocked(ind.region)) continue;
      const cfg = INDUSTRIES[ind.type];
      const cap = this.capacity(ind);
      ind.cycles = Math.min(ind.cycles + (this.rate(ind) / 60) * dt, 4);
      let produced = false;
      while (ind.cycles >= 1) {
        ind.cycles -= 1;
        for (let ri = 0; ri < cfg.recipes.length; ri++) {
          const rc = cfg.recipes[ri];
          if (rc.every) { ind.every[ri] = (ind.every[ri] || 0) + 1; if (ind.every[ri] < rc.every) continue; ind.every[ri] = 0; }
          let ok = true;
          for (const c in rc.in) { const have = (ind.inp[c] || 0) + (c in rc.out ? 0 : (ind.out[c] || 0) * (c === 'GOODS' ? 1 : 0)); if (have < rc.in[c]) ok = false; }
          if (!ok) continue;
          let room = true;
          for (const c in rc.out) if ((ind.out[c] || 0) + rc.out[c] > cap) room = false;
          if (!room) continue;
          for (const c in rc.in) {
            let need = rc.in[c];
            const fromIn = Math.min(need, ind.inp[c] || 0);
            ind.inp[c] = (ind.inp[c] || 0) - fromIn; need -= fromIn;
            if (need > 0) ind.out[c] = Math.max(0, (ind.out[c] || 0) - need);
          }
          for (const c in rc.out) { ind.out[c] = (ind.out[c] || 0) + rc.out[c]; ind.produced += rc.out[c]; }
          produced = true;
        }
      }
      ind.active = produced ? 1 : Math.max(0, (ind.active || 0) - dt * 0.2);
      // supply linked stations
      const sts = ind._sts || (ind._sts = this.linkedStations(ind));
      if (sts.length) {
        for (const c in ind.out) {
          let amt = Math.floor(ind.out[c]);
          if (amt < 1) continue;
          // competing stations share by cargo rating; a poorly served
          // station gets less (the rest stays at the industry)
          const shares = g.ratings ? g.ratings.split(sts, c, amt) : sts.map(() => Math.ceil(amt / sts.length));
          for (let i = 0; i < sts.length; i++) {
            const want = Math.min(shares[i], Math.floor(ind.out[c]));
            if (want <= 0) continue;
            const took = g.stations.receive(sts[i], c, want);
            ind.out[c] -= took; ind.transported += took;
          }
        }
        this.checkLevel(ind);
      }
    }
  }

  onStationsChanged() { for (const ind of this.list) ind._sts = null; }

  checkLevel(ind) {
    if (ind.level >= 4) return;
    const thr = INDUSTRY_LEVEL_THRESH[ind.level] * (1 - this.game.progression.fx.industryGrowth);
    if (ind.transported >= thr) {
      ind.level++;
      this.buildVisual(ind);
      this.game.stats.max('maxIndustryLevel', ind.level);
      this.game.events.emit('industryLevel', ind);
    }
  }

  levelProgress(ind) {
    if (ind.level >= 4) return 1;
    const thr = INDUSTRY_LEVEL_THRESH[ind.level] * (1 - this.game.progression.fx.industryGrowth);
    const prev = ind.level ? INDUSTRY_LEVEL_THRESH[ind.level - 1] * (1 - this.game.progression.fx.industryGrowth) : 0;
    return Math.max(0, Math.min(1, (ind.transported - prev) / (thr - prev)));
  }

  // ---------- visuals ----------
  baseHeight(ind) {
    const W = this.game.world;
    let h = 0;
    for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) h += W.tileH[idx(ind.x + dx, ind.z + dz)];
    return Math.max(h / 4, 0.2);
  }

  buildVisual(ind) {
    if (ind.obj) { this.group.remove(ind.obj); ind.obj.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
    const root = new THREE.Group();
    const mb = new ModelBuilder();
    const anims = [], emitters = [];
    const ctx = { mb, anims, emitters, level: ind.level, seed: ind.id, crops: null };
    // foundation slab
    mb.box(3.7, 0.5, 3.7, ind.type === 'FARM' ? 0x8a7a4a : ind.type === 'FOREST' ? 0x6a5a3a : 0x9a948a, { y: -0.42 });
    INDUSTRY_MODELS[ind.type](ctx);
    const mesh = meshFrom(mb.build());
    root.add(mesh);
    for (const a of anims) {
      const m = meshFrom(a.mb.build());
      m.position.set(a.x, a.y, a.z);
      if (a.ry) m.rotation.y = a.ry;
      root.add(m);
      a.mesh = m;
    }
    if (ctx.crops) {
      const cm = new THREE.Mesh(ctx.crops.build(), this.cropMat);
      cm.receiveShadow = true;
      root.add(cm);
    }
    const s = 0.92 + ind.level * 0.03;
    root.scale.setScalar(s);
    root.position.set((ind.x + 1) * TILE, this.baseHeight(ind), (ind.z + 1) * TILE);
    root.rotation.y = ((ind.id * 37) % 4) * (Math.PI / 2);
    root.userData.industry = ind.id;
    ind.obj = root; ind.anims = anims; ind.emitters = emitters;
    ind.rise = 1;
    this.group.add(root);
  }

  buildAllVisuals() { for (const ind of this.list) { this.buildVisual(ind); ind.rise = 0; } }

  updateVisuals(dt, time) {
    const g = this.game;
    const season = (Math.sin(time * 0.02) + 1) / 2;
    this.cropMat.color.setHSL(0.25 - season * 0.13, 0.55, 0.42 + season * 0.08);
    const v = new THREE.Vector3();
    for (const ind of this.list) {
      if (!ind.obj) continue;
      const on = g.progression.regionUnlocked(ind.region);
      const act = on ? 0.35 + 0.65 * (ind.active || 0) : 0;
      for (const a of ind.anims) {
        if (a.type === 'spin') a.mesh.rotation[a.axis || 'x'] += dt * a.speed * act;
        else if (a.type === 'nod') a.mesh.rotation.z = Math.sin(time * a.speed + a.phase) * 0.35 * act;
        else if (a.type === 'swing') a.mesh.rotation.y = (a.ry || 0) + Math.sin(time * a.speed + a.phase) * 0.8 * act;
      }
      if (ind.rise > 0) {
        ind.rise = Math.max(0, ind.rise - dt * 1.2);
        const k = 1 - ind.rise;
        ind.obj.scale.y = (0.92 + ind.level * 0.03) * (0.4 + 0.6 * (1 - Math.pow(1 - k, 3)));
      }
      if (on && g.particles && ind.emitters.length) {
        ind._e = (ind._e || 0) + dt * (0.4 + act);
        if (ind._e > 0.8) {
          ind._e = 0;
          for (const e of ind.emitters) {
            v.set(e.x, e.y, e.z);
            ind.obj.localToWorld(v);
            g.particles.emit(e.type, v.x, v.y, v.z, 1);
          }
        }
      }
    }
  }

  serialize() {
    return this.list.map((i) => ({ id: i.id, level: i.level, inp: i.inp, out: i.out, transported: i.transported, produced: i.produced }));
  }
  deserialize(arr) {
    if (!Array.isArray(arr)) return;
    for (const d of arr) {
      const ind = this.byId(d.id);
      if (!ind) continue;
      ind.level = Math.max(0, Math.min(4, d.level | 0));
      ind.inp = sanitizeStore(d.inp); ind.out = sanitizeStore(d.out);
      ind.transported = +d.transported || 0; ind.produced = +d.produced || 0;
    }
  }
}

function sanitizeStore(o) {
  const r = {};
  if (o && typeof o === 'object') for (const k in o) if (typeof o[k] === 'number' && isFinite(o[k]) && o[k] > 0) r[k] = o[k];
  return r;
}

// ---------- industry models (local frame centred on 2x2 footprint, ~3.6 units wide) ----------
const DARK = 0x3a3d42, METAL = 0x8c939a, CONC = 0xb8b2a6, RUST = 0x9a5a3a, GLASS = 0x3a4a5a;

function spinPart(ctx, x, y, z, build, speed, axis = 'x', ry = 0) {
  const mb = new ModelBuilder();
  build(mb);
  ctx.anims.push({ mb, x, y, z, type: 'spin', speed, axis, ry });
}

function logPile(mb, x, z, n, col = 0x8a5a33) {
  for (let r = 0; r < 2; r++) for (let k = 0; k < n - r; k++) mb.hcyl(0.09, 0.9, 7, shade(col, 1 - (k % 3) * 0.08), { x, y: 0.1 + r * 0.16, z: z - (n - 1) * 0.09 + k * 0.18 + r * 0.09 });
}

function shed(mb, x, z, w, d, h, wall, roof, ry = 0) {
  mb.box(w, h, d, wall, { x, z, ry });
  mb.roof(w + 0.08, h * 0.45, d + 0.1, roof, { x, y: h, z, ry });
}

function chimney(ctx, x, z, h, r, col = 0x8a4a3a, type = 'smoke') {
  ctx.mb.cyl(r * 0.8, r, h, 8, col, { x, z });
  ctx.mb.cyl(r * 0.9, r * 0.9, 0.08, 8, DARK, { x, y: h - 0.04, z });
  ctx.emitters.push({ x, y: h + 0.1, z, type });
}

const INDUSTRY_MODELS = {
  FOREST(ctx) {
    const { mb, level } = ctx;
    shed(mb, -0.9, -0.9, 1.0, 0.8, 0.55, 0x8a5a3a, 0x4a3a2a);
    chimney(ctx, -0.6, -1.1, 1.0, 0.07, 0x5a5a5a);
    logPile(mb, 0.6, -0.8, 4);
    logPile(mb, 0.6, 0.4, 3 + Math.min(2, level));
    if (level >= 1) logPile(mb, -0.6, 0.8, 4);
    if (level >= 2) shed(mb, -0.8, 0.6, 0.8, 0.9, 0.5, 0x9a6a4a, 0x4a3a2a);
    // loader crane
    mb.box(0.1, 1.2, 0.1, 0xd0a030, { x: 1.2, z: 1.2 });
    spinPart(ctx, 1.2, 1.2, 1.2, (m) => { m.box(1.2, 0.07, 0.07, 0xd0a030, { x: -0.4 }); m.box(0.03, 0.3, 0.03, DARK, { x: -0.9, y: -0.3 }); }, 0.4, 'y');
    for (let k = 0; k < 4 + level; k++) mb.cyl(0.08, 0.1, 0.12, 6, 0x7a5a3a, { x: -1.5 + ((k * 7) % 5) * 0.2, z: 1.4 - k * 0.1 });
    if (level >= 3) { mb.box(1.1, 0.3, 0.6, 0x5a6a4a, { x: 0, z: 1.3 }); mb.box(0.4, 0.3, 0.55, 0x5a6a4a, { x: 0.55, y: 0.3, z: 1.3 }); }
  },
  FARM(ctx) {
    const { mb, level } = ctx;
    shed(mb, -0.8, -0.8, 1.2, 0.9, 0.7, 0xb04a3a, 0x5a3a2a);
    mb.box(0.3, 0.45, 0.02, 0xe8e0d0, { x: -0.8, z: -0.34 });
    const silos = 1 + Math.min(3, level);
    for (let k = 0; k < silos; k++) { mb.cyl(0.24, 0.24, 1.3, 10, 0xd8d2c4, { x: 0.2 + k * 0.52, z: -1.2 }); mb.cone(0.26, 0.3, 10, METAL, { x: 0.2 + k * 0.52, y: 1.3, z: -1.2 }); }
    shed(mb, 1.2, -0.2, 0.6, 0.6, 0.45, 0xf0ead8, 0x7a3f33);
    // windmill
    mb.cyl(0.08, 0.14, 1.5, 6, 0xe8e0d0, { x: -1.4, z: 0.4 });
    spinPart(ctx, -1.4, 1.45, 0.52, (m) => { for (let k = 0; k < 4; k++) m.box(0.06, 0.7, 0.02, 0xf4f0e6, { rz: (k * Math.PI) / 2, y: 0 }); }, 1.5, 'z');
    // crop rows
    const cr = new ModelBuilder();
    for (let r = 0; r < 6; r++) cr.box(2.4, 0.14 + (r % 2) * 0.03, 0.18, 0xffffff, { x: 0.35, z: 0.2 + r * 0.24 });
    if (level >= 2) for (let r = 0; r < 3; r++) cr.box(0.9, 0.14, 0.18, 0xffffff, { x: -1.2, z: 1.0 + r * 0.24 });
    ctx.crops = cr;
    mb.box(0.3, 0.2, 0.2, 0x3a6a3a, { x: 1.4, z: 1.5 });
    mb.wheel(0.1, 0.06, 8, DARK, { x: 1.3, y: 0.1, z: 1.62 });
  },
  MINE(ctx) { mineModel(ctx, 0x8a6f63, false); },
  COAL_MINE(ctx) { mineModel(ctx, 0x2b2b30, true); },
  OIL_FIELD(ctx) {
    const { mb, level } = ctx;
    const n = 1 + Math.min(3, level);
    const spots = [[-0.9, -0.9], [0.8, 0.8], [-0.9, 0.9], [0.8, -0.9]];
    for (let k = 0; k < n; k++) {
      const [x, z] = spots[k];
      mb.box(0.5, 0.1, 0.3, DARK, { x, z });
      mb.box(0.08, 0.7, 0.08, METAL, { x, y: 0.1, z: z - 0.1, rz: 0.2 });
      mb.box(0.08, 0.7, 0.08, METAL, { x, y: 0.1, z: z + 0.1, rz: 0.2 });
      const b = new ModelBuilder();
      b.box(1.0, 0.1, 0.1, 0x2a2a2e);
      b.box(0.16, 0.3, 0.14, 0xd0a030, { x: 0.5, y: -0.25 });
      b.box(0.2, 0.2, 0.18, DARK, { x: -0.5, y: -0.1 });
      ctx.anims.push({ mb: b, x, y: 0.82, z, type: 'nod', speed: 1.8, phase: k * 1.3 });
    }
    for (let k = 0; k < 1 + Math.floor(level / 2); k++) mb.cyl(0.35, 0.35, 0.6, 12, 0xd8dde2, { x: 1.1 - k * 0.8, z: -0.2 + (k % 2) * 0.5 });
    mb.box(2.2, 0.05, 0.08, METAL, { y: 0.2, z: 0.1 });
  },
  SAWMILL(ctx) {
    const { mb, level } = ctx;
    shed(mb, 0, -0.6, 2.4, 1.0, 0.7, 0xa0784a, 0x5a4a3a);
    chimney(ctx, 0.9, -1.0, 1.4, 0.09, 0x6a6a6a, 'steam');
    spinPart(ctx, -1.35, 0.5, 0.4, (m) => { m.cyl(0.3, 0.3, 0.03, 12, METAL, { rx: Math.PI / 2, center: true }); m.box(0.08, 0.08, 0.05, DARK); }, 5, 'z');
    mb.box(0.8, 0.2, 0.4, DARK, { x: -1.3, z: 0.4 });
    logPile(mb, 0.2, 0.6, 3);
    for (let k = 0; k < 3 + level; k++) mb.box(0.7, 0.07, 0.35, shade(0xd1a46b, 1 - (k % 3) * 0.06), { x: 1.1, y: k * 0.07, z: 0.9 });
    if (level >= 2) shed(mb, -0.9, 1.2, 1.0, 0.6, 0.5, 0xa0784a, 0x5a4a3a);
  },
  FOOD_PROC(ctx) {
    const { mb, level } = ctx;
    mb.box(2.2, 0.8, 1.2, 0xe8e2d4, { x: -0.3, z: -0.6 });
    mb.box(2.3, 0.08, 1.3, 0x7a8a9a, { x: -0.3, y: 0.8, z: -0.6 });
    for (let k = 0; k < 5; k++) mb.box(0.25, 0.2, 0.02, GLASS, { x: -1.1 + k * 0.4, y: 0.4, z: 0.01, glow: true });
    for (let k = 0; k < 2 + Math.min(2, level); k++) { mb.cyl(0.22, 0.22, 1.4, 10, METAL, { x: 1.3, z: -1.2 + k * 0.55 }); mb.cone(0.23, 0.2, 10, DARK, { x: 1.3, y: 1.4, z: -1.2 + k * 0.55 }); }
    chimney(ctx, -1.1, -1.0, 1.5, 0.08, 0xa0a0a0, 'steam');
    mb.box(0.6, 0.35, 0.3, 0xd9744f, { x: -0.5, z: 0.9 });
    mb.box(0.25, 0.25, 0.3, 0xe8e2d4, { x: -0.1, z: 0.9 });
  },
  STEEL_MILL(ctx) {
    const { mb, level } = ctx;
    mb.cyl(0.45, 0.6, 2.0, 10, RUST, { x: -0.7, z: -0.6 });
    mb.cyl(0.3, 0.45, 0.4, 10, DARK, { x: -0.7, y: 2.0, z: -0.6 });
    mb.box(0.5, 0.3, 0.5, 0xff8a3a, { x: -0.7, y: 0.1, z: -0.05, glow: true });
    mb.box(1.6, 1.0, 1.1, 0x6a6e74, { x: 0.8, z: -0.5 });
    mb.box(1.7, 0.08, 1.2, 0x4a4e54, { x: 0.8, y: 1.0, z: -0.5 });
    const n = 2 + Math.min(2, level);
    for (let k = 0; k < n; k++) chimney(ctx, 0.3 + k * 0.4, 0.8, 2.2 + (k % 2) * 0.3, 0.1, 0x7a4a3a);
    mb.box(2.4, 0.1, 0.1, METAL, { x: 0.2, y: 1.4, z: -0.05 });
    for (let k = 0; k < 3; k++) mb.box(0.6, 0.12, 0.2, 0x8fa3b3, { x: -1.0 + k * 0.1, y: k * 0.12, z: 1.2 });
    ctx.emitters.push({ x: -0.7, y: 2.5, z: -0.6, type: 'smoke' });
  },
  REFINERY(ctx) {
    const { mb, level } = ctx;
    for (let k = 0; k < 2 + Math.min(2, level); k++) { mb.cyl(0.16, 0.2, 1.8 + (k % 2) * 0.5, 10, 0xd8dde2, { x: -1.0 + k * 0.45, z: -0.9 }); mb.torus(0.2, 0.03, Math.PI * 2, DARK, { x: -1.0 + k * 0.45, y: 0.9, z: -0.9, rx: Math.PI / 2 }); }
    for (let k = 0; k < 2; k++) mb.sphere(0.42, 1, 0xe8e8e8, { x: 0.7, y: 0.45, z: -0.8 + k * 1.0 });
    mb.cyl(0.05, 0.06, 2.5, 6, METAL, { x: 1.4, z: 1.3 });
    mb.sphere(0.1, 0, 0xffa040, { x: 1.4, y: 2.55, z: 1.3, glow: true });
    ctx.emitters.push({ x: 1.4, y: 2.7, z: 1.3, type: 'smoke' });
    mb.box(2.6, 0.06, 0.06, METAL, { y: 0.5, z: 0.2 });
    mb.box(2.6, 0.06, 0.06, METAL, { y: 0.7, z: 0.3 });
    mb.box(1.0, 0.5, 0.7, 0x8a8f96, { x: -0.8, z: 1.0 });
  },
  FACTORY(ctx) {
    const { mb, level } = ctx;
    mb.box(2.8, 0.9, 1.6, 0xb07a5a, { z: -0.5 });
    for (let k = 0; k < 5; k++) mb.roof(0.56, 0.32, 1.6, k % 2 ? 0x5a6a7a : 0x4a5a6a, { x: -1.12 + k * 0.56, y: 0.9, z: -0.5 });
    for (let k = 0; k < 6; k++) mb.box(0.22, 0.28, 0.02, GLASS, { x: -1.2 + k * 0.48, y: 0.45, z: 0.31, glow: true });
    chimney(ctx, 1.2, -1.1, 1.9 + level * 0.15, 0.12, 0x8a4a3a);
    if (level >= 2) chimney(ctx, 0.6, -1.1, 1.6, 0.1, 0x8a4a3a);
    for (let k = 0; k < 2 + level; k++) mb.box(0.36, 0.32, 0.36, k % 2 ? 0x5aa6c8 : 0x6b7f5a, { x: -1.2 + k * 0.45, z: 1.1 });
  },
  DIST_CENTER(ctx) {
    const { mb, level } = ctx;
    mb.box(3.0, 0.8, 1.8, 0xd8d2c4, { z: -0.4 });
    mb.box(3.1, 0.1, 1.9, 0x5a6470, { y: 0.8, z: -0.4 });
    for (let k = 0; k < 6; k++) mb.box(0.34, 0.5, 0.02, 0x5a6470, { x: -1.25 + k * 0.5, z: 0.51 });
    const cols = [0xc94f4f, 0x3f6e9a, 0xe0a33a, 0x5aa66a];
    for (let k = 0; k < 3 + level; k++) mb.box(0.9, 0.3, 0.32, cols[k % 4], { x: -0.9 + (k % 3) * 0.95, y: Math.floor(k / 3) * 0.3, z: 1.2 });
    mb.box(0.7, 0.3, 0.3, 0xe8e2d4, { x: 1.0, z: 0.8 });
    mb.box(0.25, 0.25, 0.3, 0x3f6e9a, { x: 1.45, z: 0.8 });
  },
  PORT(ctx) {
    const { mb, level } = ctx;
    mb.box(3.6, 0.3, 1.0, CONC, { y: -0.1, z: 1.3 });
    mb.box(1.6, 0.8, 1.0, 0x9aa3ac, { x: -0.9, z: -0.8 });
    mb.box(1.7, 0.08, 1.1, 0x4a5a6a, { x: -0.9, y: 0.8, z: -0.8 });
    const cols = [0xc94f4f, 0x3f6e9a, 0xe0a33a, 0x5aa66a, 0x8a5ab0];
    for (let k = 0; k < 4 + level * 2; k++) mb.box(0.8, 0.3, 0.3, cols[k % 5], { x: 0.6 + (k % 2) * 0.85 - 0.4, y: Math.floor(k / 4) * 0.3, z: -1.3 + (Math.floor(k / 2) % 2) * 0.35 });
    mb.box(0.12, 1.6, 0.12, 0xd0a030, { x: 1.0, z: 1.3 });
    spinPart(ctx, 1.0, 1.6, 1.3, (m) => { m.box(1.8, 0.1, 0.1, 0xd0a030, { x: 0.3 }); m.box(0.25, 0.25, 0.25, DARK, { x: -0.5 }); m.box(0.02, 0.5, 0.02, DARK, { x: 1.0, y: -0.25 }); }, 0.3, 'y');
    if (level >= 2) { mb.cyl(0.18, 0.22, 1.8, 8, 0xf0f0f0, { x: -1.5, z: 1.5 }); mb.cyl(0.19, 0.19, 0.3, 8, 0xc94f4f, { x: -1.5, y: 1.2, z: 1.5 }); mb.sphere(0.12, 0, 0xfff2c0, { x: -1.5, y: 1.9, z: 1.5, glow: true }); }
  },
};

function mineModel(ctx, pileCol, coal) {
  const { mb, level } = ctx;
  // headframe
  const hx = -0.8, hz = -0.6;
  for (const [dx, dz] of [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]) mb.box(0.07, 1.8, 0.07, 0x7a4a3a, { x: hx + dx, z: hz + dz });
  mb.box(0.6, 0.06, 0.6, 0x7a4a3a, { x: hx, y: 1.2, z: hz });
  mb.box(0.07, 1.9, 0.07, 0x7a4a3a, { x: hx + 0.7, z: hz, rz: 0.38 });
  spinPart(ctx, hx, 1.85, hz, (m) => { m.torus(0.28, 0.04, Math.PI * 2, DARK, {}); m.box(0.5, 0.04, 0.04, DARK); m.box(0.04, 0.5, 0.04, DARK); }, 2.2, 'z');
  shed(mb, 0.6, -0.9, 1.2, 0.8, 0.6, 0x8a8f96, 0x5a4a42);
  // piles
  const piles = 1 + Math.min(3, level);
  for (let k = 0; k < piles; k++) mb.cone(0.45, 0.5, 7, shade(pileCol, 1 - k * 0.05), { x: -1.0 + k * 0.7, z: 1.0 });
  mb.box(1.4, 0.06, 0.2, DARK, { x: 0.3, y: 0.6, z: 0.3, rz: -0.35 });
  if (coal) chimney(ctx, 1.3, 0.3, 1.5, 0.09, 0x6a6a6a);
  // cart
  mb.box(0.3, 0.2, 0.2, 0x6a5040, { x: 0.9, z: 1.3 });
  if (level >= 3) shed(mb, 1.2, 1.0, 0.7, 0.8, 0.5, 0x8a8f96, 0x5a4a42);
}

export { N, cheb, MATS };
