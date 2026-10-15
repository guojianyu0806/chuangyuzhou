// Real HTTP/auth and SQLite persistence; the provider is always an offline fixture.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createWorkbenchServer} from '../server.mjs';
import {createHermesService} from '../hermes.mjs';

const STAMP='2026-09-21T04:00:00.000Z';
const baseState=()=>({schema:1,mode:'personal',profile:{name:'测试同学',major:'软件工程',provider:'deepseek'},courses:[],spaces:[],tasks:[],captures:[],english:{},calendar:{version:1,events:[]},ledger:{version:1,currency:'CNY',projects:[],entries:[]},aiRequests:[],aiDraft:{text:'',files:[],targetId:'auto'},updatedAt:STAMP});
const plan=actions=>({title:'工作台行动',summary:'按用户要求修改，等待审核。',destinationId:'workspace',reason:'本次用户明确要求。',warnings:[],actions});
const create=(entity,data,extra={})=>({entity,operation:'create',data,...extra});

async function fixture(t,runModel){
  const directory=await mkdtemp(join(tmpdir(),'universe-workspace-ai-'));
  const modelErrors=[];
  const app=await createWorkbenchServer({dataDir:directory,secureCookie:false,setupToken:'offline-workspace-setup',modelFactory:({dataDir,store})=>createHermesService({dataDir,store,engineAvailable:()=>true,runModel:async input=>{try{return await runModel(input);}catch(error){modelErrors.push(error);throw error;}}})});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${app.server.address().port}`;
  let cookie='',csrf='';
  async function api(path,{method='GET',body,auth=true,omitCsrf=false}={}){
    const response=await fetch(origin+path,{method,headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(auth&&cookie?{Cookie:cookie,...(omitCsrf?{}:{'X-CSRF-Token':csrf})}:{}),...(['POST','PUT','DELETE','PATCH'].includes(method)?{Origin:origin}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const setCookie=response.headers.get('set-cookie');if(setCookie)cookie=setCookie.split(';')[0];
    const value=await response.json();if(value.csrfToken)csrf=value.csrfToken;
    return {status:response.status,body:value};
  }
  t.after(async()=>{await app.close();assert.ok(directory.startsWith(join(tmpdir(),'universe-workspace-ai-')));await rm(directory,{recursive:true,force:true});});
  assert.equal((await api('/api/auth/setup',{method:'POST',body:{username:'test-workspace',password:'offline-test-password-only-2026',setupToken:'offline-workspace-setup'}})).status,201);
  assert.equal((await api('/api/model/config',{method:'PUT',body:{provider:'deepseek',model:'deepseek-flash',apiKey:'offline-test-key-no-provider-call'}})).status,200);
  app.store.saveWorkspace(0,baseState());
  const state=()=>app.store.getWorkspace().state;
  function change(fn){const current=app.store.getWorkspace();fn(current.state);app.store.saveWorkspace(current.revision,current.state);}
  function conversation(text,{targetId='auto',mutate}={}){
    const requestId=`test-request-${state().aiRequests.length+1}`,turnId=`${requestId}-turn`;
    change(state=>{mutate?.(state);state.aiRequests.push({id:requestId,text,targetId,files:[],status:'waiting_model',createdAt:STAMP,updatedAt:STAMP,conversation:{version:1,messages:[{id:turnId,role:'user',text,createdAt:STAMP}]}});});
    return {requestId,turnId,text,destinationId:targetId,kind:'conversation'};
  }
  async function start(input){const result=await api('/api/ai/jobs',{method:'POST',body:input});assert.equal(result.status,202,JSON.stringify(result.body));return result.body.job;}
  async function finish(job){
    for(let count=0;count<160;count++){
      const result=await api(`/api/ai/jobs/${job.id}`),value=result.body.job;
      if(['succeeded','failed'].includes(value.status)){if(modelErrors.length)throw modelErrors[0];return value;}
      await new Promise(resolve=>setTimeout(resolve,5));
    }
    assert.fail('Fixture AI job did not finish');
  }
  const confirm=job=>api(`/api/ai/jobs/${job.id}/confirm`,{method:'POST',body:{}});
  return {app,api,state,change,conversation,start,finish,confirm};
}

test('authenticated AI searches and computes, reviews linked project/entry, then confirms exactly once in SQLite',async t=>{
  let calls=0;
  const f=await fixture(t,async input=>{
    const data=JSON.parse(input.user);calls++;
    assert.ok(data.workspaceActionCapabilities.some(row=>row.entity==='ledgerProject'));
    assert.ok(data.workspaceQueryCapabilities.some(row=>row.kind==='ledger.summary'));
    if(calls===1){assert.equal(data.workspaceQueryResults.length,0);return {reply:'先查看是否已有国庆项目。',proposal:null,queries:[{kind:'search',entity:'ledgerProject',text:'国庆'}]};}
    if(calls===2){assert.equal(data.workspaceQueryResults[0].result.total,0);return {reply:'再核对目前的日常收支。',proposal:null,queries:[{kind:'ledger.summary',scope:'daily'}]};}
    assert.equal(data.workspaceQueryResults.length,2);
    assert.equal(data.workspaceQueryResults[1].result.totals.expenseCents,0);
    return {reply:'尚未入账。请审核独立项目及早餐账目，再点击确认执行。',proposal:plan([
      create('ledgerProject',{title:'国庆出游',includeInTotal:false},{ref:'trip'}),
      create('ledgerEntry',{type:'expense',amount:'18.50',date:'2026-10-01',category:'餐饮',note:'早餐',projectId:'$trip'}),
    ])};
  });
  const input=f.conversation('如果还没有就创建国庆出游独立项目，不计入总账，并把2026-10-01早餐18.50元记入；先查现有项目与日常开销。');
  const job=await f.start({...input,autoFile:true}),ready=await f.finish(job);
  assert.equal(ready.status,'succeeded',JSON.stringify(ready.error));assert.equal(ready.replySaved,true);assert.equal(ready.queryRounds,2);assert.equal(calls,3);
  assert.equal(f.state().ledger.projects.length,0);assert.equal(f.state().ledger.entries.length,0);
  assert.equal(f.state().aiRequests[0].conversation.pendingJobId,ready.id);
  const confirmed=await f.confirm(ready);assert.equal(confirmed.status,200,JSON.stringify(confirmed.body));
  const saved=f.state();assert.equal(saved.ledger.projects.length,1);assert.equal(saved.ledger.projects[0].includeInTotal,false);assert.equal(saved.ledger.entries[0].projectId,saved.ledger.projects[0].id);assert.equal(saved.ledger.entries[0].amountCents,1850);assert.equal(saved.aiRequests[0].status,'filed');
  const duplicate=await f.confirm(ready);assert.deepEqual(duplicate.body.receipt,confirmed.body.receipt);assert.equal(f.state().ledger.entries.length,1);assert.equal(calls,3);
  const secondDevice=(await f.api('/api/workspace')).body.state;assert.equal(secondDevice.ledger.entries[0].amountCents,1850);
});

test('existing task update and a calendar event stay a single reviewed transaction',async t=>{
  let calls=0;
  const f=await fixture(t,async input=>{
    const data=JSON.parse(input.user);
    if(++calls===1)return {reply:'先核对待办。',proposal:null,queries:[{kind:'search',entity:'task',text:'学生会'}]};
    const row=data.workspaceQueryResults[0].result.items[0];assert.equal(row.id,'student-union-task');
    return {reply:'把待办安排到9月25日，并新增日历提醒，等待确认。',proposal:plan([
      {entity:'task',operation:'update',id:row.id,data:{date:'2026-09-25',priority:'high'}},
      create('calendarEvent',{title:'学生会活动',kind:'plan',startDate:'2026-09-25',notes:'带会议材料',important:true}),
    ])};
  });
  const input=f.conversation('把学生会待办安排到2026-09-25，标重要，再单独添加日历会议。',{mutate:state=>state.tasks.push({id:'student-union-task',title:'学生会活动',description:'原备注保留',category:'学生会',date:'',priority:'normal',done:false,archived:false,source:'手动',createdAt:STAMP})});
  const ready=await f.finish(await f.start(input));assert.equal(ready.status,'succeeded',JSON.stringify(ready.error));assert.equal(f.state().tasks[0].date,'');assert.equal(f.state().calendar.events.length,0);
  assert.equal((await f.confirm(ready)).status,200);assert.equal(f.state().tasks.length,1);assert.equal(f.state().tasks[0].description,'原备注保留');assert.equal(f.state().tasks[0].priority,'high');assert.equal(f.state().calendar.events[0].startDate,'2026-09-25');assert.equal(f.state().timetable,undefined);
});

test('course preferences and actual existing record IDs reach the model before reviewed prompt/note changes',async t=>{
  let calls=0;
  const f=await fixture(t,async input=>{
    const data=JSON.parse(input.user);assert.equal(data.coursePreferences,'先用代码例子，再总结易错点。');assert.match(input.system,/助教偏好.*不可信数据|不可信数据/);
    if(++calls===1)return {reply:'读取课程设置。',proposal:null,queries:[{kind:'get',entity:'course',id:'course-software'}]};
    assert.equal(data.workspaceQueryResults[0].result.record.prompt,'先用代码例子，再总结易错点。');
    return {reply:'会更新课程助教偏好并保存这条示例笔记，确认后执行。',proposal:{...plan([
      {entity:'course',operation:'update',id:'course-software',data:{prompt:'先问题再例子，最后补复习题。'}},
      create('note',{title:'今天的讨论',content:'用户要求的问题—例子—复习结构。'},{containerId:'course:course-software'}),
    ]),destinationId:'course:course-software'}};
  });
  const input=f.conversation('课程助教改为先问题再例子，最后复习题，并保存今天讨论。',{targetId:'course:course-software',mutate:state=>state.courses.push({id:'course-software',title:'软件工程',subtitle:'本学期',icon:'book',color:'#AE88FF',prompt:'先用代码例子，再总结易错点。',notes:[],files:[],example:false,updatedAt:STAMP})});
  const ready=await f.finish(await f.start(input));assert.equal(ready.status,'succeeded',JSON.stringify(ready.error));assert.equal(f.state().courses[0].notes.length,0);
  assert.equal((await f.confirm(ready)).status,200);assert.equal(f.state().courses[0].prompt,'先问题再例子，最后补复习题。');assert.equal(f.state().courses[0].notes.length,1);
});

test('three query rounds are bounded and the fourth request becomes a no-write clarification',async t=>{
  let calls=0;
  const f=await fixture(t,async()=>{calls++;return {reply:'继续查询',proposal:null,queries:[{kind:'search',entity:'task'}]};});
  const input=f.conversation('先看看待办'),ready=await f.finish(await f.start(input));
  assert.equal(ready.status,'succeeded');assert.equal(ready.proposal,null);assert.equal(ready.queryRounds,3);assert.equal(calls,4);assert.match(ready.reply,/三次|缩小/);assert.equal(f.state().tasks.length,0);
  assert.equal((await f.confirm(ready)).status,409);
});

test('arbitrary query paths and mixed query/action output fail after one bounded format correction',async t=>{
  for(const mixed of [false,true]){
    let calls=0;
    const f=await fixture(t,async()=>{calls++;return mixed?{reply:'混合请求',proposal:plan([create('task',{title:'不应写入'})]),queries:[{kind:'search',entity:'task'}]}:{reply:'试图读取路径',proposal:null,queries:[{kind:'file.read',blobId:'file-id',path:'/etc/passwd'}]};});
    const ready=await f.finish(await f.start(f.conversation('查询已有资料')));
    assert.equal(ready.status,'failed');assert.equal(ready.error.code,'INVALID_PROPOSAL');assert.equal(calls,2);assert.equal(f.state().tasks.length,0);assert.equal(f.state().aiRequests[0].conversation.messages.length,1);assert.equal(f.state().aiRequests[0].status,'waiting_model');
  }
});

test('domain changes after review make confirmation stale without overwriting another device',async t=>{
  const f=await fixture(t,async()=>({reply:'请审核这条新日历。',proposal:plan([create('calendarEvent',{title:'会议',startDate:'2026-09-25'})])}));
  const ready=await f.finish(await f.start(f.conversation('2026-09-25添加会议')));assert.equal(ready.status,'succeeded');
  f.change(state=>state.profile.name='另一台设备改的称呼');
  const stale=await f.confirm(ready);assert.equal(stale.status,409);assert.equal(stale.body.error,'STALE_PROPOSAL');assert.equal(f.state().calendar.events.length,0);assert.equal(f.state().profile.name,'另一台设备改的称呼');
});

test('domain changes during inference prevent an outdated action plan from becoming confirmable',async t=>{
  let release;const gate=new Promise(resolve=>release=resolve);
  const f=await fixture(t,async()=>{await gate;return {reply:'旧工作台方案',proposal:plan([create('calendarEvent',{title:'会议',startDate:'2026-09-25'})])};});
  const started=await f.start(f.conversation('2026-09-25添加会议'));
  f.change(state=>state.profile.major='另一台设备改的专业');release();
  const ready=await f.finish(started);assert.equal(ready.status,'succeeded');assert.equal(ready.replySaved,false);assert.match(ready.replyError,/资料已变化/);assert.equal(f.state().aiRequests[0].conversation.messages.length,1);assert.equal((await f.confirm(ready)).status,409);assert.equal(f.state().calendar.events.length,0);
});

test('a discarded conversation result can retry the same turn against current data without duplicating execution',async t=>{
  let releaseFirst,releaseRetry,calls=0;
  const firstGate=new Promise(resolve=>releaseFirst=resolve),retryGate=new Promise(resolve=>releaseRetry=resolve);
  t.after(()=>{releaseFirst();releaseRetry();});
  const f=await fixture(t,async()=>{
    const attempt=++calls;await(attempt===1?firstGate:retryGate);
    return {reply:'请审核本次方案。',proposal:plan([create('task',{title:attempt===1?'已过期的方案':'重新核对后的方案'})])};
  });
  const input=f.conversation('请新建一条测试待办，先给我审核。'),first=await f.start(input);
  f.change(state=>state.profile.major='推理期间保存的新关注领域');releaseFirst();
  const discarded=await f.finish(first);
  assert.equal(discarded.replySaved,false);assert.equal(f.state().tasks.length,0);
  const retry=await f.start(input);
  assert.notEqual(retry.id,first.id);
  const duplicate=await f.api('/api/ai/jobs',{method:'POST',body:input});
  assert.equal(duplicate.status,200);assert.equal(duplicate.body.job.id,retry.id);assert.equal(calls,2);
  releaseRetry();const reviewed=await f.finish(retry);
  assert.equal(reviewed.replySaved,true);assert.equal(f.state().tasks.length,0);
  assert.equal(f.state().profile.major,'推理期间保存的新关注领域');
  assert.equal(f.state().aiRequests[0].conversation.pendingJobId,retry.id);
  assert.equal((await f.confirm(discarded)).status,409);
  const confirmed=await f.confirm(reviewed);assert.equal(confirmed.status,200);
  assert.deepEqual(f.state().tasks.map(task=>task.title),['重新核对后的方案']);
  const repeated=await f.confirm(reviewed);assert.equal(repeated.status,200);assert.deepEqual(repeated.body.receipt,confirmed.body.receipt);
  assert.equal(f.state().tasks.length,1);assert.equal(calls,2);
});

test('unsent composer draft changes alone do not invalidate an already reviewed action',async t=>{
  const f=await fixture(t,async()=>({reply:'等待确认',proposal:plan([create('task',{title:'已审核待办'})])}));
  const ready=await f.finish(await f.start(f.conversation('添加已审核待办')));
  f.change(state=>state.aiDraft.text='另一个尚未发送的想法');
  assert.equal((await f.confirm(ready)).status,200);assert.equal(f.state().tasks.length,1);assert.equal(f.state().aiDraft.text,'另一个尚未发送的想法');
});

test('capabilities, queries and confirmation remain behind server authentication and CSRF',async t=>{
  let calls=0;
  const f=await fixture(t,async()=>{calls++;return {reply:'无需修改',proposal:null};});
  for(const path of ['/api/ai/capabilities','/api/ai/jobs','/api/workspace'])assert.equal((await f.api(path,{auth:false})).status,401);
  const input=f.conversation('查询资料');
  assert.equal((await f.api('/api/ai/jobs',{method:'POST',body:input,auth:false})).status,401);
  assert.equal((await f.api('/api/ai/jobs',{method:'POST',body:input,omitCsrf:true})).status,403);
  assert.equal(calls,0);const capabilities=await f.api('/api/ai/capabilities');assert.equal(capabilities.status,200);assert.ok(capabilities.body.capabilities.some(row=>row.entity==='calendarEvent'));assert.ok(capabilities.body.queries.some(row=>row.kind==='search'));assert.equal(JSON.stringify(capabilities).includes('offline-test-key'),false);
});
