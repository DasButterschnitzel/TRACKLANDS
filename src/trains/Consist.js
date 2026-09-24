// Persistent consist model: an ordered vehicle list (front → rear in the
// current direction of travel) of locomotives and wagons with lengths, masses,
// orientation (r = vehicle faces the rear), capacities and cargo compatibility.
// Also: performance rating, per-wagon load assignment, AUTO BUILD and the
// inference used to migrate legacy (pre v3) trains.
import {
  LOCOS, WAGONS, WAGON_IDS, CARGO, CONSIST, TRAIN_UPGRADE_EFFECT, PRIORITY, locoLen, locoMass, locoBidir,
} from '../config.js';
import { validToken } from './Livery.js';

export function locoModel(id) { return LOCOS.find((m) => m.id === id) || LOCOS[0]; }

export const GAP = CONSIST.gap;

// ---------- parsing / serialization ----------
// Stored as compact strings: "L:atlas", "L:atlas:r", "W:timber", "W:coach:r"
export function parseConsist(arr) {
  const out = [];
  if (!Array.isArray(arr)) return out;
  for (const s of arr) {
    if (typeof s !== 'string') continue;
    // 'L:pioneer:r@royal_blue' - kind, id, reversed, own livery (optional)
    const [spec, liv] = s.split('@');
    const [k, id, r] = spec.split(':');
    const lv = liv ? validToken(liv) : null;
    const v = k === 'L' && LOCOS.some((m) => m.id === id) ? { k: 'L', id, r: r === 'r' } : k === 'W' && WAGONS[id] ? { k: 'W', id, r: r === 'r' } : null;
    if (!v) continue;
    if (lv) v.lv = lv;
    out.push(v);
    if (out.length >= CONSIST.maxVehicles) break;
  }
  return out;
}
export function serializeConsist(vs) { return vs.map((v) => `${v.k}:${v.id}${v.r ? ':r' : ''}${v.lv ? '@' + v.lv : ''}`); }
export function cloneConsist(vs) { return vs.map((v) => (v.lv ? { k: v.k, id: v.id, r: v.r, lv: v.lv } : { k: v.k, id: v.id, r: v.r })); }

export function vehLen(v) { return v.k === 'L' ? locoLen(locoModel(v.id)) : WAGONS[v.id].len; }
export function vehMass(v) { return v.k === 'L' ? locoMass(locoModel(v.id)) : WAGONS[v.id].mass; }
export function consistLength(vs) {
  let L = 0;
  for (const v of vs) L += vehLen(v);
  return L + Math.max(0, vs.length - 1) * GAP;
}
export function locosOf(vs) { return vs.filter((v) => v.k === 'L'); }
export function leadModel(vs) { const l = vs.find((v) => v.k === 'L'); return locoModel(l ? l.id : 'pioneer'); }

// A vehicle can lead the train when it has a driving cab facing forward.
export function canLead(v) {
  if (!v) return false;
  if (v.k === 'L') return !v.r || locoBidir(locoModel(v.id));
  return !!WAGONS[v.id].cab;
}

// ---------- availability ----------
export function wagonUnlocked(id, research) { const w = WAGONS[id]; return !!w && (!w.research || research.has(w.research)); }
export function maxLocos(research) { return research.has('heavy_haul') ? CONSIST.maxLocosHeavy : CONSIST.maxLocos; }
export function eraFactor(m) { return 1 + 0.35 * Math.max(0, m.era - 1); }

// ---------- stats ----------
export function perfFactor(ratio) { return Math.max(0.4, Math.min(1.15, 0.45 + 0.1 * ratio)); }
export function ratingKey(ratio) {
  if (ratio >= CONSIST.ratingExcellent) return 'excellent';
  if (ratio >= CONSIST.ratingGood) return 'good';
  if (ratio >= CONSIST.ratingHeavy) return 'heavy';
  return 'overloaded';
}

