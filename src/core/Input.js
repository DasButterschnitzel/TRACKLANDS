// Pointer (mouse + multi-touch) and keyboard input. Translates gestures into
// camera motion, tool actions and object selection.
import * as THREE from 'three';
import { N, TILE, worldToTile } from '../util.js';

export class Input {
  constructor(game, el) {
    this.game = game;
    this.el = el;
    this.pointers = new Map();
    this.mode = null; // 'pan' | 'tool' | 'pinch' | 'maybe'
    this.keys = new Set();
    this.ray = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.hoverTile = -1;
    this.lastPinch = 0;
    this._ptr = { x: 0, y: 0 };
    this.bind();
  }

  bind() {
    const el = this.el;
    this.h = {
      down: (e) => this.onDown(e), move: (e) => this.onMove(e), up: (e) => this.onUp(e),
      wheel: (e) => this.onWheel(e), ctx: (e) => e.preventDefault(),
      gs: (e) => this.onGesture(e, 'start'), gc: (e) => this.onGesture(e, 'change'),
      kd: (e) => this.onKey(e, true), ku: (e) => this.onKey(e, false), blur: () => this.keys.clear(),
    };
    el.addEventListener('pointerdown', this.h.down);
    window.addEventListener('pointermove', this.h.move);
    window.addEventListener('pointerup', this.h.up);
    window.addEventListener('pointercancel', this.h.up);
    el.addEventListener('wheel', this.h.wheel, { passive: false });
    el.addEventListener('gesturestart', this.h.gs);
    el.addEventListener('gesturechange', this.h.gc);
    el.addEventListener('contextmenu', this.h.ctx);
    window.addEventListener('keydown', this.h.kd);
    window.addEventListener('keyup', this.h.ku);
    window.addEventListener('blur', this.h.blur);
    el.style.touchAction = 'none';
  }

  dispose() {
    const el = this.el;
    el.removeEventListener('pointerdown', this.h.down);
    window.removeEventListener('pointermove', this.h.move);
    window.removeEventListener('pointerup', this.h.up);
    window.removeEventListener('pointercancel', this.h.up);
    el.removeEventListener('wheel', this.h.wheel);
    el.removeEventListener('gesturestart', this.h.gs);
    el.removeEventListener('gesturechange', this.h.gc);
    el.removeEventListener('contextmenu', this.h.ctx);
    window.removeEventListener('keydown', this.h.kd);
    window.removeEventListener('keyup', this.h.ku);
    window.removeEventListener('blur', this.h.blur);
  }

