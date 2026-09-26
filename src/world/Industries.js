// Industries: production chains, storage, station supply, level growth and
// procedural animated visuals.
import * as THREE from 'three';
import { N, TILE, idx, cheb } from '../util.js';
import { INDUSTRIES, INDUSTRY_LEVEL_THRESH, INDUSTRY_INVEST, TOWN_ACCEPTS, CARGO } from '../config.js';
import { cleanFin } from '../economy/Ledger.js';
import { ModelBuilder, meshFrom, shade, MATS } from '../core/ModelBuilder.js';
import { t as tr } from '../i18n.js';

const SEASON_FARM = { winter: 0.7, spring: 1, summer: 1.1, autumn: 1.2 };

export class IndustrySystem {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.cropMat = new THREE.MeshLambertMaterial({ color: 0x8ab04a, flatShading: true });
    this.month = -1;
  }

  byId(id) { return this.list.find((i) => i.id === id); }
  displayName(ind) { return `${ind.townName} ${tr('ind_' + ind.type)}`; }

  init(world) {
    this.list = world.industries.map((s, k) => ({
      id: 1000 + k, type: s.type, x: s.x, z: s.z, region: s.region, townName: s.townName,
      level: 0, inp: {}, out: {}, cycles: 0, every: {}, transported: 0, produced: 0, idle: 0, stake: 0, pv: 0, lastPv: 0,
    }));
    for (const ind of this.list) this.markFootprint(ind);
  }

  markFootprint(ind) {
    const occ = this.game.occupancy;
    for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) {
      const i = idx(ind.x + dx, ind.z + dz);
      occ.blocked[i] = 2; occ.owner[i] = ind.id;
    }
  }

  capacity(ind) { return INDUSTRIES[ind.type].storage * (1 + ind.level); }
  accepts(ind, c) {
    const cfg = INDUSTRIES[ind.type];
    if (cfg.accepts && cfg.accepts.includes(c)) return true;
    return cfg.recipes.some((r) => c in r.in);
  }
  inputs(ind) { const s = new Set(); const cfg = INDUSTRIES[ind.type]; for (const r of cfg.recipes) for (const c in r.in) s.add(c); if (cfg.accepts) for (const c of cfg.accepts) s.add(c); return [...s]; }
  outputs(ind) { const s = new Set(); for (const r of INDUSTRIES[ind.type].recipes) for (const c in r.out) s.add(c); return [...s]; }

  receive(ind, c, n) {
    const cfg = INDUSTRIES[ind.type];
    if (cfg.accepts && cfg.accepts.includes(c) && !cfg.recipes.some((r) => c in r.in)) {
      // export sink (port): counts toward growth
      ind.transported += n * 0.5;
      this.checkLevel(ind);
      return;
    }
    ind.inp[c] = Math.min((ind.inp[c] || 0) + n, this.capacity(ind) * 2);
    ind.transported += n * 0.5;
    this.checkLevel(ind);
  }

  linkedStations(ind) { return [...this.game.stations.list, ...(this.game.roads ? this.game.roads.stops : [])].filter((s) => s.links && s.links.industries.includes(ind.id)); }
  // Where each output could go: consumers (towns / industries) by distance,
  // with the connection state and an estimated income for a 10-unit load.
  //   served: both ends have a station on the same rail network
  //   station: the destination has a station, not yet connected
  //   none: no station at the destination yet
  opportunities(ind, max = 3) {
    const g = this.game, net = g.net;
    const comp = net.components();
    const mine = this.linkedStations(ind);
    const myComps = new Set(mine.map((s) => comp[s.tile]).filter((c) => c >= 0));
    const cx = ind.x + 1, cz = ind.z + 1;
    const out = [];
    for (const c of this.outputs(ind)) {
      const dests = [];
      for (const t of g.towns.list) if (TOWN_ACCEPTS.includes(c)) dests.push({ kind: 'town', id: t.id, name: t.name, x: t.x, z: t.z, region: t.region });
      for (const o of this.list) if (o !== ind && this.inputs(o).includes(c)) dests.push({ kind: 'industry', id: o.id, name: this.displayName(o), x: o.x + 1, z: o.z + 1, region: o.region });
      for (const d of dests) {
        d.dist = Math.max(Math.abs(d.x - cx), Math.abs(d.z - cz));
        const sts = g.stations.list.filter((s) => s.links && (d.kind === 'town' ? (s.links.towns || []).includes(d.id) : (s.links.industries || []).includes(d.id)));
        d.state = sts.some((s) => myComps.has(comp[s.tile])) ? 'served' : sts.length ? 'station' : 'none';
        d.value = Math.round(g.economy.revenue(c, 10, d.dist, null, false));
        d.locked = !g.progression.regionUnlocked(d.region);
      }
      dests.sort((a, b) => (a.locked - b.locked) || ((a.state === 'served' ? 0 : 1) - (b.state === 'served' ? 0 : 1)) || (b.value / (8 + b.dist) - a.value / (8 + a.dist)));
      out.push({ c, dests: dests.slice(0, max) });
    }
    return out;
  }
  // farms follow the seasons (the year averages to 1)
  seasonMul(type) {
    const g = this.game;
    if ((type !== 'FARM' && !(INDUSTRIES[type] || {}).seasonal) || !g.env || !g.settings.weather) return 1;
    return SEASON_FARM[g.env.season()] || 1;
  }
  transportShare(ind) { return ind.produced > 0 ? Math.min(1, ind.transported / ind.produced) : 0; }

  rate(ind) {
    const g = this.game, cfg = INDUSTRIES[ind.type], fx = g.progression.fx, ev = g.economy.eventFx;
    let r = cfg.rate * (1 + 0.5 * ind.level) * (1 + fx.industryProd);
    if (!cfg.primary) r *= 1 + fx.processing;
    if (ind.type === 'FARM') r *= 1 + (ev.farmProd || 0);
    if (ind.type === 'MINE' || ind.type === 'COAL_MINE') r *= 1 + (ev.mineProd || 0);
    if (ind.stake >= 0.5) r *= 1 + INDUSTRY_INVEST.ownerBonus;
    r *= this.seasonMul(ind.type);
    if (g.economy.cycleMul) r *= 1 + (g.economy.cycleMul() - 1) * 0.5;
    return r * g.difficulty.growthMul ** 0;
  }

  tick(dt) {
    const g = this.game;
    if (g.ledger) {
      const m = g.ledger.monthIndex();
      if (m !== this.month) { if (this.month >= 0 && m > this.month) this.closeMonth(); this.month = m; }
    }
    for (const ind of this.list) {
      if (!g.progression.regionUnlocked(ind.region)) continue;
      const cfg = INDUSTRIES[ind.type];
      const cap = this.capacity(ind);
      ind.cycles = Math.min(ind.cycles + (this.rate(ind) / 60) * dt, 4);
      let produced = false;
      while (ind.cycles >= 1) {
        ind.cycles -= 1;
        for (let ri = 0; ri < cfg.recipes.length; ri++) {
          const rc = cfg.recipes[ri];
          if (rc.every) { ind.every[ri] = (ind.every[ri] || 0) + 1; if (ind.every[ri] < rc.every) continue; ind.every[ri] = 0; }
          let ok = true;
          for (const c in rc.in) { const have = (ind.inp[c] || 0) + (c in rc.out ? 0 : (ind.out[c] || 0) * (c === 'GOODS' ? 1 : 0)); if (have < rc.in[c]) ok = false; }
          if (!ok) continue;
          let room = true;
          for (const c in rc.out) if ((ind.out[c] || 0) + rc.out[c] > cap) room = false;
          if (!room) continue;
          for (const c in rc.in) {
            let need = rc.in[c];
            const fromIn = Math.min(need, ind.inp[c] || 0);
            ind.inp[c] = (ind.inp[c] || 0) - fromIn; need -= fromIn;
            if (need > 0) ind.out[c] = Math.max(0, (ind.out[c] || 0) - need);
          }
          for (const c in rc.out) { ind.out[c] = (ind.out[c] || 0) + rc.out[c]; ind.produced += rc.out[c]; ind.pv = (ind.pv || 0) + rc.out[c] * (CARGO[c] ? CARGO[c].value : 0); }
          produced = true;
        }
      }
      ind.active = produced ? 1 : Math.max(0, (ind.active || 0) - dt * 0.2);
      // supply linked stations
      const sts = ind._sts || (ind._sts = this.linkedStations(ind));
      if (sts.length) {
        for (const c in ind.out) {
          let amt = Math.floor(ind.out[c]);
          if (amt < 1) continue;
          // competing stations share by cargo rating; a poorly served
          // station gets less (the rest stays at the industry)
          const sc = sts.some((s) => s.service) ? sts.filter((s) => g.stations.serves(s, c)) : sts;
          if (!sc.length) continue;
          const shares = g.ratings ? g.ratings.split(sc, c, amt) : sc.map(() => Math.ceil(amt / sc.length));
          for (let i = 0; i < sc.length; i++) {
            const want = Math.min(shares[i], Math.floor(ind.out[c]));
            if (want <= 0) continue;
            const took = g.stations.receive(sc[i], c, want);
            ind.out[c] -= took; ind.transported += took;
          }
        }
        this.checkLevel(ind);
      }
    }
  }

  onStationsChanged() { for (const ind of this.list) ind._sts = null; }

  checkLevel(ind) {
    if (ind.level >= 4) return;
    const thr = INDUSTRY_LEVEL_THRESH[ind.level] * (1 - this.game.progression.fx.industryGrowth);
    if (ind.transported >= thr) {
      ind.level++;
      this.buildVisual(ind);
      this.game.stats.max('maxIndustryLevel', ind.level);
      this.game.events.emit('industryLevel', ind);
    }
  }

  levelProgress(ind) {
    if (ind.level >= 4) return 1;
    const thr = INDUSTRY_LEVEL_THRESH[ind.level] * (1 - this.game.progression.fx.industryGrowth);
    const prev = ind.level ? INDUSTRY_LEVEL_THRESH[ind.level - 1] * (1 - this.game.progression.fx.industryGrowth) : 0;
    return Math.max(0, Math.min(1, (ind.transported - prev) / (thr - prev)));
  }


  // ---------- investment: stakes, dividends, expansion, new sites ----------
  // Everything is booked in the ledger with the industry as the object.
  baseValue(ind) { return (INDUSTRY_INVEST.base[ind.type] || 5000) * this.game.economy.costs.mul(); }
  // what the whole site is worth: its plant (by level) plus a year of margin
  value(ind) {
    const I = INDUSTRY_INVEST;
    return Math.round(this.baseValue(ind) * (1 + ind.level * 0.6) + (ind.lastPv || 0) * I.margin * 12);
  }
  stakeCost(ind) { return Math.round(this.value(ind) * INDUSTRY_INVEST.step); }
  stakeSale(ind) { return Math.round(this.value(ind) * INDUSTRY_INVEST.step * INDUSTRY_INVEST.sellBack); }
  stakeValue() { let v = 0; for (const ind of this.list) if (ind.stake > 0) v += ind.stake * this.value(ind) * INDUSTRY_INVEST.sellBack; return v; }
  owned() { return this.list.filter((i) => i.stake > 0); }
  dividendEstimate(ind, stake = ind.stake) { return Math.round(stake * INDUSTRY_INVEST.margin * (ind.lastPv || ind.pv || 0)); }

  buyStakeError(ind) {
    if (!ind) return 'err_no_target';
    if (!this.game.progression.regionUnlocked(ind.region)) return 'err_locked_region';
    if (ind.stake >= 1 - 1e-6) return 'err_stake_full';
    if (!this.game.economy.canAfford(this.stakeCost(ind))) return 'err_no_money';
    return null;
  }
  buyStake(ind) {
    const err = this.buyStakeError(ind);
    if (err) return { error: err };
    const cost = this.stakeCost(ind);
    this.game.economy.spend(cost, 'shares', { type: 'industry', id: ind.id }, '~inv_n_buy');
    ind.stake = Math.min(1, Math.round((ind.stake + INDUSTRY_INVEST.step) * 4) / 4);
    this.game.events.emit('industryStake', ind);
    return { ok: true, cost };
  }
  sellStake(ind) {
    if (!ind || !(ind.stake > 0)) return { error: 'err_no_stake' };
    const got = this.stakeSale(ind);
    this.game.economy.earn(got, 'share_sale', false, { type: 'industry', id: ind.id }, '~inv_n_sell');
    ind.stake = Math.max(0, Math.round((ind.stake - INDUSTRY_INVEST.step) * 4) / 4);
    this.game.events.emit('industryStake', ind);
    return { ok: true, got };
  }

  expandCost(ind) { return Math.round(this.baseValue(ind) * INDUSTRY_INVEST.expand * Math.pow(ind.level + 1, 1.4)); }
  expandError(ind) {
    if (!ind) return 'err_no_target';
    if (!this.game.progression.regionUnlocked(ind.region)) return 'err_locked_region';
    if (ind.level >= 4) return 'err_max_level';
    if (!this.game.economy.canAfford(this.expandCost(ind))) return 'err_no_money';
    return null;
  }
  // pay for the next level now (the delivered-cargo counter moves up with it,
  // so growth continues from there)
  expand(ind) {
    const err = this.expandError(ind);
    if (err) return { error: err };
    const cost = this.expandCost(ind);
    this.game.economy.spend(cost, 'industry_fund', { type: 'industry', id: ind.id }, '~inv_n_expand');
    ind.transported = Math.max(ind.transported, INDUSTRY_LEVEL_THRESH[ind.level] * (1 - this.game.progression.fx.industryGrowth));
    this.checkLevel(ind);
    return { ok: true, cost, level: ind.level };
  }

  // month end: book the dividends of the month that closed
  closeMonth() {
    const g = this.game;
    for (const ind of this.list) {
      ind.lastPv = Math.round(ind.pv || 0);
      ind.pv = 0;
      if (ind.stake > 0) {
        const d = this.dividendEstimate(ind);
        if (d > 0) g.economy.earn(d, 'dividend', false, { type: 'industry', id: ind.id }, '~inv_n_div');
      }
    }
  }

  // ---------- new sites ----------
  foundCost(type) { return Math.round((INDUSTRY_INVEST.base[type] || 5000) * INDUSTRY_INVEST.found * this.game.economy.costs.mul()); }
  foundTypes() {
    // the kinds of site the company can fund: any kind found in an open region
    const g = this.game, s = new Set();
    for (const i of this.list) if (g.progression.regionUnlocked(i.region)) s.add(i.type);
    return Object.keys(INDUSTRIES).filter((k) => s.has(k));
  }
  // nearest town and how far its edge is
  nearTown(x, z) {
    let best = null, bd = 1e9;
    for (const t of this.game.towns.list) {
      const d = Math.max(Math.abs(t.x - x - 0.5), Math.abs(t.z - z - 0.5)) - this.game.towns.radius(t);
      if (d < bd) { bd = d; best = t; }
    }
    return { town: best, gap: bd };
  }
  // the 2x2 site with its top-left corner at tile
  foundError(tile, type) {
    const g = this.game, W = g.world;
    if (tile < 0) return 'err_out_of_map';
    if (!INDUSTRIES[type]) return 'err_no_target';
    const x = tile % N, z = Math.floor(tile / N);
    if (x < 1 || z < 1 || x > N - 3 || z > N - 3) return 'err_out_of_map';
    const hs = [];
    for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) {
      const i = idx(x + dx, z + dz);
      const r = g.net.tileBlockedReason(i);
      if (r) return r;
      if (W.type[i] !== 0) return 'err_bad_terrain';
      if (g.net.conn[i] || g.net.special.has(i) || g.net.waypoints.has(i) || g.occupancy.owner[i]) return 'err_occupied';
      if (g.roads && g.roads.hasRoad(i)) return 'err_occupied';
      if (g.decor && g.decor.at(i)) return 'err_occupied';
      hs.push(W.tileH[i]);
    }
    if (Math.max(...hs) - Math.min(...hs) > 1.2) return 'err_too_steep';
    // not right next to another site
    for (const o of this.list) if (Math.abs(o.x - x) < 4 && Math.abs(o.z - z) < 4) return 'err_industry_near';
    if (type === 'PORT') {
      let w = 0;
      for (let dz = -2; dz <= 3; dz++) for (let dx = -2; dx <= 3; dx++) if (x + dx >= 0 && z + dz >= 0 && x + dx < N && z + dz < N && W.type[idx(x + dx, z + dz)] === 1) w++;
      if (w < 3) return 'err_port_water';
    }
    const near = this.nearTown(x, z);
    if (near.town && near.gap < INDUSTRY_INVEST.townGap && g.authority && !g.authority.allowed(near.town, 'industry_near_town')) return 'err_permit_denied';
    if (!g.economy.canAfford(this.foundCost(type))) return 'err_no_money';
    return null;
  }
  found(tile, type) {
    const err = this.foundError(tile, type);
    if (err) return { error: err };
    const g = this.game, x = tile % N, z = Math.floor(tile / N);
    const near = this.nearTown(x, z);
    const id = Math.max(1999, ...this.list.map((i) => i.id)) + 1;
    const ind = this.addSite({ id, type, x, z, region: g.world.region[tile], townName: near.town ? near.town.name : 'Frontier' });
    const cost = this.foundCost(type);
    g.economy.spend(cost, 'industry_fund', { type: 'industry', id }, '~inv_n_found');
    ind.stake = INDUSTRY_INVEST.foundStake;
    if (near.town && near.gap < INDUSTRY_INVEST.townGap && g.authority) g.authority.change(near.town, ind.type === 'FARM' || ind.type === 'FOREST' ? -1 : -4, 'auth_industry');
    g.stations.relinkAll();
    this.onStationsChanged();
    if (g.towns.onStationsChanged) g.towns.onStationsChanged();
    this.buildVisual(ind);
    g.events.emit('industryFounded', ind);
    return { ok: true, ind, cost };
  }
  addSite(site) {
    const ind = { id: site.id, type: site.type, x: site.x, z: site.z, region: site.region, townName: site.townName, site: { type: site.type, x: site.x, z: site.z, region: site.region, townName: site.townName },
      level: 0, inp: {}, out: {}, cycles: 0, every: {}, transported: 0, produced: 0, idle: 0, stake: 0, pv: 0, lastPv: 0 };
    this.list.push(ind);
    this.markFootprint(ind);
    const v = this.game.world.view;
    if (v && v.clearTreesMany) { const ts = []; for (let dz = -1; dz <= 2; dz++) for (let dx = -1; dx <= 2; dx++) { const xx = site.x + dx, zz = site.z + dz; if (xx >= 0 && zz >= 0 && xx < N && zz < N) ts.push(idx(xx, zz)); } v.clearTreesMany(ts); }
    return ind;
  }

  // ---------- visuals ----------
  baseHeight(ind) {
    const W = this.game.world;
    let h = 0;
    for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) h += W.tileH[idx(ind.x + dx, ind.z + dz)];
    return Math.max(h / 4, 0.2);
  }

  buildVisual(ind) {
    if (ind.obj) { this.group.remove(ind.obj); ind.obj.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
    const root = new THREE.Group();
    const mb = new ModelBuilder();
    const anims = [], emitters = [];
    const ctx = { mb, anims, emitters, level: ind.level, seed: ind.id, crops: null };
    // foundation slab
    mb.box(3.7, 0.5, 3.7, SLAB[ind.type] || 0x9a948a, { y: -0.42 });
    INDUSTRY_MODELS[ind.type](ctx);
    const mesh = meshFrom(mb.build());
    root.add(mesh);
    for (const a of anims) {
      const m = meshFrom(a.mb.build());
      m.position.set(a.x, a.y, a.z);
      if (a.ry) m.rotation.y = a.ry;
      root.add(m);
      a.mesh = m;
    }
    if (ctx.crops) {
      const cm = new THREE.Mesh(ctx.crops.build(), this.cropMat);
      cm.receiveShadow = true;
      root.add(cm);
    }
    const s = 0.92 + ind.level * 0.03;
    root.scale.setScalar(s);
    root.position.set((ind.x + 1) * TILE, this.baseHeight(ind), (ind.z + 1) * TILE);
    root.rotation.y = ((ind.id * 37) % 4) * (Math.PI / 2);
    root.userData.industry = ind.id;
    ind.obj = root; ind.anims = anims; ind.emitters = emitters;
    ind.rise = 1;
    this.group.add(root);
  }

  buildAllVisuals() { for (const ind of this.list) { this.buildVisual(ind); ind.rise = 0; } }

  updateVisuals(dt, time) {
    const g = this.game;
    // crops: green in spring, ripe gold in late summer and autumn, bare in winter
    const sn = g.env ? g.env.season() : 'summer';
    const tgt = { spring: [0.27, 0.55, 0.42], summer: [0.17, 0.6, 0.48], autumn: [0.11, 0.62, 0.5], winter: [0.08, 0.2, 0.45] }[sn];
    const hsl = this._cropHsl || (this._cropHsl = tgt.slice());
    for (let k = 0; k < 3; k++) hsl[k] += (tgt[k] - hsl[k]) * Math.min(1, dt * 0.5);
    this.cropMat.color.setHSL(hsl[0], hsl[1], hsl[2]);
    const v = new THREE.Vector3();
    for (const ind of this.list) {
      if (!ind.obj) continue;
      const on = g.progression.regionUnlocked(ind.region);
      const act = on ? 0.35 + 0.65 * (ind.active || 0) : 0;
      for (const a of ind.anims) {
        if (a.type === 'spin') a.mesh.rotation[a.axis || 'x'] += dt * a.speed * act;
        else if (a.type === 'nod') a.mesh.rotation.z = Math.sin(time * a.speed + a.phase) * 0.35 * act;
        else if (a.type === 'swing') a.mesh.rotation.y = (a.ry || 0) + Math.sin(time * a.speed + a.phase) * 0.8 * act;
      }
      if (ind.rise > 0) {
        ind.rise = Math.max(0, ind.rise - dt * 1.2);
        const k = 1 - ind.rise;
        ind.obj.scale.y = (0.92 + ind.level * 0.03) * (0.4 + 0.6 * (1 - Math.pow(1 - k, 3)));
      }
      if (on && g.particles && ind.emitters.length) {
        ind._e = (ind._e || 0) + dt * (0.4 + act);
        if (ind._e > 0.8) {
          ind._e = 0;
          for (const e of ind.emitters) {
            v.set(e.x, e.y, e.z);
            ind.obj.localToWorld(v);
            g.particles.emit(e.type, v.x, v.y, v.z, 1);
          }
        }
      }
    }
  }

  serialize() {
    return this.list.map((i) => {
      const o = { id: i.id, level: i.level, inp: i.inp, out: i.out, transported: i.transported, produced: i.produced };
      if (i.stake > 0) o.stake = i.stake;
      if (i.pv || i.lastPv) { o.pv = Math.round(i.pv || 0); o.lastPv = i.lastPv || 0; }
      if (i.fin) o.fin = i.fin;
      if (i.site) o.site = i.site;
      return o;
    });
  }
  deserialize(arr) {
    if (!Array.isArray(arr)) return;
    for (const d of arr) {
      let ind = this.byId(d.id);
      // a site the company funded: build it again where it was
      if (!ind && d && d.site && INDUSTRIES[d.site.type]) {
        const s = d.site, x = s.x | 0, z = s.z | 0;
        let free = x >= 0 && z >= 0 && x < N - 1 && z < N - 1;
        for (let dz = 0; dz < 2 && free; dz++) for (let dx = 0; dx < 2 && free; dx++) if (this.game.occupancy.blocked[idx(x + dx, z + dz)]) free = false;
        if (free) ind = this.addSite({ id: d.id, type: s.type, x, z, region: this.game.world.region[idx(x, z)], townName: typeof s.townName === 'string' ? s.townName.slice(0, 40) : 'Frontier' });
      }
      if (!ind) continue;
      ind.level = Math.max(0, Math.min(4, d.level | 0));
      ind.inp = sanitizeStore(d.inp); ind.out = sanitizeStore(d.out);
      ind.transported = +d.transported || 0; ind.produced = +d.produced || 0;
      const st = +d.stake;
      ind.stake = isFinite(st) && st > 0 ? Math.min(1, Math.round(st * 4) / 4) : 0;
      ind.pv = Math.max(0, +d.pv || 0); ind.lastPv = Math.max(0, +d.lastPv || 0);
      const f = cleanFin(d.fin);
      if (f) ind.fin = f;
    }
  }
}

