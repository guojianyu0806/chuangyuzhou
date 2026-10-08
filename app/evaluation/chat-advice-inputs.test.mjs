import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {buildChatAdviceInputs,adviceProviderInput} from './build-chat-advice-inputs.mjs';
import {loadPlatformDevelopment,platformMessage} from './run-platform.mjs';
import {buildPlannerContext,planWithAI} from '../src/ai-planner.mjs';
import {getCatalog} from '../src/domain.mjs';
import {createDeepSeekRunner} from '../src/deepseek-provider.mjs';
const fixed='2026-10-01T00:10:00.000Z';
const id=n=>'cu-platform-dev-'+String(n).padStart(3,'0');

test('advice generator defaults to 22 public development tasks and no outcomes',()=>{
  const packet=buildChatAdviceInputs({now:fixed});
  assert.equal(packet.entries.length,22);assert.equal(packet.modelCalled,false);assert.equal(packet.executedActions,0);
  assert.equal(packet.results,null);assert.equal(packet.participants,null);assert.equal(packet.cost,null);assert.equal(packet.holdout.included,0);
  assert.equal(packet.independentHumanReview,'pending');assert.equal(packet.entries.some(e=>e.track==='engineering_recovery'),false);
});
test('fixed clock produces reproducible packet and same full-planner context',()=>{
  const config={provider:'deepseek',model:'deepseek-v4-pro'},options={now:fixed,config,cases:[id(8)]};
  const a=buildChatAdviceInputs(options),b=buildChatAdviceInputs(options);assert.deepEqual(a,b);
  const data=loadPlatformDevelopment(),task=data.tasks.find(t=>t.id===id(8));
  const expected=buildPlannerContext({state:data.fixtures[task.initialFixture],workspaceId:task.workspaceId,selectedComponentId:task.selectedComponentId,message:platformMessage(task),now:new Date(fixed)});
  assert.deepEqual(JSON.parse(a.entries[0].user),expected);assert.equal(a.entries[0].clock.localDate,'2026-10-01');
  assert.equal(a.entries[0].user.includes('w_other'),false);assert.equal(a.config.model,config.model);
});
test('context contains source attachments but no gold or researcher phases',()=>{
  const packet=buildChatAdviceInputs({now:fixed,cases:[id(5),id(23),id(24)]});
  assert.ok(packet.entries[0].user.includes('chuang-universe-template'));
  for(const entry of packet.entries){assert.equal(entry.user.includes('"expected"'),false);assert.equal(entry.user.includes('stale_proposal_rejected'),false);assert.equal(entry.user.includes('后来手动补充'),false);}
  assert.equal(packet.entries[1].excludedFromOrdinaryHumanTiming,true);assert.equal(packet.entries[2].excludedFromOrdinaryHumanTiming,true);
});
test('public config excludes credentials without reading their values',()=>{
  let accessed=false;const config={provider:'deepseek',model:'deepseek-flash',get apiKey(){accessed=true;throw new Error('secret getter');}};
  assert.throws(()=>buildChatAdviceInputs({config,now:fixed}));assert.equal(accessed,false);
  assert.throws(()=>buildChatAdviceInputs({config:{provider:'other',model:'deepseek-flash'},now:fixed}));
  assert.throws(()=>buildChatAdviceInputs({config:{provider:'deepseek',model:'invalid'},now:fixed}));
});
test('only known development IDs and explicit timezone clock are accepted',()=>{
  for(const cases of [[],['holdout-001'],[id(1),id(1)]])assert.throws(()=>buildChatAdviceInputs({cases,now:fixed}));
  for(const now of ['2026-10-01','2026-10-01T12:00:00','not-a-date',new Date('invalid')])assert.throws(()=>buildChatAdviceInputs({now}));
});
test('provider input preserves hashes and gives advice only',()=>{
  const packet=buildChatAdviceInputs({now:fixed,cases:[id(1)]}),request=adviceProviderInput(packet,id(1));
  assert.deepEqual(Object.keys(request),['system','user']);assert.ok(request.system.includes('没有操作权'));assert.ok(request.system.includes('不要返回actions'));
  assert.throws(()=>adviceProviderInput(packet,id(2)));packet.entries[0].user+=' ';
  assert.throws(()=>adviceProviderInput(packet,id(1)));
});
test('B and C share the actual filtered action catalog and exclude manual backup restore',async()=>{
  const packet=buildChatAdviceInputs({now:fixed,cases:[id(1)]});
  const data=loadPlatformDevelopment(),task=data.tasks.find(t=>t.id===id(1));let fullSystem;
  await planWithAI({state:data.fixtures[task.initialFixture],workspaceId:task.workspaceId,
    selectedComponentId:task.selectedComponentId,message:platformMessage(task),provider:async({system})=>{
      fullSystem=system;return {text:JSON.stringify({protocolVersion:1,actions:[],steps:[],message:'离线目录协议核对',evidence:[]})};
    }});
  const catalog=system=>JSON.parse(system.split('\n').find(line=>line.startsWith('动作目录：')).slice('动作目录：'.length));
  const b=catalog(packet.systemPrompt),c=catalog(fullSystem);
  assert.deepEqual(b,c);assert.equal(packet.fairness.sameActionCatalog,true);
  assert.ok(getCatalog().actions.some(action=>action.op==='backup.import'&&action.manualOnly));
  assert.equal(b.actions.some(action=>action.manualOnly||action.op==='backup.import'),false);
  assert.ok(b.actions.some(action=>action.op==='template.import'));
});
test('packet parameter snapshot matches injected provider transport, with zero real network',async()=>{
  const packet=buildChatAdviceInputs({now:fixed,cases:[id(1)]});let captured;
  const run=createDeepSeekRunner({apiKey:'synthetic-fixture-only',model:packet.config.model,fetchImpl:async(_url,options)=>{
    captured=JSON.parse(options.body);return {ok:true,text:async()=>JSON.stringify({choices:[{finish_reason:'stop',message:{content:'{"message":"离线传输测试"}'}}]})};
  }});
  await run(adviceProviderInput(packet,id(1)));
  for(const key of ['model','stream','thinking','max_tokens','response_format'])assert.deepEqual(captured[key],packet.parameters[key]);
  assert.equal(Object.hasOwn(captured,'temperature'),false);assert.equal(packet.modelCalled,false);
});
test('CLI preview does not write and refuses live/config arguments',()=>{
  const path=fileURLToPath(new URL('./build-chat-advice-inputs.mjs',import.meta.url));
  const preview=spawnSync(process.execPath,[path,'--at',fixed,'--cases',id(1)],{encoding:'utf8'});
  assert.equal(preview.status,0);const result=JSON.parse(preview.stdout);assert.equal(result.fileWritten,false);assert.equal(result.modelCalled,false);assert.equal(result.entries.length,1);
  for(const flag of ['--live','--config-file','--key-file']){
    const rejected=spawnSync(process.execPath,[path,flag],{encoding:'utf8'});assert.equal(rejected.status,1);assert.equal(rejected.stdout,'');assert.ok(rejected.stderr.includes('不接收Key或调用模型'));
  }
});
