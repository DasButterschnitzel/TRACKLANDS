// Visual representation of the generated world: terrain diorama, water,
// instanced trees with wind sway, and cloud cover over locked regions.
import * as THREE from 'three';
import { N, TILE, WATER_LEVEL, idx, tx, tz, inMap, RNG, hashStr, lerp, clamp } from '../util.js';
import { BIOMES, REGIONS } from '../config.js';
import { BIOME_COLD } from './Environment.js';
import { ModelBuilder } from '../core/ModelBuilder.js';

const _c = new THREE.Color(), _c2 = new THREE.Color();

export class WorldView {
  constructor(game, W) {
    this.game = game;
    this.W = W;
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.uniforms = { uTime: { value: 0 }, uSnow: { value: 0 } };
    this.buildTerrain();
    this.buildWater();
    this.buildTable();
    this.buildTrees();
    this.buildClouds();
  }

  // ---------- terrain ----------
  tileColor(i, h, slope) {
    const W = this.W;
    const mix = W.biomeMix[i];
    const b1 = BIOMES[mix.a], b2 = BIOMES[mix.b];
    const hsh = (hashStr(`t${i}`) % 1000) / 1000;
    _c.set(hsh > 0.5 ? b1.grass : b1.grass2);
    _c2.set(hsh > 0.5 ? b2.grass : b2.grass2);
    _c.lerp(_c2, 1 - mix.w);
    const jitter = 0.94 + hsh * 0.1;
    _c.multiplyScalar(jitter);
    const type = W.type[i];
    if (type === 1) { _c.set(0xb9a57a).multiplyScalar(0.75); return _c; }
    // beaches
    let nearWater = false;
    for (let dz = -1; dz <= 1 && !nearWater; dz++) for (let dx = -1; dx <= 1; dx++) {
      const x = tx(i) + dx, z = tz(i) + dz;
      if (inMap(x, z) && W.type[idx(x, z)] === 1) { nearWater = true; break; }
    }
    if (nearWater && h < 0.45) _c.lerp(_c2.set(mix.a === 'snow' ? 0xdfe6ea : 0xe0cf9a), 0.75);
    const mt = W.mtn[i];
    if (mt > 0.05 || slope > 0.9) {
      const rock = mix.a === 'desert' ? 0xb8845a : 0x8f8a84;
      _c.lerp(_c2.set(rock), clamp(Math.max(mt * 1.4, (slope - 0.9) * 0.8), 0, 0.95));
    }
    const snowLine = mix.a === 'snow' ? 1.5 : mix.a === 'alpine' ? 3.4 : 4.6;
    if (h > snowLine) _c.lerp(_c2.set(0xf4f6f8), clamp((h - snowLine) * 0.9, 0, 0.95));
    if (!this.game.progression.regionUnlocked(W.region[i])) {
      const l = (_c.r + _c.g + _c.b) / 3;
      _c.lerp(_c2.setRGB(l, l, l * 1.08), 0.55).multiplyScalar(0.92);
    }
    return _c;
  }

