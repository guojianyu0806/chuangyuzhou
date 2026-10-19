import test from 'node:test';
import assert from 'node:assert/strict';
import {planShowcaseExamples,installShowcaseExamples,hasShowcaseExamples,SHOWCASE_SPACE_ID,SHOWCASE_BLOCK_IDS} from '../src/showcase-examples.js';
import {createWorkbench} from '../src/workbench-model.js';
import {validateBackup,mergeBackup} from '../src/backup.js';

const now=new Date(2026,9,29,23,58),stamp=now.toISOString();
const fixture=()=>({schema:1,mode:'personal',profile:{name:'既有用户',major:'保留',provider:'deepseek'},courses:[],spaces:[],tasks:[],captures:[],english:{},workbench:createWorkbench('blank'),updatedAt:stamp});
const plan=state=>planShowcaseExamples(state,{now});
const existingSpace=()=>({id:'original-space',title:'既有项目',description:'不可覆盖',type:'project',color:'#AE88FF',icon:'folder',example:false,archived:false,createdAt:stamp,updatedAt:stamp,notes:[],files:[]});
const existingTask=()=>({id:'original-task',title:'既有待办',description:'保留完整内容',date:'2026-11-03',done:true,priority:'high',category:'个人',source:'手动记录',spaceId:'original-space',archived:false,createdAt:stamp,completedAt:stamp});

test('plans a detached labelled rehearsal with local relative dates and no fake completion or AI receipt',()=>{
  const state=fixture(),before=structuredClone(state),result=plan(state);
  assert.deepEqual(state,before);assert.equal(result.alreadyInstalled,false);
  assert.equal(result.rootSpaceId,SHOWCASE_SPACE_ID);assert.equal(result.summary.tasks,3);assert.equal(result.summary.blocks,2);
  assert.equal(Object.isFrozen(result.nextState),true);assert.equal(Object.isFrozen(state),false);
  assert.deepEqual(result.nextState.tasks.map(task=>task.date),['2026-10-30','2026-11-01','2026-11-05']);
  assert.ok(result.nextState.tasks.every(task=>task.example===true&&!task.done&&task.title.includes('示例')));
  assert.ok(result.nextState.competitions.milestones.every(row=>row.title.includes('自定示例')&&!row.time&&!row.done));
  assert.ok(result.nextState.competitions.tasks.every(row=>!row.done));
  assert.equal(result.nextState.aiRequests,undefined);assert.equal(result.nextState.spaces[0].files.length,0);
  assert.ok(result.nextState.customBlocks.items.every(block=>['note','table'].includes(block.kind)));
  assert.ok(result.nextState.customBlocks.items.find(block=>block.kind==='table').config.rows.every(row=>row.cells.at(-1)==='待观察'));
  assert.equal(result.nextState.ledger.projects[0].includeInTotal,false);
});

test('retains existing records, account data, workbench labels/order and exact canvas positions',()=>{
  const state=fixture();state.spaces.push(existingSpace());state.tasks.push(existingTask());
  state.workbench.title='已有平台名称';state.workbench.modules.reverse();state.workbench.modules.find(row=>row.id==='tasks').title='原有任务名称';
  state.canvas={cards:[{id:'ai',x:-35,y:17,w:543,h:371,color:'#B3A0FF'},{id:'original-space',x:913,y:717,w:351,h:293,color:'#AE88FF'},{id:'tasks',x:614,y:353,w:314,h:274,color:'#63E6DC'}],view:{x:81,y:-23,zoom:.67},snap:false,customized:true};
  state.aiDraft={text:'原始草稿不能改动',files:[],targetId:'auto'};
  const before=structuredClone(state),result=plan(state).nextState;
  assert.deepEqual(result.spaces[0],before.spaces[0]);assert.deepEqual(result.tasks[0],before.tasks[0]);
  assert.deepEqual(result.profile,before.profile);assert.deepEqual(result.aiDraft,before.aiDraft);
  assert.equal(result.workbench.title,before.workbench.title);assert.deepEqual(result.workbench.modules.map(row=>row.id),before.workbench.modules.map(row=>row.id));
  assert.equal(result.workbench.modules.find(row=>row.id==='tasks').title,'原有任务名称');
  assert.deepEqual(result.canvas.cards.slice(0,before.canvas.cards.length),before.canvas.cards);assert.deepEqual(result.canvas.view,before.canvas.view);assert.equal(result.canvas.snap,false);
  assert.ok(result.canvas.cards.some(card=>card.id===SHOWCASE_SPACE_ID));
  assert.ok(SHOWCASE_BLOCK_IDS.every(id=>result.canvas.cards.some(card=>card.id===id)));
});