function sanitizeStore(o) {
  const r = {};
  if (o && typeof o === 'object') for (const k in o) if (typeof o[k] === 'number' && isFinite(o[k]) && o[k] > 0) r[k] = o[k];
  return r;
}

// ---------- industry models (local frame centred on 2x2 footprint, ~3.6 units wide) ----------
const DARK = 0x3a3d42, METAL = 0x8c939a, CONC = 0xb8b2a6, RUST = 0x9a5a3a, GLASS = 0x3a4a5a;

function spinPart(ctx, x, y, z, build, speed, axis = 'x', ry = 0) {
  const mb = new ModelBuilder();
  build(mb);
  ctx.anims.push({ mb, x, y, z, type: 'spin', speed, axis, ry });
}

function logPile(mb, x, z, n, col = 0x8a5a33) {
  for (let r = 0; r < 2; r++) for (let k = 0; k < n - r; k++) mb.hcyl(0.09, 0.9, 7, shade(col, 1 - (k % 3) * 0.08), { x, y: 0.1 + r * 0.16, z: z - (n - 1) * 0.09 + k * 0.18 + r * 0.09 });
}

function shed(mb, x, z, w, d, h, wall, roof, ry = 0) {
  mb.box(w, h, d, wall, { x, z, ry });
  mb.roof(w + 0.08, h * 0.45, d + 0.1, roof, { x, y: h, z, ry });
}

