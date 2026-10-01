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

export function depotNear(stn, rMax = 8, electric = false) {
  const G = g(), net = G.net, S = G.stations;
  for (let r = 1; r <= rMax; r++) for (const base of S.allTiles(stn)) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
    const t = idx(tx(base) + dx, tz(base) + dz);
    if (t < 0 || net.conn[t] || S.placeError(t, 'depot')) continue;
    let adj = false;
    for (const d of [0, 2, 4, 6]) { const j = step(t, d); if (j >= 0 && net.conn[j] && net.degree(j) < 3 && !net.special.has(j) && (!electric || net.tier[j] >= 2)) adj = true; }
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

// ---------- four-track: a second pair beside the middle of a line ----------
export function pair(A, B, roles = 'express', side = 1) {
  const G = g(), Cn = G.construction;
  const r = Cn.trackOp(facingEnd(A, B), facingEnd(B, A), G.net.tier[A.tile], 'double', true);
  const tiles = r.tiles || [];
  if (tiles.length < 14) throw new Error(note('pair: line too short ' + tiles.length));
  // (built in a moment when no train is on the stretch, as a player would wait)
  for (let k = 0; k < 4000; k++) {
    for (const sd of [side, -side]) {
      Cn.pairSide = sd; Cn.pairRoles = roles;
      const a = tiles[3], b = tiles[tiles.length - 4];
      const res = Cn.trackOp(a, b, G.net.tier[a], 'pair');
      if (!res.error) { note(`four-track ${A.name} → ${B.name}: ${res.tiles.length} tiles (side ${sd}, after ${k} steps)`); return res; }
      if (k === 0) note('pair side ' + sd + ': ' + res.error);
    }
    G.tick(1 / 10);
  }
  return null;
}

// ---------- metro: a surface depot stub, a portal, an underground line ----------
export function metro(t, n, name) {
  const G = g(), S = G.stations, Cn = G.construction, net = G.net;
  const free = (x, z) => { const i = idx(x, z); return x > 2 && z > 2 && x < N - 3 && z < N - 3 && G.world.type[i] === 0 && !G.occupancy.blocked[i] && !net.conn[i] && !G.roads.hasRoad(i) && G.world.mtn[i] < 0.05; };
  for (const [ax, dirs] of [[0, [1, -1]], [2, [1, -1]]]) for (const dir of dirs) for (let off = -3; off <= 3; off++) for (let back = 7; back <= 13; back++) {
    // surface stub outside the town, the line under its centre
    const sx = ax === 0 ? t.x - dir * back : t.x + off, sz = ax === 0 ? t.z + off : t.z - dir * back;
    const step = (k) => ax === 0 ? [sx + dir * k, sz] : [sx, sz + dir * k];
    let ok = true;
    for (let k = 0; k < 5 && ok; k++) { const [x, z] = step(k); if (!free(x, z)) ok = false; }
    if (!ok) continue;
    const [x0, z0] = step(0), [x4, z4] = step(4), [xe, ze] = step(4 + 2 * back);
    if (xe < 4 || ze < 4 || xe > N - 5 || ze > N - 5) continue;
    // the surface stub first, then the tunnel planned from its portal (as a
    // player builds it); a tunnel that would leave the portal at an angle is
    // refused by the game, so the stub is undone and the next corridor tried
    Cn.setLayer(0);
    const b0 = Cn.trackOp(idx(x0, z0), idx(x4, z4), 2, 'double');
    if (b0.error) continue;
    Cn.setLayer(1);
    const r1 = Cn.trackOp(idx(x4, z4), idx(xe, ze), 2, 'double', true, 1);
    const b1 = r1.error ? r1 : Cn.trackOp(idx(x4, z4), idx(xe, ze), 2, 'double', false, 1);
    Cn.setLayer(0);
    if (b1.error) { Cn.undo(); note(`metro corridor ${x4},${z4}: ${b1.error}`); continue; }
    note(`metro build: stub and tunnel (${r1.tiles.length} tiles) from ${x4},${z4} to ${xe},${ze}`);
    // stations on the tunnel as built (it may bend round obstacles), on straight bits
    const path = r1.tiles.filter((tt) => (tt / (N * N) | 0) === 1);
    const stns = [];
    for (let k = 0; k < n; k++) {
      let at = Math.round(3 + (path.length - 6) * (k / Math.max(1, n - 1)));
      let placed = null;
      for (let d = 0; d < 6 && !placed; d++) for (const j of [at + d, at - d]) {
        if (placed || j < 2 || j > path.length - 3) continue;
        const a0 = path[j - 1], a1 = path[j], a2 = path[j + 1];
        const sx0 = tx(a1) - tx(a0), sz0 = tz(a1) - tz(a0), sx1 = tx(a2) - tx(a1), sz1 = tz(a2) - tz(a1);
        if (sx0 !== sx1 || sz0 !== sz1 || (sx0 && sz0)) continue;
        const res = S.build(a1, sx0 ? 0 : 2);
        if (res.error) continue;
        S.extendPlatform(res.station, 0, 1); S.extendPlatform(res.station, 0, 0);
        res.station.name = name[k] || `${t.name} Metro ${k + 1}`;
        placed = res.station;
      }
      if (placed) stns.push(placed); else note('metro station ' + k + ': no straight tunnel tile');
    }
    if (stns.length > 1 && !net.connected(stns[0].tile, stns[stns.length - 1].tile)) note('metro: stations not connected!');
    let dep = null;
    for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) for (let k = 0; k < 3 && !dep; k++) { const [x, z] = step(k + 1); const tt = idx(x + (ax === 0 ? 0 : dx), z + (ax === 0 ? dz : 0)); const d = S.buildDepot(tt); if (d.depot && net.conn[tt]) dep = d.depot; else if (d.depot) S.removeDepot(d.depot); }
    note(`metro ${t.name}: ${stns.length} stations, depot ${!!dep}`);
    return { stns, dep };
  }
  throw new Error(note('no metro corridor at ' + t.name));
}

