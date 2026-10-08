import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { MessageChannel } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const source = await readFile(new URL('../android/app/src/main/assets/download-bridge.js', import.meta.url), 'utf8');
const ORIGIN = 'https://203.195.191.239';
const MAX = 256 * 1024 * 1024;
const CHUNK = 256 * 1024;

function harness({ blob = new Blob(['宇宙备份'], { type: 'application/json' }), origin = ORIGIN, frame = false, fetchImpl, timeoutScale = 1 } = {}) {
  const listeners = new Map(), documentListeners = new Map(), timers = new Set(), channels = [], fetched = [], messages = [], notices = [];
  class Element {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.style = {}; this.attributes = new Map(); }
    appendChild(child) { child.parent = this; this.children.push(child); if (child.className === 'toast') notices.push(child.textContent); return child; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    hasAttribute(name) { return this.attributes.has(name); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  }
  class Anchor extends Element {
    constructor() { super('a'); this.originalClicks = 0; this.href = ''; }
    set download(value) { this.setAttribute('download', value); }
    get download() { return this.attributes.get('download') || ''; }
    closest(selector) { return selector === 'a[download]' && this.hasAttribute('download') ? this : null; }
    click() { this.originalClicks++; }
  }
  const toastRoot = new Element('div');
  const document = {
    body: new Element('body'),
    createElement: tag => tag === 'a' ? new Anchor() : new Element(tag),
    getElementById: id => id === 'toasts' ? toastRoot : null,
    addEventListener(type, listener) { documentListeners.set(type, listener); },
  };
  const window = {
    location: { origin, href: origin + '/#/settings' },
    crypto: { randomUUID },
    addEventListener(type, listener) { listeners.set(type, listener); },
    alert: message => notices.push(message),
  };
  window.top = frame ? {} : window;
  const context = vm.createContext({
    window, document, HTMLAnchorElement: Anchor, URL, Blob, AbortController, Uint8Array, btoa,
    setTimeout(fn, delay) {
      const timer = setTimeout(() => { timers.delete(timer); fn(); }, delay * timeoutScale);
      timers.add(timer);
      timer.unref();
      return timer;
    },
    clearTimeout(timer) { clearTimeout(timer); timers.delete(timer); },
    fetch: async (url, options) => {
      fetched.push({ url, options });
      return fetchImpl ? fetchImpl(url, options) : { ok: true, headers: new Headers(), blob: async () => blob };
    },
  });
  const run = () => vm.runInContext(source, context);
  run();
  const dispatch = (type, event = {}) => listeners.get(type)?.(event);
  function attach(onMessage, eventOverrides = {}) {
    const channel = new MessageChannel();
    channels.push(channel);
    channel.port2.on('message', raw => {
      const message = JSON.parse(raw);
      messages.push(message);
      const reply = body => channel.port2.postMessage(JSON.stringify({ id: message.id, ...body }));
      if (onMessage) onMessage(message, reply);
      else if (message.type === 'begin') reply({ type: 'ready' });
      else if (message.type === 'chunk') reply({ type: 'ack', sequence: message.sequence });
      else if (message.type === 'end') reply({ type: 'complete' });
    });
    dispatch('message', { data: 'yuzhou-download-port-v1', ports: [channel.port1], origin: '', source: null, ...eventOverrides });
    return channel;
  }
  function anchor(url, name) { const result = new Anchor(); result.href = url; if (name !== undefined) result.download = name; return result; }
  function click(target, overrides = {}) {
    const event = { target, defaultPrevented: false, button: 0, preventDefault() { this.defaultPrevented = true; }, ...overrides };
    documentListeners.get('click')?.(event);
    return event;
  }
  function dispose() {
    dispatch('pagehide');
    for (const channel of channels) { channel.port1.close(); channel.port2.close(); }
    for (const timer of timers) clearTimeout(timer);
  }
  return { window, document, fetched, messages, notices, run, attach, anchor, click, dispatch, dispose };
}

async function until(predicate) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail('Expected bridge event did not arrive');
}

