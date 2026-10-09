import {createHash} from 'node:crypto';
import {listWorkspaceRecords,WORKSPACE_ACTION_CAPABILITIES} from '../frontend/src/workspace-actions.js';
import {selectEntries,summarizeEntries,formatMoney,isValidDate} from '../frontend/src/ledger-model.js';
import {entriesForWeek,weekForDate,dateForWeek,periodTime} from '../frontend/src/timetable-model.js';
import {selectFitnessEntries,summarizeFitness,fitnessRange} from '../frontend/src/fitness-model.js';
import {competitionToday,deadlineStatus,summarizeCompetitions,competitionProgress} from '../frontend/src/competitions-model.js';
import {projectCalendarLinks} from '../frontend/src/calendar-links.js';
import {WORKBENCH_MODULES,WORKBENCH_TEMPLATES,createWorkbench,validateWorkbench} from '../frontend/src/workbench-model.js';

export const WORKSPACE_QUERY_CAPABILITIES=[
 {kind:'search',label:'搜索工作台',description:'entity可省略；text关键词；可筛containerId、archived(false默认/true/all)、done；offset默认0，limit默认20最多50；返回真实编号和分页总数。'},
 {kind:'get',label:'读取记录详情',description:'必须entity、id；note/file/timetableEntry用containerId区分；返回完整内容（超长会注明截断）。'},
 {kind:'ledger.summary',label:'计算收支',description:'scope:total默认(遵守项目总账设置)/daily/projects/all；projectId指定已有项目；start/end为YYYY-MM-DD；groupBy:category/project/date；程序计算精确到分，默认不含归档账目。'},
 {kind:'calendar.range',label:'查询日历与关联事项',description:'start和end为YYYY-MM-DD；默认汇总日历原安排、带日期的备忘待办、比赛节点与任务、六级考试日期。可source:all/calendar/tasks/competitions/english、kindFilter:plan/mark/note（筛全部来源：待办/比赛任务/六级为plan，比赛节点为mark）、done、archived(false默认/true/all)。归档只查询日历原安排，关联来源只显示未归档父子；不含学期课表、账单或运动学习日志。返回真实entity/id/containerId用于修改源记录；containerId为空时在后续查询/行动里省略该字段。display为只读日期展示，不可拿display.id当行动编号。'},
 {kind:'timetable.week',label:'查询一周课表',description:'termId可省略使用当前学期；week为整数或date为YYYY-MM-DD；返回当周课程、实际日期、作息时间。'},
 {kind:'english.status',label:'查询六级学习情况',description:'start/end可选，返回计划、词汇掌握统计、错题数和程序计算的学习时长，不编造学习记录。'},
 {kind:'fitness.summary',label:'计算运动统计',description:'spaceId必填真实空间id，只计算该空间；start/end可选YYYY-MM-DD，或用date与period=day|week|month选择完整日/周/月（不能与start/end混用）；archived=false默认/true/all。程序汇总全部匹配记录的次数、分钟、已知公里/千卡及缺失计数，不估算热量，不把null当零，不把计划记作实际运动。'},
 {kind:'competitions.summary',label:'查询比赛进度与截止',description:'competitionId可选真实比赛id，否则统计所有进行中的比赛（排除归档/已结束比赛、归档子项）；程序依据查询时真实北京时间计算今天及未来7天临期、逾期节点和任务完成数。无具体时刻节点在北京时间次日零点才逾期。不可传today/date/asOf伪造当前时间。汇总覆盖所有符合条件的记录；明细过多时截断并注明。仅依据已保存信息，不保证官方安排最新。'},
 {kind:'file.read',label:'读取已有资料文字',description:'blobId必须来自已保存或本次对话附件；提取已上传资料文字，不能读取服务器路径或任意网址。'}
];
const fail=message=>{throw new Error(message);};
const object=value=>value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const entities=()=>new Set(WORKSPACE_ACTION_CAPABILITIES.map(c=>c.entity));
function text(value,max,required=false){if(typeof value!=='string'||value.length>max||(required&&!value.trim()))fail('查询文字格式无效。');return value.trim();}
export function validateWorkspaceQueries(value){
 if(!Array.isArray(value)||!value.length||value.length>6)fail('每轮查询须为1至6项。');
 return value.map(q=>{
  if(!object(q)||!WORKSPACE_QUERY_CAPABILITIES.some(c=>c.kind===q.kind))fail('不支持这个工作台查询。');
  const allowed={search:['entity','text','containerId','archived','done','offset','limit'],get:['entity','id','containerId'],'ledger.summary':['scope','projectId','start','end','groupBy','archived'],'calendar.range':['start','end','kindFilter','source','done','archived','offset','limit'],'timetable.week':['termId','week','date'],'english.status':['start','end'],'fitness.summary':['spaceId','start','end','date','period','archived'],'competitions.summary':['competitionId'],'file.read':['blobId']}[q.kind];
  if(Object.keys(q).some(k=>k!=='kind'&&!allowed.includes(k)))fail('查询包含不支持的字段。');
  const result={kind:q.kind};
  for(const key of ['entity','text','containerId','id','projectId','spaceId','competitionId','termId','scope','groupBy','kindFilter','source','blobId','period'])if(q[key]!==undefined)result[key]=text(q[key],key==='text'?300:256,true);
  if(result.entity&&!entities().has(result.entity))fail('查询的记录类型不存在。');
  if(q.kind==='get'&&(!result.entity||!result.id))fail('读取详情需要记录类型和真实编号。');
  if(q.kind==='file.read'&&!result.blobId)fail('请选择已有资料的文件编号。');
  for(const key of ['start','end','date'])if(q[key]!==undefined){if(!isValidDate(q[key]))fail('查询日期无效。');result[key]=q[key];}
  if(result.start&&result.end&&result.start>result.end)fail('查询起始日期不能晚于结束日期。');
  for(const key of ['offset','limit','week'])if(q[key]!==undefined){if(!Number.isSafeInteger(q[key])||q[key]<(key==='offset'?0:1)||q[key]>(key==='offset'?100000:key==='limit'?50:53))fail('查询范围超出限制。');result[key]=q[key];}
  if(q.archived!==undefined){if(![true,false,'all'].includes(q.archived))fail('归档筛选无效。');result.archived=q.archived;}
  if(q.done!==undefined){if(typeof q.done!=='boolean')fail('完成状态筛选无效。');result.done=q.done;}
  if(q.kind==='calendar.range'&&(!result.start||!result.end))fail('日历查询需要开始和结束日期。');
  if(result.kindFilter&&!['plan','mark','note'].includes(result.kindFilter))fail('日历类型无效。');
  if(result.source&&!['all','calendar','tasks','competitions','english'].includes(result.source))fail('日历来源无效。');
  if(result.scope&&!['total','daily','projects','all'].includes(result.scope))fail('记账统计范围无效。');
  if(result.groupBy&&!['category','project','date'].includes(result.groupBy))fail('记账分组方式无效。');
  if(q.kind==='fitness.summary'){
   if(!result.spaceId)fail('运动统计必须指定空间，避免混合不同空间的记录。');
   if(result.period&&!['day','week','month'].includes(result.period))fail('运动统计周期无效。');
   if(Boolean(result.date)!==Boolean(result.period))fail('请同时指定运动统计日期date和周期period。');
   if(result.period&&(result.start||result.end))fail('日期周期与起止范围只能选择一种。');
  }
  return result;
 });
}

