import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createStore,validateWorkspace} from '../store.mjs';
import {validateBackup,mergeBackup} from '../../frontend/src/backup.js';

const stamp='2026-10-08T08:00:00.000Z';
const item=(id='competition-1',extra={})=>({id,title:'合成软件设计比赛',organizer:'测试主办方',category:'软件设计',url:'https://example.org/contest',team:'测试团队',requirements:'代码与说明',notes:'测试',status:'watching',color:'#7950f2',archived:false,createdAt:stamp,updatedAt:stamp,...extra});
const milestone=(id='milestone-1',competitionId='competition-1',extra={})=>({id,competitionId,title:'提交截止',date:'2026-10-30',time:'18:30',done:false,archived:false,createdAt:stamp,updatedAt:stamp,...extra});
const task=(id='competition-task-1',competitionId='competition-1',extra={})=>({id,competitionId,title:'准备材料',date:'',notes:'',done:false,archived:false,createdAt:stamp,updatedAt:stamp,...extra});
const competitions=()=>({version:1,items:[item()],milestones:[milestone()],tasks:[task()]});
const state=(data)=>({schema:1,mode:'personal',profile:{},english:{},courses:[],tasks:[{id:'original-task',title:'原有待办'}],captures:[],calendar:{version:1,events:[{id:'original-event',title:'原有日历安排',kind:'plan',startDate:'2026-10-09',endDate:'2026-10-09',allDay:false,startTime:'09:00',endTime:'10:00',location:'测试地点',notes:'必须保留',important:false,done:false,archived:false,color:'#7950f2',createdAt:stamp,updatedAt:stamp}]},updatedAt:stamp,...(data===undefined?{}:{competitions:data})});
function temporaryStore(t){
  const directory=mkdtempSync(join(tmpdir(),'yuzhou-competitions-test-')),ref={store:createStore(directory),directory};
  t.after(()=>{ref.store.close();const target=resolve(directory),prefix=resolve(join(tmpdir(),'yuzhou-competitions-test-'));if(!target.startsWith(prefix))throw new Error('Unexpected competition test cleanup target');rmSync(target,{recursive:true,force:true});});return ref;
}

test('server supports legacy workspaces, explicit empty competitions and children of archived competitions',()=>{
  const legacy=state();assert.doesNotThrow(()=>validateWorkspace(legacy));assert.equal(Object.hasOwn(JSON.parse(validateWorkspace(legacy).serialized),'competitions'),false);
  assert.doesNotThrow(()=>validateWorkspace(state({version:1,items:[],milestones:[],tasks:[]})));
  const input=state(competitions());input.competitions.items[0].archived=true;input.competitions.milestones[0].archived=true;input.competitions.tasks[0].done=true;
  assert.deepEqual(JSON.parse(validateWorkspace(input).serialized).competitions,input.competitions);
});

test('server enforces competition references, global IDs, valid fields and safe URLs',()=>{
  const mutations=[
    data=>{data.items[0].status='invalid';},data=>{data.items[0].url='javascript:alert(1)';},data=>{data.items[0].url='data:text/html,unsafe';},
    data=>{data.items[0].createdAt='2026-02-30T08:00:00.000Z';},data=>{data.items[0].color='blue';},data=>{data.items[0].id='x'.repeat(97);},
    data=>{data.milestones[0].competitionId='absent';},data=>{data.tasks[0].competitionId='absent';data.tasks[0].archived=true;},
    data=>{data.milestones[0].date='2026-02-30';},data=>{data.milestones[0].time='25:00';},data=>{data.tasks[0].date='2026-10-40';},
    data=>{data.tasks[0].done='false';},data=>{data.milestones[0].id=data.items[0].id;},data=>{data.tasks[0].id=data.milestones[0].id;},
  ];
  for(const [index,mutate]of mutations.entries()){const input=state(competitions());mutate(input.competitions);assert.throws(()=>validateWorkspace(input),error=>error.code==='invalid_competitions'&&error.status===400,`malformed competition case ${index}`);}
  const duplicate=state(competitions());duplicate.competitions.items.push(structuredClone(duplicate.competitions.items[0]));assert.throws(()=>validateWorkspace(duplicate),error=>error.code==='duplicate_record_id'||error.code==='invalid_competitions');
});

