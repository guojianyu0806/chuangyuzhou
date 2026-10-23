import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHermesService } from '../hermes.mjs';
import { createDeepSeekRunner } from '../deepseek.mjs';
import { createWorkbenchServer } from '../server.mjs';
import { RUNTIME_ROOT, assertRuntimePath } from '../../runtime.mjs';

const ENV_KEY = 'synthetic-environment-key-no-provider-2026';
const LOCAL_KEY = 'synthetic-local-key-no-provider-2026';
const MODEL = 'deepseek-v4-pro';
const BASE_URL = 'https://api.deepseek.com';
const proposal = () => ({ title: '合成整理', summary: '依据用户原文整理。',
  notes: [{ title: '复习安排', content: '明天复习数据结构。', sourceIds: ['input'] }], tasks: [],
  destinationId: 'inbox', reason: '依据用户原文。', warnings: [] });
const localConfig = () => ({ provider: 'deepseek', model: 'deepseek-chat', apiKey: LOCAL_KEY,
  baseUrl: BASE_URL, updatedAt: '2026-10-01T00:00:00.000Z' });
const cleanups = new WeakMap();

function cleanupFor(t) {
  if (!cleanups.has(t)) {
    const cleanup = { close: [], directories: [] };
    cleanups.set(t, cleanup);
    t.after(async () => {
      for (const close of cleanup.close.reverse()) await close();
      for (const path of cleanup.directories) rmSync(assertRuntimePath(path), { recursive: true, force: true });
    });
  }
  return cleanups.get(t);
}

function directory(t) {
  const parent = assertRuntimePath(join(RUNTIME_ROOT, 'tests-temp'));
  mkdirSync(parent, { recursive: true });
  const value = assertRuntimePath(mkdtempSync(join(parent, 'model-environment-service-')));
  cleanupFor(t).directories.push(value);
  return value;
}

function seedLocal(dataDir) {
  const path = join(dataDir, 'ai', 'model-config.json');
  mkdirSync(join(dataDir, 'ai'), { recursive: true });
  const bytes = JSON.stringify(localConfig(), null, 2) + '\n';
  writeFileSync(path, bytes, { flag: 'wx' });
  return { path, bytes };
}

function fixture(t, { env = {}, dataDir = directory(t), runModel, ...options } = {}) {
  const calls = [];
  const state = { courses: [], spaces: [], tasks: [], captures: [], aiRequests: [] };
  const store = { getWorkspace: () => ({ state: structuredClone(state), revision: 1 }),
    saveWorkspace: () => assert.fail('An organize-only test must not save business records.'),
    fileInfo: () => null, filePath: id => join(dataDir, id) };
  const service = createHermesService({ dataDir, store, env, engine: 'deepseek-direct',
    runModel: runModel || (async input => { calls.push(input); return proposal(); }), ...options });
  cleanupFor(t).close.push(() => service.close());
  async function call(method, path, body) {
    let response;
    assert.equal(await service.handle({ method }, {}, { url: new URL(path, 'http://localhost'),
      readJson: async () => body,
      json: (_res, status, value) => { response = { status, body: structuredClone(value) }; } }), true);
    return response;
  }
  return { dataDir, service, calls, call };
}

async function finish(call, id) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const result = await call('GET', `/api/ai/jobs/${id}`);
    if (['succeeded', 'failed'].includes(result.body.job.status)) return result;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail('The synthetic model job did not complete.');
}

function assertNoSecret(value, secret = ENV_KEY) {
  assert.equal((typeof value === 'string' ? value : JSON.stringify(value)).includes(secret), false,
    'The environment credential must stay outside public responses and persisted data.');
}

function assertDirectoryHasNoSecret(path, secret = ENV_KEY) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) assertDirectoryHasNoSecret(child, secret);
    else if (entry.isFile()) assert.equal(readFileSync(child).includes(Buffer.from(secret)), false,
      'Synthetic runtime files must not contain the environment credential.');
  }
}

