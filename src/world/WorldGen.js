// Deterministic world generation: terrain heights, water, mountains, regions,
// biomes, tree cover and placement of towns and industries.
import { N, RNG, Noise2D, idx, tx, tz, inMap, clamp, lerp, smoothstep, hashStr } from '../util.js';
import { REGIONS, BIOMES, WORLDGEN_VERSION } from '../config.js';

export const T_LAND = 0, T_WATER = 1, T_MOUNTAIN = 2;

const PREFIX = ['Green', 'Oak', 'Pine', 'River', 'Stone', 'Meadow', 'Iron', 'West', 'High', 'Ash', 'Elm', 'Fox', 'Clear', 'Silver', 'Red', 'Cold', 'Sun', 'Mill', 'Bright', 'Rose', 'Hazel', 'Birch', 'Maple', 'Crow', 'Deer', 'Wolf', 'Lake', 'Glen', 'Amber', 'Copper', 'Frost', 'Gold', 'Hollow', 'Kings', 'Long', 'North', 'East', 'South', 'Thorn', 'Willow', 'Brook', 'Falcon', 'Harbor', 'Salt', 'Sand', 'Ember', 'Cliff', 'Moss'];
const SUFFIX = ['field', 'ridge', 'haven', 'ford', 'bridge', 'brook', 'vale', 'mere', 'ton', 'wick', 'stead', 'burn', 'holm', 'dale', 'gate', 'mouth', 'port', 'crest', 'wood', 'hill', 'moor', 'well', 'bury', 'side', 'hollow', 'watch', 'fall', 'cross'];

