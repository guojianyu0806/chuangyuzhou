// End-to-end UI test against a real isolated SQLite backend. Only model inference
// is a deterministic fixture; no real provider credentials or model calls occur.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createWorkbenchServer } from '../../backend/server.mjs';
import { createHermesService } from '../../backend/hermes.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/g2806/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const runtime = resolve('frontend/.runtime');
await mkdir(runtime, { recursive: true });
const dataDir = await mkdtemp(resolve(runtime, 'ai-cloud-real-'));
const python = process.platform === 'win32'
  ? spawnSync('py', ['-3', '-c', 'import sys; print(sys.executable)'], { encoding: 'utf8', windowsHide: true }).stdout.trim()
  : 'python3';
assert.ok(python, 'Python is required to exercise actual TXT extraction');
const modelCalls = [], gates = new Map(), attempts = new Map(), errors = [], network = [];
function fixtureGate(marker) {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  gates.set(marker, { promise, release });
  return release;
}
async function fixtureModel({ user }) {
  const input = JSON.parse(user);
  const marker = input.instruction.split('\n')[0];
  modelCalls.push({ marker, sources: input.sources });
  attempts.set(marker, (attempts.get(marker) || 0) + 1);
  if (gates.has(marker)) await gates.get(marker).promise;
  if (marker === 'RETRY_FIXTURE' && attempts.get(marker) === 1) return 'INVALID MODEL JSON FIXTURE';
  const sourceIds = input.sources.map(source => source.id);
  return { title: `${marker} 整理结果`, summary: '这是测试模型的固定整理结果。',
    notes: [{ title: `${marker} 测试笔记`, content: `## 固定测试笔记\n保留依据，完成多设备整理验证。\n${input.sources.flatMap(source => source.units.map(unit => `[${source.name} · ${unit.label}] ${unit.text}`)).join('\n')}`, sourceIds }],
    tasks: [{ title: `${marker} 测试待办`, description: '端到端测试生成', date: '', priority: 'normal' }],
    destinationId: input.requestedDestination === 'auto' ? 'inbox' : input.requestedDestination,
    reason: '隔离测试 fixture 指定归属。', warnings: [] };
}
const app = await createWorkbenchServer({ dataDir, secureCookie: false, setupToken: 'test-only-ai-initial-token',
  modelFactory: options => createHermesService({ ...options, engineAvailable: () => true, runModel: fixtureModel,
    env: { ...process.env, SHIGUANG_EXTRACT_PYTHON: python } }),
});
await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${app.server.address().port}`;
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const pass = name => console.log(`PASS ${name}`);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await predicate(); if (value) return value; await sleep(50); }
  throw new Error(`Timed out: ${label}`);
}
function observe(page) {
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) network.push({ page, method: request.method(), path: new URL(request.url()).pathname }); });
}
async function login(page, setup = false) {
  await page.goto(`${base}/#/ai`);
  await page.locator('[name=username]').fill('ai-cloud-test');
  await page.locator('[name=password]').fill('test-only-private-password');
  if (setup) await page.locator('[name=setupToken]').fill('test-only-ai-initial-token');
  await page.locator('#cloud-auth-form button').click();
  await page.locator('.ai-page').waitFor();
}
async function route(page, value) {
  await page.evaluate(value => { location.hash = `#/${value}`; }, value);
  await page.locator(value === 'ai' ? '.ai-page' : '.settings-layout').waitFor();
}
const state = () => app.store.getWorkspace().state;
async function submit(page, text, file = null) {
  await route(page, 'ai');
  await page.locator('#ai-instruction').fill(text);
  if (file) {
    await page.locator('[data-ai-files]').setInputFiles({ name: file.name, mimeType: 'text/plain', buffer: Buffer.from(file.text) });
    await page.locator('.ai-attachment-chip').filter({ hasText: file.name }).waitFor();
  }
  await page.locator('.ai-send').click();
  const request = await until(() => state()?.aiRequests.find(request => request.text === text), 'request saved');
  await until(() => modelCalls.some(call => call.marker === text.split('\n')[0]), 'model fixture started');
  return request.id;
}
async function filed(requestId) { return until(() => state()?.aiRequests.find(request => request.id === requestId && request.status === 'filed'), 'server auto archive'); }
async function select(page, requestId) { await page.locator(`[data-ai=select][data-id="${requestId}"]`).click(); }
async function showFiled(page, requestId) {
  await page.locator(`[data-ai=select][data-id="${requestId}"][data-status=filed]`).waitFor();
  await select(page, requestId);
  await page.locator('.ai-receipt').filter({ hasText: 'Hermes' }).waitFor();
}

