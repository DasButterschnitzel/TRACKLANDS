// Transport overview: one read-only view over every mode the company runs
// (rail, bus, tram, truck, ship, air). It sums up vehicles, services
// (lines), money and units carried last month per mode, lists every service
// with its frequency, load, delay and profit, and detects the problems worth
// the player's attention (Transport panel, advisor). Nothing here changes
// the simulation; results are cached for a moment of game time.
import { roadModel, roadCaps } from '../road/Roads.js';
import { ROAD_VEHICLES } from '../config.js';
import { tx, tz } from '../util.js';

export const MODES = ['rail', 'bus', 'tram', 'truck', 'ship', 'air'];
const KIND_MODE = { bus: 'bus', truck: 'truck', tram: 'tram', dock: 'ship', airport: 'air' };
export const MODE_KIND = { bus: 'bus', truck: 'truck', tram: 'tram', ship: 'dock', air: 'airport' };
export const MODE_ICON = { rail: 'train', bus: 'bus', tram: 'tram', truck: 'truck', ship: 'dock', air: 'airport' };
const SEV = { bad: 0, warn: 1, info: 2 };
const PEOPLE = (c) => c === 'PASSENGERS' || c === 'MAIL';

export function modeOfRoad(v) { const m = roadModel(v.model); return m ? KIND_MODE[m.kind] || 'bus' : 'bus'; }

export class TransportOverview {
  constructor(game) {
    this.game = game;
    this._c = {};
  }

  // cache per key for a moment of real time (the panel and the menu badge
  // refresh twice a second, at any game speed); a reload or a new vehicle,
  // stop or line starts over
  cached(key, secs, fn) {
    const g = this.game, c = this._c[key], now = performance.now();
    if (c && g.time >= c.t && now - c.r < secs * 1000 && c.n === this.sig()) return c.v;
    const v = fn();
    this._c[key] = { t: g.time, r: now, v, n: this.sig() };
    return v;
  }
  sig() { const g = this.game; return `${g.trains.trains.length}|${g.roads ? g.roads.vehicles.length + ':' + g.roads.stops.length + ':' + g.roads.lines.list.length : 0}|${g.stations.list.length}`; }
  invalidate() { this._c = {}; }

