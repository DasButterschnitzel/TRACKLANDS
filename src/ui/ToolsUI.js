// Tools (Phase 7): FIND – search the whole world (towns, stations, stops,
// industries, trains, road vehicles, lines) and jump there; BOOKMARKS –
// named camera spots kept with the save; SANDBOX – builder games only:
// money, all regions, level, weather, a town event, the authority rules.
import { fmt, escapeHtml as esc } from '../util.js';
import { icon } from './icons.js';
import { WEATHER_IDS } from '../world/Environment.js';

const MAX_BOOKMARKS = 12;
// commands FIND also offers (a command palette: Ctrl+K or F, then type)
const COMMANDS = [
  ['panel', 'company', 'company', 'menu_company'], ['panel', 'finance', 'coin', 'menu_finance'], ['panel', 'trains', 'trains', 'menu_trains'],
  ['panel', 'news', 'news', 'menu_news'], ['panel', 'lists', 'lists', 'menu_lists'], ['panel', 'research', 'research', 'menu_research'],
  ['panel', 'contracts', 'contracts', 'menu_contracts'], ['panel', 'objectives', 'objectives', 'menu_objectives'], ['panel', 'map', 'map', 'menu_map'],
  ['panel', 'collection', 'collection', 'menu_collection'], ['panel', 'handbook', 'handbook', 'handbook'], ['panel', 'settings', 'settings', 'settings'],
  ['tool', 'track', 'track', 'tool_track'], ['tool', 'station', 'station', 'tool_station'], ['tool', 'depot', 'depot', 'tool_depot'],
  ['tool', 'road', 'road', 'tool_road'], ['tool', 'roadstop', 'bus', 'tool_roadstop'], ['tool', 'line', 'route', 'tool_line'],
  ['tool', 'signal', 'signal', 'tool_signal'], ['tool', 'bulldoze', 'bulldoze', 'tool_bulldoze'], ['tool', 'industry', 'factory', 'tool_industry'],
  ['overlay', 'profit', 'stats', 'ov_profit'], ['overlay', 'traffic', 'layers', 'ov_traffic'], ['overlay', 'towns', 'town', 'ov_towns'], ['overlay', 'industry', 'factory', 'ov_industry'],
  ['backups', '', 'save', 'backups'], ['panel', 'changelog', 'news', 'whats_new'], ['photo', '', 'camera', 'photo_mode'],
];
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export const ToolsUIMixin = {
  // everything with a name, by kind
  searchIndex() {
    const g = this.game, out = [];
    const add = (kind, ic, name, sel, extra = '') => out.push({ kind, ic, name, sel, extra, key: norm(name + ' ' + extra) });
    for (const t of g.towns.list) if (g.progression.regionUnlocked(t.region)) add('town', 'town', t.name, { type: 'town', id: t.id }, fmt(t.pop));
    for (const s of g.stations.mine()) add('station', 'station', s.name, { type: 'station', id: s.id });
    for (const s of g.roads.stops) if (s.kind !== 'garage' || !s.owner) add('stop', s.kind === 'dock' ? 'dock' : s.kind === 'airport' ? 'airport' : 'bus', s.name, { type: 'roadstop', id: s.id }, s.owner ? (g.rivals.byId(s.owner) || {}).short || '' : '');
    for (const i of g.industries.list) if (g.progression.regionUnlocked(i.region)) add('industry', 'factory', g.industries.displayName(i), { type: 'industry', id: i.id });
    for (const t of g.trains.mine()) add('train', 'train', t.name, { type: 'train', id: t.id });
    for (const v of g.roads.vehicles) if (!v.owner) add('vehicle', 'bus', v.name, { type: 'roadveh', id: v.id });
    for (const l of g.roads.lines.list) add('line', 'route', l.name, { type: 'line', id: l.id });
    for (const [act, arg, ic, key] of COMMANDS) out.push({ kind: 'command', ic, name: this.tr(key), cmd: { act, arg }, extra: this.tr('find_kind_' + act), key: norm(this.tr(key) + ' ' + key.replace(/_/g, ' ')) });
    return out;
  },
  searchResults(q) {
    const k = norm(q).trim();
    if (!k) return [];
    const words = k.split(/\s+/);
    return this.searchIndex().filter((r) => words.every((w) => r.key.includes(w)))
      .sort((a, b) => (a.key.startsWith(k) ? 0 : 1) - (b.key.startsWith(k) ? 0 : 1) || (a.kind === 'command' ? 1 : 0) - (b.kind === 'command' ? 1 : 0) || a.name.localeCompare(b.name)).slice(0, 30);
  },
  searchRows() {
    const q = this.searchQuery || '';
    const res = this.searchResults(q);
    if (!q.trim()) return `<p class="muted small">${this.tr('find_hint')}</p>`;
    if (!res.length) return `<p class="muted">${this.tr('find_none', { q: esc(q) })}</p>`;
    return res.map((r) => r.cmd ? `<button class="fin-row find-row cmd" data-act="findCmd" data-arg="${r.cmd.act}:${r.cmd.arg}"><span>${icon(r.ic, 'mini')} ${esc(r.name)}</span><small>${esc(r.extra)}</small></button>` : `<button class="fin-row find-row" data-act="findGo" data-arg="${r.sel.type}:${r.sel.id}"><span>${icon(r.ic, 'mini')} ${esc(r.name)}</span><small>${this.tr('find_kind_' + r.kind)}${r.extra ? ' · ' + esc(r.extra) : ''}</small></button>`).join('');
  },
  pSearch() {
    const g = this.game, B = g.bookmarks || [];
    const marks = B.map((b, i) => `<div class="fin-row"><button class="tag link" data-act="bmGo" data-arg="${i}">${icon('pin', 'mini')} ${esc(b.name)}</button><button class="icon-btn small" data-act="bmDel" data-arg="${i}" aria-label="${this.tr('bm_delete', { name: esc(b.name) })}">${icon('close')}</button></div>`).join('');
    return `<input class="search" type="search" id="find-q" placeholder="${this.tr('find_placeholder')}" aria-label="${this.tr('find_placeholder')}" value="${esc(this.searchQuery || '')}" data-input="findQuery" autocomplete="off"/>
      <div id="find-body" class="fin-list">${this.searchRows()}</div>
      <h3>${this.tr('bookmarks')}</h3>${marks || `<p class="muted small">${this.tr('bm_none')}</p>`}
      <div class="row wrap"><button class="btn small" data-act="bmAdd" ${B.length >= MAX_BOOKMARKS ? 'disabled' : ''}>${icon('plus', 'mini')} ${this.tr('bm_add')}</button></div>
      ${g.difficultyId === 'builder' ? `<h3>${this.tr('sandbox')}</h3>${this.sandboxBlock()}` : ''}`;
  },
  // the camera spot as a bookmark (named after the nearest town)
  addBookmark(name = null) {
    const g = this.game, c = g.camera, B = g.bookmarks || (g.bookmarks = []);
    if (B.length >= MAX_BOOKMARKS) return null;
    const x = c.target.x, z = c.target.z;
    let best = null, bd = Infinity;
    for (const t of g.towns.list) { const d = Math.hypot((t.x + 0.5) * 2 - x, (t.z + 0.5) * 2 - z); if (d < bd) { bd = d; best = t; } }
    const b = { name: String(name || (best ? this.tr('bm_near', { town: best.name }) : this.tr('bookmark')) + ` ${B.length + 1}`).slice(0, 40), x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10, zoom: Math.round(c.zoomGoal || c.viewSize) };
    B.push(b);
    return b;
  },

  // ---------- sandbox (builder games) ----------
  sandboxBlock() {
    const g = this.game, S = g.sandbox || {};
    const btn = (act, arg, label, ic = 'plus') => `<button class="btn small" data-act="${act}" data-arg="${arg}">${icon(ic, 'mini')} ${this.tr(label)}</button>`;
    return `<p class="muted small">${this.tr('sandbox_help')}</p>
      <div class="row wrap">${btn('sbMoney', 1000000, 'sb_money')}${btn('sbRegions', 1, 'sb_regions', 'map')}${btn('sbLevel', 5, 'sb_level', 'up')}${btn('sbEvent', 1, 'sb_event', 'town')}</div>
      <label class="set"><span>${this.tr('sb_weather')}</span><select data-change="sbWeather">${WEATHER_IDS.map((w) => `<option value="${w}" ${g.env.weather === w ? 'selected' : ''}>${this.tr('wx_' + w)}</option>`).join('')}</select></label>
      <label class="set tog"><span>${this.tr('sb_authority')}</span><input type="checkbox" data-change="sbAuthority" ${S.ignoreAuthority ? 'checked' : ''}/><i></i></label>`;
  },

  toolsActions() {
    const g = () => this.game;
    const re = () => this.refreshPanel();
    return {
      findCmd: (a) => {
        const [act, arg] = a.split(':'), G = g();
        this.closePanel();
        if (act === 'panel') this.openPanel(arg);
        else if (act === 'tool') { G.construction.setTool(arg); this.renderToolbar(); }
        else if (act === 'overlay') this.actions.overlay(arg);
        else if (act === 'backups') this.app.backupDialog();
        else if (act === 'photo') this.setPhoto(true);
      },
      findGo: (a) => { const [type, id] = a.split(':'); const sel = { type, id: +id }; g().select(sel); g().focusOn(sel, 14); if (window.innerWidth < 760) this.closePanel(); },
      bmAdd: () => { const b = this.addBookmark(); if (b) this.toast(this.tr('bm_added', { name: b.name }), 'good', 'pin'); re(); },
      bmGo: (a) => { const b = (g().bookmarks || [])[+a]; if (b) { g().camera.focus(b.x, b.z, b.zoom); if (window.innerWidth < 760) this.closePanel(); } },
      bmDel: (a) => { const B = g().bookmarks || []; B.splice(+a, 1); re(); },
      sbMoney: (a) => { if (g().difficultyId !== 'builder') return; g().economy.earn(+a, 'grant', false, null, '~sandbox'); re(); },
      sbRegions: () => { const G = g(); if (G.difficultyId !== 'builder') return; const C = G.world.centers || []; let last = -1; for (let i = 0; i < C.length; i++) if (C[i] && !G.progression.regions.has(i)) { G.progression.regions.add(i); G.world.view.revealRegion(i); last = i; } if (last >= 0) G.events.emit('regionUnlocked', last); re(); },
      sbLevel: (a) => { const P = g().progression; if (g().difficultyId !== 'builder') return; P.level = Math.min(50, P.level + (+a)); g().events.emit('levelUp', P.level); re(); },
      sbEvent: () => { const G = g(); if (G.difficultyId !== 'builder') return; const t = G.towns.list.filter((x) => G.progression.regionUnlocked(x.region)).sort((a, b) => b.pop - a.pop)[0]; if (t) { G.urban.events.push({ id: 900000 + G.urban.events.length, kind: 'festival', town: t.id, start: G.time + 1, end: G.time + 61 }); this.toast(this.tr('sb_event_on', { town: t.name }), 'good', 'town'); } re(); },
    };
  },
  toolsInputs() {
    return {
      findQuery: (el) => { this.searchQuery = el.value.slice(0, 40); const b = document.getElementById('find-body'); if (b) b.innerHTML = this.searchRows(); },
      sbWeather: (el) => { const E = this.game.env; if (this.game.difficultyId !== 'builder' || !WEATHER_IDS.includes(el.value)) return; E.weather = E.weatherTarget = el.value; E.nextWeather = 90; this.game.events.emit('weather', el.value); },
      sbAuthority: (el) => { const G = this.game; if (G.difficultyId !== 'builder') return; G.sandbox = { ...(G.sandbox || {}), ignoreAuthority: !!el.checked }; },
    };
  },
};
