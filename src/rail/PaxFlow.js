// Passenger flows: trips, destinations, transfers and service frequency.
//
// Travellers are made by the towns (Towns.tick) and wait at the stations and
// stops that reach them. Every few seconds the open travellers at a node are
// given a trip (Phase 7): a purpose (commute, shopping, education, leisure,
// tourism, business, intercity) by the town they come from, and a
// destination among the places the company's timetabled services reach from
// here (TransportNetwork.reach: any mix of bus, tram, train, ferry and air,
// with changes and walks between stops). Each purpose is drawn by what the
// destination offers (jobs, shops, a university, landmarks, hotels …) and
// how long the trip takes, generalised: waiting, riding (by the mode's
// comfort) and every change count; beyond a purpose's limit nobody makes
// that trip. People who could go nowhere keep waiting "open".
//
// A traveller with a destination only boards a vehicle that takes them there
// or to a good place to change (no worse than a quarter above the best
// journey from here), gets off there, and waits for the next leg. Trains
// without a timetable ("auto") serve open travellers: at a station they call
// at, their share of the arrivals stays open for them (and a bus stop that
// feeds such a station sends some of its travellers there, see gateway).
// Payment is by the whole journey when they arrive (CargoFlows.settle).
//
// Lots carry `to` (where this vehicle drops them: their destination or a
// change) and `fd` (their destination node); older lots with `via` are read as
// to = via, fd = to.
import { cheb } from '../util.js';
import { CARGO } from '../config.js';
import { nodeKey, RS } from '../economy/Network.js';
import { PURPOSES, PURPOSE_IDS } from '../economy/Flows.js';

const PAX = 'PASSENGERS';
const WINDOW = 600;          // seconds of arrivals that count toward service frequency
const FREQ_FULL = 6;         // arrivals per window for the full frequency bonus
const MIN_HOP = 3;           // a trip within one town shorter than this is no trip
const DETOUR = 1.25, DETOUR_S = 20;   // a change is taken when no worse than this
const GATEWAY_W = 0.35;      // bus/tram travellers heading for a station with trains without a timetable
const ASSIGN_DT = 0.5;       // seconds between assignment rounds (a slice of nodes each)
const MAX_DEST = 24;         // destinations considered per node

// building attraction by purpose (per building; landmarks count extra)
const B_ATTR = {
  shop: { shops: 6, jobs: 6 }, office: { jobs: 120, biz: 60 }, glasstower: { jobs: 260, biz: 140 }, skyscraper: { jobs: 200, biz: 90 },
  factory: { jobs: 60 }, warehouse: { jobs: 20 }, boathouse: { jobs: 25, leisure: 4 }, farmhouse: { jobs: 3 },
  civic: { jobs: 10, edu: 6, biz: 6 }, plaza: { shops: 4, leisure: 6 }, hotel: { jobs: 40, tour: 30, biz: 10 },
  market_hall: { shops: 30, jobs: 30, tour: 6 }, university: { edu: 120, jobs: 80 }, museum: { leisure: 30, tour: 30, jobs: 20 },
  cathedral: { leisure: 20, tour: 40 }, monument: { leisure: 10, tour: 25 }, stadium: { leisure: 60, jobs: 30 }, clocktower: { leisure: 8, tour: 10 },
  tv_tower: { leisure: 10, tour: 15 }, park: { leisure: 25 }, convention: { biz: 80, jobs: 60, tour: 10 }, lighthouse: { tour: 20, leisure: 6 },
};
const POP = { cottage: 3, house: 5, house2: 8, townhouse: 14, apartment: 40, block: 80, tower: 160, skyscraper: 300, terrace: 20, chalet: 6, farmhouse: 5, hotel: 30, glasstower: 60, bungalow: 4, university: 40 };
// how the town's make-up shifts what trips its people make
const ARCH_MIX = {
  university: { education: 2.2 }, tourism: { leisure: 1.4, tourism: 2 }, tech: { business: 1.5, commute: 1.1 }, commuter: { commute: 1.3 },
  industrial: { commute: 1.25, shopping: 0.9 }, historic: { tourism: 1.5, leisure: 1.2 }, port: { business: 1.2 }, market: { shopping: 1.4 },
  mountain: { tourism: 1.4, leisure: 1.2, intercity: 0.8 }, railway: { intercity: 1.3, commute: 1.1 },
};

