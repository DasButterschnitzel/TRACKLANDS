#!/usr/bin/env node
// TRACKLANDS test runner.
//
//   node tests/run.mjs                 all suites (release gate)
//   node tests/run.mjs --quick         reduced sizes (for quick checks / CI)
//   node tests/run.mjs rail seeds      only the named suites
//   node tests/run.mjs fuzz --from=1 --to=60
//   node tests/run.mjs monkey --steps=800 --seeds=1,2 --modes=phone
//
// Suites: unit worldgen rail seeds fuzz prodsave economy persist import pwa tutorial savefuzz monkey ui perf gallery
// Needs Playwright's Chromium (npx playwright install chromium) or CHROMIUM_PATH.
import { startServer, launchBrowser } from './lib.mjs';
import * as unit from './suites/unit.mjs';
import * as rail from './suites/rail.mjs';
import { seeds, fuzz } from './suites/fuzz.mjs';
import * as prodsave from './suites/prodsave.mjs';
import * as persist from './suites/persist.mjs';
import * as importexport from './suites/importexport.mjs';
import * as tutorial from './suites/tutorial.mjs';
import * as savefuzz from './suites/savefuzz.mjs';
import * as monkey from './suites/monkey.mjs';
import * as ui from './suites/ui.mjs';
import * as perf from './suites/perf.mjs';
import * as gallery from './suites/gallery.mjs';
import * as economy from './suites/economy.mjs';
import * as pwa from './suites/pwa.mjs';
import * as worldgen from './suites/worldgen.mjs';
import * as build from './suites/build.mjs';
import * as finance from './suites/finance.mjs';
import * as authority from './suites/authority.mjs';
import * as towns from './suites/towns.mjs';
import * as crossings from './suites/crossings.mjs';
import * as roads from './suites/roads.mjs';
import * as audio from './suites/audio.mjs';
import * as industry from './suites/industry.mjs';
import * as weather from './suites/weather.mjs';
import * as news from './suites/news.mjs';
import * as stationtypes from './suites/stationtypes.mjs';
import * as transport from './suites/transport.mjs';
import * as mapsize from './suites/mapsize.mjs';
import * as company from './suites/company.mjs';
import * as scenarios from './suites/scenarios.mjs';
import * as rivals from './suites/rivals.mjs';
import * as touch from './suites/touch.mjs';
import * as buses from './suites/buses.mjs';
import * as overview from './suites/overview.mjs';
import * as traffic from './suites/traffic.mjs';
import * as cities from './suites/cities.mjs';
import * as chains from './suites/chains.mjs';
import * as rollingstock from './suites/rollingstock.mjs';
import * as stress from './suites/stress.mjs';
import * as audit from './suites/audit.mjs';
import * as network from './suites/network.mjs';

const ALL = [unit, worldgen, rail, seeds, fuzz, prodsave, economy, persist, importexport, pwa, tutorial, build, finance, authority, towns, crossings, roads, audio, industry, weather, news, stationtypes, transport, mapsize, company, scenarios, rivals, touch, buses, overview, traffic, cities, chains, rollingstock, stress, audit, network, savefuzz, monkey, ui, perf, gallery];
const argv = process.argv.slice(2);
const args = {};
const names = [];
for (const a of argv) {
  if (a.startsWith('--')) { const [k, v] = a.slice(2).split('='); args[k] = v === undefined ? true : v; } else names.push(a);
}
const quick = !!args.quick;
const suites = names.length ? ALL.filter((s) => names.includes(s.name)) : ALL;
if (names.length && suites.length !== names.length) { console.error('unknown suite in: ' + names.join(' ') + '\navailable: ' + ALL.map((s) => s.name).join(' ')); process.exit(2); }

const { server, url } = await startServer();
let browser = null;
const results = [];
for (const s of suites) {
  const t0 = Date.now();
  process.stdout.write(`\n▶ ${s.name}${quick ? ' (quick)' : ''}\n`);
  let r;
  try {
    if (s.name !== 'unit' && !s.nodeOnly && !browser) browser = await launchBrowser();
    r = await s.run({ browser, base: url, quick, args });
  } catch (e) {
    r = { ok: false, lines: ['EXCEPTION ' + (e && e.stack || e)] };
  }
  for (const l of r.lines) console.log('  ' + l);
  // isolation: a suite that stopped early may leave pages with a running game
  // behind; close them (and after an exception start a fresh browser) so they
  // cannot slow down or wedge the suites after it
  if (browser) {
    for (const c of browser.contexts()) await c.close().catch(() => {});
    if (!r.ok && r.lines.some((l) => l.startsWith('EXCEPTION'))) { await browser.close().catch(() => {}); browser = null; }
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`  ${r.ok ? 'PASS' : 'FAIL'} ${s.name} (${secs}s)`);
  results.push({ name: s.name, ok: r.ok, secs });
}
if (browser) await browser.close();
server.close();
console.log('\nSummary: ' + results.map((r) => `${r.ok ? '✓' : '✗'} ${r.name} ${r.secs}s`).join('   '));
process.exit(results.every((r) => r.ok) ? 0 : 1);
