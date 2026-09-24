// Company level, research, regions, objectives, achievements, train collection,
// cosmetics, legacy and the Railway Legend completion state.
import { validToken } from '../trains/Livery.js';
import {
  MAX_LEVEL, xpForLevel, rpForLevel, RESEARCH, RESEARCH_UNLOCK_LEVEL, REGIONS, OBJECTIVES, ACHIEVEMENTS, LOCOS, ERA_RESEARCH,
  LIVERIES, STATION_STYLES, REGION_PREV_OBJECTIVES, REGION_DEVELOPED_AT, LEGACY_LEVEL, LEGEND_REQ, COSTS,
} from '../config.js';

const FX_KEYS = ['trackCost', 'bridgeCost', 'tunnelCost', 'curvePenalty', 'trainSpeed', 'trainAccel', 'opCost', 'capacity', 'loadSpeed', 'storage',
  'stationRadius', 'cargoIncome', 'mailIncome', 'paxIncome', 'paxProd', 'mailProd', 'townReq', 'industryProd', 'processing', 'industryGrowth',
  'income', 'buildingCost', 'contractReward', 'legacyDiscount', 'switchTime', 'junctionSpeed', 'brake'];

export class Progression {
  constructor(game) {
    this.game = game;
    this.level = 1;
    this.xp = 0;
    this.rp = 0;
    this.research = new Set();
    this.regions = new Set([0]);
    this.objectives = new Set();
    this.developed = new Set();
    this.achievements = new Set();
    this.owned = new Set();
    this.defaultLivery = 'classic_green';
    this.defaultStationStyle = 'classic';
    this.legacy = { count: 0 };
    this.legend = false;
    this.seenUnlocks = new Set();
    this.fx = {};
    this.recomputeFx();
    this._t = 0;
  }

  recomputeFx() {
    const fx = {};
    for (const k of FX_KEYS) fx[k] = 0;
    for (const r of RESEARCH) if (this.research.has(r.id)) for (const k in r.fx) fx[k] = (fx[k] || 0) + r.fx[k];
    fx.legacyDiscount = Math.min(0.25, this.legacy.count * 0.05);
    fx.income += Math.min(0.2, this.legacy.count * 0.03);
    this.fx = fx;
  }

  // ---------- XP / levels ----------
  xpNeeded() { return xpForLevel(this.level); }
  addXP(n) {
    if (!(n > 0)) return;
    this.xp += n;
    let up = false;
    while (this.level < MAX_LEVEL && this.xp >= this.xpNeeded()) {
      this.xp -= this.xpNeeded();
      this.level++;
      this.rp += rpForLevel(this.level);
      up = true;
      this.game.events.emit('levelUp', this.level);
    }
    if (this.level >= MAX_LEVEL) this.xp = Math.min(this.xp, this.xpNeeded());
    if (up) this.game.stations.relinkAll();
  }
  addRP(n) { this.rp += n; this.game.events.emit('rp', n); }

  // unlocks introduced at a given level (for level-up toasts)
  unlocksAt(level) {
    const out = [];
    for (const m of LOCOS) if (m.level === level) out.push({ kind: 'train', id: m.id, name: m.name });
    COSTS.stationUpgradeLevel.forEach((l, i) => { if (l === level && i > 0) out.push({ kind: 'station', level: i }); });
    REGIONS.forEach((r, i) => { if (r.level === level && i > 0) out.push({ kind: 'region', id: r.id }); });
    if (level === RESEARCH_UNLOCK_LEVEL) out.push({ kind: 'research' });
    for (const l of LIVERIES) if (l.unlock.level === level && level > 1) out.push({ kind: 'livery', id: l.id });
    if (level === LEGACY_LEVEL) out.push({ kind: 'legacy' });
    return out;
  }

  // ---------- research ----------
  researchAvailable() { return this.level >= RESEARCH_UNLOCK_LEVEL; }
  researchState(id) {
    const r = RESEARCH.find((x) => x.id === id);
    if (this.research.has(id)) return 'done';
    if (!this.researchAvailable()) return 'locked';
    if (!r.req.every((q) => this.research.has(q))) return 'locked';
    return this.rp >= r.cost ? 'available' : 'unaffordable';
  }
  doResearch(id) {
    const r = RESEARCH.find((x) => x.id === id);
    if (!r) return 'err_unknown';
    const st = this.researchState(id);
    if (st === 'done') return 'err_done';
    if (!this.researchAvailable()) return 'err_research_level';
    if (st === 'locked') return 'err_prereq';
    if (st === 'unaffordable') return 'err_no_rp';
    this.rp -= r.cost;
    this.research.add(id);
    this.recomputeFx();
    this.game.stats.inc('researchDone');
    for (const t of this.game.trains.trains) this.game.trains.refreshStats(t);
    this.game.stations.relinkAll();
    this.game.industries.onStationsChanged();
    this.game.towns.onStationsChanged();
    this.game.events.emit('research', r);
    return null;
  }

