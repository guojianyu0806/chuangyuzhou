import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkbench,configureWorkbench} from '../src/workbench-model.js';
import {ensureCanvas} from '../src/canvas.js';
import {placementCards,placementLayout,placeBlock,arrangeBlocks,savePlacement,undoPlacement} from '../src/placement-model.js';
import {workspaceFingerprint} from '../../backend/workspace-queries.mjs';
import {STUDY_ACTION_ADAPTERS} from '../src/workspace-actions-study.js';

function fixture(template='blank') {
  const state={workbench:createWorkbench(template),spaces:[{id:'research-space',title:'研究空间',icon:'folder',description:'自己的课题',notes:[{id:'kept',content:'原笔记'}]}],tasks:[{id:'kept-task',title:'保留的待办'}],updatedAt:'before'};
  const ctx={state,save(){state.updatedAt='saved';}};
  return {state,ctx};
}

test('preview uses actual geometry and metadata without mutating state or AI context',()=>{
  const {state}=fixture(),before=structuredClone(state),fingerprint=workspaceFingerprint(state);
  const layout=placementLayout(state),cards=placementCards(state);
  assert.deepEqual(state,before);assert.equal(workspaceFingerprint(state),fingerprint);
  assert.deepEqual(cards.map(card=>card.id),['ai','research-space']);
  assert.equal(cards[1].title,'研究空间');assert.equal(cards[1].kind,'space');
  assert.equal(layout.cards.length,11);assert.equal(state.canvas,undefined);
  cards[0].x=999;layout.cards[0].x=999;
  assert.notEqual(placementCards(state)[0].x,999);
});

test('legacy and hidden-module positions survive explicit placement of another module',()=>{
  const {state}=fixture('full');ensureCanvas(state);
  Object.assign(state.canvas.cards.find(card=>card.id==='courses'),{x:-1500,y:9200,w:533,h:421});
  configureWorkbench(state,{moduleId:'courses',enabled:false});
  const before=structuredClone(state),fingerprint=workspaceFingerprint(state);
  const result=placeBlock(state,'tasks',{x:379,y:-99});
  assert.equal(result.x,360);assert.equal(result.y,-80);
  assert.deepEqual(state.canvas.cards.filter(card=>card.id!=='tasks'),before.canvas.cards.filter(card=>card.id!=='tasks'));
  assert.deepEqual(state.tasks,before.tasks);assert.deepEqual(state.spaces,before.spaces);
  assert.deepEqual(state.canvas.view,before.canvas.view);
  assert.notEqual(workspaceFingerprint(state),fingerprint);
});

test('placing a hidden module enables it and preserves its size, color, and records',()=>{
  const {state}=fixture();ensureCanvas(state);
  const existing=state.canvas.cards.find(card=>card.id==='tasks');Object.assign(existing,{w:456,h:320,color:'#123456'});
  const result=placeBlock(state,'tasks',{x:81,y:119});
  assert.deepEqual(result,{...existing,x:80,y:120});
  assert.equal(state.workbench.modules.find(module=>module.id==='tasks').enabled,true);
  assert.equal(state.workbench.onboardingComplete,true);
  assert.equal(state.canvas.presentation,'canvas');assert.equal(state.canvas.initialized,true);assert.equal(state.canvas.customized,true);
  assert.equal(state.tasks[0].title,'保留的待办');
});

test('custom spaces may be placed while unknown or archived targets and invalid coordinates are atomic failures',()=>{
  const {state}=fixture();placeBlock(state,'research-space',{x:-40,y:100000});
  assert.equal(state.workbench.onboardingComplete,true);
  state.spaces.push({id:'archived',archived:true});
  const before=structuredClone(state);
  for(const [id,point] of [['missing',{x:0,y:0}],['archived',{x:0,y:0}],['tasks',{x:NaN,y:0}],['tasks',{x:'40',y:0}],['tasks',{x:Infinity,y:0}],['tasks',{x:100001,y:0}],['tasks',null]])assert.throws(()=>placeBlock(state,id,point));
  assert.deepEqual(state,before);
});

