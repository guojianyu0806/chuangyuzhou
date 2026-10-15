// Read-only business-state acceptance. Login/logout manage only this script's synthetic session.
import {readFileSync,writeFileSync,mkdirSync,statSync} from 'node:fs';
import {resolve,join,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {FIXTURE,createSyntheticState} from './browser-dev027-fixture.mjs';
import {projectCalendarLinks} from '../yuzhou/frontend/src/calendar-links.js';
import {validateWorkspace} from '../yuzhou/backend/store.mjs';
import {assertOrdinaryPath} from '../yuzhou/runtime.mjs';
import {isCliEntry} from '../yuzhou/backend/is-cli.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const EVIDENCE=join(ROOT,'evidence','engineering');
const STAGES=new Set(['before','confirmed','undone']);
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
  ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const digest=value=>createHash('sha256').update(JSON.stringify(canonical(value??null))).digest('hex');
const same=(left,right)=>JSON.stringify(canonical(left))===JSON.stringify(canonical(right));
const safeText=value=>typeof value==='string'?value.replace(/[\x00-\x1f\x7f]/g,' ').slice(0,180):'';
const subset=(record,expected)=>!!record&&Object.entries(expected).filter(([key])=>!['createdAt','updatedAt'].includes(key)).every(([key,value])=>same(record[key],value));

export function checkSyntheticWorkspace(state,{stage,baseline}={}){
  if(!STAGES.has(stage))throw Error('INVALID_STAGE');
  if(state?.profile?.name!=='DEV-027 合成验收'||state?.profile?.major!=='测试资料，非正式账号')throw Error('NOT_DEV027_SYNTHETIC_STATE');
  if(stage!=='before'&&(!baseline||baseline.development!=='DEV-027'||baseline.stage!=='before'||baseline.passed!==true))throw Error('VALID_BEFORE_BASELINE_REQUIRED');
  const expected=createSyntheticState('2026-10-15T00:00:00.000Z');
  const tasks=state.tasks||[],captures=state.captures||[],spaces=state.spaces||[];
  const protectedTasks=tasks.filter(row=>row.id===FIXTURE.protectedTaskId),protectedCaptures=captures.filter(row=>row.id===FIXTURE.captureId);
  const task=protectedTasks[0],capture=protectedCaptures[0],newTasks=tasks.filter(row=>row.id!==FIXTURE.protectedTaskId);
  const enabled=(state.workbench?.modules||[]).filter(row=>row.enabled).map(row=>row.id).sort();
  const protection={task:{id:FIXTURE.protectedTaskId,sha256:digest(task)},capture:{id:FIXTURE.captureId,sha256:digest(capture)},
    workbench:{sha256:digest(state.workbench),enabledModuleIds:enabled}};
  let schemaValid=true;try{validateWorkspace(state);}catch{schemaValid=false;}
  const assertions={schemaValid,onlySyntheticIdentity:state.workbench?.title==='DEV-027 合成 AI 验收',
    protectedTaskPresent:protectedTasks.length===1,protectedCapturePresent:protectedCaptures.length===1,
    protectedTaskContent:subset(task,expected.tasks[0]),protectedCaptureContent:subset(capture,expected.captures[0]),
    protectedTaskUnfinished:task?.done===false&&task?.archived===false,
    oneSourceCapture:captures.length===1,nativeCalendarEventsZero:(state.calendar?.events||[]).length===0,
    coursesStillEmpty:(state.courses||[]).length===0,customBlocksStillEmpty:(state.customBlocks?.items||[]).length===0};
  if(baseline){
    assertions.protectedTaskExactHash=protection.task.sha256===baseline.protection?.task?.sha256;
    assertions.protectedCaptureExactHash=protection.capture.sha256===baseline.protection?.capture?.sha256;
  }
  const projections=projectCalendarLinks(state);
  if(stage==='confirmed'){
    const space=spaces[0],createdTask=newTasks[0],notes=space?.notes||[];
    Object.assign(assertions,{oneNewSpace:spaces.length===1&&space?.archived!==true,
      oneNoteInSpace:notes.length===1&&typeof notes[0]?.content==='string'&&notes[0].content.trim().length>0,
      oneNewTask:newTasks.length===1,taskBelongsToSpace:!!space&&createdTask?.spaceId===space.id,
      speechTaskTitle:typeof createdTask?.title==='string'&&createdTask.title.includes('讲稿'),
      revisedDateIs26:createdTask?.date==='2026-10-26',taskHighPriority:createdTask?.priority==='high',
      newTaskUnfinished:createdTask?.done===false&&createdTask?.archived===false,
      tasksCalendarEnabled:same(enabled,['ai','calendar','tasks']),
      taskCalendarProjection:projections.filter(row=>row.sourceId===createdTask?.id&&row.entity==='task'&&row.startDate==='2026-10-26'&&row.parentId===space?.id).length===1,
      oneLinkedCalendarItem:projections.length===1});
  }else{
    Object.assign(assertions,{noCreatedSpaces:spaces.length===0,noCreatedTasks:newTasks.length===0,
      blankModulesRestored:same(enabled,['ai']),noLinkedCalendarItems:projections.length===0});
    if(stage==='undone')assertions.workbenchExactHash=protection.workbench.sha256===baseline.protection?.workbench?.sha256;
  }
  return {development:'DEV-027',kind:'read-only-synthetic-workspace-check',stage,observedAt:new Date().toISOString(),origin:FIXTURE.origin,
    passed:Object.values(assertions).every(Boolean),assertions,protection,
    summary:{captureCount:captures.length,taskCount:tasks.length,spaceCount:spaces.length,nativeCalendarEventCount:(state.calendar?.events||[]).length,
      enabledModuleIds:enabled,spaces:spaces.slice(0,3).map(row=>({id:safeText(row.id),title:safeText(row.title),noteCount:(row.notes||[]).length,
        notes:(row.notes||[]).slice(0,3).map(note=>({id:safeText(note.id),title:safeText(note.title)}))})),
      newTasks:newTasks.slice(0,3).map(row=>({id:safeText(row.id),title:safeText(row.title),spaceId:safeText(row.spaceId),date:safeText(row.date),priority:safeText(row.priority)})),
      linkedCalendarItems:projections.slice(0,3).map(row=>({entity:safeText(row.entity),sourceId:safeText(row.sourceId),date:safeText(row.startDate),parentId:safeText(row.parentId)}))}};
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
    if(instance.application!=='czb-yuzhou'||!/^\w{64}$/.test(instance.instanceId||''))throw Error('UNEXPECTED_INSTANCE');
    await request('/api/auth/login',{method:'POST',body:{username:FIXTURE.username,password:FIXTURE.password}});
    const workspace=await request('/api/workspace',{maxBytes:13*1024*1024});
    if(!Number.isSafeInteger(workspace.revision)||!workspace.state)throw Error('INVALID_WORKSPACE_ENVELOPE');
    return {instanceId:instance.instanceId,revision:workspace.revision,state:workspace.state};
  }finally{
    if(cookie&&csrf){try{await request('/api/auth/logout',{method:'POST'});}finally{cookie='';csrf='';}}
  }
}

