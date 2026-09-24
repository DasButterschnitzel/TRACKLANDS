// PWA / offline: the service worker caches one complete release (generated
// asset list), after which the game boots and starts a world with the
// network switched off. Also checks that service-worker.js is up to date.
import { openPage, startTestGame } from '../lib.mjs';
import { buildServiceWorker } from '../../tools/build-sw.mjs';
import fs from 'fs';
import path from 'path';

export const name = 'pwa';
export async function run({ browser, base }) {
  const lines = [];
  let ok = true;
  const sw = fs.readFileSync(path.resolve('service-worker.js'), 'utf8');
  const fresh = sw === buildServiceWorker();
  if (!fresh) { ok = false; lines.push('FAIL service-worker.js is stale: run node tools/build-sw.mjs'); } else lines.push('ok   service-worker.js matches the files it caches');
  const { ctx, page, errors } = await openPage(browser, base);
  const cached = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    for (let i = 0; i < 100 && !navigator.serviceWorker.controller; i++) await new Promise((r) => setTimeout(r, 100));
    const keys = await caches.keys();
    const c = await caches.open(keys.find((k) => k.startsWith('tracklands-')));
    return { active: !!reg.active, controlled: !!navigator.serviceWorker.controller, caches: keys.length, entries: (await c.keys()).length };
  }).catch((e) => ({ error: e.message }));
  const expected = (sw.match(/^ {2}'\.\//gm) || []).length;
  const cOk = cached.active && cached.controlled && cached.entries >= expected;
  if (!cOk) ok = false;
  lines.push(`${cOk ? 'ok  ' : 'FAIL'} service worker active, page controlled, ${cached.entries}/${expected} files cached${cached.error ? ' · ' + cached.error : ''}`);
  // offline: reload and start a world without any network
  await ctx.setOffline(true);
  let offlineOk = false;
  try {
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__tracklands && window.__tracklands.renderer, null, { timeout: 30000 });
    await startTestGame(page, 77);
    offlineOk = await page.evaluate(() => { const g = window.__tracklands.game; for (let i = 0; i < 60; i++) g.tick(1 / 30); return g.running && g.towns.list.length > 0; });
  } catch (e) { lines.push('offline boot failed: ' + e.message.split('\n')[0]); }
  if (!offlineOk) ok = false;
  lines.push(`${offlineOk ? 'ok  ' : 'FAIL'} offline reload boots and starts a new world`);
  await ctx.setOffline(false);
  if (errors.length) { ok = false; lines.push('errors: ' + errors.slice(0, 3).join(' | ')); }
  await ctx.close();
  return { ok, lines };
}
