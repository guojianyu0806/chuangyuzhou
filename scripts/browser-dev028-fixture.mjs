// DEV-028 synthetic custom-block UI acceptance only; independently copied from DEV-027.
// Production prompts and review flow are unchanged.
// The actual provider key is accepted only through stdin and retained only in memory.
import {mkdirSync,mkdtempSync,writeFileSync,renameSync,lstatSync} from 'node:fs';
import {join,resolve,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
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
const SETUP_TOKEN='dev028-synthetic-only-setup-token';
export const MAX_PROVIDER_RESPONSE_BYTES=1024*1024;
export const FIXTURE=Object.freeze({
  origin:'http://localhost:4398',host:'127.0.0.1',port:4398,
  username:'dev028-reviewer',password:'Dev028-synthetic-only-2026!',
  placeholderKey:'dev028-public-placeholder-not-a-provider-key',
  protectedTaskId:'dev028-protected-task',captureId:'dev028-source-capture',
  protectedBlockId:'block:dev028-protected-block',
});
export const SEED=Object.freeze({
  profileName:'DEV-028 合成方块验收',profileMajor:'测试资料，非正式账号',workbenchTitle:'DEV-028 合成方块验收',
  captureText:'活动准备与预算工具说明（合成）\n本轮验收使用合成活动准备清单和预算小工具；具体字段由后续用户要求给出。所有资料均为测试材料，不是真实活动、支出或官方要求。',
  protectedTaskTitle:'保留原有待办（合成）',
  protectedTaskDescription:'DEV-028 保护基线；本轮自定义方块验收不得修改、完成、归档或删除此待办。',
  protectedBlockTitle:'保留原有便签（合成）',
  protectedBlockDescription:'DEV-028 现有 note 方块；用于比较保护哈希，不属于本轮待创建的清单或预算工具。',
  protectedBlockText:'DEV-028 合成保护便签\n此内容仅用于保护哈希核验；本轮不得修改、归档或删除此方块。',
});
const stamp=()=>new Date().toISOString();
const requireKey=value=>{if(typeof value!=='string'||value.length<12||value.length>500||/[\s\x00-\x1f\x7f]/.test(value))throw Error('Invalid stdin key.');return value;};

/** Parsing does not access any directory or retain/write the key outside the caller's memory. */
export function parseFixtureInput(line){
  if(typeof line!=='string'||line.length>4096)throw Error('Invalid fixture input.');
  if(!line.trimStart().startsWith('{'))return {key:requireKey(line)};
  let value;try{value=JSON.parse(line);}catch{throw Error('Invalid fixture input.');}
  if(!value||Array.isArray(value)||Object.keys(value).some(key=>!['key','resumeDataDir'].includes(key))||
    (value.resumeDataDir!==undefined&&(typeof value.resumeDataDir!=='string'||!value.resumeDataDir||value.resumeDataDir.length>512||/[\x00-\x1f\x7f]/.test(value.resumeDataDir))))throw Error('Invalid fixture input.');
  return {key:requireKey(value.key),...(value.resumeDataDir===undefined?{}:{resumeDataDir:value.resumeDataDir})};
}

/** Only direct ordinary dev028-browser-* children of this copy's runtime are resumable. */
export function validateResumeDirectory(value){
  if(typeof value!=='string'||!value||value.length>512||/[\x00-\x1f\x7f]/.test(value))throw Error('Invalid resume directory.');
  const target=resolve(ROOT,value);
  if(dirname(target).toLowerCase()!==resolve(RUNTIME_ROOT).toLowerCase()||!/^dev028-browser-[A-Za-z0-9-]{1,64}$/.test(basename(target)))throw Error('Resume directory is outside the synthetic fixture boundary.');
  assertRuntimePath(target);
  if(!lstatSync(target).isDirectory())throw Error('Resume target must be an existing directory.');
  return target;
}
const safeErrors=new Set(['MODEL_NOT_CONFIGURED','INVALID_PROPOSAL','MODEL_AUTH_FAILED','MODEL_RATE_LIMIT',
  'MODEL_UNAVAILABLE','AI_INTERRUPTED','AI_TIMEOUT','MODEL_OUTPUT_TRUNCATED','MODEL_INCOMPLETE']);
const staticValidationIssues=new Set([
  '模型回复不是完整的 JSON 对象。','模型回复须为 JSON 对象。','模型未返回可识别的整理建议。',
  '查询与执行行动单须分开返回。','每轮查询须为1至6项。','不支持这个工作台查询。','查询包含不支持的字段。',
  '查询文字格式无效。','查询的记录类型不存在。','读取详情需要记录类型和真实编号。','请选择已有资料的文件编号。',
  '查询日期无效。','查询起始日期不能晚于结束日期。','查询范围超出限制。','归档筛选无效。','完成状态筛选无效。',
  '日历查询需要开始和结束日期。','日历类型无效。','日历来源无效。','记账统计范围无效。','记账分组方式无效。',
  '行动单目标工作区不存在。','模型返回了不存在或未经选择的工作区，请重试。',
  'AI 整理结果格式不正确。','AI 整理结果包含无效文字。','AI 返回了无效的工作区。',
  '通用行动单不能混入旧版整理条目。','这个目标需要使用明确的行动单。','AI 整理条目数量无效。',
  '一次行动须为1至50项。','行动对象格式无效。','行动结构包含不支持字段。','此工作台操作暂不支持。',
  '新记录编号由系统生成，不能自行指定。','新建记录引用名无效或重复。','只能引用本批次前面已经新建的记录。',
  '引用的记录类型与行动不匹配。','行动内容的文字无效。','行动日期无效。','行动选项无效。',
  '工作台设置格式无效。','工作台配置只支持修改。','请指定需要修改的配置。','只能操作物品库中的现有板块。',
  '顶级板块不能指定所属位置。','板块显示状态无效。','板块位置超出范围。',
  '自定义方块行动包含不支持的字段。','新建方块需要 kind、title 和 config。',
  ...['对话回复','目标工作区','标题','摘要','归类理由','笔记标题','笔记内容','待办标题','待办说明','日期']
    .map(field=>`模型返回的 ${field} 格式不正确。`),
]);
const identifier=value=>typeof value==='string'&&/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(value)&&!/^sk[-_]/i.test(value)?value:'redacted-or-invalid';
const valueType=value=>value===undefined?'missing':value===null?'null':Array.isArray(value)?'array':typeof value;
const identifierKeys=value=>value&&typeof value==='object'&&!Array.isArray(value)?Object.keys(value).slice(0,64).map(identifier):[];

/** Structure only: no IDs, titles, query text, action values, or reply content. */
export function modelOutputShape(content){
  if(typeof content!=='string')return {jsonParsed:false,contentType:valueType(content)};
  let parsed;try{parsed=JSON.parse(content);}catch{return {jsonParsed:false,contentType:'string',contentChars:content.length};}
  const queries=parsed?.queries,proposal=parsed?.proposal,actions=proposal?.actions;
  return {jsonParsed:true,topLevelType:valueType(parsed),topLevelKeys:identifierKeys(parsed),replyType:valueType(parsed?.reply),
    proposalType:valueType(proposal),proposalKeys:identifierKeys(proposal),queriesType:valueType(queries),
    queryCount:Array.isArray(queries)?queries.length:0,
    queries:Array.isArray(queries)?queries.slice(0,6).map(query=>({kind:identifier(query?.kind),entity:identifier(query?.entity),fields:identifierKeys(query)})):[],
    actionsType:valueType(actions),actionCount:Array.isArray(actions)?actions.length:0,
    actions:Array.isArray(actions)?actions.slice(0,50).map(action=>({entity:identifier(action?.entity),operation:identifier(action?.operation),
      fields:identifierKeys(action),dataFields:identifierKeys(action?.data)})):[]};
}

export function correctionMetadata(user){
  let parsed;try{parsed=JSON.parse(user);}catch{return {correctionPresent:false};}
  const correction=parsed?.formatCorrection;
  if(!correction||typeof correction!=='object')return {correctionPresent:false};
  const issue=typeof correction.issue==='string'?correction.issue:'';
  return {correctionPresent:true,correctiveCode:identifier(correction.code),
    ...(Array.isArray(correction.queryIssues)?{queryIssues:correction.queryIssues.slice(0,6).map(item=>({
      code:identifier(item?.code),index:Number.isInteger(item?.index)&&item.index>=0&&item.index<6?item.index:null,
      kind:identifier(item?.kind),field:identifier(item?.field)}))}:{}),
    ...(staticValidationIssues.has(issue)?{correctiveIssue:issue}:{correctiveIssue:'unlisted-static-or-private-message',
      correctiveIssueChars:issue.length,correctiveIssueHash:createHash('sha256').update(issue).digest('hex')})};
}

export function createSyntheticState(now=stamp()){
  const workbench=createWorkbench('blank');
  workbench.title=SEED.workbenchTitle;workbench.onboardingComplete=true;
  return {schema:1,mode:'personal',profile:{name:SEED.profileName,major:SEED.profileMajor,provider:'deepseek'},
    workbench,courses:[],spaces:[],english:{},aiRequests:[],
    captures:[{id:FIXTURE.captureId,text:SEED.captureText,
      category:'灵感',tags:'DEV-028 合成',source:'DEV-028 合成测试资料',archived:false,createdAt:now,updatedAt:now}],
    tasks:[{id:FIXTURE.protectedTaskId,title:SEED.protectedTaskTitle,description:SEED.protectedTaskDescription,
      category:'个人',date:'',priority:'normal',done:false,archived:false,source:'DEV-028 合成保护基线',createdAt:now,updatedAt:now}],
    customBlocks:{version:1,items:[{id:FIXTURE.protectedBlockId,kind:'note',title:SEED.protectedBlockTitle,description:SEED.protectedBlockDescription,
      color:'#AE88FF',archived:false,config:{text:SEED.protectedBlockText},data:{syntheticProtectionBaseline:'DEV-028'},createdAt:now,updatedAt:now}]},
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
    outputShape:modelOutputShape(data?.choices?.[0]?.message?.content),
    usage:Object.fromEntries(['prompt_tokens','completion_tokens','total_tokens','prompt_cache_hit_tokens','prompt_cache_miss_tokens']
      .filter(key=>Number.isSafeInteger(usage[key])&&usage[key]>=0).map(key=>[key,usage[key]]))};
}

/** No environment or config-file key lookup. fetchImpl is injectable for offline tests only. */
export function createRecordedModelRunner(apiKey,{fetchImpl=globalThis.fetch,persist=()=>{},resumed=false}={}){
  requireKey(apiKey);
  const report={development:'DEV-028',scope:'Synthetic localhost UI; unchanged production prompts; no formal workspace reads',
    model:MODEL,sessionMode:resumed?'resume':'new',createdAt:stamp(),calls:[],requestCount:0,actualTokensReported:0,missingUsageCount:0,closed:false};
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
      call={index:report.calls.length+1,startedAt:stamp(),configuredModel:MODEL,transportOk:false,...correctionMetadata(input.user)};
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
  const filename=`DEV-028-live-${stamp().replaceAll(':','-').replaceAll('.','-')}-${randomUUID().slice(0,8)}.json`;
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
        context.json(res,400,{error:'FIXTURE_PLACEHOLDER_REQUIRED',message:'DEV-028 合成实例只接受公开占位密钥和 DeepSeek V4 Pro；真实密钥仅从进程标准输入提供。'});
        return true;
      }
      return service.handle(req,res,{...context,readJson:async()=>body});
    }
    return service.handle(req,res,context);
  }};
}

