import test from 'node:test';
import assert from 'node:assert/strict';
import {runWorkspaceQuery,validateWorkspaceQueries,workspaceFingerprint,boundQueryResult,WORKSPACE_QUERY_CAPABILITIES} from '../workspace-queries.mjs';
import {buildPrompt} from '../hermes.mjs';
const stamp='2026-09-21T00:00:00.000Z';
function fixture(){return {spaces:[],courses:[],tasks:[],captures:[],english:{plan:{dailyMinutes:'20'},words:[{id:'w1',word:'test',status:'mastered'},{id:'w2',word:'old',status:'review',archived:true}],sessions:[{id:'s1',date:'2026-09-20',minutes:20},{id:'s2',date:'2026-09-21',minutes:30},{id:'s3',date:'2026-09-21',minutes:100,archived:true}],mistakes:[]},ledger:{projects:[{id:'trip',title:'国庆出游',includeInTotal:false},{id:'club',title:'学生会',includeInTotal:true}],entries:[['a','',1200,'expense'],['b','trip',2550,'expense'],['c','club',3300,'expense'],['d','trip',500,'income']].map(([id,projectId,amountCents,type])=>({id,projectId,amountCents,type,category:'餐饮',note:'真实记录',date:'2026-10-01',createdAt:stamp,updatedAt:stamp,archived:false}))},aiRequests:[]};}
test('ledger query calculates all exact fen records and honors independent project accounting',async()=>{
 const state=fixture();const before=JSON.stringify(state);
 for(const [scope,expense,count] of [['total',4500,2],['daily',1200,1],['projects',5850,3],['all',7050,4]]){
  const result=await runWorkspaceQuery(state,{kind:'ledger.summary',scope});assert.equal(result.totals.expenseCents,expense);assert.equal(result.totals.count,count);assert.equal(result.computedFromAllMatchingEntries,true);
 }
 const project=await runWorkspaceQuery(state,{kind:'ledger.summary',projectId:'trip',groupBy:'date'});assert.equal(project.totals.expense,'25.50');assert.equal(project.totals.netCents,-2050);assert.equal(project.groups[0].id,'2026-10-01');
 assert.equal((await runWorkspaceQuery(state,{kind:'ledger.summary',start:'2026-10-02'})).totals.count,0);assert.equal(JSON.stringify(state),before);
});
test('search/get give actual IDs, pagination, archive filters and no guessed records',async()=>{
 const state=fixture();state.tasks=Array.from({length:30},(_,i)=>({id:'task-'+i,title:'复习 '+i,done:i%2===0,archived:i===29}));
 const first=await runWorkspaceQuery(state,{kind:'search',entity:'task',limit:10});assert.equal(first.total,29);assert.equal(first.hasMore,true);assert.equal(first.items[0].id,'task-0');
 assert.equal((await runWorkspaceQuery(state,{kind:'search',entity:'task',done:true})).total,15);
 assert.equal((await runWorkspaceQuery(state,{kind:'search',entity:'task',archived:true})).items[0].id,'task-29');
 assert.equal((await runWorkspaceQuery(state,{kind:'get',entity:'task',id:'task-8'})).record.title,'复习 8');
 await assert.rejects(runWorkspaceQuery(state,{kind:'get',entity:'task',id:'missing'}));
});
test('calendar overlaps are independent from timetable and English counts only actual unarchived records',async()=>{
 const state=fixture();state.calendar={events:[{id:'e1',title:'旅行',startDate:'2026-10-01',endDate:'2026-10-07',startTime:'',kind:'plan'},{id:'e2',title:'旧事件',startDate:'2026-10-03',endDate:'2026-10-03',startTime:'',archived:true}]};
 const events=await runWorkspaceQuery(state,{kind:'calendar.range',start:'2026-10-03',end:'2026-10-04'});assert.equal(events.total,1);assert.equal(events.items[0].id,'e1');
 state.timetable={activeTermId:'autumn',terms:[{id:'autumn',title:'秋季',weekOne:'2026-08-31',totalWeeks:20,periods:[{id:1,start:'08:30',end:'09:15'}],entries:[{id:'t1',title:'软件工程',weekday:1,startPeriod:1,endPeriod:1,weeks:[1,3]}]}]};
 const week=await runWorkspaceQuery(state,{kind:'timetable.week',date:'2026-09-14'});assert.equal(week.week,3);assert.equal(week.items[0].date,'2026-09-14');assert.equal((await runWorkspaceQuery(state,{kind:'timetable.week',week:2})).items.length,0);
 const english=await runWorkspaceQuery(state,{kind:'english.status',start:'2026-09-21'});assert.equal(english.minutes,30);assert.equal(english.wordCount,1);assert.equal(english.wordStatuses.mastered,1);
});
test('file read is workspace allowlisted and responses carry truncation instead of claiming full content',async()=>{
 const state=fixture();state.aiRequests=[{id:'r1',files:[{id:'f',blobId:'b',name:'课程.txt'}]}];let reads=0;
 await assert.rejects(runWorkspaceQuery(state,{kind:'file.read',blobId:'unknown'},{readFile:async()=>{reads++;}}));assert.equal(reads,0);
 const file=await runWorkspaceQuery(state,{kind:'file.read',blobId:'b'},{readFile:async id=>{assert.equal(id,'b');return {units:[{label:'原文',text:'x'.repeat(10000)}]};}});assert.match(file.units[0].text,/后续内容未提供/);
 const result=boundQueryResult({items:Array.from({length:70},(_,i)=>({id:i,text:'x'.repeat(6000)})),total:70});assert.equal(result.truncated,true);assert.equal(result.hasMore,true);assert.ok(JSON.stringify(result).length<=36000);
});
test('query schema rejects arbitrary code/paths, malformed filters; fingerprint excludes conversations only',()=>{
 for(const q of [{kind:'shell',command:'whoami'},{kind:'file.read',path:'/etc/passwd'},{kind:'get',entity:'password',id:'1'},{kind:'ledger.summary',start:'2026-02-30'},{kind:'search',limit:51},{kind:'calendar.range',start:'2026-10-05',end:'2026-10-01'}])assert.throws(()=>validateWorkspaceQueries([q]));
 const state=fixture(),original=workspaceFingerprint(state);state.aiRequests.push({id:'r',text:'hello'});assert.equal(workspaceFingerprint(state),original);state.tasks.push({id:'t',title:'其他设备添加'});assert.notEqual(workspaceFingerprint(state),original);
});

