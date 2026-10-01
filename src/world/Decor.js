// Player placed landscape decorations (cosmetic only).
import * as THREE from 'three';
import { N, TILE, tx, tz } from '../util.js';
import { DECORATIONS } from '../config.js';
import { ModelBuilder, MATS } from '../core/ModelBuilder.js';

const MODELS = {
  oak: (mb) => { mb.cyl(0.07, 0.1, 0.5, 5, 0x7a5a3a); mb.sphere(0.45, 0, 0x5e9a48, { y: 0.8, sy: 0.9 }); mb.sphere(0.3, 0, 0x6aa852, { y: 1.1, x: 0.12 }); },
  pine: (mb) => { mb.cyl(0.06, 0.08, 0.35, 5, 0x6a4a33); mb.cone(0.42, 0.8, 6, 0x2f6a44, { y: 0.3 }); mb.cone(0.3, 0.6, 6, 0x3a7a4e, { y: 0.75 }); },
  flowers: (mb) => {
    const cols = [0xe05a6a, 0xf0c040, 0xb070d0, 0xf4f0e6, 0xe08a3a];
    mb.box(1.5, 0.06, 1.5, 0x5a8a3a, { y: 0 });
    for (let k = 0; k < 24; k++) mb.sphere(0.07, 0, cols[k % 5], { x: -0.6 + (k % 6) * 0.24, y: 0.12, z: -0.6 + Math.floor(k / 6) * 0.4 + (k % 2) * 0.1 });
  },
  bench: (mb) => { mb.box(0.7, 0.05, 0.22, 0x8a5a3a, { y: 0.22 }); mb.box(0.7, 0.2, 0.04, 0x8a5a3a, { y: 0.3, z: -0.1 }); for (const x of [-0.3, 0.3]) mb.box(0.04, 0.22, 0.2, 0x3a3d42, { x }); },
  lamp: (mb) => { mb.cyl(0.03, 0.04, 1.1, 6, 0x3a3d42); mb.sphere(0.09, 0, 0xfff0c0, { y: 1.15, glow: true }); },
  sign: (mb) => { mb.cyl(0.025, 0.025, 0.7, 5, 0x6a4a33, { x: -0.25 }); mb.cyl(0.025, 0.025, 0.7, 5, 0x6a4a33, { x: 0.25 }); mb.box(0.7, 0.3, 0.04, 0x2f6b4a, { y: 0.5 }); mb.box(0.6, 0.04, 0.05, 0xe8d9a8, { y: 0.55 }); },
  fence: (mb) => { for (let k = 0; k < 5; k++) mb.box(0.05, 0.3, 0.05, 0xe8e0d0, { x: -0.8 + k * 0.4 }); mb.box(1.7, 0.04, 0.03, 0xe8e0d0, { y: 0.22 }); mb.box(1.7, 0.04, 0.03, 0xe8e0d0, { y: 0.1 }); },
  park: (mb) => {
    mb.box(1.8, 0.05, 1.8, 0x6aa852);
    mb.box(1.8, 0.055, 0.25, 0xd8c8a0); mb.box(0.25, 0.055, 1.8, 0xd8c8a0);
    for (const [x, z] of [[-0.55, -0.55], [0.55, 0.55], [0.55, -0.55]]) { mb.cyl(0.05, 0.06, 0.3, 5, 0x7a5a3a, { x, z }); mb.sphere(0.28, 0, 0x4e8a3e, { x, y: 0.48, z }); }
    mb.box(0.4, 0.05, 0.14, 0x8a5a3a, { x: -0.55, y: 0.18, z: 0.5 });
  },
  fountain: (mb) => { mb.cyl(0.7, 0.75, 0.2, 12, 0xc8c2b6); mb.cyl(0.6, 0.6, 0.05, 12, 0x5ab0d0, { y: 0.18 }); mb.cyl(0.1, 0.14, 0.5, 8, 0xc8c2b6); mb.sphere(0.12, 0, 0x8fd0e8, { y: 0.6 }); },
  statue: (mb) => { mb.box(0.6, 0.4, 0.6, 0xc8c2b6); mb.box(0.2, 0.5, 0.18, 0x8a9a8a, { y: 0.4 }); mb.sphere(0.1, 0, 0x8a9a8a, { y: 0.98 }); mb.box(0.5, 0.06, 0.08, 0x8a9a8a, { y: 0.8 }); },
};

