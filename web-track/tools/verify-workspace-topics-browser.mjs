// Browser acceptance runs the production UI and SQLite service on a new loopback
// fixture. Its model is a deterministic function and no external request is made.
// Set PLAYWRIGHT_MODULE and PLAYWRIGHT_EXECUTABLE_PATH to use local installations.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,mkdtemp,realpath,rm} from 'node:fs/promises';
import {basename,join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createWorkbenchServer} from '../chuangyuzhou/yuzhou/backend/server.mjs';
import {createHermesService} from '../chuangyuzhou/yuzhou/backend/hermes.mjs';
import {ensureCanvas} from '../chuangyuzhou/yuzhou/frontend/src/canvas.js';
import {createCustomBlock} from '../chuangyuzhou/yuzhou/frontend/src/custom-blocks-model.js';
import {createWorkbench} from '../chuangyuzhou/yuzhou/frontend/src/workbench-model.js';
import {spaceBoardKey,spaceWorkbenchLayout} from '../chuangyuzhou/yuzhou/frontend/src/space-workbench-model.js';
import {initializeSpaces} from '../chuangyuzhou/yuzhou/frontend/src/workspace-model.js';
import {assertRuntimePath,RUNTIME_ROOT} from '../chuangyuzhou/yuzhou/runtime.mjs';

const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const parent=assertRuntimePath(join(RUNTIME_ROOT,'tests-temp'));
await mkdir(parent,{recursive:true});
const directory=assertRuntimePath(await mkdtemp(join(parent,'web-topics-browser-')));
const stamp='2026-11-10T00:00:00.000Z';
const first='event-space',second='block:script-note',untouched='private-space';
const area=(id,title,description)=>({
  id,title,description,type:'project',color:'#7950f2',icon:'star',
  createdAt:stamp,updatedAt:stamp,archived:false,files:[],
  notes:[{id:id+'-note',title:'内容保留核对',content:'原始笔记 '+id,updatedAt:stamp,revisions:[]}]
});
const seeded=initializeSpaces({
  schema:1,mode:'personal',profile:{name:'主题验收账号',major:'',provider:'deepseek'},
  workbench:{...createWorkbench(),onboardingComplete:true},
  spaces:[
    area(first,'参赛项目','整理参赛过程和活动进度。'),
    area(untouched,'未选资料','未选中卡片及笔记均不得进入模型。')
  ],
  courses:[],tasks:[],captures:[],english:{},updatedAt:stamp
});
createCustomBlock(seeded,{kind:'note',title:'三分钟讲稿',description:'用于同一参赛项目的现场演示。',config:{text:'原始便笺正文'}},{id:second,now:stamp});
const seedCanvas=ensureCanvas(seeded);
seedCanvas.initialized=true;
seeded.boards={[spaceBoardKey(first)]:{...spaceWorkbenchLayout(seeded,first),initialized:true}};

const requests=[];
const heldModel=Promise.withResolvers();
let app,context,a;
const errors=[];
const topics='/api/workspace/topics';
const topicRoute='#/home/topics';
const button=(page,name)=>page.getByRole('button',{name,exact:true});
const heading=(page,name)=>page.getByRole('heading',{name,exact:true});
const selected=(page,id)=>page.locator('[data-topics-select="'+id+'"]');
const topicInput=(page,id)=>page.locator('[data-topics-topic="'+id+'"]');
const openCard=(page,id)=>page.locator('[data-topics-open="'+id+'"]');
const current=()=>app.store.getWorkspace();
const topicFor=id=>current().state.workspaceTopics?.assignments.find(row=>row.id===id)?.topic??undefined;
const originals=({state})=>Object.fromEntries(
  ['spaces','tasks','courses','captures','canvas','workbench','customBlocks','boards','ledger','calendar','timetable','aiRequests','aiDraft'].map(key=>[key,state[key]])
);
async function eventually(read,message){
  const end=Date.now()+10000;
  while(Date.now()<end){
    const result=await read();
    if(result)return result;
    await delay(45);
  }
  assert.fail(message);
}
async function inTopics(page){
  await page.waitForURL(url=>url.hash===topicRoute);
  await heading(page,'按主题查看').waitFor();
}
async function review(page){
  await heading(page,'审核归类建议').waitFor();
}
async function startReview(page,ids){
  for(const id of ids)await selected(page,id).check();
  await button(page,'AI 归类').click();
}
async function saveReview(page,id,value){
  await topicInput(page,id).fill(value);
  await button(page,'确认归类').click();
  await eventually(()=>topicFor(id)===value,'审阅后的主题未保存。');
  await heading(page,'审核归类建议').waitFor({state:'hidden'});
}

