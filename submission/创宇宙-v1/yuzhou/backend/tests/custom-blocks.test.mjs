import test from 'node:test';
import assert from 'node:assert/strict';
import {createCustomBlock,updateCustomBlock} from '../../frontend/src/custom-blocks-model.js';
import {workspaceFingerprint,workspaceOverview,runWorkspaceQuery,validateWorkspaceQueries,validateCustomBlockReadAccess} from '../workspace-queries.mjs';
import {validateWorkspace,createStore} from '../store.mjs';
import {buildPrompt,createHermesService} from '../hermes.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {assertRuntimePath} from '../../runtime.mjs';
const now='2026-10-09T10:00:00.000Z';
const state=()=>({schema:1,mode:'personal',profile:{name:'合成用户'},english:{},courses:[],spaces:[],tasks:[],captures:[],aiRequests:[],updatedAt:now});
function fixture(){const target=state();createCustomBlock(target,{kind:'miniapp',title:'合成小程序',config:{code:'/*'+ 'x'.repeat(10000)+'*/app.render([]);'},data:{count:1}},{id:'block:test',now});return target;}

test('server validation accepts the isolated block domain and rejects malformed code/data',()=>{
  const target=fixture(),serialized=validateWorkspace(target).serialized;assert.deepEqual(JSON.parse(serialized).customBlocks,target.customBlocks);
  for(const mutation of [record=>record.config.code='x'.repeat(30001),record=>record.kind='external-shell',record=>record.data={count:NaN},record=>record.config={code:'ok',url:'https://outside.invalid'}]){
    const bad=structuredClone(target);mutation(bad.customBlocks.items[0]);assert.throws(()=>validateWorkspace(bad));
  }
  const collision=fixture();collision.spaces.push({id:'block:test',title:'duplicate',notes:[],files:[]});assert.throws(()=>validateWorkspace(collision),error=>error.code==='duplicate_custom_block_id');
});

test('private miniapp JSON cannot become a host file reference and is not constrained by unrelated record IDs',()=>{
  const target=fixture();updateCustomBlock(target,'block:test',{data:{blobId:'an ordinary business value',rows:[{id:'tag',label:'one'},{id:'tag',label:'two'}]}});
  const checked=validateWorkspace(target);assert.equal(checked.blobs.size,0);assert.deepEqual(JSON.parse(checked.serialized).customBlocks.items[0].data,target.customBlocks.items[0].data);
  target.captures.push({id:'real-attachment',blobId:'host-file'});assert.equal(validateWorkspace(target).blobs.has('host-file'),true);
  const bad=fixture();bad.customBlocks.items.push(structuredClone(bad.customBlocks.items[0]));assert.throws(()=>validateWorkspace(bad),error=>error.code==='invalid_custom_blocks');
});

test('block content changes invalidate AI proposals while overview and search contain no program or private data',async()=>{
  const target=fixture(),before=structuredClone(target),hash=workspaceFingerprint(target),overview=workspaceOverview(target);
  assert.equal(overview.customBlockKinds.length,7);assert.deepEqual(overview.customBlocks,[{id:'block:test',kind:'miniapp',title:'合成小程序',archived:false}]);assert.equal(JSON.stringify(overview).includes('app.render'),false);
  const query=validateWorkspaceQueries([{kind:'search',entity:'customBlock'}])[0],result=await runWorkspaceQuery(target,query);
  assert.equal(result.items[0].id,'block:test');assert.equal(result.items[0].record.config,undefined);assert.equal(result.items[0].record.data,undefined);assert.deepEqual(target,before);
  updateCustomBlock(target,'block:test',{data:{count:2}});assert.notEqual(workspaceFingerprint(target),hash);
});

test('selected get provides complete long code without the generic 6000-character crop and does not mix other records',async()=>{
  const target=fixture();createCustomBlock(target,{kind:'note',title:'无关内容',config:{text:'unrelated-private-marker'}},{id:'block:other',now});
  const result=await runWorkspaceQuery(target,{kind:'get',entity:'customBlock',id:'block:test'});
  assert.equal(result.record.config.code,target.customBlocks.items[0].config.code);assert.equal(result.codeComplete,true);assert.equal(result.editable,true);assert.equal(JSON.stringify(result).includes('unrelated-private-marker'),false);
});

