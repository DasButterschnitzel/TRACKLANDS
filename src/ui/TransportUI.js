// Transport panel: every mode of transport in one place. A mode row (all,
// rail, bus, tram, truck, ship, air) and five tabs:
//  - overview: vehicles, services, revenue, cost, units and issues per mode,
//    quick actions to build or plan more,
//  - services: every line (and every vehicle running on its own orders) with
//    stops, vehicles, frequency, passengers, cargo, profit, delay, capacity,
//  - vehicles: a filterable list (type, line, town, status, sort, search)
//    with batch actions on the picked vehicles,
//  - problems: what the transport advisor found, with a way to act on it,
//  - fleet: models in use, bulk replacement and replacement rules.
import { fmt, escapeHtml as esc } from '../util.js';
import { icon } from './icons.js';
import { ROAD_VEHICLES } from '../config.js';
import { roadModel } from '../road/Roads.js';
import { lineHex } from '../road/Lines.js';
import { MODES, MODE_ICON, MODE_KIND } from '../economy/Transport.js';

const TABS = ['overview', 'lines', 'vehicles', 'problems', 'fleet'];
const STATUSES = ['all', 'moving', 'loading', 'stored', 'garage', 'broken', 'problem', 'idle', 'old', 'lowrel', 'loss'];
const SORTS = ['profit', 'loss', 'name', 'age', 'rel', 'delay', 'units'];
const PAGE = 120;
const SEV_ICON = { bad: 'warn', warn: 'warn', info: 'info' };

