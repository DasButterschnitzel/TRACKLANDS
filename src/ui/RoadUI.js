// Road stops and road vehicles in the inspector: what a stop serves, what
// waits there, buying buses and trucks, a vehicle's route (tap stops to add
// or remove), its cargo and finances.
import { fmt, escapeHtml as esc, cheb } from '../util.js';
import { icon, cargoIcon } from './icons.js';
import { ROAD_VEHICLES } from '../config.js';
import { roadModel, roadCaps } from '../road/Roads.js';

export const RoadUIMixin = {
  // a rival's stop or vehicle: look, do not touch
  rivalCard(o) {
    const r = this.game.roads.rival(o);
    return r ? `<div class="card rival"><i class="rdot" style="background:#${r.color.toString(16).padStart(6, '0')}"></i><b>${esc(r.name)}</b><small>${this.tr('rival_owned')}</small></div>` : '';
  },
  iRoadStop(s) {
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
      rvStopRemove: (a) => { const s = g().roads.stopById(+a); if (!s) return; const r = g().roads.removeStop(s); if (r.error) this.error(r.error); else g().select(null); },
    };
  },
};
