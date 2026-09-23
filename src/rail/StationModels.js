// Station architecture. A station's look follows its *type* (derived from its
// level, track roles, dead ends, line class and facilities, see stationKind)
// and grows visibly as it is expanded:
//   halt → village → town → city → central → grand (passenger ladder)
//   freight / yard / intermodal (goods), hs (high-speed line), + terminal
//   (dead-end tracks: the concourse sits across the buffer stops).
// Local frame: tracks along X at z = offset; each track's lanes at ±0.34;
// platform edges at ±0.69, platforms 0.24 high, 0.32 wide.
import { shade } from '../core/ModelBuilder.js';
import { PAL } from '../style.js';

const POST = 0x4a4f55, BENCH = 0x7a5a3a, LAMP = 0xfff0c0, PLAT = PAL.platform, EDGE = PAL.platformEdge, CLOCK = 0xf4f0e6;
const GLASS = 0x3a4a5a, GLASS_MODERN = 0x9ec8e0, STEEL = 0x6a7580, SIGN = 0x2f5f8a;

export const STATION_KINDS = ['halt', 'village', 'town', 'city', 'central', 'grand', 'hs', 'freight', 'yard', 'intermodal'];

function lampPost(mb, x, z, y = 0, modern = false) {
  if (modern) { mb.box(0.03, 0.66, 0.03, 0xdfe4e8, { x, y: y + 0.24, z }); mb.box(0.16, 0.03, 0.06, LAMP, { x: x + 0.05, y: y + 0.88, z, glow: true }); return; }
  mb.cyl(0.02, 0.025, 0.6, 5, POST, { x, y: y + 0.25, z });
  mb.sphere(0.05, 0, LAMP, { x, y: y + 0.88, z, glow: true });
}
function windows(mb, x0, x1, y, z, h, n, lit = true, col = GLASS) {
  for (let k = 0; k < n; k++) {
    const x = x0 + (k + 0.5) * ((x1 - x0) / n);
    mb.box(Math.min(0.16, (x1 - x0) / n * 0.6), h, 0.02, col, { x, y, z, glow: lit });
  }
}
// a building block with windows on both long faces, flat or gabled roof
function block(mb, x, z, w, d, h, wall, roof, o = {}) {
  const y = o.y || 0, floors = Math.max(1, Math.round(h / 0.36));
  mb.box(w, h, d, wall, { x, y, z });
  mb.box(w + 0.06, 0.05, d + 0.06, shade(wall, 0.8), { x, y: y + h, z });
  if (o.gable) mb.roof(w + 0.1, o.gable, d + 0.12, roof, { x, y: y + h + 0.03, z });
  else if (o.flat !== false) mb.box(w - 0.04, 0.04, d - 0.04, roof, { x, y: y + h + 0.03, z });
  for (let f = 0; f < floors; f++) {
    const wy = y + 0.12 + f * (h / floors);
    const n = Math.max(2, Math.floor(w / 0.32));
    for (const s of [1, -1]) windows(mb, x - w / 2 + 0.1, x + w / 2 - 0.1, wy, z + s * (d / 2 + 0.005), Math.min(0.2, h / floors * 0.5), n, true, o.glass || GLASS);
  }
}
function clockTower(mb, x, z, y, h, wall, roof) {
  mb.box(0.42, h, 0.42, wall, { x, y, z });
  mb.cone(0.36, 0.5, 4, roof, { x, y: y + h, z, ry: Math.PI / 4 });
  for (const s of [1, -1]) mb.cyl(0.14, 0.14, 0.03, 12, CLOCK, { x, y: y + h - 0.3, z: z + s * 0.22, rx: Math.PI / 2, center: true, glow: true });
}
function signBoard(mb, x, y, z, w = 0.5) { mb.box(w, 0.12, 0.03, SIGN, { x, y, z }); mb.box(w - 0.08, 0.03, 0.035, 0xf0f0f0, { x, y: y + 0.045, z }); }

