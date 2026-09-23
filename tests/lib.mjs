// Shared helpers for the TRACKLANDS test suites: a tiny static file server for
// the repository, a headless Chromium with software WebGL, and page helpers.
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const OUT = path.join(ROOT, 'tests', 'output');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon',
};

// Serve the repository root on a free local port (no caching).
export function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = decodeURIComponent((req.url || '/').split('?')[0]);
      let file = path.join(ROOT, url === '/' ? 'index.html' : url);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

let _pw = null;
export async function launchBrowser() {
  if (!_pw) _pw = await import('playwright');
  const opts = { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info'] };
  if (process.env.CHROMIUM_PATH) opts.executablePath = process.env.CHROMIUM_PATH;
  return _pw.chromium.launch(opts);
}
export async function devices() { if (!_pw) _pw = await import('playwright'); return _pw.devices; }

// New page with error capture. errors[] collects page errors and console errors.
export async function openPage(browser, base, ctxOpts = { viewport: { width: 1280, height: 800 } }, query = '') {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message + ' @ ' + (e.stack || '').split('\n').slice(1, 3).join(' ').replace(/http:\/\/127\.0\.0\.1:\d+\//g, '')));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text().slice(0, 400)); });
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  await page.goto(base + '/index.html' + query);
  await page.waitForFunction(() => window.__tracklands && window.__tracklands.renderer, null, { timeout: 60000 });
  await page.waitForTimeout(500);
  return { ctx, page, errors };
}

// Start a throwaway test world (never saved). paused: the test drives tick() itself.
export async function startTestGame(page, seed, { paused = true, difficulty = 'builder' } = {}) {
  await page.evaluate(([sd, p, d]) => {
    const app = window.__tracklands;
    document.querySelectorAll('.modal-wrap').forEach((m) => m.remove());
    if (app.game) { app.ui.detach(); app.game.dispose(); app.game = null; }
    app.startGame({ seed: sd, difficulty: d, test: true, paused: p });
  }, [seed, paused, difficulty]);
  await page.waitForFunction(() => window.__tracklands.game && window.__tracklands.game.running, null, { timeout: 60000 });
  await page.evaluate(() => { const g = window.__tracklands.game; g.tutorial.skip(); document.querySelectorAll('.modal-wrap').forEach((m) => m.remove()); });
}

// Load a save object into the running app (test mode unless told otherwise).
export async function loadSave(page, save, { test = true, paused = true } = {}) {
  await page.evaluate(([s, t, p]) => {
    const app = window.__tracklands;
    document.querySelectorAll('.modal-wrap').forEach((m) => m.remove());
    if (app.game) { app.ui.detach(); app.game.dispose(); app.game = null; }
    app.startGame({ save: s, test: t, paused: p });
  }, [save, test, paused]);
  await page.waitForFunction(() => (window.__tracklands.game && window.__tracklands.game.running) || document.querySelector('.modal-wrap h2'), null, { timeout: 60000 });
  await page.evaluate(() => document.querySelectorAll('.modal-wrap').forEach((m) => m.remove()));
}

export function fixtureText() { return fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'production-save.trkl1.txt'), 'utf8').trim(); }
export function decodeTRKL1(text) { return JSON.parse(Buffer.from(text.slice(6), 'base64').toString('utf8')); }
export function productionSave() { return decodeTRKL1(fixtureText()); }
export function regressionSeeds() { return JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'regression-seeds.json'), 'utf8')); }

export function ensureOut() { fs.mkdirSync(OUT, { recursive: true }); return OUT; }
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