test('selected get clearly rejects oversized editing and marks secret-like private fields as redacted',async()=>{
  const target=fixture();updateCustomBlock(target,'block:test',{config:{code:'x'.repeat(30000)},data:{text:'d'.repeat(60000)}});
  const oversized=await runWorkspaceQuery(target,{kind:'get',entity:'customBlock',id:'block:test'});assert.equal(oversized.truncated,true);assert.equal(oversized.editable,false);assert.equal(oversized.record,undefined);
  updateCustomBlock(target,'block:test',{data:{count:1,nested:{apiKey:'private-marker',password:'private-marker'}}});
  const redacted=await runWorkspaceQuery(target,{kind:'get',entity:'customBlock',id:'block:test'});assert.equal(redacted.redacted,true);assert.equal(redacted.editable,false);assert.equal(JSON.stringify(redacted).includes('private-marker'),false);
});

test('AI may replace configuration or data only after an untruncated selected read from this turn',async()=>{
  const query={kind:'get',entity:'customBlock',id:'block:test'},result=await runWorkspaceQuery(fixture(),query),actions=[{entity:'customBlock',operation:'update',id:'block:test',data:{config:{code:'app.render([]);'}}}];
  assert.doesNotThrow(()=>validateCustomBlockReadAccess(actions,[{query,result}]));
  for(const reads of [[],[{query:{...query,id:'block:other'},result}],[{query,result:{...result,truncated:true}}],[{query,result:{...result,redacted:true}}],[{query,result:{error:'capacity'}}]])assert.throws(()=>validateCustomBlockReadAccess(actions,reads));
  assert.doesNotThrow(()=>validateCustomBlockReadAccess([{...actions[0],data:{title:'改名'}}],[]));
});

test('AI prompt advertises isolated miniapp API without authorizing DOM, network or hidden-state access',()=>{
  const prompt=buildPrompt({text:'创建一个计算工具',sources:[],destinations:[],destinationId:'workspace',kind:'conversation'}),data=JSON.parse(prompt.user);
  const capability=data.workspaceActionCapabilities.find(item=>item.entity==='customBlock');assert.ok(capability);assert.ok(capability.operations.includes('create'));
  for(const phrase of ['app.getData','app.setData','app.render','app.onEvent','隔离Worker','本轮get完整查询'])assert.ok(prompt.system.includes(phrase));
  assert.match(prompt.system,/创建\/修改程序必须先展示可审核行动单/);
});

function temporary(){assertRuntimePath(tmpdir());return mkdtempSync(join(tmpdir(),'czb-custom-blocks-'));}
function removeTemporary(directory){const path=resolve(directory);assertRuntimePath(path);assert.ok(path.startsWith(resolve(join(tmpdir(),'czb-custom-blocks-'))));rmSync(path,{recursive:true,force:true});}

test('SQLite restart retains program and private data and rejects a legacy client dropping the domain',t=>{
  const directory=temporary();let store=createStore(directory);t.after(()=>{store.close();removeTemporary(directory);});
  store.saveWorkspace(0,fixture());store.close();store=createStore(directory);const before=store.getWorkspace();
  assert.equal(before.state.customBlocks.items[0].data.count,1);assert.ok(before.state.customBlocks.items[0].config.code.length>6000);
  const old=structuredClone(before.state);delete old.customBlocks;assert.throws(()=>store.saveWorkspace(before.revision,old),error=>error.status===409&&error.code==='workspace_update_required');assert.deepEqual(store.getWorkspace(),before);
});

