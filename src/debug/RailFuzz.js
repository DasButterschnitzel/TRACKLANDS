// Randomised railway fuzzer: builds a random network on a throwaway world,
// buys random consists with random schedules, then runs the simulation while
// applying random live edits (signals, single/double track, platform
// extensions, extra tracks, bulldozing, consist changes, buying/selling).
// Invariants checked continuously: no shared lane keys, no geometric body
// overlaps, no NaN, no exceptions, no permanently stuck trains, and the save
// survives a serialize → migrate round-trip. Use __tracklands.game.runRailFuzz(seed)
// or open index.html?railtest=fuzz.
import { N, idx, tx, tz, step, cheb, RNG } from '../util.js';
import { LOCOS, CARGO_IDS, TRACK_TIERS, RESEARCH, WAGON_IDS } from '../config.js';
import { RailTests, motionCheck } from './RailTests.js';
import { autoBuild, computeStats, locoModel } from '../trains/Consist.js';
import { migrate, validate } from '../save/Save.js';

export class RailFuzz extends RailTests {
  constructor(game, seed) {
    super(game);
    this.seed = seed;
    this.rng = new RNG(seed * 7919 + 13);
    this.events = [];
  }

  note(s) { this.events.push(`${this.g.time.toFixed(0)}s ${s}`); if (this.events.length > 60) this.events.shift(); }

  setup() {
    const g = this.g;
    g.economy.coins = 1e9;
    for (let r = 0; r < 8; r++) g.progression.regions.add(r);
    for (const r of RESEARCH) g.progression.research.add(r.id);
    g.progression.level = 50;
    g.progression.recomputeFx();
    g.stations.relinkAll();
  }

