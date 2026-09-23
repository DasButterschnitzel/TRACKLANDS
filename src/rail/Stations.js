// Stations and depots. A station is a set of parallel platform tracks; every
// track tile is a real rail-graph element (special tile with its track index).
// Legacy single-tile stations are one track of length 1. Covers placement,
// linking to towns/industries, cargo storage, the platform dispatcher API,
// safe station editing (add track with switch ladders, extend platforms,
// roles, facilities), statistics, the bottleneck advisor and visuals.
import * as THREE from 'three';
import { N, TILE, DX, DZ, opp, step, tx, tz, idx, inMap, cheb, tileCX, tileCZ } from '../util.js';
import { STATION, COSTS, STATION_STYLES, CARGO, TOWN_ACCEPTS, INDUSTRIES, FACILITIES, PLATFORM_ROLES } from '../config.js';
import { ModelBuilder, meshFrom, shade } from '../core/ModelBuilder.js';
import { K_NORMAL } from './RailNetwork.js';
import { t as tr } from '../i18n.js';
import { stationComplexModel, depotModel, stationModel } from './StationModels.js';

const DIR_NAMES = ['east', 'south', 'south', 'west', 'west', 'north', 'north', 'east'];
const dirOf = (dx, dz) => { for (let d = 0; d < 8; d++) if (DX[d] === dx && DZ[d] === dz) return d; return -1; };

