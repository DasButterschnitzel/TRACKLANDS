// Title screen backdrop: a small procedural island diorama with a steam train
// circling on a loop of track while the camera slowly orbits.
import * as THREE from 'three';
import { RNG, Noise2D } from '../util.js';
import { ModelBuilder, MATS } from '../core/ModelBuilder.js';
import { locoGeometry, wagonGeometry, LOCO_LEN, WAGON_LEN, CAR_GAP } from '../trains/TrainModels.js';
import { Particles } from '../vfx/Particles.js';

export class TitleScene {
  constructor(app) {
    this.app = app;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xcfe6f2);
    this.scene.fog = new THREE.Fog(0xcfe6f2, 60, 140);
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.5, 300);
    this.t = 0;
    const hemi = new THREE.HemisphereLight(0xeef6ff, 0x8a7a5a, 1.4);
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.2);
    sun.position.set(20, 30, 12); sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 90 });
    this.scene.add(hemi, sun);
    this.buildIsland();
    this.buildTrack();
    this.buildTrain();
    this.viewSize = 20;
    this.particles = new Particles({ scene: this.scene, settings: app.settings, renderer: app.renderer, camera: this }, 400);
  }

  buildIsland() {
    const rng = new RNG(1234), noise = new Noise2D(99);
    const R = 16;
    const g = new THREE.CircleGeometry(R, 48, 0, Math.PI * 2);
    g.rotateX(-Math.PI / 2);
    const ng = g.toNonIndexed();
    const pos = ng.attributes.position;
    const h = (x, z) => { const d = Math.hypot(x, z) / R; return Math.max(0, 0.6 + noise.fbm(x * 0.12, z * 0.12) * 1.2) * (1 - d * d * 0.6); };
    for (let i = 0; i < pos.count; i++) pos.setY(i, h(pos.getX(i), pos.getZ(i)));
    const col = [];
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i += 3) {
      const y = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
      c.set(y > 1.1 ? 0x6aa852 : 0x7fb85a).multiplyScalar(0.94 + rng.next() * 0.1);
      for (let k = 0; k < 3; k++) col.push(c.r, c.g, c.b);
    }
    ng.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    ng.computeVertexNormals();
    const top = new THREE.Mesh(ng, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    top.receiveShadow = true;
    const side = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 0.85, 4, 48, 1, true), new THREE.MeshLambertMaterial({ color: 0x7a5a42, flatShading: true }));
    side.position.y = -2;
    const water = new THREE.Mesh(new THREE.CircleGeometry(60, 48), new THREE.MeshPhongMaterial({ color: 0x5ab0d0, shininess: 60, flatShading: true }));
    water.rotation.x = -Math.PI / 2; water.position.y = -1.5;
    this.scene.add(top, side, water);
    this.heightAt = h;
    // trees and houses
    const mb = new ModelBuilder();
    for (let k = 0; k < 70; k++) {
      const a = rng.range(0, Math.PI * 2), r = rng.range(3, R - 1.5);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (Math.abs(Math.hypot(x / 10, z / 6) - 1) < 0.2) continue;
      const y = h(x, z), s = rng.range(0.8, 1.4);
      if (rng.chance(0.5)) { mb.cyl(0.06 * s, 0.09 * s, 0.4 * s, 5, 0x7a5a3a, { x, y, z }); mb.sphere(0.42 * s, 0, 0x5e9a48, { x, y: y + 0.7 * s, z }); }
      else { mb.cyl(0.05 * s, 0.07 * s, 0.3 * s, 5, 0x6a4a33, { x, y, z }); mb.cone(0.38 * s, 0.7 * s, 6, 0x2f6a44, { x, y: y + 0.25 * s, z }); mb.cone(0.28 * s, 0.55 * s, 6, 0x3a7a4e, { x, y: y + 0.6 * s, z }); }
    }
    const roofs = [0xb5563f, 0x3f6e9a, 0x9c4a3a];
    for (let k = 0; k < 7; k++) {
      const x = -2 + (k % 4) * 1.4, z = -1 + Math.floor(k / 4) * 1.5, y = h(x, z);
      mb.box(0.9, 0.6, 0.8, 0xf4efe6, { x, y, z, ry: 0.3 });
      mb.roof(1.0, 0.45, 0.9, roofs[k % 3], { x, y: y + 0.6, z, ry: 0.3 });
      mb.box(0.15, 0.15, 0.02, 0x34465a, { x: x + 0.2, y: y + 0.3, z: z + 0.41, ry: 0.3, glow: true });
    }
    const m = new THREE.Mesh(mb.build(), MATS);
    m.castShadow = true; m.receiveShadow = true;
    this.scene.add(m);
  }

  path(u) {
    const a = u * Math.PI * 2;
    const x = Math.cos(a) * 10, z = Math.sin(a) * 6;
    return new THREE.Vector3(x, this.heightAt(x, z) * 0.3 + 0.9, z);
  }

  buildTrack() {
    const mb = new ModelBuilder();
    const n = 120;
    for (let k = 0; k < n; k++) {
      const p = this.path(k / n), q = this.path((k + 1) / n);
      const yaw = Math.atan2(-(q.z - p.z), q.x - p.x);
      const len = p.distanceTo(q);
      mb.box(len + 0.02, 0.18, 1.0, 0x8d8279, { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 - 0.2, z: (p.z + q.z) / 2, ry: yaw });
      mb.box(0.1, 0.05, 0.62, 0x6b4a33, { x: p.x, y: p.y - 0.03, z: p.z, ry: yaw });
      for (const o of [-0.13, 0.13]) {
        const nx = -Math.sin(-yaw) * 0, s = Math.sin(yaw), c = Math.cos(yaw);
        void nx;
        mb.box(len + 0.02, 0.05, 0.05, 0xa8adb3, { x: (p.x + q.x) / 2 + s * o, y: (p.y + q.y) / 2 + 0.03, z: (p.z + q.z) / 2 + c * o, ry: yaw });
      }
    }
    const m = new THREE.Mesh(mb.build(), MATS);
    m.receiveShadow = true;
    this.scene.add(m);
  }

  buildTrain() {
    this.cars = [];
    const loco = new THREE.Mesh(locoGeometry('pioneer', 'classic_green', 1), MATS);
    loco.castShadow = true;
    this.cars.push({ mesh: loco, len: LOCO_LEN });
    const styles = [['log', 'WOOD'], ['coach', null], ['coach', null]];
    for (const [s, c] of styles) {
      const w = new THREE.Mesh(wagonGeometry(s, c, true, 'steam', 0x2f6b4a, 0xd9b45a), MATS);
      w.castShadow = true;
      this.cars.push({ mesh: w, len: WAGON_LEN });
    }
    for (const c of this.cars) this.scene.add(c.mesh);
    this.pathLen = 0;
    for (let k = 0; k < 200; k++) this.pathLen += this.path(k / 200).distanceTo(this.path((k + 1) / 200));
  }

  resize(w, h) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }

  render(dt) {
    this.t += dt;
    const speed = 2.6;
    const s = (this.t * speed) % this.pathLen;
    let off = 0;
    const toU = (d) => (((d % this.pathLen) + this.pathLen) % this.pathLen) / this.pathLen;
    for (const c of this.cars) {
      const center = s - off - c.len / 2;
      const f = this.path(toU(center + c.len * 0.35)), r = this.path(toU(center - c.len * 0.35));
      c.mesh.position.copy(f).add(r).multiplyScalar(0.5);
      c.mesh.position.y += 0.02;
      c.mesh.rotation.set(0, Math.atan2(-(f.z - r.z), f.x - r.x), 0);
      off += c.len + CAR_GAP;
    }
    this._puff = (this._puff || 0) + dt;
    if (this._puff > 0.35) {
      this._puff = 0;
      const l = this.cars[0].mesh;
      const v = new THREE.Vector3(0.52, 0.85, 0).applyEuler(l.rotation).add(l.position);
      this.particles.emit('steam', v.x, v.y, v.z, 1);
    }
    this.particles.update(dt);
    const a = this.t * 0.05 + 0.6;
    this.camera.position.set(Math.cos(a) * 30, 15, Math.sin(a) * 30);
    this.camera.lookAt(0, 0, 0);
    this.app.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  }
}
