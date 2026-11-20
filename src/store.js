// Postfold storage: saved posts, folders and settings.
// Everything lives in chrome.storage.local, on this device only. Nothing is ever sent anywhere.
//
//   post:<id>  { id, url, handle, name, text, avatar, media, postedAt, savedAt, folders: [folderId] }
//   folders    [{ id, name }]          sorted by name
//   recent     [folderId]              the last few folders used, newest first
//   settings   { copy, download, stats, frame }
//
// Each post has its own key, so saving one post writes one small entry, and pages can update
// from storage changes without reading everything again.

const Store = (() => {
  const area = chrome.storage.local;
  const DEFAULT_SETTINGS = { copy: true, download: true, stats: false, frame: false };
  const RECENT_MAX = 4;
  const NAME_MAX = 40;
  const TEXT_MAX = 1000;
  const PREFIX = 'post:';
  const ID = /^\d{1,25}$/;
  const HANDLE = /^[A-Za-z0-9_]{1,15}$/;
  const FOLDER_ID = /^f[a-z0-9]{4,24}$/;

  // ---------- cleaning ----------
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  const cleanName = (n) => String(n ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
  const safeImg = (src) => (/^https:\/\/pbs\.twimg\.com\/[^\s"'<>]+$/.test(src || '') ? String(src).slice(0, 400) : '');
  const postUrl = (handle, id) => `https://x.com/${HANDLE.test(handle || '') ? handle : 'i'}/status/${id}`;
  const sortFolders = (list) => [...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();
  const newFolderId = () => 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const settled = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);

  function cleanFolders(list) {
    const out = [];
    for (const f of Array.isArray(list) ? list : []) {
      const name = cleanName(f?.name);
      if (!name || !FOLDER_ID.test(f?.id || '') || out.some((o) => o.id === f.id || sameName(o.name, name))) continue;
      out.push({ id: f.id, name });
    }
    return sortFolders(out);
  }

  function cleanPost(p, folderIds) {
    if (!p || typeof p !== 'object' || !ID.test(String(p.id || ''))) return null;
    const id = String(p.id);
    const handle = HANDLE.test(p.handle || '') ? p.handle : '';
    return {
      id,
      url: postUrl(handle, id),
      handle,
      name: str(p.name, 100),
      text: str(p.text, TEXT_MAX),
      avatar: safeImg(p.avatar),
      media: safeImg(p.media),
      postedAt: settled(p.postedAt),
      savedAt: settled(p.savedAt) || Date.now(),
      folders: [...new Set((Array.isArray(p.folders) ? p.folders : []).filter((f) => !folderIds || folderIds.has(f)))],
    };
  }

  const cleanSettings = (s) => {
    const out = { ...DEFAULT_SETTINGS };
    for (const k of Object.keys(DEFAULT_SETTINGS)) if (typeof s?.[k] === 'boolean') out[k] = s[k];
    return out;
  };

  // ---------- reading ----------
  async function load() {
    const all = await area.get(null);
    const folders = cleanFolders(all.folders);
    const ids = new Set(folders.map((f) => f.id));
    const posts = {};
    for (const [k, v] of Object.entries(all)) {
      if (!k.startsWith(PREFIX)) continue;
      const p = cleanPost(v, ids);
      if (p) posts[p.id] = p;
    }
    return {
      posts,
      folders,
      recent: (Array.isArray(all.recent) ? all.recent : []).filter((id) => ids.has(id)).slice(0, RECENT_MAX),
      settings: cleanSettings(all.settings),
    };
  }

  // Bring a loaded state up to date from a storage change, without reading everything again.
  function apply(state, changes) {
    if (changes.folders) state.folders = cleanFolders(changes.folders.newValue);
    const ids = new Set(state.folders.map((f) => f.id));
    if (changes.recent || changes.folders) {
      const recent = changes.recent ? changes.recent.newValue : state.recent;
      state.recent = (Array.isArray(recent) ? recent : []).filter((id) => ids.has(id)).slice(0, RECENT_MAX);
    }
    if (changes.settings) state.settings = cleanSettings(changes.settings.newValue);
    for (const [k, c] of Object.entries(changes)) {
      if (!k.startsWith(PREFIX)) continue;
      const id = k.slice(PREFIX.length);
      const p = c.newValue ? cleanPost(c.newValue, ids) : null;
      if (p) state.posts[id] = p;
      else delete state.posts[id];
    }
    if (changes.folders) for (const p of Object.values(state.posts)) p.folders = p.folders.filter((f) => ids.has(f));
    return state;
  }

  function onChange(cb) {
    chrome.storage.onChanged.addListener((changes, name) => {
      if (name === 'local') cb(changes);
    });
  }

  // ---------- writing ----------
  // One change at a time, so quick clicks don't overwrite each other.
  let queue = Promise.resolve();
  const serial = (fn) => {
    const run = queue.then(fn);
    queue = run.catch(() => {});
    return run;
  };

  async function write(patch) {
    try {
      await area.set(patch);
    } catch (e) {
      if (/quota/i.test(e?.message || '')) throw new Error('Postfold’s storage is full. Remove some saved posts and try again.');
      throw e;
    }
  }

  const getPost = async (id) => (await area.get(PREFIX + id))[PREFIX + id] || null;
  const getFolders = async () => cleanFolders((await area.get('folders')).folders);
  const getRecent = async () => {
    const r = (await area.get('recent')).recent;
    return Array.isArray(r) ? r : [];
  };
  const bump = (recent, id) => [id, ...recent.filter((r) => r !== id)].slice(0, RECENT_MAX);

  // What Postfold keeps of a post read from the page (see post.js).
  function fromPage(post) {
    const first = (post.media || [])[0];
    return cleanPost({
      id: post.id,
      handle: post.handle,
      name: post.name,
      text: post.text,
      avatar: post.avatar,
      media: first ? smallMedia(first.src) : '',
      postedAt: post.time ? +post.time : post.postedAt,
      savedAt: Date.now(),
      folders: [],
    });
  }
  function smallMedia(src) {
    try {
      const u = new URL(src);
      if (u.hostname !== 'pbs.twimg.com') return '';
      if (u.searchParams.has('name')) u.searchParams.set('name', 'small');
      return u.href;
    } catch {
      return '';
    }
  }

  // Save a post (a post already saved keeps its folders). With a folder id, also put it in that folder.
  const savePost = (post, folderId) =>
    serial(async () => {
      const item = (await getPost(post.id)) || fromPage(post);
      if (!item) throw new Error('This post could not be read');
      const patch = {};
      if (folderId && !item.folders.includes(folderId)) item.folders.push(folderId);
      if (folderId) patch.recent = bump(await getRecent(), folderId);
      patch[PREFIX + item.id] = item;
      await write(patch);
      return item;
    });

  // Put the post in the folder, or take it out if it's already there. Returns { item, added }.
  const toggleFolder = (post, folderId) =>
    serial(async () => {
      const item = (await getPost(post.id)) || fromPage(post);
      if (!item) throw new Error('This post could not be read');
      const added = !item.folders.includes(folderId);
      item.folders = added ? [...item.folders, folderId] : item.folders.filter((f) => f !== folderId);
      const patch = { [PREFIX + item.id]: item };
      if (added) patch.recent = bump(await getRecent(), folderId);
      await write(patch);
      return { item, added };
    });

  // Make a folder (or find the one with that name). Returns it, or null for an empty name.
  const createFolder = (name) =>
    serial(async () => {
      name = cleanName(name);
      if (!name) return null;
      const folders = await getFolders();
      const found = folders.find((f) => sameName(f.name, name));
      if (found) return found;
      const folder = { id: newFolderId(), name };
      await write({ folders: sortFolders([...folders, folder]) });
      return folder;
    });

  // A new name. If another folder already has it, the two are merged into that one.
  // Returns the id of the folder that remains.
  const renameFolder = (id, name) =>
    serial(async () => {
      name = cleanName(name);
      const folders = await getFolders();
      const me = folders.find((f) => f.id === id);
      if (!me || !name) return id;
      const other = folders.find((f) => f.id !== id && sameName(f.name, name));
      if (!other) {
        me.name = name;
        await write({ folders: sortFolders(folders) });
        return id;
      }
      const all = await load();
      const patch = { folders: folders.filter((f) => f.id !== id), recent: all.recent.map((r) => (r === id ? other.id : r)) };
      patch.recent = [...new Set(patch.recent)];
      for (const p of Object.values(all.posts)) {
        if (!p.folders.includes(id)) continue;
        p.folders = [...new Set(p.folders.map((f) => (f === id ? other.id : f)))];
        patch[PREFIX + p.id] = p;
      }
      await write(patch);
      return other.id;
    });

  // Delete a folder. Its posts stay saved. Returns what's needed to undo it.
  const deleteFolder = (id) =>
    serial(async () => {
      const all = await load();
      const folder = all.folders.find((f) => f.id === id);
      if (!folder) return null;
      const patch = { folders: all.folders.filter((f) => f.id !== id), recent: all.recent.filter((r) => r !== id) };
      const postIds = [];
      for (const p of Object.values(all.posts)) {
        if (!p.folders.includes(id)) continue;
        p.folders = p.folders.filter((f) => f !== id);
        patch[PREFIX + p.id] = p;
        postIds.push(p.id);
      }
      await write(patch);
      return { folder, postIds };
    });

  // Undo a folder delete: the folder comes back with the posts that were in it (those still saved).
  const restoreFolder = (undo) =>
    serial(async () => {
      if (!undo?.folder) return;
      const all = await load();
      const name = cleanName(undo.folder.name);
      const clash = all.folders.find((f) => sameName(f.name, name));
      const id = clash ? clash.id : undo.folder.id;
      const patch = clash ? {} : { folders: sortFolders([...all.folders, { id, name }]) };
      for (const pid of undo.postIds || []) {
        const p = all.posts[pid];
        if (p && !p.folders.includes(id)) patch[PREFIX + pid] = { ...p, folders: [...p.folders, id] };
      }
      await write(patch);
    });

  const removeFromFolder = (postId, folderId) =>
    serial(async () => {
      const item = await getPost(postId);
      if (!item) return;
      item.folders = (item.folders || []).filter((f) => f !== folderId);
      await write({ [PREFIX + postId]: item });
    });

  // Remove a saved post. Returns what was removed, for Undo.
  const removePost = (id) =>
    serial(async () => {
      const item = await getPost(id);
      await area.remove(PREFIX + id);
      return item;
    });

  // Put a removed post back (Undo). Folders deleted in the meantime are dropped.
  const restorePost = (item) =>
    serial(async () => {
      const ids = new Set((await getFolders()).map((f) => f.id));
      const p = cleanPost(item, ids);
      if (p) await write({ [PREFIX + p.id]: p });
    });

  const setSettings = (patch) =>
    serial(async () => {
      const cur = cleanSettings((await area.get('settings')).settings);
      await write({ settings: cleanSettings({ ...cur, ...patch }) });
    });

  // ---------- export and import ----------
  async function exportData() {
    const { posts, folders, settings } = await load();
    const list = Object.values(posts).sort((a, b) => b.savedAt - a.savedAt);
    return { app: 'postfold', version: 1, exportedAt: new Date().toISOString(), folders, posts: list, settings };
  }

  // Merge a Postfold export into what's saved. Folders with the same name are joined, posts already
  // saved gain the folders from the file. Also reads files that sort posts with "tags" instead of folders.
  // Returns { added, folders } counts.
  const importData = (data) =>
    serial(async () => {
      if (!data || typeof data !== 'object') throw new Error('This file is not a Postfold export');
      const incoming = Array.isArray(data.posts) ? data.posts : data.items && typeof data.items === 'object' ? Object.values(data.items) : null;
      if (!incoming) throw new Error('This file is not a Postfold export');
      if (incoming.length > 50000) throw new Error('This file is too big to import');

      const cur = await load();
      const folders = [...cur.folders];
      const made = new Set();
      const folderFor = (name) => {
        name = cleanName(name);
        if (!name) return null;
        let f = folders.find((o) => sameName(o.name, name));
        if (!f) {
          f = { id: newFolderId() + folders.length.toString(36), name };
          folders.push(f);
          made.add(f.id);
        }
        return f.id;
      };
      // Folder ids in the file -> folder ids here.
      const map = new Map();
      for (const f of Array.isArray(data.folders) ? data.folders : []) {
        const id = folderFor(f?.name);
        if (id && typeof f?.id === 'string') map.set(f.id, id);
      }
      for (const t of Array.isArray(data.tags) ? data.tags : []) folderFor(t);

      const patch = {};
      let added = 0;
      for (const raw of incoming) {
        if (!raw || typeof raw !== 'object' || !ID.test(String(raw.id || ''))) continue;
        const wanted = [
          ...(Array.isArray(raw.folders) ? raw.folders.map((f) => map.get(f)) : []),
          ...(Array.isArray(raw.tags) ? raw.tags.map(folderFor) : []),
        ].filter(Boolean);
        const have = cur.posts[raw.id] || (patch[PREFIX + raw.id] ? patch[PREFIX + raw.id] : null);
        if (have) {
          const merged = [...new Set([...have.folders, ...wanted])];
          if (merged.length !== have.folders.length) patch[PREFIX + raw.id] = { ...have, folders: merged };
          continue;
        }
        const p = cleanPost({ ...raw, folders: wanted }, null);
        if (!p) continue;
        patch[PREFIX + p.id] = p;
        added++;
      }
      patch.folders = sortFolders(folders);
      await write(patch);
      return { added, folders: made.size };
    });

  const bytesInUse = () => area.getBytesInUse(null).catch(() => 0);

  return {
    load, apply, onChange, savePost, toggleFolder, createFolder, renameFolder, deleteFolder, restoreFolder,
    removeFromFolder, removePost, restorePost, setSettings, exportData, importData, bytesInUse,
    cleanName, sameName, postUrl, safeImg, NAME_MAX, DEFAULT_SETTINGS,
  };
})();
