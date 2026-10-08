import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/g2806/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const base = process.env.WORKBENCH_TEST_URL || 'http://127.0.0.1:4173';
const storageKey = 'lumi-workspace-v1-personal';
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const contexts = [];
const log = message => console.log(`PASS ${message}`);

async function createContext() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', acceptDownloads: true });
  await context.addInitScript(() => localStorage.setItem('lumi-mode', 'personal'));
  contexts.push(context);
  return context;
}

async function addTask(page, title) {
  await page.locator('[data-action="add-task"]').first().click();
  await page.locator('#modal [name="title"]').fill(title);
  await page.locator('#modal button[type="submit"]').click();
}

async function readState(page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
}

try {
  const shared = await createContext();
  const pageA = await shared.newPage(), pageB = await shared.newPage();
  await pageA.goto(`${base}/#/tasks`);
  // App startup now checks the server mode before mounting the local workspace.
  await pageA.locator('[data-action="add-task"]').first().waitFor();
  await pageB.goto(`${base}/#/tasks`);
  await pageA.locator('[data-action="add-task"]').first().waitFor();
  await pageB.locator('[data-action="add-task"]').first().waitFor();
  await addTask(pageA, '窗口 A：必须保留的记录');
  await pageA.locator('#modal').waitFor({ state: 'hidden' });
  assert.equal((await readState(pageA)).tasks.length, 1);
  await addTask(pageB, '窗口 B：发生冲突的草稿');
  await pageB.locator('#export-conflict').waitFor();
  assert.equal(await pageB.locator('#modal-title').innerText(), '另一个窗口有更新');
  const primary = await readState(pageA);
  assert.equal(primary.tasks.length, 1);
  assert.equal(primary.tasks[0].title, '窗口 A：必须保留的记录');
  const recoveries = await pageB.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('lumi-recovery-personal-')).map(k => ({ key: k, state: JSON.parse(localStorage.getItem(k)) })));
  assert.equal(recoveries.length, 1);
  assert.ok(recoveries[0].state.tasks.some(t => t.title === '窗口 B：发生冲突的草稿'));
  log('stale tab cannot overwrite A; B changes preserved in a recovery copy');

  const recoveryDownload = pageB.waitForEvent('download');
  await pageB.locator('#export-conflict').click();
  const download = await recoveryDownload;
  const backupBytes = await readFile(await download.path());
  const recoveryBackup = JSON.parse(backupBytes.toString('utf8'));
  assert.equal(recoveryBackup.format, 'lumi-backup');
  assert.ok(recoveryBackup.state.tasks.some(t => t.title === '窗口 B：发生冲突的草稿'));
  await pageB.locator('#modal [data-action="reload-latest"]').click();
  await pageB.locator('#modal').waitFor({ state: 'hidden' });
  assert.ok((await pageB.locator('#main').innerText()).includes('窗口 A：必须保留的记录'));
  assert.ok(!(await pageB.locator('#main').innerText()).includes('窗口 B：发生冲突的草稿'));
  log('conflict changes exported; latest shared state reloads successfully');

  await pageB.goto(`${base}/#/settings`);
  await pageB.locator('[data-action="import"]').click();
  await pageB.locator('#modal input[type="file"]').setInputFiles({ name: 'window-b-recovery.json', mimeType: 'application/json', buffer: backupBytes });
  await pageB.locator('#modal button[type="submit"]').click();
  await pageB.locator('#modal').waitFor({ state: 'hidden' });
  const merged = await readState(pageB);
  assert.equal(merged.tasks.length, 2);
  assert.deepEqual(merged.tasks.map(t => t.title).sort(), ['窗口 A：必须保留的记录', '窗口 B：发生冲突的草稿'].sort());
  log('reimport of recovery backup merges A and B without losing either');

  await pageB.getByRole('button', { name: /查看窗口冲突恢复副本/ }).click();
  await pageB.locator('#recovery-list button').first().waitFor();
  assert.equal(await pageB.locator('#recovery-list button').count(), 1);
  const fromSettings = pageB.waitForEvent('download');
  await pageB.locator('#recovery-list button').first().click();
  const fromSettingsBackup = JSON.parse(await readFile(await (await fromSettings).path(), 'utf8'));
  assert.ok(fromSettingsBackup.state.tasks.some(t => t.title === '窗口 B：发生冲突的草稿'));
  log('settings exposes and exports retained recovery copies');

  const isolated = await createContext();
  const page = await isolated.newPage();
  await page.goto(`${base}/#/english/listening`);
  await page.locator('[data-en-file="audio"]').waitFor();
  const audio = Buffer.alloc(44 + 16000);
  audio.write('RIFF', 0); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVE', 8); audio.write('fmt ', 12); audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22); audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(16000, 28); audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(16000, 40);
  await page.locator('[data-en-file="audio"]').setInputFiles({ name: 'attachment-to-remove.wav', mimeType: 'audio/wav', buffer: audio });
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('lumi-workspace-v1-personal') || 'null')?.english?.audio?.persistent);
  const audioId = (await readState(page)).english.audio.blobId;
  assert.ok(audioId);
  await page.evaluate(async id => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('lumi-files', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    await new Promise((resolve, reject) => { const tx = db.transaction('files', 'readwrite'); tx.objectStore('files').delete(id); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    db.close();
  }, audioId);
  await page.goto(`${base}/#/settings`);
  const unexpectedDownload = page.waitForEvent('download', { timeout: 1800 }).catch(() => null);
  await page.locator('[data-action="export"]').click();
  await page.waitForFunction(() => document.querySelector('#toasts')?.textContent.includes('导出失败：有附件在本机存储中缺失'));
  assert.equal(await unexpectedDownload, null);
  assert.equal((await readState(page)).english.audio.blobId, audioId);
  log('missing IndexedDB attachment rejects full backup with explicit error and no download');
  console.log('ALL STORAGE REGRESSIONS PASSED');
} finally {
  await Promise.all(contexts.map(context => context.close()));
  await browser.close();
}
