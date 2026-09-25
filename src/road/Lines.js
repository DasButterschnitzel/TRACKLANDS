// Road, tram, water and air services as named, coloured lines.
//
// A line is an ordered list of stops of one kind plus a service pattern:
//   loop     A B C D (A B C …)       – the vehicles go round
//   outback  A B C D C B (A …)       – out and back along the same stops
//   oneway   A B C D, back empty     – no boarding on the way back to A
//   shuttle  A B (A B …)             – the first two stops only
// Every vehicle on a line runs the line's expanded stop sequence (v.stops);
// the line keeps statistics (passengers, revenue, running cost per month),
// measures demand at its stops, and derives frequency, average wait,
// capacity and a status from them. With automatic allocation a line buys or
// retires vehicles monthly to match its demand. Vehicles without a line keep
// working as before (older saves are given lines when they load).
import { cheb, tx, tz } from '../util.js';
import { KMH_PER_TILE_S, ROAD_VEHICLES } from '../config.js';

export const LINE_COLORS = [0xd8483a, 0x2f7ad0, 0x3fae5a, 0xe0a33a, 0x8a4fc0, 0x17a2b8, 0xe36fa0, 0x6b8e23, 0xb06a2b, 0x4a5568, 0xc0392b, 0x16a085, 0xd4ac0d, 0x7d3c98];
export const PATTERNS = ['loop', 'outback', 'oneway', 'shuttle'];
const MONTH = 60;             // game seconds per month
const DWELL = 3;              // seconds a stop takes on average
const HIST = 12;              // months of history kept per line
const MAX_NEED = 40;          // the most vehicles a line suggests

const hex = (c) => '#' + (c >>> 0).toString(16).padStart(6, '0');
export { hex as lineHex };