  // ---------- regions ----------
  regionUnlocked(r) { return this.regions.has(r); }
  regionObjectivesDone(r) { const list = OBJECTIVES[REGIONS[r].id] || []; return list.filter((o) => this.objectives.has(o.id)).length; }
  nextRegion() { for (let i = 0; i < REGIONS.length; i++) if (!this.regions.has(i)) return i; return -1; }
  regionUnlockInfo(r) {
    const reg = REGIONS[r];
    const g = this.game;
    const prev = r - 1;
    const cost = g.economy.costs.region(r);
    const info = {
      cost, level: reg.level,
      prevUnlocked: prev < 0 || this.regions.has(prev),
      prevObjectives: prev < 0 ? REGION_PREV_OBJECTIVES : this.regionObjectivesDone(prev),
      needObjectives: REGION_PREV_OBJECTIVES,
    };
    info.okLevel = this.level >= reg.level;
    info.okCoins = g.economy.canAfford(cost);
    info.okObj = info.prevObjectives >= REGION_PREV_OBJECTIVES;
    info.ok = info.prevUnlocked && info.okLevel && info.okCoins && info.okObj && !this.regions.has(r);
    return info;
  }
  unlockRegion(r) {
    const info = this.regionUnlockInfo(r);
    if (this.regions.has(r)) return 'err_done';
    if (!info.prevUnlocked) return 'err_region_order';
    if (!info.okLevel) return 'err_level_required';
    if (!info.okObj) return 'err_region_objectives';
    if (!info.okCoins) return 'err_no_money';
    this.game.economy.spend(info.cost, 'regions');
    this.regions.add(r);
    this.game.stats.set('regionsUnlocked', this.regions.size);
    this.addXP(200 * (r + 1));
    this.addRP(2);
    this.game.events.emit('regionUnlocked', r);
    return null;
  }

  // ---------- objectives ----------
  objectiveProgress(o, r) {
    const g = this.game, S = g.stats.data;
    switch (o.type) {
      case 'stat': return S[o.stat] || 0;
      case 'delivered': return (S.cargo && S.cargo[o.cargo]) || 0;
      case 'townStage': return Math.max(0, ...g.towns.list.filter((t) => t.region === r).map((t) => t.stage));
      case 'industryLevel': return Math.max(0, ...g.industries.list.filter((i) => i.region === r).map((i) => i.level));
      case 'connectTowns': return this.connectedTowns();
      default: return 0;
    }
  }
  connectedTowns() {
    const g = this.game;
    const comp = g.net.components();
    const byComp = new Map();
    for (const s of g.stations.list) {
      if (!s.links || !s.links.towns.length || comp[s.tile] < 0) continue;
      const k = comp[s.tile];
      if (!byComp.has(k)) byComp.set(k, new Set());
      for (const t of s.links.towns) byComp.get(k).add(t);
    }
    let best = 0;
    for (const set of byComp.values()) best = Math.max(best, set.size);
    return best >= 2 ? best : 0;
  }

  checkObjectives() {
    const g = this.game;
    REGIONS.forEach((reg, r) => {
      if (!this.regions.has(r)) return;
      const list = OBJECTIVES[reg.id] || [];
      for (const o of list) {
        if (this.objectives.has(o.id)) continue;
        if (this.objectiveProgress(o, r) >= o.n) {
          this.objectives.add(o.id);
          const coins = Math.round(300 * Math.pow(r + 1, 1.7));
          g.economy.earn(coins, 'objective', false);
          this.addXP(120 * (r + 1));
          g.events.emit('objectiveDone', o, r, coins);
        }
      }
      if (!this.developed.has(r) && this.regionObjectivesDone(r) >= REGION_DEVELOPED_AT) {
        this.developed.add(r);
        this.addRP(2);
        g.events.emit('regionDeveloped', r);
      }
    });
  }

