import test from 'node:test';
import assert from 'node:assert/strict';
import {validateWorkspaceActions,applyWorkspaceActions,previewWorkspaceActions,undoWorkspaceActions,validateWorkspaceActionSnapshot,listWorkspaceRecords,describeWorkspaceAction} from '../src/workspace-actions.js';
import {validateBackup,mergeBackup} from '../src/backup.js';
import {seedEnglish} from '../src/english.js';

const NOW='2026-09-21T10:00:00.000Z';
const fixture=()=>({spaces:[],courses:[],tasks:[],captures:[],ledger:{version:1,currency:'CNY',projects:[],entries:[]},aiRequests:[{id:'request-1',text:'建立国庆出游项目，早餐支出 18.50 元，10月1日，并整理旅行资料。',status:'waiting_model',files:[{id:'attachment-1',blobId:'blob-1',name:'行程.pdf',type:'application/pdf',size:4321,createdAt:NOW}]}],ui:{lastCreatedColor:'#AE88FF'}});
const options=()=>{let next=0;return {uid:()=>`record-${++next}`,now:NOW};};
const create=(entity,data,extra={})=>({entity,operation:'create',data,...extra});

test('actions create linked containers and move real notes/files without touching the source request',()=>{
  const state=fixture(),requests=state.aiRequests;
  const actions=[create('space',{title:'旅行'},{ref:'travel'}),create('course',{title:'软件工程',prompt:'用例驱动解释'},{ref:'course'}),
    create('note',{title:'行程',content:'10月1日出发'},{containerId:'$travel',ref:'note'}),
    create('file',{blobId:'blob-1'},{containerId:'$travel',ref:'file'}),
    {entity:'note',operation:'update',id:'$note',containerId:'$travel',data:{targetContainerId:'$course',title:'软件案例'}},
    {entity:'file',operation:'update',id:'$file',containerId:'$travel',data:{targetContainerId:'$course',name:'案例.pdf'}},
    create('task',{title:'出发前检查',spaceId:'$travel',date:'2026-10-01'}),create('capture',{text:'旅行观察',category:'灵感',tags:'旅行'})];
  const receipt=applyWorkspaceActions(state,'request-1',actions,options());
  assert.equal(state.aiRequests,requests);assert.equal(state.aiRequests[0].status,'waiting_model');
  assert.equal(state.spaces[0].notes.length,0);assert.equal(state.courses[0].notes[0].title,'软件案例');
  assert.equal(state.courses[0].files[0].blobId,'blob-1');assert.equal(state.courses[0].files[0].name,'案例.pdf');
  assert.equal(state.courses[0].files[0].size,4321);assert.equal(state.tasks[0].spaceId,state.spaces[0].id);
  assert.equal(new Set(receipt.items.map(item=>item.id)).size,actions.length);
  assert.ok(receipt.items.every(item=>item.id!==JSON.parse(item.snapshot).id));
  assert.equal(state.courses[0].notes[0].revisions[0].title,'行程');
  assert.ok(listWorkspaceRecords(state).some(row=>row.entity==='file'&&row.containerId===`course:${state.courses[0].id}`));
  for(const item of receipt.items)assert.doesNotThrow(()=>validateWorkspaceActionSnapshot(JSON.parse(item.snapshot)));
});

test('money updates use integer fen and project inclusion remains explicit',()=>{
  const state=fixture();
  const receipt=applyWorkspaceActions(state,'request-1',[create('ledgerProject',{title:'国庆出游',includeInTotal:false},{ref:'trip'}),
    create('ledgerEntry',{type:'expense',amount:'18.5',date:'2026-10-01',category:'餐饮',projectId:'$trip',note:'早餐'},{ref:'breakfast'}),
    {entity:'ledgerEntry',operation:'update',id:'$breakfast',data:{amount:'20.01',projectId:''}},
    {entity:'ledgerProject',operation:'update',id:'$trip',data:{includeInTotal:true}}],options());
  assert.equal(state.ledger.entries[0].amountCents,2001);assert.equal(state.ledger.entries[0].projectId,'');
  assert.equal(state.ledger.projects[0].includeInTotal,true);assert.equal(receipt.items.length,4);
});

