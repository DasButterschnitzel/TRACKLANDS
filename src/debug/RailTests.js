// Automated railway test scenarios. They build small networks on a fresh world
// (use a new game; they spend money and unlock regions), run the simulation
// with fixed steps and check invariants: no two trains share a lane key, no
// two train bodies overlap geometrically, no NaN positions, and every train
// keeps making trips. Run from the console: __tracklands.game.runRailTests()
// or open index.html?railtest.
import { N, idx, tx, tz, step, clamp } from '../util.js';
import { K_NORMAL } from '../rail/RailNetwork.js';
import { parseConsist } from '../trains/Consist.js';

const E = 0, S = 2, W = 4, Nn = 6;

// Motion invariant: the train moves only along its own rails. A body point
// seen at the previous check must lie, on the current lane geometry, exactly
// where the train was `run` metres ago. Any sideways slide, jump or change of
// the geometry under a moving or standing train breaks this.
export function motionCheck(T, t, tmp) {
  const L = T.trainLength(t);
  const offs = [0.3, L / 2, Math.max(0.3, L - 0.3)];
  const ss0 = t.ss[0] || 0;
  // points still behind the start of the trail (emerging from a depot) are not tracked
  const cur = offs.map((d) => { if (t.s - d < ss0 + 0.02) return null; T.lanePoint(t, t.s - d, tmp); return [tmp.x, tmp.z]; });
  const prev = t._mv;
  t._mv = { pts: cur, odo: t.odo || 0, flips: t.flips || 0, placed: t.placed || 0, veh: t.veh.length, xoDone: t.xoDone || 0, nv: T.net.version, L };
  // (a network edit may reshape the track under a train: it moves with its rails)
  if (!prev || prev.nv !== T.net.version || Math.abs(prev.L - L) > 1e-6 || prev.flips !== (t.flips || 0) || prev.placed !== (t.placed || 0) || prev.veh !== t.veh.length || prev.xoDone !== (t.xoDone || 0)) return null;
  const run = (t.odo || 0) - prev.odo;
  for (let i = 0; i < offs.length; i++) {
    const was = t.s - offs[i] - run;
    if (!prev.pts[i] || was < ss0 + 0.02) continue;
    T.lanePoint(t, was, tmp);
    const d = Math.hypot(tmp.x - prev.pts[i][0], tmp.z - prev.pts[i][1]);
    if (d > 0.04) return `${t.name}#${t.id} ${t.state} point ${i} off its path by ${d.toFixed(2)} (ran ${run.toFixed(2)}) xo=${JSON.stringify(t.xo)} s=${t.s.toFixed(2)} ss0=${ss0.toFixed(2)} L=${L.toFixed(2)} head=${t.steps[T.stepAt(t, t.s)].tile}`;
  }
  return null;
}

export class RailTests {
  constructor(game) {
    this.g = game;
    this.used = new Set();
    this.log = [];
  }

  free(i) {
    const net = this.g.net;
    // test worlds are disposable: towns/industries may be overbuilt, water and mountains may not
    return i >= 0 && !this.used.has(i) && !net.conn[i] && !net.special.has(i) && net.kind(i) === K_NORMAL && !this.g.decor.at(i);
  }
  // find a w×h rectangle of free tiles (with a 1 tile margin)
  findArea(w, h) {
    for (let z0 = 2; z0 < N - h - 2; z0++) for (let x0 = 2; x0 < N - w - 2; x0++) {
      let ok = true;
      for (let z = z0 - 1; z <= z0 + h && ok; z++) for (let x = x0 - 1; x <= x0 + w && ok; x++) if (!this.free(idx(x, z))) ok = false;
      if (ok) {
        for (let z = z0 - 1; z <= z0 + h; z++) for (let x = x0 - 1; x <= x0 + w; x++) { const i = idx(x, z); this.used.add(i); this.g.occupancy.blocked[i] = 0; }
        return { x0, z0 };
      }
    }
    return null;
  }
  line(x0, z0, x1, z1, single) {
    const net = this.g.net;
    const dx = Math.sign(x1 - x0), dz = Math.sign(z1 - z0);
    const d = dx > 0 ? E : dx < 0 ? W : dz > 0 ? S : Nn;
    let x = x0, z = z0;
    while (x !== x1 || z !== z1) {
      const i = idx(x, z);
      net.connect(i, d);
      if (single) { net.single[i] = 1; net.single[step(i, d)] = 1; }
      x += dx; z += dz;
    }
  }
  station(x, z) { const r = this.g.stations.build(idx(x, z)); if (r.error) throw new Error('station ' + r.error); return r.station; }
  depot(x, z) { const r = this.g.stations.buildDepot(idx(x, z)); if (r.error) throw new Error('depot ' + r.error); return r.depot; }
  train(cons, depot, stops, opts = {}) {
    const g = this.g;
    const r = g.trains.buy(parseConsist(cons), depot);
    if (r.error) throw new Error('train ' + r.error);
    const t = r.train;
    t.mode = 'manual';
    t.route = stops.map((s) => ({ st: s.id, act: opts.act || 'none', dwell: opts.dwell ?? 1, full: false, skip: false, plat: null, cargo: null }));
    return t;
  }
  finish() { const g = this.g; g.net.bumpVersion(); g.railView.markAll(); g.trains.onNetworkChanged(false); }

