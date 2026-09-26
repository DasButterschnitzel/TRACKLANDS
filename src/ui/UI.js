// DOM user interface: HUD, toolbars, panels, inspector, world labels, toasts,
// modals, tooltips and the debug overlay. All strings come from i18n.
import * as THREE from 'three';
import { N, TILE, fmt, fmtTime, escapeHtml, tileCX, tileCZ, tx, tz, idx, clamp } from '../util.js';
import { ROAD_COSTS, ROAD_VEHICLES,
  CARGO, CARGO_IDS, LOCOS, RESEARCH, RESEARCH_CATS, REGIONS, OBJECTIVES, ACHIEVEMENTS, LIVERIES, STATION_STYLES, DECORATIONS,
  TRACK_TIERS, WAGONS, TOWN_ACCEPTS, INDUSTRIES, TRAIN_UPGRADES, TRAIN_UPGRADE_MAX, STATION, COSTS, ERA_RESEARCH, CREATOR_NAME, GAME_VERSION,
  LEGACY_LEVEL, TOWN_POP, INDUSTRY_LEVEL_THRESH, KMH_PER_TILE_S, locoLen,
} from '../config.js';
import { t as i18n, setLang, getLang, LANGS } from '../i18n.js';
import { icon, cargoIcon } from './icons.js';
import { networkMapSVG } from './NetworkMap.js';
import { locoModel } from '../trains/Trains.js';
import { locoGeometry, wagonGeometry, liveryColors } from '../trains/TrainModels.js';
import { MATS } from '../core/ModelBuilder.js';
import { MonetizationService } from '../services/Monetization.js';
import { RailUIMixin } from './RailUI.js';
import { HandbookMixin } from './Handbook.js';
import { LiveryEditorMixin } from './LiveryEditor.js';
import { FinanceUIMixin } from './FinanceUI.js';
import { RoadUIMixin } from './RoadUI.js';
import { IndustryUIMixin } from './IndustryUI.js';
import { NewsUIMixin } from './NewsUI.js';
import { DriverUIMixin } from './DriverUI.js';
import { ScenarioUIMixin } from './ScenarioMenu.js';
import { roadModel, STOP_KINDS } from '../road/Roads.js';
import { AuthorityUIMixin } from './AuthorityUI.js';
import { LineUIMixin } from './LineUI.js';
import { TransportUIMixin } from './TransportUI.js';
import { log } from '../core/Log.js';
import { WEATHER } from '../world/Environment.js';
import { COMPANY_COLORS } from '../world/Company.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = escapeHtml;

export class UI {
  constructor(app) {
    this.app = app;          // main app (settings, store, actions)
    this.game = null;
    this.panel = null;
    this.handlers = {};
    this.floats = [];
    this.labels = new Map();
    this.previews = new Map();
    this._v = new THREE.Vector3();
    this._liveT = 0;
    this._coinsShown = 0;
    this.hud = $('#hud');
    this.bindGlobal();
  }

  tr(key, p) { return i18n(key, p); }
  cargoName(c) { return this.tr('cargo_' + c); }

  attach(game) {
    this.game = game;
    this.renderHud();
    this.hud.hidden = false;
    this._coinsShown = game.economy.coins;
    const E = game.events;
    E.on('tool', () => this.renderToolbar());
    E.on('buildstate', () => this.renderToolbar());
    E.on('undo', () => this.renderToolbar());
    E.on('speed', () => this.renderTop());
    E.on('grant', () => this.renderGrant());
    E.on('select', () => {});
    E.on('saved', () => { const s = $('#save-dot'); if (s) { s.classList.remove('flash'); void s.offsetWidth; s.classList.add('flash'); } });
    for (const ev of ['research', 'levelUp', 'regionUnlocked', 'contractDone', 'contractClaimed', 'achievement', 'objectiveDone', 'trainBought', 'trainSold', 'dailyClaimed', 'stationUpgraded']) E.on(ev, () => this.refreshPanel());
    this.renderGrant();
    this.bindPreviews();
    E.on('overlay', () => this.renderToolbar());
    E.on('consistChanged', () => { if (this.panel === 'builder') this.refreshPanel(); });
  }

  detach() {
    if (this.driveId != null) this.stopDrive();
    this.game = null;
    this.hud.hidden = true;
    this.closePanel(); this.showInspector(null);
    $('#labels').innerHTML = ''; this.labels.clear();
    $('#floats').innerHTML = ''; this.floats = [];
  }

  // ---------- global delegation ----------
  bindGlobal() {
    document.addEventListener('click', (e) => {
      const el = e.target.closest('[data-act]');
      if (!el || el.disabled) return;
      const act = el.dataset.act;
      const h = this.handlers[act] || this.actions[act];
      if (h) { e.preventDefault(); this.app.audio.unlock(); h.call(this, el.dataset.arg, el, e); if (!el.dataset.silent) this.app.audio.play('click'); }
    });
    // Enter/Space activate role="button" controls that are not <button>s (SVG map stations)
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const el = e.target && e.target.closest && e.target.closest('[role="button"][data-act]');
      if (!el || el.tagName === 'BUTTON') return;
      e.preventDefault();
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    document.addEventListener('input', (e) => {
      const el = e.target.closest('[data-input]');
      if (!el) return;
      const h = this.inputs[el.dataset.input];
      if (h) h.call(this, el);
    });
    document.addEventListener('change', (e) => {
      const el = e.target.closest('[data-change]');
      if (!el) return;
      const h = this.inputs[el.dataset.change];
      if (h) h.call(this, el);
    });
    // tooltips (hover on desktop, long press on touch)
    const tip = $('#tooltip');
    let lpTimer = 0;
    document.addEventListener('pointerover', (e) => {
      const el = e.target.closest('[data-tip]');
      if (!el || e.pointerType !== 'mouse') return;
      this.showTip(el);
    });
    document.addEventListener('pointerout', (e) => { if (e.target.closest('[data-tip]')) tip.hidden = true; });
    document.addEventListener('pointerdown', (e) => {
      const el = e.target.closest('[data-tip]');
      clearTimeout(lpTimer);
      tip.hidden = true;
      if (el && e.pointerType !== 'mouse') lpTimer = setTimeout(() => this.showTip(el), 450);
    });
    document.addEventListener('pointerup', () => clearTimeout(lpTimer));
  }
  showTip(el) {
    const tip = $('#tooltip');
    tip.textContent = el.dataset.tip;
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = r.left + r.width / 2 - tw / 2, y = r.top - th - 8;
    if (y < 4) y = r.bottom + 8;
    tip.style.left = clamp(x, 4, window.innerWidth - tw - 4) + 'px';
    tip.style.top = y + 'px';
  }

  // ---------- HUD ----------
  renderHud() {
    this.renderTop();
    this.renderRail();
    this.renderToolbar();
  }

  renderTop() {
    const g = this.game; if (!g) return;
    const P = g.progression;
    const sp = [0, 1, 2, 4].map((s) => `<button class="spd ${g.speed === s ? 'on' : ''}" data-act="speed" data-arg="${s}" aria-label="${this.tr(s ? 'speed_x' : 'pause', { n: s })}" data-tip="${this.tr(s ? 'speed_x' : 'pause', { n: s })}">${s ? s + '×' : icon('pause')}</button>`).join('');
    $('#topbar').innerHTML = `
      <button class="menu-btn" data-act="toggleMenu" aria-label="${this.tr('menu')}">${icon('menu')}</button>
      <button class="lvl" data-act="panel" data-arg="company" data-tip="${this.tr('company_level')}">
        <span class="lvl-num" id="lvl-num">${P.level}</span>
        <span class="lvl-bar"><span id="xp-fill"></span></span>
      </button>
      <button class="res coins" data-act="panel" data-arg="finance" data-tip="${this.tr('menu_finance')}">${icon('coin')}<span class="cv"><span id="coins-v">${fmt(g.economy.coins)}</span><small id="date-v">${this.monthName(g.ledger.monthIndex())}</small></span></button>
      <button class="res rp" data-act="panel" data-arg="research" data-tip="${this.tr('research_points')}">${icon('rp')}<span id="rp-v">${P.rp}</span></button>
      <button class="res wx" id="wx" data-act="weatherInfo" aria-label="${this.tr('weather')}"></button>
      <div class="spacer"></div>
      <div class="speeds" role="group" aria-label="${this.tr('game_speed')}">${sp}</div>
      <span id="save-dot" class="save-dot" data-tip="${this.tr('autosave')}"></span>
      <button class="icon-btn" data-act="panel" data-arg="settings" aria-label="${this.tr('settings')}">${icon('settings')}</button>`;
    this.updateTop(true);
  }

  updateTop(force) {
    const g = this.game; if (!g) return;
    const P = g.progression;
    const c = g.economy.coins;
    this._coinsShown += (c - this._coinsShown) * (force ? 1 : 0.2);
    if (Math.abs(c - this._coinsShown) < 1) this._coinsShown = c;
    const cv = $('#coins-v'); if (cv) cv.textContent = fmt(this._coinsShown);
    const dv = $('#date-v'); if (dv) { const m = g.ledger.monthIndex(); if (dv._m !== m) { dv._m = m; dv.textContent = this.monthName(m); } }
    const rv = $('#rp-v'); if (rv) rv.textContent = P.rp;
    const wx = $('#wx');
    if (wx) {
      const E = g.env, st = g.settings.weather ? E.weather : 'clear', key = st + E.season() + E.forecast + g.settings.weather;
      if (wx._k !== key) { wx._k = key; wx.innerHTML = `${icon('w_' + st)}<small>${this.tr('season_' + E.season())}</small>`; wx.dataset.tip = this.weatherText(); wx.setAttribute('aria-label', this.weatherText()); }
    }
    const ln = $('#lvl-num'); if (ln) ln.textContent = P.level;
    const xf = $('#xp-fill'); if (xf) xf.style.width = Math.min(100, (P.xp / P.xpNeeded()) * 100) + '%';
    const lvlBtn = $('.lvl'); if (lvlBtn) lvlBtn.dataset.tip = `${this.tr('company_level')} ${P.level} · ${fmt(P.xp)}/${fmt(P.xpNeeded())} XP`;
  }

  renderRail() {
    const items = ['company', 'finance', 'trains', 'news', 'lists', 'research', 'objectives', 'contracts', 'collection', 'map', 'achievements', 'handbook', 'settings'];
    $('#menu-rail').innerHTML = items.map((k) => `<button class="rail-btn" data-act="panel" data-arg="${k}" data-tip="${this.tr('menu_' + k)}" aria-label="${this.tr('menu_' + k)}">${icon(k === 'finance' ? 'coin' : k)}<span>${this.tr('menu_' + k)}</span><i class="badge" id="badge-${k}" hidden></i></button>`).join('');
  }

