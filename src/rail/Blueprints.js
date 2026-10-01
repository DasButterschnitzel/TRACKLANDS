// Blueprints (Phase 11): a piece of railway saved as a pattern (straight
// runs of track relative to an anchor, plus stations, depots and signals)
// and placed again anywhere: rotated in quarter turns, mirrored, adapted to
// the ground by the ordinary track planner (bridges and tunnels where
// needed). Placing makes a planning project (nothing is built until BUILD
// PROJECT). The library lives in the browser (versioned), can be exported
// and imported as plain JSON: numbers and short strings only, nothing that
// runs.
import { N, DX, DZ, tx, tz, idx, inMap, layerOf, onLayer, baseTile, scrubNames } from '../util.js';

export const BP_VERSION = 1;
const KEY = 'tracklands.blueprints';
const MAX_BP = 40, MAX_RUNS = 120, MAX_SPAN = 48;

// the built-in patterns (runs: [x0, z0, x1, z1, layer]; stations: [x0, z0, x1, z1, tracks])
export const DEFAULT_BLUEPRINTS = [
  { id: 'd_loop', name: 'bp_passing_loop', builtin: true, runs: [[0, 0, 14, 0, 0], [2, 0, 4, 2, 0], [4, 2, 10, 2, 0], [10, 2, 12, 0, 0]], stations: [], depots: [], signals: [] },
  { id: 'd_cross', name: 'bp_crossover', builtin: true, runs: [[0, 0, 10, 0, 0], [0, 1, 10, 1, 0], [3, 0, 4, 1, 0], [6, 1, 7, 0, 0]], stations: [], depots: [], signals: [] },
  { id: 'd_siding', name: 'bp_siding', builtin: true, runs: [[0, 0, 12, 0, 0], [3, 0, 4, 1, 0], [4, 1, 9, 1, 0], [9, 1, 10, 0, 0]], stations: [], depots: [], signals: [] },
  { id: 'd_halt', name: 'bp_halt', builtin: true, runs: [[0, 0, 12, 0, 0]], stations: [[4, 0, 7, 0, 1]], depots: [], signals: [] },
  { id: 'd_throat', name: 'bp_terminus', builtin: true, runs: [[0, 1, 12, 1, 0], [2, 1, 3, 0, 0], [3, 0, 12, 0, 0], [5, 1, 6, 2, 0], [6, 2, 12, 2, 0]], stations: [], depots: [], signals: [] },
  { id: 'd_four', name: 'bp_four_track', builtin: true, runs: [[0, 0, 16, 0, 0], [0, 1, 16, 1, 0], [2, 0, 3, 1, 0], [13, 1, 14, 0, 0]], stations: [], depots: [], signals: [] },
];

const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);
// only well-formed numbers survive; anything else rejects the blueprint
export function cleanBlueprint(b) {
  if (!b || typeof b !== 'object') return null;
  scrubNames(b);
  const span = (a, n) => Array.isArray(a) && a.length === n && a.every((v, k) => (k === 4 ? int(v, 0, 3) : int(v, -MAX_SPAN, MAX_SPAN)) != null);
  const runs = Array.isArray(b.runs) ? b.runs.filter((r) => span(r, 5) && (r[0] !== r[2] || r[1] !== r[3])).slice(0, MAX_RUNS) : [];
  if (!runs.length) return null;
  const stations = (Array.isArray(b.stations) ? b.stations : []).filter((s) => Array.isArray(s) && s.length === 5 && s.slice(0, 4).every((v) => int(v, -MAX_SPAN, MAX_SPAN) != null) && int(s[4], 1, 8) != null).slice(0, 12);
  const depots = (Array.isArray(b.depots) ? b.depots : []).filter((d) => Array.isArray(d) && d.length === 2 && d.every((v) => int(v, -MAX_SPAN, MAX_SPAN) != null)).slice(0, 8);
  const signals = (Array.isArray(b.signals) ? b.signals : []).filter((s) => Array.isArray(s) && s.length === 4 && int(s[0], -MAX_SPAN, MAX_SPAN) != null && int(s[1], -MAX_SPAN, MAX_SPAN) != null && int(s[2], 0, 7) != null && (s[3] === 'block' || s[3] === 'path')).slice(0, 60);
  return { id: String(b.id || '').replace(/[^\w-]/g, '').slice(0, 24) || 'bp' + Math.random().toString(36).slice(2, 8), name: String(b.name || 'Blueprint').replace(/[<>]/g, '').slice(0, 40), builtin: !!b.builtin, runs, stations, depots, signals };
}

