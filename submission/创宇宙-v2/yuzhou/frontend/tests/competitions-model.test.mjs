import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCompetitions,validateCompetitionItem,validateCompetitionMilestone,validateCompetitionTask,mergeCompetitions,initializeCompetitions,deadlineStatus,competitionToday,nearestCompetitionDeadline,competitionProgress,summarizeCompetitions,createCompetitionCalendarEvent} from '../src/competitions-model.js';

const now='2026-10-08T04:00:00.000Z';
const base={archived:false,createdAt:now,updatedAt:now};
const item=(id='contest')=>({...base,id,title:'算法作品赛',organizer:'学院',category:'软件',url:'https://example.com/contest',team:'两人小组',requirements:'源码、演示视频和说明文档',notes:'',status:'preparing',color:'#7950f2'});
const milestone=(id='deadline',extra={})=>({...base,id,competitionId:'contest',title:'作品提交',date:'2026-10-08',time:'18:00',done:false,...extra});
const task=(id='task',extra={})=>({...base,id,competitionId:'contest',title:'整理说明文档',date:'',notes:'',done:false,...extra});
const sample=()=>({version:1,items:[item()],milestones:[milestone()],tasks:[task()]});

test('competition validation preserves independent child records and safe official URLs',()=>{
 const value=validateCompetitions(sample());assert.equal(value.tasks[0].competitionId,value.items[0].id);
 assert.equal(validateCompetitionItem({...item(),url:'https://example.com'}).url,'https://example.com/');
 for(const url of ['javascript:alert(1)','data:text/html,hi','ftp://example.com','https://user:secret@example.com','relative/path'])assert.throws(()=>validateCompetitionItem({...item(),url}));
 for(const status of ['unknown','__proto__','constructor'])assert.throws(()=>validateCompetitionItem({...item(),status}));
 for(const color of ['red','#fff','url(x)'])assert.throws(()=>validateCompetitionItem({...item(),color}));
 assert.throws(()=>validateCompetitionItem({...item(),unsupported:true}));
});

test('real dates, clock limits, duplicate IDs and orphan children are rejected',()=>{
 for(const date of ['2026-02-29','2026-10-32','','2026-1-8'])assert.throws(()=>validateCompetitionMilestone(milestone('d',{date})));
 for(const time of ['24:00','12:60','9:00','x'])assert.throws(()=>validateCompetitionMilestone(milestone('d',{time})));
 assert.doesNotThrow(()=>validateCompetitionMilestone(milestone('d',{date:'2028-02-29',time:'23:59'})));
 assert.equal(validateCompetitionTask(task()).date,'');assert.throws(()=>validateCompetitionTask(task('t',{date:'no-date'})));
 const orphan=sample();orphan.tasks[0].competitionId='missing';assert.throws(()=>validateCompetitions(orphan),/不存在/);
 const duplicate=sample();duplicate.tasks[0].id=duplicate.items[0].id;assert.throws(()=>validateCompetitions(duplicate),/重复/);
 const archived=sample();archived.items[0].archived=true;assert.doesNotThrow(()=>validateCompetitions(archived));
});

test('deadline status uses Beijing time and does not invent a missing clock',()=>{
 assert.equal(competitionToday('2026-10-07T16:00:00Z'),'2026-10-08');
 assert.equal(competitionToday('2026-10-08T15:59:59Z'),'2026-10-08');
 const exact=milestone('exact',{time:'12:00'}),untimed=milestone('untimed',{time:''});
 assert.equal(deadlineStatus(exact,'2026-10-08T03:59:59Z').state,'today');
 assert.equal(deadlineStatus(exact,'2026-10-08T04:00:00Z').state,'overdue');
 assert.equal(deadlineStatus(untimed,'2026-10-08T15:59:59Z').state,'today');
 assert.equal(deadlineStatus(untimed,'2026-10-08T16:00:00Z').state,'overdue');
 assert.match(deadlineStatus(untimed,now).label,/时间未填/);
 assert.equal(deadlineStatus(milestone('future',{date:'2026-10-15'}),now).state,'soon');
 assert.equal(deadlineStatus(milestone('future',{date:'2026-10-16'}),now).state,'upcoming');
 assert.equal(deadlineStatus(milestone('done',{date:'2026-10-01',done:true}),now).state,'done');
});

test('all unfinished milestones contribute to summary and finished/archived contests are excluded',()=>{
 const data=sample();data.items.push({...item('old'),archived:true},{...item('finished'),status:'finished'},{...item('submitted'),status:'submitted'});
 data.milestones.push(milestone('late',{date:'2026-10-07'}),milestone('done',{done:true}),milestone('archived',{archived:true}),milestone('old-d',{competitionId:'old'}),milestone('finished-d',{competitionId:'finished'}),milestone('defense',{competitionId:'submitted',date:'2026-10-09'}));
 data.tasks.push(task('done-task',{done:true}),task('archived-task',{archived:true}),task('old-task',{competitionId:'old'}));
 const before=JSON.stringify(data);
 assert.deepEqual(summarizeCompetitions(data,{now}),{active:2,upcoming:2,overdue:1,unfinishedTasks:1,completedTasks:1});
 assert.equal(nearestCompetitionDeadline(data,'contest',now).id,'late');
 assert.deepEqual(competitionProgress(data,'contest'),{done:1,total:2,percent:50});
 assert.deepEqual(competitionProgress(data,'missing'),{done:0,total:0,percent:0});
 assert.equal(JSON.stringify(data),before);
});

test('calendar copy is explicit, stable, detached and preserves exact time in an all-day mark',()=>{
 const source=sample(),before=JSON.stringify(source),entry=createCompetitionCalendarEvent(source.items[0],source.milestones[0],now);
 assert.equal(entry.id,'competition-deadline');assert.equal(entry.kind,'mark');assert.equal(entry.allDay,true);assert.equal(entry.startTime,'');
 assert.match(entry.notes,/2026-10-08 18:00 · 北京时间/);assert.match(entry.notes,/不会自动覆盖/);
 assert.equal(createCompetitionCalendarEvent(source.items[0],source.milestones[0],now).id,entry.id);
 source.milestones[0].date='2026-10-10';assert.equal(entry.startDate,'2026-10-08');
 assert.equal(JSON.parse(before).milestones[0].date,'2026-10-08');
 assert.throws(()=>createCompetitionCalendarEvent(item('other'),milestone(),now),/不匹配/);
 const noTime=createCompetitionCalendarEvent(item(),milestone('no-time',{time:''}),now);assert.match(noTime.notes,/未填写具体时刻/);
});

test('initialization is empty and additive merge is idempotent with current edits winning',()=>{
 const state={tasks:[{id:'global-task'}],calendar:{events:[]}};initializeCompetitions(state);assert.deepEqual(state.competitions,{version:1,items:[],milestones:[],tasks:[]});assert.equal(state.tasks.length,1);
 const current=sample(),incoming=sample();current.items[0].title='用户修改后的比赛名称';incoming.tasks.push(task('extra'));
 const merged=mergeCompetitions(current,incoming);assert.equal(merged.items[0].title,current.items[0].title);assert.equal(merged.tasks.length,2);
 assert.deepEqual(mergeCompetitions(merged,incoming),merged);assert.equal(current.tasks.length,1);
 assert.deepEqual(mergeCompetitions(undefined,undefined),{version:1,items:[],milestones:[],tasks:[]});
});
