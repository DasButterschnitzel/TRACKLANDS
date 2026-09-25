// Central balancing and content configuration. Gameplay code reads from here only.

export const CREATOR_NAME = ''; // Set to credit the creator in the Credits panel.
export const GAME_VERSION = '3.0.0';
// World generator version. Saves remember theirs (no field = 1) so a loaded
// world is always rebuilt exactly as it was; improvements apply to new games.
export const WORLDGEN_VERSION = 2;
export const SAVE_VERSION = 3;

export const DIFFICULTY = {
  relaxed: { money: 5000, costMul: 0.7, growthMul: 0.8, incomeMul: 1.15, interest: 0.03 },
  standard: { money: 2500, costMul: 1.0, growthMul: 1.0, incomeMul: 1.0, interest: 0.06 },
  builder: { money: 5000000, costMul: 1.0, growthMul: 1.0, incomeMul: 1.0, interest: 0.04 },
};

// ---------- CARGO ----------
// group decides wagon style: log, bulk, liquid, crate, flat, pax, mail
export const CARGO = {
  WOOD: { value: 6, color: 0x9a6b3f, group: 'log', mass: 1.0 },
  GRAIN: { value: 7, color: 0xe2c35a, group: 'bulk', mass: 0.9 },
  FOOD: { value: 10, color: 0xd9744f, group: 'crate', mass: 0.8 },
  ORE: { value: 8, color: 0x8a6f63, group: 'bulk', mass: 1.8 },
  COAL: { value: 8, color: 0x3b3b40, group: 'bulk', mass: 1.5 },
  LUMBER: { value: 11, color: 0xd1a46b, group: 'flat', mass: 1.0 },
  STEEL: { value: 16, color: 0x8fa3b3, group: 'flat', mass: 1.8 },
  OIL: { value: 12, color: 0x2e2a2a, group: 'liquid', mass: 1.1 },
  FUEL: { value: 18, color: 0xe0a33a, group: 'liquid', mass: 1.0 },
  GOODS: { value: 22, color: 0x5aa6c8, group: 'crate', mass: 0.8 },
  MACHINERY: { value: 30, color: 0x6b7f5a, group: 'flat', mass: 2.2 },
  MAIL: { value: 9, color: 0xc94f4f, group: 'mail', mass: 0.3 },
  PASSENGERS: { value: 7, color: 0x4f86c9, group: 'pax', mass: 0.1 },
};
export const CARGO_IDS = Object.keys(CARGO);
export const TOWN_ACCEPTS = ['PASSENGERS', 'MAIL', 'FOOD', 'WOOD', 'LUMBER', 'GOODS', 'STEEL', 'FUEL', 'MACHINERY'];
// ---------- WAGONS ----------
// Data-driven rolling stock. `carries` is the single source of truth for cargo
// compatibility (UI, loading, AI and economy all read it). len in world units,
// mass in tonnes (empty), cap in cargo units, vmax km/h.
export const WAGONS = {
  coach: { len: 1.4, mass: 18, cap: 10, carries: ['PASSENGERS'], cost: 120, vmax: 160, cls: 'pax' },
  commuter: { len: 1.4, mass: 17, cap: 14, carries: ['PASSENGERS'], cost: 170, vmax: 120, loadMul: 1.5, cls: 'pax' },
  premium: { len: 1.5, mass: 22, cap: 7, carries: ['PASSENGERS'], cost: 320, vmax: 200, revMul: 0.35, cls: 'pax', research: 'passenger_comfort' },
  hs_coach: { len: 1.55, mass: 20, cap: 18, carries: ['PASSENGERS'], cost: 900, vmax: 480, cls: 'pax', research: 'high_speed_coaches', express: true },
  observation: { len: 1.45, mass: 20, cap: 7, carries: ['PASSENGERS'], cost: 420, vmax: 160, revMul: 0.2, trainRev: 0.08, cls: 'pax', research: 'passenger_comfort' },
  cab_car: { len: 1.45, mass: 24, cap: 7, carries: ['PASSENGERS'], cost: 650, vmax: 200, cab: true, cls: 'pax', research: 'push_pull' },
  mail_van: { len: 1.3, mass: 15, cap: 12, carries: ['MAIL'], cost: 110, vmax: 160, cls: 'mail' },
  boxcar: { len: 1.3, mass: 15, cap: 10, carries: ['FOOD', 'GOODS', 'MAIL'], cost: 100, vmax: 120, cls: 'freight' },
  timber: { len: 1.4, mass: 13, cap: 10, carries: ['WOOD', 'LUMBER'], cost: 90, vmax: 110, cls: 'freight' },
  hopper: { len: 1.25, mass: 16, cap: 10, carries: ['GRAIN', 'COAL', 'ORE'], cost: 110, vmax: 110, cls: 'freight' },
  coal_hopper: { len: 1.2, mass: 17, cap: 13, carries: ['COAL'], cost: 150, vmax: 110, cls: 'freight', research: 'specialized_wagons' },
  ore_hopper: { len: 1.05, mass: 18, cap: 13, carries: ['ORE'], cost: 150, vmax: 100, cls: 'freight', research: 'specialized_wagons' },
  tank: { len: 1.3, mass: 16, cap: 10, carries: ['OIL', 'FUEL'], cost: 140, vmax: 120, cls: 'freight' },
  flatbed: { len: 1.4, mass: 12, cap: 10, carries: ['LUMBER', 'STEEL', 'WOOD', 'MACHINERY'], cost: 90, vmax: 120, cls: 'freight' },
  reefer: { len: 1.35, mass: 18, cap: 12, carries: ['FOOD'], cost: 200, vmax: 140, cls: 'freight', research: 'specialized_wagons', revMul: 0.1 },
  container: { len: 1.55, mass: 14, cap: 14, carries: ['GOODS', 'FOOD', 'MAIL'], cost: 260, vmax: 160, cls: 'freight', research: 'containerization' },
  machinery_flat: { len: 1.5, mass: 20, cap: 10, carries: ['MACHINERY', 'STEEL'], cost: 220, vmax: 100, cls: 'freight', research: 'heavy_haul', revMul: 0.15 },
  brake_van: { len: 0.95, mass: 14, cap: 0, carries: [], cost: 80, vmax: 120, brake: 0.25, cls: 'service' },
  caboose: { len: 1.0, mass: 12, cap: 0, carries: [], cost: 120, vmax: 140, brake: 0.2, cls: 'service' },
};
export const WAGON_IDS = Object.keys(WAGONS);
export const wagonsFor = (cargo) => WAGON_IDS.filter((w) => WAGONS[w].carries.includes(cargo));
export const CONSIST = { maxVehicles: 14, maxLocos: 2, maxLocosHeavy: 3, gap: 0.12, ratingExcellent: 6, ratingGood: 3.5, ratingHeavy: 2 };
// Locomotive body length (world units); steam engines with tenders are longer.
export const LOCO_LEN = { pioneer: 1.45, ironhill: 1.95, meadow_tank: 1.6, atlas: 2.25, silverline: 2.3 };
export const locoLen = (m) => LOCO_LEN[m.id] || (m.kind === 'hst' || m.kind === 'maglev' ? 2.0 : 1.8);
export const locoMass = (m) => Math.round((m.kind === 'hst' || m.kind === 'maglev' ? 20 : 30) + m.power / (m.kind.startsWith('steam') ? 22 : 30));
// diesel/electric/high speed/maglev units can lead from either end; steam must turn
export const locoBidir = (m) => !m.kind.startsWith('steam');
// train priority classes (higher wins at contention)
export const PRIORITY = { express: 4, passenger: 3, mail: 2, freight: 1, service: 0 };

