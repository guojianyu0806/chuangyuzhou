import {getWorkbench,getVisibleModules} from './workbench-model.js';
import {CUSTOM_BLOCK_KINDS,getCustomBlocks} from './custom-blocks-model.js';

export const MAX_WELCOME_CARDS=100;
const blockKinds=new Map(CUSTOM_BLOCK_KINDS.map(kind=>[kind.id,kind]));
const rows=value=>Array.isArray(value)?value:[];
const active=value=>rows(value).filter(item=>item&&!item.archived);
const color=(value,fallback='#AE88FF')=>typeof value==='string'&&/^#[a-f\d]{6}$/i.test(value)?value:fallback;
const label=(value,fallback,limit=80)=>typeof value==='string'&&value.trim()?value.trim().slice(0,limit):fallback;
const iconName=value=>typeof value==='string'&&/^[a-z][a-z\d-]{0,39}$/i.test(value)?value:'folder';
const spaceId=value=>typeof value==='string'&&!!value.trim()&&value.length<=512&&!/[\u0000-\u001f\u007f-\u009f]/.test(value);

function moduleMetric(state,id) {
  switch(id){
    case 'courses':return `${active(state.courses).length} 门课程`;
    case 'english':return `${active(state.english?.words).length} 个词汇`;
    case 'inbox':return `${active(state.captures).length} 条灵感`;
    case 'tasks':return `${active(state.tasks).filter(task=>!task.done).length} 项待办`;
    case 'review':return `${active(state.tasks).filter(task=>task.done).length} 项已完成`;
    case 'ledger':return `${active(state.ledger?.entries).length} 笔记录`;
    case 'calendar':return `${active(state.calendar?.events).length} 项自建日程`;
    case 'timetable':return `${active(state.timetable?.terms).length} 个学期`;
    case 'competitions':return `${active(state.competitions?.items).length} 项比赛`;
    default:return '随时一起搭建';
  }
}

function blockMetric(block,kind) {
  switch(block.kind){
    case 'checklist':return `${block.config.items.filter(item=>item.done).length} / ${block.config.items.length} 项完成`;
    case 'links':return `${block.config.items.length} 个入口`;
    case 'table':return `${block.config.rows.length} 条记录`;
    default:return kind.title;
  }
}

function boundedCards(cards) {
  const selected=cards.slice(0,MAX_WELCOME_CARDS);
  if(cards.length<=MAX_WELCOME_CARDS)return selected;
  // Keep one example of every existing kind even when many spaces occur before
  // the custom blocks in canvas order. The entrance can then form its overview.
  for(const kind of ['module','space','block']){
    if(selected.some(card=>card.kind===kind))continue;
    const representative=cards.find(card=>card.kind===kind);
    if(!representative)continue;
    const index=selected.findLastIndex(card=>selected.filter(entry=>entry.kind===card.kind).length>1);
    if(index>=0)selected[index]=representative;
  }
  const order=new Map(cards.map((card,index)=>[card.id,index]));
  return selected.sort((first,second)=>order.get(first.id)-order.get(second.id));
}

/**
 * Read-only entrance catalogue for the current authenticated workspace.
 * It uses the home canvas visibility rules without initializing canvas geometry.
 * Card bodies, attachments, URLs, miniapp source/data and credentials never leave
 * this selector. The view must still escape user-supplied titles and owner names.
 */
export function getWelcomeModel(input) {
  const state=input&&typeof input==='object'?input:{};
  const workbench=getWorkbench(state),modules=getVisibleModules({workbench});
  const storedCards=rows(state.canvas?.cards),canvasById=new Map();
  for(const card of storedCards)if(card&&typeof card.id==='string'&&!canvasById.has(card.id))canvasById.set(card.id,card);
  const cardColor=(id,fallback)=>color(canvasById.get(id)?.color,color(fallback));
  const cards=modules.map(module=>({
    id:module.id,title:module.title,icon:module.icon,color:cardColor(module.id,module.color),kind:'module',
    summary:module.description,metric:moduleMetric(state,module.id),route:module.id,
  }));
  const extra=new Map(),seen=new Set(workbench.modules.map(module=>module.id));
  for(const space of active(state.spaces)){
    if(!spaceId(space.id)||seen.has(space.id))continue;
    seen.add(space.id);
    extra.set(space.id,{
      id:space.id,title:label(space.title,'未命名工作区'),icon:iconName(space.icon),color:cardColor(space.id,space.color),kind:'space',
      summary:'把笔记、资料和事项放在一起。',metric:`${active(space.notes).length} 篇笔记`,route:'space',subroute:space.id,
    });
  }
  for(const block of getCustomBlocks(state).items){
    if(block.archived||seen.has(block.id))continue;
    seen.add(block.id);
    const kind=blockKinds.get(block.kind);
    extra.set(block.id,{
      id:block.id,title:block.title,icon:kind.icon,color:cardColor(block.id,block.color),kind:'block',
      summary:kind.description,metric:blockMetric(block,kind),route:'block',subroute:block.id,
    });
  }
  // Existing extra cards keep their canvas order; new entries work before a first
  // visit to /home has created default card positions.
  for(const card of storedCards){
    const entry=extra.get(card?.id);
    if(entry){cards.push(entry);extra.delete(card.id);}
  }
  cards.push(...extra.values());
  const counts={modules:modules.length,spaces:0,blocks:0,total:cards.length};
  for(const card of cards){if(card.kind==='space')counts.spaces++;else if(card.kind==='block')counts.blocks++;}
  return {
    title:workbench.title,owner:label(state.profile?.name,''),cards:boundedCards(cards),counts,
    totalCount:cards.length,truncated:cards.length>MAX_WELCOME_CARDS,
  };
}
