// Makes the Chrome Web Store images in store/: five 1280x800 screenshots, the 440x280 small promo
// tile, the 1400x560 marquee and the 128 px store icon.
//   npm run build && npm run store-images
// The pictures of the extension are real: the built extension runs in headless Edge on the fake
// timeline from tests/fixtures (made-up people, no X logos or artwork). The frames around them use the
// same Terrazzo tokens and fonts as Postfold's own page.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extensionWorker, launch, sleep } from '../tests/lib/browser.mjs';
import { startFakeX } from '../tests/lib/fake-server.mjs';
import { POSTS } from '../tests/fixtures/fake-x.mjs';
import { COLORS, markSvg } from './make-icons.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const rel = (...p) => path.join(root, ...p);
const EXT = rel('dist', 'postfold');
if (!fs.existsSync(path.join(EXT, 'manifest.json'))) throw new Error('Run "npm run build" first');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'postfold-store-'));
const raw = (name) => path.join(work, name + '.png');
const OUT = rel('store');
fs.mkdirSync(path.join(OUT, 'screenshots'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'promo'), { recursive: true });

const fake = await startFakeX(work);
const cdp = await launch({ extension: EXT, args: fake.args });
const worlds = new Map();
cdp.on((m) => {
  if (m.method === 'Runtime.executionContextCreated' && m.params.context.auxData?.type === 'isolated' && m.params.context.name === MANIFEST.name) worlds.set(m.sessionId, m.params.context.id);
});

// Capture part of the screen without scrolling (scrolling would close Postfold's menu).
async function capture(sessionId, file, clip) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1 }, captureBeyondViewport: false }, sessionId);
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
}
const pad = (r, p) => ({ x: Math.max(0, r.x - p), y: Math.max(0, r.y - p), width: r.width + p * 2, height: r.height + p * 2 });