test('environment configuration is ready without saving and captures startup values for actual jobs', async t => {
  const env = { DEEPSEEK_API_KEY: ENV_KEY, DEEPSEEK_MODEL: MODEL };
  const f = fixture(t, { env });
  const status = await f.call('GET', '/api/model/status');
  assert.equal(status.body.configured, true);
  assert.equal(status.body.model, MODEL);
  assert.equal(status.body.configurationSource, 'environment');
  assert.equal(status.body.configurationManaged, true);
  assert.equal(f.calls.length, 0);
  assert.equal(existsSync(join(f.dataDir, 'ai', 'model-config.json')), false);
  assertNoSecret(status);

  env.DEEPSEEK_API_KEY = 'synthetic-mutated-key-not-used';
  env.DEEPSEEK_MODEL = 'deepseek-reasoner';
  const started = await f.call('POST', '/api/ai/jobs', { requestId: 'environment-startup-snapshot',
    text: '明天复习数据结构。', destinationId: 'inbox' });
  assert.equal(started.status, 202);
  const done = await finish(f.call, started.body.job.id);
  assert.equal(done.body.job.status, 'succeeded');
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].settings.apiKey, ENV_KEY);
  assert.equal(f.calls[0].settings.model, MODEL);
  assert.equal(f.calls[0].settings.baseUrl, BASE_URL);
  assert.equal((await f.call('GET', '/api/model/status')).body.model, MODEL);
  assertNoSecret(started); assertNoSecret(done);
  assertDirectoryHasNoSecret(f.dataDir);
  assertDirectoryHasNoSecret(f.dataDir, env.DEEPSEEK_API_KEY);
});

test('environment key overrides an existing local file and every configuration PUT preserves its exact bytes', async t => {
  const dataDir = directory(t), saved = seedLocal(dataDir);
  const f = fixture(t, { dataDir, env: { DEEPSEEK_API_KEY: ENV_KEY } });
  const status = await f.call('GET', '/api/model/status');
  assert.equal(status.body.model, 'deepseek-flash');
  assert.equal(status.body.configurationSource, 'environment');
  assert.equal(status.body.configurationManaged, true);
  for (const body of [
    { enabled: false },
    { provider: 'deepseek', model: MODEL, apiKey: '' },
    { provider: 'deepseek', model: MODEL, apiKey: 'synthetic-ui-key-not-applied' },
    { provider: 'deepseek', model: 'unsupported', apiKey: ENV_KEY, baseUrl: 'http://unapproved.invalid' },
    null, [],
  ]) {
    const result = await f.call('PUT', '/api/model/config', body);
    assert.equal(result.status, 409);
    assert.equal(result.body.error, 'MODEL_CONFIG_MANAGED');
    assertNoSecret(result);
    assert.equal(readFileSync(saved.path, 'utf8'), saved.bytes);
  }
  assert.equal(f.calls.length, 0);
  const started = await f.call('POST', '/api/ai/jobs', { requestId: 'environment-over-local', text: '明天复习数据结构。' });
  assert.equal((await finish(f.call, started.body.job.id)).body.job.status, 'succeeded');
  assert.equal(f.calls[0].settings.apiKey, ENV_KEY);
  assert.equal(f.calls[0].settings.model, 'deepseek-flash');
  assertDirectoryHasNoSecret(dataDir);

  f.service.close();
  const restored = fixture(t, { dataDir });
  const local = await restored.call('GET', '/api/model/status');
  assert.equal(local.body.configured, true);
  assert.equal(local.body.model, localConfig().model);
  assert.equal(local.body.configurationSource, 'local');
  assert.equal(local.body.configurationManaged, false);
  assert.equal(readFileSync(saved.path, 'utf8'), saved.bytes);
});

