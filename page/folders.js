// Bowerbird's page: browse saved posts by folder, search them, tidy folders, and change settings.
// It reads and writes chrome.storage.local through store.js. It makes no network requests of its own;
// the only things it loads from outside are the profile pictures and post pictures from X's image server.

const $ = (s) => document.querySelector(s);
const PAGE_SIZE = 100;
let data = null; // { posts, folders, recent, settings }
let current = 'all'; // 'all', 'unsorted' or a folder id
let query = '';
let limit = PAGE_SIZE;
let renaming = false;

// ---------- small helpers ----------
function h(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
function btn(cls, text) {
  const b = h('button', cls, text);
  b.type = 'button';
  return b;
}
const ICONS = {
  link: '<path d="M9.5 14.5 14.5 9.5M10.5 6.5l1.8-1.8a4 4 0 0 1 5.7 5.7l-1.8 1.8M13.5 17.5l-1.8 1.8a4 4 0 0 1-5.7-5.7l1.8-1.8"/>',
  trash: '<path d="M4.5 7h15M10 11v6M14 11v6M6.5 7l1 12a2 2 0 0 0 2 2h5a2 2 0 0 0 2-2l1-12M9.5 7V4.5h5V7"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;
function iconBtn(name, label, cls = '') {
  const b = btn('icon-btn ' + cls);
  b.innerHTML = icon(name);
  b.title = label;
  b.setAttribute('aria-label', label);
  return b;
}
const plural = (n, one, many = one + 's') => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
const folderById = (id) => data?.folders.find((f) => f.id === id) || null;
const POST_URL = /^https:\/\/x\.com\/[A-Za-z0-9_]{1,15}\/status\/\d{1,25}$/;
const safeUrl = (p) => (POST_URL.test(p.url) ? p.url : `https://x.com/i/status/${p.id}`);
const fmtDate = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
function fmtBytes(n) {
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
const ownError = (e) => (/context invalidated/i.test(e?.message || '') ? 'Bowerbird was updated. Reload this page.' : e?.message || String(e));

let toastTimer;
function toast(msg, action) {
  const t = $('#toast');
  t.replaceChildren(h('span', null, msg));
  if (action) {
    const b = btn(null, action.label);
    b.addEventListener('click', () => {
      t.classList.remove('is-on');
      action.run();
    });
    t.append(b);
  }
  t.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('is-on'), action ? 6000 : 2600);
}
async function attempt(fn) {
  try {
    return await fn();
  } catch (e) {
    toast(ownError(e));
    return undefined;
  }
}

// ---------- where you are (kept in the address, so reload and back work) ----------
// #all, #unsorted, #folder/<id>, #settings
function readHash() {
  const raw = decodeURIComponent(location.hash.slice(1));
  if (raw === 'settings') return { view: 'settings' };
  if (raw === 'unsorted') return { view: 'posts', folder: 'unsorted' };
  if (raw.startsWith('folder/')) return { view: 'posts', folder: raw.slice(7) };
  return { view: 'posts', folder: 'all' };
}
const hashFor = (folder) => (folder === 'all' ? '#all' : folder === 'unsorted' ? '#unsorted' : `#folder/${encodeURIComponent(folder)}`);
function go(folder) {
  if (location.hash !== hashFor(folder)) location.hash = hashFor(folder);
  else route(false);
}

let lastView = null;
function route(moveFocus = true) {
  const { view, folder } = readHash();
  $('#posts').hidden = view !== 'posts';
  $('#settings').hidden = view !== 'settings';
  document.querySelectorAll('[data-tab]').forEach((a) => {
    if (a.dataset.tab === view) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  if (view === 'posts') {
    const next = folder === 'all' || folder === 'unsorted' || !data || folderById(folder) ? folder : 'all';
    if (next !== current) limit = PAGE_SIZE;
    current = next;
    stopRename();
    document.title = current === 'all' ? 'Bowerbird: saved posts' : `Bowerbird: ${folderTitle()}`;
  } else document.title = 'Bowerbird: settings';
  if (data) render();
  if (moveFocus && lastView && lastView !== view) (view === 'settings' ? $('#settings-h') : $('#folder-title')).focus({ preventScroll: true });
  if (lastView !== view) scrollTo(0, 0);
  lastView = view;
}
addEventListener('hashchange', () => route(true));

function folderTitle() {
  if (current === 'all') return 'All posts';
  if (current === 'unsorted') return 'Unsorted';
  return folderById(current)?.name || 'All posts';
}

// ---------- drawing ----------
function render() {
  const all = Object.values(data.posts).sort((a, b) => b.savedAt - a.savedAt);
  renderNav(all);
  renderHead(all);
  renderList(all);
  renderSettings(all);
}

function renderNav(all) {
  const counts = new Map();
  let unsorted = 0;
  for (const p of all) {
    if (!p.folders.length) unsorted++;
    for (const f of p.folders) counts.set(f, (counts.get(f) || 0) + 1);
  }
  const link = (label, n, key) => {
    const li = h('li');
    const a = h('a', 'folder-link');
    a.href = hashFor(key);
    a.append(h('span', 'folder-link__name', label), h('span', 'count', String(n)));
    if (key === current) a.setAttribute('aria-current', 'true');
    li.append(a);
    return li;
  };
  const items = [link('All posts', all.length, 'all')];
  if (data.folders.length) items.push(link('Unsorted', unsorted, 'unsorted'));
  items[items.length - 1].classList.add('is-gap');
  for (const f of data.folders) items.push(link(f.name, counts.get(f.id) || 0, f.id));
  if (!data.folders.length) items[0].classList.remove('is-gap');
  const keep = document.activeElement?.closest?.('#folder-nav') ? document.activeElement.getAttribute('href') : null;
  $('#folder-nav').replaceChildren(...items);
  if (keep) $(`#folder-nav a[href="${CSS.escape(keep)}"]`)?.focus({ preventScroll: true });
}

function shownPosts(all) {
  let list = all;
  if (current === 'unsorted') list = list.filter((p) => !p.folders.length);
  else if (current !== 'all') list = list.filter((p) => p.folders.includes(current));
  if (query) {
    const q = query.toLowerCase();
    list = list.filter((p) =>
      [p.text, p.name, p.handle, '@' + p.handle, ...p.folders.map((f) => folderById(f)?.name)].some((s) => (s || '').toLowerCase().includes(q))
    );
  }
  return list;
}

function renderHead(all) {
  if (!renaming) $('#folder-title').textContent = folderTitle();
  const n = shownPosts(all).length;
  $('#folder-count').textContent = query ? `${n.toLocaleString('en-US')} found` : plural(n, 'post');
  $('#folder-tools').hidden = current === 'all' || current === 'unsorted' || !folderById(current);
}

function renderList(all) {
  const list = $('#list');
  const shown = shownPosts(all);
  // Keep the keyboard focus on the same control (or the same place) after a redraw.
  const active = document.activeElement;
  const key = active?.dataset?.focus || '';
  const rowsBefore = [...list.children];
  const rowIndex = rowsBefore.indexOf(active?.closest?.('.row'));

  list.replaceChildren(...shown.slice(0, limit).map(row));
  list.removeAttribute('aria-busy');
  $('#more-wrap').hidden = shown.length <= limit;
  $('#more').textContent = `Show ${Math.min(PAGE_SIZE, shown.length - limit)} more`;

  if (key || rowIndex >= 0) {
    const same = key && list.querySelector(`[data-focus="${CSS.escape(key)}"]`);
    const near = list.children[Math.min(rowIndex, list.children.length - 1)]?.querySelector('[data-focus$=":name"]');
    (same || near || $('#folder-title')).focus({ preventScroll: true });
  }
  renderEmpty(all, shown);
}

function renderEmpty(all, shown) {
  const empty = $('#empty');
  empty.classList.remove('is-error');
  empty.hidden = shown.length > 0;
  $('#list').hidden = shown.length === 0;
  if (shown.length) return;
  const parts = [];
  if (!all.length) {
    const open = h('a', 'btn btn--ink', 'Open x.com');
    open.href = 'https://x.com/home';
    open.target = '_blank';
    open.rel = 'noopener';
    parts.push(
      h('p', 'empty__title', 'Nothing saved yet'),
      h('p', null, 'On x.com, click the Bowerbird icon next to Bookmark under any post, then choose Save post. Point at Save post to pick a folder.'),
      open
    );
  } else if (query) {
    const clear = btn('btn btn--line', 'Clear search');
    clear.addEventListener('click', () => {
      setQuery('');
      $('#q').focus();
    });
    parts.push(h('p', 'empty__title', `No saved posts match “${query}”`), h('p', null, 'Search looks at the text, names, @handles and folder names.'), clear);
  } else if (current === 'unsorted') {
    parts.push(h('p', 'empty__title', 'Every saved post is in a folder'), h('p', null, 'Posts you save without picking a folder show up here.'));
  } else {
    parts.push(
      h('p', 'empty__title', `Nothing in ${folderTitle()} yet`),
      h('p', null, `On x.com, open the Bowerbird menu under a post, point at Save post and tick ${folderTitle()}. Or add posts from All posts below their text.`)
    );
  }
  empty.replaceChildren(...parts);
}

function renderLoadError(err) {
  const list = $('#list');
  list.replaceChildren();
  list.removeAttribute('aria-busy');
  list.hidden = true;
  const empty = $('#empty');
  const retry = btn('btn btn--line', 'Try again');
  retry.addEventListener('click', start);
  empty.classList.add('is-error');
  empty.replaceChildren(
    h('p', 'empty__title', 'Couldn’t read your saved posts'),
    h('p', null, `${ownError(err)} Try again. If it keeps happening, turn Bowerbird off and on in chrome://extensions.`),
    retry
  );
  empty.hidden = false;
}

function row(p) {
  const url = safeUrl(p);
  const li = h('li', 'row');
  li.dataset.id = p.id;

  const src = Store.safeImg(p.avatar);
  const pic = h(src ? 'img' : 'span', 'row__pic');
  if (src) {
    Object.assign(pic, { src, alt: '', loading: 'lazy', width: 48, height: 48, referrerPolicy: 'no-referrer' });
    pic.addEventListener('error', () => pic.replaceWith(h('span', 'row__pic')), { once: true });
  }

  const body = h('div', 'row__body');
  const head = h('div', 'row__head');
  const name = h('a', 'row__name', p.name || (p.handle ? '@' + p.handle : 'Post'));
  Object.assign(name, { href: url, target: '_blank', rel: 'noopener' });
  name.dataset.focus = `${p.id}:name`;
  head.append(name);
  if (p.handle) head.append(h('span', 'row__handle', '@' + p.handle));

  const text = h('a', 'row__text', p.text || 'Open the post on x.com');
  Object.assign(text, { href: url, target: '_blank', rel: 'noopener', tabIndex: -1 });
  text.setAttribute('aria-hidden', 'true'); // the name above is the same link, for keyboards and screen readers

  const chips = h('div', 'chips');
  for (const fid of p.folders) {
    const f = folderById(fid);
    if (!f) continue;
    const chip = h('span', 'chip');
    chip.append(h('span', null, f.name));
    const x = btn(null);
    x.innerHTML = icon('x');
    x.title = `Take out of ${f.name}`;
    x.setAttribute('aria-label', `Take this post out of ${f.name}`);
    x.dataset.focus = `${p.id}:out:${f.id}`;
    x.addEventListener('click', async () => {
      if (await attempt(() => Store.removeFromFolder(p.id, f.id).then(() => true))) {
        toast(`Taken out of ${f.name}`, { label: 'Undo', run: () => attempt(() => Store.savePost(p, f.id)) });
      }
    });
    chip.append(x);
    chips.append(chip);
  }
  const free = data.folders.filter((f) => !p.folders.includes(f.id));
  if (free.length) {
    const sel = h('select', 'add-folder');
    sel.setAttribute('aria-label', 'Add this post to a folder');
    sel.dataset.focus = `${p.id}:add`;
    const first = h('option', null, p.folders.length ? '+ Folder' : '+ Add to a folder');
    first.value = '';
    sel.append(first, ...free.map((f) => Object.assign(h('option', null, f.name), { value: f.id })));
    sel.addEventListener('change', async () => {
      const f = folderById(sel.value);
      if (f && (await attempt(() => Store.savePost(p, f.id)))) toast(`Added to ${f.name}`);
    });
    chips.append(sel);
  }
  body.append(head, text);
  if (chips.children.length) body.append(chips);

  const aside = h('div', 'row__aside');
  if (p.postedAt) {
    const t = h('time', 'row__date', fmtDate(p.postedAt));
    t.dateTime = new Date(p.postedAt).toISOString();
    t.title = `Posted ${new Date(p.postedAt).toLocaleString()}`;
    aside.append(t);
  }
  const media = Store.safeImg(p.media);
  if (media) {
    const img = h('img', 'row__thumb');
    Object.assign(img, { src: media, alt: '', loading: 'lazy', width: 88, height: 88, referrerPolicy: 'no-referrer' });
    img.addEventListener('error', () => img.remove(), { once: true });
    aside.append(img);
  }
  const actions = h('div', 'row__actions');
  const copy = iconBtn('link', 'Copy link');
  copy.dataset.focus = `${p.id}:copy`;
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied');
    } catch {
      toast('Couldn’t copy the link');
    }
  });
  const del = iconBtn('trash', 'Remove from Bowerbird', 'is-danger');
  del.dataset.focus = `${p.id}:remove`;
  del.addEventListener('click', async () => {
    const removed = await attempt(() => Store.removePost(p.id));
    if (removed) toast('Removed from Bowerbird', { label: 'Undo', run: () => attempt(() => Store.restorePost(removed)) });
  });
  actions.append(copy, del);
  aside.append(actions);

  li.append(pic, body, aside);
  return li;
}

// ---------- search ----------
function setQuery(v) {
  query = v.trim();
  $('#q').value = v;
  limit = PAGE_SIZE;
  if (data) {
    const all = Object.values(data.posts).sort((a, b) => b.savedAt - a.savedAt);
    renderHead(all);
    renderList(all);
  }
}
$('#q').addEventListener('input', (e) => setQuery(e.target.value));
$('#q').addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && e.target.value) {
    e.preventDefault();
    setQuery('');
  }
});
// "/" jumps to search, unless you're typing somewhere.
document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
  e.preventDefault();
  if (readHash().view !== 'posts') go(current);
  $('#q').focus();
});
$('#more').addEventListener('click', () => {
  limit += PAGE_SIZE;
  render();
});

