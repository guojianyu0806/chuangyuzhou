import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {createWorkbenchServer} from '../server.mjs';
import {createHermesService} from '../hermes.mjs';
import {assertRuntimePath,RUNTIME_ROOT} from '../../runtime.mjs';
import {validateWorkspaceTopics} from '../../frontend/src/workspace-topics-model.js';

const apiRoot='/api/workspace/topics';
const setupToken='offline-test-topics-setup';
const credentials={username:'topics-fixture',password:'synthetic-topic-test-password'};
const newWorkspace=()=>({schema:1,mode:'personal',profile:{name:'合成账号'},courses:[],captures:[],english:{},
  tasks:[{id:'existing-task',title:'保存原待办'}],
  spaces:[{id:'project-space',title:'参赛准备',description:'比赛材料与演示',notes:[{id:'private-note',title:'保留笔记',content:'仅本地正文，不发送给归类模型'}],files:[]},
    {id:'hidden-space',title:'已归档空间',archived:true,notes:[],files:[]}],
  canvas:{cards:[{id:'tasks',x:20,y:40,w:300,h:300},{id:'project-space',x:400,y:30,w:300,h:300}],view:{x:25,y:0,zoom:1.1}},
});
const defaultModel=({user})=>({cards:JSON.parse(user).cards.map(({id})=>({id,topic:'参赛整理',reason:'同一批次的主题建议'}))});

async function fixture(t,runModel=defaultModel){
  const root=assertRuntimePath(join(RUNTIME_ROOT,'tests-temp'));
  await mkdir(root,{recursive:true});
  const dataDir=assertRuntimePath(await mkdtemp(join(root,'workspace-topics-')));
  let app,origin;
  async function start(){
    app=await createWorkbenchServer({dataDir,secureCookie:false,setupToken,
      modelFactory:({dataDir,store})=>createHermesService({dataDir,store,engineAvailable:()=>true,runModel})});
    await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
    origin=`http://127.0.0.1:${app.server.address().port}`;
  }
  function client(){
    let cookie='',csrf='';
    return async (path,method='GET',body)=>{
      const response=await fetch(origin+path,{method,headers:{...(cookie?{Cookie:cookie,'X-CSRF-Token':csrf}:{}),
        ...(body===undefined?{}:{'Content-Type':'application/json',Origin:origin})},
        ...(body===undefined?{}:{body:JSON.stringify(body)})});
      const session=response.headers.get('set-cookie');
      if(session)cookie=session.split(';')[0];
      const value=await response.json();if(value.csrfToken)csrf=value.csrfToken;
      return {status:response.status,body:value};
    };
  }
  t.after(async()=>{await app?.close();await rm(assertRuntimePath(dataDir),{recursive:true,force:true});});
  await start();
  const first=client(),second=client();
  assert.equal((await first('/api/auth/setup','POST',{...credentials,setupToken})).status,201);
  assert.equal((await second('/api/auth/login','POST',credentials)).status,200);
  assert.equal((await first('/api/model/config','PUT',{provider:'deepseek',model:'deepseek-flash',apiKey:'synthetic-fixture-no-network'})).status,200);
  app.store.saveWorkspace(0,newWorkspace());
  async function draft(id,api=first){
    for(let attempt=0;attempt<150;attempt++){
      const response=await api(`${apiRoot}/draft?draftId=${id}`);
      assert.equal(response.status,200);
      if(response.body.status!=='pending')return response.body;
      await new Promise(resolve=>setTimeout(resolve,8));
    }
    assert.fail('Synthetic topic suggestion did not complete');
  }
  async function suggest(cardIds=['tasks'],api=first){
    const id=randomUUID();
    assert.equal((await api(`${apiRoot}/suggest`,'POST',{draftId:id,cardIds})).status,202);
    const ready=await draft(id,api);
    assert.equal(ready.status,'ready',JSON.stringify(ready));
    return ready.draft;
  }
  return {first,second,anonymous:client(),draft,suggest,workspace:()=>app.store.getWorkspace(),restart:async()=>{await app.close();await start();}};
}

