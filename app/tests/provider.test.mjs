// All transport responses are offline fixtures. These tests never call DeepSeek.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeepSeekRunner,ModelError,SUPPORTED_MODELS} from '../src/deepseek-provider.mjs';
const payload=(changes={})=>({model:'deepseek-flash',choices:[{finish_reason:'stop',message:{content:'{"actions":[],"message":"fixture"}'}}],usage:{prompt_tokens:12,completion_tokens:4,total_tokens:16},...changes});
const response=value=>new Response(JSON.stringify(value),{status:200});
const fixture=value=>createDeepSeekRunner({apiKey:'fixture-not-a-real-key',fetchImpl:async()=>response(value)});

test('official JSON protocol uses explicit config, fixed endpoint and no redirects',async()=>{
  let call;
  const run=createDeepSeekRunner({apiKey:' fixture-not-a-real-key ',model:'deepseek-v4-pro',fetchImpl:async(url,options)=>{call={url,options};return response(payload({model:'deepseek-v4-pro'}));}});
  const result=await run({system:'Return json.',user:'synthetic fixture'});
  assert.equal(call.url,'https://api.deepseek.com/chat/completions');assert.equal(call.options.redirect,'error');
  const body=JSON.parse(call.options.body);assert.deepEqual(body.response_format,{type:'json_object'});assert.deepEqual(body.thinking,{type:'disabled'});
  assert.equal(body.stream,false);assert.equal(body.model,'deepseek-v4-pro');assert.equal(result.usage.total_tokens,16);
  assert.equal(call.options.headers.Authorization,'Bearer fixture-not-a-real-key');assert.equal(result.model,'deepseek-v4-pro');
});
test('only new-project current supported models and explicit valid key are accepted',()=>{
  assert.deepEqual(SUPPORTED_MODELS,['deepseek-flash','deepseek-v4-pro']);
  for(const config of [{},{apiKey:''},{apiKey:'a\nb'},{apiKey:'fixture',model:'deepseek-chat'},{apiKey:'fixture',timeoutMs:0}])assert.throws(()=>createDeepSeekRunner(config),ModelError);
});
test('remote authentication, balance and throttling errors do not expose response contents',async()=>{
  for(const status of [401,402,429,500]){
    const run=createDeepSeekRunner({apiKey:'fixture-secret',fetchImpl:async()=>new Response('remote-secret',{status})});
    await assert.rejects(()=>run({system:'json',user:'fixture'}),error=>error.code==='model_http_'+status&&!error.message.includes('secret'));
  }
});
test('network errors are sanitized',async()=>{
  const run=createDeepSeekRunner({apiKey:'fixture-secret',fetchImpl:async()=>{throw new Error('credential fixture-secret and remote diagnostic');}});
  await assert.rejects(()=>run({system:'json',user:'fixture'}),error=>error.code==='model_network'&&!error.message.includes('fixture-secret'));
});
test('timeout bounds an injected transport even if it does not honor abort',async()=>{
  const run=createDeepSeekRunner({apiKey:'fixture',timeoutMs:5,fetchImpl:()=>new Promise(()=>{})});
  await assert.rejects(()=>run({system:'json',user:'fixture'}),error=>error.code==='model_timeout');
});
test('truncated, refused, empty and tool-call responses cannot become plans',async()=>{
  for(const [choice,code] of [
    [{finish_reason:'length',message:{content:'{}'}},'model_incomplete'],
    [{finish_reason:'content_filter',message:{content:''}},'model_refused'],
    [{finish_reason:'stop',message:{content:' '}},'model_empty'],
    [{finish_reason:'stop',message:{content:'{}',tool_calls:[{}]}},'model_unexpected_tool'],
  ])await assert.rejects(()=>fixture(payload({choices:[choice]}))({system:'json',user:'fixture'}),error=>error.code===code);
});
test('invalid transport JSON is rejected without echoing raw content',async()=>{
  const run=createDeepSeekRunner({apiKey:'fixture',fetchImpl:async()=>new Response('RAW_SECRET',{status:200})});
  await assert.rejects(()=>run({system:'json',user:'fixture'}),error=>error.code==='model_invalid_transport'&&!error.message.includes('RAW_SECRET'));
});
test('both streaming-body and text fallback are bounded',async()=>{
  for(const fetchImpl of [async()=>new Response('x'.repeat(1024*1024+1)),async()=>({ok:true,text:async()=>'x'.repeat(1024*1024+1)})]){
    const run=createDeepSeekRunner({apiKey:'fixture',fetchImpl});await assert.rejects(()=>run({system:'json',user:'fixture'}),error=>error.code==='model_response_limit');
  }
});
test('unknown usage stays unknown, invalid counters and arbitrary remote model names are discarded',async()=>{
  const result=await fixture(payload({model:'untrusted-secret',usage:{prompt_tokens:-1,completion_tokens:'4',total_tokens:1.5}}))({system:'json',user:'fixture'});
  assert.equal(result.usage,null);assert.equal(result.model,'deepseek-flash');
  const nested=await fixture(payload({usage:{prompt_tokens:2,completion_tokens_details:{reasoning_tokens:3}}}))({system:'json',user:'fixture'});
  assert.deepEqual(nested.usage,{prompt_tokens:2,reasoning_tokens:3});
});
