import test from 'node:test';
import assert from 'node:assert/strict';
import {projectCalendarLinks,CALENDAR_LINK_SOURCES} from '../src/calendar-links.js';
import {listWorkspaceRecords} from '../src/workspace-actions.js';

const task=(id,patch={})=>({id,title:`待办${id}`,date:'2026-10-08',description:'原始待办说明',done:false,archived:false,priority:'normal',...patch});
const competition=(id,patch={})=>({id,title:`比赛${id}`,color:'#FF9CCE',status:'preparing',archived:false,...patch});
const milestone=(id,patch={})=>({id,title:`节点${id}`,competitionId:'contest',date:'2026-10-08',time:'',done:false,archived:false,...patch});
const preparation=(id,patch={})=>({id,title:`准备${id}`,competitionId:'contest',date:'2026-10-08',notes:'要做的事情',done:false,archived:false,...patch});
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};

test('projection is read-only, tolerates old states, and never creates calendar or source data',()=>{
  for(const state of [undefined,null,{}, {tasks:null,spaces:{},courses:'invalid',aiRequests:[],competitions:{items:null,milestones:{}},english:{plan:null}}])assert.deepEqual(projectCalendarLinks(state),[]);
  const state=freeze({tasks:[task('one')],english:{plan:{examDate:'2026-12-12'}},competitions:{items:[competition('contest')],milestones:[milestone('deadline')],tasks:[preparation('prepare')]}});
  const before=JSON.stringify(state),projected=projectCalendarLinks(state);assert.equal(projected.length,4);assert.equal(JSON.stringify(state),before);assert.equal(Object.hasOwn(state,'calendar'),false);
  projected[0].title='只修改返回值';assert.equal(JSON.stringify(state),before);assert.deepEqual(CALENDAR_LINK_SOURCES,{tasks:'待办',competitions:'比赛',english:'六级'});
  assert.ok(projected.every(item=>item.readOnly&&item.archived===false));
});

test('dated global and space tasks retain local date, done state, notes, importance and real edit addresses',()=>{
  const state={spaces:[{id:'space',title:'学生会',color:'#63E6DC'}],tasks:[task('global',{done:true,priority:'high',color:'#123456'}),task('space-task',{spaceId:'space'}),task('undated',{date:''}),task('bad',{date:'2026-02-30'}),task('instant',{date:'2026-10-08T23:00:00Z'}),task('archived',{archived:true})]};
  const rows=projectCalendarLinks(state);assert.equal(rows.length,2);const global=rows.find(row=>row.sourceId==='global'),space=rows.find(row=>row.sourceId==='space-task');
  assert.equal(global.startDate,'2026-10-08');assert.equal(global.endDate,'2026-10-08');assert.equal(global.allDay,true);assert.equal(global.startTime,'');assert.equal(global.done,true);assert.equal(global.important,true);assert.equal(global.color,'#123456');assert.equal(global.notes,'原始待办说明');
  assert.equal(global.entity,'task');assert.equal(global.containerId,'workspace');assert.equal(global.route,'tasks');assert.equal(global.subroute,'global');
  assert.equal(space.sourceLabel,'空间待办');assert.equal(space.parentId,'space');assert.equal(space.parentTitle,'学生会');assert.equal(space.color,'#63E6DC');assert.equal(space.containerId,'workspace');
});

test('only structured parent links affect archival visibility; no guessing from source text',()=>{
  const state={spaces:[{id:'active',title:'当前空间'},{id:'old',title:'旧空间',archived:true}],courses:[{id:'course',title:'软件工程',archived:true},{id:'active-course',title:'数据库',color:'#9DC5FF'}],
    aiRequests:[{id:'from-course',receipt:{destinationId:'course:course'}},{id:'from-space',receipt:{destinationId:'space:old'}},{id:'course-active',receipt:{destinationId:'course:active-course'}}],
    tasks:[task('space-archived',{spaceId:'old'}),task('course-archived',{sourceRequestId:'from-course'}),task('request-space-archived',{sourceRequestId:'from-space'}),task('missing-parent',{spaceId:'deleted'}),
      task('moved',{spaceId:'active',sourceRequestId:'from-course'}),task('detached',{spaceId:'',sourceRequestId:'from-space'}),task('free-text',{source:'AI 整理 · 软件工程'}),task('active-course-task',{sourceRequestId:'course-active'}),task('explicit-readonly-course',{courseId:'course'})]};
  const rows=projectCalendarLinks(state);assert.deepEqual(new Set(rows.map(row=>row.sourceId)),new Set(['moved','detached','free-text','active-course-task']));
  const course=rows.find(row=>row.sourceId==='active-course-task');assert.equal(course.sourceLabel,'课程待办');assert.equal(course.parentTitle,'数据库');assert.equal(course.containerId,'workspace');assert.equal(course.parentType,'course');
  assert.equal(rows.find(row=>row.sourceId==='detached').parentId,undefined);assert.equal(rows.find(row=>row.sourceId==='free-text').sourceLabel,'待办');
});