export function computeStats(vs, upg, fx) {
  const E = TRAIN_UPGRADE_EFFECT;
  const u = upg || { engine: 0, capacity: 0, accel: 0, loading: 0, efficiency: 0 };
  const locos = locosOf(vs).map((v) => locoModel(v.id));
  const lead = locos[0] || locoModel('pioneer');
  let power = 0, locoSpeed = Infinity, accelSum = 0, op = 0, loadF = 0, reliability = 1, minTier = 0;
  for (const m of locos) {
    power += m.power;
    locoSpeed = Math.min(locoSpeed, m.speed);
    accelSum += m.accel * (m.trait === 'high_accel' ? 1.5 : 1);
    op += m.op * (m.trait === 'cheap_op' ? 0.6 : 1) * (1.5 - m.reliability * 0.5);
    loadF = Math.max(loadF, m.load * (m.trait === 'fast_loading' ? 1.4 : 1));
    reliability = Math.min(reliability, m.reliability);
    minTier = Math.max(minTier, m.maglev ? 3 : m.electric ? 2 : 0);
  }
  if (!locos.length) { locoSpeed = 0; loadF = 1; }
  const era = eraFactor(lead);
  const capMul = (1 + E.capacity * u.capacity) * (1 + fx.capacity);
  let emptyMass = 0, wagonVmax = Infinity, brake = 0, revMul = {}, trainRev = 0, paxLoadMul = 0, paxW = 0;
  const wagons = [];
  const caps = {};
  let capFull = 0, fullMass = 0;
  for (const v of vs) {
    emptyMass += vehMass(v);
    if (v.k !== 'W') continue;
    const w = WAGONS[v.id];
    wagonVmax = Math.min(wagonVmax, w.vmax * era);
    brake = Math.max(brake, w.brake || 0);
    trainRev += w.trainRev || 0;
    const freight = w.cls !== 'pax';
    const cap = Math.round(w.cap * capMul * (freight && lead.trait === 'cargo_master' && w.cap ? 1.2 : 1));
    wagons.push({ id: v.id, cap });
    for (const c of w.carries) caps[c] = (caps[c] || 0) + cap;
    if (w.carries.includes('PASSENGERS')) { paxLoadMul += w.loadMul || 1; paxW++; }
    capFull += cap;
    // heaviest cargo the wagon can carry determines the "full" rating
    let hm = 0; for (const c of w.carries) hm = Math.max(hm, CARGO[c].mass);
    fullMass += cap * hm;
    if (w.revMul) for (const c of w.carries) revMul[c] = Math.max(revMul[c] || 0, w.revMul);
  }
  const ratioFull = power / Math.max(1, emptyMass + fullMass);
  const ratioEmpty = power / Math.max(1, emptyMass);
  let speed = locoSpeed * (1 + E.engine * u.engine) * (1 + fx.trainSpeed);
  if (isFinite(wagonVmax)) speed = Math.min(speed, wagonVmax);
  const baseAccel = locos.length ? (accelSum / locos.length) * (1 + E.accel * u.accel) * (1 + fx.trainAccel) : 0;
  const load = loadF * (1 + E.loading * u.loading) * (1 + fx.loadSpeed) * (paxW ? 0.5 + 0.5 * (paxLoadMul / paxW) : 1);
  op = op * (1 - E.efficiency * u.efficiency) * (1 + fx.opCost) + wagons.length * 0.8;
  // priority class
  const pax = caps.PASSENGERS || 0, mail = caps.MAIL || 0;
  const expressW = vs.some((v) => v.k === 'W' && WAGONS[v.id].express);
  let prio = 'service';
  if (pax && (expressW || lead.trait === 'express' || lead.kind === 'hst' || lead.kind === 'maglev')) prio = 'express';
  else if (pax >= capFull * 0.5 && pax) prio = 'passenger';
  else if (mail >= capFull * 0.5 && mail) prio = 'mail';
  else if (capFull) prio = 'freight';
  return {
    model: lead, locos, power, emptyMass, ratioFull, ratioEmpty, rating: ratingKey(ratioFull),
    speed, baseAccel, accel: baseAccel * perfFactor(ratioFull), load, op, minTier, reliability,
    wagons, caps, capFull, brake: brake + (fx.brake || 0), revMul, trainRev, length: consistLength(vs),
    priority: prio, prioRank: PRIORITY[prio], vehicles: vs.length, freight: capFull - pax, pax,
  };
}

// Performance with the current load (used by the physics every tick).
export function livePerf(st, cargoMass) {
  const ratio = st.power / Math.max(1, st.emptyMass + cargoMass);
  const accel = st.baseAccel * perfFactor(ratio);
  const speedMul = ratio >= CONSIST.ratingHeavy ? 1 : 0.6 + 0.4 * (ratio / CONSIST.ratingHeavy);
  const slopeMul = Math.max(0.5, Math.min(2.5, 4 / Math.max(0.5, ratio)));
  return { ratio, accel, speedMul, slopeMul };
}
export function cargoMass(lots) { let m = 0; for (const l of lots) m += l.n * CARGO[l.c].mass; return m; }

