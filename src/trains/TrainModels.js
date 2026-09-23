// Procedural locomotive and wagon models. Each model is built facing +X with its
// base on the rail top at y=0. Geometry is cached per (model, livery, detail).
import { ModelBuilder, shade } from '../core/ModelBuilder.js';
import { CARGO, LOCOS, LIVERIES } from '../config.js';

const cache = new Map();
const DARK = 0x2a2c30, WHEEL = 0x1f2024, STEEL = 0x8c939a, GLASS = 0x2d3b48, BRASS = 0xd9b45a, LIGHT = 0xfff2c0;

export const LOCO_LEN = 1.6;
export const WAGON_LEN = 1.35;
export const CAR_GAP = 0.12;

function wheels(mb, n, len, r = 0.13, col = WHEEL) {
  for (let k = 0; k < n; k++) {
    const x = -len / 2 + 0.22 + (k * (len - 0.44)) / Math.max(1, n - 1);
    mb.wheel(r, 0.06, 10, col, { x, y: r, z: 0.22 });
    mb.wheel(r, 0.06, 10, col, { x, y: r, z: -0.22 });
  }
}
function bogies(mb, len, col = DARK) {
  for (const s of [-1, 1]) {
    const x = s * (len / 2 - 0.32);
    mb.box(0.42, 0.1, 0.5, col, { x, y: 0.05 });
    mb.wheel(0.1, 0.05, 8, WHEEL, { x: x - 0.12, y: 0.1, z: 0.23 });
    mb.wheel(0.1, 0.05, 8, WHEEL, { x: x + 0.12, y: 0.1, z: 0.23 });
    mb.wheel(0.1, 0.05, 8, WHEEL, { x: x - 0.12, y: 0.1, z: -0.23 });
    mb.wheel(0.1, 0.05, 8, WHEEL, { x: x + 0.12, y: 0.1, z: -0.23 });
  }
}

export function liveryColors(model, liveryId) {
  const lv = LIVERIES.find((l) => l.id === liveryId) || LIVERIES[0];
  return { body: lv.body ?? model.color, trim: lv.trim };
}

