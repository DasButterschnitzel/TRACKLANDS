// Schematic network map: stations keep their rough geographic arrangement,
// lines are drawn metro-map style (straight and 45° segments), with parallel
// offsets where several lines share a section. Pure SVG string, rendered in
// the map panel; station markers jump to the station on click/tap.
import { tx, tz } from '../util.js';
import { escapeHtml as esc } from '../util.js';

export function networkMapSVG(game, lines, { width = 320, tr = (k) => k } = {}) {
  const S = game.stations;
  const stns = S.list.filter((s) => s.tracks && s.tracks.length);
  if (!stns.length) return '';
  const pos = new Map(stns.map((s) => [s.id, { x: tx(s.tile), z: tz(s.tile) }]));
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of pos.values()) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
  const spanX = Math.max(8, x1 - x0), spanZ = Math.max(8, z1 - z0);
  const pad = 26, labelPad = 70;
  const k = Math.min((width - pad * 2 - labelPad) / spanX, 1.6 * (width - pad * 2) / spanZ, 14);
  const height = Math.round(spanZ * k + pad * 2);
  const P = (id) => { const p = pos.get(id); return [pad + (p.x - x0) * k, pad + (p.z - z0) * k]; };

  // segments shared by several lines get parallel offsets
  const segs = new Map();
  for (const l of lines) {
    const st = l.stops.filter((id) => pos.has(id));
    for (let i = 0; i < st.length; i++) {
      const a = st[i], b = st[(i + 1) % st.length];
      if (a === b || (st.length === 2 && i === 1)) continue;
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (!segs.has(key)) segs.set(key, []);
      if (!segs.get(key).includes(l)) segs.get(key).push(l);
    }
  }
  const W = 3.4;
  let paths = '';
  for (const [key, ls] of segs) {
    const [a, b] = key.split('-').map(Number);
    const [ax, az] = P(a), [bx, bz] = P(b);
    const len = Math.hypot(bx - ax, bz - az) || 1;
    const nx = -(bz - az) / len, nz = (bx - ax) / len;
    ls.forEach((l, i) => {
      const o = (i - (ls.length - 1) / 2) * (W + 1);
      paths += `<path d="${octi(ax + nx * o, az + nz * o, bx + nx * o, bz + nz * o)}" stroke="${l.color}" stroke-width="${W}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
    });
  }
  // stations: interchanges (2+ lines) get a larger marker; unserved ones are hollow
  const served = new Map();
  for (const l of lines) for (const id of l.stops) served.set(id, (served.get(id) || 0) + 1);
  let marks = '', labels = '';
  for (const s of stns) {
    const [x, z] = P(s.id);
    const n = served.get(s.id) || 0;
    const r = n >= 2 ? 5.5 : n ? 4 : 3;
    marks += `<g class="nm-stn" data-act="jump" data-arg="station:${s.id}" role="button" tabindex="0" aria-label="${esc(s.name)}"><circle cx="${x.toFixed(1)}" cy="${z.toFixed(1)}" r="${r + 7}" fill="transparent"/><circle cx="${x.toFixed(1)}" cy="${z.toFixed(1)}" r="${r}" fill="${n ? '#fff' : '#f4efe6'}" stroke="${n ? '#1f2a3a' : '#9aa3ad'}" stroke-width="${n >= 2 ? 2.2 : 1.6}"/></g>`;
    labels += `<text x="${(x + r + 3).toFixed(1)}" y="${(z - r - 1).toFixed(1)}" class="${n ? '' : 'dim'}">${esc(s.name)}</text>`;
  }
  const legend = lines.map((l) => `<span class="nm-line"><i style="background:${l.color}"></i>${esc(l.name)}<small>${l.trains.length}×</small></span>`).join('');
  return `<figure class="netmap"><svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="${esc(tr('netmap'))}">
    <g>${paths}</g><g class="nm-labels">${labels}</g><g>${marks}</g></svg>
    ${legend ? `<figcaption class="nm-legend">${legend}</figcaption>` : `<figcaption class="muted small">${esc(tr('netmap_empty'))}</figcaption>`}</figure>`;
}

// metro-map path: a 45° part then a straight part
function octi(ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const d = Math.min(Math.abs(dx), Math.abs(dz));
  const mx = ax + Math.sign(dx) * d, mz = az + Math.sign(dz) * d;
  return `M${ax.toFixed(1)} ${az.toFixed(1)}L${mx.toFixed(1)} ${mz.toFixed(1)}L${bx.toFixed(1)} ${bz.toFixed(1)}`;
}