  renderToolbar() {
    const g = this.game; if (!g) return;
    const C = g.construction;
    const tools = [['select', 'select'], ['track', 'track'], ['station', 'station'], ['depot', 'depot'], ['train', 'train'], ['road', 'road'], ['roadstop', 'bus'], ['line', 'route'], ['industry', 'factory'], ['bulldoze', 'bulldoze'], ['decor', 'decor'], ['signal', 'signal'], ['waypoint', 'waypoint']];
    const KEYS = { select: 1, track: 2, station: 3, depot: 4, train: 5, bulldoze: 6, decor: 7, signal: 8, waypoint: 9, road: 'R', roadstop: 'B', line: 'L', industry: 'I' };
    const btn = ([id, ic]) => `<button id="tool-${id}" class="tool ${C.tool === id ? 'on' : ''}" data-act="tool" data-arg="${id}" data-tip="${this.tr('tool_' + id)} (${KEYS[id]})" aria-label="${this.tr('tool_' + id)}" aria-pressed="${C.tool === id}">${icon(ic)}<span>${this.tr('tool_' + id)}</span></button>`;
    const ov = g.overlays.mode;
    const undo = C.canUndo();
    const menuOpen = $('#overlay-menu') && !$('#overlay-menu').hidden;
    $('#toolbar').innerHTML = `<div class="tools">${tools.map(btn).join('')}</div>
      <div class="tools2">
        <button class="tool small ${ov ? 'on' : ''}" data-act="overlayMenu" data-tip="${this.tr('overlays')} (O)${ov ? ' · ' + this.tr('ov_' + ov) : ''}" aria-label="${this.tr('overlays')}">${icon('layers')}</button>
        <button class="tool small undo ${undo ? 'ready' : ''}" data-act="undo" ${undo ? '' : 'disabled'} data-tip="${this.tr('undo')} (Ctrl+Z)" aria-label="${this.tr('undo')}">${icon('undo')}<i class="undo-t" id="undo-t"></i></button>
      </div><div id="overlay-menu" ${menuOpen ? '' : 'hidden'}></div>`;
    if (menuOpen) this.renderOverlayMenu();
    // narrow screens: the tool strip scrolls; keep the active tool in view and
    // show which side has more tools
    const strip = $('#toolbar .tools');
    if (strip) {
      const edges = () => { strip.classList.toggle('more-l', strip.scrollLeft > 2); strip.classList.toggle('more-r', strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 2); };
      const on = strip.querySelector('.tool.on');
      if (on && strip.scrollWidth > strip.clientWidth) strip.scrollLeft = Math.max(0, Math.min(on.offsetLeft - strip.clientWidth / 2 + on.offsetWidth / 2, strip.scrollWidth - strip.clientWidth));
      strip.addEventListener('scroll', edges, { passive: true });
      this._stripEdges = edges;
      edges();
    }
    // contextual sub bar
    let sub = '';
    if (C.tool === 'track') {
      sub = TRACK_TIERS.map((t, i) => {
        const locked = t.research && !g.progression.research.has(t.research);
        return `<button class="chip ${C.tier === i ? 'on' : ''} ${locked ? 'locked' : ''}" data-act="tier" data-arg="${i}" data-tip="${locked ? this.tr('requires') + ': ' + this.tr('res_' + t.research) : this.tr('tier_' + t.id + '_desc')}">${locked ? icon('lock') : ''}<b>${this.tr('tier_' + t.id)}</b><small>${fmt(g.economy.costs.trackTile(i, 0))}● · ${t.speed} km/h</small></button>`;
      }).join('') + `<span class="sub-sep"></span>` + ['double', 'single'].map((m) => `<button class="chip ${C.trackMode === m ? 'on' : ''}" data-act="trackMode" data-arg="${m}" data-tip="${this.tr('track_' + m + '_desc')}"><b>${this.tr('track_' + m)}</b><small>${m === 'single' ? '−35%' : this.tr('track_double_small')}</small></button>`).join('') + `<span class="sub-hint">${this.tr('hint_drag_track')}</span>`;
    } else if (C.tool === 'decor') {
      sub = DECORATIONS.map((d) => {
        const locked = !g.progression.isUnlocked(d.unlock);
        return `<button class="chip ${C.decor === d.id ? 'on' : ''} ${locked ? 'locked' : ''}" data-act="decorType" data-arg="${d.id}" ${locked ? `data-tip="${this.tr('unlock_level', { n: d.unlock.level })}"` : ''}>${locked ? icon('lock') : ''}<b>${this.tr('dec_' + d.id)}</b><small>${fmt(g.economy.costs.decor(d))}●</small></button>`;
      }).join('');
    } else if (C.tool === 'station') {
      const n = C.stationTracks || 1, mx = g.stations.maxTracks();
      sub = `<span class="sub-label">${this.tr('st_tracks')}</span><button class="icon-btn small" data-act="stTracks" data-arg="-1" ${n <= 1 ? 'disabled' : ''} aria-label="${this.tr('st_tracks_less')}">${icon('minus')}</button><b class="sub-num" aria-live="polite">${n}</b><button class="icon-btn small" data-act="stTracks" data-arg="1" ${n >= mx ? 'disabled' : ''} aria-label="${this.tr('st_tracks_more')}" data-tip="${n >= mx ? this.tr('err_tracks_research') : ''}">${icon('plus')}</button><span class="sub-sep"></span><span class="sub-hint">${icon('station')} ${this.tr('hint_station_drag', { cost: fmt(g.economy.costs.station()) })}</span>${this.helpBtn('stations')}`;
    } else if (C.tool === 'depot') {
      sub = `<span class="sub-hint">${icon('depot')} ${this.tr('hint_depot', { cost: fmt(g.economy.costs.depot()) })}</span>`;
    } else if (C.tool === 'bulldoze') {
      sub = `<span class="sub-hint">${icon('bulldoze')} ${this.tr('hint_bulldoze')}</span>`;
    } else if (C.tool === 'signal') {
      sub = ['block', 'path', 'oneway'].map((ty) => {
        const ok = C.signalUnlocked(ty);
        const res = { block: 'block_signals', path: 'path_signals', oneway: 'one_way_signals' }[ty];
        return `<button class="chip ${C.signalType === ty ? 'on' : ''} ${ok ? '' : 'locked'}" data-act="signalType" data-arg="${ty}" data-tip="${ok ? this.tr('sig_' + ty + '_desc') : this.tr('requires') + ': ' + this.tr('res_' + res)}">${ok ? '' : icon('lock')}<b>${this.tr('sig_' + ty)}</b><small>${fmt(g.economy.costs.signal())}●</small></button>`;
      }).join('') + `<span class="sub-sep"></span><span class="sub-label">${this.tr('sig_row')}</span>${[2, 3, 4, 6].map((n) => `<button class="chip mini ${C.signalSpacing === n ? 'on' : ''}" data-act="signalSpacing" data-arg="${n}" data-tip="${this.tr('sig_row_tip', { n })}"><b>${n}</b></button>`).join('')}<span class="sub-hint">${this.tr('hint_signal')}</span>${this.helpBtn('signals')}`;
    } else if (C.tool === 'road') {
      const tramOk = g.roads.kindUnlocked('tram'), rm = C.roadMode === 'tram' && tramOk ? 'tram' : 'road';
      sub = `<button class="chip ${rm === 'road' ? 'on' : ''}" data-act="roadMode" data-arg="road"><b>${icon('road', 'mini')} ${this.tr('road_mode_road')}</b><small>${fmt(Math.round(ROAD_COSTS.tile * g.economy.costs.mul()))}●</small></button>`
        + `<button class="chip ${rm === 'tram' ? 'on' : ''} ${tramOk ? '' : 'locked'}" data-act="roadMode" data-arg="tram" ${tramOk ? '' : `data-tip="${this.tr('unlock_level', { n: 4 })}"`}>${tramOk ? '' : icon('lock')}<b>${icon('tram', 'mini')} ${this.tr('road_mode_tram')}</b><small>${fmt(Math.round(ROAD_COSTS.tram * g.economy.costs.mul()))}●</small></button>`
        + `<span class="sub-hint">${this.tr(rm === 'tram' ? 'hint_tram' : 'hint_road', { cost: fmt(Math.round(ROAD_COSTS.tile * g.economy.costs.mul())) })}</span>`;
    } else if (C.tool === 'roadstop') {
      const LV = { bus: 1, truck: 1, tram: 4, dock: 6, airport: 12, garage: 1 };
      sub = STOP_KINDS.map((k) => { const on = g.roads.kindUnlocked(k); return `<button class="chip ${(C.stopKind || 'bus') === k ? 'on' : ''} ${on ? '' : 'locked'}" data-act="stopKind" data-arg="${k}" ${on ? `data-tip="${this.tr('stop_tip_' + k)}"` : `data-tip="${this.tr('unlock_level', { n: LV[k] })}"`}>${on ? '' : icon('lock')}<b>${icon(k, 'mini')} ${this.tr('tool_roadstop_' + k)}</b><small>${fmt(g.roads.stopCost(k))}●</small></button>`; }).join('') + `<span class="sub-hint">${this.tr('hint_stop_' + (C.stopKind || 'bus'))}</span>`;
    } else if (C.tool === 'industry') {
      const types = g.industries.foundTypes();
      if (!types.includes(C.fundType)) C.fundType = types[0];
      sub = types.map((k) => `<button class="chip ${C.fundType === k ? 'on' : ''}" data-act="fundType" data-arg="${k}"><b>${this.tr('ind_' + k)}</b><small>${fmt(g.industries.foundCost(k))}●</small></button>`).join('') + `<span class="sub-hint">${icon('factory')} ${this.tr('hint_found')}</span>`;
    } else if (C.tool === 'line') {
      sub = this.lineSubbar();
    } else if (C.tool === 'waypoint') {
      sub = `<span class="sub-hint">${icon('waypoint')} ${this.tr('hint_waypoint', { cost: fmt(g.economy.costs.waypoint()) })}</span>`;
    }
    // the active tool is always named, with a way out; a touch construction
    // waiting for confirmation replaces the options with Build / Cancel
    if (C.tool !== 'select' && C.tool !== 'train') {
      const mode = `<span class="sub-mode" aria-live="polite">${icon(tools.find((t) => t[0] === C.tool)?.[1] || (C.tool === 'hq' ? 'company' : 'build'), 'mini')}<b>${this.tr('tool_' + C.tool)}</b></span>`;
      const exit = `<button class="icon-btn small sub-exit" data-act="tool" data-arg="select" aria-label="${this.tr('tool_exit')}" data-tip="${this.tr('tool_exit')} (Esc)">${icon('close')}</button>`;
      const d = C.drag;
      if (d && d.touch) {
        const ready = C.touchReady();
        sub = `${mode}<span class="sub-hint bb">${this.tr(C.touchHint())}</span><button class="btn small primary bb-go" data-act="buildConfirm" ${ready ? '' : 'disabled'}>${icon('check', 'mini')} ${this.tr(C.tool === 'bulldoze' ? 'bb_demolish' : 'bb_build')}</button><button class="btn small ghost bb-cancel" data-act="buildCancel">${icon('close', 'mini')} ${this.tr('cancel')}</button>`;
      } else sub = mode + sub + exit;
    }
    // fingers: say what the next tap does (docked at the top, like the plan info)
    if (this.coarse() && C.tool !== 'select' && C.tool !== 'train' && !this._ci) this.touchHintShow(C.tool === 'line' ? this.lineHintText() : this.tr(C.touchHint()));
    else if (!this._ci) $('#cursorinfo').hidden = true;
    const sb = $('#subbar');
    sb.innerHTML = sub;
    sb.hidden = !sub;
    sb.classList.toggle('confirm', !!(C.drag && C.drag.touch));
    document.body.classList.toggle('building', C.tool !== 'select');
  }

  renderGrant() {
    const g = this.game;
    const el = $('#grant');
    if (!g || !g.economy.grantAvailable) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = `<button class="btn gold" data-act="grant">${icon('gift')} ${this.tr('grant_btn')}</button><small>${this.tr('grant_desc')}</small>`;
  }

  // ---------- per-frame ----------
  update(dt) {
    const g = this.game; if (!g) return;
    this.updateTop(false);
    if (this.followId != null) {
      // (a train id, or 'type:id' for other vehicles)
      const f = typeof this.followId === 'string' ? this.followId.split(':') : null;
      const p = g.entityPos(f ? { type: f[0], id: +f[1] } : { type: 'train', id: this.followId });
      if (p) { g.camera.target.x += (p.x - g.camera.target.x) * Math.min(1, dt * 5); g.camera.target.z += (p.z - g.camera.target.z) * Math.min(1, dt * 5); } else this.followId = null;
    }
    this.updateFloats(dt);
    this.updateDriver();
    this.updateHandles();
    this.updateStopMarks();
    this.updateLabels();
    const ut = $('#undo-t');
    if (ut) { const left = g.construction.undoTimeLeft(); ut.style.setProperty('--p', (left / 10) * 100 + '%'); }
    this._liveT -= dt;
    if (this._liveT <= 0) {
      this._liveT = 0.5;
      // live panels: not while the player is pressing something in them
      // (a rebuilt button would swallow the tap), and only when changed
      // (nor while a dropdown or text field in them has the focus)
      const fe = document.activeElement;
      const busy = performance.now() - (this._panelPressT || 0) < 1200 || !!(fe && /^(SELECT|INPUT|TEXTAREA)$/.test(fe.tagName) && fe.closest('#panel, #inspector') && fe.type !== 'checkbox' && fe.type !== 'range');
      if (this.panel && this.panelDefs[this.panel] && this.panelDefs[this.panel].live && !busy) this.refreshPanel(false, true);
      if (this.inspectSel && !busy) this.renderInspector(true);
      this.updateBadges();
      if (this.debugOn) this.renderDebug();
    }
  }

  updateBadges() {
    const g = this.game;
    const set = (k, n) => { const b = $('#badge-' + k); if (b) { b.hidden = !n; b.textContent = n > 9 ? '9+' : n; } };
    set('contracts', g.economy.contracts.filter((k) => k.done && !k.claimed).length + (g.economy.daily ? g.economy.daily.list.filter((d) => !d.claimed && g.economy.dailyProgress(d) >= d.target).length : 0));
    set('research', g.progression.researchAvailable() ? RESEARCH.filter((r) => g.progression.researchState(r.id) === 'available').length : 0);
    const nr = g.progression.nextRegion();
    set('objectives', nr >= 0 && g.progression.regionUnlockInfo(nr).ok ? 1 : 0);
    set('news', this.panel === 'news' ? 0 : g.news.unread);
    // urgent transport problems (no popups: a number on the Transport button)
    set('trains', g.transport ? g.transport.problems().filter((p) => p.sev === 'bad').length : 0);
  }

