// The trailer's showcase world "Greenfield" (seed 515, 128 × 128), era by
// era (development only; see build-world.mjs). Each phase builds what a
// player of that time would build, runs the world for years, and returns
// the save name and a few review stills.
export const S = await import('/trailer/tools/showcase.page.js');
const { g, town, station, line, depotNear, train, signals, months, grow, T } = S;

const W2 = (t) => [t.x * 2 + 1, t.z * 2 + 1];
const nearestInd = (type, o, max = 40) => {
  let best = null;
  for (const i of g().industries.list) if (i.type === type) { const d = Math.max(Math.abs(i.x - o.x), Math.abs(i.z - o.z)); if (d <= max && (!best || d < best.d)) best = { i, d }; }
  return best && best.i;
};
const say = (s) => console.log('[w] ' + s);

// 1900: the first connection — a steam passenger line from Greenfield to
// Wolfton and a timber line from the forest to the sawmill
export async function phaseA() {
  S.unlockAll();
  const G = g();
  const gf = town('Greenfield'), wt = town('Wolfton');
  const A = station(gf, wt, 3, 1, 'Greenfield');
  const B = station(wt, gf, 3, 1, 'Wolfton');
  line(A, B, 0, 'single');
  const dep = depotNear(A);
  train(dep, 'pioneer', [A, B], { name: 'Greenfield Local' });
  // timber
  const forest = nearestInd('FOREST', gf, 30), mill = forest && nearestInd('SAWMILL', forest, 30);
  say(`forest ${forest && forest.x},${forest && forest.z} mill ${mill && mill.x},${mill && mill.z}`);
  let F = null, M = null;
  if (forest && mill) {
    F = station(forest, mill, 3, 1, 'Pinewood Sidings');
    M = station(mill, forest, 3, 1, 'Millbank Yard');
    line(F, M, 0, 'single');
    const d2 = depotNear(F);
    train(d2, 'coalgate', [F, M], { name: 'Northern Timber', cargos: ['WOOD'], load: true });
  }
  const y = months(4);
  say('year ' + y);
  const [x, z] = W2(gf);
  return { save: 'greenfield-1900.json.gz', stills: [['gf', x, z, 16, 45, 1], ['gf-wide', x + 10, z + 8, 34, 45, 1]] };
}

// timing helper: run n months and report how long it took
async function runYears(n, each) {
  for (let y = 0; y < n; y++) {
    const t0 = performance.now();
    S.months(12);
    if (each) await each(y);
    say(`year ${g().ledger.year()} (${Math.round(performance.now() - t0)} ms)`);
  }
}

// 1900-1930: the first network — the main line doubled and signalled, a
// branch to Wolffall and Goldcrest, more trains; the towns start to grow
export async function phaseB() {
  S.unlockAll();
  const G = g(), St = G.stations;
  const gf = town('Greenfield'), wt = town('Wolfton'), wf = town('Wolffall'), gc = town('Goldcrest');
  const A = St.list.find((s) => s.name === 'Greenfield'), B = St.list.find((s) => s.name === 'Wolfton');
  // double the main line and signal it
  S.line(A, B, 0, 'double');
  const C = S.station(wf, gf, 3, 1, 'Wolffall');
  S.line(A, C, 0, 'double');
  const D = S.station(gc, gf, 3, 1, 'Goldcrest');
  S.line(C, D, 0, 'single');
  const dep = G.stations.myDepots()[0];
  S.train(dep, 'meadow_tank', [A, C, D], { name: 'Goldcrest Stopper' });
  S.train(dep, 'pioneer', [B, A, C], { name: 'Valley Mail' });
  await runYears(1);
  say('works pending: ' + G.works.list.length);
  S.signals(A, B); S.signals(A, C);
  await runYears(9);
  grow(gf, 2, 30); grow(wt, 1, 10);
  S.train(dep, 'regent', [B, A, C, D], { name: 'Heartland Express' });
  await runYears(10);
  grow(gf, 3, 30); grow(wt, 2, 20); grow(wf, 1, 10);
  await runYears(10);
  const [x, z] = W2(gf);
  return { save: 'greenfield-1930.json.gz', stills: [['gf', x, z, 16, 45, 1], ['gf-wide', x + 6, z + 6, 34, 45, 0]] };
}

