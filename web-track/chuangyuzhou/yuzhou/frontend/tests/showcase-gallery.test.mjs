import test from 'node:test';
import assert from 'node:assert/strict';
import {planShowcaseGallery,installShowcaseGallery,hasShowcaseGallery,SHOWCASE_GALLERY_SPACE_ID,SHOWCASE_GALLERY_FITNESS_ID,SHOWCASE_GALLERY_COURSE_IDS,SHOWCASE_GALLERY_BLOCK_IDS} from '../src/showcase-gallery.js';
import {planShowcaseExamples,SHOWCASE_SPACE_ID} from '../src/showcase-examples.js';
import {createWorkbench,WORKBENCH_MODULES} from '../src/workbench-model.js';
import {validateBackup,mergeBackup} from '../src/backup.js';
import {projectCalendarLinks} from '../src/calendar-links.js';
import {selectFitnessEntries,summarizeFitness} from '../src/fitness-model.js';
import {weekForDate,entriesForWeek} from '../src/timetable-model.js';
import {createPresetInput} from '../src/custom-block-presets.js';

const now=new Date(2026,11,30,23,58),stamp=now.toISOString();
const fixture=()=>({schema:1,mode:'personal',profile:{name:'已有用户',major:'保留',provider:'deepseek'},courses:[],spaces:[],tasks:[],captures:[],english:{drafts:{writing:'保留我的原稿'},readingAnswers:{q1:1}},workbench:createWorkbench('blank'),updatedAt:stamp});
const plan=state=>planShowcaseGallery(state,{now});
const oldPlan=state=>planShowcaseExamples(state,{now});
const thaw=state=>structuredClone(state);
const normalized=state=>validateBackup({format:'lumi-backup',version:1,exportedAt:stamp,state,files:[]}).state;
const exampleRows=state=>[...state.courses,...state.spaces,...state.courses.flatMap(row=>row.notes),...state.spaces.flatMap(row=>row.notes),...state.tasks,...state.captures];

test('detached plan fills all modules and counts actual additions without changing English or AI state',()=>{
  const state=fixture(),before=thaw(state),result=plan(state),next=result.nextState;
  assert.deepEqual(state,before);assert.equal(Object.isFrozen(state),false);assert.equal(Object.isFrozen(next),true);
  assert.equal(result.rootSpaceId,SHOWCASE_GALLERY_SPACE_ID);assert.equal(result.alreadyInstalled,false);
  assert.deepEqual(result.summary,{spaces:3,notes:7,tasks:5,captures:13,competitions:1,milestones:2,competitionTasks:2,ledgerProjects:1,ledgerEntries:2,blocks:9,courses:2,courseNotes:4,timetableTerms:1,timetableEvents:3,calendarEvents:3,fitnessSessions:4,englishReferences:2});
  assert.deepEqual(next.english,state.english);assert.equal(next.aiRequests,undefined);assert.equal(next.aiDraft,undefined);
  assert.ok(next.workbench.modules.every(row=>row.enabled));
  assert.ok(WORKBENCH_MODULES.every(row=>next.canvas.cards.some(card=>card.id===row.id)));
  assert.ok(SHOWCASE_GALLERY_COURSE_IDS.every(id=>next.courses.some(row=>row.id===id)));
  assert.ok(exampleRows(next).every(row=>row.example===true));
  assert.ok([...next.spaces,...next.courses].every(row=>row.files.length===0));
  assert.equal(next.tasks.filter(row=>row.done).length,1);assert.match(next.tasks.find(row=>row.done).title,/模拟回顾.*示例/);
  assert.ok(next.ledger.projects.every(row=>row.includeInTotal===false));
});

test('dates cross year end locally and the current week contains three independent timetable examples',()=>{
  const next=plan(fixture()).nextState,term=next.timetable.terms[0];
  assert.equal(term.weekOne,'2026-12-28');assert.equal(weekForDate(term,'2026-12-30'),1);
  assert.equal(entriesForWeek(term,1).length,3);assert.ok(term.entries.every(entry=>!Object.hasOwn(entry,'courseId')));
  assert.match(term.notes,/保持独立/);
  assert.equal(next.customBlocks.items.find(row=>row.kind==='countdown').config.date,'2027-01-06');
  assert.deepEqual(next.calendar.events.map(row=>row.startDate),['2026-12-30','2027-01-01','2027-01-02']);
  assert.equal(next.tasks.find(row=>row.id==='showcase-dev019-shared-material-task').date,'2026-12-31');
});