test('SQLite competition edits, archived child records and imported backups survive restart without touching ordinary tasks/calendar',t=>{
  const ref=temporaryStore(t),original=state();ref.store.saveWorkspace(0,original);
  const withCompetitions=state(competitions());ref.store.saveWorkspace(1,withCompetitions);
  const phone=ref.store.getWorkspace();phone.state.competitions.items[0].status='submitted';phone.state.competitions.milestones[0].done=true;phone.state.competitions.tasks[0].archived=true;phone.state.competitions.tasks[0].notes='手机记录';ref.store.saveWorkspace(phone.revision,phone.state);
  assert.throws(()=>ref.store.saveWorkspace(2,withCompetitions),error=>error.code==='revision_conflict');
  const before=ref.store.getWorkspace(),invalid=structuredClone(before.state);invalid.competitions.milestones[0].competitionId='missing';
  assert.throws(()=>ref.store.saveWorkspace(before.revision,invalid),error=>error.code==='invalid_competitions');assert.deepEqual(ref.store.getWorkspace(),before);
  const incoming=structuredClone(withCompetitions);incoming.competitions.items.push(item('competition-2',{archived:true}));incoming.competitions.tasks.push(task('competition-task-2','competition-2',{done:true,archived:true}));
  const checked=validateBackup({format:'lumi-backup',version:1,state:incoming,files:[]}),merged=mergeBackup(before.state,checked);assert.equal(merged.count,2);ref.store.saveWorkspace(before.revision,merged.state);
  const repeated=mergeBackup(ref.store.getWorkspace().state,checked);assert.equal(repeated.count,0);assert.deepEqual(repeated.state.competitions,merged.state.competitions);
  ref.store.close();ref.store=createStore(ref.directory);const restored=ref.store.getWorkspace();
  assert.equal(restored.revision,4);assert.deepEqual(restored.state.competitions,merged.state.competitions);
  assert.equal(restored.state.competitions.items[0].status,'submitted');assert.equal(restored.state.competitions.tasks[0].notes,'手机记录');
  assert.equal(restored.state.competitions.tasks[1].archived,true);assert.deepEqual(restored.state.tasks,original.tasks);assert.deepEqual(restored.state.calendar,original.calendar);
  const roundtrip=validateBackup({format:'lumi-backup',version:1,state:restored.state,files:[]});assert.deepEqual(roundtrip.state.competitions,restored.state.competitions);
});

test('outdated clients cannot omit populated competitions; rejected writes are atomic',t=>{
  const {store}=temporaryStore(t),initial=state(competitions());initial.competitions.items[0].archived=true;initial.competitions.milestones[0].archived=true;initial.competitions.tasks[0].archived=true;store.saveWorkspace(0,initial);
  const before=store.getWorkspace(),outdated=structuredClone(before.state);delete outdated.competitions;outdated.tasks[0].title='旧客户端的变更';
  assert.throws(()=>store.saveWorkspace(before.revision,outdated),error=>error.code==='workspace_update_required'&&error.status===409);assert.deepEqual(store.getWorkspace(),before);
});

test('old-client safeguard covers any populated collection, including partial historical storage',t=>{
  const ref=temporaryStore(t);ref.store.saveWorkspace(0,state());
  // Seed legacy partial snapshots directly in this isolated SQLite to exercise
  // each guard independently; normal writes reject orphan child records.
  for(const key of ['items','milestones','tasks']){
    const previous=state({version:1,items:[],milestones:[],tasks:[]});previous.competitions[key]=[competitions()[key][0]];
    const db=new DatabaseSync(join(ref.directory,'workbench.sqlite'));try{db.prepare('UPDATE workspace SET state=? WHERE id=1').run(JSON.stringify(previous));}finally{db.close();}
    const before=ref.store.getWorkspace();assert.throws(()=>ref.store.saveWorkspace(before.revision,state()),error=>error.code==='workspace_update_required');assert.deepEqual(ref.store.getWorkspace(),before);
  }
});

test('omitting genuinely empty competitions remains compatible with old clients',t=>{
  const {store}=temporaryStore(t);store.saveWorkspace(0,state({version:1,items:[],milestones:[],tasks:[]}));
  assert.doesNotThrow(()=>store.saveWorkspace(1,state()));assert.equal(Object.hasOwn(store.getWorkspace().state,'competitions'),false);
});
