import test from 'node:test';
import assert from 'node:assert/strict';
import {applyWorkspaceActions,undoWorkspaceActions} from '../src/workspace-actions.js';
import {ensureCanvas} from '../src/canvas.js';
import {spaceWorkbenchLayout,placeSpaceBlock} from '../src/space-workbench-model.js';

const NOW='2026-10-15T12:00:00.000Z';
const fixture=()=>({spaces:[],courses:[],tasks:[],captures:[],aiRequests:[{id:'request',text:'建立活动空间及准备事项',status:'waiting_model',files:[{id:'attachment',blobId:'blob',name:'资料.txt',type:'text/plain',size:4,createdAt:NOW}]}],ui:{}});
const create=(entity,data,extra={})=>({entity,operation:'create',data,...extra});
function apply(state,actions){let sequence=0;return applyWorkspaceActions(state,'request',actions,{uid:()=>`created-${++sequence}`,now:NOW});}
const overview=()=>[{id:'notes',color:'#AE88FF'},{id:'files',color:'#63E6DC'},{id:'tasks',color:'#D8F649'},{id:'assistant',color:'#FF9CCE'}];
// Use the actual canvas normalizer and the collection presets from mountCanvas.
function openedBoard(items=[]){
  const presets=Object.fromEntries(items.map((item,index)=>[item.id,{...item,x:36+(index%3)*380,y:40+Math.floor(index/3)*366,w:340,h:330}]));
  const board=ensureCanvas({canvas:{},spaces:[]},presets);
  const zoom=.75;board.view={x:28-36*zoom,y:30-40*zoom,zoom};board.initialized=true;
  return board;
}
function openedWorkbench(state,id){
  const board=spaceWorkbenchLayout(state,id),zoom=.55;
  board.view={x:28-36*zoom,y:30-40*zoom,zoom};board.initialized=true;
  return board;
}
const undo=(state,receipt,save=()=>{})=>undoWorkspaceActions({state,save},receipt,'request');

test('browsing and reloading a newly created linked space permits complete undo and removes only its automatic boards',async()=>{
  const state=fixture(),receipt=apply(state,[create('space',{title:'活动'},{ref:'s'}),create('note',{title:'方案',content:'初稿'},{containerId:'$s'}),create('task',{title:'准备资料',spaceId:'$s'})]);
  const space=state.spaces[0],spaceId=space.id;
  state.spaces.push({...structuredClone(space),id:spaceId+':child',title:'另一空间',notes:[],files:[]});
  state.boards={
    [`space:${spaceId}:workbench`]:openedWorkbench(state,spaceId),
    [`space:${spaceId}:overview`]:openedBoard(overview()),
    [`space:${spaceId}:notes`]:openedBoard(space.notes),
    [`space:${spaceId}:files`]:openedBoard(),
    [`space:${spaceId}:tasks`]:openedBoard(state.tasks),
    [`space:${spaceId}:child:overview`]:{cards:[],customized:true},
    'space:unrelated:overview':openedBoard(overview()),
    tasks:openedBoard(state.tasks),
  };
  const preserved=Object.fromEntries(Object.entries(state.boards).filter(([key])=>![`space:${spaceId}:workbench`,`space:${spaceId}:overview`,`space:${spaceId}:notes`,`space:${spaceId}:files`,`space:${spaceId}:tasks`].includes(key)));
  const restored=JSON.parse(JSON.stringify(state));
  assert.deepEqual(await undo(restored,receipt),{removed:3,retained:0});
  assert.deepEqual(restored.spaces.map(row=>row.id),[spaceId+':child']);assert.deepEqual(restored.tasks,[]);
  assert.deepEqual(restored.boards,preserved);
});

test('course note and file boards created by browsing do not leave an empty course after undo',async()=>{
  const state=fixture(),receipt=apply(state,[create('course',{title:'课程'},{ref:'c'}),create('note',{title:'笔记',content:'正文'},{containerId:'$c'}),create('file',{blobId:'blob'},{containerId:'$c'})]);
  const course=state.courses[0];state.boards={[`course:${course.id}:notes`]:openedBoard(course.notes),[`course:${course.id}:files`]:openedBoard(course.files)};
  assert.deepEqual(await undo(state,receipt),{removed:3,retained:0});assert.deepEqual(state.courses,[]);assert.deepEqual(state.boards,{});
});

test('undo removes even empty automatic boards and restores both boards and records when saving fails',async()=>{
  const state=fixture(),receipt=apply(state,[create('space',{title:'空间'})]),spaceId=state.spaces[0].id;
  state.boards={[`space:${spaceId}:workbench`]:openedWorkbench(state,spaceId),[`space:${spaceId}:notes`]:openedBoard(),[`space:${spaceId}:files`]:{}};
  const before=structuredClone(state);
  await assert.rejects(()=>undo(state,receipt,()=>{throw new Error('save failed');}),/save failed/);
  assert.deepEqual(state,before);
  assert.deepEqual(await undo(state,receipt),{removed:1,retained:0});assert.deepEqual(state.spaces,[]);assert.deepEqual(state.boards,{});
});

