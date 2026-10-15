// All records and HTTP responses are synthetic and in memory. No listener or model calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import {checkSyntheticWorkspace,validateComparisons,readSyntheticSnapshot} from './check-dev028-workspace.mjs';
import {FIXTURE,createSyntheticState} from './browser-dev028-fixture.mjs';
import {applyWorkspaceActions} from '../yuzhou/frontend/src/workspace-actions.js';
import {updateCustomBlock} from '../yuzhou/frontend/src/custom-blocks-model.js';
import {undoRoute} from '../yuzhou/frontend/src/workspace-model.js';

const instanceId='a'.repeat(64),timestamp='2026-10-15T00:00:00.000Z';
const code='const saved = app.getData();\napp.render([{type:"metric",label:"合成合计",value:saved.total||0}]);\n// CODE_BODY_MUST_NOT_ENTER_REPORT';
const updatedCode='const saved = app.getData();\napp.render([{type:"metric",label:"合成剩余预算",value:(saved.budget||0)-(saved.total||0)}]);';
const createActions=[{entity:'customBlock',operation:'create',data:{kind:'checklist',title:'活动准备清单（合成）',config:{items:[
  {id:'venue',label:'确认合成场地',done:false},{id:'supplies',label:'准备合成物料',done:false},{id:'notice',label:'确认合成通知',done:false}]}}},
  {entity:'customBlock',operation:'create',data:{kind:'miniapp',title:'预算小工具（合成）',config:{code}}}];
const block=(state,kind)=>state.customBlocks.items.find(item=>item.kind===kind&&item.id!==FIXTURE.protectedBlockId);
function check(state,stage,baseline,reference){
  const before=JSON.stringify(state),report=checkSyntheticWorkspace(state,{stage,baseline,reference,instanceId});
  assert.equal(JSON.stringify(state),before,'checking must not mutate workspace');return report;
}
function passed(report){assert.equal(report.passed,true,JSON.stringify(Object.entries(report.assertions).filter(([,ok])=>!ok)));return report;}
function request(state,id,receipt){state.aiRequests.push({id,text:'DEV-028 合成验收',status:'filed',receipt,
  conversation:{version:1,messages:[{id:`${id}-user`,role:'user',text:'合成请求',createdAt:timestamp}],confirmedJobId:`job-${id}`}});}
function prepared(){
  const state=createSyntheticState(timestamp),baseline=passed(check(state,'baseline'));let seq=0;
  const receipt=applyWorkspaceActions(state,'synthetic-create',structuredClone(createActions),{uid:()=>`synthetic-${++seq}`,now:timestamp});
  request(state,'synthetic-create',receipt);
  const created=passed(check(state,'created',baseline));return {state,baseline,created,receipt};
}
function usedFixture(){
  const fixture=prepared(),{state}=fixture,checklist=block(state,'checklist'),miniapp=block(state,'miniapp');
  updateCustomBlock(state,checklist.id,{config:{items:checklist.config.items.map((item,index)=>({...item,done:index===0}))}});
  updateCustomBlock(state,miniapp.id,{data:{budget:1000,total:250,syntheticSavedMarker:'DATA_BODY_MUST_NOT_ENTER_REPORT'}});
  return {...fixture,used:passed(check(state,'used',fixture.baseline,fixture.created))};
}
function updatedFixture(){
  const fixture=usedFixture(),{state}=fixture,checklist=block(state,'checklist');let seq=100;
  const updateReceipt=applyWorkspaceActions(state,'synthetic-update',[
    {entity:'customBlock',operation:'update',id:checklist.id,data:{config:{items:[...checklist.config.items,{id:'rehearsal',label:'增加合成彩排',done:false}]}}},
    {entity:'customBlock',operation:'update',id:block(state,'miniapp').id,data:{config:{code:updatedCode}}},
  ],{uid:()=>`synthetic-${++seq}`,now:'2026-10-15T00:10:00.000Z'});
  request(state,'synthetic-update',updateReceipt);
  return {...fixture,updateReceipt,updated:passed(check(state,'updated',fixture.baseline,fixture.used))};
}
function rejectsMutations(fixture,stage,reference,cases){
  for(const [mutate,assertion] of cases){const state=structuredClone(fixture.state);mutate(state);
    const result=check(state,stage,fixture.baseline,reference);assert.equal(result.assertions[assertion],false,assertion);assert.equal(result.passed,false,assertion);}
}