test('all seven block kinds are editable and miniapp reuses the existing manual-run calculator code',()=>{
  const next=plan(fixture()).nextState,blocks=next.customBlocks.items.filter(row=>SHOWCASE_GALLERY_BLOCK_IDS.includes(row.id));
  assert.equal(blocks.length,7);assert.deepEqual(new Set(blocks.map(row=>row.kind)),new Set(['note','checklist','links','progress','countdown','table','miniapp']));
  assert.ok(blocks.every(row=>row.title.includes('示例')&&row.description.includes('示例')));
  assert.ok(blocks.every(row=>!Object.hasOwn(row,'example')),'strict block schema has no example property');
  assert.ok(blocks.find(row=>row.kind==='checklist').config.items.every(row=>!row.done));
  assert.match(blocks.find(row=>row.kind==='progress').description,/模拟/);
  const miniapp=blocks.find(row=>row.kind==='miniapp');
  assert.equal(miniapp.config.code,createPresetInput('calculator',now).config.code);assert.deepEqual(miniapp.data,{});
  assert.match(miniapp.description,/点击.*运行.*才启动/);
});

test('new examples retain existing records, custom labels and order, view geometry, and active semester',()=>{
  const state=fixture(),base=plan(fixture()).nextState;
  state.courses=[{...thaw(base.courses[0]),id:'original-course',title:'已有课程',example:false}];
  state.spaces=[{...thaw(base.spaces[0]),id:'original-space',title:'已有空间',example:false,notes:[]}];
  state.courses[0].notes=[];
  state.tasks=[{...thaw(base.tasks[0]),id:'original-task',spaceId:'original-space',title:'已有任务',example:false}];
  state.captures=[{...thaw(base.captures[0]),id:'original-capture',text:'原文保留',example:false}];
  state.fitness={version:1,entries:[{...thaw(base.fitness.entries[0]),id:'original-fitness',spaceId:'original-space',note:'实际记录，不改动'}]};
  state.calendar={version:1,events:[{...thaw(base.calendar.events[0]),id:'original-calendar',title:'原生日历'}]};
  state.timetable=thaw(base.timetable);state.timetable.terms[0].id='original-term';state.timetable.terms[0].entries=[];state.timetable.activeTermId='original-term';
  state.canvas={cards:[{id:'tasks',x:-63,y:714,w:351,h:293,color:'#63E6DC'}],view:{x:71,y:-13,zoom:.53},snap:false,customized:true};
  state.courseCanvas={cards:[{id:'original-course',x:93,y:417,w:351,h:293,color:'#AE88FF'}],view:{x:12,y:18,zoom:.68},snap:false};
  state.boards={inbox:{cards:[{id:'original-capture',x:13,y:44,w:350,h:281,color:'#FF9CCE'}],view:{x:0,y:0,zoom:1},snap:false}};
  state.workbench.title='我的旧名称';state.workbench.modules.reverse();state.workbench.modules.find(row=>row.id==='english').title='我的英语';
  state.aiDraft={text:'不发送这条草稿',files:[],targetId:'auto'};
  const before=thaw(state),next=plan(state).nextState;
  for(const key of ['courses','spaces','tasks','captures'])assert.deepEqual(next[key][0],before[key][0]);
  for(const key of ['fitness','calendar'])assert.deepEqual(next[key][key==='fitness'?'entries':'events'][0],before[key][key==='fitness'?'entries':'events'][0]);
  assert.deepEqual(next.timetable.terms[0],before.timetable.terms[0]);assert.equal(next.timetable.activeTermId,'original-term');
  assert.deepEqual(next.canvas.cards[0],before.canvas.cards[0]);assert.deepEqual(next.canvas.view,before.canvas.view);assert.equal(next.canvas.snap,false);
  for(const key of ['profile','courseCanvas','boards','aiDraft','english'])assert.deepEqual(next[key],before[key]);
  assert.equal(next.workbench.title,before.workbench.title);assert.deepEqual(next.workbench.modules.map(row=>row.id),before.workbench.modules.map(row=>row.id));
  assert.equal(next.workbench.modules.find(row=>row.id==='english').title,'我的英语');assert.deepEqual(state,before);
});

