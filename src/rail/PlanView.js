// The ghosts of planned projects (Phase 11): every planned tile as a pale
// quad, the active project brighter, the tiles of a step that no longer
// fits in red. Redrawn only when a plan or the world changes.
import * as THREE from 'three';
import { TILE, tileCX, tileCZ } from '../util.js';

const MAX = 6000;
export class PlanView {
  constructor(game) {
    this.game = game;
    const g = new THREE.PlaneGeometry(TILE * 0.86, TILE * 0.86); g.rotateX(-Math.PI / 2);
    this.mesh = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.42, depthWrite: false }), MAX);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.renderOrder = 5;
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    game.scene.add(this.mesh);
    this._m = new THREE.Matrix4(); this._c = new THREE.Color();
    this._v = -1; this._t = 0;
    this.shown = 0;
    game.events.on('plans', () => { this._v = -1; });
  }
  update(dt) {
    const P = this.game.plans;
    if (!P) return;
    this._t -= dt;
    // (revalidated now and then: the world moves on under a plan)
    if (this._t <= 0) { this._t = 4; P.invalidate(); this._v = -1; }
    if (this._v === P.version && !P._dirty) return;
    let k = 0;
    const net = this.game.net;
    for (const p of P.list) {
      const v = P.check(p), act = p.id === P.active;
      const badTiles = new Set();
      for (const i of v.bad) for (const t of v.steps[i].tiles) badTiles.add(t);
      for (const t of v.tiles) {
        if (k >= MAX) break;
        const col = badTiles.has(t) ? 0xe0503f : act ? (v.state === 'money' ? 0xf0b040 : 0x6ad0ff) : 0x9ab0c8;
        this._m.makeTranslation(tileCX(t), Math.max(net.railH(t), this.game.world.view.heightAt(tileCX(t), tileCZ(t))) + 0.5, tileCZ(t));
        this.mesh.setMatrixAt(k, this._m);
        this.mesh.setColorAt(k, this._c.set(col));
        k++;
      }
    }
    this.mesh.count = k;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.visible = k > 0;
    this.shown = k;
    this._v = P.version;
  }
  dispose() { this.game.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}
