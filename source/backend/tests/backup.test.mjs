import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { createStore, digest } from '../store.mjs';
import { backupWorkbench } from '../backup.mjs';

const empty = () => ({ schema: 1, mode: 'personal', profile: {}, english: {}, courses: [], tasks: [], captures: [] });
test('online backup keeps live service data, originals and private config intact and never overwrites older backup', async t => {
  const root = await mkdtemp(join(tmpdir(), 'shiguang-backup-test-')); const data = join(root, 'data'); const output = join(root, 'backups');
  const store = createStore(data);
  t.after(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
  const original = Buffer.from('课程原始文件'); const temporary = join(store.tempDir, 'test.part'); await writeFile(temporary, original);
  store.commitFile('test-original', temporary, { name: '课程.txt', type: 'text/plain', size: original.length, sha256: digest(original) });
  const state = empty(); state.captures.push({ id: 'capture', blobId: 'test-original', text: '课程' }); store.saveWorkspace(0, state);
  await mkdir(join(data, 'ai', 'jobs'), { recursive: true });
  await writeFile(join(data, 'ai', 'model-config.json'), JSON.stringify({ apiKey: 'dummy-test-key' }));
  await writeFile(join(data, 'ai', 'jobs', 'test.json'), JSON.stringify({ status: 'succeeded' }));
  const first = await backupWorkbench({ dataDir: data, outputDir: output });
  assert.equal(first.revision, 1); assert.equal(first.files, 4);
  assert.deepEqual(await readFile(join(first.path, 'files', 'test-original')), original);
  assert.equal(JSON.parse(await readFile(join(first.path, 'ai', 'model-config.json'), 'utf8')).apiKey, 'dummy-test-key');
  const inspection = new DatabaseSync(join(first.path, 'workbench.sqlite'), { readOnly: true });
  const restored = inspection.prepare('SELECT revision,state FROM workspace WHERE id=1').get();
  assert.equal(restored.revision, 1); assert.equal(JSON.parse(restored.state).captures[0].blobId, 'test-original'); inspection.close();
  const changed = empty(); changed.tasks.push({ id: 'task', title: '另一个任务' }); store.saveWorkspace(1, changed);
  const second = await backupWorkbench({ dataDir: data, outputDir: output });
  assert.notEqual(first.path, second.path); assert.equal(second.revision, 2);
  assert.equal(JSON.parse(await readFile(join(first.path, 'backup-manifest.json'), 'utf8')).databaseRevision, 1);
  if (process.platform !== 'win32') { assert.equal((await stat(first.path)).mode & 0o777, 0o700); assert.equal((await stat(join(first.path, 'ai', 'model-config.json'))).mode & 0o777, 0o600); }
  assert.equal((await readdir(output)).length, 2);
});

test('corrupt original aborts backup without leaving a completed snapshot; nesting is rejected', async t => {
  const root = await mkdtemp(join(tmpdir(), 'shiguang-backup-test-')); const data = join(root, 'data'); const output = join(root, 'backups');
  const store = createStore(data); t.after(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
  const temporary = join(store.tempDir, 'test.part'); await writeFile(temporary, 'original');
  store.commitFile('file', temporary, { name: 'file', type: 'text/plain', size: 8, sha256: digest('original') });
  await writeFile(store.filePath('file'), 'corrupt');
  await assert.rejects(() => backupWorkbench({ dataDir: data, outputDir: output }), /integrity/);
  assert.deepEqual(await readdir(output), []);
  await assert.rejects(() => backupWorkbench({ dataDir: data, outputDir: join(data, 'nested') }), /outside DATA_DIR/);
});
