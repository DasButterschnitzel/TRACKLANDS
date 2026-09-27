// Company ownership (Phase 9). Every track tile, station, depot, train, road
// stop and road vehicle belongs to the player (no owner) or to a rival
// company ('r1' … 'r8'). The owner index is the number in the id; the rail
// network stores it per tile (RailNetwork.own). Companies never build on,
// through or into each other's infrastructure.
export const OWNER_RE = /^r[1-8]$/;
export function validOwner(o) { return typeof o === 'string' && OWNER_RE.test(o); }
export function ownerIdx(o) { return validOwner(o) ? +o.slice(1) : 0; }
// the player's own objects (trains, stations, depots, stops, vehicles)
export const mine = (o) => !o.owner;
// no bonuses at all: a rival's trains never get the player's research or upgrades
export const NO_FX = new Proxy({}, { get: () => 0 });
