// A tiny driver for a headless Chromium browser over the DevTools protocol (no dependencies).
// Branded Chrome ignores --load-extension, so this uses Microsoft Edge by default. Set BROWSER_PATH
// to use another Chromium build (Chrome for Testing or Chromium also load unpacked extensions).

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CANDIDATES = [
  process.env.BROWSER_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/microsoft-edge',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

export function findBrowser() {
  const found = CANDIDATES.find((p) => fs.existsSync(p));
  if (!found) throw new Error('No Edge or Chromium found. Set BROWSER_PATH to a Chromium-based browser.');
  return found;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Starts the browser with a throwaway profile. Returns a connected CDP client.
export async function launch({ extension, args = [], port = 9300 + Math.floor(Math.random() * 500), width = 1280, height = 900 } = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bowerbird-profile-'));
  const flags = [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    '--disable-features=msEdgeSidebarV2,EdgeCollections',
    `--window-size=${width},${height}`,
    ...(extension ? [`--load-extension=${extension}`, `--disable-extensions-except=${extension}`] : []),
    ...args,
    'about:blank',
  ];
  const proc = spawn(findBrowser(), flags, { stdio: 'ignore' });
  let ver;
  for (let i = 0; i < 80 && !ver; i++) {
    try {
      ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    } catch {
      await sleep(150);
    }
  }
  if (!ver) {
    proc.kill();
    throw new Error('The browser did not start');
  }
  const cdp = new CDP(ver.webSocketDebuggerUrl);
  await cdp.ready;
  cdp.close = async () => {
    try {
      await cdp.send('Browser.close');
    } catch {}
    await sleep(300);
    proc.kill();
    for (let i = 0; i < 10; i++) {
      try {
        fs.rmSync(profile, { recursive: true, force: true });
        break;
      } catch {
        await sleep(300);
      }
    }
  };
  return cdp;
}

// Finds the loaded extension's background worker by its manifest name (Edge runs some built-in
// extensions too). Returns the target info plus a sessionId attached to it.
export async function extensionWorker(cdp, name, ms = 9000) {
  const checked = new Set();
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const workers = (await cdp.send('Target.getTargets')).targetInfos.filter((t) => t.type === 'service_worker' && t.url.startsWith('chrome-extension://') && !checked.has(t.targetId));
    for (const t of workers) {
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: t.targetId, flatten: true }).catch(() => ({}));
      if (!sessionId) continue;
      await cdp.send('Runtime.enable', {}, sessionId).catch(() => {});
      const found = await cdp.eval(sessionId, 'chrome.runtime.getManifest().name').catch(() => '');
      if (found === name) return { ...t, sessionId, id: new URL(t.url).host };
      // Skip this worker from now on only once its name is known; one still starting up gets another look.
      if (found) checked.add(t.targetId);
      await cdp.send('Target.detachFromTarget', { sessionId }).catch(() => {});
    }
    await sleep(150);
  }
  throw new Error('The extension did not load');
}

export class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = [];
    this.ready = new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
    this.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) reject(new Error(m.error.message));
        else resolve(m.result);
      } else for (const l of this.listeners) l(m);
    };
  }
  send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  on(fn) {
    this.listeners.push(fn);
  }

  // Opens a tab and attaches to it. Returns { sessionId, targetId }.
  async open(url, { width, height, scale = 1 } = {}) {
    const t = await this.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await this.send('Target.attachToTarget', { targetId: t.targetId, flatten: true });
    await this.send('Runtime.enable', {}, sessionId);
    await this.send('Page.enable', {}, sessionId);
    if (width) await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false }, sessionId);
    const loaded = this.waitFor((m) => m.sessionId === sessionId && m.method === 'Page.loadEventFired', 20000);
    await this.send('Page.navigate', { url }, sessionId);
    await loaded;
    return { sessionId, targetId: t.targetId };
  }

  waitFor(test, ms = 10000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners = this.listeners.filter((l) => l !== fn);
        reject(new Error('Timed out waiting for a browser event'));
      }, ms);
      const fn = (m) => {
        if (!test(m)) return;
        clearTimeout(timer);
        this.listeners = this.listeners.filter((l) => l !== fn);
        resolve(m);
      };
      this.listeners.push(fn);
    });
  }

  async eval(sessionId, expression, contextId) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, ...(contextId ? { contextId } : {}) }, sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }

  async until(sessionId, expression, ms = 8000, contextId) {
    const end = Date.now() + ms;
    for (;;) {
      const v = await this.eval(sessionId, expression, contextId).catch(() => null);
      if (v || Date.now() > end) return v;
      await sleep(80);
    }
  }

  async screenshot(sessionId, file, { clip, transparent = false } = {}) {
    if (transparent) await this.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } }, sessionId);
    const { data } = await this.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: clip.scale || 1 } } : {}), captureBeyondViewport: !!clip }, sessionId);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    return file;
  }

  async key(sessionId, key, { code, text, modifiers = 0 } = {}) {
    const k = { key, code: code || key, windowsVirtualKeyCode: VK[key] || (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0), modifiers };
    await this.send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...k, ...(text ? { text } : {}) }, sessionId);
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...k }, sessionId);
  }

  async type(sessionId, text) {
    for (const ch of text) await this.send('Input.dispatchKeyEvent', { type: 'char', text: ch }, sessionId);
  }

  async click(sessionId, x, y) {
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await this.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }, sessionId);
    }
  }

  async hover(sessionId, x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, sessionId);
  }
}

const VK = { Enter: 13, Escape: 27, Tab: 9, ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39, Home: 36, End: 35, ' ': 32, Backspace: 8, '/': 191 };
