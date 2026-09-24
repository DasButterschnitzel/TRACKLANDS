// News panel (the company newspaper, filterable by kind, tap an item to see
// it on the map) and the world lists panel (towns, industries, stations and
// stops, searchable and sortable; tap a row to go there).
import { fmt, escapeHtml as esc } from '../util.js';
import { icon, cargoIcon } from './icons.js';
import { NEWS_KINDS } from '../world/News.js';
import { MONTH_S } from '../economy/Ledger.js';

const KIND_ICON = { towns: 'town', industry: 'factory', economy: 'stats', company: 'company', weather: 'weather' };
const LIST_TABS = ['towns', 'industries', 'stations'];

export const NewsUIMixin = {
  // item text: parameters that are i18n keys (stage_, ilvl_, ev_, region_) are translated
  newsText(it) {
    const p = {};
    for (const [k, v] of Object.entries(it.p || {})) {
      if (typeof v === 'string' && /^(stage_|ilvl_|ev_|region_)/.test(v)) p[k] = this.tr(v);
      else if (k === 'cargo') p[k] = this.cargoName(v);
      else if (typeof v === 'number') p[k] = fmt(v);
      else p[k] = esc(String(v));
    }
    return this.tr(it.key, p);
  },
  pNews() {
    const N = this.game.news;
    N.unread = 0;
    const b = document.getElementById('badge-news');
    if (b) b.hidden = true;
    const f = this.newsFilter || 'all';
    const chips = ['all', ...NEWS_KINDS].map((k) => `<button class="${f === k ? 'on' : ''}" data-act="newsFilter" data-arg="${k}" aria-pressed="${f === k}">${this.tr('news_k_' + k)}</button>`).join('');
    const rows = N.items.slice().reverse().filter((it) => f === 'all' || it.kind === f).map((it) => {
      const inner = `${icon(KIND_ICON[it.kind] || 'info', 'mini')}<span class="fl-what"><b>${this.newsText(it)}</b><small>${this.monthName(Math.floor(it.t / MONTH_S))}</small></span>`;
      return it.ref ? `<button class="fin-row news" data-act="newsFocus" data-arg="${it.ref.type}:${it.ref.id}">${inner}</button>` : `<div class="fin-row news">${inner}</div>`;
    }).join('');
    const cy = this.game.economy.cycle.state;
    return `<div class="pill-row"><span class="pill ${cy === 'boom' ? 'good' : cy === 'slump' ? 'bad' : ''}">${icon('stats', 'mini')} ${this.tr('econ_' + cy)}</span></div>
      <div class="seg small" role="group">${chips}</div><div class="fin-list">${rows || `<p class="muted">${this.tr('news_none')}</p>`}</div>`;
  },

  // ---------- world lists ----------
  pLists() {
    const tab = this.listTab || 'towns';
    const tabs = LIST_TABS.map((k) => `<button class="${tab === k ? 'on' : ''}" data-act="listTab" data-arg="${k}" aria-pressed="${tab === k}">${this.tr('list_' + k)}</button>`).join('');
    return `<div class="seg fin-tabs" role="tablist">${tabs}</div>
      <input class="search" type="search" placeholder="${this.tr('list_search')}" aria-label="${this.tr('list_search')}" value="${esc(this.listQuery || '')}" data-input="listQuery"/>
      <div id="list-body">${this.listRows()}</div>`;
  },
  listRows() {
    const g = this.game, P = g.progression, q = (this.listQuery || '').trim().toLowerCase();
    const tab = this.listTab || 'towns';
    const hit = (s) => !q || s.toLowerCase().includes(q);
    let rows = [];
    if (tab === 'towns') {
      rows = g.towns.list.filter((t) => P.regionUnlocked(t.region) && hit(t.name)).sort((a, b) => b.pop - a.pop).map((t) => {
        const r = g.authority ? g.authority.rating(t) : null;
        return `<button class="fin-row" data-act="jump" data-arg="town:${t.id}"><span>${icon('town', 'mini')} ${esc(t.name)}</span><small>${this.tr('stage_' + g.towns.stageName(t))} · ${fmt(Math.round(t.pop))} ${this.tr('list_pop')}${r != null ? ' · ' + this.tr('auth_short', { d: r }) : ''}</small></button>`;
      });
    } else if (tab === 'industries') {
      rows = g.industries.list.filter((i) => P.regionUnlocked(i.region) && hit(g.industries.displayName(i))).sort((a, b) => (b.stake || 0) - (a.stake || 0) || b.level - a.level || b.produced - a.produced).map((i) => {
        const outs = g.industries.outputs(i).map((c) => cargoIcon(c, 'mini')).join('');
        return `<button class="fin-row" data-act="jump" data-arg="industry:${i.id}"><span>${icon('factory', 'mini')} ${esc(g.industries.displayName(i))}</span><small>${outs} ${this.tr('ilvl_' + i.level)} · ${this.tr('transported_share', { n: Math.round(g.industries.transportShare(i) * 100) })}${i.stake ? ' · ' + Math.round(i.stake * 100) + ' %' : ''}</small></button>`;
      });
    } else {
      const sts = g.stations.list.filter((s) => hit(s.name)).map((s) => ({ s, kind: 'station', ic: 'station', n: (s.delivered || 0) + (s.picked || 0) }));
      const stops = (g.roads ? g.roads.stops : []).filter((s) => hit(s.name)).map((s) => ({ s, kind: 'roadstop', ic: s.kind, n: (s.delivered || 0) + (s.picked || 0) }));
      rows = [...sts, ...stops].sort((a, b) => b.n - a.n).map(({ s, kind, ic, n }) => {
        const f = g.ledger.objFin(s);
        return `<button class="fin-row" data-act="jump" data-arg="${kind}:${s.id}"><span>${icon(ic, 'mini')} ${esc(s.name)}</span><small>${fmt(Math.round(n))} ${this.tr('list_handled')} · ${this.tr('fin_last_month')} ${this.money(f.lastRev - f.lastCost, true)}</small></button>`;
      });
    }
    return rows.length ? `<div class="fin-list">${rows.join('')}</div><p class="muted small">${this.tr('list_count', { n: rows.length })}</p>` : `<p class="muted">${this.tr(q ? 'list_no_match' : 'none_yet')}</p>`;
  },

  newsActions() {
    const g = () => this.game;
    return {
      newsFilter: (a) => { this.newsFilter = a; this.refreshPanel(); },
      newsFocus: (a) => {
        const [type, id] = a.split(':'); const G = g();
        const ok = type === 'town' ? G.towns.byId(+id) : type === 'industry' ? G.industries.byId(+id) : type === 'station' ? G.stations.byId(+id) : type === 'train' ? G.trains.byId(+id) : null;
        if (!ok) { this.toast(this.tr('news_gone'), 'info'); return; }
        this.closePanel(); G.select({ type, id: +id });
      },
      listTab: (a) => { this.listTab = a; this.refreshPanel(); },
    };
  },
  newsInputs() {
    return {
      listQuery: (el) => { this.listQuery = el.value.slice(0, 40); const b = document.getElementById('list-body'); if (b) b.innerHTML = this.listRows(); },
    };
  },
};
