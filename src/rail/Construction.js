// Build tools: track drawing with live preview, stations, depots, bulldozer,
// decorations, coverage visualization and a short undo window.
import * as THREE from 'three';
import { N, TILE, DX, DZ, tx, tz, idx, inMap, step, tileCX, tileCZ, fmt } from '../util.js';
import { COSTS, DECORATIONS, TRACK_TIERS, INDUSTRY_INVEST } from '../config.js';
import { K_BRIDGE, K_TUNNEL } from './RailNetwork.js';

const UNDO_WINDOW = 10;

export class Construction {
  constructor(game) {
    this.game = game;
    this.tool = 'select';
    this.tier = 0;
    this.trackMode = 'double';
    this.signalType = 'block';
    this.signalSpacing = 4;          // tiles between signals when dragging a row
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

  setTrackMode(m) { this.trackMode = m === 'single' ? 'single' : 'double'; this.game.events.emit('tool', this.tool); }
  signalUnlocked(type) {
    const R = this.game.progression.research;
    if (type === 'block') return R.has('block_signals');
    if (type === 'path') return R.has('path_signals');
    if (type === 'oneway') return R.has('one_way_signals');
    return false;
  }
  setSignalType(t) {
    if (!this.signalUnlocked(t)) { this.game.ui.error('err_signal_locked'); return; }
    this.signalType = t; this.game.events.emit('tool', this.tool);
  }
  // the exit direction of `tile` closest to world point p
  dirToward(tile, p) {
    const net = this.game.net;
    let best = null, bd = 1e9;
    for (let d = 0; d < 8; d++) {
      if (!net.hasDir(tile, d)) continue;
      const ex = tileCX(tile) + DX[d] * TILE / 2, ez = tileCZ(tile) + DZ[d] * TILE / 2;
      const dd = Math.hypot(ex - p.x, ez - p.z);
      if (dd < bd) { bd = dd; best = d; }
    }
    return best;
  }
  // highlight tiles (used by station edit previews)
  showTiles(tiles, ok) {
    let k = 0;
    for (const t of tiles) { if (t < 0 || k >= 400) continue; this.putQuad(this.ghost, k++, t, ok ? 0x3fc8b8 : 0xd0503f); }
    this.ghost.count = k; this.flush(this.ghost);
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
  hover(tile, p) {
    this.hoverTile = tile;
    if (p) this.hoverP = p;
    if (this.drag) return;
    const g = this.game;
    if (this.tool === 'select' || this.tool === 'train' || tile < 0) { this.ghost.count = 0; this.cover.count = 0; this.flush(this.ghost); return; }
    let ok = true, info = '';
    if (this.tool === 'station') { this.previewStation(tile, tile); return; }
    if (this.tool === 'industry') { this.previewFound(tile); return; }
    if (this.tool === 'hq') { this.previewHQ(tile); return; }
    if (this.tool === 'station' || this.tool === 'depot') {
      const err = g.stations.placeError(tile, this.tool);
      ok = !err;
      const cost = this.tool === 'station' ? g.economy.costs.station() : g.economy.costs.depot();
      info = err ? g.ui.tr(err) : `${fmt(cost)} ●`;
      if (this.tool === 'station') this.showCoverage(tile);
    } else if (this.tool === 'decor') {
      const err = g.decor.placeError(tile, this.decor);
      ok = !err; info = err ? g.ui.tr(err) : `${fmt(g.economy.costs.decor(DECORATIONS.find((d) => d.id === this.decor)))} ●`;
    } else if (this.tool === 'signal') {
      const d = this.hoverP ? this.dirToward(tile, this.hoverP) : null;
      const err = d == null ? 'err_signal_no_track' : g.net.canPlaceSignal(tile, d);
      ok = !err;
      const cur = d != null ? g.net.signalAt(tile, d) : null;
      info = err ? g.ui.tr(err) : cur ? g.ui.tr('hint_signal_cycle') : `${g.ui.tr('sig_' + this.signalType)} · ${fmt(g.economy.costs.signal())} ●`;
    } else if (this.tool === 'waypoint') {
      const has = g.net.waypoints.has(tile);
      const err = has ? null : this.waypointError(tile);
      ok = !err; info = err ? g.ui.tr(err) : has ? g.ui.tr('hint_waypoint_remove') : `${fmt(g.economy.costs.waypoint())} ●`;
    } else if (this.tool === 'bulldoze') {
      const what = this.bulldozeTarget(tile);
      ok = what != null;
      if (what === 'building') {
        const d = g.authority.demolishInfo(tile);
        ok = d.allowed;
        info = `${g.ui.tr('bld_' + d.arch)} · ${fmt(d.cost)} ● · ${g.ui.tr('auth_short', { d: d.impact })}${d.allowed ? '' : ' · ' + g.ui.tr('err_permit_denied')}`;
      }
    } else if (this.tool === 'roadstop') {
      const err = g.roads.stopError(tile, this.stopKind || 'bus');
      const kind = this.stopKind || 'bus';
      ok = !err; info = err ? g.ui.tr(err) : `${g.ui.tr('tool_roadstop_' + kind)} · ${fmt(g.roads.stopCost(kind))} ●`;
      if (kind === 'airport') {
        // the 3x3 airfield around the pointer
        let k = 0;
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const x = tile % N + dx, z = Math.floor(tile / N) + dz; if (inMap(x, z)) this.putQuad(this.ghost, k++, idx(x, z), ok ? 0x3fc8b8 : 0xd0503f); }
        this.ghost.count = k; this.flush(this.ghost);
        if (ok) this.showCoverage([tile]);
        g.ui.cursorInfo(info, ok);
        return;
      }
      if (ok) this.showCoverage([tile]);
    } else if (this.tool === 'road') {
      if (this.roadMode === 'tram') { ok = g.roads.hasRoad(tile); info = ok ? g.ui.tr('hint_drag_tram') : g.ui.tr('err_tram_needs_road'); }
      else { ok = g.roads.tileOk(tile); info = ok ? g.ui.tr('hint_drag_road') : g.ui.tr('err_road_blocked'); }
    } else if (this.tool === 'track') {
      const r = g.net.tileBlockedReason(tile);
      ok = !r; info = r ? g.ui.tr(r) : g.ui.tr('hint_drag_track');
    }
    this.ghost.count = 1;
    this.putQuad(this.ghost, 0, tile, ok ? (this.tool === 'bulldoze' ? 0xe0a33a : 0x3fc8b8) : 0xd0503f);
    this.flush(this.ghost);
    if (info) g.ui.cursorInfo(info, ok); else g.ui.hideCursorInfo();
  }

  previewHQ(tile) {
    const g = this.game, err = g.company.hqError(tile);
    const x = tile % N, z = Math.floor(tile / N);
    let k = 0;
    for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) if (inMap(x + dx, z + dz)) this.putQuad(this.ghost, k++, idx(x + dx, z + dz), err ? 0xd0503f : 0x3fc8b8);
    this.ghost.count = k; this.flush(this.ghost);
    const t = err ? null : g.company.nearestTown(tile);
    g.ui.cursorInfo(err ? g.ui.tr(err) : `${g.ui.tr('hq_title')} · ${fmt(g.company.hqCost())} ●${t ? ' · ' + t.name : ''}`, !err);
  }
  // fund a new industry: a 2x2 site with its corner at the tile
  foundKind() {
    const types = this.game.industries.foundTypes();
    if (!types.includes(this.fundType)) this.fundType = types[0];
    return this.fundType;
  }
  previewFound(tile) {
    const g = this.game, type = this.foundKind();
    const err = type ? g.industries.foundError(tile, type) : 'err_no_target';
    const x = tile % N, z = Math.floor(tile / N);
    let k = 0;
    for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) if (inMap(x + dx, z + dz)) this.putQuad(this.ghost, k++, idx(x + dx, z + dz), err ? 0xd0503f : 0x3fc8b8);
    this.ghost.count = k;
    this.flush(this.ghost);
    const near = g.industries.nearTown(x, z);
    const warn = !err && near.town && near.gap < INDUSTRY_INVEST.townGap ? ' · ' + g.ui.tr('found_near_town', { name: near.town.name }) : '';
    g.ui.cursorInfo(err ? g.ui.tr(err) : `${g.ui.tr('ind_' + type)} · ${fmt(g.industries.foundCost(type))} ●${warn}`, !err);
  }
  placeFound(tile) {
    const g = this.game, type = this.foundKind();
    const r = g.industries.found(tile, type);
    if (r.error) { g.ui.error(r.error); return; }
    g.ui.toast(g.ui.tr('found_done', { name: g.industries.displayName(r.ind) }), 'good', 'factory');
    this.setTool('select');
    g.select({ type: 'industry', id: r.ind.id });
  }

  showCoverage(tile) {
    const g = this.game;
    const tiles = Array.isArray(tile) ? tile : [tile];
    const { radius, towns, inds } = g.stations.previewLinks(tiles, 0);
    let k = 0;
    const seen = new Set();
    for (const t0 of tiles) for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
      const x = tx(t0) + dx, z = tz(t0) + dz;
      if (!inMap(x, z) || k >= 600) continue;
      const i = idx(x, z);
      if (seen.has(i)) continue;
      seen.add(i);
      this.putQuad(this.cover, k++, i, 0x3fc8b8, 0.25);
    }
    // highlight served sites
    for (const ind of inds) for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) if (k < 600) this.putQuad(this.cover, k++, idx(ind.x + dx, ind.z + dz), 0xffd870, 0.3);
    for (const t of towns) if (k < 600) this.putQuad(this.cover, k++, idx(t.x, t.z), 0xffd870, 0.3);
    this.cover.count = k;
    this.flush(this.cover);
    this.coverInfo = { towns, inds };
  }

  pointerDown(tile, p) {
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
      case 'station': this.drag = { a: tile, b: tile }; this.previewStation(tile, tile); break;
      case 'signal': this.drag = { a: tile, b: tile, p: p || this.hoverP }; break;
      case 'waypoint': this.toggleWaypoint(tile); break;
      case 'depot': this.placeDepot(tile); break;
      case 'decor': this.drag = { tiles: new Set([tile]) }; this.placeDecor(tile); break;
      case 'road': this.drag = { a: tile, b: tile }; this.previewRoad(); break;
      case 'industry': this.placeFound(tile); break;
      case 'hq': { const r = g.company.buildHQ(tile); if (r.error) g.ui.error(r.error); else { g.ui.toast(g.ui.tr('hq_built', { town: r.town ? r.town.name : '' }), 'good', 'company'); g.audio.play('construct'); this.setTool('select'); } break; }
      case 'roadstop': { const r = g.roads.addStop(tile, this.stopKind || 'bus'); if (r.error) g.ui.error(r.error); else { g.ui.toast(g.ui.tr('stop_built', { name: r.stop.name }), 'good', 'station'); g.select({ type: 'roadstop', id: r.stop.id }); } break; }
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
    } else if (this.tool === 'signal' && tile !== this.drag.b) {
      this.drag.b = tile; this.previewSignalRow();
    } else if (this.tool === 'station' && tile !== this.drag.b) {
      this.drag.b = tile; this.previewStation(this.drag.a, tile);
    } else if (this.tool === 'road' && tile !== this.drag.b) {
      this.drag.b = tile; this.previewRoad();
    }
  }
  pointerUp(tile) {
    if (!this.drag) return;
    if (this.tool === 'road') {
      const d = this.drag;
      this.drag = null;
      if (tile >= 0) d.b = tile;
      this.clearPreview();
      const R = this.game.roads, tram = this.roadMode === 'tram';
      if (d.a === d.b) this.game.ui.toast(this.game.ui.tr(tram ? 'hint_drag_tram' : 'hint_drag_road'), 'info');
      else { const r = tram ? R.buildTram(R.planTram(d.a, d.b)) : R.build(R.plan(d.a, d.b)); if (r.error) this.game.ui.error(r.error); }
      this.hover(this.hoverTile);
      return;
    }
    if (this.tool === 'station') {
      const d = this.drag;
      this.drag = null;
      if (tile >= 0) d.b = tile;
      this.clearPreview();
      this.buildStationDrag(d.a, d.b);
      this.hover(this.hoverTile);
      return;
    }
    if (this.tool === 'signal') {
      const d = this.drag;
      this.drag = null;
      this.clearPreview();
      if (tile >= 0 && tile !== d.b) d.b = tile;
      if (d.a === d.b) this.placeSignal(d.a, d.p); else this.placeSignalRow(d.a, d.b);
      this.hover(this.hoverTile);
      return;
    }
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

  // ---------- touch: anchors, handles, confirm (shared build commands) ----------
  // A touch construction is a plan in this.drag with touch:true. Drawing tools
  // (track, road, station, bulldoze) collect it from taps and handle drags;
  // single-site tools that cost a lot (depot, stops, industry, HQ) show the
  // site first. Everything is committed by touchCommit(), the same calls the
  // mouse makes on release; nothing is built while the finger only pans.
  touchKind() {
    const t = this.tool;
    if (t === 'track' || t === 'road' || t === 'station') return 'line';
    if (t === 'bulldoze') return 'mark';
    if (t === 'signal') return 'signal';
    if (t === 'depot' || t === 'roadstop' || t === 'industry' || t === 'hq') return 'site';
    return 'tap';
  }
  instant() { return !!this.game.settings.instantBuild; }
  touchLongPressTool() { const k = this.touchKind(); return k === 'line' || k === 'mark' || k === 'signal'; }
  touchTap(tile, p) {
    if (tile < 0) return;
    const k = this.touchKind();
    if (k === 'line') {
      if (!this.drag || !this.drag.touch) this.drag = { a: tile, b: tile, touch: true };
      else { this.drag.b = tile; this.drag.set = true; }
      this.previewDrag();
      if (this.instant() && this.drag.a !== this.drag.b) this.touchCommit(); else this.touchChanged();
      return;
    }
    if (k === 'mark') {
      if (!this.drag || !this.drag.touch) this.drag = { tiles: new Set(), touch: true };
      if (this.drag.tiles.has(tile)) this.drag.tiles.delete(tile); else if (this.bulldozeTarget(tile) != null) this.drag.tiles.add(tile);
      this.previewMarks();
      if (this.instant() && this.drag.tiles.size) this.touchCommit(); else this.touchChanged();
      return;
    }
    if (k === 'site' && !this.instant()) {
      this.drag = { point: tile, p, touch: true };
      this.previewPoint();
      this.touchChanged();
      return;
    }
    // cheap single placements (signal, waypoint, decoration) and instant build
    this.drag = null;
    this.pointerDown(tile, p);
    this.pointerUp(tile);
    this.touchChanged();
  }
  // hold still on the map: start drawing from there (replaces the old plan)
  touchLongPress(tile, p) {
    if (tile < 0) return false;
    const k = this.touchKind();
    if (k === 'line') { this.drag = { a: tile, b: tile, touch: true }; this.previewDrag(); }
    else if (k === 'mark') { this.drag = { tiles: new Set(this.bulldozeTarget(tile) != null ? [tile] : []), touch: true }; this.previewMarks(); }
    else if (k === 'signal') { this.drag = { a: tile, b: tile, p, touch: true }; this.previewSignalRow(); }
    else return false;
    this.touchChanged();
    return true;
  }
  touchDrag(handle, tile, p) {
    const d = this.drag;
    if (!d || tile < 0) return;
    if (d.tiles) { if (!d.tiles.has(tile) && this.bulldozeTarget(tile) != null) { d.tiles.add(tile); this.previewMarks(); } return; }
    if (d.point != null) { if (tile !== d.point) { d.point = tile; d.p = p; this.previewPoint(); } return; }
    const key = handle === 'a' ? 'a' : 'b';
    if (tile === d[key]) return;
    d[key] = tile;
    if (key === 'a' && this.tool === 'signal') d.p = p;
    if (this.tool === 'signal') this.previewSignalRow(); else this.previewDrag();
  }
  // a handle was let go (or the drawing paused for a pinch)
  touchDragEnd(paused) {
    if (!paused && this.instant() && this.touchReady()) { this.touchCommit(); return; }
    this.touchChanged();
  }
  previewDrag() {
    const d = this.drag;
    if (!d) return;
    if (this.tool === 'track') this.previewTrack();
    else if (this.tool === 'road') this.previewRoad();
    else if (this.tool === 'station') this.previewStation(d.a, d.b);
  }
  previewPoint() {
    const d = this.drag;
    this.drag = null;
    this.hover(d.point, d.p);
    this.drag = d;
  }
  previewMarks() {
    const g = this.game, d = this.drag;
    let k = 0;
    for (const t of d.tiles) { if (k >= 400) break; this.putQuad(this.ghost, k++, t, 0xe0a33a); }
    this.ghost.count = k; this.flush(this.ghost);
    if (k) g.ui.cursorInfo(g.ui.tr('bulldoze_marked', { n: k }), true); else g.ui.hideCursorInfo();
  }
  // can the plan be built as it stands?
  touchReady() {
    const d = this.drag, ci = this.game.ui._ci;
    if (!d) return false;
    if (d.tiles) return d.tiles.size > 0;
    if (d.point != null) return !!(ci && ci.ok);
    if (this.tool === 'station') { const sp = this.stationPlan; return !!(sp && sp.tiles && sp.tiles.length && sp.error !== 'err_no_money'); }
    if (d.a === d.b) return false;
    if (this.tool === 'track') return !!(this.plan && this.plan.ok);
    return !!(ci && ci.ok);
  }
  touchHint() {
    const d = this.drag, k = this.touchKind();
    if (k === 'mark') return d && d.tiles && d.tiles.size ? 'touch_hint_marked' : 'touch_hint_mark';
    if (k === 'site') return d && d.point != null ? 'touch_hint_site_set' : 'touch_hint_site';
    if (k === 'signal') return d ? 'touch_hint_line_set' : 'touch_hint_signal';
    if (k === 'line') return !d ? 'touch_hint_start' : d.a === d.b && this.tool !== 'station' ? 'touch_hint_end' : 'touch_hint_line_set';
    return 'touch_hint_tap';
  }
  // the markers a finger can drag
  touchHandles() {
    const d = this.drag;
    if (!d || !d.touch) return [];
    if (d.tiles) return [];
    if (d.point != null) return [{ id: 'b', tile: d.point }];
    return d.a === d.b ? [{ id: 'b', tile: d.b }] : [{ id: 'a', tile: d.a }, { id: 'b', tile: d.b }];
  }
  touchCommit() {
    const d = this.drag;
    if (!d) return;
    if (d.tiles) {
      const tiles = [...d.tiles];
      this.drag = null;
      this.clearPreview();
      for (const t of tiles) this.bulldoze(t);
    } else if (d.point != null) {
      this.drag = null;
      this.clearPreview();
      this.pointerDown(d.point, d.p);
      this.pointerUp(d.point);
    } else this.pointerUp(d.b);
    this.drag = null;
    if (!this.game.settings.keepTool && this.tool !== 'select') this.setTool('select');
    this.touchChanged();
  }
  touchCancel() {
    this.cancelDrag();
    this.touchChanged();
  }
  touchChanged() { this.game.events.emit('buildstate'); }

  // ---------- track ----------
  previewTrack() {
    const g = this.game;
    const plan = g.net.planConstruction(this.drag.a, this.drag.b, this.tier);
    this.adjustPlanForMode(plan);
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
      if (this.trackCheck(plan)) s += ` · ${ui.tr('works_will_wait')}`;
      ui.cursorInfo(s, afford);
    } else ui.cursorInfo(ui.tr(plan.reason || 'err_no_path'), false);
  }

  // single track is cheaper; dragging double track over single track doubles it
  adjustPlanForMode(plan, mode = this.trackMode) {
    if (!plan.ok) return;
    const g = this.game, net = g.net;
    plan.upgrades = [];
    if (mode === 'single') plan.cost = Math.round(plan.cost * 0.65);
    else for (const t of plan.tiles) if (net.conn[t] && net.single[t] && !net.special.has(t)) plan.upgrades.push(t);
    if (plan.upgrades.length) {
      plan.cost += Math.round(plan.upgrades.reduce((a, t) => a + g.economy.costs.trackTile(net.tier[t], net.kind(t)) * 0.4, 0));
    }
  }

  buildTrack() {
    const g = this.game, plan = this.plan;
    if (!plan || !plan.ok) { g.ui.error(plan ? plan.reason : 'err_no_path'); return; }
    if (!g.economy.canAfford(plan.cost)) { g.ui.error('err_no_money'); return; }
    const err = this.trackCheck(plan);
    if (err === 'err_train_on_track') { g.ui.offerWorks('track', { a: this.drag.a, b: this.drag.b, tier: this.tier, mode: this.trackMode }); return; }
    if (err) { g.ui.error(err); return; }
    this.applyTrack(plan, this.tier, this.trackMode);
  }
  // Can this plan be built now? (track under a train must not change)
  trackCheck(plan) {
    const g = this.game, net = g.net;
    for (const t of plan.upgrades || []) if (g.trains.tileReserved(t)) return 'err_train_on_track';
    // existing track that gains a new leg becomes a switch: not while a train is on it
    const changed = [];
    for (let k = 0; k < plan.tiles.length; k++) {
      const t = plan.tiles[k];
      if (!net.conn[t]) { changed.push(t); continue; }
      const dOut = plan.dirs[k], dIn = k > 0 ? (plan.dirs[k - 1] + 4) & 7 : null;
      const adds = (dOut != null && !net.hasDir(t, dOut)) || (dIn != null && !net.hasDir(t, dIn));
      if (adds && g.trains.tileReserved(t)) return 'err_train_on_track';
      if (adds) changed.push(t);
    }
    // new track next to a diagonal a train is on would change its fouling keys
    if (g.trains.foulsTrain(changed)) return 'err_train_on_track';
    return null;
  }
  // the whole a→b drag as one call: plan, check, build (pending construction)
  trackOp(a, b, tier, mode, dry) {
    const g = this.game;
    const plan = g.net.planConstruction(a, b, tier);
    this.adjustPlanForMode(plan, mode);
    if (!plan.ok) return { error: plan.reason || 'err_no_path' };
    const err = this.trackCheck(plan);
    if (err || dry) return { error: err, cost: plan.cost, tiles: plan.tiles };
    if (!g.economy.canAfford(plan.cost)) return { error: 'err_no_money' };
    this.applyTrack(plan, tier, mode);
    return { ok: true, cost: plan.cost };
  }
  applyTrack(plan, tier, mode) {
    const g = this.game, net = g.net;
    const prev = plan.tiles.map((t) => ({ t, conn: net.conn[t], tier: net.tier[t], single: net.single[t] }));
    for (let k = 0; k < plan.dirs.length; k++) net.connect(plan.tiles[k], plan.dirs[k]);
    for (const p of prev) {
      if (!p.conn && mode === 'single' && !net.special.has(p.t)) net.single[p.t] = 1;
      if (p.conn && mode === 'double' && (plan.upgrades || []).includes(p.t)) net.single[p.t] = 0;
    }
    for (const t of plan.tiles) net.tier[t] = Math.max(prev.find((p) => p.t === t).conn ? net.tier[t] : 0, tier);
    for (const p of prev) if (p.conn && p.tier > tier) net.tier[p.t] = p.tier;
    g.economy.spend(plan.cost, 'construction', { type: 'tile', id: plan.tiles[Math.floor(plan.tiles.length / 2)] }, `~fin_n_track:${plan.tiles.length}`);
    // near-miss drags: join a path end to an adjacent station/depot that has no track yet
    for (const end of [plan.tiles[0], plan.tiles[plan.tiles.length - 1]]) {
      if (net.special.has(end)) continue;
      for (const d of [0, 2, 4, 6, 1, 3, 5, 7]) {
        const j = step(end, d);
        if (j < 0 || !net.special.has(j) || net.conn[j] || g.trains.tileReserved(end)) continue;
        prev.push({ t: j, conn: 0, tier: net.tier[j], single: 0 });
        net.connect(end, d);
        net.tier[j] = net.tier[end];
        plan.tiles.push(j);
        break;
      }
    }
    const wooded = plan.tiles.filter((t) => g.world.view.hasTrees(t));
    g.world.view.clearTreesMany(plan.tiles);
    g.world.view.clearCorridorMany(plan.tiles);
    if (wooded.length) g.authority.onTreesCleared(wooded[Math.floor(wooded.length / 2)], wooded.length);
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

  // ---------- roads ----------
  previewRoad() {
    const g = this.game, R = g.roads;
    if (this.roadMode === 'tram') {
      const plan = R.planTram(this.drag.a, this.drag.b);
      let k = 0;
      for (const t of plan.tiles.length ? plan.tiles : [this.drag.a]) if (k < 400) this.putQuad(this.ghost, k++, t, !plan.ok ? 0xd0503f : R.tram[t] ? 0x9aa2a8 : 0x3fc8b8);
      this.ghost.count = k; this.flush(this.ghost);
      const ui = g.ui;
      if (plan.ok) ui.cursorInfo(`${ui.tr('tram_len', { n: plan.tiles.length })} · ${fmt(plan.cost)} ●`, g.economy.canAfford(plan.cost));
      else ui.cursorInfo(ui.tr(plan.reason || 'err_road_no_path'), false);
      return;
    }
    const plan = R.plan(this.drag.a, this.drag.b);
    let k = 0;
    for (const t of plan.tiles.length ? plan.tiles : [this.drag.a]) if (k < 400) this.putQuad(this.ghost, k++, t, !plan.ok ? 0xd0503f : g.net.conn[t] ? 0xf0c040 : R.hasRoad(t) ? 0x9aa2a8 : 0xc8ccd0);
    this.ghost.count = k; this.flush(this.ghost);
    const ui = g.ui;
    if (plan.ok) ui.cursorInfo(`${ui.tr('road_len', { n: plan.tiles.length })}${plan.crossings ? ' · ' + ui.tr('road_crossings', { n: plan.crossings }) : ''} · ${fmt(plan.cost)} ●`, g.economy.canAfford(plan.cost));
    else ui.cursorInfo(ui.tr(plan.reason || 'err_road_no_path'), false);
  }

  // ---------- stations / depots ----------
  // Station tool: press on the first platform tile and drag along the track;
  // the ghost shows every platform tile, the catchment, length, what fits
  // and the full price. Starting on / next to a platform end extends it.
  stationInfo(plan) {
    const ui = this.game.ui;
    if (!plan || !plan.tiles || !plan.tiles.length) return ui.tr((plan && plan.error) || 'err_unknown');
    const head = plan.mode === 'extend' ? ui.tr('st_drag_extend', { name: plan.stn.name }) : ui.tr(plan.side.length ? 'st_drag_new_n' : 'st_drag_new', { n: plan.side.length + 1 });
    const fit = ui.tr('st_drag_fit', { m: plan.fit.metres, n: plan.fit.cars, loco: plan.fit.loco });
    const buy = plan.acquire && plan.acquire.length ? ` · ${ui.tr('acq_short', { n: plan.acquire.length, c: fmt(plan.compensation) })}` : '';
    return `${head} · ${ui.tr('st_drag_len', { n: plan.len })} · ${fit}${buy} · ${fmt(plan.cost)} ●${plan.error ? ' · ' + ui.tr(plan.error === 'err_train_on_track' ? 'works_will_wait' : plan.error) : plan.clipped ? ' · ' + ui.tr(plan.clipped) : ''}`;
  }
  previewStation(a, b) {
    const g = this.game;
    const plan = g.stations.planDrag(a, b, this.stationTracks || 1);
    this.stationPlan = plan;
    let k = 0;
    const ok = !plan.error;
    const tiles = plan.tiles || [];
    for (const t of tiles) if (k < 400) this.putQuad(this.ghost, k++, t, ok ? 0xfff0b0 : 0xe0a33a, 0.45);
    for (const sd of plan.side || []) for (const t of sd.tiles) if (k < 400) this.putQuad(this.ghost, k++, t, ok ? 0xf2dc8a : 0xe0a33a, 0.45);
    for (const a of plan.acquire || []) if (k < 400) this.putQuad(this.ghost, k++, a.b.tile, 0xf08a24, 1.6);
    if (plan.bad != null && plan.bad >= 0 && k < 400) this.putQuad(this.ghost, k++, plan.bad, 0xd0503f);
    if (!tiles.length && a >= 0 && k < 400) this.putQuad(this.ghost, k++, a, 0xd0503f);
    this.ghost.count = k; this.flush(this.ghost);
    if (tiles.length) this.showCoverage(plan.mode === 'extend' ? [...g.stations.allTiles(plan.stn), ...tiles] : [...tiles, ...(plan.side || []).flatMap((sd) => sd.tiles)]);
    else { this.cover.count = 0; this.flush(this.cover); }
    g.ui.cursorInfo(this.stationInfo(plan), ok);
  }
  buildStationDrag(a, b) {
    const g = this.game;
    const r = this.stationOp(a, b, this.stationTracks || 1);
    if (r.error === 'err_train_on_track') g.ui.offerWorks('station', { a, b, tracks: this.stationTracks || 1 });
    else if (r.error) g.ui.error(r.error);
  }
  // drag a station a→b (new or extension) as one call (pending construction)
  stationOp(a, b, tracks, dry, confirmed) {
    const g = this.game;
    const plan = g.stations.planDrag(a, b, tracks);
    const all = [...(plan.tiles || []), ...(plan.side || []).flatMap((sd) => sd.tiles)];
    if (plan.error && !(plan.tiles && plan.tiles.length && plan.error !== 'err_no_money' && plan.error !== 'err_train_on_track' && plan.mode === 'extend')) return { error: plan.error, cost: plan.cost, tiles: all };
    if (dry) return { error: null, cost: plan.cost, tiles: all };
    if (plan.error) plan.error = null;   // (extend as far as possible)
    // buildings to buy: the player sees the whole project first
    if (plan.acquire && plan.acquire.length && !confirmed) { g.ui.confirmProject(plan, () => this.stationOp(a, b, tracks, false, true)); return { ok: true, pending: true }; }
    const prevConn = this.areaConn(all, 3);
    const r = g.stations.buildDrag(plan);
    if (r.error) return r;
    if (plan.mode === 'extend') this.pushUndo({ type: 'stationExtend', id: r.stn.id, k: plan.k, end: r.end, n: r.added, cost: r.cost, prevConn });
    else this.pushUndo({ type: 'station', id: r.stn.id, cost: r.cost, prevConn });
    g.audio.play('construct');
    const c = plan.tiles[Math.floor(plan.tiles.length / 2)];
    g.particles.ring(tileCX(c), g.net.railH(c) + 0.1, tileCZ(c), 0x3fc8b8, 3 + plan.tiles.length, 1);
    for (const t of plan.tiles) g.particles.emit('dust', tileCX(t), g.net.railH(t) + 0.3, tileCZ(t), 5);
    g.camera.shake(0.15);
    if (plan.mode === 'new') {
      const links = r.stn.links;
      if (!links.towns.length && !links.industries.length) g.ui.toast(g.ui.tr('warn_station_no_links'), 'warn');
      if (plan.side.length && r.tracks < plan.side.length + 1) g.ui.toast(g.ui.tr('st_drag_tracks_partial', { n: r.tracks }), 'info');
    }
    return { ok: true, cost: r.cost, stn: r.stn };
  }
  // connection snapshot of every tile within r of the given tiles (undo)
  areaConn(tiles, r) {
    const net = this.game.net, seen = new Set(), out = [];
    for (const t of tiles) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const x = tx(t) + dx, z = tz(t) + dz;
      if (!inMap(x, z)) continue;
      const i = idx(x, z);
      if (seen.has(i)) continue;
      seen.add(i); out.push({ t: i, conn: net.conn[i], tier: net.tier[i], single: net.single[i] });
    }
    return out;
  }
  setStationTracks(n) { this.stationTracks = Math.max(1, Math.min(this.game.stations.maxTracks(), n | 0)); if (this.drag && this.tool === 'station') this.previewStation(this.drag.a, this.drag.b); else if (this.tool === 'station') this.hover(this.hoverTile); }
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
    const net = this.game.net;
    const out = [{ t: tile, conn: net.conn[tile], tier: net.tier[tile], single: net.single[tile] }];
    for (let d = 0; d < 8; d++) { const j = step(tile, d); if (j >= 0) out.push({ t: j, conn: net.conn[j], tier: net.tier[j], single: net.single[j] }); }
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

  // ---------- signals & waypoints ----------
  placeSignal(tile, p) {
    const g = this.game, net = g.net;
    if (tile < 0 || !p) return;
    const d = this.dirToward(tile, p);
    const err = d == null ? 'err_signal_no_track' : net.canPlaceSignal(tile, d);
    if (err) { g.ui.error(err); return; }
    const key = tile * 8 + d;
    const cur = net.signals.get(key);
    // cycle: none -> chosen type -> one-way variant -> removed
    if (!cur) {
      if (!this.signalUnlocked(this.signalType === 'oneway' ? 'oneway' : this.signalType)) { g.ui.error('err_signal_locked'); return; }
      const cost = g.economy.costs.signal();
      if (!g.economy.canAfford(cost)) { g.ui.error('err_no_money'); return; }
      g.economy.spend(cost, 'construction', { type: 'tile', id: tile }, '~fin_n_signal:1');
      const type = this.signalType === 'oneway' ? 'block' : this.signalType;
      net.signals.set(key, { type, oneway: this.signalType === 'oneway' });
    } else if (!cur.oneway && this.signalUnlocked('oneway')) cur.oneway = true;
    else if (cur.type === 'block' && this.signalUnlocked('path') && cur.oneway) { cur.type = 'path'; cur.oneway = false; }
    else net.signals.delete(key);
    net.bumpVersion();
    g.trains.onNetworkChanged(false);
    g.audio.play('click');
    g.particles.emit('sparkle', tileCX(tile), net.railH(tile) + 0.8, tileCZ(tile), 4, 0.4);
    this.hover(tile, p);
  }
  // Signals along the track from a to b (drag direction = travel direction):
  // one every `signalSpacing` tiles, plus one in front of every junction on
  // the way (the usual spot for an entry signal). Stations, junctions and
  // existing signals are skipped.
  planSignalRow(a, b) {
    const net = this.game.net;
    if (a < 0 || b < 0 || !net.conn[a] || !net.conn[b]) return null;
    const r = net.findRoute({ tile: a, heading: null, fromCenter: true }, b, { allowReverse: false });
    if (!r || !r.steps.length || r.reverse) return null;
    const seq = [{ tile: a, out: r.steps[0].inH }, ...r.steps.slice(0, -1).map((s) => ({ tile: s.tile, out: s.outH }))];
    const keys = [];
    let since = this.signalSpacing;
    for (let k = 0; k < seq.length; k++) {
      const { tile, out } = seq[k];
      const next = seq[k + 1] ? seq[k + 1].tile : b;
      const ok = out != null && !net.canPlaceSignal(tile, out);
      if (ok && net.signals.has(tile * 8 + out)) { since = 0; continue; }
      const beforeJunction = net.isJunction(next);
      if (ok && (since >= this.signalSpacing || beforeJunction)) { keys.push(tile * 8 + out); since = 0; }
      since++;
    }
    return { keys, tiles: keys.map((k) => k >> 3) };
  }
  previewSignalRow() {
    const g = this.game, d = this.drag;
    const plan = this.planSignalRow(d.a, d.b);
    const n = plan ? plan.keys.length : 0;
    const cost = n * g.economy.costs.signal();
    const ok = n > 0 && this.signalUnlocked(this.signalType) && g.economy.canAfford(cost);
    this.showTiles(plan ? plan.tiles : [d.a, d.b], ok);
    g.ui.cursorInfo(plan ? g.ui.tr('hint_signal_row', { n, cost: fmt(cost) }) : g.ui.tr('err_signal_row'), ok);
  }
  placeSignalRow(a, b) {
    const g = this.game, net = g.net;
    const plan = this.planSignalRow(a, b);
    if (!plan || !plan.keys.length) { g.ui.error(plan ? 'err_signal_row_none' : 'err_signal_row'); return; }
    if (!this.signalUnlocked(this.signalType)) { g.ui.error('err_signal_locked'); return; }
    const unit = g.economy.costs.signal();
    const n = Math.min(plan.keys.length, Math.floor(g.economy.coins / unit));
    if (n <= 0) { g.ui.error('err_no_money'); return; }
    const placed = plan.keys.slice(0, n);
    g.economy.spend(n * unit, 'construction', null, `~fin_n_signal:${n}`);
    const type = this.signalType === 'oneway' ? 'block' : this.signalType;
    for (const k of placed) net.signals.set(k, { type, oneway: this.signalType === 'oneway' });
    net.bumpVersion();
    g.trains.onNetworkChanged(false);
    this.pushUndo({ type: 'signals', keys: placed, cost: n * unit });
    g.audio.play('construct');
    for (const k of placed) g.particles.emit('sparkle', tileCX(k >> 3), net.railH(k >> 3) + 0.8, tileCZ(k >> 3), 3, 0.4);
    g.ui.toast(g.ui.tr('toast_signals_placed', { n }), 'good', 'signal');
  }

  waypointError(tile) {
    const g = this.game, net = g.net;
    if (tile < 0 || !net.conn[tile]) return 'err_waypoint_track';
    if (net.degree(tile) !== 2 || net.special.has(tile)) return 'err_waypoint_track';
    if (!g.economy.canAfford(g.economy.costs.waypoint())) return 'err_no_money';
    return null;
  }
  toggleWaypoint(tile) {
    const g = this.game, net = g.net;
    if (net.waypoints.has(tile)) {
      const wp = net.waypoints.get(tile);
      net.waypoints.delete(tile);
      for (const t of g.trains.trains) t.route = t.route.filter((r) => r.wp !== tile);
      g.ui.toast(g.ui.tr('toast_waypoint_removed', { name: wp.name }), 'info');
      return;
    }
    const err = this.waypointError(tile);
    if (err) { g.ui.error(err); return; }
    g.economy.spend(g.economy.costs.waypoint(), 'construction', { type: 'tile', id: tile }, '~fin_n_waypoint:1');
    const id = net.nextWp++;
    net.waypoints.set(tile, { id, name: g.ui.tr('waypoint') + ' ' + id });
    g.audio.play('construct');
    g.particles.ring(tileCX(tile), net.railH(tile) + 0.1, tileCZ(tile), 0xffffff, 2, 0.8);
  }

  // ---------- bulldozer ----------
  bulldozeTarget(tile) {
    const g = this.game;
    if (tile < 0 || !g.progression.regionUnlocked(g.world.region[tile])) return null;
    if (g.decor.at(tile)) return 'decor';
    if (g.net.waypoints.has(tile)) return 'waypoint';
    for (let d = 0; d < 8; d++) if (g.net.signals.has(tile * 8 + d)) return 'signal';
    const sp = g.net.special.get(tile);
    if (sp) return sp.type;
    if (g.net.conn[tile]) return 'track';
    if (g.occupancy.blocked[tile] === 1 && g.authority && g.authority.buildingAt(tile)) return 'building';
    if (g.roads && g.roads.stopAt(tile)) return 'roadstop';
    if (g.roads && g.roads.bits[tile]) return 'road';
    if (g.world.view.hasTrees(tile) && !g.occupancy.blocked[tile]) return 'trees';
    return null;
  }

  bulldoze(tile) {
    const g = this.game, net = g.net;
    const what = this.bulldozeTarget(tile);
    if (!what) return;
    switch (what) {
      case 'decor': g.decor.remove(tile); break;
      case 'waypoint': this.toggleWaypoint(tile); return;
      case 'signal': {
        for (let d = 0; d < 8; d++) net.signals.delete(tile * 8 + d);
        net.bumpVersion(); g.trains.onNetworkChanged(false);
        break;
      }
      case 'station': {
        const stn = g.stations.stationAt(tile);
        // outer platform tracks are removed one by one before the whole station
        const k = g.stations.trackAt(tile);
        if (stn.tracks.length > 1 && k > 0) {
          const rr = g.stations.removeTrack(stn, k);
          if (rr.error) { g.ui.error(rr.error); return; }
          break;
        }
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
        if (g.trains.tileReserved(tile)) { g.ui.offerWorks('bulldoze', { tile }); return; }
        this.removeTrackOp(tile);
        break;
      }
      case 'building': g.ui.offerDemolish(tile); return;
      case 'roadstop': { const r = g.roads.removeStop(g.roads.stopAt(tile)); if (r.error) { g.ui.error(r.error); return; } break; }
      case 'road': { const r = g.roads.removeTile(tile); if (r.error) { g.ui.error(r.error); return; } break; }
      case 'trees': {
        const cost = COSTS.treeClear;
        if (!g.economy.canAfford(cost)) { g.ui.error('err_no_money'); return; }
        g.economy.spend(cost, 'construction', { type: 'tile', id: tile }, '~fin_n_trees:1');
        g.authority.onTreesCleared(tile);
        g.world.view.clearTrees(tile);
        break;
      }
    }
    g.audio.play('bulldoze');
    g.particles.emit('dust', tileCX(tile), g.world.view.heightAt(tileCX(tile), tileCZ(tile)) + 0.3, tileCZ(tile), 8);
  }

  // remove plain track from one tile (bulldozer; pending construction)
  removeTrackOp(tile, dry) {
    const g = this.game, net = g.net;
    if (!net.conn[tile] || net.special.has(tile)) return { error: 'err_unknown' };
    if (g.trains.tileReserved(tile)) return { error: 'err_train_on_track', cost: 0, tiles: [tile] };
    if (dry) return { error: null, cost: 0, tiles: [tile] };
    const refund = Math.round(g.economy.costs.trackTile(net.tier[tile], net.kind(tile)) * COSTS.bulldozeRefund);
    net.disconnectTile(tile);
    g.economy.earn(refund, 'refund', false);
    g.stats.inc('trackRemoved');
    this.afterTrackChange(tile);
    return { ok: true, cost: 0 };
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
    } else if (e.type === 'road') {
      g.roads.undo(e);
      g.economy.earn(e.cost, 'refund', false);
    } else if (e.type === 'tram') {
      g.roads.undoTram(e);
      g.economy.earn(e.cost, 'refund', false);
    } else if (e.type === 'roadstop') {
      const s = g.roads.stopById(e.id);
      if (s) { const r = g.roads.removeStop(s, 0); if (r.error) { g.ui.error(r.error); this.undoStack.push(e); return; } g.economy.earn(e.cost, 'refund', false); }
    } else if (e.type === 'works') {
      // cancel a pending construction and refund it
      if (g.works.cancel(e.id)) g.ui.toast(g.ui.tr('works_cancelled'), 'info', 'track');
    } else if (e.type === 'station') {
      const s = g.stations.byId(e.id);
      if (s) {
        const r = g.stations.remove(s);
        if (r.error) { g.ui.error(r.error); this.undoStack.push(e); return; }
        g.economy.earn(e.cost - r.refund, 'refund', false);
        this.restoreConn(e.prevConn);
      }
      g.industries.onStationsChanged(); g.towns.onStationsChanged();
    } else if (e.type === 'stationExtend') {
      const s = g.stations.byId(e.id);
      if (s) {
        const r = g.stations.shrinkPlatform(s, e.k, e.end, e.n);
        if (r.error) { g.ui.error(r.error); this.undoStack.push(e); return; }
        this.restoreConn(e.prevConn);
        g.economy.earn(e.cost, 'refund', false);
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
    } else if (e.type === 'signals') {
      for (const k of e.keys) net.signals.delete(k);
      net.bumpVersion();
      g.trains.onNetworkChanged(false);
      g.economy.earn(e.cost, 'refund', false);
    }
    g.audio.play('close');
    g.events.emit('undo', this.canUndo());
    g.ui.toast(g.ui.tr('info_undone'), 'info');
  }
  restoreConn(prev) {
    const g = this.game, net = g.net;
    for (const p of prev) { net.conn[p.t] = p.conn; net.tier[p.t] = p.tier; net.single[p.t] = p.conn ? (p.single | 0) : 0; }
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