export const HEAVY_CARGO = ['ORE', 'COAL', 'STEEL', 'MACHINERY'];

export const REVENUE = {
  minTiles: 3,           // no meaningful income below this distance
  distBase: 0.5,
  distPerTile: 0.1,
  distCap: 5.0,
  demandBonus: 1.25,     // town currently needs this cargo
  xpPerCoin: 0.3,
};

// ---------- CONSTRUCTION ----------
export const TRACK_TIERS = [
  { id: 'standard', cost: 10, speed: 80, research: null, color: 0x6b4a33 },
  { id: 'reinforced', cost: 24, speed: 140, research: 'reinforced_rail', color: 0x55504a },
  { id: 'electric', cost: 45, speed: 180, research: 'electric_rail', color: 0x4a4f55 },
  { id: 'highspeed', cost: 90, speed: 340, research: 'high_speed_rail', color: 0x9aa0a6 },
];
export const COSTS = {
  bridgeExtra: 45,
  tunnelExtra: 110,
  station: 150,
  stationUpgrade: [0, 400, 1500, 6000, 25000, 70000],
  stationUpgradeLevel: [1, 2, 6, 12, 20, 28], // company level needed for station level index
  depot: 250,
  bulldozeRefund: 0.5,
  treeClear: 2,
  trainSellRefund: 0.5,
  stationTrackTile: 70,    // per new platform-track tile
  platformExtend: 55,      // per converted platform tile
  signal: 30,
  waypoint: 20,
  facility: 1200,
};
export const STATION = {
  storage: [60, 120, 240, 480, 960, 1600],
  loadRate: [8, 12, 16, 22, 30, 40],    // units per second
  radius: [3, 3, 4, 4, 5, 5],
  passengers: [4, 8, 14, 20, 28, 36],  // visual crowd
  maxLevel: 5,                          // internal index (displayed as level 6)
  maxTracks: 2, maxTracksExp: 4, maxTracksGrand: 12,
  maxLength: 3, maxLengthExt: 6,
  minPlatformEff: 0.72,                 // loading speed floor for trains longer than the platform
};
// Freight facilities boost loading of matching cargo at a station.
export const FACILITIES = {
  grain_silo: { cargo: ['GRAIN', 'FOOD'], mul: 1.8 },
  coal_loader: { cargo: ['COAL', 'ORE'], mul: 1.8 },
  tank_farm: { cargo: ['OIL', 'FUEL'], mul: 1.8 },
  timber_yard: { cargo: ['WOOD', 'LUMBER'], mul: 1.8 },
  container_crane: { cargo: ['GOODS', 'MACHINERY', 'STEEL', 'MAIL'], mul: 1.8 },
};
export const PLATFORM_ROLES = ['any', 'passenger', 'freight', 'express', 'through'];

// ---------- INDUSTRIES ----------
// rate = production cycles per minute at level 0. recipes consume `in` and produce `out`.
export const INDUSTRY_LEVELS = ['small', 'established', 'expanded', 'industrial', 'mega'];
export const INDUSTRY_LEVEL_THRESH = [150, 600, 2000, 6000];
export const INDUSTRIES = {
  FOREST: { primary: true, rate: 18, recipes: [{ in: {}, out: { WOOD: 1 } }], storage: 60 },
  FARM: { primary: true, rate: 14, recipes: [{ in: {}, out: { GRAIN: 1 } }, { in: {}, out: { FOOD: 1 }, every: 2 }], storage: 60 },
  MINE: { primary: true, rate: 14, recipes: [{ in: {}, out: { ORE: 1 } }], storage: 60 },
  COAL_MINE: { primary: true, rate: 14, recipes: [{ in: {}, out: { COAL: 1 } }], storage: 60 },
  OIL_FIELD: { primary: true, rate: 12, recipes: [{ in: {}, out: { OIL: 1 } }], storage: 60 },
  SAWMILL: { rate: 24, recipes: [{ in: { WOOD: 1 }, out: { LUMBER: 1 } }], storage: 80 },
  FOOD_PROC: { rate: 24, recipes: [{ in: { GRAIN: 1 }, out: { FOOD: 1 } }], storage: 80 },
  STEEL_MILL: { rate: 18, recipes: [{ in: { ORE: 1, COAL: 1 }, out: { STEEL: 1 } }], storage: 80 },
  REFINERY: { rate: 20, recipes: [{ in: { OIL: 1 }, out: { FUEL: 1 } }], storage: 80 },
  FACTORY: { rate: 16, recipes: [{ in: { LUMBER: 1, STEEL: 1 }, out: { GOODS: 2 } }, { in: { STEEL: 1, GOODS: 1 }, out: { MACHINERY: 1 }, needLevel: 0 }], storage: 90 },
  DIST_CENTER: { rate: 20, recipes: [{ in: { GOODS: 1 }, out: { MAIL: 1 } }, { in: { FOOD: 1 }, out: { MAIL: 1 } }, { in: { MACHINERY: 1 }, out: { MAIL: 2 } }], storage: 90, sink: true },
  PORT: { primary: true, rate: 10, recipes: [{ in: {}, out: { GOODS: 1 } }, { in: {}, out: { OIL: 1 } }], accepts: ['WOOD', 'GRAIN', 'STEEL', 'FUEL', 'LUMBER'], storage: 80 },
};
export const INDUSTRY_TYPES = Object.keys(INDUSTRIES);
// Investing in industries (src/world/Industries.js). base: what the site is
// worth at level 0 (× difficulty cost). A stake is bought in quarters at the
// site's value; a stake pays a monthly dividend of margin × the value of what
// the site produced that month. Funding an expansion raises the level at once;
// funding a new site builds one on free land. Majority owners (≥ 50 %) run
// the site: +10 % production.
export const INDUSTRY_INVEST = {
  base: { FOREST: 1200, FARM: 1200, MINE: 1500, COAL_MINE: 1500, OIL_FIELD: 2000, SAWMILL: 1800, FOOD_PROC: 2000, STEEL_MILL: 2900, REFINERY: 2900, FACTORY: 2700, DIST_CENTER: 2400, PORT: 3600 },
  step: 0.25,          // stakes are bought and sold in quarters
  margin: 0.5,         // dividend: share × margin × monthly output value
  sellBack: 0.8,       // a stake sells for 80 % of its value
  expand: 2.2,         // expansion cost: base × expand × (level + 1)^1.4
  found: 4.5,          // a new site: base × found
  foundStake: 0.25,    // the founder keeps a quarter
  ownerBonus: 0.1,     // production bonus when the company holds ≥ 50 %
  townGap: 4,          // a new site needs this many tiles from a town's edge (else: permit)
};

