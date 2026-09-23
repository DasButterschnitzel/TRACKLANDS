// Procedural low-poly model construction. Primitives are merged into a single
// vertex-colored geometry with two groups: 0 = regular surfaces, 1 = glowing
// surfaces (windows, lamps) whose emissive intensity follows the day/night cycle.
import * as THREE from 'three';
import { MATERIAL } from '../style.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

const geoCache = new Map();
function base(kind, a, b, c, d) {
  const key = kind + ':' + a + ':' + b + ':' + c + ':' + d;
  let g = geoCache.get(key);
  if (!g) {
    switch (kind) {
      case 'box': g = new THREE.BoxGeometry(1, 1, 1); break;
      case 'cyl': g = new THREE.CylinderGeometry(a, b, 1, c, 1); break;
      case 'cone': g = new THREE.ConeGeometry(1, 1, a, 1); break;
      case 'sphere': g = new THREE.IcosahedronGeometry(1, a); break;
      case 'prism': {
        // triangular roof prism, ridge along X, base 1x1, height 1
        const s = new THREE.Shape();
        s.moveTo(-0.5, 0); s.lineTo(0.5, 0); s.lineTo(0, 1); s.lineTo(-0.5, 0);
        g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false });
        g.translate(0, 0, -0.5);
        g.rotateY(Math.PI / 2);
        break;
      }
      case 'torus': g = new THREE.TorusGeometry(1, a, 6, b, c || Math.PI * 2); break;
      default: g = new THREE.BoxGeometry(1, 1, 1);
    }
    g = g.index ? g.toNonIndexed() : g;
    g.deleteAttribute('uv');
    geoCache.set(key, g);
  }
  return g;
}

export class ModelBuilder {
  constructor() { this.parts = [[], []]; }

  add(geo, color, o = {}) {
    _e.set(o.rx || 0, o.ry || 0, o.rz || 0);
    _q.setFromEuler(_e);
    _p.set(o.x || 0, o.y || 0, o.z || 0);
    _s.set(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1);
    _m.compose(_p, _q, _s);
    if (o.parent) _m.premultiply(o.parent);
    this.parts[o.glow ? 1 : 0].push({ geo, m: _m.clone(), color: _c.set(color).clone() });
    return this;
  }
  // box with its base at y
  box(w, h, d, color, o = {}) { return this.add(base('box'), color, { ...o, y: (o.y || 0) + (o.center ? 0 : h / 2), sx: w, sy: h, sz: d }); }
  cyl(rt, rb, h, seg, color, o = {}) { return this.add(base('cyl', rt, rb, seg), color, { ...o, y: (o.y || 0) + (o.center ? 0 : h / 2), sy: h }); }
  cone(r, h, seg, color, o = {}) { return this.add(base('cone', seg), color, { ...o, y: (o.y || 0) + (o.center ? 0 : h / 2), sx: r, sy: h, sz: r }); }
  sphere(r, detail, color, o = {}) { return this.add(base('sphere', detail), color, { ...o, sx: r * (o.sx || 1), sy: r * (o.sy || 1), sz: r * (o.sz || 1) }); }
  // gable roof: w along x (ridge), d along z, h height, base at y
  roof(w, h, d, color, o = {}) { return this.add(base('prism'), color, { ...o, sx: w, sy: h, sz: d }); }
  torus(r, tube, arc, color, o = {}) { return this.add(base('torus', tube / r, 12, arc), color, { ...o, sx: r, sy: r, sz: r }); }
  // horizontal cylinder along x
  hcyl(r, len, seg, color, o = {}) { return this.add(base('cyl', 1, 1, seg), color, { ...o, rz: Math.PI / 2 + (o.rz || 0), sx: r, sy: len, sz: r }); }
  // Tapered hull (loft between two rectangles along X), centred on o.x:
  // the -X face is w0 wide (z) and h0 tall with its bottom at o.y; the +X face
  // is w1 x h1 with its bottom raised by o.yb1. o.flip mirrors it so the wide
  // end faces +X. Used for noses, windscreens, pilots and domes.
  taper(len, w0, h0, w1, h1, color, o = {}) {
    const yb1 = o.yb1 || 0, flip = !!o.flip;
    const key = ['taper', len, w0, h0, w1, h1, yb1].map((v) => (+v).toFixed(4)).join(':') + (flip ? ':f' : '');
    let g = geoCache.get(key);
    if (!g) {
      const sx = flip ? -1 : 1, a = -len / 2 * sx, b = len / 2 * sx;
      const P = [
        [a, 0, -w0 / 2], [a, 0, w0 / 2], [a, h0, w0 / 2], [a, h0, -w0 / 2],
        [b, yb1, -w1 / 2], [b, yb1, w1 / 2], [b, yb1 + h1, w1 / 2], [b, yb1 + h1, -w1 / 2],
      ];
      const faces = [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [3, 2, 6, 7], [1, 5, 6, 2], [0, 3, 7, 4]];
      const cx = P.reduce((s2, p) => s2 + p[0], 0) / 8, cy = P.reduce((s2, p) => s2 + p[1], 0) / 8;
      const pos = [], nor = [];
      const tri = (i, j, k) => {
        const A = P[i], B = P[j], C = P[k];
        const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const l = Math.hypot(nx, ny, nz);
        if (l < 1e-9) return;                                 // degenerate (pointed tip)
        nx /= l; ny /= l; nz /= l;
        const mx = (A[0] + B[0] + C[0]) / 3 - cx, my = (A[1] + B[1] + C[1]) / 3 - cy, mz = (A[2] + B[2] + C[2]) / 3;
        let vs = [A, B, C];
        if (nx * mx + ny * my + nz * mz < 0) { vs = [A, C, B]; nx = -nx; ny = -ny; nz = -nz; }   // keep normals outward
        for (const v of vs) { pos.push(v[0], v[1], v[2]); nor.push(nx, ny, nz); }
      };
      for (const f of faces) { tri(f[0], f[1], f[2]); tri(f[0], f[2], f[3]); }
      g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      geoCache.set(key, g);
    }
    return this.add(g, color, { ...o, sx: 1, sy: 1, sz: 1 });
  }
  // horizontal cylinder along z (wheels)
  wheel(r, w, seg, color, o = {}) { return this.add(base('cyl', 1, 1, seg), color, { ...o, rx: Math.PI / 2, sx: r, sy: w, sz: r }); }

