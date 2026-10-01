// Manufacturers (Phase 8): every vehicle belongs to a fictional maker, and
// within a maker's family its models form generations by era (I, II, III …).
// The catalogue shows the maker and generation, and filters by maker.
// All names are invented for TRACKLANDS.
export const MAKERS = [
  { id: 'hollin', name: 'Hollin & Ruck', since: 1880, focus: 'steam' },
  { id: 'ardent', name: 'Ardent Works', since: 1895, focus: 'heavy steam' },
  { id: 'northvale', name: 'Northvale Motive', since: 1932, focus: 'diesel' },
  { id: 'voltaris', name: 'Voltaris', since: 1928, focus: 'electric' },
  { id: 'aurora', name: 'Aurora Rail Systems', since: 1964, focus: 'high speed' },
  { id: 'magnor', name: 'Magnor Levitation', since: 2005, focus: 'maglev' },
  { id: 'wagonbau', name: 'Kessler Wagonbau', since: 1890, focus: 'wagons' },
  { id: 'citymotor', name: 'Citymotor', since: 1925, focus: 'buses' },
  { id: 'haulway', name: 'Haulway Trucks', since: 1930, focus: 'trucks' },
  { id: 'lumen', name: 'Lumen Tramworks', since: 1900, focus: 'trams' },
  { id: 'baywater', name: 'Baywater Yards', since: 1905, focus: 'ships' },
  { id: 'skyhaven', name: 'Skyhaven Aero', since: 1935, focus: 'aircraft' },
];
const BY_ID = Object.fromEntries(MAKERS.map((m) => [m.id, m]));

// the maker of a catalogue item (type L, W or R with its model)
export function makerOf(it) {
  if (it.type === 'W') return BY_ID.wagonbau;
  if (it.type === 'R') {
    const m = it.m, k = m.kind;
    return BY_ID[k === 'bus' ? 'citymotor' : k === 'truck' ? 'haulway' : k === 'tram' ? 'lumen' : k === 'dock' ? 'baywater' : k === 'airport' ? 'skyhaven' : 'citymotor'];
  }
  const m = it.m;
  const k = m.kind;
  return BY_ID[k === 'steam' ? 'hollin' : k === 'steam2' ? 'ardent' : k === 'diesel' ? 'northvale' : k === 'electric' ? 'voltaris' : k === 'hst' ? 'aurora' : k === 'maglev' ? 'magnor' : 'northvale'];
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
// generations: a maker's models grouped by era, numbered in order
export function generations(items) {
  const eras = new Map();
  for (const it of items) {
    const mk = makerOf(it);
    if (!mk) continue;
    const set = eras.get(mk.id) || new Set();
    set.add(it.era || 0);
    eras.set(mk.id, set);
  }
  const rank = new Map();
  for (const [id, set] of eras) { const list = [...set].sort((a, b) => a - b); rank.set(id, new Map(list.map((e, i) => [e, ROMAN[i] || String(i + 1)]))); }
  return (it) => { const mk = makerOf(it); return mk && rank.has(mk.id) ? rank.get(mk.id).get(it.era || 0) : ''; };
}
