// A fake x.com timeline for tests and store screenshots. It copies the structure Bowerbird reads
// (data-testid attributes, the action bar, the time link), not X's look or artwork: no X logo, no X icons.
// All people and posts here are made up.

export const PEOPLE = {
  mara: { name: 'Mara Lindqvist', handle: 'maralind', color: '#b14420', initials: 'ML', verified: true },
  theo: { name: 'Theo Achebe', handle: 'theodraws', color: '#2f5d50', initials: 'TA' },
  june: { name: 'June Okafor', handle: 'junewrites', color: '#3b4a8c', initials: 'JO' },
  sol: { name: 'Sol Marín', handle: 'solmarin', color: '#7a5a1e', initials: 'SM' },
  // Only used by the store screenshots, to fill the saved posts page.
  ines: { name: 'Inès Duval', handle: 'inesmakes', color: '#5a3d6b', initials: 'ID' },
  kofi: { name: 'Kofi Mensah', handle: 'kofiships', color: '#1f5f7a', initials: 'KM' },
  rhea: { name: 'Rhea Kapoor', handle: 'rhea_reads', color: '#4d6b2f', initials: 'RK' },
};

export const POSTS = [
  {
    id: '1858000000000000001',
    who: 'mara',
    time: '2026-11-18T09:24:00.000Z',
    text: 'Spent the morning sketching the ridge above the lake. The light at 7am does all the work for you.\n\nPrints of this one go up Friday.',
    media: 'landscape',
    stats: { replies: 18, reposts: 64, likes: 1204, bookmarks: 96, views: 48210 },
  },
  {
    id: '1858000000000000002',
    who: 'june',
    time: '2026-11-17T16:02:00.000Z',
    text: 'Three rules I keep coming back to for writing short:\n1. Cut the first sentence.\n2. One idea per line.\n3. Read it out loud before you post.',
    stats: { replies: 41, reposts: 212, likes: 3380, bookmarks: 1450, views: 120400 },
  },
  {
    id: '1858000000000000003',
    who: 'theo',
    time: '2026-11-16T11:40:00.000Z',
    text: 'This is the best explanation of colour mixing I have read in years.',
    quote: { who: 'sol', time: '2026-11-15T08:12:00.000Z', id: '1857000000000000009', text: 'Warm and cool are not colours. They are a relationship between two colours sitting next to each other.' },
    stats: { replies: 7, reposts: 30, likes: 410, bookmarks: 52, views: 9800 },
  },
  {
    id: '1858000000000000004',
    who: 'sol',
    time: '2026-11-14T19:55:00.000Z',
    text: 'Small win today: the studio finally has a shelf for every sample. Took four weekends.',
    stats: { replies: 3, reposts: 2, likes: 88, bookmarks: 4, views: 2100 },
  },
];

// ---------- pictures (drawn here, so nothing is borrowed) ----------
export function avatarSvg(key) {
  const p = PEOPLE[key] || PEOPLE.mara;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
<rect width="200" height="200" fill="${p.color}"/>
<text x="100" y="124" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="72" font-weight="600" fill="#fefdfb">${p.initials}</text>
</svg>`;
}

export function landscapeSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">
<defs>
  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f3c9a1"/><stop offset=".55" stop-color="#f6e2c8"/><stop offset="1" stop-color="#e9d8c2"/></linearGradient>
  <linearGradient id="lake" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fa3a6"/><stop offset="1" stop-color="#4f6668"/></linearGradient>
</defs>
<rect width="1200" height="675" fill="url(#sky)"/>
<circle cx="820" cy="250" r="70" fill="#fbeedd"/>
<path d="M0 360 L140 250 L260 320 L420 190 L560 300 L700 220 L860 330 L1000 240 L1200 340 V675 H0Z" fill="#b9a08b"/>
<path d="M0 420 L180 330 L330 400 L480 300 L640 410 L800 330 L980 420 L1200 360 V675 H0Z" fill="#8a6d5a"/>
<path d="M0 470 L220 420 L420 460 L640 410 L860 470 L1060 430 L1200 460 V675 H0Z" fill="#5b4537"/>
<rect y="470" width="1200" height="205" fill="url(#lake)"/>
<path d="M0 470 L220 420 L420 460 L640 410 L860 470 L1060 430 L1200 460 V470Z" fill="#5b4537"/>
<g stroke="#d9e2e0" stroke-width="3" opacity=".6"><path d="M120 520h140M520 560h220M860 530h120M300 610h180"/></g>
</svg>`;
}

// ---------- the page ----------
const THEME = {
  light: { bg: '#ffffff', fg: '#0f1419', sub: '#536471', line: '#eff3f4', icon: '#536471' },
  dim: { bg: '#15202b', fg: '#f7f9f9', sub: '#8b98a5', line: '#38444d', icon: '#8b98a5' },
  dark: { bg: '#000000', fg: '#e7e9ea', sub: '#71767b', line: '#2f3336', icon: '#71767b' },
};

