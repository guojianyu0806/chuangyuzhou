// Offline contract checks. Never starts a listener and never reaches a provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync,unlinkSync,rmSync} from 'node:fs';
import {join,relative,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {FIXTURE,SEED,MAX_PROVIDER_RESPONSE_BYTES,createSyntheticState,readBoundedProviderResponse,createRecordedModelRunner,restrictFixtureConfig,modelOutputShape,correctionMetadata,
  parseFixtureInput,validateResumeDirectory,validateSyntheticIdentity,authenticateFixture} from './browser-dev028-fixture.mjs';
import {validateWorkspace} from '../yuzhou/backend/store.mjs';
import {validateCustomBlocks} from '../yuzhou/frontend/src/custom-blocks-model.js';
import {PROJECT_ROOT,RUNTIME_ROOT,assertRuntimePath} from '../yuzhou/runtime.mjs';

const key='synthetic-private-marker-for-offline-checks';
const input={system:'Unchanged complete synthetic system JSON prompt.',user:'Unchanged synthetic user text.',
  settings:{provider:'deepseek',model:'deepseek-v4-pro',apiKey:FIXTURE.placeholderKey}};
const envelope=()=>({model:'deepseek-v4-pro',choices:[{finish_reason:'stop',message:{content:'{"reply":"合成回复","proposal":null}'}}],
  usage:{prompt_tokens:20,completion_tokens:10,total_tokens:30,private_text:key}});

test('DEV-028 seed has only protected note, task and synthetic source on a blank workbench',()=>{
  const state=createSyntheticState('2026-10-15T00:00:00.000Z');
  validateWorkspace(state);
  validateCustomBlocks(state.customBlocks);
  assert.equal(state.profile.name,SEED.profileName);assert.equal(state.workbench.title,SEED.workbenchTitle);
  assert.deepEqual(state.workbench.modules.filter(item=>item.enabled).map(item=>item.id),['ai']);
  assert.equal(state.tasks.length,1);assert.equal(state.tasks[0].id,FIXTURE.protectedTaskId);
  assert.equal(state.tasks[0].title,SEED.protectedTaskTitle);assert.equal(state.tasks[0].done,false);
  assert.equal(state.captures.length,1);assert.equal(state.captures[0].id,FIXTURE.captureId);
  assert.equal(state.captures[0].text,SEED.captureText);assert.match(SEED.captureText,/不是真实活动、支出或官方要求/);
  assert.deepEqual(state.customBlocks.items.map(item=>item.kind),['note']);
  const protectedBlock=state.customBlocks.items[0];
  assert.equal(protectedBlock.id,'block:dev028-protected-block');assert.equal(protectedBlock.id,FIXTURE.protectedBlockId);
  assert.deepEqual(protectedBlock.config,{text:SEED.protectedBlockText});
  assert.deepEqual(protectedBlock.data,{syntheticProtectionBaseline:'DEV-028'});
  assert.equal(protectedBlock.archived,false);assert.equal(state.spaces.length,0);assert.equal(state.aiRequests.length,0);
  // A fixed timestamp reproduces the full protected record for independent hashing.
  const again=createSyntheticState('2026-10-15T00:00:00.000Z');assert.deepEqual(again,state);
  state.customBlocks.items[0].config.text='changed by this offline test';
  assert.equal(again.customBlocks.items[0].config.text,SEED.protectedBlockText);
});

test('production request body is unchanged, construction is offline, and report excludes secrets/content',async()=>{
  let calls=0;const snapshots=[];
  const runner=createRecordedModelRunner(key,{persist:report=>snapshots.push(report),fetchImpl:async(url,options)=>{
    calls++;assert.equal(url,'https://api.deepseek.com/chat/completions');assert.equal(options.headers.Authorization,`Bearer ${key}`);
    const body=JSON.parse(options.body);
    assert.deepEqual(body.messages,[{role:'system',content:input.system},{role:'user',content:input.user}]);
    assert.equal(body.max_tokens,8192);assert.deepEqual(body.thinking,{type:'disabled'});
    assert.deepEqual(body.response_format,{type:'json_object'});assert.equal(body.stream,false);
    return Response.json(envelope());
  }});
  assert.equal(calls,0);
  const result=await runner.runModel(input);assert.equal(result.ok,true);assert.equal(calls,1);
  await runner.close();
  const report=runner.summary();assert.equal(report.development,'DEV-028');assert.equal(report.requestCount,1);assert.equal(report.actualTokensReported,30);assert.equal(report.closed,true);
  const serialized=JSON.stringify(snapshots);
  for(const privateValue of [key,input.system,input.user,'合成回复','Authorization','private_text'])assert.equal(serialized.includes(privateValue),false);
  assert.deepEqual(await runner.runModel(input),{ok:false,code:'AI_INTERRUPTED'});assert.equal(calls,1);
});

test('declared and chunked oversized response bodies are cancelled at one MiB',async()=>{
  let cancelled=0;
  const declared=new Response(new ReadableStream({cancel(){cancelled++;}}),{headers:{'content-length':String(MAX_PROVIDER_RESPONSE_BYTES+1)}});
  assert.equal((await readBoundedProviderResponse(declared)).tooLarge,true);
  const chunked=new Response(new ReadableStream({start(stream){stream.enqueue(new Uint8Array(700000));stream.enqueue(new Uint8Array(400000));},cancel(){cancelled++;}}));
  assert.equal((await readBoundedProviderResponse(chunked)).tooLarge,true);assert.equal(cancelled,2);
  const runner=createRecordedModelRunner(key,{fetchImpl:async()=>new Response('ignored',{headers:{'content-length':String(MAX_PROVIDER_RESPONSE_BYTES+1)}})});
  assert.deepEqual(await runner.runModel(input),{ok:false,code:'MODEL_OUTPUT_TRUNCATED'});
  assert.equal(runner.summary().calls[0].responseLimitExceeded,true);await runner.close();
});

test('402 stays distinguishable in safe metadata and provider diagnostics are not retained',async()=>{
  const runner=createRecordedModelRunner(key,{fetchImpl:async()=>new Response('provider private body '+key,{status:402})});
  assert.deepEqual(await runner.runModel(input),{ok:false,code:'MODEL_RATE_LIMIT'});
  const report=runner.summary();assert.equal(report.calls[0].httpStatus,402);assert.equal(report.missingUsageCount,1);
  assert.equal(JSON.stringify(report).includes(key),false);await runner.close();
});

test('close aborts an active provider request and invalid fixture config never sends',async()=>{
  let started;const entered=new Promise(resolve=>started=resolve);let requestSignal;
  const runner=createRecordedModelRunner(key,{fetchImpl:async(_url,{signal})=>{
    requestSignal=signal;started();return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error(key)),{once:true}));
  }});
  assert.deepEqual(await runner.runModel({...input,settings:{...input.settings,apiKey:'wrong'}}),{ok:false,code:'MODEL_NOT_CONFIGURED'});
  assert.equal(runner.summary().requestCount,0);
  const pending=runner.runModel(input);await entered;await runner.close();
  assert.equal(requestSignal.aborted,true);assert.deepEqual(await pending,{ok:false,code:'AI_INTERRUPTED'});
  assert.equal(runner.summary().closed,true);
});