async function localJson(response,maxBytes=64*1024){
  const length=Number(response.headers.get('content-length'));
  if(Number.isFinite(length)&&length>maxBytes){await response.body?.cancel();throw Error('Synthetic API response limit.');}
  if(!response.body?.getReader)throw Error('Synthetic API response missing.');
  const reader=response.body.getReader(),chunks=[];let bytes=0;
  try{for(;;){const result=await reader.read();if(result.done)break;bytes+=result.value.byteLength;
    if(bytes>maxBytes){await reader.cancel();throw Error('Synthetic API response limit.');}chunks.push(result.value);}}
  finally{reader.releaseLock();}
  try{return JSON.parse(Buffer.concat(chunks,bytes).toString('utf8'));}catch{throw Error('Synthetic API response invalid.');}
}

export function validateSyntheticIdentity(state){
  const block=state?.customBlocks?.items?.find(item=>item.id===FIXTURE.protectedBlockId);
  if(state?.profile?.name!==SEED.profileName||state?.profile?.major!==SEED.profileMajor||state?.workbench?.title!==SEED.workbenchTitle||
    !state?.tasks?.some(item=>item.id===FIXTURE.protectedTaskId)||!state?.captures?.some(item=>item.id===FIXTURE.captureId)||
    block?.kind!=='note'||block?.data?.syntheticProtectionBaseline!=='DEV-028')throw Error('Not the DEV-028 synthetic identity.');
  return true;
}

