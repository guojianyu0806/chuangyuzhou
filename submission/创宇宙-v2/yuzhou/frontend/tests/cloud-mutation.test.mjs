import test from 'node:test';
import assert from 'node:assert/strict';
import {CloudClient} from '../src/cloud.js';

function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
function fixture(t){
  const calls=[],preserved=[],persisted=[];
  const client=Object.assign(Object.create(CloudClient.prototype),{
    authenticated:true,status:'saved',revision:2,pending:null,incoming:null,listeners:new Set(),
    uploadFiles:async()=>{},preserve(){preserved.push(structuredClone(this.pending));},
    persist(){persisted.push({revision:this.revision,pending:structuredClone(this.pending)});},
    request:async(path,options)=>{
      calls.push({path,options});
      if(options?.method==='PUT')return {revision:3};
      return {revision:4,state:{tasks:[{id:'confirmed-task',title:'合成确认待办'}],aiRequests:[{id:'r',status:'filed'}]}};
    }
  });
  t.after(()=>clearTimeout(client.timer));
  return {client,calls,preserved,persisted};
}

test('own confirmation flushes the reviewed state and immediately adopts its receipt without other-device status',async t=>{
  const {client,calls}=fixture(t),statuses=[];let applied;
  client.listeners.add(()=>statuses.push(client.status));
  client.pending={id:'before-confirm',state:{tasks:[]}};
  const result=await client.runWorkspaceMutation(async()=>{
    assert.equal(client.pending,null);
    assert.equal(client.revision,3);
    return {confirmed:true};
  },{apply:state=>{applied=state;}});
  assert.equal(result.applied,true);
  assert.equal(applied.aiRequests[0].status,'filed');
  assert.equal(applied.tasks[0].id,'confirmed-task');
  assert.equal(client.revision,4);
  assert.equal(client.status,'saved');
  assert.ok(!statuses.includes('remote'));
  assert.deepEqual(calls.map(call=>[call.path,call.options?.method]),[['/api/workspace','PUT'],['/api/workspace',undefined]]);
});

test('edits made during confirmation cannot upload an old snapshot or be discarded by result loading',async t=>{
  const {client,calls,preserved}=fixture(t),started=deferred(),finish=deferred();let applied=false;
  const mutation=client.runWorkspaceMutation(async()=>{started.resolve();await finish.promise;},{apply:()=>{applied=true;}});
  await started.promise;
  const newState={mode:'personal',tasks:[{id:'new-local-task',title:'确认过程中输入的内容'}]};
  client.enqueue(newState);
  await client.poll();
  const attemptedFlush=assert.rejects(client.flush(),/期间的新编辑已保留/);
  assert.equal(calls.length,0);
  finish.resolve();
  const result=await mutation;
  await attemptedFlush;
  assert.equal(result.applied,false);
  assert.equal(applied,false);
  assert.equal(client.status,'result');
  assert.deepEqual(client.pending.state,newState);
  assert.deepEqual(preserved[0].state,newState);
  assert.equal(calls.filter(call=>call.options?.method==='PUT').length,0);
  assert.equal(client.incoming.state.tasks[0].id,'confirmed-task');
});

test('an unsaved editor blocks result adoption even when no workspace save has been enqueued',async t=>{
  const {client}=fixture(t);let applied=false;
  const result=await client.runWorkspaceMutation(async()=>({confirmed:true}),{canApply:()=>false,apply:()=>{applied=true;}});
  assert.equal(result.applied,false);
  assert.equal(client.status,'result');
  assert.equal(applied,false);
  assert.equal(client.revision,2);
});

test('a stale poll response arriving after confirmation cannot report an older revision as another device update',async t=>{
  const {client}=fixture(t),pollResponse=deferred();let otherDevice=false;
  client.onRemote=()=>{otherDevice=true;};
  client.request=async path=>path.includes('?since=')?await pollResponse.promise:{revision:4,state:{tasks:[]}};
  const polling=client.poll();
  await client.runWorkspaceMutation(async()=>({confirmed:true}));
  pollResponse.resolve({revision:3,state:{tasks:[]}});
  await polling;
  assert.equal(otherDevice,false);
  assert.equal(client.revision,4);
  assert.equal(client.status,'saved');
});

test('failed confirmation releases its lock and keeps the workspace revision unchanged',async t=>{
  const {client,calls}=fixture(t);
  await assert.rejects(client.runWorkspaceMutation(async()=>{throw new Error('合成审核版本已过期');}),/审核版本已过期/);
  assert.equal(client.mutation,null);
  assert.equal(client.revision,2);
  assert.deepEqual(calls,[]);
  await client.flush();
});
