// Independent 24-task DEVELOPMENT runner. The original six-task runner is unchanged.
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {planWithAI,PROMPT_VERSION} from '../src/ai-planner.mjs';
import {propose,applyProposal,undoReceipt} from '../src/domain.mjs';
import {PROJECT_ROOT,RUNTIME_ROOT,runtimePath} from '../src/runtime.mjs';
import {validatePlatformDevelopment} from './build-platform-development-v1.mjs';
import {readEvaluationConfig} from './config.mjs';
import {fixturePlatformPlan} from './platform-fixtures.mjs';
import {scorePlatformTask} from './platform-scoring.mjs';

export const PLATFORM_RUNNER_VERSION='cu-platform-runner-1.0.0';
export const FROZEN_DATASET_SHA256='a46ba42e22ac999820275ae0661e2a3ca260c0f93d6eb1a464c370b6a8e9e0e4';
const sha=value=>createHash('sha256').update(value).digest('hex');
const safeCode=error=>/^[a-z][a-z0-9_]{0,80}$/.test(error?.code||'')?error.code:'platform_evaluation_failed';
const stopCodes=new Set(['model_http_401','model_http_402','model_http_429','model_timeout','model_network']);
const ratio=(n,d)=>d?n/d:null;
const idRequest=()=>`platform-evaluation-${randomUUID()}`;