// A proposal is bound to the actual domain data it read. Conversation messages,
// timestamps and unsent drafts change independently and do not invalidate it.
export function workspaceFingerprint(state){
 const fields=['spaces','courses','tasks','captures','ledger','calendar','timetable','english','fitness','competitions','profile','canvas','courseCanvas','boards','ui','workbench'];
 const data=Object.fromEntries(fields.map(key=>[key,state?.[key]??null]));
 return createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

export function workspaceOverview(state){
 const rows=listWorkspaceRecords(state),counts={};for(const row of rows)counts[row.entity]=(counts[row.entity]||0)+1;
 const config=validateWorkbench(state?.workbench??createWorkbench('full'));
 return {counts,workbench:{...config,modules:config.modules.map((module,position)=>({...module,position}))},catalog:WORKBENCH_MODULES,templates:WORKBENCH_TEMPLATES,notice:'板块显示和顺序是当前配置；隐藏板块不删除业务内容。这里只是目录与数量。回答已保存内容或修改现有记录前，必须用 queries 查询，不可编造编号、金额或现有内容。'};
}
function paged(items,q){const offset=q.offset??0,limit=q.limit??20;return {total:items.length,offset,limit,hasMore:offset+limit<items.length,items:items.slice(offset,offset+limit)};}
const isArchived=(record,q)=>q.archived==='all'||Boolean(record.archived)===(q.archived??false);
const filtered=(rows,q)=>rows.filter(row=>(!q.entity||row.entity===q.entity)&&(!q.containerId||row.containerId===q.containerId)&&isArchived(row.record,q)&&(q.done===undefined||row.record.done===q.done));
function cropValue(value,depth=0,limit=6000){
 if(typeof value==='string')return value.length>limit?value.slice(0,limit)+'\n[文字过长，后续内容未提供]':value;
 if(Array.isArray(value))return value.length>100?{items:value.slice(0,100).map(v=>cropValue(v,depth+1,limit)),total:value.length,truncated:true}:value.map(v=>cropValue(v,depth+1,limit));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!['apiKey','password','token','csrfToken'].includes(k)).map(([k,v])=>[k,depth>8?'[嵌套内容省略]':cropValue(v,depth+1,limit)]));
 return value;
}
export function boundQueryResult(result,maxChars=36000){
 let output=cropValue(result);if(JSON.stringify(output).length<=maxChars)return output;
 if(Array.isArray(output.items)){
  const items=[];let used=0;for(const entry of output.items){const item=cropValue(entry,0,1400),size=JSON.stringify(item).length;if(used+size>maxChars-1000)break;items.push(item);used+=size;}
  return {...output,items,hasMore:true,truncated:true,returned:items.length,notice:'结果较长已截断，请按真实编号 get 详情或缩小条件；不能把当前片段视为全部数据。'};
 }
 return {truncated:true,notice:'单条记录过长，请缩小查询范围或直接打开原记录核对。',preview:JSON.stringify(cropValue(result,0,600)).slice(0,maxChars-500)};
}