  // run the simulation, checking invariants
  run(seconds, dt = 1 / 30, trains) {
    const g = this.g, T = g.trains;
    const res = { keyConflicts: 0, overlaps: 0, nan: 0, maxWait: 0 };
    const c0 = T.collisions;
    const steps = Math.round(seconds / dt);
    const v = { x: 0, y: 0, z: 0 };
    const tmp = new (g.scene.position.constructor)();
    for (let i = 0; i < steps; i++) {
      g.tick(dt);
      if (i % Math.max(1, Math.round(0.25 / dt)) !== 0) continue;
      // geometric check: sample points along each body (with lane offset)
      const pts = [];
      for (const t of trains) {
        if (!t.steps.length || t.state === 'spawnwait') continue;
        if (!isFinite(t.s)) res.nan++;
        const L = T.trainLength(t);
        for (let s = t.s - 0.2; s > t.s - L + 0.2; s -= 0.5) {
          if (t.depotIn && s > t.depotIn.door) continue;   // already inside the depot shed
          T.lanePoint(t, s, tmp);
          pts.push({ id: t.id, x: tmp.x, z: tmp.z });
        }
        // motion: no point of the body may move further than the train ran
        // along the track (a standing train never slides sideways)
        const mv = motionCheck(T, t, tmp);
        if (mv) { res.jumps = (res.jumps || 0) + 1; if (!res.firstJump) res.firstJump = mv; }
        res.maxWait = Math.max(res.maxWait, t.wait);
      }
      for (let a = 0; a < pts.length; a++) for (let b = a + 1; b < pts.length; b++) {
        if (pts[a].id === pts[b].id) continue;
        if (Math.hypot(pts[a].x - pts[b].x, pts[a].z - pts[b].z) < 0.45) {
          res.overlaps++;
          if (res.overlaps === 1 && this.verbose) {
            const dump = (t) => `${t.name} ${t.state} s=${t.s.toFixed(2)} stop=${t.stopS.toFixed(2)} lane=${t.lane.toFixed(2)} resv=${t.resvEnd} head=${t.steps[T.stepAt(t, t.s)].tile} held=[${[...t.held].join(',')}] runs=[${[...t.runs].join(',')}] steps=${t.steps.map((x) => x.tile + (x.single ? 's' : '') + (x.rid >= 0 ? 'r' + x.rid : '')).join(' ')} veh=${t.veh.map((v) => v.id).join(',')} rev=${JSON.stringify(t.rev)}`;
            console.warn('OVERLAP t=' + g.time.toFixed(1) + '\n' + trains.map(dump).join('\n') + '\nlocks ' + JSON.stringify([...g.net.runLocks].map(([k, v]) => [k, v.sense, [...v.ids]])));
          }
          a = pts.length; break;
        }
      }
    }
    void v;
    res.keyConflicts = T.collisions - c0;
    if (res.jumps) { res.overlaps += res.jumps; if (!this.jumpInfo) this.jumpInfo = `${res.jumps}× ${res.firstJump}`; }
    return res;
  }

  check(name, fn) {
    const t0 = performance.now();
    let r;
    try { r = fn(); } catch (e) { r = { ok: false, detail: 'error: ' + e.message }; console.error(e); }
    r.name = name; r.ms = Math.round(performance.now() - t0);
    if (this.jumpInfo) { r.detail += ' · JUMP ' + this.jumpInfo; this.jumpInfo = null; }
    this.log.push(r);
    return r;
  }

