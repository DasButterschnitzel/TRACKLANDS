// Terrain presets and generator parameters (world generation v4, Phase 10).
// A preset is a named set of parameters; the advanced settings adjust any of
// them. 'classic' is the v3 world exactly: every parameter at its classic
// value is a no-op in the generator, so old saves and classic games rebuild
// the same world (pinned by tests/fixtures/worldgen-v3.json).
//
// relief     height amplitude (×)            mountains  mountain cover (×)
// lakes      lake share (+)                  rivers     number of rivers (0..5; classic 2)
// riverWidth river width (×)                 valleys    rivers carve valleys through hills (0..1)
// passes     low passes between neighbouring regions
// coast      west (classic) | none | south (west and south) | ring (all edges) | islands (ring, and the sea between the regions)
// coastWidth width of the sea (×)            forest     tree cover (+)
// fields     farmland around towns and farms (0..1)
// climate    mixed (classic) | temperate | cold | dry: the regions' look and plants
// towns      towns per region (×)            industries industries per region (×, at least the classic set)
// smart      terrain-aware sites: towns by rivers and coasts on flat ground,
//            mines and wells on matching geology
export const TERRAIN_DEFAULTS = {
  relief: 1, mountains: 1, lakes: 0, rivers: 2, riverWidth: 1, valleys: 0, passes: false,
  coast: 'west', coastWidth: 1, forest: 0, fields: 0, climate: 'mixed', towns: 1, industries: 1, smart: false,
};

// numeric ranges (and steps) for the advanced settings and for sanitising saves
export const TERRAIN_RANGES = {
  relief: [0.3, 2.5, 0.1], mountains: [0, 3, 0.1], lakes: [-0.2, 0.4, 0.02], rivers: [0, 5, 1], riverWidth: [0.6, 2, 0.1],
  valleys: [0, 1, 0.1], coastWidth: [0.5, 2.5, 0.1], forest: [-0.3, 0.4, 0.05], fields: [0, 1, 0.1], towns: [0.5, 2, 0.1], industries: [1, 2, 0.1],
};
export const TERRAIN_CHOICES = { coast: ['west', 'none', 'south', 'ring', 'islands'], climate: ['mixed', 'temperate', 'cold', 'dry'] };

// size: the map size the preset is made for (the dialog suggests it)
export const TERRAIN_PRESETS = {
  classic: {},
  countryside: { relief: 0.7, mountains: 0.3, lakes: 0.04, rivers: 3, forest: 0.05, fields: 0.6, climate: 'temperate', towns: 1.2, smart: true },
  plains: { relief: 0.35, mountains: 0, lakes: -0.06, rivers: 2, forest: -0.15, fields: 1, climate: 'dry', towns: 1.3, smart: true },
  highlands: { relief: 1.5, mountains: 1.5, rivers: 3, valleys: 0.6, passes: true, forest: 0.15, climate: 'temperate', towns: 0.9, smart: true },
  alpine: { relief: 2.1, mountains: 2.4, lakes: 0.06, rivers: 2, valleys: 1, passes: true, forest: 0.05, towns: 0.8, smart: true },
  riverlands: { relief: 0.8, rivers: 5, riverWidth: 1.6, valleys: 0.5, lakes: 0.02, fields: 0.5, towns: 1.2, smart: true },
  lakes: { relief: 0.8, lakes: 0.26, rivers: 2, forest: 0.1, fields: 0.2, smart: true },
  coastal: { coast: 'south', coastWidth: 1.6, rivers: 3, lakes: -0.04, fields: 0.3, smart: true },
  archipelago: { coast: 'islands', coastWidth: 1.3, relief: 0.8, rivers: 0, lakes: -0.04, smart: true },
  industrial: { relief: 0.6, mountains: 0.8, rivers: 2, forest: -0.15, towns: 1.2, industries: 1.5, fields: 0.2, smart: true },
  frontier: { climate: 'dry', relief: 1.1, mountains: 2.2, lakes: -0.15, rivers: 1, forest: -0.25, towns: 0.8, smart: true },
  snowland: { climate: 'cold', relief: 1.2, mountains: 1.3, lakes: 0.05, forest: -0.05, smart: true },
  continental: { size: 192, coast: 'ring', rivers: 5, relief: 1.2, mountains: 1.2, valleys: 0.5, passes: true, towns: 1.2, industries: 1.2, fields: 0.4, smart: true },
};
export const TERRAIN_IDS = Object.keys(TERRAIN_PRESETS);

