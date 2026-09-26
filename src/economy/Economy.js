// Coins, construction costs, delivery revenue, operating costs, contracts,
// random world events, daily challenges and the recovery grant.
import { cheb, RNG, hashStr, dateKey, tx, tz } from '../util.js';
import {
  CARGO, REVENUE, TRACK_TIERS, COSTS, HEAVY_CARGO, EVENTS, CONTRACT_SLOTS, DAILY_POOL, REGIONS, INDUSTRIES, LOCOS, trainUpgradeCost, modeFit } from '../config.js';
import { K_BRIDGE, K_TUNNEL } from '../rail/RailNetwork.js';

export const CYCLE_MUL = { boom: 1.12, normal: 1, slump: 0.88 };

export class Economy {
  constructor(game) {
    this.game = game;
    this.coins = 0;
    this.eventFx = {};
    // business cycle: boom / normal / slump, drawn monthly from the world seed
    this.cycle = { state: 'normal', months: 0, m: -1 };
    this.event = null;          // {id, t, dur, town}
    this.nextEvent = 300;
    this.contracts = [];
    this.contractSeq = 1;
    this.daily = null;
    this.incomeLog = [];        // per game-minute buckets
    this.bucket = this.newBucket();
    this.bucketT = 0;
    this.grantCooldown = 0;
    this.grantAvailable = false;
    this.totalOpCost = 0;
    const self = this;
    this.costs = {
      mul() { return self.game.difficulty.costMul * (1 - self.game.progression.fx.legacyDiscount); },
      trackTile(tier, kind) {
        if (tier < 0) return 0;
        const fx = self.game.progression.fx;
        let c = TRACK_TIERS[tier].cost * (1 + fx.trackCost);
        if (kind === K_BRIDGE) c += COSTS.bridgeExtra * (1 + fx.bridgeCost) * (1 + tier * 0.6);
        if (kind === K_TUNNEL) c += COSTS.tunnelExtra * (1 + fx.tunnelCost) * (1 + tier * 0.6);
        return c * this.mul();
      },
      station() { return Math.round(COSTS.station * (1 + self.game.progression.fx.buildingCost) * this.mul()); },
      depot() { return Math.round(COSTS.depot * (1 + self.game.progression.fx.buildingCost) * this.mul()); },
      stationUpgrade(lvl) { return Math.round(COSTS.stationUpgrade[lvl] * (1 + self.game.progression.fx.buildingCost) * this.mul()); },
      train(m) { return Math.round(m.price * self.game.difficulty.costMul); },
      trainUpgrade(m, lvl) { return Math.round(trainUpgradeCost(m.price, lvl) * self.game.difficulty.costMul); },
      decor(d) { return Math.round(d.cost * this.mul()); },
      signal() { return Math.round(COSTS.signal * this.mul()); },
      waypoint() { return Math.round(COSTS.waypoint * this.mul()); },
      region(r) { return Math.round(REGIONS[r].cost * self.game.difficulty.costMul); },
    };
  }

  newBucket() { return { income: 0, deliveries: 0, towns: {} }; }

  canAfford(n) { return this.coins >= n - 1e-6; }
  // every coin in or out is booked once in the company ledger (ref: the
  // object it belongs to, {type, id}; note: short text for the log)
  spend(n, cat, ref = null, note = null) {
    n = Math.max(0, Math.round(n));
    this.coins = Math.max(0, this.coins - n);
    if (n && this.game.ledger) this.game.ledger.book(-n, cat, ref, note);
    this.game.stats.inc('coinsSpent', n);
    this.game.events.emit('coins', -n, cat);
  }
  earn(n, cat, xp = true, ref = null, note = null) {
    n = Math.max(0, Math.round(n));
    if (!n) return;
    this.coins += n;
    if (this.game.ledger) this.game.ledger.book(n, cat, ref, note);
    if (cat !== 'refund' && cat !== 'sale' && cat !== 'share_sale') this.game.stats.inc('coinsEarned', n);
    if (xp) this.game.progression.addXP(n * REVENUE.xpPerCoin);
    this.game.events.emit('coins', n, cat);
  }

  // ---------- revenue ----------
  distTiles(from, to) { if (!from || !to) return 6; return cheb(from.tile, to.tile); }