// ---------- platforms ----------
function platforms(mb, tracks, kind, level, roof) {
  const modern = kind === 'hs' || kind === 'grand';
  const freightKind = kind === 'freight' || kind === 'yard' || kind === 'intermodal';
  for (const tk of tracks) {
    const plen = tk.x1 - tk.x0 - 0.1, cx = (tk.x0 + tk.x1) / 2;
    if (tk.role === 'through') continue;
    const freight = tk.role === 'freight' || freightKind;
    const col = freight ? 0xa8a296 : tk.role === 'express' ? 0xd8d0c0 : modern ? 0xd9d6cf : PLAT;
    const ph = freight ? 0.18 : 0.24;
    for (const s of [1, -1]) {
      mb.box(plen, ph, 0.32, col, { x: cx, y: tk.y, z: tk.z + s * 0.84 });
      mb.box(plen, 0.02, 0.04, freight ? 0xd0c070 : tk.role === 'express' ? 0xd04040 : EDGE, { x: cx, y: tk.y + ph, z: tk.z + s * 0.69 });
    }
    // lamps, benches and signs every tile (none on goods platforms except lamps)
    for (let x = tk.x0 + 0.5; x < tk.x1 - 0.2; x += 2) {
      lampPost(mb, x, tk.z + 0.95, tk.y, modern);
      if (!freight && level >= 1) mb.box(0.4, 0.06, 0.12, BENCH, { x: x + 0.6, y: tk.y + 0.34, z: tk.z - 0.95 });
    }
    // platform number / name sign
    if (!freight) { mb.cyl(0.015, 0.015, 0.5, 4, POST, { x: tk.x0 + 0.3, y: tk.y + 0.24, z: tk.z + 0.8 }); mb.box(0.16, 0.16, 0.03, SIGN, { x: tk.x0 + 0.3, y: tk.y + 0.78, z: tk.z + 0.8 }); }
    else for (let x = tk.x0 + 0.4; x < tk.x1 - 0.3; x += 1.1) mb.box(0.28, 0.16, 0.22, [0x8a5a3a, 0x5a6470, 0x6b4a33][Math.floor(x * 7) & 1 ? 1 : 0], { x, y: tk.y + ph, z: tk.z + 0.9 }); // crates / pallets
    // buffer stops at dead ends
    tk.deadEnd.forEach((dead, i) => {
      if (!dead) return;
      const x = i ? tk.x1 - 0.12 : tk.x0 + 0.12;
      for (const lane of [0.34, -0.34]) { mb.box(0.12, 0.2, 0.34, 0xc94f4f, { x, y: tk.y + 0.1, z: tk.z + lane }); mb.box(0.04, 0.06, 0.2, LAMP, { x: x + (i ? -0.07 : 0.07), y: tk.y + 0.3, z: tk.z + lane, glow: true }); }
    });
    // canopies: classic pitched on posts / modern continuous wing
    if (level >= 2 && !freight) for (const s of [1, -1]) {
      if (modern) {
        for (let x = tk.x0 + 0.5; x <= tk.x1 - 0.4; x += 1.2) mb.box(0.05, 0.62, 0.05, 0xf0f2f4, { x, y: tk.y + 0.24, z: tk.z + s * 0.9 });
        mb.box(plen, 0.04, 0.52, 0xf0f2f4, { x: cx, y: tk.y + 0.86, z: tk.z + s * 0.84 });
        mb.box(plen, 0.02, 0.2, GLASS_MODERN, { x: cx, y: tk.y + 0.9, z: tk.z + s * 0.84, glow: true });
      } else {
        for (let x = tk.x0 + 0.4; x <= tk.x1 - 0.3; x += 0.9) mb.cyl(0.025, 0.025, 0.6, 5, POST, { x, y: tk.y + 0.24, z: tk.z + s * 0.92 });
        mb.box(plen, 0.05, 0.46, roof, { x: cx, y: tk.y + 0.84, z: tk.z + s * 0.86, rx: s * 0.12 });
        mb.box(plen, 0.06, 0.02, shade(roof, 0.75), { x: cx, y: tk.y + 0.8, z: tk.z + s * 0.62 });   // valance
      }
    }
  }
}