  // ---------- modes ----------
  // modes the player can use or already uses
  available() {
    const g = this.game, R = g.roads;
    return MODES.filter((m) => m === 'rail' || (R && (R.kindUnlocked(MODE_KIND[m]) || R.vehicles.some((v) => !v.owner && modeOfRoad(v) === m))));
  }
  // modes with vehicles or own stops (the others are only offered)
  inUse(m) {
    const g = this.game, R = g.roads;
    if (m === 'rail') return g.trains.trains.length > 0 || g.stations.list.length > 0;
    return !!R && (R.vehicles.some((v) => !v.owner && modeOfRoad(v) === m) || R.stops.some((s) => !s.owner && s.kind === MODE_KIND[m]));
  }
  vehicles(mode) {
    const g = this.game;
    if (mode === 'rail') return g.trains.trains;
    if (!g.roads) return [];
    return g.roads.vehicles.filter((v) => !v.owner && (!mode || mode === 'all' || modeOfRoad(v) === mode));
  }
  // one record per vehicle: the common facts the lists and filters need
  vehRecord(v, rail) {
    const g = this.game, L = g.ledger, f = L.objFin(v);
    if (rail) {
      const st = g.trains.statusOf(v);
      const line = v.mode === 'manual' ? g.lines.of(v) : null;
      const pax = v._st && v._st.caps ? v._st.caps.PASSENGERS || 0 : 0;
      const cap = v._st && v._st.caps ? Object.values(v._st.caps).reduce((a, b) => a + b, 0) : 0;
      const age = g.maint ? g.maint.ageY(v) : 0;
      const status = v.state === 'stored' ? 'stored' : v.broken > 0 ? 'broken' : st.warn ? 'problem' : v.state === 'load' ? 'loading' : v.state === 'run' ? 'moving' : 'idle';
      return { id: v.id, sel: `train:${v.id}`, mode: 'rail', sub: pax > cap / 2 ? 'passenger' : 'freight', name: v.name, model: v.model, line: line ? `t:${line.key}` : null, lineName: line ? g.lines.name(line) : null, lineColor: line ? line.color : null,
        town: this.townOfTile(v.steps && v.steps[0] ? v.steps[0].tile : null), rev: f.lastRev, cost: f.lastCost, profit: f.lastRev - f.lastCost, cur: f.rev - f.cost, pu: f.lastPu || 0, cu: f.lastCu || 0,
        age, rel: g.maint ? g.maint.cond(v) : 1, status, delay: v.dly || 0, cap, v };
    }
    const R = g.roads, m = roadModel(v.model) || {};
    const line = R.lines.lineOf(v);
    const s0 = R.stopById(v.stops[0]);
    const status = v.state === 'stored' ? 'stored' : v.state === 'broken' ? 'broken' : v.problem ? 'problem' : v.goGarage ? 'garage' : v.state === 'load' ? 'loading' : v.state === 'run' ? 'moving' : 'idle';
    return { id: v.id, sel: `roadveh:${v.id}`, mode: modeOfRoad(v), sub: m.role || (m.pax ? 'passenger' : 'freight'), name: v.name, model: v.model, line: line ? `rl:${line.id}` : null, lineName: line ? line.name : null, lineColor: line ? line.color : null,
      town: s0 && s0.links && s0.links.towns.length ? s0.links.towns[0] : null, rev: f.lastRev, cost: f.lastCost, profit: f.lastRev - f.lastCost, cur: f.rev - f.cost, pu: f.lastPu || 0, cu: f.lastCu || 0,
      age: R.ageYears(v), rel: R.relOf(v), status, delay: v.dly || 0, cap: m.cap || 0, v };
  }
  townOfTile(tile) {
    if (tile == null) return null;
    const T = this.game.towns;
    let best = null, bd = 1e9;
    for (const t of T.list) { const d = Math.max(Math.abs(t.x - tx(tile)), Math.abs(t.z - tz(tile))); if (d < bd) { bd = d; best = t; } }
    return best && bd <= T.radius(best) + 4 ? best.id : null;
  }
  records(mode = 'all') {
    return this.cached('rec:' + mode, 1, () => {
      const out = [];
      if (mode === 'all' || mode === 'rail') for (const t of this.game.trains.trains) out.push(this.vehRecord(t, true));
      if (mode !== 'rail') for (const v of this.vehicles(mode)) out.push(this.vehRecord(v, false));
      return out;
    });
  }