function chimney(ctx, x, z, h, r, col = 0x8a4a3a, type = 'smoke') {
  ctx.mb.cyl(r * 0.8, r, h, 8, col, { x, z });
  ctx.mb.cyl(r * 0.9, r * 0.9, 0.08, 8, DARK, { x, y: h - 0.04, z });
  ctx.emitters.push({ x, y: h + 0.1, z, type });
}

// foundation colour: fields, forest floor, pits and yards
const SLAB = { FARM: 0x8a7a4a, FOREST: 0x6a5a3a, ORCHARD: 0x7a8a4a, LIVESTOCK_FARM: 0x8a8a4a, DAIRY_FARM: 0x7a9a5a, QUARRY: 0xa8a49a, SAND_PIT: 0xd8c490, CLAY_PIT: 0xa8704f, COPPER_MINE: 0x8a7a6a, FISHERY: 0xb8b2a6 };
// a variant per site (the same industry need not look the same everywhere)
const variantOf = (ctx) => ((ctx.seed * 2654435761) >>> 0) % 3;

// stepped pit with a digger and a conveyor (quarries, sand and clay pits)
function pitModel(ctx, col, pile) {
  const { mb, level } = ctx, V = variantOf(ctx);
  // benches stepping down into the pit: rims, highest outside
  const cx = -0.4, cz = -0.3;
  for (let k = 0; k < 3; k++) {
    const w = 2.3 - k * 0.6, d = 2.1 - k * 0.55, h = 0.34 - k * 0.1, t = 0.28, c2 = shade(col, 0.95 - k * 0.1);
    mb.box(w, h, t, c2, { x: cx, z: cz - d / 2 + t / 2 }); mb.box(w, h, t, c2, { x: cx, z: cz + d / 2 - t / 2 });
    mb.box(t, h, d, c2, { x: cx - w / 2 + t / 2, z: cz }); mb.box(t, h, d, c2, { x: cx + w / 2 - t / 2, z: cz });
  }
  mb.box(0.6, 0.02, 0.5, shade(col, 0.7), { x: cx, z: cz });
  // excavator on the pit floor
  mb.box(0.3, 0.06, 0.34, DARK, { x: -0.5, y: 0.02, z: -0.35 });
  mb.box(0.36, 0.18, 0.26, 0xd0a030, { x: -0.5, y: 0.08, z: -0.35 });
  mb.box(0.5, 0.05, 0.06, 0xd0a030, { x: -0.2, y: 0.24, z: -0.35, rz: -0.5 });
  // conveyor up to the heap
  mb.box(1.5, 0.05, 0.12, METAL, { x: 0.55, y: 0.3, z: 0.6, rz: 0.35 });
  for (let k = 0; k < 2 + Math.min(3, level); k++) mb.cone(0.36 - (k % 2) * 0.06, 0.4, 7, shade(pile, 1 - (k % 3) * 0.06), { x: 1.2 - (k % 3) * 0.5, z: 1.0 - Math.floor(k / 3) * 0.6 });
  if (V === 1) shed(mb, 1.1, -1.1, 0.8, 0.7, 0.5, 0x9aa3ac, 0x5a5a5a);
  else { mb.box(0.6, 0.5, 0.6, 0x7a7f86, { x: 1.1, z: -1.1 }); mb.cyl(0.18, 0.1, 0.5, 8, 0x7a7f86, { x: 1.1, y: 0.5, z: -1.1 }); }
  if (level >= 2) { mb.box(0.5, 0.26, 0.26, 0xd0a030, { x: 1.2, z: 0.0 }); mb.wheel(0.09, 0.06, 8, DARK, { x: 1.05, y: 0.09, z: 0.15 }); }
}
function barn(mb, x, z, w, d, h, wall, roof) { mb.box(w, h, d, wall, { x, z }); mb.roof(w + 0.1, h * 0.55, d + 0.1, roof, { x, y: h, z }); }
function fence(mb, x0, z0, x1, z1, col = 0x8a6a4a) {
  const n = Math.round(Math.hypot(x1 - x0, z1 - z0) / 0.3);
  for (let k = 0; k <= n; k++) mb.box(0.03, 0.16, 0.03, col, { x: x0 + (x1 - x0) * k / n, z: z0 + (z1 - z0) * k / n });
  const ry = -Math.atan2(z1 - z0, x1 - x0);
  mb.box(Math.hypot(x1 - x0, z1 - z0), 0.02, 0.02, col, { x: (x0 + x1) / 2, y: 0.12, z: (z0 + z1) / 2, ry });
}
function animal(mb, x, z, col, ry = 0) { mb.box(0.2, 0.1, 0.09, col, { x, y: 0.08, z, ry }); mb.box(0.06, 0.07, 0.06, shade(col, 0.8), { x: x + Math.cos(ry) * 0.12, y: 0.14, z: z - Math.sin(ry) * 0.12, ry }); for (const [dx, dz] of [[-0.07, -0.03], [0.07, -0.03], [-0.07, 0.03], [0.07, 0.03]]) mb.box(0.02, 0.08, 0.02, DARK, { x: x + dx, z: z + dz }); }
function tanks(mb, n, x0, z, r, h, col) { for (let k = 0; k < n; k++) { mb.cyl(r, r, h, 10, col, { x: x0 + k * (r * 2 + 0.08), z }); mb.cone(r * 1.02, r * 0.5, 10, shade(col, 0.8), { x: x0 + k * (r * 2 + 0.08), y: h, z }); } }

