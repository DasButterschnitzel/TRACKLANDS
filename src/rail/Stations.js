// Stations and depots: placement, linking to towns and industries, cargo
// storage, acceptance, upgrades and procedural visuals (with crowds and cargo piles).
import * as THREE from 'three';
import { N, TILE, DX, DZ, opp, step, tx, tz, idx, inMap, cheb, tileCX, tileCZ } from '../util.js';
import { STATION, COSTS, STATION_STYLES, CARGO, TOWN_ACCEPTS, INDUSTRIES } from '../config.js';
import { ModelBuilder, meshFrom, shade } from '../core/ModelBuilder.js';
import { K_NORMAL } from './RailNetwork.js';
import { t as tr } from '../i18n.js';

const DIR_NAMES = ['east', 'south', 'south', 'west', 'west', 'north', 'north', 'east'];

export class StationSystem {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.depots = [];
    this.nextId = 1;
    this.group = new THREE.Group();
    game.scene.add(this.group);
    // crowd + cargo instancing
    const pm = new ModelBuilder();
    pm.cyl(0.05, 0.06, 0.16, 6, 0xffffff, { y: 0 });
    pm.sphere(0.045, 0, 0xf0c8a0, { y: 0.2 });
    this.people = new THREE.InstancedMesh(pm.build(), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), 800);
    this.people.count = 0; this.people.frustumCulled = false;
    const cm = new ModelBuilder(); cm.box(0.2, 0.16, 0.2, 0xffffff);
    this.crates = new THREE.InstancedMesh(cm.build(), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), 1200);
    this.crates.count = 0; this.crates.frustumCulled = false; this.crates.castShadow = true;
    game.scene.add(this.people, this.crates);
    this._cargoT = 0;
    this._m = new THREE.Matrix4(); this._c = new THREE.Color();
  }

  byId(id) { return this.list.find((s) => s.id === id); }
  depotById(id) { return this.depots.find((d) => d.id === id); }
  depotAt(tile) { return this.depots.find((d) => d.tile === tile); }
  stationAt(tile) { return this.list.find((s) => s.tile === tile); }

  radius(stn) { return STATION.radius[stn.level] + this.game.progression.fx.stationRadius; }
  storage(stn) { return Math.round(STATION.storage[stn.level] * (1 + this.game.progression.fx.storage)); }
  loadRate(stn) { return STATION.loadRate[stn.level]; }

  // ---------- validation ----------
  placeError(tile, kind) {
    const g = this.game, net = g.net;
    if (tile < 0) return 'err_out_of_map';
    const r = net.tileBlockedReason(tile);
    if (r) return r;
    if (net.kind(tile) !== K_NORMAL) return 'err_bad_terrain';
    if (net.special.has(tile)) return 'err_occupied';
    if (kind === 'depot' && net.degree(tile) > 1) return 'err_depot_on_line';
    if (net.degree(tile) >= 3 && kind === 'station') return 'err_station_junction';
    const cost = kind === 'depot' ? g.economy.costs.depot() : g.economy.costs.station();
    if (!g.economy.canAfford(cost)) return 'err_no_money';
    return null;
  }

  // Which towns/industries a station on `tile` would serve
  previewLinks(tile, level = 0) {
    const g = this.game;
    const r = STATION.radius[level] + g.progression.fx.stationRadius;
    const towns = g.towns.list.filter((t) => cheb(tile, idx(t.x, t.z)) <= r + g.towns.radius(t));
    const inds = g.industries.list.filter((ind) => {
      for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) if (cheb(tile, idx(ind.x + dx, ind.z + dz)) <= r) return true;
      return false;
    });
    return { towns, inds, radius: r };
  }

  relink(stn) {
    const { towns, inds } = this.previewLinks(stn.tile, stn.level);
    stn.links = { towns: towns.map((t) => t.id), industries: inds.map((i) => i.id) };
    const acc = new Set(), sup = new Set();
    if (towns.length) { for (const c of TOWN_ACCEPTS) acc.add(c); sup.add('PASSENGERS'); sup.add('MAIL'); }
    for (const ind of inds) {
      const cfg = INDUSTRIES[ind.type];
      for (const rc of cfg.recipes) { for (const c in rc.in) acc.add(c); for (const c in rc.out) sup.add(c); }
      if (cfg.accepts) for (const c of cfg.accepts) acc.add(c);
    }
    stn.accepts = acc; stn.supplies = sup;
  }
  relinkAll() { for (const s of this.list) this.relink(s); this.game.events.emit('stationsRelinked'); }

  accepts(stn, c) { return !!(stn.accepts && stn.accepts.has(c)); }
  hasDemand(stn, c, comp) {
    comp = comp || this.game.net.components();
    const k = comp[stn.tile];
    if (k < 0) return false;
    for (const s of this.list) if (s !== stn && comp[s.tile] === k && this.accepts(s, c)) return true;
    return false;
  }

  makeName(tile, links) {
    const g = this.game;
    const used = new Set(this.list.map((s) => s.name));
    let base;
    if (links.towns.length) {
      const town = links.towns[0];
      base = town.name;
      if (used.has(base)) {
        const dx = tx(tile) - town.x, dz = tz(tile) - town.z;
        const ang = Math.round((Math.atan2(dz, dx) / (Math.PI * 2)) * 8 + 8) % 8;
        base = `${town.name} ${tr('dir_' + DIR_NAMES[ang])}`;
      }
    } else if (links.inds.length) base = g.industries.displayName(links.inds[0]);
    else {
      let best = null, bd = 1e9;
      for (const t of g.towns.list) { const d = cheb(tile, idx(t.x, t.z)); if (d < bd) { bd = d; best = t; } }
      base = `${best ? best.name : 'Frontier'} ${tr('halt')}`;
    }
    let name = base, k = 2;
    while (used.has(name)) name = `${base} ${k++}`;
    return name;
  }

  // ---------- building ----------
  build(tile) {
    const g = this.game, net = g.net;
    const err = this.placeError(tile, 'station');
    if (err) return { error: err };
    const links = this.previewLinks(tile, 0);
    const stn = {
      id: this.nextId++, tile, level: 0, style: g.progression.defaultStationStyle, name: this.makeName(tile, links),
      stock: {}, claimed: {}, links: null, accepts: null, supplies: null, delivered: 0, picked: 0, created: g.time, warn: false,
    };
    const cost = g.economy.costs.station();
    g.economy.spend(cost, 'construction');
    net.special.set(tile, { type: 'station', id: stn.id });
    const auto = this.autoConnect(tile, 2);
    this.list.push(stn);
    this.relink(stn);
    g.world.view && g.world.view.clearTrees(tile);
    net.bumpVersion();
    this.buildVisual(stn);
    g.railView.markDirty(tile);
    for (const t of auto) g.railView.markDirty(t);
    g.stats.inc('stationsBuilt');
    g.events.emit('stationBuilt', stn);
    g.trains.onNetworkChanged(false);
    return { station: stn, cost, auto };
  }

  // Automatically join a new station/depot to adjacent track
  autoConnect(tile, max) {
    const g = this.game, net = g.net;
    const done = [];
    if (net.conn[tile]) return done;
    const cands = [];
    for (const d of [0, 2, 4, 6]) {
      const j = step(tile, d);
      if (j < 0 || !net.conn[j]) continue;
      const sp = net.special.get(j);
      if (sp && sp.type === 'depot') continue;
      if (net.degree(j) >= 3) continue;
      // prefer neighbors whose existing track points toward us
      let score = 0;
      for (let e = 0; e < 8; e++) if (net.hasDir(j, e) && e === d) score += 2;
      if (net.degree(j) === 1) score += 1;
      cands.push({ d, j, score });
    }
    cands.sort((a, b) => b.score - a.score);
    const chosen = [];
    for (const c of cands) {
      if (chosen.length >= max) break;
      if (chosen.length === 1 && chosen[0].d !== opp(c.d)) continue;
      chosen.push(c);
    }
    for (const c of chosen) {
      net.connect(tile, c.d);
      net.tier[tile] = Math.max(net.tier[tile], net.tier[c.j]);
      done.push(c.j);
    }
    if (chosen.length) net.bumpVersion();
    return done;
  }

  buildDepot(tile) {
    const g = this.game, net = g.net;
    const err = this.placeError(tile, 'depot');
    if (err) return { error: err };
    const cost = g.economy.costs.depot();
    g.economy.spend(cost, 'construction');
    const dep = { id: this.nextId++, tile, name: tr('depot') + ' ' + (this.depots.length + 1) };
    net.special.set(tile, { type: 'depot', id: dep.id });
    // a depot keeps at most one connection
    if (net.degree(tile) > 1) net.disconnectTile(tile);
    const auto = this.autoConnect(tile, 1);
    this.depots.push(dep);
    g.world.view && g.world.view.clearTrees(tile);
    net.bumpVersion();
    this.buildDepotVisual(dep);
    g.railView.markDirty(tile);
    for (const t of auto) g.railView.markDirty(t);
    g.events.emit('depotBuilt', dep);
    return { depot: dep, cost };
  }

  remove(stn) {
    const g = this.game;
    const occ = g.trains.tileOccupied(stn.tile);
    if (occ) return { error: 'err_station_in_use' };
    this.list = this.list.filter((s) => s !== stn);
    g.net.special.delete(stn.tile);
    if (stn.mesh) { this.group.remove(stn.mesh); stn.mesh.geometry.dispose(); }
    let affected = 0;
    for (const t of g.trains.trains) {
      const before = t.route.length;
      t.route = t.route.filter((r) => r.st !== stn.id);
      if (t.route.length !== before) affected++;
      if (t.target === stn.id && t.state !== 'run') { t.state = 'idle'; t.stateT = 3; }
      if (t.claim && t.claim.st === stn.id) t.claim = null;
    }
    g.net.bumpVersion();
    const refund = Math.round(g.economy.costs.station() * COSTS.bulldozeRefund);
    g.economy.earn(refund, 'refund', false);
    g.events.emit('stationRemoved', stn);
    return { refund, affected };
  }

  removeDepot(dep) {
    const g = this.game;
    if (g.trains.tileOccupied(dep.tile)) return { error: 'err_depot_in_use' };
    this.depots = this.depots.filter((d) => d !== dep);
    g.net.special.delete(dep.tile);
    g.net.disconnectTile(dep.tile);
    if (dep.mesh) { this.group.remove(dep.mesh); dep.mesh.geometry.dispose(); }
    g.net.bumpVersion();
    const refund = Math.round(g.economy.costs.depot() * COSTS.bulldozeRefund);
    g.economy.earn(refund, 'refund', false);
    return { refund };
  }

  upgradeInfo(stn) {
    const g = this.game;
    const next = stn.level + 1;
    if (next > 4) return { max: true };
    const cost = g.economy.costs.stationUpgrade(next);
    const lvlReq = COSTS.stationUpgradeLevel[next];
    return { next, cost, lvlReq, ok: g.progression.level >= lvlReq && g.economy.canAfford(cost) };
  }
  upgrade(stn) {
    const g = this.game;
    const info = this.upgradeInfo(stn);
    if (info.max) return 'err_max_level';
    if (g.progression.level < info.lvlReq) return 'err_level_required';
    if (!g.economy.canAfford(info.cost)) return 'err_no_money';
    g.economy.spend(info.cost, 'construction');
    stn.level++;
    this.relink(stn);
    this.buildVisual(stn);
    g.stats.max('maxStationLevel', stn.level + 1);
    g.events.emit('stationUpgraded', stn);
    return null;
  }

  setStyle(stn, style) { stn.style = style; this.buildVisual(stn); }

  // ---------- cargo ----------
  receive(stn, c, n) {
    const cap = this.storage(stn);
    const cur = stn.stock[c] || 0;
    const take = Math.max(0, Math.min(n, cap - cur));
    if (take > 0) stn.stock[c] = cur + take;
    stn.warn = cur + take >= cap * 0.9;
    return take;
  }
  onPickup(stn, c, n) { stn.picked += n; this.game.events.emit('cargoPicked', stn, c, n); }

  // Distribute delivered cargo to linked towns / industries
  distribute(stn, c, n) {
    const g = this.game;
    stn.delivered += n;
    if (TOWN_ACCEPTS.includes(c) && stn.links.towns.length) {
      const town = g.towns.byId(stn.links.towns[0]);
      if (town) { g.towns.receive(town, c, n); return { town }; }
    }
    for (const id of stn.links.industries) {
      const ind = g.industries.byId(id);
      if (ind && g.industries.accepts(ind, c)) { g.industries.receive(ind, c, n); return { industry: ind }; }
    }
    return {};
  }

  tick(dt) {
    this._cargoT -= dt;
  }

  // ---------- visuals ----------
  axisYaw(tile) {
    const net = this.game.net;
    for (const d of [0, 2, 1, 3, 4, 6, 5, 7]) if (net.hasDir(tile, d)) return Math.atan2(-DZ[d], DX[d]);
    return 0;
  }

  buildVisual(stn) {
    if (stn.mesh) { this.group.remove(stn.mesh); stn.mesh.geometry.dispose(); }
    const style = STATION_STYLES.find((s) => s.id === stn.style) || STATION_STYLES[0];
    const mb = new ModelBuilder();
    stationModel(mb, stn.level, style);
    const mesh = meshFrom(mb.build());
    const net = this.game.net;
    mesh.position.set(tileCX(stn.tile), net.railH(stn.tile) + 0.02, tileCZ(stn.tile));
    mesh.rotation.y = this.axisYaw(stn.tile);
    stn.yaw = mesh.rotation.y;
    mesh.userData.station = stn.id;
    stn.mesh = mesh;
    this.group.add(mesh);
    stn.pulse = 1;
  }

  buildDepotVisual(dep) {
    if (dep.mesh) { this.group.remove(dep.mesh); dep.mesh.geometry.dispose(); }
    const mb = new ModelBuilder();
    depotModel(mb);
    const mesh = meshFrom(mb.build());
    const net = this.game.net;
    let yaw = 0;
    for (let d = 0; d < 8; d++) if (net.hasDir(dep.tile, d)) yaw = Math.atan2(-DZ[d], DX[d]);
    mesh.position.set(tileCX(dep.tile), net.railH(dep.tile) + 0.02, tileCZ(dep.tile));
    mesh.rotation.y = yaw;
    dep.mesh = mesh;
    this.group.add(mesh);
  }

  refreshOrientation(tile) {
    const s = this.stationAt(tile);
    if (s) { const y = this.axisYaw(tile); if (Math.abs(y - (s.yaw || 0)) > 1e-3) this.buildVisual(s); }
    const d = this.depotAt(tile);
    if (d) this.buildDepotVisual(d);
  }

  updateVisuals(dt, time) {
    // station placement pulse
    for (const s of this.list) {
      if (s.pulse > 0) { s.pulse = Math.max(0, s.pulse - dt * 1.6); const k = 1 + Math.sin(s.pulse * Math.PI) * 0.12; s.mesh.scale.set(1, k, 1); }
    }
    // crowds and cargo, updated at a light cadence
    this._vis = (this._vis || 0) - dt;
    const m = this._m, c = this._c;
    const q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
    let np = 0;
    const shirts = [0x3f6e9a, 0xc94f4f, 0xe0a33a, 0x5aa66a, 0x8a5ab0, 0xe8e2d4, 0x2b2b2b];
    for (const s of this.list) {
      if (!s.mesh) continue;
      const pax = s.stock.PASSENGERS || 0;
      const want = s.links && s.links.towns.length ? Math.min(STATION.passengers[s.level], Math.ceil(pax / 3)) : 0;
      const cy = Math.cos(s.yaw), sy = Math.sin(s.yaw);
      const plen = [1.4, 2.2, 3.0, 3.4, 3.8][s.level];
      for (let k = 0; k < want && np < this.people.instanceMatrix.count; k++) {
        const r1 = ((s.id * 7919 + k * 104729) % 1000) / 1000, r2 = ((s.id * 31 + k * 977) % 1000) / 1000;
        const side = s.level === 0 ? 1 : (k % 2 ? 1 : -1);
        const lx = (r1 - 0.5) * plen * 0.9 + Math.sin(time * 0.3 + k) * 0.05, lz = side * (0.8 + r2 * 0.12);
        const wx = s.mesh.position.x + lx * cy + lz * sy, wz = s.mesh.position.z - lx * sy + lz * cy;
        const bob = Math.abs(Math.sin(time * 2 + k * 1.7)) * 0.015;
        q.setFromAxisAngle(up, r1 * 6.28);
        p.set(wx, s.mesh.position.y + 0.25 + bob, wz);
        m.compose(p, q, sc);
        this.people.setMatrixAt(np, m);
        this.people.setColorAt(np, c.set(shirts[(s.id + k) % shirts.length]));
        np++;
      }
    }
    this.people.count = np;
    this.people.instanceMatrix.needsUpdate = true;
    if (this.people.instanceColor) this.people.instanceColor.needsUpdate = true;
    if (this._vis > 0) return;
    this._vis = 0.4;
    let nc = 0;
    for (const s of this.list) {
      if (!s.mesh) continue;
      const cap = this.storage(s);
      const cy = Math.cos(s.yaw), sy = Math.sin(s.yaw);
      let slot = 0;
      for (const cid in s.stock) {
        if (cid === 'PASSENGERS') continue;
        const amt = s.stock[cid];
        const n = Math.min(8, Math.ceil((amt / cap) * 8));
        for (let k = 0; k < n && nc < this.crates.instanceMatrix.count; k++, slot++) {
          const row = Math.floor(slot / 6), col = slot % 6;
          const lx = -0.75 + col * 0.26, lz = -(1.15 + row * 0.24);
          const wx = s.mesh.position.x + lx * cy + lz * sy, wz = s.mesh.position.z - lx * sy + lz * cy;
          q.setFromAxisAngle(up, s.yaw);
          const stack = (k % 2) * 0.16;
          p.set(wx, s.mesh.position.y + 0.08 + stack, wz);
          sc.set(1, 1, 1);
          m.compose(p, q, sc);
          this.crates.setMatrixAt(nc, m);
          this.crates.setColorAt(nc, c.set(CARGO[cid].color));
          nc++;
        }
      }
    }
    this.crates.count = nc;
    this.crates.instanceMatrix.needsUpdate = true;
    if (this.crates.instanceColor) this.crates.instanceColor.needsUpdate = true;
  }

  // ---------- persistence ----------
  serialize() {
    return {
      nextId: this.nextId,
      stations: this.list.map((s) => ({ id: s.id, tile: s.tile, level: s.level, style: s.style, name: s.name, stock: s.stock, delivered: s.delivered, picked: s.picked })),
      depots: this.depots.map((d) => ({ id: d.id, tile: d.tile, name: d.name })),
    };
  }
  deserialize(d) {
    if (!d) return;
    const net = this.game.net;
    this.nextId = d.nextId || 1;
    for (const s of d.stations || []) {
      if (typeof s.tile !== 'number' || s.tile < 0 || s.tile >= N * N || net.special.has(s.tile)) continue;
      const stn = { id: s.id, tile: s.tile, level: Math.max(0, Math.min(4, s.level | 0)), style: s.style || 'classic', name: String(s.name || 'Station'), stock: {}, claimed: {}, delivered: s.delivered || 0, picked: s.picked || 0, warn: false };
      for (const c in s.stock || {}) if (CARGO[c] && s.stock[c] > 0) stn.stock[c] = s.stock[c];
      net.special.set(stn.tile, { type: 'station', id: stn.id });
      this.list.push(stn);
      this.nextId = Math.max(this.nextId, stn.id + 1);
    }
    for (const dd of d.depots || []) {
      if (typeof dd.tile !== 'number' || net.special.has(dd.tile)) continue;
      const dep = { id: dd.id, tile: dd.tile, name: String(dd.name || 'Depot') };
      net.special.set(dep.tile, { type: 'depot', id: dep.id });
      this.depots.push(dep);
      this.nextId = Math.max(this.nextId, dep.id + 1);
    }
  }
  buildAllVisuals() {
    for (const s of this.list) { this.relink(s); this.buildVisual(s); s.pulse = 0; }
    for (const d of this.depots) this.buildDepotVisual(d);
  }
}

