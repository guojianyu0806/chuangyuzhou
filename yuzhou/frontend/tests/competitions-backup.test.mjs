import test from 'node:test';
import assert from 'node:assert/strict';
import {validateBackup,mergeBackup} from '../src/backup.js';

const stamp='2026-10-08T08:00:00.000Z';
const item=(id='competition-1',extra={})=>({id,title:'合成软件设计比赛',organizer:'测试主办方',category:'软件设计',url:'https://example.org/contest?year=2026#notice',team:'测试团队',requirements:'代码、说明书',notes:'仅测试数据',status:'preparing',color:'#7950f2',archived:false,createdAt:stamp,updatedAt:stamp,...extra});
const milestone=(id='milestone-1',competitionId='competition-1',extra={})=>({id,competitionId,title:'报名截止',date:'2026-10-30',time:'18:30',done:false,archived:false,createdAt:stamp,updatedAt:stamp,...extra});
const task=(id='competition-task-1',competitionId='competition-1',extra={})=>({id,competitionId,title:'整理参赛材料',date:'',notes:'待补全日期',done:false,archived:false,createdAt:stamp,updatedAt:stamp,...extra});
const competitions=()=>({version:1,items:[item()],milestones:[milestone()],tasks:[task()]});
const state=(data)=>({schema:1,mode:'personal',profile:{},english:{},courses:[],tasks:[{id:'original-task',title:'既有普通待办',date:'2026-10-09'}],captures:[],calendar:{version:1,events:[{id:'original-event',title:'既有日历安排',kind:'plan',startDate:'2026-10-09',endDate:'2026-10-09',allDay:false,startTime:'09:00',endTime:'10:00',location:'测试地点',notes:'必须保留',important:false,done:false,archived:false,color:'#7950f2',createdAt:stamp,updatedAt:stamp}]},updatedAt:stamp,...(data===undefined?{}:{competitions:data})});
const backup=value=>({format:'lumi-backup',version:1,exportedAt:stamp,state:value,files:[]});

test('competition backup roundtrip preserves every collection, archived records, dates and AI origin',()=>{
  const input=state(competitions());
  input.competitions.items.push(item('archived-parent',{archived:true,status:'finished',url:''}));
  input.competitions.milestones.push(milestone('archived-milestone','archived-parent',{archived:true,done:true,time:''}));
  input.competitions.tasks.push(task('archived-task','archived-parent',{archived:true,done:true,date:'2026-10-29'}));
  for(const key of ['items','milestones','tasks'])input.competitions[key][0].sourceRequestId='ai-source-1';
  const original=structuredClone(input),checked=validateBackup(JSON.parse(JSON.stringify(backup(input))));
  assert.deepEqual(checked.state.competitions,input.competitions);
  assert.deepEqual(validateBackup(JSON.parse(JSON.stringify(checked))).state.competitions,input.competitions);
  const restored=mergeBackup(state(),checked);
  assert.deepEqual(restored.state.competitions,input.competitions);assert.equal(restored.count,6);
  assert.deepEqual(restored.state.tasks,input.tasks);assert.deepEqual(restored.state.calendar,input.calendar);
  assert.deepEqual(input,original,'validation and merge never mutate the supplied backup');
});

test('legacy backups omit competitions without initialization, and explicit empty feature data roundtrips',()=>{
  assert.equal(Object.hasOwn(validateBackup(backup(state())).state,'competitions'),false);
  assert.equal(Object.hasOwn(mergeBackup(state(),backup(state())).state,'competitions'),false);
  const empty={version:1,items:[],milestones:[],tasks:[]},checked=validateBackup(backup(state(empty)));
  assert.deepEqual(checked.state.competitions,empty);assert.deepEqual(mergeBackup(state(),checked).state.competitions,empty);
  const current=state(competitions());assert.deepEqual(mergeBackup(current,backup(state())).state.competitions,current.competitions);
});

test('competition backup rejects orphan links, global duplicate IDs, invalid enums, dates, times and unsafe URLs',()=>{
  const mutations=[
    value=>{value.version=2;},
    value=>{value.items[0].status='unknown';},
    value=>{value.items[0].color='url(javascript:alert(1))';},
    value=>{value.items[0].id='x'.repeat(97);},
    value=>{value.items[0].id='constructor';},
    value=>{value.items[0].archived='false';},
    value=>{value.items[0].createdAt='2026-02-30T08:00:00.000Z';},
    value=>{value.milestones[0].competitionId='missing';},
    value=>{value.tasks[0].competitionId='missing';value.tasks[0].archived=true;},
    value=>{value.milestones[0].date='2026-02-30';},
    value=>{value.milestones[0].date='';},
    value=>{value.milestones[0].time='24:00';},
    value=>{value.milestones[0].time='12:60';},
    value=>{value.tasks[0].date='2026-13-01';},
    value=>{value.tasks[0].done=1;},
    value=>{value.items.push(structuredClone(value.items[0]));},
    value=>{value.milestones[0].id=value.items[0].id;},
    value=>{value.tasks[0].id=value.milestones[0].id;},
    ...['javascript:alert(1)','data:text/html,<script>alert(1)</script>','file:///C:/private.txt','https://example.org/\nunsafe'].map(url=>value=>{value.items[0].url=url;}),
  ];
  for(const [index,mutate]of mutations.entries()){
    const input=state(competitions());mutate(input.competitions);
    assert.throws(()=>validateBackup(backup(input)),`invalid competition backup case ${index}`);
  }
});

test('competition imports are additive per ID, keep current edits and archived status, and remain idempotent',()=>{
  const current=state(competitions());current.competitions.items[0].title='当前标题';current.competitions.items[0].archived=true;
  current.competitions.milestones[0].done=true;current.competitions.milestones[0].date='2026-10-31';
  current.competitions.tasks[0].notes='当前设备编辑';current.competitions.tasks[0].archived=true;
  const imported=state(competitions());imported.competitions.items.push(item('competition-2'));
  imported.competitions.milestones.push(milestone('milestone-2','competition-2'),milestone('milestone-3'));
  imported.competitions.tasks.push(task('competition-task-2','competition-2'),task('competition-task-3'));
  const original=structuredClone(current),result=mergeBackup(current,validateBackup(backup(imported)));
  assert.equal(result.count,5);assert.equal(result.state.competitions.items.length,2);assert.equal(result.state.competitions.milestones.length,3);assert.equal(result.state.competitions.tasks.length,3);
  for(const key of ['items','milestones','tasks'])assert.deepEqual(result.state.competitions[key][0],current.competitions[key][0]);
  assert.deepEqual(result.state.tasks,current.tasks);assert.deepEqual(result.state.calendar,current.calendar);assert.deepEqual(current,original);
  const again=mergeBackup(result.state,imported);assert.equal(again.count,0);assert.deepEqual(again.state.competitions,result.state.competitions);
  assert.deepEqual(mergeBackup(result.state,state()).state.competitions,result.state.competitions);
  assert.doesNotThrow(()=>validateBackup(backup(result.state)));
});

test('cross-collection ID conflicts between valid backups reject atomically without changing current records',()=>{
  const current=state(competitions()),imported=state(competitions());
  imported.competitions.tasks[0].id='another-task';imported.competitions.items.push(item('competition-task-1'));
  assert.doesNotThrow(()=>validateBackup(backup(imported)));
  const original=structuredClone(current);assert.throws(()=>mergeBackup(current,imported));assert.deepEqual(current,original);
});
