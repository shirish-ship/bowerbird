// Draws Postfold's icons (16, 32, 48 and 128 px PNGs) from the mark below, using headless Edge.
//   node scripts/make-icons.mjs
// The mark: a rust page with its top corner folded over in ink. The 48 and 128 px icons add a
// square picture and two lines of "text", like a post. The 128 px icon keeps the Chrome Web Store's 16 px clear space around 96 px of art.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from '../tests/lib/browser.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUST = '#b14420';
const INK = '#0f0d0b';
const PLATE = '#fefdfb';

// The colours can be swapped, e.g. a light page on a rust background for the store's promo tiles.
export function markSvg({ lines = true, page = RUST, fold = INK, marks = PLATE } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" aria-hidden="true">
  <path d="M0 0H58L96 38V96H0Z" fill="${page}"/>
  <path d="M58 0V38H96Z" fill="${fold}"/>
  ${lines ? `<path d="M14 16h20v20H14Z" fill="${marks}"/><path d="M14 58H74M14 74H54" stroke="${marks}" stroke-width="7"/>` : ''}
</svg>`;
}
export const COLORS = { RUST, INK, PLATE };

const SIZES = [
  { size: 16, pad: 1, lines: false },
  { size: 32, pad: 2, lines: false },
  { size: 48, pad: 4, lines: true },
  { size: 128, pad: 16, lines: true },
];

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(path.join(root, 'store/src/mark.svg'), markSvg());
  const cdp = await launch();
  try {
    for (const { size, pad, lines } of SIZES) {
      const html = `<!doctype html><html><head><style>html,body{margin:0;background:transparent}svg{position:absolute;left:${pad}px;top:${pad}px;width:${size - pad * 2}px;height:${size - pad * 2}px;shape-rendering:${size < 40 ? 'crispEdges' : 'geometricPrecision'}}</style></head><body>${markSvg({ lines })}</body></html>`;
      const file = path.join(root, 'store/src/.icon.html');
      fs.writeFileSync(file, html);
      const { sessionId } = await cdp.open('file:///' + file.replace(/\\/g, '/'), { width: size, height: size });
      await cdp.screenshot(sessionId, path.join(root, `icons/icon${size}.png`), { transparent: true, clip: { x: 0, y: 0, width: size, height: size } });
      console.log(`icons/icon${size}.png`);
    }
    fs.rmSync(path.join(root, 'store/src/.icon.html'), { force: true });
  } finally {
    await cdp.close();
  }
}
