// Fleet care (Phase 7): refurbishment and heritage services, for trains and
// road, tram, water and air vehicles alike.
//   refurbish – a vehicle standing in a depot or garage is overhauled for a
//               part of its new price: much of its age is taken off, its
//               condition restored (a cheaper alternative to replacement)
//   heritage  – an old vehicle (HERITAGE_AGE years or more) can run as a
//               heritage service: leisure and tourist trips pay much more,
//               other trips a little more, it costs more to run, and the
//               towns it serves draw more tourists
// Servicing itself: trains at depots, buses and trucks at garages; trams at
// their line's first stop, ships at a port with cranes, aircraft at any
// airport (Roads.canServiceAt).
import { MONTH_S } from './Ledger.js';
import { consistCost } from '../trains/Consist.js';
import { roadModel } from '../road/Roads.js';

export const HERITAGE_AGE = 12;            // years
export const REFURB_SHARE = 0.35;          // of the new price
export const REFURB_KEEP = 0.4;            // of the age kept after an overhaul
export const HERITAGE_OP = 1.2;            // running cost ×
const YEAR_S = MONTH_S * 12;

// fare factor of a leg on a vehicle (heritage services)
export function heritageFare(veh, lot) {
  if (!veh || !veh.heritage || !lot || lot.c !== 'PASSENGERS') return 1;
  return lot.p === 'leisure' || lot.p === 'tourism' ? 1.6 : 1.1;
}

export class Fleet {
  constructor(game) { this.game = game; this._towns = null; this._t = -1; }

  ageYears(o) { return Math.max(0, (this.game.time - (o.bought || 0)) / YEAR_S); }
  // price of a new vehicle of the same kind (today's prices)
  newPrice(o, isTrain) {
    const g = this.game;
    if (isTrain) { let p = 0; try { p = consistCost(o.veh, g.economy.costs); } catch (e) { p = 0; } return Math.max(500, Math.round(p)); }
    const m = roadModel(o.model);
    return m ? Math.round(m.price * g.difficulty.costMul * g.economy.costs.mul()) : 1000;
  }
  refurbCost(o, isTrain) { return Math.round(this.newPrice(o, isTrain) * REFURB_SHARE); }
  refurbError(o, isTrain) {
    if (!o || o.owner) return 'err_unknown';
    if (o.state !== 'stored') return 'err_refurb_depot';
    if (this.ageYears(o) < 2) return 'err_refurb_new';
    if (!this.game.economy.canAfford(this.refurbCost(o, isTrain))) return 'err_no_money';
    return null;
  }
  refurbish(o, isTrain) {
    const g = this.game;
    const err = this.refurbError(o, isTrain);
    if (err) return { error: err };
    const cost = this.refurbCost(o, isTrain);
    const age = this.ageYears(o);
    g.economy.spend(cost, 'maint_vehicles', isTrain ? { type: 'train', id: o.id } : { type: 'road', id: o.id }, '~refurbished');
    o.bought = g.time - age * REFURB_KEEP * YEAR_S;
    o.refurb = (o.refurb || 0) + 1;
    o.breakdowns = 0;
    if (isTrain) { o.cond = null; o.serviced = g.time; } else { o.rel = undefined; o.served = g.time; }
    // too young for a heritage service now
    if (o.heritage && this.ageYears(o) < HERITAGE_AGE) o.heritage = false;
    g.events.emit('vehicleRefurbished', o);
    return { ok: true, cost, before: age, after: this.ageYears(o) };
  }
  heritageOk(o) { return !o.owner && this.ageYears(o) >= HERITAGE_AGE; }
  setHeritage(o, on) {
    if (on && !this.heritageOk(o)) return { error: 'err_heritage_age' };
    o.heritage = !!on;
    this._t = -1;
    return { ok: true };
  }
  // running cost factor
  opMul(o) { return o && o.heritage ? HERITAGE_OP : 1; }
  // towns a heritage service calls at (cached a few seconds)
  heritageTowns() {
    const g = this.game, now = Math.floor(g.time / 8);
    if (this._towns && this._t === now) return this._towns;
    const set = new Set();
    const add = (o) => { if (o && o.links) for (const id of o.links.towns || []) set.add(id); };
    for (const t of g.trains.mine()) if (t.heritage) {
      // its route (manual) or the stations its service calls at (auto)
      const sv = !(t.route && t.route.length) && g.network ? g.network.svcOfTrain(t) : null;
      if (sv) for (const st of sv.stops) add(g.stations.byId(st.k)); else for (const r of t.route || []) add(g.stations.byId(r.st));
    }
    if (g.roads) for (const v of g.roads.vehicles) if (v.heritage) for (const id of v.stops) add(g.roads.stopById(id));
    this._towns = set; this._t = now;
    return set;
  }
}