// ---------- passenger buildings ----------
function passengerBuilding(mb, kind, level, style, B) {
  const { midX, bz, y0 } = B;
  const wall = style.wall, roof = style.roof;
  switch (kind) {
    case 'village': {
      block(mb, midX, bz, 1.5, 0.8, 0.62, wall, roof, { y: y0, gable: 0.42 });
      mb.box(0.1, 0.34, 0.1, shade(wall, 0.7), { x: midX + 0.45, y: y0 + 0.9, z: bz + 0.15 });           // chimney
      mb.box(0.24, 0.36, 0.03, shade(roof, 0.8), { x: midX, y: y0, z: bz - 0.41 });                    // door
      for (const x of [-0.5, 0.5]) mb.box(0.24, 0.05, 0.06, 0x6a9a4a, { x: midX + x, y: y0 + 0.2, z: bz - 0.43 });  // flower boxes
      signBoard(mb, midX, y0 + 0.66, bz - 0.44, 0.6);
      break;
    }
    case 'town': {
      block(mb, midX, bz, 2.0, 0.85, 0.8, wall, roof, { y: y0, gable: 0.5 });
      mb.box(0.3, 0.42, 0.03, shade(roof, 0.8), { x: midX, y: y0, z: bz - 0.44 });
      clockTower(mb, midX + 1.1, bz + 0.1, y0, 2.0, wall, roof);
      signBoard(mb, midX, y0 + 0.84, bz - 0.46, 0.8);
      break;
    }
    case 'city': {
      block(mb, midX, bz, 2.8, 0.95, 1.0, wall, roof, { y: y0, gable: 0.5 });
      for (const s of [1, -1]) block(mb, midX + s * 1.85, bz + 0.05, 0.9, 0.8, 0.72, shade(wall, 0.95), roof, { y: y0, gable: 0.32 });
      clockTower(mb, midX, bz + 0.1, y0 + 1.0, 1.3, wall, roof);
      mb.box(0.5, 0.5, 0.04, shade(roof, 0.8), { x: midX, y: y0, z: bz - 0.49 });
      signBoard(mb, midX, y0 + 1.05, bz - 0.5, 1.1);
      break;
    }
    case 'central': {
      block(mb, midX, bz, 3.4, 1.0, 1.2, wall, roof, { y: y0, flat: true });
      mb.roof(3.5, 0.45, 1.1, roof, { x: midX, y: y0 + 1.24, z: bz });
      for (const s of [1, -1]) {
        const tx = midX + s * 1.95;
        mb.box(0.55, 2.5, 0.55, wall, { x: tx, y: y0, z: bz - 0.1 });
        mb.cone(0.45, 0.75, 4, roof, { x: tx, y: y0 + 2.5, z: bz - 0.1, ry: Math.PI / 4 });
        mb.cyl(0.01, 0.01, 0.5, 4, POST, { x: tx, y: y0 + 3.2, z: bz - 0.1 });
        mb.box(0.24, 0.14, 0.01, 0xc94f4f, { x: tx + 0.12, y: y0 + 3.55, z: bz - 0.1 });
      }
      // arched entrance window
      mb.torus(0.4, 0.05, Math.PI, shade(wall, 0.7), { x: midX, y: y0 + 0.62, z: bz - 0.51 });
      mb.box(0.8, 0.62, 0.02, GLASS, { x: midX, y: y0, z: bz - 0.51, glow: true });
      signBoard(mb, midX, y0 + 1.1, bz - 0.52, 1.3);
      break;
    }
    case 'grand': {
      block(mb, midX, bz, 4.2, 1.1, 1.4, wall, roof, { y: y0, flat: true });
      for (const s of [1, -1]) {
        const tx = midX + s * 2.4;
        mb.box(0.6, 2.8, 0.6, wall, { x: tx, y: y0, z: bz - 0.1 });
        mb.cone(0.5, 0.8, 4, roof, { x: tx, y: y0 + 2.8, z: bz - 0.1, ry: Math.PI / 4 });
      }
      // central dome + glass atrium on the forecourt
      mb.cyl(0.8, 0.8, 0.3, 16, wall, { x: midX, y: y0 + 1.44, z: bz });
      mb.sphere(0.8, 1, shade(roof, 1.1), { x: midX, y: y0 + 1.74, z: bz, sy: 0.7 });
      mb.cyl(0.03, 0.03, 0.4, 4, 0xd9b45a, { x: midX, y: y0 + 2.3, z: bz });
      mb.box(3.0, 0.95, 0.7, GLASS_MODERN, { x: midX, y: y0, z: bz + 0.9, glow: true });
      mb.box(3.04, 0.05, 0.74, shade(roof, 0.9), { x: midX, y: y0 + 0.95, z: bz + 0.9 });
      mb.torus(0.55, 0.06, Math.PI, shade(wall, 0.7), { x: midX, y: y0 + 0.75, z: bz - 0.56 });
      mb.box(1.1, 0.75, 0.02, GLASS, { x: midX, y: y0, z: bz - 0.56, glow: true });
      signBoard(mb, midX, y0 + 1.3, bz - 0.57, 1.6);
      break;
    }
    case 'hs': {
      // modern glass box with a cantilevered roof and a slim pylon
      mb.box(3.2, 0.9, 1.0, GLASS_MODERN, { x: midX, y: y0, z: bz, glow: true });
      for (let x = -1.5; x <= 1.5; x += 0.5) mb.box(0.04, 0.9, 1.02, 0xf0f2f4, { x: midX + x, y: y0, z: bz });
      mb.box(3.8, 0.08, 1.6, 0xf0f2f4, { x: midX, y: y0 + 0.9, z: bz - 0.2 });
      mb.box(0.18, 2.6, 0.18, 0xf0f2f4, { x: midX + 2.1, y: y0, z: bz });
      mb.box(0.5, 0.3, 0.05, SIGN, { x: midX + 2.1, y: y0 + 2.2, z: bz - 0.12 });
      break;
    }
    default: { // halt / level 0 with more tracks
      block(mb, midX, bz, 1.4, 0.8, 0.62, wall, roof, { y: y0, gable: 0.4 });
    }
  }
}

