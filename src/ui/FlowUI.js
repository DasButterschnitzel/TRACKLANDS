// Journeys in the inspectors (Phase 7): where travellers waiting at a stop
// are heading and why, freight changing vehicle here (where it came from,
// where it goes), the journey of every load on a vehicle, and what a feeder
// vehicle is still owed (loads it handed over are paid when they arrive).
import { fmt, escapeHtml as esc } from '../util.js';
import { icon, cargoIcon } from './icons.js';
import { RS, nodeKey } from '../economy/Network.js';
import { PURPOSE_IDS } from '../economy/Flows.js';
import { crowdingFixes } from '../economy/Quality.js';
import { ROAD_VEHICLES } from '../config.js';

export const FlowUIMixin = {
  nodeName(k) { const NW = this.game.network; return NW ? NW.name(k) : '?'; },
  nodeJump(k) { return k >= RS ? `roadstop:${k - RS}` : `station:${k}`; },
  nodeLink(k) { return `<button class="tag link" data-act="jump" data-arg="${this.nodeJump(k)}">${icon(k >= RS ? 'bus' : 'station', 'mini')}${esc(this.nodeName(k))}</button>`; },

  // a load's journey in a few words: from where, to where, changes, purpose
  journeyNote(lot, here = null) {
    const bits = [];
    if (lot.o != null && lot.o !== here) bits.push(this.tr('jr_from', { name: esc(this.nodeName(lot.o)) }));
    if (lot.fd != null) bits.push(this.tr('jr_to', { name: esc(this.nodeName(lot.fd)) }));
    if (lot.x > 0) bits.push(this.tr('jr_changes', { n: lot.x }));
    if (lot.p) bits.push(this.tr('purpose_' + lot.p));
    return bits.join(' · ');
  },

  // waiting here with a journey of their own: travellers by destination
  // (with their purposes) and freight changing vehicle here
  journeyBlock(node) {
    const pk = node.pk || [];
    if (!pk.length) return '';
    const here = nodeKey(node);
    const dest = new Map(), purp = {}, freight = [];
    let anyTrain = 0;
    for (const p of pk) {
      if (p.c === 'PASSENGERS') {
        if (p.op) { anyTrain += p.n; continue; }
        if (p.fd == null) continue;
        dest.set(p.fd, (dest.get(p.fd) || 0) + p.n);
        if (p.p) purp[p.p] = (purp[p.p] || 0) + p.n;
      } else freight.push(p);
    }
    let h = '';
    if (dest.size || anyTrain) {
      const rows = [...dest.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, n]) => `<div class="kvrow"><span>${this.tr('pax_to', { name: esc(this.nodeName(k)) })}</span><b>${fmt(n)}</b></div>`).join('');
      const more = dest.size > 5 ? `<p class="muted small">${this.tr('pax_more', { n: dest.size - 5 })}</p>` : '';
      const total = Object.values(purp).reduce((a, b) => a + b, 0);
      const chips = PURPOSE_IDS.filter((p) => purp[p]).map((p) => `<span class="pill small" data-tip="${this.tr('purpose_' + p + '_desc')}">${this.tr('purpose_' + p)} ${Math.round((purp[p] / Math.max(1, total)) * 100)}%</span>`).join('');
      h += `<h4 id="jr-pax">${this.tr('jr_pax_heading')} ${this.helpBtn('journeys')}</h4>${rows}${more}${anyTrain ? `<div class="kvrow"><span>${this.tr('jr_any_train')}</span><b>${fmt(anyTrain)}</b></div>` : ''}${chips ? `<div class="pill-row">${chips}</div>` : ''}`;
    }
    if (freight.length) {
      const rows = freight.sort((a, b) => b.n - a.n).slice(0, 6).map((p) => this.cargoRow(p.c, p.n, 0, `<small class="muted">${this.journeyNote(p, here) || this.tr('jr_no_plan')}</small>`)).join('');
      h += `<h4 id="jr-freight">${this.tr('jr_transit_heading')}</h4>${rows}<p class="muted small">${this.tr('jr_transit_help')}</p>`;
    }
    return h;
  },

  // travellers and freight a vehicle handed over that are still on their way
  handoverNote(ref) {
    const F = this.game.flows;
    if (!F) return '';
    const p = F.pendingFor(ref);
    return p.units > 0 ? `<p class="muted small">${icon('route', 'mini')} ${this.tr('jr_handover', { n: fmt(p.units) })}</p>` : '';
  },

  // towns: the trips their people cannot make (no service within reach)
  unservedNote(town) {
    const P = this.game.pax;
    const lost = P && P.unserved ? P.unserved.get(town.id) : null;
    if (!lost) return '';
    const list = PURPOSE_IDS.filter((p) => lost[p] > 0.02).map((p) => this.tr('purpose_' + p));
    return list.length ? `<p class="muted small">${icon('warn', 'mini')} ${this.tr('jr_unserved', { list: list.join(', ') })}</p>` : '';
  },

  // A service's figures and quality (rail and road lines): interval, ride,
  // wait, capacity and demand per month, how regular it runs, the quality
  // score with its factors, and what to do when it is crowded.
  serviceBlock(k, opts = {}) {
    if (!k) return '';
    const secs = (s) => (s < 90 ? `${Math.round(s)} s` : `${(s / 60).toFixed(1)} min`);
    const stat = (label, v, tip = '') => `<div ${tip ? `data-tip="${tip}"` : ''}><small>${label}</small><b>${v}</b></div>`;
    const q = k.quality != null ? Math.round(k.quality * 100) : null;
    const qcls = q == null ? '' : q >= 70 ? 'good' : q >= 45 ? '' : 'warn';
    const bars = k.factors ? Object.entries(k.factors).filter(([f]) => !(k.pax === false && (f === 'crowding' || f === 'journey'))).map(([f, v]) => `<div class="kvrow small" data-tip="${this.tr('q_' + f + '_tip')}"><span>${this.tr('q_' + f)}</span>${this.bar(v, v < 0.4 ? 'warn' : v > 0.75 ? 'good' : '')}<b>${Math.round(v * 100)}</b></div>`).join('') : '';
    const fixes = k.status === 'overcrowded' ? this.crowdFixes(k, opts) : '';
    return `<h4>${this.tr('svc_heading')} ${this.helpBtn('lines')}</h4>
      <div class="bstats lstats">${opts.rail ? stat(this.tr('line_vehicles'), k.n) : ''}${stat(this.tr('line_interval'), k.n && k.headway ? secs(k.headway) : '—')}${stat(this.tr('svc_ride'), k.rideT ? secs(k.rideT) : '—', this.tr('svc_ride_tip'))}${stat(this.tr('line_wait'), k.n && k.headway ? secs(k.headway / 2) : '—')}${opts.rail ? stat(this.tr('line_capacity'), fmt(k.capacity) + '/' + this.tr('per_month')) + stat(this.tr('line_demand'), fmt(k.demand) + '/' + this.tr('per_month')) : ''}${stat(this.tr('svc_regular'), k.reg != null ? Math.round(k.reg * 100) + '%' : '—', this.tr('svc_regular_tip'))}</div>
      ${q != null ? `<div class="pill-row"><span class="pill ${qcls}">${this.tr('svc_quality')} ${q}%</span>${k.status && k.status !== 'ok' ? `<span class="lstat ${k.status}">${this.tr('lst_' + k.status)}</span>` : ''}</div><div class="qbars">${bars}</div>` : ''}${fixes}`;
  },
  // suggestions for a crowded service (Quality.crowdingFixes)
  crowdFixes(k, opts) {
    const g = this.game;
    const ctx = {};
    if (opts.line) {
      const m = g.roads.lines.model(opts.line);
      const better = m ? ROAD_VEHICLES.filter((x) => x.kind === m.kind && x.cap > m.cap && x.level <= g.progression.level).sort((a, b) => a.cap - b.cap)[0] : null;
      if (better) ctx.bigger = better.name;
    }
    if (opts.rail) ctx.longer = 2;
    const list = crowdingFixes(k, ctx);
    return `<div class="card warn">${icon('advisor')} <b>${this.tr('fix_heading')}</b><ul class="fixes">${list.map((f) => `<li>${this.tr(f.key, { n: f.n, name: esc(f.name || '') })}</li>`).join('')}</ul>${opts.line && k.need > k.n ? `<button class="btn small primary" data-act="rlAdd" data-arg="${opts.line.id}:${Math.min(5, k.need - k.n)}">${this.tr('line_add_n', { n: Math.min(5, k.need - k.n) })}</button>` : ''}</div>`;
  },

  // Refurbishment (in a depot or garage) and heritage service (old vehicles)
  fleetBlock(o, isTrain) {
    const F = this.game.fleet;
    if (!F || o.owner) return '';
    const kind = isTrain ? 'T' : 'R', age = F.ageYears(o);
    const err = F.refurbError(o, isTrain), cost = F.refurbCost(o, isTrain);
    const refurb = `<button class="btn small ${err ? 'ghost' : ''}" data-act="refurb" data-arg="${kind}:${o.id}" ${err ? `disabled data-tip="${this.tr(err)}"` : `data-tip="${this.tr('refurb_tip')}"`}>${icon('builder', 'mini')} ${this.tr('refurb')} · ${fmt(cost)} ●</button>`;
    const hOk = F.heritageOk(o);
    const heritage = `<label class="toggle ${hOk ? '' : 'disabled'}" data-tip="${this.tr(hOk ? 'heritage_tip' : 'err_heritage_age', { n: 12 })}"><input type="checkbox" data-change="heritage" data-id="${kind}:${o.id}" ${o.heritage ? 'checked' : ''} ${hOk || o.heritage ? '' : 'disabled'}> ${this.tr('heritage')}</label>`;
    return `<div class="row wrap fleet">${refurb}${heritage}</div>${o.refurb ? `<p class="muted small">${this.tr('refurb_count', { n: o.refurb })}</p>` : ''}${o.heritage ? `<p class="muted small">${icon('star', 'mini')} ${this.tr('heritage_on')}</p>` : age >= 10 && !hOk ? '' : ''}`;
  },

  cargoJourneys(lots, here) {
    return lots.filter((l) => l.o != null || l.fd != null).slice(0, 6).map((l) => `<div class="kvrow small">${cargoIcon(l.c, 'mini')}<span>${fmt(l.n)} · ${this.journeyNote(l, here) || '—'}</span></div>`).join('');
  },
};
