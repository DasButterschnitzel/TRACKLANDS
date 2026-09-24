// Procedural locomotive and wagon models. Each model is built facing +X with its
// base on the rail top at y=0 and its length matching the consist data
// (locoLen / WAGONS[id].len). Geometry is cached per appearance key.
//
// Design rules (see src/style.js SCALE.vehicle): every vehicle shares the body
// width, floor height, buffer/coupler height and roof line, so any consist
// lines up; each traction era has its own silhouette language:
//   steam    boiler, chimney, domes, cab, large spoked drivers with rods
//   diesel   rectangular hoods, big cab, engine grilles, roof fans, handrails
//   electric clean boxy bodies, pantographs, roof insulators, modern lights
//   hst      long aerodynamic nose, continuous window band, bellows, skirts
//   maglev   wrap-around skirt over the guideway, no visible wheels, glow line
import * as THREE from 'three';
import { ModelBuilder, shade } from '../core/ModelBuilder.js';
import { CARGO, LOCOS, WAGONS, locoLen } from '../config.js';
import { resolvePaint, paintKey } from './Livery.js';
import { SCALE, PAL } from '../style.js';

const VS = SCALE.vehicle;
const W = VS.width, FLOOR = VS.floor, ROOF = VS.roof, BUF = VS.buffer, GZ = VS.glassInset;
const DARK = PAL.underframe, WHEEL = PAL.wheel, STEEL = PAL.steel, GLASS = PAL.glass, BRASS = PAL.brass, LIGHT = PAL.headlight, RED_L = PAL.tailLight;
// Geometry cache. Wagon keys include cargo, fill level, livery and variant, so
// over a long session the set of combinations keeps growing: entries in use by
// train visuals are reference counted (retainGeometry / releaseGeometry) and
// at most IDLE_MAX unused ones are kept, the oldest being disposed.
const cache = new Map(); // key -> geometry
const refs = new Map(); // geometry -> count held by train visuals
const idle = new Map(); // key -> geometry, insertion order = least recently used first
const IDLE_MAX = 64;
function cached(key) {
  const g = cache.get(key);
  if (g && idle.has(key)) { idle.delete(key); idle.set(key, g); }
  return g;
}
function store(key, g) {
  g.userData.cacheKey = key;
  cache.set(key, g);
  idle.set(key, g);
  trimIdle();
  return g;
}
function trimIdle() {
  for (const [key, g] of idle) {
    if (idle.size <= IDLE_MAX) break;
    idle.delete(key);
    cache.delete(key);
    g.dispose();
  }
}
export function retainGeometry(g) {
  const key = g.userData.cacheKey;
  if (!key || cache.get(key) !== g) return;
  refs.set(g, (refs.get(g) || 0) + 1);
  idle.delete(key);
}
export function releaseGeometry(g) {
  const n = refs.get(g);
  if (!n) return;
  if (n > 1) { refs.set(g, n - 1); return; }
  refs.delete(g);
  idle.set(g.userData.cacheKey, g);
  trimIdle();
}
export const geometryCacheStats = () => ({ total: cache.size, idle: idle.size, used: refs.size });

// ---------- running gear ----------
// wheel with a lighter hub so it reads as a wheel from a distance
function wheel(mb, x, y, r, z, col = WHEEL, seg = 10) {
  mb.wheel(r, 0.05, seg, col, { x, y, z });
  mb.wheel(r * 0.42, 0.055, 6, STEEL, { x, y, z: z + Math.sign(z) * 0.004 });
}
function wheelset(mb, x, r = VS.wheel) { for (const z of [0.22, -0.22]) wheel(mb, x, r, r, z, WHEEL, 8); }
// bogie: side frames with axle boxes, 2 or 3 axles
function bogie(mb, x, axles = 2, col = DARK, r = VS.wheel) {
  const wb = axles === 3 ? 0.44 : 0.26;
  mb.box(wb + 0.24, 0.09, 0.08, col, { x, y: r - 0.02, z: 0.27 });
  mb.box(wb + 0.24, 0.09, 0.08, col, { x, y: r - 0.02, z: -0.27 });
  mb.box(0.18, 0.06, 0.46, col, { x, y: r + 0.02 });               // bolster
  for (let k = 0; k < axles; k++) {
    const ax = x - wb / 2 + (k * wb) / Math.max(1, axles - 1);
    wheelset(mb, ax, r);
    for (const z of [0.3, -0.3]) mb.box(0.06, 0.06, 0.03, shade(col, 1.3), { x: ax, y: r - 0.03, z });
  }
}
function bogiesAt(mb, L, axles = 2, col = DARK) { for (const s of [-1, 1]) bogie(mb, s * (L / 2 - VS.bogieInset - (axles === 3 ? 0.08 : 0)), axles, col); }
// buffers with round heads at the standard height
function buffers(mb, L, col = DARK) {
  for (const s of [-1, 1]) for (const z of [0.17, -0.17]) {
    mb.cyl(0.025, 0.025, 0.07, 6, col, { x: s * (L / 2 + 0.005), y: BUF, z, rz: Math.PI / 2, center: true });
    mb.cyl(0.042, 0.042, 0.015, 8, STEEL, { x: s * (L / 2 + 0.04), y: BUF, z, rz: Math.PI / 2, center: true });
  }
}
function bufferBeam(mb, L, col) { for (const s of [-1, 1]) mb.box(0.05, 0.1, W, col, { x: s * (L / 2 - 0.025), y: BUF - 0.05 }); }
function underframe(mb, L, col = DARK, beam = null) {
  mb.box(L - 0.04, 0.07, W - 0.04, col, { y: FLOOR - 0.07 });
  buffers(mb, L);
  if (beam != null) bufferBeam(mb, L, beam);
}
function headlights(mb, x, y, spread, dir = 1, red = false) {
  for (const z of spread ? [spread, -spread] : [0]) mb.box(0.03, 0.045, 0.07, red ? RED_L : LIGHT, { x: x + dir * 0.012, y, z, glow: true });
}
function sideWindows(mb, x0, x1, y, h, n, w, glassCol = GLASS, z = GZ) {
  for (let k = 0; k < n; k++) {
    const x = x0 + (k + 0.5) * ((x1 - x0) / n);
    mb.box(w, h, 0.02, glassCol, { x, y, z, glow: true });
    mb.box(w, h, 0.02, glassCol, { x, y, z: -z, glow: true });
  }
}
function grille(mb, x, y, w, h, z, col) {
  mb.box(w, h, 0.02, shade(col, 0.55), { x, y, z });
  const n = Math.max(2, Math.round(h / 0.035));
  for (let k = 0; k < n; k++) mb.box(w * 0.94, 0.012, 0.025, shade(col, 0.85), { x, y: y + (k + 0.5) * (h / n), z });
}
function handrail(mb, x0, x1, y, z) { mb.box(x1 - x0, 0.015, 0.015, STEEL, { x: (x0 + x1) / 2, y, z }); for (const x of [x0, (x0 + x1) / 2, x1]) mb.box(0.015, 0.1, 0.015, STEEL, { x, y: y - 0.1, z }); }
function roofFan(mb, x, y) { mb.cyl(0.075, 0.075, 0.03, 10, shade(DARK, 1.4), { x, y }); mb.cyl(0.055, 0.055, 0.032, 10, DARK, { x, y: y + 0.005 }); }
// pantograph: base, two arms forming a diamond-like Z, collector head
function pantograph(mb, x, y, raised = true, dir = 1) {
  mb.box(0.22, 0.03, 0.26, DARK, { x, y });
  for (const z of [0.1, -0.1]) mb.cyl(0.022, 0.022, 0.05, 6, 0xe8e2d4, { x: x - 0.08, y: y - 0.04, z });
  if (!raised) { mb.box(0.3, 0.02, 0.02, STEEL, { x: x + 0.02 * dir, y: y + 0.05 }); return; }
  const a = 0.62 * dir;
  mb.box(0.03, 0.26, 0.03, STEEL, { x: x + 0.05 * dir, y: y + 0.02, rz: a });
  mb.box(0.03, 0.24, 0.03, STEEL, { x: x - 0.02 * dir, y: y + 0.2, rz: -a });
  mb.box(0.07, 0.02, 0.36, STEEL, { x: x - 0.07 * dir, y: y + 0.31 });
}