try {
  const sw = await extensionWorker(cdp, MANIFEST.name);

  // ---------- x.com: seed folders through Postfold's own code, then open its menus ----------
  const x = await cdp.open('https://x.com/home?theme=light', { width: 1280, height: 900, scale: 2 });
  const W = (expr) => cdp.eval(x.sessionId, expr, worlds.get(x.sessionId));
  await cdp.until(x.sessionId, `document.querySelectorAll('.pf-btn').length === ${POSTS.length}`, 10000, worlds.get(x.sessionId));
  const art = (i) => `[...document.querySelectorAll('article')].find((a) => a.querySelector('a[href$="/status/${POSTS[i].id}"]'))`;
  await W(`(async () => {
    const f = {};
    for (const n of ['Design references', 'Ideas', 'Read later', 'Writing tips']) f[n] = (await Store.createFolder(n)).id;
    const ids = ${JSON.stringify(POSTS.map((p) => p.id))};
    const find = (i) => [...document.querySelectorAll('article')].find((a) => a.querySelector('a[href$="/status/' + ids[i] + '"]'));
    const put = async (i, names) => { for (const n of names) await Store.toggleFolder(Post.read(find(i)), f[n]); };
    await put(3, ['Read later']);
    await put(2, ['Design references']);
    await put(1, ['Writing tips', 'Ideas']);
    await put(0, ['Ideas', 'Design references']);
    // A few more made-up saved posts, so the page has something to show.
    const pic = (who) => 'https://pbs.twimg.com/profile_images/' + who + '/avatar_normal.svg';
    await Store.importData({ app: 'postfold', version: 1, folders: [], posts: [
      { id: '1857500000000000003', handle: 'inesmakes', name: 'Inès Duval', avatar: pic('ines'), text: 'A good empty state says what goes here and gives you one button to start. That is the whole trick.', folders: [f['Design references']], postedAt: Date.parse('2026-11-12T10:00:00Z'), savedAt: Date.now() - 9e6 },
      { id: '1857500000000000002', handle: 'kofiships', name: 'Kofi Mensah', avatar: pic('kofi'), text: 'Shipped an export button today. The boring features are the ones people thank you for.', folders: [f['Ideas']], postedAt: Date.parse('2026-11-10T15:30:00Z'), savedAt: Date.now() - 8e6 },
      { id: '1857500000000000001', handle: 'rhea_reads', name: 'Rhea Kapoor', avatar: pic('rhea'), text: 'Weekend reading: two essays on attention and one on long walks.', folders: [f['Read later']], postedAt: Date.parse('2026-11-08T08:45:00Z'), savedAt: Date.now() - 7e6 },
    ] });
  })()`);
  await sleep(300);

  const rect = (expr) => W(`(() => { const r = (${expr}).getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; })()`);
  const union = (...rs) => {
    const x0 = Math.min(...rs.map((r) => r.x));
    const y0 = Math.min(...rs.map((r) => r.y));
    return { x: x0, y: y0, width: Math.max(...rs.map((r) => r.x + r.width)) - x0, height: Math.max(...rs.map((r) => r.y + r.height)) - y0 };
  };
  const clickAt = (r) => cdp.click(x.sessionId, r.cx, r.cy);
  const hoverAt = (r) => cdp.hover(x.sessionId, r.cx, r.cy);

  // A: the menu on a short post.
  await W(`scrollTo(0, 0)`);
  await clickAt(await rect(`${art(1)}.querySelector('.pf-btn')`));
  await cdp.until(x.sessionId, `!!document.querySelector('.pf-menu')`, 3000, worlds.get(x.sessionId));
  await hoverAt(await rect(`document.querySelector('.pf-pill[data-swatch="dim"]')`));
  await sleep(350);
  {
    const a = await rect(art(1));
    const above = await rect(art(0));
    const m = await rect(`document.querySelector('.pf-menu')`);
    const box = union({ ...a, y: above.y + above.height - 230, height: a.y + a.height - (above.y + above.height - 230) }, m);
    await capture(x.sessionId, raw('menu'), pad({ ...box, x: a.x, width: Math.max(a.x + a.width, m.x + m.width) - a.x }, 0));
  }
  await cdp.key(x.sessionId, 'Escape');
  await sleep(200);

  // B: the folder panel on the post with a picture.
  await clickAt(await rect(`${art(0)}.querySelector('.pf-btn')`));
  await cdp.until(x.sessionId, `!!document.querySelector('.pf-menu')`, 3000, worlds.get(x.sessionId));
  await hoverAt(await rect(`document.querySelector('.pf-has-sub')`));
  await cdp.until(x.sessionId, `!!document.querySelector('.pf-sub .pf-opt')`, 3000, worlds.get(x.sessionId));
  await hoverAt(await rect(`[...document.querySelectorAll('.pf-sub .pf-opt')].find((o) => o.textContent === 'Ideas')`));
  await sleep(350);
  {
    const a = await rect(art(0));
    const m = await rect(`document.querySelector('.pf-menu:not(.pf-sub)')`);
    const s = await rect(`document.querySelector('.pf-sub')`);
    const top = m.y - 300;
    const right = Math.max(s.x + s.width, a.x + a.width) + 20;
    const bottom = Math.max(s.y + s.height, m.y + m.height) + 20;
    await capture(x.sessionId, raw('panel'), { x: a.x, y: Math.max(0, top), width: right - a.x, height: bottom - Math.max(0, top) });
  }
  await cdp.key(x.sessionId, 'Escape');
  await cdp.key(x.sessionId, 'Escape');

  // C: the screenshots themselves, straight from Postfold's renderer.
  for (const theme of ['light', 'dim', 'dark']) {
    const dataUrl = await W(`Shot.render(Post.read(${art(0)}), '${theme}', { stats: true }).then((b) => new Promise((r) => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); }))`);
    fs.writeFileSync(raw('shot-' + theme), Buffer.from(dataUrl.split(',')[1], 'base64'));
  }

  // D and E: Postfold's page, light and dark.
  const pg = await cdp.open('about:blank', { width: 1040, height: 700, scale: 2 });
  await cdp.send('Emulation.setScrollbarsHidden', { hidden: true }, pg.sessionId);
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] }, pg.sessionId);
  const loaded = cdp.waitFor((m) => m.sessionId === pg.sessionId && m.method === 'Page.loadEventFired', 15000);
  await cdp.send('Page.navigate', { url: `chrome-extension://${sw.id}/page/folders.html#all` }, pg.sessionId);
  await loaded;
  await cdp.until(pg.sessionId, `document.querySelectorAll('#list .row').length === 7 && [...document.querySelectorAll('img')].every((i) => i.complete)`, 8000);
  await sleep(300);
  await capture(pg.sessionId, raw('page-light'), { x: 0, y: 0, width: 1040, height: 700 });
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }, pg.sessionId);
  await cdp.eval(pg.sessionId, `location.hash = '#settings'`);
  await cdp.until(pg.sessionId, `!document.querySelector('#settings').hidden`, 3000);
  await sleep(300);
  await capture(pg.sessionId, raw('settings-dark'), { x: 0, y: 0, width: 1040, height: 700 });

  // ---------- frames ----------
  const dataUri = (file, type = 'image/png') => `data:${type};base64,${fs.readFileSync(file).toString('base64')}`;
  const font = (file) => dataUri(rel('page/fonts', file), 'font/woff2');
  const tokens = fs.readFileSync(rel('page/tokens.css'), 'utf8');
  const darkTokens = fs.readFileSync(rel('page/folders.css'), 'utf8').match(/@media \(prefers-color-scheme: dark\) \{\s*:root \{([\s\S]*?)\}\s*\}/)[1];
  const css = `/* Hallmark · store frames for Postfold · theme: Terrazzo, same tokens as the extension's page */
${tokens}
.dark { color-scheme: dark; ${darkTokens} }
@font-face { font-family: "Syne"; font-weight: 700; src: url("${font('syne-700.woff2')}") format("woff2"); }
@font-face { font-family: "Onest"; font-weight: 400; src: url("${font('onest-400.woff2')}") format("woff2"); }
@font-face { font-family: "Onest"; font-weight: 500; src: url("${font('onest-500.woff2')}") format("woff2"); }
html, body { margin: 0; overflow: clip; }
body { background: var(--color-paper); color: var(--color-ink); font-family: var(--font-body); -webkit-font-smoothing: antialiased; }
.frame { width: 1280px; height: 800px; display: grid; grid-template-columns: 440px minmax(0, 1fr); background: var(--color-paper); color: var(--color-ink); }
.copy { display: flex; flex-direction: column; justify-content: space-between; padding: 64px 40px 64px 56px; border-right: var(--rule-bar) solid var(--color-ink); }
.brand { display: flex; align-items: center; gap: 12px; font-family: var(--font-display); font-weight: 700; font-size: 26px; letter-spacing: var(--tracking-display); }
.brand svg { width: 30px; height: 30px; }
h1 { margin: 0 0 24px; font-family: var(--font-display); font-weight: 700; font-size: 46px; line-height: 1.04; letter-spacing: var(--tracking-display); overflow-wrap: break-word; min-width: 0; }
p { margin: 0; max-width: 30ch; font-size: 20px; line-height: 1.45; color: var(--color-muted); }
.rule { height: var(--rule-bar); background: var(--color-ink); width: 64px; }
.stage { position: relative; overflow: clip; background: var(--color-paper-2); display: grid; place-items: center; }
.plate { display: block; border: var(--rule-bar) solid var(--color-ink); box-shadow: 14px 14px 0 var(--color-ink); background: var(--color-plate); }
.fan { position: relative; width: 700px; height: 640px; }
.fan img { position: absolute; width: 400px; border: var(--rule-bar) solid var(--color-ink); box-shadow: 12px 12px 0 var(--color-ink); }
.fan img:nth-child(1) { left: 0; top: 0; }
.fan img:nth-child(2) { left: 150px; top: 110px; }
.fan img:nth-child(3) { left: 300px; top: 220px; }
.promo { display: flex; align-items: center; justify-content: center; background: var(--color-accent); color: var(--color-plate); font-family: var(--font-display); font-weight: 700; letter-spacing: var(--tracking-display); }
`;
  const mark = markSvg();
  const lightMark = markSvg({ page: COLORS.PLATE, fold: COLORS.INK, marks: COLORS.RUST });

  async function render(html, file, width, height) {
    const page = path.join(work, 'frame.html');
    fs.writeFileSync(page, `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${css}</style></head><body>${html}</body></html>`);
    const s = await cdp.open('file:///' + page.replace(/\\/g, '/'), { width, height, scale: 1 });
    await cdp.eval(s.sessionId, `document.fonts.ready.then(() => Promise.all([...document.images].map((i) => i.decode().catch(() => {}))))`);
    await capture(s.sessionId, file, { x: 0, y: 0, width, height });
    await cdp.send('Target.closeTarget', { targetId: s.targetId });
    console.log(path.relative(root, file));
  }
  const frame = ({ title, text, stage, dark }) => `<div class="frame${dark ? ' dark' : ''}">
  <div class="copy"><div class="brand">${mark}Postfold</div><div><h1>${title}</h1><p>${text}</p></div><div class="rule"></div></div>
  <div class="stage">${stage}</div></div>`;
  const img = (name, width) => `<img class="plate" src="${dataUri(raw(name))}" style="width:${width}px" alt="">`;
  // Display width for a 2x capture: as big as fits, never past 1.4x (still sharp).
  const fit = (name, maxW, maxH) => {
    const b = fs.readFileSync(raw(name));
    const w = b.readUInt32BE(16) / 2;
    const h = b.readUInt32BE(20) / 2;
    return Math.round(Math.min(maxW / w, maxH / h, 1.4) * w);
  };

  const shots = [
    { file: '1-screenshot-any-post.png', title: 'Screenshot any post in one click', text: 'Pick Light, Dim or Dark. The picture is copied, ready to paste, and saved to Downloads.', stage: img('menu', fit('menu', 740, 660)) },
    { file: '2-three-themes.png', title: 'Clean pictures in three themes', text: 'Sharp at twice the size. Add the counts or a soft padded background in Settings.', stage: `<div class="fan">${['light', 'dim', 'dark'].map((t) => `<img src="${dataUri(raw('shot-' + t))}" alt="">`).join('')}</div>` },
    { file: '3-save-into-folders.png', title: 'Save posts into your own folders', text: 'Type a name to make a folder. One post can sit in as many folders as you like.', stage: img('panel', fit('panel', 740, 660)) },
    { file: '4-find-what-you-saved.png', title: 'Find what you saved', text: 'Search words, names and @handles. Rename, merge and delete folders, with Undo.', stage: img('page-light', fit('page-light', 760, 640)) },
    { file: '5-stays-on-your-device.png', title: 'Your saved posts stay on your device', text: 'No account and no tracking. Export a backup file and import it again any time.', stage: img('settings-dark', fit('settings-dark', 760, 640)), dark: true },
  ];
  for (const s of shots) await render(frame(s), path.join(OUT, 'screenshots', s.file), 1280, 800);

  // Small promo tile: the brand only, no other words.
  await render(
    `<div class="promo" style="width:440px;height:280px;gap:22px"><span style="display:block;width:92px;height:92px">${lightMark.replace('<svg ', '<svg width="92" height="92" ')}</span><span style="font-size:58px">Postfold</span></div>`,
    path.join(OUT, 'promo', 'small-promo-440x280.png'),
    440,
    280
  );
  // Marquee: the brand on the left, the three themes on the right.
  await render(
    `<div class="promo" style="width:1400px;height:560px;justify-content:space-between;position:relative;overflow:clip">
      <div style="display:flex;align-items:center;gap:28px;padding-left:88px"><span style="display:block;width:128px;height:128px">${lightMark.replace('<svg ', '<svg width="128" height="128" ')}</span><span style="font-size:88px">Postfold</span></div>
      <div class="fan" style="width:620px;height:560px;margin-top:120px;margin-right:-20px">${['light', 'dim', 'dark'].map((t) => `<img src="${dataUri(raw('shot-' + t))}" alt="" style="width:360px">`).join('')}</div>
    </div>`,
    path.join(OUT, 'promo', 'marquee-1400x560.png'),
    1400,
    560
  );
  fs.copyFileSync(rel('icons/icon128.png'), path.join(OUT, 'icon-128.png'));
  console.log('store/icon-128.png');
} finally {
  await cdp.close();
  fake.close();
  fs.rmSync(work, { recursive: true, force: true });
}
