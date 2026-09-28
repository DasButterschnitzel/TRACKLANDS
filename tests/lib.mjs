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
// BROWSER=firefox|webkit picks another engine (cross-browser suites). Firefox
// gets WebGL only with a display, so it runs headed (use xvfb-run on CI).
export const ENGINE = process.env.BROWSER || 'chromium';
export async function launchBrowser() {
  if (!_pw) _pw = await import('playwright');
  if (ENGINE === 'firefox') return _pw.firefox.launch({ headless: false, firefoxUserPrefs: { 'webgl.force-enabled': true } });
  if (ENGINE === 'webkit') return _pw.webkit.launch();
  const opts = { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc'] };
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

// Screenshot pacing for slow software renderers (Phase 12). SwiftShader
// draws 1–2 frames a second; a screenshot taken while the game renders
// continuously waits several seconds for the compositor. Tests that only
// need a picture gate the game's frames (test only: the game itself is
// untouched) and ask for exactly the frames they need: settle() waits for
// finite CSS transitions to end, then renders n frames.
export async function gateRendering(page) {
  await page.evaluate(() => {
    const g = window.__tracklands && window.__tracklands.game;
    if (!g || g._gated) return;
    g._gated = true;
    g._frame = g.frame.bind(g);
    window.__gate = 0;
    g.frame = (dt) => { if (window.__gate > 0) { window.__gate--; g._frame(dt); } };
  });
}
export async function settle(page, frames = 2) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || !a.effect || a.effect.getComputedTiming().iterations === Infinity), null, { timeout: 5000 }).catch(() => {});
  await page.evaluate((n) => { window.__gate = n; }, frames);
  await page.waitForFunction(() => !(window.__gate > 0), null, { timeout: 30000 }).catch(() => {});
}
