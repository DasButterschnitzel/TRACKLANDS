// The one place that decides how infrastructure looks in a given era
// (Phase 12). Built on the six visual bands of Eras.js (early … future):
// each category (station, airport, port, level crossing, catenary, tunnel
// portal, metro, road stop, signal) names the model family it uses in each
// band. Where a category has fewer families than bands, the matrix says so
// explicitly by repeating the closest family (see FALLBACK_NOTES) — nothing
// falls back silently to a modern model.
//
// Objects keep the year they were built (or last renovated) and take their
// family from that year, not from the calendar: a 1934 station stays a 1934
// station in 2025 until it is renovated. Only things that are really
// replaced over time (level crossings, which the authority renews) move on.
import { ERA_BANDS, bandOf } from './Eras.js';

export const VISUAL_ERAS = ERA_BANDS.map((id, band) => ({
  id, band,
  from: [-Infinity, 1920, 1945, 1970, 1995, 2025][band],
  to: [1919, 1944, 1969, 1994, 2024, Infinity][band],
  name: 'vera_' + id,
}));

// category → family per band (early, interwar, postwar, late, contemporary, future)
export const VISUAL_MATRIX = {
  station: ['early', 'interwar', 'postwar', 'late', 'contemporary', 'future'],
  airport: ['pioneer', 'midcentury', 'midcentury', 'jet', 'modern', 'future'],
  port: ['early', 'early', 'industrial', 'container', 'modern', 'modern'],
  crossing: ['gate', 'gate', 'lights', 'half', 'full', 'full'],
  catenary: ['lattice', 'lattice', 'standard', 'standard', 'modern', 'modern'],
  portal: ['masonry', 'masonry', 'industrial', 'concrete', 'modern', 'modern'],
  metro: ['tile', 'tile', 'concrete', 'modern', 'contemporary', 'contemporary'],
  stop: ['early', 'early', 'postwar', 'late', 'modern', 'modern'],
  signal: ['semaphore', 'semaphore', 'semaphore', 'light', 'light', 'light'],
};
// where a band reuses a neighbour's family, and why (documented, tested)
export const FALLBACK_NOTES = {
  station: 'one family per band (Eras.js ERA_STATION): no band is shared',
  airport: 'interwar and postwar share the mid-century terminal; there were few airports before 1920',
  port: 'interwar uses the early harbour; contemporary and future share the modern terminal',
  crossing: 'early and interwar share gates; contemporary and future share full barriers',
  catenary: 'lines electrified before 1945 get lattice masts; 1945–1994 standard; later modern',
  portal: 'masonry until 1945; contemporary and future share the modern portal',
  metro: 'early metros are tiled; contemporary and future share the latest look',
  stop: 'early and interwar share the timber shelter; contemporary and future share glass',
  signal: 'semaphores until 1970, colour lights after (older semaphores are replaced by 1995)',
};
// special families outside the band matrix
export const SPECIAL_FAMILIES = { catenary: ['hs'], portal: ['hs', 'metro'] };

export function visualBand(year) { return bandOf(year); }
export function visualFamily(category, year) {
  const row = VISUAL_MATRIX[category];
  if (!row) throw new Error('unknown visual category ' + category);
  return row[bandOf(year)];
}
// every family a category can show (for caches, galleries and tests)
export function familiesOf(category) { return [...new Set([...(VISUAL_MATRIX[category] || []), ...(SPECIAL_FAMILIES[category] || [])])]; }

// the year an object shows: built or renovated; unknown (older saves) →
// the fallback given (the world's start year)
export function lookYear(built, renovated, fallback) {
  const b = Number.isFinite(built) && built > 0 ? built : fallback;
  return Number.isFinite(renovated) && renovated > b ? renovated : b;
}
// level crossings are renewed by the authority every RENEW years
export const CROSSING_RENEW = 40;
export function renewedYear(built, now, every = CROSSING_RENEW) {
  if (!Number.isFinite(built) || built <= 0) return now;
  return now <= built ? built : built + Math.floor((now - built) / every) * every;
}

// a compact year store per tile: 0 = unknown, else year − 1800 (1801 … 2055)
export const YEAR0 = 1800;
export const packYear = (y) => (Number.isFinite(y) ? Math.max(1, Math.min(255, Math.round(y) - YEAR0)) : 0);
export const unpackYear = (v) => (v ? YEAR0 + v : 0);
// run-length encoding for a sparse byte array: [value, count, value, count, …]
export function rleEncode(arr) {
  const out = [];
  let v = arr[0], n = 0;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] === v) n++;
    else { out.push(v, n); v = arr[i]; n = 1; }
  }
  out.push(v, n);
  return out;
}
export function rleDecode(runs, into) {
  if (!Array.isArray(runs) || runs.length % 2) return false;
  let p = 0;
  for (let k = 0; k < runs.length; k += 2) {
    const v = runs[k], n = runs[k + 1];
    if (!Number.isInteger(v) || v < 0 || v > 255 || !Number.isInteger(n) || n < 0 || p + n > into.length) return false;
    if (v) into.fill(v, p, p + n);
    p += n;
  }
  return p === into.length;
}
