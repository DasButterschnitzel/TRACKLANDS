// Game orchestrator: owns the scene and every system, runs the fixed-step
// simulation separately from rendering, wires feedback (audio/VFX/UI) to
// gameplay events, and handles saving plus offline progress.
import * as THREE from 'three';
import { N, TILE, Emitter, tileCX, tileCZ, tx, tz, fmt, clamp } from './util.js';
import { DIFFICULTY, SAVE_VERSION, GAME_VERSION, OFFLINE, REGIONS, INDUSTRIES, REVENUE } from './config.js';
import { generateWorld } from './world/WorldGen.js';
import { WorldView } from './world/WorldView.js';
import { RailNetwork } from './rail/RailNetwork.js';
import { RailRenderer } from './rail/RailRenderer.js';
import { StationSystem } from './rail/Stations.js';
import { Construction } from './rail/Construction.js';
import { RailFurniture } from './rail/RailFurniture.js';
import { Overlays } from './ui/Overlays.js';
import { IndustrySystem } from './world/Industries.js';
import { TownSystem } from './world/Towns.js';
import { DecorSystem } from './world/Decor.js';
import { Environment } from './world/Environment.js';
import { TrainSystem, locoModel } from './trains/Trains.js';
import { Economy } from './economy/Economy.js';
import { Progression } from './progression/Progression.js';
import { Stats } from './progression/Stats.js';
import { Particles } from './vfx/Particles.js';
import { CameraController } from './core/CameraController.js';
import { Input } from './core/Input.js';
import { Tutorial } from './ui/Tutorial.js';

const STEP = 1 / 30;

export class Game {
  constructor(ctx, opts) {
    this.ctx = ctx;
    this.renderer = ctx.renderer;
    this.audio = ctx.audio;
    this.settings = ctx.settings;
    this.store = ctx.store;
    this.ui = ctx.ui;
    this.events = new Emitter();
    this.scene = new THREE.Scene();
    this.time = 0; this.clock = 0; this.speed = 1; this.running = false;
    this.selection = null;
    this.cleared = new Set();
    this.autosaveT = 30;
    const save = opts.save || null;
    const seed = save ? save.seed : opts.seed;
    this.difficultyId = save ? (DIFFICULTY[save.difficulty] ? save.difficulty : 'standard') : opts.difficulty || 'standard';
    this.difficulty = DIFFICULTY[this.difficultyId];

    this.world = generateWorld(seed);
    this.occupancy = { blocked: new Uint8Array(N * N), owner: new Int32Array(N * N) };
    this.stats = new Stats(this);
    this.progression = new Progression(this);
    this.economy = new Economy(this);
    if (save) { this.progression.deserialize(save.progression); this.stats.deserialize(save.stats); }
    if (opts.legacy) { this.progression.legacy = { count: opts.legacy.count }; for (const id of opts.legacy.achievements || []) this.progression.achievements.add(id); for (const id of opts.legacy.owned || []) this.progression.owned.add(id); this.progression.recomputeFx(); }

    this.camera = new CameraController(this);
    this.world.view = new WorldView(this, this.world);
    this.net = new RailNetwork(this);
    this.railView = new RailRenderer(this);
    this.stations = new StationSystem(this);
    this.industries = new IndustrySystem(this);
    this.industries.init(this.world);
    this.towns = new TownSystem(this);
    this.towns.init(this.world);
    this.decor = new DecorSystem(this);
    this.trains = new TrainSystem(this);
    this.particles = new Particles(this);
    this.env = new Environment(this);
    this.construction = new Construction(this);
    this.furniture = new RailFurniture(this);
    this.overlays = new Overlays(this);

    if (save) this.restore(save);
    else this.fresh(opts);

    this.railView.markAll();
    this.stations.buildAllVisuals();
    this.industries.buildAllVisuals();
    this.industries.onStationsChanged();
    this.towns.onStationsChanged();
    this.economy.fillContracts();
    this.economy.ensureDaily();
    this.progression.syncFleetStats();

    this.input = new Input(this, this.renderer.domElement);
    this.tutorial = new Tutorial(this, save ? save.tutorial : null);
    this.wireEvents();
    this.resize();
    this.offline = save ? this.computeOffline(save) : null;
  }

