// Scenario menu on the title screen (built-in and own scenarios, play,
// export, delete, import) and the scenario editor; plus the in-game goals
// block and the end-of-scenario dialog.
import { SCENARIOS, GOAL_KINDS, cleanScenario } from '../world/Scenarios.js';
import { CARGO_IDS, DIFFICULTY } from '../config.js';
import { MAP_SIZES, fmt, escapeHtml as esc } from '../util.js';
import { t } from '../i18n.js';
import { icon } from './icons.js';

const KEY = 'tracklands.scenarios';
export function loadCustom() {
  try { const a = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(a) ? a.map(cleanScenario).filter(Boolean) : []; } catch (e) { return []; }
}
function saveCustom(list) { try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch (e) { return false; } }

export const scnName = (sc) => (sc.custom ? sc.name || t('scn_untitled') : t('scn_' + sc.id));
export function goalText(goal, tr = t) {
  return tr('goal_' + goal.k, { n: fmt(goal.n), c: goal.c ? tr('cargo_' + goal.c) : '' });
}

// title: list of scenarios
export function scenarioDialog(app) {
  const own = loadCustom();
  const row = (sc) => `<div class="scn"><div><b>${esc(scnName(sc))}</b><small>${sc.custom ? '' : esc(t('scn_' + sc.id + '_desc')) + '<br>'}${t('size_' + sc.mapSize)} · ${sc.startYear}–${sc.deadline} · ${t('diff_' + sc.difficulty)}</small>
      <ul>${sc.goals.map((g) => `<li>${esc(goalText(g))}</li>`).join('')}</ul></div>
      <div class="row wrap"><button class="btn primary small" data-play="${esc(sc.id)}">${t('scn_play')}</button>${sc.custom ? `<button class="btn ghost small" data-export="${esc(sc.id)}">${t('scn_export')}</button><button class="btn ghost small danger" data-del="${esc(sc.id)}">${t('scn_delete')}</button>` : ''}</div></div>`;
  const w = app.ui.modal(`<h2>${icon('flag')} ${t('scenarios')}</h2>
    <div class="scn-list">${SCENARIOS.map(row).join('')}${own.map(row).join('')}</div>
    <div class="row wrap end"><button class="btn ghost" data-mbtn="import">${t('scn_import')}</button><button class="btn" data-mbtn="edit">${icon('plus', 'mini')} ${t('scn_editor')}</button><button class="btn ghost" data-mbtn="no">${t('close')}</button></div>`, { onCancel: () => {} });
  w.classList.add('scn-modal');
  const all = [...SCENARIOS.map((s) => ({ ...cleanScenario(s), custom: false })), ...own];
  w.querySelectorAll('[data-play]').forEach((b) => { b.onclick = () => { const sc = all.find((s) => s.id === b.dataset.play); if (!sc) return; w.remove(); app.startGame({ seed: sc.seed, difficulty: sc.difficulty, mapSize: sc.mapSize, startYear: sc.startYear, scenario: sc }); }; });
  w.querySelectorAll('[data-del]').forEach((b) => { b.onclick = () => { saveCustom(own.filter((s) => s.id !== b.dataset.del)); w.remove(); scenarioDialog(app); }; });
  w.querySelectorAll('[data-export]').forEach((b) => { b.onclick = () => {
    const sc = own.find((s) => s.id === b.dataset.export);
    const text = JSON.stringify(sc);
    try { navigator.clipboard.writeText(text).catch(() => {}); } catch (e) { /* not allowed here */ }
    const v = app.ui.modal(`<h3>${t('scn_export')}</h3><textarea class="inp code" rows="6" readonly>${esc(text)}</textarea><p class="muted small">${t('scn_export_help')}</p><div class="row end"><button class="btn" data-mbtn="ok">${t('ok')}</button></div>`);
    v.querySelector('[data-mbtn=ok]').onclick = () => v.remove();
  }; });
  w.querySelector('[data-mbtn=no]').onclick = () => w.remove();
  w.querySelector('[data-mbtn=edit]').onclick = () => { w.remove(); scenarioEditor(app); };
  w.querySelector('[data-mbtn=import]').onclick = () => {
    const v = app.ui.modal(`<h3>${t('scn_import')}</h3><textarea class="inp code" rows="6" id="scn-in" placeholder="{ … }"></textarea><div class="row end"><button class="btn ghost" data-mbtn="no">${t('cancel')}</button><button class="btn primary" data-mbtn="ok">${t('scn_import')}</button></div>`);
    v.querySelector('[data-mbtn=no]').onclick = () => v.remove();
    v.querySelector('[data-mbtn=ok]').onclick = () => {
      let sc = null;
      try { sc = cleanScenario(JSON.parse(v.querySelector('#scn-in').value)); } catch (e) { sc = null; }
      if (!sc) { app.ui.toast(t('scn_import_bad'), 'error'); return; }
      sc.id = 'custom_' + Date.now().toString(36);
      saveCustom([...own, sc]);
      v.remove(); w.remove(); scenarioDialog(app);
    };
  };
  return w;
}

