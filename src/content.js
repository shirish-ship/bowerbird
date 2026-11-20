// Bowerbird on x.com: one small icon in every post's action bar, just left of Bookmark.
// It opens a menu: Screenshot (Light, Dim or Dark), Save post (into folders), Open saved posts.
// Everything it saves stays in this browser (see store.js). It never posts, likes or follows.

(() => {
  if (window.__bowerbird) return;
  window.__bowerbird = true;

  const REPLY = '[data-testid="reply"], [data-engagement-action="reply"]';
  const BOOKMARK = '[data-testid="bookmark"], [data-testid="removeBookmark"], [data-engagement-action="bookmark"]';
  const RELOAD = 'Bowerbird was updated. Refresh this tab, then try again.';

  // ---------- icons ----------
  const svg = (body, attrs = 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"') =>
    `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" ${attrs}>${body}</svg>`;
  // Bowerbird's mark: a plain bird holding a card. Outlined until the post is saved, then filled.
  const BIRD = 'M2.5 20.5A14.4 14.4 0 0 1 10.3 8.3A4.5 4.5 0 1 1 14.6 12.2V20.5Z';
  const BEAK = 'M18.6 6.1 21.8 8.2 18.6 10.1Z';
  const ICON = {
    mark: svg(
      `<path d="${BIRD}"/><path d="${BEAK}" fill="currentColor" stroke-width="1.2"/><circle cx="15.4" cy="7.4" r="1.15" fill="currentColor" stroke="none"/><path d="M6.2 14.6h3.6v3.6H6.2Z" fill="currentColor" stroke="none"/>`
    ),
    markSaved: svg(
      `<path fill-rule="evenodd" d="${BIRD}M16.55 7.4a1.15 1.15 0 1 0-2.3 0 1.15 1.15 0 1 0 2.3 0ZM6 14.4h4v4H6Z"/><path d="${BEAK}" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>`,
      'fill="currentColor"'
    ),
    camera: svg(
      '<path d="M3.75 8.25a2 2 0 0 1 2-2h1.9l1.4-2h5.9l1.4 2h1.9a2 2 0 0 1 2 2v9.5a2 2 0 0 1-2 2H5.75a2 2 0 0 1-2-2Z"/><circle cx="12" cy="12.75" r="3.5"/>'
    ),
    folder: svg('<path d="M3.75 6.75a2 2 0 0 1 2-2h3.6l2 2.25h6.9a2 2 0 0 1 2 2v8.25a2 2 0 0 1-2 2H5.75a2 2 0 0 1-2-2Z"/>'),
    library: svg(
      '<path d="M4.75 9.25h14.5v9a2 2 0 0 1-2 2H6.75a2 2 0 0 1-2-2Z"/><path d="M3.75 5.25a1 1 0 0 1 1-1h14.5a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H4.75a1 1 0 0 1-1-1Z"/><path d="M10 13h4"/>'
    ),
    search: svg('<circle cx="10.75" cy="10.75" r="6.5"/><path d="m15.5 15.5 4.75 4.75"/>'),
    chevron: svg('<path d="m9 6 6 6-6 6"/>'),
    check: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>', 'fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
  };

  // ---------- saved data ----------
  let state = { posts: {}, folders: [], recent: [], settings: { copy: true, download: true, stats: false, frame: false } };
  Store.load()
    .then((s) => {
      state = s;
      refreshButtons();
    })
    .catch(() => {});
  try {
    Store.onChange((changes) => {
      Store.apply(state, changes);
      refreshButtons();
    });
  } catch {}

  // Runs a storage action; says what went wrong instead of failing silently.
  async function attempt(fn) {
    try {
      return await fn();
    } catch (e) {
      const gone = /context invalidated|Extension context|receiving end/i.test(e?.message || '');
      toast(gone ? RELOAD : e?.message || 'Something went wrong. Try again.', true, 6000);
      return undefined;
    }
  }

  // ---------- small helpers ----------
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function button(cls, text) {
    const b = el('button', cls, text);
    b.type = 'button';
    return b;
  }
  const folderName = (id) => state.folders.find((f) => f.id === id)?.name || '';

  // X's theme, read from the page background: light, dim or dark.
  function pageTheme() {
    const m = getComputedStyle(document.body).backgroundColor.match(/\d+/g);
    if (!m) return 'light';
    const sum = +m[0] + +m[1] + +m[2];
    return sum < 30 ? 'dark' : sum < 300 ? 'dim' : 'light';
  }

  let toastEl;
  let toastTimer;
  // A short message at the bottom. `action` ({ label, run }) adds a button, like "Undo".
  function toast(msg, isError = false, ms = 2600, action = null) {
    if (!toastEl) {
      toastEl = el('div', 'bb-toast');
      toastEl.setAttribute('role', 'status');
      toastEl.setAttribute('aria-live', 'polite');
      document.body.append(toastEl);
    }
    toastEl.replaceChildren(el('span', '', msg));
    if (action) {
      const b = button('bb-toast-btn', action.label);
      b.addEventListener('click', () => {
        toastEl.classList.remove('is-on');
        action.run();
      });
      toastEl.append(b);
    }
    toastEl.classList.toggle('is-error', isError);
    toastEl.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-on'), action ? Math.max(ms, 5000) : ms);
  }

  // Saves a file to the Downloads folder, the same way a download link on the page would.
  function saveFile(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  // ---------- features ----------
  function screenshot(article, theme) {
    const post = Post.read(article);
    if (!post) return toast("Couldn't read this post", true);
    let { copy, download, stats, frame } = state.settings;
    if (!copy && !download) copy = true;
    toast('Making screenshot…', false, 20_000);

    const png = Shot.render(post, theme, { stats, frame });
    // Start the copy right away, while the click still counts as "you asked for it".
    const copied = copy
      ? navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]).then(
          () => true,
          () => false
        )
      : Promise.resolve(false);

    Promise.all([png, copied])
      .then(([blob, didCopy]) => {
        if (download) saveFile(blob, `bowerbird-${post.handle || 'post'}-${post.id}-${theme}.png`);
        if (didCopy && download) toast('Screenshot copied and saved to Downloads');
        else if (didCopy) toast('Screenshot copied');
        else if (download) toast(copy ? "Saved to Downloads. Couldn't copy it" : 'Screenshot saved to Downloads', copy && !didCopy);
        else toast("Couldn't copy the screenshot. Click the page, then try again", true, 5000);
      })
      .catch((e) => {
        console.error('[Bowerbird] screenshot failed', e);
        toast('Screenshot failed', true);
      });
  }

  async function saveOnly(article) {
    const post = Post.read(article);
    if (!post) return toast("Couldn't read this post", true);
    const had = !!state.posts[post.id];
    if (await attempt(() => Store.savePost(post))) toast(had ? 'Already saved' : 'Saved to Bowerbird');
  }

  function openLibrary() {
    chrome.runtime.sendMessage({ type: 'openLibrary' }).catch(() => toast(RELOAD, true, 6000));
  }

  function savedHint(article) {
    const item = state.posts[Post.idOf(article)];
    if (!item) return '';
    const names = item.folders.map(folderName).filter(Boolean);
    return names.length ? names.join(', ') : 'Saved';
  }

  // ---------- the folder panel ----------
  // Opens beside "Save post": find or make a folder, tick folders on and off, or remove the post.
  let uid = 0;
  function folderPanel(article) {
    const post = Post.read(article);
    const box = el('div', 'bb-menu bb-sub');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Save to folders');
    if (!post) {
      box.append(el('div', 'bb-empty', "Couldn't read this post"));
      return box;
    }
    const item = state.posts[post.id];
    const listId = `bb-list-${++uid}`;

    const field = el('label', 'bb-field');
    field.innerHTML = `<span class="bb-ic">${ICON.search}</span>`;
    const input = el('input');
    Object.assign(input, { type: 'text', placeholder: 'Find or make a folder', maxLength: Store.NAME_MAX, spellcheck: false, autocomplete: 'off' });
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-label', 'Find or make a folder');
    input.setAttribute('aria-controls', listId);
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-autocomplete', 'list');
    field.append(input);

    const list = el('div', 'bb-folders');
    list.id = listId;
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', 'Folders');
    list.setAttribute('aria-multiselectable', 'true');
    let rows = [];
    let active = -1;

    async function toggle(folder) {
      closeMenu(true);
      const res = await attempt(() => Store.toggleFolder(post, folder.id));
      if (res) toast(res.added ? `Saved to ${folder.name}` : `Removed from ${folder.name}`);
    }
    async function create(name) {
      closeMenu(true);
      const folder = await attempt(() => Store.createFolder(name));
      if (!folder) return;
      if (await attempt(() => Store.savePost(post, folder.id))) toast(`Saved to ${folder.name}`);
    }

    function option(text, on, run, extra = '') {
      const o = el('div', 'bb-item bb-opt' + extra);
      o.id = `${listId}-${rows.length}`;
      o.setAttribute('role', 'option');
      o.setAttribute('aria-selected', String(on));
      o.innerHTML = `<span class="bb-check">${on ? ICON.check : extra ? ICON.plus : ''}</span>`;
      o.append(el('span', 'bb-label', text));
      o.__bbRun = run;
      rows.push(o);
      return o;
    }

    function setActive(i, scroll = true) {
      rows[active]?.classList.remove('is-active');
      active = i;
      const r = rows[active];
      if (!r) return input.removeAttribute('aria-activedescendant');
      r.classList.add('is-active');
      input.setAttribute('aria-activedescendant', r.id);
      if (!scroll) return;
      // Keep the row in view without scrolling the page (a page scroll would close the menu).
      if (r.offsetTop < list.scrollTop) list.scrollTop = r.offsetTop;
      else if (r.offsetTop + r.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = r.offsetTop + r.offsetHeight - list.clientHeight;
    }

    function render() {
      const typed = Store.cleanName(input.value);
      const q = typed.toLowerCase();
      list.replaceChildren();
      list.scrollTop = 0;
      rows = [];
      active = -1;
      input.removeAttribute('aria-activedescendant');
      const has = (f) => !!item?.folders.includes(f.id);
      const row = (f) => option(f.name, has(f), () => toggle(f));

      if (!q) {
        if (!state.folders.length) {
          list.append(el('div', 'bb-empty', 'No folders yet. Type a name above to make one.'));
          return;
        }
        const recent = state.recent.map((id) => state.folders.find((f) => f.id === id)).filter(Boolean);
        if (recent.length && state.folders.length > recent.length) {
          list.append(cap('Recent'), ...recent.map(row), cap('All folders'));
        }
        list.append(...state.folders.map(row));
        return;
      }
      const starts = (f) => f.name.toLowerCase().startsWith(q);
      const hits = state.folders
        .filter((f) => f.name.toLowerCase().includes(q))
        .sort((a, b) => starts(b) - starts(a) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
      list.append(...hits.map(row));
      if (!hits.some((f) => Store.sameName(f.name, typed))) list.append(option(`Make folder “${typed}”`, false, () => create(typed), ' bb-create'));
      setActive(0);
    }
    function cap(text) {
      const c = el('div', 'bb-cap', text);
      c.setAttribute('aria-hidden', 'true');
      return c;
    }

    input.addEventListener('input', render);
    input.addEventListener('keydown', (e) => {
      if (e.isComposing) return;
      const n = rows.length;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (n) setActive(e.key === 'ArrowDown' ? (active + 1) % n : active <= 0 ? n - 1 : active - 1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        rows[active]?.__bbRun();
      } else if (e.key === 'ArrowLeft' && !input.value) {
        e.preventDefault();
        backToMenu();
      }
    });
    list.addEventListener('mousemove', (e) => {
      const i = rows.indexOf(e.target.closest('.bb-opt'));
      if (i >= 0 && i !== active) setActive(i, false);
    });
    list.addEventListener('click', (e) => {
      const o = e.target.closest('.bb-opt');
      if (!o?.__bbRun) return;
      e.stopPropagation();
      o.__bbRun();
    });
    render();

    box.append(field, list, el('div', 'bb-sep'));
    if (item) {
      const rm = button('bb-item bb-small bb-danger', 'Remove from Bowerbird');
      rm.addEventListener('click', async (e) => {
        e.stopPropagation();
        closeMenu(true);
        const removed = await attempt(() => Store.removePost(post.id));
        if (removed) toast('Removed from Bowerbird', false, 5000, { label: 'Undo', run: () => attempt(() => Store.restorePost(removed)) });
      });
      box.append(rm);
    }
    const lib = button('bb-item bb-small bb-muted', 'Open saved posts');
    lib.addEventListener('click', (e) => {
      e.stopPropagation();
      closeMenu(true);
      openLibrary();
    });
    box.append(lib);

    // Tab stays inside the panel.
    box.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const stops = [input, ...box.querySelectorAll('button')];
      const i = stops.indexOf(document.activeElement);
      e.preventDefault();
      stops[(i + (e.shiftKey ? -1 : 1) + stops.length) % stops.length].focus({ preventScroll: true });
    });
    box.__bbFocus = input; // focused as soon as the panel opens, so you can just type
    return box;
  }

  // ---------- the menu ----------
  let open = null; // { btn, article, root, rows, sub, subRow }

  function menuRow(icon, label, cls = '') {
    const b = button('bb-item ' + cls);
    b.setAttribute('role', 'menuitem');
    b.innerHTML = `<span class="bb-ic">${icon}</span>`;
    b.append(el('span', 'bb-label', label));
    return b;
  }

  function buildMenu(article) {
    const root = el('div', 'bb-menu');
    root.setAttribute('role', 'menu');
    root.setAttribute('aria-label', 'Bowerbird');

    // Screenshot: Light / Dim / Dark
    const shotRow = el('div', 'bb-item bb-row');
    shotRow.setAttribute('role', 'group');
    shotRow.setAttribute('aria-label', 'Screenshot');
    shotRow.innerHTML = `<span class="bb-ic">${ICON.camera}</span>`;
    const pills = el('div', 'bb-pills');
    for (const [label, theme] of [['Light', 'light'], ['Dim', 'dim'], ['Dark', 'dark']]) {
      const p = button('bb-pill', label);
      p.dataset.swatch = theme;
      p.setAttribute('role', 'menuitem');
      p.setAttribute('aria-label', `Screenshot, ${label}`);
      p.addEventListener('click', (e) => {
        e.stopPropagation();
        closeMenu(true);
        screenshot(article, theme);
      });
      pills.append(p);
    }
    shotRow.append(pills);
    shotRow.addEventListener('mouseenter', hideSub);

    // Save post: click saves it; hover (or the right arrow key) opens the folder panel.
    const save = menuRow(ICON.folder, 'Save post', 'bb-has-sub');
    save.setAttribute('aria-haspopup', 'dialog');
    save.setAttribute('aria-expanded', 'false');
    const hint = savedHint(article);
    if (hint) save.append(el('span', 'bb-hint', hint));
    save.insertAdjacentHTML('beforeend', `<span class="bb-chev">${ICON.chevron}</span>`);
    save.addEventListener('click', (e) => {
      e.stopPropagation();
      closeMenu(true);
      saveOnly(article);
    });
    save.addEventListener('mouseenter', showSub);

    const lib = menuRow(ICON.library, 'Open saved posts');
    lib.addEventListener('click', (e) => {
      e.stopPropagation();
      closeMenu(true);
      openLibrary();
    });
    lib.addEventListener('mouseenter', hideSub);

    // What Bowerbird keeps, shown before every screenshot or save (the store's disclosure rule).
    const note = el('div', 'bb-note', 'Saved posts and screenshots stay on this computer. Bowerbird sends nothing anywhere.');
    note.id = 'bb-note';
    root.setAttribute('aria-describedby', note.id);

    root.append(shotRow, save, el('div', 'bb-sep'), lib, el('div', 'bb-sep'), note);
    return { root, pills: [...pills.children], save, lib };
  }

  function openMenu(btn, article) {
    const m = buildMenu(article);
    const theme = pageTheme();
    m.root.dataset.theme = theme;
    guard(m.root);
    m.root.addEventListener('keydown', onMenuKey);
    document.body.append(m.root);
    btn.classList.add('is-open');
    btn.setAttribute('aria-expanded', 'true');
    open = { btn, article, ...m, sub: null };

    const r = btn.getBoundingClientRect();
    const mw = m.root.offsetWidth;
    const mh = m.root.offsetHeight;
    let top = r.bottom + 10;
    if (top + mh > innerHeight - 8) top = Math.max(8, r.top - mh - 10);
    m.root.style.left = Math.min(Math.max(8, r.right - mw + 16), innerWidth - mw - 8) + 'px';
    m.root.style.top = top + 'px';
    m.pills[0].focus({ preventScroll: true });

    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onDocKey, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
  }

  // Arrow keys move through the menu: up and down between rows, left and right between
  // Light, Dim and Dark. Right on "Save post" opens the folder panel.
  function onMenuKey(e) {
    if (!open || e.isComposing) return;
    const { pills, save, lib } = open;
    const at = document.activeElement;
    const inPills = pills.includes(at);
    const rows = [inPills ? at : pills[0], save, lib];
    const i = inPills ? 0 : rows.indexOf(at);
    let next = null;
    if (e.key === 'ArrowDown') next = rows[(i + 1) % rows.length];
    else if (e.key === 'ArrowUp') next = rows[(i - 1 + rows.length) % rows.length];
    else if (e.key === 'Home') next = pills[0];
    else if (e.key === 'End') next = lib;
    else if (inPills && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      next = pills[(pills.indexOf(at) + (e.key === 'ArrowRight' ? 1 : pills.length - 1)) % pills.length];
    } else if (at === save && e.key === 'ArrowRight') {
      e.preventDefault();
      return showSub();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      return closeMenu(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      return closeMenu(true);
    }
    if (next) {
      e.preventDefault();
      hideSub();
      next.focus({ preventScroll: true });
    }
  }

  // Opens the folder panel and puts the cursor in its search box, so you can just type.
  function showSub() {
    if (!open) return;
    if (!open.sub) {
      const sub = folderPanel(open.article);
      sub.dataset.theme = open.root.dataset.theme;
      guard(sub);
      sub.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          backToMenu();
        }
      });
      document.body.append(sub);
      open.sub = sub;
      open.save.classList.add('is-active');
      open.save.setAttribute('aria-expanded', 'true');
      const mr = open.root.getBoundingClientRect();
      const ir = open.save.getBoundingClientRect();
      const sw = sub.offsetWidth;
      const sh = sub.offsetHeight;
      let left = mr.right - 4;
      if (left + sw > innerWidth - 8) left = mr.left - sw + 4;
      sub.style.left = Math.max(8, left) + 'px';
      sub.style.top = Math.max(8, Math.min(ir.top - 6, innerHeight - sh - 8)) + 'px';
    }
    if (!open.sub.contains(document.activeElement)) open.sub.__bbFocus?.focus({ preventScroll: true });
  }

  function backToMenu() {
    if (!open) return;
    hideSub();
    open.save.focus({ preventScroll: true });
  }

  function hideSub() {
    if (!open?.sub) return;
    open.sub.remove();
    open.save.classList.remove('is-active');
    open.save.setAttribute('aria-expanded', 'false');
    open.sub = null;
  }

  function closeMenu(returnFocus = false) {
    if (!open) return;
    const { btn } = open;
    hideSub();
    open.root.remove();
    btn.classList.remove('is-open');
    btn.setAttribute('aria-expanded', 'false');
    open = null;
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onDocKey, true);
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', onResize);
    if (returnFocus && btn.isConnected) btn.focus({ preventScroll: true });
  }

  // Keep typing and clicks inside the menu away from X's own keyboard shortcuts.
  function guard(node) {
    for (const t of ['keydown', 'keyup', 'keypress']) node.addEventListener(t, (e) => e.stopPropagation());
  }
  const inMenu = (t) => open && (open.root.contains(t) || open.sub?.contains(t));
  function onOutside(e) {
    if (open && !inMenu(e.target) && !open.btn.contains(e.target)) closeMenu();
  }
  // Esc closes the menu even when the focus is somewhere else on the page.
  function onDocKey(e) {
    if (e.key === 'Escape' && open && !inMenu(e.target)) closeMenu(open.btn.contains(e.target) || e.target === document.body);
  }
  function onScroll(e) {
    if (!inMenu(e.target)) closeMenu();
  }
  function onResize() {
    closeMenu();
  }

  // ---------- the icon in each post ----------
  function makeButton(article) {
    const slot = el('div', 'bb-slot');
    const btn = button('bb-btn');
    btn.title = 'Bowerbird: screenshot or save';
    btn.setAttribute('aria-label', 'Bowerbird: screenshot or save this post');
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = `<span class="bb-off">${ICON.mark}</span><span class="bb-on">${ICON.markSaved}</span>`;
    btn.__bbArticle = article;
    slot.append(btn);

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation(); // don't let X open the post
      if (open?.btn === btn) closeMenu(true);
      else {
        closeMenu();
        openMenu(btn, article);
      }
    });
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.stopPropagation(); // X opens the post on Enter
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (open?.btn !== btn) btn.click();
        }
      }
    });
    for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) btn.addEventListener(t, (e) => e.stopPropagation());
    return slot;
  }

  // The element to sit in front of: the wrapper that holds only the Bookmark button.
  function bookmarkSpot(bar) {
    const bm = bar.querySelector(BOOKMARK);
    let ref = bm;
    while (ref && ref.parentElement && ref.parentElement !== bar && ref.parentElement.children.length === 1) ref = ref.parentElement;
    return bm && ref?.parentElement ? { bm, ref } : null;
  }

  function markSaved(btn) {
    const id = btn.__bbArticle && Post.idOf(btn.__bbArticle);
    const saved = !!(id && state.posts[id]);
    btn.classList.toggle('is-saved', saved);
    btn.setAttribute('aria-label', saved ? 'Bowerbird: saved. Screenshot or change folders' : 'Bowerbird: screenshot or save this post');
  }
  function refreshButtons() {
    document.querySelectorAll('.bb-btn').forEach(markSaved);
  }

  let queued = false;
  function scan() {
    queued = false;
    const placed = [];
    for (const r of document.querySelectorAll(REPLY)) {
      const bar = r.closest('[role="group"]');
      const article = bar?.closest('article');
      if (!article) continue;
      let slot = bar.querySelector('.bb-slot');
      const spot = bookmarkSpot(bar);
      if (slot && (!spot || slot.nextElementSibling === spot.ref)) continue; // already in place
      if (!spot) {
        // X sometimes draws Bookmark a moment later. Wait for it; only fall back to the end if it never shows.
        bar.__bbSeen ||= Date.now();
        if (Date.now() - bar.__bbSeen < 3000) {
          setTimeout(queueScan, 600);
          continue;
        }
      }
      slot ||= makeButton(article);
      if (spot) spot.ref.parentElement.insertBefore(slot, spot.ref);
      else bar.append(slot);
      placed.push(slot);
    }
    if (placed.length) fitSlots(placed);
  }

  // Match X's icon size, spacing and grey, and check the icon fits in the gap left of Bookmark.
  // Writes, then reads everything, then writes (one layout pass, so scrolling stays smooth).
  function fitSlots(slots) {
    for (const slot of slots) slot.classList.remove('bb-inflow'); // measure with the icon taking no room
    const replySvg = document.querySelector(REPLY)?.querySelector('svg');
    const idle = replySvg ? getComputedStyle(replySvg).color : '';
    const looks = slots.map((slot) => {
      const spot = slot.parentElement && bookmarkSpot(slot.parentElement);
      if (!spot) return { inflow: true };
      const a = spot.bm.querySelector('svg')?.getBoundingClientRect();
      const b = spot.ref.nextElementSibling?.querySelector('svg')?.getBoundingClientRect();
      if (!a) return { inflow: true };
      const g = b ? b.left - a.right : NaN;
      const size = a.width;
      // On a post's own page X spreads the buttons out evenly, so there's no tight gap to copy.
      const gap = g > 2 && g < 40 ? g : Math.round(size * 0.7);
      const left = a.left - gap - size;
      const rowGap = parseFloat(getComputedStyle(slot.parentElement).columnGap) || 0;
      return { size, gap, rowGap, inflow: contentRight(slot.previousElementSibling) > left - 6 };
    });
    if (idle) document.documentElement.style.setProperty('--bb-idle', idle);
    // Rust for the icon when open or saved: darker on X's light theme, lighter on dim and dark (both at least 3:1).
    const light = pageTheme() === 'light';
    document.documentElement.style.setProperty('--bb-on', light ? 'rgb(177, 68, 32)' : 'rgb(224, 112, 63)');
    document.documentElement.style.setProperty('--bb-on-bg', light ? 'rgba(177, 68, 32, 0.1)' : 'rgba(224, 112, 63, 0.14)');
    slots.forEach((slot, i) => {
      const { size, gap, rowGap, inflow } = looks[i];
      if (size) slot.style.setProperty('--bb-size', size + 'px');
      if (gap != null) slot.style.setProperty('--bb-gap', gap + 'px');
      if (rowGap != null) slot.style.setProperty('--bb-rowgap', rowGap + 'px');
      slot.classList.toggle('bb-inflow', inflow);
      markSaved(slot.firstElementChild);
    });
  }

  // A narrower or wider window changes the room next to Bookmark, so check again.
  let refit;
  addEventListener('resize', () => {
    clearTimeout(refit);
    refit = setTimeout(() => fitSlots([...document.querySelectorAll('.bb-slot')]), 250);
  });

  // Where the visible part of an element (its icons and text) ends on the right.
  function contentRight(node) {
    if (!node) return -Infinity;
    let right = -Infinity;
    for (const s of node.querySelectorAll('svg')) right = Math.max(right, s.getBoundingClientRect().right);
    const walk = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    while (walk.nextNode()) {
      if (!walk.currentNode.textContent.trim()) continue;
      range.selectNodeContents(walk.currentNode);
      right = Math.max(right, range.getBoundingClientRect().right);
    }
    return right;
  }

  function queueScan() {
    if (!queued) {
      queued = true;
      requestAnimationFrame(scan);
    }
  }

  new MutationObserver(queueScan).observe(document.body, { childList: true, subtree: true });
  scan();
})();