export function loadPlatformDevelopment(){
  const raw=readFileSync(new URL('./platform-development-v1.json',import.meta.url));
  if(sha(raw)!==FROZEN_DATASET_SHA256)throw new Error('冻结的开发题文件校验失败。');
  const data=JSON.parse(raw);validatePlatformDevelopment(data);return data;
}
export function platformMessage(task){
  // Only user-visible source attachments enter the model input. No gold fields,
  // expected constraints, fixture ID or researcher recovery phases are sent.
  return task.message+(task.attachments.length?'\n用户附带的结构模板（仅作为导入资料）：\n'+JSON.stringify(task.attachments):'');
}
function proposalFor(state,task,actions){
  const creates=['workspace.create','template.import'].includes(actions[0]?.op);
  return propose(state,{...(!creates&&task.workspaceId?{workspaceId:task.workspaceId}:{}),requestId:idRequest(),actions});
}
export function executePlatformPlan({task,before,planned}){
  let after=structuredClone(before);const engineering={};let proposal=null,receipt=null;
  if(planned.actions.length)proposal=proposalFor(after,task,planned.actions);
  if(task.expected.mode==='reject_stale'){
    if(!proposal)return {after,engineering:{staleRejected:false},proposal,receipt};
    const manual=task.phases.find(p=>p.after==='proposal_before_confirmation')?.manualActions;
    if(!manual?.length)throw new Error('恢复题缺少人工阶段定义。');
    after=applyProposal(after,proposalFor(after,task,manual)).state;
    const previous=JSON.stringify(after);
    try{after=applyProposal(after,proposal).state;engineering.staleRejected=false;}
    catch(error){engineering.staleRejected=error.code==='stale_proposal'&&JSON.stringify(after)===previous;engineering.rejectionCode=safeCode(error);if(error.code!=='stale_proposal')throw error;}
    return {after,engineering,proposal,receipt};
  }
  if(proposal){const applied=applyProposal(after,proposal);after=applied.state;receipt=applied.receipt;}
  if(task.expected.mode==='reject_undo_dependency'){
    if(!receipt)return {after,engineering:{undoDependencyRejected:false},proposal,receipt};
    const parameters=task.phases.find(p=>p.operation==='add_component_bound_to_new_collection')?.parameters;
    const matches=after.collections.filter(c=>c.name===parameters?.collectionSelector?.name&&!before.collections.some(old=>old.id===c.id));
    if(matches.length!==1){engineering.undoDependencyRejected=false;return {after,engineering,proposal,receipt};}
    const manual=[{op:'component.create',type:parameters.type,title:parameters.title,binding:{collectionId:matches[0].id}}];
    after=applyProposal(after,proposalFor(after,task,manual)).state;
    const previous=JSON.stringify(after);
    try{after=undoReceipt(after,receipt).state;engineering.undoDependencyRejected=false;}
    catch(error){engineering.undoDependencyRejected=error.code==='undo_dependency_conflict'&&JSON.stringify(after)===previous;engineering.rejectionCode=safeCode(error);if(error.code!=='undo_dependency_conflict')throw error;}
  }
  return {after,engineering,proposal,receipt};
}
function groupSummary(records){
  const attempted=records.length,mechanicalPassed=records.filter(r=>r.mechanicalPassed===true).length;
  return {attempted,mechanicalPassed,mechanicalPassRate:ratio(mechanicalPassed,attempted),errors:records.filter(r=>r.errorCode).length,
    constraintFailures:records.filter(r=>r.status==='constraint_failed').length,unscorable:records.filter(r=>r.status==='needs_review').length,pendingHuman:records.filter(r=>r.humanReviewStatus==='pending').length,
    protectedExtraWriteCount:records.reduce((sum,r)=>sum+(r.extraWriteCount||0),0),protectedExtraWriteTasks:records.filter(r=>r.extraWriteCount>0).length,
    overallSuccessCount:null,overallSuccessRate:null};
}
export function summarizePlatformRecords(records,{requestedIds,mode,startedAt}={}){
  const attemptedIds=new Set(records.map(r=>r.id)),attempted=records.length;
  const usageKeys=['prompt_tokens','completion_tokens','total_tokens','prompt_cache_hit_tokens','prompt_cache_miss_tokens'];
  const measured=records.filter(r=>r.measurement?.usage);
  const usage=Object.fromEntries(usageKeys.map(key=>{const values=measured.map(r=>r.measurement.usage[key]).filter(Number.isFinite);return [key,values.length?values.reduce((a,b)=>a+b,0):null];}));
  const recovered=records.filter(r=>r.track==='engineering_recovery');
  const samples=records.map(r=>r.elapsedMs).filter(Number.isFinite).sort((a,b)=>a-b);
  return {runnerVersion:PLATFORM_RUNNER_VERSION,datasetId:'cu-platform-development-v1',datasetSha256:FROZEN_DATASET_SHA256,startedAt,executionMode:mode,
    modelCalled:records.some(r=>r.modelCalled),requested:requestedIds.length,attempted,unattempted:requestedIds.filter(id=>!attemptedIds.has(id)),
    completedScoring:records.filter(r=>r.checks!==null&&r.scoringComplete===true).length,unscorable:records.filter(r=>r.status==='needs_review').length,errors:records.filter(r=>r.errorCode).length,
    failureRate:ratio(records.filter(r=>r.errorCode||r.status==='constraint_failed').length,attempted),
    timeouts:records.filter(r=>r.errorCode==='model_timeout').length,timeoutRate:ratio(records.filter(r=>r.errorCode==='model_timeout').length,attempted),
    refusals:records.filter(r=>r.errorCode==='model_refused').length,refusalRate:ratio(records.filter(r=>r.errorCode==='model_refused').length,attempted),
    missingFixtures:records.filter(r=>r.errorCode==='fixture_unavailable').length,
    ordinaryTasks:groupSummary(records.filter(r=>r.track==='task')),clarificationTasks:groupSummary(records.filter(r=>r.track==='clarification')),
    recovery:{attempted:recovered.length,staleProtection:{attempted:recovered.filter(r=>r.expectedMode==='reject_stale').length,passed:recovered.filter(r=>r.expectedMode==='reject_stale'&&r.mechanicalPassed).length},
      undoDependencyProtection:{attempted:recovered.filter(r=>r.expectedMode==='reject_undo_dependency').length,passed:recovered.filter(r=>r.expectedMode==='reject_undo_dependency'&&r.mechanicalPassed).length}},
    elapsedMs:{total:samples.reduce((a,b)=>a+b,0),median:samples.length?(samples[Math.floor((samples.length-1)/2)]+samples[Math.floor(samples.length/2)])/2:null},
    usage:{recordsWithUsage:measured.length,totals:usage},cost:null,modelVersions:[...new Set(records.map(r=>r.measurement?.model).filter(Boolean))],promptVersion:PROMPT_VERSION,
    independentHumanReview:'pending',semanticReview:'pending',humanTaskTime:null,aiPerformanceClaimAllowed:false,
    holdout:{planned:16,authored:0,attempted:0,status:'awaiting_independent_author'},
    note:mode==='offline_fixture'?'脚本预设回复仅验证工程回放，不能解释为AI准确率或用户效率。':'开发题的模型输出及机械检查；独立标准答案、语义和真人任务耗时仍待复核。',
    metricScope:'额外写入仅统计 expected.preserve 声明保护范围；未声明的目标语义、来源含义和完整任务成功不自动判定。'};
}
function csv(value){if(value===null||value===undefined)return '';const text=String(value);return /[",\r\n]/.test(text)?'"'+text.replaceAll('"','""')+'"':text;}
function metricsCSV(records){
  const fields=['id','track','executionMode','status','mechanicalPassed','errorCode','elapsedMs','extraWriteCount','pendingHuman','humanReviewStatus','modelCalled','model','promptVersion','promptTokens','completionTokens','cost'];
  return fields.join(',')+'\n'+records.map(r=>{const values={...r,model:r.measurement?.model,promptVersion:r.measurement?.promptVersion,promptTokens:r.measurement?.usage?.prompt_tokens,completionTokens:r.measurement?.usage?.completion_tokens};return fields.map(k=>csv(values[k])).join(',');}).join('\n')+'\n';
}
export async function runPlatformEvaluation({config,fixture=false,live=false,cases,writeResults=true,fixtureProvider}={}){
  if(fixture&&live)throw new Error('fixture 与 live 互斥。');
  if(fixtureProvider!==undefined&&(!fixture||typeof fixtureProvider!=='function'))throw new Error('注入回复只能用于离线工程回放。');
  const dataset=loadPlatformDevelopment(),selectedIds=cases||dataset.tasks.map(t=>t.id);
  if(!Array.isArray(selectedIds)||!selectedIds.length||new Set(selectedIds).size!==selectedIds.length||selectedIds.some(id=>!dataset.tasks.some(t=>t.id===id)))throw new Error('开发题编号无效。');
  const tasks=selectedIds.map(id=>dataset.tasks.find(t=>t.id===id));
  if(!fixture&&!live)return {mode:'list_only',modelCalled:false,configRead:false,runnerVersion:PLATFORM_RUNNER_VERSION,datasetSha256:FROZEN_DATASET_SHA256,independentHumanReview:'pending',holdout:dataset.holdout,
    tasks:tasks.map(({id,category,track,message})=>({id,category,track,message}))};
  if(live&&!config?.apiKey)throw new Error('真实测评需要显式提供创宇宙专用配置。');
  const mode=fixture?'offline_fixture':'live',startedAt=new Date().toISOString(),records=[];
  for(const task of tasks){
    const before=structuredClone(dataset.fixtures[task.initialFixture]),start=performance.now();
    let executionStarted=false,executionCompleted=false;
    const record={id:task.id,category:task.category,track:task.track,expectedMode:task.expected.mode,executionMode:mode,startedAt:new Date().toISOString(),
      input:platformMessage(task),initialState:before,finalState:before,planned:null,measurement:null,modelCalled:false,errorCode:null,status:'not_completed',
      mechanicalPassed:null,scoringComplete:false,checks:null,extraWriteCount:null,pendingHuman:null,unexpectedChanges:[],engineering:{},humanReviewStatus:'pending',overallSuccess:null,cost:null};
    try{
      const scripted=fixture?(fixtureProvider?null:fixturePlatformPlan(task,before)):null;
      const provider=fixture?async input=>fixtureProvider?fixtureProvider({task:structuredClone(task),before:structuredClone(before),...input}):({text:JSON.stringify(scripted),model:'offline-fixture-not-ai',usage:null}):undefined;
      record.planned=await planWithAI({state:before,workspaceId:task.workspaceId,message:record.input,selectedComponentId:task.selectedComponentId,config,...(provider?{provider}:{})});
      record.measurement=record.planned.measurement;
      executionStarted=true;
      const executed=executePlatformPlan({task,before,planned:record.planned});executionCompleted=true;record.finalState=executed.after;record.engineering=executed.engineering;
      const score=scorePlatformTask({task,before,after:executed.after,planned:record.planned,engineering:executed.engineering});
      Object.assign(record,score);
      // Gold constraints themselves have not yet had independent human review.
      // A mechanically passing row cannot be relabelled overall success here.
      record.pendingHuman=score.pendingHuman+1;
      record.checks.push({check:'independent_gold_review',status:'pending',detail:'合成开发题与预期约束尚需未调优人员复核。'});
      const provenFailure=score.checks.some(check=>check.status==='fail')||score.extraWriteCount>0;
      record.status=provenFailure?'constraint_failed':score.scoringComplete===false?'needs_review':'pending_human';
      if(provenFailure)record.overallSuccess=false;
    }catch(error){record.errorCode=safeCode(error);record.measurement=error.measurement||record.measurement;record.status=record.errorCode==='fixture_unavailable'?'missing_fixture':'error';record.overallSuccess=false;if(executionStarted&&!executionCompleted)record.finalState=null;}
    record.elapsedMs=Math.round(performance.now()-start);record.modelCalled=record.measurement?.modelCalled===true;records.push(record);
    // Aborted batches retain requested/unattempted denominators. No retries spend
    // additional tokens after account or transport failure.
    if(live&&stopCodes.has(record.errorCode))break;
  }
  const summary=summarizePlatformRecords(records,{requestedIds:selectedIds,mode,startedAt});
  summary.codeHashes=Object.fromEntries(['src/ai-planner.mjs','src/domain.mjs','src/domain-catalog.mjs','src/deepseek-provider.mjs','evaluation/run-platform.mjs','evaluation/platform-scoring.mjs','evaluation/platform-fixtures.mjs','evaluation/config.mjs'].map(path=>[path,sha(readFileSync(resolve(PROJECT_ROOT,path)))]));
  if(!writeResults)return {summary,records};
  const output=runtimePath(resolve(RUNTIME_ROOT,'evaluation','platform-'+startedAt.replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8)));mkdirSync(output,{recursive:true});
  for(const [name,content] of [['results.jsonl',records.map(r=>JSON.stringify(r)).join('\n')+'\n'],['summary.json',JSON.stringify(summary,null,2)+'\n'],['metrics.csv',metricsCSV(records)]])writeFileSync(runtimePath(resolve(output,name)),content,{flag:'wx'});
  return {summary,output};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const args=process.argv.slice(2),options={};let filename;
    for(let i=0;i<args.length;i++){
      if(args[i]==='--fixture')options.fixture=true;
      else if(args[i]==='--live')options.live=true;
      else if(args[i]==='--config-file'){filename=args[++i];if(!filename)throw new Error();}
      else if(args[i]==='--cases'){const value=args[++i];if(!value)throw new Error();options.cases=value.split(',');}
      else throw new Error();
    }
    if(options.fixture&&options.live)throw new Error();
    if(filename&&!options.live)throw new Error();
    if(options.live)options.config=readEvaluationConfig(filename);
    process.stdout.write(JSON.stringify(await runPlatformEvaluation(options),null,2)+'\n');
  }catch{process.stderr.write('平台评测未运行完成。请检查模式、开发题编号及创宇宙 .cu-runtime 内的独立配置文件；原始异常与配置内容未输出。\n');process.exitCode=1;}
}
