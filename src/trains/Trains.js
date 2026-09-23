// Train simulation. Each train owns a persistent consist (ordered vehicles,
// front → rear in the direction of travel) and a sampled trail of path steps.
// Vehicles follow the head at fixed distances along that trail, so every car
// stays on the same path. Movement is limited by an explicit reservation
// frontier (block groups, junction paths, single-track direction locks) that is
// extended ahead of the train and released behind its rear.
import * as THREE from 'three';
import { TILE, opp, turnOf, step, cheb, worldToTile, clamp, tileCX, tileCZ } from '../util.js';
import { LOCOS, TRACK_TIERS, KMH_PER_TILE_S, CARGO, ERA_RESEARCH, WAGONS, STATION } from '../config.js';
import { K_TUNNEL, K_BRIDGE } from '../rail/RailNetwork.js';
import { locoGeometry, wagonGeometry, liveryColors, couplerGeometry } from './TrainModels.js';
import {
  locoModel, parseConsist, serializeConsist, cloneConsist, computeStats, livePerf, cargoMass, assignLoads, roomFor, canCarry,
  canLead, vehLen, inferLegacy, consistCost, vehicleCost, validateConsist, autoBuild, GAP,
} from './Consist.js';
import { MATS } from '../core/ModelBuilder.js';

const LANE = 0.34;
const DECEL = 3.2;
const STOP_EXT = 0.6;      // stop this far past the platform-end tile center
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m4 = new THREE.Matrix4();
const _e = new THREE.Euler();
const _s1 = new THREE.Vector3(1, 1, 1);

export { locoModel };

export class TrainSystem {
  constructor(game) {
    this.game = game;
    this.trains = [];
    this.nextId = 1;
    this.group = new THREE.Group();
    this.group.name = 'trains';
    game.scene.add(this.group);
    this._pickList = [];
    this.couplers = new THREE.InstancedMesh(couplerGeometry(), MATS[0], 1000);
    this.couplers.count = 0; this.couplers.frustumCulled = false; this.couplers.castShadow = false;
    game.scene.add(this.couplers);
    this._deadT = 0;
    this.incidents = [];     // recent deadlock resolutions (advisor + debug)
    this.collisions = 0;     // invariant violations detected (should stay 0)
  }

  get net() { return this.game.net; }
  byId(id) { return this.trains.find((t) => t.id === id); }

  // ---------- stats ----------
  stats(t) { return computeStats(t.veh, t.upg, this.game.progression.fx); }
  trainLength(t) { return t._st.length; }
  refreshStats(t) { t._st = this.stats(t); t.model = t._st.model.id; t.visualSig = null; }

  // ---------- purchase ----------
  canBuy(vs, depot) {
    const g = this.game;
    if (typeof vs === 'string') vs = this.defaultConsist(vs, depot);
    const lead = vs.find((v) => v.k === 'L');
    if (!lead) return 'err_need_loco';
    for (const v of vs) if (v.k === 'L' && !g.progression.locoUnlocked(locoModel(v.id))) return 'err_train_locked';
    const verr = validateConsist(vs, g.progression.research);
    if (verr) return verr;
    if (!depot) return 'err_no_depot';
    if (!this.net.conn[depot.tile]) return 'err_depot_unconnected';
    const st = computeStats(vs, null, g.progression.fx);
    if (this.net.tier[depot.tile] < st.minTier) return st.minTier === 3 ? 'err_needs_hsr' : 'err_needs_electric';
    if (!g.economy.canAfford(consistCost(vs, g.economy.costs))) return 'err_no_money';
    return null;
  }

  defaultConsist(modelId, depot) {
    const g = this.game;
    const m = locoModel(modelId);
    // cargo the network near the depot offers
    const cargos = new Set();
    const comp = this.net.components();
    const k = depot ? comp[depot.tile] : -1;
    for (const s of g.stations.list) if (k >= 0 && comp[s.tile] === k) for (const c of s.supplies || []) if (g.stations.hasDemand(s, c, comp)) cargos.add(c);
    let list = [...cargos];
    if (m.role === 'passenger') list = list.filter((c) => c === 'PASSENGERS' || c === 'MAIL');
    else if (m.role === 'freight') list = list.filter((c) => c !== 'PASSENGERS');
    if (!list.length) list = m.role === 'freight' ? ['WOOD'] : ['PASSENGERS', 'MAIL'];
    return autoBuild(modelId, list.slice(0, 3), { research: g.progression.research, fx: g.progression.fx });
  }

  buy(consistOrModel, depot, name) {
    const g = this.game;
    const vs = typeof consistOrModel === 'string' ? this.defaultConsist(consistOrModel, depot) : cloneConsist(consistOrModel);
    const err = this.canBuy(vs, depot);
    if (err) return { error: err };
    const cost = consistCost(vs, g.economy.costs);
    const lead = vs.find((v) => v.k === 'L');
    const m = locoModel(lead.id);
    const count = this.trains.filter((t) => t.model === lead.id).length + 1;
    const t = this.makeTrain({ id: this.nextId++, veh: vs, name: name || `${m.name.split(' ')[0]} ${count}`, livery: g.progression.defaultLivery, depotId: depot.id });
    this.trains.push(t);
    if (!this.spawnAtDepot(t, depot)) t.state = 'spawnwait';
    g.economy.spend(cost, 'trains');
    g.stats.inc('trainsBought');
    for (const v of vs) if (v.k === 'L') g.progression.ownModel(v.id);
    g.events.emit('trainBought', t);
    return { train: t };
  }

  makeTrain(d) {
    let veh = Array.isArray(d.veh) ? cloneConsist(d.veh) : parseConsist(d.consist);
    if (!veh.length || !veh.some((v) => v.k === 'L')) veh = inferLegacy(LOCOS.some((m) => m.id === d.model) ? d.model : 'pioneer', [], this.game.progression.research);
    const t = {
      id: d.id, veh, model: veh.find((v) => v.k === 'L').id, name: d.name || 'Train', livery: d.livery || 'classic_green',
      upg: Object.assign({ engine: 0, capacity: 0, accel: 0, loading: 0, efficiency: 0 }, d.upg || {}),
      mode: d.mode === 'manual' ? 'manual' : 'auto',
      route: Array.isArray(d.route) ? d.route.filter((r) => r && (typeof r.st === 'number' || typeof r.wp === 'number')).map(normStop) : [],
      routeIdx: d.routeIdx | 0,
      filter: Array.isArray(d.filter) ? d.filter.filter((c) => CARGO[c]) : null,
      cargo: Array.isArray(d.cargo) ? d.cargo.filter((l) => l && CARGO[l.c] && l.n > 0).map((l) => ({ c: l.c, n: Math.floor(l.n), from: l.from })) : [],
      earned: d.earned || 0, trips: d.trips || 0, profitLog: d.profitLog || [],
      state: 'idle', stateT: 0, wait: 0, target: d.target ?? null, tgtKind: 'station', depotId: d.depotId ?? null,
      xs: [], ys: [], zs: [], ss: [], steps: [], s: 0, v: 0, stopS: Infinity, resvEnd: -1,
      lane: 1, held: new Set(), runs: new Set(), claim: null, problem: null, loadTime: 0, lastStepIdx: -1,
      visual: null, fade: 1, reroutes: 0, homeDepot: d.depotId ?? null, unreachable: new Map(), recover: 0,
      created: d.created || Date.now(), blockedBy: 0, blockKind: null, plat: null, curStop: null, rev: null, via: false,
      waitTotal: 0, pendingVeh: null, deadT: 0,
    };
    t._st = computeStats(t.veh, t.upg, this.game.progression.fx);
    return t;
  }

  // ---------- consist editing ----------
  // Price of turning the current consist into `vs` (new vehicles bought, removed ones refunded at 50%).
  consistChangeCost(t, vs) {
    const costs = this.game.economy.costs;
    const pool = t.veh.map((v) => `${v.k}:${v.id}`);
    let buy = 0;
    for (const v of vs) {
      const i = pool.indexOf(`${v.k}:${v.id}`);
      if (i >= 0) pool.splice(i, 1); else buy += vehicleCost(v, costs);
    }
    let refund = 0;
    for (const p of pool) { const [k, id] = p.split(':'); refund += Math.round(vehicleCost({ k, id }, costs) * 0.5); }
    return { buy, refund, net: buy - refund };
  }
  applyConsist(t, vs) {
    const g = this.game;
    const err = validateConsist(vs, g.progression.research);
    if (err) return err;
    for (const v of vs) if (v.k === 'L' && !g.progression.locoUnlocked(locoModel(v.id))) return 'err_train_locked';
    const cost = this.consistChangeCost(t, vs);
    if (cost.net > 0 && !g.economy.canAfford(cost.net)) return 'err_no_money';
    const st = computeStats(vs, t.upg, g.progression.fx);
    const onTrack = t.steps.length && t.state !== 'spawnwait';
    if (onTrack && st.minTier > 0) {
      for (let k = Math.max(0, this.stepAt(t, t.s - t._st.length)); k <= this.stepAt(t, t.s); k++) if (this.net.tier[t.steps[k].tile] < st.minTier) return st.minTier === 3 ? 'err_needs_hsr' : 'err_needs_electric';
    }
    if (cost.net > 0) g.economy.spend(cost.net, 'trains'); else if (cost.net < 0) g.economy.earn(-cost.net, 'sale', false);
    if (t.state === 'run' || t.state === 'reversing') { t.pendingVeh = cloneConsist(vs); return null; }
    this.setVehicles(t, cloneConsist(vs));
    return null;
  }
  setVehicles(t, vs) {
    const g = this.game;
    const oldLen = t._st.length;
    t.veh = vs;
    t.pendingVeh = null;
    this.refreshStats(t);
    for (const v of vs) if (v.k === 'L') g.progression.ownModel(v.id);
    // cargo without a compatible wagon goes back to the station (or is dropped)
    const { overflow } = assignLoads(t._st, t.cargo);
    const stn = this.stationAtHead(t);
    for (const c in overflow) {
      let n = overflow[c];
      for (let i = t.cargo.length - 1; i >= 0 && n > 0; i--) {
        const l = t.cargo[i];
        if (l.c !== c) continue;
        const take = Math.min(n, l.n);
        l.n -= take; n -= take;
        if (stn) g.stations.receive(stn, c, take);
      }
      t.cargo = t.cargo.filter((l) => l.n > 0);
    }
    // make sure the trail behind the head covers the (longer) consist
    if (t.steps.length && t._st.length > oldLen + 1e-6 && t.s - t.ss[0] < t._st.length + 0.2) {
      const { st } = this.headInfo(t);
      if (st && st.inH != null) { this.placeAt(t, st.tile, st.inH); t.fade = 0.5; }
    } else if (t.steps.length) this.resetReservation(t);
    g.events.emit('consistChanged', t);
  }