export async function runWorkspaceQuery(state,q,{readFile,now=new Date()}={}){
 if(q.kind==='search'){
  const term=(q.text||'').toLocaleLowerCase('zh-CN');
  const rows=filtered(listWorkspaceRecords(state),q).filter(row=>!term||`${row.title}\n${JSON.stringify(row.record)}`.toLocaleLowerCase('zh-CN').includes(term));
  return boundQueryResult(paged(rows.map(row=>({...row,record:cropValue(row.record,0,1600)})),q));
 }
 if(q.kind==='get'){
  const rows=listWorkspaceRecords(state).filter(row=>row.entity===q.entity&&row.id===q.id&&(!q.containerId||row.containerId===q.containerId));
  if(rows.length!==1)fail(rows.length?'同编号记录不唯一，请指定containerId。':'这条记录已不存在，请重新查询。');
  return boundQueryResult(rows[0]);
 }
 if(q.kind==='ledger.summary'){
  const ledger=state.ledger||{projects:[],entries:[]};if(q.projectId&&!ledger.projects.some(p=>p.id===q.projectId))fail('记账项目不存在。');
  const scope=q.scope||(q.projectId?'projects':'total'),entries=selectEntries(ledger,{scope,projectId:q.projectId||'all',start:q.start||'',end:q.end||'',archived:q.archived??false});
  const totals=summarizeEntries(entries),groupBy=q.groupBy||'category',groups=new Map();
  for(const e of entries){const key=groupBy==='project'?e.projectId:groupBy==='date'?e.date:e.category;const list=groups.get(key)||[];list.push(e);groups.set(key,list);}
  const money=totals=>({...totals,income:formatMoney(totals.incomeCents),expense:formatMoney(totals.expenseCents),net:formatMoney(totals.netCents)});
  const grouped=[...groups].map(([id,list])=>({id,label:groupBy==='project'?(ledger.projects.find(p=>p.id===id)?.title||'日常零钱'):id,...money(summarizeEntries(list))})).sort((a,b)=>b.expenseCents-a.expenseCents);
  return {currency:'CNY',scope,projectId:q.projectId||null,start:q.start||null,end:q.end||null,archived:q.archived??false,totals:money(totals),computedFromAllMatchingEntries:true,groupBy,groups:grouped.slice(0,100),groupCount:grouped.length,groupsTruncated:grouped.length>100,scopeExplanation:scope==='total'?'日常零钱与设置为计入总账的项目；不包含独立核算项目。':scope==='daily'?'只有日常零钱。':scope==='projects'?'项目账目。':'所有账目，包含独立核算项目。'};
 }
 if(q.kind==='calendar.range'){
  const matches=e=>e.startDate<=q.end&&e.endDate>=q.start&&(!q.kindFilter||e.kind===q.kindFilter)&&(q.done===undefined||Boolean(e.done)===q.done);
  const native=(!q.source||['all','calendar'].includes(q.source))?(state.calendar?.events||[]).filter(e=>isArchived(e,q)&&matches(e)).map(record=>({entity:'calendarEvent',id:record.id,containerId:'',title:record.title,source:'calendar',record,display:record})):[];
  const links=q.archived===true||q.source==='calendar'?[]:projectCalendarLinks(state).filter(e=>(!q.source||q.source==='all'||e.source===q.source)&&matches(e));
  const records=links.length?new Map(listWorkspaceRecords(state).map(row=>[`${row.entity}:${row.id}`,row])):new Map();
  const linked=links.flatMap(display=>{const row=records.get(`${display.entity}:${display.sourceId}`);return row?[{...row,source:display.source,display,linked:true}]:[];});
  const entries=[...native,...linked].sort((a,b)=>a.display.startDate.localeCompare(b.display.startDate)||(a.display.startTime||'').localeCompare(b.display.startTime||'')||a.title.localeCompare(b.title,'zh-CN'));
  return boundQueryResult({...paged(entries,q),notice:'关联事项来自原记录，日期或完成状态随来源变化；修改时使用返回的真实entity/id/containerId并经用户确认，containerId为空时省略该字段。手动复制的日历标注是独立副本，可能与关联来源同时显示。归档筛选仅针对日历原安排；已归档关联来源不投影。学期课表保持独立。'});
 }
 if(q.kind==='timetable.week'){
  const term=state.timetable?.terms.find(t=>t.id===(q.termId||state.timetable.activeTermId));if(!term)fail('没有找到学期，请先查询或创建学期。');
  if(!q.week&&!q.date)fail('请提供周次或日期。');const week=q.week??weekForDate(term,q.date);
  const entries=entriesForWeek(term,week).map(e=>({entity:'timetableEntry',id:e.id,containerId:term.id,title:e.title,record:e,date:dateForWeek(term,week,e.weekday),time:periodTime(term,e)}));
  return boundQueryResult({term:{id:term.id,title:term.title,weekOne:term.weekOne,totalWeeks:term.totalWeeks},week,withinTerm:week>=1&&week<=term.totalWeeks,total:entries.length,items:entries});
 }
 if(q.kind==='english.status'){
  const english=state.english||{},sessions=(english.sessions||[]).filter(s=>!s.archived&&(!q.start||s.date>=q.start)&&(!q.end||s.date<=q.end)),words=(english.words||[]).filter(w=>!w.archived),statuses={new:0,review:0,mastered:0};for(const w of words)statuses[w.status||'new']++;
  return {plan:english.plan||null,start:q.start||null,end:q.end||null,wordCount:words.length,wordStatuses:statuses,sessionCount:sessions.length,minutes:sessions.reduce((n,s)=>n+(Number.isFinite(s.minutes)?s.minutes:0),0),mistakeCount:(english.mistakes||[]).filter(m=>!m.archived).length,notice:'学习时长仅汇总已经保存的记录；未记录的学习无法推测。'};
 }
 if(q.kind==='fitness.summary'){
  const space=state.spaces?.find(row=>row.id===q.spaceId);if(!space)fail('运动空间不存在，请先查询确认。');
  const range=q.period?fitnessRange(q.date,q.period):{start:q.start||'',end:q.end||''};
  const entries=selectFitnessEntries(state.fitness||{version:1,entries:[]},{spaceId:q.spaceId,start:range.start,end:range.end,archived:q.archived??false});
  return {spaceId:q.spaceId,spaceTitle:space.title,start:range.start||null,end:range.end||null,period:q.period||null,archived:q.archived??false,totals:summarizeFitness(entries),computedFromAllMatchingEntries:true,
   units:{minutes:'分钟',distanceKm:'公里',caloriesKcal:'千卡'},notice:'只统计所选空间已保存的真实运动记录。热量与里程仅合计已提供数值，缺失项单列；全部缺失时总量为null，不能解释为零或估算补齐。'};
 }
 if(q.kind==='competitions.summary'){
  const source=state.competitions||{version:1,items:[],milestones:[],tasks:[]};
  const target=q.competitionId?source.items.find(item=>item.id===q.competitionId):null;
  if(q.competitionId&&!target)fail('比赛不存在，请先查询确认真实编号。');
  const data=q.competitionId?{version:1,items:[target],milestones:source.milestones.filter(row=>row.competitionId===q.competitionId),tasks:source.tasks.filter(row=>row.competitionId===q.competitionId)}:source;
  const active=data.items.filter(item=>!item.archived&&item.status!=='finished'),ids=new Set(active.map(item=>item.id));
  const deadlines=data.milestones.filter(row=>ids.has(row.competitionId)&&!row.archived&&!row.done).map(row=>({...row,...deadlineStatus(row,now)})).sort((a,b)=>a.sortAt-b.sortAt||a.id.localeCompare(b.id));
  const progress=active.map(item=>({id:item.id,title:item.title,status:item.status,...competitionProgress(data,item.id)}));
  return {asOf:new Date(now).toISOString(),today:competitionToday(now),timeZone:'Asia/Shanghai',competitionId:q.competitionId||null,competition:target?{id:target.id,title:target.title,status:target.status,archived:target.archived}:null,
   totals:summarizeCompetitions(data,{now}),computedFromAllMatchingEntries:true,deadlines:deadlines.slice(0,100),deadlineCount:deadlines.length,deadlinesTruncated:deadlines.length>100,progress:progress.slice(0,100),progressCount:progress.length,progressTruncated:progress.length>100,
   notice:'统计范围为未归档、未结束的比赛及其未归档节点和任务；临期含今天及未来7天的未完成节点，逾期依据真实北京时间。具体时刻未知时当天不算逾期。总数使用全部匹配记录，明细可能截断。仅依据已保存资料，不能保证官方截止仍有效或代替核对官方通知。'};
 }
 if(q.kind==='file.read'){
  const records=listWorkspaceRecords(state).map(r=>r.record),files=[...records,...(state.aiRequests||[]).flatMap(r=>r.files||[])];
  const file=files.find(f=>f.blobId===q.blobId);if(!file)fail('只能读取工作台中已有或已附加到对话的资料。');if(!readFile)fail('文件解析服务未就绪。');
  const result=await readFile(q.blobId,file.name||file.fileName||'资料');return boundQueryResult({blobId:q.blobId,name:file.name||file.fileName,units:result.units||[],warnings:result.warnings||[]});
 }
 fail('不支持这个查询。');
}
