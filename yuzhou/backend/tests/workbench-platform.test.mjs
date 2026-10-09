import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createStore,validateWorkspace} from '../store.mjs';
import {assertRuntimePath} from '../../runtime.mjs';
import {createWorkbench,configureWorkbench,WORKBENCH_MODULES} from '../../frontend/src/workbench-model.js';
import {validateBackup,mergeBackup} from '../../frontend/src/backup.js';
import {applyWorkspaceActions,previewWorkspaceActions,undoWorkspaceActions,validateWorkspaceActions} from '../../frontend/src/workspace-actions.js';
import {workspaceOverview,workspaceFingerprint,runWorkspaceQuery,validateWorkspaceQueries} from '../workspace-queries.mjs';
import {buildPrompt,createHermesService} from '../hermes.mjs';
import {initializeSpaces} from '../../frontend/src/workspace-model.js';
import {seedEnglish} from '../../frontend/src/english.js';

const NOW='2026-10-09T08:00:00.000Z';
const state=()=>({schema:1,mode:'personal',profile:{},english:{},courses:[],spaces:[],tasks:[{id:'existing-task',title:'应保留的真实类型记录'}],captures:[],aiRequests:[],workbench:createWorkbench('blank'),updatedAt:NOW});
const action=(entity,id,data)=>({entity,operation:'update',id,data});
const moduleAction=(id,data)=>action('workbenchModule',id,data);
const actions=()=>[action('workbenchSettings','workbench',{title:'我的创作基地'}),moduleAction('tasks',{enabled:true,title:'创作清单',position:1}),moduleAction('courses',{enabled:true,title:'研究资料',position:2})];
const backup=value=>({format:'lumi-backup',version:1,state:value,files:[],exportedAt:NOW});
function options(){let next=0;return {now:NOW,uid:()=>`generated-${++next}`};}
function temporary(t,prefix,beforeCleanup=()=>{}){assertRuntimePath(tmpdir());const directory=mkdtempSync(join(tmpdir(),prefix));t.after(()=>{beforeCleanup();const target=resolve(directory);assertRuntimePath(target);assert.ok(target.startsWith(resolve(join(tmpdir(),prefix))));rmSync(target,{recursive:true,force:true});});return directory;}

test('platform configuration survives SQLite restart and backup without changing business records',t=>{
  let store;const directory=temporary(t,'czb-platform-persistence-',()=>store?.close());store=createStore(directory);
  const initial=state(),records=structuredClone(initial.tasks);store.saveWorkspace(0,initial);
  const next=store.getWorkspace();applyWorkspaceActions(next.state,'synthetic',actions(),options());store.saveWorkspace(next.revision,next.state);
  store.close();store=createStore(directory);const restored=store.getWorkspace().state;
  assert.equal(restored.workbench.title,'我的创作基地');assert.equal(restored.workbench.modules[1].id,'tasks');assert.equal(restored.workbench.modules[1].title,'创作清单');
  assert.deepEqual(restored.tasks,records);assert.deepEqual(validateBackup(backup(restored)).state.workbench,restored.workbench);
  const old=state();delete old.workbench;const merged=mergeBackup(old,backup(restored));assert.deepEqual(merged.state.workbench,restored.workbench);assert.equal(mergeBackup(merged.state,backup(restored)).count,0);
});

test('backup import preserves current platform choices and rejects malformed configuration',()=>{
  const current=state(),source=state();configureWorkbench(current,{title:'保留当前名称'});configureWorkbench(source,{moduleId:'tasks',enabled:true});
  assert.deepEqual(mergeBackup(current,backup(source)).state.workbench,current.workbench);
  const old=state();delete old.workbench;assert.deepEqual(mergeBackup(current,backup(old)).state.workbench,current.workbench);
  for(const mutate of [s=>{s.modules[0].enabled=false;},s=>{s.modules.pop();},s=>{s.modules[1].id='external-command';},s=>{s.title='x'.repeat(81);},s=>{s.path='C:/other-project';}]){
    const invalid=state();mutate(invalid.workbench);assert.throws(()=>validateWorkspace(invalid),error=>error.code==='invalid_workbench');assert.throws(()=>validateBackup(backup(invalid)));
  }
});

