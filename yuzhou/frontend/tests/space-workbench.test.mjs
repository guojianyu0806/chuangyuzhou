import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkbench} from '../src/workbench-model.js';
import {createCustomBlock} from '../src/custom-blocks-model.js';
import {createCustomBlockOnWorkbench} from '../src/custom-blocks.js';
import {ensureCanvas,visibleCanvasCards} from '../src/canvas.js';
import {placeBlock} from '../src/placement-model.js';
import {spaceWorkbenchCatalog,spaceWorkbenchLayout,spaceWorkbenchCards,placeSpaceBlock,spacePlacementModel,hideSpaceBlock,saveSpacePlacement,spaceBoardKey} from '../src/space-workbench-model.js';
import {validateSpaceStructure,getSpaceWorkbench} from '../src/space-workbench-config.js';
import {validateBackup,mergeBackup} from '../src/backup.js';
import {applyWorkspaceActions,undoWorkspaceActions,validateWorkspaceActionSnapshot} from '../src/workspace-actions.js';
import {createReturnNavigation,workspaceRoute,parseWorkspaceRoute,parentWorkspaceRoute,routeAvailable} from '../src/return-navigation.js';

const stamp='2026-10-17T09:00:00.000Z';
const fixture=()=>({schema:1,mode:'personal',profile:{},english:{},courses:[],captures:[],tasks:[],aiRequests:[],workbench:createWorkbench('full'),updatedAt:stamp,spaces:[{id:'a',title:'读书会',notes:[],files:[],color:'#7950f2'},{id:'b',title:'创作',notes:[],files:[],color:'#009eab'}]});
const backup=state=>({format:'lumi-backup',version:1,state,files:[],exportedAt:stamp});

test('viewing a legacy space computes an independent catalogue and geometry without mutating saved state',()=>{
  const state=fixture(),before=structuredClone(state);const cards=spaceWorkbenchCards(state,'a');
  assert.deepEqual(cards.map(item=>item.id),['notes','files','tasks','assistant']);assert.ok(cards.every(item=>item.w>=220));assert.deepEqual(state,before);
});
test('placing and hiding a shared module changes only this space, keeping main and sibling configurations intact',()=>{
  const state=fixture();ensureCanvas(state);const main=structuredClone({workbench:state.workbench,canvas:state.canvas}),sibling=structuredClone(state.spaces[1]);
  placeSpaceBlock(state,'a','module:english',{x:823,y:459});assert.ok(getSpaceWorkbench(state.spaces[0]).modules.includes('english'));assert.equal(spaceWorkbenchCards(state,'a').find(item=>item.id==='module:english').x,840);
  assert.deepEqual({workbench:state.workbench,canvas:state.canvas},main);assert.deepEqual(state.spaces[1],sibling);hideSpaceBlock(state,'a','module:english');assert.ok(!spaceWorkbenchCards(state,'a').some(item=>item.id==='module:english'));assert.ok(state.boards[spaceBoardKey('a')].cards.some(item=>item.id==='module:english'));
  assert.throws(()=>hideSpaceBlock(state,'a','assistant'),/保留/);
});
test('space custom blocks and children stay out of main and sibling canvases while retaining real block contents',()=>{
  const state=fixture();state.spaces.push({id:'child',parentId:'a',title:'活动资料',notes:[],files:[]});
  const block=createCustomBlock(state,{kind:'note',title:'开场问题',spaceId:'a',config:{text:'最近在读什么？'}});
  ensureCanvas(state);assert.ok(!visibleCanvasCards(state).some(item=>[block.id,'child'].includes(item.id)));
  const own=spaceWorkbenchCards(state,'a');assert.ok(own.some(item=>item.id===block.id&&item.blockKind==='note'&&item.config.text==='最近在读什么？'));assert.ok(own.some(item=>item.id==='child'));
  assert.ok(!spaceWorkbenchCards(state,'b').some(item=>[block.id,'child'].includes(item.id)));assert.throws(()=>placeBlock(state,block.id,{x:0,y:0}),/所属/);assert.throws(()=>placeSpaceBlock(state,'b',block.id,{x:0,y:0}),/其他空间/);
});
test('failed scoped placement and guarded undo preserve root, sibling, business data and original layout',()=>{
  const state=fixture(),before=structuredClone(state);assert.throws(()=>saveSpacePlacement({state,save(){throw Error('failed');}},'a',s=>placeSpaceBlock(s,'a','notes',{x:800,y:400})),/failed/);assert.deepEqual(state,before);
  const ctx={state,save(){state.updatedAt=stamp;}},model=spacePlacementModel('a'),record=model.save(ctx,s=>model.place(s,'notes',{x:800,y:400}));
  assert.equal(model.undo(ctx,record),true);assert.deepEqual(state.spaces,before.spaces);const later=model.save(ctx,s=>model.place(s,'notes',{x:800,y:400}));placeSpaceBlock(state,'a','files',{x:1200,y:0});assert.equal(model.undo(ctx,later),false);
});
test('creating a block from a space editor atomically places it in that space without changing the main template',()=>{
  const state=fixture(),main=structuredClone(state.workbench),ctx={state,spaceId:'a',save(){}};
  const record=createCustomBlockOnWorkbench(ctx,{kind:'note',title:'属于读书会'},{placement:{x:1200,y:400}});assert.equal(record.spaceId,'a');assert.equal(spaceWorkbenchCards(state,'a').find(item=>item.id===record.id).x,1200);assert.deepEqual(state.workbench,main);
  const before=structuredClone(state);assert.throws(()=>createCustomBlockOnWorkbench({...ctx,save(){throw Error('failed');}},{kind:'note',title:'不应留下'},{}),/failed/);assert.deepEqual(state,before);
});
test('backup export validation and merge preserve nested ownership, scope settings and geometry',()=>{
  const state=fixture();state.spaces[1].parentId='a';placeSpaceBlock(state,'a','module:calendar',{x:800,y:200});createCustomBlock(state,{kind:'checklist',spaceId:'a',title:'物品',config:{items:[{id:'x',label:'书',done:false}]}});
  const normalized=validateBackup(backup(state));assert.equal(normalized.state.spaces[1].parentId,'a');assert.deepEqual(normalized.state.spaces[0].workbench,state.spaces[0].workbench);assert.equal(normalized.state.customBlocks.items[0].spaceId,'a');assert.deepEqual(normalized.state.boards,state.boards);
  const empty=fixture();empty.spaces=[];const merged=mergeBackup(empty,normalized);assert.equal(merged.state.spaces.find(item=>item.id==='b').parentId,'a');validateSpaceStructure(merged.state);
});
test('cycle, dangling owner, malformed scope and archived-space placement are rejected',()=>{
  const state=fixture();state.spaces[0].parentId='b';state.spaces[1].parentId='a';assert.throws(()=>validateSpaceStructure(state),/循环/);delete state.spaces[1].parentId;state.spaces[0].parentId='missing';assert.throws(()=>validateSpaceStructure(state),/上级/);delete state.spaces[0].parentId;
  state.spaces[0].workbench={version:1,sections:['notes'],modules:[]};assert.throws(()=>validateSpaceStructure(state),/AI/);delete state.spaces[0].workbench;state.spaces[0].archived=true;assert.throws(()=>placeSpaceBlock(state,'a','notes',{x:0,y:0}),/恢复/);assert.throws(()=>createCustomBlock(state,{kind:'note',title:'bad',spaceId:'missing'}),/所属/);
});
test('AI operations retain scope metadata and may create reviewed blocks in an existing space',async()=>{
  const state=fixture();let n=0;placeSpaceBlock(state,'a','notes',{x:400,y:80});const result=applyWorkspaceActions(state,'reviewed',[{entity:'space',operation:'update',id:'a',data:{title:'读书会筹备'}},{entity:'customBlock',operation:'create',data:{kind:'note',title:'讨论提示',spaceId:'a',config:{text:'先讨论，再决定'}}}],{uid:()=> `ai-owned-${++n}`,now:stamp});
  for(const item of result.items)validateWorkspaceActionSnapshot(JSON.parse(item.snapshot));assert.ok(state.spaces[0].workbench);assert.equal(state.customBlocks.items[0].spaceId,'a');const undo=await undoWorkspaceActions({state,save(){}},result,'reviewed');assert.equal(undo.removed,2);
});