export function locoGeometry(modelId, liveryId, detail = 0) {
  const key = `L:${modelId}:${liveryId}:${detail}`;
  if (cache.has(key)) return cache.get(key);
  const model = LOCOS.find((m) => m.id === modelId) || LOCOS[0];
  const { body, trim } = liveryColors(model, liveryId);
  const mb = new ModelBuilder();
  const L = LOCO_LEN;
  const accent = detail >= 2 ? BRASS : trim;
  switch (model.kind) {
    case 'steam':
    case 'steam2': {
      const big = model.kind === 'steam2';
      const r = big ? 0.25 : 0.22;
      mb.box(L, 0.1, 0.56, DARK, { y: 0.16 }); // frame
      wheels(mb, big ? 4 : 3, L * 0.8, big ? 0.16 : 0.14);
      mb.hcyl(r, L * 0.62, 12, body, { x: 0.18, y: 0.26 + r });        // boiler
      mb.hcyl(r + 0.02, 0.05, 12, accent, { x: 0.38, y: 0.26 + r });
      mb.hcyl(r + 0.02, 0.05, 12, accent, { x: -0.02, y: 0.26 + r });
      mb.cyl(r * 1.02, r * 1.02, 0.06, 12, DARK, { x: 0.5, y: 0.26 + r, rz: Math.PI / 2, center: true }); // smokebox face
      const chH = 0.22 + detail * 0.03;
      mb.cyl(0.07, 0.055, chH, 8, DARK, { x: 0.52, y: 0.26 + r * 2 - 0.02 });  // chimney
      mb.cyl(0.095, 0.07, 0.05, 8, DARK, { x: 0.52, y: 0.26 + r * 2 + chH - 0.04 });
      mb.cyl(0.07, 0.07, 0.1, 8, accent, { x: 0.18, y: 0.26 + r * 2 - 0.03 }); // dome
      mb.box(0.46, 0.5, 0.58, body, { x: -0.52, y: 0.22 });  // cab
      mb.box(0.52, 0.06, 0.64, shade(body, 0.7), { x: -0.52, y: 0.72 });   // cab roof
      mb.box(0.02, 0.16, 0.4, GLASS, { x: -0.29, y: 0.48 });
      mb.box(0.3, 0.14, 0.02, GLASS, { x: -0.52, y: 0.48, z: 0.295 });
      mb.box(0.3, 0.14, 0.02, GLASS, { x: -0.52, y: 0.48, z: -0.295 });
      mb.box(0.12, 0.08, 0.5, accent, { x: 0.74, y: 0.12 }); // buffer beam
      mb.box(0.08, 0.2, 0.08, DARK, { x: 0.68, y: 0.2, z: 0.2 });
      // cylinders and rods
      mb.hcyl(0.07, 0.22, 8, DARK, { x: 0.46, y: 0.24, z: 0.25 });
      mb.hcyl(0.07, 0.22, 8, DARK, { x: 0.46, y: 0.24, z: -0.25 });
      mb.box(L * 0.55, 0.03, 0.02, STEEL, { x: 0.05, y: 0.15, z: 0.3 });
      mb.box(L * 0.55, 0.03, 0.02, STEEL, { x: 0.05, y: 0.15, z: -0.3 });
      mb.cyl(0.05, 0.05, 0.05, 8, LIGHT, { x: 0.53, y: 0.36, rz: Math.PI / 2, center: true, glow: true });
      if (big) mb.box(0.5, 0.12, 0.5, shade(body, 0.8), { x: 0.2, y: 0.26 + r * 2 - 0.08 }); // smoke deflector top
      if (detail >= 1) { mb.box(0.03, 0.22, 0.4, shade(body, 0.8), { x: 0.5, y: 0.3, z: 0 }); }
      break;
    }
    case 'diesel': {
      mb.box(L, 0.12, 0.56, DARK, { y: 0.14 });
      bogies(mb, L);
      mb.box(L * 0.92, 0.46, 0.52, body, { y: 0.26 });
      mb.box(L * 0.92, 0.05, 0.54, trim, { y: 0.4 });
      mb.box(0.32, 0.2, 0.54, body, { x: 0.52, y: 0.72 }); // cab raised
      mb.box(0.02, 0.12, 0.44, GLASS, { x: 0.69, y: 0.76 });
      mb.box(0.24, 0.1, 0.02, GLASS, { x: 0.52, y: 0.78, z: 0.275 });
      mb.box(0.24, 0.1, 0.02, GLASS, { x: 0.52, y: 0.78, z: -0.275 });
      for (let k = 0; k < 4; k++) mb.box(0.14, 0.12, 0.02, shade(body, 0.6), { x: -0.5 + k * 0.2, y: 0.5, z: 0.265 });
      for (let k = 0; k < 4; k++) mb.box(0.14, 0.12, 0.02, shade(body, 0.6), { x: -0.5 + k * 0.2, y: 0.5, z: -0.265 });
      mb.box(0.3, 0.04, 0.3, DARK, { x: -0.2, y: 0.72 }); // exhaust grille
      mb.cyl(0.04, 0.04, 0.06 + detail * 0.02, 6, DARK, { x: -0.1, y: 0.74 });
      mb.box(0.04, 0.06, 0.1, LIGHT, { x: 0.74, y: 0.34, glow: true });
      break;
    }
    case 'electric': {
      mb.box(L, 0.1, 0.56, DARK, { y: 0.14 });
      bogies(mb, L);
      mb.box(L * 0.96, 0.56, 0.54, body, { y: 0.24 });
      mb.box(L * 0.96, 0.06, 0.56, trim, { y: 0.36 });
      mb.box(0.1, 0.36, 0.5, shade(body, 0.9), { x: 0.78, y: 0.28, rz: -0.25 });
      mb.box(0.02, 0.14, 0.44, GLASS, { x: 0.8, y: 0.6, rz: -0.25 });
      mb.box(0.02, 0.14, 0.44, GLASS, { x: -0.77, y: 0.62 });
      for (let k = 0; k < 5; k++) mb.box(0.12, 0.1, 0.02, GLASS, { x: -0.5 + k * 0.22, y: 0.56, z: 0.275 });
      for (let k = 0; k < 5; k++) mb.box(0.12, 0.1, 0.02, GLASS, { x: -0.5 + k * 0.22, y: 0.56, z: -0.275 });
      // pantograph
      mb.box(0.3, 0.03, 0.3, DARK, { x: -0.2, y: 0.8 });
      mb.box(0.03, 0.26, 0.03, STEEL, { x: -0.2, y: 0.82, rz: 0.5 });
      mb.box(0.03, 0.26, 0.03, STEEL, { x: -0.1, y: 0.92, rz: -0.6 });
      mb.box(0.06, 0.02, 0.36, STEEL, { x: -0.05, y: 1.04 });
      mb.box(0.04, 0.05, 0.1, LIGHT, { x: 0.83, y: 0.3, glow: true });
      break;
    }
    case 'hst': {
      mb.box(L * 0.7, 0.08, 0.52, DARK, { x: -0.2, y: 0.12 });
      bogies(mb, L);
      mb.box(L * 0.72, 0.52, 0.52, body, { x: -0.22, y: 0.22 });
      mb.box(L * 0.72, 0.07, 0.54, trim, { x: -0.22, y: 0.3 });
      // streamlined nose built from stacked wedges
      for (let k = 0; k < 4; k++) {
        const t = k / 4;
        mb.box(0.12, 0.52 * (1 - t * 0.7), 0.52 * (1 - t * 0.35), body, { x: 0.38 + k * 0.1, y: 0.22 });
      }
      mb.box(0.3, 0.05, 0.4, GLASS, { x: 0.46, y: 0.6, rz: -0.35 });
      mb.box(0.06, 0.05, 0.08, LIGHT, { x: 0.78, y: 0.28, z: 0.14, glow: true });
      mb.box(0.06, 0.05, 0.08, LIGHT, { x: 0.78, y: 0.28, z: -0.14, glow: true });
      for (let k = 0; k < 4; k++) mb.box(0.14, 0.1, 0.02, GLASS, { x: -0.7 + k * 0.2, y: 0.54, z: 0.265 });
      for (let k = 0; k < 4; k++) mb.box(0.14, 0.1, 0.02, GLASS, { x: -0.7 + k * 0.2, y: 0.54, z: -0.265 });
      mb.box(0.24, 0.03, 0.2, DARK, { x: -0.5, y: 0.74 });
      mb.box(0.03, 0.2, 0.03, STEEL, { x: -0.5, y: 0.76, rz: 0.6 });
      mb.box(0.05, 0.02, 0.3, STEEL, { x: -0.42, y: 0.9 });
      break;
    }
    case 'maglev':
    default: {
      mb.box(L * 0.9, 0.14, 0.4, DARK, { y: 0.02 }); // levitation skirt
      mb.box(L * 0.74, 0.5, 0.56, body, { x: -0.18, y: 0.16 });
      mb.box(L * 0.74, 0.05, 0.58, trim, { x: -0.18, y: 0.2 });
      for (let k = 0; k < 6; k++) {
        const t = k / 6;
        mb.box(0.08, 0.5 * (1 - t * 0.75), 0.56 * (1 - t * 0.4), body, { x: 0.43 + k * 0.07, y: 0.16 });
      }
      mb.box(0.36, 0.04, 0.46, GLASS, { x: 0.42, y: 0.56, rz: -0.28 });
      mb.box(L * 0.7, 0.08, 0.02, GLASS, { x: -0.2, y: 0.5, z: 0.285 });
      mb.box(L * 0.7, 0.08, 0.02, GLASS, { x: -0.2, y: 0.5, z: -0.285 });
      mb.box(L * 0.8, 0.03, 0.03, 0x7ff0ff, { y: 0.1, z: 0.21, glow: true });
      mb.box(L * 0.8, 0.03, 0.03, 0x7ff0ff, { y: 0.1, z: -0.21, glow: true });
      mb.box(0.05, 0.04, 0.3, LIGHT, { x: 0.83, y: 0.22, glow: true });
      break;
    }
  }
  if (detail >= 3) mb.box(0.5, 0.03, 0.02, BRASS, { x: 0, y: 0.34, z: 0.29 }), mb.box(0.5, 0.03, 0.02, BRASS, { x: 0, y: 0.34, z: -0.29 });
  const g = mb.build();
  cache.set(key, g);
  return g;
}

