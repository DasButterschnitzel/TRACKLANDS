// Train simulation: movement along sampled rail trails, automatic block
// reservation, routing, loading/unloading, automatic cargo AI, manual routes,
// deadlock recovery and procedural consist visuals.
import * as THREE from 'three';
import { TILE, opp, turnOf, step, cheb, worldToTile, clamp, tileCX, tileCZ } from '../util.js';
import { LOCOS, TRACK_TIERS, KMH_PER_TILE_S, TRAIN_UPGRADE_EFFECT, CARGO, ERA_RESEARCH } from '../config.js';
import { K_TUNNEL, K_BRIDGE } from '../rail/RailNetwork.js';
import { locoGeometry, wagonGeometry, cargoStyle, liveryColors, LOCO_LEN, WAGON_LEN, CAR_GAP } from './TrainModels.js';
import { MATS } from '../core/ModelBuilder.js';

const LANE = 0.34;
const DECEL = 3.2;
const _v = new THREE.Vector3();

export function locoModel(id) { return LOCOS.find((m) => m.id === id) || LOCOS[0]; }

export class TrainSystem {
  constructor(game) {
    this.game = game;
    this.trains = [];
    this.nextId = 1;
    this.group = new THREE.Group();
    this.group.name = 'trains';
    game.scene.add(this.group);
    this.meshes = [];
    this._pickList = [];
  }

  get net() { return this.game.net; }
  byId(id) { return this.trains.find((t) => t.id === id); }

  // ---------- stats ----------
  stats(t) {
    const m = locoModel(t.model);
    const fx = this.game.progression.fx;
    const u = t.upg;
    const E = TRAIN_UPGRADE_EFFECT;
    const trait = m.trait;
    const speed = m.speed * (1 + E.engine * u.engine) * (1 + fx.trainSpeed);
    const accel = m.accel * (1 + E.accel * u.accel) * (1 + fx.trainAccel) * (trait === 'high_accel' ? 1.5 : 1) * (0.8 + 0.2 * Math.min(1, m.power / (160 * (m.wagons + 1))));
    const capMul = (1 + E.capacity * u.capacity) * (1 + fx.capacity);
    const freight = Math.round(m.freight * capMul * (trait === 'cargo_master' ? 1.2 : 1));
    const pax = Math.round(m.pax * capMul);
    const wagons = m.wagons + Math.floor(u.capacity / 2) + (fx.capacity > 0 ? 1 : 0);
    const load = m.load * (1 + E.loading * u.loading) * (trait === 'fast_loading' ? 1.4 : 1) * (1 + fx.loadSpeed);
    const op = m.op * (1 - E.efficiency * u.efficiency) * (1 + fx.opCost) * (trait === 'cheap_op' ? 0.6 : 1) * (1.5 - m.reliability * 0.5);
    return { speed, accel, freight, pax, wagons, load, op, model: m, minTier: m.maglev ? 3 : m.electric ? 2 : 0 };
  }
  trainLength(t) { return LOCO_LEN + CAR_GAP + t._st.wagons * (WAGON_LEN + CAR_GAP); }

  // ---------- purchase ----------
  canBuy(modelId, depot) {
    const m = locoModel(modelId);
    const g = this.game;
    if (!g.progression.locoUnlocked(m)) return 'err_train_locked';
    if (!depot) return 'err_no_depot';
    if (!this.net.conn[depot.tile]) return 'err_depot_unconnected';
    const minTier = m.maglev ? 3 : m.electric ? 2 : 0;
    if (this.net.tier[depot.tile] < minTier) return m.maglev ? 'err_needs_hsr' : 'err_needs_electric';
    const cost = g.economy.costs.train(m);
    if (!g.economy.canAfford(cost)) return 'err_no_money';
    return null;
  }

  buy(modelId, depot, name) {
    const err = this.canBuy(modelId, depot);
    if (err) return { error: err };
    const m = locoModel(modelId);
    const cost = this.game.economy.costs.train(m);
    const count = this.trains.filter((t) => t.model === modelId).length + 1;
    const t = this.makeTrain({ id: this.nextId++, model: modelId, name: name || `${m.name.split(' ')[0]} ${count}`, livery: this.game.progression.defaultLivery });
    this.trains.push(t);
    if (!this.spawnAtDepot(t, depot)) {
      t.state = 'spawnwait';
    }
    this.game.economy.spend(cost, 'trains');
    this.game.stats.inc('trainsBought');
    this.game.progression.ownModel(modelId);
    this.game.events.emit('trainBought', t);
    return { train: t };
  }

  makeTrain(d) {
    const t = {
      id: d.id, model: d.model, name: d.name || 'Train', livery: d.livery || 'classic_green',
      upg: Object.assign({ engine: 0, capacity: 0, accel: 0, loading: 0, efficiency: 0 }, d.upg || {}),
      mode: d.mode === 'manual' ? 'manual' : 'auto',
      route: Array.isArray(d.route) ? d.route.filter((r) => r && typeof r.st === 'number') : [],
      routeIdx: d.routeIdx | 0,
      filter: Array.isArray(d.filter) ? d.filter.filter((c) => CARGO[c]) : null,
      cargo: Array.isArray(d.cargo) ? d.cargo.filter((l) => l && CARGO[l.c] && l.n > 0) : [],
      earned: d.earned || 0, trips: d.trips || 0, profitLog: d.profitLog || [],
      state: 'idle', stateT: 0, wait: 0, target: d.target ?? null, depotId: d.depotId ?? null,
      xs: [], ys: [], zs: [], ss: [], steps: [], s: 0, v: 0, stopS: Infinity, targetStop: false,
      flip: false, lane: 1, held: new Set(), claim: null, problem: null, loadTime: 0, lastStepIdx: -1,
      visual: null, fade: 1, reroutes: 0, homeDepot: d.depotId ?? null, unreachable: new Map(), recover: 0,
      created: d.created || Date.now(),
    };
    t._st = this.stats(t);
    return t;
  }