  fresh(opts) {
    this.economy.coins = this.difficulty.money + (this.progression.legacy.count * 2500);
    this.progression.rp += this.progression.legacy.count * 3;
    this.towns.buildAll();
    const g = this.towns.list[0];
    this.camera.target.set((g.x + 0.5) * TILE, 0, (g.z + 0.5) * TILE);
    this.camera.zoomGoal = this.camera.viewSize = 20;
    void opts;
  }

  restore(s) {
    this.net.deserialize(s.net);
    this.stations.deserialize(s.stations);
    this.industries.deserialize(s.industries);
    this.towns.deserialize(s.towns);
    this.stations.relinkAll();
    this.towns.buildAll();
    this.stations.relinkAll();
    if (Array.isArray(s.cleared)) this.world.view.clearTreesMany(s.cleared.filter((t) => t >= 0 && t < N * N));
    for (const st of this.stations.list) this.world.view.clearTrees(st.tile);
    for (let i = 0; i < N * N; i++) if (this.net.conn[i]) this.world.view.clearTrees(i);
    this.decor.deserialize(s.decor);
    this.economy.deserialize(s.economy);
    this.env.deserialize(s.env);
    this.time = +s.time || 0;
    this.camera.deserialize(s.camera);
    this.trains.deserialize(s.trains);
    this.world.view.recolorTerrain();
  }

  serialize() {
    return {
      saveVersion: SAVE_VERSION, gameVersion: GAME_VERSION, seed: this.world.seed, difficulty: this.difficultyId,
      time: this.time, savedAt: Date.now(),
      net: this.net.serialize(), stations: this.stations.serialize(), industries: this.industries.serialize(), towns: this.towns.serialize(),
      trains: this.trains.serialize(), economy: this.economy.serialize(), progression: this.progression.serialize(), stats: this.stats.serialize(),
      env: this.env.serialize(), camera: this.camera.serialize(), decor: this.decor.serialize(), cleared: [...this.cleared],
      tutorial: this.tutorial ? this.tutorial.serialize() : null,
    };
  }

  async save(backup = false) {
    try {
      const data = this.serialize();
      await this.store.put('main', data);
      if (backup) await this.store.put('backup', data);
      this.events.emit('saved');
      return true;
    } catch (e) { console.error('save failed', e); return false; }
  }

  // ---------- offline progress ----------
  computeOffline(s) {
    const away = clamp((Date.now() - (s.savedAt || Date.now())) / 1000, 0, OFFLINE.maxSeconds);
    if (away < 60 || !this.trains.trains.length) return null;
    const min = away / 60, eff = OFFLINE.efficiency;
    const coins = Math.round(this.economy.avgIncomePerMin() * min * eff);
    const deliveries = Math.round(this.economy.avgDeliveriesPerMin() * min * eff);
    const towns = {};
    const log = this.economy.incomeLog;
    if (log.length) for (const b of log) for (const id in b.towns) for (const c in b.towns[id]) {
      towns[id] = towns[id] || {};
      towns[id][c] = (towns[id][c] || 0) + (b.towns[id][c] / log.length) * min * eff;
    }
    if (coins <= 0 && deliveries <= 0) return null;
    return { away, coins, deliveries, xp: Math.round(coins * REVENUE.xpPerCoin), towns };
  }

  claimOffline() {
    const o = this.offline;
    if (!o) return;
    this.offline = null;
    this.economy.earn(o.coins, 'offline', false);
    this.progression.addXP(o.xp);
    this.stats.inc('deliveries', o.deliveries);
    for (const id in o.towns) {
      const t = this.towns.byId(+id);
      if (!t) continue;
      for (const c in o.towns[id]) this.towns.receive(t, c, Math.floor(o.towns[id][c]));
    }
    // primary industries kept producing
    const mins = o.away / 60;
    for (const ind of this.industries.list) {
      if (!INDUSTRIES[ind.type].primary || !this.progression.regionUnlocked(ind.region)) continue;
      const cap = this.industries.capacity(ind);
      for (const r of INDUSTRIES[ind.type].recipes) for (const c in r.out) ind.out[c] = Math.min(cap, (ind.out[c] || 0) + this.industries.rate(ind) * mins * 0.3);
    }
    this.audio.play('coin');
  }

