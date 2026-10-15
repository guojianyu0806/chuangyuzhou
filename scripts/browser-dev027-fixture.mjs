// DEV-027 synthetic UI acceptance only. Production prompts and review flow are unchanged.
// The actual provider key is accepted only through stdin and retained only in memory.
import {mkdirSync,mkdtempSync,writeFileSync,renameSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createInterface} from 'node:readline';
import {createWorkbenchServer} from '../yuzhou/backend/server.mjs';
import {createHermesService} from '../yuzhou/backend/hermes.mjs';
import {createDeepSeekRunner} from '../yuzhou/backend/deepseek.mjs';
import {createDocumentExtractor} from '../yuzhou/backend/extractor.mjs';
import {createWorkbench} from '../yuzhou/frontend/src/workbench-model.js';
import {isCliEntry} from '../yuzhou/backend/is-cli.mjs';
import {RUNTIME_ROOT,assertRuntimePath,assertOrdinaryPath} from '../yuzhou/runtime.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const ENDPOINT='https://api.deepseek.com/chat/completions';
const MODEL='deepseek-v4-pro';
export const MAX_PROVIDER_RESPONSE_BYTES=1024*1024;
export const FIXTURE=Object.freeze({
  origin:'http://localhost:4398',host:'127.0.0.1',port:4398,
  username:'dev027-reviewer',password:'Dev027-synthetic-only-2026!',
  placeholderKey:'dev027-public-placeholder-not-a-provider-key',
  protectedTaskId:'dev027-protected-task',captureId:'dev027-source-capture',
});
const stamp=()=>new Date().toISOString();
const safeErrors=new Set(['MODEL_NOT_CONFIGURED','INVALID_PROPOSAL','MODEL_AUTH_FAILED','MODEL_RATE_LIMIT',
  'MODEL_UNAVAILABLE','AI_INTERRUPTED','AI_TIMEOUT','MODEL_OUTPUT_TRUNCATED','MODEL_INCOMPLETE']);

export function createSyntheticState(now=stamp()){
  const workbench=createWorkbench('blank');
  workbench.title='DEV-027 合成 AI 验收';workbench.onboardingComplete=true;
  return {schema:1,mode:'personal',profile:{name:'DEV-027 合成验收',major:'测试资料，非正式账号',provider:'deepseek'},
    workbench,courses:[],spaces:[],english:{},aiRequests:[],
    captures:[{id:FIXTURE.captureId,text:'校园分享会要求（合成）\n内部模拟计划：活动2026年10月28日；请于2026年10月25日前完成讲稿。这是测试材料，不是真实活动或官方截止日期。',
      category:'灵感',tags:'DEV-027 合成',source:'DEV-027 合成测试资料',archived:false,createdAt:now,updatedAt:now}],
    tasks:[{id:FIXTURE.protectedTaskId,title:'保留原有记录（合成）',description:'DEV-027 保护基线；本轮 AI 验收不得修改、完成、归档或删除此记录。',
      category:'个人',date:'',priority:'normal',done:false,archived:false,source:'DEV-027 合成保护基线',createdAt:now,updatedAt:now}],
    calendar:{version:1,events:[]},ledger:{version:1,currency:'CNY',projects:[],entries:[]},
    aiDraft:{text:'',files:[],targetId:'auto'},ui:{sidebarPinned:false},
    canvas:{cards:[],view:{x:24,y:24,zoom:1},snap:false,presentation:'canvas',initialized:true},updatedAt:now};
}

/** Consume the original stream once, never clone/tee it into an unbounded buffer. */
export async function readBoundedProviderResponse(response){
  const declared=Number(response.headers?.get('content-length'));
  if(Number.isFinite(declared)&&declared>MAX_PROVIDER_RESPONSE_BYTES){
    await response.body?.cancel().catch(()=>{});return {tooLarge:true};
  }
  if(!response.body?.getReader)return {bytes:Buffer.alloc(0),tooLarge:false};
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{
    for(;;){
      const {done,value}=await reader.read();if(done)break;
      size+=value.byteLength;
      if(size>MAX_PROVIDER_RESPONSE_BYTES){await reader.cancel().catch(()=>{});return {tooLarge:true};}
      chunks.push(value);
    }
  }finally{reader.releaseLock();}
  return {bytes:Buffer.concat(chunks,size),tooLarge:false};
}

function responseMetadata(bytes){
  let data;try{data=JSON.parse(bytes.toString('utf8'));}catch{return {metadataParsed:false};}
  const finish=data?.choices?.[0]?.finish_reason;
  const usage=data?.usage||{};
  return {metadataParsed:true,
    returnedModel:typeof data?.model==='string'&&/^deepseek-[a-z0-9.-]{1,60}$/.test(data.model)?data.model:'unexpected-or-missing',
    finishReason:['stop','length','content_filter','tool_calls','insufficient_system_resource','aborted'].includes(finish)?finish:'unexpected-or-missing',
    usage:Object.fromEntries(['prompt_tokens','completion_tokens','total_tokens','prompt_cache_hit_tokens','prompt_cache_miss_tokens']
      .filter(key=>Number.isSafeInteger(usage[key])&&usage[key]>=0).map(key=>[key,usage[key]]))};
}

