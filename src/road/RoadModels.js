// Low-poly models for road transport: one silhouette per bus family (the
// white parts take the livery through the instance colour), the bus stop
// types from a pole to an interchange, the bus garage and a waiting person.
// Every bus shape also says where its doors are (local x, on the kerb side)
// and where its destination sign sits (it shows the line colour).
import * as THREE from 'three';
import { ModelBuilder } from '../core/ModelBuilder.js';

const GLASS = 0x9fc8e6, DARKGLASS = 0x3a4a5a, TYRE = 0x2a2c30, LAMP = 0xfff2c0, TRIM = 0xd0d4d8, ROOF = 0xe8e8ea;
const W = 0.26;   // body width (z)

function wheels(b, xs, r = 0.05) { for (const x of xs) b.wheel(r, W + 0.01, 8, TYRE, { x, y: r }); }
function lamps(b, x, y, dz = 0.08) { b.box(0.02, 0.04, 0.05, LAMP, { x, y, z: dz, glow: true }); b.box(0.02, 0.04, 0.05, LAMP, { x, y, z: -dz, glow: true }); }

// shape -> { build(b), len, doors: [x...], sign: [x, y] }
export const BUS_SHAPES = {
  mini: {
    len: 0.42, doors: [0.08], sign: [0.19, 0.3],
    build(b) {
      b.box(0.42, 0.22, W, 0xffffff, { y: 0.06 });
      b.taper(0.08, 0.2, 0.2, 0.2, 0.1, 0xffffff, { x: 0.23, y: 0.06 });
      b.box(0.3, 0.08, W + 0.005, GLASS, { x: -0.02, y: 0.17 });
      b.box(0.02, 0.1, 0.2, GLASS, { x: 0.215, y: 0.16 });
      wheels(b, [-0.13, 0.13], 0.045); lamps(b, 0.27, 0.1, 0.07);
    },
  },
  classic: {
    len: 0.62, doors: [0.24, -0.02], sign: [0.3, 0.33],
    build(b) {
      b.box(0.62, 0.24, W, 0xffffff, { y: 0.06 });
      b.box(0.58, 0.035, W - 0.03, ROOF, { y: 0.3 });
      b.box(0.52, 0.09, W + 0.005, GLASS, { x: 0.0, y: 0.18 });
      b.box(0.02, 0.11, 0.22, GLASS, { x: 0.31, y: 0.17 });
      b.box(0.62, 0.025, W + 0.006, TRIM, { y: 0.1 });
      wheels(b, [-0.2, 0.2]); lamps(b, 0.312, 0.1);
    },
  },
  urban: {
    len: 0.66, doors: [0.26, 0.02], sign: [0.32, 0.33],
    build(b) {
      b.box(0.66, 0.25, W, 0xffffff, { y: 0.045 });
      b.box(0.6, 0.12, W + 0.005, GLASS, { x: 0.01, y: 0.155 });
      b.box(0.02, 0.17, 0.23, GLASS, { x: 0.331, y: 0.11 });
      b.box(0.22, 0.05, 0.16, 0xbfc3c8, { x: -0.12, y: 0.295 });   // roof air conditioning
      wheels(b, [-0.22, 0.2], 0.045); lamps(b, 0.332, 0.08);
    },
  },
  coach: {
    len: 0.76, doors: [0.3], sign: [0.37, 0.37],
    build(b) {
      b.box(0.7, 0.3, W, 0xffffff, { y: 0.06 });
      b.taper(0.07, W, 0.3, W, 0.2, 0xffffff, { x: 0.385, y: 0.06 });
      b.box(0.6, 0.1, W + 0.005, DARKGLASS, { x: -0.03, y: 0.23 });
      b.box(0.02, 0.13, 0.23, DARKGLASS, { x: 0.36, y: 0.2 });
      for (const x of [-0.22, -0.06, 0.1]) b.box(0.12, 0.08, W + 0.004, 0xd8dade, { x, y: 0.08 });   // luggage bays
      wheels(b, [-0.24, -0.14, 0.24]); lamps(b, 0.42, 0.1);
    },
  },
  decker: {
    len: 0.64, doors: [0.25, -0.05], sign: [0.31, 0.5],
    build(b) {
      b.box(0.64, 0.44, W, 0xffffff, { y: 0.06 });
      b.box(0.56, 0.08, W + 0.005, GLASS, { x: 0.0, y: 0.17 });
      b.box(0.6, 0.08, W + 0.005, GLASS, { x: 0.0, y: 0.36 });
      b.box(0.02, 0.2, 0.22, GLASS, { x: 0.321, y: 0.26 });
      b.box(0.62, 0.02, W - 0.02, ROOF, { y: 0.5 });
      wheels(b, [-0.2, 0.2]); lamps(b, 0.322, 0.1);
    },
  },
  artic: {
    len: 1.02, doors: [0.4, 0.14, -0.32], sign: [0.5, 0.33],
    build(b) {
      b.box(0.56, 0.25, W, 0xffffff, { x: 0.23, y: 0.045 });
      b.box(0.42, 0.25, W, 0xffffff, { x: -0.3, y: 0.045 });
      b.hcyl(0.11, 0.08, 8, 0x2a2c30, { x: -0.05, y: 0.17 });    // bellows
      b.box(0.5, 0.12, W + 0.005, GLASS, { x: 0.23, y: 0.155 });
      b.box(0.36, 0.12, W + 0.005, GLASS, { x: -0.3, y: 0.155 });
      b.box(0.02, 0.17, 0.23, GLASS, { x: 0.511, y: 0.11 });
      wheels(b, [0.38, 0.06, -0.42], 0.045); lamps(b, 0.512, 0.08);
    },
  },
  shuttle: {
    len: 0.6, doors: [0.2, -0.08], sign: [0.29, 0.33],
    build(b) {
      b.box(0.6, 0.25, W, 0xffffff, { y: 0.05 });
      b.box(0.54, 0.1, W + 0.005, GLASS, { y: 0.17 });
      b.box(0.6, 0.03, W + 0.006, 0x2f6fb0, { y: 0.1 });
      b.box(0.34, 0.02, 0.2, 0x8a9096, { x: -0.06, y: 0.31 });   // luggage rack
      b.box(0.3, 0.05, 0.16, 0x6a7078, { x: -0.06, y: 0.33 });
      b.box(0.02, 0.12, 0.22, GLASS, { x: 0.301, y: 0.16 });
      wheels(b, [-0.19, 0.19]); lamps(b, 0.302, 0.09);
    },
  },
  electric: {
    len: 0.66, doors: [0.26, 0.02], sign: [0.33, 0.33],
    build(b) {
      b.box(0.6, 0.25, W, 0xffffff, { x: -0.03, y: 0.045 });
      b.taper(0.07, W, 0.25, W, 0.19, 0xffffff, { x: 0.3, y: 0.045 });
      b.box(0.6, 0.13, W + 0.005, GLASS, { x: 0.0, y: 0.15 });
      b.box(0.6, 0.02, W + 0.006, 0x3fae5a, { y: 0.075 });        // green stripe
      for (const x of [-0.2, 0.02]) b.box(0.18, 0.05, 0.18, 0x5a6a5e, { x, y: 0.295 });   // battery pods
      wheels(b, [-0.22, 0.2], 0.045); lamps(b, 0.34, 0.08);
    },
  },
  express: {
    len: 0.82, doors: [0.32], sign: [0.4, 0.37],
    build(b) {
      b.box(0.72, 0.3, W, 0xffffff, { x: -0.04, y: 0.06 });
      b.taper(0.1, W, 0.3, W, 0.16, 0xffffff, { x: 0.37, y: 0.06 });
      b.box(0.74, 0.11, W + 0.005, DARKGLASS, { x: -0.01, y: 0.22 });
      b.box(0.76, 0.02, W + 0.006, 0xc0392b, { y: 0.12 });
      wheels(b, [-0.27, -0.17, 0.25]); lamps(b, 0.42, 0.1);
    },
  },
  eartic: {
    len: 1.04, doors: [0.4, 0.14, -0.32], sign: [0.51, 0.33],
    build(b) {
      b.box(0.5, 0.25, W, 0xffffff, { x: 0.2, y: 0.045 });
      b.taper(0.07, W, 0.25, W, 0.19, 0xffffff, { x: 0.485, y: 0.045 });
      b.box(0.44, 0.25, W, 0xffffff, { x: -0.3, y: 0.045 });
      b.hcyl(0.11, 0.08, 8, 0x2a2c30, { x: -0.05, y: 0.17 });
      b.box(0.52, 0.13, W + 0.005, GLASS, { x: 0.22, y: 0.15 });
      b.box(0.38, 0.13, W + 0.005, GLASS, { x: -0.3, y: 0.15 });
      for (const x of [0.12, 0.34, -0.32]) b.box(0.16, 0.05, 0.18, 0x5a6a5e, { x, y: 0.295 });
      wheels(b, [0.36, 0.06, -0.42], 0.045); lamps(b, 0.52, 0.08);
    },
  },
  pod: {
    len: 0.36, doors: [0.0], sign: [0.0, 0.3],
    build(b) {
      b.box(0.3, 0.2, W - 0.02, 0xffffff, { y: 0.05 });
      b.taper(0.04, W - 0.02, 0.2, W - 0.06, 0.14, 0xffffff, { x: 0.17, y: 0.05 });
      b.taper(0.04, W - 0.06, 0.14, W - 0.02, 0.2, 0xffffff, { x: -0.17, y: 0.05, yb1: -0.03 });
      b.box(0.3, 0.1, W - 0.015, GLASS, { y: 0.13 });
      b.box(0.24, 0.03, 0.16, 0x4a5058, { y: 0.25 });             // sensor ring
      wheels(b, [-0.1, 0.1], 0.04); lamps(b, 0.19, 0.09, 0.06);
    },
  },
};

