// Historical browser script: review only; use documented isolated tests.
throw new Error('SUBMISSION_LEGACY_BROWSER_DISABLED: configure an isolated browser test explicitly before reuse.');
// Exercise bookkeeping through its UI against an isolated real SQLite server.
// Never reads production credentials, cookies, data, or any bank/payment API.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp, mkdir, rm} from 'node:fs/promises';
import {resolve, sep} from 'node:path';
import {createWorkbenchServer} from '../../backend/server.mjs';
import {validateBackup, mergeBackup} from '../src/backup.js';

const require = createRequire(import.meta.url);
const {chromium} = require('playwright');
const runtime = resolve('frontend/.runtime');
const visuals = resolve('.workbench/visual-qa');
await Promise.all([mkdir(runtime, {recursive: true}), mkdir(visuals, {recursive: true})]);
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const dataDir = await mkdtemp(resolve(runtime, 'ledger-cloud-'));
const app = await createWorkbenchServer({dataDir, secureCookie: false, setupToken: 'test-only-ledger-initial-token'});
await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${app.server.address().port}`;
const browser = await chromium.launch({headless: true, channel: 'msedge'});
const errors = [];
const state = () => app.store.getWorkspace().state;
const ledger = () => state()?.ledger;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const pass = message => console.log(`PASS ${message}`);
const clock = new Date();
const month = `${clock.getFullYear()}-${String(clock.getMonth() + 1).padStart(2, '0')}`;
const previousClock = new Date(clock.getFullYear(), clock.getMonth() - 1, 1, 12);
const previousMonth = `${previousClock.getFullYear()}-${String(previousClock.getMonth() + 1).padStart(2, '0')}`;
const day = suffix => `${month}-${suffix}`;
async function until(predicate, message, timeout = 25000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result) return result;
    await sleep(60);
  }
  throw new Error(`Timed out: ${message}`);
}
function observe(page) {
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(error.message));
}
async function login(page, setup = false) {
  await page.goto(`${base}/#/ledger`);
  await page.locator('[name=username]').fill('ledger-test');
  await page.locator('[name=password]').fill('test-only-ledger-private-password');
  if (setup) await page.locator('[name=setupToken]').fill('test-only-ledger-initial-token');
  await page.locator('#cloud-auth-form button').click();
  await page.locator('.ledger-page').waitFor();
}
async function route(page, destination) {
  await page.evaluate(value => { location.hash = `#/${value}`; }, destination);
  await page.locator(destination === 'ledger' ? '.ledger-page' : '.settings-layout').waitFor();
}
async function submit(page) {
  await page.locator('#modal button[type=submit]').click();
  await page.locator('#modal').waitFor({state: 'hidden'});
  await page.locator('.sync-indicator[data-status=saved]').waitFor({state: 'attached'});
}
async function setType(page, value) {
  const select = page.locator('#modal select[name=type]');
  if (await select.count()) await select.selectOption(value);
  else await page.locator(`#modal [name=type][value="${value}"]`).check();
}
async function createProject(page, title, color) {
  await page.locator('[data-ledger-action=add-project]').first().click();
  await page.locator('#modal [name=title]').fill(title);
  const colorField = page.locator('#modal [name=color]');
  if (await colorField.count()) await colorField.fill(color);
  await submit(page);
  return until(() => ledger().projects.find(project => project.title === title), 'project reached cloud');
}
async function createEntry(page, values) {
  await page.locator('[data-ledger-action=add-entry]').first().click();
  await setType(page, values.type);
  await page.locator('#modal [name=amount]').fill(values.amount);
  await page.locator('#modal [name=date]').fill(values.date);
  await page.locator('#modal [name=category]').fill(values.category);
  await page.locator('#modal [name=projectId]').selectOption(values.projectId || '');
  await page.locator('#modal [name=note]').fill(values.note);
  await submit(page);
  return until(() => ledger().entries.find(entry => entry.note === values.note), 'entry reached cloud');
}
async function total(page, type, expected) {
  const actual = (await page.locator(`[data-ledger-total="${type}"]`).innerText()).replaceAll(',', '');
  const values = actual.match(/[+-]?\d+\.\d{2}/g) || [];
  assert.deepEqual(values.map(value => value.replace(/^\+/, '')), [expected], `${type}: expected ${expected}, got ${actual}`);
}
async function noOverflow(page, label) {
  const bounds = await page.evaluate(() => ({width: innerWidth, scroll: document.documentElement.scrollWidth}));
  assert.ok(bounds.scroll <= bounds.width + 1, `${label} horizontal overflow: ${JSON.stringify(bounds)}`);
}
async function downloadBytes(download) {
  const parts = [], stream = await download.createReadStream();
  for await (const chunk of stream) parts.push(chunk);
  return Buffer.concat(parts);
}
async function showAll(page) {
  await page.locator('[data-ledger-period=all]').click();
  await page.locator('[data-ledger-filter=projectId]').selectOption('all');
}
async function prepareScreenshot(page, width) {
  await page.keyboard.press('Escape');
  await page.mouse.move(width - 12, 110);
  await page.evaluate(() => { document.activeElement?.blur(); scrollTo({top: 0, behavior: 'instant'}); });
  await page.locator('#toasts .toast').last().waitFor({state: 'hidden'});
}

