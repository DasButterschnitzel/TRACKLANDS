// Application bootstrap: renderer, settings, persistence, title screen,
// new game / continue / import flows, render loop, PWA registration.
import * as THREE from 'three';
import { Game } from './Game.js';
import { UI } from './ui/UI.js';
import { AudioEngine } from './audio/Audio.js';
import { SaveStore, migrate, validate, exportText, importText, downloadJSON } from './save/Save.js';
import { Backups, healthOfGame } from './save/Backups.js';
import { loadPacks } from './content/Packs.js';
import { TitleScene } from './title/TitleScene.js';
import { t, setLang, detectLang, getLang } from './i18n.js';
import { hashStr, fmt, fmtTime, escapeHtml, MAP_SIZES, N, setMapSize } from './util.js';
import { generateWorld } from './world/WorldGen.js';
import { TERRAIN_IDS, TERRAIN_PRESETS, TERRAIN_RANGES, TERRAIN_CHOICES, resolveTerrain, normalizeTerrain, terrainStats } from './world/Terrain.js';
import { readHeightmap } from './world/Heightmap.js';
import { scenarioDialog } from './ui/ScenarioMenu.js';
import { icon } from './ui/icons.js';
import { DIFFICULTY, SAVE_VERSION, GAME_VERSION, GAME_PRESETS } from './config.js';
import { log } from './core/Log.js';
import { RIVAL_COUNTS, RIVAL_TIMINGS } from './world/Rivals.js';
import { AI_LEVEL_IDS } from './world/RailAI.js';
const UNLOCK_EVENTS = ['pointerdown', 'click', 'keydown', 'touchend'];

const SETTINGS_KEY = 'tracklands.settings';
const DEFAULTS = {
  volMaster: 0.8, volMusic: 0.6, volSfx: 0.8, volAmb: 0.6, music: true,
  graphics: 'auto', shadows: 'medium', particles: 'high', units: 'metric', haptics: true, autosave: 30, backups: 5, musicShuffle: true, musicRepeat: 'all', nowPlaying: true, dayNight: true, dayLength: 'normal', weather: true, extremeWeather: true, labels: true, perfHud: false,
  cameraMotion: true, screenShake: true, reducedMotion: false, highContrast: false, uiScale: 1, lang: null, tutorial: true, tips: true, wheel: 'auto',
  instantBuild: false, keepTool: true,
};

function loadSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; } catch (e) { s = {}; }
  const out = { ...DEFAULTS };
  for (const k in DEFAULTS) if (s[k] !== undefined && typeof s[k] === typeof DEFAULTS[k] || (k === 'lang' && typeof s[k] === 'string')) out[k] = s[k];
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches && s.reducedMotion === undefined) out.reducedMotion = true;
  // phones start lighter; the automatic graphics profile picks the resolution
  if (s.graphics === undefined && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)) { out.shadows = 'low'; out.particles = 'medium'; }
  return out;
}

const $ = (s) => document.querySelector(s);

class App {
  constructor() {
    this.settings = loadSettings();
    setLang(this.settings.lang || detectLang());
    this.fps = 60;
    this.game = null;
    this.title = null;
    this.store = new SaveStore();
    this.audio = new AudioEngine({ get g() { return app.game; }, get settings() { return app.settings; }, get env() { return app.game && app.game.env; }, get trains() { return app.game && app.game.trains; }, get progression() { return app.game && app.game.progression; } });
  }

