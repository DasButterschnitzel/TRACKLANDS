// Planning mode (Phase 11): projects drawn as ghosts before anything is
// built. A project is an ordered list of build steps (track drags, second
// pairs, stations, depots, signals, the same calls the build tools make);
// planning never spends money and reserves no land. Every step is checked
// against the world as it is now (dry runs of the real build calls), so a
// project that a growing town or a rival has built across turns invalid and
// says why. BUILD PROJECT builds all of it or nothing (partial build: the
// steps that are still valid, in order, the rest stay planned). Projects
// are saved with the game, can be duplicated, compared and removed.
import { N, LAYERS, tileCX, tileCZ } from '../util.js';

export const PLAN_STEP_OPS = ['track', 'pair', 'station', 'depot', 'signal'];
const MAX_PROJECTS = 24, MAX_STEPS = 200;
const TRACK_MODES = ['double', 'single', 'pair'];
const okTile = (t) => Number.isInteger(t) && t >= 0 && t < N * N * LAYERS;

// a step as it may be saved (anything else is dropped)
export function cleanStep(s) {
  if (!s || typeof s !== 'object' || !PLAN_STEP_OPS.includes(s.op)) return null;
  const tier = Math.max(0, Math.min(3, s.tier | 0));
  if (s.op === 'track' || s.op === 'pair') {
    if (!okTile(s.a) || !okTile(s.b) || s.a === s.b) return null;
    const out = { op: s.op, a: s.a, b: s.b, tier, L: Math.max(0, Math.min(3, s.L | 0)) };
    if (s.op === 'track') out.mode = TRACK_MODES.includes(s.mode) && s.mode !== 'pair' ? s.mode : 'double';
    else { out.side = s.side < 0 ? -1 : 1; out.roles = ['none', 'express', 'freight'].includes(s.roles) ? s.roles : 'none'; }
    return out;
  }
  if (s.op === 'station') return okTile(s.a) && okTile(s.b) ? { op: 'station', a: s.a, b: s.b, tracks: Math.max(1, Math.min(8, s.tracks | 0)) } : null;
  if (s.op === 'depot') return okTile(s.tile) ? { op: 'depot', tile: s.tile } : null;
  if (s.op === 'signal') return Number.isInteger(s.key) && s.key >= 0 && s.key < N * N * LAYERS * 8 ? { op: 'signal', key: s.key, type: s.type === 'path' ? 'path' : 'block' } : null;
  return null;
}