export class DecorSystem {
  constructor(game) {
    this.game = game;
    this.items = new Map(); // tile -> {type, rot, slot}
    this.meshes = {};
    this.group = new THREE.Group();
    for (const d of DECORATIONS) {
      const mb = new ModelBuilder();
      MODELS[d.id](mb);
      const m = new THREE.InstancedMesh(mb.build(), MATS, 1024);
      m.count = 0; m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
      this.meshes[d.id] = { mesh: m, owners: [] };
      this.group.add(m);
    }
    game.scene.add(this.group);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1); this._up = new THREE.Vector3(0, 1, 0);
  }

  at(tile) { return this.items.get(tile); }

  placeError(tile, type) {
    const g = this.game;
    if (tile < 0) return 'err_out_of_map';
    const r = g.net.tileBlockedReason(tile);
    if (r) return r;
    if (g.world.type[tile] !== 0) return 'err_bad_terrain';
    if (g.net.conn[tile] || g.net.special.has(tile)) return 'err_occupied';
    if (g.occupancy.owner[tile]) return 'err_occupied';
    if (this.items.has(tile)) return 'err_occupied';
    const d = DECORATIONS.find((x) => x.id === type);
    if (!d || !g.progression.isUnlocked(d.unlock)) return 'err_locked';
    if (!g.economy.canAfford(g.economy.costs.decor(d))) return 'err_no_money';
    return null;
  }

  place(tile, type, rot, free) {
    const d = DECORATIONS.find((x) => x.id === type);
    if (!free) {
      const err = this.placeError(tile, type);
      if (err) return { error: err };
      this.game.economy.spend(this.game.economy.costs.decor(d), 'decor');
    }
    const it = { type, rot: rot ?? ((tile * 7) % 4) * (Math.PI / 2), slot: -1 };
    const pool = this.meshes[type];
    it.slot = pool.mesh.count++;
    pool.owners[it.slot] = it;
    this.items.set(tile, it);
    this.write(tile, it);
    this.game.world.view.clearTrees(tile);
    return { item: it, cost: free ? 0 : this.game.economy.costs.decor(d) };
  }

  write(tile, it) {
    const x = (tx(tile) + 0.5) * TILE, z = (tz(tile) + 0.5) * TILE;
    const y = this.game.world.view.heightAt(x, z);
    this._p.set(x, y, z);
    this._q.setFromAxisAngle(this._up, it.rot);
    this._s.set(1.1, 1.1, 1.1);
    this._m.compose(this._p, this._q, this._s);
    const pool = this.meshes[it.type];
    pool.mesh.setMatrixAt(it.slot, this._m);
    pool.mesh.instanceMatrix.needsUpdate = true;
  }

  remove(tile) {
    const it = this.items.get(tile);
    if (!it) return false;
    const pool = this.meshes[it.type];
    const last = pool.mesh.count - 1;
    if (it.slot !== last) {
      const lo = pool.owners[last];
      pool.mesh.getMatrixAt(last, this._m);
      pool.mesh.setMatrixAt(it.slot, this._m);
      pool.owners[it.slot] = lo; lo.slot = it.slot;
    }
    pool.owners.length = last;
    pool.mesh.count = last;
    pool.mesh.instanceMatrix.needsUpdate = true;
    this.items.delete(tile);
    return true;
  }

  serialize() { return [...this.items].map(([tile, it]) => ({ tile, type: it.type, rot: it.rot })); }
  deserialize(arr) {
    if (!Array.isArray(arr)) return;
    for (const d of arr) {
      if (typeof d.tile !== 'number' || d.tile < 0 || d.tile >= N * N || !this.meshes[d.type] || this.items.has(d.tile)) continue;
      this.place(d.tile, d.type, d.rot, true);
    }
  }
}