export class StationSystem {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.depots = [];
    this.nextId = 1;
    this.group = new THREE.Group();
    game.scene.add(this.group);
    const pm = new ModelBuilder();
    pm.cyl(0.05, 0.06, 0.16, 6, 0xffffff, { y: 0 });
    pm.sphere(0.045, 0, 0xf0c8a0, { y: 0.2 });
    this.people = new THREE.InstancedMesh(pm.build(), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), 1200);
    this.people.count = 0; this.people.frustumCulled = false;
    const cm = new ModelBuilder(); cm.box(0.2, 0.16, 0.2, 0xffffff);
    this.crates = new THREE.InstancedMesh(cm.build(), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), 1400);
    this.crates.count = 0; this.crates.frustumCulled = false; this.crates.castShadow = true;
    game.scene.add(this.people, this.crates);
    this._m = new THREE.Matrix4(); this._c = new THREE.Color();
    this.claims = new Map();   // trainId -> {stn, track}
  }

  byId(id) { return this.list.find((s) => s.id === id); }
  depotById(id) { return this.depots.find((d) => d.id === id); }
  depotAt(tile) { return this.depots.find((d) => d.tile === tile); }
  stationAt(tile) { const sp = this.game.net.special.get(tile); return sp && sp.type === 'station' ? this.byId(sp.id) : null; }
  trackAt(tile) { const sp = this.game.net.special.get(tile); return sp && sp.type === 'station' ? sp.track | 0 : -1; }
  allTiles(stn) { const out = []; for (const tk of stn.tracks) for (const t of tk.tiles) out.push(t); return out; }

  radius(stn) { return STATION.radius[stn.level] + this.game.progression.fx.stationRadius; }
  storage(stn) { return Math.round(STATION.storage[stn.level] * (1 + this.game.progression.fx.storage)); }
  loadRate(stn, cargos) {
    let r = STATION.loadRate[stn.level];
    if (cargos && stn.facilities.length) {
      let best = 1;
      for (const f of stn.facilities) for (const c of cargos) if (FACILITIES[f] && FACILITIES[f].cargo.includes(c)) best = Math.max(best, FACILITIES[f].mul);
      r *= best;
    }
    return r;
  }
  maxTracks() { const R = this.game.progression.research; return R.has('grand_terminals') ? STATION.maxTracksGrand : R.has('station_expansion') ? STATION.maxTracksExp : STATION.maxTracks; }
  maxLength() { return this.game.progression.research.has('platform_extension') ? STATION.maxLengthExt : STATION.maxLength; }

  // ---------- geometry helpers ----------
  axisOf(stn) {
    const net = this.game.net;
    const t0 = stn.tracks[0];
    if (t0.tiles.length > 1) {
      const a = dirOf(tx(t0.tiles[1]) - tx(t0.tiles[0]), tz(t0.tiles[1]) - tz(t0.tiles[0]));
      return a >= 0 ? a & 3 : 0;
    }
    const tile = t0.tiles[0];
    for (let d = 0; d < 4; d++) if (net.hasDir(tile, d) && net.hasDir(tile, d + 4)) return d;
    for (const d of [0, 2, 1, 3, 4, 6, 5, 7]) if (net.hasDir(tile, d)) return d & 3;
    return 0;
  }
  // re-index special tiles for a station (track indices and roles)
  markTiles(stn) {
    const net = this.game.net;
    stn.tracks.forEach((tk, k) => { for (const t of tk.tiles) net.special.set(t, { type: 'station', id: stn.id, track: k, role: tk.role }); });
  }

  // Routing targets for the dispatcher: each track can be entered from either
  // end; the train stops at the far end (heading constraint).
  targetsFor(stn, t) {
    const out = [];
    const a = this.axisOf(stn);
    stn.tracks.forEach((tk, k) => {
      if (tk.role === 'through') return;
      const n = tk.tiles.length;
      if (n === 1) { out.push({ tile: tk.tiles[0], heading: null, track: k, len: 1, role: tk.role }); return; }
      if (tk.dir !== 'rev') out.push({ tile: tk.tiles[n - 1], heading: a, track: k, len: n, role: tk.role });
      if (tk.dir !== 'fwd') out.push({ tile: tk.tiles[0], heading: (a + 4) & 7, track: k, len: n, role: tk.role });
    });
    if (!out.length && stn.tracks.length) {
      // every track marked "through": still allow stopping on track 1
      const tk = stn.tracks[0];
      out.push({ tile: tk.tiles[tk.tiles.length - 1], heading: tk.tiles.length > 1 ? a : null, track: 0, len: tk.tiles.length, role: 'any' });
    }
    void t;
    return out;
  }
  platformBusy(stn, k, id) {
    const net = this.game.net;
    const tk = stn.tracks[k];
    if (!tk) return true;
    for (const tile of tk.tiles) {
      const a = net.resv[tile * 2], b = net.resv[tile * 2 + 1];
      if ((a && a !== id) || (b && b !== id)) return true;
      const m = net.jres.get(tile);
      if (m) for (const tid of m.keys()) if (tid !== id) return true;
    }
    const c = stn.claims && stn.claims.get(k);
    if (c) for (const tid of c) if (tid !== id) return true;
    return false;
  }
  rolePenalty(stn, k, prio) {
    const role = stn.tracks[k] ? stn.tracks[k].role : 'any';
    if (role === 'any') return 0;
    if (role === 'passenger') return prio === 'passenger' || prio === 'express' || prio === 'mail' ? 0 : 20;
    if (role === 'freight') return prio === 'freight' || prio === 'service' ? 0 : 20;
    if (role === 'express') return prio === 'express' ? -1 : prio === 'passenger' ? 6 : 25;
    return 0;
  }
  claimPlatform(stn, k, id) {
    this.unclaimPlatform(id);
    if (!stn.claims) stn.claims = new Map();
    if (!stn.claims.has(k)) stn.claims.set(k, new Set());
    stn.claims.get(k).add(id);
    this.claims.set(id, { stn: stn.id, track: k });
  }
  unclaimPlatform(id) {
    const c = this.claims.get(id);
    if (!c) return;
    const s = this.byId(c.stn);
    if (s && s.claims && s.claims.get(c.track)) s.claims.get(c.track).delete(id);
    this.claims.delete(id);
  }

  // ---------- validation ----------
  placeError(tile, kind) {
    const g = this.game, net = g.net;
    if (tile < 0) return 'err_out_of_map';
    const r = net.tileBlockedReason(tile);
    if (r) return r;
    if (net.kind(tile) !== K_NORMAL) return 'err_bad_terrain';
    if (net.special.has(tile) || net.waypoints.has(tile)) return 'err_occupied';
    if (kind === 'depot' && net.degree(tile) > 1) return 'err_depot_on_line';
    if (net.degree(tile) >= 3 && kind === 'station') return 'err_station_junction';
    if (net.conn[tile] && g.trains.tileReserved(tile)) return 'err_train_on_track';
    const cost = kind === 'depot' ? g.economy.costs.depot() : g.economy.costs.station();
    if (!g.economy.canAfford(cost)) return 'err_no_money';
    return null;
  }

  previewLinks(tiles, level = 0) {
    const g = this.game;
    if (!Array.isArray(tiles)) tiles = [tiles];
    const r = STATION.radius[level] + g.progression.fx.stationRadius;
    const dist = (t) => { let m = 1e9; for (const s of tiles) m = Math.min(m, cheb(s, t)); return m; };
    const towns = g.towns.list.filter((t) => dist(idx(t.x, t.z)) <= r + g.towns.radius(t));
    const inds = g.industries.list.filter((ind) => {
      for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) if (dist(idx(ind.x + dx, ind.z + dz)) <= r) return true;
      return false;
    });
    return { towns, inds, radius: r };
  }

  relink(stn) {
    const { towns, inds } = this.previewLinks(this.allTiles(stn), stn.level);
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

  newStation(tile, extra) {
    return Object.assign({
      id: this.nextId++, tile, level: 0, style: this.game.progression.defaultStationStyle, name: '', stock: {}, claimed: {}, links: null, accepts: null, supplies: null,
      delivered: 0, picked: 0, created: this.game.time, warn: false, tracks: [{ tiles: [tile], role: 'any', dir: 'both', off: 0 }], facilities: [],
      claims: new Map(), stats: freshStats(), build: 0,
    }, extra || {});
  }

  // ---------- building ----------
  build(tile) {
    const g = this.game, net = g.net;
    const err = this.placeError(tile, 'station');
    if (err) return { error: err };
    const links = this.previewLinks([tile], 0);
    const stn = this.newStation(tile);
    stn.name = this.makeName(tile, links);
    const cost = g.economy.costs.station();
    g.economy.spend(cost, 'construction');
    net.special.set(tile, { type: 'station', id: stn.id, track: 0, role: 'any' });
    for (let d = 0; d < 8; d++) net.signals.delete(tile * 8 + d);
    const auto = this.autoConnect(tile, 2);
    this.list.push(stn);
    this.relink(stn);
    g.world.view && g.world.view.clearTrees(tile);
    net.bumpVersion();
    stn.build = 1;
    this.buildVisual(stn);
    g.railView.markDirty(tile);
    for (const t of auto) g.railView.markDirty(t);
    g.stats.inc('stationsBuilt');
    g.events.emit('stationBuilt', stn);
    g.trains.onNetworkChanged(false);
    return { station: stn, cost, auto };
  }

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
      if (g.trains.tileReserved(j)) continue;   // never re-shape track under a train
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

  inUse(tiles) {
    const T = this.game.trains;
    for (const t of tiles) if (T.tileReserved(t)) return true;
    return false;
  }

  remove(stn) {
    const g = this.game, net = g.net;
    const tiles = this.allTiles(stn);
    if (this.inUse(tiles)) return { error: 'err_station_in_use' };
    this.list = this.list.filter((s) => s !== stn);
    for (const t of tiles) net.special.delete(t);
    // extra platform tracks (beyond the original tile) stay as plain track
    if (stn.mesh) { this.group.remove(stn.mesh); stn.mesh.geometry.dispose(); }
    let affected = 0;
    for (const t of g.trains.trains) {
      const before = t.route.length;
      t.route = t.route.filter((r) => r.st !== stn.id);
      if (t.route.length !== before) affected++;
      if (t.target === stn.id && t.state !== 'run') { t.state = 'idle'; t.stateT = 3; }
      if (t.claim && t.claim.st === stn.id) t.claim = null;
    }
    for (const [id, c] of this.claims) if (c.stn === stn.id) this.claims.delete(id);
    net.bumpVersion();
    for (const t of tiles) g.railView.markDirty(t);
    const refund = Math.round(g.economy.costs.station() * COSTS.bulldozeRefund);
    g.economy.earn(refund, 'refund', false);
    g.trains.onNetworkChanged(false);
    g.events.emit('stationRemoved', stn);
    return { refund, affected };
  }

  removeDepot(dep) {
    const g = this.game;
    if (g.trains.tileReserved(dep.tile)) return { error: 'err_depot_in_use' };
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
    if (next > STATION.maxLevel) return { max: true };
    const cost = g.economy.costs.stationUpgrade(next);
    const lvlReq = COSTS.stationUpgradeLevel[next];
    const research = next === STATION.maxLevel ? 'grand_terminals' : null;
    const okRes = !research || g.progression.research.has(research);
    return { next, cost, lvlReq, research, ok: g.progression.level >= lvlReq && okRes && g.economy.canAfford(cost) };
  }
  upgrade(stn) {
    const g = this.game;
    const info = this.upgradeInfo(stn);
    if (info.max) return 'err_max_level';
    if (g.progression.level < info.lvlReq) return 'err_level_required';
    if (info.research && !g.progression.research.has(info.research)) return 'err_research_required';
    if (!g.economy.canAfford(info.cost)) return 'err_no_money';
    g.economy.spend(info.cost, 'construction');
    stn.level++;
    this.relink(stn);
    stn.build = 1;
    this.buildVisual(stn);
    g.stats.max('maxStationLevel', stn.level + 1);
    g.events.emit('stationUpgraded', stn);
    return null;
  }

  setStyle(stn, style) { stn.style = style; this.buildVisual(stn); }

  // ---------- station editing ----------
  // Plan a new parallel track on side (+1 / -1). Returns {error} or a plan.
  planAddTrack(stn, side) {
    const g = this.game, net = g.net;
    if (stn.tracks.length >= this.maxTracks()) return { error: this.maxTracks() < STATION.maxTracksGrand ? 'err_tracks_research' : 'err_max_tracks' };
    const a = this.axisOf(stn);
    if (a & 1) return { error: 'err_station_diagonal' };
    const perp = side > 0 ? (a + 2) & 7 : (a + 6) & 7;
    const offs = stn.tracks.map((t) => t.off || 0);
    const ref = stn.tracks[offs.indexOf(side > 0 ? Math.max(...offs) : Math.min(...offs))];
    const off = (ref.off || 0) + side;
    const tiles = [];
    for (const t of ref.tiles) {
      const j = step(t, perp);
      if (j < 0) return { error: 'err_out_of_map' };
      const r = net.tileBlockedReason(j);
      if (r) return { error: r, bad: j };
      if (net.kind(j) !== K_NORMAL) return { error: 'err_bad_terrain', bad: j };
      if (net.conn[j] || net.special.has(j)) return { error: 'err_occupied', bad: j };
      if (g.decor.at(j)) return { error: 'err_occupied', bad: j };
      tiles.push(j);
    }
    // switch ladders at both ends into the main track (off 0)
    const main = stn.tracks.find((t) => (t.off || 0) === 0) || stn.tracks[0];
    const k = Math.abs(off);
    const ladders = [];
    const inward = side > 0 ? (perp + 4) & 7 : (perp + 4) & 7;
    for (const end of [0, 1]) {
      const dOut = end ? a : (a + 4) & 7;
      const mainEnd = end ? main.tiles[main.tiles.length - 1] : main.tiles[0];
      const E = end ? tiles[tiles.length - 1] : tiles[0];
      const diag = dirOf(DX[dOut] + DX[inward], DZ[dOut] + DZ[inward]);
      // main line must continue straight for k tiles beyond the end
      let ok = net.hasDir(mainEnd, dOut), m = mainEnd;
      const path = [];
      for (let i = 1; ok && i <= k; i++) {
        const mi = step(m, dOut);
        if (mi < 0 || !net.conn[mi] || net.special.has(mi) || !net.hasDir(mi, (dOut + 4) & 7)) { ok = false; break; }
        if (i < k && !net.hasDir(mi, dOut)) { ok = false; break; }
        m = mi;
      }
      let p = E;
      for (let i = 1; ok && i <= k; i++) {
        p = step(p, diag);
        if (p < 0) { ok = false; break; }
        if (i < k) {
          if (net.conn[p] || net.special.has(p) || net.tileBlockedReason(p) || net.kind(p) !== K_NORMAL || g.decor.at(p)) { ok = false; break; }
        } else if (p !== m) ok = false;
        path.push(p);
      }
      // the merge tile must not already carry a diagonal in the same direction
      if (ok && net.hasDir(m, (diag + 4) & 7)) ok = false;
      ladders.push(ok ? { end, from: E, dir: diag, path } : { end, from: E, dir: null, path: [] });
    }
    let cost = tiles.length * COSTS.stationTrackTile * g.economy.costs.mul();
    for (const L of ladders) for (let i = 0; i < L.path.length - 1; i++) cost += g.economy.costs.trackTile(net.tier[ref.tiles[0]], K_NORMAL);
    return { side, off, tiles, ladders, cost: Math.round(cost), tier: net.tier[ref.tiles[0]] };
  }
  addTrack(stn, side) {
    const g = this.game, net = g.net;
    const plan = this.planAddTrack(stn, side);
    if (plan.error) return plan;
    if (!g.economy.canAfford(plan.cost)) return { error: 'err_no_money' };
    // merge tiles gain a switch: never under a train
    for (const L of plan.ladders) if (L.path.length && g.trains.tileReserved(L.path[L.path.length - 1])) return { error: 'err_train_on_track' };
    if (g.trains.foulsTrain([...plan.tiles, ...plan.ladders.flatMap((L) => L.path)])) return { error: 'err_train_on_track' };
    g.economy.spend(plan.cost, 'construction');
    const a = this.axisOf(stn);
    for (let i = 0; i < plan.tiles.length - 1; i++) net.connect(plan.tiles[i], a);
    const built = [...plan.tiles];
    const ladderTiles = [];
    for (const L of plan.ladders) {
      if (L.dir == null) continue;
      let p = L.from;
      for (const q of L.path) { net.connect(p, L.dir); p = q; }
      for (const q of L.path.slice(0, -1)) ladderTiles.push(q);
      built.push(...L.path);
    }
    for (const t of built) if (!net.tier[t] || net.tier[t] < plan.tier) net.tier[t] = Math.max(net.tier[t], plan.tier);
    stn.tracks.push({ tiles: plan.tiles, role: 'any', dir: 'both', off: plan.off, ladder: ladderTiles });
    this.markTiles(stn);
    g.world.view.clearTreesMany(built);
    g.world.view.clearCorridorMany(built);
    net.bumpVersion();
    g.railView.animateBuild(built);
    stn.build = 1;
    this.relink(stn);
    this.buildVisual(stn);
    g.trains.onNetworkChanged(false);
    g.stats.inc('trackBuilt', built.length);
    g.events.emit('stationEdited', stn);
    return { ok: true, cost: plan.cost, deadEnds: plan.ladders.filter((L) => L.dir == null).length };
  }

  planExtend(stn, k, end) {
    const g = this.game, net = g.net;
    const tk = stn.tracks[k];
    if (!tk) return { error: 'err_unknown' };
    if (tk.tiles.length >= this.maxLength()) return { error: this.maxLength() < STATION.maxLengthExt ? 'err_length_research' : 'err_max_length' };
    const a = this.axisOf(stn);
    if (tk.tiles.length === 1 && (a & 1)) return { error: 'err_station_diagonal' };
    const dOut = end ? a : (a + 4) & 7;
    const E = end ? tk.tiles[tk.tiles.length - 1] : tk.tiles[0];
    const B = step(E, dOut);
    if (B < 0) return { error: 'err_out_of_map' };
    if (net.special.has(B) || net.waypoints.has(B)) return { error: 'err_occupied', bad: B };
    const r = net.tileBlockedReason(B);
    if (r) return { error: r, bad: B };
    if (net.kind(B) !== K_NORMAL) return { error: 'err_bad_terrain', bad: B };
    if (net.conn[B]) {
      // existing plain straight track can become platform
      const back = (dOut + 4) & 7;
      if (!net.hasDir(B, back) || net.degree(B) > 2 || (net.degree(B) === 2 && !net.hasDir(B, dOut))) return { error: 'err_extend_blocked', bad: B };
      if (g.trains.tileReserved(B) || g.trains.foulsTrain([B])) return { error: 'err_train_on_track', bad: B };
      return { tile: B, convert: true, cost: Math.round(COSTS.platformExtend * g.economy.costs.mul()) };
    }
    if (g.decor.at(B)) return { error: 'err_occupied', bad: B };
    if (g.trains.foulsTrain([B])) return { error: 'err_train_on_track', bad: B };
    // new tile at a dead end: only if the end is not connected outward
    if (net.hasDir(E, dOut)) return { error: 'err_extend_blocked', bad: B };
    return { tile: B, convert: false, cost: Math.round((COSTS.platformExtend + COSTS.stationTrackTile) * g.economy.costs.mul()) };
  }
  extendPlatform(stn, k, end) {
    const g = this.game, net = g.net;
    const plan = this.planExtend(stn, k, end);
    if (plan.error) return plan;
    if (!g.economy.canAfford(plan.cost)) return { error: 'err_no_money' };
    g.economy.spend(plan.cost, 'construction');
    const tk = stn.tracks[k];
    const a = this.axisOf(stn);
    const E = end ? tk.tiles[tk.tiles.length - 1] : tk.tiles[0];
    if (!plan.convert) {
      net.connect(E, end ? a : (a + 4) & 7);
      net.tier[plan.tile] = net.tier[E];
    }
    if (end) tk.tiles.push(plan.tile); else tk.tiles.unshift(plan.tile);
    for (let d = 0; d < 8; d++) net.signals.delete(plan.tile * 8 + d);   // stations signal themselves
    this.markTiles(stn);
    g.world.view.clearTrees(plan.tile);
    net.bumpVersion();
    g.railView.animateBuild([plan.tile]);
    stn.build = 1;
    this.relink(stn);
    this.buildVisual(stn);
    g.trains.onNetworkChanged(false);
    g.events.emit('stationEdited', stn);
    return { ok: true, cost: plan.cost };
  }

  canRemoveTrack(stn, k) {
    if (stn.tracks.length <= 1) return 'err_last_track';
    const tk = stn.tracks[k];
    if (!tk || (tk.off || 0) === 0) return 'err_main_track';
    const offs = stn.tracks.map((t) => t.off || 0);
    if ((tk.off > 0 && tk.off < Math.max(...offs)) || (tk.off < 0 && tk.off > Math.min(...offs))) return 'err_inner_track';
    if (this.inUse([...tk.tiles, ...(tk.ladder || [])])) return 'err_station_in_use';
    return null;
  }
  removeTrack(stn, k) {
    const g = this.game, net = g.net;
    const err = this.canRemoveTrack(stn, k);
    if (err) return { error: err };
    const tk = stn.tracks[k];
    const tiles = [...tk.tiles, ...(tk.ladder || []).filter((t) => net.degree(t) <= 2 && !net.special.has(t))];
    for (const t of tk.tiles) net.special.delete(t);
    for (const t of tiles) net.disconnectTile(t);
    stn.tracks.splice(k, 1);
    this.markTiles(stn);
    net.bumpVersion();
    for (const t of tiles) { g.railView.markDirty(t); for (let d = 0; d < 8; d++) g.railView.markDirty(step(t, d)); }
    const refund = Math.round(tk.tiles.length * COSTS.stationTrackTile * g.economy.costs.mul() * COSTS.bulldozeRefund);
    g.economy.earn(refund, 'refund', false);
    this.relink(stn);
    this.buildVisual(stn);
    g.trains.onNetworkChanged(true);
    g.events.emit('stationEdited', stn);
    return { ok: true, refund };
  }

  setTrackRole(stn, k, role) {
    if (!PLATFORM_ROLES.includes(role) || !stn.tracks[k]) return;
    stn.tracks[k].role = role;
    this.markTiles(stn);
    this.game.net.bumpVersion();
    this.buildVisual(stn);
  }
  setTrackDir(stn, k, dir) {
    if (!['both', 'fwd', 'rev'].includes(dir) || !stn.tracks[k]) return;
    stn.tracks[k].dir = dir;
  }

  facilityError(stn, id) {
    const g = this.game;
    if (!FACILITIES[id]) return 'err_unknown';
    if (!g.progression.research.has('freight_terminals')) return 'err_research_required';
    if (stn.facilities.includes(id)) return 'err_done';
    if (stn.facilities.length >= 2) return 'err_max_facilities';
    if (!g.economy.canAfford(this.facilityCost())) return 'err_no_money';
    return null;
  }
  facilityCost() { return Math.round(COSTS.facility * this.game.economy.costs.mul()); }
  buildFacility(stn, id) {
    const err = this.facilityError(stn, id);
    if (err) return err;
    this.game.economy.spend(this.facilityCost(), 'construction');
    stn.facilities.push(id);
    stn.build = 1;
    this.buildVisual(stn);
    this.game.events.emit('stationEdited', stn);
    return null;
  }

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

  // ---------- statistics ----------
  noteArrival(stn, t, moved) {
    const S = stn.stats;
    S.arrivals++;
    S.recent.push({ time: this.game.time, train: t.id, eff: t.platEff || 1, len: t._st.length, moved, reversed: false });
    if (S.recent.length > 30) S.recent.shift();
  }
  noteWait(stnId, dt) { const s = this.byId(stnId); if (s) { s.stats.wait += dt; } }
  noteTransfer(stn, c, n) { stn.stats.transfers += n; }

  tick(dt) {
    const net = this.game.net;
    for (const s of this.list) {
      const S = s.stats;
      const k = Math.exp(-dt / 120);
      S.waitEma = S.waitEma * k + (S.wait > S._lastWait ? 1 : 0) * (1 - k);
      S._lastWait = S.wait;
      if (!S.util || S.util.length !== s.tracks.length) S.util = s.tracks.map(() => 0);
      s.tracks.forEach((tk, i) => {
        let occ = 0;
        for (const t of tk.tiles) if (net.tileHolder(t)) { occ = 1; break; }
        S.util[i] = S.util[i] * k + occ * (1 - k);
      });
    }
  }

  // Suggestions for a station: platform length, capacity, storage, turnarounds.
  advise(stn) {
    const g = this.game, out = [];
    const S = stn.stats;
    const recent = S.recent.filter((r) => g.time - r.time < 900);
    const short = recent.filter((r) => r.eff < 0.9);
    if (short.length) {
      const worst = short.reduce((a, b) => (b.len > a.len ? b : a));
      const tr0 = g.trains.byId(worst.train);
      const need = Math.max(1, Math.ceil(worst.len / TILE) - Math.max(...stn.tracks.map((t) => t.tiles.length)));
      out.push({ key: 'adv_platform_short', p: { train: tr0 ? tr0.name : '', n: need }, act: 'extend' });
    }
    const util = S.util && S.util.length ? S.util.reduce((a, b) => a + b, 0) / S.util.length : 0;
    if (S.waitEma > 0.25 && util > 0.55) out.push({ key: 'adv_add_track', act: 'track' });
    if (stn.warn) out.push({ key: 'adv_storage', act: 'upgrade' });
    const turns = recent.filter((r) => r.turned).length;
    if (turns > 3) out.push({ key: 'adv_turnaround' });
    const net = g.net;
    const dead = stn.tracks.some((tk) => tk.tiles.length && [tk.tiles[0], tk.tiles[tk.tiles.length - 1]].some((t) => net.degree(t) <= 1));
    if (dead && stn.tracks.length === 1 && S.waitEma > 0.3) out.push({ key: 'adv_terminus' });
    return out;
  }

  // ---------- visuals ----------
  frameOf(stn) {
    const a = this.axisOf(stn);
    const len = Math.hypot(DX[a], DZ[a]);
    const ax = [DX[a] / len, DZ[a] / len], pz = [-DZ[a] / len, DX[a] / len];
    const yaw = Math.atan2(-DZ[a], DX[a]);
    return { a, ax, pz, yaw, ox: tileCX(stn.tile), oz: tileCZ(stn.tile), oy: this.game.net.railH(stn.tile) };
  }
  toLocal(F, tile) {
    const dx = tileCX(tile) - F.ox, dz = tileCZ(tile) - F.oz;
    return { x: dx * F.ax[0] + dz * F.ax[1], z: dx * F.pz[0] + dz * F.pz[1], y: this.game.net.railH(tile) - F.oy };
  }

  buildVisual(stn) {
    if (stn.mesh) { this.group.remove(stn.mesh); stn.mesh.geometry.dispose(); }
    const style = STATION_STYLES.find((s) => s.id === stn.style) || STATION_STYLES[0];
    const F = this.frameOf(stn);
    const net = this.game.net;
    // local layout of every track tile
    const tracks = stn.tracks.map((tk) => {
      const pts = tk.tiles.map((t) => this.toLocal(F, t));
      const xs = pts.map((p) => p.x);
      const ends = [tk.tiles[0], tk.tiles[tk.tiles.length - 1]];
      const deadEnd = [net.degree(ends[0]) <= 1 && !net.hasDir(ends[0], (F.a + 4) & 7), net.degree(ends[1]) <= 1 && !net.hasDir(ends[1], F.a)];
      return { pts, x0: Math.min(...xs) - TILE / 2, x1: Math.max(...xs) + TILE / 2, z: pts.length ? pts[0].z : 0, y: pts.length ? pts.reduce((a, p) => a + p.y, 0) / pts.length : 0, role: tk.role, deadEnd };
    });
    const mb = new ModelBuilder();
    const info = this.stationKind(stn, tracks);
    stn.kind = info.kind;
    stationComplexModel(mb, stn.level, style, tracks, stn.facilities, stn.tracks.length > 1 && F.a % 2 === 1, info);
    const mesh = meshFrom(mb.build());
    mesh.position.set(F.ox, F.oy + 0.02, F.oz);
    mesh.rotation.y = F.yaw;
    stn.yaw = F.yaw;
    stn.frame = F;
    stn.layout = tracks;
    mesh.userData.station = stn.id;
    stn.mesh = mesh;
    this.group.add(mesh);
    stn.pulse = 1;
  }

  // Station type from what it is used for: goods stations by track roles /
  // catchment, high-speed stations by line class, otherwise the passenger
  // ladder by level. terminal: +1 / -1 when most tracks end at one side.
  stationKind(stn, layout = stn.layout) {
    const net = this.game.net;
    const n = stn.tracks.length;
    const freightTracks = stn.tracks.filter((t) => t.role === 'freight').length;
    const towns = stn.links ? (stn.links.towns || []).length : 0, inds = stn.links ? (stn.links.industries || []).length : 0;
    const hs = stn.tracks.some((tk) => tk.tiles.some((t) => net.tier[t] === 3));
    let terminal = 0;
    if (layout && layout.length) {
      const a = layout.filter((l) => l.deadEnd[0]).length, b = layout.filter((l) => l.deadEnd[1]).length;
      if (b * 2 > layout.length && b > a) terminal = 1; else if (a * 2 > layout.length) terminal = -1;
    }
    let kind;
    if ((freightTracks && freightTracks === n) || (!towns && inds)) kind = stn.facilities.includes('container_crane') ? 'intermodal' : n >= 3 ? 'yard' : 'freight';
    else if (hs && stn.level >= 2) kind = 'hs';
    else kind = stn.level === 0 ? (n > 1 ? 'village' : 'halt') : ['halt', 'village', 'town', 'city', 'central', 'grand'][stn.level];
    return { kind, terminal };
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
    if (s) { const F = this.frameOf(s); if (Math.abs(F.yaw - (s.yaw || 0)) > 1e-3 || s.tracks.length) this.buildVisual(s); }
    const d = this.depotAt(tile);
    if (d) this.buildDepotVisual(d);
  }

  updateVisuals(dt, time) {
    for (const s of this.list) {
      if (!s.mesh) continue;
      if (s.pulse > 0) { s.pulse = Math.max(0, s.pulse - dt * 1.6); const k = 1 + Math.sin(s.pulse * Math.PI) * 0.12; s.mesh.scale.set(1, k, 1); }
      // construction animation: grows up out of the ground
      if (s.build > 0) {
        s.build = Math.max(0, s.build - dt * (this.game.settings.reducedMotion ? 10 : 1.4));
        const e = 1 - s.build;
        s.mesh.scale.y = Math.max(0.05, 1 - Math.pow(1 - e, 3) * 0 - s.build * 0.95);
        if (s.build > 0 && Math.random() < dt * 8) this.game.particles.emit('dust', s.mesh.position.x + (Math.random() - 0.5) * 2, s.mesh.position.y + 0.2, s.mesh.position.z + (Math.random() - 0.5) * 2, 1);
      }
    }
    const m = this._m, c = this._c;
    const q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
    let np = 0;
    const shirts = [0x3f6e9a, 0xc94f4f, 0xe0a33a, 0x5aa66a, 0x8a5ab0, 0xe8e2d4, 0x2b2b2b];
    for (const s of this.list) {
      if (!s.mesh || !s.layout) continue;
      const pax = s.stock.PASSENGERS || 0;
      const want = s.links && s.links.towns.length ? Math.min(STATION.passengers[s.level] * Math.min(3, s.tracks.length), Math.ceil(pax / 3)) : 0;
      const cy = Math.cos(s.yaw), sy = Math.sin(s.yaw);
      const L = s.layout;
      for (let k = 0; k < want && np < this.people.instanceMatrix.count; k++) {
        const r1 = ((s.id * 7919 + k * 104729) % 1000) / 1000, r2 = ((s.id * 31 + k * 977) % 1000) / 1000;
        const tk = L[k % L.length];
        const side = k % 2 ? 1 : -1;
        const lx = tk.x0 + 0.3 + r1 * (tk.x1 - tk.x0 - 0.6) + Math.sin(time * 0.3 + k) * 0.05, lz = tk.z + side * (0.8 + r2 * 0.14);
        const wx = s.mesh.position.x + lx * cy + lz * sy, wz = s.mesh.position.z - lx * sy + lz * cy;
        const bob = Math.abs(Math.sin(time * 2 + k * 1.7)) * 0.015;
        q.setFromAxisAngle(up, r1 * 6.28);
        p.set(wx, s.mesh.position.y + tk.y + 0.25 + bob, wz);
        m.compose(p, q, sc);
        this.people.setMatrixAt(np, m);
        this.people.setColorAt(np, c.set(shirts[(s.id + k) % shirts.length]));
        np++;
      }
    }
    this.people.count = np;
    this.people.instanceMatrix.needsUpdate = true;
    if (this.people.instanceColor) this.people.instanceColor.needsUpdate = true;
    this._vis = (this._vis || 0) - dt;
    if (this._vis > 0) return;
    this._vis = 0.4;
    let nc = 0;
    for (const s of this.list) {
      if (!s.mesh || !s.layout) continue;
      const cap = this.storage(s);
      const cy = Math.cos(s.yaw), sy = Math.sin(s.yaw);
      const minZ = Math.min(...s.layout.map((l) => l.z));
      const x0 = s.layout[0].x0;
      let slot = 0;
      for (const cid in s.stock) {
        if (cid === 'PASSENGERS') continue;
        const amt = s.stock[cid];
        const n = Math.min(8, Math.ceil((amt / cap) * 8));
        for (let k = 0; k < n && nc < this.crates.instanceMatrix.count; k++, slot++) {
          const row = Math.floor(slot / 6), col = slot % 6;
          const lx = x0 + 0.25 + col * 0.26, lz = minZ - (1.15 + row * 0.24);
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
      stations: this.list.map((s) => ({
        id: s.id, tile: s.tile, level: s.level, style: s.style, name: s.name, stock: s.stock, delivered: s.delivered, picked: s.picked,
        tracks: s.tracks.map((t) => ({ tiles: t.tiles, role: t.role, dir: t.dir, off: t.off || 0, ladder: t.ladder || [] })), facilities: s.facilities,
        stats: { arrivals: s.stats.arrivals, transfers: s.stats.transfers },
      })),
      depots: this.depots.map((d) => ({ id: d.id, tile: d.tile, name: d.name })),
    };
  }
  deserialize(d) {
    if (!d) return;
    const net = this.game.net;
    this.nextId = d.nextId || 1;
    for (const s of d.stations || []) {
      if (typeof s.tile !== 'number' || s.tile < 0 || s.tile >= N * N || net.special.has(s.tile)) continue;
      const stn = this.newStation(s.tile, { id: s.id });
      this.nextId = Math.max(this.nextId, stn.id + 1);
      stn.level = Math.max(0, Math.min(STATION.maxLevel, s.level | 0));
      stn.style = s.style || 'classic';
      stn.name = String(s.name || 'Station');
      stn.delivered = s.delivered || 0; stn.picked = s.picked || 0;
      for (const c in s.stock || {}) if (CARGO[c] && s.stock[c] > 0) stn.stock[c] = s.stock[c];
      // tracks: validate tiles (in map, free, has rail except legacy single tile)
      const tracks = [];
      const used = new Set([s.tile]);
      if (Array.isArray(s.tracks)) s.tracks.forEach((tk, k) => {
        if (!tk || !Array.isArray(tk.tiles)) return;
        const tiles = tk.tiles.filter((t) => typeof t === 'number' && t >= 0 && t < N * N && (!net.special.has(t)) && (k === 0 || !used.has(t)));
        if (k === 0 && !tiles.includes(s.tile)) return;
        if (!tiles.length) return;
        for (const t of tiles) used.add(t);
        tracks.push({ tiles, role: PLATFORM_ROLES.includes(tk.role) ? tk.role : 'any', dir: ['both', 'fwd', 'rev'].includes(tk.dir) ? tk.dir : 'both', off: tk.off | 0, ladder: Array.isArray(tk.ladder) ? tk.ladder.filter((t) => typeof t === 'number') : [] });
      });
      if (!tracks.length) tracks.push({ tiles: [s.tile], role: 'any', dir: 'both', off: 0, ladder: [] });
      stn.tracks = tracks;
      stn.facilities = Array.isArray(s.facilities) ? s.facilities.filter((f) => FACILITIES[f]).slice(0, 2) : [];
      if (s.stats) { stn.stats.arrivals = s.stats.arrivals | 0; stn.stats.transfers = s.stats.transfers | 0; }
      this.list.push(stn);
      this.markTiles(stn);
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
    for (const s of this.list) { this.relink(s); this.buildVisual(s); s.pulse = 0; s.build = 0; }
    for (const d of this.depots) this.buildDepotVisual(d);
  }
}

function freshStats() { return { arrivals: 0, wait: 0, _lastWait: 0, waitEma: 0, transfers: 0, recent: [], util: [] }; }

export { DX, DZ, inMap, TILE, stationComplexModel, depotModel, stationModel };