/** Resume uses only normal login/GET/logout routes; new fixtures alone may setup/seed. */
export async function authenticateFixture({resumed=false,fetchImpl=globalThis.fetch}={}){
  const local=`http://${FIXTURE.host}:${FIXTURE.port}`;let cookie='',csrf='';
  const request=(path,{method='GET',body}={})=>fetchImpl(local+path,{method,redirect:'error',signal:AbortSignal.timeout(10000),headers:{
    ...(method!=='GET'?{Origin:FIXTURE.origin}:{}),...(body?{'Content-Type':'application/json'}:{}),
    ...(cookie?{Cookie:cookie,'X-CSRF-Token':csrf}:{})},...(body?{body:JSON.stringify(body)}:{})});
  try{
    const login=await request(resumed?'/api/auth/login':'/api/auth/setup',{method:'POST',body:{username:FIXTURE.username,password:FIXTURE.password,...(resumed?{}:{setupToken:SETUP_TOKEN})}});
    if(login.status!==(resumed?200:201)){await login.body?.cancel();throw Error('Synthetic authentication failed.');}
    cookie=login.headers.get('set-cookie')?.split(';')[0]||'';
    const session=await localJson(login);csrf=typeof session.csrfToken==='string'?session.csrfToken:'';
    if(!cookie||!csrf||session.authenticated!==true||session.username!==FIXTURE.username)throw Error('Synthetic session unavailable.');
    if(!resumed){
      const saved=await request('/api/workspace',{method:'PUT',body:{baseRevision:0,state:createSyntheticState()}});
      if(saved.status!==200){await saved.body?.cancel();throw Error('Synthetic workspace setup failed.');}await saved.body?.cancel();
    }
    const snapshot=await request('/api/workspace');
    if(snapshot.status!==200){await snapshot.body?.cancel();throw Error('Synthetic workspace unavailable.');}
    const workspace=await localJson(snapshot,13*1024*1024);
    if(!Number.isSafeInteger(workspace.revision))throw Error('Synthetic workspace envelope invalid.');
    validateSyntheticIdentity(workspace.state);
    return {resumed,workspaceRevision:workspace.revision};
  }finally{
    if(cookie&&csrf){try{const loggedOut=await request('/api/auth/logout',{method:'POST'});await loggedOut.body?.cancel();
      if(loggedOut.status!==200)throw Error('Synthetic logout failed.');}finally{cookie='';csrf='';}}
  }
}