function readBaseline(path){
  const resolved=assertOrdinaryPath(resolve(ROOT,path),EVIDENCE);
  if(!/^DEV-027-workspace-before-[A-Za-z0-9.-]+\.json$/.test(basename(resolved))||statSync(resolved).size>64*1024)throw Error('INVALID_BASELINE_FILE');
  const baseline=JSON.parse(readFileSync(resolved,'utf8'));
  if(baseline.stage!=='before'||baseline.passed!==true||baseline.development!=='DEV-027')throw Error('VALID_BEFORE_BASELINE_REQUIRED');
  return {baseline,path:resolved};
}

async function main(){
  const args=process.argv.slice(2);let stage,baselineFile;
  for(let index=0;index<args.length;index++){
    if(args[index]==='--stage')stage=args[++index];else if(args[index]==='--baseline')baselineFile=args[++index];else throw Error('INVALID_ARGUMENTS');
  }
  if(!STAGES.has(stage)||(stage!=='before'&&!baselineFile)||(stage==='before'&&baselineFile))throw Error('Use --stage before, or --stage confirmed|undone --baseline <before-report>.');
  const loaded=baselineFile?readBaseline(baselineFile):undefined;
  const snapshot=await readSyntheticSnapshot();
  if(loaded&&loaded.baseline.instanceId!==snapshot.instanceId)throw Error('BASELINE_BELONGS_TO_ANOTHER_INSTANCE');
  const report=checkSyntheticWorkspace(snapshot.state,{stage,baseline:loaded?.baseline});
  Object.assign(report,{instanceId:snapshot.instanceId,workspaceRevision:snapshot.revision,...(loaded?{baselineReport:basename(loaded.path)}:{})});
  assertOrdinaryPath(EVIDENCE,ROOT);mkdirSync(EVIDENCE,{recursive:true});
  const reportPath=assertOrdinaryPath(join(EVIDENCE,`DEV-027-workspace-${stage}-${report.observedAt.replaceAll(':','-').replaceAll('.','-')}-${randomUUID().slice(0,8)}.json`),ROOT);
  writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
  process.stdout.write(JSON.stringify({stage,passed:report.passed,workspaceRevision:snapshot.revision,
    failedAssertions:Object.entries(report.assertions).filter(([,passed])=>!passed).map(([name])=>name),summary:report.summary,reportPath},null,2)+'\n');
  if(!report.passed)process.exitCode=1;
}

if(isCliEntry(import.meta.url))main().catch(()=>{process.stderr.write('DEV-027 read-only check failed before completion; inspect stage, baseline, and synthetic service availability.\n');process.exitCode=1;});
