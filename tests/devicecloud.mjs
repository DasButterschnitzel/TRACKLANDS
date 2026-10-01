#!/usr/bin/env node
// Optional real-device smoke on BrowserStack (Phase 9). Runs only when the
// BROWSERSTACK_USERNAME and BROWSERSTACK_ACCESS_KEY secrets exist; without
// them it prints NOT EXECUTED and exits 0 (normal CI never depends on it).
//
// The game is served from this machine and reached through BrowserStack
// Local (npm package `browserstack-local`, installed on demand, not a project
// dependency). Playwright connects to real Android devices (Chrome) and to
// desktop Safari. iOS Safari is not reachable through Playwright on
// BrowserStack; it is reported as NOT EXECUTED rather than emulated.
//
// Every result names provider, device, OS and browser; nothing here claims a
// device test that did not run.
import { execSync } from 'node:child_process';
import { startServer } from './lib.mjs';

const user = process.env.BROWSERSTACK_USERNAME, key = process.env.BROWSERSTACK_ACCESS_KEY;
if (!user || !key) { console.log('NOT EXECUTED: REAL DEVICE CLOUD NOT CONFIGURED'); process.exit(0); }

const MATRIX = [
  { name: 'Android phone (recent)', caps: { deviceName: 'Samsung Galaxy S23', osVersion: '13.0', browserName: 'chrome', realMobile: 'true' } },
  { name: 'Android phone (older)', caps: { deviceName: 'Samsung Galaxy S10', osVersion: '9.0', browserName: 'chrome', realMobile: 'true' } },
  { name: 'Android phone (small)', caps: { deviceName: 'Google Pixel 5', osVersion: '11.0', browserName: 'chrome', realMobile: 'true' } },
  { name: 'Android tablet', caps: { deviceName: 'Samsung Galaxy Tab S8', osVersion: '12.0', browserName: 'chrome', realMobile: 'true' } },
  { name: 'macOS Safari (desktop WebKit)', caps: { os: 'OS X', osVersion: 'Sonoma', browser: 'playwright-webkit' } },
];

try { await import('browserstack-local'); } catch (e) { execSync('npm install --no-save --no-audit --no-fund browserstack-local', { stdio: 'inherit' }); }
const { Local } = await import('browserstack-local');
const pw = await import('playwright');
const { server, url } = await startServer();
const port = new URL(url).port;
const local = new Local();
const localId = 'tracklands-' + Date.now();
await new Promise((res, rej) => local.start({ key, localIdentifier: localId, forceLocal: true }, (e) => (e ? rej(e) : res())));

const results = [];
for (const m of MATRIX) {
  const caps = { ...m.caps, 'browserstack.username': user, 'browserstack.accessKey': key, 'browserstack.local': 'true', 'browserstack.localIdentifier': localId, project: 'TRACKLANDS', build: process.env.GITHUB_SHA || 'local', name: m.name };
  const ws = 'wss://cdp.browserstack.com/playwright?caps=' + encodeURIComponent(JSON.stringify(caps));
  let r = { device: m.name, caps: m.caps, result: 'FAIL', detail: '' };
  try {
    const browser = m.caps.realMobile ? await pw._android.connect(ws).then(async (dev) => ({ dev, b: await dev.launchBrowser() })) : { b: await pw.webkit.connect(ws) };
    const ctx = browser.b.newContext ? await browser.b.newContext() : browser.b;
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://localhost:${port}/index.html`);
    await page.waitForFunction(() => window.__tracklands && window.__tracklands.renderer && !document.getElementById('loading'), null, { timeout: 90000 });
    const v = await page.evaluate(async () => {
      const app = window.__tracklands;
      app.startGame({ seed: 4242, difficulty: 'standard', mapSize: 64, test: true, paused: true });
      for (let i = 0; i < 100 && !(app.game && app.game.running); i++) await new Promise((res) => setTimeout(res, 200));
      const g = app.game; for (let f = 0; f < 30; f++) g.frame(1 / 30);
      return { running: !!g && g.running, towns: g ? g.towns.list.length : 0, webgl2: !!app.renderer.capabilities.isWebGL2, dpr: devicePixelRatio, w: innerWidth, h: innerHeight };
    });
    r = { ...r, result: v.running && !errors.length ? 'PASS' : 'FAIL', detail: JSON.stringify(v) + (errors.length ? ' errors: ' + errors.slice(0, 2).join(' | ') : '') };
    await (browser.b.close ? browser.b.close() : null);
    if (browser.dev) await browser.dev.close();
  } catch (e) { r.detail = String(e && e.message || e).slice(0, 300); }
  results.push(r);
  console.log(`${r.result} BrowserStack · ${m.name} · ${JSON.stringify(m.caps)} · ${r.detail}`);
}
console.log('NOT EXECUTED: iOS Safari (Playwright cannot drive iOS devices on BrowserStack)');
await new Promise((res) => local.stop(res));
server.close();
process.exit(results.every((r) => r.result === 'PASS') ? 0 : 1);
