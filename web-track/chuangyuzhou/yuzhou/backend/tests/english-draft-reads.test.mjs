import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {assertRuntimePath} from '../../runtime.mjs';
import {runWorkspaceQuery,workspaceFingerprint,validateEnglishDraftReadAccess} from '../workspace-queries.mjs';
import {buildPrompt,createHermesService} from '../hermes.mjs';
import {validateWorkspace} from '../store.mjs';

const NOW='2026-10-09T12:00:00.000Z',ID='writing:appointment-email';
const query={kind:'get',entity:'englishDraft',id:ID};
const action=(id=ID)=>({entity:'englishDraft',operation:'update',id,data:{content:'Reviewed appointment draft.'}});
function state(content='Saved appointment draft.'){
  return {schema:1,mode:'personal',profile:{name:'合成用户'},spaces:[],courses:[],tasks:[],captures:[],aiRequests:[],updatedAt:NOW,
    english:{drafts:{writing:'Legacy essay.',translation:'',listening:''},draftExercises:{writing:{'appointment-email':{text:content,updatedAt:NOW}}}}};
}

test('English get preserves the entire selected draft beyond the former 6000-character crop without changing state',async()=>{
  const current=state('A'.repeat(19990)+'TAIL'),before=structuredClone(current),hash=workspaceFingerprint(current);
  const result=await runWorkspaceQuery(current,query);
  assert.equal(result.record.content,current.english.draftExercises.writing['appointment-email'].text);
  assert.equal(result.contentComplete,true);assert.equal(result.editable,true);assert.equal(result.truncated,undefined);
  assert.equal(JSON.stringify(result).includes('Legacy essay.'),false);assert.ok(JSON.stringify(result).length<=36000);
  assert.deepEqual(current,before);assert.equal(workspaceFingerprint(current),hash);
});

test('English get rejects oversized text or escaped JSON without supplying an editable excerpt',async()=>{
  for(const content of ['A'.repeat(20001),'\u0001'.repeat(6000)]){
    const current=state(content),result=await runWorkspaceQuery(current,query);
    assert.equal(result.truncated,true);assert.equal(result.contentComplete,false);assert.equal(result.editable,false);
    assert.equal(result.record,undefined);assert.match(result.notice,/分段讨论/);
    assert.throws(()=>validateEnglishDraftReadAccess([action()],[{query,result}]),/不能整稿替换/);
    assert.equal(current.english.draftExercises.writing['appointment-email'].text,content);
  }
  const boundary=await runWorkspaceQuery(state('A'.repeat(20000)),query);
  assert.equal(boundary.editable,true);assert.equal(boundary.record.content.length,20000);
});

test('draft replacement requires an exact current-turn complete get, not a search result or another exercise',async()=>{
  const current=state(),result=await runWorkspaceQuery(current,query),searchQuery={kind:'search',entity:'englishDraft',text:'预约'},search=await runWorkspaceQuery(current,searchQuery);
  const blocked=[[],[{query:searchQuery,result:search}],[{query:{...query,id:'writing'},result}],
    [{query,result:{...result,id:'writing'}}],[{query,result:{...result,truncated:true}}],
    [{query,result:{...result,contentComplete:false}}],[{query,result:{...result,editable:false}}],
    [{query,result:{error:'capacity exceeded'}}],
    [{query,result},{query,result:{error:'latest read failed'}}]];
  for(const reads of blocked)assert.throws(()=>validateEnglishDraftReadAccess([action()],reads),/本轮完整 get/);
  assert.doesNotThrow(()=>validateEnglishDraftReadAccess([action()],[{query,result}]));
  assert.throws(()=>validateEnglishDraftReadAccess([action(),action('translation:changing-plans')],[{query,result}]));
  assert.doesNotThrow(()=>validateEnglishDraftReadAccess([{entity:'task',operation:'update',id:'task-1',data:{title:'Retain existing behavior'}}],[]));
});

test('complete gets authorize saved and empty legacy/new draft slots without initializing missing slots',async()=>{
  const current=state(),before=structuredClone(current);
  for(const id of ['writing','translation','listening',ID,'writing:study-invitation','translation:changing-plans']){
    const selected={...query,id},result=await runWorkspaceQuery(current,selected);
    assert.equal(result.contentComplete,true);assert.equal(result.editable,true);
    assert.doesNotThrow(()=>validateEnglishDraftReadAccess([action(id)],[{query:selected,result}]));
  }
  assert.deepEqual(current,before);
});

test('model instructions expose complete draft lookup limits and forbid replacing drafts from excerpts',()=>{
  const prompt=buildPrompt({text:'一起修改预约邮件',sources:[],destinations:[],destinationId:'english',kind:'conversation'});
  assert.match(prompt.system,/修改englishDraft前必须在本轮get完整读取该确切题目/);
  assert.match(prompt.system,/搜索摘要不能代替全文/);
  const get=JSON.parse(prompt.user).workspaceQueryCapabilities.find(row=>row.kind==='get');
  assert.match(get.description,/20000/);assert.match(get.description,/36000/);
});

