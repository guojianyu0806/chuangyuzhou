// Quantities entered by the user or copied from their device. This module does
// not estimate energy from exercise type, weight, distance, or elapsed time.
import {isValidDate,localDate} from './ledger-model.js';
import {isRecordColor} from './creation-colors.js';

const fail=message=>{throw new Error(message);};
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const text=(value,label,max,required=false)=>{if(typeof value!=='string'||value.length>max||(required&&!value.trim()))fail(`${label}格式无效。`);return value.trim();};
const id=value=>{text(value,'运动记录编号',160,true);if(['__proto__','constructor','prototype'].includes(value)||/[\u0000-\u001f\u007f]/.test(value))fail('运动记录编号无效。');return value;};
const date=value=>{if(!isValidDate(value))fail('请选择有效的运动日期。');return value;};
const boolean=value=>{if(typeof value!=='boolean')fail('运动归档状态无效。');return value;};
const stamp=value=>{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value)fail('运动记录时间无效。');return value;};
function quantity(value,label,min,max,decimals,nullable=false){
  if(nullable&&(value===undefined||value===null))return null;
  if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max||Math.abs(value*10**decimals-Math.round(value*10**decimals))>1e-7)fail(`${label}须在 ${min} 至 ${max} 之间，最多 ${decimals} 位小数。`);
  return Math.round(value*10**decimals)/10**decimals;
}
export const FITNESS_METRICS={minutes:{label:'运动时长',unit:'分钟'},caloriesKcal:{label:'热量消耗',unit:'千卡'},distanceKm:{label:'运动里程',unit:'公里'}};
export function validateFitnessEntry(value){
  if(!plain(value))fail('运动记录格式无效。');
  const known=new Set(['id','spaceId','date','activity','minutes','distanceKm','caloriesKcal','note','source','archived','color','createdAt','updatedAt','sourceRequestId']);
  if(Object.keys(value).some(key=>!known.has(key)))fail('运动记录包含不支持的字段。');
  if(!isRecordColor(value.color))fail('运动卡片颜色无效。');
  const source=value.source??'manual';if(!['manual','device'].includes(source))fail('运动数据来源无效。');
  return {id:id(value.id),spaceId:id(value.spaceId),date:date(value.date),activity:text(value.activity,'运动名称',80,true),minutes:quantity(value.minutes,'运动时长（分钟）',.01,1440,2),
    distanceKm:quantity(value.distanceKm,'运动里程（公里）',0,1000,3,true),caloriesKcal:quantity(value.caloriesKcal,'热量消耗（千卡）',0,20000,2,true),
    note:text(value.note??'','运动备注',2000),source,archived:boolean(value.archived??false),color:value.color,createdAt:stamp(value.createdAt),updatedAt:stamp(value.updatedAt),
    ...(value.sourceRequestId===undefined?{}:{sourceRequestId:id(value.sourceRequestId)})};
}
export function validateFitness(value){
  if(!plain(value)||value.version!==1||!Array.isArray(value.entries)||value.entries.length>100000||Object.keys(value).some(key=>!['version','entries'].includes(key)))fail('运动统计数据格式无效。');
  const entries=value.entries.map(validateFitnessEntry),seen=new Set();
  for(const entry of entries){if(seen.has(entry.id))fail('运动记录编号重复。');seen.add(entry.id);}
  return {version:1,entries};
}
export function initializeFitness(state){state.fitness??={version:1,entries:[]};return state.fitness;}
export function isFitnessSpace(space,state){
  if(!space)return false;
  if(typeof space.fitnessEnabled==='boolean')return space.fitnessEnabled;
  const title=String(space.title||'').trim();
  return space.type==='fitness'||/健身|fitness|workout/i.test(title)||/^(?:我的)?运动(?:空间|记录|日记)?$/.test(title)||!!state?.fitness?.entries?.some(entry=>entry.spaceId===space.id);
}
export function mergeFitness(current,imported){
  const left=validateFitness(current??{version:1,entries:[]}),right=validateFitness(imported??{version:1,entries:[]});
  const seen=new Set(left.entries.map(entry=>entry.id));return {version:1,entries:[...left.entries,...right.entries.filter(entry=>!seen.has(entry.id))]};
}
export const fitnessToday=()=>localDate();
const utc=value=>new Date(date(value)+'T00:00:00Z');
function addDays(value,offset){const d=utc(value);d.setUTCDate(d.getUTCDate()+offset);return date(d.toISOString().slice(0,10));}
const monthEnd=value=>{const d=utc(value);d.setUTCMonth(d.getUTCMonth()+1,0);return d.toISOString().slice(0,10);};
export function fitnessRange(value,period='week'){
  date(value);if(!['day','week','month'].includes(period))fail('请选择日、周或月视图。');
  let start=value,end=value;
  if(period==='week'){start=addDays(value,-((utc(value).getUTCDay()+6)%7));end=addDays(start,6);}
  if(period==='month'){start=value.slice(0,7)+'-01';end=monthEnd(start);}
  const days=[];for(let d=start;d<=end;){days.push(d);if(d===end)break;d=addDays(d,1);}
  const label=period==='day'?value:period==='month'?`${value.slice(0,4)} 年 ${Number(value.slice(5,7))} 月`:`${start} — ${end}`;
  return {period,date:value,start,end,label,days};
}
export function shiftFitnessDate(value,period,direction){
  date(value);if(![-1,1].includes(direction))fail('日期切换方向无效。');
  if(period==='day'||period==='week')return addDays(value,direction*(period==='week'?7:1));
  if(period!=='month')fail('请选择日、周或月视图。');
  const d=utc(value),wanted=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+direction);const first=date(d.toISOString().slice(0,10));
  d.setUTCDate(Math.min(wanted,Number(monthEnd(first).slice(8,10))));return date(d.toISOString().slice(0,10));
}
export function selectFitnessEntries(fitness,{spaceId,start='',end='',archived=false}={}){
  if(!spaceId)fail('请选择对应的运动空间。');id(spaceId);
  if(start)date(start);if(end)date(end);if(start&&end&&start>end)fail('开始日期不能晚于结束日期。');
  if(![true,false,'all'].includes(archived))fail('运动归档筛选无效。');
  return (fitness?.entries||[]).filter(entry=>entry.spaceId===spaceId&&(archived==='all'||!!entry.archived===archived)&&(!start||entry.date>=start)&&(!end||entry.date<=end))
    .sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id));
}
export function summarizeFitness(entries){
  const count=entries.length,calories=entries.filter(e=>e.caloriesKcal!==null&&e.caloriesKcal!==undefined),distance=entries.filter(e=>e.distanceKm!==null&&e.distanceKm!==undefined);
  const sum=(rows,key,precision)=>rows.reduce((n,e)=>n+Math.round(e[key]*10**precision),0)/10**precision;
  return {count,minutes:sum(entries,'minutes',2),distanceKm:distance.length?sum(distance,'distanceKm',3):null,caloriesKcal:calories.length?sum(calories,'caloriesKcal',2):null,
    distanceCount:distance.length,caloriesCount:calories.length,activeDays:new Set(entries.map(e=>e.date)).size,missingCaloriesCount:count-calories.length,missingDistanceCount:count-distance.length};
}
export function fitnessSeries(entries,{date:value,period='week',metric='minutes'}={}){
  if(!Object.hasOwn(FITNESS_METRICS,metric))fail('统计指标无效。');
  const range=fitnessRange(value,period),inRange=entries.filter(e=>!e.archived&&e.date>=range.start&&e.date<=range.end);
  const point=(rows,day,label,key)=>{
    const summary=summarizeFitness(rows),recordedCount=metric==='minutes'?summary.count:metric==='caloriesKcal'?summary.caloriesCount:summary.distanceCount;
    return {key,date:day,label,value:summary[metric],count:summary.count,recordedCount,missingCount:summary.count-recordedCount};
  };
  if(period==='day')return [...inRange].sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id)).map(e=>point([e],e.date,e.activity,e.id));
  return range.days.map(day=>point(inRange.filter(e=>e.date===day),day,period==='week'?['周日','周一','周二','周三','周四','周五','周六'][utc(day).getUTCDay()]:String(Number(day.slice(8,10))),day));
}