test('fresh initialized accounts restore a saved workbench while completed choices remain authoritative',()=>{
  const fresh=initializeSpaces({schema:1,mode:'personal',workbench:createWorkbench('blank'),profile:{name:'我',major:'',provider:'deepseek'},courses:[],english:seedEnglish(false),tasks:[],captures:[],updatedAt:NOW});
  assert.equal(fresh.workbench.onboardingComplete,false);const original=structuredClone(fresh);
  const saved=state();configureWorkbench(saved,{title:'从备份恢复的研究台'});configureWorkbench(saved,{moduleId:'courses',enabled:true,position:1});
  const restored=mergeBackup(fresh,backup(saved));assert.deepEqual(restored.state.workbench,saved.workbench);assert.deepEqual(fresh,original);assert.ok(restored.count>0);assert.equal(mergeBackup(restored.state,backup(saved)).count,0);
  const completed=initializeSpaces(structuredClone(fresh));configureWorkbench(completed,{title:'用户已完成当前搭建'});const current=structuredClone(completed.workbench);
  assert.deepEqual(mergeBackup(completed,backup(saved)).state.workbench,current);
  const legacy=state();delete legacy.workbench;assert.deepEqual(mergeBackup(fresh,backup(legacy)).state.workbench,fresh.workbench);
  assert.equal(mergeBackup(fresh,backup(fresh)).count,0,'untouched blank backups are also idempotent');
});

test('old clients cannot silently discard an existing platform configuration',t=>{
  let store;const directory=temporary(t,'czb-platform-legacy-',()=>store?.close());store=createStore(directory);
  const initial=state();delete initial.workbench;store.saveWorkspace(0,initial);assert.equal(store.getWorkspace().state.workbench,undefined);
  store.saveWorkspace(1,state());const before=store.getWorkspace();const outdated=structuredClone(before.state);delete outdated.workbench;outdated.tasks[0].title='不该写入';
  assert.throws(()=>store.saveWorkspace(before.revision,outdated),error=>error.code==='workspace_update_required'&&error.status===409);assert.deepEqual(store.getWorkspace(),before);
});

test('platform proposals preview names, visibility and positions without writes, then apply atomically',()=>{
  const current=state(),before=structuredClone(current),preview=previewWorkspaceActions(current,actions());
  assert.deepEqual(current,before);assert.equal(preview.length,3);assert.ok(preview[1].fields.some(field=>field.label==='显示板块'&&field.after==='是'));
  assert.equal(preview.some(row=>row.fields.some(field=>field.label==='configuration')),false);
  const receipt=applyWorkspaceActions(current,'synthetic',actions(),options());assert.equal(receipt.items.length,3);assert.equal(current.workbench.modules[1].id,'tasks');assert.deepEqual(current.tasks,before.tasks);
  const bad=[moduleAction('inbox',{enabled:true}),moduleAction('ai',{enabled:false})],copy=structuredClone(current);assert.throws(()=>applyWorkspaceActions(current,'synthetic',bad,options()));assert.deepEqual(current,copy);
});

test('hiding preserves content and full configuration receipts undo all positions and onboarding',async()=>{
  const current=state(),original=structuredClone(current.workbench),receipt=applyWorkspaceActions(current,'synthetic',actions(),options());
  const result=await undoWorkspaceActions({state:current,uid:options().uid,save:async()=>{}},receipt,'synthetic');assert.equal(result.removed,3);assert.equal(result.retained,0);assert.deepEqual(current.workbench,original);
  const full=state();full.workbench=createWorkbench('full');const beforeTasks=structuredClone(full.tasks);applyWorkspaceActions(full,'hide',[moduleAction('tasks',{enabled:false})],options());assert.deepEqual(full.tasks,beforeTasks);assert.equal(full.workbench.modules.find(row=>row.id==='tasks').enabled,false);
});

