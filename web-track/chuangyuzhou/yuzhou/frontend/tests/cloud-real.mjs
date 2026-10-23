// Historical browser script: review only; use documented isolated tests.
throw new Error('SUBMISSION_LEGACY_BROWSER_DISABLED: configure an isolated browser test explicitly before reuse.');
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {createWorkbenchServer} from '../../backend/server.mjs';
const require=createRequire(import.meta.url);
const {chromium}=require('playwright');
const runtime=resolve('frontend/.runtime');await mkdir(runtime,{recursive:true});const dataDir=await mkdtemp(resolve(runtime,'cloud-real-'));
const app=await createWorkbenchServer({dataDir,secureCookie:false,setupToken:'test-only-initial-token'});
await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${app.server.address().port}`;
const browser=await chromium.launch({headless:true,channel:'msedge'});const errors=[];
try{
  const first=await browser.newContext({acceptDownloads:true}),second=await browser.newContext({acceptDownloads:true,viewport:{width:390,height:844}});
  const a=await first.newPage(),b=await second.newPage();for(const page of [a,b]){page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));}
  async function login(page,setup){await page.goto(base+'/#/tasks');await page.locator('[name=username]').fill('cloud-real');await page.locator('[name=password]').fill('integration-private-password');if(setup)await page.locator('[name=setupToken]').fill('test-only-initial-token');await page.locator('#cloud-auth-form button').click();await page.locator('#main [data-action=add-task]').first().waitFor();}
  await a.goto(base);await a.screenshot({path:resolve(runtime,'cloud-login-desktop.png'),fullPage:true});await login(a,true);
  await a.locator('#main [data-action=add-task]').first().click();await a.locator('#modal [name=title]').fill('真实后端同步待办');await a.locator('#modal button[type=submit]').click();await a.locator('.sync-indicator[data-status=saved]').waitFor();
  const cookies=await first.cookies();assert.ok(cookies.some(c=>c.name==='shiguang_session'&&c.httpOnly&&c.sameSite==='Strict'));
  await login(b,false);assert.equal(await b.locator('.task-text').filter({hasText:'真实后端同步待办'}).count(),1);
  assert.equal(await b.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  await b.screenshot({path:resolve(runtime,'cloud-tasks-mobile.png'),fullPage:true});
  await a.evaluate(()=>location.hash='#/inbox');await a.locator('[data-action=capture-file]').first().click();await a.locator('#modal input[type=file]').setInputFiles({name:'课堂原件.txt',mimeType:'text/plain',buffer:Buffer.from('文件原字节 \n lesson notes')});await a.locator('#modal button[type=submit]').click();await a.locator('.sync-indicator[data-status=saved]').waitFor();
  await b.reload();await b.evaluate(()=>location.hash='#/inbox');const event=b.waitForEvent('download');await b.locator('[data-action=download-capture]').click();const item=await event,stream=await item.createReadStream(),parts=[];for await(const part of stream)parts.push(part);assert.equal(Buffer.concat(parts).toString(),'文件原字节 \n lesson notes');
  const uploadedBefore=await a.evaluate(async()=> (await (await fetch('/api/workspace')).json()).revision);
  await a.reload();await a.locator('.sync-indicator[data-status=saved]').waitFor();await a.locator('[data-action=add-capture]').first().click();await a.locator('#modal [name=text]').fill('附件已存在后继续更新');await a.locator('#modal button[type=submit]').click();await a.locator('.sync-indicator[data-status=saved]').waitFor();assert.ok(await a.evaluate(async()=> (await (await fetch('/api/workspace')).json()).revision)>uploadedBefore);
  await a.evaluate(()=>location.hash='#/settings');
  const backupState=await a.evaluate(async()=> (await (await fetch('/api/workspace')).json()).state);
  const importedId=crypto.randomUUID();backupState.captures.push({id:crypto.randomUUID(),text:'导入到云端的原件',category:'备忘',tags:'',archived:false,createdAt:new Date().toISOString(),blobId:importedId,fileName:'imported.txt',fileType:'text/plain'});
  const backup={format:'lumi-backup',version:1,state:backupState,files:[{id:importedId,type:'text/plain',data:'data:text/plain;base64,'+Buffer.from('imported original bytes').toString('base64')}]};
  await a.locator('[data-action=import]').click();await a.locator('#modal input[type=file]').setInputFiles({name:'cloud-import.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});await a.locator('#modal button[type=submit]').click();await a.locator('#modal').waitFor({state:'hidden'});await a.locator('.sync-indicator[data-status=saved]').waitFor();assert.equal(await a.evaluate(async id=>(await fetch('/api/files/'+id)).status,importedId),200);
  await a.locator('[data-cloud-logout]').click();await a.locator('#cloud-auth-form').waitFor();assert.equal(await a.locator('.task-text').count(),0);
  assert.deepEqual(errors,[]);console.log('PASS real SQLite backend: setup, cookie session, CSRF writes, two-device sync, private file bytes, reload HEAD verification, backup import with new file, logout, responsive 390px');
}finally{await browser.close();await app.close();if(dataDir.startsWith(runtime+sep))await rm(dataDir,{recursive:true,force:true});}