// ---------- TOWNS ----------
export const TOWN_STAGES = ['hamlet', 'village', 'town', 'large_town', 'city', 'major_city', 'metropolis'];
export const TOWN_REQ = [
  { WOOD: 25, FOOD: 15, PASSENGERS: 15 },
  { FOOD: 50, LUMBER: 40, MAIL: 25 },
  { GOODS: 80, STEEL: 60, PASSENGERS: 120 },
  { FUEL: 120, MACHINERY: 60, MAIL: 150 },
  { GOODS: 300, FOOD: 300, FUEL: 250, PASSENGERS: 500 },
  { MACHINERY: 400, GOODS: 600, STEEL: 400, PASSENGERS: 1200, MAIL: 600 },
];
export const TOWN_POP = [80, 300, 900, 2500, 7000, 18000, 45000];
export const TOWN_RADIUS = [2, 2, 3, 4, 4, 5, 6];
export const TOWN_BUILDINGS = [6, 11, 18, 28, 40, 54, 70];
export const TOWN_PRODUCTION = { paxBase: 6, paxPerPop: 1 / 15, mailBase: 3, mailPerPop: 1 / 40 }; // per minute

// ---------- TRAINS ----------
// speed km/h. Internal tiles/sec = kmh / KMH_PER_TILE_S.
export const KMH_PER_TILE_S = 40;