// opts.hmap: an imported height map (Uint8Array of N*N, 0 = sea, 255 = peak).
// It replaces the noise terrain: height, water and mountains follow the
// image; regions, biomes, trees and sites are generated as usual.
export function generateWorld(seed, version = WORLDGEN_VERSION, opts = {}) {
  const hmap = opts.hmap && opts.hmap.length === N * N ? opts.hmap : null;
  const seedNum = typeof seed === 'number' ? seed : hashStr(String(seed));
  const nBase = new Noise2D(seedNum + 1), nMtn = new Noise2D(seedNum + 2), nLake = new Noise2D(seedNum + 3);
  const nTree = new Noise2D(seedNum + 4), nWarp = new Noise2D(seedNum + 5), nMisc = new Noise2D(seedNum + 6);
  const rng = new RNG(seedNum + 7);

  const W = {
    seed: seedNum, genVersion: version,
    type: new Uint8Array(N * N),
    region: new Uint8Array(N * N),
    h0: new Float32Array(N * N),
    mtn: new Float32Array(N * N),
    trees: new Uint8Array(N * N),
    biomeMix: new Array(N * N),
    heights: new Float32Array((N + 1) * (N + 1)),
    tileH: new Float32Array(N * N),
    towns: [], industries: [],
  };

  // Region centers jittered by seed (laid out for 64 tiles; larger maps
  // scale the layout, s = 1 on the classic map keeps it exactly)
  const s = N / 64;
  const centers = REGIONS.map((r, i) => {
    if (i === 0) return [r.center[0] * s, r.center[1] * s];
    return [r.center[0] * s + rng.range(-2, 2) * s, r.center[1] * s + rng.range(-2, 2) * s];
  });
  W.scale = s;
  W.centers = centers;

  const riverA = { phase: rng.range(0, 6.28), z: 20 * s + rng.range(-1.5, 1.5) };
  const riverB = { phase: rng.range(0, 6.28), x: 42 * s + rng.range(-1.5, 1.5) };

  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    const i = idx(x, z);
    const wx = x + nWarp.fbm(x * 0.08, z * 0.08, 3) * 6, wz = z + nWarp.fbm(x * 0.08 + 40, z * 0.08 + 40, 3) * 6;
    let d1 = 1e9, d2 = 1e9, r1 = 0, r2 = 0;
    for (let r = 0; r < centers.length; r++) {
      const dx = wx - centers[r][0], dz = wz - centers[r][1];
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < d1) { d2 = d1; r2 = r1; d1 = d; r1 = r; } else if (d < d2) { d2 = d; r2 = r; }
    }
    W.region[i] = r1;
    const wNear = 0.5 + 0.5 * smoothstep(0, 5, d2 - d1);
    const b1 = BIOMES[REGIONS[r1].biome], b2 = BIOMES[REGIONS[r2].biome];
    W.biomeMix[i] = { a: REGIONS[r1].biome, b: REGIONS[r2].biome, w: wNear };
    const amp = lerp(b2.amp, b1.amp, wNear), mtn = lerp(b2.mtn, b1.mtn, wNear), lakes = lerp(b2.lakes, b1.lakes, wNear), treesP = lerp(b2.trees, b1.trees, wNear);

    W.h0[i] = clamp(0.95 + amp * nBase.fbm(x * 0.07, z * 0.07, 4) * 1.4, 0.3, 3.2);
    const mn = nMtn.fbm(x * 0.1, z * 0.1, 4) * 0.5 + 0.5;
    const thr = 1.02 - mtn * 0.9;
    W.mtn[i] = mtn > 0 ? smoothstep(thr, thr + 0.14, mn) : 0;
    if (hmap) { const v = hmap[i] / 255; W.h0[i] = 0.3 + clamp((v - 0.1) / 0.9, 0, 1) * 2.9; W.mtn[i] = smoothstep(0.7, 0.9, v); }

    let water = false;
    const ln = nLake.fbm(x * 0.09 + 100, z * 0.09, 3);
    if (hmap) {
      water = hmap[i] < 26;
      if (water) { W.type[i] = T_WATER; W.mtn[i] = 0; } else if (W.mtn[i] > 0.35) W.type[i] = T_MOUNTAIN;
      const tn0 = nTree.fbm(x * 0.13 + 200, z * 0.13, 3) * 0.5 + 0.5, d0 = tn0 + treesP - 0.7;
      W.trees[i] = water ? 0 : d0 > 0.32 ? 3 : d0 > 0.2 ? 2 : d0 > 0.08 ? 1 : 0;
      if (W.type[i] === T_MOUNTAIN && W.mtn[i] > 0.7) W.trees[i] = Math.min(W.trees[i], 1);
      void ln;
      continue;
    }
    if (ln < -0.46 + lakes * 1.0) water = true;
    // coastal ocean along the west edge
    if (REGIONS[r1].biome === 'coast' || (x < 8 * s && z > 18 * s && z < 48 * s)) {
      const coastX = 4.5 + nMisc.noise(z * 0.12, 3.3) * 3;
      if (x < coastX) water = true;
    }
    // rivers
    const rz = riverA.z + 3 * Math.sin(x * 0.16 + riverA.phase) + 1.5 * Math.sin(x * 0.41 + 1.3);
    if (x > 10 * s && Math.abs(z - rz) < 0.75) water = true;
    const rx = riverB.x + 3 * Math.sin(z * 0.14 + riverB.phase) + 1.2 * Math.sin(z * 0.37);
    if (z > 22 * s && Math.abs(x - rx) < 0.7) water = true;
    if (water) { W.type[i] = T_WATER; W.mtn[i] = 0; } else if (W.mtn[i] > 0.35) W.type[i] = T_MOUNTAIN;

    const tn = nTree.fbm(x * 0.13 + 200, z * 0.13, 3) * 0.5 + 0.5;
    const dens = tn + treesP - 0.7;
    W.trees[i] = W.type[i] === T_WATER ? 0 : dens > 0.32 ? 3 : dens > 0.2 ? 2 : dens > 0.08 ? 1 : 0;
    if (W.type[i] === T_MOUNTAIN && W.mtn[i] > 0.7) W.trees[i] = Math.min(W.trees[i], 1);
  }

  placeSites(W, rng, version);
  computeHeights(W);
  return W;
}

function clearArea(W, cx, cz, r, keepWater = false) {
  for (let z = cz - r; z <= cz + r; z++) for (let x = cx - r; x <= cx + r; x++) {
    if (!inMap(x, z)) continue;
    const i = idx(x, z);
    if (W.type[i] === 1 && keepWater) continue;
    W.type[i] = 0; W.mtn[i] = 0;
  }
}

function lineClear(W, x0, z0, x1, z1) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0));
  for (let s = 0; s <= n; s++) {
    const x = Math.round(lerp(x0, x1, s / n)), z = Math.round(lerp(z0, z1, s / n));
    clearArea(W, x, z, 1);
  }
}

function lineIsClear(W, x0, z0, x1, z1) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0));
  for (let s = 0; s <= n; s++) {
    const x = Math.round(lerp(x0, x1, s / n)), z = Math.round(lerp(z0, z1, s / n));
    if (W.type[idx(x, z)] !== 0) return false;
  }
  return true;
}

