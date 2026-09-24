// Contextual tutorial: guides the player through real gameplay actions and
// then introduces later mechanics with one-time hints.
import * as THREE from 'three';
import { TILE, tileCX, tileCZ, N } from '../util.js';
import { has as hasText } from '../i18n.js';

const STEPS = [
  { id: 'welcome', button: 'tut_start' },
  { id: 'select_forest', target: 'forest', done: (g, T) => g.selection && g.selection.type === 'industry' && g.selection.id === T.forestId },
  { id: 'build_station_forest', target: 'forest', ui: 'tool-station', done: (g, T) => !!T.stationFor('industry', T.forestId) },
  { id: 'select_town', target: 'town', done: (g, T) => g.selection && g.selection.type === 'town' && g.selection.id === T.townId },
  { id: 'build_station_town', target: 'town', ui: 'tool-station', done: (g, T) => !!T.stationFor('town', T.townId) },
  { id: 'choose_track', ui: 'tool-track', done: (g) => g.construction.tool === 'track' },
  { id: 'connect', target: 'between', done: (g, T) => T.linkedPair() },
  { id: 'build_depot', ui: 'tool-depot', target: 'between', done: (g, T) => T.stationsFor('town', T.townId).some((a) => g.stations.depots.some((d) => g.net.connected(d.tile, a.tile))) },
  { id: 'buy_train', ui: 'tool-train', done: (g) => g.trains.trains.length > 0 },
  { id: 'watch_collect', target: 'train', done: (g, T) => T.flags.loaded },
  { id: 'deliver', target: 'train', done: (g) => g.stats.data.deliveries > 0 },
  { id: 'reward', button: 'tut_collect', reward: true },
  { id: 'growth', target: 'town', button: 'tut_finish', onEnter: (g, T) => g.select({ type: 'town', id: T.townId }) },
];

