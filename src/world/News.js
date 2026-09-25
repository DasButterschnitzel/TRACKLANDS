// The company newspaper: short dated items about what happens in the world,
// collected from game events. Each item has a kind (towns, industry, economy,
// company, weather), an i18n key with parameters (names are stored as text,
// so an item stays readable after its object is gone) and optionally the
// object it is about, so the news panel can show it on the map.
// Saved with the game (the last MAX items); 'unread' counts items since the
// panel was last opened.
import { REGIONS } from '../config.js';

const MAX = 80;
export const NEWS_KINDS = ['towns', 'industry', 'economy', 'company', 'weather'];

export class News {
  constructor(game) {
    this.game = game;
    this.items = [];
    this.seq = 1;
    this.unread = 0;
    this.firsts = new Set();     // 'town:<id>', 'cargo:<C>': first arrivals already reported
    this.best = 0;               // best monthly profit so far
    this.mute = true;            // quiet while the game is being set up (Game unmutes)
    this.wire(game.events);
  }

  add(kind, key, p = {}, ref = null) {
    if (this.mute) return null;
    const it = { id: this.seq++, t: this.game.time, kind, key, p, ref };
    this.items.push(it);
    if (this.items.length > MAX) this.items.splice(0, this.items.length - MAX);
    this.unread++;
    this.game.events.emit('news', it);
    return it;
  }

  wire(E) {
    const g = this.game;
    const tname = (t) => t.name;
    E.on('townLevel', (t) => this.add('towns', 'news_town_stage', { town: tname(t), stage: 'stage_' + g.towns.stageName(t) }, { type: 'town', id: t.id }));
    E.on('industryLevel', (ind) => this.add('industry', 'news_ind_level', { name: g.industries.displayName(ind), level: 'ilvl_' + ind.level }, { type: 'industry', id: ind.id }));
    E.on('industryFounded', (ind) => this.add('industry', 'news_ind_founded', { name: g.industries.displayName(ind) }, { type: 'industry', id: ind.id }));
    E.on('eventStart', (ev) => this.add('economy', 'news_event', { ev: 'ev_' + ev.id }));
    E.on('econCycle', (st) => this.add('economy', 'news_cycle_' + st, {}));
    E.on('regionUnlocked', (r) => this.add('company', 'news_region', { region: 'region_' + (REGIONS[r] ? REGIONS[r].id : r) }));
    E.on('stationBuilt', (s) => this.add('company', 'news_station', { name: s.name }, { type: 'station', id: s.id }));
    E.on('trainBrokeDown', (t) => this.add('company', 'news_breakdown', { name: t.name }, { type: 'train', id: t.id }));
    E.on('rivalLine', (r, a, b) => this.add('economy', 'news_rival_line', { rival: r.name, a: a.name, b: b.name }));
    E.on('weather', (w) => { if (w === 'storm' || w === 'snow') this.add('weather', 'news_weather_' + w, {}); });
    E.on('delivery', (d) => {
      if (d.town && !this.firsts.has('town:' + d.town.id)) {
        this.firsts.add('town:' + d.town.id);
        this.add('towns', 'news_first_train', { town: d.town.name, cargo: d.cargo }, { type: 'town', id: d.town.id });
      }
      if (!this.firsts.has('cargo:' + d.cargo)) {
        this.firsts.add('cargo:' + d.cargo);
        if (d.cargo !== 'PASSENGERS') this.add('company', 'news_first_cargo', { cargo: d.cargo, name: d.station ? d.station.name : '' }, d.station ? { type: 'station', id: d.station.id } : null);
      }
    });
    E.on('monthClosed', (c) => {
      const L = g.ledger, p = L.profitOf(c).profit;
      if (p > this.best && p > 500 && L.months.length > 1) this.add('company', 'news_record', { n: Math.round(p) });
      this.best = Math.max(this.best, p);
    });
  }

  // a save from before the newspaper: what is already served is not news
  seedFromWorld() {
    const g = this.game;
    for (const s of [...g.stations.list, ...(g.roads ? g.roads.stops : [])]) {
      if (!((s.delivered || 0) + (s.picked || 0) > 0)) continue;
      for (const id of (s.links && s.links.towns) || []) this.firsts.add('town:' + id);
    }
    for (const c of Object.keys(g.stats.data.cargo || {})) this.firsts.add('cargo:' + c);
    for (const m of g.ledger.months) this.best = Math.max(this.best, g.ledger.profitOf(m).profit);
  }

  serialize() {
    return { items: this.items.slice(-MAX), seq: this.seq, unread: Math.min(this.unread, MAX), firsts: [...this.firsts].slice(0, 500), best: Math.round(this.best) };
  }
  deserialize(d) {
    if (!d || typeof d !== 'object') return;
    const safeP = (p) => { const r = {}; if (p && typeof p === 'object') for (const [k, v] of Object.entries(p)) if (typeof v === 'string') r[k] = v.slice(0, 60); else if (typeof v === 'number' && isFinite(v)) r[k] = v; return r; };
    this.items = (Array.isArray(d.items) ? d.items : []).filter((it) => it && typeof it.key === 'string' && NEWS_KINDS.includes(it.kind)).slice(-MAX)
      .map((it) => ({ id: it.id | 0, t: +it.t || 0, kind: it.kind, key: it.key.slice(0, 40), p: safeP(it.p), ref: it.ref && typeof it.ref.type === 'string' && isFinite(it.ref.id) ? { type: it.ref.type, id: +it.ref.id } : null }));
    this.seq = Math.max(d.seq | 0, 1, ...this.items.map((it) => it.id + 1));
    this.unread = Math.max(0, Math.min(MAX, d.unread | 0));
    this.firsts = new Set((Array.isArray(d.firsts) ? d.firsts : []).filter((x) => typeof x === 'string').slice(0, 500));
    this.best = Math.max(0, +d.best || 0);
  }
}
