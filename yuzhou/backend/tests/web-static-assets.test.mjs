import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { request } from 'node:http';
import { basename, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { createWorkbenchServer } from '../server.mjs';
import { FRONTEND_ROOT, RUNTIME_ROOT, assertRuntimePath } from '../../runtime.mjs';

const setupToken = 'synthetic-web-assets-setup';
const mime = { js: /javascript/, css: /text\/css/ };

async function fixture(t) {
  const parent = assertRuntimePath(join(RUNTIME_ROOT, 'tests-temp'));
  await mkdir(parent, { recursive: true });
  const directory = assertRuntimePath(await mkdtemp(join(parent, 'web-static-assets-')));
  let app;
  t.after(async () => {
    await app?.close();
    const resolved = assertRuntimePath(await realpath(directory));
    assert.equal(dirname(resolved), await realpath(parent));
    assert.match(basename(resolved), /^web-static-assets-/);
    await rm(resolved, { recursive: true, force: true });
  });
  app = await createWorkbenchServer({ dataDir: directory, secureCookie: false, setupToken });
  await new Promise((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(0, '127.0.0.1', resolve);
  });
  const origin = 'http://127.0.0.1:' + app.server.address().port;

  function send(path, { method = 'GET', headers = {}, body } = {}) {
    // Inspect wire bytes and headers without fetch's automatic decompression.
    return new Promise((resolve, reject) => {
      const req = request(origin + path, { method, headers, agent: false }, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('error', reject);
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      });
      req.setTimeout(5000, () => req.destroy(new Error('Local fixture request timed out')));
      req.on('error', reject);
      req.end(body);
    });
  }
  return { origin, send };
}

function assertVariant(response, expected, encoding, type) {
  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], mime[type]);
  assert.equal(response.headers['content-encoding'], encoding);
  assert.match(response.headers.vary, /\bAccept-Encoding\b/i);
  assert.match(response.headers.etag, /^"[^"]+"$/);
  assert.equal(Number(response.headers['content-length']), response.body.length);
  const decoded = encoding === 'br' ? brotliDecompressSync(response.body)
    : encoding === 'gzip' ? gunzipSync(response.body) : response.body;
  assert.deepEqual(decoded, expected);
  if (encoding) assert.ok(response.body.length < expected.length);
}

test('JavaScript and CSS support negotiated Brotli, gzip and identity with separate validators', async t => {
  const { send } = await fixture(t);
  for (const type of ['js', 'css']) {
    const path = '/src/app.' + type;
    const expected = await readFile(join(FRONTEND_ROOT, 'src', 'app.' + type));
    const [br, gzip, identity] = await Promise.all([
      send(path, { headers: { 'Accept-Encoding': 'br, gzip;q=0.5' } }),
      send(path, { headers: { 'Accept-Encoding': 'gzip, br;q=0.5' } }),
      send(path),
    ]);
    assertVariant(br, expected, 'br', type);
    assertVariant(gzip, expected, 'gzip', type);
    assertVariant(identity, expected, undefined, type);
    assert.equal(new Set([br.headers.etag, gzip.headers.etag, identity.headers.etag]).size, 3);
    for (const response of [br, gzip, identity]) {
      assert.match(response.headers['cache-control'], /\bpublic\b/);
      assert.match(response.headers['cache-control'], /\bmax-age=0\b/);
      assert.match(response.headers['cache-control'], /\bmust-revalidate\b/);
      assert.doesNotMatch(response.headers['cache-control'], /\bno-store\b/);
    }
  }
});

test('explicit q=0 overrides the wildcard and rejects requests with no acceptable representation', async t => {
  const { send } = await fixture(t);
  const path = '/src/app.js';
  const explicit = await send(path, { headers: { 'Accept-Encoding': 'br;q=0, *;q=1, identity;q=0' } });
  assert.equal(explicit.status, 200);
  assert.equal(explicit.headers['content-encoding'], 'gzip');
  const identity = await send(path, { headers: { 'Accept-Encoding': 'br;q=0, gzip;q=0, identity;q=1' } });
  assert.equal(identity.status, 200);
  assert.equal(identity.headers['content-encoding'], undefined);
  const unacceptable = await send(path, { headers: { 'Accept-Encoding': 'br;q=0, gzip;q=0, identity;q=0, *;q=0' } });
  assert.equal(unacceptable.status, 406);
  assert.match(unacceptable.headers['cache-control'], /\bno-store\b/);
});

test('a cache revalidation is scoped to the selected representation and HEAD has no body', async t => {
  const { send } = await fixture(t);
  const path = '/src/app.css';
  const headers = { 'Accept-Encoding': 'br' };
  const br = await send(path, { headers });
  const etag = br.headers.etag;
  assert.match(etag, /^"[^"]+"$/);
  const head = await send(path, { method: 'HEAD', headers });
  assert.equal(head.status, 200);
  for (const name of ['content-encoding', 'content-length', 'cache-control', 'vary', 'etag']) {
    assert.equal(head.headers[name], br.headers[name]);
  }
  assert.equal(head.body.length, 0);

  for (const method of ['GET', 'HEAD']) {
    const cached = await send(path, { method, headers: { ...headers, 'If-None-Match': '"another", W/' + etag } });
    assert.equal(cached.status, 304);
    assert.equal(cached.body.length, 0);
    assert.equal(cached.headers['content-length'], undefined);
    for (const name of ['cache-control', 'vary', 'etag']) assert.equal(cached.headers[name], br.headers[name]);
  }
  const other = await send(path, { headers: { 'Accept-Encoding': 'gzip', 'If-None-Match': etag } });
  assert.equal(other.status, 200);
  assert.equal(other.headers['content-encoding'], 'gzip');
  assert.notEqual(other.headers.etag, etag);
});

test('public documents, API data and authenticated downloads keep no-store', async t => {
  const { origin, send } = await fixture(t);
  const encoding = { 'Accept-Encoding': 'br, gzip' };
  for (const [path, status] of [
    ['/', 200], ['/miniapp-runtime.html', 200], ['/version.json', 200],
    ['/api/health', 200], ['/api/auth/session', 200], ['/api/workspace', 401],
    ['/src/not-an-asset.js', 404],
  ]) {
    const response = await send(path, { headers: encoding });
    assert.equal(response.status, status, path);
    assert.equal(response.headers['cache-control'], 'no-store', path);
    assert.equal(response.headers['content-encoding'], undefined, path);
  }

  const setup = await send('/api/auth/setup', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'web-asset-fixture', password: 'synthetic-web-assets-password', setupToken }),
  });
  assert.equal(setup.status, 201);
  const cookie = setup.headers['set-cookie'][0].split(';')[0];
  const csrf = JSON.parse(setup.body).csrfToken;
  const workspace = await send('/api/workspace', { headers: { ...encoding, Cookie: cookie } });
  assert.equal(workspace.status, 200);
  assert.equal(workspace.headers['cache-control'], 'no-store');
  assert.equal(workspace.headers['content-encoding'], undefined);
  const path = '/api/files/' + randomUUID();
  const original = 'synthetic private attachment';
  const uploaded = await send(path, {
    method: 'PUT',
    headers: { Origin: origin, Cookie: cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'text/plain', 'X-File-Name': 'test.txt' },
    body: original,
  });
  assert.equal(uploaded.status, 201);
  const downloaded = await send(path, { headers: { ...encoding, Cookie: cookie } });
  assert.equal(downloaded.status, 200);
  assert.equal(downloaded.headers['cache-control'], 'no-store');
  assert.equal(downloaded.headers['content-encoding'], undefined);
  assert.equal(downloaded.body.toString(), original);
});