test('production create, data edits, update undo and used-block retention satisfy independent stage evidence',async()=>{
  const fixture=updatedFixture(),{state,baseline,used,receipt,updateReceipt}=fixture;
  const undoContext={state,uid:()=>crypto.randomUUID(),save:async()=>{}};
  assert.deepEqual(await undoRoute(undoContext,updateReceipt,'synthetic-update'),{removed:2,retained:0});
  const reverted=passed(check(state,'reverted',baseline,used));
  assert.deepEqual(await undoRoute(undoContext,receipt,'synthetic-create'),{removed:0,retained:2});
  passed(check(state,'retained',baseline,reverted));
  // Conversation counts are descriptive only; stages concern independent block state.
  assert.equal(reverted.summary.conversationCount,2);
  for(const report of [fixture.created,used,fixture.updated,reverted]){
    const serialized=JSON.stringify(report);
    for(const privateBody of [code,updatedCode,'CODE_BODY_MUST_NOT_ENTER_REPORT','DATA_BODY_MUST_NOT_ENTER_REPORT'])assert.equal(serialized.includes(privateBody),false);
    const summary=report.blocks.find(item=>item.kind==='miniapp');
    assert.match(summary.codeHash,/^[a-f0-9]{64}$/);assert.match(summary.recordHash,/^[a-f0-9]{64}$/);assert.match(summary.dataHash,/^[a-f0-9]{64}$/);
  }
  assert.deepEqual(reverted.blocks.find(item=>item.kind==='checklist').items,used.blocks.find(item=>item.kind==='checklist').items);
});

test('created and used stages reject premature checks, broken code, changed IDs and changes to protected baseline',()=>{
  const created=prepared();
  rejectsMutations(created,'created',undefined,[
    [state=>block(state,'checklist').config.items[0].done=true,'initialChecklistAllUnfinished'],
    [state=>block(state,'checklist').config.items.pop(),'threeInitialChecklistItems'],
    [state=>block(state,'miniapp').config.code='const = ;','miniappCodeSyntaxOnly'],
    [state=>block(state,'miniapp').config.code='  ','miniappCodeSyntaxOnly'],
    [state=>state.tasks[0].title='被误改的保护待办','protectedTaskExactHash'],
    [state=>state.captures[0].text='被误改的保护来源','protectedCaptureExactHash'],
    [state=>state.customBlocks.items.find(item=>item.id===FIXTURE.protectedBlockId).config.text='被误改的保护便签','protectedBlockExactHash'],
    [state=>state.workbench.modules.find(item=>item.id==='tasks').enabled=true,'modulesExactHash'],
    [state=>state.customBlocks.items.push({...structuredClone(block(state,'miniapp')),id:'block:unwanted'}),'exactlyTwoCreatedBlocks'],
  ]);
  const used=usedFixture();
  rejectsMutations(used,'used',used.created,[
    [state=>block(state,'checklist').config.items.forEach(item=>item.done=false),'checklistUsed'],
    [state=>block(state,'checklist').config.items[0].label='错误替换原标签','originalChecklistIdsAndLabels'],
    [state=>block(state,'miniapp').data={},'miniappDataNonEmpty'],
    [state=>block(state,'miniapp').config.code=updatedCode,'miniappCodeUnchangedDuringUse'],
    [state=>block(state,'miniapp').id='block:replacement','sameCreatedBlockIdsAndKinds'],
  ]);
  const syntaxOnlyState=structuredClone(created.state);
  block(syntaxOnlyState,'miniapp').config.code='await Promise.resolve(); throw new Error("SYNTAX_VALID_BUT_NOT_RUN");';
  const syntaxReport=passed(check(syntaxOnlyState,'created',created.baseline));
  assert.ok(syntaxReport.limitations.some(value=>value.includes('never executed')));
});

