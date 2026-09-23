// Procedural locomotive and wagon models. Each model is built facing +X with its
// base on the rail top at y=0 and its length matching the consist data
// (locoLen / WAGONS[id].len). Geometry is cached per appearance key.
import * as THREE from 'three';
import { ModelBuilder, shade } from '../core/ModelBuilder.js';
import { CARGO, LOCOS, LIVERIES, WAGONS, locoLen } from '../config.js';

const cache = new Map();
const DARK = 0x2a2c30, WHEEL = 0x1f2024, STEEL = 0x8c939a, GLASS = 0x2d3b48, BRASS = 0xd9b45a, LIGHT = 0xfff2c0, RED_L = 0xff5a4a;

function wheels(mb, n, x0, x1, r = 0.13, col = WHEEL) {
  for (let k = 0; k < n; k++) {
    const x = x0 + (k * (x1 - x0)) / Math.max(1, n - 1);
    mb.wheel(r, 0.06, 10, col, { x, y: r, z: 0.22 });
    mb.wheel(r, 0.06, 10, col, { x, y: r, z: -0.22 });
  }
}
function bogie(mb, x, col = DARK, r = 0.1) {
  mb.box(0.42, 0.1, 0.5, col, { x, y: 0.05 });
  for (const dx of [-0.12, 0.12]) for (const z of [0.23, -0.23]) mb.wheel(r, 0.05, 8, WHEEL, { x: x + dx, y: r, z });
}
function bogies(mb, len, col = DARK) { for (const s of [-1, 1]) bogie(mb, s * (len / 2 - 0.32), col); }
function buffers(mb, len, y = 0.2, col = DARK) {
  for (const s of [-1, 1]) for (const z of [0.17, -0.17]) mb.cyl(0.03, 0.03, 0.08, 6, col, { x: s * (len / 2 + 0.01), y, z, rz: Math.PI / 2, center: true });
}

export function liveryColors(model, liveryId) {
  const lv = LIVERIES.find((l) => l.id === liveryId) || LIVERIES[0];
  return { body: lv.body ?? model.color, trim: lv.trim };
}

export function couplerGeometry() {
  const mb = new ModelBuilder();
  mb.box(0.22, 0.05, 0.07, 0x1c1d20, { y: -0.12 });
  mb.box(0.05, 0.08, 0.12, 0x2a2c30, { y: -0.14 });
  return mb.build();
}