  cleanup(trains) { for (const t of trains) this.g.trains.sell(t); }

  // ---------- scenarios ----------
  // platLen: platform tiles at both ends (1 = legacy halt; trains overhang into the single track)
  singleTrack(withLoop, platLen = 3) {
    const a = this.findArea(24, 3);
    if (!a) return { ok: false, detail: 'no area' };
    const z = a.z0 + 1, x0 = a.x0 + 1;
    this.line(x0, z, x0 + 21, z, true);
    const net = this.g.net;
    if (withLoop) for (let x = x0 + 8; x <= x0 + 13; x++) net.single[idx(x, z)] = 0;
    this.finish();
    const A = this.station(x0 + 2, z), B = this.station(x0 + 20, z);
    for (let k = 1; k < platLen; k++) { this.g.stations.extendPlatform(A, 0, 1); this.g.stations.extendPlatform(B, 0, 0); }
    const D = this.depot(x0 + 21 + 1, z);
    net.connect(idx(x0 + 21, z), E);
    this.finish();
    const t1 = this.train(['L:pioneer', 'W:coach', 'W:coach'], D, [A, B]);
    const t2 = this.train(['L:trailmaster', 'W:boxcar', 'W:boxcar'], D, [B, A]);
    const tr = [t1, t2];
    const trips0 = tr.map((t) => t.trips);
    const r = this.run(420, 1 / 30, tr);
    const trips = tr.map((t, i) => t.trips - trips0[i]);
    const states = this.states(tr);
    if (this.verbose) { const T = this.g.trains; console.warn('END\n' + tr.map((t) => `${t.name} ${t.state} s=${t.s.toFixed(2)} stop=${t.stopS.toFixed(2)} resv=${t.resvEnd} head=${t.steps[T.stepAt(t, t.s)].tile} held=[${[...t.held].join(',')}] runs=[${[...t.runs].join(',')}] steps=${t.steps.map((x) => x.tile + (x.station ? 'S' : '') + (x.rid >= 0 ? 'r' + x.rid : '')).join(' ')} veh=${t.veh.map((v) => v.id + (v.r ? 'r' : '')).join(',')} deadT=${t.deadT} reroutes=${t.reroutes}`).join('\n') + '\nlocks ' + JSON.stringify([...this.g.net.runLocks].map(([k, v]) => [k, v.sense, [...v.ids]])) + ' incidents ' + JSON.stringify(T.incidents)); }
    this.cleanup(tr);
    const minTrips = platLen === 1 ? 1 : 3;
    return { ok: r.keyConflicts === 0 && r.overlaps === 0 && r.nan === 0 && trips.every((n) => n >= minTrips), detail: `platform ${platLen} tiles · trips ${trips.join('/')} overlaps ${r.overlaps} keys ${r.keyConflicts} maxWait ${r.maxWait.toFixed(0)}s ${states}` };
  }

  states(tr) { return tr.map((t) => `[${t.name}:${t.state}${t.problem ? '/' + t.problem : ''}${t.blockedBy ? '/b' + t.blockedBy + t.blockKind : ''}]`).join(''); }

  multiTrackStation() {
    const a = this.findArea(24, 5);
    if (!a) return { ok: false, detail: 'no area' };
    const z = a.z0 + 2, x0 = a.x0 + 1;
    this.line(x0, z, x0 + 21, z);
    this.finish();
    const A = this.station(x0 + 3, z), B = this.station(x0 + 18, z);
    const S_ = this.g.stations;
    // two-tile platforms, then a second track at each end station
    S_.extendPlatform(A, 0, 1); S_.extendPlatform(B, 0, 0);
    const ra = S_.addTrack(A, -1), rb = S_.addTrack(B, -1);
    const D = this.depot(x0 + 22, z);
    this.g.net.connect(idx(x0 + 21, z), E);
    this.finish();
    const tr = [
      this.train(['L:trailmaster', 'W:coach', 'W:coach'], D, [A, B]),
      this.train(['L:trailmaster', 'W:coach', 'W:coach'], D, [B, A]),
      this.train(['L:metrorunner', 'W:commuter', 'W:commuter'], D, [A, B]),
      this.train(['L:cargoking', 'W:boxcar', 'W:boxcar', 'W:boxcar'], D, [B, A]),
    ];
    const used = new Set();
    const trips0 = tr.map((t) => t.trips);
    const orig = S_.noteArrival.bind(S_);
    S_.noteArrival = (stn, t, moved) => { if (t.plat) used.add(stn.id + ':' + t.plat.track); orig(stn, t, moved); };
    const r = this.run(420, 1 / 30, tr);
    S_.noteArrival = orig;
    const trips = tr.map((t, i) => t.trips - trips0[i]);
    this.cleanup(tr);
    return {
      ok: !ra.error && !rb.error && r.keyConflicts === 0 && r.overlaps === 0 && trips.every((n) => n >= 3) && used.size >= 3,
      detail: `tracks A${A.tracks.length}/B${B.tracks.length} ${ra.error || ''}${rb.error || ''} platforms used ${[...used].join(',')} trips ${trips.join('/')} overlaps ${r.overlaps} keys ${r.keyConflicts} ${this.states(tr)}`,
    };
  }