const byName = (n) => g().stations.list.find((s) => s.name === n);
// 1930-1965: diesel and the first electric main line; Greenfield Central
// (town buildings bought for it), a bridge over the river to Copperholm, a
// line into the snowy mountains, oil by the trainload, buses in Greenfield
export async function phaseC() {
  S.unlockAll();
  const G = g();
  const gf = town('Greenfield'), wt = town('Wolfton'), wf = town('Wolffall'), cu = town('Copperholm'), sb = town('Stonebrook');
  const A = byName('Greenfield'), B = byName('Wolfton'), C = byName('Wolffall');
  grow(gf, 4, 30); grow(wt, 3, 20);
  const GC = S.station(gf, wt, 6, 4, 'Greenfield Central', 8);
  S.level(GC, 3);
  S.line(GC, B, 0, 'double'); S.signals(GC, B);
  S.line(GC, C, 0, 'double'); S.signals(GC, C);
  S.widen(B, 2, 4); S.level(B, 2);
  const dep = S.depotNear(GC);
  // over the river
  const E = S.station(cu, wt, 4, 2, 'Copperholm', 7);
  S.line(B, E, 0, 'double'); S.signals(B, E);
  S.train(dep, 'trailmaster', [GC, B, E], { name: 'River Flyer' });
  S.train(dep, 'valley_d2', [E, B, GC, C], { name: 'Copperholm Local' });
  S.train(dep, 'regent', [C, GC, B], { name: 'Heartland Express' });
  // the mountain line
  try {
    const F = S.station(sb, wf, 3, 1, 'Stonebrook', 8);
    S.line(C, F, 0, 'single');
    S.train(dep, 'summit', [C, F], { name: 'Alpine Express' });
  } catch (e) { say('mountain: ' + e.message); }
  // oil: the field to the refinery
  try {
    const of = nearestInd('OIL_FIELD', gf, 40), rf = of && nearestInd('REFINERY', of, 50);
    const O = S.station(of, rf, 5, 1, 'Redwater Oil Siding', 6), P = S.station(rf, of, 5, 1, 'Westmarsh Refinery', 6);
    S.line(O, P, 0, 'double'); S.signals(O, P);
    const d3 = S.depotNear(O);
    for (let k = 0; k < 2; k++) S.train(d3, 'haulmaster', [O, P], { name: `Northern Freight ${k + 1}`, cargos: ['OIL'], load: true });
  } catch (e) { say('oil: ' + e.message); }
  try { S.busLine(gf, 4, 'Greenfield Circle', 'urban_bus', 3, GC); } catch (e) { say('bus: ' + e.message); }
  await runYears(15);
  S.electrify(GC, B); S.electrify(B, E);
  await runYears(2);
  try {
    const de = S.depotNear(E);
    S.train(de, 'voltstream_e1', [GC, B, E], { name: 'Coastal Limited' });
  } catch (e) { say('electric: ' + e.message); }
  grow(gf, 4, 30); grow(cu, 2, 10);
  await runYears(18);
  const [x, z] = W2(gf);
  return { save: 'greenfield-1965.json.gz', stills: [['gf', x, z, 16, 45, 1], ['gf-wide', x + 6, z + 6, 34, 45, 0], ['river', (wt.x + cu.x) + 1, (wt.z + cu.z) + 1, 20, 45, 0], ['mtn', sb.x * 2 + 8, sb.z * 2, 22, 45, 0]] };
}

// 1965-1995: the four-track corridor with its express pair, the metro under
// Greenfield, trams, ships on the river, an airport, the oil trains
export async function phaseD() {
  S.unlockAll();
  const G = g();
  const gf = town('Greenfield'), wt = town('Wolfton'), cu = town('Copperholm'), gc = town('Goldcrest');
  const GC = byName('Greenfield Central'), B = byName('Wolfton'), E = byName('Copperholm');
  grow(gf, 5, 40); grow(wt, 4, 30); grow(cu, 3, 20);
  S.widen(B, 3, 5); S.level(B, 3); S.level(GC, 4);
  try { S.pair(GC, B, 'express'); } catch (e) { say('pair: ' + e.message); }
  const dep = S.depotNear(GC, 10, true);
  S.train(dep, 'falcon', [GC, B, E], { name: 'Greenfield Express' });
  S.train(dep, 'citylink', [GC, B], { name: 'Wolfton Shuttle' });
  S.train(dep, 'ironvolt', [E, B, GC], { name: 'Northern Freight 3', cargos: ['GOODS', 'STEEL'] });
  // metro
  try {
    const M = S.metro(gf, 3, ['Market Square', 'Greenfield Central (Metro)', 'Riverside']);
    if (M.dep) for (let k = 0; k < 2; k++) S.train(M.dep, 'metro_classic_c', [M.stns[0], M.stns[M.stns.length - 1]], { name: `Greenfield Metro ${k + 1}` });
  } catch (e) { say('metro: ' + e.message); }
  try { S.tram(wt, 'Wolfton Tram', 'tram', 2); } catch (e) { say('tram: ' + e.message); }
  try { S.docks(wt, cu, 'river_barge', 2, 'River Barges'); } catch (e) { say('docks: ' + e.message); }
  try { S.airports(gf, town('Mosscrest') || cu, 'jetliner', 2, 'Greenfield Air'); } catch (e) { say('air: ' + e.message); }
  // oil, again with a wider depot search
  try {
    const O = byName('Redwater Oil Siding'), P = byName('Westmarsh Refinery');
    if (O && P) { const d3 = S.depotNear(O, 12); for (let k = 0; k < 2; k++) S.train(d3, 'goliath', [O, P], { name: `Oil Train ${k + 1}`, cargos: ['OIL'], load: true }); }
  } catch (e) { say('oil: ' + e.message); }
  await runYears(15);
  grow(gf, 5, 30); grow(gc, 2, 10);
  await runYears(15);
  const [x, z] = W2(gf);
  return { save: 'greenfield-1995.json.gz', stills: [['gf', x, z, 16, 45, 1], ['gf-wide', x + 6, z + 6, 34, 45, 0], ['corridor', x + 12, z + 12, 14, 45, 0]] };
}