// ---------- steam ----------
function drivers(mb, n, x0, x1, r, rodCol) {
  const xs = [];
  for (let k = 0; k < n; k++) xs.push(x0 + (k * (x1 - x0)) / Math.max(1, n - 1));
  for (const x of xs) for (const z of [0.23, -0.23]) {
    wheel(mb, x, r, r, z, WHEEL, 14);
    mb.box(0.07, 0.05, 0.02, shade(WHEEL, 1.5), { x: x - r * 0.45, y: r * 0.6, z: z + Math.sign(z) * 0.03 }); // counterweight
  }
  // coupling rods linking the drivers, at crank-pin height
  if (n > 1) for (const z of [0.285, -0.285]) mb.box(x1 - x0 + 0.08, 0.025, 0.018, rodCol, { x: (x0 + x1) / 2, y: r * 0.75, z });
  return xs;
}
function steamLoco(mb, m, L, P, detail) {
  const body = P.body, trim = P.trim;
  const big = m.kind === 'steam2';
  const tender = L >= 1.9;
  const tank = m.id === 'meadow_tank' || m.id === 'pioneer';
  const stream = m.id === 'silverline';
  const Le = tender ? L * 0.62 : L;                 // engine part
  const ex = L / 2 - Le / 2;                        // engine centre x
  const r = big ? 0.25 : m.id === 'pioneer' ? 0.19 : 0.21;  // boiler radius
  const accent = P.accent ?? (detail >= 2 ? BRASS : trim);
  const front = ex + Le / 2;
  const by = 0.3 + r;                               // boiler centre height
  const nDrive = m.id === 'pioneer' ? 2 : m.id === 'meadow_tank' ? 2 : big ? 4 : 3;
  const dr = big ? 0.17 : m.id === 'pioneer' ? 0.14 : 0.15;
  // frame + running board
  mb.box(Le, 0.08, 0.5, DARK, { x: ex, y: 0.2 });
  mb.box(Le * 0.8, 0.02, W + 0.06, shade(DARK, 1.2), { x: ex + Le * 0.05, y: 0.3 });
  const dx0 = ex - Le * 0.26, dx1 = ex + Le * (big ? 0.18 : 0.12);
  drivers(mb, nDrive, dx0, dx1, dr, STEEL);
  if (big || m.id === 'ironhill' || m.id === 'meadow_tank') wheelset(mb, front - 0.2, 0.09);         // leading truck
  if (m.id === 'meadow_tank' || big) wheelset(mb, ex - Le / 2 + 0.16, 0.09);                          // trailing truck
  // cylinders + main rod to the first driver
  for (const z of [0.27, -0.27]) {
    mb.hcyl(0.07, 0.24, 8, stream ? shade(body, 0.8) : DARK, { x: front - 0.3, y: 0.24, z });
    mb.box(front - 0.3 - dx1, 0.03, 0.02, STEEL, { x: (front - 0.3 + dx1) / 2, y: dr * 0.8 + 0.02, z: z + Math.sign(z) * 0.03 });
  }
  const bl = Le * 0.62, bx = ex + Le * 0.14;
  if (stream) {
    // streamlined casing: full-width shroud with a rounded nose and skirts
    const s0 = ex - Le / 2 + 0.46, s1 = front - 0.32, sc = (s0 + s1) / 2, sl = s1 - s0;
    mb.box(sl, 0.5, W + 0.04, body, { x: sc, y: 0.26 });
    mb.hcyl(r + 0.04, sl, 12, body, { x: sc, y: by });
    mb.taper(0.32, W + 0.04, by + r + 0.04 - 0.26, W * 0.46, 0.24, shade(body, 1.08), { x: front - 0.16, y: 0.26, yb1: 0.1 });
    mb.box(sl + 0.3, 0.04, W + 0.06, trim, { x: sc + 0.15, y: 0.46 });
    for (const z of [W / 2 + 0.03, -W / 2 - 0.03]) mb.box(sl, 0.14, 0.02, shade(body, 0.7), { x: sc, y: 0.24, z });
    headlights(mb, front - 0.01, 0.46, 0, 1);
  } else {
    mb.hcyl(r, bl, 12, body, { x: bx, y: by });
    for (const f of [0.38, -0.05, -0.36]) mb.hcyl(r + 0.012, 0.035, 12, accent, { x: bx + bl * f, y: by });   // boiler bands
    // smokebox + door
    mb.hcyl(r + 0.01, 0.2, 12, shade(DARK, 1.15), { x: front - 0.16, y: by });
    mb.cyl(r * 0.8, r * 0.8, 0.03, 12, shade(DARK, 1.4), { x: front - 0.05, y: by, rz: Math.PI / 2, center: true });
    // chimney, steam dome, sand dome
    const chH = (big ? 0.16 : 0.22) + detail * 0.02;
    mb.cyl(0.06, 0.05, chH, 8, DARK, { x: front - 0.17, y: by + r - 0.03 });
    mb.cyl(0.085, 0.065, 0.045, 8, DARK, { x: front - 0.17, y: by + r - 0.03 + chH - 0.02 });
    mb.cyl(0.075, 0.08, 0.1, 8, accent, { x: bx + bl * 0.02, y: by + r - 0.04 });
    mb.sphere(0.075, 0, accent, { x: bx + bl * 0.02, y: by + r + 0.06, sy: 0.6 });
    mb.cyl(0.06, 0.065, 0.07, 8, body, { x: bx + bl * 0.25, y: by + r - 0.04 });
    mb.sphere(0.06, 0, body, { x: bx + bl * 0.25, y: by + r + 0.03, sy: 0.6 });
    mb.cyl(0.02, 0.02, 0.07, 6, BRASS, { x: bx - bl * 0.3, y: by + r - 0.02 });                              // whistle
    headlights(mb, front - 0.02, by + r * 0.7, 0, 1);
    if (big) for (const z of [0.29, -0.29]) mb.box(0.34, 0.3, 0.02, shade(body, 0.75), { x: front - 0.26, y: by - 0.12, z }); // smoke deflectors
  }
  // buffer beam (livery trim, classic red when trim is dark)
  mb.box(0.05, 0.09, W, trim === 0x2b2b2b ? PAL.freightRed : trim, { x: front, y: BUF - 0.045 });
  if (m.id === 'ironhill') mb.taper(0.1, W, 0.16, W * 0.84, 0.04, DARK, { x: front + 0.02, y: 0.02 });   // pilot
  if (tank) for (const z of [0.25, -0.25]) mb.box(bl * 0.72, 0.28, 0.1, body, { x: bx - 0.05, y: 0.3, z });   // side tanks
  // cab with overhanging roof, spectacle and side windows
  const cabX = ex - Le / 2 + 0.24;
  mb.box(0.44, 0.5, W + 0.04, body, { x: cabX, y: 0.28 });
  mb.box(0.54, 0.05, W + 0.14, P.roof ?? shade(body, 0.65), { x: cabX, y: 0.78 });
  for (const z of [0.12, -0.12]) mb.cyl(0.05, 0.05, 0.02, 8, GLASS, { x: cabX + 0.225, y: 0.62, z, rz: Math.PI / 2, center: true, glow: true });
  for (const z of [GZ + 0.02, -GZ - 0.02]) mb.box(0.24, 0.15, 0.02, GLASS, { x: cabX + 0.02, y: 0.55, z, glow: true });
  mb.box(0.44, 0.03, W + 0.05, accent, { x: cabX, y: 0.44 });
  buffers(mb, L);
  if (tender) {
    const Lt = L - Le - 0.06, tx = -L / 2 + Lt / 2;
    mb.box(Lt, 0.08, 0.5, DARK, { x: tx, y: 0.2 });
    bogie(mb, tx - Lt * 0.26, 2, DARK, 0.09); bogie(mb, tx + Lt * 0.26, 2, DARK, 0.09);
    mb.box(Lt * 0.96, 0.42, W + 0.02, body, { x: tx, y: 0.26 });
    mb.box(Lt * 0.96, 0.035, W + 0.04, accent, { x: tx, y: 0.46 });
    mb.box(Lt * 0.66, 0.08, W - 0.08, PAL.coal, { x: tx + Lt * 0.1, y: 0.66 });
    mb.sphere(0.16, 0, 0x26262a, { x: tx + Lt * 0.12, y: 0.72, sx: 2.2, sy: 0.55, sz: 1.3 });
    mb.cyl(0.05, 0.05, 0.04, 8, DARK, { x: tx - Lt * 0.32, y: 0.68 });                                     // water filler
    headlights(mb, -L / 2 - 0.005, 0.46, 0.15, -1, true);
  } else {
    mb.box(0.24, 0.32, W, shade(body, 0.85), { x: -L / 2 + 0.13, y: 0.3 });                                 // bunker
    mb.box(0.18, 0.06, W - 0.12, PAL.coal, { x: -L / 2 + 0.13, y: 0.62 });
    headlights(mb, -L / 2 - 0.005, 0.46, 0.15, -1, true);
  }
}

