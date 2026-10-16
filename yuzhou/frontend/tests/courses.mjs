import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/g2806/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const baseURL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4397';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const check = async (condition, message) => assert(await condition, message);

try {
  await page.goto(`${baseURL}/#/courses`, { waitUntil: 'networkidle' });
  await check(page.getByRole('button', { name: '数据结构', exact: true }).isVisible(), 'Three-course example library should render');
  assert.equal(await page.locator('.course-library-card').count(), 3);
  await page.getByRole('button', { name: '数据结构', exact: true }).click();
  await page.getByRole('button', { name: '线性表：顺序存储与链式存储', exact: true }).click();
  await page.locator('.course-source-callout').waitFor();
  await check(page.locator('.course-source-callout').isVisible(), 'Source note should be visible');
  assert.match(await page.locator('.course-source-callout').innerText(), /内置示例.*未引用你的课件/);
  assert.equal(await page.locator('.course-note-overline .badge').innerText(), '参考笔记');

  for (const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const layout = await page.evaluate(() => {
      const workspace = document.querySelector('.course-workspace');
      const reader = document.querySelector('.course-reading-panel');
      const readerCard = document.querySelector('.course-reader-card');
      return { scroll: document.documentElement.scrollWidth, viewport: innerWidth, display: getComputedStyle(workspace).display, readerWidth: reader.getBoundingClientRect().width, readerBorder: getComputedStyle(readerCard).borderTopWidth };
    });
    assert(layout.scroll <= width + 1, `Course detail overflow at ${width}px: ${JSON.stringify(layout)}`);
    if (width <= 900) {
      assert.equal(layout.display, 'block');
      assert.equal(layout.readerBorder, '2px');
      assert(layout.readerWidth >= Math.min(width - 65, 300), `Course reader too narrow at ${width}px`);
    }
    console.log(`PASS layout ${width}px`, JSON.stringify(layout));
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  // The new hover sidebar may open under the previous mobile pointer position.
  await page.mouse.move(1400, 90);
  await page.waitForFunction(() => document.querySelector('.sidebar').getBoundingClientRect().width < 100);
  await page.getByRole('button', { name: '全部课程', exact: true }).click();
  await page.getByRole('button', { name: '新建课程', exact: true }).click();
  await page.getByRole('textbox', { name: '课程名称', exact: true }).fill('浏览器验证课程');
  await page.getByRole('textbox', { name: '一句话描述', exact: true }).fill('独立浏览器上下文中的可丢弃测试');
  await page.getByRole('button', { name: '创建课程', exact: true }).click();
  await page.getByRole('heading', { name: '浏览器验证课程', exact: true }).waitFor();
  await check(page.getByRole('heading', { name: '浏览器验证课程', exact: true }).isVisible(), 'Created course should open');

  await page.getByRole('button', { name: '写第一篇笔记', exact: true }).click();
  await page.getByRole('textbox', { name: '笔记标题', exact: true }).fill('二分查找的边界');
  await page.getByRole('textbox', { name: '所属章节', exact: true }).fill('查找');
  await page.getByRole('textbox', { name: '笔记正文', exact: true }).fill('# 初稿\n检查左右边界。\n<script>window.__injected = true</script>');
  await page.getByRole('textbox', { name: '来源说明', exact: true }).fill('手动编写的测试内容，无真实课件页码。');
  await page.getByRole('button', { name: '保存笔记', exact: true }).click();
  await page.getByRole('heading', { name: '二分查找的边界', exact: true }).waitFor();
  await check(page.getByRole('heading', { name: '二分查找的边界', exact: true }).isVisible(), 'New note should render');
  assert.equal(await page.evaluate(() => window.__injected), undefined);
  assert.match(await page.locator('.course-note-body').innerText(), /<script>/);

  await page.getByRole('button', { name: '编辑笔记', exact: true }).click();
  await page.getByRole('textbox', { name: '笔记正文', exact: true }).fill('# 修订\n补充空数组与重复元素的情况。');
  await page.getByRole('button', { name: '保存修订', exact: true }).click();
  await check(page.locator('.course-note-body').getByText('补充空数组与重复元素的情况。', { exact: true }).isVisible(), 'Edited note should render');
  await page.getByRole('button', { name: '查看笔记修订记录', exact: true }).click();
  await page.locator('#modal summary').click();
  assert.match(await page.locator('#modal .course-revision-body').innerText(), /检查左右边界/);
  await page.locator('#modal').getByRole('button', { name: '关闭', exact: true }).click();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出', exact: true }).click();
  const exported = await downloadPromise;
  assert.equal(exported.suggestedFilename(), '二分查找的边界.md');

  await page.locator('[data-course-files]').setInputFiles({ name: '课堂记录-测试.txt', mimeType: 'text/plain', buffer: Buffer.from('课堂记录：网络分层\n原始文字需要保留。\n<script>window.__fileInjected = true</script>', 'utf8') });
  await page.getByRole('button', { name: '课堂记录-测试.txt', exact: true }).click();
  await page.waitForSelector('.course-text-preview');
  assert.match(await page.locator('.course-text-preview').innerText(), /原始文字需要保留/);
  assert.equal(await page.evaluate(() => window.__fileInjected), undefined);
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /^课程资料/ }).click();
  await page.getByRole('button', { name: '课堂记录-测试.txt', exact: true }).click();
  await page.waitForSelector('.course-text-preview');
  assert.match(await page.locator('.course-text-preview').innerText(), /课堂记录：网络分层/);

  await page.getByRole('button', { name: '助教偏好', exact: true }).click();
  await page.getByRole('textbox', { name: '你希望助教怎样整理', exact: true }).fill('重视算法边界，保留真实来源。');
  await page.getByRole('button', { name: '保存偏好', exact: true }).click();
  await page.getByRole('button', { name: /整理课程资料/ }).click();
  assert.match(await page.locator('#modal').innerText(), /还没有接入模型/);
  assert.match(await page.locator('#modal').innerText(), /当前没有发起 AI 请求/);
  await page.locator('#modal').getByRole('button', { name: '关闭', exact: true }).click();

  await page.getByRole('button', { name: '全部课程', exact: true }).click();
  await page.getByRole('searchbox', { name: '搜索课程', exact: true }).fill('浏览器验证');
  assert.equal(await page.locator('.course-library-card').count(), 1);
  await page.getByRole('button', { name: '我创建的', exact: true }).click();
  assert.equal(await page.locator('.course-library-card').count(), 1);
  await page.getByRole('button', { name: '参考课程', exact: true }).click();
  assert.equal(await page.locator('.course-library-card').count(), 0);
  assert.deepEqual(errors, [], 'No uncaught browser errors');
  console.log('PASS: example provenance, responsive reading layout, new course, new note, HTML escaping, note revision, Markdown export, TXT IndexedDB persistence, assistant preferences, unavailable-AI truthfulness, search and filters.');
} finally {
  await context.close();
  await browser.close();
}
