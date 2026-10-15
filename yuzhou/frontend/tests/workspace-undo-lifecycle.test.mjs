import test from 'node:test';
import assert from 'node:assert/strict';
import {undoRoute,routeContent} from '../src/workspace-model.js';
import {applyWorkspaceActions} from '../src/workspace-actions.js';

const NOW='2026-10-15T00:00:00.000Z';
function fixture(){
  const state={spaces:[],courses:[],tasks:[],captures:[],aiRequests:[{id:'r',text:'创建一项验收待办',status:'waiting_model',files:[]}],ui:{lastCreatedColor:'#AE88FF'}};
  let sequence=0,current=true;
  const saved=[];
  const ctx={state,uid:()=>`record-${++sequence}`,isCurrent:()=>current,save(){saved.push(structuredClone(state));}};
  const receipt=applyWorkspaceActions(state,'r',[{entity:'task',operation:'create',data:{title:'合成待办'}}],{uid:ctx.uid,now:NOW});
  Object.assign(state.aiRequests[0],{status:'filed',receipt,conversation:{version:1,messages:[{id:'message',role:'user',text:'保留原始消息',createdAt:NOW}],confirmedJobId:'confirmed',pendingJobId:'pending',proposal:{title:'过期审核单'},parentRequestId:'parent'}});
  return {ctx,state,receipt,saved,changeWorkspace(){current=false;}};
}

test('undo refuses a workspace that changed while its action module was loading',async()=>{
  const f=fixture(),before=structuredClone(f.state);
  const pending=undoRoute(f.ctx,f.receipt,'r');
  f.changeWorkspace();
  await assert.rejects(pending,/工作台已更新/);
  assert.deepEqual(f.state,before);
  assert.deepEqual(f.saved,[]);
});

test('action undo persists business changes and cleared execution metadata in one snapshot',async()=>{
  const f=fixture();
  assert.deepEqual(await undoRoute(f.ctx,f.receipt,'r'),{removed:1,retained:0});
  assert.equal(f.saved.length,1);
  const saved=f.saved[0],request=saved.aiRequests[0];
  assert.equal(saved.tasks.length,0);
  assert.equal(request.status,'waiting_model');
  assert.equal(Object.hasOwn(request,'receipt'),false);
  for(const key of ['confirmedJobId','pendingJobId','proposal'])assert.equal(Object.hasOwn(request.conversation,key),false,key);
  assert.equal(request.conversation.messages[0].text,'保留原始消息');
  assert.equal(request.conversation.parentRequestId,'parent');
});

test('failed action undo restores both domain records and the complete conversation receipt',async()=>{
  const f=fixture(),before=structuredClone(f.state);
  f.ctx.save=async()=>{throw new Error('synthetic persistence failure');};
  await assert.rejects(undoRoute(f.ctx,f.receipt,'r'),/synthetic persistence failure/);
  assert.deepEqual(f.state,before);
});

test('manual undo also clears execution metadata atomically and rolls back asynchronous save failure',async()=>{
  const f=fixture();
  f.state.tasks=[];f.state.aiRequests[0].status='waiting_model';delete f.state.aiRequests[0].receipt;
  const receipt=await routeContent(f.ctx,{requestId:'r',targetId:'inbox',text:'合成手动归档'});
  const before=structuredClone(f.state),save=f.ctx.save;
  f.ctx.save=async()=>{throw new Error('synthetic manual persistence failure');};
  await assert.rejects(undoRoute(f.ctx,receipt,'r'),/synthetic manual persistence failure/);
  assert.deepEqual(f.state,before);
  f.ctx.save=save;f.saved.length=0;
  await undoRoute(f.ctx,receipt,'r');
  assert.equal(f.saved.length,1);
  const request=f.saved[0].aiRequests[0];
  assert.equal(request.status,'waiting_model');
  assert.equal(Object.hasOwn(request,'receipt'),false);
  for(const key of ['confirmedJobId','pendingJobId','proposal'])assert.equal(Object.hasOwn(request.conversation,key),false,key);
  assert.equal(request.conversation.messages[0].text,'保留原始消息');
});
