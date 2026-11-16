import test from 'node:test';
import assert from 'node:assert/strict';
import {MODEL_ENVIRONMENT_KEYS,SUPPORTED_DEEPSEEK_MODELS,readModelEnvironment} from '../model-environment.mjs';

const syntheticKey='synthetic-model-key-123';

test('Environment model settings are opt-in and a model alone never borrows another key',()=>{
  for(const env of [{},{DEEPSEEK_API_KEY:''},{DEEPSEEK_API_KEY:undefined},{DEEPSEEK_MODEL:'deepseek-v4-pro'},{DEEPSEEK_API_KEY:'',DEEPSEEK_MODEL:'deepseek-chat'},{apiKey:syntheticKey,model:'deepseek-chat'}])assert.equal(readModelEnvironment(env),null);
});

test('Environment key selects the official DeepSeek endpoint and default model',()=>{
  const env=Object.freeze({DEEPSEEK_API_KEY:syntheticKey,DEEPSEEK_BASE_URL:'https://example.invalid',OPENAI_BASE_URL:'https://example.invalid',DEEPSEEK_MODEL:''});
  const result=readModelEnvironment(env);
  assert.deepEqual(result,{provider:'deepseek',model:'deepseek-flash',apiKey:syntheticKey,baseUrl:'https://api.deepseek.com'});
  assert.equal(Object.isFrozen(result),true);
  assert.equal(readModelEnvironment({DEEPSEEK_API_KEY:syntheticKey}).model,'deepseek-flash');
});

test('Environment model allowlist supports each documented model and remains immutable',()=>{
  assert.deepEqual(MODEL_ENVIRONMENT_KEYS,['DEEPSEEK_API_KEY','DEEPSEEK_MODEL']);
  assert.deepEqual(SUPPORTED_DEEPSEEK_MODELS,['deepseek-flash','deepseek-v4-pro','deepseek-chat','deepseek-reasoner']);
  assert.equal(Object.isFrozen(MODEL_ENVIRONMENT_KEYS),true);
  assert.equal(Object.isFrozen(SUPPORTED_DEEPSEEK_MODELS),true);
  for(const model of SUPPORTED_DEEPSEEK_MODELS)assert.equal(readModelEnvironment({DEEPSEEK_API_KEY:syntheticKey,DEEPSEEK_MODEL:model}).model,model);
});

test('Environment key enforces both length boundaries and printable ASCII without whitespace',()=>{
  for(const length of [12,500])assert.equal(readModelEnvironment({DEEPSEEK_API_KEY:'x'.repeat(length)}).apiKey.length,length);
  for(const apiKey of ['x'.repeat(11),'x'.repeat(501),`${syntheticKey} `,` ${syntheticKey}`,`${syntheticKey}\t`,`${syntheticKey}\n`,`${syntheticKey}\r`,`${syntheticKey}\u0000`,`${syntheticKey}\u007f`,`${syntheticKey}\u00a0`,`${syntheticKey}中文`,null,123,true,{},[]])assert.throws(()=>readModelEnvironment({DEEPSEEK_API_KEY:apiKey}),/DEEPSEEK_API_KEY/);
});

test('Environment model is validated even without a key and errors omit supplied values',()=>{
  const marker='synthetic-private-model-marker';
  for(const model of [marker,'DEEPSEEK-V4-PRO',' deepseek-chat','deepseek-chat ','deepseek-chat\n',null,12,true,{},[]])for(const apiKey of ['',syntheticKey])assert.throws(()=>readModelEnvironment({DEEPSEEK_API_KEY:apiKey,DEEPSEEK_MODEL:model}),error=>{
    assert.match(error.message,/DEEPSEEK_MODEL/);
    assert.equal(error.message.includes(marker),false);
    assert.equal(error.message.includes(syntheticKey),false);
    return true;
  });
});

test('Environment key validation errors cannot reveal malformed key material',()=>{
  const marker='synthetic-invalid-key-marker';
  for(const apiKey of [`${marker} `,`${marker}\n`,`${marker}\u0000`,marker.repeat(30)])assert.throws(()=>readModelEnvironment({DEEPSEEK_API_KEY:apiKey}),error=>{
    assert.match(error.message,/DEEPSEEK_API_KEY/);
    assert.equal(error.message.includes(marker),false);
    return true;
  });
});