try {
  const first = await browser.newContext({acceptDownloads: true, viewport: {width: 1440, height: 1050}});
  const second = await browser.newContext({acceptDownloads: true, viewport: {width: 390, height: 844}});
  const a = await first.newPage(), b = await second.newPage();
  observe(a); observe(b);
  await login(a, true);
  assert.equal(await a.locator('.ledger-entry').count(), 0, 'personal ledger must start empty');
  assert.equal(ledger()?.entries.length || 0, 0, 'no example money in personal cloud data');
  await total(a, 'income', '0.00'); await total(a, 'expense', '0.00');
  pass('private account setup and empty personal ledger');

  const activity = await createProject(a, '学生会 · 秋季活动', '#FFBD82');
  const software = await createProject(a, '软件项目 · 原型', '#75DCCB');
  await a.locator('[data-ledger-filter=start]').fill(day('20'));
  await a.locator('[data-ledger-filter=end]').fill(day('01'));
  await createEntry(a, {type: 'income', amount: '1000.99', date: day('05'), category: '活动经费', projectId: activity.id, note: '活动经费到账'});
  assert.equal(ledger().entries.length, 1, 'saving with an invalid presentation range must persist exactly once');
  assert.equal(await a.locator('#modal').isVisible(), false);
  await a.locator('[data-ledger-period=month]').click();
  pass('invalid date filter cannot turn a successful entry save into an error or duplicate');
  await createEntry(a, {type: 'expense', amount: '0.10', date: day('06'), category: '活动物料', projectId: activity.id, note: '第一笔精确小额支出'});
  const smallExpense = await createEntry(a, {type: 'expense', amount: '0.20', date: day('06'), category: '活动物料', projectId: activity.id, note: '第二笔精确小额支出'});
  await createEntry(a, {type: 'expense', amount: '12.34', date: `${previousMonth}-17`, category: '学习', projectId: software.id, note: '上月原型参考资料'});
  await createEntry(a, {type: 'expense', amount: '9.99', date: day('07'), category: '餐饮', note: '未归属项目的午餐'});
  assert.equal(ledger().entries.length, 5);
  assert.ok(ledger().entries.every(entry => Number.isSafeInteger(entry.amountCents)));
  assert.equal(ledger().entries.find(entry => entry.note === '第一笔精确小额支出').amountCents, 10);
  assert.equal(ledger().entries.find(entry => entry.note === '第二笔精确小额支出').amountCents, 20);
  assert.equal(await a.locator('.ledger-entry').count(), 4, 'default current-month view excludes prior month');
  await total(a, 'income', '1000.99'); await total(a, 'expense', '10.29'); await total(a, 'net', '990.70');
  pass('custom projects, income/expense, unassigned entry, integer cents and current-month totals');

  await a.locator('[data-ledger-filter=start]').fill(day('06'));
  await a.locator('[data-ledger-filter=end]').fill(day('06'));
  await a.locator('[data-ledger-group=date]').click();
  assert.equal(await a.locator('.ledger-entry').count(), 2);
  await total(a, 'expense', '0.30'); await total(a, 'income', '0.00');
  await a.locator('[data-ledger-period=all]').click();
  assert.equal(await a.locator('.ledger-entry').count(), 5);
  await a.locator('[data-ledger-group=project]').click();
  assert.equal(await a.locator('.ledger-group').count(), 3, 'both projects and unassigned grouping');
  await a.locator('[data-ledger-filter=projectId]').selectOption(activity.id);
  assert.equal(await a.locator('.ledger-entry').count(), 3);
  await total(a, 'expense', '0.30');
  pass('inclusive date filtering, all-date view, project grouping and project filtering');

  await a.locator(`[data-ledger-action=edit-entry][data-id="${smallExpense.id}"]`).click();
  await a.locator('#modal [name=amount]').fill('0.25');
  await a.locator('#modal [name=note]').fill('已核对的小额支出');
  await submit(a);
  await until(() => ledger().entries.find(entry => entry.id === smallExpense.id).amountCents === 25, 'edited amount reached cloud');
  await showAll(a);
  await a.locator(`[data-ledger-action=archive-entry][data-id="${smallExpense.id}"]`).click();
  await until(() => ledger().entries.find(entry => entry.id === smallExpense.id).archived === true, 'archive reached cloud');
  assert.equal(await a.locator(`.ledger-entry[data-entry-id="${smallExpense.id}"]`).count(), 0);
  await a.locator('[data-ledger-filter=archived]').check();
  await a.locator(`[data-ledger-action=restore-entry][data-id="${smallExpense.id}"]`).click();
  await until(() => ledger().entries.find(entry => entry.id === smallExpense.id).archived === false, 'restore reached cloud');
  if (await a.locator('[data-ledger-filter=archived]').isChecked()) await a.locator('[data-ledger-filter=archived]').uncheck();
  await showAll(a);
  assert.equal(await a.locator('.ledger-entry').count(), 5);
  await a.reload(); await a.locator('.ledger-page').waitFor();
  await total(a, 'expense', '10.34');
  pass('edit, reversible archive/restore and reload persistence without losing prior-month records');

  await login(b);
  await total(b, 'expense', '10.34');
  // Filtering is presentation state and must not block later cloud refresh.
  await b.locator('[data-ledger-filter=projectId]').selectOption(activity.id);
  await b.locator('[data-ledger-group=project]').click();
  const added = await createEntry(a, {type: 'income', amount: '5.01', date: day('08'), category: '报销', projectId: activity.id, note: '桌面录入后手机自动收到'});
  await b.locator(`.ledger-entry[data-entry-id="${added.id}"]`).waitFor();
  const mobileAdded = await createEntry(b, {type: 'expense', amount: '1.02', date: day('09'), category: '交通', projectId: activity.id, note: '手机录入后电脑自动收到'});
  await a.locator(`.ledger-entry[data-entry-id="${mobileAdded.id}"]`).waitFor();
  await total(a, 'income', '1006.00'); await total(a, 'expense', '11.36'); await total(a, 'net', '994.64');
  pass('desktop ↔ mobile bidirectional automatic cloud sync, including after filtering');

  const beforeProjectArchive = structuredClone(ledger().entries);
  await a.locator('[data-ledger-action=manage-projects]').click();
  await a.locator(`#modal [data-ledger-action=archive-project][data-id="${software.id}"]`).click();
  await until(() => ledger().projects.find(project => project.id === software.id).archived, 'project archive reached cloud');
  assert.deepEqual(ledger().entries, beforeProjectArchive, 'project archive must retain historical entries');
  await showAll(a); await total(a, 'expense', '23.70');
  await a.locator('[data-ledger-action=manage-projects]').click();
  await a.locator(`#modal [data-ledger-action=restore-project][data-id="${software.id}"]`).click();
  await until(() => !ledger().projects.find(project => project.id === software.id).archived, 'project restore reached cloud');
  await a.locator('[data-ledger-action=manage-projects]').click();
  await a.locator(`#modal [data-ledger-action=edit-project][data-id="${software.id}"]`).click();
  await a.locator('#modal [name=title]').fill('软件项目 · 交互原型');
  await submit(a);
  assert.equal(ledger().projects.find(project => project.id === software.id).title, '软件项目 · 交互原型');
  assert.deepEqual(ledger().entries, beforeProjectArchive, 'project rename must retain existing references');
  await a.locator('[data-ledger-period=month]').click();
  pass('project archive/restore/rename retain all historical amounts and references');

  // Full-workspace backup must preserve bookkeeping; importing an older backup
  // without a ledger must not remove existing projects, records, or amounts.
  await route(a, 'settings');
  const downloading = a.waitForEvent('download');
  await a.locator('[data-action=export]').click();
  const backup = validateBackup(JSON.parse((await downloadBytes(await downloading)).toString('utf8')));
  assert.deepEqual(backup.state.ledger, ledger());
  const withoutLedger = structuredClone(backup.state); delete withoutLedger.ledger;
  const restored = mergeBackup(withoutLedger, backup).state;
  assert.deepEqual(restored.ledger, ledger());
  assert.deepEqual(mergeBackup(restored, withoutLedger).state.ledger, ledger());
  assert.equal(mergeBackup(restored, backup).count, 0, 'repeated restore does not duplicate ledger records');
  pass('downloaded full backup validates, restores ledger, preserves data on older backup import and stays idempotent');

  await route(a, 'ledger');
  for (const width of [1440, 768, 390, 320]) {
    await a.setViewportSize({width, height: width < 500 ? 900 : 1050});
    await prepareScreenshot(a, width);
    await noOverflow(a, `ledger ${width}px`);
    await a.screenshot({path: resolve(visuals, `ledger-${runId}-${width}.png`), fullPage: true, animations: 'disabled'});
    await a.locator('[data-ledger-group=project]').click();
    await noOverflow(a, `project groups ${width}px`);
    await a.locator('[data-ledger-group=date]').click();
  }
  await a.locator('[data-ledger-action=add-entry]').first().click();
  await noOverflow(a, 'entry dialog 320px');
  await a.screenshot({path: resolve(visuals, `ledger-${runId}-320-entry-dialog.png`), fullPage: true, animations: 'disabled'});
  await a.locator('#modal [data-close]').first().click();
  // Use the already-independent phone context rather than a resized desktop
  // to verify its fixed application bars in a normal phone viewport.
  await b.reload(); await b.locator('.ledger-page').waitFor();
  await prepareScreenshot(b, 390);
  await noOverflow(b, 'independent phone 390px');
  const topbar = await b.locator('.topbar').boundingBox();
  assert.ok(topbar && topbar.y >= -1 && topbar.y <= 1, `phone topbar must sit at viewport top: ${JSON.stringify(topbar)}`);
  await b.screenshot({path: resolve(visuals, `ledger-${runId}-390-phone-viewport.png`), animations: 'disabled'});
  assert.deepEqual(errors, []);
  pass('date and project views at 320/390/768/1440px, 320px entry dialog, screenshots and no browser errors');
  console.log(`PASS all ledger cloud checks; isolated screenshot prefix: ${resolve(visuals, `ledger-${runId}`)}`);
} catch (error) {
  console.error(error);
  let index = 0;
  for (const context of browser.contexts()) for (const page of context.pages()) {
    if (!page.isClosed()) await page.screenshot({path: resolve(visuals, `ledger-${runId}-failure-${index++}.png`), fullPage: true}).catch(() => {});
  }
  process.exitCode = 1;
} finally {
  await browser.close(); await app.close();
  const checkedPath = resolve(dataDir);
  assert.ok(checkedPath.startsWith(runtime + sep), 'cleanup must stay in isolated runtime directory');
  await rm(checkedPath, {recursive: true, force: true});
}
