// The vehicle catalogue understands a description (Phase 13): a local,
// deterministic reading of everyday English and German into the catalogue's
// own filters — mode, duty, power type, era (a decade or a year), maker,
// cargo, "fast" / "cheap" / "big" (sort order), unlocked, owned. It only
// fills filters the player can see and change; words it does not know are
// reported, and when nothing is understood the text search stays as it was.
// Nothing leaves the device.
import { norm } from './ToolsUI.js';

// word stems (after norm) → what they set; German compounds are split by
// looking for these stems inside a word (Güterlok = güter + lok)
const LEX = [
  // modes
  [['locomotive', 'loco', 'engine', 'lokomotive', 'lok', 'train', 'zug', 'triebwagen', 'multiple unit', 'emu', 'dmu', 'railcar'], { mode: 'rail' }],
  [['wagon', 'waggon', 'wagen', 'coach'], { mode: 'wagon' }],
  [['bus', 'coach bus', 'omnibus', 'reisebus'], { mode: 'bus' }],
  [['truck', 'lorry', 'lkw', 'laster', 'lastwagen'], { mode: 'truck' }],
  [['tram', 'streetcar', 'strassenbahn', 'tramway'], { mode: 'tram' }],
  [['ship', 'boat', 'ferry', 'vessel', 'schiff', 'boot', 'faehre', 'fahre'], { mode: 'ship' }],
  [['plane', 'aircraft', 'airplane', 'jet', 'flugzeug', 'flieger'], { mode: 'air' }],
  // duties (rail)
  [['freight', 'goods', 'cargo', 'guter', 'gueter', 'fracht'], { role: 'duty_freight' }],
  [['heavy freight', 'heavy haul', 'schwerlast', 'schwergut'], { role: 'duty_heavy' }],
  [['passenger', 'passengers', 'personen', 'fahrgast', 'fahrgaste'], { cargo: 'PASSENGERS' }],
  [['regional', 'commuter', 'nahverkehr', 'pendler'], { role: 'duty_regional' }],
  [['local', 'lokal'], { role: 'duty_local' }],
  [['express', 'schnellzug', 'fernverkehr'], { role: 'duty_express' }],
  [['intercity'], { role: 'duty_intercity' }],
  [['shunter', 'shunting', 'rangier', 'rangierlok'], { role: 'duty_shunter' }],
  [['mountain', 'gebirge', 'berg'], { role: 'duty_mountain' }],
  [['metro', 'subway', 'u bahn', 'ubahn'], { role: 'duty_metro' }],
  // power
  [['steam', 'dampf'], { energy: 'steam' }],
  [['diesel'], { energy: 'diesel' }],
  [['electric', 'elektrisch', 'elektro', 'e lok', 'elok'], { energy: 'electric' }],
  [['high speed', 'highspeed', 'hochgeschwindigkeit', 'bullet'], { energy: 'hs' }],
  [['maglev', 'magnet', 'magnetschwebebahn'], { energy: 'maglev' }],
  // preferences (sort order)
  [['fast', 'quick', 'speedy', 'schnell', 'schnelle', 'flott'], { sort: 'speed' }],
  [['cheap', 'budget', 'inexpensive', 'affordable', 'gunstig', 'guenstig', 'billig', 'preiswert'], { sort: 'price' }],
  [['big', 'large', 'high capacity', 'capacity', 'gross', 'grosse', 'viel platz', 'kapazitat', 'kapazitaet'], { sort: 'cap' }],
  [['powerful', 'strong', 'stark', 'starke', 'kraftig', 'kraeftig'], { sort: 'power' }],
  // availability
  [['unlocked', 'available', 'buyable', 'verfugbar', 'verfuegbar', 'freigeschaltet', 'kaufbar'], { unlocked: true }],
  [['owned', 'mine', 'my', 'meine', 'eigene'], { owned: true }],
];
// words that carry no filter
const STOP = new Set(['a', 'an', 'the', 'from', 'of', 'by', 'for', 'with', 'in', 'and', 'or', 'made', 'built', 'era', 'years', 'year', 'ein', 'eine', 'einen', 'der', 'die', 'das', 'den', 'dem', 'des', 'aus', 'von', 'vom', 'mit', 'fur', 'fuer', 'und', 'oder', 'jahre', 'jahren', 'ab', 'im', 'zum', 'zur', 'baujahr', 'era', 'epoche']);
const WORDS_EN = { twenties: 1920, thirties: 1930, forties: 1940, fifties: 1950, sixties: 1960, seventies: 1970, eighties: 1980, nineties: 1990 };
const WORDS_DE = { zwanziger: 1920, dreissiger: 1930, vierziger: 1940, funfziger: 1950, fuenfziger: 1950, sechziger: 1960, siebziger: 1970, achtziger: 1980, neunziger: 1990 };

