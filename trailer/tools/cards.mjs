// Renders the trailer's text cards (development only) as transparent
// 1920×1080 PNGs in the game's own type: the TRACK/LANDS logo colours and
// weight from styles/main.css (.logo), white capitals, a short teal rule.
//
//   node trailer/tools/cards.mjs        → trailer/cards/{en,de}/<id>.png
import fs from 'fs';
import path from 'path';
import { launchBrowser, ROOT } from '../../tests/lib.mjs';

const TR = path.join(ROOT, 'trailer');
const { cards } = JSON.parse(fs.readFileSync(path.join(TR, 'cards', 'cards.json'), 'utf8'));
const FONT = '"Liberation Sans", system-ui, -apple-system, "Segoe UI", Roboto, Ubuntu, "Helvetica Neue", Arial, sans-serif';

const css = `
  html, body { margin: 0; width: 1920px; height: 1080px; background: transparent; overflow: hidden; }
  body { font-family: ${FONT}; color: #fff; display: flex; align-items: center; justify-content: center; }
  .veil { position: absolute; inset: 0; background: radial-gradient(ellipse 52% 30% at 50% 50%, rgba(14,20,30,.42), rgba(14,20,30,0) 100%); }
  .card { position: relative; text-align: center; }
  .rule { width: 72px; height: 5px; border-radius: 3px; background: #2fb3a3; margin: 0 auto 30px; box-shadow: 0 2px 8px rgba(0,0,0,.35); }
  .line { font-weight: 900; font-size: 74px; letter-spacing: .12em; line-height: 1.12; text-shadow: 0 3px 0 rgba(0,0,0,.22), 0 8px 26px rgba(0,0,0,.45); }
  .logo { font-weight: 900; font-size: 176px; letter-spacing: .06em; line-height: 1; text-shadow: 0 6px 0 rgba(0,0,0,.25), 0 14px 40px rgba(0,0,0,.4); }
  .logo span { color: #7fe0d0; }
  .tag { font-weight: 800; font-size: 54px; letter-spacing: .16em; text-shadow: 0 3px 0 rgba(0,0,0,.2), 0 8px 24px rgba(0,0,0,.45); }
  .end { display: flex; gap: 64px; justify-content: center; }
  .end .line { font-size: 82px; }
  .end .line i { font-style: normal; color: #7fe0d0; }
`;

function html(card, lines) {
  if (card.style === 'title') return `<div class="veil"></div><div class="card"><div class="logo">TRACK<span>LANDS</span></div></div>`;
  if (card.style === 'tagline') return `<div class="veil"></div><div class="card"><div class="rule"></div><div class="tag">${lines.join('<br>')}</div></div>`;
  if (card.style === 'end') return `<div class="veil"></div><div class="card"><div class="end">${lines.map((l) => `<div class="line">${l.replace(/\.$/, '')}<i>.</i></div>`).join('')}</div></div>`;
  return `<div class="veil"></div><div class="card"><div class="rule"></div>${lines.map((l) => `<div class="line">${l}</div>`).join('')}</div>`;
}

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
for (const lang of ['en', 'de']) {
  const dir = path.join(TR, 'cards', lang);
  fs.mkdirSync(dir, { recursive: true });
  for (const [id, card] of Object.entries(cards)) {
    await page.setContent(`<!doctype html><meta charset="utf-8"><style>${css}</style><body>${html(card, card[lang] || [])}</body>`);
    await page.screenshot({ path: path.join(dir, `${id}.png`), omitBackground: true });
  }
  console.log(`cards/${lang}: ${Object.keys(cards).length}`);
}
await browser.close();
