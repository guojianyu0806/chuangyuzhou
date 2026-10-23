import test from 'node:test';
import assert from 'node:assert/strict';
import {planShowcaseExamples,SHOWCASE_SPACE_ID,SHOWCASE_COMPETITION_ID,SHOWCASE_LEDGER_ID} from '../src/showcase-examples.js';
import {createWorkbench} from '../src/workbench-model.js';
import {seedEnglish} from '../src/english.js';
import {applyWorkspaceActions,listWorkspaceRecords} from '../src/workspace-actions.js';
import {projectCalendarLinks} from '../src/calendar-links.js';
import {competitionProgress} from '../src/competitions-model.js';
import {selectEntries,summarizeEntries} from '../src/ledger-model.js';
import {runWorkspaceQuery} from '../../backend/workspace-queries.mjs';

const NOW='2026-10-09T04:00:00.000Z';
function workspace(extra={}){
  return {schema:1,mode:'personal',profile:{name:'关系验证',major:'',provider:'deepseek'},workbench:createWorkbench('blank'),
    courses:[],spaces:[],tasks:[],captures:[],english:seedEnglish(false),calendar:{version:1,events:[]},aiRequests:[],ui:{},updatedAt:NOW,...extra};
}
function showcase(base=workspace()){
  return structuredClone(planShowcaseExamples(base,{now:new Date(NOW)}).nextState);
}
function change(state,actions){
  let serial=0;
  return applyWorkspaceActions(state,'synthetic-relations-check',actions,{now:NOW,uid:()=>`relations-receipt-${++serial}`});
}

test('showcase space tasks share global identities and changed dates and completion project to the calendar',async()=>{
  const state=showcase(),space=state.spaces.find(row=>row.id===SHOWCASE_SPACE_ID);
  const tasks=state.tasks.filter(row=>row.spaceId===space.id);
  assert.equal(tasks.length,3);
  const task=tasks[0],originalDate=task.date,nativeCalendar=structuredClone(state.calendar),blocks=structuredClone(state.customBlocks);
  const globalRecord=listWorkspaceRecords(state).find(row=>row.entity==='task'&&row.id===task.id);
  assert.equal(globalRecord.containerId,'workspace');
  assert.deepEqual(globalRecord.record,task);
  assert.equal(projectCalendarLinks(state).filter(row=>row.entity==='task'&&row.sourceId===task.id).length,1);
  change(state,[{entity:'task',id:task.id,operation:'update',data:{date:'2026-10-22',done:true}}]);
  const shared=state.tasks.find(row=>row.id===task.id);
  assert.equal(state.tasks.filter(row=>row.id===task.id).length,1);
  assert.equal(shared.spaceId,space.id);
  assert.equal(shared.done,true);
  const beforeRange=await runWorkspaceQuery(state,{kind:'calendar.range',start:originalDate,end:originalDate,source:'tasks'});
  assert.ok(beforeRange.items.every(row=>row.id!==task.id));
  const afterRange=await runWorkspaceQuery(state,{kind:'calendar.range',start:'2026-10-22',end:'2026-10-22',source:'tasks'});
  const linked=afterRange.items.find(row=>row.id===task.id);
  assert.equal(linked.record.spaceId,space.id);
  assert.equal(linked.display.done,true);
  assert.equal(linked.display.parentId,space.id);
  assert.equal(linked.display.sourceId,task.id);
  assert.deepEqual(state.calendar,nativeCalendar,'linked dates do not create independent calendar records');
  assert.deepEqual(state.customBlocks,blocks,'hand-maintained showcase blocks do not pretend to track task completion');
  const capturedTask=state.tasks.find(row=>row.spaceId===space.id&&row.captureId);
  assert.ok(state.captures.some(row=>row.id===capturedTask.captureId));
});

test('showcase competition edits update both live calendar projections and derived progress without duplicate tasks',async()=>{
  const state=showcase(),milestone=state.competitions.milestones.find(row=>row.competitionId===SHOWCASE_COMPETITION_ID);
  const preparation=state.competitions.tasks.find(row=>row.competitionId===SHOWCASE_COMPETITION_ID);
  const globalTasks=structuredClone(state.tasks),nativeCalendar=structuredClone(state.calendar);
  const before=competitionProgress(state.competitions,SHOWCASE_COMPETITION_ID);
  assert.deepEqual(before,{done:0,total:2,percent:0});
  change(state,[
    {entity:'competitionMilestone',id:milestone.id,containerId:SHOWCASE_COMPETITION_ID,operation:'update',data:{date:'2026-10-24'}},
    {entity:'competitionTask',id:preparation.id,containerId:SHOWCASE_COMPETITION_ID,operation:'update',data:{done:true}},
  ]);
  assert.deepEqual(competitionProgress(state.competitions,SHOWCASE_COMPETITION_ID),{done:1,total:2,percent:50});
  const projections=projectCalendarLinks(state);
  const linkedMilestone=projections.find(row=>row.entity==='competitionMilestone'&&row.sourceId===milestone.id);
  assert.equal(linkedMilestone.startDate,'2026-10-24');
  assert.equal(linkedMilestone.containerId,SHOWCASE_COMPETITION_ID);
  assert.equal(projections.find(row=>row.entity==='competitionTask'&&row.sourceId===preparation.id).done,true);
  const read=await runWorkspaceQuery(state,{kind:'get',entity:linkedMilestone.entity,id:linkedMilestone.sourceId,containerId:linkedMilestone.containerId});
  assert.equal(read.record.date,'2026-10-24');
  assert.deepEqual(state.tasks,globalTasks,'competition preparation is not duplicated into global tasks');
  assert.deepEqual(state.calendar,nativeCalendar,'source edits preserve native calendar records');
});

test('showcase ledger entries remain in their project and excluded from the daily total until explicitly included',()=>{
  const daily={id:'existing-daily',type:'expense',amountCents:850,date:'2026-10-09',category:'日常',projectId:'',note:'synthetic existing entry',archived:false,createdAt:NOW,updatedAt:NOW};
  const state=showcase(workspace({ledger:{version:1,currency:'CNY',projects:[],entries:[daily]}}));
  const project=state.ledger.projects.find(row=>row.id===SHOWCASE_LEDGER_ID);
  assert.equal(project.includeInTotal,false);
  const sample=selectEntries(state.ledger,{projectId:project.id});
  assert.equal(sample.length,2);
  assert.equal(summarizeEntries(sample).expenseCents,4000);
  assert.equal(summarizeEntries(selectEntries(state.ledger,{scope:'total'})).expenseCents,850);
  assert.deepEqual(selectEntries(state.ledger,{scope:'daily'}),[daily]);
  const edited=sample.find(row=>row.amountCents===1200);
  change(state,[{entity:'ledgerEntry',id:edited.id,containerId:`ledger:${project.id}`,operation:'update',data:{amount:'15.25'}}]);
  assert.equal(state.ledger.entries.find(row=>row.id===edited.id).projectId,project.id);
  assert.equal(summarizeEntries(selectEntries(state.ledger,{projectId:project.id})).expenseCents,4325);
  assert.equal(summarizeEntries(selectEntries(state.ledger,{scope:'total'})).expenseCents,850);
  change(state,[{entity:'ledgerProject',id:project.id,operation:'update',data:{includeInTotal:true}}]);
  assert.equal(summarizeEntries(selectEntries(state.ledger,{scope:'total'})).expenseCents,5175);
});
