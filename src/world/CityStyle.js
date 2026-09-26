// City archetypes and architecture families. Every town gets an archetype
// when the world is made (from its surroundings: water, mountains, the
// region, nearby industry, a tourist spot, and a bit of chance). The
// archetype is a bias, never a script: it shapes the street plan, the
// architecture family, which landmarks rise, how much the town travels and
// posts, which goods it asks for, how fast and how densely it grows, how
// much land costs and the council's policy, and how tall it may build
// (cap: the tallest common building; big cities' second centre may exceed it).
export const HEIGHT_ORDER = ['cottage', 'house', 'house2', 'townhouse', 'shop', 'apartment', 'block', 'office', 'tower', 'skyscraper'];
import { hashStr, tx, tz, idx, inMap } from '../util.js';

// plan: street pattern (see streetAt); family: architecture; pax/mail:
// traveller and mail production; req: cargo demand for growth (×);
// growth: building target (×); dens: density bias; land: land value (×,
// demolition compensation); policy: the council's default; rail: pull of
// passenger stations on density; landmarks: in order of the town's growth
export const ARCHETYPES = {
  historic:   { plan: 'radial',  family: 'traditional', pax: 1.0,  mail: 1.0, req: { GOODS: 1.1 }, growth: 0.95, dens: -0.45, land: 1.4, policy: 'heritage',   rail: 1.0, landmarks: ['cathedral', 'museum', 'monument'], cap: 'block' },
  industrial: { plan: 'grid4',   family: 'brick',       pax: 0.9,  mail: 0.9, req: { GOODS: 1.3, MACHINERY: 1.3, STEEL: 1.2, FOOD: 0.9 }, growth: 1.0, dens: -0.2, land: 0.8, policy: 'industrial', rail: 1.1, landmarks: ['stadium', 'clocktower', 'tv_tower'] },
  commuter:   { plan: 'grid3',   family: 'suburban',    pax: 1.2,  mail: 1.0, req: { PASSENGERS: 1.2 }, growth: 1.1, dens: -0.3, land: 1.0, policy: 'commuter',   rail: 1.3, landmarks: ['park', 'stadium', 'convention'] },
  tourism:    { plan: 'radial',  family: 'resort',      pax: 1.15, mail: 1.0, req: { FOOD: 1.2, PASSENGERS: 1.2 }, growth: 1.0, dens: 0.2, land: 1.3, policy: 'tourism', rail: 1.0, landmarks: ['museum', 'monument', 'park'], seasonal: true, cap: 'tower' },
  port:       { plan: 'linear',  family: 'waterfront',  pax: 1.0,  mail: 1.0, req: { FUEL: 1.2, GOODS: 1.1 }, growth: 1.0, dens: 0, land: 1.1, policy: 'industrial', rail: 1.0, landmarks: ['lighthouse', 'market_hall', 'museum'] },
  university: { plan: 'grid3',   family: 'traditional', pax: 1.3,  mail: 1.2, req: { PASSENGERS: 1.3, MAIL: 1.2 }, growth: 1.0, dens: 0, land: 1.1, policy: 'green', rail: 1.1, landmarks: ['university', 'museum', 'park'] },
  tech:       { plan: 'grid3',   family: 'glass',       pax: 1.1,  mail: 1.4, req: { GOODS: 1.2, MAIL: 1.3, MACHINERY: 0.8 }, growth: 1.05, dens: 0.6, land: 1.5, policy: 'growth', rail: 1.1, landmarks: ['convention', 'tv_tower', 'park'] },
  market:     { plan: 'organic', family: 'rural',       pax: 0.85, mail: 0.9, req: { FOOD: 0.7, WOOD: 1.1 }, growth: 0.9, dens: -0.5, land: 0.7, policy: 'green', rail: 1.0, landmarks: ['market_hall', 'park', 'monument'], cap: 'apartment' },
  mountain:   { plan: 'linear',  family: 'mountain',    pax: 0.9,  mail: 0.9, req: { FUEL: 1.2, LUMBER: 1.1 }, growth: 0.85, dens: -1.0, land: 0.8, policy: 'green', rail: 1.0, landmarks: ['monument', 'museum', 'park'], cap: 'block' },
  railway:    { plan: 'grid3',   family: 'brick',       pax: 1.1,  mail: 1.0, req: { STEEL: 1.2, PASSENGERS: 1.1 }, growth: 1.0, dens: 0, land: 0.9, policy: 'commuter', rail: 1.6, landmarks: ['clocktower', 'market_hall', 'stadium'] },
};
export const ARCHETYPE_IDS = Object.keys(ARCHETYPES);

