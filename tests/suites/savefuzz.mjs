// Save fuzzing: mutate real saves (production v2 fixture + a generated v3 save
// with consists, platforms, signals and schedules) and load them. A case passes
// when the game either starts cleanly (then keeps running, stays finite and
// round-trips) or shows the load-failed dialog, never with an uncaught error.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPage, startTestGame, loadSave, productionSave } from '../lib.mjs';

function rng(s) { return () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), s | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function paths(o, pre = [], out = [], depth = 0) {
  if (depth > 6 || o === null || typeof o !== 'object') return out;
  const keys = Array.isArray(o) ? o.map((_, i) => i).slice(0, 12) : Object.keys(o);
  for (const k of keys) { out.push([...pre, k]); paths(o[k], [...pre, k], out, depth + 1); }
  return out;
}
export function mutate(d, r) {
  const ps = paths(d);
  const n = 1 + Math.floor(r() * 3);
  const log = [];
  for (let i = 0; i < n; i++) {
    const p = ps[Math.floor(r() * ps.length)];
    let parent = d; for (const k of p.slice(0, -1)) parent = parent && parent[k];
    if (!parent || typeof parent !== 'object') continue;
    const k = p[p.length - 1], v = parent[k];
    const ops = ['delete', 'null', 'str', 'neg', 'huge', 'zero', 'obj', 'arr', 'bool'];
    if (typeof v === 'string') ops.push('trunc', 'trunc');
    if (Array.isArray(v)) ops.push('drop', 'dup', 'rev', 'empty');
    const op = ops[Math.floor(r() * ops.length)];
    switch (op) {
      case 'delete': if (Array.isArray(parent)) parent.splice(k, 1); else delete parent[k]; break;
      case 'null': parent[k] = null; break;
      case 'str': parent[k] = 'x'; break;
      case 'neg': parent[k] = -7; break;
      case 'huge': parent[k] = 1e15; break;
      case 'zero': parent[k] = 0; break;
      case 'obj': parent[k] = {}; break;
      case 'arr': parent[k] = []; break;
      case 'bool': parent[k] = true; break;
      case 'trunc': parent[k] = v.slice(0, Math.floor(v.length * r())); break;
      case 'drop': if (v.length) v.splice(Math.floor(r() * v.length), 1); break;
      case 'dup': if (v.length) v.push(JSON.parse(JSON.stringify(v[Math.floor(r() * v.length)]))); break;
      case 'rev': v.reverse(); break;
      case 'empty': v.length = 0; break;
    }
    log.push(`${op}:${p.join('.')}`);
  }
  return log;
}

// replay recorded mutations ("op:path.to.key") — used by the failure corpus
export function applyOps(d, ops) {
  for (const o of ops) {
    const i = o.indexOf(':'), op = o.slice(0, i), p = o.slice(i + 1).split('.').map((k) => (/^\d+$/.test(k) ? +k : k));
    let parent = d; for (const k of p.slice(0, -1)) parent = parent && parent[k];
    if (!parent || typeof parent !== 'object') throw new Error('corpus path not found: ' + o);
    const k = p[p.length - 1], v = parent[k];
    const set = { null: null, str: 'x', neg: -7, huge: 1e15, zero: 0, obj: {}, arr: [], bool: true }[op];
    if (op === 'delete') { if (Array.isArray(parent)) parent.splice(k, 1); else delete parent[k]; }
    else if (op === 'drop') v.splice(0, 1);
    else if (op === 'dup') v.push(JSON.parse(JSON.stringify(v[0])));
    else if (op === 'rev') v.reverse();
    else if (op === 'empty') v.length = 0;
    else if (op === 'trunc') parent[k] = v.slice(0, Math.floor(v.length / 2));
    else if (op in { null: 1, str: 1, neg: 1, huge: 1, zero: 1, obj: 1, arr: 1, bool: 1 }) parent[k] = typeof set === 'object' && set ? JSON.parse(JSON.stringify(set)) : set;
    else throw new Error('unknown corpus op ' + op);
  }
}