test('published query schemas and examples describe only accepted fields and omit empty optional filters',()=>{
 const prompt=buildPrompt({text:'看看工作台',sources:[],destinations:[],destinationId:'auto',kind:'conversation'});
 const capabilities=JSON.parse(prompt.user).workspaceQueryCapabilities;
 for(const capability of capabilities){
  assert.equal(capability.schema.additionalProperties,false);
  assert.equal(capability.schema.properties.kind.const,capability.kind);
  assert.ok(capability.schema.required.includes('kind'));
  for(const example of capability.examples||[])assert.deepEqual(validateWorkspaceQueries([example]),[example]);
 }
 const search=capabilities.find(row=>row.kind==='search');
 assert.deepEqual(Object.keys(search.schema.properties),['kind','entity','text','containerId','archived','done','offset','limit']);
 assert.deepEqual(search.schema.properties.archived.enum,[false,true,'all']);
 assert.ok(search.examples.some(example=>example.entity==='task'&&!Object.hasOwn(example,'text')));
 assert.ok(capabilities.find(row=>row.kind==='get').examples.some(example=>example.entity==='workbenchModule'&&example.id==='tasks'));
 assert.match(prompt.system,/省略.*text/);assert.match(prompt.system,/containerId.*路由/);
 assert.match(prompt.system,/workspaceOverview\.workbench\.modules/);
 assert.deepEqual(capabilities,WORKSPACE_QUERY_CAPABILITIES);
});

test('query correction errors locate all affected queries without echoing values or unsafe field names',()=>{
 assert.throws(()=>validateWorkspaceQueries([
  {kind:'search',entity:'task',text:''},
  {kind:'search',entity:'space',all:'private-field-value'},
  {kind:'search',entity:'capture',containerId:null},
 ]),error=>{
  assert.match(error.message,/queries\[0\]\.text/);assert.match(error.message,/queries\[1\]\.all/);assert.match(error.message,/queries\[2\]\.containerId/);
  assert.match(error.message,/省略/);assert.doesNotMatch(error.message,/private-field-value/);assert.ok(error.message.length<=1200);return true;
 });
 for(const key of ['authorization','apiKey','sk_private_credential','unsafe\nfield','x'.repeat(400)]){
  assert.throws(()=>validateWorkspaceQueries([{kind:'search',[key]:'private-field-value'}]),error=>{
   assert.match(error.message,/queries\[0\]/);assert.doesNotMatch(error.message,/private-field-value/);assert.ok(!error.message.includes(key));assert.ok(error.message.length<=1200);return true;
  });
 }
 assert.throws(()=>validateWorkspaceQueries([{kind:'search',entity:'task',text:'   '}]),/queries\[0\]\.text/);
 assert.throws(()=>validateWorkspaceQueries([{kind:'get',entity:'task',id:null}]),/queries\[0\]\.id/);
 assert.deepEqual(validateWorkspaceQueries([{kind:'ledger.summary',scope:' daily ',groupBy:' category '}]),[{kind:'ledger.summary',scope:'daily',groupBy:'category'}]);
});
