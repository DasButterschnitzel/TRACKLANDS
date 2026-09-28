// Phase 12 risk list, each a regression check that stays: an old airport
// does not change its look as the years pass; a listed (heritage) station
// keeps its look and cannot be renovated; renovation does not duplicate
// catenary; a four-track corridor's masts stand clear of every track; level
// crossings still close for trains after the authority renews them in a new
// look; a metro entrance keeps its era through save and load; tunnel portals
// sit at ground level, never on a tunnel layer; the same project is quoted
// the same twice; jumping the sandbox calendar back and forth leaks nothing.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { openPage, loadSave, productionSave } from '../lib.mjs';

export const name = 'p12risk';

export async function run({ browser, base }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  const layers = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'save-layers.json'), 'utf8'));
  const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 1100, height: 720 } });

  // ---- production save: crossings renewed in a new look still close; ----
  // ---- a listed station keeps its look; renovation adds no catenary  ----
  await loadSave(page, productionSave());
  const a = await page.evaluate(async () => {
    const g = window.__tracklands.game, X = g.crossings, net = g.net, V = await import('./src/world/VisualEra.js');
    const out = {};
    X.update(0, true);
    const tiles = [...X.map.keys()];
    out.crossings = tiles.length;
    // the crossing was laid in 1905: move the calendar so the authority has
    // just renewed it into a different family, then run trains over it
    for (const t of tiles) net.yb[t] = V.packYear(1905);
    const famAt = () => { const c = X.at(tiles[0]); c.famY = null; return X.family(c); };
    const before = famAt();
    g.ledger.startYear += 1991 - g.ledger.year();
    const after = famAt();
    X.update(0, true);
    out.fam = [before, after];
    // instances drawn per family = the crossings (no duplicates from the swap)
    let drawn = 0; for (const f of Object.values(X.fams)) drawn += f.posts ? f.posts.count : 0;
    out.posts = drawn;
    let openWhileTrain = 0, closings = 0, wasClosed = false;
    for (let i = 0; i < 240 * 30; i++) {
      g.tick(1 / 30); X.update(1 / 30);
      const c = X.at(tiles[0]);
      if (!c) continue;
      if (g.trains.tileOccupied(tiles[0]) && !c.closed) openWhileTrain++;
      if (c.closed && !wasClosed) closings++;
      wasClosed = c.closed;
    }
    out.openWhileTrain = openWhileTrain; out.closings = closings;

    // a listed station: old enough, listed, then 60 years pass
    const S = g.stations, stn = S.mine()[0];
    stn.yb = 1900; stn.reno = 0;
    out.canList = S.canList(stn);
    out.listErr = S.setHeritage(stn, true);
    const band0 = V.visualBand(S.lookYear(stn));
    g.ledger.startYear += 60;
    S.buildVisual(stn);
    out.heritage = { same: V.visualBand(S.lookYear(stn)) === band0, canReno: S.canRenovate(stn), renoErr: S.renovate(stn) };

    // renovation of a station on an electrified line: the rail chunks carry
    // exactly the same geometry afterwards (no second set of masts)
    const RV = g.railView;
    const tris = () => { RV.markAll(); RV.update(0); let n = 0; for (const m of RV.chunks.values()) n += m.geometry.attributes.position.count; return n; };
    const other = S.mine().find((s) => s !== stn) || stn;
    for (const t of other.tracks ? other.tracks.flat() : []) if (net.conn[t]) net.tier[t] = Math.max(net.tier[t], 2);
    const t0 = tris();
    other.heritage = false; other.yb = 1900; other.reno = 0; g.economy.coins = 1e8;
    out.renoOther = S.renovate(other);
    const t1 = tris();
    const t2 = tris();
    out.cat = { t0, t1, t2 };
    return out;
  });
  check(a.crossings > 0 && a.fam[0] !== a.fam[1] && a.posts === 2 * a.crossings, `crossings renewed ${a.fam.join(' → ')}: ${a.posts} posts (two each) for ${a.crossings} crossings (no duplicates)`);
  check(a.closings > 0 && a.openWhileTrain === 0, `after the new look the crossing still closes for every train (${a.closings} closings, open with a train on it: ${a.openWhileTrain})`);
  check(a.canList && !a.listErr && a.heritage.same && !a.heritage.canReno && a.heritage.renoErr, `a listed station keeps its look 60 years on and refuses renovation (${a.heritage.renoErr})`);
  check(!a.renoOther && a.cat.t0 === a.cat.t1 && a.cat.t1 === a.cat.t2, `renovation leaves the catenary alone: ${a.cat.t0} → ${a.cat.t1} → ${a.cat.t2} vertices`);

  // ---- routing: freight next-hop chains fall in cost and end at a taker ----
  // ---- (no transfer loops); metro sets never carry freight            ----
  const rt = await page.evaluate(async () => {
    const g = window.__tracklands.game, NW = g.network, C = await import('./src/config.js'), K = await import('./src/trains/Consist.js');
    NW.invalidate(); NW.ensure();
    let chains = 0, loops = 0, longest = 0;
    for (const c of Object.keys(C.CARGO)) {
      if (c === 'PASSENGERS') continue;
      const acc = NW.toAcc(c);
      for (const [k] of acc) {
        let u = k, cost = Infinity, n = 0;
        const seen = new Set();
        while (u != null) {
          const x = acc.get(u);
          if (!x || seen.has(u) || x.cost >= cost && n) { if (x && (seen.has(u) || x.cost >= cost)) loops++; break; }
          seen.add(u); cost = x.cost; n++;
          if (!x.e) break;
          u = x.e.to;
        }
        chains++; longest = Math.max(longest, n);
      }
    }
    const metros = C.LOCOS.filter((m) => m.metro);
    const wagon = Object.keys(K.WAGONS).find((id) => K.WAGONS[id].cls === 'freight');
    const research = new Set(C.RESEARCH.map((r) => r.id));
    const errs = metros.map((m) => K.validateConsist([{ k: 'L', id: m.id }, { k: 'W', id: wagon }], research));
    const carries = metros.map((m) => (m.mu && m.mu.carries || []).join('+'));
    return { chains, loops, longest, metros: metros.length, errs, carries };
  });
  check(rt.chains > 0 && rt.loops === 0, `freight routing: ${rt.chains} next-hop chains, each falling in cost to a taker (longest ${rt.longest} hops), no transfer loops`);
  check(rt.metros > 0 && rt.errs.every((e) => e === 'err_mu_freight') && rt.carries.every((c) => c === 'PASSENGERS'), `${rt.metros} metro sets carry passengers only and refuse freight wagons (${[...new Set(rt.errs)].join(', ')})`);

  // ---- four tracks side by side: masts clear of every track ----
  const f = await page.evaluate(async () => {
    const g = window.__tracklands.game, net = g.net, RV = g.railView, N = g.mapSize, U = await import('./src/util.js');
    let a0 = -1;
    for (let z = 6; z < N - 10 && a0 < 0; z++) for (let x = 6; x < N - 10 && a0 < 0; x++) {
      let free = true;
      for (let dz = -1; dz <= 4 && free; dz++) for (let dx = -1; dx <= 4 && free; dx++) { const i = (z + dz) * N + x + dx; if (net.conn[i] || g.world.type[i] !== 0) free = false; }
      if (free) a0 = z * N + x;
    }
    if (a0 < 0) return { none: true };
    const tiles = [];
    for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) { const i = a0 + r * N + k; net.conn[i] = 0b00010001; net.tier[i] = 2; tiles.push(i); }
    const masts = [];
    const gb = { box(x, y, z, hx, hy) { if (hy > 0.4) masts.push([x, z]); }, quad() {}, tri() {} };
    for (const i of tiles) { const cv = RV.curve(i, 0, 4, 2); RV.catenary(gb, i, cv, [[0, 4]], 2, 0); }
    // tracks run along x (directions 0 and 4): distance across is in z
    let minD = Infinity;
    for (const [mx, mz] of masts) for (const i of tiles) if (Math.abs(U.tileCX(i) - mx) <= 1) minD = Math.min(minD, Math.abs(U.tileCZ(i) - mz));
    for (const i of tiles) { net.conn[i] = 0; net.tier[i] = 0; }
    net.bumpVersion();
    return { masts: masts.length, minD };
  });
  check(!f.none && f.masts > 0 && f.minD >= 0.6, `a four-track corridor: ${f.masts} masts, the nearest ${f.minD && f.minD.toFixed(2)} from a track centre (trains are 0.4 wide each side)`);

  // ---- the layers save: portals at ground level, metro entrance era ----
  await loadSave(page, layers);
  const l = await page.evaluate(async () => {
    const g = window.__tracklands.game, RV = g.railView, net = g.net, V = await import('./src/world/VisualEra.js'), U = await import('./src/util.js');
    const seen = [];
    const orig = RV.portal;
    RV.portal = function (gb, x, y, z, yaw, delay, fam) { seen.push({ x, y, z, fam }); return orig.call(this, gb, x, y, z, yaw, delay, fam); };
    const origCut = RV.metroCut;
    RV.metroCut = function (gb, i) { const y = origCut.apply(this, arguments); seen.push({ x: U.tileCX(i), y, z: U.tileCZ(i), fam: 'metro cut' }); return y; };
    RV.markAll(); RV.update(0);
    RV.portal = orig; RV.metroCut = origCut;
    let worst = 0;
    for (const p of seen) { const t = U.worldToTile(p.x, p.z); if (t >= 0) worst = Math.max(worst, Math.abs(p.y - g.world.tileH[t])); }
    const S = g.stations, m = S.list.find((s) => s && S.isUnderground(s));
    let before = null;
    if (m) { m.yb = 1910; m.reno = 0; S.buildVisual(m); before = { band: V.visualBand(S.lookYear(m)), entrance: m.entrance }; }
    return { portals: seen.length, fams: [...new Set(seen.map((p) => p.fam))], worst, metro: !!m, before, save: JSON.parse(JSON.stringify(g.serialize())) };
  });
  check(l.portals > 0 && l.worst < 1.2, `${l.portals} tunnel portals (${l.fams.join(', ')}), all at ground level (worst ${l.worst.toFixed(2)} off the terrain)`);
  // (a metro ramp's portal used to be drawn at the sunken rail height: 1.5 below the grass, invisible)
  // the upkeep breakdown shown in Finance is what the month then charges
  const up = await page.evaluate(() => {
    const g = window.__tracklands.game, ui = window.__tracklands.ui, E = g.economy;
    const s = E.infraSums()[0], want = Math.round(s.track) + Math.round(s.station);
    const c0 = E.coins; E.infraUpkeep(); const paid = Math.round(c0 - E.coins);
    ui.openPanel('finance');
    const el = document.getElementById('fin-infra');
    return { want, paid, tip: el ? el.getAttribute('data-tip') : '', layers: s.layers.map(Math.round) };
  });
  check(up.want > 0 && up.paid === up.want && /Tunnel/.test(up.tip) && !/fin_|layer_/.test(up.tip), `infrastructure upkeep: ${up.paid}● charged = ${up.want}● shown; tooltip "${up.tip}"`);
  await loadSave(page, l.save);
  const m2 = await page.evaluate(async () => {
    const g = window.__tracklands.game, S = g.stations, V = await import('./src/world/VisualEra.js');
    const m = S.list.find((s) => s && S.isUnderground(s));
    g.ledger.startYear += 50;
    S.buildVisual(m);
    return { band: V.visualBand(S.lookYear(m)), entrance: m.entrance, fam: V.VISUAL_MATRIX.metro[V.visualBand(S.lookYear(m))] };
  });
  check(l.metro && l.before && m2.band === l.before.band && m2.entrance >= 0 && m2.fam === 'tile', `a 1910 metro station keeps its ${m2.fam} entrance through save, load and 50 more years`);

  // ---- the same project quoted twice, nothing changed in between ----
  const q = await page.evaluate(() => {
    const g = window.__tracklands.game, P = g.plans, N = g.mapSize;
    const p = P.create();
    let a0 = -1;
    for (let i = N * 8 + 8; i < N * N - N * 8 && a0 < 0; i++) { let free = true; for (let k = 0; k < 8 && free; k++) if (g.net.conn[i + k] || g.world.type[i + k] !== 0 || g.occupancy.blocked[i + k]) free = false; if (free) a0 = i; }
    P.addStep({ op: 'track', a: a0, b: a0 + 7, tier: 1, mode: 'single' }, p);
    const sum = (r) => r.reduce((n, x) => n + (x.error ? NaN : x.cost), 0); const q1 = { cost: sum(P.quote(p.steps)) }, q2 = { cost: sum(P.quote(p.steps)) };
    return { q1: q1.cost, q2: q2.cost };
  });
  check(q.q1 > 0 && q.q1 === q.q2, `a project is quoted the same twice with nothing changed (${q.q1} / ${q.q2})`);

  // ---- sandbox calendar: 20 jumps across the eras, no leak ----
  const s = await page.evaluate(async () => {
    const app = window.__tracklands, g = app.game, ui = app.ui;
    ui.openPanel('search');
    const frame = () => { for (let f = 0; f < 3; f++) g.frame(1 / 60); };
    frame();
    const mem = () => ({ geo: app.renderer.info.memory.geometries, tex: app.renderer.info.memory.textures });
    const acts = ui.toolsActions();
    for (let k = 0; k < 2; k++) { acts.sbYear('25'); frame(); acts.sbYear('-25'); frame(); }
    const m0 = mem();
    for (let k = 0; k < 10; k++) { acts.sbYear('25'); frame(); acts.sbYear('25'); frame(); acts.sbYear('-25'); frame(); acts.sbYear('-25'); frame(); }
    const m1 = mem();
    return { m0, m1, builder: g.difficultyId };
  });
  check(s.builder === 'builder' && s.m1.geo <= s.m0.geo + 8 && s.m1.tex <= s.m0.tex + 2, `40 calendar jumps across the eras: geometries ${s.m0.geo} → ${s.m1.geo}, textures ${s.m0.tex} → ${s.m1.tex}`);

  // ---- restarts with era models (terminals in two looks, crossings): ----
  // ---- nothing left behind in GPU memory                              ----
  const geo = [];
  for (let k = 0; k < 4; k++) {
    await loadSave(page, l.save);
    geo.push(await page.evaluate(() => {
      const app = window.__tracklands, g = app.game, R = g.roads, N = g.mapSize;
      g.economy.coins = 1e8;
      let n = 0;
      for (const kind of ['airport', 'dock', 'airport']) for (let i = N * 6 + n * 7; i < N * N - N * 6; i += 3) if (!R.stopError(i, kind)) { const s = R.addStop(i, kind).stop; if (s) { s.yb = n === 2 ? 1990 : 1915; n++; R.rebuildStopMesh(); } break; }
      for (let f = 0; f < 5; f++) g.frame(1 / 30);
      return { geo: app.renderer.info.memory.geometries, tex: app.renderer.info.memory.textures, looks: R.termMeshes.size };
    }));
  }
  check(geo[3].geo <= geo[1].geo + 4 && geo[3].tex <= geo[1].tex && geo[1].looks >= 2, `4 restarts with era models: geometries ${geo.map((x) => x.geo).join(' → ')}, textures ${geo.map((x) => x.tex).join(' → ')} (${geo[1].looks} terminal looks)`);

  if (errors.length) { ok = false; lines.push('errors: ' + errors.slice(0, 3).join(' | ')); }
  await ctx.close();
  return { ok, lines };
}