test('failed later action leaves all domains, colour cursor and original references unchanged',()=>{
  const state=fixture(),before=JSON.stringify(state),spaces=state.spaces;
  assert.throws(()=>applyWorkspaceActions(state,'request-1',[create('space',{title:'先创建'},{ref:'s'}),create('ledgerEntry',{type:'expense',amount:'10',date:'2026-10-01',category:'交通',projectId:'$s'})],options()));
  assert.equal(JSON.stringify(state),before);assert.equal(state.spaces,spaces);
  assert.throws(()=>applyWorkspaceActions(state,'request-1',[create('space',{title:'先创建'},{ref:'s'}),create('file',{blobId:'invented'},{containerId:'$s'})],options()));
  assert.equal(JSON.stringify(state),before);
});

test('validation rejects arbitrary properties, fabricated ids, forward and mismatched references',()=>{
  for(const actions of [[],Array(51).fill(create('space',{title:'a'})),[create('space',{title:'a'},{id:'model-id'})],
    [create('task',{title:'a',shell:'rm'})],[{entity:'account',operation:'update',id:'x',data:{password:'abc'}}],[create('constructor',{})],
    [create('task',{title:'a',spaceId:'$later'}),create('space',{title:'b'},{ref:'later'})],
    [create('space',{title:'a'},{ref:'same'}),create('space',{title:'b'},{ref:'same'})],
    [create('space',{title:'a'},{ref:'s'}),{entity:'course',operation:'update',id:'$s',data:{title:'bad'}}],
    [create('ledgerEntry',{type:'expense',amount:'1.005',date:'2026-10-01',category:'餐饮'})],
    [create('ledgerEntry',{type:'expense',amount:'10',date:'2026-02-30',category:'餐饮'})]])assert.throws(()=>validateWorkspaceActions(actions));
});

test('archive/restore is reversible and course prompt edits retain file and note content',async()=>{
  const state=fixture(),base=applyWorkspaceActions(state,'request-1',[create('course',{title:'算法',prompt:'原偏好'},{ref:'c'}),create('note',{title:'笔记',content:'原文'},{containerId:'$c'})],options());
  const course=state.courses[0];let serial=100;
  const receipt=applyWorkspaceActions(state,'request-1',[{entity:'course',operation:'update',id:course.id,data:{prompt:'新偏好'}},{entity:'course',operation:'archive',id:course.id,data:{}},{entity:'course',operation:'restore',id:course.id,data:{}}],{uid:()=>`later-${++serial}`,now:NOW});
  assert.equal(state.courses[0].archived,false);assert.equal(state.courses[0].notes[0].content,'原文');
  const result=await undoWorkspaceActions({state,save:()=>{}},receipt,'request-1');assert.equal(result.removed,3);assert.equal(state.courses[0].prompt,'原偏好');
  await undoWorkspaceActions({state,save:()=>{}},base,'request-1');assert.equal(state.courses.length,0);
});

test('undo keeps edited child and its parent, and rolls all changes back if persistence fails',async()=>{
  const state=fixture();
  const receipt=applyWorkspaceActions(state,'request-1',[create('space',{title:'旅行'},{ref:'s'}),create('note',{title:'行程',content:'初稿'},{containerId:'$s'}),create('task',{title:'准备行李'})],options());
  state.spaces[0].notes[0].content='用户修改后的真实内容';
  const before=JSON.stringify(state);
  await assert.rejects(()=>undoWorkspaceActions({state,save:()=>{throw new Error('storage unavailable');}},receipt,'request-1'));
  assert.equal(JSON.stringify(state),before);
  const result=await undoWorkspaceActions({state,save:()=>{}},receipt,'request-1');
  assert.equal(result.removed,1);assert.equal(result.retained,2);assert.equal(state.spaces[0].notes[0].content,'用户修改后的真实内容');
  assert.equal(state.tasks.length,0);
});