// ---------- diesel ----------
function dieselLoco(mb, m, L, P, detail) {
  const body = P.body, trim = P.trim;
  const accent = P.accent ?? (detail >= 2 ? BRASS : trim);
  const heavy = m.id === 'cargoking';
  const cabUnit = m.id === 'metrorunner';
  underframe(mb, L, DARK, shade(DARK, 1.3));
  bogiesAt(mb, L, heavy ? 3 : 2);
  mb.box(L - 0.1, 0.03, W + 0.06, shade(DARK, 1.2), { y: FLOOR });                      // walkway
  if (cabUnit) {
    // passenger cab unit: full-width carbody with rounded nose at both ends
    const bodyL = L - 0.5;
    mb.box(bodyL, 0.5, W, body, { y: FLOOR + 0.02 });
    for (const s of [1, -1]) {
      mb.taper(0.25, W, 0.5, W * 0.8, 0.3, body, { x: s * (bodyL / 2 + 0.125), y: FLOOR + 0.02, yb1: 0.04, flip: s < 0 });
      mb.taper(0.12, W - 0.06, 0.1, W * 0.74, 0.1, GLASS, { x: s * (bodyL / 2 + 0.06), y: FLOOR + 0.43, yb1: -0.07, flip: s < 0, glow: true });
      headlights(mb, s * (L / 2 - 0.02), FLOOR + 0.12, 0.13, s, s < 0);
    }
    mb.box(bodyL + 0.3, 0.05, W + 0.02, accent, { y: FLOOR + 0.16 });
    sideWindows(mb, -bodyL / 2 + 0.1, bodyL / 2 - 0.1, FLOOR + 0.32, 0.1, 4, 0.14);
    for (const x of [-0.25, 0.1]) roofFan(mb, x, FLOOR + 0.52);
    grille(mb, -bodyL / 2 + 0.25, FLOOR + 0.06, 0.3, 0.1, GZ + 0.005, body); grille(mb, -bodyL / 2 + 0.25, FLOOR + 0.06, 0.3, 0.1, -GZ - 0.005, body);
    return;
  }
  // hood unit: short hood - cab - long hood (cab-forward for the heavy unit)
  const cabW = 0.34, cabX = heavy ? L / 2 - 0.3 : L / 2 - 0.55;
  const hoodW = W - 0.12, hoodH = heavy ? 0.4 : 0.36;
  const longX0 = -L / 2 + 0.1, longX1 = cabX - cabW / 2;
  mb.box(longX1 - longX0, hoodH, hoodW, body, { x: (longX0 + longX1) / 2, y: FLOOR + 0.02 });
  if (!heavy) { const sx0 = cabX + cabW / 2, sx1 = L / 2 - 0.1; mb.box(sx1 - sx0, hoodH * 0.8, hoodW, body, { x: (sx0 + sx1) / 2, y: FLOOR + 0.02 }); headlights(mb, sx1, FLOOR + hoodH * 0.8 - 0.05, 0.1, 1); }
  else { mb.taper(0.15, W, 0.44, W * 0.8, 0.34, body, { x: L / 2 - 0.055, y: FLOOR + 0.02, yb1: 0.04 }); headlights(mb, L / 2 + 0.02, FLOOR + 0.12, 0.14, 1); }
  // cab
  mb.box(cabW, 0.56, W, body, { x: cabX, y: FLOOR + 0.02 });
  mb.box(cabW + 0.06, 0.04, W + 0.04, P.roof ?? shade(body, 0.7), { x: cabX, y: FLOOR + 0.58 });
  for (const s of [1, -1]) mb.box(0.02, 0.13, W - 0.1, GLASS, { x: cabX + s * (cabW / 2 + 0.005), y: FLOOR + 0.38, glow: true });
  for (const z of [GZ, -GZ]) mb.box(cabW * 0.7, 0.12, 0.02, GLASS, { x: cabX, y: FLOOR + 0.38, z, glow: true });
  // livery stripe, grilles, fans, exhaust, handrails
  mb.box(L - 0.12, 0.04, W + 0.005, accent, { y: FLOOR + 0.12 });
  const nG = heavy ? 4 : 3;
  for (let k = 0; k < nG; k++) { const x = longX0 + 0.15 + k * ((longX1 - longX0 - 0.3) / Math.max(1, nG - 1)); grille(mb, x, FLOOR + 0.16, 0.14, hoodH - 0.22, hoodW / 2 + 0.005, body); grille(mb, x, FLOOR + 0.16, 0.14, hoodH - 0.22, -hoodW / 2 - 0.005, body); }
  for (let k = 0; k < (heavy ? 3 : 2); k++) roofFan(mb, longX0 + 0.18 + k * 0.22, FLOOR + hoodH + 0.02);
  mb.cyl(0.03, 0.03, 0.08 + detail * 0.02, 6, DARK, { x: longX1 - 0.12, y: FLOOR + hoodH + 0.02 });
  for (const z of [W / 2 + 0.02, -W / 2 - 0.02]) handrail(mb, longX0, longX1, FLOOR + 0.3, z);
  headlights(mb, -L / 2 + 0.08, FLOOR + hoodH - 0.05, 0.1, -1, true);
}