  crossing() {
    const a = this.findArea(19, 19);
    if (!a) return { ok: false, detail: 'no area' };
    const cx = a.x0 + 9, cz = a.z0 + 9;
    this.line(a.x0 + 1, cz, a.x0 + 17, cz);
    this.line(cx, a.z0 + 1, cx, a.z0 + 17);
    this.finish();
    const W1 = this.station(a.x0 + 2, cz), E1 = this.station(a.x0 + 16, cz), N1 = this.station(cx, a.z0 + 2), S1 = this.station(cx, a.z0 + 16);
    const D1 = this.depot(a.x0 + 1 - 0, cz - 1); this.g.net.connect(idx(a.x0 + 1, cz), Nn);
    const D2 = this.depot(cx + 1, a.z0 + 1); this.g.net.connect(idx(cx, a.z0 + 1), E);
    this.finish();
    const tr = [
      this.train(['L:trailmaster', 'W:coach', 'W:coach', 'W:coach'], D1, [W1, E1]),
      this.train(['L:trailmaster', 'W:coach', 'W:coach'], D1, [E1, W1]),
      this.train(['L:trailmaster', 'W:boxcar', 'W:boxcar', 'W:boxcar'], D2, [N1, S1]),
      this.train(['L:trailmaster', 'W:boxcar', 'W:boxcar'], D2, [S1, N1]),
    ];
    const trips0 = tr.map((t) => t.trips);
    const r = this.run(420, 1 / 30, tr);
    const trips = tr.map((t, i) => t.trips - trips0[i]);
    this.cleanup(tr);
    return { ok: r.keyConflicts === 0 && r.overlaps === 0 && trips.every((n) => n >= 3), detail: `trips ${trips.join('/')} overlaps ${r.overlaps} keys ${r.keyConflicts} maxWait ${r.maxWait.toFixed(0)}s` };
  }

  signalsAndSpeed(dt) {
    const a = this.findArea(26, 3);
    if (!a) return { ok: false, detail: 'no area' };
    const z = a.z0 + 1, x0 = a.x0 + 1;
    this.line(x0, z, x0 + 23, z);
    const net = this.g.net;
    for (const x of [x0 + 7, x0 + 12, x0 + 17]) { net.signals.set(idx(x, z) * 8 + E, { type: 'block', oneway: false }); net.signals.set(idx(x, z) * 8 + W, { type: 'path', oneway: false }); }
    this.finish();
    const A = this.station(x0 + 2, z), B = this.station(x0 + 22, z);
    const D = this.depot(x0 + 24, z); net.connect(idx(x0 + 23, z), E);
    this.finish();
    const tr = [0, 1, 2].map((k) => this.train(['L:voltstream_e1'.replace('voltstream_e1', 'trailmaster'), 'W:coach', 'W:coach'], D, k % 2 ? [A, B] : [B, A], { dwell: 3 }));
    const trips0 = tr.map((t) => t.trips);
    const r = this.run(360, dt, tr);
    const trips = tr.map((t, i) => t.trips - trips0[i]);
    this.cleanup(tr);
    return { ok: r.keyConflicts === 0 && r.overlaps === 0 && r.nan === 0 && trips.every((n) => n >= 2), detail: `dt ${dt.toFixed(3)} trips ${trips.join('/')} overlaps ${r.overlaps} keys ${r.keyConflicts}` };
  }

