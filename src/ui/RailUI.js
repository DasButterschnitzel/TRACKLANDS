// Railway operations UI (mixed into UI): Train Builder with AUTO BUILD and
// templates, trains list with precise statuses, network advisor, schedule
// editor with per-stop options, station editor (tracks, platforms, roles,
// facilities, statistics) and the overlay menu.
import * as THREE from 'three';
import { TILE, fmt, escapeHtml, clamp, tileCX, tileCZ } from '../util.js';
import {
  CARGO, CARGO_IDS, LOCOS, WAGONS, WAGON_IDS, STATION, FACILITIES, PLATFORM_ROLES, TRAIN_UPGRADES, TRAIN_UPGRADE_MAX, KMH_PER_TILE_S, CONSIST, wagonsFor, locoLen,
} from '../config.js';
import { icon, cargoIcon } from './icons.js';
import {
  locoModel, computeStats, consistCost, validateConsist, autoBuild, wagonUnlocked, maxLocos, cloneConsist, parseConsist, serializeConsist, vehLen, assignLoads,
} from '../trains/Consist.js';
import { locoGeometry, wagonGeometry, liveryColors } from '../trains/TrainModels.js';
import { vehicleToken, resolvePaint, customToken, parseCustom, isPreset, STRIPES, cssHex, DEFAULT_LIVERY } from '../trains/Livery.js';
import { MATS } from '../core/ModelBuilder.js';
import { OVERLAYS } from './Overlays.js';
import { SPACING_CHOICES } from '../trains/Lines.js';
import { STATION_SERVICES } from '../rail/Stations.js';

const esc = escapeHtml;
const $ = (s, r = document) => r.querySelector(s);
const WAGON_GROUPS = [
  ['pax', (w) => WAGONS[w].cls === 'pax'],
  ['freight', (w) => WAGONS[w].cls === 'freight' || WAGONS[w].cls === 'mail'],
  ['service', (w) => WAGONS[w].cls === 'service'],
];