export class PaxFlow {
  constructor(game) {
    this.game = game;
    this._maintT = 0;
    this._rr = 0;             // round-robin position of the assignment rounds
    this._assignT = 0;
    this._attr = new Map();   // town id -> {n, a}
    this.served = { trips: 0, open: 0 };
    this.unserved = new Map(); // town id -> travellers per purpose with nowhere to go (last minute)
  }
  get net() { return this.game.network; }
  get flows() { return this.game.flows; }

  invalidate() { if (this.net) this.net.invalidate(); }

  // ---------- routes of a train ----------
  // Stops ahead of a train that is standing at station `fromId`, in order,
  // until the route returns to that station.
  ahead(t, fromId) {
    const S = this.game.stations;
    const R = t.route, n = R.length;
    if (!n || t.mode !== 'manual') return [];
    let p = (t.routeIdx - 1 + n) % n;
    if (!R[p] || R[p].st !== fromId) { p = R.findIndex((r) => r.st === fromId); if (p < 0) p = (t.routeIdx - 1 + n) % n; }
    const out = [], seen = new Set();
    for (let k = 1; k < n; k++) {
      const r = R[(p + k) % n];
      if (!r || r.skip || r.st == null || !S.byId(r.st)) continue;
      if (r.st === fromId) break;
      if (seen.has(r.st)) continue;
      seen.add(r.st);
      out.push({ st: r.st, drop: r.act !== 'load' && r.act !== 'none' });
    }
    return out;
  }
  acceptsPax(id) { const s = this.game.stations.byId(id); return !!s && this.game.stations.accepts(s, PAX); }

  // ---------- what places offer ----------
  townAttr(t) {
    const c = this._attr.get(t.id);
    if (c && c.n === t.buildings.length && c.s === t.stage) return c.a;
    const a = { jobs: 4, shops: 2, edu: 0.5, leisure: 2, tour: t.tourist ? 20 : 0.5, biz: 1, pop: 10 };
    for (const b of t.buildings) {
      const x = B_ATTR[b.arch];
      if (x) for (const k in x) a[k] += x[k];
      a.pop += POP[b.arch] || 0;
    }
    a.pop = Math.max(a.pop, t.pop * 0.3);
    if (t.kind === 'tourism' || t.kind === 'historic') a.tour += 25 + t.stage * 10;
    this._attr.set(t.id, { n: t.buildings.length, s: t.stage, a });
    return a;
  }
  // what a node offers: the towns it reaches, shared with the other nodes in them
  nodeAttr(k) {
    const g = this.game, o = this.net.obj(k);
    const out = { jobs: 1, shops: 1, edu: 0.3, leisure: 1, tour: 0.3, biz: 0.5, pop: 5 };
    if (!o || !o.links) return out;
    for (const id of o.links.towns || []) {
      const t = g.towns.byId(id);
      if (!t) continue;
      const a = this.townAttr(t);
      const sts = t._sts ? t._sts.filter((s) => !s.owner && (!s.road || s.kind === 'bus' || s.kind === 'tram' || s.kind === 'dock' || s.kind === 'airport')).length : 1;
      const share = 1 / Math.max(1, sts);
      for (const x in out) out[x] += a[x] * share;
    }
    return out;
  }
  // the purposes of the trips people at this node make (shares, sum 1)
  mix(k) {
    const g = this.game, o = this.net.obj(k);
    const m = {};
    for (const p of PURPOSE_IDS) m[p] = PURPOSES[p].share;
    const t = o && o.links && o.links.towns.length ? g.towns.byId(o.links.towns[0]) : null;
    if (t) { const a = ARCH_MIX[t.kind]; if (a) for (const p in a) m[p] *= a[p]; if (t.tourist) m.tourism *= 1.5; if (t.stage >= 4) m.business *= 1.2; }
    const s = Object.values(m).reduce((x, y) => x + y, 0);
    for (const p in m) m[p] /= s;
    return m;
  }