  // Passenger destinations + transfers: line 1 A–H, line 2 H–C. Passengers
  // boarding at A pick H (direct) or C (change at H); the C-bound ones wait
  // at H for line 2 and are delivered at C. Tagged passengers never exceed a
  // station's waiting total.
  // line A–H–C built for passenger tests (H: two tracks, depot east)
  buildPaxHub() {
    const a = this.findArea(24, 5);
    if (!a) return null;
    const z = a.z0 + 2, x0 = a.x0 + 1;
    this.line(x0, z, x0 + 21, z);
    this.finish();
    const g = this.g, S_ = g.stations;
    const A = this.station(x0 + 2, z), H = this.station(x0 + 11, z), C = this.station(x0 + 20, z);
    S_.extendPlatform(A, 0, 1); S_.extendPlatform(C, 0, 0); S_.extendPlatform(H, 0, 1);
    const rh = S_.addTrack(H, -1);
    const D = this.depot(x0 + 22, z);
    g.net.connect(idx(x0 + 21, z), E);
    this.finish();
    return { A, H, C, D, rh };
  }

  paxTransfer() {
    const hub = this.buildPaxHub();
    if (!hub) return { ok: false, detail: 'no area' };
    const g = this.g, S_ = g.stations;
    const { A, H, C, D, rh } = hub;
    const mine = new Set([A.id, H.id, C.id]);
    const acc = S_.accepts;
    S_.accepts = function (stn, c) { return (c === 'PASSENGERS' && mine.has(stn.id)) || acc.call(this, stn, c); };
    const deliver = g.economy.deliver;
    const got = { H: 0, C: 0, CviaH: 0, bad: 0 };
    g.economy.deliver = function (train, stn, lot) {
      if (lot.c === 'PASSENGERS' && mine.has(lot.from)) {
        if (stn === H) got.H += lot.n;
        if (stn === C) { got.C += lot.n; if (lot.from === H.id) got.CviaH += lot.n; }
        if (lot.to != null && lot.to !== stn.id) got.bad++;
      }
      return deliver.call(this, train, stn, lot);
    };
    const t1 = this.train(['L:trailmaster', 'W:coach', 'W:coach'], D, [A, H], { act: 'auto' });
    const t2 = this.train(['L:trailmaster', 'W:coach', 'W:coach'], D, [H, C], { act: 'auto' });
    const tr = [t1, t2];
    A.stock.PASSENGERS = 150;
    const tr0 = H.stats.transfers;
    let invariant = 0;
    const tick = g.pax.tick.bind(g.pax);
    g.pax.tick = (dt) => { tick(dt); for (const s of [A, H, C]) if (g.pax.tagged(s) > Math.floor(s.stock.PASSENGERS || 0)) invariant++; };
    const r = this.run(480, 1 / 30, tr);
    g.pax.tick = tick; S_.accepts = acc; g.economy.deliver = deliver;
    const transfers = H.stats.transfers - tr0;
    const conn = g.pax.connections(A).map((x) => S_.byId(x.st).id === C.id ? 'C' + (x.via === H.id ? '~H' : '') : 'H').join(',');
    this.cleanup(tr);
    return {
      ok: !rh.error && r.keyConflicts === 0 && r.overlaps === 0 && r.nan === 0 && got.H > 0 && transfers > 0 && got.CviaH > 0 && !got.bad && !invariant,
      detail: `delivered H ${got.H} · changed at H ${transfers} · arrived C ${got.CviaH} · A connects ${conn} · invariant ${invariant} · keys ${r.keyConflicts} overlaps ${r.overlaps} ${this.states(tr)}`,
    };
  }

