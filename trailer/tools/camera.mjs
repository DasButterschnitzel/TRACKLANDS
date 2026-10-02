// Scripted trailer camera paths (development only).
//
// A path is a list of keys along the shot; the whole move is eased (slow in,
// slow out) and passes smoothly through every key (Catmull-Rom):
//
//   { "ease": "inOut", "keys": [
//       { "x": 120, "z": 88, "zoom": 14, "az": 45, "elev": 0.64 },
//       { "x": 132, "z": 92, "zoom": 11, "az": 60 } ],
//     "follow": { "train": 3, "dx": 2, "dz": -1 } }
//
// x/z: the point looked at, in world units (2 per tile); zoom: half the view
// height in world units (smaller = closer); az: compass angle in degrees;
// elev: camera elevation in radians (the game's default is 0.64). Missing
// values repeat the previous key. "at" (0..1) places a key in time; keys
// without it are spread evenly. With "follow" the keys' x/z are ignored
// and the camera tracks the vehicle softly (zoom, az and elev still move).
const EASE = {
  linear: (u) => u,
  inOut: (u) => u * u * (3 - 2 * u),
  inOutStrong: (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2),
  in: (u) => u * u,
  out: (u) => 1 - (1 - u) * (1 - u),
};
const FIELDS = ['x', 'z', 'zoom', 'az', 'elev'];

function filled(keys) {
  const out = [];
  let prev = { elev: 0.64, az: 45 };
  keys.forEach((k, i) => {
    const o = { ...prev, ...k };
    o.at = k.at ?? (keys.length === 1 ? 0 : i / (keys.length - 1));
    out.push(o);
    prev = o;
  });
  return out;
}

const cr = (p0, p1, p2, p3, s) => 0.5 * ((2 * p1) + (-p0 + p2) * s + (2 * p0 - 5 * p1 + 4 * p2 - p3) * s * s + (-p0 + 3 * p1 - 3 * p2 + p3) * s * s * s);

export function evalCamera(cam, t, duration) {
  const keys = filled(cam.keys || []);
  const u = (EASE[cam.ease || 'inOut'] || EASE.inOut)(Math.max(0, Math.min(1, t / Math.max(1e-6, duration))));
  let i = 0;
  while (i < keys.length - 2 && u > keys[i + 1].at) i++;
  const a = keys[i], b = keys[Math.min(i + 1, keys.length - 1)];
  const s = b.at > a.at ? (u - a.at) / (b.at - a.at) : 0;
  const p0 = keys[Math.max(0, i - 1)], p3 = keys[Math.min(keys.length - 1, i + 2)];
  const out = {};
  for (const f of FIELDS) out[f] = keys.length === 1 ? a[f] : cr(p0[f], a[f], b[f], p3[f], Math.max(0, Math.min(1, s)));
  out.az = out.az * Math.PI / 180;
  if (cam.follow) out.follow = cam.follow;
  return out;
}