test('competition dates remain exact, point deadlines keep Beijing time, and finished/done history stays visible',()=>{
  const state={competitions:{items:[competition('contest',{status:'finished'}),competition('hidden',{archived:true})],milestones:[milestone('timed',{time:'00:05',done:true}),milestone('all-day'),milestone('bad-time',{time:'25:00'}),milestone('bad-date',{date:'2026-13-01'}),milestone('hidden-child',{archived:true}),milestone('hidden-parent',{competitionId:'hidden'}),milestone('orphan',{competitionId:'missing'})],tasks:[preparation('task-done',{done:true}),preparation('no-date',{date:''}),preparation('hidden-task',{archived:true})]}};
  const rows=projectCalendarLinks(state);assert.equal(rows.length,3);const timed=rows.find(row=>row.sourceId==='timed');
  assert.equal(timed.kind,'mark');assert.equal(timed.startDate,'2026-10-08');assert.equal(timed.startTime,'00:05');assert.equal(timed.endTime,'00:05');assert.equal(timed.allDay,false);assert.equal(timed.timeZone,'Asia/Shanghai');assert.equal(timed.done,true);
  assert.equal(timed.entity,'competitionMilestone');assert.equal(timed.containerId,'contest');assert.equal(timed.route,'competitions');assert.equal(timed.subroute,'contest');assert.equal(timed.parentStatus,'已结束');assert.equal(timed.parentStatusCode,'finished');
  assert.equal(rows.find(row=>row.sourceId==='all-day').allDay,true);assert.equal(rows.find(row=>row.sourceId==='task-done').kind,'plan');assert.equal(rows.find(row=>row.sourceId==='task-done').notes,'要做的事情');
});

test('the explicitly configured CET-6 exam date projects its actual plan identity without inventing completion or exam times',()=>{
  const state={english:{plan:{examDate:'2026-12-12',target:550,dailyMinutes:30}}};const [row]=projectCalendarLinks(state);
  assert.equal(row.id,'linked:englishExam:english-plan');assert.equal(row.entity,'englishPlan');assert.equal(row.sourceType,'englishExam');assert.equal(row.sourceId,'english-plan');assert.equal(row.containerId,'');assert.equal(row.route,'english');assert.equal(row.subroute,'');assert.equal(row.allDay,true);assert.equal(row.done,false);assert.equal(row.startDate,'2026-12-12');assert.equal(row.startTime,'');
  const actual=listWorkspaceRecords(state).find(item=>item.entity===row.entity&&item.id===row.sourceId);assert.ok(actual);assert.equal(actual.containerId,row.containerId);
  for(const date of ['',null,'2026-02-29','12月12日'])assert.equal(projectCalendarLinks({english:{plan:{examDate:date}}}).length,0);
  assert.equal(projectCalendarLinks({english:{plan:{examDate:'2000-01-01'}}})[0].done,false);
});

test('independent competition calendar copies are always preserved and explicitly identified, even after edits or date changes',()=>{
  const state={calendar:{version:1,events:[{id:'competition-deadline',title:'我自己的独立名称',kind:'note',startDate:'2026-10-08',endDate:'2026-10-08',notes:'用户独立修改的内容',done:false,archived:false}]},competitions:{items:[competition('contest')],milestones:[milestone('deadline',{date:'2026-10-15'})],tasks:[]}};
  const before=JSON.stringify(state.calendar),rows=projectCalendarLinks(state);assert.equal(rows.length,1);assert.equal(rows[0].startDate,'2026-10-15');assert.equal(rows[0].independentCopyId,'competition-deadline');assert.equal(rows[0].independentCopyArchived,false);assert.match(rows[0].sourceHint,/独立标注/);assert.equal(JSON.stringify(state.calendar),before);
  state.calendar.events[0].archived=true;const [archivedCopy]=projectCalendarLinks(state);assert.equal(archivedCopy.independentCopyArchived,true);assert.match(archivedCopy.sourceHint,/已归档/);
  state.competitions.milestones[0].archived=true;assert.equal(projectCalendarLinks(state).length,0);assert.equal(state.calendar.events.length,1);
});

test('ledger activity, fitness logs, English session dates, free text and the timetable do not become calendar plans',()=>{
  const state={tasks:[task('text-only',{date:'',description:'2026-10-08开会'})],ledger:{projects:[{id:'trip',title:'10月8日旅行',createdAt:'2026-10-08T00:00:00Z',startDate:'2026-10-08'}],entries:[{date:'2026-10-08',amountCents:1500}]},fitness:{entries:[{date:'2026-10-08',minutes:30}]},english:{plan:{examDate:''},sessions:[{date:'2026-10-08',minutes:20}]},timetable:{terms:[{id:'term',weekOne:'2026-10-05',entries:[{weekday:4,weeks:[1]}]}]}};
  const before=JSON.stringify(state);
  assert.deepEqual(projectCalendarLinks(state),[]);assert.equal(JSON.stringify(state),before);
});

test('projection identifiers distinguish domains and refresh from source changes without leaving stale events behind',()=>{
  const state={tasks:[task('shared'),task('shared'),null,{id:'missing-title',date:'2026-10-08'}],competitions:{items:[competition('contest')],milestones:[milestone('shared')],tasks:[preparation('shared')]}};
  const first=projectCalendarLinks(state);assert.equal(first.length,3);assert.equal(new Set(first.map(row=>row.id)).size,3);
  state.tasks[0].date='2026-10-20';state.tasks[1].date='2026-10-20';state.competitions.milestones[0].done=true;
  const second=projectCalendarLinks(state);assert.equal(second.find(row=>row.entity==='task').startDate,'2026-10-20');assert.equal(second.find(row=>row.entity==='competitionMilestone').done,true);assert.equal(first.find(row=>row.entity==='task').startDate,'2026-10-08');
});