  // Network contracts: changing trains at H, a timetabled line and a
  // town-to-town journey (A's town to C's town, with a change) all progress.
  networkContracts() {
    const hub = this.buildPaxHub();
    if (!hub) return { ok: false, detail: 'no area' };
    const g = this.g, S_ = g.stations, E = g.economy;
    const { A, H, C, D } = hub;
    const [ta, tc] = g.towns.list;
    const mine = new Set([A.id, H.id, C.id]);
    const acc = S_.accepts;
    S_.accepts = function (stn, c) { return (c === 'PASSENGERS' && mine.has(stn.id)) || acc.call(this, stn, c); };
    const links = (s, t) => { s.links = { ...(s.links || {}), towns: t ? [t.id] : [], industries: [] }; };
    links(A, ta); links(C, tc); links(H, null);
    const k0 = E.contractSeq;
    const ks = [
      { id: k0, type: 'pax_transfers', amount: 20 },
      { id: k0 + 1, type: 'timetable', amount: 120 },
      { id: k0 + 2, type: 'town_link', from: ta.id, fromName: ta.name, town: tc.id, townName: tc.name, amount: 10 },
    ].map((k) => ({ ...k, progress: 0, done: false, claimed: false, coins: 1, xp: 1, rp: 0 }));
    E.contractSeq += 3;
    E.contracts.push(...ks);
    const tr = [
      this.train(['L:trailmaster', 'W:coach', 'W:coach'], D, [A, H], { act: 'auto' }),
      this.train(['L:trailmaster', 'W:coach', 'W:coach'], D, [A, H], { act: 'auto' }),
      this.train(['L:trailmaster', 'W:coach', 'W:coach'], D, [H, C], { act: 'auto' }),
      // town-to-town contracts count direct journeys (origin station in the target town)
      this.train(['L:trailmaster', 'W:coach', 'W:coach'], D, [A, C], { act: 'auto' }),
    ];
    tr[0].spacing = tr[1].spacing = 60;
    A.stock.PASSENGERS = 150;
    const r = this.run(480, 1 / 30, tr);
    S_.accepts = acc;
    const res = ks.map((k) => `${k.type} ${Math.floor(k.progress)}/${k.amount}`);
    const ok = ks.every((k) => k.progress > 0) && r.keyConflicts === 0 && r.overlaps === 0;
    E.contracts = E.contracts.filter((k) => !ks.includes(k));
    this.cleanup(tr);
    return { ok, detail: `${res.join(' · ')} · keys ${r.keyConflicts} overlaps ${r.overlaps}` };
  }

  // Timetable: a train with a 3-minute departure interval waits at its first
  // stop (status 'st_timetable') and leaves it at least 180 s apart, although
  // one round trip takes less.
  timetable() {
    const a = this.findArea(18, 3);
    if (!a) return { ok: false, detail: 'no area' };
    const z = a.z0 + 1, x0 = a.x0 + 1;
    this.line(x0, z, x0 + 15, z);
    this.finish();
    const g = this.g, S_ = g.stations;
    const A = this.station(x0 + 2, z), B = this.station(x0 + 13, z);
    for (let k = 0; k < 2; k++) { S_.extendPlatform(A, 0, 1); S_.extendPlatform(B, 0, 0); }
    const D = this.depot(x0 + 16, z);
    g.net.connect(idx(x0 + 15, z), E);
    this.finish();
    const t = this.train(['L:trailmaster', 'W:coach', 'W:coach'], D, [A, B], { dwell: 0 });
    t.spacing = 180;
    const deps = [];
    let held = 0;
    const note = g.lines.noteDeparture.bind(g.lines);
    g.lines.noteDeparture = (x) => { if (x === t && x.servedIdx === 0) deps.push(g.time); note(x); };
    const status = g.trains.statusOf.bind(g.trains);
    const trips0 = t.trips;
    const r = this.run(720, 1 / 30, [t]);
    g.lines.noteDeparture = note;
    // status while holding (checked on a fresh hold)
    if (t.state === 'load' && t.ttHold && status(t).key === 'st_timetable') held = 1;
    const gaps = deps.slice(1).map((d, i) => d - deps[i]);
    const minGap = gaps.length ? Math.min(...gaps) : 0;
    this.cleanup([t]);
    return {
      ok: r.keyConflicts === 0 && r.overlaps === 0 && gaps.length >= 2 && minGap >= 179.9 && minGap < 200 && t.trips - trips0 >= 4,
      detail: `departures ${deps.length} · gaps ${gaps.map((x) => x.toFixed(1)).join('/')} · trips ${t.trips - trips0} · holding status ${held ? 'seen' : 'n/a'} · keys ${r.keyConflicts} overlaps ${r.overlaps}`,
    };
  }