test('a repeat does not overwrite edits, restore removed children, or re-enable hidden modules',()=>{
  const state=structuredClone(plan(fixture()).nextState);
  state.spaces[0].title='我自己的展示项目';state.tasks[0].title='自行调整过';state.tasks.pop();state.customBlocks.items.shift();
  state.workbench.modules.find(row=>row.id==='tasks').enabled=false;
  const before=structuredClone(state),result=planShowcaseExamples(state,{now:new Date(2027,1,8)});
  assert.equal(hasShowcaseExamples(state),true);assert.equal(result.alreadyInstalled,true);assert.deepEqual(result.nextState,before);
  assert.ok(Object.values(result.summary).every(value=>value===0));
  let saves=0;installShowcaseExamples({state,save:()=>saves++},{now});assert.equal(saves,0);assert.deepEqual(state,before);
});

test('occupied or partial sample identifiers stop the whole plan instead of linking to unrelated records',()=>{
  const state=fixture();state.spaces.push({...existingSpace(),id:SHOWCASE_SPACE_ID});
  const before=structuredClone(state);assert.throws(()=>plan(state),/编号已被占用/);assert.deepEqual(state,before);
  const partial=fixture();partial.tasks.push({...existingTask(),id:'showcase-dev012-route-task'});
  assert.throws(()=>plan(partial),/部分示例/);assert.equal(partial.spaces.length,0);
  const geometry=fixture();geometry.canvas={cards:[{id:SHOWCASE_BLOCK_IDS[0],x:0,y:0,w:340,h:280}]};assert.throws(()=>plan(geometry),/编号已被占用/);
});

test('installation saves once with stable state identity and rolls back references if persistence fails',()=>{
  const state=fixture(),identity=state,previousTasks=state.tasks,previousSpaces=state.spaces,previousWorkbench=state.workbench;
  const before=structuredClone(state);let saves=0;
  assert.throws(()=>installShowcaseExamples({state,save:()=>{saves++;assert.equal(state,identity);assert.equal(state.spaces.length,1);state.updatedAt='changed-during-save';throw new Error('storage full');}},{now}),/storage full/);
  assert.equal(saves,1);assert.equal(state.tasks,previousTasks);assert.equal(state.spaces,previousSpaces);assert.equal(state.workbench,previousWorkbench);assert.deepEqual(state,before);
  const installed=installShowcaseExamples({state,save:()=>{saves++;}},{now});
  assert.equal(saves,2);assert.equal(installed.alreadyInstalled,false);assert.equal(state,identity);assert.equal(hasShowcaseExamples(state),true);
  assert.equal(Object.isFrozen(state.spaces),false,'saved workspace remains editable');state.tasks[0].done=true;
});

test('generated records retain their real relationships and marker across backup validation and merge',()=>{
  const state=plan(fixture()).nextState;
  const backup=validateBackup({format:'lumi-backup',version:1,exportedAt:stamp,state,files:[]});
  const restored=mergeBackup(fixture(),backup).state;
  assert.equal(hasShowcaseExamples(restored),true);assert.deepEqual(restored.tasks.map(row=>[row.id,row.spaceId,row.captureId]),state.tasks.map(row=>[row.id,row.spaceId,row.captureId]));
  assert.deepEqual(restored.competitions,state.competitions);assert.deepEqual(restored.ledger,state.ledger);assert.deepEqual(restored.customBlocks,state.customBlocks);
  assert.equal(plan(restored).alreadyInstalled,true);
});

test('capacity and malformed dates fail without touching the source or saving a partial example',()=>{
  const state=fixture(),before=structuredClone(state);assert.throws(()=>planShowcaseExamples(state,{now:new Date(NaN)}),/日期无效/);assert.deepEqual(state,before);
  const full=fixture(),block=plan(fixture()).nextState.customBlocks.items[0];
  full.customBlocks={version:1,items:Array.from({length:49},(_,index)=>({...structuredClone(block),id:`block:already-${index}`}))};
  const previous=structuredClone(full);let saved=false;
  assert.throws(()=>installShowcaseExamples({state:full,save:()=>{saved=true;}},{now}),/数量超出/);assert.equal(saved,false);assert.deepEqual(full,previous);
});
