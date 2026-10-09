import test from 'node:test';
import assert from 'node:assert/strict';
import {createCustomBlock,getCustomBlocks,updateCustomBlock,validateCustomBlock} from '../src/custom-blocks-model.js';
import {CUSTOM_BLOCK_PRESETS,createPresetInput} from '../src/custom-block-presets.js';
import {createWorkbench,configureWorkbench,applyWorkbenchTemplate} from '../src/workbench-model.js';
import {ensureCanvas,visibleCanvasCards} from '../src/canvas.js';
import {placementLayout,placementCards,placeBlock,arrangeBlocks,savePlacement,undoPlacement} from '../src/placement-model.js';
import {placementHTML} from '../src/placement.js';
import {builderHTML,mountBuilder} from '../src/builder.js';
import {workspaceFingerprint} from '../../backend/workspace-queries.mjs';

function fixture(){
  const state={workbench:createWorkbench('blank'),spaces:[{id:'space-1',title:'已有空间',color:'#AE88FF',notes:[{id:'kept',content:'已有笔记'}]}],tasks:[{id:'old-task',title:'已有待办'}],updatedAt:'before'};
  const note=createCustomBlock(state,{kind:'note',title:'项目便签',config:{text:'保留的内容'}},{id:'block:note'});
  const program=createCustomBlock(state,{kind:'miniapp',title:'计数工具',config:{code:'app.render([]);'},data:{count:3}},{id:'block:program'});
  const ctx={state,save(){state.updatedAt='saved';}};
  return {state,ctx,note,program};
}
const overlap=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;

test('builder reads custom geometry and metadata without initializing or mutating the real state',()=>{
  const {state,note,program}=fixture(),before=structuredClone(state),fingerprint=workspaceFingerprint(state);
  const layout=placementLayout(state),cards=placementCards(state),noteCard=cards.find(item=>item.id===note.id);
  assert.equal(noteCard.kind,'block');assert.equal(noteCard.title,note.title);assert.equal(cards.some(item=>item.id===program.id),true);
  assert.equal(layout.cards.length,13);assert.equal(state.canvas,undefined);
  noteCard.x=800;layout.cards.find(item=>item.id===program.id).y=-900;
  assert.deepEqual(state,before);assert.equal(workspaceFingerprint(state),fingerprint);
});

test('placing a custom block updates the shared home position and preserves source data, size and unrelated positions',()=>{
  const {state,note,program}=fixture();ensureCanvas(state);
  const target=state.canvas.cards.find(item=>item.id===note.id);Object.assign(target,{x:120,y:160,w:514,h:338});
  const unchanged=structuredClone(state.canvas.cards.filter(item=>item.id!==note.id)),records=structuredClone(state.customBlocks),tasks=state.tasks,spaces=state.spaces;
  const result=placeBlock(state,note.id,{x:613,y:-227}),home=visibleCanvasCards(state).find(item=>item.id===note.id);
  assert.deepEqual({x:result.x,y:result.y,w:result.w,h:result.h},{x:600,y:-240,w:514,h:338});assert.deepEqual(home,result);
  assert.deepEqual(state.customBlocks,records);assert.deepEqual(state.canvas.cards.filter(item=>item.id!==note.id),unchanged);
  assert.equal(state.tasks,tasks);assert.equal(state.spaces,spaces);assert.deepEqual(getCustomBlocks(state).items.find(item=>item.id===program.id).data,{count:3});
});