test('a model name alone does not take control of local settings or create an environment configuration', async t => {
  const dataDir = directory(t), saved = seedLocal(dataDir);
  const local = fixture(t, { dataDir, env: { DEEPSEEK_MODEL: MODEL } });
  const status = (await local.call('GET', '/api/model/status')).body;
  assert.equal(status.configured, true);
  assert.equal(status.model, localConfig().model);
  assert.equal(status.configurationSource, 'local');
  assert.equal(status.configurationManaged, false);
  assert.equal(readFileSync(saved.path, 'utf8'), saved.bytes);

  const empty = fixture(t, { env: { DEEPSEEK_API_KEY: '', DEEPSEEK_MODEL: MODEL } });
  const none = (await empty.call('GET', '/api/model/status')).body;
  assert.equal(none.configured, false);
  assert.equal(none.configurationSource, 'none');
  assert.equal(none.configurationManaged, false);
  assert.equal(existsSync(join(empty.dataDir, 'ai', 'model-config.json')), false);
  assert.equal(local.calls.length + empty.calls.length, 0);
});

test('all supported environment model names select the same managed configuration path', async t => {
  for (const model of ['deepseek-flash', 'deepseek-v4-pro', 'deepseek-chat', 'deepseek-reasoner']) {
    const f = fixture(t, { env: { DEEPSEEK_API_KEY: ENV_KEY, DEEPSEEK_MODEL: model } });
    const status = (await f.call('GET', '/api/model/status')).body;
    assert.equal(status.model, model);
    assert.equal(status.configurationSource, 'environment');
    assert.equal(status.configurationManaged, true);
    assertNoSecret(status);
    assert.equal(f.calls.length, 0);
  }
});

test('without an environment key the existing local save, blank-key model update, restart and clear behavior stays available', async t => {
  const f = fixture(t);
  const initial = (await f.call('GET', '/api/model/status')).body;
  assert.equal(initial.configured, false);
  assert.equal(initial.configurationSource, 'none');
  assert.equal(initial.configurationManaged, false);
  const rejected = await f.call('PUT', '/api/model/config', { provider: 'deepseek', model: MODEL, apiKey: '' });
  assert.equal(rejected.status, 400);
  const saved = await f.call('PUT', '/api/model/config', { provider: 'deepseek', model: 'deepseek-flash', apiKey: LOCAL_KEY });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.configurationSource, 'local');
  assert.equal(saved.body.configurationManaged, false);
  assertNoSecret(saved, LOCAL_KEY);
  const updated = await f.call('PUT', '/api/model/config', { provider: 'deepseek', model: MODEL, apiKey: '' });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.model, MODEL);
  const path = join(f.dataDir, 'ai', 'model-config.json');
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).apiKey, LOCAL_KEY);
  assert.equal(f.calls.length, 0);
  f.service.close();

  const restarted = fixture(t, { dataDir: f.dataDir });
  const afterRestart = (await restarted.call('GET', '/api/model/status')).body;
  assert.equal(afterRestart.configured, true);
  assert.equal(afterRestart.model, MODEL);
  assert.equal(afterRestart.configurationSource, 'local');
  assertNoSecret(afterRestart, LOCAL_KEY);
  const cleared = await restarted.call('PUT', '/api/model/config', { enabled: false });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.configured, false);
  assert.equal(cleared.body.configurationSource, 'none');
  assert.equal(cleared.body.configurationManaged, false);
  assert.equal(existsSync(path), false);
  assert.equal(restarted.calls.length, 0);
});

