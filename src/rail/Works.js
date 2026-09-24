// Pending construction ("waiting for clearance"). Building on track a train
// occupies or has reserved does not fail: the player confirms, pays once, and
// the work waits. Trains make no new reservations onto the site (Trains.
// tryReserve), so it clears as soon as the trains already there have passed;
// then the ordinary build runs. Cancelling (or undo) refunds the full price.
// Pending works are saved with the game.
import * as THREE from 'three';
import { N, TILE, tileCX, tileCZ } from '../util.js';

const KINDS = ['track', 'bulldoze', 'station', 'addTrack'];
const MAX_WORKS = 12;

export class Works {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.nextId = 1;
    this.zone = new Set();   // tiles trains must not newly reserve
    this.t = 0;
    const geo = new THREE.PlaneGeometry(TILE * 0.96, TILE * 0.96);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xf08a24, transparent: true, opacity: 0.42, depthWrite: false }), 256);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.renderOrder = 5;
    game.scene.add(this.mesh);
    this._m = new THREE.Matrix4();
  }

  // Run an operation of the given kind. dry: only check it; returns
  // { error, cost, tiles } (tiles: where it builds).
  exec(kind, a, dry) {
    const g = this.game, C = g.construction;
    switch (kind) {
      case 'track': return C.trackOp(a.a, a.b, a.tier | 0, a.mode === 'single' ? 'single' : 'double', dry);
      case 'bulldoze': return C.removeTrackOp(a.tile, dry);
      case 'station': return C.stationOp(a.a, a.b, a.tracks || 1, dry);
      case 'addTrack': { const s = g.stations.byId(a.stn); return s ? g.stations.addTrack(s, a.side, dry) : { error: 'err_unknown' }; }
    }
    return { error: 'err_unknown' };
  }

  // Plan an operation as if no train were in the way: is it otherwise
  // possible, what does it cost, which tiles must clear?
  probe(kind, a) {
    const T = this.game.trains;
    const tiles = new Set();
    T.probe = tiles;
    let r;
    try { r = this.exec(kind, a, true); } finally { T.probe = null; }
    if (r.error) return { error: r.error };
    for (const t of r.tiles || []) tiles.add(t);
    return { cost: r.cost || 0, zone: [...tiles].filter((t) => t >= 0 && t < N * N), tiles: r.tiles || [] };
  }

  // who is in the way (for the confirm text)
  blockers(zone) {
    const T = this.game.trains, net = this.game.net, ids = new Set();
    for (const tile of zone) {
      for (const k of [tile * 2, tile * 2 + 1]) if (net.resv[k]) ids.add(net.resv[k]);
      const o = T.tileOccupied(tile);
      if (o) ids.add(o.id);
    }
    return [...ids].map((id) => T.byId(id)).filter(Boolean);
  }

  add(kind, a) {
    const g = this.game;
    if (!KINDS.includes(kind)) return { error: 'err_unknown' };
    if (this.list.length >= MAX_WORKS) return { error: 'err_works_max' };
    const p = this.probe(kind, a);
    if (p.error) return p;
    if (!g.economy.canAfford(p.cost)) return { error: 'err_no_money' };
    if (p.cost) g.economy.spend(p.cost, 'construction');
    const w = { id: this.nextId++, kind, a, cost: p.cost, zone: p.zone, tiles: p.tiles, t0: g.time };
    this.list.push(w);
    this.rebuild();
    g.construction.pushUndo({ type: 'works', id: w.id });
    g.events.emit('worksChanged', w);
    return { ok: true, works: w };
  }

  byId(id) { return this.list.find((w) => w.id === id) || null; }

  cancel(id, refund = true) {
    const g = this.game, w = this.byId(id);
    if (!w) return false;
    this.list.splice(this.list.indexOf(w), 1);
    if (refund && w.cost) g.economy.earn(w.cost, 'refund', false);
    this.rebuild();
    g.events.emit('worksChanged', null);
    return true;
  }

  tick(dt) {
    if (!this.list.length) return;
    this.t += dt;
    if (this.t < 0.5) return;
    this.t = 0;
    const g = this.game;
    for (const w of [...this.list]) {
      if (this.exec(w.kind, w.a, true).error === 'err_train_on_track') continue;
      // clear (or impossible now): hand the reserved money back, then build
      this.list.splice(this.list.indexOf(w), 1);
      this.rebuild();
      if (w.cost) g.economy.earn(w.cost, 'refund', false);
      const r = this.exec(w.kind, w.a, false);
      if (r.error === 'err_train_on_track' && g.economy.canAfford(w.cost)) {
        // (a train slipped in after all: keep waiting)
        if (w.cost) g.economy.spend(w.cost, 'construction');
        this.list.push(w); this.rebuild();
        continue;
      }
      if (r.error) g.ui && g.ui.toast(g.ui.tr('works_failed', { why: g.ui.tr(r.error) }), 'warn', 'track');
      else g.ui && g.ui.toast(g.ui.tr('works_done'), 'good', 'track');
      g.events.emit('worksChanged', null);
    }
  }

  rebuild() {
    this.zone = new Set();
    for (const w of this.list) for (const t of w.zone) this.zone.add(t);
    const g = this.game, net = g.net;
    let k = 0;
    for (const t of this.zone) {
      if (k >= 256) break;
      const x = tileCX(t), z = tileCZ(t);
      const y = Math.max(g.world.view.heightAt(x, z), net.conn[t] ? net.railH(t) : -1) + 0.4;
      this._m.makeTranslation(x, y, z);
      this.mesh.setMatrixAt(k++, this._m);
    }
    this.mesh.count = k;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  // label anchor for a work (middle of what it builds)
  anchor(w) {
    const ts = w.tiles && w.tiles.length ? w.tiles : w.zone;
    return ts[Math.floor(ts.length / 2)];
  }

  serialize() {
    return { nextId: this.nextId, list: this.list.map((w) => ({ id: w.id, kind: w.kind, a: w.a, cost: w.cost, zone: w.zone, tiles: w.tiles, t0: w.t0 })) };
  }
  deserialize(s) {
    this.list = [];
    if (!s || typeof s !== 'object') { this.rebuild(); return; }
    const okTile = (t) => Number.isInteger(t) && t >= 0 && t < N * N;
    for (const w of Array.isArray(s.list) ? s.list : []) {
      if (!w || typeof w !== 'object' || !KINDS.includes(w.kind) || !w.a || typeof w.a !== 'object') continue;
      const zone = (Array.isArray(w.zone) ? w.zone : []).filter(okTile);
      if (!zone.length) continue;
      this.list.push({ id: w.id | 0 || this.nextId++, kind: w.kind, a: w.a, cost: Math.max(0, +w.cost || 0), zone, tiles: (Array.isArray(w.tiles) ? w.tiles : []).filter(okTile), t0: +w.t0 || 0 });
      if (this.list.length >= MAX_WORKS) break;
    }
    this.nextId = Math.max(s.nextId | 0, 1, ...this.list.map((w) => w.id + 1));
    this.rebuild();
  }
}
