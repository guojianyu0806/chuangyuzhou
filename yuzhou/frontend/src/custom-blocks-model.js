import {isValidDate} from './ledger-model.js';
import {isRecordColor,previewRecordColor} from './creation-colors.js';

const fail=message=>{throw new Error(message);};
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const forbidden=new Set(['__proto__','constructor','prototype']);
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const fields=(value,allowed,required=allowed)=>{if(!plain(value)||Object.keys(value).some(key=>!allowed.includes(key))||required.some(key=>!Object.hasOwn(value,key)))fail('自定义方块字段无效。');};
function text(value,max,required=false){if(typeof value!=='string'||value.length>max||(required&&!value.trim())||/[\u0000]/.test(value))fail('方块文字长度或格式无效。');return value;}
function id(value){if(typeof value!=='string'||!value||value.length>160||forbidden.has(value)||/[\u0000-\u001f\u007f]/.test(value))fail('方块条目编号无效。');return value;}
function blockId(value){id(value);if(!/^block:[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value))fail('自定义方块编号必须使用 block: 前缀。');return value;}
function bool(value){if(typeof value!=='boolean')fail('方块状态无效。');return value;}
function numeric(value,min=0,max=1e12){if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)fail('方块数值无效。');return value;}
function stamp(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)||new Date(value).toISOString()!==value)fail('方块时间无效。');return value;}
function rows(value,maximum,parse){if(!Array.isArray(value)||value.length>maximum)fail('方块条目数量超出上限。');const result=value.map(parse);if(new Set(result.map(row=>row.id)).size!==result.length)fail('方块条目编号重复。');return result;}
function url(value){text(value,2048,true);let parsed;try{parsed=new URL(value);}catch{fail('收藏网址无效。');}if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password||/[\u0000-\u0020]/.test(value))fail('收藏只支持不含账号密码的 HTTP(S) 网址。');return value;}

export const CUSTOM_BLOCK_KINDS=Object.freeze([
  {id:'note',title:'便签',description:'记录文字与想法。',icon:'file-text',color:'#AE88FF',config:{text:''}},
  {id:'checklist',title:'清单',description:'逐项勾选自己的计划。',icon:'check-circle',color:'#63E6DC',config:{items:[]}},
  {id:'links',title:'网址收藏',description:'保存常用页面的入口。',icon:'link',color:'#9DC5FF',config:{items:[]}},
  {id:'progress',title:'进度',description:'展示一个有明确目标的进度。',icon:'chart',color:'#D8F649',config:{value:0,target:100,unit:'%'}},
  {id:'countdown',title:'重要日期',description:'关注截止日期或纪念日。',icon:'calendar',color:'#FF9CCE',config:{date:''}},
  {id:'table',title:'记录表',description:'用自定表头整理记录。',icon:'layers',color:'#8EDBE8',config:{columns:[],rows:[]}},
  {id:'miniapp',title:'交互小程序',description:'在隔离运行器中使用生成的交互工具。',icon:'sparkles',color:'#FFBC7C',config:{code:'app.render([{type:"text",text:"我的小工具"}]);'}},
].map(item=>freeze({...item,kind:item.id})));
const kinds=new Map(CUSTOM_BLOCK_KINDS.map(item=>[item.id,item]));

