// Build tools: track drawing with live preview, stations, depots, bulldozer,
// decorations, coverage visualization and a short undo window.
import * as THREE from 'three';
import { N, TILE, tx, tz, idx, inMap, step, tileCX, tileCZ, fmt } from '../util.js';
import { COSTS, DECORATIONS, TRACK_TIERS } from '../config.js';
import { K_BRIDGE, K_TUNNEL } from './RailNetwork.js';

const UNDO_WINDOW = 10;

export class Construction {
  constructor(game) {
    this.game = game;
    this.tool = 'select';
    this.tier = 0;
    this.decor = 'oak';
    this.drag = null;
    this.plan = null;
    this.undoStack = [];
    // preview instanced quads
    const g = new THREE.PlaneGeometry(TILE * 0.92, TILE * 0.92);
    g.rotateX(-Math.PI / 2);
    this.ghost = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, depthWrite: false }), 400);
    this.ghost.count = 0; this.ghost.frustumCulled = false; this.ghost.renderOrder = 6;
    this.ghost.setColorAt(0, new THREE.Color(1, 1, 1));
    this.cover = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.22, depthWrite: false }), 600);
    this.cover.count = 0; this.cover.frustumCulled = false; this.cover.renderOrder = 5;
    this.cover.setColorAt(0, new THREE.Color(1, 1, 1));
    // path line
    this.lineGeo = new THREE.BufferGeometry();
    this.line = new THREE.Line(this.lineGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false }));
    this.line.renderOrder = 8; this.line.frustumCulled = false;
    game.scene.add(this.ghost, this.cover, this.line);
    this._m = new THREE.Matrix4(); this._c = new THREE.Color();
    this.hoverTile = -1;
  }

  setTool(t) {
    if (t === this.tool) t = 'select';
    this.cancelDrag();
    this.tool = t;
    this.clearPreview();
    if (this.hoverTile >= 0) this.hover(this.hoverTile);
    this.game.events.emit('tool', t);
  }
  setTier(t) {
    const tier = TRACK_TIERS[t];
    if (tier.research && !this.game.progression.research.has(tier.research)) { this.game.ui.error('err_tier_locked'); return; }
    this.tier = t; this.game.events.emit('tool', this.tool);
  }

  clearPreview() {
    this.ghost.count = 0; this.cover.count = 0;
    this.lineGeo.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
    this.game.ui.hideCursorInfo();
  }

  putQuad(mesh, k, tile, color, lift = 0.35) {
    const x = tileCX(tile), z = tileCZ(tile);
    const net = this.game.net;
    const y = Math.max(this.game.world.view.heightAt(x, z), net.conn[tile] ? net.railH(tile) : -1) + lift;
    this._m.makeTranslation(x, y, z);
    mesh.setMatrixAt(k, this._m);
    mesh.setColorAt(k, this._c.set(color));
  }
  flush(mesh) { mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; }

  // ---------- pointer handling ----------
  hover(tile) {
    this.hoverTile = tile;
    if (this.drag) return;
    const g = this.game;
    if (this.tool === 'select' || this.tool === 'train' || tile < 0) { this.ghost.count = 0; this.cover.count = 0; this.flush(this.ghost); return; }
    let ok = true, info = '';
    if (this.tool === 'station' || this.tool === 'depot') {
      const err = g.stations.placeError(tile, this.tool);
      ok = !err;
      const cost = this.tool === 'station' ? g.economy.costs.station() : g.economy.costs.depot();
      info = err ? g.ui.tr(err) : `${fmt(cost)} ●`;
      if (this.tool === 'station') this.showCoverage(tile);
    } else if (this.tool === 'decor') {
      const err = g.decor.placeError(tile, this.decor);
      ok = !err; info = err ? g.ui.tr(err) : `${fmt(g.economy.costs.decor(DECORATIONS.find((d) => d.id === this.decor)))} ●`;
    } else if (this.tool === 'bulldoze') {
      ok = this.bulldozeTarget(tile) != null;
    } else if (this.tool === 'track') {
      const r = g.net.tileBlockedReason(tile);
      ok = !r; info = r ? g.ui.tr(r) : g.ui.tr('hint_drag_track');
    }
    this.ghost.count = 1;
    this.putQuad(this.ghost, 0, tile, ok ? (this.tool === 'bulldoze' ? 0xe0a33a : 0x3fc8b8) : 0xd0503f);
    this.flush(this.ghost);
    if (info) g.ui.cursorInfo(info, ok); else g.ui.hideCursorInfo();
  }

  showCoverage(tile) {
    const g = this.game;
    const { radius, towns, inds } = g.stations.previewLinks(tile, 0);
    let k = 0;
    for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
      const x = tx(tile) + dx, z = tz(tile) + dz;
      if (!inMap(x, z) || k >= 600) continue;
      this.putQuad(this.cover, k++, idx(x, z), 0x3fc8b8, 0.25);
    }
    // highlight served sites
    for (const ind of inds) for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) if (k < 600) this.putQuad(this.cover, k++, idx(ind.x + dx, ind.z + dz), 0xffd870, 0.3);
    for (const t of towns) if (k < 600) this.putQuad(this.cover, k++, idx(t.x, t.z), 0xffd870, 0.3);
    this.cover.count = k;
    this.flush(this.cover);
    this.coverInfo = { towns, inds };
  }

  pointerDown(tile) {
    const g = this.game;
    if (tile < 0) return;
    switch (this.tool) {
      case 'track':
        this.drag = { a: tile, b: tile };
        this.previewTrack();
        break;
      case 'bulldoze':
        this.drag = { tiles: new Set([tile]) };
        this.bulldoze(tile);
        break;
      case 'station': this.placeStation(tile); break;
      case 'depot': this.placeDepot(tile); break;
      case 'decor': this.drag = { tiles: new Set([tile]) }; this.placeDecor(tile); break;
      default: break;
    }
    void g;
  }
  pointerMove(tile) {
    if (!this.drag || tile < 0) return;
    if (this.tool === 'track') {
      if (tile !== this.drag.b) { this.drag.b = tile; this.previewTrack(); }
    } else if (this.tool === 'bulldoze' && !this.drag.tiles.has(tile)) {
      this.drag.tiles.add(tile); this.bulldoze(tile);
    } else if (this.tool === 'decor' && !this.drag.tiles.has(tile)) {
      this.drag.tiles.add(tile); this.placeDecor(tile, true);
    }
  }
  pointerUp(tile) {
    if (!this.drag) return;
    if (this.tool === 'track') {
      if (tile >= 0 && tile !== this.drag.b) { this.drag.b = tile; this.previewTrack(); }
      if (this.drag.a === this.drag.b) this.game.ui.toast(this.game.ui.tr('hint_drag_track'), 'info');
      else this.buildTrack();
    }
    this.drag = null;
    this.clearPreview();
    this.hover(this.hoverTile);
  }
  cancelDrag() { this.drag = null; this.plan = null; this.clearPreview(); }

  // ---------- track ----------
  previewTrack() {
    const g = this.game;
    const plan = g.net.planConstruction(this.drag.a, this.drag.b, this.tier);
    this.plan = plan;
    let k = 0;
    const pts = [];
    const invalid = new Set(plan.invalid);
    for (const t of plan.tiles) {
      if (k >= 400) break;
      const kd = g.net.kind(t);
      let col = !plan.ok || invalid.has(t) ? 0xd0503f : kd === K_BRIDGE ? 0x5a9ae0 : kd === K_TUNNEL ? 0x9a6ad0 : g.net.conn[t] ? 0x8fd8c0 : 0x3fc8b8;
      if (g.net.special.get(t)?.type === 'station') col = 0xffd870;
      this.putQuad(this.ghost, k++, t, col);
      const y = Math.max(g.world.view.heightAt(tileCX(t), tileCZ(t)), g.net.railH(t)) + 0.6;
      pts.push(tileCX(t), y, tileCZ(t));
    }
    this.ghost.count = k;
    this.flush(this.ghost);
    this.lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const ui = g.ui;
    if (plan.ok) {
      const afford = g.economy.canAfford(plan.cost);
      let s = `${fmt(plan.cost)} ●`;
      if (plan.bridges) s += ` · ${ui.tr('bridge')} ×${plan.bridges}`;
      if (plan.tunnels) s += ` · ${ui.tr('tunnel')} ×${plan.tunnels}`;
      if (!afford) s += ` · ${ui.tr('err_no_money')}`;
      ui.cursorInfo(s, afford);
    } else ui.cursorInfo(ui.tr(plan.reason || 'err_no_path'), false);
  }

  buildTrack() {
    const g = this.game, net = g.net, plan = this.plan;
    if (!plan || !plan.ok) { g.ui.error(plan ? plan.reason : 'err_no_path'); return; }
    if (!g.economy.canAfford(plan.cost)) { g.ui.error('err_no_money'); return; }
    const prev = plan.tiles.map((t) => ({ t, conn: net.conn[t], tier: net.tier[t] }));
    for (let k = 0; k < plan.dirs.length; k++) net.connect(plan.tiles[k], plan.dirs[k]);
    for (const t of plan.tiles) net.tier[t] = Math.max(prev.find((p) => p.t === t).conn ? net.tier[t] : 0, this.tier);
    for (const p of prev) if (p.conn && p.tier > this.tier) net.tier[p.t] = p.tier;
    g.economy.spend(plan.cost, 'construction');
    g.world.view.clearTreesMany(plan.tiles);
    net.bumpVersion();
    g.stats.inc('trackBuilt', plan.newTiles);
    g.stats.inc('bridgesBuilt', plan.bridges);
    g.stats.inc('tunnelsBuilt', plan.tunnels);
    g.railView.animateBuild(plan.tiles);
    for (const t of plan.tiles) if (net.special.has(t)) g.stations.refreshOrientation(t);
    g.trains.onNetworkChanged(false);
    this.pushUndo({ type: 'track', prev, cost: plan.cost, newTiles: plan.newTiles });
    g.audio.play('rail');
    const mid = plan.tiles[Math.floor(plan.tiles.length / 2)];
    for (let k = 0; k < plan.tiles.length; k += 2) { const t = plan.tiles[k]; g.particles.emit('dust', tileCX(t), net.railH(t) + 0.2, tileCZ(t), 2); }
    g.events.emit('trackBuilt', plan);
    void mid;
  }

  // ---------- stations / depots ----------
  placeStation(tile) {
    const g = this.game;
    const prevConn = this.neighborhoodConn(tile);
    const r = g.stations.build(tile);
    if (r.error) { g.ui.error(r.error); return; }
    this.pushUndo({ type: 'station', id: r.station.id, cost: r.cost, prevConn });
    g.audio.play('construct');
    g.particles.ring(tileCX(tile), g.net.railH(tile) + 0.1, tileCZ(tile), 0x3fc8b8, 4, 1);
    g.particles.emit('dust', tileCX(tile), g.net.railH(tile) + 0.3, tileCZ(tile), 10);
    g.camera.shake(0.15);
    const links = r.station.links;
    if (!links.towns.length && !links.industries.length) g.ui.toast(g.ui.tr('warn_station_no_links'), 'warn');
  }
  placeDepot(tile) {
    const g = this.game;
    const prevConn = this.neighborhoodConn(tile);
    const r = g.stations.buildDepot(tile);
    if (r.error) { g.ui.error(r.error); return; }
    this.pushUndo({ type: 'depot', id: r.depot.id, cost: r.cost, prevConn });
    g.audio.play('construct');
    g.particles.ring(tileCX(tile), g.net.railH(tile) + 0.1, tileCZ(tile), 0xe0a33a, 3.5, 1);
    g.particles.emit('dust', tileCX(tile), g.net.railH(tile) + 0.3, tileCZ(tile), 10);
    if (!g.net.conn[tile]) g.ui.toast(g.ui.tr('hint_connect_depot'), 'info');
  }
  neighborhoodConn(tile) {
    const out = [{ t: tile, conn: this.game.net.conn[tile], tier: this.game.net.tier[tile] }];
    for (let d = 0; d < 8; d++) { const j = step(tile, d); if (j >= 0) out.push({ t: j, conn: this.game.net.conn[j], tier: this.game.net.tier[j] }); }
    return out;
  }

  placeDecor(tile, quiet) {
    const g = this.game;
    const r = g.decor.place(tile, this.decor);
    if (r.error) { if (!quiet) g.ui.error(r.error); return; }
    this.pushUndo({ type: 'decor', tile, cost: r.cost });
    g.audio.play('click');
    g.particles.emit('sparkle', tileCX(tile), g.world.view.heightAt(tileCX(tile), tileCZ(tile)) + 0.4, tileCZ(tile), 6, 0.5);
  }

  // ---------- bulldozer ----------
  bulldozeTarget(tile) {
    const g = this.game;
    if (tile < 0 || !g.progression.regionUnlocked(g.world.region[tile])) return null;
    if (g.decor.at(tile)) return 'decor';
    const sp = g.net.special.get(tile);
    if (sp) return sp.type;
    if (g.net.conn[tile]) return 'track';
    if (g.world.view.hasTrees(tile) && !g.occupancy.blocked[tile]) return 'trees';
    return null;
  }

  bulldoze(tile) {
    const g = this.game, net = g.net;
    const what = this.bulldozeTarget(tile);
    if (!what) return;
    switch (what) {
      case 'decor': g.decor.remove(tile); break;
      case 'station': {
        const stn = g.stations.stationAt(tile);
        const r = g.stations.remove(stn);
        if (r.error) { g.ui.error(r.error); return; }
        if (r.affected) g.ui.toast(g.ui.tr('info_routes_updated', { n: r.affected }), 'info');
        g.industries.onStationsChanged(); g.towns.onStationsChanged();
        break;
      }
      case 'depot': {
        const d = g.stations.depotAt(tile);
        const r = g.stations.removeDepot(d);
        if (r.error) { g.ui.error(r.error); return; }
        this.afterTrackChange(tile);
        break;
      }
      case 'track': {
        if (g.trains.tileOccupied(tile)) { g.ui.error('err_train_on_track'); return; }
        const tier = net.tier[tile];
        const refund = Math.round(g.economy.costs.trackTile(tier, net.kind(tile)) * COSTS.bulldozeRefund);
        net.disconnectTile(tile);
        g.economy.earn(refund, 'refund', false);
        g.stats.inc('trackRemoved');
        this.afterTrackChange(tile);
        break;
      }
      case 'trees': {
        const cost = COSTS.treeClear;
        if (!g.economy.canAfford(cost)) { g.ui.error('err_no_money'); return; }
        g.economy.spend(cost, 'construction');
        g.world.view.clearTrees(tile);
        break;
      }
    }
    g.audio.play('bulldoze');
    g.particles.emit('dust', tileCX(tile), g.world.view.heightAt(tileCX(tile), tileCZ(tile)) + 0.3, tileCZ(tile), 8);
  }

  afterTrackChange(tile) {
    const g = this.game, net = g.net;
    net.bumpVersion();
    g.railView.markDirty(tile);
    for (let d = 0; d < 8; d++) { const j = step(tile, d); if (j >= 0) { g.railView.markDirty(j); if (net.special.has(j)) g.stations.refreshOrientation(j); } }
    g.trains.onNetworkChanged(true);
    g.events.emit('trackRemoved', tile);
  }

  // ---------- undo ----------
  pushUndo(e) {
    e.time = this.game.clock;
    this.undoStack.push(e);
    if (this.undoStack.length > 10) this.undoStack.shift();
    this.game.events.emit('undo', this.canUndo());
  }
  canUndo() {
    const e = this.undoStack[this.undoStack.length - 1];
    return !!e && this.game.clock - e.time < UNDO_WINDOW;
  }
  undoTimeLeft() {
    const e = this.undoStack[this.undoStack.length - 1];
    return e ? Math.max(0, UNDO_WINDOW - (this.game.clock - e.time)) : 0;
  }
  undo() {
    const g = this.game, net = g.net;
    if (!this.canUndo()) return;
    const e = this.undoStack.pop();
    if (e.type === 'track') {
      for (const p of e.prev) if (g.trains.tileOccupied(p.t) && net.conn[p.t] !== p.conn) { g.ui.error('err_train_on_track'); this.undoStack.push(e); return; }
      this.restoreConn(e.prev);
      g.stats.inc('trackBuilt', -e.newTiles);
      g.economy.earn(e.cost, 'refund', false);
    } else if (e.type === 'station') {
      const s = g.stations.byId(e.id);
      if (s) {
        const r = g.stations.remove(s);
        if (r.error) { g.ui.error(r.error); this.undoStack.push(e); return; }
        g.economy.earn(e.cost - r.refund, 'refund', false);
        this.restoreConn(e.prevConn);
      }
      g.industries.onStationsChanged(); g.towns.onStationsChanged();
    } else if (e.type === 'depot') {
      const d = g.stations.depotById(e.id);
      if (d) {
        const r = g.stations.removeDepot(d);
        if (r.error) { g.ui.error(r.error); this.undoStack.push(e); return; }
        g.economy.earn(e.cost - r.refund, 'refund', false);
        this.restoreConn(e.prevConn);
      }
    } else if (e.type === 'decor') {
      g.decor.remove(e.tile);
      g.economy.earn(e.cost, 'refund', false);
    }
    g.audio.play('close');
    g.events.emit('undo', this.canUndo());
    g.ui.toast(g.ui.tr('info_undone'), 'info');
  }
  restoreConn(prev) {
    const g = this.game, net = g.net;
    for (const p of prev) { net.conn[p.t] = p.conn; net.tier[p.t] = p.tier; }
    // keep reciprocity with tiles outside the restored set
    const set = new Set(prev.map((p) => p.t));
    for (const p of prev) for (let d = 0; d < 8; d++) {
      const j = step(p.t, d); if (j < 0 || set.has(j)) continue;
      if (net.hasDir(j, (d + 4) & 7) && !net.hasDir(p.t, d)) net.conn[j] &= ~(1 << ((d + 4) & 7));
    }
    for (const p of prev) { g.railView.markDirty(p.t); if (net.special.has(p.t)) g.stations.refreshOrientation(p.t); }
    net.bumpVersion();
    g.trains.onNetworkChanged(true);
  }

  update() {
    const can = this.canUndo();
    if (can !== this._lastCan) { this._lastCan = can; this.game.events.emit('undo', can); }
  }
}

export { N };
