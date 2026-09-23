// TRACKLANDS visual design system: one place for world scale, palette,
// materials, lighting, animation timing and feedback intensity. Models, the
// renderer and the UI read from here instead of inventing their own values.
// UI colors/radii/shadows mirror the CSS custom properties in styles/main.css.

// ---------- scale (world units; one tile = 2) ----------
export const SCALE = {
  tile: 2,
  gauge: 0.44,               // wheel spacing across the rails
  lane: 0.34,                // lateral offset of each double-track lane
  vehicle: {
    width: 0.52,             // standard body width for every vehicle
    floor: 0.22,             // underframe top / body base
    roof: 0.72,              // standard roof line (passenger + boxcars)
    buffer: 0.2,             // buffer / coupler height (all vehicles)
    bogieInset: 0.32,        // bogie centre distance from vehicle end
    wheel: 0.1,              // bogie wheel radius
    glassInset: 0.265,       // side window plane (|z|)
  },
  building: { storey: 0.36, unit: 0.5, platformH: 0.18 },
  tree: { min: 0.8, max: 1.35 },
};

// ---------- palette ----------
// Warm, slightly desaturated diorama colors. Accents are saturated but used
// sparingly (lights, cargo, UI highlights).
export const PAL = {
  // terrain & nature
  grass: 0x7dab5a, grassDry: 0xa9b764, meadow: 0x8fbf63, forest: 0x3f7a45, forestDark: 0x2f5f3a,
  rock: 0x8d877c, rockDark: 0x6b665e, snow: 0xf1f4f6, sand: 0xdcc594, soil: 0x8a6a48, water: 0x4f9fc4, waterDeep: 0x3b7fa8,
  // built environment
  road: 0x5d5a57, pavement: 0xb9b2a4, concrete: 0xbdb8ae, concreteDark: 0x8f8a82, brick: 0xa8553f, brickDark: 0x7e3f30,
  plaster: 0xeee3cf, plasterWarm: 0xe8cfa8, timber: 0x8a5e3c, timberDark: 0x5e3f28, slate: 0x4b5561, roofRed: 0xb6523f,
  roofGrey: 0x5f6772, roofGreen: 0x4f7a5c, glass: 0x2d3b48, glassLit: 0xffd98a, metal: 0x8c939a, metalDark: 0x4a4f55,
  // railway
  rail: 0x8f959c, railDark: 0x5a6068, sleeperWood: 0x6b4c34, sleeperConcrete: 0xa7a39a, ballast: 0x9a948a, ballastDark: 0x7d776d,
  catenary: 0x4a4f55, signalRed: 0xe0463c, signalGreen: 0x3fcf6e, signalAmber: 0xf0b43c, platform: 0xcfc6b4, platformEdge: 0xf2d25a,
  // rolling stock
  underframe: 0x2a2c30, wheel: 0x1f2024, steel: 0x8c939a, brass: 0xd9b45a, headlight: 0xfff2c0, tailLight: 0xff5a4a,
  coal: 0x1e1e22, rust: 0x7a4a36, freightBrown: 0x8a5a3a, freightRed: 0x9a4a36, tankBlack: 0x2b2b2e, tankSilver: 0xc8cdd2,
  reeferWhite: 0xe8ecef, mailRed: 0xb04545, cream: 0xe8d9a8,
  // lights & fx
  lampWarm: 0xffc870, maglevGlow: 0x7ff0ff, spark: 0xbfe6ff, smoke: 0xd8d4cc, steam: 0xf4f4f2,
};

// ---------- materials ----------
export const MATERIAL = {
  flatShading: true,         // low-poly facets everywhere
  glowColor: PAL.lampWarm,   // emissive tint for windows/lamps at night
  glowNight: 0.85,           // emissive intensity at full night
};

// ---------- lighting ----------
export const LIGHT = {
  hemiSky: 0xdfefff, hemiGround: 0x8a7a5a, hemi: 1.2,
  sun: 2.0, sunColor: 0xffffff,
  shadowBias: -0.0006, shadowNormalBias: 0.03,
  shadowMap: { low: 512, medium: 1024, high: 2048 },
  fog: 0xe8f0f4,
};

// ---------- motion & feedback ----------
// Calm, readable: short UI transitions, gentle world feedback, no shaking by default.
export const MOTION = {
  fast: 0.12, base: 0.2, slow: 0.4,          // seconds (CSS: --t-fast/--t-base/--t-slow)
  switchThrow: 0.7,                           // switch blade travel
  celebrate: 1.2,                             // level-up / unlock banners
  floatText: 1.4,                             // +coins floating text lifetime
};
export const FEEDBACK = {
  shake: 0.12,               // max camera shake amplitude (0 when reduced motion)
  particles: 1,              // global particle multiplier (scaled by graphics profile)
  floatMax: 6,               // max simultaneous floating texts
};

// ---------- UI tokens (documented mirror of styles/main.css :root) ----------
export const UI = {
  ink: '#1f2a3a', ink2: '#4a5566', paper: '#f6f1e7', teal: '#2fb3a3', gold: '#e9b949', good: '#4caf6a', warn: '#e0a33a', bad: '#c75450',
  radius: { s: 8, m: 12, l: 18 }, touchMin: 44,
};

// Small helpers used by model code.
export function lerpHex(a, b, t) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
}
