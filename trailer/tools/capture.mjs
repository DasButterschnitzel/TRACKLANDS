// Trailer capture (development only; nothing here ships with the game).
//
// Renders one scene of trailer/scenes.json from the real game, frame by frame:
// the game is loaded from a showcase save, its own requestAnimationFrame loop
// is stopped, and every frame advances the game by exactly 1/fps seconds
// (simulation, vehicles, towns, weather, sound) before it is drawn and saved.
// The browser may take a second per frame; the clip still plays at the
// game's real speed. Camera moves are scripted paths with easing.
//
// The game's own sound engine runs in lockstep: its AudioContext is an
// OfflineAudioContext whose clock is the frame clock, so every chuff,
// whistle, crossing bell and ambience loop the game schedules lands on the
// frame it belongs to. The rendered sound is written next to the clip.
//
//   node trailer/tools/capture.mjs <scene-id> [--lang=en|de] [--fps=60]
//        [--frames=N] (test: stop early) [--still] (one PNG of the first frame)
//
// Output: trailer/captures/<scene>-<lang>.mp4 (+ .wav). Frames are written
// to a temporary folder and removed after encoding.
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { execFileSync } from 'child_process';
import { startServer, launchBrowser, ROOT } from '../../tests/lib.mjs';
import { evalCamera } from './camera.mjs';

const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; }));
const id = process.argv.slice(2).find((a) => !a.startsWith('--'));
const TR = path.join(ROOT, 'trailer');
const manifest = JSON.parse(fs.readFileSync(path.join(TR, 'scenes.json'), 'utf8'));
const scene = manifest.scenes.find((s) => s.id === id);
if (!scene) { console.error('unknown scene', id, '— known:', manifest.scenes.map((s) => s.id).join(' ')); process.exit(2); }
const lang = args.lang || 'en';
const fps = +(args.fps || manifest.fps || 60);
const W = manifest.width || 1920, H = manifest.height || 1080;
const total = Math.round(scene.duration * fps);
const nFrames = args.still ? 1 : Math.min(total, +(args.frames || total));
// --probe: the same run without drawing; logs vehicles once a second (for timing shots)
const probe = !!args.probe;
const outDir = path.join(TR, 'captures');
const frameDir = path.join(process.env.TRAILER_TMP || '/tmp/trailer-frames', `${id}-${lang}`);
fs.mkdirSync(outDir, { recursive: true });
fs.rmSync(frameDir, { recursive: true, force: true });
fs.mkdirSync(frameDir, { recursive: true });

function readSave(file) {
  const p = path.join(TR, 'saves', file);
  const raw = fs.readFileSync(p);
  return JSON.parse((p.endsWith('.gz') ? zlib.gunzipSync(raw) : raw).toString('utf8'));
}

const { server, url } = await startServer();
const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
// player settings for the capture: the highest stable graphics profile, the
// chosen interface language, no tutorial or tips, no camera shake
await ctx.addInitScript(([lg, seed]) => {
  localStorage.setItem('tracklands.settings', JSON.stringify({
    graphics: 'high', shadows: 'high', particles: 'high', lang: lg, tutorial: false, tips: false,
    screenShake: false, reducedMotion: false, perfHud: false, nowPlaying: false, labels: true,
    volMaster: 0.9, volSfx: 0.85, volAmb: 0.7, volMusic: 0, music: false,
  }));
  // reproducible: the same scene gives the same frames and the same sound
  let s = seed >>> 0;
  Math.random = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}, [lang === 'none' ? 'en' : lang, scene.seed || 1234]);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
page.on('dialog', (d) => d.dismiss().catch(() => {}));
await page.goto(url + '/index.html');
await page.waitForFunction(() => window.__tracklands && window.__tracklands.renderer, null, { timeout: 90000 });

// load the showcase save (a throwaway session: nothing is written back)
const save = readSave(scene.save);
await page.evaluate((s) => {
  const app = window.__tracklands;
  document.querySelectorAll('.modal-wrap').forEach((m) => m.remove());
  if (app.game) { app.ui.detach(); app.game.dispose(); app.game = null; }
  app.startGame({ save: s, test: true, paused: false });
}, save);
await page.waitForFunction(() => window.__tracklands.game && window.__tracklands.game.running, null, { timeout: 120000 });

