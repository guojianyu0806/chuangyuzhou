import test from 'node:test';
import assert from 'node:assert/strict';
import {constants,copyFileSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {ROOT} from '../../../tools/start.mjs';
import {RUNTIME_ROOT,assertOrdinaryPath,assertOrdinaryTree,assertRuntimePath} from '../../runtime.mjs';

function operatingSystemEnvironment(){
  const result={};
  // Read only the launcher allowlist; never inherit model credentials or NODE_OPTIONS.
  for(const name of ['PATH','Path','SystemRoot','WINDIR','COMSPEC','PATHEXT'])if(process.env[name])result[name]=process.env[name];
  return result;
}

function publicSourceFixture(t){
  const parent=assertRuntimePath(join(RUNTIME_ROOT,'tests-temp'));
  mkdirSync(parent,{recursive:true});
  const fixture=assertRuntimePath(mkdtempSync(join(parent,'model-environment-cli-')));
  t.after(()=>{
    const target=assertRuntimePath(fixture);
    assertOrdinaryTree(target,RUNTIME_ROOT);
    rmSync(target,{recursive:true,force:true});
  });
  const manifestPath=assertOrdinaryPath(join(ROOT,'SOURCE-MANIFEST.json'),ROOT);
  const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
  assert.ok(Array.isArray(manifest.files)&&manifest.files.length>0);
  for(const row of manifest.files){
    assert.equal(typeof row.path,'string');
    // A public source manifest must not cause this fixture to read runtime files or .env.
    assert.equal(row.path.split(/[\\/]/).some(part=>part==='.env'||part==='.cu-runtime'),false);
    const source=assertOrdinaryPath(resolve(ROOT,row.path),ROOT);
    const target=assertOrdinaryPath(resolve(fixture,row.path),fixture);
    mkdirSync(dirname(target),{recursive:true});
    copyFileSync(source,target,constants.COPYFILE_EXCL);
  }
  copyFileSync(manifestPath,assertOrdinaryPath(join(fixture,'SOURCE-MANIFEST.json'),fixture),constants.COPYFILE_EXCL);
  return fixture;
}

function check(fixture,env){
  const result=spawnSync(process.execPath,[join(fixture,'tools/start.mjs'),'--check'],{
    cwd:fixture,env,encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:1024*1024,
  });
  assert.equal(result.error,undefined);
  assert.equal(result.signal,null);
  return result;
}

test('Web CLI checks isolated synthetic model configuration and never prints either key',t=>{
  const fixture=publicSourceFixture(t);
  const fileKey='synthetic-cli-file-key-123';
  const terminalKey='synthetic-cli-terminal-key-123';
  const environmentFile=assertOrdinaryPath(join(fixture,'.env'),fixture);
  writeFileSync(environmentFile,`DEEPSEEK_API_KEY=${fileKey}\nDEEPSEEK_MODEL=deepseek-v4-pro\n`,{flag:'wx'});
  const result=check(fixture,{...operatingSystemEnvironment(),DEEPSEEK_API_KEY:terminalKey});
  assert.equal(result.status,0);
  const record=JSON.parse(result.stdout.trim());
  assert.equal(record.check,'passed');
  assert.equal(record.origin,'http://127.0.0.1:4396');
  assert.equal(record.environmentModelConfigured,true);
  assert.equal(record.modelRequest,false);
  for(const output of [result.stdout,result.stderr])for(const key of [fileKey,terminalKey])assert.equal(output.includes(key),false);

  const invalidKey='synthetic-cli-invalid-private-key invalid';
  writeFileSync(environmentFile,`DEEPSEEK_API_KEY=${invalidKey}\nDEEPSEEK_MODEL=deepseek-v4-pro\n`);
  const invalid=check(fixture,operatingSystemEnvironment());
  assert.equal(invalid.status,1);
  assert.ok(invalid.stderr.trim());
  for(const output of [invalid.stdout,invalid.stderr])for(const key of [fileKey,terminalKey,invalidKey,'synthetic-cli-invalid-private-key'])assert.equal(output.includes(key),false);
});