// "60s", "1960s", "sixties", "60er", "1960er", "60ern", "1990" → a year in the middle
export function decadeOf(w) {
  let m;
  if ((m = /^(\d{4})(s|er|ern)?$/.exec(w))) { const y = +m[1]; return y >= 1800 && y <= 2100 ? (m[2] ? y + 5 : y) : null; }
  if ((m = /^(\d{2})(s|er|ern)$/.exec(w))) { const d = +m[1]; return (d >= 20 ? 1900 : 2000) + d + 5; }
  if (WORDS_EN[w]) return WORDS_EN[w] + 5;
  const de = w.replace(/n$/, '');
  if (WORDS_DE[de]) return WORDS_DE[de] + 5;
  return null;
}

// lex: { makers: [{id, name}], cargo: [{id, names:[...]}], eraOfYear(y) }
export function parseCatalogQuery(text, lex) {
  const q = ` ${norm(text)} `;
  const out = { filters: {}, used: [], unknown: [], year: null };
  if (!q.trim()) return out;
  let rest = q;
  const take = (phrase) => { rest = rest.replace(new RegExp(`\\b${phrase}\\b`), ' '); };
  // makers and cargo first (proper names)
  for (const m of lex.makers || []) for (const nm of [norm(m.name), m.id, norm(m.name).split(' ')[0]]) {
    if (nm && nm.length >= 3 && new RegExp(`\\b${nm}\\b`).test(rest)) { out.filters.maker = m.id; out.used.push(['maker', m.name]); take(nm); break; }
  }
  for (const c of lex.cargo || []) for (const nm of c.names.map(norm)) {
    if (nm && nm.length >= 3 && new RegExp(`\\b${nm}\\b`).test(rest)) { out.filters.cargo = c.id; out.used.push(['cargo', c.id]); take(nm); break; }
  }
  // decades and years
  for (const w of rest.trim().split(' ')) {
    const y = decadeOf(w);
    if (y != null) { out.year = y; out.filters.era = lex.eraOfYear ? lex.eraOfYear(y) : null; out.used.push(['era', w]); take(w); break; }
  }
  // phrases, longest first, then stems inside compound words
  const entries = [];
  for (const [words, set] of LEX) for (const w of words) entries.push([w.trim(), set]);
  entries.sort((a, b) => b[0].length - a[0].length);
  for (const [w, set] of entries) {
    if (w.includes(' ') ? rest.includes(` ${w} `) : new RegExp(`\\b${w}\\b`).test(rest)) {
      for (const k in set) if (out.filters[k] == null) { out.filters[k] = set[k]; out.used.push([k, set[k]]); }
      take(w);
    }
  }
  // compounds: Güterlok, Regionalzug, Dampflok, Diesellok, Hochgeschwindigkeitszug …
  for (const word of rest.trim().split(' ').filter((x) => x.length >= 6)) {
    let hit = false;
    for (const [w, set] of entries) {
      if (w.includes(' ') || w.length < 3 || !word.includes(w)) continue;
      for (const k in set) if (out.filters[k] == null) { out.filters[k] = set[k]; out.used.push([k, set[k]]); hit = true; }
    }
    if (hit) take(word);
  }
  // an electric or steam loco means rail; a freight or passenger duty too
  if (!out.filters.mode && (out.filters.energy || (out.filters.role || '').startsWith('duty_'))) out.filters.mode = 'rail';
  out.unknown = rest.trim().split(' ').filter((w) => w && !STOP.has(w) && !/^\d+$/.test(w));
  return out;
}
// how sure: the share of the meaningful words understood
export function parseConfidence(p) {
  const n = p.used.length, u = p.unknown.length;
  return n === 0 ? 0 : n / (n + u);
}