  refreshStats(t) { t._st = this.stats(t); t.visualSig = null; }

  // ---------- trail management ----------
  clearTrail(t) {
    this.net.release([...t.held], t.id);
    t.held.clear();
    t.xs.length = 0; t.ys.length = 0; t.zs.length = 0; t.ss.length = 0; t.steps.length = 0;
  }

  appendStep(t, st) {
    const first = t.xs.length === 0;
    const n0 = t.xs.length;
    const { centerIdx } = this.net.sampleStep(st.tile, st.inH, st.outH, t.xs, t.ys, t.zs, !first);
    const startIdx = first ? 0 : n0 - 1;
    if (first) t.ss.push(0);
    for (let k = first ? 1 : n0; k < t.xs.length; k++) {
      const dx = t.xs[k] - t.xs[k - 1], dy = t.ys[k] - t.ys[k - 1], dz = t.zs[k] - t.zs[k - 1];
      t.ss.push(t.ss[k - 1] + Math.sqrt(dx * dx + dy * dy + dz * dz));
    }
    const s0 = t.ss[startIdx], s1 = t.ss[t.ss.length - 1];
    const sc = t.ss[startIdx + centerIdx];
    const o = { tile: st.tile, inH: st.inH, outH: st.outH, s0, s1, sc, keys: this.net.laneKeys(st), kind: this.net.kind(st.tile) };
    t.steps.push(o);
    return o;
  }

  truncateAfter(t, sEnd) {
    // remove points beyond sEnd (keep the point at sEnd)
    let n = t.ss.length;
    while (n > 1 && t.ss[n - 1] > sEnd + 1e-6) n--;
    t.xs.length = n; t.ys.length = n; t.zs.length = n; t.ss.length = n;
    while (t.steps.length && t.steps[t.steps.length - 1].s0 >= sEnd - 1e-6 && t.steps.length > 1) t.steps.pop();
  }

