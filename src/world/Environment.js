// Lighting, sky, day/night cycle, seasons, weather and birds.
//
// Seasons follow the company calendar (Ledger months). The weather is a
// seeded state machine that runs in game time (tickWeather, from Game.tick):
// each state lasts a while, then the next one is drawn by the season's
// weights; the one after it is already known (forecast). Every state has a
// visible effect on vehicles (WEATHER.speed / accel). Snow settles over
// winter (snowCover) and melts in spring; the terrain and trees show it.
import * as THREE from 'three';
import { N, TILE, clamp, lerp, smoothstep, RNG } from '../util.js';
import { DAY_LENGTH, REGIONS } from '../config.js';
import { MAT, ModelBuilder } from '../core/ModelBuilder.js';
import { LIGHT } from '../style.js';

const SKY = [
  // t, top, bottom, sun color, sun intensity, hemi intensity
  { t: 0.0, top: 0x1e2a4a, bot: 0x3a4a6e, sun: 0x9ab0ff, si: 0.55, hi: 0.95 },
  { t: 0.2, top: 0x2e3f6a, bot: 0xe0a080, sun: 0xffb070, si: 0.9, hi: 1.0 },
  { t: 0.3, top: 0x7ab4e0, bot: 0xf6e2c8, sun: 0xfff0d8, si: 1.9, hi: 1.25 },
  { t: 0.5, top: 0x6aaee8, bot: 0xe8f2f6, sun: 0xffffff, si: 2.2, hi: 1.3 },
  { t: 0.7, top: 0x6aa0d8, bot: 0xf4dcc0, sun: 0xfff0d0, si: 1.9, hi: 1.25 },
  { t: 0.8, top: 0x3a4a7a, bot: 0xf0a070, sun: 0xff9a5a, si: 1.0, hi: 1.0 },
  { t: 0.9, top: 0x1e2a4a, bot: 0x3a4a6e, sun: 0x9ab0ff, si: 0.55, hi: 0.95 },
  { t: 1.0, top: 0x1e2a4a, bot: 0x3a4a6e, sun: 0x9ab0ff, si: 0.55, hi: 0.95 },
];
const _a = new THREE.Color(), _b = new THREE.Color();

export const SEASON_OF_MONTH = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'];
// dur: game seconds [min, max]; speed / accel: multipliers for trains and road vehicles
export const WEATHER = {
  clear: { dur: [40, 110], speed: 1, accel: 1 },
  cloudy: { dur: [30, 80], speed: 1, accel: 1 },
  rain: { dur: [25, 60], speed: 0.95, accel: 0.97 },
  storm: { dur: [15, 35], speed: 0.9, accel: 0.9 },
  fog: { dur: [20, 45], speed: 0.93, accel: 1 },
  snow: { dur: [40, 90], speed: 0.92, accel: 0.85 },
};
export const WEATHER_IDS = Object.keys(WEATHER);
const SEASON_W = {
  winter: { clear: 3, cloudy: 3, rain: 1, storm: 0, fog: 2, snow: 4 },
  spring: { clear: 4, cloudy: 3, rain: 3, storm: 1, fog: 1, snow: 0 },
  summer: { clear: 6, cloudy: 2, rain: 1.5, storm: 1.5, fog: 0, snow: 0 },
  autumn: { clear: 3, cloudy: 3, rain: 3, storm: 1, fog: 2, snow: 0.3 },
};
// how cold a biome is (snow settles in proportion)
export const BIOME_COLD = { snow: 1, alpine: 1, pine: 0.85, green: 0.7, industrial: 0.6, plains: 0.6, coast: 0.45, desert: 0 };

