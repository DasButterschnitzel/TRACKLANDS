// Investing in industries: the investment block in the industry panel (the
// site's value, the company's stake, dividends, buying and selling quarters,
// funding an expansion), the portfolio tab of the finance panel and the
// actions for the "fund a new industry" tool.
import { fmt, escapeHtml as esc } from '../util.js';
import { icon } from './icons.js';
import { INDUSTRY_INVEST } from '../config.js';

export const IndustryUIMixin = {
  investBlock(ind) {
    const g = this.game, I = g.industries;
    const stake = ind.stake || 0;
    const q = Math.round(stake * 4);
    const pips = [0, 1, 2, 3].map((k) => `<i class="${k < q ? 'on' : ''}"></i>`).join('');
    const buyErr = I.buyStakeError(ind), expErr = I.expandError(ind);
    const cell = (label, v) => `<div><small>${this.tr(label)}</small><b>${v}</b></div>`;
    const next = ind.level < 4 ? this.tr('ilvl_' + (ind.level + 1)) : '';
    return `<h4>${this.tr('inv_heading')} ${this.helpBtn('tycoon')}</h4>
      <div class="stake" role="img" aria-label="${this.tr('inv_stake_aria', { n: Math.round(stake * 100) })}"><span class="pips">${pips}</span><b>${this.tr('inv_stake', { n: Math.round(stake * 100) })}</b>${stake >= 0.5 ? `<span class="pill good">${this.tr('inv_majority')}</span>` : ''}</div>
      <div class="fin-mini">${cell('inv_value', fmt(I.value(ind)) + ' ●')}${cell('inv_output', fmt(ind.lastPv || 0) + ' ●')}${cell('inv_dividend', fmt(I.dividendEstimate(ind)) + ' ●')}${cell('inv_dividend_next', fmt(I.dividendEstimate(ind, Math.min(1, stake + INDUSTRY_INVEST.step))) + ' ●')}</div>
      <div class="row wrap">
        <button class="btn" data-act="indBuy" data-arg="${ind.id}" ${buyErr ? `disabled data-tip="${this.tr(buyErr)}"` : ''}>${icon('coin', 'mini')} ${this.tr('inv_buy', { n: fmt(I.stakeCost(ind)) })}</button>
        <button class="btn ghost" data-act="indSell" data-arg="${ind.id}" ${stake > 0 ? '' : 'disabled'}>${this.tr('inv_sell', { n: fmt(I.stakeSale(ind)) })}</button>
      </div>
      ${ind.level < 4 ? `<button class="btn wide" data-act="indExpand" data-arg="${ind.id}" ${expErr ? `disabled data-tip="${this.tr(expErr)}"` : ''}>${icon('up', 'mini')} ${this.tr('inv_expand', { name: next, n: fmt(I.expandCost(ind)) })}</button>` : ''}
      <p class="muted small">${this.tr('inv_help', { m: Math.round(INDUSTRY_INVEST.margin * 100), b: Math.round(INDUSTRY_INVEST.ownerBonus * 100) })}</p>
      ${ind.fin ? this.finBlock(ind) : ''}`;
  },

  // finance panel tab: every stake the company holds
  finInvest() {
    const g = this.game, I = g.industries;
    const own = I.owned();
    const rows = own.map((ind) => {
      const f = g.ledger.objFin(ind);
      return `<button class="fin-row" data-act="finFocus" data-arg="industry:${ind.id}"><span>${icon('factory', 'mini')} ${esc(I.displayName(ind))}</span><small>${Math.round(ind.stake * 100)} % · ${this.tr('fin_last_month')} ${this.money(f.lastRev, true)}</small><b>${fmt(Math.round(ind.stake * I.value(ind)))} ●</b></button>`;
    }).join('');
    const total = Math.round(I.stakeValue());
    return `<div class="fin-mini"><div><small>${this.tr('fin_v_shares')}</small><b>${fmt(total)} ●</b></div><div><small>${this.tr('inv_count')}</small><b>${own.length}</b></div></div>
      <div class="fin-list">${rows || `<p class="muted">${this.tr('inv_none')}</p>`}</div>
      <p class="muted small">${this.tr('inv_tab_note')}</p>`;
  },

  industryActions() {
    const g = () => this.game;
    const re = () => this.renderInspector();
    return {
      indBuy: (a) => { const ind = g().industries.byId(+a); const r = g().industries.buyStake(ind); if (r.error) this.error(r.error); else { this.app.audio.play('purchase'); this.toast(this.tr('inv_bought', { name: g().industries.displayName(ind), n: Math.round(ind.stake * 100) }), 'good', 'coin'); } re(); },
      indSell: (a) => { const ind = g().industries.byId(+a); const r = g().industries.sellStake(ind); if (r.error) this.error(r.error); else { this.app.audio.play('coin'); this.toast(this.tr('inv_sold', { n: fmt(r.got) }), 'info', 'coin'); } re(); },
      indExpand: (a) => { const ind = g().industries.byId(+a); const r = g().industries.expand(ind); if (r.error) this.error(r.error); else { this.app.audio.play('industryUp'); this.toast(this.tr('inv_expanded', { name: g().industries.displayName(ind), level: this.tr('ilvl_' + r.level) }), 'good', 'factory'); } re(); },
      fundType: (a) => { g().construction.fundType = a; this.renderToolbar(); g().construction.hover(g().construction.hoverTile); },
    };
  },
};
