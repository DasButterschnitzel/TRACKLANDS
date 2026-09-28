// Airports and ports by era, size and specialization (Phase 12). One
// generated geometry per (family, size, variant), cached and shared by every
// airport or port that looks alike (instanced). Families come from
// VisualEra: airports pioneer / midcentury / jet / modern / future, ports
// early / industrial / container / modern. The footprint and the operation
// are the same in every era: the look only.
import { ModelBuilder } from '../core/ModelBuilder.js';

const GLASS = 0x8fb8d8, DARK = 0x2a2f36, LAMP = 0xfff2c0;

// ---------- airports ----------
// (runway along x at z = 0, the landside toward +z; 5.6 × 4.6 tiles of ground)
export function airportModel(fam, size = 1, cargo = false) {
  const b = new ModelBuilder();
  const big = size >= 2, hub = size >= 3;
  // ground and runway
  const grass = fam === 'pioneer' ? 0x7f9a62 : 0x8a9a6a;
  b.box(5.6, 0.04, 4.6, grass, { y: -0.02 });
  const rwCol = fam === 'pioneer' ? 0x7d7a68 : fam === 'midcentury' ? 0x55585c : 0x4a4e54;
  b.box(5.6, 0.06, fam === 'pioneer' ? 0.9 : 1.2, rwCol, { y: 0.02 });
  if (fam !== 'pioneer') for (let k = -2; k <= 2; k++) b.box(0.5, 0.01, 0.06, 0xf4f4f4, { x: k * 1.1, y: 0.06 });
  // runway edge lights from the jet age
  if (fam === 'jet' || fam === 'modern' || fam === 'future') for (let k = -5; k <= 5; k++) for (const s of [0.62, -0.62]) b.box(0.05, 0.03, 0.05, LAMP, { x: k * 0.5, z: s, y: 0.06, glow: true });
  // the apron in front of the terminal
  if (fam !== 'pioneer') b.box(big ? 3.4 : 2.4, 0.03, 1.1, fam === 'midcentury' ? 0x7a7c80 : 0x9a9890, { x: -1.1, z: 1.0, y: 0.02 });
  const T = { x: -1.4, z: 1.75 };
  switch (fam) {
    case 'pioneer':
      // a timber hut, an arched hangar and a windsock
      b.box(0.8, 0.34, 0.5, 0x9a7a5a, { x: T.x, z: T.z, y: 0.02 });
      b.roof(0.9, 0.18, 0.6, 0x6a4a3a, { x: T.x, z: T.z, y: 0.36 });
      b.box(1.3, 0.42, 0.9, 0x7a7f86, { x: 0.6, z: 1.7, y: 0.02 });
      b.roof(1.36, 0.3, 0.96, 0x5a5f66, { x: 0.6, z: 1.7, y: 0.44 });
      b.cyl(0.015, 0.015, 0.8, 5, 0x6a6a6a, { x: 1.9, z: 0.9 });
      b.box(0.24, 0.07, 0.07, 0xe86a2a, { x: 2.0, z: 0.9, y: 0.76 });
      if (big) { b.box(1.2, 0.4, 0.9, 0x7a7f86, { x: 2.0, z: 1.7, y: 0.02 }); b.roof(1.26, 0.28, 0.96, 0x5a5f66, { x: 2.0, z: 1.7, y: 0.42 }); }
      break;
    case 'midcentury':
      // a classic terminal with a small tower on its roof, hangars
      b.box(1.7, 0.5, 0.9, 0xe6dcc4, { x: T.x, z: T.z, y: 0.02 });
      b.box(1.8, 0.06, 1.0, 0x7a6a5a, { x: T.x, z: T.z, y: 0.52 });
      b.box(1.4, 0.16, 0.02, GLASS, { x: T.x, z: T.z - 0.46, y: 0.28, glow: true });
      b.box(0.36, 0.3, 0.36, 0xe6dcc4, { x: T.x + 0.5, z: T.z, y: 0.58 });
      b.box(0.44, 0.18, 0.44, GLASS, { x: T.x + 0.5, z: T.z, y: 0.88, glow: true });
      b.box(1.2, 0.48, 0.9, 0x8a9096, { x: 0.8, z: 1.75, y: 0.02 });
      b.roof(1.26, 0.22, 0.96, 0x6a7078, { x: 0.8, z: 1.75, y: 0.5 });
      if (big) { b.box(1.2, 0.48, 0.9, 0x8a9096, { x: 2.2, z: 1.75, y: 0.02 }); b.roof(1.26, 0.22, 0.96, 0x6a7078, { x: 2.2, z: 1.75, y: 0.5 }); }
      break;
    case 'jet':
      // a concrete terminal with gates onto the apron, a tall tower
      b.box(2.0, 0.6, 1.0, 0xb8b4aa, { x: T.x, z: T.z, y: 0.02 });
      b.box(2.1, 0.07, 1.1, 0x8a8680, { x: T.x, z: T.z, y: 0.62 });
      b.box(1.8, 0.12, 0.02, 0x3a4a5a, { x: T.x, z: T.z - 0.51, y: 0.36, glow: true });
      for (const gx of big ? [-2.2, -1.4, -0.6] : [-1.8, -1.0]) b.box(0.12, 0.12, 0.5, 0xa8a49a, { x: gx, z: 1.05, y: 0.3 });
      b.cyl(0.13, 0.17, 1.6, 8, 0xc8c4ba, { x: 1.6, z: 1.7 });
      b.box(0.5, 0.3, 0.5, 0x3a4a5a, { x: 1.6, z: 1.7, y: 1.6, glow: true });
      b.box(1.3, 0.4, 0.9, 0x9aa3ac, { x: 0.3, z: 1.8, y: 0.02 });
      break;
    case 'modern':
      // glass and concrete, jet bridges, apron lights
      b.box(2.3, 0.62, 1.05, 0xd8dcde, { x: T.x, z: T.z, y: 0.02 });
      b.box(2.2, 0.36, 0.02, GLASS, { x: T.x, z: T.z - 0.53, y: 0.14, glow: true });
      b.box(2.45, 0.05, 1.2, 0x6a7078, { x: T.x, z: T.z, y: 0.64 });
      for (const gx of big ? [-2.3, -1.6, -0.9, -0.2] : [-1.9, -1.2, -0.5]) { b.box(0.1, 0.1, 0.55, 0xc8ccd0, { x: gx, z: 1.0, y: 0.34 }); b.box(0.06, 0.34, 0.06, 0x8a9096, { x: gx, z: 0.78, y: 0.02 }); }
      b.cyl(0.1, 0.14, 1.8, 8, 0xe8ecee, { x: 1.7, z: 1.7 });
      b.cyl(0.3, 0.26, 0.26, 8, GLASS, { x: 1.7, z: 1.7, y: 1.8, glow: true });
      for (const lx of [-2.4, 0.2]) { b.cyl(0.02, 0.02, 0.9, 5, 0x6a7078, { x: lx, z: 0.5 }); b.box(0.12, 0.04, 0.12, LAMP, { x: lx, z: 0.5, y: 0.9, glow: true }); }
      b.box(1.2, 0.42, 0.9, 0xb8c0c8, { x: 0.4, z: 1.8, y: 0.02 });
      break;
    default: // future: a long low hall under a wide roof with solar panels, a slender tower
      b.box(2.4, 0.5, 1.0, 0xe8eef0, { x: T.x, z: T.z, y: 0.02 });
      b.box(2.3, 0.4, 0.02, GLASS, { x: T.x, z: T.z - 0.51, y: 0.06, glow: true });
      b.box(2.8, 0.05, 1.4, 0xd8dee2, { x: T.x, z: T.z - 0.1, y: 0.52 });
      for (let k = -2; k <= 2; k++) b.box(0.44, 0.02, 0.9, 0x2a3a5a, { x: T.x + k * 0.52, z: T.z, y: 0.58 });
      b.box(2.4, 0.02, 0.22, 0x5a8a5a, { x: T.x, z: T.z + 0.55, y: 0.58 });
      for (const gx of [-2.3, -1.6, -0.9, -0.2]) b.box(0.1, 0.1, 0.55, 0xe0e6ea, { x: gx, z: 1.0, y: 0.32 });
      b.cyl(0.07, 0.1, 2.0, 8, 0xf4f8f8, { x: 1.7, z: 1.7 });
      b.cyl(0.26, 0.22, 0.22, 8, GLASS, { x: 1.7, z: 1.7, y: 2.0, glow: true });
      break;
  }
  // a cargo airport: sheds, a freight apron with pallets, truck access
  if (cargo) {
    const shed = fam === 'pioneer' ? 0x8a7a66 : fam === 'midcentury' ? 0x9a9690 : 0xa8b0b8;
    b.box(1.6, 0.46, 0.9, shed, { x: 1.4, z: -1.7, y: 0.02 });
    b.box(1.7, 0.05, 1.0, 0x5a6068, { x: 1.4, z: -1.7, y: 0.48 });
    b.box(1.8, 0.03, 0.8, 0x8a8880, { x: 1.4, z: -0.95, y: 0.02 });
    for (let k = 0; k < 4; k++) b.box(0.2, 0.12, 0.2, [0x3a6ea5, 0xc0392b, 0xd0a030, 0x3a8a4a][k], { x: 0.8 + k * 0.4, z: -0.95, y: 0.05 });
    b.box(1.8, 0.02, 0.24, 0x5a5854, { x: 1.4, z: -2.3, y: 0.02 });
  } else if (fam !== 'pioneer') b.box(1.2, 0.3, 0.9, 0x9aa3ac, { x: 0.4, z: -1.6, y: 0.02 });
  // a hub: a second runway and a big terminal on the far side
  if (hub) {
    b.box(5.6, 0.06, 1.0, rwCol, { z: -2.9, y: 0.02 });
    for (let k = -2; k <= 2; k++) b.box(0.5, 0.01, 0.06, 0xf4f4f4, { x: k * 1.1, z: -2.9, y: 0.06 });
    b.box(5.6, 0.04, 1.6, grass, { z: -2.9, y: -0.02 });
    const hall = { pioneer: 0x9a7a5a, midcentury: 0xe6dcc4, jet: 0xb8b4aa, modern: 0xe4e8ec, future: 0xeef4f4 }[fam] || 0xe4e8ec;
    b.box(2.6, 0.7, 1.1, hall, { x: -2.6, z: 1.6, y: 0.2 });
    b.box(2.7, 0.08, 1.2, 0x5a6470, { x: -2.6, z: 1.6, y: 0.9 });
    if (fam === 'modern' || fam === 'future') b.box(2.5, 0.4, 0.02, GLASS, { x: -2.6, z: 1.04, y: 0.3, glow: true });
  }
  return b.build();
}

