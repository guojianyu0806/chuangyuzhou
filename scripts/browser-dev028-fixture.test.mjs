// Offline contract checks. Never starts a listener and never reaches a provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import {FIXTURE,SEED,MAX_PROVIDER_RESPONSE_BYTES,createSyntheticState,readBoundedProviderResponse,createRecordedModelRunner,restrictFixtureConfig,modelOutputShape,correctionMetadata} from './browser-dev028-fixture.mjs';
import {validateWorkspace} from '../yuzhou/backend/store.mjs';
import {validateCustomBlocks} from '../yuzhou/frontend/src/custom-blocks-model.js';

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