// take over the frame loop, set the scene's light and weather, start the
// offline sound engine on the frame clock
const dur = nFrames / fps;
await page.evaluate(async ([sc, dur]) => {
  const app = window.__tracklands, g = app.game;
  document.querySelectorAll('.modal-wrap, .toast, #toasts > *').forEach((m) => m.remove());
  g.tutorial.skip && g.tutorial.skip();
  g._frame = g.frame.bind(g);
  g.frame = () => {};
  g.setSpeed(sc.speed ?? 1);
  g.news.mute = true;
  const env = g.env;
  window.__holdEnv = () => {
    if (sc.timeOfDay != null && !sc.timeRuns) env.timeOfDay = sc.timeOfDay;
    if (sc.weather) { env.weather = env.weatherTarget = sc.weather; env.nextWeather = 1e9; }
    if (sc.snowCover != null) env.snowCover = sc.snowCover;
  };
  if (sc.timeOfDay != null) env.timeOfDay = sc.timeOfDay;
  window.__holdEnv();
  if (sc.weather) {
    // start in the weather, not fading into it
    const st = sc.weather;
    env.cloudiness = st === 'clear' ? 0.2 : st === 'cloudy' ? 0.65 : 0.85;
    env.rain = st === 'rain' ? 0.7 : st === 'storm' ? 1 : 0; env.snow = st === 'snow' ? 1 : 0; env.fog = st === 'fog' ? 1 : st === 'snow' ? 0.35 : 0;
  }
  // the game's sound engine on an offline context whose clock is the frame clock
  const sr = 48000;
  const oc = new OfflineAudioContext(2, Math.ceil(sr * (dur + 1.5)), sr);
  window.__vt = 0;
  const proxy = new Proxy(oc, {
    get(t, k) {
      if (k === 'currentTime') return window.__vt;
      if (k === 'state') return 'running';
      if (k === 'resume' || k === 'suspend') return () => Promise.resolve();
      const v = t[k];
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
  const A = app.audio;
  const RealAC = window.AudioContext;
  window.AudioContext = function () { return proxy; };
  A.ctx = null; A.ready = false;
  A.unlock();
  window.AudioContext = RealAC;
  window.__oc = oc;
  // interface state for the shot
  document.body.classList.toggle('photo-mode', sc.ui === 'clean' || sc.ui === 'labels');
  document.body.classList.toggle('photo-nolabels', sc.ui === 'clean');
  // trailer captures never show the performance overlay or developer panels
  g.settings.perfHud = false;
  if (!sc.toasts) { const st = document.createElement('style'); st.textContent = '#toasts, .toast { display: none !important; }'; document.head.appendChild(st); }
  window.__trailerSetup = sc.setup ? new Function('g', 'app', sc.setup) : null;
  if (window.__trailerSetup) await window.__trailerSetup(g, app);
}, [scene, dur]);

// warm up: the world runs (not drawn) so trains are moving when the clip starts
if (scene.warmup) {
  await page.evaluate((secs) => {
    const g = window.__tracklands.game, r = window.__tracklands.renderer, render = r.render;
    r.render = () => {};
    const n = Math.round(secs * 30);
    for (let k = 0; k < n; k++) { window.__holdEnv(); g._frame(1 / 30); }
    r.render = render;
  }, scene.warmup);
  // (the warm-up sound is not part of the clip: start the clip's sound fresh)
  await page.evaluate(() => { window.__vt = 0; });
}

const actions = (scene.actions || []).slice().sort((a, b) => a.t - b.t);
let ai = 0;
const t0 = Date.now();
for (let f = 0; f < nFrames; f++) {
  const t = f / fps;
  const cam = evalCamera(scene.camera, t, scene.duration);
  const due = [];
  while (ai < actions.length && actions[ai].t <= t + 1e-6) {
    const a = actions[ai++];
    if (a.js) due.push(a.js);
    // real input: the mouse on a tile (projected to the screen) or a key
    if (a.mouse) {
      const [px, py] = await page.evaluate(([x, z, L]) => {
        const g = window.__tracklands.game, THREE = g.camera.camera.constructor;
        void THREE;
        const wx = (x + 0.5) * 2, wz = (z + 0.5) * 2, wy = L ? 0 : g.world.view.heightAt(wx, wz);
        const v = g.camera.camera.position.clone().set(wx, wy, wz).project(g.camera.camera);
        return [Math.round((v.x + 1) / 2 * innerWidth), Math.round((1 - v.y) / 2 * innerHeight)];
      }, [a.tile[0], a.tile[1], a.layer || 0]);
      if (a.mouse === 'move') await page.mouse.move(px, py, { steps: 1 });
      else if (a.mouse === 'down') { await page.mouse.move(px, py); await page.mouse.down(); }
      else if (a.mouse === 'up') { await page.mouse.move(px, py); await page.mouse.up(); }
      else if (a.mouse === 'click') await page.mouse.click(px, py);
    }
    if (a.key) await page.keyboard.press(a.key);
    if (a.click) await page.click(a.click);
  }
  await page.evaluate(async ([cam, due, t, dt]) => {
    const app = window.__tracklands, g = app.game, C = g.camera;
    for (const js of due) await new Function('g', 'app', 'ui', js)(g, app, g.ui);
    window.__holdEnv();
    // camera: a follow target is the vehicle's position plus the path's offset
    let x = Number.isFinite(cam.x) ? cam.x : C.target.x, z = Number.isFinite(cam.z) ? cam.z : C.target.z;
    if (cam.follow) {
      let p = null;
      if (cam.follow.train != null) {
        const tr = g.trains.byId(cam.follow.train);
        p = tr && tr.visual ? tr.visual.cars[Math.min(cam.follow.car || 0, tr.visual.cars.length - 1)].mesh.position : null;
      } else if (cam.follow.veh != null) {
        const v = g.roads.vehicles.find((x) => x.id === cam.follow.veh);
        p = v ? g.roads.vehPos(v, {}) : null;
      }
      if (!p) throw new Error('follow: nothing to follow ' + JSON.stringify(cam.follow));
      {
        // a soft follow (critically damped) so the camera never jerks
        const k = window.__fx == null ? 1 : 1 - Math.exp(-dt * (cam.follow.stiff || 3));
        window.__fx = window.__fx == null ? p.x : window.__fx + (p.x - window.__fx) * k;
        window.__fz = window.__fz == null ? p.z : window.__fz + (p.z - window.__fz) * k;
        x = window.__fx + (cam.follow.dx || 0); z = window.__fz + (cam.follow.dz || 0);
      }
    }
    C.focusGoal = null; C.vel.set(0, 0);
    C.target.set(x, 0, z);
    C.viewSize = C.zoomGoal = cam.zoom;
    C.azimuth = C.azGoal = cam.az;
    C.elev = cam.elev;
    window.__vt = t;
    g._frame(dt);
  }, [cam, due, t, 1 / fps]);
  if (probe) {
    if (f === 0) await page.evaluate(() => { const r = window.__tracklands.renderer; r.render = () => {}; });
    if (f % fps === 0) console.log(await page.evaluate(([t, ids, args2]) => {
      const g = window.__tracklands.game;
      const tr = g.trains.trains.filter((x) => !ids.length || ids.includes(x.id)).map((x) => { const p = x.visual && x.visual.cars[0].mesh.position; return `${x.id}:${x.name.split(' ')[0]}:${x.state}@${p ? (p.x / 2).toFixed(1) + ',' + (p.z / 2).toFixed(1) : '-'}`; });
      const rv = args2.veh ? g.roads.vehicles.filter((v) => !v.owner && (args2.veh === true || args2.veh.includes(v.kind || ''))).map((v) => { const q = g.roads.vehPos(v, {}); return `v${v.id}:${v.model}:${v.state || ''}@${(q.x / 2).toFixed(1)},${(q.z / 2).toFixed(1)}${q.y > 2 ? '^' + q.y.toFixed(1) : ''}`; }) : [];
      return `t=${t.toFixed(0)} ` + tr.join(' | ') + (rv.length ? ' || ' + rv.join(' | ') : '');
    }, [t, String(args.probe === true ? '' : args.probe).split(',').filter(Boolean).map(Number), { veh: args.veh || false }]));
    continue;
  }
  await page.screenshot({ path: path.join(frameDir, `f${String(f).padStart(5, '0')}.png`) });
  if (f % 30 === 0) process.stdout.write(`\r${id}-${lang}: frame ${f + 1}/${nFrames} (${((Date.now() - t0) / 1000 / (f + 1)).toFixed(2)} s/frame)   `);
}
process.stdout.write('\n');

if (probe) {
  // nothing to write
} else if (args.still) {
  fs.copyFileSync(path.join(frameDir, 'f00000.png'), path.join(outDir, `${id}-${lang}.png`));
} else {
  // the sound of the clip
  const wavB64 = await page.evaluate(async (dur) => {
    const buf = await window.__oc.startRendering();
    const sr = buf.sampleRate, n = Math.min(buf.length, Math.round(dur * sr));
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    const out = new DataView(new ArrayBuffer(44 + n * 4));
    const str = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); out.setUint32(4, 36 + n * 4, true); str(8, 'WAVE'); str(12, 'fmt ');
    out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 2, true); out.setUint32(24, sr, true);
    out.setUint32(28, sr * 4, true); out.setUint16(32, 4, true); out.setUint16(34, 16, true); str(36, 'data'); out.setUint32(40, n * 4, true);
    for (let i = 0; i < n; i++) {
      out.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i])) * 32767, true);
      out.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i])) * 32767, true);
    }
    const bytes = new Uint8Array(out.buffer);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }, dur);
  const wav = path.join(outDir, `${id}-${lang}.wav`);
  fs.writeFileSync(wav, Buffer.from(wavB64, 'base64'));
  // a near-lossless intermediate (the edit re-encodes once at the end)
  const mp4 = path.join(outDir, `${id}-${lang}.mp4`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(frameDir, 'f%05d.png'),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '10', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4]);
  console.log(`wrote ${path.relative(ROOT, mp4)} (${nFrames} frames, ${(fs.statSync(mp4).size / 1048576).toFixed(1)} MB) and the sound`);
}
if (errors.length) console.log('PAGE ERRORS:', errors.slice(0, 5).join(' | '));
if (!args.keep) fs.rmSync(frameDir, { recursive: true, force: true });
await browser.close();
server.close();