test('updated and reverted stages require preserved checklist history and private data while retained requires full records',()=>{
  const updated=updatedFixture();
  rejectsMutations(updated,'updated',updated.used,[
    [state=>block(state,'checklist').config.items.pop(),'oneAdditionalChecklistItem'],
    [state=>block(state,'checklist').config.items[0].done=false,'originalChecklistItemsPreserved'],
    [state=>block(state,'checklist').config.items[1].id='changed-id','originalChecklistItemsPreserved'],
    [state=>block(state,'checklist').config.items[1].label='changed-label','originalChecklistItemsPreserved'],
    [state=>block(state,'miniapp').config.code=code,'miniappCodeChanged'],
    [state=>block(state,'miniapp').data.total=0,'miniappDataPreserved'],
    [state=>block(state,'checklist').data={unrequested:true},'checklistDataPreserved'],
  ]);
  const used=usedFixture();passed(check(used.state,'reverted',used.baseline,used.used));
  rejectsMutations(used,'reverted',used.used,[
    [state=>block(state,'miniapp').config.code=updatedCode,'blockConfigsRestored'],
    [state=>block(state,'miniapp').data.total++,'blockDataPreserved'],
  ]);
  const changedTimestamp=structuredClone(used.state);block(changedTimestamp,'miniapp').updatedAt='2026-10-15T01:00:00.000Z';
  passed(check(changedTimestamp,'reverted',used.baseline,used.used));
  passed(check(used.state,'retained',used.baseline,used.used));
  rejectsMutations(used,'retained',used.used,[
    [state=>block(state,'miniapp').updatedAt='2026-10-15T01:00:00.000Z','completeBlockRecordsRetained'],
    [state=>block(state,'checklist').title='unexpected edit','completeBlockRecordsRetained'],
    [state=>state.customBlocks.items.splice(state.customBlocks.items.findIndex(item=>item.kind==='miniapp'),1),'exactlyTwoCreatedBlocks'],
  ]);
});

test('comparison reports require successful correct stages and matching instance and protection lineage',()=>{
  const fixture=usedFixture(),options={stage:'updated',baseline:fixture.baseline,reference:fixture.used,instanceId};
  assert.doesNotThrow(()=>validateComparisons(options));
  assert.throws(()=>validateComparisons({...options,reference:undefined}),/REFERENCE_REQUIRED/);
  assert.throws(()=>validateComparisons({...options,baseline:undefined}),/BASELINE_REQUIRED/);
  assert.throws(()=>validateComparisons({...options,instanceId:'b'.repeat(64)}),/ANOTHER_INSTANCE/);
  assert.throws(()=>validateComparisons({...options,reference:fixture.created}),/INVALID_COMPARISON_REPORT/);
  assert.throws(()=>validateComparisons({...options,reference:{...fixture.used,passed:false}}),/INVALID_COMPARISON_REPORT/);
  const anotherBaseline=check(createSyntheticState('2026-10-15T02:00:00.000Z'),'baseline');
  assert.throws(()=>validateComparisons({...options,baseline:anotherBaseline}),/ANOTHER_BASELINE/);
  const foreign=createSyntheticState(timestamp);foreign.profile.name='not DEV-028';
  assert.throws(()=>check(foreign,'baseline'),/NOT_DEV028/);
  const extra=prepared().state;assert.equal(check(extra,'baseline').passed,false);
});

test('read-only snapshot uses fixed synthetic login/CSRF routes and logs out even when identity is rejected',async()=>{
  const previousFetch=globalThis.fetch;let foreign=false,calls=[];
  globalThis.fetch=async(url,options)=>{
    const parsed=new URL(url);assert.equal(parsed.origin,FIXTURE.origin);assert.equal(options.redirect,'error');calls.push({path:parsed.pathname,method:options.method});
    if(parsed.pathname==='/api/instance')return Response.json({application:'czb-yuzhou',instanceId});
    if(parsed.pathname==='/api/auth/login'){
      assert.deepEqual(JSON.parse(options.body),{username:FIXTURE.username,password:FIXTURE.password});assert.equal(options.headers.Origin,FIXTURE.origin);
      return Response.json({username:FIXTURE.username,authenticated:true,csrfToken:'synthetic-csrf'},{headers:{'set-cookie':'synthetic-session=only-this-test; HttpOnly'}});
    }
    assert.equal(options.headers.Cookie,'synthetic-session=only-this-test');assert.equal(options.headers['X-CSRF-Token'],'synthetic-csrf');
    if(parsed.pathname==='/api/workspace'){const state=createSyntheticState(timestamp);if(foreign)state.profile.name='foreign';return Response.json({revision:7,state});}
    assert.equal(parsed.pathname,'/api/auth/logout');assert.equal(options.method,'POST');return Response.json({ok:true});
  };
  try{
    const snapshot=await readSyntheticSnapshot();assert.equal(snapshot.revision,7);assert.equal(snapshot.instanceId,instanceId);
    assert.deepEqual(calls,[{path:'/api/instance',method:'GET'},{path:'/api/auth/login',method:'POST'},{path:'/api/workspace',method:'GET'},{path:'/api/auth/logout',method:'POST'}]);
    foreign=true;calls=[];await assert.rejects(readSyntheticSnapshot(),/NOT_DEV028/);assert.equal(calls.at(-1).path,'/api/auth/logout');
  }finally{globalThis.fetch=previousFetch;}
});