const INDUSTRY_MODELS = {
  FOREST(ctx) {
    const { mb, level } = ctx;
    shed(mb, -0.9, -0.9, 1.0, 0.8, 0.55, 0x8a5a3a, 0x4a3a2a);
    chimney(ctx, -0.6, -1.1, 1.0, 0.07, 0x5a5a5a);
    logPile(mb, 0.6, -0.8, 4);
    logPile(mb, 0.6, 0.4, 3 + Math.min(2, level));
    if (level >= 1) logPile(mb, -0.6, 0.8, 4);
    if (level >= 2) shed(mb, -0.8, 0.6, 0.8, 0.9, 0.5, 0x9a6a4a, 0x4a3a2a);
    // loader crane
    mb.box(0.1, 1.2, 0.1, 0xd0a030, { x: 1.2, z: 1.2 });
    spinPart(ctx, 1.2, 1.2, 1.2, (m) => { m.box(1.2, 0.07, 0.07, 0xd0a030, { x: -0.4 }); m.box(0.03, 0.3, 0.03, DARK, { x: -0.9, y: -0.3 }); }, 0.4, 'y');
    for (let k = 0; k < 4 + level; k++) mb.cyl(0.08, 0.1, 0.12, 6, 0x7a5a3a, { x: -1.5 + ((k * 7) % 5) * 0.2, z: 1.4 - k * 0.1 });
    if (level >= 3) { mb.box(1.1, 0.3, 0.6, 0x5a6a4a, { x: 0, z: 1.3 }); mb.box(0.4, 0.3, 0.55, 0x5a6a4a, { x: 0.55, y: 0.3, z: 1.3 }); }
  },
  FARM(ctx) {
    const { mb, level } = ctx;
    shed(mb, -0.8, -0.8, 1.2, 0.9, 0.7, 0xb04a3a, 0x5a3a2a);
    mb.box(0.3, 0.45, 0.02, 0xe8e0d0, { x: -0.8, z: -0.34 });
    const silos = 1 + Math.min(3, level);
    for (let k = 0; k < silos; k++) { mb.cyl(0.24, 0.24, 1.3, 10, 0xd8d2c4, { x: 0.2 + k * 0.52, z: -1.2 }); mb.cone(0.26, 0.3, 10, METAL, { x: 0.2 + k * 0.52, y: 1.3, z: -1.2 }); }
    shed(mb, 1.2, -0.2, 0.6, 0.6, 0.45, 0xf0ead8, 0x7a3f33);
    // windmill
    mb.cyl(0.08, 0.14, 1.5, 6, 0xe8e0d0, { x: -1.4, z: 0.4 });
    spinPart(ctx, -1.4, 1.45, 0.52, (m) => { for (let k = 0; k < 4; k++) m.box(0.06, 0.7, 0.02, 0xf4f0e6, { rz: (k * Math.PI) / 2, y: 0 }); }, 1.5, 'z');
    // crop rows
    const cr = new ModelBuilder();
    for (let r = 0; r < 6; r++) cr.box(2.4, 0.14 + (r % 2) * 0.03, 0.18, 0xffffff, { x: 0.35, z: 0.2 + r * 0.24 });
    if (level >= 2) for (let r = 0; r < 3; r++) cr.box(0.9, 0.14, 0.18, 0xffffff, { x: -1.2, z: 1.0 + r * 0.24 });
    ctx.crops = cr;
    mb.box(0.3, 0.2, 0.2, 0x3a6a3a, { x: 1.4, z: 1.5 });
    mb.wheel(0.1, 0.06, 8, DARK, { x: 1.3, y: 0.1, z: 1.62 });
  },
  MINE(ctx) { const V = variantOf(ctx); if (V === 2) aditModel(ctx, 0x8a6f63); else mineModel(ctx, 0x8a6f63, false); },
  COAL_MINE(ctx) { const V = variantOf(ctx); if (V === 1) pitModel(ctx, 0x4a4a4e, 0x2b2b30); else mineModel(ctx, 0x2b2b30, true); },
  OIL_FIELD(ctx) {
    const { mb, level } = ctx;
    const n = 1 + Math.min(3, level);
    const spots = [[-0.9, -0.9], [0.8, 0.8], [-0.9, 0.9], [0.8, -0.9]];
    for (let k = 0; k < n; k++) {
      const [x, z] = spots[k];
      mb.box(0.5, 0.1, 0.3, DARK, { x, z });
      mb.box(0.08, 0.7, 0.08, METAL, { x, y: 0.1, z: z - 0.1, rz: 0.2 });
      mb.box(0.08, 0.7, 0.08, METAL, { x, y: 0.1, z: z + 0.1, rz: 0.2 });
      const b = new ModelBuilder();
      b.box(1.0, 0.1, 0.1, 0x2a2a2e);
      b.box(0.16, 0.3, 0.14, 0xd0a030, { x: 0.5, y: -0.25 });
      b.box(0.2, 0.2, 0.18, DARK, { x: -0.5, y: -0.1 });
      ctx.anims.push({ mb: b, x, y: 0.82, z, type: 'nod', speed: 1.8, phase: k * 1.3 });
    }
    for (let k = 0; k < 1 + Math.floor(level / 2); k++) mb.cyl(0.35, 0.35, 0.6, 12, 0xd8dde2, { x: 1.1 - k * 0.8, z: -0.2 + (k % 2) * 0.5 });
    mb.box(2.2, 0.05, 0.08, METAL, { y: 0.2, z: 0.1 });
  },
  SAWMILL(ctx) {
    const { mb, level } = ctx;
    shed(mb, 0, -0.6, 2.4, 1.0, 0.7, 0xa0784a, 0x5a4a3a);
    chimney(ctx, 0.9, -1.0, 1.4, 0.09, 0x6a6a6a, 'steam');
    spinPart(ctx, -1.35, 0.5, 0.4, (m) => { m.cyl(0.3, 0.3, 0.03, 12, METAL, { rx: Math.PI / 2, center: true }); m.box(0.08, 0.08, 0.05, DARK); }, 5, 'z');
    mb.box(0.8, 0.2, 0.4, DARK, { x: -1.3, z: 0.4 });
    logPile(mb, 0.2, 0.6, 3);
    for (let k = 0; k < 3 + level; k++) mb.box(0.7, 0.07, 0.35, shade(0xd1a46b, 1 - (k % 3) * 0.06), { x: 1.1, y: k * 0.07, z: 0.9 });
    if (level >= 2) shed(mb, -0.9, 1.2, 1.0, 0.6, 0.5, 0xa0784a, 0x5a4a3a);
  },
  FOOD_PROC(ctx) {
    const { mb, level } = ctx;
    mb.box(2.2, 0.8, 1.2, 0xe8e2d4, { x: -0.3, z: -0.6 });
    mb.box(2.3, 0.08, 1.3, 0x7a8a9a, { x: -0.3, y: 0.8, z: -0.6 });
    for (let k = 0; k < 5; k++) mb.box(0.25, 0.2, 0.02, GLASS, { x: -1.1 + k * 0.4, y: 0.4, z: 0.01, glow: true });
    for (let k = 0; k < 2 + Math.min(2, level); k++) { mb.cyl(0.22, 0.22, 1.4, 10, METAL, { x: 1.3, z: -1.2 + k * 0.55 }); mb.cone(0.23, 0.2, 10, DARK, { x: 1.3, y: 1.4, z: -1.2 + k * 0.55 }); }
    chimney(ctx, -1.1, -1.0, 1.5, 0.08, 0xa0a0a0, 'steam');
    mb.box(0.6, 0.35, 0.3, 0xd9744f, { x: -0.5, z: 0.9 });
    mb.box(0.25, 0.25, 0.3, 0xe8e2d4, { x: -0.1, z: 0.9 });
  },
  STEEL_MILL(ctx) {
    const { mb, level } = ctx;
    mb.cyl(0.45, 0.6, 2.0, 10, RUST, { x: -0.7, z: -0.6 });
    mb.cyl(0.3, 0.45, 0.4, 10, DARK, { x: -0.7, y: 2.0, z: -0.6 });
    mb.box(0.5, 0.3, 0.5, 0xff8a3a, { x: -0.7, y: 0.1, z: -0.05, glow: true });
    mb.box(1.6, 1.0, 1.1, 0x6a6e74, { x: 0.8, z: -0.5 });
    mb.box(1.7, 0.08, 1.2, 0x4a4e54, { x: 0.8, y: 1.0, z: -0.5 });
    const n = 2 + Math.min(2, level);
    for (let k = 0; k < n; k++) chimney(ctx, 0.3 + k * 0.4, 0.8, 2.2 + (k % 2) * 0.3, 0.1, 0x7a4a3a);
    mb.box(2.4, 0.1, 0.1, METAL, { x: 0.2, y: 1.4, z: -0.05 });
    for (let k = 0; k < 3; k++) mb.box(0.6, 0.12, 0.2, 0x8fa3b3, { x: -1.0 + k * 0.1, y: k * 0.12, z: 1.2 });
    ctx.emitters.push({ x: -0.7, y: 2.5, z: -0.6, type: 'smoke' });
  },
  REFINERY(ctx) {
    const { mb, level } = ctx;
    for (let k = 0; k < 2 + Math.min(2, level); k++) { mb.cyl(0.16, 0.2, 1.8 + (k % 2) * 0.5, 10, 0xd8dde2, { x: -1.0 + k * 0.45, z: -0.9 }); mb.torus(0.2, 0.03, Math.PI * 2, DARK, { x: -1.0 + k * 0.45, y: 0.9, z: -0.9, rx: Math.PI / 2 }); }
    for (let k = 0; k < 2; k++) mb.sphere(0.42, 1, 0xe8e8e8, { x: 0.7, y: 0.45, z: -0.8 + k * 1.0 });
    mb.cyl(0.05, 0.06, 2.5, 6, METAL, { x: 1.4, z: 1.3 });
    mb.sphere(0.1, 0, 0xffa040, { x: 1.4, y: 2.55, z: 1.3, glow: true });
    ctx.emitters.push({ x: 1.4, y: 2.7, z: 1.3, type: 'smoke' });
    mb.box(2.6, 0.06, 0.06, METAL, { y: 0.5, z: 0.2 });
    mb.box(2.6, 0.06, 0.06, METAL, { y: 0.7, z: 0.3 });
    mb.box(1.0, 0.5, 0.7, 0x8a8f96, { x: -0.8, z: 1.0 });
  },
  FACTORY(ctx) {
    const { mb, level } = ctx;
    mb.box(2.8, 0.9, 1.6, 0xb07a5a, { z: -0.5 });
    for (let k = 0; k < 5; k++) mb.roof(0.56, 0.32, 1.6, k % 2 ? 0x5a6a7a : 0x4a5a6a, { x: -1.12 + k * 0.56, y: 0.9, z: -0.5 });
    for (let k = 0; k < 6; k++) mb.box(0.22, 0.28, 0.02, GLASS, { x: -1.2 + k * 0.48, y: 0.45, z: 0.31, glow: true });
    chimney(ctx, 1.2, -1.1, 1.9 + level * 0.15, 0.12, 0x8a4a3a);
    if (level >= 2) chimney(ctx, 0.6, -1.1, 1.6, 0.1, 0x8a4a3a);
    for (let k = 0; k < 2 + level; k++) mb.box(0.36, 0.32, 0.36, k % 2 ? 0x5aa6c8 : 0x6b7f5a, { x: -1.2 + k * 0.45, z: 1.1 });
  },
  DIST_CENTER(ctx) {
    const { mb, level } = ctx;
    mb.box(3.0, 0.8, 1.8, 0xd8d2c4, { z: -0.4 });
    mb.box(3.1, 0.1, 1.9, 0x5a6470, { y: 0.8, z: -0.4 });
    for (let k = 0; k < 6; k++) mb.box(0.34, 0.5, 0.02, 0x5a6470, { x: -1.25 + k * 0.5, z: 0.51 });
    const cols = [0xc94f4f, 0x3f6e9a, 0xe0a33a, 0x5aa66a];
    for (let k = 0; k < 3 + level; k++) mb.box(0.9, 0.3, 0.32, cols[k % 4], { x: -0.9 + (k % 3) * 0.95, y: Math.floor(k / 3) * 0.3, z: 1.2 });
    mb.box(0.7, 0.3, 0.3, 0xe8e2d4, { x: 1.0, z: 0.8 });
    mb.box(0.25, 0.25, 0.3, 0x3f6e9a, { x: 1.45, z: 0.8 });
  },
  PORT(ctx) {
    const { mb, level } = ctx;
    mb.box(3.6, 0.3, 1.0, CONC, { y: -0.1, z: 1.3 });
    mb.box(1.6, 0.8, 1.0, 0x9aa3ac, { x: -0.9, z: -0.8 });
    mb.box(1.7, 0.08, 1.1, 0x4a5a6a, { x: -0.9, y: 0.8, z: -0.8 });
    const cols = [0xc94f4f, 0x3f6e9a, 0xe0a33a, 0x5aa66a, 0x8a5ab0];
    for (let k = 0; k < 4 + level * 2; k++) mb.box(0.8, 0.3, 0.3, cols[k % 5], { x: 0.6 + (k % 2) * 0.85 - 0.4, y: Math.floor(k / 4) * 0.3, z: -1.3 + (Math.floor(k / 2) % 2) * 0.35 });
    mb.box(0.12, 1.6, 0.12, 0xd0a030, { x: 1.0, z: 1.3 });
    spinPart(ctx, 1.0, 1.6, 1.3, (m) => { m.box(1.8, 0.1, 0.1, 0xd0a030, { x: 0.3 }); m.box(0.25, 0.25, 0.25, DARK, { x: -0.5 }); m.box(0.02, 0.5, 0.02, DARK, { x: 1.0, y: -0.25 }); }, 0.3, 'y');
    if (level >= 2) { mb.cyl(0.18, 0.22, 1.8, 8, 0xf0f0f0, { x: -1.5, z: 1.5 }); mb.cyl(0.19, 0.19, 0.3, 8, 0xc94f4f, { x: -1.5, y: 1.2, z: 1.5 }); mb.sphere(0.12, 0, 0xfff2c0, { x: -1.5, y: 1.9, z: 1.5, glow: true }); }
  },
  // ---------- primary ----------
  QUARRY(ctx) { pitModel(ctx, 0xa8a49a, 0x9a9a94); if (variantOf(ctx) === 2) { ctx.mb.box(0.9, 1.0, 0.5, 0x8a8a84, { x: -1.3, z: 1.3 }); ctx.mb.box(0.5, 0.7, 0.4, 0x9a9a94, { x: -0.6, z: 1.45 }); } },
  SAND_PIT(ctx) { pitModel(ctx, 0xd8c490, 0xe0cc92); },
  CLAY_PIT(ctx) { pitModel(ctx, 0xa8704f, 0xb86a4a); ctx.mb.cyl(0.4, 0.4, 0.04, 12, 0x5a8ab0, { x: -1.3, y: 0.02, z: 1.2 }); },
  COPPER_MINE(ctx) { const V = variantOf(ctx); if (V === 0) pitModel(ctx, 0x8a7a6a, 0xc8743a); else if (V === 1) mineModel(ctx, 0xc8743a, false); else aditModel(ctx, 0xc8743a); },
  ORCHARD(ctx) {
    const { mb, level } = ctx;
    barn(mb, -1.1, -1.1, 0.9, 0.7, 0.55, 0xe8d8b8, 0x9a4a3a);
    const cr = new ModelBuilder();
    const rows = 3 + Math.min(2, level), V = variantOf(ctx);
    for (let r = 0; r < rows; r++) for (let k = 0; k < 5; k++) {
      const x = -0.8 + k * 0.5 + (r % 2) * 0.12, z = -0.2 + r * 0.42;
      mb.cyl(0.03, 0.04, 0.24, 5, 0x6b4a33, { x, z });
      cr.sphere(0.18, 0, 0xffffff, { x, y: 0.34, z, sy: 0.85 });
      if ((k + r + V) % 2) mb.sphere(0.04, 0, V === 1 ? 0xd8483a : 0xe8a03a, { x: x + 0.1, y: 0.3, z: z + 0.06 });
    }
    ctx.crops = cr;
    for (let k = 0; k < 2 + level; k++) mb.box(0.22, 0.16, 0.18, 0xa07a4a, { x: 0.9 + (k % 3) * 0.25, z: -1.2 + Math.floor(k / 3) * 0.22 });
  },
  LIVESTOCK_FARM(ctx) {
    const { mb, level } = ctx, V = variantOf(ctx);
    barn(mb, -0.9, -0.9, 1.3, 0.9, 0.7, V === 1 ? 0x8a3a2a : 0xb04a3a, 0x4a3a2a);
    mb.box(0.4, 0.4, 0.02, 0xe8e0d0, { x: -0.9, z: -0.44 });
    mb.cyl(0.2, 0.2, 1.2, 10, 0xd8d2c4, { x: 0.4, z: -1.2 });
    fence(mb, -1.4, 0.1, 1.5, 0.1); fence(mb, -1.4, 1.5, 1.5, 1.5); fence(mb, -1.4, 0.1, -1.4, 1.5); fence(mb, 1.5, 0.1, 1.5, 1.5);
    const col = V === 2 ? 0xe8e4dc : 0x7a4a2a;
    for (let k = 0; k < 4 + level * 2; k++) animal(mb, -1.1 + ((k * 37) % 25) / 10, 0.35 + ((k * 13) % 11) / 10, k % 3 ? col : 0x2a2a2a, (k * 1.7) % 6);
    mb.box(0.5, 0.12, 0.2, 0x9a7a4a, { x: 1.1, z: -0.3 });
  },
  DAIRY_FARM(ctx) {
    const { mb, level } = ctx;
    barn(mb, -0.8, -1.0, 1.4, 0.8, 0.6, 0xe8e4dc, 0x3f6e9a);
    tanks(mb, 1 + Math.min(2, level), 0.6, -1.2, 0.2, 0.7, 0xdfe6ea);
    fence(mb, -1.5, 0.0, 1.5, 0.0, 0xe8e4dc); fence(mb, -1.5, 1.5, 1.5, 1.5, 0xe8e4dc);
    for (let k = 0; k < 4 + level * 2; k++) animal(mb, -1.2 + ((k * 29) % 26) / 10, 0.3 + ((k * 7) % 11) / 10, k % 2 ? 0xf4f0e8 : 0x2a2a2a, (k * 2.1) % 6);
    mb.box(0.5, 0.2, 0.3, 0xdfe6ea, { x: 1.2, z: -0.3 });
  },
  FISHERY(ctx) {
    const { mb, level } = ctx;
    mb.box(3.6, 0.2, 0.9, 0x8a6a4a, { y: -0.12, z: 1.35 });
    for (let k = 0; k < 6; k++) mb.cyl(0.05, 0.05, 0.5, 6, 0x5a4a3a, { x: -1.6 + k * 0.64, y: -0.5, z: 1.75 });
    barn(mb, -0.7, -0.6, 1.6, 1.0, 0.6, 0xdfe8f0, 0x3f6e9a);
    mb.box(0.8, 0.3, 0.4, 0x6a9ab8, { x: 1.1, z: -0.9 });
    // a fishing boat at the quay
    mb.box(0.9, 0.2, 0.32, 0xc94f4f, { x: 0.6, y: -0.15, z: 1.95 });
    mb.box(0.3, 0.22, 0.24, 0xf4f4f0, { x: 0.45, y: 0.05, z: 1.95 });
    mb.box(0.03, 0.6, 0.03, DARK, { x: 0.85, y: 0.05, z: 1.95 });
    for (let k = 0; k < 2 + level; k++) mb.box(0.24, 0.14, 0.2, 0x5a8ab0, { x: -1.4 + k * 0.3, z: 0.5 });
  },
  // ---------- processing ----------
  CEMENT_WORKS(ctx) {
    const { mb, level } = ctx;
    mb.box(1.2, 1.4, 0.9, 0xc8c4bc, { x: -0.9, z: -0.8 });
    mb.box(0.9, 0.9, 0.7, 0xb8b4ac, { x: -0.9, y: 1.4, z: -0.8 });
    mb.hcyl(0.22, 2.0, 12, 0x9a948a, { x: 0.5, y: 0.5, z: -0.5, rz: 0.12 });   // kiln
    for (const x of [-0.3, 1.3]) mb.box(0.18, 0.5, 0.3, 0x7a7f86, { x, z: -0.5 });
    tanks(mb, 2 + Math.min(2, level), 0.1, 0.9, 0.24, 1.3, 0xdcdad4);
    chimney(ctx, -1.3, -1.3, 2.4, 0.12, 0xb8b4ac, 'steam');
    for (let k = 0; k < 2 + level; k++) mb.box(0.3, 0.2, 0.3, 0xc88a5a, { x: 1.2, y: (k % 2) * 0.2, z: 0.5 + Math.floor(k / 2) * 0.35 });
  },
  BRICKWORKS(ctx) {
    const { mb, level } = ctx;
    shed(mb, -0.2, -0.7, 2.4, 1.1, 0.6, 0xa8583a, 0x4a3a32);
    chimney(ctx, 1.2, -1.2, 2.2 + level * 0.1, 0.14, 0xa8583a);
    if (level >= 2) chimney(ctx, -1.2, -1.2, 1.8, 0.1, 0xa8583a);
    for (let k = 0; k < 4 + level * 2; k++) mb.box(0.36, 0.18, 0.28, shade(0xb86a4a, 1 - (k % 3) * 0.06), { x: -1.2 + (k % 5) * 0.55, y: Math.floor(k / 5) * 0.18, z: 0.9 });
  },
  CHEM_PLANT(ctx) {
    const { mb, level } = ctx;
    for (let k = 0; k < 2 + Math.min(2, level); k++) mb.cyl(0.14, 0.18, 1.6 + (k % 2) * 0.4, 10, 0xe8ecef, { x: -1.1 + k * 0.4, z: -1.0 });
    for (let k = 0; k < 2; k++) mb.sphere(0.36, 1, 0xdfe8d8, { x: 0.8, y: 0.38, z: -0.9 + k * 0.85 });
    mb.box(1.0, 0.6, 0.7, 0x9aa3ac, { x: -0.7, z: 0.6 });
    for (let k = 0; k < 3; k++) mb.box(2.6, 0.05, 0.05, k === 1 ? 0x7ab84a : METAL, { y: 0.45 + k * 0.15, z: 0.05 + k * 0.08 });
    mb.cyl(0.05, 0.06, 2.2, 6, METAL, { x: 1.4, z: 1.2 });
    mb.sphere(0.09, 0, 0xffa040, { x: 1.4, y: 2.25, z: 1.2, glow: true });
    ctx.emitters.push({ x: -0.7, y: 2.1, z: -1.0, type: 'steam' });
  },
  PAPER_MILL(ctx) {
    const { mb, level } = ctx;
    mb.box(2.4, 0.8, 1.1, 0xd8d2c4, { x: -0.2, z: -0.7 });
    mb.box(2.5, 0.08, 1.2, 0x5a6470, { x: -0.2, y: 0.8, z: -0.7 });
    chimney(ctx, 1.1, -1.2, 1.9, 0.1, 0xc8c4bc, 'steam');
    chimney(ctx, 0.7, -1.2, 1.6, 0.08, 0xc8c4bc, 'steam');
    logPile(mb, -1.0, 0.8, 3);
    for (let k = 0; k < 3 + level; k++) mb.hcyl(0.14, 0.5, 10, 0xe8e4d6, { x: 0.4 + (k % 3) * 0.36, y: 0.14 + Math.floor(k / 3) * 0.28, z: 0.9, rz: 0 });
  },
  DAIRY(ctx) {
    const { mb, level } = ctx;
    mb.box(2.0, 0.7, 1.1, 0xf0f0ea, { x: -0.4, z: -0.6 });
    mb.box(2.1, 0.08, 1.2, 0x3f6e9a, { x: -0.4, y: 0.7, z: -0.6 });
    for (let k = 0; k < 4; k++) mb.box(0.3, 0.2, 0.02, GLASS, { x: -1.1 + k * 0.45, y: 0.35, z: -0.04, glow: true });
    tanks(mb, 2 + Math.min(2, level), 0.9, -1.1, 0.2, 1.2, 0xdfe6ea);
    mb.box(0.8, 0.3, 0.4, 0xf2f2ea, { x: -0.6, z: 0.9 });
    mb.box(0.3, 0.26, 0.4, 0x3f6e9a, { x: -0.1, z: 0.9 });
  },
  AUTO_PLANT(ctx) {
    const { mb, level } = ctx;
    mb.box(3.0, 0.9, 1.6, 0xdfe2e6, { z: -0.6 });
    for (let k = 0; k < 5; k++) mb.roof(0.6, 0.28, 1.6, k % 2 ? 0x5a6470 : 0x4a5058, { x: -1.2 + k * 0.6, y: 0.9, z: -0.6 });
    for (let k = 0; k < 6; k++) mb.box(0.3, 0.22, 0.02, GLASS, { x: -1.2 + k * 0.48, y: 0.5, z: 0.21, glow: true });
    mb.box(0.8, 0.12, 0.05, 0xc0392b, { x: 0.9, y: 0.75, z: 0.22, glow: true });
    mb.box(0.8, 0.5, 0.5, 0xc8ccd0, { x: -1.1, z: 0.55 });   // paint shop
    chimney(ctx, -1.35, 0.55, 1.2, 0.07, 0xb8bcc2, 'steam');
    // finished cars in the yard
    const cols = [0xc0392b, 0x2f6fa8, 0xe8e8ec, 0x2a2a2e, 0x3a8a5a];
    for (let k = 0; k < 4 + level * 2; k++) { const x = -1.3 + (k % 6) * 0.5, z = 0.7 + Math.floor(k / 6) * 0.4; mb.box(0.36, 0.1, 0.18, cols[k % 5], { x, z }); mb.box(0.18, 0.08, 0.16, shade(cols[k % 5], 0.8), { x: x - 0.02, y: 0.1, z }); }
  },
  ELECTRONICS_PLANT(ctx) {
    const { mb, level } = ctx;
    mb.box(2.6, 0.7, 1.4, 0xf0f2f4, { z: -0.5 });
    mb.box(2.6, 0.26, 0.02, GLASS, { y: 0.3, z: 0.21, glow: true });
    for (let k = 0; k < 3 + level; k++) mb.box(0.3, 0.14, 0.3, 0x7a8088, { x: -1.0 + k * 0.45, y: 0.7, z: -0.8 });   // cooling units
    mb.box(0.9, 1.3, 0.8, 0xe6ebee, { x: 1.2, z: 0.8 });
    mb.box(0.92, 0.2, 0.82, 0x2fb8a8, { x: 1.2, y: 1.1, z: 0.8, glow: true });
    for (let k = 0; k < 2 + level; k++) mb.box(0.3, 0.2, 0.26, 0x2fb8a8, { x: -1.2 + k * 0.35, z: 1.2 });
  },
  // ---------- energy ----------
  POWER_PLANT(ctx) {
    const { mb, level } = ctx;
    for (const x of [-0.8, 0.4].slice(0, 1 + (level >= 1 ? 1 : 0))) { mb.cyl(0.5, 0.62, 1.8, 14, 0xd8d4cc, { x, z: -0.8 }); mb.cyl(0.46, 0.5, 0.3, 14, 0xc8c4bc, { x, y: 1.8, z: -0.8 }); ctx.emitters.push({ x, y: 2.2, z: -0.8, type: 'steam' }); }
    mb.box(1.4, 0.9, 0.9, 0x8a8f96, { x: 0.5, z: 0.6 });
    chimney(ctx, 1.3, 1.2, 2.8, 0.12, 0xb8b4ac);
    for (let k = 0; k < 2 + level; k++) mb.cone(0.35, 0.3, 7, 0x2b2b30, { x: -1.2 + k * 0.45, z: 1.3 });
  },
  GAS_PLANT(ctx) {
    const { mb, level } = ctx;
    mb.box(1.8, 0.9, 1.0, 0xdfe2e6, { x: -0.4, z: -0.7 });
    for (let k = 0; k < 1 + Math.min(2, level); k++) chimney(ctx, 0.9 + k * 0.35, -1.1, 2.0, 0.1, 0xc8c4bc, 'steam');
    tanks(mb, 2, -1.2, 0.9, 0.28, 0.5, 0xe8e8e8);
    for (let k = 0; k < 4; k++) mb.box(0.04, 0.8, 0.04, METAL, { x: 0.6 + (k % 2) * 0.5, z: 0.6 + Math.floor(k / 2) * 0.5 });
    mb.box(0.6, 0.04, 0.6, METAL, { x: 0.85, y: 0.8, z: 0.85 });
  },
  // ---------- advanced ----------
  DATA_CENTER(ctx) {
    const { mb, level } = ctx;
    mb.box(2.6, 0.7, 1.6, 0x4a5058, { z: -0.4 });
    for (let k = 0; k < 5; k++) mb.box(0.36, 0.1, 0.02, 0x2fb8a8, { x: -1.0 + k * 0.5, y: 0.35, z: 0.41, glow: true });
    for (let k = 0; k < 4 + level; k++) mb.box(0.34, 0.2, 0.34, 0x8a8f96, { x: -1.1 + (k % 5) * 0.55, y: 0.7, z: -0.8 + Math.floor(k / 5) * 0.5 });
    for (let k = 0; k < 2; k++) mb.box(0.5, 0.4, 0.4, 0xdfe2e6, { x: -0.8 + k * 0.7, z: 1.1 });
    mb.box(0.03, 1.4, 0.03, METAL, { x: 1.3, z: 1.2 });
    mb.sphere(0.05, 0, 0xff5040, { x: 1.3, y: 1.45, z: 1.2, glow: true });
  },
  WIND_FACTORY(ctx) {
    const { mb, level } = ctx;
    mb.box(3.0, 1.0, 1.4, 0xdfe6ea, { z: -0.6 });
    mb.box(3.1, 0.08, 1.5, 0x3f6e9a, { y: 1.0, z: -0.6 });
    // finished blades and a tower section in the yard
    for (let k = 0; k < 2 + level; k++) mb.box(1.6, 0.04, 0.14, 0xf4f4f0, { x: -0.4, y: 0.05 + k * 0.05, z: 0.7 + k * 0.05 });
    mb.hcyl(0.16, 1.2, 10, 0xe8ecef, { x: 0.8, y: 0.16, z: 1.2 });
    mb.cyl(0.04, 0.06, 1.8, 6, 0xf4f4f0, { x: 1.4, z: -1.4 });
    spinPart(ctx, 1.4, 1.8, -1.32, (m) => { for (let k = 0; k < 3; k++) m.box(0.05, 0.7, 0.02, 0xf4f4f0, { rz: (k * 2 * Math.PI) / 3, y: 0 }); }, 1.2, 'z');
  },
};