  revenue(c, n, dist, train, needed, transit = 0) {
    const g = this.game, fx = g.progression.fx, ev = this.eventFx;
    const cfg = CARGO[c];
    let f = Math.min(REVENUE.distCap, REVENUE.distBase + REVENUE.distPerTile * dist);
    if (dist < REVENUE.minTiles) f *= 0.2;
    let v = cfg.value * n * f;
    let mul = 1 + fx.income;
    const isPax = c === 'PASSENGERS', isMail = c === 'MAIL';
    if (isPax) mul += fx.paxIncome; else mul += fx.cargoIncome;
    if (isMail) mul += fx.mailIncome;
    if ((c === 'GOODS' || c === 'MACHINERY') && ev.goodsIncome) mul += ev.goodsIncome;
    if ((c === 'WOOD' || c === 'LUMBER' || c === 'STEEL') && ev.materialIncome) mul += ev.materialIncome;
    if (train) {
      const trait = train._st.model.trait;
      if (trait === 'city_hopper' && isPax && dist < 15) mul += 0.25;
      if (trait === 'long_hauler' && dist > 25) mul += 0.15;
      if (trait === 'heavy_freight' && HEAVY_CARGO.includes(c)) mul += 0.15;
      if (trait === 'express' && (isPax || isMail)) mul += 0.1;
      // premium / observation / specialised wagons
      if (train._st.revMul && train._st.revMul[c]) mul += train._st.revMul[c] * Math.min(1, (train._st.caps[c] || 0) ? 1 : 0);
      if (isPax && train._st.trainRev) mul += train._st.trainRev;
    }
    if (needed) mul *= REVENUE.demandBonus;
    mul *= this.cycleMul();
    const tf = transit > 0 && g.ratings ? g.ratings.timeFactor(c, dist, transit) : 1;
    return v * mul * tf * g.difficulty.incomeMul;
  }

  estimate(c, n, fromStn, toStn, train) {
    const dist = this.distTiles(fromStn, toStn);
    return this.revenue(c, n, dist, train, false);
  }

  deliver(train, stn, lot) {
    const g = this.game;
    const from = g.stations.byId(lot.from);
    const dist = this.distTiles(from, stn);
    const town = stn.links.towns.length ? g.towns.byId(stn.links.towns[0]) : null;
    const needed = town ? g.towns.needs(town, lot.c) : false;
    const transit = lot.t0 != null ? Math.max(0, g.time - lot.t0) : 0;
    const rev = Math.round(this.revenue(lot.c, lot.n, dist, train, needed, transit) * modeFit('rail', lot.c));
    const res = g.stations.distribute(stn, lot.c, lot.n);
    this.bookDelivery(rev, lot.c, lot.n, train, from, stn);
    train.earned += rev;
    const S = g.stats;
    S.inc('deliveries');
    S.incCargo(lot.c, lot.n);
    if (lot.c === 'PASSENGERS') S.inc('passengers', lot.n); else S.inc('freightIncome', rev);
    S.inc('cargoUnits', lot.n);
    S.max('longestRoute', dist);
    this.bucket.income += rev;
    this.bucket.deliveries++;
    if (res.town) {
      const tb = this.bucket.towns[res.town.id] || (this.bucket.towns[res.town.id] = {});
      tb[lot.c] = (tb[lot.c] || 0) + lot.n;
    }
    // contracts
    for (const k of this.contracts) {
      if (k.done) continue;
      if (k.type === 'deliver_town' && lot.c === k.cargo && res.town && res.town.id === k.town) k.progress += lot.n;
      else if (k.type === 'timed_deliver' && lot.c === k.cargo) k.progress += lot.n;
      else if (k.type === 'passengers' && lot.c === 'PASSENGERS') k.progress += lot.n;
      else if (k.type === 'town_link' && lot.c === 'PASSENGERS' && res.town && res.town.id === k.town && from && from.links && from.links.towns.includes(k.from)) k.progress += lot.n;
      else if (k.type === 'freight_income' && lot.c !== 'PASSENGERS') k.progress += rev;
      else if (k.type === 'deliveries') k.progress += 1;
      if (k.progress >= k.amount) this.completeContract(k);
    }
    g.events.emit('delivery', { train, station: stn, cargo: lot.c, amount: lot.n, revenue: rev, town: res.town, industry: res.industry, dist });
    return rev;
  }

  // revenue category of a cargo in the ledger
  revCat(c) { return c === 'PASSENGERS' ? 'pax' : c === 'MAIL' ? 'mail' : 'freight'; }
  // a delivery: booked on the train, credited to both stations' figures
  bookDelivery(rev, c, n, train, fromStn, toStn, ref = null) {
    const L = this.game.ledger;
    const cat = this.revCat(c);
    const note = `~dlv|${c}|${n}|${fromStn ? fromStn.name : ''}|${toStn ? toStn.name : ''}`;
    const vref = ref || (train ? { type: 'train', id: train.id } : null);
    this.earn(rev, cat, true, vref, note);
    if (L && vref) L.objUnits(vref, c, n);
    if (L && rev > 0) { if (toStn) L.objBook({ type: 'station', id: toStn.id }, rev, cat); if (fromStn && fromStn !== toStn) L.objBook({ type: 'station', id: fromStn.id }, rev * 0.5, cat); }
  }

