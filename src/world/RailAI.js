// Competitor railway planner (Phase 9). A rival company with a railway
// personality plans, builds and runs railways through the same game systems
// as the player: it pays for every tile, station, depot and train from its
// own money, its trains run on the normal simulation and signalling, and it
// is paid only for what its trains deliver. Its networks never touch the
// player's (RailNetwork.own): it cannot build on, through or into anyone
// else's track or stations, and it keeps a courtesy distance around the
// player's stations and depots.
//
// A railway is a project that moves through stages, at most one stage per
// thinking tick, so the company's behaviour stays readable:
//   discover → evaluate → design → budget → approve → construct → operate
//   → review → (expand | retire)
// Opportunities come from a cached, sampled candidate list (important town
// pairs and industry chains near the company's home), never from scanning
// every pair on every tick. Operating projects are diagnosed monthly for one
// bottleneck at a time (waiting loads, delays on single track, short
// platforms, busy stations) and get the cheapest fitting answer: another
// train, a passing loop, double track, a longer platform or another platform.
// Every action has a cooldown and the company remembers rejected ideas.
//
// Randomness is seeded by world seed, company and month, so a world plays
// out the same way given the same player-independent conditions.
import { N, TILE, RNG, hashStr, cheb, idx, tx, tz, step, onLayer, layerOf, inMap, DX, DZ } from '../util.js';
import { LOCOS, CARGO, RESEARCH, INDUSTRIES, TOWN_PRODUCTION } from '../config.js';
import { autoBuild, computeStats, locoModel, consistCost } from '../trains/Consist.js';
import { MONTH_S } from '../economy/Ledger.js';
import { log } from '../core/Log.js';
import { NO_FX } from './Owners.js';
import { K_BRIDGE, K_TUNNEL } from '../rail/RailNetwork.js';
import { bandOf } from './Eras.js';

// ---------- personalities ----------
// pax/freight: preference weights; risk: debt tolerance (0..1); reserve:
// cash kept back as a share of company value; growth: new projects a year at
// most; minRoi: the yearly return a project must promise; premium: prefers
// big cities, long distances and fast trains; short: prefers short commuter
// hops; single: chance a new line starts single track.
export const PERSONALITIES = {
  railway: { pax: 0.5, freight: 0.5, risk: 0.5, reserve: 0.12, growth: 2, minRoi: 0.12, premium: 0.3, short: 0, single: 0.75 },
  freight: { pax: 0.05, freight: 1, risk: 0.5, reserve: 0.12, growth: 2, minRoi: 0.12, premium: 0, short: 0, single: 0.85 },
  regional: { pax: 1, freight: 0.1, risk: 0.35, reserve: 0.15, growth: 2, minRoi: 0.1, premium: 0, short: 1, single: 0.7 },
  premium: { pax: 1, freight: 0, risk: 0.6, reserve: 0.1, growth: 1, minRoi: 0.14, premium: 1, short: 0, single: 0.3 },
  conservative: { pax: 0.6, freight: 0.5, risk: 0.15, reserve: 0.3, growth: 1, minRoi: 0.2, premium: 0.1, short: 0.3, single: 0.9 },
  aggressive: { pax: 0.7, freight: 0.7, risk: 0.85, reserve: 0.06, growth: 3, minRoi: 0.08, premium: 0.3, short: 0.2, single: 0.6 },
};
// competitor skill: how often the company thinks (months), how many
// candidates it looks at, how far ahead it plans (years) and how noisy its
// estimates are. Never free money, vehicles or construction.
export const AI_LEVELS = {
  relaxed: { think: 3, candidates: 5, horizon: 6, noise: 0.35 },
  standard: { think: 2, candidates: 8, horizon: 8, noise: 0.2 },
  tycoon: { think: 1, candidates: 12, horizon: 10, noise: 0.1 },
  expert: { think: 1, candidates: 18, horizon: 12, noise: 0.03 },
};
export const AI_LEVEL_IDS = Object.keys(AI_LEVELS);

const STAGES = ['discover', 'evaluate', 'design', 'budget', 'approve', 'construct', 'operate', 'review', 'retired'];
const COOLDOWN = { train: 4, loop: 8, double: 18, platform: 10, track: 12, modern: 12, electrify: 24, retire: 24 };
const COURTESY = 2;
const TRAIN_OP = 45;                        // a typical small train's running cost a game month                         // tiles kept free around the player's stations and depots

// the loco era a calendar year allows
// (steam until 1930, heavy steam until 1960, diesel, electric from 1980, high
// speed from 2000, maglev from 2030: the same eras as Ledger.era)
export function eraOfYear(y) { return y < 1930 ? 1 : y < 1960 ? 2 : y < 1980 ? 3 : y < 2000 ? 4 : y < 2030 ? 5 : 6; }

export class RailPlanner {
  constructor(game, rival) {
    this.game = game;
    this.r = rival;
    const st = rival.rail;
    if (!st.projects) Object.assign(st, { projects: [], nextId: 1, memory: {}, history: [], log: [], lastNew: -99, founded: null, cands: null, candM: -99 });
  }
  get st() { return this.r.rail; }
  get P() { return PERSONALITIES[this.r.personality] || PERSONALITIES.railway; }
  get L() { return AI_LEVELS[this.game.rivals.aiLevel] || AI_LEVELS.standard; }
  month() { return this.game.ledger.monthIndex(); }
  year() { return this.game.ledger.year(); }
  rng(tag) { return new RNG(hashStr(`ai:${this.game.world.seed}:${this.r.id}:${tag}:${this.month()}`)); }

  // run a build action as this company (costs and ownership are its own)
  as(fn) {
    const g = this.game, prev = g.actor;
    g.actor = this.r;
    try { return fn(); } finally { g.actor = prev; }
  }
  // a new line: as this company, never merging into existing track
  newLine(fn, inside) {
    const g = this.game, prev = g.aiNewLine;
    g.aiNewLine = true;
    try { return inside ? fn() : this.as(fn); } finally { g.aiNewLine = prev; }
  }
  // work on an existing line: now, or as pending works while its trains pass
  upgradeTrack(a, b, tier, mode) {
    const g = this.game;
    return this.as(() => {
      const r = g.construction.trackOp(a, b, tier, mode);
      if (r.error !== 'err_train_on_track') return r;
      const w = g.works.add('track', { a, b, tier, mode });
      return w.error ? w : { ok: true, pending: true };
    });
  }
  note(kind, text, extra) {
    const e = { m: this.month(), kind, text, ...(extra || {}) };
    this.st.log.push(e);
    if (this.st.log.length > 60) this.st.log.shift();
    log.info('ai', `${this.r.name}: ${text}`, extra || null);
  }
  remember(key, months) { this.st.memory[key] = this.month() + months; }
  blocked(key) { return (this.st.memory[key] || -1) > this.month(); }

