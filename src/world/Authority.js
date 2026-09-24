// Local authorities: every town has an opinion of the company (0–100) and a
// light policy profile. The rating moves for transparent, logged reasons:
// good service raises it; demolition, tree clearing and freight facilities in
// town lower it. It gates a few big projects (permits). Approval is always
// immediate and rule based; the town panel shows the rating, the recent
// changes with their reasons and every permit with its threshold.
import { hashStr, tx, tz } from '../util.js';
import { MONTH_S } from '../economy/Ledger.js';

export const POLICIES = ['growth', 'heritage', 'green', 'industrial', 'commuter', 'tourism'];
export const BANDS = [[0, 'hostile'], [20, 'unfriendly'], [40, 'neutral'], [60, 'favourable'], [75, 'supportive'], [90, 'partner']];

// people or jobs per building type, and compensation base (coins)
export const BUILDING = {
  cottage: { pop: 3, comp: 150 }, house: { pop: 5, comp: 250 }, house2: { pop: 8, comp: 350 }, townhouse: { pop: 14, comp: 600 },
  shop: { jobs: 6, comp: 500 }, apartment: { pop: 40, comp: 1500 }, block: { pop: 80, comp: 2500 }, office: { jobs: 120, comp: 4000 },
  tower: { pop: 160, comp: 6000 }, skyscraper: { pop: 300, jobs: 200, comp: 12000 }, warehouse: { jobs: 20, comp: 800 },
  civic: { jobs: 10, comp: 5000, heritage: true }, plaza: { comp: 3000, heritage: true },
};

// permits: rating needed (per policy adjustments below)
export const PERMITS = {
  demolish_home: 30,        // houses, flats
  demolish_business: 35,    // shops, offices, warehouses
  demolish_heritage: 88,    // town hall, square
  station_in_town: 20,      // a new or larger station on town land
  freight_terminal: 40,     // freight facilities inside the town
};
const POLICY_PERMIT = {
  heritage: { demolish_home: 45, demolish_business: 45, demolish_heritage: 95 },
  growth: { demolish_home: 25, demolish_business: 25, station_in_town: 10 },
  industrial: { freight_terminal: 15, demolish_business: 25 },
  green: { freight_terminal: 55 },
  commuter: { station_in_town: 5 },
  tourism: { demolish_heritage: 95, freight_terminal: 50 },
};
// how strongly a policy weighs a kind of change
const POLICY_W = {
  heritage: { demolish: 1.6 }, green: { trees: 2.2, service: 1.1 }, industrial: { freight: 0, goods: 1.5 },
  commuter: { service: 1.5 }, tourism: { demolish: 1.3, service: 1.2 }, growth: { goods: 1.3, demolish: 0.7 },
};

export class Authority {
  constructor(game) {
    this.game = game;
    this.t = 0;
    this.month = -1;
  }

  ensure(town) {
    if (!town.auth) {
      const h = hashStr('policy:' + town.seed + ':' + town.name);
      town.auth = { rating: 50, log: [], policy: town.tourist ? 'tourism' : POLICIES[h % POLICIES.length], trees: 0, served: 0 };
    }
    return town.auth;
  }
  rating(town) { return Math.round(this.ensure(town).rating); }
  band(town) { const r = this.rating(town); let b = BANDS[0][1]; for (const [min, id] of BANDS) if (r >= min) b = id; return b; }
  policy(town) { return this.ensure(town).policy; }
  weight(town, kind) { const w = POLICY_W[this.policy(town)]; return w && w[kind] != null ? w[kind] : 1; }
  permitNeed(town, permit) { const p = POLICY_PERMIT[this.policy(town)]; return p && p[permit] != null ? p[permit] : PERMITS[permit]; }
  allowed(town, permit) {
    if (this.game.sandbox && this.game.sandbox.ignoreAuthority) return true;
    return this.rating(town) >= this.permitNeed(town, permit);
  }

  // change the rating for a reason (logged, shown in the town panel)
  change(town, delta, key, p = null) {
    const A = this.ensure(town);
    if (!delta) return;
    const before = A.rating;
    A.rating = Math.max(0, Math.min(100, A.rating + delta));
    const d = Math.round((A.rating - before) * 10) / 10;
    if (!d) return;
    const last = A.log[A.log.length - 1];
    // repeated small changes of one kind within a month add up in one line
    if (last && last.key === key && this.game.time - last.t < MONTH_S && JSON.stringify(last.p) === JSON.stringify(p)) { last.d = Math.round((last.d + d) * 10) / 10; last.t = this.game.time; }
    else A.log.push({ t: this.game.time, d, key, p });
    if (A.log.length > 12) A.log.shift();
    this.game.events.emit('authorityChanged', town, d, key);
  }

  // which town a tile belongs to (inside its radius), or null
  townAt(tile) {
    const T = this.game.towns;
    let best = null, bd = Infinity;
    for (const t of T.list) {
      const d = Math.max(Math.abs(tx(tile) - t.x), Math.abs(tz(tile) - t.z));
      if (d <= T.radius(t) + 1 && d < bd) { bd = d; best = t; }
    }
    return best;
  }
  buildingAt(tile) {
    for (const t of this.game.towns.list) for (const b of t.buildings) if (b.tile === tile) return { town: t, b };
    return null;
  }