// ---------- folders ----------
$('#new-folder').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#new-folder-name');
  const name = Store.cleanName(input.value);
  if (!name) return input.focus();
  const existed = data.folders.find((f) => Store.sameName(f.name, name));
  const f = await attempt(() => Store.createFolder(name));
  if (!f) return;
  input.value = '';
  toast(existed ? `${f.name} is already a folder` : `Made folder ${f.name}`);
  go(f.id);
});

function stopRename() {
  if (!renaming) return;
  renaming = false;
  $('.title-input')?.remove();
  $('#folder-title').hidden = false;
}
$('#rename').addEventListener('click', () => {
  const f = folderById(current);
  if (!f || renaming) return;
  renaming = true;
  const title = $('#folder-title');
  const input = h('input', 'input title-input');
  Object.assign(input, { value: f.name, maxLength: Store.NAME_MAX, name: 'folder-name', autocomplete: 'off', spellcheck: false });
  input.setAttribute('aria-label', `New name for ${f.name}`);
  title.hidden = true;
  title.after(input);
  input.focus();
  input.select();
  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    const name = Store.cleanName(input.value);
    stopRename();
    if (save && name && name !== f.name) {
      const merged = data.folders.find((o) => o.id !== f.id && Store.sameName(o.name, name));
      const id = await attempt(() => Store.renameFolder(f.id, name));
      if (id) {
        toast(merged ? `Moved its posts into ${merged.name}` : `Renamed to ${name}`);
        go(id);
      }
    }
    $('#rename').focus({ preventScroll: true });
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      finish(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finish(false);
    }
  });
  input.addEventListener('blur', () => finish(true));
});

