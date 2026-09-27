// Era bands for the look of the world (Phase 10). Every building, station,
// signal and road takes its look from the year it was built (or last
// renovated), so a town grows in layers: an old core, newer rings, the odd
// modern block where something was rebuilt. The bands are visual only; the
// traction eras (steam, diesel, ...) stay in Ledger.era() and the rosters.
//   early        before 1920   brick and timber, slate, gas lamps, semaphores
//   interwar     1920-1945     stucco, art deco, the first flats
//   postwar      1945-1970     concrete, flat roofs, slab blocks
//   late         1970-1995     brown brick and panels, office towers, colour lights
//   contemporary 1995-2025     white render, glass, steel
//   future       2025 on       pale facades, green roofs, glass towers
export const ERA_BANDS = ['early', 'interwar', 'postwar', 'late', 'contemporary', 'future'];
const UNTIL = [1920, 1945, 1970, 1995, 2025, Infinity];
export function bandOf(y) {
  if (!Number.isFinite(y)) return 2;
  for (let i = 0; i < UNTIL.length; i++) if (y < UNTIL[i]) return i;
  return UNTIL.length - 1;
}

// the tallest building a band puts up (HEIGHT_ORDER in CityStyle)
export const ERA_CAP = ['apartment', 'block', 'office', 'skyscraper', 'skyscraper', 'skyscraper'];
// types that appear only from a band on, and what stands there before
export const ERA_FROM = { glasstower: [3, 'office'], tower: [2, 'block'], skyscraper: [3, 'tower'], bungalow: [2, 'cottage'], mixeduse: [3, 'apartment'], tv_tower: [2, 'clocktower'], convention: [3, 'market_hall'], stadium: [1, 'park'] };

// wall and roof tints per band (blended into the town's architecture family)
export const ERA_PALETTE = [
  { walls: [0xa8634a, 0xb87a5a, 0x9a5a42, 0xc8b89a], roofs: [0x4a4a52, 0x5a4a42, 0x3f3f46], mix: 0.45 },
  { walls: [0xe8dcc0, 0xf0e4c8, 0xd8c8a8, 0xe6d6b0], roofs: [0x7a3f33, 0x5a4a42, 0x2a2f3a], mix: 0.35 },
  { walls: [0xcfcac0, 0xbdb8ae, 0xd8d2c4, 0xc4c0b8], roofs: [0x6a6f76, 0x5a5f66, 0x7a7f86], mix: 0.45 },
  { walls: [0xb8906a, 0xc8a078, 0xa88a6a, 0xd8c0a0], roofs: [0x5a4a3a, 0x6a5a48, 0x4a4f55], mix: 0.4 },
  { walls: [0xf2f2ee, 0xe8ecef, 0xf4efe6, 0xdfe6ea], roofs: [0x4a5058, 0x6a7078, 0x3a4048], mix: 0.35 },
  { walls: [0xf4f8f6, 0xe6f0ee, 0xeef2f6, 0xdaeae4], roofs: [0x5a8a5a, 0x4a7a5a, 0x6a9a6a], mix: 0.4 },
];

// station look per band: walls, roofs, gabled or flat buildings, modern fittings
export const ERA_STATION = [
  { wall: 0xb0664a, roof: 0x4a4f58, gable: true, modern: false },
  { wall: 0xe6d3a8, roof: 0x2a2f3a, gable: true, modern: false },
  { wall: 0xcac6bc, roof: 0x6a6f76, gable: false, modern: false },
  { wall: 0xb89a78, roof: 0x5a4a3a, gable: false, modern: false },
  { wall: 0xe8eef2, roof: 0x9aa3ac, gable: false, modern: true },
  { wall: 0xf2f6f4, roof: 0x4a8a6a, gable: false, modern: true },
];

// signals: semaphores until colour lights take over; old ones are replaced
// by 1995 at the latest
export const signalStyle = (built, year) => ((built ?? year) < 1960 && year < 1995 ? 'semaphore' : 'light');
// road surface: setts and gravel before asphalt
export const ROAD_COL = [0x8a8076, 0x7a746e, 0x6f6a66, 0x686561, 0x62605d, 0x5c5b59];

export const mixHex = (a, b, k) => {
  const r = ((a >> 16) & 255) * (1 - k) + ((b >> 16) & 255) * k, g = ((a >> 8) & 255) * (1 - k) + ((b >> 8) & 255) * k, bl = (a & 255) * (1 - k) + (b & 255) * k;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
};

// a building's era at the start of a game: towns have a history, the centre
// is older than the edge (d: rings from the centre, R: the town's radius)
export function historicYear(startYear, d, R, h) {
  const age = 8 + Math.round((1 - Math.min(1, d / Math.max(1, R))) * 60 + h * 35);
  return Math.max(1830, startYear - age);
}