  // ---------- services (lines) ----------
  services(mode = 'all') {
    return this.cached('svc:' + mode, 1, () => {
      const g = this.game, out = [];
      if (mode === 'all' || mode === 'rail') {
        const lined = new Set();
        for (const l of g.lines.list()) {
          for (const t of l.trains) lined.add(t);
          const recs = l.trains.map((t) => this.vehRecord(t, true));
          const hw = g.lines.headway(l);
          out.push(this.svc({ id: `t:${l.key}`, mode: 'rail', name: g.lines.name(l), color: l.color, stops: l.stops.map((id) => (g.stations.byId(id) || {}).name || '?'), recs, headway: hw, sel: `train:${l.trains[0].id}` }));
        }
        // trains on automatic orders: a service of their own each
        for (const t of g.trains.trains) if (!lined.has(t)) {
          const r = this.vehRecord(t, true);
          out.push(this.svc({ id: `a:${t.id}`, mode: 'rail', name: t.name, color: null, auto: true, stops: [], recs: [r], headway: 0, sel: `train:${t.id}` }));
        }
      }
      if (mode !== 'rail' && g.roads) {
        const R = g.roads, L = R.lines;
        for (const l of L.list) {
          const md = KIND_MODE[l.kind] || 'bus';
          if (mode !== 'all' && md !== mode) continue;
          const vs = L.vehicles(l).filter((v) => !v.owner);
          const k = L.metrics(l);
          const s = this.svc({ id: `rl:${l.id}`, mode: md, name: l.name, color: l.color, stops: L.stops(l).map((x) => x.name), recs: vs.map((v) => this.vehRecord(v, false)), headway: k.headway, sel: `line:${l.id}`, line: l });
          s.capacity = k.capacity; s.demand = k.demand; s.waiting = k.waiting; s.load = k.load; s.status = k.status; s.suggest = k.suggest;
          out.push(s);
        }
        for (const v of this.vehicles(mode)) if (v.line == null) {
          const r = this.vehRecord(v, false);
          out.push(this.svc({ id: `v:${v.id}`, mode: r.mode, name: v.name, color: null, auto: true, stops: v.stops.map((id) => (R.stopById(id) || {}).name || '?'), recs: [r], headway: 0, sel: `roadveh:${v.id}` }));
        }
      }
      return out;
    });
  }
  svc(o) {
    const recs = o.recs;
    const sum = (k) => recs.reduce((a, r) => a + (r[k] || 0), 0);
    const s = { ...o, n: recs.length, rev: sum('rev'), cost: sum('cost'), profit: sum('profit'), cur: sum('cur'), pu: sum('pu'), cu: sum('cu'), delay: recs.length ? sum('delay') / recs.length : 0, capacity: sum('cap'), status: recs.some((r) => r.status === 'problem' || r.status === 'broken') ? 'blocked' : 'ok' };
    delete s.recs;
    s.vehicles = recs.map((r) => r.id);
    return s;
  }

  // ---------- per mode summary ----------
  summary(mode) {
    return this.cached('sum:' + mode, 1, () => {
      const recs = this.records(mode);
      const svcs = this.services(mode).filter((s) => !s.auto || s.n);
      const sum = (k) => recs.reduce((a, r) => a + (r[k] || 0), 0);
      const probs = this.problems().filter((p) => mode === 'all' || p.mode === mode);
      const stops = mode === 'rail' ? this.game.stations.list.length : this.game.roads ? this.game.roads.stops.filter((s) => !s.owner && (mode === 'all' || KIND_MODE[s.kind] === mode)).length : 0;
      return { mode, vehicles: recs.length, services: svcs.length, lines: svcs.filter((s) => !s.auto).length, stops, rev: sum('rev'), cost: sum('cost'), profit: sum('profit'), cur: sum('cur'), pu: sum('pu'), cu: sum('cu'), issues: probs.filter((p) => p.sev !== 'info').length, bad: probs.filter((p) => p.sev === 'bad').length };
    });
  }