  // ---------- monthly entry ----------
  monthly(m) {
    const st = this.st;
    if (st.founded == null) { st.founded = this.year(); this.note('found', `founded in ${st.founded}`); }
    // expire memories
    for (const k in st.memory) if (st.memory[k] <= m) delete st.memory[k];
    const ops = st.projects.filter((p) => p.stage === 'operate' || p.stage === 'review');
    // tactical: one bottleneck answer per month
    for (const p of ops) this.observe(p);
    if (this.r.money > 0) for (const p of this.rng('ops').shuffle(ops.slice())) if (this.improve(p)) break;
    // yearly: review results, modernize the fleet
    if (m % 12 === 0) { for (const p of ops) this.review(p); this.modernize(); this.renovate(); }
    // strategic thinking (spread over companies by their index)
    if ((m + this.r.idx) % this.L.think === 0) this.think(m);
  }

  // ---------- strategy ----------
  think(m) {
    const st = this.st;
    // move the project in the pipeline one stage on
    const pending = st.projects.find((p) => STAGES.indexOf(p.stage) < STAGES.indexOf('operate'));
    if (pending) { this.advance(pending); return; }
    // a new idea: within the yearly growth, with cash to spare and no debt spiral
    const perYear = st.projects.filter((p) => p.started != null && p.started > m - 12).length;
    if (perYear >= this.P.growth) return;
    if (this.r.money < this.reserve() + 2000) return;
    // now and then a metro for a big city (Phase 11): rare and only when it pays
    if (this.metroIdea()) return;
    const cand = this.discover();
    if (!cand) return;
    const p = { id: st.nextId++, stage: 'evaluate', kind: cand.kind, cargo: cand.cargo, a: cand.a, b: cand.b, est: cand.est, started: m, trains: [], stations: [], depot: null, tiles: 0, mode: 'single', loops: 0, cd: {}, rev: [], hist: [] };
    st.projects.push(p);
    this.note('discover', `opportunity ${this.endName(p.a)} → ${this.endName(p.b)} (${p.cargo}), estimated ${Math.round(cand.est.roi * 100)}% a year`, { project: p.id });
  }
  reserve() { return Math.max(1500, this.r.value() * this.P.reserve); }
  advance(p) {
    const fn = { evaluate: () => this.evaluate(p), design: () => this.design(p), budget: () => this.budget(p), approve: () => this.approve(p), construct: () => this.construct(p) }[p.stage];
    if (fn) fn();
  }
  reject(p, why, months = 36) {
    this.remember(`pair:${p.a.t}:${p.a.id}:${p.b.t}:${p.b.id}`, months);
    p.stage = 'retired'; p.reason = why;
    this.st.projects = this.st.projects.filter((x) => x !== p);
    this.st.history.push({ m: this.month(), id: p.id, a: this.endName(p.a), b: this.endName(p.b), outcome: 'rejected', why });
    if (this.st.history.length > 40) this.st.history.shift();
    this.note('reject', `drops ${this.endName(p.a)} → ${this.endName(p.b)}: ${why}`, { project: p.id });
  }

  // where the company feels at home: around its home region's centre
  home() {
    const g = this.game, r = this.r;
    if (r.home == null) {
      // a region other than the player's start region when possible
      // (the open regions: towns and industries elsewhere are asleep; with
      // several open regions each company favours a different one)
      const P = g.progression, regs = new Map();
      for (const t of g.towns.list) { if (!P.regionUnlocked(t.region)) continue; const e = regs.get(t.region) || { n: 0, x: 0, z: 0 }; e.n++; e.x += t.x; e.z += t.z; regs.set(t.region, e); }
      const ids = [...regs.keys()].sort((a, b) => a - b);
      const pick = ids.length ? ids[(r.idx - 1) % ids.length] : 0;
      const e = regs.get(pick) || { n: 1, x: N / 2, z: N / 2 };
      r.home = { region: pick, x: Math.round(e.x / e.n), z: Math.round(e.z / e.n), regions: ids.length };
    }
    return r.home;
  }

  // ---------- discover: a sampled, cached candidate list ----------
  candidates() {
    const g = this.game, st = this.st, m = this.month();
    if (st.cands && m - st.candM < 12) return st.cands;
    const P = this.P, H = this.home(), PR = g.progression;
    // a newly opened region moves the company's home on
    if (H.regions !== g.towns.list.reduce((s, t) => (PR.regionUnlocked(t.region) ? s.add(t.region) : s), new Set()).size) { this.r.home = null; return this.candidates(); }
    const reach = Math.round(N * 0.55);
    const near = (o) => PR.regionUnlocked(o.region) && Math.max(Math.abs(o.x - H.x), Math.abs(o.z - H.z)) <= reach;
    const out = [];
    const minD = P.short ? 6 : 9, maxD = Math.round(P.short ? 14 + N / 16 : 16 + N / 5);
    if (P.pax > 0.2) {
      // the most important towns first (population, not every pair)
      const towns = g.towns.list.filter(near).sort((a, b) => b.pop - a.pop).slice(0, P.premium > 0.5 ? 10 : 16);
      for (let i = 0; i < towns.length; i++) for (let j = i + 1; j < towns.length; j++) {
        const A = towns[i], B = towns[j], d = Math.max(Math.abs(A.x - B.x), Math.abs(A.z - B.z));
        if (d < minD || d > maxD * (1 + P.premium * 0.4)) continue;
        out.push({ kind: 'pax', cargo: 'PASSENGERS', a: { t: 'town', id: A.id }, b: { t: 'town', id: B.id }, d });
      }
    }
    if (P.freight > 0.2) {
      const I = g.industries;
      // (a processing plant only counts while it actually produces)
      const producing = (x) => INDUSTRIES[x.type].primary || (x.lastPv || 0) > 0;
      for (const ind of I.list.filter((x) => near(x) && !x.closed && producing(x))) for (const c of I.outputs(ind)) {
        if (c === 'PASSENGERS' || c === 'MAIL') continue;
        let best = null;
        for (const dst of I.list) {
          if (dst === ind || dst.closed || !I.accepts(dst, c)) continue;
          const d = Math.max(Math.abs(dst.x - ind.x), Math.abs(dst.z - ind.z));
          if (d < 7 || d > maxD) continue;
          if (!best || Math.abs(d - 16) < Math.abs(best.d - 16)) best = { dst, d };
        }
        if (best) out.push({ kind: 'freight', cargo: c, a: { t: 'ind', id: ind.id }, b: { t: 'ind', id: best.dst.id }, d: best.d });
      }
    }
    st.cands = out; st.candM = m;
    return out;
  }
  discover() {
    const L = this.L, rng = this.rng('discover');
    const pool = this.candidates().filter((c) => !this.blocked(`pair:${c.a.t}:${c.a.id}:${c.b.t}:${c.b.id}`) && !this.serves(c));
    if (!pool.length) return null;
    // quick estimates on a sample, the best one goes on to evaluation
    const sample = rng.shuffle(pool.slice()).slice(0, L.candidates * 3);
    let best = null;
    for (const c of sample) {
      const est = this.estimate(c);
      if (!est) continue;
      const sc = est.roi * (1 + (rng.next() - 0.5) * L.noise) * (c.kind === 'pax' ? 0.5 + this.P.pax : 0.5 + this.P.freight);
      if (!best || sc > best.sc) best = { ...c, est, sc };
    }
    return best && best.est.roi >= this.P.minRoi * 0.7 ? best : null;
  }
  // does the company (or anyone) already run this corridor?
  serves(c) {
    return this.st.projects.some((p) => (p.a.t === c.a.t && p.a.id === c.a.id && p.b.t === c.b.t && p.b.id === c.b.id) || (p.a.t === c.b.t && p.a.id === c.b.id && p.b.t === c.a.t && p.b.id === c.a.id));
  }
  endObj(e) { return e.t === 'town' ? this.game.towns.byId(e.id) : this.game.industries.byId(e.id); }
  endName(e) { const o = this.endObj(e); return o ? (e.t === 'town' ? o.name : this.game.industries.displayName(o)) : '?'; }

