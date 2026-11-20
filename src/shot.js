// Draws a clean picture of a post (light, dim or dark) on a canvas and returns a PNG blob.
// It redraws the post from its details instead of capturing the screen, so any
// theme works no matter which theme X is in.
//
// Options: { stats: show replies/reposts/likes/views, frame: add a soft background around the card }

const Shot = (() => {
  const THEMES = {
    light: { bg: '#ffffff', text: '#0f1419', sub: '#536471', line: '#cfd9de', link: '#1d9bf0', empty: '#eff3f4' },
    dim: { bg: '#15202b', text: '#f7f9f9', sub: '#8b98a5', line: '#38444d', link: '#1d9bf0', empty: '#1e2732' },
    dark: { bg: '#000000', text: '#e7e9ea', sub: '#71767b', line: '#2f3336', link: '#1d9bf0', empty: '#16181c' },
  };
  // The soft background behind the card when "frame" is on.
  const FRAMES = {
    light: { from: '#e2ebf6', to: '#f0e7f5', shadow: 'rgba(15, 20, 25, 0.14)', edge: 'rgba(15, 20, 25, 0.06)' },
    dim: { from: '#22364a', to: '#2d3954', shadow: 'rgba(0, 0, 0, 0.35)', edge: '#38444d' },
    dark: { from: '#1c1e22', to: '#2a2d34', shadow: 'rgba(0, 0, 0, 0.6)', edge: '#2f3336' },
  };
  const MARGIN = 40; // frame size around the card
  const FAMILY =
    'TwitterChirp, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
  const W = 560; // card width in CSS pixels
  const PAD = 24;
  const CW = W - PAD * 2; // content width
  const SCALE = 2; // output is 2x for sharp text
  const MAX_LINES = 60;

  const font = (size, bold = false) => `${bold ? 700 : 400} ${size}px ${FAMILY}`;
  const graphemes = (s) => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)].map((g) => g.segment);

  // ---------- images ----------
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Image failed: ' + src));
      img.src = src;
    });
  }

  // Pictures come from X's image server, which lets x.com pages draw them on a canvas.
  // A picture that won't load is left out (an empty circle for a profile picture).
  async function getImage(src) {
    if (!src) return null;
    try {
      return await loadImage(src);
    } catch {
      return null;
    }
  }

  // The frame a video is showing right now (falls back to its cover picture).
  function videoFrame(video) {
    if (!video || video.readyState < 2 || !video.videoWidth) return null;
    try {
      const c = document.createElement('canvas');
      c.width = video.videoWidth;
      c.height = video.videoHeight;
      const x = c.getContext('2d');
      x.drawImage(video, 0, 0);
      x.getImageData(0, 0, 1, 1); // throws if the browser won't let us read it
      return c;
    } catch {
      return null;
    }
  }

  async function getMedia(list) {
    const out = await Promise.all(
      (list || []).map(async (m) => {
        const img = (m.kind === 'video' && videoFrame(m.video)) || (await getImage(m.src));
        if (!img) return null;
        return { img, w: img.naturalWidth || img.width, h: img.naturalHeight || img.height, video: m.kind === 'video' };
      })
    );
    return out.filter(Boolean);
  }

  // ---------- text ----------
  function trimRuns(runs) {
    const out = (runs || []).map((r) => ({ ...r }));
    if (out.length) {
      out[0].text = out[0].text.replace(/^\s+/, '');
      out[out.length - 1].text = out[out.length - 1].text.replace(/\s+$/, '');
    }
    return out.filter((r) => r.text);
  }

  function ellipsize(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    const g = graphemes(text);
    while (g.length && ctx.measureText(g.join('') + '…').width > maxW) g.pop();
    return g.join('').trimEnd() + '…';
  }

  // Word-wrap text runs into lines of { text, link, x } pieces. ctx.font must already be set.
  function wrap(ctx, runs, maxW, maxLines = MAX_LINES) {
    const lines = [[]];
    let x = 0;
    let soft = false; // current line started because the previous one was full
    const newLine = (isSoft) => {
      lines.push([]);
      x = 0;
      soft = isSoft;
    };
    const add = (text, link) => {
      lines[lines.length - 1].push({ text, link, x });
      x += ctx.measureText(text).width;
    };

    for (const run of runs) {
      for (const part of run.text.split(/(\n)/)) {
        if (part === '\n') {
          newLine(false);
          continue;
        }
        for (const tok of part.match(/\s+|\S+/g) || []) {
          if (/^\s/.test(tok)) {
            if (!(x === 0 && soft)) add(tok, run.link);
            continue;
          }
          const w = ctx.measureText(tok).width;
          if (x > 0 && x + w > maxW) newLine(true);
          if (w <= maxW) {
            add(tok, run.link);
            continue;
          }
          // A very long word (like a link): break it wherever it runs out of room.
          let buf = '';
          for (const g of graphemes(tok)) {
            if (buf && x + ctx.measureText(buf + g).width > maxW) {
              add(buf, run.link);
              newLine(true);
              buf = '';
            }
            buf += g;
          }
          if (buf) add(buf, run.link);
        }
      }
    }

    while (lines.length && !lines[lines.length - 1].some((p) => p.text.trim())) lines.pop();
    if (lines.length > maxLines) {
      lines.length = maxLines;
      const last = lines[maxLines - 1];
      const ew = ctx.measureText('…').width;
      let end = last[last.length - 1];
      while (end) {
        end.text = end.text.trimEnd();
        if (end.text && end.x + ctx.measureText(end.text).width + ew <= maxW) break;
        const g = graphemes(end.text);
        g.pop();
        end.text = g.join('');
        if (!end.text) {
          last.pop();
          end = last[last.length - 1];
        }
      }
      last.push({ text: '…', link: false, x: end ? end.x + ctx.measureText(end.text).width : 0 });
    }
    return lines;
  }

  function drawLines(ctx, lines, x, y, size, lineH, th) {
    ctx.font = font(size);
    lines.forEach((line, i) => {
      const base = y + i * lineH + (lineH - size) / 2 + size * 0.8;
      for (const p of line) {
        ctx.fillStyle = p.link ? th.link : th.text;
        ctx.fillText(p.text, x + p.x, base);
      }
    });
  }

  // ---------- shapes ----------
  function cover(ctx, img, x, y, w, h) {
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    const s = Math.max(w / iw, h / ih);
    const sw = w / s;
    const sh = h / s;
    ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h);
  }

  function drawAvatar(ctx, img, x, y, size, th) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
    ctx.clip();
    if (img) cover(ctx, img, x, y, size, size);
    else {
      ctx.fillStyle = th.empty;
      ctx.fillRect(x, y, size, size);
    }
    ctx.restore();
  }

  function drawBadge(ctx, badge, x, y, size) {
    ctx.save();
    ctx.translate(x, y);
    if (badge.paths?.length) {
      const [vx, vy, vw, vh] = badge.vb;
      ctx.scale(size / vw, size / vh);
      ctx.translate(-vx, -vy);
      for (const p of badge.paths) {
        ctx.fillStyle = p.fill;
        ctx.fill(new Path2D(p.d), p.rule);
      }
    } else {
      ctx.fillStyle = badge.color || '#1d9bf0';
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = size * 0.12;
      ctx.lineCap = ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(size * 0.3, size * 0.52);
      ctx.lineTo(size * 0.45, size * 0.66);
      ctx.lineTo(size * 0.72, size * 0.36);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Small play mark in the corner of videos.
  function drawPlay(ctx, x, y, h) {
    const s = 32;
    const cx = x + 12 + s / 2;
    const cy = y + h - 12 - s / 2;
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.beginPath();
    ctx.arc(cx, cy, s / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(cx - 4, cy - 7);
    ctx.lineTo(cx + 7, cy);
    ctx.lineTo(cx - 4, cy + 7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Photo grid like X's: 1 = natural shape, 2 = side by side, 3 = one big + two small, 4 = 2x2.
  function grid(items, w, maxRatio) {
    const G = 2;
    if (items.length === 1) {
      const r = Math.min(Math.max(items[0].h / items[0].w, 0.4), maxRatio);
      const h = Math.round(w * r);
      return { h, cells: [[0, 0, w, h]] };
    }
    const h = Math.round((w * 9) / 16);
    const hw = (w - G) / 2;
    const hh = (h - G) / 2;
    if (items.length === 2) return { h, cells: [[0, 0, hw, h], [hw + G, 0, hw, h]] };
    if (items.length === 3) return { h, cells: [[0, 0, hw, h], [hw + G, 0, hw, hh], [hw + G, hh + G, hw, hh]] };
    return { h, cells: [[0, 0, hw, hh], [hw + G, 0, hw, hh], [0, hh + G, hw, hh], [hw + G, hh + G, hw, hh]] };
  }

  function drawMedia(ctx, items, lay, x, y, w, th, radius, border) {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, w, lay.h, radius);
    ctx.clip();
    ctx.fillStyle = th.bg;
    ctx.fillRect(x, y, w, lay.h);
    items.forEach((m, i) => {
      const [cx, cy, cw, ch] = lay.cells[i];
      cover(ctx, m.img, x + cx, y + cy, cw, ch);
      if (m.video) drawPlay(ctx, x + cx, y + cy, ch);
    });
    ctx.restore();
    if (border) {
      ctx.beginPath();
      ctx.roundRect(x + 0.5, y + 0.5, w - 1, lay.h - 1, radius);
      ctx.strokeStyle = th.line;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  // ---------- dates ----------
  const fullDate = (d) =>
    d
      ? `${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} · ${d.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })}`
      : '';
  const shortDate = (d) =>
    d
      ? d.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}),
        })
      : '';

  // ---------- counts ----------
  const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
  const STAT_NAMES = [
    ['replies', 'Reply', 'Replies'],
    ['reposts', 'Repost', 'Reposts'],
    ['likes', 'Like', 'Likes'],
    ['bookmarks', 'Bookmark', 'Bookmarks'],
  ];
  // Pieces to draw in a row: [{ text, bold } or { gap }]. Zero counts are left out.
  function statPieces(stats) {
    const out = [];
    for (const [key, one, many] of STAT_NAMES) {
      const n = stats?.[key];
      if (!n) continue;
      if (out.length) out.push({ gap: 20 });
      out.push({ text: compact.format(n), bold: true }, { text: ' ' + (n === 1 ? one : many) });
    }
    return out;
  }
  function drawPieces(ctx, pieces, x, y, th, maxX) {
    for (const p of pieces) {
      if (p.gap) {
        x += p.gap;
        continue;
      }
      ctx.font = font(15, p.bold);
      ctx.fillStyle = p.bold ? th.text : th.sub;
      const text = ellipsize(ctx, p.text, Math.max(0, maxX - x));
      ctx.fillText(text, x, y);
      x += ctx.measureText(text).width;
      if (x >= maxX) break;
    }
  }

  // ---------- quoted post ----------
  function quoteBlock(m, q, media, width) {
    const P = 12;
    m.font = font(15);
    const lines = wrap(m, trimRuns(q.runs), width - P * 2, 6);
    const lay = media.length ? grid(media, width, 1) : null;
    const textY = P + 20 + 4;
    let h = P + 20 + (lines.length ? 4 + lines.length * 20 : 0);
    const mediaY = h + 12;
    h += lay ? 12 + lay.h : P;

    return {
      h,
      draw(ctx, x, y, th, avatar) {
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(x, y, width, h, 16);
        ctx.clip();

        drawAvatar(ctx, avatar, x + P, y + P, 20, th);
        let cx = x + P + 26;
        const right = x + width - P;
        ctx.font = font(15, true);
        ctx.fillStyle = th.text;
        const name = ellipsize(ctx, q.name || q.handle || '', (right - cx) * 0.6);
        ctx.fillText(name, cx, y + P + 15);
        cx += ctx.measureText(name).width + 3;
        if (q.badge) {
          drawBadge(ctx, q.badge, cx, y + P + 2, 16);
          cx += 17;
        }
        ctx.font = font(15);
        ctx.fillStyle = th.sub;
        const meta = [q.handle && '@' + q.handle, shortDate(q.time)].filter(Boolean).join(' · ');
        ctx.fillText(ellipsize(ctx, meta, right - cx - 4), cx + 4, y + P + 15);

        if (lines.length) drawLines(ctx, lines, x + P, y + textY, 15, 20, th);
        if (lay) drawMedia(ctx, media, lay, x, y + mediaY, width, th, 0, false);
        ctx.restore();

        ctx.beginPath();
        ctx.roundRect(x + 0.5, y + 0.5, width - 1, h - 1, 16);
        ctx.strokeStyle = th.line;
        ctx.lineWidth = 1;
        ctx.stroke();
      },
    };
  }

  // ---------- the card ----------
  async function render(post, theme, opts = {}) {
    if (!THEMES[theme]) theme = 'light';
    const th = THEMES[theme];

    // Start loading pictures first: video frames are grabbed right now, matching what's on screen.
    const pictures = Promise.all([
      getImage(post.avatar),
      getMedia(post.media),
      post.quote ? getImage(post.quote.avatar) : null,
      post.quote ? getMedia(post.quote.media) : [],
    ]);
    await Promise.all([document.fonts.load(font(17)), document.fonts.load(font(16, true))]).catch(() => {});
    const [avatar, media, qAvatar, qMedia] = await pictures;

    // Measure everything first so the canvas is exactly the right height.
    const m = document.createElement('canvas').getContext('2d');
    m.font = font(17);
    const lines = wrap(m, trimRuns(post.runs), CW);
    const lay = media.length ? grid(media, CW, 1.5) : null;
    const quote = post.quote ? quoteBlock(m, post.quote, qMedia, CW) : null;
    const date = fullDate(post.time);
    const views = opts.stats && post.stats?.views ? post.stats.views : 0;
    const dateLine = [];
    if (date) dateLine.push({ text: date });
    if (views) {
      if (date) dateLine.push({ text: ' · ' });
      dateLine.push({ text: compact.format(views), bold: true }, { text: views === 1 ? ' View' : ' Views' });
    }
    const counts = opts.stats ? statPieces(post.stats) : [];

    const at = {};
    let y = PAD + 48;
    if (lines.length) {
      y += 12;
      at.text = y;
      y += lines.length * 24;
    }
    if (lay) {
      y += 12;
      at.media = y;
      y += lay.h;
    }
    if (quote) {
      y += 12;
      at.quote = y;
      y += quote.h;
    }
    if (dateLine.length) {
      y += 14;
      at.date = y;
      y += 20;
    }
    if (counts.length) {
      y += 16;
      at.rule = y;
      y += 1 + 14;
      at.counts = y;
      y += 20;
    }
    const H = Math.ceil(y + PAD);

    // With a frame, the card sits on a soft background with a shadow and rounded corners.
    const M = opts.frame ? MARGIN : 0;
    const fr = FRAMES[theme];
    const canvas = document.createElement('canvas');
    canvas.width = (W + M * 2) * SCALE;
    canvas.height = (H + M * 2) * SCALE;
    const ctx = canvas.getContext('2d');
    ctx.scale(SCALE, SCALE);
    if (M) {
      const g = ctx.createLinearGradient(0, 0, W + M * 2, H + M * 2);
      g.addColorStop(0, fr.from);
      g.addColorStop(1, fr.to);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W + M * 2, H + M * 2);
      ctx.save();
      ctx.shadowColor = fr.shadow;
      ctx.shadowBlur = 32 * SCALE; // shadows ignore ctx.scale, so size them in real pixels
      ctx.shadowOffsetY = 8 * SCALE;
      ctx.beginPath();
      ctx.roundRect(M, M, W, H, 16);
      ctx.fillStyle = th.bg;
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(M, M, W, H, 16);
      ctx.clip();
      ctx.translate(M, M);
    }
    ctx.fillStyle = th.bg;
    ctx.fillRect(0, 0, W, H);

    // Header: picture, name, badge, @handle
    drawAvatar(ctx, avatar, PAD, PAD, 48, th);
    const nx = PAD + 60;
    ctx.font = font(16, true);
    ctx.fillStyle = th.text;
    const name = ellipsize(ctx, post.name || post.handle, CW - 60 - 26);
    ctx.fillText(name, nx, PAD + 20);
    if (post.badge) drawBadge(ctx, post.badge, nx + ctx.measureText(name).width + 3, PAD + 5, 18);
    ctx.font = font(15);
    ctx.fillStyle = th.sub;
    ctx.fillText(ellipsize(ctx, '@' + post.handle, CW - 60), nx, PAD + 41);

    if (at.text != null) drawLines(ctx, lines, PAD, at.text, 17, 24, th);
    if (lay) drawMedia(ctx, media, lay, PAD, at.media, CW, th, 16, true);
    if (quote) quote.draw(ctx, PAD, at.quote, th, qAvatar);
    if (dateLine.length) drawPieces(ctx, dateLine, PAD, at.date + 15, th, W - PAD);
    if (counts.length) {
      ctx.fillStyle = th.line;
      ctx.fillRect(PAD, at.rule, CW, 1);
      drawPieces(ctx, counts, PAD, at.counts + 15, th, W - PAD);
    }

    if (M) {
      ctx.restore();
      ctx.beginPath();
      ctx.roundRect(M + 0.5, M + 0.5, W - 1, H - 1, 16);
      ctx.strokeStyle = fr.edge;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    return new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not make the image'))), 'image/png')
    );
  }

  return { render };
})();