export async function startFixture(apiKey,{resumeDataDir}={}){
  requireKey(apiKey);
  assertOrdinaryPath(ROOT,ROOT);assertRuntimePath(RUNTIME_ROOT);mkdirSync(RUNTIME_ROOT,{recursive:true});
  const resumed=resumeDataDir!==undefined;
  const dataDir=resumed?validateResumeDirectory(resumeDataDir):assertRuntimePath(mkdtempSync(join(RUNTIME_ROOT,'dev028-browser-')));
  const writer=createReportWriter(),recording=createRecordedModelRunner(apiKey,{persist:writer.persist,resumed});apiKey='';
  const extractor=createDocumentExtractor(); // Native TXT/MD/CSV only; never loads extractor-config.json.
  let app,identityVerified=false;
  try{
    app=await createWorkbenchServer({dataDir,secureCookie:false,publicOrigin:FIXTURE.origin,setupToken:SETUP_TOKEN,
      extractFile:extractor.extractFile,
      modelFactory:({dataDir:directory,store})=>restrictFixtureConfig(createHermesService({dataDir:directory,store,env:{},
        engine:'deepseek-direct',runModel:input=>identityVerified?recording.runModel(input):Promise.resolve({ok:false,code:'MODEL_NOT_CONFIGURED'}),
        extractFile:extractor.extractFile,extractionCapabilities:()=>extractor.capabilities})),
      onError:()=>process.stderr.write('DEV-028 synthetic request failed; inspect the UI error.\n')});
    await new Promise((ready,reject)=>{app.server.once('error',reject);app.server.listen(FIXTURE.port,FIXTURE.host,ready);});
    await authenticateFixture({resumed});identityVerified=true;
  }catch{
    await recording.close();await app?.close();throw Error('DEV-028 fixture startup failed; check port and local directories.');
  }
  let closing;
  return {origin:FIXTURE.origin,dataDir,resumed,reportPath:writer.path,summary:recording.summary,close(){
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
      try{const input=parseFixtureInput(line);line='';starting=startFixture(input.key,{resumeDataDir:input.resumeDataDir});input.key='';}
      catch{line='';process.stderr.write('DEV-028 startup input invalid. No secret diagnostics were retained.\n');process.exitCode=1;void stop();return;}
      starting.then(value=>{
        fixture=value;
        if(shutdownRequested){void fixture.close();return;}
        process.stdout.write(JSON.stringify({event:'DEV028_READY',origin:fixture.origin,runtime:fixture.dataDir,resumed:fixture.resumed,report:fixture.reportPath,
          username:FIXTURE.username,password:FIXTURE.password,model:MODEL,placeholderKey:FIXTURE.placeholderKey,
          instruction:'Log in, save only the placeholder in model settings, then send synthetic AI requests. STOP on stdin closes this fixture.'})+'\n');
      }).catch(()=>{process.stderr.write('DEV-028 startup failed. No secret diagnostics were retained.\n');process.exitCode=1;void stop();});
    }else if(line.trim()==='STOP'){line='';void stop();}
  });
  lines.once('close',()=>{void stop();});
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{void stop();});
  process.stdout.write('DEV-028 awaiting provider key or {key,resumeDataDir} JSON on stdin first line; keep stdin open, send STOP to close.\n');
}

if(isCliEntry(import.meta.url))await main();
