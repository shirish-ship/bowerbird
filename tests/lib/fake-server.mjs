// A local https server that stands in for x.com and pbs.twimg.com during tests and store screenshots.
// The browser is pointed at it with --host-resolver-rules, so the real sites are never contacted.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { CSP, avatarSvg, landscapeSvg, timelineHtml } from '../fixtures/fake-x.mjs';

// A throwaway self-signed certificate (the browser runs with --ignore-certificate-errors).
function makeCert(dir) {
  const candidates = ['openssl', 'C:/Program Files/Git/usr/bin/openssl.exe', 'C:/Program Files/Git/mingw64/bin/openssl.exe'];
  for (const bin of candidates) {
    try {
      execFileSync(bin, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=x.com', '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem')], { stdio: 'ignore' });
      return { key: fs.readFileSync(path.join(dir, 'key.pem')), cert: fs.readFileSync(path.join(dir, 'cert.pem')) };
    } catch {}
  }
  throw new Error('openssl is needed to make a test certificate (it comes with Git for Windows)');
}

// Returns { port, requests, args, close }. Pass `args` to the browser.
export async function startFakeX(dir) {
  const requests = [];
  const server = https.createServer(makeCert(dir), (req, res) => {
    const host = String(req.headers.host || '').split(':')[0];
    const url = new URL(req.url, 'https://' + host);
    requests.push({ host, path: url.pathname, origin: req.headers.origin || '' });
    if (host === 'pbs.twimg.com') {
      // Like X's image server: it lets x.com (and twitter.com) pages read the pictures.
      const origin = req.headers.origin;
      const headers = { 'content-type': 'image/svg+xml', 'cache-control': 'max-age=60', vary: 'origin' };
      if (!origin) headers['access-control-allow-origin'] = '*';
      else if (/^https:\/\/(x|twitter)\.com$/.test(origin)) headers['access-control-allow-origin'] = origin;
      const m = url.pathname.match(/^\/profile_images\/(\w+)\//);
      if (m) return res.writeHead(200, headers).end(avatarSvg(m[1]));
      if (url.pathname.startsWith('/media/')) return res.writeHead(200, headers).end(landscapeSvg());
      return res.writeHead(404).end();
    }
    if (host === 'x.com' || host === 'twitter.com') {
      const theme = url.searchParams.get('theme') || 'light';
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': CSP });
      return res.end(url.pathname === '/home' ? timelineHtml(theme) : '<!doctype html><title>Post</title><p>Post page');
    }
    res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return {
    port,
    requests,
    args: [`--host-resolver-rules=MAP x.com:443 127.0.0.1:${port},MAP twitter.com:443 127.0.0.1:${port},MAP pbs.twimg.com:443 127.0.0.1:${port}`, '--ignore-certificate-errors'],
    close: () => server.close(),
  };
}