  // ---------- selection ----------
  select(sel) {
    this.selection = sel;
    this.ui.showInspector(sel);
    if (sel) this.audio.play('click');
    this.events.emit('select', sel);
  }
  selectTile(tile) {
    if (tile < 0) { this.select(null); return; }
    const sp = this.net.special.get(tile);
    if (sp) { this.select({ type: sp.type, id: sp.id }); return; }
    const o = this.occupancy.owner[tile];
    if (o >= 1000) { this.select({ type: 'industry', id: o }); return; }
    if (o > 0) { this.select({ type: 'town', id: o }); return; }
    // towns are also selectable by clicking near their center
    for (const t of this.towns.list) if (Math.max(Math.abs(t.x - tx(tile)), Math.abs(t.z - tz(tile))) <= 1) { this.select({ type: 'town', id: t.id }); return; }
    if (this.world.region[tile] !== undefined && !this.progression.regionUnlocked(this.world.region[tile])) { this.select({ type: 'region', id: this.world.region[tile] }); return; }
    this.select(null);
  }
  entityPos(sel) {
    if (!sel) return null;
    switch (sel.type) {
      case 'station': { const s = this.stations.byId(sel.id); return s ? { x: tileCX(s.tile), y: this.net.railH(s.tile), z: tileCZ(s.tile) } : null; }
      case 'depot': { const d = this.stations.depotById(sel.id); return d ? { x: tileCX(d.tile), y: this.net.railH(d.tile), z: tileCZ(d.tile) } : null; }
      case 'industry': { const i = this.industries.byId(sel.id); return i ? { x: (i.x + 1) * TILE, y: this.industries.baseHeight(i), z: (i.z + 1) * TILE } : null; }
      case 'town': { const t = this.towns.byId(sel.id); return t ? { x: (t.x + 0.5) * TILE, y: this.world.tileH[t.z * N + t.x], z: (t.z + 0.5) * TILE } : null; }
      case 'train': { const t = this.trains.byId(sel.id); if (!t || !t.visual) return null; const p = t.visual.cars[0].mesh.position; return { x: p.x, y: p.y, z: p.z }; }
      case 'region': { const c = this.world.centers[sel.id]; return { x: c[0] * TILE, y: 0, z: c[1] * TILE }; }
      default: return null;
    }
  }
  focusOn(sel, zoom) { const p = this.entityPos(sel); if (p) this.camera.focus(p.x, p.z, zoom); }

  // Network-wide bottleneck advisor: stations, single-track sections, deadlocks.
  advisor() {
    const out = [];
    for (const s of this.stations.list) for (const a of this.stations.advise(s)) out.push({ ...a, station: s.id, name: s.name });
    const net = this.net;
    net.computeRuns();
    const runHeat = new Map();
    for (let i = 0; i < N * N; i++) if (net.runId[i] >= 0 && net.waitHeat[i] > 0) runHeat.set(net.runId[i], Math.max(runHeat.get(net.runId[i]) || 0, net.waitHeat[i]));
    for (const [rid, h] of runHeat) if (h > 60) {
      let tile = -1; for (let i = 0; i < N * N; i++) if (net.runId[i] === rid) { tile = i; break; }
      out.push({ key: 'adv_single_track', tile, p: { n: Math.round(h) } });
    }
    for (const inc of this.trains.incidents.slice(-3)) if (this.time - inc.time < 600) out.push({ key: 'adv_deadlock', tile: inc.tile, p: { n: inc.trains.length } });
    for (const t of this.trains.trains) if (t._st.rating === 'overloaded') out.push({ key: 'adv_overloaded', train: t.id, p: { name: t.name } });
    return out;
  }

  setSpeed(s) { this.speed = s; this.events.emit('speed', s); }
  togglePause() { this.setSpeed(this.speed === 0 ? (this._lastSpeed || 1) : (this._lastSpeed = this.speed, 0)); }

  // ---------- feedback wiring ----------
  near(p) {
    const c = this.camera;
    const d = Math.hypot(p.x - c.target.x, p.z - c.target.z);
    return clamp(1.3 - d / (c.viewSize * 1.6), 0, 1);
  }

