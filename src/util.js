// Shared helpers: grid math, deterministic randomness, noise, formatting, events.

// logical tiles per side. A game picks its map size before the world is
// built (setMapSize); every module reads N through the live ES binding.
export const MAP_SIZES = [64, 96, 128, 192];
export let N = 64;
export function setMapSize(n) { N = MAP_SIZES.includes(n) ? n : 64; return N; }
export const TILE = 2;          // world units per tile
export const WATER_LEVEL = -0.12;

// 8 directions: 0=E 1=SE 2=S 3=SW 4=W 5=NW 6=N 7=NE  (x right, z down/south)
export const DX = [1, 1, 0, -1, -1, -1, 0, 1];
export const DZ = [0, 1, 1, 1, 0, -1, -1, -1];
export const DLEN = [1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2];
export const opp = (d) => (d + 4) & 7;
export const turnOf = (a, b) => { const t = Math.abs(a - b); return t > 4 ? 8 - t : t; };
export const idx = (x, z) => z * N + x;
export const tx = (i) => i % N;
export const tz = (i) => (i / N) | 0;
export const inMap = (x, z) => x >= 0 && z >= 0 && x < N && z < N;
export const step = (i, d) => { const x = tx(i) + DX[d], z = tz(i) + DZ[d]; return inMap(x, z) ? idx(x, z) : -1; };
export const cheb = (a, b) => Math.max(Math.abs(tx(a) - tx(b)), Math.abs(tz(a) - tz(b)));
export const dirBetween = (a, b) => {
  const dx = Math.sign(tx(b) - tx(a)), dz = Math.sign(tz(b) - tz(a));
  for (let d = 0; d < 8; d++) if (DX[d] === dx && DZ[d] === dz) return d;
  return -1;
};
export const tileCX = (i) => (tx(i) + 0.5) * TILE;
export const tileCZ = (i) => (tz(i) + 0.5) * TILE;
export const worldToTile = (x, z) => {
  const gx = Math.floor(x / TILE), gz = Math.floor(z / TILE);
  return inMap(gx, gz) ? idx(gx, gz) : -1;
};

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeOutBack = (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
export const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export class RNG {
  constructor(seed) { this.s = (typeof seed === 'string' ? hashStr(seed) : seed >>> 0) || 1; }
  next() {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a, b) { return a + (b - a) * this.next(); }
  int(a, b) { return Math.floor(this.range(a, b + 1)); }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  chance(p) { return this.next() < p; }
  shuffle(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(this.next() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }
}

// Seeded 2D gradient noise (Perlin style) with fractal helper.
export class Noise2D {
  constructor(seed) {
    const r = new RNG(seed);
    this.p = new Uint8Array(512);
    const perm = [];
    for (let i = 0; i < 256; i++) perm.push(i);
    r.shuffle(perm);
    for (let i = 0; i < 512; i++) this.p[i] = perm[i & 255];
  }
  grad(h, x, y) {
    switch (h & 7) {
      case 0: return x + y; case 1: return x - y; case 2: return -x + y; case 3: return -x - y;
      case 4: return x; case 5: return -x; case 6: return y; default: return -y;
    }
  }
  noise(x, y) {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x), yf = y - Math.floor(y);
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10), v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const p = this.p;
    const aa = p[p[X] + Y], ab = p[p[X] + Y + 1], ba = p[p[X + 1] + Y], bb = p[p[X + 1] + Y + 1];
    const x1 = lerp(this.grad(aa, xf, yf), this.grad(ba, xf - 1, yf), u);
    const x2 = lerp(this.grad(ab, xf, yf - 1), this.grad(bb, xf - 1, yf - 1), u);
    return lerp(x1, x2, v) * 0.7071;
  }
  fbm(x, y, oct = 4) {
    let a = 1, f = 1, s = 0, n = 0;
    for (let i = 0; i < oct; i++) { s += this.noise(x * f, y * f) * a; n += a; a *= 0.5; f *= 2.03; }
    return s / n;
  }
}

export function fmt(n) {
  if (n === Infinity) return '∞';
  const neg = n < 0; n = Math.abs(n);
  let s;
  if (n < 10000) s = Math.floor(n).toLocaleString('en-US');
  else if (n < 1e6) s = (n / 1e3).toFixed(n < 1e5 ? 1 : 0) + 'K';
  else if (n < 1e9) s = (n / 1e6).toFixed(n < 1e8 ? 1 : 0) + 'M';
  else s = (n / 1e9).toFixed(1) + 'B';
  return (neg ? '-' : '') + s;
}

export function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

export class Emitter {
  constructor() { this.h = new Map(); }
  on(ev, fn) { if (!this.h.has(ev)) this.h.set(ev, new Set()); this.h.get(ev).add(fn); return () => this.off(ev, fn); }
  off(ev, fn) { const s = this.h.get(ev); if (s) s.delete(fn); }
  emit(ev, a, b, c) {
    const s = this.h.get(ev); if (!s) return;
    for (const fn of Array.from(s)) {
      try { fn(a, b, c); } catch (e) { console.error('event handler error', ev, e); }
    }
  }
}

export function dateKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