// Architecture families: wall and roof palettes (subtle biases, blended with
// the region's roofs), and local building types that replace the common ones.
export const FAMILIES = {
  traditional: { walls: [0xf3e7d0, 0xefe0c4, 0xe9dcc8, 0xf6ecd8, 0xe4d2b8], roofs: [0x8a3f2f, 0x7a3a2c, 0x5a4a42], towers: [0xe6dccb, 0xd8ccb8], subs: { townhouse: 'terrace', house2: 'terrace' } },
  brick:       { walls: [0xc98a6a, 0xb8765a, 0xd09a7a, 0xa86a50, 0xc0846a], roofs: [0x4a4f55, 0x5a4a42, 0x6a3a30], towers: [0xb88a70, 0xc8a088], subs: { shop: 'factory', house2: 'terrace' } },
  suburban:    { walls: [0xf6f0e4, 0xeef3f6, 0xf7ecd8, 0xe6efe0, 0xf4e4e0], roofs: [0x6a6f76, 0x9a4a3a, 0x4a5a6a], towers: [0xe8e4dc, 0xdfe6ea], subs: { cottage: 'bungalow', house: 'bungalow' } },
  resort:      { walls: [0xfff4e0, 0xf6e0e0, 0xe0f0f4, 0xfff0c8, 0xe8f4e0], roofs: [0xc26a3f, 0x3f8a9a, 0xd08a4a], towers: [0xf4f0e8, 0xe8f0f4], subs: { apartment: 'hotel', block: 'hotel' } },
  waterfront:  { walls: [0xf4f6f8, 0xdfe8f0, 0xeef0e8, 0xd6e4ee, 0xf0ece0], roofs: [0x3f6e9a, 0x4a5a6a, 0x8a3f3a], towers: [0xdfe6ec, 0xe8ecf0], subs: { warehouse: 'boathouse', shop: 'boathouse' } },
  glass:       { walls: [0xe8eef2, 0xdfe6ea, 0xf0f2f4, 0xd8e0e8, 0xe6ebee], roofs: [0x5a6068, 0x6a7078, 0x4a5058], towers: [0xb8d0e0, 0xa8c4d8, 0xc8dce8], subs: { office: 'glasstower', tower: 'glasstower' } },
  rural:       { walls: [0xf0e0b8, 0xe8d4a8, 0xf4e8cc, 0xe0cca0, 0xf6ecd4], roofs: [0x9a5a3a, 0xb06a3a, 0x7a5a3a], towers: [0xe8dcc4, 0xe0d0b0], subs: { house2: 'farmhouse', townhouse: 'farmhouse' } },
  mountain:    { walls: [0xd8b890, 0xc8a478, 0xe0c8a0, 0xb89068, 0xe8d8c0], roofs: [0x4a3a32, 0x5a4a3a, 0x3f3f44], towers: [0xd8c8b0, 0xc8b8a0], subs: { house: 'chalet', house2: 'chalet', cottage: 'chalet', townhouse: 'chalet' } },
};

// Landmarks: one when a town becomes a town (stage 2), a second as a city
// (stage 4), a third as a metropolis (stage 6). Protected ones can never be
// demolished; the others need the heritage permit.
export const LANDMARKS = ['cathedral', 'museum', 'monument', 'stadium', 'clocktower', 'tv_tower', 'park', 'convention', 'lighthouse', 'market_hall', 'university'];
export const PROTECTED = new Set(['cathedral', 'monument', 'lighthouse']);
export const LANDMARK_STAGE = [2, 4, 6];

const d8 = (a, b) => Math.max(Math.abs(tx(a) - tx(b)), Math.abs(tz(a) - tz(b)));

