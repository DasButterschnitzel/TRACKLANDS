// The PLAN panel (Phase 11): planning mode on/off, the projects with their
// ghost state, a cost breakdown and what blocks them, BUILD PROJECT (all or
// nothing) and building the valid part, duplicate, compare, delete; the
// blueprint library: place (rotate, mirror), capture from the map, import
// and export as JSON, the built-in patterns.
import { fmt, escapeHtml as esc } from '../util.js';
import { icon } from './icons.js';

const STATE_CLS = { ok: 'good', wait: 'warn', money: 'warn', blocked: 'bad', empty: '' };
const OP_ICON = { track: 'track', pair: 'track', station: 'station', depot: 'depot', signal: 'signal' };

export const PlanUIMixin = {
  pPlans() {
    const g = this.game, P = g.plans, B = g.blueprints, C = g.construction;
    const tr = (k, p) => this.tr(k, p);
    const head = `<div class="card"><div class="row between"><div><b>${tr('plan_mode')}</b><div class="muted small">${tr('plan_mode_desc')}</div></div>
      <button class="btn ${P.on ? 'primary' : ''}" data-act="planMode" data-arg="${P.on ? 0 : 1}" aria-pressed="${P.on}">${icon('plans')} ${tr(P.on ? 'plan_on' : 'plan_off')}</button></div>
      <div class="row gap"><button class="btn small" data-act="planNew">${icon('plus')} ${tr('plan_new')}</button>${P.list.length >= 2 ? `<button class="btn small" data-act="planCompare">${icon('stats')} ${tr('plan_compare')}</button>` : ''}</div></div>`;
    const cmp = this._planCmp && P.byId(this._planCmp[0]) && P.byId(this._planCmp[1]) ? (() => {
      const c = P.compare(P.byId(this._planCmp[0]), P.byId(this._planCmp[1]));
      const row = (k) => `<tr><td>${tr('plan_cost_' + k)}</td><td>${fmt(c.a.cost[k] || 0)} ●</td><td>${fmt(c.b.cost[k] || 0)} ●</td></tr>`;
      return `<div class="card plan-compare"><table class="tbl"><tr><th></th><th>${esc(c.a.name)}</th><th>${esc(c.b.name)}</th></tr>${['track', 'structure', 'station', 'signal', 'total'].map(row).join('')}<tr><td>${tr('plan_tiles')}</td><td>${c.a.tiles}</td><td>${c.b.tiles}</td></tr><tr><td>${tr('plan_state')}</td><td>${tr('plan_st_' + c.a.state)}</td><td>${tr('plan_st_' + c.b.state)}</td></tr></table></div>`;
    })() : '';
    const projects = P.list.map((p) => {
      const v = P.check(p), act = p.id === P.active;
      const steps = p.steps.map((s, k) => {
        const r = v.steps[k];
        return `<li class="${r.error ? 'bad' : ''}">${icon(OP_ICON[s.op] || 'track', 'mini')} ${tr('plan_op_' + s.op)} · ${fmt(r.cost)} ●${r.error ? ` · <b>${tr(r.error)}</b>` : r.wait ? ` · ${tr('works_will_wait')}` : ''}<button class="icon-btn small" data-act="planDelStep" data-arg="${p.id}:${k}" aria-label="${tr('remove')}">${icon('close')}</button></li>`;
      }).join('');
      const cb = ['track', 'structure', 'station', 'signal'].filter((k) => v.cost[k]).map((k) => `<span class="pill">${tr('plan_cost_' + k)} ${fmt(v.cost[k])} ●</span>`).join('');
      return `<div class="card plan ${act ? 'on' : ''}" data-plan="${p.id}">
        <div class="row between"><button class="link" data-act="planActive" data-arg="${p.id}"><b>${esc(p.name)}</b></button><span class="pill ${STATE_CLS[v.state]}">${tr('plan_st_' + v.state)}</span></div>
        <div class="pill-row">${cb}<span class="pill"><b>${tr('plan_total')} ${fmt(v.cost.total)} ●</b></span></div>
        <ol class="plan-steps">${steps || `<li class="muted">${tr('plan_empty_hint')}</li>`}</ol>
        <div class="row gap wrap">
          <button class="btn small primary" data-act="planBuild" data-arg="${p.id}" ${v.state === 'ok' || v.state === 'wait' ? '' : 'disabled'}>${icon('track')} ${tr('plan_build')}</button>
          ${v.bad.length && v.bad.length < p.steps.length ? `<button class="btn small" data-act="planBuildPart" data-arg="${p.id}">${tr('plan_build_part')}</button>` : ''}
          <button class="btn small" data-act="planFocus" data-arg="${p.id}">${icon('focus')}</button>
          <button class="btn small" data-act="planDup" data-arg="${p.id}">${tr('plan_duplicate')}</button>
          <button class="btn small" data-act="planDel" data-arg="${p.id}">${icon('bulldoze')} ${tr('plan_delete')}</button>
        </div></div>`;
    }).join('');
    const bps = B.all().map((b) => `<div class="bp-row"><span>${icon('blueprint', 'mini')} ${esc(b.name.startsWith('bp_') ? tr(b.name) : b.name)} <small class="muted">${tr('bp_runs', { n: b.runs.length })}</small></span>
      <span class="row gap"><button class="btn small" data-act="bpPlace" data-arg="${esc(b.id)}">${tr('bp_place')}</button><button class="btn small" data-act="bpExport" data-arg="${esc(b.id)}">${tr('bp_export')}</button>${b.builtin ? '' : `<button class="icon-btn small" data-act="bpDelete" data-arg="${esc(b.id)}" aria-label="${tr('remove')}">${icon('close')}</button>`}</span></div>`).join('');
    const bpHead = `<div class="row gap wrap"><button class="btn small" data-act="bpCapture">${icon('blueprint')} ${tr('bp_capture')}</button><button class="btn small" data-act="bpImport">${tr('bp_import')}</button>
      ${C.tool === 'blueprint' ? `<button class="btn small" data-act="bpRotate">${tr('bp_rotate')} (R)</button><button class="btn small ${C.bpMirror ? 'on' : ''}" data-act="bpMirror">${tr('bp_mirror')} (M)</button>` : ''}</div>`;
    return `${head}${cmp}<h4>${tr('plan_projects')}</h4>${projects || `<p class="muted">${tr('plan_none')}</p>`}<h4>${tr('bp_library')}</h4>${bpHead}<div class="bp-list">${bps}</div><p class="muted small">${tr('plan_no_reserve')}</p>`;
  },
  planActions() {
    const g = () => this.game;
    const P = () => g().plans, B = () => g().blueprints;
    const pid = (a) => P().byId(+a);
    const report = (r) => { if (r.error) this.toast(this.tr(r.error) + (r.reason ? ': ' + this.tr(r.reason) : ''), 'bad', 'plans'); else this.toast(this.tr('plan_built', { n: r.built, cost: fmt(r.spent) }), 'good', 'plans'); this.refreshPanel(); };
    return {
      planMode: (a) => { P().setOn(a === '1'); if (P().on && !['track', 'station', 'depot'].includes(g().construction.tool)) g().construction.setTool('track'); this.refreshPanel(); this.renderToolbar && this.renderToolbar(); },
      planNew: () => { P().create(); this.refreshPanel(); },
      planActive: (a) => { P().active = +a; P().invalidate(); this.refreshPanel(); },
      planBuild: (a) => { const p = pid(a); if (p) report(P().build(p)); },
      planBuildPart: (a) => { const p = pid(a); if (p) report(P().build(p, true)); },
      planDup: (a) => { const p = pid(a); if (p) { P().duplicate(p); this.refreshPanel(); } },
      planDel: (a) => { const p = pid(a); if (p) { P().remove(p); this.refreshPanel(); } },
      planDelStep: (a) => { const [id, k] = a.split(':').map(Number); const p = pid(id); if (p) { P().removeStep(p, k); this.refreshPanel(); } },
      planFocus: (a) => { const p = pid(a); const c = p && P().centre(p); if (c) g().camera.focus(c.x, c.z, 30); },
      planCompare: () => { const L = P().list; this._planCmp = this._planCmp ? null : [L[L.length - 2].id, L[L.length - 1].id]; this.refreshPanel(); },
      bpPlace: (a) => { const C = g().construction; C.bpId = a; C.setTool('blueprint'); this.toast(this.tr('bp_place_hint'), 'info', 'blueprint'); this.refreshPanel(); },
      bpRotate: () => { g().construction.bpRotate(); this.refreshPanel(); },
      bpMirror: () => { g().construction.bpToggleMirror(); this.refreshPanel(); },
      bpCapture: () => { g().construction.setTool('bpcapture'); this.toast(this.tr('bp_capture_hint'), 'info', 'blueprint'); },
      bpDelete: (a) => { const b = B().byId(a); if (b) { B().remove(b); this.refreshPanel(); } },
      bpExport: (a) => {
        const b = B().byId(a); if (!b) return;
        const w = this.modal(`<h3>${this.tr('bp_export')}</h3><textarea class="inp code bp-json" rows="7" readonly>${esc(B().exportJSON(b))}</textarea><p class="muted small">${this.tr('bp_export_hint')}</p><div class="row end"><button class="btn" data-mbtn="ok">${this.tr('ok')}</button></div>`, { onCancel: () => {} });
        w.querySelector('[data-mbtn=ok]').onclick = () => w.remove();
      },
      bpImport: () => {
        const w = this.modal(`<h3>${this.tr('bp_import')}</h3><textarea class="inp code bp-json" rows="7" id="bp-in" placeholder='{"tracklandsBlueprint":1, …}'></textarea><div class="row end"><button class="btn ghost" data-mbtn="no">${this.tr('cancel')}</button><button class="btn primary" data-mbtn="ok">${this.tr('bp_import')}</button></div>`, { onCancel: () => {} });
        w.querySelector('[data-mbtn=no]').onclick = () => w.remove();
        w.querySelector('[data-mbtn=ok]').onclick = () => {
          const r = B().importJSON(w.querySelector('#bp-in').value);
          if (r.error) { this.toast(this.tr(r.error), 'bad', 'blueprint'); return; }
          w.remove();
          this.toast(this.tr('bp_imported', { name: r.bp.name }), 'good', 'blueprint');
          this.refreshPanel();
        };
      },
    };
  },
};