// trucks, trams, ships and aircraft: one model per kind (white takes the livery)
export const VEHICLE_MODELS = {
  truck(b) {
    b.box(0.18, 0.22, 0.24, 0xffffff, { x: 0.22, y: 0.05 });
    b.box(0.4, 0.2, 0.26, 0xd8d2c4, { x: -0.1, y: 0.07 });
    b.box(0.04, 0.05, 0.18, 0xfff2c0, { x: 0.31, y: 0.1, glow: true });
  },
  tram(b) {
    b.box(0.95, 0.26, 0.26, 0xffffff, { y: 0.06 });
    b.box(0.85, 0.09, 0.27, 0xbfdcec, { y: 0.19 });
    b.box(0.95, 0.03, 0.2, 0x3a4250, { y: 0.33 });
    b.box(0.02, 0.2, 0.02, 0x3a4250, { x: 0.1, y: 0.44, rz: 0.5 });
    b.box(0.04, 0.06, 0.2, 0xfff2c0, { x: 0.48, y: 0.12, glow: true });
  },
  dock(b) {
    b.box(1.5, 0.22, 0.46, 0xffffff, { y: 0.0 });
    b.box(0.22, 0.2, 0.3, 0xffffff, { x: 0.82, y: 0.0 });
    b.box(0.46, 0.26, 0.36, 0xeef0f2, { x: -0.4, y: 0.22 });
    b.box(0.4, 0.06, 0.3, 0x3a4a5a, { x: -0.4, y: 0.34, glow: true });
    b.cyl(0.06, 0.07, 0.3, 6, 0x3a3d42, { x: -0.55, y: 0.48 });
    b.box(0.7, 0.1, 0.34, 0x8a6f63, { x: 0.3, y: 0.16 });
  },
  airport(b) {
    b.cyl(0.1, 0.1, 1.4, 8, 0xffffff, { rz: Math.PI / 2, center: true });
    b.cone(0.1, 0.24, 8, 0xffffff, { x: 0.82, rz: -Math.PI / 2, center: true });
    b.box(0.34, 0.03, 1.6, 0xffffff, { x: 0.05 });
    b.box(0.18, 0.03, 0.6, 0xffffff, { x: -0.62, y: 0.04 });
    b.box(0.2, 0.28, 0.03, 0xffffff, { x: -0.62, y: 0.16 });
    b.box(0.5, 0.05, 0.2, 0x3a4a5a, { x: 0.25, y: 0.06 });
  },
};
// geometry of one road/water/air vehicle model in its own colour (previews)
export function roadVehicleGeometry(m) {
  const b = new ModelBuilder();
  if (m.kind === 'bus' && BUS_SHAPES[m.shape]) BUS_SHAPES[m.shape].build(b);
  else (VEHICLE_MODELS[m.kind] || VEHICLE_MODELS.truck)(b);
  const geo = b.build();
  // the white livery parts take the model colour, like the instance colour in the world
  const col = geo.getAttribute('color');
  if (col) {
    const c = new THREE.Color(m.color);
    for (let i = 0; i < col.count; i++) if (col.getX(i) > 0.97 && col.getY(i) > 0.97 && col.getZ(i) > 0.97) col.setXYZ(i, c.r, c.g, c.b);
  }
  return geo;
}