// a mine in the hillside: tunnel portal, rails out to a tipple
function aditModel(ctx, pileCol) {
  const { mb, level } = ctx;
  mb.box(1.8, 1.1, 1.2, 0x7a7068, { x: -0.8, z: -1.0 });
  mb.box(0.6, 0.6, 0.1, DARK, { x: -0.8, y: 0, z: -0.39 });
  mb.box(0.7, 0.1, 0.14, 0x8a5a3a, { x: -0.8, y: 0.6, z: -0.38 });
  for (const x of [-1.1, -0.5]) mb.box(0.1, 0.6, 0.14, 0x8a5a3a, { x, z: -0.38 });
  mb.box(0.1, 0.03, 1.8, METAL, { x: -0.9, z: 0.5 }); mb.box(0.1, 0.03, 1.8, METAL, { x: -0.7, z: 0.5 });
  for (let k = 0; k < 2 + Math.min(2, level); k++) mb.box(0.3, 0.18, 0.2, 0x5a5048, { x: -0.8, y: 0.03, z: 0.1 + k * 0.4 });
  mb.box(0.9, 0.9, 0.7, 0x8a5a3a, { x: 0.9, z: 0.4 });
  mb.roof(1.0, 0.3, 0.8, 0x5a4a42, { x: 0.9, y: 0.9, z: 0.4 });
  for (let k = 0; k < 2 + level; k++) mb.cone(0.3, 0.34, 7, shade(pileCol, 1 - (k % 3) * 0.07), { x: 1.1 - (k % 2) * 0.5, z: -0.9 + Math.floor(k / 2) * 0.45 });
}

