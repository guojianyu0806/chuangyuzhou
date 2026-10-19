import test from 'node:test';
import assert from 'node:assert/strict';
import fs,{mkdtempSync,rmSync} from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validateWorkspaceQueries,runWorkspaceQuery,workspaceFingerprint} from '../workspace-queries.mjs';
import {buildPrompt,createHermesService} from '../hermes.mjs';

const NOW='2026-10-08T16:30:00.000Z'; // 2026-10-09 00:30 in Beijing.
const metadata=id=>({id,archived:false,createdAt:NOW,updatedAt:NOW});
const item=(id,patch={})=>({...metadata(id),title:`比赛${id}`,organizer:'',category:'',url:'',team:'',requirements:'',notes:'',status:'preparing',color:'#AE88FF',...patch});
const milestone=(id,patch={})=>({...metadata(id),competitionId:'one',title:`节点${id}`,date:'2026-10-09',time:'',done:false,...patch});
const task=(id,patch={})=>({...metadata(id),competitionId:'one',title:`任务${id}`,date:'',notes:'',done:false,...patch});
const fixture=()=>({competitions:{version:1,items:[item('one'),item('two'),item('finished',{status:'finished'}),item('archived',{archived:true})],milestones:[
  milestone('yesterday',{date:'2026-10-08'}),milestone('today'),milestone('timed',{time:'00:00'}),milestone('week',{date:'2026-10-16'}),milestone('later',{date:'2026-10-17'}),
  milestone('done',{done:true,date:'2026-10-08'}),milestone('hidden',{archived:true,date:'2026-10-08'}),milestone('other',{competitionId:'two',date:'2026-10-08'}),milestone('ended',{competitionId:'finished',date:'2026-10-08'}),milestone('parent-hidden',{competitionId:'archived',date:'2026-10-08'}),
],tasks:[task('pending'),task('completed',{done:true}),task('task-archived',{archived:true}),task('task-other',{competitionId:'two'}),task('task-ended',{competitionId:'finished'})]}});
const query=competitionId=>validateWorkspaceQueries([{kind:'competitions.summary',...(competitionId?{competitionId}:{})}])[0];

test('competition summary uses actual Beijing time, exact deadlines and one parent scope',async()=>{
  const state=fixture(),before=JSON.stringify(state),result=await runWorkspaceQuery(state,query('one'),{now:NOW});
  assert.equal(result.today,'2026-10-09');assert.equal(result.timeZone,'Asia/Shanghai');assert.equal(result.asOf,NOW);
  assert.deepEqual(result.totals,{active:1,upcoming:2,overdue:2,unfinishedTasks:1,completedTasks:1});assert.equal(result.deadlineCount,5);
  assert.equal(result.deadlines.find(row=>row.id==='today').state,'today');assert.equal(result.deadlines.find(row=>row.id==='timed').state,'overdue');
  assert.deepEqual(result.progress[0],{id:'one',title:'比赛one',status:'preparing',done:1,total:2,percent:50});assert.equal(JSON.stringify(state),before);
  const all=await runWorkspaceQuery(state,query(),{now:NOW});assert.equal(all.totals.active,2);assert.equal(all.totals.overdue,3);assert.equal(all.totals.unfinishedTasks,2);
  const archived=await runWorkspaceQuery(state,query('archived'),{now:NOW});assert.equal(archived.totals.active,0);assert.equal(archived.competition.archived,true);assert.equal(archived.deadlineCount,0);
  const late=await runWorkspaceQuery(state,query('one'),{now:'2026-10-09T16:00:00.000Z'});assert.equal(late.deadlines.find(row=>row.id==='today').state,'overdue');
});

test('competition summary rejects fake dates and IDs, and calculates all records before truncating detail',async()=>{
  for(const extra of [{today:'2030-01-01'},{date:'2026-10-01'},{asOf:'2026-01-01'},{archived:'all'},{competitionId:''}])assert.throws(()=>validateWorkspaceQueries([{kind:'competitions.summary',...extra}]));
  await assert.rejects(()=>runWorkspaceQuery(fixture(),query('missing'),{now:NOW}),/不存在/);
  const state=fixture();state.competitions.milestones=Array.from({length:160},(_,i)=>milestone(`bulk-${i}`));
  const result=await runWorkspaceQuery(state,query('one'),{now:NOW});assert.equal(result.totals.upcoming,160);assert.equal(result.deadlines.length,100);assert.equal(result.deadlineCount,160);assert.equal(result.deadlinesTruncated,true);assert.equal(result.computedFromAllMatchingEntries,true);
});

test('generic search/get reads real competition children and all competition changes invalidate review',async()=>{
  const state=fixture();const [search]=validateWorkspaceQueries([{kind:'search',entity:'competitionTask',containerId:'one',done:false}]);
  const found=await runWorkspaceQuery(state,search);assert.equal(found.total,1);assert.equal(found.items[0].id,'pending');
  const [get]=validateWorkspaceQueries([{kind:'get',entity:'competitionMilestone',id:'week',containerId:'one'}]);const record=await runWorkspaceQuery(state,get);assert.equal(record.record.date,'2026-10-16');
  const original=workspaceFingerprint(state);state.competitions.tasks[0].done=true;assert.notEqual(workspaceFingerprint(state),original);
  const prompt=buildPrompt({text:'报名比赛',sources:[],destinations:[],destinationId:'workspace',kind:'conversation'});assert.match(prompt.system,/不能凭常识、往届日期/);assert.match(prompt.system,/真实北京时间/);assert.match(prompt.system,/聊天里的同意或确认不会直接写入/);
  const payload=JSON.parse(prompt.user);assert.ok(payload.workspaceQueryCapabilities.some(row=>row.kind==='competitions.summary'));assert.equal(payload.workspaceActionCapabilities.filter(row=>row.entity.startsWith('competition')).length,3);
});

