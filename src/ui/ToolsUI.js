// Tools (Phase 7): FIND – search the whole world (towns, stations, stops,
// industries, trains, road vehicles, lines) and jump there; BOOKMARKS –
// named camera spots kept with the save; SANDBOX – builder games only:
// money, all regions, level, weather, a town event, the authority rules.
import { fmt, escapeHtml as esc } from '../util.js';
import { icon } from './icons.js';
import { WEATHER_IDS } from '../world/Environment.js';
import { ERA_BANDS, bandOf } from '../world/Eras.js';
import { SEARCH_ALIASES } from './SearchAliases.js';
import { VISUAL_ERAS, visualBand } from '../world/VisualEra.js';
import { resolveTerrain } from '../world/Terrain.js';

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
  // Phase 11/12 systems (Phase 13): the kind shown is the fifth entry
  ['panel', 'plans', 'plans', 'menu_plans'], ['planmode', '1', 'plans', 'plan_mode', 'tool'],
  ['metro', '1', 'layers', 'find_cmd_metro', 'tool'], ['layerview', '', 'layers', 'find_cmd_underground', 'overlay'], ['metromap', '', 'map', 'find_cmd_metromap', 'panel'],
  ['trackmode', 'pair', 'track', 'find_cmd_pair', 'tool'], ['trackmode', 'role', 'track', 'find_cmd_roles', 'tool'],
  ['overlay', 'congestion', 'layers', 'ov_congestion'], ['tool', 'signal', 'signal', 'tool_signal'],
  ['panel', 'research', 'research', 'menu_research'], ['panel', 'settings', 'settings', 'menu_settings'],
];
// search normalisation (Phase 13): lower case, no accents (ß as ss), hyphens
// and punctuation as spaces; stems drop simple plural endings (EN/DE)
export const norm = (s) => String(s || '').toLowerCase().replace(/ß/g, 'ss').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[-_/.,:;!?()'"]+/g, ' ').replace(/\s+/g, ' ').trim();
export const stem = (w) => (w.length > 5 && /(en|es)$/.test(w) ? w.slice(0, -2) : w.length > 4 && /[sen]$/.test(w) ? w.slice(0, -1) : w);
// edit distance with a cap (typos: one for short words, two for long ones)
export function editDistance(a, b, cap = 2) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1] && i > 1 && j > 1) cur[j] = Math.min(cur[j], prev[j - 2] + 1);
      if (cur[j] < best) best = cur[j];
    }
    if (best > cap) return cap + 1;
    prev = cur;
  }
  return prev[b.length];
}
// how well a query matches an entry: exact name 100, name prefix 90, alias
// 85, alias prefix 75, every word found 60, every word's stem 55, every
// word within a typo or two 40, else 0
export function searchScore(q, name, aliases = [], extra = '') {
  const n = norm(name);
  if (!q) return 0;
  if (n === q) return 100;
  if (n.startsWith(q)) return 90;
  if (aliases.includes(q)) return 85;
  if (q.length >= 3 && aliases.some((a) => a.startsWith(q))) return 75;
  const hay = `${n} ${norm(extra)} ${aliases.join(' ')}`;
  const words = q.split(' ');
  if (words.every((w) => hay.includes(w))) return 60;
  const hw = hay.split(' ');
  const hs = hw.map(stem);
  if (words.every((w) => { const s = stem(w); return s.length >= 3 && hs.some((h) => h.startsWith(s) || (s.startsWith(h) && h.length >= 4)); })) return 55;
  if (words.every((w) => w.length >= 4 && hw.some((h) => h.length >= 4 && h[0] === w[0] && editDistance(w, h, w.length >= 8 ? 2 : 1) <= (w.length >= 8 ? 2 : 1)))) return 40;
  return 0;
}

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
    // commands with the everyday words of both languages (SearchAliases.js)
    for (const [act, arg, ic, key, kind] of COMMANDS) {
      const id = act + ':' + arg;
      const aliases = [...(SEARCH_ALIASES.en[id] || []), ...(SEARCH_ALIASES.de[id] || [])].map(norm);
      out.push({ kind: 'command', ic, name: this.tr(key), cmd: { act, arg }, extra: this.tr('find_kind_' + (kind || act)), aliases, key: norm(this.tr(key) + ' ' + key.replace(/_/g, ' ')) });
    }
    return out;
  },
  // Suggestions only: a result is never carried out by itself; the player
  // chooses it (and a building tool still needs the drag on the map).
  searchResults(q) {
    const k = norm(q);
    if (!k) return [];
    const scored = [];
    for (const r of this.searchIndex()) {
      const sc = searchScore(k, r.name, r.aliases || [], r.cmd ? r.key : r.extra);
      if (sc > 0) scored.push([sc, r]);
    }
    return scored.sort((a, b) => b[0] - a[0] || (a[1].kind === 'command' ? 1 : 0) - (b[1].kind === 'command' ? 1 : 0) || a[1].name.localeCompare(b[1].name)).slice(0, 30).map((x) => x[1]);
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
      ${this.searchQuery ? '' : `<div class="find-try" data-section="find-examples"><small class="muted">${this.tr('find_try')}</small> ${this.helpBtn('find')} ${this.tr('find_try_words').split('|').map((w) => `<button class="chip small" data-act="findTry" data-arg="${esc(w)}">${esc(w)}</button>`).join('')}</div>`}
      <div id="find-body" class="fin-list">${this.searchRows()}</div>
      <h3>${this.tr('bookmarks')}</h3>${marks || `<p class="muted small">${this.tr('bm_none')}</p>`}
      <div class="row wrap"><button class="btn small" data-act="bmAdd" ${B.length >= MAX_BOOKMARKS ? 'disabled' : ''}>${icon('plus', 'mini')} ${this.tr('bm_add')}</button></div>
      ${this.worldInfo()}
      ${g.difficultyId === 'builder' ? `<h3>${this.tr('sandbox')}</h3>${this.sandboxBlock()}` : ''}`;
  },
  // the world at a glance (Phase 12): the year and the style it builds in,
  // when the game began, the terrain, climate, seed and size
  worldInfo() {
    const g = this.game, y = g.ledger.year(), W = g.world;
    const T = resolveTerrain(W.terrain);
    const row = (k, v) => `<div><span>${this.tr(k)}</span><b data-wi="${k}">${v}</b></div>`;
    return `<h3>${this.tr('world_info')}</h3><div class="kv-list small" id="world-info">
      ${row('wi_year', y)}${row('wi_look', this.tr('vera_' + VISUAL_ERAS[visualBand(y)].id))}${row('wi_since', g.ledger.startYear)}
      ${row('wi_terrain', this.tr('terrain_' + T.preset))}${row('wi_climate', this.tr('tp_climate_' + T.climate))}
      ${row('wi_size', `${g.mapSize}×${g.mapSize}`)}${row('wi_seed', esc(String(W.seed)))}</div>
      <p class="muted small">${this.tr('wi_help')}</p>`;
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
      <label class="set tog"><span>${this.tr('sb_authority')}</span><input type="checkbox" data-change="sbAuthority" ${S.ignoreAuthority ? 'checked' : ''}/><i></i></label>
      <h4>${this.tr('sb_era')}</h4><p class="small">${this.tr('sb_era_now', { y: g.ledger.year(), look: this.tr('era_band_' + ERA_BANDS[bandOf(g.ledger.year())]) })}</p>
      <div class="row wrap">${[-25, -10, 10, 25].map((n) => `<button class="btn ghost small" data-act="sbYear" data-arg="${n}">${n > 0 ? '+' : ''}${n} ${this.tr('sb_years')}</button>`).join('')}</div>
      <p class="muted small">${this.tr('sb_era_help')}</p>
      <p class="small">${this.tr('sb_terrain', { t: this.tr('terrain_' + ((g.world.terrain && g.world.terrain.preset) || 'classic')) })}${g.world.terrain && Object.keys(g.world.terrain).length > 1 ? ' · ' + this.tr('sb_terrain_custom') : ''}</p>`;
  },

  toolsActions() {
    const g = () => this.game;
    const re = () => this.refreshPanel();
    return {
      // an example only fills the field (Phase 14 discovery): nothing is carried out
      findTry: (a) => { this.searchQuery = String(a).slice(0, 40); this.refreshPanel(); const q = document.getElementById('find-q'); if (q) q.focus(); },
      findCmd: (a) => {
        const [act, arg] = a.split(':'), G = g();
        this.closePanel();
        if (act === 'panel') this.openPanel(arg);
        else if (act === 'tool') { G.construction.setTool(arg); this.renderToolbar(); }
        else if (act === 'overlay') this.actions.overlay(arg);
        else if (act === 'backups') this.app.backupDialog();
        else if (act === 'photo') this.setPhoto(true);
        else if (act === 'metro') { G.construction.setTool('track'); G.construction.setLayer(+arg || 1); for (let k = 0; k < 3 && !G.layerView.showsUnderground(); k++) G.layerView.cycle(); this.renderToolbar(); }
        else if (act === 'layerview') { G.layerView.cycle(); this.renderToolbar(); }
        else if (act === 'metromap') { this.mapFilter = 'metro'; this.openPanel('map'); }
        else if (act === 'trackmode') { G.construction.setTool('track'); G.construction.trackMode = arg; this.renderToolbar(); }
        else if (act === 'planmode') { if (G.plans && !G.plans.on) G.plans.setOn(true); if (!['track', 'station', 'depot'].includes(G.construction.tool)) G.construction.setTool('track'); this.renderToolbar(); }
      },
      findGo: (a) => { const [type, id] = a.split(':'); const sel = { type, id: +id }; g().select(sel); g().focusOn(sel, 14); if (window.innerWidth < 760) this.closePanel(); },
      bmAdd: () => { const b = this.addBookmark(); if (b) this.toast(this.tr('bm_added', { name: b.name }), 'good', 'pin'); re(); },
      bmGo: (a) => { const b = (g().bookmarks || [])[+a]; if (b) { g().camera.focus(b.x, b.z, b.zoom); if (window.innerWidth < 760) this.closePanel(); } },
      bmDel: (a) => { const B = g().bookmarks || []; B.splice(+a, 1); re(); },
      sbYear: (a) => {
        const G = g(); if (G.difficultyId !== 'builder') return;
        const L = G.ledger, y0 = L.year(), b0 = bandOf(y0), e0 = L.era(y0);
        L.startYear = Math.max(1800, Math.min(2100, L.startYear + (+a | 0)));
        const y1 = L.year();
        if (bandOf(y1) !== b0) G.events.emit('eraBand', bandOf(y1));
        if (L.era(y1) !== e0) G.events.emit('eraChanged', L.era(y1));
        re();
      },
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
