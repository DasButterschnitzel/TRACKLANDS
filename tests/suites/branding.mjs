// Phase 8 branding: the company logo (shape, symbol, second colour,
// "surprise me" repeatable from the name), shown in the company panel and on
// the headquarters' sign, kept in the save; three more station styles.
import { openPage, startTestGame, loadSave } from '../lib.mjs';

export const name = 'branding';
export async function run({ browser, base }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 1280, height: 800 } });
  await startTestGame(page, 777);
  const r = await page.evaluate(async () => {
    const g = window.__tracklands.game, ui = g.ui, C = g.company, out = {};
    const L = await import('./src/world/Logo.js');
    const { STATION_STYLES } = await import('./src/config.js');
    g.progression.level = 30;
    out.initials = [L.initials('Northern Lines'), L.initials('tracklands'), L.initials('  ')];
    out.repeatable = JSON.stringify(L.randomLogo('Acme', 3)) === JSON.stringify(L.randomLogo('Acme', 3)) && JSON.stringify(L.randomLogo('Acme', 3)) !== JSON.stringify(L.randomLogo('Acme', 4));
    ui.openPanel('company');
    await new Promise((res) => setTimeout(res, 50));
    out.svg = !!document.querySelector('.logo-edit svg');
    const sel = document.querySelector('[data-change="logoShape"]');
    sel.value = 'shield'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    const sym = document.querySelector('[data-change="logoSymbol"]');
    sym.value = 'star'; sym.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('[data-act="logoColor2"][data-arg="' + 0xf2d06b + '"]').click();
    out.logo = { ...C.logo };
    const before = JSON.stringify(C.logo);
    document.querySelector('[data-act="logoRandom"]').click();
    out.randomChanged = JSON.stringify(C.logo) !== before;
    C.logo = L.cleanLogo({ shape: 'shield', symbol: 'star', color2: 0xf2d06b });
    // the headquarters shows the logo
    let hq = null;
    for (const t of g.towns.list) { for (let dz = -4; dz <= 4 && hq == null; dz++) for (let dx = -4; dx <= 4 && hq == null; dx++) { const tile = (t.z + dz) * g.mapSize + t.x + dx; if (!C.hqError(tile)) hq = tile; } if (hq != null) break; }
    g.economy.coins = 1e6;
    const b = hq != null ? C.buildHQ(hq) : { error: 'none' };
    out.hq = !b.error;
    out.sign = !!(C.mesh && C.mesh.children.some((m) => m.userData.logo));
    out.save = g.serialize();
    // station styles
    out.styles = STATION_STYLES.map((s) => s.id);
    ui.closePanel();
    return out;
  });
  check(r.initials.join() === 'NL,TR,TL', `initials from the name: ${r.initials.join(', ')}`);
  check(r.repeatable, '"surprise me" gives the same logo for the same name and counter');
  check(r.svg && r.logo.shape === 'shield' && r.logo.symbol === 'star' && r.logo.color2 === 0xf2d06b && r.randomChanged, `the logo editor: ${JSON.stringify(r.logo)}`);
  check(r.hq && r.sign, 'the headquarters carries the logo on a sign');
  check(['harbour', 'art_deco', 'steel_glass'].every((x) => r.styles.includes(x)), `station styles: ${r.styles.join(', ')}`);
  await loadSave(page, r.save);
  const back = await page.evaluate(() => { const C = window.__tracklands.game.company; return { logo: C.logo, sign: !!(C.mesh && C.mesh.children.some((m) => m.userData.logo)) }; });
  check(back.logo.shape === 'shield' && back.logo.symbol === 'star' && back.sign, 'the logo is saved and the sign is back after loading');
  if (errors.length) { ok = false; lines.push('errors: ' + errors.slice(0, 3).join(' | ')); }
  await ctx.close();
  return { ok, lines };
}
