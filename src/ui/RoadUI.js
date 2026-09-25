// Road stops and road vehicles in the inspector: what a stop serves, what
// waits there, buying buses and trucks, a vehicle's route (tap stops to add
// or remove), its cargo and finances.
import { fmt, escapeHtml as esc, cheb } from '../util.js';
import { icon, cargoIcon } from './icons.js';
import { ROAD_VEHICLES, STOP_TYPES, STOP_ORDER, STOP_FACILITIES } from '../config.js';
import { lineHex } from '../road/Lines.js';
import { roadModel, roadCaps } from '../road/Roads.js';

export const RoadUIMixin = {
  // a rival's stop or vehicle: look, do not touch
  rivalCard(o) {
    const r = this.game.roads.rival(o);
    return r ? `<div class="card rival"><i class="rdot" style="background:#${r.color.toString(16).padStart(6, '0')}"></i><b>${esc(r.name)}</b><small>${this.tr('rival_owned')}</small></div>` : '';
  },
  // a bus stop's type, its upgrade and (stations and terminals) expansions
  stopTypeBlock(s) {
    if (s.kind !== 'bus' || s.owner) return '';
    const g = this.game, R = g.roads, P = R.stopProps(s);
    const nx = R.nextType(s);
    const err = nx ? R.upgradeError(s, nx) : null;
    const facs = Object.keys(STOP_FACILITIES).filter((f) => STOP_ORDER.indexOf(s.type) >= STOP_ORDER.indexOf(STOP_FACILITIES[f].from));
    const up = nx ? `<button class="btn ${err ? 'ghost' : 'primary'} wide" data-act="stopUpgrade" data-arg="${s.id}" ${err ? 'disabled' : ''}>${icon('up', 'mini')} ${this.tr('stop_upgrade_to', { t: this.tr('stype_' + nx) })} · ${fmt(R.upgradeCost(nx))} ●</button><p class="muted small">${this.tr('stype_' + nx + '_desc')}${err ? ' · ' + this.tr(err === 'err_locked' ? 'unlock_level' : err, { n: STOP_TYPES[nx].level }) : ''}</p>` : '';
    return `<h4>${this.tr('stop_type')} ${this.helpBtn('transport')}</h4>
      <div class="card stype"><b>${this.tr('stype_' + s.type)}</b><small>${this.tr('stype_stats', { bays: P.bays, cap: fmt(g.stations.storage(s)), r: P.radius, b: Math.round(P.board * 100) })}</small></div>${up}
      ${facs.length ? `<h5>${this.tr('stop_facilities')}</h5><div class="facgrid">${facs.map((f) => { const n = (s.facilities || []).filter((x) => x === f).length, F = STOP_FACILITIES[f], e = R.facilityError(s, f); return `<button class="chip mini ${n ? 'on' : ''}" data-act="stopFac" data-arg="${s.id}:${f}" ${e ? 'disabled' : ''} data-tip="${this.tr('sfac_' + f + '_desc')}"><b>${this.tr('sfac_' + f)}${F.max > 1 ? ` ${n}/${F.max}` : n ? ' ✓' : ''}</b><small>${n >= F.max ? this.tr('built') : fmt(R.facilityCost(f)) + ' ●'}</small></button>`; }).join('')}</div>` : ''}`;
  },
  // a bus garage: buy, store, service and send out road vehicles
  iGarage(s) {
    const g = this.game, R = g.roads, P = g.progression;
    const stored = R.vehicles.filter((v) => v.state === 'stored' && !v.owner);
    const here = stored.filter((v) => v.tile === s.tile);
    const models = ROAD_VEHICLES.filter((m) => (m.kind === 'bus' || m.kind === 'truck') && !m.retired);
    const buy = models.map((m) => {
      const locked = P.level < m.level, price = Math.round(m.price * g.difficulty.costMul);
      return `<button class="btn ${locked ? 'ghost' : ''} wide rv-buy" data-act="rvBuy" data-arg="${m.id}:${s.id}" ${locked || !g.economy.canAfford(price) ? 'disabled' : ''}>${icon(m.kind, 'mini')} <b>${esc(m.name)}</b> <small>${m.cap} · ${m.speed} km/h · ${fmt(price)} ●${locked ? ' · ' + this.tr('unlock_level', { n: m.level }) : ''}</small></button>`;
    }).join('');
    return `<p class="muted">${this.tr('garage_desc')}</p>
      <h4>${this.tr('garage_stored', { n: here.length })}</h4>
      ${here.map((v) => `<div class="fin-row"><button class="link" data-act="jump" data-arg="roadveh:${v.id}">${icon(roadModel(v.model).kind, 'mini')} ${esc(v.name)}</button><small>${Math.round(R.relOf(v) * 100)}%</small><button class="btn small" data-act="rvRelease" data-arg="${v.id}">${this.tr('garage_release')}</button></div>`).join('') || `<p class="muted small">${this.tr('none_yet')}</p>`}
      <h4>${this.tr('stop_buy')}</h4><div class="col">${buy}</div>
      <p class="muted small">${this.tr('garage_help')}</p>
      <div class="row wrap"><button class="btn ghost danger" data-act="rvStopRemove" data-arg="${s.id}">${icon('bulldoze', 'mini')} ${this.tr('stop_remove')}</button></div>`;
  },
  // a vehicle's condition, garage, replacement and colours
  vehCareBlock(v) {
    const g = this.game, R = g.roads, m = roadModel(v.model);
    const rel = Math.round(R.relOf(v) * 100), age = R.ageYears(v);
    const gr = v.state === 'stored' ? null : R.garageNear(v);
    const better = ROAD_VEHICLES.filter((x) => x.kind === m.kind && x.id !== m.id && x.level <= g.progression.level);
    const rule = R.rules.find((r) => r.from === m.id);
    const cols = [null, 'line', g.company ? g.company.color : 0x2f6b4a, 0xe8c547, 0xd8483a, 0x2f7ad0, 0x3fae5a, 0xe8e8ee, 0x4a5568];
    const line = R.lines.lineOf(v);
    return `<h4>${this.tr('rv_condition')}</h4>
      <div class="bstats"><div><small>${this.tr('rv_reliability')}</small><b>${rel}%</b></div><div><small>${this.tr('rv_age')}</small><b>${age.toFixed(1)} ${this.tr('years_short')}</b></div><div><small>${this.tr('rv_breakdowns')}</small><b>${v.breakdowns || 0}</b></div></div>
      <div class="row wrap">${v.state === 'stored' ? `<button class="btn small primary" data-act="rvRelease" data-arg="${v.id}">${this.tr('garage_release')}</button>` : `<button class="btn small" data-act="rvGarage" data-arg="${v.id}" ${gr ? '' : 'disabled'} data-tip="${gr ? esc(gr.name) : this.tr('err_no_garage')}">${icon('depot', 'mini')} ${this.tr('rv_to_garage')}</button><button class="btn small ghost" data-act="rvService" data-arg="${v.id}" ${gr ? '' : 'disabled'}>${this.tr('rv_service_now')}</button>`}</div>
      ${gr || v.state === 'stored' ? '' : `<p class="muted small">${this.tr('rv_no_garage_help')}</p>`}
      ${better.length ? `<label class="set"><span>${this.tr('rv_replace_rule')}</span><select data-change="rvRule" data-id="${v.id}"><option value="">${this.tr('rv_rule_none')}</option>${better.map((x) => `<option value="${x.id}" ${rule && rule.to === x.id ? 'selected' : ''}>${this.tr('rv_rule_to', { name: esc(x.name), n: rule ? rule.age : 12 })}</option>`).join('')}</select></label>` : ''}
      <h5>${this.tr('rv_livery')}</h5><div class="swatches">${cols.map((c) => c === null ? `<button class="swatch auto ${v.color == null && !(line && line.livery) ? 'on' : ''}" data-act="rvColor" data-arg="${v.id}:auto" aria-label="${this.tr('rv_livery_model')}">A</button>` : c === 'line' ? (line ? `<button class="swatch ${line.livery && v.color == null ? 'on' : ''}" style="background:${lineHex(line.color)}" data-act="rvColor" data-arg="${v.id}:line" aria-label="${this.tr('rv_livery_line')}">L</button>` : '') : `<button class="swatch ${v.color === c ? 'on' : ''}" style="background:${lineHex(c)}" data-act="rvColor" data-arg="${v.id}:${c}" aria-label="${lineHex(c)}"></button>`).join('')}</div>`;
  },
  iRoadStop(s) {
    if (s.kind === 'garage' && !s.owner) return this.iGarage(s);
    const g = this.game, R = g.roads, P = g.progression;
    if (s.owner) return `${this.rivalCard(s)}<h4>${this.tr('waiting')}</h4>${Object.keys(s.stock).filter((c) => s.stock[c] >= 1).map((c) => this.cargoRow(c, s.stock[c], g.stations.storage(s))).join('') || `<p class="muted small">${this.tr('none_yet')}</p>`}${this.ratingBlock(s)}`;
    const towns = (s.links.towns || []).map((id) => g.towns.byId(id)).filter(Boolean);
    const inds = (s.links.industries || []).map((id) => g.industries.byId(id)).filter(Boolean);
    const rail = s.rail != null ? g.stations.byId(s.rail) : null;
    const stock = Object.keys(s.stock).filter((c) => s.stock[c] >= 1).map((c) => this.cargoRow(c, s.stock[c], g.stations.storage(s))).join('');
    const vehs = R.vehicles.filter((v) => v.stops.includes(s.id));
    const models = ROAD_VEHICLES.filter((m) => m.kind === s.kind);
    const buy = models.map((m) => {
      const locked = P.level < m.level, price = Math.round(m.price * g.difficulty.costMul);
      const caps = Object.keys(roadCaps(m)).slice(0, 4).map((c) => cargoIcon(c)).join('');
      return `<button class="btn ${locked ? 'ghost' : ''} wide rv-buy" data-act="rvBuy" data-arg="${m.id}:${s.id}" ${locked || !g.economy.canAfford(price) ? 'disabled' : ''}>${icon(m.kind, 'mini')} <b>${esc(m.name)}</b> <small>${caps} ${m.cap} · ${m.speed} km/h · ${fmt(price)} ●${locked ? ' · ' + this.tr('unlock_level', { n: m.level }) : ''}</small></button>`;
    }).join('');
    return `<div class="pill-row"><span class="pill">${icon(s.kind, 'mini')} ${this.tr('tool_roadstop_' + s.kind)}</span>${rail ? `<button class="tag link" data-act="jump" data-arg="station:${rail.id}">${icon('station', 'mini')} ${this.tr('stop_feeds', { name: esc(rail.name) })}</button>` : ''}</div>
      <h4>${this.tr('stop_serves')}</h4>
      ${towns.map((t) => `<button class="tag link" data-act="jump" data-arg="town:${t.id}">${icon('town', 'mini')}${esc(t.name)}</button>`).join('')}${inds.map((i) => `<button class="tag link" data-act="jump" data-arg="industry:${i.id}">${icon('factory', 'mini')}${esc(g.industries.displayName(i))}</button>`).join('')}
      ${!towns.length && !inds.length ? `<p class="muted small">${this.tr(s.kind === 'truck' ? 'stop_no_industry' : 'stop_no_town')}</p>` : ''}
      <h4>${this.tr('waiting')}</h4>${stock || `<p class="muted small">${this.tr('none_yet')}</p>`}
      ${this.ratingBlock(s)}
      ${this.stopTypeBlock(s)}
      ${s.kind !== 'garage' ? this.stopLinesBlock(s) : ''}
      <h4>${this.tr('stop_vehicles', { n: vehs.length })}</h4>
      ${vehs.map((v) => `<button class="fin-row" data-act="jump" data-arg="roadveh:${v.id}"><span>${icon(roadModel(v.model).kind, 'mini')} ${esc(v.name)}</span><small>${this.rvStatus(v)}</small><b>${fmt(v.earned)} ●</b></button>`).join('')}
      <h4>${this.tr('stop_buy')} ${this.helpBtn('transport')}</h4><div class="col">${buy}</div>
      <p class="muted small">${this.tr('stop_help_' + s.kind)}</p>
      <h4>${this.tr('fin_heading')}</h4>${this.finBlock(s)}
      <div class="row wrap"><button class="btn ghost danger" data-act="rvStopRemove" data-arg="${s.id}">${icon('bulldoze', 'mini')} ${this.tr('stop_remove')}</button></div>`;
  },
  rvStatus(v) {
    const R = this.game.roads;
    if (v.problem) return this.tr('rv_' + v.problem);
    const s = R.targetStop(v);
    if (v.state === 'run') return this.tr('rv_to', { name: s ? esc(s.name) : '?' });
    if (v.state === 'load') return this.tr('rv_loading', { name: s ? esc(s.name) : '?' });
    return this.tr('rv_idle');
  },
  iRoadVeh(v) {
    const g = this.game, R = g.roads, m = roadModel(v.model), caps = roadCaps(m);
    if (v.owner) return `${this.rivalCard(v)}<p class="muted">${esc(m.name)} · ${this.rvStatus(v)}</p>`;
    const load = Object.keys(caps).map((c) => { const n = v.cargo.filter((l) => l.c === c).reduce((a, l) => a + l.n, 0); return n ? this.cargoRow(c, n, caps[c]) : ''; }).join('');
    // stops within reach of the route by road: tap to add; listed ones: tap to remove
    const route = v.stops.map((id, i) => { const s = R.stopById(id); return s ? `<div class="rv-stop"><b>${i + 1}</b><span>${esc(s.name)}</span><button class="icon-btn small" data-act="rvRouteDel" data-arg="${v.id}:${i}" aria-label="${this.tr('remove')}">${icon('minus')}</button></div>` : ''; }).join('');
    const home = R.stopById(v.stops[0]);
    const cands = home ? R.stops.filter((s) => s.kind === m.kind && !s.owner && !v.stops.includes(s.id) && cheb(s.tile, home.tile) <= 40).map((s) => ({ s, ok: !!R.path(home.tile, s.tile) })).filter((x) => x.ok) : [];
    const add = cands.length ? cands.map((x) => `<button class="tag link" data-act="rvRouteAdd" data-arg="${v.id}:${x.s.id}">${icon('plus', 'mini')} ${esc(x.s.name)}</button>`).join('') : `<p class="muted small">${this.tr('rv_no_more_stops')}</p>`;
    const line = R.lines.lineOf(v);
    return `<div class="pill-row"><span class="pill">${icon(m.kind, 'mini')} ${esc(m.name)}</span><span class="pill">${m.speed} km/h</span><span class="pill">${this.rvStatus(v)}</span>${line ? `<button class="pill link" data-act="jump" data-arg="line:${line.id}">${this.lineBadge(line)}</button>` : ''}</div>
      <h4>${this.tr('cargo')}</h4>${load || `<p class="muted small">${this.tr('empty')}</p>`}
      ${this.vehLineBlock(v)}
      ${line ? `<p class="muted small">${this.tr('rv_on_line', { name: esc(line.name) })}</p>` : `<h4>${this.tr('rv_route')}</h4><div class="rv-route">${route}</div>
      <h5>${this.tr('rv_add_stop')}</h5><div class="chips wrap">${add}</div>
      <p class="muted small">${this.tr('rv_route_help')}</p>`}
      ${this.vehCareBlock(v)}
      <h4>${this.tr('fin_heading')}</h4>${this.finBlock(v)}
      <p class="muted small">${this.tr('rv_trips', { n: v.trips, e: fmt(v.earned) })}</p>
      <div class="row wrap"><button class="btn ghost danger" data-act="rvSell" data-arg="${v.id}">${this.tr('sell')} · ${fmt(Math.round(m.price * g.difficulty.costMul * 0.5))} ●</button></div>`;
  },
  roadActions() {
    const g = () => this.game;
    const re = () => this.renderInspector();
    return {
      rvBuy: (a) => { const [mid, sid] = a.split(':'); const r = g().roads.buy(mid, g().roads.stopById(+sid)); if (r.error) this.error(r.error); else { this.toast(this.tr('rv_bought', { name: r.vehicle.name }), 'good', roadModel(mid).kind); this.app.audio.play('coin'); } re(); },
      rvSell: (a) => { const v = g().roads.byId(+a); if (!v) return; g().roads.sell(v); g().select(null); },
      rvRouteAdd: (a) => { const [vid, sid] = a.split(':').map(Number); const v = g().roads.byId(vid); if (v && !v.stops.includes(sid)) { v.stops.push(sid); if (v.state === 'idle') v.t = 0; } re(); },
      rvRouteDel: (a) => { const [vid, i] = a.split(':').map(Number); const v = g().roads.byId(vid); if (v && v.stops.length > 1) { v.stops.splice(i, 1); v.idx = v.idx % v.stops.length; } re(); },
      stopUpgrade: (a) => { const st = g().roads.stopById(+a); if (!st) return; const r = g().roads.upgradeStop(st); if (r.error) this.error(r.error); else this.toast(this.tr('stop_upgraded', { name: st.name, t: this.tr('stype_' + st.type) }), 'good', 'bus'); re(); },
      stopFac: (a) => { const [id, f] = a.split(':'); const st = g().roads.stopById(+id); if (!st) return; const r = g().roads.addFacility(st, f); if (r.error) this.error(r.error); re(); },
      rvGarage: (a) => { const v = g().roads.byId(+a); if (!v) return; const r = g().roads.sendToGarage(v); if (r.error) this.error(r.error); else this.toast(this.tr('rv_going_garage', { name: v.name }), 'info', 'depot'); re(); },
      rvService: (a) => { const v = g().roads.byId(+a); if (!v) return; const r = g().roads.sendToGarage(v); if (r.error) this.error(r.error); else { v.service = true; this.toast(this.tr('rv_going_service', { name: v.name }), 'info', 'depot'); } re(); },
      rvRelease: (a) => { const v = g().roads.byId(+a); if (v) g().roads.releaseFromGarage(v); re(); },
      rvColor: (a) => { const [id, c] = a.split(':'); const v = g().roads.byId(+id); if (!v) return; const l = g().roads.lines.lineOf(v); if (c === 'auto') { v.color = null; if (l) l.livery = false; } else if (c === 'line') { v.color = null; if (l) l.livery = true; } else v.color = +c; re(); },
      rvStopRemove: (a) => { const s = g().roads.stopById(+a); if (!s) return; const r = g().roads.removeStop(s); if (r.error) this.error(r.error); else g().select(null); },
    };
  },
};