// ---------- load assignment ----------
// Each wagon carries one cargo type at a time. Returns per-wagon {c, n} in
// wagon order (index into st.wagons) plus overflow (cargo without a wagon).
export function assignLoads(st, lots) {
  const W = st.wagons.map((w) => ({ id: w.id, cap: w.cap, c: null, n: 0 }));
  const tot = {};
  for (const l of lots) tot[l.c] = (tot[l.c] || 0) + l.n;
  const order = Object.keys(tot).sort((a, b) => tot[b] - tot[a]);
  const overflow = {};
  for (const c of order) {
    let left = tot[c];
    // most specialised wagons first
    const idxs = W.map((w, i) => i).filter((i) => W[i].cap > 0 && WAGONS[W[i].id].carries.includes(c))
      .sort((a, b) => WAGONS[W[a].id].carries.length - WAGONS[W[b].id].carries.length);
    for (const i of idxs) {
      if (left <= 0) break;
      const w = W[i];
      if (w.c && w.c !== c) continue;
      const take = Math.min(left, w.cap - w.n);
      if (take <= 0) continue;
      w.c = c; w.n += take; left -= take;
    }
    if (left > 0) overflow[c] = left;
  }
  return { wagons: W, overflow };
}

// Free space for cargo c given current lots.
export function roomFor(st, lots, c) {
  const { wagons, overflow } = assignLoads(st, lots);
  if (overflow[c]) return 0;
  let room = 0;
  for (const w of wagons) {
    if (!WAGONS[w.id].carries.includes(c)) continue;
    if (w.c === c) room += w.cap - w.n;
    else if (!w.c) room += w.cap;
  }
  return room;
}
export function canCarry(st, c) { return (st.caps[c] || 0) > 0; }

// ---------- building ----------
export function bestWagonFor(cargos, research, preferPax) {
  // wagon covering the most of the requested cargos, then highest capacity
  let best = null, bs = -1;
  for (const id of WAGON_IDS) {
    const w = WAGONS[id];
    if (!w.cap || !wagonUnlocked(id, research)) continue;
    if (id === 'cab_car' || id === 'observation' || id === 'premium') continue;
    if (id === 'hs_coach' && !preferPax) continue;
    const cover = cargos.filter((c) => w.carries.includes(c)).length;
    if (!cover) continue;
    const sc = cover * 100 + w.cap - w.carries.length * 0.5 + (id === 'hs_coach' ? 50 : 0);
    if (sc > bs) { bs = sc; best = id; }
  }
  return best;
}

// Build a sensible consist for a locomotive and a set of cargos.
// opts: { count, research, fx, upg, maxLen }
export function autoBuild(locoId, cargos, opts = {}) {
  const m = locoModel(locoId);
  const research = opts.research || new Set();
  const fx = opts.fx || {};
  const vs = [{ k: 'L', id: locoId, r: false }];
  cargos = (cargos && cargos.length ? cargos : (m.role === 'freight' ? ['WOOD', 'GOODS'] : ['PASSENGERS', 'MAIL'])).filter((c) => CARGO[c]);
  const pax = cargos.includes('PASSENGERS');
  const mail = cargos.includes('MAIL');
  const freight = cargos.filter((c) => c !== 'PASSENGERS' && c !== 'MAIL');
  const types = [];
  if (pax) {
    const hs = (m.kind === 'hst' || m.kind === 'maglev') && wagonUnlocked('hs_coach', research);
    types.push(hs ? 'hs_coach' : m.role === 'passenger' && m.trait === 'city_hopper' ? 'commuter' : 'coach');
  }
  // group freight cargos by a covering wagon
  const left = [...freight];
  while (left.length) {
    const id = bestWagonFor(left, research, false);
    if (!id) break;
    types.push(id);
    for (let i = left.length - 1; i >= 0; i--) if (WAGONS[id].carries.includes(left[i])) left.splice(i, 1);
  }
  if (mail && !types.some((id) => WAGONS[id].carries.includes('MAIL'))) types.push('mail_van');
  if (!types.length) types.push('coach');
  const target = Math.max(1, opts.count || m.wagons);
  const wagons = [];
  // passenger trains: mostly coaches with a mail van; freight: round robin
  for (let i = 0; i < target; i++) {
    let id;
    if (pax && types.length > 1) id = i < Math.max(1, Math.round(target * (freight.length || mail ? 0.6 : 1))) ? types[0] : types[1 + ((i) % (types.length - 1))];
    else id = types[i % types.length];
    wagons.push({ k: 'W', id, r: false });
  }
  // keep the power rating at least "good" and fit the platform
  let full = [...vs, ...wagons];
  while (wagons.length > 1) {
    const st = computeStats(full, opts.upg, fx);
    const tooLong = opts.maxLen && st.length > opts.maxLen;
    if (st.ratioFull >= CONSIST.ratingGood && !tooLong) break;
    wagons.pop();
    full = [...vs, ...wagons];
  }
  // steam freight gets a brake van at the rear
  if (m.kind.startsWith('steam') && !pax && freight.length && wagons.length >= 3) full.push({ k: 'W', id: 'brake_van', r: false });
  // bidirectional multiple units get a rear power car when allowed
  if ((m.kind === 'hst' || m.kind === 'maglev') && maxLocos(research) >= 2 && full.length >= 4) full.push({ k: 'L', id: locoId, r: true });
  return full.slice(0, CONSIST.maxVehicles);
}

