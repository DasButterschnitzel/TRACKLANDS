// Deterministic world generation: terrain heights, water, mountains, regions,
// biomes, tree cover and placement of towns and industries.
import { N, RNG, Noise2D, idx, tx, tz, inMap, clamp, lerp, smoothstep, hashStr } from '../util.js';
import { REGIONS, BIOMES, WORLDGEN_VERSION } from '../config.js';
import { resolveTerrain, normalizeTerrain, climateBiome } from './Terrain.js';

export const T_LAND = 0, T_WATER = 1, T_MOUNTAIN = 2;

const PREFIX = ['Green', 'Oak', 'Pine', 'River', 'Stone', 'Meadow', 'Iron', 'West', 'High', 'Ash', 'Elm', 'Fox', 'Clear', 'Silver', 'Red', 'Cold', 'Sun', 'Mill', 'Bright', 'Rose', 'Hazel', 'Birch', 'Maple', 'Crow', 'Deer', 'Wolf', 'Lake', 'Glen', 'Amber', 'Copper', 'Frost', 'Gold', 'Hollow', 'Kings', 'Long', 'North', 'East', 'South', 'Thorn', 'Willow', 'Brook', 'Falcon', 'Harbor', 'Salt', 'Sand', 'Ember', 'Cliff', 'Moss'];
const SUFFIX = ['field', 'ridge', 'haven', 'ford', 'bridge', 'brook', 'vale', 'mere', 'ton', 'wick', 'stead', 'burn', 'holm', 'dale', 'gate', 'mouth', 'port', 'crest', 'wood', 'hill', 'moor', 'well', 'bury', 'side', 'hollow', 'watch', 'fall', 'cross'];