// Simple outline shapes for the action bar (not X's icons).
const ICON = (d) => `<svg viewBox="0 0 24 24" width="18.75" height="18.75" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
const SHAPES = {
  reply: 'M4 5h16v11H9l-5 4Z',
  repost: 'M7 7h10v6M17 17H7v-6M14 4l3 3-3 3M10 20l-3-3 3-3',
  like: 'M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10Z',
  views: 'M5 20V12M10 20V6M15 20v-9M20 20V9',
  bookmark: 'M7 4h10v16l-5-4-5 4Z',
  share: 'M12 4v11M8 8l4-4 4 4M5 14v6h14v-6',
};
const BADGE = '<svg data-testid="icon-verified" aria-label="Verified account" viewBox="0 0 24 24" width="18" height="18" style="color:#1d9bf0"><circle cx="12" cy="12" r="10" fill="currentColor"/><path d="m7.5 12.5 3 3 6-6.5" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const short = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const n = (v) => (v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'K' : String(v));

function article(post) {
  const p = PEOPLE[post.who];
  const s = post.stats;
  const label = `${s.replies} replies, ${s.reposts} reposts, ${s.likes} likes, ${s.bookmarks} bookmarks, ${s.views} views`;
  const quote = post.quote
    ? (() => {
        const q = PEOPLE[post.quote.who];
        return `<div role="link" tabindex="0" class="quote">
          <div data-testid="User-Name" class="uname"><div><a href="/${q.handle}"><span>${esc(q.name)}</span></a></div><div class="sub"><span>@${q.handle}</span><span>·</span><time datetime="${post.quote.time}">${short(post.quote.time)}</time></div></div>
          <div data-testid="Tweet-User-Avatar" class="qav"><img src="https://pbs.twimg.com/profile_images/${post.quote.who}/avatar_normal.svg" alt=""></div>
          <div data-testid="tweetText" dir="auto" class="text">${esc(post.quote.text)}</div>
        </div>`;
      })()
    : '';
  const media = post.media
    ? `<div class="media"><div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/${post.media}?format=png&amp;name=small" alt="Image"></div></div>`
    : '';
  const btn = (testid, shape, count) =>
    `<div class="act"><button data-testid="${testid}" aria-label="${testid}">${ICON(SHAPES[shape])}</button>${count != null ? `<span>${n(count)}</span>` : ''}</div>`;
  return `<article data-testid="tweet" role="article" tabindex="0">
  <div data-testid="Tweet-User-Avatar" class="av"><a href="/${p.handle}"><img src="https://pbs.twimg.com/profile_images/${post.who}/avatar_normal.svg" alt=""></a></div>
  <div class="body">
    <div data-testid="User-Name" class="uname">
      <div><a href="/${p.handle}"><span>${esc(p.name)}</span></a>${p.verified ? BADGE : ''}</div>
      <div class="sub"><a href="/${p.handle}"><span>@${p.handle}</span></a><span>·</span><a href="/${p.handle}/status/${post.id}"><time datetime="${post.time}">${short(post.time)}</time></a></div>
    </div>
    <div data-testid="tweetText" dir="auto" class="text">${esc(post.text)}</div>
    ${media}${quote}
    <div role="group" aria-label="${label}" class="bar">
      ${btn('reply', 'reply', s.replies)}${btn('retweet', 'repost', s.reposts)}${btn('like', 'like', s.likes)}
      <div class="act"><a href="/${p.handle}/status/${post.id}/analytics" aria-label="${s.views} views. View post analytics">${ICON(SHAPES.views)}</a><span>${n(s.views)}</span></div>
      <div class="pair"><div><button data-testid="bookmark" aria-label="Bookmark">${ICON(SHAPES.bookmark)}</button></div><div><button aria-label="Share post">${ICON(SHAPES.share)}</button></div></div>
    </div>
  </div>
</article>`;
}

export function timelineHtml(theme = 'light') {
  const t = THEME[theme] || THEME.light;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Home</title>
<style>
  html,body{margin:0;background:${t.bg};color:${t.fg};font:15px/20px -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  main{width:600px;margin:0 auto;min-height:100vh;border-left:1px solid ${t.line};border-right:1px solid ${t.line}}
  header{height:53px;display:flex;align-items:center;padding:0 16px;font-weight:700;font-size:20px;border-bottom:1px solid ${t.line}}
  article{display:flex;gap:12px;padding:12px 16px;border-bottom:1px solid ${t.line}}
  .av img{width:40px;height:40px;border-radius:50%;display:block}
  .body{flex:1;min-width:0}
  .uname{display:flex;gap:4px;align-items:center;flex-wrap:wrap}
  .uname > div{display:flex;gap:4px;align-items:center}
  .uname a{color:inherit;text-decoration:none;font-weight:700}
  .uname .sub, .uname .sub a{color:${t.sub};font-weight:400}
  .text{white-space:pre-wrap;margin-top:2px}
  .media{margin-top:12px;border:1px solid ${t.line};border-radius:16px;overflow:hidden}
  .media img{width:100%;display:block}
  .quote{margin-top:12px;border:1px solid ${t.line};border-radius:16px;padding:12px;position:relative}
  .quote .qav{position:absolute;left:12px;top:12px}.quote .qav img{width:20px;height:20px;border-radius:50%}
  .quote .uname{padding-left:26px}
  .bar{display:flex;justify-content:space-between;align-items:center;max-width:540px;margin-top:12px;color:${t.icon}}
  .act{display:flex;align-items:center;gap:4px;font-size:13px}
  .act button,.pair button,.act a{all:unset;display:flex;cursor:pointer;color:${t.icon}}
  .pair{display:flex;gap:12px}
</style></head><body>
<main><header>Home</header>
${POSTS.map(article).join('\n')}
</main></body></html>`;
}

export const CSP =
  "default-src 'self'; img-src 'self' https://x.com https://*.twimg.com data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'";
