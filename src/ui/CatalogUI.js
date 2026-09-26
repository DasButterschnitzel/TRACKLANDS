// Vehicle catalogue: every locomotive, multiple unit, wagon, bus, lorry, tram,
// ship and aircraft in one searchable list with 3D previews, stats, role,
// unlock, strengths and weaknesses; favourites (saved with the company) and a
// side-by-side comparison of 2 to 4 models.
import * as THREE from 'three';
import { fmt, escapeHtml as esc } from '../util.js';
import {
  LOCOS, WAGONS, WAGON_IDS, ROAD_VEHICLES, CARGO, CARGO_IDS, DUTIES, TRACK_TIERS, locoLen, locoResearch,
} from '../config.js';
import { icon, cargoIcon } from './icons.js';
import { locoGeometry, wagonGeometry, liveryColors } from '../trains/TrainModels.js';
import { wagonUnlocked } from '../trains/Consist.js';
import { roadVehicleGeometry } from '../road/RoadModels.js';
import { MATS } from '../core/ModelBuilder.js';

const KIND_MODE = { bus: 'bus', truck: 'truck', tram: 'tram', dock: 'ship', airport: 'air' };
export const CAT_MODES = ['all', 'rail', 'wagon', 'bus', 'truck', 'tram', 'ship', 'air'];
const PAGE = 24;
const NUM = ['speed', 'power', 'accel', 'cap', 'price', 'op', 'rel', 'len'];
const LOWER_BETTER = new Set(['price', 'op']);
const PAX = new Set(['PASSENGERS', 'MAIL']);
const cargosOfGroups = (groups) => CARGO_IDS.filter((c) => groups.includes(CARGO[c].group));