// opts.hmap: an imported height map (Uint8Array of N*N, 0 = sea, 255 = peak).
// It replaces the noise terrain: height, water and mountains follow the
// image; regions, biomes, trees and sites are generated as usual.
// opts.terrain (v4): a terrain preset and parameters (Terrain.js). Older
// generator versions ignore it; the classic parameters leave every step as
// it was, so a classic v4 world is the v3 world.
export function generateWorld(seed, version = WORLDGEN_VERSION, opts = {}) {
  const hmap = opts.hmap && opts.hmap.length === N * N ? opts.hmap : null;
  const seedNum = typeof seed === 'number' ? seed : hashStr(String(seed));
  const nBase = new Noise2D(seedNum + 1), nMtn = new Noise2D(seedNum + 2), nLake = new Noise2D(seedNum + 3);
  const nTree = new Noise2D(seedNum + 4), nWarp = new Noise2D(seedNum + 5), nMisc = new Noise2D(seedNum + 6);
  const rng = new RNG(seedNum + 7);
  const tp = resolveTerrain(version >= 4 ? opts.terrain : null);

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
  if (version >= 4) W.terrain = normalizeTerrain(opts.terrain);
  // each region's look under the chosen climate (classic: the region's own)
  W.biomes = REGIONS.map((r) => climateBiome(tp.climate, r.biome));
  W.tp = tp;

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
  const extra = tp.rivers > 2 || tp.passes ? terrainExtras(W, seedNum, tp, centers, s, nWarp) : null;
  // (terrain-aware presets widen seas and rivers on the larger maps)
  const big = tp.smart ? Math.max(1, s * 0.75) : 1;
  const rw = tp.riverWidth * (tp.smart ? Math.max(1, s * 0.6) : 1), nGeoV = new Noise2D(seedNum + 9);

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
    const b1 = BIOMES[W.biomes[r1]], b2 = BIOMES[W.biomes[r2]];
    W.biomeMix[i] = { a: W.biomes[r1], b: W.biomes[r2], w: wNear };
    let amp = lerp(b2.amp, b1.amp, wNear), mtn = lerp(b2.mtn, b1.mtn, wNear), lakes = lerp(b2.lakes, b1.lakes, wNear), treesP = lerp(b2.trees, b1.trees, wNear);
    if (tp.relief !== 1) amp *= tp.relief;
    if (tp.mountains !== 1) mtn = mtn * tp.mountains + Math.max(0, tp.mountains - 1) * 0.18;
    if (tp.lakes) lakes += tp.lakes;
    if (tp.forest) treesP += tp.forest;

    W.h0[i] = clamp(0.95 + amp * nBase.fbm(x * 0.07, z * 0.07, 4) * 1.4, 0.3, 3.2);
    const mn = nMtn.fbm(x * 0.1, z * 0.1, 4) * 0.5 + 0.5;
    const thr = 1.02 - mtn * 0.9;
    W.mtn[i] = mtn > 0 ? smoothstep(thr, thr + 0.14, mn) : 0;
    const rz = riverA.z + 3 * Math.sin(x * 0.16 + riverA.phase) + 1.5 * Math.sin(x * 0.41 + 1.3);
    const rx = riverB.x + 3 * Math.sin(z * 0.14 + riverB.phase) + 1.2 * Math.sin(z * 0.37);
    if (extra && W.mtn[i] > 0 && extra.pass[i] < 2.4) W.mtn[i] *= smoothstep(0.9, 2.4, extra.pass[i]);
    if (tp.valleys > 0) {
      // rivers wear valleys into the hills: lower ground, fewer peaks by the water
      let d = extra ? extra.river[i] : 99;
      if (tp.rivers >= 1 && x > 10 * s) d = Math.min(d, Math.abs(z - rz));
      if (tp.rivers >= 2 && z > 22 * s) d = Math.min(d, Math.abs(x - rx));
      W.mtn[i] *= lerp(1, smoothstep(1, 2 + 4 * tp.valleys, d), tp.valleys);
      W.h0[i] = Math.max(0.3, W.h0[i] - tp.valleys * 0.6 * (1 - smoothstep(0, 5, d)));
    }
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
    const cw = tp.coastWidth * big, coast = tp.coast;
    if (coast !== 'none' && (REGIONS[r1].biome === 'coast' || (x < 8 * s && z > 18 * s && z < 48 * s) || coast === 'ring' || coast === 'islands')) {
      const coastX = (4.5 + nMisc.noise(z * 0.12, 3.3) * 3) * cw;
      if (x < coastX) water = true;
    }
    if (coast === 'south' || coast === 'ring' || coast === 'islands') {
      if (N - 1 - z < (4.5 + nMisc.noise(x * 0.12, 7.7) * 3) * cw) water = true;
    }
    if (coast === 'ring' || coast === 'islands') {
      if (N - 1 - x < (4 + nMisc.noise(z * 0.12, 11.1) * 2.5) * cw || z < (3.5 + nMisc.noise(x * 0.12, 13.7) * 2) * cw) water = true;
    }
    // islands: the sea runs along the region borders
    if (coast === 'islands' && d2 - d1 < (2.6 + 1.2 * nMisc.noise(x * 0.2, z * 0.2 + 17)) * cw) water = true;
    // rivers
    if (tp.rivers >= 1 && x > 10 * s && Math.abs(z - rz) < 0.75 * rw) water = true;
    if (tp.rivers >= 2 && z > 22 * s && Math.abs(x - rx) < 0.7 * rw) water = true;
    if (extra && extra.river[i] < 0.72 * rw) water = true;
    if (water) { W.type[i] = T_WATER; W.mtn[i] = 0; } else if (W.mtn[i] > 0.35) W.type[i] = T_MOUNTAIN;

    const tn = nTree.fbm(x * 0.13 + 200, z * 0.13, 3) * 0.5 + 0.5;
    const dens = tn + treesP - 0.7;
    W.trees[i] = W.type[i] === T_WATER ? 0 : dens > 0.32 ? 3 : dens > 0.2 ? 2 : dens > 0.08 ? 1 : 0;
    if (W.type[i] === T_MOUNTAIN && W.mtn[i] > 0.7) W.trees[i] = Math.min(W.trees[i], 1);
  }

  placeSites(W, rng, version, tp, nGeoV);
  if (tp.smart) connectStart(W);
  if (tp.fields > 0) placeFields(W, seedNum, tp);
  computeHeights(W);
  return W;
}