test('streams exact binary using bounded sequential chunks and waits for native completion', async t => {
  const input = Uint8Array.from({ length: CHUNK * 2 + 791 }, (_, index) => index % 251);
  const h = harness({ blob: new Blob([input], { type: 'application/zip' }) });
  t.after(h.dispose);
  h.attach();
  assert.equal(h.window.__yuzhouDownloads.ready, true);
  assert.equal(h.window.YuzhouDownloads, h.window.__yuzhouDownloads);
  assert.equal(await h.window.YuzhouDownloads.downloadUrl('blob:' + ORIGIN + '/binary', '../备份\u0000.zip'), true);
  const begin = h.messages[0];
  assert.equal(begin.type, 'begin');
  assert.equal(begin.size, input.length);
  assert.equal(begin.mime, 'application/zip');
  assert.equal(begin.name, '_备份_.zip');
  assert.match(begin.id, /^[A-Za-z0-9_-]{1,96}$/);
  const chunks = h.messages.filter(message => message.type === 'chunk');
  assert.deepEqual(chunks.map(message => message.sequence), [0, 1, 2]);
  assert(chunks.every(message => Buffer.from(message.data, 'base64').length <= CHUNK));
  assert.deepEqual(Buffer.concat(chunks.map(message => Buffer.from(message.data, 'base64'))), Buffer.from(input));
  assert.equal(h.messages.at(-1).type, 'end');
  assert.deepEqual(h.notices, ['文件已保存。']);
});

test('starts reading the blob immediately and waits for a later native port', async t => {
  const h = harness();
  t.after(h.dispose);
  const promise = h.window.YuzhouDownloads.downloadUrl('blob:' + ORIGIN + '/late', '备份.json');
  assert.equal(h.fetched.length, 1);
  assert.equal(h.messages.length, 0);
  h.attach();
  assert.equal(await promise, true);
});

test('intercepts detached programmatic download anchors and real click events once', async t => {
  const h = harness();
  t.after(h.dispose);
  h.attach();
  const detached = h.anchor('blob:' + ORIGIN + '/first', '备份.json');
  detached.click();
  assert.equal(detached.originalClicks, 0);
  await until(() => h.notices.length === 1);
  const clicked = h.anchor('blob:' + ORIGIN + '/second', '笔记.txt');
  assert.equal(h.click(clicked).defaultPrevented, true);
  await until(() => h.notices.length === 2);
  assert.equal(h.messages.filter(message => message.type === 'begin').length, 2);
});

test('keeps ordinary/external links untouched and rejects foreign files from the native API', async t => {
  const h = harness();
  t.after(h.dispose);
  h.attach();
  for (const [url, name] of [
    ['https://example.com/private.json', 'x.json'],
    ['blob:https://example.com/foreign', 'x.json'],
    ['blob:null/opaque', 'x.json'],
    ['http://203.195.191.239/file', 'x.json'],
    ['javascript:alert(1)', 'x.json'],
    ['data:text/html,<script>alert(1)</script>', 'x.html'],
    [ORIGIN + '/normal-page', undefined],
  ]) {
    const anchor = h.anchor(url, name);
    anchor.click();
    assert.equal(anchor.originalClicks, 1);
    assert.equal(h.click(anchor).defaultPrevented, false);
  }
  assert.equal(await h.window.YuzhouDownloads.downloadUrl('https://example.com/secret', 'no'), false);
  assert.equal(h.fetched.length, 0);
});

test('uses authenticated same-origin fetch and accepts safe data exports', async t => {
  const h = harness();
  t.after(h.dispose);
  h.attach();
  assert.equal(await h.window.YuzhouDownloads.downloadUrl('/api/files/approved', '资料.pdf'), true);
  assert.equal(h.fetched[0].url, ORIGIN + '/api/files/approved');
  assert.equal(h.fetched[0].options.credentials, 'same-origin');
  assert.equal(h.fetched[0].options.redirect, 'error');
  assert.equal(await h.window.YuzhouDownloads.downloadUrl('data:text/plain,hello', '笔记.txt'), true);
});