// bus stop types; the kerb (road) is toward -z, the land side +z
export function stopModel(type) {
  const b = new ModelBuilder();
  const POLE = 0x3a4250, SIGN = 0xffffff;
  const shelter = (x = 0, w = 0.5) => {
    b.box(w, 0.03, 0.2, POLE, { x, y: 0.34 });
    b.cyl(0.02, 0.02, 0.34, 5, POLE, { x: x - w / 2 + 0.03, z: 0.08 });
    b.cyl(0.02, 0.02, 0.34, 5, POLE, { x: x + w / 2 - 0.03, z: 0.08 });
    b.box(w - 0.04, 0.22, 0.02, 0xbfd8e6, { x, z: 0.09, y: 0.1 });
    b.box(w * 0.6, 0.03, 0.07, 0x8a6f63, { x, z: 0.04, y: 0.1 });    // bench
  };
  const sign = (x, h = 0.46) => { b.cyl(0.015, 0.015, h, 5, POLE, { x, z: -0.08 }); b.box(0.12, 0.12, 0.02, SIGN, { x, z: -0.08, y: h - 0.08 }); };
  switch (type) {
    case 'basic':
      sign(0, 0.44);
      b.box(0.2, 0.03, 0.06, 0x8a6f63, { x: 0.14, z: 0.04, y: 0.08 });
      break;
    case 'urban':
      shelter(); sign(0.3);
      b.cyl(0.015, 0.02, 0.6, 5, POLE, { x: -0.34, z: 0.06 }); b.box(0.08, 0.03, 0.06, LAMP, { x: -0.34, y: 0.6, z: 0.03, glow: true });
      break;
    case 'bay':
      shelter(0.1, 0.6); sign(0.46);
      b.box(1.1, 0.012, 0.26, 0xd8c070, { z: -0.3, y: 0.005 });     // the bay marking in the kerb
      b.box(1.0, 0.014, 0.2, 0x5a5854, { z: -0.3, y: 0.006 });
      break;
    case 'station':
      b.box(1.8, 0.05, 0.5, 0xc8c2b6, { z: 0.1 });                 // platform
      b.box(1.7, 0.035, 0.46, 0x3a4250, { z: 0.1, y: 0.4 });       // canopy
      for (const x of [-0.8, 0, 0.8]) b.cyl(0.025, 0.025, 0.38, 5, POLE, { x, z: 0.3 });
      b.box(1.2, 0.46, 0.8, 0xd8d2c4, { z: 0.95, x: 0 });           // station building on the land beside
      b.roof(1.3, 0.2, 0.9, 0x7a3f33, { z: 0.95, y: 0.46 });
      b.box(0.5, 0.14, 0.02, 0x3a4a5a, { z: 0.54, y: 0.22, glow: true });
      sign(0.9, 0.6);
      break;
    case 'terminal':
    case 'interchange':
      b.box(2.4, 0.05, 0.9, 0xc8c2b6, { z: 0.2 });
      b.box(2.3, 0.04, 0.8, 0x3a4250, { z: 0.25, y: 0.46 });       // long canopy over the bays
      for (const x of [-1.1, -0.35, 0.35, 1.1]) b.cyl(0.03, 0.03, 0.44, 5, POLE, { x, z: 0.6 });
      b.box(1.9, 0.66, 1.2, 0xe2dccf, { z: 1.6 });                  // terminal hall on the land beside
      b.box(1.8, 0.2, 0.02, 0x3a4a5a, { z: 0.99, y: 0.34, glow: true });
      b.box(2.0, 0.06, 1.3, 0x6a7078, { z: 1.6, y: 0.66 });
      b.box(0.24, 1.2, 0.24, 0xd8d2c4, { x: 0.8, z: 1.2 });         // clock tower
      b.box(0.16, 0.16, 0.02, 0xffffff, { x: 0.8, z: 1.07, y: 1.0, glow: true });
      if (type === 'interchange') {
        b.box(0.9, 0.5, 0.9, 0xbfd8e6, { x: -0.7, z: 1.5, y: 0.66 });   // glass concourse to the trains
        b.cyl(0.04, 0.04, 1.4, 6, POLE, { x: -1.15, z: 0.7 });
        b.box(0.3, 0.3, 0.04, 0xd8483a, { x: -1.15, z: 0.7, y: 1.2 });   // interchange pylon
        b.box(0.18, 0.04, 0.05, 0xffffff, { x: -1.15, z: 0.68, y: 1.3, glow: true });
      }
      sign(1.2, 0.7);
      break;
    default: sign(0);
  }
  return b.build();
}

