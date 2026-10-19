import {isValidDate,localDate} from './ledger-model.js';
export const CALENDAR_KINDS={plan:'计划',mark:'标注',note:'注意事项'};
const fail=message=>{throw new Error(message);};
const text=(value,max,required=false)=>{if(typeof value!=='string'||value.length>max||(required&&!value.trim()))fail('日历内容格式无效。');return value.trim();};
const flag=value=>{if(typeof value!=='boolean')fail('日历状态格式无效。');return value;};
const date=value=>{if(!isValidDate(value))fail('请选择有效的日期。');return value;};
const time=value=>{if(typeof value!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(value))fail('请选择有效的时间。');return value;};
const stamp=value=>{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)||!Number.isFinite(Date.parse(value)))fail('日历记录时间无效。');return value;};
export function validateCalendar(input){
  if(!input||input.version!==1||!Array.isArray(input.events)||input.events.length>10000)fail('日历数据格式无效。');
  const seen=new Set();
  const events=input.events.map(e=>{
    if(!e||typeof e!=='object'||Array.isArray(e))fail('日历条目格式无效。');
    const id=text(e.id,128,true);if(seen.has(id)||['__proto__','constructor','prototype'].includes(id)||/[\u0000-\u001f]/.test(id))fail('日历编号无效或重复。');seen.add(id);
    if(!Object.hasOwn(CALENDAR_KINDS,e.kind))fail('日历类型无效。');
    if(typeof e.color!=='string'||!/^#[\da-f]{6}$/i.test(e.color))fail('日历颜色无效。');
    const startDate=date(e.startDate),endDate=date(e.endDate),allDay=flag(e.allDay);
    if(endDate<startDate)fail('结束日期不能早于开始日期。');
    const startTime=allDay?'':time(e.startTime),endTime=allDay?'':time(e.endTime);
    if(!allDay&&startDate===endDate&&endTime<=startTime)fail('结束时间应晚于开始时间。');
    return {id,title:text(e.title,160,true),kind:e.kind,startDate,endDate,allDay,startTime,endTime,location:text(e.location??'',240),notes:text(e.notes??'',12000),important:flag(e.important),done:flag(e.done),archived:flag(e.archived),color:e.color,createdAt:stamp(e.createdAt),updatedAt:stamp(e.updatedAt)};
  });
  return {version:1,events};
}
export function initializeCalendar(state){state.calendar??={version:1,events:[]};return state.calendar;}
export const calendarToday=()=>localDate();
export function shiftDate(value,days){
  date(value);const result=new Date(value+'T00:00:00Z');result.setUTCDate(result.getUTCDate()+days);
  return result.toISOString().slice(0,10);
}
export function shiftMonth(month,offset){
  if(!/^\d{4}-\d{2}$/.test(month)||!isValidDate(month+'-01'))fail('月份无效。');
  const index=Math.max(1900*12,Math.min(9999*12+11,Number(month.slice(0,4))*12+Number(month.slice(5))-1+offset));
  return `${Math.floor(index/12)}-${String(index%12+1).padStart(2,'0')}`;
}
export function monthDays(month){
  const first=month+'-01';date(first);const weekday=(new Date(first+'T00:00:00Z').getUTCDay()+6)%7;
  const start=new Date(first+'T00:00:00Z');start.setUTCDate(1-weekday);
  return Array.from({length:42},(_,i)=>{const d=new Date(start);d.setUTCDate(d.getUTCDate()+i);return d.toISOString().slice(0,10);});
}
export function eventsOnDate(calendar,value,{kind='all',archived=false}={}){
  return calendar.events.filter(e=>e.archived===archived&&(kind==='all'||e.kind===kind)&&e.startDate<=value&&e.endDate>=value)
    .sort((a,b)=>Number(b.important)-Number(a.important)||Number(b.allDay)-Number(a.allDay)||a.startTime.localeCompare(b.startTime)||a.title.localeCompare(b.title,'zh-CN'));
}
