import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/g2806/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser=await chromium.launch({headless:true,channel:'msedge'});
const base=process.env.TEST_URL||'http://127.0.0.1:4397';
let revision=0,workspace=null,configured=false,setupRequired=true;
const files=new Map(),writes=[],errors=[];
async function device(){
  const context=await browser.newContext({acceptDownloads:true});
  const session={authenticated:false,csrfToken:crypto.randomUUID(),username:'cloud-test',offline:false};
  await context.addInitScript(()=>{if(!localStorage.getItem('local-fixture')){localStorage.setItem('local-fixture','1');localStorage.setItem('czb-yuzhou-workspace-v1-personal','LOCAL_DATA_UNTOUCHED');}});
  await context.route('**/api/**',async route=>{
    const req=route.request(),path=new URL(req.url()).pathname,method=req.method();
    const answer=(status,data)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
    if(path==='/api/health')return answer(200,{mode:'cloud',version:'0.3.0'});
    if(path==='/api/auth/session')return answer(200,{...session,setupRequired});
    if(path==='/api/auth/setup'||path==='/api/auth/login'){
      const body=req.postDataJSON();assert.ok(body.password);if(setupRequired)assert.equal(body.setupToken,'fixture-setup-token');
      session.authenticated=true;setupRequired=false;return answer(200,{authenticated:true});
    }
    if(!session.authenticated)return answer(401,{error:'登录已过期'});
    if(session.offline)return route.abort('internetdisconnected');
    if(!['GET','HEAD'].includes(method)&&req.headers()['x-csrf-token']!==session.csrfToken)return answer(403,{error:'csrf_invalid'});
    if(path==='/api/auth/logout'){session.authenticated=false;return answer(200,{});}
    if(path==='/api/workspace'){
      if(method==='GET')return answer(200,{revision,state:workspace});
      const body=req.postDataJSON();if(body.baseRevision!==revision)return answer(409,{error:'revision_conflict'});
      const refs=[];function scan(x){if(x&&typeof x==='object')for(const [key,value] of Object.entries(x)){if(/^(blobId|fileId|audioId)$/.test(key)&&typeof value==='string')refs.push(value);else if(value&&typeof value==='object')scan(value);}}scan(body.state);
      for(const id of refs)assert.ok(files.has(id),'File bytes must exist before publishing workspace references');
      workspace=body.state;revision++;writes.push({revision,state:structuredClone(workspace)});return answer(200,{revision,updatedAt:new Date().toISOString()});
    }
    if(path.startsWith('/api/files/')){
      const id=path.split('/').at(-1);
      if(method==='PUT'){files.set(id,{body:req.postDataBuffer(),type:req.headers()['content-type']});return answer(200,{id});}
      if(!files.has(id))return answer(404,{error:'文件不存在'});
      const file=files.get(id);return route.fulfill({status:200,contentType:file.type,body:file.body});
    }
    if(path==='/api/model/status')return answer(200,{configured,provider:'deepseek',model:'deepseek-flash',hermesAvailable:true});
    if(path==='/api/model/config'){assert.equal(req.postDataJSON().apiKey,'fixture-sensitive-key');configured=true;return answer(200,{configured,provider:'deepseek',model:'deepseek-flash',hermesAvailable:true});}
    return answer(404,{error:'未实现'});
  });
  const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));
  return {context,page,session};
}
async function login(d,setup=false){await d.page.goto(base+'/#/tasks');await d.page.locator('#cloud-auth-form').waitFor();await d.page.locator('[name=username]').fill('cloud-test');await d.page.locator('[name=password]').fill('fixture-long-password');if(setup)await d.page.locator('[name=setupToken]').fill('fixture-setup-token');await d.page.locator('#cloud-auth-form button').click();await d.page.locator('#main [data-action=add-task]').first().waitFor();}
async function task(page,title){await page.locator('#main [data-action=add-task]').first().click();await page.locator('#modal [name=title]').fill(title);await page.locator('#modal button[type=submit]').click();await page.locator('#modal').waitFor({state:'hidden'});}
async function waitUntil(fn){for(let n=0;n<100;n++){if(fn())return;await new Promise(resolve=>setTimeout(resolve,100));}assert.ok(fn(),'Timed out waiting for server state');}
try{
  const a=await device(),b=await device();
  await login(a,true);assert.equal(await a.page.evaluate(()=>localStorage.getItem('czb-yuzhou-workspace-v1-personal')),'LOCAL_DATA_UNTOUCHED');
  assert.equal(await a.page.evaluate(()=>JSON.stringify(localStorage).includes('fixture-setup-token')),false);
  await task(a.page,'来自电脑 A');await waitUntil(()=>workspace?.tasks.some(x=>x.title==='来自电脑 A'));
  await login(b);assert.equal(await b.page.locator('.task-text').filter({hasText:'来自电脑 A'}).count(),1);
  console.log('PASS setup/login, preserved local namespace, second-device initial download');
  await b.page.locator('.task-text').filter({hasText:'来自电脑 A'}).click();await b.page.locator('#modal [name=title]').fill('设备 B 尚未提交的文字');
  await task(a.page,'来自电脑 A 的第二条');await waitUntil(()=>workspace.tasks.length===2);
  await b.page.locator('.cloud-sync-banner[data-status=remote]').waitFor();assert.equal(await b.page.locator('#modal [name=title]').inputValue(),'设备 B 尚未提交的文字');
  await b.page.locator('#modal button[type=submit]').click();await b.page.locator('.cloud-sync-banner[data-status=conflict]').waitFor();
  assert.equal(workspace.tasks.find(x=>x.title==='设备 B 尚未提交的文字'),undefined);
  assert.ok(await b.page.evaluate(()=>Object.keys(localStorage).some(key=>key.startsWith('czb-yuzhou-cloud-recovery-'))));
  await b.page.reload();await b.page.locator('.cloud-sync-banner[data-status=conflict]').waitFor();assert.equal(await b.page.locator('.task-text').filter({hasText:'设备 B 尚未提交的文字'}).count(),1);
  await b.page.locator('[data-cloud-load]').click();await b.page.locator('#modal button[type=submit]').click();await b.page.locator('#modal').waitFor({state:'hidden'});assert.equal(await b.page.locator('.task-text').count(),2);
  console.log('PASS remote update preserves editing, 409 does not overwrite, pending survives reload, explicit recovery');
  await a.page.evaluate(()=>location.hash='#/inbox');await a.page.locator('[data-action=capture-file]').first().click();
  await a.page.locator('#modal input[type=file]').setInputFiles({name:'cloud-original.txt',mimeType:'text/plain',buffer:Buffer.from('cloud file original bytes')});await a.page.locator('#modal button[type=submit]').click();await a.page.locator('#modal').waitFor({state:'hidden'});
  await waitUntil(()=>workspace.captures.some(x=>x.fileName==='cloud-original.txt'));assert.equal(files.size,1);
  await b.page.reload();await b.page.evaluate(()=>location.hash='#/inbox');const downloadEvent=b.page.waitForEvent('download');await b.page.locator('[data-action=download-capture]').click();const download=await downloadEvent;const stream=await download.createReadStream();const chunks=[];for await(const chunk of stream)chunks.push(chunk);assert.equal(Buffer.concat(chunks).toString(),'cloud file original bytes');
  console.log('PASS attachment uploaded before state and downloaded on second device');
  await a.page.evaluate(()=>location.hash='#/settings');await a.page.locator('#cloud-model-form [name=apiKey]').fill('fixture-sensitive-key');await a.page.locator('#cloud-model-form button').click();await a.page.locator('#cloud-model-badge').filter({hasText:'密钥已保存'}).waitFor();assert.equal(await a.page.locator('#cloud-model-form [name=apiKey]').inputValue(),'');assert.equal(await a.page.evaluate(()=>JSON.stringify(localStorage).includes('fixture-sensitive-key')),false);
  const before=revision;await a.page.locator('.mode-banner [data-action=switch-workspace]').click();await a.page.evaluate(()=>location.hash='#/tasks');await task(a.page,'示例不应上传');await new Promise(resolve=>setTimeout(resolve,1300));assert.equal(revision,before);
  await a.page.locator('.mode-banner [data-action=switch-workspace]').click();await a.page.evaluate(()=>location.hash='#/tasks');
  a.session.offline=true;await task(a.page,'离线记录');await a.page.locator('.sync-indicator[data-status=offline]').waitFor();a.session.offline=false;await a.page.reload();await a.page.locator('#main').waitFor();await waitUntil(()=>workspace.tasks.some(x=>x.title==='离线记录'));
  console.log('PASS secret never persisted, demo never syncs, offline pending survives reload and retries');
  a.session.authenticated=false;await task(a.page,'会话失效后的本机记录');await a.page.locator('.cloud-sync-banner[data-status=auth]').waitFor();assert.equal(workspace.tasks.some(x=>x.title==='会话失效后的本机记录'),false);assert.ok(await a.page.evaluate(()=>Object.keys(localStorage).filter(key=>key.endsWith('-sync')).some(key=>localStorage.getItem(key).includes('会话失效后的本机记录'))));
  b.session.csrfToken=crypto.randomUUID();await b.page.evaluate(()=>location.hash='#/tasks');await task(b.page,'令牌更新后的本机记录');await b.page.locator('.cloud-sync-banner[data-status=auth]').waitFor();
  assert.equal(await a.page.evaluate(()=>localStorage.getItem('czb-yuzhou-workspace-v1-personal')),'LOCAL_DATA_UNTOUCHED');assert.deepEqual(errors,[]);
  console.log('PASS expired session retains local edits, no page errors');
}finally{await browser.close();}
