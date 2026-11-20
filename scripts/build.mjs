// Builds the Chrome Web Store upload: dist/postfold/ (the unpacked extension) and
// dist/postfold-<version>.zip, with manifest.json at the root of the zip and no dev files.
//   node scripts/build.mjs
// It also checks the things a reviewer checks: every file the manifest and the page name exists,
// only the expected permissions are asked for, and there is no remote code, eval or minified code.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const rel = (...p) => path.join(root, ...p);

// Exactly what ships. Everything else in the repo (tests, store assets, docs, scripts) stays out.
const SHIP = [
  'manifest.json',
  'background.js',
  'LICENSE',
  'src/store.js',
  'src/post.js',
  'src/shot.js',
  'src/content.js',
  'src/content.css',
  'page/folders.html',
  'page/folders.css',
  'page/folders.js',
  'page/tokens.css',
  'page/base.css',
  ...fs.readdirSync(rel('page/fonts')).map((f) => `page/fonts/${f}`),
  ...fs.readdirSync(rel('icons')).filter((f) => f.endsWith('.png')).map((f) => `icons/${f}`),
];
const EXPECTED_PERMISSIONS = ['storage'];

const problems = [];
const manifest = JSON.parse(fs.readFileSync(rel('manifest.json'), 'utf8'));

// ---------- checks ----------
if (manifest.manifest_version !== 3) problems.push('manifest_version must be 3');
if (JSON.stringify(manifest.permissions || []) !== JSON.stringify(EXPECTED_PERMISSIONS)) problems.push(`permissions changed: ${JSON.stringify(manifest.permissions)}`);
if (manifest.host_permissions?.length) problems.push(`unexpected host_permissions: ${JSON.stringify(manifest.host_permissions)}`);
if (manifest.optional_permissions?.length || manifest.optional_host_permissions?.length) problems.push('unexpected optional permissions');
if ((manifest.description || '').length > 132) problems.push(`description is ${manifest.description.length} characters (store limit 132)`);
if ((manifest.name || '').length > 75) problems.push(`name is ${manifest.name.length} characters (limit 75)`);
if ((manifest.short_name || '').length > 12) problems.push('short_name is longer than 12 characters');

const named = new Set([
  manifest.background?.service_worker,
  manifest.options_page,
  ...Object.values(manifest.icons || {}),
  ...Object.values(manifest.action?.default_icon || {}),
  ...(manifest.content_scripts || []).flatMap((c) => [...(c.js || []), ...(c.css || [])]),
]);
for (const f of named) if (f && !SHIP.includes(f)) problems.push(`manifest names ${f}, which is not shipped`);
for (const f of SHIP) if (!fs.existsSync(rel(f))) problems.push(`missing file: ${f}`);

// Files the page links to.
const html = fs.readFileSync(rel('page/folders.html'), 'utf8');
for (const [, ref] of html.matchAll(/(?:src|href)="([^"#:]+)"/g)) {
  const target = path.posix.normalize(path.posix.join('page', ref));
  if (!SHIP.includes(target)) problems.push(`page/folders.html links to ${ref}, which is not shipped`);
}
for (const [, ref] of html.matchAll(/<script[^>]+src="([^"]+)"/g)) if (/^[a-z]+:/i.test(ref)) problems.push(`remote script in folders.html: ${ref}`);
for (const css of SHIP.filter((f) => f.endsWith('.css'))) {
  const text = fs.readFileSync(rel(css), 'utf8');
  for (const [, ref] of text.matchAll(/url\("?([^")]+)"?\)/g)) {
    if (/^(data:|#)/.test(ref)) continue;
    if (/^[a-z]+:/i.test(ref)) problems.push(`${css} loads a remote file: ${ref}`);
    else if (!SHIP.includes(path.posix.normalize(path.posix.join(path.posix.dirname(css), ref)))) problems.push(`${css} links to ${ref}, which is not shipped`);
  }
}

// No remote code, no eval, nothing hidden.
for (const js of SHIP.filter((f) => f.endsWith('.js'))) {
  const text = fs.readFileSync(rel(js), 'utf8');
  const bad = [
    [/\beval\s*\(/, 'eval('],
    [/new\s+Function\s*\(/, 'new Function('],
    [/set(?:Timeout|Interval)\s*\(\s*['"`]/, 'a string passed to setTimeout/setInterval'],
    [/importScripts\s*\(\s*['"`]https?:/, 'importScripts from the web'],
    [/\bimport\s*\(\s*['"`]https?:/, 'import() from the web'],
    [/\bfetch\s*\(/, 'fetch( (Postfold makes no requests)'],
    [/XMLHttpRequest|WebSocket|sendBeacon/, 'a network API'],
  ];
  for (const [re, what] of bad) if (re.test(text)) problems.push(`${js} uses ${what}`);
  const longest = Math.max(...text.split('\n').map((l) => l.length));
  if (longest > 400) problems.push(`${js} has a ${longest}-character line (looks minified)`);
}

if (problems.length) {
  console.error('Build stopped:\n- ' + problems.join('\n- '));
  process.exit(1);
}

// ---------- stage ----------
const out = rel('dist', 'postfold');
fs.rmSync(rel('dist'), { recursive: true, force: true });
for (const f of SHIP) {
  fs.mkdirSync(path.dirname(path.join(out, f)), { recursive: true });
  fs.copyFileSync(rel(f), path.join(out, f));
}

// ---------- zip (stored with deflate, no dependencies) ----------
const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function zip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  // A fixed date (2026-01-01) so the same files always give the same zip.
  const time = 0;
  const date = ((2026 - 1980) << 9) | (1 << 5) | 1;
  for (const { name, data } of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(useDeflate ? 8 : 0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, nameBuf, body);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(useDeflate ? 8 : 0, 10);
    cen.writeUInt16LE(time, 12);
    cen.writeUInt16LE(date, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(body.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, nameBuf);
    offset += local.length + nameBuf.length + body.length;
  }
  const cenBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cenBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cenBuf, end]);
}

const zipFile = rel('dist', `postfold-${manifest.version}.zip`);
const buf = zip(SHIP.sort().map((name) => ({ name, data: fs.readFileSync(rel(name)) })));
fs.writeFileSync(zipFile, buf);
console.log(`Built ${path.relative(root, zipFile)} (${(buf.length / 1024).toFixed(1)} KB, ${SHIP.length} files)`);
console.log(`Unpacked copy: ${path.relative(root, out)}`);