/** No environment or config-file key lookup. fetchImpl is injectable for offline tests only. */
export function createRecordedModelRunner(apiKey,{fetchImpl=globalThis.fetch,persist=()=>{}}={}){
  if(typeof apiKey!=='string'||apiKey.length<12||apiKey.length>500||/[\s\x00-\x1f\x7f]/.test(apiKey))throw Error('Invalid stdin key.');
  const report={development:'DEV-027',scope:'Synthetic localhost UI; unchanged production prompts; no formal workspace reads',
    model:MODEL,createdAt:stamp(),calls:[],requestCount:0,actualTokensReported:0,missingUsageCount:0,closed:false};
  const controllers=new Set(),active=new Set();let closed=false;
  const publish=()=>{
    report.requestCount=report.calls.length;
    report.actualTokensReported=report.calls.reduce((sum,call)=>sum+(call.usage?.total_tokens||0),0);
    report.missingUsageCount=report.calls.filter(call=>call.completedAt&&!Number.isSafeInteger(call.usage?.total_tokens)).length;
    persist(structuredClone(report));
  };
  const runModel=input=>{
    if(closed)return Promise.resolve({ok:false,code:'AI_INTERRUPTED'});
    if(input?.settings?.provider!=='deepseek'||input.settings.model!==MODEL||input.settings.apiKey!==FIXTURE.placeholderKey)
      return Promise.resolve({ok:false,code:'MODEL_NOT_CONFIGURED'});
    const controller=new AbortController();controllers.add(controller);
    const signal=input.signal?AbortSignal.any([input.signal,controller.signal]):controller.signal;
    let call;
    const runner=createDeepSeekRunner({fetch:async(url,options)=>{
      if(call||url!==ENDPOINT||options.redirect!=='error')throw Error('Unexpected transport.');
      // The production body, complete system prompt, max_tokens, and thinking settings pass unchanged.
      call={index:report.calls.length+1,startedAt:stamp(),configuredModel:MODEL,transportOk:false};
      report.calls.push(call);publish();
      const response=await fetchImpl(url,options);
      call.httpStatus=response.status;
      if(response.redirected||!response.ok)return response;
      const bounded=await readBoundedProviderResponse(response);
      if(bounded.tooLarge){
        call.responseLimitExceeded=true;
        return new Response(null,{status:200,headers:{'content-length':String(MAX_PROVIDER_RESPONSE_BYTES+1)}});
      }
      call.responseBytes=bounded.bytes.length;Object.assign(call,responseMetadata(bounded.bytes));
      return new Response(bounded.bytes,{status:response.status,headers:{'content-type':'application/json'}});
    }});
    const started=Date.now();
    const pending=(async()=>{
      let result;
      try{
        result=await runner({...input,signal,settings:{provider:'deepseek',model:MODEL,apiKey}});
        if(call){call.transportOk=result.ok;if(!result.ok)call.errorCode=safeErrors.has(result.code)?result.code:'MODEL_UNAVAILABLE';}
        return result;
      }finally{
        controllers.delete(controller);
        if(call){call.completedAt=stamp();call.elapsedMs=Date.now()-started;publish();}
      }
    })();
    active.add(pending);pending.then(()=>active.delete(pending),()=>active.delete(pending));return pending;
  };
  publish();
  return {runModel,summary:()=>structuredClone(report),async close(){
    if(closed)return;closed=true;apiKey='';for(const controller of controllers)controller.abort();
    await Promise.allSettled([...active]);report.closed=true;report.closedAt=stamp();publish();
  }};
}