function serviceFixture(t,runModel){
  const dataDir=mkdtempSync(join(tmpdir(),'universe-competitions-ai-'));let state={aiRequests:[],courses:[],spaces:[],tasks:[],captures:[],competitions:{version:1,items:[],milestones:[],tasks:[]}},revision=1;
  const ioErrors=[];
  // The production API deliberately redacts internal errors. Record only safe
  // filesystem error metadata for this synthetic fixture so regressions identify
  // their real cause instead of looking like a provider outage.
  for(const operation of ['writeFileSync','renameSync','chmodSync']){
    const original=fs[operation];
    t.mock.method(fs,operation,(...args)=>{try{return original(...args);}catch(error){if(String(args[0]).startsWith(dataDir))ioErrors.push({operation,code:error.code,syscall:error.syscall});throw error;}});
  }
  syncBuiltinESMExports();
  const store={getWorkspace:()=>({state:structuredClone(state),revision}),saveWorkspace:(base,value)=>{assert.equal(base,revision);state=structuredClone(value);return {revision:++revision};},fileInfo:()=>null,filePath:id=>join(dataDir,id)};
  const service=createHermesService({dataDir,store,engineAvailable:()=>true,runModel});
  t.after(()=>{service.close();t.mock.restoreAll();syncBuiltinESMExports();assert.ok(dataDir.startsWith(join(tmpdir(),'universe-competitions-ai-')));rmSync(dataDir,{recursive:true,force:true});});
  async function call(method,path,body){let response;assert.equal(await service.handle({method},{},{url:new URL(path,'https://localhost'),readJson:async()=>body,json:(_res,status,value)=>{response={status,body:structuredClone(value)};}}),true);return response;}
  async function finish(id){for(let n=0;n<100;n++){const result=await call('GET',`/api/ai/jobs/${id}`);if(['succeeded','failed'].includes(result.body.job.status))return result.body.job;await new Promise(resolve=>setTimeout(resolve,3));}assert.fail('Competition AI fixture timed out');}
  return {call,finish,state:()=>state,change:fn=>{fn(state);revision++;},ioErrors};
}
const plan=()=>({title:'比赛准备',summary:'新增比赛、提交节点和材料任务，等待审核。',destinationId:'workspace',reason:'按用户明确要求',warnings:[],actions:[
  {entity:'competition',operation:'create',ref:'contest',data:{title:'软件设计大赛'}},
  {entity:'competitionMilestone',operation:'create',containerId:'$contest',data:{title:'提交作品',date:'2026-10-15'}},
  {entity:'competitionTask',operation:'create',containerId:'$contest',data:{title:'整理材料'}},
]});
async function ready(t){
  let calls=0;const f=serviceFixture(t,async input=>{
    const data=JSON.parse(input.user);calls++;if(calls===1)return {reply:'先查已有比赛。',proposal:null,queries:[{kind:'search',entity:'competition',text:'软件设计'}]};
    assert.equal(data.workspaceQueryResults[0].result.total,0);return {reply:'聊天确认不会执行，请核对后点击按钮。',proposal:plan()};
  });
  assert.equal((await f.call('PUT','/api/model/config',{provider:'deepseek',model:'deepseek-flash',apiKey:'offline-no-provider-request'})).status,200);
  const text='确认创建软件设计大赛，通知提交日期2026-10-15，帮我加材料准备任务。';
  f.change(state=>state.aiRequests.push({id:'request-1',text,targetId:'auto',files:[],status:'waiting_model',createdAt:NOW,updatedAt:NOW,conversation:{version:1,messages:[{id:'turn-1',role:'user',text,createdAt:NOW}]}}));
  const start=await f.call('POST','/api/ai/jobs',{requestId:'request-1',turnId:'turn-1',text,kind:'conversation',autoFile:true});assert.equal(start.status,202);
  const job=await f.finish(start.body.job.id);assert.equal(job.status,'succeeded',JSON.stringify({error:job.error,ioErrors:f.ioErrors}));assert.equal(f.state().competitions.items.length,0);assert.equal(job.queryRounds,1);
  return {f,job};
}

test('AI competition conversation queries then reviews without writes until an idempotent confirm button request',async t=>{
  const {f,job}=await ready(t),confirmed=await f.call('POST',`/api/ai/jobs/${job.id}/confirm`,{});assert.equal(confirmed.status,200,JSON.stringify(confirmed.body));
  assert.equal(f.state().competitions.items.length,1);assert.equal(f.state().competitions.tasks.length,1);assert.equal(f.state().competitions.milestones.length,1);assert.equal(f.state().tasks.length,0);
  const again=await f.call('POST',`/api/ai/jobs/${job.id}/confirm`,{});assert.equal(again.status,200);assert.deepEqual(again.body.receipt,confirmed.body.receipt);assert.equal(f.state().competitions.items.length,1);
});

test('a competition change after review makes confirmation stale without overwriting it',async t=>{
  const {f,job}=await ready(t);f.change(state=>state.competitions.items.push(item('later')));
  const confirmed=await f.call('POST',`/api/ai/jobs/${job.id}/confirm`,{});assert.equal(confirmed.status,409);assert.equal(confirmed.body.error,'STALE_PROPOSAL');assert.equal(f.state().competitions.items.length,1);assert.equal(f.state().competitions.tasks.length,0);
});
