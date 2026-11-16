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

async function fixture(t,runModel=defaultModel,{configureModel=true}={}){
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
  if(configureModel){
    assert.equal((await first('/api/model/config','PUT',{provider:'deepseek',model:'deepseek-flash',apiKey:'synthetic-fixture-no-network'})).status,200);
  }
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
const move=(api,body)=>api(`${apiRoot}/move`,'POST',body);

test('topic preview sends only selected card metadata, survives process restart, and leaves the workspace unchanged',async t=>{
  const calls=[];
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const f=await fixture(t,async input=>{calls.push(JSON.parse(input.user));await gate;return defaultModel(input);});
  const before=f.workspace();
  assert.equal((await f.anonymous(`${apiRoot}/receipt?batchId=${randomUUID()}`)).status,401);
  const invalid=await f.first(`${apiRoot}/suggest`,'POST',{draftId:randomUUID(),cardIds:['hidden-space']});
  assert.equal(invalid.status,409);assert.deepEqual(invalid.body.cardIds,['hidden-space']);
  const withAssistant=await f.first(`${apiRoot}/suggest`,'POST',{draftId:randomUUID(),cardIds:['ai','tasks']});
  assert.equal(withAssistant.status,409);assert.deepEqual(withAssistant.body.cardIds,['ai']);
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
  const forged=await confirm(f.first,draftId,[{id:'ai',topic:'拒绝额外对象'}]);
  assert.equal(forged.body.error,'TOPIC_INVALID_INPUT');
  assert.deepEqual(f.workspace(),before);
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
  withEdits.canvas.topicBoxes=[{id:randomUUID(),title:'第二窗口的收纳盒',x:180,y:440,collapsed:true,cardIds:['project-space']}];
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

test('manual moves persist and undo through the existing receipt API without a configured model',async t=>{
  const f=await fixture(t,()=>assert.fail('Manual moves must not call the model'),{configureModel:false});
  const before=f.workspace();
  const newTheme={batchId:randomUUID(),cardId:'project-space',topic:'  新主题  ',expected:null};
  assert.equal((await move(f.anonymous,newTheme)).status,401);
  const saved=await move(f.first,newTheme);
  assert.equal(saved.status,200);
  assert.equal(saved.body.receipt.kind,'move');
  assert.deepEqual(saved.body.receipt.changes,[{id:'project-space',topic:'新主题',previous:null}]);
  assert.equal(saved.body.workspaceRevision,before.revision+1);
  const after=f.workspace();
  assert.deepEqual(withoutTopics(after.state),before.state);
  await f.restart();
  const recovered=await f.second(`${apiRoot}/receipt?batchId=${newTheme.batchId}`);
  assert.deepEqual(recovered.body,saved.body);
  assert.deepEqual((await move(f.second,{...newTheme,topic:'新主题'})).body,saved.body);
  assert.equal((await move(f.second,{...newTheme,topic:'另一个主题'})).body.error,'TOPIC_BATCH_CONFLICT');
  assert.deepEqual(f.workspace(),after);

  const expected={topic:'新主题',batchId:newTheme.batchId};
  const toUnclassified={...newTheme,batchId:randomUUID(),topic:null,expected};
  assert.equal((await move(f.second,{...toUnclassified,topic:'新主题'})).body.error,'TOPIC_NO_CHANGES');
  const unclassified=await move(f.first,toUnclassified);
  assert.equal(unclassified.status,200);
  assert.deepEqual(unclassified.body.receipt.changes,[{id:'project-space',topic:null,previous:expected}]);
  const undone=await undo(f.second,toUnclassified.batchId);
  assert.equal(undone.status,200);
  assert.equal(undone.body.receipt.kind,'move');
  assert.deepEqual(f.workspace().state.workspaceTopics.assignments,[{id:'project-space',topic:'新主题',batchId:toUnclassified.batchId}]);
  assert.deepEqual((await move(f.first,toUnclassified)).body,undone.body);
  assert.deepEqual(withoutTopics(f.workspace().state),before.state);
});

test('manual moves reject stale, hidden and reserved targets without overwriting newer grouping or a draft',async t=>{
  const f=await fixture(t);
  const draft=await f.suggest(['project-space','tasks']);
  const operation={batchId:randomUUID(),cardId:'project-space',topic:'人工调整',expected:null};
  assert.equal((await move(f.first,{...operation,batchId:draft.id})).body.error,'TOPIC_BATCH_CONFLICT');
  for(const cardId of ['ai','hidden-space','no-such-card']){
    const blocked=await move(f.first,{...operation,cardId});
    assert.equal(blocked.status,409);
    assert.equal(blocked.body.error,'TOPIC_MOVE_STALE');
    assert.equal(blocked.body.cardId,cardId);
  }
  assert.equal((await move(f.first,{...operation,expected:{topic:null}})).body.error,'TOPIC_INVALID_INPUT');
  assert.equal(f.workspace().state.workspaceTopics,undefined);
  assert.equal((await move(f.second,operation)).status,200);
  const current=f.workspace();
  const conflict=await move(f.first,{...operation,batchId:randomUUID(),topic:'旧窗口的分组'});
  assert.equal(conflict.body.error,'TOPIC_MOVE_STALE');
  assert.equal((await confirm(f.first,draft.id,[{id:'project-space',topic:'草稿建议'}])).body.error,'TOPIC_DRAFT_STALE');
  assert.deepEqual(f.workspace(),current);
  assert.equal((await confirm(f.first,draft.id,[{id:'tasks',topic:'仍可确认的建议'}])).status,200);
  assert.equal((await undo(f.second,operation.batchId)).status,200);
  assert.equal((await move(f.first,{...operation,batchId:randomUUID()})).body.error,'TOPIC_MOVE_STALE',
    'A move followed by undo leaves an assignment version even when the card returns to unclassified');
});