// editor: world, start and goals
export function scenarioEditor(app) {
  const goalRow = (k = 'value', n = 50000, c = 'COAL') => `<div class="goal-row"><select data-g="k">${GOAL_KINDS.map((x) => `<option value="${x}" ${x === k ? 'selected' : ''}>${t('goalk_' + x)}</option>`).join('')}</select>
    <select data-g="c" ${k === 'cargo' ? '' : 'hidden'}>${CARGO_IDS.map((x) => `<option value="${x}" ${x === c ? 'selected' : ''}>${t('cargo_' + x)}</option>`).join('')}</select>
    <input class="inp" type="number" min="1" data-g="n" value="${n}" aria-label="${t('scn_target')}"/><button class="icon-btn small" data-g="del" aria-label="${t('scn_delete')}">${icon('close')}</button></div>`;
  const w = app.ui.modal(`<h2>${t('scn_editor')}</h2>
    <label class="set"><span>${t('scn_name')}</span><input class="inp" id="se-name" maxlength="48" value="${t('scn_my')}"/></label>
    <label class="set"><span>${t('world_seed')}</span><input class="inp" id="se-seed" value="${Math.floor(Math.random() * 1e9)}"/></label>
    <label class="set"><span>${t('ng_world')}</span><select id="se-size">${MAP_SIZES.map((n) => `<option value="${n}">${t('size_' + n)}</option>`).join('')}</select></label>
    <label class="set"><span>${t('difficulty')}</span><select id="se-diff">${Object.keys(DIFFICULTY).map((d) => `<option value="${d}" ${d === 'standard' ? 'selected' : ''}>${t('diff_' + d)}</option>`).join('')}</select></label>
    <label class="set"><span>${t('ng_start_year')}</span><input class="inp" type="number" id="se-year" value="1950" min="1800" max="2100"/></label>
    <label class="set"><span>${t('scn_deadline')}</span><input class="inp" type="number" id="se-dead" value="1970" min="1801" max="2300"/></label>
    <label class="set"><span>${t('scn_money')}</span><input class="inp" type="number" id="se-money" value="0" min="0"/></label>
    <h3>${t('scn_goals')}</h3><div id="se-goals">${goalRow('value', 50000)}${goalRow('passengers', 2000)}</div>
    <button class="btn ghost small" id="se-add">${icon('plus', 'mini')} ${t('scn_add_goal')}</button>
    <div class="row wrap end"><button class="btn ghost" data-mbtn="no">${t('cancel')}</button><button class="btn" data-mbtn="save">${t('scn_save')}</button><button class="btn primary" data-mbtn="play">${t('scn_save_play')}</button></div>`, { onCancel: () => {} });
  w.classList.add('scn-modal');
  const box = w.querySelector('#se-goals');
  const wire = () => box.querySelectorAll('.goal-row').forEach((r) => {
    r.querySelector('[data-g=k]').onchange = (e) => { r.querySelector('[data-g=c]').hidden = e.target.value !== 'cargo'; };
    r.querySelector('[data-g=del]').onclick = () => { if (box.children.length > 1) r.remove(); };
  });
  wire();
  w.querySelector('#se-add').onclick = () => { if (box.children.length < 6) { box.insertAdjacentHTML('beforeend', goalRow('towns', 5)); wire(); } };
  const read = () => cleanScenario({
    id: 'custom_' + Date.now().toString(36), name: w.querySelector('#se-name').value, seed: +w.querySelector('#se-seed').value || 1,
    mapSize: +w.querySelector('#se-size').value, difficulty: w.querySelector('#se-diff').value, startYear: +w.querySelector('#se-year').value,
    deadline: +w.querySelector('#se-dead').value, money: +w.querySelector('#se-money').value,
    goals: [...box.querySelectorAll('.goal-row')].map((r) => ({ k: r.querySelector('[data-g=k]').value, c: r.querySelector('[data-g=c]').value, n: +r.querySelector('[data-g=n]').value })),
  });
  const store = () => { const sc = read(); if (!sc) { app.ui.toast(t('scn_invalid'), 'error'); return null; } saveCustom([...loadCustom(), sc]); return sc; };
  w.querySelector('[data-mbtn=no]').onclick = () => { w.remove(); scenarioDialog(app); };
  w.querySelector('[data-mbtn=save]').onclick = () => { if (store()) { w.remove(); scenarioDialog(app); } };
  w.querySelector('[data-mbtn=play]').onclick = () => { const sc = store(); if (!sc) return; w.remove(); app.startGame({ seed: sc.seed, difficulty: sc.difficulty, mapSize: sc.mapSize, startYear: sc.startYear, scenario: sc }); };
  return w;
}