// head building across the buffer stops of a terminal
function terminalConcourse(mb, kind, style, B, atEnd) {
  const { zMin, zMax, y0 } = B;
  const x = atEnd, w = zMax - zMin + 2.2, zc = (zMax + zMin) / 2;
  const modern = kind === 'hs';
  const wall = modern ? 0xf0f2f4 : style.wall;
  mb.box(1.0, 1.0 + (kind === 'grand' || kind === 'central' ? 0.4 : 0), w, wall, { x, y: y0, z: zc });
  mb.box(1.06, 0.05, w + 0.06, shade(wall, 0.8), { x, y: y0 + 1.0, z: zc });
  if (!modern) mb.roof(w + 0.1, 0.5, 1.12, style.roof, { x, y: y0 + 1.03, z: zc, ry: Math.PI / 2 });
  for (let k = 0; k < Math.floor(w / 0.5); k++) mb.box(0.02, 0.24, 0.14, modern ? GLASS_MODERN : GLASS, { x: x - 0.51 * Math.sign(x || 1), y: y0 + 0.5, z: zMin - 1.05 + 0.25 + k * 0.5, glow: true });
}

// ---------- goods stations ----------
function goodsBuildings(mb, kind, level, style, B, facilities) {
  const { midX, bz, y0, x0, x1, zMin, zMax } = B;
  // warehouse shed with loading doors and corrugated roof
  const ww = Math.min(3.4, 1.8 + level * 0.4);
  mb.box(ww, 0.9, 1.0, 0x9a8a78, { x: midX, y: y0, z: bz });
  mb.roof(ww + 0.12, 0.3, 1.14, 0x5a6068, { x: midX, y: y0 + 0.9, z: bz });
  for (let k = 0; k < Math.floor(ww / 0.6); k++) mb.box(0.36, 0.6, 0.02, 0x5a4a3a, { x: midX - ww / 2 + 0.35 + k * 0.6, y: y0, z: bz - 0.51 });
  mb.box(ww, 0.18, 0.4, 0xa8a296, { x: midX, y: y0, z: bz - 0.7 });                                // loading dock
  if (kind === 'yard' || level >= 2) {
    // yard office + floodlight masts at both ends
    block(mb, x1 - 0.6, bz + 0.1, 0.8, 0.7, 0.66, style.wall, style.roof, { y: y0, gable: 0.3 });
    for (const x of [x0 + 0.2, x1 - 0.2]) for (const z of [zMax + 1.0, zMin - 1.0]) {
      mb.box(0.06, 2.2, 0.06, POST, { x, y: y0, z });
      mb.box(0.3, 0.12, 0.18, LAMP, { x, y: y0 + 2.2, z, glow: true });
    }
  }
  if (kind === 'intermodal' || facilities.includes('container_crane')) {
    // stacked containers along the yard edge
    const cols = [0x2f6fa8, 0xc0502f, 0x3a8a5a, 0xd8a030, 0x7a7f86, 0x8a3a6a];
    for (let k = 0; k < 8; k++) for (let h = 0; h < 1 + (k % 3 === 0 ? 1 : 0); h++) mb.box(0.62, 0.3, 0.3, cols[(k * 3 + h) % cols.length], { x: x0 + 0.5 + k * 0.7, y: y0 + h * 0.3, z: zMin - 1.9 });
  }
}