  // screen -> ground point (iterative terrain intersection)
  groundAt(x, y) {
    const r = this.el.getBoundingClientRect();
    this.ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.game.camera.camera);
    const o = this.ray.ray.origin, d = this.ray.ray.direction;
    let h = 0.5, p = new THREE.Vector3();
    for (let k = 0; k < 5; k++) {
      const t = (h - o.y) / d.y;
      p.set(o.x + d.x * t, h, o.z + d.z * t);
      const nh = this.game.world.view.heightAt(p.x, p.z);
      if (Math.abs(nh - h) < 0.02) break;
      h = Math.max(nh, 0);
    }
    return p;
  }
  tileAt(x, y) {
    const p = this.groundAt(x, y);
    let tile = worldToTile(p.x, p.z);
    const tool = this.game.construction.tool;
    if (tool === 'signal' || tool === 'waypoint') {
      // rail tools: intersect the ray with the rail surface of nearby track tiles
      const net = this.game.net, o = this.ray.ray.origin, d = this.ray.ray.direction;
      const tx0 = Math.floor(p.x / 2), tz0 = Math.floor(p.z / 2);
      let best = null;
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
        const x2 = tx0 + dx, z2 = tz0 + dz;
        if (x2 < 0 || z2 < 0 || x2 >= N || z2 >= N) continue;
        const c = z2 * N + x2;
        if (!net.conn[c]) continue;
        const t = (net.railH(c) + 0.1 - o.y) / d.y;
        const q = new THREE.Vector3(o.x + d.x * t, net.railH(c) + 0.1, o.z + d.z * t);
        if (worldToTile(q.x, q.z) === c) { best = { p: q, tile: c }; break; }
      }
      if (best) return best;
    }
    return { p, tile };
  }

  pickTrain(x, y) {
    const list = this.game.trains.pickables();
    if (!list.length) return null;
    const r = this.el.getBoundingClientRect();
    this.ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.game.camera.camera);
    const hit = this.ray.intersectObjects(list, false)[0];
    return hit ? hit.object.userData.train : null;
  }

  onDown(e) {
    this.game.audio.unlock();
    this.el.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, button: e.button, type: e.pointerType });
    const n = this.pointers.size;
    const C = this.game.construction;
    if (n >= 2) {
      if (this.mode === 'tool') C.cancelDrag();
      this.mode = 'pinch';
      this.pinchStart();
      return;
    }
    if (e.pointerType === 'mouse' && (e.button === 1 || e.button === 2)) { this.mode = 'pan'; return; }
    const { tile, p } = this.tileAt(e.clientX, e.clientY);
    if (C.tool !== 'select' && C.tool !== 'train') {
      this.mode = 'tool';
      C.pointerDown(tile, p);
    } else this.mode = 'maybe';
  }

  onMove(e) {
    const ptr = this.pointers.get(e.pointerId);
    this._ptr.x = e.clientX; this._ptr.y = e.clientY;
    const C = this.game.construction;
    if (!ptr) {
      // hover (mouse)
      if (e.target === this.el) {
        const { tile, p } = this.tileAt(e.clientX, e.clientY);
        if (tile !== this.hoverTile || C.tool === 'signal') { this.hoverTile = tile; C.hover(tile, p); }
        this.game.ui.pointerMoved(e.clientX, e.clientY);
      }
      return;
    }
    const dx = e.clientX - ptr.x, dy = e.clientY - ptr.y;
    ptr.x = e.clientX; ptr.y = e.clientY;
    if (this.mode === 'pinch') { this.pinchMove(); return; }
    if (this.mode === 'pan') { this.game.ui.followId = null; this.game.camera.panPixels(dx, dy, true); return; }
    if (this.mode === 'maybe') {
      if (Math.hypot(e.clientX - ptr.sx, e.clientY - ptr.sy) > 7) { this.mode = 'pan'; this.game.ui.followId = null; this.game.camera.panPixels(e.clientX - ptr.sx, e.clientY - ptr.sy, true); }
      return;
    }
    if (this.mode === 'tool') {
      const { tile, p } = this.tileAt(e.clientX, e.clientY);
      C.pointerMove(tile, p);
      this.game.ui.pointerMoved(e.clientX, e.clientY);
    }
  }

  onUp(e) {
    const ptr = this.pointers.get(e.pointerId);
    if (!ptr) return;
    this.pointers.delete(e.pointerId);
    const C = this.game.construction;
    if (this.mode === 'pinch') { if (this.pointers.size === 0) this.mode = null; else if (this.pointers.size === 1) this.mode = 'pan'; return; }
    if (this.mode === 'tool') { const { tile, p } = this.tileAt(e.clientX, e.clientY); C.pointerUp(tile, p); }
    else if (this.mode === 'maybe') this.tap(e.clientX, e.clientY);
    this.mode = null;
  }

  tap(x, y) {
    const g = this.game;
    const trainId = this.pickTrain(x, y);
    if (trainId != null) { g.select({ type: 'train', id: trainId }); return; }
    const gp = this.groundAt(x, y);
    const rv = gp && g.roads ? g.roads.pickAt(gp) : null;
    if (rv) { g.select({ type: 'roadveh', id: rv.id }); return; }
    const { tile } = this.tileAt(x, y);
    g.selectTile(tile);
  }

  pinchStart() {
    const [a, b] = [...this.pointers.values()];
    this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  }
  pinchMove() {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return;
    const [a, b] = pts;
    const d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    const cam = this.game.camera;
    cam.panPixels(cx - this.pinch.cx, cy - this.pinch.cy);
    if (this.pinch.d > 10 && d > 10) cam.zoom(this.pinch.d / d, this.groundAt(cx, cy));
    this.pinch = { d, cx, cy };
  }

  // Mouse wheel zooms; a trackpad pans with two fingers and zooms with a
  // pinch (browsers send pinches as ctrl+wheel). 'auto' tells them apart by
  // the event pattern: wheel notches come in whole lines or multiples of 120.
  onWheel(e) {
    e.preventDefault();
    const cam = this.game.camera;
    const at = this.groundAt(e.clientX, e.clientY);
    if (e.ctrlKey) { cam.zoom(Math.exp(Math.max(-60, Math.min(60, e.deltaY)) * 0.012), at); return; }
    const mode = this.game.settings.wheel || 'auto';
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const dx = e.deltaX * unit, dy = e.deltaY * unit;
    const now = performance.now();
    const notch = e.deltaMode === 1 || (e.deltaX === 0 && e.wheelDeltaY != null && e.wheelDeltaY !== 0 && Math.abs(e.wheelDeltaY) % 120 === 0);
    // a gesture keeps its first classification while events keep coming
    if (!this._wheelKind || now - this._wheelT > 350) this._wheelKind = notch ? 'mouse' : 'pad';
    this._wheelT = now;
    const pan = mode === 'pan' || (mode === 'auto' && this._wheelKind === 'pad');
    if (pan) { this.game.ui.followId = null; cam.panPixels(-dx, -dy, false); return; }
    const f = Math.exp(Math.sign(dy) * Math.min(Math.abs(dy), 120) * 0.0022);
    cam.zoom(f, at);
  }
  // Safari pinch gestures (desktop trackpad)
  onGesture(e, phase) {
    e.preventDefault();
    if (phase === 'start') { this._gScale = 1; return; }
    const s = e.scale || 1;
    this.game.camera.zoom(this._gScale / s, this.groundAt(e.clientX, e.clientY));
    this._gScale = s;
  }

  onKey(e, down) {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const k = e.key.toLowerCase();
    if (down) this.keys.add(k); else { this.keys.delete(k); return; }
    const g = this.game;
    if (!g.running) return;
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); g.construction.undo(); return; }
    switch (k) {
      case 'escape': if (!g.ui.closeTop()) g.construction.setTool('select'); break;
      case ' ': if (e.target === document.body || e.target === this.el) { e.preventDefault(); g.togglePause(); } break;
      case '1': g.construction.setTool('select'); break;
      case '2': g.construction.setTool('track'); break;
      case '3': g.construction.setTool('station'); break;
      case '4': g.construction.setTool('depot'); break;
      case '5': g.ui.openTrainShop(); break;
      case '6': g.construction.setTool('bulldoze'); break;
      case '7': g.construction.setTool('decor'); break;
      case '8': g.construction.setTool('signal'); break;
      case '9': g.construction.setTool('waypoint'); break;
      case 'r': g.construction.setTool('road'); break;
      case 'b': g.construction.setTool('roadstop'); break;
      case 'i': g.construction.setTool('industry'); break;
      case 'o': g.ui.toggleOverlayMenu(); break;
      case 't': g.ui.openPanel('trains'); break;
      case 'm': g.ui.openPanel('map'); break;
      case '?': g.ui.actions.help('start'); break;
      case 'q': g.camera.rotate(-1); break;
      case 'e': g.camera.rotate(1); break;
      // with the station tool: platform tracks; otherwise zoom
      case '+': case '=': if (g.construction.tool === 'station') { g.construction.setStationTracks((g.construction.stationTracks || 1) + 1); g.ui.renderToolbar(); } else g.camera.zoom(0.8); break;
      case '-': if (g.construction.tool === 'station') { g.construction.setStationTracks((g.construction.stationTracks || 1) - 1); g.ui.renderToolbar(); } else g.camera.zoom(1.25); break;
      case 'h': g.ui.toggleHeatmap(); break;
      case 'f3': case '`': e.preventDefault(); g.ui.toggleDebug(); break;
      default: break;
    }
  }

  update(dt) {
    const k = this.keys;
    let x = 0, y = 0;
    if (k.has('w') || k.has('arrowup')) y += 1;
    if (k.has('s') || k.has('arrowdown')) y -= 1;
    if (k.has('a') || k.has('arrowleft')) x -= 1;
    if (k.has('d') || k.has('arrowright')) x += 1;
    if (x || y) {
      const cam = this.game.camera;
      const sp = cam.viewSize * 1.4 * dt;
      const { r, f } = cam.axes();
      cam.panWorld((r.x * x + f.x * y) * sp, (r.z * x + f.z * y) * sp);
    }
  }
}

export { N, TILE };