test('three-column arrangement avoids overlap with mixed dimensions and does not move hidden modules',()=>{
  const {state}=fixture('full');ensureCanvas(state);
  configureWorkbench(state,{moduleId:'english',enabled:false});
  Object.assign(state.canvas.cards.find(card=>card.id==='tasks'),{w:1040,h:700});
  Object.assign(state.canvas.cards.find(card=>card.id==='review'),{w:880,h:800});
  const hidden=structuredClone(state.canvas.cards.find(card=>card.id==='english')),business=structuredClone({tasks:state.tasks,spaces:state.spaces});
  const arranged=arrangeBlocks(state);
  for(let i=0;i<arranged.length;i++)for(let j=i+1;j<arranged.length;j++){
    const a=arranged[i],b=arranged[j];assert.ok(a.x+a.w<=b.x||b.x+b.w<=a.x||a.y+a.h<=b.y||b.y+b.h<=a.y);
  }
  assert.deepEqual(state.canvas.cards.find(card=>card.id==='english'),hidden);
  assert.deepEqual({tasks:state.tasks,spaces:state.spaces},business);
  assert.equal(arranged[0].x,40);assert.equal(arranged[0].y,40);
});

test('failed placement saves restore configuration, layout absence, and update timestamp',()=>{
  const {state,ctx}=fixture(),before=structuredClone(state);
  ctx.save=()=>{state.updatedAt='failed';throw new Error('storage conflict');};
  assert.throws(()=>savePlacement(ctx,workspace=>placeBlock(workspace,'tasks',{x:80,y:80})),/storage conflict/);
  assert.deepEqual(state,before);
  delete state.updatedAt;delete state.workbench;const legacy=structuredClone(state);
  assert.throws(()=>savePlacement(ctx,workspace=>placeBlock(workspace,'tasks',{x:80,y:80})),/storage conflict/);
  assert.deepEqual(state,legacy);
});

test('placement undo restores original layout while preserving subsequently added business records',()=>{
  const {state,ctx}=fixture(),before=structuredClone(state);
  const record=savePlacement(ctx,workspace=>placeBlock(workspace,'tasks',{x:80,y:80}));
  state.tasks.push({id:'after-task',title:'之后新增的事项'});
  assert.equal(undoPlacement(ctx,record),true);
  assert.deepEqual(state.workbench,before.workbench);assert.equal(state.canvas,undefined);
  assert.equal(state.tasks.at(-1).id,'after-task');assert.equal(undoPlacement(ctx,record),false);
});

test('undo refuses subsequent manual configuration or canvas changes and rolls back a failed save',()=>{
  for(const edit of [state=>configureWorkbench(state,{title:'之后的名字'}),state=>{state.canvas.cards[0].x+=40;}]){
    const {state,ctx}=fixture(),record=savePlacement(ctx,workspace=>placeBlock(workspace,'tasks',{x:80,y:80}));
    edit(state);const after=structuredClone(state);
    assert.equal(undoPlacement(ctx,record),false);assert.deepEqual(state,after);
  }
  const {state,ctx}=fixture(),record=savePlacement(ctx,workspace=>placeBlock(workspace,'tasks',{x:80,y:80})),after=structuredClone(state);
  ctx.save=()=>{state.updatedAt='failed';throw new Error('quota');};
  assert.throws(()=>undoPlacement(ctx,record),/quota/);assert.deepEqual(state,after);
});

test('manual placement keeps the existing AI card-undo guard from erasing a later user position',()=>{
  const {state}=fixture('full');ensureCanvas(state);
  const adapter=STUDY_ACTION_ADAPTERS.canvasCard;
  const receipt=adapter.apply(state,{operation:'update',id:'tasks',containerId:'home',data:{x:400,y:400}},{now:'2026-10-09T08:00:00.000Z'});
  placeBlock(state,'tasks',{x:200,y:240});
  assert.equal(adapter.undo(state,receipt),false);
  assert.equal(state.canvas.cards.find(card=>card.id==='tasks').x,200);
});

test('an oversized arrangement fails before altering saved positions',()=>{
  const {state}=fixture();
  state.spaces=Array.from({length:400},(_,index)=>({id:`space-${index}`,title:`空间${index}`}));
  state.canvas={cards:state.spaces.map((space,index)=>({id:space.id,x:index,y:0,w:400,h:850,color:'#123456'}))};
  const before=structuredClone(state);
  assert.throws(()=>arrangeBlocks(state),/自动排列范围/);
  assert.deepEqual(state,before);
});
