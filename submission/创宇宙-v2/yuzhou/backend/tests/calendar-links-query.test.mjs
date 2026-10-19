import test from 'node:test';
import assert from 'node:assert/strict';
import {runWorkspaceQuery,validateWorkspaceQueries} from '../workspace-queries.mjs';
import {applyWorkspaceActions} from '../../frontend/src/workspace-actions.js';
import {createCompetitionCalendarEvent} from '../../frontend/src/competitions-model.js';
import {seedEnglish} from '../../frontend/src/english.js';

const NOW='2026-10-08T08:00:00.000Z';
const range={kind:'calendar.range',start:'2026-10-08',end:'2026-10-10'};
function fixture(){
  const state={spaces:[],courses:[],tasks:[],captures:[],english:seedEnglish(false),aiRequests:[],ui:{},calendar:{version:1,events:[]}};
  let serial=0;
  applyWorkspaceActions(state,'fixture',[
    {entity:'task',operation:'create',data:{title:'准备活动材料',date:'2026-10-08',description:'记得带打印件'}},
    {entity:'competition',operation:'create',ref:'contest',data:{title:'合成软件比赛'}},
    {entity:'competitionMilestone',operation:'create',containerId:'$contest',data:{title:'作品提交',date:'2026-10-09',time:'18:00'}},
    {entity:'competitionTask',operation:'create',containerId:'$contest',data:{title:'整理作品文档',date:'2026-10-08',done:true}},
    {entity:'englishPlan',operation:'update',id:'english-plan',data:{examDate:'2026-10-10'}},
    {entity:'calendarEvent',operation:'create',data:{title:'重要会议',kind:'note',startDate:'2026-10-07',endDate:'2026-10-09',allDay:true}},
  ],{uid:()=>`fixture-${++serial}`,now:NOW});
  return state;
}
test('calendar query combines explicit source dates and returns real editable identities without writes',async()=>{
  const state=fixture(),before=JSON.stringify(state),result=await runWorkspaceQuery(state,range);
  assert.equal(result.total,5);assert.equal(JSON.stringify(state),before);
  assert.deepEqual(new Set(result.items.map(item=>item.entity)),new Set(['calendarEvent','task','competitionMilestone','competitionTask','englishPlan']));
  const task=result.items.find(item=>item.entity==='task');assert.equal(task.id,state.tasks[0].id);assert.equal(task.containerId,'workspace');assert.equal(task.display.sourceId,task.id);assert.notEqual(task.display.id,task.id);
  for(const item of result.items){const [query]=validateWorkspaceQueries([{kind:'get',entity:item.entity,id:item.id,...(item.containerId?{containerId:item.containerId}:{})}]);const read=await runWorkspaceQuery(state,query);assert.deepEqual(read.record,item.record);}
  const deadline=result.items.find(item=>item.entity==='competitionMilestone');assert.equal(deadline.display.startTime,'18:00');assert.equal(deadline.display.timeZone,'Asia/Shanghai');
});
test('source/kind/done filters and pagination count all matching dated records',async()=>{
  const state=fixture();
  assert.equal((await runWorkspaceQuery(state,{...range,source:'tasks'})).total,1);
  assert.equal((await runWorkspaceQuery(state,{...range,source:'calendar'})).total,1);
  assert.equal((await runWorkspaceQuery(state,{...range,kindFilter:'mark'})).items[0].entity,'competitionMilestone');
  assert.equal((await runWorkspaceQuery(state,{...range,done:true})).items[0].entity,'competitionTask');
  const page=await runWorkspaceQuery(state,{...range,limit:2,offset:2});assert.equal(page.total,5);assert.equal(page.items.length,2);assert.equal(page.hasMore,true);
  assert.equal((await runWorkspaceQuery(state,{...range,start:'2026-10-11',end:'2026-10-12'})).total,0);
  assert.equal(validateWorkspaceQueries([{...range,source:'competitions'}])[0].source,'competitions');
  assert.throws(()=>validateWorkspaceQueries([{...range,source:'timetable'}]));
  assert.throws(()=>validateWorkspaceQueries([{kind:'search',source:'tasks'}]));
});
test('editing a returned source date moves its projection without creating or changing calendar events',async()=>{
  const state=fixture(),native=structuredClone(state.calendar),task=(await runWorkspaceQuery(state,{...range,source:'tasks'})).items[0];
  applyWorkspaceActions(state,'move',[{entity:task.entity,id:task.id,containerId:task.containerId,operation:'update',data:{date:'2026-10-15'}}],{now:NOW});
  assert.equal((await runWorkspaceQuery(state,{...range,source:'tasks'})).total,0);
  assert.equal((await runWorkspaceQuery(state,{...range,source:'tasks',start:'2026-10-15',end:'2026-10-15'})).total,1);
  assert.deepEqual(state.calendar,native);
});
test('archived linked parents are omitted while native archived events remain independently queryable',async()=>{
  const state=fixture();state.competitions.items[0].archived=true;state.calendar.events[0].archived=true;
  assert.equal((await runWorkspaceQuery(state,range)).total,2);
  const archived=await runWorkspaceQuery(state,{...range,archived:true});assert.equal(archived.total,1);assert.equal(archived.items[0].entity,'calendarEvent');
  assert.equal((await runWorkspaceQuery(state,{...range,archived:'all'})).total,3);
});
test('independent copied competition event and live source remain separately identified after edits',async()=>{
  const state=fixture(),parent=state.competitions.items[0],node=state.competitions.milestones[0];
  const copied=createCompetitionCalendarEvent(parent,node,new Date(NOW));copied.title='我自己编辑过的标注';state.calendar.events.push(copied);
  const result=await runWorkspaceQuery(state,{...range,start:node.date,end:node.date});
  const source=result.items.find(item=>item.entity==='competitionMilestone');assert.equal(source.display.independentCopyId,copied.id);assert.equal(result.items.find(item=>item.id===copied.id).title,copied.title);
  node.date='2026-10-18';const oldDate=await runWorkspaceQuery(state,{...range,start:copied.startDate,end:copied.endDate});assert.ok(oldDate.items.some(item=>item.id===copied.id));assert.ok(oldDate.items.every(item=>item.entity!=='competitionMilestone'));
});