test('ledger project undo retains project when another entry depends on it',async()=>{
  const state=fixture();const receipt=applyWorkspaceActions(state,'request-1',[create('ledgerProject',{title:'活动'})],options());
  const projectId=state.ledger.projects[0].id;let n=100;
  applyWorkspaceActions(state,'request-1',[create('ledgerEntry',{type:'income',amount:'100',date:'2026-10-01',category:'经费',projectId})],{now:NOW,uid:()=>`next-${++n}`});
  const result=await undoWorkspaceActions({state,save:()=>{}},receipt,'request-1');assert.equal(result.retained,1);assert.equal(state.ledger.projects.length,1);
});

test('undo keeps a parent space with a later customized internal canvas',async()=>{
  const state=fixture();const receipt=applyWorkspaceActions(state,'request-1',[create('space',{title:'项目空间'})],options());
  const spaceId=state.spaces[0].id;state.boards={[`space:${spaceId}:overview`]:{cards:[],snap:true,initialized:true,customized:true}};
  const result=await undoWorkspaceActions({state,save:()=>{}},receipt,'request-1');assert.equal(result.retained,1);assert.equal(state.spaces.length,1);
});

test('preview is read-only and shows changed amounts, project settings and moves as human-readable fields',()=>{
  const state=fixture(),before=JSON.stringify(state);
  const preview=previewWorkspaceActions(state,[create('ledgerProject',{title:'旅行',includeInTotal:false},{ref:'p'}),create('ledgerEntry',{type:'expense',amount:'123.45',date:'2026-10-01',category:'交通',projectId:'$p'})],{requestId:'request-1',now:NOW});
  assert.equal(JSON.stringify(state),before);assert.ok(preview[1].fields.some(field=>field.label==='金额'&&field.after==='¥123.45'));
  assert.equal(preview[1].destination,'旅行');assert.ok(preview[0].fields.some(field=>field.label==='计入总账单'&&field.after==='否'));
  assert.equal(describeWorkspaceAction(create('task',{title:'整理资料'})).title,'整理资料');
});

function completeFixture(){return {...fixture(),schema:1,mode:'personal',profile:{name:'测试',major:'软件工程',provider:'deepseek'},english:seedEnglish(false),updatedAt:NOW};}
function restoreThroughBackup(source){
  const backup=validateBackup(JSON.parse(JSON.stringify({format:'lumi-backup',version:1,exportedAt:NOW,state:source,files:[]})));
  return mergeBackup({schema:1,mode:'personal',profile:{name:'测试',major:'软件工程',provider:'deepseek'},courses:[],tasks:[],captures:[],english:seedEnglish(false),updatedAt:NOW},backup).state;
}
function attachReceipt(state,receipt){Object.assign(state.aiRequests[0],{status:'filed',targetId:'auto',receipt,createdAt:NOW,updatedAt:NOW});}

