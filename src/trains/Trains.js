// Train simulation. Each train owns a persistent consist (ordered vehicles,
// front → rear in the direction of travel) and a sampled trail of path steps.
// Vehicles follow the head at fixed distances along that trail, so every car
// stays on the same path. Movement is limited by an explicit reservation
// frontier (block groups, junction paths, single-track direction locks) that is
// extended ahead of the train and released behind its rear.
import { cleanFin } from '../economy/Ledger.js';
import * as THREE from 'three';
import { TILE, opp, turnOf, step, cheb, worldToTile, clamp, tileCX, tileCZ, DX, DZ } from '../util.js';
import { LOCOS, TRACK_TIERS, KMH_PER_TILE_S, CARGO, ERA_RESEARCH, WAGONS, STATION } from '../config.js';
import { K_TUNNEL, K_BRIDGE } from '../rail/RailNetwork.js';
import { locoGeometry, wagonGeometry, couplerGeometry, retainGeometry, releaseGeometry } from './TrainModels.js';
import { vehicleToken, resolvePaint, validToken, DEFAULT_LIVERY } from './Livery.js';
import {
  locoModel, parseConsist, serializeConsist, cloneConsist, computeStats, livePerf, cargoMass, assignLoads, roomFor, canCarry,
  canLead, vehLen, inferLegacy, consistCost, vehicleCost, validateConsist, autoBuild, GAP,
} from './Consist.js';
import { MATS } from '../core/ModelBuilder.js';
import { SCALE } from '../style.js';
import { SPACING_CHOICES } from './Lines.js';
import { log } from '../core/Log.js';
import { CargoFlows } from '../economy/Flows.js';

// deterministic 0..1 hash (keeps the simulation reproducible for tests)
const jitter = (n) => { let x = Math.imul(n | 0, 0x9e3779b1) ^ 0x5bd1e995; x = Math.imul(x ^ (x >>> 15), 0x85ebca6b); x ^= x >>> 13; return (x >>> 0) / 4294967296; };

const LANE = SCALE.lane;
const DECEL = 3.2;
const STOP_EXT = 0.6;      // stop this far past the platform-end tile center
const XO_LEN = 1.7;        // length of the crossover a reversed train takes back to its own lane
const XO_MIN = 0.9;        // shortest crossover kept inside the head tile
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m4 = new THREE.Matrix4();
const _e = new THREE.Euler();
const _s1 = new THREE.Vector3(1, 1, 1);

export { locoModel };