export const RailUIMixin = {
  // ---------- names ----------
  vehName(v) { return v.k === 'L' ? locoModel(v.id).name : this.tr('wag_' + v.id); },
  ratingBadge(r) { return `<span class="rating r-${r}">${this.tr('rating_' + r)}</span>`; },
  kmh(v) { return Math.round((v / TILE) * KMH_PER_TILE_S); },

  // ---------- consist preview (rendered 3/4 view of the whole train) ----------
  // Returns { url, w, h }. The image scales with the train length so a long
  // consist stays readable (its container scrolls sideways on narrow screens);
  // sel highlights one vehicle.
  consistPreview(veh, livery, cargo, scope = 'train', sel = -1) {
    const key = 'C:' + serializeConsist(veh).join(',') + ':' + livery + ':' + scope + ':' + sel + ':' + (cargo || []).map((l) => l.c + l.n).join(',');
    this.cprev = this.cprev || new Map();
    if (this.cprev.has(key)) return this.cprev.get(key);
    if (this.cprev.size > 60) this.cprev.clear();
    try {
      if (!this.cR) {
        this.cR = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
        this.cScene = new THREE.Scene();
        this.cScene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a6a, 2.3));
        const dl = new THREE.DirectionalLight(0xffffff, 1.8); dl.position.set(2, 5, 6); this.cScene.add(dl);
        this.cCam = new THREE.OrthographicCamera(-7, 7, 1.1, -1.15, 0.1, 50);
        this.cSelMat = new THREE.MeshBasicMaterial({ color: 0x2fb3a3, transparent: true, opacity: 0.55, depthWrite: false });
      }
    } catch (e) { return { url: '', w: 560, h: 150 }; }
    const lead = veh.find((v) => v.k === 'L');
    const lm = locoModel(lead ? lead.id : 'pioneer');
    const pseudo = { livery, liveryScope: scope };
    const grp = new THREE.Group();
    const st = computeStats(veh, null, this.game.progression.fx);
    const loads = assignLoads(st, cargo || []).wagons;
    let x = 0, wi = 0, vi = 0;
    const total = Math.max(1, veh.reduce((a, v) => a + vehLen(v), 0) + (veh.length - 1) * CONSIST.gap);
    for (const v of veh) {
      const len = vehLen(v);
      const tok = vehicleToken(pseudo, v);
      let geo;
      if (v.k === 'L') geo = locoGeometry(v.id, tok, 0);
      else { const w = loads[wi++]; geo = wagonGeometry(v.id, w && w.c, w && w.n ? Math.min(3, Math.ceil((w.n / Math.max(1, w.cap)) * 3)) : 0, lm.kind, resolvePaint(tok, lm), null, (vi * 3) & 3); }
      const m = new THREE.Mesh(geo, MATS);
      // front of the train on the left, matching the vehicle strip
      const cx = -total / 2 + x + len / 2;
      m.position.x = cx;
      m.rotation.y = v.r ? 0 : Math.PI;
      grp.add(m);
      if (vi === sel) {
        const plate = new THREE.Mesh(new THREE.PlaneGeometry(len + 0.1, 0.95), this.cSelMat);
        plate.rotation.x = -Math.PI / 2; plate.position.set(cx, 0.01, 0);
        grp.add(plate);
      }
      vi++;
      x += len + CONSIST.gap;
    }
    // size: ~60 px per metre of train, 560-1800 px wide, fixed height
    const W = Math.round(Math.min(1800, Math.max(560, total * 60 + 90))), H = 190;
    this.cR.setSize(W, H, false);
    const half = total / 2 + 0.45;
    const hh = half * H / W;
    this.cCam.left = -half; this.cCam.right = half; this.cCam.top = hh; this.cCam.bottom = -hh;
    // slightly from above so roofs and loads read; centred on the body
    this.cCam.position.set(0, 0.55 + 10 * Math.sin(0.22), 10 * Math.cos(0.22)); this.cCam.lookAt(0, 0.55, 0);
    this.cCam.updateProjectionMatrix();
    grp.rotation.y = 0.1;
    this.cScene.add(grp);
    this.cR.render(this.cScene, this.cCam);
    const url = this.cR.domElement.toDataURL('image/png');
    this.cScene.remove(grp);
    grp.traverse((o) => { if (o.geometry && o.geometry.type === 'PlaneGeometry') o.geometry.dispose(); });
    const out = { url, w: W, h: H };
    this.cprev.set(key, out);
    return out;
  },
  vehLenOf(v) { return vehLen(v); },
  consistGap() { return CONSIST.gap; },
  // preview block: scrolls sideways for long trains; a tap picks the vehicle under it
  previewBlock(vs, livery, cargo, scope, sel, act) {
    const p = this.consistPreview(vs, livery, cargo, scope, sel);
    return `<div class="bpreview" data-n="${vs.length}"><img alt="" src="${p.url}" width="${p.w}" height="${p.h}" style="aspect-ratio:${p.w}/${p.h};min-width:min(100%, ${Math.round(p.w * 0.62)}px)" ${act ? `data-act="${act}" data-pick="1"` : ''} draggable="false"/></div>`;
  },

  // ---------- Train Builder ----------
  openBuilder(opts) {
    const g = this.game;
    const b = { trainId: null, depotId: null, veh: [], sel: -1, cat: 'loco', replace: false, cargos: new Set(), name: '', livery: g.progression.defaultLivery, liveryScope: 'train' };
    if (opts.trainId != null) {
      const t = g.trains.byId(opts.trainId);
      if (!t) return;
      b.trainId = t.id; b.veh = cloneConsist(t.pendingVeh || t.veh); b.name = t.name; b.livery = t.livery; b.liveryScope = t.liveryScope || 'train';
      for (const c in t._st.caps) b.cargos.add(c);
    } else {
      const deps = g.stations.depots;
      const dep = g.stations.depotById(opts.depotId) || deps.find((d) => g.net.conn[d.tile]) || deps[0];
      b.depotId = dep ? dep.id : null;
      const m = opts.model || LOCOS.filter((x) => g.progression.locoUnlocked(x)).pop()?.id || 'pioneer';
      b.veh = g.trains.defaultConsist(m, dep);
      for (const v of b.veh) if (v.k === 'W') for (const c of WAGONS[v.id].carries) b.cargos.add(c);
    }
    this.bld = b;
    this.openPanel('builder', Math.random());
  },

  builderPlatformFit(vs) {
    const g = this.game;
    const L = computeStats(vs, null, g.progression.fx).length;
    const b = this.bld;
    let stations = g.stations.list;
    const t = b.trainId != null ? g.trains.byId(b.trainId) : null;
    if (t && t.mode === 'manual' && t.route.length) stations = t.route.map((r) => g.stations.byId(r.st)).filter(Boolean);
    let shortest = Infinity;
    for (const s of stations) for (const tk of s.tracks) shortest = Math.min(shortest, tk.tiles.length);
    const needTiles = Math.ceil((L - 0.6) / TILE);
    return { L, needTiles: Math.max(1, needTiles), shortest: isFinite(shortest) ? shortest : 0 };
  },

  pBuilder() {
    const g = this.game, P = g.progression, b = this.bld;
    if (!b) return '';
    const R = P.research;
    const vs = b.veh;
    const t = b.trainId != null ? g.trains.byId(b.trainId) : null;
    const st = computeStats(vs, t ? t.upg : null, P.fx);
    const err = validateConsist(vs, R);
    // strip
    const strip = vs.map((v, i) => {
      const lock = v.k === 'L' && !P.locoUnlocked(locoModel(v.id));
      return `<button class="vchip ${v.k === 'L' ? 'loco' : ''} ${b.sel === i ? 'on' : ''} ${lock ? 'bad' : ''}" data-act="bldSel" data-arg="${i}" data-tip="${esc(this.vehName(v))}">${icon(v.k === 'L' ? 'loco' : 'wagon')}<span>${esc(v.k === 'L' ? locoModel(v.id).name.split(' ')[0] : this.tr('wag_' + v.id + '_s'))}</span>${v.k === 'L' ? `<i class="dir">${v.r ? '▶' : '◀'}</i>` : ''}</button>`;
    }).join('');
    const selV = vs[b.sel];
    const selRow = selV ? `<div class="row wrap tight"><button class="btn small" data-act="bldMove" data-arg="-1" ${b.sel <= 0 ? 'disabled' : ''}>${icon('left')}</button><button class="btn small" data-act="bldMove" data-arg="1" ${b.sel >= vs.length - 1 ? 'disabled' : ''}>${icon('right')}</button>
      ${selV.k === 'L' ? `<button class="btn small" data-act="bldFlip">${icon('flip')} ${this.tr('bld_turn')}</button>` : ''}
      <button class="btn small ${b.replace ? 'primary' : ''}" data-act="bldReplace">${this.tr('bld_replace')}</button>
      <button class="btn small danger" data-act="bldRemove">${icon('minus')} ${this.tr('remove')}</button></div>` : `<p class="muted small">${this.tr('bld_select_hint')}</p>`;
    // stats
    const fit = this.builderPlatformFit(vs);
    const capRows = Object.keys(st.caps).filter((c) => st.caps[c] > 0).map((c) => `<span class="cap" data-tip="${this.cargoName(c)}">${cargoIcon(c)}${st.caps[c]}</span>`).join('') || `<span class="muted">${this.tr('bld_no_cargo')}</span>`;
    const fullMass = Math.round(st.power / Math.max(0.01, st.ratioFull));
    const cost = t ? g.trains.consistChangeCost(t, vs) : { net: consistCost(vs, g.economy.costs) };
    const stats = `<div class="bstats">
      <div><small>${this.tr('bld_length')}</small><b>${(st.length / TILE).toFixed(1)} ${this.tr('tiles')}</b></div>
      <div><small>${this.tr('bld_mass')}</small><b>${Math.round(st.emptyMass)}–${fullMass} t</b></div>
      <div><small>${this.tr('stat_power')}</small><b>${fmt(st.power)} kW</b></div>
      <div><small>${this.tr('bld_rating')}</small>${this.ratingBadge(st.rating)}</div>
      <div><small>${this.tr('bld_vmax')}</small><b>${Math.round(st.speed)} km/h</b></div>
      <div><small>${this.tr('stat_accel')}</small><b>${st.accel.toFixed(2)}</b></div>
      <div><small>${this.tr('stat_op')}</small><b>${fmt(Math.round(st.op))}/${this.tr('min')}</b></div>
      <div><small>${this.tr('bld_priority')}</small><b>${this.tr('prio_' + st.priority)}</b></div>
    </div>
    <div class="caps">${capRows}</div>
    <div class="card ${fit.needTiles > fit.shortest && fit.shortest ? 'warn' : ''} small">${icon('station', 'mini')} ${this.tr('bld_fit', { n: fit.needTiles, s: fit.shortest || '-' })}</div>
    ${st.rating === 'overloaded' ? `<div class="card warn small">${icon('warn', 'mini')} ${this.tr('bld_overloaded')}</div>` : st.rating === 'heavy' ? `<div class="card small">${icon('info', 'mini')} ${this.tr('bld_heavy')}</div>` : ''}
    ${!vs.some((v, i) => i === 0 && (v.k === 'L' || WAGONS[v.id]?.cab)) && vs.length ? `<div class="card small">${icon('info', 'mini')} ${this.tr('bld_front_hint')}</div>` : ''}`;
    // palette
    const cats = ['loco', 'pax', 'freight', 'service'];
    const tabs = `<div class="seg">${cats.map((c) => `<button class="${b.cat === c ? 'on' : ''}" data-act="bldCat" data-arg="${c}">${this.tr('bld_cat_' + c)}</button>`).join('')}</div>`;
    let items = '';
    if (b.cat === 'loco') {
      items = LOCOS.map((m) => {
        const ok = P.locoUnlocked(m);
        return `<button class="pitem ${ok ? '' : 'locked'}" data-act="bldAdd" data-arg="L:${m.id}" ${ok ? '' : 'disabled'} data-tip="${ok ? esc(this.tr('trait_' + m.trait)) : esc(this.locoUnlockText(m))}">
          ${ok ? '' : icon('lock', 'mini')}<b>${esc(m.name)}</b><small>${m.speed} km/h · ${fmt(m.power)} kW · ${(locoLen(m) / TILE).toFixed(1)} ${this.tr('tiles')}</small><span class="price">${fmt(g.economy.costs.train(m))}●</span></button>`;
      }).join('');
    } else {
      const grp = WAGON_GROUPS.find(([k]) => k === b.cat);
      items = WAGON_IDS.filter(grp[1]).map((id) => {
        const w = WAGONS[id];
        const ok = wagonUnlocked(id, R);
        return `<button class="pitem ${ok ? '' : 'locked'}" data-act="bldAdd" data-arg="W:${id}" ${ok ? '' : 'disabled'} data-tip="${esc(ok ? this.tr('wag_' + id + '_desc') : this.tr('requires') + ': ' + this.tr('res_' + w.research))}">
          ${ok ? '' : icon('lock', 'mini')}<b>${this.tr('wag_' + id)}</b><small>${w.cap ? `${w.cap}× ` : ''}${w.carries.map((c) => cargoIcon(c, 'mini')).join('')}${w.brake ? this.tr('bld_brake') : ''} · ${(w.len / TILE).toFixed(1)} ${this.tr('tiles')}</small><span class="price">${fmt(Math.round(w.cost * g.economy.costs.mul()))}●</span></button>`;
      }).join('');
    }
    // auto build
    const cargoChips = CARGO_IDS.map((c) => `<button class="chip mini ${b.cargos.has(c) ? 'on' : ''}" data-act="bldCargo" data-arg="${c}" data-tip="${this.cargoName(c)}">${cargoIcon(c)}</button>`).join('');
    // templates
    const tpls = (P.templates || []).map((tp, i) => `<div class="tpl"><button class="tag link" data-act="bldTpl" data-arg="${i}">${esc(tp.name)}</button><button class="icon-btn small" data-act="bldTplDel" data-arg="${i}" aria-label="${this.tr('remove')}">${icon('close')}</button></div>`).join('');
    const depots = g.stations.depots;
    const lm0 = locoModel((vs.find((v) => v.k === 'L') || { id: 'pioneer' }).id);
    const liv = P.liveries().map((l) => this.swatch(l.id, lm0, b.livery === l.id, 'bldLiv', l.id, this.tr('liv_' + l.id))).join('') + (parseCustom(b.livery) ? this.swatch(b.livery, lm0, true, 'bldLiv', b.livery, this.tr('liv_custom')) : '');
    const buyErr = !t ? (err || g.trains.canBuy(vs, g.stations.depotById(b.depotId))) : err;
    const main = t
      ? `<button class="btn primary" data-act="bldApply" ${err || (cost.net > 0 && !g.economy.canAfford(cost.net)) ? 'disabled' : ''}>${icon('check')} ${this.tr('bld_apply')} · ${cost.net >= 0 ? fmt(cost.net) + '●' : '+' + fmt(-cost.net) + '●'}</button>`
      : `<button class="btn primary" data-act="bldBuy" ${buyErr ? `disabled data-tip="${this.tr(buyErr)}"` : ''}>${icon('coin', 'mini')} ${this.tr('buy_train')} · ${fmt(cost.net)}●</button>`;
    return `${this.previewBlock(vs, b.livery, t ? t.cargo : null, b.liveryScope, b.sel, 'bldPickVeh')}
      <div class="vstrip" role="list">${strip || `<span class="muted">${this.tr('bld_empty')}</span>`}</div>
      ${selRow}
      ${err ? `<div class="card warn small">${icon('warn', 'mini')} ${this.tr(err)}</div>` : ''}
      ${stats}
      <div class="row wrap">${main}${t ? `<button class="btn ghost" data-act="bldDuplicate">${this.tr('bld_duplicate')}</button>` : ''}</div>
      ${t && t.pendingVeh ? `<p class="muted small">${this.tr('bld_pending')}</p>` : ''}
      <h4>${this.tr('bld_add')}</h4>${tabs}<div class="palette">${items}</div>
      <h4>${icon('auto', 'mini')} ${this.tr('bld_auto')}</h4><p class="muted small">${this.tr('bld_auto_desc')}</p><div class="chips wrap">${cargoChips}</div>
      <div class="row wrap"><button class="btn" data-act="bldAuto">${icon('auto')} ${this.tr('bld_auto_btn')}</button><button class="btn ghost" data-act="bldAutoFit">${this.tr('bld_auto_fit')}</button></div>
      <h4>${this.tr('bld_details')}</h4>
      <label class="set"><span>${this.tr('name')}</span><input class="inp" maxlength="28" value="${esc(b.name || '')}" placeholder="${this.tr('auto_name')}" data-change="bldName"/></label>
      <h4>${icon('palette', 'mini')} ${this.tr('livery')}</h4><div class="swatches lv-grid small">${liv}</div>
      ${t ? `<button class="btn ghost small" data-act="livery" data-arg="${t.id}">${icon('palette', 'mini')} ${this.tr('liv_open_editor')}</button>` : ''}
      <div class="seg small" role="group" aria-label="${this.tr('livery_scope')}"><button class="${b.liveryScope !== 'loco' ? 'on' : ''}" data-act="bldLiveryScope" data-arg="train">${this.tr('livery_scope_train')}</button><button class="${b.liveryScope === 'loco' ? 'on' : ''}" data-act="bldLiveryScope" data-arg="loco">${this.tr('livery_scope_loco')}</button></div>
      ${!t ? `<label class="set"><span>${this.tr('depot')}</span><select data-change="bldDepot">${depots.map((d) => `<option value="${d.id}" ${d.id === b.depotId ? 'selected' : ''}>${esc(d.name)}${g.net.conn[d.tile] ? '' : ' — ' + this.tr('not_connected')}</option>`).join('')}</select></label>` : ''}
      <h4>${this.tr('bld_templates')}</h4><div class="tpls">${tpls || `<span class="muted small">${this.tr('bld_no_templates')}</span>`}</div>
      <button class="btn ghost small" data-act="bldSaveTpl">${this.tr('bld_save_tpl')}</button>`;
  },

  // ---------- trains list + advisor ----------
  statusText(t) {
    const s = this.game.trains.statusOf(t);
    return { text: this.tr(s.key, s.p || {}), warn: s.warn };
  },
  pTrains() {
    const g = this.game;
    const tab = this.trainsTab || 'trains';
    const tabs = `<div class="seg tabs" role="tablist">${['trains', 'lines', 'fleet'].map((k) => `<button role="tab" aria-selected="${tab === k}" class="${tab === k ? 'on' : ''}" data-act="trainsTab" data-arg="${k}">${this.tr('tab_' + k)}</button>`).join('')}</div>`;
    const head = `<div class="row wrap"><button class="btn primary" data-act="newTrain">${icon('plus')} ${this.tr('buy_train')}</button><button class="btn ghost" data-act="overlay" data-arg="routes">${icon('route')} ${this.tr('ov_routes')}</button></div>${tabs}`;
    if (tab === 'lines') return head + this.pLines();
    if (tab === 'fleet') return head + this.pFleet();
    const row = (t) => {
      const s = this.statusText(t);
      const pct = Math.round(g.trains.fillRatio(t) * 100);
      const line = t.mode === 'manual' ? g.lines.of(t) : null;
      return `<div class="trow ${s.warn ? 'warn' : ''}"><button class="trow-main" data-act="jump" data-arg="train:${t.id}"><b>${line ? `<i class="lc-dot" style="background:${line.color}"></i>` : ''}${esc(t.name)}</b><small>${esc(s.text)}</small></button>
        <span class="trow-meta"><small>${this.kmh(t.v)} km/h · ${pct}%</small>${this.ratingBadge(t._st.rating)}<small>${fmt(t.earned)}●</small></span>
        <span class="trow-btns"><button class="icon-btn small" data-act="follow" data-arg="${t.id}" data-tip="${this.tr('follow')}">${icon('focus')}</button><button class="icon-btn small" data-act="builder" data-arg="${t.id}" data-tip="${this.tr('train_builder')}">${icon('builder')}</button></span></div>`;
    };
    // train groups: one block per group, ungrouped trains last
    const groups = new Map();
    for (const t of g.trains.trains) { const k = t.group || ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); }
    const keys = [...groups.keys()].sort((a, b) => (a === '') - (b === '') || a.localeCompare(b));
    const rows = keys.map((k) => {
      const ts = groups.get(k);
      const inc = ts.reduce((a, t) => a + (t.incomeEma || 0), 0);
      const hdr = keys.length > 1 || k ? `<h4 class="grp">${k ? esc(k) : this.tr('group_other')}<small>${ts.length} · ≈${fmt(Math.round(inc))}●/${this.tr('min')}</small></h4>` : '';
      return hdr + ts.map(row).join('');
    }).join('');
    const adv = g.advisor();
    const advH = adv.length ? adv.slice(0, 8).map((a) => {
      const jump = a.station != null ? `station:${a.station}` : a.train != null ? `train:${a.train}` : null;
      return `<div class="adv" ${a.preview && a.preview.length ? `data-preview="${a.preview.join(',')}" data-ok="1"` : ''}>${icon('advisor', 'mini')}<span>${a.name ? `<b>${esc(a.name)}:</b> ` : ''}${esc(this.tr(a.key, a.p || {}))}</span>${jump ? `<button class="icon-btn small" data-act="jump" data-arg="${jump}">${icon('focus')}</button>` : a.tile >= 0 ? `<button class="icon-btn small" data-act="jumpTile" data-arg="${a.tile}">${icon('focus')}</button>` : ''}</div>`;
    }).join('') : `<p class="muted small">${this.tr('adv_none')}</p>`;
    return `${head}
      <h3>${icon('advisor', 'mini')} ${this.tr('advisor')} ${this.helpBtn('single')}</h3>${advH}
      <h3>${this.tr('trains')} (${g.trains.trains.length})</h3><div class="tlist">${rows || `<p class="muted">${this.tr('no_trains')}</p>`}</div>`;
  },

  // lines: timetabled trains that share their stops
  pLines() {
    const g = this.game;
    const L = g.lines.list();
    if (!L.length) return `<p class="muted">${this.tr('lines_empty')} ${this.helpBtn('lines')}</p>`;
    return L.map((l) => {
      const inc = g.lines.income(l);
      const sp = l.trains[0].spacing || 0;
      const same = l.trains.every((t) => (t.spacing || 0) === sp);
      const iv = g.lines.headway(l);
      return `<div class="line-card" style="--lc:${l.color}">
        <div class="ln-head"><i class="lc-dot"></i><b>${esc(g.lines.name(l))}</b><small>${this.tr(l.trains.length === 1 ? 'line_trains_1' : 'line_trains', { n: l.trains.length })} · ≈${fmt(Math.round(inc))}●/${this.tr('min')}${iv ? ' · ' + this.tr('pax_every', { n: iv < 60 ? '<1' : Math.round(iv / 60) }) : ''}</small></div>
        ${this.lineDiagram(l)}
        <div class="row wrap"><label class="set compact"><span>${this.tr('tt_spacing')}</span><select data-change="lineSpacing" data-key="${esc(l.key)}">${this.spacingOptions(same ? sp : null)}</select></label>
        <button class="btn small" data-act="lineAdd" data-arg="${l.trains[0].id}">${icon('plus')} ${this.tr('line_add_train')}</button></div></div>`;
    }).join('') + `<p class="muted small">${this.tr('tt_help')} ${this.helpBtn('lines')}</p>`;
  },
  spacingOptions(cur) {
    return `${cur == null ? '<option value="" selected>—</option>' : ''}${SPACING_CHOICES.map((v) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${v === 0 ? this.tr('tt_off') : v < 0 ? this.tr('tt_even') : this.tr('tt_every', { n: v / 60 })}</option>`).join('')}`;
  },

  // route overview: stops in order with the line's trains between/at them
  lineDiagram(l, focus) {
    const g = this.game, S = g.stations;
    const at = l.stops.map(() => []), to = l.stops.map(() => []);
    for (const t of l.trains) {
      const i = l.stops.indexOf(t.target);
      if (i < 0) continue;
      (t.state === 'load' || t.state === 'depart' ? at : to)[i].push(t);
    }
    const mark = (t) => `<button class="tmark ${t === focus ? 'me' : ''}" data-act="jump" data-arg="train:${t.id}" data-tip="${esc(t.name)}" aria-label="${esc(t.name)}">${icon('train', 'mini')}</button>`;
    const parts = l.stops.map((id, i) => `<span class="lseg">${to[i].map(mark).join('')}</span><span class="lnode"><button class="tag link" data-act="jump" data-arg="station:${id}">${esc((S.byId(id) || {}).name || '?')}</button>${at[i].map(mark).join('')}</span>`);
    return `<div class="ldiag" style="--lc:${l.color}">${parts.join('')}<span class="lseg back" aria-hidden="true">↺</span></div>`;
  },

  // fleet: locomotive models in use and bulk replacement
  pFleet() {
    const g = this.game, P = g.progression;
    const use = new Map();
    for (const t of g.trains.trains) for (const v of t.pendingVeh || t.veh) if (v.k === 'L') { if (!use.has(v.id)) use.set(v.id, new Set()); use.get(v.id).add(t); }
    if (!use.size) return `<p class="muted">${this.tr('no_trains')}</p>`;
    this.fleetPick = this.fleetPick || {};
    const unlocked = LOCOS.filter((m) => P.locoUnlocked(m));
    const rows = [...use.entries()].sort((a, b) => b[1].size - a[1].size).map(([id, set]) => {
      const m = locoModel(id);
      const ts = [...set];
      const cands = unlocked.filter((x) => x.id !== id).sort((a, b) => b.speed - a.speed);
      const pick = cands.find((x) => x.id === this.fleetPick[id]) || null;
      let cost = 0;
      if (pick) for (const t of ts) cost += g.trains.consistChangeCost(t, (t.pendingVeh || t.veh).map((v) => (v.k === 'L' && v.id === id ? { ...v, id: pick.id } : v))).net;
      const opts = `<option value="">${this.tr('fleet_replace')}…</option>${cands.map((x) => `<option value="${x.id}" ${pick && pick.id === x.id ? 'selected' : ''}>${esc(x.name)} · ${Math.round(x.speed)} km/h</option>`).join('')}`;
      const inc = ts.reduce((a, t) => a + (t.incomeEma || 0), 0);
      return `<div class="fleet-row"><div class="fr-head"><b>${esc(m.name)}</b><small>${ts.length}× · ${Math.round(m.speed)} km/h · ≈${fmt(Math.round(inc))}●/${this.tr('min')}</small></div>
        <div class="row wrap"><select data-change="fleetPick" data-id="${id}" aria-label="${this.tr('fleet_replace')}">${opts}</select>
        <button class="btn small ${pick ? 'primary' : ''}" data-act="fleetReplace" data-arg="${id}" ${pick && (cost <= 0 || g.economy.canAfford(cost)) ? '' : 'disabled'}>${this.tr('fleet_replace_btn')}${pick ? ` · ${cost >= 0 ? fmt(cost) + '●' : '+' + fmt(-cost) + '●'}` : ''}</button></div></div>`;
    }).join('');
    return `${rows}<p class="muted small">${this.tr('fleet_help')}</p>`;
  },

  // timetable & line block in the train inspector (manual routes)
  lineBlock(t) {
    const g = this.game;
    const l = g.lines.of(t);
    const iv = g.lines.interval(t);
    return `${l ? `<div class="ln-head small"><i class="lc-dot" style="background:${l.color}"></i><b>${esc(g.lines.name(l))}</b><small>${this.tr(l.trains.length === 1 ? 'line_trains_1' : 'line_trains', { n: l.trains.length })}</small></div>${this.lineDiagram(l, t)}` : ''}
      <label class="set"><span>${this.tr('tt_spacing')}</span><select data-change="trainSpacing" data-id="${t.id}">${this.spacingOptions(t.spacing || 0)}</select></label>
      ${t.spacing ? `<p class="muted small">${iv ? this.tr('tt_active', { n: (iv / 60).toFixed(1) }) : this.tr('tt_learning')}</p>` : ''}`;
  },
  groupSelect(t) {
    const names = [...new Set(this.game.trains.trains.map((x) => x.group).filter(Boolean))].sort();
    return `<label class="set"><span>${this.tr('group')}</span><select data-change="trainGroup" data-id="${t.id}"><option value="">${this.tr('group_none')}</option>${names.map((n) => `<option value="${esc(n)}" ${t.group === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}<option value="__new">${this.tr('group_new')}</option></select></label>`;
  },

  // ---------- train inspector ----------
  iTrain(t) {
    const g = this.game, st = t._st, m = st.model;
    const s = this.statusText(t);
    const sname = (id) => esc(g.stations.byId(id)?.name || '');
    const cargo = t.cargo.map((l) => this.cargoRow(l.c, l.n, 0, `<small class="muted">${sname(l.from)}${l.to != null ? ` → ${sname(l.to)}${l.via != null ? ` · ${this.tr('pax_via', { name: sname(l.via) })}` : ''}` : ''}</small>`)).join('') || `<p class="muted">${this.tr('empty')}</p>`;
    const loadN = g.trains.loadTotal(t);
    const upg = TRAIN_UPGRADES.map((k) => {
      const lvl = t.upg[k];
      const cost = g.economy.costs.trainUpgrade(m, lvl);
      const pips = Array.from({ length: TRAIN_UPGRADE_MAX }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('');
      return `<div class="upg"><span data-tip="${this.tr('upg_' + k + '_desc')}">${this.tr('upg_' + k)}</span><span class="pips">${pips}</span>${lvl >= TRAIN_UPGRADE_MAX ? `<small class="good">${this.tr('max')}</small>` : `<button class="btn small" data-act="upgradeTrain" data-arg="${t.id}:${k}" ${g.economy.canAfford(cost) ? '' : 'disabled'}>${fmt(cost)}●</button>`}</div>`;
    }).join('');
    const mini = t.veh.map((v) => `<i class="mv ${v.k === 'L' ? 'l' : ''}" title="${esc(this.vehName(v))}"></i>`).join('');
    const caps = Object.keys(st.caps).filter((c) => st.caps[c]).map((c) => `<span class="cap">${cargoIcon(c)}${st.caps[c]}</span>`).join('');
    return `<div class="pill-row"><span class="pill">${esc(m.name)}${st.locos.length > 1 ? ` ×${st.locos.length}` : ''}</span><span class="pill">${this.tr('prio_' + st.priority)}</span>${this.ratingBadge(st.rating)}</div>
      <div class="tstatus ${s.warn ? 'warn' : ''}">${icon(s.warn ? 'warn' : 'route')}<span>${esc(s.text)}</span><small>${this.kmh(t.v)} km/h</small></div>
      ${this.trainActions(t)}
      ${t.state === 'stored' ? `<div class="card small">${icon('depot', 'mini')} ${this.tr('depot_parked_hint')}</div>` : ''}
      <button class="consist-mini" data-act="builder" data-arg="${t.id}" data-tip="${this.tr('train_builder')}"><span class="mvs">${mini}</span><span>${icon('builder', 'mini')} ${this.tr('train_builder')}</span></button>
      <div class="kv-grid small"><div><b>${fmt(t.earned)}</b><small>${this.tr('earned')}</small></div><div><b>${t.trips}</b><small>${this.tr('trips')}</small></div><div><b>${Math.round(st.speed)}</b><small>km/h max</small></div><div><b>${fmt(Math.round(st.op))}/${this.tr('min')}</b><small>${this.tr('stat_op')}</small></div></div>
      <h4>${this.tr('fin_heading')}</h4>${this.finBlock(t)}<p class="muted small">${this.tr('fin_train_value', { v: fmt(Math.round(g.ledger.vehicleValue(t))), age: this.ageText(g.time - (t.bought || 0)) })}</p>
      ${this.condBlock(t)}
      <h4>${this.tr('cargo')} · ${loadN}/${st.capFull}</h4><div class="caps">${caps || `<span class="muted small">${this.tr('bld_no_cargo')}</span>`}</div>${cargo}
      <h4 id="tr-route">${this.tr('routing')}</h4><div class="seg"><button class="${t.mode === 'auto' ? 'on' : ''}" data-act="trainMode" data-arg="${t.id}:auto">${this.tr('mode_auto')} <small>(${this.tr('recommended')})</small></button><button class="${t.mode === 'manual' ? 'on' : ''}" data-act="trainMode" data-arg="${t.id}:manual">${this.tr('mode_manual')}</button></div>
      ${t.mode === 'manual' ? this.lineBlock(t) + this.scheduleEditor(t) : `<p class="muted small">${this.tr('auto_desc')}</p>`}
      <h4 id="tr-upg">${this.tr('upgrades')}</h4>${upg}
      ${this.groupSelect(t)}
      <div class="row wrap"><button class="btn ghost" data-act="follow" data-arg="${t.id}">${icon('focus')} ${this.tr('follow')}</button><button class="btn ghost" data-act="renameTrain" data-arg="${t.id}">${this.tr('rename')}</button><button class="btn danger" data-act="sellTrain" data-arg="${t.id}">${this.tr('sell')} (${fmt(g.trains.sellValue(t))}●)</button></div>`;
  },

  // service type (passenger / freight / mixed) and layout (through / terminus / hybrid)
  serviceBlock(s) {
    const S = this.game.stations, sv = s.service || 'mixed', lt = S.layoutType(s);
    const seg = STATION_SERVICES.map((k) => `<button class="${sv === k ? 'on' : ''}" data-act="stService" data-arg="${s.id}:${k}" aria-pressed="${sv === k}" data-tip="${this.tr('svc_' + k + '_desc')}">${this.tr('svc_' + k)}</button>`).join('');
    return `<div class="svc-row"><span class="sub-label">${this.tr('svc_label')}</span><div class="seg small" role="group" aria-label="${this.tr('svc_label')}">${seg}</div><span class="pill" data-tip="${this.tr('lay_' + lt + '_desc')}">${this.tr('lay_' + lt)}</span></div>
      <p class="muted small">${this.tr('svc_' + sv + '_desc')}</p>`;
  },
  stationActions(s, up) {
    const b = (act, arg, ic, label, dis = false, tip = '') => `<button class="tact" data-act="${act}" data-arg="${arg}" ${dis ? 'disabled' : ''} ${tip ? `data-tip="${esc(tip)}"` : ''}>${icon(ic)}<span>${label}</span></button>`;
    return `<div class="tactions st" role="toolbar" aria-label="${this.tr('station_actions')}">
      ${b('stExtendTool', s.id, 'right', this.tr('act_extend'), false, this.tr('act_extend_tip'))}
      ${b('scrollTo', '#st-plats', 'plus', this.tr('act_add_track'))}
      ${b('scrollTo', '#st-up', 'up', this.tr('act_upgrade'), up.max)}
      ${b('stRoutes', s.id, 'route', this.tr('act_routes'))}
      ${b('scrollTo', '#st-stats', 'stats', this.tr('act_stats'))}
      ${b('stRename', s.id, 'builder', this.tr('rename'))}
      ${b('stDemolish', s.id, 'bulldoze', this.tr('act_demolish'))}
    </div>`;
  },
  // the actions a player needs most, one tap away (touch first)
  trainActions(t) {
    const g = this.game;
    const b = (act, arg, ic, label, cls = '', dis = false) => `<button class="tact ${cls}" data-act="${act}" data-arg="${arg}" ${dis ? 'disabled' : ''}>${icon(ic)}<span>${label}</span></button>`;
    let depot;
    if (t.state === 'stored') depot = b('depotRelease', t.id, 'play', this.tr('depot_release'), 'hl');
    else if (t.depotOrder || t.tgtKind === 'depot') depot = b('depotCancel', t.id, 'close', this.tr('depot_cancel'));
    else depot = b('depotSend', t.id, 'depot', this.tr('depot_send'), '', !g.stations.depots.length && false);
    return `<div class="tactions" role="toolbar" aria-label="${this.tr('train_actions')}">
      ${b('builder', t.id, 'builder', this.tr('act_edit_train'))}
      ${b('scrollTo', '#tr-route', 'route', this.tr('act_route'))}
      ${depot}
      ${b('livery', t.id, 'palette', this.tr('livery'))}
      ${b('follow', t.id, 'focus', this.tr('follow'), '', t.state === 'stored')}
      ${b('scrollTo', '#tr-upg', 'up', this.tr('act_upgrade'))}
    </div>${t.state !== 'stored' && !t.depotOrder && g.stations.depots.length > 1 ? `<button class="btn ghost small link" data-act="depotChoose" data-arg="${t.id}">${this.tr('depot_choose')}</button>` : ''}`;
  },
  depotResult(t, r) {
    if (r.ok) { this.toast(this.tr('depot_sent', { name: t.name, depot: r.depot ? r.depot.name : '' }), 'info', 'depot'); this.renderInspector(); return; }
    const g = this.game;
    const w = this.modal(`<h3>${icon('warn')} ${this.tr('depot_' + r.reason)}</h3><p>${this.tr('depot_' + r.reason + '_desc')}</p>
      <div class="row end"><button class="btn ghost" data-mbtn="no">${this.tr('cancel')}</button><button class="btn primary" data-mbtn="build">${icon('depot', 'mini')} ${this.tr('depot_build')}</button></div>`, { onCancel: () => {} });
    w.querySelector('[data-mbtn=no]').onclick = () => w.remove();
    w.querySelector('[data-mbtn=build]').onclick = () => { w.remove(); g.select(null); g.construction.setTool('depot'); };
    // show where the nearest depot is, if there is one
    const d = g.stations.depots[0];
    if (d && r.reason === 'no_depot_route') g.camera.focus(tileCX(d.tile), tileCZ(d.tile));
  },
  // Building where a train is: offer a pending construction that starts as
  // soon as the section is clear (Works). Cancel = nothing happens.
  offerWorks(kind, a) {
    const g = this.game, W = g.works;
    const p = W.probe(kind, a);
    if (p.error) { this.error(p.error); return; }
    const who = W.blockers(p.zone);
    const names = who.length ? who.slice(0, 3).map((t) => esc(t.name)).join(', ') + (who.length > 3 ? ' …' : '') : this.tr('works_a_train');
    document.querySelectorAll('.modal.works').forEach((m) => m.closest('.modal-wrap').remove());
    const w = this.modal(`<h3>${icon('warn')} ${this.tr('works_title')}</h3>
      <p>${this.tr('works_desc', { train: names })}</p>
      <p class="muted small">${this.tr('works_note')}</p>
      <div class="row between"><span>${this.tr('works_cost')}</span><b>${fmt(p.cost)} ●</b></div>
      <div class="row end"><button class="btn ghost" data-mbtn="no">${this.tr('cancel')}</button><button class="btn primary" data-mbtn="ok" ${g.economy.canAfford(p.cost) ? '' : 'disabled'}>${icon('check', 'mini')} ${this.tr('works_confirm')}</button></div>`, { cls: 'works', onCancel: () => {} });
    w.querySelector('[data-mbtn=no]').onclick = () => w.remove();
    w.querySelector('[data-mbtn=ok]').onclick = () => {
      w.remove();
      const r = W.add(kind, a);
      if (r.error) { this.error(r.error); return; }
      g.construction.clearPreview && g.construction.clearPreview();
      g.audio.play('construct');
      this.toast(this.tr('works_added'), 'info', 'track');
    };
  },
  depotChooser(t) {
    const g = this.game;
    const ch = g.trains.depotChoices(t);
    if (!ch.length) { this.depotResult(t, { ok: false, reason: g.stations.depots.length ? 'no_depot_route' : 'no_depot' }); return; }
    const tps = Math.max(0.1, t._st.speed / KMH_PER_TILE_S) * 0.7;
    const rows = ch.map((c, i) => `<button class="btn ${i ? 'ghost' : 'primary'} wide" data-mbtn="${c.dep.id}">${icon('depot', 'mini')} ${esc(c.dep.name)} <small>${Math.round(c.cost)} ${this.tr('tiles')} · ~${Math.max(5, Math.round(c.cost / tps))} s${i === 0 ? ' · ' + this.tr('nearest') : ''}</small></button>`).join('');
    const w = this.modal(`<h3>${this.tr('depot_choose')}</h3><div class="col">${rows}</div><div class="row end"><button class="btn ghost" data-mbtn="no">${this.tr('cancel')}</button></div>`, { onCancel: () => {} });
    w.querySelectorAll('[data-mbtn]').forEach((el) => { el.onclick = () => { w.remove(); if (el.dataset.mbtn !== 'no') this.depotResult(t, g.trains.orderDepot(t, +el.dataset.mbtn, true)); }; });
  },

  scheduleEditor(t) {
    const g = this.game;
    const stations = g.stations.list;
    const wps = [...g.net.waypoints].map(([tile, w]) => ({ tile, name: w.name }));
    const carry = CARGO_IDS.filter((c) => t._st.caps[c]);
    this.openStop = this.openStop || {};
    const rows = t.route.map((r, i) => {
      const s = r.st != null ? g.stations.byId(r.st) : null;
      const name = s ? s.name : r.wp != null ? (g.net.waypoints.get(r.wp) || {}).name || '?' : '?';
      const cur = i === t.routeIdx % Math.max(1, t.route.length);
      const open = this.openStop[t.id] === i;
      const summary = r.wp != null ? this.tr('stop_via') : [r.act !== 'auto' ? this.tr('act_' + r.act) : '', r.full ? this.tr('stop_full') : '', r.dwell ? `+${r.dwell}s` : '', r.plat != null ? 'P' + (r.plat + 1) : '', r.cargo && r.cargo.length ? r.cargo.map((c) => cargoIcon(c, 'mini')).join('') : ''].filter(Boolean).join(' · ');
      let opts = '';
      if (open && s) {
        opts = `<div class="stop-opts">
          <label class="set"><span>${this.tr('stop_action')}</span><select data-change="stopAct" data-id="${t.id}" data-i="${i}">${['auto', 'load', 'unload', 'transfer', 'none'].map((a) => `<option value="${a}" ${r.act === a ? 'selected' : ''}>${this.tr('act_' + a)}</option>`).join('')}</select></label>
          <label class="set tog"><span>${this.tr('stop_full')}</span><input type="checkbox" ${r.full ? 'checked' : ''} data-change="stopFull" data-id="${t.id}" data-i="${i}"/><i></i></label>
          <label class="set"><span>${this.tr('stop_dwell')}</span><select data-change="stopDwell" data-id="${t.id}" data-i="${i}">${[0, 5, 15, 30, 60].map((d) => `<option value="${d}" ${r.dwell === d ? 'selected' : ''}>${d ? d + ' s' : this.tr('none')}</option>`).join('')}</select></label>
          <label class="set"><span>${this.tr('stop_platform')}</span><select data-change="stopPlat" data-id="${t.id}" data-i="${i}"><option value="">${this.tr('auto')}</option>${s.tracks.map((tk, k) => `<option value="${k}" ${r.plat === k ? 'selected' : ''}>P${k + 1} (${tk.tiles.length} ${this.tr('tiles')})</option>`).join('')}</select></label>
          <label class="set tog"><span>${this.tr('stop_skip')}</span><input type="checkbox" ${r.skip ? 'checked' : ''} data-change="stopSkip" data-id="${t.id}" data-i="${i}"/><i></i></label>
          <div class="chips wrap"><small class="muted">${this.tr('stop_cargo')}</small>${carry.map((c) => `<button class="chip mini ${!r.cargo || r.cargo.includes(c) ? 'on' : ''}" data-act="stopCargo" data-arg="${t.id}:${i}:${c}" data-tip="${this.cargoName(c)}">${cargoIcon(c)}</button>`).join('')}</div>
        </div>`;
      }
      return `<div class="rstop ${cur ? 'cur' : ''} ${r.skip ? 'skip' : ''}"><button class="rs-name" data-act="stopOpen" data-arg="${t.id}:${i}">${i + 1}. ${r.wp != null ? icon('waypoint', 'mini') : ''}${esc(name)}<small>${summary}</small></button><button class="icon-btn small" data-act="routeUp" data-arg="${t.id}:${i}" aria-label="up">▲</button><button class="icon-btn small" data-act="routeDown" data-arg="${t.id}:${i}" aria-label="down">▼</button><button class="icon-btn small" data-act="routeDel" data-arg="${t.id}:${i}" aria-label="${this.tr('remove')}">${icon('close')}</button></div>${opts}`;
    }).join('') || `<p class="muted">${this.tr('route_empty')}</p>`;
    return `<div class="route">${rows}
      <label class="set"><span>${this.tr('add_stop')}</span><select data-change="routeAdd" data-id="${t.id}"><option value="">—</option>${stations.map((s) => `<option value="s${s.id}">${esc(s.name)}</option>`).join('')}${wps.map((w) => `<option value="w${w.tile}">${esc(w.name)} (${this.tr('waypoint')})</option>`).join('')}</select></label>
      <h4>${this.tr('cargo_filter')}</h4><div class="chips">${CARGO_IDS.filter((c) => t._st.caps[c]).map((c) => { const on = !t.filter || t.filter.includes(c); return `<button class="chip ${on ? 'on' : ''}" data-act="toggleCargo" data-arg="${t.id}:${c}" data-tip="${this.cargoName(c)}">${cargoIcon(c)}</button>`; }).join('')}</div></div>`;
  },

  // ---------- station inspector / editor ----------
  iStation(s) {
    const g = this.game, S = g.stations;
    const up = S.upgradeInfo(s);
    const cap = S.storage(s);
    const towns = s.links.towns.map((id) => g.towns.byId(id)).filter(Boolean);
    const inds = s.links.industries.map((id) => g.industries.byId(id)).filter(Boolean);
    const stock = Object.keys(s.stock).filter((c) => s.stock[c] >= 1);
    const trains = g.trains.trains.filter((t) => t.target === s.id);
    const styles = g.progression.stationStyles().map((st) => `<option value="${st.id}" ${s.style === st.id ? 'selected' : ''}>${this.tr('sty_' + st.id)}</option>`).join('');
    const util = s.stats.util || [];
    const tracks = s.tracks.map((tk, k) => {
      const busy = S.platformBusy(s, k, -1);
      const e0 = S.planExtend(s, k, 0), e1 = S.planExtend(s, k, 1);
      const rm = S.canRemoveTrack(s, k);
      const extBtn = (e, end) => `<button class="icon-btn small" data-act="stExtend" data-arg="${s.id}:${k}:${end}" ${e.error ? 'disabled' : ''} data-preview="${e.tile ?? e.bad ?? ''}" data-ok="${e.error ? 0 : 1}" data-tip="${e.error ? this.tr(e.error) : this.tr('st_extend') + ' · ' + fmt(e.cost) + '●'}">${end ? icon('right') : icon('left')}</button>`;
      return `<div class="plat ${busy ? 'busy' : ''}"><b>P${k + 1}</b><span class="plen">${tk.tiles.length}<small>${this.tr('tiles')}</small></span>
        <span class="putil">${this.bar(util[k] || 0)}</span>
        <select data-change="stRole" data-id="${s.id}" data-k="${k}" aria-label="${this.tr('st_role')}">${PLATFORM_ROLES.map((r) => `<option value="${r}" ${tk.role === r ? 'selected' : ''}>${this.tr('role_p_' + r)}</option>`).join('')}</select>
        ${extBtn(e0, 0)}${extBtn(e1, 1)}
        ${k > 0 ? `<button class="icon-btn small" data-act="stRemoveTrack" data-arg="${s.id}:${k}" ${rm ? 'disabled' : ''} data-tip="${rm ? this.tr(rm) : this.tr('st_remove_track')}">${icon('close')}</button>` : ''}</div>`;
    }).join('');
    const addT = [1, -1].map((side) => {
      const p = S.planAddTrack(s, side);
      return `<button class="btn small" data-act="stAddTrack" data-arg="${s.id}:${side}" ${p.error ? 'disabled' : ''} data-preview="${p.tiles ? p.tiles.concat(...(p.ladders || []).map((l) => l.path)).join(',') : p.bad ?? ''}" data-ok="${p.error ? 0 : 1}" data-tip="${p.error ? this.tr(p.error) : (p.ladders.some((l) => l.dir == null) ? this.tr('st_dead_end_note') : this.tr('st_ladder_note'))}">${icon('plus')} ${this.tr(side > 0 ? 'st_add_track_a' : 'st_add_track_b')}${p.error ? '' : ' · ' + fmt(p.cost) + '●'}</button>`;
    }).join('');
    const facs = Object.keys(FACILITIES).map((f) => {
      const has = s.facilities.includes(f);
      const e = has ? null : S.facilityError(s, f);
      return `<button class="chip ${has ? 'on' : ''} ${e && e !== 'err_no_money' ? 'locked' : ''}" data-act="stFacility" data-arg="${s.id}:${f}" ${has || e ? 'disabled' : ''} data-tip="${this.tr('fac_' + f + '_desc')}${e ? ' · ' + this.tr(e) : ''}"><b>${this.tr('fac_' + f)}</b><small>${FACILITIES[f].cargo.map((c) => cargoIcon(c, 'mini')).join('')}${has ? '' : ' ' + fmt(S.facilityCost()) + '●'}</small></button>`;
    }).join('');
    const adv = S.advise(s).map((a) => `<div class="card warn small">${icon('advisor', 'mini')} ${esc(this.tr(a.key, a.p || {}))}</div>`).join('');
    const supplies = [...(s.supplies || [])];
    const avgUtil = util.length ? util.reduce((a, b) => a + b, 0) / util.length : 0;
    return `<div class="pill-row"><span class="pill">${this.tr('skind_' + (s.kind || 'halt'))} · ${this.tr('level')} ${s.level + 1}/6</span><span class="pill">${this.tr('storage')} ${fmt(cap)}</span><span class="pill">${this.tr('load_rate')} ${STATION.loadRate[s.level]}/s</span></div>
      ${this.stationActions(s, up)}
      ${this.serviceBlock(s)}
      ${s.warn ? `<div class="card warn">${icon('warn')} ${this.tr('station_congested')}</div>` : ''}${adv}
      <h4>${this.tr('serves')}</h4><div class="links">${towns.map((t) => `<button class="tag link" data-act="jump" data-arg="town:${t.id}">${icon('town', 'mini')}${esc(t.name)}</button>`).join('')}${inds.map((i) => `<button class="tag link" data-act="jump" data-arg="industry:${i.id}">${icon('factory', 'mini')}${esc(g.industries.displayName(i))}</button>`).join('') || `<span class="muted">${this.tr('nothing_linked')}</span>`}</div>
      <h4>${this.tr('accepts')}</h4><div class="icons">${[...s.accepts].map((c) => `<span data-tip="${this.cargoName(c)}">${cargoIcon(c)}</span>`).join('') || '-'}</div>
      ${supplies.length ? `<h4>${this.tr('supplies')}</h4>${supplies.map((c) => this.cargoWagonsRow(c)).join('')}` : ''}
      <h4>${this.tr('waiting_cargo')}</h4>${stock.map((c) => this.cargoRow(c, s.stock[c], cap)).join('') || `<p class="muted">${this.tr('none_waiting')}</p>`}
      ${this.paxBlock(s)}
      <h4 id="st-plats">${this.tr('platforms')} · ${s.tracks.length}/${S.maxTracks()} ${this.helpBtn('stations')}</h4><div class="plats">${tracks}</div>
      <div class="row wrap">${addT}</div>
      <p class="muted small">${this.tr('st_edit_help')}</p>
      <h4>${this.tr('facilities')}</h4><div class="chips wrap">${facs}</div>
      <h4 id="st-stats">${this.tr('station_statistics')}</h4>
      <div class="kv-grid small"><div><b>${fmt(s.stats.arrivals)}</b><small>${this.tr('arrivals')}</small></div><div><b>${Math.round(avgUtil * 100)}%</b><small>${this.tr('occupancy')}</small></div><div><b>${Math.round(s.stats.waitEma * 100)}%</b><small>${this.tr('entry_waits')}</small></div><div><b>${fmt(s.stats.transfers)}</b><small>${this.tr('transfers')}</small></div></div>
      ${this.ratingBlock(s)}
      <h4>${this.tr('fin_station_heading')}</h4>${this.finBlock(s)}<p class="muted small">${this.tr('fin_station_note')}</p>
      <h4>${this.tr('trains_heading_here')}: ${trains.length}</h4>
      <div class="row wrap" id="st-up">${up.max ? `<span class="good">${this.tr('max_level')}</span>` : `<button class="btn primary" data-act="upgradeStation" data-arg="${s.id}" ${up.ok ? '' : 'disabled'}>${icon('up')} ${this.tr('upgrade_to', { name: this.tr('slvl_' + up.next) })} · ${fmt(up.cost)}●</button>${g.progression.level < up.lvlReq ? `<small class="muted">${this.tr('unlock_level', { n: up.lvlReq })}</small>` : ''}${up.research && !g.progression.research.has(up.research) ? `<small class="muted">${this.tr('requires')}: ${this.tr('res_' + up.research)}</small>` : ''}`}</div>
      <label class="set"><span>${this.tr('station_style')}</span><select data-change="stationStyle" data-id="${s.id}">${styles}</select></label>
      <p class="muted small">${this.tr('station_stats', { d: fmt(s.delivered), p: fmt(s.picked) })}</p>`;
  },

  // passengers: service frequency, travel demand, where people are heading and
  // every place reachable from here (directly or with one change)
  paxBlock(s) {
    const g = this.game, P = g.pax, S = g.stations;
    const conns = P.connections(s);
    const waiting = Math.floor(s.stock.PASSENGERS || 0);
    if (!S.accepts(s, 'PASSENGERS') && !conns.length && !waiting) return '';
    const iv = P.interval(s), mul = s._paxMul || 1;
    const name = (id) => esc(S.byId(id)?.name || '?');
    const pills = [`<span class="pill">${iv ? this.tr('pax_every', { n: iv < 1 ? '<1' : Math.round(iv) }) : this.tr('pax_no_service')}</span>`];
    if (Math.abs(mul - 1) > 0.005) pills.push(`<span class="pill ${mul > 1 ? 'good' : ''}" data-tip="${this.tr('pax_demand_tip')}">${mul > 1 ? '+' : '−'}${Math.round(Math.abs(mul - 1) * 100)}% ${this.tr('pax_demand')}</span>`);
    const tagged = Object.entries(s.paxTo || {}).sort((a, b) => b[1] - a[1]);
    const open = P.open(s);
    const rows = waiting ? [...tagged.slice(0, 4).map(([id, n]) => `<div class="kvrow"><span>${this.tr('pax_to', { name: name(+id) })}</span><b>${fmt(n)}</b></div>`), open > 0 && tagged.length ? `<div class="kvrow"><span>${this.tr('pax_open')}</span><b>${fmt(open)}</b></div>` : ''].join('') : '';
    const shown = conns.slice(0, 8);
    const list = shown.map((c) => `<button class="tag link" data-act="jump" data-arg="station:${c.st}">${icon('station', 'mini')}${name(c.st)}${c.via != null ? `<small class="muted">&nbsp;${this.tr('pax_via', { name: name(c.via) })}</small>` : ''}</button>`).join('') + (conns.length > shown.length ? `<span class="muted small">${this.tr('pax_more', { n: conns.length - shown.length })}</span>` : '');
    return `<h4>${this.tr('pax_heading')} ${this.helpBtn('passengers')}</h4><div class="pill-row">${pills.join('')}</div>${rows}
      <h4>${this.tr('pax_connections')} · ${conns.length}</h4><div class="links">${list || `<span class="muted small">${this.tr('pax_no_conn')}</span>`}</div>`;
  },

  // cargo discoverability: which wagons carry a cargo
  cargoWagonsRow(c) {
    const R = this.game.progression.research;
    const ws = wagonsFor(c).map((w) => `<span class="tag ${wagonUnlocked(w, R) ? '' : 'locked'}">${wagonUnlocked(w, R) ? '' : icon('lock', 'mini')}${this.tr('wag_' + w)}</span>`).join('');
    return `<div class="crow">${cargoIcon(c)}<span>${this.cargoName(c)}</span><span class="wtags">${ws}</span></div>`;
  },

  // ---------- overlays ----------
  toggleOverlayMenu() {
    const m = $('#overlay-menu');
    if (!m) return;
    m.hidden = !m.hidden;
    if (!m.hidden) this.renderOverlayMenu();
  },
  renderOverlayMenu() {
    const m = $('#overlay-menu');
    if (!m) return;
    const cur = this.game.overlays.mode;
    m.innerHTML = `<div class="ovgrid">${OVERLAYS.map((o) => `<button class="chip ${cur === o ? 'on' : ''}" data-act="overlay" data-arg="${o}"><b>${this.tr('ov_' + o)}</b><small>${this.tr('ov_' + o + '_desc')}</small></button>`).join('')}</div>`;
  },

  railActions() {
    const g = () => this.game;
    const b = () => this.bld;
    const re = () => this.refreshPanel();
    return {
      stService: (a) => { const [id, sv] = a.split(':'); const st = g().stations.byId(+id); if (st && g().stations.setService(st, sv)) { this.app.audio.play('click'); this.toast(this.tr('svc_set', { name: st.name, svc: this.tr('svc_' + sv) }), 'info', 'station'); this.renderInspector(); } },
      builder: (a) => this.openBuilder({ trainId: +a }),
      newTrain: () => this.openBuilder({}),
      bldSel: (a) => { b().sel = b().sel === +a ? -1 : +a; re(); },
      stExtendTool: (a) => { const s = g().stations.byId(+a); if (!s) return; g().construction.setTool('station'); this.toast(this.tr('act_extend_tip'), 'info', 'station'); const tiles = g().stations.allTiles(s); g().construction.showTiles(tiles, true); },
      stRoutes: () => { if (g().overlays.mode !== 'routes') this.actions.overlay('routes'); },
      stRename: async (a) => { const s = g().stations.byId(+a); if (!s) return; const n = await this.prompt(this.tr('rename'), s.name); if (n) { s.name = n.slice(0, 28); this.renderInspector(); } },
      stDemolish: async (a) => { const s = g().stations.byId(+a); if (!s) return; if (!(await this.confirm(this.tr('st_demolish_q', { name: s.name }), this.tr('act_demolish'), true))) return; const r = g().stations.remove(s); if (r.error) this.error(r.error); else { g().select(null); g().industries.onStationsChanged(); g().towns.onStationsChanged(); } },
      depotSend: (a) => { const t = g().trains.byId(+a); if (t) this.depotResult(t, g().trains.orderDepot(t, null, true)); },
      depotChoose: (a) => { const t = g().trains.byId(+a); if (t) this.depotChooser(t); },
      depotCancel: (a) => { const t = g().trains.byId(+a); if (t) { g().trains.cancelDepotOrder(t); this.renderInspector(); } },
      depotRelease: (a) => { const t = g().trains.byId(+a); if (t && g().trains.releaseFromDepot(t)) { this.toast(this.tr('depot_released', { name: t.name }), 'good', 'train'); this.renderInspector(); } },
      scrollTo: (a) => { const el = document.querySelector(a); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
      bldPickVeh: (a, el, ev) => { const B = b(); if (!B || !ev || !B.veh.length) return; const r = el.getBoundingClientRect(); const i = this.pickVehicleAt(B.veh, (ev.clientX - r.left) / r.width, CONSIST.gap); B.sel = B.sel === i ? -1 : i; re(); },
      bldCat: (a) => { b().cat = a; re(); },
      bldMove: (a) => { const B = b(), i = B.sel, j = i + +a; if (j < 0 || j >= B.veh.length) return; [B.veh[i], B.veh[j]] = [B.veh[j], B.veh[i]]; B.sel = j; re(); },
      bldFlip: () => { const v = b().veh[b().sel]; if (v) v.r = !v.r; re(); },
      bldReplace: () => { b().replace = !b().replace; re(); },
      bldRemove: () => { const B = b(); if (B.sel >= 0) { B.veh.splice(B.sel, 1); B.sel = Math.min(B.sel, B.veh.length - 1); } re(); },
      bldAdd: (a) => {
        const B = b();
        const [k, id] = a.split(':');
        const v = { k, id, r: false };
        if (B.veh.length >= CONSIST.maxVehicles && !(B.replace && B.sel >= 0)) { this.error('err_too_many_vehicles'); return; }
        if (B.replace && B.sel >= 0) B.veh[B.sel] = v;
        else if (B.sel >= 0) { B.veh.splice(B.sel + 1, 0, v); B.sel++; }
        else if (k === 'L') { const n = B.veh.findIndex((x) => x.k !== 'L'); B.veh.splice(n < 0 ? B.veh.length : n, 0, v); }
        else B.veh.push(v);
        this.app.audio.play('click');
        re();
      },
      bldCargo: (a) => { const s = b().cargos; if (s.has(a)) s.delete(a); else s.add(a); re(); },
      bldAuto: (a, el, e, fit) => {
        const B = b(), G = g();
        const lead = B.veh.find((v) => v.k === 'L') || { id: LOCOS.filter((m) => G.progression.locoUnlocked(m)).pop().id };
        let maxLen = null;
        if (fit) { const f = this.builderPlatformFit(B.veh); if (f.shortest) maxLen = f.shortest * TILE + 0.6; }
        const t = B.trainId != null ? G.trains.byId(B.trainId) : null;
        B.veh = autoBuild(lead.id, [...B.cargos], { research: G.progression.research, fx: G.progression.fx, upg: t ? t.upg : null, maxLen });
        B.sel = -1;
        re();
      },
      bldAutoFit: () => this.railActions().bldAuto(null, null, null, true),
      bldLiv: (a) => { const B = b(); if (!B) return; B.liveryScope = B.liveryScope || 'train'; B.livery = a; re(); },
      bldLiveryScope: (a) => { const B = b(); if (!B) return; B.liveryScope = a === 'loco' ? 'loco' : 'train'; re(); },
      bldBuy: () => {
        const B = b(), G = g();
        const dep = G.stations.depotById(B.depotId);
        const r = G.trains.buy(B.veh, dep, B.name || null);
        if (r.error) { this.error(r.error); return; }
        r.train.livery = B.livery; r.train.liveryScope = B.liveryScope === 'loco' ? 'loco' : 'train';
        this.bld = null;
        this.closePanel();
        G.select({ type: 'train', id: r.train.id });
      },
      bldApply: () => {
        const B = b(), G = g();
        const t = G.trains.byId(B.trainId);
        if (!t) return;
        const e = G.trains.applyConsist(t, B.veh);
        if (e) { this.error(e); return; }
        if (B.name) t.name = B.name.slice(0, 28);
        t.livery = B.livery; t.liveryScope = B.liveryScope === 'loco' ? 'loco' : 'train'; t.visualSig = null;
        this.toast(this.tr(t.pendingVeh ? 'toast_consist_pending' : 'toast_consist_applied', { name: t.name }), 'good', 'train');
        this.app.audio.play('construct');
        re();
      },
      bldDuplicate: () => {
        const B = b(), G = g();
        const t = G.trains.byId(B.trainId);
        const dep = G.stations.depotById(t.homeDepot) || G.stations.depots.find((d) => G.net.conn[d.tile]);
        const r = G.trains.buy(t.pendingVeh || t.veh, dep, null);
        if (r.error) { this.error(r.error); return; }
        r.train.livery = t.livery; r.train.liveryScope = t.liveryScope; r.train.mode = t.mode; r.train.route = JSON.parse(JSON.stringify(t.route)); r.train.filter = t.filter ? [...t.filter] : null;
        this.toast(this.tr('toast_train_bought', { name: r.train.name }), 'good', 'train');
      },
      bldSaveTpl: async () => {
        const P = g().progression;
        const n = await this.prompt(this.tr('bld_tpl_name'), this.vehName(b().veh.find((v) => v.k === 'L') || b().veh[0] || { k: 'W', id: 'coach' }));
        if (!n) return;
        P.templates = P.templates || [];
        P.templates.push({ name: n.slice(0, 28), veh: serializeConsist(b().veh) });
        if (P.templates.length > 12) P.templates.shift();
        re();
      },
      bldTpl: (a) => { const tp = (g().progression.templates || [])[+a]; if (tp) { b().veh = parseConsist(tp.veh); b().sel = -1; re(); } },
      bldTplDel: (a) => { const P = g().progression; P.templates.splice(+a, 1); re(); },
      stopOpen: (a) => { const [id, i] = a.split(':').map(Number); this.openStop = this.openStop || {}; this.openStop[id] = this.openStop[id] === i ? -1 : i; this.renderInspector(); },
      stopCargo: (a) => {
        const [id, i, c] = a.split(':'); const t = g().trains.byId(+id); const r = t.route[+i];
        const all = CARGO_IDS.filter((x) => t._st.caps[x]);
        let f = r.cargo ? [...r.cargo] : [...all];
        f = f.includes(c) ? f.filter((x) => x !== c) : [...f, c];
        r.cargo = f.length >= all.length ? null : f;
        this.renderInspector();
      },
      stAddTrack: (a) => { const [id, side] = a.split(':').map(Number); const s = g().stations.byId(id); const r = g().stations.addTrack(s, side); if (r.error === 'err_train_on_track') this.offerWorks('addTrack', { stn: id, side }); else if (r.error) this.error(r.error); else { this.toast(this.tr(r.deadEnds ? 'toast_track_added_dead' : 'toast_track_added'), 'good', 'station'); g().construction.clearPreview(); } this.renderInspector(); },
      stExtend: (a) => { const [id, k, end] = a.split(':').map(Number); const s = g().stations.byId(id); const r = g().stations.extendPlatform(s, k, end); if (r.error) this.error(r.error); else g().construction.clearPreview(); this.renderInspector(); },
      stRemoveTrack: async (a) => { const [id, k] = a.split(':').map(Number); const s = g().stations.byId(id); if (!(await this.confirm(this.tr('confirm_remove_track', { n: k + 1 }), this.tr('remove'), true))) return; const r = g().stations.removeTrack(s, k); if (r.error) this.error(r.error); this.renderInspector(); },
      stFacility: (a) => { const [id, f] = a.split(':'); const s = g().stations.byId(+id); const e = g().stations.buildFacility(s, f); if (e) this.error(e); this.renderInspector(); },
      overlay: (a) => { g().overlays.set(a); this.renderOverlayMenu(); this.renderToolbar(); if (g().overlays.mode) this.toast(this.tr('ov_' + a + '_desc'), 'info', 'layers'); },
      overlayMenu: () => this.toggleOverlayMenu(),
      trackMode: (a) => g().construction.setTrackMode(a),
      signalType: (a) => g().construction.setSignalType(a),
      signalSpacing: (a) => { g().construction.signalSpacing = Math.max(2, Math.min(8, +a || 4)); this.renderToolbar(); },
      trainsTab: (a) => { this.trainsTab = a; re(); },
      lineAdd: (a) => {
        const G = g(), t = G.trains.byId(+a);
        if (!t) return;
        const dep = G.stations.depotById(t.homeDepot) || G.stations.depots.find((d) => G.net.conn[d.tile]);
        const r = G.trains.buy(t.pendingVeh || t.veh, dep, null);
        if (r.error) { this.error(r.error); return; }
        Object.assign(r.train, { livery: t.livery, liveryScope: t.liveryScope, mode: t.mode, route: JSON.parse(JSON.stringify(t.route)), filter: t.filter ? [...t.filter] : null, spacing: t.spacing, group: t.group });
        G.lines.version++; G.pax.invalidate();
        this.toast(this.tr('toast_train_bought', { name: r.train.name }), 'good', 'train');
        re();
      },
      fleetReplace: async (a) => {
        const G = g(), to = (this.fleetPick || {})[a];
        if (!to) return;
        const ts = G.trains.trains.filter((t) => (t.pendingVeh || t.veh).some((v) => v.k === 'L' && v.id === a));
        if (!(await this.confirm(this.tr('fleet_confirm', { n: ts.length, from: locoModel(a).name, to: locoModel(to).name }), this.tr('fleet_replace_btn')))) return;
        let ok = 0, kept = 0, err = null;
        for (const t of ts) { const e = G.trains.replaceLoco(t, a, to); if (e) { kept++; err = err || e; } else ok++; }
        this.fleetPick[a] = null;
        this.toast(this.tr('fleet_done', { n: ok, m: kept }) + (err ? ' · ' + this.tr(err) : ''), ok ? 'good' : 'warn', 'train');
        if (ok) this.app.audio.play('construct');
        re();
      },
      jumpTile: (a, el) => {
        const tile = +a; g().camera.focus(tileCX(tile), tileCZ(tile), 18);
        // advisor suggestions with a location: highlight it (e.g. where a passing loop fits)
        const pv = el && el.closest && el.closest('[data-preview]');
        if (pv) g().construction.showTiles(String(pv.dataset.preview).split(',').filter((x) => x !== '').map(Number), true);
      },
    };
  },

  railInputs() {
    const g = () => this.game;
    const stop = (el) => { const t = g().trains.byId(+el.dataset.id); return t ? t.route[+el.dataset.i] : null; };
    return {
      bldName: (el) => { if (this.bld) this.bld.name = el.value.slice(0, 28); },
      bldLivery: (el) => { if (this.bld) { this.bld.livery = el.value; this.refreshPanel(); } },
      bldDepot: (el) => { if (this.bld) { this.bld.depotId = +el.value; this.refreshPanel(); } },
      stopAct: (el) => { const r = stop(el); if (r) r.act = el.value; this.renderInspector(); },
      stopFull: (el) => { const r = stop(el); if (r) r.full = el.checked; },
      stopDwell: (el) => { const r = stop(el); if (r) r.dwell = +el.value; this.renderInspector(); },
      stopPlat: (el) => { const r = stop(el); if (r) r.plat = el.value === '' ? null : +el.value; this.renderInspector(); },
      stopSkip: (el) => { const r = stop(el); if (r) r.skip = el.checked; this.renderInspector(); },
      trainSpacing: (el) => { const t = g().trains.byId(+el.dataset.id); if (t) { t.spacing = +el.value || 0; g().lines.version++; } this.renderInspector(); },
      lineSpacing: (el) => { if (el.value === '') return; const l = g().lines.list().find((x) => x.key === el.dataset.key); if (l) for (const t of l.trains) t.spacing = +el.value || 0; g().lines.version++; this.refreshPanel(); },
      fleetPick: (el) => { this.fleetPick = this.fleetPick || {}; this.fleetPick[el.dataset.id] = el.value || null; this.refreshPanel(); },
      trainGroup: async (el) => {
        const t = g().trains.byId(+el.dataset.id);
        if (!t) return;
        if (el.value === '__new') { const n = await this.prompt(this.tr('group_prompt'), ''); if (n && n.trim()) t.group = n.trim().slice(0, 24); }
        else t.group = el.value;
        this.renderInspector();
      },
      stRole: (el) => { const s = g().stations.byId(+el.dataset.id); g().stations.setTrackRole(s, +el.dataset.k, el.value); },
    };
  },

  // hover previews for station edit buttons
  bindPreviews() {
    if (this._pvBound) return;
    this._pvBound = true;
    document.addEventListener('pointerover', (e) => {
      const el = e.target.closest('[data-preview]');
      if (!el || !this.game || e.pointerType !== 'mouse') return;
      const tiles = String(el.dataset.preview).split(',').filter((x) => x !== '').map(Number);
      if (tiles.length) this.game.construction.showTiles(tiles, el.dataset.ok === '1');
    });
    document.addEventListener('pointerout', (e) => {
      if (e.target.closest('[data-preview]') && this.game && this.game.construction.tool === 'select') { this.game.construction.ghost.count = 0; }
    });
  },
};

export { clamp };