function mineModel(ctx, pileCol, coal) {
  const { mb, level } = ctx;
  // headframe
  const hx = -0.8, hz = -0.6;
  for (const [dx, dz] of [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]) mb.box(0.07, 1.8, 0.07, 0x7a4a3a, { x: hx + dx, z: hz + dz });
  mb.box(0.6, 0.06, 0.6, 0x7a4a3a, { x: hx, y: 1.2, z: hz });
  mb.box(0.07, 1.9, 0.07, 0x7a4a3a, { x: hx + 0.7, z: hz, rz: 0.38 });
  spinPart(ctx, hx, 1.85, hz, (m) => { m.torus(0.28, 0.04, Math.PI * 2, DARK, {}); m.box(0.5, 0.04, 0.04, DARK); m.box(0.04, 0.5, 0.04, DARK); }, 2.2, 'z');
  shed(mb, 0.6, -0.9, 1.2, 0.8, 0.6, 0x8a8f96, 0x5a4a42);
  // piles
  const piles = 1 + Math.min(3, level);
  for (let k = 0; k < piles; k++) mb.cone(0.45, 0.5, 7, shade(pileCol, 1 - k * 0.05), { x: -1.0 + k * 0.7, z: 1.0 });
  mb.box(1.4, 0.06, 0.2, DARK, { x: 0.3, y: 0.6, z: 0.3, rz: -0.35 });
  if (coal) chimney(ctx, 1.3, 0.3, 1.5, 0.09, 0x6a6a6a);
  // cart
  mb.box(0.3, 0.2, 0.2, 0x6a5040, { x: 0.9, z: 1.3 });
  if (level >= 3) shed(mb, 1.2, 1.0, 0.7, 0.8, 0.5, 0x8a8f96, 0x5a4a42);
}

export { N, cheb, MATS };