// ---------- ports ----------
// (the quay faces the water toward −z; the land side +z)
export const PORT_SPECS = ['general', 'container', 'bulk', 'oil', 'ferry', 'mixed'];
const CONT = [0x2a5a8a, 0xc0392b, 0x3a8a4a, 0xd0a030, 0x8a4a8a, 0xe06a2a];
export function portModel(fam, size = 1, spec = 'general') {
  const b = new ModelBuilder();
  const early = fam === 'early', ind = fam === 'industrial', modern = fam === 'modern';
  // before containers, a container port is a general cargo harbour
  if (spec === 'container' && (early || ind)) spec = 'general';
  const wide = 1.6 + (size - 1) * 0.5;
  // the quay and its piles
  b.box(wide, 0.12, 0.8, early ? 0x8a6a4a : 0x9a968e, { y: 0.02 });
  for (let x = -wide / 2 + 0.1; x < wide / 2; x += 0.6) b.cyl(0.05, 0.05, 0.5, 5, early ? 0x5a4a3a : 0x7a7670, { x, y: -0.35, z: 0.35 });
  if (!early) b.box(wide, 0.05, 0.04, 0xd8c070, { z: -0.38, y: 0.14 });
  const crane = (x, z) => {
    if (early) {
      // a derrick: a timber mast and a boom
      b.box(0.05, 0.8, 0.05, 0x6a5a48, { x, z, y: 0.14 });
      b.box(0.5, 0.04, 0.04, 0x6a5a48, { x: x - 0.2, z, y: 0.82, rz: 0.4 });
    } else if (spec === 'container') {
      // a ship-to-shore gantry over the quay edge
      const c = modern ? 0x2f6fa8 : 0xd0a030;
      for (const dx of [-0.16, 0.16]) for (const dz of [-0.25, 0.2]) b.box(0.06, 1.1, 0.06, c, { x: x + dx, z: z + dz, y: 0.14 });
      b.box(0.44, 0.08, 0.08, c, { x, z: z - 0.25, y: 1.22 });
      b.box(0.44, 0.08, 0.08, c, { x, z: z + 0.2, y: 1.22 });
      b.box(0.1, 0.08, 1.2, c, { x, z: z - 0.3, y: 1.3 });
      b.box(0.16, 0.12, 0.16, 0xe8ecee, { x, z: z - 0.05, y: 1.14 });
    } else {
      // a luffing crane on a pedestal
      const c = ind ? 0xd0a030 : 0xe0b040;
      b.box(0.14, 0.5, 0.14, c, { x, z, y: 0.14 });
      b.box(0.2, 0.16, 0.2, 0x3a4250, { x, z, y: 0.64 });
      b.box(0.06, 0.06, 0.9, c, { x, z: z - 0.35, y: 0.95, rz: 0 });
    }
  };
  const nCranes = spec === 'ferry' || spec === 'oil' ? 0 : Math.max(1, size);
  for (let k = 0; k < nCranes; k++) crane(-wide / 2 + (k + 0.6) * (wide / (nCranes + 0.2)), -0.15);
  // the land side: by specialization
  const back = 0.75;
  switch (spec) {
    case 'container': {
      b.box(wide, 0.03, 1.0, 0x8a8880, { z: back, y: 0.02 });
      for (let r = 0; r < 2; r++) for (let k = 0; k < 3 + size; k++) for (let h = 0; h < (modern ? 3 : 2); h++) b.box(0.28, 0.12, 0.13, CONT[(k * 3 + r + h) % CONT.length], { x: -wide / 2 + 0.25 + k * 0.32, z: back - 0.2 + r * 0.3, y: 0.05 + h * 0.12 });
      if (modern) for (const lx of [-wide / 2 + 0.1, wide / 2 - 0.1]) { b.cyl(0.02, 0.02, 1.2, 5, 0x6a7078, { x: lx, z: back + 0.45 }); b.box(0.14, 0.05, 0.14, LAMP, { x: lx, z: back + 0.45, y: 1.2, glow: true }); }
      break;
    }
    case 'bulk': {
      // stockpiles, a conveyor up to the quay, a hopper
      for (let k = 0; k < 1 + size; k++) b.cone(0.34, 0.36, 6, [0x2a2a2a, 0x8a5a3a, 0x9a9a8a][k % 3], { x: -wide / 2 + 0.4 + k * 0.62, z: back + 0.1, y: 0.02 });
      b.box(0.08, 0.06, 1.0, ind ? 0x6a6a6a : 0x8a9096, { x: wide / 2 - 0.3, z: 0.3, y: 0.5, rz: 0 });
      b.box(0.24, 0.3, 0.24, 0x5a5f66, { x: wide / 2 - 0.3, z: -0.1, y: 0.14 });
      break;
    }
    case 'oil': {
      // tanks, pipes and a loading arm, kept apart
      for (let k = 0; k < 1 + size; k++) b.cyl(0.26, 0.26, 0.42, 10, early ? 0x8a8a80 : 0xe8e8e0, { x: -wide / 2 + 0.35 + k * 0.62, z: back + 0.15, y: 0.02 });
      b.box(wide - 0.2, 0.04, 0.04, 0x9a6a3a, { z: 0.3, y: 0.18 });
      b.box(0.04, 0.04, 0.6, 0x9a6a3a, { x: 0.2, z: 0.0, y: 0.18 });
      b.box(0.05, 0.5, 0.05, 0xd0a030, { x: 0.2, z: -0.3, y: 0.14 });
      b.box(0.05, 0.05, 0.4, 0xd0a030, { x: 0.2, z: -0.45, y: 0.62 });
      break;
    }
    case 'ferry': {
      // a passenger terminal and a boarding ramp
      const wall = early ? 0xd8c8a8 : ind ? 0xc8c2b6 : 0xe4e8ec;
      b.box(1.0, 0.45, 0.6, wall, { z: back, y: 0.02 });
      if (!early) b.box(0.9, 0.2, 0.02, GLASS, { z: back - 0.31, y: 0.16, glow: true });
      if (early) b.roof(1.1, 0.2, 0.7, 0x7a3f33, { z: back, y: 0.47 }); else b.box(1.1, 0.05, 0.7, 0x5a6470, { z: back, y: 0.47 });
      b.box(0.24, 0.05, 0.6, 0xb0b6bc, { x: 0.5, z: -0.3, y: 0.18 });
      b.box(0.04, 0.3, 0.04, 0x6a7078, { x: 0.62, z: -0.5, y: 0.14 });
      break;
    }
    default: {
      // general and mixed: warehouses (brick early, steel sheds later), crates
      const wall = early ? 0xa8634a : ind ? 0x7a8088 : 0xb8c0c8;
      b.box(0.7, 0.42, 0.5, wall, { x: -0.35, z: back, y: 0.02 });
      if (early) b.roof(0.76, 0.22, 0.56, 0x5a4a42, { x: -0.35, z: back, y: 0.44 });
      else if (ind) for (let k = 0; k < 3; k++) b.roof(0.26, 0.14, 0.54, 0x5a5f66, { x: -0.6 + k * 0.25, z: back, y: 0.44 });
      else b.box(0.76, 0.04, 0.56, 0x6a7078, { x: -0.35, z: back, y: 0.44 });
      for (let k = 0; k < 3; k++) b.box(0.14, 0.12, 0.14, early ? 0x8a6a4a : CONT[k], { x: 0.25 + k * 0.18, z: back - 0.1, y: 0.05 });
      if (spec === 'mixed' && !early) for (let k = 0; k < 2; k++) b.cyl(0.14, 0.14, 0.3, 8, 0xe8e8e0, { x: 0.35 + k * 0.32, z: back + 0.25, y: 0.02 });
      if (ind) b.box(wide, 0.02, 0.12, 0x5a5048, { z: back + 0.45, y: 0.02 });   // the rail siding
      break;
    }
  }
  return b.build();
}
