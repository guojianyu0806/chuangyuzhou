import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, linkSync, symlinkSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RUNTIME_ROOT, FRONTEND_ROOT, resolveCompetitionOptions, assertRuntimePath, loadOrCreateSetupCode } from '../../runtime.mjs';
import { createWorkbenchServer } from '../server.mjs';
import { createStore } from '../store.mjs';
import { createHermesService } from '../hermes.mjs';
import { backupWorkbench } from '../backup.mjs';

const closers = new Map();
function fixture(t) {
  assertRuntimePath(tmpdir());
  const root = mkdtempSync(join(tmpdir(), 'czb-isolation-'));
  t.after(async () => { await closers.get(root)?.(); closers.delete(root); rmSync(root, { recursive: true, force: true }); });
  return root;
}

test('competition startup uses its own localhost origin, data directory and frontend', () => {
  const current = resolveCompetitionOptions();
  assert.equal(current.host, '127.0.0.1'); assert.equal(current.port, 4396);
  assert.equal(current.dataDir, join(RUNTIME_ROOT, 'data')); assert.equal(current.frontendDir, FRONTEND_ROOT);
  for (const env of [{ DATA_DIR: 'C:/not-authorized' }, { FRONTEND_DIR: 'C:/not-authorized' }, { SETUP_TOKEN_FILE: 'C:/not-authorized' }, { SHIGUANG_HERMES_DIR: 'C:/not-authorized' }, { SHIGUANG_HERMES_PYTHON: 'C:/not-authorized/python.exe' }, { SHIGUANG_EXTRACT_PYTHON: 'python3' }, { SETUP_TOKEN: 'inherited-secret' }, { HOST: '0.0.0.0' }, { PORT: '4180' }, { PORT: '4397' }, { CZB_YUZHOU_PORT: '4398' }, { CZB_YUZHOU_PORT: '4399' }]) {
    assert.throws(() => resolveCompetitionOptions({}, env), /competition_/);
  }
});

test('store, server, Hermes and backup reject out-of-copy directories before reading or writing', async () => {
  const outside = join(RUNTIME_ROOT, '..', '..', 'not-authorized');
  assert.throws(() => createStore(outside), /competition_path_outside_copy/);
  await assert.rejects(createWorkbenchServer({ dataDir: outside }), /competition_path_outside_copy/);
  assert.throws(() => createHermesService({ dataDir: outside }), /competition_path_outside_copy/);
  await assert.rejects(backupWorkbench({ dataDir: outside, outputDir: join(RUNTIME_ROOT, 'backups') }), /competition_path_outside_copy/);
  assert.equal(existsSync(outside), false);
});

test('linked runtime directory and hard-linked credentials are rejected without changing originals', t => {
  const root = fixture(t); const actual = join(root, 'actual'); mkdirSync(actual);
  const linked = join(root, 'linked'); symlinkSync(actual, linked, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => createStore(linked), /competition_links_forbidden/);
  const original = join(root, 'original.txt'); const alias = join(actual, 'model-config.json');
  writeFileSync(original, 'synthetic original'); linkSync(original, alias);
  assert.throws(() => createStore(actual), /competition_links_forbidden/);
  assert.equal(readFileSync(original, 'utf8'), 'synthetic original');
});

test('setup code stays stable in this copy and a linked token is never overwritten', t => {
  const root = fixture(t); const token = join(root, 'setup-code.txt');
  const first = loadOrCreateSetupCode(token); assert.ok(first.length >= 24);
  assert.equal(loadOrCreateSetupCode(token), first);
  linkSync(token, join(root, 'linked-token.txt'));
  assert.throws(() => loadOrCreateSetupCode(token), /competition_links_forbidden/);
});

test('actual listening remains loopback and only the new cookie authenticates', async t => {
  const root = fixture(t); const app = await createWorkbenchServer({ dataDir: root, secureCookie: false, setupToken: 'synthetic-setup-token' });
  closers.set(root, () => app.close());
  assert.throws(() => app.server.listen(0, '0.0.0.0'), /competition_localhost_only/);
  await new Promise(done => app.server.listen(0, done));
  assert.equal(app.server.address().address, '127.0.0.1');
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  const response = await fetch(origin + '/api/auth/setup', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'fixture', password: 'synthetic-password-2026', setupToken: 'synthetic-setup-token' }) });
  assert.equal(response.status, 201);
  const cookie = response.headers.get('set-cookie').split(';')[0]; assert.match(cookie, /^czb_web_yuzhou_session=/);
  for (const oldName of ['shiguang_session', 'czb_workbench_session', 'czb_yuzhou_session']) {
    const session = await fetch(origin + '/api/auth/session', { headers: { Cookie: cookie.replace(/^czb_web_yuzhou_session/, oldName) } });
    assert.equal((await session.json()).authenticated, false);
  }
});

test('Hermes starts unconfigured without reading old engine paths or model keys', async t => {
  const root = fixture(t); const store = createStore(root);
  const service = createHermesService({ dataDir: root, store });
  closers.set(root, async () => { await service.close(); store.close(); });
  let status;
  await service.handle({ method: 'GET' }, {}, { url: new URL('http://localhost/api/model/status'), json: (_res, _code, body) => { status = body; } });
  assert.equal(status.configured, false); assert.equal(status.hermesAvailable, false); assert.equal(status.extractionAvailable, false);
  assert.throws(() => createHermesService({ dataDir: root, store, env: { SHIGUANG_HERMES_DIR: 'C:/not-authorized' } }), /competition_path_outside_copy/);
});