test('undo keeps later manual platform changes and rolls back failed persistence',async()=>{
  const current=state(),receipt=applyWorkspaceActions(current,'synthetic',[moduleAction('tasks',{enabled:true,position:1})],options());
  configureWorkbench(current,{moduleId:'courses',moduleTitle:'后来改的资料名'});const afterManual=structuredClone(current.workbench);
  const retained=await undoWorkspaceActions({state:current,uid:options().uid,save:async()=>{}},receipt,'synthetic');assert.deepEqual(retained,{removed:0,retained:1});assert.deepEqual(current.workbench,afterManual);
  const fresh=state(),freshReceipt=applyWorkspaceActions(fresh,'synthetic',actions(),options()),beforeFailure=structuredClone(fresh);
  await assert.rejects(undoWorkspaceActions({state:fresh,uid:options().uid,save:async()=>{throw Error('synthetic save failure');}},freshReceipt,'synthetic'),/synthetic save/);assert.deepEqual(fresh,beforeFailure);
});

test('platform actions reject arbitrary fields, unknown modules, invalid positions and forged snapshots',()=>{
  for(const invalid of [moduleAction('tasks',{position:-1}),moduleAction('tasks',{position:10}),moduleAction('tasks',{position:1.5}),moduleAction('tasks',{url:'https://example.org'}),moduleAction('tasks',{enabled:'true'}),action('workbenchSettings','workbench',{title:''}),moduleAction('tasks',{})])assert.throws(()=>validateWorkspaceActions([invalid]));
  for(const invalid of [moduleAction('missing',{enabled:true}),moduleAction('ai',{enabled:false}),{...moduleAction('tasks',{enabled:true}),containerId:'other'}])assert.throws(()=>previewWorkspaceActions(state(),[invalid]));
  const current=state(),receipt=applyWorkspaceActions(current,'synthetic',actions(),options()),entry=JSON.parse(receipt.items[1].snapshot);entry.after.configuration.modules.reverse();
  current.aiRequests=[{id:'synthetic',text:'测试',status:'filed',files:[],receipt:{...receipt,items:[{...receipt.items[1],snapshot:JSON.stringify(entry)}]}}];assert.throws(()=>validateBackup(backup(current)));
});

test('platform actions compose with existing space, note and card operations',()=>{
  const current=state();current.canvas={cards:[{id:'ai',x:0,y:0,w:450,h:360,color:'#AE88FF'}],snap:true,initialized:true};
  const proposal=[moduleAction('courses',{enabled:true}),{entity:'space',operation:'create',ref:'project',data:{title:'我的研究',type:'project'}},{entity:'note',operation:'create',containerId:'$project',data:{title:'研究问题',content:'合成内容'}},{entity:'canvasCard',operation:'update',id:'ai',containerId:'home',data:{x:500,y:50}}];
  applyWorkspaceActions(current,'synthetic',proposal,options());assert.equal(current.spaces[0].notes[0].title,'研究问题');assert.equal(current.canvas.cards[0].x,500);assert.equal(current.tasks.length,1);
});

test('AI context exposes current platform settings and registered templates without assuming user identity',async()=>{
  const current=state(),before=JSON.stringify(current),overview=workspaceOverview(current);assert.equal(overview.workbench.modules.filter(module=>module.enabled).length,1);assert.equal(overview.catalog.length,10);assert.equal(overview.templates.length,6);
  const found=await runWorkspaceQuery(current,validateWorkspaceQueries([{kind:'get',entity:'workbenchModule',id:'tasks'}])[0]);assert.equal(found.record.enabled,false);assert.equal(found.id,'tasks');
  const search=await runWorkspaceQuery(current,validateWorkspaceQueries([{kind:'search',entity:'workbenchModule',text:'待办'}])[0]);assert.deepEqual(search.items.map(row=>row.id),['tasks']);
  const beforeFingerprint=workspaceFingerprint(current);configureWorkbench(current,{moduleId:'tasks',enabled:true});assert.notEqual(workspaceFingerprint(current),beforeFingerprint);
  const old=state();delete old.workbench;const oldBefore=JSON.stringify(old);assert.equal(workspaceOverview(old).workbench.modules.filter(module=>module.enabled).length,10);assert.equal(JSON.stringify(old),oldBefore);
  const prompt=buildPrompt({text:'帮我搭建研究工作台',sources:[],destinations:[],destinationId:'workspace',kind:'conversation'});assert.doesNotMatch(prompt.system,/用户是软件工程学生/);assert.match(prompt.system,/workbenchModule/);assert.match(prompt.system,/不能仅口头承诺已搭建/);assert.notEqual(JSON.stringify(current),before);
});