// 1995-2025: the metropolis — high-speed trains on the express pair, an
// automatic metro, the ships, the city at its largest
export async function phaseE() {
  S.unlockAll();
  const G = g();
  const gf = town('Greenfield'), wt = town('Wolfton'), cu = town('Copperholm'), wf = town('Wolffall');
  const GC = byName('Greenfield Central'), B = byName('Wolfton'), E = byName('Copperholm');
  grow(gf, 6, 120); grow(wt, 5, 60); grow(cu, 4, 40); grow(wf, 3, 20);
  S.level(GC, 5);
  try { const d = S.depotNear(E, 10, true); S.train(d, 'arrowline_300', [GC, B, E], { name: 'Arrowline Coastal' }); S.train(d, 'meridian', [E, B, GC], { name: 'Heartland Sprinter' }); } catch (e) { say('hst: ' + e.message); }
  try { const md = G.stations.myDepots().find((d) => G.trains.trains.some((t) => t.depotId === d.id && G.trains.isMetro(t))); const ms = G.stations.mine().filter((s) => G.stations.isUnderground(s)); if (md && ms.length > 1) S.train(md, 'metro_auto', [ms[0], ms[ms.length - 1]], { name: 'Greenfield Metro 3' }); } catch (e) { say('metro: ' + e.message); }
  try { S.docks(wt, cu, 'river_barge', 2, 'River Barges'); } catch (e) { say('docks river: ' + e.message); }
  try { S.docks(town('Stonebrook') || wf, town('Ashwell') || wf, 'container_ship', 2, 'Coastal Containers'); } catch (e) { say('docks coast: ' + e.message); }
  await runYears(15);
  grow(gf, 6, 80); grow(wt, 5, 40);
  await runYears(15);
  const [x, z] = W2(gf);
  return { save: 'greenfield-2025.json.gz', stills: [['gf', x, z, 16, 45, 1], ['gf-wide', x + 6, z + 6, 34, 45, 0], ['mega', x + 8, z + 6, 22, 60, 0]] };
}

// ships: two docks on the same water anywhere on the map (towns at both ends)
export async function phaseF() {
  S.unlockAll();
  const G = g(), R = G.roads, N = G.mapSize;
  const { idx, cheb } = await import('/src/util.js');
  const shore = [];
  for (let i = 0; i < N * N; i++) if (!R.stopError(i, 'dock') && G.stations.previewLinks([i], 1).towns.length) shore.push(i);
  say('shore tiles with towns: ' + shore.length);
  const made = [];
  for (const [model, n, name, dmin, dmax] of [['container_ship', 2, 'Coastal Containers', 18, 50], ['ferry', 1, 'Island Ferry', 10, 30]]) {
    let done = false;
    for (let a = 0; a < shore.length && !done; a += 3) for (let b = a + 1; b < shore.length && !done; b += 3) {
      const d = cheb(shore[a], shore[b]);
      if (d < dmin || d > dmax || made.some((m) => cheb(m, shore[a]) < 6 || cheb(m, shore[b]) < 6)) continue;
      if (!R.waterPath(shore[a], shore[b])) continue;
      const A = R.addStop(shore[a], 'dock').stop, B = R.addStop(shore[b], 'dock').stop;
      if (!A || !B) continue;
      const L = R.lines.create({ kind: 'dock', stops: [A.id, B.id], name }).line;
      for (let k = 0; k < n; k++) { const v = R.buy(model, k % 2 ? B : A, null, L).vehicle; if (v) R.lines.assign(v, L); }
      say(`${name}: ${shore[a] % N},${Math.floor(shore[a] / N)} -> ${shore[b] % N},${Math.floor(shore[b] / N)}`);
      made.push(shore[a], shore[b]); done = true;
    }
  }
  await runYears(1);
  void idx;
  return { save: 'greenfield-2025.json.gz', stills: made.length ? [['dock', (made[0] % N) * 2 + 1, Math.floor(made[0] / N) * 2 + 1, 14, 45, 0]] : [] };
}

export async function phaseQ() {
  const G = g(), C = await import('/src/config.js');
  const gf = town('Greenfield');
  const rows = G.industries.list.map((i) => ({ t: i.type, x: i.x, z: i.z, d: Math.max(Math.abs(i.x - gf.x), Math.abs(i.z - gf.z)), acc: (C.INDUSTRIES[i.type] && (C.INDUSTRIES[i.type].accepts || C.INDUSTRIES[i.type].in || [])) , prod: (C.INDUSTRIES[i.type] && (C.INDUSTRIES[i.type].produces || C.INDUSTRIES[i.type].out || [])) })).filter((r) => r.d < 45).sort((a, b) => a.d - b.d);
  say(JSON.stringify(rows.map((r) => `${r.t}@${r.x},${r.z} d${r.d} in:${JSON.stringify(r.acc)} out:${JSON.stringify(r.prod)}`)));
  say(JSON.stringify(Object.keys(C.INDUSTRIES.COAL_MINE || {})));
  return {};
}