export class Environment {
  constructor(game) {
    this.game = game;
    const scene = game.scene;
    this.timeOfDay = 0.32;
    this.night = 0;
    this.weather = 'clear';
    this.weatherTarget = 'clear';
    this.rain = 0; this.snow = 0; this.cloudiness = 0.2;
    this.nextWeather = 60;
    this.forecast = 'cloudy';
    this.snowCover = 0;
    this.fog = 0;
    this.flash = 0; this.flashT = 4;
    this.effects = { speed: 1, accel: 1 };

    this.hemi = new THREE.HemisphereLight(LIGHT.hemiSky, LIGHT.hemiGround, LIGHT.hemi);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(LIGHT.sunColor, LIGHT.sun);
    this.sun.castShadow = true;
    this.sun.shadow.bias = LIGHT.shadowBias;
    this.sun.shadow.normalBias = LIGHT.shadowNormalBias;
    scene.add(this.sun, this.sun.target);
    this.setShadowQuality(game.settings.shadows);

    this.skyCanvas = document.createElement('canvas');
    this.skyCanvas.width = 2; this.skyCanvas.height = 128;
    this.skyTex = new THREE.CanvasTexture(this.skyCanvas);
    this.skyTex.colorSpace = THREE.SRGBColorSpace;
    scene.background = this.skyTex;
    scene.fog = new THREE.Fog(LIGHT.fog, 400, 900);

    this.buildPrecip();
    this.buildCloudShadows();
    this.buildBirds();
    this._skyT = 0;
    this.updateSky(true);
  }

