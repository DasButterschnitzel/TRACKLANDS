// Livery editor: paint a train with a preset or a custom colour mix, on the
// whole train, the locomotives or one vehicle; copy it to every train of the
// same type or make it the company livery. Opened from the train inspector,
// the Train Builder and the train list. Purely cosmetic.
import { LIVERIES } from '../config.js';
import { escapeHtml as esc } from '../util.js';
import { icon } from './icons.js';
import { locoModel } from '../trains/Consist.js';
import { vehicleToken, resolvePaint, customToken, parseCustom, STRIPES, cssHex } from '../trains/Livery.js';

export const LiveryEditorMixin = {
  openLivery(trainId, target = 'train', sel = 0) {
    const t = this.game.trains.byId(trainId);
    if (!t) return;
    this.livEd = { trainId, target, sel: Math.min(sel, t.veh.length - 1), custom: null };
    this.openPanel('livery', trainId);
  },
  // the token the current target wears
  livCurrent(t, E) {
    if (E.target === 'veh') return vehicleToken(t, t.veh[E.sel] || t.veh[0]);
    if (E.target === 'loco') { const l = t.veh.find((v) => v.k === 'L'); return l ? vehicleToken(t, l) : t.livery; }
    return t.livery;
  },
  livModel(t, E) {
    const v = E.target === 'veh' ? t.veh[E.sel] : null;
    return locoModel(v && v.k === 'L' ? v.id : t.model);
  },
  swatch(tok, model, on, act, arg, label, locked) {
    const p = resolvePaint(tok, model);
    const acc = p.accent ?? p.trim;
    return `<button class="swatch lv ${on ? 'on' : ''} ${locked ? 'locked' : ''}" data-act="${act}" data-arg="${arg}" ${locked ? 'disabled' : ''} aria-pressed="${on}" data-tip="${esc(label)}">
      <i style="background:linear-gradient(180deg, ${cssHex(p.roof ?? p.body)} 0 22%, ${cssHex(p.body)} 22% 58%, ${cssHex(acc)} 58% 68%, ${cssHex(p.body)} 68% 82%, ${cssHex(p.trim)} 82%)"></i><span>${esc(label)}</span></button>`;
  },
  pLivery() {
    const g = this.game, P = g.progression;
    const E = this.livEd;
    const t = E && g.trains.byId(E.trainId);
    if (!t) return `<p class="muted">${this.tr('train_gone')}</p>`;
    if (E.sel >= t.veh.length) E.sel = 0;
    const cur = this.livCurrent(t, E);
    const model = this.livModel(t, E);
    if (!E.custom) E.custom = { ...resolvePaint(cur, model), autoAccent: resolvePaint(cur, model).accent == null, autoRoof: resolvePaint(cur, model).roof == null };
    const C = E.custom;
    const targets = ['train', 'loco', 'veh'].map((k) => `<button class="${E.target === k ? 'on' : ''}" data-act="livTarget" data-arg="${k}" aria-pressed="${E.target === k}">${this.tr('liv_target_' + k)}</button>`).join('');
    const strip = E.target === 'veh'
      ? `<div class="vstrip" role="list">${t.veh.map((v, i) => `<button class="vchip ${v.k === 'L' ? 'loco' : ''} ${i === E.sel ? 'on' : ''}" role="listitem" data-act="livSel" data-arg="${i}"><b>${i + 1}</b><small>${esc(this.vehName(v))}</small>${v.lv ? `<i class="dot" style="background:${cssHex(resolvePaint(v.lv, model).body)}"></i>` : ''}</button>`).join('')}</div>`
      : '';
    const presets = LIVERIES.map((l) => this.swatch(l.id, model, cur === l.id, 'livPreset', l.id, this.tr('liv_' + l.id), !P.isUnlocked(l.unlock))).join('');
    const isCustom = !!parseCustom(cur);
    const color = (k, auto) => `<label class="set lv-col"><span>${this.tr('liv_' + k)}</span>
      ${auto ? `<label class="tog small"><input type="checkbox" ${C[auto] ? 'checked' : ''} data-change="livAuto" data-k="${auto}"/><i></i><small>${this.tr('liv_auto')}</small></label>` : ''}
      <input type="color" value="${cssHex(C[k] ?? (k === 'accent' ? C.trim : C.body))}" data-change="livColor" data-k="${k}" ${auto && C[auto] ? 'disabled' : ''} aria-label="${this.tr('liv_' + k)}"/></label>`;
    const stripes = STRIPES.map((s) => `<button class="${C.stripe === s ? 'on' : ''}" data-act="livStripe" data-arg="${s}">${this.tr('stripe_' + s)}</button>`).join('');
    const same = g.trains.trains.filter((o) => o !== t && o.model === t.model).length;
    return `${this.previewBlock(t.veh, t.livery, t.cargo, t.liveryScope, E.target === 'veh' ? E.sel : -1, E.target === 'veh' ? 'livPick' : null)}
      <div class="seg" role="group" aria-label="${this.tr('liv_apply_to')}">${targets}</div>
      ${strip}
      <h4>${this.tr('liv_presets')}</h4>
      <div class="swatches lv-grid">${presets}${this.swatch(customToken(C), model, isCustom, 'livApplyCustom', '', this.tr('liv_custom'))}</div>
      <details class="lv-custom" ${isCustom || E.open ? 'open' : ''}><summary>${icon('builder', 'mini')} ${this.tr('liv_custom_edit')}</summary>
        ${color('body')}${color('trim')}${color('accent', 'autoAccent')}${color('roof', 'autoRoof')}
        <div class="set"><span>${this.tr('liv_stripe')}</span><div class="seg small">${stripes}</div></div>
        <button class="btn primary small" data-act="livApplyCustom">${icon('check', 'mini')} ${this.tr('liv_apply_custom')}</button>
      </details>
      <div class="row wrap">
        <button class="btn ghost" data-act="livSameType" ${same ? '' : 'disabled'}>${this.tr('liv_same_type', { n: same, model: model.name })}</button>
        <button class="btn ghost" data-act="livCompany">${this.tr('liv_company')}</button>
        <button class="btn ghost" data-act="livRestore">${this.tr('liv_restore')}</button>
      </div>
      <p class="muted small">${this.tr('liv_note')}</p>`;
  },
  livApply(tok) {
    const g = this.game, E = this.livEd, t = E && g.trains.byId(E.trainId);
    if (!t) return;
    g.trains.setLivery(t, tok, E.target, E.sel);
    E.custom = null;
    this.app.audio.play('click');
    this.refreshPanel(); this.renderInspector && this.renderInspector();
  },
  // index of the vehicle under a point of the preview image (0..1 across)
  pickVehicleAt(veh, frac, gap) {
    const lens = veh.map((v) => this.vehLenOf(v));
    const total = lens.reduce((a, b) => a + b, 0) + Math.max(0, veh.length - 1) * gap;
    const half = total / 2 + 0.45;
    let x = -half + frac * 2 * half + total / 2;
    for (let i = 0; i < veh.length; i++) { if (x <= lens[i] + gap / 2) return i; x -= lens[i] + gap; }
    return veh.length - 1;
  },
  liveryActions() {
    const g = () => this.game;
    const E = () => this.livEd;
    const re = () => this.refreshPanel();
    return {
      livery: (a) => this.openLivery(+a),
      livTarget: (a) => { E().target = a; E().custom = null; re(); },
      livSel: (a) => { E().sel = +a; E().custom = null; re(); },
      livPick: (a, el, ev) => { const t = g().trains.byId(E().trainId); if (!t || !ev) return; const r = el.getBoundingClientRect(); E().sel = this.pickVehicleAt(t.veh, (ev.clientX - r.left) / r.width, this.consistGap()); E().custom = null; re(); },
      livPreset: (a) => this.livApply(a),
      livStripe: (a) => { E().custom.stripe = a; E().open = true; re(); },
      livApplyCustom: () => { const C = E().custom; this.livApply(customToken({ body: C.body, trim: C.trim, accent: C.autoAccent ? null : C.accent, roof: C.autoRoof ? null : C.roof, stripe: C.stripe })); },
      livSameType: () => { const t = g().trains.byId(E().trainId); if (!t) return; const n = g().trains.liveryToSameType(t); this.toast(this.tr('liv_applied_type', { n }), 'good', 'train'); re(); },
      livCompany: () => { const t = g().trains.byId(E().trainId); if (!t) return; g().progression.defaultLivery = this.livCurrent(t, E()); this.toast(this.tr('liv_company_set'), 'good', 'train'); re(); },
      livRestore: () => { const t = g().trains.byId(E().trainId); if (!t) return; g().trains.restoreLivery(t); E().custom = null; re(); this.renderInspector && this.renderInspector(); },
    };
  },
  liveryInputs() {
    return {
      livColor: (el) => { const C = this.livEd && this.livEd.custom; if (!C) return; C[el.dataset.k] = parseInt(el.value.slice(1), 16); this.livEd.open = true; this.refreshPanel(); },
      livAuto: (el) => { const C = this.livEd && this.livEd.custom; if (!C) return; C[el.dataset.k] = el.checked; this.livEd.open = true; this.refreshPanel(); },
    };
  },
};
