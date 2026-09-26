// Lines for buses, trams, ships, aircraft and trucks: the line tool (tap or
// click stops in order on the map; big markers over every stop, the route
// drawn in the line colour, distance, journey time, demand, running cost and
// revenue estimated before anything is bought), the line inspector (stops,
// pattern, colour, name, vehicles, frequency, wait, capacity, demand, status
// and a suggestion) and the line parts of the stop and vehicle inspectors.
import { fmt, escapeHtml as esc } from '../util.js';
import { icon } from './icons.js';
import { ROAD_VEHICLES } from '../config.js';
import { roadModel } from '../road/Roads.js';
import { LINE_COLORS, PATTERNS, lineHex } from '../road/Lines.js';

const secs = (s) => (s < 90 ? `${Math.round(s)} s` : `${(s / 60).toFixed(1)} min`);

export const LineUIMixin = {
  // ---------- the line tool ----------
  lineDraft() {
    const C = this.game.construction;
    if (!C.lineDraft) C.lineDraft = { stops: [], kind: null, pattern: null, model: null, count: 0, edit: null };
    return C.lineDraft;
  },
  lineReset() { this.game.construction.lineDraft = null; this.game.roads.previewRoute(null); },
  // a tap or click on the map with the line tool
  lineTap(tile) {
    const s = this.game.roads.stopAt(tile);
    if (!s) { this.toast(this.tr('line_pick_stop'), 'info', 'route'); return; }
    this.lineToggleStop(s.id);
  },
  lineToggleStop(id) {
    const g = this.game, R = g.roads, d = this.lineDraft(), s = R.stopById(id);
    if (!s) return;
    if (s.owner) { this.error('err_rival_stop'); return; }
    if (s.kind === 'garage') { this.toast(this.tr('line_no_garage'), 'info', 'depot'); return; }
    if (d.stops.length && d.kind && s.kind !== d.kind) { this.error('err_line_kind', { kind: this.tr('tool_roadstop_' + d.kind) }); return; }
    if (d.stops[d.stops.length - 1] === id) d.stops.pop();
    else d.stops.push(id);
    d.kind = d.stops.length ? d.kind || s.kind : null;
    if (!d.edit) { d.pattern = null; d.count = 0; }
    this.app.audio.play('click');
    this.linePreview();
    this.renderToolbar();
  },
  linePreview() {
    const g = this.game, d = this.lineDraft(), L = g.roads.lines;
    const line = d.edit ? L.byId(d.edit) : null;
    const pattern = d.pattern || (d.stops.length >= 2 ? L.suggestPattern(d.stops) : 'loop');
    g.roads.previewRoute(d.stops.length ? { stops: d.stops, kind: d.kind, pattern, color: line ? line.color : L.nextColor() } : null);
  },
  lineSubbar() {
    const g = this.game, R = g.roads, L = R.lines, d = this.lineDraft();
    if (!d.stops.length) return `<span class="sub-hint">${icon('route')} ${this.tr(d.edit ? 'line_hint_edit' : 'line_hint_start')}</span>`;
    const pattern = d.pattern || L.suggestPattern(d.stops);
    const models = ROAD_VEHICLES.filter((m) => m.kind === d.kind && m.level <= g.progression.level);
    const est = L.estimate(d.kind, d.stops, pattern, d.model || (d.edit ? (L.model(L.byId(d.edit)) || {}).id : null));
    const model = est.model;
    const count = d.count || Math.min(3, est.need);
    const pats = (d.stops.length >= 2 ? PATTERNS : []).map((p) => `<button class="chip ${pattern === p ? 'on' : ''}" data-act="linePattern" data-arg="${p}" data-tip="${this.tr('pat_' + p + '_desc')}"><b>${this.tr('pat_' + p)}</b></button>`).join('');
    const info = d.stops.length < 2 ? this.tr('line_hint_more') : this.tr('line_est', { tiles: est.tiles, t: secs(est.cycle), d: fmt(est.demand), c: fmt(est.cost), r: fmt(est.revenue) });
    const create = d.edit
      ? `<button class="btn small primary" data-act="lineSave" ${d.stops.length < 2 ? 'disabled' : ''}>${icon('check', 'mini')} ${this.tr('line_save')}</button>`
      : `<button class="btn small primary" data-act="lineCreate" ${d.stops.length < 2 || !model ? 'disabled' : ''}>${icon('check', 'mini')} ${this.tr('line_create_n', { n: count })}</button>`;
    const pick = !d.edit && models.length ? `<button class="chip" data-act="lineModel" data-tip="${this.tr('line_model_tip')}"><b>${icon(d.kind, 'mini')} ${esc(model ? model.name : '—')}</b><small>${model ? `${model.cap} · ${fmt(Math.round(model.price * g.difficulty.costMul))}●` : ''}</small></button><button class="icon-btn small" data-act="lineCount" data-arg="-1" aria-label="${this.tr('line_fewer')}" ${count <= 1 ? 'disabled' : ''}>${icon('minus')}</button><b class="sub-num">${count}</b><button class="icon-btn small" data-act="lineCount" data-arg="1" aria-label="${this.tr('line_more')}" ${count >= 12 ? 'disabled' : ''}>${icon('plus')}</button>` : '';
    return `${create}<button class="btn small ghost bb-cancel" data-act="lineClear">${icon('close', 'mini')} ${this.tr(d.edit ? 'cancel' : 'line_clear')}</button><span class="sub-label">${this.tr('line_n_stops', { n: d.stops.length })}</span>${pats}${pick}<span class="sub-hint bb">${info}</span>`;
  },
  // the line tool's one-line status (docked at the top on touch screens)
  lineHintText() {
    const g = this.game, L = g.roads.lines, d = this.lineDraft();
    if (!d.stops.length) return this.tr(d.edit ? 'line_hint_edit' : 'line_hint_start');
    if (d.stops.length < 2) return this.tr('line_hint_more');
    const est = L.estimate(d.kind, d.stops, d.pattern || L.suggestPattern(d.stops), d.model);
    return this.tr('line_est', { tiles: est.tiles, t: secs(est.cycle), d: fmt(est.demand), c: fmt(est.cost), r: fmt(est.revenue) });
  },
  // stop markers over the map while the line tool is active: big targets
  // for fingers, numbered in route order
  updateStopMarks() {
    const g = this.game, box = document.getElementById('stopmarks');
    if (!box) return;
    const on = g.construction.tool === 'line';
    if (!on) { if (box.childElementCount) box.innerHTML = ''; return; }
    const d = this.lineDraft(), R = g.roads;
    const stops = R.stops.filter((s) => !s.owner && s.kind !== 'garage');
    if (box.childElementCount !== stops.length || box._sig !== stops.map((s) => s.id).join(',')) {
      box.innerHTML = stops.map((s) => `<button class="stopmark" data-act="lineStop" data-arg="${s.id}" aria-label="${esc(s.name)}">${icon(s.kind, 'mini')}<b></b></button>`).join('');
      box._sig = stops.map((s) => s.id).join(',');
    }
    stops.forEach((s, k) => {
      const el = box.children[k], p = g.input.tileScreen(s.tile);
      el.style.transform = `translate(${p.x}px, ${p.y - 26}px)`;
      el.hidden = !p.vis || p.x < -40 || p.y < -40 || p.x > innerWidth + 40 || p.y > innerHeight + 40;
      const order = d.stops.map((id, i) => (id === s.id ? i + 1 : 0)).filter(Boolean);
      const b = el.querySelector('b');
      const txt = order.join('·');
      if (b.textContent !== txt) b.textContent = txt;
      el.classList.toggle('on', order.length > 0);
      el.classList.toggle('dim', !!(d.kind && s.kind !== d.kind));
    });
  },
  lineCreate() {
    const g = this.game, R = g.roads, L = R.lines, d = this.lineDraft();
    if (d.stops.length < 2) return;
    const pattern = d.pattern || L.suggestPattern(d.stops);
    const est = L.estimate(d.kind, d.stops, pattern, d.model);
    const model = est.model;
    if (!model) { this.error('err_locked'); return; }
    const r = L.create({ kind: d.kind, stops: d.stops, pattern, model: model.id });
    if (r.error) { this.error(r.error); return; }
    const n = d.count || Math.min(3, est.need);
    const home = R.garageFor ? R.garageFor(r.line) : null;
    let bought = 0;
    for (let k = 0; k < n; k++) { const b = R.buy(model.id, home || R.stopById(d.stops[k % d.stops.length]), null, r.line); if (b.error) { if (!bought) this.error(b.error); break; } bought++; }
    this.toast(this.tr('line_created', { name: r.line.name, n: bought }), 'good', 'route');
    this.app.audio.play('coin');
    this.lineReset();
    g.construction.setTool('select');
    g.select({ type: 'line', id: r.line.id });
  },

  // ---------- the line inspector ----------
  lineBadge(l) { return `<i class="ldot" style="background:${lineHex(l.color)}"></i><b class="lname">${esc(l.name)}</b>`; },
  iLine(l) {
    const g = this.game, R = g.roads, L = R.lines, k = L.metrics(l);
    const stops = L.stops(l);
    const vs = L.vehicles(l);
    const models = ROAD_VEHICLES.filter((m) => m.kind === l.kind && m.level <= g.progression.level);
    const cur = k.model ? k.model.id : models[0] && models[0].id;
    const st = `<span class="lstat ${k.status}">${this.tr('lst_' + k.status)}</span>`;
    const stat = (label, v) => `<div><small>${label}</small><b>${v}</b></div>`;
    const sugg = k.status === 'no_vehicles' ? '' : k.suggest > 0 ? `<div class="card warn">${icon('advisor')} <span>${this.tr('line_suggest_add', { n: k.suggest })}</span><button class="btn small primary" data-act="rlAdd" data-arg="${l.id}:${k.suggest}">${this.tr('line_add_n', { n: k.suggest })}</button></div>` : k.suggest < -1 ? `<div class="card">${icon('info')} <span>${this.tr('line_suggest_less', { n: -k.suggest })}</span></div>` : '';
    const hist = l.hist.slice(-6);
    const last = hist[hist.length - 1];
    return `<div class="pill-row"><span class="pill">${this.lineBadge(l)}</span><span class="pill">${icon(l.kind, 'mini')} ${this.tr('tool_roadstop_' + l.kind)}</span>${st}</div>
      <div class="bstats lstats">${stat(this.tr('line_demand'), fmt(k.demand) + '/' + this.tr('per_month'))}${stat(this.tr('line_capacity'), fmt(k.capacity) + '/' + this.tr('per_month'))}${stat(this.tr('line_vehicles'), k.n)}${stat(this.tr('line_interval'), k.n ? secs(k.headway) : '—')}${stat(this.tr('line_wait'), k.n ? secs(k.wait) : '—')}${stat(this.tr('line_waiting'), fmt(k.waiting))}</div>
      ${sugg}
      <label class="set tog"><span>${this.tr('line_auto')}</span><input type="checkbox" ${l.auto ? 'checked' : ''} data-change="lineAuto" data-id="${l.id}"/><i></i></label>
      <p class="muted small">${this.tr('line_auto_help')}</p>
      <h4>${this.tr('line_stops')} · ${this.tr('pat_' + l.pattern)}</h4>
      <div class="chips wrap">${PATTERNS.map((p) => `<button class="chip mini ${l.pattern === p ? 'on' : ''}" data-act="linePat" data-arg="${l.id}:${p}" ${p === 'shuttle' || l.stops.length > 2 || p === 'loop' ? '' : 'disabled'}><b>${this.tr('pat_' + p)}</b></button>`).join('')}</div>
      <div class="rv-route">${stops.map((s, i) => `<div class="rv-stop l"><b style="background:${lineHex(l.color)}">${i + 1}</b><button class="link" data-act="jump" data-arg="roadstop:${s.id}">${esc(s.name)}</button><small>${fmt(Math.floor(s.stock.PASSENGERS || 0))} ${icon('bus', 'mini')}</small><button class="icon-btn small" data-act="lineMove" data-arg="${l.id}:${i}:-1" ${i === 0 ? 'disabled' : ''} aria-label="${this.tr('move_up')}">${icon('up')}</button><button class="icon-btn small" data-act="lineMove" data-arg="${l.id}:${i}:1" ${i === stops.length - 1 ? 'disabled' : ''} aria-label="${this.tr('move_down')}"><span class="flipv">${icon('up')}</span></button><button class="icon-btn small" data-act="lineDrop" data-arg="${l.id}:${i}" ${stops.length <= 2 ? 'disabled' : ''} aria-label="${this.tr('remove')}">${icon('minus')}</button></div>`).join('')}</div>
      <div class="row wrap"><button class="btn small" data-act="lineEdit" data-arg="${l.id}">${icon('route', 'mini')} ${this.tr('line_edit_map')}</button></div>
      <h4>${this.tr('line_vehicles')}: ${vs.length}</h4>
      ${vs.map((v) => `<button class="fin-row" data-act="jump" data-arg="roadveh:${v.id}"><span>${icon(roadModel(v.model).kind, 'mini')} ${esc(v.name)}</span><small>${this.rvStatus(v)}</small><b>${fmt(v.earned)} ●</b></button>`).join('')}
      ${models.length ? `<div class="row wrap"><select data-change="lineModelSel" data-id="${l.id}">${models.map((m) => `<option value="${m.id}" ${m.id === cur ? 'selected' : ''}>${esc(m.name)} · ${m.cap} · ${fmt(Math.round(m.price * g.difficulty.costMul))} ●</option>`).join('')}</select><button class="btn small primary" data-act="rlAdd" data-arg="${l.id}:1">${icon('plus', 'mini')} ${this.tr('line_add_vehicle')}</button></div>` : ''}
      <h4>${this.tr('fin_heading')}</h4>
      <div class="bstats">${stat(this.tr('line_pax_month'), last ? fmt(last.pax) : '—')}${stat(this.tr('fin_income'), last ? fmt(last.rev) + ' ●' : '—')}${stat(this.tr('fin_expenses'), last ? fmt(last.cost) + ' ●' : '—')}${stat(this.tr('line_profit'), fmt(k.profit) + ' ●')}</div>
      ${hist.length > 1 ? `<div class="lhist">${hist.map((h) => { const mx = Math.max(1, ...hist.map((x) => Math.max(x.rev, x.cost))); return `<i style="height:${Math.round((h.rev / mx) * 100)}%" class="rev"></i><i style="height:${Math.round((h.cost / mx) * 100)}%" class="cost"></i>`; }).join('')}</div>` : `<p class="muted small">${this.tr('line_first_month')}</p>`}
      <h4>${this.tr('line_look')}</h4>
      <label class="set tog"><span>${this.tr('line_livery')}</span><input type="checkbox" ${l.livery ? 'checked' : ''} data-change="lineLivery" data-id="${l.id}"/><i></i></label>
      <label class="set"><span>${this.tr('line_name')}</span><input type="text" maxlength="24" value="${esc(l.name)}" data-change="lineName" data-id="${l.id}"/></label>
      <div class="swatches">${LINE_COLORS.map((c) => `<button class="swatch ${c === l.color ? 'on' : ''}" style="background:${lineHex(c)}" data-act="lineColor" data-arg="${l.id}:${c}" aria-label="${lineHex(c)}"></button>`).join('')}</div>
      <div class="row wrap"><button class="btn ghost danger" data-act="lineDelete" data-arg="${l.id}">${icon('bulldoze', 'mini')} ${this.tr('line_delete')}</button></div>`;
  },
  // lines at a stop (stop inspector)
  stopLinesBlock(s) {
    const L = this.game.roads.lines, ls = L.linesAt(s.id);
    return `<h4>${this.tr('line_lines')} ${this.helpBtn('buslines')}</h4><div class="chips wrap">${ls.map((l) => `<button class="tag link" data-act="jump" data-arg="line:${l.id}">${this.lineBadge(l)}</button>`).join('')}<button class="tag link" data-act="lineFromStop" data-arg="${s.id}">${icon('plus', 'mini')} ${this.tr('line_new_here')}</button></div>`;
  },
  // the line select in a vehicle's inspector
  vehLineBlock(v) {
    const R = this.game.roads, L = R.lines, m = roadModel(v.model);
    const ls = L.list.filter((l) => l.kind === m.kind);
    return `<label class="set"><span>${this.tr('line_line')}</span><select data-change="rvLine" data-id="${v.id}"><option value="" ${v.line == null ? 'selected' : ''}>${this.tr('line_none')}</option>${ls.map((l) => `<option value="${l.id}" ${v.line === l.id ? 'selected' : ''}>${esc(l.name)} · ${L.stops(l).map((s) => esc(s.name)).slice(0, 3).join(' › ')}</option>`).join('')}</select></label>`;
  },

  lineActions() {
    const g = () => this.game;
    const L = () => g().roads.lines;
    const re = () => this.renderInspector();
    return {
      lineStop: (a) => this.lineToggleStop(+a),
      linePattern: (a) => { this.lineDraft().pattern = a; this.linePreview(); this.renderToolbar(); },
      lineModel: () => {
        const d = this.lineDraft(), ms = ROAD_VEHICLES.filter((m) => m.kind === d.kind && m.level <= g().progression.level);
        if (!ms.length) return;
        const cur = d.model ? ms.findIndex((m) => m.id === d.model) : ms.indexOf(L().bestModel(d.kind));
        d.model = ms[(cur + 1) % ms.length].id; d.count = 0;
        this.renderToolbar();
      },
      lineCount: (a) => { const d = this.lineDraft(); const est = L().estimate(d.kind, d.stops, d.pattern, d.model); d.count = Math.max(1, Math.min(12, (d.count || Math.min(3, est.need)) + +a)); this.renderToolbar(); },
      lineCreate: () => this.lineCreate(),
      lineSave: () => { const d = this.lineDraft(), l = L().byId(d.edit); if (!l) return; const r = L().setStops(l, d.stops); if (r.error) { this.error(r.error); return; } if (d.pattern) L().setPattern(l, d.pattern); this.lineReset(); g().construction.setTool('select'); g().select({ type: 'line', id: l.id }); },
      lineClear: () => { const d = this.lineDraft(); const edit = d.edit; this.lineReset(); if (edit) { g().construction.setTool('select'); g().select({ type: 'line', id: edit }); } else this.renderToolbar(); },
      lineFromStop: (a) => { const s = g().roads.stopById(+a); if (!s) return; g().select(null); g().construction.setTool('line'); const d = this.lineDraft(); d.stops = [s.id]; d.kind = s.kind; this.linePreview(); this.renderToolbar(); },
      lineEdit: (a) => { const l = L().byId(+a); if (!l) return; g().select(null); g().construction.setTool('line'); const C = g().construction; C.lineDraft = { stops: l.stops.slice(), kind: l.kind, pattern: l.pattern, model: l.model, count: 0, edit: l.id }; this.linePreview(); this.renderToolbar(); },
      linePat: (a) => { const [id, p] = a.split(':'); const l = L().byId(+id); if (l) L().setPattern(l, p); re(); },
      lineMove: (a) => { const [id, i, dir] = a.split(':').map(Number); const l = L().byId(id); if (!l) return; const j = i + dir; if (j < 0 || j >= l.stops.length) return; const st = l.stops.slice(); [st[i], st[j]] = [st[j], st[i]]; L().setStops(l, st); re(); },
      lineDrop: (a) => { const [id, i] = a.split(':').map(Number); const l = L().byId(id); if (!l || l.stops.length <= 2) return; const st = l.stops.slice(); st.splice(i, 1); L().setStops(l, st); re(); },
      rlAdd: (a) => {
        const [id, n] = a.split(':').map(Number); const l = L().byId(id); if (!l) return;
        const m = L().model(l); if (!m) return;
        const R = g().roads; let bought = 0;
        for (let k = 0; k < n; k++) { const home = R.garageFor ? R.garageFor(l) : null; const r = R.buy(m.id, home || R.stopById(l.stops[k % l.stops.length]), null, l); if (r.error) { this.error(r.error); break; } bought++; }
        if (bought) { this.toast(this.tr('line_added', { n: bought, name: l.name }), 'good', l.kind); this.app.audio.play('coin'); }
        re();
      },
      lineColor: (a) => { const [id, c] = a.split(':').map(Number); const l = L().byId(id); if (l) { l.color = c; L().changed(); } re(); },
      lineDelete: (a) => {
        const l = L().byId(+a); if (!l) return;
        this.confirm(this.tr('line_delete_q', { name: l.name, n: L().vehicles(l).length }), this.tr('line_delete'), true).then((ok) => { if (!ok) return; L().remove(l); g().select(null); this.toast(this.tr('line_deleted', { name: l.name }), 'info', 'route'); });
      },
    };
  },
  lineInputs() {
    const L = () => this.game.roads.lines;
    return {
      lineLivery: (el) => { const l = L().byId(+el.dataset.id); if (l) l.livery = el.checked; this.renderInspector(); },
      lineAuto: (el) => { const l = L().byId(+el.dataset.id); if (l) l.auto = el.checked; this.renderInspector(); },
      lineName: (el) => { const l = L().byId(+el.dataset.id); const v = el.value.trim().slice(0, 24); if (l && v) { l.name = v; L().changed(); } this.renderInspector(); },
      lineModelSel: (el) => { const l = L().byId(+el.dataset.id); if (l) l.model = el.value; this.renderInspector(); },
      rvRule: (el) => { const R = this.game.roads, v = R.byId(+el.dataset.id); if (!v) return; if (el.value) R.addRule(v.model, el.value, 12); else R.removeRule(v.model); this.renderInspector(); },
      rvLine: (el) => { const v = this.game.roads.byId(+el.dataset.id); if (!v) return; const l = el.value ? L().byId(+el.value) : null; if (l) L().assign(v, l); else { v.line = null; L().changed(); } this.renderInspector(); },
    };
  },
};
