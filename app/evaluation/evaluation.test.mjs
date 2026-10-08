// Offline file-boundary tests use newly-created fixture files only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync,symlinkSync,linkSync} from 'node:fs';
import {resolve} from 'node:path';
import {RUNTIME_ROOT,PROJECT_ROOT,runtimePath} from '../src/runtime.mjs';
import {readEvaluationConfig} from './config.mjs';
import {spawnSync} from 'node:child_process';
import {runDevelopmentEvaluation} from './run-development.mjs';
const base=runtimePath(resolve(RUNTIME_ROOT,'evaluation-tests'));mkdirSync(base,{recursive:true});
function directory(){return mkdtempSync(resolve(base,'fixture-'));}

test('live-evaluation config permits only explicit new-runtime regular files',()=>{
  const file=resolve(directory(),'fixture-config.json');
  writeFileSync(file,JSON.stringify({provider:'deepseek',model:'deepseek-flash',apiKey:'fixture-only-not-real'}),{flag:'wx'});
  assert.deepEqual(readEvaluationConfig(file),{provider:'deepseek',model:'deepseek-flash',apiKey:'fixture-only-not-real'});
  for(const outside of [resolve(PROJECT_ROOT,'src/nonexistent-config.json'),resolve(PROJECT_ROOT,'../.aic-runtime/data/ai/deepseek-config.json'),resolve(PROJECT_ROOT,'../02_竞赛源码/anything.json')])assert.throws(()=>readEvaluationConfig(outside),error=>error.code==='evaluation_config_invalid');
});
test('bad config and parser errors never include secret values or raw JSON',()=>{
  const path=resolve(directory(),'invalid.json');writeFileSync(path,'{"apiKey":"fixture-secret-fragment",',{flag:'wx'});
  assert.throws(()=>readEvaluationConfig(path),error=>error.code==='evaluation_config_invalid'&&!error.message.includes('fixture-secret-fragment')&&!error.message.includes('SyntaxError'));
});
test('linked config files are refused',()=>{
  const dir=directory(),source=resolve(dir,'source.json');writeFileSync(source,JSON.stringify({provider:'deepseek',model:'deepseek-flash',apiKey:'fixture-only'}),{flag:'wx'});
  const hard=resolve(dir,'hard.json');linkSync(source,hard);assert.throws(()=>readEvaluationConfig(hard));
  const symbolic=resolve(dir,'symbolic.json');
  try{symlinkSync(source,symbolic,'file');assert.throws(()=>readEvaluationConfig(symbolic));}catch(error){if(!['EPERM','EACCES'].includes(error.code))throw error;}
});
test('default evaluation ignores config-file without live and reports zero real model calls',()=>{
  const script=resolve(PROJECT_ROOT,'evaluation/run-development.mjs');
  const result=spawnSync(process.execPath,[script,'--config-file',resolve(RUNTIME_ROOT,'not-created-fixture.json')],{encoding:'utf8',windowsHide:true});
  assert.equal(result.status,0);const report=JSON.parse(result.stdout);assert.equal(report.modelCalled,false);assert.equal(report.mode,'validation_only');assert.equal(report.dataset.holdoutCases,0);
  const both=spawnSync(process.execPath,[script,'--fixture','--live'],{encoding:'utf8',windowsHide:true});assert.notEqual(both.status,0);
});
test('six offline cases exercise proposed and applied states without claiming AI performance',async()=>{
  const result=await runDevelopmentEvaluation({fixture:true,writeResults:false});
  assert.equal(result.summary.attempted,6);assert.equal(result.summary.mechanicalPassed,6);assert.equal(result.summary.modelCalled,false);assert.equal(result.summary.aiPerformanceClaimAllowed,false);
  assert.ok(result.records.every(row=>row.executionMode==='offline_fixture'&&row.semanticReview==='pending'&&row.cost===null));
});