  // ---------- toasts, banners, floating text ----------
  toast(text, kind = 'info', ic = null) {
    const box = $('#toasts');
    // no stacks of identical messages
    for (const el of box.children) if (el.dataset.text === text && !el.classList.contains('out')) return;
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.dataset.text = text;
    el.innerHTML = `${ic ? icon(ic) : kind === 'error' ? icon('warn') : icon('info')}<span>${esc(text)}</span>`;
    el.setAttribute('role', 'status');
    box.appendChild(el);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, kind === 'error' ? 2600 : 3600);
  }
  error(key, p) { this.toast(this.tr(key || 'err_generic', p), 'error'); this.app.audio.play(key && key.startsWith('err_permit') ? 'reject' : 'error'); }
  hint(text) { this.toast(text, 'hint', 'info'); }

  // a new release is installed and waiting: offer to switch (never automatic mid-game)
  updateReady(apply) {
    let el = document.getElementById('update-ready');
    if (!el) { el = document.createElement('div'); el.id = 'update-ready'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.innerHTML = `${icon('info')}<span>${esc(this.tr('update_ready'))}</span><button class="btn small primary">${esc(this.tr('update_apply'))}</button><button class="icon-btn small" aria-label="${esc(this.tr('close'))}">${icon('close')}</button>`;
    el.querySelector('.btn').onclick = () => { el.remove(); apply(); };
    el.querySelector('.icon-btn').onclick = () => el.remove();
  }

  banner(title, desc) {
    const b = $('#banner');
    if (!title) { b.classList.remove('show'); return; }
    b.innerHTML = `<b>${esc(title)}</b><span>${esc(desc || '')}</span>`;
    b.classList.add('show');
  }

  celebrate(title, sub) {
    const c = $('#celebrate');
    c.innerHTML = `<div class="cel-title">${esc(title)}</div><div class="cel-sub">${esc(sub || '')}</div>`;
    c.classList.remove('show'); void c.offsetWidth; c.classList.add('show');
    clearTimeout(this._celT);
    this._celT = setTimeout(() => c.classList.remove('show'), 3200);
  }

  levelUp(lvl, unlocks) {
    this.celebrate(this.tr('level_up'), this.tr('company_level') + ' ' + lvl);
    for (const u of unlocks.slice(0, 4)) {
      let s;
      if (u.kind === 'train') s = this.tr('unlock_train', { name: u.name });
      else if (u.kind === 'station') s = this.tr('unlock_station', { name: this.tr('slvl_' + u.level) });
      else if (u.kind === 'region') s = this.tr('unlock_region', { name: this.tr('region_' + u.id) });
      else if (u.kind === 'research') s = this.tr('unlock_research');
      else if (u.kind === 'livery') s = this.tr('unlock_livery', { name: this.tr('liv_' + u.id) });
      else if (u.kind === 'legacy') s = this.tr('unlock_legacy');
      if (s) this.toast(s, 'gold', 'star');
    }
    const lv = $('.lvl'); if (lv) { lv.classList.remove('pop'); void lv.offsetWidth; lv.classList.add('pop'); }
  }

  floatText(x, y, z, text, cls) {
    if (this.floats.length > 40) { const f = this.floats.shift(); f.el.remove(); }
    const el = document.createElement('div');
    el.className = 'float ' + (cls || '');
    el.innerHTML = cls === 'coin' ? `${icon('coin')}${esc(text)}` : esc(text);
    $('#floats').appendChild(el);
    this.floats.push({ el, x: x + (Math.random() - 0.5) * 0.8, y: y + Math.random() * 0.4, z: z + (Math.random() - 0.5) * 0.8, t: 0 });
  }
  updateFloats(dt) {
    const cam = this.game.camera.camera;
    const W = window.innerWidth, H = window.innerHeight;
    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i];
      f.t += dt;
      if (f.t > 1.6) { f.el.remove(); this.floats.splice(i, 1); continue; }
      this._v.set(f.x, f.y + f.t * 1.5, f.z).project(cam);
      const sx = (this._v.x + 1) / 2 * W, sy = (1 - this._v.y) / 2 * H;
      f.el.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -50%)`;
      f.el.style.opacity = f.t < 1.1 ? 1 : 1 - (f.t - 1.1) / 0.5;
    }
  }

  cursorInfo(text, ok) {
    this._ci = { text, ok: !!ok };
    const el = $('#cursorinfo');
    el.hidden = false;
    el.textContent = text;
    el.className = ok ? 'ok' : 'bad';
  }
  hideCursorInfo() { this._ci = null; $('#cursorinfo').hidden = true; }
  coarse() { return !!(window.matchMedia && matchMedia('(pointer: coarse)').matches); }
  touchHintShow(text) {
    const el = $('#cursorinfo');
    el.hidden = false;
    el.textContent = text;
    el.className = 'ok hint dock';
  }
  // touch construction handles: markers over the start / end of a plan that
  // a finger drags (the canvas does the hit test; these only show where)
  updateHandles() {
    const g = this.game, box = $('#bhandles');
    if (!box) return;
    const hs = g.construction.touchHandles();
    while (box.children.length > hs.length) box.lastChild.remove();
    while (box.children.length < hs.length) { const el = document.createElement('div'); el.className = 'bhandle'; el.innerHTML = '<i></i>'; box.appendChild(el); }
    hs.forEach((h, k) => {
      const el = box.children[k], p = g.input.tileScreen(h.tile);
      el.className = 'bhandle ' + h.id;
      el.style.transform = `translate(${p.x}px, ${p.y}px)`;
      el.hidden = !p.vis;
    });
  }
  pointerMoved(x, y) {
    const el = $('#cursorinfo');
    // fingers cover the spot: dock the hint at the top; the mouse keeps it
    // beside the pointer, always inside the screen
    if (matchMedia('(pointer: coarse)').matches) { el.classList.add('dock'); el.style.transform = ''; return; }
    el.classList.remove('dock');
    const w = el.offsetWidth || 200, h = el.offsetHeight || 30;
    const px = x + 18 + w > innerWidth - 8 ? x - 18 - w : x + 18;
    const py = y + 14 + h > innerHeight - 8 ? y - 14 - h : y + 14;
    el.style.transform = `translate(${Math.max(8, px)}px, ${Math.max(8, py)}px)`;
  }

  weatherText() {
    const g = this.game, E = g.env;
    if (!g.settings.weather) return `${this.tr('season_' + E.season())} · ${this.tr('weather_off')}`;
    const W = WEATHER[E.weather] || WEATHER.clear;
    const fx = [];
    if (W.speed < 1) fx.push(this.tr('wx_speed', { n: Math.round((1 - W.speed) * 100) }));
    if (W.accel < 1) fx.push(this.tr('wx_accel', { n: Math.round((1 - W.accel) * 100) }));
    const farm = g.industries.seasonMul ? g.industries.seasonMul('FARM') : 1;
    return `${this.tr('wx_' + E.weather)} · ${this.tr('season_' + E.season())}. ${fx.length ? fx.join(', ') : this.tr('wx_no_effect')}. ${farm !== 1 ? this.tr('wx_farms', { n: (farm > 1 ? '+' : '−') + Math.round(Math.abs(farm - 1) * 100) }) + ' ' : ''}${this.tr('wx_next', { w: this.tr('wx_' + E.forecast) })}`;
  }
  weatherChanged(w) {
    if (w === 'storm' || w === 'snow' || w === 'fog') this.toast(this.weatherText(), 'info', 'w_' + w);
  }

  // ---------- world labels ----------
  // the label under a screen point (topmost), if any
  labelAt(x, y) {
    const els = [...this.labels.values()];
    for (let k = els.length - 1; k >= 0; k--) {
      const el = els[k];
      if (el.hidden || el.style.display === 'none' || el.style.visibility === 'hidden' || +el.style.opacity === 0) continue;
      const r = el.getBoundingClientRect();
      if (r.width && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return el.dataset.key;
    }
    return null;
  }
  labelSelect(key) {
    const [type, id] = key.split(':');
    if (type === 'works') { this.cancelWorks(+id); return; }
    this.game.select({ type, id: +id });
  }
  label(key, cls) {
    let el = this.labels.get(key);
    if (!el) {
      el = document.createElement('div');
      el.className = 'wlabel ' + cls;
      el.dataset.key = key;
      $('#labels').appendChild(el);
      this.labels.set(key, el);
      // labels are drawn over the world but never take the pointer: a finger
      // may pan or build across them; a tap on one is resolved by labelAt()
    }
    el._used = true;
    return el;
  }
  async cancelWorks(id) {
    const W = this.game.works;
    if (!W.byId(id)) return;
    if (await this.confirm(this.tr('works_cancel_q'), this.tr('works_cancel'), true) && W.cancel(id)) this.toast(this.tr('works_cancelled'), 'info', 'track');
  }
  pulseLabel(type, id) {
    const el = this.labels.get(`${type}:${id}`);
    if (el) { el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse'); }
  }

  updateLabels() {
    const g = this.game;
    const cam = g.camera.camera;
    const vs = g.camera.viewSize;
    const W = window.innerWidth, H = window.innerHeight;
    for (const el of this.labels.values()) el._used = false;
    const place = (el, x, y, z) => {
      this._v.set(x, y, z).project(cam);
      if (this._v.x < -1.2 || this._v.x > 1.2 || this._v.y < -1.2 || this._v.y > 1.2) { el.style.display = 'none'; return false; }
      el.style.display = '';
      el._x = (this._v.x + 1) / 2 * W; el._y = (1 - this._v.y) / 2 * H;
      el.style.transform = `translate(${el._x}px, ${el._y}px) translate(-50%, -100%)`;
      order.push(el);
      return true;
    };
    const order = [];
    // pending construction sites always show (they block trains)
    if (vs < 70) for (const w of g.works.list) {
      const el = this.label('works:' + w.id, 'works');
      const sig = getLang() + w.id;
      if (el._sig !== sig) { el._sig = sig; el._w = 0; el.innerHTML = `${icon('warn', 'w')}<span>${this.tr('works_label')}</span>`; el.dataset.tip = this.tr('works_cancel'); }
      const at = g.works.anchor(w);
      if (at != null) place(el, tileCX(at), Math.max(g.net.railH(at), g.world.view.heightAt(tileCX(at), tileCZ(at))) + 1.8, tileCZ(at));
    }
    const showLabels = g.settings.labels !== false;
    if (showLabels) {
      for (const t of g.towns.list) {
        if (!g.progression.regionUnlocked(t.region) || vs > 60) continue;
        const el = this.label('town:' + t.id, 'town');
        const detail = vs < 30;
        const sig = `${t.name}|${t.stage}|${detail}|${JSON.stringify(t.progress)}|${getLang()}`;
        if (el._sig !== sig) {
          el._sig = sig;
          const req = g.towns.requirement(t);
          let bars = '';
          if (detail && req) bars = '<div class="lbars">' + Object.keys(req).map((c) => `<div class="lbar" title="${this.cargoName(c)}">${cargoIcon(c)}<i style="--p:${Math.min(100, ((t.progress[c] || 0) / req[c]) * 100)}%"></i><small>${Math.floor(t.progress[c] || 0)}/${req[c]}</small></div>`).join('') + '</div>';
          el.innerHTML = `<b>${esc(t.name)}</b><small>${this.tr('stage_' + g.towns.stageName(t))}</small>${bars}`; el._w = 0;
        }
        place(el, (t.x + 0.5) * TILE, g.world.tileH[t.z * N + t.x] + 3.2, (t.z + 0.5) * TILE);
      }
      if (vs < 26) for (const s of g.stations.list) {
        const el = this.label('station:' + s.id, 'station' + (s.warn ? ' warn' : ''));
        const sig = s.name + s.warn;
        if (el._sig !== sig) { el._sig = sig; el.innerHTML = `${icon('station')}<span>${esc(s.name)}</span>${s.warn ? icon('warn', 'w') : ''}`; el.className = 'wlabel station' + (s.warn ? ' warn' : ''); el._w = 0; }
        place(el, tileCX(s.tile), g.net.railH(s.tile) + 2.3, tileCZ(s.tile));
      }
      if (vs < 24) for (const ind of g.industries.list) {
        if (!g.progression.regionUnlocked(ind.region)) continue;
        const el = this.label('industry:' + ind.id, 'industry');
        const sig = ind.level + getLang();
        if (el._sig !== sig) { el._sig = sig; el.innerHTML = `${icon('factory')}<span>${esc(g.industries.displayName(ind))}</span>`; el._w = 0; }
        place(el, (ind.x + 1) * TILE, g.industries.baseHeight(ind) + 3.2, (ind.z + 1) * TILE);
      }
    }
    if (showLabels && vs < 22) for (const [tile, w] of g.net.waypoints) {
      const el = this.label('wp:' + tile, 'waypoint');
      if (el._sig !== w.name) { el._sig = w.name; el._w = 0; el.innerHTML = `${icon('waypoint')}<span>${esc(w.name)}</span>`; }
      place(el, tileCX(tile), g.net.railH(tile) + 1.6, tileCZ(tile));
    }
    REGIONS.forEach((r, i) => {
      if (g.progression.regionUnlocked(i)) return;
      const el = this.label('region:' + i, 'region');
      const sig = getLang() + g.progression.level;
      if (el._sig !== sig) { el._sig = sig; el.innerHTML = `${icon('lock')}<b>${this.tr('region_' + r.id)}</b><small>${this.tr('unlock_level', { n: r.level })}</small>`; }
      const c = g.world.centers[i];
      place(el, c[0] * TILE, 7, c[1] * TILE);
    });
    // de-overlap: labels placed earlier (towns > stations > industries) win
    const taken = [];
    for (const el of order) {
      if (!el._w) { el._w = el.offsetWidth; el._h = el.offsetHeight; }
      const r = { x0: el._x - el._w / 2, x1: el._x + el._w / 2, y0: el._y - el._h, y1: el._y };
      const hit = taken.some((q) => r.x0 < q.x1 && r.x1 > q.x0 && r.y0 < q.y1 && r.y1 > q.y0);
      el.classList.toggle('ovl', hit);
      if (!hit) taken.push(r);
    }
    for (const [k, el] of this.labels) if (!el._used) { el.remove(); this.labels.delete(k); }
  }

  // ---------- tutorial ----------
  tutorial(st) {
    const el = $('#tutorial');
    document.querySelectorAll('.tut-glow').forEach((e) => e.classList.remove('tut-glow'));
    if (!st) { el.hidden = true; return; }
    el.hidden = false;
    const sig = st.id + getLang();
    if (el._sig !== sig) {
      el._sig = sig;
      el.innerHTML = `<div class="tut-step">${this.tr('tutorial')} ${st.index + 1}/${st.total}</div>
        <div class="tut-title">${this.tr('tut_' + st.id)}</div><div class="tut-text">${this.tr('tut_' + st.id + '_text')}</div>
        <div class="tut-btns">${st.button ? `<button class="btn primary" data-act="tutNext">${this.tr(st.button)}</button>` : `<button class="btn ghost" data-act="tutNext">${this.tr('tut_skip_step')}</button>`}<button class="btn ghost" data-act="tutSkip">${this.tr('tut_skip')}</button></div>`;
    }
    if (st.ui) { const t = document.getElementById(st.ui); if (t) t.classList.add('tut-glow'); }
  }

  // ---------- panels ----------
  get panelDefs() {
    return {
      company: { title: 'menu_company', render: () => this.pCompany(), live: true },
      research: { title: 'menu_research', render: () => this.pResearch(), after: () => this.drawResearchLines(), wide: true },
      objectives: { title: 'menu_objectives', render: () => this.pObjectives(), live: true },
      contracts: { title: 'menu_contracts', render: () => this.pContracts(), live: true },
      collection: { title: 'menu_collection', render: () => this.pCollection() },
      map: { title: 'menu_map', render: () => this.pMap(), after: () => this.drawMinimap(), live: true },
      stats: { title: 'menu_stats', render: () => this.pStats(), live: true },
      finance: { title: 'menu_finance', render: () => this.pFinance(), live: true, wide: true },
      news: { title: 'menu_news', render: () => this.pNews(), live: true },
      lists: { title: 'menu_lists', render: () => this.pLists() },
      achievements: { title: 'menu_achievements', render: () => this.pAchievements() },
      settings: { title: 'settings', render: () => this.pSettings() },
      trainshop: { title: 'train_shop', render: () => this.pTrainShop() },
      builder: { title: 'train_builder', render: () => this.pBuilder(), wide: true },
      livery: { title: 'livery_editor', render: () => this.pLivery(), wide: true },
      trains: { title: 'menu_trains', render: () => this.pTransport(), live: true },
      credits: { title: 'credits', render: () => this.pCredits() },
      handbook: { title: 'handbook', render: () => this.pHandbook() },
    };
  }

  openPanel(name, arg) {
    if (this.panel === name && arg === undefined) { this.closePanel(); return; }
    this.panel = name; this.panelArg = arg;
    const el = $('#panel');
    el.hidden = false;
    el.classList.add('open');
    document.body.classList.add('panel-open');
    this.refreshPanel(true);
    requestAnimationFrame(() => this._stripEdges && this._stripEdges());
    this.app.audio.play('open');
    document.querySelectorAll('.rail-btn').forEach((b) => b.classList.toggle('on', b.dataset.arg === name));
    $('#menu-rail').classList.remove('open');
  }
  closePanel() {
    if (!this.panel) return;
    this.panel = null;
    const el = $('#panel');
    el.classList.remove('open');
    el.hidden = true;
    document.body.classList.remove('panel-open', 'panel-wide');
    document.querySelectorAll('.rail-btn').forEach((b) => b.classList.remove('on'));
    requestAnimationFrame(() => this._stripEdges && this._stripEdges());
  }
  refreshPanel(first, live) {
    if (!this.panel) return;
    const def = this.panelDefs[this.panel];
    const el = $('#panel');
    if (!el._pressHook) { el._pressHook = true; el.addEventListener('pointerdown', () => { this._panelPressT = performance.now(); }, true); }
    const body = $('.pbody', el);
    if (live) {
      const html = def.render();
      if (html === this._panelHtml && body) return;
      this._panelHtml = html;
      const sc = body ? body.scrollTop : 0;
      if (body) { body.innerHTML = html; body.scrollTop = sc; if (def.after) def.after(); return; }
    }
    this._panelHtml = null;
    const scroll = body ? body.scrollTop : 0;
    el.classList.toggle('wide', !!def.wide);
    document.body.classList.toggle('panel-wide', !!def.wide);
    el.innerHTML = `<div class="phead"><h2>${this.tr(def.title)}</h2><button class="icon-btn" data-act="closePanel" aria-label="${this.tr('close')}">${icon('close')}</button></div><div class="pbody">${def.render()}</div>`;
    const nb = $('.pbody', el);
    if (!first) nb.scrollTop = scroll;
    if (def.after) def.after();
  }
  closeTop() {
    const m = $('#modal-root');
    if (m.children.length) { const last = m.lastElementChild; if (last._cancel) last._cancel(); return true; }
    if (this.panel) { this.closePanel(); return true; }
    if (this.inspectSel) { this.game.select(null); return true; }
    return false;
  }

  bar(p, cls = '') { return `<div class="bar ${cls}"><i style="width:${clamp(p, 0, 1) * 100}%"></i></div>`; }

  pCompany() {
    const g = this.game, P = g.progression, S = g.stats.data, E = g.economy;
    const ev = E.event ? `<div class="card event">${icon('star')}<div><b>${this.tr('ev_' + E.event.id)}</b><small>${this.tr('ev_' + E.event.id + '_desc')} · ${fmtTime(E.event.dur - E.event.t)}</small></div></div>` : '';
    const lp = P.legendProgress();
    const legend = `<h3>${this.tr('legend_title')}</h3>${P.legend ? `<div class="card gold">${icon('star')} ${this.tr('legend_done')}</div>` : ''}<div class="checks">${Object.entries(lp).map(([k, [a, b]]) => `<div class="chk ${a >= b ? 'ok' : ''}">${icon(a >= b ? 'check' : 'lock')}<span>${this.tr('legend_' + k)}</span><small>${fmt(Math.min(a, b))}/${fmt(b)}</small></div>`).join('')}</div>`;
    const legacy = P.canFoundLegacy()
      ? `<h3>${this.tr('legacy_title')}</h3><p class="muted">${this.tr('legacy_desc', { n: P.legacy.count })}</p><button class="btn" data-act="legacy">${this.tr('legacy_btn')}</button>`
      : `<h3>${this.tr('legacy_title')}</h3><p class="muted">${this.tr('legacy_locked', { n: LEGACY_LEVEL })}</p>`;
    return `<div class="company-head"><div class="big-lvl">${P.level}</div><div><b>${this.tr('company_level')}</b>${this.bar(P.xp / P.xpNeeded())}<small>${fmt(P.xp)} / ${fmt(P.xpNeeded())} XP</small></div></div>
      ${ev}
      ${this.identityBlock()}
      ${this.rivalsBlock()}
      <div class="kv-grid">
        <div>${icon('coin')}<b>${fmt(E.coins)}</b><small>${this.tr('coins')}</small></div>
        <div>${icon('rp')}<b>${P.rp}</b><small>${this.tr('research_points')}</small></div>
        <div>${icon('train')}<b>${g.trains.trains.length}</b><small>${this.tr('stat_trainsOwned')}</small></div>
        <div>${icon('station')}<b>${g.stations.list.length}</b><small>${this.tr('stat_stations')}</small></div>
        <div>${icon('coin')}<b>${fmt(E.avgIncomePerMin())}</b><small>${this.tr('income_min')}</small></div>
        <div>${icon('map')}<b>${P.regions.size}/${REGIONS.length}</b><small>${this.tr('stat_regionsUnlocked')}</small></div>
      </div>
      <p class="muted">${this.tr('difficulty')}: ${this.tr('diff_' + g.difficultyId)} · ${this.tr('legacy_badge', { n: P.legacy.count })} · ${fmtTime(S.playTime)}</p>
      ${legend}${legacy}
      <h3>${this.tr('more')}</h3><button class="btn ghost" data-act="panel" data-arg="credits">${this.tr('credits')}</button> <button class="btn ghost" data-act="saveQuit">${this.tr('save_quit')}</button>`;
  }

  // rival companies next to ours
  rivalsBlock() {
    const g = this.game, Rv = g.rivals;
    if (!Rv || !Rv.list.length) return '';
    const mine = g.ledger.companyValue().total;
    const rows = [{ name: g.company.name, color: g.company.color, value: mine, you: true }, ...Rv.list.map((r) => ({ name: r.name, color: r.color, value: r.value(), r }))].sort((a, b) => b.value - a.value);
    return `<h3>${this.tr('rivals')}</h3><div class="fin-list">${rows.map((x, i) => `<div class="fin-row ${x.you ? 'you' : ''}"><span><b>${i + 1}.</b> <i class="rdot" style="background:#${x.color.toString(16).padStart(6, '0')}"></i> ${escapeHtml(x.name)}${x.you ? ` <small>(${this.tr('rival_you')})</small>` : ''}</span><small>${x.r ? this.tr('rival_stats', { b: x.r.vehicles().length, s: x.r.stops().length, p: fmt(x.r.lastProfit) }) : ''}</small><b>${fmt(x.value)} ●</b></div>`).join('')}</div><p class="muted small">${this.tr('rivals_help')}</p>`;
  }

  // company name, colour and headquarters
  identityBlock() {
    const C = this.game.company, hq = C.hq;
    const town = hq && hq.town != null ? this.game.towns.byId(hq.town) : null;
    const sw = COMPANY_COLORS.map((c) => `<button class="cswatch ${C.color === c ? 'on' : ''}" style="background:#${c.toString(16).padStart(6, '0')}" data-act="companyColor" data-arg="${c}" aria-label="${this.tr('company_color')}" aria-pressed="${C.color === c}"></button>`).join('');
    return `<h3>${this.tr('identity')}</h3>
      <label class="set"><span>${this.tr('company_name')}</span><input class="inp" maxlength="32" value="${escapeHtml(C.name)}" data-change="companyName" aria-label="${this.tr('company_name')}"/></label>
      <div class="set"><span>${this.tr('company_color')}</span><div class="cswatches">${sw}</div></div>
      <div class="card">${icon('company')} <b>${this.tr('hq_title')}</b> <small>${hq ? this.tr(town ? 'hq_in' : 'hq_built_at', { town: town ? escapeHtml(town.name) : '' }) : this.tr('hq_none')}</small>
        <div class="row wrap">${hq ? `<button class="btn ghost small" data-act="jumpHQ">${icon('focus', 'mini')} ${this.tr('show')}</button>` : ''}<button class="btn small" data-act="hqPlace">${icon('company', 'mini')} ${this.tr(hq ? 'hq_move' : 'hq_build', { n: fmt(C.hqCost()) })}</button></div>
        <p class="muted small">${this.tr('hq_help')}</p></div>`;
  }

  // what a research node unlocks: locomotives, wagons, track types, signals
  researchUnlocks(id) {
    const out = [];
    for (const m of LOCOS) if (ERA_RESEARCH[m.era] === id) out.push({ ic: 'train', t: m.name });
    for (const w in WAGONS) if (WAGONS[w].research === id) out.push({ ic: 'builder', t: this.tr('wag_' + w) });
    for (const tt of TRACK_TIERS) if (tt.research === id) out.push({ ic: 'track', t: this.tr('tier_' + tt.id) });
    const sig = { block_signals: 'block', path_signals: 'path', one_way_signals: 'oneway' }[id];
    if (sig) out.push({ ic: 'signal', t: this.tr('sig_' + sig) });
    return out;
  }
  // one or two sensible next steps for this network (advisor-driven)
  researchRecommended() {
    const g = this.game, P = g.progression;
    const avail = (id) => P.researchState(id) === 'available';
    const want = [];
    const adv = g.advisor();
    const has = (k) => adv.some((a) => a.key === k);
    if (has('adv_passing_loop') || has('adv_single_short') || has('adv_single_track')) want.push('block_signals', 'path_signals');
    if (has('adv_platform_short')) want.push('platform_extension');
    if (has('adv_add_track') || has('adv_slow_ahead')) want.push('station_expansion');
    if (has('adv_storage')) want.push('station_storage');
    const pax = g.stats.data.passengers || 0, cargo = (g.stats.data.cargoUnits || 0) - pax;
    want.push(pax > cargo ? 'passenger_economy' : 'cargo_optimization', 'fast_loading', 'smart_finance', 'better_boilers');
    const out = [];
    for (const id of want) if (avail(id) && !out.includes(id)) out.push(id);
    if (!out.length) { const cheap = RESEARCH.filter((r) => avail(r.id)).sort((a, b) => a.cost - b.cost)[0]; if (cheap) out.push(cheap.id); }
    return out.slice(0, 2);
  }
  pResearch() {
    const g = this.game, P = g.progression;
    if (!P.researchAvailable()) return `<div class="empty">${icon('lock')}<p>${this.tr('research_locked', { n: 3 })}</p></div>`;
    const depth = {};
    const d = (id) => { if (depth[id] != null) return depth[id]; const r = RESEARCH.find((x) => x.id === id); depth[id] = r.req.length ? Math.max(...r.req.map(d)) + 1 : 0; return depth[id]; };
    RESEARCH.forEach((r) => d(r.id));
    const rec = this.researchRecommended();
    // phones: one category at a time (the recommended one first) instead of eight columns
    const filt = this.researchCat || (window.innerWidth < 760 ? (RESEARCH.find((r) => r.id === rec[0]) || { cat: 'rail' }).cat : 'all');
    const prog = (cat) => { const all = RESEARCH.filter((r) => r.cat === cat); return `${all.filter((r) => P.research.has(r.id)).length}/${all.length}`; };
    const chips = `<div class="chips wrap rcats" role="tablist">${['all', ...RESEARCH_CATS].map((c) => `<button role="tab" aria-selected="${filt === c}" class="chip ${filt === c ? 'on' : ''}" data-act="researchCat" data-arg="${c}"><b>${c === 'all' ? this.tr('all') : this.tr('cat_' + c)}</b>${c === 'all' ? '' : `<small>${prog(c)}</small>`}</button>`).join('')}</div>`;
    const cols = RESEARCH_CATS.filter((cat) => filt === 'all' || filt === cat).map((cat) => {
      const nodes = RESEARCH.filter((r) => r.cat === cat).sort((a, b) => depth[a.id] - depth[b.id]);
      return `<div class="rcol"><h4>${this.tr('cat_' + cat)} <small class="muted">${prog(cat)}</small></h4>${nodes.map((r) => {
        const st = P.researchState(r.id);
        const un = this.researchUnlocks(r.id);
        return `<button class="rnode ${st} ${rec.includes(r.id) ? 'rec' : ''}" id="rn-${r.id}" data-req="${r.req.join(',')}" data-act="research" data-arg="${r.id}" ${st === 'done' || st === 'locked' ? 'disabled' : ''}>
          ${rec.includes(r.id) ? `<span class="rrec">${icon('advisor', 'mini')} ${this.tr('recommended')}</span>` : ''}
          <b>${this.tr('res_' + r.id)}</b><small>${this.tr('res_' + r.id + '_desc')}</small>
          ${un.length ? `<span class="runl">${un.slice(0, 4).map((u) => `<i>${icon(u.ic, 'mini')}${esc(u.t)}</i>`).join('')}${un.length > 4 ? `<i>+${un.length - 4}</i>` : ''}</span>` : ''}
          <span class="rcost">${st === 'done' ? icon('check') : `${icon('rp')}${r.cost}`}</span>
          ${r.req.length && st === 'locked' ? `<em>${this.tr('requires')}: ${r.req.map((q) => this.tr('res_' + q)).join(', ')}</em>` : ''}</button>`;
      }).join('')}</div>`;
    }).join('');
    return `<p class="muted">${icon('rp')} ${this.tr('rp_have', { n: P.rp })} · ${this.tr('rp_sources')} ${this.helpBtn('economy')}</p>${chips}<div class="rtree ${filt === 'all' ? '' : 'one'}"><svg class="rlines"></svg>${cols}</div>`;
  }
  drawResearchLines() {
    const tree = $('.rtree'); if (!tree) return;
    const svg = $('.rlines', tree);
    const tb = tree.getBoundingClientRect();
    svg.setAttribute('width', tree.scrollWidth); svg.setAttribute('height', tree.scrollHeight);
    let h = '';
    for (const r of RESEARCH) for (const q of r.req) {
      const a = document.getElementById('rn-' + q), b = document.getElementById('rn-' + r.id);
      if (!a || !b) continue;
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      const x1 = ra.left + ra.width / 2 - tb.left + tree.scrollLeft, y1 = ra.bottom - tb.top + tree.scrollTop;
      const x2 = rb.left + rb.width / 2 - tb.left + tree.scrollLeft, y2 = rb.top - tb.top + tree.scrollTop;
      const done = this.game.progression.research.has(q);
      h += `<path d="M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}" class="${done ? 'done' : ''}"/>`;
    }
    svg.innerHTML = h;
  }

  objectiveText(o) {
    switch (o.type) {
      case 'connectTowns': return this.tr('obj_connect', { n: o.n });
      case 'delivered': return this.tr('obj_delivered', { n: fmt(o.n), cargo: this.cargoName(o.cargo) });
      case 'stat': return this.tr('obj_stat_' + o.stat, { n: o.n });
      case 'townStage': return this.tr('obj_town_stage', { stage: this.tr('stage_' + ['hamlet', 'village', 'town', 'large_town', 'city', 'major_city', 'metropolis'][o.n]) });
      case 'industryLevel': return this.tr('obj_industry_level', { level: this.tr('ilvl_' + o.n) });
      default: return o.id;
    }
  }

  regionCard(i) {
    const g = this.game, P = g.progression;
    const r = REGIONS[i];
    const info = P.regionUnlockInfo(i);
    const prevName = i > 0 ? this.tr('region_' + REGIONS[i - 1].id) : '';
    return `<div class="card region-card"><div class="rc-head">${icon('lock')}<b>${this.tr('region_' + r.id)}</b><small>${this.tr('biome_' + r.biome)}</small></div>
      <p class="muted">${this.tr('region_' + r.id + '_desc')}</p>
      <div class="checks">
        <div class="chk ${info.okLevel ? 'ok' : ''}">${icon(info.okLevel ? 'check' : 'lock')}<span>${this.tr('unlock_level', { n: r.level })}</span></div>
        ${i > 0 ? `<div class="chk ${info.okObj ? 'ok' : ''}">${icon(info.okObj ? 'check' : 'lock')}<span>${this.tr('req_objectives', { n: info.needObjectives, region: prevName })}</span><small>${Math.min(info.prevObjectives, info.needObjectives)}/${info.needObjectives}</small></div>` : ''}
        <div class="chk ${info.okCoins ? 'ok' : ''}">${icon(info.okCoins ? 'check' : 'coin')}<span>${fmt(info.cost)} ${this.tr('coins')}</span></div>
      </div>
      <div class="row"><button class="btn primary" data-act="unlockRegion" data-arg="${i}" ${info.ok ? '' : 'disabled'}>${this.tr('unlock_region_btn')}</button><button class="btn ghost" data-act="focusRegion" data-arg="${i}">${icon('focus')}</button></div></div>`;
  }

  pObjectives() {
    const g = this.game, P = g.progression;
    let h = this.scenarioBlock();
    const next = P.nextRegion();
    if (next >= 0) h += `<h3>${this.tr('next_region')}</h3>${this.regionCard(next)}`;
    REGIONS.forEach((r, i) => {
      if (!P.regionUnlocked(i)) return;
      const list = OBJECTIVES[r.id] || [];
      const done = P.regionObjectivesDone(i);
      h += `<h3>${this.tr('region_' + r.id)} <small class="${P.developed.has(i) ? 'good' : ''}">${done}/${list.length}${P.developed.has(i) ? ' · ' + this.tr('developed') : ''}</small></h3><div class="objs">`;
      for (const o of list) {
        const ok = P.objectives.has(o.id);
        const prog = ok ? o.n : Math.min(o.n, P.objectiveProgress(o, i));
        h += `<div class="obj ${ok ? 'done' : ''}">${icon(ok ? 'check' : 'objectives')}<div><span>${this.objectiveText(o)}</span>${ok ? '' : this.bar(prog / o.n)}</div><small>${ok ? '' : `${fmt(prog)}/${fmt(o.n)}`}</small></div>`;
      }
      h += '</div>';
    });
    return h;
  }

  contractText(k) {
    const p = { n: fmt(k.amount), cargo: k.cargo ? this.cargoName(k.cargo) : '', town: k.townName || '', from: k.fromName || '', count: k.count };
    return this.tr('con_' + k.type, p);
  }

  pContracts() {
    const g = this.game, E = g.economy;
    E.ensureDaily();
    const cons = E.contracts.filter((k) => !k.claimed).map((k) => {
      const pct = k.progress / k.amount;
      const timer = k.type === 'timed_deliver' && !k.done ? `<span class="timer">${fmtTime(k.left)}</span>` : '';
      return `<div class="card contract ${k.done ? 'done' : ''}">
        <div class="con-top">${k.cargo ? cargoIcon(k.cargo) : icon(k.type === 'passengers' || k.type === 'town_link' || k.type === 'pax_transfers' ? 'town' : k.type === 'timetable' ? 'route' : 'contracts')}<b>${this.contractText(k)}</b>${timer}</div>
        ${this.bar(pct)}<div class="con-bottom"><small>${k.type === 'freight_income' ? fmt(k.progress) : k.type === 'trains_running' || k.type === 'timetable' ? fmtTime(k.progress) : fmt(Math.floor(k.progress))} / ${k.type === 'trains_running' || k.type === 'timetable' ? fmtTime(k.amount) : fmt(k.amount)}</small>
        <span class="reward">${icon('coin')}${fmt(k.coins)} · ${fmt(k.xp)} XP${k.rp ? ` · ${icon('rp')}${k.rp}` : ''}</span></div>
        <div class="row">${k.done ? `<button class="btn gold" data-act="claimContract" data-arg="${k.id}">${this.tr('claim')}</button>` : k.progress === 0 ? `<button class="btn ghost small" data-act="rerollContract" data-arg="${k.id}">${this.tr('reroll')}</button>` : ''}</div></div>`;
    }).join('');
    const daily = E.daily.list.map((d, i) => {
      const prog = Math.min(d.target, E.dailyProgress(d));
      const ok = prog >= d.target;
      return `<div class="card daily ${d.claimed ? 'claimed' : ''}"><div class="con-top">${icon('star')}<b>${this.tr('daily_' + d.id, { n: fmt(d.target) })}</b></div>${this.bar(prog / d.target)}
        <div class="con-bottom"><small>${fmt(prog)}/${fmt(d.target)}</small><span class="reward">${icon('coin')}${fmt(d.coins)} · ${fmt(d.xp)} XP${d.rp ? ` · ${icon('rp')}1` : ''}</span></div>
        <div class="row">${d.claimed ? `<small class="good">${this.tr('claimed')}</small>` : ok ? `<button class="btn gold" data-act="claimDaily" data-arg="${i}">${this.tr('claim')}</button>` : ''}</div></div>`;
    }).join('');
    const tmr = new Date(); tmr.setHours(24, 0, 0, 0);
    return `<h3>${this.tr('contracts')}</h3>${cons}<h3>${this.tr('daily_challenges')} <small>${this.tr('resets_in', { t: fmtTime((tmr - Date.now()) / 1000) })}</small></h3>${daily}`;
  }

  // ---------- train previews ----------
  locoPreview(id, locked) {
    const key = id + (locked ? ':l' : '') + ':' + this.game.progression.defaultLivery;
    if (this.previews.has(key)) return this.previews.get(key);
    if (!this.prevR) {
      try {
        this.prevR = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
        this.prevR.setSize(200, 110, false);
        this.prevScene = new THREE.Scene();
        this.prevScene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a6a, 2.2));
        const dl = new THREE.DirectionalLight(0xffffff, 2); dl.position.set(3, 5, 4); this.prevScene.add(dl);
        this.prevCam = new THREE.PerspectiveCamera(30, 200 / 110, 0.1, 50);
        this.prevCam.position.set(2.4, 1.6, 3.6); this.prevCam.lookAt(-0.3, 0.35, 0);
        this.silMat = new THREE.MeshBasicMaterial({ color: 0x39404c });
      } catch (e) { return ''; }
    }
    const m = locoModel(id);
    const grp = new THREE.Group();
    const livery = this.game.progression.defaultLivery;
    const loco = new THREE.Mesh(locoGeometry(id, livery, 0), locked ? this.silMat : MATS);
    loco.position.x = 0.4; grp.add(loco);
    const cols = liveryColors(m, livery);
    const w = new THREE.Mesh(wagonGeometry(m.role === 'freight' ? 'crate' : 'coach', m.role === 'freight' ? 'GOODS' : null, true, m.kind, cols.body, cols.trim), locked ? this.silMat : MATS);
    w.position.x = -1.15; grp.add(w);
    this.prevScene.add(grp);
    this.prevR.render(this.prevScene, this.prevCam);
    const url = this.prevR.domElement.toDataURL('image/png');
    this.prevScene.remove(grp);
    this.previews.set(key, url);
    return url;
  }

  statBars(m) {
    const rows = [['stat_speed', m.speed / 480, `${m.speed} km/h`], ['stat_accel', m.accel / 3.4, m.accel.toFixed(1)], ['stat_power', m.power / 18000, fmt(m.power) + ' kW'],  ['stat_wagons', m.wagons / 8, m.wagons], ['bld_length', locoLen(m) / 2.4, (locoLen(m) / TILE).toFixed(1) + ' ' + this.tr('tiles')], ['stat_reliability', m.reliability, Math.round(m.reliability * 100) + '%'], ['stat_load', m.load / 1.8, '×' + m.load.toFixed(1)], ['stat_op', m.op / 450, fmt(m.op) + '/min']];
    return `<div class="sbars">${rows.map(([k, p, v]) => `<div class="sb"><span>${this.tr(k)}</span>${this.bar(p)}<small>${v}</small></div>`).join('')}</div>`;
  }

  locoUnlockText(m) {
    const req = ERA_RESEARCH[m.era];
    const parts = [this.tr('unlock_level', { n: m.level })];
    if (req) parts.push(this.tr('res_' + req));
    return parts.join(' + ');
  }

  pCollection() {
    const g = this.game, P = g.progression;
    const cards = LOCOS.map((m) => {
      const unlocked = P.locoUnlocked(m), owned = P.owned.has(m.id);
      const fleet = g.trains.trains.filter((t) => t.model === m.id);
      const up = fleet.length ? Math.max(...fleet.map((t) => Object.values(t.upg).reduce((a, b) => a + b, 0))) : 0;
      return `<div class="lcard ${unlocked ? '' : 'locked'} rar-${m.rarity}">
        <img alt="" src="${this.locoPreview(m.id, !unlocked)}" loading="lazy"/>
        <div class="lc-head"><b>${esc(m.name)}</b><span class="tag">${this.tr('era_' + m.era)}</span></div>
        <div class="lc-sub"><span class="tag">${this.tr('role_' + m.role)}</span><span class="tag rar">${this.tr('rar_' + m.rarity)}</span>${m.electric ? `<span class="tag">${this.tr(m.maglev ? 'needs_hsr' : 'needs_electric')}</span>` : ''}</div>
        <p class="trait">${icon('star')}<b>${this.tr('trait_' + m.trait)}</b> — ${this.tr('trait_' + m.trait + '_desc')}</p>
        ${this.statBars(m)}
        <div class="lc-foot">${owned ? `<span class="good">${icon('check')} ${this.tr('owned')} ×${fleet.length}${up ? ` · ${this.tr('upgrades')} ${up}` : ''}</span>` : unlocked ? `<span>${fmt(g.economy.costs.train(m))} ●</span>` : `<span class="muted">${icon('lock')} ${this.locoUnlockText(m)}</span>`}</div></div>`;
    }).join('');
    const liv = LIVERIES.map((l) => {
      const ok = P.isUnlocked(l.unlock);
      const c = '#' + new THREE.Color(l.body ?? 0x2f6b4a).getHexString(), t = '#' + new THREE.Color(l.trim).getHexString();
      return `<button class="swatch ${P.defaultLivery === l.id ? 'on' : ''} ${ok ? '' : 'locked'}" ${ok ? '' : 'disabled'} data-act="defaultLivery" data-arg="${l.id}" data-tip="${this.tr('liv_' + l.id)}${ok ? '' : ' · ' + this.unlockReqText(l.unlock)}"><i style="background:linear-gradient(135deg, ${c} 60%, ${t} 60%)"></i><span>${this.tr('liv_' + l.id)}</span></button>`;
    }).join('');
    const sty = STATION_STYLES.map((s) => {
      const ok = P.isUnlocked(s.unlock);
      const c = '#' + new THREE.Color(s.wall).getHexString(), r = '#' + new THREE.Color(s.roof).getHexString();
      return `<button class="swatch ${P.defaultStationStyle === s.id ? 'on' : ''} ${ok ? '' : 'locked'}" ${ok ? '' : 'disabled'} data-act="defaultStyle" data-arg="${s.id}" data-tip="${ok ? '' : this.unlockReqText(s.unlock)}"><i style="background:linear-gradient(180deg, ${r} 45%, ${c} 45%)"></i><span>${this.tr('sty_' + s.id)}</span></button>`;
    }).join('');
    const dec = DECORATIONS.map((d) => `<span class="tag ${P.isUnlocked(d.unlock) ? '' : 'locked'}">${P.isUnlocked(d.unlock) ? '' : icon('lock')}${this.tr('dec_' + d.id)}</span>`).join('');
    return `<p class="muted">${this.tr('collection_desc', { n: P.owned.size, total: LOCOS.length })}</p><div class="lgrid">${cards}</div>
      <h3>${this.tr('liveries')}</h3><p class="muted">${this.tr('liveries_desc')}</p><div class="swatches">${liv}</div>
      <h3>${this.tr('station_styles')}</h3><div class="swatches">${sty}</div>
      <h3>${this.tr('decorations')}</h3><div class="tags">${dec}</div>`;
  }
  unlockReqText(u) {
    if (u.level) return this.tr('unlock_level', { n: u.level });
    if (u.achievement) return this.tr('ach_' + u.achievement);
    if (u.region) return this.tr('region_' + u.region);
    return '';
  }

  pMap() {
    const g = this.game, P = g.progression;
    const regions = REGIONS.map((r, i) => `<button class="mreg ${P.regionUnlocked(i) ? 'on' : ''}" data-act="focusRegion" data-arg="${i}">${icon(P.regionUnlocked(i) ? 'map' : 'lock')}<span>${this.tr('region_' + r.id)}</span><small>${P.regionUnlocked(i) ? `${P.regionObjectivesDone(i)}/${(OBJECTIVES[r.id] || []).length}` : this.tr('unlock_level', { n: r.level })}</small></button>`).join('');
    const towns = g.towns.list.filter((t) => P.regionUnlocked(t.region)).map((t) => `<button class="mitem" data-act="jump" data-arg="town:${t.id}">${icon('town')}<span>${esc(t.name)}</span><small>${this.tr('stage_' + g.towns.stageName(t))}</small></button>`).join('');
    const trains = g.trains.trains.map((t) => `<button class="mitem" data-act="jump" data-arg="train:${t.id}">${icon('train')}<span>${esc(t.name)}</span><small>${this.tr('tstate_' + t.state)}</small></button>`).join('');
    const mode = this.mapMode || 'geo';
    const seg = `<div class="seg tabs" role="tablist"><button role="tab" aria-selected="${mode === 'geo'}" class="${mode === 'geo' ? 'on' : ''}" data-act="mapMode" data-arg="geo">${this.tr('map_geo')}</button><button role="tab" aria-selected="${mode === 'lines'}" class="${mode === 'lines' ? 'on' : ''}" data-act="mapMode" data-arg="lines">${this.tr('map_schematic')}</button></div>`;
    if (mode === 'lines') return seg + (networkMapSVG(g, g.lines.list().map((l) => ({ ...l, name: g.lines.name(l) })), { tr: (k) => this.tr(k) }) || `<p class="muted">${this.tr('netmap_empty')}</p>`) + `<h3>${this.tr('trains')}</h3><div class="mlist">${trains}</div>`;
    return `${seg}<canvas id="minimap" width="256" height="256" aria-label="${this.tr('menu_map')}"></canvas>
      <div class="legend"><span><i class="lg town"></i>${this.tr('towns')}</span><span><i class="lg rail"></i>${this.tr('track')}</span><span><i class="lg train"></i>${this.tr('trains')}</span><span><i class="lg ind"></i>${this.tr('industries')}</span></div>
      <h3>${this.tr('regions')}</h3><div class="mlist">${regions}</div>
      <h3>${this.tr('towns')}</h3><div class="mlist">${towns}</div>
      ${trains ? `<h3>${this.tr('trains')}</h3><div class="mlist">${trains}</div>` : ''}`;
  }
  drawMinimap() {
    const cv = $('#minimap'); if (!cv) return;
    const g = this.game, W = g.world;
    const ctx = cv.getContext('2d');
    const s = cv.width / N;
    if (!this._mmBase || this._mmBaseV !== g.progression.regions.size) {
      const base = document.createElement('canvas'); base.width = base.height = cv.width;
      const b = base.getContext('2d');
      const col = new THREE.Color();
      for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
        const i = idx(x, z);
        col.copy(g.world.view.tileColor(i, W.tileH[i], 0));
        if (W.type[i] === 1) col.set(0x4aa3c4);
        b.fillStyle = '#' + col.getHexString();
        b.fillRect(x * s, z * s, s + 0.5, s + 0.5);
      }
      this._mmBase = base; this._mmBaseV = g.progression.regions.size;
    }
    ctx.drawImage(this._mmBase, 0, 0);
    ctx.fillStyle = '#3a3230';
    for (let i = 0; i < N * N; i++) if (g.net.conn[i]) ctx.fillRect(tx(i) * s + s * 0.2, tz(i) * s + s * 0.2, s * 0.6, s * 0.6);
    ctx.fillStyle = '#8a5ab0';
    for (const ind of g.industries.list) ctx.fillRect(ind.x * s, ind.z * s, s * 2, s * 2);
    ctx.fillStyle = '#f4efe6'; ctx.strokeStyle = '#2b3445';
    for (const t of g.towns.list) { const r = s * (1.2 + t.stage * 0.4); ctx.beginPath(); ctx.arc((t.x + 0.5) * s, (t.z + 0.5) * s, r, 0, 7); ctx.fill(); ctx.stroke(); }
    ctx.fillStyle = '#e0a33a';
    for (const t of g.trains.trains) { const p = g.entityPos({ type: 'train', id: t.id }); if (p) { ctx.beginPath(); ctx.arc(p.x / TILE * s, p.z / TILE * s, s * 0.9, 0, 7); ctx.fill(); } }
    // view marker
    const c = g.camera.target;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    const vw = g.camera.viewSize * 1.5 / TILE * s;
    ctx.strokeRect(c.x / TILE * s - vw, c.z / TILE * s - vw * 0.6, vw * 2, vw * 1.2);
    if (!cv._bound) {
      cv._bound = true;
      cv.addEventListener('click', (e) => {
        const r = cv.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width * N * TILE, z = (e.clientY - r.top) / r.height * N * TILE;
        this.game.camera.focus(x, z);
      });
    }
  }

  pStats() {
    const g = this.game, S = g.stats.data;
    let trackLen = 0; for (let i = 0; i < N * N; i++) if (g.net.conn[i]) trackLen++;
    const fastest = g.trains.trains.reduce((m, t) => Math.max(m, Math.round(t._st.speed)), 0);
    const largest = g.towns.largest();
    const rows = [
      ['stat_track', `${fmt(trackLen)} ${this.tr('tiles')}`], ['stat_trainsOwned', g.trains.trains.length], ['stat_stations', g.stations.list.length],
      ['stat_deliveries', fmt(S.deliveries)], ['stat_cargo', fmt(S.cargoUnits)], ['stat_passengers', fmt(S.passengers)], ['stat_coinsEarned', fmt(S.coinsEarned)],
      ['stat_longestRoute', `${S.longestRoute} ${this.tr('tiles')}`], ['stat_fastest', `${fastest} km/h`], ['stat_topSpeed', `${S.topSpeed} km/h`],
      ['stat_largestTown', largest ? `${largest.name} (${fmt(largest.pop)})` : '-'], ['stat_townsDeveloped', g.towns.list.filter((t) => t.stage > 0).length],
      ['stat_regionsUnlocked', `${g.progression.regions.size}/${REGIONS.length}`], ['stat_bridgesBuilt', S.bridgesBuilt], ['stat_tunnelsBuilt', S.tunnelsBuilt],
      ['stat_contractsDone', S.contractsDone], ['stat_researchDone', S.researchDone], ['stat_playTime', fmtTime(S.playTime)],
    ];
    const cargo = CARGO_IDS.filter((c) => S.cargo[c]).map((c) => `<div class="cstat">${cargoIcon(c)}<span>${this.cargoName(c)}</span><b>${fmt(S.cargo[c])}</b></div>`).join('');
    return `<div class="stats">${rows.map(([k, v]) => `<div><span>${this.tr(k)}</span><b>${v}</b></div>`).join('')}</div><h3>${this.tr('cargo_transported')}</h3><div class="cstats">${cargo || `<p class="muted">${this.tr('none_yet')}</p>`}</div>`;
  }

  pAchievements() {
    const g = this.game, P = g.progression, S = g.stats.data;
    return `<p class="muted">${P.achievements.size}/${ACHIEVEMENTS.length}</p><div class="agrid">${ACHIEVEMENTS.map((a) => {
      const ok = P.achievements.has(a.id);
      const v = Math.min(a.target, S[a.stat] || 0);
      return `<div class="ach ${ok ? 'done' : ''}">${icon(ok ? 'achievements' : 'lock')}<div><b>${this.tr('ach_' + a.id)}</b><small>${this.tr('ach_' + a.id + '_desc', { n: fmt(a.target) })}</small>${ok ? '' : this.bar(v / a.target)}</div>${a.rp ? `<span class="rp">${icon('rp')}${a.rp}</span>` : ''}</div>`;
    }).join('')}</div>`;
  }

  // now playing + playlist controls (tracks come from assets/music/music.json)
  musicBlock() {
    const M = this.app.audio.musicMgr;
    if (!M || !M.has()) return `<p class="muted small">${this.tr('music_none')}</p>`;
    const t = M.nowPlaying();
    return `<div class="card music-now">${icon('play', 'mini')}<div><b>${t ? escapeHtml(t.title) : this.tr('music_stopped')}</b>${t && t.artist ? `<small>${escapeHtml(t.artist)}</small>` : ''}</div>
      <div class="row"><button class="icon-btn small" data-act="musicPrev" aria-label="${this.tr('music_prev')}">${icon('left')}</button><button class="icon-btn small" data-act="musicToggle" aria-label="${this.tr('music_toggle')}">${icon(M.paused || !t ? 'play' : 'pause')}</button><button class="icon-btn small" data-act="musicNext" aria-label="${this.tr('music_next')}">${icon('right')}</button>
      <button class="chip mini ${M.shuffle ? 'on' : ''}" data-act="musicShuffle"><b>${this.tr('music_shuffle')}</b></button></div></div>
      <p class="muted small">${this.tr('music_count', { n: M.tracks.length })}</p>`;
  }
  pSettings() {
    const s = this.app.settings;
    const range = (k, label) => `<label class="set"><span>${this.tr(label)}</span><input type="range" min="0" max="1" step="0.05" value="${s[k]}" data-input="setting" data-key="${k}"/></label>`;
    const tog = (k, label) => `<label class="set tog"><span>${this.tr(label)}</span><input type="checkbox" ${s[k] ? 'checked' : ''} data-change="settingBool" data-key="${k}"/><i></i></label>`;
    const sel = (k, label, opts) => `<label class="set"><span>${this.tr(label)}</span><select data-change="settingSel" data-key="${k}">${opts.map((o) => `<option value="${o}" ${s[k] === o ? 'selected' : ''}>${this.tr('opt_' + o)}</option>`).join('')}</select></label>`;
    const lang = `<label class="set"><span>${this.tr('language')}</span><select data-change="lang">${LANGS.map((l) => `<option value="${l.id}" ${getLang() === l.id ? 'selected' : ''}>${l.name}</option>`).join('')}</select></label>`;
    const inGame = !!this.game;
    return `<h3>${this.tr('audio')}</h3>${range('volMaster', 'vol_master')}${range('volMusic', 'vol_music')}${range('volSfx', 'vol_sfx')}${range('volAmb', 'vol_amb')}${tog('music', 'music_on')}${this.musicBlock()}
      <h3>${this.tr('graphics')}</h3>${sel('graphics', 'graphics_quality', ['auto', 'low', 'medium', 'high'])}${s.graphics === 'auto' ? `<p class="muted small">${this.tr('gfx_auto_now', { q: this.tr('opt_' + this.app.gfx()) })}</p>` : ''}${sel('shadows', 'shadow_quality', ['off', 'low', 'medium', 'high'])}${sel('particles', 'particle_quality', ['low', 'medium', 'high'])}
      ${tog('dayNight', 'day_night')}${tog('weather', 'weather')}${tog('labels', 'world_labels')}
      ${inGame ? `<h3>${this.tr('world_rules')}</h3><label class="set"><span>${this.tr('rel_mode')}</span><select data-change="relMode">${['off', 'relaxed', 'tycoon'].map((o) => `<option value="${o}" ${this.game.maint.mode === o ? 'selected' : ''}>${this.tr('rel_' + o)}</option>`).join('')}</select></label><p class="muted small">${this.tr('rel_' + this.game.maint.mode + '_desc')}</p>` : ''}
      <h3>${this.tr('comfort')}</h3>${tog('cameraMotion', 'camera_motion')}${tog('screenShake', 'screen_shake')}${tog('reducedMotion', 'reduced_motion')}${tog('highContrast', 'high_contrast')}${tog('tips', 'setting_tips')}
      <h3>${this.tr('controls')}</h3>${sel('wheel', 'setting_wheel', ['auto', 'zoom', 'pan'])}${tog('instantBuild', 'setting_instant_build')}${tog('keepTool', 'setting_keep_tool')}
      <label class="set"><span>${this.tr('ui_scale')}</span><input type="range" min="0.8" max="1.4" step="0.05" value="${s.uiScale}" data-change="setting" data-key="uiScale"/></label>${lang}
      <h3>${this.tr('save_data')}</h3><div class="row wrap">
        ${inGame ? `<button class="btn" data-act="exportSave">${this.tr('export_save')}</button>` : ''}
        <button class="btn" data-act="importSave">${this.tr('import_save')}</button>
        ${inGame ? `<button class="btn ghost" data-act="resetTutorial">${this.tr('reset_tutorial')}</button>` : ''}
        <button class="btn danger" data-act="resetGame">${this.tr('reset_game')}</button></div>
      <div class="row wrap"><button class="btn ghost small" data-act="copyDiagnostics">${this.tr('copy_diagnostics')}</button></div>
      <p class="muted small">${this.tr('storage_info')} · v${GAME_VERSION}</p>`;
  }

  pCredits() {
    return `<div class="credits"><h1>TRACKLANDS</h1><p>${this.tr('credits_tagline')}</p>
      ${CREATOR_NAME ? `<p><b>${this.tr('created_by')}</b><br>${esc(CREATOR_NAME)}</p>` : ''}
      <p class="muted">${this.tr('credits_tech')}</p><p class="muted small">three.js — MIT License © three.js authors</p><p class="muted small">v${GAME_VERSION}</p></div>`;
  }

  pTrainShop() {
    const g = this.game, P = g.progression;
    const depots = g.stations.depots;
    let dep = g.stations.depotById(this.shopDepot);
    if (!dep) dep = depots.find((d) => g.net.conn[d.tile]) || depots[0];
    this.shopDepot = dep ? dep.id : null;
    if (!depots.length) return `<div class="empty">${icon('depot')}<p>${this.tr('err_no_depot')}</p><button class="btn primary" data-act="tool" data-arg="depot">${this.tr('tool_depot')}</button></div>`;
    const dsel = `<label class="set"><span>${this.tr('depot')}</span><select data-change="shopDepot">${depots.map((d) => `<option value="${d.id}" ${d.id === this.shopDepot ? 'selected' : ''}>${esc(d.name)}${g.net.conn[d.tile] ? '' : ' — ' + this.tr('not_connected')}</option>`).join('')}</select></label>`;
    const list = LOCOS.map((m) => {
      const ok = P.locoUnlocked(m);
      const cost = g.economy.costs.train(m);
      const err = ok ? g.trains.canBuy(m.id, dep) : 'err_train_locked';
      return `<div class="shop-item ${ok ? '' : 'locked'}"><img alt="" src="${this.locoPreview(m.id, !ok)}"/><div class="si-body"><b>${esc(m.name)}</b>
        <small>${this.tr('era_' + m.era)} · ${this.tr('role_' + m.role)} · ${m.speed} km/h · ${icon('train', 'mini')}${m.freight}/${m.pax}</small>
        <small class="trait">${icon('star', 'mini')}${this.tr('trait_' + m.trait)}</small>
        ${ok ? '' : `<small class="muted">${icon('lock', 'mini')} ${this.locoUnlockText(m)}</small>`}</div>
        <button class="btn ${err ? 'ghost' : 'primary'}" data-act="buyTrain" data-arg="${m.id}" ${ok ? '' : 'disabled'} ${err && ok ? `data-tip="${this.tr(err)}"` : ''}>${icon('coin', 'mini')}${fmt(cost)}</button></div>`;
    }).join('');
    return `${dsel}<p class="muted">${this.tr('shop_desc')}</p><div class="shop">${list}</div>`;
  }

  openTrainShop(depotId) { this.openBuilder({ depotId }); }

  // ---------- inspector ----------
  showInspector(sel) {
    this.inspectSel = sel;
    const el = $('#inspector');
    if (!sel) { el.hidden = true; el.classList.remove('open'); document.body.classList.remove('insp-open'); return; }
    el.hidden = false; el.classList.add('open');
    document.body.classList.add('insp-open');
    this._inspFirst = true;
    this.renderInspector();
  }
  renderInspector(live) {
    const g = this.game, sel = this.inspectSel;
    if (!g || !sel) return;
    const el = $('#inspector');
    if (!el._pressHook) { el._pressHook = true; el.addEventListener('pointerdown', () => { this._panelPressT = performance.now(); }, true); }
    let title = '', body = '', ic = 'info';
    switch (sel.type) {
      case 'station': { const s = g.stations.byId(sel.id); if (!s) return this.game.select(null); ic = 'station'; title = s.name; body = this.iStation(s); break; }
      case 'depot': { const d = g.stations.depotById(sel.id); if (!d) return this.game.select(null); ic = 'depot'; title = d.name; body = this.iDepot(d); break; }
      case 'industry': { const i = g.industries.byId(sel.id); if (!i) return this.game.select(null); ic = 'factory'; title = g.industries.displayName(i); body = this.iIndustry(i); break; }
      case 'town': { const t = g.towns.byId(sel.id); if (!t) return this.game.select(null); ic = 'town'; title = t.name; body = this.iTown(t); break; }
      case 'train': { const t = g.trains.byId(sel.id); if (!t) return this.game.select(null); ic = 'train'; title = t.name; body = this.iTrain(t); break; }
      case 'roadstop': { const s = g.roads.stopById(sel.id); if (!s) return this.game.select(null); ic = s.kind; title = s.name; body = this.iRoadStop(s); break; }
      case 'roadveh': { const v = g.roads.byId(sel.id); if (!v) return this.game.select(null); ic = roadModel(v.model).kind; title = v.name; body = this.iRoadVeh(v); break; }
      case 'line': { const l = g.roads.lines.byId(sel.id); if (!l) return this.game.select(null); ic = 'route'; title = this.tr('line_title', { name: l.name }); body = this.iLine(l); break; }
      case 'region': { ic = 'lock'; title = this.tr('region_' + REGIONS[sel.id].id); body = g.progression.regionUnlocked(sel.id) ? '' : this.regionCard(sel.id); break; }
      default: return;
    }
    const b = $('.ibody', el);
    const scroll = b ? b.scrollTop : 0;
    const focused = document.activeElement && el.contains(document.activeElement) && document.activeElement.tagName === 'SELECT';
    if (focused) return;
    // live refresh: only when something changed
    const sig = ic + title + body;
    if (live && sig === this._inspSig && $('.ibody', el)) return;
    this._inspSig = sig;
    el.innerHTML = `<div class="phead">${icon(ic)}<h2>${esc(title)}</h2><button class="icon-btn" data-act="focusSel" aria-label="${this.tr('focus')}" data-tip="${this.tr('focus')}">${icon('focus')}</button><button class="icon-btn" data-act="closeInspector" aria-label="${this.tr('close')}">${icon('close')}</button></div><div class="ibody">${body}</div>`;
    if (!this._inspFirst) $('.ibody', el).scrollTop = scroll;
    this._inspFirst = false;
  }

  cargoRow(c, amt, cap, extra = '') {
    return `<div class="crow">${cargoIcon(c)}<span>${this.cargoName(c)}</span>${cap ? this.bar(amt / cap, amt / cap > 0.9 ? 'warn' : '') : ''}<b>${fmt(Math.floor(amt))}${cap ? '/' + fmt(cap) : ''}</b>${extra}</div>`;
  }

  iDepot(d) {
    const g = this.game;
    const trains = g.trains.trains.filter((t) => t.homeDepot === d.id);
    return `${g.net.conn[d.tile] ? '' : `<div class="card warn">${icon('warn')} ${this.tr('hint_connect_depot')}</div>`}
      <p class="muted">${this.tr('depot_desc')}</p><button class="btn primary" data-act="shopFromDepot" data-arg="${d.id}">${icon('train')} ${this.tr('buy_train')}</button>
      <h4>${this.tr('trains')}: ${trains.length}</h4>${trains.map((t) => `<button class="tag link" data-act="jump" data-arg="train:${t.id}">${icon('train', 'mini')}${esc(t.name)}</button>`).join('')}`;
  }

  iIndustry(ind) {
    const g = this.game, cfg = INDUSTRIES[ind.type];
    const cap = g.industries.capacity(ind);
    const ins = g.industries.inputs(ind), outs = g.industries.outputs(ind);
    const sts = g.industries.linkedStations(ind);
    const recipe = cfg.recipes.map((r) => `<div class="recipe">${Object.keys(r.in).map((c) => `${cargoIcon(c)}<small>${r.in[c]} ${this.cargoName(c)}</small>`).join(' + ') || `<small>${this.tr('natural_resource')}</small>`} → ${Object.keys(r.out).map((c) => `${cargoIcon(c)}<small>${r.out[c]} ${this.cargoName(c)}</small>`).join(' + ')}</div>`).join('');
    const locked = !g.progression.regionUnlocked(ind.region);
    const share = g.industries.transportShare(ind);
    const opp = g.industries.opportunities(ind).map((o) => o.dests.map((d) => `<div class="opp ${d.state}${d.locked ? ' locked' : ''}"><button class="tag link" data-act="jump" data-arg="${d.kind}:${d.id}">${cargoIcon(o.c, 'mini')}${d.kind === 'town' ? icon('town', 'mini') : icon('factory', 'mini')}${esc(d.name)}</button><b>≈${fmt(d.value)}●</b><small class="opp-meta">${d.dist} ${this.tr('tiles')} · <span class="opp-state">${d.locked ? icon('lock', 'mini') : ''}${this.tr('opp_' + d.state)}</span></small></div>`).join('')).join('');
    return `<div class="pill-row"><span class="pill">${this.tr('ilvl_' + ind.level)}</span><span class="pill">${fmt(g.industries.rate(ind))}/${this.tr('min')}</span><span class="pill" data-tip="${this.tr('transported_share_tip')}">${this.tr('transported_share', { n: Math.round(share * 100) })}</span></div>
      ${locked ? `<div class="card warn">${icon('lock')} ${this.tr('region_locked_info')}</div>` : ''}
      <h4>${this.tr('production_chain')}</h4>${recipe}
      ${ins.length ? `<h4>${this.tr('needs')}</h4>${ins.map((c) => this.cargoRow(c, ind.inp[c] || 0, cap * 2)).join('')}` : ''}
      <h4>${this.tr('produces')}</h4>${outs.map((c) => this.cargoRow(c, ind.out[c] || 0, cap)).join('')}
      <h4>${this.tr('carried_by')}</h4>${outs.map((c) => this.cargoWagonsRow(c)).join('')}
      ${opp ? `<h4>${this.tr('opportunities')} ${this.helpBtn('freight')}</h4><div class="opps">${opp}</div><p class="muted small">${this.tr('opportunities_help')}</p>` : ''}
      <h4>${this.tr('growth')}</h4>${ind.level < 4 ? `${this.bar(g.industries.levelProgress(ind))}<small class="muted">${this.tr('next_ilvl', { name: this.tr('ilvl_' + (ind.level + 1)) })}</small>` : `<span class="good">${this.tr('max_level')}</span>`}
      <h4>${this.tr('stations')}</h4>${sts.map((s) => `<button class="tag link" data-act="jump" data-arg="station:${s.id}">${icon('station', 'mini')}${esc(s.name)}</button>`).join('') || `<p class="muted">${this.tr('industry_no_station')}</p>`}
      ${locked ? '' : this.investBlock(ind)}`;
  }

  iTown(t) {
    const g = this.game;
    const req = g.towns.requirement(t);
    const sts = g.stations.list.filter((s) => s.links.towns.includes(t.id));
    const bars = req ? Object.keys(req).map((c) => {
      const have = Math.floor(t.progress[c] || 0);
      return `<div class="crow">${cargoIcon(c)}<span>${this.cargoName(c)}</span>${this.bar(have / req[c], have >= req[c] ? 'good' : '')}<b>${have}/${req[c]}</b></div>`;
    }).join('') : `<span class="good">${this.tr('max_stage')}</span>`;
    const next = t.stage < 6 ? this.tr('stage_' + ['hamlet', 'village', 'town', 'large_town', 'city', 'major_city', 'metropolis'][t.stage + 1]) : '';
    const b = (act, arg, ic, label, dis = false) => `<button class="tact" data-act="${act}" data-arg="${arg}" ${dis ? 'disabled' : ''}>${icon(ic)}<span>${label}</span></button>`;
    return `<div class="tactions" role="toolbar" aria-label="${this.tr('town_actions')}">
        ${b('scrollTo', '#tw-transport', 'bus', this.tr('tm_transport'))}${b('scrollTo', '#tw-growth', 'up', this.tr('growth'))}${b('scrollTo', '#tw-districts', 'town', this.tr('tm_districts'))}${b('scrollTo', '#tw-auth', 'company', this.tr('tm_authority'))}
      </div>
      <div class="pill-row"><span class="pill">${this.tr('stage_' + g.towns.stageName(t))}</span><span class="pill">${icon('town', 'mini')} ${fmt(t.pop)}</span>${t.tourist ? `<span class="pill">${this.tr('tourist_town')}</span>` : ''}</div>
      ${!g.progression.regionUnlocked(t.region) ? `<div class="card warn">${icon('lock')} ${this.tr('region_locked_info')}</div>` : ''}
      <h4 id="tw-growth">${next ? this.tr('growth_to', { name: next }) : this.tr('growth')}</h4>${bars}
      <p class="muted small">${this.tr('town_growth_help')}</p>
      <h4>${this.tr('accepts')}</h4><div class="icons">${TOWN_ACCEPTS.map((c) => `<span data-tip="${this.cargoName(c)}">${cargoIcon(c)}</span>`).join('')}</div>
      <h4>${this.tr('produces')}</h4><div class="icons">${cargoIcon('PASSENGERS')}${cargoIcon('MAIL')}</div>
      ${this.townTransportBlock(t, sts)}
      <p class="muted small">${this.tr('town_delivered', { n: fmt(t.delivered) })}</p>
      <span id="tw-districts"></span>${this.townGrowthBlock(t)}
      <span id="tw-auth"></span>${this.authBlock(t)}`;
  }
  // how the town is served: stations, stops and lines, the share of the
  // town within walking distance, the largest part without a stop
  townTransportBlock(t, sts) {
    const g = this.game, R = g.roads;
    const stops = R ? R.stops.filter((s) => !s.owner && s.links && s.links.towns.includes(t.id) && s.kind !== 'garage') : [];
    const lines = R ? R.lines.list.filter((l) => l.stops.some((id) => stops.some((s) => s.id === id))) : [];
    const all = [...g.stations.list, ...(R ? R.stops : [])].filter((s) => !s.owner && s.links && s.links.towns.includes(t.id));
    const cov = all.length ? g.towns.coverage(t, all).share : 0;
    const gap = g.towns.gaps(t);
    const busOk = R && R.kindUnlocked('bus');
    const busStops = stops.filter((s) => s.kind === 'bus' || s.kind === 'tram');
    return `<h4 id="tw-transport">${this.tr('tm_transport')} ${this.helpBtn('buslines')}</h4>
      <div class="crow">${icon('town', 'mini')}<span>${this.tr('tm_coverage')}</span>${this.bar(cov, cov > 0.7 ? 'good' : cov < 0.3 ? 'warn' : '')}<b>${Math.round(cov * 100)}%</b></div>
      ${gap && gap.none ? `<p class="card warn small">${icon('advisor', 'mini')} ${this.tr('tm_town_none')}</p>` : gap && gap.area && gap.share > 0.15 ? `<p class="card small">${icon('advisor', 'mini')} ${this.tr('tm_town_gap', { area: this.tr('area_' + gap.area), n: Math.round(gap.share * 100) })}${gap.tile >= 0 ? ` <button class="btn small ghost" data-act="jumpTile" data-arg="${gap.tile}">${icon('focus', 'mini')} ${this.tr('show')}</button>` : ''}</p>` : ''}
      <div class="links">${sts.map((s) => `<button class="tag link" data-act="jump" data-arg="station:${s.id}">${icon('station', 'mini')}${esc(s.name)}</button>`).join('')}${stops.map((s) => `<button class="tag link" data-act="jump" data-arg="roadstop:${s.id}">${icon(s.kind, 'mini')}${esc(s.name)}</button>`).join('')}${!sts.length && !stops.length ? `<span class="muted">${this.tr('town_no_station')}</span>` : ''}</div>
      ${lines.length ? `<div class="chips wrap">${lines.map((l) => `<button class="tag link" data-act="jump" data-arg="line:${l.id}">${this.lineBadge(l)}</button>`).join('')}</div>` : ''}
      ${busOk ? `<div class="row wrap">${busStops.length >= 2 ? `<button class="btn small primary" data-act="tTool" data-arg="line">${icon('route', 'mini')} ${this.tr('tm_new_line')}</button>` : ''}<button class="btn small ${busStops.length >= 2 ? 'ghost' : 'primary'}" data-act="tStop" data-arg="bus">${icon('bus', 'mini')} ${this.tr('tool_roadstop_bus')}</button></div>` : ''}`;
  }

  // ---------- modals ----------
  modal(html, { cls = '', onCancel } = {}) {
    const root = $('#modal-root');
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML = `<div class="modal ${cls}" role="dialog" aria-modal="true">${html}</div>`;
    wrap._cancel = () => { wrap.remove(); if (onCancel) onCancel(); };
    wrap.addEventListener('click', (e) => { if (e.target === wrap && onCancel) wrap._cancel(); });
    root.appendChild(wrap);
    const f = wrap.querySelector('input, textarea, button.primary, button');
    if (f) setTimeout(() => f.focus(), 30);
    return wrap;
  }
  confirm(text, okLabel, danger) {
    return new Promise((res) => {
      const w = this.modal(`<p>${esc(text)}</p><div class="row end"><button class="btn ghost" data-mbtn="no">${this.tr('cancel')}</button><button class="btn ${danger ? 'danger' : 'primary'}" data-mbtn="yes">${esc(okLabel || this.tr('ok'))}</button></div>`, { onCancel: () => res(false) });
      w.querySelector('[data-mbtn=no]').onclick = () => { w.remove(); res(false); };
      w.querySelector('[data-mbtn=yes]').onclick = () => { w.remove(); res(true); };
    });
  }
  prompt(text, value) {
    return new Promise((res) => {
      const w = this.modal(`<p>${esc(text)}</p><input class="inp" maxlength="28" value="${esc(value || '')}"/><div class="row end"><button class="btn ghost" data-mbtn="no">${this.tr('cancel')}</button><button class="btn primary" data-mbtn="yes">${this.tr('ok')}</button></div>`, { onCancel: () => res(null) });
      const inp = w.querySelector('input');
      const ok = () => { w.remove(); res(inp.value.trim()); };
      w.querySelector('[data-mbtn=no]').onclick = () => { w.remove(); res(null); };
      w.querySelector('[data-mbtn=yes]').onclick = ok;
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
    });
  }

  welcomeBack(o, onClaim) {
    const ads = MonetizationService.adsAvailable();
    const w = this.modal(`<div class="wb">${icon('gift')}<h2>${this.tr('welcome_back')}</h2><p class="muted">${this.tr('time_away', { t: fmtTime(o.away) })}</p>
      <div class="kv-grid"><div>${icon('coin')}<b>${fmt(o.coins)}</b><small>${this.tr('coins_earned')}</small></div><div><b>${fmt(o.deliveries)}</b><small>${this.tr('est_deliveries')}</small></div><div><b>${fmt(o.xp)}</b><small>XP</small></div></div>
      <div class="row end">${ads ? `<button class="btn ghost" data-mbtn="ad">${this.tr('double_ad')}</button>` : ''}<button class="btn gold" data-mbtn="claim">${this.tr('claim')}</button></div></div>`, { cls: 'center' });
    w.querySelector('[data-mbtn=claim]').onclick = () => { w.remove(); onClaim(1); };
    const ad = w.querySelector('[data-mbtn=ad]');
    if (ad) ad.onclick = async () => { const r = await MonetizationService.requestRewardedAd('offline_double'); w.remove(); onClaim(r.rewarded ? 2 : 1); };
  }

  legend() {
    const w = this.modal(`<div class="wb legend">${icon('star')}<h2>${this.tr('legend_title')}</h2><p>${this.tr('legend_text')}</p><div class="row end"><button class="btn gold" data-mbtn="ok">${this.tr('continue_playing')}</button></div></div>`, { cls: 'center' });
    w.querySelector('[data-mbtn=ok]').onclick = () => w.remove();
  }

  // ---------- debug ----------
  toggleDebug() { this.debugOn = !this.debugOn; $('#debug').hidden = !this.debugOn; if (this.debugOn) this.renderDebug(); }
  renderDebug() {
    const g = this.game; if (!g) return;
    const info = g.renderer.info;
    let nodes = 0; for (let i = 0; i < N * N; i++) if (g.net.conn[i]) nodes++;
    const sel = g.selection ? `${g.selection.type}:${g.selection.id}` : '-';
    const tr = g.selection && g.selection.type === 'train' ? g.trains.byId(g.selection.id) : null;
    $('#debug').textContent = `FPS ${Math.round(this.app.fps)}\ncalls ${info.render.calls} tris ${fmt(info.render.triangles)}\ngeo ${info.memory.geometries} tex ${info.memory.textures}\ntrains ${g.trains.trains.length} rail tiles ${nodes}\nnet v${g.net.version} routes cached ${g.net.routeCache.size}\nspeed ${g.speed}x  time ${Math.round(g.time)}s\ncoins ${Math.round(g.economy.coins)}\nselected ${sel}${tr ? `\n state ${tr.state} steps ${tr.steps.length} s ${tr.s.toFixed(2)} stop ${tr.stopS.toFixed(2)}\n held ${tr.held.size} wait ${tr.wait.toFixed(1)} resv ${tr.resvEnd}/${tr.steps.length}\n blockedBy ${tr.blockedBy} ${tr.blockKind || ''} prio ${tr._st.prioRank}\n veh ${tr.veh.map((v) => v.k + v.id + (v.r ? 'r' : '')).join(' ')}` : ''}\nrail: switches ${g.net.switches.size} jres ${g.net.jres.size} runs ${g.net.runLocks.size}\ngraph ${g.net.validateGraph(99).length} issues · headings ${g.trains.validateHeadings().length}\nsignals ${g.net.signals.size} collisions ${g.trains.collisions} deadlocks ${g.trains.incidents.length}\ngfx ${this.app.settings.graphics}→${this.app.gfx()} gpu ${(this.app.gpu || '').slice(0, 40)}\nlog ${JSON.stringify(log.counts())}\n${log.entries(6).map((e) => `${(e.t / 1000).toFixed(0)}s ${e.lvl} [${e.cat}] ${e.msg}`).join('\n')}`;
  }

  toggleHeatmap() { this.actions.overlay('traffic'); }

  // ---------- actions ----------
  get actions() {
    const g = () => this.game;
    return {
      panel: (a) => this.openPanel(a),
      closePanel: () => this.closePanel(),
      closeInspector: () => g().select(null),
      toggleMenu: () => $('#menu-rail').classList.toggle('open'),
      speed: (a) => g().setSpeed(+a),
      tool: (a) => { if (a === 'train') { this.openBuilder({}); return; } g().construction.setTool(a); if (window.innerWidth < 760) this.closePanel(); },
      tier: (a) => g().construction.setTier(+a),
      musicPrev: () => { this.app.audio.musicMgr.prev(); this.refreshPanel(); },
      musicNext: () => { this.app.audio.musicMgr.next(); this.refreshPanel(); },
      musicToggle: () => { this.app.audio.musicMgr.toggle(); this.refreshPanel(); },
      musicShuffle: () => { const M = this.app.audio.musicMgr; M.shuffle = !M.shuffle; this.refreshPanel(); },
      roadMode: (a) => { if (a === 'tram' && !g().roads.kindUnlocked('tram')) { this.error('err_locked'); return; } g().construction.roadMode = a; this.renderToolbar(); },
      stopKind: (a) => { if (!g().roads.kindUnlocked(a)) { this.error('err_locked'); return; } g().construction.stopKind = a; this.renderToolbar(); g().construction.hover(g().construction.hoverTile); },
      buildConfirm: () => { const C = g().construction; if (C.touchReady()) C.touchCommit(); },
      buildCancel: () => g().construction.touchCancel(),
      stTracks: (a) => { const C = g().construction; C.setStationTracks((C.stationTracks || 1) + +a); this.renderToolbar(); },
      decorType: (a) => { const d = DECORATIONS.find((x) => x.id === a); if (!g().progression.isUnlocked(d.unlock)) { this.error('err_locked'); return; } g().construction.decor = a; this.renderToolbar(); },
      heatmap: () => this.toggleHeatmap(),
      companyColor: (a) => { const G = g(); G.company.color = +a; G.company.buildVisual(); this.refreshPanel(); },
      hqPlace: () => { this.closePanel(); g().construction.setTool('hq'); this.toast(this.tr('hq_hint', { n: fmt(g().company.hqCost()) }), 'info', 'company'); },
      jumpHQ: () => { const G = g(), h = G.company.hq; if (h) { this.closePanel(); G.camera.focus(tileCX(h.tile) + 1, tileCZ(h.tile) + 1, 14); } },
      weatherInfo: () => this.toast(this.weatherText(), 'info', 'w_' + (g().settings.weather ? g().env.weather : 'clear')),
      ...this.railActions(),
      ...this.liveryActions(),
      ...this.financeActions(),
      ...this.roadActions(),
      ...this.lineActions(),
      ...this.transportActions(),
      ...this.industryActions(),
      ...this.newsActions(),
      ...this.driverActions(),
      undo: () => g().construction.undo(),
      grant: () => { const n = g().economy.claimGrant(); if (n) this.toast(this.tr('grant_received', { n: fmt(n) }), 'good', 'gift'); },
      research: (a) => { const e = g().progression.doResearch(a); if (e) this.error(e); else this.refreshPanel(); },
      unlockRegion: (a) => { const e = g().progression.unlockRegion(+a); if (e) this.error(e); else { this.closePanel(); g().select(null); g().save(); } },
      focusRegion: (a) => { const c = g().world.centers[+a]; g().camera.focus(c[0] * TILE, c[1] * TILE, 40); if (window.innerWidth < 760) this.closePanel(); },
      claimContract: (a) => { const k = g().economy.contracts.find((x) => x.id === +a); if (k) { g().economy.claimContract(k); this.app.audio.play('coin'); } this.refreshPanel(); },
      rerollContract: (a) => { const k = g().economy.contracts.find((x) => x.id === +a); if (k) g().economy.rerollContract(k); this.refreshPanel(); },
      claimDaily: (a) => { const d = g().economy.daily.list[+a]; if (d) { g().economy.claimDaily(d); this.app.audio.play('coin'); } this.refreshPanel(); },
      defaultLivery: (a) => { g().progression.defaultLivery = a; this.refreshPanel(); },
      defaultStyle: (a) => { g().progression.defaultStationStyle = a; this.refreshPanel(); },
      jump: (a) => { const [type, id] = a.split(':'); const sel = { type, id: +id }; g().select(sel); g().focusOn(sel); if (window.innerWidth < 760) this.closePanel(); },
      copyDiagnostics: async () => {
        const txt = this.app.diagnostics();
        try { await navigator.clipboard.writeText(txt); this.toast(this.tr('diagnostics_copied'), 'good', 'check'); }
        catch (e) { const b = new Blob([txt], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'tracklands-diagnostics.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
      },
      help: (a) => { this.handbookTopic = a; if (this.panel !== 'handbook') this.openPanel('handbook'); else this.refreshPanel(); },
      researchCat: (a) => { this.researchCat = a; this.refreshPanel(); },
      mapMode: (a) => { this.mapMode = a === 'lines' ? 'lines' : 'geo'; this.refreshPanel(); },
      focusSel: () => { if (this.inspectSel) g().focusOn(this.inspectSel); },
      follow: (a) => { this.followId = +a; g().focusOn({ type: 'train', id: +a }, 12); },
      buyTrain: (a) => {
        const dep = g().stations.depotById(this.shopDepot);
        const r = g().trains.buy(a, dep);
        if (r.error) { this.error(r.error); return; }
        this.closePanel();
        g().select({ type: 'train', id: r.train.id });
      },
      shopFromDepot: (a) => this.openTrainShop(+a),
      upgradeStation: (a) => { const s = g().stations.byId(+a); const e = g().stations.upgrade(s); if (e) this.error(e); else this.toast(this.tr('toast_station_upgraded', { name: s.name }), 'good', 'station'); },
      upgradeTrain: (a) => { const [id, k] = a.split(':'); const t = g().trains.byId(+id); const e = g().trains.upgrade(t, k); if (e) this.error(e); else this.app.audio.play('levelUp', { vol: 0.5 }); },
      trainMode: (a) => { const [id, mode] = a.split(':'); const t = g().trains.byId(+id); t.mode = mode; if (mode === 'auto') t.filter = null; if (t.state === 'idle') t.stateT = 3; },
      routeUp: (a) => { const [id, i] = a.split(':').map(Number); const t = g().trains.byId(id); if (i > 0) [t.route[i - 1], t.route[i]] = [t.route[i], t.route[i - 1]]; },
      routeDown: (a) => { const [id, i] = a.split(':').map(Number); const t = g().trains.byId(id); if (i < t.route.length - 1) [t.route[i + 1], t.route[i]] = [t.route[i], t.route[i + 1]]; },
      routeDel: (a) => { const [id, i] = a.split(':').map(Number); const t = g().trains.byId(id); t.route.splice(i, 1); t.routeIdx = 0; },
      toggleCargo: (a) => {
        const [id, c] = a.split(':'); const t = g().trains.byId(+id);
        let f = t.filter ? [...t.filter] : [...CARGO_IDS];
        f = f.includes(c) ? f.filter((x) => x !== c) : [...f, c];
        t.filter = f.length === CARGO_IDS.length ? null : f;
      },
      renameTrain: async (a) => { const t = g().trains.byId(+a); const n = await this.prompt(this.tr('rename_train'), t.name); if (n) t.name = n.slice(0, 28); },
      sellTrain: async (a) => { const t = g().trains.byId(+a); if (await this.confirm(this.tr('confirm_sell', { name: t.name }), this.tr('sell'), true)) { g().trains.sell(t); g().select(null); } },
      tutNext: () => g().tutorial.advance(),
      tutSkip: () => g().tutorial.skip(),
      legacy: async () => { if (await this.confirm(this.tr('legacy_confirm'), this.tr('legacy_btn'), true)) this.app.foundLegacy(); },
      saveQuit: () => this.app.toTitle(),
      exportSave: () => this.app.exportSave(),
      importSave: () => this.app.importSave(),
      resetTutorial: () => { g().tutorial.restart(); g().settings.tutorial = true; this.closePanel(); },
      resetGame: async () => { if (await this.confirm(this.tr('confirm_reset'), this.tr('reset_game'), true)) this.app.resetGame(); },
    };
  }

  get inputs() {
    const g = () => this.game;
    return {
      ...this.newsInputs(),
      ...this.driverInputs(),
      ...this.lineInputs(),
      ...this.transportInputs(),
      companyName: (el) => { const v = el.value.trim().slice(0, 32); if (v && this.game) { this.game.company.name = v; this.toast(this.tr('company_renamed', { name: v }), 'info', 'company'); } },
      setting: (el) => { this.app.setSetting(el.dataset.key, parseFloat(el.value)); },
      settingBool: (el) => { this.app.setSetting(el.dataset.key, el.checked); },
      settingSel: (el) => { this.app.setSetting(el.dataset.key, el.value); },
      relMode: (el) => { if (this.game && ['off', 'relaxed', 'tycoon'].includes(el.value)) { this.game.maint.mode = el.value; this.refreshPanel(); } },
      svcAt: (el) => { const t = this.game.trains.byId(+el.dataset.id); if (t) { t.serviceAt = +el.value; this.renderInspector(); } },
      svcAuto: (el) => { const t = this.game.trains.byId(+el.dataset.id); if (t) { t.autoService = el.checked; this.renderInspector(); } },
      replTo: (el) => { const t = this.game.trains.byId(+el.dataset.id); if (!t) return; if (el.value) this.game.maint.addRule(t.model, el.value, 25, 0.55); else { const r = this.game.maint.rules.find((x) => x.from === t.model); if (r) this.game.maint.removeRule(r.id); } this.renderInspector(); },
      lang: (el) => { setLang(el.value); this.app.setSetting('lang', el.value); this.relocalize(); },
      shopDepot: (el) => { this.shopDepot = +el.value; this.refreshPanel(); },
      stationStyle: (el) => { const s = g().stations.byId(+el.dataset.id); g().stations.setStyle(s, el.value); },
      livery: (el) => { const t = g().trains.byId(+el.dataset.id); t.livery = el.value; t.visualSig = null; },
      routeAdd: (el) => {
        if (!el.value) return;
        const t = g().trains.byId(+el.dataset.id);
        const v = el.value;
        const base = { act: 'auto', dwell: 0, full: false, skip: false, plat: null, cargo: null };
        t.route.push(v[0] === 'w' ? { ...base, wp: +v.slice(1) } : { ...base, st: +v.slice(1) });
        el.blur(); if (t.state === 'idle') t.stateT = 3; this.renderInspector();
      },
      ...this.railInputs(),
      ...this.liveryInputs(),
    };
  }

  relocalize() {
    document.documentElement.lang = getLang();
    document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = this.tr(el.dataset.i18n); });
    if (this.game) { this.renderHud(); this.refreshPanel(); this.renderInspector(); this.renderGrant(); for (const el of this.labels.values()) el._sig = null; $('#tutorial')._sig = null; }
    else if (this.panel) this.refreshPanel();
    this.app.onRelocalize && this.app.onRelocalize();
  }
}

Object.assign(UI.prototype, LineUIMixin, TransportUIMixin, RailUIMixin, HandbookMixin, LiveryEditorMixin, FinanceUIMixin, AuthorityUIMixin, RoadUIMixin, IndustryUIMixin, NewsUIMixin, DriverUIMixin, ScenarioUIMixin);
