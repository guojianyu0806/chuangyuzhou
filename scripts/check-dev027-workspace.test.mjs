import test from 'node:test';
import assert from 'node:assert/strict';
import {checkSyntheticWorkspace} from './check-dev027-workspace.mjs';
import {createSyntheticState,FIXTURE} from './browser-dev027-fixture.mjs';
import {applyWorkspaceActions} from '../yuzhou/frontend/src/workspace-actions.js';
import {undoRoute} from '../yuzhou/frontend/src/workspace-model.js';

const make=()=>createSyntheticState('2026-10-15T00:00:00.000Z');
const actions=[{entity:'space',operation:'create',ref:'event',data:{title:'校园分享会筹备（合成）',type:'project'}},
  {entity:'note',operation:'create',containerId:'$event',data:{title:'活动要求（合成）',content:'活动：2026年10月28日。\n\n讲稿截止：2026-10-26。\n测试材料，不是真实活动或官方截止日期。'}},
  {entity:'task',operation:'create',data:{title:'准备分享会讲稿（合成）',date:'2026-10-26',priority:'high',spaceId:'$event'}},
  {entity:'workbenchModule',operation:'update',id:'tasks',data:{enabled:true}},
  {entity:'workbenchModule',operation:'update',id:'calendar',data:{enabled:true}}];
const proposal={title:'校园分享会筹备（合成）',destinationId:'workspace',actions};
const attachConversation=(state,receipt)=>state.aiRequests.push({id:'synthetic-stage-proof',text:'合成验收',status:'filed',receipt,
  conversation:{version:1,confirmedJobId:'synthetic-job',messages:['user','assistant','user','assistant'].map((role,index)=>({
    id:`message-${index}`,role,text:role==='user'?'合成请求':'合成方案',createdAt:'2026-10-15T00:01:00.000Z',
    ...(role==='assistant'?{proposal:structuredClone(proposal)}:{})}))}});

test('before, confirmed and production undo states satisfy independent stage assertions without mutation',async()=>{
  const state=make(),baseline=checkSyntheticWorkspace(state,{stage:'before'});assert.equal(baseline.passed,true);
  let seq=0;const receipt=applyWorkspaceActions(state,'synthetic-stage-proof',actions,{uid:()=>`stage-${++seq}`,now:'2026-10-15T00:01:00.000Z'});
  attachConversation(state,receipt);
  const beforeCheck=JSON.stringify(state),confirmed=checkSyntheticWorkspace(state,{stage:'confirmed',baseline});
  assert.equal(confirmed.passed,true);assert.equal(JSON.stringify(state),beforeCheck);assert.equal(confirmed.summary.linkedCalendarItems[0].date,'2026-10-26');
  const priorMessages=JSON.stringify(state.aiRequests[0].conversation.messages);
  const undo=await undoRoute({state,uid:()=>`undo-${++seq}`,save:async()=>{}},receipt,'synthetic-stage-proof');
  assert.equal(undo.retained,0);assert.equal(checkSyntheticWorkspace(state,{stage:'undone',baseline}).passed,true);
  assert.equal(JSON.stringify(state.aiRequests[0].conversation.messages),priorMessages);
  // Only space:<ID>:<tab> keys belong to the deleted space; independent boards are allowed.
  state.boards={'course:other:notes':{cards:[]},home:{cards:[]},space:{cards:[]},'space:global':{cards:[]}};
  assert.equal(checkSyntheticWorkspace(state,{stage:'undone',baseline}).passed,true);
  for(const [mutate,assertion] of [
    [copy=>copy.boards['space:deleted:overview']={cards:[]},'noNewOrphanSpaceBoards'],
    [copy=>copy.boards['space:deleted:notes']={cards:[{id:'stale-note'}]},'noNewOrphanSpaceBoards'],
    [copy=>copy.aiRequests[0].receipt=null,'receiptCleared'],
    [copy=>copy.aiRequests[0].conversation.pendingJobId='stale','pendingJobCleared'],
    [copy=>copy.aiRequests[0].conversation.confirmedJobId='stale','confirmedJobCleared'],
    [copy=>copy.aiRequests[0].conversation.proposal=proposal,'proposalCleared'],
    [copy=>copy.aiRequests[0].conversation.messages.splice(0,1),'twoUserAndTwoAssistantMessages'],
    [copy=>copy.aiRequests[0].conversation.messages.splice(1,1),'twoUserAndTwoAssistantMessages']]){
    const copy=structuredClone(state);mutate(copy);
    const result=checkSyntheticWorkspace(copy,{stage:'undone',baseline});
    assert.equal(result.assertions[assertion],false,assertion);assert.equal(result.passed,false,assertion);
  }
});

test('note date and paragraph quality, linkage, native calendar duplication and protected edits cannot pass when wrong',()=>{
  const baseline=checkSyntheticWorkspace(make(),{stage:'before'});
  for(const [mutate,assertion] of [
    [state=>state.tasks.find(row=>row.id!==FIXTURE.protectedTaskId).date='2026-10-25','revisedDateIs26'],
    [state=>state.spaces[0].notes[0].content=state.spaces[0].notes[0].content.replace('2026-10-26','2026-10-25'),'noteDeadlineIs26'],
    [state=>state.spaces[0].notes[0].content=state.spaces[0].notes[0].content.replace('2026年10月28日','2026年10月29日'),'noteActivityIs28'],
    [state=>state.spaces[0].notes[0].content=state.spaces[0].notes[0].content.replace('2026年10月28日','2027年10月28日'),'noteActivityIs28'],
    [state=>state.spaces[0].notes[0].content=state.spaces[0].notes[0].content.replaceAll('\n',' '),'noteContainsRealNewline'],
    [state=>state.spaces[0].notes[0].content+='\\n字面量转义不能充当分段','noteHasNoLiteralEscapedNewline'],
    [state=>state.tasks.find(row=>row.id!==FIXTURE.protectedTaskId).spaceId='','taskBelongsToSpace'],
    [state=>state.calendar.events.push({id:'unwanted-native-event'}),'nativeCalendarEventsZero'],
    [state=>state.tasks.find(row=>row.id===FIXTURE.protectedTaskId).description='changed','protectedTaskExactHash']]){
    const state=make();let seq=0;applyWorkspaceActions(state,'synthetic-stage-proof',actions,{uid:()=>`stage-${++seq}`});mutate(state);
    const result=checkSyntheticWorkspace(state,{stage:'confirmed',baseline});
    assert.equal(result.assertions[assertion],false,assertion);assert.equal(result.passed,false,assertion);
  }
});

test('foreign identity or missing successful baseline is rejected before producing a content summary',()=>{
  const state=make();state.profile.name='not the synthetic fixture';assert.throws(()=>checkSyntheticWorkspace(state,{stage:'before'}),/NOT_DEV027/);
  assert.throws(()=>checkSyntheticWorkspace(make(),{stage:'confirmed'}),/BASELINE/);
});
