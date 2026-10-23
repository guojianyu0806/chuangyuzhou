import {isValidDate} from './ledger-model.js';
import {validateCalendar} from './calendar-model.js';

export const COMPETITION_STATUSES = Object.freeze({watching:'关注中',preparing:'准备中',submitted:'已提交',finished:'已结束'});
const fail=message=>{throw new Error(message);};
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
function text(value,label,max,required=false){if(typeof value!=='string'||value.length>max||(required&&!value.trim()))fail(`${label}格式无效。`);return value.trim();}
function id(value){text(value,'比赛记录编号',96,true);if(['__proto__','constructor','prototype'].includes(value)||/[\u0000-\u001f\u007f]/.test(value))fail('比赛记录编号无效。');return value;}
function flag(value){if(typeof value!=='boolean')fail('比赛记录状态无效。');return value;}
function date(value,optional=false){if(optional&&value==='')return '';if(!isValidDate(value))fail('请选择有效的比赛日期。');return value;}
function stamp(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value)fail('比赛记录时间无效。');return value;}
function known(value,fields){if(!plain(value)||Object.keys(value).some(key=>!fields.includes(key)))fail('比赛记录包含不支持的字段。');}
const metaFields=['id','archived','createdAt','updatedAt','sourceRequestId'];
const meta=value=>({id:id(value.id),archived:flag(value.archived??false),createdAt:stamp(value.createdAt),updatedAt:stamp(value.updatedAt),...(value.sourceRequestId===undefined?{}:{sourceRequestId:id(value.sourceRequestId)})});
function officialUrl(value){if(typeof value==='string'&&/[\u0000-\u001f\u007f]/.test(value))fail('比赛网址不能包含控制字符。');const url=text(value,'比赛网址',2000);if(!url)return '';try{const parsed=new URL(url);if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password)fail('网址无效');return parsed.href;}catch{fail('比赛网址须以 https:// 或 http:// 开头，且不能包含登录凭据。');}}
export function validateCompetitionItem(value){
  known(value,[...metaFields,'title','organizer','category','url','team','requirements','notes','status','color']);
  const status=value.status??'watching';if(!Object.hasOwn(COMPETITION_STATUSES,status))fail('比赛进度状态无效。');
  if(typeof value.color!=='string'||!/^#[\da-f]{6}$/i.test(value.color))fail('比赛卡片颜色无效。');
  return {...meta(value),title:text(value.title,'比赛名称',120,true),organizer:text(value.organizer??'','主办方',120),category:text(value.category??'','比赛分类',80),url:officialUrl(value.url??''),team:text(value.team??'','团队与分工',2000),requirements:text(value.requirements??'','参赛要求与材料',12000),notes:text(value.notes??'','比赛备注',12000),status,color:value.color};
}
export function validateCompetitionMilestone(value){
  known(value,[...metaFields,'competitionId','title','date','time','done']);
  const time=value.time??'';if(typeof time!=='string'||(time&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)))fail('请选择有效的截止时间。');
  return {...meta(value),competitionId:id(value.competitionId),title:text(value.title,'关键节点名称',120,true),date:date(value.date),time,done:flag(value.done??false)};
}
export function validateCompetitionTask(value){
  known(value,[...metaFields,'competitionId','title','date','notes','done']);
  return {...meta(value),competitionId:id(value.competitionId),title:text(value.title,'准备事项',120,true),date:date(value.date??'',true),notes:text(value.notes??'','事项备注',4000),done:flag(value.done??false)};
}
export function validateCompetitions(value){
  known(value,['version','items','milestones','tasks']);
  if(value.version!==1||!['items','milestones','tasks'].every(key=>Array.isArray(value[key])&&value[key].length<=10000))fail('比赛模块数据格式无效。');
  const result={version:1,items:value.items.map(validateCompetitionItem),milestones:value.milestones.map(validateCompetitionMilestone),tasks:value.tasks.map(validateCompetitionTask)},seen=new Set(),parents=new Set(result.items.map(row=>row.id));
  for(const row of [...result.items,...result.milestones,...result.tasks]){if(seen.has(row.id))fail('比赛记录编号重复。');seen.add(row.id);}
  if([...result.milestones,...result.tasks].some(row=>!parents.has(row.competitionId)))fail('比赛节点或事项关联的比赛不存在。');
  return result;
}
const empty=()=>({version:1,items:[],milestones:[],tasks:[]});
export function initializeCompetitions(state){state.competitions??=empty();return state.competitions;}
export function mergeCompetitions(current,incoming){
  const left=validateCompetitions(current??empty()),right=validateCompetitions(incoming??empty()),result={version:1};
  for(const key of ['items','milestones','tasks']){const seen=new Set(left[key].map(row=>row.id));result[key]=[...left[key],...right[key].filter(row=>!seen.has(row.id))];}
  return validateCompetitions(result);
}
function nowDate(now){const result=now instanceof Date?now:new Date(now);if(!Number.isFinite(result.getTime()))fail('当前日期无效。');return result;}
const beijingDateFormat=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'});
export function competitionToday(now=new Date()){
  const parts=Object.fromEntries(beijingDateFormat.formatToParts(nowDate(now)).map(part=>[part.type,part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function deadlineStatus(milestone,now=new Date()){
  const d=nowDate(now),day=date(milestone.date),time=milestone.time||'';
  const sortAt=time?Date.parse(`${day}T${time}:00+08:00`):Date.parse(`${day}T00:00:00+08:00`)+86400000;
  if(!Number.isFinite(sortAt))fail('截止时间无效。');
  const days=Math.round((Date.parse(day+'T00:00:00Z')-Date.parse(competitionToday(d)+'T00:00:00Z'))/86400000);
  if(milestone.done)return {state:'done',days,label:'已完成',sortAt};
  if(d.getTime()>=sortAt)return {state:'overdue',days,label:days<0?`已逾期 ${-days} 天`:'已截止',sortAt};
  if(days===0)return {state:'today',days,label:time?`今天 ${time} 截止`:'今天截止 · 时间未填',sortAt};
  return {state:days<=7?'soon':'upcoming',days,label:`还有 ${days} 天`,sortAt};
}
export function nearestCompetitionDeadline(data,competitionId,now=new Date()){
  return (data?.milestones||[]).filter(row=>row.competitionId===competitionId&&!row.archived&&!row.done).sort((a,b)=>deadlineStatus(a,now).sortAt-deadlineStatus(b,now).sortAt||a.id.localeCompare(b.id))[0]||null;
}
export function competitionProgress(data,competitionId){
  const tasks=(data?.tasks||[]).filter(row=>row.competitionId===competitionId&&!row.archived),done=tasks.filter(row=>row.done).length;
  return {done,total:tasks.length,percent:tasks.length?Math.round(done/tasks.length*100):0};
}
export function summarizeCompetitions(data,{now=new Date()}={}){
  const active=(data?.items||[]).filter(row=>!row.archived&&row.status!=='finished'),ids=new Set(active.map(row=>row.id));
  const deadlines=(data?.milestones||[]).filter(row=>ids.has(row.competitionId)&&!row.archived&&!row.done).map(row=>deadlineStatus(row,now)),tasks=(data?.tasks||[]).filter(row=>ids.has(row.competitionId)&&!row.archived);
  return {active:active.length,upcoming:deadlines.filter(row=>['today','soon'].includes(row.state)).length,overdue:deadlines.filter(row=>row.state==='overdue').length,unfinishedTasks:tasks.filter(row=>!row.done).length,completedTasks:tasks.filter(row=>row.done).length};
}
export function createCompetitionCalendarEvent(item,milestone,now=new Date()){
  if(item.id!==milestone.competitionId)fail('比赛与截止节点不匹配。');
  const entry=validateCompetitionMilestone(milestone),createdAt=nowDate(now).toISOString();
  const notes=[`比赛：${item.title}`,`关键节点：${entry.title}`,`截止：${entry.date}${entry.time?' '+entry.time:'（未填写具体时刻）'} · 北京时间`,item.url?`官网：${item.url}`:'','由比赛模块复制的独立日历标注；比赛中后续的修改不会自动覆盖此标注。'].filter(Boolean).join('\n');
  return validateCalendar({version:1,events:[{id:`competition-${entry.id}`,title:`${item.title} · ${entry.title}`.slice(0,160),kind:'mark',startDate:entry.date,endDate:entry.date,allDay:true,startTime:'',endTime:'',location:'',notes,important:true,done:entry.done,archived:false,color:item.color,createdAt,updatedAt:createdAt}]}).events[0];
}