  // Overtaking: a slow stopping train waits at the middle station while a
  // fast train runs through on the station's 'through' track.
  overtaking() {
    const a = this.findArea(24, 4) || this.findArea(24, 5);
    if (!a) return { ok: false, detail: 'no area' };
    const z = a.z0 + 2, x0 = a.x0 + 1;
    this.line(x0, z, x0 + 21, z);
    this.finish();
    const g = this.g, S_ = g.stations;
    const A = this.station(x0 + 2, z), M = this.station(x0 + 11, z), B = this.station(x0 + 20, z);
    S_.extendPlatform(A, 0, 1); S_.extendPlatform(B, 0, 0); S_.extendPlatform(M, 0, 1); S_.extendPlatform(M, 0, 1); S_.extendPlatform(M, 0, 0);
    S_.addTrack(A, -1); S_.addTrack(B, -1);
    const rm = S_.addTrack(M, -1);
    if (!rm.error) S_.setTrackRole(M, 1, 'through');
    const D = this.depot(x0 + 22, z);
    g.net.connect(idx(x0 + 21, z), E);
    this.finish();
    const slow = this.train(['L:pioneer', 'W:coach'], D, [A, M, B], { dwell: 1 });
    slow.route[1].dwell = 15;
    const fast = this.train(['L:trailmaster', 'W:coach'], D, [A, B]);
    const tr = [slow, fast];
    const through = new Set(M.tracks[1] ? M.tracks[1].tiles : []);
    // one yield = the slow train holding for the fast one; one overtake = the
    // fast train running through on the through track during that hold
    let passes = 0, yields = 0, holding = false, passed = false;
    const tick = g.pax.tick.bind(g.pax);
    g.pax.tick = (dt) => {
      tick(dt);
      if (slow.letPass && !holding) { holding = true; passed = false; yields++; }
      if (!slow.letPass) holding = false;
      if (holding && !passed && fast.steps.length && through.has(fast.steps[g.trains.stepAt(fast, fast.s)].tile)) { passes++; passed = true; }
    };
    const trips0 = tr.map((t) => t.trips);
    const r = this.run(720, 1 / 30, tr);
    g.pax.tick = tick;
    const trips = tr.map((t, i) => t.trips - trips0[i]);
    this.cleanup(tr);
    return {
      ok: !rm.error && r.keyConflicts === 0 && r.overlaps === 0 && r.nan === 0 && passes >= 1 && trips.every((n) => n >= 2),
      detail: `${rm.error || ''} yields ${yields} · overtakes ${passes} · trips ${trips.join('/')} · keys ${r.keyConflicts} overlaps ${r.overlaps} ${this.states(tr)}`,
    };
  }

  // Send to depot: the train runs to the depot, drives in (vanishing through
  // the door, never jumping), stays parked across a save/load, is released
  // back into service; an unreachable depot is refused with a reason.
  depotOrders() {
    const a = this.findArea(18, 6);
    if (!a) return { ok: false, detail: 'no area' };
    const z = a.z0 + 2, x0 = a.x0 + 1, g = this.g, T = g.trains;
    this.line(x0, z, x0 + 13, z);
    this.finish();
    const A = this.station(x0 + 2, z), B = this.station(x0 + 12, z);
    const D = this.depot(x0 + 14, z);
    g.net.connect(idx(x0 + 13, z), E);
    const lone = this.depot(x0 + 6, z + 3);   // not connected to anything
    this.finish();
    const t = this.train(['L:trailmaster', 'W:coach', 'W:coach'], D, [A, B]);
    const r1 = this.run(40, 1 / 30, [t]);
    const bad = T.orderDepot(t, lone.id);
    const ord = T.orderDepot(t, D.id, true);
    let wasEntering = false, sec = 0;
    while (t.state !== 'stored' && sec < 150) { const r = this.run(1, 1 / 30, [t]); r1.overlaps += r.overlaps; sec++; if (t.depotIn) wasEntering = true; }
    const stored = t.state === 'stored';
    const trips0 = t.trips;
    // parked trains survive a save/load
    T.deserialize(JSON.parse(JSON.stringify(T.serialize())));
    const t2 = T.trains.find((x) => x.id === t.id);
    const keptStored = !!t2 && t2.state === 'stored' && !t2.steps.length;
    const rel = t2 ? T.releaseFromDepot(t2) : false;
    const r2 = t2 ? this.run(90, 1 / 30, [t2]) : { overlaps: 0, keyConflicts: 0 };
    const back = t2 ? t2.trips - trips0 : 0;
    this.cleanup(t2 ? [t2] : []);
    return {
      ok: !bad.ok && bad.reason === 'no_depot_route' && ord.ok && wasEntering && stored && keptStored && rel && back >= 1 && r1.overlaps === 0 && r2.overlaps === 0 && r1.keyConflicts === 0,
      detail: `unreachable ${bad.ok ? 'accepted!' : bad.reason} · order ${ord.ok ? 'ok' : ord.reason} · entered ${wasEntering} · stored ${stored} after ${sec}s · after load ${keptStored} · released ${rel} · trips after ${back} · overlaps ${r1.overlaps + r2.overlaps}`,
    };
  }