test('normal config API accepts only placeholder without forwarding an accidental real key',async()=>{
  let delegated=0,returned;
  const service=restrictFixtureConfig({async handle(_req,_res,ctx){delegated++;const body=await ctx.readJson();assert.equal(body.apiKey,FIXTURE.placeholderKey);return true;}});
  const context={url:new URL('/api/model/config',FIXTURE.origin),readJson:async()=>({provider:'deepseek',model:'deepseek-v4-pro',apiKey:key}),json:(_res,status,body)=>returned={status,body}};
  assert.equal(await service.handle({method:'PUT'},{},context),true);assert.equal(delegated,0);assert.equal(returned.status,400);assert.equal(JSON.stringify(returned).includes(key),false);
  await service.handle({method:'PUT'},{},{...context,readJson:async()=>({provider:'deepseek',model:'deepseek-v4-pro',apiKey:FIXTURE.placeholderKey})});assert.equal(delegated,1);
});

test('shape diagnostics retain bounded identifiers while excluding query/action/reply values',()=>{
  const privateValue='PRIVATE_RESPONSE_AND_QUERY_VALUE';
  const shape=modelOutputShape(JSON.stringify({reply:privateValue,queries:Array.from({length:7},()=>({kind:'search',entity:'capture',text:privateValue})),
    proposal:{title:privateValue,actions:Array.from({length:51},()=>({entity:'task',operation:'create',data:{title:privateValue,date:'2026-10-26'}}))}}));
  assert.equal(shape.queryCount,7);assert.equal(shape.queries.length,6);assert.equal(shape.actionCount,51);assert.equal(shape.actions.length,50);
  assert.deepEqual(shape.topLevelKeys,['reply','queries','proposal']);assert.deepEqual(shape.actions[0].dataFields,['title','date']);
  assert.equal(shape.queries[0].kind,'search');assert.equal(JSON.stringify(shape).includes(privateValue),false);
  assert.equal(JSON.stringify(shape).includes('2026-10-26'),false);
  const invalid=modelOutputShape(JSON.stringify({'中文字段':privateValue,queries:[{kind:'x'.repeat(65),entity:'sk-secret-marker'}]}));
  assert.equal(JSON.stringify(invalid).includes('中文字段'),false);assert.equal(JSON.stringify(invalid).includes('sk-secret-marker'),false);
});