// v4: extra rivers (from an edge inland, never into the starting region)
// and low passes between neighbouring regions, as distance fields
function terrainExtras(W, seedNum, tp, centers, s, nWarp) {
  const river = new Float32Array(N * N).fill(99), pass = new Float32Array(N * N).fill(99);
  const regionAt = (x, z) => {
    const wx = x + nWarp.fbm(x * 0.08, z * 0.08, 3) * 6, wz = z + nWarp.fbm(x * 0.08 + 40, z * 0.08 + 40, 3) * 6;
    let d1 = 1e9, r1 = 0;
    for (let r = 0; r < centers.length; r++) { const d = Math.hypot(wx - centers[r][0], wz - centers[r][1]); if (d < d1) { d1 = d; r1 = r; } }
    return r1;
  };
  const stamp = (arr, px, pz, R) => {
    for (let z = Math.max(0, Math.floor(pz - R)); z <= Math.min(N - 1, Math.ceil(pz + R)); z++) for (let x = Math.max(0, Math.floor(px - R)); x <= Math.min(N - 1, Math.ceil(px + R)); x++) {
      const d = Math.hypot(x + 0.5 - px, z + 0.5 - pz), i = idx(x, z);
      if (d < arr[i]) arr[i] = d;
    }
  };
  const r2 = new RNG(seedNum + 11);
  for (let k = 2; k < tp.rivers; k++) {
    const side = r2.int(0, 3), u0 = r2.range(0.2, 0.8) * N, phase = r2.range(0, 6.28), amp = r2.range(2, 4) * Math.max(1, s * 0.8), len = r2.range(0.45, 0.9) * N;
    let last = null;
    for (let t = 0; t < len; t += 0.5) {
      const u = u0 + amp * Math.sin(t * 0.15 + phase) + 1.2 * Math.sin(t * 0.4 + phase * 2);
      const px = side === 0 ? t : side === 1 ? N - t : u, pz = side === 2 ? t : side === 3 ? N - t : u;
      if (px < 0 || pz < 0 || px >= N || pz >= N) break;
      let start = false;
      for (const [ox, oz] of [[0, 0], [2.5, 0], [-2.5, 0], [0, 2.5], [0, -2.5]]) {
        const qx = Math.round(px + ox), qz = Math.round(pz + oz);
        if (inMap(qx, qz) && regionAt(qx, qz) === 0) { start = true; break; }
      }
      if (start) break;
      stamp(river, px, pz, 7);
      last = [px, pz];
    }
    // the source: a small lake where the river rises
    if (last) for (let z = Math.round(last[1]) - 1; z <= Math.round(last[1]) + 1; z++) for (let x = Math.round(last[0]) - 1; x <= Math.round(last[0]) + 1; x++) if (inMap(x, z)) river[idx(x, z)] = Math.min(river[idx(x, z)], 0.3);
  }
  if (tp.passes) {
    // every region reaches its two nearest neighbours through a low pass
    const segs = new Set();
    centers.forEach((c, a) => {
      centers.map((d, b) => [b, Math.hypot(d[0] - c[0], d[1] - c[1])]).filter(([b]) => b !== a).sort((p, q) => p[1] - q[1]).slice(0, 2).forEach(([b]) => segs.add(a < b ? `${a},${b}` : `${b},${a}`));
    });
    for (const key of segs) {
      const [a, b] = key.split(',').map(Number), A = centers[a], B = centers[b], L = Math.hypot(B[0] - A[0], B[1] - A[1]);
      for (let t = 0; t <= L; t += 0.5) stamp(pass, A[0] + (B[0] - A[0]) * t / L, A[1] + (B[1] - A[1]) * t / L, 3);
    }
  }
  return { river, pass };
}

// v4: every site of the starting region can be reached from the first town
// over land (the player starts with little money): a lake or river that cuts
// one off gets a ford
function connectStart(W) {
  const g = W.towns[0];
  if (!g) return;
  const land = (i) => W.type[i] !== 1;
  for (let round = 0; round < 8; round++) {
    const seen = new Uint8Array(N * N), q = [idx(g.x, g.z)];
    seen[q[0]] = 1;
    while (q.length) {
      const i = q.pop(), x = i % N, z = (i / N) | 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, zz = z + dz;
        if (!inMap(xx, zz)) continue;
        const j = idx(xx, zz);
        if (!seen[j] && land(j) && W.region[j] === 0) { seen[j] = 1; q.push(j); }
      }
    }
    const cut = [...W.towns, ...W.industries].find((q2) => q2.region === 0 && !seen[idx(q2.x, q2.z)] && !seen[idx(q2.x + 1, q2.z + 1)]);
    if (!cut) return;
    let best = null, bd = 1e9;
    for (let i = 0; i < N * N; i++) if (seen[i]) { const d = Math.hypot(i % N - cut.x, ((i / N) | 0) - cut.z); if (d < bd) { bd = d; best = i; } }
    if (best === null) return;
    const n = Math.max(1, Math.ceil(bd));
    for (let k = 0; k <= n; k++) {
      const x = Math.round(lerp(best % N, cut.x, k / n)), z = Math.round(lerp((best / N) | 0, cut.z, k / n));
      for (const [dx, dz] of [[0, 0], [1, 0], [0, 1]]) if (inMap(x + dx, z + dz)) { const j = idx(x + dx, z + dz); if (W.type[j] === 1) { W.type[j] = 0; W.mtn[j] = 0; W.trees[j] = 0; } }
    }
  }
}

