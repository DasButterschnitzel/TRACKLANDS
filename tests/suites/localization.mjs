// Localization QA (Phase 13), deterministic and offline: every key in both
// languages with the same placeholders; every key the code asks for exists;
// the mechanical translation checks (numbers, units, negation, text left in
// English, the formal register) pass on the whole dictionary and catch the
// mechanical defects of the calibration set without false alarms; the
// optional semantic review reports NOT EXECUTED without a key, sends only
// key/English/German to the service, caches by hash and never edits a
// translation (checked against a local stand-in service); no API key name
// appears in anything the game ships; a German session shows no raw keys.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openPage, startTestGame } from '../lib.mjs';

export const name = 'localization';
// asynchronous: the stand-in service below runs in this process
const node = (args, env) => new Promise((ok, no) => execFile('node', args, { cwd: ROOT, env }, (e, out) => (e ? no(e) : ok(out))));
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

export async function run({ browser, base }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  const I = await import(path.join(ROOT, 'src/i18n.js'));
  const L = await import(path.join(ROOT, 'tools/i18n-lint.mjs'));
  const R = await import(path.join(ROOT, 'tools/i18n-review.mjs'));
  const en = I.keysOf('en'), de = I.keysOf('de');

  // parity and placeholders
  const onlyEn = en.filter((k) => I.rawIn('de', k) == null), onlyDe = de.filter((k) => I.rawIn('en', k) == null);
  check(!onlyEn.length && !onlyDe.length, `${en.length} English and ${de.length} German keys, none in only one language${onlyEn.length + onlyDe.length ? ': ' + [...onlyEn, ...onlyDe].slice(0, 8).join(', ') : ''}`);
  const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  const phBad = en.filter((k) => ph(I.rawIn('en', k)) !== ph(I.rawIn('de', k)));
  check(!phBad.length, `placeholders match in every key${phBad.length ? ': ' + phBad.slice(0, 8).join(', ') : ''}`);

  // every literal key the code asks for exists (prefix lookups like 'era_' + id are covered by qa)
  const keys = new Set(en), asked = new Map();
  for (const f of walk(path.join(ROOT, 'src')).filter((f) => f.endsWith('.js') && !/i18n/.test(f))) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/\b(?:tr|t)\(\s*'([a-z0-9_]+)'/g)) if (!m[1].endsWith('_') && !keys.has(m[1])) asked.set(m[1], path.basename(f));
  }
  check(!asked.size, `every key named in the code exists${asked.size ? ': ' + [...asked].slice(0, 8).map((x) => x.join(' in ')).join(', ') : ''}`);

  // mechanical checks on the whole dictionary
  const found = en.map((k) => [k, L.lintPair(k, I.rawIn('en', k), I.rawIn('de', k), { allowSame: R.SAME_OK.has(k) })]).filter(([k, r]) => r.length && !R.LINT_OK[k]);
  check(!found.length, `mechanical checks (placeholders, numbers, units, negation, English left in German, formal register) pass on all keys${found.length ? ': ' + found.slice(0, 6).map(([k, r]) => k + ' ' + r.join('+')).join(', ') : ''}`);
  // … and they are worth something: calibration
  const cal = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/i18n-calibration.json'), 'utf8')).pairs;
  const flagged = new Set(cal.filter((p) => L.lintPair(p.key, p.en, p.de, { allowSame: !p.bad && p.en === p.de }).length).map((p) => p.key));
  const s = L.score(cal, flagged);
  const mech = ['negation lost', 'number changed', 'placeholder renamed', 'placeholder dropped', 'untranslated', 'register (the game uses du)', 'unit changed'];
  const mechMissed = cal.filter((p) => p.bad && mech.includes(p.defect) && !flagged.has(p.key)).map((p) => p.key);
  check(cal.filter((p) => p.bad).length >= 20 && s.fp === 0 && !mechMissed.length, `calibration (${cal.filter((p) => p.bad).length} known-bad, ${cal.filter((p) => !p.bad).length} good pairs): mechanical checks precision ${s.precision.toFixed(2)}, recall ${s.recall.toFixed(2)} — every mechanical defect caught, meaning errors are left to the semantic review${mechMissed.length ? '; missed ' + mechMissed.join(', ') : ''}`);

  // the optional semantic review
  const dictHash = () => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'src/i18n.js')) + fs.readFileSync(path.join(ROOT, 'src/i18n_rail.js'))).digest('hex');
  const h0 = dictHash();
  const tmp = fs.mkdtempSync(path.join(ROOT, 'tests/output/i18n-'));
  const env0 = { ...process.env }; delete env0.TYPESAFE_API_KEY; delete env0.TYPESAFE_API_URL;
  const off = await node(['tools/i18n-review.mjs', '--out', path.join(tmp, 'off.json')], env0);
  check(off.includes(R.NOT_CONFIGURED) && JSON.parse(fs.readFileSync(path.join(tmp, 'off.json'))).state === R.NOT_CONFIGURED, `without a key: "${R.NOT_CONFIGURED}", offline checks still reported`);
  // a local stand-in service: flags exactly the known-bad calibration pairs, records what it receives
  const bad = new Set(cal.filter((p) => p.bad).map((p) => p.key));
  const seen = { requests: 0, pairs: 0, fields: new Set(), auth: new Set(), keys: new Set() };
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const j = JSON.parse(body);
      seen.requests++; seen.auth.add(req.headers.authorization);
      for (const p of j.pairs) { seen.pairs++; seen.keys.add(p.key); for (const f of Object.keys(p)) seen.fields.add(f); }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ results: j.pairs.map((p) => (bad.has(p.key) ? { key: p.key, ok: false, issue: 'meaning differs' } : { key: p.key, ok: true })) }));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const envOn = { ...env0, TYPESAFE_API_KEY: 'ci-test-key', TYPESAFE_API_URL: `http://127.0.0.1:${srv.address().port}/review` };
  fs.rmSync(path.join(ROOT, '.cache/i18n-review'), { recursive: true, force: true });
  const run1 = await node(['tools/i18n-review.mjs', '--out', path.join(tmp, 'on.json')], envOn);
  const rep1 = JSON.parse(fs.readFileSync(path.join(tmp, 'on.json')));
  const sent1 = seen.pairs;
  const run2 = await node(['tools/i18n-review.mjs', '--out', path.join(tmp, 'on2.json')], envOn);
  const rep2 = JSON.parse(fs.readFileSync(path.join(tmp, 'on2.json')));
  srv.close();
  check(rep1.state === 'EXECUTED' && rep1.semantic.calibration.recall === 1 && rep1.semantic.calibration.precision === 1, `with a key: the review runs and reports its calibration (precision ${rep1.semantic && rep1.semantic.calibration.precision}, recall ${rep1.semantic && rep1.semantic.calibration.recall}) — ${run1.split('\n').find((l) => l.startsWith('EXECUTED')) || run1.slice(0, 120)}`);
  check([...seen.fields].sort().join(',') === 'de,en,key' && seen.auth.size === 1 && [...seen.auth][0] === 'Bearer ci-test-key', `only key, English and German are sent (fields: ${[...seen.fields].sort().join(', ')}); the key travels only in the request header`);
  check(sent1 === en.length + cal.length && rep2.semantic.sent === 0 && rep2.semantic.cached === sent1, `answers are cached by hash: first run sent ${sent1} pairs, the second ${rep2.semantic.sent} (${rep2.semantic.cached} from cache)`);
  check(dictHash() === h0 && /report only/.test(run2), 'report only: the dictionaries are unchanged after a review with findings');
  fs.rmSync(tmp, { recursive: true, force: true });

  // the key's name appears nowhere the game ships
  const shipped = [...['src', 'styles', 'assets', 'icons'].flatMap((d) => walk(path.join(ROOT, d))), ...['index.html', 'manifest.json', 'service-worker.js'].map((f) => path.join(ROOT, f))]
    .filter((f) => /\.(js|mjs|json|html|css|txt|webmanifest)$/.test(f));
  const leak = shipped.filter((f) => /TYPESAFE|i18n-review|Bearer /.test(fs.readFileSync(f, 'utf8')));
  check(!leak.length && shipped.length > 100, `${shipped.length} shipped files carry no review key, endpoint or tool${leak.length ? ': ' + leak.map((f) => path.relative(ROOT, f)).join(', ') : ''}`);

  // German in the running game: no raw keys, nothing missing
  const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 1200, height: 800 } });
  await startTestGame(page, 3131);
  const g = await page.evaluate(async () => {
    const app = window.__tracklands, ui = app.ui, I = await import('./src/i18n.js');
    app.setSetting('lang', 'de');
    I.missing.clear();
    const raw = [];
    for (const p of ['finance', 'collection', 'trains', 'research', 'company', 'news', 'lists', 'plans', 'map', 'settings', 'handbook', 'contracts', 'objectives', 'search']) {
      try { ui.openPanel(p); ui.refreshPanel(); } catch (e) { raw.push(p + ': ' + e.message); continue; }
      const txt = document.querySelector('#panel') ? document.querySelector('#panel').innerText : '';
      for (const m of txt.matchAll(/(^|\s)([a-z]+_[a-z0-9_]+)(?=\s|$)/g)) raw.push(p + ': ' + m[2]);
      ui.closePanel();
    }
    const hud = document.body.innerText;
    for (const m of hud.matchAll(/(^|\s)([a-z]+_[a-z0-9_]+)(?=\s|$)/g)) raw.push('hud: ' + m[2]);
    const r = { raw, missing: [...I.missing], lang: document.documentElement.lang };
    app.setSetting('lang', 'en');
    return r;
  });
  check(g.lang === 'de' && !g.raw.length && !g.missing.length, `German session: 14 panels and the HUD show no raw keys, none missing (lang ${g.lang})${g.raw.length ? ': ' + g.raw.slice(0, 6).join(', ') : ''}${g.missing.length ? '; missing ' + g.missing.slice(0, 6).join(', ') : ''}`);
  if (errors.length) { ok = false; lines.push('errors: ' + errors.slice(0, 3).join(' | ')); }
  await ctx.close();
  return { ok, lines };
}