export class Plans {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.nextId = 1;
    this.active = null;       // the project the tools add to while planning
    this.on = false;          // planning mode: build tools add steps instead of building
    this.version = 0;
    this._dirty = true;
    // a new track, station, town building or rival line can make a plan invalid
    const E = game.events;
    for (const ev of ['trackBuilt', 'pairBuilt', 'undo', 'townGrew', 'rivalProject', 'stationBuilt']) E.on(ev, () => { this._dirty = true; });
  }
  byId(id) { return this.list.find((p) => p.id === id) || null; }
  setOn(v) {
    this.on = !!v;
    if (this.on && !this.byId(this.active)) this.active = (this.list[this.list.length - 1] || this.create()).id;
    this.game.events.emit('plans');
  }
  create(name) {
    if (this.list.length >= MAX_PROJECTS) return null;
    const p = { id: this.nextId++, name: String(name || `${this.game.ui ? this.game.ui.tr('plan_project') : 'Project'} ${this.nextId - 1}`).slice(0, 40), steps: [], made: this.game.ledger ? this.game.ledger.monthIndex() : 0 };
    this.list.push(p);
    this.active = p.id;
    this._dirty = true;
    this.game.events.emit('plans');
    return p;
  }
  remove(p) { this.list = this.list.filter((x) => x !== p); if (this.active === p.id) this.active = this.list.length ? this.list[this.list.length - 1].id : null; this._dirty = true; this.game.events.emit('plans'); }
  duplicate(p) {
    if (this.list.length >= MAX_PROJECTS) return null;
    const q = { id: this.nextId++, name: `${p.name} (2)`.slice(0, 40), steps: p.steps.map((s) => ({ ...s })), made: p.made };
    this.list.push(q);
    this._dirty = true;
    this.game.events.emit('plans');
    return q;
  }
  rename(p, name) { p.name = String(name || p.name).slice(0, 40); this.game.events.emit('plans'); }
  // add a build step to the active project (the tools call this while planning)
  addStep(step, p = this.byId(this.active)) {
    const s = cleanStep(step);
    if (!s) return { error: 'err_plan_step' };
    if (!p) p = this.create();
    if (!p) return { error: 'err_plan_full' };
    if (p.steps.length >= MAX_STEPS) return { error: 'err_plan_full' };
    p.steps.push(s);
    this._dirty = true;
    this.game.events.emit('plans');
    return { ok: true, project: p, step: s };
  }
  removeStep(p, k) { p.steps.splice(k, 1); this._dirty = true; this.game.events.emit('plans'); }

  // ---------- checking a step against the world now ----------
  dry(s) {
    const g = this.game, C = g.construction, S = g.stations, net = g.net;
    const save = { side: C.pairSide, roles: C.pairRoles };
    try {
      if (s.op === 'track') {
        const r = C.trackOp(s.a, s.b, s.tier, s.mode, true, s.L);
        return { error: r.error === 'err_train_on_track' ? null : r.error, wait: r.error === 'err_train_on_track', cost: r.cost || 0, tiles: r.tiles || [], kind: s.L ? 'structure' : 'track', bridges: 0 };
      }
      if (s.op === 'pair') {
        C.pairSide = s.side; C.pairRoles = s.roles;
        const r = C.trackOp(s.a, s.b, s.tier, 'pair', true);
        return { error: r.error === 'err_train_on_track' ? null : r.error, wait: r.error === 'err_train_on_track', cost: r.cost || 0, tiles: r.tiles || [], kind: 'track' };
      }
      if (s.op === 'station') {
        const r = C.stationOp(s.a, s.b, s.tracks, true);
        return { error: r.error === 'err_no_money' ? null : r.error, cost: r.cost || 0, tiles: r.tiles || [], kind: 'station' };
      }
      if (s.op === 'depot') {
        const e = S.placeError(s.tile, 'depot');
        return { error: e === 'err_no_money' ? null : e, cost: g.economy.costs.depot(), tiles: [s.tile], kind: 'station' };
      }
      if (s.op === 'signal') {
        const i = s.key >> 3, d = s.key & 7;
        const e = !net.conn[i] ? 'err_plan_signal_track' : !net.hasDir(i, d) ? 'err_plan_signal_track' : null;
        return { error: e, cost: g.economy.costs.signal(), tiles: [i], kind: 'signal', later: e === 'err_plan_signal_track' };
      }
    } finally { C.pairSide = save.side; C.pairRoles = save.roles; }
    return { error: 'err_plan_step', cost: 0, tiles: [] };
  }
  // every step checked, the costs broken down, the state of the project
  validate(p) {
    const g = this.game;
    const steps = p.steps.map((s) => {
      const r = this.dry(s);
      // a signal on track the same project lays first is fine
      if (r.later && p.steps.some((o) => (o.op === 'track' || o.op === 'pair') && this.dry(o).tiles.includes(s.key >> 3))) r.error = null;
      return r;
    });
    const cost = { track: 0, structure: 0, station: 0, signal: 0, total: 0 };
    for (const r of steps) { cost[r.kind] = (cost[r.kind] || 0) + r.cost; cost.total += r.cost; }
    const bad = steps.map((r, k) => (r.error ? k : -1)).filter((k) => k >= 0);
    const state = !p.steps.length ? 'empty' : bad.length ? 'blocked' : !g.economy.canAfford(cost.total) ? 'money' : steps.some((r) => r.wait) ? 'wait' : 'ok';
    const tiles = new Set(); for (const r of steps) for (const t of r.tiles) tiles.add(t);
    return { steps, cost, bad, state, tiles: [...tiles], validAt: g.time };
  }
  // cached per project until something changes
  check(p) {
    if (this._dirty) { this._cache = new Map(); this._dirty = false; this.version++; }
    if (!this._cache.has(p.id)) this._cache.set(p.id, this.validate(p));
    return this._cache.get(p.id);
  }
  invalidate() { this._dirty = true; }

  // ---------- building ----------
  // all or nothing: every step valid and paid for, then built in order; a
  // step that still fails takes back the steps before it (via undo)
  build(p, partial = false) {
    const g = this.game, C = g.construction;
    this._dirty = true;
    const v = this.check(p);
    if (!p.steps.length) return { error: 'err_plan_empty' };
    if (!partial && v.bad.length) return { error: 'err_plan_blocked', step: v.bad[0], reason: v.steps[v.bad[0]].error };
    const todo = partial ? p.steps.filter((s, k) => !v.steps[k].error) : p.steps.slice();
    if (!todo.length) return { error: 'err_plan_blocked' };
    const cost = todo.reduce((a, s) => a + this.dry(s).cost, 0);
    if (!g.economy.canAfford(cost)) return { error: 'err_no_money', cost };
    const coins0 = g.economy.coins;
    C._collect = [];
    let fail = null, built = 0;
    try {
      for (const s of todo) {
        const r = this.apply(s);
        if (r && r.error) { fail = { step: p.steps.indexOf(s), reason: r.error }; break; }
        built++;
      }
    } finally {
      const es = C._collect; C._collect = null;
      if (fail && !partial) {
        // take back what was built (newest first)
        for (let k = es.length - 1; k >= 0; k--) { C.undoStack.push(es[k]); C.undo(); }
      } else if (es.length) {
        const prev = [];
        for (let k = es.length - 1; k >= 0; k--) if (es[k].prev) prev.push(...es[k].prev);
        for (const e of es) if (e.type !== 'track') C.pushUndo(e);
        if (prev.length) C.pushUndo({ type: 'track', prev, cost: es.filter((e) => e.type === 'track').reduce((a, e) => a + e.cost, 0), newTiles: es.reduce((a, e) => a + (e.newTiles || 0), 0) });
      }
    }
    this._dirty = true;
    if (fail && !partial) { this.game.events.emit('plans'); return { error: 'err_plan_blocked', ...fail }; }
    // built: the project is done (a partial build keeps what is left)
    const spent = Math.round(coins0 - g.economy.coins);
    if (partial) p.steps = p.steps.filter((s) => !todo.includes(s) || (fail && todo.indexOf(s) >= built));
    else p.steps = [];
    if (!p.steps.length) this.remove(p);
    this.game.events.emit('plans');
    this.game.events.emit('planBuilt', p, spent);
    return { ok: true, built, spent, left: p.steps.length };
  }
  apply(s) {
    const g = this.game, C = g.construction, S = g.stations, net = g.net;
    if (s.op === 'track') return C.trackOp(s.a, s.b, s.tier, s.mode, false, s.L);
    if (s.op === 'pair') { const sv = [C.pairSide, C.pairRoles]; C.pairSide = s.side; C.pairRoles = s.roles; try { return C.trackOp(s.a, s.b, s.tier, 'pair'); } finally { [C.pairSide, C.pairRoles] = sv; } }
    if (s.op === 'station') return C.stationOp(s.a, s.b, s.tracks, false, true);
    if (s.op === 'depot') { const r = S.buildDepot(s.tile); return r.error ? r : { ok: true }; }
    if (s.op === 'signal') {
      const i = s.key >> 3, d = s.key & 7;
      if (!net.conn[i] || !net.hasDir(i, d)) return { error: 'err_plan_signal_track' };
      if (net.signals.has(s.key)) return { ok: true };
      const cost = g.economy.costs.signal();
      if (!g.economy.canAfford(cost)) return { error: 'err_no_money' };
      g.economy.spend(cost, 'construction', null, 'signals');
      net.signals.set(s.key, { type: s.type, oneway: false, y: g.ledger ? g.ledger.year() : undefined });
      net.bumpVersion(); g.trains.onNetworkChanged(false);
      C.pushUndo({ type: 'signals', keys: [s.key], cost });
      return { ok: true };
    }
    return { error: 'err_plan_step' };
  }
  // two projects side by side: cost by kind, tiles, state
  compare(a, b) {
    const va = this.check(a), vb = this.check(b);
    return { a: { name: a.name, cost: va.cost, tiles: va.tiles.length, state: va.state }, b: { name: b.name, cost: vb.cost, tiles: vb.tiles.length, state: vb.state } };
  }
  // the centre of a project (for the camera)
  centre(p) {
    const v = this.check(p);
    if (!v.tiles.length) return null;
    let x = 0, z = 0; for (const t of v.tiles) { x += tileCX(t); z += tileCZ(t); }
    return { x: x / v.tiles.length, z: z / v.tiles.length };
  }

  serialize() {
    if (!this.list.length) return undefined;
    return { next: this.nextId, active: this.active, list: this.list.map((p) => ({ id: p.id, name: p.name, made: p.made, steps: p.steps })) };
  }
  deserialize(d) {
    this.list = []; this.active = null; this.on = false;
    if (!d || typeof d !== 'object' || !Array.isArray(d.list)) return;
    const ids = new Set();
    for (const p of d.list.slice(0, MAX_PROJECTS)) {
      if (!p || typeof p !== 'object' || !Number.isInteger(p.id) || p.id <= 0 || ids.has(p.id)) continue;
      ids.add(p.id);
      this.list.push({ id: p.id, name: String(p.name || 'Project').slice(0, 40), made: Number.isFinite(+p.made) ? +p.made : 0, steps: (Array.isArray(p.steps) ? p.steps : []).slice(0, MAX_STEPS).map(cleanStep).filter(Boolean) });
    }
    this.nextId = Math.max(Number.isInteger(d.next) ? d.next : 1, ...this.list.map((p) => p.id + 1), 1);
    this.active = this.byId(d.active) ? d.active : null;
    this._dirty = true;
  }
}