  // rough yearly figures without building anything: demand, revenue at the
  // distance, costs from the straight line (water and hills cost more), and
  // how well others already serve both ends
  estimate(c) {
    const g = this.game, E = g.economy, A = this.endObj(c.a), B = this.endObj(c.b);
    if (!A || !B) return null;
    const d = c.d;
    let units;
    // travellers a month from each town (TOWN_PRODUCTION), a share of it at the new station
    if (c.kind === 'pax') units = (TOWN_PRODUCTION.paxBase * 2 + (A.pop + B.pop) * TOWN_PRODUCTION.paxPerPop) * 12 * 1.5;   // (calibrated on test worlds)
    else units = (INDUSTRIES[A.type].primary ? g.industries.rate(A) : Math.max(0, (A.lastPv || 0) / Math.max(1, CARGO[c.cargo].value))) * 12 * 0.8;   // (rate: units a month)
    const compA = this.othersNear(A), compB = this.othersNear(B);
    const share = 1 / (1 + compA * 0.6 + compB * 0.6);
    units *= share;
    const rev = E.revenue(c.cargo, units, d, null, false, d * 3);
    const len = Math.round(d * 1.25);
    let rough = 0;
    for (let k = 0; k <= d; k++) {
      const x = Math.round(A.x + ((B.x - A.x) * k) / d), z = Math.round(A.z + ((B.z - A.z) * k) / d);
      const i = idx(x, z);
      if (i < 0) continue;
      const kd = g.net.kind(i);
      rough += kd === K_TUNNEL ? 4 : kd === K_BRIDGE ? 5 : 1;
    }
    const track = E.costs.trackTile(0, 0) * len * (rough / Math.max(1, d + 1)) * 0.75;
    const build = track + E.costs.station() * 2 + E.costs.depot();
    const trainCost = 3000 * E.costs.mul();
    const op = 12 * TRAIN_OP;             // a small train's running cost a year (op is per game month)
    const profit = rev - op;
    const roi = profit / (build + trainCost);
    return { units: Math.round(units), rev: Math.round(rev), build: Math.round(build), roi, comp: compA + compB };
  }
  othersNear(o) {
    const g = this.game;
    let n = 0;
    for (const s of g.stations.list) if (s.owner !== this.r.id && cheb(s.tile, idx(o.x, o.z)) <= 5) n++;
    return Math.min(3, n);
  }

  // ---------- evaluate / design / budget / approve ----------
  evaluate(p) {
    const A = this.endObj(p.a), B = this.endObj(p.b);
    if (!A || !B || (p.a.t === 'ind' && A.closed) || (p.b.t === 'ind' && B.closed)) { this.reject(p, 'an end no longer exists'); return; }
    // the town must be willing (a concession, or bad relations with this company)
    for (const e of [p.a, p.b]) if (e.t === 'town') {
      const t = this.endObj(e);
      if (this.game.standing && this.game.standing.concessionActive(t)) { this.reject(p, `${t.name} gave another company a concession`, 24); return; }
      if (this.r.townRel(t.id) < 35) { this.reject(p, `${t.name} refuses (relations)`, 24); return; }
    }
    // the player serves this corridor very well already: look elsewhere, mostly
    const est = this.estimate({ ...p, d: Math.max(Math.abs(A.x - B.x), Math.abs(A.z - B.z)) });
    if (!est || est.roi < this.P.minRoi * 0.7) { this.reject(p, 'too little return'); return; }
    if (est.comp >= 4 && this.rng('comp').next() > this.P.risk) { this.reject(p, 'already well served by others', 48); return; }
    p.est = est;
    p.stage = 'design';
  }
  // sites for both stations and the corridor between them (a dry run through
  // the player's own planner, so the result is buildable)
  design(p) {
    const A = this.endObj(p.a), B = this.endObj(p.b);
    p.plat = this.platformLen(p);
    const sa = this.siteNear(A, B, p), sb = this.siteNear(B, A, p);
    if (!sa || !sb) { this.reject(p, 'no room for a station'); return; }
    // (a reused station is joined at whichever platform end gives a route: a through station)
    let route = null;
    for (const ea of this.endsOf(sa)) for (const eb of this.endsOf(sb)) {
      const rr = this.newLine(() => this.game.construction.trackOp(ea, eb, 0, 'single', true));
      if (!rr.error && rr.tiles && (!route || rr.tiles.length < route.tiles.length)) { route = rr; p.ends = [sa.reuse ? ea : null, sb.reuse ? eb : null]; }
    }
    if (!route) { this.reject(p, 'no buildable corridor'); return; }
    const q = this.quality(route.tiles, sa.tile, sb.tile);
    if (q.detour > 1.9) { this.reject(p, `corridor too roundabout (${q.detour.toFixed(2)}×)`); return; }
    if (q.turnsPer10 > 5) { this.reject(p, 'corridor too twisty'); return; }
    p.sites = [sa, sb]; p.route = { cost: route.cost, tiles: route.tiles.length, q };
    p.stage = 'budget';
    this.note('design', `designs ${this.endName(p.a)} → ${this.endName(p.b)}: ${route.tiles.length} tiles, detour ${q.detour.toFixed(2)}×`, { project: p.id });
  }
  // the tiles a new line may join a site at: a new site's own tile, or the
  // free ends of a reused station's platforms
  endsOf(site) {
    if (!site.reuse) return [site.tile];
    const s = this.game.stations.byId(site.reuse);
    if (!s) return [site.tile];
    const out = [];
    for (const tk of s.tracks) { out.push(tk.tiles[0]); if (tk.tiles.length > 1) out.push(tk.tiles[tk.tiles.length - 1]); }
    return out;
  }
  // a quality measure of a corridor: detour against the straight line and direction changes
  quality(tiles, a, b) {
    let turns = 0, prev = -1;
    for (let k = 1; k < tiles.length; k++) {
      const dx = tx(tiles[k]) - tx(tiles[k - 1]), dz = tz(tiles[k]) - tz(tiles[k - 1]);
      const d = (dx + 1) * 3 + (dz + 1);
      if (prev >= 0 && d !== prev) turns++;
      prev = d;
    }
    const straight = Math.max(1, cheb(a, b));
    return { detour: tiles.length / straight, turnsPer10: (turns / Math.max(1, tiles.length)) * 10, turns };
  }
  // platform length by demand: a village gets a short platform, a city a long one
  platformLen(p) {
    if (p.kind === 'freight') return 3;
    const A = this.endObj(p.a), B = this.endObj(p.b);
    const pop = Math.min(A.pop, B.pop);
    return pop > 2500 ? 4 : pop > 900 ? 3 : 2;
  }
  // a free tile near the town centre / industry, facing the other end, clear
  // of other companies' stations (courtesy) and not inside the town core
  siteNear(o, other, p) {
    const g = this.game, S = g.stations, net = g.net;
    // reuse an own station that already serves this end (network synergy)
    const mineHere = S.list.find((s) => s.owner === this.r.id && cheb(s.tile, idx(o.x, o.z)) <= 4);
    if (mineHere) return { tile: mineHere.tile, reuse: mineHere.id };
    const ax = Math.abs(other.x - o.x) >= Math.abs(other.z - o.z) ? 0 : 2;     // east-west or north-south
    let best = null;
    for (let r = 1; r <= 5; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const x = o.x + dx, z = o.z + dz;
      if (x < 2 || z < 2 || x >= N - 2 || z >= N - 2) continue;
      const t = idx(x, z);
      if (net.conn[t] || this.courtesy(t)) continue;
      if (this.as(() => S.placeError(t, 'station'))) continue;
      // the station must actually reach its town or industry
      const lk = this.as(() => S.previewLinks([t], 0));
      if (!(p && p.kind === 'freight' ? lk.inds.includes(o) : lk.towns.includes(o))) continue;
      // room for the whole platform on the side away from the other end
      const away = awayDir(ax, x, z, other);
      let room = 1, j = t;
      for (let k = 1; k < (p ? p.plat || 3 : 3); k++) { j = step(j, away); if (j < 0 || net.conn[j] || net.special.has(j) || this.courtesy(j) || this.as(() => S.placeError(j, 'station'))) break; room++; }
      if (room < Math.min(2, p ? p.plat || 2 : 2)) continue;
      const toward = Math.max(Math.abs(other.x - x), Math.abs(other.z - z));
      const sc = r * 1.5 + toward * 0.2 - room;
      if (!best || sc < best.sc) best = { tile: t, axis: ax, away, room, sc };
    }
    return best;
  }
  // tiles next to the player's stations and depots stay free for the player
  courtesy(t) {
    const g = this.game, net = g.net;
    for (let dz = -COURTESY; dz <= COURTESY; dz++) for (let dx = -COURTESY; dx <= COURTESY; dx++) {
      const j = idx(tx(t) + dx, tz(t) + dz);
      if (j >= 0 && net.special.has(j) && net.own[j] === 0) return true;
    }
    return false;
  }
  budget(p) {
    const g = this.game, E = g.economy;
    const trainCost = this.trainCost(p);
    const build = p.route.cost + E.costs.station() * (p.sites.filter((s) => !s.reuse).length) * (1 + p.plat * 0.3) + E.costs.depot();
    p.budget = Math.round(build + trainCost);
    const yearly = p.est.rev - 12 * TRAIN_OP;
    p.roi = yearly / Math.max(1, p.budget);
    if (p.roi < this.P.minRoi) { this.reject(p, `return ${Math.round(p.roi * 100)}% below target`); return; }
    if (p.budget / Math.max(1, yearly) > this.L.horizon) { this.reject(p, 'pays back too late'); return; }
    p.stage = 'approve';
  }
  approve(p) {
    const r = this.r;
    const need = p.budget + this.reserve();
    if (r.money < need) {
      // borrow for a strong project, within the personality's debt tolerance
      const room = r.loanRoom() * this.P.risk;
      if (p.roi > this.P.minRoi * 1.3 && r.money + room >= need) r.borrow(need - r.money);
      else { if (!p.wait) { p.wait = 0; } p.wait++; if (p.wait > 6) this.reject(p, 'no money for it', 18); return; }
    }
    p.stage = 'construct';
    this.note('approve', `approves ${this.endName(p.a)} → ${this.endName(p.b)} (budget ${p.budget})`, { project: p.id });
    this.game.events.emit('rivalProject', r, p, 'plan');
  }