// the archetype of a town from its surroundings (a weighted, seeded choice)
// (used: archetypes already given in the region, so a region gets variety)
export function pickArchetype(town, world, regions, index = 0, used = {}) {
  const W = world, x0 = town.x, z0 = town.z;
  let water = 0, mtn = 0, land = 0; // eslint-disable-line no-unused-vars
  const wdir = [0, 0], mdir = [0, 0];   // where the water and the mountains are (x, z)
  for (let dz = -6; dz <= 6; dz++) for (let dx = -6; dx <= 6; dx++) {
    const x = x0 + dx, z = z0 + dz;
    if (!inMap(x, z)) continue;
    const t = W.type[idx(x, z)];
    if (t === 1) { water++; wdir[0] += Math.sign(dx); wdir[1] += Math.sign(dz); } else if (t === 2) { mtn++; mdir[0] += Math.abs(Math.sign(dx)) * (Math.abs(dx) >= Math.abs(dz) ? 1 : 0); mdir[1] += Math.abs(Math.sign(dz)) * (Math.abs(dz) > Math.abs(dx) ? 1 : 0); } else land++;
  }
  const reg = regions[town.region] || {};
  const biome = reg.biome || 'green';
  const s = {};
  for (const k of ARCHETYPE_IDS) s[k] = 1;
  if (town.tourist) s.tourism += 10;
  if (water >= 18) { s.port += 3 + Math.min(3, water / 20); s.tourism += 0.5; }
  if (mtn >= 14) { s.mountain += 3 + Math.min(3, mtn / 16); s.tourism += 0.5; }
  const B = { green: { historic: 2, commuter: 2, university: 1.5, railway: 1 }, pine: { mountain: 1.5, market: 1.5, historic: 1 }, industrial: { industrial: 3, railway: 2, tech: 1 }, plains: { market: 2.5, railway: 1.5, commuter: 1 }, coast: { port: 2, tourism: 1.5, historic: 1 }, desert: { market: 1.5, railway: 2, tech: 1 }, alpine: { mountain: 2.5, tourism: 2 }, snow: { mountain: 2, industrial: 1, historic: 1 } }[biome] || {};
  for (const k in B) s[k] += B[k];
  const inds = (W.industries || []).filter((i) => Math.max(Math.abs(i.x - x0), Math.abs(i.z - z0)) <= 8).length;
  s.industrial += Math.min(2.5, inds * 0.5);
  if ((reg.level || 1) >= 8) { s.tech += 1.5; s.university += 1; }
  // the first town of the game is an all-rounder more often
  if (index === 0) { s.commuter += 2; s.historic += 1.5; s.railway += 1.5; }
  let sum = 0;
  const w = ARCHETYPE_IDS.map((k) => { const v = s[k] * s[k] * Math.pow(0.35, used[k] || 0); sum += v; return v; });
  let r = ((hashStr(`arch:${town.seed}:${town.name}`) % 10000) / 10000) * sum;
  // a linear town runs along the coast (water to one side) or along the
  // valley (mountains to both sides)
  for (let i = 0; i < w.length; i++) {
    r -= w[i];
    if (r > 0) continue;
    const kind = ARCHETYPE_IDS[i];
    const axis = kind === 'mountain' ? (mdir[0] >= mdir[1] ? 1 : 0) : Math.abs(wdir[0]) >= Math.abs(wdir[1]) ? 1 : 0;
    return { kind, axis };
  }
  return { kind: 'commuter', axis: 0 };
}

// is (dx, dz) from the centre a street in this plan? (axis: the long
// direction of a linear town: 0 along x, 1 along z)
export function streetAt(plan, dx, dz, axis = 0) {
  const d = Math.max(Math.abs(dx), Math.abs(dz));
  switch (plan) {
    case 'grid4': return dx % 4 === 0 || dz % 4 === 0;
    case 'radial': return dx === 0 || dz === 0 || d === 2 || d === 4 || (d >= 5 && (dx % 3 === 0 || dz % 3 === 0));
    case 'organic': return dx === 0 || dz === 0 || d === 3 || (d >= 4 && (dx % 4 === 0 || dz % 4 === 0));
    case 'linear': {
      const a = axis ? dz : dx, p = axis ? dx : dz;
      return p === 0 || (Math.abs(p) === 3 && Math.abs(a) <= 4) || (a % 3 === 0 && Math.abs(p) <= 4);
    }
    default: return dx % 3 === 0 || dz % 3 === 0;
  }
}
// distance from the centre for building order and radius: round towns for
// radial and organic plans, stretched along the axis for linear ones
export function planDist(plan, dx, dz, axis = 0) {
  if (plan === 'radial' || plan === 'organic') return Math.round(Math.hypot(dx, dz) * 0.92);
  if (plan === 'linear') { const a = axis ? dz : dx, p = axis ? dx : dz; return Math.max(Math.round(Math.abs(a) * 0.62), Math.abs(p) + (Math.abs(p) > 2 ? 1 : 0)); }
  return Math.max(Math.abs(dx), Math.abs(dz));
}
export { d8 };
