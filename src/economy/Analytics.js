// Finance analysis (Phase 7): read-only figures built from the ledger and
// the per-object books (Ledger.objFin), for the finance panel's ANALYSIS tab
// and the profit overlay. Nothing here changes what anything earns or costs.
//   divisions  – rail, bus, truck, tram, ship and air: vehicles, revenue,
//                costs and profit (this month and last), share in service
//   services   – rail lines, automatic trains, road lines, vehicles without
//                a line: profit last month, best and worst
//   towns      – revenue booked at the stations and stops of each town
//   cargo      – transport revenue by cargo (Ledger.noteCargo)
//   cash flow  – operating, investing and financing, per month
//   returns    – each vehicle's lifetime profit against its price, payback
import { consistCost } from '../trains/Consist.js';
import { roadModel } from '../road/Roads.js';

export const DIVISIONS = ['rail', 'bus', 'truck', 'tram', 'dock', 'airport'];
const OPERATING_IN = ['pax', 'mail', 'freight', 'contract', 'objective', 'grant', 'dividend', 'other'];
const OPERATING_OUT = ['op_trains', 'op_road', 'maint_vehicles', 'maint_track', 'maint_station', 'other'];
const INVEST_OUT = ['construction', 'vehicles', 'road_vehicles', 'upgrades', 'renovation', 'regions', 'decor', 'compensation', 'industry_fund', 'shares', 'deposit', 'acquisition'];
const INVEST_IN = ['sale', 'refund', 'share_sale', 'deposit_back'];

export class Analytics {
  constructor(game) { this.game = game; }
  fin(o) { return this.game.ledger.objFin(o); }
  // one object's figures: this month, last month, lifetime
  figs(o) {
    const f = this.fin(o);
    return { rev: f.rev, cost: f.cost, lastRev: f.lastRev, lastCost: f.lastCost, last: f.lastRev - f.lastCost, now: f.rev - f.cost, life: f.lifeRev - f.lifeCost };
  }
  add(a, f) { a.rev += f.rev; a.cost += f.cost; a.lastRev += f.lastRev; a.lastCost += f.lastCost; a.last += f.last; a.now += f.now; a.life += f.life; return a; }
  blank(extra = {}) { return { rev: 0, cost: 0, lastRev: 0, lastCost: 0, last: 0, now: 0, life: 0, n: 0, active: 0, ...extra }; }

  divisions() {
    const g = this.game, out = {};
    for (const d of DIVISIONS) out[d] = this.blank({ id: d });
    for (const t of g.trains.mine()) {
      if (t.owner) continue;
      const a = out.rail; this.add(a, this.figs(t)); a.n++;
      if (t.state === 'run' || t.state === 'load') a.active++;
    }
    if (g.roads) for (const v of g.roads.vehicles) {
      if (v.owner) continue;
      const m = roadModel(v.model); if (!m || !out[m.kind]) continue;
      const a = out[m.kind]; this.add(a, this.figs(v)); a.n++;
      if (v.state === 'run' || v.state === 'load') a.active++;
    }
    return DIVISIONS.map((d) => out[d]).filter((a) => a.n > 0);
  }

  services() {
    const g = this.game, list = [];
    const inLine = new Set();
    if (g.lines) for (const L of g.lines.list()) {
      const a = this.blank({ kind: 'rail', name: g.lines.name(L), ref: `line:${L.key}` });
      for (const t of L.trains) { if (t.owner) continue; this.add(a, this.figs(t)); a.n++; inLine.add(t); }
      if (a.n) list.push(a);
    }
    const auto = this.blank({ kind: 'rail_auto', name: null });
    for (const t of g.trains.trains) if (!t.owner && !inLine.has(t)) { this.add(auto, this.figs(t)); auto.n++; }
    if (auto.n) list.push(auto);
    if (g.roads) {
      for (const l of g.roads.lines.list) {
        const a = this.blank({ kind: l.kind, name: l.name, ref: `rline:${l.id}` });
        for (const v of g.roads.lines.vehicles(l)) { if (v.owner) continue; this.add(a, this.figs(v)); a.n++; }
        if (a.n) list.push(a);
      }
      const loose = this.blank({ kind: 'road_loose', name: null });
      for (const v of g.roads.vehicles) if (!v.owner && v.line == null) { this.add(loose, this.figs(v)); loose.n++; }
      if (loose.n) list.push(loose);
    }
    return list.sort((a, b) => b.last - a.last || b.now - a.now);
  }

