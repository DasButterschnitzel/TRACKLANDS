// Visual QA gallery: renders every locomotive, every wagon (empty + loaded),
// sample consists and every livery with the game's lighting into PNG sheets
// (tests/output/gallery/*.png) for review. Fails only on render errors/NaN.
import { openPage, startTestGame, ensureOut } from '../lib.mjs';
import path from 'path';
import fs from 'fs';

const sheets = {
  locos: { cols: 5, spacingX: 2.9, spacingZ: 1.9, cam: [0.55, 0.42] },
  wagons: { cols: 6, spacingX: 2.1, spacingZ: 1.5, cam: [0.55, 0.42] },
  consists: { cols: 1, spacingX: 0, spacingZ: 1.6, cam: [0.3, 0.35] },
  liveries: { cols: 4, spacingX: 2.8, spacingZ: 1.7, cam: [0.55, 0.42] },
};

export const name = 'gallery';
export async function run({ browser, base, args = {} }) {
  // --only=locos,stations,towns renders a subset of the sheets
  const only = args.only ? String(args.only).split(',') : null;
  const want = (k) => !only || only.includes(k);
  const dir = path.join(ensureOut(), 'gallery');
  fs.mkdirSync(dir, { recursive: true });
  const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 1600, height: 1000 } });
  await startTestGame(page, 5065);
  const lines = [];
  let ok = true;
  for (const [sheet, cfg] of Object.entries(sheets)) {
    if (!want(sheet)) continue;
    for (const view of ['side', 'three-quarter', 'front']) {
      const res = await page.evaluate(async ([sheet, cfg, view]) => {
        const app = window.__tracklands, g = app.game;
        const THREE = await import('three');
        const TM = await import('./src/trains/TrainModels.js');
        const C = await import('./src/config.js');
        const { MATS } = await import('./src/core/ModelBuilder.js');
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0xdfe8ec);
        scene.add(new THREE.HemisphereLight(0xdfefff, 0x8a7a5a, 1.2));
        const sun = new THREE.DirectionalLight(0xffffff, 2); sun.position.set(6, 10, 7); scene.add(sun);
        const items = [];
        const locos = C.LOCOS.map((m) => m.id);
        const cargoFor = (w) => { const c = C.WAGONS[w].carries; return c.length ? c[(w.length) % c.length] : null; };
        if (sheet === 'locos') for (const id of locos) items.push([{ k: 'L', id, geo: TM.locoGeometry(id, 'classic_green', 1), len: C.locoLen(C.LOCOS.find((m) => m.id === id)) }]);
        if (sheet === 'wagons') for (const w of C.WAGON_IDS) for (const fill of [0, 3]) items.push([{ k: 'W', id: w + (fill ? '+' : ''), geo: TM.wagonGeometry(w, fill ? cargoFor(w) : null, fill, 'diesel', 0x2f5f4a, 0xd9b45a, 0), len: C.WAGONS[w].len }]);
        if (sheet === 'liveries') for (const lv of C.LIVERIES) for (const id of ['atlas', 'voltstream_e1']) items.push([{ k: 'L', id: id + ':' + lv.id, geo: TM.locoGeometry(id, lv.id, 2), len: C.locoLen(C.LOCOS.find((m) => m.id === id)) }]);
        if (sheet === 'consists') {
          const mk = (lid, ws, fill, scope) => { const m = C.LOCOS.find((x) => x.id === lid); const cols = TM.liveryColors(m, scope === 'loco' ? 'classic_green' : 'royal_blue'); return [{ k: 'L', id: lid, geo: TM.locoGeometry(lid, 'royal_blue', 1), len: C.locoLen(m) }, ...ws.map((w, i) => ({ k: 'W', id: w, geo: TM.wagonGeometry(w, fill ? cargoFor(w) : null, fill, m.kind, cols.body, cols.trim, (i * 3) & 3), len: C.WAGONS[w].len }))]; };
          items.push(mk('pioneer', ['coach', 'coach', 'mail_van'], 1, 'train'));
          items.push(mk('atlas', ['hopper', 'coal_hopper', 'ore_hopper', 'timber', 'tank', 'brake_van'], 3, 'train'));
          items.push(mk('cargoking', ['container', 'container', 'flatbed', 'machinery_flat', 'reefer', 'boxcar'], 3, 'train'));
          items.push(mk('falcon', ['coach', 'premium', 'observation', 'coach', 'cab_car'], 1, 'loco'));
          items.push(mk('arrowline_300', ['hs_coach', 'hs_coach', 'hs_coach', 'hs_coach'], 1, 'train'));
          items.push(mk('magna_m3', ['hs_coach', 'hs_coach', 'hs_coach'], 1, 'train'));
        }
        let bad = 0;
        const rows = [];
        items.forEach((vehs, i) => {
          const col = i % cfg.cols, row = Math.floor(i / cfg.cols);
          let x = col * cfg.spacingX;
          // side view: rows stacked vertically so nothing hides behind anything
          const z = view === 'side' ? 0 : row * cfg.spacingZ;
          const yRow = view === 'side' ? -row * 1.25 : 0;
          const total = vehs.reduce((a, v) => a + v.len, 0) + (vehs.length - 1) * 0.12;
          let off = 0;
          // rails + sleepers under each item
          const rl = new THREE.Mesh(new THREE.BoxGeometry(total + 0.6, 0.03, 0.04), new THREE.MeshLambertMaterial({ color: 0x8f959c }));
          for (const rz of [0.22, -0.22]) { const r = rl.clone(); r.position.set(x, yRow - 0.015, z + rz); scene.add(r); }
          for (const v of vehs) {
            const pa = v.geo.attributes.position.array;
            for (let k = 0; k < pa.length; k++) if (!Number.isFinite(pa[k])) { bad++; break; }
            const m = new THREE.Mesh(v.geo, MATS);
            m.position.set(x + total / 2 - off - v.len / 2, yRow, z);
            scene.add(m);
            off += v.len + 0.12;
          }
          rows.push(vehs.map((v) => v.id).join('+'));
        });
        const nrow = Math.ceil(items.length / cfg.cols);
        const w = sheet === 'consists' ? 16 : (cfg.cols - 1) * cfg.spacingX + 3;
        const h = view === 'side' ? (nrow - 1) * 1.25 + 1.6 : (nrow - 1) * cfg.spacingZ + 2;
        const cx = sheet === 'consists' ? 0 : (cfg.cols - 1) * cfg.spacingX / 2, cz = view === 'side' ? 0 : (nrow - 1) * cfg.spacingZ / 2;
        const cy = view === 'side' ? -(nrow - 1) * 1.25 / 2 + 0.3 : 0.3;
        const vh = view === 'side' ? h / 2 + 0.3 : (h / 2 + 0.8) * 0.85;
        const cam = new THREE.OrthographicCamera(-w / 2 - 0.6, w / 2 + 0.6, vh, -vh, 0.1, 200);
        const d = 30;
        if (view === 'side') cam.position.set(cx, cy, cz + d);
        else if (view === 'front') cam.position.set(cx + d, 4, cz + d * 0.35);
        else cam.position.set(cx + d * 0.55, d * 0.55, cz + d * 0.75);
        cam.lookAt(cx, cy, cz);
        const W0 = app.renderer.domElement.width, H0 = app.renderer.domElement.height;
        const aspect = (cam.right - cam.left) / (cam.top - cam.bottom);
        const outW = 1600, outH = Math.round(1600 / aspect);
        g.speed = 0;
        app.renderer.setSize(outW, outH, false);
        app.renderer.render(scene, cam);
        const url = app.renderer.domElement.toDataURL('image/png');
        app.renderer.setSize(W0, H0, false);
        return { url, bad, n: items.length };
      }, [sheet, cfg, view]);
      fs.writeFileSync(path.join(dir, `${sheet}-${view}.png`), Buffer.from(res.url.split(',')[1], 'base64'));
      if (res.bad) ok = false;
      if (view === 'side') lines.push(`${res.bad ? 'FAIL' : 'ok  '} ${sheet}: ${res.n} items${res.bad ? `, ${res.bad} with NaN vertices` : ''}`);
    }
  }
  // stations: every type at several sizes, plus terminals
  for (const view of want('stations') ? ['three-quarter', 'top'] : []) {
    const res = await page.evaluate(async (view) => {
      const app = window.__tracklands, g = app.game;
      const THREE = await import('three');
      const SM = await import('./src/rail/StationModels.js');
      const { ModelBuilder, MATS } = await import('./src/core/ModelBuilder.js');
      const C = await import('./src/config.js');
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x9fbf7a);
      scene.add(new THREE.HemisphereLight(0xdfefff, 0x8a7a5a, 1.2));
      const sun = new THREE.DirectionalLight(0xffffff, 2); sun.position.set(6, 10, 7); scene.add(sun);
      const cases = [
        ['halt', 0, 1, 2], ['village', 1, 1, 3], ['town', 2, 2, 3], ['city', 3, 4, 4], ['central', 4, 6, 5], ['grand', 5, 8, 6],
        ['hs', 3, 4, 6], ['freight', 1, 2, 4], ['yard', 3, 4, 5], ['intermodal', 3, 3, 5], ['town', 2, 3, 3, 1], ['central', 4, 6, 5, 1],
      ];
      let bad = 0, ox = 0, oz = 0, rowH = 0;
      cases.forEach(([kind, level, n, len, terminal], i) => {
        const tracks = [];
        for (let k = 0; k < n; k++) tracks.push({ x0: -len, x1: len, z: -k * 2, y: 0, role: kind === 'freight' || kind === 'yard' || kind === 'intermodal' ? 'freight' : (n > 3 && k === 1 ? 'through' : 'any'), deadEnd: [false, !!terminal] });
        const mb = new ModelBuilder();
        const style = C.STATION_STYLES[i % C.STATION_STYLES.length];
        SM.stationComplexModel(mb, level, style, tracks, kind === 'freight' ? ['timber_yard'] : kind === 'intermodal' ? ['container_crane'] : [], false, { kind, terminal: terminal || 0 });
        const geo = mb.build();
        for (const v of geo.attributes.position.array) if (!Number.isFinite(v)) { bad++; break; }
        const m = new THREE.Mesh(geo, MATS);
        ox = (i % 4) * 18; oz = Math.floor(i / 4) * 22;
        m.position.set(ox + len, 0, oz);
        scene.add(m);
        // rails for every track
        for (const tk of tracks) for (const lane of [0.34, -0.34]) for (const r of [0.22, -0.22]) { const rl = new THREE.Mesh(new THREE.BoxGeometry(len * 2 + 1, 0.03, 0.04), new THREE.MeshLambertMaterial({ color: 0x8f959c })); rl.position.set(ox + len, 0.02, oz + tk.z + lane + r); scene.add(rl); }
      });
      const box = new THREE.Box3().setFromObject(scene);
      const ctr = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
      const W = Math.max(size.x, size.z * 1.5) * 1.1, H = W / 1.5;
      const cam = new THREE.OrthographicCamera(-W / 2, W / 2, H / 2, -H / 2, 0.1, 400);
      const cx = ctr.x, cz = ctr.z;
      if (view === 'top') { cam.position.set(cx, 80, cz + 0.01); cam.lookAt(cx, 0, cz); }
      else { cam.position.set(cx + 40, 45, cz + 60); cam.lookAt(cx, 0, cz); cam.top *= 0.8; cam.bottom *= 0.8; cam.updateProjectionMatrix(); }
      g.speed = 0;
      const W0 = app.renderer.domElement.width, H0 = app.renderer.domElement.height;
      app.renderer.setSize(1800, 1200, false);
      app.renderer.render(scene, cam);
      const url = app.renderer.domElement.toDataURL('image/png');
      app.renderer.setSize(W0, H0, false);
      return { url, bad, n: cases.length };
    }, view);
    fs.writeFileSync(path.join(dir, `stations-${view}.png`), Buffer.from(res.url.split(',')[1], 'base64'));
    if (res.bad) ok = false;
    if (view === 'top') lines.push(`${res.bad ? 'FAIL' : 'ok  '} stations: ${res.n} types/sizes`);
  }
  // towns: one town per growth stage, rendered in the live world
  await page.evaluate(() => { document.querySelector('#hud').style.visibility = 'hidden'; document.querySelector('#labels').style.visibility = 'hidden'; });
  for (let stage = 0; stage <= (want('towns') ? 6 : -1); stage++) {
    await page.evaluate((st) => {
      const g = window.__tracklands.game;
      const t = g.towns.list[st % g.towns.list.length];
      t.stage = st; t.pop = [80, 300, 900, 2500, 7000, 18000, 45000][st];
      g.towns.layout(t, false);
      for (const b of t.buildings) { b.t = 1; g.towns.writeBuilding(b, 1); }
      for (const p of Object.values(g.towns.pools)) p.dirty();
      for (const p of Object.values(g.towns.roofPools)) p.dirty();
      g.world.view.clouds.visible = false;
      const cam = g.camera; cam.focusGoal = null;
      cam.target.x = (t.x + 0.5) * 2; cam.target.z = (t.z + 0.5) * 2;
      cam.zoomGoal = cam.viewSize = 12 + st * 2.4;
      g.env.timeOfDay = 0.4;
      g.speed = 0;
    }, stage);
    await page.waitForTimeout(1600);
    await page.screenshot({ path: path.join(dir, `town-stage${stage}.png`) });
  }
  if (want('towns')) lines.push('ok   towns: stages 0-6');
  // railway structures: an electrified line over a river (bridge + catenary),
  // a line through a mountain (tunnel portals) and a high-speed line
  if (want('rail')) {
    const found = await page.evaluate(() => {
      const g = window.__tracklands.game, C = g.construction, net = g.net, N = 64;
      for (let r = 0; r < 8; r++) g.progression.regions.add(r);
      for (const id of ['reinforced_rail', 'electric_rail', 'high_speed_rail', 'bridge_eng', 'tunnel_eng']) g.progression.research.add(id);
      g.progression.recomputeFx(); g.economy.coins = 1e9;
      const out = {};
      const tryLine = (tier, want, key) => {
        for (const [dx, dz] of [[0, 10], [10, 0], [0, 14], [14, 0], [0, 7], [7, 0]]) for (let x = 4; x < N - 4 - dx && !out[key]; x += 2) for (let z = 4; z < N - 4 - dz && !out[key]; z += 2) {
          const a = z * N + x, b = (z + dz) * N + x + dx;
          if (net.conn[a] || net.conn[b] || g.world.type[a] || g.world.type[b]) continue;
          C.tier = tier; C.trackMode = 'double'; C.drag = { a, b }; C.previewTrack();
          if (C.plan && C.plan.ok && (C.plan[want] || 0) > 0) { C.buildTrack(); out[key] = { x, z, dx: Math.sign(dx), dz: Math.sign(dz) }; }
          C.drag = null; C.clearPreview();
        }
      };
      tryLine(2, 'bridges', 'bridge');
      // tunnel: lay track straight through a mountain ridge (the planner would go round it)
      for (const [ddx, ddz] of [[1, 0], [0, 1]]) for (let z = 1; z < N - 2 && !out.tunnel; z++) for (let x = 1; x < N - 2 && !out.tunnel; x++) {
        const at = (k) => { const xx = x + ddx * k, zz = z + ddz * k; return xx >= 0 && zz >= 0 && xx < N && zz < N ? zz * N + xx : -1; };
        const T = (k) => (at(k) < 0 ? -1 : g.world.type[at(k)]);
        if (T(0) !== 0 || T(1) !== 0 || T(2) !== 2) continue;
        let e = 2; while (T(e) === 2) e++;
        if (e - 2 < 2 || T(e) !== 0 || T(e + 1) !== 0) continue;
        if ([...Array(e + 2).keys()].some((k) => net.conn[at(k)])) continue;
        const dir = ddx ? 0 : 2;
        for (let k = 0; k <= e; k++) { net.connect(at(k), dir); net.tier[at(k)] = 1; }
        net.tier[at(e + 1)] = 1; net.bumpVersion();
        out.tunnel = { x: x + ddx, z: z + ddz, dx: ddx, dz: ddz };
      }
      for (let x = 6; x < N - 20 && !out.hs; x += 4) for (let z = 6; z < N - 6 && !out.hs; z += 4) {
        const a = z * N + x, b = z * N + x + 12;
        if (net.conn[a] || net.conn[b]) continue;
        C.tier = 3; C.drag = { a, b }; C.previewTrack();
        if (C.plan && C.plan.ok && !C.plan.bridges && !C.plan.tunnels) { C.buildTrack(); out.hs = { x: x + 6, z }; }
        C.drag = null; C.clearPreview();
      }
      g.railView.markAll();
      return out;
    });
    const shots = [['bridge', 'rail-bridge', 7], ['tunnel', 'rail-tunnel', 7], ['hs', 'rail-highspeed', 8]];
    for (const [k, file, zoom] of shots) {
      const at = found[k];
      if (!at) { lines.push(`FAIL rail: no ${k} site found`); ok = false; continue; }
      await page.evaluate(([at, zoom, k]) => {
        const g = window.__tracklands.game, cam = g.camera, N = 64;
        let x = at.x, z = at.z;
        // centre on the structure itself
        if (k !== 'hs') for (let d = 0; d <= 14; d++) { const xx = at.x + d * (at.dx || 0), zz = at.z + d * (at.dz || 0); const i = zz * N + xx; const kd = g.net.kind(i); if (kd && g.net.conn[i]) { x = xx; z = zz; break; } }
        cam.focusGoal = null; cam.target.x = (x + 0.5) * 2; cam.target.z = (z + 0.5) * 2; cam.zoomGoal = cam.viewSize = zoom;
        g.world.view.clouds.visible = false; g.env.timeOfDay = 0.42; g.speed = 0;
      }, [at, zoom, k]);
      await page.waitForTimeout(1500);
      await page.screenshot({ path: path.join(dir, `${file}.png`) });
    }
    lines.push(`ok   rail structures: ${Object.keys(found).join(', ')}`);
  }
  if (errors.length) { ok = false; lines.push('errors: ' + errors.slice(0, 3).join(' | ')); }
  lines.push(`sheets: ${path.relative(process.cwd(), dir)}`);
  await ctx.close();
  return { ok, lines };
}