test('archiving removes a custom block from home and palette without deleting its record or geometry',()=>{
  const {state,note}=fixture();ensureCanvas(state);const geometry=structuredClone(state.canvas.cards.find(item=>item.id===note.id));
  updateCustomBlock(state,note.id,{archived:true});const before=structuredClone(state);
  assert.equal(placementCards(state).some(item=>item.id===note.id),false);
  assert.equal(placementHTML(state).includes(`data-place-source="${note.id}"`),false);
  assert.match(builderHTML(state),/已收起/);assert.ok(builderHTML(state).includes(`data-wb-action="edit-block" data-id="${note.id}"`));
  assert.throws(()=>placeBlock(state,note.id,{x:0,y:0}),/归档/);assert.deepEqual(state,before);
  updateCustomBlock(state,note.id,{archived:false});ensureCanvas(state);
  assert.deepEqual(state.canvas.cards.find(item=>item.id===note.id),geometry);assert.equal(placementCards(state).find(item=>item.id===note.id).title,note.title);
  assert.equal(getCustomBlocks(state).items.find(item=>item.id===note.id).config.text,'保留的内容');
});

test('mixed-size arrangement includes visible custom blocks and leaves archived and disabled cards untouched',()=>{
  const {state,note,program}=fixture();configureWorkbench(state,{moduleId:'tasks',enabled:true});ensureCanvas(state);
  updateCustomBlock(state,program.id,{archived:true});
  for(const [index,card] of state.canvas.cards.entries()){card.x=index*2;card.y=index;card.w=card.id==='ai'?700:240+(index%3)*170;card.h=card.id==='ai'?450:230+(index%2)*160;}
  const hiddenIds=new Set(state.canvas.cards.filter(item=>!visibleCanvasCards(state).some(visible=>visible.id===item.id)).map(item=>item.id));
  const hidden=structuredClone(state.canvas.cards.filter(item=>hiddenIds.has(item.id))),content=structuredClone(state.customBlocks);
  const result=arrangeBlocks(state);assert.ok(result.some(item=>item.id===note.id));assert.ok(!result.some(item=>item.id===program.id));
  for(let a=0;a<result.length;a++)for(let b=a+1;b<result.length;b++)assert.equal(overlap(result[a],result[b]),false,`${result[a].id} overlaps ${result[b].id}`);
  assert.deepEqual(state.customBlocks,content);assert.deepEqual(state.canvas.cards.filter(item=>hiddenIds.has(item.id)),hidden);
});

test('placement undo restores coordinates while preserving later runtime data and configuration edits',()=>{
  const {state,ctx,program}=fixture();ensureCanvas(state);const geometry=structuredClone(state.canvas.cards.find(item=>item.id===program.id));
  const receipt=savePlacement(ctx,workspace=>placeBlock(workspace,program.id,{x:2400,y:880}));
  updateCustomBlock(state,program.id,{data:{count:4},title:'新名称'});const content=structuredClone(state.customBlocks);
  assert.equal(undoPlacement(ctx,receipt),true);assert.deepEqual(state.canvas.cards.find(item=>item.id===program.id),geometry);assert.deepEqual(state.customBlocks,content);
});

test('failed placement and a conflicting subsequent layout do not alter block content or runtime data',()=>{
  const {state,ctx,program}=fixture();ensureCanvas(state);const before=structuredClone(state);
  assert.throws(()=>savePlacement({...ctx,save(){throw new Error('quota');}},workspace=>placeBlock(workspace,program.id,{x:2000,y:0})),/quota/);assert.deepEqual(state,before);
  const receipt=savePlacement(ctx,workspace=>placeBlock(workspace,program.id,{x:2000,y:0}));
  updateCustomBlock(state,program.id,{data:{count:8}});placeBlock(state,program.id,{x:2080,y:0});const changed=structuredClone(state);
  assert.equal(undoPlacement(ctx,receipt),false);assert.deepEqual(state,changed);
});

test('switching the built-in template never removes independent custom blocks',()=>{
  const {state,note,program}=fixture();ensureCanvas(state);const before=structuredClone(state.customBlocks),geometry=structuredClone(state.canvas);
  applyWorkbenchTemplate(state,'full');applyWorkbenchTemplate(state,'blank');
  assert.deepEqual(state.customBlocks,before);assert.deepEqual(state.canvas,geometry);
  assert.ok(visibleCanvasCards(state).some(item=>item.id===note.id));assert.ok(visibleCanvasCards(state).some(item=>item.id===program.id));
});