// ---------- ROAD TRANSPORT ----------
// buses carry passengers (and some mail); trucks carry the cargo groups of their body
export const ROAD_VEHICLES = [
  // buses: role city (fast boarding, many stops), regional (fast, comfortable,
  // slow to board), airport (luggage: pays more on airport legs); board =
  // boarding speed, comfort scales fares a little, rel = reliability when new
  { id: 'minibus', name: 'Hopper 16', kind: 'bus', role: 'city', era: 1, cap: 16, mail: 2, speed: 50, accel: 1.4, board: 1.3, comfort: 0.9, rel: 0.93, energy: 'diesel', doors: 1, life: 14, price: 520, op: 5, level: 1, color: 0x5aa0c8, shape: 'mini' },
  { id: 'citybus', name: 'Citybus 30', kind: 'bus', role: 'city', era: 1, cap: 30, mail: 4, speed: 55, accel: 1.1, board: 1.0, comfort: 0.95, rel: 0.9, energy: 'diesel', doors: 2, life: 18, price: 900, op: 10, level: 1, color: 0xe8c547, shape: 'classic' },
  { id: 'urban_bus', name: 'Metro 40 Low-Floor', kind: 'bus', role: 'city', era: 2, cap: 40, mail: 4, speed: 60, accel: 1.2, board: 1.35, comfort: 1.0, rel: 0.92, energy: 'diesel', doors: 2, life: 18, price: 1500, op: 13, level: 6, color: 0xd8483a, shape: 'urban' },
  { id: 'coach', name: 'Coach Express 44', kind: 'bus', role: 'regional', era: 2, cap: 44, mail: 8, speed: 90, accel: 1.0, board: 0.6, comfort: 1.1, rel: 0.9, energy: 'diesel', doors: 1, life: 16, price: 2600, op: 22, level: 8, color: 0x3f6e9a, shape: 'coach' },
  { id: 'double_decker', name: 'Skyline 70 Double-Deck', kind: 'bus', role: 'city', era: 2, cap: 70, mail: 6, speed: 55, accel: 0.9, board: 0.75, comfort: 1.0, rel: 0.9, energy: 'diesel', doors: 2, life: 20, price: 3200, op: 20, level: 10, color: 0xc0392b, shape: 'decker' },
  { id: 'articulated', name: 'Flex 90 Articulated', kind: 'bus', role: 'city', era: 3, cap: 90, mail: 6, speed: 58, accel: 0.9, board: 1.5, comfort: 0.95, rel: 0.9, energy: 'diesel', doors: 3, life: 18, price: 4200, op: 26, level: 12, color: 0xe0a33a, shape: 'artic', turn: 0.85 },
  { id: 'airport_shuttle', name: 'Jetlink 36 Airport Shuttle', kind: 'bus', role: 'airport', era: 3, cap: 36, mail: 2, speed: 80, accel: 1.1, board: 0.9, comfort: 1.1, rel: 0.93, energy: 'diesel', doors: 2, life: 16, price: 2400, op: 16, level: 12, color: 0x2f8a9a, shape: 'shuttle', airport: 0.25 },
  { id: 'e_citybus', name: 'Volta 42 Electric', kind: 'bus', role: 'city', era: 4, cap: 42, mail: 4, speed: 62, accel: 1.7, board: 1.4, comfort: 1.05, rel: 0.95, energy: 'electric', doors: 2, life: 16, price: 3600, op: 7, level: 16, color: 0x3fae5a, shape: 'electric' },
  { id: 'express_coach', name: 'Interstate 52', kind: 'bus', role: 'regional', era: 4, cap: 52, mail: 10, speed: 110, accel: 1.1, board: 0.6, comfort: 1.18, rel: 0.93, energy: 'diesel', doors: 1, life: 16, price: 5200, op: 30, level: 18, color: 0x4a5568, shape: 'express' },
  { id: 'e_articulated', name: 'Volta Flex 100 Electric', kind: 'bus', role: 'city', era: 4, cap: 100, mail: 6, speed: 62, accel: 1.5, board: 1.7, comfort: 1.05, rel: 0.95, energy: 'electric', doors: 3, life: 18, price: 6800, op: 14, level: 20, color: 0x17a2b8, shape: 'eartic', turn: 0.85 },
  { id: 'autopod', name: 'Pod 12 Autonomous Shuttle', kind: 'bus', role: 'city', era: 5, cap: 12, mail: 0, speed: 45, accel: 1.6, board: 1.6, comfort: 1.1, rel: 0.97, energy: 'electric', doors: 1, life: 14, price: 1700, op: 2, level: 26, color: 0xe8e8ee, shape: 'pod' },
  { id: 'box_truck', name: 'Box Truck', kind: 'truck', groups: ['crate', 'mail'], cap: 14, speed: 55, price: 1100, op: 12, level: 1, color: 0xc9793a },
  { id: 'logging_truck', name: 'Logging Truck', kind: 'truck', groups: ['log'], cap: 16, speed: 50, price: 1200, op: 13, level: 1, color: 0x7a5a3a },
  { id: 'dump_truck', name: 'Dump Truck', kind: 'truck', groups: ['bulk'], cap: 18, speed: 50, price: 1300, op: 14, level: 3, color: 0xd0a030 },
  { id: 'tanker_truck', name: 'Tanker Truck', kind: 'truck', groups: ['liquid'], cap: 16, speed: 55, price: 1500, op: 15, level: 5, color: 0xb8bcc2 },
  { id: 'flatbed_truck', name: 'Flatbed Truck', kind: 'truck', groups: ['flat'], cap: 14, speed: 55, price: 1400, op: 14, level: 5, color: 0x5a7a4a },
  // trams run on tram track laid along streets and company roads
  { id: 'tram', name: 'Tram Classic', kind: 'tram', pax: true, cap: 45, mail: 4, speed: 45, price: 1700, op: 9, level: 4, color: 0xd8483a },
  { id: 'tram_lr', name: 'Light Rail Tram', kind: 'tram', pax: true, cap: 80, mail: 6, speed: 70, price: 3600, op: 16, level: 14, color: 0x2f8a9a },
  // ships sail on connected water between docks
  { id: 'ferry', name: 'Harbour Ferry', kind: 'dock', pax: true, cap: 70, mail: 10, speed: 30, price: 3200, op: 12, level: 6, color: 0xf0f0f0 },
  { id: 'cargo_ship', name: 'Coaster', kind: 'dock', groups: ['crate', 'bulk', 'flat', 'log'], cap: 90, speed: 25, price: 4200, op: 15, level: 8, color: 0x3a5a8a },
  { id: 'tanker_ship', name: 'Coastal Tanker', kind: 'dock', groups: ['liquid'], cap: 100, speed: 25, price: 4600, op: 16, level: 10, color: 0xb04a3a },
  // aircraft fly straight between airports: fast, costly to run
  { id: 'propliner', name: 'Propliner 40', kind: 'airport', pax: true, cap: 40, mail: 12, speed: 320, price: 18000, op: 450, level: 12, color: 0xe8e8ee },
  { id: 'jetliner', name: 'Jetliner 120', kind: 'airport', pax: true, cap: 120, mail: 30, speed: 650, price: 60000, op: 1300, level: 24, color: 0xf4f4f8 },
];
// stop kind → how its vehicles move
export const STOP_MODE = { bus: 'road', truck: 'road', tram: 'tram', dock: 'water', airport: 'air', garage: 'road' };
// Bus stop types, from a pole by the road to an interchange with the railway.
// level: company level to build it; cost: × ROAD_COSTS.stop (upgrade price);
// board: boarding speed; bays: buses served at once; radius: walking
// distance (tiles); transfer: how easily travellers change to and from
// trains; land: tiles beside the road the building needs; pullIn: buses leave
// the road to stop (no queue behind them). Storage follows STATION.storage
// by type rank (60 … 1600).
export const STOP_TYPES = {
  basic: { level: 1, cost: 1, board: 1.0, bays: 1, radius: 2, transfer: 1.0, land: 0 },
  urban: { level: 3, cost: 0.9, board: 1.15, bays: 1, radius: 2, transfer: 1.0, land: 0 },
  bay: { level: 5, cost: 1.4, board: 1.15, bays: 2, radius: 2, transfer: 1.0, land: 0, pullIn: true },
  station: { level: 8, cost: 5, board: 1.3, bays: 3, radius: 3, transfer: 1.15, land: 1, pullIn: true },
  terminal: { level: 14, cost: 14, board: 1.45, bays: 6, radius: 4, transfer: 1.25, land: 2, pullIn: true },
  interchange: { level: 18, cost: 10, board: 1.5, bays: 6, radius: 4, transfer: 1.5, land: 2, pullIn: true, railReach: 6 },
};
export const STOP_ORDER = ['basic', 'urban', 'bay', 'station', 'terminal', 'interchange'];
// expansions of bus stations and terminals: max count, cost (× ROAD_COSTS.stop)
export const STOP_FACILITIES = {
  bay: { max: 4, cost: 1.5, from: 'station' },          // one more bus served at once
  shelter: { max: 1, cost: 0.8, from: 'station' },      // comfort: a better rating
  capacity: { max: 2, cost: 2, from: 'station' },       // +50 % waiting room each
  entrance: { max: 1, cost: 2.5, from: 'station' },     // second entrance: faster boarding
  building: { max: 1, cost: 6, from: 'terminal' },      // terminal building: rating
  transfer: { max: 1, cost: 4, from: 'station' },       // transfer facility: easier changes
  turning: { max: 1, cost: 2, from: 'station' },        // turning area: buses turn off the road
};
export const ROAD_COSTS = { tile: 14, crossing: 60, stop: 180, tram: 22, dock: 700, airport: 5200, garage: 900, lane: 30 };
export const TRAIT_IDS = ['cargo_master', 'city_hopper', 'long_hauler', 'mountain_goat', 'fast_loading', 'high_accel', 'heavy_freight', 'cheap_op', 'express'];
export const LOCOS = [
  { id: 'pioneer', name: 'Pioneer 0-4-0', era: 1, kind: 'steam', role: 'mixed', speed: 60, accel: 0.9, power: 400, freight: 12, pax: 10, wagons: 2, reliability: 0.9, load: 1.0, op: 20, price: 600, rarity: 'common', trait: 'cheap_op', level: 1, color: 0x2f6b4a },
  { id: 'ironhill', name: 'Ironhill 2-6-0', era: 1, kind: 'steam', role: 'freight', speed: 72, accel: 0.8, power: 650, freight: 20, pax: 6, wagons: 3, reliability: 0.9, load: 1.0, op: 32, price: 1400, rarity: 'common', trait: 'mountain_goat', level: 3, color: 0x3a3f4a },
  { id: 'meadow_tank', name: 'Meadow Tank 2-4-2', era: 1, kind: 'steam', role: 'passenger', speed: 76, accel: 1.2, power: 520, freight: 6, pax: 26, wagons: 3, reliability: 0.92, load: 1.1, op: 30, price: 1800, rarity: 'common', trait: 'city_hopper', level: 5, color: 0x7a2f2f },
  { id: 'atlas', name: 'Atlas Heavy Steam', era: 2, kind: 'steam2', role: 'freight', speed: 88, accel: 0.75, power: 1100, freight: 34, pax: 8, wagons: 4, reliability: 0.9, load: 1.0, op: 55, price: 4800, rarity: 'uncommon', trait: 'cargo_master', level: 8, color: 0x2b2e33 },
  { id: 'silverline', name: 'Silverline Express', era: 2, kind: 'steam2', role: 'passenger', speed: 115, accel: 1.0, power: 900, freight: 8, pax: 40, wagons: 4, reliability: 0.93, load: 1.1, op: 60, price: 6500, rarity: 'rare', trait: 'express', level: 10, color: 0x8b99a8 },
  { id: 'trailmaster', name: 'Trailmaster Diesel', era: 3, kind: 'diesel', role: 'mixed', speed: 110, accel: 1.3, power: 1500, freight: 32, pax: 30, wagons: 4, reliability: 0.96, load: 1.1, op: 80, price: 14000, rarity: 'common', trait: 'high_accel', level: 13, color: 0xd08a2e },
  { id: 'cargoking', name: 'CargoKing D40', era: 3, kind: 'diesel', role: 'freight', speed: 105, accel: 1.0, power: 2200, freight: 56, pax: 0, wagons: 5, reliability: 0.95, load: 1.0, op: 95, price: 22000, rarity: 'uncommon', trait: 'heavy_freight', level: 16, color: 0x2f5f8a },
  { id: 'metrorunner', name: 'MetroRunner D6', era: 3, kind: 'diesel', role: 'passenger', speed: 125, accel: 1.6, power: 1600, freight: 10, pax: 56, wagons: 4, reliability: 0.96, load: 1.3, op: 85, price: 26000, rarity: 'uncommon', trait: 'fast_loading', level: 18, color: 0xc8c1b0 },
  { id: 'voltstream_e1', name: 'Voltstream E1', era: 4, kind: 'electric', role: 'mixed', speed: 150, accel: 1.8, power: 3000, freight: 48, pax: 48, wagons: 5, reliability: 0.97, load: 1.2, op: 90, price: 60000, rarity: 'uncommon', trait: 'cheap_op', level: 21, color: 0x2e8b7a, electric: true },
  { id: 'voltstream_e3', name: 'Voltstream E3', era: 4, kind: 'electric', role: 'freight', speed: 165, accel: 1.6, power: 4200, freight: 80, pax: 0, wagons: 6, reliability: 0.97, load: 1.1, op: 120, price: 95000, rarity: 'rare', trait: 'cargo_master', level: 25, color: 0x8a2e2e, electric: true },
  { id: 'falcon', name: 'InterCity Falcon', era: 4, kind: 'electric', role: 'passenger', speed: 190, accel: 1.9, power: 3600, freight: 12, pax: 90, wagons: 6, reliability: 0.97, load: 1.3, op: 125, price: 130000, rarity: 'rare', trait: 'long_hauler', level: 27, color: 0xe4e0d6, electric: true },
  { id: 'arrowline_200', name: 'Arrowline 200', era: 5, kind: 'hst', role: 'passenger', speed: 250, accel: 2.2, power: 6000, freight: 0, pax: 120, wagons: 6, reliability: 0.98, load: 1.4, op: 200, price: 320000, rarity: 'rare', trait: 'express', level: 30, color: 0xf2f2f2, electric: true },
  { id: 'arrowline_300', name: 'Arrowline 300', era: 5, kind: 'hst', role: 'passenger', speed: 300, accel: 2.4, power: 8000, freight: 0, pax: 150, wagons: 7, reliability: 0.98, load: 1.4, op: 260, price: 600000, rarity: 'epic', trait: 'long_hauler', level: 34, color: 0xe8eef2, electric: true },
  { id: 'novarail', name: 'NovaRail X', era: 5, kind: 'hst', role: 'freight', speed: 270, accel: 2.0, power: 9000, freight: 150, pax: 20, wagons: 7, reliability: 0.98, load: 1.3, op: 280, price: 750000, rarity: 'epic', trait: 'heavy_freight', level: 37, color: 0x3a3f58, electric: true },
  { id: 'vector_hst', name: 'Vector HST', era: 5, kind: 'hst', role: 'mixed', speed: 320, accel: 2.6, power: 10000, freight: 90, pax: 130, wagons: 7, reliability: 0.99, load: 1.5, op: 300, price: 1100000, rarity: 'epic', trait: 'fast_loading', level: 40, color: 0xd0402f, electric: true },
  { id: 'magna_m1', name: 'MagnaRail M1', era: 6, kind: 'maglev', role: 'mixed', speed: 400, accel: 3.0, power: 14000, freight: 120, pax: 160, wagons: 7, reliability: 0.99, load: 1.6, op: 380, price: 2400000, rarity: 'legendary', trait: 'express', level: 44, color: 0x2fc4c0, electric: true, maglev: true },
  { id: 'magna_m3', name: 'MagnaRail M3', era: 6, kind: 'maglev', role: 'mixed', speed: 480, accel: 3.4, power: 18000, freight: 180, pax: 220, wagons: 8, reliability: 0.99, load: 1.8, op: 450, price: 4500000, rarity: 'legendary', trait: 'long_hauler', level: 48, color: 0x9a5cd6, electric: true, maglev: true },
];
export const ERA_RESEARCH = { 4: 'electric_rail', 5: 'high_speed_rail', 6: 'maglev_tech' };
export const TRAIN_UPGRADES = ['engine', 'capacity', 'accel', 'loading', 'efficiency'];
export const TRAIN_UPGRADE_MAX = 5;
export const TRAIN_UPGRADE_EFFECT = { engine: 0.06, capacity: 0.15, accel: 0.15, loading: 0.12, efficiency: 0.1 };
export const trainUpgradeCost = (price, lvl) => Math.round(price * 0.22 * Math.pow(1.65, lvl));