// Legacy (pre v3) trains: derive wagons from the model and what the train was doing.
export function inferLegacy(modelId, hints, research) {
  const m = locoModel(modelId);
  const W = m.wagons;
  hints = [...(hints || [])].filter((c) => CARGO[c]);
  const vs = [{ k: 'L', id: modelId, r: false }];
  const unlocked = (id) => wagonUnlocked(id, research || new Set());
  if (!hints.length) {
    // same split the old renderer used
    const paxW = m.pax > 0 ? (m.freight > 0 ? Math.max(1, Math.round(W * m.pax / (m.pax + m.freight))) : W) : 0;
    for (let i = 0; i < W; i++) {
      const id = i < paxW ? 'coach' : m.role === 'passenger' ? 'mail_van' : m.kind === 'steam' ? 'timber' : m.kind === 'steam2' ? 'hopper' : 'boxcar';
      vs.push({ k: 'W', id, r: false });
    }
    return vs;
  }
  const pax = hints.includes('PASSENGERS');
  const others = hints.filter((c) => c !== 'PASSENGERS');
  const types = [];
  const left = [...others];
  while (left.length) {
    let id = bestWagonFor(left, research || new Set(), false);
    if (!id || !unlocked(id)) id = left[0] === 'MAIL' ? 'mail_van' : 'boxcar';
    types.push(id);
    for (let i = left.length - 1; i >= 0; i--) if (WAGONS[id].carries.includes(left[i])) left.splice(i, 1);
    if (types.length > 4) break;
  }
  const paxW = pax ? (types.length ? Math.max(1, Math.round(W * (m.pax || 1) / ((m.pax || 1) + (m.freight || 1)))) : W) : 0;
  for (let i = 0; i < W; i++) {
    const id = i < paxW ? 'coach' : types[(i - paxW) % types.length];
    vs.push({ k: 'W', id, r: false });
  }
  return vs;
}

// Cost of the rolling stock beyond the lead locomotive's list price.
export function vehicleCost(v, costs) { return v.k === 'L' ? costs.train(locoModel(v.id)) : Math.round(WAGONS[v.id].cost * costs.mul()); }
export function consistCost(vs, costs) { let c = 0; for (const v of vs) c += vehicleCost(v, costs); return c; }

// Validation used by the builder UI; returns an error key or null.
export function validateConsist(vs, research) {
  if (!vs.length || !vs.some((v) => v.k === 'L')) return 'err_need_loco';
  if (vs.length > CONSIST.maxVehicles) return 'err_too_many_vehicles';
  if (locosOf(vs).length > maxLocos(research)) return 'err_too_many_locos';
  for (const v of vs) if (v.k === 'W' && !wagonUnlocked(v.id, research)) return 'err_wagon_locked';
  const ms = locosOf(vs).map((v) => locoModel(v.id));
  if (ms.some((m) => m.maglev) && ms.some((m) => !m.maglev)) return 'err_mixed_traction';
  return null;
}

export { WAGONS, WAGON_IDS };