test('correction diagnostics expose exact static whitelist messages but hash all other issue text',()=>{
  const known=correctionMetadata(JSON.stringify({formatCorrection:{code:'INVALID_PROPOSAL',issue:'查询包含不支持的字段。',previousOutput:key}}));
  assert.equal(known.correctiveIssue,'查询包含不支持的字段。');assert.equal(JSON.stringify(known).includes(key),false);
  const unknown=correctionMetadata(JSON.stringify({formatCorrection:{code:'INVALID_PROPOSAL',issue:'private '+key,previousOutput:key}}));
  assert.equal(unknown.correctiveIssue,'unlisted-static-or-private-message');assert.match(unknown.correctiveIssueHash,/^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(unknown).includes(key),false);
  const structured=correctionMetadata(JSON.stringify({formatCorrection:{code:'INVALID_PROPOSAL',issue:'bounded detail',queryIssues:[{code:'INVALID_STRING',index:1,kind:'search',field:'text',value:key}]}}));
  assert.deepEqual(structured.queryIssues,[{code:'INVALID_STRING',index:1,kind:'search',field:'text'}]);
  assert.equal(JSON.stringify(structured).includes(key),false);
});

test('stdin resume contract preserves plain keys and rejects unsupported fields without echoing secrets',()=>{
  assert.deepEqual(parseFixtureInput(key),{key});
  const resumeDataDir='yuzhou/.cu-runtime/dev028-browser-test';
  assert.deepEqual(parseFixtureInput(JSON.stringify({key,resumeDataDir})),{key,resumeDataDir});
  assert.deepEqual(parseFixtureInput(JSON.stringify({key})),{key});
  for(const input of ['{broken',JSON.stringify({key,port:4397}),JSON.stringify({key,resumeDataDir:''}),JSON.stringify({key,resumeDataDir:null}),JSON.stringify({key:'bad'}),JSON.stringify({key,resumeDataDir:'path\nextra'})]){
    assert.throws(()=>parseFixtureInput(input),error=>!error.message.includes(key)&&/Invalid/.test(error.message));
  }
});