function modelFixture(t,{update=false,skipRead=false}={}){
  const directory=temporary();let current=update?fixture():state(),revision=1,calls=0;
  const store={getWorkspace:()=>({state:structuredClone(current),revision}),saveWorkspace:(base,next)=>{assert.equal(base,revision);validateWorkspace(next);current=structuredClone(next);return {revision:++revision};},fileInfo:()=>null,filePath:id=>join(directory,id)};
  const service=createHermesService({dataDir:directory,store,engineAvailable:()=>true,runModel:async()=>{
    calls++;
    if(update&&!skipRead&&calls===1)return {reply:'先读取这个方块。',proposal:null,queries:[{kind:'get',entity:'customBlock',id:'block:test'}]};
    const data={config:{code:'app.render([{type:"button",id:"count",label:"计数"}]);app.onEvent=async()=>{await app.setData({count:(app.getData().count||0)+1});};'}};
    return {reply:'请审核后确认。',proposal:{title:'合成小程序',summary:'隔离执行的本地计数工具',destinationId:'workspace',reason:'用户要求',warnings:[],actions:[update?{entity:'customBlock',operation:'update',id:'block:test',data}:{entity:'customBlock',operation:'create',data:{...data,kind:'miniapp',title:'计数器',data:{count:0}}}]}};
  }});
  t.after(async()=>{await service.close();removeTemporary(directory);});
  async function call(method,path,body){let response;assert.equal(await service.handle({method},{},{url:new URL(path,'https://localhost'),readJson:async()=>body,json:(_res,status,value)=>{response={status,body:structuredClone(value)};}}),true);return response;}
  async function ready(){
    await call('PUT','/api/model/config',{provider:'deepseek',model:'deepseek-flash',apiKey:'offline-synthetic-no-network'});
    const text=update?'更新这个方块的计数工具，保留我的数据。':'建立计数工具，先给我审核。';
    current.aiRequests.push({id:'synthetic',text,targetId:'auto',files:[],status:'waiting_model',createdAt:now,updatedAt:now,conversation:{version:1,messages:[{id:'turn-1',role:'user',text,createdAt:now}]}});revision++;
    const start=await call('POST','/api/ai/jobs',{requestId:'synthetic',turnId:'turn-1',text,kind:'conversation'});assert.equal(start.status,202);
    for(let n=0;n<200;n++){const reply=await call('GET',`/api/ai/jobs/${start.body.job.id}`);if(['succeeded','failed'].includes(reply.body.job.status))return reply.body.job;await new Promise(resolve=>setTimeout(resolve,3));}assert.fail('synthetic block job timed out');
  }
  return {call,ready,current:()=>current,change:fn=>{fn(current);revision++;},calls:()=>calls};
}

test('synthetic AI code remains unapplied before confirmation; confirmation creates once and preserves its receipt',async t=>{
  const f=modelFixture(t),job=await f.ready();assert.equal(job.status,'succeeded',JSON.stringify(job.error));assert.equal(f.current().customBlocks,undefined);
  const first=await f.call('POST',`/api/ai/jobs/${job.id}/confirm`,{});assert.equal(first.status,200);assert.equal(f.current().customBlocks.items.length,1);assert.equal(f.current().customBlocks.items[0].data.count,0);
  const second=await f.call('POST',`/api/ai/jobs/${job.id}/confirm`,{});assert.equal(second.status,200);assert.deepEqual(second.body.receipt,first.body.receipt);assert.equal(f.current().customBlocks.items.length,1);assert.equal(f.calls(),1);
});

test('an AI program update queries complete content, preserves private data, and conflicts with later user data edits',async t=>{
  const f=modelFixture(t,{update:true}),original=f.current().customBlocks.items[0].config.code,job=await f.ready();assert.equal(job.status,'succeeded',JSON.stringify(job.error));assert.equal(f.current().customBlocks.items[0].config.code,original);
  const confirmed=await f.call('POST',`/api/ai/jobs/${job.id}/confirm`,{});assert.equal(confirmed.status,200);assert.equal(f.current().customBlocks.items[0].data.count,1);assert.notEqual(f.current().customBlocks.items[0].config.code,original);assert.equal(f.calls(),2);
  const conflict=modelFixture(t,{update:true}),pending=await conflict.ready();assert.equal(pending.status,'succeeded');conflict.change(target=>updateCustomBlock(target,'block:test',{data:{count:99}}));
  const rejected=await conflict.call('POST',`/api/ai/jobs/${pending.id}/confirm`,{});assert.equal(rejected.status,409);assert.equal(rejected.body.error,'STALE_PROPOSAL');assert.equal(conflict.current().customBlocks.items[0].data.count,99);
});

test('the model worker rejects replacing code without a complete current-turn read even after format repair',async t=>{
  const f=modelFixture(t,{update:true,skipRead:true}),before=structuredClone(f.current().customBlocks),job=await f.ready();assert.equal(job.status,'failed');assert.deepEqual(f.current().customBlocks,before);assert.equal(f.calls(),2);
});