// the bus garage: a shed on the land beside the road, doors toward it
export function garageModel() {
  const b = new ModelBuilder();
  b.box(1.6, 0.03, 0.6, 0x6a6660, { z: 0.35 });                      // forecourt
  b.box(1.5, 0.6, 1.2, 0xd8d2c4, { z: 1.25 });
  b.box(1.6, 0.06, 1.3, 0x5a6470, { z: 1.25, y: 0.6 });
  for (const x of [-0.4, 0.4]) b.box(0.5, 0.42, 0.02, 0x8a9096, { x, z: 0.64 });
  b.box(0.6, 0.12, 0.02, 0x2f6b4a, { z: 0.64, y: 0.48 });
  b.cyl(0.02, 0.02, 0.5, 5, 0x3a4250, { x: 0.75, z: 0.1 });
  b.box(0.14, 0.14, 0.02, 0xffffff, { x: 0.75, z: 0.1, y: 0.42 });
  return b.build();
}

// a waiting traveller
export function personModel() {
  const b = new ModelBuilder();
  b.cyl(0.028, 0.034, 0.12, 6, 0xffffff, {});
  b.sphere(0.028, 1, 0xe8c4a0, { y: 0.15 });
  return b.build();
}
export function doorModel() {
  const b = new ModelBuilder();
  b.box(0.075, 0.15, 0.01, 0xffffff, {});
  return b.build();
}
export function signModel() {
  const b = new ModelBuilder();
  b.box(0.012, 0.035, 0.14, 0xffffff, { glow: true });
  return b.build();
}
