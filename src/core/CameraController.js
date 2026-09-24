// Near-isometric orthographic camera with smooth zoom, inertial panning,
// 90° rotation steps, focus animations, shake and world bounds.
import * as THREE from 'three';
import { N, TILE, clamp, lerp } from '../util.js';

export class CameraController {
  constructor(game) {
    this.game = game;
    this.camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 1, 900);
    this.target = new THREE.Vector3(N * TILE / 2, 0, N * TILE / 2);
    this.viewSize = 22; this.zoomGoal = 22;
    this.minZoom = 7; this.maxZoom = 80 * Math.max(1, N / 64);   // larger maps zoom out further
    this.azimuth = Math.PI / 4; this.azGoal = this.azimuth;
    this.elev = 0.64;
    this.vel = new THREE.Vector2();
    this.focusGoal = null;
    this.shakeT = 0; this.shakeAmp = 0;
    this.aspect = 1;
    this.bounds = { minX: 0, maxX: N * TILE, minZ: 0, maxZ: N * TILE };
    this._r = new THREE.Vector3(); this._f = new THREE.Vector3();
  }

  resize(w, h) { this.aspect = w / Math.max(1, h); this.heightPx = h; this.apply(); }

  axes() {
    // camera right and forward projected onto the ground plane
    const a = this.azimuth;
    this._f.set(-Math.cos(a), 0, -Math.sin(a));
    this._r.set(Math.sin(a), 0, -Math.cos(a));
    return { r: this._r, f: this._f };
  }

  panPixels(dx, dy, withInertia = false) {
    const wpp = (2 * this.viewSize) / Math.max(1, this.heightPx);
    const { r, f } = this.axes();
    const sy = 1 / Math.sin(this.elev);
    const mx = -dx * wpp * r.x + dy * wpp * sy * f.x;
    const mz = -dx * wpp * r.z + dy * wpp * sy * f.z;
    this.target.x += mx; this.target.z += mz;
    this.focusGoal = null;
    if (withInertia) this.vel.set(mx * 30, mz * 30);
    this.clampTarget();
  }

  panWorld(dx, dz) { this.target.x += dx; this.target.z += dz; this.focusGoal = null; this.clampTarget(); }

  zoom(factor, anchorWorld) {
    const before = this.zoomGoal;
    this.zoomGoal = clamp(this.zoomGoal * factor, this.minZoom, this.maxZoom);
    if (anchorWorld && this.game.settings.cameraMotion !== false) {
      const k = 1 - this.zoomGoal / before;
      this.target.x += (anchorWorld.x - this.target.x) * k;
      this.target.z += (anchorWorld.z - this.target.z) * k;
      this.clampTarget();
    }
  }

  rotate(steps) { this.azGoal += steps * Math.PI / 2; }

  focus(x, z, zoom) {
    this.focusGoal = new THREE.Vector3(x, 0, z);
    if (zoom) this.zoomGoal = clamp(zoom, this.minZoom, this.maxZoom);
    this.vel.set(0, 0);
  }

  shake(amp = 0.5) { if (this.game.settings.screenShake && !this.game.settings.reducedMotion) { this.shakeAmp = amp; this.shakeT = 0.5; } }

  clampTarget() {
    const b = this.bounds;
    this.target.x = clamp(this.target.x, b.minX - 4, b.maxX + 4);
    this.target.z = clamp(this.target.z, b.minZ - 4, b.maxZ + 4);
  }

  update(dt) {
    const instant = this.game.settings.reducedMotion;
    if (this.focusGoal) {
      const k = instant ? 1 : 1 - Math.exp(-dt * 4);
      this.target.x = lerp(this.target.x, this.focusGoal.x, k);
      this.target.z = lerp(this.target.z, this.focusGoal.z, k);
      if (Math.hypot(this.target.x - this.focusGoal.x, this.target.z - this.focusGoal.z) < 0.05) this.focusGoal = null;
    } else if (this.vel.lengthSq() > 1e-4) {
      this.target.x += this.vel.x * dt; this.target.z += this.vel.y * dt;
      this.vel.multiplyScalar(Math.exp(-dt * 5));
      this.clampTarget();
    }
    this.viewSize = instant ? this.zoomGoal : lerp(this.viewSize, this.zoomGoal, 1 - Math.exp(-dt * 10));
    this.azimuth = instant ? this.azGoal : lerp(this.azimuth, this.azGoal, 1 - Math.exp(-dt * 8));
    if (this.shakeT > 0) this.shakeT -= dt;
    this.apply();
  }

  apply() {
    const c = this.camera;
    const vs = this.viewSize;
    c.left = -vs * this.aspect; c.right = vs * this.aspect; c.top = vs; c.bottom = -vs;
    c.updateProjectionMatrix();
    const d = 300;
    const t = this.target;
    let sx = 0, sz = 0;
    if (this.shakeT > 0) { const a = this.shakeAmp * (this.shakeT / 0.5); sx = (Math.random() - 0.5) * a; sz = (Math.random() - 0.5) * a; }
    c.position.set(t.x + Math.cos(this.azimuth) * Math.cos(this.elev) * d + sx, t.y + Math.sin(this.elev) * d, t.z + Math.sin(this.azimuth) * Math.cos(this.elev) * d + sz);
    c.lookAt(t.x + sx, t.y, t.z + sz);
  }

  serialize() { return { x: this.target.x, z: this.target.z, zoom: this.zoomGoal, az: this.azGoal }; }
  deserialize(d) {
    if (!d) return;
    if (isFinite(d.x) && isFinite(d.z)) this.target.set(d.x, 0, d.z);
    if (isFinite(d.zoom)) this.zoomGoal = this.viewSize = clamp(d.zoom, this.minZoom, this.maxZoom);
    if (isFinite(d.az)) this.azimuth = this.azGoal = d.az;
    this.clampTarget();
  }
}