test('backup export/import permits reverse undo of repeated core record changes and nested moves',async()=>{
  const state=completeFixture();
  const actions=[create('space',{title:'旅行'},{ref:'s'}),create('course',{title:'算法'},{ref:'c'}),
    create('note',{title:'行程',content:'初稿'},{containerId:'$s',ref:'n'}),create('file',{blobId:'blob-1'},{containerId:'$s',ref:'f'}),
    {entity:'note',operation:'update',id:'$n',containerId:'$s',data:{title:'第二稿',content:'修订正文',targetContainerId:'$c'}},
    {entity:'file',operation:'update',id:'$f',containerId:'$s',data:{name:'重命名.pdf',targetContainerId:'$c'}},
    create('ledgerProject',{title:'旅行账本',includeInTotal:false},{ref:'p'}),
    create('ledgerEntry',{type:'expense',amount:'12.50',date:'2026-10-01',category:'交通',projectId:'$p'},{ref:'e'}),
    {entity:'ledgerEntry',operation:'update',id:'$e',data:{amount:'15.75'}},
    create('task',{title:'准备行李',spaceId:'$s'},{ref:'t'}),{entity:'task',operation:'update',id:'$t',data:{done:true}},
    create('capture',{text:'旅行观察'},{ref:'i'}),{entity:'capture',operation:'update',id:'$i',data:{category:'备忘',tags:'旅行'}}];
  const receipt=applyWorkspaceActions(state,'request-1',actions,options());attachReceipt(state,receipt);
  const restored=restoreThroughBackup(state),restoredReceipt=restored.aiRequests[0].receipt;
  assert.equal(restoredReceipt.items.length,actions.length);
  const result=await undoWorkspaceActions({state:restored,save:()=>{}},restoredReceipt,'request-1');
  assert.equal(result.removed,actions.length);assert.equal(result.retained,0);
  for(const key of ['spaces','courses','tasks','captures'])assert.deepEqual(restored[key],[]);
  assert.deepEqual(restored.ledger.projects,[]);assert.deepEqual(restored.ledger.entries,[]);
});

test('backup normalization keeps original sparse before snapshots and does not block valid undo',async()=>{
  const state=completeFixture();
  state.courses=[{id:'legacy-course',title:'旧课程',notes:[{id:'legacy-note',title:'旧笔记',content:'原文'}],files:[]}];
  state.tasks=[{id:'legacy-task',title:'旧待办'}];state.captures=[{id:'legacy-capture',text:'旧灵感'}];
  const actions=[{entity:'note',operation:'update',id:'legacy-note',containerId:'course:legacy-course',data:{content:'修改正文'}},
    {entity:'task',operation:'update',id:'legacy-task',data:{done:true}},{entity:'capture',operation:'update',id:'legacy-capture',data:{category:'备忘'}}];
  const receipt=applyWorkspaceActions(state,'request-1',actions,options());attachReceipt(state,receipt);
  const beforeSnapshots=receipt.items.map(item=>JSON.parse(item.snapshot).before);
  const restored=restoreThroughBackup(state),roundtripReceipt=restored.aiRequests[0].receipt;
  assert.deepEqual(roundtripReceipt.items.map(item=>JSON.parse(item.snapshot).before),beforeSnapshots);
  const result=await undoWorkspaceActions({state:restored,save:()=>{}},roundtripReceipt,'request-1');
  assert.equal(result.removed,3);assert.equal(result.retained,0);
  assert.deepEqual(restored.courses[0].notes[0],{id:'legacy-note',title:'旧笔记',content:'原文'});
  assert.deepEqual(restored.tasks[0],{id:'legacy-task',title:'旧待办'});
  assert.deepEqual(restored.captures[0],{id:'legacy-capture',text:'旧灵感'});
});

test('edited note/file and parent dependencies remain protected after backup import',async()=>{
  const state=completeFixture();const actions=[create('space',{title:'旅行'},{ref:'s'}),create('course',{title:'算法'},{ref:'c'}),
    create('note',{title:'计划',content:'原文'},{containerId:'$s',ref:'n'}),create('file',{blobId:'blob-1'},{containerId:'$c'})];
  const receipt=applyWorkspaceActions(state,'request-1',actions,options());attachReceipt(state,receipt);
  state.spaces[0].notes[0].content='用户保留内容';state.courses[0].files[0].name='用户重命名.pdf';
  const restored=restoreThroughBackup(state);const result=await undoWorkspaceActions({state:restored,save:()=>{}},restored.aiRequests[0].receipt,'request-1');
  assert.equal(result.removed,0);assert.equal(result.retained,4);
  assert.equal(restored.spaces[0].notes[0].content,'用户保留内容');assert.equal(restored.courses[0].files[0].name,'用户重命名.pdf');
});