function withoutTopics(state){const {workspaceTopics,...original}=state;return original;}
const confirm=(api,draftId,changes)=>api(`${apiRoot}/confirm`,'POST',{draftId,changes});
const undo=(api,batchId)=>api(`${apiRoot}/undo`,'POST',{batchId});

test('topic preview sends only selected card metadata, survives process restart, and leaves the workspace unchanged',async t=>{
  const calls=[];
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const f=await fixture(t,async input=>{calls.push(JSON.parse(input.user));await gate;return defaultModel(input);});
  const before=f.workspace();
  assert.equal((await f.anonymous(`${apiRoot}/receipt?batchId=${randomUUID()}`)).status,401);
  const invalid=await f.first(`${apiRoot}/suggest`,'POST',{draftId:randomUUID(),cardIds:['hidden-space']});
  assert.equal(invalid.status,409);assert.deepEqual(invalid.body.cardIds,['hidden-space']);
  assert.equal(calls.length,0);
  const draftId=randomUUID(),cardIds=['tasks','project-space'];
  const input={draftId,cardIds};
  assert.equal((await f.first(`${apiRoot}/suggest`,'POST',input)).status,202);
  assert.equal((await f.second(`${apiRoot}/suggest`,'POST',{draftId,cardIds:[...cardIds].reverse()})).status,200);
  assert.equal((await f.second(`${apiRoot}/draft?draftId=${draftId}`)).body.status,'pending');
  assert.equal((await f.second(`${apiRoot}/suggest`,'POST',{draftId,cardIds:['tasks']})).body.error,'TOPIC_BATCH_CONFLICT');
  release();
  const ready=await f.draft(draftId,f.second);
  assert.equal(ready.status,'ready');assert.equal(ready.draft.id,draftId);
  assert.equal(calls.length,1);
  assert.deepEqual(calls[0].cards.map(card=>card.id),['project-space','tasks']);
  for(const card of calls[0].cards)assert.deepEqual(Object.keys(card).sort(),['description','id','kind','title']);
  assert.doesNotMatch(JSON.stringify(calls),/仅本地正文|private-note|hidden-space/);
  assert.deepEqual(f.workspace(),before);
  assert.deepEqual((await f.first('/api/ai/jobs')).body.jobs,[]);
  await f.restart();
  assert.deepEqual(await f.draft(draftId),ready);
  assert.equal(calls.length,1);
  const saved=await confirm(f.first,draftId,[{id:'tasks',topic:'人工修订'}]);
  assert.equal(saved.status,200);
  assert.deepEqual(f.workspace().state.workspaceTopics.assignments,[{id:'tasks',topic:'人工修订',batchId:draftId}]);
  assert.deepEqual(withoutTopics(f.workspace().state),before.state);
});

test('stale targets or assignments block a whole batch while unrelated newer edits survive confirmation',async t=>{
  const f=await fixture(t);
  const stale=await f.suggest(['tasks','project-space']);
  const current=await f.suggest(['tasks']);
  assert.equal((await confirm(f.second,current.id,[{id:'tasks',topic:'新分组'}])).status,200);
  const snapshot=f.workspace();
  const conflict=await confirm(f.first,stale.id,[{id:'tasks',topic:'旧窗口分组'},{id:'project-space',topic:'旧窗口分组'}]);
  assert.equal(conflict.status,409);assert.equal(conflict.body.error,'TOPIC_DRAFT_STALE');
  assert.deepEqual(conflict.body.cardIds,['tasks']);
  assert.deepEqual(f.workspace(),snapshot);
  const next=await f.suggest(['project-space']);
  const withEdits=structuredClone(snapshot.state);
  withEdits.tasks[0].title='第二窗口刚编辑的待办';
  withEdits.spaces[0].notes[0].content='第二窗口保存的笔记正文';
  withEdits.canvas.cards[1].x=477;
  assert.equal((await f.second('/api/workspace','PUT',{baseRevision:snapshot.revision,state:withEdits})).status,200);
  assert.equal((await confirm(f.first,next.id,[{id:'project-space',topic:'改进项目'}])).status,200);
  assert.deepEqual(withoutTopics(f.workspace().state),withoutTopics(withEdits));
  const oldClient=withoutTopics(f.workspace().state);
  assert.equal((await f.second('/api/workspace','PUT',{baseRevision:f.workspace().revision,state:oldClient})).body.error,'workspace_update_required');
  assert.equal((await f.second('/api/workspace','PUT',{baseRevision:snapshot.revision,state:withEdits})).body.error,'revision_conflict');
  const archived=await f.suggest(['project-space']);
  const after=f.workspace();after.state.spaces[0].archived=true;
  assert.equal((await f.second('/api/workspace','PUT',{baseRevision:after.revision,state:after.state})).status,200);
  assert.equal((await confirm(f.first,archived.id,[{id:'project-space',topic:'拒绝归档对象'}])).body.error,'TOPIC_DRAFT_STALE');
});

