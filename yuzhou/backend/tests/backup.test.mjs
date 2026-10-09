import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, stat, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { createStore, digest } from '../store.mjs';
import { backupWorkbench, publishBackupDirectory } from '../backup.mjs';

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

async function publicationFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'czb-backup-publication-'));
  const completed = join(root, 'new-backup'), staging = `${completed}.partial`;
  await mkdir(staging); await writeFile(join(staging, 'synthetic.txt'), 'new snapshot');
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, completed, staging };
}

test('Windows temporary rename denial retries finitely and publishes the intact snapshot', async t => {
  const { completed, staging } = await publicationFixture(t); let attempts = 0; const waits = [];
  await publishBackupDirectory(staging, completed, { platform: 'win32', wait: async ms => { waits.push(ms); }, renameDirectory: async (source, target) => {
    attempts++; if (attempts <= 2) throw Object.assign(new Error('synthetic transient lock'), { code: attempts === 1 ? 'EPERM' : 'EBUSY' });
    await rename(source, target);
  } });
  assert.equal(attempts, 3); assert.deepEqual(waits, [40, 80]);
  assert.equal(await readFile(join(completed, 'synthetic.txt'), 'utf8'), 'new snapshot');
  await assert.rejects(() => stat(staging), { code: 'ENOENT' });
});

test('permanent Windows rename denial stops after the bounded retries and keeps staging unchanged', async t => {
  const { completed, staging } = await publicationFixture(t); let attempts = 0; const waits = [];
  const error = Object.assign(new Error('synthetic persistent lock'), { code: 'EPERM' });
  await assert.rejects(() => publishBackupDirectory(staging, completed, { platform: 'win32', wait: async ms => { waits.push(ms); }, renameDirectory: async () => { attempts++; throw error; } }), caught => caught === error);
  assert.equal(attempts, 6); assert.deepEqual(waits, [40, 80, 160, 320, 640]);
  assert.equal(await readFile(join(staging, 'synthetic.txt'), 'utf8'), 'new snapshot');
  await assert.rejects(() => stat(completed), { code: 'ENOENT' });
});

test('a backup created during a retry is preserved and never replaced', async t => {
  const { completed, staging } = await publicationFixture(t); let attempts = 0;
  await assert.rejects(() => publishBackupDirectory(staging, completed, { platform: 'win32',
    renameDirectory: async () => { attempts++; throw Object.assign(new Error('synthetic lock'), { code: 'EBUSY' }); },
    wait: async () => { await mkdir(completed); await writeFile(join(completed, 'older.txt'), 'existing snapshot'); },
  }), /already exists/);
  assert.equal(attempts, 1); assert.equal(await readFile(join(completed, 'older.txt'), 'utf8'), 'existing snapshot');
  assert.equal(await readFile(join(staging, 'synthetic.txt'), 'utf8'), 'new snapshot');
});

test('non-lock errors and non-Windows errors are not retried', async t => {
  for (const [platform, code] of [['win32', 'EACCES'], ['win32', 'ENOENT'], ['linux', 'EPERM']]) {
    const { completed, staging } = await publicationFixture(t); let attempts = 0, waits = 0;
    const error = Object.assign(new Error('synthetic non-retryable failure'), { code });
    await assert.rejects(() => publishBackupDirectory(staging, completed, { platform, wait: async () => { waits++; }, renameDirectory: async () => { attempts++; throw error; } }), caught => caught === error);
    assert.equal(attempts, 1); assert.equal(waits, 0);
  }
});