test('extending an installed old package never restores modified or removed old content',()=>{
  const old=thaw(oldPlan(fixture()).nextState);old.spaces[0].title='我改过的展示项目';old.spaces[0].notes.pop();old.tasks.pop();old.customBlocks.items.shift();
  old.ledger.entries[0].note='自己改过的说明';
  const before=thaw(old),result=plan(old),next=result.nextState;
  assert.equal(result.summary.spaces,2);assert.equal(result.summary.blocks,7);assert.equal(result.summary.tasks,2);assert.equal(result.summary.ledgerEntries,0);
  assert.deepEqual(next.spaces.find(row=>row.id===SHOWCASE_SPACE_ID),before.spaces[0]);
  assert.deepEqual(next.tasks.slice(0,before.tasks.length),before.tasks);
  assert.deepEqual(next.ledger,before.ledger);assert.deepEqual(next.customBlocks.items[0],before.customBlocks.items[0]);
  assert.equal(next.tasks.length,before.tasks.length+2);assert.equal(next.customBlocks.items.length,before.customBlocks.items.length+7);
});

test('a deleted old guide with surviving old children is not silently rebuilt',()=>{
  const state=thaw(oldPlan(fixture()).nextState);state.spaces=[];state.tasks=[];
  const result=plan(state);
  assert.equal(result.summary.spaces,2);assert.equal(result.summary.ledgerEntries,0);
  assert.equal(result.nextState.spaces.some(row=>row.id===SHOWCASE_SPACE_ID),false);
  assert.deepEqual(result.nextState.ledger,state.ledger);
});

test('repeat installation keeps user edits and deletions and does not re-enable a hidden module',()=>{
  const state=thaw(plan(fixture()).nextState);state.spaces.find(row=>row.id===SHOWCASE_GALLERY_SPACE_ID).title='我的个性化导览';
  state.courses.pop();state.tasks.pop();state.captures.splice(-4);state.customBlocks.items.pop();state.workbench.modules.find(row=>row.id==='review').enabled=false;
  const before=thaw(state),result=planShowcaseGallery(state,{now:new Date(2027,6,1)});let saves=0;
  assert.equal(hasShowcaseGallery(state),true);assert.equal(result.alreadyInstalled,true);assert.ok(Object.values(result.summary).every(value=>value===0));
  assert.deepEqual(result.nextState,before);installShowcaseGallery({state,save:()=>saves++},{now});assert.equal(saves,0);assert.deepEqual(state,before);
});

test('reserved identifiers in records or canvas reject the whole plan before any write',()=>{
  const state=fixture(),sample=plan(state).nextState;
  state.captures=[{...thaw(sample.captures.at(-1)),text:'其他来源占用了编号',example:false}];
  const before=thaw(state);let saves=0;assert.throws(()=>installShowcaseGallery({state,save:()=>saves++},{now}),/编号已被占用/);assert.equal(saves,0);assert.deepEqual(state,before);
  const geometry=fixture();geometry.canvas={cards:[{id:SHOWCASE_GALLERY_BLOCK_IDS[0],x:0,y:0,w:340,h:280}]};assert.throws(()=>plan(geometry),/部分示例/);
  const fakeMarker=fixture();fakeMarker.spaces=[{...thaw(sample.spaces.find(row=>row.id===SHOWCASE_GALLERY_SPACE_ID)),example:false}];assert.throws(()=>plan(fakeMarker),/编号已被占用/);
});

test('one synchronous save installs every domain and failure restores exact prior references and absence',()=>{
  const state=fixture(),before=thaw(state),originals=new Map(Object.entries(state));let saves=0;
  assert.throws(()=>installShowcaseGallery({state,save:()=>{
    saves++;assert.equal(state.courses.length,2);assert.equal(state.calendar.events.length,3);assert.equal(state.fitness.entries.length,4);assert.equal(state.timetable.terms.length,1);
    assert.equal(state.customBlocks.items.length,9);state.updatedAt='changed by save';throw new Error('disk full');
  }},{now}),/disk full/);
  assert.equal(saves,1);assert.deepEqual(state,before);for(const [key,value]of originals)assert.equal(state[key],value);
  for(const key of ['calendar','fitness','timetable','competitions','ledger','customBlocks','canvas'])assert.equal(Object.hasOwn(state,key),false);
  const result=installShowcaseGallery({state,save:()=>saves++},{now});assert.equal(saves,2);assert.equal(result.alreadyInstalled,false);
  assert.equal(hasShowcaseGallery(state),true);assert.equal(Object.isFrozen(state.courses),false);state.courses[0].notes[0].content='可以继续修改';
  assert.equal(state.english,originals.get('english'));
});