// quarter turns (clockwise on the map) and a mirror across the x axis
export function transformPoint(x, z, rot, mirror) {
  if (mirror) x = -x;
  for (let k = 0; k < (rot & 3); k++) [x, z] = [-z, x];
  return [x, z];
}
export function transformDir(d, rot, mirror) { if (mirror) d = (4 - d) & 7; return (d + 2 * (rot & 3)) & 7; }

export class Blueprints {
  constructor(game) {
    this.game = game;
    this.list = this.load();
  }
  all() { return DEFAULT_BLUEPRINTS.map(cleanBlueprint).concat(this.list); }
  byId(id) { return this.all().find((b) => b.id === id) || null; }
  load() {
    try {
      const raw = globalThis.localStorage && localStorage.getItem(KEY);
      if (!raw) return [];
      const d = JSON.parse(raw);
      if (!d || d.v !== BP_VERSION || !Array.isArray(d.list)) return [];
      return d.list.map(cleanBlueprint).filter(Boolean).filter((b) => !b.builtin).slice(0, MAX_BP);
    } catch { return []; }
  }
  store() { try { if (globalThis.localStorage) localStorage.setItem(KEY, JSON.stringify({ v: BP_VERSION, list: this.list })); } catch { /* storage full or blocked: the library stays in memory */ } }

  // ---------- capture: the player's track in a rectangle ----------
  capture(a, b, name) {
    const g = this.game, net = g.net, S = g.stations;
    const x0 = Math.min(tx(a), tx(b)), x1 = Math.max(tx(a), tx(b)), z0 = Math.min(tz(a), tz(b)), z1 = Math.max(tz(a), tz(b));
    if (x1 - x0 > MAX_SPAN || z1 - z0 > MAX_SPAN) return { error: 'err_bp_too_big' };
    const inside = (x, z) => x >= x0 && x <= x1 && z >= z0 && z <= z1;
    const runs = [];
    for (let L = 0; L < 4; L++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const i = onLayer(idx(x, z), L);
      if (!net.conn[i] || net.own[i]) continue;
      // each straight run once: from its first tile, in the four "forward" directions
      for (let d = 0; d < 4; d++) {
        if (!net.hasDir(i, d)) continue;
        const px = x - DX[d], pz = z - DZ[d];
        if (inside(px, pz) && inMap(px, pz) && net.hasDir(onLayer(idx(px, pz), L), d)) continue;
        let cx = x, cz = z;
        while (inside(cx + DX[d], cz + DZ[d]) && net.hasDir(onLayer(idx(cx, cz), L), d)) { cx += DX[d]; cz += DZ[d]; }
        if (cx !== x || cz !== z) runs.push([x - x0, z - z0, cx - x0, cz - z0, L]);
      }
    }
    if (!runs.length) return { error: 'err_bp_empty' };
    const stations = [], depots = [], signals = [];
    for (const s of S.mine()) {
      const ts = S.allTiles(s).filter((t) => inside(tx(t), tz(t)));
      if (!ts.length || ts.length !== S.allTiles(s).length) continue;
      const tk = s.tracks[0].tiles;
      stations.push([tx(tk[0]) - x0, tz(tk[0]) - z0, tx(tk[tk.length - 1]) - x0, tz(tk[tk.length - 1]) - z0, s.tracks.length]);
    }
    for (const d of S.myDepots()) if (inside(tx(d.tile), tz(d.tile))) depots.push([tx(d.tile) - x0, tz(d.tile) - z0]);
    for (const [k, sg] of net.signals) { const i = k >> 3; if (!layerOf(i) && inside(tx(i), tz(i))) signals.push([tx(i) - x0, tz(i) - z0, k & 7, sg.type === 'path' ? 'path' : 'block']); }
    const bp = cleanBlueprint({ id: 'u' + Date.now().toString(36), name: name || this.game.ui.tr('bp_new'), runs, stations, depots, signals });
    if (!bp) return { error: 'err_bp_empty' };
    this.list.push(bp);
    if (this.list.length > MAX_BP) this.list.shift();
    this.store();
    this.game.events.emit('blueprints');
    return { ok: true, bp };
  }
  remove(bp) { this.list = this.list.filter((b) => b !== bp && b.id !== bp.id); this.store(); this.game.events.emit('blueprints'); }
  rename(bp, name) { const b = this.list.find((x) => x.id === bp.id); if (b) { b.name = String(name).replace(/[<>]/g, '').slice(0, 40); this.store(); } }

