import test from 'node:test';
import assert from 'node:assert/strict';
import {STUDY_ACTION_ADAPTERS as adapters} from '../src/workspace-actions-study.js';
import {assignRecordColor} from '../src/creation-colors.js';
import {validateCalendar} from '../src/calendar-model.js';
import {validateTimetable} from '../src/timetable-model.js';
import {applyWorkspaceActions,previewWorkspaceActions,undoWorkspaceActions} from '../src/workspace-actions.js';
import {validateBackup} from '../src/backup.js';

const date='2026-09-21T04:00:00.000Z';
const term={id:'existing-term',title:'秋季学期',campus:'呈贡',weekOne:'2026-08-31',totalWeeks:20,teachingWeeks:18,notes:'',periods:[{id:1,start:'08:30',end:'09:15'},{id:2,start:'09:25',end:'10:10'}],entries:[]};
function fixture(){return {profile:{name:'同学',major:'软件工程',provider:'deepseek'},ui:{sidebarPinned:false,lastCreatedColor:'#AE88FF'},calendar:{version:1,events:[]},timetable:{version:1,activeTermId:term.id,terms:[structuredClone(term)]},english:{plan:{examDate:'',target:'',dailyMinutes:'',focus:'reading'},words:[],sessions:[],mistakes:[],attempts:[],readingAnswers:{},readingResult:null,drafts:{writing:'旧草稿',translation:'',listening:''},draftUpdatedAt:{},audio:null},courses:[{id:'course-1'}],spaces:[{id:'space-1'}],tasks:[],captures:[]};}
function context(extra={}){let count=0;return {uid:()=>`created-${++count}`,now:date,requestId:'request-test',assignColor:assignRecordColor,userTexts:['我今天实际读了 25 分钟英语。','我已经掌握 perspective 这个词。','我已经回顾这道错题。'],resolveReference:(value,entities)=>value==='$newterm'&&entities.includes('timetableTerm')?'created-1':value,...extra};}
const action=(entity,operation,data={},extra={})=>({entity,operation,data,...extra});
const apply=(state,value,ctx=context())=>adapters[value.entity].apply(state,value,ctx);
const undo=(state,item,ctx=context())=>adapters[item.entity].undo(state,item,ctx);

test('calendar creates a dated plan with random non-repeating color, without timetable writes',()=>{
  const state=fixture(),before=structuredClone(state.timetable),ctx=context();
  const first=apply(state,action('calendarEvent','create',{title:'学生会会议',startDate:'2026-10-01'}),ctx);
  const second=apply(state,action('calendarEvent','create',{title:'国庆备注',kind:'note',startDate:'2026-10-02',color:'#123456'}),ctx);
  assert.equal(first.after.startDate,first.after.endDate);
  assert.equal(first.after.allDay,true);
  assert.equal(first.after.kind,'plan');
  assert.notEqual(first.after.color,'#AE88FF');
  assert.equal(second.after.color,'#123456');
  assert.deepEqual(state.timetable,before);
  assert.deepEqual(validateCalendar(state.calendar),state.calendar);
});

test('calendar rejects impossible dates, hidden timed/all-day mismatch and wrong chronological ranges',()=>{
  for(const data of [{title:'错日期',startDate:'2026-02-30'},
    {title:'逆序',startDate:'2026-10-02',endDate:'2026-10-01'},
    {title:'定时缺失',startDate:'2026-10-01',allDay:false,startTime:'10:00'},
    {title:'时间丢失',startDate:'2026-10-01',startTime:'10:00',endTime:'11:00'},
    {title:'逆时',startDate:'2026-10-01',allDay:false,startTime:'10:00',endTime:'09:00'}]){
    const state=fixture();assert.throws(()=>apply(state,action('calendarEvent','create',data)));assert.equal(state.calendar.events.length,0);
  }
});