export class RoadLines {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.nextId = 1;
    this._m = null;
  }
  byId(id) { return this.list.find((l) => l.id === id) || null; }
  get roads() { return this.game.roads; }
  vehicles(line) { return this.roads.vehicles.filter((v) => v.line === line.id); }
  stops(line) { return line.stops.map((id) => this.roads.stopById(id)).filter(Boolean); }
  lineOf(v) { return v && v.line != null ? this.byId(v.line) : null; }
  linesAt(stopId) { return this.list.filter((l) => l.stops.includes(stopId)); }

  // ---------- creation and editing ----------
  // the next free short name for a kind: 1, 2, 3 … (trams T1 …, ships F1 …, air A1 …, trucks L1 …)
  autoName(kind) {
    const pre = { bus: '', tram: 'T', dock: 'F', airport: 'A', truck: 'L' }[kind] ?? '';
    let n = 1;
    while (this.list.some((l) => l.name === pre + n)) n++;
    return pre + n;
  }
  nextColor() {
    const used = new Map();
    for (const l of this.list) used.set(l.color, (used.get(l.color) || 0) + 1);
    let best = LINE_COLORS[0], bn = Infinity;
    for (const c of LINE_COLORS) { const n = used.get(c) || 0; if (n < bn) { bn = n; best = c; } }
    return best;
  }
  // a good default pattern for these stops
  suggestPattern(stopIds) {
    const st = stopIds.map((id) => this.roads.stopById(id)).filter(Boolean);
    if (st.length <= 2) return 'shuttle';
    // the ends lie close together: a ring
    if (cheb(st[0].tile, st[st.length - 1].tile) <= 5) return 'loop';
    return 'outback';
  }
  create({ kind, stops, pattern, name, color, model, auto }) {
    const st = (stops || []).filter((id, i, a) => this.roads.stopById(id) && (i === 0 || a[i - 1] !== id));
    if (st.length < 2) return { error: 'err_line_two_stops' };
    const k = kind || this.roads.stopById(st[0]).kind;
    if (st.some((id) => this.roads.stopById(id).kind !== k)) return { error: 'err_wrong_stop' };
    const line = {
      id: this.nextId++, name: String(name || this.autoName(k)).slice(0, 24), color: color ?? this.nextColor(), kind: k,
      stops: st, pattern: PATTERNS.includes(pattern) ? pattern : this.suggestPattern(st), model: model || null, auto: !!auto,
      created: this.game.time, hist: [], cur: { pax: 0, rev: 0, cost: 0, trips: 0 }, gen: {},
    };
    this.list.push(line);
    this.changed();
    return { ok: true, line };
  }
  remove(line) {
    for (const v of this.vehicles(line)) { v.line = null; v.stops = v.stops.slice(0, 1); v.idx = 0; if (v.state === 'load') v.t = Math.min(v.t, 1); }
    this.list = this.list.filter((l) => l !== line);
    this.changed();
  }
  setStops(line, stops) {
    const st = stops.filter((id, i, a) => this.roads.stopById(id) && (i === 0 || a[i - 1] !== id));
    if (st.length < 2) return { error: 'err_line_two_stops' };
    line.stops = st;
    if (line.pattern === 'shuttle' && st.length > 2) line.pattern = this.suggestPattern(st);
    this.refresh(line);
    return { ok: true };
  }
  setPattern(line, p) { if (PATTERNS.includes(p)) { line.pattern = p; this.refresh(line); } }
  // the order a vehicle runs the stops in
  seq(line) {
    const s = line.stops;
    if (line.pattern === 'shuttle' || s.length <= 2) return s.slice(0, 2);
    if (line.pattern === 'outback') return [...s, ...s.slice(1, -1).reverse()];
    return s.slice();
  }
  // no boarding on the way back of a one-way service
  boards(line, stopIdx) {
    if (!line || line.pattern !== 'oneway') return true;
    return stopIdx % line.stops.length !== line.stops.length - 1;
  }
  assign(v, line) {
    const old = this.lineOf(v);
    v.line = line ? line.id : null;
    if (!line) { this.changed(); return; }
    const seq = this.seq(line);
    // continue from the nearest stop of the line
    let bi = 0, bd = Infinity;
    seq.forEach((id, i) => { const s = this.roads.stopById(id); const d = s ? cheb(s.tile, v.tile) : Infinity; if (d < bd) { bd = d; bi = i; } });
    v.stops = seq;
    v.idx = (bi + seq.length - 1) % seq.length;   // leave() moves on to bi
    if (v.state !== 'run') { v.state = 'load'; v.t = Math.min(v.t || 0, 0.5); }
    else { v.path = null; v.pi = 0; }
    v.problem = null;
    void old;
    this.changed();
  }
  refresh(line) {
    const seq = this.seq(line);
    for (const v of this.vehicles(line)) {
      const cur = v.stops[v.idx % v.stops.length];
      v.stops = seq;
      const k = seq.indexOf(cur);
      v.idx = k >= 0 ? k : 0;
      if (v.state === 'idle') v.t = 0;
    }
    this.changed();
  }
  changed() { this._m = null; this.game.events.emit('linesChanged'); }
  // a stop went away: take it out of every line (lines left with one stop stop)
  onStopRemoved(id) {
    for (const l of [...this.list]) {
      if (!l.stops.includes(id)) continue;
      l.stops = l.stops.filter((s) => s !== id).filter((s, i, a) => i === 0 || a[i - 1] !== s);
      this.refresh(l);
    }
  }

  // ---------- measures ----------
  // tiles along the route of one full cycle (road path lengths; air: straight)
  cycleTiles(line) {
    const R = this.roads, seq = this.seq(line);
    const mode = R.modeOfKind ? R.modeOfKind(line.kind) : 'road';
    let n = 0;
    for (let i = 0; i < seq.length; i++) {
      const a = R.stopById(seq[i]), b = R.stopById(seq[(i + 1) % seq.length]);
      if (!a || !b) continue;
      if (mode === 'air') { n += Math.hypot(tx(a.tile) - tx(b.tile), tz(a.tile) - tz(b.tile)); continue; }
      const p = R.route(mode, a.tile, b.tile);
      n += p ? p.length - 1 : cheb(a.tile, b.tile) * 1.4;
    }
    return n;
  }
  model(line) {
    const vs = this.vehicles(line);
    const id = line.model || (vs[0] && vs[0].model);
    return ROAD_VEHICLES.find((m) => m.id === id) || this.bestModel(line.kind) || null;
  }
  bestModel(kind) {
    const L = this.game.progression.level;
    const ok = ROAD_VEHICLES.filter((m) => m.kind === kind && m.level <= L && !m.retired);
    return ok.sort((a, b) => (b.cap * b.speed) / b.price - (a.cap * a.speed) / a.price)[0] || null;
  }
  metrics(line) {
    const g = this.game, R = this.roads;
    const vs = this.vehicles(line);
    const m = this.model(line);
    const tiles = this.cycleTiles(line);
    const speed = m ? (m.speed / KMH_PER_TILE_S) * (m.kind === 'airport' ? 0.6 : 1) * 0.85 : 1;
    const seq = this.seq(line);
    const cycle = tiles / Math.max(0.1, speed) + seq.length * DWELL * (m && m.board ? 1 / m.board : 1);
    const n = vs.length;
    const cap = vs.length ? vs.reduce((a, v) => a + (R.capOf ? R.capOf(v) : 0), 0) / n : (m ? m.cap : 0);
    const perVeh = cap * (MONTH / Math.max(1, cycle));
    const capacity = Math.round(perVeh * n);
    const headway = n ? cycle / n : 0;
    const wait = n ? headway / 2 : 0;
    // demand: travellers turning up at the line's stops per month (shared
    // between the lines at a stop), measured; a first guess from the towns
    const stops = this.stops(line);
    let demand = 0, waiting = 0;
    for (const s of stops) {
      const share = 1 / Math.max(1, this.linesAt(s.id).length);
      const gen = s.stats && s.stats.genEma != null ? s.stats.genEma : this.guessGen(s);
      demand += gen * share;
      waiting += (s.stock.PASSENGERS || 0) * share + (s.kind === 'truck' ? Object.keys(s.stock).reduce((a, c) => a + (c === 'PASSENGERS' ? 0 : s.stock[c]), 0) * share : 0);
    }
    demand = Math.round(demand);
    const h = line.hist.length ? line.hist[line.hist.length - 1] : null;
    const carried = h ? h.pax : line.cur.pax;
    const load = capacity > 0 ? Math.min(1, carried / capacity) : 0;
    let status = 'ok';
    if (!n) status = 'no_vehicles';
    else if (line.stops.length < 2) status = 'no_route';
    else if (vs.some((v) => v.problem)) status = 'blocked';
    else if (demand > capacity * 1.1 || waiting > Math.max(40, cap * n * 1.2)) status = 'overcrowded';
    else if (n > 1 && h && load < 0.2) status = 'underused';
    const need = perVeh > 0 ? Math.max(1, Math.min(MAX_NEED, Math.ceil(demand / (perVeh * 0.8)))) : n;
    const profit = h ? h.rev - h.cost : Math.round(line.cur.rev - line.cur.cost);
    void g;
    return { n, tiles: Math.round(tiles), cycle, headway, wait, capacity, demand, waiting: Math.round(waiting), load, status, need, suggest: need - n, profit, model: m, cap, perVeh };
  }
  // before anything is measured: a share of the towns' travellers at a stop
  guessGen(s) {
    const g = this.game, P = g.towns;
    if (!s.links || !s.links.towns.length) return s.kind === 'truck' ? 20 : 0;
    let n = 0;
    for (const id of s.links.towns) { const t = P.byId(id); if (t) n += 4 + t.pop * 0.012; }
    return n;
  }
  // estimates for a planned line (route tool): distance, time, demand, cost, revenue
  estimate(kind, stopIds, pattern, modelId) {
    const tmp = { kind, stops: stopIds, pattern: pattern || this.suggestPattern(stopIds), model: modelId || null, hist: [], cur: { pax: 0, rev: 0, cost: 0 } };
    const m = (modelId && ROAD_VEHICLES.find((x) => x.id === modelId)) || this.bestModel(kind);
    const tiles = this.cycleTiles(tmp);
    const speed = m ? (m.speed / KMH_PER_TILE_S) * 0.85 : 1;
    const cycle = tiles / Math.max(0.1, speed) + this.seq(tmp).length * DWELL;
    let demand = 0;
    for (const id of stopIds) { const s = this.roads.stopById(id); if (s) demand += (s.stats && s.stats.genEma != null ? s.stats.genEma : this.guessGen(s)) / Math.max(1, this.linesAt(id).length + 1); }
    const perVeh = m ? m.cap * (MONTH / Math.max(1, cycle)) : 0;
    const need = perVeh > 0 ? Math.max(1, Math.min(MAX_NEED, Math.ceil(demand / (perVeh * 0.8)))) : 1;
    // revenue: the carried travellers at the average hop length
    const E = this.game.economy;
    const hop = Math.max(2, tiles / Math.max(1, this.seq(tmp).length));
    const carried = Math.min(demand, perVeh * need);
    const rev = E && E.revenue ? Math.round(E.revenue(kind === 'truck' ? 'GOODS' : 'PASSENGERS', carried, hop, null, false, hop / Math.max(0.1, speed)) * 0.9) : 0;
    const cost = m ? Math.round(m.op * need) : 0;
    return { tiles: Math.round(tiles), cycle, demand: Math.round(demand), need, model: m, revenue: rev, cost, pattern: tmp.pattern, minutes: cycle / 60 };
  }

  // ---------- running ----------
  // a vehicle on a line carried and earned something (booked by Roads)
  note(v, what, n) {
    const l = this.lineOf(v);
    if (!l) return;
    if (what === 'pax') l.cur.pax += n;
    else if (what === 'rev') l.cur.rev += n;
    else if (what === 'cost') l.cur.cost += n;
    else if (what === 'trip') l.cur.trips += n;
  }
  closeMonth() {
    const R = this.roads;
    // stop demand: travellers that turned up this month (moving average)
    for (const s of R.stops) {
      const st = s.stats;
      const gen = st.genMonth || 0;
      st.genEma = st.genEma == null ? gen : st.genEma * 0.6 + gen * 0.4;
      st.genMonth = 0;
    }
    for (const l of this.list) {
      l.hist.push({ pax: Math.round(l.cur.pax), rev: Math.round(l.cur.rev), cost: Math.round(l.cur.cost), trips: l.cur.trips, n: this.vehicles(l).length });
      if (l.hist.length > HIST) l.hist.shift();
      l.cur = { pax: 0, rev: 0, cost: 0, trips: 0 };
      if (l.auto) this.autoAllocate(l);
    }
  }
  // automatic allocation: one vehicle more or less per month toward the need
  autoAllocate(line) {
    const g = this.game, R = this.roads;
    const k = this.metrics(line);
    const m = this.model(line);
    if (!m) return;
    if (k.suggest > 0 && k.status !== 'blocked') {
      const price = Math.round(m.price * g.difficulty.costMul);
      if (!g.economy.canAfford(price * 1.5)) return;
      const home = R.garageFor ? R.garageFor(line) : null;
      const first = R.stopById(line.stops[0]);
      const r = R.buy(m.id, home || first, null, line);
      if (r.vehicle) g.events.emit('lineAuto', line, 'add', r.vehicle);
    } else if (k.suggest < -1 && k.n > 1) {
      // the emptiest vehicle goes: sold where it stands (no passengers aboard)
      const vs = this.vehicles(line).filter((v) => !R.load(v)).sort((a, b) => (a.earned || 0) - (b.earned || 0));
      if (vs[0]) { R.sell(vs[0]); g.events.emit('lineAuto', line, 'remove', vs[0]); }
    }
  }

  // ---------- save ----------
  serialize() {
    return { next: this.nextId, list: this.list.map((l) => ({ id: l.id, name: l.name, color: l.color, kind: l.kind, stops: l.stops, pattern: l.pattern, model: l.model || undefined, auto: l.auto || undefined, created: Math.round(l.created || 0), hist: l.hist, cur: l.cur })) };
  }
  deserialize(d) {
    this.list = [];
    if (!d || typeof d !== 'object') return;
    const R = this.roads;
    for (const x of Array.isArray(d.list) ? d.list : []) {
      if (!x || !Number.isInteger(x.id)) continue;
      const stops = (Array.isArray(x.stops) ? x.stops : []).filter((id) => R.stopById(id));
      const kind = typeof x.kind === 'string' ? x.kind : stops.length ? R.stopById(stops[0]).kind : 'bus';
      const hist = (Array.isArray(x.hist) ? x.hist : []).filter((h) => h && typeof h === 'object').slice(-HIST).map((h) => ({ pax: +h.pax || 0, rev: +h.rev || 0, cost: +h.cost || 0, trips: h.trips | 0, n: h.n | 0 }));
      const cur = x.cur && typeof x.cur === 'object' ? { pax: +x.cur.pax || 0, rev: +x.cur.rev || 0, cost: +x.cur.cost || 0, trips: x.cur.trips | 0 } : { pax: 0, rev: 0, cost: 0, trips: 0 };
      this.list.push({ id: x.id, name: String(x.name || x.id).slice(0, 24), color: Number.isFinite(+x.color) ? (+x.color >>> 0) & 0xffffff : LINE_COLORS[x.id % LINE_COLORS.length], kind, stops: stops.filter((s) => R.stopById(s).kind === kind), pattern: PATTERNS.includes(x.pattern) ? x.pattern : 'loop', model: typeof x.model === 'string' ? x.model : null, auto: !!x.auto, created: +x.created || 0, hist, cur, gen: {} });
    }
    this.nextId = Math.max(d.next | 0, 1, ...this.list.map((l) => l.id + 1));
  }
  // older saves: vehicles that share a stop list become one line (they went
  // round their stops in order: a loop, or a shuttle for two stops)
  adoptVehicles() {
    const R = this.roads;
    const groups = new Map();
    for (const v of R.vehicles) {
      if (v.owner || (v.line != null && this.byId(v.line))) continue;
      v.line = null;
      if (!v.stops || v.stops.length < 2) continue;
      const m = ROAD_VEHICLES.find((x) => x.id === v.model);
      const key = (m ? m.kind : '?') + ':' + v.stops.join(',');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(v);
    }
    for (const vs of groups.values()) {
      const stops = vs[0].stops.slice();
      const r = this.create({ kind: R.stopById(stops[0]) ? R.stopById(stops[0]).kind : undefined, stops, pattern: stops.length === 2 ? 'shuttle' : 'loop' });
      if (!r.line) continue;
      for (const v of vs) { v.line = r.line.id; v.stops = this.seq(r.line); v.idx = v.idx % v.stops.length; }
    }
    for (const l of this.list) { const vs = this.vehicles(l); for (const v of vs) { if (v.stops.join(',') !== this.seq(l).join(',')) { v.stops = this.seq(l); v.idx %= v.stops.length; } } }
  }
}