// ---------- station models (local frame: track along X, lanes at z=±0.34) ----------
const POST = 0x4a4f55, BENCH = 0x7a5a3a, LAMP = 0xfff0c0, PLAT = 0xc9c2b4, EDGE = 0xe8d27a, CLOCK = 0xf4f0e6;

function lampPost(mb, x, z) {
  mb.cyl(0.02, 0.025, 0.6, 5, POST, { x, y: 0.25, z });
  mb.sphere(0.05, 0, LAMP, { x, y: 0.88, z, glow: true });
}

export function stationModel(mb, level, style) {
  const wall = style.wall, roof = style.roof;
  const plen = [1.6, 2.4, 3.2, 3.6, 4.0][level];
  const sides = level === 0 ? [1] : [1, -1];
  for (const s of sides) {
    mb.box(plen, 0.24, 0.34, PLAT, { y: 0, z: s * 0.84 });
    mb.box(plen, 0.02, 0.04, EDGE, { y: 0.24, z: s * 0.68 });
  }
  if (level === 0) {
    // halt shelter
    for (const x of [-0.35, 0.35]) mb.cyl(0.025, 0.025, 0.5, 5, POST, { x, y: 0.24, z: 0.92 });
    mb.box(0.9, 0.05, 0.36, roof, { y: 0.74, z: 0.86 });
    mb.box(0.5, 0.06, 0.12, BENCH, { y: 0.36, z: 0.92 });
    mb.box(0.02, 0.18, 0.3, shade(wall, 0.9), { x: -0.4, y: 0.3, z: 0.86 });
    mb.box(0.36, 0.14, 0.03, 0x2f5f8a, { x: 0.65, y: 0.62, z: 0.9 });
    mb.cyl(0.015, 0.015, 0.4, 4, POST, { x: 0.65, y: 0.24, z: 0.9 });
    lampPost(mb, -0.7, 0.95);
    return;
  }
  const bw = [0, 1.4, 1.9, 2.6, 3.2][level];
  const bh = [0, 0.62, 0.8, 1.0, 1.2][level];
  const bz = 1.55;
  mb.box(bw, bh, 0.8, wall, { y: 0, z: bz });
  mb.box(bw + 0.08, 0.06, 0.88, shade(wall, 0.8), { y: bh, z: bz });
  mb.roof(bw + 0.1, 0.36 + level * 0.06, 0.92, roof, { y: bh + 0.04, z: bz });
  // windows & door
  const wins = Math.max(2, Math.floor(bw / 0.35));
  for (let k = 0; k < wins; k++) {
    const x = -bw / 2 + 0.2 + k * ((bw - 0.4) / Math.max(1, wins - 1));
    mb.box(0.14, 0.18, 0.02, 0x3a4a5a, { x, y: bh * 0.45, z: bz - 0.41, glow: true });
    if (level >= 3) mb.box(0.14, 0.18, 0.02, 0x3a4a5a, { x, y: bh * 0.78, z: bz - 0.41, glow: true });
  }
  mb.box(0.24, 0.36, 0.03, shade(roof, 0.8), { y: 0.0, z: bz - 0.41 });
  lampPost(mb, -plen / 2 + 0.2, 0.95); lampPost(mb, plen / 2 - 0.2, 0.95);
  lampPost(mb, -plen / 2 + 0.2, -0.95); lampPost(mb, plen / 2 - 0.2, -0.95);
  mb.box(0.5, 0.06, 0.12, BENCH, { x: 0.4, y: 0.34, z: 0.95 });
  mb.box(0.5, 0.06, 0.12, BENCH, { x: -0.4, y: 0.34, z: -0.95 });
  if (level >= 2) {
    // clock tower
    const th = 1.5 + level * 0.3;
    mb.box(0.42, th, 0.42, wall, { x: bw / 2 - 0.1, y: 0, z: bz + 0.1 });
    mb.cone(0.36, 0.5, 4, roof, { x: bw / 2 - 0.1, y: th, z: bz + 0.1, ry: Math.PI / 4 });
    mb.cyl(0.15, 0.15, 0.03, 12, CLOCK, { x: bw / 2 - 0.1, y: th - 0.3, z: bz - 0.12, rx: Math.PI / 2, center: true, glow: true });
    // platform canopies
    for (const s of [1, -1]) {
      for (let x = -plen / 2 + 0.3; x <= plen / 2 - 0.3; x += 0.7) mb.cyl(0.025, 0.025, 0.6, 5, POST, { x, y: 0.24, z: s * 0.92 });
      mb.box(plen - 0.2, 0.05, 0.5, roof, { y: 0.84, z: s * 0.86, rx: s * 0.12 });
    }
  }
  if (level >= 3) {
    // wings
    mb.box(0.9, bh * 0.75, 0.7, shade(wall, 0.95), { x: -bw / 2 - 0.4, y: 0, z: bz });
    mb.roof(1.0, 0.3, 0.8, roof, { x: -bw / 2 - 0.4, y: bh * 0.75, z: bz });
    // full canopy over tracks
    for (const x of [-plen / 2 + 0.2, 0, plen / 2 - 0.2]) for (const s of [1, -1]) mb.cyl(0.03, 0.03, 1.05, 6, POST, { x, y: 0.24, z: s * 0.95 });
    mb.box(plen, 0.06, 2.1, shade(roof, 1.15), { y: 1.28 });
  }
  if (level >= 4) {
    // grand terminal arched vault and twin towers
    for (let x = -plen / 2 + 0.1; x <= plen / 2 - 0.1; x += 0.45) mb.torus(1.05, 0.04, Math.PI, 0x6a7580, { x, y: 1.3, ry: Math.PI / 2 });
    mb.box(plen, 0.04, 0.05, 0x6a7580, { y: 2.33 });
    for (const s of [1, -1]) {
      mb.box(0.5, 2.4, 0.5, wall, { x: s * (plen / 2 + 0.1), y: 0, z: bz - 0.2 });
      mb.cone(0.42, 0.7, 4, roof, { x: s * (plen / 2 + 0.1), y: 2.4, z: bz - 0.2, ry: Math.PI / 4 });
      mb.cyl(0.01, 0.01, 0.5, 4, POST, { x: s * (plen / 2 + 0.1), y: 3.05, z: bz - 0.2 });
      mb.box(0.24, 0.14, 0.01, 0xc94f4f, { x: s * (plen / 2 + 0.1) + 0.12, y: 3.4, z: bz - 0.2 });
    }
  }
}