test('calendar update, archive, restore and safe undo keep intervening edits',()=>{
  const state=fixture();const created=apply(state,action('calendarEvent','create',{title:'会议',startDate:'2026-10-01'}));
  const edit=apply(state,action('calendarEvent','update',{notes:'带纸笔',important:true},{id:created.id}));
  assert.equal(state.calendar.events[0].notes,'带纸笔');
  const archived=apply(state,action('calendarEvent','archive',{}, {id:created.id}));assert.equal(state.calendar.events[0].archived,true);
  assert.equal(undo(state,archived),true);
  const restored=apply(state,action('calendarEvent','restore',{}, {id:created.id}));assert.equal(state.calendar.events[0].archived,false);
  assert.equal(undo(state,restored),true);
  state.calendar.events[0].notes='用户后来改了';
  assert.equal(undo(state,edit),false);assert.equal(state.calendar.events[0].notes,'用户后来改了');
});

test('timetable requires real Monday, explicit periods and consistent weeks, separated from calendar',()=>{
  const state=fixture(),ctx=context();
  const created=apply(state,action('timetableTerm','create',{title:'春季学期',weekOne:'2027-02-22',totalWeeks:20,periods:term.periods}),ctx);
  const entry=apply(state,action('timetableEntry','create',{title:'软件工程',weekday:4,startPeriod:1,endPeriod:2,weeks:[1,3,5]},{containerId:'$newterm'}),ctx);
  assert.equal(entry.containerId,created.id);
  assert.equal(state.timetable.terms[1].entries[0].title,'软件工程');
  assert.deepEqual(state.calendar,{version:1,events:[]});
  assert.deepEqual(validateTimetable(state.timetable),state.timetable);
  assert.throws(()=>apply(fixture(),action('timetableTerm','create',{title:'错周一',weekOne:'2027-02-23',totalWeeks:20,periods:term.periods})),/星期一/);
  assert.throws(()=>apply(fixture(),action('timetableTerm','create',{title:'没节次',weekOne:'2027-02-22',totalWeeks:20})),/periods/);
  for(const values of [{weeks:[21]},{weeks:[1,1]},{weekday:0},{startPeriod:1,endPeriod:3}])assert.throws(()=>apply(fixture(),action('timetableEntry','create',{title:'无效',weekday:1,startPeriod:1,endPeriod:2,weeks:[1],...values},{containerId:term.id})));
});

test('timetable shrinking a term cannot invalidate existing entries and container scope is mandatory',()=>{
  const state=fixture();const created=apply(state,action('timetableEntry','create',{title:'课程',weekday:2,startPeriod:1,endPeriod:2,weeks:[18]},{containerId:term.id}));
  const before=structuredClone(state.timetable);
  assert.throws(()=>apply(state,action('timetableTerm','update',{totalWeeks:10,teachingWeeks:10},{id:term.id})));
  assert.deepEqual(state.timetable,before);
  assert.throws(()=>apply(state,action('timetableEntry','update',{title:'新名称'},{id:created.id})),/所属学期/);
  const archive=apply(state,action('timetableEntry','archive',{}, {id:created.id,containerId:term.id}));
  assert.equal(state.timetable.terms[0].entries[0].archived,true);assert.equal(undo(state,archive),true);
});

test('new term and its child undo in reverse order; active term prevents unsafe removal',()=>{
  const state=fixture(),ctx=context();
  const created=apply(state,action('timetableTerm','create',{title:'春季',weekOne:'2027-02-22',totalWeeks:20,periods:term.periods}),ctx);
  const entry=apply(state,action('timetableEntry','create',{title:'新课程',weekday:1,startPeriod:1,endPeriod:2,weeks:[1]},{containerId:created.id}),ctx);
  assert.equal(undo(state,created),false);
  assert.equal(undo(state,entry),true);
  const settings=apply(state,action('timetableSettings','update',{activeTermId:'$newterm'},{id:'timetable-settings'}),ctx);
  assert.equal(state.timetable.activeTermId,created.id);
  assert.equal(undo(state,created),false);
  assert.equal(undo(state,settings),true);
  assert.equal(undo(state,created),true);
  assert.equal(state.timetable.terms.length,1);
});

test('English plan accepts unset user choices and does not alter practice accomplishments',()=>{
  const state=fixture();
  const change=apply(state,action('englishPlan','update',{target:550,dailyMinutes:30,focus:'listening'},{id:'english-plan'}));
  assert.deepEqual(state.english.plan,{examDate:'',target:550,dailyMinutes:30,focus:'listening'});
  assert.equal(state.english.sessions.length,0);assert.equal(state.english.attempts.length,0);
  assert.equal(undo(state,change),true);
  for(const data of [{examDate:'2026-02-30'},{dailyMinutes:0},{target:10000},{target:0},{target:7.25},{target:Infinity},{focus:'score'}])assert.throws(()=>apply(fixture(),action('englishPlan','update',data,{id:'english-plan'})));
});

