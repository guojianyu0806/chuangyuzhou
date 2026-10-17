import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspaceStorage,sameWorkspaceContent} from '../src/workspace-storage.js';
import {CloudClient} from '../src/cloud.js';

const account='storage-fixture',prefix=`czb-yuzhou-cloud-v1-${account}-`,recovery=`czb-yuzhou-cloud-recovery-${account}-`;
const tab='00000000-0000-4000-8000-000000000034',workspace=`${prefix}${tab}-workspace-personal`,sync=`${prefix}${tab}-sync`;
function legacy(initial={}){
  const values={...initial};Object.defineProperties(values,{
    getItem:{value:key=>values[key]??null},setItem:{writable:true,value:(key,value)=>{values[key]=value;}},removeItem:{value:key=>{delete values[key];}}
  });return values;
}
function backend(initial=[]){
  const values=new Map(initial),writes=[];
  return {values,writes,reject:false,hold:null,corrupt:false,
    async entries(prefix){return [...values].filter(([key])=>key.startsWith(prefix));},
    async write(entries){writes.push(entries);if(this.hold)await this.hold;if(this.reject)throw new DOMException('synthetic disk full','QuotaExceededError');for(const [key,value] of entries)value===null?values.delete(key):values.set(key,this.corrupt?'corrupt':value);}
  };
}
const sample=title=>({schema:1,mode:'personal',updatedAt:'2026-10-17',tasks:[{id:'task',title}],captures:[]});
function clientWith(storage){
  return Object.assign(Object.create(CloudClient.prototype),{storage,cacheKey:sync,recoveryPrefix:recovery,account,revision:2,status:'saved',authenticated:true,pending:null,listeners:new Set(),uploadFiles:async()=>{}});
}

test('migration durably verifies full snapshots and drafts before releasing only this account legacy cache',async()=>{
  const sibling=`${prefix}another-${tab}-workspace-personal`,content='文'.repeat(3*1024*1024),source=legacy({[workspace]:content,[sync]:'{"pending":null}',[`${prefix}${tab}-draft-note`]:'draft',[sibling]:'sibling account',unrelated:'keep', 'lumi-cloud-v1-private':'untouched'}),disk=backend();
  const store=await createWorkspaceStorage(account,{legacy:source,backend:disk});
  assert.equal(store.getItem(workspace),content);assert.equal(disk.values.get(workspace),content);assert.equal(source.getItem(workspace),null);
  assert.equal(source.unrelated,'keep');assert.equal(source['lumi-cloud-v1-private'],'untouched');assert.equal(source[sibling],'sibling account');assert.equal(disk.values.has(sibling),false);assert.equal(disk.values.has('unrelated'),false);
  assert.throws(()=>store.setItem(sibling,'denied'),/账号范围/);
  source.setItem=()=>{throw Error('localStorage exhausted');};store.setItem(workspace,content+'more');await store.settled();assert.equal(disk.values.get(workspace),content+'more');
});

test('a failed or unverified migration never removes any original cache',async()=>{
  for(const mode of ['reject','corrupt']){const source=legacy({[workspace]:'original',[sync]:'outbox'}),disk=backend();disk[mode]=true;
    await assert.rejects(createWorkspaceStorage(account,{legacy:source,backend:disk}));assert.equal(source.getItem(workspace),'original');assert.equal(source.getItem(sync),'outbox');}
});

test('an old tab changing its cache during migration keeps that newly edited legacy value',async()=>{
  const source=legacy({[workspace]:'before'}),disk=backend(),write=disk.write.bind(disk);
  disk.write=async entries=>{await write(entries);source.setItem(workspace,'during migration');};
  await createWorkspaceStorage(account,{legacy:source,backend:disk});assert.equal(source.getItem(workspace),'during migration');assert.equal(disk.values.get(workspace),'before');
});

test('both IDB and later legacy versions remain recoverable when the same key differs',async()=>{
  const source=legacy({[workspace]:JSON.stringify(sample('legacy'))}),disk=backend([[workspace,JSON.stringify(sample('idb'))]]);
  const store=await createWorkspaceStorage(account,{legacy:source,backend:disk}),client=clientWith(store);
  assert.equal(JSON.parse(store.getItem(workspace)).tasks[0].title,'legacy');assert.equal(client.recoveryCopies()[0].state.tasks[0].title,'idb');
});

test('failed durable writes retain in-memory edits and retry the same content instead of losing them',async()=>{
  const disk=backend(),store=await createWorkspaceStorage(account,{legacy:legacy(),backend:disk});let notice=0;store.onError=()=>notice++;
  disk.reject=true;store.setItem(workspace,'keep this edit');await assert.rejects(store.settled(),{name:'WorkspaceStorageError'});
  assert.equal(store.getItem(workspace),'keep this edit');assert.equal(disk.values.has(workspace),false);assert.equal(store.dirty,true);assert.equal(notice,1);
  disk.reject=false;await store.retry();assert.equal(disk.values.get(workspace),'keep this edit');assert.equal(store.dirty,false);
  await assert.rejects(async()=>store.setItem('another-account-key','denied'),/账号范围/);
});

test('a newer edit arriving during a transaction is committed after the older edit',async()=>{
  const disk=backend(),store=await createWorkspaceStorage(account,{legacy:legacy(),backend:disk});let release;disk.hold=new Promise(done=>release=done);
  store.setItem(workspace,'first');const waiting=store.settled();store.setItem(workspace,'second');release();await waiting;
  assert.equal(disk.values.get(workspace),'second');assert.equal(store.dirty,false);
});