$('#delete').addEventListener('click', async () => {
  const f = folderById(current);
  if (!f) return;
  const undo = await attempt(() => Store.deleteFolder(f.id));
  if (!undo) return;
  go('all');
  $('#folder-title').focus({ preventScroll: true });
  const n = undo.postIds.length;
  toast(n ? `Deleted ${f.name}. Its ${plural(n, 'post')} stay saved` : `Deleted ${f.name}`, {
    label: 'Undo',
    run: async () => {
      await attempt(() => Store.restoreFolder(undo));
      go(f.id);
    },
  });
});

// ---------- settings ----------
const SETTINGS = [
  ['set-copy', 'copy'],
  ['set-download', 'download'],
  ['set-stats', 'stats'],
  ['set-frame', 'frame'],
];
for (const [id, key] of SETTINGS) {
  $('#' + id).addEventListener('change', async (e) => {
    const patch = { [key]: e.target.checked };
    // A screenshot has to go somewhere: keep at least one of copy and save on.
    if (key === 'copy' && !e.target.checked && !data.settings.download) patch.download = true;
    if (key === 'download' && !e.target.checked && !data.settings.copy) patch.copy = true;
    await attempt(() => Store.setSettings(patch));
  });
}
async function renderSettings(all) {
  for (const [id, key] of SETTINGS) $('#' + id).checked = !!data.settings[key];
  $('#use-posts').textContent = all.length.toLocaleString('en-US');
  $('#use-folders').textContent = data.folders.length.toLocaleString('en-US');
  $('#use-bytes').textContent = fmtBytes(await Store.bytesInUse());
}

