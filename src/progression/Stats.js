// World statistics counters.
export class Stats {
  constructor(game) {
    this.game = game;
    this.data = Stats.blank();
  }
  static blank() {
    return {
      trackBuilt: 0, trackRemoved: 0, stationsBuilt: 0, trainsBought: 0, deliveries: 0, passengers: 0, cargoUnits: 0,
      coinsEarned: 0, coinsSpent: 0, freightIncome: 0, longestRoute: 0, topSpeed: 0, bridgesBuilt: 0, tunnelsBuilt: 0,
      maxTownStage: 0, maxIndustryLevel: 0, maxStationLevel: 1, trainUpgrades: 0, contractsDone: 0, researchDone: 0,
      regionsUnlocked: 1, modelsOwned: 0, trainsOwned: 0, electricTrains: 0, townLevelUps: 0, playTime: 0, legend: 0, paxTransfers: 0, overtakes: 0, cargoTransfers: 0, multiLeg: 0, mostLegs: 0,
      cargo: {},
    };
  }
  inc(k, n = 1) { this.data[k] = (this.data[k] || 0) + n; }
  set(k, v) { this.data[k] = v; }
  max(k, v) { if (v > (this.data[k] || 0)) this.data[k] = v; }
  incCargo(c, n) { this.data.cargo[c] = (this.data.cargo[c] || 0) + n; }
  serialize() { return this.data; }
  deserialize(d) {
    const b = Stats.blank();
    if (d && typeof d === 'object') for (const k in b) if (k === 'cargo') { if (d.cargo && typeof d.cargo === 'object') b.cargo = { ...d.cargo }; } else if (typeof d[k] === 'number' && isFinite(d[k])) b[k] = d[k];
    this.data = b;
  }
}
