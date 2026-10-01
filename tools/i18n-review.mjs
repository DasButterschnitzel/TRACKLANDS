// Optional semantic translation review (Phase 13) — CI only, report only.
//
// A language service reads English/German pairs and points out translations
// whose meaning is off (a railway "Signal" rendered as "Zeichen", a lost
// "not", a reversed "repaid"). It never edits a translation: findings go to
// a report for a person to judge.
//
//   TYPESAFE_API_KEY  the service key — a CI secret, never in the game, the
//                     service worker, a save, a content pack or any shipped file
//   TYPESAFE_API_URL  the service endpoint (POST JSON, see below)
//
// Without both it prints "NOT EXECUTED: LANGUAGE SEMANTIC REVIEW NOT
// CONFIGURED" and only runs the offline checks (tools/i18n-lint.mjs).
//
// Sent: only { key, en, de } for dictionary keys and the calibration pairs.
// Never a save, player data, search terms or anything from a running game.
// Request  { pairs: [{ key, en, de }], context: "railway tycoon game UI; German uses du" }
// Response { results: [{ key, ok: boolean, issue?: string, suggestion?: string }] }
//
// Calibration: tests/fixtures/i18n-calibration.json holds known-bad and good
// pairs; the service's precision and recall on them are reported first, so a
// reviewer that flags everything (or nothing) is visible as such.
// Cache: answers are kept by a hash of key+en+de in .cache/i18n-review, so
// unchanged text is not sent again.
//
//   node tools/i18n-review.mjs [--out tests/output/i18n-review.json]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { lintPair, score } from './i18n-lint.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const outPath = path.resolve(ROOT, args.includes('--out') ? args[args.indexOf('--out') + 1] : 'tests/output/i18n-review.json');
const CACHE = path.join(ROOT, '.cache', 'i18n-review');
const KEY = process.env.TYPESAFE_API_KEY || '', URL_ = process.env.TYPESAFE_API_URL || '';
export const NOT_CONFIGURED = 'NOT EXECUTED: LANGUAGE SEMANTIC REVIEW NOT CONFIGURED';
// same text in both languages on purpose (names, loanwords)
export const SAME_OK = new Set(['slvl_4', 'ach_grand_terminal']);
// reviewed by hand: the lint's guess is wrong here
export const LINT_OK = { role_p_through: 'negation: "Durchfahrt" is the German term for a non-stop pass' };

const hash = (p) => crypto.createHash('sha256').update(`${p.key}\u0000${p.en}\u0000${p.de}`).digest('hex').slice(0, 32);

async function ask(pairs) {
  const res = await fetch(URL_, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ pairs: pairs.map(({ key, en, de }) => ({ key, en, de })), context: 'railway tycoon game UI; German uses du' }),
  });
  if (!res.ok) throw new Error(`service answered ${res.status}`);
  const j = await res.json();
  return new Map((j.results || []).map((r) => [r.key, r]));
}
async function review(pairs) {
  fs.mkdirSync(CACHE, { recursive: true });
  const out = new Map(), todo = [];
  for (const p of pairs) {
    const f = path.join(CACHE, hash(p) + '.json');
    if (fs.existsSync(f)) out.set(p.key, JSON.parse(fs.readFileSync(f, 'utf8'))); else todo.push(p);
  }
  for (let i = 0; i < todo.length; i += 40) {
    const part = todo.slice(i, i + 40), got = await ask(part);
    for (const p of part) {
      const r = got.get(p.key) || { key: p.key, ok: true, missing: true };
      out.set(p.key, r);
      if (!r.missing) fs.writeFileSync(path.join(CACHE, hash(p) + '.json'), JSON.stringify(r));
    }
  }
  return { out, sent: todo.length, cached: pairs.length - todo.length };
}

async function main() {
  const I = await import(path.join(ROOT, 'src/i18n.js'));
  const dict = I.keysOf('en').map((key) => ({ key, en: I.rawIn('en', key), de: I.rawIn('de', key) })).filter((p) => typeof p.en === 'string');
  const cal = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/i18n-calibration.json'), 'utf8')).pairs;
  const report = { at: new Date().toISOString(), keys: dict.length, state: '', lint: {}, semantic: null };
  // offline checks: always
  const lintCal = new Set(cal.filter((p) => lintPair(p.key, p.en, p.de, { allowSame: !p.bad && p.en === p.de }).length).map((p) => p.key));
  report.lint.calibration = score(cal, lintCal);
  report.lint.findings = dict.map((p) => ({ key: p.key, issues: lintPair(p.key, p.en, p.de, { allowSame: SAME_OK.has(p.key) }) }))
    .filter((f) => f.issues.length && !LINT_OK[f.key]);
  const c = report.lint.calibration;
  console.log(`offline checks: ${report.lint.findings.length} findings in ${dict.length} keys; calibration precision ${c.precision.toFixed(2)}, recall ${c.recall.toFixed(2)} (mechanical defects only)`);
  if (!KEY || !URL_) {
    report.state = NOT_CONFIGURED;
    console.log(NOT_CONFIGURED + (KEY && !URL_ ? ' (TYPESAFE_API_URL not set)' : ''));
  } else {
    try {
      const calR = await review(cal);
      const flagged = new Set([...calR.out].filter(([, r]) => !r.ok).map(([k]) => k));
      const s = score(cal, flagged);
      const dr = await review(dict);
      report.semantic = {
        calibration: s, sent: calR.sent + dr.sent, cached: calR.cached + dr.cached,
        findings: [...dr.out].filter(([, r]) => !r.ok).map(([key, r]) => ({ key, en: I.rawIn('en', key), de: I.rawIn('de', key), issue: r.issue || '', suggestion: r.suggestion || '' })),
      };
      report.state = s.recall >= 0.8 && s.precision >= 0.8 ? 'EXECUTED' : 'EXECUTED: CALIBRATION BELOW 0.8 — FINDINGS UNRELIABLE';
      console.log(`${report.state}: calibration precision ${s.precision.toFixed(2)}, recall ${s.recall.toFixed(2)}; ${report.semantic.findings.length} findings; ${report.semantic.sent} pairs sent, ${report.semantic.cached} from cache`);
      for (const f of report.semantic.findings.slice(0, 50)) console.log(`  ${f.key}: ${f.issue}${f.suggestion ? ` → ${f.suggestion}` : ''}`);
    } catch (e) {
      report.state = 'NOT EXECUTED: LANGUAGE SEMANTIC REVIEW FAILED — ' + e.message;
      console.log(report.state);
    }
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 1));
  console.log('report: ' + path.relative(ROOT, outPath) + ' (report only; no translation was changed)');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
