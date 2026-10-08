import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createApp} from '../src/server.mjs';
import {RUNTIME_ROOT,COOKIE_NAME} from '../src/runtime.mjs';
import {createState,assetHash,validateState} from '../src/domain.mjs';

async function fixture(t,planner,extraOptions={}){
  mkdirSync(RUNTIME_ROOT,{recursive:true});
  const dataDir=mkdtempSync(resolve(RUNTIME_ROOT,'http-test-'));
  const options={port:4385,dataDir,setupCode:'synthetic-only-setup-code',...(planner?{planner}:{}),...extraOptions};
  let app=createApp(options);await app.listen();
  t.after(async()=>{await app.close();});
  let cookie='',csrf='';
  async function request(path,body,extra={}){
    const response=await fetch(app.runtime.origin+path,{method:body===undefined?'GET':'POST',headers:{Origin:app.runtime.origin,Connection:'close',...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json','X-CSRF-Token':csrf}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const set=response.headers.get('set-cookie');if(set)cookie=set.split(';')[0];
    const data=await response.json();if(data.csrfToken)csrf=data.csrfToken;
    return {status:response.status,data,headers:response.headers};
  }
  const setup=()=>request('/api/setup',{setupCode:options.setupCode,password:'synthetic-only-password-2026'});
  const state=async()=>(await request('/api/state')).data.state;
  const actions=async(list,overrides={})=>request('/api/actions',{baseRevision:(await state()).revision,requestId:randomUUID(),actions:list,...overrides});
  return {request,setup,state,actions,dataDir,get cookie(){return cookie;},async restart(){await app.close();app=createApp(options);await app.listen();}};
}
const createAction=name=>({op:'workspace.create',name,template:'blank'});

test('manual preview rejects uploads above 18 MiB without retaining state or proposals',async t=>{
  const f=await fixture(t);await f.setup();
  const before=await f.state(),historyBefore=(await f.request('/api/history')).data.history;
  const requestId=randomUUID(),body={baseRevision:before.revision,requestId,actions:[createAction('超限上传不应保存')],padding:'x'.repeat(18*1024*1024)};
  assert.ok(Buffer.byteLength(JSON.stringify(body))>18*1024*1024);
  const rejected=await f.request('/api/actions/preview',body);
  assert.equal(rejected.status,413);assert.equal(rejected.data.error.code,'request_limit');
  assert.deepEqual(await f.state(),before);assert.deepEqual((await f.request('/api/history')).data.history,historyBefore);
  // Reusing this ID with a small body must create a fresh proposal, proving the
  // rejected upload did not retain a hidden request/proposal fingerprint.
  const accepted=await f.request('/api/actions/preview',{baseRevision:before.revision,requestId,actions:[createAction('正常上传')]});
  assert.equal(accepted.status,200);assert.equal(accepted.data.replayed,undefined);
  await f.request('/api/proposals/cancel',{proposalId:accepted.data.proposal.id});
});

test('manual backup preview enforces the 8 MiB final-state ceiling before persisting a proposal',async t=>{
  const f=await fixture(t);await f.setup();
  const source=createState(),sourceWorkspaceId='synthetic-capacity-source';
  source.workspaces.push({id:sourceWorkspaceId,name:'容量边界合成空间',pages:[{id:'synthetic-capacity-page',name:'主页'}],preferences:{density:'comfortable',theme:'light'},timezone:'Asia/Shanghai',archived:false});
  for(let i=0;i<28;i++){
    const asset={id:'synthetic-capacity-asset-'+i,workspaceId:sourceWorkspaceId,title:'合成大资料'+i,text:'x'.repeat(300000),linkUrl:'',archived:false};
    asset.hash=assetHash(asset);source.assets.push(asset);
  }
  validateState(source);
  const backup={format:'chuang-universe-export',version:1,exportedAt:'2026-10-02T00:00:00.000Z',state:source};
  const before=await f.state(),historyBefore=(await f.request('/api/history')).data.history,requestId=randomUUID();
  const body={baseRevision:before.revision,requestId,actions:[{op:'backup.import',backup,sourceWorkspaceId}]};
  assert.ok(Buffer.byteLength(JSON.stringify(source))>8*1024*1024);
  assert.ok(Buffer.byteLength(JSON.stringify(body))<18*1024*1024);
  const rejected=await f.request('/api/actions/preview',body);
  assert.equal(rejected.status,413);assert.equal(rejected.data.error.code,'storage_limit');
  assert.deepEqual(await f.state(),before);assert.deepEqual((await f.request('/api/history')).data.history,historyBefore);
  const smaller=structuredClone(backup);smaller.state.assets.pop();
  assert.ok(Buffer.byteLength(JSON.stringify(smaller.state))<8*1024*1024);
  const accepted=await f.request('/api/actions/preview',{baseRevision:before.revision,requestId,actions:[{op:'backup.import',backup:smaller,sourceWorkspaceId}]});
  assert.equal(accepted.status,200,JSON.stringify(accepted.data.error));assert.equal(accepted.data.replayed,undefined);
  assert.ok(Buffer.byteLength(JSON.stringify(accepted.data.proposal.previewState))<8*1024*1024);
  assert.deepEqual(await f.state(),before);
  await f.request('/api/proposals/cancel',{proposalId:accepted.data.proposal.id});
  assert.deepEqual((await f.request('/api/history')).data.history,historyBefore);
});

test('full backup restores one workspace as a new copy with preserved content and clean credentials',async t=>{
  const f=await fixture(t);await f.setup();
  let made=await f.actions([{op:'workspace.create',name:'备份源',template:'study'}]);assert.equal(made.status,200);
  const source=made.data.state.workspaces[0],col=made.data.state.collections[0],note=made.data.state.components.find(c=>c.type==='text');
  const changed=await f.actions([{op:'component.update',id:note.id,patch:{props:{content:'完整备份必须保留这段笔记'}}},{op:'record.create',collectionId:col.id,values:{[col.semanticBindings.title]:'完整备份里的记录'}},{op:'asset.create',title:'备份文字资料',text:'合成内容'}],{workspaceId:source.id});assert.equal(changed.status,200);
  await f.request('/api/model',{model:'deepseek-flash',apiKey:'synthetic-backup-not-exported'});
  const backup=(await f.request('/api/export')).data;assert.ok(!JSON.stringify(backup).includes('synthetic-backup-not-exported'));
  await f.actions([createAction('保留的另一空间')]);const before=await f.state();
  const preview=await f.request('/api/actions/preview',{baseRevision:before.revision,requestId:randomUUID(),actions:[{op:'backup.import',backup,sourceWorkspaceId:source.id,name:'从备份恢复'}]});
  assert.equal(preview.status,200,JSON.stringify(preview.data.error));assert.deepEqual(await f.state(),before);
  const saved=await f.request('/api/proposals/confirm',{proposalId:preview.data.proposal.id});assert.equal(saved.status,200);
  const restored=saved.data.state.workspaces.find(w=>w.name==='从备份恢复');assert.ok(restored);assert.notEqual(restored.id,source.id);
  assert.equal(saved.data.state.records.length,2);assert.equal(saved.data.state.assets.length,2);
  assert.equal(saved.data.state.components.find(c=>c.workspaceId===restored.id&&c.type==='text').props.content,'完整备份必须保留这段笔记');
  assert.deepEqual(saved.data.state.workspaces.filter(w=>w.id!==restored.id),before.workspaces);
  assert.equal((await f.request('/api/model')).data.configured,true);
  const undone=await f.request('/api/undo',{receiptId:saved.data.receipt.id});assert.equal(undone.status,200);assert.deepEqual(undone.data.state.workspaces,before.workspaces);assert.equal(undone.data.state.records.length,1);
  const invalid={...backup,apiKey:'forbidden-top-level-data'};
  const rejected=await f.request('/api/actions/preview',{baseRevision:(await f.state()).revision,requestId:randomUUID(),actions:[{op:'backup.import',backup:invalid,sourceWorkspaceId:source.id}]});assert.equal(rejected.status,400);
});

test('manual template preview is non-mutating, idempotent, confirmable and cancellable',async t=>{
  const f=await fixture(t);await f.setup();
  const body={baseRevision:0,requestId:randomUUID(),actions:[{op:'workspace.create',name:'学习预览',template:'study'}]};
  const first=await f.request('/api/actions/preview',body);
  assert.equal(first.status,200);assert.equal(first.data.proposal.origin,'manual');assert.equal(first.data.proposal.measurement,null);
  assert.equal(first.data.proposal.previewState.components.length,4);assert.equal((await f.state()).revision,0);
  const retry=await f.request('/api/actions/preview',body);assert.equal(retry.data.proposal.id,first.data.proposal.id);assert.equal(retry.data.replayed,true);
  assert.equal((await f.request('/api/actions/preview',{...body,actions:[createAction('不同内容')]})).status,409);
  await f.request('/api/proposals/cancel',{proposalId:first.data.proposal.id});assert.equal((await f.state()).revision,0);
  const next=await f.request('/api/actions/preview',{...body,requestId:randomUUID()});
  const saved=await f.request('/api/proposals/confirm',{proposalId:next.data.proposal.id});
  assert.equal(saved.status,200);assert.equal(saved.data.state.workspaces.length,1);assert.equal(saved.data.receipt.origin,'manual');
});

test('connection check does not mutate workspaces, exposes no key, and resets on configuration change',async t=>{
  let calls=0;
  const f=await fixture(t,undefined,{modelChecker:async({config})=>{calls++;return {status:'passed',checkedAt:new Date().toISOString(),model:config.model,measurement:{executionMode:'offline_fixture',modelCalled:false,usage:null,cost:null}};}});await f.setup();
  assert.equal((await f.request('/api/model/test',{})).status,503);assert.equal(calls,0);
  await f.request('/api/model',{model:'deepseek-flash',apiKey:'synthetic-connection-only-key'});
  assert.equal((await f.request('/api/model')).data.connectionCheck,null);
  const before=await f.state(),checked=await f.request('/api/model/test',{});
  assert.equal(checked.status,200);assert.equal(checked.data.check.status,'passed');assert.equal(calls,1);assert.deepEqual(await f.state(),before);
  assert.ok(!JSON.stringify(checked.data).includes('synthetic-connection-only-key'));
  await f.request('/api/model',{model:'deepseek-v4-pro'});assert.equal((await f.request('/api/model')).data.connectionCheck,null);
});

test('a slow connection check cannot replace a newer model configuration',async t=>{
  let release,enter;const entered=new Promise(resolve=>{enter=resolve;});
  const f=await fixture(t,undefined,{modelChecker:async({config})=>{enter();await new Promise(resolve=>{release=resolve;});return {status:'passed',checkedAt:new Date().toISOString(),model:config.model,measurement:{executionMode:'offline_fixture',modelCalled:false}};}});await f.setup();
  await f.request('/api/model',{model:'deepseek-flash',apiKey:'synthetic-old-check-key'});
  const pending=f.request('/api/model/test',{});await entered;
  await f.request('/api/model',{model:'deepseek-v4-pro',apiKey:'synthetic-new-check-key'});release();
  assert.equal((await pending).data.error.code,'model_changed');
  const status=(await f.request('/api/model')).data;assert.equal(status.model,'deepseek-v4-pro');assert.equal(status.connectionCheck,null);
  assert.equal((await f.request('/api/ai/runs')).data.runs[0].status,'connection_failed');
});

test('auth/CSRF and foreign origins cannot write; setup is separate and closes',async t=>{
  const f=await fixture(t);
  assert.equal((await f.request('/api/state')).status,401);
  assert.equal((await f.request('/api/auth')).data.setupRequired,true);
  assert.equal((await f.request('/api/setup',{setupCode:'wrong',password:'long-enough-password'})).status,403);
  const setup=await f.setup();assert.equal(setup.status,200);assert.ok(f.cookie.startsWith(COOKIE_NAME+'='));
  assert.equal((await f.request('/api/setup',{setupCode:'synthetic-only-setup-code',password:'another-password'})).status,409);
  assert.equal((await f.request('/api/actions',{baseRevision:0,requestId:randomUUID(),actions:[createAction('No write')]},{'X-CSRF-Token':'wrong'})).status,403);
  assert.equal((await f.request('/api/state',undefined,{Origin:'http://127.0.0.1:4280'})).status,403);
  assert.equal((await f.state()).revision,0);
});

test('manual writes are atomic, idempotent and persisted without adopting other app configuration',async t=>{
  const f=await fixture(t);await f.setup();
  const body={baseRevision:0,requestId:randomUUID(),actions:[createAction('持久空间')]};
  const first=await f.request('/api/actions',body);assert.equal(first.status,200);
  assert.equal(first.data.state.workspaces.length,1);
  const again=await f.request('/api/actions',body);assert.equal(again.status,200);assert.equal(again.data.replayed,true);
  assert.equal((await f.state()).revision,1);
  assert.equal((await f.request('/api/actions',{...body,actions:[createAction('不同请求')]})).status,409);
  assert.equal((await f.actions([createAction('必须回滚'),{op:'not.registered'}])).status,400);
  assert.equal((await f.state()).workspaces.length,1);
  await f.restart();
  assert.equal((await f.state()).workspaces[0].name,'持久空间');
  assert.equal((await f.request('/api/model')).data.configured,false);
});

test('AI preview does not write, confirmation executes once, undo survives reload',async t=>{
  const f=await fixture(t,async()=>({actions:[createAction('AI工程空间')],message:'工程测试方案',measurement:{mode:'fixture'}}));await f.setup();
  const plan=await f.request('/api/ai/plan',{baseRevision:0,message:'建立空间'});
  assert.equal(plan.status,200,JSON.stringify(plan.data));assert.ok(plan.data.proposal.previewState);
  assert.ok((await f.request('/api/proposals/'+plan.data.proposal.id)).data.proposal.previewState);
  assert.equal((await f.state()).revision,0);
  const confirm=await f.request('/api/proposals/confirm',{proposalId:plan.data.proposal.id});
  assert.equal(confirm.status,200);assert.equal(confirm.data.state.workspaces.length,1);
  const repeat=await f.request('/api/proposals/confirm',{proposalId:plan.data.proposal.id});
  assert.equal(repeat.data.replayed,true);assert.equal((await f.state()).revision,1);
  await f.restart();
  const undo=await f.request('/api/undo',{receiptId:confirm.data.receipt.id});
  assert.equal(undo.status,200);assert.equal(undo.data.state.workspaces.length,0);
  assert.equal((await f.request('/api/undo',{receiptId:confirm.data.receipt.id})).data.replayed,true);
});

test('AI old proposals and in-flight plans cannot overwrite later manual edits',async t=>{
  let release;let entered;
  const started=new Promise(resolve=>{entered=resolve;});
  let slow=false;
  const f=await fixture(t,async()=>{
    if(slow){entered();await new Promise(resolve=>{release=resolve;});}
    return {actions:[createAction('旧方案')],message:'工程测试',measurement:{mode:'fixture'}};
  });
  await f.setup();
  const plan=await f.request('/api/ai/plan',{baseRevision:0,message:'建立空间'});
  await f.actions([createAction('先保存')]);
  assert.equal((await f.request('/api/proposals/confirm',{proposalId:plan.data.proposal.id})).status,409);
  assert.equal((await f.state()).workspaces.length,1);
  slow=true;
  const pending=f.request('/api/ai/plan',{baseRevision:1,message:'慢请求'});
  await started;await f.actions([createAction('思考期间保存')]);release();
  assert.equal((await pending).status,409);
  assert.equal((await f.state()).workspaces.length,2);
});

test('missing model makes no proposal; model secret absent from state/history/export',async t=>{
  const f=await fixture(t);await f.setup();
  const before=await f.state();
  const plan=await f.request('/api/ai/plan',{baseRevision:0,message:'建立一个空间'});
  assert.ok(plan.status>=400);assert.deepEqual(await f.state(),before);
  const saved=await f.request('/api/model',{model:'deepseek-flash',apiKey:'synthetic-not-a-real-key-12345'});
  assert.equal(saved.status,200);
  for(const endpoint of ['/api/state','/api/model','/api/history','/api/export']){
    const data=(await f.request(endpoint)).data;
    assert.ok(!JSON.stringify(data).includes('synthetic-not-a-real-key'));
  }
});

test('cancelled plan cannot execute, unknown POST endpoint is rejected',async t=>{
  const f=await fixture(t,async()=>({actions:[createAction('不要保存')],message:'fixture'}));await f.setup();
  const plan=await f.request('/api/ai/plan',{baseRevision:0,message:'创建'});
  assert.equal((await f.request('/api/proposals/cancel',{proposalId:plan.data.proposal.id})).status,200);
  assert.equal((await f.request('/api/proposals/confirm',{proposalId:plan.data.proposal.id})).status,409);
  assert.equal((await f.request('/api/workspace',{state:{}})).status,404);
  assert.equal((await f.state()).revision,0);
});

test('failed model metadata is retained without recording a successful state change',async t=>{
  const f=await fixture(t,async()=>{
    const error=new Error('工程模型失败');error.code='ai_test_failure';error.status=502;
    error.measurement={executionMode:'offline_fixture',modelCalled:false,latencyMs:12,usage:null};
    throw error;
  });
  await f.setup();
  const response=await f.request('/api/ai/plan',{baseRevision:0,message:'失败场景'});
  assert.equal(response.status,502);assert.equal(response.data.measurement.latencyMs,12);
  const runs=(await f.request('/api/ai/runs')).data.runs;
  assert.equal(runs.length,1);assert.equal(runs[0].status,'failed');
  assert.equal((await f.state()).revision,0);
});

test('pending plan capacity is checked before another model call',async t=>{
  let calls=0;
  const f=await fixture(t,async()=>{calls++;return {actions:[createAction('方案'+calls)],message:'fixture'};});await f.setup();
  let firstId;
  for(let i=0;i<30;i++){
    const response=await f.request('/api/ai/plan',{baseRevision:0,message:'创建'});
    assert.equal(response.status,200);firstId||=response.data.proposal.id;
  }
  assert.equal((await f.request('/api/ai/plan',{baseRevision:0,message:'不应计费'})).status,409);
  assert.equal(calls,30);
  await f.request('/api/proposals/cancel',{proposalId:firstId});
  assert.equal((await f.request('/api/ai/plan',{baseRevision:0,message:'恢复容量'})).status,200);
  assert.equal(calls,31);assert.equal((await f.state()).revision,0);
});
