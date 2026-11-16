import {isTopicBatchId,normalizeTopicName,TOPIC_ASSIGNMENT_LIMIT} from './workspace-topics-model.js';

export const MAX_CANVAS_TOPIC_BOXES=128;
export const TOPIC_BOX_WIDTH=328;
export const TOPIC_BOX_HEADER=72;
const PAD=16,GAP=16;
const fields=['id','title','x','y','collapsed','cardIds'];
const invalid=()=>{throw new Error('画布收纳盒数据格式不正确。');};

export function isCanvasTopicBoxCardId(value){
  return typeof value==='string'&&value.length<=512&&Boolean(value.trim())&&
    !['ai','__proto__','constructor','prototype'].includes(value)&&!/[\u0000-\u001f]/.test(value);
}

export function validateCanvasTopicBoxes(value){
  if(!Array.isArray(value)||value.length>MAX_CANVAS_TOPIC_BOXES)invalid();
  const boxIds=new Set(),members=new Set();
  return value.map(box=>{
    if(!box||typeof box!=='object'||Array.isArray(box)||Object.keys(box).length!==fields.length||
      fields.some(key=>!Object.hasOwn(box,key))||!isTopicBatchId(box.id)||boxIds.has(box.id))invalid();
    const {id,title,x,y,collapsed,cardIds}=box;
    if(![x,y].every(n=>Number.isFinite(n)&&Math.abs(n)<=100000)||
      typeof collapsed!=='boolean'||!Array.isArray(cardIds)||cardIds.length>TOPIC_ASSIGNMENT_LIMIT)invalid();
    if(normalizeTopicName(title)!==title)invalid();
    boxIds.add(id);
    for(const cardId of cardIds){
      if(!isCanvasTopicBoxCardId(cardId)||members.has(cardId))invalid();
      members.add(cardId);
      if(members.size>TOPIC_ASSIGNMENT_LIMIT)invalid();
    }
    return {id,title,x,y,collapsed,cardIds:[...cardIds]};
  });
}

/** Compute the cards' display positions. Loose card geometry stays authoritative. */
export function layoutCanvasTopicBoxes(cards,boxes){
  const byId=new Map(cards.map(card=>[card.id,card]));
  const memberships=new Map(),positions=new Map();
  const regions=boxes.map(box=>{
    const members=box.cardIds.map(id=>byId.get(id)).filter(Boolean);
    for(const card of members)memberships.set(card.id,box.id);
    let w=TOPIC_BOX_WIDTH,h=TOPIC_BOX_HEADER;
    if(!box.collapsed){
      for(let start=0;start<members.length;start+=2){
        const row=members.slice(start,start+2);
        let x=PAD,rowHeight=0;
        for(const card of row){
          positions.set(card.id,{x:box.x+x,y:box.y+h});
          rowHeight=Math.max(rowHeight,card.h);
          x+=card.w+GAP;
        }
        w=Math.max(w,x-GAP+PAD);
        h+=rowHeight+GAP;
      }
      if(!members.length)h+=38;
    }
    return {id:box.id,x:box.x,y:box.y,w,h,count:members.length};
  });
  return {regions,memberships,positions,cards:cards.filter(card=>!memberships.has(card.id)||positions.has(card.id))};
}

/** Assign only the selected cards to a box, removing their old memberships. */
export function setCanvasTopicBoxMembers(boxes,boxId,cardIds){
  if(!boxes.some(box=>box.id===boxId))return boxes;
  const selected=new Set(cardIds);
  return boxes.map(box=>box.id===boxId?{...box,cardIds:[...selected]}
    :{...box,cardIds:box.cardIds.filter(id=>!selected.has(id))});
}
