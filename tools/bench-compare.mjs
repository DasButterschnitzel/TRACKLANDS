// Benchmark against a control revision in the same environment (Phase 13).
// Runs tests/suites/bench.mjs on a control revision (default: the release
// named in tests/perf-baseline.json "control", else HEAD~1) in a temporary
// git worktree, then on the working tree with BENCH_CONTROL pointing at the
// control's results, so each world reports PASS / ABSOLUTE TARGET MISS, NO
// REGRESSION / REGRESSION / ENVIRONMENT INVALID.
//   node tools/bench-compare.mjs [--control=<rev>]
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const arg = process.argv.find((a) => a.startsWith('--control='));
const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'perf-baseline.json'), 'utf8'));
const control = arg ? arg.split('=')[1] : base.control || 'HEAD~1';
const rev = execSync(`git rev-parse --short ${control}`, { cwd: ROOT, encoding: 'utf8' }).trim();
const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-bench-'));
console.log(`control ${control} (${rev}) in ${wt}`);
try {
  execSync(`git worktree add -q --detach ${wt} ${rev}`, { cwd: ROOT, stdio: 'inherit' });
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(wt, 'node_modules'));
  // the control's game code, measured by today's benchmark (same method)
  fs.copyFileSync(path.join(ROOT, 'tests', 'suites', 'bench.mjs'), path.join(wt, 'tests', 'suites', 'bench.mjs'));
  spawnSync('node', ['tests/run.mjs', 'bench'], { cwd: wt, stdio: 'inherit' });
  const out = path.join(wt, 'tests', 'output');
  const file = fs.readdirSync(out).find((f) => /^bench-.*\.json$/.test(f));
  if (!file) { console.log('the control run wrote no results'); process.exit(2); }
  const ctl = JSON.parse(fs.readFileSync(path.join(out, file), 'utf8'));
  ctl.rev = rev;
  const ctlPath = path.join(ROOT, 'tests', 'output', `bench-control-${rev}.json`);
  fs.mkdirSync(path.dirname(ctlPath), { recursive: true });
  fs.writeFileSync(ctlPath, JSON.stringify(ctl, null, 2));
  const r = spawnSync('node', ['tests/run.mjs', 'bench'], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, BENCH_CONTROL: ctlPath } });
  process.exitCode = r.status;
} finally {
  execSync(`git worktree remove --force ${wt}`, { cwd: ROOT });
}
