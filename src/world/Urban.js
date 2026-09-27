// Urban model (Phase 7): how towns react to transport.
//
//  - Accessibility: every building is rated by the best public transport in
//    walking reach (GOOD / MEDIUM / POOR / NONE): a stop or station counts by
//    its service (the quality of its lines, how often trains call).
//  - Land value: centre, accessibility, parks and water raise it; industry,
//    freight yards and airports nearby lower it for homes. A busy passenger
//    station raises the value around it. Land value makes towns build denser
//    and sets the compensation for demolition.
//  - Districts: what each quarter of a town has become (old town, suburb,
//    residential, high density, mixed use, commercial, CBD, station quarter,
//    industrial, logistics, waterfront, university, tourism, airport district,
//    technology park). They are read from the buildings, so they evolve as
//    the town grows; changes are reported in the news.
//  - Metropolitan regions: towns whose built-up areas touch form "Greater
//    <largest>", with population and passengers by mode.
//  - Commuter belts: smaller towns near a city (not part of it) send more
//    commuters there.
//  - Tourism: an index per town (landmarks, hotels, water, mountains, the
//    archetype, the season); tourist towns with good access grow hotels.
//  - Events: football matches, festivals, conventions, university terms,
//    holiday travel and tourist weekends: announced a month ahead, then more
//    people travel to and from that town for a month.
//  - Good public transport takes some cars off the streets (Traffic).
// Everything is derived and cached; only the events and the district history
// are saved.
import { cheb, tx, tz, idx, inMap, hashStr } from '../util.js';
import { TOWN_RADIUS } from '../config.js';
import { MONTH_S } from '../economy/Ledger.js';

export const ACCESS = ['none', 'poor', 'medium', 'good'];
export const DISTRICTS = ['old_town', 'residential', 'suburban', 'high_density', 'mixed_use', 'commercial', 'cbd', 'station_quarter', 'industrial', 'logistics', 'waterfront', 'university', 'tourism', 'airport', 'tech_park'];
export const TOWN_EVENTS = {
  football: { need: 'stadium', mul: 1.8, attr: 3 },
  festival: { stage: 2, mul: 1.5, attr: 2 },
  convention: { need: 'convention', mul: 1.6, attr: 2.5 },
  term: { need: 'university', mul: 1.6, attr: 2 },
  holiday: { stage: 3, mul: 1.4, attr: 1.5 },
  tourist_weekend: { tourist: true, mul: 1.7, attr: 2.5 },
};
const RES = new Set(['cottage', 'house', 'house2', 'townhouse', 'terrace', 'chalet', 'bungalow', 'farmhouse']);
const DENSE = new Set(['apartment', 'block', 'tower', 'skyscraper']);
const JOBS = new Set(['office', 'glasstower', 'skyscraper']);
const SHOPS = new Set(['shop', 'market_hall', 'plaza', 'mixeduse']);
const FUN = new Set(['park', 'museum', 'cathedral', 'monument', 'stadium', 'clocktower', 'tv_tower', 'lighthouse', 'hotel']);
const REFRESH = 8;   // seconds of game time between re-reads of a town

export class Urban {
  constructor(game) {
    this.game = game;
    this._c = new Map();       // town id -> cached {t, n, v}
    this._metro = null;
    this.events = [];           // {id, kind, town, start, end, announced}
    this.seq = 1;
    this.hist = {};            // town id -> {quarter: district} last month
    this._month = null;
  }

