// Lines: timetabled trains (manual routes) that call at the same stations in
// the same order form a line. Lines are derived from routes, never stored, so
// they need no save data. They drive departure spacing (timetables), the lines
// list, the route overview in the train inspector and the schematic map.

const COLORS = ['#e0463c', '#2f8fd8', '#3fae5a', '#e9a23b', '#8a5ab0', '#1fb3a3', '#d05a9a', '#6b7a8f', '#b5773a', '#4a5fd0', '#8fb339', '#c9483a'];
export const SPACING_CHOICES = [0, -1, 60, 120, 180, 300, 600];   // 0 off, -1 even spacing, else seconds

export class Lines {
  constructor(game) {
    this.game = game;
    this._c = null; this._t = -1; this._v = -1;
    this.dep = new Map();        // line key -> last departure time from its timing point
    this.version = 0;            // bump when routes change (UI edits)
  }

  // station stops of a route (skipped stops and waypoints are not part of the line identity)
  stops(t) {
    const S = this.game.stations;
    return t.route.filter((r) => !r.skip && r.st != null && S.byId(r.st)).map((r) => r.st);
  }
  // rotation-invariant key: A→B→C, B→C→A and C→A→B are the same line
  keyOf(stops) {
    if (stops.length < 2) return null;
    let best = null;
    for (let i = 0; i < stops.length; i++) {
      const rot = stops.slice(i).concat(stops.slice(0, i)).join('>');
      if (best === null || rot < best) best = rot;
    }
    return best;
  }

  list() {
    const g = this.game;
    if (this._c && this._v === this.version && g.time >= this._t && g.time - this._t < 1) return this._c;
    const map = new Map();
    for (const t of g.trains.trains) {
      if (t.mode !== 'manual') continue;
      const st = this.stops(t);
      const key = this.keyOf(st);
      if (!key) continue;
      if (!map.has(key)) map.set(key, { key, stops: key.split('>').map(Number), trains: [] });
      map.get(key).trains.push(t);
    }
    const out = [...map.values()].sort((a, b) => Math.min(...a.trains.map((t) => t.id)) - Math.min(...b.trains.map((t) => t.id)));
    out.forEach((l, i) => { l.color = COLORS[i % COLORS.length]; l.idx = i; });
    this._c = out; this._t = g.time; this._v = this.version;
    return out;
  }
  of(t) { return this.list().find((l) => l.trains.includes(t)) || null; }
  name(line) {
    const S = this.game.stations;
    const n = line.stops.map((id) => (S.byId(id) || {}).name || '?');
    return n.length > 3 ? `${n[0]} – … – ${n[n.length - 1]}` : n.join(' – ');
  }

  // measured seconds between trains of the line (round trip / trains), or 0
  headway(line) {
    const cyc = line.trains.map((x) => x.cycleEma || 0).filter((c) => c > 0);
    return cyc.length ? cyc.reduce((a, b) => a + b, 0) / cyc.length / line.trains.length : 0;
  }

  // income per minute of a line's trains (from their recent earnings)
  income(line) { return line.trains.reduce((a, t) => a + (t.incomeEma || 0), 0); }

  // ---------- departure spacing ----------
  // route index of the timing point: the first station stop of the route
  timingIdx(t) { return t.route.findIndex((r) => !r.skip && r.st != null && this.game.stations.byId(r.st)); }

  // seconds between departures from the timing point (0 = no timetable)
  interval(t) {
    if (t.mode !== 'manual' || !t.spacing) return 0;
    if (t.spacing > 0) return t.spacing;
    const L = this.of(t);
    if (!L || L.trains.length < 2) return 0;
    return this.headway(L);
  }

  // may train t leave the stop it just served? (only the timing point waits)
  holdFor(t) {
    const iv = this.interval(t);
    if (!iv || t.servedIdx == null || t.servedIdx !== this.timingIdx(t)) return 0;
    const key = this.keyOf(this.stops(t));
    const last = this.dep.get(key);
    if (last == null || last > this.game.time) return 0;
    return Math.max(0, Math.min(iv, last + iv - this.game.time));
  }

  noteDeparture(t) {
    if (t.mode !== 'manual' || t.servedIdx == null || t.servedIdx !== this.timingIdx(t)) return;
    const now = this.game.time;
    const key = this.keyOf(this.stops(t));
    if (key) this.dep.set(key, now);
    // round trip without the time spent waiting for the timetable, so even
    // spacing converges on the real headway instead of feeding on itself
    if (t.lastTP != null && now > t.lastTP) {
      const c = Math.max(1, now - t.lastTP - (t.ttHeld || 0));
      t.cycleEma = t.cycleEma ? t.cycleEma * 0.7 + c * 0.3 : c;
    }
    t.lastTP = now; t.ttHeld = 0;
  }
}