  // ---------- placing: the steps of a planning project ----------
  steps(bp, anchor, rot = 0, mirror = false, tier = this.game.construction.tier) {
    const ax = tx(anchor), az = tz(anchor);
    const at = (x, z, L = 0) => { const [u, v] = transformPoint(x, z, rot, mirror); const X = ax + u, Z = az + v; return inMap(X, Z) ? onLayer(idx(X, Z), L) : -1; };
    const out = [];
    for (const r of bp.runs) { const a = at(r[0], r[1], r[4]), b = at(r[2], r[3], r[4]); if (a < 0 || b < 0) return { error: 'err_out_of_map' }; out.push({ op: 'track', a, b, tier, mode: 'double', L: r[4], straight: 1 }); }
    for (const s of bp.stations) { const a = at(s[0], s[1]), b = at(s[2], s[3]); if (a < 0 || b < 0) return { error: 'err_out_of_map' }; out.push({ op: 'station', a, b, tracks: s[4] }); }
    for (const d of bp.depots) { const t = at(d[0], d[1]); if (t < 0) return { error: 'err_out_of_map' }; out.push({ op: 'depot', tile: t }); }
    for (const s of bp.signals) { const t = at(s[0], s[1]); if (t < 0) return { error: 'err_out_of_map' }; out.push({ op: 'signal', key: t * 8 + transformDir(s[2], rot, mirror), type: s[3] }); }
    return { steps: out };
  }
  // a blueprint placed: a new planning project (shown as ghosts)
  place(bp, anchor, rot = 0, mirror = false) {
    const P = this.game.plans, r = this.steps(bp, baseTile(anchor), rot, mirror);
    if (r.error) return r;
    const p = P.create(`${this.game.ui.tr(bp.name.startsWith('bp_') ? bp.name : 'bp_placed')}${bp.name.startsWith('bp_') ? '' : ': ' + bp.name}`);
    if (!p) return { error: 'err_plan_full' };
    for (const s of r.steps) P.addStep(s, p);
    return { ok: true, project: p };
  }

  // ---------- import / export ----------
  exportJSON(bp) { return JSON.stringify({ tracklandsBlueprint: BP_VERSION, blueprint: { name: bp.name, runs: bp.runs, stations: bp.stations, depots: bp.depots, signals: bp.signals } }); }
  importJSON(text) {
    let d;
    try { if (typeof text !== 'string' || text.length > 200000) throw new Error('size'); d = JSON.parse(text); } catch { return { error: 'err_bp_import' }; }
    if (!d || d.tracklandsBlueprint !== BP_VERSION) return { error: 'err_bp_version' };
    const bp = cleanBlueprint({ ...d.blueprint, id: 'i' + Date.now().toString(36), builtin: false });
    if (!bp) return { error: 'err_bp_import' };
    this.list.push(bp);
    if (this.list.length > MAX_BP) this.list.shift();
    this.store();
    this.game.events.emit('blueprints');
    return { ok: true, bp };
  }
}
void N;