  // ---------- problem detection ----------
  // {key, p, sev: bad|warn|info, mode, sel ('type:id') or tile, act: {act, arg, label}}
  problems() {
    return this.cached('prob', 2.5, () => {
      const out = [];
      try { this.railProblems(out); } catch (e) { console.warn('transport: rail problems', e); }
      try { this.roadProblems(out); } catch (e) { console.warn('transport: road problems', e); }
      try { this.worldProblems(out); } catch (e) { console.warn('transport: world problems', e); }
      out.sort((a, b) => SEV[a.sev] - SEV[b.sev] || (b.w || 0) - (a.w || 0));
      return out;
    });
  }
  railProblems(out) {
    const g = this.game;
    // the network advisor (single track, platforms, storage, deadlocks …)
    for (const a of g.advisor()) {
      const sev = a.key === 'adv_deadlock' || a.key === 'adv_overloaded' ? 'bad' : a.key === 'adv_line_saturated' ? 'info' : 'warn';
      out.push({ key: a.key, p: { ...(a.p || {}) }, who: a.name || null, sev, mode: 'rail', sel: a.station != null ? `station:${a.station}` : a.train != null ? `train:${a.train}` : null, tile: a.tile, preview: a.preview, act: a.act === 'upgrade' && a.station != null ? { act: 'jump', arg: `station:${a.station}`, label: 'tm_open_station' } : null });
    }
    for (const t of g.trains.trains) {
      if (t.state === 'lost' || (t.problem && (t.problem === 'no_route' || t.problem === 'no_depot_route'))) out.push({ key: 'pb_no_route', p: { name: t.name }, sev: 'bad', mode: 'rail', sel: `train:${t.id}` });
      else if (t.dly > 45 && t.trips > 3) out.push({ key: 'pb_rail_delay', p: { name: t.name, n: Math.round(t.dly) }, sev: 'warn', mode: 'rail', sel: `train:${t.id}`, w: t.dly });
    }
    // unprofitable trains: a full month in the red
    for (const t of g.trains.trains) { const f = g.ledger.objFin(t); if (t.trips > 6 && f.lastCost > 0 && f.lastRev < f.lastCost * 0.6 && g.ledger.monthIndex() > 1) out.push({ key: 'pb_unprofitable', p: { name: t.name, n: Math.round(f.lastCost - f.lastRev) }, sev: 'info', mode: 'rail', sel: `train:${t.id}` }); }
    // a railway station fed by bus lines that its trains cannot clear
    const R = g.roads;
    if (R) for (const s of g.stations.list) {
      // (only stops that actually hand travellers over)
      const feeders = R.stops.filter((x) => !x.owner && x.rail === s.id && x.stats && x.stats.transfers > 0);
      if (!feeders.length) continue;
      const lines = new Set();
      for (const f of feeders) for (const l of R.lines.linesAt(f.id)) lines.add(l.id);
      const st = g.stations.storage(s), pax = s.stock.PASSENGERS || 0;
      if (lines.size && pax > st * 0.7) out.push({ key: 'pb_feeder_capacity', p: { name: s.name, n: lines.size, w: Math.round(pax) }, sev: 'warn', mode: 'rail', sel: `station:${s.id}`, w: pax });
    }
  }
  roadProblems(out) {
    const g = this.game, R = g.roads;
    if (!R) return;
    const L = R.lines;
    for (const l of L.list) {
      const md = KIND_MODE[l.kind] || 'bus';
      const k = L.metrics(l), vs = L.vehicles(l);
      const add = (key, sev, p = {}, act = null, w = 0) => out.push({ key, p: { name: l.name, ...p }, sev, mode: md, sel: `line:${l.id}`, act, w });
      if (k.status === 'no_vehicles') add('pb_line_empty', 'bad', {}, { act: 'rlAdd', arg: `${l.id}:${Math.max(1, Math.min(3, k.need))}`, label: 'line_add_n', n: Math.max(1, Math.min(3, k.need)) });
      else if (k.status === 'no_route') add('pb_line_no_route', 'bad');
      else if (k.status === 'overcrowded') { const n = Math.max(1, k.suggest); add('pb_line_crowded', 'warn', { w: k.waiting, n }, { act: 'rlAdd', arg: `${l.id}:${n}`, label: 'line_add_n', n }, k.waiting); }
      else if (k.status === 'underused') add('pb_line_underused', 'info', { n: Math.round(k.load * 100) });
      // stuck in traffic: a good share of the trip spent standing
      const jam = vs.length ? vs.reduce((a, v) => a + (v.dly || 0), 0) / vs.length : 0;
      if (vs.length && jam > 12 && k.cycle > 0 && jam * Math.max(1, l.stops.length) > k.cycle * 0.2) add('pb_congestion', 'warn', { n: Math.round(jam) }, md === 'bus' && g.progression.research.has('bus_lanes') ? { act: 'tLane', arg: '', label: 'road_mode_lane' } : null, jam);
    }
    for (const v of R.vehicles) {
      if (v.owner) continue;
      const md = modeOfRoad(v);
      if (v.problem === 'no_route') out.push({ key: 'pb_no_route', p: { name: v.name }, sev: 'bad', mode: md, sel: `roadveh:${v.id}` });
      else if (v.state === 'broken') out.push({ key: 'pb_broken', p: { name: v.name }, sev: 'warn', mode: md, sel: `roadveh:${v.id}` });
      else if (R.needsService(v)) out.push({ key: 'pb_needs_service', p: { name: v.name, n: Math.round(R.relOf(v) * 100) }, sev: 'info', mode: md, sel: `roadveh:${v.id}`, act: R.garageNear(v) ? { act: 'rvService', arg: `${v.id}`, label: 'rv_service_now' } : null });
      const m = roadModel(v.model);
      if (m && R.ageYears(v) > (m.life || 16)) out.push({ key: 'pb_old', p: { name: v.name, n: Math.round(R.ageYears(v)) }, sev: 'info', mode: md, sel: `roadveh:${v.id}` });
    }
    // stops: full, waiting cargo nobody can carry, no service at all
    for (const s of R.stops) {
      if (s.owner || s.kind === 'garage') continue;
      const md = KIND_MODE[s.kind] || 'bus';
      const vs = R.vehicles.filter((v) => !v.owner && v.stops.includes(s.id));
      const st = g.stations.storage(s);
      const tot = Object.values(s.stock).reduce((a, b) => a + b, 0);
      if (!vs.length && !L.linesAt(s.id).length) { out.push({ key: 'pb_stop_unserved', p: { name: s.name }, sev: 'info', mode: md, sel: `roadstop:${s.id}`, act: md === 'bus' || md === 'tram' ? { act: 'lineFromStop', arg: `${s.id}`, label: 'line_new_here' } : null }); continue; }
      if (st > 0 && tot >= st * 0.95) out.push({ key: 'pb_stop_full', p: { name: s.name }, sev: 'warn', mode: md, sel: `roadstop:${s.id}`, act: R.nextType(s) ? { act: 'stopUpgrade', arg: `${s.id}`, label: 'stop_upgrade' } : null, w: tot });
      for (const c of Object.keys(s.stock)) {
        if (s.stock[c] < 20) continue;
        if (vs.some((v) => { const m = roadModel(v.model); return m && roadCaps(m)[c]; })) continue;
        const any = ROAD_VEHICLES.some((m) => m.kind === s.kind && roadCaps(m)[c] && m.level <= g.progression.level);
        out.push({ key: any ? 'pb_no_vehicle_for' : 'pb_no_model_for', p: { name: s.name, cargo: c }, sev: 'warn', mode: md, sel: `roadstop:${s.id}` });
      }
    }
  }
  worldProblems(out) {
    const g = this.game;
    // industries whose storage is full although the company serves them
    for (const ind of g.industries.list) {
      if (!g.progression.regionUnlocked(ind.region)) continue;
      const sts = g.industries.linkedStations(ind).filter((s) => !s.owner);
      if (!sts.length) continue;
      const cap = g.industries.capacity(ind);
      const full = Object.keys(ind.out || {}).find((c) => (ind.out[c] || 0) >= cap * 0.95);
      if (full) out.push({ key: 'pb_industry_full', p: { name: g.industries.displayName(ind), cargo: full }, sev: 'warn', mode: sts[0].road ? KIND_MODE[sts[0].kind] || 'truck' : 'rail', sel: `industry:${ind.id}` });
    }
    // towns (and parts of towns) with travellers but no stop in reach
    for (const t of g.towns.list) {
      if (!g.progression.regionUnlocked(t.region) || t.pop < 250) continue;
      const gap = g.towns.gaps(t);
      if (!gap) continue;
      if (gap.none) { if (t.pop >= 400) out.push({ key: 'pb_town_unserved', p: { name: t.name, n: Math.round(t.pop) }, sev: 'info', mode: 'bus', sel: `town:${t.id}`, w: t.pop / 100 }); continue; }
      if (gap.area && gap.share > 0.3) out.push({ key: 'pb_district_unserved', p: { name: t.name, area: 'area_' + gap.area, n: Math.round(gap.share * 100) }, sev: 'info', mode: 'bus', sel: `town:${t.id}`, tile: gap.tile, w: gap.weight });
    }
  }
}