// the regions' look under a climate (terrain, colours, plants, roofs)
const CLIMATE = {
  temperate: { snow: 'pine', desert: 'plains' },
  cold: { green: 'pine', plains: 'pine', pine: 'snow', coast: 'snow', desert: 'snow', alpine: 'snow' },
  dry: { green: 'plains', pine: 'plains', coast: 'plains', plains: 'desert', alpine: 'desert', snow: 'desert' },
};
export const climateBiome = (climate, biome) => (CLIMATE[climate] && CLIMATE[climate][biome]) || biome;

const snap = (v, [lo, hi, st]) => Math.round(Math.min(hi, Math.max(lo, v)) / st) * st;

// { preset, ...overrides } from a save or the dialog -> a clean spec (only
// the preset and the parameters that differ from it), never throws
export function normalizeTerrain(t) {
  if (!t || typeof t !== 'object') return { preset: 'classic' };
  const preset = TERRAIN_IDS.includes(t.preset) ? t.preset : 'classic';
  const base = { ...TERRAIN_DEFAULTS, ...TERRAIN_PRESETS[preset] };
  const out = { preset };
  for (const k of Object.keys(TERRAIN_DEFAULTS)) {
    if (!(k in t)) continue;
    let v = t[k];
    if (TERRAIN_RANGES[k]) { if (typeof v !== 'number' || !isFinite(v)) continue; v = +snap(v, TERRAIN_RANGES[k]).toFixed(2); }
    else if (TERRAIN_CHOICES[k]) { if (!TERRAIN_CHOICES[k].includes(v)) continue; }
    else if (typeof v !== 'boolean') continue;
    if (v !== base[k]) out[k] = v;
  }
  return out;
}

// the full parameter set the generator reads
export function resolveTerrain(t) {
  const n = normalizeTerrain(t);
  const { size, ...p } = TERRAIN_PRESETS[n.preset]; // eslint-disable-line no-unused-vars
  return { ...TERRAIN_DEFAULTS, ...p, ...n };
}

export const isClassic = (t) => { const n = normalizeTerrain(t); return n.preset === 'classic' && Object.keys(n).length === 1; };

// what a world looks like, for the preview and the validation: shares of
// land, water, mountains, forest and farmland, the relief, and what the
// straight lines between neighbouring towns cross (a rough construction-cost
// breakdown: flat, slopes, bridges, tunnels)
export function terrainStats(W, N) {
  const n = N * N;
  let water = 0, mtn = 0, forest = 0, fields = 0, hs = 0, hs2 = 0, land = 0;
  for (let i = 0; i < n; i++) {
    const t = W.type[i];
    if (t === 1) { water++; continue; }
    if (t === 2) mtn++;
    if (W.trees[i]) forest++;
    if (W.fields && W.fields[i]) fields++;
    land++; hs += W.tileH[i]; hs2 += W.tileH[i] * W.tileH[i];
  }
  const mean = hs / Math.max(1, land);
  const relief = Math.sqrt(Math.max(0, hs2 / Math.max(1, land) - mean * mean));
  const cross = { flat: 0, slope: 0, bridge: 0, tunnel: 0 };
  const T = W.towns;
  for (const a of T) {
    let best = null, bd = 1e9;
    for (const b of T) { if (b === a) continue; const d = Math.hypot(a.x - b.x, a.z - b.z); if (d < bd) { bd = d; best = b; } }
    if (!best) continue;
    const steps = Math.max(1, Math.round(bd));
    let prev = W.tileH[a.z * N + a.x];
    for (let s = 1; s <= steps; s++) {
      const x = Math.round(a.x + (best.x - a.x) * s / steps), z = Math.round(a.z + (best.z - a.z) * s / steps), i = z * N + x;
      const t = W.type[i];
      if (t === 1) cross.bridge++;
      else if (t === 2) cross.tunnel++;
      else if (Math.abs(W.tileH[i] - prev) > 0.35) cross.slope++;
      else cross.flat++;
      if (t !== 1) prev = W.tileH[i];
    }
  }
  const ct = cross.flat + cross.slope + cross.bridge + cross.tunnel || 1;
  const pct = (v) => Math.round(v * 100);
  const costIndex = (cross.flat + cross.slope * 2 + cross.bridge * 4.5 + cross.tunnel * 7) / ct;
  return {
    water: pct(water / n), mountain: pct(mtn / n), forest: pct(forest / n), fields: pct(fields / n), relief: +relief.toFixed(2),
    towns: W.towns.length, industries: W.industries.length,
    cross: { flat: pct(cross.flat / ct), slope: pct(cross.slope / ct), bridge: pct(cross.bridge / ct), tunnel: pct(cross.tunnel / ct) },
    cost: costIndex < 1.6 ? 'low' : costIndex < 2.4 ? 'medium' : 'high', costIndex: +costIndex.toFixed(2),
  };
}
