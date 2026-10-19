import {validateFitnessEntry,validateFitness,isFitnessSpace} from './fitness-model.js';
import {isValidDate} from './ledger-model.js';

const fail=message=>{throw new Error(message);};
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const text=(value,max,required=false)=>{if(typeof value!=='string'||value.length>max||(required&&!value.trim()))fail('运动行动文字无效。');return value.trim();};
const id=value=>{text(value,128,true);if(['__proto__','constructor','prototype'].includes(value)||/[\u0000-\u001f\u007f]/.test(value))fail('运动记录编号无效。');return value;};
const amount=(value,min,max)=>{if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)fail('运动数据超出支持范围。');return value;};
const day=value=>{if(!isValidDate(value))fail('运动日期须为真实的YYYY-MM-DD。');return value;};
const choice=(value,choices)=>{if(!choices.includes(value))fail('运动数据来源无效。');return value;};
const color=value=>{if(typeof value!=='string'||!/^#[\da-f]{6}$/i.test(value))fail('运动卡片颜色无效。');return value;};
const rules={spaceId:id,date:day,activity:v=>text(v,80,true),minutes:v=>{amount(v,0,1440);if(v<=0)fail('运动时长必须大于0。');return v;},distanceKm:v=>v===null?null:amount(v,0,1000),caloriesKcal:v=>v===null?null:amount(v,0,20000),note:v=>text(v,2000),source:v=>choice(v,['manual','device']),color,evidence:v=>text(v,2000,true)};
const operations=['create','update','archive','restore'];
function normalizeData(data,operation){
  if(!plain(data)||!operations.includes(operation))fail('不支持这个运动操作。');
  if(Object.keys(data).some(key=>!Object.hasOwn(rules,key)))fail('运动操作包含不支持字段。');
  if(['archive','restore'].includes(operation)){if(Object.keys(data).length)fail('归档或恢复运动记录的data应为空。');return {};}
  const result=Object.fromEntries(Object.entries(data).map(([key,value])=>[key,rules[key](value)]));
  if(operation==='create'&&['spaceId','date','activity','minutes','evidence'].some(key=>result[key]===undefined))fail('请补充所属空间、日期、运动项目、实际分钟数和用户原话依据。');
  if(operation==='update'&&!Object.keys(result).some(key=>key!=='evidence'))fail('请指定要修改的运动信息。');
  return result;
}
function evidence(state,data,ctx){
  const quote=text(data.evidence??'',2000,true);if(quote.length<4)fail('运动事实需要至少4个字符的用户原话依据。');
  const request=state.aiRequests?.find(item=>item.id===ctx.requestId);
  const userTexts=ctx.userTexts||[request?.text||'',...(request?.conversation?.messages||[]).filter(message=>message.role==='user').map(message=>message.text||'')];
  const matches=userTexts.filter(value=>typeof value==='string'&&value.includes(quote));
  if(!matches.length)fail('运动记录必须来自用户实际提供的情况，不能引用助手建议。');
  const planning=/计划|打算|准备|明天|后天|将要|预计|目标|下周|下个月|希望|想要/;
  const completed=/已完成|已经|实际|完成了|刚刚|跑了|走了|练了|骑了|做了|运动了/;
  const actual=matches.some(value=>value.split(/[。！？!?\n]/).some(sentence=>sentence.includes(quote)&&(!planning.test(sentence)||completed.test(sentence))));
  if(!actual)fail('这段原话表达的是运动计划，请记入日历；不能当作已完成运动。');
  return matches;
}
function validateMeasurements(data,before,userTexts){
  const inputs=userTexts||[];
  const matchesValue=(value,patterns)=>inputs.some(input=>patterns.some(([pattern,factor])=>[...input.matchAll(pattern)].some(match=>Math.abs(Number(match[1])*factor-value)<1e-7)));
  if(data.distanceKm!==undefined&&data.distanceKm!==null&&data.distanceKm!==before?.distanceKm){
    const patterns=[[/(-?\d+(?:\.\d+)?)\s*(?:公里|千米|km)(?![a-z])/gi,1],[/(-?\d+(?:\.\d+)?)\s*(?:米|m)(?![a-z])/gi,.001]];
    if(!matchesValue(data.distanceKm,patterns))fail('用户原话未提供可核对的距离，请先询问公里或米数；不能按运动时长估算。');
  }
  if(data.caloriesKcal!==undefined&&data.caloriesKcal!==null&&data.caloriesKcal!==before?.caloriesKcal){
    const patterns=[[/(-?\d+(?:\.\d+)?)\s*(?:千卡|大卡|kcal|卡路里)(?![a-z])/gi,1],[/(?:消耗|热量)\s*(?:了|为|是|约|大约|：|:)?\s*(-?\d+(?:\.\d+)?)(?![\d.]|\s*(?:千焦|kJ))/gi,1]];
    if(!matchesValue(data.caloriesKcal,patterns))fail('用户原话未提供可核对的消耗热量，请先询问设备或手动记录值；不能估算千卡。');
  }
}
function availableSpace(state,spaceId){
  const space=state.spaces?.find(item=>item.id===spaceId&&!item.archived);
  if(!space)fail('运动所属空间不存在或已归档。');
  if(!isFitnessSpace(space,state))fail('这个空间尚未开启运动记录，请先审核开启该空间的运动功能。');
  return space;
}
const rows=state=>state.fitness?.entries||[];
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const equal=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
function write(state,recordId,after){
  const existing=rows(state),found=existing.some(row=>row.id===recordId);
  state.fitness=validateFitness({version:1,entries:after===null?existing.filter(row=>row.id!==recordId):found?existing.map(row=>row.id===recordId?after:row):[after,...existing]});
}
export const FITNESS_ACTION_ADAPTERS={fitnessEntry:{
  label:'运动记录',operations,
  capability:'create/update/archive/restore真实已完成运动记录。create必填data.spaceId(已开启运动功能的空间真实id或前序space创建的$ref)、date(不晚于今天的YYYY-MM-DD)、activity(非空≤80字)、minutes(数字0.01–1440，最多2位小数)、evidence(至少4字符的用户实际运动原话)。可选distanceKm(null或数字0–1000，最多3位小数)、caloriesKcal(null或数字0–20000，最多2位小数)、note(≤2000字)、source=manual|device(默认manual)。新增或修改的非null距离/热量必须在该用户原话中有对应值：距离支持公里/km/米/m单位换算，热量支持千卡/kcal/大卡或“消耗300”；无可靠依据先追问。未知距离、热量必须null，不能估算或把缺失当0；设备来源仅用户明确提供设备读数时选device。修改实际日期/运动/时长/来源也须evidence，未改变的旧测量无需重复提供；可以清空测量为null。计划放日历，不记作已完成。spaceId可修改移动至其他已开启运动功能的空间；containerId可选space:真实id用于核对原空间。color仅用户指定时填#RRGGBB，否则随机。归档/恢复data为空，不永久删除。',
  fields:{activity:'运动项目',minutes:'运动时长（分钟）',distanceKm:'距离（公里）',caloriesKcal:'消耗热量（千卡）',spaceId:'所属运动空间',source:'记录来源',evidence:'用户原话依据'},
  normalizeData,validateRecord:validateFitnessEntry,
  list:state=>rows(state).map(record=>({id:record.id,containerId:`space:${record.spaceId}`,title:`${record.date} · ${record.activity} · ${record.minutes} 分钟`,record})),
  apply(state,action,ctx){
    const data=normalizeData(action.data||{},action.operation),before=action.operation==='create'?null:rows(state).find(row=>row.id===action.id);
    if(action.operation!=='create'&&!before)fail('要修改的运动记录不存在。');
    if(action.containerId&&before&&action.containerId!==`space:${before.spaceId}`)fail('运动记录与指定空间不一致。');
    if(before?.archived&&action.operation==='update')fail('请先恢复运动记录，再修改内容。');
    if(data.spaceId)data.spaceId=ctx.resolveReference(data.spaceId,['space']);
    const spaceId=data.spaceId||before?.spaceId;availableSpace(state,spaceId);
    if(action.operation==='create'&&action.containerId&&action.containerId!==`space:${spaceId}`)fail('运动新建目标与指定空间不一致。');
    const today=new Date(ctx.now).toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'});
    if(action.operation==='create'||action.operation==='update'){
      if((data.date||before?.date)>today)fail('实际运动不能填写未来日期，计划请加入日历。');
      const actualChange=['date','activity','minutes','distanceKm','caloriesKcal','source'].some(key=>data[key]!==undefined&&!equal(data[key],before?.[key])&&!(data[key]===null&&['distanceKm','caloriesKcal'].includes(key)));
      if(action.operation==='create'||actualChange){const userTexts=evidence(state,data,ctx);validateMeasurements(data,before,userTexts);}
    }
    let after=before?structuredClone(before):{id:ctx.uid(),spaceId,date:data.date,activity:data.activity,minutes:data.minutes,distanceKm:null,caloriesKcal:null,note:'',source:'manual',archived:false,color:ctx.assignColor(state,data.color),createdAt:ctx.now,updatedAt:ctx.now,...(ctx.requestId?{sourceRequestId:ctx.requestId}:{})};
    if(['archive','restore'].includes(action.operation))after.archived=action.operation==='archive';
    else for(const [key,value]of Object.entries(data))if(key!=='evidence')after[key]=value;
    after.updatedAt=ctx.now;after=validateFitnessEntry(after);write(state,after.id,after);
    const containerId=`space:${after.spaceId}`;
    return {entity:'fitnessEntry',operation:action.operation,id:after.id,containerId,...(before&&before.spaceId!==after.spaceId?{beforeContainerId:`space:${before.spaceId}`}:{ }),before:before?structuredClone(before):null,after:structuredClone(after)};
  },
  undo(state,snapshot){
    const current=rows(state).find(row=>row.id===snapshot.id);
    if(!current||!equal(current,snapshot.after))return false;
    if(snapshot.before&&!state.spaces?.some(space=>space.id===snapshot.before.spaceId))return false;
    write(state,snapshot.id,snapshot.before===null?null:validateFitnessEntry(snapshot.before));return true;
  },
}};