  // ---------- accessibility ----------
  // how good the public transport of a stop or station is (0 … 1)
  nodeService(s) {
    const g = this.game;
    if (s.owner) return 0;
    if (!s.road) {
      const P = g.pax;
      const n = P ? P.arrivals(s) : 0;
      const q = s._q != null ? s._q : null;
      const f = Math.min(1, n / 6);
      return q != null ? Math.max(f * 0.8, q) : f * 0.85;
    }
    if (s.kind !== 'bus' && s.kind !== 'tram' && s.kind !== 'dock' && s.kind !== 'airport') return 0;
    const L = g.roads.lines.linesAt(s.id).filter((l) => g.roads.lines.vehicles(l).length);
    if (!L.length) return 0;
    return s._q != null ? s._q : 0.5;
  }
  // per town: access level of every building, shares, a score, land values
  town(t) {
    const g = this.game, c = this._c.get(t.id);
    if (c && g.time >= c.t && g.time - c.t < REFRESH && c.n === t.buildings.length) return c.v;
    const v = this.compute(t);
    this._c.set(t.id, { t: g.time, n: t.buildings.length, v });
    return v;
  }
  invalidate() { this._c.clear(); this._metro = null; }

  compute(t) {
    const g = this.game, S = g.stations, R = g.roads;
    const nodes = [];
    for (const s of S.list) { if (cheb(s.tile, t.z * g.mapSize + t.x) > 14) continue; const q = this.nodeService(s); nodes.push({ tiles: S.allTiles(s), r: S.radius(s), q, pax: !s.service || S.serves(s, 'PASSENGERS'), freight: s.kind === 'freight' || s.kind === 'yard' || s.kind === 'intermodal', level: s.level | 0, busy: Math.min(1, (s.stats.arrivals || 0) / 60) }); }
    if (R) for (const s of R.stops) { if (s.owner || cheb(s.tile, t.z * g.mapSize + t.x) > 14) continue; nodes.push({ tiles: R.stopTiles(s), r: R.stopRadius(s), q: this.nodeService(s), pax: s.kind !== 'truck' && s.kind !== 'garage', freight: s.kind === 'truck', airport: s.kind === 'airport', dock: s.kind === 'dock' }); }
    const inds = g.industries.list.filter((i) => Math.max(Math.abs(i.x - t.x), Math.abs(i.z - t.z)) <= TOWN_RADIUS[t.stage] + 4);
    const W = g.world;
    const per = [];
    const share = { none: 0, poor: 0, medium: 0, good: 0 };
    let tot = 0, score = 0, lvSum = 0;
    const base = (g.towns.arch(t).land || 1);
    for (const b of t.buildings) {
      const bx = tx(b.tile), bz = tz(b.tile);
      let best = 0, stationNear = 0, freightNear = 0, airport = 0;
      for (const n of nodes) {
        let d = Infinity;
        for (const u of n.tiles) { const x = cheb(u, b.tile); if (x < d) d = x; }
        if (n.pax && d <= n.r) best = Math.max(best, n.q * (d <= 1 ? 1 : d <= 3 ? 0.9 : 0.75));
        if (n.pax && !n.airport && !n.dock && d <= 3 && n.level != null) stationNear = Math.max(stationNear, (0.3 + 0.12 * n.level + 0.3 * (n.busy || 0)) * (1 - d / 4));
        if (n.freight && d <= 2) freightNear = Math.max(freightNear, 1 - d / 3);
        if (n.airport && d <= 5) airport = Math.max(airport, 1 - d / 6);
      }
      const lvl = best >= 0.6 ? 'good' : best >= 0.35 ? 'medium' : best > 0 ? 'poor' : 'none';
      const w = RES.has(b.arch) ? 1 : DENSE.has(b.arch) ? 3 : 1.5;
      share[lvl] += w; tot += w; score += best * w;
      // land value: centre, access, parks and water, minus nuisances for homes
      const dc = Math.max(Math.abs(bx - t.x), Math.abs(bz - t.z));
      let lv = base * (1.35 - Math.min(0.6, dc * 0.09)) * (0.85 + 0.45 * best);
      if (this.nearWater(W, bx, bz)) lv *= 1.15;
      if (t.buildings.some((o) => (o.arch === 'park' || o.arch === 'plaza') && cheb(o.tile, b.tile) <= 2)) lv *= 1.08;
      const home = RES.has(b.arch) || DENSE.has(b.arch);
      let nuis = 0;
      for (const i of inds) { const d = Math.max(Math.abs(i.x + 1 - bx), Math.abs(i.z + 1 - bz)); if (d <= 3) nuis = Math.max(nuis, 0.25 * (1 - d / 4)); }
      nuis = Math.max(nuis, freightNear * 0.2, airport * 0.18);
      lv *= home ? 1 - nuis : 1 + nuis * 0.3;
      lv *= 1 + stationNear * 0.25;
      b.lv = Math.round(lv * 100) / 100;
      b.acc = lvl;
      per.push(b);
      lvSum += lv;
    }
    for (const k in share) share[k] = tot ? share[k] / tot : 0;
    return { share, score: tot ? score / tot : 0, lv: t.buildings.length ? lvSum / t.buildings.length : base, n: t.buildings.length };
  }
  nearWater(W, x, z) {
    for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2]]) { const X = x + ox, Z = z + oz; if (inMap(X, Z) && W.type[idx(X, Z)] === 1) return true; }
    return false;
  }
  // land value at a tile of a town (new buildings: density; demolition: compensation)
  landValueAt(t, tile) {
    const info = this.town(t);
    const b = t.buildings.find((x) => x.tile === tile);
    if (b && b.lv) return b.lv;
    const dc = Math.max(Math.abs(tx(tile) - t.x), Math.abs(tz(tile) - t.z));
    return (this.game.towns.arch(t).land || 1) * (1.35 - Math.min(0.6, dc * 0.09)) * (0.85 + 0.45 * info.score);
  }

  // ---------- districts ----------
  // the quarter a building belongs to (centre or one of eight sectors, near or far)
  quarter(t, tile) {
    const dx = tx(tile) - t.x, dz = tz(tile) - t.z;
    if (Math.max(Math.abs(dx), Math.abs(dz)) <= 1) return 'c';
    const a = Math.round((Math.atan2(dz, dx) / (Math.PI * 2)) * 4 + 4) % 4;
    return ['e', 's', 'w', 'n'][a] + (Math.max(Math.abs(dx), Math.abs(dz)) >= 4 ? '2' : '1');
  }
  // what each quarter has become: [{q, kind, n, tile}]
  districts(t) {
    const g = this.game;
    const Q = new Map();
    for (const b of t.buildings) { const q = this.quarter(t, b.tile); if (!Q.has(q)) Q.set(q, []); Q.get(q).push(b); }
    const stations = g.stations.list.filter((s) => s.links && s.links.towns.includes(t.id));
    const airports = g.roads ? g.roads.stops.filter((s) => s.kind === 'airport' && !s.owner) : [];
    const out = [];
    for (const [q, bs] of Q) {
      const cnt = (set) => bs.filter((b) => set.has(b.arch)).length;
      const n = bs.length;
      const res = cnt(RES), dense = cnt(DENSE), jobs = cnt(JOBS), shops = cnt(SHOPS), fun = cnt(FUN);
      const fac = bs.filter((b) => b.arch === 'factory').length, wh = bs.filter((b) => b.arch === 'warehouse' || b.arch === 'boathouse').length;
      const uni = bs.some((b) => b.arch === 'university'), glass = bs.filter((b) => b.arch === 'glasstower').length;
      const mixed = bs.filter((b) => b.arch === 'mixeduse').length;
      const tile = bs[0].tile;
      const nearStation = stations.some((s) => bs.some((b) => cheb(b.tile, s.tile) <= 2) && (s.level | 0) >= 2);
      const nearAir = airports.some((s) => bs.some((b) => cheb(b.tile, s.tile) <= 4));
      const water = bs.filter((b) => this.nearWater(g.world, tx(b.tile), tz(b.tile))).length;
      let kind;
      if (uni) kind = 'university';
      else if (nearAir) kind = 'airport';
      else if (glass >= 2 || (glass >= 1 && jobs >= 2)) kind = 'tech_park';
      else if (q === 'c' && jobs >= 2 && t.stage >= 4) kind = 'cbd';
      else if (q === 'c' && (t.kind === 'historic' || bs.some((b) => b.arch === 'cathedral' || b.arch === 'civic')) && dense <= 1) kind = 'old_town';
      else if (fun >= Math.max(2, n * 0.3) || (t.kind === 'tourism' && bs.some((b) => b.arch === 'hotel'))) kind = 'tourism';
      else if (nearStation && n >= 3) kind = 'station_quarter';
      else if (fac >= Math.max(1, n * 0.3)) kind = 'industrial';
      else if (wh >= Math.max(1, n * 0.3)) kind = 'logistics';
      else if (water >= n * 0.5 && n >= 2) kind = 'waterfront';
      else if (mixed >= Math.max(1, n * 0.25)) kind = 'mixed_use';
      else if (jobs + shops >= n * 0.5) kind = 'commercial';
      else if (dense >= n * 0.5) kind = 'high_density';
      else if (q.endsWith('2') && res >= n * 0.6) kind = 'suburban';
      else kind = 'residential';
      out.push({ q, kind, n, tile });
    }
    return out.sort((a, b) => b.n - a.n);
  }

  // ---------- metropolitan regions and commuter belts ----------
  metros() {
    const g = this.game;
    if (this._metro && g.time - this._metro.t < 10 && g.time >= this._metro.t) return this._metro.v;
    const T = g.towns, seen = new Set(), out = [];
    for (const t of T.list) {
      if (seen.has(t.id) || t.stage < 3 || !g.progression.regionUnlocked(t.region)) continue;
      const grp = [t], q = [t];
      seen.add(t.id);
      while (q.length) { const x = q.pop(); for (const o of T.metroWith(x)) if (!seen.has(o.id) && o.stage >= 1) { seen.add(o.id); grp.push(o); q.push(o); } }
      if (grp.length < 2) continue;
      grp.sort((a, b) => b.pop - a.pop);
      const ids = new Set(grp.map((x) => x.id));
      let rail = 0, bus = 0, tram = 0;
      for (const s of g.stations.list) if (s.links && s.links.towns.some((id) => ids.has(id))) rail += s.mPax || 0;
      if (g.roads) for (const s of g.roads.stops) if (!s.owner && s.links && s.links.towns.some((id) => ids.has(id))) { if (s.kind === 'tram') tram += s.mPax || 0; else if (s.kind === 'bus') bus += s.mPax || 0; }
      out.push({ id: grp[0].id, name: grp[0].name, towns: grp.map((x) => x.id), pop: grp.reduce((a, x) => a + x.pop, 0), rail, bus, tram });
    }
    this._metro = { t: g.time, v: out };
    return out;
  }
  metroOf(t) { return this.metros().find((m) => m.towns.includes(t.id)) || null; }
  // a smaller town near a city it is not part of: its commuters head there
  beltOf(t) {
    if (t.stage >= 4) return null;
    const m = this.metroOf(t);
    let best = null, bd = 15;
    for (const o of this.game.towns.list) {
      if (o === t || o.stage < 4 || (m && m.towns.includes(o.id))) continue;
      const d = Math.max(Math.abs(o.x - t.x), Math.abs(o.z - t.z));
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  // ---------- tourism ----------
  tourism(t) {
    const g = this.game;
    let k = t.tourist ? 0.45 : 0.05;
    const A = g.towns.arch(t);
    if (t.kind === 'tourism') k += 0.35; else if (t.kind === 'historic' || t.kind === 'mountain') k += 0.2; else if (t.kind === 'port') k += 0.1;
    for (const b of t.buildings) { if (b.arch === 'hotel') k += 0.06; else if (FUN.has(b.arch)) k += 0.05; }
    if (A.seasonal && g.env && g.env.season) { const se = g.env.season(); k *= se === 'summer' ? 1.3 : se === 'winter' ? 0.8 : 1; }
    // heritage trains, trams and boats draw day trippers
    if (g.fleet && g.fleet.heritageTowns().has(t.id)) k += 0.2;
    if (this.activeEvent(t, 'tourist_weekend')) k *= 1.5;
    return Math.min(1.5, k);
  }

  // ---------- events ----------
  activeEvent(t, kind = null) { const now = this.game.time; return this.events.find((e) => e.town === t.id && e.start <= now && now < e.end && (!kind || e.kind === kind)) || null; }
  // travellers × at a town (an event on)
  eventMul(t) { const e = this.activeEvent(t); return e ? TOWN_EVENTS[e.kind].mul : 1; }
  eventAttr(t) { const e = this.activeEvent(t); return e ? TOWN_EVENTS[e.kind].attr : 1; }
  upcoming() { const now = this.game.time; return this.events.filter((e) => e.end > now).sort((a, b) => a.start - b.start); }
  // once a month: maybe announce an event for next month
  monthly() {
    const g = this.game, m = g.ledger.monthIndex();
    this.events = this.events.filter((e) => e.end > g.time - MONTH_S * 2);
    const h = hashStr(`${g.world.seed}:ev:${m}`);
    if (h % 100 >= 45 || this.events.filter((e) => e.end > g.time).length >= 3) return;
    const cands = [];
    for (const t of g.towns.list) {
      if (!g.progression.regionUnlocked(t.region) || t.stage < 1) continue;
      const has = (a) => t.buildings.some((b) => b.arch === a);
      for (const k in TOWN_EVENTS) {
        const E = TOWN_EVENTS[k];
        if (E.need && !has(E.need)) continue;
        if (E.stage && t.stage < E.stage) continue;
        if (E.tourist && !(t.tourist || t.kind === 'tourism')) continue;
        if (this.events.some((e) => e.town === t.id && e.end > g.time)) continue;
        cands.push({ t, k });
      }
    }
    if (!cands.length) return;
    const pick = cands[(h >>> 8) % cands.length];
    const start = (m + 1) * MONTH_S, ev = { id: this.seq++, kind: pick.k, town: pick.t.id, start, end: start + MONTH_S };
    this.events.push(ev);
    g.events.emit('townEvent', ev, pick.t);
  }

  // ---------- once a month: passengers by node, district changes ----------
  monthClose() {
    const g = this.game;
    const nodes = g.roads ? g.stations.list.concat(g.roads.stops) : g.stations.list;
    for (const s of nodes) { const tot = (s.delivered || 0) + (s.picked || 0); s.mPax = Math.max(0, tot - (s._mTot ?? tot)); s._mTot = tot; }
    for (const t of g.towns.list) {
      if (!g.progression.regionUnlocked(t.region) || !t.buildings.length) continue;
      const cur = {};
      for (const d of this.districts(t)) cur[d.q] = d.kind;
      const old = this.hist[t.id];
      if (old) for (const q in cur) if (old[q] && old[q] !== cur[q] && cur[q] !== 'residential') g.events.emit('districtEvolved', t, old[q], cur[q], q);
      this.hist[t.id] = cur;
    }
    this.invalidate();
    this.monthly();
  }
  tick() {
    const g = this.game, m = g.ledger ? g.ledger.monthIndex() : 0;
    if (this._month == null) { this._month = m; return; }
    if (m !== this._month) { this._month = m; this.monthClose(); }
  }

  // ---------- save ----------
  serialize() {
    return { seq: this.seq, events: this.events.map((e) => ({ id: e.id, kind: e.kind, town: e.town, start: Math.round(e.start), end: Math.round(e.end) })), hist: this.hist };
  }
  deserialize(d) {
    if (!d || typeof d !== 'object') return;
    this.seq = Math.max(1, d.seq | 0);
    this.events = (Array.isArray(d.events) ? d.events : []).filter((e) => e && TOWN_EVENTS[e.kind] && Number.isFinite(e.start) && Number.isFinite(e.end) && this.game.towns.byId(e.town)).slice(-12);
    this.hist = {};
    if (d.hist && typeof d.hist === 'object') for (const k in d.hist) { const h = d.hist[k]; if (h && typeof h === 'object') { const o = {}; for (const q in h) if (DISTRICTS.includes(h[q])) o[q] = h[q]; this.hist[k] = o; } }
  }
}