  // ---------- open travellers and the reserve for trains without a timetable ----------
  // stations only: how many of the recent arrivals were trains without a timetable
  autoShare(s) {
    if (s.road) return 0;
    const g = this.game, now = g.time;
    let a = 0, n = 0;
    for (const r of s.stats.recent) { if (now - r.time > WINDOW || now < r.time) continue; n++; const t = g.trains.byId(r.train); if (t && t.mode !== 'manual') a++; }
    if (n) return a / n;
    const svc = this.net ? this.net.svcs.find((x) => x.auto && x.hop.has(s.id)) : null;
    return svc ? 0.5 : 0;
  }
  // open travellers: waiting without a destination (plain stock and "any
  // train" packets)
  open(stn) { return Math.max(0, Math.floor((stn.stock[PAX] || 0) - this.tagged(stn))); }
  // travellers with a destination of their own
  tagged(stn) { let n = 0; if (stn.pk) for (const p of stn.pk) if (p.c === PAX && p.fd != null && !p.op) n += p.n; return n; }

  // Give open travellers at node s a trip (all but the reserve for trains
  // without a timetable). Returns how many got a destination.
  assign(s) {
    const g = this.game, F = this.flows, NW = this.net;
    if (!NW || !F) return 0;
    const fresh = F.fresh(s, PAX);
    if (fresh < 1) return 0;
    const reserve = Math.floor(fresh * this.autoShare(s));
    let n = fresh - reserve;
    if (n < 1) return 0;
    const k = nodeKey(s);
    const dests = this.destinations(k);
    if (!dests.list.length && !dests.gate) return 0;
    const parts = [];
    let sum = 0;
    for (const d of dests.list) sum += d.w;
    const gw = dests.gate ? (dests.list.length ? sum * GATEWAY_W : 1) : 0;
    const tot = sum + gw;
    if (tot <= 0) return 0;
    for (const d of dests.list) parts.push({ d, q: (n * d.w) / tot });
    if (gw > 0) parts.push({ d: { k: dests.gate, p: null, op: 1 }, q: (n * gw) / tot });
    // largest remainder (deterministic)
    let left = n;
    for (const x of parts) { x.k = Math.floor(x.q); x.r = x.q - x.k; left -= x.k; }
    parts.sort((a, b) => b.r - a.r || a.d.k - b.d.k);
    for (const x of parts) { if (left <= 0) break; x.k++; left--; }
    let made = 0;
    for (const x of parts) {
      if (x.k <= 0) continue;
      const p = { c: PAX, n: x.k, o: k, ot: s.tile, t0: g.time, fd: x.d.k };
      if (x.d.p) p.p = x.d.p;
      if (x.d.op) p.op = 1;
      F.addPacket(s, p);
      made += x.k;
    }
    this.served.trips += made;
    return made;
  }

  // Where travellers from node k go: every reachable node that takes
  // travellers (not the same place, not a short hop within one town),
  // weighted per purpose by what it offers and how long the trip takes.
  // gate: a station reached by rides/walks whose trains run without a
  // timetable (travellers go there to take any train).
  destinations(k) {
    const NW = this.net, g = this.game;
    const R = NW.reach(k, PAX);
    const o = NW.obj(k);
    const myTowns = o && o.links ? o.links.towns || [] : [];
    const mix = this.mix(k);
    const cands = [];
    let gate = null, gc = Infinity;
    for (const [d, r] of R) {
      if (d === k || !r.rides && !r.walk) continue;
      const od = NW.obj(d);
      if (!od) continue;
      // a station with trains without a timetable: a gateway to the railway
      if (!od.road && r.cost < gc && this.autoShare(od) > 0) { gate = d; gc = r.cost; }
      if (!r.rides || !NW.accepts(d, PAX)) continue;
      const dt = od.links ? od.links.towns || [] : [];
      if (myTowns.some((id) => dt.includes(id)) && cheb(o.tile, od.tile) < MIN_HOP) continue;
      cands.push({ k: d, r });
    }
    cands.sort((a, b) => a.r.cost - b.r.cost || a.k - b.k);
    const near = cands.slice(0, MAX_DEST);
    const list = [];
    const lost = {};
    for (const p of PURPOSE_IDS) {
      const P = PURPOSES[p];
      let ws = 0;
      const row = [];
      for (const c of near) {
        if (c.r.cost > P.max) continue;
        const a = this.nodeAttr(c.k)[P.attr] || 0;
        if (a <= 0) continue;
        let w = a * Math.exp(-c.r.cost / P.tau);
        if (P.near && c.r.cost < P.near) w *= 0.2;      // intercity: not the town next door
        if (w <= 0) continue;
        row.push({ k: c.k, p, w });
        ws += w;
      }
      if (ws <= 0) { lost[p] = mix[p]; continue; }
      for (const x of row) list.push({ k: x.k, p, w: (mix[p] * x.w) / ws });
    }
    // purposes nobody can serve from here (the town's unmet demand)
    if (myTowns.length) this.unserved.set(myTowns[0], lost);
    // the served purposes carry the whole volume (people still travel)
    return { list, gate: gate != null && gate !== k ? gate : null, lost };
  }