function serviceFixture(t){
  let service;const dataDir=temporary(t,'czb-platform-ai-',()=>service?.close());let current=state(),revision=1,calls=0;
  const store={getWorkspace:()=>({state:structuredClone(current),revision}),saveWorkspace:(base,value)=>{assert.equal(base,revision);validateWorkspace(value);current=structuredClone(value);return {revision:++revision};},fileInfo:()=>null,filePath:id=>join(dataDir,id)};
  service=createHermesService({dataDir,store,engineAvailable:()=>true,runModel:async input=>{calls++;const data=JSON.parse(input.user);assert.equal(data.workspaceOverview.workbench.modules.length,WORKBENCH_MODULES.length);if(calls===1)return {reply:'先核对当前模块。',proposal:null,queries:[{kind:'get',entity:'workbenchModule',id:'tasks'}]};return {reply:'请检查后点击确认执行。',proposal:{title:'搭建创作工作台',summary:'启用待办和资料，保留已有记录。',destinationId:'workspace',reason:'用户明确要求',warnings:[],actions:actions()}};}});
  async function call(method,path,body){let response;assert.equal(await service.handle({method},{},{url:new URL(path,'https://localhost'),readJson:async()=>body,json:(_res,status,value)=>{response={status,body:structuredClone(value)};}}),true);return response;}
  async function ready(){assert.equal((await call('PUT','/api/model/config',{provider:'deepseek',model:'deepseek-flash',apiKey:'offline-synthetic-no-model-call'})).status,200);const text='帮我搭建创作工作台，启用待办和资料。';current.aiRequests.push({id:'synthetic',text,targetId:'auto',files:[],status:'waiting_model',createdAt:NOW,updatedAt:NOW,conversation:{version:1,messages:[{id:'turn-1',role:'user',text,createdAt:NOW}]}});revision++;const start=await call('POST','/api/ai/jobs',{requestId:'synthetic',turnId:'turn-1',text,kind:'conversation'});assert.equal(start.status,202);for(let n=0;n<100;n++){const result=await call('GET',`/api/ai/jobs/${start.body.job.id}`);if(['succeeded','failed'].includes(result.body.job.status))return result.body.job;await new Promise(resolve=>setTimeout(resolve,3));}assert.fail('Synthetic platform job timed out');}
  return {ready,call,state:()=>current,change:fn=>{fn(current);revision++;},calls:()=>calls};
}

test('AI platform plan stays unapplied until explicit confirmation and repeat confirm is idempotent',async t=>{
  const fixture=serviceFixture(t),job=await fixture.ready();assert.equal(job.status,'succeeded',JSON.stringify(job.error));assert.equal(fixture.state().workbench.modules.filter(module=>module.enabled).length,1);assert.equal(fixture.state().workbench.title,'我的工作台');
  const first=await fixture.call('POST',`/api/ai/jobs/${job.id}/confirm`,{});assert.equal(first.status,200,JSON.stringify(first.body));assert.equal(fixture.state().workbench.modules.filter(module=>module.enabled).length,3);assert.equal(fixture.state().tasks.length,1);
  const second=await fixture.call('POST',`/api/ai/jobs/${job.id}/confirm`,{});assert.equal(second.status,200);assert.deepEqual(second.body.receipt,first.body.receipt);assert.equal(fixture.calls(),2);
});

test('manual platform changes after review invalidate confirmation without overwriting them',async t=>{
  const fixture=serviceFixture(t),job=await fixture.ready();assert.equal(job.status,'succeeded');fixture.change(current=>configureWorkbench(current,{title:'用户后来自己命名'}));
  const result=await fixture.call('POST',`/api/ai/jobs/${job.id}/confirm`,{});assert.equal(result.status,409);assert.equal(result.body.error,'STALE_PROPOSAL');assert.equal(fixture.state().workbench.title,'用户后来自己命名');assert.equal(fixture.state().workbench.modules.filter(module=>module.enabled).length,1);
});