/** Clone a bounded JSON object. This is the only mutable storage exposed to a miniapp. */
export function validateBlockData(value){
  if(!plain(value))fail('方块数据必须是 JSON 对象。');
  const seen=new Set();let nodes=0;
  function visit(current,depth){
    if(++nodes>20000||depth>10)fail('方块数据层级或数量超出上限。');
    if(typeof current==='string'&&current.length>64*1024)fail('方块数据不能超过 64 KiB。');
    if(current===null||typeof current==='boolean'||typeof current==='string')return current;
    if(typeof current==='number'){if(!Number.isFinite(current))fail('方块数据不能含无效数值。');return current;}
    if(!Array.isArray(current)&&!plain(current))fail('方块数据只能包含有限 JSON 值。');
    if(seen.has(current))fail('方块数据不能循环引用。');seen.add(current);
    let next;
    if(Array.isArray(current)){if(current.length>20000)fail('方块数据条目过多。');next=[];for(let index=0;index<current.length;index++){if(!Object.hasOwn(current,index))fail('方块数据数组不能包含空洞。');next.push(visit(current[index],depth+1));}}
    else{next={};for(const [key,item] of Object.entries(current)){if(forbidden.has(key)||key.length>256)fail('方块数据字段无效。');next[key]=visit(item,depth+1);}}
    seen.delete(current);return next;
  }
  const result=visit(value,0);if(new TextEncoder().encode(JSON.stringify(result)).length>64*1024)fail('方块数据不能超过 64 KiB。');return result;
}
export function validateCustomBlockConfig(kind,value){
  if(!kinds.has(kind))fail('不支持这种自定义方块。');
  if(kind==='note'){fields(value,['text']);return {text:text(value.text,50000)};}
  if(kind==='checklist'){fields(value,['items']);return {items:rows(value.items,100,item=>{fields(item,['id','label','done']);return {id:id(item.id),label:text(item.label,500,true),done:bool(item.done)};})};}
  if(kind==='links'){fields(value,['items']);return {items:rows(value.items,100,item=>{fields(item,['id','label','url']);return {id:id(item.id),label:text(item.label,200,true),url:url(item.url)};})};}
  if(kind==='progress'){fields(value,['value','target','unit']);return {value:numeric(value.value),target:numeric(value.target,Number.MIN_VALUE),unit:text(value.unit,30)};}
  if(kind==='countdown'){fields(value,['date']);if(!isValidDate(value.date))fail('请选择有效日期（YYYY-MM-DD）。');return {date:value.date};}
  if(kind==='table'){
    fields(value,['columns','rows']);const columns=rows(value.columns,10,column=>{fields(column,['id','label']);return {id:id(column.id),label:text(column.label,80,true)};});
    const records=rows(value.rows,100,row=>{fields(row,['id','cells']);if(!Array.isArray(row.cells)||row.cells.length!==columns.length)fail('记录表单元格与表头数量不一致。');return {id:id(row.id),cells:row.cells.map(cell=>text(cell,2000))};});return {columns,rows:records};
  }
  fields(value,['code']);return {code:text(value.code,30000,true)};
}
export function validateCustomBlock(value){
  fields(value,['id','kind','title','description','color','archived','config','data','createdAt','updatedAt','sourceRequestId'],['id','kind','title','description','color','archived','config','data','createdAt','updatedAt']);
  if(!kinds.has(value.kind))fail('方块类型无效。');if(!isRecordColor(value.color))fail('方块颜色无效。');
  return {id:blockId(value.id),kind:value.kind,title:text(value.title,80,true).trim(),description:text(value.description,2000),color:value.color,archived:bool(value.archived),config:validateCustomBlockConfig(value.kind,value.config),data:validateBlockData(value.data),createdAt:stamp(value.createdAt),updatedAt:stamp(value.updatedAt),...(value.sourceRequestId===undefined?{}:{sourceRequestId:id(value.sourceRequestId)})};
}
export function validateCustomBlocks(value){fields(value,['version','items']);if(value.version!==1)fail('自定义方块版本无效。');return {version:1,items:rows(value.items,50,validateCustomBlock)};}
export function getCustomBlocks(state){return state?.customBlocks===undefined?{version:1,items:[]}:validateCustomBlocks(state.customBlocks);}
export function createCustomBlock(state,input,{id:recordId=`block:${crypto.randomUUID()}`,now=new Date().toISOString()}={}){
  fields(input,['kind','title','description','color','config','data','sourceRequestId'],['kind','title']);const current=getCustomBlocks(state),kind=kinds.get(input.kind);if(!kind)fail('方块类型无效。');
  const record=validateCustomBlock({id:recordId,kind:input.kind,title:input.title,description:input.description??'',color:input.color??previewRecordColor(state),archived:false,config:input.config??structuredClone(kind.config),data:input.data??{},createdAt:now,updatedAt:now,...(input.sourceRequestId===undefined?{}:{sourceRequestId:input.sourceRequestId})});
  const next=validateCustomBlocks({...current,items:[...current.items,record]});state.customBlocks=next;return structuredClone(record);
}
export function updateCustomBlock(state,recordId,patch){
  fields(patch,['title','description','color','config','data','archived'],[]);if(!Object.keys(patch).length)fail('请指定要修改的方块内容。');
  const current=getCustomBlocks(state),index=current.items.findIndex(item=>item.id===recordId);if(index<0)fail('自定义方块不存在。');
  const record=validateCustomBlock({...current.items[index],...patch,updatedAt:new Date().toISOString()});current.items[index]=record;state.customBlocks=validateCustomBlocks(current);return structuredClone(record);
}
export function mergeCustomBlocks(current,incoming){
  const target=current===undefined?{version:1,items:[]}:validateCustomBlocks(current),source=validateCustomBlocks(incoming),known=new Set(target.items.map(item=>item.id));
  return validateCustomBlocks({...target,items:[...target.items,...source.items.filter(item=>!known.has(item.id))]});
}
