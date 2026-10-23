import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {ROOT,parseConfiguration,resolveConfiguration,cleanEnvironment} from '../../../tools/start.mjs';
import {COOKIE_NAME,DEFAULT_PORT,PROJECT_ROOT,RUNTIME_ROOT} from '../../runtime.mjs';

test('Web entry, runtime and public template agree on one isolated origin',()=>{
  const defaults=parseConfiguration();
  assert.deepEqual(parseConfiguration(readFileSync(join(ROOT,'.env.example'),'utf8')),defaults);
  assert.equal(defaults.CZB_YUZHOU_HOST,'127.0.0.1');
  assert.equal(defaults.CZB_YUZHOU_PORT,String(DEFAULT_PORT));
  assert.equal(defaults.DEEPSEEK_API_KEY,'');
  assert.equal(defaults.DEEPSEEK_MODEL,'deepseek-flash');
  assert.equal(DEFAULT_PORT,4396);
  assert.equal(COOKIE_NAME,'czb_web_yuzhou_session');
  assert.equal(PROJECT_ROOT,join(ROOT,'yuzhou'));
  assert.equal(RUNTIME_ROOT,join(PROJECT_ROOT,'.cu-runtime'));
});

test('Web entry refuses configuration that could reconnect to a prior origin or data path',()=>{
  for(const text of ['CZB_YUZHOU_PORT=4397','CZB_YUZHOU_PORT=4398','CZB_YUZHOU_PORT=4399','CZB_YUZHOU_HOST=0.0.0.0','CZB_YUZHOU_DATA_DIR=C:/old','CZB_YUZHOU_PORT=4396\nCZB_YUZHOU_PORT=4396'])assert.throws(()=>parseConfiguration(text));
});

test('Web entry forwards only local runtime necessities and its explicitly resolved settings',()=>{
  const temp=join(RUNTIME_ROOT,'synthetic-temp');
  const env=cleanEnvironment(parseConfiguration(),temp,{PATH:'synthetic-path',PORT:'4397',DATA_DIR:'C:/old',DEEPSEEK_API_KEY:'synthetic-secret',SETUP_TOKEN:'synthetic-token',CZB_YUZHOU_PORT:'4397'});
  assert.equal(env.PATH,'synthetic-path');
  assert.equal(env.CZB_YUZHOU_PORT,'4396');
  assert.equal(env.TEMP,temp);
  assert.equal(env.DEEPSEEK_API_KEY,'');
  assert.equal(env.DEEPSEEK_MODEL,'deepseek-flash');
  for(const key of ['PORT','DATA_DIR','SETUP_TOKEN'])assert.equal(Object.hasOwn(env,key),false);
});

test('Web configuration accepts BOM, CRLF, comments and its two model settings',()=>{
  const config=parseConfiguration('\uFEFF# public template\r\n\r\nCZB_YUZHOU_HOST=127.0.0.1\r\nCZB_YUZHOU_PORT=4396\r\nDEEPSEEK_API_KEY=synthetic-file-key-123\r\nDEEPSEEK_MODEL=deepseek-v4-pro\r\n');
  assert.equal(config.DEEPSEEK_API_KEY,'synthetic-file-key-123');
  assert.equal(config.DEEPSEEK_MODEL,'deepseek-v4-pro');
});

test('Web configuration rejects duplicate, unknown, quoted and malformed settings without revealing values',()=>{
  const marker='synthetic-private-marker';
  for(const text of [
    `DEEPSEEK_API_KEY=${marker}\nDEEPSEEK_API_KEY=${marker}`,
    'DEEPSEEK_MODEL=deepseek-chat\nDEEPSEEK_MODEL=deepseek-chat',
    `OPENAI_API_KEY=${marker}`,
    `DEEPSEEK_BASE_URL=https://example.invalid/${marker}`,
    `CZB_YUZHOU_DATA_DIR=C:/${marker}`,
    `DEEPSEEK_API_KEY="${marker}"`,
    `DEEPSEEK_API_KEY='${marker}'`,
    `export DEEPSEEK_API_KEY=${marker}`,
    `DEEPSEEK_API_KEY =${marker}`,
    `DEEPSEEK_API_KEY=${marker} extra`,
    `DEEPSEEK_API_KEY=${marker}#comment`,
    `DEEPSEEK_API_KEY=${marker}\u0000`,
    `DEEPSEEK_API_KEY=${marker}\t`,
    `DEEPSEEK_API_KEY=${marker} `,
  ]) {
    assert.throws(()=>parseConfiguration(text),error=>{
      assert.equal(error.message.includes(marker),false);
      return true;
    },JSON.stringify(text));
  }
});