try {
  const first = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1050 } });
  const second = await browser.newContext({ acceptDownloads: true, viewport: { width: 390, height: 844 } });
  let a = await first.newPage(); const b = await second.newPage(); observe(a); observe(b);
  await login(a, true);
  await route(a, 'settings');
  await a.locator('#cloud-model-form [name=apiKey]').fill('fixture-private-key-do-not-call-provider');
  await a.locator('#cloud-model-form button[type=submit]').click();
  await a.locator('#cloud-model-badge').filter({ hasText: '已配置' }).waitFor();
  assert.equal(await a.locator('#cloud-model-form [name=apiKey]').inputValue(), '');
  assert.equal(await a.evaluate(() => Object.values(localStorage).some(value => value.includes('fixture-private-key'))), false);
  await login(b);

  const releaseText = fixtureGate('TEXT_FIXTURE');
  const firstId = await submit(a, 'TEXT_FIXTURE\n明天复习数据结构，保留我这段原文。');
  releaseText();
  const firstRequest = await filed(firstId);
  assert.equal(firstRequest.originalText, 'TEXT_FIXTURE\n明天复习数据结构，保留我这段原文。');
  assert.equal(firstRequest.receipt.engine, 'hermes');
  await showFiled(a, firstId);
  await showFiled(b, firstId);
  assert.equal(state().tasks.filter(task => task.sourceRequestId === firstId).length, 1);
  pass('text submission -> real backend job -> atomic auto-file -> desktop/mobile contexts refresh');

  const releaseFile = fixtureGate('FILE_FIXTURE');
  const fileBytes = '原文件字节\n队列是一种先进先出的数据结构。';
  const fileId = await submit(a, 'FILE_FIXTURE\n整理这份课程文本', { name: '课堂原始资料.txt', text: fileBytes });
  const source = modelCalls.find(call => call.marker === 'FILE_FIXTURE').sources.find(source => source.name === '课堂原始资料.txt');
  assert.equal(source.units[0].text, fileBytes);
  await a.close();
  releaseFile();
  const fileRequest = await filed(fileId);
  assert.equal(fileRequest.files.length, 1);
  assert.ok(fileRequest.files[0].blobId);
  await showFiled(b, fileId);
  await b.screenshot({ path: resolve(runtime, 'ai-cloud-mobile-filed.png'), fullPage: true });
  const downloadEvent = b.waitForEvent('download');
  await b.locator('[data-ai=download]').click();
  const download = await downloadEvent, stream = await download.createReadStream(), bytes = [];
  for await (const chunk of stream) bytes.push(chunk);
  assert.equal(Buffer.concat(bytes).toString('utf8'), fileBytes);
  pass('actual Python TXT extraction, closed submitting page still files, remote original download bytes match');

  a = await first.newPage(); observe(a); await a.goto(`${base}/#/ai`); await a.locator('.ai-page').waitFor();
  const retryId = await submit(a, 'RETRY_FIXTURE\n第一次模拟模型坏 JSON，第二次成功。');
  await a.locator('[data-ai=run]').filter({ hasText: '重新整理' }).waitFor();
  await until(async () => await a.locator('.ai-wait-note').innerText().then(text => text.includes('有效')), 'failed job visible');
  assert.equal(state().aiRequests.find(request => request.id === retryId).status, 'waiting_model');
  await a.locator('[data-ai=run]').click();
  await filed(retryId); await showFiled(a, retryId);
  assert.equal(attempts.get('RETRY_FIXTURE'), 2);
  pass('invalid model output retains input, visible retry invokes a new job and succeeds');

  await a.locator('[data-ai=undo]').click();
  await until(() => state().aiRequests.find(request => request.id === retryId).status === 'waiting_model', 'undo sync');
  assert.equal(state().tasks.filter(task => task.sourceRequestId === retryId).length, 0);
  await a.locator('[data-ai=run]').waitFor();
  await a.locator('[data-ai=run]').click();
  await filed(retryId); await showFiled(a, retryId);
  assert.equal(attempts.get('RETRY_FIXTURE'), 2, 'explicit reapply reuses result without another model invocation');
  assert.equal(state().tasks.filter(task => task.sourceRequestId === retryId).length, 1);
  pass('undo then explicit organize reapplies cached proposal once without another model call');

  const beforeDemo = network.length, beforeCalls = modelCalls.length;
  await a.locator('.mode-banner [data-action=switch-workspace]').click();
  await route(a, 'ai');
  await a.locator('#ai-instruction').fill('DEMO_ONLY_FIXTURE 不应该发送模型请求');
  await a.locator('.ai-send').click();
  await a.locator('.ai-original-text').filter({ hasText: 'DEMO_ONLY_FIXTURE' }).waitFor();
  await sleep(1200);
  assert.equal(network.slice(beforeDemo).filter(item => item.page === a && /^\/api\/(ai|model)\//.test(item.path)).length, 0);
  assert.equal(modelCalls.length, beforeCalls);
  assert.equal(state().aiRequests.some(request => request.text.includes('DEMO_ONLY_FIXTURE')), false);
  assert.deepEqual(errors, []);
  pass('example workspace keeps inputs local and issues no AI/model API request');
  console.log('PASS all AI cloud integration checks (deterministic inference fixture; no real provider traffic)');
} catch (error) {
  console.error(error);
  for (const context of browser.contexts()) for (const page of context.pages()) {
    if (!page.isClosed()) await page.screenshot({ path: resolve(runtime, `ai-cloud-failure-${Date.now()}.png`), fullPage: true }).catch(() => {});
  }
  process.exitCode = 1;
} finally {
  for (const gate of gates.values()) gate.release();
  await browser.close(); await app.close();
  if (dataDir.startsWith(runtime + sep)) await rm(dataDir, { recursive: true, force: true });
}
