// DEV-028 read-only synthetic acceptance. Login/logout affect only this script's session.
// Code is compiled for syntax only, never executed or written into the evidence report.
import {readFileSync,writeFileSync,mkdirSync,statSync} from 'node:fs';
import {resolve,join,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {Script} from 'node:vm';
import {FIXTURE,SEED,createSyntheticState} from './browser-dev028-fixture.mjs';
import {validateWorkspace} from '../yuzhou/backend/store.mjs';
import {validateCustomBlocks} from '../yuzhou/frontend/src/custom-blocks-model.js';
import {assertOrdinaryPath} from '../yuzhou/runtime.mjs';
import {isCliEntry} from '../yuzhou/backend/is-cli.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const EVIDENCE=join(ROOT,'evidence','engineering');
const KIND='read-only-synthetic-custom-block-check';
const STAGES=new Set(['baseline','created','used','updated','reverted','retained']);
const REFERENCES={used:['created'],updated:['used'],reverted:['used'],retained:['used','reverted']};
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
  ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const digest=value=>createHash('sha256').update(JSON.stringify(canonical(value??null))).digest('hex');
const same=(left,right)=>JSON.stringify(canonical(left))===JSON.stringify(canonical(right));
const list=value=>Array.isArray(value)?value:[];
const text=(value,max=180)=>typeof value==='string'&&value.length<=max?value:'invalid-or-missing';
const subset=(record,expected)=>!!record&&Object.entries(expected).filter(([key])=>!['createdAt','updatedAt'].includes(key)).every(([key,value])=>same(record[key],value));
const hashPattern=/^[a-f0-9]{64}$/;
const blockKinds=['checklist','miniapp'];

function syntaxOnly(code){
  if(typeof code!=='string'||!code.trim()||code.length>30000)return false;
  try{new Script(`(async function(app){\n${code}\n})`,{filename:'dev028-syntax-only.js'});return true;}catch{return false;}
}
function blockSummary(block){
  return {id:text(block.id,160),kind:text(block.kind,30),title:text(block.title,80),archived:block.archived===true,
    configHash:digest(block.config),dataHash:digest(block.data),recordHash:digest(block),
    ...(block.kind==='checklist'?{items:list(block.config?.items).slice(0,100).map(item=>({id:text(item?.id,160),label:text(item?.label,500),done:item?.done}))}:{}),
    ...(block.kind==='miniapp'?{codeHash:typeof block.config?.code==='string'?createHash('sha256').update(block.config.code).digest('hex'):null,
      codeSyntaxValid:syntaxOnly(block.config?.code),dataNonEmpty:!!block.data&&typeof block.data==='object'&&!Array.isArray(block.data)&&Object.keys(block.data).length>0}:{}),
  };
}
function validateReport(report,allowedStages,instanceId){
  if(!report||report.development!=='DEV-028'||report.kind!==KIND||report.origin!==FIXTURE.origin||report.passed!==true||!allowedStages.includes(report.stage))throw Error('INVALID_COMPARISON_REPORT');
  if(!hashPattern.test(report.instanceId||'')||report.instanceId!==instanceId)throw Error('REPORT_BELONGS_TO_ANOTHER_INSTANCE');
  if(!hashPattern.test(report.baselineFingerprint||'')||!Array.isArray(report.blocks))throw Error('INVALID_COMPARISON_REPORT');
  for(const field of ['task','capture','block'])if(!hashPattern.test(report.protection?.[field]?.sha256||''))throw Error('INVALID_COMPARISON_REPORT');
  if(!hashPattern.test(report.protection?.workbench?.sha256||'')||!hashPattern.test(report.protection?.workbench?.modulesHash||''))throw Error('INVALID_COMPARISON_REPORT');
  for(const block of report.blocks){
    if(!block||typeof block.id!=='string'||!['note',...blockKinds].includes(block.kind)||!['configHash','dataHash','recordHash'].every(key=>hashPattern.test(block[key]||'')))throw Error('INVALID_COMPARISON_REPORT');
    if(block.kind==='checklist'&&!Array.isArray(block.items))throw Error('INVALID_COMPARISON_REPORT');
    if(block.kind==='miniapp'&&!hashPattern.test(block.codeHash||''))throw Error('INVALID_COMPARISON_REPORT');
  }
}
export function validateComparisons({stage,baseline,reference,instanceId}){
  if(!STAGES.has(stage))throw Error('INVALID_STAGE');
  if(!hashPattern.test(instanceId||''))throw Error('INVALID_INSTANCE_ID');
  if(stage==='baseline'){
    if(baseline||reference)throw Error('BASELINE_TAKES_NO_REFERENCES');
    return;
  }
  if(!baseline)throw Error('VALID_BASELINE_REQUIRED');
  validateReport(baseline,['baseline'],instanceId);
  if(baseline.baselineFingerprint!==digest(baseline.protection))throw Error('INVALID_BASELINE_FINGERPRINT');
  if(REFERENCES[stage]){
    if(!reference)throw Error('STAGE_REFERENCE_REQUIRED');
    validateReport(reference,REFERENCES[stage],instanceId);
    if(reference.baselineFingerprint!==baseline.baselineFingerprint)throw Error('REFERENCE_BELONGS_TO_ANOTHER_BASELINE');
  }else if(reference)throw Error('STAGE_TAKES_NO_REFERENCE');
}

export function checkSyntheticWorkspace(state,{stage,baseline,reference,instanceId}={}){
  if(state?.profile?.name!==SEED.profileName||state?.profile?.major!==SEED.profileMajor)throw Error('NOT_DEV028_SYNTHETIC_STATE');
  validateComparisons({stage,baseline,reference,instanceId});
  const expected=createSyntheticState('2026-10-15T00:00:00.000Z');
  const tasks=list(state.tasks),captures=list(state.captures),blocks=list(state.customBlocks?.items);
  const protectedTasks=tasks.filter(row=>row.id===FIXTURE.protectedTaskId),protectedCaptures=captures.filter(row=>row.id===FIXTURE.captureId),protectedBlocks=blocks.filter(row=>row.id===FIXTURE.protectedBlockId);
  const task=protectedTasks[0],capture=protectedCaptures[0],protectedBlock=protectedBlocks[0];
  const enabled=list(state.workbench?.modules).filter(row=>row.enabled).map(row=>row.id).sort();
  const protection={task:{id:FIXTURE.protectedTaskId,sha256:digest(task)},capture:{id:FIXTURE.captureId,sha256:digest(capture)},
    block:{id:FIXTURE.protectedBlockId,sha256:digest(protectedBlock)},
    workbench:{sha256:digest(state.workbench),modulesHash:digest(state.workbench?.modules),enabledModuleIds:enabled}};
  let schemaValid=true;try{validateWorkspace(state);validateCustomBlocks(state.customBlocks);}catch{schemaValid=false;}
  const assertions={schemaValid,onlySyntheticIdentity:state.workbench?.title===SEED.workbenchTitle,
    protectedTaskPresent:protectedTasks.length===1,protectedCapturePresent:protectedCaptures.length===1,protectedBlockPresent:protectedBlocks.length===1,
    protectedTaskContent:subset(task,expected.tasks[0]),protectedCaptureContent:subset(capture,expected.captures[0]),protectedBlockContent:subset(protectedBlock,expected.customBlocks.items[0]),
    onlyProtectedTask:tasks.length===1,onlySourceCapture:captures.length===1,
    onlyAiModuleEnabled:same(enabled,['ai']),coursesStillEmpty:list(state.courses).length===0,spacesStillEmpty:list(state.spaces).length===0,
    nativeCalendarEventsZero:list(state.calendar?.events).length===0,ledgerStillEmpty:list(state.ledger?.entries).length===0&&list(state.ledger?.projects).length===0};
  if(baseline){
    for(const field of ['task','capture','block'])assertions[`protected${field[0].toUpperCase()+field.slice(1)}ExactHash`]=protection[field].sha256===baseline.protection[field].sha256;
    assertions.modulesExactHash=protection.workbench.modulesHash===baseline.protection.workbench.modulesHash;
    assertions.workbenchExactHash=protection.workbench.sha256===baseline.protection.workbench.sha256;
  }
  const summaries=blocks.slice(0,50).map(blockSummary),created=summaries.filter(block=>block.id!==FIXTURE.protectedBlockId);
  const checklist=created.find(block=>block.kind==='checklist'),miniapp=created.find(block=>block.kind==='miniapp');
  if(stage==='baseline')assertions.onlyProtectedBlock=blocks.length===1;
  else{
    Object.assign(assertions,{exactlyTwoCreatedBlocks:blocks.length===3&&created.length===2,
      oneChecklistAndOneMiniapp:same(created.map(block=>block.kind).sort(),[...blockKinds].sort()),
      createdBlocksNotArchived:created.every(block=>!block.archived),miniappCodeSyntaxOnly:miniapp?.codeSyntaxValid===true});
    if(stage==='created')Object.assign(assertions,{threeInitialChecklistItems:checklist?.items.length===3,initialChecklistAllUnfinished:checklist?.items.every(item=>item.done===false)===true});
    if(reference){
      const previous=reference.blocks.filter(block=>block.id!==FIXTURE.protectedBlockId),previousChecklist=previous.find(block=>block.kind==='checklist'),previousMiniapp=previous.find(block=>block.kind==='miniapp');
      const currentIds=created.map(block=>({id:block.id,kind:block.kind})).sort((a,b)=>a.id.localeCompare(b.id));
      const previousIds=previous.map(block=>({id:block.id,kind:block.kind})).sort((a,b)=>a.id.localeCompare(b.id));
      assertions.sameCreatedBlockIdsAndKinds=same(currentIds,previousIds);
      if(stage==='used')Object.assign(assertions,{
        threeUsedChecklistItems:checklist?.items.length===3,
        originalChecklistIdsAndLabels:checklist?.items.length===previousChecklist?.items.length&&previousChecklist?.items.every(item=>checklist?.items.some(current=>current.id===item.id&&current.label===item.label))===true,
        checklistUsed:checklist?.items.some(item=>item.done===true)===true,
        checklistConfigChanged:checklist?.configHash!==previousChecklist?.configHash,
        miniappDataNonEmpty:miniapp?.dataNonEmpty===true,miniappDataChanged:miniapp?.dataHash!==previousMiniapp?.dataHash,
        miniappCodeUnchangedDuringUse:miniapp?.codeHash===previousMiniapp?.codeHash});
      if(stage==='updated')Object.assign(assertions,{
        oneAdditionalChecklistItem:previousChecklist?.items.length===3&&checklist?.items.length===4,
        originalChecklistItemsPreserved:previousChecklist?.items.every(item=>checklist?.items.some(current=>same(current,item)))===true,
        miniappCodeChanged:miniapp?.codeHash!==previousMiniapp?.codeHash,
        miniappDataPreserved:miniapp?.dataHash===previousMiniapp?.dataHash,
        checklistDataPreserved:checklist?.dataHash===previousChecklist?.dataHash});
      if(stage==='reverted'||stage==='retained'){
        assertions.blockConfigsRestored=previous.every(block=>created.find(current=>current.id===block.id)?.configHash===block.configHash);
        assertions.blockDataPreserved=previous.every(block=>created.find(current=>current.id===block.id)?.dataHash===block.dataHash);
        if(stage==='retained')assertions.completeBlockRecordsRetained=previous.every(block=>created.find(current=>current.id===block.id)?.recordHash===block.recordHash);
      }
    }
  }
  const conversationRequests=list(state.aiRequests).filter(request=>request.conversation);
  return {development:'DEV-028',kind:KIND,stage,observedAt:new Date().toISOString(),origin:FIXTURE.origin,instanceId,
    baselineFingerprint:baseline?.baselineFingerprint||digest(protection),passed:Object.values(assertions).every(Boolean),assertions,protection,blocks:summaries,
    limitations:['Workspace snapshots do not prove UI interaction or miniapp execution.','Miniapp code is syntax-compiled only and never executed by this checker.'],
    summary:{captureCount:captures.length,taskCount:tasks.length,spaceCount:list(state.spaces).length,blockCount:blocks.length,enabledModuleIds:enabled,
      checklistItemCount:checklist?.items.length??0,checklistDoneCount:checklist?.items.filter(item=>item.done===true).length??0,miniappDataNonEmpty:miniapp?.dataNonEmpty??false,
      conversationCount:conversationRequests.length,conversations:conversationRequests.slice(0,8).map(request=>({id:text(request.id,160),status:text(request.status,40),
        messageCount:list(request.conversation.messages).length,userMessageCount:list(request.conversation.messages).filter(message=>message.role==='user').length,
        assistantMessageCount:list(request.conversation.messages).filter(message=>message.role==='assistant').length,
        hasReceipt:Object.hasOwn(request,'receipt'),hasPendingJob:Object.hasOwn(request.conversation,'pendingJobId'),
        hasConfirmedJob:Object.hasOwn(request.conversation,'confirmedJobId'),hasProposal:Object.hasOwn(request.conversation,'proposal')}))}};
}

async function boundedJson(response,maxBytes){
  const declared=Number(response.headers.get('content-length'));
  if(Number.isFinite(declared)&&declared>maxBytes){await response.body?.cancel();throw Error('RESPONSE_LIMIT');}
  if(!response.body?.getReader)throw Error('INVALID_RESPONSE');
  const reader=response.body.getReader(),chunks=[];let bytes=0;
  try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;
    if(bytes>maxBytes){await reader.cancel();throw Error('RESPONSE_LIMIT');}chunks.push(part.value);}}
  finally{reader.releaseLock();}
  try{return JSON.parse(Buffer.concat(chunks,bytes).toString('utf8'));}catch{throw Error('INVALID_RESPONSE');}
}