  // ---------- boarding ----------
  // Can a vehicle that drops at the stops `ahead` (Map node key -> seconds
  // in the vehicle) take this packet from node k? Returns the drop node key
  // (its destination or a change) or null.
  dropFor(k, fd, ahead) {
    if (fd == null || !ahead) return null;
    if (ahead.has(fd)) return fd;
    const NW = this.net;
    const best = NW.reach(k, PAX).get(fd);
    if (!best) return null;
    let bk = null, bc = Infinity;
    for (const [h, ivt] of ahead) {
      const r = NW.reach(h, PAX).get(fd);
      if (!r) continue;
      const c = ivt + r.cost;
      if (c < bc) { bc = c; bk = h; }
    }
    return bk != null && bc <= best.cost * DETOUR + DETOUR_S ? bk : null;
  }
  // a train's stops ahead from station stn as node keys with ride times
  trainAhead(t, stn) {
    const out = new Map();
    const svc = this.net ? this.net.svcOfTrain(t) : null;
    const hops = svc ? svc.hop.get(stn.id) : null;
    for (const a of this.ahead(t, stn.id)) if (a.drop) out.set(a.st, hops && hops.has(a.st) ? hops.get(a.st) : cheb(stn.tile, this.game.stations.byId(a.st).tile) * 1.5);
    return out;
  }

  // How many waiting travellers may board train t here.
  boardable(t, stn) {
    if (t.mode !== 'manual') return this.open(stn);
    this.assign(stn);
    const ahead = this.trainAhead(t, stn);
    const k = stn.id;
    let n = 0;
    if (stn.pk) for (const p of stn.pk) if (p.c === PAX && (p.fd == null || p.op || this.dropFor(k, p.fd, ahead) != null)) n += p.n;
    n += this.flows.fresh(stn, PAX);
    return Math.floor(n);
  }

  // Take n travellers from the station onto train t: those heading somewhere
  // this train takes them (to their destination or a change), then open
  // travellers, who pick a destination among the stops ahead.
  board(t, stn, n) {
    const F = this.flows;
    if (n <= 0) return [];
    if (t.mode !== 'manual') {
      // trains without a timetable: open travellers (any train) only
      return F.take(stn, PAX, n, { accept: (p) => p.fd == null || p.op }).map((l) => { delete l.fd; delete l.op; delete l.p; return l; });
    }
    this.assign(stn);
    const ahead = this.trainAhead(t, stn);
    const k = stn.id;
    const lots = [];
    const took = F.take(stn, PAX, n, { accept: (p) => p.fd != null && !p.op && this.dropFor(k, p.fd, ahead) != null, fresh: false });
    for (const l of took) { l.to = this.dropFor(k, l.fd, ahead); lots.push(l); n -= l.n; }
    if (n <= 0) return lots;
    // open travellers ride to a stop ahead (by how much it offers)
    const open = F.take(stn, PAX, n, { accept: (p) => p.fd == null || p.op });
    const dests = [...ahead.keys()].filter((id) => this.acceptsPax(id));
    for (const l of open) {
      delete l.op;
      if (!dests.length) { lots.push(l); continue; }
      const w = dests.map((id) => ({ id, w: 1 + Math.log2(1 + this.nodeAttr(id).pop / 250) }));
      const W = w.reduce((a, x) => a + x.w, 0);
      let left = l.n;
      const parts = w.map((x) => { const q = (l.n * x.w) / W; return { id: x.id, k: Math.floor(q), r: q - Math.floor(q) }; });
      left -= parts.reduce((a, p) => a + p.k, 0);
      [...parts].sort((a, b) => b.r - a.r || a.id - b.id).forEach((p) => { if (left > 0) { p.k++; left--; } });
      for (const p of parts) if (p.k > 0) lots.push({ ...l, n: p.k, to: p.id, fd: p.id });
    }
    return lots;
  }

