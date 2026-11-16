// Historical browser script: review only; use documented isolated tests.
throw new Error('SUBMISSION_LEGACY_BROWSER_DISABLED: configure an isolated browser test explicitly before reuse.');
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const base = process.env.WORKBENCH_TEST_URL || 'http://127.0.0.1:4397';
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', acceptDownloads: true });
await context.addInitScript(() => localStorage.setItem('czb-yuzhou-mode', 'personal'));
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const action = (name) => page.locator(`[data-en="${name}"]`);
const enState = () => page.evaluate(() => JSON.parse(localStorage.getItem('czb-yuzhou-workspace-v1-personal')).english);
const readSection = key => page.locator(`[data-en="section"][data-key="${key}"]`).click();
const exercise = key => page.locator(`[data-en="exercise"][data-key="${key}"]`).click();
const log = name => console.log(`PASS ${name}`);

try {
  await page.goto(`${base}/#/english`);
  await page.locator('.english-page').waitFor();
  assert.ok((await page.locator('.english-goals').innerText()).includes('待设置'));
  assert.equal(await page.locator('.english-stat').nth(0).locator('strong').innerText(), '0 分钟');
  log('personal empty state');

  await action('plan').click();
  await page.locator('#modal [name="examDate"]').fill('2027-06-19');
  await page.locator('#modal [name="target"]').fill('560');
  await page.locator('#modal [name="dailyMinutes"]').fill('25');
  await page.locator('#modal [name="focus"]').selectOption('reading');
  await page.locator('#modal button[type="submit"]').click();
  await page.locator('#modal').waitFor({ state: 'hidden' });
  assert.equal((await enState()).plan.dailyMinutes, 25);
  assert.equal((await enState()).plan.target, 560);
  log('plan save');

  await readSection('vocabulary');
  await action('word-flip').click();
  assert.ok((await page.locator('.english-word-card').innerText()).includes('观点'));
  await page.locator('[data-en="word-mark"][data-status="mastered"]').click();
  assert.equal((await enState()).words.filter(w => w.status === 'mastered').length, 1);
  await action('word-add').click();
  await page.locator('#modal [name="word"]').fill('deliberate');
  await page.locator('#modal [name="meaning"]').fill('有意的；深思熟虑的');
  await page.locator('#modal [name="example"]').fill('A deliberate choice can change a routine.');
  await page.locator('#modal button[type="submit"]').click();
  await page.locator('#modal').waitFor({ state: 'hidden' });
  assert.ok((await page.locator('.english-word-card').innerText()).includes('deliberate'));
  await page.locator('[data-en="word-mark"][data-status="review"]').click();
  await page.locator('[data-en="word-filter"][data-key="review"]').click();
  assert.ok((await page.locator('.english-word-card').innerText()).includes('deliberate'));
  log('vocabulary flip, mastery, add, review filter');

  await readSection('practice');
  for (const [id, answer] of [['r1', '1'], ['r2', '2'], ['r3', '1']]) await page.locator(`input[name="${id}"][value="${answer}"]`).check();
  await action('reading-submit').click();
  assert.equal((await enState()).readingResult.correct, 2);
  assert.equal((await enState()).mistakes.length, 1);
  assert.ok((await page.locator('.english-reading-result').innerText()).includes('2 / 3'));
  await readSection('mistakes');
  assert.equal(await page.locator('.english-mistake').count(), 1);
  await action('mistake-review').click();
  assert.equal((await enState()).mistakes[0].reviewed, true);
  log('reading local score, explanations, mistake review');

  await readSection('practice');
  await exercise('writing');
  await page.locator('[data-en-draft="writing"]').fill('Technology can support learning, but attention still requires deliberate practice.');
  await page.reload();
  await exercise('writing');
  assert.match(await page.locator('[data-en-draft="writing"]').inputValue(), /deliberate practice/);
  await exercise('translation');
  await page.locator('[data-en-draft="translation"]').fill('In recent years, students have used digital tools to organise their notes.');
  await page.reload();
  await exercise('translation');
  assert.match(await page.locator('[data-en-draft="translation"]').inputValue(), /organise their notes/);
  log('writing and translation draft persistence after reload');

  await exercise('listening');
  const audio = Buffer.alloc(44 + 16000);
  audio.write('RIFF', 0); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVE', 8); audio.write('fmt ', 12); audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22); audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(16000, 28); audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(16000, 40);
  await page.locator('[data-en-file="audio"]').setInputFiles({ name: 'english-test-silence.wav', mimeType: 'audio/wav', buffer: audio });
  await page.waitForFunction(() => document.querySelector('.english-audio-file audio')?.readyState >= 1);
  assert.equal((await enState()).audio.persistent, true);
  assert.ok((await enState()).audio.blobId);
  await page.locator('[data-en-draft="listening"]').fill('Test note: review the key phrase.');
  await page.reload();
  await exercise('listening');
  await page.waitForFunction(() => document.querySelector('.english-audio-file audio')?.readyState >= 1);
  assert.equal(await page.locator('.english-audio-file audio').evaluate(a => a.duration), 1);
  assert.match(await page.locator('[data-en-draft="listening"]').inputValue(), /key phrase/);
  log('audio upload, IndexedDB persistence, restored playable media, notes');

  await action('record').first().click();
  await page.locator('#modal [name="minutes"]').fill('12');
  await page.locator('#modal [name="note"]').fill('浏览器回归测试');
  await page.locator('#modal button[type="submit"]').click();
  await page.locator('#modal').waitFor({ state: 'hidden' });
  assert.equal((await enState()).sessions.length, 1);
  assert.equal((await enState()).sessions[0].minutes, 12);
  await readSection('records');
  await action('record-edit').click();
  await page.locator('#modal [name="minutes"]').fill('16');
  await page.locator('#modal button[type="submit"]').click();
  await page.locator('#modal').waitFor({ state: 'hidden' });
  assert.equal((await enState()).sessions[0].minutes, 16);
  assert.equal(await page.locator('.english-progress-ring strong').innerText(), '16');
  log('learning record create/edit and derived progress');

  await action('settings').click();
  await page.locator('[data-action="export"]').waitFor();
  const downloading = page.waitForEvent('download');
  await page.locator('[data-action="export"]').click();
  const download = await downloading;
  const backup = JSON.parse(await readFile(await download.path(), 'utf8'));
  assert.ok(backup.files.some(file => file.id === backup.state.english.audio.blobId));
  assert.match(backup.state.english.drafts.writing, /deliberate practice/);
  log('full backup contains audio blob and English drafts');

  await page.goto(`${base}/#/english`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.english-page').waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
  await action('plan').click();
  assert.ok(await page.locator('#modal [name="dailyMinutes"]').isVisible());
  await page.locator('#modal [data-close]').first().click();
  log('390px mobile layout without horizontal overflow and working modal');
  assert.deepEqual(errors, []);
  log('no browser page errors');
} finally {
  await context.close();
  await browser.close();
}
