import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createWorkbenchServer } from '../server.mjs';
import { RUNTIME_ROOT, assertRuntimePath } from '../../runtime.mjs';
import { createWorkbench } from '../../frontend/src/workbench-model.js';

const publicOrigin = 'https://workbench.example';
const setupToken = 'synthetic-web-deployment-setup-token-2026';
const credentials = { username: 'web-fixture', password: 'synthetic-web-deployment-password-2026' };
const stamp = '2026-10-23T00:00:00.000Z';

// These fixtures create a new private test directory. They never load .env or
// the persistent data directory used by a person's running workbench.
async function fixture(t, { secureCookie = true } = {}) {
  const parent = assertRuntimePath(join(RUNTIME_ROOT, 'tests-temp'));
  await mkdir(parent, { recursive: true });
  const directory = assertRuntimePath(await mkdtemp(join(parent, 'web-deployment-')));
  const options = { dataDir: directory, setupToken, secureCookie,
    ...(secureCookie ? { publicOrigin } : {}) };
  let app, origin, cookie = '', csrf = '';
  t.after(async () => {
    await app?.close();
    await rm(assertRuntimePath(directory), { recursive: true, force: true });
  });
  async function start() {
    app = await createWorkbenchServer(options);
    await new Promise((ready, reject) => {
      app.server.once('error', reject);
      app.server.listen(0, '127.0.0.1', ready);
    });
    assert.equal(app.server.address().address, '127.0.0.1');
    origin = `http://127.0.0.1:${app.server.address().port}`;
  }
  await start();
  async function api(path, { method = 'GET', body, headers = {}, auth = true, binary = false } = {}) {
    const writing = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
    const response = await fetch(origin + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': binary ? 'application/octet-stream' : 'application/json' } : {}),
        ...(writing ? { Origin: secureCookie ? publicOrigin : origin } : {}),
        ...(auth && cookie ? { Cookie: cookie, 'X-CSRF-Token': csrf } : {}),
        ...headers,
      },
      ...(body === undefined ? {} : { body: binary ? body : JSON.stringify(body) }),
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const value = method === 'HEAD' ? null : (response.headers.get('content-type') || '').includes('application/json')
      ? await response.json() : Buffer.from(await response.arrayBuffer());
    if (value?.csrfToken) csrf = value.csrfToken;
    return { status: response.status, headers: response.headers, body: value };
  }
  return { api, directory, get origin() { return origin; }, get cookie() { return cookie; },
    setup: headers => api('/api/auth/setup', { method: 'POST', body: { ...credentials, setupToken }, headers }),
    async restart() { await app.close(); await start(); },
  };
}

