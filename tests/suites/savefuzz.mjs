// Save fuzzing: mutate real saves (production v2 fixture + a generated v3 save
// with consists, platforms, signals and schedules) and load them. A case passes
// when the game either starts cleanly (then keeps running, stays finite and
// round-trips) or shows the load-failed dialog, never with an uncaught error.
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

export const name = 'savefuzz';
export async function run({ browser, base, quick, args }) {
  const N = +(args.cases || (quick ? 40 : 300)), seed0 = +(args.seed || 1);
  const prod = productionSave();
  const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 900, height: 650 } });
  await startTestGame(page, 5 * 1013);
  const v3 = await page.evaluate(() => { const g = window.__tracklands.game; g.runRailFuzz(5, 2); return JSON.parse(JSON.stringify(g.serialize())); });
  errors.length = 0;
  const lines = [];
  let bad = 0, started = 0, failed = 0;
  for (let c = 0; c < N; c++) {
    const r = rng((seed0 + c) * 7919);
    const base0 = JSON.parse(JSON.stringify(c % 2 ? prod : v3));
    const log = mutate(base0, r);
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
        }
        const P = g.progression;
        if (!Number.isFinite(P.xp) || !Number.isFinite(P.level)) probs.push('xp/level');
        for (const tw of g.towns.list) if (!Number.isFinite(tw.pop) || !Number.isFinite(tw.stage)) probs.push('town ' + tw.id);
        for (const s of g.stations.list) for (const c2 in s.stock || {}) if (!Number.isFinite(s.stock[c2])) probs.push('stn stock ' + s.id);
        for (const ind of g.industries.list) for (const f of ['out', 'inp']) for (const c2 in ind[f] || {}) if (!Number.isFinite(ind[f][c2])) probs.push('ind ' + ind.id);
        let d; try { d = JSON.parse(JSON.stringify(g.serialize())); } catch (e) { probs.push('serialize ' + e.message); }
        if (d) { const m = S.migrate(d); const v = m ? S.validate(m) : 'migrate null'; if (v) probs.push('roundtrip ' + v); }
        return probs.join('; ');
      });
    } else if (outcome === 'loadfail') failed++;
    const hard = errors.filter((e) => !(outcome === 'loadfail' && e.startsWith('CONSOLE Game start failed')));
    if (outcome === 'timeout' || hard.length || check) { bad++; lines.push(`FAIL case ${seed0 + c} ${c % 2 ? 'prod' : 'v3'} ${outcome} [${log.join(' ')}] ${check} ${hard.slice(0, 2).join(' | ').slice(0, 500)}`); }
  }
  lines.push(`cases ${N}: started ${started}, rejected with load-failed dialog ${failed}, bad ${bad}`);
  await ctx.close();
  return { ok: bad === 0, lines };
}
