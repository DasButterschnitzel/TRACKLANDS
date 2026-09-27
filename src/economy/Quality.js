// Service quality (Phase 7): one score for a line from the things travellers
// feel, each shown to the player as its own factor:
//   frequency    how often a vehicle comes (the interval)
//   journey      the time in the vehicle against a direct fast trip
//   waiting      the average wait at a stop (plus queues when full)
//   capacity     how full the vehicles run (crowded vehicles are unpleasant)
//   reliability  delays and how evenly the vehicles are spaced
//   stations     how good the stations and stops are
//   crowding     people left behind at the stops
// Every factor is 0 … 1; the score is their weighted mean. A better service
// makes more people travel from its stops (PaxFlow.demandMul). Freight lines
// use the same factors without crowding and comfort.
const W = { frequency: 0.2, journey: 0.15, waiting: 0.15, capacity: 0.15, reliability: 0.15, stations: 0.1, crowding: 0.1 };
const clamp01 = (v) => Math.max(0, Math.min(1, v));

// k: { headway (s), ride (average seconds in the vehicle, or null), dist
// (average tiles per ride, or null), load (0 … 1+), waiting (people at its
// stops), capVeh (per vehicle), delay (s per trip), cycle (s), reg
// (regularity 0 … 1 or null), stations (0 … 1) }
export function serviceQuality(k) {
  const f = {};
  const hw = k.headway > 0 ? k.headway : Infinity;
  f.frequency = hw === Infinity ? 0 : clamp01(1.08 - (hw - 15) / 260);
  // a direct trip at 120 km/h covers 3 tiles a second (plus a short stop)
  if (k.ride > 0 && k.dist > 0) f.journey = clamp01(1.25 - 0.25 * (k.ride / (4 + k.dist / 3)));
  else f.journey = 0.7;
  f.waiting = hw === Infinity ? 0 : clamp01(1 - (hw / 2 + (k.overflowWait || 0)) / 160);
  const ld = k.load || 0;
  f.capacity = ld <= 0.85 ? 1 : clamp01(1 - (ld - 0.85) * 2.5);
  const dl = k.cycle > 0 ? clamp01(1 - (k.delay || 0) / (k.cycle * 0.35)) : 0.8;
  f.reliability = k.reg != null ? clamp01(dl * 0.6 + k.reg * 0.4) : dl;
  f.stations = clamp01(k.stations ?? 0.5);
  f.crowding = k.capVeh > 0 ? clamp01(1 - Math.max(0, (k.waiting || 0) - k.capVeh) / (k.capVeh * 3)) : 1;
  let sum = 0, ws = 0;
  for (const x in W) { if (k.freight && (x === 'crowding' || x === 'journey')) continue; sum += W[x] * f[x]; ws += W[x]; }
  return { score: ws ? sum / ws : 0, factors: f };
}

// the demand a service quality brings (× the travellers from its stops)
export function qualityDemand(q) { return q == null ? 1 : 0.9 + 0.2 * clamp01(q); }

// what to do about a crowded service, in order of what helps most
// k: metrics ({ n, need, capVeh, load, waiting, headway }), ctx: { bigger
// (a model with more room), longer (room for more coaches), stationFull }
export function crowdingFixes(k, ctx = {}) {
  const out = [];
  if (k.need > k.n) out.push({ key: 'fix_more_vehicles', n: k.need - k.n });
  if (ctx.bigger) out.push({ key: 'fix_bigger', name: ctx.bigger });
  if (ctx.longer) out.push({ key: 'fix_longer', n: ctx.longer });
  if (ctx.stationFull) out.push({ key: 'fix_station', name: ctx.stationFull });
  if (k.headway > 90) out.push({ key: 'fix_frequency' });
  out.push({ key: 'fix_alternative' });
  return out;
}
