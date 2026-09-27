#!/usr/bin/env node
// Fast static gate (runs before any browser starts, in seconds):
//   1. service-worker.js is current (else: run `node tools/build-sw.mjs`)
//   2. every JS module parses (node --check)
//   3. every relative import points at an existing file
//   4. every JSON file in the repo parses
// Exit code 1 with a clear message on the first class of problem found.
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { buildServiceWorker } from './build-sw.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const t0 = Date.now();

// 1. service worker
const sw = fs.readFileSync(path.join(ROOT, 'service-worker.js'), 'utf8');
if (sw !== buildServiceWorker()) problems.push('service-worker.js is stale: run `node tools/build-sw.mjs` and commit the result');

// files
function walk(dir, exts, out = []) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.posix.join(dir, e.name);
    if (e.name === 'node_modules' || e.name === 'output' || e.name === 'dbg' || e.name.startsWith('.')) continue;
    if (e.isDirectory()) walk(rel, exts, out);
    else if (exts.some((x) => e.name.endsWith(x))) out.push(rel);
  }
  return out;
}
const modules = [...walk('src', ['.js']), ...walk('tests', ['.mjs']), ...walk('tools', ['.mjs']), 'service-worker.js'];

// 2. syntax
for (const f of modules) {
  try { execFileSync(process.execPath, ['--check', path.join(ROOT, f)], { stdio: 'pipe' }); } catch (e) { problems.push(`syntax: ${f}\n${String(e.stderr || e.message).split('\n').slice(0, 5).join('\n')}`); }
}

// 3. relative imports
const IMPORT = /(?:import|export)\s[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)['"]|import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;
for (const f of modules) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const m of src.matchAll(IMPORT)) {
    const spec = m[1] || m[2];
    // browser-side dynamic imports in tests are relative to the page, not the file
    if (m[2] && f.startsWith('tests/')) continue;
    const target = path.join(path.dirname(path.join(ROOT, f)), spec);
    if (!fs.existsSync(target)) problems.push(`import: ${f} → ${spec} (missing)`);
  }
}

// 4. JSON
for (const f of [...walk('assets', ['.json']), ...walk('tests', ['.json']), 'manifest.json', 'package.json']) {
  try { JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')); } catch (e) { problems.push(`json: ${f}: ${e.message}`); }
}

if (problems.length) {
  console.error(`✗ static check: ${problems.length} problem(s)\n\n` + problems.join('\n\n'));
  process.exit(1);
}
console.log(`✓ static check: service worker current, ${modules.length} modules parse, imports resolve, JSON valid (${Date.now() - t0} ms)`);