  stepAt(t, s) {
    const st = t.steps;
    if (!st.length) return -1;
    let lo = 0, hi = st.length - 1;
    if (s <= st[0].s0) return 0;
    if (s >= st[hi].s1) return hi;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (st[mid].s1 < s) lo = mid + 1; else hi = mid; }
    return lo;
  }

  sampleAt(t, s, out) {
    const ss = t.ss, n = ss.length;
    if (n === 0) { out.set(0, 0, 0); return out; }
    if (s <= ss[0]) return out.set(t.xs[0], t.ys[0], t.zs[0]);
    if (s >= ss[n - 1]) return out.set(t.xs[n - 1], t.ys[n - 1], t.zs[n - 1]);
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (ss[mid] <= s) lo = mid; else hi = mid; }
    const f = (s - ss[lo]) / Math.max(1e-6, ss[hi] - ss[lo]);
    return out.set(t.xs[lo] + (t.xs[hi] - t.xs[lo]) * f, t.ys[lo] + (t.ys[hi] - t.ys[lo]) * f, t.zs[lo] + (t.zs[hi] - t.zs[lo]) * f);
  }

  trim(t) {
    const L = this.trainLength(t);
    let k = 0;
    while (k < t.steps.length - 1 && t.steps[k].s1 < t.s - L - 4) k++;
    if (k === 0) return;
    const cut = t.steps[k].s0;
    t.steps.splice(0, k);
    let p = 0;
    while (p < t.ss.length - 1 && t.ss[p + 1] <= cut + 1e-6) p++;
    t.xs.splice(0, p); t.ys.splice(0, p); t.zs.splice(0, p); t.ss.splice(0, p);
    const off = t.ss[0];
    for (let i = 0; i < t.ss.length; i++) t.ss[i] -= off;
    for (const s of t.steps) { s.s0 -= off; s.s1 -= off; s.sc -= off; }
    t.s -= off;
    if (isFinite(t.stopS)) t.stopS -= off;
  }

  flipTrain(t) {
    const L = this.trainLength(t);
    this.truncateAfter(t, t.s);
    const S = t.s;
    const n = t.ss.length;
    const xs = [], ys = [], zs = [], ss = [];
    for (let i = n - 1; i >= 0; i--) { xs.push(t.xs[i]); ys.push(t.ys[i]); zs.push(t.zs[i]); ss.push(S - t.ss[i]); }
    t.xs = xs; t.ys = ys; t.zs = zs; t.ss = ss;
    const steps = [];
    for (let i = t.steps.length - 1; i >= 0; i--) {
      const o = t.steps[i];
      const r = { tile: o.tile, inH: o.outH == null ? null : opp(o.outH), outH: o.inH == null ? null : opp(o.inH), s0: S - o.s1, s1: Math.max(S - o.s0, S - o.s1), sc: S - o.sc, kind: o.kind };
      r.s0 = Math.max(0, r.s0);
      r.keys = this.net.laneKeys(r);
      steps.push(r);
    }
    t.steps = steps;
    t.s = Math.min(L, ss[ss.length - 1]);
    t.flip = !t.flip;
    t.lane = -t.lane;
    this.net.release([...t.held], t.id); t.held.clear();
    this.holdOccupied(t, true);
  }

  holdOccupied(t, force) {
    const L = this.trainLength(t);
    for (const st of t.steps) {
      if (st.s1 < t.s - L - 0.05) continue;
      if (st.s0 > t.s + 0.01) break;
      if (force || this.net.canReserve(st.keys, t.id)) { this.net.reserve(st.keys, t.id); for (const k of st.keys) t.held.add(k); }
    }
  }

  // Place a train with its head at the center of `tile`, arriving with heading h.
  placeAt(t, tile, h) {
    this.clearTrail(t);
    const net = this.net;
    const L = this.trainLength(t) + 1;
    const seq = [];
    let cur = tile, heading = h, acc = 0;
    // head step
    let bestOut = null, bt = 9;
    for (let d = 0; d < 8; d++) if (net.hasDir(tile, d) && d !== opp(h) && turnOf(h, d) <= 2 && turnOf(h, d) < bt) { bt = turnOf(h, d); bestOut = d; }
    seq.push({ tile, inH: h, outH: bestOut });
    acc += TILE / 2;
    let guard = 0;
    while (acc < L && guard++ < 30) {
      const prev = step(cur, opp(heading));
      if (prev < 0 || !net.hasDir(cur, opp(heading))) break;
      // choose heading into prev: prev exits with `heading`, entered with hp where turn(hp, heading) <= 2 and prev has conn opp(hp)
      let hp = null, best = 9;
      for (let d = 0; d < 8; d++) {
        if (!net.hasDir(prev, d) || d === heading) continue;
        const cand = opp(d);
        const tt = turnOf(cand, heading);
        if (tt <= 2 && tt < best) { best = tt; hp = cand; }
      }
      const sd = net.special.get(prev);
      if (sd && sd.type === 'depot') hp = null;
      seq.push({ tile: prev, inH: hp, outH: heading });
      acc += TILE;
      if (hp == null) break;
      cur = prev; heading = hp;
    }
    // if the last collected step still has an inH, start it from its entry edge
    seq.reverse();
    for (const st of seq) this.appendStep(t, st);
    const head = t.steps[t.steps.length - 1];
    t.s = head.sc;
    t.v = 0;
    t.lane = 1;
    this.holdOccupied(t, true);
  }

  spawnAtDepot(t, depot) {
    const net = this.net;
    let exit = null;
    for (let d = 0; d < 8; d++) if (net.hasDir(depot.tile, d)) exit = d;
    if (exit == null) return false;
    const st = { tile: depot.tile, inH: null, outH: exit };
    const keys = net.laneKeys(st);
    if (!net.canReserve(keys, t.id)) return false;
    this.clearTrail(t);
    this.appendStep(t, st);
    t.s = 0; t.v = 0; t.flip = false; t.lane = 1;
    t.fromDepot = true;
    t.homeDepot = depot.id;
    this.holdOccupied(t, true);
    t.state = 'depart'; t.stateT = 0;
    t.spawnFx = 1;
    this.game.events.emit('trainSpawn', t, depot);
    return true;
  }

  // ---------- planning ----------
  headInfo(t) {
    const k = this.stepAt(t, t.s);
    return { k, st: t.steps[k] };
  }

  planOptions(t, targetTile, allowReverse) {
    const net = this.net;
    const minTier = t._st.minTier;
    const { st } = this.headInfo(t);
    if (!st) return [];
    const opts = [];
    const atCenter = Math.abs(t.s - st.sc) < 0.05;
    if (atCenter) {
      if (st.tile === targetTile) { /* already here */ }
      const r = net.findRoute({ tile: st.tile, heading: st.inH, fromCenter: true }, targetTile, { minTier });
      if (r && (r.steps.length || st.tile === targetTile)) opts.push({ kind: 'center', route: r, cost: r.length });
    } else if (st.outH != null && net.hasDir(st.tile, st.outH)) {
      const nt = step(st.tile, st.outH);
      if (nt >= 0) {
        const r = net.findRoute({ tile: nt, heading: st.outH, fromCenter: false }, targetTile, { minTier });
        if (r) opts.push({ kind: 'forward', route: r, cost: r.length + (st.s1 - t.s) / TILE });
      }
    }
    if (allowReverse) {
      const L = this.trainLength(t);
      const tk = this.stepAt(t, Math.max(t.ss[0] || 0, t.s - L));
      const ts = t.steps[tk];
      if (ts && ts.inH != null) {
        const rh = opp(ts.inH);
        const nt = step(ts.tile, rh);
        if (nt >= 0 && net.hasDir(ts.tile, rh)) {
          const r = net.findRoute({ tile: nt, heading: rh, fromCenter: false }, targetTile, { minTier });
          if (r) opts.push({ kind: 'reverse', route: r, cost: r.length + 1.5 + L / TILE });
        }
      }
    }
    opts.sort((a, b) => a.cost - b.cost);
    return opts;
  }

  applyRoute(t, opt) {
    const net = this.net;
    if (opt.kind === 'reverse') this.flipTrain(t);
    const { k, st } = this.headInfo(t);
    if (opt.kind === 'center') {
      const first = opt.route.firstOut;
      if (first == null) {
        // target is the current tile
        this.truncateAfter(t, st.s1);
        t.stopS = st.sc; return true;
      }
      if (st.outH === first) this.truncateAfter(t, st.s1);
      else {
        // rebuild the second half of the current step toward the new exit
        this.truncateAfter(t, t.s);
        t.steps.length = k + 1;
        const half = { tile: st.tile, inH: null, outH: first };
        const n0 = t.xs.length;
        net.sampleStep(half.tile, null, first, t.xs, t.ys, t.zs, true);
        for (let i = n0; i < t.xs.length; i++) {
          const dx = t.xs[i] - t.xs[i - 1], dy = t.ys[i] - t.ys[i - 1], dz = t.zs[i] - t.zs[i - 1];
          t.ss.push(t.ss[i - 1] + Math.sqrt(dx * dx + dy * dy + dz * dz));
        }
        st.outH = first; st.s1 = t.ss[t.ss.length - 1];
        const nk = net.laneKeys(st);
        st.keys = nk;
      }
    } else {
      const { st: hs } = this.headInfo(t);
      this.truncateAfter(t, hs.s1);
      t.steps.length = this.stepAt(t, t.s) + 1;
    }
    for (const s of opt.route.steps) this.appendStep(t, s);
    const last = t.steps[t.steps.length - 1];
    t.stopS = last.sc;
    return true;
  }

  // ---------- AI ----------
  stationAccepts(stn, lot) {
    if (lot.from === stn.id) return false;
    return this.game.stations.accepts(stn, lot.c);
  }

  chooseTarget(t, here) {
    const g = this.game, S = g.stations;
    if (t.mode === 'manual') {
      if (t.route.length < 2) { t.problem = 'route_short'; return null; }
      const valid = t.route.filter((r) => S.byId(r.st));
      if (valid.length < 2) { t.problem = 'route_short'; return null; }
      t.routeIdx = t.routeIdx % t.route.length;
      for (let tries = 0; tries < t.route.length; tries++) {
        const r = t.route[t.routeIdx];
        const stn = S.byId(r.st);
        if (stn && (!here || stn.id !== here.id)) return stn;
        t.routeIdx = (t.routeIdx + 1) % t.route.length;
      }
      return null;
    }
    const net = this.net;
    const comp = net.components();
    const fromTile = here ? here.tile : t.steps.length ? t.steps[this.stepAt(t, t.s)].tile : -1;
    if (fromTile < 0) return null;
    const c0 = comp[fromTile];
    const cands = S.list.filter((s) => s !== here && comp[s.tile] === c0 && c0 >= 0 && !this.isUnreachable(t, s.id));
    if (!cands.length) { t.problem = 'no_stations'; return null; }
    // deliver carried cargo
    if (t.cargo.length) {
      let best = null, bs = 0;
      for (const d of cands) {
        let v = 0;
        for (const lot of t.cargo) if (this.stationAccepts(d, lot)) v += g.economy.estimate(lot.c, lot.n, S.byId(lot.from), d, t);
        const sc = v / (cheb(fromTile, d.tile) + 6);
        if (sc > bs) { bs = sc; best = d; }
      }
      if (best) return best;
    }
    // go pick something up
    const cap = { f: t._st.freight - this.load(t, false), p: t._st.pax - this.load(t, true) };
    let best = null, bs = 0, bc = null, bn = 0;
    for (const d of cands) {
      for (const c in d.stock) {
        const amt = d.stock[c] - (d.claimed[c] || 0);
        if (amt < 3) continue;
        if (t.filter && !t.filter.includes(c)) continue;
        const isPax = c === 'PASSENGERS';
        const room = isPax ? cap.p : cap.f;
        if (room <= 0) continue;
        if (!S.hasDemand(d, c, comp)) continue;
        const n = Math.min(amt, room);
        const sc = (n * CARGO[c].value) / (cheb(fromTile, d.tile) + 8) * (0.9 + Math.random() * 0.2);
        if (sc > bs) { bs = sc; best = d; bc = c; bn = n; }
      }
    }
    if (best) {
      this.setClaim(t, best, bc, bn);
      return best;
    }
    t.problem = t.cargo.length ? 'no_demand' : 'no_cargo';
    return null;
  }

  setClaim(t, stn, c, n) {
    this.releaseClaim(t);
    stn.claimed[c] = (stn.claimed[c] || 0) + n;
    t.claim = { st: stn.id, c, n };
  }
  releaseClaim(t) {
    if (!t.claim) return;
    const s = this.game.stations.byId(t.claim.st);
    if (s) s.claimed[t.claim.c] = Math.max(0, (s.claimed[t.claim.c] || 0) - t.claim.n);
    t.claim = null;
  }
  isUnreachable(t, stId) { const x = t.unreachable.get(stId); return x && x > this.game.time; }

  load(t, pax) { let n = 0; for (const l of t.cargo) if ((l.c === 'PASSENGERS') === pax) n += l.n; return n; }

  // ---------- state machine ----------
  depart(t) {
    const g = this.game;
    const here = this.stationAtHead(t);
    const stn = this.chooseTarget(t, here);
    if (!stn) {
      if (t.problem === 'no_demand' && t.mode === 'auto') {
        // cargo nobody on this network accepts is left behind so the train stays useful
        const comp = this.net.components();
        t.cargo = t.cargo.filter((l) => g.stations.list.some((s) => comp[s.tile] >= 0 && this.stationAccepts(s, l)));
        t.visualSig = null;
      }
      t.state = t.state === 'lost' ? 'lost' : 'idle'; t.stateT = 0; return;
    }
    const allowReverse = true;
    const opts = this.planOptions(t, stn.tile, allowReverse);
    if (!opts.length) {
      t.unreachable.set(stn.id, g.time + 45);
      this.releaseClaim(t);
      if (t.mode === 'manual') { t.problem = t._st.minTier ? 'needs_electric' : 'no_route'; t.routeIdx = (t.routeIdx + 1) % Math.max(1, t.route.length); }
      else t.problem = 'no_route';
      t.state = 'idle'; t.stateT = 0;
      return;
    }
    if (opts[0].kind === 'reverse') {
      // reversing needs the other lane to be free
      const probe = opts[0];
      this.applyRoute(t, probe);
    } else this.applyRoute(t, opts[0]);
    t.target = stn.id;
    t.problem = null;
    t.state = 'run'; t.stateT = 0; t.wait = 0; t.recover = 0;
    t.lastStepIdx = -1;
    g.events.emit('trainDepart', t, here);
  }

  stationAtHead(t) {
    if (!t.steps.length) return null;
    const st = t.steps[this.stepAt(t, t.s)];
    if (!st || Math.abs(t.s - st.sc) > 0.1) return null;
    const sp = this.net.special.get(st.tile);
    return sp && sp.type === 'station' ? this.game.stations.byId(sp.id) : null;
  }

  arrive(t) {
    const g = this.game;
    const stn = g.stations.byId(t.target);
    t.state = 'load'; t.stateT = 0; t.v = 0;
    if (!stn) { t.loadTime = 0.5; return; }
    if (t.claim && t.claim.st === stn.id) this.releaseClaim(t);
    // unload
    let moved = 0;
    const keep = [];
    for (const lot of t.cargo) {
      let accept = this.stationAccepts(stn, lot);
      if (accept && t.mode === 'manual' && t.filter && !t.filter.includes(lot.c)) accept = true;
      if (accept) { g.economy.deliver(t, stn, lot); moved += lot.n; }
      else keep.push(lot);
    }
    // manual routes drop cargo no stop can accept to avoid clogging
    if (t.mode === 'manual') {
      const stops = t.route.map((r) => g.stations.byId(r.st)).filter(Boolean);
      for (let i = keep.length - 1; i >= 0; i--) {
        const lot = keep[i];
        if (!stops.some((s) => this.stationAccepts(s, lot))) keep.splice(i, 1);
      }
    }
    t.cargo = keep;
    if (t.mode === 'manual' && t.route.length) {
      if (t.route[t.routeIdx % t.route.length].st === stn.id) t.routeIdx = (t.routeIdx + 1) % t.route.length;
    }
    const planned = this.planLoad(t, stn, true);
    const rate = g.stations.loadRate(stn) * t._st.load;
    t.loadTime = 1.2 + (moved + planned) / Math.max(1, rate);
    t.trips++;
    if (moved > 0) t.visualSig = null;
    g.events.emit('trainArrive', t, stn, moved);
  }

  planLoad(t, stn, dry) {
    const g = this.game, S = g.stations;
    const comp = this.net.components();
    let roomF = t._st.freight - this.load(t, false), roomP = t._st.pax - this.load(t, true);
    const stops = t.mode === 'manual' ? t.route.map((r) => S.byId(r.st)).filter((s) => s && s !== stn) : null;
    const cargos = Object.keys(stn.stock).filter((c) => stn.stock[c] >= 1);
    const scored = [];
    for (const c of cargos) {
      if (t.filter && !t.filter.includes(c)) continue;
      let ok;
      if (stops) ok = stops.some((s) => S.accepts(s, c));
      else ok = S.hasDemand(stn, c, comp, t);
      if (!ok) continue;
      scored.push({ c, sc: stn.stock[c] * CARGO[c].value });
    }
    scored.sort((a, b) => b.sc - a.sc);
    let total = 0;
    for (const { c } of scored) {
      const isPax = c === 'PASSENGERS';
      const room = isPax ? roomP : roomF;
      if (room <= 0) continue;
      // leave some cargo for other trains that claimed it
      const claimedByOthers = (stn.claimed[c] || 0);
      const avail = Math.floor(stn.stock[c] - (t.claim && t.claim.st === stn.id ? 0 : Math.min(claimedByOthers, stn.stock[c] * 0.5)));
      const n = Math.min(avail, room);
      if (n <= 0) continue;
      total += n;
      if (isPax) roomP -= n; else roomF -= n;
      if (!dry) {
        stn.stock[c] -= n;
        const lot = t.cargo.find((l) => l.c === c && l.from === stn.id);
        if (lot) lot.n += n; else t.cargo.push({ c, n, from: stn.id });
        g.stations.onPickup(stn, c, n);
      }
    }
    return total;
  }

  tick(dt) {
    const g = this.game;
    for (const t of this.trains) {
      try { this.tickTrain(t, dt); } catch (e) { console.error('train tick error', e); this.recoverTrain(t); }
    }
    // operating costs
    let op = 0;
    for (const t of this.trains) op += t._st.op * (t.state === 'idle' ? 0.3 : 1);
    if (op > 0) g.economy.operatingCost((op / 60) * dt);
  }

  tickTrain(t, dt) {
    const g = this.game;
    t.stateT += dt;
    if (t.spawnFx > 0) t.spawnFx = Math.max(0, t.spawnFx - dt * 0.6);
    if (t.lane < 1) t.lane = Math.min(1, t.lane + dt * (g.settings.reducedMotion ? 10 : 1.2));
    switch (t.state) {
      case 'spawnwait': {
        if (t.stateT > 1) {
          t.stateT = 0;
          const dep = g.stations.depotById(t.homeDepot) || g.stations.depots[0];
          if (dep && this.spawnAtDepot(t, dep)) return;
        }
        return;
      }
      case 'depart': this.depart(t); return;
      case 'idle': {
        if (t.stateT > 3) { t.stateT = 0; this.depart(t); }
        return;
      }
      case 'load': {
        if (t.stateT >= t.loadTime) {
          const stn = this.stationAtHead(t) || g.stations.byId(t.target);
          if (stn) { const n = this.planLoad(t, stn, false); if (n > 0) { t.visualSig = null; g.events.emit('trainLoaded', t, stn, n); } }
          t.state = 'depart';
        }
        return;
      }
      case 'lost': {
        if (t.stateT > 2) { t.stateT = 0; this.depart(t); if (t.state === 'idle') t.state = 'lost'; }
        t.recover += dt;
        if (t.recover > 40) this.recoverTrain(t);
        return;
      }
      case 'run': this.move(t, dt); return;
      default: t.state = 'idle';
    }
  }

  move(t, dt) {
    const g = this.game, net = this.net;
    const st = t._st;
    const weather = g.env ? g.env.effects : { speed: 1, accel: 1 };
    const L = this.trainLength(t);
    const vmaxTrain = (st.speed / KMH_PER_TILE_S) * TILE * weather.speed;
    const accel = st.accel * 1.3 * weather.accel;
    // reservations
    const lookahead = (t.v * t.v) / (2 * DECEL) + TILE * 1.3;
    const need = new Set();
    let limitS = Infinity;
    const tailS = t.s - L;
    let blocker = 0;
    for (let k = 0; k < t.steps.length; k++) {
      const s = t.steps[k];
      if (s.s1 < tailS - 0.05) continue;
      if (s.s0 <= t.s + 1e-6) { for (const key of s.keys) need.add(key); continue; }
      if (s.s0 > t.s + lookahead) break;
      if (net.canReserve(s.keys, t.id)) { for (const key of s.keys) need.add(key); }
      else { blocker = net.holder(s.keys, t.id); limitS = s.s0 - 0.3; break; }
    }
    for (const key of t.held) if (!need.has(key)) net.release([key], t.id);
    for (const key of need) { if (net.resv[key] === 0) net.resv[key] = t.id; }
    t.held = need;
    // speed limits ahead
    let vlim = vmaxTrain;
    const fx = g.progression.fx;
    for (let k = this.stepAt(t, t.s); k < t.steps.length; k++) {
      const s = t.steps[k];
      const d = Math.max(0, s.s0 - t.s);
      if (d > (vmaxTrain * vmaxTrain) / (2 * DECEL) + 1) break;
      const tier = net.tier[s.tile];
      let lim = TRACK_TIERS[tier].speed * (st.model.maglev && tier === 3 ? 1.45 : 1);
      if (s.inH != null && s.outH != null && s.inH !== s.outH) {
        const tt = turnOf(s.inH, s.outH);
        let f = tt === 1 ? (tier === 3 ? 0.92 : 0.8) : (tier === 3 ? 0.72 : 0.5);
        f = 1 - (1 - f) * (1 + fx.curvePenalty);
        lim *= f;
      }
      if (s.kind !== K_BRIDGE && s.kind !== K_TUNNEL) {
        const dh = Math.abs(net.railH(s.tile) - (s.inH != null ? net.railH(step(s.tile, opp(s.inH))) || 0 : net.railH(s.tile)));
        const slope = Math.min(0.35, dh * 0.22) * (st.model.trait === 'mountain_goat' ? 0.4 : 1);
        lim *= 1 - slope;
      }
      const lw = (lim / KMH_PER_TILE_S) * TILE;
      vlim = Math.min(vlim, Math.sqrt(lw * lw + 2 * DECEL * d));
    }
    const stopAt = Math.min(t.stopS, limitS, t.ss[t.ss.length - 1]);
    const dist = stopAt - t.s;
    const vb = Math.sqrt(2 * DECEL * Math.max(0, dist - 0.01));
    const vt = Math.min(vlim, vb);
    if (t.v < vt) t.v = Math.min(vt, t.v + accel * dt);
    else t.v = Math.max(vt, t.v - DECEL * 1.5 * dt);
    if (!isFinite(t.v)) t.v = 0;
    t.s = Math.min(t.s + t.v * dt, stopAt);
    // traffic heat
    const hk = this.stepAt(t, t.s);
    if (hk !== t.lastStepIdx) { t.lastStepIdx = hk; const s = t.steps[hk]; if (s) net.traffic[s.tile] += 1; }
    const kmh = (t.v / TILE) * KMH_PER_TILE_S;
    if (kmh > g.stats.data.topSpeed) g.stats.set('topSpeed', Math.round(kmh));
    // arrival
    if (t.s >= t.stopS - 0.02 && t.v < 0.2) {
      t.s = t.stopS;
      if (t.pendingLost) { t.pendingLost = false; t.state = 'lost'; t.stateT = 0; t.v = 0; return; }
      this.arrive(t);
      if (t.steps.length > 60) this.trim(t);
      return;
    }
    // blocked handling
    if (limitS < t.stopS - 0.1 && t.v < 0.05) {
      t.wait += dt;
      if (t.wait > 6 && t.reroutes === 0) { t.reroutes = 1; this.rerouteAvoiding(t); }
      else if (t.wait > 16 && t.reroutes === 1) {
        t.reroutes = 2;
        const other = this.byId(blocker);
        if (!other || other.wait > 2 || other.state !== 'run' || t.id > other.id) this.reverseOut(t);
      } else if (t.wait > 45) this.recoverTrain(t);
    } else if (t.v > 0.3) { t.wait = 0; t.reroutes = 0; }
    if (t.steps.length > 80) this.trim(t);
    if (!isFinite(t.s)) this.recoverTrain(t);
  }

  rerouteAvoiding(t) {
    const stn = this.game.stations.byId(t.target);
    if (!stn) return;
    const { st } = this.headInfo(t);
    if (!st || st.outH == null || !this.net.hasDir(st.tile, st.outH)) return;
    const avoid = new Set();
    for (let k = this.stepAt(t, t.s) + 1; k < t.steps.length && k < this.stepAt(t, t.s) + 4; k++) {
      const s = t.steps[k];
      if (!this.net.canReserve(s.keys, t.id)) avoid.add(s.tile);
    }
    const nt = step(st.tile, st.outH);
    const r = this.net.findRoute({ tile: nt, heading: st.outH, fromCenter: false }, stn.tile, { minTier: t._st.minTier, avoid });
    if (r && !r.steps.some((s) => avoid.has(s.tile))) {
      this.applyRoute(t, { kind: 'forward', route: r });
    }
  }

  reverseOut(t) {
    const stn = this.game.stations.byId(t.target);
    if (!stn) return;
    const opts = this.planOptions(t, stn.tile, true).filter((o) => o.kind === 'reverse');
    if (opts.length) {
      // only reverse if the reversed lane is free
      this.applyRoute(t, opts[0]);
      t.wait = 0;
    }
  }

  recoverTrain(t) {
    // Safely relocate a stuck or corrupted train to a free station or its depot.
    const g = this.game, net = this.net;
    this.releaseClaim(t);
    const here = t.steps.length ? t.steps[Math.max(0, this.stepAt(t, t.s))].tile : (g.stations.list[0] ? g.stations.list[0].tile : 0);
    const cands = g.stations.list.filter((s) => net.conn[s.tile]).sort((a, b) => cheb(a.tile, here) - cheb(b.tile, here));
    this.clearTrail(t);
    for (const stn of cands) {
      for (let d = 0; d < 8; d++) {
        if (!net.hasDir(stn.tile, d)) continue;
        const h = opp(d);
        const test = { tile: stn.tile, inH: h, outH: null };
        if (!net.canReserve(net.laneKeys(test), t.id)) continue;
        this.placeAt(t, stn.tile, h);
        t.state = 'load'; t.loadTime = 1; t.stateT = 0; t.target = stn.id; t.wait = 0; t.reroutes = 0; t.recover = 0;
        t.fade = 0;
        g.events.emit('trainRecovered', t);
        return;
      }
    }
    const dep = g.stations.depotById(t.homeDepot) || g.stations.depots.find((d) => net.conn[d.tile]);
    if (dep && this.spawnAtDepot(t, dep)) { t.fade = 0; return; }
    t.state = 'spawnwait'; t.stateT = 0;
  }

  // Called when the network changes. Returns false if the tile is occupied by a train body.
  tileOccupied(tile) {
    for (const t of this.trains) {
      if (t.state === 'spawnwait') continue;
      const L = this.trainLength(t);
      for (const s of t.steps) if (s.tile === tile && s.s1 >= t.s - L - 0.05 && s.s0 <= t.s + 0.05) return t;
    }
    return null;
  }

  onNetworkChanged(removedTiles) {
    const net = this.net;
    for (const t of this.trains) {
      t.unreachable.clear();
      if (t.state === 'idle' || t.state === 'lost') { t.stateT = 3; continue; }
      if (t.state !== 'run' || !removedTiles) continue;
      // check that the planned path ahead is still valid
      let bad = false;
      for (let k = this.stepAt(t, t.s); k < t.steps.length; k++) {
        const s = t.steps[k];
        if (!net.conn[s.tile]) { bad = true; break; }
        if (s.inH != null && !net.hasDir(s.tile, opp(s.inH))) { bad = true; break; }
        if (s.outH != null && k < t.steps.length - 1 && !net.hasDir(s.tile, s.outH)) { bad = true; break; }
      }
      if (bad) {
        const stn = this.game.stations.byId(t.target);
        const opts = stn ? this.planOptions(t, stn.tile, false) : [];
        if (opts.length) this.applyRoute(t, opts[0]);
        else {
          const { st } = this.headInfo(t);
          this.truncateAfter(t, st ? st.s1 : t.s);
          t.stopS = Math.min(t.ss[t.ss.length - 1], st ? st.s1 : t.s);
          t.state = 'lost'; t.stateT = 0; t.problem = 'no_route';
          // stop before the missing piece; will replan or reverse
          t.v = Math.min(t.v, 1);
          t.state = 'run'; t.pendingLost = true;
        }
      }
    }
  }

  sell(t) {
    const g = this.game;
    const L = t;
    this.releaseClaim(t);
    this.clearTrail(t);
    this.disposeVisual(t);
    this.trains = this.trains.filter((x) => x !== L);
    const refund = Math.round(g.economy.costs.train(locoModel(t.model)) * 0.5);
    g.economy.earn(refund, 'sale', false);
    g.events.emit('trainSold', t, refund);
    return refund;
  }

  upgrade(t, kind) {
    const g = this.game;
    const lvl = t.upg[kind];
    if (lvl >= 5) return 'err_max_level';
    const cost = g.economy.costs.trainUpgrade(locoModel(t.model), lvl);
    if (!g.economy.canAfford(cost)) return 'err_no_money';
    g.economy.spend(cost, 'upgrades');
    t.upg[kind]++;
    this.refreshStats(t);
    g.stats.inc('trainUpgrades');
    g.events.emit('trainUpgraded', t, kind);
    return null;
  }

  // ---------- visuals ----------
  consistSig(t) {
    const st = t._st;
    const m = st.model;
    const detail = Math.min(3, Math.floor((t.upg.engine + t.upg.accel + t.upg.efficiency) / 4));
    const styles = [];
    const paxW = st.pax > 0 ? (st.freight > 0 ? Math.max(1, Math.round(st.wagons * st.pax / (st.pax + st.freight))) : st.wagons) : 0;
    const freightLots = t.cargo.filter((l) => l.c !== 'PASSENGERS');
    const freightW = st.wagons - paxW;
    for (let i = 0; i < st.wagons; i++) {
      if (i < paxW) styles.push('coach::1');
      else {
        const fi = i - paxW;
        let lot = freightLots.length ? freightLots[Math.floor(fi * freightLots.length / Math.max(1, freightW))] : null;
        if (lot) styles.push(`${cargoStyle(lot.c)}:${lot.c}:1`);
        else styles.push(m.role === 'passenger' ? 'mail::0' : (m.kind === 'steam' ? 'log::0' : m.kind === 'steam2' ? 'bulk::0' : 'crate::0'));
      }
    }
    return `${t.model}|${t.livery}|${detail}|${styles.join(',')}`;
  }

  buildVisual(t) {
    this.disposeVisual(t);
    const sig = this.consistSig(t);
    const [modelId, livery, detail, stylesStr] = sig.split('|');
    const m = locoModel(modelId);
    const cols = liveryColors(m, livery);
    const group = new THREE.Group();
    const cars = [];
    const loco = new THREE.Mesh(locoGeometry(modelId, livery, +detail), MATS);
    loco.castShadow = true;
    loco.userData.train = t.id;
    group.add(loco); cars.push({ mesh: loco, len: LOCO_LEN, loco: true });
    for (const s of stylesStr ? stylesStr.split(',') : []) {
      const [style, cargo, loaded] = s.split(':');
      const geo = wagonGeometry(style, cargo || null, loaded === '1', m.kind, cols.body, cols.trim);
      const w = new THREE.Mesh(geo, MATS);
      w.castShadow = true;
      w.userData.train = t.id;
      group.add(w); cars.push({ mesh: w, len: WAGON_LEN });
    }
    let off = 0;
    for (const c of cars) { c.off = off + c.len / 2; off += c.len + CAR_GAP; }
    t.visual = { group, cars, total: off - CAR_GAP };
    t.visualSig = sig;
    this.group.add(group);
  }

  disposeVisual(t) {
    if (!t.visual) return;
    this.group.remove(t.visual.group);
    t.visual = null;
  }

  updateVisuals(dt, camera) {
    const g = this.game;
    const pf = new THREE.Vector3(), pr = new THREE.Vector3();
    this._pickList.length = 0;
    const night = g.env ? g.env.night : 0;
    for (const t of this.trains) {
      if (t.state === 'spawnwait' || !t.steps.length) { if (t.visual) t.visual.group.visible = false; continue; }
      if (!t.visual || t.visualSig !== this.consistSig(t)) this.buildVisual(t);
      const V = t.visual;
      V.group.visible = true;
      if (t.fade < 1) t.fade = Math.min(1, t.fade + dt * 1.5);
      const total = V.total;
      const sMin = t.ss[0];
      const inDepot = t.steps[0] && this.net.special.get(t.steps[0].tile)?.type === 'depot';
      const laneOff = LANE * t.lane;
      for (let ci = 0; ci < V.cars.length; ci++) {
        const c = V.cars[ci];
        const off = t.flip ? total - c.off : c.off;
        const sc = t.s - off;
        const half = c.len * 0.36;
        this.sampleAt(t, sc + half, pf);
        this.sampleAt(t, sc - half, pr);
        const dx = pf.x - pr.x, dz = pf.z - pr.z, dy = pf.y - pr.y;
        const len = Math.sqrt(dx * dx + dz * dz) || 1;
        const nx = -dz / len, nz = dx / len;
        const mesh = c.mesh;
        mesh.position.set((pf.x + pr.x) / 2 + nx * laneOff, (pf.y + pr.y) / 2 + 0.13, (pf.z + pr.z) / 2 + nz * laneOff);
        const yaw = Math.atan2(-dz, dx) + (t.flip ? Math.PI : 0);
        const pitch = Math.atan2(dy, len) * (t.flip ? -1 : 1);
        mesh.rotation.set(0, yaw, pitch, 'YXZ');
        let visible = true;
        if (inDepot && sc < sMin + 0.7) visible = false;
        const tile = worldToTile(mesh.position.x, mesh.position.z);
        if (tile >= 0 && this.net.kind(tile) === K_TUNNEL && this.net.conn[tile]) visible = false;
        mesh.visible = visible;
        const sc2 = t.spawnFx > 0 ? 1 + Math.sin((1 - t.spawnFx) * Math.PI * 3) * 0.08 * t.spawnFx : 1;
        mesh.scale.setScalar(sc2 * (0.6 + 0.4 * t.fade));
        if (visible) this._pickList.push(mesh);
        if (!Number.isFinite(mesh.position.x)) { mesh.visible = false; this.recoverTrain(t); break; }
      }
      // exhaust
      const loco = V.cars[0].mesh;
      if (loco.visible && t.state === 'run' && g.particles) {
        const m = t._st.model;
        t._puff = (t._puff || 0) + dt * (0.8 + t.v * 1.2);
        if (m.kind.startsWith('steam') && t._puff > 1) {
          t._puff = 0;
          _v.set(0.52, 0.85, 0).applyEuler(loco.rotation).add(loco.position);
          g.particles.emit('steam', _v.x, _v.y, _v.z, 1);
        } else if (m.kind === 'diesel' && t._puff > 2.5) {
          t._puff = 0;
          _v.set(-0.1, 0.8, 0).applyEuler(loco.rotation).add(loco.position);
          g.particles.emit('exhaust', _v.x, _v.y, _v.z, 1);
        }
      }
      void night;
    }
  }

  // ---------- persistence ----------
  serialize() {
    return this.trains.map((t) => {
      const hs = t.steps.length ? t.steps[this.stepAt(t, t.s)] : null;
      return {
        id: t.id, model: t.model, name: t.name, livery: t.livery, upg: t.upg, mode: t.mode, route: t.route, routeIdx: t.routeIdx,
        filter: t.filter, cargo: t.cargo, earned: t.earned, trips: t.trips, target: t.target, depotId: t.homeDepot,
        head: hs ? { tile: hs.tile, inH: hs.inH } : null, state: t.state, created: t.created,
      };
    });
  }

  deserialize(list) {
    this.trains = [];
    if (!Array.isArray(list)) return;
    const g = this.game, net = this.net;
    for (const d of list) {
      try {
        if (!d || !LOCOS.find((m) => m.id === d.model)) continue;
        const t = this.makeTrain(d);
        this.nextId = Math.max(this.nextId, t.id + 1);
        // discard cargo referencing missing stations
        t.cargo = t.cargo.filter((l) => g.stations.byId(l.from));
        this.trains.push(t);
        const h = d.head;
        let placed = false;
        if (h && typeof h.tile === 'number' && net.conn[h.tile]) {
          if (h.inH != null && net.hasDir(h.tile, opp(h.inH))) {
            const test = { tile: h.tile, inH: h.inH, outH: null };
            if (net.canReserve(net.laneKeys(test), t.id)) { this.placeAt(t, h.tile, h.inH); placed = true; }
          } else if (h.inH == null) {
            const dep = g.stations.depotAt(h.tile);
            if (dep) placed = this.spawnAtDepot(t, dep);
          }
        }
        if (!placed) this.recoverTrain(t);
        else {
          const stn = this.stationAtHead(t);
          if (stn && (d.state === 'load' || d.target === stn.id)) { t.state = 'load'; t.loadTime = 1.5; t.stateT = 0; t.target = stn.id; }
          else t.state = 'depart';
        }
      } catch (e) {
        console.warn('Train restore failed, skipping', e);
      }
    }
  }

  pickables() { return this._pickList; }

  electricCount() { return this.trains.filter((t) => locoModel(t.model).electric).length; }
}

export function eraResearch(era) { return ERA_RESEARCH[era] || null; }
export { tileCX, tileCZ, clamp };
