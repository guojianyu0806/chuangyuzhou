import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/g2806/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const base = process.env.TEST_URL || 'http://127.0.0.1:4173';
let browser;
try { browser = await chromium.launch({ headless: true }); }
catch { browser = await chromium.launch({ headless: true, channel: 'msedge' }); }
const errors = [];
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();
page.setDefaultTimeout(10000);
page.on('pageerror', error => errors.push(error.message));
async function step(name, work) {
  try { await work(); console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.message}`); throw error; }
}
async function route(page, name) {
  await page.evaluate(name => { location.hash = `#/${name}`; }, name);
  await page.waitForFunction(name => document.title.includes({ tasks: '备忘与待办', inbox: '收集箱', settings: '偏好与连接', home: '空间主页' }[name]), name);
}
async function stored(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('lumi-workspace-v1-personal') || 'null'));
}
async function submit(page) {
  await page.locator('#modal button[type=submit]').click();
  await page.locator('#modal').waitFor({ state: 'hidden' });
}
async function downloadBuffer(page, action) {
  const pending = page.waitForEvent('download');
  await action();
  const download = await pending;
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}
let backupBuffer;
try {
  await step('demo opens and personal starts empty', async () => {
    await page.goto(base);
    await page.locator('#main').getByRole('heading', { name: /我的空间/ }).waitFor();
    await page.locator('.mode-banner [data-action="switch-workspace"]').click();
    await route(page, 'tasks');
    assert.equal(await page.locator('.task-row').count(), 0);
  });
  await step('add, edit, complete task and reload', async () => {
    await page.locator('#main [data-action="add-task"]').first().click();
    await page.locator('#modal [name=title]').fill('FLOW independent personal task');
    await submit(page);
    await page.locator('.task-text').filter({ hasText: 'FLOW independent personal task' }).click();
    await page.locator('#modal [name=title]').fill('FLOW edited task');
    await submit(page);
    await page.locator('[data-action="toggle-task"]').click();
    await page.reload();
    await page.locator('.task-row.is-done').waitFor();
    assert.equal((await stored(page)).tasks[0].title, 'FLOW edited task');
    assert.equal((await stored(page)).tasks[0].done, true);
  });
  await step('workspace mode isolation', async () => {
    await page.locator('.mode-banner [data-action="switch-workspace"]').click();
    await route(page, 'tasks');
    assert.equal(await page.getByText('FLOW edited task', { exact: true }).count(), 0);
    assert.ok(await page.locator('.task-row').count() > 0);
    await page.locator('.mode-banner [data-action="switch-workspace"]').click();
    await route(page, 'tasks');
    assert.equal(await page.locator('.task-row').count(), 1);
  });
  await step('capture becomes exactly one task', async () => {
    await route(page, 'inbox');
    await page.locator('#main [data-action="add-capture"]').first().click();
    await page.locator('#modal [name=text]').fill('FLOW capture to task');
    await submit(page);
    await page.locator('[data-action="capture-task"]').click();
    await page.locator('[data-action="capture-task"]').click();
    assert.equal((await stored(page)).tasks.filter(task => task.title === 'FLOW capture to task').length, 1);
  });
  await step('upload text attachment, reload, download preserved bytes', async () => {
    await page.locator('#main [data-action="capture-file"]').click();
    await page.locator('#modal [name=file]').setInputFiles({ name: 'flow-note.txt', mimeType: 'text/plain', buffer: Buffer.from('FLOW attachment 内容 123') });
    await page.locator('#modal [name=text]').fill('FLOW attachment note');
    await submit(page);
    await page.reload();
    await page.locator('[data-action="download-capture"]').waitFor();
    const bytes = await downloadBuffer(page, () => page.locator('[data-action="download-capture"]').click());
    assert.equal(bytes.toString(), 'FLOW attachment 内容 123');
  });
  await step('export includes task, capture and original attachment', async () => {
    await route(page, 'settings');
    backupBuffer = await downloadBuffer(page, () => page.locator('[data-action="export"]').click());
    const backup = JSON.parse(backupBuffer.toString());
    assert.equal(backup.state.tasks.length, 2);
    assert.equal(backup.state.captures.length, 2);
    assert.equal(backup.files.length, 1);
    assert.equal(Buffer.from(backup.files[0].data.split(',')[1], 'base64').toString(), 'FLOW attachment 内容 123');
  });
  await step('import backup into fresh context, repeat import, retrieve attachment', async () => {
    const restoredContext = await browser.newContext({ acceptDownloads: true });
    try {
      const restored = await restoredContext.newPage();
      restored.setDefaultTimeout(10000);
      restored.on('pageerror', error => errors.push(error.message));
      await restored.goto(base);
      await restored.locator('.mode-banner [data-action="switch-workspace"]').click();
      await route(restored, 'settings');
      for (let i = 0; i < 2; i++) {
        await restored.locator('[data-action="import"]').click();
        await restored.locator('#modal [name=file]').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: backupBuffer });
        await submit(restored);
      }
      assert.equal((await stored(restored)).tasks.length, 2);
      assert.equal((await stored(restored)).captures.length, 2);
      await route(restored, 'inbox');
      const bytes = await downloadBuffer(restored, () => restored.locator('[data-action="download-capture"]').click());
      assert.equal(bytes.toString(), 'FLOW attachment 内容 123');
    } finally { await restoredContext.close(); }
  });
  assert.deepEqual(errors, [], `Unhandled browser errors: ${errors.join('; ')}`);
  console.log('PASS all primary flows with isolated browser contexts.');
} finally { await context.close(); await browser.close(); }
