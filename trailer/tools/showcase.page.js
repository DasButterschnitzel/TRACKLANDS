// Showcase-world helpers (development only), loaded into the game page by
// trailer/tools/build-world.mjs. Everything here builds through the game's
// own construction, station, depot, vehicle and line code — the same calls
// the player's tools and the rival companies make — so the world is one a
// player could build. Builder (sandbox) money pays for it.
const U = await import('/src/util.js');
const C = await import('/src/config.js');
const K = await import('/src/trains/Consist.js');
const { idx, tx, tz, cheb, step, onLayer, N } = U;

export const app = window.__tracklands;
export const g = () => app.game;
export const T = (x, z) => idx(x, z);
export const town = (name) => g().towns.list.find((t) => t.name === name);
export const log = [];
const note = (s) => { log.push(s); return s; };

export function money() { const G = g(); if (G.economy.coins < 5e8) G.economy.earn(1e9, 'grant', false, null, '~sandbox'); }
export function unlockAll() {
  const G = g();
  for (let r = 0; r < 8; r++) if (!G.progression.regions.has(r)) { G.progression.regions.add(r); G.world.view.revealRegion(r); }
  for (const r of C.RESEARCH) G.progression.research.add(r.id);
  G.progression.level = 50;
  G.progression.recomputeFx && G.progression.recomputeFx();
  G.sandbox = { ignoreAuthority: true };
  money();
}

// a station site near a town or industry: the game's own drag planning
// (which buys town buildings in the way) for `len` tiles × `tracks`, along
// the axis towards `toward`; the nearest buildable spot that reaches `o`
export function stationSite(o, toward, len, tracks = 1, rMax = 6, opts = {}) {
  const G = g(), S = G.stations;
  const ax = opts.axis != null ? opts.axis : Math.abs(toward.x - o.x) >= Math.abs(toward.z - o.z) ? 0 : 2;
  let best = null;
  for (let r = 0; r <= rMax; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
    const x = o.x + dx, z = o.z + dz;
    if (x < 3 || z < 3 || x >= N - 3 || z >= N - 3) continue;
    const ex = ax === 0 ? x + (len - 1) : x, ez = ax === 0 ? z : z + (len - 1);
    if (ex >= N - 3 || ez >= N - 3) continue;
    const a = idx(x, z), b = idx(ex, ez);
    const plan = S.planDrag(a, b, tracks);
    if (plan.error || plan.mode !== 'new' || plan.tiles.length < len) continue;
    const tiles = [...plan.tiles, ...plan.side.flatMap((sd) => sd.tiles)];
    const lk = S.previewLinks(tiles, 0);
    const reaches = o.pop != null ? lk.towns.includes(o) : lk.inds.includes(o);
    if (!reaches) continue;
    const sc = r + (plan.acquire || []).length * (opts.acqW ?? 0.6);
    if (!best || sc < best.sc) best = { a, b, plan, sc };
  }
  return best;
}

// build a station by dragging (len tiles, n tracks), named
export function station(o, toward, len, tracks, name, rMax, opts) {
  const G = g(), S = G.stations;
  const site = stationSite(o, toward, len, tracks, rMax, opts);
  if (!site) throw new Error(note('no station site at ' + (o.name || o.type)));
  const r = S.buildDrag(site.plan);
  if (r.error) throw new Error(note(`station ${name}: ${r.error}`));
  if (name) r.stn.name = name;
  note(`station ${r.stn.name} ${len}x${tracks} at ${tx(site.a)},${tz(site.a)} (${(site.plan.acquire || []).length} buildings bought)`);
  return r.stn;
}

// the platform end of `s` nearest to `o` (a station or {tile})
export function facingEnd(s, o, k = 0) {
  const tl = s.tracks[k].tiles, a = tl[0], b = tl[tl.length - 1];
  return cheb(a, o.tile) <= cheb(b, o.tile) ? a : b;
}