  setShadowQuality(q) {
    const size = LIGHT.shadowMap[q] || LIGHT.shadowMap.low;
    this.sun.castShadow = q !== 'off';
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    }
  }

  buildPrecip() {
    const n = 1400;
    const pos = new Float32Array(n * 6);
    this.dropSeed = [];
    const rng = new RNG(4);
    for (let i = 0; i < n; i++) this.dropSeed.push([rng.range(-40, 40), rng.range(0, 30), rng.range(-40, 40), rng.range(0.8, 1.2)]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rainMesh = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xaac4dc, transparent: true, opacity: 0.55 }));
    this.rainMesh.frustumCulled = false;
    this.rainMesh.visible = false;
    this.game.scene.add(this.rainMesh);
    const sp = new Float32Array(n * 3);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.snowMesh = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.28, transparent: true, opacity: 0.9 }));
    this.snowMesh.frustumCulled = false;
    this.snowMesh.visible = false;
    this.game.scene.add(this.snowMesh);
  }

  buildCloudShadows() {
    // invisible clouds that only cast soft moving shadows onto the diorama
    const mb = new ModelBuilder();
    for (let k = 0; k < 5; k++) mb.sphere(2.2 + (k % 3) * 0.6, 1, 0xffffff, { x: k * 2.4 - 5, y: 0, z: (k % 2) * 1.5, sy: 0.4 });
    const geo = mb.build(); geo.clearGroups();
    const mat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    this.cloudShadows = [];
    const rng = new RNG(12);
    for (let i = 0; i < 9; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      m.position.set(rng.range(0, N * TILE), 22, rng.range(0, N * TILE));
      m.scale.setScalar(rng.range(1.2, 2.2));
      m.userData.speed = rng.range(0.6, 1.1);
      this.cloudShadows.push(m);
      this.game.scene.add(m);
    }
  }

  buildBirds() {
    const mb = new ModelBuilder();
    mb.box(0.1, 0.04, 0.08, 0x2a2c30);
    mb.box(0.05, 0.02, 0.32, 0x2a2c30, { z: 0.18, rx: 0.3 });
    mb.box(0.05, 0.02, 0.32, 0x2a2c30, { z: -0.18, rx: -0.3 });
    const geo = mb.build(); geo.clearGroups();
    this.birds = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }), 18);
    this.birds.frustumCulled = false;
    this.game.scene.add(this.birds);
    const rng = new RNG(77);
    this.flocks = [0, 1, 2].map(() => ({ cx: rng.range(30, 90) * N / 64, cz: rng.range(30, 90) * N / 64, r: rng.range(10, 22), sp: rng.range(0.08, 0.14), ph: rng.range(0, 6.28), y: rng.range(9, 13) }));
  }

  update(dt, gameDt, time) {
    const g = this.game, S = g.settings;
    if (S.dayNight) this.timeOfDay = (this.timeOfDay + gameDt / DAY_LENGTH) % 1;
    else this.timeOfDay = lerp(this.timeOfDay, 0.36, Math.min(1, dt * 0.5));
    // visuals follow the state (the state itself advances in tickWeather)
    const st = S.weather ? this.weather : 'clear';
    const cam = g.camera;
    const tr = cam.target;
    const reg = g.world.region[Math.max(0, Math.min(N * N - 1, Math.floor(tr.z / TILE) * N + Math.floor(tr.x / TILE)))];
    const coldHere = REGIONS[reg] ? BIOME_COLD[REGIONS[reg].biome] ?? 0.6 : 0.6;
    const wet = st === 'rain' || st === 'storm';
    const snowy = st === 'snow' || (wet && coldHere >= 0.95) || (wet && this.season() === 'winter' && coldHere >= 0.8);
    const wantSnow = snowy && coldHere > 0.3 ? 1 : 0;
    const wantRain = wantSnow ? 0 : wet ? (st === 'storm' ? 1 : 0.7) : st === 'snow' ? 0.3 : 0;
    const wantCloud = st === 'clear' ? 0.2 : st === 'cloudy' ? 0.65 : st === 'fog' ? 0.6 : st === 'storm' ? 1 : 0.85;
    const wantFog = st === 'fog' ? 1 : st === 'snow' ? 0.35 : st === 'storm' ? 0.25 : 0;
    const k = Math.min(1, dt * 0.25);
    this.rain = lerp(this.rain, wantRain, k); this.snow = lerp(this.snow, wantSnow, k); this.cloudiness = lerp(this.cloudiness, wantCloud, k);
    this.fog = lerp(this.fog, wantFog, k);
    const fog = this.game.scene.fog;
    fog.near = lerp(400, 190, this.fog); fog.far = lerp(900, 430, this.fog);
    // lightning in a storm (visual only)
    this.flash = Math.max(0, this.flash - dt * 3);
    if (st === 'storm' && S.weather) {
      this.flashT -= dt;
      if (this.flashT <= 0) { this.flashT = 3 + Math.random() * 7; this.flash = 1; g.events.emit('lightning'); }
    }
    const U = g.world.view && g.world.view.uniforms;
    if (U && U.uSnow) U.uSnow.value = S.weather ? this.snowCover : 0;

    this._skyT -= dt;
    if (this._skyT <= 0) { this._skyT = 0.25; this.updateSky(false); }
    this.updateLights(tr, cam);
    this.updatePrecip(dt, tr);
    // cloud shadows drift
    for (const m of this.cloudShadows) {
      m.position.x += dt * m.userData.speed * 1.2;
      m.position.z += dt * m.userData.speed * 0.5;
      if (m.position.x > N * TILE + 20) m.position.x = -20;
      if (m.position.z > N * TILE + 20) m.position.z = -20;
      m.visible = S.graphics !== 'low';
    }
    // birds (daytime)
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), e = new THREE.Euler();
    let bi = 0;
    const show = this.night < 0.5 && this.rain < 0.5 && S.graphics !== 'low';
    if (show) for (const f of this.flocks) {
      for (let b = 0; b < 6; b++) {
        const a = time * f.sp + f.ph + b * 0.07;
        const x = f.cx + Math.cos(a) * (f.r + b * 0.6), z = f.cz + Math.sin(a) * (f.r + b * 0.6);
        const flap = 0.6 + Math.sin(time * 9 + b) * 0.4;
        e.set(0, -a, 0); q.setFromEuler(e);
        p.set(x, f.y + Math.sin(time + b) * 0.3, z); sc.set(1, 1, flap);
        m4.compose(p, q, sc);
        this.birds.setMatrixAt(bi++, m4);
      }
    }
    this.birds.count = bi;
    this.birds.instanceMatrix.needsUpdate = true;
    // emissive night lights
    const glow = this.night * 1.4;
    MAT.glow.emissiveIntensity = glow;
  }

  sample() {
    const t = this.timeOfDay;
    let a = SKY[0], b = SKY[SKY.length - 1];
    for (let i = 0; i < SKY.length - 1; i++) if (t >= SKY[i].t && t <= SKY[i + 1].t) { a = SKY[i]; b = SKY[i + 1]; break; }
    const f = (t - a.t) / Math.max(1e-6, b.t - a.t);
    return { a, b, f };
  }

  updateSky() {
    const { a, b, f } = this.sample();
    const cl = this.cloudiness;
    const grey = new THREE.Color(0x9aa4ae);
    const top = _a.set(a.top).lerp(_b.set(b.top), f).lerp(grey, cl * 0.45).clone();
    const bot = _a.set(a.bot).lerp(_b.set(b.bot), f).lerp(grey, cl * 0.35).clone();
    const ctx = this.skyCanvas.getContext('2d');
    const gr = ctx.createLinearGradient(0, 0, 0, 128);
    gr.addColorStop(0, '#' + top.getHexString());
    gr.addColorStop(1, '#' + bot.getHexString());
    ctx.fillStyle = gr; ctx.fillRect(0, 0, 2, 128);
    this.skyTex.needsUpdate = true;
    this.game.scene.fog.color.copy(bot);
  }

  updateLights(tr, cam) {
    const { a, b, f } = this.sample();
    const t = this.timeOfDay;
    // night factor: 0 during day, 1 in deep night
    const n = t < 0.25 ? 1 - smoothstep(0.15, 0.27, t) : t > 0.75 ? smoothstep(0.73, 0.86, t) : 0;
    this.night = n;
    const cl = this.cloudiness;
    this.sun.color.set(a.sun).lerp(_b.set(b.sun), f);
    this.sun.intensity = lerp(a.si, b.si, f) * (1 - cl * 0.35);
    this.hemi.intensity = lerp(a.hi, b.hi, f) * (1 - cl * 0.1) + this.flash * 1.6;
    this.hemi.color.set(0xdfefff).lerp(_b.set(0x8aa0d0), n * 0.6);
    // sun position arcs over the diorama; at night it is moonlight from the opposite side
    const ang = (t - 0.25) * Math.PI * 2;
    const el = n > 0.5 ? 0.9 : clamp(Math.sin(ang), 0.35, 1) * 1.1;
    const az = ang + 0.6;
    const dist = 80;
    this.sun.position.set(tr.x + Math.cos(az) * dist, Math.max(30, el * dist), tr.z + Math.sin(az) * dist * 0.6 + 30);
    this.sun.target.position.copy(tr);
    const s = clamp(cam.viewSize * 1.25, 20, 90);
    const sc = this.sun.shadow.camera;
    if (sc.right !== s) { sc.left = -s; sc.right = s; sc.top = s; sc.bottom = -s; sc.near = 1; sc.far = 260; sc.updateProjectionMatrix(); }
  }

  updatePrecip(dt, tr) {
    const q = this.game.settings.particles;
    const nMax = q === 'low' ? 300 : q === 'medium' ? 800 : 1400;
    const rv = this.rain > 0.05, sv = this.snow > 0.05;
    this.rainMesh.visible = rv; this.snowMesh.visible = sv;
    if (!rv && !sv) return;
    const n = Math.floor(nMax * Math.max(this.rain, this.snow));
    if (rv) {
      const arr = this.rainMesh.geometry.attributes.position.array;
      // one coherent wind for all drops, spread over the visible area
      const vs = this.game.camera.viewSize;
      const span = Math.min(40, vs * 1.35 + 6);
      const wx = 0.28 + Math.sin(this.game.clock * 0.05) * 0.08, wz = 0.12;
      const view = this.game.world.view;
      for (let i = 0; i < this.dropSeed.length; i++) {
        const d = this.dropSeed[i];
        if (i >= n) { arr.fill(0, i * 6, i * 6 + 6); continue; }
        const fall = dt * 30 * d[3];
        d[1] -= fall;
        const x = tr.x + (d[0] / 40) * span + (30 - d[1]) * wx, z = tr.z + (d[2] / 40) * span + (30 - d[1]) * wz;
        const ground = view ? view.heightAt(x, z) : 0;
        if (d[1] < Math.max(0, ground)) d[1] += 30;
        const y = d[1];
        arr[i * 6] = x; arr[i * 6 + 1] = y; arr[i * 6 + 2] = z;
        arr[i * 6 + 3] = x - wx * 0.8; arr[i * 6 + 4] = y + 0.8; arr[i * 6 + 5] = z - wz * 0.8;
      }
      this.rainMesh.geometry.attributes.position.needsUpdate = true;
      this.rainMesh.material.opacity = 0.5 * this.rain;
    }
    if (sv) {
      const arr = this.snowMesh.geometry.attributes.position.array;
      const time = this.game.clock;
      for (let i = 0; i < this.dropSeed.length; i++) {
        const d = this.dropSeed[i];
        if (i >= n) { arr[i * 3 + 1] = -100; continue; }
        d[1] -= dt * 3 * d[3];
        if (d[1] < 0) d[1] += 30;
        arr[i * 3] = tr.x + d[0] + Math.sin(time * 0.8 + i) * 0.6; arr[i * 3 + 1] = d[1]; arr[i * 3 + 2] = tr.z + d[2];
      }
      this.snowMesh.geometry.attributes.position.needsUpdate = true;
      this.snowMesh.material.opacity = 0.9 * this.snow;
    }
  }

  // ---------- seasons and weather (game time) ----------
  season() { const L = this.game.ledger; return SEASON_OF_MONTH[L ? L.monthOfYear() : 5]; }
  rng() { if (!this._wrng) this._wrng = new RNG(String((this.game.world && this.game.world.seed) ?? 1) + ':weather'); return this._wrng; }
  // draw the next state by the season's weights (never the same as now)
  draw(after, season) {
    const w = SEASON_W[season], r = this.rng();
    let sum = 0;
    for (const id of WEATHER_IDS) if (id !== after) sum += w[id];
    let x = r.next() * sum;
    for (const id of WEATHER_IDS) { if (id === after) continue; x -= w[id]; if (x <= 0) return id; }
    return 'clear';
  }
  tickWeather(dt) {
    const g = this.game, S = g.settings;
    if (!S.weather) { this.effects.speed = 1; this.effects.accel = 1; return; }
    this.nextWeather -= dt;
    if (this.nextWeather <= 0) {
      const season = this.season();
      // a forecast that no longer fits the season (snow in summer) is redrawn
      let next = this.forecast;
      if (!WEATHER[next] || !SEASON_W[season][next] || next === this.weather) next = this.draw(this.weather, season);
      const prev = this.weather;
      this.weather = this.weatherTarget = next;
      const d = WEATHER[next].dur;
      this.nextWeather = d[0] + this.rng().next() * (d[1] - d[0]);
      this.forecast = this.draw(next, season);
      if (prev !== next) g.events.emit('weather', next);
    }
    // vehicles ease into the conditions
    const W = WEATHER[this.weather] || WEATHER.clear;
    const k = Math.min(1, dt * 0.1);
    this.effects.speed += (W.speed - this.effects.speed) * k;
    this.effects.accel += (W.accel - this.effects.accel) * k;
    // snow settles while it snows in winter and melts otherwise
    const season = this.season();
    if (this.weather === 'snow') this.snowCover = Math.min(1, this.snowCover + dt / 60);
    else if (season !== 'winter') this.snowCover = Math.max(0, this.snowCover - dt / (this.weather === 'rain' ? 30 : 60));
    else if (this.weather === 'rain' || this.weather === 'storm') this.snowCover = Math.max(0, this.snowCover - dt / 120);
  }

  serialize() { return { timeOfDay: this.timeOfDay, weather: this.weather, nextWeather: this.nextWeather, forecast: this.forecast, snowCover: Math.round(this.snowCover * 1000) / 1000 }; }
  deserialize(d) {
    if (!d) return;
    this.timeOfDay = typeof d.timeOfDay === 'number' ? d.timeOfDay % 1 : 0.32;
    this.weather = this.weatherTarget = WEATHER[d.weather] ? d.weather : 'clear';
    this.nextWeather = Math.min(120, Math.max(1, +d.nextWeather || 60));
    this.forecast = WEATHER[d.forecast] ? d.forecast : 'cloudy';
    const sc = +d.snowCover;
    this.snowCover = isFinite(sc) ? Math.min(1, Math.max(0, sc)) : 0;
    const W = WEATHER[this.weather];
    this.effects.speed = W.speed; this.effects.accel = W.accel;
  }
}