  // revenue booked at stations and stops, by the town they serve (a stop
  // serving two towns is split between them)
  towns() {
    const g = this.game, by = new Map();
    const all = [...g.stations.mine(), ...(g.roads ? g.roads.stops.filter((s) => !s.owner) : [])];
    for (const s of all) {
      const ids = s.links && s.links.towns ? s.links.towns : [];
      if (!ids.length) continue;
      const f = this.fin(s);
      for (const id of ids) {
        const t = g.towns.byId(id); if (!t) continue;
        const a = by.get(id) || { town: t, rev: 0, lastRev: 0, stops: 0 };
        a.rev += f.rev / ids.length; a.lastRev += f.lastRev / ids.length; a.stops++;
        by.set(id, a);
      }
    }
    return [...by.values()].sort((a, b) => b.lastRev - a.lastRev || b.rev - a.rev);
  }

  cargo() {
    const L = this.game.ledger;
    L.roll();
    const last = L.months[L.months.length - 1];
    const cur = L.cur.cargo || {}, prev = (last && last.cargo) || {};
    const keys = new Set([...Object.keys(cur), ...Object.keys(prev)]);
    return [...keys].map((c) => ({ c, now: cur[c] || 0, last: prev[c] || 0 })).sort((a, b) => b.last - a.last || b.now - a.now);
  }

  cashFlow(p) {
    const s = (bag, keys) => keys.reduce((a, k) => a + (bag[k] || 0), 0);
    const operating = s(p.inc, OPERATING_IN) - s(p.exp, OPERATING_OUT);
    const investing = s(p.inc, INVEST_IN) - s(p.exp, INVEST_OUT);
    const financing = (p.inc.loan_in || 0) - (p.exp.loan_out || 0) - (p.exp.interest || 0);
    return { operating, investing, financing, net: operating + investing + financing };
  }

  // lifetime profit against the price paid: return and months to pay back
  returns(max = 8) {
    const g = this.game, out = [];
    for (const t of g.trains.mine()) {
      if (t.owner) continue;
      let price = 0; try { price = consistCost(t.veh, g.economy.costs); } catch (e) { price = 0; }
      out.push(this.ret(t, price, 'train'));
    }
    if (g.roads) for (const v of g.roads.vehicles) { if (v.owner) continue; const m = roadModel(v.model); out.push(this.ret(v, m ? m.price : 0, 'road')); }
    const ok = out.filter((r) => r.price > 0);
    ok.sort((a, b) => b.roi - a.roi);
    return { best: ok.slice(0, max), worst: ok.slice(-Math.min(max, Math.max(0, ok.length - max))).reverse(), n: ok.length };
  }
  ret(o, price, type) {
    const f = this.figs(o);
    const monthly = f.last;
    return { o, type, price, life: f.life, roi: price > 0 ? f.life / price : 0, payback: monthly > 0 ? Math.max(0, (price - f.life) / monthly) : null };
  }

  // the profit overlay: each station's and stop's revenue last month, 0..1
  stopGrades() {
    const g = this.game;
    const all = [...g.stations.mine(), ...(g.roads ? g.roads.stops.filter((s) => !s.owner && s.kind !== 'garage') : [])];
    const vals = all.map((s) => { const f = this.fin(s); return Math.max(f.lastRev, f.rev); });
    const top = Math.max(1, ...vals);
    return all.map((s, i) => ({ s, v: vals[i] / top, rev: vals[i] }));
  }
}
