// World generation QA (node only, no browser): many seeds, each checked for
// complete regions, sites on solid land, spacing, the tutorial layout, finite
// terrain and a starting region whose sites can be linked over land.
import { generateWorld, segDist, T_WATER, T_MOUNTAIN } from '../../src/world/WorldGen.js';
import { REGIONS } from '../../src/config.js';
import fs from 'fs';
import crypto from 'crypto';
import { N, idx, setMapSize } from '../../src/util.js';
import { TERRAIN_IDS, TERRAIN_PRESETS, TERRAIN_DEFAULTS, TERRAIN_RANGES, TERRAIN_CHOICES, normalizeTerrain, resolveTerrain, terrainStats } from '../../src/world/Terrain.js';

export const name = 'worldgen';
export const nodeOnly = true;

function check(W) {
  const probs = [];
  const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
  REGIONS.forEach((reg, r) => {
    const t = W.towns.filter((x) => x.region === r).length, i = W.industries.filter((x) => x.region === r).length;
    // (v4 terrain presets scale the towns and industries per region; the map size does too)
    const wantT = W.expect ? W.expect[r].towns : reg.towns;
    if (t !== wantT) probs.push(`${reg.id}: ${t}/${wantT} towns`);
    // world generation v3 adds each region's extra (Phase 6) industries
    const want = W.expect ? W.expect[r].industries : reg.industries.length + ((W.genVersion || 1) >= 3 ? (reg.extra || []).length : 0);
    if (i !== want) probs.push(`${reg.id}: ${i}/${want} industries`);
    if (N === 64 && W.expect && !W.tp.smart && W.tp.towns === 1 && (wantT !== reg.towns || (W.genVersion >= 3 && want !== reg.industries.length + (reg.extra || []).length))) probs.push(`${reg.id}: classic counts changed`);
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
  // v3: no other industry on the tutorial line (it would block the first track)
  if (g && f && (W.genVersion || 1) >= 3) for (const ind of W.industries.slice(1)) if (segDist(ind.x + 0.5, ind.z + 0.5, [g.x, g.z, f.x + 0.5, f.z + 0.5]) < 3.5) probs.push(`${ind.type} on the tutorial line`);
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
  // saves made with generator v2 must also rebuild the same world after v3
  const fx2 = JSON.parse(fs.readFileSync('tests/fixtures/worldgen-v2.json', 'utf8'));
  const changed2 = Object.entries(fx2.worlds).filter(([s, h]) => fp(generateWorld(+s, 2)) !== h).map(([s]) => s);
  if (changed2.length) ok = false;
  lines.push(`${changed2.length ? 'FAIL' : 'ok  '} generator v2 unchanged for ${Object.keys(fx2.worlds).length} worlds${changed2.length ? ': changed ' + changed2.slice(0, 8).join(',') : ''}`);
  // generator v3 (and every classic world since v4): trees, regions and all heights pinned too
  const fx3 = JSON.parse(fs.readFileSync('tests/fixtures/worldgen-v3.json', 'utf8'));
  const fp3 = (W) => crypto.createHash('sha1').update(JSON.stringify([Array.from(W.trees).join(''), Array.from(W.region).join(''), Array.from(W.heights).map((h) => h.toFixed(3)).join(','), W.towns.map((t) => [t.x, t.z, t.name, t.seed]), W.industries.map((i) => [i.type, i.x, i.z]), Array.from(W.type).join(''), Array.from(W.heights.slice(0, 4000)).map((h) => h.toFixed(3)).join(',')])).digest('hex').slice(0, 16);
  const changed3 = [];
  for (const [s, h] of Object.entries(fx3.worlds)) {
    if (fp3(generateWorld(+s, 3)) !== h) changed3.push('v3:' + s);
    if (fp3(generateWorld(+s, 4, { terrain: { preset: 'classic' } })) !== h) changed3.push('classic:' + s);
  }
  for (const [k, h] of Object.entries(fx3.sized)) {
    const [n, s] = k.split(':').map(Number);
    setMapSize(n);
    if (fp3(generateWorld(s, 3)) !== h) changed3.push('v3:' + k);
    if (fp3(generateWorld(s, 4)) !== h) changed3.push('classic:' + k);
    setMapSize(64);
  }
  if (changed3.length) ok = false;
  lines.push(`${changed3.length ? 'FAIL' : 'ok  '} generator v3 and the classic v4 terrain unchanged (${Object.keys(fx3.worlds).length} worlds + ${Object.keys(fx3.sized).length} larger maps)${changed3.length ? ': changed ' + changed3.slice(0, 8).join(',') : ''}`);

  // terrain presets (v4): every preset makes playable worlds on every map
  // size (complete regions, sites on land, a connected start region), each
  // looks like what it promises, and saved v4 worlds never change
  const nSeeds = quick ? 5 : 14;
  const avg = {};
  const pProbs = [];
  let tMax = 0;
  for (const p of TERRAIN_IDS) {
    const a = avg[p] = { water: 0, mountain: 0, forest: 0, fields: 0, relief: 0 };
    for (let s = 1; s <= nSeeds; s++) {
      const W = generateWorld(s * 7919, 4, { terrain: { preset: p } });
      const pr = check(W);
      if (pr.length) pProbs.push(`${p}/${s * 7919}: ${pr.slice(0, 3).join('; ')}`);
      const st = terrainStats(W, N);
      for (const k in a) a[k] += st[k] / nSeeds;
      if (st.water > 45 || st.mountain > 35) pProbs.push(`${p}/${s * 7919}: ${st.water}% water, ${st.mountain}% mountains`);
    }
    for (const n of quick ? [128] : [96, 128, 192]) {
      setMapSize(n);
      const t0 = Date.now();
      const W = generateWorld(n + 3, 4, { terrain: { preset: p } });
      tMax = Math.max(tMax, Date.now() - t0);
      const pr = check(W);
      if (pr.length) pProbs.push(`${p}@${n}: ${pr.slice(0, 3).join('; ')}`);
      setMapSize(64);
    }
  }
  if (pProbs.length) ok = false;
  lines.push(`${pProbs.length ? 'FAIL' : 'ok  '} ${TERRAIN_IDS.length} terrain presets × ${nSeeds} seeds + larger maps playable (slowest ${tMax} ms)${pProbs.length ? ': ' + pProbs.slice(0, 5).join(' | ') : ''}`);
  const A = avg, want = [
    ['alpine has the most mountains', A.alpine.mountain > A.highlands.mountain && A.highlands.mountain > A.classic.mountain + 3],
    ['highlands and alpine are rough, plains flat', A.alpine.relief > A.highlands.relief && A.highlands.relief > A.classic.relief * 2 && A.plains.relief <= A.classic.relief],
    ['lakes, coastal and archipelago are wetter', A.lakes.water > A.classic.water + 4 && A.coastal.water > A.classic.water + 4 && A.archipelago.water > A.coastal.water],
    ['riverlands has more water than classic', A.riverlands.water > A.classic.water + 1],
    ['plains and frontier are open, snowland wooded', A.plains.forest < A.classic.forest / 3 && A.frontier.forest < A.classic.forest / 3 && A.snowland.forest > A.plains.forest * 3],
    ['farmland on plains and countryside, none in classic', A.plains.fields > 10 && A.countryside.fields > 1 && A.classic.fields === 0],
  ];
  for (const [what, cond] of want) { if (!cond) ok = false; lines.push(`${cond ? 'ok  ' : 'FAIL'} ${what}`); }
  lines.push(`     ${TERRAIN_IDS.map((p) => `${p} ${A[p].water.toFixed(0)}/${A[p].mountain.toFixed(0)}/${A[p].forest.toFixed(0)}`).join(' · ')} (water/mountain/forest %)`);
  // climates: the regions look the part
  const Wc = generateWorld(5, 4, { terrain: { preset: 'snowland' } }), Wd = generateWorld(5, 4, { terrain: { preset: 'frontier' } });
  const climOk = Wc.biomes.every((b) => ['pine', 'snow', 'industrial'].includes(b)) && Wd.biomes.every((b) => ['plains', 'desert', 'industrial'].includes(b));
  if (!climOk) ok = false;
  lines.push(`${climOk ? 'ok  ' : 'FAIL'} climates: snowland ${[...new Set(Wc.biomes)].join('/')}, frontier ${[...new Set(Wd.biomes)].join('/')}`);
  // saved v4 worlds must rebuild the same: deterministic now, pinned forever
  const fx4 = JSON.parse(fs.readFileSync('tests/fixtures/worldgen-v4.json', 'utf8'));
  const changed4 = Object.entries(fx4.worlds).filter(([k, h]) => { const c = k.lastIndexOf(':'), p = k.slice(0, c), s = k.slice(c + 1); return fp3(generateWorld(+s, 4, { terrain: p.startsWith('{') ? JSON.parse(p) : { preset: p } })) !== h; }).map(([k]) => k);
  const det = fp3(generateWorld(99, 4, { terrain: { preset: 'alpine', rivers: 4 } })) === fp3(generateWorld(99, 4, { terrain: { preset: 'alpine', rivers: 4 } }));
  if (changed4.length || !det) ok = false;
  lines.push(`${changed4.length || !det ? 'FAIL' : 'ok  '} generator v4 deterministic and unchanged for ${Object.keys(fx4.worlds).length} preset worlds${changed4.length ? ': changed ' + changed4.slice(0, 6).join(',') : ''}`);
  // the saved terrain spec: garbage never throws and always yields valid parameters
  let nBad = 0;
  const junk = [null, 1, 'x', [], { preset: 'nope' }, { preset: 'alpine', relief: 'high' }, { preset: 'plains', rivers: 1e9 }, { preset: 'lakes', coast: 'moon' }, { preset: 'coastal', smart: 'yes' }, { preset: '__proto__' }, { relief: NaN, mountains: -5 }, { preset: 'classic', towns: 0.01 }];
  for (const j of junk) {
    try {
      const r = resolveTerrain(j);
      for (const k in TERRAIN_DEFAULTS) {
        const v = r[k];
        if (TERRAIN_RANGES[k] ? !(typeof v === 'number' && v >= TERRAIN_RANGES[k][0] - 1e-9 && v <= TERRAIN_RANGES[k][1] + 1e-9) : TERRAIN_CHOICES[k] ? !TERRAIN_CHOICES[k].includes(v) : typeof v !== 'boolean') nBad++;
      }
      if (!TERRAIN_PRESETS[normalizeTerrain(j).preset]) nBad++;
    } catch (e) { nBad++; }
  }
  if (nBad) ok = false;
  lines.push(`${nBad ? 'FAIL' : 'ok  '} terrain spec sanitised for ${junk.length} bad inputs${nBad ? ` (${nBad} bad)` : ''}`);
  lines.push(`${bad ? 'FAIL' : 'ok  '} ${seeds.length} worlds in ${((Date.now() - t0) / 1000).toFixed(1)} s, ${bad} with problems${tally.size ? ': ' + [...tally].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${k} ×${n}`).join(' · ') : ''}`);
  return { ok, lines };
}