  // ---------- achievements ----------
  checkAchievements() {
    const S = this.game.stats.data;
    for (const a of ACHIEVEMENTS) {
      if (this.achievements.has(a.id)) continue;
      if ((S[a.stat] || 0) >= a.target) {
        this.achievements.add(a.id);
        if (a.rp) this.addRP(a.rp);
        this.game.events.emit('achievement', a);
      }
    }
  }

  // ---------- collection & cosmetics ----------
  locoUnlocked(m) {
    if (this.level < m.level) return false;
    const req = ERA_RESEARCH[m.era];
    if (req && !this.research.has(req)) return false;
    return true;
  }
  ownModel(id) { this.owned.add(id); this.syncFleetStats(); }
  syncFleetStats() {
    const g = this.game;
    g.stats.set('modelsOwned', this.owned.size);
    g.stats.set('trainsOwned', g.trains.trains.length);
    g.stats.set('electricTrains', g.trains.electricCount());
  }
  isUnlocked(u) {
    if (!u) return true;
    if (u.level && this.level < u.level) return false;
    if (u.achievement && !this.achievements.has(u.achievement)) return false;
    if (u.region) { const r = REGIONS.findIndex((x) => x.id === u.region); if (!this.regions.has(r)) return false; }
    return true;
  }
  liveries() { return LIVERIES.filter((l) => this.isUnlocked(l.unlock)); }
  stationStyles() { return STATION_STYLES.filter((s) => this.isUnlocked(s.unlock)); }

  // ---------- legacy & legend ----------
  canFoundLegacy() { return this.level >= LEGACY_LEVEL; }
  legendProgress() {
    const g = this.game;
    return {
      regions: [this.regions.size, LEGEND_REQ.regions],
      metropolises: [g.towns.list.filter((t) => t.stage >= 6).length, LEGEND_REQ.metropolises],
      research: [this.research.has(LEGEND_REQ.research) ? 1 : 0, 1],
      deliveries: [g.stats.data.deliveries, LEGEND_REQ.deliveries],
      level: [this.level, LEGEND_REQ.level],
    };
  }
  checkLegend() {
    if (this.legend) return;
    const p = this.legendProgress();
    if (Object.values(p).every(([a, b]) => a >= b)) {
      this.legend = true;
      this.game.stats.set('legend', 1);
      this.game.events.emit('legend');
    }
  }

  tick(dt) {
    this._t += dt;
    if (this._t < 1) return;
    this._t = 0;
    this.syncFleetStats();
    this.checkObjectives();
    this.checkAchievements();
    this.checkLegend();
  }

  serialize() {
    return {
      level: this.level, xp: this.xp, rp: this.rp, research: [...this.research], regions: [...this.regions], objectives: [...this.objectives],
      developed: [...this.developed], achievements: [...this.achievements], owned: [...this.owned], defaultLivery: this.defaultLivery,
      defaultStationStyle: this.defaultStationStyle, legacy: this.legacy, legend: this.legend, seenUnlocks: [...this.seenUnlocks],
      templates: this.templates || [],
    };
  }
  deserialize(d) {
    if (!d) return;
    const arr = (v) => (Array.isArray(v) ? v : []);
    this.level = Math.max(1, Math.min(MAX_LEVEL, d.level | 0 || 1));
    this.xp = Math.max(0, +d.xp || 0);
    this.rp = Math.max(0, d.rp | 0);
    this.research = new Set(arr(d.research).filter((id) => RESEARCH.some((r) => r.id === id)));
    this.regions = new Set(arr(d.regions).filter((r) => r >= 0 && r < REGIONS.length));
    this.regions.add(0);
    this.objectives = new Set(arr(d.objectives));
    this.developed = new Set(arr(d.developed));
    this.achievements = new Set(arr(d.achievements));
    this.owned = new Set(arr(d.owned).filter((id) => LOCOS.some((m) => m.id === id)));
    this.templates = arr(d.templates).filter((tp) => tp && typeof tp.name === 'string' && Array.isArray(tp.veh)).slice(0, 12);
    this.defaultLivery = validToken(d.defaultLivery) || 'classic_green';
    this.defaultStationStyle = STATION_STYLES.some((s) => s.id === d.defaultStationStyle) ? d.defaultStationStyle : 'classic';
    this.legacy = d.legacy && typeof d.legacy.count === 'number' ? { count: d.legacy.count } : { count: 0 };
    this.legend = !!d.legend;
    this.seenUnlocks = new Set(arr(d.seenUnlocks));
    this.recomputeFx();
  }
}