try {
  app=await createWorkbenchServer({
    dataDir:join(directory,'service'),secureCookie:false,setupToken:'fixture-topics-setup',
    modelFactory:({dataDir,store})=>createHermesService({
      dataDir,store,env:{},engineAvailable:()=>true,
      runModel:async ({user})=>{
        const {cards}=JSON.parse(user);
        requests.push(cards);
        if(requests.length===1){
          await heldModel.promise;
        }
        return {cards:cards.map(({id})=>({id,topic:'参赛准备',reason:'这张卡服务于参赛展示。'}))};
      }
    })
  });
  await new Promise((resolve,reject)=>{
    app.server.once('error',reject);
    app.server.listen(0,'127.0.0.1',resolve);
  });
  const origin='http://127.0.0.1:'+app.server.address().port;
  context=await chromium.launchPersistentContext(join(directory,'browser'),{
    executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||undefined,
    headless:true,reducedMotion:'reduce',viewport:{width:1280,height:900},
    args:['--no-proxy-server','--disable-background-networking','--disable-component-update']
  });
  context.setDefaultTimeout(10000);
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  const headers={Origin:origin};
  const setup=await context.request.post(origin+'/api/auth/setup',{
    headers,data:{username:'topics-browser-fixture',password:'synthetic-topics-fixture-only',setupToken:'fixture-topics-setup'}
  });
  assert.equal(setup.status(),201);
  const {csrfToken}=await setup.json();
  const model=await context.request.put(origin+'/api/model/config',{
    headers:{...headers,'X-CSRF-Token':csrfToken},
    data:{provider:'deepseek',model:'deepseek-flash',apiKey:'synthetic-transport-disabled-fixture'}
  });
  assert.equal(model.status(),200);
  app.store.saveWorkspace(current().revision,seeded);

  a=context.pages()[0]||await context.newPage();
  a.on('pageerror',error=>errors.push(error.message));
  await a.goto(origin+'/#/home');
  await a.locator('[data-welcome-action="enter"]').press('Enter');
  await button(a,'按主题查看').click();
  await inTopics(a);
  const before=originals(current());

  // Leaving the view mid-generation must not submit or repeat the model job.
  await startReview(a,[first,second]);
  await eventually(()=>requests.length===1,'模型任务未进入测试服务。');
  await button(a,'返回画布').click();
  await a.waitForURL(url=>url.hash==='#/home');
  await a.goBack();
  await inTopics(a);
  await a.reload();
  await inTopics(a);
  heldModel.resolve();
  await review(a);
  assert.equal(requests.length,1);
  assert.deepEqual(requests[0].map(card=>card.id).sort(),[first,second].sort());
  assert.deepEqual(requests[0].map(card=>card.kind).sort(),['block','space']);
  assert.doesNotMatch(JSON.stringify(requests[0]),/原始笔记|原始便笺正文|未选资料/);
  assert.equal(current().state.workspaceTopics,undefined);

  await topicInput(a,first).fill('窗口甲审阅后的主题');
  const search=a.locator('[data-topics-search]');
  await search.fill('参赛项目');
  await openCard(a,first).click();
  await a.waitForURL(url=>url.hash==='#/space/'+first);
  await a.locator('[data-return-source]').click();
  await inTopics(a);
  await review(a);
  assert.equal(await topicInput(a,first).inputValue(),'窗口甲审阅后的主题');
  assert.equal(await search.inputValue(),'参赛项目');
  await openCard(a,first).click();
  await a.waitForURL(url=>url.hash==='#/space/'+first);
  await a.goBack();
  await inTopics(a);
  await a.reload();
  await review(a);
  assert.equal(await topicInput(a,first).inputValue(),'窗口甲审阅后的主题');
  assert.deepEqual(originals(current()),before);
  console.log('PASS: 切页、两种返回、刷新恢复草稿及生成中离开');

  // The second tab makes a real save using the same workspace and different draft.
  const b=await context.newPage();
  b.on('pageerror',error=>errors.push(error.message));
  await b.goto(origin+'/'+topicRoute);
  await inTopics(b);
  assert.equal(await b.locator('[data-topics-search]').inputValue(),'');
  assert.equal(await heading(b,'审核归类建议').isVisible(),false);
  await startReview(b,[first]);
  await review(b);
  await saveReview(b,first,'窗口乙已确认');
  await button(a,'确认归类').click();
  await button(a,'重新生成建议').waitFor();
  assert.match(await a.locator('[data-topics-review]').innerText(),/变化|改变|冲突|更新|重新/);
  assert.equal(await topicInput(a,first).inputValue(),'窗口甲审阅后的主题');
  assert.equal(topicFor(first),'窗口乙已确认');
  assert.equal(topicFor(second),undefined);
  assert.deepEqual(originals(current()),before);
  console.log('PASS: 同账号双窗口冲突保留草稿，正式状态没有半写');

  await button(a,'重新生成建议').click();
  await review(a);
  assert.equal(await topicInput(a,first).inputValue(),'窗口甲审阅后的主题');
  await topicInput(a,first).fill('重新审核并确认');
  await topicInput(a,second).fill('重新审核并确认');
  const attempts=[];
  const upstreamFailures=[];
  await a.route('**'+topics+'/confirm',async route=>{
    const body=route.request().postDataJSON();
    attempts.push(body.draftId);
    if(attempts.length===2){
      const written=await route.fetch();
      if(written.status()!==200)upstreamFailures.push(written.status());
    }
    await route.abort('internetdisconnected');
  });
  await button(a,'确认归类').click();
  const retry=button(a,'查询并重试');
  await retry.waitFor();
  assert.equal(topicFor(first),'窗口乙已确认');
  assert.equal(topicFor(second),undefined);
  await retry.click();
  await eventually(()=>topicFor(first)==='重新审核并确认','恢复连接后未提交原批次。');
  await retry.waitFor();
  assert.deepEqual(upstreamFailures,[]);
  assert.equal(attempts.length,2);
  assert.equal(attempts[0],attempts[1]);
  const revision=current().revision;
  await retry.click();
  await heading(a,'审核归类建议').waitFor({state:'hidden'});
  assert.equal(current().revision,revision);
  assert.equal(attempts.length,2);
  assert.equal(topicFor(second),'重新审核并确认');
  assert.deepEqual(originals(current()),before);
  console.log('PASS: 请求断网后用同一批次重试，回包丢失后查回执且没有重复写入');

  // Both types open their original page. Closing another group is session UI state.
  await search.fill('');
  const otherGroup=a.locator('[data-topics-group]').filter({has:openCard(a,untouched)});
  await otherGroup.locator('summary').click();
  await eventually(()=>otherGroup.evaluate(group=>!group.open),'未归类组未折叠。');
  await openCard(a,second).click();
  await a.waitForURL(url=>decodeURIComponent(url.hash)==='#/block/'+second);
  await a.locator('[data-return-source]').click();
  await inTopics(a);
  assert.equal(await otherGroup.evaluate(group=>group.open),false);
  assert.deepEqual(originals(current()),before);
  console.log('PASS: 空间与自定义便笺同主题，打开便笺返回后恢复其他组的折叠');

  // Make a newer assignment in B and change original business data before A's
  // older batch is undone. A does not reload while B finishes the newer batch.
  await b.reload();
  await inTopics(b);
  assert.equal(await b.locator('[data-topics-search]').inputValue(),'');
  assert.equal(await heading(b,'审核归类建议').isVisible(),false);
  await startReview(b,[first]);
  await review(b);
  await saveReview(b,first,'后来另行调整');
  const latest=current();
  latest.state.spaces[0].notes[0].content='确认后继续编辑的笔记';
  latest.state.canvas.cards.find(card=>card.id===second).x+=40;
  app.store.saveWorkspace(latest.revision,latest.state);
  const edited=originals(current());
  await button(a,'撤销此批归类').click();
  await eventually(()=>topicFor(second)===undefined,'撤销未恢复仍属于原批次的卡片。');
  assert.equal(topicFor(first),'后来另行调整');
  const undone=current().state.workspaceTopics.receipts.find(row=>row.batchId===attempts[0]);
  assert.equal(undone.status,'undone');
  assert.deepEqual(undone.skipped,[first]);
  assert.deepEqual(originals(current()),edited);
  await a.reload();
  await inTopics(a);
  assert.equal(topicFor(first),'后来另行调整');
  assert.equal(topicFor(second),undefined);
  assert.deepEqual(errors,[]);
  console.log('PASS: 部分撤销保留后续归类、笔记和画布变更，刷新后正式结果仍在');
  await a.setViewportSize({width:390,height:844});
  const fits=()=>a.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth);
  await eventually(fits,'390 px 主题页面出现横向溢出。');
  await button(a,'返回画布').click();
  await a.waitForURL(url=>url.hash==='#/home');
  await button(a,'按主题查看').waitFor();
  await eventually(fits,'390 px 画布页面出现横向溢出。');
  assert.deepEqual(errors,[]);
  console.log('PASS: 390 px 下主题页与画布入口无整页横向溢出');
} catch(error) {
  if(a) console.error(JSON.stringify({url:a.url(),body:(await a.locator('body').innerText()).slice(0,500),errors}));
  throw error;
} finally {
  heldModel.resolve();
  await context?.close();
  await app?.close();
  const resolved=assertRuntimePath(await realpath(directory));
  assert.equal(resolved,directory);
  assert.match(basename(resolved),/^web-topics-browser-/);
  await rm(resolved,{recursive:true,force:true,maxRetries:3,retryDelay:150});
}
