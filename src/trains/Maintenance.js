// Vehicle age, reliability and upkeep (per game setting):
//   off      – trains never wear; no breakdowns, no ageing costs
//   relaxed  – condition falls while a train runs; worn or old trains cost a
//              little more to run and run a little slower; never break down
//   tycoon   – as relaxed, and trains in poor condition can break down
//              (they stop on the line for a few seconds, the section stays held)
// Servicing at a depot restores the condition. Trains service themselves
// when their condition falls below their service threshold (default 70 %),
// on the way between stops, if a depot is reachable. Replacement rules swap
// an old or worn locomotive for a newer model while it is in the depot.
// Nothing here ever deletes a train or teleports one.
import { MONTH_S } from '../economy/Ledger.js';
import { locoModel } from './Consist.js';
import { LOCOS } from '../config.js';

const isLoco = (id) => LOCOS.some((m) => m.id === id);

export const REL_MODES = ['off', 'relaxed', 'tycoon'];
const YEAR_S = MONTH_S * 12;
const WEAR_PER_RUN_YEAR = 0.2;      // condition lost per game year of running (≈ one service a year)
const MIN_COND = 0.2;

export class Maintenance {
  constructor(game) {
    this.game = game;
    this.mode = 'relaxed';
    this.rules = [];                 // replacement rules {id, from, to, ageY, cond}
    this.ruleSeq = 1;
    this.t = 0;
  }
  on() { return this.mode !== 'off'; }

  // ---------- per train ----------
  ageY(t) { return Math.max(0, (this.game.time - (t.bought || 0)) / YEAR_S); }
  // the best condition this train can be serviced back to (falls with age)
  baseCond(t) {
    const m = locoModel(t.model);
    return Math.max(0.55, (m ? m.reliability : 0.9) - Math.min(0.3, this.ageY(t) * 0.01));
  }
  cond(t) { return t.cond == null ? this.baseCond(t) : t.cond; }
  // running cost factor
  opMul(t) {
    if (!this.on()) return 1;
    return 1 + Math.min(0.4, this.ageY(t) * 0.015) + Math.max(0, 0.85 - this.cond(t)) * 0.4;
  }
  // top speed factor (0 while broken down)
  speedMul(t) {
    if (!this.on()) return 1;
    if (t.broken > 0) return 0;
    const c = this.cond(t);
    return c < 0.45 ? 0.9 : c < 0.6 ? 0.96 : 1;
  }
  serviceAt(t) { return t.serviceAt == null ? 0.7 : t.serviceAt; }
  needsService(t) { return this.on() && t.autoService !== false && this.cond(t) < this.serviceAt(t); }

  tick(dt) {
    if (!this.on()) return;
    this.t += dt;
    if (this.t < 0.5) return;
    const step = this.t; this.t = 0;
    const g = this.game;
    for (const t of g.trains.trains) {
      if (t.cond == null) t.cond = this.baseCond(t);
      if (t.broken > 0) { t.broken = Math.max(0, t.broken - step); if (!t.broken) g.events.emit('trainRepaired', t); continue; }
      if (t.state !== 'run' || t.v < 0.2) continue;
      t.cond = Math.max(MIN_COND, t.cond - (step / YEAR_S) * WEAR_PER_RUN_YEAR);
      // breakdowns (tycoon): the worse the condition, the likelier
      if (this.mode === 'tycoon' && t.cond < 0.75) {
        const p = Math.pow(1 - t.cond, 2) * 0.012 * step;
        if (this.rand(t) < p) { t.broken = 8 + (1 - t.cond) * 14; t.breakdowns = (t.breakdowns || 0) + 1; t.cond = Math.max(MIN_COND, t.cond - 0.03); g.events.emit('trainBrokeDown', t); }
      }
    }
  }
  // deterministic per train and time (seeded tests stay seeded)
  rand(t) {
    let h = (t.id * 374761393 + Math.floor(this.game.time * 2) * 668265263) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  // in a depot: restore condition, charge the upkeep, apply replacement rules
  service(t, dep) {
    if (!this.on()) return;
    const g = this.game;
    const rule = this.ruleFor(t);
    if (rule) {
      const e = g.trains.replaceLoco(t, rule.from, rule.to);
      if (!e) { t.bought = g.time; t.cond = null; g.events.emit('trainReplaced', t, rule); }
    }
    const before = this.cond(t);
    t.cond = this.baseCond(t);
    t.serviced = g.time;
    const cost = Math.round(g.ledger.vehicleValue(t) * 0.01 * (1 + (t.cond - before) * 3));
    if (cost > 0) g.economy.spend(cost, 'maint_vehicles', { type: 'train', id: t.id }, dep ? dep.name : null);
    g.events.emit('trainServiced', t, dep);
  }

  // ---------- replacement rules ----------
  ruleFor(t) {
    const P = this.game.progression;
    for (const r of this.rules) {
      if (r.from !== t.model) continue;
      if (!isLoco(r.to) || !P.locoUnlocked(locoModel(r.to))) continue;
      if (this.ageY(t) >= r.ageY || this.cond(t) < r.cond) return r;
    }
    return null;
  }
  addRule(from, to, ageY = 25, cond = 0.55) {
    if (!isLoco(from) || !isLoco(to) || from === to) return null;
    const r = { id: this.ruleSeq++, from, to, ageY: Math.max(0, +ageY || 0), cond: Math.min(1, Math.max(0, +cond || 0)) };
    this.rules = this.rules.filter((x) => x.from !== from);
    this.rules.push(r);
    return r;
  }
  removeRule(id) { this.rules = this.rules.filter((r) => r.id !== id); }

  serialize() { return { mode: this.mode, rules: this.rules, ruleSeq: this.ruleSeq }; }
  deserialize(d) {
    if (!d || typeof d !== 'object') return;
    this.mode = REL_MODES.includes(d.mode) ? d.mode : 'relaxed';
    this.rules = (Array.isArray(d.rules) ? d.rules : []).filter((r) => r && isLoco(r.from) && isLoco(r.to)).slice(0, 40)
      .map((r) => ({ id: r.id | 0, from: r.from, to: r.to, ageY: Math.max(0, +r.ageY || 0), cond: Math.min(1, Math.max(0, +r.cond || 0)) }));
    this.ruleSeq = Math.max(d.ruleSeq | 0, 1, ...this.rules.map((r) => r.id + 1));
  }
}
