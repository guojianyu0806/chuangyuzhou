import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/g2806/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, hasTouch: true });
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:4397';
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('czb-yuzhou-workspace-v1-demo')));
const board = async type => (await state()).boards[`course:course-data-structures:${type}`];
const holdMove = async (locator, dx, dy) => {
  const rect = await locator.boundingBox();
  const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.waitForSelector('.is-longpress-lifted');
  await page.mouse.move(x + dx, y + dy, { steps: 7 }); await page.mouse.up();
};
const screenshot = async name => {
  await mkdir(new URL('../.runtime/', import.meta.url), { recursive: true });
  await page.screenshot({ path: fileURLToPath(new URL(`../.runtime/${name}.png`, import.meta.url)), fullPage: true, animations: 'disabled' });
};

try {
  await page.goto(`${base}/#/courses/course-data-structures`, { waitUntil: 'networkidle' });
  assert.equal(await page.locator('.course-board-workspace .cv-card').count(), 2);
  assert.equal(await page.locator('.course-outline').count(), 0, 'Old flat outline is replaced by cards');
  const original = (await board('notes')).cards.find(card => card.id === 'note-linear-list');
  await holdMove(page.getByRole('button', { name: '线性表：顺序存储与链式存储', exact: true }), 85, 45);
  const moved = (await board('notes')).cards.find(card => card.id === 'note-linear-list');
  assert(moved.x > original.x && moved.y > original.y);
  assert.equal(await page.locator('.course-reading-panel').count(), 0, 'Dragging does not open reader');
  await page.reload({ waitUntil: 'networkidle' });
  assert.deepEqual((await board('notes')).cards.find(card => card.id === 'note-linear-list'), moved);

  await page.locator('[data-card="note-linear-list"] [data-cv="card-menu"]').click();
  await page.locator('#modal [name="color"]').fill('#63e6dc');
  await page.locator('#modal [name="width"]').fill('380');
  await page.locator('#modal button[type="submit"]').click();
  await page.getByRole('button', { name: '线性表：顺序存储与链式存储', exact: true }).click();
  await page.locator('.course-reader-card').waitFor();
  assert.match(await page.locator('.course-note-body').innerText(), /频繁随机读取/);
  assert.match(await page.locator('.course-source-callout').innerText(), /未引用你的课件/);
  assert.equal(await page.locator('.course-reader-card').evaluate(el => el.style.getPropertyValue('--reader-color')), '#63e6dc');
  await screenshot('course-detail-reader-desktop');
  await page.getByRole('button', { name: '返回笔记卡片', exact: true }).click();
  assert.equal((await board('notes')).cards.find(card => card.id === 'note-linear-list').w, 380);
  await screenshot('course-detail-board-desktop');

  await page.locator('[data-card="note-stack-queue"] [data-cv="card-menu"]').click();
  await page.getByRole('button', { name: '编辑笔记', exact: true }).click();
  await page.getByRole('textbox', { name: '来源说明', exact: true }).fill('补充的课堂记录，仍保留原始修订。');
  await page.getByRole('button', { name: '保存修订', exact: true }).click();
  await page.getByRole('heading', { name: '栈与队列：两种访问秩序', exact: true }).waitFor();
  assert.match(await page.locator('.course-source-callout').innerText(), /补充的课堂记录/);
  await page.getByRole('button', { name: '返回笔记卡片', exact: true }).click();

  const noteLayout = await board('notes');
  const transfer = await page.evaluateHandle(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['课堂重点：原件不能被卡片替代。'], '知识卡片原件.txt', { type: 'text/plain' }));
    return dt;
  });
  await page.locator('[data-card="note-stack-queue"]').dispatchEvent('drop', { dataTransfer: transfer });
  await page.getByRole('button', { name: '知识卡片原件.txt', exact: true }).waitFor();
  assert.deepEqual(await board('notes'), noteLayout, 'Dropping files leaves note layout intact');
  const filesBefore = await board('files');
  await holdMove(page.getByRole('button', { name: '知识卡片原件.txt', exact: true }), 60, 35);
  assert((await board('files')).cards[0].x > filesBefore.cards[0].x);
  await page.waitForTimeout(380);
  await page.getByRole('button', { name: '知识卡片原件.txt', exact: true }).click();
  await page.locator('.course-text-preview').waitFor();
  assert.match(await page.locator('.course-text-preview').innerText(), /原件不能被卡片替代/);
  await page.getByRole('button', { name: '返回资料卡片', exact: true }).click();
  await page.locator('[data-cv="card-menu"]').click();
  assert.equal(await page.locator('#modal [data-manage-space]').count(), 0, 'Files have no ineffective edit action');
  await page.locator('#modal').getByRole('button', { name: '关闭', exact: true }).click();

  await page.getByRole('button', { name: /^学习笔记/ }).click();
  await page.getByRole('button', { name: '卡片列表', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await screenshot('course-detail-board-mobile');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const clipped = await page.evaluate(() => [...document.querySelectorAll('.course-detail-card-meta')].filter(el => el.getBoundingClientRect().bottom > el.closest('.cv-card-body').getBoundingClientRect().bottom + 1).length);
  assert.equal(clipped, 0, 'Mobile card metadata is visible');
  await page.getByRole('button', { name: '线性表：顺序存储与链式存储', exact: true }).click();
  await page.locator('.course-reader-card').waitFor();
  await screenshot('course-detail-reader-mobile');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert(await page.getByRole('button', { name: '返回笔记卡片', exact: true }).isVisible());
  assert.deepEqual(errors, []);
  console.log('PASS course detail canvas: independent note/file layouts, long-press movement, persisted size/color, original file drop and preview, dedicated reader/back navigation, desktop/mobile layout.');
} finally {
  await browser.close();
}