test('English target scores allow optional half-point goals without converting legacy scores or accomplishments',()=>{
  const state=fixture();state.english.plan.target=550;
  const originalPractice=structuredClone({sessions:state.english.sessions,attempts:state.english.attempts});
  for(const target of [7.5,711,9999,'']){
    const change=apply(state,action('englishPlan','update',{target},{id:'english-plan'}));
    assert.equal(state.english.plan.target,target);assert.equal(undo(state,change),true);
    assert.equal(state.english.plan.target,550);
  }
  state.english.plan.target=0;
  const change=apply(state,action('englishPlan','update',{dailyMinutes:15},{id:'english-plan'}));
  assert.equal(state.english.plan.target,0);assert.equal(undo(state,change),true);assert.equal(state.english.plan.target,0);
  assert.deepEqual({sessions:state.english.sessions,attempts:state.english.attempts},originalPractice);
});

test('English words are personal and new, reject duplicates, and mastery needs actual user evidence',()=>{
  const state=fixture();const created=apply(state,action('englishWord','create',{word:'perspective',meaning:'观点'}));
  assert.equal(created.after.source,'personal');assert.equal(created.after.status,'new');
  assert.throws(()=>apply(state,action('englishWord','create',{word:'PERSPECTIVE',meaning:'视角'}),context({uid:()=> 'new-id'})),/已存在/);
  assert.throws(()=>apply(state,action('englishWord','update',{status:'mastered'},{id:created.id})),/文本|原话/);
  assert.throws(()=>apply(state,action('englishWord','update',{status:'mastered',evidence:'模型猜测已经掌握'},{id:created.id})),/实际情况/);
  const change=apply(state,action('englishWord','update',{status:'mastered',evidence:'我已经掌握 perspective 这个词。'},{id:created.id}));
  assert.equal(state.english.words[0].status,'mastered');assert.equal(Object.hasOwn(state.english.words[0],'evidence'),false);
  assert.equal(undo(state,change),true);
});

test('actual English sessions require user evidence and reject future/planned dates',()=>{
  const state=fixture();const data={date:'2026-09-21',minutes:25,type:'reading',evidence:'我今天实际读了 25 分钟英语。'};
  const created=apply(state,action('englishSession','create',data));
  assert.equal(created.after.minutes,25);assert.equal(created.after.note,'');assert.equal(state.english.attempts.length,0);
  for(const change of [{date:'2026-09-22'},{minutes:0},{minutes:721},{minutes:1.5},{evidence:'AI建议每天学习25分钟'}])assert.throws(()=>apply(fixture(),action('englishSession','create',{...data,...change})));
  assert.throws(()=>apply(state,action('englishSession','update',{minutes:30},{id:created.id})),/文本|原话/);
  const note=apply(state,action('englishSession','update',{note:'实际阅读一篇文章'},{id:created.id}));
  assert.equal(undo(state,note),true);
});

test('English mistakes store provided answers only and do not change scored results',()=>{
  const state=fixture();const created=apply(state,action('englishMistake','create',{question:'What does retain mean?',selected:'忘记',correct:'保留',date:'2026-09-21'}));
  assert.equal(created.after.reviewed,false);assert.equal(state.english.readingResult,null);assert.deepEqual(state.english.readingAnswers,{});
  assert.throws(()=>apply(state,action('englishMistake','update',{reviewed:true},{id:created.id})),/文本|原话/);
  const update=apply(state,action('englishMistake','update',{reviewed:true,evidence:'我已经回顾这道错题。'},{id:created.id}));
  assert.equal(state.english.mistakes[0].reviewed,true);assert.equal(undo(state,update),true);
});

