import test from 'node:test';
import assert from 'node:assert/strict';
import {checkSyntheticWorkspace} from './check-dev027-workspace.mjs';
import {createSyntheticState,FIXTURE} from './browser-dev027-fixture.mjs';
import {applyWorkspaceActions,undoWorkspaceActions} from '../yuzhou/frontend/src/workspace-actions.js';

const make=()=>createSyntheticState('2026-10-15T00:00:00.000Z');
const actions=[{entity:'space',operation:'create',ref:'event',data:{title:'校园分享会筹备（合成）',type:'project'}},
  {entity:'note',operation:'create',containerId:'$event',data:{title:'活动要求（合成）',content:'测试材料，不是真实活动或官方截止日期。'}},
  {entity:'task',operation:'create',data:{title:'准备分享会讲稿（合成）',date:'2026-10-26',priority:'high',spaceId:'$event'}},
  {entity:'workbenchModule',operation:'update',id:'tasks',data:{enabled:true}},
  {entity:'workbenchModule',operation:'update',id:'calendar',data:{enabled:true}}];

test('before, confirmed and production undo states satisfy independent stage assertions without mutation',async()=>{
  const state=make(),baseline=checkSyntheticWorkspace(state,{stage:'before'});assert.equal(baseline.passed,true);
  let seq=0;const receipt=applyWorkspaceActions(state,'synthetic-stage-proof',actions,{uid:()=>`stage-${++seq}`,now:'2026-10-15T00:01:00.000Z'});
  const beforeCheck=JSON.stringify(state),confirmed=checkSyntheticWorkspace(state,{stage:'confirmed',baseline});
  assert.equal(confirmed.passed,true);assert.equal(JSON.stringify(state),beforeCheck);assert.equal(confirmed.summary.linkedCalendarItems[0].date,'2026-10-26');
  const undo=await undoWorkspaceActions({state,uid:()=>`undo-${++seq}`,save:async()=>{}},receipt,'synthetic-stage-proof');
  assert.equal(undo.retained,0);assert.equal(checkSyntheticWorkspace(state,{stage:'undone',baseline}).passed,true);
});

test('wrong deadline, missing linkage, native calendar duplication and protected edits cannot pass',()=>{
  const baseline=checkSyntheticWorkspace(make(),{stage:'before'});
  for(const mutate of [state=>state.tasks.find(row=>row.id!==FIXTURE.protectedTaskId).date='2026-10-25',
    state=>state.tasks.find(row=>row.id!==FIXTURE.protectedTaskId).spaceId='',
    state=>state.calendar.events.push({id:'unwanted-native-event'}),
    state=>state.tasks.find(row=>row.id===FIXTURE.protectedTaskId).description='changed']){
    const state=make();let seq=0;applyWorkspaceActions(state,'synthetic-stage-proof',actions,{uid:()=>`stage-${++seq}`});mutate(state);
    assert.equal(checkSyntheticWorkspace(state,{stage:'confirmed',baseline}).passed,false);
  }
});

test('foreign identity or missing successful baseline is rejected before producing a content summary',()=>{
  const state=make();state.profile.name='not the synthetic fixture';assert.throws(()=>checkSyntheticWorkspace(state,{stage:'before'}),/NOT_DEV027/);
  assert.throws(()=>checkSyntheticWorkspace(make(),{stage:'confirmed'}),/BASELINE/);
});