// facilities on the -z side
function facilityModels(mb, facilities, B) {
  const { x0, zMin, y0 } = B;
  facilities.forEach((f, i) => {
    const fx = x0 + 0.8 + i * 1.6, fz = zMin - 1.45;
    if (f === 'grain_silo') { for (const dx of [-0.3, 0.3]) { mb.cyl(0.28, 0.28, 1.4, 10, 0xd8d0b8, { x: fx + dx, y: y0, z: fz }); mb.cone(0.3, 0.25, 10, 0xb8b0a0, { x: fx + dx, y: y0 + 1.4, z: fz }); } mb.box(0.1, 1.5, 0.1, 0x8a8a80, { x: fx, y: y0, z: fz + 0.3 }); }
    else if (f === 'coal_loader') { mb.box(0.8, 0.9, 0.7, 0x4a4f55, { x: fx, y: y0 + 0.5, z: fz }); for (const s of [-1, 1]) mb.box(0.08, 0.5, 0.08, 0x3a3d42, { x: fx + s * 0.3, y: y0, z: fz }); mb.box(0.3, 0.06, 0.9, 0x2a2c30, { x: fx, y: y0 + 1.0, z: fz + 0.6, rx: -0.4 }); mb.sphere(0.35, 0, 0x1e1e22, { x: fx, y: y0, z: fz - 0.55, sy: 0.5 }); }
    else if (f === 'tank_farm') { for (const dx of [-0.35, 0.35]) { mb.cyl(0.32, 0.32, 0.7, 12, 0xd8dde2, { x: fx + dx, y: y0, z: fz }); mb.cyl(0.33, 0.33, 0.04, 12, 0xc94f4f, { x: fx + dx, y: y0 + 0.5, z: fz }); } mb.box(0.9, 0.04, 0.06, 0x8a5a3a, { x: fx, y: y0 + 0.5, z: fz + 0.3 }); }
    else if (f === 'timber_yard') { for (let k = 0; k < 3; k++) mb.hcyl(0.1, 1.1, 7, 0x9a6b3f, { x: fx, y: y0 + 0.1 + k * 0.17, z: fz - 0.2 + (k % 2) * 0.18 }); mb.box(0.06, 1.2, 0.06, 0xd8a030, { x: fx + 0.6, y: y0, z: fz }); mb.box(0.8, 0.06, 0.06, 0xd8a030, { x: fx + 0.25, y: y0 + 1.15, z: fz }); }
    else if (f === 'container_crane') {
      for (const dx of [-0.5, 0.5]) for (const dz of [-0.35, 0.35]) mb.box(0.08, 1.5, 0.08, 0xd06030, { x: fx + dx, y: y0, z: fz + dz });
      mb.box(1.1, 0.12, 0.8, 0xd06030, { x: fx, y: y0 + 1.5, z: fz });
      mb.box(0.3, 0.2, 0.3, 0x3a3d42, { x: fx + 0.2, y: y0 + 1.3, z: fz });
      mb.box(0.8, 0.42, 0.45, 0x2f6fa8, { x: fx, y: y0, z: fz });
    }
  });
}