export const TransportUIMixin = {
  tv() { return this._tv || (this._tv = { q: '', sub: 'all', line: 'all', town: 'all', status: 'all', sort: 'profit', picked: new Set(), limit: PAGE }); },
  tTab() { const t = this.trainsTab || 'overview'; return t === 'trains' ? 'vehicles' : TABS.includes(t) ? t : 'overview'; },
  tMode() { const T = this.game.transport, m = this.transportMode || 'all'; return m === 'all' || T.available().includes(m) ? m : 'all'; },
  modeName(m) { return this.tr('tm_' + m); },
  lineColorCss(c) { return c == null ? '#888' : typeof c === 'number' ? lineHex(c) : c; },

  pTransport() {
    const g = this.game, T = g.transport;
    const mode = this.tMode(), tab = this.tTab();
    const probs = T.problems().filter((p) => mode === 'all' || p.mode === mode);
    const nBad = probs.filter((p) => p.sev !== 'info').length;
    const shown = T.available().filter((m) => m === 'rail' || m === mode || T.inUse(m));
    const modes = ['all', ...shown].map((m) => {
      const n = m === 'all' ? 0 : T.problems().filter((p) => p.mode === m && p.sev === 'bad').length;
      return `<button class="chip ${mode === m ? 'on' : ''}" data-act="tMode" data-arg="${m}" aria-pressed="${mode === m}">${m === 'all' ? '' : icon(MODE_ICON[m], 'mini')} ${this.modeName(m)}${n ? ` <i class="cnt bad">${n}</i>` : ''}</button>`;
    }).join('');
    const tabs = TABS.map((k) => `<button role="tab" aria-selected="${tab === k}" class="${tab === k ? 'on' : ''}" data-act="trainsTab" data-arg="${k}">${this.tr('ttab_' + k)}${k === 'problems' && nBad ? ` <i class="cnt">${nBad}</i>` : ''}</button>`).join('');
    const body = tab === 'lines' ? this.tServices(mode) : tab === 'vehicles' ? this.tVehicles(mode) : tab === 'problems' ? this.tProblems(mode, probs) : tab === 'fleet' ? this.tFleet(mode) : this.tOverview(mode, probs);
    return `<div class="chips tmodes" role="group" aria-label="${this.tr('tm_modes')}">${modes}</div>
      <div class="seg tabs ttabs" role="tablist">${tabs}</div>${body}`;
  },

  // ---------- overview ----------
  tOverview(mode, probs) {
    const g = this.game, T = g.transport;
    const cell = (k, v, cls = '') => `<div class="${cls}"><small>${this.tr(k)}</small><b>${v}</b></div>`;
    if (mode === 'all') {
      const used = T.available().filter((m) => T.inUse(m)), spare = T.available().filter((m) => !T.inUse(m));
      const rows = used.map((m) => {
        const s = T.summary(m);
        return `<button class="tmode-card" data-act="tMode" data-arg="${m}">
          <span class="tm-h">${icon(MODE_ICON[m], 'mini')} <b>${this.modeName(m)}</b>${s.issues ? `<i class="cnt ${s.bad ? 'bad' : ''}">${s.issues}</i>` : ''}</span>
          <span class="bstats">${cell('tm_vehicles', fmt(s.vehicles))}${cell('tm_services', fmt(s.services))}${cell('fin_last_month', this.money(s.profit, true), s.profit < 0 ? 'neg' : '')}${cell('tm_units', `${fmt(s.pu)} · ${fmt(s.cu)}`)}</span></button>`;
      }).join('');
      const s = T.summary('all');
      return `<div class="bstats tstats t4">${cell('tm_vehicles', fmt(s.vehicles))}${cell('tm_revenue', this.money(s.rev))}${cell('tm_cost', this.money(s.cost))}${cell('tm_profit', this.money(s.profit, true), s.profit < 0 ? 'neg' : '')}</div>
        <p class="muted small">${this.tr('tm_month_note')}</p>
        <div class="tmode-list">${rows || `<p class="muted">${this.tr('tm_no_vehicles')}</p>`}</div>
        ${spare.length ? `<div class="row wrap tspare"><span class="muted small">${this.tr('tm_also_available')}</span>${spare.map((m) => `<button class="tag link" data-act="tMode" data-arg="${m}">${icon(MODE_ICON[m], 'mini')} ${this.modeName(m)}</button>`).join('')}</div>` : ''}
        ${this.tTopProblems(probs)}`;
    }
    const s = T.summary(mode);
    const svcs = T.services(mode).filter((x) => !x.auto).sort((a, b) => b.profit - a.profit);
    const top = svcs.slice(0, 3).map((x) => this.tSvcRow(x, true)).join('');
    return `<div class="bstats tstats">${cell('tm_vehicles', fmt(s.vehicles))}${cell('tm_services', fmt(s.services))}${cell(mode === 'rail' ? 'tm_stations' : 'tm_stops', fmt(s.stops))}${cell('tm_issues', fmt(s.issues), s.bad ? 'neg' : '')}
      ${cell('tm_revenue', this.money(s.rev))}${cell('tm_cost', this.money(s.cost))}${cell('tm_profit', this.money(s.profit, true), s.profit < 0 ? 'neg' : '')}${cell('tm_this_month', this.money(s.cur, true))}
      ${cell('tm_pax', fmt(s.pu))}${cell('tm_cargo', fmt(s.cu))}</div>
      <p class="muted small">${this.tr('tm_month_note')}</p>
      <div class="row wrap tquick">${this.tQuick(mode)}</div>
      ${this.tTopProblems(probs)}
      ${top ? `<h4>${this.tr('tm_best_services')}</h4>${top}` : `<p class="muted">${this.tr('tm_no_services_' + (mode === 'rail' ? 'rail' : 'road'))}</p>`}`;
  },
  tQuick(mode) {
    const g = this.game, R = g.roads;
    const b = (act, arg, ic, label, primary) => `<button class="btn small ${primary ? 'primary' : 'ghost'}" data-act="${act}" data-arg="${arg}">${icon(ic, 'mini')} ${this.tr(label)}</button>`;
    if (mode === 'rail') return b('newTrain', '', 'plus', 'buy_train', true) + b('tTool', 'track', 'track', 'tool_track') + b('tTool', 'station', 'station', 'tool_station') + b('overlay', 'routes', 'route', 'ov_routes');
    const kind = MODE_KIND[mode];
    const locked = !R || !R.kindUnlocked(kind);
    let h = b('tStop', kind, MODE_ICON[mode], 'tool_roadstop_' + kind, locked ? false : !R.stops.some((s) => s.kind === kind && !s.owner));
    if (mode === 'bus' || mode === 'tram') h += b('tTool', 'line', 'route', 'tm_new_line', R && R.stops.filter((s) => s.kind === kind && !s.owner).length >= 2) + b('overlay', 'lines', 'layers', 'ov_lines');
    if (mode === 'bus' || mode === 'truck') h += b('tStop', 'garage', 'depot', 'tool_roadstop_garage');
    return h;
  },
  tTopProblems(probs) {
    const top = probs.filter((p) => p.sev !== 'info').slice(0, 4);
    if (!top.length) return `<p class="muted small">${icon('check', 'mini')} ${this.tr('tm_no_problems')}</p>`;
    return `<h4>${icon('advisor', 'mini')} ${this.tr('tm_attention')}</h4>${top.map((p) => this.tProbRow(p)).join('')}${probs.length > top.length ? `<button class="btn ghost small" data-act="trainsTab" data-arg="problems">${this.tr('tm_all_problems', { n: probs.length })}</button>` : ''}`;
  },

  // ---------- services ----------
  tServices(mode) {
    const g = this.game, T = g.transport, tv = this.tv();
    const all = T.services(mode);
    const sort = this.svcSort || 'profit';
    const cmp = { profit: (a, b) => b.profit - a.profit, name: (a, b) => a.name.localeCompare(b.name), vehicles: (a, b) => b.n - a.n, load: (a, b) => (b.load || 0) - (a.load || 0), delay: (a, b) => b.delay - a.delay }[sort] || ((a, b) => b.profit - a.profit);
    const lines = all.filter((s) => !s.auto).sort(cmp);
    const own = all.filter((s) => s.auto).sort(cmp);
    const picked = [...tv.picked].filter((k) => k.startsWith('roadveh:')).length;
    const sorts = ['profit', 'name', 'vehicles', 'load', 'delay'].map((k) => `<option value="${k}" ${sort === k ? 'selected' : ''}>${this.tr('tsort_' + k)}</option>`).join('');
    return `<div class="row wrap tfilters"><label class="set compact"><span>${this.tr('tm_sort')}</span><select data-change="svcSort">${sorts}</select></label>
      ${mode === 'bus' || mode === 'tram' || mode === 'all' ? `<button class="btn small" data-act="tTool" data-arg="line">${icon('plus', 'mini')} ${this.tr('tm_new_line')}</button>` : ''}${mode === 'rail' || mode === 'all' ? `<button class="btn small ghost" data-act="newTrain">${icon('plus', 'mini')} ${this.tr('buy_train')}</button>` : ''}</div>
      ${picked ? `<p class="card small">${icon('info', 'mini')} ${this.tr('tm_assign_hint', { n: picked })}</p>` : ''}
      ${lines.length ? lines.map((s) => this.tSvcRow(s, false, picked)).join('') : `<p class="muted">${this.tr('tm_no_lines')}</p>`}
      ${own.length ? `<h4>${this.tr('tm_own_orders', { n: own.length })}</h4><div class="fin-list">${own.slice(0, 60).map((s) => this.tSvcMini(s)).join('')}</div>${own.length > 60 ? `<p class="muted small">${this.tr('tm_more', { n: own.length - 60 })}</p>` : ''}` : ''}
      <p class="muted small">${this.tr('tm_services_help')} ${this.helpBtn(mode === 'rail' ? 'lines' : 'buslines')}</p>`;
  },
  tSvcRow(s, compact, picked = 0) {
    const g = this.game;
    const every = s.headway > 0 ? (s.headway < 90 ? this.tr('tm_every_s', { n: Math.max(1, Math.round(s.headway)) }) : this.tr('tm_every_min', { n: Math.round(s.headway / 60) })) : '—';
    const cell = (k, v, cls = '') => `<div class="${cls}"><small>${this.tr(k)}</small><b>${v}</b></div>`;
    const stops = s.stops.length ? (s.stops.length > 4 ? `${esc(s.stops[0])} – … – ${esc(s.stops[s.stops.length - 1])}` : s.stops.map(esc).join(' – ')) : '';
    const st = s.status && s.status !== 'ok' ? `<span class="pill ${s.status === 'underused' ? '' : 'bad'}">${this.tr('lst_' + s.status)}</span>` : '';
    const load = s.load != null ? `${Math.round(s.load * 100)}%` : '—';
    let acts = '';
    if (!compact && s.line) {
      const l = s.line, can = picked && [...this.tv().picked].some((k) => { const v = g.roads.byId(+k.split(':')[1]); return v && roadModel(v.model).kind === l.kind && v.line !== l.id; });
      acts = `<div class="row wrap"><button class="btn small" data-act="tLineAdd" data-arg="${l.id}:1">${icon('plus', 'mini')} ${this.tr('line_add_vehicle')}</button>${s.suggest > 1 ? `<button class="btn small primary" data-act="tLineAdd" data-arg="${l.id}:${s.suggest}">${this.tr('line_add_n', { n: s.suggest })}</button>` : ''}<label class="set compact inline"><input type="checkbox" data-change="tLineAuto" data-id="${l.id}" ${l.auto ? 'checked' : ''}/> <span>${this.tr('line_auto')}</span></label>${can ? `<button class="btn small primary" data-act="tAssignTo" data-arg="${l.id}">${this.tr('tm_assign_here', { n: picked })}</button>` : ''}</div>`;
    }
    return `<div class="svc ${s.status && s.status !== 'ok' && s.status !== 'underused' ? 'warn' : ''}" style="--lc:${this.lineColorCss(s.color)}">
      <button class="svc-main" data-act="jump" data-arg="${s.sel}"><span class="svc-h"><i class="lc-dot"></i>${icon(MODE_ICON[s.mode], 'mini')}<b>${esc(s.name)}</b>${st}</span><small>${stops ? stops + ' · ' : ''}${this.tr('tm_n_vehicles', { n: s.n })}</small></button>
      <div class="bstats svc-grid">${cell('tm_freq', every)}${cell('tm_pax', fmt(s.pu))}${cell('tm_cargo', fmt(s.cu))}${cell('tm_profit', this.money(s.profit, true), s.profit < 0 ? 'neg' : '')}${cell('tm_delay', s.delay >= 1 ? this.tr('tm_secs', { n: Math.round(s.delay) }) : '—', s.delay > 20 ? 'neg' : '')}${cell('tm_capacity', s.line ? `${fmt(s.capacity)}/${this.tr('tm_month')}` : fmt(s.capacity))}${s.line ? cell('tm_load', load) + cell('tm_waiting', fmt(s.waiting || 0)) : ''}</div>
      ${acts}</div>`;
  },
  tSvcMini(s) {
    return `<button class="fin-row" data-act="jump" data-arg="${s.sel}"><span>${icon(MODE_ICON[s.mode], 'mini')} ${esc(s.name)}</span><small>${s.stops.length ? this.tr('tm_n_stops', { n: s.stops.length }) : this.tr('tm_auto_orders')}${s.delay >= 5 ? ' · ' + this.tr('tm_delay') + ' ' + this.tr('tm_secs', { n: Math.round(s.delay) }) : ''}</small><b>${this.money(s.profit, true)}</b></button>`;
  },

  // ---------- vehicles ----------
  tFiltered(mode) {
    const g = this.game, T = g.transport, tv = this.tv(), q = tv.q.trim().toLowerCase();
    let recs = T.records(mode);
    if (q) recs = recs.filter((r) => r.name.toLowerCase().includes(q) || (r.lineName || '').toLowerCase().includes(q) || String(r.model).toLowerCase().includes(q));
    if (tv.sub !== 'all') recs = recs.filter((r) => r.sub === tv.sub);
    if (tv.line !== 'all') recs = recs.filter((r) => (tv.line === 'none' ? !r.line : r.line === tv.line));
    if (tv.town !== 'all') recs = recs.filter((r) => String(r.town) === tv.town);
    const st = tv.status;
    if (st === 'old') recs = recs.filter((r) => { const m = r.mode === 'rail' ? null : roadModel(r.model); return r.age > (m ? m.life || 16 : 25); });
    else if (st === 'lowrel') recs = recs.filter((r) => r.rel < 0.7);
    else if (st === 'loss') recs = recs.filter((r) => r.profit < 0);
    else if (st !== 'all') recs = recs.filter((r) => r.status === st);
    const cmp = { profit: (a, b) => b.profit - a.profit, loss: (a, b) => a.profit - b.profit, name: (a, b) => a.name.localeCompare(b.name), age: (a, b) => b.age - a.age, rel: (a, b) => a.rel - b.rel, delay: (a, b) => b.delay - a.delay, units: (a, b) => (b.pu + b.cu) - (a.pu + a.cu) }[tv.sort];
    return cmp ? recs.slice().sort(cmp) : recs;
  },
  tVehicles(mode) {
    const g = this.game, T = g.transport, tv = this.tv();
    const all = T.records(mode);
    const recs = this.tFiltered(mode);
    // filter choices from what exists
    const subs = [...new Set(all.map((r) => r.sub))];
    const lines = new Map(); for (const r of all) if (r.line) lines.set(r.line, r.lineName);
    const towns = new Map(); for (const r of all) if (r.town != null) { const t = g.towns.byId(r.town); if (t) towns.set(String(r.town), t.name); }
    const opt = (v, cur, label) => `<option value="${esc(v)}" ${cur === v ? 'selected' : ''}>${esc(label)}</option>`;
    const sel = (key, cur, opts, label) => `<select class="tsel" data-change="tvFilter" data-id="${key}" aria-label="${this.tr(label)}" data-tip="${this.tr(label)}">${opts}</select>`;
    const allOf = (key, label) => opt('all', tv[key], `${this.tr(label)}: ${this.tr('tm_all').toLowerCase()}`);
    const filters = `<input class="search" type="search" placeholder="${this.tr('tm_search')}" aria-label="${this.tr('tm_search')}" value="${esc(tv.q)}" data-input="tvQuery"/>
      <div class="tfilters vf">
        ${subs.length > 1 ? sel('sub', tv.sub, allOf('sub', 'tm_type') + subs.map((k) => opt(k, tv.sub, this.tr('tsub_' + k))).join(''), 'tm_type') : ''}
        ${lines.size ? sel('line', tv.line, allOf('line', 'tm_line') + opt('none', tv.line, this.tr('tm_no_line')) + [...lines].map(([k, n]) => opt(k, tv.line, n)).join(''), 'tm_line') : ''}
        ${towns.size > 1 ? sel('town', tv.town, allOf('town', 'tm_town') + [...towns].sort((a, b) => a[1].localeCompare(b[1])).map(([k, n]) => opt(k, tv.town, n)).join(''), 'tm_town') : ''}
        ${sel('status', tv.status, STATUSES.map((k) => opt(k, tv.status, k === 'all' ? `${this.tr('tm_status')}: ${this.tr('tm_all').toLowerCase()}` : this.tr('tvst_' + k))).join(''), 'tm_status')}
        ${sel('sort', tv.sort, SORTS.map((k) => opt(k, tv.sort, `${this.tr('tm_sort')}: ${this.tr('tsort_' + k)}`)).join(''), 'tm_sort')}
      </div>`;
    // picked vehicles that still exist
    for (const k of tv.picked) { const [t, id] = k.split(':'); if (!(t === 'train' ? g.trains.byId(+id) : g.roads.byId(+id))) tv.picked.delete(k); }
    const n = tv.picked.size;
    const road = [...tv.picked].filter((k) => k.startsWith('roadveh:')).map((k) => g.roads.byId(+k.split(':')[1])).filter(Boolean);
    const kinds = [...new Set(road.map((v) => roadModel(v.model).kind))];
    const lineOpts = kinds.length === 1 ? g.roads.lines.list.filter((l) => l.kind === kinds[0]) : [];
    const repl = kinds.length === 1 ? ROAD_VEHICLES.filter((m) => m.kind === kinds[0] && m.level <= g.progression.level) : [];
    const batch = n ? `<div class="tbatch" role="region" aria-label="${this.tr('tm_batch')}"><b>${this.tr('tm_picked', { n })}</b>
        <div class="row wrap"><button class="btn small" data-act="tvBatch" data-arg="depot">${icon('depot', 'mini')} ${this.tr('tm_b_depot')}</button><button class="btn small" data-act="tvBatch" data-arg="service">${this.tr('tm_b_service')}</button><button class="btn small" data-act="tvBatch" data-arg="release">${this.tr('tm_b_release')}</button><button class="btn small danger" data-act="tvBatch" data-arg="sell">${this.tr('tm_b_sell')}</button><button class="btn small ghost" data-act="tvPickNone">${this.tr('tm_pick_none')}</button></div>
        ${lineOpts.length ? `<label class="set compact"><span>${this.tr('tm_b_assign')}</span><select data-change="tvAssign"><option value="">…</option><option value="none">${this.tr('tm_no_line')}</option>${lineOpts.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select></label>` : ''}
        ${repl.length > 1 ? `<label class="set compact"><span>${this.tr('tm_b_replace')}</span><select data-change="tvReplace"><option value="">…</option>${repl.map((m) => `<option value="${m.id}">${esc(m.name)} · ${fmt(Math.round(m.price * g.difficulty.costMul))} ●</option>`).join('')}</select></label>` : ''}
        ${kinds.length > 1 ? `<p class="muted small">${this.tr('tm_mixed_kinds')}</p>` : ''}</div>` : '';
    const shown = recs.slice(0, tv.limit);
    const rows = shown.map((r) => this.tVehRow(r, tv.picked.has(r.sel))).join('');
    return `${filters}
      <div class="row wrap tpick"><span class="muted small">${this.tr('tm_count', { n: recs.length, t: all.length })}</span>${recs.length ? `<button class="btn small ghost" data-act="tvPickAll">${this.tr('tm_pick_all', { n: Math.min(recs.length, 500) })}</button>` : ''}</div>
      ${batch}
      <div class="tvlist">${rows || `<p class="muted">${this.tr(all.length ? 'list_no_match' : 'tm_no_vehicles')}</p>`}</div>
      ${recs.length > shown.length ? `<button class="btn ghost wide" data-act="tvMore">${this.tr('tm_show_more', { n: recs.length - shown.length })}</button>` : ''}`;
  },
  tVehRow(r, on) {
    const g = this.game;
    const m = r.mode === 'rail' ? null : roadModel(r.model);
    const status = r.mode === 'rail' ? this.statusText(r.v).text : this.rvStatus(r.v);
    const warn = r.status === 'problem' || r.status === 'broken';
    return `<div class="tvrow ${warn ? 'warn' : ''} ${on ? 'on' : ''}"><label class="tvpick"><input type="checkbox" data-change="tvPick" data-id="${r.sel}" ${on ? 'checked' : ''} aria-label="${this.tr('tm_pick')} ${esc(r.name)}"/></label>
      <button class="trow-main" data-act="jump" data-arg="${r.sel}"><b>${r.lineColor != null ? `<i class="lc-dot" style="background:${this.lineColorCss(r.lineColor)}"></i>` : ''}${icon(MODE_ICON[r.mode], 'mini')} ${esc(r.name)}</b><small>${m ? esc(m.name) + ' · ' : ''}${r.lineName ? esc(r.lineName) + ' · ' : ''}${status}</small></button>
      <span class="trow-meta"><b class="${r.profit < 0 ? 'neg' : ''}">${this.money(r.profit, true)}</b><small>${r.age.toFixed(1)} ${this.tr('years_short')} · ${Math.round(r.rel * 100)}%${r.delay >= 5 ? ' · ⏱' + Math.round(r.delay) + 's' : ''}</small></span></div>`;
  },
  tvApply(op) {
    const g = this.game, tv = this.tv(), R = g.roads;
    let done = 0, skip = 0;
    const list = [...tv.picked];
    for (const k of list) {
      const [type, sid] = k.split(':'), id = +sid;
      if (type === 'train') {
        const t = g.trains.byId(id);
        if (!t) continue;
        let ok = false;
        if (op === 'depot') ok = !g.trains.orderDepot(t, null, true).error;
        else if (op === 'service') ok = !g.trains.orderDepot(t, null, false).error;
        else if (op === 'release') ok = g.trains.releaseFromDepot(t);
        else if (op === 'sell') { g.trains.sell(t); ok = true; tv.picked.delete(k); }
        if (ok) done++; else skip++;
      } else {
        const v = R.byId(id);
        if (!v) continue;
        let ok = false;
        if (op === 'depot') ok = !R.sendToGarage(v).error;
        else if (op === 'service') { ok = !R.sendToGarage(v).error; if (ok) v.service = true; }
        else if (op === 'release') { ok = v.state === 'stored'; R.releaseFromGarage(v); }
        else if (op === 'sell') { R.sell(v); ok = true; tv.picked.delete(k); }
        if (ok) done++; else skip++;
      }
    }
    g.transport.invalidate();
    this.toast(this.tr('tm_batch_done', { n: done }) + (skip ? ' · ' + this.tr('tm_batch_skipped', { n: skip }) : ''), done ? 'good' : 'info', 'check');
    this.refreshPanel();
  },

  // ---------- problems ----------
  tProblems(mode, probs) {
    if (!probs.length) return `<div class="empty">${icon('check')}<p>${this.tr('tm_no_problems')}</p></div><p class="muted small">${this.tr('tm_problems_help')}</p>`;
    const groups = ['bad', 'warn', 'info'].map((sev) => {
      const ps = probs.filter((p) => p.sev === sev);
      return ps.length ? `<h4 class="psev ${sev}">${this.tr('tsev_' + sev)} (${ps.length})</h4>${ps.slice(0, 40).map((p) => this.tProbRow(p)).join('')}` : '';
    }).join('');
    return `${groups}<p class="muted small">${this.tr('tm_problems_help')} ${this.helpBtn('overview')}</p>`;
  },
  probText(p) {
    const q = {};
    for (const [k, v] of Object.entries(p.p || {})) q[k] = k === 'cargo' ? this.cargoName(v) : k === 'area' ? this.tr(v) : typeof v === 'number' ? fmt(v) : esc(String(v));
    return this.tr(p.key, q);
  },
  tProbRow(p) {
    const jump = p.sel ? `<button class="icon-btn small" data-act="jump" data-arg="${p.sel}" aria-label="${this.tr('show')}">${icon('focus')}</button>` : p.tile >= 0 ? `<button class="icon-btn small" data-act="jumpTile" data-arg="${p.tile}" aria-label="${this.tr('show')}">${icon('focus')}</button>` : '';
    const fix = p.act ? `<button class="btn small primary" data-act="tFix" data-arg="${p.act.act}|${esc(p.act.arg)}">${this.tr(p.act.label, { n: p.act.n || 1 })}</button>` : '';
    return `<div class="adv tprob ${p.sev}" ${p.preview && p.preview.length ? `data-preview="${p.preview.join(',')}" data-ok="1"` : ''}>${icon(SEV_ICON[p.sev], 'mini')}<span>${icon(MODE_ICON[p.mode] || 'info', 'mini')} ${p.who ? `<b>${esc(p.who)}:</b> ` : ''}${this.probText(p)}</span>${fix}${jump}</div>`;
  },

  // ---------- fleet ----------
  tFleet(mode) {
    const g = this.game, R = g.roads;
    let h = '';
    if (mode === 'all' || mode === 'rail') h += `<h4>${icon('train', 'mini')} ${this.modeName('rail')}</h4>${this.pFleet()}`;
    if (mode !== 'rail' && R) {
      const use = new Map();
      for (const v of R.vehicles) { if (v.owner) continue; const m = roadModel(v.model); if (!m) continue; const md = { bus: 'bus', truck: 'truck', tram: 'tram', dock: 'ship', airport: 'air' }[m.kind]; if (mode !== 'all' && md !== mode) continue; if (!use.has(m.id)) use.set(m.id, []); use.get(m.id).push(v); }
      const rows = [...use.entries()].sort((a, b) => b[1].length - a[1].length).map(([id, vs]) => {
        const m = roadModel(id);
        const age = vs.reduce((a, v) => a + R.ageYears(v), 0) / vs.length, rel = vs.reduce((a, v) => a + R.relOf(v), 0) / vs.length;
        const cands = ROAD_VEHICLES.filter((x) => x.kind === m.kind && x.id !== id && x.level <= g.progression.level);
        const rule = R.rules.find((r) => r.from === id);
        const pick = (this.rvFleetPick || {})[id] || '';
        const cost = pick ? vs.length * Math.round(roadModel(pick).price * g.difficulty.costMul) - vs.length * Math.round(m.price * g.difficulty.costMul * 0.5) : 0;
        return `<div class="fleet-row"><div class="fr-head"><b>${icon(m.kind, 'mini')} ${esc(m.name)}</b><small>${vs.length}× · ${age.toFixed(1)} ${this.tr('years_short')} · ${Math.round(rel * 100)}% · ${this.tr('tm_life', { n: m.life || 16 })}</small></div>
          ${cands.length ? `<div class="row wrap"><select data-change="rvFleetPick" data-id="${id}" aria-label="${this.tr('fleet_replace')}"><option value="">${this.tr('fleet_replace')}…</option>${cands.map((x) => `<option value="${x.id}" ${pick === x.id ? 'selected' : ''}>${esc(x.name)} · ${x.cap} · ${x.speed} km/h</option>`).join('')}</select>
          <button class="btn small ${pick ? 'primary' : ''}" data-act="rvFleetReplace" data-arg="${id}" ${pick && g.economy.canAfford(Math.max(0, cost)) ? '' : 'disabled'}>${this.tr('fleet_replace_btn')}${pick ? ` · ${this.money(cost)}` : ''}</button></div>
          <label class="set compact"><span>${this.tr('rv_replace_rule')}</span><select data-change="rvRuleModel" data-id="${id}"><option value="">${this.tr('rv_rule_none')}</option>${cands.map((x) => `<option value="${x.id}" ${rule && rule.to === x.id ? 'selected' : ''}>${this.tr('rv_rule_to', { name: esc(x.name), n: rule ? rule.age : 12 })}</option>`).join('')}</select></label>` : `<p class="muted small">${this.tr('tm_no_successor')}</p>`}</div>`;
      }).join('');
      if (rows) h += `<h4>${this.tr('tm_road_fleet')}</h4>${rows}<p class="muted small">${this.tr('tm_road_fleet_help')}</p>`;
      else if (mode !== 'all') h += `<p class="muted">${this.tr('tm_no_vehicles')}</p>`;
    }
    return h;
  },

  transportActions() {
    const g = () => this.game;
    const rp = () => { g().transport.invalidate(); this.refreshPanel(); };
    return {
      tMode: (a) => { this.transportMode = a; this.tv().limit = PAGE; this.tv().sub = 'all'; this.tv().line = 'all'; this.refreshPanel(); },
      tTool: (a) => { this.closePanel(); g().construction.setTool(a); },
      tStop: (a) => { const R = g().roads; if (!R.kindUnlocked(a)) { this.error('err_locked'); return; } this.closePanel(); g().construction.stopKind = a; g().construction.setTool('roadstop'); },
      tFix: (a) => { const i = a.indexOf('|'); const act = a.slice(0, i), arg = a.slice(i + 1); const h = this.actions[act]; if (h) h.call(this, arg); rp(); },
      tLineAdd: (a) => { this.actions.rlAdd(a); rp(); },
      tAssignTo: (a) => {
        const R = g().roads, l = R.lines.byId(+a); if (!l) return;
        let n = 0;
        for (const k of this.tv().picked) { if (!k.startsWith('roadveh:')) continue; const v = R.byId(+k.split(':')[1]); if (v && roadModel(v.model).kind === l.kind) { R.lines.assign(v, l); n++; } }
        this.toast(this.tr('tm_assigned', { n, name: l.name }), 'good', 'route'); rp();
      },
      tvPickAll: () => { const tv = this.tv(); for (const r of this.tFiltered(this.tMode()).slice(0, 500)) tv.picked.add(r.sel); this.refreshPanel(); },
      tvPickNone: () => { this.tv().picked.clear(); this.refreshPanel(); },
      tvMore: () => { this.tv().limit += PAGE; this.refreshPanel(); },
      tvBatch: (a) => {
        const n = this.tv().picked.size; if (!n) return;
        if (a === 'sell') { this.confirm(this.tr('tm_sell_q', { n }), this.tr('tm_b_sell'), true).then((ok) => { if (ok) this.tvApply('sell'); }); return; }
        this.tvApply(a);
      },
      rvFleetReplace: (a) => {
        const R = g().roads, to = (this.rvFleetPick || {})[a]; if (!to) return;
        let n = 0, err = null;
        for (const v of R.vehicles.filter((x) => !x.owner && x.model === a)) { const r = R.replaceVehicle(v, to); if (r.error) { err = r.error; break; } n++; }
        if (err) this.error(err);
        if (n) this.toast(this.tr('tm_replaced', { n, name: roadModel(to).name }), 'good', 'check');
        this.rvFleetPick[a] = ''; rp();
      },
    };
  },
  transportInputs() {
    const g = () => this.game;
    const rp = () => { g().transport.invalidate(); this.refreshPanel(); };
    return {
      svcSort: (el) => { this.svcSort = el.value; this.refreshPanel(); },
      tvQuery: (el) => { const tv = this.tv(); tv.q = el.value.slice(0, 40); tv.limit = PAGE; const b = document.querySelector('#panel .tvlist'); if (b) { const recs = this.tFiltered(this.tMode()); b.innerHTML = recs.slice(0, tv.limit).map((r) => this.tVehRow(r, tv.picked.has(r.sel))).join('') || `<p class="muted">${this.tr('list_no_match')}</p>`; } },
      tvFilter: (el) => { const tv = this.tv(); tv[el.dataset.id] = el.value; tv.limit = PAGE; this.refreshPanel(); },
      tvPick: (el) => { const tv = this.tv(); if (el.checked) tv.picked.add(el.dataset.id); else tv.picked.delete(el.dataset.id); this.refreshPanel(); },
      tvAssign: (el) => {
        const R = g().roads, v0 = el.value; if (!v0) return;
        const l = v0 === 'none' ? null : R.lines.byId(+v0);
        let n = 0;
        for (const k of this.tv().picked) { if (!k.startsWith('roadveh:')) continue; const v = R.byId(+k.split(':')[1]); if (!v) continue; if (l && roadModel(v.model).kind !== l.kind) continue; R.lines.assign(v, l); n++; }
        this.toast(l ? this.tr('tm_assigned', { n, name: l.name }) : this.tr('tm_unassigned', { n }), 'good', 'route'); rp();
      },
      tvReplace: (el) => {
        const R = g().roads, to = el.value; if (!to) return;
        let n = 0, err = null;
        for (const k of this.tv().picked) { if (!k.startsWith('roadveh:')) continue; const v = R.byId(+k.split(':')[1]); if (!v || v.model === to) continue; const r = R.replaceVehicle(v, to); if (r.error) { err = r.error; break; } n++; }
        if (err) this.error(err);
        if (n) this.toast(this.tr('tm_replaced', { n, name: roadModel(to).name }), 'good', 'check');
        rp();
      },
      tLineAuto: (el) => { const l = g().roads.lines.byId(+el.dataset.id); if (l) l.auto = el.checked; rp(); },
      rvFleetPick: (el) => { this.rvFleetPick = this.rvFleetPick || {}; this.rvFleetPick[el.dataset.id] = el.value; this.refreshPanel(); },
      rvRuleModel: (el) => { const R = g().roads; if (el.value) R.addRule(el.dataset.id, el.value, 12); else R.removeRule(el.dataset.id); rp(); },
    };
  },
};
