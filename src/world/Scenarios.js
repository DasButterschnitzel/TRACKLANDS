// Scenarios: a world (seed, size, optional height map), a start (year,
// money, difficulty) and goals to reach before a deadline year. Built-in
// scenarios ship with the game; the scenario editor makes new ones, keeps them
// in this browser and exports / imports them as text.
//
// Goal kinds (target n):
//   value       company value at least n
//   passengers  passengers carried in total
//   cargo       units of one cargo delivered (goal.c)
//   towns       towns served by a station
//   profit      profit in one closed month
//   trains      trains in service
import { CARGO, DIFFICULTY } from '../config.js';
import { MAP_SIZES } from '../util.js';

export const GOAL_KINDS = ['value', 'passengers', 'cargo', 'towns', 'profit', 'trains'];

export const SCENARIOS = [
  { id: 'valley_link', seed: 1001, mapSize: 64, difficulty: 'standard', startYear: 1930, money: 0, deadline: 1945,
    goals: [{ k: 'towns', n: 4 }, { k: 'passengers', n: 3000 }, { k: 'value', n: 60000 }] },
  { id: 'coal_country', seed: 20417, mapSize: 96, difficulty: 'standard', startYear: 1900, money: 0, deadline: 1920,
    goals: [{ k: 'cargo', c: 'COAL', n: 2500 }, { k: 'cargo', c: 'STEEL', n: 800 }, { k: 'profit', n: 4000 }] },
  { id: 'grand_network', seed: 77121, mapSize: 128, difficulty: 'standard', startYear: 1950, money: 0, deadline: 1980,
    goals: [{ k: 'towns', n: 15 }, { k: 'trains', n: 25 }, { k: 'value', n: 400000 }] },
  { id: 'modern_express', seed: 5150, mapSize: 64, difficulty: 'standard', startYear: 1990, money: 60000, deadline: 2000,
    goals: [{ k: 'passengers', n: 12000 }, { k: 'profit', n: 9000 }] },
];

// a scenario from the editor or an import: keep only what the game understands
export function cleanScenario(s) {
  if (!s || typeof s !== 'object') return null;
  const num = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, Math.round(+v))) : d);
  const goals = (Array.isArray(s.goals) ? s.goals : []).slice(0, 6).map((g) => {
    if (!g || !GOAL_KINDS.includes(g.k)) return null;
    const out = { k: g.k, n: num(g.n, 1, 1e9, 1) };
    if (g.k === 'cargo') { if (!CARGO[g.c]) return null; out.c = g.c; }
    return out;
  }).filter(Boolean);
  if (!goals.length) return null;
  const startYear = num(s.startYear, 1800, 2100, 1950);
  return {
    id: typeof s.id === 'string' && /^[\w-]{1,40}$/.test(s.id) ? s.id : 'custom_' + Date.now().toString(36),
    name: typeof s.name === 'string' ? s.name.slice(0, 48) : '',
    seed: num(s.seed, 0, 4294967295, 1),
    mapSize: MAP_SIZES.includes(+s.mapSize) ? +s.mapSize : 64,
    difficulty: DIFFICULTY[s.difficulty] ? s.difficulty : 'standard',
    startYear,
    money: num(s.money, 0, 1e8, 0),
    deadline: num(s.deadline, startYear + 1, startYear + 200, startYear + 20),
    goals,
    custom: true,
  };
}

// the running scenario in a game
export class ScenarioRun {
  constructor(game, sc) {
    this.game = game;
    this.sc = sc;
    this.state = 'running';     // running | won | lost | free (kept playing after the end)
    this.best = 0;              // best closed month profit
    game.events.on('monthClosed', (c) => { this.best = Math.max(this.best, game.ledger.profitOf(c).profit); });
  }
  progress(goal) {
    const g = this.game, S = g.stats.data;
    switch (goal.k) {
      case 'value': return g.ledger.companyValue().total;
      case 'passengers': return S.passengers || 0;
      case 'cargo': return (S.cargo && S.cargo[goal.c]) || 0;
      case 'towns': return g.towns.list.filter((t) => g.stations.list.some((s) => s.links && s.links.towns.includes(t.id))).length;
      case 'profit': return this.best;
      case 'trains': return g.trains.trains.length;
      default: return 0;
    }
  }
  goals() { return this.sc.goals.map((goal) => ({ ...goal, have: this.progress(goal), done: this.progress(goal) >= goal.n })); }
  tick(dt) {
    if (this.state !== 'running') return;
    // (company value is not cheap: check once a game second)
    this.t = (this.t || 0) + dt;
    if (this.t < 1) return;
    this.t = 0;
    const g = this.game;
    if (this.goals().every((x) => x.done)) { this.state = 'won'; g.events.emit('scenarioEnd', 'won', this); return; }
    if (g.ledger.year() >= this.sc.deadline) { this.state = 'lost'; g.events.emit('scenarioEnd', 'lost', this); }
  }
  serialize() { return { sc: this.sc, state: this.state, best: Math.round(this.best) }; }
  static restore(game, d) {
    const sc = d && cleanScenario(d.sc);
    if (!sc) return null;
    if (d.sc && !d.sc.custom) sc.custom = false;
    const r = new ScenarioRun(game, sc);
    r.state = ['running', 'won', 'lost', 'free'].includes(d.state) ? d.state : 'running';
    r.best = Math.max(0, +d.best || 0);
    return r;
  }
}
