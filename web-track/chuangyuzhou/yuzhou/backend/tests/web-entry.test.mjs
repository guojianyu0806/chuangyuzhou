import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {ROOT,parseConfiguration,cleanEnvironment} from '../../../tools/start.mjs';
import {COOKIE_NAME,DEFAULT_PORT,PROJECT_ROOT,RUNTIME_ROOT} from '../../runtime.mjs';

test('Web entry, runtime and public template agree on one isolated origin',()=>{
  const defaults=parseConfiguration();
  assert.deepEqual(parseConfiguration(readFileSync(join(ROOT,'.env.example'),'utf8')),defaults);
  assert.equal(defaults.CZB_YUZHOU_HOST,'127.0.0.1');
  assert.equal(defaults.CZB_YUZHOU_PORT,String(DEFAULT_PORT));
  assert.equal(DEFAULT_PORT,4396);
  assert.equal(COOKIE_NAME,'czb_web_yuzhou_session');
  assert.equal(PROJECT_ROOT,join(ROOT,'yuzhou'));
  assert.equal(RUNTIME_ROOT,join(PROJECT_ROOT,'.cu-runtime'));
});

test('Web entry refuses configuration that could reconnect to a prior origin or data path',()=>{
  for(const text of ['CZB_YUZHOU_PORT=4397','CZB_YUZHOU_PORT=4398','CZB_YUZHOU_PORT=4399','CZB_YUZHOU_HOST=0.0.0.0','CZB_YUZHOU_DATA_DIR=C:/old','CZB_YUZHOU_PORT=4396\nCZB_YUZHOU_PORT=4396'])assert.throws(()=>parseConfiguration(text));
});

test('Web entry forwards only local runtime necessities and its own settings',()=>{
  const temp=join(RUNTIME_ROOT,'synthetic-temp');
  const env=cleanEnvironment(parseConfiguration(),temp,{PATH:'synthetic-path',PORT:'4397',DATA_DIR:'C:/old',DEEPSEEK_API_KEY:'synthetic-secret',SETUP_TOKEN:'synthetic-token',CZB_YUZHOU_PORT:'4397'});
  assert.equal(env.PATH,'synthetic-path');
  assert.equal(env.CZB_YUZHOU_PORT,'4396');
  assert.equal(env.TEMP,temp);
  for(const key of ['PORT','DATA_DIR','DEEPSEEK_API_KEY','SETUP_TOKEN'])assert.equal(Object.hasOwn(env,key),false);
});
