// Economy simulation: plays a scripted early game with real money on a fresh
// world (standard difficulty, starting region only) and records the money
// curve. Used by the economy test suite to keep the balance in its intended
// bands: an affordable start, a first line that pays for itself within
// minutes, operating costs well below income, and steady progression.
// Run from the console: __tracklands.game.runEconomySim(minutes).
import { idx, tx, tz, step, cheb, RNG } from '../util.js';
import { INDUSTRIES } from '../config.js';
import { consistCost, autoBuild } from '../trains/Consist.js';

export class EconomySim {
  constructor(game, seed = 1) {
    this.g = game;
    this.rng = new RNG(seed * 131 + 7);
    this.log = [];
  }

  // a station tile within reach of (x, z), preferring 2-3 tiles away
  stationNear(x, z) {
    const g = this.g;
    let best = -1, bd = 1e9;
    for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) {
      const t = idx(x + dx, z + dz);
      if (t < 0 || g.stations.placeError(t, 'station')) continue;
      const d = Math.abs(Math.abs(dx) + Math.abs(dz) - 2.5);
      if (d < bd) { bd = d; best = t; }
    }
    if (best < 0) return null;
    const r = g.stations.build(best);
    return r.station || null;
  }

  link(a, b) {
    const C = this.g.construction;
    C.tier = 0; C.trackMode = 'double';
    C.drag = { a: a.tile, b: b.tile }; C.previewTrack();
    if (C.plan && C.plan.ok && this.g.economy.canAfford(C.plan.cost || 0)) C.buildTrack();
    C.drag = null; C.clearPreview();
    // really connected (building can fail for money or terrain)
    const comp = this.g.net.components();
    return comp[a.tile] >= 0 && comp[a.tile] === comp[b.tile];
  }

  depotNear(s) {
    const g = this.g;
    for (let r = 1; r <= 3; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const t = idx(tx(s.tile) + dx, tz(s.tile) + dz);
      if (t < 0 || g.net.conn[t] || g.stations.placeError(t, 'depot')) continue;
      let adj = false;
      for (const d of [0, 2, 4, 6]) { const j = step(t, d); if (j >= 0 && g.net.conn[j] && g.net.degree(j) < 3 && !g.net.special.has(j)) adj = true; }
      if (!adj) continue;
      const r2 = g.stations.buildDepot(t);
      if (r2.depot && g.net.conn[t]) return r2.depot;
      if (r2.depot) g.stations.removeDepot(r2.depot);
    }
    return null;
  }

  buy(vs, dep, route) {
    const g = this.g;
    const r = g.trains.buy(vs, dep);
    if (r.error) { this.log.push('buy failed: ' + r.error); return null; }
    if (route) { r.train.mode = 'manual'; r.train.route = route.map((s) => ({ st: s.id, act: 'auto', dwell: 0, full: false, skip: false, plat: null, cargo: null })); }
    return r.train;
  }

  // opts.extraPax: minutes at which another train joins the passenger line
  run(minutes = 30, opts = {}) {
    const g = this.g, E = g.economy, P = g.progression;
    const res = { start: Math.round(E.coins), samples: [], log: this.log };
    // 1) passenger line between the two biggest towns of the starting region
    const towns = g.towns.list.filter((t) => P.regionUnlocked(t.region)).sort((a, b) => b.pop - a.pop);
    const [ta, tb] = towns;
    const sa = ta && this.stationNear(ta.x, ta.z), sb = tb && this.stationNear(tb.x, tb.z);
    if (!sa || !sb || !this.link(sa, sb)) { res.error = 'no passenger line'; return res; }
    const dep = this.depotNear(sa) || this.depotNear(sb);
    if (!dep) { res.error = 'no depot'; return res; }
    const paxVeh = [{ k: 'L', id: 'pioneer', r: false }, { k: 'W', id: 'coach', r: false }, { k: 'W', id: 'coach', r: false }];
    const tp = this.buy(paxVeh, dep, [sa, sb]);
    res.setupPax = res.start - Math.round(E.coins);
    res.paxDist = cheb(sa.tile, sb.tile);
    // 2) a freight feeder: the nearest raw-material producer with a consumer
    const inds = g.industries.list.filter((i) => P.regionUnlocked(i.region));
    let fr = null;
    for (const src of inds) {
      const outs = new Set(); for (const r of INDUSTRIES[src.type].recipes) for (const c in r.out) outs.add(c);
      for (const dst of inds) {
        if (dst === src || cheb(idx(src.x, src.z), idx(dst.x, dst.z)) < 6) continue;
        const acc = INDUSTRIES[dst.type].recipes.some((r) => Object.keys(r.in || {}).some((c) => outs.has(c)));
        if (acc && (!fr || cheb(idx(src.x, src.z), idx(dst.x, dst.z)) < fr.d)) fr = { src, dst, d: cheb(idx(src.x, src.z), idx(dst.x, dst.z)) };
      }
    }
    // play: sample every minute; build the freight line once affordable
    const trains = [tp];
    let freightBuilt = false;
    const tick = 1 / 10;
    let minMoney = E.coins;
    for (let m = 1; m <= minutes; m++) {
      for (let i = 0; i < 60 / tick; i++) { g.tick(tick); if (E.coins < minMoney) minMoney = E.coins; }
      if (!freightBuilt && fr && E.coins > 3500) {
        const before = E.coins;
        const s1 = this.stationNear(fr.src.x, fr.src.z), s2 = this.stationNear(fr.dst.x, fr.dst.z);
        if (s1 && s2 && (this.link(s1, s2) || this.link(s1, sa))) {
          const d2 = this.depotNear(s1) || dep;
          const outs = []; for (const r of INDUSTRIES[fr.src.type].recipes) for (const c in r.out) outs.push(c);
          const ft = this.buy(autoBuild('pioneer', outs.slice(0, 1), { research: P.research, fx: P.fx, maxLen: 4 }), d2, null);
          if (ft) trains.push(ft);
          res.setupFreight = Math.round(before - E.coins);
          res.freightAt = m;
        }
        freightBuilt = true;
      }
      if ((opts.extraPax || []).includes(m)) { const t2 = this.buy(paxVeh, dep, [sa, sb]); if (t2) { trains.push(t2); t2._joined = m; } }
      res.samples.push({ m, coins: Math.round(E.coins), level: P.level, earned: trains.map((t) => Math.round(t.earned)) });
    }
    res.minMoney = Math.round(minMoney);
    const s = res.samples;
    const at = (m) => (s[m - 1] ? s[m - 1].coins : 0);
    res.breakEven = (s.find((x) => x.coins >= res.start) || {}).m || null;
    res.incomeLast10 = Math.round((at(minutes) - at(Math.max(1, minutes - 10))) / Math.min(10, minutes - 1));
    res.paxTrainPerMin = Math.round(tp.earned / minutes);
    res.paxPayback = tp.earned > 0 ? +(consistCost(paxVeh, E.costs) / (tp.earned / minutes)).toFixed(1) : null;
    res.opPerMin = Math.round(trains.reduce((a, t) => a + t._st.op, 0));
    res.level = P.level;
    res.trips = trains.map((t) => t.trips);
    res.perTrain = trains.map((t) => Math.round(t.earned / Math.max(1, minutes - (t._joined || 0))));
    return res;
  }
}