// Wagon styles: coach, mail, log, bulk, liquid, crate, flat
export function wagonGeometry(style, cargoId, loaded, eraKind, liveryBody, trimCol) {
  const key = `W:${style}:${cargoId || ''}:${loaded ? 1 : 0}:${eraKind}:${liveryBody}:${trimCol}`;
  if (cache.has(key)) return cache.get(key);
  const mb = new ModelBuilder();
  const L = WAGON_LEN;
  const modern = eraKind === 'electric' || eraKind === 'hst' || eraKind === 'maglev';
  const cc = cargoId ? CARGO[cargoId].color : 0x999999;
  const frame = () => { mb.box(L, 0.08, 0.52, DARK, { y: 0.16 }); if (eraKind === 'maglev') mb.box(L * 0.9, 0.14, 0.38, DARK, { y: 0.02 }); else bogies(mb, L); };
  switch (style) {
    case 'coach': {
      frame();
      const body = liveryBody;
      mb.box(L * 0.98, 0.46, 0.52, body, { y: 0.22 });
      mb.box(L * 0.98, 0.05, 0.54, trimCol, { y: 0.3 });
      if (modern) mb.box(L, 0.08, 0.5, shade(body, 0.85), { y: 0.68 });
      else mb.cyl(0.28, 0.28, L * 0.98, 10, shade(body, 0.6), { y: 0.64, rz: Math.PI / 2, center: true, sx: 0.4 });
      for (let k = 0; k < 5; k++) {
        mb.box(0.16, 0.13, 0.02, GLASS, { x: -0.5 + k * 0.25, y: 0.46, z: 0.265, glow: true });
        mb.box(0.16, 0.13, 0.02, GLASS, { x: -0.5 + k * 0.25, y: 0.46, z: -0.265, glow: true });
      }
      break;
    }
    case 'mail': {
      frame();
      mb.box(L * 0.96, 0.48, 0.52, 0xb04545, { y: 0.22 });
      mb.box(L * 0.96, 0.05, 0.54, 0xe8d9a8, { y: 0.44 });
      mb.box(L, 0.05, 0.56, shade(0xb04545, 0.6), { y: 0.7 });
      break;
    }
    case 'log': {
      frame();
      mb.box(L * 0.95, 0.05, 0.5, 0x6b4a33, { y: 0.24 });
      for (const s of [-1, 1]) for (const x of [-0.5, 0, 0.5]) mb.box(0.04, 0.3, 0.04, DARK, { x, y: 0.26, z: s * 0.24 });
      if (loaded) for (let r = 0; r < 2; r++) for (let k = 0; k < 3 - r; k++) mb.hcyl(0.08, L * 0.9, 7, shade(cc, 1 - k * 0.08), { y: 0.37 + r * 0.14, z: -0.16 + k * 0.16 + r * 0.08 });
      break;
    }
    case 'bulk': {
      frame();
      mb.box(L * 0.92, 0.36, 0.52, modern ? 0x5a6470 : 0x6a5040, { y: 0.24 });
      mb.box(L * 0.92, 0.04, 0.54, shade(modern ? 0x5a6470 : 0x6a5040, 0.7), { y: 0.58 });
      if (loaded) mb.box(L * 0.86, 0.06, 0.46, cc, { y: 0.58 }), mb.sphere(0.2, 0, cc, { y: 0.62, sx: 3.2, sy: 0.5, sz: 1.1 });
      break;
    }
    case 'liquid': {
      frame();
      mb.hcyl(0.24, L * 0.92, 12, modern ? 0xd8dde2 : 0x2b2b2e, { y: 0.48 });
      mb.hcyl(0.25, 0.04, 12, cc, { y: 0.48, x: 0 });
      mb.cyl(0.07, 0.07, 0.08, 8, DARK, { y: 0.72 });
      break;
    }
    case 'crate': {
      frame();
      const c = cargoId === 'GOODS' ? 0x4a7fa0 : cargoId === 'FOOD' ? 0xe0e0d8 : 0x8a6a4a;
      mb.box(L * 0.96, 0.5, 0.52, c, { y: 0.22 });
      mb.box(L, 0.05, 0.56, shade(c, 0.65), { y: 0.72 });
      mb.box(0.36, 0.38, 0.02, shade(c, 0.8), { y: 0.26, z: 0.27 });
      mb.box(0.36, 0.38, 0.02, shade(c, 0.8), { y: 0.26, z: -0.27 });
      if (cargoId === 'FOOD') mb.box(L * 0.5, 0.1, 0.02, 0xd9744f, { y: 0.5, z: 0.28 }), mb.box(L * 0.5, 0.1, 0.02, 0xd9744f, { y: 0.5, z: -0.28 });
      break;
    }
    case 'flat':
    default: {
      frame();
      mb.box(L * 0.96, 0.06, 0.52, 0x5a4a3a, { y: 0.24 });
      if (loaded) {
        if (cargoId === 'LUMBER') for (let k = 0; k < 3; k++) mb.box(L * 0.85, 0.08, 0.44, shade(cc, 1 - k * 0.07), { y: 0.3 + k * 0.08 });
        else if (cargoId === 'STEEL') for (let k = 0; k < 3; k++) mb.box(L * 0.85, 0.07, 0.12, cc, { y: 0.3, z: -0.16 + k * 0.16 }), mb.box(L * 0.8, 0.07, 0.12, shade(cc, 0.9), { y: 0.37, z: -0.08 + (k % 2) * 0.16 });
        else if (cargoId === 'MACHINERY') { mb.box(0.6, 0.28, 0.4, cc, { y: 0.3 }); mb.cyl(0.12, 0.12, 0.3, 8, shade(cc, 0.8), { x: 0.3, y: 0.44, rz: Math.PI / 2, center: true }); mb.box(0.3, 0.2, 0.3, 0xd8a030, { x: -0.4, y: 0.3 }); }
        else mb.box(L * 0.8, 0.2, 0.44, cc, { y: 0.3 });
      }
      break;
    }
  }
  const g = mb.build();
  cache.set(key, g);
  return g;
}

export function cargoStyle(cargoId) {
  if (!cargoId) return null;
  const grp = CARGO[cargoId].group;
  if (grp === 'pax') return 'coach';
  return grp;
}

export function defaultFreightStyle(model) {
  if (model.role === 'passenger') return 'coach';
  return model.kind === 'steam' ? 'log' : 'crate';
}