test('Web model configuration validates empty values, key bounds and supported models',()=>{
  for(const text of ['DEEPSEEK_API_KEY=short','DEEPSEEK_API_KEY='+('x'.repeat(501)),'DEEPSEEK_MODEL=unknown-model','DEEPSEEK_MODEL=unknown-model\nDEEPSEEK_API_KEY='])assert.throws(()=>parseConfiguration(text));
  for(const length of [12,500])assert.equal(parseConfiguration('DEEPSEEK_API_KEY='+('x'.repeat(length))).DEEPSEEK_API_KEY.length,length);
  assert.equal(parseConfiguration('DEEPSEEK_API_KEY=\nDEEPSEEK_MODEL=').DEEPSEEK_API_KEY,'');
});

test('Web terminal model settings override file settings without modifying either input',()=>{
  const file='DEEPSEEK_API_KEY=synthetic-file-key-123\nDEEPSEEK_MODEL=deepseek-chat';
  const source=Object.freeze({DEEPSEEK_API_KEY:'synthetic-terminal-key-123',DEEPSEEK_MODEL:'deepseek-v4-pro'});
  const result=resolveConfiguration(file,source);
  assert.equal(result.DEEPSEEK_API_KEY,source.DEEPSEEK_API_KEY);
  assert.equal(result.DEEPSEEK_MODEL,source.DEEPSEEK_MODEL);
  assert.equal(parseConfiguration(file).DEEPSEEK_API_KEY,'synthetic-file-key-123');
});

test('Web terminal overrides are independent and an explicit empty key clears the file key',()=>{
  const file='DEEPSEEK_API_KEY=synthetic-file-key-123\nDEEPSEEK_MODEL=deepseek-v4-pro';
  assert.equal(resolveConfiguration(file,{DEEPSEEK_API_KEY:''}).DEEPSEEK_API_KEY,'');
  assert.equal(resolveConfiguration(file,{DEEPSEEK_API_KEY:''}).DEEPSEEK_MODEL,'deepseek-v4-pro');
  assert.equal(resolveConfiguration(file,{DEEPSEEK_MODEL:'deepseek-reasoner'}).DEEPSEEK_API_KEY,'synthetic-file-key-123');
  assert.equal(resolveConfiguration(file,{DEEPSEEK_API_KEY:undefined}).DEEPSEEK_API_KEY,'synthetic-file-key-123');
  assert.equal(resolveConfiguration(file,{DEEPSEEK_MODEL:''}).DEEPSEEK_MODEL,'');
});

test('Web terminal values replace invalid file model values before validating the effective configuration',()=>{
  assert.equal(resolveConfiguration('DEEPSEEK_API_KEY=short',{DEEPSEEK_API_KEY:'synthetic-valid-terminal-key'}).DEEPSEEK_API_KEY,'synthetic-valid-terminal-key');
  assert.equal(resolveConfiguration('DEEPSEEK_API_KEY=short',{DEEPSEEK_API_KEY:''}).DEEPSEEK_API_KEY,'');
  assert.equal(resolveConfiguration('DEEPSEEK_MODEL=obsolete-model',{DEEPSEEK_MODEL:'deepseek-flash'}).DEEPSEEK_MODEL,'deepseek-flash');
  assert.throws(()=>parseConfiguration('DEEPSEEK_API_KEY=short'));
  assert.throws(()=>resolveConfiguration('CZB_YUZHOU_PORT=4397',{DEEPSEEK_API_KEY:'synthetic-valid-terminal-key'}));
});

