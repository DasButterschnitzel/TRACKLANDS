// The history of the world (Phase 10): when each town was founded, when it
// grew a stage, raised a landmark or got its first station; the company's
// milestones (first station and train, network sizes, new regions, the first
// renovation and listed station); and the architectural eras as they turn.
// Kept with the save; a few entries per town, never a log of everything.
import { hashStr } from '../util.js';
import { bandOf, ERA_BANDS } from './Eras.js';

const MAX_TOWN = 16, MAX_CO = 40;
const COUNTS = { stations: [10, 25, 50, 100], trains: [10, 25, 50, 100, 200] };

export class History {
  constructor(game) {
    this.game = game;
    this.towns = {};      // town id -> [[year, kind, arg]]
    this.company = [];    // [[year, kind, arg]]
    const E = game.events, y = () => game.ledger.year();
    const town = (t, kind, arg) => { const L = this.towns[t.id] || (this.towns[t.id] = []); L.push([y(), kind, arg]); if (L.length > MAX_TOWN) L.splice(1, 1); };
    const co = (kind, arg) => { if (kind.startsWith('first_') && this.company.some((e) => e[1] === kind)) return; this.company.push([y(), kind, arg]); if (this.company.length > MAX_CO) this.company.shift(); };
    E.on('townLevel', (t) => town(t, 'stage', t.stage));
    E.on('townLandmark', (t, arch) => town(t, 'landmark', arch));
    E.on('stationBuilt', (s) => {
      if (s.owner) return;
      const n = game.stations.mine().length;
      co('first_station', s.name);
      if (COUNTS.stations.includes(n)) co('stations', n);
      for (const id of (s.links && s.links.towns) || []) {
        const t = game.towns.byId(id);
        if (t && !(this.towns[id] || []).some((e) => e[1] === 'station')) town(t, 'station', s.name);
      }
    });
    E.on('trainBought', (t) => {
      if (t.owner) return;
      co('first_train', t.name);
      const n = game.trains.mine().length;
      if (COUNTS.trains.includes(n)) co('trains', n);
    });
    E.on('regionUnlocked', (r) => co('region', r));
    E.on('stationRenovated', (s) => co('first_renovation', s.name));
    E.on('stationListed', (s) => co('first_listed', s.name));
    E.on('eraBand', (b) => co('era', ERA_BANDS[b]));
  }

  // a town's founding year: long before the game for most, from the seed
  founded(t) {
    const start = this.game.ledger.startYear;
    return Math.max(1650, start - 40 - (hashStr(`founded:${t.seed}:${t.name}`) % 180));
  }
  townLog(t) { return this.towns[t.id] || []; }
  // how much of the town each era built (shares of its buildings)
  townLayers(t) {
    const n = t.buildings.length || 1, out = new Array(ERA_BANDS.length).fill(0);
    for (const b of t.buildings) out[bandOf(b.y)]++;
    return out.map((k) => Math.round((k / n) * 100));
  }

  serialize() {
    const towns = {};
    for (const k in this.towns) if (this.towns[k].length) towns[k] = this.towns[k];
    return { towns, company: this.company };
  }
  deserialize(d) {
    if (!d || typeof d !== 'object') return;
    const ok = (e) => Array.isArray(e) && Number.isInteger(e[0]) && e[0] >= 1600 && e[0] <= 2400 && typeof e[1] === 'string' && e[1].length < 24 && (e[2] === undefined || typeof e[2] === 'number' || (typeof e[2] === 'string' && e[2].length < 64));
    if (d.towns && typeof d.towns === 'object') for (const k in d.towns) {
      if (!/^\d+$/.test(k) || !Array.isArray(d.towns[k])) continue;
      this.towns[k] = d.towns[k].filter(ok).slice(-MAX_TOWN);
    }
    if (Array.isArray(d.company)) this.company = d.company.filter(ok).slice(-MAX_CO);
  }
}