  async boot() {
    const canvas = $('#view');
    // WebGL 2 with antialiasing first; weaker drivers get a second, plainer try
    for (const opts of [{ antialias: this.settings.graphics !== 'low', powerPreference: 'high-performance' }, { antialias: false, powerPreference: 'default' }]) {
      try { this.renderer = new THREE.WebGLRenderer({ canvas, ...opts }); if (this.renderer.capabilities.isWebGL2) break; } catch (e) { log.warn('gfx', 'renderer init failed', { opts, err: String(e && e.message || e) }); }
      if (this.renderer) { this.renderer.dispose(); this.renderer = null; }
    }
    if (!this.renderer) { log.error('gfx', 'no WebGL 2'); this.fatal(t('err_webgl')); return; }
    this.gpu = this.detectGpu();
    this.autoGfx = this.autoProfile();
    log.info('gfx', 'renderer ready', { gpu: this.gpu, auto: this.autoGfx, dpr: window.devicePixelRatio });
    // the browser reset the graphics (driver hiccup, memory pressure): save at
    // once, tell the player, and when the graphics come back reload straight
    // into the saved game (nothing in the simulation or the save is lost)
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.flushSave();
      if (this.game && !this.game.testMode) { try { sessionStorage.setItem('tracklands.resume', '1'); } catch (err) { /* no session storage */ } }
      this.ui && this.ui.toast(t('err_gpu_lost'), 'warn');
    });
    canvas.addEventListener('webglcontextrestored', () => location.reload());
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.applyPixelRatio();
    this.ui = new UI(this);
    this.applyUiSettings();
    this.ui.relocalize();
    await this.store.init();
    this.backups = new Backups(this.store);
    // creator content packs (assets/packs): checked, then added
    try { await loadPacks(); } catch (e) { log.warn('packs', 'content packs not loaded', String(e && e.message || e)); }
    this.save = await this.loadNewestSave();
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => this.onVisibility());
    window.addEventListener('pagehide', () => this.flushSave());
    // audio may start only after a gesture; browsers differ in which events
    // count (Firefox: click and keys, not pointerdown), so try each until it runs
    const unlock = () => { this.audio.unlock(); if (this.audio.ctx && this.audio.ctx.state === 'running') for (const ev of UNLOCK_EVENTS) document.removeEventListener(ev, unlock, true); };
    for (const ev of UNLOCK_EVENTS) document.addEventListener(ev, unlock, true);
    this.showTitle();
    this.crashNotice();
    // back from a graphics reset: straight into the saved game
    let resume = false;
    try { resume = sessionStorage.getItem('tracklands.resume') === '1'; sessionStorage.removeItem('tracklands.resume'); } catch (e) { /* no session storage */ }
    if (resume && this.save) { log.info('gfx', 'resuming after a graphics reset'); this.startGame({ save: this.save }); }
    this.last = performance.now();
    requestAnimationFrame((ts) => this.loop(ts));
    $('#loading').classList.add('done');
    setTimeout(() => $('#loading').remove(), 800);
    if ('serviceWorker' in navigator && location.protocol !== 'file:') this.registerSW();
    if (new URLSearchParams(location.search).has('railtest')) this.runRailTests();
  }

  // PWA updates: a new release installs completely in the background, then the
  // game offers to switch (after saving); the page never mixes two releases
  registerSW() {
    navigator.serviceWorker.register('./service-worker.js').then((reg) => {
      const offer = (w) => { if (w && navigator.serviceWorker.controller) { log.info('pwa', 'update ready'); this.ui && this.ui.updateReady(() => { this.flushSave(); w.postMessage('skipWaiting'); }); } };
      if (reg.waiting) offer(reg.waiting);
      reg.addEventListener('updatefound', () => { const w = reg.installing; if (w) w.addEventListener('statechange', () => { if (w.state === 'installed') offer(w); }); });
      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloading || !this._swHadController) return; reloading = true; location.reload(); });
      this._swHadController = !!navigator.serviceWorker.controller;
    }).catch((e) => log.warn('pwa', 'service worker registration failed', String(e && e.message || e)));
  }

  // everything a bug report needs, nothing personal
  diagnostics() {
    const g = this.game, r = this.renderer;
    const d = {
      version: GAME_VERSION, save: SAVE_VERSION, time: new Date().toISOString(), ua: navigator.userAgent, lang: getLang(),
      screen: { w: innerWidth, h: innerHeight, dpr: window.devicePixelRatio }, gpu: this.gpu, webgl2: !!(r && r.capabilities.isWebGL2),
      gfx: { setting: this.settings.graphics, effective: this.gfx() }, fps: Math.round(this.fps), settings: this.settings,
      backups: this.settings.backups, autosave: this.settings.autosave,
      health: g ? healthOfGame(g) : null, startMs: this.startMs || null,
      perf: g && g.perf ? (({ fps, frame95, sim, vis, render, calls, tris, geos, texs, over }) => ({ fps: Math.round(fps), frame95: +frame95.toFixed(1), sim: +sim.toFixed(2), vis: +vis.toFixed(2), render: +render.toFixed(2), calls, tris, geos, texs, over }))(g.perf.report(g)) : null,
      game: g ? { seed: g.world.seed, time: Math.round(g.time), trains: g.trains.trains.length, stations: g.stations.list.length, level: g.progression.level, errors: g.trains.errors || 0, collisions: g.trains.collisions, incidents: g.trains.incidents.length } : null,
      log: log.entries(120),
    };
    return JSON.stringify(d, null, 1);
  }

  // ?railtest: automated railway scenarios on a throwaway world (never saved)
  runRailTests() {
    this.startGame({ seed: 424242, difficulty: 'builder', test: true });
    const wait = setInterval(() => {
      if (!this.game) return;
      clearInterval(wait);
      this.game.tutorial.skip();
      setTimeout(() => {
        const res = this.game.runRailTests();
        const rows = res.map((r) => `<div class="adv">${r.ok ? '✅' : '❌'}<span><b>${escapeHtml(r.name)}</b><br><small>${escapeHtml(r.detail)}</small></span></div>`).join('');
        const w = this.ui.modal(`<h2>Rail tests: ${res.filter((r) => r.ok).length}/${res.length}</h2>${rows}<div class="row end"><button class="btn primary" data-mbtn="ok">${t('ok')}</button></div>`, { onCancel: () => {} });
        w.querySelector('[data-mbtn=ok]').onclick = () => w.remove();
        window.__railTestResults = res;
      }, 500);
    }, 100);
  }

  fatal(msg) {
    $('#loading').innerHTML = `<div class="fatal"><h1>TRACKLANDS</h1><p>${escapeHtml(msg)}</p></div>`;
  }

  async loadNewestSave() {
    let a = await this.store.get('main');
    let b = null;
    try { const s = localStorage.getItem('tracklands.save'); b = s ? JSON.parse(s) : null; } catch (e) { b = null; }
    if (a && a.corrupt) a = null;
    if (b && (!a || (b.savedAt || 0) > (a.savedAt || 0))) a = b;
    return a;
  }

  // ---------- graphics profile (auto picks one per device, steps down if slow) ----------
  detectGpu() {
    try { const gl = this.renderer.getContext(); const d = gl.getExtension('WEBGL_debug_renderer_info'); return d ? String(gl.getParameter(d.UNMASKED_RENDERER_WEBGL)) : 'unknown'; } catch (e) { return 'unknown'; }
  }
  autoProfile() {
    const cores = navigator.hardwareConcurrency || 4, mem = navigator.deviceMemory || 4;
    const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
    const soft = /SwiftShader|llvmpipe|Software|Basic Render/i.test(this.gpu || '');
    const maxTex = this.renderer.capabilities.maxTextureSize || 4096;
    if (soft || cores <= 2 || mem <= 2 || maxTex < 4096) return 'low';
    if (mobile || cores <= 4 || mem <= 4) return 'medium';
    return 'high';
  }
  gfx() { return this.settings.graphics === 'auto' ? this.autoGfx || 'medium' : this.settings.graphics; }
  // automatic profile only: a long run of low frame rates steps quality down (never up)
  adaptGfx(dt) {
    if (this.settings.graphics !== 'auto' || !this.game || document.hidden) { this._slowT = 0; return; }
    this._slowT = this.fps < 32 ? (this._slowT || 0) + dt : 0;
    if (this._slowT < 8 || this.autoGfx === 'low') return;
    this._slowT = 0;
    this.autoGfx = this.autoGfx === 'high' ? 'medium' : 'low';
    this.applyPixelRatio();
    if (this.autoGfx === 'low' && this.game.env) this.game.env.setShadowQuality('low');
    log.info('gfx', 'auto profile lowered', { to: this.autoGfx, fps: Math.round(this.fps) });
    this.ui && this.ui.toast(t('gfx_lowered'), 'info', 'settings');
  }

  applyPixelRatio() {
    const q = this.gfx();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q === 'high' ? 2 : q === 'medium' ? 1.5 : 1));
    this.resize();
  }
  applyUiSettings() {
    const s = this.settings;
    document.documentElement.style.setProperty('--ui-scale', s.uiScale);
    document.body.classList.toggle('high-contrast', !!s.highContrast);
    document.body.classList.toggle('reduced-motion', !!s.reducedMotion);
  }

  setSetting(k, v) {
    this.settings[k] = v;
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch (e) { /* storage unavailable */ }
    if (k.startsWith('vol') || k === 'music') this.audio.applyVolumes();
    if (k === 'graphics') this.applyPixelRatio();
    if (k === 'shadows' && this.game) this.game.env.setShadowQuality(v);
    if (k === 'uiScale' || k === 'highContrast' || k === 'reducedMotion') this.applyUiSettings();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    if (!this.renderer) return;
    this.renderer.setSize(w, h, false);
    if (this.game) this.game.resize();
    if (this.title) this.title.resize(w, h);
    if (this.ui && this.ui._stripEdges) this.ui._stripEdges();
  }

  loop(ts) {
    const dt = Math.min(0.1, (ts - this.last) / 1000);
    this.last = ts;
    if (dt > 0) this.fps = this.fps * 0.95 + (1 / dt) * 0.05;
    this.adaptGfx(dt);
    try {
      if (this.game) this.game.frame(dt);
      else if (this.title) { this.title.render(dt); this.audio.update(dt); }
    } catch (e) { console.error(e); if ((this._loopErrs = (this._loopErrs || 0) + 1) < 20) log.error('loop', String(e && e.message || e)); this.crashSnapshot(e); }
    requestAnimationFrame((t2) => this.loop(t2));
  }

  // ---------- title ----------
  showTitle() {
    this.title = new TitleScene(this);
    this.resize();
    this.renderTitle();
    $('#title').hidden = false;
  }
  renderTitle() {
    const s = this.save;
    const has = s && !validate(s);
    const info = has ? `<small>${t('company_level')} ${s.progression.level} · ${fmt(s.economy.coins)} ● · ${fmtTime((s.stats && s.stats.playTime) || 0)}</small>` : '';
    $('#title').innerHTML = `<div class="title-card">
      <h1 class="logo">TRACK<span>LANDS</span></h1><p class="tagline">${t('tagline')}</p>
      <div class="title-btns">
        ${has ? `<button class="btn primary big" data-t="continue">${t('continue')}${info}</button>` : `<button class="btn primary big" data-t="new">${t('start_journey')}</button>`}
        ${has ? `<button class="btn big" data-t="new">${t('new_game')}</button>` : `<button class="btn big" data-t="new">${t('new_game_custom')}</button>`}
        <button class="btn" data-t="quick">${icon('play')} ${t('quick_start')}</button>
        <button class="btn" data-t="scenarios">${icon('objectives')} ${t('scenarios')}</button>
        <button class="btn" data-t="settings">${icon('settings')} ${t('settings')}</button>
        <button class="btn" data-t="stats">${icon('stats')} ${t('menu_stats')}</button>
        <button class="btn" data-t="credits">${t('credits')}</button>
        <button class="btn ghost" data-t="backups">${icon('save')} ${t('backups')}</button>
      </div><p class="muted small ver"><button class="linkbtn" data-t="changelog">v${GAME_VERSION} · ${t('whats_new')}</button></p></div>`;
    $('#title').querySelectorAll('[data-t]').forEach((b) => { b.onclick = () => { this.audio.unlock(); this.audio.play('click'); this.titleAction(b.dataset.t); }; });
  }
  onRelocalize() { if (this.title && !this.game) this.renderTitle(); }

  titleAction(a) {
    if (a === 'continue') this.startGame({ save: this.save });
    else if (a === 'new') this.newGameDialog();
    else if (a === 'quick') this.quickStart();
    else if (a === 'scenarios') scenarioDialog(this);
    else if (a === 'settings') this.ui.openPanel('settings');
    else if (a === 'credits') this.ui.openPanel('credits');
    else if (a === 'changelog') this.ui.openPanel('changelog');
    else if (a === 'backups') this.backupDialog();
    else if (a === 'stats') {
      const S = this.save && this.save.stats;
      const rows = S ? [['stat_deliveries', fmt(S.deliveries)], ['stat_passengers', fmt(S.passengers)], ['stat_coinsEarned', fmt(S.coinsEarned)], ['stat_trainsBought', S.trainsBought], ['stat_track', fmt(S.trackBuilt)], ['stat_regionsUnlocked', S.regionsUnlocked], ['stat_playTime', fmtTime(S.playTime)]] : [];
      const w = this.ui.modal(`<h2>${t('menu_stats')}</h2>${S ? `<div class="stats">${rows.map(([k, v]) => `<div><span>${t(k)}</span><b>${v}</b></div>`).join('')}</div>` : `<p class="muted">${t('none_yet')}</p>`}<div class="row end"><button class="btn primary" data-mbtn="ok">${t('ok')}</button></div>`, { onCancel: () => {} });
      w.querySelector('[data-mbtn=ok]').onclick = () => w.remove();
    }
  }

  // quick start: a small standard world with one rival, no questions (a
  // running company is backed up first and asked about)
  async quickStart() {
    if (this.save && !(await this.ui.confirm(t('new_game_overwrite'), t('quick_start'), true))) return;
    if (this.save) await this.backupNow('before_import', this.save);
    this.startGame({ seed: Math.floor(Math.random() * 1e9), ...GAME_PRESETS.classic.opts, mapSize: 64, startYear: 1950 });
  }

  // a small picture of the world a seed makes (terrain, water, regions,
  // towns and industries); returns the terrain statistics for the dialog
  drawPreview(canvas, seed, size, terrain) {
    if (this.game) return false;          // (the generator uses the global map size)
    const prev = N;
    setMapSize(size);
    let W;
    try { W = generateWorld(seed, undefined, { terrain }); } catch (e) { setMapSize(prev); return false; }
    const n = N, ctx = canvas.getContext('2d'), img = ctx.createImageData(n, n);
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n * n; i++) { const h = W.tileH[i]; if (h < lo) lo = h; if (h > hi) hi = h; }
    for (let i = 0; i < n * n; i++) {
      const k = i * 4, h = (W.tileH[i] - lo) / Math.max(1e-6, hi - lo);
      let r, gC, b;
      if (W.type[i] === 1) { r = 70; gC = 130; b = 200; } else if (h > 0.75) { r = 170 + h * 60; gC = 165 + h * 60; b = 160 + h * 60; } else { r = 90 + h * 70; gC = 140 + h * 50; b = 70 + h * 30; }
      if (W.trees && W.trees[i]) { r *= 0.8; gC *= 0.9; b *= 0.8; }
      if (W.fields && W.fields[i]) { r = r * 0.5 + 105; gC = gC * 0.5 + 90; b = b * 0.5 + 30; }
      // region borders
      const x = i % n, z = (i / n) | 0;
      if ((x + 1 < n && W.region[i + 1] !== W.region[i]) || (z + 1 < n && W.region[i + n] !== W.region[i])) { r *= 0.7; gC *= 0.7; b *= 0.7; }
      img.data[k] = r; img.data[k + 1] = gC; img.data[k + 2] = b; img.data[k + 3] = 255;
    }
    // towns white, industries amber (drawn at 2× so they read on a phone)
    const dot = (x, z, c) => { for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) { if (x + dx >= n || z + dz >= n) continue; const k = ((z + dz) * n + x + dx) * 4; img.data[k] = c[0]; img.data[k + 1] = c[1]; img.data[k + 2] = c[2]; } };
    for (const f of W.industries) dot(f.x, f.z, [240, 170, 40]);
    for (const tw of W.towns) dot(tw.x, tw.z, [255, 255, 255]);
    canvas.width = n; canvas.height = n;
    ctx.putImageData(img, 0, 0);
    const st = terrainStats(W, n);
    setMapSize(prev);
    return st;
  }

  newGameDialog() {
    const seed = String(Math.floor(Math.random() * 1e9));
    const w = this.ui.modal(`<h2>${t('new_game')}</h2>
      ${this.save ? `<p class="card warn">${icon('warn')} ${t('new_game_overwrite')}</p>` : ''}
      <div class="presets row wrap">${Object.keys(GAME_PRESETS).map((k) => `<button class="chip" data-preset="${k}" data-tip="${t('preset_' + k + '_desc')}"><b>${t('preset_' + k)}</b><small>${t('preset_' + k + '_desc')}</small></button>`).join('')}</div>
      <label class="set"><span>${t('world_seed')}</span><span class="row"><input class="inp" id="ng-seed" value="${seed}" maxlength="24"/><button class="btn ghost" id="ng-rand">${t('random')}</button></span></label>
      <div class="diffs">${Object.keys(DIFFICULTY).map((d) => `<label class="diff"><input type="radio" name="diff" value="${d}" ${d === 'standard' ? 'checked' : ''}/><b>${t('diff_' + d)}</b><small>${t('diff_' + d + '_desc')}</small></label>`).join('')}</div>
      <h3>${t('ng_world')}</h3>
      <div class="diffs ng-size">${MAP_SIZES.map((n) => `<label class="diff"><input type="radio" name="size" value="${n}" ${n === 64 ? 'checked' : ''}/><b>${t('size_' + n)}</b><small>${t('size_' + n + '_desc')}</small></label>`).join('')}</div>
      <label class="set"><span>${t('ng_terrain')}</span><select id="ng-terrain">${TERRAIN_IDS.map((p) => `<option value="${p}">${t('terrain_' + p)}</option>`).join('')}</select></label>
      <p class="muted small" id="ng-tdesc">${t('terrain_classic_desc')}</p>
      <details class="ng-more" id="ng-tadv"><summary>${t('ng_terrain_adv')}</summary>
        <div class="ng-tparams">${Object.entries(TERRAIN_RANGES).map(([k, [lo, hi, st]]) => `<label class="set"><span>${t('tp_' + k)}</span><span class="row"><input type="range" data-tp="${k}" min="${lo}" max="${hi}" step="${st}" aria-label="${t('tp_' + k)}"/><output data-tpo="${k}"></output></span></label>`).join('')}
        ${Object.entries(TERRAIN_CHOICES).map(([k, os]) => `<label class="set"><span>${t('tp_' + k)}</span><select data-tp="${k}">${os.map((o) => `<option value="${o}">${t('tp_' + k + '_' + o)}</option>`).join('')}</select></label>`).join('')}
        ${['passes', 'smart'].map((k) => `<label class="set"><span>${t('tp_' + k)}</span><input type="checkbox" data-tp="${k}"/></label>`).join('')}</div>
        <p class="muted small">${t('ng_terrain_adv_help')}</p>
        <button class="btn ghost small" id="ng-treset">${t('ng_terrain_reset')}</button>
      </details>
      <p class="card warn" id="ng-mega" hidden>${icon('warn')} ${t('ng_mega_warn')}</p>
      <label class="set"><span>${t('ng_start_year')}</span><select id="ng-year">${[1900, 1930, 1950, 1970, 1990].map((y) => `<option value="${y}" ${y === 1950 ? 'selected' : ''}>${y}</option>`).join('')}</select></label>
      <label class="set"><span>${t('ng_heightmap')}</span><input type="file" id="ng-hmap" accept="image/*" aria-label="${t('ng_heightmap')}"/></label>
      <p class="muted small">${t('ng_heightmap_help')}</p>
      <label class="set"><span>${t('ng_rivals')}</span><select id="ng-rivals">${RIVAL_COUNTS.map((n) => `<option value="${n}" ${n === 1 ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <details class="ng-more"><summary>${t('ng_rivals_more')}</summary>
        <label class="set"><span>${t('ng_rival_timing')}</span><select id="ng-rtiming">${RIVAL_TIMINGS.map((o) => `<option value="${o}">${t('rival_timing_' + o)}</option>`).join('')}</select></label>
        <label class="set"><span>${t('ng_ai_level')}</span><select id="ng-ailevel">${AI_LEVEL_IDS.map((o) => `<option value="${o}" ${o === 'standard' ? 'selected' : ''}>${t('ai_level_' + o)}</option>`).join('')}</select></label>
        <p class="muted small">${t('ng_rivals_help')}</p>
      </details>
      <label class="set"><span>${t('rel_mode')}</span><select id="ng-rel">${['off', 'relaxed', 'tycoon'].map((o) => `<option value="${o}" ${o === 'relaxed' ? 'selected' : ''}>${t('rel_' + o)}</option>`).join('')}</select></label>
      <label class="set"><span>${t('ind_rule')}</span><select id="ng-ind">${['off', 'on'].map((o) => `<option value="${o}">${t('ind_rule_' + o)}</option>`).join('')}</select></label>
      ${this.game ? '' : `<div class="ng-preview"><canvas id="ng-map" width="64" height="64" aria-label="${t('map_preview')}"></canvas><div class="ng-pinfo"><small class="muted">${t('map_preview')}</small><div id="ng-tstats" class="small"></div><button class="btn ghost small" id="ng-regen">${t('ng_regen')}</button></div></div>`}
      <div class="row end"><button class="btn ghost" data-mbtn="no">${t('cancel')}</button><button class="btn primary" data-mbtn="go">${t('start_journey')}</button></div>`, { onCancel: () => {} });
    // the map preview follows the seed and the size
    const seedNum = () => { const raw = w.querySelector('#ng-seed').value.trim() || seed; return /^\d+$/.test(raw) ? parseInt(raw, 10) % 4294967296 : hashStr(raw); };
    // the terrain: a preset, adjusted in the advanced settings
    const tSel = w.querySelector('#ng-terrain');
    const tFill = () => {
      const P = resolveTerrain({ preset: tSel.value });
      w.querySelectorAll('[data-tp]').forEach((el) => { const k = el.dataset.tp; if (el.type === 'checkbox') el.checked = !!P[k]; else el.value = String(P[k]); });
      tOut();
      w.querySelector('#ng-tdesc').textContent = t('terrain_' + tSel.value + '_desc');
    };
    const tOut = () => w.querySelectorAll('[data-tpo]').forEach((o) => { o.textContent = w.querySelector(`[data-tp=${o.dataset.tpo}]`).value; });
    const terrain = () => {
      const spec = { preset: tSel.value };
      w.querySelectorAll('[data-tp]').forEach((el) => { const k = el.dataset.tp; spec[k] = el.type === 'checkbox' ? el.checked : TERRAIN_RANGES[k] ? +el.value : el.value; });
      return normalizeTerrain(spec);
    };
    const size = () => +w.querySelector('input[name=size]:checked').value;
    const mega = () => { w.querySelector('#ng-mega').hidden = size() < 192; };
    let pt = null;
    const preview = () => { clearTimeout(pt); mega(); pt = setTimeout(() => {
      const c = w.querySelector('#ng-map');
      if (!c) return;
      const st = this.drawPreview(c, seedNum(), size(), terrain());
      const box = w.querySelector('#ng-tstats');
      if (st && box) box.innerHTML = `${t('ng_tstats', { w: st.water, m: st.mountain, f: st.forest, fl: st.fields, n: st.towns, i: st.industries })}<br>${t('ng_tcost', { flat: st.cross.flat, slope: st.cross.slope, bridge: st.cross.bridge, tunnel: st.cross.tunnel, c: t('tcost_' + st.cost) })}`;
    }, 150); };
    tSel.addEventListener('change', () => {
      tFill();
      // a preset made for a bigger map suggests it
      const want = TERRAIN_PRESETS[tSel.value].size;
      if (want) { const r = w.querySelector(`input[name=size][value="${want}"]`); if (r) r.checked = true; }
      preview();
    });
    w.querySelectorAll('[data-tp]').forEach((el) => el.addEventListener(el.type === 'range' ? 'input' : 'change', () => { tOut(); preview(); }));
    w.querySelector('#ng-treset').onclick = () => { tFill(); preview(); };
    tFill();
    const regen = w.querySelector('#ng-regen');
    if (regen) regen.onclick = () => { w.querySelector('#ng-seed').value = String(Math.floor(Math.random() * 1e9)); preview(); };
    w.querySelector('#ng-seed').addEventListener('input', preview);
    w.querySelectorAll('input[name=size]').forEach((r) => r.addEventListener('change', preview));
    preview();
    // presets fill in the choices below them
    w.querySelectorAll('[data-preset]').forEach((b) => { b.onclick = () => {
      const P = GAME_PRESETS[b.dataset.preset].opts;
      const d = w.querySelector(`input[name=diff][value=${P.difficulty}]`); if (d) d.checked = true;
      w.querySelector('#ng-rel').value = P.reliability; w.querySelector('#ng-rivals').value = String(P.rivals); w.querySelector('#ng-ind').value = P.industryRule;
      w.querySelectorAll('[data-preset]').forEach((x) => x.classList.toggle('on', x === b));
    }; });
    w.querySelector('#ng-rand').onclick = () => { w.querySelector('#ng-seed').value = String(Math.floor(Math.random() * 1e9)); preview(); };
    w.querySelector('[data-mbtn=no]').onclick = () => w.remove();
    w.querySelector('[data-mbtn=go]').onclick = async () => {
      const raw = w.querySelector('#ng-seed').value.trim() || seed;
      const num = /^\d+$/.test(raw) ? parseInt(raw, 10) % 4294967296 : hashStr(raw);
      const diff = w.querySelector('input[name=diff]:checked').value;
      const mapSize = +w.querySelector('input[name=size]:checked').value;
      const startYear = +w.querySelector('#ng-year').value;
      const reliability = w.querySelector('#ng-rel').value;
      const rivals = +w.querySelector('#ng-rivals').value;
      const rivalTiming = w.querySelector('#ng-rtiming').value, aiLevel = w.querySelector('#ng-ailevel').value;
      const industryRule = w.querySelector('#ng-ind').value;
      const file = w.querySelector('#ng-hmap').files[0];
      let hmap = null;
      if (file) {
        try { hmap = await readHeightmap(file, mapSize); } catch (e) { this.ui.toast(t('ng_heightmap_bad'), 'error'); return; }
      }
      w.remove();
      this.startGame({ seed: num, difficulty: diff, mapSize, startYear, reliability, hmap, rivals, industryRule, rivalTiming, aiLevel, terrain: terrain() });
    };
  }

  startGame(opts) {
    this.ui.closePanel();
    $('#title').hidden = true;
    const shell = $('#busy'); shell.hidden = false;
    // what is happening while the page is busy (the world is built in one go)
    const ms = opts.mapSize || (opts.save && opts.save.mapSize) || 0;
    $('#busy-text').textContent = opts.save ? t('busy_loading') : t('busy_world', { n: ms ? `${ms}×${ms}` : '' }).trim();
    setTimeout(() => {
      let data = opts.save;
      if (data) {
        // keep an untouched copy of any older save before migrating it
        if ((data.saveVersion | 0) > 0 && (data.saveVersion | 0) < SAVE_VERSION) this.store.put('pre_v' + SAVE_VERSION, data);
        data = migrate(JSON.parse(JSON.stringify(data)));
        const err = validate(data);
        if (!data || err) { shell.hidden = true; this.loadFailed(); return; }
        opts = { ...opts, save: data };
      }
      try {
        if (this.title) { this.title.dispose(); this.title = null; }
        const t0 = performance.now();
        this.game = new Game({ renderer: this.renderer, audio: this.audio, settings: this.settings, store: this.store, ui: this.ui, app: this }, opts);
        this.startMs = Math.round(performance.now() - t0);
        log.info('start', opts.save ? 'save loaded' : 'world built', { ms: this.startMs, map: this.game.mapSize });
      } catch (e) {
        console.error('Game start failed', e);
        shell.hidden = true;
        if (this.game) { try { this.game.dispose(); } catch (e2) { /* ignore */ } this.game = null; }
        if (opts.save) this.loadFailed(); else { this.showTitle(); this.ui.error('err_generic'); }
        return;
      }
      shell.hidden = true;
      this.ui.attach(this.game);
      this.game.running = true;
      this.resize();
      if (this.game.offline) this.ui.welcomeBack(this.game.offline, (mul) => { if (mul > 1) this.game.offline.coins *= mul; this.game.claimOffline(); });
      this.game.save(!opts.save);
      this.save = null;
    }, 30);
  }

  async loadFailed() {
    const backup = await this.store.get('backup');
    const w = this.ui.modal(`<h2>${t('load_failed')}</h2><p>${t('load_failed_desc')}</p><div class="row end wrap">
      ${backup && !validate(migrate(backup) || {}) ? `<button class="btn primary" data-mbtn="backup">${t('load_backup')}</button>` : ''}
      <button class="btn" data-mbtn="list">${t('backups')}</button><button class="btn danger" data-mbtn="new">${t('start_fresh')}</button></div>`);
    w.querySelector('[data-mbtn=list]').onclick = () => { w.remove(); this.backupDialog(); };
    const b = w.querySelector('[data-mbtn=backup]');
    if (b) b.onclick = () => { w.remove(); this.startGame({ save: backup }); };
    w.querySelector('[data-mbtn=new]').onclick = async () => { w.remove(); await this.store.remove('main'); try { localStorage.removeItem('tracklands.save'); } catch (e) { /* ignore */ } this.save = null; this.showTitle(); };
    if (!this.title) this.showTitle();
    $('#title').hidden = false;
  }

  async toTitle() {
    if (!this.game) return;
    await this.game.save();
    await this.backupNow('title');
    this.save = this.game.testMode ? await this.loadNewestSave() : this.game.serialize();
    this.ui.detach();
    this.game.dispose();
    this.game = null;
    this.showTitle();
  }

  // ---------- save safety (src/save/Backups.js) ----------
  // a backup now (every few minutes of play, leaving to the title, before an import)
  async backupNow(reason = 'auto', data = null) {
    if (!this.backups) return null;
    if (!data) { if (!this.game || this.game.testMode) return null; data = this.game.serialize(); }
    return this.backups.snapshot(data, reason, this.settings.backups ?? 5);
  }
  // after an uncaught error in a running game: keep one snapshot and say so next time
  crashSnapshot(e) {
    if (!this.game || this.game.testMode || this._crashSaved) return;
    this._crashSaved = true;
    try {
      const d = this.game.serialize();
      this.store.put('crash', d);
      localStorage.setItem('tracklands.crash', JSON.stringify({ at: Date.now(), msg: String(e && e.message || e).slice(0, 120) }));
    } catch (x) { /* nothing more to do */ }
  }
  // a notice after a session that ended with an error
  crashNotice() {
    let c = null;
    try { c = JSON.parse(localStorage.getItem('tracklands.crash') || 'null'); } catch (e) { c = null; }
    if (!c) return;
    try { localStorage.removeItem('tracklands.crash'); } catch (e) { /* ignore */ }
    const w = this.ui.modal(`<h2>${t('crash_title')}</h2><p>${t('crash_desc')}</p><div class="row end wrap"><button class="btn" data-mbtn="bk">${t('backups')}</button><button class="btn primary" data-mbtn="ok">${t('ok')}</button></div>`, { onCancel: () => {} });
    w.querySelector('[data-mbtn=ok]').onclick = () => w.remove();
    w.querySelector('[data-mbtn=bk]').onclick = () => { w.remove(); this.backupDialog(); };
  }
  // the list of backups (and the crash snapshot): restore any of them
  async backupDialog() {
    const list = (await this.backups.index()).sort((a, b) => b.savedAt - a.savedAt);
    const crash = await this.store.get('crash');
    const when = (ms) => new Date(ms).toLocaleString(getLang() === 'de' ? 'de-DE' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' });
    const row = (key, e) => `<div class="fin-row"><span><b>${when(e.savedAt)}</b> <small class="muted">${t('bk_reason_' + (e.reason || 'auto'))}</small><br><small>${t('bk_summary', { y: e.year, lvl: e.level, c: fmt(e.coins), n: e.trains })}</small></span><button class="btn small" data-bk="${key}">${t('bk_restore')}</button></div>`;
    const rows = list.map((e) => row(e.key, e)).join('') + (crash && !crash.corrupt ? row('crash', { ...this.backups.summary(crash), reason: 'crash', savedAt: crash.savedAt || Date.now() }) : '');
    const w = this.ui.modal(`<h2>${t('backups')}</h2><p class="muted small">${t('bk_help', { n: this.settings.backups ?? 5 })}</p><div class="fin-list">${rows || `<p class="muted">${t('bk_none')}</p>`}</div><div class="row end wrap">${this.game && !this.game.testMode ? `<button class="btn" data-mbtn="now">${t('bk_now')}</button>` : ''}<button class="btn primary" data-mbtn="ok">${t('ok')}</button></div>`, { onCancel: () => {} });
    w.querySelector('[data-mbtn=ok]').onclick = () => w.remove();
    const now = w.querySelector('[data-mbtn=now]');
    if (now) now.onclick = async () => { await this.backupNow('manual'); w.remove(); this.ui.toast(t('bk_done'), 'good', 'check'); this.backupDialog(); };
    w.querySelectorAll('[data-bk]').forEach((b) => { b.onclick = async () => {
      const key = b.dataset.bk;
      const d = key === 'crash' ? (() => { const m = migrate(crash); return m && !validate(m) ? m : null; })() : await this.backups.load(key);
      if (!d) { this.ui.error('err_save_invalid'); return; }
      if (!(await this.ui.confirm(t('bk_confirm'), t('bk_restore'), true))) return;
      w.remove();
      // the game being replaced is kept as a backup first
      if (this.game && !this.game.testMode) await this.backupNow('before_restore');
      await this.store.put('main', d);
      try { localStorage.setItem('tracklands.save', JSON.stringify(d)); } catch (e) { /* ignore */ }
      if (this.game) { this.ui.detach(); this.game.dispose(); this.game = null; }
      this.ui.closePanel();
      this.startGame({ save: d });
    }; });
  }

  flushSave() {
    if (!this.game || this.game.testMode) return;
    try {
      const d = this.game.serialize();
      localStorage.setItem('tracklands.save', JSON.stringify(d));
      this.store.put('main', d);
    } catch (e) { log.warn('save', 'flush failed', String(e && e.message || e)); }
  }

  onVisibility() {
    if (document.hidden) {
      this.hiddenAt = Date.now();
      this.flushSave();
      this.audio.suspend();
    } else {
      this.audio.resume();
      if (this.game && this.hiddenAt && Date.now() - this.hiddenAt > 60000) {
        const o = this.game.computeOffline({ savedAt: this.hiddenAt });
        if (o) { this.game.offline = o; this.ui.welcomeBack(o, () => this.game.claimOffline()); }
      }
      this.last = performance.now();
    }
  }

  async resetGame() {
    await this.store.remove('main');
    await this.store.remove('backup');
    try { localStorage.removeItem('tracklands.save'); localStorage.removeItem('tracklands.backup'); } catch (e) { /* ignore */ }
    if (this.game) { this.ui.detach(); this.game.dispose(); this.game = null; }
    this.save = null;
    this.ui.closePanel();
    if (!this.title) this.showTitle(); else this.renderTitle();
    $('#title').hidden = false;
  }

  foundLegacy() {
    const g = this.game;
    const P = g.progression;
    const legacy = { count: P.legacy.count + 1, achievements: [...P.achievements], owned: [...P.owned] };
    this.ui.detach();
    g.dispose();
    this.game = null;
    this.startGame({ seed: Math.floor(Math.random() * 1e9), difficulty: g.difficultyId, legacy, mapSize: g.mapSize });
  }

  exportSave() {
    const d = this.game.serialize();
    const text = exportText(d);
    const w = this.ui.modal(`<h2>${t('export_save')}</h2><p class="muted">${t('export_desc')}</p><textarea class="inp code" readonly rows="5">${escapeHtml(text)}</textarea>
      <div class="row end wrap"><button class="btn ghost" data-mbtn="copy">${t('copy')}</button><button class="btn" data-mbtn="file">${t('download_file')}</button><button class="btn primary" data-mbtn="ok">${t('ok')}</button></div>`, { onCancel: () => {} });
    const ta = w.querySelector('textarea');
    w.querySelector('[data-mbtn=copy]').onclick = async () => { ta.select(); try { await navigator.clipboard.writeText(text); } catch (e) { document.execCommand('copy'); } this.ui.toast(t('copied'), 'good'); };
    w.querySelector('[data-mbtn=file]').onclick = () => downloadJSON(d, `tracklands-${new Date().toISOString().slice(0, 10)}.json`);
    w.querySelector('[data-mbtn=ok]').onclick = () => w.remove();
  }

  importSave() {
    const w = this.ui.modal(`<h2>${t('import_save')}</h2><p class="muted">${t('import_desc')}</p><textarea class="inp code" rows="5" placeholder="TRKL1:..."></textarea>
      <input type="file" accept=".json,application/json,text/plain" class="inp"/>
      <div class="row end"><button class="btn ghost" data-mbtn="no">${t('cancel')}</button><button class="btn primary" data-mbtn="go">${t('import_save')}</button></div>`, { onCancel: () => {} });
    const ta = w.querySelector('textarea');
    w.querySelector('input[type=file]').onchange = (e) => { const f = e.target.files[0]; if (f) f.text().then((s) => { ta.value = s; }); };
    w.querySelector('[data-mbtn=no]').onclick = () => w.remove();
    w.querySelector('[data-mbtn=go]').onclick = async () => {
      const raw = importText(ta.value);
      const oldVersion = raw && typeof raw === 'object' ? raw.saveVersion | 0 : 0;
      const original = oldVersion > 0 && oldVersion < SAVE_VERSION ? JSON.parse(JSON.stringify(raw)) : null;
      const data = migrate(raw);
      const err = data ? validate(data) : 'err_save_invalid';
      if (err) { this.ui.error(err); return; }
      if (!(await this.ui.confirm(t('confirm_import'), t('import_save'), true))) return;
      w.remove();
      await this.backupNow('before_import');
      if (original) await this.store.put('pre_v' + SAVE_VERSION, original);
      await this.store.put('main', data);
      await this.store.put('backup', data);
      try { localStorage.setItem('tracklands.save', JSON.stringify(data)); } catch (e2) { /* ignore */ }
      if (this.game) { this.ui.detach(); this.game.dispose(); this.game = null; }
      this.ui.closePanel();
      this.startGame({ save: data });
    };
  }
}

const app = new App();
window.__tracklands = app;
app.boot().catch((e) => { console.error(e); app.fatal(t('err_generic')); });
export { getLang };