test('HTTPS proxy workflow uses the configured origin and host-only Secure cookie through setup, login and CSRF checks', async t => {
  const f = await fixture(t);
  for (const Origin of [f.origin, 'https://attacker.example', 'null', '']) {
    const denied = await f.setup({ Origin, Forwarded: 'proto=https;host=workbench.example',
      'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'workbench.example' });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.error, 'origin_forbidden');
  }
  assert.equal((await f.api('/api/auth/session')).body.setupRequired, true);
  const created = await f.setup();
  assert.equal(created.status, 201);
  const header = created.headers.get('set-cookie');
  assert.match(header, /^__Host-czb_web_yuzhou_session=/);
  for (const part of ['Path=/', 'HttpOnly', 'SameSite=Strict', 'Secure']) assert.ok(header.split('; ').includes(part));
  assert.doesNotMatch(header, /(?:^|;)\s*Domain=/i);
  assert.equal(created.headers.get('strict-transport-security'), 'max-age=31536000');
  const firstCookie = f.cookie;
  const write = { method: 'PUT', body: { baseRevision: 0, state: workspace() } };
  assert.equal((await f.api('/api/workspace', { ...write, headers: { 'X-CSRF-Token': '' } })).body.error, 'csrf_invalid');
  assert.equal((await f.api('/api/workspace', { ...write, headers: { Origin: f.origin,
    Forwarded: 'proto=https;host=workbench.example', 'X-Forwarded-Host': 'workbench.example' } })).body.error, 'origin_forbidden');
  assert.equal((await f.api('/api/workspace', { ...write, headers: { 'Sec-Fetch-Site': 'cross-site' } })).body.error, 'origin_forbidden');
  assert.equal((await f.api('/api/workspace')).body.revision, 0);
  assert.equal((await f.api('/api/workspace', write)).status, 200);
  assert.equal((await f.api('/api/auth/logout', { method: 'POST' })).status, 200);
  assert.equal((await f.api('/api/workspace')).status, 401);
  assert.equal((await f.api('/api/auth/login', { method: 'POST', body: credentials,
    headers: { Origin: 'https://attacker.example', 'X-Forwarded-Host': 'workbench.example' } })).status, 403);
  const login = await f.api('/api/auth/login', { method: 'POST', body: credentials });
  assert.equal(login.status, 200);
  assert.notEqual(f.cookie, firstCookie);
  assert.equal((await f.api('/api/auth/session', { headers: { Cookie: firstCookie } })).body.authenticated, false);
  for (const name of ['czb_web_yuzhou_session', 'czb_yuzhou_session', 'shiguang_session']) {
    assert.equal((await f.api('/api/auth/session', { headers: { Cookie: f.cookie.replace(/^__Host-czb_web_yuzhou_session/, name) } })).body.authenticated, false);
  }
});

function workspace(fileId) {
  return { schema: 1, mode: 'personal', profile: { name: '合成Web工作台', major: '', provider: 'deepseek' },
    workbench: createWorkbench('full'), courses: [], english: {}, spaces: [],
    tasks: [{ id: 'web-task', title: '检查Web部署', date: '2026-10-24', done: false }],
    captures: fileId ? [{ id: 'web-original', text: '合成附件', blobId: fileId }] : [],
    canvas: { presentation: 'canvas', cards: [
      { id: 'tasks', x: -36, y: 120, w: 320, h: 280, color: '#63E6DC' },
      { id: 'calendar', x: 324, y: 120, w: 450, h: 360, color: '#FF9CCE' },
    ], view: { x: 15, y: -12, zoom: 0.7 }, snap: true, initialized: true, customized: true },
    calendar: { version: 1, events: [{ id: 'web-event', title: '合成发布检查', kind: 'plan', startDate: '2026-10-24',
      endDate: '2026-10-24', allDay: true, startTime: '', endTime: '', location: '', notes: '', important: false,
      done: false, archived: false, color: '#AE88FF', createdAt: stamp, updatedAt: stamp }] },
    ledger: { version: 1, currency: 'CNY', projects: [], entries: [] },
    aiRequests: [], aiDraft: { text: '', files: [], targetId: 'auto' }, updatedAt: stamp };
}

test('HTTPS proxy sessions retain full workspace state and original attachment bytes across restart and login', async t => {
  const f = await fixture(t);
  await f.setup();
  const id = randomUUID(), original = Buffer.from([0, 255, 1, 2, ...Buffer.from('Web合成原件\n')]);
  const uploaded = await f.api(`/api/files/${id}`, { method: 'PUT', body: original, binary: true,
    headers: { 'X-File-Name': encodeURIComponent('Web合成原件.bin') } });
  assert.equal(uploaded.status, 201);
  assert.equal(uploaded.body.sha256, createHash('sha256').update(original).digest('hex'));
  const state = workspace(id);
  assert.equal((await f.api('/api/workspace', { method: 'PUT', body: { baseRevision: 0, state } })).body.revision, 1);
  const persisted = (await f.api('/api/workspace')).body;
  assert.deepEqual(persisted.state, state);
  const stale = workspace(id); stale.tasks[0].title = '过期设备不得覆盖';
  assert.equal((await f.api('/api/workspace', { method: 'PUT', body: { baseRevision: 0, state: stale } })).status, 409);
  await f.restart();
  assert.equal((await f.api('/api/auth/session')).body.authenticated, true);
  assert.deepEqual((await f.api('/api/workspace')).body, persisted);
  await f.api('/api/auth/logout', { method: 'POST' });
  assert.equal((await f.api(`/api/files/${id}`)).status, 401);
  assert.equal((await f.api('/api/auth/login', { method: 'POST', body: credentials })).status, 200);
  const downloaded = await f.api(`/api/files/${id}`);
  assert.equal(downloaded.status, 200);
  assert.deepEqual(downloaded.body, original);
  assert.match(downloaded.headers.get('content-disposition'), /^attachment;/);
  assert.equal(downloaded.headers.get('etag'), `"${uploaded.body.sha256}"`);
  assert.equal(downloaded.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual((await f.api('/api/workspace')).body.state, state);
});

test('hash deep links load the Web shell while workspace, model state and runtime files remain private', async t => {
  const f = await fixture(t);
  const privateMarker = 'SYNTHETIC_WEB_PRIVATE_FILE_NOT_FOR_HTTP';
  await writeFile(join(f.directory, '.env'), privateMarker, { flag: 'wx' });
  await writeFile(join(f.directory, 'synthetic-private.txt'), privateMarker, { flag: 'wx' });
  for (const path of ['/#/welcome', '/#/calendar', '/#/home/layout']) {
    const shell = await f.api(path, { auth: false });
    assert.equal(shell.status, 200);
    assert.match(shell.body.toString('utf8'), /src\/app\.js/);
  }
  for (const path of ['/api/workspace', '/api/model/status', `/api/files/${randomUUID()}`]) {
    assert.equal((await f.api(path, { auth: false })).status, 401);
  }
  await f.setup();
  const model = await f.api('/api/model/status');
  assert.equal(model.status, 200);
  assert.equal(model.body.configured, false);
  assert.equal((await f.api('/src/workbench-model.js')).status, 200);
  assert.match((await f.api('/miniapp-runtime.html')).headers.get('content-security-policy'), /sandbox allow-scripts/);
  for (const path of ['/.env', '/.cu-runtime/data/workbench.sqlite', '/.cu-runtime/tests-temp/synthetic-private.txt',
    '/synthetic-private.txt', '/backend/server.mjs', '/tests/web-deployment.test.mjs', '/src/%2e%2e%2f.env']) {
    const blocked = await f.api(path);
    assert.ok([400, 404].includes(blocked.status), `${path}: ${blocked.status}`);
    assert.equal(JSON.stringify(blocked.body).includes(privateMarker), false);
  }
});

test('local development retains its existing isolated cookie and does not accept a forged proxy origin', async t => {
  const f = await fixture(t, { secureCookie: false });
  const created = await f.setup();
  assert.equal(created.status, 201);
  assert.match(created.headers.get('set-cookie'), /^czb_web_yuzhou_session=/);
  assert.doesNotMatch(created.headers.get('set-cookie'), /__Host-|; Secure(?:;|$)/);
  assert.equal(created.headers.get('strict-transport-security'), null);
  const forged = await f.api('/api/workspace', { method: 'PUT', body: { baseRevision: 0, state: workspace() },
    headers: { Origin: publicOrigin, Forwarded: 'proto=https;host=workbench.example',
      'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'workbench.example' } });
  assert.equal(forged.status, 403);
  assert.equal(forged.body.error, 'origin_forbidden');
  assert.equal((await f.api('/api/workspace', { method: 'PUT', body: { baseRevision: 0, state: workspace() } })).status, 200);
});
