// Railway handbook: short, illustrated explanations of each mechanic. Opened
// from the menu or from the "?" buttons next to the features they explain
// (signal tool, lines, station passengers, research, industries ...).
// Texts live in i18n_rail.js as hb_<topic>_title and hb_<topic>_1..n.
import { icon } from './icons.js';

export const HANDBOOK = [
  { id: 'start', icon: 'station', n: 4 },
  { id: 'stations', icon: 'station', n: 4 },
  { id: 'signals', icon: 'signal', n: 4 },
  { id: 'single', icon: 'track', n: 3 },
  { id: 'passengers', icon: 'town', n: 4 },
  { id: 'journeys', icon: 'route', n: 6 },
  { id: 'lines', icon: 'route', n: 4 },
  { id: 'overtaking', icon: 'train', n: 3 },
  { id: 'rollingstock', icon: 'collection', n: 5 },
  { id: 'freight', icon: 'factory', n: 6 },
  { id: 'economy', icon: 'coin', n: 4 },
  { id: 'tycoon', icon: 'company', n: 5 },
  { id: 'transport', icon: 'bus', n: 5 },
  { id: 'buslines', icon: 'route', n: 6 },
  { id: 'overview', icon: 'trains', n: 4 },
  { id: 'cities', icon: 'town', n: 5 },
  { id: 'world', icon: 'weather', n: 5 },
];

export const HandbookMixin = {
  // a small "?" that opens the handbook at a topic
  helpBtn(topic) {
    return `<button class="icon-btn small help-btn" data-act="help" data-arg="${topic}" aria-label="${this.tr('handbook')}: ${this.tr('hb_' + topic + '_title')}" data-tip="${this.tr('handbook')}: ${this.tr('hb_' + topic + '_title')}">?</button>`;
  },
  pHandbook() {
    const cur = HANDBOOK.find((h) => h.id === this.handbookTopic) || HANDBOOK[0];
    const list = HANDBOOK.map((h) => `<button class="chip ${h.id === cur.id ? 'on' : ''}" data-act="help" data-arg="${h.id}" role="tab" aria-selected="${h.id === cur.id}">${icon(h.icon, 'mini')}<b>${this.tr('hb_' + h.id + '_title')}</b></button>`).join('');
    const pts = Array.from({ length: cur.n }, (_, i) => `<li>${this.tr('hb_' + cur.id + '_' + (i + 1))}</li>`).join('');
    const idx = HANDBOOK.indexOf(cur);
    const nav = `<div class="row hb-nav">${idx > 0 ? `<button class="btn ghost small" data-act="help" data-arg="${HANDBOOK[idx - 1].id}">‹ ${this.tr('hb_' + HANDBOOK[idx - 1].id + '_title')}</button>` : '<span></span>'}${idx < HANDBOOK.length - 1 ? `<button class="btn ghost small" data-act="help" data-arg="${HANDBOOK[idx + 1].id}">${this.tr('hb_' + HANDBOOK[idx + 1].id + '_title')} ›</button>` : ''}</div>`;
    return `<div class="chips wrap hb-topics" role="tablist">${list}</div>
      <article class="hb-page"><h3>${icon(cur.icon)} ${this.tr('hb_' + cur.id + '_title')}</h3><ul>${pts}</ul></article>${nav}
      ${this.game ? `<p class="muted small">${this.tr('hb_tutorial_note')} <button class="btn ghost small" data-act="resetTutorial">${this.tr('reset_tutorial')}</button></p>` : ''}`;
  },
};
