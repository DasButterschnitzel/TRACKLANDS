// Pooled GPU point particles (steam, smoke, dust, sparkles, coins, confetti)
// plus expanding ground rings. No per-frame allocations.
import * as THREE from 'three';

const TYPES = {
  steam: { life: 2.4, size: [0.5, 1.6], col: [0.97, 0.97, 0.98], a: 0.75, vy: 1.4, spread: 0.25, grow: 1, drag: 0.6 },
  smoke: { life: 4.0, size: [0.7, 2.4], col: [0.52, 0.52, 0.55], a: 0.55, vy: 1.0, spread: 0.2, grow: 1, drag: 0.4 },
  exhaust: { life: 1.6, size: [0.3, 0.9], col: [0.35, 0.35, 0.38], a: 0.5, vy: 1.1, spread: 0.12, grow: 1, drag: 0.6 },
  dust: { life: 1.3, size: [0.4, 1.1], col: [0.78, 0.68, 0.52], a: 0.7, vy: 0.9, spread: 1.4, grow: 1, drag: 2.5 },
  sparkle: { life: 1.1, size: [0.35, 0.05], col: [1.0, 0.86, 0.4], a: 1.0, vy: 2.5, spread: 1.8, grow: 0, drag: 1.5, glow: 1 },
  coin: { life: 1.2, size: [0.45, 0.2], col: [1.0, 0.8, 0.25], a: 1.0, vy: 3.2, spread: 0.6, grow: 0, drag: 1.2, glow: 1, grav: 3 },
  confetti: { life: 2.6, size: [0.3, 0.3], col: null, a: 1.0, vy: 6, spread: 3.2, grow: 0, drag: 0.8, grav: 5 },
  mist: { life: 3.5, size: [2.5, 5.0], col: [1, 1, 1], a: 0.35, vy: 1.8, spread: 2.5, grow: 1, drag: 0.3 },
};
const CONF = [[0.9, 0.35, 0.35], [0.35, 0.7, 0.9], [0.95, 0.8, 0.3], [0.45, 0.8, 0.5], [0.7, 0.45, 0.85]];

export class Particles {
  constructor(game, max = 2500) {
    this.game = game;
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.age = new Float32Array(max).fill(1e9);
    this.life = new Float32Array(max).fill(1);
    this.type = new Uint8Array(max);
    this.base = new Float32Array(max * 4);
    this.cursor = 0;
    this.typeList = Object.keys(TYPES);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 10 } },
      vertexShader: `attribute float size; attribute vec4 color; varying vec4 vC; uniform float uScale;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_PointSize = size * uScale; }`,
      fragmentShader: `varying vec4 vC; void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d); float a = smoothstep(0.5, 0.18, r) * vC.a; if (a < 0.01) discard; gl_FragColor = vec4(vC.rgb, a); }`,
      transparent: true, depthWrite: false,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    game.scene.add(this.points);
    // ground rings
    this.rings = [];
    const rg = new THREE.RingGeometry(0.85, 1, 40);
    rg.rotateX(-Math.PI / 2);
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
      m.visible = false; m.renderOrder = 9;
      game.scene.add(m);
      this.rings.push({ mesh: m, t: 1, dur: 1, max: 3 });
    }
  }

  qualityMul() {
    const q = this.game.settings.particles;
    let m = q === 'low' ? 0.35 : q === 'medium' ? 0.7 : 1;
    if (this.game.settings.reducedMotion) m *= 0.5;
    return m;
  }

  emit(type, x, y, z, count = 1, spreadMul = 1) {
    const T = TYPES[type];
    if (!T) return;
    let n = count * this.qualityMul();
    if (n < 1) n = Math.random() < n ? 1 : 0;
    n = Math.floor(n);
    const ti = this.typeList.indexOf(type);
    for (let k = 0; k < n; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
      const sp = T.spread * spreadMul;
      this.vel[i * 3] = (Math.random() - 0.5) * sp;
      this.vel[i * 3 + 1] = T.vy * (0.7 + Math.random() * 0.6);
      this.vel[i * 3 + 2] = (Math.random() - 0.5) * sp;
      this.age[i] = 0;
      this.life[i] = T.life * (0.8 + Math.random() * 0.4);
      this.type[i] = ti;
      const c = T.col || CONF[Math.floor(Math.random() * CONF.length)];
      this.base[i * 4] = c[0]; this.base[i * 4 + 1] = c[1]; this.base[i * 4 + 2] = c[2]; this.base[i * 4 + 3] = T.a;
    }
  }

  burst(x, y, z, big = false) {
    this.emit('sparkle', x, y, z, big ? 60 : 24, big ? 2 : 1);
    if (big) this.emit('confetti', x, y + 1, z, 70);
    this.ring(x, y + 0.1, z, big ? 0xffd870 : 0xffffff, big ? 7 : 3.5, big ? 1.6 : 1);
  }

  ring(x, y, z, color, max = 3, dur = 1) {
    const r = this.rings.find((q) => q.t >= q.dur) || this.rings[0];
    r.mesh.position.set(x, y, z);
    r.mesh.material.color.set(color);
    r.t = 0; r.dur = dur; r.max = max;
    r.mesh.visible = true;
  }

  update(dt) {
    const cam = this.game.camera;
    this.mat.uniforms.uScale.value = this.game.renderer.domElement.height / (2 * cam.viewSize);
    const types = this.typeList;
    for (let i = 0; i < this.max; i++) {
      const a = this.age[i];
      if (a >= this.life[i]) { if (this.size[i] !== 0) { this.size[i] = 0; this.col[i * 4 + 3] = 0; } continue; }
      const T = TYPES[types[this.type[i]]];
      this.age[i] = a + dt;
      const f = this.age[i] / this.life[i];
      const drag = Math.exp(-T.drag * dt);
      this.vel[i * 3] *= drag; this.vel[i * 3 + 2] *= drag;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * drag - (T.grav || 0) * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt + 0.15 * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = T.size[0] + (T.size[1] - T.size[0]) * f;
      this.col[i * 4] = this.base[i * 4]; this.col[i * 4 + 1] = this.base[i * 4 + 1]; this.col[i * 4 + 2] = this.base[i * 4 + 2];
      this.col[i * 4 + 3] = this.base[i * 4 + 3] * (f < 0.15 ? f / 0.15 : 1 - (f - 0.15) / 0.85);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true; g.attributes.size.needsUpdate = true;
    for (const r of this.rings) {
      if (r.t >= r.dur) { r.mesh.visible = false; continue; }
      r.t += dt;
      const f = Math.min(1, r.t / r.dur);
      const s = 0.3 + (1 - Math.pow(1 - f, 3)) * r.max;
      r.mesh.scale.set(s, 1, s);
      r.mesh.material.opacity = (1 - f) * 0.8;
    }
  }
}