  // Terrain is built chunk by chunk (32x32 tiles on maps larger than 64;
  // one chunk on the classic map, in the original tile order). Every chunk
  // is its own mesh so the renderer skips chunks outside the view; their
  // attributes are views into one buffer, so recolouring stays one pass.
  chunkSize() { return N > 64 ? 32 : N; }
  tileOrder() {
    if (this._order) return this._order;
    const C = this.chunkSize(), out = [];
    for (let cz = 0; cz < N; cz += C) for (let cx = 0; cx < N; cx += C) for (let z = cz; z < Math.min(N, cz + C); z++) for (let x = cx; x < Math.min(N, cx + C); x++) out.push(x, z);
    this._order = out;
    return out;
  }
  buildTerrain() {
    const W = this.W, H = W.heights, S = N + 1;
    const pos = new Float32Array(N * N * 6 * 3);
    const col = new Float32Array(N * N * 6 * 3);
    const cold = new Float32Array(N * N * 6);
    let o = 0, oc = 0;
    const order = this.tileOrder();
    for (let q = 0; q < order.length; q += 2) {
      const x = order[q], z = order[q + 1];
      const a = [x * TILE, H[z * S + x], z * TILE], b = [(x + 1) * TILE, H[z * S + x + 1], z * TILE];
      const c = [x * TILE, H[(z + 1) * S + x], (z + 1) * TILE], d = [(x + 1) * TILE, H[(z + 1) * S + x + 1], (z + 1) * TILE];
      for (const v of [a, c, b, b, c, d]) { pos[o++] = v[0]; pos[o++] = v[1]; pos[o++] = v[2]; }
      // how cold the tile is: snow settles in proportion (none on water)
      const mix = W.biomeMix[idx(x, z)];
      const cv = W.type[idx(x, z)] === 1 ? 0 : (BIOME_COLD[mix.a] ?? 0.6) * mix.w + (BIOME_COLD[mix.b] ?? 0.6) * (1 - mix.w);
      for (let k = 0; k < 6; k++) cold[oc++] = cv;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aCold', new THREE.BufferAttribute(cold, 1));
    g.computeVertexNormals();
    this.terrainGeo = g;
    this.recolorTerrain();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.snowShader(mat, true);
    const C = this.chunkSize(), per = C * C * 6;
    if (C === N) {
      this.terrain = new THREE.Mesh(g, mat);
      this.terrain.receiveShadow = true;
      this.terrain.name = 'terrain';
      this.group.add(this.terrain);
      this.chunks = [this.terrain];
    } else {
      // chunk meshes over views of the same arrays
      this.chunks = [];
      this.terrain = new THREE.Group();
      this.terrain.name = 'terrain';
      const nor = g.attributes.normal.array;
      for (let v0 = 0; v0 < N * N * 6; v0 += per) {
        const v1 = Math.min(N * N * 6, v0 + per);
        const cg = new THREE.BufferGeometry();
        cg.setAttribute('position', new THREE.BufferAttribute(pos.subarray(v0 * 3, v1 * 3), 3));
        cg.setAttribute('normal', new THREE.BufferAttribute(nor.subarray(v0 * 3, v1 * 3), 3));
        cg.setAttribute('color', new THREE.BufferAttribute(col.subarray(v0 * 3, v1 * 3), 3));
        cg.setAttribute('aCold', new THREE.BufferAttribute(cold.subarray(v0, v1), 1));
        cg.computeBoundingSphere();
        const m = new THREE.Mesh(cg, mat);
        m.receiveShadow = true;
        this.chunks.push(m);
        this.terrain.add(m);
      }
      this.group.add(this.terrain);
    }
    // diorama skirt
    const sp = [], sc = [];
    const earthTop = new THREE.Color(0x6b4f3a), earthBot = new THREE.Color(0x9a7a5a), water = new THREE.Color(0x3f8fb0);
    const base = -3.2;
    const pushQ = (p0, p1, p2, p3, c0, c1) => {
      sp.push(...p0, ...p1, ...p2, ...p0, ...p2, ...p3);
      sc.push(c0.r, c0.g, c0.b, c1.r, c1.g, c1.b, c1.r, c1.g, c1.b, c0.r, c0.g, c0.b, c1.r, c1.g, c1.b, c0.r, c0.g, c0.b);
    };
    const edges = [];
    for (let k = 0; k < N; k++) {
      edges.push([[k, 0], [k + 1, 0]], [[k + 1, N], [k, N]], [[0, k + 1], [0, k]], [[N, k], [N, k + 1]]);
    }
    for (const [[x0, z0], [x1, z1]] of edges) {
      const h0 = H[z0 * S + x0], h1 = H[z1 * S + x1];
      const A = [x0 * TILE, h0, z0 * TILE], B = [x1 * TILE, h1, z1 * TILE];
      pushQ(A, [A[0], base, A[2]], [B[0], base, B[2]], B, earthTop, earthBot);
      if (h0 < WATER_LEVEL || h1 < WATER_LEVEL) {
        const wa = [A[0], Math.max(h0, WATER_LEVEL), A[2]], wb = [B[0], Math.max(h1, WATER_LEVEL), B[2]];
        pushQ([A[0], WATER_LEVEL, A[2]], A, B, [B[0], WATER_LEVEL, B[2]], water, water);
        void wa; void wb;
      }
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    sg.setAttribute('color', new THREE.Float32BufferAttribute(sc, 3));
    sg.computeVertexNormals();
    this.skirt = new THREE.Mesh(sg, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    this.group.add(this.skirt);
  }

  recolorTerrain() {
    const W = this.W, g = this.terrainGeo;
    const col = g.attributes.color.array, pos = g.attributes.position.array;
    let o = 0;
    const order = this.tileOrder();
    for (let q = 0; q < order.length; q += 2) {
      const x = order[q], z = order[q + 1];
      const i = idx(x, z);
      for (let tri = 0; tri < 2; tri++) {
        const base = (o / 3) | 0;
        let hmin = 1e9, hmax = -1e9, hs = 0;
        for (let v = 0; v < 3; v++) { const y = pos[(base + v) * 3 + 1]; hmin = Math.min(hmin, y); hmax = Math.max(hmax, y); hs += y; }
        const c = this.tileColor(i, hs / 3, (hmax - hmin) / TILE);
        const shadeF = tri ? 0.97 : 1.0;
        for (let v = 0; v < 3; v++) { col[o++] = c.r * shadeF; col[o++] = c.g * shadeF; col[o++] = c.b * shadeF; }
      }
    }
    g.attributes.color.needsUpdate = true;
    if (this.chunks && this.chunks.length > 1) for (const m of this.chunks) m.geometry.attributes.color.needsUpdate = true;
  }

  buildWater() {
    const size = N * TILE;
    const g = new THREE.PlaneGeometry(size, size, 48, 48);
    g.rotateX(-Math.PI / 2);
    g.translate(size / 2, WATER_LEVEL, size / 2);
    const mat = new THREE.MeshPhongMaterial({ color: 0x4aa3c4, shininess: 70, specular: 0x9fd8ee, transparent: true, opacity: 0.86, flatShading: true });
    const U = this.uniforms;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = U.uTime;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.y += sin(uTime * 1.1 + position.x * 0.6) * 0.04 + cos(uTime * 0.8 + position.z * 0.5) * 0.04;');
    };
    this.water = new THREE.Mesh(g, mat);
    this.water.receiveShadow = true;
    this.water.renderOrder = 1;
    this.group.add(this.water);
  }

  buildTable() {
    const g = new THREE.CircleGeometry(420, 48);
    g.rotateX(-Math.PI / 2);
    g.translate(N * TILE / 2, -3.25, N * TILE / 2);
    this.table = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0xcfc6b6 }));
    this.table.receiveShadow = false;
    this.group.add(this.table);
  }

  // snow cover (Environment.snowCover): upward faces turn white; on the
  // terrain in proportion to how cold the tile is
  snowShader(mat, terrain) {
    const U = this.uniforms;
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = (sh, r) => {
      if (prev) prev(sh, r);
      sh.uniforms.uSnow = U.uSnow;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
varying float vSnow;
${terrain ? 'attribute float aCold;' : ''}`)
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
vSnow = smoothstep(0.55, 0.9, normalize(mat3(modelMatrix) * objectNormal).y)${terrain ? ' * aCold' : ' * 0.85'};`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uSnow;\nvarying float vSnow;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.95, 0.98), clamp(uSnow * vSnow * 1.15, 0.0, 0.92));');
    };
    mat.customProgramCacheKey = () => 'snow' + (terrain ? 't' : 'o');
    return mat;
  }

  swayMaterial() {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const U = this.uniforms;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = U.uTime;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
float ph = instanceMatrix[3].x * 0.6 + instanceMatrix[3].z * 0.45;
float sw = sin(uTime * 1.3 + ph) * 0.045 + sin(uTime * 2.7 + ph * 1.7) * 0.015;
transformed.x += sw * max(transformed.y, 0.0);
transformed.z += sw * 0.6 * max(transformed.y, 0.0);
#endif`);
    };
    return this.snowShader(mat, false);
  }

  buildTrees() {
    const W = this.W;
    const kinds = {
      oak: (mb) => { mb.cyl(0.05, 0.07, 0.35, 5, 0x7a5a3a); mb.sphere(0.32, 0, 0x5e9a48, { y: 0.55, sy: 0.9 }); mb.sphere(0.2, 0, 0x6aa852, { y: 0.78, x: 0.08 }); },
      pine: (mb) => { mb.cyl(0.04, 0.06, 0.25, 5, 0x6a4a33); mb.cone(0.3, 0.55, 6, 0x2f6a44, { y: 0.2 }); mb.cone(0.22, 0.45, 6, 0x3a7a4e, { y: 0.52 }); },
      snowpine: (mb) => { mb.cyl(0.04, 0.06, 0.25, 5, 0x6a4a33); mb.cone(0.3, 0.55, 6, 0x2f5a44, { y: 0.2 }); mb.cone(0.22, 0.45, 6, 0xeef4f6, { y: 0.52 }); },
      cactus: (mb) => { mb.cyl(0.07, 0.08, 0.6, 6, 0x5a8a4a); mb.cyl(0.04, 0.04, 0.22, 5, 0x5a8a4a, { x: 0.1, y: 0.25, rz: -0.9 }); mb.cyl(0.04, 0.04, 0.2, 5, 0x5a8a4a, { x: 0.16, y: 0.36 }); },
    };
    this.treeMeshes = {};
    const mat = this.swayMaterial();
    const lists = { oak: [], pine: [], snowpine: [], cactus: [] };
    this.treeAt = new Map();
    const rng = new RNG(W.seed + 99);
    for (let i = 0; i < N * N; i++) {
      const n = W.trees[i];
      if (!n) continue;
      const mix = W.biomeMix[i];
      let kind = BIOMES[mix.a].tree;
      if (W.type[i] === 2) kind = mix.a === 'desert' ? 'cactus' : mix.a === 'snow' ? 'snowpine' : 'pine';
      if (kind === 'oak' && rng.chance(0.15)) kind = 'pine';
      const count = kind === 'cactus' ? Math.min(n, 1) : n;
      for (let k = 0; k < count; k++) {
        const x = (tx(i) + 0.2 + rng.next() * 0.6) * TILE, z = (tz(i) + 0.2 + rng.next() * 0.6) * TILE;
        const h = this.heightAt(x, z);
        if (h < WATER_LEVEL + 0.1) continue;
        const s = rng.range(1.25, 1.85) * (W.type[i] === 2 ? 0.8 : 1);
        lists[kind].push({ i, x, y: h - 0.03, z, s, r: rng.range(0, 6.28), tint: rng.range(0.85, 1.1) });
      }
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (const kind in kinds) {
      const L = lists[kind];
      const mb = new ModelBuilder();
      kinds[kind](mb);
      const geo = mb.build();
      geo.clearGroups();
      const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, L.length + 200));
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.count = L.length;
      L.forEach((t, k) => {
        p.set(t.x, t.y, t.z); q.setFromAxisAngle(up, t.r); sc.set(t.s, t.s * rng.range(0.9, 1.15), t.s);
        m4.compose(p, q, sc);
        mesh.setMatrixAt(k, m4);
        mesh.setColorAt(k, _c.setRGB(t.tint, t.tint, t.tint));
        if (!this.treeAt.has(t.i)) this.treeAt.set(t.i, []);
        this.treeAt.get(t.i).push({ kind, k, x: t.x, z: t.z, s: t.s });
      });
      if (!L.length) mesh.setColorAt(0, _c.setRGB(1, 1, 1));
      mesh.instanceMatrix.needsUpdate = true;
      this.treeMeshes[kind] = mesh;
      this.group.add(mesh);
    }
  }

  heightAt(x, z) {
    const W = this.W;
    const gx = clamp(x / TILE, 0, N - 0.001), gz = clamp(z / TILE, 0, N - 0.001);
    const x0 = Math.floor(gx), z0 = Math.floor(gz), fx = gx - x0, fz = gz - z0;
    const H = W.heights, s = N + 1;
    const a = H[z0 * s + x0], b = H[z0 * s + x0 + 1], c = H[(z0 + 1) * s + x0], d = H[(z0 + 1) * s + x0 + 1];
    if (fx + fz < 1) return a + (b - a) * fx + (c - a) * fz;
    return d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
  }

  hasTrees(tile) { const l = this.treeAt.get(tile); return !!(l && l.length); }
  clearTrees(tile) {
    const l = this.treeAt.get(tile);
    if (!l || !l.length) return 0;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const { kind, k } of l) { this.treeMeshes[kind].setMatrixAt(k, zero); this.treeMeshes[kind].instanceMatrix.needsUpdate = true; }
    this.treeAt.delete(tile);
    this.game.cleared.add(tile);
    return l.length;
  }
  clearTreesMany(tiles) { for (const t of tiles) this.clearTrees(t); }

  // Vegetation corridor: remove trees on neighbouring tiles whose crowns reach
  // over the track path of `tile` (centre to each connected edge).
  clearCorridor(tile) {
    const net = this.game.net;
    if (!net.conn[tile]) return;
    const cx = (tx(tile) + 0.5) * TILE, cz = (tz(tile) + 0.5) * TILE;
    const segs = [];
    for (let d = 0; d < 8; d++) if (net.hasDir(tile, d)) segs.push([cx, cz, cx + DXS[d] * TILE / 2, cz + DZS[d] * TILE / 2]);
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const x = tx(tile) + dx, z = tz(tile) + dz;
      if (x < 0 || z < 0 || x >= N || z >= N) continue;
      const n = idx(x, z);
      const l = this.treeAt.get(n);
      if (!l || !l.length) continue;
      const keep = [];
      for (const tr of l) {
        let hit = false;
        for (const [ax, az, bx, bz] of segs) if (segDist(tr.x, tr.z, ax, az, bx, bz) < 0.62 + 0.3 * tr.s) { hit = true; break; }
        if (hit) { this.treeMeshes[tr.kind].setMatrixAt(tr.k, zero); this.treeMeshes[tr.kind].instanceMatrix.needsUpdate = true; } else keep.push(tr);
      }
      if (keep.length !== l.length) { if (keep.length) this.treeAt.set(n, keep); else { this.treeAt.delete(n); this.game.cleared.add(n); } }
    }
  }
  clearCorridorMany(tiles) { for (const t of tiles) this.clearCorridor(t); }

  // ---------- clouds over locked regions ----------
  buildClouds() {
    const W = this.W;
    const mb = new ModelBuilder();
    mb.sphere(1, 1, 0xffffff);
    const geo = mb.build(); geo.clearGroups();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: 0x8a90a8, emissiveIntensity: 0.45, color: 0xe8ecf6 });
    const list = [];
    const rng = new RNG(W.seed + 5);
    for (let z = 0; z < N; z += 2) for (let x = 0; x < N; x += 2) {
      const i = idx(x, z);
      const r = W.region[i];
      if (r === 0) continue;
      const bx = (x + 1) * TILE + rng.range(-0.8, 0.8), bz = (z + 1) * TILE + rng.range(-0.8, 0.8);
      const by = Math.max(W.tileH[i], 0) + 3.6 + rng.range(0, 1.2);
      // regions within 3 tiles: clouds bordering playable land stay small and low
      const near = new Set();
      for (let dz = -3; dz <= 4; dz++) for (let dx = -3; dx <= 4; dx++) { const xx = x + dx, zz = z + dz; if (xx >= 0 && zz >= 0 && xx < N && zz < N && W.region[idx(xx, zz)] !== r) near.add(W.region[idx(xx, zz)]); }
      list.push({ r, x: bx, y: by, z: bz, s: rng.range(1.5, 2.2), sy: rng.range(0.4, 0.55), phase: rng.range(0, 6.28), near: [...near] });
    }
    this.cloudList = list;
    this.clouds = new THREE.InstancedMesh(geo, mat, list.length);
    this.clouds.frustumCulled = false;
    this.cloudAnim = new Map(); // region -> t
    this.updateClouds(0);
    this.group.add(this.clouds);
  }

  updateClouds(time) {
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    const prog = this.game.progression;
    let k = 0;
    for (const c of this.cloudList) {
      let s = c.s, y = c.y;
      const unlocked = prog.regionUnlocked(c.r);
      if (unlocked) {
        const a = this.cloudAnim.get(c.r);
        if (a == null) continue;
        const f = clamp(a - ((c.phase * 13) % 1) * 0.6, 0, 1);
        if (f >= 1) continue;
        s *= 1 - f; y += f * 6;
      }
      // keep the view onto playable land clear
      if (c.near.some((nr) => prog.regionUnlocked(nr))) { s *= 0.62; y -= 1.4; }
      const cam = this.game.camera;
      if (cam && cam.viewSize < 22) {
        const d = Math.hypot(c.x - cam.target.x, c.z - cam.target.z);
        const rad = cam.viewSize * 0.9;
        if (d < rad) s *= 0.25 + 0.75 * (d / rad);
      }
      p.set(c.x + Math.sin(time * 0.15 + c.phase) * 0.3, y + Math.sin(time * 0.3 + c.phase) * 0.15, c.z);
      q.identity();
      sc.set(s, s * c.sy, s);
      m4.compose(p, q, sc);
      this.clouds.setMatrixAt(k++, m4);
    }
    this.clouds.count = k;
    this.clouds.instanceMatrix.needsUpdate = true;
  }

  revealRegion(r) {
    this.cloudAnim.set(r, 0);
    this.recolorTerrain();
  }

  update(dt, time) {
    this.uniforms.uTime.value = time;
    let anim = false;
    for (const [r, v] of this.cloudAnim) {
      if (v < 2) { this.cloudAnim.set(r, v + dt * 0.55); anim = true; }
    }
    this._ct = (this._ct || 0) + dt;
    if (anim || this._ct > 0.1) { this._ct = 0; this.updateClouds(time); }
  }
}

export { lerp, REGIONS };

const DXS = [1, 1, 0, -1, -1, -1, 0, 1], DZS = [0, 1, 1, 1, 0, -1, -1, -1];
function segDist(px, pz, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az, wx = px - ax, wz = pz - az;
  const t = Math.max(0, Math.min(1, (wx * vx + wz * vz) / (vx * vx + vz * vz || 1)));
  return Math.hypot(px - (ax + vx * t), pz - (az + vz * t));
}