function setStatus(text, ok) {
  const el = $('#data-status');
  el.className = 'status' + (text ? (ok ? ' is-ok' : ' is-bad') : '');
  el.textContent = text;
}
$('#export').addEventListener('click', async () => {
  const file = await attempt(() => Store.exportData());
  if (!file) return;
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
  const a = h('a');
  a.href = URL.createObjectURL(blob);
  a.download = `bowerbird-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  setStatus(`Exported ${plural(file.posts.length, 'post')} and ${plural(file.folders.length, 'folder')}.`, true);
});
$('#import').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const b = $('#import');
  b.setAttribute('aria-busy', 'true');
  b.disabled = true;
  try {
    if (file.size > 30 * 1024 * 1024) throw new Error('This file is too big to import');
    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      throw new Error('This file is not a Bowerbird export');
    }
    const res = await Store.importData(parsed);
    setStatus(`Imported ${plural(res.added, 'new post')} and ${plural(res.folders, 'new folder')}.`, true);
  } catch (err) {
    setStatus(ownError(err), false);
  } finally {
    b.removeAttribute('aria-busy');
    b.disabled = false;
  }
});

// ---------- start ----------
async function start() {
  try {
    data = await Store.load();
  } catch (err) {
    return renderLoadError(err);
  }
  route(false);
}
Store.onChange((changes) => {
  if (!data) return;
  Store.apply(data, changes);
  if (current !== 'all' && current !== 'unsorted' && !folderById(current)) return go('all');
  render();
});
$('#version').textContent = chrome.runtime.getManifest().version;
route(false);
start();