  wireEvents() {
    const E = this.events, ui = this.ui, A = this.audio, P = this.particles;
    E.on('delivery', (d) => {
      const s = d.station;
      const x = tileCX(s.tile), y = this.net.railH(s.tile) + 0.8, z = tileCZ(s.tile);
      ui.floatText(x, y, z, `+${fmt(d.revenue)}`, 'coin');
      const v = this.near({ x, z });
      if (v > 0) { P.emit('coin', x, y, z, 6); A.play('coin', { vol: 0.5 + v * 0.5 }); }
      if (d.town) ui.pulseLabel('town', d.town.id);
    });
    E.on('trainDepart', (t) => {
      const loco = t.visual && t.visual.cars[0].mesh;
      if (!loco) return;
      const v = this.near(loco.position);
      const m = locoModel(t.model);
      if (v > 0.1 && t.trips % 3 === 0) A.play('whistle', { kind: m.kind, vol: v });
      if (v > 0.1 && m.kind.startsWith('steam')) { A.play('chuff', { vol: v * 0.7 }); P.emit('steam', loco.position.x, loco.position.y + 0.9, loco.position.z, 6); }
    });
    E.on('trainArrive', (t, stn, moved) => {
      if (!stn) return;
      const p = { x: tileCX(stn.tile), z: tileCZ(stn.tile) };
      const v = this.near(p);
      if (v > 0.2) { A.play('arrive', { vol: v * 0.6 }); if (moved) A.play('unload', { vol: v }); }
      stn.pulse = Math.max(stn.pulse || 0, 0.5);
    });
    E.on('trainLoaded', (t, stn) => { const v = this.near({ x: tileCX(stn.tile), z: tileCZ(stn.tile) }); if (v > 0.2) A.play('load', { vol: v }); });
    E.on('trainSpawn', (t, depot) => {
      const x = tileCX(depot.tile), z = tileCZ(depot.tile), y = this.net.railH(depot.tile);
      P.burst(x, y + 0.5, z, false);
      P.emit('steam', x, y + 1, z, 12);
      A.play('whistle', { kind: locoModel(t.model).kind });
      this.camera.focus(x, z);
    });
    E.on('trainBought', (t) => ui.toast(ui.tr('toast_train_bought', { name: t.name }), 'good', 'train'));
    E.on('townLevel', (t) => {
      const x = (t.x + 0.5) * TILE, z = (t.z + 0.5) * TILE, y = this.world.tileH[t.z * N + t.x];
      P.burst(x, y + 1.5, z, true);
      P.emit('dust', x, y + 0.3, z, 20, 2);
      A.play('townUp');
      this.camera.focus(x, z);
      this.camera.shake(0.5);
      ui.celebrate(ui.tr('city_evolved'), `${t.name} · ${ui.tr('stage_' + this.towns.stageName(t))}`);
    });
    E.on('levelUp', (lvl) => {
      A.play('levelUp');
      ui.levelUp(lvl, this.progression.unlocksAt(lvl));
    });
    E.on('regionUnlocked', (r) => {
      this.world.view.revealRegion(r);
      const c = this.world.centers[r];
      this.camera.focus(c[0] * TILE, c[1] * TILE, 42);
      A.play('region');
      for (let k = 0; k < 8; k++) P.emit('mist', c[0] * TILE + (Math.random() - 0.5) * 20, 5, c[1] * TILE + (Math.random() - 0.5) * 20, 3);
      P.burst(c[0] * TILE, 2, c[1] * TILE, true);
      ui.celebrate(ui.tr('region_unlocked'), ui.tr('region_' + REGIONS[r].id));
      this.stations.relinkAll();
      this.economy.fillContracts();
    });
    E.on('research', (r) => { A.play('research'); ui.toast(ui.tr('toast_research', { name: ui.tr('res_' + r.id) }), 'good', 'research'); });
    E.on('achievement', (a) => { A.play('achievement'); ui.toast(ui.tr('toast_achievement', { name: ui.tr('ach_' + a.id) }), 'gold', 'achievements'); });
    E.on('objectiveDone', (o, r, coins) => { A.play('coin'); ui.toast(ui.tr('toast_objective', { name: ui.objectiveText(o), coins: fmt(coins) }), 'good', 'objectives'); });
    E.on('regionDeveloped', (r) => ui.toast(ui.tr('toast_region_developed', { name: ui.tr('region_' + REGIONS[r].id) }), 'gold', 'map'));
    E.on('contractDone', (k) => { A.play('coin'); ui.toast(ui.tr('toast_contract_done'), 'good', 'contracts'); });
    E.on('contractExpired', () => ui.toast(ui.tr('toast_contract_expired'), 'info', 'contracts'));
    E.on('eventStart', (ev) => ui.banner(ui.tr('ev_' + ev.id), ui.tr('ev_' + ev.id + '_desc')));
    E.on('eventEnd', () => ui.banner(null));
    E.on('industryLevel', (ind) => {
      const x = (ind.x + 1) * TILE, z = (ind.z + 1) * TILE;
      P.burst(x, this.industries.baseHeight(ind) + 1, z);
      A.play('levelUp', { vol: 0.6 });
      ui.toast(ui.tr('toast_industry_level', { name: this.industries.displayName(ind), level: ui.tr('ilvl_' + ind.level) }), 'good', 'factory');
    });
    E.on('legend', () => { A.play('legend'); ui.legend(); P.burst(this.camera.target.x, 3, this.camera.target.z, true); });
    E.on('weather', (w) => this.ui.weatherChanged(w));
    E.on('stationUpgraded', (s) => { A.play('construct'); P.burst(tileCX(s.tile), this.net.railH(s.tile) + 1, tileCZ(s.tile)); this.camera.shake(0.2); });
    E.on('trainRecovered', (t) => ui.toast(ui.tr('toast_train_recovered', { name: t.name }), 'info', 'train'));
    E.on('deadlockResolved', (t, how) => ui.toast(ui.tr('toast_deadlock_' + how, { name: t.name }), 'info', 'train'));
    E.on('trainRunaround', (t) => {
      const loco = t.visual && t.visual.cars[0] && t.visual.cars[0].mesh;
      if (!loco) return;
      const v = this.near(loco.position);
      if (v > 0.2) { A.play('chuff', { vol: v * 0.5 }); P.emit(locoModel(t.model).kind.startsWith('steam') ? 'steam' : 'dust', loco.position.x, loco.position.y + 0.6, loco.position.z, 5); }
    });
    E.on('stationEdited', (s) => { A.play('construct'); P.burst(tileCX(s.tile), this.net.railH(s.tile) + 1, tileCZ(s.tile)); this.industries.onStationsChanged(); this.towns.onStationsChanged(); });
    E.on('stationBuilt', () => { this.industries.onStationsChanged(); this.towns.onStationsChanged(); });
    E.on('stationsRelinked', () => { this.industries.onStationsChanged(); this.towns.onStationsChanged(); });
  }