test('English archive/restore is reversible and never changes durations or answers',()=>{
  for(const [entity,key,data] of [
    ['englishWord','words',{word:'retain',meaning:'保留'}],
    ['englishSession','sessions',{date:'2026-09-21',minutes:25,type:'reading',evidence:'我今天实际读了 25 分钟英语。'}],
    ['englishMistake','mistakes',{question:'题干',selected:'A',correct:'B',date:'2026-09-21'}],
  ]){
    const state=fixture(),created=apply(state,action(entity,'create',data));
    const archived=apply(state,action(entity,'archive',{}, {id:created.id}));
    assert.equal(state.english[key][0].archived,true);
    const restored=apply(state,action(entity,'restore',{}, {id:created.id}));
    assert.equal(state.english[key][0].archived,false);
    assert.equal(undo(state,restored),true);assert.equal(undo(state,archived),true);
    assert.equal(undo(state,created),true);assert.equal(state.english[key].length,0);
  }
});

test('English draft save has safe undo and cannot write reading scores or unknown draft keys',()=>{
  const state=fixture();const saved=apply(state,action('englishDraft','update',{content:'My revised essay.'},{id:'writing'}));
  assert.equal(state.english.drafts.writing,'My revised essay.');assert.equal(state.english.sessions.length,0);assert.equal(state.english.readingResult,null);
  assert.equal(undo(state,saved),true);assert.equal(state.english.drafts.writing,'旧草稿');assert.deepEqual(state.english.draftUpdatedAt,{});
  assert.throws(()=>apply(state,action('englishDraft','update',{content:'x'},{id:'readingResult'})));
  assert.throws(()=>apply(state,action('englishPlan','update',{readingResult:{correct:3}},{id:'english-plan'})),/不支持字段/);
});

test('profile and UI allow only non-sensitive preferences and retain unrelated values',()=>{
  const state=fixture();const profile=apply(state,action('profileSettings','update',{name:'宇宙同学'},{id:'profile-settings'}));
  assert.equal(state.profile.provider,'deepseek');assert.equal(undo(state,profile),true);
  const ui=apply(state,action('uiSettings','update',{sidebarPinned:true,inboxView:'dream'},{id:'ui-settings'}));
  assert.equal(state.ui.lastCreatedColor,'#AE88FF');assert.equal(state.ui.inboxView,'dream');assert.equal(undo(state,ui),true);assert.equal(Object.hasOwn(state.ui,'inboxView'),false);
  for(const key of ['apiKey','provider','password','auth','path'])assert.throws(()=>apply(state,action('profileSettings','update',{[key]:'x'},{id:'profile-settings'})),/不支持字段/);
});

test('canvas layout and snap changes are scoped to known boards and safely reversible',()=>{
  const state=fixture();const settings=apply(state,action('canvasSettings','update',{presentation:'stack',snap:false,stackPointer:.7},{id:'space:space-1:notes'}));
  assert.equal(state.boards['space:space-1:notes'].presentation,'stack');assert.equal(state.boards['space:space-1:notes'].snap,false);
  assert.equal(undo(state,settings),true);assert.equal(Object.hasOwn(state.boards,'space:space-1:notes'),false);
  for(const board of ['__proto__','constructor','profile','space:missing:notes','course:course-1:tasks','../../auth'])assert.throws(()=>apply(state,action('canvasSettings','update',{snap:false},{id:board})));
  for(const data of [{cards:[]},{presentation:'secret'},{stackPointer:1.1},{view:{x:0,y:0,zoom:2}}])assert.throws(()=>apply(state,action('canvasSettings','update',data,{id:'home'})));
});

test('canvas card geometry and color changes leave other cards/data intact and reject invalid dimensions',()=>{
  const state=fixture();state.canvas={cards:[{id:'ai',x:0,y:0,w:540,h:380,color:'#AE88FF'},{id:'courses',x:600,y:0,w:300,h:300,color:'#63E6DC'}],snap:true,initialized:true};
  const other=structuredClone(state.canvas.cards[1]);
  const item=apply(state,action('canvasCard','update',{x:100,y:120,w:480,h:360,color:'#112233'},{id:'ai',containerId:'home'}));
  assert.equal(state.canvas.cards[0].x,100);assert.deepEqual(state.canvas.cards[1],other);assert.equal(undo(state,item),true);
  for(const data of [{w:300},{h:300},{x:Infinity},{y:100001},{color:'javascript:alert(1)'}])assert.throws(()=>apply(state,action('canvasCard','update',data,{id:'ai',containerId:'home'})));
  state.canvas.cards[0].x=5;assert.equal(undo(state,item),false);
});

