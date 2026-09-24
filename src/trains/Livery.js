// Train liveries. A livery is stored as a short token: a preset id from
// LIVERIES ('royal_blue') or a custom mix 'c.BBBBBB.TTTTTT.AAAAAA.RRRRRR.style'
// (hex colours for body, trim, accent and roof; '-' = derived from the body;
// style none|line|double|band). Tokens live on the train (whole train or
// locomotive only) and optionally on single vehicles, so they travel with
// consists, templates and saves. Liveries never change any train statistic.
import { LIVERIES } from '../config.js';

export const STRIPES = ['none', 'line', 'double', 'band'];
export const DEFAULT_LIVERY = 'classic_green';

const hex = (n) => (n == null ? '-' : (n & 0xffffff).toString(16).padStart(6, '0'));
const unhex = (s) => (s === '-' || !/^[0-9a-f]{6}$/i.test(s || '') ? null : parseInt(s, 16));

export function isPreset(id) { return LIVERIES.some((l) => l.id === id); }

export function customToken(p) {
  const st = STRIPES.includes(p.stripe) ? p.stripe : 'none';
  return `c.${hex(p.body ?? 0x2f6b4a)}.${hex(p.trim ?? 0xd9b45a)}.${hex(p.accent)}.${hex(p.roof)}.${st}`;
}

export function parseCustom(tok) {
  if (typeof tok !== 'string' || !tok.startsWith('c.')) return null;
  const [, b, t, a, r, st] = tok.split('.');
  const body = unhex(b), trim = unhex(t);
  if (body == null || trim == null) return null;
  return { body, trim, accent: unhex(a), roof: unhex(r), stripe: STRIPES.includes(st) ? st : 'none' };
}

// a valid token, or null (for sanitising saves and imports)
export function validToken(tok) {
  if (isPreset(tok)) return tok;
  const c = parseCustom(tok);
  return c ? customToken(c) : null;
}

// Resolve a token for a model: { body, trim, accent, roof, stripe } with
// accent/roof possibly null (the model builders then use their defaults).
export function resolvePaint(tok, model) {
  const c = parseCustom(tok);
  if (c) return c;
  const lv = LIVERIES.find((l) => l.id === tok) || LIVERIES[0];
  return { body: lv.body ?? (model ? model.color : 0x2f6b4a), trim: lv.trim, accent: lv.accent ?? null, roof: lv.roof ?? null, stripe: lv.stripe || 'none' };
}

export function paintKey(p) { return `${hex(p.body)}${hex(p.trim)}${hex(p.accent)}${hex(p.roof)}${p.stripe || 'none'}`; }

// Which livery token a vehicle wears: its own, else the train's; with the
// livery on the locomotive only, other vehicles keep the model's house colours.
export function vehicleToken(t, v) {
  if (v.lv) return v.lv;
  if (t.liveryScope === 'loco' && v.k !== 'L') return DEFAULT_LIVERY;
  return t.livery || DEFAULT_LIVERY;
}

export const cssHex = (n) => '#' + hex(n ?? 0);