export class Tutorial {
  constructor(game, data) {
    this.game = game;
    this.step = data && typeof data.step === 'number' ? data.step : 0;
    this.finished = !!(data && data.finished);
    this.hints = new Set((data && data.hints) || []);
    this.flags = { loaded: false };
    this.forestId = game.industries.list[0] ? game.industries.list[0].id : -1;
    this.townId = game.towns.list[0] ? game.towns.list[0].id : -1;
    // marker
    const g = new THREE.ConeGeometry(0.5, 1.1, 4);
    g.rotateX(Math.PI);
    this.marker = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xffd24a }));
    this.marker.visible = false;
    game.scene.add(this.marker);
    this.entered = -1;
    game.events.on('trainLoaded', (t) => { if (t.cargo.some((l) => l.c === 'WOOD')) this.flags.loaded = true; });
    game.events.on('tool', (tool) => this.hintOnce('tool_' + tool));
    game.events.on('levelUp', (lvl) => { if (lvl === 3) this.hintOnce('research'); if (lvl === 4) this.hintOnce('regions'); if (lvl === 2) this.hintOnce('upgrades'); });
    game.events.on('regionUnlocked', () => this.hintOnce('new_region'));
    game.events.on('eventStart', () => this.hintOnce('events'));
    game.events.on('trainBought', () => { if (game.trains.trains.length === 2) this.hintOnce('second_train'); });
  }

  get active() { return !this.finished && this.game.settings.tutorial !== false; }

  stationsFor(kind, id) {
    return this.game.stations.list.filter((s) => s.links && (kind === 'town' ? s.links.towns.includes(id) : s.links.industries.includes(id)));
  }
  // any forest station connected by rail to any Greenfield station
  linkedPair() {
    const g = this.game, A = this.stationsFor('industry', this.forestId), B = this.stationsFor('town', this.townId);
    return A.some((a) => B.some((b) => a !== b && g.net.connected(a.tile, b.tile)));
  }

  stationFor(kind, id) {
    return this.game.stations.list.find((s) => s.links && (kind === 'town' ? s.links.towns.includes(id) : s.links.industries.includes(id)));
  }

  targetPos(t) {
    const g = this.game;
    if (t === 'forest') { const i = g.industries.byId(this.forestId); return i ? { x: (i.x + 1) * TILE, y: g.industries.baseHeight(i) + 3.2, z: (i.z + 1) * TILE } : null; }
    if (t === 'town') { const w = g.towns.byId(this.townId); return w ? { x: (w.x + 0.5) * TILE, y: g.world.tileH[w.z * N + w.x] + 3.5, z: (w.z + 0.5) * TILE } : null; }
    if (t === 'between') {
      const i = g.industries.byId(this.forestId), w = g.towns.byId(this.townId);
      if (!i || !w) return null;
      return { x: ((i.x + 1) + (w.x + 0.5)) / 2 * TILE, y: 3, z: ((i.z + 1) + (w.z + 0.5)) / 2 * TILE };
    }
    if (t === 'train') { const tr = g.trains.trains[0]; if (tr && tr.visual) { const p = tr.visual.cars[0].mesh.position; return { x: p.x, y: p.y + 2.2, z: p.z }; } }
    return null;
  }

  advance() {
    const g = this.game;
    const s = STEPS[this.step];
    if (s && s.reward) { g.economy.earn(500, 'tutorial', false); g.progression.addXP(60); g.audio.play('coin'); g.particles.burst(g.camera.target.x, 2, g.camera.target.z); }
    this.step++;
    g.audio.play('click');
    if (this.step >= STEPS.length) this.finish();
  }
  finish() { this.finished = true; this.marker.visible = false; this.game.ui.tutorial(null); this.game.save(); }
  skip() { this.finish(); }
  restart() { this.finished = false; this.step = 0; this.entered = -1; this.flags.loaded = false; }

  hintOnce(key) {
    if (this.hints.has(key) || this.active) return;
    if (!hasText('hint_' + key)) return;
    const text = this.game.ui.tr('hint_' + key);
    this.hints.add(key);
    this.game.ui.hint(text);
  }

  // Just-in-time teaching: one tip the first time a mechanic shows up in the
  // player's own network (checked every few seconds, never during the
  // guided steps, off with the tips setting).
  contextTips(dt) {
    const g = this.game;
    this._ctxT = (this._ctxT || 0) - dt;
    if (this._ctxT > 0 || this.active || g.settings.tips === false) return;
    this._ctxT = 4;
    const lines = g.lines.list();
    const S = g.stats.data;
    const checks = [
      ['lines', () => lines.length > 0],
      ['timetable', () => lines.some((l) => l.trains.length >= 2 && l.trains.every((t) => !t.spacing))],
      ['transfers', () => (S.paxTransfers || 0) > 0],
      ['overtaking', () => (S.overtakes || 0) > 0],
      ['station_types', () => g.stations.list.some((s) => ['city', 'central', 'grand', 'hs', 'yard', 'intermodal'].includes(s.kind))],
      ['opportunities', () => g.selection && g.selection.type === 'industry'],
      ['town_growth', () => g.towns.list.some((t) => t.stage >= 2)],
      ['passing_loop', () => g.advisor().some((a) => a.key === 'adv_passing_loop' || a.key === 'adv_single_short')],
      ['saturated', () => g.advisor().some((a) => a.key === 'adv_line_saturated')],
    ];
    // one tip per check round, so they never pile up
    for (const [key, cond] of checks) {
      if (this.hints.has(key)) continue;
      let hit = false;
      try { hit = cond(); } catch (e) { hit = false; }
      if (hit) { this.hintOnce(key); return; }
    }
  }

  update(dt) {
    const g = this.game;
    this.contextTips(dt);
    if (!this.active || !g.running) { this.marker.visible = false; if (this._shown) { g.ui.tutorial(null); this._shown = false; } return; }
    const s = STEPS[this.step];
    if (!s) { this.finish(); return; }
    if (this.entered !== this.step) {
      this.entered = this.step;
      if (s.onEnter) s.onEnter(g, this);
      const p = s.target ? this.targetPos(s.target) : null;
      if (p && s.target !== 'train') g.camera.focus(p.x, p.z);
    }
    if (s.done && s.done(g, this)) { this.advance(); return; }
    g.ui.tutorial({ index: this.step, total: STEPS.length, id: s.id, button: s.button, ui: s.ui });
    this._shown = true;
    const p = s.target ? this.targetPos(s.target) : null;
    if (p) {
      this.marker.visible = true;
      this.marker.position.set(p.x, p.y + Math.sin(g.clock * 4) * 0.3, p.z);
      this.marker.rotation.y += dt * 2;
    } else this.marker.visible = false;
  }

  serialize() { return { step: this.step, finished: this.finished, hints: [...this.hints] }; }
}

export { tileCX, tileCZ };