  // ---------- construct ----------
  construct(p) {
    const g = this.game, S = g.stations;
    const ok = this.as(() => {
      const spent0 = this.r.spent;
      const stns = [];
      for (const s of p.sites) {
        if (s.reuse) { const e = S.byId(s.reuse); if (!e) return 'station gone'; stns.push(e); continue; }
        const res = S.build(s.tile, s.axis);
        if (res.error) return 'station: ' + res.error;
        // the whole platform first, growing away from the other end
        this.lengthen(res.station, p.plat, s.away);
        stns.push(res.station);
      }
      p.stations = stns.map((s) => s.id);
      if (Math.min(...stns.map((s) => s.tracks[0].tiles.length)) < 2) { this.undoStations(p, stns); return 'platform too short'; }
      const mode = this.rng('mode').next() < this.P.single ? 'single' : 'double';
      // the line joins the platform ends that face each other
      const ends = p.ends || [];
      const ea = ends[0] != null ? ends[0] : this.facingEnd(stns[0], stns[1]), eb = ends[1] != null ? ends[1] : this.facingEnd(stns[1], stns[0]);
      const tr = this.newLine(() => g.construction.trackOp(ea, eb, 0, mode), true);
      if (tr.error) { this.undoStations(p, stns); return 'track: ' + tr.error; }
      p.mode = mode;
      // a depot beside the line near the first station
      const dep = this.placeDepot(stns[0]) || this.placeDepot(stns[1]);
      if (!dep) return 'no depot site';
      p.depot = dep.id;
      p.cost = this.r.spent - spent0;
      return null;
    });
    if (ok) { this.reject(p, 'construction failed: ' + ok, 24); return; }
    p.stage = 'operate'; p.opened = this.month();
    p.tiles = this.corridorTiles(p).length;
    this.addTrain(p);
    this.st.lastNew = this.month();
    this.note('open', `opens ${this.endName(p.a)} → ${this.endName(p.b)} (${p.mode} track, ${p.tiles} tiles)`, { project: p.id });
    this.game.events.emit('rivalProject', this.r, p, 'open');
  }
  undoStations(p, stns) { for (const s of stns) if (!p.sites.some((x) => x.reuse === s.id) && s.owner === this.r.id) this.game.stations.remove(s); }
  // lengthen platform 0 to len tiles; `away` (a direction) prefers that end
  lengthen(stn, len, away) {
    const S = this.game.stations;
    const ax = S.axisOf(stn);
    const pref = away == null ? [1, 0] : away === ax ? [1, 0] : [0, 1];
    for (let k = 0; k < 6 && stn.tracks[0].tiles.length < len; k++) {
      let done = false;
      for (const end of pref) { const r = S.extendPlatform(stn, 0, end); if (r.ok) { done = true; break; } }
      if (!done) break;
    }
  }
  // the end tile of a station's first platform nearest to another station
  facingEnd(s, o) {
    const tl = s.tracks[0].tiles, a = tl[0], b = tl[tl.length - 1];
    return cheb(a, o.tile) <= cheb(b, o.tile) ? a : b;
  }
  placeDepot(stn) {
    const g = this.game, net = g.net, S = g.stations;
    const tiles = S.allTiles(stn);
    for (let r = 1; r <= 4; r++) for (const base of tiles) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const t = idx(tx(base) + dx, tz(base) + dz);
      if (t < 0 || net.conn[t] || this.courtesy(t) || S.placeError(t, 'depot')) continue;
      let adj = false;
      for (const d of [0, 2, 4, 6]) { const j = step(t, d); if (j >= 0 && net.conn[j] && net.own[j] === this.r.idx && net.degree(j) < 3 && !net.special.has(j)) adj = true; }
      if (!adj) continue;
      const res = S.buildDepot(t);
      if (res.depot && net.conn[t]) return res.depot;
      if (res.depot) S.removeDepot(res.depot);
    }
    return null;
  }
  corridorTiles(p) {
    const g = this.game, S = g.stations, A = S.byId(p.stations[0]), B = S.byId(p.stations[1]);
    if (!A || !B) return [];
    const r = g.net.findRoute({ tile: A.tile, heading: null, fromCenter: true }, B.tile, { allowReverse: true });
    return r ? r.steps.map((s) => s.tile) : [];
  }

  // ---------- metro (Phase 11) ----------
  // a company with passengers at heart looks every two years at the largest
  // cities of its regions; one that has none yet and has grown to a city
  // gets a short underground line (a surface depot, a portal, two metro
  // stations) when the company can pay for it and the estimate says it
  // earns its upkeep. At most one metro per company.
  metroIdea() {
    const g = this.game, P = this.P;
    if (P.pax < 0.4 || this.blocked('metro') || this.st.projects.some((p) => p.kind === 'metro')) return false;
    this.remember('metro', 24);
    const era = eraOfYear(this.year());
    if (!LOCOS.some((m) => m.metro && m.era <= era)) return false;
    const PR = g.progression;
    const towns = g.towns.list.filter((t) => PR.regionUnlocked(t.region) && t.stage >= 4 && !this.metroIn(t)).sort((a, b) => b.pop - a.pop).slice(0, 3);
    for (const t of towns) {
      const plan = this.metroPlan(t);
      if (!plan) continue;
      // the estimate: city passengers against the running cost and the upkeep
      const upkeep = (plan.tunnel * 1.2 + 6 * 3 * 2 * 1.25) * 12;
      const rev = Math.min(t.pop, 40000) * 0.35;
      if (rev < upkeep * 2 + TRAIN_OP * 12) { this.note('reject', `no metro for ${t.name}: it would not pay (${Math.round(rev)} against ${Math.round(upkeep)} upkeep a year)`); continue; }
      if (this.r.money < this.reserve() + plan.cost * 1.4) { this.note('reject', `no metro for ${t.name} yet: ${Math.round(plan.cost)} is more than it can spare`); return false; }
      return this.metroBuild(t, plan);
    }
    return false;
  }
  // a metro station (anyone's) already under the town
  metroIn(t) {
    const g = this.game, r = g.towns.radius(t) + 2;
    return g.stations.list.some((s) => { const L = layerOf(s.tile); return (L === 1 || L === 2) && cheb(s.tile, idx(t.x, t.z)) <= r; });
  }
  // the geometry: a straight tunnel from beyond the town centre out to open
  // land, where a short surface spur carries the depot
  metroPlan(t) {
    const g = this.game, net = g.net, C = g.construction;
    const rng = this.rng('metro:' + t.id);
    for (const d of rng.shuffle([0, 2, 4, 6])) {
      const at = (k) => { const x = t.x + DX[d] * k, z = t.z + DZ[d] * k; return inMap(x, z) ? idx(x, z) : -1; };
      const F = at(-5);
      if (F < 0) continue;
      // the portal: the first spot 12-20 tiles out with four free surface tiles
      let k = -1;
      for (let kk = 12; kk <= 20 && k < 0; kk++) {
        let ok = true;
        for (let j = kk; j <= kk + 3 && ok; j++) { const i = at(j); if (i < 0 || net.conn[i] || net.tileBlockedReason(i) || !net.isUnlocked(i) || this.courtesy(i)) ok = false; }
        if (ok) k = kk;
      }
      if (k < 0) continue;
      let ok = true;
      for (let j = -5; j < k && ok; j++) { const i = at(j); const u = i < 0 ? -1 : onLayer(i, 1); if (u < 0 || net.conn[u] || net.special.has(u) || net.tileBlockedReason(u)) ok = false; }
      if (!ok) continue;
      const tunnel = C.planTrack(at(k), F, 2, 1);
      if (!tunnel || !tunnel.ok) continue;
      const cost = tunnel.cost + g.economy.costs.station(onLayer(at(0), 1)) * 6 + 4 * g.economy.costs.trackTile(2, 0) + g.economy.costs.depot() + 60000 * g.economy.costs.mul();
      return { d, k, at, tunnel: k + 5, cost, axis: d === 0 || d === 4 ? 0 : 1 };
    }
    return null;
  }
  metroBuild(t, plan) {
    const g = this.game, S = g.stations, C = g.construction, net = g.net, at = plan.at, k = plan.k;
    const p = { id: this.st.nextId++, stage: 'construct', kind: 'metro', cargo: 'PASSENGERS', a: { t: 'town', id: t.id }, b: { t: 'town', id: t.id }, est: { roi: 0 }, started: this.month(), trains: [], stations: [], depot: null, tiles: 0, mode: 'double', loops: 0, cd: {}, rev: [], hist: [], plat: 3, sites: [] };
    const built = [];
    const undo = () => this.as(() => {
      for (const id of p.stations) { const s = S.byId(id); if (s) S.remove(s); }
      const dep = S.depotById(p.depot); if (dep) S.removeDepot(dep);
      for (const i of built.reverse()) if (net.conn[i] && net.own[i] === this.r.idx && !net.special.has(i)) C.removeTrackOp(i);
    });
    const err = this.newLine(() => {
      const spent0 = this.r.spent;
      let r = C.trackOp(at(k + 3), at(k), 2, 'double');
      if (r.error) return 'spur: ' + r.error;
      for (let j = k; j <= k + 3; j++) built.push(at(j));
      r = C.trackOp(at(k), at(-5), 2, 'double', false, 1);
      if (r.error) return 'tunnel: ' + r.error;
      for (let j = -5; j < k; j++) built.push(onLayer(at(j), 1));
      for (const [a, len] of [[-1, 3], [k - 4, 3]]) {
        const res = S.build(onLayer(at(a), 1), plan.axis);
        if (res.error) return 'station: ' + res.error;
        p.stations.push(res.station.id);
        for (let n = 1; n < len; n++) S.extendPlatform(res.station, 0, 1).ok || S.extendPlatform(res.station, 0, 0);
      }
      // the depot beside the surface spur
      for (let j = k + 1; j <= k + 3 && !p.depot; j++) for (const side of [(plan.d + 2) & 7, (plan.d + 6) & 7]) {
        const dt = step(at(j), side);
        if (dt < 0 || p.depot || S.placeError(dt, 'depot')) continue;
        const res = S.buildDepot(dt);
        if (res.depot && net.conn[dt]) p.depot = res.depot.id; else if (res.depot) S.removeDepot(res.depot);
      }
      if (!p.depot) return 'no depot site';
      p.cost = this.r.spent - spent0;
      return null;
    });
    if (err) { undo(); this.remember('metro', 60); this.note('fail', `metro for ${t.name} failed: ${err}`); return false; }
    this.st.projects.push(p);
    p.stage = 'operate'; p.opened = this.month();
    p.tiles = this.corridorTiles(p).length;
    this.addTrain(p);
    this.st.lastNew = this.month();
    this.note('open', `opens a metro in ${t.name} (${plan.tunnel} tiles of tunnel)`, { project: p.id });
    g.events.emit('rivalProject', this.r, p, 'open');
    return true;
  }

  // ---------- trains ----------
  // a sensible train: the role fits the cargo, the era allows the loco, the
  // track allows the traction, and the train fits the shortest platform
  // budget: what it may spend on the train (never a loco it cannot pay for);
  // a branch between villages gets a cheap local engine, a premium company
  // between cities a fast one
  chooseLoco(p, tier, budget = Infinity) {
    const era = eraOfYear(this.year());
    const want = p.kind === 'freight' ? 'freight' : 'passenger';
    const mul = this.game.economy.costs.mul();
    // a metro line runs metro sets only (and no other line ever does)
    if (p.kind === 'metro') return LOCOS.filter((m) => m.metro && m.era <= era && m.price * mul * 1.3 <= budget).sort((a, b) => b.era - a.era || b.pax - a.pax)[0] || null;
    const cands = LOCOS.filter((m) => !m.mu && !m.metro && m.era <= era && (m.role === want || m.role === 'mixed') && minTierOf(m) <= tier && (p.kind === 'pax' ? m.pax > 0 : m.freight > 0) && m.price * mul * 1.3 <= budget);
    if (!cands.length) return null;
    const P = this.P, big = p.kind === 'pax' ? Math.min(...[p.a, p.b].map((e) => (this.endObj(e) || { pop: 0 }).pop)) : 0;
    const local = p.kind === 'pax' && big < 1500 && !P.premium;
    const score = (m) => m.era * 1.5 + (P.premium ? m.speed / 30 : 0) + (p.kind === 'freight' ? m.power / 700 : m.pax / 25)
      + (local && (m.duty === 'local' || m.trait === 'city_hopper') ? 2 : 0) - (m.price * mul) / Math.max(2000, budget) * 4;
    return cands.sort((a, b) => score(b) - score(a))[0];
  }
  consistFor(p) {
    const g = this.game, S = g.stations;
    const stns = p.stations.map((id) => S.byId(id)).filter(Boolean);
    const tier = Math.min(...this.corridorTiles(p).map((t) => g.net.tier[t]).concat([3]));
    const m = this.chooseLoco(p, tier, Math.max(0, this.r.money - this.reserve() * 0.5));
    if (!m) return null;
    const cargos = p.kind === 'pax' ? ['PASSENGERS', 'MAIL'] : p.kind === 'metro' ? ['PASSENGERS'] : [p.cargo];
    let vs = autoBuild(m.id, cargos, { research: this.r.research(), fx: NO_FX });
    const plat = Math.min(...stns.map((s) => Math.min(...s.tracks.map((tk) => tk.tiles.length))));
    const maxLen = plat * TILE * 1.0;
    while (vs.length > 2 && computeStats(vs, null, NO_FX).length > maxLen) vs = vs.slice(0, -1);
    if (computeStats(vs, null, NO_FX).length > maxLen) return null;
    return vs;
  }
  // the price of the train it would buy now
  trainCost(p) {
    const m = this.chooseLoco(p, 0, Math.max(0, this.r.money - this.reserve()));
    return m ? m.price * this.game.economy.costs.mul() * 1.4 : 1e9;
  }
  addTrain(p) {
    const g = this.game, S = g.stations;
    const dep = S.depotById(p.depot);
    if (!dep) return false;
    const vs = this.consistFor(p);
    if (!vs) { p.cd.train = this.month() + COOLDOWN.train; return false; }
    if (!this.r.canSpend(consistCost(vs, g.economy.costs) + this.reserve() * 0.5)) { p.cd.train = this.month() + 2; return false; }
    const res = this.as(() => g.trains.buy(vs, dep));
    if (res.error) { p.cd.train = this.month() + COOLDOWN.train; this.note('fail', `cannot buy a train: ${res.error}`, { project: p.id }); return false; }
    const t = res.train;
    t.mode = 'manual';
    const [a, b] = p.stations;
    const fr = p.kind === 'freight';
    t.route = [
      { st: a, act: fr ? 'load' : 'auto', dwell: 0, full: false, skip: false, plat: null, cargo: null, minLoad: fr ? 0.5 : 0 },
      { st: b, act: fr ? 'unload' : 'auto', dwell: 0, full: false, skip: false, plat: null, cargo: null },
    ];
    t.routeIdx = 0;
    p.trains.push(t.id);
    p.cd.train = this.month() + COOLDOWN.train;
    return true;
  }

  // ---------- operate: observe, diagnose, improve ----------
  observe(p) {
    const g = this.game, S = g.stations;
    const ts = p.trains.map((id) => g.trains.byId(id)).filter(Boolean);
    p.trains = ts.map((t) => t.id);
    const stns = p.stations.map((id) => S.byId(id)).filter(Boolean);
    const wait = stns.reduce((a, s) => a + (s.stock[p.cargo] || 0), 0);
    const cap = ts.reduce((a, t) => a + (t._st.caps[p.cargo] || 0), 0) || 1;
    const dly = ts.length ? ts.reduce((a, t) => a + (t.dly || 0), 0) / ts.length : 0;
    const earned = ts.reduce((a, t) => a + (t.earned || 0), 0);
    const monthRev = Math.max(0, earned - (p.earned0 || 0));
    p.earned0 = earned;
    p.rev.push(Math.round(monthRev)); if (p.rev.length > 24) p.rev.shift();
    // trains that cannot leave the depot: the line is full, never buy more
    const stuck = ts.filter((t) => t.state === 'spawnwait');
    p.stuck = stuck.length ? (p.stuck || 0) + 1 : 0;
    p.obs = { wait: Math.round(wait), cap, dly: Math.round(dly), trains: ts.length, running: ts.length - stuck.length, trips: ts.reduce((a, t) => a + (t.trips || 0), 0) };
    // one that waits half a year to get out goes back (sold): a wasted purchase is not repeated
    if (p.stuck >= 6 && stuck.length) { const t = stuck[stuck.length - 1]; this.as(() => g.trains.sell(t)); p.trains = p.trains.filter((id) => id !== t.id); p.stuck = 0; p.cd.train = this.month() + 24; this.note('sell', `sells ${t.name}: the line is full`, { project: p.id }); }
    // double track finished (also as pending works): signal it once
    if (p.mode === 'double' && !p.signalled) {
      const tiles = this.corridorTiles(p);
      if (tiles.length && tiles.every((t) => !g.net.single[t] || g.net.special.has(t))) { this.signalLine(p); p.signalled = true; }
    }
  }
  // one answer per project per call, cheapest fitting first
  improve(p) {
    const m = this.month(), o = p.obs;
    if (!o || this.r.money < this.reserve()) return false;
    const cd = (k) => (p.cd[k] || 0) > m;
    const len = p.tiles || 1;
    // no trains running at all (sold, stuck, never bought)
    if (!o.trains && !cd('train')) return this.addTrain(p);
    // opposing trains wait for each other on single track: a passing loop
    const loopsNeeded = Math.max(0, Math.floor(len / 14));
    if (p.mode === 'single' && o.trains >= 2 && o.dly > 25 && !cd('loop') && p.loops < Math.max(1, loopsNeeded)) return this.buildLoop(p);
    // still congested with loops: double track
    if (p.mode === 'single' && o.trains >= 3 && o.dly > 40 && p.loops >= Math.max(1, loopsNeeded) && !cd('double')) return this.doubleTrack(p);
    // loads pile up: a longer train first (longer platform), then another train
    if (o.wait > o.cap * 1.5) {
      const shortest = this.shortestPlatform(p);
      if (shortest < 5 && !cd('platform') && o.trains >= 2) return this.extendPlatforms(p);
      // (as many trains as the line and the platforms can take)
      const plats = Math.min(...p.stations.map((id) => this.game.stations.byId(id)).filter(Boolean).map((s) => s.tracks.length));
      const maxTrains = Math.min(p.mode === 'double' ? Math.ceil(len / 5) : Math.max(2, 1 + p.loops * 2), plats * 2 + 1);
      if (o.trains < maxTrains && o.running === o.trains && !cd('train')) return this.addTrain(p);
      // a busy station: a second platform
      if (!cd('track') && o.trains >= 3) return this.addPlatform(p);
    }
    return false;
  }
  shortestPlatform(p) { const S = this.game.stations; return Math.min(...p.stations.map((id) => S.byId(id)).filter(Boolean).map((s) => Math.min(...s.tracks.map((t) => t.tiles.length)))); }
  // a passing loop: a double-track section in the middle of the single line
  buildLoop(p) {
    const g = this.game, tiles = this.corridorTiles(p);
    p.cd.loop = this.month() + COOLDOWN.loop;
    if (tiles.length < 10) return false;
    const n = p.loops + 1, at = Math.floor((tiles.length * n) / (Math.max(1, Math.floor(tiles.length / 14)) + 1));
    const a = tiles[Math.max(2, at - 2)], b = tiles[Math.min(tiles.length - 3, at + 2)];
    if (g.net.special.has(a) || g.net.special.has(b)) return false;
    const res = this.upgradeTrack(a, b, g.net.tier[a], 'double');
    if (res.error) { this.note('fail', `passing loop failed: ${res.error}`, { project: p.id }); return false; }
    p.loops++;
    this.note('loop', `adds a passing loop on ${this.endName(p.a)} → ${this.endName(p.b)}`, { project: p.id });
    return true;
  }
  doubleTrack(p) {
    const g = this.game, S = g.stations;
    p.cd.double = this.month() + COOLDOWN.double;
    const [A, B] = p.stations.map((id) => S.byId(id));
    if (!A || !B) return false;
    const [ea, eb] = [this.facingEnd(A, B), this.facingEnd(B, A)];
    const res = this.upgradeTrack(ea, eb, g.net.tier[ea], 'double');
    if (res.error) { this.note('fail', `double track failed: ${res.error}`, { project: p.id }); return false; }
    p.mode = 'double';
    this.note('double', `double-tracks ${this.endName(p.a)} → ${this.endName(p.b)}`, { project: p.id });
    this.game.events.emit('rivalProject', this.r, p, 'double');
    return true;
  }
  // automatic block signals on a double-track line, both directions
  signalLine(p) {
    const g = this.game, C = g.construction, S = g.stations, net = g.net;
    const [A, B] = p.stations.map((id) => S.byId(id));
    if (!A || !B) return;
    this.as(() => {
      for (const [a, b] of [[A.tile, B.tile], [B.tile, A.tile]]) {
        const plan = C.planSignalRow(a, b);
        if (!plan || !plan.keys.length) continue;
        const unit = g.economy.costs.signal();
        const n = Math.min(plan.keys.length, Math.floor((this.r.money - this.reserve() * 0.5) / unit));
        if (n <= 0) continue;
        g.economy.spend(n * unit, 'construction', null, 'signals');
        for (const k of plan.keys.slice(0, n)) net.signals.set(k, { type: 'block', oneway: false, y: this.year() });
      }
      net.bumpVersion(); g.trains.onNetworkChanged(false);
    });
  }
  extendPlatforms(p) {
    const S = this.game.stations;
    p.cd.platform = this.month() + COOLDOWN.platform;
    let n = 0;
    this.as(() => { for (const id of p.stations) { const s = S.byId(id); if (!s || s.owner !== this.r.id) continue; for (let k = 0; k < s.tracks.length; k++) for (const end of [1, 0]) { const r = S.extendPlatform(s, k, end); if (r.ok) { n++; break; } } } });
    if (n) { p.plat = this.shortestPlatform(p); this.note('platform', `lengthens the platforms of ${this.endName(p.a)} → ${this.endName(p.b)}`, { project: p.id }); }
    return n > 0;
  }
  addPlatform(p) {
    const S = this.game.stations;
    p.cd.track = this.month() + COOLDOWN.track;
    const busiest = p.stations.map((id) => S.byId(id)).filter((s) => s && s.owner === this.r.id && s.tracks.length < 3).sort((a, b) => (b.stats.arrivals || 0) - (a.stats.arrivals || 0))[0];
    if (!busiest) return false;
    const r = this.as(() => S.addTrack(busiest, 1).ok ? { ok: true } : S.addTrack(busiest, -1));
    if (!r || !r.ok) return false;
    this.note('platform', `adds a platform at ${busiest.name}`, { project: p.id });
    return true;
  }

  // ---------- review / retire / modernize ----------
  review(p) {
    const r12 = p.rev.slice(-12).reduce((a, b) => a + b, 0);
    p.lastYear = r12;
    const age = this.month() - (p.opened || this.month());
    // unprofitable after two years with its trains running: close it cleanly
    const ts = p.trains.map((id) => this.game.trains.byId(id)).filter(Boolean);
    const opYear = ts.reduce((a, t) => a + (t._st.op || 0), 0) * 12 * MONTH_S / 60;
    // (only when its trains really ran: a line without trips is a problem to fix, not to close)
    const trips = ts.reduce((a, t) => a + (t.trips || 0), 0);
    if (age >= 24 && p.rev.length >= 12 && trips >= 12 && r12 < opYear * 0.6 && !((p.cd.retire || 0) > this.month())) { this.retire(p, `loses money (${Math.round(r12)} a year)`); return; }
    p.stage = 'operate';
  }
  // take a failed line down completely: trains sold, stations, depot and
  // track removed (only what no other project of the company uses)
  retire(p, why) {
    const g = this.game, S = g.stations, net = g.net;
    this.as(() => {
      for (const id of p.trains) { const t = g.trains.byId(id); if (t) g.trains.sell(t); }
      const others = this.st.projects.filter((q) => q !== p && (q.stage === 'operate' || q.stage === 'review'));
      const usedIds = new Set(others.flatMap((q) => [...q.stations, q.depot]));
      // everything this line used: its route, its platforms, its depot and spur
      const tiles = new Set(this.corridorTiles(p));
      for (const id of p.stations) { const s = S.byId(id); if (s && !usedIds.has(id)) for (const t of S.allTiles(s)) tiles.add(t); }
      const dep = S.depotById(p.depot);
      if (dep && !usedIds.has(dep.id)) { tiles.add(dep.tile); for (let d = 0; d < 8; d++) { const j = step(dep.tile, d); if (j >= 0) tiles.add(j); } S.removeDepot(dep); }
      for (const id of p.stations) { const s = S.byId(id); if (s && !usedIds.has(id) && s.owner === this.r.id) S.remove(s); }
      const keep = new Set();
      for (const q of others) { for (const t of this.corridorTiles(q)) keep.add(t); for (const id of q.stations) { const s = S.byId(id); if (s) for (const t of S.allTiles(s)) keep.add(t); } }
      for (const t of tiles) if (!keep.has(t) && net.conn[t] && !net.special.has(t) && net.own[t] === this.r.idx) g.construction.removeTrackOp(t);
      // then any dead end of the company's track left over (loops, spurs)
      for (let pass = 0; pass < 40; pass++) {
        let n = 0;
        for (let i = 0; i < net.conn.length; i++) if (net.conn[i] && net.own[i] === this.r.idx && !net.special.has(i) && !keep.has(i) && net.degree(i) <= 1) { if (!g.construction.removeTrackOp(i).error) n++; }
        if (!n) break;
      }
    });
    p.stage = 'retired';
    this.st.projects = this.st.projects.filter((x) => x !== p);
    this.st.history.push({ m: this.month(), id: p.id, a: this.endName(p.a), b: this.endName(p.b), outcome: 'retired', why });
    this.remember(`pair:${p.a.t}:${p.a.id}:${p.b.t}:${p.b.id}`, 120);
    this.note('retire', `closes ${this.endName(p.a)} → ${this.endName(p.b)}: ${why}`, { project: p.id });
    this.game.events.emit('rivalProject', this.r, p, 'close');
  }
  // one old train a year is replaced by a current model (never the whole fleet)
  modernize() {
    if (this.blocked('modern') || this.r.money < this.reserve() * 1.5) return;
    const g = this.game, era = eraOfYear(this.year());
    let worst = null;
    for (const p of this.st.projects) if (p.stage === 'operate') for (const id of p.trains) {
      const t = g.trains.byId(id);
      if (!t) continue;
      const m = locoModel(t.veh.find((v) => v.k === 'L').id);
      const age = (g.time - (t.bought || 0)) / (12 * MONTH_S);
      const gap = era - m.era;
      if ((gap >= 2 || age > 28) && (!worst || gap + age / 20 > worst.sc)) worst = { t, p, sc: gap + age / 20 };
    }
    if (!worst) return;
    // electrify a busy corridor before electric trains can run on it
    if (era >= 4 && worst.p.mode === 'double' && !((worst.p.cd.electrify || 0) > this.month())) this.electrify(worst.p);
    const vs = this.consistFor(worst.p);
    if (!vs) return;
    const oldM = locoModel(worst.t.veh.find((v) => v.k === 'L').id), newM = locoModel(vs[0].id);
    if (newM.id === oldM.id) { this.remember('modern', 12); return; }
    const dep = g.stations.depotById(worst.p.depot);
    if (!dep) return;
    const res = this.as(() => g.trains.buy(vs, dep));
    if (res.error) return;
    const t = res.train, o = worst.t;
    t.mode = 'manual'; t.route = o.route.map((r) => ({ ...r })); t.routeIdx = 0;
    worst.p.trains = worst.p.trains.filter((id) => id !== o.id).concat(t.id);
    this.as(() => g.trains.sell(o));
    this.remember('modern', COOLDOWN.modern);
    this.note('modern', `replaces ${oldM.name} by ${newM.name} on ${this.endName(worst.p.a)} → ${this.endName(worst.p.b)}`, { project: worst.p.id });
  }
  // one station a year is brought up to the day's style once it is two
  // architectural eras behind (Eras.js), when there is money to spare
  renovate() {
    const g = this.game, S = g.stations;
    if (this.blocked('renovate') || this.r.money < this.reserve() * 2) return;
    const now = bandOf(this.year());
    const st = S.list.filter((s) => s.owner === this.r.id && bandOf(S.lookYear(s)) <= now - 2).sort((a, b) => S.lookYear(a) - S.lookYear(b))[0];
    if (!st) return;
    const err = this.as(() => S.renovate(st));
    this.remember('renovate', 12);
    if (!err) this.note('renovate', `renovates ${st.name}`, {});
  }
  electrify(p) {
    const g = this.game, S = g.stations;
    p.cd.electrify = this.month() + COOLDOWN.electrify;
    const [A, B] = p.stations.map((id) => S.byId(id));
    if (!A || !B || g.net.tier[A.tile] >= 2) return;
    const res = this.upgradeTrack(this.facingEnd(A, B), this.facingEnd(B, A), 2, p.mode);
    if (!res.error) this.note('electrify', `electrifies ${this.endName(p.a)} → ${this.endName(p.b)}`, { project: p.id });
  }

  // ---------- anti-spam metrics (tests and the debug view) ----------
  metrics() {
    const g = this.game, net = g.net, S = g.stations, idxR = this.r.idx;
    let owned = 0;
    for (let i = 0; i < N * N; i++) if (net.conn[i] && net.own[i] === idxR) owned++;
    const used = new Set();
    const ops = this.st.projects.filter((p) => p.stage === 'operate' || p.stage === 'review');
    for (const p of ops) { for (const t of this.corridorTiles(p)) used.add(t); for (const id of p.stations) { const s = S.byId(id); if (s) for (const t of S.allTiles(s)) used.add(t); } const d = S.depotById(p.depot); if (d) used.add(d.tile); }
    // (tiles of a passing loop and depot spurs are on no station-to-station route)
    const loopSpare = ops.reduce((a, p) => a + p.loops * 6 + (p.mode === 'double' ? 0 : 0) + 3, 0);
    const unused = Math.max(0, owned - used.size - loopSpare);
    const stations = S.list.filter((s) => s.owner === this.r.id);
    const idle = stations.filter((s) => !(s.stats.arrivals > 0)).length;
    const trains = g.trains.trains.filter((t) => t.owner === this.r.id);
    const unusedVeh = trains.filter((t) => (g.time - (t.bought || 0)) > 12 * MONTH_S && !(t.trips > 0)).length;
    const pairs = ops.map((p) => [p.a.t + p.a.id, p.b.t + p.b.id].sort().join('|'));
    const dup = pairs.length - new Set(pairs).size;
    const units = this.r.paxCarried + this.r.cargoCarried;
    const rebuilds = this.st.history.filter((h) => h.outcome === 'retired').length;
    return { trackTiles: owned, unusedTrack: owned ? unused / owned : 0, stations: stations.length, idleStations: idle, trains: trains.length, unusedVehicles: unusedVeh, duplicateCorridors: dup, trackPerKUnit: units ? (owned / units) * 1000 : null, retired: rebuilds, projects: ops.length };
  }
}

// the direction from a station site away from the other end, along the axis
function awayDir(ax, x, z, other) {
  if (ax === 0) return other.x > x ? 4 : 0;       // east-west: grow west if the other end is east
  return other.z > z ? 6 : 2;                     // north-south
}
export function minTierOf(m) { return m.maglev ? 3 : m.kind === 'electric' || m.kind === 'hst' ? 2 : 0; }
// every research a company of any era could have (wagon validation only;
// the planner picks locos and wagons by era itself)
export const ALL_RESEARCH = new Set(RESEARCH.map((r) => r.id));
void CARGO; void STAGES;