export const name = 'savefuzz';
export async function run({ browser, base, quick, args }) {
  // --cases=N (default 300, quick 40), --seed=first case, --shard=k/n runs the
  // k-th of n contiguous slices of the case range (same seeds as unsharded),
  // --corpus also replays tests/fuzz-corpus.json (known past failures)
  const total = +(args.cases || (quick ? 40 : 300)), first = +(args.seed || 1);
  let from = 0, to = total;
  if (args.shard) { const [k, n] = String(args.shard).split('/').map(Number); from = Math.floor((total * (k - 1)) / n); to = Math.floor((total * k) / n); }
  const N = to - from, seed0 = first + from;
  const corpus = args.corpus ? JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fuzz-corpus.json'), 'utf8')).savefuzz : [];
  const prod = productionSave();
  const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 900, height: 650 } });
  await startTestGame(page, 5 * 1013);
  const v3 = await page.evaluate(() => { const g = window.__tracklands.game; g.runRailFuzz(5, 2); return JSON.parse(JSON.stringify(g.serialize())); });
  errors.length = 0;
  const lines = [];
  let bad = 0, started = 0, failed = 0;
  // the jobs: corpus entries first (cheap, known bugs), then the random cases
  const jobs = [...corpus.map((e) => ({ corpus: e })), ...Array.from({ length: N }, (_, c) => ({ caseNo: seed0 + c }))];
  for (const job of jobs) {
    let base0, log, label, prodBase;
    if (job.corpus) {
      const e = job.corpus;
      if (e.case != null) { job.caseNo = e.case; }
      else { prodBase = e.base === 'prod'; base0 = JSON.parse(JSON.stringify(prodBase ? prod : v3)); applyOps(base0, e.ops); log = e.ops; label = `corpus "${e.id}"`; }
    }
    if (job.caseNo != null) {
      const caseNo = job.caseNo;
      const r = rng(caseNo * 7919);
      prodBase = (caseNo - 1) % 2 === 1;
      base0 = JSON.parse(JSON.stringify(prodBase ? prod : v3));
      log = mutate(base0, r);
      label = job.corpus ? `corpus "${job.corpus.id}" (case ${caseNo})` : `case ${caseNo}`;
    }
    errors.length = 0;
    let outcome = 'timeout';
    try {
      await loadSave(page, base0, { paused: false });
      outcome = await page.evaluate(() => (window.__tracklands.game ? 'started' : 'loadfail'));
    } catch (e) { /* timeout */ }
    let check = '';
    if (outcome === 'started') {
      started++;
      await page.evaluate(() => { window.__tracklands.game.speed = 4; });
      await page.waitForTimeout(1500);
      check = await page.evaluate(async () => {
        const g = window.__tracklands.game;
        if (!g) return 'game gone';
        const S = await import('./src/save/Save.js');
        const probs = [];
        if (!Number.isFinite(g.economy.coins)) probs.push('coins ' + g.economy.coins);
        for (const t of g.trains.trains) {
          if (!Number.isFinite(t.s) || !Number.isFinite(t.v)) probs.push('train nan ' + t.name);
          if (typeof t.name !== 'string') probs.push('train name ' + typeof t.name);
          if (!Array.isArray(t.veh) || !t.veh.some((v) => v.k === 'L')) probs.push('train veh ' + t.id);
          if (!Array.isArray(t.cargo) || t.cargo.some((l) => !Number.isFinite(l.n))) probs.push('train cargo ' + t.id);
          for (const [k, v] of Object.entries(t.upg || {})) if (typeof v !== 'number' || !(v >= 0 && v <= 5)) probs.push(`train upg ${k}=${JSON.stringify(v)}`);
        }
        const P = g.progression;
        if (!Number.isFinite(P.xp) || !Number.isFinite(P.level)) probs.push('xp/level');
        for (const tw of g.towns.list) if (!Number.isFinite(tw.pop) || !Number.isFinite(tw.stage)) probs.push('town ' + tw.id);
        for (const s of g.stations.list) for (const c2 in s.stock || {}) if (!Number.isFinite(s.stock[c2])) probs.push('stn stock ' + s.id);
        const sids = g.stations.list.map((s) => s.id);
        if (new Set(sids).size !== sids.length || sids.some((i) => !Number.isInteger(i) || i < 0 || i >= 900000)) probs.push('station ids ' + sids.slice(0, 5).join(','));
        for (const ind of g.industries.list) for (const f of ['out', 'inp']) for (const c2 in ind[f] || {}) if (!Number.isFinite(ind[f][c2])) probs.push('ind ' + ind.id);
        let d; try { d = JSON.parse(JSON.stringify(g.serialize())); } catch (e) { probs.push('serialize ' + e.message); }
        if (d) { const m = S.migrate(d); const v = m ? S.validate(m) : 'migrate null'; if (v) probs.push('roundtrip ' + v); }
        return probs.join('; ');
      });
    } else if (outcome === 'loadfail') failed++;
    const hard = errors.filter((e) => !(outcome === 'loadfail' && e.startsWith('CONSOLE Game start failed')));
    if (outcome === 'timeout' || hard.length || check) {
      bad++;
      lines.push(`FAIL ${label} ${prodBase ? 'prod' : 'v3'} save v${(base0 && base0.saveVersion) || '?'} ${outcome} [${log.join(' ')}] ${check} ${hard.slice(0, 2).join(' | ').slice(0, 500)}`);
      lines.push(`     reproduce: ${job.caseNo != null ? `node tests/run.mjs savefuzz --seed=${job.caseNo} --cases=1` : 'node tests/run.mjs savefuzz --cases=0 --corpus'}  (add it to tests/fuzz-corpus.json once fixed)`);
    }
  }
  lines.push(`cases ${N}${args.shard ? ` (shard ${args.shard}: ${seed0}–${seed0 + N - 1})` : ''}${corpus.length ? ` + ${corpus.length} corpus` : ''}: started ${started}, rejected with load-failed dialog ${failed}, bad ${bad}`);
  await ctx.close();
  return { ok: bad === 0, lines };
}