  operatingCost(amount, ref = null) {
    if (amount <= 0) return;
    this.coins = Math.max(0, this.coins - amount);
    if (this.game.ledger) this.game.ledger.bookRunning(amount, ref && ref.type === 'road' ? 'op_road' : 'op_trains', ref);
    this.totalOpCost += amount;
  }

  // ---------- contracts ----------
  producibleCargo() {
    const g = this.game;
    const set = new Set(['PASSENGERS', 'MAIL']);
    for (const ind of g.industries.list) {
      if (!g.progression.regionUnlocked(ind.region)) continue;
      for (const r of INDUSTRIES[ind.type].recipes) for (const c in r.out) set.add(c);
    }
    return [...set];
  }

  makeContract(rng) {
    const g = this.game, lvl = g.progression.level;
    const towns = g.towns.list.filter((t) => g.progression.regionUnlocked(t.region));
    const served = towns.filter((t) => g.stations.list.some((s) => s.links && s.links.towns.includes(t.id)));
    const cargo = this.producibleCargo().filter((c) => c !== 'PASSENGERS');
    const townCargo = cargo.filter((c) => ['WOOD', 'FOOD', 'LUMBER', 'GOODS', 'STEEL', 'FUEL', 'MACHINERY', 'MAIL'].includes(c));
    const types = ['passengers', 'freight_income', 'deliveries'];
    if (served.length && townCargo.length) types.push('deliver_town', 'deliver_town');
    if (cargo.length) types.push('timed_deliver');
    if (g.trains.trains.length >= 2) types.push('trains_running');
    // network play: lines, changes between lines, town-to-town journeys
    const lines = g.lines ? g.lines.list() : [];
    if (lines.length >= 2) types.push('pax_transfers');
    if (lines.some((l) => l.trains.length >= 2)) types.push('timetable');
    if (served.length >= 2) types.push('town_link');
    const used = new Set(this.contracts.map((k) => k.type));
    let type = rng.pick(types);
    for (let i = 0; i < 4 && used.has(type); i++) type = rng.pick(types);
    const scale = 1 + lvl * 0.35;
    const k = { id: this.contractSeq++, type, progress: 0, done: false, claimed: false };
    switch (type) {
      case 'deliver_town': {
        const town = rng.pick(served), c = rng.pick(townCargo);
        k.town = town.id; k.townName = town.name; k.cargo = c;
        k.amount = Math.round((25 + lvl * 6) / 5) * 5;
        k.coins = Math.round(CARGO[c].value * k.amount * 2.6 * (1 + lvl * 0.12));
        break;
      }
      case 'timed_deliver': {
        const c = rng.pick(cargo);
        k.cargo = c; k.amount = Math.round((30 + lvl * 8) / 5) * 5; k.time = 600; k.left = 600;
        k.coins = Math.round(CARGO[c].value * k.amount * 3.2 * (1 + lvl * 0.12));
        break;
      }
      case 'passengers':
        k.amount = Math.round((40 + lvl * 18) / 10) * 10;
        k.coins = Math.round(k.amount * 14 * (1 + lvl * 0.12));
        break;
      case 'freight_income':
        k.amount = Math.round((900 * scale * scale) / 100) * 100;
        k.coins = Math.round(k.amount * 0.45);
        break;
      case 'deliveries':
        k.amount = 10 + Math.floor(lvl * 1.5);
        k.coins = Math.round(250 * scale * 1.4);
        break;
      case 'trains_running':
        k.count = Math.min(g.trains.trains.length, 2 + Math.floor(lvl / 6));
        k.amount = 90;
        k.coins = Math.round(300 * scale * 1.3);
        break;
      case 'pax_transfers':
        k.amount = Math.round((20 + lvl * 6) / 5) * 5;
        k.coins = Math.round(k.amount * 22 * (1 + lvl * 0.12));
        break;
      case 'timetable':
        k.amount = 300;
        k.coins = Math.round(320 * scale * 1.3);
        break;
      case 'town_link': {
        const [a, b] = rng.shuffle(served.slice()).slice(0, 2);
        k.town = b.id; k.townName = b.name; k.from = a.id; k.fromName = a.name;
        k.amount = Math.round((20 + lvl * 8) / 5) * 5;
        k.coins = Math.round(k.amount * 18 * (1 + lvl * 0.12));
        break;
      }
    }
    k.coins = Math.round(k.coins * (1 + g.progression.fx.contractReward));
    k.xp = Math.round(k.coins * 0.6);
    k.rp = rng.chance(type === 'timed_deliver' ? 0.5 : 0.2) ? 1 : 0;
    return k;
  }

