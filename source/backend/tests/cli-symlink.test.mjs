import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, symlink, rm, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { isCliEntry } from '../is-cli.mjs';
import { createStore } from '../store.mjs';

const workspace = fileURLToPath(new URL('../../', import.meta.url));
async function linkedWorkspace(t, cleanup = true) {
  const root = await mkdtemp(join(tmpdir(), 'shiguang-symlink-test-'));
  const current = join(root, 'current');
  await symlink(workspace, current, process.platform === 'win32' ? 'junction' : 'dir');
  if (cleanup) t.after(async () => { await rm(root, { recursive: true, force: true }); });
  return { root, current };
}
async function unusedPort() {
  const server = createServer(); await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  const port = server.address().port; await new Promise(resolveClose => server.close(resolveClose)); return port;
}

test('CLI entry identity resolves release symlinks while imported modules remain inert', async t => {
  const { current } = await linkedWorkspace(t);
  const original = pathToFileURL(resolve(workspace, 'backend/server.mjs')).href;
  assert.equal(isCliEntry(original, join(current, 'backend/server.mjs')), true);
  assert.equal(isCliEntry(original, join(current, 'backend/backup.mjs')), false);
  assert.equal(isCliEntry(original, join(current, 'missing.mjs')), false);
});

test('server starts through a deployment symlink and serves a symlink FRONTEND_DIR', { timeout: 15000 }, async t => {
  const { root, current } = await linkedWorkspace(t, false); const port = await unusedPort();
  const child = spawn(process.execPath, [join(current, 'backend/server.mjs')], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), DATA_DIR: join(root, 'data'), FRONTEND_DIR: join(current, 'frontend'), SECURE_COOKIE: 'false', PUBLIC_ORIGIN: '', SETUP_TOKEN_FILE: '', SETUP_TOKEN: 'test-setup-token' } });
  let output = ''; let errors = '';
  const finished = once(child, 'exit');
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill(); await finished; await rm(root, { recursive: true, force: true }); });
  child.stderr.on('data', chunk => { errors += chunk; });
  await new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server did not become ready: ${errors}`)), 8000);
    child.stdout.on('data', chunk => { output += chunk; if (output.includes(`listening on 127.0.0.1:${port}`)) { clearTimeout(timer); resolveReady(); } });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited before readiness (${code}): ${errors}`)); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
  });
  const origin = `http://127.0.0.1:${port}`;
  const health = await fetch(origin + '/api/health'); assert.equal(health.status, 200); assert.equal((await health.json()).mode, 'cloud');
  const index = await fetch(origin + '/'); assert.equal(index.status, 200); assert.match(await index.text(), /宇宙/);
  const asset = await fetch(origin + '/src/app.js'); assert.equal(asset.status, 200); assert.match(asset.headers.get('content-type'), /javascript/);
  assert.equal((await fetch(origin + '/backend/server.mjs')).status, 404);
});

test('backup CLI executes through the same deployment symlink', { timeout: 15000 }, async t => {
  const { root, current } = await linkedWorkspace(t); const dataDir = join(root, 'data');
  const store = createStore(dataDir); store.close();
  const child = spawn(process.execPath, [join(current, 'backend/backup.mjs'), '--data-dir', dataDir, '--output-dir', join(root, 'backups')], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; let errors = '';
  child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { errors += chunk; });
  const [code] = await once(child, 'exit'); assert.equal(code, 0, errors);
  const result = JSON.parse(output.trim()); assert.equal(result.ok, true); assert.equal(result.revision, 0);
  const manifest = JSON.parse(await readFile(join(result.path, 'backup-manifest.json'), 'utf8')); assert.equal(manifest.format, 'shiguang-server-backup');
});
