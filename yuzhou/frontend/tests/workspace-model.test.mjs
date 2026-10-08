import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initializeSpaces,routeContent,undoRoute} from '../src/workspace-model.js';
function fixture(){
  const state={spaces:[{id:'union',title:'学生会',notes:[],files:[],updatedAt:'before'}],courses:[],tasks:[],captures:[],aiRequests:[{id:'request',text:'活动分工',status:'waiting_model'}]};
  let stored;
  return {state,uid:()=>crypto.randomUUID(),save(){stored=structuredClone(state);},getStored(){return stored;}};
}
test('initializing old and synced workspaces preserves independent card layouts and pointer positions',()=>{
  const state={mode:'personal',canvas:{presentation:'stack',stackPointer:.7,cards:[{id:'courses',x:22,y:55,w:340,h:330}],view:{x:18,y:12,zoom:.8}},
    courseCanvas:{presentation:'grid-3',stackPointer:.25},boards:{tasks:{presentation:'grid-2'},'course:one:notes':{presentation:'stack',stackPointer:0}}};
  const layouts=structuredClone({canvas:state.canvas,courseCanvas:state.courseCanvas,boards:state.boards});
  initializeSpaces(state);initializeSpaces(state);
  assert.deepEqual({canvas:state.canvas,courseCanvas:state.courseCanvas,boards:state.boards},layouts);
  const legacy={mode:'personal'};initializeSpaces(legacy);
  assert.equal(legacy.canvas,undefined,'initialization does not overwrite the viewport-specific legacy default');
});
test('routing persists destination and receipt together; a retry never duplicates content',async()=>{
  const ctx=fixture(),payload={requestId:'request',targetId:'space:union',text:'活动分工'};
  const receipt=await routeContent(ctx,payload);
  assert.equal(ctx.getStored().aiRequests[0].status,'filed');
  assert.deepEqual(ctx.getStored().aiRequests[0].receipt,receipt);
  await routeContent(ctx,payload);assert.equal(ctx.state.spaces[0].notes.length,1);
});
test('storage failures leave no phantom routed records or modified receipt',async()=>{
  const ctx=fixture(),before=structuredClone(ctx.state);
  ctx.save=()=>{throw new Error('storage conflict');};
  await assert.rejects(routeContent(ctx,{requestId:'request',targetId:'space:union',text:'活动分工'}),/storage conflict/);
  assert.deepEqual(ctx.state,before);
});

test('manual routing colors every new record before snapshotting and restores the cursor on failed save',async()=>{
  const ctx=fixture();ctx.state.ui={sidebarPinned:true,lastCreatedColor:'#AE88FF'};
  const payload={requestId:'request',targetId:'tasks',text:'活动分工',files:[{id:'file',blobId:'blob',name:'会议.txt',size:1,type:'text/plain'}]};
  const before=structuredClone(ctx.state),save=ctx.save;
  ctx.save=()=>{throw new Error('storage conflict');};
  await assert.rejects(routeContent(ctx,payload),/storage conflict/);assert.deepEqual(ctx.state,before);
  ctx.save=save;const receipt=await routeContent(ctx,payload);let previous=before.ui.lastCreatedColor;
  for(const item of receipt.items){
    const record=ctx.state[item.collection].find(value=>value.id===item.id);
    assert.match(record.color,/^#[\da-f]{6}$/i);assert.notEqual(record.color.toLowerCase(),previous.toLowerCase());previous=record.color;
    assert.deepEqual(JSON.parse(item.snapshot),record);
  }
  assert.equal(ctx.getStored().ui.lastCreatedColor,previous);
});
test('failed undo restores records; successful undo protects edited content and original request',async()=>{
  const ctx=fixture();
  const receipt=await routeContent(ctx,{requestId:'request',targetId:'space:union',text:'活动分工',files:[{id:'file',blobId:'original',name:'会议.txt',size:1,type:'text/plain'}]});
  const before=structuredClone(ctx.state),save=ctx.save;
  ctx.save=()=>{throw new Error('quota');};
  await assert.rejects(undoRoute(ctx,receipt,'request'),/quota/);assert.deepEqual(ctx.state,before);
  ctx.save=save;ctx.state.spaces[0].notes[0].content='我补充过的分工';
  assert.deepEqual(await undoRoute(ctx,receipt,'request'),{removed:1,retained:1});
  assert.equal(ctx.state.spaces[0].notes[0].content,'我补充过的分工');
  assert.equal(ctx.state.aiRequests[0].status,'waiting_model');
});
