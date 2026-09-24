// World generation QA (node only, no browser): many seeds, each checked for
// complete regions, sites on solid land, spacing, the tutorial layout, finite
// terrain and a starting region whose sites can be linked over land.
import { generateWorld, T_WATER, T_MOUNTAIN } from '../../src/world/WorldGen.js';
import { REGIONS } from '../../src/config.js';
import fs from 'fs';
import crypto from 'crypto';
import { N, idx } from '../../src/util.js';

export const name = 'worldgen';
export const nodeOnly = true;

function check(W) {
  const probs = [];
  const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
  REGIONS.forEach((reg, r) => {
    const t = W.towns.filter((x) => x.region === r).length, i = W.industries.filter((x) => x.region === r).length;
    if (t !== reg.towns) probs.push(`${reg.id}: ${t}/${reg.towns} towns`);
    if (i !== reg.industries.length) probs.push(`${reg.id}: ${i}/${reg.industries.length} industries`);
  });
  const land = (x, z) => x >= 0 && z >= 0 && x < N && z < N && W.type[idx(x, z)] !== T_WATER;
  for (const t of W.towns) {
    if (W.type[idx(t.x, t.z)] !== 0) probs.push(`town ${t.name} not on flat land`);
    if (t.x < 3 || t.z < 3 || t.x > N - 4 || t.z > N - 4) probs.push(`town ${t.name} at the map edge`);
  }
  for (const ind of W.industries) {
    for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) if (!land(ind.x + dx, ind.z + dz) || W.type[idx(ind.x + dx, ind.z + dz)] === T_MOUNTAIN) { probs.push(`${ind.type}@${ind.x},${ind.z} footprint not on land`); dz = dx = 9; }
  }
  const sites = [...W.towns, ...W.industries];
  for (let a = 0; a < sites.length; a++) for (let b = a + 1; b < sites.length; b++) if (cheb(sites[a], sites[b]) < 3) probs.push(`sites too close: ${sites[a].name || sites[a].type} / ${sites[b].name || sites[b].type}`);
  // tutorial: Greenfield and its forest 8-13 tiles apart
  const g = W.towns[0], f = W.industries[0];
  if (!g || g.name !== 'Greenfield' || !f || f.type !== 'FOREST' || f.region !== 0) probs.push('tutorial pair missing');
  else if (cheb(g, f) < 7 || cheb(g, f) > 13) probs.push(`tutorial forest ${cheb(g, f)} tiles from Greenfield`);
  for (let i = 0; i < W.heights.length; i++) if (!isFinite(W.heights[i])) { probs.push('non-finite height'); break; }
  // starting region: every site reachable from Greenfield over land (no bridge needed)
  const seen = new Uint8Array(N * N), q = [idx(g.x, g.z)];
  seen[q[0]] = 1;
  while (q.length) {
    const i = q.pop(), x = i % N, z = (i / N) | 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx, zz = z + dz;
      if (!land(xx, zz)) continue;
      const j = idx(xx, zz);
      if (!seen[j] && W.region[j] === 0) { seen[j] = 1; q.push(j); }
    }
  }
  for (const s of sites.filter((x) => x.region === 0)) if (!seen[idx(s.x, s.z)] && !seen[idx(s.x + 1, s.z + 1)]) probs.push(`start region: ${s.name || s.type} cut off by water`);
  return probs;
}

export async function run({ quick, args }) {
  const lines = [];
  let ok = true;
  const count = +(args.worlds || (quick ? 60 : 300));
  const seeds = [2, 20, 23, 46, ...Array.from({ length: count }, (_, k) => k + 1).filter((s) => ![2, 20, 23, 46].includes(s))];
  const tally = new Map();
  let bad = 0;
  const t0 = Date.now();
  for (const s of seeds) {
    const probs = check(generateWorld(s));
    if (!probs.length) continue;
    bad++;
    for (const p of probs) { const k = p.replace(/[A-Z][a-z]+(?=\s|$)|@\d+,\d+|\d+(?= tiles)/g, '…'); tally.set(k, (tally.get(k) || 0) + 1); }
    if ([2, 20, 23, 46].includes(s) || bad <= 5) lines.push(`FAIL seed ${s}: ${probs.slice(0, 4).join('; ')}`);
  }
  if (bad) ok = false;
  // saves without a worldGen field are rebuilt with generator v1: it must never change
  const fx = JSON.parse(fs.readFileSync('tests/fixtures/worldgen-v1.json', 'utf8'));
  const fp = (W) => crypto.createHash('sha1').update(JSON.stringify([W.towns.map((t) => [t.x, t.z, t.name, t.seed]), W.industries.map((i) => [i.type, i.x, i.z]), Array.from(W.type).join(''), Array.from(W.heights.slice(0, 4000)).map((h) => h.toFixed(3)).join(',')])).digest('hex').slice(0, 16);
  const changed = Object.entries(fx.worlds).filter(([s, h]) => fp(generateWorld(+s, 1)) !== h).map(([s]) => s);
  if (changed.length) ok = false;
  lines.push(`${changed.length ? 'FAIL' : 'ok  '} generator v1 unchanged for ${Object.keys(fx.worlds).length} worlds incl. the production save${changed.length ? ': changed ' + changed.slice(0, 8).join(',') : ''}`);
  lines.push(`${bad ? 'FAIL' : 'ok  '} ${seeds.length} worlds in ${((Date.now() - t0) / 1000).toFixed(1)} s, ${bad} with problems${tally.size ? ': ' + [...tally].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${k} ×${n}`).join(' · ') : ''}`);
  return { ok, lines };
}