function createReportWriter(){
  const directory=assertOrdinaryPath(join(ROOT,'evidence','engineering'),ROOT);
  mkdirSync(directory,{recursive:true});
  const filename=`DEV-027-live-${stamp().replaceAll(':','-').replaceAll('.','-')}-${randomUUID().slice(0,8)}.json`;
  const path=assertOrdinaryPath(join(directory,filename),ROOT);
  writeFileSync(path,'{}\n',{flag:'wx',mode:0o600});
  return {path,persist(report){
    assertOrdinaryPath(path,ROOT);
    const temporary=assertOrdinaryPath(`${path}.${randomUUID()}.tmp`,ROOT);
    writeFileSync(temporary,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
    renameSync(temporary,path);
  }};
}

/** Reject accidental real keys at the normal settings API before its persistence path. */
export function restrictFixtureConfig(service){
  return {...service,async handle(req,res,context){
    if(req.method==='PUT'&&context.url.pathname==='/api/model/config'){
      const body=await context.readJson(req,16*1024);
      if(body?.enabled!==false&&(body?.model!==MODEL||
        (body?.apiKey!==undefined&&body.apiKey!==''&&body.apiKey!==FIXTURE.placeholderKey))){
        context.json(res,400,{error:'FIXTURE_PLACEHOLDER_REQUIRED',message:'DEV-027 合成实例只接受公开占位密钥和 DeepSeek V4 Pro；真实密钥仅从进程标准输入提供。'});
        return true;
      }
      return service.handle(req,res,{...context,readJson:async()=>body});
    }
    return service.handle(req,res,context);
  }};
}

export async function startFixture(apiKey){
  assertOrdinaryPath(ROOT,ROOT);assertRuntimePath(RUNTIME_ROOT);mkdirSync(RUNTIME_ROOT,{recursive:true});
  const dataDir=assertRuntimePath(mkdtempSync(join(RUNTIME_ROOT,'dev027-browser-')));
  const writer=createReportWriter(),recording=createRecordedModelRunner(apiKey,{persist:writer.persist});apiKey='';
  const extractor=createDocumentExtractor(); // Native TXT/MD/CSV only; never loads extractor-config.json.
  let app;const setupToken='dev027-synthetic-only-setup-token';
  try{
    app=await createWorkbenchServer({dataDir,secureCookie:false,publicOrigin:FIXTURE.origin,setupToken,
      extractFile:extractor.extractFile,
      modelFactory:({dataDir:directory,store})=>restrictFixtureConfig(createHermesService({dataDir:directory,store,env:{},
        engine:'deepseek-direct',runModel:recording.runModel,extractFile:extractor.extractFile,extractionCapabilities:()=>extractor.capabilities})),
      onError:()=>process.stderr.write('DEV-027 synthetic request failed; inspect the UI error.\n')});
    await new Promise((ready,reject)=>{app.server.once('error',reject);app.server.listen(FIXTURE.port,FIXTURE.host,ready);});
    // Bootstrap only this new synthetic account through normal HTTP/auth/CSRF routes.
    const local=`http://${FIXTURE.host}:${FIXTURE.port}`;
    const setup=await fetch(local+'/api/auth/setup',{method:'POST',headers:{Origin:FIXTURE.origin,'Content-Type':'application/json'},
      body:JSON.stringify({username:FIXTURE.username,password:FIXTURE.password,setupToken})});
    if(setup.status!==201)throw Error('Synthetic account setup failed.');
    const cookie=setup.headers.get('set-cookie')?.split(';')[0],session=await setup.json();
    if(!cookie||typeof session.csrfToken!=='string')throw Error('Synthetic session unavailable.');
    const saved=await fetch(local+'/api/workspace',{method:'PUT',headers:{Origin:FIXTURE.origin,'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':session.csrfToken},
      body:JSON.stringify({baseRevision:0,state:createSyntheticState()})});
    if(saved.status!==200){await saved.body?.cancel();throw Error('Synthetic workspace setup failed.');}
    await saved.body?.cancel();
    const loggedOut=await fetch(local+'/api/auth/logout',{method:'POST',headers:{Origin:FIXTURE.origin,Cookie:cookie,'X-CSRF-Token':session.csrfToken}});
    await loggedOut.body?.cancel();
  }catch{
    await recording.close();await app?.close();throw Error('DEV-027 fixture startup failed; check port and local directories.');
  }
  let closing;
  return {origin:FIXTURE.origin,dataDir,reportPath:writer.path,summary:recording.summary,close(){
    if(!closing)closing=(async()=>{await recording.close();await app.close();})();return closing;
  }};
}

async function main(){
  const lines=createInterface({input:process.stdin,terminal:false,crlfDelay:Infinity});
  let fixture,first=true,starting,shutdownRequested=false,shutdown;
  const stop=()=>{
    shutdownRequested=true;
    if(!shutdown)shutdown=(async()=>{await starting?.catch(()=>{});await fixture?.close();lines.close();process.stdin.pause();})();
    return shutdown;
  };
  lines.on('line',line=>{
    if(first){
      first=false;
      if(line==='STOP'){void stop();return;}
      starting=startFixture(line);line='';
      starting.then(value=>{
        fixture=value;
        if(shutdownRequested){void fixture.close();return;}
        process.stdout.write(JSON.stringify({event:'DEV027_READY',origin:fixture.origin,runtime:fixture.dataDir,report:fixture.reportPath,
          username:FIXTURE.username,password:FIXTURE.password,model:MODEL,placeholderKey:FIXTURE.placeholderKey,
          instruction:'Log in, save only the placeholder in model settings, then send synthetic AI requests. STOP on stdin closes this fixture.'})+'\n');
      }).catch(()=>{process.stderr.write('DEV-027 startup failed. No secret diagnostics were retained.\n');process.exitCode=1;void stop();});
    }else if(line.trim()==='STOP'){line='';void stop();}
  });
  lines.once('close',()=>{void stop();});
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{void stop();});
  process.stdout.write('DEV-027 awaiting provider key on stdin first line; keep stdin open, send STOP to close.\n');
}

if(isCliEntry(import.meta.url))await main();
