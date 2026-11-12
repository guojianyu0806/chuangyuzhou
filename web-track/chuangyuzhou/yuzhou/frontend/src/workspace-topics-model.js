import {getVisibleModules} from './workbench-model.js';
import {CUSTOM_BLOCK_KINDS,getCustomBlocks} from './custom-blocks-model.js';

export const TOPIC_CARD_LIMIT=24;
export const TOPIC_NAME_LIMIT=40;
export const TOPIC_ASSIGNMENT_LIMIT=2048;
export const TOPIC_RECEIPT_LIMIT=512;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BLOCK_LABELS=new Map(CUSTOM_BLOCK_KINDS.map(kind=>[kind.id,kind.title]));
const invalid=()=>{throw new Error('主题归类数据格式不正确。');};
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));

export function isTopicBatchId(value){return typeof value==='string'&&UUID.test(value);}
export function isTopicCardId(value){
  return typeof value==='string'&&value.length>0&&value.length<=160&&!/[\x00-\x1f\x7f]/.test(value)&&!['__proto__','constructor','prototype'].includes(value);
}
export function isWorkspaceTopicCandidateId(value){
  return value!=='ai'&&isTopicCardId(value);
}
export function normalizeTopicName(value){
  if(typeof value!=='string'||/[\x00-\x1f\x7f]/.test(value))invalid();
  const topic=value.trim().replace(/\s+/gu,' ');
  if(!topic||topic.length>TOPIC_NAME_LIMIT)invalid();
  return topic;
}

/** Read classifiable home canvas cards without initializing card geometry. */
export function visibleWorkspaceTopicCards(state){
  if(!state)return [];
  const modules=getVisibleModules(state).map(({id,title,description})=>({id,title,description,kind:'module'}));
  const blocks=getCustomBlocks(state).items.filter(block=>!block.archived&&!block.spaceId).map(block=>({
    id:block.id,title:block.title,kind:'block',description:[BLOCK_LABELS.get(block.kind),block.description].filter(Boolean).join(' · ').slice(0,400),
  }));
  const spaces=(state.spaces||[]).filter(space=>!space.archived&&!space.parentId).map(space=>({
    id:space.id,title:String(space.title||'').slice(0,160),kind:'space',description:String(space.description||'').slice(0,400),
  }));
  const seen=new Set();
  return [...modules,...blocks,...spaces].filter(card=>isWorkspaceTopicCandidateId(card.id)&&!seen.has(card.id)&&seen.add(card.id));
}

export function validateCanvasTopicLabels(value){
  return list(value,TOPIC_ASSIGNMENT_LIMIT,row=>{
    fields(row,['id','offsetX','offsetY']);
    if([row.offsetX,row.offsetY].some(offset=>typeof offset!=='number'||!Number.isFinite(offset)||Math.abs(offset)>100000))invalid();
    return {id:cardId(row.id),offsetX:row.offsetX,offsetY:row.offsetY};
  },row=>row.id);
}

function fields(value,required,optional=[]){
  if(!plain(value)||required.some(key=>!Object.hasOwn(value,key))||Object.keys(value).some(key=>!required.includes(key)&&!optional.includes(key)))invalid();
}
function list(value,max,parse,identity){
  if(!Array.isArray(value)||value.length>max)invalid();
  const rows=value.map(parse);
  if(new Set(rows.map(identity)).size!==rows.length)invalid();
  return rows;
}
function cardId(value){if(!isTopicCardId(value))invalid();return value;}
function batchId(value){if(!isTopicBatchId(value))invalid();return value;}
function topicName(value){if(normalizeTopicName(value)!==value)invalid();return value;}
function stamp(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value)invalid();
  return value;
}
function assignment(value,withCard){
  fields(value,withCard?['id','topic','batchId']:['topic','batchId']);
  return {...(withCard?{id:cardId(value.id)}:{}),topic:value.topic===null?null:topicName(value.topic),batchId:batchId(value.batchId)};
}
function change(value,allowUnclassified){
  fields(value,['id','topic','previous']);
  const topic=allowUnclassified&&value.topic===null?null:topicName(value.topic);
  return {id:cardId(value.id),topic,previous:value.previous===null?null:assignment(value.previous,false)};
}
function receipt(value){
  fields(value,['batchId','status','requestHash','confirmedAt','changes'],['undoneAt','skipped','kind']);
  if(!['confirmed','undone'].includes(value.status)||typeof value.requestHash!=='string'||!/^[a-f0-9]{64}$/.test(value.requestHash))invalid();
  const isMove=Object.hasOwn(value,'kind');
  if(isMove&&value.kind!=='move')invalid();
  const changes=list(value.changes,isMove?1:TOPIC_CARD_LIMIT,row=>change(row,isMove),row=>row.id);
  if(!changes.length)invalid();
  const base={batchId:batchId(value.batchId),status:value.status,requestHash:value.requestHash,confirmedAt:stamp(value.confirmedAt),changes,
    ...(isMove?{kind:'move'}:{})};
  if(changes.some(row=>row.previous?.batchId===base.batchId||(row.previous?.topic??null)===row.topic))invalid();
  if(value.status==='confirmed'){
    if(Object.hasOwn(value,'undoneAt')||Object.hasOwn(value,'skipped'))invalid();
    return base;
  }
  const skipped=list(value.skipped,TOPIC_CARD_LIMIT,cardId,id=>id);
  if(skipped.some(id=>!changes.some(row=>row.id===id)))invalid();
  return {...base,undoneAt:stamp(value.undoneAt),skipped};
}

export function validateWorkspaceTopics(value){
  fields(value,['assignments','receipts']);
  const assignments=list(value.assignments,TOPIC_ASSIGNMENT_LIMIT,row=>assignment(row,true),row=>row.id);
  const receipts=list(value.receipts,TOPIC_RECEIPT_LIMIT,receipt,row=>row.batchId);
  const batches=new Map(receipts.map(row=>[row.batchId,row]));
  for(const {id,topic,batchId} of assignments){
    const batch=batches.get(batchId);
    const change=batch?.changes.find(row=>row.id===id);
    if(!change||batch.skipped?.includes(id))invalid();
    if(topic!==(batch.status==='confirmed'?change.topic:change.previous?.topic??null))invalid();
  }
  return {assignments,receipts};
}