test('rejects oversized headers before allocating a Blob and oversized Blob values before opening picker', async t => {
  let read = false;
  const header = harness({ fetchImpl: async () => ({ ok: true, headers: new Headers({ 'content-length': String(MAX + 1) }), blob: async () => { read = true; } }) });
  const body = harness({ blob: { size: MAX + 1, type: 'application/octet-stream' } });
  t.after(() => { header.dispose(); body.dispose(); });
  for (const h of [header, body]) {
    h.attach();
    assert.equal(await h.window.YuzhouDownloads.downloadUrl('blob:' + ORIGIN + '/too-large', 'x'), false);
    assert.equal(h.messages.length, 0);
    assert.match(h.notices[0], /256 MB/);
  }
  assert.equal(read, false);
});

test('allows empty files and native chooser cancellation without a false success notice', async t => {
  const empty = harness({ blob: new Blob([]) });
  const cancelled = harness();
  t.after(() => { empty.dispose(); cancelled.dispose(); });
  empty.attach();
  assert.equal(await empty.window.YuzhouDownloads.downloadUrl('blob:' + ORIGIN + '/empty', 'empty.txt'), true);
  assert.deepEqual(empty.messages.map(message => message.type), ['begin', 'end']);
  cancelled.attach((message, reply) => { if (message.type === 'begin') reply({ type: 'error', message: '已取消保存' }); });
  assert.equal(await cancelled.window.YuzhouDownloads.downloadUrl('blob:' + ORIGIN + '/cancelled', 'x'), false);
  assert.deepEqual(cancelled.notices, ['已取消保存']);
  assert.equal(cancelled.messages.some(message => message.type === 'chunk'), false);
});

test('coalesces a repeated URL, rejects concurrent transfers, and explicit cancel releases the bridge', async t => {
  const h = harness();
  t.after(h.dispose);
  h.attach();
  const first = h.window.YuzhouDownloads.downloadUrl('blob:' + ORIGIN + '/one', 'one');
  assert.equal(h.window.YuzhouDownloads.downloadUrl('blob:' + ORIGIN + '/one', 'one'), first);
  assert.equal(await h.window.YuzhouDownloads.downloadUrl('blob:' + ORIGIN + '/two', 'two'), false);
  assert.match(h.notices[0], /当前文件/);
  assert.equal(h.window.YuzhouDownloads.cancel(), true);
  assert.equal(await first, false);
  assert.equal(await h.window.YuzhouDownloads.downloadUrl('blob:' + ORIGIN + '/three', 'three'), true);
});

test('does not install on another origin or inside an iframe; injection is idempotent', t => {
  const foreign = harness({ origin: 'https://example.com' });
  const child = harness({ frame: true });
  const trusted = harness();
  t.after(() => { foreign.dispose(); child.dispose(); trusted.dispose(); });
  assert.equal(foreign.window.YuzhouDownloads, undefined);
  assert.equal(child.window.YuzhouDownloads, undefined);
  const original = trusted.window.YuzhouDownloads;
  trusted.run();
  assert.equal(trusted.window.YuzhouDownloads, original);
});

test('accepts only a native/trusted main-frame port and closes duplicate ports', t => {
  const h = harness();
  t.after(h.dispose);
  h.attach(undefined, { origin: 'https://example.com' });
  assert.equal(h.window.YuzhouDownloads.ready, false);
  h.attach(undefined, { source: {} });
  assert.equal(h.window.YuzhouDownloads.ready, false);
  h.attach(undefined, { data: 'other-channel' });
  assert.equal(h.window.YuzhouDownloads.ready, false);
  h.attach(undefined, { origin: ORIGIN, source: h.window });
  assert.equal(h.window.YuzhouDownloads.ready, true);
  let closed = false;
  h.dispatch('message', { data: 'yuzhou-download-port-v1', ports: [{ close() { closed = true; } }], origin: '', source: null });
  assert.equal(closed, true);
});

test('rejects an incorrect ACK and never advances the transfer', async t => {
  const h = harness({ blob: new Blob([new Uint8Array(CHUNK + 1)]) });
  t.after(h.dispose);
  h.attach((message, reply) => {
    if (message.type === 'begin') reply({ type: 'ready' });
    if (message.type === 'chunk') reply({ type: 'ack', sequence: 99 });
  });
  assert.equal(await h.window.YuzhouDownloads.downloadUrl('blob:' + ORIGIN + '/bad-ack', 'x'), false);
  assert.equal(h.messages.filter(message => message.type === 'chunk').length, 1);
  assert.match(h.notices[0], /顺序异常/);
});