  // station sites next to towns and industries
  buildNetwork() {
    const g = this.g, rng = this.rng, C = g.construction;
    const sites = [];
    const targets = rng.shuffle([...g.towns.list.map((t) => ({ x: t.x, z: t.z })), ...g.industries.list.map((i) => ({ x: i.x, z: i.z }))]).slice(0, rng.int(4, 8));
    for (const tg of targets) {
      let best = -1, bd = 1e9;
      for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) {
        const x = tg.x + dx, z = tg.z + dz;
        if (x < 1 || z < 1 || x >= N - 1 || z >= N - 1) continue;
        const t = idx(x, z);
        if (g.stations.placeError(t, 'station')) continue;
        const d = Math.abs(dx) + Math.abs(dz) + rng.next();
        if (d < bd && d > 1.5) { bd = d; best = t; }
      }
      if (best < 0) continue;
      const r = g.stations.build(best);
      if (r.station) sites.push(r.station);
    }
    // connect as a tree plus a few loops, random tier and track mode
    const tier = rng.pick([0, 0, 1, 2, 3]);
    const conn = [sites[0]];
    const link = (a, b) => {
      C.tier = tier; C.trackMode = rng.chance(0.35) ? 'single' : 'double';
      C.drag = { a: a.tile, b: b.tile }; C.previewTrack();
      if (C.plan && C.plan.ok) { C.buildTrack(); return true; }
      return false;
    };
    for (const s of sites.slice(1)) {
      const near = conn.slice().sort((a, b) => cheb(a.tile, s.tile) - cheb(b.tile, s.tile));
      for (const t of near.slice(0, 2)) if (link(s, t)) break;
      conn.push(s);
    }
    for (let k = 0; k < rng.int(0, 2) && sites.length > 3; k++) link(rng.pick(sites), rng.pick(sites));
    C.drag = null; C.clearPreview(); C.trackMode = 'double';
    // longer platforms at some stations, extra tracks at others
    for (const s of sites) {
      for (let k = 0; k < rng.int(0, 2); k++) g.stations.extendPlatform(s, 0, rng.int(0, 1));
      if (rng.chance(0.4)) g.stations.addTrack(s, rng.chance(0.5) ? 1 : -1);
    }
    // depots next to track
    const deps = [];
    for (const s of rng.shuffle(sites.slice())) {
      if (deps.length >= 3) break;
      let done = false;
      for (let r = 1; r <= 3 && !done; r++) for (let dz = -r; dz <= r && !done; dz++) for (let dx = -r; dx <= r && !done; dx++) {
        const t = idx(tx(s.tile) + dx, tz(s.tile) + dz);
        if (t < 0 || g.net.conn[t] || g.stations.placeError(t, 'depot')) continue;
        let adj = false;
        for (const d of [0, 2, 4, 6]) { const j = step(t, d); if (j >= 0 && g.net.conn[j] && g.net.degree(j) < 3 && !g.net.special.has(j)) adj = true; }
        if (!adj) continue;
        const r2 = g.stations.buildDepot(t);
        if (r2.depot && g.net.conn[t]) { deps.push(r2.depot); done = true; } else if (r2.depot) g.stations.removeDepot(r2.depot);
      }
    }
    // a few signals and waypoints
    for (let k = 0; k < rng.int(0, 6); k++) this.randomSignal();
    this.sites = sites; this.deps = deps; this.tier = tier;
    this.note(`network: ${sites.length} stations, ${deps.length} depots, tier ${tier}`);
    return sites.length >= 2 && deps.length >= 1;
  }

  plainTiles(filter) {
    const g = this.g, out = [];
    for (let i = 0; i < N * N; i++) if (g.net.conn[i] && !g.net.special.has(i) && (!filter || filter(i))) out.push(i);
    return out;
  }

  randomSignal() {
    const g = this.g, rng = this.rng;
    const tiles = this.plainTiles((i) => !g.net.isJunction(i));
    if (!tiles.length) return;
    const t = rng.pick(tiles);
    const dirs = []; for (let d = 0; d < 8; d++) if (g.net.hasDir(t, d)) dirs.push(d);
    const d = rng.pick(dirs);
    g.net.signals.set(t * 8 + d, { type: rng.pick(['block', 'path']), oneway: rng.chance(0.15) });
    g.net.bumpVersion();
    this.note(`signal ${t}/${d}`);
  }

  randomConsist() {
    const g = this.g, rng = this.rng;
    const minTierOk = (m) => (m.maglev ? 3 : m.electric ? 2 : 0) <= this.tier;
    const locos = LOCOS.filter(minTierOk);
    const m = rng.pick(locos);
    const cargos = rng.shuffle(CARGO_IDS.slice()).slice(0, rng.int(1, 3));
    let vs = autoBuild(m.id, cargos, { research: g.progression.research, fx: g.progression.fx });
    if (rng.chance(0.3)) for (let k = 0; k < rng.int(1, 4) && vs.length < 12; k++) vs.push({ k: 'W', id: rng.pick(WAGON_IDS), r: false });
    if (rng.chance(0.2) && vs.length < 12) vs.push({ k: 'L', id: m.id, r: true });
    if (rng.chance(0.1) && vs.length < 12) vs.push({ k: 'W', id: 'cab_car', r: true });
    return vs;
  }

  buyRandom() {
    const g = this.g, rng = this.rng;
    const dep = rng.pick(this.deps);
    const r = g.trains.buy(this.randomConsist(), dep);
    if (r.error) return null;
    const t = r.train;
    if (rng.chance(0.4)) {
      t.mode = 'manual';
      const stops = rng.shuffle(this.sites.slice()).slice(0, rng.int(2, 4));
      t.route = stops.map((s) => ({ st: s.id, act: rng.pick(['auto', 'auto', 'load', 'unload', 'transfer', 'none']), dwell: rng.pick([0, 0, 5]), full: rng.chance(0.15), skip: false, plat: rng.chance(0.2) ? rng.int(0, s.tracks.length - 1) : null, cargo: null }));
      if (rng.chance(0.2) && g.net.waypoints.size) t.route.splice(1, 0, { wp: [...g.net.waypoints.keys()][0], act: 'auto', dwell: 0, full: false, skip: false, plat: null, cargo: null });
      // timetables on some lines (derived from the id: keeps the random stream of regression seeds)
      if (t.id % 3 === 0) t.spacing = [-1, 60, 120][Math.floor(t.id / 3) % 3];
    }
    this.note(`buy ${t.name} ${t.veh.map((v) => v.id).join('+')} ${t.mode}`);
    return t;
  }

  // one random live edit
  mutate() {
    const g = this.g, rng = this.rng, T = g.trains;
    const op = rng.pick(['signal', 'unsignal', 'single', 'double', 'extend', 'addtrack', 'bulldoze', 'consist', 'buy', 'sell', 'role', 'waypoint', 'removeTrack', 'upgrade']);
    switch (op) {
      case 'signal': this.randomSignal(); break;
      case 'unsignal': { const k = [...g.net.signals.keys()]; if (k.length) { g.net.signals.delete(rng.pick(k)); g.net.bumpVersion(); this.note('unsignal'); } break; }
      case 'single': case 'double': {
        const tiles = this.plainTiles((i) => !T.tileReserved(i) && !g.net.isJunction(i));
        if (!tiles.length) break;
        const t = rng.pick(tiles);
        g.net.single[t] = op === 'single' ? 1 : 0; g.net.bumpVersion(); g.railView.markDirty(t);
        this.note(`${op} ${t}`);
        break;
      }
      case 'extend': { const s = rng.pick(this.sites); if (!s || !g.stations.byId(s.id)) break; const r = g.stations.extendPlatform(s, rng.int(0, s.tracks.length - 1), rng.int(0, 1)); this.note(`extend ${s.id} ${r.error || 'ok'}`); break; }
      case 'addtrack': { const s = rng.pick(this.sites); if (!s || !g.stations.byId(s.id)) break; const r = g.stations.addTrack(s, rng.chance(0.5) ? 1 : -1); this.note(`addtrack ${s.id} ${r.error || 'ok'}`); break; }
      case 'removeTrack': { const s = rng.pick(this.sites); if (!s || s.tracks.length < 2) break; const r = g.stations.removeTrack(s, s.tracks.length - 1); this.note(`removetrack ${s.id} ${r.error || 'ok'}`); break; }
      case 'bulldoze': {
        const tiles = this.plainTiles((i) => g.net.degree(i) <= 2);
        if (!tiles.length) break;
        const t = rng.pick(tiles);
        const before = g.net.conn[t];
        g.construction.bulldoze(t);
        this.note(`bulldoze ${t} ${g.net.conn[t] === before ? 'refused' : 'done'}`);
        // rebuild quickly so the network stays usable
        if (g.net.conn[t] !== before && rng.chance(0.8)) {
          const ends = []; for (let d = 0; d < 8; d++) if ((before >> d) & 1) ends.push(step(t, d));
          if (ends.length === 2) { const C = g.construction; C.drag = { a: ends[0], b: ends[1] }; C.previewTrack(); if (C.plan && C.plan.ok) C.buildTrack(); C.drag = null; C.clearPreview(); this.note('rebuilt'); }
        }
        break;
      }
      case 'consist': { const t = rng.pick(T.trains); if (!t) break; const e = T.applyConsist(t, this.randomConsist()); this.note(`consist ${t.name} ${e || 'ok'}`); break; }
      case 'buy': if (T.trains.length < 14) this.buyRandom(); break;
      case 'sell': if (T.trains.length > 3) { const t = rng.pick(T.trains); T.sell(t); this.note(`sell ${t.name}`); } break;
      case 'role': { const s = rng.pick(this.sites); if (!s || !g.stations.byId(s.id)) break; g.stations.setTrackRole(s, rng.int(0, s.tracks.length - 1), rng.pick(['any', 'any', 'passenger', 'freight', 'express'])); break; }
      case 'waypoint': { const tiles = this.plainTiles((i) => g.net.degree(i) === 2 && !g.net.waypoints.has(i)); if (tiles.length) { g.construction.toggleWaypoint(rng.pick(tiles)); this.note('waypoint'); } break; }
      case 'upgrade': { const s = rng.pick(this.sites); if (s && g.stations.byId(s.id)) g.stations.upgrade(s); break; }
      default: break;
    }
  }

  saveRoundTrip() {
    const g = this.g;
    const d = g.serialize();
    const json = JSON.stringify(d);
    const back = migrate(JSON.parse(json));
    const err = validate(back);
    if (err) return 'validate ' + err;
    if (JSON.stringify(back) !== json) return 'migrate not idempotent on v3';
    if (/NaN|Infinity/.test(json)) return 'NaN/Infinity in save';
    return null;
  }

  run(minutes = 12, dt = 1 / 30, trace = false) {
    this.trace = trace;
    const g = this.g, T = g.trains;
    this.setup();
    if (!this.buildNetwork()) return { seed: this.seed, ok: true, skipped: true, detail: 'no usable network' };
    const want = this.rng.int(4, 9);
    for (let k = 0; k < want; k++) this.buyRandom();
    const res = { seed: this.seed, overlaps: 0, keyConflicts: 0, nan: 0, errors: 0, stuck: [], saveErr: null, trips: 0, trains: 0, firstOverlap: null };
    const c0 = T.collisions, e0 = T.errors || 0;
    const trips0 = new Map(T.trains.map((t) => [t.id, t.trips]));
    const steps = Math.round((minutes * 60) / dt);
    const check = Math.max(1, Math.round(0.25 / dt));
    const mutEvery = Math.round(15 / dt);
    const tmp = new (g.scene.position.constructor)();
    const hist = new Map();
    for (let i = 0; i < steps; i++) {
      g.tick(dt);
      if (this.trace) for (const t of T.trains) {
        const h = hist.get(t.id) || []; hist.set(t.id, h);
        const sig = this.trace === 'coarse' ? `${t.state} head=${t.steps.length ? t.steps[T.stepAt(t, t.s)].tile : -1} last=${t.steps.length ? t.steps[t.steps.length - 1].tile : -1} tgt=${t.target} blk=${t.blockedBy}/${t.blockKind} flip=${t.flipped ? 1 : 0} v=${t.v > 0.01 ? 1 : 0}` : `${t.state} lane=${t.lane.toFixed(2)} s=${t.s.toFixed(2)} head=${t.steps.length ? t.steps[T.stepAt(t, t.s)].tile : -1} xo=${t.xo ? t.xo.s0.toFixed(2) + '-' + t.xo.s1.toFixed(2) : '-'} held=${[...t.held].join(',')} tgt=${t.target} blk=${t.blockedBy}/${t.blockKind}`;
        if (!h.length || h[h.length - 1].sig !== sig) { h.push({ time: g.time.toFixed(2), sig }); if (h.length > (this.trace === "coarse" ? 150 : 40)) h.shift(); }
      }
      if (i > 0 && i % mutEvery === 0) { try { this.mutate(); } catch (e) { res.errors++; this.note('mutate error ' + e.message); console.error(e); } }
      if (i % check) continue;
      const pts = [];
      for (const t of T.trains) {
        if (!t.steps.length || t.state === 'spawnwait') continue;
        // trail geometry: each step's samples must lie on its own tile
        if (!res.firstGeo) for (const o of t.steps) {
          if (o.shed) continue;   // the stretch inside a depot shed
          for (const f of [0.25, 0.5, 0.75]) {
            T.sampleAt(t, o.s0 + (o.s1 - o.s0) * f, tmp);
            const tx = Math.floor(tmp.x / 2), tz = Math.floor(tmp.z / 2);
            if (tz * 64 + tx !== o.tile && Math.abs(tmp.x / 2 - Math.round(tmp.x / 2)) > 0.02 && Math.abs(tmp.z / 2 - Math.round(tmp.z / 2)) > 0.02) {
              res.geoBad = (res.geoBad || 0) + 1;
              res.firstGeo = `t=${g.time.toFixed(2)} ${t.name} ${t.state} step ${o.tile} [${o.s0.toFixed(2)}-${o.s1.toFixed(2)}] f=${f} at ${tmp.x.toFixed(2)},${tmp.z.toFixed(2)} in=${o.inH} out=${o.outH} mine: ${this.events.filter((e) => e.includes(t.name)).slice(-3).join(' | ')} recent: ${this.events.slice(-4).join(' | ')}`;
              break;
            }
          }
          if (res.firstGeo) break;
        }
        // body integrity: every key under the body must be held by this train
        const L0 = T.trainLength(t), hd = T.stepAt(t, t.s);
        for (let k = 0; k <= hd; k++) {
          const st = t.steps[k];
          if (st.s1 < t.s - L0 + 0.3) continue;
          // (a reversed train also holds the lane it still stands on: physKeys)
          const miss = T.physKeys(t, st).filter((key) => !g.net.holds(key, t.id));
          if (miss.length && k === hd && t.headHold && t.v === 0 && t.headHold.every((key) => g.net.holds(key, t.id))) break;
          if (miss.length) {
            res.bodyGaps = (res.bodyGaps || 0) + 1;
            if (!res.firstGap) res.firstGap = `t=${g.time.toFixed(1)} ${t.name}#${t.id} ${t.state} s=${t.s.toFixed(2)} L=${L0.toFixed(2)} st=${st.s0.toFixed(2)}..${st.s1.toFixed(2)} veh=${t.veh.map((v) => v.id).join("+")} step ${k}/${hd} tile ${st.tile} ${st.inH}>${st.outH} keys ${st.keys.join(',')} xo ${t.xo ? t.xo.s0.toFixed(2) + '-' + t.xo.s1.toFixed(2) : '-'} resvEnd ${t.resvEnd} miss ${miss.join(',')} owners ${miss.map((key) => g.net.keyHolder(key) ?? "?").join(",")} mine: ${this.events.filter((e) => e.includes(t.name)).slice(-5).join(" | ")} recent: ${this.events.slice(-6).join(' | ')}`;
            break;
          }
        }
        if (!isFinite(t.s) || !isFinite(t.v)) res.nan++;
        const L = T.trainLength(t);
        for (let s = t.s - 0.2; s > t.s - L + 0.2 && s > (t.ss[0] || 0) + 0.05; s -= 0.5) {
          if (t.depotIn && s > t.depotIn.door) continue;   // already inside the depot shed
          T.lanePoint(t, s, tmp);
          pts.push({ t, s, x: tmp.x, z: tmp.z });
        }
        const mv = motionCheck(T, t, tmp);
        if (mv) { res.jumps = (res.jumps || 0) + 1; if (!res.firstJump) res.firstJump = `t=${g.time.toFixed(1)} ${mv} mine: ${this.events.filter((e) => e.includes(t.name)).slice(-4).join(' | ')}`; }
      }
      for (let a = 0; a < pts.length; a++) for (let b = a + 1; b < pts.length; b++) {
        if (pts[a].t === pts[b].t) continue;
        if (Math.hypot(pts[a].x - pts[b].x, pts[a].z - pts[b].z) < 0.45) {
          res.overlaps++;
          if (!res.firstOverlap) {
            const A = pts[a].t, B = pts[b].t;
            const dump = (t) => `${t.name}[${t.state} s=${t.s.toFixed(2)} lane=${t.lane.toFixed(2)} head=${t.steps[T.stepAt(t, t.s)].tile} rev=${t.rev ? t.rev.p.toFixed(2) : '-'} held=${[...t.held].join(',')} steps=${t.steps.map((x) => x.tile + (x.jn ? 'J' : '') + (x.station ? 'S' : '')).join(' ')}]`;
            if (this.trace) res.trace = [A, B].map((t) => t.name + ':\n' + (hist.get(t.id) || []).map((e) => '  ' + e.time + ' ' + e.sig).join('\n')).join('\n');
            const geo = (t) => { const hk = T.stepAt(t, t.s); return t.steps.slice(Math.max(0, hk - 3), hk + 2).map((o) => { T.sampleAt(t, o.s0 + 0.01, tmp); const a = `${tmp.x.toFixed(1)},${tmp.z.toFixed(1)}`; T.sampleAt(t, o.s1 - 0.01, tmp); return `${o.tile}[${o.s0.toFixed(2)}-${o.s1.toFixed(2)} ${a}>${tmp.x.toFixed(1)},${tmp.z.toFixed(1)} k${o.keys.join('/')}]`; }).join(' '); };
            res.geo = `A ${geo(A)} | B ${geo(B)} | ss0A=${A.ss[0]} ssNA=${A.ss[A.ss.length - 1].toFixed(2)}`;
            res.firstOverlap = `t=${g.time.toFixed(1)} at (${pts[a].x.toFixed(2)},${pts[a].z.toFixed(2)}) sA=${pts[a].s.toFixed(2)} vs (${pts[b].x.toFixed(2)},${pts[b].z.toFixed(2)}) sB=${pts[b].s.toFixed(2)} ${dump(A)} vs ${dump(B)} recent: ${this.events.slice(-6).join(' | ')}`;
          }
          a = pts.length; break;
        }
      }
    }
    res.keyConflicts = T.collisions - c0;
    res.errors += (T.errors || 0) - e0;
    if ((T.errors || 0) > e0) res.lastError = T.lastError;
    for (const t of T.trains) {
      if (t.state === 'run' && t.wait > 150) {
        res.stuck.push(`${t.name}:${t.blockKind}:${t.wait.toFixed(0)}s`);
        const b = T.byId(t.blockedBy);
        const next = t.steps[t.resvEnd + 1];
        const bb = b && T.byId(b.blockedBy);
        if (this.trace && !res.trace) res.trace = [t, b, bb, ...T.trains.filter((x) => x.state === 'lost')].filter((x, i, arr) => x && arr.indexOf(x) === i).map((x) => x.name + ':\n' + (hist.get(x.id) || []).map((e) => '  ' + e.time + ' ' + e.sig).join('\n')).join('\n');
        res.stuckInfo = (res.stuckInfo || '') + ` [${t.name} s=${t.s.toFixed(2)} stopS=${t.stopS.toFixed(2)} resvEnd=${t.resvEnd} hk=${T.stepAt(t, t.s)} n=${t.steps.length} near=${t.steps.slice(Math.max(0, T.stepAt(t, t.s) - 1), T.stepAt(t, t.s) + 4).map((o) => o.tile + (o.jn ? 'J' : '') + ':' + o.inH + '>' + o.outH + '@' + o.s0.toFixed(1) + (o.jn ? (g.net.switchReady(o.tile, o.inH == null ? 8 : (o.inH + 4) & 7, o.outH == null ? 8 : o.outH) ? '+' : '-') + (() => { const sw = g.net.switches.get(o.tile); const m = g.net.jres.get(o.tile); return `{sw=${sw ? sw.a + '-' + sw.b + '/' + sw.t.toFixed(1) : 'none'} j=${m ? [...m].map(([id, ps]) => id + ':' + ps.map((p) => p.join('-')).join(',')).join(';') : ''} deg=${g.net.degree(o.tile)}}`; })() : '')).join(' ')} veh=${t.veh.map((v) => v.id).join('+')} tgt=${t.target} next=${next ? next.tile + (next.jn ? 'J' : '') + (next.station ? 'S' : '') : '-'} keys=${next ? next.keys.join(',') : ''} blockedBy=${b ? `${b.name} ${b.state} stateT=${b.stateT.toFixed(0)} wait=${b.wait.toFixed(0)} prob=${b.problem} head=${b.steps.length ? b.steps[T.stepAt(b, b.s)].tile : -1} held=${[...b.held].join(',')}` : t.blockedBy}]`;
      }
      res.trips += t.trips - (trips0.get(t.id) || 0);
    }
    res.trains = T.trains.length;
    res.saveErr = this.saveRoundTrip();
    res.deadlocks = T.incidents.length;
    res.ok = !res.geoBad && !res.jumps && !res.bodyGaps && !res.overlaps && !res.keyConflicts && !res.nan && !res.errors && !res.saveErr && res.stuck.length === 0 && (res.trips > 0 || T.trains.every((t) => t.mode === 'auto' && ['no_cargo', 'no_demand', 'no_stations'].includes(t.problem)));
    if (!res.trips) res.states = T.trains.map((t) => `${t.name}:${t.state}/${t.problem}/${t.mode} tgt=${t.target} route=${(t.route || []).length}`).join(' ') + ` stations=${g.stations.list.length} sites=${this.sites.length}`;
    res.detail = `${res.jumps ? 'JUMPS ' + res.jumps + ' (' + res.firstJump + ') ' : ''}gaps ${res.bodyGaps || 0} trains ${res.trains} trips ${res.trips} overlaps ${res.overlaps} keys ${res.keyConflicts} nan ${res.nan} errors ${res.errors} stuck ${res.stuck.join(',') || 0} deadlocks ${res.deadlocks} save ${res.saveErr || 'ok'}`;
    return res;
  }
}

export { TRACK_TIERS, computeStats, locoModel };