function modelFixture(t,{read='complete',content='A'.repeat(6500)+'TAIL'}={}){
  assertRuntimePath(tmpdir());const directory=mkdtempSync(join(tmpdir(),'czb-english-draft-read-'));
  let current=state(content),revision=1,calls=0;const contexts=[];
  const store={getWorkspace:()=>({state:structuredClone(current),revision}),saveWorkspace:(base,next)=>{assert.equal(base,revision);validateWorkspace(next);current=structuredClone(next);return {revision:++revision};},fileInfo:()=>null,filePath:id=>join(directory,id)};
  const service=createHermesService({dataDir:directory,store,engineAvailable:()=>true,runModel:async input=>{
    calls++;const context=JSON.parse(input.user);contexts.push(context);
    if(calls===1&&read!=='none')return {reply:'先查找这道题。',proposal:null,queries:[read==='complete'?{kind:'search',entity:'englishDraft',text:'预约'}:read==='search'?{kind:'search',entity:'englishDraft'}:read==='other'?{...query,id:'writing'}:query]};
    if(calls===2&&read==='complete')return {reply:'现在读取本题全文。',proposal:null,queries:[query]};
    return {reply:'请审核修改后确认。',proposal:{title:'修改预约邮件',summary:'只修改本题草稿',destinationId:'english',reason:'用户要求修改这道题',warnings:[],actions:[action()]}};
  }});
  t.after(async()=>{await service.close();const target=resolve(directory);assertRuntimePath(target);assert.ok(target.startsWith(resolve(join(tmpdir(),'czb-english-draft-read-'))));rmSync(target,{recursive:true,force:true});});
  async function call(method,path,body){let response;assert.equal(await service.handle({method},{},{url:new URL(path,'https://localhost'),readJson:async()=>body,json:(_res,status,value)=>{response={status,body:structuredClone(value)};}}),true);return response;}
  async function ready(){
    await call('PUT','/api/model/config',{provider:'deepseek',model:'deepseek-flash',apiKey:'offline-synthetic-no-network'});
    const text='请读取预约邮件草稿并提议修改，等我审核确认再保存。';
    current.aiRequests.push({id:'synthetic-draft',text,targetId:'english',files:[],status:'waiting_model',createdAt:NOW,updatedAt:NOW,conversation:{version:1,messages:[{id:'turn-1',role:'user',text,createdAt:NOW}]}});revision++;
    const start=await call('POST','/api/ai/jobs',{requestId:'synthetic-draft',turnId:'turn-1',text,destinationId:'english',kind:'conversation'});assert.equal(start.status,202,JSON.stringify(start.body));
    for(let n=0;n<200;n++){const reply=await call('GET',`/api/ai/jobs/${start.body.job.id}`);if(['succeeded','failed'].includes(reply.body.job.status))return reply.body.job;await new Promise(resolve=>setTimeout(resolve,3));}assert.fail('synthetic English draft job timed out');
  }
  return {call,ready,contexts,current:()=>current,change:fn=>{fn(current);revision++;},calls:()=>calls};
}

test('model query loop sees the complete selected draft; confirmation writes only that slot and is idempotent',async t=>{
  const f=modelFixture(t),before=structuredClone(f.current().english),job=await f.ready();
  assert.equal(job.status,'succeeded',JSON.stringify(job.error));assert.deepEqual(f.current().english,before);
  const modelRead=f.contexts.at(-1).workspaceQueryResults.find(row=>row.query.kind==='get');
  assert.equal(modelRead.result.record.content,before.draftExercises.writing['appointment-email'].text);
  assert.equal(modelRead.result.record.content.endsWith('TAIL'),true);assert.equal(f.calls(),3);
  const first=await f.call('POST',`/api/ai/jobs/${job.id}/confirm`,{});assert.equal(first.status,200);
  assert.equal(f.current().english.draftExercises.writing['appointment-email'].text,action().data.content);
  assert.deepEqual(f.current().english.drafts,before.drafts);
  const second=await f.call('POST',`/api/ai/jobs/${job.id}/confirm`,{});assert.equal(second.status,200);assert.deepEqual(second.body.receipt,first.body.receipt);
});

test('model worker rejects missing, search-only, wrong-exercise and oversized reads even after output repair',async t=>{
  for(const options of [{read:'none'},{read:'search'},{read:'other'},{read:'oversized',content:'A'.repeat(20001)}]){
    const f=modelFixture(t,options),before=structuredClone(f.current().english),job=await f.ready();
    assert.equal(job.status,'failed',options.read);assert.deepEqual(f.current().english,before);
    assert.equal(job.error.code,'INVALID_PROPOSAL');assert.match(f.contexts.at(-1).formatCorrection.issue,/本轮完整 get/);
  }
});

test('later edits to the selected exercise still invalidate a fully-read pending proposal',async t=>{
  const f=modelFixture(t),job=await f.ready();assert.equal(job.status,'succeeded');
  f.change(target=>{target.english.draftExercises.writing['appointment-email'].text='Later manual revision.';});
  const rejected=await f.call('POST',`/api/ai/jobs/${job.id}/confirm`,{});assert.equal(rejected.status,409);assert.equal(rejected.body.error,'STALE_PROPOSAL');
  assert.equal(f.current().english.draftExercises.writing['appointment-email'].text,'Later manual revision.');
});