async function httpFixture(t, fetchImpl) {
  const dataDir = directory(t);
  const setupToken = 'synthetic-environment-service-setup-token';
  const app = await createWorkbenchServer({ dataDir, secureCookie: false, setupToken,
    modelFactory: ({ dataDir: serviceData, store }) => createHermesService({ dataDir: serviceData, store,
      env: { DEEPSEEK_API_KEY: ENV_KEY, DEEPSEEK_MODEL: MODEL }, engine: 'deepseek-direct',
      runModel: createDeepSeekRunner({ fetch: fetchImpl }) }) });
  cleanupFor(t).close.push(() => app.close());
  await new Promise((resolve, reject) => {
    app.server.once('error', reject); app.server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  let cookie = '', csrfToken = '';
  async function api(method, path, body, { auth = true, csrf = true } = {}) {
    const response = await fetch(origin + path, { method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(auth && cookie ? { Cookie: cookie } : {}),
        ...(auth && csrf && csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        ...(['POST', 'PUT', 'DELETE'].includes(method) ? { Origin: origin } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const setCookie = response.headers.get('set-cookie'); if (setCookie) cookie = setCookie.split(';')[0];
    const value = await response.json(); if (value.csrfToken) csrfToken = value.csrfToken;
    return { status: response.status, body: value };
  }
  return { dataDir, api, setup: async () => {
    const result = await api('POST', '/api/auth/setup', {
      username: 'environment-test', password: 'synthetic-long-password-2026', setupToken });
    assert.equal(result.status, 201);
    app.store.saveWorkspace(0, { schema: 1, mode: 'personal',
      profile: { name: '合成验证', major: '', provider: 'deepseek' },
      courses: [], spaces: [], tasks: [], captures: [], english: {},
      calendar: { version: 1, events: [] },
      ledger: { version: 1, currency: 'CNY', projects: [], entries: [] },
      aiRequests: [], aiDraft: { text: '', files: [], targetId: 'auto' },
      updatedAt: '2026-10-23T00:00:00.000Z' });
    return result;
  } };
}

test('authenticated HTTP jobs use the environment Bearer header and model without exposing or persisting credentials', async t => {
  const requests = [];
  const f = await httpFixture(t, async (url, options) => {
    requests.push({ url, options });
    if (requests.length === 2) return new Response('Private provider diagnostic ' + ENV_KEY, { status: 401 });
    return Response.json({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(proposal()) } }] });
  });
  assert.equal((await f.api('GET', '/api/model/status', undefined, { auth: false })).status, 401);
  assert.equal((await f.api('POST', '/api/ai/jobs', { requestId: 'no-session', text: '合成请求' }, { auth: false })).status, 401);
  assert.equal((await f.setup()).status, 201);
  const status = await f.api('GET', '/api/model/status');
  assert.equal(status.body.configurationSource, 'environment');
  assert.equal(status.body.configurationManaged, true);
  assertNoSecret(status);
  const invalidCsrf = await f.api('POST', '/api/ai/jobs', { requestId: 'no-csrf', text: '合成请求' }, { csrf: false });
  assert.equal(invalidCsrf.status, 403);
  const managed = await f.api('PUT', '/api/model/config', { provider: 'deepseek', model: 'deepseek-chat', apiKey: ENV_KEY });
  assert.equal(managed.status, 409);
  assert.equal(managed.body.error, 'MODEL_CONFIG_MANAGED');
  assertNoSecret(managed);
  assert.equal(requests.length, 0);

  for (const [requestId, expectedStatus] of [['http-environment-success', 'succeeded'], ['http-environment-failure', 'failed']]) {
    const started = await f.api('POST', '/api/ai/jobs', { requestId, text: '明天复习数据结构。', destinationId: 'inbox' });
    assert.equal(started.status, 202);
    const done = await finish(f.api, started.body.job.id);
    assert.equal(done.body.job.status, expectedStatus, JSON.stringify(done.body.job.error || done.body.job));
    if (expectedStatus === 'failed') assert.equal(done.body.job.error.code, 'MODEL_AUTH_FAILED');
    assertNoSecret(started); assertNoSecret(done);
  }
  assert.equal(requests.length, 2);
  for (const { url, options } of requests) {
    assert.equal(url, 'https://api.deepseek.com/chat/completions');
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, `Bearer ${ENV_KEY}`);
    const body = JSON.parse(options.body);
    assert.equal(body.model, MODEL);
    assertNoSecret(body);
  }
  assertNoSecret(await f.api('GET', '/api/ai/jobs'));
  assertNoSecret(await f.api('GET', '/api/workspace'));
  assert.equal(existsSync(join(f.dataDir, 'ai', 'model-config.json')), false);
  assertDirectoryHasNoSecret(f.dataDir);
});
