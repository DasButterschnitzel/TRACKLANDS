// Finance panel: where money comes from and where it goes. Tabs:
//  overview  – cash, loan, credit, interest, company value, profit figures
//  ledger    – profit and loss by category: this month, last month, year to date
//  history   – monthly charts (income, expenses, profit, cash, debt, value, …)
//  log       – the transaction log; tapping a line shows the object
//  value     – how the company value is made up; the loan
//  stats     – the long-running company statistics
import { fmt, escapeHtml as esc } from '../util.js';
import { icon, cargoIcon } from './icons.js';
import { LOCOS } from '../config.js';
import { locoModel } from '../trains/Consist.js';
import { INCOME_CATS, EXPENSE_CATS, NON_PL, MONTH_S, LOAN_STEP } from '../economy/Ledger.js';

const POS = '#12927f', NEG = '#c05a2e';   // validated pair (dataviz validator, light surface)
const METRICS = ['profit', 'income', 'expenses', 'transport', 'construction', 'cash', 'debt', 'value'];

export const FinanceUIMixin = {
  monthName(m) {
    const L = this.game.ledger;
    return `${this.tr('mon_' + L.monthOfYear(m))} ${L.year(m)}`;
  },
  // game-time span as years/months of the calendar
  ageText(sec) {
    const m = Math.max(0, Math.floor(sec / MONTH_S));
    const y = Math.floor(m / 12);
    return y ? this.tr('age_ym', { y, m: m % 12 }) : this.tr('age_m', { m });
  },
  money(n, sign) {
    const v = Math.round(n);
    return `${sign && v > 0 ? '+' : v < 0 ? '−' : ''}${fmt(Math.abs(v))} ●`;
  },
  pFinance() {
    const tab = this.finTab || 'overview';
    const tabs = ['overview', 'ledger', 'history', 'log', 'value', 'stats'].map((k) => `<button class="${tab === k ? 'on' : ''}" data-act="finTab" data-arg="${k}" aria-pressed="${tab === k}">${this.tr('fin_tab_' + k)}</button>`).join('');
    let body = '';
    if (tab === 'overview') body = this.finOverview();
    else if (tab === 'ledger') body = this.finLedger();
    else if (tab === 'history') body = this.finHistory();
    else if (tab === 'log') body = this.finLog();
    else if (tab === 'value') body = this.finValue();
    else body = this.pStats();
    return `<div class="seg fin-tabs" role="tablist">${tabs}</div>${body}`;
  },

  finOverview() {
    const g = this.game, L = g.ledger, E = g.economy;
    const tm = L.thisMonth(), lm = L.lastMonth(), ytd = L.yearToDate();
    const cv = L.companyValue();
    const cur = L.cur;
    const kv = (ic, v, label, cls = '') => `<div class="${cls}">${icon(ic)}<b>${v}</b><small>${this.tr(label)}</small></div>`;
    const pl = (p) => `<span class="${p < 0 ? 'neg' : 'pos'}">${this.money(p, true)}</span>`;
    const credit = Math.max(0, L.maxLoan() - L.loan);
    return `<p class="muted small">${this.tr('fin_date', { d: this.monthName(L.monthIndex()) })} · ${this.tr('fin_month_left', { s: Math.ceil((1 - L.monthFrac()) * MONTH_S) })}</p>
      <div class="kv-grid fin">
        ${kv('coin', this.money(E.coins), 'fin_cash')}
        ${kv('contracts', this.money(L.loan), 'fin_loan')}
        ${kv('plus', this.money(credit), 'fin_credit')}
        ${kv('stats', (L.rate() * 100).toFixed(1) + ' %', 'fin_rate')}
        ${kv('company', this.money(cv.total), 'fin_value')}
        ${kv('coin', pl(tm.profit), 'fin_profit_month')}
        ${kv('coin', pl(lm.profit), 'fin_profit_last')}
        ${kv('coin', pl(ytd.profit), 'fin_profit_ytd')}
        ${kv('train', this.money(L.transportRevenue()), 'fin_transport')}
        ${kv('trains', this.money(cur.exp.op_trains || 0), 'fin_opcost')}
        ${kv('track', this.money((cur.exp.maint_track || 0) + (cur.exp.maint_station || 0)), 'fin_infra')}
        ${kv('builder', this.money((cur.exp.construction || 0) + (cur.exp.vehicles || 0) + (cur.exp.upgrades || 0)), 'fin_building')}
      </div>
      ${this.finLoanBox()}
      <h4>${this.tr('fin_profit_chart')}</h4>${this.finChart('profit', 12)}
      ${this.finTopTrains()}`;
  },
  finLoanBox() {
    const L = this.game.ledger;
    const room = L.maxLoan() - L.loan;
    return `<div class="card fin-loan"><div><b>${this.tr('fin_loan')}: ${this.money(L.loan)}</b><small>${this.tr('fin_loan_desc', { max: fmt(L.maxLoan()), rate: (L.rate() * 100).toFixed(1), year: fmt(Math.round(L.loan * L.rate())) })}</small></div>
      <div class="row"><button class="btn small" data-act="finBorrow" ${room >= LOAN_STEP ? '' : 'disabled'}>${icon('plus', 'mini')} ${fmt(LOAN_STEP)}</button><button class="btn small ghost" data-act="finRepay" ${L.loan > 0 && this.game.economy.coins >= Math.min(L.loan, LOAN_STEP) ? '' : 'disabled'}>${icon('minus', 'mini')} ${fmt(Math.min(L.loan || LOAN_STEP, LOAN_STEP))}</button></div></div>`;
  },
  // most and least profitable trains last month
  finTopTrains() {
    const g = this.game, L = g.ledger;
    const rows = g.trains.trains.map((t) => { const f = L.objFin(t); return { t, p: f.lastRev - f.lastCost, cur: f.rev - f.cost }; });
    if (!rows.length) return '';
    rows.sort((a, b) => b.p - a.p);
    const pick = rows.length > 6 ? [...rows.slice(0, 3), ...rows.slice(-3)] : rows;
    return `<h4>${this.tr('fin_train_profit')}</h4><div class="fin-list">${pick.map((r) => `<button class="fin-row" data-act="finFocus" data-arg="train:${r.t.id}"><span>${icon('train', 'mini')} ${esc(r.t.name)}</span><small>${this.tr('fin_this_month')} ${this.money(r.cur, true)}</small><b class="${r.p < 0 ? 'neg' : 'pos'}">${this.money(r.p, true)}</b></button>`).join('')}</div><p class="muted small">${this.tr('fin_train_profit_note')}</p>`;
  },

  finLedger() {
    const L = this.game.ledger;
    const cur = L.cur, last = L.months[L.months.length - 1] || { inc: {}, exp: {} };
    const y = Math.floor(cur.m / 12);
    const ytd = { inc: {}, exp: {} };
    for (const p of [...L.months.filter((x) => Math.floor(x.m / 12) === y), cur]) {
      for (const [k, v] of Object.entries(p.inc)) ytd.inc[k] = (ytd.inc[k] || 0) + v;
      for (const [k, v] of Object.entries(p.exp)) ytd.exp[k] = (ytd.exp[k] || 0) + v;
    }
    const cols = [cur, last, ytd];
    const row = (side, k) => {
      const vals = cols.map((c) => c[side][k] || 0);
      if (!vals.some((v) => v)) return '';
      return `<tr class="${NON_PL.has(k) ? 'muted' : ''}"><th scope="row">${this.tr('fin_' + k)}</th>${vals.map((v) => `<td>${v ? fmt(Math.round(v)) : '–'}</td>`).join('')}</tr>`;
    };
    const tot = (side) => cols.map((c) => Object.entries(c[side]).reduce((a, [k, v]) => a + (NON_PL.has(k) ? 0 : v), 0));
    const ti = tot('inc'), te = tot('exp');
    const head = `<tr><th></th><th>${this.tr('fin_this_month')}</th><th>${this.tr('fin_last_month')}</th><th>${this.tr('fin_ytd')}</th></tr>`;
    return `<div class="fin-table-wrap"><table class="fin-table">
      <thead>${head}</thead>
      <tbody><tr class="sec"><th colspan="4">${this.tr('fin_income')}</th></tr>${INCOME_CATS.map((k) => row('inc', k)).join('')}
      <tr class="sum"><th scope="row">${this.tr('fin_total_income')}</th>${ti.map((v) => `<td>${fmt(Math.round(v))}</td>`).join('')}</tr>
      <tr class="sec"><th colspan="4">${this.tr('fin_expenses')}</th></tr>${EXPENSE_CATS.map((k) => row('exp', k)).join('')}
      <tr class="sum"><th scope="row">${this.tr('fin_total_expenses')}</th>${te.map((v) => `<td>${fmt(Math.round(v))}</td>`).join('')}</tr>
      <tr class="sum big"><th scope="row">${this.tr('fin_net')}</th>${ti.map((v, i) => `<td class="${v - te[i] < 0 ? 'neg' : 'pos'}">${this.money(v - te[i], true)}</td>`).join('')}</tr></tbody></table></div>
      <p class="muted small">${this.tr('fin_ledger_note')}</p>`;
  },

  finSeries(metric) {
    const L = this.game.ledger;
    const ps = [...L.months, L.cur];
    return ps.map((p, i) => {
      const r = L.profitOf(p);
      const live = i === ps.length - 1;
      let v = 0;
      switch (metric) {
        case 'profit': v = r.profit; break;
        case 'income': v = r.inc; break;
        case 'expenses': v = r.exp; break;
        case 'transport': v = L.transportRevenue(p); break;
        case 'construction': v = (p.exp.construction || 0) + (p.exp.vehicles || 0) + (p.exp.upgrades || 0) + (p.exp.compensation || 0); break;
        case 'cash': v = live ? this.game.economy.coins : p.cash; break;
        case 'debt': v = live ? L.loan : p.debt; break;
        case 'value': v = live ? L.companyValue().total : p.value; break;
      }
      return { m: p.m, v: Math.round(v), live };
    });
  },
  // one-series bar chart (zero baseline; losses below it in the second colour)
  finChart(metric, n = 24) {
    const data = this.finSeries(metric).slice(-n);
    if (data.length < 2 && !data.some((d) => d.v)) return `<p class="muted">${this.tr('fin_no_history')}</p>`;
    const W = 640, H = 170, padL = 54, padB = 22, padT = 10;
    const max = Math.max(1, ...data.map((d) => d.v)), min = Math.min(0, ...data.map((d) => d.v));
    const span = max - min || 1;
    const y = (v) => padT + (1 - (v - min) / span) * (H - padT - padB);
    const bw = (W - padL - 6) / data.length;
    const zero = y(0);
    let bars = '';
    data.forEach((d, i) => {
      const x = padL + i * bw + 1, w = Math.max(2, bw - 2);
      const top = Math.min(y(d.v), zero), h = Math.max(1, Math.abs(y(d.v) - zero));
      const r = Math.min(4, w / 2, h);
      const col = d.v < 0 ? NEG : POS;
      // rounded at the data end, square at the baseline
      const path = d.v >= 0
        ? `M${x},${top + h}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${top + h}Z`
        : `M${x},${top}V${top + h - r}Q${x},${top + h} ${x + r},${top + h}H${x + w - r}Q${x + w},${top + h} ${x + w},${top + h - r}V${top}Z`;
      const tip = `${this.monthName(d.m)}${d.live ? ' (' + this.tr('fin_so_far') + ')' : ''}: ${this.money(d.v, metric === 'profit')}`;
      bars += `<g class="fbar" data-tip="${esc(tip)}"><rect x="${padL + i * bw}" y="${padT}" width="${bw}" height="${H - padT - padB}" fill="transparent"/><path d="${path}" fill="${col}" ${d.live ? 'fill-opacity="0.55"' : ''}/><title>${esc(tip)}</title></g>`;
    });
    const ticks = [max, min < 0 ? 0 : null, min < 0 ? min : null].filter((v) => v != null);
    const grid = ticks.map((v) => `<line x1="${padL}" x2="${W}" y1="${y(v)}" y2="${y(v)}" class="fgrid"/><text x="${padL - 6}" y="${y(v) + 4}" text-anchor="end" class="flab">${fmt(Math.round(v))}</text>`).join('');
    let xl = '';
    data.forEach((d, i) => { if (d.m % 12 === 0 || i === 0) xl += `<text x="${padL + i * bw + 2}" y="${H - 6}" class="flab">${this.monthName(d.m)}</text>`; });
    return `<svg class="fchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(this.tr('fin_m_' + metric))}">${grid}${bars}<line x1="${padL}" x2="${W}" y1="${zero}" y2="${zero}" class="fzero"/>${xl}</svg>`;
  },
  finHistory() {
    const m = this.finMetric || 'profit';
    const chips = METRICS.map((k) => `<button class="${m === k ? 'on' : ''}" data-act="finMetric" data-arg="${k}" aria-pressed="${m === k}">${this.tr('fin_m_' + k)}</button>`).join('');
    const L = this.game.ledger;
    const years = L.years.slice().reverse().map((y) => { const r = L.profitOf(y); return `<tr><th scope="row">${y.y}</th><td>${fmt(r.inc)}</td><td>${fmt(r.exp)}</td><td class="${r.profit < 0 ? 'neg' : 'pos'}">${this.money(r.profit, true)}</td><td>${fmt(y.value)}</td></tr>`; }).join('');
    return `<div class="seg small wrap" role="group">${chips}</div><h4>${this.tr('fin_m_' + m)}</h4>${this.finChart(m, 24)}
      <p class="muted small">${this.tr('fin_chart_note')}</p>
      ${years ? `<h4>${this.tr('fin_years')}</h4><div class="fin-table-wrap"><table class="fin-table"><thead><tr><th></th><th>${this.tr('fin_income')}</th><th>${this.tr('fin_expenses')}</th><th>${this.tr('fin_net')}</th><th>${this.tr('fin_value')}</th></tr></thead><tbody>${years}</tbody></table></div>` : ''}`;
  },

  finRefName(ref) {
    const g = this.game;
    if (!ref) return '';
    if (ref.type === 'train') { const t = g.trains.byId(ref.id); return t ? t.name : ''; }
    if (ref.type === 'station') { const s = g.stations.byId(ref.id); return s ? s.name : ''; }
    if (ref.type === 'depot') { const d = g.stations.depotById(ref.id); return d ? d.name : ''; }
    if (ref.type === 'tile') return this.tr('fin_site');
    return '';
  },
  // log notes: plain text, '~key:n' (i18n) or '~dlv|CARGO|n|from|to'
  finNote(n) {
    if (!n) return '';
    if (n === 'month') return this.tr('fin_note_month');
    if (n.startsWith('~dlv|')) { const [, c, k, a, b] = n.split('|'); return esc(`${k}× ${this.cargoName(c)}${a ? ' · ' + a : ''} → ${b}`); }
    if (n.startsWith('~')) { const [key, v] = n.slice(1).split(':'); return esc(this.tr(key, { n: v })); }
    return esc(n);
  },
  finLog() {
    const L = this.game.ledger;
    const q = this.finFilter || 'all';
    const chips = ['all', 'in', 'out'].map((k) => `<button class="${q === k ? 'on' : ''}" data-act="finFilter" data-arg="${k}">${this.tr('fin_filter_' + k)}</button>`).join('');
    const rows = L.log.slice().reverse().filter((e) => q === 'all' || (q === 'in' ? e.amt > 0 : e.amt < 0)).slice(0, 150).map((e) => {
      const name = this.finRefName(e.ref);
      const note = this.finNote(e.note);
      const clickable = e.ref && name;
      const inner = `<span class="fl-when">${this.monthName(Math.floor(e.t / MONTH_S))}</span><span class="fl-what"><b>${this.tr('fin_' + e.cat)}</b>${name ? ` · ${esc(name)}` : ''}${note ? `<small>${note}</small>` : ''}</span><b class="${e.amt < 0 ? 'neg' : 'pos'}">${this.money(e.amt, true)}</b>`;
      return clickable ? `<button class="fin-row log" data-act="finFocus" data-arg="${e.ref.type}:${e.ref.id}">${inner}</button>` : `<div class="fin-row log">${inner}</div>`;
    }).join('');
    return `<div class="seg small" role="group">${chips}</div><div class="fin-list">${rows || `<p class="muted">${this.tr('none_yet')}</p>`}</div><p class="muted small">${this.tr('fin_log_note')}</p>`;
  },
  finValue() {
    const L = this.game.ledger, v = L.companyValue();
    const row = (k, n, neg) => `<tr><th scope="row">${this.tr('fin_v_' + k)}</th><td class="${neg ? 'neg' : ''}">${neg ? '−' : ''}${fmt(Math.abs(n))} ●</td></tr>`;
    return `<div class="fin-table-wrap"><table class="fin-table">
      <tbody>${row('cash', v.cash)}${row('vehicles', v.vehicles)}${row('track', v.track)}${row('stations', v.stations)}${row('earnings', v.earnings)}${row('debt', v.debt, true)}
      <tr class="sum big"><th scope="row">${this.tr('fin_value')}</th><td>${fmt(v.total)} ●</td></tr></tbody></table></div>
      <p class="muted small">${this.tr('fin_value_note')}</p>${this.finLoanBox()}`;
  },

  // train / station inspector: finance block
  finBlock(o) {
    const f = this.game.ledger.objFin(o);
    const cell = (label, v, sign) => `<div><small>${this.tr(label)}</small><b class="${sign && v < 0 ? 'neg' : ''}">${this.money(v, sign)}</b></div>`;
    return `<div class="fin-mini">${cell('fin_this_month', f.rev - f.cost, true)}${cell('fin_last_month', f.lastRev - f.lastCost, true)}${cell('fin_life_rev', f.lifeRev)}${cell('fin_life_profit', f.lifeRev - f.lifeCost, true)}</div>`;
  },

  // station panel: cargo ratings with every factor
  ratingBlock(stn) {
    const R = this.game.ratings;
    const cs = Object.keys(stn.ratings || {});
    if (!cs.length) return '';
    // the inspector re-renders twice a second: remember which lists are open
    this.rtOpen = this.rtOpen || new Set();
    if (!this._rtHook) { this._rtHook = true; document.addEventListener('toggle', (e) => { const d = e.target; if (d && d.dataset && d.dataset.rt) { if (d.open) this.rtOpen.add(d.dataset.rt); else this.rtOpen.delete(d.dataset.rt); } }, true); }
    const rows = cs.map((c) => {
      const r = Math.round(R.rating(stn, c) * 100), tgt = Math.round(R.target(stn, c) * 100);
      const f = R.factors(stn, c).map(([k, v]) => `<div><span>${this.tr(k)}</span><b class="${v < 0 ? 'neg' : v > 0 ? 'pos' : ''}">${v > 0 ? '+' : ''}${Math.round(v * 100)}</b></div>`).join('');
      const key = stn.id + ':' + c;
      return `<details class="crating" data-rt="${key}" ${this.rtOpen.has(key) ? 'open' : ''}><summary>${cargoIcon(c)}<span>${this.cargoName(c)}</span><i class="rbar"><em style="width:${r}%"></em></i><b>${r} %</b>${tgt !== r ? `<small>${tgt > r ? '↑' : '↓'} ${tgt} %</small>` : ''}</summary><div class="kv-list">${f}</div></details>`;
    }).join('');
    return `<h4>${this.tr('rt_heading')}</h4>${rows}<p class="muted small">${this.tr('rt_help')}</p>`;
  },
  // train inspector: condition, servicing, replacement rule
  condBlock(t) {
    const g = this.game, M = g.maint;
    if (!M.on()) return '';
    const c = M.cond(t), base = M.baseCond(t);
    const at = M.serviceAt(t);
    const rule = M.rules.find((r) => r.from === t.model);
    const P = g.progression, cur = locoModel(t.model);
    const newer = LOCOS.filter((m) => m.id !== t.model && m.era >= cur.era && P.locoUnlocked(m) && m.role !== 'shunter');
    const state = t.broken > 0 ? `<span class="neg">${this.tr('st_broken_down', { s: Math.ceil(t.broken) })}</span>` : c < at ? `<span class="warnc">${this.tr('cond_due')}</span>` : `<span class="pos">${this.tr('cond_ok')}</span>`;
    return `<h4>${this.tr('cond_heading')}</h4>
      <div class="cond"><div class="cond-bar" role="meter" aria-valuenow="${Math.round(c * 100)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${Math.round(c * 100)}%"></i><b style="left:${Math.round(at * 100)}%" title="${this.tr('svc_at')}"></b></div>
        <small>${Math.round(c * 100)} % · ${this.tr('cond_max', { n: Math.round(base * 100) })} · ${state}${t.breakdowns ? ' · ' + this.tr('cond_breakdowns', { n: t.breakdowns }) : ''}</small></div>
      <div class="row wrap">
        <label class="tog small"><input type="checkbox" ${t.autoService !== false ? 'checked' : ''} data-change="svcAuto" data-id="${t.id}"/><i></i><small>${this.tr('svc_auto')}</small></label>
        <label class="set inline"><small>${this.tr('svc_at')}</small><select data-change="svcAt" data-id="${t.id}">${[0.5, 0.6, 0.7, 0.8, 0.9].map((v) => `<option value="${v}" ${Math.abs(v - at) < 0.01 ? 'selected' : ''}>${v * 100} %</option>`).join('')}</select></label>
      </div>
      <label class="set"><span>${this.tr('repl_rule', { model: esc(cur.name) })}</span><select data-change="replTo" data-id="${t.id}"><option value="">${this.tr('repl_none')}</option>${newer.map((m) => `<option value="${m.id}" ${rule && rule.to === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></label>
      ${rule ? `<p class="muted small">${this.tr('repl_desc', { from: esc(cur.name), to: esc(locoModel(rule.to).name), y: rule.ageY, c: Math.round(rule.cond * 100) })}</p>` : ''}
      <p class="muted small">${this.tr('rel_' + M.mode + '_desc')}</p>`;
  },
  financeActions() {
    const g = () => this.game;
    const re = () => this.refreshPanel();
    return {
      finTab: (a) => { this.finTab = a; re(); },
      finMetric: (a) => { this.finMetric = a; re(); },
      finFilter: (a) => { this.finFilter = a; re(); },
      finBorrow: () => { const r = g().ledger.borrow(LOAN_STEP); if (r.error) this.error(r.error); else { this.app.audio.play('coin'); this.toast(this.tr('fin_borrowed', { n: fmt(r.n) }), 'info', 'coin'); } re(); },
      finRepay: () => { const r = g().ledger.repay(LOAN_STEP); if (r.error) this.error(r.error); else { this.app.audio.play('click'); this.toast(this.tr('fin_repaid', { n: fmt(r.n) }), 'good', 'coin'); } re(); },
      finFocus: (a) => {
        const [type, id] = a.split(':');
        const G = g();
        if (type === 'train' && G.trains.byId(+id)) { this.closePanel(); G.select({ type: 'train', id: +id }); }
        else if (type === 'station' && G.stations.byId(+id)) { this.closePanel(); G.select({ type: 'station', id: +id }); }
        else if (type === 'depot') { const d = G.stations.depotById(+id); if (d) { this.closePanel(); G.camera.focus(((d.tile % 64) + 0.5) * 2, (Math.floor(d.tile / 64) + 0.5) * 2); } }
        else if (type === 'tile') { this.closePanel(); G.camera.focus(((+id % 64) + 0.5) * 2, (Math.floor(+id / 64) + 0.5) * 2); }
      },
    };
  },
};