  // ---------- trail management ----------
  clearTrail(t) {
    this.releaseAll(t);
    t.xs.length = 0; t.ys.length = 0; t.zs.length = 0; t.ss.length = 0; t.steps.length = 0;
    t.resvEnd = -1;
  }
  releaseAll(t) {
    const net = this.net;
    net.release([...t.held], t.id);
    t.held.clear();
    for (const r of t.runs) net.runLockDrop(r, t.id);
    t.runs.clear();
  }

  decorate(st) {
    const net = this.net;
    st.keys = net.laneKeys(st);
    st.kind = net.kind(st.tile);
    st.jn = net.isJunction(st.tile);
    const sp = net.special.get(st.tile);
    st.station = sp && sp.type === 'station' ? sp.id : 0;
    st.single = !!net.single[st.tile] && !st.station && !st.jn;
    st.rid = st.single ? net.runId[st.tile] : -1;
    return st;
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
    const o = this.decorate({ tile: st.tile, inH: st.inH, outH: st.outH, s0, s1, sc: t.ss[startIdx + centerIdx] });
    t.steps.push(o);
    return o;
  }

  truncateAfter(t, sEnd) {
    let n = t.ss.length;
    while (n > 1 && t.ss[n - 1] > sEnd + 1e-6) n--;
    t.xs.length = n; t.ys.length = n; t.zs.length = n; t.ss.length = n;
    while (t.steps.length > 1 && t.steps[t.steps.length - 1].s0 >= sEnd - 1e-6) t.steps.pop();
    if (t.resvEnd > t.steps.length - 1) t.resvEnd = t.steps.length - 1;
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

  // lateral lane factor: 1 on double track, 0 on single track, blended at transitions
  laneFactor(t, s) {
    const k = this.stepAt(t, s);
    const st = t.steps[k];
    if (!st || !st.single) return 1;
    let f = 0;
    const pv = t.steps[k - 1], nx = t.steps[k + 1];
    if (pv && !pv.single) f = Math.max(f, 1 - (s - st.s0) / 0.7);
    if (nx && !nx.single) f = Math.max(f, 1 - (st.s1 - s) / 0.7);
    return clamp(f, 0, 1);
  }

  trim(t) {
    const L = this.trainLength(t);
    let k = 0;
    while (k < t.steps.length - 1 && t.steps[k].s1 < t.s - L - 4) k++;
    if (k === 0) return;
    // steps being dropped are behind the rear and no longer held
    const cut = t.steps[k].s0;
    t.steps.splice(0, k);
    t.resvEnd -= k;
    let p = 0;
    while (p < t.ss.length - 1 && t.ss[p + 1] <= cut + 1e-6) p++;
    t.xs.splice(0, p); t.ys.splice(0, p); t.zs.splice(0, p); t.ss.splice(0, p);
    const off = t.ss[0];
    for (let i = 0; i < t.ss.length; i++) t.ss[i] -= off;
    for (const s of t.steps) { s.s0 -= off; s.s1 -= off; s.sc -= off; }
    t.s -= off;
    if (isFinite(t.stopS)) t.stopS -= off;
  }

  // keys the train body would need after reversing (used before committing to a flip)
  canFlip(t) {
    const L = this.trainLength(t);
    const net = this.net;
    for (const o of t.steps) {
      if (o.s1 < t.s - L - 0.05) continue;
      if (o.s0 > t.s + 0.01) break;
      const r = { tile: o.tile, inH: o.outH == null ? null : opp(o.outH), outH: o.inH == null ? null : opp(o.inH) };
      if (!net.canReserve(net.laneKeys(r), t.id)) return false;
      // reversing inside a single-track section needs its direction lock
      if (o.rid >= 0 && !net.runLockOk(o.rid, net.runSense(r), t.id)) return false;
    }
    return true;
  }

  // Reverse the direction of travel: the trail is mirrored so the old rear
  // becomes the head, and the vehicle list is reversed with each vehicle's
  // orientation toggled. Every vehicle keeps its world position and heading.
  flipTrain(t) {
    const L = this.trainLength(t);
    // the body stays on its old lane until the lane change finishes: keep those keys
    const oldKeys = [];
    for (const o of t.steps) if (o.s1 >= t.s - L - 0.05 && o.s0 < t.s - 0.01) for (const k of o.keys) if (k >= 0 && this.net.resv[k] === t.id) oldKeys.push(k);
    this.truncateAfter(t, t.s);
    const S = t.s;
    const n = t.ss.length;
    const xs = [], ys = [], zs = [], ss = [];
    for (let i = n - 1; i >= 0; i--) { xs.push(t.xs[i]); ys.push(t.ys[i]); zs.push(t.zs[i]); ss.push(S - t.ss[i]); }
    t.xs = xs; t.ys = ys; t.zs = zs; t.ss = ss;
    const steps = [];
    for (let i = t.steps.length - 1; i >= 0; i--) {
      const o = t.steps[i];
      const r = { tile: o.tile, inH: o.outH == null ? null : opp(o.outH), outH: o.inH == null ? null : opp(o.inH), s0: Math.max(0, S - o.s1), s1: Math.max(S - o.s0, S - o.s1), sc: S - o.sc };
      steps.push(this.decorate(r));
    }
    t.steps = steps;
    t.s = Math.min(L, ss[ss.length - 1]);
    t.veh = t.veh.slice().reverse().map((v) => ({ k: v.k, id: v.id, r: !v.r, anim: v.anim }));
    t.lane = -t.lane;
    t.visualSig = null;
    this.resetReservation(t);
    t.slideKeys = t.lane < 1 ? oldKeys.filter((k) => !this.net.resv[k] || this.net.resv[k] === t.id) : null;
    if (t.slideKeys) { this.net.reserve(t.slideKeys, t.id); for (const k of t.slideKeys) t.held.add(k); }
  }

  bodyHasKey(t, key) {
    const L = this.trainLength(t);
    for (let k = 0; k <= t.resvEnd && k < t.steps.length; k++) { const o = t.steps[k]; if (o.s1 < t.s - L - 0.05) continue; if (o.keys.includes(key)) return true; }
    return false;
  }

  // Release everything and hold exactly the tiles under the train body.
  resetReservation(t) {
    const net = this.net;
    this.releaseAll(t);
    if (!t.steps.length) { t.resvEnd = -1; return; }
    const L = this.trainLength(t);
    const head = this.stepAt(t, t.s);
    for (let k = 0; k <= head; k++) {
      const st = t.steps[k];
      if (st.s1 < t.s - L - 0.05) continue;
      // never take a key another train owns (fouling keys of a re-planned head step)
      const mine = st.keys.filter((key) => net.canReserve([key], t.id));
      net.reserve(mine, t.id);
      for (const key of mine) t.held.add(key);
      if (st.rid >= 0) { net.runLockAdd(st.rid, net.runSense(st), t.id); t.runs.add(st.rid); }
    }
    t.resvEnd = head;
    // still sliding over to the new lane: keep the old lane
    if (t.slideKeys && t.lane < 1) {
      t.slideKeys = t.slideKeys.filter((k) => !net.resv[k] || net.resv[k] === t.id);
      net.reserve(t.slideKeys, t.id); for (const k of t.slideKeys) t.held.add(k);
    }
  }

  // Place a train with its head at the center of `tile`, arriving with heading h.
  placeAt(t, tile, h) {
    this.clearTrail(t);
    const net = this.net;
    const L = this.trainLength(t) + 1;
    const seq = [];
    let cur = tile, heading = h, acc = 0;
    seq.push({ tile, inH: h, outH: net.smoothExit(tile, h) });
    acc += TILE / 2;
    let guard = 0;
    while (acc < L && guard++ < 40) {
      const prev = step(cur, opp(heading));
      if (prev < 0 || !net.hasDir(cur, opp(heading))) break;
      let hp = null, best = 9;
      for (let d = 0; d < 8; d++) {
        if (!net.hasDir(prev, d) || d === heading) continue;
        const cand = opp(d);
        const tt = turnOf(cand, heading);
        if (tt <= 3 && tt < best) { best = tt; hp = cand; }
      }
      const sd = net.special.get(prev);
      if (sd && sd.type === 'depot') hp = null;
      seq.push({ tile: prev, inH: hp, outH: heading });
      acc += TILE;
      if (hp == null) break;
      cur = prev; heading = hp;
    }
    seq.reverse();
    for (const st of seq) this.appendStep(t, st);
    const head = t.steps[t.steps.length - 1];
    t.s = head.sc;
    t.v = 0;
    t.lane = 1;
    t.stopS = t.s;
    this.resetReservation(t);
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
    t.s = 0; t.v = 0; t.lane = 1;
    t.homeDepot = depot.id;
    this.resetReservation(t);
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

  // tgt: {tile, heading|null}. Options: continue forward, depart from the
  // current tile center, or reverse from the rear of the train.
  planOptions(t, tgt, allowReverse) {
    const net = this.net;
    const minTier = t._st.minTier;
    const { st } = this.headInfo(t);
    if (!st) return [];
    const ro = { minTier, allowReverse: true, targetHeading: tgt.heading };
    const opts = [];
    const atCenter = Math.abs(t.s - st.sc) < 0.05;
    if (atCenter) {
      const r = net.findRoute({ tile: st.tile, heading: st.inH, fromCenter: true }, tgt.tile, ro);
      if (r && (r.steps.length || st.tile === tgt.tile)) opts.push({ kind: 'center', route: r, cost: r.length });
    } else if (st.outH != null && net.hasDir(st.tile, st.outH) && t.s < st.s1 + 1e-6) {
      const nt = step(st.tile, st.outH);
      if (nt >= 0) {
        const r = net.findRoute({ tile: nt, heading: st.outH, fromCenter: false }, tgt.tile, ro);
        if (r) opts.push({ kind: 'forward', route: r, cost: r.length + (st.s1 - t.s) / TILE });
      }
    }
    if (allowReverse && this.canFlip(t)) {
      const L = this.trainLength(t);
      const tk = this.stepAt(t, Math.max(t.ss[0] || 0, t.s - L));
      const ts = t.steps[tk];
      const revCost = 1.5 + L / TILE + (canLead(t.veh[t.veh.length - 1]) ? 0 : 3);
      if (ts && ts.inH != null) {
        const rh = opp(ts.inH);
        const nt = step(ts.tile, rh);
        if (nt >= 0 && net.hasDir(ts.tile, rh)) {
          const r = net.findRoute({ tile: nt, heading: rh, fromCenter: false }, tgt.tile, ro);
          if (r) opts.push({ kind: 'reverse', route: r, cost: r.length + revCost });
        }
      } else if (ts && ts.outH != null) {
        const r = net.findRoute({ tile: ts.tile, heading: opp(ts.outH), fromCenter: true }, tgt.tile, ro);
        if (r) opts.push({ kind: 'reverse', route: r, cost: r.length + revCost });
      }
    }
    for (const o of opts) o.tgt = tgt;
    opts.sort((a, b) => a.cost - b.cost);
    return opts;
  }

  applyRoute(t, opt) {
    const net = this.net;
    if (opt.kind === 'reverse') {
      this.flipTrain(t);
      const o2 = this.planOptions(t, opt.tgt, false);
      if (!o2.length) return false;
      if (!this.applyRoute(t, o2[0])) return false;
      t.flipped = true;
      return true;
    }
    const { k, st } = this.headInfo(t);
    if (opt.kind === 'center') {
      const first = opt.route.firstOut;
      if (first == null) {
        this.truncateAfter(t, st.s1);
        t.stopS = st.sc; this.resetReservation(t); return true;
      }
      if (st.outH === first) this.truncateAfter(t, st.s1);
      else {
        this.truncateAfter(t, t.s);
        t.steps.length = k + 1;
        const n0 = t.xs.length;
        net.sampleStep(st.tile, null, first, t.xs, t.ys, t.zs, true);
        for (let i = n0; i < t.xs.length; i++) {
          const dx = t.xs[i] - t.xs[i - 1], dy = t.ys[i] - t.ys[i - 1], dz = t.zs[i] - t.zs[i - 1];
          t.ss.push(t.ss[i - 1] + Math.sqrt(dx * dx + dy * dy + dz * dz));
        }
        st.outH = first; st.s1 = t.ss[t.ss.length - 1];
        this.decorate(st);
      }
    } else {
      this.truncateAfter(t, st.s1);
      t.steps.length = this.stepAt(t, t.s) + 1;
    }
    for (const s of opt.route.steps) this.appendStep(t, s);
    const last = t.steps[t.steps.length - 1];
    t.stopS = last.sc + this.stopExt(last, opt.tgt);
    t.via = !!opt.route.reverse;
    this.resetReservation(t);
    return true;
  }

  // Stop near the far end of a platform when the track continues straight on.
  stopExt(last, tgt) {
    if (!tgt || tgt.wp || last.inH == null || last.outH == null || last.inH !== last.outH) return 0;
    if (!last.station || this.net.degree(last.tile) !== 2) return 0;
    return Math.min(STOP_EXT, last.s1 - last.sc - 0.05);
  }

  // Terminus fallback when a consist can neither run on nor reverse out:
  // the train re-forms at the station (fade) and departs toward the target.
  turnaround(t, tgt) {
    const net = this.net;
    const { st: hs } = this.headInfo(t);
    if (!hs) return false;
    const h = hs.inH != null ? opp(hs.inH) : (hs.outH != null ? opp(hs.outH) : null);
    const r = net.findRoute({ tile: hs.tile, heading: h, fromCenter: true }, tgt.tile, { minTier: t._st.minTier, allowReverse: true, targetHeading: tgt.heading });
    if (!r || r.firstOut == null) return false;
    const first = { tile: hs.tile, inH: null, outH: r.firstOut };
    if (!net.canReserve(net.laneKeys(first), t.id)) return false;
    this.clearTrail(t);
    this.appendStep(t, first);
    t.s = 0; t.v = 0; t.lane = 1;
    for (const s2 of r.steps) this.appendStep(t, s2);
    const last = t.steps[t.steps.length - 1];
    t.stopS = last.sc + this.stopExt(last, tgt);
    t.via = !!r.reverse;
    t.veh = t.veh.map((v) => ({ k: v.k, id: v.id, r: v.k === 'L' ? false : v.r }));
    t.visualSig = null;
    t.fade = 0;
    this.resetReservation(t);
    return true;
  }

  // reached a shunting point: reverse direction and continue to the target
  viaReverse(t) {
    t.via = false; t.v = 0;
    const tgt = t.plat ? { tile: t.plat.tile, heading: t.plat.heading } : null;
    if (!tgt) { t.state = 'idle'; t.stateT = 0; return; }
    const opts = this.planOptions(t, tgt, true).filter((o) => o.kind === 'reverse');
    if (opts.length && this.applyRoute(t, opts[0])) { this.afterReverse(t, 'run'); return; }
    const any = this.planOptions(t, tgt, false);
    if (!any.length || !this.applyRoute(t, any[0])) { t.state = 'lost'; t.stateT = 0; t.problem = 'no_route'; }
  }

  // After a reversal: if the new front vehicle has no forward-facing cab the
  // locomotive runs around (steam engines turn on the turntable) before leaving.
  afterReverse(t, next) {
    t.flipped = false;
    const front = t.veh[0];
    if (canLead(front)) { t.state = next; t.stateT = 0; return; }
    let rear = [];
    if (front.k === 'L') rear = [0];      // steam engine leading backwards: turn in place
    else {
      for (let i = t.veh.length - 1; i >= 0 && t.veh[i].k === 'L'; i--) rear.push(i);
    }
    if (!rear.length) { t.state = next; t.stateT = 0; return; }   // no engine at the ends: propel
    const steam = rear.some((i) => !locoModel(t.veh[i].id).kind.startsWith('steam') ? false : true);
    t.rev = { p: 0, dur: steam ? 2.2 : 1.8, idx: rear, swapped: false, inPlace: front.k === 'L', steam, next, hold: 0 };
    t.state = 'reversing'; t.stateT = 0; t.v = 0;
    this.game.events.emit('trainRunaround', t);
  }

  tickReversing(t, dt) {
    const R = t.rev;
    if (!R) { t.state = 'run'; return; }
    if (t.lane < 1 && !R.swapped) return;
    if (R.p < 0.5 || R.swapped) R.p = Math.min(1, R.p + dt / R.dur);
    if (R.p >= 0.5 && !R.swapped) {
      if (R.inPlace) {
        t.veh[0] = { k: 'L', id: t.veh[0].id, r: false };
        R.swapped = true; R.moved = [0];
      } else {
        const moving = R.idx.map((i) => t.veh[i]).reverse();
        let Lm = 0; for (const v of moving) Lm += vehLen(v) + GAP;
        // the engine re-couples ahead of the old front: needs reserved track there
        this.updateReservation(t, Lm + 0.4);
        const endS = t.steps[t.resvEnd] ? Math.min(t.steps[t.resvEnd].s1, t.ss[t.ss.length - 1]) : t.s;
        if (endS >= t.s + Lm + 0.05) {
          const rest = t.veh.filter((v, i) => !R.idx.includes(i));
          t.veh = [...moving.map((v) => ({ k: 'L', id: v.id, r: false })), ...rest];
          t.s += Lm;
          R.swapped = true; R.moved = moving.map((v, i) => i);
          this.updateReservation(t, 0.5);
        } else {
          R.hold += dt;
          if (R.hold > 12) { R.swapped = true; R.moved = []; }   // propel instead
        }
      }
      t.visualSig = null;
    }
    if (R.p >= 1) { t.rev = null; t.state = R.next; t.stateT = 0; t.visualSig = null; }
  }

  // ---------- targets & dispatcher ----------
  stationAccepts(stn, lot) {
    if (lot.from === stn.id) return false;
    return this.game.stations.accepts(stn, lot.c);
  }

  // Choose platform + route toward station stn. pref = preferred track index.
  planToStation(t, stn, pref) {
    const S = this.game.stations;
    const tgts = S.targetsFor(stn, t);
    const L = this.trainLength(t);
    let best = null;
    for (const tg of tgts) {
      const opts = this.planOptions(t, tg, true);
      if (!opts.length) continue;
      const o = opts[0];
      let pen = 0;
      if (S.platformBusy(stn, tg.track, t.id)) pen += 7;
      if (pref != null && pref === tg.track) pen -= 4;
      pen += S.rolePenalty(stn, tg.track, t._st.priority);
      const fit = tg.len * TILE + STOP_EXT;
      if (L > fit) pen += Math.min(4, (L - fit) / TILE);
      o.cost += pen;
      if (!best || o.cost < best.cost) best = o;
    }
    return best;
  }

  claimPlatform(t, stn, tgt) {
    const S = this.game.stations;
    S.unclaimPlatform(t.id);
    if (stn && tgt && tgt.track != null) { t.plat = { stn: stn.id, track: tgt.track, tile: tgt.tile, heading: tgt.heading }; S.claimPlatform(stn, tgt.track, t.id); }
    else if (tgt) t.plat = { stn: null, track: null, tile: tgt.tile, heading: tgt.heading };
  }

  nextStop(t) {
    const S = this.game.stations, net = this.net;
    const n = t.route.length;
    for (let tries = 0; tries < n; tries++) {
      const r = t.route[t.routeIdx % n];
      if (!r.skip) {
        if (r.wp != null && net.waypoints.has(r.wp)) return r;
        if (r.st != null && S.byId(r.st)) return r;
      }
      t.routeIdx = (t.routeIdx + 1) % n;
    }
    return null;
  }

  chooseTarget(t, here) {
    const g = this.game, S = g.stations;
    if (t.mode === 'manual') {
      const valid = t.route.filter((r) => !r.skip && ((r.st != null && S.byId(r.st)) || (r.wp != null && this.net.waypoints.has(r.wp))));
      if (valid.length < 2 && !(valid.length === 1 && (!here || valid[0].st !== here.id))) { t.problem = 'route_short'; return null; }
      t.routeIdx = t.routeIdx % t.route.length;
      for (let tries = 0; tries < t.route.length; tries++) {
        const r = this.nextStop(t);
        if (!r) return null;
        if (r.wp != null) return { wp: r.wp, stop: r };
        const stn = S.byId(r.st);
        if (stn && (!here || stn.id !== here.id)) return { stn, stop: r };
        t.routeIdx = (t.routeIdx + 1) % t.route.length;
      }
      return null;
    }
    const net = this.net;
    const comp = net.components();
    const fromTile = here ? here.tile : t.steps.length ? t.steps[this.stepAt(t, t.s)].tile : -1;
    if (fromTile < 0) return null;
    const c0 = comp[t.steps.length ? t.steps[this.stepAt(t, t.s)].tile : fromTile];
    const cands = S.list.filter((s) => s !== here && comp[s.tile] === c0 && c0 >= 0 && !this.isUnreachable(t, s.id));
    if (!cands.length) { t.problem = 'no_stations'; return null; }
    const st = t._st;
    if (t.cargo.length) {
      let best = null, bs = 0;
      for (const d of cands) {
        let v = 0;
        for (const lot of t.cargo) if (this.stationAccepts(d, lot)) v += g.economy.estimate(lot.c, lot.n, S.byId(lot.from), d, t);
        const sc = v / (cheb(fromTile, d.tile) + 6);
        if (sc > bs) { bs = sc; best = d; }
      }
      if (best) return { stn: best, stop: null };
    }
    let best = null, bs = 0, bc = null, bn = 0;
    for (const d of cands) {
      for (const c in d.stock) {
        const amt = d.stock[c] - (d.claimed[c] || 0);
        if (amt < 3) continue;
        if (t.filter && !t.filter.includes(c)) continue;
        if (!canCarry(st, c)) continue;
        const room = roomFor(st, t.cargo, c);
        if (room <= 0) continue;
        if (!S.hasDemand(d, c, comp)) continue;
        const n = Math.min(amt, room);
        const sc = (n * CARGO[c].value) / (cheb(fromTile, d.tile) + 8) * (0.9 + Math.random() * 0.2);
        if (sc > bs) { bs = sc; best = d; bc = c; bn = n; }
      }
    }
    if (best) { this.setClaim(t, best, bc, bn); return { stn: best, stop: null }; }
    t.problem = t.cargo.length ? 'no_demand' : (st.capFull ? 'no_cargo' : 'no_wagons');
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
  loadTotal(t) { let n = 0; for (const l of t.cargo) n += l.n; return n; }

  // ---------- state machine ----------
  depart(t) {
    const g = this.game;
    const here = this.stationAtHead(t);
    const choice = this.chooseTarget(t, here);
    if (!choice) {
      if (t.problem === 'no_demand' && t.mode === 'auto') {
        const comp = this.net.components();
        t.cargo = t.cargo.filter((l) => g.stations.list.some((s) => comp[s.tile] >= 0 && this.stationAccepts(s, l)));
        t.visualSig = null;
      }
      t.state = t.state === 'lost' ? 'lost' : 'idle'; t.stateT = 0; return;
    }
    let opt = null, tgt = null;
    if (choice.wp != null) {
      tgt = { tile: choice.wp, heading: null, wp: true };
      const o = this.planOptions(t, tgt, true);
      opt = o[0] || null;
    } else {
      opt = this.planToStation(t, choice.stn, choice.stop && choice.stop.plat != null ? choice.stop.plat : null);
      tgt = opt ? opt.tgt : null;
    }
    if (!opt && here && choice.stn && this.canFlip(t)) {
      for (const tg of g.stations.targetsFor(choice.stn, t)) if (this.turnaround(t, tg)) { tgt = tg; opt = 'turned'; break; }
    }
    const idKey = choice.stn ? choice.stn.id : -choice.wp;
    if (!opt) {
      t.unreachable.set(idKey, g.time + 45);
      this.releaseClaim(t);
      if (t.mode === 'manual') { t.problem = t._st.minTier ? 'needs_electric' : 'no_route'; t.routeIdx = (t.routeIdx + 1) % Math.max(1, t.route.length); }
      else t.problem = 'no_route';
      t.state = 'idle'; t.stateT = 0;
      return;
    }
    if (opt !== 'turned') {
      if (!this.applyRoute(t, opt)) {
        t.unreachable.set(idKey, g.time + 20);
        t.problem = 'no_route'; t.state = 'idle'; t.stateT = 0;
        return;
      }
    }
    t.tgtKind = choice.wp != null ? 'wp' : 'station';
    t.target = choice.stn ? choice.stn.id : null;
    t.targetWp = choice.wp ?? null;
    t.curStop = choice.stop;
    this.claimPlatform(t, choice.stn, tgt);
    t.problem = null; t.pulled = false;
    t.wait = 0; t.recover = 0; t.reroutes = 0; t.lastStepIdx = -1; t.blockedBy = 0;
    if (t.flipped) this.afterReverse(t, 'run'); else { t.state = 'run'; t.stateT = 0; }
    g.events.emit('trainDepart', t, here);
  }

  stationAtHead(t) {
    if (!t.steps.length) return null;
    const st = t.steps[this.stepAt(t, t.s)];
    if (!st || !st.station) return null;
    return this.game.stations.byId(st.station);
  }

  // fraction of the train standing on platform tiles of stn
  platformFraction(t, stn) {
    const L = this.trainLength(t);
    const a = t.s - L, b = t.s;
    let on = 0;
    for (const st of t.steps) {
      if (st.s1 < a || st.s0 > b) continue;
      if (st.station !== stn.id) continue;
      on += Math.max(0, Math.min(b, st.s1) - Math.max(a, st.s0));
    }
    return clamp(on / Math.max(0.1, L), 0, 1);
  }

  // Sensible stop positions: after stopping, a train whose rear still blocks a
  // single-track section or a junction pulls further ahead when the track allows.
  blockingEnd(t) {
    const L = this.trainLength(t);
    const h = this.stepAt(t, t.s);
    let end = -Infinity;
    for (let k = 0; k < h; k++) {
      const o = t.steps[k];
      if (o.s1 < t.s - L + 0.05) continue;
      if (o.rid >= 0 || o.jn) end = Math.max(end, o.s1);
    }
    return end;
  }
  pullForward(t) {
    const net = this.net;
    const end = this.blockingEnd(t);
    if (!isFinite(end)) return false;
    const need = end + this.trainLength(t) + 0.15;
    const last0 = t.steps.length;
    let last = t.steps[t.steps.length - 1];
    let guard = 0;
    while (guard++ < 6) {
      const reach = last.outH != null ? last.s1 - 0.05 : last.sc;
      if (reach >= need) break;
      if (last.outH == null || !net.hasDir(last.tile, last.outH)) break;
      const j = step(last.tile, last.outH);
      const sp = j >= 0 ? net.special.get(j) : null;
      if (j < 0 || net.isJunction(j) || (sp && sp.type === 'depot')) break;
      const st = this.appendStep(t, { tile: j, inH: last.outH, outH: net.smoothExit(j, last.outH) });
      if (!net.canReserve(st.keys, t.id) || (st.rid >= 0 && !net.runLockOk(st.rid, net.runSense(st), t.id))) { this.truncateAfter(t, st.s0); t.steps.length = t.steps.length; break; }
      last = st;
    }
    const lastS = t.steps[t.steps.length - 1];
    const reach = lastS.outH != null && net.hasDir(lastS.tile, lastS.outH) ? lastS.s1 - 0.05 : lastS.sc;
    if (reach < need) { if (t.steps.length > last0) { this.truncateAfter(t, t.steps[last0 - 1].s1); } return false; }
    t.stopS = Math.max(t.stopS, need);
    return true;
  }

  arrive(t) {
    const g = this.game, S = g.stations;
    if (!t.pulled && t.tgtKind !== 'wp' && this.pullForward(t)) { t.pulled = true; t.state = 'run'; return; }
    if (t.tgtKind === 'wp') {
      if (t.mode === 'manual' && t.route.length) t.routeIdx = (t.routeIdx + 1) % t.route.length;
      t.state = 'depart'; t.stateT = 0; t.v = 0;
      return;
    }
    const stn = this.stationAtHead(t) || S.byId(t.target);
    t.state = 'load'; t.stateT = 0; t.v = 0;
    t.loadedHere = 0;
    if (t.pendingVeh) this.setVehicles(t, t.pendingVeh);
    if (!stn) { t.loadTime = 0.5; return; }
    if (t.claim && t.claim.st === stn.id) this.releaseClaim(t);
    const opt = t.curStop || { act: 'auto' };
    let moved = 0;
    const keep = [];
    const unload = opt.act !== 'load' && opt.act !== 'none';
    for (const lot of t.cargo) {
      if (unload && opt.act === 'transfer' && lot.from !== stn.id) {
        // feeder transfer: cargo waits at this station for another train
        const took = S.receive(stn, lot.c, lot.n);
        if (took > 0) {
          const share = Math.round(g.economy.estimate(lot.c, took, S.byId(lot.from), stn, t) * 0.4);
          g.economy.earn(share, 'delivery', true); t.earned += share;
          S.noteTransfer(stn, lot.c, took);
          moved += took;
          if (took < lot.n) keep.push({ c: lot.c, n: lot.n - took, from: lot.from });
          continue;
        }
      }
      const accept = unload && this.stationAccepts(stn, lot);
      if (accept) { g.economy.deliver(t, stn, lot); moved += lot.n; } else keep.push(lot);
    }
    if (t.mode === 'manual') {
      const stops = t.route.map((r) => S.byId(r.st)).filter(Boolean);
      for (let i = keep.length - 1; i >= 0; i--) {
        const lot = keep[i];
        if (!stops.some((s) => this.stationAccepts(s, lot))) keep.splice(i, 1);
      }
    }
    t.cargo = keep;
    if (t.mode === 'manual' && t.route.length) {
      const cur = t.route[t.routeIdx % t.route.length];
      if (cur && cur.st === stn.id) t.routeIdx = (t.routeIdx + 1) % t.route.length;
    }
    const planned = opt.act === 'unload' || opt.act === 'none' ? 0 : this.planLoad(t, stn, true, opt);
    const eff = Math.max(STATION.minPlatformEff, this.platformFraction(t, stn));
    t.platEff = eff;
    const rate = S.loadRate(stn) * t._st.load * eff;
    t.loadTime = 1.2 + (moved + planned) / Math.max(1, rate) + (opt.dwell || 0);
    t.waitFull = !!opt.full && opt.act !== 'unload' && opt.act !== 'none';
    t.trips++;
    if (moved > 0) t.visualSig = null;
    S.noteArrival(stn, t, moved);
    g.events.emit('trainArrive', t, stn, moved);
  }

  planLoad(t, stn, dry, opt) {
    const g = this.game, S = g.stations;
    const comp = this.net.components();
    const lots = t.cargo.map((l) => ({ c: l.c, n: l.n, from: l.from }));
    const stops = t.mode === 'manual' ? t.route.map((r) => S.byId(r.st)).filter((s) => s && s !== stn) : null;
    const only = opt && Array.isArray(opt.cargo) && opt.cargo.length ? opt.cargo : null;
    const cargos = Object.keys(stn.stock).filter((c) => stn.stock[c] >= 1);
    const scored = [];
    for (const c of cargos) {
      if (t.filter && !t.filter.includes(c)) continue;
      if (only && !only.includes(c)) continue;
      if (!canCarry(t._st, c)) continue;
      let ok;
      if (stops) ok = stops.some((s) => S.accepts(s, c) || (t.route.find((r) => r.st === s.id) || {}).act === 'transfer');
      else ok = S.hasDemand(stn, c, comp, t);
      if (!ok) continue;
      scored.push({ c, sc: stn.stock[c] * CARGO[c].value });
    }
    scored.sort((a, b) => b.sc - a.sc);
    let total = 0;
    for (const { c } of scored) {
      const room = roomFor(t._st, lots, c);
      if (room <= 0) continue;
      const claimedByOthers = (stn.claimed[c] || 0);
      const avail = Math.floor(stn.stock[c] - (t.claim && t.claim.st === stn.id ? 0 : Math.min(claimedByOthers, stn.stock[c] * 0.5)));
      const n = Math.min(avail, room);
      if (n <= 0) continue;
      total += n;
      const lot = lots.find((l) => l.c === c && l.from === stn.id);
      if (lot) lot.n += n; else lots.push({ c, n, from: stn.id });
      if (!dry) {
        stn.stock[c] -= n;
        g.stations.onPickup(stn, c, n);
      }
    }
    if (!dry) t.cargo = lots;
    return total;
  }

  isFull(t) {
    const st = t._st;
    const { wagons } = assignLoads(st, t.cargo);
    let cap = 0, n = 0;
    for (const w of wagons) { cap += w.cap; n += w.n; }
    return cap > 0 && n >= cap - 0.5;
  }
  fillRatio(t) {
    const st = t._st;
    return st.capFull ? clamp(this.loadTotal(t) / st.capFull, 0, 1) : 0;
  }

  tick(dt) {
    const g = this.game;
    // any network edit invalidates run ids/locks: re-derive every train's reservations
    if (this._netV !== this.net.version) this.onNetworkChanged(false);
    this.net.tickSwitches(dt);
    // higher priority trains claim contested track first
    const order = this.trains.slice().sort((a, b) => (b._st.prioRank - a._st.prioRank) || (a.id - b.id));
    for (const t of order) {
      try { this.tickTrain(t, dt); } catch (e) { console.error('train tick error', e); this.recoverTrain(t); }
    }
    this._deadT -= dt;
    if (this._deadT <= 0) { this._deadT = 1; this.detectDeadlocks(); this.checkInvariants(); }
    let op = 0;
    for (const t of this.trains) op += t._st.op * (t.state === 'idle' ? 0.3 : 1);
    if (op > 0) g.economy.operatingCost((op / 60) * dt);
  }

  tickTrain(t, dt) {
    const g = this.game;
    t.stateT += dt;
    if (t.spawnFx > 0) t.spawnFx = Math.max(0, t.spawnFx - dt * 0.6);
    if (t.lane < 1) {
      t.lane = Math.min(1, t.lane + dt * (g.settings.reducedMotion ? 10 : 1.2));
      if (t.lane >= 1 && t.slideKeys) { const keep = new Set(); for (const o of t.steps) for (const k of o.keys) keep.add(k); for (const k of t.slideKeys) if (!keep.has(k) || true) { if (!this.bodyHasKey(t, k)) { this.net.release([k], t.id); t.held.delete(k); } } t.slideKeys = null; }
    }
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
          const opt = t.curStop || { act: 'auto' };
          if (stn && opt.act !== 'unload' && opt.act !== 'none') {
            const n = this.planLoad(t, stn, false, opt);
            if (n > 0) { t.visualSig = null; t.loadedHere += n; g.events.emit('trainLoaded', t, stn, n); }
          }
          if (t.waitFull && stn && !this.isFull(t) && t.stateT < t.loadTime + 150) { t.loadTime = t.stateT + 1.5; return; }
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
      case 'reversing': this.tickReversing(t, dt); return;
      case 'run': this.move(t, dt); return;
      default: t.state = 'idle';
    }
  }

  // Extend the reservation frontier up to `lookahead` beyond the head and
  // release everything behind the rear. Returns {limitS, blocker, kind}.
  updateReservation(t, lookahead) {
    const net = this.net, S = t.steps;
    const L = this.trainLength(t);
    const tailS = t.s - L;
    const head = this.stepAt(t, t.s);
    if (t.resvEnd < head) {
      // should not happen (body is always held); re-hold defensively
      for (let k = Math.max(0, t.resvEnd + 1); k <= head; k++) if (net.canReserve(S[k].keys, t.id)) net.reserve(S[k].keys, t.id);
      t.resvEnd = head;
    }
    let limitS = Infinity, blocker = 0, kind = null;
    while (t.resvEnd < S.length - 1) {
      const k = t.resvEnd + 1;
      if (S[k].s0 > t.s + lookahead) break;
      const e = this.groupEnd(t, k);
      const r = this.tryReserve(t, k, e);
      if (r === true) { t.resvEnd = e; t.waitKeys = null; continue; }
      blocker = r.blocker; kind = r.kind;
      limitS = S[k].s0 - 0.3;
      // publish what we are waiting for (fairness: see yieldsTo)
      if (r.kind !== 'yield' || !t.waitKeys) { const wk = []; for (let i = k; i <= e; i++) wk.push(...S[i].keys); t.waitKeys = wk; }
      t.waitStamp = this.game.time;
      break;
    }
    // held keys: steps from the rear to the frontier
    const need = new Set(), runs = new Set();
    for (let k = 0; k <= t.resvEnd && k < S.length; k++) {
      const st = S[k];
      if (st.s1 < tailS - 0.05) continue;
      for (const key of st.keys) if (key < 0 || net.resv[key] === t.id) need.add(key);
      if (st.rid >= 0) runs.add(st.rid);
    }
    if (t.slideKeys) { if (t.lane >= 1) t.slideKeys = null; else for (const k of t.slideKeys) if (net.resv[k] === t.id) need.add(k); }
    for (const key of t.held) if (!need.has(key)) net.release([key], t.id);
    t.held = need;
    for (const r of t.runs) if (!runs.has(r)) net.runLockDrop(r, t.id);
    t.runs = runs;
    if (t.resvEnd < S.length - 1) limitS = Math.min(limitS, S[t.resvEnd].s1 - 0.02);
    return { limitS, blocker, kind };
  }

  // Steps k..e that must be reserved together so the train never stops in a
  // place that blocks others: inside a junction (plus its own length beyond),
  // inside a single-track run, or inside a manual BLOCK signal section.
  groupEnd(t, k) {
    const S = t.steps, n = S.length, net = this.net;
    const L = this.trainLength(t);
    const prevSig = k > 0 ? net.signalAt(S[k - 1].tile, S[k - 1].outH) : null;
    const mode = prevSig ? prevSig.type : null;
    let e = k, clear = 0, guard = 0;
    while (e < n - 1 && guard++ < 120) {
      const s = S[e], nx = S[e + 1];
      if (s.s1 >= t.stopS - 0.05) break;
      if (s.jn) { clear = L + 0.3; e++; continue; }
      if (net.signalAt(s.tile, s.outH)) break;
      if (clear > 0) { clear -= s.s1 - s.s0; if (clear > 0) { e++; continue; } }
      if (mode === 'block' && !s.station) { e++; continue; }
      if (mode === 'path' && nx.jn) { e++; continue; }
      if (s.rid >= 0 && (nx.rid === s.rid || nx.jn)) { e++; continue; }
      break;
    }
    return e;
  }

  // two key lists touch the same lane or incompatible junction paths
  keysConflict(A, B) {
    const net = this.net;
    for (const a of A) for (const b of B) {
      if (a >= 0 || b >= 0) { if (a === b) return true; continue; }
      const pa = net.constructor.decodeJ(a), pb = net.constructor.decodeJ(b);
      if (pa.tile === pb.tile && !net.pathsCompatible([pa.a, pa.b], [pb.a, pb.b])) return true;
    }
    return false;
  }
  // Fairness at busy junctions: a train that is not in anyone's way yields to
  // a train that has been waiting clearly longer for conflicting track.
  yieldsTo(t, keys) {
    const now = this.game.time;
    const waiters = this.trains.filter((w) => w !== t && w.waitKeys && now - w.waitStamp < 0.5 && w.state === 'run' && w.wait > t.wait + 4);
    if (!waiters.length) return 0;
    const held = [...t.held];
    for (const w of waiters) if (this.keysConflict(held, w.waitKeys)) return 0;   // we block someone: keep moving
    for (const w of waiters) if (this.keysConflict(keys, w.waitKeys)) return w.id;
    return 0;
  }

  tryReserve(t, k, e) {
    const net = this.net, S = t.steps;
    const gk = [];
    for (let i = k; i <= e; i++) for (const key of S[i].keys) if (!t.held.has(key)) gk.push(key);
    const y = gk.length ? this.yieldsTo(t, gk) : 0;
    if (y) return { blocker: y, kind: 'yield' };
    for (let i = k; i <= e; i++) {
      const st = S[i];
      if (!net.canReserve(st.keys, t.id)) return { blocker: net.holder(st.keys, t.id), kind: st.jn ? 'junction' : st.station ? 'platform' : st.single ? 'single' : 'block' };
      if (st.rid >= 0 && !net.runLockOk(st.rid, net.runSense(st), t.id)) {
        const L = net.runLocks.get(st.rid);
        let b = 0; if (L) for (const id of L.ids) if (id !== t.id) { b = id; break; }
        return { blocker: b, kind: 'single' };
      }
    }
    for (let i = k; i <= e; i++) {
      const st = S[i];
      net.reserve(st.keys, t.id);
      if (st.rid >= 0) { net.runLockAdd(st.rid, net.runSense(st), t.id); t.runs.add(st.rid); }
    }
    return true;
  }

  move(t, dt) {
    const g = this.game, net = this.net;
    // finish the lane change after a reversal before moving off
    if (t.lane < 1) { t.v = 0; return; }
    const st = t._st;
    const weather = g.env ? g.env.effects : { speed: 1, accel: 1 };
    const perf = livePerf(st, cargoMass(t.cargo));
    const fx = g.progression.fx;
    const vmaxTrain = (st.speed * perf.speedMul / KMH_PER_TILE_S) * TILE * weather.speed;
    const accel = perf.accel * 1.3 * weather.accel;
    const decel = DECEL * (1 + st.brake);
    const lookahead = (t.v * t.v) / (2 * decel) + TILE * 1.3 + t.v * dt;
    const res = this.updateReservation(t, lookahead);
    let limitS = res.limitS;
    // switches must be set before the train enters a junction
    for (let k = this.stepAt(t, t.s) + 1; k <= t.resvEnd && k < t.steps.length; k++) {
      const s = t.steps[k];
      if (s.s0 > t.s + lookahead) break;
      if (s.jn && !net.switchReady(s.tile, s.inH == null ? 8 : opp(s.inH), s.outH == null ? 8 : s.outH)) { limitS = Math.min(limitS, s.s0 - 0.3); break; }
    }
    // speed limits ahead
    let vlim = vmaxTrain;
    for (let k = this.stepAt(t, t.s); k < t.steps.length; k++) {
      const s = t.steps[k];
      const d = Math.max(0, s.s0 - t.s);
      if (d > (vmaxTrain * vmaxTrain) / (2 * decel) + 1) break;
      const tier = net.tier[s.tile];
      let lim = TRACK_TIERS[tier].speed * (st.model.maglev && tier === 3 ? 1.45 : 1);
      if (s.inH != null && s.outH != null && s.inH !== s.outH) {
        const tt = turnOf(s.inH, s.outH);
        let f = tt === 1 ? (tier === 3 ? 0.92 : 0.8) : tt === 2 ? (tier === 3 ? 0.72 : 0.5) : 0.22;
        f = 1 - (1 - f) * (1 + fx.curvePenalty);
        if (s.jn) f *= Math.min(1, 0.75 * (1 + (fx.junctionSpeed || 0)));
        lim *= f;
      }
      if (s.station && s.station === t.target && k >= t.steps.length - 4) lim = Math.min(lim, 70);
      if (s.kind !== K_BRIDGE && s.kind !== K_TUNNEL) {
        const dh = Math.abs(net.railH(s.tile) - (s.inH != null ? net.railH(step(s.tile, opp(s.inH))) || 0 : net.railH(s.tile)));
        const slope = Math.min(0.45, dh * 0.22 * perf.slopeMul) * (st.model.trait === 'mountain_goat' ? 0.4 : 1);
        lim *= 1 - slope;
      }
      const lw = (lim / KMH_PER_TILE_S) * TILE;
      vlim = Math.min(vlim, Math.sqrt(lw * lw + 2 * decel * d));
    }
    const stopAt = Math.min(t.stopS, limitS, t.ss[t.ss.length - 1]);
    const dist = stopAt - t.s;
    const vb = Math.sqrt(2 * decel * Math.max(0, dist - 0.01));
    const vt = Math.min(vlim, vb);
    if (t.v < vt) t.v = Math.min(vt, t.v + accel * dt);
    else t.v = Math.max(vt, t.v - decel * 1.5 * dt);
    if (!isFinite(t.v)) t.v = 0;
    t.s = Math.min(t.s + t.v * dt, Math.max(t.s, stopAt));
    const hk = this.stepAt(t, t.s);
    if (hk !== t.lastStepIdx) { t.lastStepIdx = hk; const s = t.steps[hk]; if (s) net.traffic[s.tile] += 1; }
    const kmh = (t.v / TILE) * KMH_PER_TILE_S;
    if (kmh > g.stats.data.topSpeed) g.stats.set('topSpeed', Math.round(kmh));
    // waypoints: pass through without stopping
    if (t.tgtKind === 'wp' && !t.via && !t.wpChained && t.stopS - t.s < (t.v * t.v) / (2 * decel) + TILE * 1.5) this.chainWaypoint(t);
    // arrival
    if (t.s >= t.stopS - 0.02 && t.v < 0.2) {
      t.s = t.stopS;
      t.wait = 0; t.blockedBy = 0; t.blockKind = null;
      if (t.pendingLost) { t.pendingLost = false; t.state = 'lost'; t.stateT = 0; t.v = 0; return; }
      if (t.via) { this.viaReverse(t); return; }
      this.arrive(t);
      if (t.steps.length > 60) this.trim(t);
      return;
    }
    // blocked by another train / signal
    if (limitS < t.stopS - 0.1 && t.v < 0.05 && dist < 0.5) {
      t.wait += dt; t.waitTotal += dt;
      t.blockedBy = res.blocker; t.blockKind = res.kind || (res.blocker ? 'block' : 'switch');
      const ws = t.steps[Math.min(t.steps.length - 1, t.resvEnd + 1)];
      if (ws) { net.waitHeat[ws.tile] += dt; if (ws.station) g.stations.noteWait(ws.station, dt); }
      if (t.wait > 12 && t.reroutes === 0) { t.reroutes = 1; this.rerouteAvoiding(t); }
    } else if (t.v > 0.3) { t.wait = 0; t.reroutes = 0; t.blockedBy = 0; t.blockKind = null; t.deadT = 0; t.waitKeys = null; }
    if (t.steps.length > 80) this.trim(t);
    if (!isFinite(t.s)) this.recoverTrain(t);
  }

  chainWaypoint(t) {
    t.wpChained = true;
    const net = this.net;
    const last = t.steps[t.steps.length - 1];
    if (!last || last.outH == null || !net.hasDir(last.tile, last.outH)) return;
    if (t.mode === 'manual' && t.route.length) t.routeIdx = (t.routeIdx + 1) % t.route.length;
    const here = null;
    const choice = this.chooseTarget(t, here);
    if (!choice) return;
    let tgt;
    if (choice.wp != null) tgt = { tile: choice.wp, heading: null, wp: true };
    else {
      const tg = this.game.stations.targetsFor(choice.stn, t);
      if (!tg.length) return;
      tgt = tg[0];
    }
    const nt = step(last.tile, last.outH);
    const r = net.findRoute({ tile: nt, heading: last.outH, fromCenter: false }, tgt.tile, { minTier: t._st.minTier, allowReverse: true, targetHeading: tgt.heading });
    if (!r) { if (t.mode === 'manual' && t.route.length) t.routeIdx = (t.routeIdx - 1 + t.route.length) % t.route.length; return; }
    this.truncateAfter(t, last.s1);
    for (const s of r.steps) this.appendStep(t, s);
    const nl = t.steps[t.steps.length - 1];
    t.stopS = nl.sc + this.stopExt(nl, tgt);
    t.via = !!r.reverse;
    t.tgtKind = choice.wp != null ? 'wp' : 'station';
    t.target = choice.stn ? choice.stn.id : null;
    t.targetWp = choice.wp ?? null;
    t.curStop = choice.stop;
    this.claimPlatform(t, choice.stn, tgt);
    t.wpChained = false;
  }

  rerouteAvoiding(t) {
    const tgt = t.plat ? { tile: t.plat.tile, heading: t.plat.heading } : null;
    if (!tgt) return false;
    const { st } = this.headInfo(t);
    if (!st || st.outH == null || !this.net.hasDir(st.tile, st.outH)) return false;
    const avoid = new Set();
    const h = this.stepAt(t, t.s);
    for (let k = h + 1; k < t.steps.length && k < h + 6; k++) {
      const s = t.steps[k];
      if (!this.net.canReserve(s.keys, t.id)) avoid.add(s.tile);
    }
    if (!avoid.size) return false;
    const nt = step(st.tile, st.outH);
    // re-dispatch to another platform of the same station when possible
    const stn = t.target != null ? this.game.stations.byId(t.target) : null;
    if (stn) {
      for (const tg of this.game.stations.targetsFor(stn, t)) {
        const r = this.net.findRoute({ tile: nt, heading: st.outH, fromCenter: false }, tg.tile, { minTier: t._st.minTier, avoid, allowReverse: true, targetHeading: tg.heading });
        if (r && !r.steps.some((s) => avoid.has(s.tile))) { this.applyRoute(t, { kind: 'forward', route: r, tgt: tg }); this.claimPlatform(t, stn, tg); return true; }
      }
      return false;
    }
    const r = this.net.findRoute({ tile: nt, heading: st.outH, fromCenter: false }, tgt.tile, { minTier: t._st.minTier, avoid, allowReverse: true, targetHeading: tgt.heading });
    if (r && !r.steps.some((s) => avoid.has(s.tile))) { this.applyRoute(t, { kind: 'forward', route: r, tgt }); return true; }
    return false;
  }

  reverseOut(t) {
    const tgt = t.plat ? { tile: t.plat.tile, heading: t.plat.heading } : null;
    if (!tgt || t.v > 0.05) return false;
    const opts = this.planOptions(t, tgt, true).filter((o) => o.kind === 'reverse');
    if (opts.length && this.applyRoute(t, opts[0])) { t.wait = 0; this.afterReverse(t, 'run'); return true; }
    return false;
  }

  // Deadlock detection chain: follow "waits for" links; a cycle means no
  // train in it can ever move. The lowest-priority train yields by rerouting,
  // reversing out, or (last resort) being re-formed at a free station.
  detectDeadlocks() {
    const waits = new Map();
    for (const t of this.trains) if (t.state === 'run' && t.blockedBy && t.wait > 2) waits.set(t.id, t.blockedBy);
    const done = new Set();
    for (const [start] of waits) {
      if (done.has(start)) continue;
      const path = [];
      let cur = start;
      const seen = new Map();
      while (cur && waits.has(cur) && !seen.has(cur)) { seen.set(cur, path.length); path.push(cur); cur = waits.get(cur); }
      for (const id of path) done.add(id);
      let cyc = null;
      if (cur && seen.has(cur)) cyc = path.slice(seen.get(cur));
      else if (cur && !waits.has(cur)) {
        // waiting on a train that is stuck itself (lost / long idle on the track)
        const other = this.byId(cur);
        if (other && (other.state === 'lost' || (other.state === 'idle' && other.stateT > 20))) cyc = [...path];
      }
      if (!cyc || !cyc.length) continue;
      const trains = cyc.map((id) => this.byId(id)).filter(Boolean);
      for (const tr of trains) tr.deadT += 1;
      const victim = trains.slice().sort((a, b) => (a._st.prioRank - b._st.prioRank) || (b.wait - a.wait) || (b.id - a.id))[0];
      if (!victim || victim.deadT < 3) continue;
      let how = null;
      if (victim.reroutes < 2 && this.rerouteAvoiding(victim)) how = 'reroute';
      else if (this.reverseOut(victim)) how = 'reverse';
      else if (victim.deadT > 40) { if (!this.sendToDepot(victim)) this.recoverTrain(victim); how = 'recover'; }
      if (how) {
        victim.reroutes = 2; victim.deadT = 0;
        this.incidents.push({ time: this.game.time, trains: trains.map((x) => x.id), victim: victim.id, how, tile: victim.steps[Math.min(victim.steps.length - 1, victim.resvEnd + 1)]?.tile ?? -1 });
        if (this.incidents.length > 20) this.incidents.shift();
        this.game.events.emit('deadlockResolved', victim, how, trains);
      }
    }
  }

  // Safety net: no two trains may ever hold the same lane key.
  checkInvariants() {
    const owner = new Map();
    for (const t of this.trains) for (const k of t.held) {
      if (k < 0) continue;
      const o = owner.get(k);
      if (o && o !== t.id) { this.collisions++; console.warn('reservation conflict', k, o, t.id); }
      owner.set(k, t.id);
    }
  }

  // Take a train off the network into its depot; it re-enters once the depot
  // track is clear (used to break deadlocks without teleporting into the jam).
  sendToDepot(t) {
    const g = this.game;
    const dep = g.stations.depotById(t.homeDepot) || g.stations.depots.find((d) => this.net.conn[d.tile] && this.net.connected(d.tile, t.steps[0] ? t.steps[0].tile : d.tile));
    if (!dep || !this.net.conn[dep.tile]) return false;
    this.releaseClaim(t);
    g.stations.unclaimPlatform(t.id);
    this.clearTrail(t);
    t.rev = null; t.via = false; t.pendingLost = false; t.wait = 0; t.deadT = 0; t.reroutes = 0;
    t.homeDepot = dep.id;
    t.state = 'spawnwait'; t.stateT = -10;
    g.events.emit('trainRecovered', t);
    return true;
  }

  recoverTrain(t) {
    const g = this.game, net = this.net;
    this.releaseClaim(t);
    g.stations.unclaimPlatform(t.id);
    const here = t.steps.length ? t.steps[Math.max(0, this.stepAt(t, t.s))].tile : (g.stations.list[0] ? g.stations.list[0].tile : 0);
    const cands = g.stations.list.filter((s) => net.conn[s.tile]).sort((a, b) => cheb(a.tile, here) - cheb(b.tile, here));
    this.clearTrail(t);
    t.rev = null; t.via = false; t.pendingLost = false;
    for (const stn of cands) {
      for (const tile of g.stations.allTiles(stn)) {
        for (let d = 0; d < 8; d++) {
          if (!net.hasDir(tile, d)) continue;
          const h = opp(d);
          const test = { tile, inH: h, outH: null };
          if (!net.canReserve(net.laneKeys(test), t.id)) continue;
          this.placeAt(t, tile, h);
          // make sure the whole body fits without overlapping others
          let ok = true;
          for (const k of t.held) if (k >= 0 && net.resv[k] !== t.id) ok = false;
          if (!ok) { this.clearTrail(t); continue; }
          t.state = 'load'; t.loadTime = 1; t.stateT = 0; t.target = stn.id; t.tgtKind = 'station'; t.curStop = null; t.wait = 0; t.reroutes = 0; t.recover = 0; t.deadT = 0;
          t.fade = 0;
          g.events.emit('trainRecovered', t);
          return;
        }
      }
    }
    const dep = g.stations.depotById(t.homeDepot) || g.stations.depots.find((d) => net.conn[d.tile]);
    if (dep && this.spawnAtDepot(t, dep)) { t.fade = 0; return; }
    t.state = 'spawnwait'; t.stateT = 0;
  }

  // Is a train body standing on this tile? (construction safety)
  tileOccupied(tile) {
    for (const t of this.trains) {
      if (t.state === 'spawnwait') continue;
      const L = this.trainLength(t);
      for (const s of t.steps) if (s.tile === tile && s.s1 >= t.s - L - 0.05 && s.s0 <= t.s + 0.05) return t;
    }
    return null;
  }
  // Is the tile under a train or reserved ahead of one?
  tileReserved(tile) {
    const net = this.net;
    if (net.resv[tile * 2] || net.resv[tile * 2 + 1] || net.jres.has(tile)) return true;
    return !!this.tileOccupied(tile);
  }

  onNetworkChanged(removedTiles) {
    const net = this.net;
    net.computeRuns();
    this._netV = net.version;
    for (const t of this.trains) {
      t.unreachable.clear();
      if (!t.steps.length) continue;
      for (const s of t.steps) this.decorate(s);
      this.resetReservation(t);
      if (t.state === 'idle' || t.state === 'lost') { t.stateT = 3; continue; }
      if (t.state !== 'run' || !removedTiles) continue;
      let bad = false;
      for (let k = this.stepAt(t, t.s); k < t.steps.length; k++) {
        const s = t.steps[k];
        if (!net.conn[s.tile]) { bad = true; break; }
        if (s.inH != null && !net.hasDir(s.tile, opp(s.inH))) { bad = true; break; }
        if (s.outH != null && k < t.steps.length - 1 && !net.hasDir(s.tile, s.outH)) { bad = true; break; }
      }
      if (bad) {
        const tgt = t.plat ? { tile: t.plat.tile, heading: t.plat.heading } : null;
        const opts = tgt ? this.planOptions(t, tgt, false) : [];
        if (opts.length) this.applyRoute(t, opts[0]);
        else {
          const { st } = this.headInfo(t);
          this.truncateAfter(t, st ? st.s1 : t.s);
          t.stopS = Math.min(t.ss[t.ss.length - 1], st ? st.s1 : t.s);
          t.problem = 'no_route';
          t.v = Math.min(t.v, 1);
          t.state = 'run'; t.pendingLost = true;
          this.resetReservation(t);
        }
      }
    }
  }

  sell(t) {
    const g = this.game;
    this.releaseClaim(t);
    g.stations.unclaimPlatform(t.id);
    this.clearTrail(t);
    this.disposeVisual(t);
    this.trains = this.trains.filter((x) => x !== t);
    const refund = Math.round(consistCost(t.veh, g.economy.costs) * 0.5);
    g.economy.earn(refund, 'sale', false);
    g.events.emit('trainSold', t, refund);
    return refund;
  }
  sellValue(t) { return Math.round(consistCost(t.veh, this.game.economy.costs) * 0.5); }

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

  // Precise, player-facing status for the train list and inspector.
  statusOf(t) {
    const S = this.game.stations;
    const stn = t.target != null ? S.byId(t.target) : null;
    const where = stn ? stn.name : t.targetWp != null ? (this.net.waypoints.get(t.targetWp) || {}).name || '' : '';
    const plat = t.plat && t.plat.track != null ? t.plat.track + 1 : null;
    switch (t.state) {
      case 'spawnwait': return { key: 'st_spawnwait', warn: true };
      case 'reversing': return { key: t.rev && t.rev.steam ? 'st_turning' : 'st_runaround' };
      case 'load': {
        const pct = Math.round(this.fillRatio(t) * 100);
        const here = this.stationAtHead(t);
        return { key: t.waitFull && t.stateT > t.loadTime - 1.6 ? 'st_wait_full' : 'st_loading', p: { pct, station: here ? here.name : where }, eff: t.platEff };
      }
      case 'lost': return { key: 'prob_' + (t.problem || 'no_route'), warn: true };
      case 'idle': case 'depart': return t.problem ? { key: 'prob_' + t.problem, warn: true } : { key: 'st_idle' };
      case 'run': {
        if (t.v < 0.05 && t.blockedBy !== 0 && t.wait > 0.5) {
          const other = this.byId(t.blockedBy);
          return { key: 'st_wait_' + (t.blockKind || 'block'), p: { train: other ? other.name : '', station: where }, warn: t.wait > 20 };
        }
        if (t.v < 0.05 && t.blockKind === 'switch') return { key: 'st_wait_switch' };
        const left = t.stopS - t.s;
        if (left < TILE * 3 && stn) return { key: 'st_arriving', p: { station: where, plat: plat || 1 } };
        return { key: t.tgtKind === 'wp' ? 'st_via' : 'st_running', p: { station: where } };
      }
      default: return { key: 'tstate_' + t.state };
    }
  }

  // ---------- visuals ----------
  consistSig(t) {
    const detail = Math.min(3, Math.floor((t.upg.engine + t.upg.accel + t.upg.efficiency) / 4));
    const { wagons } = assignLoads(t._st, t.cargo);
    let wi = 0;
    const parts = t.veh.map((v) => {
      if (v.k === 'L') return `L${v.id}`;
      const w = wagons[wi++];
      return `W${v.id}.${w && w.c ? w.c : ''}.${w && w.n > 0 ? Math.min(3, Math.ceil((w.n / Math.max(1, w.cap)) * 3)) : 0}`;
    });
    return `${t.livery}|${detail}|${parts.join(',')}`;
  }

  buildVisual(t) {
    this.disposeVisual(t);
    const sig = this.consistSig(t);
    const [livery, detail, partsStr] = sig.split('|');
    const lead = t._st.model;
    const cols = liveryColors(lead, livery);
    const group = new THREE.Group();
    const cars = [];
    const parts = partsStr.split(',');
    let off = 0;
    t.veh.forEach((v, i) => {
      const len = vehLen(v);
      let geo;
      if (v.k === 'L') geo = locoGeometry(v.id, livery, +detail);
      else {
        const [, cargo, fill] = parts[i].slice(1).split('.');
        geo = wagonGeometry(v.id, cargo || null, +fill, lead.kind, cols.body, cols.trim);
      }
      const mesh = new THREE.Mesh(geo, MATS);
      mesh.castShadow = true;
      mesh.userData.train = t.id;
      group.add(mesh);
      cars.push({ mesh, len, v, off: off + len / 2 });
      off += len + GAP;
    });
    t.visual = { group, cars, total: off - GAP };
    t.visualSig = sig;
    this.group.add(group);
  }

  disposeVisual(t) {
    if (!t.visual) return;
    this.group.remove(t.visual.group);
    t.visual = null;
  }

  updateVisuals(dt) {
    const g = this.game;
    const pf = new THREE.Vector3(), pr = new THREE.Vector3(), pc = new THREE.Vector3(), pd = new THREE.Vector3();
    this._pickList.length = 0;
    let nc = 0;
    const cm = this.couplers;
    const clock = g.clock;
    for (const t of this.trains) {
      if (t.state === 'spawnwait' || !t.steps.length) { if (t.visual) t.visual.group.visible = false; continue; }
      if (!t.visual || t.visualSig !== this.consistSig(t)) this.buildVisual(t);
      const V = t.visual;
      V.group.visible = true;
      if (t.fade < 1) t.fade = Math.min(1, t.fade + dt * 1.5);
      const sMin = t.ss[0];
      const inDepot = t.steps[0] && t.steps[0].inH == null && t.steps[0].tile === (g.stations.depotById(t.homeDepot) || {}).tile;
      const speedF = clamp(t.v / 4, 0, 1);
      const R = t.rev;
      for (let ci = 0; ci < V.cars.length; ci++) {
        const c = V.cars[ci];
        const sc = t.s - c.off;
        const half = c.len > 1.5 ? c.len / 2 - 0.3 : c.len * 0.36;
        this.sampleAt(t, sc + half, pf);
        this.sampleAt(t, sc - half, pr);
        const dx = pf.x - pr.x, dz = pf.z - pr.z, dy = pf.y - pr.y;
        const len = Math.sqrt(dx * dx + dz * dz) || 1;
        const nx = -dz / len, nz = dx / len;
        const laneOff = LANE * t.lane * this.laneFactor(t, sc);
        const mesh = c.mesh;
        const bounce = Math.sin(sc * 4.1 + ci) * 0.006 * speedF;
        mesh.position.set((pf.x + pr.x) / 2 + nx * laneOff, (pf.y + pr.y) / 2 + 0.13 + bounce, (pf.z + pr.z) / 2 + nz * laneOff);
        let yaw = Math.atan2(-dz, dx) + (c.v.r ? Math.PI : 0);
        const pitch = Math.atan2(dy, len) * (c.v.r ? -1 : 1);
        const roll = Math.sin(clock * 6.3 + ci * 1.7 + t.id) * 0.012 * speedF;
        let scale = 1, lift = 0;
        // run-around / turntable animation of the engine
        if (R && c.v.k === 'L') {
          const moving = R.swapped ? (R.moved || []).includes(ci) : R.idx.includes(ci);
          if (moving) {
            const p = R.p;
            scale = Math.max(0.02, Math.abs(1 - 2 * p));
            lift = Math.sin(p * Math.PI) * 0.5;
            if (R.swapped && R.steam) yaw += Math.PI * (1 - clamp((p - 0.5) * 2, 0, 1));
            else if (R.inPlace && !R.swapped) yaw += 0;
          }
        }
        mesh.position.y += lift;
        _e.set(0, yaw, pitch, 'YXZ');
        mesh.rotation.copy(_e);
        mesh.rotateX(roll);
        let visible = true;
        if (inDepot && sc < sMin + 0.7) visible = false;
        if (sc - c.len / 2 < sMin - 0.05 && t.fade < 1) visible = false;
        const tile = worldToTile(mesh.position.x, mesh.position.z);
        if (tile >= 0 && this.net.kind(tile) === K_TUNNEL && this.net.conn[tile]) visible = false;
        mesh.visible = visible;
        const sc2 = t.spawnFx > 0 ? 1 + Math.sin((1 - t.spawnFx) * Math.PI * 3) * 0.08 * t.spawnFx : 1;
        mesh.scale.setScalar(sc2 * (0.6 + 0.4 * t.fade) * scale);
        if (visible) this._pickList.push(mesh);
        if (!Number.isFinite(mesh.position.x)) { mesh.visible = false; this.recoverTrain(t); break; }
        // coupler to the next vehicle
        if (ci < V.cars.length - 1 && visible && nc < cm.instanceMatrix.count) {
          const cs = t.s - (c.off + c.len / 2 + GAP / 2);
          this.sampleAt(t, cs + 0.1, pc);
          this.sampleAt(t, cs - 0.1, pd);
          const lo = LANE * t.lane * this.laneFactor(t, cs);
          const ddx = pc.x - pd.x, ddz = pc.z - pd.z;
          const dl = Math.sqrt(ddx * ddx + ddz * ddz) || 1;
          _v.set((pc.x + pd.x) / 2 - ddz / dl * lo, (pc.y + pd.y) / 2 + 0.3, (pc.z + pd.z) / 2 + ddx / dl * lo);
          _q.setFromEuler(_e.set(0, Math.atan2(-ddz, ddx), 0));
          _m4.compose(_v, _q, _s1);
          cm.setMatrixAt(nc++, _m4);
        }
      }
      // exhaust
      const leadCar = V.cars.find((c) => c.v.k === 'L');
      if (leadCar && leadCar.mesh.visible && (t.state === 'run' || t.state === 'reversing') && g.particles) {
        const m = locoModel(leadCar.v.id);
        t._puff = (t._puff || 0) + dt * (0.8 + t.v * 1.2);
        const loco = leadCar.mesh;
        if (m.kind.startsWith('steam') && t._puff > 1.8) {
          t._puff = 0;
          _v.set(leadCar.len / 2 - 0.5, 0.85, 0).applyEuler(loco.rotation).add(loco.position);
          g.particles.emit('steam', _v.x, _v.y, _v.z, 1);
        } else if (m.kind === 'diesel' && t._puff > 2.5) {
          t._puff = 0;
          _v.set(-0.1, 0.8, 0).applyEuler(loco.rotation).add(loco.position);
          g.particles.emit('exhaust', _v.x, _v.y, _v.z, 1);
        } else if (m.kind === 'electric' && t.v > 2 && t._puff > 6 && Math.random() < 0.15) {
          t._puff = 0;
          _v.set(-0.2, 1.1, 0).applyEuler(loco.rotation).add(loco.position);
          g.particles.emit('spark', _v.x, _v.y, _v.z, 2);
        }
      }
    }
    cm.count = nc;
    cm.instanceMatrix.needsUpdate = true;
  }

  // ---------- persistence ----------
  serialize() {
    return this.trains.map((t) => {
      const hs = t.steps.length ? t.steps[this.stepAt(t, t.s)] : null;
      return {
        id: t.id, model: t.model, consist: serializeConsist(t.pendingVeh || t.veh), name: t.name, livery: t.livery, upg: t.upg, mode: t.mode,
        route: t.route, routeIdx: t.routeIdx, filter: t.filter, cargo: t.cargo, earned: t.earned, trips: t.trips, target: t.target, depotId: t.homeDepot,
        head: hs ? { tile: hs.tile, inH: hs.inH } : null, state: t.state, created: t.created,
      };
    });
  }

  // cargo a legacy train was clearly working with (for consist inference)
  legacyHints(d) {
    const S = this.game.stations;
    const hints = new Set();
    for (const l of d.cargo || []) if (l && CARGO[l.c]) hints.add(l.c);
    if (Array.isArray(d.filter) && d.filter.length && d.filter.length < 13) for (const c of d.filter) if (CARGO[c]) hints.add(c);
    if (d.mode === 'manual' && Array.isArray(d.route)) {
      const stops = d.route.map((r) => S.byId(r.st)).filter(Boolean);
      for (const a of stops) for (const c of a.supplies || []) if (stops.some((b) => b !== a && S.accepts(b, c))) hints.add(c);
    }
    if (!hints.size && d.target != null) {
      const stn = S.byId(d.target);
      if (stn) for (const c of stn.supplies || []) hints.add(c);
    }
    return hints;
  }

  deserialize(list) {
    this.trains = [];
    if (!Array.isArray(list)) return;
    const g = this.game, net = this.net;
    net.computeRuns();
    for (const d of list) {
      try {
        if (!d) continue;
        let veh = parseConsist(d.consist);
        if (!veh.some((v) => v.k === 'L')) {
          if (!LOCOS.find((m) => m.id === d.model)) continue;
          veh = inferLegacy(d.model, this.legacyHints(d), g.progression.research);
        }
        const t = this.makeTrain({ ...d, veh });
        this.nextId = Math.max(this.nextId, t.id + 1);
        t.cargo = t.cargo.filter((l) => g.stations.byId(l.from));
        this.trains.push(t);
        const h = d.head;
        let placed = false;
        if (h && typeof h.tile === 'number' && net.conn[h.tile]) {
          if (h.inH != null && net.hasDir(h.tile, opp(h.inH))) {
            const test = { tile: h.tile, inH: h.inH, outH: null };
            if (net.canReserve(net.laneKeys(test), t.id)) {
              this.placeAt(t, h.tile, h.inH);
              placed = true;
              for (const k of t.held) if (k >= 0 && net.resv[k] !== t.id) placed = false;
              if (!placed) this.clearTrail(t);
            }
          } else if (h.inH == null) {
            const dep = g.stations.depotAt(h.tile);
            if (dep) placed = this.spawnAtDepot(t, dep);
          }
        }
        if (!placed) this.recoverTrain(t);
        else {
          const stn = this.stationAtHead(t);
          if (stn && (d.state === 'load' || d.target === stn.id)) { t.state = 'load'; t.loadTime = 1.5; t.stateT = 0; t.target = stn.id; }
          else if (t.state !== 'depart') t.state = 'depart';
        }
        // cargo beyond the (possibly smaller) wagon capacity stays aboard until delivered
      } catch (e) {
        console.warn('Train restore failed, skipping', e);
      }
    }
  }

  pickables() { return this._pickList; }
  electricCount() { return this.trains.filter((t) => t._st.minTier >= 2).length; }
}

function normStop(r) {
  const o = { act: 'auto', dwell: 0, full: false, skip: false, plat: null, cargo: null };
  if (typeof r.st === 'number') o.st = r.st; else o.wp = r.wp;
  if (['auto', 'load', 'unload', 'transfer', 'none'].includes(r.act)) o.act = r.act;
  o.dwell = clamp(+r.dwell || 0, 0, 120);
  o.full = !!r.full; o.skip = !!r.skip;
  o.plat = typeof r.plat === 'number' && r.plat >= 0 ? r.plat : null;
  o.cargo = Array.isArray(r.cargo) ? r.cargo.filter((c) => CARGO[c]) : null;
  return o;
}
export { normStop };

export function eraResearch(era) { return ERA_RESEARCH[era] || null; }
export { tileCX, tileCZ, WAGONS };
