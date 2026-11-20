// End-to-end test of the built extension (dist/bowerbird) in headless Edge with a throwaway profile.
// x.com and pbs.twimg.com are FAKE: --host-resolver-rules sends them to a local https server
// (tests/fixtures/fake-x.mjs), so nothing touches the real sites.
//   npm test            (builds first)
//   node tests/e2e.mjs  (uses the last build)
// Screenshots land in tests/out/.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { extensionWorker, launch, sleep } from './lib/browser.mjs';
import { POSTS } from './fixtures/fake-x.mjs';
import { startFakeX } from './lib/fake-server.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXT = path.join(root, 'dist', 'bowerbird');
const OUT = path.join(root, 'tests', 'out');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'bowerbird-e2e-'));
const downloads = path.join(work, 'downloads');
fs.mkdirSync(downloads, { recursive: true });
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
if (!fs.existsSync(path.join(EXT, 'manifest.json'))) throw new Error('Run "node scripts/build.mjs" first');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));

// ---------- results ----------
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: ok ? '' : JSON.stringify(detail ?? '').slice(0, 500) });
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${ok ? '' : '  ' + JSON.stringify(detail ?? '').slice(0, 500)}`);
}

// ---------- the fake sites ----------
const fake = await startFakeX(work);
const requests = fake.requests;

// ---------- the browser ----------
const cdp = await launch({
  extension: EXT,
  width: 1280,
  height: 900,
  args: fake.args,
});

const problems = [];
const names = new Map(); // sessionId -> name, for error reports
const worlds = new Map(); // sessionId -> Bowerbird's content script world
cdp.on((m) => {
  const where = names.get(m.sessionId);
  if (!where) return;
  if (m.method === 'Runtime.executionContextCreated' && m.params.context.auxData?.type === 'isolated' && m.params.context.name === MANIFEST.name) {
    worlds.set(m.sessionId, m.params.context.id);
  }
  if (m.method === 'Runtime.exceptionThrown') problems.push(`${where}: uncaught ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'assert'].includes(m.params.type)) {
    problems.push(`${where}: console.${m.params.type} ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
  }
  if (m.method === 'Log.entryAdded' && ['error', 'warning'].includes(m.params.entry.level)) {
    const e = m.params.entry;
    // Leaving a page cancels its picture loads; that is not an error in Bowerbird.
    if (!/net::ERR_ABORTED/.test(e.text)) problems.push(`${where}: ${e.source} ${e.level} ${e.text} ${e.url || ''}`);
  }
});

const savedFiles = new Map(); // guid -> filename
cdp.on((m) => {
  if (m.method === 'Browser.downloadWillBegin') savedFiles.set(m.params.guid, { name: m.params.suggestedFilename, done: false });
  if (m.method === 'Browser.downloadProgress' && m.params.state === 'completed') savedFiles.get(m.params.guid).done = true;
});
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, eventsEnabled: true });
await cdp.send('Browser.grantPermissions', { origin: 'https://x.com', permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });

async function openTab(url, name, opts) {
  const s = await cdp.open('about:blank', opts);
  names.set(s.sessionId, name);
  await cdp.send('Log.enable', {}, s.sessionId);
  const loaded = cdp.waitFor((m) => m.sessionId === s.sessionId && m.method === 'Page.loadEventFired', 20000);
  await cdp.send('Page.navigate', { url }, s.sessionId);
  await loaded;
  return s;
}

// The background worker.
const sw = await extensionWorker(cdp, MANIFEST.name);
names.set(sw.sessionId, 'background');
const extId = sw.id;
const storage = () => cdp.eval(sw.sessionId, 'chrome.storage.local.get(null)');
const setStorage = (obj) => cdp.eval(sw.sessionId, `chrome.storage.local.set(${JSON.stringify(obj)})`);

// ---------- helpers on the x.com tab ----------
let x; // { sessionId }
const inWorld = (expr) => cdp.eval(x.sessionId, expr, worlds.get(x.sessionId));
const untilWorld = (expr, ms) => cdp.until(x.sessionId, expr, ms, worlds.get(x.sessionId));
const key = (k, opts) => cdp.key(x.sessionId, k, k === 'Enter' ? { text: '\r', ...opts } : opts);
const focused = () => inWorld(`(() => { const a = document.activeElement; return a ? (a.getAttribute('aria-label') || a.textContent || a.placeholder || a.tagName).trim() : ''; })()`);
const toastText = () => inWorld(`document.querySelector('.bb-toast.is-on')?.textContent || ''`);
async function waitToast(re, ms = 6000) {
  const end = Date.now() + ms;
  let t = '';
  while (Date.now() < end) {
    t = await toastText();
    if (re.test(t)) return t;
    await sleep(60);
  }
  return t;
}
const articleSel = (id) => `[...document.querySelectorAll('article')].find((a) => a.querySelector('a[href$="/status/${id}"]'))`;
async function center(expr) {
  const r = await inWorld(`(() => { const e = ${expr}; if (!e) return null; e.scrollIntoView({ block: 'center' }); const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
  if (!r) throw new Error('Not found: ' + expr);
  return r;
}
async function clickEl(expr) {
  const { x: cx, y: cy } = await center(expr);
  await cdp.click(x.sessionId, cx, cy);
}
async function hoverEl(expr) {
  const { x: cx, y: cy } = await center(expr);
  await cdp.hover(x.sessionId, cx, cy);
}
const shoot = (s, name, opts) => cdp.screenshot(s.sessionId, path.join(OUT, name + '.png'), opts);

function pngInfo(file) {
  const buf = fs.readFileSync(file);
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  const idat = [];
  for (let o = 8; o < buf.length; ) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString('ascii', o + 4, o + 8);
    if (type === 'IDAT') idat.push(buf.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  // The first pixel of the first row is the same under every PNG filter.
  const [r, g, b] = raw.subarray(1, 4);
  return { w, h, corner: '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('') };
}
async function waitFile(re, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const f = fs.readdirSync(downloads).find((n) => re.test(n) && !n.endsWith('.crdownload'));
    if (f) {
      await sleep(150);
      return path.join(downloads, f);
    }
    await sleep(100);
  }
  return null;
}

try {
  // ================= x.com =================
  x = await openTab('https://x.com/home?theme=light', 'x.com', { width: 1280, height: 900 });
  await cdp.send('Page.bringToFront', {}, x.sessionId);
  const icons = await untilWorld(`document.querySelectorAll('article .bb-btn').length === ${POSTS.length}`, 10000);
  check('an icon appears on every post', icons, await inWorld(`document.querySelectorAll('article .bb-btn').length`).catch((e) => e.message));
  check(
    'the icon sits just before Bookmark',
    await inWorld(`[...document.querySelectorAll('.bb-slot')].every((s) => s.nextElementSibling?.querySelector('[data-testid="bookmark"]'))`)
  );
  check('icons have an accessible name', await inWorld(`[...document.querySelectorAll('.bb-btn')].every((b) => /Bowerbird/.test(b.getAttribute('aria-label')))`));

  // ---- keyboard: open the menu and save into a new folder ----
  const first = POSTS[0];
  await inWorld(`${articleSel(first.id)}.querySelector('.bb-btn').focus()`);
  await key('Enter');
  await untilWorld(`!!document.querySelector('.bb-menu')`, 3000);
  check('keyboard: Enter opens the menu with the focus on Light', (await focused()) === 'Screenshot, Light', await focused());
  await key('ArrowRight');
  check('keyboard: Right moves to Dim', (await focused()) === 'Screenshot, Dim', await focused());
  await key('ArrowDown');
  check('keyboard: Down moves to Save post', (await focused()).startsWith('Save post'), await focused());
  await shoot(x, 'x-menu-light');
  await key('ArrowRight');
  await untilWorld(`!!document.querySelector('.bb-sub')`, 3000);
  check('keyboard: Right on Save post opens the folder panel, cursor in its search', (await focused()) === 'Find or make a folder', await focused());
  check('folder panel says there are no folders yet', /No folders yet/.test(await inWorld(`document.querySelector('.bb-sub').textContent`)));
  await cdp.send('Input.insertText', { text: 'Ideas' }, x.sessionId);
  check('typing a new name offers to make that folder', /Make folder “Ideas”/.test(await inWorld(`document.querySelector('.bb-opt.is-active')?.textContent || ''`)));
  await key('Enter');
  let t = await waitToast(/Saved to Ideas/);
  check('Enter makes the folder and saves the post into it', t === 'Saved to Ideas', t);
  let st = await storage();
  const ideas = (st.folders || []).find((f) => f.name === 'Ideas');
  check('stored: folder Ideas, post saved in it', ideas && st['post:' + first.id]?.folders.includes(ideas.id), st);
  const saved = st['post:' + first.id];
  check(
    'stored: link, author, text, pictures and date are kept',
    saved && saved.url === `https://x.com/maralind/status/${first.id}` && saved.name === 'Mara Lindqvist' && saved.handle === 'maralind' && saved.text.startsWith('Spent the morning') &&
      saved.avatar.startsWith('https://pbs.twimg.com/profile_images/') && /name=small/.test(saved.media) && saved.postedAt === Date.parse(first.time),
    saved
  );
  check('focus goes back to the icon after saving', /Bowerbird/.test(await focused()), await focused());
  check('the icon shows the post is saved', await untilWorld(`${articleSel(first.id)}.querySelector('.bb-btn').classList.contains('is-saved')`, 3000));

  // ---- Esc steps back out ----
  await key('Enter');
  await untilWorld(`!!document.querySelector('.bb-menu')`, 3000);
  check('the menu shows which folder the post is in', /Ideas/.test(await inWorld(`document.querySelector('.bb-has-sub .bb-hint')?.textContent || ''`)));
  await key('ArrowDown');
  await key('ArrowRight');
  await untilWorld(`!!document.querySelector('.bb-sub')`, 3000);
  await key('Escape');
  check('Esc in the folder panel goes back to Save post', !(await inWorld(`!!document.querySelector('.bb-sub')`)) && (await focused()).startsWith('Save post'), await focused());
  await key('Escape');
  check('Esc again closes the menu and puts the focus back on the icon', !(await inWorld(`!!document.querySelector('.bb-menu')`)) && /Bowerbird/.test(await focused()), await focused());

  // ---- mouse: Save post, folder panel on hover ----
  const second = POSTS[1];
  await clickEl(`${articleSel(second.id)}.querySelector('.bb-btn')`);
  await untilWorld(`!!document.querySelector('.bb-menu')`, 3000);
  await clickEl(`document.querySelector('.bb-has-sub')`);
  t = await waitToast(/Saved to Bowerbird|Already/);
  check('click on Save post saves it without a folder', t === 'Saved to Bowerbird' && (await storage())['post:' + second.id]?.folders.length === 0, t);

  await clickEl(`${articleSel(second.id)}.querySelector('.bb-btn')`);
  await untilWorld(`!!document.querySelector('.bb-menu')`, 3000);
  await hoverEl(`document.querySelector('.bb-has-sub')`);
  await untilWorld(`!!document.querySelector('.bb-sub')`, 3000);
  check('hovering Save post opens the folder panel', true);
  await cdp.send('Input.insertText', { text: 'Writing tips' }, x.sessionId);
  await shoot(x, 'x-panel-light');
  await key('Enter');
  t = await waitToast(/Saved to Writing tips/);
  check('mouse and typing: saved to a second new folder', t === 'Saved to Writing tips', t);

  await clickEl(`${articleSel(second.id)}.querySelector('.bb-btn')`);
  await untilWorld(`!!document.querySelector('.bb-menu')`, 3000);
  await hoverEl(`document.querySelector('.bb-has-sub')`);
  await untilWorld(`!!document.querySelector('.bb-sub .bb-opt')`, 3000);
  check('ticked folders show as selected', await inWorld(`[...document.querySelectorAll('.bb-sub .bb-opt')].find((o) => o.textContent === 'Writing tips')?.getAttribute('aria-selected') === 'true'`));
  await clickEl(`[...document.querySelectorAll('.bb-sub .bb-opt')].find((o) => o.textContent === 'Ideas')`);
  t = await waitToast(/Saved to Ideas/);
  check('clicking a folder adds the post to it', t === 'Saved to Ideas', t);
  await clickEl(`${articleSel(second.id)}.querySelector('.bb-btn')`);
  await untilWorld(`!!document.querySelector('.bb-menu')`, 3000);
  await hoverEl(`document.querySelector('.bb-has-sub')`);
  await untilWorld(`!!document.querySelector('.bb-sub .bb-opt')`, 3000);
  await clickEl(`[...document.querySelectorAll('.bb-sub .bb-opt')].find((o) => o.textContent === 'Ideas')`);
  t = await waitToast(/Removed from Ideas/);
  check('clicking a ticked folder takes the post out again', t === 'Removed from Ideas' && !(await storage())['post:' + second.id].folders.includes(ideas.id), t);

  // ---- screenshots ----
  for (const theme of ['light', 'dim', 'dark']) {
    await clickEl(`${articleSel(first.id)}.querySelector('.bb-btn')`);
    await untilWorld(`!!document.querySelector('.bb-menu')`, 3000);
    await clickEl(`document.querySelector('.bb-pill[data-swatch="${theme}"]')`);
    t = await waitToast(/copied|saved|failed|Couldn/i, 10000);
    const file = await waitFile(new RegExp(`bowerbird-maralind-${first.id}-${theme}\\.png$`));
    const info = file && pngInfo(file);
    const bg = { light: '#ffffff', dim: '#15202b', dark: '#000000' }[theme];
    check(`screenshot ${theme}: copied and saved`, t === 'Screenshot copied and saved to Downloads', t);
    check(`screenshot ${theme}: a ${bg} PNG, 2x sharp (1120 px wide)`, info && info.w === 1120 && info.corner === bg, info);
    if (file) fs.copyFileSync(file, path.join(OUT, `shot-${theme}.png`));
    await sleep(300);
  }
  const clip = await cdp.eval(x.sessionId, `navigator.clipboard.read().then((items) => items.flatMap((i) => i.types))`, undefined).catch((e) => e.message);
  check('the clipboard holds a PNG image', Array.isArray(clip) && clip.includes('image/png'), clip);

  // With counts and the padded background.
  await setStorage({ settings: { copy: true, download: true, stats: true, frame: true } });
  await sleep(200);
  await clickEl(`${articleSel(first.id)}.querySelector('.bb-btn')`);
  await untilWorld(`!!document.querySelector('.bb-menu')`, 3000);
  fs.readdirSync(downloads).forEach((f) => fs.rmSync(path.join(downloads, f)));
  await clickEl(`document.querySelector('.bb-pill[data-swatch="light"]')`);
  let file = await waitFile(/-light\.png$/, 10000);
  let info = file && pngInfo(file);
  check('screenshot with padding: wider (1280 px) with the soft background', info && info.w === 1280 && info.corner === '#e2ebf6', info);
  if (file) fs.copyFileSync(file, path.join(OUT, 'shot-light-framed.png'));

  // Download off: copy only.
  await setStorage({ settings: { copy: true, download: false, stats: false, frame: false } });
  await sleep(200);
  fs.readdirSync(downloads).forEach((f) => fs.rmSync(path.join(downloads, f)));
  await clickEl(`${articleSel(POSTS[2].id)}.querySelector('.bb-btn')`);
  await untilWorld(`!!document.querySelector('.bb-menu')`, 3000);
  await clickEl(`document.querySelector('.bb-pill[data-swatch="dim"]')`);
  t = await waitToast(/copied|saved|failed|Couldn/i, 10000);
  await sleep(600);
  check('with saving off: copied only, no file', t === 'Screenshot copied' && fs.readdirSync(downloads).length === 0, { t, files: fs.readdirSync(downloads) });
  await setStorage({ settings: { copy: true, download: true, stats: false, frame: false } });

  // Quoted post renders.
  const quoteBlob = await inWorld(`Shot.render(Post.read(${articleSel(POSTS[2].id)}), 'dark', {}).then((b) => b.size)`);
  check('a post that quotes another post renders', quoteBlob > 10000, quoteBlob);
  const readQuote = await inWorld(`(() => { const p = Post.read(${articleSel(POSTS[2].id)}); return { q: p.quote?.handle, qt: p.quote?.runs.map((r) => r.text).join(''), stats: p.stats }; })()`);
  check('reads the quoted post and the counts', readQuote.q === 'solmarin' && /Warm and cool/.test(readQuote.qt) && readQuote.stats?.likes === 410 && readQuote.stats?.views === 9800, readQuote);

  // ---- Remove + Undo from the panel ----
  await clickEl(`${articleSel(second.id)}.querySelector('.bb-btn')`);
  await untilWorld(`!!document.querySelector('.bb-menu')`, 3000);
  await hoverEl(`document.querySelector('.bb-has-sub')`);
  await untilWorld(`!!document.querySelector('.bb-sub .bb-danger')`, 3000);
  await clickEl(`document.querySelector('.bb-sub .bb-danger')`);
  t = await waitToast(/Removed from Bowerbird/);
  check('Remove from Bowerbird removes the saved post', t.startsWith('Removed from Bowerbird') && !(await storage())['post:' + second.id], t);
  await clickEl(`document.querySelector('.bb-toast .bb-toast-btn')`);
  await sleep(400);
  check('Undo brings it back with its folders', (await storage())['post:' + second.id]?.folders.length === 1);

  // ---- X's theme ----
  for (const theme of ['dim', 'dark']) {
    const s = await openTab(`https://x.com/home?theme=${theme}`, `x.com ${theme}`, { width: 1280, height: 900 });
    await cdp.send('Page.bringToFront', {}, s.sessionId);
    await cdp.until(s.sessionId, `document.querySelectorAll('article').length > 0`, 5000);
    const prev = x;
    x = s;
    await untilWorld(`document.querySelectorAll('.bb-btn').length === ${POSTS.length}`, 8000);
    await clickEl(`${articleSel(first.id)}.querySelector('.bb-btn')`);
    await untilWorld(`!!document.querySelector('.bb-menu')`, 3000);
    check(`menu follows X's ${theme} theme`, (await inWorld(`document.querySelector('.bb-menu').dataset.theme`)) === theme);
    await hoverEl(`document.querySelector('.bb-has-sub')`);
    await untilWorld(`!!document.querySelector('.bb-sub')`, 3000);
    await shoot(x, `x-panel-${theme}`);
    await key('Escape');
    await key('Escape');
    x = prev;
    await cdp.send('Target.closeTarget', { targetId: s.targetId });
  }
  await cdp.send('Page.bringToFront', {}, x.sessionId);

  // Save the other posts for the page tests.
  for (const p of POSTS.slice(2)) await inWorld(`Store.savePost(Post.read(${articleSel(p.id)}))`);
  st = await storage();
  check('all four posts are saved', POSTS.every((p) => st['post:' + p.id]), Object.keys(st));

  // ================= Bowerbird's page =================
  const pageUrl = `chrome-extension://${extId}/page/folders.html`;
  const pageReqs = [];
  const pg = await cdp.open('about:blank', { width: 1280, height: 900 });
  names.set(pg.sessionId, 'folders page');
  await cdp.send('Log.enable', {}, pg.sessionId);
  await cdp.send('Network.enable', {}, pg.sessionId);
  cdp.on((m) => m.sessionId === pg.sessionId && m.method === 'Network.requestWillBeSent' && pageReqs.push(m.params.request.url));
  await cdp.send('Page.bringToFront', {}, pg.sessionId);
  const loaded = cdp.waitFor((m) => m.sessionId === pg.sessionId && m.method === 'Page.loadEventFired', 15000);
  await cdp.send('Page.navigate', { url: pageUrl + '#all' }, pg.sessionId);
  await loaded;
  const P = (expr) => cdp.eval(pg.sessionId, expr);
  const PU = (expr, ms) => cdp.until(pg.sessionId, expr, ms);
  const pkey = (k, opts) => cdp.key(pg.sessionId, k, k === 'Enter' ? { text: '\r', ...opts } : opts);
  const pclick = async (expr) => {
    const r = await P(`(() => { const e = ${expr}; e.scrollIntoView({ block: 'center' }); const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
    await cdp.click(pg.sessionId, r.x, r.y);
  };
  const ptoast = async (re, ms = 4000) => {
    const end = Date.now() + ms;
    let v = '';
    while (Date.now() < end) {
      v = await P(`document.querySelector('#toast.is-on')?.firstChild?.textContent || ''`);
      if (re.test(v)) return v;
      await sleep(60);
    }
    return v;
  };

  // Headless Edge follows the computer's light or dark setting; start in light.
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] }, pg.sessionId);
  await PU(`document.querySelectorAll('#list .row:not(.is-skeleton)').length === 4`, 5000);
  check('page: lists the four saved posts, newest first', (await P(`document.querySelector('#list .row').dataset.id`)) === POSTS[3].id, await P(`[...document.querySelectorAll('#list .row')].map((r) => r.dataset.id)`));
  check('page: folders column has All, Unsorted, Ideas, Writing tips with counts', (await P(`[...document.querySelectorAll('.folder-link')].map((a) => a.textContent).join('|')`)) === 'All posts4|Unsorted2|Ideas1|Writing tips1', await P(`[...document.querySelectorAll('.folder-link')].map((a) => a.textContent).join('|')`));
  check('page: pictures load from the image server', await PU(`[...document.querySelectorAll('img.row__pic')].length === 4 && [...document.querySelectorAll('img.row__pic')].every((i) => i.complete && i.naturalWidth > 0)`, 5000));
  await shoot(pg, 'page-all-light');

  // "/" jumps to search.
  await P(`document.activeElement.blur()`);
  await pkey('/', { text: '/' });
  check('page: "/" puts the cursor in search', (await P(`document.activeElement.id`)) === 'q');
  await cdp.send('Input.insertText', { text: 'okafor' }, pg.sessionId);
  await sleep(100);
  check('page: search finds by name', (await P(`document.querySelectorAll('#list .row').length`)) === 1 && /1 found/.test(await P(`document.querySelector('#folder-count').textContent`)));
  await pkey('Escape');
  check('page: Esc clears the search', (await P(`document.querySelectorAll('#list .row').length`)) === 4);
  await cdp.send('Input.insertText', { text: 'zzzz' }, pg.sessionId);
  await sleep(100);
  check('page: no match shows a clear message', /No saved posts match “zzzz”/.test(await P(`document.querySelector('#empty').textContent`)));
  await pkey('Escape');

  // Folder view by link.
  await pclick(`[...document.querySelectorAll('.folder-link')].find((a) => /Ideas/.test(a.textContent))`);
  await PU(`location.hash.startsWith('#folder/')`, 3000);
  check('page: a folder shows only its posts, with Rename and Delete', (await P(`document.querySelectorAll('#list .row').length`)) === 1 && !(await P(`document.querySelector('#folder-tools').hidden`)));

  // New folder.
  await pclick(`document.querySelector('#new-folder-name')`);
  await cdp.send('Input.insertText', { text: 'Read later' }, pg.sessionId);
  await pkey('Enter');
  await PU(`document.querySelector('#folder-title').textContent === 'Read later'`, 3000);
  check('page: New folder makes it and opens it, empty', /Nothing in Read later yet/.test(await P(`document.querySelector('#empty').textContent`)));
  await shoot(pg, 'page-empty-folder');

  // Add a post to a folder from All posts.
  await pclick(`[...document.querySelectorAll('.folder-link')].find((a) => /All posts/.test(a.textContent))`);
  await PU(`location.hash === '#all'`, 3000);
  const target = POSTS[3].id;
  await P(`(() => { const s = document.querySelector('.row[data-id="${target}"] select'); s.value = [...s.options].find((o) => o.textContent === 'Read later').value; s.dispatchEvent(new Event('change')); })()`);
  check('page: the folder picker adds a post to a folder', /Added to Read later/.test(await ptoast(/Added/)));
  await PU(`/Read later/.test(document.querySelector('.row[data-id="${target}"] .chips').textContent)`, 3000);
  check('page: the post shows the folder as a chip', true);

  // Take out of a folder + Undo.
  await pclick(`document.querySelector('.row[data-id="${target}"] .chip button')`);
  check('page: × takes a post out of a folder', /Taken out of Read later/.test(await ptoast(/Taken out/)));
  await pclick(`document.querySelector('#toast button')`);
  await PU(`/Read later/.test(document.querySelector('.row[data-id="${target}"] .chips').textContent)`, 3000);
  check('page: Undo puts it back in the folder', true);

  // Rename.
  const readLater = (await storage()).folders.find((f) => f.name === 'Read later');
  await P(`location.hash = '#folder/${readLater.id}'`);
  await PU(`document.querySelector('#folder-title').textContent === 'Read later'`, 3000);
  await pclick(`document.querySelector('#rename')`);
  await PU(`document.activeElement?.classList.contains('title-input')`, 2000);
  await P(`document.activeElement.select()`);
  await cdp.send('Input.insertText', { text: 'Later' }, pg.sessionId);
  await pkey('Enter');
  await PU(`document.querySelector('#folder-title').textContent === 'Later'`, 3000);
  check('page: Rename changes the folder name', (await storage()).folders.some((f) => f.name === 'Later' && f.id === readLater.id));

  // Rename onto an existing name merges.
  await pclick(`document.querySelector('#rename')`);
  await PU(`document.activeElement?.classList.contains('title-input')`, 2000);
  await P(`document.activeElement.select()`);
  await cdp.send('Input.insertText', { text: 'ideas' }, pg.sessionId);
  await pkey('Enter');
  t = await ptoast(/Moved its posts/);
  st = await storage();
  check('page: renaming to an existing name merges the two folders', t === 'Moved its posts into Ideas' && !st.folders.some((f) => f.id === readLater.id) && st['post:' + target].folders.includes(ideas.id), { t, folders: st.folders });

  // Delete + Undo.
  await P(`location.hash = '#folder/${ideas.id}'`);
  await PU(`document.querySelector('#folder-title').textContent === 'Ideas'`, 3000);
  await pclick(`document.querySelector('#delete')`);
  t = await ptoast(/Deleted Ideas/);
  st = await storage();
  check('page: Delete folder removes it and keeps its posts', /Its 2 posts stay saved/.test(t) && !st.folders.some((f) => f.id === ideas.id) && st['post:' + first.id], { t });
  await pclick(`document.querySelector('#toast button')`);
  await PU(`document.querySelector('#folder-title').textContent === 'Ideas'`, 3000);
  st = await storage();
  check('page: Undo brings the folder back with its posts', st['post:' + first.id].folders.includes(ideas.id) && st['post:' + target].folders.includes(ideas.id));

  // Remove a post + Undo, with the focus kept in the list.
  await P(`location.hash = '#all'`);
  await PU(`document.querySelectorAll('#list .row').length === 4`, 3000);
  await P(`document.querySelector('.row[data-id="${POSTS[2].id}"] [data-focus$=":remove"]').focus()`);
  await pkey('Enter');
  t = await ptoast(/Removed from Bowerbird/);
  check('page: keyboard Remove removes the post', t === 'Removed from Bowerbird' && (await P(`document.querySelectorAll('#list .row').length`)) === 3);
  check('page: after Remove the focus stays in the list', await P(`!!document.activeElement.closest('#list')`), await P(`document.activeElement.outerHTML.slice(0, 80)`));
  await pclick(`document.querySelector('#toast button')`);
  await PU(`document.querySelectorAll('#list .row').length === 4`, 3000);
  check('page: Undo restores the post', true);

  // Settings.
  await P(`location.hash = '#settings'`);
  await PU(`!document.querySelector('#settings').hidden`, 2000);
  check('page: Settings shows the counts', (await P(`document.querySelector('#use-posts').textContent`)) === '4' && (await P(`document.querySelector('#use-folders').textContent`)) === '2');
  await pclick(`document.querySelector('#set-stats')`);
  await pclick(`document.querySelector('#set-frame')`);
  await sleep(200);
  st = await storage();
  check('page: screenshot options are saved', st.settings.stats === true && st.settings.frame === true, st.settings);
  await pclick(`document.querySelector('#set-copy')`);
  await pclick(`document.querySelector('#set-download')`);
  await sleep(200);
  st = await storage();
  check('page: copy and save can not both be off', st.settings.copy === true && st.settings.download === false, st.settings);
  await pclick(`document.querySelector('#set-download')`);
  await sleep(150);
  await shoot(pg, 'page-settings-light');

  // Export.
  fs.readdirSync(downloads).forEach((f) => fs.rmSync(path.join(downloads, f)));
  await pclick(`document.querySelector('#export')`);
  file = await waitFile(/^bowerbird-export-.*\.json$/);
  const exported = file && JSON.parse(fs.readFileSync(file, 'utf8'));
  check('page: Export saves a JSON file with every post and folder', exported?.app === 'bowerbird' && exported.posts.length === 4 && exported.folders.length === 2, exported && { posts: exported.posts.length });

  // Import (one new post, one new folder, one post already saved gains a folder).
  const importFile = path.join(work, 'import.json');
  fs.writeFileSync(
    importFile,
    JSON.stringify({
      app: 'bowerbird',
      version: 1,
      folders: [{ id: 'fother1', name: 'Imported' }],
      posts: [
        { id: '1700000000000000001', handle: 'someone', name: 'Someone', text: 'imported post', folders: ['fother1'], savedAt: 1, postedAt: 1 },
        { id: first.id, folders: ['fother1'] },
        { id: 'not-a-number', text: 'skipped' },
        { id: '1700000000000000002', handle: 'bad"handle', avatar: 'https://evil.example/x.png', text: '<img src=x onerror=alert(1)>' },
      ],
    })
  );
  const { root: doc } = await cdp.send('DOM.getDocument', {}, pg.sessionId);
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: doc.nodeId, selector: '#import-file' }, pg.sessionId);
  await cdp.send('DOM.setFileInputFiles', { nodeId, files: [importFile] }, pg.sessionId);
  await PU(`/Imported/.test(document.querySelector('#data-status').textContent)`, 4000);
  check('page: Import adds new posts and folders', (await P(`document.querySelector('#data-status').textContent`)) === 'Imported 2 new posts and 1 new folder.', await P(`document.querySelector('#data-status').textContent`));
  st = await storage();
  const evil = st['post:1700000000000000002'];
  check('page: Import cleans bad data (no outside pictures, safe handle)', evil && evil.avatar === '' && evil.handle === '' && evil.url === 'https://x.com/i/status/1700000000000000002', evil);
  check('page: Import merges folders into posts already saved', st['post:' + first.id].folders.length === 2);
  await P(`location.hash = '#all'`);
  await PU(`document.querySelectorAll('#list .row').length === 6`, 3000);
  check('page: imported text shows as text, never as HTML', await P(`!document.querySelector('#list img[src="x"]') && /<img src=x/.test(document.querySelector('.row[data-id="1700000000000000002"]').textContent)`));
  fs.writeFileSync(importFile, '{"hello": 1}');
  await cdp.send('DOM.setFileInputFiles', { nodeId: (await cdp.send('DOM.querySelector', { nodeId: (await cdp.send('DOM.getDocument', {}, pg.sessionId)).root.nodeId, selector: '#import-file' }, pg.sessionId)).nodeId, files: [importFile] }, pg.sessionId);
  await P(`location.hash = '#settings'`);
  await PU(`/not a Bowerbird export/.test(document.querySelector('#data-status').textContent)`, 4000);
  check('page: Import says when a file is not an export', /not a Bowerbird export/.test(await P(`document.querySelector('#data-status').textContent`)));

  // Dark mode.
  await P(`location.hash = '#all'`);
  await PU(`document.querySelectorAll('#list .row').length === 6`, 3000);
  const lightBg = await P(`getComputedStyle(document.body).backgroundColor`);
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }, pg.sessionId);
  await sleep(150);
  const darkBg = await P(`getComputedStyle(document.body).backgroundColor`);
  check('page: dark mode turns the page dark', lightBg !== darkBg && /oklch\(0\.14|rgb\((\d|1\d),/.test(darkBg), { lightBg, darkBg });
  await shoot(pg, 'page-all-dark');
  await P(`location.hash = '#settings'`);
  await sleep(150);
  await shoot(pg, 'page-settings-dark');
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] }, pg.sessionId);

  // Phone width.
  await P(`location.hash = '#all'`);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: false }, pg.sessionId);
  await sleep(200);
  check('page: no sideways scrolling at 375 px', await P(`document.documentElement.scrollWidth <= innerWidth`), await P(`document.documentElement.scrollWidth`));
  await shoot(pg, 'page-phone');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, pg.sessionId);

  // Keyboard reach: every control can be reached with Tab and has a visible focus style.
  const tabStops = [];
  const reloaded = cdp.waitFor((m) => m.sessionId === pg.sessionId && m.method === 'Page.loadEventFired', 15000);
  await cdp.send('Page.reload', {}, pg.sessionId);
  await reloaded;
  await PU(`document.querySelectorAll('#list .row').length === 6`, 3000);
  for (let i = 0; i < 18; i++) {
    await pkey('Tab');
    tabStops.push(await P(`(() => { const a = document.activeElement; const cs = getComputedStyle(a); return { el: (a.id || a.className || a.tagName) + '', ring: cs.outlineStyle !== 'none' || cs.boxShadow !== 'none' }; })()`));
  }
  check('page: Tab reaches the skip link, tabs, folders, search and posts', ['skip', 'mark', 'q'].every((k) => tabStops.some((s) => s.el.includes(k))) && tabStops.some((s) => s.el.includes('folder-link')), tabStops.map((s) => s.el));
  check('page: every Tab stop shows a focus ring', tabStops.every((s) => s.ring), tabStops.filter((s) => !s.ring));

  // Nothing but its own files and the post pictures.
  const outside = pageReqs.filter((u) => !u.startsWith(`chrome-extension://${extId}/`) && !u.startsWith('https://pbs.twimg.com/') && !u.startsWith('data:') && !u.startsWith('blob:'));
  check('page: loads nothing except its own files and pictures from pbs.twimg.com', outside.length === 0, outside);
  const xOutside = requests.filter((r) => r.host !== 'x.com' && r.host !== 'pbs.twimg.com');
  check('nothing contacts any host other than x.com and pbs.twimg.com', xOutside.length === 0, xOutside);

  // Toolbar button and "Open saved posts" open this page.
  const before = (await cdp.send('Target.getTargets')).targetInfos.filter((t) => t.url.startsWith(pageUrl)).length;
  await cdp.send('Page.bringToFront', {}, x.sessionId);
  await clickEl(`${articleSel(first.id)}.querySelector('.bb-btn')`);
  await untilWorld(`!!document.querySelector('.bb-menu')`, 3000);
  await clickEl(`[...document.querySelectorAll('.bb-menu .bb-item')].find((b) => b.textContent === 'Open saved posts')`);
  await sleep(800);
  const after = (await cdp.send('Target.getTargets')).targetInfos.filter((t) => t.url.startsWith(pageUrl)).length;
  check('"Open saved posts" opens (or switches to) the Bowerbird page', after >= before && after >= 1, { before, after });
} catch (e) {
  check('the test ran to the end', false, e.stack || e.message);
} finally {
  await sleep(300);
  check('no errors or warnings in the console, on x.com, the page or the background', problems.length === 0, problems);
  await cdp.close();
  fake.close();
  fs.rmSync(work, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed. Screenshots: ${path.relative(root, OUT)}`);
process.exit(failed.length ? 1 : 0);