test('all adapters reject unknown properties, prototype keys and unsupported destructive operations',()=>{
  for(const adapter of Object.values(adapters)){
    assert.throws(()=>adapter.normalizeData({path:'profile.apiKey'},'update'),/不支持字段/);
    assert.throws(()=>adapter.normalizeData(JSON.parse('{"__proto__":{"polluted":true}}'),'update'),/不支持字段/);
    assert.throws(()=>adapter.normalizeData({},'delete'),/永久删除/);
  }
  assert.equal(Object.prototype.polluted,undefined);
  assert.throws(()=>adapters.timetableTerm.normalizeData({},'archive'),/不支持/);
  assert.throws(()=>adapters.englishPlan.normalizeData({},'create'),/不支持/);
});

test('real action engine and backup roundtrip preserve all study changes and reverse dependency order',async()=>{
  const state={...fixture(),schema:1,mode:'personal',courses:[],spaces:[],updatedAt:date};
  const request={id:'request-test',text:'我今天实际读了 25 分钟英语。',files:[],targetId:'workspace',status:'waiting_model',createdAt:date,updatedAt:date};
  state.aiRequests=[request];
  const actions=[
    action('calendarEvent','create',{title:'日历会议',startDate:'2026-10-01'}),
    action('englishWord','create',{word:'retain',meaning:'保留'}),
    action('englishSession','create',{date:'2026-09-21',minutes:25,type:'reading',evidence:request.text}),
    action('englishMistake','create',{question:'题干',selected:'A',correct:'B',date:'2026-09-21'}),
    action('timetableTerm','create',{title:'春季',weekOne:'2027-02-22',totalWeeks:20,periods:term.periods},{ref:'spring'}),
    action('timetableEntry','create',{title:'春季课程',weekday:1,startPeriod:1,endPeriod:2,weeks:[1]},{containerId:'$spring'}),
    action('timetableSettings','update',{activeTermId:'$spring'},{id:'timetable-settings'}),
    action('englishPlan','update',{dailyMinutes:30,target:550},{id:'english-plan'}),
    action('englishDraft','update',{content:'Review this draft.'},{id:'writing'}),
    action('profileSettings','update',{name:'新称呼'},{id:'profile-settings'}),
    action('uiSettings','update',{sidebarPinned:true,inboxView:'dream'},{id:'ui-settings'}),
    action('canvasSettings','update',{presentation:'grid-2',snap:false},{id:'home'}),
  ];
  const untouched=structuredClone(state),preview=previewWorkspaceActions(state,actions,{requestId:request.id,now:date});
  assert.equal(preview.length,12);assert.deepEqual(state,untouched);
  let seq=0;
  const receipt=applyWorkspaceActions(state,request.id,actions,{uid:()=>`roundtrip-${++seq}`,now:date});
  request.status='filed';request.receipt=receipt;
  const restored=validateBackup(JSON.parse(JSON.stringify({format:'lumi-backup',version:1,exportedAt:date,state,files:[]}))).state;
  const result=await undoWorkspaceActions({state:restored,save:()=>{}},restored.aiRequests[0].receipt,request.id);
  assert.deepEqual(result,{removed:12,retained:0});
  assert.equal(restored.calendar.events.length,0);assert.equal(restored.timetable.terms.length,1);assert.equal(restored.timetable.activeTermId,term.id);
  assert.equal(restored.english.words.length,0);assert.equal(restored.english.sessions.length,0);assert.equal(restored.english.mistakes.length,0);
  assert.equal(restored.english.drafts.writing,'旧草稿');assert.equal(restored.english.plan.dailyMinutes,'');assert.equal(restored.profile.name,'同学');assert.equal(restored.ui.sidebarPinned,false);assert.equal(restored.canvas,undefined);
});

test('engine later validation failure rolls back random colors and study domains atomically',()=>{
  const state=fixture(),original=structuredClone(state);
  assert.throws(()=>applyWorkspaceActions(state,'request-test',[
    action('calendarEvent','create',{title:'尚未保存',startDate:'2026-10-01'}),
    action('timetableEntry','create',{title:'不存在的节次',weekday:1,startPeriod:1,endPeriod:3,weeks:[1]},{containerId:term.id}),
  ],context()));
  assert.deepEqual(state,original);
});
