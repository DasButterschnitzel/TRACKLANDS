// Deterministic UI monkey: random clicks on every visible control, canvas taps
// and drags, keys and wheel on a live network, desktop and phone (touch, DE).
// Fails on any page error, renderer crash, NaN train or reservation conflict.
// Reports JS heap / GPU object counts over time to spot leaks.
import { openPage, startTestGame, devices } from '../lib.mjs';

function rngOf(seed) { let s = (seed * 2654435761) >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), s | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

async function session(browser, base, mode, seed, steps) {
  const dev = await devices();
  const ctxOpts = mode === 'phone' ? { ...dev['iPhone 13'], locale: 'de-DE' } : mode === 'tablet' ? { ...dev['iPad (gen 7)'] } : { viewport: { width: 1280, height: 800 } };
  const { ctx, page, errors } = await openPage(browser, base, ctxOpts);
  let crashed = false;
  page.on('crash', () => { crashed = true; errors.push('RENDERER CRASH'); });
  const rnd = rngOf(seed);
  const start = async () => {
    await startTestGame(page, (3 + seed) * 1013, { paused: false });
    await page.evaluate((sd) => { const g = window.__tracklands.game; g.speed = 0; g.runRailFuzz(3 + sd, 0.5); g.speed = 1; g.economy.coins = 5e6; }, seed);
  };
  await start();
  const log = [], mem = [], lines = [];
  let bad = 0, restarts = 0;
  for (let i = 0; i < steps; i++) {
    if (crashed) { lines.push(`${mode}#${seed} step ${i}: page crashed; last: ${log.slice(-8).join(' | ')}`); bad++; break; }
    if (i % 100 === 0) mem.push(await page.evaluate(() => { const app = window.__tracklands; const ri = app.renderer.info; return `${performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : '?'}MB/${ri.memory.geometries}g/${ri.memory.textures}t`; }).catch(() => '?'));
    const r = rnd();
    try {
      const st = await page.evaluate(() => ({ game: !!window.__tracklands.game, title: !document.querySelector('#title').hidden }));
      if (!st.game || st.title) { restarts++; log.push(i + ' restart'); await start(); continue; }
      if (r < 0.62) {
        const n = await page.evaluate(() => {
          const sel = '#hud button, #hud [data-act], #hud select, #panel button, #panel [data-act], #panel select, #panel input, #inspector button, #inspector [data-act], #inspector select, #modal-root button, #modal-root select, #modal-root input, #tutorial button, #toasts button';
          window.__monkey = [...document.querySelectorAll(sel)].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && !e.disabled && getComputedStyle(e).visibility !== 'hidden'; });
          return window.__monkey.length;
        });
        if (!n) continue;
        const k = Math.floor(rnd() * n);
        const desc = await page.evaluate((k) => { const e = window.__monkey[k]; return (e.tagName + '.' + String(e.className || '').split(' ')[0] + ' ' + (e.dataset.act || e.dataset.mbtn || '') + ' ' + (e.dataset.arg || '') + ' ' + (e.textContent || '').trim().slice(0, 18)).replace(/\s+/g, ' '); }, k);
        if (/reset|wipe|löschen|zurücksetzen|legacy|vermächtnis/i.test(desc)) continue;
        const pick = rnd();
        await page.evaluate(([k, pick]) => {
          const e = window.__monkey[k];
          if (e.tagName === 'SELECT') { if (e.options.length) { e.selectedIndex = Math.floor(pick * e.options.length); e.dispatchEvent(new Event('change', { bubbles: true })); } }
          else if (e.tagName === 'INPUT' && (e.type === 'range' || e.type === 'number')) { e.value = String((+e.min || 0) + pick * ((+e.max || 100) - (+e.min || 0))); e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }
          else if (e.tagName === 'INPUT' && e.type === 'text') { e.value = 'Zug ' + Math.floor(pick * 99); e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }
          else if (e.tagName === 'INPUT' && e.type === 'file') { /* skip */ }
          else e.click();
        }, [k, pick]);
        log.push(i + ' click ' + desc);
      } else if (r < 0.87) {
        const vp = page.viewportSize();
        const x = Math.floor(vp.width * (0.1 + rnd() * 0.8)), y = Math.floor(vp.height * (0.15 + rnd() * 0.65));
        if (rnd() < 0.5) { if (mode !== 'desktop') await page.touchscreen.tap(x, y); else await page.mouse.click(x, y); log.push(`${i} tap ${x},${y}`); }
        else { const x2 = x + Math.floor((rnd() - 0.5) * 300), y2 = y + Math.floor((rnd() - 0.5) * 300); await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x2, y2, { steps: 6 }); await page.mouse.up(); log.push(`${i} drag ${x},${y}>${x2},${y2}`); }
      } else if (r < 0.95) {
        const keys = ['Escape', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'b', 'r', 't', 's', 'Space', 'Delete', 'z', 'Control+z', 'o', 'Tab'];
        const k = keys[Math.floor(rnd() * keys.length)];
        await page.keyboard.press(k); log.push(i + ' key ' + k);
      } else { await page.mouse.wheel(0, (rnd() - 0.5) * 800); log.push(i + ' wheel'); }
      await page.waitForTimeout(40 + Math.floor(rnd() * 100));
    } catch (e) { if (!crashed) errors.push('HARNESS ' + e.message.split('\n')[0]); }
    if (errors.length) { lines.push(`${mode}#${seed} step ${i}: ${errors.splice(0).slice(0, 3).join(' || ').slice(0, 900)}\n        last: ${log.slice(-6).join(' | ')}`); bad++; }
  }
  const fin = await page.evaluate(() => { const g = window.__tracklands.game; if (!g) return { txt: 'no game', bad: false }; const nan = g.trains.trains.filter((t) => !Number.isFinite(t.s)).length; return { txt: `trains ${g.trains.trains.length}, nan ${nan}, conflicts ${g.trains.collisions}, time ${g.time.toFixed(0)}s`, bad: nan > 0 || g.trains.collisions > 0 }; }).catch(() => ({ txt: 'page gone', bad: true }));
  if (fin.bad) bad++;
  lines.push(`${bad ? 'FAIL' : 'ok  '} ${mode}#${seed}: ${steps} steps, restarts ${restarts}, ${fin.txt}, memory ${mem.join(' ')}`);
  await ctx.close().catch(() => {});
  return { bad, lines };
}

export const name = 'monkey';
export async function run({ browser, base, quick, args }) {
  const steps = +(args.steps || (quick ? 150 : 600));
  const seeds = args.seeds ? String(args.seeds).split(',').map(Number) : quick ? [1] : [1, 2, 3];
  const modes = args.modes ? String(args.modes).split(',') : ['desktop', 'phone', 'tablet'];
  const lines = [];
  let bad = 0;
  for (const seed of seeds) for (const mode of modes) { const r = await session(browser, base, mode, seed, steps); bad += r.bad; lines.push(...r.lines); }
  return { ok: bad === 0, lines };
}
