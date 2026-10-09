// Read-only date projections. These are views of their source records, never
// calendar records: do not pass them to validateCalendar or save them in state.
import {isValidDate} from './ledger-model.js';
import {COMPETITION_STATUSES} from './competitions-model.js';

export const CALENDAR_LINK_SOURCES=Object.freeze({tasks:'待办',competitions:'比赛',english:'英语'});
const rows=value=>Array.isArray(value)?value.filter(row=>row&&typeof row==='object'&&!Array.isArray(row)):[];
const text=value=>typeof value==='string'?value:'';
const validId=value=>typeof value==='string'&&!!value.trim()&&value.length<=240&&!['__proto__','prototype','constructor'].includes(value)&&!/[\u0000-\u001f\u007f]/.test(value);
const index=value=>new Map(rows(value).filter(row=>validId(row.id)).map(row=>[row.id,row]));
const color=(value,fallback)=>typeof value==='string'&&/^#[\da-f]{6}$/i.test(value)?value:fallback;
const clock=value=>typeof value==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const usable=record=>validId(record.id)&&!!text(record.title).trim()&&record.archived!==true;

function taskParent(task,spaces,courses,requests){
  let kind='',id='';
  // Explicit current ownership wins over the request which originally created
  // a task: moving it must not leave it hidden by its previous archived parent.
  if(task.spaceId==='')return {kind:'',id:'',record:null};
  if(text(task.spaceId)){kind='space';id=task.spaceId;}
  else if(text(task.courseId)){kind='course';id=task.courseId;}
  else {
    const destination=requests.get(task.sourceRequestId)?.receipt?.destinationId;
    if(typeof destination==='string'&&destination.startsWith('space:')){kind='space';id=destination.slice(6);}
    else if(typeof destination==='string'&&destination.startsWith('course:')){kind='course';id=destination.slice(7);}
  }
  if(!kind)return {kind:'',id:'',record:null};
  const record=(kind==='space'?spaces:courses).get(id);
  // Missing structured parents cannot supply a valid active source context.
  if(!record||record.archived===true)return null;
  return {kind,id,record};
}

/**
 * Return detached, display-only events from explicit structured dates.
 * - source groups: tasks / competitions / english; no native calendar entries.
 * - id is a display key, sourceId + entity identify the actual editable record.
 * - competition point deadlines use startTime === endTime, not a made-up span.
 * - YYYY-MM-DD and HH:mm are kept verbatim; no date/time-zone conversion.
 * - archived parents/children are omitted; done and finished history is retained.
 */
export function projectCalendarLinks(state={}){
  const output=[],seen=new Set();
  const spaces=index(state?.spaces),courses=index(state?.courses),requests=index(state?.aiRequests),copies=index(state?.calendar?.events);
  const append=entry=>{
    if(seen.has(entry.id))return;
    seen.add(entry.id);output.push({kind:'plan',allDay:true,startTime:'',endTime:'',location:'',notes:'',done:false,important:false,archived:false,readOnly:true,sourceHint:'来自原模块的日期事项；请到来源中修改。',...entry});
  };
  for(const task of rows(state?.tasks)){
    if(!usable(task)||!isValidDate(task.date))continue;
    const parent=taskParent(task,spaces,courses,requests);if(!parent)continue;
    append({id:`linked:task:${task.id}`,source:'tasks',sourceLabel:parent.kind==='space'?'空间待办':parent.kind==='course'?'课程待办':'待办',sourceType:'task',entity:'task',sourceId:task.id,containerId:'workspace',
      title:text(task.title),startDate:task.date,endDate:task.date,color:color(task.color,color(parent.record?.color,'#63E6DC')),done:task.done===true,important:task.priority==='high',notes:text(task.description),route:'tasks',subroute:task.id,
      ...(parent.record?{parentTitle:text(parent.record.title),parentId:parent.id,parentType:parent.kind}:{}),sourceHint:'日期和完成状态随待办更新；请在待办中编辑。'});
  }
  const competitions=index(state?.competitions?.items);
  for(const [collection,sourceType,label] of [['milestones','competitionMilestone','比赛节点'],['tasks','competitionTask','比赛任务']]){
    for(const record of rows(state?.competitions?.[collection])){
      if(!usable(record)||!isValidDate(record.date))continue;
      const parent=competitions.get(record.competitionId);if(!parent||parent.archived===true)continue;
      const milestone=sourceType==='competitionMilestone';
      // An invalid supplied time is not silently reinterpreted as an all-day deadline.
      if(milestone&&record.time!==undefined&&record.time!==''&&!clock(record.time))continue;
      const timed=milestone&&clock(record.time),copy=milestone?copies.get(`competition-${record.id}`):null;
      const status=Object.hasOwn(COMPETITION_STATUSES,parent.status)?COMPETITION_STATUSES[parent.status]:'';
      const sourceHint=copy?`日历另有独立标注${copy.archived===true?'（已归档）':''}，修改互不影响；此项随比赛节点更新。`:'日期和完成状态随比赛更新；请到比赛中编辑。';
      append({id:`linked:${sourceType}:${record.id}`,source:'competitions',sourceLabel:label,sourceType,entity:sourceType,sourceId:record.id,containerId:parent.id,kind:milestone?'mark':'plan',
        title:[text(parent.title),text(record.title)].filter(Boolean).join(' · '),startDate:record.date,endDate:record.date,startTime:timed?record.time:'',endTime:timed?record.time:'',allDay:!timed,
        color:color(parent.color,'#D8F649'),done:record.done===true,important:milestone,notes:milestone?`比赛：${text(parent.title)}\n节点：${text(record.title)}\n截止：${record.date}${timed?' '+record.time:'（未填写具体时刻）'} · 北京时间${status?'\n比赛状态：'+status:''}`:text(record.notes),
        route:'competitions',subroute:parent.id,parentTitle:text(parent.title),parentStatus:status,parentStatusCode:text(parent.status),...(milestone?{timeZone:'Asia/Shanghai'}:{}),sourceHint,
        ...(copy?{independentCopyId:copy.id,independentCopyArchived:copy.archived===true}:{})});
    }
  }
  const plan=state?.english?.plan;
  if(plan&&typeof plan==='object'&&!Array.isArray(plan)&&plan.archived!==true&&isValidDate(plan.examDate)){
    append({id:'linked:englishExam:english-plan',source:'english',sourceLabel:'英语考试',sourceType:'englishExam',entity:'englishPlan',sourceId:'english-plan',containerId:'',title:'英语考试',startDate:plan.examDate,endDate:plan.examDate,
      color:'#AE88FF',important:true,notes:'日期来自英语学习计划中填写的考试日期；未提供具体考试时刻。',route:'english',subroute:'',sourceHint:'这是英语计划中已填写的考试日期；请到英语计划修改，不代表自动核验的官方通知。'});
  }
  return output.sort((a,b)=>a.startDate.localeCompare(b.startDate)||Number(b.important)-Number(a.important)||Number(b.allDay)-Number(a.allDay)||a.startTime.localeCompare(b.startTime)||a.title.localeCompare(b.title,'zh-CN')||a.id.localeCompare(b.id));
}