// ---------- PROGRESSION ----------
export const MAX_LEVEL = 60;
export const xpForLevel = (lvl) => Math.round(120 * Math.pow(1.22, lvl - 1) + 60 * (lvl - 1));
export const rpForLevel = (lvl) => (lvl % 5 === 0 ? 3 : 1);
export const RESEARCH_UNLOCK_LEVEL = 3;
export const LEGACY_LEVEL = 40;

export const RESEARCH = [
  // RAIL
  { id: 'cheap_track_1', cat: 'rail', cost: 2, req: [], fx: { trackCost: -0.15 } },
  { id: 'bridge_eng', cat: 'rail', cost: 3, req: ['cheap_track_1'], fx: { bridgeCost: -0.4 } },
  { id: 'reinforced_rail', cat: 'rail', cost: 4, req: ['cheap_track_1'], fx: {} },
  { id: 'improved_curves', cat: 'rail', cost: 3, req: ['reinforced_rail'], fx: { curvePenalty: -0.5 } },
  { id: 'tunnel_eng', cat: 'rail', cost: 4, req: ['bridge_eng'], fx: { tunnelCost: -0.4 } },
  { id: 'cheap_track_2', cat: 'rail', cost: 6, req: ['tunnel_eng'], fx: { trackCost: -0.15 } },
  { id: 'electric_rail', cat: 'rail', cost: 8, req: ['reinforced_rail'], fx: {} },
  { id: 'high_speed_rail', cat: 'rail', cost: 15, req: ['electric_rail', 'improved_curves'], fx: {} },
  { id: 'maglev_tech', cat: 'rail', cost: 25, req: ['high_speed_rail'], fx: {} },
  // SIGNALS
  { id: 'block_signals', cat: 'signals', cost: 2, req: [], fx: {} },
  { id: 'path_signals', cat: 'signals', cost: 3, req: ['block_signals'], fx: {} },
  { id: 'one_way_signals', cat: 'signals', cost: 3, req: ['block_signals'], fx: {} },
  { id: 'fast_switches', cat: 'signals', cost: 4, req: ['path_signals'], fx: { switchTime: -0.5, junctionSpeed: 0.25 } },
  { id: 'cab_signalling', cat: 'signals', cost: 7, req: ['fast_switches'], fx: { brake: 0.25, trainSpeed: 0.04 } },
  // TRAINS
  { id: 'better_boilers', cat: 'trains', cost: 2, req: [], fx: { trainSpeed: 0.08 } },
  { id: 'fast_couplings', cat: 'trains', cost: 3, req: ['better_boilers'], fx: { trainAccel: 0.15 } },
  { id: 'efficient_engines', cat: 'trains', cost: 4, req: ['better_boilers'], fx: { opCost: -0.2 } },
  { id: 'long_consists', cat: 'trains', cost: 6, req: ['fast_couplings'], fx: { capacity: 0.15 } },
  { id: 'train_maintenance', cat: 'trains', cost: 8, req: ['efficient_engines'], fx: { trainSpeed: 0.08, opCost: -0.1 } },
  { id: 'specialized_wagons', cat: 'trains', cost: 3, req: ['better_boilers'], fx: {} },
  { id: 'passenger_comfort', cat: 'trains', cost: 3, req: [], fx: {} },
  { id: 'push_pull', cat: 'trains', cost: 4, req: ['passenger_comfort'], fx: {} },
  { id: 'containerization', cat: 'trains', cost: 5, req: ['specialized_wagons'], fx: {} },
  { id: 'heavy_haul', cat: 'trains', cost: 6, req: ['long_consists'], fx: {} },
  { id: 'high_speed_coaches', cat: 'trains', cost: 8, req: ['push_pull', 'electric_rail'], fx: {} },
  // STATIONS
  { id: 'platform_extension', cat: 'stations', cost: 2, req: [], fx: {} },
  { id: 'station_expansion', cat: 'stations', cost: 3, req: ['platform_extension'], fx: {} },
  { id: 'freight_terminals', cat: 'stations', cost: 4, req: ['station_expansion'], fx: {} },
  { id: 'station_dispatch', cat: 'stations', cost: 4, req: ['station_expansion'], fx: { loadSpeed: 0.1 } },
  { id: 'grand_terminals', cat: 'stations', cost: 9, req: ['station_expansion', 'station_dispatch'], fx: {} },
  // LOGISTICS
  { id: 'fast_loading', cat: 'logistics', cost: 2, req: [], fx: { loadSpeed: 0.25 } },
  { id: 'station_storage', cat: 'logistics', cost: 3, req: ['fast_loading'], fx: { storage: 0.5 } },
  { id: 'station_reach', cat: 'logistics', cost: 4, req: ['station_storage'], fx: { stationRadius: 1 } },
  { id: 'cargo_optimization', cat: 'logistics', cost: 5, req: ['fast_loading'], fx: { cargoIncome: 0.1 } },
  { id: 'express_logistics', cat: 'logistics', cost: 8, req: ['cargo_optimization'], fx: { mailIncome: 0.2, cargoIncome: 0.05 } },
  // CITIES
  { id: 'urban_planning', cat: 'cities', cost: 3, req: [], fx: { townReq: -0.15 } },
  { id: 'passenger_economy', cat: 'cities', cost: 4, req: ['urban_planning'], fx: { paxIncome: 0.15, paxProd: 0.2 } },
  { id: 'city_services', cat: 'cities', cost: 6, req: ['passenger_economy'], fx: { mailProd: 0.3 } },
  { id: 'metro_planning', cat: 'cities', cost: 10, req: ['city_services'], fx: { townReq: -0.15 } },
  // INDUSTRY
  { id: 'industry_boost', cat: 'industry', cost: 3, req: [], fx: { industryProd: 0.15 } },
  { id: 'heavy_industry', cat: 'industry', cost: 5, req: ['industry_boost'], fx: { processing: 0.2 } },
  { id: 'industrial_growth', cat: 'industry', cost: 6, req: ['heavy_industry'], fx: { industryGrowth: 0.3 } },
  { id: 'automation', cat: 'industry', cost: 10, req: ['industrial_growth'], fx: { industryProd: 0.25 } },
  // ECONOMY
  { id: 'smart_finance', cat: 'economy', cost: 2, req: [], fx: { income: 0.1 } },
  { id: 'subsidies', cat: 'economy', cost: 4, req: ['smart_finance'], fx: { buildingCost: -0.2 } },
  { id: 'market_insight', cat: 'economy', cost: 5, req: ['smart_finance'], fx: { contractReward: 0.3 } },
  { id: 'trade_networks', cat: 'economy', cost: 7, req: ['subsidies'], fx: { income: 0.1 } },
];
export const RESEARCH_CATS = ['rail', 'signals', 'trains', 'stations', 'logistics', 'cities', 'industry', 'economy'];