// ---------- electric ----------
function electricLoco(mb, m, L, P, detail) {
  const body = P.body, trim = P.trim;
  const accent = P.accent ?? (detail >= 2 ? BRASS : trim);
  const heavy = m.id === 'voltstream_e3';
  const sleek = m.id === 'falcon';
  underframe(mb, L, DARK, shade(DARK, 1.2));
  bogiesAt(mb, L, heavy ? 3 : 2);
  const H = heavy ? 0.56 : 0.52;
  const noseL = sleek ? 0.32 : 0.12;
  const bodyL = L - 2 * noseL - 0.02;
  mb.box(bodyL, H, W, body, { y: FLOOR });
  for (const s of [1, -1]) {
    const x = s * (bodyL / 2 + noseL / 2);
    if (sleek) {
      mb.taper(noseL, W, H, W * 0.86, H * 0.72, body, { x, y: FLOOR, flip: s < 0 });
      mb.taper(noseL * 0.8, W - 0.04, 0.13, W * 0.74, 0.13, GLASS, { x: x - s * noseL * 0.1, y: FLOOR + H - 0.12, yb1: -H * 0.224, flip: s < 0, glow: true });
    } else {
      mb.taper(noseL, W, H, W - 0.04, H - 0.06, body, { x, y: FLOOR, yb1: 0.02, flip: s < 0 });
      mb.box(0.02, 0.14, W - 0.1, GLASS, { x: s * (L / 2 - 0.02), y: FLOOR + H - 0.22, glow: true });
    }
    headlights(mb, s * (L / 2 - 0.01), FLOOR + 0.1, 0.15, s, s < 0);
    headlights(mb, s * (L / 2 - (sleek ? 0.2 : 0.03)), FLOOR + H - 0.05, 0, s, false);
  }
  // livery band + window band / louvre grilles
  mb.box(L - 0.06, 0.05, W + 0.005, accent, { y: FLOOR + 0.14 });
  if (sleek) { mb.box(bodyL * 0.94, 0.02, W + 0.006, shade(accent, 1.2), { y: FLOOR + 0.2 }); sideWindows(mb, -bodyL / 2 + 0.1, bodyL / 2 - 0.1, FLOOR + H - 0.2, 0.1, 5, 0.12); }
  else { const n = heavy ? 5 : 4; for (let k = 0; k < n; k++) { const x = -bodyL / 2 + 0.2 + k * ((bodyL - 0.4) / (n - 1)); grille(mb, x, FLOOR + 0.24, 0.16, 0.18, GZ, body); grille(mb, x, FLOOR + 0.24, 0.16, 0.18, -GZ, body); } }
  // roof: equipment, insulators, two pantographs (rear one raised)
  const ry = FLOOR + H;
  if (P.roof != null) mb.box(bodyL, 0.015, W - 0.02, P.roof, { y: ry - 0.005 });
  mb.box(bodyL * 0.5, 0.04, W * 0.6, shade(DARK, 1.3), { y: ry });
  for (const x of [-0.12, 0.12]) mb.cyl(0.025, 0.025, 0.05, 6, 0xe8e2d4, { x, y: ry + 0.02 });
  pantograph(mb, -L / 2 + 0.45, ry + 0.02, true, -1);
  pantograph(mb, L / 2 - 0.45, ry + 0.02, false, 1);
  if (detail >= 3) mb.box(bodyL * 0.4, 0.02, 0.02, BRASS, { y: FLOOR + 0.3, z: GZ + 0.01 });
}

// ---------- high speed power car ----------
function hstLoco(mb, m, L, P, detail) {
  const body = P.body, trim = P.trim;
  const accent = P.accent ?? (detail >= 2 ? BRASS : trim);
  const freight = m.id === 'novarail';
  const duck = m.id === 'vector_hst';
  const noseL = m.id === 'arrowline_300' || duck ? 0.9 : freight ? 0.55 : 0.7;
  const H = 0.5, x0 = -L / 2, xn = L / 2 - noseL;   // body from x0 to xn, nose from xn to L/2
  mb.box(L - 0.1, 0.06, W - 0.08, DARK, { y: FLOOR - 0.06 });
  bogie(mb, x0 + 0.34); bogie(mb, xn - 0.1);
  mb.box(xn - x0, H, W, body, { x: (x0 + xn) / 2, y: FLOOR });
  // nose in three tapered sections for a smooth low-poly profile
  const segs = duck ? [[0.35, 1, 0.94, 0, 0.9], [0.3, 0.94, 0.76, 0.02, 0.62], [0.25, 0.76, 0.5, 0.04, 0.3]]
    : [[0.4, 1, 0.9, 0, 0.8], [0.3, 0.9, 0.66, 0.02, 0.52], [0.3, 0.66, 0.36, 0.05, 0.22]];
  let x = xn, prevH = H, prevLift = 0;
  const tot = segs.reduce((a, s) => a + s[0], 0);
  for (const [f, w0, w1, lift, h1] of segs) {
    const len = noseL * (f / tot);
    mb.taper(len, W * w0, prevH, W * w1, H * h1, body, { x: x + len / 2, y: FLOOR + prevLift, yb1: lift - prevLift });
    x += len; prevH = H * h1; prevLift = lift;
  }
  // windscreen follows the first nose section
  const e1 = H * segs[0][4];
  mb.taper(noseL * (segs[0][0] / tot), W * 0.9, 0.11, W * 0.72, 0.11, GLASS, { x: xn + noseL * (segs[0][0] / tot) / 2, y: FLOOR + H - 0.1, yb1: e1 - H, glow: true });
  // skirt, livery flash along the nose, lights
  mb.box(L - 0.2, 0.08, W + 0.01, shade(body, 0.75), { x: -0.1, y: FLOOR - 0.02 });
  mb.box(xn - x0, 0.05, W + 0.006, accent, { x: (x0 + xn) / 2, y: FLOOR + 0.12 });
  mb.taper(noseL * 0.9, W + 0.006, 0.05, W * 0.4, 0.03, accent, { x: xn + noseL * 0.45, y: FLOOR + 0.12, yb1: 0.04 });
  headlights(mb, L / 2 - noseL * 0.2, FLOOR + 0.14, 0.12, 1);
  headlights(mb, x0, FLOOR + 0.2, 0.15, -1, true);
  if (!freight) sideWindows(mb, x0 + 0.15, xn - 0.05, FLOOR + H - 0.2, 0.1, 3, 0.14);
  else for (let k = 0; k < 3; k++) { grille(mb, x0 + 0.25 + k * 0.25, FLOOR + 0.2, 0.16, 0.18, GZ, body); grille(mb, x0 + 0.25 + k * 0.25, FLOOR + 0.2, 0.16, 0.18, -GZ, body); }
  // rear gangway bellows to the coaches
  mb.box(0.06, H - 0.08, W - 0.14, DARK, { x: x0 - 0.02, y: FLOOR + 0.04 });
  pantograph(mb, x0 + 0.4, FLOOR + H, true, -1);
  mb.box(0.4, 0.03, W * 0.5, shade(DARK, 1.3), { x: x0 + 0.85, y: FLOOR + H });
}