test('the same conflicted pending snapshot is preserved once even after repeated notifications',async()=>{
  const disk=backend(),store=await createWorkspaceStorage(account,{legacy:legacy(),backend:disk}),client=clientWith(store);
  client.pending={id:tab,state:sample('local')};client.conflict();client.conflict();client.preserve();await store.settled();
  assert.equal(store.keys().filter(key=>key.startsWith(recovery)).length,1);assert.equal(client.recoveryCopies().length,1);
});

test('a stale revision with identical content clears its outbox without another write or conflict',async()=>{
  const disk=backend(),store=await createWorkspaceStorage(account,{legacy:legacy(),backend:disk}),client=clientWith(store),state=sample('already saved');
  client.pending={id:'same',state};client.status='conflict';client.persist();await store.settled();
  client.request=async()=>({revision:9,state:{...state,updatedAt:'new timestamp'}});
  const result=await client.initialize({});assert.equal(result.tasks[0].title,'already saved');assert.equal(client.pending,null);assert.equal(client.revision,9);assert.equal(client.status,'saved');
});

test('a lost response followed by 409 acknowledges equal content, but retains genuine differences',async()=>{
  for(const equal of [true,false]){
    const disk=backend(),store=await createWorkspaceStorage(account,{legacy:legacy(),backend:disk}),client=clientWith(store),state=sample('local');client.pending={id:tab,state};client.persist();
    client.request=async(path,options)=>{if(options?.method==='PUT'){const error=Error('conflict');error.status=409;error.code='revision_conflict';throw error;}return {revision:7,state:equal?{...state,updatedAt:'later'}:sample('remote')};};
    if(equal){await client.flush();assert.equal(client.pending,null);assert.equal(client.status,'saved');assert.equal(client.revision,7);}
    else{await assert.rejects(client.flush());await store.settled();assert.equal(client.pending.state.tasks[0].title,'local');assert.equal(client.incoming.state.tasks[0].title,'remote');assert.equal(client.status,'conflict');assert.equal(client.recoveryCopies().length,1);}
  }
});

test('local durability gates every network write and an actual disk failure leaves the outbox pending',async()=>{
  const disk=backend(),store=await createWorkspaceStorage(account,{legacy:legacy(),backend:disk}),client=clientWith(store);let writes=0;
  client.pending={id:'p',state:sample('local')};client.persist();disk.reject=true;client.request=async()=>{writes++;return {revision:3};};
  await assert.rejects(client.flush());assert.equal(writes,0);assert.equal(client.pending.state.tasks[0].title,'local');
  disk.reject=false;await client.flush();assert.equal(writes,1);assert.equal(client.pending,null);assert.equal(client.status,'saved');
});

test('startup disk failure still exposes downloaded content with an actionable storage status',async()=>{
  const disk=backend(),store=await createWorkspaceStorage(account,{legacy:legacy(),backend:disk}),client=clientWith(store),state=sample('readable content');
  disk.reject=true;client.request=async()=>({revision:8,state});
  assert.deepEqual(await client.initialize({}),state);assert.equal(client.status,'storage');assert.match(client.error,/保留此页面/);assert.equal(store.dirty,true);
  disk.reject=false;await store.retry();assert.equal(JSON.parse(disk.values.get(sync)).revision,8);
});

test('explicit remote loading waits for a durable recovery copy and protects edits made during that wait',async()=>{
  const disk=backend(),store=await createWorkspaceStorage(account,{legacy:legacy(),backend:disk}),client=clientWith(store);client.pending={id:tab,state:sample('local')};
  client.request=async()=>({revision:3,state:sample('remote')});let release;disk.hold=new Promise(done=>release=done);
  const accepting=client.acceptRemote();await new Promise(done=>setImmediate(done));client.pending={id:'new',state:sample('typed during preservation')};release();await assert.rejects(accepting,/新的编辑/);
  assert.equal(client.pending.id,'new');assert.equal(client.revision,2);assert.equal(client.recoveryCopies()[0].state.tasks[0].title,'local');
});

test('content comparison ignores only the root save timestamp, preserving nested changes and array order',()=>{
  const a=sample('one');assert.ok(sameWorkspaceContent(a,{...a,updatedAt:'later'}));assert.equal(sameWorkspaceContent(a,sample('two')),false);
  assert.equal(sameWorkspaceContent({tasks:[{updatedAt:'a'}]},{tasks:[{updatedAt:'b'}]}),false);
  assert.equal(sameWorkspaceContent({tasks:[1,2]},{tasks:[2,1]}),false);
});

test('edits arriving during the final mutation persistence cannot be overwritten by server result adoption',async()=>{
  const disk=backend(),store=await createWorkspaceStorage(account,{legacy:legacy(),backend:disk}),client=clientWith(store);let release,started;
  const operationStarted=new Promise(done=>started=done);client.request=async()=>({revision:3,state:sample('server result')});let applied=false;
  const mutation=client.runWorkspaceMutation(async()=>{disk.hold=new Promise(done=>release=done);started();return {confirmed:true};},{apply:()=>{applied=true;}});
  await operationStarted;await new Promise(done=>setImmediate(done));client.enqueue(sample('typed during final disk transaction'));release();
  const result=await mutation;clearTimeout(client.timer);assert.equal(result.applied,false);assert.equal(applied,false);assert.equal(client.pending.state.tasks[0].title,'typed during final disk transaction');assert.equal(client.status,'result');
});