// in game: the goals of the running scenario (objectives panel)
export const ScenarioUIMixin = {
  scenarioBlock() {
    const R = this.game.scenario;
    if (!R) return '';
    const L = this.game.ledger, yearsLeft = Math.max(0, R.sc.deadline - L.year());
    const rows = R.goals().map((g) => `<div class="chk ${g.done ? 'ok' : ''}">${icon(g.done ? 'check' : 'flag')}<span>${esc(goalText(g, this.tr.bind(this)))}</span><small>${fmt(Math.min(g.have, g.n))}/${fmt(g.n)}</small></div>`).join('');
    const st = R.state === 'won' ? `<span class="pill good">${this.tr('scn_won')}</span>` : R.state === 'lost' ? `<span class="pill bad">${this.tr('scn_lost')}</span>` : `<span class="pill">${this.tr('scn_deadline_left', { y: R.sc.deadline, n: yearsLeft })}</span>`;
    return `<div class="card scn-card"><h3>${icon('flag')} ${esc(scnName(R.sc))}</h3>${st}<div class="checks">${rows}</div></div>`;
  },
  scenarioEnd(state) {
    const R = this.game.scenario;
    if (!R) return;
    this.app.audio.play(state === 'won' ? 'legend' : 'reject');
    const w = this.modal(`<h2>${icon('flag')} ${this.tr(state === 'won' ? 'scn_won_title' : 'scn_lost_title')}</h2>
      <p>${this.tr(state === 'won' ? 'scn_won_desc' : 'scn_lost_desc', { name: esc(scnName(R.sc)), y: this.game.ledger.year() })}</p>
      <div class="row end"><button class="btn primary" data-mbtn="ok">${this.tr('scn_keep_playing')}</button></div>`);
    w.querySelector('[data-mbtn=ok]').onclick = () => { if (R.state === 'lost') R.state = 'free'; w.remove(); };
  },
};