// ---------- maglev ----------
function maglevLoco(mb, m, L, P, detail) {
  const body = P.body, trim = P.trim;
  const accent = P.accent ?? (detail >= 2 ? 0x9ff6ff : trim);
  const needle = m.id === 'magna_m3';
  const noseL = needle ? 0.95 : 0.7, H = 0.5, x0 = -L / 2, xn = L / 2 - noseL;
  // guideway skirt wrapping down around the beam, no wheels
  mb.box(L * 0.94, 0.16, W * 0.72, DARK, { x: -noseL * 0.2, y: 0.02 });
  mb.box(L * 0.9, 0.03, 0.03, PAL.maglevGlow, { x: -noseL * 0.2, y: 0.08, z: W * 0.36 + 0.01, glow: true });
  mb.box(L * 0.9, 0.03, 0.03, PAL.maglevGlow, { x: -noseL * 0.2, y: 0.08, z: -W * 0.36 - 0.01, glow: true });
  mb.box(xn - x0, H, W + 0.04, body, { x: (x0 + xn) / 2, y: FLOOR - 0.04 });
  const segs = needle ? [[0.3, 1, 0.9, 0, 0.84], [0.35, 0.9, 0.6, 0.03, 0.5], [0.35, 0.6, 0.2, 0.08, 0.14]] : [[0.4, 1, 0.9, 0, 0.8], [0.35, 0.9, 0.62, 0.03, 0.46], [0.25, 0.62, 0.3, 0.07, 0.18]];
  let x = xn, prevH = H, prevLift = 0;
  const tot = segs.reduce((a, s) => a + s[0], 0);
  for (const [f, w0, w1, lift, h1] of segs) {
    const len = noseL * (f / tot);
    mb.taper(len, (W + 0.04) * w0, prevH, (W + 0.04) * w1, H * h1, body, { x: x + len / 2, y: FLOOR - 0.04 + prevLift, yb1: lift - prevLift });
    x += len; prevH = H * h1; prevLift = lift;
  }
  const m1 = H * segs[0][4];
  mb.taper(noseL * (segs[0][0] / tot), W * 0.94, 0.11, W * 0.76, 0.11, GLASS, { x: xn + noseL * (segs[0][0] / tot) / 2, y: FLOOR - 0.04 + H - 0.1, yb1: m1 - H, glow: true });
  mb.box(xn - x0, 0.08, 0.02, GLASS, { x: (x0 + xn) / 2, y: FLOOR + H - 0.2, z: W / 2 + 0.025, glow: true });
  mb.box(xn - x0, 0.08, 0.02, GLASS, { x: (x0 + xn) / 2, y: FLOOR + H - 0.2, z: -W / 2 - 0.025, glow: true });
  mb.box(xn - x0 + noseL * 0.6, 0.04, W + 0.05, accent, { x: (x0 + xn) / 2 + noseL * 0.3, y: FLOOR + 0.1 });
  headlights(mb, L / 2 - noseL * 0.15, FLOOR + 0.08, 0.1, 1);
  mb.box(0.06, H - 0.1, W - 0.12, DARK, { x: x0 - 0.02, y: FLOOR });
}

export function liveryColors(model, liveryId) {
  const p = resolvePaint(liveryId, model);
  return { body: p.body, trim: p.trim, paint: p };
}

// livery stripes along both sides at height y (accent colour)
function stripes(mb, len, y, P, x = 0) {
  const st = P.stripe || 'none';
  if (st === 'none') return;
  const c = P.accent ?? P.trim;
  if (st === 'line') mb.box(len, 0.025, W + 0.012, c, { x, y });
  else if (st === 'double') { mb.box(len, 0.02, W + 0.012, c, { x, y }); mb.box(len, 0.02, W + 0.012, c, { x, y: y + 0.05 }); }
  else mb.box(len, 0.075, W + 0.012, c, { x, y });
}

export function couplerGeometry() {
  const mb = new ModelBuilder();
  mb.box(0.22, 0.05, 0.07, 0x1c1d20, { y: -0.12 });
  mb.box(0.05, 0.08, 0.12, 0x2a2c30, { y: -0.14 });
  return mb.build();
}

// liv: a livery token (Livery.js) or a resolved paint object
export function locoGeometry(modelId, liv, detail = 0) {
  const model = LOCOS.find((m) => m.id === modelId) || LOCOS[0];
  const P = typeof liv === 'object' && liv ? liv : resolvePaint(liv, model);
  const key = `L:${modelId}:${paintKey(P)}:${detail}`;
  if (cache.has(key)) return cached(key);
  const mb = new ModelBuilder();
  const L = locoLen(model);
  switch (model.kind) {
    case 'steam': case 'steam2': steamLoco(mb, model, L, P, detail); break;
    case 'diesel': dieselLoco(mb, model, L, P, detail); stripes(mb, L - 0.2, FLOOR + 0.24, P); break;
    case 'electric': electricLoco(mb, model, L, P, detail); stripes(mb, L - 0.3, FLOOR + 0.2, P); break;
    case 'hst': hstLoco(mb, model, L, P, detail); stripes(mb, L - 1, FLOOR + 0.22, P, -0.45); break;
    default: maglevLoco(mb, model, L, P, detail); stripes(mb, L - 1, FLOOR + 0.2, P, -0.4);
  }
  return store(key, mb.build());
}

