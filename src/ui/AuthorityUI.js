// Town relationship in the town panel, demolition of town buildings and the
// confirmation of station projects that buy property. Every figure the rules
// use is shown: rating and band, recent changes with reasons, permits with
// their thresholds, compensation, people affected, relationship impact.
import { fmt, escapeHtml as esc, tileCX, tileCZ } from '../util.js';
import { icon } from './icons.js';
import { PERMITS, BANDS } from '../world/Authority.js';
import { MONTH_S } from '../economy/Ledger.js';

export const AuthorityUIMixin = {
  authBlock(town) {
    const A = this.game.authority;
    const r = A.rating(town), band = A.band(town);
    const st = A.ensure(town);
    const log = st.log.slice().reverse().map((e) => `<div class="auth-row"><b class="${e.d < 0 ? 'neg' : 'pos'}">${e.d > 0 ? '+' : ''}${e.d}</b><span>${this.tr(e.key, { what: e.p && e.p.arch ? this.tr('bld_' + e.p.arch) : '' })}</span><small>${this.monthName(Math.floor(e.t / MONTH_S))}</small></div>`).join('');
    const permits = Object.keys(PERMITS).map((p) => {
      const need = A.permitNeed(town, p), ok = A.allowed(town, p);
      return `<div class="auth-row"><span>${this.tr('permit_' + p)}</span><small>${need}+</small><b class="${ok ? 'pos' : 'neg'}">${this.tr(ok ? 'permit_ok' : 'permit_no')}</b></div>`;
    }).join('');
    const marks = BANDS.map(([min]) => `<i style="left:${min}%"></i>`).join('');
    return `<h4>${this.tr('auth_heading')}</h4>
      <div class="auth-head"><b>${r}</b><span>/ 100</span><span class="auth-band ${band}">${this.tr('band_' + band)}</span><span class="pill small">${this.tr('policy_' + A.policy(town))}</span></div>
      <div class="auth-bar" role="meter" aria-valuenow="${r}" aria-valuemin="0" aria-valuemax="100">${marks}<em style="width:${r}%"></em></div>
      <p class="muted small">${this.tr('policy_' + A.policy(town) + '_desc')}</p>
      <h5>${this.tr('auth_recent')}</h5>${log || `<p class="muted small">${this.tr('auth_none')}</p>`}
      <h5>${this.tr('auth_permits')}</h5>${permits}
      <p class="muted small">${this.tr('auth_help')}</p>`;
  },

  // town panel: class, districts, metropolitan area, growth pace
  townGrowthBlock(town) {
    const T = this.game.towns;
    const d = T.districts(town);
    const chips = Object.entries(d).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<span class="pill small">${this.tr('dist_' + k)} · ${n}</span>`).join(' ');
    const metro = T.metroWith(town);
    return `<h4>${this.tr('town_structure')}</h4>
      <div class="kv-list"><div><span>${this.tr('town_class')}</span><b>${this.tr('cls_' + T.classOf(town))}</b></div>
        <div><span>${this.tr('town_buildings')}</span><b>${town.buildings.length} / ${T.buildTarget(town)}${town.growing ? ' · ' + this.tr('town_growing') : ''}</b></div>
        ${town.renewed ? `<div><span>${this.tr('town_renewed')}</span><b>${town.renewed}</b></div>` : ''}</div>
      <div class="chips wrap">${chips}</div>
      ${metro.length ? `<p class="small">${icon('town', 'mini')} ${this.tr('town_metro', { names: metro.map((o) => esc(o.name)).join(', ') })}</p>` : ''}
      <p class="muted small">${this.tr('town_growth_pace')}</p>`;
  },
  // bulldozer on a town building
  offerDemolish(tile) {
    const g = this.game, A = g.authority;
    const d = A.demolishInfo(tile);
    if (!d) return;
    const who = d.pop ? this.tr('dem_pop', { n: d.pop }) : d.jobs ? this.tr('dem_jobs', { n: d.jobs }) : '';
    const w = this.modal(`<h3>${icon('bulldoze')} ${this.tr('dem_title', { what: this.tr('bld_' + d.arch) })}</h3>
      ${d.protected ? `<div class="card warn">${icon('lock')} ${this.tr('dem_protected')}</div>` : d.heritage ? `<div class="card warn">${icon('warn')} ${this.tr('dem_heritage')}</div>` : ''}
      <div class="kv-list">
        <div><span>${this.tr('dem_town')}</span><b>${esc(d.town.name)}</b></div>
        <div><span>${this.tr('dem_comp')}</span><b>${fmt(d.cost)} ●</b></div>
        ${who ? `<div><span>${this.tr('dem_affected')}</span><b>${who}</b></div>` : ''}
        <div><span>${this.tr('auth_heading')}</span><b class="neg">${d.impact}</b></div>
        <div><span>${this.tr('dem_current')}</span><b>${d.rating} · ${this.tr('band_' + A.band(d.town))}</b></div>
        ${d.protected ? '' : `<div><span>${this.tr('permit_' + d.permit)}</span><b class="${d.allowed ? 'pos' : 'neg'}">${this.tr(d.allowed ? 'permit_ok' : 'permit_no')} (${d.need}+)</b></div>`}
      </div>
      <div class="row end"><button class="btn ghost" data-mbtn="no">${this.tr('cancel')}</button><button class="btn danger" data-mbtn="ok" ${d.allowed && g.economy.canAfford(d.cost) ? '' : 'disabled'}>${this.tr('dem_confirm')}</button></div>`, { cls: 'demolish', onCancel: () => {} });
    w.querySelector('[data-mbtn=no]').onclick = () => w.remove();
    w.querySelector('[data-mbtn=ok]').onclick = () => {
      w.remove();
      const r = A.demolish(tile);
      if (r.error) { this.error(r.error); return; }
      g.audio.play('bulldoze');
      g.particles.emit('dust', tileCX(tile), 0.6, tileCZ(tile), 14);
      this.toast(this.tr('dem_done', { what: this.tr('bld_' + d.arch), town: d.town.name }), 'info', 'bulldoze');
    };
  },

  // a station project that buys town property: the whole bill first
  confirmProject(plan, onOk) {
    const g = this.game, A = g.authority;
    const towns = new Map();
    for (const a of plan.acquire) { const t = towns.get(a.town.id) || { town: a.town, impact: 0, n: 0 }; t.impact += a.impact; t.n++; towns.set(a.town.id, t); }
    const counts = {};
    for (const a of plan.acquire) counts[a.arch] = (counts[a.arch] || 0) + 1;
    const people = plan.acquire.reduce((s, a) => s + a.pop, 0), jobs = plan.acquire.reduce((s, a) => s + a.jobs, 0);
    const build = plan.cost - plan.compensation;
    const name = plan.mode === 'extend' ? plan.stn.name : this.tr('acq_new_station');
    const w = this.modal(`<h3>${icon('station')} ${this.tr('acq_title', { name: esc(name) })}</h3>
      <h5>${this.tr('acq_requires')}</h5>
      <div class="kv-list">${Object.entries(counts).map(([a, n]) => `<div><span>${n} × ${this.tr('bld_' + a)}</span></div>`).join('')}
        ${people ? `<div><span>${this.tr('dem_affected')}</span><b>${this.tr('dem_pop', { n: people })}${jobs ? ' · ' + this.tr('dem_jobs', { n: jobs }) : ''}</b></div>` : ''}</div>
      <h5>${this.tr('acq_costs')}</h5>
      <div class="kv-list">
        <div><span>${this.tr('acq_land')}</span><b>${fmt(plan.compensation)} ●</b></div>
        <div><span>${this.tr('acq_build')}</span><b>${fmt(build)} ●</b></div>
        <div class="sum"><span>${this.tr('acq_total')}</span><b>${fmt(plan.cost)} ●</b></div>
      </div>
      <h5>${this.tr('auth_heading')}</h5>
      <div class="kv-list">${[...towns.values()].map((t) => `<div><span>${esc(t.town.name)} (${A.rating(t.town)} · ${this.tr('band_' + A.band(t.town))})</span><b class="neg">${t.impact}</b></div>`).join('')}
        <div><span>${this.tr('acq_approval')}</span><b class="pos">${this.tr('permit_ok')}</b></div></div>
      <p class="muted small">${this.tr('acq_note')}</p>
      <div class="row end"><button class="btn ghost" data-mbtn="no">${this.tr('cancel')}</button><button class="btn primary" data-mbtn="ok" ${g.economy.canAfford(plan.cost) ? '' : 'disabled'}>${this.tr('acq_confirm')}</button></div>`, { cls: 'project', onCancel: () => {} });
    w.querySelector('[data-mbtn=no]').onclick = () => w.remove();
    w.querySelector('[data-mbtn=ok]').onclick = () => { w.remove(); const r = onOk(); if (r && r.error) this.error(r.error); };
  },
};
