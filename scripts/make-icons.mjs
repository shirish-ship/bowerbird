// Draws Bowerbird's icons (16, 32, 48 and 128 px PNGs) from the mark below, using headless Edge,
// and copies the mark to the store and docs folders.
//   node scripts/make-icons.mjs
// The mark: a plain geometric bowerbird (the bird that collects small treasures) holding a card,
// on an ink perch. 16 and 32 px use a simpler bird with a bigger head and eye and no perch; 16 px
// also drops the card. The 128 px icon keeps the Chrome Web Store's 16 px clear space around 96 px of art.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from '../tests/lib/browser.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUST = '#b14420';
const INK = '#0f0d0b';
const PLATE = '#fefdfb';

// The colours can be swapped, e.g. a light bird on a rust background for the store's promo tiles.
export function markSvg({ small = false, card = !small, bird = RUST, marks = PLATE, perch = INK } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" aria-hidden="true">
  <path d="M8 88A64 64 0 0 1 64 24V88Z" fill="${bird}"/>
  <circle cx="64" cy="28" r="${small ? 22 : 20}" fill="${bird}"/>
  <path d="${small ? 'M82 17L96 30L82 41Z' : 'M82 20L96 30L82 38Z'}" fill="${bird}"/>
  <circle cx="${small ? 69 : 68}" cy="25" r="${small ? 6.5 : 4}" fill="${marks}"/>
  ${small ? '' : `<path d="M64 88H8L0 96H56Z" fill="${perch}"/>`}
  ${card ? `<path d="M24 58h22v22H24Z" fill="${marks}"/>` : ''}
</svg>`;
}
export const COLORS = { RUST, INK, PLATE };

const SIZES = [
  { size: 16, pad: 1, small: true, card: false },
  { size: 32, pad: 2, small: true, card: true },
  { size: 48, pad: 4 },
  { size: 128, pad: 16 },
];

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(path.join(root, 'store/src/mark.svg'), markSvg());
  fs.writeFileSync(path.join(root, 'docs/mark.svg'), markSvg());
  const cdp = await launch();
  try {
    for (const { size, pad, small, card } of SIZES) {
      const html = `<!doctype html><html><head><style>html,body{margin:0;background:transparent}svg{position:absolute;left:${pad}px;top:${pad}px;width:${size - pad * 2}px;height:${size - pad * 2}px;shape-rendering:geometricPrecision}</style></head><body>${markSvg({ small, card })}</body></html>`;
      const file = path.join(root, 'store/src/.icon.html');
      fs.writeFileSync(file, html);
      const { sessionId } = await cdp.open('file:///' + file.replace(/\\/g, '/'), { width: size, height: size });
      await cdp.screenshot(sessionId, path.join(root, `icons/icon${size}.png`), { transparent: true, clip: { x: 0, y: 0, width: size, height: size } });
      console.log(`icons/icon${size}.png`);
    }
    fs.rmSync(path.join(root, 'store/src/.icon.html'), { force: true });
    fs.copyFileSync(path.join(root, 'icons/icon32.png'), path.join(root, 'docs/favicon.png'));
  } finally {
    await cdp.close();
  }
}