  // ---------- main loop ----------
  tick(dt) {
    this.time += dt;
    this.stats.inc('playTime', dt);
    this.industries.tick(dt);
    this.towns.tick(dt);
    this.stations.tick(dt);
    this.trains.tick(dt);
    this.economy.tick(dt);
    this.progression.tick(dt);
    const decay = Math.exp(-dt / 90);
    const tr = this.net.traffic, wh = this.net.waitHeat;
    const wdecay = Math.exp(-dt / 240);
    for (let i = 0; i < tr.length; i++) { if (tr[i] > 0.001) tr[i] *= decay; if (wh[i] > 0.001) wh[i] *= wdecay; }
  }

  frame(dt) {
    dt = Math.min(dt, 0.1);
    this.clock += dt;
    this.input.update(dt);
    let gameDt = 0;
    if (this.running && this.speed > 0) {
      gameDt = dt * this.speed;
      const steps = Math.max(1, Math.ceil(gameDt / STEP - 1e-6));
      const sub = gameDt / steps;
      for (let k = 0; k < steps; k++) this.tick(sub);
    }
    this.camera.update(dt);
    this.env.update(dt, gameDt, this.clock);
    this.world.view.update(dt, this.clock);
    this.railView.update(dt);
    this.furniture.update(dt);
    this.overlays.update(dt);
    this.trains.updateVisuals(dt);
    this.stations.updateVisuals(dt, this.clock);
    this.industries.updateVisuals(dt, this.clock);
    this.towns.updateVisuals(dt, this.clock);
    this.particles.update(dt);
    this.construction.update();
    this.audio.update(dt);
    this.tutorial.update(dt);
    this.ui.update(dt);
    if (this.running) {
      this.autosaveT -= dt;
      if (this.autosaveT <= 0) { this.autosaveT = 30; this.save(); }
    }
    this.renderer.render(this.scene, this.camera.camera);
  }

  resize() {
    const r = this.renderer;
    const w = window.innerWidth, h = window.innerHeight;
    r.setSize(w, h, false);
    this.camera.resize(w, h);
  }

  dispose() {
    this.running = false;
    this.input.dispose();
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (m.map) m.map.dispose(); if (!m.userData.shared) m.dispose(); });
    });
    if (this.env.skyTex) this.env.skyTex.dispose();
    this.renderer.renderLists.dispose();
  }
}