test('all fourteen public presets create model-valid independent blocks with empty runtime data',()=>{
  const state={};assert.equal(CUSTOM_BLOCK_PRESETS.length,14);assert.equal(new Set(CUSTOM_BLOCK_PRESETS.map(item=>item.id)).size,14);
  for(const preset of CUSTOM_BLOCK_PRESETS){
    const input=createPresetInput(preset.id,new Date(2026,9,9,12)),record=createCustomBlock(state,input,{id:`block:preset-${preset.id}`});
    assert.deepEqual(validateCustomBlock(record),record);assert.deepEqual(record.data,{});assert.equal(record.archived,false);
  }
  assert.equal(getCustomBlocks(state).items.length,14);assert.equal(getCustomBlocks(state).items.find(item=>item.kind==='countdown').config.date,'2026-10-16');
});

test('preset inputs are independent deep copies and unknown identifiers fail before creating data',()=>{
  const first=createPresetInput('reading'),second=createPresetInput('reading');first.config.columns[0].label='changed';first.data.private='not-shared';
  assert.notEqual(second.config.columns[0].label,'changed');assert.deepEqual(second.data,{});assert.notEqual(createPresetInput('reading').config.columns[0].label,'changed');
  assert.throws(()=>createPresetInput('missing'),/未找到/);
  assert.equal(Object.isFrozen(CUSTOM_BLOCK_PRESETS),true);assert.equal(Object.isFrozen(CUSTOM_BLOCK_PRESETS[0].config),true);
});

test('palette separates scene creation, saved blocks and original modules and escapes custom text',()=>{
  const {state,note}=fixture();updateCustomBlock(state,note.id,{title:'"><img src=x onerror=x>',description:'<script>doNotRun()</script>'});const before=structuredClone(state);
  const html=placementHTML(state),builder=builderHTML(state);
  assert.equal((html.match(/data-palette-group="scene"/g)||[]).length,14);assert.equal((html.match(/data-palette-group="mine"/g)||[]).length,2);assert.equal((html.match(/data-palette-group="builtin"/g)||[]).length,10);
  assert.ok(html.includes(`data-place-source="${note.id}"`));assert.ok(builder.includes(`data-wb-action="edit-block" data-id="${note.id}"`));
  assert.doesNotMatch(html,/<img src=x|<script>doNotRun/);assert.doesNotMatch(builder,/<img src=x|<script>doNotRun/);assert.match(html,/&lt;img/);assert.deepEqual(state,before);
});

test('builder opens preset and custom editors, routes existing blocks and only drafts AI requests',()=>{
  const {state,note}=fixture(),before=structuredClone(state),events={},calls=[];
  const root={innerHTML:'',querySelector:()=>null,contains:()=>true,addEventListener:(name,handler)=>events[name]=handler,removeEventListener:(name,handler)=>{if(events[name]===handler)delete events[name];}};
  const ctx={state,root,save:()=>assert.fail('entry points must not save'),toast:message=>calls.push(['toast',message]),openCustomBlockEditor:input=>calls.push(['editor',input]),go:(...args)=>calls.push(['go',...args]),askAssistant:prompt=>calls.push(['draft',prompt])};
  const click=(action,id)=>events.click?.({target:{closest:()=>({dataset:{wbAction:action,id}})}}),cleanup=mountBuilder(ctx);
  click('create-block');click('create-preset','calculator');click('edit-block',note.id);click('open-block',note.id);click('ask-miniapp');
  assert.deepEqual(calls[0],['editor',undefined]);assert.equal(calls[1][1].kind,'miniapp');assert.match(calls[1][1].config.code,/app\.render/);assert.deepEqual(calls[2],['editor',note.id]);assert.deepEqual(calls[3],['go','block',note.id]);assert.equal(calls[4][0],'draft');assert.match(calls[4][1],/等我确认/);assert.deepEqual(state,before);
  cleanup();click('create-block');assert.equal(calls.length,5);
});