// ---------- wagons ----------
function frame(mb, L, eraKind, col = DARK) {
  if (eraKind === 'maglev') {
    mb.box(L - 0.04, 0.07, W - 0.04, col, { y: FLOOR - 0.07 });
    mb.box(L * 0.92, 0.16, W * 0.72, DARK, { y: 0.02 });
    mb.box(L * 0.88, 0.03, 0.03, PAL.maglevGlow, { y: 0.08, z: W * 0.36 + 0.01, glow: true });
    mb.box(L * 0.88, 0.03, 0.03, PAL.maglevGlow, { y: 0.08, z: -W * 0.36 - 0.01, glow: true });
  } else { underframe(mb, L, col); bogiesAt(mb, L); }
}
function gangway(mb, L, H = 0.46) { for (const s of [-1, 1]) mb.box(0.05, H - 0.08, W - 0.16, DARK, { x: s * (L / 2 + 0.01), y: FLOOR + 0.04 }); }
// heap of bulk cargo; fill 1..3
function heap(mb, L, w, y, col, fill) {
  if (!fill) return;
  const h = 0.05 + fill * 0.045;
  mb.box(L, 0.05, w, col, { y: y - 0.02 });
  mb.sphere(0.2, 1, col, { y: y + h * 0.25, sx: (L / 0.4) * 0.95, sy: h * 3, sz: (w / 0.4) * 1.05 });
  mb.sphere(0.05, 0, shade(col, 0.8), { x: L * 0.2, y: y + h * 0.9, sz: 1.2 });
  mb.sphere(0.04, 0, shade(col, 1.2), { x: -L * 0.15, y: y + h * 0.8 });
}
// deterministic per-vehicle weathering so a freight train is not a clone row
const variantTint = (c, v) => (v ? shade(c, [1, 0.92, 1.07, 0.86][v & 3]) : c);