test('return trail follows module entry back to the exact scoped builder, and survives refresh',()=>{
  const state=fixture(),map=new Map(),storage={getItem:key=>map.get(key),setItem:(key,value)=>map.set(key,value)};let nav=createReturnNavigation({storage});
  for(const hash of ['#/home','#/space/a','#/builder/a','#/english'])nav.visit(hash);assert.equal(nav.target(state,'#/english'),'#/builder/a');
  nav=createReturnNavigation({storage});nav.visit('#/english');assert.equal(nav.back(state,'#/english'),'#/builder/a');nav.visit('#/builder/a');assert.equal(nav.target(state,'#/builder/a'),'#/space/a');
});
test('nested readers and direct links return to their real parent, rather than an unrelated root page',()=>{
  const state=fixture();state.spaces[1].parentId='a';createCustomBlock(state,{kind:'note',title:'note',spaceId:'b'},{id:'block:own'});
  assert.equal(parentWorkspaceRoute(state,'#/space/b/notes/note-1'),'#/space/b');assert.equal(parentWorkspaceRoute(state,'#/space/b'),'#/space/a');assert.equal(parentWorkspaceRoute(state,'#/block/block%3Aown'),'#/space/b');assert.equal(parentWorkspaceRoute(state,'#/builder/b'),'#/space/b');
});
test('invalid or disappeared sources cannot lead the return button outside this workspace',()=>{
  const state=fixture(),nav=createReturnNavigation();nav.visit('https://evil.example');nav.visit('#/space/missing');nav.visit('#/tasks');assert.equal(nav.target(state,'#/tasks'),'#/home');assert.equal(parseWorkspaceRoute('#/space/%zz'),null);assert.equal(routeAvailable(state,'#/builder/missing'),false);
  state.spaces[0].archived=true;assert.equal(routeAvailable(state,'#/builder/a'),false);assert.equal(routeAvailable(state,'#/space/a'),true);
});
test('encoded identifiers and reader details round trip without splitting Chinese titles or punctuation',()=>{
  const id='研究 / A?#%',hash=workspaceRoute('space',id,'notes','笔记 / 1');assert.deepEqual(parseWorkspaceRoute(hash),{page:'space',id,detail:'notes',item:'笔记 / 1',hash});
});
