// Content packs (Phase 8): the creator adds road vehicles (buses, trucks,
// trams, ships, aircraft) and scenarios as JSON files, without touching the
// code. assets/packs/index.json lists the pack files:
//   { "packs": ["my-pack.json"] }
// A pack:
//   { "id": "my_pack", "name": "My pack", "version": "1.0",
//     "vehicles": [ { "id": "blue_bus", "name": "Blue Bus 40", "kind": "bus", "cap": 40, "speed": 60,
//                     "price": 1200, "op": 12, "level": 3, "color": "#2f6bd0", "shape": "urban" } ],
//     "scenarios": [ { … the scenario editor's format … } ] }
// Every entry is checked against the schema below; an entry with a problem is
// left out and the problem is listed in Settings → Content packs (nothing is
// half-loaded). Pack vehicles get the id "<pack>.<id>", so they can never
// replace a built-in one. Saves that use a pack vehicle keep working while
// the pack is installed; without it those vehicles are dropped on load.
import { ROAD_VEHICLES, CARGO, SOUND_PROFILES, SOUND_KIND } from '../config.js';
import { BUS_SHAPES } from '../road/RoadModels.js';
import { cleanScenario } from '../world/Scenarios.js';

const BASE = 'assets/packs/';
const KINDS = ['bus', 'truck', 'tram', 'dock', 'airport'];
const GROUPS = [...new Set(Object.values(CARGO).map((c) => c.group))];
const ID = /^[a-z0-9_]{1,32}$/;

// the schema: field → [type, check, required]
const num = (lo, hi) => (v) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const VEHICLE_SCHEMA = {
  id: ['string', (v) => ID.test(v), true],
  name: ['string', (v) => v.length >= 1 && v.length <= 40, true],
  kind: ['string', (v) => KINDS.includes(v), true],
  cap: ['number', num(1, 1000), true],
  speed: ['number', num(5, 1200), true],
  price: ['number', num(1, 1e7), true],
  op: ['number', num(0, 1e5), true],
  level: ['number', num(1, 50), false],
  color: ['string', (v) => /^#[0-9a-f]{6}$/i.test(v), false],
  shape: ['string', (v) => !!BUS_SHAPES[v], false],
  groups: ['object', (v) => Array.isArray(v) && v.length > 0 && v.every((x) => GROUPS.includes(x)), false],
  mail: ['number', num(0, 500), false],
  comfort: ['number', num(0.5, 2), false],
  minAirport: ['number', num(1, 3), false],
  minPort: ['number', num(1, 3), false],
  // how it sounds (Phase 13): one of SOUND_PROFILES, matching its kind
  soundProfile: ['string', (v) => SOUND_PROFILES.includes(v), false],
};

// problems with one vehicle entry (empty: fine)
export function vehicleErrors(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return ['not_object'];
  const out = [];
  for (const [k, [type, ok, req]] of Object.entries(VEHICLE_SCHEMA)) {
    if (v[k] === undefined) { if (req) out.push('missing:' + k); continue; }
    if (typeof v[k] !== type || !ok(v[k])) out.push('bad:' + k);
  }
  for (const k of Object.keys(v)) if (!VEHICLE_SCHEMA[k]) out.push('unknown:' + k);
  // passengers or cargo: a bus/tram/ferry/airliner carries people; trucks need cargo groups
  if (v.kind === 'truck' && !v.groups) out.push('missing:groups');
  if (typeof v.soundProfile === 'string' && SOUND_PROFILES.includes(v.soundProfile) && SOUND_KIND[v.soundProfile] !== v.kind) out.push('bad:soundProfile_kind');
  return out;
}

// a checked vehicle as the game uses it
function toModel(pack, v) {
  const m = {
    id: `${pack}.${v.id}`, name: v.name, kind: v.kind, cap: v.cap, speed: v.speed, price: v.price, op: v.op,
    level: v.level || 1, color: v.color ? parseInt(v.color.slice(1), 16) : 0xd8d8d8, pack,
  };
  if (v.groups) m.groups = v.groups.slice(); else { m.pax = true; m.mail = v.mail || 0; }
  if (v.kind === 'bus') { m.shape = v.shape || 'classic'; m.doors = 2; m.role = 'city'; m.era = 3; m.board = 1; m.accel = 1; m.rel = 0.9; m.life = 16; }
  if (v.comfort) m.comfort = v.comfort;
  if (v.minAirport) m.minAirport = v.minAirport;
  if (v.minPort) m.minPort = v.minPort;
  if (v.soundProfile) m.soundProfile = v.soundProfile;
  return m;
}

// check a pack; returns { id, name, version, vehicles: [models], scenarios: [...], errors: [{ where, what }] }
export function checkPack(d, file = '') {
  const res = { id: '', name: '', version: '', file, vehicles: [], scenarios: [], errors: [] };
  if (!d || typeof d !== 'object') { res.errors.push({ where: file, what: 'not_object' }); return res; }
  if (typeof d.id !== 'string' || !ID.test(d.id)) { res.errors.push({ where: file, what: 'bad:id' }); return res; }
  res.id = d.id; res.name = typeof d.name === 'string' ? d.name.slice(0, 48) : d.id; res.version = typeof d.version === 'string' ? d.version.slice(0, 16) : '';
  const seen = new Set();
  (Array.isArray(d.vehicles) ? d.vehicles : []).slice(0, 200).forEach((v, i) => {
    const errs = vehicleErrors(v);
    if (!errs.length && seen.has(v.id)) errs.push('duplicate:id');
    if (errs.length) { res.errors.push({ where: `vehicles[${i}]${v && v.id ? ' ' + v.id : ''}`, what: errs.join(', ') }); return; }
    seen.add(v.id);
    res.vehicles.push(toModel(d.id, v));
  });
  (Array.isArray(d.scenarios) ? d.scenarios : []).slice(0, 50).forEach((s, i) => {
    const sc = cleanScenario(s);
    if (!sc) { res.errors.push({ where: `scenarios[${i}]`, what: 'bad:scenario' }); return; }
    sc.id = `${d.id}_${String(s.id || i).replace(/[^\w-]/g, '').slice(0, 20) || i}`; sc.pack = d.id;
    res.scenarios.push(sc);
  });
  return res;
}

// what is loaded (for Settings, the scenario list and tests)
export const PACKS = { list: [], loaded: false };

// add checked vehicles to the game's list (a pack id is only added once)
export function installPack(p) {
  if (PACKS.list.some((x) => x.id === p.id)) return false;
  for (const m of p.vehicles) if (!ROAD_VEHICLES.some((x) => x.id === m.id)) ROAD_VEHICLES.push(m);
  PACKS.list.push(p);
  return true;
}

export async function loadPacks() {
  PACKS.loaded = true;
  let idx = null;
  try { const r = await fetch(BASE + 'index.json', { cache: 'no-cache' }); if (r.ok) idx = await r.json(); } catch (e) { idx = null; }
  const files = idx && Array.isArray(idx.packs) ? idx.packs.filter((f) => typeof f === 'string' && /^[\w\-.]+\.json$/.test(f)).slice(0, 20) : [];
  for (const f of files) {
    let d = null;
    try { const r = await fetch(BASE + f, { cache: 'no-cache' }); d = r.ok ? await r.json() : null; } catch (e) { d = null; }
    const p = checkPack(d, f);
    if (p.id) installPack(p); else PACKS.list.push(p);
  }
  return PACKS.list;
}