test('resume path accepts only existing ordinary DEV-028 directories directly inside this project runtime',()=>{
  assertRuntimePath(RUNTIME_ROOT);mkdirSync(RUNTIME_ROOT,{recursive:true});
  const directory=assertRuntimePath(mkdtempSync(join(RUNTIME_ROOT,'dev028-browser-contract-')));
  const file=assertRuntimePath(join(RUNTIME_ROOT,`dev028-browser-file-${randomUUID()}`));
  try{
    writeFileSync(file,'synthetic non-database test file',{flag:'wx'});
    assert.equal(validateResumeDirectory(directory),directory);
    assert.equal(validateResumeDirectory(relative(resolve(PROJECT_ROOT,'..'),directory)),directory);
    for(const path of [RUNTIME_ROOT,join(RUNTIME_ROOT,'data'),join(RUNTIME_ROOT,'dev027-browser-other'),join(directory,'nested'),resolve(PROJECT_ROOT,'..','dev028-browser-outside'),file])assert.throws(()=>validateResumeDirectory(path));
  }finally{
    // Both absolute cleanup targets were created by this test inside the same runtime boundary.
    assertRuntimePath(file);unlinkSync(file);
    assert.equal(validateResumeDirectory(directory),directory);rmSync(directory,{recursive:true,force:true});
  }
});

test('resume authenticates synthetic identity through read-only normal APIs and never setup/seeds existing state',async()=>{
  const initial=createSyntheticState('2026-10-15T00:00:00.000Z');
  assert.equal(validateSyntheticIdentity(initial),true);
  let state=structuredClone(initial),calls=[];
  const fetchImpl=async(url,options)=>{
    const path=new URL(url).pathname;assert.equal(new URL(url).origin,`http://${FIXTURE.host}:${FIXTURE.port}`);
    assert.equal(options.redirect,'error');calls.push({path,method:options.method});
    if(path==='/api/auth/login'||path==='/api/auth/setup'){
      const body=JSON.parse(options.body);assert.equal(body.username,FIXTURE.username);assert.equal(body.password,FIXTURE.password);
      if(path==='/api/auth/login')assert.equal(Object.hasOwn(body,'setupToken'),false);
      return Response.json({authenticated:true,username:FIXTURE.username,csrfToken:'synthetic-csrf'},{status:path.endsWith('setup')?201:200,headers:{'set-cookie':'synthetic-only=session; HttpOnly'}});
    }
    assert.equal(options.headers.Cookie,'synthetic-only=session');assert.equal(options.headers['X-CSRF-Token'],'synthetic-csrf');
    if(path==='/api/workspace'&&options.method==='GET')return Response.json({revision:7,state});
    if(path==='/api/workspace'&&options.method==='PUT'){const body=JSON.parse(options.body);assert.equal(body.baseRevision,0);state=body.state;return Response.json({revision:1});}
    assert.equal(path,'/api/auth/logout');return Response.json({authenticated:false});
  };
  assert.deepEqual(await authenticateFixture({resumed:true,fetchImpl}),{resumed:true,workspaceRevision:7});
  assert.deepEqual(calls,[{path:'/api/auth/login',method:'POST'},{path:'/api/workspace',method:'GET'},{path:'/api/auth/logout',method:'POST'}]);
  assert.deepEqual(state,initial);
  for(const mutate of [copy=>copy.profile.name='foreign',copy=>copy.tasks=[],copy=>copy.captures=[],copy=>copy.customBlocks.items[0].data.syntheticProtectionBaseline='foreign']){
    state=structuredClone(initial);mutate(state);calls=[];
    await assert.rejects(authenticateFixture({resumed:true,fetchImpl}),/DEV-028 synthetic identity/);
    assert.equal(calls.at(-1).path,'/api/auth/logout');assert.equal(calls.some(call=>call.path.endsWith('setup')||call.method==='PUT'),false);
  }
  calls=[];await authenticateFixture({fetchImpl});
  assert.deepEqual(calls,[{path:'/api/auth/setup',method:'POST'},{path:'/api/workspace',method:'PUT'},{path:'/api/workspace',method:'GET'},{path:'/api/auth/logout',method:'POST'}]);
});