// tracks: [{x0, x1, z, y, role, deadEnd:[start,end]}]
// info: { kind, terminal: 0|-1|1 (which end has the buffer stops), cramped }
export function stationComplexModel(mb, level, style, tracks, facilities, cramped, info = {}) {
  const kind = info.kind || (level === 0 ? 'halt' : ['halt', 'village', 'town', 'city', 'central', 'grand'][level]);
  const zs = tracks.map((t) => t.z);
  const zMax = Math.max(...zs), zMin = Math.min(...zs);
  const x0 = Math.min(...tracks.map((t) => t.x0)), x1 = Math.max(...tracks.map((t) => t.x1));
  const midX = (x0 + x1) / 2;
  const y0 = Math.max(...tracks.map((t) => t.y));
  const B = { midX, bz: zMax + 1.55, y0, x0, x1, zMin, zMax };
  const goods = kind === 'freight' || kind === 'yard' || kind === 'intermodal';
  platforms(mb, tracks, kind, level, style.roof);
  if (kind === 'halt' && tracks.length === 1) {
    const tk = tracks[0], cx = (tk.x0 + tk.x1) / 2;
    for (const x of [-0.35, 0.35]) mb.cyl(0.025, 0.025, 0.5, 5, POST, { x: cx + x, y: tk.y + 0.24, z: tk.z + 0.92 });
    mb.box(0.9, 0.05, 0.36, style.roof, { x: cx, y: tk.y + 0.74, z: tk.z + 0.86 });
    mb.box(0.5, 0.06, 0.12, BENCH, { x: cx, y: tk.y + 0.36, z: tk.z + 0.92 });
    mb.box(0.02, 0.18, 0.3, shade(style.wall, 0.9), { x: cx - 0.4, y: tk.y + 0.3, z: tk.z + 0.86 });
    signBoard(mb, cx + 0.3, tk.y + 0.6, tk.z + 1.0, 0.36);
    facilityModels(mb, facilities, B);
    return;
  }
  if (goods) goodsBuildings(mb, kind, level, style, B, facilities);
  else if (info.terminal && level >= 2) {
    // terminal: concourse across the buffer-stop end, smaller side building
    const endX = info.terminal > 0 ? x1 + 0.55 : x0 - 0.55;
    terminalConcourse(mb, kind, style, B, endX);
    passengerBuilding(mb, level >= 4 ? 'town' : 'village', level, style, B);
  } else passengerBuilding(mb, kind, level, style, B);
  // hall over the tracks for big passenger stations. Always open enough to
  // watch the trains: ribs, purlins and glazing strips, never a solid slab.
  if (!goods && level >= 3) {
    const w = zMax - zMin + 2.1, zc = (zMax + zMin) / 2;
    if (kind === 'hs') {
      // louvred roof: transverse beams with glass slats, 50% open
      for (let x = x0 + 0.3; x <= x1 - 0.2; x += 1.6) for (const s of [1, -1]) mb.box(0.06, 1.3, 0.06, 0xf0f2f4, { x, y: y0 + 0.24, z: zc + s * (w / 2 - 0.1) });
      for (const s of [1, -1]) mb.box(x1 - x0, 0.08, 0.1, 0xf0f2f4, { x: midX, y: y0 + 1.54, z: zc + s * (w / 2 - 0.1) });
      for (let x = x0 + 0.5; x < x1 - 0.3; x += 1.0) mb.box(0.45, 0.03, w - 0.2, GLASS_MODERN, { x, y: y0 + 1.58, z: zc, glow: true });
    } else if (level >= 4) {
      // arched train hall: ribs every 0.9, purlins and a glazed ridge lantern
      for (let x = x0 + 0.1; x <= x1 - 0.1; x += 0.9) mb.torus(w / 2, 0.05, Math.PI, STEEL, { x, y: y0 + 1.3, z: zc, ry: Math.PI / 2 });
      for (const a of [0.5, 1.0, 2.14, 2.64]) mb.box(x1 - x0, 0.04, 0.04, STEEL, { x: midX, y: y0 + 1.3 + Math.sin(a) * w / 2, z: zc + Math.cos(a) * w / 2 });
      mb.box(x1 - x0, 0.06, 0.5, GLASS_MODERN, { x: midX, y: y0 + 1.3 + w / 2 + 0.02, z: zc, glow: true });
      for (const s of [1, -1]) mb.box(x1 - x0, 0.3, 0.04, shade(style.wall, 0.9), { x: midX, y: y0 + 1.0, z: zc + s * (w / 2 + 0.02) });
    } else {
      // city station: skylights along every platform canopy (tracks stay open)
      for (const tk of tracks) if (tk.role !== 'through') for (const s of [1, -1]) mb.box(tk.x1 - tk.x0 - 0.4, 0.03, 0.18, GLASS_MODERN, { x: (tk.x0 + tk.x1) / 2, y: tk.y + 0.9, z: tk.z + s * 0.86, glow: true });
    }
  }
  // footbridge across the tracks
  if (tracks.length > 1 && !cramped && !goods) {
    const bx = x1 - 0.7, zc = (zMax + zMin) / 2, w = zMax - zMin + 1.9;
    const h = level >= 3 ? 1.55 : 1.45;
    const col = kind === 'hs' ? 0xe8ecef : 0x7a7f86;
    mb.box(0.5, 0.06, w, col, { x: bx, y: y0 + h, z: zc });
    for (const s of [1, -1]) mb.box(0.02, 0.24, w, shade(col, 0.8), { x: bx + s * 0.24, y: y0 + h + 0.06, z: zc });
    for (const tk of tracks) for (const s of [1, -1]) {
      if (tk.role === 'through') continue;
      mb.box(0.12, h, 0.12, shade(col, 0.9), { x: bx, y: tk.y + 0.24, z: tk.z + s * 0.9 });
    }
    if (level >= 2) mb.box(0.56, 0.05, w, kind === 'hs' ? GLASS_MODERN : style.roof, { x: bx, y: y0 + h + 0.46, z: zc, glow: kind === 'hs' });
  }
  facilityModels(mb, facilities, B);
}

