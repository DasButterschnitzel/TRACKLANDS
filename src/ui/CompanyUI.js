// Competitors in the interface (Phase 9): the company panel's league table,
// one page per company (strategy, founded, cash, loan, value, profit,
// passengers and cargo carried, network size, current projects and closed
// lines), and read-only cards for a rival's trains, stations and depots. The
// planner's private scores are never shown in normal play.
import { fmt, escapeHtml as esc } from '../util.js';
import { icon } from './icons.js';
import { locoModel } from '../trains/Trains.js';

const hex = (c) => '#' + (c >>> 0).toString(16).padStart(6, '0').slice(-6);
const BUILDING = ['evaluate', 'design', 'budget', 'approve', 'construct'];

export const CompanyUIMixin = {
  rivalOf(o) { return o && o.owner && this.game.rivals ? this.game.rivals.byId(o.owner) : null; },
  // the company label on anything a rival owns
  companyCard(r) {
    return `<div class="card rival"><i class="rdot" style="background:${hex(r.color)}"></i><b>${esc(r.name)}</b><small>${this.tr('rival_owned')}</small><button class="btn ghost small" data-act="rivalPage" data-arg="${r.id}">${this.tr('rival_details')}</button></div>`;
  },
  // a rival's train, station or depot: look, do not touch
  iRivalRail(kind, o) {
    const g = this.game, r = this.rivalOf(o);
    if (!r) return '';
    let h = this.companyCard(r);
    if (kind === 'train') {
      const m = locoModel(o.model), S = g.stations;
      const stops = (o.route || []).map((x) => S.byId(x.st)).filter(Boolean).map((s) => esc(s.name)).join(' ⇄ ');
      h += `<div class="kvrow"><span>${this.tr('rival_train_model')}</span><b>${esc(m.name)}</b></div>`;
      if (stops) h += `<div class="kvrow"><span>${this.tr('rival_train_route')}</span><b>${stops}</b></div>`;
      h += `<div class="kvrow"><span>${this.tr('rival_train_state')}</span><b>${this.tr('tstate_' + o.state)}</b></div><div class="kvrow"><span>${this.tr('rival_train_trips')}</span><b>${fmt(o.trips || 0)}</b></div>`;
    } else if (kind === 'station') {
      const cs = Object.keys(o.stock).filter((c) => o.stock[c] >= 1);
      h += `<h4>${this.tr('waiting')}</h4>${cs.map((c) => this.cargoRow(c, o.stock[c], g.stations.storage(o))).join('') || `<p class="muted small">${this.tr('none_yet')}</p>`}${this.ratingBlock ? this.ratingBlock(o) : ''}`;
    }
    return h;
  },
  // the league table in the company panel
  rivalRow(r) {
    if (!r.rail) return this.tr('rival_stats', { b: r.vehicles().length, s: r.stops().length, p: fmt(r.lastProfit) });
    const lines = r.rail.projects.filter((p) => p.stage === 'operate').length;
    return this.tr('rival_stats_rail', { l: lines, t: r.trains().length, s: r.stations().length, p: fmt(r.lastProfit) });
  },
  // one company's page
  pRival() {
    const g = this.game, r = g.rivals.byId(this.rivalId);
    if (!r) return `<p class="muted">${this.tr('rival_gone')}</p>`;
    const kv = (k, v) => `<div class="kvrow"><span>${this.tr(k)}</span><b>${v}</b></div>`;
    const y = g.ledger.year(), founded = r.rail && r.rail.founded != null ? r.rail.founded : null;
    const started = g.ledger.monthIndex() >= r.startAt;
    let h = `<div class="card rival big"><i class="rdot" style="background:${hex(r.color)}"></i><b>${esc(r.name)}</b><small>${this.tr('rival_strategy_' + r.strategy)}${r.personality ? ' · ' + this.tr('rival_pers_' + r.personality) : ''}</small></div>`;
    if (!started) h += `<p class="muted">${this.tr('rival_starts', { n: Math.max(1, r.startAt - g.ledger.monthIndex()) })}</p>`;
    h += `<div class="kvgrid">${kv('rival_founded', founded != null ? `${founded} (${this.tr('rival_years', { n: Math.max(0, y - founded) })})` : '—')}${kv('rival_value', fmt(r.value()) + ' ●')}${kv('rival_cash', fmt(Math.round(r.money)) + ' ●')}${kv('rival_loan', fmt(Math.round(r.loan || 0)) + ' ●')}${kv('rival_profit', fmt(r.lastProfit) + ' ●')}${kv('rival_pax', fmt(Math.round(r.paxCarried)))}${kv('rival_cargo', fmt(Math.round(r.cargoCarried)))}</div>`;
    if (r.rail) {
      const ops = r.rail.projects.filter((p) => p.stage === 'operate' || p.stage === 'review');
      const P = g.rivals.planner(r);
      h += `<h3>${this.tr('rival_network')}</h3><div class="kvgrid">${kv('rival_lines', ops.length)}${kv('rival_trains', r.trains().length)}${kv('rival_stations', r.stations().length)}${kv('rival_track', fmt(r.trackTiles()))}</div>`;
      h += ops.length ? `<div class="fin-list">${ops.map((p) => `<div class="fin-row"><span>${icon(p.kind === 'pax' ? 'train' : 'factory', 'mini')} ${esc(P.endName(p.a))} → ${esc(P.endName(p.b))}</span><small>${this.tr(p.mode === 'double' ? 'rival_double' : 'rival_single')}${p.loops ? ' · ' + this.tr('rival_loops', { n: p.loops }) : ''} · ${this.tr('rival_trains_n', { n: p.trains.length })}</small></div>`).join('')}</div>` : `<p class="muted small">${this.tr('none_yet')}</p>`;
      const plans = r.rail.projects.filter((p) => BUILDING.includes(p.stage));
      if (plans.length) h += `<h4>${this.tr('rival_projects')}</h4>${plans.map((p) => `<div class="kvrow small"><span>${esc(P.endName(p.a))} → ${esc(P.endName(p.b))}</span><b>${this.tr(p.stage === 'approve' || p.stage === 'construct' ? 'rival_building' : 'rival_planning')}</b></div>`).join('')}`;
      const closed = (r.rail.history || []).filter((x) => x.outcome === 'retired').slice(-4);
      if (closed.length) h += `<h4>${this.tr('rival_closed_lines')}</h4>${closed.map((x) => `<div class="kvrow small"><span>${esc(x.a)} → ${esc(x.b)}</span><small class="muted">${this.tr('rival_closed_in', { y: g.ledger.year(x.m) })}</small></div>`).join('')}`;
    } else h += `<h3>${this.tr('rival_network')}</h3><div class="kvgrid">${kv('rival_vehicles', r.vehicles().length)}${kv('rival_stops', r.stops().length)}</div>`;
    if (r.hist && r.hist.length) h += `<h4>${this.tr('rival_history')}</h4><div class="fin-list">${r.hist.slice(-6).reverse().map((x) => `<div class="kvrow small"><span>${x.y}</span><small>${this.tr('rival_profit')} ${fmt(x.profit)} ●</small><b>${fmt(x.value)} ●</b></div>`).join('')}</div>`;
    h += `<p class="muted small">${this.tr('rival_page_help')}</p>`;
    return h;
  },
  companyActions() {
    return {
      rivalPage: (a) => { this.rivalId = a; this.openPanel('rival'); },
    };
  },
};
