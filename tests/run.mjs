#!/usr/bin/env node
// TRACKLANDS test runner.
//
//   node tests/run.mjs                 all suites (release gate)
//   node tests/run.mjs --quick         reduced sizes (for quick checks / CI)
//   node tests/run.mjs rail seeds      only the named suites
//   node tests/run.mjs fuzz --from=1 --to=60
//   node tests/run.mjs monkey --steps=800 --seeds=1,2 --modes=phone
//
// Suites: unit rail seeds fuzz prodsave persist import tutorial savefuzz monkey ui perf
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

const ALL = [unit, rail, seeds, fuzz, prodsave, persist, importexport, tutorial, savefuzz, monkey, ui, perf];
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
    if (s.name !== 'unit' && !browser) browser = await launchBrowser();
    r = await s.run({ browser, base: url, quick, args });
  } catch (e) {
    r = { ok: false, lines: ['EXCEPTION ' + (e && e.stack || e)] };
  }
  for (const l of r.lines) console.log('  ' + l);
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`  ${r.ok ? 'PASS' : 'FAIL'} ${s.name} (${secs}s)`);
  results.push({ name: s.name, ok: r.ok, secs });
}
if (browser) await browser.close();
server.close();
console.log('\nSummary: ' + results.map((r) => `${r.ok ? '✓' : '✗'} ${r.name} ${r.secs}s`).join('   '));
process.exit(results.every((r) => r.ok) ? 0 : 1);
