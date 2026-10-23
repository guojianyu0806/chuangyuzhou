import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkbench,getWorkbench,getVisibleModules,initializeWorkbench,validateWorkbench,configureWorkbench} from '../src/workbench-model.js';
import {applyWorkspaceActions,validateWorkspaceActionSnapshot,undoWorkspaceActions} from '../src/workspace-actions.js';
import {workspaceOverview,workspaceFingerprint,runWorkspaceQuery} from '../../backend/workspace-queries.mjs';
import {workspaceDestinations} from '../../backend/hermes.mjs';
import {projectCalendarLinks} from '../src/calendar-links.js';

const oldTitle='六级随身练',now='2026-10-09T08:00:00.000Z';
function legacy(){
  const workbench=createWorkbench('full');workbench.modules.find(row=>row.id==='english').title=oldTitle;
  return {workbench,spaces:[],courses:[],tasks:[],captures:[],aiRequests:[],english:{plan:{examDate:'2026-12-12',target:550,dailyMinutes:25,focus:'reading'},words:[],sessions:[],mistakes:[],attempts:[],drafts:{writing:'保留我的六级写作记录'}}};
}

test('legacy English default labels read as English without rewriting stored state or custom module names',()=>{
  const state=legacy(),before=structuredClone(state),original=state.workbench;
  assert.equal(validateWorkbench(state.workbench).modules.find(row=>row.id==='english').title,'英语');
  assert.equal(getWorkbench(state).modules.find(row=>row.id==='english').title,'英语');
  assert.equal(getVisibleModules(state).find(row=>row.id==='english').title,'英语');
  initializeWorkbench(state);assert.equal(state.workbench,original);assert.deepEqual(state,before);
  state.workbench.modules.find(row=>row.id==='english').title='我的六级与口语练习';
  state.workbench.modules.find(row=>row.id==='courses').title=oldTitle;
  const names=getWorkbench(state).modules;
  assert.equal(names.find(row=>row.id==='english').title,'我的六级与口语练习');
  assert.equal(names.find(row=>row.id==='courses').title,oldTitle);
});

test('renamed AI query labels and calendar projections retain stable English identities and a read-only fingerprint',async()=>{
  const state=legacy(),before=structuredClone(state),fingerprint=workspaceFingerprint(state);
  assert.equal(workspaceOverview(state).workbench.modules.find(row=>row.id==='english').title,'英语');
  const found=await runWorkspaceQuery(state,{kind:'get',entity:'workbenchModule',id:'english'});
  assert.equal(found.id,'english');assert.equal(found.record.title,'英语');
  assert.equal(workspaceDestinations(state).find(row=>row.id==='english').title,'英语');
  const date=projectCalendarLinks(state).find(row=>row.source==='english');
  assert.equal(date.title,'英语考试');assert.equal(date.entity,'englishPlan');assert.equal(date.sourceId,'english-plan');assert.equal(date.route,'english');
  assert.equal(date.startDate,'2026-12-12');assert.equal(state.english.plan.target,550);
  assert.deepEqual(state,before);assert.equal(workspaceFingerprint(state),fingerprint);
  configureWorkbench(state,{moduleId:'english',moduleTitle:'交流英语'});
  assert.notEqual(workspaceFingerprint(state),fingerprint,'actual saved configuration changes still invalidate old AI plans');
});

test('historical English module receipts validate and undo after the default-label migration',async()=>{
  const state=legacy(),priorEnglish=structuredClone(state.english);let serial=0;
  const receipt=applyWorkspaceActions(state,'historical-label-change',[
    {entity:'workbenchModule',id:'english',operation:'update',data:{enabled:false}},
  ],{now,uid:()=>`naming-receipt-${++serial}`});
  const historical=JSON.parse(receipt.items[0].snapshot);
  for(const side of ['before','after']){
    historical[side].title=oldTitle;
    historical[side].configuration.modules.find(row=>row.id==='english').title=oldTitle;
  }
  const source=structuredClone(historical),validated=validateWorkspaceActionSnapshot(historical);
  assert.equal(validated.before.title,'英语');assert.equal(validated.after.title,'英语');assert.deepEqual(historical,source);
  receipt.items[0].snapshot=JSON.stringify(historical);
  state.workbench.modules.find(row=>row.id==='english').title=oldTitle;
  const result=await undoWorkspaceActions({state,save:()=>{}},receipt,'historical-label-change');
  assert.deepEqual(result,{removed:1,retained:0});
  assert.equal(getWorkbench(state).modules.find(row=>row.id==='english').enabled,true);
  assert.deepEqual(state.english,priorEnglish);
  const forged=structuredClone(historical);forged.after.configuration.modules.find(row=>row.id==='english').title='用户的另一个名称';
  assert.throws(()=>validateWorkspaceActionSnapshot(forged),/不一致/);
});
