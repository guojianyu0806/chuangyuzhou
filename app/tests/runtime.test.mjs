import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,linkSync,symlinkSync} from 'node:fs';
import {resolve} from 'node:path';
import {PROJECT_ROOT,RUNTIME_ROOT,createRuntime,runtimePath,projectPath} from '../src/runtime.mjs';

test('runtime is confined to new project and ignores legacy environment',()=>{
  const old={DATA_DIR:process.env.DATA_DIR,FRONTEND_DIR:process.env.FRONTEND_DIR};
  process.env.DATA_DIR='E:\\AIC工作台\\.aic-runtime';process.env.FRONTEND_DIR='E:\\AIC工作台\\02_竞赛源码\\frontend';
  try{
    const runtime=createRuntime();
    assert.equal(runtime.dataDir,resolve(RUNTIME_ROOT,'data'));
    assert.equal(runtime.frontendDir,resolve(PROJECT_ROOT,'frontend'));
    assert.equal(runtime.cookieName,'cu_original_workbench_session');
    assert.equal(runtime.port,4391);
    assert.equal(runtime.origin,'http://127.0.0.1:4391');
    for(const path of [PROJECT_ROOT,resolve(PROJECT_ROOT,'..','.aic-runtime'),resolve(PROJECT_ROOT,'frontend')])assert.throws(()=>runtimePath(path));
    for(const port of [4173,4180,4280,4380.5,4400])assert.throws(()=>createRuntime({port}));
  }finally{for(const key of Object.keys(old)){if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}}
});

test('linked writable files and directory junctions are refused',()=>{
  mkdirSync(RUNTIME_ROOT,{recursive:true});const dir=mkdtempSync(resolve(RUNTIME_ROOT,'isolation-test-'));
  const original=resolve(dir,'original.txt'),linked=resolve(dir,'linked.txt');writeFileSync(original,'synthetic');
  linkSync(original,linked);assert.throws(()=>runtimePath(linked));
  const target=resolve(dir,'target'),junction=resolve(dir,'junction');mkdirSync(target);
  symlinkSync(target,junction,process.platform==='win32'?'junction':'dir');
  assert.throws(()=>projectPath(resolve(junction,'new-file.txt')));
});