  // ---------- demolition of a town building ----------
  demolishInfo(tile) {
    const hit = this.buildingAt(tile);
    if (!hit) return null;
    const { town, b } = hit;
    const B = BUILDING[b.arch] || { comp: 300 };
    const land = 1 + town.stage * 0.3;
    const cost = Math.round(B.comp * land * this.game.economy.costs.mul());
    const heritage = !!B.heritage;
    const permit = heritage ? 'demolish_heritage' : B.pop ? 'demolish_home' : 'demolish_business';
    const impact = -Math.round((heritage ? 14 : B.pop >= 40 ? 8 : B.pop ? 4 : 3) * this.weight(town, 'demolish'));
    return { town, b, arch: b.arch, pop: B.pop || 0, jobs: B.jobs || 0, cost, heritage, permit, need: this.permitNeed(town, permit), rating: this.rating(town), impact, allowed: this.allowed(town, permit) };
  }
  demolish(tile, silent) {
    const g = this.game;
    const info = this.demolishInfo(tile);
    if (!info) return { error: 'err_unknown' };
    if (!info.allowed) return { error: 'err_permit_denied', info };
    if (!g.economy.canAfford(info.cost)) return { error: 'err_no_money', info };
    g.economy.spend(info.cost, 'compensation', { type: 'tile', id: tile }, `~bld_${info.arch}:1`);
    const T = g.towns, town = info.town;
    T.removeBuilding(info.b);
    town.buildings = town.buildings.filter((x) => x !== info.b);
    g.occupancy.blocked[tile] = 0;
    // the site stays cleared for a while before the town builds on it again
    town.cleared = town.cleared || {};
    town.cleared[tile] = g.time + MONTH_S * 6;
    town.pop = Math.max(10, town.pop - info.pop);
    this.change(town, info.impact, info.heritage ? 'auth_heritage_demolished' : 'auth_demolished', { arch: info.arch });
    g.stats.inc('buildingsDemolished');
    if (!silent) g.events.emit('buildingDemolished', town, info);
    return { ok: true, info };
  }

  // ---------- reactions ----------
  onTreesCleared(tile, n = 1) {
    const town = this.townAt(tile);
    if (!town) return;
    this.change(town, -0.4 * n * this.weight(town, 'trees'), 'auth_trees');
  }
  onStationBuilt(stn) {
    const town = this.townAt(stn.tile);
    if (!town) return;
    const freight = this.game.stations.stationKind ? ['freight', 'yard'].includes(this.game.stations.stationKind(stn).kind) : false;
    if (freight) this.change(town, -3 * this.weight(town, 'freight'), 'auth_freight_in_town');
    else this.change(town, 3, 'auth_new_station');
  }

  // monthly review: service quality, deliveries the town needs, abandonment
  review() {
    const g = this.game;
    for (const town of g.towns.list) {
      const A = this.ensure(town);
      const sts = g.stations.list.filter((s) => s.links && s.links.towns.includes(town.id));
      if (!sts.length) { if (A.rating > 50) this.change(town, -0.5, 'auth_drift'); else if (A.rating < 50) this.change(town, 0.5, 'auth_drift'); continue; }
      // trains that called at the town's stations this month
      let calls = 0, abandoned = 0;
      // (the first review after start or loading only takes the baseline)
      const first = sts.some((s) => s._authArr === undefined);
      for (const s of sts) {
        const a = (s.stats && s.stats.arrivals) || 0, c = a - (s._authArr ?? a);
        s._authArr = a; calls += c;
        if (!first) s._authIdle = c > 0 ? 0 : (s._authIdle || 0) + 1;
        if (s._authIdle >= 3) abandoned++;
      }
      if (first) { A.deliveredMark = town.delivered; continue; }
      // (a month is one game minute: a train calls once or twice)
      if (calls >= 6) this.change(town, 2.5 * this.weight(town, 'service'), 'auth_frequent_service');
      else if (calls >= 2) this.change(town, 1.2 * this.weight(town, 'service'), 'auth_regular_service');
      else if (calls === 1) this.change(town, 0.4 * this.weight(town, 'service'), 'auth_occasional_service');
      else if (calls === 0) this.change(town, -1.5, 'auth_no_service');
      if (abandoned) this.change(town, -1 * abandoned, 'auth_abandoned_station');
      // passengers and goods delivered to the town this month
      const got = town.delivered - (A.deliveredMark ?? town.delivered);
      A.deliveredMark = town.delivered;
      if (got >= 40) this.change(town, 1.5 * this.weight(town, 'goods'), 'auth_deliveries');
      // station congestion: trains queueing to get in
      const jam = sts.some((s) => s.stats && s.stats.waitEma > 0.5);
      if (jam) this.change(town, -1, 'auth_congestion');
    }
  }

  tick(dt) {
    const m = this.game.ledger ? this.game.ledger.monthIndex() : Math.floor(this.game.time / MONTH_S);
    if (this.month < 0) { this.month = m; return; }
    if (m !== this.month) { this.month = m; this.review(); }
  }

  serializeTown(t) {
    const A = t.auth;
    if (!A) return undefined;
    return { rating: Math.round(A.rating * 10) / 10, policy: A.policy, log: A.log.slice(-12), deliveredMark: A.deliveredMark };
  }
  deserializeTown(t, d) {
    if (!d || typeof d !== 'object') return;
    const A = this.ensure(t);
    if (typeof d.rating === 'number' && isFinite(d.rating)) A.rating = Math.max(0, Math.min(100, d.rating));
    if (POLICIES.includes(d.policy)) A.policy = d.policy;
    if (Array.isArray(d.log)) A.log = d.log.filter((e) => e && typeof e.key === 'string' && isFinite(e.d) && isFinite(e.t)).slice(-12).map((e) => ({ t: +e.t, d: +e.d, key: e.key.slice(0, 40), p: e.p && typeof e.p === 'object' ? { arch: typeof e.p.arch === 'string' ? e.p.arch.slice(0, 20) : undefined } : null }));
    if (isFinite(d.deliveredMark)) A.deliveredMark = +d.deliveredMark;
  }
}