test('the actual default workbench, including hidden presets, is disposable for normal and fitness spaces',async()=>{
  for(const type of ['project','fitness']){
    const state=fixture(),receipt=apply(state,[create('space',{title:'浏览后撤销',type})]),space=state.spaces[0];
    state.boards={[`space:${space.id}:workbench`]:openedWorkbench(state,space.id)};
    assert.equal(state.boards[`space:${space.id}:workbench`].cards.length,14);
    const restored=JSON.parse(JSON.stringify(state));
    assert.deepEqual(await undo(restored,receipt),{removed:1,retained:0});
    assert.deepEqual(restored.spaces,[]);assert.deepEqual(restored.boards,{});
  }
});

test('workbench card, geometry, view, and settings changes keep the parent and the exact layout',async()=>{
  const edits=[board=>board.cards[0].x+=8,board=>board.cards[0].y+=8,board=>board.cards[0].w+=20,
    board=>board.cards[0].h+=20,board=>board.cards[0].color='#123456',board=>board.cards.pop(),
    board=>board.cards.reverse(),board=>board.cards.push({id:'unknown-card',x:0,y:0,w:340,h:300,color:'#123456'}),
    board=>board.cards[0].extra='later edit',board=>board.view.x+=5,board=>board.presentation='grid-2',
    board=>board.snap=false,board=>board.stackPointer=.7,board=>board.customized=true,
    board=>board.modifiedAt=NOW,board=>board.extraLayout={label:'保留'}];
  for(const edit of edits){
    const state=fixture(),receipt=apply(state,[create('space',{title:'保留工作台布局'})]),space=state.spaces[0];
    const board=openedWorkbench(state,space.id);edit(board);state.boards={[`space:${space.id}:workbench`]:board};
    const before=structuredClone(state);
    assert.deepEqual(await undo(state,receipt),{removed:0,retained:1});
    assert.deepEqual(state.spaces,before.spaces);assert.deepEqual(state.boards,before.boards);
  }
});

test('a real later placement that enables a shared module retains the parent and scoped configuration',async()=>{
  const state=fixture(),receipt=apply(state,[create('space',{title:'后续已搭建'})]),space=state.spaces[0];
  state.boards={[`space:${space.id}:workbench`]:openedWorkbench(state,space.id)};
  placeSpaceBlock(state,space.id,'module:calendar',{x:1200,y:400});
  const before=structuredClone(state);
  assert.deepEqual(await undo(state,receipt),{removed:0,retained:1});
  assert.deepEqual(state.spaces,before.spaces);assert.deepEqual(state.boards,before.boards);
});

test('explicit customization and modified timestamps retain the parent and its board',async()=>{
  for(const metadata of [{customized:true},{modifiedAt:NOW}]){
    const state=fixture(),receipt=apply(state,[create('space',{title:'保留布局'})]),spaceId=state.spaces[0].id;
    state.boards={[`space:${spaceId}:overview`]:{...openedBoard(overview()),...metadata}};const boards=structuredClone(state.boards);
    assert.deepEqual(await undo(state,receipt),{removed:0,retained:1});assert.deepEqual(state.boards,boards);
  }
});

test('unmarked manual geometry, colour, view and presentation changes remain protected',async()=>{
  const edits=[board=>board.cards[0].x+=8,board=>board.cards[0].w+=20,board=>board.cards[0].color='#123456',board=>board.view.x+=5,board=>board.presentation='grid-2',board=>board.snap=false,board=>board.stackPointer=.7,board=>board.extraLayout={label:'保留'}];
  for(const edit of edits){
    const state=fixture(),receipt=apply(state,[create('space',{title:'旧的未标记布局'})]),spaceId=state.spaces[0].id,board=openedBoard(overview());
    edit(board);state.boards={[`space:${spaceId}:overview`]:board};const boards=structuredClone(state.boards);
    assert.deepEqual(await undo(state,receipt),{removed:0,retained:1});assert.deepEqual(state.boards,boards);
  }
});

test('unknown board sections, cards and unmarked content-card colours are conservatively retained',async()=>{
  for(const section of ['timeline','future:timeline','overview','notes']){
    const state=fixture(),receipt=apply(state,[create('space',{title:'未知布局'},{ref:'s'}),create('note',{title:'笔记',content:'正文'},{containerId:'$s'})]),space=state.spaces[0];
    const board=section==='overview'?openedBoard([{id:'unknown-card',color:'#AE88FF'}]):section==='notes'?openedBoard(space.notes):{};
    if(section==='notes')board.cards[0].color='#123456';
    state.boards={[`space:${space.id}:${section}`]:board};const boards=structuredClone(state.boards);
    assert.deepEqual(await undo(state,receipt),{removed:1,retained:1});assert.deepEqual(state.boards,boards);
  }
});

test('later business content retains the parent and automatic boards',async()=>{
  for(const kind of ['note','task','fitness']){
    const state=fixture(),receipt=apply(state,[create('space',{title:'后续已使用'})]),space=state.spaces[0];
    if(kind==='note')space.notes.push({id:'later-note',title:'用户笔记',content:'保留'});
    if(kind==='task')state.tasks.push({id:'later-task',title:'用户待办',spaceId:space.id});
    if(kind==='fitness')state.fitness={entries:[{id:'later-fitness',spaceId:space.id}]};
    state.boards={[`space:${space.id}:overview`]:openedBoard(overview())};const before=structuredClone(state);
    assert.deepEqual(await undo(state,receipt),{removed:0,retained:1});assert.deepEqual(state.spaces,before.spaces);assert.deepEqual(state.boards,before.boards);
  }
});
