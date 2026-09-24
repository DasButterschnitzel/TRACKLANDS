// Passenger flows: destinations, transfers and service frequency.
//
// Waiting passengers are either "open" (they ride to wherever the next train
// takes them: the legacy behaviour and how every passenger starts) or bound
// for a destination after changing trains (stn.paxTo[destId], always a subset
// of stn.stock.PASSENGERS). When open passengers board a train that runs a
// timetable (manual route), they pick a destination among the stops ahead, or
// a stop on a connecting line reached by changing trains at a stop ahead,
// weighted by how big the destination is. Passengers changing trains alight at
// the transfer station and wait there for a train that serves their
// destination. Every leg pays by its own distance. Frequent, well-connected
// stations attract more passengers from their towns.
//
// Cargo lots carry the optional fields `to` (destination station id) and `via`
// (transfer station id). Lots without `to` behave exactly as before, so saves
// from older versions and trains without a timetable are unaffected.

const PAX = 'PASSENGERS';
const WINDOW = 600;          // seconds of arrivals that count toward service frequency
const TRANSFER_W = 0.45;     // appeal of a destination that needs a change of trains
const MAX_DEST = 10;         // destinations considered per boarding
const FREQ_FULL = 6;         // arrivals per window for the full frequency bonus

export class PaxFlow {
  constructor(game) {
    this.game = game;
    this._lines = null; this._t = -1;
    this._maintT = 0;
  }

  // ---------- lines (timetabled trains) ----------
  invalidate() { this._lines = null; }

  // { list: [{ id, stops: [{ st, drop, board }] }], at: Map<stId, line[]> }
  lines() {
    const g = this.game;
    if (this._lines && g.time >= this._t && g.time - this._t < 2) return this._lines;
    const S = g.stations;
    const list = [], at = new Map();
    for (const t of g.trains.trains) {
      if (t.mode !== 'manual' || !t.route || t.route.length < 2) continue;
      const stops = [];
      for (const r of t.route) {
        if (r.skip || r.st == null || !S.byId(r.st)) continue;
        stops.push({ st: r.st, drop: r.act !== 'load' && r.act !== 'none', board: r.act !== 'unload' && r.act !== 'none' });
      }
      if (new Set(stops.map((s) => s.st)).size < 2) continue;
      const line = { id: t.id, stops };
      list.push(line);
      for (const s of new Set(stops.map((x) => x.st))) { if (!at.has(s)) at.set(s, []); at.get(s).push(line); }
    }
    this._lines = { list, at };
    this._t = g.time;
    return this._lines;
  }

