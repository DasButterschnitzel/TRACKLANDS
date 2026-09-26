// Journeys in the inspectors (Phase 7): where travellers waiting at a stop
// are heading and why, freight changing vehicle here (where it came from,
// where it goes), the journey of every load on a vehicle, and what a feeder
// vehicle is still owed (loads it handed over are paid when they arrive).
import { fmt, escapeHtml as esc } from '../util.js';
import { icon, cargoIcon } from './icons.js';
import { RS, nodeKey } from '../economy/Network.js';
import { PURPOSE_IDS } from '../economy/Flows.js';

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

  cargoJourneys(lots, here) {
    return lots.filter((l) => l.o != null || l.fd != null).slice(0, 6).map((l) => `<div class="kvrow small">${cargoIcon(l.c, 'mini')}<span>${fmt(l.n)} · ${this.journeyNote(l, here) || '—'}</span></div>`).join('');
  },
};