  fillContracts() {
    const rng = new RNG(hashStr(`${this.game.world.seed}:${this.contractSeq}:${Math.floor(this.game.time)}`));
    while (this.contracts.filter((k) => !k.claimed).length < CONTRACT_SLOTS) {
      this.contracts.push(this.makeContract(rng));
    }
    this.contracts = this.contracts.filter((k) => !k.claimed);
  }

  // passengers changing trains (PaxFlow)
  onTransfer(n) {
    for (const k of this.contracts) if (!k.done && k.type === 'pax_transfers') { k.progress += n; if (k.progress >= k.amount) this.completeContract(k); }
  }

  completeContract(k) {
    if (k.done) return;
    k.done = true;
    k.progress = k.amount;
    this.game.events.emit('contractDone', k);
  }

  claimContract(k) {
    if (!k.done || k.claimed) return;
    k.claimed = true;
    this.earn(k.coins, 'contract', false);
    this.game.progression.addXP(k.xp);
    if (k.rp) this.game.progression.addRP(k.rp);
    this.game.stats.inc('contractsDone');
    this.game.events.emit('contractClaimed', k);
    this.fillContracts();
  }

  rerollContract(k) {
    // free reroll for contracts not started; keeps the game ad-free
    if (k.done || k.progress > 0) return false;
    this.contracts = this.contracts.filter((x) => x !== k);
    this.fillContracts();
    return true;
  }

  // ---------- daily challenges ----------
  ensureDaily() {
    const key = dateKey();
    if (this.daily && this.daily.date === key) return;
    const rng = new RNG(hashStr('daily:' + key));
    const pool = [...DAILY_POOL];
    rng.shuffle(pool);
    const lvl = this.game.progression.level;
    const list = pool.slice(0, 3).map((d, i) => ({
      id: d.id, stat: d.stat,
      target: Math.round(d.base * (d.scale ? 1 + lvl * 0.6 : 1 + lvl * 0.05)),
      coins: Math.round(220 * (1 + lvl * 0.35)), xp: Math.round(60 * (1 + lvl * 0.5)), rp: i === 2 ? 1 : 0, claimed: false,
    }));
    const snap = {};
    for (const d of list) snap[d.stat] = this.game.stats.data[d.stat] || 0;
    this.daily = { date: key, list, snap };
  }
  dailyProgress(d) { return Math.max(0, (this.game.stats.data[d.stat] || 0) - (this.daily.snap[d.stat] || 0)); }
  claimDaily(d) {
    if (d.claimed || this.dailyProgress(d) < d.target) return;
    d.claimed = true;
    this.earn(d.coins, 'daily', false);
    this.game.progression.addXP(d.xp);
    if (d.rp) this.game.progression.addRP(d.rp);
    this.game.events.emit('dailyClaimed', d);
  }

  // ---------- business cycle ----------
  // Boom pays 12 % more for every delivery, a slump 12 % less; industries
  // produce half that much more or less. A phase lasts at least four months;
  // the first change can come after six.
  cycleMul(state = this.cycle.state) { return CYCLE_MUL[state] || 1; }
  cycleMonth() {
    const g = this.game, C = this.cycle;
    const m = g.ledger ? g.ledger.monthIndex() : 0;
    if (C.m < 0) { C.m = m; return; }
    if (m <= C.m) return;
    C.m = m;
    C.months++;
    if (C.months < (C.state === 'normal' ? 6 : 4)) return;
    const r = new RNG(hashStr(`cycle:${g.world.seed}:${m}`)).next();
    let next = C.state;
    if (C.state === 'normal') next = r < 0.12 ? 'boom' : r < 0.24 ? 'slump' : 'normal';
    else if (r < 0.3) next = 'normal';
    if (next !== C.state) { const prev = C.state; C.state = next; C.months = 0; g.events.emit('econCycle', next, prev); }
  }

  // ---------- events ----------
  startEvent() {
    const g = this.game;
    const rng = new RNG(hashStr(`ev:${g.world.seed}:${Math.floor(g.time)}`));
    const ev = rng.pick(EVENTS);
    this.event = { id: ev.id, t: 0, dur: ev.dur };
    this.eventFx = { ...ev.fx };
    g.events.emit('eventStart', this.event);
  }