// fill: 0 empty, 1..3 load level. cargoId: what the wagon currently carries.
// variant: 0..3 per-vehicle weathering for freight stock.
// paint: a resolved paint object, or (older callers) body colour + trim colour
export function wagonGeometry(wagonId, cargoId, fill, eraKind, paint, trimArg, variant = 0) {
  const w = WAGONS[wagonId] ? wagonId : 'boxcar';
  const P = typeof paint === 'object' && paint ? paint : { body: paint, trim: trimArg, accent: null, roof: null, stripe: 'none' };
  const liveryBody = P.body, trimCol = P.trim;
  const key = `W:${w}:${cargoId || ''}:${fill | 0}:${eraKind}:${paintKey(P)}:${variant | 0}`;
  if (cache.has(key)) return cached(key);
  const mb = new ModelBuilder();
  const L = WAGONS[w].len;
  const modern = eraKind === 'electric' || eraKind === 'hst' || eraKind === 'maglev';
  const cc = cargoId ? CARGO[cargoId].color : 0x999999;
  const loaded = fill > 0;
  const V = variant | 0;
  switch (w) {
    case 'coach':
    case 'commuter':
    case 'premium':
    case 'cab_car': {
      frame(mb, L, eraKind);
      const body = w === 'premium' ? shade(liveryBody, 0.62) : liveryBody;
      const trim = w === 'premium' ? BRASS : trimCol;
      const H = ROOF - FLOOR - 0.04;
      mb.box(L - 0.02, H, W, body, { y: FLOOR });
      mb.box(L - 0.02, 0.04, W + 0.006, trim, { y: FLOOR + 0.1 });
      if (modern || w === 'commuter') mb.box(L - 0.06, 0.06, W - 0.06, P.roof ?? shade(body, 0.8), { y: FLOOR + H });
      else { mb.cyl(0.3, 0.3, L - 0.04, 12, P.roof ?? shade(body, 0.62), { y: FLOOR + H - 0.03, rz: Math.PI / 2, center: true, sx: 0.28, sz: 0.87 }); }
      if (w !== 'premium') stripes(mb, L - 0.04, FLOOR + 0.2, P);
      if (w === 'premium') { sideWindows(mb, -L / 2 + 0.15, L / 2 - 0.15, FLOOR + 0.26, 0.15, 4, 0.24); mb.box(L * 0.9, 0.02, W + 0.008, BRASS, { y: FLOOR + H - 0.07 }); }
      else if (w === 'commuter') {
        sideWindows(mb, -L / 2 + 0.12, L / 2 - 0.12, FLOOR + 0.26, 0.13, 6, 0.13);
        for (const x of [-L / 4, L / 4]) for (const z of [GZ + 0.003, -GZ - 0.003]) mb.box(0.16, 0.36, 0.02, shade(body, 0.72), { x, y: FLOOR + 0.02, z });
        mb.box(L - 0.02, 0.06, W + 0.004, shade(trim, 0.9), { y: FLOOR + H - 0.12 });
      } else sideWindows(mb, -L / 2 + 0.12, L / 2 - 0.12, FLOOR + 0.26, 0.13, Math.round(L * 3.6), 0.15);
      if (w === 'cab_car') {
        mb.box(0.03, H - 0.06, W + 0.01, shade(body, 0.88), { x: L / 2 - 0.02, y: FLOOR + 0.03 });
        mb.box(0.02, 0.14, W - 0.12, GLASS, { x: L / 2, y: FLOOR + H - 0.2, glow: true });
        headlights(mb, L / 2 - 0.005, FLOOR + 0.1, 0.14, 1);
      } else gangway(mb, L, H);
      break;
    }
    case 'hs_coach': {
      // same cross-section, window band and livery flash as the HST power car
      frame(mb, L, eraKind);
      const H = 0.5;
      mb.box(L, H, W, liveryBody, { y: FLOOR });
      mb.box(L, 0.05, W + 0.006, trimCol, { y: FLOOR + 0.12 });
      mb.box(L - 0.12, 0.1, 0.02, GLASS, { y: FLOOR + H - 0.2, z: GZ, glow: true });
      mb.box(L - 0.12, 0.1, 0.02, GLASS, { y: FLOOR + H - 0.2, z: -GZ, glow: true });
      mb.box(L, 0.08, W + 0.01, shade(liveryBody, 0.75), { y: FLOOR - 0.02 });
      mb.box(L - 0.1, 0.04, W - 0.1, P.roof ?? shade(liveryBody, 0.85), { y: FLOOR + H });
      stripes(mb, L - 0.02, FLOOR + 0.22, P);
      gangway(mb, L, H);
      break;
    }
    case 'observation': {
      frame(mb, L, eraKind);
      const H = ROOF - FLOOR - 0.04;
      mb.box(L - 0.02, H, W, liveryBody, { y: FLOOR });
      mb.box(L - 0.02, 0.04, W + 0.006, trimCol, { y: FLOOR + 0.1 });
      mb.box(L - 0.06, 0.05, W - 0.04, shade(liveryBody, 0.8), { y: FLOOR + H });
      sideWindows(mb, -L / 2 + 0.1, 0, FLOOR + 0.26, 0.13, 3, 0.15);
      mb.taper(L * 0.5, W - 0.06, 0.22, W - 0.1, 0.16, GLASS, { x: L * 0.2, y: FLOOR + H, glow: true });
      mb.box(L * 0.5, 0.02, W - 0.04, shade(liveryBody, 0.65), { x: L * 0.2, y: FLOOR + H + 0.22 });
      gangway(mb, L, H);
      break;
    }
    case 'mail_van': {
      frame(mb, L, eraKind);
      const c = variantTint(PAL.mailRed, V & 1), H = ROOF - FLOOR - 0.04;
      mb.box(L - 0.04, H, W, c, { y: FLOOR });
      mb.box(L - 0.04, 0.04, W + 0.006, PAL.cream, { y: FLOOR + 0.24 });
      mb.box(L, 0.05, W + 0.04, shade(c, 0.6), { y: FLOOR + H });
      for (const z of [GZ + 0.005, -GZ - 0.005]) { mb.box(0.28, 0.34, 0.02, shade(c, 0.75), { y: FLOOR + 0.02, z }); mb.box(0.12, 0.07, 0.02, PAL.cream, { x: -L / 4, y: FLOOR + 0.34, z }); }
      mb.box(0.1, 0.04, 0.08, 0xe8c040, { x: L / 4, y: FLOOR + H + 0.04 });   // post horn plate
      break;
    }
    case 'boxcar': {
      frame(mb, L, eraKind);
      const c = variantTint(modern ? 0x7a3a2f : PAL.freightBrown, V), H = ROOF - FLOOR;
      mb.box(L - 0.03, H, W, c, { y: FLOOR });
      mb.box(L, 0.05, W + 0.04, shade(c, 0.65), { y: FLOOR + H });
      mb.box(L * 0.9, 0.03, 0.1, DARK, { y: FLOOR + H + 0.05 });   // roof walk
      for (const z of [GZ + 0.005, -GZ - 0.005]) {
        mb.box(0.4, H - 0.1, 0.02, shade(c, 0.8), { y: FLOOR + 0.04, z });
        mb.box(0.44, 0.03, 0.03, DARK, { y: FLOOR + H - 0.03, z });
        for (let k = 1; k < 4; k++) if (Math.abs(-L / 2 + k * L / 4) > 0.24) mb.box(0.02, H - 0.04, 0.025, shade(c, 0.7), { x: -L / 2 + k * L / 4, y: FLOOR + 0.02, z });
      }
      if (loaded) for (const z of [GZ + 0.012, -GZ - 0.012]) mb.box(0.1, 0.06, 0.01, cc, { x: L / 2 - 0.16, y: FLOOR + H - 0.14, z }); // cargo label
      break;
    }
    case 'reefer': {
      frame(mb, L, eraKind);
      const c = PAL.reeferWhite, H = ROOF - FLOOR;
      mb.box(L - 0.03, H, W, c, { y: FLOOR });
      mb.box(L, 0.05, W + 0.04, 0xc8d0d6, { y: FLOOR + H });
      mb.box(L - 0.03, 0.06, W + 0.006, 0x3f7ab8, { y: FLOOR + 0.28 });
      mb.box(0.18, 0.3, W - 0.06, 0x9aa4ac, { x: L / 2 - 0.12, y: FLOOR + H });     // cooling unit
      grille(mb, L / 2 - 0.12, FLOOR + H + 0.06, 0.14, 0.18, W / 2 - 0.02, 0x9aa4ac);
      for (const z of [GZ + 0.005, -GZ - 0.005]) mb.box(0.34, H - 0.14, 0.02, 0xd8dde2, { y: FLOOR + 0.04, z });
      break;
    }
    case 'timber': {
      frame(mb, L, eraKind);
      mb.box(L - 0.05, 0.05, W - 0.02, variantTint(0x6b4a33, V), { y: FLOOR + 0.02 });
      for (const x of [-L / 2 + 0.06, L / 2 - 0.06]) mb.box(0.05, 0.44, W - 0.02, DARK, { x, y: FLOOR + 0.04 }); // bulkheads
      for (const s of [-1, 1]) for (const x of [-L * 0.3, 0, L * 0.3]) mb.box(0.035, 0.38, 0.035, DARK, { x, y: FLOOR + 0.04, z: s * 0.24 });
      if (loaded) {
        if (cargoId === 'LUMBER') for (let k = 0; k < fill; k++) { mb.box(L * 0.82, 0.1, 0.42, shade(cc, 1 - k * 0.07), { y: FLOOR + 0.08 + k * 0.1 }); mb.box(0.02, 0.1, 0.43, 0xe8e0d0, { x: L * 0.2, y: FLOOR + 0.08 + k * 0.1 }); }
        else for (let r = 0; r < Math.min(2, fill); r++) for (let k = 0; k < 3 - r; k++) {
          const y = FLOOR + 0.15 + r * 0.14, z = -0.16 + k * 0.16 + r * 0.08;
          mb.hcyl(0.075, L * 0.86, 7, shade(cc, 1 - k * 0.08), { y, z });
          mb.hcyl(0.055, 0.01, 7, 0xd8b888, { x: L * 0.43, y, z });   // cut end
        }
        if (fill >= 3 && cargoId !== 'LUMBER') mb.hcyl(0.075, L * 0.86, 7, shade(cc, 0.9), { y: FLOOR + 0.43, z: 0 });
      }
      break;
    }
    case 'hopper':
    case 'coal_hopper':
    case 'ore_hopper': {
      frame(mb, L, eraKind);
      const base = w === 'coal_hopper' ? 0x2e3034 : w === 'ore_hopper' ? PAL.rust : (modern ? 0x5a6470 : 0x6a5040);
      const c = variantTint(base, V);
      const h = w === 'ore_hopper' ? 0.3 : w === 'coal_hopper' ? 0.46 : 0.4;
      for (const x of [-L / 4, L / 4]) mb.box(L * 0.22, 0.12, W - 0.2, shade(c, 0.8), { x, y: FLOOR - 0.12 });  // discharge bays
      mb.box(L - 0.06, h, W, c, { y: FLOOR });
      mb.box(L - 0.06, 0.04, W + 0.03, shade(c, 0.7), { y: FLOOR + h });
      for (let k = 1; k < 4; k++) for (const z of [GZ, -GZ]) mb.box(0.03, h, 0.02, shade(c, 0.7), { x: -L / 2 + k * (L / 4), y: FLOOR, z });
      if (loaded) heap(mb, L - 0.14, W - 0.06, FLOOR + h, cc, fill);
      break;
    }
    case 'tank': {
      frame(mb, L, eraKind);
      const fuel = cargoId === 'FUEL';
      const c = fuel ? PAL.tankSilver : modern ? 0xb8bec4 : variantTint(PAL.tankBlack, V & 1);
      mb.box(L - 0.1, 0.04, W - 0.1, DARK, { y: FLOOR });
      mb.hcyl(0.24, L * 0.9, 14, c, { y: FLOOR + 0.28 });
      for (const f of [-0.5, 0.5]) { mb.hcyl(0.245, 0.03, 14, shade(c, 0.7), { x: f * L * 0.88, y: FLOOR + 0.28 }); mb.sphere(0.24, 1, c, { x: f * L * 0.9, y: FLOOR + 0.28, sx: 0.25 }); }
      mb.hcyl(0.247, 0.12, 14, cargoId ? cc : 0x777777, { y: FLOOR + 0.28 });                  // cargo band
      if (fuel) mb.box(0.16, 0.08, 0.01, 0xe8a030, { x: -L / 4, y: FLOOR + 0.3, z: 0.245 });   // hazard plate
      mb.cyl(0.08, 0.08, 0.08, 8, DARK, { y: FLOOR + 0.5 });
      mb.box(L * 0.8, 0.02, 0.1, DARK, { y: FLOOR + 0.53, z: 0.1 });
      handrail(mb, -L * 0.35, L * 0.35, FLOOR + 0.5, 0.18);
      break;
    }
    case 'container': {
      frame(mb, L, eraKind, 0x3a3d42);
      mb.box(L - 0.04, 0.04, W - 0.02, 0x4a4f55, { y: FLOOR });
      for (const x of [-L / 2 + 0.1, L / 2 - 0.1]) for (const z of [0.22, -0.22]) mb.box(0.04, 0.04, 0.04, 0xd8a030, { x, y: FLOOR + 0.04, z }); // twist locks
      if (loaded) {
        const cols = [0x2f6fa8, 0xc0502f, 0x3a8a5a, 0xd8a030, 0x7a7f86, 0x8a3a6a];
        const n = fill >= 2 ? 2 : 1;
        const cl = (L * 0.92) / 2 - 0.02;
        for (let k = 0; k < n; k++) {
          const x = n === 1 ? 0 : (k === 0 ? -cl / 2 - 0.01 : cl / 2 + 0.01);
          const col = cols[(k + V + (cargoId || '').length) % cols.length];
          mb.box(cl, 0.44, 0.48, col, { x, y: FLOOR + 0.04 });
          for (let r = 0; r < 4; r++) mb.box(0.015, 0.42, 0.49, shade(col, 0.8), { x: x - cl / 2 + 0.06 + r * (cl - 0.12) / 3, y: FLOOR + 0.05 });
          mb.box(0.02, 0.38, 0.44, shade(col, 0.7), { x: x + cl / 2 - 0.005, y: FLOOR + 0.07 });   // doors
        }
        if (fill >= 3) { const col = cols[(4 + V) % cols.length]; mb.box(cl, 0.4, 0.48, col, { x: 0, y: FLOOR + 0.5 }); }
      }
      break;
    }
    case 'machinery_flat': {
      mb.box(L, 0.08, W, DARK, { y: FLOOR - 0.02 });
      bogie(mb, -L / 2 + 0.28, 3); bogie(mb, L / 2 - 0.28, 3);
      buffers(mb, L);
      mb.box(L * 0.5, 0.06, W, 0x4a4035, { y: 0.1 });   // depressed well
      for (const s of [-1, 1]) mb.box(0.06, 0.12, W, DARK, { x: s * L * 0.25, y: 0.1 });
      if (loaded) {
        const c = cargoId === 'STEEL' ? cc : 0xd8a030;
        if (cargoId === 'STEEL') for (let k = 0; k < fill + 1; k++) { mb.hcyl(0.1, 0.16, 12, shade(c, 1 - k * 0.06), { x: -0.3 + k * 0.2, y: 0.26, rz: 0 }); mb.hcyl(0.04, 0.17, 8, DARK, { x: -0.3 + k * 0.2, y: 0.26 }); } // coils
        else {
          mb.box(L * 0.42, 0.34, 0.44, c, { y: 0.16 });
          mb.box(0.24, 0.22, 0.3, shade(c, 0.85), { x: -0.1, y: 0.5 });
          mb.cyl(0.12, 0.12, 0.44, 8, 0x5a5f66, { x: 0.18, y: 0.4, rx: Math.PI / 2, center: true });
          for (const x of [-L * 0.2, L * 0.2]) mb.box(0.02, 0.3, 0.02, 0xb8a060, { x, y: 0.2, z: 0.24 });   // chains
        }
      }
      break;
    }
    case 'brake_van':
    case 'caboose': {
      frame(mb, L, eraKind);
      const c = w === 'caboose' ? 0xb0402f : 0x5a4a3f;
      const H = ROOF - FLOOR - 0.04;
      mb.box(L * 0.7, H, W - 0.02, c, { y: FLOOR });
      mb.box(L * 0.76, 0.05, W + 0.04, shade(c, 0.7), { y: FLOOR + H });
      sideWindows(mb, -L * 0.3, L * 0.3, FLOOR + 0.24, 0.12, 2, 0.12);
      for (const s of [-1, 1]) { mb.box(0.02, 0.24, W - 0.02, DARK, { x: s * L * 0.46, y: FLOOR + 0.02 }); mb.box(L * 0.14, 0.02, W - 0.02, 0x4a3a2a, { x: s * L * 0.42, y: FLOOR + 0.01 }); } // verandas
      if (w === 'caboose') { mb.box(0.3, 0.18, 0.4, c, { y: FLOOR + H + 0.04 }); mb.box(0.32, 0.03, 0.44, shade(c, 0.7), { y: FLOOR + H + 0.22 }); mb.box(0.24, 0.08, 0.02, GLASS, { y: FLOOR + H + 0.12, z: 0.205, glow: true }); }
      else mb.cyl(0.03, 0.03, 0.12, 6, DARK, { x: -0.1, y: FLOOR + H + 0.04 });
      headlights(mb, -L / 2, FLOOR + 0.3, 0.2, -1, true);
      break;
    }
    case 'flatbed':
    default: {
      frame(mb, L, eraKind);
      mb.box(L - 0.04, 0.06, W, variantTint(0x5a4a3a, V), { y: FLOOR });
      for (const s of [-1, 1]) for (const x of [-L * 0.35, 0, L * 0.35]) mb.box(0.03, 0.12, 0.03, DARK, { x, y: FLOOR + 0.06, z: s * 0.25 });
      if (loaded) {
        const y = FLOOR + 0.06;
        if (cargoId === 'LUMBER') for (let k = 0; k < fill; k++) mb.box(L * 0.85, 0.08, 0.44, shade(cc, 1 - k * 0.07), { y: y + k * 0.08 });
        else if (cargoId === 'STEEL') for (let k = 0; k < 3; k++) { mb.box(L * 0.85, 0.06, 0.12, cc, { y, z: -0.16 + k * 0.16 }); if (fill > 1) mb.box(L * 0.8, 0.06, 0.12, shade(cc, 0.9), { y: y + 0.06, z: -0.08 + (k % 2) * 0.16 }); } // plates / beams
        else if (cargoId === 'MACHINERY') { mb.box(0.6, 0.28, 0.4, cc, { y }); mb.cyl(0.12, 0.12, 0.3, 8, shade(cc, 0.8), { x: 0.3, y: y + 0.14, rz: Math.PI / 2, center: true }); mb.box(0.3, 0.2, 0.3, 0xd8a030, { x: -0.4, y }); }
        else if (cargoId === 'WOOD') for (let k = 0; k < 3; k++) mb.hcyl(0.075, L * 0.86, 7, shade(cc, 1 - k * 0.08), { y: y + 0.075, z: -0.16 + k * 0.16 });
        else { mb.box(L * 0.8, 0.2, 0.44, cc, { y }); mb.box(L * 0.82, 0.02, 0.46, shade(cc, 0.7), { y: y + 0.2 }); } // tarpaulin load
      }
      break;
    }
  }
  return store(key, mb.build());
}

export { THREE };
