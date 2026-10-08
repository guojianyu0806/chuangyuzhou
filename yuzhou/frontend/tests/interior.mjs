import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/g2806/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser=await chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:960}});
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
const base=process.env.TEST_URL||'http://127.0.0.1:4397';
const snapshot=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('czb-yuzhou-workspace-v1-demo')));
const overlapping=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
async function holdMove(board){
  const card=page.locator('.cv-card').first(),id=await card.getAttribute('data-card');
  const before=(await snapshot()).boards[board].cards.find(c=>c.id===id);
  const box=await card.locator('.cv-card-top-label').boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.waitForTimeout(510);
  assert.match(await card.getAttribute('class'),/is-longpress-lifted/);
  await page.mouse.move(box.x+box.width/2+85,box.y+box.height/2+48,{steps:8});await page.mouse.up();
  const after=(await snapshot()).boards[board].cards.find(c=>c.id===id);assert.ok(after.x!==before.x||after.y!==before.y);
  await page.reload();await page.locator('.cv-card').first().waitFor();
  assert.deepEqual((await snapshot()).boards[board].cards.find(c=>c.id===id),after);
  console.log(`PASS ${board} long-press lift, drag and persisted geometry`);
}
try{
  await mkdir('.runtime',{recursive:true});
  await page.goto(`${base}/#/tasks`);await holdMove('tasks');
  const task=page.locator('.cv-card').first();await task.locator('[data-cv=card-menu]').click();
  await page.locator('#modal [name=color]').fill('#FFBC7C');await page.locator('#modal [name=width]').fill('390');
  await page.locator('#modal button[type=submit]').click();await page.locator('#modal').waitFor({state:'hidden'});
  await page.locator('#main [data-action=add-task]').click();await page.locator('#modal [name=title]').fill('New interior card');
  await page.locator('#modal button[type=submit]').click();await page.locator('#modal').waitFor({state:'hidden'});
  const data=await snapshot(),created=data.boards.tasks.cards.find(c=>c.id===data.tasks.find(t=>t.title==='New interior card').id);
  assert.ok(data.boards.tasks.cards.filter(c=>c.id!==created.id).every(c=>!overlapping(created,c)),'new cards preserve the arrangement and do not cover existing cards');
  const createdRect=await page.locator(`[data-card="${created.id}"]`).boundingBox();const viewport=await page.locator('.cv-viewport').boundingBox();
  assert.ok(createdRect.y>=viewport.y&&createdRect.y+createdRect.height<=viewport.y+viewport.height+1,'new card brought into view');
  await page.screenshot({path:'.runtime/interior-tasks-desktop.png',fullPage:true});
  console.log('PASS task appearance and non-overlapping creation');
  await page.goto(`${base}/#/inbox`);await holdMove('inbox');
  const drop=await page.evaluateHandle(()=>{const dt=new DataTransfer();dt.items.add(new File(['inner drop bytes'],'inner.txt',{type:'text/plain'}));return dt;});
  await page.locator('.cv-viewport').dispatchEvent('drop',{dataTransfer:drop});await drop.dispose();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('czb-yuzhou-workspace-v1-demo')).captures.some(c=>c.fileName==='inner.txt'));
  const file=(await snapshot()).captures.find(c=>c.fileName==='inner.txt');assert.ok(file.blobId);
  await page.screenshot({path:'.runtime/interior-inbox-desktop.png',fullPage:true});console.log('PASS inbox original file drop');
  for(const route of ['review','settings']){
    await page.goto(`${base}/#/${route}`);await page.screenshot({path:`.runtime/interior-${route}-desktop.png`,fullPage:true});
  }
  for(const width of [320,390,768]){
    await page.setViewportSize({width,height:900});
    for(const route of ['tasks','inbox','review','settings']){
      await page.goto(`${base}/#/${route}`);
      if(await page.locator('[data-cv=list]').count())await page.locator('[data-cv=list]').click();
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${route} fits ${width}`);
    }
  }
  assert.deepEqual(errors,[]);console.log('PASS inner pages mobile/tablet layouts without browser errors');
}finally{await context.close();await browser.close();}
