// Persistent storage (IndexedDB with localStorage fallback), save versioning
// and migration, backups, export and import with validation.
import { SAVE_VERSION, STATION, TOWN_STAGES, MAX_LEVEL } from '../config.js';

const DB = 'tracklands', STORE = 'saves', LS_KEY = 'tracklands.save', LS_BACKUP = 'tracklands.backup';

function idbOpen() {
  return new Promise((res, rej) => {
    if (!('indexedDB' in window)) { rej(new Error('no idb')); return; }
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export class SaveStore {
  constructor() { this.db = null; this.useLS = false; }
  async init() {
    try { this.db = await idbOpen(); } catch (e) { this.useLS = true; }
  }
  async put(key, value) {
    const str = JSON.stringify(value);
    if (!this.useLS && this.db) {
      try {
        await new Promise((res, rej) => {
          const tx = this.db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put(str, key);
          tx.oncomplete = res; tx.onerror = () => rej(tx.error);
        });
        return true;
      } catch (e) { this.useLS = true; }
    }
    try { localStorage.setItem(key === 'main' ? LS_KEY : key === 'backup' ? LS_BACKUP : 'tracklands.' + key, str); return true; } catch (e) { return false; }
  }
  async get(key) {
    let str = null;
    if (!this.useLS && this.db) {
      try {
        str = await new Promise((res, rej) => {
          const tx = this.db.transaction(STORE, 'readonly');
          const rq = tx.objectStore(STORE).get(key);
          rq.onsuccess = () => res(rq.result ?? null); rq.onerror = () => rej(rq.error);
        });
      } catch (e) { str = null; }
    }
    if (str == null) { try { str = localStorage.getItem(key === 'main' ? LS_KEY : key === 'backup' ? LS_BACKUP : 'tracklands.' + key); } catch (e) { str = null; } }
    if (str == null) return null;
    try { return JSON.parse(str); } catch (e) { return { corrupt: true }; }
  }
  async remove(key) {
    if (this.db) { try { await new Promise((res) => { const tx = this.db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).delete(key); tx.oncomplete = res; tx.onerror = res; }); } catch (e) { /* ignore */ } }
    try { localStorage.removeItem(key === 'main' ? LS_KEY : key === 'backup' ? LS_BACKUP : 'tracklands.' + key); } catch (e) { /* ignore */ }
  }
}

// Upgrade older save structures step by step. Never discards data silently.
export function migrate(d) {
  if (!d || typeof d !== 'object') return null;
  let v = d.saveVersion | 0;
  if (v < 1) return null;
  if (v === 1) {
    // v1 had no decorations, cleared trees or legacy data
    d.decor = d.decor || [];
    d.cleared = d.cleared || [];
    if (d.progression && !d.progression.legacy) d.progression.legacy = { count: 0 };
    v = 2;
  }
  if (v === 2) {
    migrateV2toV3(d);
    v = 3;
  }
  d.saveVersion = v;
  if (v >= SAVE_VERSION) sanitize(d);
  return v === SAVE_VERSION ? d : v > SAVE_VERSION ? d : null;
}

// Repair damaged values (hand-edited or corrupted saves) so one bad entry never
// breaks the whole world: drop broken list entries, coerce numbers and names.
// Valid saves pass through unchanged, and running it twice changes nothing.
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const num = (v, def = 0, lo = -Infinity, hi = Infinity) => (fin(v) ? Math.min(hi, Math.max(lo, v)) : def);
const numMap = (o) => {
  if (!isObj(o)) return {};
  for (const k of Object.keys(o)) if (!fin(o[k])) delete o[k];
  return o;
};
const withId = (arr) => (Array.isArray(arr) ? arr.filter((e) => isObj(e) && fin(e.id)) : []);
export function sanitize(d) {
  if (!isObj(d)) return d;
  const S = d.stations;
  if (isObj(S)) {
    S.stations = withId(S.stations).filter((s) => fin(s.tile));
    for (const s of S.stations) {
      s.stock = numMap(s.stock);
      if (s.claimed !== undefined) s.claimed = numMap(s.claimed);
      s.level = Math.round(num(s.level, 0, 0, STATION.maxLevel));
      s.delivered = num(s.delivered, 0, 0); s.picked = num(s.picked, 0, 0);
      if (typeof s.name !== 'string') s.name = 'Station ' + s.id;
      if (s.tracks !== undefined && !Array.isArray(s.tracks)) delete s.tracks;
      if (Array.isArray(s.tracks)) s.tracks = s.tracks.filter((tr) => isObj(tr) && Array.isArray(tr.tiles) && tr.tiles.length && tr.tiles.every(fin));
      if (Array.isArray(s.tracks) && !s.tracks.length) s.tracks = [{ tiles: [s.tile], role: 'any', dir: 'both' }];
    }
    S.depots = withId(S.depots).filter((dp) => fin(dp.tile));
  }
  d.industries = withId(d.industries);
  for (const ind of d.industries) {
    ind.inp = numMap(ind.inp); ind.out = numMap(ind.out);
    ind.level = Math.round(num(ind.level, 0, 0, 4));
    ind.transported = num(ind.transported, 0, 0); ind.produced = num(ind.produced, 0, 0);
  }
  d.towns = withId(d.towns);
  for (const tw of d.towns) {
    tw.stage = Math.round(num(tw.stage, 0, 0, TOWN_STAGES.length - 1));
    tw.pop = num(tw.pop, 0, 0); tw.delivered = num(tw.delivered, 0, 0);
    tw.progress = numMap(tw.progress); tw.received = numMap(tw.received);
  }
  d.trains = withId(d.trains);
  for (const t of d.trains) {
    if (typeof t.name !== 'string' || !t.name) t.name = 'Train ' + t.id;
    t.earned = num(t.earned, 0); t.trips = Math.round(num(t.trips, 0, 0));
    t.cargo = Array.isArray(t.cargo) ? t.cargo.filter((l) => isObj(l) && typeof l.c === 'string' && fin(l.n) && l.n > 0) : [];
    if (t.route !== undefined && !Array.isArray(t.route)) t.route = [];
    t.routeIdx = Math.round(num(t.routeIdx, 0, 0));
    if (!isObj(t.upg)) t.upg = {};
    if (t.head !== undefined && !isObj(t.head)) t.head = null;
  }
  const E = d.economy;
  if (isObj(E)) {
    E.coins = num(E.coins, 0, 0);
    // a contract or daily task with broken numbers is dropped (new ones are generated)
    const okNums = (o, keys) => isObj(o) && keys.every((k) => o[k] === undefined || fin(o[k]));
    if (E.contracts !== undefined) E.contracts = Array.isArray(E.contracts) ? E.contracts.filter((c) => okNums(c, ['id', 'progress', 'amount', 'coins', 'xp', 'rp'])) : [];
    if (isObj(E.daily) && E.daily.list !== undefined) E.daily.list = Array.isArray(E.daily.list) ? E.daily.list.filter((c) => okNums(c, ['target', 'coins', 'xp', 'rp'])) : [];
    if (E.incomeLog !== undefined) E.incomeLog = Array.isArray(E.incomeLog) ? E.incomeLog.filter((l) => isObj(l) && fin(l.income)) : [];
  }
  const P = d.progression;
  if (isObj(P)) {
    P.level = Math.round(num(P.level, 1, 1, MAX_LEVEL)); P.xp = num(P.xp, 0, 0); P.rp = num(P.rp, 0, 0);
    for (const k of ['research', 'regions', 'objectives', 'developed', 'achievements', 'owned', 'seenUnlocks']) if (P[k] !== undefined && !Array.isArray(P[k])) P[k] = [];
  }
  if (isObj(d.stats)) for (const k of Object.keys(d.stats)) { if (k === 'cargo') d.stats.cargo = numMap(d.stats.cargo); else if (!fin(d.stats[k])) d.stats[k] = 0; }
  if (!fin(d.time)) d.time = 0;
  return d;
}

// v2 -> v3: consists, platforms, signals and schedules. Idempotent: every field
// is only filled when missing, so running it twice changes nothing.
export function migrateV2toV3(d) {
  if (d.stations && Array.isArray(d.stations.stations)) {
    for (const s of d.stations.stations) {
      if (!s || typeof s.tile !== 'number') continue;
      // legacy single-tile station = one track with one (double-faced) platform
      if (!Array.isArray(s.tracks) || !s.tracks.length) s.tracks = [{ tiles: [s.tile], role: 'any', dir: 'both' }];
      if (!Array.isArray(s.facilities)) s.facilities = [];
      if (typeof s.level !== 'number') s.level = 0;
    }
  }
  if (Array.isArray(d.trains)) {
    for (const t of d.trains) {
      if (!t) continue;
      // consist is inferred with world context on load (TrainSystem.deserialize)
      if (!Array.isArray(t.consist)) t.legacyConsist = true;
      if (Array.isArray(t.route)) t.route = t.route.filter((r) => r && typeof r.st === 'number').map((r) => Object.assign({ act: 'auto', dwell: 0, full: false, skip: false, plat: null, cargo: null }, r));
      if (!t.priority) t.priority = null;
    }
  }
  if (d.net && typeof d.net === 'object') {
    if (!Array.isArray(d.net.signals)) d.net.signals = [];
    if (!Array.isArray(d.net.waypoints)) d.net.waypoints = [];
    if (typeof d.net.single !== 'string') d.net.single = '';
  }
  return d;
}

export function validate(d) {
  if (!d || typeof d !== 'object') return 'err_save_invalid';
  if (typeof d.seed !== 'number' || !isFinite(d.seed)) return 'err_save_invalid';
  if (!d.net || typeof d.net.conn !== 'string') return 'err_save_invalid';
  if (!d.economy || !d.progression) return 'err_save_invalid';
  if ((d.saveVersion | 0) < 1) return 'err_save_version';
  return null;
}

export function exportText(d) {
  const json = JSON.stringify(d);
  return 'TRKL1:' + btoa(unescape(encodeURIComponent(json)));
}
export function importText(text) {
  text = String(text || '').trim();
  try {
    if (text.startsWith('TRKL1:')) return JSON.parse(decodeURIComponent(escape(atob(text.slice(6)))));
    return JSON.parse(text);
  } catch (e) { return null; }
}
export function downloadJSON(d, name) {
  const blob = new Blob([JSON.stringify(d, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