  // Signal row tool: dragging along a line places a signal every N tiles in
  // the drag direction plus one in front of a junction; undo removes them all
  // and refunds; the block overlay splits the line into sections at them.
  signalRow() {
    const a = this.findArea(20, 4);
    if (!a) return { ok: false, detail: 'no area' };
    const z = a.z0 + 1, x0 = a.x0 + 1;
    this.line(x0, z, x0 + 17, z);
    // a branch off at x0+12 makes a junction there
    this.line(x0 + 12, z, x0 + 12, z + 2);
    this.finish();
    const g = this.g, C = g.construction, net = g.net;
    C.signalType = 'block'; C.signalSpacing = 4;
    const before = net.signals.size, coins = g.economy.coins;
    const plan = C.planSignalRow(idx(x0, z), idx(x0 + 17, z));
    C.placeSignalRow(idx(x0, z), idx(x0 + 17, z));
    const placed = net.signals.size - before;
    const keys = plan ? plan.keys : [];
    const dirsOk = keys.every((k) => (k & 7) === E);
    const beforeJn = keys.some((k) => (k >> 3) === idx(x0 + 11, z));
    const sec = net.sections();
    const secs = new Set(); for (let x = x0; x <= x0 + 17; x++) { const s = sec[idx(x, z)]; if (s >= 0) secs.add(s); }
    const spent = coins - g.economy.coins;
    C.undoStack[C.undoStack.length - 1].time = g.clock;
    C.undo();
    const after = net.signals.size - before;
    const refunded = Math.abs(g.economy.coins - coins) < 1e-6;
    return {
      ok: placed >= 3 && placed === keys.length && dirsOk && beforeJn && secs.size >= 3 && spent > 0 && after === 0 && refunded,
      detail: `placed ${placed} (${keys.map((k) => (k >> 3) % 64 - x0).join(',')}) · eastbound ${dirsOk} · before junction ${beforeJn} · sections ${secs.size} · undo ${after === 0 && refunded ? 'ok' : 'failed'}`,
    };
  }

  runAll(only) {
    if (only) { this.verbose = true; }
    const g = this.g;
    g.economy.coins = 1e9;
    for (let r = 0; r < 8; r++) g.progression.regions.add(r);
    for (const id of ['station_expansion', 'platform_extension', 'block_signals', 'path_signals']) g.progression.research.add(id);
    g.progression.level = Math.max(g.progression.level, 20);
    g.progression.recomputeFx();
    if (only === 'loop') { this.check('loop', () => this.singleTrack(true)); return this.log; }
    if (only === 'noloop') { this.check('single track, no loop (run locks)', () => this.singleTrack(false)); return this.log; }
    if (only === 'bad') { this.check('bad', () => this.singleTrack(false, 1)); return this.log; }
    if (only === 'multi') { this.check('multi', () => this.multiTrackStation()); return this.log; }
    if (only === 'coarse') { this.check('coarse', () => this.signalsAndSpeed(0.1)); return this.log; }
    if (only === 'pax') { this.check('pax', () => this.paxTransfer()); return this.log; }
    if (only === 'timetable') { this.check('timetable', () => this.timetable()); return this.log; }
    if (only === 'overtake') { this.check('overtaking at a station', () => this.overtaking()); return this.log; }
    if (only === 'depot') { this.check('send to depot', () => this.depotOrders()); return this.log; }
    if (only === 'fresh') { this.check('overtaking at a station', () => this.overtaking()); this.check('signal row tool', () => this.signalRow()); this.check('network contracts', () => this.networkContracts()); this.check('send to depot', () => this.depotOrders()); return this.log; }
    this.check('single track + passing loop', () => this.singleTrack(true));
    this.check('single track, no loop (run locks)', () => this.singleTrack(false));
    this.check('short halts on single track (deadlock resolver)', () => this.singleTrack(false, 1));
    this.check('multi-track stations & dispatcher', () => this.multiTrackStation());
    this.check('diamond crossing', () => this.crossing());
    this.check('signals at 1× steps', () => this.signalsAndSpeed(1 / 30));
    this.check('signals at 4× coarse steps', () => this.signalsAndSpeed(0.1));
    this.check('passenger destinations & transfers', () => this.paxTransfer());
    this.check('timetable departure interval', () => this.timetable());
    return this.log;
  }
}

export { clamp, tx, tz };