function nameGen(rng, used) {
  for (let tries = 0; tries < 200; tries++) {
    const n = rng.pick(PREFIX) + rng.pick(SUFFIX);
    if (!used.has(n)) { used.add(n); return n; }
  }
  const n = 'Township ' + used.size; used.add(n); return n;
}

function regionInterior(W, x, z, r, rad) {
  for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) {
    const xx = x + dx, zz = z + dz;
    if (!inMap(xx, zz) || W.region[idx(xx, zz)] !== r) return false;
  }
  return true;
}

function placeSites(W, rng, version) {
  const used = new Set(['Greenfield']);
  const sites = [];
  const farEnough = (x, z, d) => sites.every((s) => Math.max(Math.abs(s.x - x), Math.abs(s.z - z)) >= d);

  const findSpot = (r, pred, minDist, rad, near) => {
    for (let pass = 0; pass < 3; pass++) {
      // v2: relaxing the spacing never goes below 3 tiles (v1 allowed 2: ports on town edges)
      const md = version >= 2 ? Math.max(3, minDist - pass * 2) : minDist - pass * 2;
      for (let a = 0; a < 400; a++) {
        let x, z;
        if (near) { x = Math.round(near[0] + rng.range(-near[2], near[2])); z = Math.round(near[1] + rng.range(-near[2], near[2])); }
        else { x = rng.int(3, N - 5); z = rng.int(3, N - 5); }
        if (x < 3 || z < 3 || x > N - 5 || z > N - 5) continue;
        if (W.region[idx(x, z)] !== r) continue;
        if (!regionInterior(W, x, z, r, pass === 0 ? 2 : 1)) continue;
        if (!farEnough(x, z, md)) continue;
        if (pred && !pred(x, z)) continue;
        return [x, z];
      }
    }
    return null;
  };

  // larger maps: more towns and industries per region (same on 64 tiles)
  const area = (W.scale || 1) ** 2;
  REGIONS.forEach((reg, r) => {
    const c = W.centers[r];
    const nTowns = area > 1 ? Math.round(reg.towns * area * 0.75) : reg.towns;
    const inds = area > 1 ? Array.from({ length: Math.round(reg.industries.length * area * 0.75) }, (_, k) => reg.industries[k % reg.industries.length]) : reg.industries;
    // towns
    for (let t = 0; t < nTowns; t++) {
      let spot;
      if (r === 0 && t === 0) spot = [Math.round(c[0]), Math.round(c[1])];
      else spot = findSpot(r, (x, z) => W.type[idx(x, z)] !== 1 || true, 9, 2, t === 0 ? [c[0], c[1], 5] : null) || findSpot(r, null, 6, 1, null);
      if (!spot) continue;
      const name = r === 0 && t === 0 ? 'Greenfield' : nameGen(rng, used);
      clearArea(W, spot[0], spot[1], 3);
      const town = { x: spot[0], z: spot[1], name, region: r, tourist: !!reg.tourist, seed: rng.int(1, 1e9) };
      W.towns.push(town);
      sites.push(town);
    }
    // industries
    inds.forEach((type, k) => {
      let spot = null;
      if (r === 0 && k === 0) {
        // tutorial forest: 9..12 tiles from Greenfield with a clear land corridor
        const g = W.towns[0];
        for (let a = 0; a < 300 && !spot; a++) {
          const ang = rng.range(0, Math.PI * 2), dist = rng.range(9, 12);
          const x = Math.round(g.x + Math.cos(ang) * dist), z = Math.round(g.z + Math.sin(ang) * dist);
          if (x < 4 || z < 4 || x > N - 6 || z > N - 6) continue;
          if (W.region[idx(x, z)] !== 0 || W.region[idx(x + 1, z + 1)] !== 0) continue;
          if (!farEnough(x, z, 6)) continue;
          if (!lineIsClear(W, g.x, g.z, x, z)) continue;
          spot = [x, z];
        }
        if (!spot) { spot = [g.x + 8, g.z - 3]; }
        lineClear(W, W.towns[0].x, W.towns[0].z, spot[0], spot[1]);
      } else if (type === 'PORT') {
        spot = findSpot(r, (x, z) => {
          let w = 0;
          for (let dz = -2; dz <= 3; dz++) for (let dx = -2; dx <= 3; dx++) if (inMap(x + dx, z + dz) && W.type[idx(x + dx, z + dz)] === 1) w++;
          return w >= 3 && W.type[idx(x, z)] !== 1 && W.type[idx(x + 1, z + 1)] !== 1 && W.type[idx(x + 1, z)] !== 1 && W.type[idx(x, z + 1)] !== 1;
        }, 6, 1, null);
      } else if (type === 'MINE' || type === 'COAL_MINE') {
        spot = findSpot(r, (x, z) => {
          for (let dz = -3; dz <= 4; dz++) for (let dx = -3; dx <= 4; dx++) if (inMap(x + dx, z + dz) && W.type[idx(x + dx, z + dz)] === 2) return true;
          return false;
        }, 7, 1, null);
      } else if (type === 'FOREST') {
        spot = findSpot(r, (x, z) => W.trees[idx(x, z)] >= 1, 7, 1, null);
      }
      if (!spot) spot = findSpot(r, null, 7, 1, null) || findSpot(r, null, 4, 1, null);
      if (!spot) return;
      if (type === 'PORT') {
        for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) { const i = idx(spot[0] + dx, spot[1] + dz); W.type[i] = 0; W.mtn[i] = 0; }
      } else clearArea(W, spot[0], spot[1], 2);
      clearArea(W, spot[0] + 1, spot[1] + 1, 0);
      const ind = { type, x: spot[0], z: spot[1], region: r };
      if (type === 'FOREST') for (let dz = -3; dz <= 4; dz++) for (let dx = -3; dx <= 4; dx++) {
        const xx = spot[0] + dx, zz = spot[1] + dz;
        if (inMap(xx, zz) && W.type[idx(xx, zz)] === 0 && Math.abs(dx - 0.5) + Math.abs(dz - 0.5) > 2) W.trees[idx(xx, zz)] = Math.max(W.trees[idx(xx, zz)], 2);
      }
      W.industries.push(ind);
      sites.push(ind);
    });
  });

  // make sure no tree sits right on a site
  for (const s of sites) for (let dz = -1; dz <= 2; dz++) for (let dx = -1; dx <= 2; dx++) {
    if (inMap(s.x + dx, s.z + dz)) W.trees[idx(s.x + dx, s.z + dz)] = 0;
  }
  // name industries after nearest town
  for (const ind of W.industries) {
    let best = null, bd = 1e9;
    for (const t of W.towns) { const d = Math.abs(t.x - ind.x) + Math.abs(t.z - ind.z); if (d < bd) { bd = d; best = t; } }
    ind.townName = best ? best.name : 'Frontier';
  }
}