  // Travellers changing at stn (legacy name): they wait here for their next
  // vehicle. Returns how many got off (the station may be full).
  transferIn(t, stn, lot) {
    const S = this.game.stations;
    return this.flows.drop(stn, lot, { type: 'train', id: t.id }, S.byId(lot.from), 'rail', 1);
  }

  untag(lot) { delete lot.to; delete lot.via; }

  // Lots whose drop point this train no longer serves: they ride on as open
  // passengers (the legacy rules deliver them); older lots (to + via) become
  // to = via, fd = to.
  validate(t) {
    const S = this.game.stations;
    let ids = null;
    for (const lot of t.cargo) {
      if (lot.via != null) { if (lot.fd == null) lot.fd = lot.to; lot.to = lot.via; delete lot.via; }
      if (lot.to == null) continue;
      if (t.mode !== 'manual' || !S.byId(lot.to)) { this.untag(lot); continue; }
      if (!ids) ids = new Set(t.route.filter((r) => !r.skip && r.st != null).map((r) => r.st));
      if (!ids.has(lot.to)) { if (lot.fd != null && ids.has(lot.fd)) lot.to = lot.fd; else this.untag(lot); }
    }
  }

  // ---------- frequency & connectivity ----------
  arrivals(stn) {
    const now = this.game.time;
    let n = 0;
    for (const r of stn.stats.recent) if (now - r.time < WINDOW && now >= r.time) n++;
    return n;
  }
  // average minutes between trains, or null without regular service
  interval(stn) {
    const n = this.arrivals(stn);
    return n >= 2 ? WINDOW / 60 / n : null;
  }

  // every station reachable from stn by timetabled services (rail and road):
  // [{ st, via (the first change, or null), cost, xfers }]
  connections(stn) {
    const NW = this.net;
    if (!NW) return [];
    const k = nodeKey(stn);
    const R = NW.reach(k, PAX);
    const out = [];
    for (const [d, r] of R) {
      if (d === k || !r.rides || d >= RS || !NW.accepts(d, PAX)) continue;
      // the first change: the end of the first ride when the trip needs more
      let via = null;
      if (r.xfers > 0 && r.first && !r.first.walk) via = r.first.to;
      out.push({ st: d, via: via != null && via < RS && via !== d ? via : null, cost: Math.round(r.cost), xfers: r.xfers });
    }
    return out.sort((a, b) => a.cost - b.cost || a.st - b.st);
  }

  // passenger generation multiplier for a station: service frequency and
  // the number of places it connects to (neutral before any train calls)
  demandMul(stn) {
    const n = this.arrivals(stn);
    if (!n) return 1;
    const freq = 0.9 + 0.35 * Math.min(1, n / FREQ_FULL);
    const k = stn._conn != null ? stn._conn : 0;
    return freq + Math.min(0.2, Math.max(0, k - 1) * 0.04);
  }
  townMul(sts) {
    let m = 0;
    for (const s of sts) m = Math.max(m, s._paxMul || 1);
    return m || 1;
  }

  // ---------- upkeep ----------
  tick(dt) {
    const g = this.game, S = g.stations;
    // trips for open travellers, a slice of the nodes at a time
    this._assignT -= dt;
    if (this._assignT <= 0 && this.net) {
      this._assignT = ASSIGN_DT;
      const nodes = g.roads ? S.list.concat(g.roads.stops.filter((s) => !s.owner)) : S.list;
      const per = Math.max(6, Math.ceil(nodes.length / 4));
      for (let i = 0; i < Math.min(per, nodes.length); i++) {
        const s = nodes[(this._rr + i) % nodes.length];
        if (s && (s.stock[PAX] || 0) >= 1) this.assign(s);
      }
      this._rr = nodes.length ? (this._rr + per) % nodes.length : 0;
    }
    this._maintT -= dt;
    if (this._maintT > 0) return;
    this._maintT = 3;
    for (const s of S.list) {
      s._conn = this.net ? this.connections(s).length : 0;
      s._paxMul = this.demandMul(s);
      this.clamp(s);
    }
  }

  // packets can never exceed the waiting total
  clamp(s) { if (this.flows) this.flows.clamp(s); }
}

export { PAX, CARGO };