export const CatalogUIMixin = {
  catState() {
    if (!this._cat) this._cat = { mode: 'all', q: '', era: '', role: '', cargo: '', power: 0, speed: 0, owned: false, unlocked: false, fav: false, sort: 'level', cmp: [], tab: 'vehicles', n: PAGE };
    return this._cat;
  },

  // one normalised record per model (numbers for filters, sorting and comparison)
  catItems() {
    const g = this.game, P = g.progression, R = P.research, mul = g.economy.costs.mul();
    const inTrains = new Set();
    for (const t of g.trains.trains) for (const v of t.veh) inTrains.add(v.k + ':' + v.id);
    const out = [];
    for (const m of LOCOS) {
      const carries = m.mu ? m.mu.carries : m.role === 'passenger' ? ['PASSENGERS', 'MAIL'] : m.role === 'freight' ? CARGO_IDS.filter((c) => !PAX.has(c)) : CARGO_IDS;
      out.push({
        key: 'L:' + m.id, type: 'L', id: m.id, m, mode: 'rail', name: m.name, era: m.era, role: 'duty_' + (m.duty || 'mixed'), roleId: m.duty || 'mixed',
        carries, speed: m.speed, power: m.power, accel: m.accel, cap: m.mu ? m.mu.cap : Math.max(m.pax, m.freight), price: g.economy.costs.train(m), op: m.op, rel: m.reliability,
        len: locoLen(m), level: m.level, unlocked: P.locoUnlocked(m), owned: P.owned.has(m.id) || inTrains.has('L:' + m.id), unlock: this.locoUnlockText(m),
        rarity: m.rarity, mu: !!m.mu, special: !!m.special, electric: !!m.electric,
      });
    }
    for (const id of WAGON_IDS) {
      const w = WAGONS[id];
      out.push({
        key: 'W:' + id, type: 'W', id, w, mode: 'wagon', name: this.tr('wag_' + id), era: 0, role: 'bld_cat_' + (w.cls === 'mail' ? 'freight' : w.cls), roleId: w.cls,
        carries: w.carries, speed: w.vmax, power: 0, accel: 0, cap: w.cap, price: Math.round(w.cost * mul), op: w.cap ? 0.8 : 0.8, rel: 1, len: w.len, level: 0,
        unlocked: wagonUnlocked(id, R), owned: inTrains.has('W:' + id), unlock: w.research ? this.tr('requires') + ': ' + this.tr('res_' + w.research) : '',
        tall: !!w.tall, muCar: !!w.mu,
      });
    }
    for (const m of ROAD_VEHICLES) {
      const mode = KIND_MODE[m.kind] || 'truck';
      const carries = m.kind === 'bus' || m.pax ? ['PASSENGERS', ...(m.mail ? ['MAIL'] : [])] : cargosOfGroups(m.groups || []);
      out.push({
        key: 'R:' + m.id, type: 'R', id: m.id, m, mode, name: m.name, era: m.era || Math.min(6, 1 + Math.floor(m.level / 8)), role: m.role ? 'tsub_' + m.role : 'tm_' + mode, roleId: m.role || mode,
        carries, speed: m.speed, power: 0, accel: m.accel || 0, cap: m.cap, price: Math.round(m.price * mul), op: m.op, rel: m.rel || 0.9, len: 0, level: m.level,
        unlocked: P.level >= m.level, owned: g.roads.vehicles.some((v) => !v.owner && v.model === m.id), unlock: this.tr('unlock_level', { n: m.level }),
      });
    }
    return out;
  },

  catFiltered() {
    const c = this.catState(), P = this.game.progression;
    const q = c.q.trim().toLowerCase();
    let list = this.catItems().filter((it) => (c.mode === 'all' || it.mode === c.mode)
      && (!q || it.name.toLowerCase().includes(q) || this.tr(it.role).toLowerCase().includes(q))
      && (!c.era || it.era === +c.era) && (!c.role || it.role === c.role)
      && (!c.cargo || it.carries.includes(c.cargo))
      && (!c.power || it.power >= c.power) && (!c.speed || it.speed >= c.speed)
      && (!c.owned || it.owned) && (!c.unlocked || it.unlocked) && (!c.fav || P.favs.has(it.key)));
    const key = c.sort;
    const dir = LOWER_BETTER.has(key) || key === 'level' ? 1 : -1;
    list = list.sort((a, b) => (P.favs.has(b.key) - P.favs.has(a.key)) || dir * ((a[key] || 0) - (b[key] || 0)) || a.level - b.level);
    return list;
  },

  // strengths and weaknesses against the models a player weighs it against
  // (same mode, era within one step)
  catTraits(it, all) {
    const peers = all.filter((o) => o.mode === it.mode && o.key !== it.key && (!it.era || !o.era || Math.abs(o.era - it.era) <= 1));
    const pro = [], con = [];
    if (peers.length >= 3) {
      const rank = (k) => { const v = it[k], vs = peers.map((o) => o[k]); const better = vs.filter((x) => (LOWER_BETTER.has(k) ? x < v : x > v)).length; return better / vs.length; };
      const rows = it.type === 'W' ? [['cap', 'cat_s_cap', 'cat_w_cap'], ['speed', 'cat_s_speed', 'cat_w_speed'], ['price', 'cat_s_price', 'cat_w_price']]
        : [['speed', 'cat_s_speed', 'cat_w_speed'], ['accel', 'cat_s_accel', 'cat_w_accel'], ['cap', 'cat_s_cap', 'cat_w_cap'], ['op', 'cat_s_op', 'cat_w_op'], ['rel', 'cat_s_rel', 'cat_w_rel'], ['price', 'cat_s_price', 'cat_w_price']];
      for (const [k, s, w] of rows) {
        if (!it[k] && k !== 'price') continue;
        const r = rank(k);
        if (r <= 0.2) pro.push(s); else if (r >= 0.8) con.push(w);
      }
    }
    if (it.mu) { pro.push('cat_s_mu'); con.push('cat_w_mu'); }
    if (it.type === 'L' && it.electric) con.push(it.m.maglev ? 'cat_w_maglev' : 'cat_w_electric');
    if (it.type === 'L' && !it.m.maglev && it.speed > TRACK_TIERS[2].speed) con.push('cat_w_hsr');
    if (it.type === 'L' && it.m.kind.startsWith('steam')) con.push('cat_w_turn');
    if (it.tall) con.push('cat_w_tall');
    if (it.muCar) con.push('cat_w_mucar');
    return { pro: pro.slice(0, 3), con: con.slice(0, 3) };
  },

  // 3D preview (cached image): a locomotive with a matching car, a loaded
  // wagon, or a road/water/air vehicle in its colours; silhouettes when locked
  vehPreview(key, locked) {
    const P = this.game.progression;
    const ck = 'v:' + key + (locked ? ':l' : '') + ':' + P.defaultLivery;
    if (this.previews.has(ck)) return this.previews.get(ck);
    if (!this.prevR) this.locoPreview(LOCOS[0].id, false);
    if (!this.prevR) return '';
    const [t, id] = key.split(':');
    const grp = new THREE.Group();
    const mat = locked ? this.silMat : MATS;
    const temp = [];
    if (t === 'L') {
      const m = LOCOS.find((x) => x.id === id);
      const livery = P.defaultLivery;
      const cols = liveryColors(m, livery);
      const loco = new THREE.Mesh(locoGeometry(id, livery, 0), mat);
      loco.position.x = 0.4; grp.add(loco);
      const wid = m.mu ? (m.mu.carries.includes('PASSENGERS') ? 'mu_car' : 'parcel_van') : m.role === 'freight' ? 'boxcar' : m.kind === 'hst' || m.kind === 'maglev' ? 'hs_coach' : 'coach';
      const w = new THREE.Mesh(wagonGeometry(wid, m.role === 'freight' && !m.mu ? 'GOODS' : null, m.role === 'freight' ? 2 : 0, m.kind, cols.paint), mat);
      w.position.x = 0.4 - locoLen(m) / 2 - WAGONS[wid].len / 2 - 0.12; grp.add(w);
    } else if (t === 'W') {
      const w = WAGONS[id];
      const lm = LOCOS[0];
      const cols = liveryColors(lm, P.defaultLivery);
      const cargo = w.carries.find((c) => !PAX.has(c)) || null;
      const mesh = new THREE.Mesh(wagonGeometry(id, cargo, cargo ? 3 : 0, 'diesel', cols.paint), mat);
      mesh.position.x = -0.3; mesh.scale.setScalar(1.25); grp.add(mesh);
    } else {
      const m = ROAD_VEHICLES.find((x) => x.id === id);
      const geo = roadVehicleGeometry(m);
      temp.push(geo);
      const mesh = new THREE.Mesh(geo, mat);
      const s = m.kind === 'dock' || m.kind === 'airport' ? 1.35 : m.kind === 'tram' ? 2 : 2.6;
      mesh.scale.setScalar(s); mesh.position.set(-0.3, m.kind === 'airport' ? 0.35 : m.kind === 'dock' ? 0.1 : 0, 0); grp.add(mesh);
    }
    this.prevScene.add(grp);
    this.prevR.render(this.prevScene, this.prevCam);
    const url = this.prevR.domElement.toDataURL('image/png');
    this.prevScene.remove(grp);
    for (const geo of temp) geo.dispose();
    this.previews.set(ck, url);
    return url;
  },

  catStat(it, k) {
    switch (k) {
      case 'speed': return `${Math.round(it.speed)} km/h`;
      case 'power': return it.power ? `${fmt(it.power)} kW` : '—';
      case 'accel': return it.accel ? it.accel.toFixed(1) : '—';
      case 'cap': return it.cap ? `${it.cap}` : '—';
      case 'price': return `${fmt(it.price)} ●`;
      case 'op': return `${fmt(Math.round(it.op))}/${this.tr('min')}`;
      case 'rel': return `${Math.round(it.rel * 100)}%`;
      case 'len': return it.len ? `${(it.len / 2).toFixed(1)} ${this.tr('tiles')}` : '—';
      default: return '';
    }
  },

  catCard(it, all) {
    const P = this.game.progression, c = this.catState();
    const fav = P.favs.has(it.key), cmp = c.cmp.includes(it.key);
    const tr = this.catTraits(it, all);
    const stats = (it.type === 'W' ? ['cap', 'speed', 'price'] : it.type === 'L' ? ['speed', 'power', 'cap', 'price', 'op', 'rel'] : ['speed', 'cap', 'price', 'op', 'rel'])
      .map((k) => `<div><small>${this.tr('cat_k_' + k)}</small><b>${this.catStat(it, k)}</b></div>`).join('');
    const tags = [
      it.era ? `<span class="tag">${this.tr('era_' + it.era)}</span>` : '',
      `<span class="tag">${this.tr(it.role)}</span>`,
      it.rarity ? `<span class="tag rar">${this.tr('rar_' + it.rarity)}</span>` : '',
      it.mu ? `<span class="tag good" data-tip="${esc(this.tr('mu_badge_desc'))}">${this.tr('mu_badge')}</span>` : '',
      it.special ? `<span class="tag">${this.tr('special_badge')}</span>` : '',
      it.owned ? `<span class="tag good">${icon('check', 'mini')}${this.tr('owned')}</span>` : '',
    ].join('');
    const carries = it.type === 'L' && !it.mu ? '' : `<div class="cat-carries">${it.carries.slice(0, 8).map((x) => cargoIcon(x, 'mini')).join('')}${it.carries.length > 8 ? '…' : ''}</div>`;
    const trait = it.type === 'L' ? `<p class="trait small">${icon('star', 'mini')}<b>${this.tr('trait_' + it.m.trait)}</b> — ${this.tr('trait_' + it.m.trait + '_desc')}</p>` : it.type === 'W' ? `<p class="muted small">${esc(this.tr('wag_' + it.id + '_desc'))}</p>` : '';
    return `<div class="cat-card ${it.unlocked ? '' : 'locked'} ${it.rarity ? 'rar-' + it.rarity : ''}" data-key="${it.key}">
      <div class="cat-top"><img alt="" src="${this.vehPreview(it.key, !it.unlocked)}" loading="lazy"/>
        <button class="icon-btn small cat-fav ${fav ? 'on' : ''}" data-act="catFav" data-arg="${it.key}" aria-pressed="${fav}" aria-label="${this.tr('cat_fav')}" data-tip="${this.tr(fav ? 'cat_unfav' : 'cat_fav')}">${icon('star')}</button></div>
      <div class="lc-head"><b>${esc(it.name)}</b></div>
      <div class="lc-sub">${tags}</div>${carries}
      <div class="cat-stats">${stats}</div>
      ${trait}
      ${tr.pro.length ? `<p class="small good">${tr.pro.map((k) => '+ ' + this.tr(k)).join(' · ')}</p>` : ''}
      ${tr.con.length ? `<p class="small warn-t">${tr.con.map((k) => '– ' + this.tr(k)).join(' · ')}</p>` : ''}
      <div class="lc-foot">${it.unlocked ? `<span class="muted small">${this.tr('cat_unlocked')}</span>` : `<span class="muted small">${icon('lock', 'mini')} ${esc(it.unlock)}</span>`}
        <label class="chk small"><input type="checkbox" data-change="catCmp" data-key="${it.key}" ${cmp ? 'checked' : ''} ${!cmp && c.cmp.length >= 4 ? 'disabled' : ''}/> ${this.tr('cat_compare')}</label></div></div>`;
  },

  pCatalog() {
    const c = this.catState(), g = this.game, P = g.progression;
    const tabs = `<div class="seg tabs" role="tablist">${['vehicles', 'compare', 'cosmetics'].map((k) => `<button role="tab" aria-selected="${c.tab === k}" class="${c.tab === k ? 'on' : ''}" data-act="catTab" data-arg="${k}">${this.tr('cat_tab_' + k)}${k === 'compare' && c.cmp.length ? ` (${c.cmp.length})` : ''}</button>`).join('')}</div>`;
    if (c.tab === 'cosmetics') return tabs + this.pCosmetics();
    if (c.tab === 'compare') return tabs + this.pCompare();
    const all = this.catItems();
    const list = this.catFiltered();
    const modes = `<div class="chips wrap" role="group" aria-label="${this.tr('cat_mode')}">${CAT_MODES.map((m) => `<button class="chip ${c.mode === m ? 'on' : ''}" data-act="catMode" data-arg="${m}">${m === 'all' ? this.tr('cat_all') : m === 'wagon' ? this.tr('tm_wagon') : this.tr('tm_' + m)}</button>`).join('')}</div>`;
    const roles = [...new Set(all.filter((it) => c.mode === 'all' || it.mode === c.mode).map((it) => it.role))];
    const opt = (v, cur, label) => `<option value="${v}" ${String(cur) === String(v) ? 'selected' : ''}>${label}</option>`;
    const filters = `<div class="cat-filters">
      <input class="inp" type="search" placeholder="${this.tr('cat_search')}" value="${esc(c.q)}" data-input="catQuery" aria-label="${this.tr('cat_search')}"/>
      <select data-change="catEra" aria-label="${this.tr('cat_era')}">${opt('', c.era, this.tr('cat_era') + ': ' + this.tr('cat_all'))}${[1, 2, 3, 4, 5, 6].map((e) => opt(e, c.era, this.tr('era_' + e))).join('')}</select>
      <select data-change="catRole" aria-label="${this.tr('cat_role')}">${opt('', c.role, this.tr('cat_role') + ': ' + this.tr('cat_all'))}${roles.map((r) => opt(r, c.role, this.tr(r))).join('')}</select>
      <select data-change="catCargo" aria-label="${this.tr('cat_cargo')}">${opt('', c.cargo, this.tr('cat_cargo') + ': ' + this.tr('cat_all'))}${CARGO_IDS.map((x) => opt(x, c.cargo, this.cargoName(x))).join('')}</select>
      <select data-change="catPower" aria-label="${this.tr('cat_k_power')}">${[0, 1000, 3000, 6000, 10000].map((v) => opt(v, c.power, v ? '≥ ' + fmt(v) + ' kW' : this.tr('cat_k_power') + ': ' + this.tr('cat_all'))).join('')}</select>
      <select data-change="catSpeed" aria-label="${this.tr('cat_k_speed')}">${[0, 80, 120, 160, 250].map((v) => opt(v, c.speed, v ? '≥ ' + v + ' km/h' : this.tr('cat_k_speed') + ': ' + this.tr('cat_all'))).join('')}</select>
      <select data-change="catSort" aria-label="${this.tr('cat_sort')}">${['level', 'speed', 'power', 'cap', 'price', 'op'].map((k) => opt(k, c.sort, this.tr('cat_sort') + ': ' + this.tr(k === 'level' ? 'cat_k_level' : 'cat_k_' + k))).join('')}</select>
      <div class="chips">${['unlocked', 'owned', 'fav'].map((k) => `<button class="chip ${c[k] ? 'on' : ''}" data-act="catToggle" data-arg="${k}" aria-pressed="${!!c[k]}">${k === 'fav' ? icon('star', 'mini') : ''}${this.tr('cat_only_' + k)}</button>`).join('')}</div></div>`;
    const shown = list.slice(0, c.n);
    const cards = shown.map((it) => this.catCard(it, all)).join('');
    const tray = c.cmp.length ? `<div class="cat-tray"><span>${this.tr('cat_selected', { n: c.cmp.length })}</span><button class="btn small ${c.cmp.length >= 2 ? 'primary' : ''}" data-act="catTab" data-arg="compare" ${c.cmp.length >= 2 ? '' : 'disabled'}>${this.tr('cat_compare_btn')}</button><button class="btn ghost small" data-act="catCmpClear">${this.tr('cat_clear')}</button></div>` : '';
    return `${tabs}<p class="muted small">${this.tr('cat_desc', { n: P.owned.size, total: LOCOS.length })}</p>${modes}${filters}
      <p class="muted small cat-count">${this.tr('cat_count', { n: list.length })}</p>
      <div class="cat-grid">${cards || `<p class="muted">${this.tr('cat_none')}</p>`}</div>
      ${list.length > shown.length ? `<button class="btn ghost wide" data-act="catMore">${this.tr('cat_more', { n: list.length - shown.length })}</button>` : ''}${tray}`;
  },

  pCompare() {
    const c = this.catState();
    const all = this.catItems();
    const sel = c.cmp.map((k) => all.find((it) => it.key === k)).filter(Boolean);
    if (sel.length < 2) return `<p class="muted">${this.tr('cat_compare_help')}</p>`;
    const rows = ['mode', 'era', 'role', ...NUM, 'unlock'];
    const best = {};
    for (const k of NUM) {
      const vals = sel.map((it) => it[k]).filter((v) => v > 0);
      if (vals.length >= 2) best[k] = LOWER_BETTER.has(k) ? Math.min(...vals) : Math.max(...vals);
    }
    const cell = (it, k) => {
      if (k === 'mode') return this.tr(it.mode === 'wagon' ? 'tm_wagon' : 'tm_' + it.mode);
      if (k === 'era') return it.era ? this.tr('era_' + it.era) : '—';
      if (k === 'role') return this.tr(it.role);
      if (k === 'unlock') return it.unlocked ? this.tr('cat_unlocked') : esc(it.unlock);
      const v = this.catStat(it, k);
      return best[k] != null && it[k] === best[k] ? `<b class="good">${v}</b>` : v;
    };
    const head = `<tr><th></th>${sel.map((it) => `<th><img alt="" src="${this.vehPreview(it.key, !it.unlocked)}"/><div>${esc(it.name)}</div><button class="icon-btn small" data-act="catCmpRemove" data-arg="${it.key}" aria-label="${this.tr('remove')}">${icon('close')}</button></th>`).join('')}</tr>`;
    const body = rows.map((k) => `<tr><th scope="row">${this.tr(k === 'mode' ? 'cat_mode' : k === 'era' ? 'cat_era' : k === 'role' ? 'cat_role' : k === 'unlock' ? 'cat_unlock' : 'cat_k_' + k)}</th>${sel.map((it) => `<td>${cell(it, k)}</td>`).join('')}</tr>`).join('');
    const traits = `<tr><th scope="row">${this.tr('cat_traits')}</th>${sel.map((it) => { const t = this.catTraits(it, all); return `<td class="small">${t.pro.map((x) => `<div class="good">+ ${this.tr(x)}</div>`).join('')}${t.con.map((x) => `<div class="warn-t">– ${this.tr(x)}</div>`).join('')}</td>`; }).join('')}</tr>`;
    return `<div class="cmp-wrap"><table class="cmp">${head}${body}${traits}</table></div><p class="muted small">${this.tr('cat_compare_note')}</p>`;
  },

  catalogActions() {
    const re = () => this.refreshPanel();
    const c = () => this.catState();
    return {
      catTab: (a) => { c().tab = a; re(); },
      catMode: (a) => { c().mode = a; c().role = ''; c().n = PAGE; re(); },
      catToggle: (a) => { c()[a] = !c()[a]; c().n = PAGE; re(); },
      catMore: () => { c().n += PAGE; re(); },
      catFav: (a) => { const F = this.game.progression.favs; if (F.has(a)) F.delete(a); else F.add(a); re(); },
      catCmpRemove: (a) => { c().cmp = c().cmp.filter((k) => k !== a); re(); },
      catCmpClear: () => { c().cmp = []; re(); },
      catCompareWith: (a) => { const s = c(); if (!s.cmp.includes(a) && s.cmp.length < 4) s.cmp.push(a); s.tab = s.cmp.length >= 2 ? 'compare' : 'vehicles'; if (this.panel === 'collection') re(); else this.openPanel('collection'); },
    };
  },
  catalogInputs() {
    const re = () => this.refreshPanel();
    const c = () => this.catState();
    return {
      // typing keeps the focus: only the list and its count are redrawn
      catQuery: (el) => {
        const s = c(); s.q = el.value.slice(0, 40); s.n = PAGE;
        const grid = document.querySelector('#panel .cat-grid'), cnt = document.querySelector('#panel .cat-count');
        if (!grid) { re(); return; }
        const all = this.catItems(), list = this.catFiltered();
        grid.innerHTML = list.slice(0, s.n).map((it) => this.catCard(it, all)).join('') || `<p class="muted">${this.tr('cat_none')}</p>`;
        if (cnt) cnt.textContent = this.tr('cat_count', { n: list.length });
      },
      catEra: (el) => { c().era = el.value; c().n = PAGE; re(); },
      catRole: (el) => { c().role = el.value; c().n = PAGE; re(); },
      catCargo: (el) => { c().cargo = el.value; c().n = PAGE; re(); },
      catPower: (el) => { c().power = +el.value || 0; c().n = PAGE; re(); },
      catSpeed: (el) => { c().speed = +el.value || 0; c().n = PAGE; re(); },
      catSort: (el) => { c().sort = el.value; re(); },
      catCmp: (el) => { const s = c(), k = el.dataset.key; if (el.checked) { if (!s.cmp.includes(k) && s.cmp.length < 4) s.cmp.push(k); } else s.cmp = s.cmp.filter((x) => x !== k); re(); },
    };
  },
};