  tick(dt) {
    const g = this.game;
    this.cycleMonth();
    // events
    if (this.event) {
      this.event.t += dt;
      if (this.event.t >= this.event.dur) { g.events.emit('eventEnd', this.event); this.event = null; this.eventFx = {}; this.nextEvent = 240 + Math.random() * 240; }
    } else if (g.trains.trains.length) {
      this.nextEvent -= dt;
      if (this.nextEvent <= 0) this.startEvent();
    }
    // contracts timers
    let changed = false;
    for (const k of this.contracts) {
      if (k.done) continue;
      if (k.type === 'timed_deliver') {
        k.left -= dt;
        if (k.left <= 0) { k.claimed = true; changed = true; g.events.emit('contractExpired', k); }
      }
      if (k.type === 'trains_running') {
        const running = g.trains.trains.filter((t) => t.state === 'run' || t.state === 'load').length;
        if (running >= k.count) { k.progress += dt; if (k.progress >= k.amount) this.completeContract(k); }
      }
      if (k.type === 'timetable' && g.lines) {
        const timed = g.lines.list().some((l) => l.trains.length >= 2 && l.trains.every((t) => t.spacing));
        if (timed) { k.progress += dt; if (k.progress >= k.amount) this.completeContract(k); }
      }
    }
    if (changed) this.fillContracts();
    // income buckets
    this.bucketT += dt;
    if (this.bucketT >= 60) {
      this.bucketT = 0;
      this.incomeLog.push(this.bucket);
      if (this.incomeLog.length > 15) this.incomeLog.shift();
      this.bucket = this.newBucket();
    }
    // recovery grant
    this.grantCooldown = Math.max(0, this.grantCooldown - dt);
    const cheapest = this.costs.train(LOCOS[0]) + this.costs.station();
    const noIncome = this.incomeLog.slice(-3).every((b) => b.income === 0) && this.bucket.income === 0;
    const avail = this.coins < cheapest && this.grantCooldown <= 0 && (g.trains.trains.length === 0 || noIncome) && g.stats.data.playTime > 60;
    if (avail !== this.grantAvailable) { this.grantAvailable = avail; g.events.emit('grant', avail); }
  }

  claimGrant() {
    if (!this.grantAvailable) return 0;
    const amt = Math.round(1500 * (1 + this.game.progression.level * 0.3));
    this.grantCooldown = 600;
    this.grantAvailable = false;
    this.earn(amt, 'grant', false);
    this.game.events.emit('grant', false);
    return amt;
  }

  avgIncomePerMin() {
    const L = this.incomeLog.slice(-10);
    if (!L.length) return this.bucketT > 10 ? (this.bucket.income / this.bucketT) * 60 : 0;
    return L.reduce((a, b) => a + b.income, 0) / L.length;
  }
  avgDeliveriesPerMin() {
    const L = this.incomeLog.slice(-10);
    if (!L.length) return 0;
    return L.reduce((a, b) => a + b.deliveries, 0) / L.length;
  }

  serialize() {
    return {
      coins: Math.round(this.coins), event: this.event, eventFx: this.eventFx, nextEvent: this.nextEvent, cycle: { state: this.cycle.state, months: this.cycle.months }, contracts: this.contracts, contractSeq: this.contractSeq,
      daily: this.daily, incomeLog: this.incomeLog, grantCooldown: this.grantCooldown,
    };
  }
  deserialize(d) {
    if (!d) return;
    this.coins = Math.max(0, +d.coins || 0);
    this.event = d.event && typeof d.event.id === 'string' ? d.event : null;
    this.eventFx = this.event && d.eventFx ? d.eventFx : {};
    const cy = d.cycle && typeof d.cycle === 'object' ? d.cycle : {};
    this.cycle = { state: CYCLE_MUL[cy.state] ? cy.state : 'normal', months: Math.max(0, Math.min(1000, cy.months | 0)), m: -1 };
    this.nextEvent = +d.nextEvent || 300;
    this.contracts = Array.isArray(d.contracts) ? d.contracts.filter((k) => k && k.type && k.amount > 0) : [];
    this.contractSeq = d.contractSeq || 1;
    this.daily = d.daily && d.daily.list ? d.daily : null;
    this.incomeLog = Array.isArray(d.incomeLog) ? d.incomeLog.slice(-15) : [];
    this.grantCooldown = +d.grantCooldown || 0;
  }
}

export { tx, tz };