export async function readSyntheticSnapshot(){
  let cookie='',csrf='';
  const request=async(path,{method='GET',body,maxBytes=64*1024}={})=>{
    if(!['/api/instance','/api/auth/login','/api/workspace','/api/auth/logout'].includes(path))throw Error('UNAPPROVED_PATH');
    const response=await fetch(FIXTURE.origin+path,{method,redirect:'error',signal:AbortSignal.timeout(10000),headers:{
      ...(method==='POST'?{Origin:FIXTURE.origin}:{}),...(body?{'Content-Type':'application/json'}:{}),
      ...(cookie?{Cookie:cookie,...(csrf?{'X-CSRF-Token':csrf}:{})}:{})},...(body?{body:JSON.stringify(body)}:{})});
    if(!response.ok){await response.body?.cancel();throw Error('SYNTHETIC_API_FAILED');}
    const value=await boundedJson(response,maxBytes);
    if(path==='/api/auth/login'){
      cookie=response.headers.get('set-cookie')?.split(';')[0]||'';
      csrf=typeof value.csrfToken==='string'?value.csrfToken:'';
      if(!cookie||!csrf||value.username!==FIXTURE.username||value.authenticated!==true)throw Error('SYNTHETIC_LOGIN_FAILED');
    }
    return value;
  };
  try{
    const instance=await request('/api/instance');
    if(instance.application!=='czb-yuzhou'||!hashPattern.test(instance.instanceId||''))throw Error('UNEXPECTED_INSTANCE');
    await request('/api/auth/login',{method:'POST',body:{username:FIXTURE.username,password:FIXTURE.password}});
    const workspace=await request('/api/workspace',{maxBytes:13*1024*1024});
    if(!Number.isSafeInteger(workspace.revision)||!workspace.state)throw Error('INVALID_WORKSPACE_ENVELOPE');
    if(workspace.state.profile?.name!==SEED.profileName||workspace.state.profile?.major!==SEED.profileMajor)throw Error('NOT_DEV028_SYNTHETIC_STATE');
    return {instanceId:instance.instanceId,revision:workspace.revision,state:workspace.state};
  }finally{
    if(cookie&&csrf){try{await request('/api/auth/logout',{method:'POST'});}finally{cookie='';csrf='';}}
  }
}