test('backup validation and additive merge retain every new domain and the shared record links',()=>{
  const source=plan(fixture()).nextState,checked=normalized(source),backup={format:'lumi-backup',version:1,exportedAt:stamp,state:source,files:[]};
  const restored=mergeBackup(fixture(),validateBackup(backup)).state;
  for(const key of ['courses','spaces','tasks','captures','calendar','fitness','timetable','competitions','ledger','customBlocks','workbench']){
    assert.deepEqual(checked[key],source[key],key+' must not lose a generated field');
    assert.deepEqual(restored[key],source[key],key+' must survive additive restore');
  }
  // Backup validation supplies initialized:false when old canvas metadata omitted it.
  for(const key of ['cards','view','snap'])assert.deepEqual(checked.canvas[key],source.canvas[key]);
  assert.deepEqual(restored.canvas,checked.canvas);
  assert.equal(hasShowcaseGallery(restored),true);assert.equal(plan(restored).alreadyInstalled,true);
  const task=restored.tasks.find(row=>row.id==='showcase-dev019-shared-material-task');
  assert.equal(task.spaceId,SHOWCASE_GALLERY_SPACE_ID);assert.equal(restored.captures.find(row=>row.id===task.captureId).category,'英语');
});

test('calendar projections and fitness totals follow source records while English materials share captures',()=>{
  const next=thaw(plan(fixture()).nextState),task=next.tasks.find(row=>row.id==='showcase-dev019-shared-material-task');
  const initial=projectCalendarLinks(next).find(row=>row.sourceId===task.id);assert.equal(initial.parentId,SHOWCASE_GALLERY_SPACE_ID);assert.equal(initial.startDate,task.date);
  task.date='2027-01-09';task.done=true;
  const changed=projectCalendarLinks(next).find(row=>row.sourceId===task.id);assert.equal(changed.startDate,'2027-01-09');assert.equal(changed.done,true);
  assert.equal(next.calendar.events.some(row=>row.id===initial.id),false);
  const english=next.captures.filter(row=>row.category==='英语');assert.equal(english.length,2);english[0].text='我编辑的示例英文';assert.equal(next.captures.find(row=>row.id===english[0].id).text,'我编辑的示例英文');
  const entries=selectFitnessEntries(next.fitness,{spaceId:SHOWCASE_GALLERY_FITNESS_ID}),total=summarizeFitness(entries);
  assert.equal(entries.length,4);assert.equal(total.minutes,85);assert.equal(total.caloriesKcal,null);
  entries[0].minutes+=10;assert.equal(summarizeFitness(selectFitnessEntries(next.fitness,{spaceId:SHOWCASE_GALLERY_FITNESS_ID})).minutes,95);
});

test('invalid dates, block capacity and malformed existing domains stop before saving',()=>{
  const state=fixture(),before=thaw(state);assert.throws(()=>planShowcaseGallery(state,{now:new Date(NaN)}),/日期无效/);assert.deepEqual(state,before);
  const old=thaw(oldPlan(fixture()).nextState),model=old.customBlocks.items[0];old.customBlocks.items=Array.from({length:44},(_,index)=>({...thaw(model),id:'block:existing-'+index}));
  const oldBefore=thaw(old);let saves=0;assert.throws(()=>installShowcaseGallery({state:old,save:()=>saves++},{now}),/数量超出/);assert.equal(saves,0);assert.deepEqual(old,oldBefore);
  const broken=fixture();broken.calendar={version:1,events:[{id:'broken'}]};assert.throws(()=>plan(broken),/日历/);
  for(const key of ['calendar','fitness','timetable']){const damaged=thaw(oldPlan(fixture()).nextState);damaged[key]=null;assert.throws(()=>plan(damaged));assert.equal(damaged[key],null);}
});

test('persistence failure also restores populated new domains using their original object references',()=>{
  const state=thaw(oldPlan(fixture()).nextState),samples=plan(fixture()).nextState;
  state.calendar={version:1,events:[{...thaw(samples.calendar.events[0]),id:'existing-event'}]};
  state.fitness={version:1,entries:[{...thaw(samples.fitness.entries[0]),id:'existing-fitness',spaceId:SHOWCASE_SPACE_ID}]};
  state.timetable={version:1,activeTermId:'existing-term',terms:[{...thaw(samples.timetable.terms[0]),id:'existing-term',entries:[]}]};
  state.courses=[{...thaw(samples.courses[0]),id:'existing-course',notes:[]}];
  const before=thaw(state),references=new Map(Object.entries(state));let saved=0;
  assert.throws(()=>installShowcaseGallery({state,save:()=>{saved++;throw new Error('save rejected');}},{now}),/save rejected/);
  assert.equal(saved,1);assert.deepEqual(state,before);for(const [key,value]of references)assert.equal(state[key],value,key);
});
