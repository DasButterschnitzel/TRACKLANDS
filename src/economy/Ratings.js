// Station cargo ratings (0–100 %) per station and cargo, from visible
// factors: how recently a train picked the cargo up, how fast that train is,
// how much cargo is left waiting, the station's facilities, congestion and
// the condition of the trains. The rating decides how much of an industry's
// output a station gets (competing stations split it by rating) and how much
// a poorly served station loses. The station panel lists every factor.
// Also here: delivery-time payment (time-sensitive cargo pays less when it
// travels much longer than the distance needs).
import { CARGO } from '../config.js';
import { MONTH_S } from './Ledger.js';

const START = 0.6;
// how strongly delivery time matters: grace (× expected time), slope, floor
const TIME = {
  pax: { grace: 1.6, slope: 0.22, min: 0.55, bonus: 0.08 },
  mail: { grace: 1.4, slope: 0.25, min: 0.5, bonus: 0.1 },
  crate: { grace: 1.8, slope: 0.15, min: 0.65, bonus: 0.04 },   // food, goods
  default: { grace: 2.2, slope: 0.08, min: 0.8, bonus: 0 },      // bulk, logs, liquids
};

export class CargoRatings {
  constructor(game) { this.game = game; this.t = 0; }

  entry(stn, c) {
    if (!stn.ratings) stn.ratings = {};
    let e = stn.ratings[c];
    if (!e) e = stn.ratings[c] = { r: START, pick: null, speed: 0, cond: 1 };
    return e;
  }
  rating(stn, c) { const e = stn.ratings && stn.ratings[c]; return e ? e.r : START; }

  // the factors behind the target rating (shown in the station panel)
  factors(stn, c) {
    const g = this.game, e = this.entry(stn, c);
    const out = [['rt_base', 0.2]];
    const since = e.pick == null ? Infinity : (g.time - e.pick) / MONTH_S;
    out.push(['rt_pickup', since < 0.5 ? 0.25 : since < 1 ? 0.18 : since < 2 ? 0.1 : since < 4 ? 0.04 : 0]);
    out.push(['rt_speed', Math.max(0, Math.min(0.17, (e.speed - 40) / 300))]);
    const w = stn.stock[c] || 0;
    out.push(['rt_waiting', w < 50 ? 0.12 : w < 150 ? 0.06 : w < 400 ? 0 : w < 800 ? -0.06 : -0.12]);
    out.push(['rt_facilities', Math.min(0.1, 0.02 * (stn.level | 0) + 0.02 * ((stn.facilities || []).length))]);
    if (stn.stats && stn.stats.waitEma > 0.4) out.push(['rt_congestion', -0.07]);
    if (e.cond < 0.6) out.push(['rt_worn', -0.05]);
    return out;
  }
  target(stn, c) { return Math.max(0, Math.min(1, this.factors(stn, c).reduce((a, [, v]) => a + v, 0))); }

  // a train loaded this cargo here
  onPickup(stn, c, train) {
    const e = this.entry(stn, c);
    e.pick = this.game.time;
    e.speed = train ? Math.round(train._st.speed) : e.speed;
    e.cond = train && this.game.maint ? this.game.maint.cond(train) : 1;
  }

  tick(dt) {
    this.t += dt;
    if (this.t < 1) return;
    const step = this.t; this.t = 0;
    const k = Math.min(1, step / 25);   // ratings move over ~half a month
    for (const stn of this.game.roads ? this.game.stations.list.concat(this.game.roads.stops) : this.game.stations.list) {
      if (!stn.ratings) continue;
      for (const c in stn.ratings) { const e = stn.ratings[c]; e.r += (this.target(stn, c) - e.r) * k; }
    }
  }

  // how an amount offered to competing stations is split; each station gets
  // its share × (0.55 + 0.6 × rating, at most 1) (a well served station gets it all)
  split(sts, c, amt) {
    if (sts.length === 1) { const r = this.rating(sts[0], c); this.entry(sts[0], c); return [Math.floor(amt * Math.min(1, 0.55 + 0.6 * r))]; }
    const rs = sts.map((s) => { this.entry(s, c); return Math.max(0.05, this.rating(s, c)); });
    const sum = rs.reduce((a, b) => a + b, 0);
    return rs.map((r) => Math.floor(amt * (r / sum) * Math.min(1, 0.55 + 0.6 * r)));
  }

  // ---------- delivery time ----------
  timeFactor(c, dist, transit) {
    if (!(transit > 0) || !(dist > 0)) return 1;
    const grp = c === 'PASSENGERS' ? 'pax' : c === 'MAIL' ? 'mail' : CARGO[c] && CARGO[c].group === 'crate' ? 'crate' : 'default';
    const T = TIME[grp];
    const expected = 6 + dist * 2.2;          // seconds a steady 60 km/h train needs
    const ratio = transit / expected;
    if (ratio < 0.7) return 1 + T.bonus;       // express delivery
    if (ratio <= T.grace) return 1;
    return Math.max(T.min, 1 - (ratio - T.grace) * T.slope);
  }

  serialize(stn) {
    if (!stn.ratings) return undefined;
    const o = {};
    for (const c in stn.ratings) { const e = stn.ratings[c]; o[c] = { r: Math.round(e.r * 1000) / 1000, pick: e.pick == null ? null : Math.round(e.pick), speed: e.speed | 0, cond: Math.round(e.cond * 100) / 100 }; }
    return o;
  }
  deserialize(stn, d) {
    if (!d || typeof d !== 'object') return;
    stn.ratings = {};
    for (const c in d) {
      if (!CARGO[c]) continue;
      const e = d[c];
      if (!e || typeof e !== 'object') continue;
      stn.ratings[c] = { r: Math.max(0, Math.min(1, +e.r || START)), pick: Number.isFinite(e.pick) ? e.pick : null, speed: Math.max(0, Math.min(600, e.speed | 0)), cond: Math.max(0, Math.min(1, Number.isFinite(e.cond) ? e.cond : 1)) };
    }
  }
}
