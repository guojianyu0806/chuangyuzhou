import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createWorkbenchServer } from '../server.mjs';
import { createStore } from '../store.mjs';

const setupToken = 'integration-test-setup-token';
const username = 'workbench';
const password = 'a-long-test-password-2026';
const state = () => ({ schema: 1, mode: 'personal', profile: { name: '同学' }, courses: [], tasks: [], captures: [], english: {}, spaces: [], aiRequests: [], aiDraft: { text: '', files: [], targetId: 'auto' } });

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'shiguang-server-test-'));
  let app = await createWorkbenchServer({ dataDir: directory, secureCookie: false, setupToken, ...options });
  let origin;
  async function listen() { await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${app.server.address().port}`; }
  await listen();
  let cookie = ''; let csrfToken = '';
  const api = async (path, { method = 'GET', body, headers = {}, auth = true, jsonBody = true } = {}) => {
    const response = await fetch(origin + path, { method, headers: { ...(body !== undefined && jsonBody ? { 'Content-Type': 'application/json' } : {}), ...(auth && cookie ? { Cookie: cookie, 'X-CSRF-Token': csrfToken } : {}), ...(['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) ? { Origin: origin } : {}), ...headers }, ...(body !== undefined ? { body: jsonBody ? JSON.stringify(body) : body } : {}) });
    const setCookie = response.headers.get('set-cookie'); if (setCookie) cookie = setCookie.split(';')[0];
    const contentType = response.headers.get('content-type') || '';
    const result = method === 'HEAD' ? null : contentType.includes('application/json') ? await response.json() : await response.text();
    if (result?.csrfToken) csrfToken = result.csrfToken;
    return { status: response.status, headers: response.headers, body: result };
  };
  const setup = () => api('/api/auth/setup', { method: 'POST', body: { username, password, setupToken } });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  return { api, setup, directory, app, get origin() { return origin; }, async restart() { await app.close(); app = await createWorkbenchServer({ dataDir: directory, secureCookie: false, setupToken, ...options }); await listen(); } };
}

test('public health is minimal; private APIs require auth; setup cannot be claimed without token', async t => {
  const f = await fixture(t);
  assert.deepEqual((await f.api('/api/health')).body, { ok: true, mode: 'cloud', version: '0.2.0' });
  assert.equal((await f.api('/api/auth/session')).body.setupRequired, true);
  for (const path of ['/api/workspace', '/api/model/status', `/api/files/${randomUUID()}`]) assert.equal((await f.api(path)).status, 401);
  const rejected = await f.api('/api/auth/setup', { method: 'POST', body: { username, password, setupToken: 'wrong' } });
  assert.equal(rejected.status, 403);
  const created = await f.setup(); assert.equal(created.status, 201);
  assert.match(created.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  assert.equal((await f.setup()).status, 409);
  assert.equal((await f.api('/api/workspace')).body.state, null);
  assert.equal((await f.api('/api/auth/session')).body.username, username);
});

test('setup creation is atomic under concurrent requests', async t => {
  const f = await fixture(t);
  const results = await Promise.all([f.setup(), f.setup()]);
  assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
});

test('public version metadata supports the frontend update check and rejects writes', async t => {
  const f = await fixture(t);
  const version = await f.api('/version.json', { auth: false });
  assert.equal(version.status, 200);
  assert.deepEqual(version.body, { version: '0.2.0', mode: 'cloud', edition: 'private-cloud' });
  assert.equal(version.headers.get('cache-control'), 'no-store');
  assert.match(version.headers.get('content-type'), /application\/json/);
  assert.equal((await f.api('/version.json', { method: 'HEAD', auth: false })).status, 200);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const rejected = await f.api('/version.json', { method, auth: false, body: { version: 'changed' } });
    assert.equal(rejected.status, 405); assert.equal(rejected.body.error, 'method_not_allowed');
  }
  assert.equal((await f.api('/version.json')).body.version, '0.2.0');
});

test('CSRF token and exact Origin protect writes including logout', async t => {
  const f = await fixture(t); await f.setup();
  const write = { method: 'PUT', body: { baseRevision: 0, state: state() } };
  assert.equal((await f.api('/api/workspace', { ...write, headers: { 'X-CSRF-Token': '' } })).body.error, 'csrf_invalid');
  assert.equal((await f.api('/api/workspace', { ...write, headers: { Origin: 'https://attacker.invalid' } })).body.error, 'origin_forbidden');
  assert.equal((await f.api('/api/workspace', { ...write, headers: { Origin: '' } })).status, 403);
  assert.equal((await f.api('/api/workspace', { ...write, headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await f.api('/api/auth/logout', { method: 'POST', headers: { 'X-CSRF-Token': 'wrong' } })).status, 403);
  assert.equal((await f.api('/api/auth/logout', { method: 'POST' })).status, 200);
  assert.equal((await f.api('/api/workspace')).status, 401);
});

test('credentials are verified and brute force is throttled', async t => {
  const f = await fixture(t); await f.setup(); await f.api('/api/auth/logout', { method: 'POST' });
  for (let i = 0; i < 8; i++) assert.equal((await f.api('/api/auth/login', { method: 'POST', body: { username, password: 'wrong' } })).status, 401);
  const locked = await f.api('/api/auth/login', { method: 'POST', body: { username, password } });
  assert.equal(locked.status, 429); assert.ok(Number(locked.headers.get('retry-after')) > 0);
});

test('authentication persists across restart and login rotates sessions', async t => {
  const f = await fixture(t); const created = await f.setup();
  const oldCookie = created.headers.get('set-cookie').split(';')[0];
  await f.restart(); assert.equal((await f.api('/api/auth/session')).body.authenticated, true);
  const logged = await f.api('/api/auth/login', { method: 'POST', body: { username, password } });
  assert.equal(logged.status, 200); assert.notEqual(logged.headers.get('set-cookie').split(';')[0], oldCookie);
  assert.equal((await f.api('/api/auth/session', { headers: { Cookie: oldCookie } })).body.authenticated, false);
});

test('optimistic revision conflict never overwrites newer data and state persists', async t => {
  const f = await fixture(t); await f.setup();
  const initial = state(); initial.tasks.push({ id: 'task-1', title: '新任务' });
  const saved = await f.api('/api/workspace', { method: 'PUT', body: { baseRevision: 0, state: initial } });
  assert.equal(saved.status, 200); assert.equal(saved.body.revision, 1);
  const stale = await f.api('/api/workspace', { method: 'PUT', body: { baseRevision: 0, state: state() } });
  assert.equal(stale.status, 409); assert.deepEqual(stale.body, { error: 'revision_conflict', revision: 1 });
  await f.restart(); assert.deepEqual((await f.api('/api/workspace')).body.state, initial);
});

test('revision polling omits unchanged state and returns full data only when changed', async t => {
  const f = await fixture(t); await f.setup();
  assert.deepEqual((await f.api('/api/workspace?since=0')).body, { revision: 0, unchanged: true });
  assert.equal((await f.api('/api/workspace?since=-1')).status, 400);
  assert.equal((await f.api('/api/workspace?since=NaN')).status, 400);
  const current = state(); current.profile.name = '新内容';
  await f.api('/api/workspace', { method: 'PUT', body: { baseRevision: 0, state: current } });
  const changed = await f.api('/api/workspace?since=0'); assert.equal(changed.body.revision, 1); assert.deepEqual(changed.body.state, current);
  assert.deepEqual((await f.api('/api/workspace?since=1')).body, { revision: 1, unchanged: true });
  assert.deepEqual((await f.api('/api/workspace')).body.state, current);
});

test('workspace rejects demo, malformed shape, prototype keys, complexity and missing file refs', async t => {
  const f = await fixture(t); await f.setup();
  const write = value => f.api('/api/workspace', { method: 'PUT', body: { baseRevision: 0, state: value } });
  assert.equal((await write({ ...state(), mode: 'demo' })).status, 400);
  assert.equal((await write({ ...state(), courses: 'wrong' })).status, 400);
  const poisoned = JSON.parse(JSON.stringify(state()).replace('"profile":{', '"profile":{"__proto__":{"polluted":true},'));
  assert.equal((await write(poisoned)).body.error, 'invalid_workspace_key');
  let deep = {}; let node = deep; for (let i = 0; i < 45; i++) node = node.next = {};
  assert.equal((await write({ ...state(), deep })).body.error, 'workspace_too_complex');
  assert.equal((await write({ ...state(), captures: [{ id: 'x', blobId: randomUUID() }] })).body.error, 'missing_files');
  assert.equal((await write({ ...state(), captures: [{ id: 'x' }, { id: 'x' }] })).body.error, 'duplicate_record_id');
  assert.equal((await write({ ...state(), captures: [{ id: 'x', blobId: '../key' }] })).status, 400);
  assert.equal((await f.api('/api/workspace')).body.revision, 0);
});

test('file uploads are private, immutable, idempotent and safely downloadable on another session', async t => {
  const f = await fixture(t); await f.setup(); const id = randomUUID();
  const put = text => f.api(`/api/files/${id}`, { method: 'PUT', body: text, jsonBody: false, headers: { 'Content-Type': 'text/html', 'X-File-Name': encodeURIComponent('课程 <原件>.html') } });
  const uploaded = await put('<script>alert(1)</script>'); assert.equal(uploaded.status, 201);
  assert.equal((await put('<script>alert(1)</script>')).status, 200);
  assert.equal((await put('other data')).status, 409);
  const head = await f.api(`/api/files/${id}`, { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(head.headers.get('etag'), `"${uploaded.body.sha256}"`);
  const model = state(); model.captures.push({ id: 'capture-1', blobId: id, text: '课程' });
  assert.equal((await f.api('/api/workspace', { method: 'PUT', body: { baseRevision: 0, state: model } })).status, 200);
  assert.equal((await f.api(`/api/files/${id}`, { auth: false })).status, 401);
  await f.api('/api/auth/logout', { method: 'POST' }); await f.api('/api/auth/login', { method: 'POST', body: { username, password } });
  const file = await f.api(`/api/files/${id}`);
  assert.equal(file.body, '<script>alert(1)</script>'); assert.match(file.headers.get('content-disposition'), /^attachment;/);
  assert.equal(file.headers.get('x-content-type-options'), 'nosniff'); assert.match(file.headers.get('content-security-policy'), /sandbox/);
});

test('static allowlist and file IDs block traversal, private files and source test exposure', async t => {
  const f = await fixture(t); await f.setup();
  assert.equal((await f.api('/')).status, 200);
  for (const path of ['/README.md', '/server.mjs', '/tests/layout.mjs', '/.runtime/test.png', '/.env', '/src/../README.md', '/src/%2e%2e%2fREADME.md', '/api/files/%2e%2e%2fworkbench.sqlite', '/api/files/a.b']) {
    const result = await f.api(path); assert.ok([400, 404].includes(result.status), `${path}: ${result.status}`);
  }
});

test('model adapter sees authenticated writes only and can use shared contract helpers', async t => {
  let count = 0;
  const f = await fixture(t, { modelFactory: async ({ store }) => ({ async handle(req, res, { url, session, readJson, json }) { count++; assert.equal(session.username, username); assert.equal(store.getWorkspace().revision, 0); if (url.pathname === '/api/model/config') { const body = await readJson(req); json(res, 200, { received: !!body.apiKey }); return true; } return false; } }) });
  assert.equal((await f.api('/api/model/config', { method: 'PUT', body: { apiKey: 'dummy' } })).status, 401); assert.equal(count, 0);
  await f.setup(); assert.equal((await f.api('/api/model/config', { method: 'PUT', body: { apiKey: 'dummy' }, headers: { 'X-CSRF-Token': '' } })).status, 403); assert.equal(count, 0);
  assert.equal((await f.api('/api/model/config', { method: 'PUT', body: { apiKey: 'dummy' } })).status, 200); assert.equal(count, 1);
});

test('insecure public-origin configuration fails closed', async () => {
  await assert.rejects(() => createWorkbenchServer({ publicOrigin: 'http://203.0.113.1', secureCookie: false }), /Insecure cookies/);
});

test('public HTTPS uses Secure host-only cookies and rejects mismatched Origin', async t => {
  const f = await fixture(t, { secureCookie: true, publicOrigin: 'https://workbench.example' });
  assert.equal((await f.setup()).status, 403);
  const result = await f.api('/api/auth/setup', { method: 'POST', body: { username, password, setupToken }, headers: { Origin: 'https://workbench.example' } });
  assert.equal(result.status, 201);
  assert.match(result.headers.get('set-cookie'), /^__Host-shiguang_session=/);
  assert.match(result.headers.get('set-cookie'), /; Secure$/);
  assert.doesNotMatch(result.headers.get('set-cookie'), /Domain=/);
});

test('storage quotas are enforced atomically and partial uploads are cleaned', async t => {
  const f = await fixture(t, { storeOptions: { storageLimitBytes: 5 } }); await f.setup();
  const id = randomUUID();
  const result = await f.api(`/api/files/${id}`, { method: 'PUT', body: 'too large for test quota', jsonBody: false, headers: { 'Content-Type': 'text/plain' } });
  assert.equal(result.status, 413); assert.equal(result.body.error, 'storage_quota_exceeded');
  assert.equal((await f.api(`/api/files/${id}`)).status, 404);
  assert.deepEqual(await readdir(join(f.directory, 'files')), []);
  assert.deepEqual(await readdir(join(f.directory, 'tmp')), []);
});

test('history is bounded and persisted workspace is transactional with missing file refs', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'shiguang-store-test-'));
  const store = createStore(directory, { historyLimit: 2 });
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  for (let revision = 0; revision < 5; revision++) store.saveWorkspace(revision, { ...state(), updatedAt: String(revision) });
  assert.equal(store.getWorkspace().revision, 5);
  const inspection = new DatabaseSync(join(directory, 'workbench.sqlite'), { readOnly: true });
  assert.equal(inspection.prepare('SELECT COUNT(*) AS count FROM workspace_history').get().count, 2);
  inspection.close();
  assert.throws(() => store.saveWorkspace(5, { ...state(), captures: [{ id: 'x', blobId: 'missing' }] }), /missing_files/);
  assert.equal(store.getWorkspace().revision, 5);
});