function computeHeights(W) {
  const surf = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) {
    surf[i] = W.type[i] === 1 ? -0.75 : W.h0[i] + W.mtn[i] * 6.5;
  }
  for (let z = 0; z <= N; z++) for (let x = 0; x <= N; x++) {
    let s = 0, c = 0, water = false;
    for (let dz = -1; dz <= 0; dz++) for (let dx = -1; dx <= 0; dx++) {
      const xx = x + dx, zz = z + dz;
      if (!inMap(xx, zz)) continue;
      const i = idx(xx, zz);
      s += surf[i]; c++;
      if (W.type[i] === 1) water = true;
    }
    let h = c ? s / c : 0;
    if (water) h = Math.min(h, -0.42);
    W.heights[z * (N + 1) + x] = h;
  }
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    const H = W.heights;
    W.tileH[idx(x, z)] = (H[z * (N + 1) + x] + H[z * (N + 1) + x + 1] + H[(z + 1) * (N + 1) + x] + H[(z + 1) * (N + 1) + x + 1]) / 4;
  }
}

// Bilinear terrain height at world position (x,z in world units, TILE=2)
export function heightAt(W, wx, wz) {
  const gx = clamp(wx / 2, 0, N - 0.001), gz = clamp(wz / 2, 0, N - 0.001);
  const x0 = Math.floor(gx), z0 = Math.floor(gz), fx = gx - x0, fz = gz - z0;
  const H = W.heights, s = N + 1;
  const a = H[z0 * s + x0], b = H[z0 * s + x0 + 1], c = H[(z0 + 1) * s + x0], d = H[(z0 + 1) * s + x0 + 1];
  // match triangle split used by the terrain mesh (a-c-b / b-c-d)
  if (fx + fz < 1) return a + (b - a) * fx + (c - a) * fz;
  return d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
}

export function tileRegionIndex(W, i) { return W.region[i]; }
export { tx, tz };