// v4: farmland in parcels around towns and farms, on open flat land
const FARMS = new Set(['FARM', 'LIVESTOCK_FARM', 'DAIRY_FARM', 'ORCHARD']);
function placeFields(W, seedNum, tp) {
  W.fields = new Uint8Array(N * N);
  const nF = new Noise2D(seedNum + 12);
  const farms = W.industries.filter((f) => FARMS.has(f.type));
  const sites = [...W.towns, ...W.industries];
  for (let z = 1; z < N - 1; z++) for (let x = 1; x < N - 1; x++) {
    const i = idx(x, z);
    if (W.type[i] !== 0 || W.trees[i] || W.mtn[i] > 0.05) continue;
    if (sites.some((q) => x >= q.x - 1 && x <= q.x + 2 && z >= q.z - 1 && z <= q.z + 2)) continue;
    const town = W.towns.some((t) => { const d = Math.max(Math.abs(t.x - x), Math.abs(t.z - z)); return d >= 4 && d <= 9; });
    const farm = farms.some((f) => { const d = Math.max(Math.abs(f.x - x), Math.abs(f.z - z)); return d <= 5; });
    if (!town && !farm) continue;
    const v = nF.fbm(x * 0.22, z * 0.22, 2) * 0.5 + 0.5;
    if (v > tp.fields * 0.5 + (farm ? 0.3 : 0)) continue;
    W.fields[i] = 1 + (hashStr(`f${seedNum}:${x >> 1}:${z >> 1}`) % 3);
  }
}

// site rules for the newer industries (world generation v3)
const count = (W, x, z, r, fn) => { let n = 0; for (let dz = -r; dz <= r + 1; dz++) for (let dx = -r; dx <= r + 1; dx++) if (inMap(x + dx, z + dz) && fn(W.type[idx(x + dx, z + dz)], idx(x + dx, z + dz))) n++; return n; };
const landHere = (W, x, z) => [0, 1].every((dz) => [0, 1].every((dx) => W.type[idx(x + dx, z + dz)] !== 1));
const SITE_RULE = {
  // (hills: mountain tiles or rising ground)
  QUARRY: (W, x, z) => count(W, x, z, 3, (t, i) => t === 2 || W.mtn[i] > 0.18) >= 3,
  COPPER_MINE: (W, x, z) => count(W, x, z, 3, (t, i) => t === 2 || W.mtn[i] > 0.18) >= 3,
  FISHERY: (W, x, z) => count(W, x, z, 2, (t) => t === 1) >= 3 && landHere(W, x, z),
  SAND_PIT: (W, x, z, reg) => landHere(W, x, z) && (reg.biome === 'desert' || count(W, x, z, 3, (t) => t === 1) >= 2),
  CLAY_PIT: (W, x, z) => landHere(W, x, z) && count(W, x, z, 4, (t) => t === 1) >= 1,
  POWER_PLANT: (W, x, z) => landHere(W, x, z) && count(W, x, z, 5, (t) => t === 1) >= 1,
  ORCHARD: (W, x, z) => count(W, x, z, 1, (t, i) => t !== 0 || W.mtn[i] > 0.15) === 0,
  LIVESTOCK_FARM: (W, x, z) => count(W, x, z, 1, (t, i) => t !== 0 || W.mtn[i] > 0.15) === 0,
  DAIRY_FARM: (W, x, z) => count(W, x, z, 1, (t, i) => t !== 0 || W.mtn[i] > 0.15) === 0,
};

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

// distance from (x, z) to the segment [x0, z0, x1, z1]
export function segDist(x, z, [x0, z0, x1, z1]) {
  const dx = x1 - x0, dz = z1 - z0, L = dx * dx + dz * dz;
  const t = L ? Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / L)) : 0;
  return Math.hypot(x - (x0 + dx * t), z - (z0 + dz * t));
}

// v4 geology: ore, coal and oil lie in broad seams; mines and wells prefer them
const GEO = { MINE: 0, COPPER_MINE: 0, QUARRY: 0, COAL_MINE: 1, OIL_FIELD: 2 };

