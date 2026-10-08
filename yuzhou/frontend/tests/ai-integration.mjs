import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {chromium} = require('C:/Users/g2806/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const base = process.env.TEST_URL || 'http://127.0.0.1:4173';
const key = 'lumi-workspace-v1-personal';
let browser;
try { browser = await chromium.launch({headless:true}); }
catch { browser = await chromium.launch({headless:true,channel:'msedge'}); }
const contexts = [], errors = [];
async function context() {
  const result = await browser.newContext({acceptDownloads:true,viewport:{width:1440,height:1100}});
  await result.addInitScript(()=>localStorage.setItem('lumi-mode','personal'));
  contexts.push(result);
  const page = await result.newPage(); page.setDefaultTimeout(15000);
  page.on('pageerror',error=>errors.push(error.message));
  return page;
}
async function stored(page) { return await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key); }
async function route(page, target, selector) {
  await page.evaluate(target=>{location.hash=`#/${target}`;},target);
  await page.locator(selector).waitFor();
}
async function submitModal(page) {
  await page.locator('#modal button[type=submit]').click();
  await page.locator('#modal').waitFor({state:'hidden'});
}
async function upload(page,name,content) {
  const previous = (await stored(page))?.aiDraft?.files?.length || 0;
  await page.locator('[data-ai-files]').setInputFiles({name,mimeType:'text/plain',buffer:Buffer.from(content)});
  await page.waitForFunction(([key,count])=>JSON.parse(localStorage.getItem(key)).aiDraft.files.length===count,[key,previous+1]);
}
async function fileRequest(page,target) {
  await page.locator('[data-ai=file]').click();
  await page.locator('#modal [name=destination]').selectOption(target);
  await submitModal(page);
  await page.locator('.ai-receipt').waitFor();
}
async function downloadBuffer(page,action) {
  const pending = page.waitForEvent('download'); await action();
  const download = await pending; const stream = await download.createReadStream();
  const chunks = [];for await(const chunk of stream)chunks.push(chunk);
  return Buffer.concat(chunks);
}
const pass = name=>console.log(`PASS ${name}`);
try {
  const page = await context();
  await page.goto(`${base}/#/ai`); await page.locator('.ai-page').waitFor();
  await page.locator('.sidebar').hover();
  await page.locator('.rail-new').click();
  await page.locator('#modal [name=title]').fill('AI TEST 学生会');
  await page.locator('#modal [name=description]').fill('迎新活动、会议记录与执行待办');
  await page.locator('#modal .sp-template-options label').filter({has:page.locator('[value=affairs]')}).click();
  await submitModal(page);
  const spaceId = (await stored(page)).spaces[0].id;
  await route(page,`space/${spaceId}`,'.sp-page');
  await page.locator('.sp-hero [data-sp-action=ai]').click(); await page.locator('.ai-page').waitFor();
  assert.equal(await page.locator('.ai-composer [name=destination]').inputValue(),`space:${spaceId}`);
  await page.locator('#ai-instruction').fill('AI TEST 迎新活动会议原文\n场地沟通由我负责。');
  await upload(page,'meeting-original.txt','AI TEST original meeting attachment');
  await page.locator('.ai-send').click();
  await page.locator('.ai-request-row').waitFor();
  let state = await stored(page);
  const unionRequest = state.aiRequests[0].id;
  assert.equal(state.aiRequests[0].status,'waiting_model');
  assert.equal(state.spaces[0].notes.length,0,'no fake automatic organization before model connection');
  await fileRequest(page,`space:${spaceId}`);
  state = await stored(page);
  assert.equal(state.spaces[0].notes.length,1);assert.equal(state.spaces[0].files.length,1);
  assert.equal(state.spaces[0].notes[0].sourceRequestId,unionRequest);
  assert.equal(state.aiRequests[0].receipt.items.length,2);
  await page.locator('[data-ai=visit]').click();await page.locator('.sp-page').waitFor();
  assert.ok(page.url().includes(`#/space/${spaceId}`));
  const attachment = await downloadBuffer(page,async()=>{
    await page.locator('.sp-tabs [data-tab=files]').click();
    await page.locator('[data-sp-board] [data-cv=enter]').click();
    await page.locator('[data-sp-action=download-file]').click();
  });
  assert.equal(attachment.toString(),'AI TEST original meeting attachment');
  pass('real workspace creation + AI queue + explicitly route text/file + destination navigation/download');

  await page.locator('.sp-tabs [data-tab=notes]').click();
  await page.locator('[data-sp-board] [data-cv=enter]').click();
  await page.locator('[data-sp-action=edit-note]').click();
  await page.locator('#modal [name=content]').fill('AI TEST 我后来亲自补充的笔记，不能撤回删除。');
  await submitModal(page);
  await page.waitForFunction(key=>JSON.parse(localStorage.getItem(key)).spaces[0].notes[0].content==='AI TEST 我后来亲自补充的笔记，不能撤回删除。',key);
  assert.equal((await stored(page)).spaces[0].notes[0].content,'AI TEST 我后来亲自补充的笔记，不能撤回删除。','space note edit saved before undo');
  await route(page,'ai','.ai-page');
  await page.locator('[data-ai=undo]').click();
  await page.locator('[data-ai=file]').waitFor();
  state = await stored(page);
  assert.equal(state.spaces[0].notes.length,1);assert.equal(state.spaces[0].files.length,0);
  assert.equal(state.spaces[0].notes[0].content,'AI TEST 我后来亲自补充的笔记，不能撤回删除。');
  assert.equal(state.aiRequests[0].files.length,1);assert.equal(state.aiRequests[0].status,'waiting_model');
  assert.match(await page.locator('#toasts').innerText(),/已编辑内容保留/);
  await fileRequest(page,`space:${spaceId}`);
  assert.equal((await stored(page)).spaces[0].notes.length,2);
  pass('undo protects edited notes, retracts unchanged attachment metadata, retains original request, allows refile');

  await page.locator('#ai-instruction').fill('AI TEST 六级写作素材：环境与城市发展。');
  await page.locator('.ai-composer [name=destination]').selectOption('english');
  await upload(page,'english-material.txt','AI TEST English original attachment');
  await page.locator('.ai-send').click();
  await page.locator('[data-ai=file]').waitFor();
  await fileRequest(page,'english');
  await page.locator('[data-ai=visit]').click();await page.locator('.english-materials').waitFor();
  assert.ok(page.url().endsWith('#/english/materials'));
  assert.match(await page.locator('.english-materials').innerText(),/AI TEST 六级写作素材/);
  const englishBytes = await downloadBuffer(page,()=>page.locator('[data-en=material-download]').click());
  assert.equal(englishBytes.toString(),'AI TEST English original attachment');
  pass('English destination opens materials tab with original text and downloadable original file');

  await route(page,'ai','.ai-page');
  await page.locator('#ai-instruction').fill('AI TEST 还没有发出的草稿');
  await upload(page,'unfinished-draft.txt','AI TEST unsent draft file');
  await route(page,'settings','[data-action=export]');
  const backupBuffer = await downloadBuffer(page,()=>page.locator('[data-action=export]').click());
  const backup = JSON.parse(backupBuffer.toString());
  assert.equal(backup.state.aiRequests.length,2);assert.equal(backup.files.length,3);
  assert.equal(backup.state.aiDraft.files.length,1);
  const restored = await context();await restored.goto(`${base}/#/settings`);await restored.locator('[data-action=import]').waitFor();
  for(let i=0;i<2;i++){
    await restored.locator('[data-action=import]').click();
    await restored.locator('#modal [name=file]').setInputFiles({name:'ai-backup.json',mimeType:'application/json',buffer:backupBuffer});
    await submitModal(restored);
  }
  const data = await stored(restored);
  assert.equal(data.spaces.length,1);assert.equal(data.spaces[0].notes.length,2);
  assert.equal(data.aiRequests.length,2);assert.equal(data.aiDraft.text,'AI TEST 还没有发出的草稿');
  await route(restored,'english/materials','.english-materials');
  const restoredBytes = await downloadBuffer(restored,()=>restored.locator('[data-en=material-download]').click());
  assert.equal(restoredBytes.toString(),'AI TEST English original attachment');
  await route(restored,'ai','.ai-page');
  const draftBytes = await restored.evaluate(async key=>{
    const state=JSON.parse(localStorage.getItem(key));const {getFile}=await import('/src/services.js');return await (await getFile(state.aiDraft.files[0].blobId)).text();
  },key);
  assert.equal(draftBytes,'AI TEST unsent draft file');
  await restored.locator('[data-ai=undo]').click();await restored.locator('[data-ai=file]').waitFor();
  assert.equal((await stored(restored)).captures.length,0);
  assert.equal((await stored(restored)).aiDraft.text,'AI TEST 还没有发出的草稿');
  assert.deepEqual(errors,[]);
  pass('full backup export, repeat import in fresh browser, original file + unsent draft restoration, restored receipt undo, no JS errors');
} finally {for(const context of contexts)await context.close();await browser.close();}
