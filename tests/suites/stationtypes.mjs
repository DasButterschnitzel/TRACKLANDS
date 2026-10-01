// Station service types (Stations.setService / serves) and layout types:
// a freight station stops taking the town's passengers and mail, a passenger
// station stops taking goods, both load 25 % faster, the town and industry
// supply follows; through / terminus / hybrid from the track layout; saved;
// the inspector buttons with the mouse and on a phone.
import { openPage, loadSave, productionSave } from '../lib.mjs';

export const name = 'stationtypes';
export async function run({ browser, base }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 1280, height: 800 } });
  await loadSave(page, productionSave());
  const r = await page.evaluate(async () => {
    const g = window.__tracklands.game, S = g.stations, out = {};
    const st = S.list.find((s) => s.links.towns.length && s.links.industries.length) || S.list.find((s) => s.links.towns.length);
    out.name = st.name;
    out.mixed = { pax: S.accepts(st, 'PASSENGERS'), rate: S.loadRate(st, []) };
    // freight only
    S.setService(st, 'freight');
    out.freight = { pax: S.accepts(st, 'PASSENGERS'), mail: S.accepts(st, 'MAIL'), paxStock: st.stock.PASSENGERS || 0, rate: S.loadRate(st, []), kind: S.stationKind(st).kind };
    const p0 = st.stock.PASSENGERS || 0;
    for (let i = 0; i < 30 * 40; i++) g.tick(1 / 30);
    out.freight.paxAfter = (st.stock.PASSENGERS || 0) - p0;
    out.freight.inds = st.links.industries.length;
    out.freight.goodsIn = Object.keys(st.stock).filter((c) => c !== 'PASSENGERS' && c !== 'MAIL').reduce((a, c) => a + st.stock[c], 0) + st.picked;
    // passengers only
    S.setService(st, 'passenger');
    const goods = [...st.supplies].filter((c) => c !== 'PASSENGERS' && c !== 'MAIL');
    const fr0 = Object.keys(st.stock).filter((c) => c !== 'PASSENGERS' && c !== 'MAIL').reduce((a, c) => a + st.stock[c], 0);
    for (let i = 0; i < 30 * 40; i++) g.tick(1 / 30);
    const fr1 = Object.keys(st.stock).filter((c) => c !== 'PASSENGERS' && c !== 'MAIL').reduce((a, c) => a + st.stock[c], 0);
    out.passenger = { goods, fr0, fr1, pax: S.accepts(st, 'PASSENGERS') };
    // layout types
    const saved = st.layout;
    st.layout = [{ deadEnd: [false, false] }, { deadEnd: [false, false] }]; out.l1 = S.layoutType(st);
    st.layout = [{ deadEnd: [false, true] }, { deadEnd: [true, false] }]; out.l2 = S.layoutType(st);
    st.layout = [{ deadEnd: [false, true] }, { deadEnd: [false, false] }]; out.l3 = S.layoutType(st);
    st.layout = saved;
    out.real = S.list.map((s) => S.layoutType(s));
    // save / load
    const Sv = await import('./src/save/Save.js');
    const d = Sv.migrate(JSON.parse(JSON.stringify(g.serialize())));
    out.valid = Sv.validate(d) === null;
    window.__stsave = d;
    window.__stid = st.id;
    return out;
  });
  check(r.mixed.pax, `${r.name} starts mixed and takes passengers`);
  check(!r.freight.pax && !r.freight.mail && r.freight.paxStock === 0 && r.freight.paxAfter === 0 && r.freight.kind !== 'village' && r.freight.rate > r.mixed.rate * 1.2, `freight only: no passengers or mail, loads faster, freight building (${JSON.stringify(r.freight)})`);
  check((!r.freight.inds || r.freight.goodsIn > 0) && r.passenger.pax && r.passenger.goods.length === 0 && r.passenger.fr1 === 0, `goods arrive while freight-only (${r.freight.goodsIn}, ${r.freight.inds} industries); passengers only: no goods (${JSON.stringify(r.passenger)})`);
  check(r.l1 === 'through' && r.l2 === 'terminus' && r.l3 === 'hybrid' && r.real.every((x) => ['through', 'terminus', 'hybrid'].includes(x)), `layout types: ${r.l1}, ${r.l2}, ${r.l3}; save: ${[...new Set(r.real)].join(', ')}`);
  check(r.valid, 'the save validates');
  await loadSave(page, await page.evaluate(() => window.__stsave));
  const back = await page.evaluate(() => { const g = window.__tracklands.game, s = g.stations.byId(window.__stid); return { sv: s.service, pax: g.stations.accepts(s, 'PASSENGERS') }; });
  check(back.sv === 'passenger' && back.pax, `the service type is saved (${JSON.stringify(back)})`);
  // inspector with the mouse
  await page.evaluate(() => window.__tracklands.game.select({ type: 'station', id: window.__stid }));
  await page.waitForTimeout(400);
  const btn = await page.$('#inspector [data-act=stService][data-arg$=":mixed"]');
  if (btn) { await btn.scrollIntoViewIfNeeded(); await btn.click(); await page.waitForTimeout(300); }
  const sv = await page.evaluate(() => window.__tracklands.game.stations.byId(window.__stid).service || 'mixed');
  const pressed = await page.$eval('#inspector [data-act=stService][data-arg$=":mixed"]', (b) => b.getAttribute('aria-pressed'));
  check(!!btn && sv === 'mixed' && pressed === 'true', 'the station panel switches the service with a click');
  // the new overlays draw something on the production save
  await page.click('[data-act=overlayMenu]');
  await page.waitForTimeout(200);
  const ov = {};
  for (const m of ['towns', 'ratings', 'industry']) {
    if (!(await page.$('#overlay-menu:not([hidden])'))) await page.click('[data-act=overlayMenu]');
    await page.click(`#overlay-menu [data-act=overlay][data-arg=${m}]`);
    // overlays redraw on the frame loop (every 0.3 s): wait for the first draw
    ov[m] = await page.waitForFunction((mode) => { const O = window.__tracklands.game.overlays; const n = O.quads.count + O.cols.count; return O.mode === mode && n > 0 ? n : false; }, m, { polling: 100, timeout: 10000 }).then((h) => h.jsonValue()).catch(() => 0);
    await page.evaluate(() => window.__tracklands.game.overlays.set(null));
  }
  // the rail graph of the production save is sound; the track check overlay draws
  const gv = await page.evaluate(() => { const g = window.__tracklands.game; g.overlays.set('trackcheck'); g.overlays._t = 0; g.overlays.update(1); const n = g.overlays.quads.count; g.overlays.set(null); return { graph: g.net.validateGraph(50), headings: g.trains.validateHeadings(), notes: g.net.validateGraph(50, true).length, drawn: n }; });
  check(gv.graph.length === 0 && gv.headings.length === 0 && gv.drawn >= gv.notes, `production save: rail graph sound, train paths continuous; track check shows ${gv.notes} notes (${JSON.stringify(gv.graph.slice(0, 2))} ${JSON.stringify(gv.headings.slice(0, 2))})`);
  check(ov.towns > 0 && ov.ratings > 0 && ov.industry > 0, `town, rating and industry overlays draw (${JSON.stringify(ov)})`);
  if (errors.length) { ok = false; lines.push('errors: ' + errors.slice(0, 2).join(' | ')); }
  await ctx.close();
  // phone
  const ph = await openPage(browser, base, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await loadSave(ph.page, productionSave());
  const id = await ph.page.evaluate(() => { const g = window.__tracklands.game, s = g.stations.list[0]; g.select({ type: 'station', id: s.id }); return s.id; });
  await ph.page.waitForTimeout(400);
  const pb = await ph.page.$('#inspector [data-act=stService][data-arg$=":freight"]');
  if (pb) { await pb.scrollIntoViewIfNeeded(); await pb.tap(); await ph.page.waitForTimeout(300); }
  const psv = await ph.page.evaluate((i) => window.__tracklands.game.stations.byId(i).service, id);
  check(!!pb && psv === 'freight', 'phone: tapping sets the service');
  if (ph.errors.length) { ok = false; lines.push('errors: ' + ph.errors.slice(0, 2).join(' | ')); }
  await ph.ctx.close();
  return { ok, lines };
}
