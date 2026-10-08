import { DatabaseSync, backup } from 'node:sqlite';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, chmod, lstat, readdir, open, rename, rm, writeFile } from 'node:fs/promises';
import { resolve, join, dirname, sep } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { FILE_ID } from './store.mjs';
import { isCliEntry } from './is-cli.mjs';
import { assertRuntimePath, assertOrdinaryTree, RUNTIME_ROOT, assertOrdinaryPath } from '../runtime.mjs';

async function privateDirectory(path) { await mkdir(path, { recursive: true, mode: 0o700 }); if (process.platform !== 'win32') await chmod(path, 0o700); }
async function privateFile(path) { if (process.platform !== 'win32') await chmod(path, 0o600); }
async function hashFile(path) { const hash = createHash('sha256'); let size = 0; for await (const chunk of createReadStream(path)) { hash.update(chunk); size += chunk.length; } return { sha256: hash.digest('hex'), size }; }
async function copyPrivate(source, target) {
  await privateDirectory(dirname(target));
  const sourceStat = await lstat(source);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) throw new Error('Backup source must be an ordinary file');
  let size = 0; const hash = createHash('sha256');
  const meter = new Transform({ transform(chunk, encoding, callback) { size += chunk.length; hash.update(chunk); callback(null, chunk); } });
  await pipeline(createReadStream(source), meter, createWriteStream(target, { flags: 'wx', mode: 0o600 }));
  await privateFile(target);
  return { sha256: hash.digest('hex'), size };
}
async function sqliteSnapshot(source, target) {
  await privateDirectory(dirname(target));
  const existing = await lstat(target).catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (existing) throw new Error('Backup target already exists');
  const db = new DatabaseSync(source, { readOnly: true });
  try { await backup(db, target); } finally { db.close(); }
  await privateFile(target);
  const snapshot = new DatabaseSync(target, { readOnly: true });
  try { if (snapshot.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw new Error('SQLite backup integrity check failed'); } finally { snapshot.close(); }
  return hashFile(target);
}
async function isSqlite(path) {
  const handle = await open(path, 'r');
  try { const head = Buffer.alloc(16); await handle.read(head, 0, 16, 0); return head.toString('binary') === 'SQLite format 3\0'; } finally { await handle.close(); }
}

/** Online database snapshot plus immutable originals. Output is always a new private directory. */
export async function backupWorkbench({ dataDir, outputDir, now = new Date() }) {
  if (!dataDir || !outputDir) throw new Error('dataDir and outputDir are required');
  const sourceRoot = assertRuntimePath(dataDir); const destinationRoot = assertRuntimePath(outputDir);
  assertOrdinaryTree(sourceRoot, RUNTIME_ROOT); assertOrdinaryTree(destinationRoot, RUNTIME_ROOT);
  if (destinationRoot === sourceRoot || destinationRoot.startsWith(sourceRoot + sep)) throw new Error('Backup directory must be outside DATA_DIR');
  const sourceStat = await lstat(sourceRoot);
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) throw new Error('DATA_DIR must be an ordinary directory');
  await privateDirectory(destinationRoot);
  const name = `yuzhou-${now.toISOString().replace(/[:.]/g, '-')}-${randomBytes(4).toString('hex')}`;
  const staging = join(destinationRoot, `${name}.partial`); const completed = join(destinationRoot, name);
  await mkdir(staging, { mode: 0o700 });
  const entries = [];
  const manifest = { format: 'shiguang-server-backup', version: 1, createdAt: now.toISOString(), databaseRevision: null, entries, sensitive: true, note: 'Private backup includes account/session data and any configured model credentials. Protect this directory.' };
  async function copyTree(source, relative) {
    const info = await lstat(source);
    if (info.isSymbolicLink()) throw new Error('Symbolic links are not allowed in backup sources');
    const target = join(staging, relative);
    if (info.isDirectory()) {
      await privateDirectory(target);
      for (const entry of await readdir(source)) {
        // Atomic-write leftovers and WAL sidecars are unnecessary: SQLite itself supplies a consistent copy.
        if (/\.(?:tmp|part)$/.test(entry) || /-(?:wal|shm|journal)$/.test(entry)) continue;
        await copyTree(join(source, entry), join(relative, entry));
      }
    } else if (info.isFile()) {
      const result = await isSqlite(source) ? await sqliteSnapshot(source, target) : await copyPrivate(source, target);
      entries.push({ path: relative.split(sep).join('/'), ...result });
    } else throw new Error('Unsupported file type in backup source');
  }
  try {
    // Capture independently atomic AI records first; any referenced original already exists in SQLite.
    const aiRoot = join(sourceRoot, 'ai');
    const aiStat = await lstat(aiRoot).catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (aiStat) await copyTree(aiRoot, 'ai');
    const databaseTarget = join(staging, 'workbench.sqlite');
    entries.push({ path: 'workbench.sqlite', ...await sqliteSnapshot(join(sourceRoot, 'workbench.sqlite'), databaseTarget) });
    const snapshot = new DatabaseSync(databaseTarget, { readOnly: true });
    let files;
    try { manifest.databaseRevision = snapshot.prepare('SELECT revision FROM workspace WHERE id=1').get().revision; files = snapshot.prepare('SELECT id,size,sha256 FROM files ORDER BY id').all(); } finally { snapshot.close(); }
    await privateDirectory(join(staging, 'files'));
    for (const file of files) {
      if (!FILE_ID.test(file.id)) throw new Error('Invalid file ID in database');
      const result = await copyPrivate(join(sourceRoot, 'files', file.id), join(staging, 'files', file.id));
      if (result.size !== file.size || result.sha256 !== file.sha256) throw new Error('Original file integrity check failed');
      entries.push({ path: `files/${file.id}`, ...result });
    }
    await writeFile(join(staging, 'backup-manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
    await rename(staging, completed);
    return { path: completed, revision: manifest.databaseRevision, files: entries.length, bytes: entries.reduce((sum, item) => sum + item.size, 0) };
  } catch (error) {
    // This is only the unique directory created by this invocation; existing backups are never touched.
    const checked = resolve(staging);
    if (checked.startsWith(destinationRoot + sep) && dirname(checked) === destinationRoot && checked.endsWith('.partial')) await rm(checked, { recursive: true, force: true });
    throw error;
  }
}

if (isCliEntry(import.meta.url)) {
  assertOrdinaryPath(process.argv[1]);
  const args = process.argv.slice(2); const options = {};
  for (let index = 0; index < args.length; index += 2) {
    if (!['--data-dir', '--output-dir'].includes(args[index]) || !args[index + 1]) throw new Error('Usage: node backup.mjs --data-dir PRIVATE_DATA_DIR --output-dir BACKUP_DIR');
    options[args[index] === '--data-dir' ? 'dataDir' : 'outputDir'] = args[index + 1];
  }
  try {
    const result = await backupWorkbench({ dataDir: process.env.DATA_DIR, outputDir: process.env.BACKUP_DIR, ...options });
    console.log(JSON.stringify({ ok: true, ...result }));
  } catch {
    // A path or lower-level error may contain sensitive deployment details; do not print its payload.
    console.error(JSON.stringify({ ok: false, error: 'backup_failed' })); process.exitCode = 1;
  }
}