function placeSites(W, rng, version, tp = {}, nGeo = null) {
  const used = new Set(['Greenfield']);
  const sites = [];
  const farEnough = (x, z, d) => sites.every((s) => Math.max(Math.abs(s.x - x), Math.abs(s.z - z)) >= d);
  // v3: the tutorial line Greenfield -> forest stays free of other industries
  let corridor = null;

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
        if (version >= 3 && corridor && segDist(x + 0.5, z + 0.5, corridor) < 3.5) continue;
        return [x, z];
      }
    }
    return null;
  };

  // larger maps: more towns and industries per region (same on 64 tiles)
  const area = (W.scale || 1) ** 2;
  W.expect = [];
  // v4 terrain-aware towns: by a river, lake or coast, on flat open ground
  const townScore = (x, z) => {
    let sc = 0, wet = false, h = 0, h2 = 0, n = 0;
    for (let dz = -5; dz <= 5; dz++) for (let dx = -5; dx <= 5; dx++) {
      if (!inMap(x + dx, z + dz)) continue;
      const i = idx(x + dx, z + dz), d = Math.max(Math.abs(dx), Math.abs(dz));
      if (W.type[i] === 1 && d >= 2) wet = true;
      if (d <= 2) { if (W.type[i] === 2) sc -= 0.4; h += W.h0[i] + W.mtn[i] * 6.5; h2 += (W.h0[i] + W.mtn[i] * 6.5) ** 2; n++; }
    }
    const sd = Math.sqrt(Math.max(0, h2 / n - (h / n) ** 2));
    return sc + (wet ? 2.5 : 0) - sd * 3;
  };
  REGIONS.forEach((reg, r) => {
    const c = W.centers[r];
    const regB = W.biomes && W.biomes[r] !== reg.biome ? { ...reg, biome: W.biomes[r] } : reg;
    let nTowns = area > 1 ? Math.round(reg.towns * area * 0.75) : reg.towns;
    if (tp.towns && tp.towns !== 1) nTowns = Math.max(1, Math.round(nTowns * tp.towns));
    // v3: each region also gets its newer industries (construction, food,
    // chemistry, automotive, energy, high tech)
    const list = version >= 3 ? [...reg.industries, ...(reg.extra || [])] : reg.industries;
    const inds = area > 1 ? Array.from({ length: Math.round(list.length * area * 0.75) }, (_, k) => list[k % list.length]) : list.slice();
    if (tp.industries && tp.industries > 1) { const n0 = inds.length; for (let k = 0; k < Math.round(n0 * (tp.industries - 1)); k++) inds.push(list[(k * 3 + 1) % list.length]); }
    W.expect[r] = { towns: nTowns, industries: inds.length };
    // towns
    for (let t = 0; t < nTowns; t++) {
      let spot;
      if (r === 0 && t === 0) spot = [Math.round(c[0]), Math.round(c[1])];
      else if (tp.smart) {
        const cands = [];
        for (let k = 0; k < 8; k++) { const sp = findSpot(r, null, 9, 2, t === 0 ? [c[0], c[1], 5] : null); if (sp) cands.push(sp); }
        spot = cands.length ? cands.reduce((a, b) => (townScore(b[0], b[1]) > townScore(a[0], a[1]) ? b : a)) : findSpot(r, null, 6, 1, null);
      } else spot = findSpot(r, (x, z) => W.type[idx(x, z)] !== 1 || true, 9, 2, t === 0 ? [c[0], c[1], 5] : null) || findSpot(r, null, 6, 1, null);
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
        corridor = [W.towns[0].x, W.towns[0].z, spot[0] + 0.5, spot[1] + 0.5];
      } else if (tp.smart && nGeo && GEO[type] !== undefined && (spot = findSpot(r, (x, z) => nGeo.fbm(x * 0.07 + GEO[type] * 50, z * 0.07, 3) > 0.08 && (!SITE_RULE[type] || SITE_RULE[type](W, x, z, regB)) && (type !== 'MINE' && type !== 'COAL_MINE' || count(W, x, z, 4, (q) => q === 2) >= 1), 7, 1, null))) {
        // on its seam (the fallbacks below find the usual spot otherwise)
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
      } else if (version >= 3 && SITE_RULE[type]) {
        // where it makes sense: quarries and copper by the hills, fisheries on
        // the coast, sand by water or in the desert, clay by a river or lake,
        // farms and orchards on flat land, power stations by cooling water
        spot = findSpot(r, (x, z) => SITE_RULE[type](W, x, z, regB), 7, 1, null) || findSpot(r, (x, z) => SITE_RULE[type](W, x, z, regB), 4, 1, null);
      }
      if (!spot) spot = findSpot(r, null, 7, 1, null) || findSpot(r, null, 4, 1, null);
      if (!spot) return;
      if (type === 'PORT' || (version >= 3 && type === 'FISHERY')) {
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
