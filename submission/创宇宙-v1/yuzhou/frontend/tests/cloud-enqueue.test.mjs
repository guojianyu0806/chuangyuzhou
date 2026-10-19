import test from 'node:test';
import assert from 'node:assert/strict';
import {CloudClient} from '../src/cloud.js';

function setup(t,{pending=null,status='saved',failure=()=>false}={}){
  const stored=new Map(),writes=[],originalStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>stored.get(key)??null,setItem(key,value){writes.push(key);if(failure(key,writes.length))throw new DOMException('synthetic storage quota','QuotaExceededError');stored.set(key,value);}}});
  const client=Object.assign(Object.create(CloudClient.prototype),{authenticated:true,status,error:'existing status detail',revision:4,pending,incoming:null,listeners:new Set(),cacheKey:'synthetic-sync',recoveryPrefix:'synthetic-recovery-',timer:{name:'previous timer'}});
  client.persist();writes.length=0;
  t.after(()=>{if(originalStorage)Object.defineProperty(globalThis,'localStorage',originalStorage);else delete globalThis.localStorage;});
  return {client,stored,writes};
}
const prior=()=>({id:'previous-pending',state:{mode:'personal',tasks:[{id:'prior',title:'previous unsynced task'}]},createdAt:'2026-10-09T00:00:00.000Z'});
const incoming=()=>({mode:'personal',tasks:[{id:'new',title:'rejected example'}]});

test('an atomic outbox quota failure retains prior pending identity, status, timer and stored cache',t=>{
  let reject=false;const pending=prior(),{client,stored,writes}=setup(t,{pending,failure:()=>reject}),cache=stored.get(client.cacheKey),timer=client.timer;
  let notified=0;client.listeners.add(()=>notified++);reject=true;
  assert.throws(()=>client.enqueue(incoming()),{name:'QuotaExceededError'});
  assert.equal(writes.length,1,'atomic setItem failure does not attempt a redundant cache write');
  assert.equal(client.pending,pending);assert.equal(client.status,'saved');assert.equal(client.error,'existing status detail');assert.equal(client.timer,timer);
  assert.equal(stored.get(client.cacheKey),cache);assert.equal(notified,0);
});

test('quota failure with an empty outbox does not leave rejected edits waiting to upload',t=>{
  let reject=false;const {client,stored}=setup(t,{failure:()=>reject});reject=true;
  assert.throws(()=>client.enqueue(incoming()),{name:'QuotaExceededError'});
  assert.equal(client.pending,null);assert.equal(JSON.parse(stored.get(client.cacheKey)).pending,null);
  assert.equal(client.status,'saved');
});

test('failure to preserve conflict recovery restores the previously committed outbox',t=>{
  const pending=prior(),{client,stored,writes}=setup(t,{pending,status:'conflict',failure:key=>key.startsWith('synthetic-recovery-')}),timer=client.timer;
  assert.throws(()=>client.enqueue(incoming()),{name:'QuotaExceededError'});
  assert.equal(client.pending,pending);assert.equal(client.status,'conflict');assert.equal(client.timer,timer);
  assert.deepEqual(JSON.parse(stored.get(client.cacheKey)).pending,pending);
  assert.deepEqual(writes.map(key=>key===client.cacheKey?'cache':'recovery'),['cache','recovery','cache']);
});

test('an outbox restoration failure retains both errors rather than reporting a complete rollback',t=>{
  let reject=false;const pending=prior(),{client}=setup(t,{pending,status:'result',failure:(key,count)=>reject&&(key.startsWith('synthetic-recovery-')||count===3)});reject=true;
  assert.throws(()=>client.enqueue(incoming()),error=>{assert.ok(error instanceof AggregateError);assert.equal(error.errors.length,2);assert.ok(error.errors.every(item=>item.name==='QuotaExceededError'));return true;});
  assert.equal(client.pending,pending);assert.equal(client.status,'result');
});

test('successful edits during a workspace mutation remain durable without scheduling a flush',t=>{
  const {client,stored}=setup(t),timer=client.timer;client.mutation=Promise.resolve();const state=incoming();
  client.enqueue(state);assert.deepEqual(client.pending.state,state);assert.notEqual(client.pending.state,state);assert.deepEqual(JSON.parse(stored.get(client.cacheKey)).pending,client.pending);
  assert.equal(client.timer,timer);assert.equal(client.status,'saved');
});
