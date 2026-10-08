import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {loadPlatformDevelopment,runPlatformEvaluation,executePlatformPlan,summarizePlatformRecords,platformMessage,FROZEN_DATASET_SHA256} from './run-platform.mjs';
import {fixturePlatformPlan} from './platform-fixtures.mjs';
import {scorePlatformTask} from './platform-scoring.mjs';
import {ModelError} from '../src/deepseek-provider.mjs';

const dataset=loadPlatformDevelopment();
const caseId=n=>'cu-platform-dev-'+String(n).padStart(3,'0');
function prepare(n){const task=structuredClone(dataset.tasks.find(t=>t.id===caseId(n)));const before=structuredClone(dataset.fixtures[task.initialFixture]);const planned=fixturePlatformPlan(task,before);const executed=executePlatformPlan({task,before,planned});return {task,before,planned,...executed};}
const score=context=>scorePlatformTask(context);

test('platform defaults list only and never inspect supplied configuration',async()=>{
  let inspected=false;const config={get apiKey(){inspected=true;throw new Error('do not read');}};
  const result=await runPlatformEvaluation({config});
  assert.equal(result.mode,'list_only');assert.equal(result.tasks.length,24);assert.equal(result.configRead,false);assert.equal(result.modelCalled,false);assert.equal(inspected,false);
  assert.equal(result.datasetSha256,FROZEN_DATASET_SHA256);assert.equal(result.holdout.authored,0);assert.equal(result.holdout.taskContents,null);
});
test('24 fixtures pass only mechanical development checks with human review outstanding',async()=>{
  const {summary,records}=await runPlatformEvaluation({fixture:true,writeResults:false});
  assert.equal(summary.requested,24);assert.equal(summary.attempted,24);assert.equal(summary.errors,0);
  assert.equal(summary.ordinaryTasks.mechanicalPassed,20);assert.equal(summary.clarificationTasks.mechanicalPassed,2);
  assert.equal(summary.recovery.staleProtection.passed,1);assert.equal(summary.recovery.undoDependencyProtection.passed,1);
  assert.equal(summary.modelCalled,false);assert.equal(summary.aiPerformanceClaimAllowed,false);assert.equal(summary.cost,null);assert.equal(summary.humanTaskTime,null);
  assert.equal(summary.ordinaryTasks.overallSuccessCount,null);assert.equal(summary.holdout.attempted,0);
  for(const r of records){assert.equal(r.status,'pending_human');assert.equal(r.overallSuccess,null);assert.ok(r.pendingHuman>=1);assert.equal(r.measurement.executionMode,'offline_fixture');}
});
test('selection and live/fixture injection cannot silently relax evaluation mode',async()=>{
  await assert.rejects(()=>runPlatformEvaluation({cases:['no-such-case']}));
  await assert.rejects(()=>runPlatformEvaluation({cases:[caseId(1),caseId(1)]}));
  await assert.rejects(()=>runPlatformEvaluation({fixture:true,live:true}));
  await assert.rejects(()=>runPlatformEvaluation({live:true,fixtureProvider:async()=>{throw new Error('must not run');}}));
  await assert.rejects(()=>runPlatformEvaluation({live:true}));
  assert.throws(()=>fixturePlatformPlan({id:'unimplemented'},{}),{code:'fixture_unavailable'});
});
test('wrong expected date is a failed field, separate from protected extra writes',()=>{
  const context=prepare(14);context.after.records.find(r=>r.id==='task_a').values.f_due='2026-10-21';
  const result=score(context);assert.equal(result.mechanicalPassed,false);assert.equal(result.extraWriteCount,0);assert.equal(result.checks.find(c=>c.check==='field_equals').status,'fail');
});
test('preserve catches unrelated fields, deletions and unrequested new records',()=>{
  const context=prepare(14);
  context.after.records.find(r=>r.id==='task_b').values.f_due='2026-10-22';
  context.after.records=context.after.records.filter(r=>r.id!=='task_c');
  context.after.records.push({...structuredClone(context.before.records[0]),id:'extra-record'});
  const result=score(context);assert.equal(result.mechanicalPassed,false);assert.equal(result.extraWriteCount,3);
  assert.deepEqual(new Set(result.unexpectedChanges.map(c=>c.path)),new Set(['values.f_due','$remove','$add']));
});
test('new-field exception does not permit changing existing dates or adding unrelated fields',()=>{
  const context=prepare(11);assert.equal(score(context).mechanicalPassed,true);
  context.after.collections.find(c=>c.id==='c_tasks').fields.push({id:'unasked-field',name:'非请求内容',type:'text'});
  context.after.records.find(r=>r.id==='task_a').values.f_due='2026-10-30';
  const result=score(context);assert.equal(result.mechanicalPassed,false);assert.equal(result.extraWriteCount,2);
});
test('layout, same collection binding and stable option identity are checked',()=>{
  const layout=prepare(7);layout.after.components.find(c=>c.id==='cmp_resources').layout={x:0,y:0,w:4,h:4};
  assert.equal(score(layout).checks.find(c=>c.check==='layout_valid').status,'fail');
  const binding=prepare(3);binding.after.components.find(c=>c.type==='board').binding.collectionId='unknown';
  assert.equal(score(binding).checks.find(c=>c.check==='shared_binding').status,'fail');
  const option=prepare(13);option.after.collections.find(c=>c.id==='c_tasks').fields.find(f=>f.id==='f_status').options.find(o=>o.id==='o_todo').id='replaced-option';
  assert.equal(score(option).mechanicalPassed,false);
});
test('template equivalence verifies structure and remapped IDs beyond object counts',()=>{
  const context=prepare(5);assert.equal(score(context).mechanicalPassed,true);
  context.after.components[0].layout.y=30;
  assert.equal(score(context).checks.find(c=>c.check==='template_structure_equivalent').status,'fail');
  const reused=prepare(5);reused.after.components[0].id=reused.task.attachments[0].content.components[0].id;
  assert.equal(score(reused).checks.find(c=>c.check==='template_structure_equivalent').status,'fail');
});
test('sources require current hash and literal quote but meaning stays pending',()=>{
  const context=prepare(19),good=score(context);assert.equal(good.mechanicalPassed,true);assert.equal(good.checks.find(c=>c.check==='source_semantics').status,'pending');
  context.after.records.find(r=>r.values.f_title==='设计评审').sourceRefs[0].hash='wrong';
  assert.equal(score(context).checks.find(c=>c.check==='source_refs').status,'fail');
  const unquoted=prepare(20);unquoted.after.records.find(r=>r.values.f_title==='调研记录').sourceRefs[0].quote='文中没有的文字';
  assert.equal(score(unquoted).checks.find(c=>c.check==='source_refs').status,'fail');
});
test('clarification requires zero writes; content is never graded by keywords',()=>{
  const context=prepare(21);context.planned.clarification='这是一句不相关但非空的回复。';
  const pending=score(context);assert.equal(pending.mechanicalPassed,true);assert.equal(pending.checks.find(c=>c.check==='clarification').status,'pending');
  context.after.components[0].title='错误修改';assert.equal(score(context).mechanicalPassed,false);
  const empty=prepare(22);empty.planned.clarification='';assert.equal(score(empty).mechanicalPassed,false);
});
test('unknown declarative checks remain pending and cannot count as mechanical success',()=>{
  const context=prepare(14);context.task.expected.all.push({check:'future_semantic_magic'});
  const result=score(context);assert.equal(result.mechanicalPassed,false);assert.equal(result.checks.find(c=>c.check==='future_semantic_magic').status,'pending');
  assert.equal(result.scoringComplete,false);
});
test('023 and 024 execute actual domain rejections without counting them as ordinary failures',()=>{
  for(const [n,flag,code] of [[23,'staleRejected','stale_proposal'],[24,'undoDependencyRejected','undo_dependency_conflict']]){
    const context=prepare(n);assert.equal(context.engineering[flag],true);assert.equal(context.engineering.rejectionCode,code);assert.equal(score(context).mechanicalPassed,true);
    context.engineering={};assert.equal(score(context).mechanicalPassed,false);
  }
});
test('invalid fixture responses produce errors rather than fabricated states or passing checks',async()=>{
  const result=await runPlatformEvaluation({fixture:true,writeResults:false,cases:[caseId(1),caseId(2)],fixtureProvider:async()=>({text:'not JSON',model:'invalid-offline-fixture'})});
  assert.equal(result.summary.errors,2);assert.equal(result.summary.completedScoring,0);assert.equal(result.summary.ordinaryTasks.mechanicalPassed,0);
  assert.ok(result.records.every(r=>r.errorCode==='ai_invalid_json'&&r.checks===null&&r.status==='error'));
  assert.ok(result.records.every(r=>JSON.stringify(r.initialState)===JSON.stringify(r.finalState)));
});
test('timeouts and refusal metrics are explicit; unattempted IDs remain in denominator metadata',async()=>{
  const result=await runPlatformEvaluation({fixture:true,writeResults:false,cases:[caseId(1)],fixtureProvider:async()=>{throw new ModelError('model_timeout','SYNTHETIC ERROR DETAIL SHOULD NOT LOG',504);}});
  assert.equal(result.summary.timeouts,1);assert.equal(result.summary.failureRate,1);assert.equal(result.summary.modelCalled,false);
  assert.equal(JSON.stringify(result).includes('SYNTHETIC ERROR DETAIL'),false);
  const records=[{id:caseId(1),track:'task',errorCode:'model_refused',elapsedMs:10,checks:null,measurement:null,modelCalled:false,humanReviewStatus:'pending'}];
  const summary=summarizePlatformRecords(records,{requestedIds:[caseId(1),caseId(2)],mode:'offline_fixture',startedAt:'fixture'});
  assert.equal(summary.requested,2);assert.equal(summary.attempted,1);assert.deepEqual(summary.unattempted,[caseId(2)]);assert.equal(summary.refusals,1);assert.equal(summary.refusalRate,1);assert.equal(summary.cost,null);
  const unscorable=summarizePlatformRecords([{id:caseId(1),track:'task',status:'needs_review',mechanicalPassed:false,scoringComplete:false,errorCode:null,checks:[{status:'pending'}],elapsedMs:0}],{requestedIds:[caseId(1)],mode:'offline_fixture',startedAt:'fixture'});
  assert.equal(unscorable.failureRate,0);assert.equal(unscorable.completedScoring,0);assert.equal(unscorable.unscorable,1);assert.equal(unscorable.ordinaryTasks.unscorable,1);
});
test('model-facing task material excludes gold and researcher recovery phases',()=>{
  const input=platformMessage(dataset.tasks.find(t=>t.id===caseId(5)));assert.ok(input.includes('chuang-universe-template'));assert.equal(input.includes('template_structure_equivalent'),false);
  const recovery=platformMessage(dataset.tasks.find(t=>t.id===caseId(23)));assert.equal(recovery.includes('后来手动补充'),false);assert.equal(recovery.includes('reject_without_any_commit'),false);
});
test('CLI lists by default and rejects config outside runtime before any API call',()=>{
  const cli=fileURLToPath(new URL('./run-platform.mjs',import.meta.url));
  const listed=spawnSync(process.execPath,[cli],{encoding:'utf8'});assert.equal(listed.status,0);assert.equal(JSON.parse(listed.stdout).mode,'list_only');
  const publicFile=fileURLToPath(new URL('./platform-development-v1.json',import.meta.url));
  for(const args of [['--config-file',publicFile],['--live','--config-file',publicFile],['--live','--fixture','--config-file',publicFile]]){
    const rejected=spawnSync(process.execPath,[cli,...args],{encoding:'utf8'});assert.equal(rejected.status,1);assert.equal(rejected.stdout,'');assert.ok(rejected.stderr.includes('原始异常与配置内容未输出'));assert.equal(rejected.stderr.includes('authoring'),false);
  }
});