export function depotModel(mb) {
  const wall = 0x9a6a4a, roof = 0x4a4f58;
  mb.box(1.5, 0.08, 1.2, 0x7a7068, { y: 0 });
  mb.box(1.4, 0.95, 0.1, wall, { y: 0, z: 0.55 });
  mb.box(1.4, 0.95, 0.1, wall, { y: 0, z: -0.55 });
  mb.box(0.1, 0.95, 1.2, wall, { x: -0.7, y: 0 });
  mb.box(0.1, 0.25, 1.2, wall, { x: 0.7, y: 0.7 });
  mb.roof(1.6, 0.45, 1.34, roof, { y: 0.95 });
  mb.box(0.08, 0.7, 0.14, shade(wall, 0.7), { x: 0.72, y: 0, z: 0.5 });
  mb.box(0.08, 0.7, 0.14, shade(wall, 0.7), { x: 0.72, y: 0, z: -0.5 });
  mb.box(0.3, 0.6, 0.02, 0x3a4a5a, { x: -0.2, y: 0.25, z: 0.61, glow: true });
  mb.box(0.3, 0.6, 0.02, 0x3a4a5a, { x: -0.2, y: 0.25, z: -0.61, glow: true });
  mb.cyl(0.06, 0.07, 0.4, 6, 0x5a5a5a, { x: -0.4, y: 1.2, z: 0.3 });
  mb.box(0.4, 0.16, 0.03, 0xe0a33a, { x: 0.74, y: 1.02, rz: 0, ry: Math.PI / 2 });
  for (const z of [0.36, -0.36]) mb.box(0.2, 0.04, 0.02, 0xe0a33a, { x: 0.8, y: 0.02, z });   // pit markings
}

// Legacy single-tile model (title scene / previews)
export function stationModel(mb, level, style) {
  stationComplexModel(mb, level, style, [{ x0: -1, x1: 1, z: 0, y: 0, role: 'any', deadEnd: [false, false] }], [], false);
}
