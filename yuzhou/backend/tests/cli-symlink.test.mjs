import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, symlink, rm, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
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

test('CLI entry identity resolves release symlinks while imported modules remain inert', async t => {
  const { current } = await linkedWorkspace(t);
  const original = pathToFileURL(resolve(workspace, 'backend/server.mjs')).href;
  assert.equal(isCliEntry(original, join(current, 'backend/server.mjs')), true);
  assert.equal(isCliEntry(original, join(current, 'backend/backup.mjs')), false);
  assert.equal(isCliEntry(original, join(current, 'missing.mjs')), false);
});

test('competition server refuses deployment symlinks before creating runtime files', { timeout: 15000 }, async t => {
  const { root, current } = await linkedWorkspace(t);
  const child = spawn(process.execPath, [join(current, 'backend/server.mjs')], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, DATA_DIR: join(root, 'data'), PORT: '4397' } });
  let output = ''; child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', () => {});
  const [code] = await once(child, 'exit');
  assert.notEqual(code, 0); assert.doesNotMatch(output, /listening/);
  await assert.rejects(readFile(join(root, 'data', 'workbench.sqlite')), { code: 'ENOENT' });
});

test('competition backup CLI refuses a deployment symlink', { timeout: 15000 }, async t => {
  const { root, current } = await linkedWorkspace(t); const dataDir = join(root, 'data');
  const store = createStore(dataDir); store.close();
  const child = spawn(process.execPath, [join(current, 'backend/backup.mjs'), '--data-dir', dataDir, '--output-dir', join(root, 'backups')], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; let errors = '';
  child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { errors += chunk; });
  const [code] = await once(child, 'exit'); assert.notEqual(code, 0); assert.doesNotMatch(output, /"ok":true/);
});