test('a lost confirm response replays exactly once, and undo preserves later changes and distinguishes empty tombstones',async t=>{
  const f=await fixture(t);
  const oldEmpty=await f.suggest(['project-space']);
  const first=await f.suggest(['tasks','project-space']);
  const changes=[{id:'tasks',topic:'初始整理'},{id:'project-space',topic:'初始整理'}];
  const committed=await confirm(f.first,first.id,changes);
  assert.equal(committed.status,200);
  const committedSnapshot=f.workspace();
  const fromOther=(await f.second(`${apiRoot}/receipt?batchId=${first.id}`)).body.receipt;
  assert.deepEqual(fromOther,committed.body.receipt);
  assert.deepEqual((await confirm(f.second,first.id,[...changes].reverse())).body,committed.body);
  assert.equal((await confirm(f.second,first.id,[{id:'tasks',topic:'不同重试'}])).body.error,'TOPIC_BATCH_CONFLICT');
  assert.deepEqual(f.workspace(),committedSnapshot);
  const later=await f.suggest(['tasks']);
  assert.equal((await confirm(f.second,later.id,[{id:'tasks',topic:'后来的归类'}])).status,200);
  const fresh=f.workspace();fresh.state.spaces[0].notes[0].content='后来的正文';fresh.state.canvas.cards[0].y=80;
  assert.equal((await f.second('/api/workspace','PUT',{baseRevision:fresh.revision,state:fresh.state})).status,200);
  const undone=await undo(f.first,first.id);
  assert.equal(undone.status,200);assert.deepEqual(undone.body.receipt.skipped,['tasks']);
  assert.equal(undone.body.receipt.status,'undone');
  assert.deepEqual(f.workspace().state.workspaceTopics.assignments,[{id:'project-space',topic:null,batchId:first.id},{id:'tasks',topic:'后来的归类',batchId:later.id}]);
  assert.deepEqual(withoutTopics(f.workspace().state),withoutTopics(fresh.state));
  const afterUndo=f.workspace();
  assert.deepEqual((await undo(f.second,first.id)).body,undone.body);
  assert.equal((await confirm(f.second,first.id,changes)).body.receipt.status,'undone');
  assert.equal((await confirm(f.second,oldEmpty.id,[{id:'project-space',topic:'过时建议'}])).body.error,'TOPIC_DRAFT_STALE');
  assert.deepEqual(f.workspace(),afterUndo);
  const dangling=structuredClone(afterUndo.state.workspaceTopics);
  dangling.assignments[0].batchId=randomUUID();
  assert.throws(()=>validateWorkspaceTopics(dangling),/主题归类/);
});

test('a malformed model result cannot target extra cards or become a confirmable draft',async t=>{
  const f=await fixture(t,()=>({cards:[{id:'hidden-space',topic:'模型伪造目标',reason:'不要采纳'}]}));
  const draftId=randomUUID();
  assert.equal((await f.first(`${apiRoot}/suggest`,'POST',{draftId,cardIds:['tasks']})).status,202);
  const failed=await f.draft(draftId);
  assert.equal(failed.status,'failed');assert.equal(failed.error.code,'INVALID_PROPOSAL');assert.equal(failed.draft,null);
  assert.equal((await confirm(f.first,draftId,[{id:'tasks',topic:'未审核'}])).body.error,'TOPIC_DRAFT_NOT_READY');
  assert.equal(f.workspace().state.workspaceTopics,undefined);
});