export function track(a, b, tier = 0, mode = 'double', L = 0) {
  const G = g(), Cn = G.construction;
  Cn.setLayer(L);
  let r = Cn.trackOp(a, b, tier, mode, false, L);
  Cn.setLayer(0);
  // work on a line in use: pending works, built as the trains pass (the game's own)
  if (r.error === 'err_train_on_track' && !L) { const w = G.works.add('track', { a, b, tier, mode }); r = w.error ? w : { ok: true, pending: true }; }
  if (r.error) throw new Error(note(`track ${tx(a)},${tz(a)} → ${tx(b)},${tz(b)}: ${r.error}`));
  return r;
}

export function line(A, B, tier = 0, mode = 'double') {
  // try every pair of platform ends, keep the shortest buildable route
  const G = g(), Cn = G.construction;
  let best = null;
  for (let ka = 0; ka < A.tracks.length; ka++) for (let kb = 0; kb < B.tracks.length; kb++) {
    const ea = facingEnd(A, B, ka), eb = facingEnd(B, A, kb);
    const r = Cn.trackOp(ea, eb, tier, mode, true);
    if ((!r.error || r.error === 'err_train_on_track') && r.tiles && (!best || r.tiles.length < best.n)) best = { ea, eb, n: r.tiles.length };
  }
  if (!best) throw new Error(note(`no line ${A.name} → ${B.name}`));
  track(best.ea, best.eb, tier, mode);
  note(`line ${A.name} → ${B.name}: ${best.n} tiles`);
  return best;
}

export function depotNear(stn) {
  const G = g(), net = G.net, S = G.stations;
  for (let r = 1; r <= 5; r++) for (const base of S.allTiles(stn)) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
    const t = idx(tx(base) + dx, tz(base) + dz);
    if (t < 0 || net.conn[t] || S.placeError(t, 'depot')) continue;
    let adj = false;
    for (const d of [0, 2, 4, 6]) { const j = step(t, d); if (j >= 0 && net.conn[j] && net.degree(j) < 3 && !net.special.has(j)) adj = true; }
    if (!adj) continue;
    const res = S.buildDepot(t);
    if (res.depot && net.conn[t]) return res.depot;
    if (res.depot) S.removeDepot(res.depot);
  }
  throw new Error(note('no depot site near ' + stn.name));
}

// a train: a locomotive with a sensible consist (or an explicit vehicle list)
export function train(dep, loco, stops, { name, cargos, livery, wagons, load } = {}) {
  const G = g();
  let vs = K.autoBuild(loco, cargos || null, { research: G.progression.research, fx: G.progression.fx });
  if (wagons != null) { const L = vs.filter((v) => v.k === 'L'), W = vs.filter((v) => v.k !== 'L'); vs = L.concat(W.slice(0, wagons)); }
  const r = G.trains.buy(vs, dep, name);
  if (r.error) throw new Error(note(`buy ${loco}: ${r.error}`));
  const t = r.train;
  if (livery) t.livery = livery;
  t.mode = 'manual';
  t.route = stops.map((s, i) => ({ st: s.id, act: load ? (i === 0 ? 'load' : 'unload') : 'auto', dwell: 0, full: false, skip: false, plat: null, cargo: null }));
  t.routeIdx = 0;
  note(`train ${t.name} (${loco}, ${vs.length} vehicles)`);
  return t;
}

// automatic block signals along a double line, both directions
export function signals(A, B) {
  const G = g(), Cn = G.construction, net = G.net;
  let n = 0;
  for (const [a, b] of [[A.tile, B.tile], [B.tile, A.tile]]) {
    const plan = Cn.planSignalRow(a, b);
    if (!plan || !plan.keys) continue;
    G.economy.spend(plan.keys.length * G.economy.costs.signal(), 'construction', null, 'signals');
    for (const k of plan.keys) { net.signals.set(k, { type: 'block', oneway: false, y: G.ledger.year() }); n++; }
  }
  net.bumpVersion(); G.trains.onNetworkChanged(false);
  note(`signals ${A.name} ↔ ${B.name}: ${n}`);
  return n;
}

// run the world for a number of game months (not drawn)
export function months(n, sub = 1 / 10) {
  const G = g();
  const m0 = G.ledger.monthIndex();
  let guard = 0;
  while (G.ledger.monthIndex() < m0 + n && guard++ < n * 4000) { G.tick(sub); if (guard % 2000 === 0) money(); }
  return G.ledger.year();
}