function readReport(path){
  const resolved=assertOrdinaryPath(resolve(ROOT,path),EVIDENCE);
  if(!/^DEV-028-workspace-(baseline|created|used|updated|reverted|retained)-[A-Za-z0-9.-]+\.json$/.test(basename(resolved))||statSync(resolved).size>128*1024)throw Error('INVALID_REPORT_FILE');
  return {report:JSON.parse(readFileSync(resolved,'utf8')),path:resolved};
}

async function main(){
  const args=process.argv.slice(2),options={};
  for(let index=0;index<args.length;index++){
    const key={'--stage':'stage','--baseline':'baselineFile','--reference':'referenceFile'}[args[index]];
    if(!key||options[key]||!args[index+1]||args[index+1].startsWith('--'))throw Error('INVALID_ARGUMENTS');options[key]=args[++index];
  }
  const {stage,baselineFile,referenceFile}=options;
  if(!STAGES.has(stage)||(stage==='baseline'&&(baselineFile||referenceFile))||(stage!=='baseline'&&!baselineFile)||
    (!!REFERENCES[stage]!==!!referenceFile))throw Error('INVALID_STAGE_ARGUMENTS');
  const loadedBaseline=baselineFile?readReport(baselineFile):undefined,loadedReference=referenceFile?readReport(referenceFile):undefined;
  const snapshot=await readSyntheticSnapshot();
  const report=checkSyntheticWorkspace(snapshot.state,{stage,instanceId:snapshot.instanceId,baseline:loadedBaseline?.report,reference:loadedReference?.report});
  Object.assign(report,{workspaceRevision:snapshot.revision,...(loadedBaseline?{baselineReport:basename(loadedBaseline.path)}:{}),...(loadedReference?{referenceReport:basename(loadedReference.path)}:{})});
  assertOrdinaryPath(EVIDENCE,ROOT);mkdirSync(EVIDENCE,{recursive:true});
  const reportPath=assertOrdinaryPath(join(EVIDENCE,`DEV-028-workspace-${stage}-${report.observedAt.replaceAll(':','-').replaceAll('.','-')}-${randomUUID().slice(0,8)}.json`),ROOT);
  writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
  process.stdout.write(JSON.stringify({stage,passed:report.passed,workspaceRevision:snapshot.revision,
    failedAssertions:Object.entries(report.assertions).filter(([,passed])=>!passed).map(([name])=>name),summary:report.summary,blocks:report.blocks,reportPath},null,2)+'\n');
  if(!report.passed)process.exitCode=1;
}

if(isCliEntry(import.meta.url))main().catch(()=>{process.stderr.write('DEV-028 read-only check failed before completion; inspect stage, same-instance baseline/reference, and synthetic service availability.\n');process.exitCode=1;});