// ---------- tram ----------
export function tram(t, name, model, n) {
  const G = g(), R = G.roads;
  const st = [...t.roadSet].filter((i) => !G.net.conn[i]);
  let best = null;
  for (let a = 0; a < st.length; a++) for (let b = st.length - 1; b > a; b--) {
    const d = cheb(st[a], st[b]);
    if (d < 6 || (best && d <= best.d)) continue;
    const p = R.planTram(st[a], st[b]);
    if (p.ok) best = { a: st[a], b: st[b], p, d };
  }
  if (!best) throw new Error(note('no tram route at ' + t.name));
  R.buildTram(best.p);
  const A = R.addStop(best.a, 'tram').stop, B = R.addStop(best.b, 'tram').stop;
  const L = R.lines.create({ kind: 'tram', stops: [A.id, B.id], name }).line;
  for (let k = 0; k < n; k++) { const v = R.buy(model, k % 2 ? B : A, null, L).vehicle; if (v) R.lines.assign(v, L); }
  note(`tram ${name}: ${best.d} tiles, ${n} × ${model}`);
  return L;
}

// ---------- ships and aircraft ----------
export function docks(near1, near2, model, n, name) {
  const G = g(), R = G.roads, S = G.stations;
  const shore = (t) => { const out = []; for (let dz = -18; dz <= 18; dz++) for (let dx = -18; dx <= 18; dx++) { const i = idx(t.x + dx, t.z + dz); if (i >= 0 && !R.stopError(i, 'dock')) out.push(i); } return out.sort((a, b) => cheb(a, idx(t.x, t.z)) - cheb(b, idx(t.x, t.z))); };
  const sa = shore(near1), sb = shore(near2);
  note(`dock sites: ${sa.length} near ${near1.name}, ${sb.length} near ${near2.name}`);
  for (const a of sa.slice(0, 60)) for (const b of sb.slice(0, 60)) {
    if (cheb(a, b) < 8 || !R.waterPath(a, b)) continue;
    const A = R.addStop(a, 'dock').stop, B = R.addStop(b, 'dock').stop;
    if (!A || !B) continue;
    const L = R.lines.create({ kind: 'dock', stops: [A.id, B.id], name }).line;
    for (let k = 0; k < n; k++) { const v = R.buy(model, k % 2 ? B : A, null, L).vehicle; if (v) R.lines.assign(v, L); }
    note(`ships ${name}: ${n} × ${model}`);
    void S;
    return { A, B, L };
  }
  throw new Error(note('no dock pair'));
}
export function airports(t1, t2, model, n, name) {
  const G = g(), R = G.roads;
  const site = (t) => { for (let r = 3; r <= 14; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) { if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue; const i = idx(t.x + dx, t.z + dz); if (i >= 0 && !R.stopError(i, 'airport')) return i; } return -1; };
  const a = site(t1), b = site(t2);
  if (a < 0 || b < 0) throw new Error(note('no airport site'));
  const A = R.addStop(a, 'airport').stop, B = R.addStop(b, 'airport').stop;
  for (const s of [A, B]) for (let k = 0; k < 2; k++) R.upgradeAirport(s);
  const L = R.lines.create({ kind: 'airport', stops: [A.id, B.id], name }).line;
  for (let k = 0; k < n; k++) { const v = R.buy(model, k % 2 ? B : A, null, L).vehicle; if (v) R.lines.assign(v, L); }
  note(`airports ${t1.name} ↔ ${t2.name}: ${n} × ${model} (sizes ${A.size}/${B.size})`);
  return { A, B, L };
}