export function depotModel(mb) {
  const wall = 0x9a6a4a, roof = 0x4a4f58;
  // shed with doorway at +X
  mb.box(1.5, 0.08, 1.2, 0x7a7068, { y: 0 });
  mb.box(1.4, 0.95, 0.1, wall, { y: 0, z: 0.55 });
  mb.box(1.4, 0.95, 0.1, wall, { y: 0, z: -0.55 });
  mb.box(0.1, 0.95, 1.2, wall, { x: -0.7, y: 0 });
  mb.box(0.1, 0.25, 1.2, wall, { x: 0.7, y: 0.7 });
  mb.roof(1.6, 0.45, 1.34, roof, { y: 0.95 });
  mb.box(0.08, 0.7, 0.14, shade(wall, 0.7), { x: 0.72, y: 0, z: 0.5 });
  mb.box(0.08, 0.7, 0.14, shade(wall, 0.7), { x: 0.72, y: 0, z: -0.5 });
  mb.box(0.3, 0.6, 0.02, 0x3a4a5a, { x: -0.2, y: 0.25, z: 0.61, glow: true });
  mb.box(0.3, 0.6, 0.02, 0x3a4a5a, { x: -0.2, y: 0.25, z: -0.61, glow: true });
  mb.cyl(0.06, 0.07, 0.4, 6, 0x5a5a5a, { x: -0.4, y: 1.2, z: 0.3 });
  mb.box(0.4, 0.16, 0.03, 0xe0a33a, { x: 0.74, y: 1.02, rz: 0, ry: Math.PI / 2 });
}

export { DX, DZ, inMap, TILE };
