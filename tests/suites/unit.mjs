// Node-only checks of the save pipeline (no browser): migration idempotency on
// the production fixture, sanitizer no-op on valid data, repair of damage.
import { productionSave } from '../lib.mjs';

export const name = 'unit';
export async function run() {
  const S = await import('../../src/save/Save.js');
  const lines = [];
  let ok = true;
  const check = (cond, msg) => { lines.push((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) ok = false; };

  const raw = productionSave();
  check(raw.saveVersion === 2, 'fixture is a v2 save (TRKL1 export)');
  const a = S.migrate(JSON.parse(JSON.stringify(raw)));
  check(!!a && S.validate(a) === null, 'production save migrates and validates');
  const once = JSON.stringify(a);
  check(JSON.stringify(S.migrate(JSON.parse(once))) === once, 'migrate() is idempotent');
  const plain = JSON.parse(JSON.stringify(raw)); S.migrateV2toV3(plain); plain.saveVersion = a.saveVersion;
  check(JSON.stringify(plain) === once, 'sanitizer leaves the valid production save unchanged');
  check(a.trains.map((t) => t.name).join(',') === raw.trains.map((t) => t.name).join(','), 'train names preserved: ' + a.trains.map((t) => t.name).join(', '));
  check(a.economy.coins === raw.economy.coins, 'coins preserved (' + raw.economy.coins + ')');
  check(a.progression.level === raw.progression.level && a.progression.research.length === raw.progression.research.length, 'level and research preserved');

  // regression (savefuzz case 290): train entries that are not objects in a v2 save
  const junk = JSON.parse(JSON.stringify(raw)); junk.trains.splice(1, 0, 1e15, 'x', true);
  let jr = null; try { jr = S.migrate(junk); } catch (e) { jr = e; }
  check(jr && !(jr instanceof Error) && S.validate(jr) === null, 'v2 save with non-object train entries migrates' + (jr instanceof Error ? ': ' + jr.message : ''));

  // damage repair
  const d = JSON.parse(once);
  d.stations.stations.push(null); d.stations.stations[0].stock.PASSENGERS = true;
  d.trains[0].name = { x: 1 }; d.trains[0].upg.engine = 'fast'; d.trains[0].cargo.push({ c: 'WOOD', n: 'lots' });
  d.towns.push(null); d.towns[0].stage = 1e9; d.economy.coins = 'x'; d.industries[0].out = { WOOD: {} };
  const r = S.migrate(d);
  check(!!r && S.validate(r) === null, 'damaged save repairs and validates');
  check(r.stations.stations.every(Boolean) && Number.isFinite(r.stations.stations[0].stock.PASSENGERS ?? 0), 'broken station entries dropped / stock coerced');
  check(typeof r.trains[0].name === 'string' && r.trains[0].upg.engine === 0 && r.trains[0].cargo.every((l) => Number.isFinite(l.n)), 'train name, upgrades and cargo repaired');
  check(r.towns.every(Boolean) && r.towns[0].stage <= 6 && r.economy.coins === 0, 'towns clamped, coins repaired');
  check(JSON.stringify(S.migrate(JSON.parse(JSON.stringify(r)))) === JSON.stringify(r), 'repair is idempotent');

  // genuinely invalid imports are rejected
  check(S.migrate(null) === null && S.migrate({ saveVersion: 0 }) === null, 'non-saves are rejected by migrate()');
  const noNet = JSON.parse(once); delete noNet.net;
  check(S.validate(noNet) === 'err_save_invalid', 'save without rail network is rejected by validate()');
  check(S.importText('TRKL1:%%%') === null && S.importText('{broken') === null, 'malformed import text returns null');
  // the offline cache must list exactly the shipped files (tools/build-sw.mjs)
  // liveries: tokens round-trip, bad ones are rejected, vehicles keep their own colours
  const Lv = await import('../../src/trains/Livery.js');
  const Cn = await import('../../src/trains/Consist.js');
  const tok = Lv.customToken({ body: 0x123456, trim: 0xabcdef, accent: null, roof: 0x222222, stripe: 'band' });
  check(Lv.validToken(tok) === tok && Lv.parseCustom(tok).roof === 0x222222 && Lv.parseCustom(tok).accent === null, 'custom livery token round-trips');
  check(Lv.validToken('royal_blue') === 'royal_blue' && Lv.validToken('c.zz.00.-.-.x') === null && Lv.validToken(42) === null, 'livery tokens are validated');
  const cons = Cn.parseConsist(['L:pioneer@royal_blue', 'W:coach:r@' + tok, 'W:coach@bogus']);
  check(cons.length === 3 && cons[0].lv === 'royal_blue' && cons[1].lv === tok && cons[1].r && !cons[2].lv && Cn.serializeConsist(cons).join() === ['L:pioneer@royal_blue', 'W:coach:r@' + tok, 'W:coach'].join(), 'per-vehicle liveries survive consist serialization');
  const st1 = Cn.computeStats(cons, null, {}), st2 = Cn.computeStats(Cn.parseConsist(['L:pioneer', 'W:coach:r', 'W:coach']), null, {});
  check(JSON.stringify(st1) === JSON.stringify(st2), 'liveries never change train statistics');
  const { buildServiceWorker } = await import('../../tools/build-sw.mjs');
  const fs = await import('fs');
  check(fs.readFileSync('service-worker.js', 'utf8') === buildServiceWorker(), 'service-worker.js is up to date (node tools/build-sw.mjs)');
  return { ok, lines };
}