// ---------- locomotives ----------
function steamLoco(mb, m, L, body, trim, detail) {
  const big = m.kind === 'steam2';
  const tender = L >= 1.9;
  const tankEngine = m.id === 'meadow_tank' || m.id === 'pioneer';
  const Le = tender ? L * 0.64 : L;          // engine part
  const ex = L / 2 - Le / 2;                 // engine center x
  const r = big ? 0.25 : 0.21;
  const accent = detail >= 2 ? BRASS : trim;
  mb.box(Le, 0.1, 0.56, DARK, { x: ex, y: 0.16 });
  const nDrive = big ? 4 : 3;
  wheels(mb, nDrive, ex - Le * 0.3, ex + Le * 0.22, big ? 0.16 : 0.14);
  if (big) wheels(mb, 1, ex + Le * 0.4, ex + Le * 0.4, 0.09);  // pony truck
  const bl = Le * 0.62, bx = ex + Le * 0.14;
  mb.hcyl(r, bl, 12, body, { x: bx, y: 0.26 + r });
  for (const f of [0.35, -0.2]) mb.hcyl(r + 0.02, 0.05, 12, accent, { x: bx + bl * f, y: 0.26 + r });
  const front = ex + Le / 2;
  mb.cyl(r * 1.02, r * 1.02, 0.06, 12, DARK, { x: front - 0.2, y: 0.26 + r, rz: Math.PI / 2, center: true });
  const chH = 0.22 + detail * 0.03;
  mb.cyl(0.07, 0.055, chH, 8, DARK, { x: front - 0.24, y: 0.26 + r * 2 - 0.02 });
  mb.cyl(0.095, 0.07, 0.05, 8, DARK, { x: front - 0.24, y: 0.26 + r * 2 + chH - 0.04 });
  mb.cyl(0.07, 0.07, 0.1, 8, accent, { x: bx, y: 0.26 + r * 2 - 0.03 });
  if (tankEngine) {
    // side water tanks
    for (const z of [0.25, -0.25]) mb.box(bl * 0.7, 0.26, 0.1, body, { x: bx - 0.05, y: 0.24, z });
  }
  const cabX = ex - Le / 2 + 0.24;
  mb.box(0.44, 0.5, 0.58, body, { x: cabX, y: 0.22 });
  mb.box(0.52, 0.06, 0.64, shade(body, 0.7), { x: cabX, y: 0.72 });
  mb.box(0.02, 0.16, 0.4, GLASS, { x: cabX + 0.23, y: 0.48 });
  mb.box(0.28, 0.14, 0.02, GLASS, { x: cabX, y: 0.48, z: 0.295 });
  mb.box(0.28, 0.14, 0.02, GLASS, { x: cabX, y: 0.48, z: -0.295 });
  mb.box(0.12, 0.08, 0.5, accent, { x: front + 0.02, y: 0.12 });
  mb.hcyl(0.07, 0.22, 8, DARK, { x: front - 0.3, y: 0.24, z: 0.25 });
  mb.hcyl(0.07, 0.22, 8, DARK, { x: front - 0.3, y: 0.24, z: -0.25 });
  mb.box(Le * 0.5, 0.03, 0.02, STEEL, { x: ex, y: 0.15, z: 0.3 });
  mb.box(Le * 0.5, 0.03, 0.02, STEEL, { x: ex, y: 0.15, z: -0.3 });
  mb.cyl(0.05, 0.05, 0.05, 8, LIGHT, { x: front - 0.17, y: 0.36 + r, rz: Math.PI / 2, center: true, glow: true });
  if (big) for (const z of [0.27, -0.27]) mb.box(0.36, 0.26, 0.02, shade(body, 0.8), { x: front - 0.28, y: 0.3 + r, z }); // smoke deflectors
  if (m.id === 'silverline') mb.hcyl(r + 0.03, 0.18, 12, shade(body, 1.2), { x: front - 0.12, y: 0.26 + r, sx: 1.1 });
  buffers(mb, L, 0.2);
  if (tender) {
    const Lt = L - Le - 0.06, tx = -L / 2 + Lt / 2;
    mb.box(Lt, 0.08, 0.52, DARK, { x: tx, y: 0.16 });
    wheels(mb, big ? 3 : 2, tx - Lt * 0.32, tx + Lt * 0.32, 0.1);
    mb.box(Lt * 0.96, 0.4, 0.54, body, { x: tx, y: 0.24 });
    mb.box(Lt * 0.96, 0.04, 0.56, trim, { x: tx, y: 0.36 });
    mb.box(Lt * 0.6, 0.08, 0.44, 0x1e1e22, { x: tx + Lt * 0.12, y: 0.64 }); // coal
    mb.sphere(0.16, 0, 0x26262a, { x: tx + Lt * 0.12, y: 0.7, sx: 2.2, sy: 0.6, sz: 1.3 });
  } else {
    mb.box(0.22, 0.28, 0.5, shade(body, 0.85), { x: -L / 2 + 0.12, y: 0.26 }); // bunker
    mb.box(0.18, 0.06, 0.4, 0x1e1e22, { x: -L / 2 + 0.12, y: 0.54 });
  }
  if (detail >= 1) mb.box(0.03, 0.22, 0.4, shade(body, 0.8), { x: front - 0.2, y: 0.3 });
}

function scaleX(geo, f) { geo.scale(f, 1, 1); geo.computeBoundingSphere(); geo.computeBoundingBox(); return geo; }