test('times out unavailable native integration with a visible retry message', async t => {
  const h = harness({ timeoutScale: 0.001 });
  t.after(h.dispose);
  // The real page event loop remains alive, as it would inside Android WebView.
  const keepAlive = setTimeout(() => {}, 1000);
  t.after(() => clearTimeout(keepAlive));
  assert.equal(await h.window.YuzhouDownloads.downloadUrl('blob:' + ORIGIN + '/no-port', 'x'), false);
  assert.match(h.notices[0], /尚未就绪/);
  assert.equal(h.messages.length, 0);
});

test('leaving the page cancels pending work and disconnects the old port silently', async t => {
  const h = harness();
  t.after(h.dispose);
  h.attach(() => {});
  const saving = h.window.YuzhouDownloads.downloadUrl('blob:' + ORIGIN + '/leaving', 'x');
  await until(() => h.messages.some(message => message.type === 'begin'));
  h.dispatch('pagehide');
  assert.equal(await saving, false);
  assert.equal(h.window.YuzhouDownloads.ready, false);
  assert.deepEqual(h.notices, []);
});

test('real frontend complete backup exports through the native bridge in a mobile browser', { skip: !process.env.YUZHOU_PLAYWRIGHT_MODULE }, async () => {
  const { chromium } = await import(pathToFileURL(process.env.YUZHOU_PLAYWRIGHT_MODULE).href);
  const frontend = fileURLToPath(new URL('../../frontend/', import.meta.url));
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const unexpectedRequests = [];
    // Every network request is intercepted. No production session or user data
    // is accessed: the real source app runs against a local-mode health fixture.
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== ORIGIN) { unexpectedRequests.push(url.pathname); return route.abort(); }
      if (url.pathname === '/api/health') return route.fulfill({ json: { mode: 'local' } });
      if (url.pathname.startsWith('/api/')) { unexpectedRequests.push(url.pathname); return route.fulfill({ status: 404, body: 'No production API allowed in this test' }); }
      const file = path.resolve(frontend, url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
      assert(file.startsWith(frontend));
      const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' }[path.extname(file)] || 'application/octet-stream';
      try { return route.fulfill({ body: await readFile(file), contentType: mime }); }
      catch { return route.fulfill({ status: 404, body: 'Not found' }); }
    });
    await context.addInitScript({ content: source });
    const page = await context.newPage();
    await page.goto(ORIGIN + '/#/settings');
    await page.locator('[data-action="export"]').waitFor();
    await page.evaluate(() => {
      const channel = new MessageChannel();
      const chunks = [];
      window.__captured = { done: false };
      channel.port2.onmessage = event => {
        const message = JSON.parse(event.data);
        const reply = body => channel.port2.postMessage(JSON.stringify({ id: message.id, ...body }));
        if (message.type === 'begin') {
          window.__captured.name = message.name;
          window.__captured.size = message.size;
          reply({ type: 'ready' });
        }
        if (message.type === 'chunk') {
          chunks.push(Uint8Array.from(atob(message.data), value => value.charCodeAt(0)));
          reply({ type: 'ack', sequence: message.sequence });
        }
        if (message.type === 'end') {
          const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
          let offset = 0;
          for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
          window.__captured.backup = JSON.parse(new TextDecoder().decode(bytes));
          window.__captured.actualSize = bytes.length;
          window.__captured.done = true;
          reply({ type: 'complete' });
        }
      };
      window.postMessage('yuzhou-download-port-v1', location.origin, [channel.port1]);
    });
    await page.waitForFunction(() => window.YuzhouDownloads.ready);
    await page.locator('[data-action="export"]').click();
    await page.waitForFunction(() => window.__captured.done);
    const result = await page.evaluate(() => ({ name: window.__captured.name, size: window.__captured.size, actualSize: window.__captured.actualSize, format: window.__captured.backup.format, hasLedger: !!window.__captured.backup.state.ledger }));
    assert.equal(result.format, 'lumi-backup');
    assert.equal(result.size, result.actualSize);
    assert.equal(result.hasLedger, true);
    assert.match(result.name, /宇宙-.*-备份-.*\.json$/);
    assert.deepEqual(unexpectedRequests, []);
    await context.close();
  } finally { await browser.close(); }
});
