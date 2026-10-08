import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/g2806/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:4173';
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const readState = () => page.evaluate(() => JSON.parse(localStorage.getItem('lumi-workspace-v1-demo')));
const cardFrom = async id => (await readState()).courseCanvas.cards.find(card => card.id === id);

try {
  await page.goto(`${base}/#/courses`, { waitUntil: 'networkidle' });
  assert.equal(await page.locator('.cv-card-collection').count(), 3);
  assert.equal(await page.locator('[data-card="ai"]').count(), 0);
  const before = await cardFrom('course-data-structures');
  const homeLayout = (await readState()).canvas;
  const title = page.getByRole('button', { name: '数据结构', exact: true });
  const rect = await title.boundingBox();
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.waitForSelector('[data-card="course-data-structures"].is-longpress-lifted');
  await page.mouse.move(rect.x + rect.width / 2 + 96, rect.y + rect.height / 2 + 64, { steps: 8 });
  await page.mouse.up();
  assert.equal(new URL(page.url()).hash, '#/courses', 'Long press on title must not navigate');
  const moved = await cardFrom('course-data-structures');
  assert(moved.x > before.x && moved.y > before.y);
  assert.deepEqual((await readState()).canvas, homeLayout, 'Course layout is independent from home');
  await page.reload({ waitUntil: 'networkidle' });
  assert.deepEqual(await cardFrom('course-data-structures'), moved, 'Course layout survives reload');

  const currentView = (await readState()).courseCanvas.view;
  await page.getByRole('searchbox', { name: '搜索课程', exact: true }).fill('操作');
  assert.equal(await page.locator('.course-library-card').count(), 1);
  assert(await page.getByRole('searchbox', { name: '搜索课程', exact: true }).evaluate(el => el === document.activeElement));
  assert.deepEqual((await readState()).courseCanvas.view, currentView, 'Searching preserves canvas view');
  await page.getByRole('button', { name: '我创建的', exact: true }).click();
  assert.equal(await page.locator('.course-library-card').count(), 0);
  assert(await page.locator('[data-course-empty]').isVisible());
  await page.getByRole('button', { name: /^全部课程/ }).click();
  await page.getByRole('searchbox', { name: '搜索课程', exact: true }).fill('');

  await page.locator('[data-card="course-data-structures"] [data-cv="card-menu"]').click();
  await page.locator('#modal [name="color"]').fill('#63e6dc');
  await page.locator('#modal [name="width"]').fill('370');
  await page.locator('#modal [name="height"]').fill('350');
  await page.locator('#modal button[type="submit"]').click();
  assert.equal((await cardFrom('course-data-structures')).w, 370);
  assert.equal((await cardFrom('course-data-structures')).h, 350);
  assert.equal((await readState()).courses[0].color, '#63e6dc');

  const transfer = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.items.add(new File(['课程画布拖入的原始资料'], '画布-课程资料.txt', { type: 'text/plain' }));
    return data;
  });
  await page.locator('[data-card="course-data-structures"]').dispatchEvent('drop', { dataTransfer: transfer });
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('lumi-workspace-v1-demo')).courses.find(c => c.id === 'course-data-structures').files.length === 1);
  assert.match(await page.locator('[data-card="course-data-structures"] .cv-space-counts').innerText(), /1 份资料/);
  assert.equal((await readState()).courses.find(c => c.id === 'course-operating-systems').files.length, 0);
  await page.getByRole('button', { name: '数据结构', exact: true }).click();
  await page.locator('.course-board-workspace').waitFor();
  await page.getByRole('button', { name: /^课程资料/ }).click();
  await page.getByRole('button', { name: '画布-课程资料.txt', exact: true }).click();
  await page.locator('.course-text-preview').waitFor();
  assert.match(await page.locator('.course-text-preview').innerText(), /课程画布拖入的原始资料/);
  await page.getByRole('button', { name: '全部课程', exact: true }).click();
  await page.locator('.course-canvas-page').waitFor();
  await mkdir(new URL('../.runtime/', import.meta.url), { recursive: true });
  const zoomBottom = await page.locator('.cv-zoom-controls').evaluate(el => el.getBoundingClientRect().bottom);
  assert(zoomBottom <= 1000, 'Desktop zoom controls fit in the initial viewport');
  await page.screenshot({ path: fileURLToPath(new URL('../.runtime/course-canvas-desktop.png', import.meta.url)), fullPage: true, animations: 'disabled' });

  await page.getByRole('button', { name: '卡片列表', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator('.cv-card-collection').count(), 3);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const clipped = await page.evaluate(() => [...document.querySelectorAll('.course-library-card .cv-space-counts')].filter(el => el.getBoundingClientRect().bottom > el.closest('.cv-card-body').getBoundingClientRect().bottom + 1).length);
  assert.equal(clipped, 0, 'Mobile course counts remain inside card');
  await page.screenshot({ path: fileURLToPath(new URL('../.runtime/course-canvas-mobile.png', import.meta.url)), fullPage: true, animations: 'disabled' });
  assert.deepEqual(errors, []);
  console.log('PASS course canvas: title long press, independent persisted layout, search focus and filtering, card appearance, original file drop and preview, short click entry, mobile list.');
} finally {
  await context.close();
  await browser.close();
}
