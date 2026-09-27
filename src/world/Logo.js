// Company logo (Phase 8): a badge made of a shape, a symbol or the company's
// initials, the company colour and a second colour. Drawn as SVG for the
// interface and on a canvas for the sign on the headquarters. "Surprise me"
// picks a new combination from the company name and a counter, so the same
// name and counter always give the same logo.
import { hashStr } from '../util.js';

export const LOGO_SHAPES = ['circle', 'shield', 'diamond', 'roundel', 'square', 'hexagon'];
export const LOGO_SYMBOLS = ['initials', 'wheel', 'star', 'arrow', 'leaf', 'bolt', 'wave', 'mountain'];
export const LOGO_COLORS2 = [0xffffff, 0xf2d06b, 0x1f2a36, 0xd8483a, 0x7fc6e8, 0xe8e2d4];

export function initials(name) {
  const w = String(name || '').trim().split(/\s+/).filter(Boolean);
  const s = w.length >= 2 ? w[0][0] + w[1][0] : (w[0] || 'TL').slice(0, 2);
  return s.toUpperCase().replace(/[^A-Z0-9ÄÖÜ]/g, '').slice(0, 2) || 'TL';
}
export function defaultLogo() { return { shape: 'circle', symbol: 'initials', color2: 0xffffff, seed: 0 }; }
export function cleanLogo(d) {
  const L = defaultLogo();
  if (!d || typeof d !== 'object') return L;
  if (LOGO_SHAPES.includes(d.shape)) L.shape = d.shape;
  if (LOGO_SYMBOLS.includes(d.symbol)) L.symbol = d.symbol;
  if (LOGO_COLORS2.includes(d.color2)) L.color2 = d.color2;
  L.seed = Math.max(0, Math.min(1e6, d.seed | 0));
  return L;
}
export function randomLogo(name, seed) {
  const h = hashStr(`${name}:${seed}`);
  return { shape: LOGO_SHAPES[h % LOGO_SHAPES.length], symbol: LOGO_SYMBOLS[(h >>> 4) % LOGO_SYMBOLS.length], color2: LOGO_COLORS2[(h >>> 9) % LOGO_COLORS2.length], seed };
}

const hex = (c) => '#' + (c >>> 0).toString(16).padStart(6, '0').slice(-6);
// the outline of a shape on a 100×100 box
function shapePath(shape) {
  switch (shape) {
    case 'shield': return 'M50 4 L92 18 L88 58 Q80 84 50 96 Q20 84 12 58 L8 18 Z';
    case 'diamond': return 'M50 3 L97 50 L50 97 L3 50 Z';
    case 'square': return 'M10 6 H90 Q94 6 94 10 V90 Q94 94 90 94 H10 Q6 94 6 90 V10 Q6 6 10 6 Z';
    case 'hexagon': return 'M50 3 L91 26 L91 74 L50 97 L9 74 L9 26 Z';
    default: return 'M50 3 A47 47 0 1 1 49.9 3 Z';          // circle and roundel
  }
}
function symbolSVG(sym, c2, text) {
  switch (sym) {
    case 'wheel': return `<circle cx="50" cy="50" r="24" fill="none" stroke="${c2}" stroke-width="7"/><circle cx="50" cy="50" r="6" fill="${c2}"/>${[0, 45, 90, 135].map((a) => `<line x1="50" y1="26" x2="50" y2="74" stroke="${c2}" stroke-width="4" transform="rotate(${a} 50 50)"/>`).join('')}`;
    case 'star': return `<path d="M50 20 L58 42 L82 42 L63 56 L70 79 L50 65 L30 79 L37 56 L18 42 L42 42 Z" fill="${c2}"/>`;
    case 'arrow': return `<path d="M22 58 H58 V72 L82 50 L58 28 V42 H22 Z" fill="${c2}"/>`;
    case 'leaf': return `<path d="M28 72 Q26 30 72 26 Q76 66 34 70 Z" fill="${c2}"/><path d="M30 70 L62 38" stroke-width="3" stroke="rgba(0,0,0,.25)"/>`;
    case 'bolt': return `<path d="M56 16 L30 56 H48 L42 84 L70 42 H52 Z" fill="${c2}"/>`;
    case 'wave': return `<path d="M18 46 Q30 34 42 46 T66 46 T84 46 V58 Q72 70 60 58 T36 58 T18 58 Z" fill="${c2}"/>`;
    case 'mountain': return `<path d="M16 74 L40 34 L52 52 L62 40 L84 74 Z" fill="${c2}"/>`;
    default: return `<text x="50" y="${text.length > 1 ? 63 : 65}" text-anchor="middle" font-family="system-ui, sans-serif" font-weight="800" font-size="${text.length > 1 ? 36 : 44}" fill="${c2}">${text}</text>`;
  }
}
// the logo as an SVG string (size in px)
export function logoSVG(logo, color, name, size = 48) {
  const L = cleanLogo(logo), c1 = hex(color), c2 = hex(L.color2);
  const ring = L.shape === 'roundel' ? `<path d="M50 14 A36 36 0 1 1 49.9 14 Z" fill="none" stroke="${c2}" stroke-width="5"/>` : '';
  return `<svg class="logo-svg" width="${size}" height="${size}" viewBox="0 0 100 100" role="img" aria-label="${initials(name)}"><path d="${shapePath(L.shape)}" fill="${c1}" stroke="rgba(0,0,0,.25)" stroke-width="2"/>${ring}${symbolSVG(L.symbol, c2, initials(name))}</svg>`;
}
// the logo on a canvas (for the headquarters' sign); returns the canvas
export function logoCanvas(logo, color, name, px = 128) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = px;
  const ctx = cv.getContext('2d');
  const L = cleanLogo(logo);
  ctx.scale(px / 100, px / 100);
  ctx.fillStyle = hex(color);
  ctx.fill(new Path2D(shapePath(L.shape)));
  // symbols: draw the same paths (text for initials)
  ctx.fillStyle = hex(L.color2); ctx.strokeStyle = hex(L.color2);
  const sym = { star: 'M50 20 L58 42 L82 42 L63 56 L70 79 L50 65 L30 79 L37 56 L18 42 L42 42 Z', arrow: 'M22 58 H58 V72 L82 50 L58 28 V42 H22 Z', leaf: 'M28 72 Q26 30 72 26 Q76 66 34 70 Z', bolt: 'M56 16 L30 56 H48 L42 84 L70 42 H52 Z', wave: 'M18 46 Q30 34 42 46 T66 46 T84 46 V58 Q72 70 60 58 T36 58 T18 58 Z', mountain: 'M16 74 L40 34 L52 52 L62 40 L84 74 Z' }[L.symbol];
  if (L.shape === 'roundel') { ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(50, 50, 36, 0, Math.PI * 2); ctx.stroke(); }
  if (sym) ctx.fill(new Path2D(sym));
  else if (L.symbol === 'wheel') { ctx.lineWidth = 7; ctx.beginPath(); ctx.arc(50, 50, 24, 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = 4; for (const a of [0, 45, 90, 135]) { const r = (a * Math.PI) / 180; ctx.beginPath(); ctx.moveTo(50 - Math.sin(r) * 24, 50 - Math.cos(r) * 24); ctx.lineTo(50 + Math.sin(r) * 24, 50 + Math.cos(r) * 24); ctx.stroke(); } }
  else { const t = initials(name); ctx.font = `800 ${t.length > 1 ? 36 : 44}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.fillText(t, 50, t.length > 1 ? 63 : 65); }
  return cv;
}
