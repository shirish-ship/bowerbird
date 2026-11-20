// Reads a post's details from the page it is shown on: author, text, pictures, quoted post, time
// and counts. Built for the page's current layout (data-testid="..."), with fallbacks for a newer one.
// It only reads what is already on screen; it never asks any server for anything.

const Post = (() => {
  const STATUS = /^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/;
  const TEXT = '[data-testid="tweetText"], div[dir="auto"][class*="whitespace-pre"]';
  const MEDIA = '[data-testid="tweetPhoto"], [data-testid="videoPlayer"], [data-testid="videoComponent"]';
  const AVATAR = '[data-testid="Tweet-User-Avatar"] img, [data-post-avatar] img, img[src*="/profile_images/"]';

  // Quoted posts sit inside a div[role="link"] in the main post.
  const inQuote = (el, article) => {
    const q = el.closest('div[role="link"]');
    return !!q && article.contains(q);
  };
  const own = (article, sel) => {
    for (const el of article.querySelectorAll(sel)) if (!inQuote(el, article)) return el;
    return null;
  };

  function statusLink(article) {
    const links = [...article.querySelectorAll('a[href*="/status/"]')].filter(
      (a) => !inQuote(a, article) && /(^|\.)(x|twitter)\.com$/.test(a.hostname)
    );
    const parse = (a) => {
      const m = a.pathname.match(STATUS);
      return m ? { handle: m[1], id: m[2], el: a } : null;
    };
    const timed = links.find((a) => a.querySelector('time'));
    return (timed && parse(timed)) || links.map(parse).find(Boolean) || null;
  }

  const isEmoji = (img) => /\/emoji\//.test(img.src) || /\p{Extended_Pictographic}/u.test(img.alt || '');
  const hidden = (el) => {
    const cs = getComputedStyle(el);
    return cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.fontSize) < 2;
  };

  // Text as runs: [{ text, link }], with emoji pictures turned back into characters
  // and X's hidden link parts (like "https://") left out.
  function runsOf(root) {
    const runs = [];
    const push = (text, link) => {
      if (!text) return;
      const last = runs[runs.length - 1];
      if (last && last.link === link) last.text += text;
      else runs.push({ text, link });
    };
    const walk = (n, link) => {
      if (n.nodeType === 3) return push(n.nodeValue, link);
      if (n.nodeType !== 1 || n instanceof SVGElement) return;
      if (n.tagName === 'IMG') return isEmoji(n) ? push(n.alt, link) : undefined;
      if (n.tagName === 'BR') return push('\n', link);
      if (hidden(n)) return;
      const isLink = link || n.tagName === 'A';
      n.childNodes.forEach((c) => walk(c, isLink));
    };
    walk(root, false);
    return runs;
  }
  const plain = (el) => (el ? runsOf(el).map((r) => r.text).join('') : '');

  const bigAvatar = (src) => src && src.replace(/_(normal|bigger|mini|x96)(\.\w+)(\?.*)?$/, '_200x200$2');
  const bigMedia = (src) => {
    try {
      const u = new URL(src);
      if (u.hostname === 'pbs.twimg.com' && /^(thumb|tiny|small|240x240|360x360)$/.test(u.searchParams.get('name') || '')) {
        u.searchParams.set('name', 'medium');
      }
      return u.href;
    } catch {
      return src;
    }
  };

  // The verified badge: copy X's own drawing so the screenshot matches.
  function badgeOf(scope) {
    const svg = scope && scope.querySelector('[data-testid="icon-verified"], svg[aria-label="Verified account"]');
    if (!svg) return null;
    const color = getComputedStyle(svg).color;
    let vb = svg.getAttribute('viewBox');
    let paths = [...svg.querySelectorAll('path')];
    const use = svg.querySelector('use');
    if (!paths.length && use) {
      const ref = use.getAttribute('href') || use.getAttribute('xlink:href') || '';
      const sym = ref.startsWith('#') ? document.getElementById(ref.slice(1)) : null;
      if (sym) {
        paths = [...sym.querySelectorAll('path')];
        vb = sym.getAttribute('viewBox') || vb;
      }
    }
    const list = paths
      .map((p) => {
        let fill = p.getAttribute('fill') || 'currentColor';
        if (fill === 'currentColor') fill = color;
        else if (fill.startsWith('url(')) fill = '#e2b719'; // gold badge uses a gradient
        if (fill === 'none') return null;
        return { d: p.getAttribute('d'), fill, rule: p.getAttribute('fill-rule') === 'evenodd' ? 'evenodd' : 'nonzero' };
      })
      .filter((p) => p && p.d);
    return { vb: (vb || '0 0 24 24').split(/[\s,]+/).map(Number), paths: list, color };
  }

  function mediaOf(scope, article) {
    let els = [...scope.querySelectorAll(MEDIA)];
    if (!els.length) els = [...scope.querySelectorAll('img[src*="pbs.twimg.com/media/"], video')];
    if (article) els = els.filter((e) => !inQuote(e, article));
    els = els.filter((e) => !els.some((o) => o !== e && o.contains(e)));
    const out = [];
    for (const e of els) {
      const video = e.tagName === 'VIDEO' ? e : e.querySelector('video');
      const img = e.tagName === 'IMG' ? e : e.querySelector('img');
      if (video) out.push({ kind: 'video', video, src: video.poster || img?.src || '' });
      else if (img?.src) out.push({ kind: 'photo', src: bigMedia(img.src) });
    }
    // A video's cover picture can also show up as a photo; drop those.
    const base = (s) => (s || '').split('?')[0];
    const posters = new Set(out.filter((m) => m.kind === 'video').map((m) => base(m.src)));
    return out.filter((m) => m.kind === 'video' || !posters.has(base(m.src))).slice(0, 4);
  }

  function authorOf(scope, article, fallbackHandle) {
    const un = article ? own(article, '[data-testid="User-Name"]') : scope.querySelector('[data-testid="User-Name"]');
    let name = '';
    let handle = '';
    if (un) {
      name = plain(un.firstElementChild).trim();
      const h = [...un.querySelectorAll('span')].map((s) => s.textContent.trim()).find((t) => /^@\w{1,15}$/.test(t));
      if (h) handle = h.slice(1);
    }
    if (!handle) handle = fallbackHandle || '';
    if (!name && handle) {
      const links = [...scope.querySelectorAll(`a[href="/${handle}" i]`)].filter((a) => !article || !inQuote(a, article));
      name = links.map((a) => plain(a).trim()).find((t) => t && !t.startsWith('@')) || handle;
    }
    const img = article ? own(article, AVATAR) : scope.querySelector(AVATAR);
    return { name, handle, avatar: bigAvatar(img?.src || ''), badge: badgeOf(un || scope) };
  }

  const timeOf = (el) => {
    const t = el && el.getAttribute('datetime');
    const d = t ? new Date(t) : null;
    return d && !isNaN(d) ? d : null;
  };
  // Newer layout writes the time as text: "2:20 AM · Mar 22, 2006"
  const timeFromText = (el) => {
    const parts = (el?.textContent || '').split('·').map((s) => s.trim());
    if (parts.length < 2) return null;
    const d = new Date(`${parts[1]} ${parts[0]}`);
    return isNaN(d) ? null : d;
  };

  function quoteOf(article) {
    const q = [...article.querySelectorAll('div[role="link"]')].find((d) => d.querySelector('[data-testid="User-Name"]'));
    if (!q) return null;
    const a = authorOf(q, null, '');
    const textEl = q.querySelector('[data-testid="tweetText"]');
    return { ...a, runs: textEl ? runsOf(textEl) : [], media: mediaOf(q, null), time: timeOf(q.querySelector('time[datetime]')) };
  }

  // Replies, reposts, likes, bookmarks and views. X lists them in the action bar's label,
  // like "174 replies, 127 reposts, 801 likes, 64 bookmarks, 41584 views".
  const STAT = /(\d[\d,]*)\s+(repl(?:y|ies)|reposts?|likes?|bookmarks?|views?)\b/gi;
  function statsOf(article) {
    const bar = [...article.querySelectorAll('[role="group"]')].find(
      (g) => !inQuote(g, article) && g.querySelector('[data-testid="reply"], [data-engagement-action="reply"]')
    );
    const labels = [bar?.getAttribute('aria-label') || ''];
    const views = own(article, 'a[href$="/analytics"]'); // "2551 views. View post analytics"
    if (views) labels.push(views.getAttribute('aria-label') || '');
    const out = {};
    for (const label of labels) {
      for (const [, n, word] of label.matchAll(STAT)) {
        const w = word.toLowerCase();
        const key = w.startsWith('repl') ? 'replies' : w.replace(/s$/, '') + 's';
        out[key] ??= +n.replace(/,/g, '');
      }
    }
    return Object.keys(out).length ? out : null;
  }

  // Everything needed to save or screenshot a post. Returns null if it can't find the post link.
  function read(article) {
    const link = statusLink(article);
    if (!link) return null;
    const a = authorOf(article, article, link.handle);
    const textEl = own(article, TEXT);
    const runs = textEl ? runsOf(textEl) : [];
    return {
      id: link.id,
      handle: a.handle || link.handle,
      url: `https://x.com/${link.handle}/status/${link.id}`,
      name: a.name,
      avatar: a.avatar,
      badge: a.badge,
      runs,
      text: runs.map((r) => r.text).join('').trim(),
      media: mediaOf(article, article),
      quote: quoteOf(article),
      time: timeOf(own(article, 'time[datetime]')) || timeFromText(link.el),
      stats: statsOf(article),
    };
  }

  const idOf = (article) => statusLink(article)?.id || null;

  return { read, idOf };
})();