// ---------- REGIONS ----------
export const REGIONS = [
  { id: 'green_valley', center: [30, 32], biome: 'green', level: 1, cost: 0, towns: 3, industries: ['FOREST', 'FARM', 'SAWMILL', 'FOREST'] },
  { id: 'pine_highlands', center: [30, 10], biome: 'pine', level: 4, cost: 2500, towns: 2, industries: ['FOREST', 'COAL_MINE', 'MINE', 'SAWMILL'] },
  { id: 'industrial_basin', center: [53, 12], biome: 'industrial', level: 8, cost: 8000, towns: 2, industries: ['STEEL_MILL', 'FACTORY', 'COAL_MINE', 'DIST_CENTER'] },
  { id: 'golden_plains', center: [53, 34], biome: 'plains', level: 12, cost: 20000, towns: 2, industries: ['FARM', 'FARM', 'FOOD_PROC', 'MINE'] },
  { id: 'coastal_reach', center: [9, 33], biome: 'coast', level: 16, cost: 50000, towns: 3, industries: ['PORT', 'REFINERY', 'FARM', 'FOREST'] },
  { id: 'desert_frontier', center: [48, 54], biome: 'desert', level: 21, cost: 120000, towns: 2, industries: ['OIL_FIELD', 'OIL_FIELD', 'REFINERY', 'MINE'] },
  { id: 'alpine_pass', center: [16, 54], biome: 'alpine', level: 26, cost: 300000, towns: 2, industries: ['MINE', 'COAL_MINE', 'FACTORY', 'FOREST'], tourist: true },
  { id: 'northern_snowfields', center: [9, 10], biome: 'snow', level: 32, cost: 700000, towns: 2, industries: ['MINE', 'COAL_MINE', 'STEEL_MILL', 'OIL_FIELD'] },
];
export const REGION_PREV_OBJECTIVES = 2;
export const REGION_DEVELOPED_AT = 4;