export function grow(t, stage, extra = 0) {
  const G = g(), Tn = G.towns;
  while (t.stage < stage) Tn.levelUp(t);
  if (extra) Tn.layout(t, true, extra);
  G.stations.relinkAll(); Tn.onStationsChanged && Tn.onStationsChanged();
  note(`${t.name}: stage ${t.stage}, ${t.buildings.length} buildings`);
}

export function summary() {
  const G = g();
  return {
    year: G.ledger.year(), coins: Math.round(G.economy.coins),
    stations: G.stations.mine().map((s) => `${s.name}[${s.tracks.length}x${s.tracks[0].tiles.length}] L${s.level}`),
    trains: G.trains.trains.filter((t) => !t.owner).map((t) => `${t.name}:${t.state}:${t.trips || 0}`),
    towns: G.towns.list.filter((t) => t.stage > 0).map((t) => `${t.name}:${t.stage}`),
    graph: G.net.validateGraph(10).map((e) => `${e.kind}@${tx(e.tile)},${tz(e.tile)}`),
    log: log.splice(0),
  };
}

// ---------- stations grow ----------
export function widen(stn, tracks, len) {
  const S = g().stations;
  for (let k = 0; k < 12 && stn.tracks.length < tracks; k++) { const r = S.addTrack(stn, k % 2) || {}; if (r.error && S.addTrack(stn, (k + 1) % 2).error) break; }
  for (let k = 0; k < stn.tracks.length; k++) for (let n = 0; n < 8 && stn.tracks[k].tiles.length < len; n++) { const r = S.extendPlatform(stn, k, n % 2); if (!r.ok && !S.extendPlatform(stn, k, (n + 1) % 2).ok) break; }
  note(`${stn.name}: ${stn.tracks.length} tracks × ${Math.min(...stn.tracks.map((t) => t.tiles.length))}`);
}
export function level(stn, lv) { const S = g().stations; while (stn.level < lv) { const e = S.upgrade(stn); if (e) { note(`${stn.name} upgrade: ${e}`); break; } } }

// electrify (or re-tier) the line between two stations
export function electrify(A, B, mode = 'double') {
  const ea = facingEnd(A, B), eb = facingEnd(B, A);
  try { track(ea, eb, 2, mode); note(`electrified ${A.name} → ${B.name}`); } catch (e) { note('electrify failed: ' + e.message); }
}

// ---------- road transport ----------
const dist = (a, b) => cheb(a, b);
export function busLine(t, n, name, model, buses, near = null) {
  const G = g(), R = G.roads;
  const roads = [...t.roadSet].filter((i) => !G.net.conn[i] && !R.stopAt(i) && !R.stopError(i, 'bus'));
  if (roads.length < n) throw new Error(note('not enough road at ' + t.name));
  const picked = [];
  // the first stop near a station (a feeder), the others spread across town
  // and reachable by road from the first
  picked.push(near ? roads.slice().sort((a, b) => dist(a, near.tile) - dist(b, near.tile))[0] : roads.slice().sort((a, b) => dist(a, idx(t.x, t.z)) - dist(b, idx(t.x, t.z)))[0]);
  const reach = roads.filter((i) => i !== picked[0] && R.path(picked[0], i));
  while (picked.length < n) {
    let best = null, bd = -1;
    for (const i of reach) { if (picked.includes(i)) continue; const d = Math.min(...picked.map((p) => dist(p, i))); if (d > bd) { bd = d; best = i; } }
    if (best == null) break;
    picked.push(best);
  }
  const stops = picked.map((i) => R.addStop(i, 'bus').stop).filter(Boolean);
  const L = R.lines.create({ kind: 'bus', stops: stops.map((s) => s.id), name }).line;
  for (let k = 0; k < buses; k++) { const v = R.buy(model, stops[k % stops.length], null, L).vehicle; if (v) R.lines.assign(v, L); }
  note(`bus line ${name}: ${stops.length} stops, ${buses} × ${model}`);
  return L;
}
