// Save safety (Phase 8): rolling backups, a health check of the running game
// and of save data, and a crash snapshot.
//   Backups  – up to MAX_BACKUPS snapshots in the save store (bk0 … bkN),
//              oldest overwritten first, listed with date, game date and a
//              short summary; taken every few minutes of play, when leaving
//              to the title screen and before an import replaces the game.
//   health   – finds what should never be: money or positions that are not
//              numbers, vehicles and lines calling at stops that are gone,
//              broken track graph, trains that overlap. Read only.
//   crash    – after an uncaught error in a running game one snapshot is
//              kept under 'crash' and the next start says so.
// All of it stays on the device.
import { validate, migrate } from './Save.js';

export const MAX_BACKUPS = 8;
export const BACKUP_CHOICES = [0, 3, 5, 8];
export const AUTOSAVE_CHOICES = [15, 30, 60, 120];

export class Backups {
  constructor(store) { this.store = store; }
  async index() {
    const d = await this.store.get('bkIndex');
    return d && Array.isArray(d.list) ? d.list.filter((e) => e && typeof e.key === 'string' && /^bk\d$/.test(e.key)) : [];
  }
  summary(data) {
    const L = data.ledger || {}, m = L.cur && Number.isFinite(L.cur.m) ? L.cur.m : 0;
    return {
      savedAt: data.savedAt || Date.now(), year: (L.startYear || 1950) + Math.floor(m / 12), month: m % 12,
      coins: data.economy ? Math.round(data.economy.coins || 0) : 0,
      trains: data.trains && Array.isArray(data.trains.trains) ? data.trains.trains.length : 0,
      level: data.progression ? data.progression.level | 0 : 0, version: data.gameVersion || '',
    };
  }
  // keep a snapshot; keep at most `keep` of them (0: none)
  async snapshot(data, reason = 'auto', keep = 5) {
    keep = Math.max(0, Math.min(MAX_BACKUPS, keep | 0));
    if (!keep || !data) return null;
    let list = await this.index();
    // the next key: a free slot, else the oldest
    const used = new Set(list.map((e) => e.key));
    let key = null;
    for (let i = 0; i < keep; i++) if (!used.has('bk' + i)) { key = 'bk' + i; break; }
    if (!key) { list.sort((a, b) => a.savedAt - b.savedAt); key = list[0].key; list = list.slice(1); }
    const ok = await this.store.put(key, data);
    if (!ok) return null;
    const e = { key, reason, ...this.summary(data), savedAt: Date.now() };
    list.push(e);
    // fewer allowed now than before: drop the oldest
    list.sort((a, b) => b.savedAt - a.savedAt);
    for (const old of list.slice(keep)) await this.store.remove(old.key);
    list = list.slice(0, keep);
    await this.store.put('bkIndex', { list });
    return e;
  }
  async load(key) {
    const d = await this.store.get(key);
    if (!d || d.corrupt) return null;
    const m = migrate(d);
    return m && !validate(m) ? m : null;
  }
  async remove(key) {
    const list = (await this.index()).filter((e) => e.key !== key);
    await this.store.remove(key);
    await this.store.put('bkIndex', { list });
  }
}

// ---------- health ----------
// issues: [{ sev: 'bad' | 'warn', key, n }] (keys are i18n: health_<key>)
export function healthOfGame(g) {
  const out = [];
  const add = (sev, key, n) => { if (n > 0) out.push({ sev, key, n }); };
  const bad = (x) => typeof x !== 'number' || !Number.isFinite(x);
  add('bad', 'money', bad(g.economy.coins) ? 1 : 0);
  add('bad', 'time', bad(g.time) ? 1 : 0);
  const S = g.stations, R = g.roads;
  let routes = 0;
  for (const t of g.trains.trains) for (const r of t.route || []) if (r.st != null && !S.byId(r.st)) routes++;
  add('warn', 'train_routes', routes);
  let pos = 0;
  for (const t of g.trains.trains) if (bad(t.s) || bad(t.v)) pos++;
  if (R) for (const v of R.vehicles) if (bad(v.f) || (v.v != null && bad(v.v))) pos++;
  add('bad', 'positions', pos);
  let stops = 0;
  if (R) for (const v of R.vehicles) for (const id of v.stops) if (!R.stopById(id)) stops++;
  add('warn', 'vehicle_stops', stops);
  let lines = 0;
  if (R) for (const l of R.lines.list) for (const id of l.stops) if (!R.stopById(id)) lines++;
  add('warn', 'line_stops', lines);
  let pk = 0;
  const cnt = (node) => { if (!node || !node.pk) return; for (const p of node.pk) if (!(p.n > 0) || bad(p.n)) pk++; };
  for (const s of S.list) cnt(s);
  if (R) for (const s of R.stops) cnt(s);
  add('warn', 'packets', pk);
  try { add('bad', 'graph', g.net.validateGraph(20).length); } catch (e) { add('bad', 'graph', 1); }
  add('bad', 'collisions', g.trains.collisions | 0);
  const errs = (g.trains.errors | 0);
  add('warn', 'sim_errors', errs);
  return { ok: !out.some((i) => i.sev === 'bad'), issues: out };
}

// save data before it is loaded: the validator and a few cheap checks
export function healthOfData(d) {
  if (!d || typeof d !== 'object' || d.corrupt) return { ok: false, issues: [{ sev: 'bad', key: 'unreadable', n: 1 }] };
  const m = migrate(JSON.parse(JSON.stringify(d)));
  const err = m ? validate(m) : 'err_save_invalid';
  const out = [];
  if (err) out.push({ sev: 'bad', key: 'invalid', n: 1 });
  if (m && m.economy && !Number.isFinite(+m.economy.coins)) out.push({ sev: 'bad', key: 'money', n: 1 });
  return { ok: !out.length, issues: out };
}