test('all study/settings adapters run through the actual transaction engine and backup roundtrip undo',async()=>{
  const state=completeFixture();state.ui.sidebarPinned=false;
  state.aiRequests[0].text='2026年9月20日我实际阅读了30分钟，已掌握 serendipity，也已经回顾这道错题。';
  state.canvas={cards:[{id:'home-card',x:0,y:0,w:260,h:260,color:'#AE88FF'}],snap:true,initialized:true};
  const actions=[
    create('calendarEvent',{title:'周末出游',startDate:'2026-10-01'}),
    create('timetableTerm',{title:'秋季学期',weekOne:'2026-09-21',totalWeeks:18,periods:[{id:1,start:'08:30',end:'09:15'}]},{ref:'term'}),
    create('timetableEntry',{title:'软件工程',weekday:1,startPeriod:1,endPeriod:1,weeks:[1,2,3]},{containerId:'$term'}),
    {entity:'timetableSettings',operation:'update',id:'timetable-settings',data:{activeTermId:'$term'}},
    {entity:'englishPlan',operation:'update',id:'english-plan',data:{dailyMinutes:30}},
    create('englishWord',{word:'serendipity',meaning:'意外发现珍奇事物的本领',status:'mastered',evidence:'已掌握 serendipity'}),
    create('englishSession',{date:'2026-09-20',minutes:30,type:'reading',evidence:'我实际阅读了30分钟'}),
    create('englishMistake',{question:'Choose the correct word',selected:'A',correct:'B',date:'2026-09-20',reviewed:true,evidence:'已经回顾这道错题'}),
    {entity:'englishDraft',operation:'update',id:'writing',data:{content:'This is my revised essay.'}},
    {entity:'profileSettings',operation:'update',id:'profile-settings',data:{name:'宇宙同学'}},
    {entity:'uiSettings',operation:'update',id:'ui-settings',data:{sidebarPinned:true,inboxView:'dream'}},
    {entity:'canvasSettings',operation:'update',id:'home',data:{presentation:'grid-2',snap:false}},
    {entity:'canvasCard',operation:'update',id:'home-card',containerId:'home',data:{x:100,y:200,color:'#63E6DC'}},
    {entity:'canvasSettings',operation:'update',id:'tasks',data:{presentation:'stack'}},
  ];
  const receipt=applyWorkspaceActions(state,'request-1',actions,options());attachReceipt(state,receipt);
  assert.equal(state.calendar.events.length,1);assert.equal(state.timetable.terms[0].entries.length,1);
  assert.equal(state.timetable.activeTermId,state.timetable.terms[0].id);assert.equal(state.english.sessions[0].minutes,30);
  assert.equal(state.profile.name,'宇宙同学');assert.equal(state.canvas.cards[0].x,100);
  assert.equal(state.boards.tasks.presentation,'stack');
  const restored=validateBackup(JSON.parse(JSON.stringify({format:'lumi-backup',version:1,exportedAt:NOW,state,files:[]}))).state,result=await undoWorkspaceActions({state:restored,save:()=>{}},restored.aiRequests[0].receipt,'request-1');
  assert.equal(result.removed,actions.length);assert.equal(result.retained,0);
  assert.deepEqual(restored.calendar.events,[]);assert.deepEqual(restored.timetable.terms,[]);
  assert.equal(restored.english.sessions.length,0);assert.equal(restored.english.words.length,seedEnglish(false).words.length);assert.equal(restored.english.mistakes.length,0);
  assert.equal(restored.english.drafts.writing,'');assert.equal(restored.profile.name,'测试');
  assert.equal(restored.canvas.cards[0].x,0);assert.equal(restored.canvas.snap,true);assert.equal(restored.boards.tasks,undefined);
});