export const BIOMES = {
  green: { grass: 0x7fb85a, grass2: 0x6aa84f, amp: 0.7, mtn: 0.0, lakes: 0.12, trees: 0.36, tree: 'oak', roof: [0xb5563f, 0x9c4a3a, 0x7a5a48] },
  pine: { grass: 0x4f8a4a, grass2: 0x3f7a44, amp: 1.1, mtn: 0.35, lakes: 0.1, trees: 0.6, tree: 'pine', roof: [0x5a4a42, 0x7a3f33, 0x4a5a62] },
  industrial: { grass: 0x8a9a6a, grass2: 0x7a8a60, amp: 0.4, mtn: 0.1, lakes: 0.06, trees: 0.15, tree: 'oak', roof: [0x5a5f66, 0x7a4a3a, 0x4a4f55] },
  plains: { grass: 0xc8b86a, grass2: 0xb9a95c, amp: 0.3, mtn: 0.0, lakes: 0.05, trees: 0.12, tree: 'oak', roof: [0xc26a3f, 0xa05a3a, 0xd08a4a] },
  coast: { grass: 0x86c06a, grass2: 0x74b05e, amp: 0.6, mtn: 0.05, lakes: 0.08, trees: 0.3, tree: 'oak', roof: [0x3f6e9a, 0xe8e2d4, 0x4a8ab0] },
  desert: { grass: 0xdcc08a, grass2: 0xd0b07a, amp: 0.45, mtn: 0.2, lakes: 0.0, trees: 0.08, tree: 'cactus', roof: [0xd8a060, 0xc88a50, 0xe8d0a0] },
  alpine: { grass: 0x6f9e5e, grass2: 0x5e8e52, amp: 1.5, mtn: 0.55, lakes: 0.08, trees: 0.4, tree: 'pine', roof: [0x6a3f2f, 0x5a4a3a, 0x8a3f3a] },
  snow: { grass: 0xe6eef2, grass2: 0xd6e2ea, amp: 1.0, mtn: 0.35, lakes: 0.08, trees: 0.35, tree: 'snowpine', roof: [0x7a3f3a, 0x3f4a6a, 0x5a5a5a] },
};

// ---------- CONTRACTS / DAILIES / EVENTS ----------
export const CONTRACT_SLOTS = 3;
export const EVENTS = [
  { id: 'tourist_weekend', dur: 180, fx: { paxProd: 0.5 } },
  { id: 'construction_boom', dur: 180, fx: { materialIncome: 0.5 } },
  { id: 'factory_order', dur: 180, fx: { goodsIncome: 0.5 } },
  { id: 'harvest_season', dur: 180, fx: { farmProd: 0.5 } },
  { id: 'mining_rush', dur: 180, fx: { mineProd: 0.5 } },
];

// ---------- COSMETICS ----------
// Train liveries: body (null = the model's house colour), trim, accent (lining
// and stripes), roof (null = a darker body shade) and stripe style. The first
// nine are free presets; the last two are rewards. Players can also mix a
// custom livery (Livery.js).
export const LIVERIES = [
  { id: 'classic_green', body: null, trim: 0xd9b45a, accent: null, roof: null, stripe: 'none', unlock: { level: 1 } },
  { id: 'royal_blue', body: 0x2f4f8f, trim: 0xe0c060, accent: 0xe0c060, roof: 0x2a3140, stripe: 'line', unlock: { level: 1 } },
  { id: 'cream_express', body: 0xe8dcc0, trim: 0x7a2f2f, accent: 0x7a2f2f, roof: 0x5a4a44, stripe: 'band', unlock: { level: 1 } },
  { id: 'industrial_red', body: 0x7e2a33, trim: 0x2b2b2b, accent: 0xd8c08a, roof: null, stripe: 'line', unlock: { level: 1 } },
  { id: 'midnight_black', body: 0x22252b, trim: 0xc0c6cc, accent: 0xc0c6cc, roof: 0x16181c, stripe: 'double', unlock: { level: 1 } },
  { id: 'silverline', body: 0xb9c0c8, trim: 0x2b3a55, accent: 0x3a78c2, roof: 0x7a828c, stripe: 'band', unlock: { level: 1 } },
  { id: 'golden_jubilee', body: 0xd4a62a, trim: 0x1f1f24, accent: 0x1f1f24, roof: 0x3a3226, stripe: 'double', unlock: { level: 1 } },
  { id: 'regional_red', body: 0xc23a2f, trim: 0xf0ede6, accent: 0xf0ede6, roof: 0x5e6268, stripe: 'band', unlock: { level: 1 } },
  { id: 'teal_modern', body: 0x2e9a8f, trim: 0xf0f0f0, accent: 0xf2d35a, roof: 0x3e4a52, stripe: 'band', unlock: { level: 1 } },
  { id: 'sunset_orange', body: 0xe07a3a, trim: 0x3a2f4a, accent: 0x3a2f4a, roof: null, stripe: 'double', unlock: { level: 25 } },
  { id: 'heritage_maroon', body: 0x5e2430, trim: 0xd9b45a, accent: 0xd9b45a, roof: 0x2a2a2e, stripe: 'line', unlock: { achievement: 'growing_town' } },
];
export const STATION_STYLES = [
  { id: 'classic', roof: 0x8a4a3a, wall: 0xe8dcc4, unlock: { level: 1 } },
  { id: 'brick', roof: 0x4a4f58, wall: 0xb0664a, unlock: { level: 5 } },
  { id: 'alpine_timber', roof: 0x5a3a2a, wall: 0xd8b888, unlock: { region: 'alpine_pass' } },
  { id: 'modern', roof: 0x3a8f8a, wall: 0xdfe6ea, unlock: { level: 18 } },
];
export const DECORATIONS = [
  { id: 'oak', cost: 5, unlock: { level: 1 } },
  { id: 'pine', cost: 5, unlock: { level: 1 } },
  { id: 'flowers', cost: 8, unlock: { level: 1 } },
  { id: 'bench', cost: 10, unlock: { level: 2 } },
  { id: 'lamp', cost: 12, unlock: { level: 2 } },
  { id: 'sign', cost: 10, unlock: { level: 3 } },
  { id: 'fence', cost: 6, unlock: { level: 3 } },
  { id: 'park', cost: 40, unlock: { level: 6 } },
  { id: 'fountain', cost: 80, unlock: { level: 10 } },
  { id: 'statue', cost: 150, unlock: { level: 20 } },
];