// copy of a cargo lot, keeping a passenger destination / transfer tag when valid
// a copy of a load with its journey (origin, destination, legs: CargoFlows)
function lotFrom(l) { return CargoFlows.cleanLot(l) || { c: l.c, n: l.n, from: l.from }; }

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
    // cargo waiting on the depot's network (with somewhere to deliver it), most plentiful first
    const score = new Map();
    const comp = this.net.components();
    const k = depot ? comp[depot.tile] : -1;
    for (const s of g.stations.list) {
      if (k < 0 || comp[s.tile] !== k) continue;
      for (const c of s.supplies || []) {
        if (!g.stations.hasDemand(s, c, comp)) continue;
        const busy = this.trains.filter((t) => t._st.caps[c]).length;
        score.set(c, (score.get(c) || 0) + 20 + (s.stock[c] || 0) * CARGO[c].value / 8 - busy * 15);
      }
    }
    let list = [...score.keys()].sort((a, b) => score.get(b) - score.get(a));
    if (m.role === 'passenger') list = list.filter((c) => c === 'PASSENGERS' || c === 'MAIL');
    else if (m.role === 'freight') list = list.filter((c) => c !== 'PASSENGERS');
    if (!list.length) list = m.role === 'passenger' ? ['PASSENGERS', 'MAIL'] : m.role === 'freight' ? ['WOOD'] : ['WOOD', 'PASSENGERS'];
    return autoBuild(modelId, list.slice(0, 2), { research: g.progression.research, fx: g.progression.fx });
  }

  buy(consistOrModel, depot, name) {
    const g = this.game;
    const vs = typeof consistOrModel === 'string' ? this.defaultConsist(consistOrModel, depot) : cloneConsist(consistOrModel);
    const err = this.canBuy(vs, depot);
    if (err) return { error: err };
    const cost = consistCost(vs, g.economy.costs);
    const lead = vs.find((v) => v.k === 'L');
    const m = locoModel(lead.id);
    // unique default name: models of one family share the first word (Arrowline 200/300)
    const base = m.name.split(' ')[0];
    let count = 1;
    while (this.trains.some((x) => x.name === `${base} ${count}`)) count++;
    const t = this.makeTrain({ id: this.nextId++, veh: vs, name: name || `${base} ${count}`, livery: g.progression.defaultLivery, depotId: depot.id });
    this.trains.push(t);
    if (!this.spawnAtDepot(t, depot)) t.state = 'spawnwait';
    g.economy.spend(cost, 'trains', { type: 'train', id: t.id }, t.name);
    t.bought = g.time;
    g.stats.inc('trainsBought');
    for (const v of vs) if (v.k === 'L') g.progression.ownModel(v.id);
    g.events.emit('trainBought', t);
    return { train: t };
  }

  makeTrain(d) {
    let veh = Array.isArray(d.veh) ? cloneConsist(d.veh) : parseConsist(d.consist);
    if (!veh.length || !veh.some((v) => v.k === 'L')) veh = inferLegacy(LOCOS.some((m) => m.id === d.model) ? d.model : 'pioneer', [], this.game.progression.research);
    const t = {
      id: d.id, veh, model: veh.find((v) => v.k === 'L').id, name: d.name || 'Train', livery: validToken(d.livery) || DEFAULT_LIVERY, liveryScope: d.liveryScope === 'loco' ? 'loco' : 'train',
      upg: Object.assign({ engine: 0, capacity: 0, accel: 0, loading: 0, efficiency: 0 }, d.upg || {}),
      mode: d.mode === 'manual' ? 'manual' : 'auto',
      route: Array.isArray(d.route) ? d.route.filter((r) => r && (typeof r.st === 'number' || typeof r.wp === 'number')).map(normStop) : [],
      routeIdx: d.routeIdx | 0,
      filter: Array.isArray(d.filter) ? d.filter.filter((c) => CARGO[c]) : null,
      cargo: Array.isArray(d.cargo) ? d.cargo.filter((l) => l && CARGO[l.c] && l.n > 0).map((l) => lotFrom({ ...l, n: Math.floor(l.n) })) : [],
      earned: d.earned || 0, trips: d.trips || 0, profitLog: d.profitLog || [],
      state: 'idle', stateT: 0, wait: 0, target: d.target ?? null, tgtKind: 'station', depotId: d.depotId ?? null,
      xs: [], ys: [], zs: [], ss: [], steps: [], s: 0, v: 0, stopS: Infinity, resvEnd: -1,
      lane: 1, held: new Set(), runs: new Set(), claim: null, problem: null, loadTime: 0, lastStepIdx: -1,
      visual: null, fade: 1, reroutes: 0, homeDepot: d.depotId ?? null, unreachable: new Map(), recover: 0,
      created: d.created || Date.now(), bought: typeof d.bought === 'number' && isFinite(d.bought) ? d.bought : 0, fin: cleanFin(d.fin), dly: Number.isFinite(+d.dly) && d.dly > 0 ? Math.min(600, +d.dly) : undefined,
      cond: typeof d.cond === 'number' && d.cond >= 0.2 && d.cond <= 1 ? d.cond : null, serviceAt: typeof d.serviceAt === 'number' && d.serviceAt >= 0 && d.serviceAt <= 0.95 ? d.serviceAt : null, autoService: d.autoService !== false, broken: typeof d.broken === 'number' && d.broken > 0 && d.broken < 60 ? d.broken : 0, breakdowns: Math.max(0, d.breakdowns | 0), blockedBy: 0, blockKind: null, plat: null, curStop: null, rev: null, via: false,
      waitTotal: 0, pendingVeh: null, deadT: 0,
      // timetable: departure spacing at the first stop (0 off, -1 even, else seconds); train group
      spacing: SPACING_CHOICES.includes(d.spacing) ? d.spacing : 0, group: typeof d.group === 'string' ? d.group.trim().slice(0, 24) : '',
      servedIdx: null, ttHold: false, incomeEma: 0,
      // player order: run to a depot and stay there (stay) or re-emerge
      depotOrder: d.depotOrder && typeof d.depotOrder.id === 'number' ? { id: d.depotOrder.id, stay: d.depotOrder.stay !== false } : null, depotIn: null,
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
    if (cost.net > 0) g.economy.spend(cost.net, 'trains', { type: 'train', id: t.id }); else if (cost.net < 0) g.economy.earn(-cost.net, 'sale', false, { type: 'train', id: t.id });
    if (t.state === 'run' || t.state === 'reversing') { t.pendingVeh = cloneConsist(vs); return null; }
    this.setVehicles(t, cloneConsist(vs));
    return null;
  }
  // fleet replacement: swap every locomotive of model `from` for model `to`
  // (wagons stay; old locomotives are refunded like in the Train Builder)
  replaceLoco(t, from, to) {
    const base = t.pendingVeh || t.veh;
    if (!base.some((v) => v.k === 'L' && v.id === from)) return 'err_nothing_to_replace';
    return this.applyConsist(t, base.map((v) => (v.k === 'L' && v.id === from ? { ...v, id: to } : { ...v })));
  }
  setVehicles(t, vs) {
    const g = this.game;
    const oldLen = t._st.length, oldVeh = t.veh;
    t.veh = vs;
    this.refreshStats(t);
    // a longer consist must not reach into track another train holds:
    // keep the old one and couple the new vehicles at the next stop
    if (t.steps.length && t._st.length > oldLen + 1e-6 && !this.bodyFits(t)) {
      t.veh = oldVeh; this.refreshStats(t); t.pendingVeh = vs;
      return false;
    }
    t.pendingVeh = null;
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
      if (st && st.inH != null) {
        const snap = { xs: t.xs.slice(), ys: t.ys.slice(), zs: t.zs.slice(), ss: t.ss.slice(), steps: t.steps.map((o) => ({ ...o })), s: t.s, stopS: t.stopS, lane: t.lane, v: t.v, xo: t.xo ? { ...t.xo } : null };
        this.placeAt(t, st.tile, st.inH); t.fade = 0.5;
        if (!this.bodyHeld(t)) {
          // the rebuilt trail runs into another train: keep the old consist (and
          // exactly the old trail) and couple the new vehicles at the next stop
          t.veh = oldVeh; this.refreshStats(t); t.pendingVeh = vs;
          this.clearTrail(t);
          Object.assign(t, snap);
          t.fade = 1;
          this.resetReservation(t);
          return false;
        }
      }
    } else if (t.steps.length) this.resetReservation(t);
    g.events.emit('consistChanged', t);
    return true;
  }
  // does the train hold every key under its body?
  bodyHeld(t) {
    const net = this.net, L = this.trainLength(t);
    if (!t.steps.length) return false;
    for (let k = this.stepAt(t, t.s); k >= 0; k--) {
      const st = t.steps[k];
      if (st.s1 < t.s - L - 0.05) break;
      if (this.physKeys(t, st).some((key) => !net.holds(key, t.id))) return false;
    }
    return true;
  }
  // can the body (at its current length) be held on the existing trail?
  bodyFits(t) {
    const net = this.net, L = this.trainLength(t);
    // the track behind must reach back the whole length and still exist
    // (track removed behind a short train is not there for a longer one)
    if (t.steps.length && t.steps[0].s0 > t.s - L + 0.05) return false;
    const head = this.stepAt(t, t.s);
    for (let k = head; k >= 0; k--) {
      const st = t.steps[k];
      if (st.s1 < t.s - L - 0.05) break;
      if (!net.conn[st.tile] || (st.inH != null && !net.hasDir(st.tile, opp(st.inH))) || (k < head && st.outH != null && !net.hasDir(st.tile, st.outH))) return false;
      if (!net.canReserve(st.keys, t.id)) return false;
      if (st.rid >= 0 && !net.runLockOk(st.rid, net.runSense(st), t.id)) return false;
    }
    return true;
  }

  // ---------- trail management ----------
  clearTrail(t) {
    t.placed = (t.placed || 0) + 1;
    this.releaseAll(t);
    t.headHold = null;
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
    st._rk = null;
    // re-routed at the tile centre (kinked through the middle, not the regular
    // curve): nobody else may share this switch tile
    if (st.kink && st.inH != null && st.outH != null && net.degree(st.tile) >= 3) {
      const a = opp(st.inH), b = st.outH, i = st.tile;
      const pk = -(1 + i * 81 + a * 9 + b);
      st.keys = st.keys.flatMap((k) => (k === pk ? [-(1 + i * 81 + a * 9 + 8), -(1 + i * 81 + 8 * 9 + b)] : [k]));
    }
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
    // cut exactly at sEnd (steps appended later must start on the tile edge)
    if (n < t.ss.length && t.ss[n - 1] < sEnd - 1e-6) {
      const f = (sEnd - t.ss[n - 1]) / (t.ss[n] - t.ss[n - 1]);
      t.xs[n] = t.xs[n - 1] + (t.xs[n] - t.xs[n - 1]) * f;
      t.ys[n] = t.ys[n - 1] + (t.ys[n] - t.ys[n - 1]) * f;
      t.zs[n] = t.zs[n - 1] + (t.zs[n] - t.zs[n - 1]) * f;
      t.ss[n] = sEnd;
      n++;
    }
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
  // (from the track layout, not from the route: planning further ahead must
  // never move a train that is already on the rails)
  laneFactor(t, s) {
    const st = t.steps[this.stepAt(t, s)];
    if (!st || !st.single) return 1;
    let f = 0;
    if (st.inH != null && this.doubleAt(st.tile, opp(st.inH))) f = Math.max(f, 1 - (s - st.s0) / 0.7);
    if (st.outH != null && this.doubleAt(st.tile, st.outH)) f = Math.max(f, 1 - (st.s1 - s) / 0.7);
    return clamp(f, 0, 1);
  }
  // the neighbour of tile i in direction d carries two lanes
  doubleAt(i, d) {
    const net = this.net, j = step(i, d);
    if (j < 0 || !net.conn[j]) return false;
    const sp = net.special.get(j);
    return !net.single[j] || (sp && sp.type === 'station') || net.isJunction(j);
  }

  // Which lane the trail uses at position s, relative to its direction of
  // travel: +1 its own lane, -1 the lane it was on before its last reversal.
  // A reversed train never slides sideways: every vehicle stays on its rails
  // and changes lane only where it passes the crossover window, like a train
  // taking a crossover. Vehicles behind the window keep the old lane.
  laneSide(t, s) {
    const X = t.xo;
    if (!X) return 1;
    if (s <= X.s0) return X.a;
    if (s >= X.s1) return X.b;
    const f = (s - X.s0) / Math.max(1e-6, X.s1 - X.s0);
    return X.a + (X.b - X.a) * f * f * (3 - 2 * f);
  }
  // world position of the trail at s on the lane the train uses there
  lanePoint(t, s, out) {
    this.sampleAt(t, s, out);
    const x = out.x, z = out.z;
    this.sampleAt(t, s + 0.1, out);
    const dx = out.x - x, dz = out.z - z, len = Math.hypot(dx, dz) || 1;
    const lo = LANE * this.laneSide(t, s) * this.laneFactor(t, s);
    this.sampleAt(t, s, out);
    out.x -= dz / len * lo; out.z += dx / len * lo;
    return out;
  }
  // keys of the step's tile on the other lane (the same legs run the other way)
  revKeys(o) {
    if (!o._rk) o._rk = this.net.laneKeys({ tile: o.tile, inH: o.outH == null ? null : opp(o.outH), outH: o.inH == null ? null : opp(o.inH) });
    return o._rk;
  }
  // Keys a step of the trail needs. After a reversal the train runs on its
  // own lane as always, but its vehicles stay on the rails they stood on
  // until each passes the crossover window: up to the end of the window the
  // train therefore also keeps the other lane (nobody may run into the part
  // of the train still over there).
  physKeys(t, o) {
    const X = t.xo;
    if (!X || o.s0 >= X.s1 - 1e-6 || (o.inH == null && o.outH == null)) return o.keys;
    const both = o.keys.slice();
    for (const k of this.revKeys(o)) if (!both.includes(k)) both.push(k);
    return both;
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
    if (t.xo) { t.xo.s0 -= off; t.xo.s1 -= off; }
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
    t.flips = (t.flips || 0) + 1;
    t.headHold = null;
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
      const r = { tile: o.tile, inH: o.outH == null ? null : opp(o.outH), outH: o.inH == null ? null : opp(o.inH), s0: Math.max(0, S - o.s1), s1: Math.max(S - o.s0, S - o.s1), sc: S - o.sc, kink: o.kink };
      steps.push(this.decorate(r));
    }
    t.steps = steps;
    t.s = Math.min(L, ss[ss.length - 1]);
    // the mirrored trail ahead is the way the train came: track may have been
    // rebuilt or removed there since. Keep it only as far as it still exists;
    // the train stops at the break and finds a new way.
    for (let k = this.stepAt(t, t.s); k < t.steps.length - 1; k++) {
      const a = t.steps[k], b = t.steps[k + 1];
      if (a.outH == null) continue;
      if (!this.net.hasDir(a.tile, a.outH) || step(a.tile, a.outH) !== b.tile) { this.truncateAfter(t, Math.max(t.s, a.s1)); break; }
    }
    t.veh = t.veh.slice().reverse().map((v) => ({ k: v.k, id: v.id, r: !v.r, anim: v.anim, ...(v.lv ? { lv: v.lv } : {}) }));
    // lanes are relative to the direction of travel: mirrored, the body is now
    // on the far lane (-1) and crosses over ahead of the new head
    if (t.xo) { const X = t.xo; t.xo = { s0: S - X.s1, s1: S - X.s0, a: -X.b, b: -X.a }; }
    else {
      const hs = t.steps[this.stepAt(t, t.s)];
      const room = hs ? hs.s1 - t.s : 0;
      t.xo = { s0: t.s, s1: t.s + (room >= XO_MIN ? Math.min(XO_LEN, room) : XO_LEN), a: -1, b: 1 };
    }
    t.lane = 1;
    t.visualSig = null;
    // the body keeps its old lane until it has crossed over (see physKeys)
    this.resetReservation(t);
  }

  bodyHasKey(t, key) {
    const L = this.trainLength(t);
    for (let k = 0; k <= t.resvEnd && k < t.steps.length; k++) { const o = t.steps[k]; if (o.s1 < t.s - L - 0.05) continue; if (this.physKeys(t, o).includes(key)) return true; }
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
      const mine = this.physKeys(t, st).filter((key) => net.canReserve([key], t.id));
      net.reserve(mine, t.id);
      for (const key of mine) t.held.add(key);
      if (st.rid >= 0) { net.runLockAdd(st.rid, net.runSense(st), t.id); t.runs.add(st.rid); }
    }
    t.resvEnd = head;
    if (t.headHold) {
      t.headHold = t.headHold.filter((key) => net.canReserve([key], t.id));
      net.reserve(t.headHold, t.id); for (const key of t.headHold) t.held.add(key);
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
    t.lane = 1; t.xo = null;
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
    t.s = 0; t.v = 0; t.lane = 1; t.xo = null;
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
    const ro = { minTier, allowReverse: !tgt.noShunt, targetHeading: tgt.heading };
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
    t.headHold = null;
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
      if (st.outH === first) { this.truncateAfter(t, st.s1); this.completeHeadStep(t); }
      else {
        this.truncateAfter(t, t.s);
        t.steps.length = k + 1;
        const n0 = t.xs.length;
        net.sampleStep(st.tile, null, first, t.xs, t.ys, t.zs, true);
        for (let i = n0; i < t.xs.length; i++) {
          const dx = t.xs[i] - t.xs[i - 1], dy = t.ys[i] - t.ys[i - 1], dz = t.zs[i] - t.zs[i - 1];
          t.ss.push(t.ss[i - 1] + Math.sqrt(dx * dx + dy * dy + dz * dz));
        }
        const oldKeys = st.keys;
        st.outH = first; st.s1 = t.ss[t.ss.length - 1];
        if (st.inH != null) st.kink = true;
        this.decorate(st);
        // keep the old path through the head tile until the new one is free
        const keep = oldKeys.filter((key) => !st.keys.includes(key) && net.holds(key, t.id));
        t.headHold = keep.length ? keep : null;
      }
    } else {
      this.truncateAfter(t, st.s1);
      t.steps.length = this.stepAt(t, t.s) + 1;
      this.completeHeadStep(t);
    }
    for (const s of opt.route.steps) this.appendStep(t, s);
    const last = t.steps[t.steps.length - 1];
    t.stopS = last.sc + this.stopExt(last, opt.tgt);
    t.via = !!opt.route.reverse;
    this.resetReservation(t);
    return true;
  }

  // The trail may end short of the head step's exit edge (a flipped trail that
  // began at a tile centre): extend it so the next tile starts on its edge.
  completeHeadStep(t) {
    const net = this.net;
    const hs = t.steps[t.steps.length - 1];
    if (!hs || hs.outH == null || !t.xs.length) return;
    const e = net.edgePoint(hs.tile, hs.outH, {});
    const n = t.xs.length - 1;
    const gap = Math.hypot(t.xs[n] - e.x, t.zs[n] - e.z);
    if (gap <= 0.05) return;
    const x0 = t.xs[n], y0 = t.ys[n], z0 = t.zs[n], ey = e.y ?? y0;
    const segs = Math.max(1, Math.ceil(gap / 0.5));
    for (let k = 1; k <= segs; k++) {
      const f = k / segs;
      t.xs.push(x0 + (e.x - x0) * f); t.ys.push(y0 + (ey - y0) * f); t.zs.push(z0 + (e.z - z0) * f);
      t.ss.push(t.ss[t.ss.length - 1] + gap / segs);
    }
    hs.s1 = t.ss[t.ss.length - 1];
  }

  // Stop near the far end of a platform when the track continues straight on.
  stopExt(last, tgt) {
    if (!tgt || tgt.wp || last.inH == null || last.outH == null || last.inH !== last.outH) return 0;
    if (!last.station || this.net.degree(last.tile) !== 2) return 0;
    return Math.min(STOP_EXT, last.s1 - last.sc - 0.05);
  }

  // reached a shunting point: reverse direction and continue to the target
  viaReverse(t) {
    t.via = false; t.v = 0;
    // shunting loop guard: after repeated reversals accept either heading, no more shunts
    t.viaCount = (t.viaCount || 0) + 1;
    // heading for a depot: the shunt serves the way into the shed
    if (t.tgtKind === 'depot' && t.depotOrder) {
      const dep = this.game.stations.depotById(t.depotOrder.id);
      const dt = dep ? this.depotTarget(dep) : null;
      const o = dt && t.viaCount <= 3 ? this.planOptions(t, dt, true) : [];
      const rv = o.find((x) => x.kind === 'reverse');
      if (rv && this.applyRoute(t, rv)) { this.afterReverse(t, 'run'); return; }
      if (o.length && this.applyRoute(t, o[0])) return;
      t.depotOrder = null; t.tgtKind = 'station'; t.svcTry = this.game.time;
      t.state = 'depart'; t.stateT = 0;
      return;
    }
    const tgt = t.plat ? (t.viaCount > 2 ? { tile: t.plat.tile, heading: null, noShunt: true } : { tile: t.plat.tile, heading: t.plat.heading }) : null;
    if (!tgt) { t.state = 'idle'; t.stateT = 0; return; }
    const opts = this.planOptions(t, tgt, true).filter((o) => o.kind === 'reverse');
    if (opts.length && this.applyRoute(t, opts[0])) { this.afterReverse(t, 'run'); return; }
    const any = this.planOptions(t, tgt, false);
    if (!any.length || !this.applyRoute(t, any[0])) {
      // only reachable by shunting moves this train cannot make: try other work for a while
      if (t.viaCount > 2 && t.target) { t.unreachable.set(t.target, this.game.time + 90); t.viaCount = 0; }
      t.state = 'lost'; t.stateT = 0; t.problem = 'no_route';
    }
  }

  // After a reversal the train stays exactly where it is on the rails: it
  // pauses briefly while the driver changes ends (lights swap, a puff of
  // steam), then departs the other way. Units with cabs at both ends change
  // ends quickly; a locomotive now at the rear propels the train, a steam
  // engine at the front runs tender first. Nothing is lifted, turned or moved.
  afterReverse(t, next) {
    t.flipped = false;
    const front = t.veh[0], rear = t.veh[t.veh.length - 1];
    const cabs = canLead(front) && canLead({ ...rear, r: !rear.r });
    const steam = t.veh.some((v) => v.k === 'L' && locoModel(v.id).kind.startsWith('steam'));
    t.rev = { p: 0, dur: cabs ? 0.9 : steam ? 2.4 : 1.8, steam, next };
    t.state = 'reversing'; t.stateT = 0; t.v = 0;
    t.visualSig = null;
    this.game.events.emit('trainRunaround', t);
  }

  tickReversing(t, dt) {
    const R = t.rev;
    if (!R || !(R.dur > 0)) { t.rev = null; t.state = (R && R.next) || 'run'; t.stateT = 0; return; }
    t.v = 0;
    R.p = Math.min(1, (R.p || 0) + dt / R.dur);
    if (R.p >= 1) { t.rev = null; t.state = R.next || 'run'; t.stateT = 0; }
  }

  // ---------- targets & dispatcher ----------
  stationAccepts(stn, lot) {
    if (lot.from === stn.id) return false;
    // loads with a drop point (a destination or a change) only leave there
    if (lot.to != null) return stn.id === lot.to || stn.id === lot.via;
    return this.game.stations.accepts(stn, lot.c);
  }
  // freight this train cannot deliver itself: a stop ahead where it can
  // change to another service that takes it on to a place that accepts it
  // (TransportNetwork), no worse than a third above the best way from here
  routeVia(stn, c, ahead) {
    const NW = this.game.network;
    if (!NW || !ahead || !ahead.size) return null;
    const acc = NW.toAcc(c);
    const here = acc.get(stn.id);
    if (!here) return null;
    let best = null, bc = Infinity;
    for (const [h, ivt] of ahead) { const r = acc.get(h); if (!r) continue; const cost = ivt + r.cost; if (cost < bc) { bc = cost; best = { to: h, fd: r.dest }; } }
    return best && bc <= here.cost * 1.3 + 40 ? best : null;
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
      if (S.platformBusy(stn, tg.track, t.id)) { pen += 7; if (this.platformHeldLong(stn, tg.track, t.id)) pen += 15; }
      if (pref != null && pref === tg.track) pen -= 4;
      pen += S.rolePenalty(stn, tg.track, t._st.priority);
      const fit = tg.len * TILE + STOP_EXT;
      if (L > fit) pen += Math.min(4, (L - fit) / TILE);
      o.cost += pen;
      if (!best || o.cost < best.cost) best = o;
    }
    return best;
  }

  // Overtaking at stations: a faster (or higher priority) train that runs
  // through this station on another track, in the direction we face, within
  // the next few tiles and without stopping here. Our departure would put us
  // right in front of it.
  letPassFor(t, stn) {
    if (!stn || stn.tracks.length < 2 || !t.steps.length) return null;
    const hs = t.steps[this.stepAt(t, t.s)];
    const dir = hs.outH != null ? hs.outH : hs.inH;
    const all = new Set(), own = new Set();
    stn.tracks.forEach((tk, k) => { for (const x of tk.tiles) { all.add(x); if (t.plat && t.plat.track === k) own.add(x); } });
    if (!own.size) own.add(hs.tile);
    for (const f of this.trains) {
      // (a train actually standing and waiting for us must not be kept waiting)
      if (f === t || f.state !== 'run' || (f.blockedBy === t.id && f.wait > 1) || f.target === stn.id || !f.steps.length) continue;
      if (f._st.speed < t._st.speed * 1.2 && f._st.prioRank <= t._st.prioRank) continue;
      const h = this.stepAt(f, f.s);
      for (let k = h + 1; k < Math.min(f.steps.length, h + 14); k++) {
        const s = f.steps[k];
        if (!all.has(s.tile)) continue;
        if (own.has(s.tile) || turnOf(s.inH, dir) > 1) break;
        return f;
      }
    }
    return null;
  }

  // a train standing at that platform for a while yet (timetable hold, full
  // load, long loading): better use another platform when there is one
  platformHeldLong(stn, k, id) {
    const tk = stn.tracks[k], net = this.net;
    if (!tk) return false;
    for (const tile of tk.tiles) for (const h of [net.resv[tile * 2], net.resv[tile * 2 + 1]]) {
      if (!h || h === id) continue;
      const o = this.byId(h);
      if (o && o.state === 'load' && (o.ttHold || o.waitFull || o.loadTime - o.stateT > 8)) return true;
    }
    return false;
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
        // a stop marked unreachable (e.g. only by impossible shunting) is skipped for a while
        if (stn && (!here || stn.id !== here.id) && !this.isUnreachable(t, stn.id)) return { stn, stop: r };
        t.routeIdx = (t.routeIdx + 1) % t.route.length;
      }
      t.problem = 'no_route';
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
        const amt = d.stock[c] - (d.claimed[c] || 0) - (c === 'PASSENGERS' ? g.pax.tagged(d) : 0);
        if (amt < 3) continue;
        if (t.filter && !t.filter.includes(c)) continue;
        if (!canCarry(st, c)) continue;
        const room = roomFor(st, t.cargo, c);
        if (room <= 0) continue;
        if (!S.hasDemand(d, c, comp)) continue;
        const n = Math.min(amt, room);
        const sc = (n * CARGO[c].value) / (cheb(fromTile, d.tile) + 8) * (0.9 + jitter(t.id * 131 + d.id * 17 + Math.floor(this.game.time / 7)) * 0.2);
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
    if (t.depotOrder) { this.departToDepot(t); return; }
    // due for a service: the nearest reachable depot first, then on with the route
    if (g.maint && g.maint.needsService(t) && !(t.svcTry > g.time - 60)) {
      t.svcTry = g.time;
      const ch = this.depotChoices(t);
      if (ch.length && ch[0].cost < 60) { t.depotOrder = { id: ch[0].dep.id, stay: false, service: true }; if (this.departToDepot(t) !== false) return; t.depotOrder = null; t.problem = null; }
    }
    const here = this.stationAtHead(t);
    if (t.cargo.length) g.pax.validate(t);
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
    const idKey = choice.stn ? choice.stn.id : -choice.wp;
    // cannot run on or reverse out, but the rear stands in a depot door: back
    // into the shed and come out again (a real move, the train stays on the rails)
    if (!opt && this.shuntIntoDepot(t)) return;
    if (!opt) {
      t.unreachable.set(idKey, g.time + 45);
      this.releaseClaim(t);
      if (t.mode === 'manual') { t.problem = t._st.minTier ? 'needs_electric' : 'no_route'; t.routeIdx = (t.routeIdx + 1) % Math.max(1, t.route.length); }
      else t.problem = 'no_route';
      t.state = 'idle'; t.stateT = 0;
      return;
    }
    if (!this.applyRoute(t, opt)) {
      t.unreachable.set(idKey, g.time + 20);
      t.problem = 'no_route'; t.state = 'idle'; t.stateT = 0;
      return;
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

  // ---------- liveries (cosmetic only: never touch any statistic) ----------
  // target: 'train' (whole train, own vehicle colours cleared), 'loco' (every
  // locomotive), 'veh' (vehicle idx)
  setLivery(t, tok, target = 'train', idx = -1) {
    tok = validToken(tok);
    if (!tok) return false;
    const lists = [t.veh, t.pendingVeh].filter(Boolean);
    if (target === 'train') {
      t.livery = tok; t.liveryScope = 'train';
      for (const vs of lists) for (const v of vs) delete v.lv;
    } else if (target === 'loco') {
      for (const vs of lists) for (const v of vs) if (v.k === 'L') v.lv = tok;
    } else {
      for (const vs of lists) if (vs[idx]) { if (tok === vehicleToken({ ...t, veh: vs }, { ...vs[idx], lv: null })) delete vs[idx].lv; else vs[idx].lv = tok; }
    }
    t.visualSig = null;
    return true;
  }
  // same colours on every train led by the same locomotive model; returns the count
  liveryToSameType(t) {
    let n = 0;
    const locoTok = (t.veh.find((v) => v.k === 'L') || {}).lv || null;
    for (const o of this.trains) {
      if (o === t || o.model !== t.model) continue;
      this.setLivery(o, t.livery, 'train');
      o.liveryScope = t.liveryScope;
      if (locoTok) this.setLivery(o, locoTok, 'loco');
      n++;
    }
    return n;
  }
  restoreLivery(t) { this.setLivery(t, this.game.progression.defaultLivery, 'train'); }

  // ---------- depots: send a train in, park it, bring it out again ----------
  depotExit(dep) { for (let d = 0; d < 8; d++) if (this.net.hasDir(dep.tile, d)) return d; return null; }
  depotTarget(dep) { const e = this.depotExit(dep); return e == null ? null : { tile: dep.tile, heading: opp(e), depot: dep.id }; }
  // reachable depots with the cost of the best way there, nearest first
  depotChoices(t) {
    const out = [];
    for (const dep of this.game.stations.depots) {
      const tgt = this.depotTarget(dep);
      if (!tgt || !this.net.conn[dep.tile]) continue;
      if (t.steps.length) {
        const o = this.planOptions(t, tgt, true);
        if (o.length) out.push({ dep, cost: o[0].cost, opt: o[0] });
      }
    }
    return out.sort((a, b) => a.cost - b.cost);
  }
  // Player order. Returns { ok, reason, depot }.
  orderDepot(t, depId = null, stay = true) {
    if (t.state === 'stored') return { ok: true, depot: this.game.stations.depotById(t.homeDepot) };
    if (t.state === 'spawnwait' || !t.steps.length) { t.depotOrder = null; return { ok: true, depot: this.game.stations.depotById(t.homeDepot) }; }
    const ch = this.depotChoices(t).filter((c) => depId == null || c.dep.id === depId);
    if (!ch.length) return { ok: false, reason: this.game.stations.depots.length ? 'no_depot_route' : 'no_depot' };
    t.depotOrder = { id: ch[0].dep.id, stay };
    // standing trains leave at once; a moving train turns off at the next safe point
    if (['idle', 'lost', 'load'].includes(t.state)) { t.state = 'depart'; t.stateT = 0; }
    else if (t.state === 'run' && !t.via && !t.depotIn) this.departToDepot(t, true);
    return { ok: true, depot: ch[0].dep };
  }
  cancelDepotOrder(t) {
    if (!t.depotOrder) return;
    t.depotOrder = null;
    if (t.tgtKind === 'depot' && !t.depotIn && t.state === 'run') { t.stopS = Math.min(t.stopS, t.steps[this.stepAt(t, t.s)].s1); t.pendingLost = false; t.tgtKind = 'station'; t.target = null; }
  }
  departToDepot(t, moving = false) {
    const g = this.game;
    const dep = g.stations.depotById(t.depotOrder.id);
    const tgt = dep ? this.depotTarget(dep) : null;
    const opts = tgt ? this.planOptions(t, tgt, !moving) : [];
    if (!opts.length || (moving && opts[0].kind === 'reverse')) {
      if (moving) return false;   // keep going; the order is tried again at the next stop
      t.depotOrder = null; t.problem = 'no_depot_route';
      g.events.emit('depotUnreachable', t);
      t.state = 'idle'; t.stateT = 0;
      return false;
    }
    this.releaseClaim(t);
    g.stations.unclaimPlatform(t.id);
    if (!this.applyRoute(t, opts[0])) { if (!moving) { t.state = 'idle'; t.stateT = 0; } return false; }
    t.tgtKind = 'depot'; t.target = null; t.targetWp = null; t.curStop = null;
    t.problem = null; t.pulled = false; t.wait = 0; t.reroutes = 0; t.lastStepIdx = -1; t.blockedBy = 0;
    if (!moving) {
      if (t.flipped) this.afterReverse(t, 'run'); else { t.state = 'run'; t.stateT = 0; }
      g.events.emit('trainDepart', t, null);
    }
    return true;
  }
  // The train stands with its head at the depot tile centre, facing into the
  // shed: run on through the door; vehicles vanish inside one by one.
  enterDepot(t) {
    const hs = t.steps[t.steps.length - 1];
    const dep = hs && this.game.stations.depotAt(hs.tile);
    if (!dep || hs.inH == null || hs.outH != null) return false;
    const L = this.trainLength(t);
    this.truncateAfter(t, t.s);
    const n = t.xs.length - 1, x0 = t.xs[n], y0 = t.ys[n], z0 = t.zs[n];
    const len = Math.hypot(DX[hs.inH], DZ[hs.inH]);
    const ux = DX[hs.inH] / len, uz = DZ[hs.inH] / len;
    const door = t.s + 0.25, run = L + 0.6;
    const steps = Math.ceil(run / 0.5);
    for (let k = 1; k <= steps; k++) { const d = (run * k) / steps; t.xs.push(x0 + ux * d); t.ys.push(y0); t.zs.push(z0 + uz * d); t.ss.push(t.ss[n] + d); }
    hs.s1 = t.ss[t.ss.length - 1]; hs.shed = true;
    t.depotIn = { id: dep.id, door };
    t.stopS = hs.s1 - 0.05;
    t.state = 'run'; t.stateT = 0;
    return true;
  }
  parkInDepot(t) {
    const g = this.game, dep = g.stations.depotById(t.depotIn.id);
    const stay = !!(t.depotOrder && t.depotOrder.stay);
    this.clearTrail(t);
    t.depotIn = null; t.v = 0; t.tgtKind = 'station'; t.target = null; t.curStop = null; t.depotOrder = null;
    if (dep) t.homeDepot = dep.id;
    t.state = stay ? 'stored' : 'spawnwait'; t.stateT = 0;
    if (g.maint) g.maint.service(t, dep);
    g.events.emit('trainInDepot', t, dep, stay);
  }
  releaseFromDepot(t) {
    if (t.state !== 'stored') return false;
    t.state = 'spawnwait'; t.stateT = 1.2;
    return true;
  }
  // Rear still in a depot door and no other way out: reverse into the shed
  // and come out again toward the next job.
  shuntIntoDepot(t) {
    const first = t.steps[0];
    if (!first || first.inH != null || !this.game.stations.depotAt(first.tile)) return false;
    // once per trip: coming straight back out of the shed with still no way
    // on means there is no route at all (the train then waits with a problem)
    if (t.shuntTrips === t.trips) return false;
    const L = this.trainLength(t);
    if (t.s - L > first.s1) return false;
    if (!this.canFlip(t)) return false;
    this.flipTrain(t);
    if (!this.enterDepot(t)) return false;
    t.shuntTrips = t.trips;
    t.depotOrder = { id: this.game.stations.depotAt(t.steps[t.steps.length - 1].tile).id, stay: false };
    t.tgtKind = 'depot'; t.problem = null;
    this.afterReverse(t, 'run');
    return true;
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
    if (t.depotIn) { this.parkInDepot(t); return; }
    if (t.tgtKind === 'depot') {
      if (this.enterDepot(t)) { t.depotMiss = 0; return; }
      // not at the shed after all: try again, but give up the order after a few misses
      t.depotMiss = (t.depotMiss || 0) + 1;
      if (t.depotMiss > 3) { t.depotMiss = 0; t.depotOrder = null; t.tgtKind = 'station'; t.svcTry = this.game.time; }
      t.state = 'depart'; t.stateT = 0; t.v = 0;
      return;
    }
    if (!t.pulled && t.tgtKind !== 'wp' && this.pullForward(t)) { t.pulled = true; t.state = 'run'; return; }
    t.viaCount = 0;
    if (t.tgtKind === 'wp') {
      if (t.mode === 'manual' && t.route.length) t.routeIdx = (t.routeIdx + 1) % t.route.length;
      t.state = 'depart'; t.stateT = 0; t.v = 0;
      return;
    }
    const stn = this.stationAtHead(t) || S.byId(t.target);
    t.state = 'load'; t.stateT = 0; t.v = 0;
    t.loadedHere = 0;
    t.letPass = null; t.yieldT = 0; t.ttHold = false;
    if (t.pendingVeh) this.setVehicles(t, t.pendingVeh);
    if (!stn) { t.loadTime = 0.5; return; }
    if (t.claim && t.claim.st === stn.id) this.releaseClaim(t);
    const opt = t.curStop || { act: 'auto' };
    let moved = 0;
    const keep = [];
    const unload = opt.act !== 'load' && opt.act !== 'none';
    g.pax.validate(t);
    const F = g.flows, ref = { type: 'train', id: t.id };
    for (const lot of t.cargo) {
      if (lot.to != null) {
        if (!unload || lot.to !== stn.id) { keep.push(lot); continue; }
        // its destination, or a change to another service here (paid when it arrives)
        if (F.endsHere(lot, stn)) { g.economy.deliver(t, stn, lot); moved += lot.n; continue; }
        const took = F.change(stn, lot, ref, S.byId(lot.from), 'rail', 1);
        moved += took;
        if (took < lot.n) {
          // the station is full: travellers end their journey here, freight rides on
          const rest = { ...lot, n: lot.n - took };
          if (S.accepts(stn, lot.c)) { delete rest.fd; g.economy.deliver(t, stn, rest); moved += rest.n; } else { delete rest.to; keep.push(rest); }
        }
        continue;
      }
      if (unload && opt.act === 'transfer' && lot.from !== stn.id) {
        // feeder order: the load waits here for the next service (paid when it arrives)
        const took = F.change(stn, lot, ref, S.byId(lot.from), 'rail', 1);
        if (took > 0) { moved += took; if (took < lot.n) keep.push({ ...lot, n: lot.n - took }); continue; }
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
      t.servedIdx = null;
      if (cur && cur.st === stn.id) { t.servedIdx = t.routeIdx % t.route.length; t.routeIdx = (t.routeIdx + 1) % t.route.length; }
    }
    const planned = opt.act === 'unload' || opt.act === 'none' ? 0 : this.planLoad(t, stn, true, opt);
    const eff = Math.max(STATION.minPlatformEff, this.platformFraction(t, stn));
    t.platEff = eff;
    const rate = S.loadRate(stn, [...Object.keys(stn.stock), ...t.cargo.map((l) => l.c)]) * t._st.load * eff;
    t.loadTime = 1.2 + (moved + planned) / Math.max(1, rate) + (opt.dwell || 0);
    t.waitFull = !!opt.full && opt.act !== 'unload' && opt.act !== 'none';
    t.trips++;
    // seconds held at signals and behind other trains since the last stop
    const wt = t.waitTotal || 0;
    if (t._wt0 != null) { const lost = Math.max(0, wt - t._wt0); t.dly = t.dly == null ? lost : t.dly * 0.7 + lost * 0.3; }
    t._wt0 = wt;
    if (moved > 0) t.visualSig = null;
    S.noteArrival(stn, t, moved);
    g.events.emit('trainArrive', t, stn, moved);
  }

  planLoad(t, stn, dry, opt) {
    const g = this.game, S = g.stations;
    const comp = this.net.components();
    const lots = t.cargo.map((l) => lotFrom(l));
    const stops = t.mode === 'manual' ? t.route.map((r) => S.byId(r.st)).filter((s) => s && s !== stn) : null;
    const only = opt && Array.isArray(opt.cargo) && opt.cargo.length ? opt.cargo : null;
    const cargos = Object.keys(stn.stock).filter((c) => stn.stock[c] >= 1);
    const scored = [];
    let ahead = null;
    for (const c of cargos) {
      if (t.filter && !t.filter.includes(c)) continue;
      if (only && !only.includes(c)) continue;
      if (!canCarry(t._st, c)) continue;
      let ok, via = null;
      if (stops) {
        ok = stops.some((s) => S.accepts(s, c) || (t.route.find((r) => r.st === s.id) || {}).act === 'transfer');
        // nowhere on the route takes it: change to another service on the way (routing)
        if (!ok && c !== 'PASSENGERS') { ahead = ahead || g.pax.trainAhead(t, stn); via = this.routeVia(stn, c, ahead); ok = via != null; }
      } else ok = S.hasDemand(stn, c, comp, t);
      if (!ok) continue;
      scored.push({ c, sc: stn.stock[c] * CARGO[c].value, via });
    }
    scored.sort((a, b) => b.sc - a.sc);
    let total = 0;
    for (const { c, via } of scored) {
      const room = roomFor(t._st, lots, c);
      if (room <= 0) continue;
      const claimedByOthers = (stn.claimed[c] || 0);
      const avail = Math.floor(stn.stock[c] - (t.claim && t.claim.st === stn.id ? 0 : Math.min(claimedByOthers, stn.stock[c] * 0.5)));
      const n = Math.min(avail, room, c === 'PASSENGERS' ? g.pax.boardable(t, stn) : Infinity);
      if (n <= 0) continue;
      total += n;
      // passengers board for where they are going (PaxFlow); freight keeps its
      // journey (CargoFlows) and, when it changes on the way, where to get off
      let add;
      if (dry) add = [{ c, n, from: stn.id }];
      else if (c === 'PASSENGERS') add = g.pax.board(t, stn, n);
      else add = g.flows.take(stn, c, n).map((l) => (via ? { ...l, to: via.to, fd: via.fd } : l));
      const got = add.reduce((a, l) => a + l.n, 0);
      if (!dry && got < n) total -= n - got;
      for (const a of add) {
        if (a.t0 == null) a.t0 = g.time;
        const sig = CargoFlows.sig(a);
        const lot = lots.find((l) => l.from === a.from && CargoFlows.sig(l) === sig);
        if (lot) { lot.t0 = ((lot.t0 ?? a.t0) * lot.n + a.t0 * a.n) / (lot.n + a.n); lot.n += a.n; } else lots.push(a);
      }
      // (taking the loads already reduced what waits here)
      if (!dry) {
        g.stations.onPickup(stn, c, got);
        if (g.ratings) g.ratings.onPickup(stn, c, t);
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
      try { this.tickTrain(t, dt); } catch (e) { this.errors = (this.errors || 0) + 1; this.lastError = String(e && e.stack || e); console.error('train tick error', e); log.error('train', 'tick error, train re-formed', { train: t.name, err: String(e && e.message || e) }); this.recoverTrain(t); }
    }
    // smoothed income per minute of each train (lines list, fleet overview)
    this._incT = (this._incT ?? 10) - dt;
    if (this._incT <= 0) {
      this._incT = 10;
      for (const t of this.trains) { const d = t.earned - (t._earnMark ?? t.earned); t._earnMark = t.earned; t.incomeEma = (t.incomeEma || 0) * 0.95 + d * 6 * 0.05; }
    }
    this._deadT -= dt;
    if (this._deadT <= 0) { this._deadT = 1; this.detectDeadlocks(); this.checkInvariants(); }
    // running costs, booked per train
    for (const t of this.trains) {
      const op = t._st.op * (t.state === 'stored' || t.state === 'spawnwait' ? 0 : t.state === 'idle' ? 0.3 : 1) * (g.maint ? g.maint.opMul(t) : 1);
      if (op > 0) g.economy.operatingCost((op / 60) * dt, { type: 'train', id: t.id });
    }
  }

  tickTrain(t, dt) {
    const g = this.game;
    t.stateT += dt;
    t.idleT = t.state === 'idle' || t.state === 'lost' ? (t.idleT || 0) + dt : 0;
    // remember how often the train lost its way since its last trip (livelock guard)
    if (t.state === 'lost' && t._was !== 'lost') { const now = g.time; t.lostLog = (t.lostLog || []).filter((e) => now - e.time < 120 && e.trips === t.trips); t.lostLog.push({ time: now, trips: t.trips }); }
    t._was = t.state;
    if (t.spawnFx > 0) t.spawnFx = Math.max(0, t.spawnFx - dt * 0.6);
    // the whole train has passed the crossover: back on its own lane everywhere
    if (t.xo && t.s - this.trainLength(t) > t.xo.s1 + 0.02) {
      t.xo = null; t.xoDone = (t.xoDone || 0) + 1;   // the other lane is released at the next reservation update
    }
    switch (t.state) {
      case 'spawnwait': {
        if (t.stateT > 1) {
          t.stateT = 0;
          const dep = g.stations.depotById(t.homeDepot) || g.stations.depots[0];
          if (dep && this.spawnAtDepot(t, dep)) return;
          // a train parked without work on the depot track: send it inside to make room
          if (dep) {
            const o = this.trains.find((x) => x !== t && (x.state === 'idle' || x.state === 'lost') && (x.idleT || 0) > 8 && x.steps.length && x.steps[this.stepAt(x, x.s)].tile === dep.tile);
            if (o && this.sendToDepot(o)) o.stateT = -30;
          }
        }
        return;
      }
      case 'depart': this.depart(t); return;
      case 'stored': return;
      case 'idle': {
        if (t.stateT > 3) { t.stateT = 0; this.depart(t); }
        return;
      }
      case 'load': {
        if (t.ttHold) t.ttHeld = (t.ttHeld || 0) + dt;
        if (t.letPass) t.yieldT = (t.yieldT || 0) + dt;
        if (t.stateT >= t.loadTime) {
          const stn = this.stationAtHead(t) || g.stations.byId(t.target);
          const opt = t.curStop || { act: 'auto' };
          if (stn && opt.act !== 'unload' && opt.act !== 'none') {
            const n = this.planLoad(t, stn, false, opt);
            if (n > 0) { t.visualSig = null; t.loadedHere += n; g.events.emit('trainLoaded', t, stn, n); }
          }
          // wait for a full load, but never longer than 150 s (and never while blocking others)
          if (t.fullUntil == null) t.fullUntil = t.stateT + 150;
          const blocking = this.trains.some((o) => o !== t && o.blockedBy === t.id && o.wait > 20);
          if (t.waitFull && stn && !this.isFull(t) && t.stateT < t.fullUntil && !blocking) { t.loadTime = t.stateT + 1.5; return; }
          t.fullUntil = null;
          // timetable: keep an even interval between departures of the line
          const hold = g.lines.holdFor(t);
          if (hold > 0 && !blocking) { t.ttHold = true; t.loadTime = t.stateT + Math.min(hold, 1); return; }
          t.ttHold = false;
          // overtaking: let a faster train that is about to pass on another track go first
          const fast = !blocking && (t.yieldT || 0) < 45 ? this.letPassFor(t, stn) : null;
          if (fast) { if (!t.letPass) g.stats.inc('overtakes'); t.letPass = fast.name; t.loadTime = t.stateT + 1; return; }
          t.letPass = null; t.yieldT = 0;
          g.lines.noteDeparture(t);
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
      for (let k = Math.max(0, t.resvEnd + 1); k <= head; k++) { const ks = this.physKeys(t, S[k]); if (net.canReserve(ks, t.id)) net.reserve(ks, t.id); }
      t.resvEnd = head;
    }
    let limitS = Infinity, blocker = 0, kind = null;
    // the head step may have been re-planned (new exit through a junction)
    // while another train holds a conflicting path: stand still until free
    const hs = S[head];
    const hk = hs ? this.physKeys(t, hs) : null;
    if (hs && hk.some((key) => !net.holds(key, t.id))) {
      if (net.canReserve(hk, t.id)) { net.reserve(hk, t.id); t.headHold = null; } else {
        blocker = net.holder(hk, t.id); kind = 'train';
        limitS = t.s; t.waitKeys = hk.slice(); t.waitStamp = this.game.time;
      }
    }
    while (!blocker && t.resvEnd < S.length - 1) {
      const k = t.resvEnd + 1;
      if (S[k].s0 > t.s + lookahead) break;
      const e = this.groupEnd(t, k);
      // never reserve onto track that no longer exists (it may have been
      // removed while the train was in a state that does not re-plan)
      if (this.pathBroken(t, k - 1, e)) { this.repairPath(t); return { limitS: Math.min(t.stopS, t.ss[t.ss.length - 1]), blocker: 0, kind: null }; }
      const r = this.tryReserve(t, k, e);
      if (r === true) { t.resvEnd = e; t.waitKeys = null; continue; }
      blocker = r.blocker; kind = r.kind;
      limitS = S[k].s0 - 0.3;
      // publish what we are waiting for (fairness: see yieldsTo)
      if (r.kind === 'works') t.waitKeys = null;
      else if (r.kind !== 'yield' || !t.waitKeys) { const wk = []; for (let i = k; i <= e; i++) wk.push(...S[i].keys); t.waitKeys = wk; }
      t.waitStamp = this.game.time;
      break;
    }
    // held keys: steps from the rear to the frontier
    const need = new Set(), runs = new Set();
    for (let k = 0; k <= t.resvEnd && k < S.length; k++) {
      const st = S[k];
      if (st.s1 < tailS - 0.05) continue;
      const pk = this.physKeys(t, st);
      if (t.xo && pk !== st.keys) {
        // both lanes through the crossover (re-taken after a track edit)
        const miss = pk.filter((key) => !net.holds(key, t.id));
        if (miss.length && net.canReserve(miss, t.id)) net.reserve(miss, t.id);
        else if (miss.length && k > head) {
          limitS = Math.min(limitS, st.s0 - 0.3);
          if (!blocker) { const hm = miss.filter((key) => !net.canReserve([key], t.id)); blocker = net.holder(hm, t.id); kind = st.jn ? 'junction' : 'block'; t.waitKeys = hm; t.waitStamp = this.game.time; }
        }
      }
      for (const key of pk) if (net.holds(key, t.id)) need.add(key);
      if (st.rid >= 0) runs.add(st.rid);
    }
    // crossing back to its own lane after a reversal: start (like a departure
    // signal clearing) only when both lanes through the window and the way just
    // beyond it are ours
    if (t.xo && t.s <= t.xo.s0 + 0.05) {
      const want = [];
      for (let k = head; k < S.length; k++) { const o = S[k]; if (o.s0 >= t.xo.s1) break; for (const key of this.physKeys(t, o)) if (!net.holds(key, t.id)) want.push(key); }
      const front = t.resvEnd >= 0 && S[t.resvEnd] ? S[t.resvEnd].s1 : t.s;
      const needEnd = Math.min(t.stopS, t.xo.s1 + 0.3, t.ss[t.ss.length - 1]);
      if (want.length && net.canReserve(want, t.id)) { net.reserve(want, t.id); for (const k of want) need.add(k); }
      else if (want.length) {
        limitS = Math.min(limitS, t.s);
        const hm = want.filter((k) => !net.canReserve([k], t.id));
        if (!blocker && hm.length) { blocker = net.holder(hm, t.id); kind = 'train'; t.waitKeys = hm; t.waitStamp = this.game.time; }
      }
      if (front < needEnd - 0.01) limitS = Math.min(limitS, t.s);
    }
    if (t.headHold) { if (hs && hs.keys.every((key) => net.holds(key, t.id))) t.headHold = null; else for (const k of t.headHold) if (net.holds(k, t.id)) need.add(k); }
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
    // pending construction: no new reservations onto the site (a train that
    // already holds the keys may pass; after a long wait the site gives way)
    const W = this.game.works;
    if (W && W.zone.size && !((t.worksPass || 0) > this.game.time)) {
      for (let i = k; i <= e; i++) {
        if (!W.zone.has(S[i].tile) || S[i].keys.every((key) => t.held.has(key))) continue;
        // waiting for the site = waiting for the train on it (deadlock chains)
        const tile = S[i].tile, occ = this.tileOccupied(tile);
        let b = occ && occ.id !== t.id ? occ.id : 0;
        if (!b) for (const key of [tile * 2, tile * 2 + 1]) if (net.resv[key] && net.resv[key] !== t.id) { b = net.resv[key]; break; }
        return { blocker: b, kind: 'works' };
      }
    }
    // level crossings: only once the road is clear (the crossing warns)
    const X = this.game.crossings;
    if (X && X.map.size) for (let i = k; i <= e; i++) if (X.at(S[i].tile) && !S[i].keys.every((key) => t.held.has(key)) && X.roadBusy(S[i].tile)) return { blocker: 0, kind: 'crossing' };
    for (let i = k; i <= e; i++) {
      const st = S[i], pk = st.keys;
      if (!net.canReserve(pk, t.id)) return { blocker: net.holder(pk, t.id), kind: st.jn ? 'junction' : st.station ? 'platform' : st.single ? 'single' : 'block' };
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

  // heading assertions: the part of a train's path it occupies or has
  // reserved must be continuous (each step leaves the way the next one
  // enters, onto the neighbour in that direction) and run on connections that
  // exist. (Planned steps beyond the reservation may still follow track that
  // was just rebuilt; the train re-routes before it reserves them.)
  validateHeadings() {
    const out = [], net = this.net;
    for (const t of this.trains) {
      const S = t.steps;
      if (!S.length) continue;
      const L = this.trainLength(t);
      let k0 = this.stepAt(t, t.s);
      while (k0 > 0 && S[k0 - 1].s1 > t.s - L) k0--;
      const k1 = Math.min(S.length - 1, Math.max(t.resvEnd, this.stepAt(t, t.s)));
      for (let k = k0; k <= k1; k++) {
        const a = S[k];
        // (the last reserved step may point at track just removed: the train stops there and re-routes)
        if (k < k1 && a.outH != null && !net.hasDir(a.tile, a.outH) && !(net.special.get(a.tile) || {}).type) { out.push({ train: t.id, k, kind: 'no_exit', tile: a.tile }); break; }
        const b = k < k1 ? S[k + 1] : null;
        if (!b) break;
        if (a.outH == null || b.inH == null) continue;
        if (a.outH !== b.inH || step(a.tile, a.outH) !== b.tile) { out.push({ train: t.id, k, kind: 'discontinuous', tile: a.tile }); break; }
      }
    }
    return out;
  }

  move(t, dt) {
    const g = this.game, net = this.net;
    const st = t._st;
    const weather = g.env ? g.env.effects : { speed: 1, accel: 1 };
    const perf = livePerf(st, cargoMass(t.cargo));
    const fx = g.progression.fx;
    const vmaxTrain = (st.speed * perf.speedMul / KMH_PER_TILE_S) * TILE * weather.speed * (g.maint ? g.maint.speedMul(t) : 1);
    const accel = perf.accel * 1.3 * weather.accel;
    const decel = DECEL * (1 + st.brake);
    let lookahead = (t.v * t.v) / (2 * decel) + TILE * 1.3 + t.v * dt;
    // a reversed train starts across only once the way through the crossover is set
    if (t.xo && t.s <= t.xo.s0 + 0.05) lookahead = Math.max(lookahead, t.xo.s1 + 0.4 - t.s);
    const res = this.updateReservation(t, lookahead);
    let limitS = res.limitS;
    // switches must be set before the train enters a junction
    for (let k = this.stepAt(t, t.s) + 1; k <= t.resvEnd && k < t.steps.length; k++) {
      const s = t.steps[k];
      if (s.s0 > t.s + lookahead) break;
      if (s.jn && !net.switchReady(s.tile, s.inH == null ? 8 : opp(s.inH), s.outH == null ? 8 : s.outH)) {
        // a looping route may hold a later pass over this switch too: set it for this pass
        const a = s.inH == null ? 8 : opp(s.inH), b = s.outH == null ? 8 : s.outH;
        if (a !== 8 && b !== 8 && s.keys.every((key) => net.holds(key, t.id))) {
          const L = this.trainLength(t);
          const onIt = t.steps.some((o, i) => i < k && o.tile === s.tile && o.s1 > t.s - L);
          if (!onIt) net.setSwitch(s.tile, a, b);
        }
        limitS = Math.min(limitS, s.s0 - 0.3); break;
      }
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
        f = 1 - (1 - f) * (1 + fx.curvePenalty) * (st.model.trait === 'tilting' ? 0.5 : 1);
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
    let vt = Math.min(vlim, vb);
    // driver mode: the player sets the power (a share of what is allowed) and
    // may brake; signals, stops and line limits still protect the train
    if (t.drive) { vt = t.drive.brake ? 0 : Math.min(vt, vmaxTrain * t.drive.throttle); t.drive.limit = vlim; t.drive.vt = vt; }
    if (t.v < vt) t.v = Math.min(vt, t.v + accel * dt);
    else t.v = Math.max(vt, t.v - decel * (t.drive && t.drive.brake ? 2.2 : 1.5) * dt);
    if (!isFinite(t.v)) t.v = 0;
    const sPrev = t.s;
    t.s = Math.min(t.s + t.v * dt, Math.max(t.s, stopAt));
    t.odo = (t.odo || 0) + (t.s - sPrev);   // distance run along the track (tests: motion invariant)
    const hk = this.stepAt(t, t.s);
    if (hk !== t.lastStepIdx) { t.lastStepIdx = hk; const s = t.steps[hk]; if (s) net.traffic[s.tile] += 1; }
    const kmh = (t.v / TILE) * KMH_PER_TILE_S;
    if (kmh > g.stats.data.topSpeed) g.stats.set('topSpeed', Math.round(kmh));
    // waypoints: pass through without stopping
    if (t.tgtKind === 'wp' && !t.via && !t.wpChained && t.stopS - t.s < (t.v * t.v) / (2 * decel) + TILE * 1.5) this.chainWaypoint(t);
    // arrival
    if (t.s >= t.stopS - 0.02 && t.v < 0.2) {
      // never snap backwards (a run-around can leave the head past stopS)
      const sSnap = t.s;
      t.s = Math.max(t.s, t.stopS);
      t.odo += t.s - sSnap;
      t.wait = 0; t.blockedBy = 0; t.blockKind = null;
      if (t.pendingLost) { t.pendingLost = false; t.state = 'lost'; t.stateT = 0; t.v = 0; return; }
      if (t.via) { this.viaReverse(t); return; }
      this.arrive(t);
      if (t.steps.length > 60) this.trim(t);
      return;
    }
    // catching up with a slower train (advisor: passing loop / overtaking)
    const slow = res.blocker ? this.byId(res.blocker) : null;
    if (slow && slow.state === 'run' && slow._st.speed < t._st.speed * 0.8) { t.slowAhead = slow.id; t.slowT = (t.slowT || 0) + dt; }
    else if (t.slowT) t.slowT = Math.max(0, t.slowT - dt * 0.05);
    // blocked by another train / signal
    if (limitS < t.stopS - 0.1 && t.v < 0.05 && dist < 0.5) {
      t.wait += dt; t.waitTotal += dt;
      if (res.blocker !== t.blockedBy) { const b = this.byId(res.blocker); t.blockStart = g.time; t.blockTrips = b ? b.trips : 0; }
      t.blockedBy = res.blocker; t.blockKind = res.kind || (res.blocker ? 'block' : 'switch');
      // a pending construction site never holds a train for good: after a
      // while it gives way (the work then waits for this train too)
      if (res.kind === 'works') { t.worksWait = (t.worksWait || 0) + dt; if (t.worksWait > 30) { t.worksPass = g.time + 25; t.worksWait = 0; } }
      const ws = t.steps[Math.min(t.steps.length - 1, t.resvEnd + 1)];
      if (ws) { net.waitHeat[ws.tile] += dt; if (ws.station) g.stations.noteWait(ws.station, dt); }
      if (t.wait > 12 && t.reroutes === 0) { t.reroutes = 1; this.rerouteAvoiding(t); }
    } else if (t.v > 0.3) { t.wait = 0; t.reroutes = 0; t.blockedBy = 0; t.blockKind = null; t.deadT = 0; t.waitKeys = null; t.worksWait = 0; }
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
    this.completeHeadStep(t);
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
  // lost its way n+ times within two minutes without completing a trip
  thrashing(t, n) {
    const now = this.game.time;
    return (t.lostLog || []).filter((e) => now - e.time < 120 && e.trips === t.trips).length >= n;
  }

  detectDeadlocks() {
    // a train that only shunts to and fro goes back to its depot to start over
    for (const t of this.trains) if (t.state !== 'spawnwait' && this.thrashing(t, 6) && this.sendToDepot(t)) { t.lostLog = []; this.incidents.push({ time: this.game.time, trains: [t.id], victim: t.id, how: 'recover', tile: -1 }); if (this.incidents.length > 20) this.incidents.shift(); }
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
        // waiting on a train that is parked without work: clear it off the line
        const other = this.byId(cur);
        if (other && (other.state === 'lost' || other.state === 'idle') && (other.idleT || 0) > 12) {
          if (this.sendToDepot(other) || (this.recoverTrain(other), true)) {
            this.incidents.push({ time: this.game.time, trains: [...path, other.id], victim: other.id, how: 'recover', tile: other.steps[0]?.tile ?? -1 });
            this.game.events.emit('deadlockResolved', other, 'recover', [other]);
          }
          continue;
        }
        // livelock: the train we wait on keeps shunting back and forth (lost,
        // reverse, lost ...) without ever arriving; it only looks busy
        if (other && this.thrashing(other, 4)) {
          if (this.sendToDepot(other) || (this.recoverTrain(other), true)) {
            other.lostLog = [];
            this.incidents.push({ time: this.game.time, trains: [...path, other.id], victim: other.id, how: 'recover', tile: -1 });
            if (this.incidents.length > 20) this.incidents.shift();
            this.game.events.emit('deadlockResolved', other, 'recover', [other]);
          }
          continue;
        }
        // starvation: a busy train (e.g. shuttling on a single-track section it
        // never fully leaves) keeps a waiting train out for minutes while it
        // completes trip after trip
        const waiter = this.byId(path[path.length - 1]);
        const starving = waiter && other && waiter.blockedBy === other.id && waiter.wait > 120 &&
          this.game.time - (waiter.blockStart ?? this.game.time) > 120 && other.trips > (waiter.blockTrips ?? Infinity);
        if (starving && (other.state === 'run' || other.state === 'load' || other.state === 'depart')) {
          const now = this.game.time;
          if (!other.starveT || now - other.starveT > 120) {
            other.starveT = now;
            if (this.sendToDepot(other)) {
              waiter.wait = 0;
              this.incidents.push({ time: now, trains: [...path, other.id], victim: other.id, how: 'recover', tile: -1 });
              if (this.incidents.length > 20) this.incidents.shift();
              this.game.events.emit('deadlockResolved', other, 'recover', [other]);
            }
          }
          continue;
        }
      }
      if (!cyc || !cyc.length) continue;
      const trains = cyc.map((id) => this.byId(id)).filter(Boolean);
      for (const tr of trains) tr.deadT += 1;
      const victim = trains.slice().sort((a, b) => (a._st.prioRank - b._st.prioRank) || (b.wait - a.wait) || (b.id - a.id))[0];
      if (!victim || victim.deadT < 3) continue;
      let how = null;
      // livelock guard: a train picked again and again only shuffles the jam around
      const now = this.game.time;
      victim.victimLog = (victim.victimLog || []).filter((x) => now - x < 180);
      if (victim.victimLog.length >= 3) {
        if (!this.sendToDepot(victim)) this.recoverTrain(victim);
        how = 'recover';
        victim.victimLog = [];
      } else if (victim.reroutes < 2 && this.rerouteAvoiding(victim)) how = 'reroute';
      else if (this.reverseOut(victim)) how = 'reverse';
      else if (victim.deadT > 40) { if (!this.sendToDepot(victim)) this.recoverTrain(victim); how = 'recover'; }
      if (how) {
        if (how === 'reroute' || how === 'reverse') victim.victimLog.push(now);
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
      if (o && o !== t.id) { this.collisions++; this.lastConflict = { key: k, a: o, b: t.id, time: this.game.time }; console.warn('reservation conflict', k, o, t.id); }
      owner.set(k, t.id);
    }
    // junction paths held by different trains must be compatible
    const net = this.net;
    for (const [tile, m] of net.jres) {
      const ents = [...m];
      for (let i = 0; i < ents.length; i++) for (let j = i + 1; j < ents.length; j++) {
        for (const p of ents[i][1]) for (const q of ents[j][1]) {
          if (!net.pathsCompatible(p, q)) { this.collisions++; this.lastConflict = { tile, a: ents[i][0], b: ents[j][0], p, q, time: this.game.time }; console.warn('junction conflict', tile, ents[i][0], ents[j][0], p, q); }
        }
      }
    }
  }

  // Take a train off the network into its depot; it re-enters once the depot
  // track is clear (used to break deadlocks without teleporting into the jam).
  sendToDepot(t) {
    const g = this.game;
    // (a train already ordered to a depot is recovered into that one)
    const ordered = t.depotOrder ? g.stations.depotById(t.depotOrder.id) : null;
    const dep = (ordered && this.net.conn[ordered.tile] ? ordered : null) || g.stations.depotById(t.homeDepot) || g.stations.depots.find((d) => this.net.conn[d.tile] && this.net.connected(d.tile, t.steps[0] ? t.steps[0].tile : d.tile));
    if (!dep || !this.net.conn[dep.tile]) return false;
    this.releaseClaim(t);
    g.stations.unclaimPlatform(t.id);
    this.clearTrail(t);
    t.rev = null; t.via = false; t.pendingLost = false; t.wait = 0; t.deadT = 0; t.reroutes = 0;
    t.homeDepot = dep.id;
    t.depotIn = null; t.tgtKind = 'station';
    if (t.depotOrder) { const stay = t.depotOrder.stay; t.depotOrder = null; t.state = stay ? 'stored' : 'spawnwait'; t.stateT = stay ? 0 : -10; g.events.emit('trainInDepot', t, dep, stay); return true; }
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
          const ok = this.bodyHeld(t);
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
  // would new track on these tiles sit in the fouling zone of a diagonal leg
  // that a train currently holds? (its reservation keys would change under it)
  foulsTrain(tiles) {
    const net = this.net;
    for (const r of tiles) {
      for (let od = 0; od < 8; od += 2) {
        const i = step(r, (od + 4) & 7);
        if (i < 0 || !net.conn[i]) continue;
        if (!net.hasDir(i, (od + 1) & 7) && !net.hasDir(i, (od + 7) & 7)) continue;
        if (this.tileReserved(i)) return true;
      }
    }
    return false;
  }
  tileReserved(tile) {
    const net = this.net;
    // probing a deferred construction: note the tile, report it free
    if (this.probe) { this.probe.add(tile); return false; }
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
      this.repairPath(t);
    }
  }

  // Is the path ahead of the head still on existing track?
  pathBroken(t, from = this.stepAt(t, t.s), to = t.steps.length - 1) {
    const net = this.net;
    for (let k = Math.max(0, from); k <= to && k < t.steps.length; k++) {
      const s = t.steps[k];
      if (!net.conn[s.tile]) return true;
      if (s.inH != null && !net.hasDir(s.tile, opp(s.inH))) return true;
      if (s.outH != null && k < t.steps.length - 1 && !net.hasDir(s.tile, s.outH)) return true;
    }
    return false;
  }
  // track ahead was removed or rebuilt: plan again to the platform, or stop
  // short of the break and find a new way from there
  repairPath(t) {
    if (!this.pathBroken(t)) return false;
    const tgt = t.plat ? { tile: t.plat.tile, heading: t.plat.heading } : null;
    const opts = tgt ? this.planOptions(t, tgt, false) : [];
    if (opts.length) this.applyRoute(t, opts[0]);
    else {
      const { st } = this.headInfo(t);
      this.truncateAfter(t, st ? st.s1 : t.s);
      // (short of the tile edge: the next tile is not ours)
      t.stopS = Math.max(t.s, Math.min(t.ss[t.ss.length - 1], st ? st.s1 : t.s) - 0.4);
      t.problem = 'no_route';
      t.v = Math.min(t.v, 1);
      t.state = 'run'; t.pendingLost = true;
      this.resetReservation(t);
    }
    return true;
  }

  sell(t) {
    const g = this.game;
    this.releaseClaim(t);
    g.stations.unclaimPlatform(t.id);
    this.clearTrail(t);
    this.disposeVisual(t);
    this.trains = this.trains.filter((x) => x !== t);
    const refund = Math.round(consistCost(t.veh, g.economy.costs) * 0.5);
    g.economy.earn(refund, 'sale', false, null, t.name);
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
    g.economy.spend(cost, 'upgrades', { type: 'train', id: t.id }, kind);
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
      case 'spawnwait': return { key: 'st_spawnwait', warn: t.stateT > 20 };
      case 'stored': return { key: 'st_stored', p: { depot: (S.depotById(t.homeDepot) || {}).name || '' } };
      case 'reversing': return { key: 'st_reversing' };
      case 'load': {
        const pct = Math.round(this.fillRatio(t) * 100);
        const here = this.stationAtHead(t);
        if (t.letPass) return { key: 'st_let_pass', p: { train: t.letPass, station: here ? here.name : where } };
        if (t.ttHold) return { key: 'st_timetable', p: { s: Math.max(1, Math.ceil(this.game.lines.holdFor(t))), station: here ? here.name : where } };
        return { key: t.waitFull && t.stateT > t.loadTime - 1.6 ? 'st_wait_full' : 'st_loading', p: { pct, station: here ? here.name : where }, eff: t.platEff };
      }
      case 'lost': return { key: 'prob_' + (t.problem || 'no_route'), warn: true };
      case 'idle': case 'depart': return t.problem ? { key: 'prob_' + t.problem, warn: true } : { key: 'st_idle' };
      case 'run': {
        if (t.broken > 0) return { key: 'st_broken_down', p: { s: Math.ceil(t.broken) }, warn: true };
        if (t.v < 0.05 && t.blockKind === 'works' && t.wait > 0.5) return { key: 'st_wait_works' };
        if (t.v < 0.05 && t.blockKind === 'crossing' && t.wait > 0.5) return { key: 'st_wait_crossing' };
        if (t.v < 0.05 && t.blockedBy !== 0 && t.wait > 0.5) {
          const other = this.byId(t.blockedBy);
          return { key: 'st_wait_' + (t.blockKind || 'block'), p: { train: other ? other.name : '', station: where }, warn: t.wait > 20 };
        }
        if (t.v < 0.05 && t.blockKind === 'switch') return { key: 'st_wait_switch' };
        if (t.tgtKind === 'depot') { const dep = t.depotOrder ? S.depotById(t.depotOrder.id) : null; return { key: t.depotIn ? 'st_entering_depot' : 'st_to_depot', p: { depot: dep ? dep.name : '' } }; }
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
      if (v.k === 'L') return `L${v.id}.${vehicleToken(t, v)}`;
      const w = wagons[wi++];
      return `W${v.id}.${w && w.c ? w.c : ''}.${w && w.n > 0 ? Math.min(3, Math.ceil((w.n / Math.max(1, w.cap)) * 3)) : 0}.${vehicleToken(t, v)}`;
    });
    return `${t.livery}${t.liveryScope === 'loco' ? '~loco' : ''}|${detail}|${parts.join(',')}`;
  }

  buildVisual(t) {
    this.disposeVisual(t);
    const sig = this.consistSig(t);
    const [, detail, partsStr] = sig.split('|');
    const lead = t._st.model;
    const group = new THREE.Group();
    const cars = [];
    const parts = partsStr.split(',');
    let off = 0;
    t.veh.forEach((v, i) => {
      const len = vehLen(v);
      // each vehicle wears its own livery, else the train's (Livery.js)
      const tok = vehicleToken(t, v);
      let geo;
      if (v.k === 'L') geo = locoGeometry(v.id, tok, +detail);
      else {
        const [, cargo, fill] = parts[i].slice(1).split('.');
        geo = wagonGeometry(v.id, cargo || null, +fill, lead.kind, resolvePaint(tok, lead), null, (t.id * 7 + i * 3) & 3);
      }
      retainGeometry(geo);
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
    for (const c of t.visual.cars) releaseGeometry(c.mesh.geometry);
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
      if (t.state === 'spawnwait' || !t.steps.length) { this.disposeVisual(t); continue; }
      if (!t.visual || t.visualSig !== this.consistSig(t)) this.buildVisual(t);
      const V = t.visual;
      V.group.visible = true;
      if (t.fade < 1) t.fade = Math.min(1, t.fade + dt * 1.5);
      const sMin = t.ss[0];
      const inDepot = t.steps[0] && t.steps[0].inH == null && t.steps[0].tile === (g.stations.depotById(t.homeDepot) || {}).tile;
      const speedF = clamp(t.v / 4, 0, 1);
      for (let ci = 0; ci < V.cars.length; ci++) {
        const c = V.cars[ci];
        const sc = t.s - c.off;
        const half = c.len > 1.5 ? c.len / 2 - 0.3 : c.len * 0.36;
        this.sampleAt(t, sc + half, pf);
        this.sampleAt(t, sc - half, pr);
        {
          // both bogies sit on their lane: through a crossover the body turns with it
          const ddx = pf.x - pr.x, ddz = pf.z - pr.z, dl = Math.sqrt(ddx * ddx + ddz * ddz) || 1;
          const ox = -ddz / dl, oz = ddx / dl;
          const lf = LANE * this.laneSide(t, sc + half) * this.laneFactor(t, sc + half), lr = LANE * this.laneSide(t, sc - half) * this.laneFactor(t, sc - half);
          pf.x += ox * lf; pf.z += oz * lf; pr.x += ox * lr; pr.z += oz * lr;
        }
        const dx = pf.x - pr.x, dz = pf.z - pr.z, dy = pf.y - pr.y;
        const len = Math.sqrt(dx * dx + dz * dz) || 1;
        const mesh = c.mesh;
        const bounce = Math.sin(sc * 4.1 + ci) * 0.006 * speedF;
        mesh.position.set((pf.x + pr.x) / 2, (pf.y + pr.y) / 2 + 0.13 + bounce, (pf.z + pr.z) / 2);
        const yaw = Math.atan2(-dz, dx) + (c.v.r ? Math.PI : 0);
        const pitch = Math.atan2(dy, len) * (c.v.r ? -1 : 1);
        const roll = Math.sin(clock * 6.3 + ci * 1.7 + t.id) * 0.012 * speedF;
        _e.set(0, yaw, pitch, 'YXZ');
        mesh.rotation.copy(_e);
        mesh.rotateX(roll);
        let visible = true;
        if (inDepot && sc < sMin + 0.7) visible = false;
        // driving into a depot: gone once through the door
        if (t.depotIn && sc - c.len * 0.3 > t.depotIn.door) visible = false;
        // vehicles not yet on the trail (re-formed / emerging trains) stay hidden
        if (sc - c.len / 2 < sMin - 0.05) visible = false;
        const tile = worldToTile(mesh.position.x, mesh.position.z);
        if (tile >= 0 && this.net.kind(tile) === K_TUNNEL && this.net.conn[tile]) visible = false;
        mesh.visible = visible;
        const sc2 = t.spawnFx > 0 ? 1 + Math.sin((1 - t.spawnFx) * Math.PI * 3) * 0.08 * t.spawnFx : 1;
        mesh.scale.setScalar(sc2 * (0.6 + 0.4 * t.fade));
        if (visible) this._pickList.push(mesh);
        if (!Number.isFinite(mesh.position.x)) { mesh.visible = false; this.recoverTrain(t); break; }
        // coupler to the next vehicle
        if (ci < V.cars.length - 1 && visible && nc < cm.instanceMatrix.count) {
          const cs = t.s - (c.off + c.len / 2 + GAP / 2);
          this.sampleAt(t, cs + 0.1, pc);
          this.sampleAt(t, cs - 0.1, pd);
          const lo = LANE * this.laneSide(t, cs) * this.laneFactor(t, cs);
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
        id: t.id, model: t.model, consist: serializeConsist(t.pendingVeh || t.veh), name: t.name, livery: t.livery, liveryScope: t.liveryScope === 'loco' ? 'loco' : undefined, upg: t.upg, mode: t.mode,
        route: t.route, routeIdx: t.routeIdx, filter: t.filter, cargo: t.cargo, earned: t.earned, trips: t.trips, target: t.target, depotId: t.homeDepot,
        head: hs ? { tile: hs.tile, inH: hs.inH } : null, state: t.state, created: t.created,
        spacing: t.spacing || undefined, group: t.group || undefined,
        depotOrder: t.depotOrder || undefined,
        bought: t.bought ? Math.round(t.bought) : undefined, fin: cleanFin(t.fin), dly: t.dly ? Math.round(t.dly * 10) / 10 : undefined,
        cond: t.cond == null ? undefined : Math.round(t.cond * 1000) / 1000, serviceAt: t.serviceAt == null ? undefined : t.serviceAt, autoService: t.autoService === false ? false : undefined, broken: t.broken > 0 ? Math.round(t.broken) : undefined, breakdowns: t.breakdowns || undefined,
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
    for (const t of this.trains || []) this.disposeVisual(t);
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
        for (const l of t.cargo) if (l.to != null && !g.stations.byId(l.to)) { delete l.to; delete l.via; } else if (l.via != null && !g.stations.byId(l.via)) delete l.via;
        this.trains.push(t);
        const h = d.head;
        let placed = false;
        if (d.state === 'stored' && g.stations.depotById(t.homeDepot)) { t.state = 'stored'; t.depotOrder = null; continue; }
        if (h && typeof h.tile === 'number' && net.conn[h.tile]) {
          if (h.inH != null && net.hasDir(h.tile, opp(h.inH))) {
            const test = { tile: h.tile, inH: h.inH, outH: null };
            if (net.canReserve(net.laneKeys(test), t.id)) {
              this.placeAt(t, h.tile, h.inH);
              placed = this.bodyHeld(t);
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
