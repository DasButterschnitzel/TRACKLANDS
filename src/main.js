// Application bootstrap: renderer, settings, persistence, title screen,
// new game / continue / import flows, render loop, PWA registration.
import * as THREE from 'three';
import { Game } from './Game.js';
import { UI } from './ui/UI.js';
import { AudioEngine } from './audio/Audio.js';
import { SaveStore, migrate, validate, exportText, importText, downloadJSON } from './save/Save.js';
import { TitleScene } from './title/TitleScene.js';
import { t, setLang, detectLang, getLang } from './i18n.js';
import { hashStr, fmt, fmtTime, escapeHtml } from './util.js';
import { icon } from './ui/icons.js';
import { DIFFICULTY } from './config.js';

const SETTINGS_KEY = 'tracklands.settings';
const DEFAULTS = {
  volMaster: 0.8, volMusic: 0.6, volSfx: 0.8, volAmb: 0.6, music: true,
  graphics: 'high', shadows: 'medium', particles: 'high', dayNight: true, weather: true, labels: true,
  cameraMotion: true, screenShake: true, reducedMotion: false, highContrast: false, uiScale: 1, lang: null, tutorial: true,
};

function loadSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; } catch (e) { s = {}; }
  const out = { ...DEFAULTS };
  for (const k in DEFAULTS) if (s[k] !== undefined && typeof s[k] === typeof DEFAULTS[k] || (k === 'lang' && typeof s[k] === 'string')) out[k] = s[k];
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches && s.reducedMotion === undefined) out.reducedMotion = true;
  if (s.graphics === undefined && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)) { out.graphics = 'medium'; out.shadows = 'low'; out.particles = 'medium'; }
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
    this.audio = new AudioEngine({ get settings() { return app.settings; }, get env() { return app.game && app.game.env; }, get trains() { return app.game && app.game.trains; }, get progression() { return app.game && app.game.progression; } });
  }

  async boot() {
    const canvas = $('#view');
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.settings.graphics !== 'low', powerPreference: 'high-performance' });
    } catch (e) { this.fatal(t('err_webgl')); return; }
    if (!this.renderer.capabilities.isWebGL2) { this.fatal(t('err_webgl')); return; }
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.flushSave(); this.ui && this.ui.toast(t('err_generic'), 'error'); });
    canvas.addEventListener('webglcontextrestored', () => location.reload());
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.applyPixelRatio();
    this.ui = new UI(this);
    this.applyUiSettings();
    this.ui.relocalize();
    await this.store.init();
    this.save = await this.loadNewestSave();
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => this.onVisibility());
    window.addEventListener('pagehide', () => this.flushSave());
    document.addEventListener('pointerdown', () => this.audio.unlock(), { once: true });
    this.showTitle();
    this.last = performance.now();
    requestAnimationFrame((ts) => this.loop(ts));
    $('#loading').classList.add('done');
    setTimeout(() => $('#loading').remove(), 800);
    if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./service-worker.js').catch(() => {});
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

  applyPixelRatio() {
    const q = this.settings.graphics;
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
  }

  loop(ts) {
    const dt = Math.min(0.1, (ts - this.last) / 1000);
    this.last = ts;
    if (dt > 0) this.fps = this.fps * 0.95 + (1 / dt) * 0.05;
    try {
      if (this.game) this.game.frame(dt);
      else if (this.title) { this.title.render(dt); this.audio.update(dt); }
    } catch (e) { console.error(e); }
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
        ${has ? `<button class="btn big" data-t="new">${t('new_game')}</button>` : ''}
        <button class="btn" data-t="settings">${icon('settings')} ${t('settings')}</button>
        <button class="btn" data-t="stats">${icon('stats')} ${t('menu_stats')}</button>
        <button class="btn" data-t="credits">${t('credits')}</button>
      </div></div>`;
    $('#title').querySelectorAll('[data-t]').forEach((b) => { b.onclick = () => { this.audio.unlock(); this.audio.play('click'); this.titleAction(b.dataset.t); }; });
  }
  onRelocalize() { if (this.title && !this.game) this.renderTitle(); }

  titleAction(a) {
    if (a === 'continue') this.startGame({ save: this.save });
    else if (a === 'new') this.newGameDialog();
    else if (a === 'settings') this.ui.openPanel('settings');
    else if (a === 'credits') this.ui.openPanel('credits');
    else if (a === 'stats') {
      const S = this.save && this.save.stats;
      const rows = S ? [['stat_deliveries', fmt(S.deliveries)], ['stat_passengers', fmt(S.passengers)], ['stat_coinsEarned', fmt(S.coinsEarned)], ['stat_trainsBought', S.trainsBought], ['stat_track', fmt(S.trackBuilt)], ['stat_regionsUnlocked', S.regionsUnlocked], ['stat_playTime', fmtTime(S.playTime)]] : [];
      const w = this.ui.modal(`<h2>${t('menu_stats')}</h2>${S ? `<div class="stats">${rows.map(([k, v]) => `<div><span>${t(k)}</span><b>${v}</b></div>`).join('')}</div>` : `<p class="muted">${t('none_yet')}</p>`}<div class="row end"><button class="btn primary" data-mbtn="ok">${t('ok')}</button></div>`, { onCancel: () => {} });
      w.querySelector('[data-mbtn=ok]').onclick = () => w.remove();
    }
  }

  newGameDialog() {
    const seed = String(Math.floor(Math.random() * 1e9));
    const w = this.ui.modal(`<h2>${t('new_game')}</h2>
      ${this.save ? `<p class="card warn">${icon('warn')} ${t('new_game_overwrite')}</p>` : ''}
      <label class="set"><span>${t('world_seed')}</span><span class="row"><input class="inp" id="ng-seed" value="${seed}" maxlength="24"/><button class="btn ghost" id="ng-rand">${t('random')}</button></span></label>
      <div class="diffs">${Object.keys(DIFFICULTY).map((d) => `<label class="diff"><input type="radio" name="diff" value="${d}" ${d === 'standard' ? 'checked' : ''}/><b>${t('diff_' + d)}</b><small>${t('diff_' + d + '_desc')}</small></label>`).join('')}</div>
      <div class="row end"><button class="btn ghost" data-mbtn="no">${t('cancel')}</button><button class="btn primary" data-mbtn="go">${t('start_journey')}</button></div>`, { onCancel: () => {} });
    w.querySelector('#ng-rand').onclick = () => { w.querySelector('#ng-seed').value = String(Math.floor(Math.random() * 1e9)); };
    w.querySelector('[data-mbtn=no]').onclick = () => w.remove();
    w.querySelector('[data-mbtn=go]').onclick = () => {
      const raw = w.querySelector('#ng-seed').value.trim() || seed;
      const num = /^\d+$/.test(raw) ? parseInt(raw, 10) % 4294967296 : hashStr(raw);
      const diff = w.querySelector('input[name=diff]:checked').value;
      w.remove();
      this.startGame({ seed: num, difficulty: diff });
    };
  }

  startGame(opts) {
    this.ui.closePanel();
    $('#title').hidden = true;
    const shell = $('#busy'); shell.hidden = false;
    setTimeout(() => {
      let data = opts.save;
      if (data) {
        data = migrate(JSON.parse(JSON.stringify(data)));
        const err = validate(data);
        if (!data || err) { shell.hidden = true; this.loadFailed(); return; }
        opts = { ...opts, save: data };
      }
      try {
        if (this.title) { this.title.dispose(); this.title = null; }
        this.game = new Game({ renderer: this.renderer, audio: this.audio, settings: this.settings, store: this.store, ui: this.ui }, opts);
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
      <button class="btn danger" data-mbtn="new">${t('start_fresh')}</button></div>`);
    const b = w.querySelector('[data-mbtn=backup]');
    if (b) b.onclick = () => { w.remove(); this.startGame({ save: backup }); };
    w.querySelector('[data-mbtn=new]').onclick = async () => { w.remove(); await this.store.remove('main'); try { localStorage.removeItem('tracklands.save'); } catch (e) { /* ignore */ } this.save = null; this.showTitle(); };
    if (!this.title) this.showTitle();
    $('#title').hidden = false;
  }

  async toTitle() {
    if (!this.game) return;
    await this.game.save();
    this.save = this.game.serialize();
    this.ui.detach();
    this.game.dispose();
    this.game = null;
    this.showTitle();
  }

  flushSave() {
    if (!this.game) return;
    try {
      const d = this.game.serialize();
      localStorage.setItem('tracklands.save', JSON.stringify(d));
      this.store.put('main', d);
    } catch (e) { /* quota or unavailable */ }
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
    this.startGame({ seed: Math.floor(Math.random() * 1e9), difficulty: g.difficultyId, legacy });
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
      const data = migrate(raw);
      const err = data ? validate(data) : 'err_save_invalid';
      if (err) { this.ui.error(err); return; }
      if (!(await this.ui.confirm(t('confirm_import'), t('import_save'), true))) return;
      w.remove();
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