  build() {
    let total = 0;
    for (const list of this.parts) for (const p of list) total += p.geo.attributes.position.count;
    const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
    const nm = new THREE.Matrix3();
    const v = new THREE.Vector3();
    let o = 0;
    const g = new THREE.BufferGeometry();
    let groupStart = 0;
    for (let gi = 0; gi < 2; gi++) {
      for (const p of this.parts[gi]) {
        const pa = p.geo.attributes.position, na = p.geo.attributes.normal;
        nm.getNormalMatrix(p.m);
        for (let i = 0; i < pa.count; i++) {
          v.fromBufferAttribute(pa, i).applyMatrix4(p.m);
          pos[o * 3] = v.x; pos[o * 3 + 1] = v.y; pos[o * 3 + 2] = v.z;
          v.fromBufferAttribute(na, i).applyMatrix3(nm).normalize();
          nor[o * 3] = v.x; nor[o * 3 + 1] = v.y; nor[o * 3 + 2] = v.z;
          col[o * 3] = p.color.r; col[o * 3 + 1] = p.color.g; col[o * 3 + 2] = p.color.b;
          o++;
        }
      }
      if (o > groupStart) g.addGroup(groupStart, o - groupStart, gi);
      groupStart = o;
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

// Shared materials. `glow` emissive intensity is driven by the environment.
export const MAT = {
  vc: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: MATERIAL.flatShading }),
  glow: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: MATERIAL.flatShading, emissive: MATERIAL.glowColor, emissiveIntensity: 0 }),
};
export const MATS = [MAT.vc, MAT.glow];

export function meshFrom(geo, castShadow = true, receiveShadow = true) {
  const m = new THREE.Mesh(geo, MATS);
  m.castShadow = castShadow;
  m.receiveShadow = receiveShadow;
  return m;
}

export function shade(hex, f) {
  const c = new THREE.Color(hex);
  const hsl = {}; c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l * f)));
  return c.getHex();
}