  // Stops ahead of a train that is standing at station `fromId`, in order,
  // until the route returns to that station.
  ahead(t, fromId) {
    const S = this.game.stations;
    const R = t.route, n = R.length;
    if (!n) return [];
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

  // how attractive a destination is: grows with the size of the towns it serves
  appeal(id) {
    const g = this.game, s = g.stations.byId(id);
    if (!s || !s.links) return 1;
    let a = 1;
    for (const tid of s.links.towns || []) { const tw = g.towns.byId(tid); if (tw) a += Math.log2(1 + tw.pop / 250); }
    return a;
  }

  // Destinations for open passengers boarding train t at station stn.
  destinations(t, stn) {
    if (t.mode !== 'manual') return [];
    const ahead = this.ahead(t, stn.id);
    const cands = [], direct = new Set();
    for (const a of ahead) if (a.drop && this.acceptsPax(a.st)) { direct.add(a.st); cands.push({ to: a.st, via: null, w: this.appeal(a.st) }); }
    const L = this.lines(), taken = new Set(direct);
    for (const a of ahead) {
      if (!a.drop) continue;
      for (const line of L.at.get(a.st) || []) {
        if (line.id === t.id) continue;
        if (!line.stops.some((s) => s.st === a.st && s.board)) continue;
        for (const s of line.stops) {
          if (!s.drop || s.st === stn.id || s.st === a.st || taken.has(s.st) || !this.acceptsPax(s.st)) continue;
          taken.add(s.st);
          cands.push({ to: s.st, via: a.st, w: this.appeal(s.st) * TRANSFER_W });
        }
      }
    }
    cands.sort((x, y) => y.w - x.w || x.to - y.to);
    return cands.slice(0, MAX_DEST);
  }

  open(stn) { return Math.max(0, Math.floor((stn.stock[PAX] || 0) - this.tagged(stn))); }
  tagged(stn) { let n = 0; if (stn.paxTo) for (const k in stn.paxTo) n += stn.paxTo[k]; return n; }

  // How many waiting passengers may board train t here.
  boardable(t, stn) {
    let n = this.open(stn);
    if (t.mode === 'manual' && stn.paxTo) {
      const ahead = new Set(this.ahead(t, stn.id).filter((a) => a.drop).map((a) => a.st));
      for (const k in stn.paxTo) if (ahead.has(+k)) n += stn.paxTo[k];
    }
    return Math.floor(n);
  }

  // Take n passengers from the station into lots: first those already bound
  // for a stop ahead, then open passengers who choose a destination now.
  board(t, stn, n) {
    const lots = [];
    if (n <= 0) return lots;
    if (t.mode === 'manual' && stn.paxTo) {
      const ahead = new Set(this.ahead(t, stn.id).filter((a) => a.drop).map((a) => a.st));
      const keys = Object.keys(stn.paxTo).map(Number).filter((k) => ahead.has(k)).sort((a, b) => stn.paxTo[b] - stn.paxTo[a] || a - b);
      for (const k of keys) {
        if (n <= 0) break;
        const m = Math.min(n, Math.floor(stn.paxTo[k]));
        if (m <= 0) continue;
        stn.paxTo[k] -= m;
        if (stn.paxTo[k] <= 0) delete stn.paxTo[k];
        lots.push({ c: PAX, n: m, from: stn.id, to: k });
        n -= m;
      }
    }
    if (n <= 0) return lots;
    const d = this.destinations(t, stn);
    if (!d.length) { lots.push({ c: PAX, n, from: stn.id }); return lots; }
    // largest remainder split by appeal (deterministic)
    const W = d.reduce((a, x) => a + x.w, 0);
    const parts = d.map((x) => { const q = (n * x.w) / W; return { x, k: Math.floor(q), r: q - Math.floor(q) }; });
    let left = n - parts.reduce((a, p) => a + p.k, 0);
    [...parts].sort((a, b) => b.r - a.r || a.x.to - b.x.to).forEach((p) => { if (left > 0) { p.k++; left--; } });
    for (const p of parts) if (p.k > 0) lots.push(p.x.via != null ? { c: PAX, n: p.k, from: stn.id, to: p.x.to, via: p.x.via } : { c: PAX, n: p.k, from: stn.id, to: p.x.to });
    return lots;
  }

  // Passengers changing trains at stn: they wait here for their next train.
  // Returns how many got off (the station may be full).
  transferIn(t, stn, lot) {
    const g = this.game, S = g.stations;
    const took = S.receive(stn, PAX, lot.n);
    if (took <= 0) return 0;
    if (!stn.paxTo) stn.paxTo = {};
    stn.paxTo[lot.to] = (stn.paxTo[lot.to] || 0) + took;
    const from = S.byId(lot.from);
    const rev = Math.round(g.economy.revenue(PAX, took, g.economy.distTiles(from, stn), t, false));
    g.economy.bookDelivery(rev, PAX, took, t, from, stn);
    t.earned += rev;
    g.economy.bucket.income += rev;
    S.noteTransfer(stn, PAX, took);
    g.stats.inc('paxTransfers', took);
    g.economy.onTransfer(took);
    return took;
  }

  untag(lot) { delete lot.to; delete lot.via; }

  // Lots whose destination or transfer point this train no longer serves ride
  // on as open passengers (the legacy rules deliver them).
  validate(t) {
    const S = this.game.stations;
    let ids = null;
    for (const lot of t.cargo) {
      if (lot.to == null) continue;
      if (t.mode !== 'manual' || !S.byId(lot.to)) { this.untag(lot); continue; }
      if (!ids) ids = new Set(t.route.filter((r) => !r.skip && r.st != null).map((r) => r.st));
      if (lot.via != null && (!S.byId(lot.via) || !ids.has(lot.via))) { if (ids.has(lot.to)) delete lot.via; else this.untag(lot); }
      else if (lot.via == null && !ids.has(lot.to)) this.untag(lot);
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

  // every destination reachable from stn: direct or with one change
  connections(stn) {
    const L = this.lines();
    const out = new Map();
    const mine = (L.at.get(stn.id) || []).filter((l) => l.stops.some((s) => s.st === stn.id && s.board));
    for (const l of mine) for (const s of l.stops) if (s.drop && s.st !== stn.id && this.acceptsPax(s.st)) out.set(s.st, { st: s.st, via: null, line: l.id });
    for (const l of mine) for (const x of l.stops) {
      if (!x.drop || x.st === stn.id) continue;
      for (const l2 of L.at.get(x.st) || []) {
        if (l2 === l || !l2.stops.some((s) => s.st === x.st && s.board)) continue;
        for (const s of l2.stops) if (s.drop && s.st !== stn.id && s.st !== x.st && !out.has(s.st) && this.acceptsPax(s.st)) out.set(s.st, { st: s.st, via: x.st, line: l2.id });
      }
    }
    return [...out.values()];
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
    this._maintT -= dt;
    if (this._maintT > 0) return;
    this._maintT = 3;
    const S = this.game.stations;
    this.invalidate();
    const L = this.lines();
    for (const s of S.list) {
      s._conn = this.connections(s).length;
      s._paxMul = this.demandMul(s);
      if (!s.paxTo) continue;
      // destinations nobody here serves any more: those passengers take any train
      const served = new Set();
      for (const l of L.at.get(s.id) || []) if (l.stops.some((x) => x.st === s.id && x.board)) for (const x of l.stops) if (x.drop) served.add(x.st);
      for (const k of Object.keys(s.paxTo)) {
        const v = s.paxTo[k];
        if (!(v > 0) || !isFinite(v) || !S.byId(+k) || !served.has(+k) || +k === s.id) delete s.paxTo[k];
        else s.paxTo[k] = Math.floor(v);
      }
      this.clamp(s);
    }
  }

  // tagged passengers can never exceed the waiting total
  clamp(s) {
    if (!s.paxTo) return;
    let over = this.tagged(s) - Math.floor(s.stock[PAX] || 0);
    if (over > 0) for (const k of Object.keys(s.paxTo).sort((a, b) => s.paxTo[a] - s.paxTo[b])) {
      const m = Math.min(over, s.paxTo[k]);
      s.paxTo[k] -= m; over -= m;
      if (s.paxTo[k] <= 0) delete s.paxTo[k];
      if (over <= 0) break;
    }
    if (!Object.keys(s.paxTo).length) delete s.paxTo;
  }
}

export { PAX };