export function locoGeometry(modelId, liveryId, detail = 0) {
  const key = `L:${modelId}:${liveryId}:${detail}`;
  if (cache.has(key)) return cache.get(key);
  const model = LOCOS.find((m) => m.id === modelId) || LOCOS[0];
  const { body, trim } = liveryColors(model, liveryId);
  const mb = new ModelBuilder();
  const Lr = locoLen(model);
  const L = 1.6;          // non-steam models are authored at 1.6 and stretched
  const accent = detail >= 2 ? BRASS : trim;
  let stretch = Lr / L;
  switch (model.kind) {
    case 'steam':
    case 'steam2': steamLoco(mb, model, Lr, body, trim, detail); stretch = 1; break;
    case 'diesel': {
      mb.box(L, 0.12, 0.56, DARK, { y: 0.14 });
      bogies(mb, L);
      mb.box(L * 0.92, 0.46, 0.52, body, { y: 0.26 });
      mb.box(L * 0.92, 0.05, 0.54, trim, { y: 0.4 });
      mb.box(0.32, 0.2, 0.54, body, { x: 0.52, y: 0.72 });
      mb.box(0.02, 0.12, 0.44, GLASS, { x: 0.69, y: 0.76 });
      mb.box(0.24, 0.1, 0.02, GLASS, { x: 0.52, y: 0.78, z: 0.275 });
      mb.box(0.24, 0.1, 0.02, GLASS, { x: 0.52, y: 0.78, z: -0.275 });
      for (let k = 0; k < 4; k++) mb.box(0.14, 0.12, 0.02, shade(body, 0.6), { x: -0.5 + k * 0.2, y: 0.5, z: 0.265 });
      for (let k = 0; k < 4; k++) mb.box(0.14, 0.12, 0.02, shade(body, 0.6), { x: -0.5 + k * 0.2, y: 0.5, z: -0.265 });
      mb.box(0.3, 0.04, 0.3, DARK, { x: -0.2, y: 0.72 });
      mb.cyl(0.04, 0.04, 0.06 + detail * 0.02, 6, DARK, { x: -0.1, y: 0.74 });
      mb.box(0.04, 0.06, 0.1, LIGHT, { x: 0.74, y: 0.34, glow: true });
      mb.box(0.04, 0.05, 0.08, RED_L, { x: -0.74, y: 0.34, glow: true });
      for (const s of [1, -1]) mb.box(0.06, 0.03, 0.56, accent, { x: s * 0.77, y: 0.18 });
      break;
    }
    case 'electric': {
      mb.box(L, 0.1, 0.56, DARK, { y: 0.14 });
      bogies(mb, L);
      mb.box(L * 0.96, 0.56, 0.54, body, { y: 0.24 });
      mb.box(L * 0.96, 0.06, 0.56, trim, { y: 0.36 });
      for (const s of [1, -1]) {
        mb.box(0.1, 0.36, 0.5, shade(body, 0.9), { x: s * 0.78, y: 0.28, rz: -0.25 * s });
        mb.box(0.02, 0.14, 0.44, GLASS, { x: s * 0.8, y: 0.6, rz: -0.25 * s });
        mb.box(0.04, 0.05, 0.1, s > 0 ? LIGHT : RED_L, { x: s * 0.83, y: 0.3, glow: true });
      }
      for (let k = 0; k < 5; k++) mb.box(0.12, 0.1, 0.02, GLASS, { x: -0.5 + k * 0.22, y: 0.56, z: 0.275 });
      for (let k = 0; k < 5; k++) mb.box(0.12, 0.1, 0.02, GLASS, { x: -0.5 + k * 0.22, y: 0.56, z: -0.275 });
      mb.box(0.3, 0.03, 0.3, DARK, { x: -0.2, y: 0.8 });
      mb.box(0.03, 0.26, 0.03, STEEL, { x: -0.2, y: 0.82, rz: 0.5 });
      mb.box(0.03, 0.26, 0.03, STEEL, { x: -0.1, y: 0.92, rz: -0.6 });
      mb.box(0.06, 0.02, 0.36, STEEL, { x: -0.05, y: 1.04 });
      break;
    }
    case 'hst': {
      mb.box(L * 0.7, 0.08, 0.52, DARK, { x: -0.2, y: 0.12 });
      bogies(mb, L);
      mb.box(L * 0.72, 0.52, 0.52, body, { x: -0.22, y: 0.22 });
      mb.box(L * 0.72, 0.07, 0.54, trim, { x: -0.22, y: 0.3 });
      for (let k = 0; k < 4; k++) {
        const tt = k / 4;
        mb.box(0.12, 0.52 * (1 - tt * 0.7), 0.52 * (1 - tt * 0.35), body, { x: 0.38 + k * 0.1, y: 0.22 });
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
      mb.box(L * 0.9, 0.14, 0.4, DARK, { y: 0.02 });
      mb.box(L * 0.74, 0.5, 0.56, body, { x: -0.18, y: 0.16 });
      mb.box(L * 0.74, 0.05, 0.58, trim, { x: -0.18, y: 0.2 });
      for (let k = 0; k < 6; k++) {
        const tt = k / 6;
        mb.box(0.08, 0.5 * (1 - tt * 0.75), 0.56 * (1 - tt * 0.4), body, { x: 0.43 + k * 0.07, y: 0.16 });
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
  if (detail >= 3) { mb.box(0.5, 0.03, 0.02, BRASS, { x: 0, y: 0.34, z: 0.29 }); mb.box(0.5, 0.03, 0.02, BRASS, { x: 0, y: 0.34, z: -0.29 }); }
  const g = mb.build();
  if (stretch !== 1) scaleX(g, stretch);
  cache.set(key, g);
  return g;
}

// ---------- wagons ----------
function frame(mb, L, eraKind, col = DARK) {
  mb.box(L, 0.08, 0.52, col, { y: 0.16 });
  if (eraKind === 'maglev') mb.box(L * 0.9, 0.14, 0.38, DARK, { y: 0.02 });
  else bogies(mb, L);
  buffers(mb, L, 0.2);
}
function windowsRow(mb, L, y, h, n, w, glassCol = GLASS) {
  for (let k = 0; k < n; k++) {
    const x = -L / 2 + 0.2 + (k + 0.5) * ((L - 0.4) / n);
    mb.box(w, h, 0.02, glassCol, { x, y, z: 0.265, glow: true });
    mb.box(w, h, 0.02, glassCol, { x, y, z: -0.265, glow: true });
  }
}
// heap of bulk cargo; fill 1..3
function heap(mb, L, w, y, col, fill) {
  if (!fill) return;
  const h = 0.06 + fill * 0.05;
  mb.box(L, 0.05, w, col, { y: y - 0.02 });
  mb.sphere(0.2, 0, col, { y: y + h * 0.3, sx: (L / 0.4) * 0.95, sy: h * 3, sz: (w / 0.4) * 1.05 });
}

// fill: 0 empty, 1..3 load level. cargoId: what the wagon currently carries.
export function wagonGeometry(wagonId, cargoId, fill, eraKind, liveryBody, trimCol) {
  const w = WAGONS[wagonId] ? wagonId : 'boxcar';
  const key = `W:${w}:${cargoId || ''}:${fill | 0}:${eraKind}:${liveryBody}:${trimCol}`;
  if (cache.has(key)) return cache.get(key);
  const mb = new ModelBuilder();
  const L = WAGONS[w].len;
  const modern = eraKind === 'electric' || eraKind === 'hst' || eraKind === 'maglev';
  const cc = cargoId ? CARGO[cargoId].color : 0x999999;
  const loaded = fill > 0;
  switch (w) {
    case 'coach':
    case 'commuter':
    case 'premium':
    case 'cab_car': {
      frame(mb, L, eraKind);
      const body = w === 'premium' ? shade(liveryBody, 0.6) : liveryBody;
      const trim = w === 'premium' ? BRASS : trimCol;
      mb.box(L * 0.98, 0.46, 0.52, body, { y: 0.22 });
      mb.box(L * 0.98, 0.05, 0.54, trim, { y: 0.3 });
      if (w === 'commuter') mb.box(L * 0.98, 0.1, 0.535, shade(trim, 0.9), { y: 0.56 });
      if (modern || w === 'commuter') mb.box(L, 0.08, 0.5, shade(body, 0.85), { y: 0.68 });
      else mb.cyl(0.28, 0.28, L * 0.98, 10, shade(body, 0.6), { y: 0.64, rz: Math.PI / 2, center: true, sx: 0.4 });
      if (w === 'premium') { windowsRow(mb, L, 0.46, 0.16, 4, 0.24); mb.box(L * 0.9, 0.02, 0.54, BRASS, { y: 0.62 }); }
      else if (w === 'commuter') {
        windowsRow(mb, L, 0.46, 0.13, 6, 0.13);
        for (const x of [-L / 4, L / 4]) for (const z of [0.268, -0.268]) mb.box(0.16, 0.34, 0.02, shade(body, 0.7), { x, y: 0.24, z });
      } else windowsRow(mb, L, 0.46, 0.13, Math.round(L * 3.6), 0.16);
      if (w === 'cab_car') {
        mb.box(0.06, 0.42, 0.5, shade(body, 0.9), { x: L / 2 - 0.03, y: 0.24 });
        mb.box(0.02, 0.14, 0.4, GLASS, { x: L / 2 + 0.005, y: 0.5, glow: true });
        mb.box(0.04, 0.05, 0.1, LIGHT, { x: L / 2 + 0.01, y: 0.3, z: 0.14, glow: true });
        mb.box(0.04, 0.05, 0.1, LIGHT, { x: L / 2 + 0.01, y: 0.3, z: -0.14, glow: true });
      }
      break;
    }
    case 'hs_coach': {
      frame(mb, L, eraKind);
      mb.box(L, 0.48, 0.52, liveryBody, { y: 0.2 });
      mb.box(L, 0.06, 0.54, trimCol, { y: 0.28 });
      mb.box(L * 0.92, 0.1, 0.02, GLASS, { y: 0.46, z: 0.265, glow: true });
      mb.box(L * 0.92, 0.1, 0.02, GLASS, { y: 0.46, z: -0.265, glow: true });
      mb.box(L, 0.06, 0.46, shade(liveryBody, 0.9), { y: 0.68 });
      break;
    }
    case 'observation': {
      frame(mb, L, eraKind);
      mb.box(L * 0.98, 0.46, 0.52, liveryBody, { y: 0.22 });
      mb.box(L * 0.98, 0.05, 0.54, trimCol, { y: 0.3 });
      mb.box(L * 0.98, 0.06, 0.5, shade(liveryBody, 0.85), { y: 0.68 });
      windowsRow(mb, L * 0.6, 0.46, 0.13, 3, 0.16);
      // glass dome
      mb.box(L * 0.45, 0.2, 0.46, GLASS, { x: L * 0.18, y: 0.72, glow: true });
      mb.box(L * 0.47, 0.03, 0.48, shade(liveryBody, 0.7), { x: L * 0.18, y: 0.92 });
      break;
    }
    case 'mail_van': {
      frame(mb, L, eraKind);
      const c = 0xb04545;
      mb.box(L * 0.96, 0.48, 0.52, c, { y: 0.22 });
      mb.box(L * 0.96, 0.05, 0.54, 0xe8d9a8, { y: 0.44 });
      mb.box(L, 0.05, 0.56, shade(c, 0.6), { y: 0.7 });
      mb.box(0.28, 0.34, 0.02, shade(c, 0.75), { y: 0.24, z: 0.27 });
      mb.box(0.28, 0.34, 0.02, shade(c, 0.75), { y: 0.24, z: -0.27 });
      mb.box(0.1, 0.06, 0.02, 0xe8d9a8, { x: -L / 4, y: 0.56, z: 0.275 });
      break;
    }
    case 'boxcar': {
      frame(mb, L, eraKind);
      const c = modern ? 0x7a3a2f : 0x8a5a3a;
      mb.box(L * 0.97, 0.56, 0.52, c, { y: 0.22 });
      mb.box(L, 0.05, 0.56, shade(c, 0.65), { y: 0.78 });
      mb.box(L * 0.9, 0.03, 0.1, DARK, { y: 0.83 });   // roof walk
      for (const z of [0.27, -0.27]) {
        mb.box(0.4, 0.46, 0.02, shade(c, 0.8), { y: 0.26, z });
        mb.box(0.44, 0.03, 0.03, DARK, { y: 0.74, z });
      }
      for (const x of [-L / 2 + 0.12, L / 2 - 0.12]) mb.box(0.02, 0.5, 0.54, shade(c, 0.9), { x, y: 0.24 });
      break;
    }
    case 'reefer': {
      frame(mb, L, eraKind);
      const c = 0xe8ecef;
      mb.box(L * 0.97, 0.56, 0.52, c, { y: 0.22 });
      mb.box(L, 0.05, 0.56, 0xc8d0d6, { y: 0.78 });
      mb.box(L * 0.97, 0.06, 0.535, 0x3f7ab8, { y: 0.5 });
      mb.box(0.18, 0.3, 0.46, 0x9aa4ac, { x: L / 2 - 0.12, y: 0.82 }); // reefer unit
      for (const z of [0.27, -0.27]) mb.box(0.34, 0.42, 0.02, 0xd8dde2, { y: 0.26, z });
      break;
    }
    case 'timber': {
      frame(mb, L, eraKind);
      mb.box(L * 0.95, 0.05, 0.5, 0x6b4a33, { y: 0.24 });
      for (const x of [-L / 2 + 0.06, L / 2 - 0.06]) mb.box(0.05, 0.42, 0.5, DARK, { x, y: 0.26 }); // bulkheads
      for (const s of [-1, 1]) for (const x of [-L * 0.3, 0, L * 0.3]) mb.box(0.04, 0.36, 0.04, DARK, { x, y: 0.26, z: s * 0.24 });
      if (loaded) {
        if (cargoId === 'LUMBER') for (let k = 0; k < fill; k++) mb.box(L * 0.82, 0.1, 0.42, shade(cc, 1 - k * 0.07), { y: 0.3 + k * 0.1 });
        else for (let r = 0; r < Math.min(2, fill); r++) for (let k = 0; k < 3 - r; k++) mb.hcyl(0.08, L * 0.86, 7, shade(cc, 1 - k * 0.08), { y: 0.37 + r * 0.14, z: -0.16 + k * 0.16 + r * 0.08 });
      }
      break;
    }
    case 'hopper':
    case 'coal_hopper':
    case 'ore_hopper': {
      frame(mb, L, eraKind);
      const c = w === 'coal_hopper' ? 0x2e3034 : w === 'ore_hopper' ? 0x7a4a36 : (modern ? 0x5a6470 : 0x6a5040);
      const h = w === 'ore_hopper' ? 0.28 : w === 'coal_hopper' ? 0.44 : 0.38;
      // sloped discharge bays underneath
      for (const x of [-L / 4, L / 4]) mb.box(L * 0.3, 0.12, 0.34, shade(c, 0.8), { x, y: 0.12, rz: 0 });
      mb.box(L * 0.94, h, 0.52, c, { y: 0.22 });
      mb.box(L * 0.94, 0.04, 0.55, shade(c, 0.7), { y: 0.22 + h });
      for (let k = 1; k < 4; k++) for (const z of [0.265, -0.265]) mb.box(0.03, h, 0.02, shade(c, 0.7), { x: -L / 2 + k * (L / 4), y: 0.22, z });
      if (loaded) heap(mb, L * 0.86, 0.46, 0.22 + h, cc, fill);
      break;
    }
    case 'tank': {
      frame(mb, L, eraKind);
      const c = cargoId === 'FUEL' ? 0xd8dde2 : modern ? 0xb8bec4 : 0x2b2b2e;
      mb.hcyl(0.25, L * 0.92, 12, c, { y: 0.48 });
      for (const f of [-0.5, 0.5]) mb.hcyl(0.26, 0.03, 12, shade(c, 0.7), { x: f * L * 0.9, y: 0.48 });
      mb.hcyl(0.255, 0.1, 12, cargoId ? cc : 0x777777, { y: 0.48 });
      mb.cyl(0.08, 0.08, 0.1, 8, DARK, { y: 0.72 });
      mb.box(L * 0.8, 0.02, 0.08, DARK, { y: 0.75, z: 0.12 });
      break;
    }
    case 'container': {
      frame(mb, L, eraKind, 0x3a3d42);
      mb.box(L * 0.96, 0.04, 0.5, 0x4a4f55, { y: 0.24 });
      if (loaded) {
        const cols = [0x2f6fa8, 0xc0502f, 0x3a8a5a, 0xd8a030, 0x7a7f86];
        const n = fill >= 2 ? 2 : 1;
        const cl = (L * 0.92) / 2 - 0.02;
        for (let k = 0; k < n; k++) {
          const x = n === 1 ? 0 : (k === 0 ? -cl / 2 - 0.01 : cl / 2 + 0.01);
          const col = cols[(k + (cargoId || '').length) % cols.length];
          mb.box(n === 1 ? cl : cl, 0.44, 0.48, col, { x, y: 0.28 });
          for (let r = 0; r < 4; r++) mb.box(0.02, 0.42, 0.49, shade(col, 0.8), { x: x - cl / 2 + 0.06 + r * (cl - 0.12) / 3, y: 0.29 });
        }
        if (fill >= 3) mb.box(cl, 0.4, 0.48, cols[4], { x: 0, y: 0.72 });
      }
      break;
    }
    case 'machinery_flat': {
      mb.box(L, 0.08, 0.52, DARK, { y: 0.2 });
      bogie(mb, -L / 2 + 0.28); bogie(mb, L / 2 - 0.28);
      buffers(mb, L, 0.24);
      mb.box(L * 0.5, 0.06, 0.52, 0x4a4035, { y: 0.1 });   // depressed well
      for (const s of [-1, 1]) mb.box(0.06, 0.12, 0.52, DARK, { x: s * L * 0.25, y: 0.1 });
      if (loaded) {
        const c = cargoId === 'STEEL' ? cc : 0xd8a030;
        if (cargoId === 'STEEL') for (let k = 0; k < fill + 1; k++) mb.hcyl(0.1, L * 0.45, 10, shade(c, 1 - k * 0.06), { y: 0.26 + k * 0.08, z: (k % 2 ? 0.1 : -0.1) });
        else {
          mb.box(L * 0.42, 0.34, 0.44, c, { y: 0.16 });
          mb.box(0.24, 0.22, 0.3, shade(c, 0.85), { x: -0.1, y: 0.5 });
          mb.cyl(0.12, 0.12, 0.44, 8, 0x5a5f66, { x: 0.18, y: 0.4, rx: Math.PI / 2, center: true });
          for (const x of [-L * 0.2, L * 0.2]) mb.box(0.02, 0.3, 0.02, 0xb8a060, { x, y: 0.2, z: 0.24 });
        }
      }
      break;
    }
    case 'brake_van':
    case 'caboose': {
      frame(mb, L, eraKind);
      const c = w === 'caboose' ? 0xb0402f : 0x5a4a3f;
      mb.box(L * 0.7, 0.48, 0.5, c, { y: 0.22 });
      mb.box(L * 0.74, 0.05, 0.56, shade(c, 0.7), { y: 0.7 });
      windowsRow(mb, L * 0.7, 0.44, 0.12, 2, 0.12);
      for (const s of [-1, 1]) mb.box(0.02, 0.26, 0.5, DARK, { x: s * L * 0.46, y: 0.24 }); // veranda rails
      if (w === 'caboose') { mb.box(0.3, 0.18, 0.4, c, { y: 0.74 }); mb.box(0.32, 0.03, 0.44, shade(c, 0.7), { y: 0.92 }); mb.box(0.24, 0.08, 0.02, GLASS, { y: 0.82, z: 0.205, glow: true }); }
      else mb.cyl(0.03, 0.03, 0.12, 6, DARK, { x: -0.1, y: 0.74 });
      mb.box(0.04, 0.05, 0.06, RED_L, { x: -L / 2, y: 0.5, z: 0.2, glow: true });
      break;
    }
    case 'flatbed':
    default: {
      frame(mb, L, eraKind);
      mb.box(L * 0.96, 0.06, 0.52, 0x5a4a3a, { y: 0.24 });
      for (const s of [-1, 1]) for (const x of [-L * 0.35, L * 0.35]) mb.box(0.03, 0.12, 0.03, DARK, { x, y: 0.28, z: s * 0.25 });
      if (loaded) {
        if (cargoId === 'LUMBER') for (let k = 0; k < fill; k++) mb.box(L * 0.85, 0.08, 0.44, shade(cc, 1 - k * 0.07), { y: 0.3 + k * 0.08 });
        else if (cargoId === 'STEEL') for (let k = 0; k < 3; k++) { mb.box(L * 0.85, 0.07, 0.12, cc, { y: 0.3, z: -0.16 + k * 0.16 }); if (fill > 1) mb.box(L * 0.8, 0.07, 0.12, shade(cc, 0.9), { y: 0.37, z: -0.08 + (k % 2) * 0.16 }); }
        else if (cargoId === 'MACHINERY') { mb.box(0.6, 0.28, 0.4, cc, { y: 0.3 }); mb.cyl(0.12, 0.12, 0.3, 8, shade(cc, 0.8), { x: 0.3, y: 0.44, rz: Math.PI / 2, center: true }); mb.box(0.3, 0.2, 0.3, 0xd8a030, { x: -0.4, y: 0.3 }); }
        else if (cargoId === 'WOOD') for (let k = 0; k < 3; k++) mb.hcyl(0.08, L * 0.86, 7, shade(cc, 1 - k * 0.08), { y: 0.37, z: -0.16 + k * 0.16 });
        else mb.box(L * 0.8, 0.2, 0.44, cc, { y: 0.3 });
      }
      break;
    }
  }
  const g = mb.build();
  cache.set(key, g);
  return g;
}

export { THREE };
