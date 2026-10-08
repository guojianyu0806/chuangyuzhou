import test from 'node:test';
import assert from 'node:assert/strict';
import {checkModelConnection} from '../src/model-check.mjs';
const config={model:'deepseek-flash',apiKey:'synthetic-model-check-key'};
test('connection check sends only a minimal fixed prompt and records actual returned usage',async()=>{
  let input;
  const check=await checkModelConnection({config,provider:async value=>{input=value;return {text:'{"ok":true}',usage:{prompt_tokens:12,completion_tokens:4,total_tokens:16}};}});
  assert.deepEqual(Object.keys(input),['system','user']);assert.ok(!JSON.stringify(input).includes(config.apiKey));
  assert.equal(check.status,'passed');assert.equal(check.measurement.executionMode,'offline_fixture');assert.equal(check.measurement.modelCalled,false);
  assert.equal(check.measurement.usage.total_tokens,16);assert.equal(check.measurement.cost,null);
});
test('connection checks do not accept arbitrary successful model text or expose it on failure',async()=>{
  await assert.rejects(()=>checkModelConnection({config,provider:async()=>({text:'invalid '+config.apiKey})}),error=>error.code==='model_check_format'&&!error.message.includes(config.apiKey));
  await assert.rejects(()=>checkModelConnection({config,provider:async()=>({text:'{"ok":true,"extra":1}'})}),error=>error.code==='model_check_format');
  await assert.rejects(()=>checkModelConnection({config,provider:async()=>{throw Error(config.apiKey);}}),error=>error.code==='model_check_failed'&&!error.message.includes(config.apiKey));
});