test('Web resolution ignores inherited keys and unrelated parent settings',()=>{
  const source=Object.assign(Object.create({DEEPSEEK_API_KEY:'synthetic-inherited-key-123',DEEPSEEK_MODEL:'deepseek-chat'}),{CZB_YUZHOU_HOST:'0.0.0.0',CZB_YUZHOU_PORT:'4397',CZB_YUZHOU_DATA_DIR:'C:/old',OPENAI_API_KEY:'synthetic-unrelated-key-123',DEEPSEEK_BASE_URL:'https://example.invalid'});
  assert.deepEqual(resolveConfiguration('',source),parseConfiguration());
});

test('Web resolution validates explicit terminal values and keeps errors free of secrets',()=>{
  const marker='synthetic-invalid-secret';
  for(const source of [{DEEPSEEK_API_KEY:`${marker} secret`},{DEEPSEEK_API_KEY:12},{DEEPSEEK_MODEL:marker},{DEEPSEEK_MODEL:{}}])assert.throws(()=>resolveConfiguration('',source),error=>{
    assert.equal(error.message.includes(marker),false);
    return true;
  });
});

test('Web configuration treats dollar syntax as literal data and never substitutes parent variables',()=>{
  const literal='synthetic-${SYNTHETIC_PRIVATE_VALUE}';
  const config=resolveConfiguration(`DEEPSEEK_API_KEY=${literal}`,{SYNTHETIC_PRIVATE_VALUE:'must-not-be-expanded'});
  assert.equal(config.DEEPSEEK_API_KEY,literal);
  assert.throws(()=>parseConfiguration('CZB_YUZHOU_DATA_DIR=${SYNTHETIC_PRIVATE_VALUE}'));
  assert.throws(()=>parseConfiguration('DEEPSEEK_MODEL=${SYNTHETIC_PRIVATE_VALUE}'));
});

test('Web child environment carries the explicit model choice and only the OS allowlist',()=>{
  const temp=join(RUNTIME_ROOT,'synthetic-temp');
  const source={PATH:'synthetic-path',Path:'synthetic-windows-path',SystemRoot:'synthetic-systemroot',WINDIR:'synthetic-windir',COMSPEC:'synthetic-comspec',PATHEXT:'.EXE',TEMP:'C:/outside-temp',TMP:'C:/outside-temp',TMPDIR:'/outside-temp',HOME:'synthetic-home',NODE_OPTIONS:'--inspect',NODE_PATH:'C:/outside-modules',DEEPSEEK_API_KEY:'synthetic-parent-secret',DEEPSEEK_MODEL:'deepseek-chat',DEEPSEEK_BASE_URL:'https://example.invalid',CZB_YUZHOU_DATA_DIR:'C:/old',SETUP_TOKEN:'synthetic-setup-token'};
  const config=resolveConfiguration('DEEPSEEK_API_KEY=synthetic-file-key-123\nDEEPSEEK_MODEL=deepseek-v4-pro');
  const env=cleanEnvironment(config,temp,source);
  assert.deepEqual(env,{
    PATH:source.PATH,Path:source.Path,SystemRoot:source.SystemRoot,WINDIR:source.WINDIR,COMSPEC:source.COMSPEC,PATHEXT:source.PATHEXT,
    CZB_YUZHOU_HOST:'127.0.0.1',CZB_YUZHOU_PORT:'4396',DEEPSEEK_API_KEY:'synthetic-file-key-123',DEEPSEEK_MODEL:'deepseek-v4-pro',
    TEMP:temp,TMP:temp,TMPDIR:temp,PYTHONDONTWRITEBYTECODE:'1',
  });
});

test('Web child environment cannot borrow parent model credentials when config omits them',()=>{
  const env=cleanEnvironment({CZB_YUZHOU_HOST:'127.0.0.1',CZB_YUZHOU_PORT:'4396'},'synthetic-temp',{DEEPSEEK_API_KEY:'synthetic-parent-key-123',DEEPSEEK_MODEL:'deepseek-v4-pro'});
  assert.equal(Object.hasOwn(env,'DEEPSEEK_API_KEY'),false);
  assert.equal(Object.hasOwn(env,'DEEPSEEK_MODEL'),false);
  assert.throws(()=>cleanEnvironment({DEEPSEEK_API_KEY:'short'},'synthetic-temp',{}));
});