// ---------- ACHIEVEMENTS ----------
// stat: key into stats; target: number. rp: research reward.
export const ACHIEVEMENTS = [
  { id: 'first_departure', stat: 'trainsBought', target: 1, rp: 1 },
  { id: 'railway_rookie', stat: 'trackBuilt', target: 50, rp: 1 },
  { id: 'growing_town', stat: 'maxTownStage', target: 1, rp: 1 },
  { id: 'first_delivery', stat: 'deliveries', target: 1, rp: 0 },
  { id: 'busy_line', stat: 'deliveries', target: 500, rp: 2 },
  { id: 'freight_baron', stat: 'freightIncome', target: 100000, rp: 2 },
  { id: 'passenger_king', stat: 'passengers', target: 10000, rp: 2 },
  { id: 'industrial_revolution', stat: 'maxIndustryLevel', target: 3, rp: 2 },
  { id: 'electric_dreams', stat: 'electricTrains', target: 1, rp: 2 },
  { id: 'speed_demon', stat: 'topSpeed', target: 250, rp: 2 },
  { id: 'city_lights', stat: 'maxTownStage', target: 4, rp: 2 },
  { id: 'metropolis_builder', stat: 'maxTownStage', target: 6, rp: 3 },
  { id: 'rail_empire', stat: 'trackBuilt', target: 1000, rp: 3 },
  { id: 'bridge_builder', stat: 'bridgesBuilt', target: 10, rp: 1 },
  { id: 'tunnel_vision', stat: 'tunnelsBuilt', target: 5, rp: 1 },
  { id: 'collector', stat: 'modelsOwned', target: 8, rp: 2 },
  { id: 'explorer', stat: 'regionsUnlocked', target: 4, rp: 2 },
  { id: 'world_traveler', stat: 'regionsUnlocked', target: 8, rp: 3 },
  { id: 'researcher', stat: 'researchDone', target: 10, rp: 2 },
  { id: 'contractor', stat: 'contractsDone', target: 25, rp: 2 },
  { id: 'millionaire', stat: 'coinsEarned', target: 1000000, rp: 3 },
  { id: 'grand_terminal', stat: 'maxStationLevel', target: 5, rp: 2 },
  { id: 'fleet_commander', stat: 'trainsOwned', target: 20, rp: 2 },
  { id: 'railway_legend', stat: 'legend', target: 1, rp: 5 },
];

// ---------- REGION OBJECTIVES ----------
// type: stat (global stat >= n), townStage (any town in region >= n), industryLevel, delivered (cargo), stationLevel, connectTowns, chain
export const OBJECTIVES = {
  green_valley: [
    { id: 'gv_connect', type: 'connectTowns', n: 2 },
    { id: 'gv_wood', type: 'delivered', cargo: 'WOOD', n: 100 },
    { id: 'gv_trains', type: 'stat', stat: 'trainsOwned', n: 3 },
    { id: 'gv_station', type: 'stat', stat: 'maxStationLevel', n: 2 },
    { id: 'gv_village', type: 'townStage', n: 1 },
    { id: 'gv_pax', type: 'delivered', cargo: 'PASSENGERS', n: 150 },
  ],
  pine_highlands: [
    { id: 'ph_coal', type: 'delivered', cargo: 'COAL', n: 120 },
    { id: 'ph_bridge', type: 'stat', stat: 'bridgesBuilt', n: 1 },
    { id: 'ph_lumber', type: 'delivered', cargo: 'LUMBER', n: 100 },
    { id: 'ph_village', type: 'townStage', n: 1 },
    { id: 'ph_trains', type: 'stat', stat: 'trainsOwned', n: 5 },
  ],
  industrial_basin: [
    { id: 'ib_steel', type: 'delivered', cargo: 'STEEL', n: 150 },
    { id: 'ib_chain', type: 'delivered', cargo: 'GOODS', n: 100 },
    { id: 'ib_industry', type: 'industryLevel', n: 2 },
    { id: 'ib_town', type: 'townStage', n: 2 },
    { id: 'ib_station', type: 'stat', stat: 'maxStationLevel', n: 3 },
  ],
  golden_plains: [
    { id: 'gp_grain', type: 'delivered', cargo: 'GRAIN', n: 300 },
    { id: 'gp_food', type: 'delivered', cargo: 'FOOD', n: 400 },
    { id: 'gp_town', type: 'townStage', n: 2 },
    { id: 'gp_pax', type: 'delivered', cargo: 'PASSENGERS', n: 2000 },
    { id: 'gp_trains', type: 'stat', stat: 'trainsOwned', n: 10 },
  ],
  coastal_reach: [
    { id: 'cr_fuel', type: 'delivered', cargo: 'FUEL', n: 200 },
    { id: 'cr_goods', type: 'delivered', cargo: 'GOODS', n: 500 },
    { id: 'cr_town', type: 'townStage', n: 3 },
    { id: 'cr_bridges', type: 'stat', stat: 'bridgesBuilt', n: 8 },
    { id: 'cr_mail', type: 'delivered', cargo: 'MAIL', n: 1000 },
  ],
  desert_frontier: [
    { id: 'df_oil', type: 'delivered', cargo: 'OIL', n: 800 },
    { id: 'df_industry', type: 'industryLevel', n: 3 },
    { id: 'df_town', type: 'townStage', n: 3 },
    { id: 'df_machinery', type: 'delivered', cargo: 'MACHINERY', n: 300 },
    { id: 'df_trains', type: 'stat', stat: 'trainsOwned', n: 16 },
  ],
  alpine_pass: [
    { id: 'ap_tunnels', type: 'stat', stat: 'tunnelsBuilt', n: 4 },
    { id: 'ap_pax', type: 'delivered', cargo: 'PASSENGERS', n: 12000 },
    { id: 'ap_town', type: 'townStage', n: 4 },
    { id: 'ap_station', type: 'stat', stat: 'maxStationLevel', n: 4 },
    { id: 'ap_ore', type: 'delivered', cargo: 'ORE', n: 3000 },
  ],
  northern_snowfields: [
    { id: 'ns_steel', type: 'delivered', cargo: 'STEEL', n: 5000 },
    { id: 'ns_town', type: 'townStage', n: 5 },
    { id: 'ns_industry', type: 'industryLevel', n: 4 },
    { id: 'ns_speed', type: 'stat', stat: 'topSpeed', n: 300 },
    { id: 'ns_trains', type: 'stat', stat: 'trainsOwned', n: 25 },
  ],
};

export const LEGEND_REQ = { regions: 8, metropolises: 2, research: 'high_speed_rail', deliveries: 5000, level: 40 };

export const DAILY_POOL = [
  { id: 'd_deliveries', stat: 'deliveries', base: 25 },
  { id: 'd_passengers', stat: 'passengers', base: 100 },
  { id: 'd_track', stat: 'trackBuilt', base: 40 },
  { id: 'd_upgrades', stat: 'trainUpgrades', base: 2 },
  { id: 'd_income', stat: 'coinsEarned', base: 4000, scale: true },
  { id: 'd_contracts', stat: 'contractsDone', base: 2 },
];

export const OFFLINE = { maxSeconds: 4 * 3600, efficiency: 0.6 };
export const DAY_LENGTH = 720; // game seconds per full day
