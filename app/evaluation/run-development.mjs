import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {planWithAI,PROMPT_VERSION} from '../src/ai-planner.mjs';
import {propose,applyProposal} from '../src/domain.mjs';
import {PROJECT_ROOT,RUNTIME_ROOT,runtimePath} from '../src/runtime.mjs';
import {DATASET_META,DEVELOPMENT_CASES,prepareDevelopmentCase,fixtureFor,checkDevelopmentOutcome} from './development-cases.mjs';
import {readEvaluationConfig} from './config.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
export async function runDevelopmentEvaluation({config,fixture=false,live=false,cases=DEVELOPMENT_CASES.map(c=>c.id),writeResults=true}={}){
  if(fixture&&live)throw new Error('fixture与live不能同时启用。');
  if(!fixture&&!live)return {mode:'validation_only',modelCalled:false,dataset:DATASET_META,cases:DEVELOPMENT_CASES.map(({id,category})=>({id,category}))};
  if(live&&!config?.apiKey)throw new Error('真实测评需要显式提供创宇宙专用配置。');
  if(!Array.isArray(cases)||!cases.length||cases.some(id=>!DEVELOPMENT_CASES.some(task=>task.id===id))||new Set(cases).size!==cases.length)throw new Error('开发题目选择无效。');
  const startedAt=new Date().toISOString(),records=[];
  for(const id of cases){
    const prepared=prepareDevelopmentCase(id),started=performance.now();
    let planned=null,mechanicalSuccess=false,errorCode=null,measurement=null;
    try{
      planned=await planWithAI({state:prepared.state,workspaceId:prepared.workspaceId,message:prepared.task.message,selectedComponentId:prepared.selectedComponentId,config,
        ...(fixture?{provider:async()=>({text:JSON.stringify(fixtureFor(prepared)),model:'offline-fixture-not-ai',usage:null})}:{})});
      measurement=planned.measurement;let after=prepared.state;
      const createsWorkspace=['workspace.create','template.import'].includes(planned.actions[0]?.op);
      if(planned.actions.length)after=applyProposal(prepared.state,propose(prepared.state,{...(!createsWorkspace&&prepared.workspaceId?{workspaceId:prepared.workspaceId}:{}),requestId:'evaluation-'+randomUUID(),actions:planned.actions})).state;
      mechanicalSuccess=checkDevelopmentOutcome(prepared,planned,after);
    }catch(error){errorCode=/^[a-z][a-z0-9_]{0,80}$/.test(error.code||'')?error.code:'evaluation_failed';measurement=error.measurement||null;}
    records.push({id,category:prepared.task.category,executionMode:fixture?'offline_fixture':'live',modelCalled:measurement?.modelCalled===true,startedAt,elapsedMs:Math.round(performance.now()-started),
      input:prepared.task.message,initialState:prepared.state,expected:prepared.task.expected,planned,mechanicalSuccess,errorCode,measurement,semanticReview:'pending',cost:null});
    // Do not repeatedly spend after account/transport failures. Unattempted cases
    // remain explicitly recorded in the summary instead of disappearing.
    if(live&&/^(model_http_401|model_http_402|model_http_429|model_timeout|model_network)$/.test(errorCode||''))break;
  }
  const summary={dataset:DATASET_META,startedAt,executionMode:fixture?'offline_fixture':'live',modelCalled:records.some(record=>record.modelCalled),requested:cases.length,attempted:records.length,unattempted:cases.slice(records.length),
    mechanicalPassed:records.filter(r=>r.mechanicalSuccess).length,failures:records.filter(r=>r.errorCode).length,timeouts:records.filter(r=>r.errorCode==='model_timeout').length,
    refusals:records.filter(r=>r.errorCode==='model_refused').length,semanticReview:'pending',aiPerformanceClaimAllowed:false,cost:null,promptVersion:PROMPT_VERSION,
    codeHashes:Object.fromEntries(['src/ai-planner.mjs','src/domain.mjs','src/deepseek-provider.mjs','evaluation/development-cases.mjs'].map(path=>[path,sha(readFileSync(resolve(PROJECT_ROOT,path)))])),
    note:fixture?'离线预设回复仅验证评测管道，不代表AI准确率。':'仅少量开发样例及机械约束检查，独立语义核对和正式留出测评仍待完成。'};
  if(writeResults){
    const output=runtimePath(resolve(RUNTIME_ROOT,'evaluation','dev-'+startedAt.replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8)));mkdirSync(output,{recursive:true});
    writeFileSync(resolve(output,'results.jsonl'),records.map(record=>JSON.stringify(record)).join('\n')+'\n',{flag:'wx'});
    writeFileSync(resolve(output,'summary.json'),JSON.stringify(summary,null,2)+'\n',{flag:'wx'});
    writeFileSync(resolve(output,'metrics.csv'),'id,mode,mechanical_success,error_code,elapsed_ms,semantic_review,cost\n'+records.map(r=>[r.id,r.executionMode,r.mechanicalSuccess,r.errorCode||'',r.elapsedMs,'pending',''].join(',')).join('\n')+'\n',{flag:'wx'});
    return {summary,output};
  }
  return {summary,records};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const args=process.argv.slice(2),options={};let filename;
    for(let i=0;i<args.length;i++){
      if(args[i]==='--fixture')options.fixture=true;
      else if(args[i]==='--live')options.live=true;
      else if(args[i]==='--config-file'){filename=args[++i];if(!filename)throw new Error('配置路径缺失。');}
      else if(args[i]==='--cases'){const value=args[++i];if(!value)throw new Error('题目编号缺失。');options.cases=value.split(',');}
      else throw new Error('只支持 --fixture、--live、--config-file 和 --cases。');
    }
    if(options.fixture&&options.live)throw new Error('fixture与live不能同时启用。');
    if(options.live)options.config=readEvaluationConfig(filename);
    const result=await runDevelopmentEvaluation(options);process.stdout.write(JSON.stringify(result,null,2)+'\n');
  }catch(error){process.stderr.write(['evaluation_config_invalid'].includes(error.code)?error.message+'\n':'评测未完成，请检查模式、独立配置和题目参数；没有输出原始异常。\n');process.exitCode=1;}
}
