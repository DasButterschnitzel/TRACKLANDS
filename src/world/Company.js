// The company's identity: its name, its colour (road vehicles, the HQ, the
// company badge) and its headquarters. The HQ is a 2x2 building placed on
// free land; the town it stands in likes having it (+8 relationship once,
// and a little every month while it stands), and it counts towards company
// value. It can be moved (the old one is sold for half).
import { N, TILE, idx, cheb } from '../util.js';
import { ModelBuilder, meshFrom } from '../core/ModelBuilder.js';
import { heightAt } from './WorldGen.js';

export const COMPANY_COLORS = [0x2f6b4a, 0x2f5e9a, 0x9a2f3a, 0xc9793a, 0x6a4a9a, 0x2f8a8a, 0x3a3d42, 0xd0a030];
export const HQ_COST = 3000;

export class Company {
  constructor(game) {
    this.game = game;
    this.name = 'Tracklands Rail Co.';
    this.color = COMPANY_COLORS[0];
    this.hq = null;          // { tile, town, built }
    this.month = -1;
    this.mesh = null;
  }

  hqCost() { return Math.round(HQ_COST * this.game.economy.costs.mul()); }
  hqTiles(tile) { const x = tile % N, z = Math.floor(tile / N); return [idx(x, z), idx(x + 1, z), idx(x, z + 1), idx(x + 1, z + 1)]; }
  hqError(tile) {
    const g = this.game, W = g.world;
    if (tile < 0) return 'err_out_of_map';
    const x = tile % N, z = Math.floor(tile / N);
    if (x > N - 2 || z > N - 2) return 'err_out_of_map';
    const hs = [];
    for (const t of this.hqTiles(tile)) {
      const r = g.net.tileBlockedReason(t);
      if (r) return r;
      if (W.type[t] !== 0) return 'err_bad_terrain';
      if (g.net.conn[t] || g.net.special.has(t) || g.occupancy.owner[t] || (g.roads && g.roads.hasRoad(t)) || (g.decor && g.decor.at(t))) return 'err_occupied';
      hs.push(W.tileH[t]);
    }
    if (Math.max(...hs) - Math.min(...hs) > 1) return 'err_too_steep';
    if (!g.economy.canAfford(this.hqCost())) return 'err_no_money';
    return null;
  }
  nearestTown(tile) {
    let best = null, bd = 1e9;
    for (const t of this.game.towns.list) { const d = cheb(idx(t.x, t.z), tile); if (d < bd) { bd = d; best = t; } }
    return best && bd <= this.game.towns.radius(best) + 4 ? best : null;
  }
  buildHQ(tile) {
    const g = this.game;
    const err = this.hqError(tile);
    if (err) return { error: err };
    if (this.hq) this.removeHQ(true);
    const cost = this.hqCost();
    g.economy.spend(cost, 'construction', { type: 'tile', id: tile }, '~fin_n_hq');
    const town = this.nearestTown(tile);
    this.hq = { tile, town: town ? town.id : null, built: g.time };
    this.claim(true);
    if (town && g.authority) g.authority.change(town, 8, 'auth_hq');
    this.buildVisual();
    g.events.emit('hqBuilt', this.hq);
    return { ok: true, cost, town };
  }
  removeHQ(sell = true) {
    if (!this.hq) return;
    this.claim(false);
    if (sell) this.game.economy.earn(Math.round(this.hqCost() * 0.5), 'sale', false, null, '~fin_n_hq');
    this.hq = null;
    this.buildVisual();
  }
  claim(on) {
    const occ = this.game.occupancy;
    for (const t of this.hqTiles(this.hq.tile)) { occ.blocked[t] = on ? 3 : 0; occ.owner[t] = on ? -9999 : 0; }
    if (on && this.game.world.view) this.game.world.view.clearTreesMany(this.hqTiles(this.hq.tile));
  }
  value() { return this.hq ? this.hqCost() * 0.5 : 0; }

  tick() {
    const g = this.game;
    if (!g.ledger) return;
    const m = g.ledger.monthIndex();
    if (m === this.month) return;
    const first = this.month < 0;
    this.month = m;
    if (first || !this.hq || this.hq.town == null) return;
    const t = g.towns.byId(this.hq.town);
    if (t && g.authority && g.authority.rating(t) < 90) g.authority.change(t, 0.5, 'auth_hq_month');
  }

  buildVisual() {
    const g = this.game;
    if (this.mesh) { g.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh = null; }
    if (!this.hq) return;
    const mb = new ModelBuilder(), c = this.color;
    mb.box(3.4, 0.2, 3.4, 0x9a948a, { y: -0.1 });
    mb.box(2.2, 2.6, 1.6, 0xe8e2d4, { z: -0.4 });
    mb.box(2.3, 0.12, 1.7, c, { y: 2.6, z: -0.4 });
    for (let k = 0; k < 4; k++) for (let r = 0; r < 3; r++) mb.box(0.3, 0.36, 0.02, 0x3a4a5a, { x: -0.75 + k * 0.5, y: 0.5 + r * 0.7, z: 0.41, glow: true });
    mb.box(0.7, 0.6, 0.04, c, { y: 0, z: 0.42 });
    mb.box(1.2, 1.6, 1.0, 0xd8d2c4, { x: 0.9, z: 0.9 });
    mb.box(1.25, 0.1, 1.05, c, { x: 0.9, y: 1.6, z: 0.9 });
    mb.cyl(0.03, 0.03, 1.2, 5, 0x3a3d42, { x: -0.9, y: 2.7, z: -0.9 });
    mb.box(0.5, 0.3, 0.02, c, { x: -0.65, y: 3.6, z: -0.9 });
    mb.box(0.8, 0.02, 0.8, 0x6aa852, { x: -0.9, z: 0.9 });
    const mesh = meshFrom(mb.build());
    const x = (this.hq.tile % N + 1) * TILE, z = (Math.floor(this.hq.tile / N) + 1) * TILE;
    mesh.position.set(x, heightAt(g.world, x, z) + 0.05, z);
    mesh.userData.hq = true;
    this.mesh = mesh;
    g.scene.add(mesh);
  }

  serialize() { return { name: this.name, color: this.color, hq: this.hq }; }
  deserialize(d) {
    if (!d || typeof d !== 'object') return;
    if (typeof d.name === 'string' && d.name.trim()) this.name = d.name.trim().slice(0, 32);
    if (COMPANY_COLORS.includes(d.color)) this.color = d.color;
    if (d.hq && Number.isInteger(d.hq.tile) && d.hq.tile >= 0 && d.hq.tile < N * N) {
      this.hq = { tile: d.hq.tile, town: Number.isInteger(d.hq.town) ? d.hq.town : null, built: +d.hq.built || 0 };
      this.claim(true);
    }
  }
}
