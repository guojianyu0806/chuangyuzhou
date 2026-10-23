import {ensureCanvas} from './canvas.js';
import {WORKBENCH_MODULES} from './workbench-model.js';
import {getCustomBlocks,CUSTOM_BLOCK_KINDS} from './custom-blocks-model.js';
import {SPACE_SECTIONS,getSpaceWorkbench,validateSpaceWorkbench} from './space-workbench-config.js';

const clone=value=>value===undefined?undefined:structuredClone(value);
export const spaceBoardKey=id=>`space:${id}:workbench`;
const find=(state,id)=>{const space=state.spaces?.find(item=>item.id===id);if(!space)throw Error('这个空间已不存在。');return space;};
export function spaceWorkbenchCatalog(state,id){
  const space=find(state,id),config=getSpaceWorkbench(space);
  return [...SPACE_SECTIONS.map(item=>({...item,kind:'section',enabled:config.sections.includes(item.id)})),
    ...WORKBENCH_MODULES.filter(item=>item.id!=='ai').map(item=>({...item,id:`module:${item.id}`,title:`${item.title} · 共享入口`,kind:'module',enabled:config.modules.includes(item.id),description:'打开已有全局模块，返回后继续当前空间。'})),
    ...getCustomBlocks(state).items.filter(item=>item.spaceId===id&&!item.archived).map(item=>({...item,blockKind:item.kind,kind:'block',icon:CUSTOM_BLOCK_KINDS.find(type=>type.id===item.kind)?.icon||'layers',enabled:true})),
    ...(state.spaces||[]).filter(item=>item.parentId===id&&!item.archived).map(item=>({...item,kind:'space',enabled:true}))];
}
export function spaceWorkbenchLayout(state,id){
  const items=spaceWorkbenchCatalog(state,id);let visibleIndex=0;
  const presets=Object.fromEntries(items.map((item,index)=>{const slot=item.enabled?visibleIndex++:index;return [item.id,{...item,x:40+(slot%3)*380,y:40+Math.floor(slot/3)*350,w:340,h:300}];}));
  return ensureCanvas({canvas:clone(state.boards?.[spaceBoardKey(id)]),spaces:[]},presets);
}
export function spaceWorkbenchCards(state,id){const geometry=spaceWorkbenchLayout(state,id);return spaceWorkbenchCatalog(state,id).filter(item=>item.enabled).map(item=>({...geometry.cards.find(card=>card.id===item.id),...item}));}
export function placeSpaceBlock(state,spaceId,id,point){
  const space=find(state,spaceId);if(space.archived)throw Error('请先恢复这个空间，再调整搭建。');
  const item=spaceWorkbenchCatalog(state,spaceId).find(item=>item.id===id);if(!item)throw Error('方块已不存在或属于其他空间。');
  for(const key of ['x','y'])if(!Number.isFinite(point?.[key])||Math.abs(point[key])>100000)throw Error('方块位置超出画布范围。');
  const config=getSpaceWorkbench(space);
  if(item.kind==='section'&&!config.sections.includes(id))config.sections.push(id);
  if(item.kind==='module'&&!config.modules.includes(id.slice(7)))config.modules.push(id.slice(7));
  if(['section','module'].includes(item.kind))space.workbench=validateSpaceWorkbench(config);if(id==='fitness')space.fitnessEnabled=true;
  const layout=spaceWorkbenchLayout(state,spaceId),card=layout.cards.find(card=>card.id===id);
  card.x=Math.round(point.x/40)*40;card.y=Math.round(point.y/40)*40;layout.presentation='canvas';layout.initialized=true;layout.customized=true;layout.modifiedAt=new Date().toISOString();
  state.boards||={};state.boards[spaceBoardKey(spaceId)]=layout;return clone(card);
}
export function hideSpaceBlock(state,spaceId,id){
  const space=find(state,spaceId),config=getSpaceWorkbench(space);if(id==='assistant')throw Error('AI 伙伴入口需要保留。');
  if(id.startsWith('module:'))config.modules=config.modules.filter(item=>item!==id.slice(7));else config.sections=config.sections.filter(item=>item!==id);
  space.workbench=validateSpaceWorkbench(config);
}
function snapshot(state,id){return {space:clone(find(state,id)),board:clone(state.boards?.[spaceBoardKey(id)]),boardsPresent:Object.hasOwn(state,'boards'),stamp:state.updatedAt};}
function restore(state,id,before){const space=find(state,id);for(const key of Object.keys(space))delete space[key];Object.assign(space,clone(before.space));state.boards||={};if(before.board===undefined)delete state.boards[spaceBoardKey(id)];else state.boards[spaceBoardKey(id)]=clone(before.board);if(!before.boardsPresent&&!Object.keys(state.boards).length)delete state.boards;state.updatedAt=before.stamp;}
export function saveSpacePlacement(ctx,spaceId,mutation){const before=snapshot(ctx.state,spaceId);try{mutation(ctx.state);ctx.save();return {before,after:snapshot(ctx.state,spaceId)};}catch(error){restore(ctx.state,spaceId,before);throw error;}}
export function spacePlacementModel(spaceId){return {
  cards:state=>spaceWorkbenchCards(state,spaceId),layout:state=>spaceWorkbenchLayout(state,spaceId),
  place:(state,id,point)=>placeSpaceBlock(state,spaceId,id,point),save:(ctx,mutation)=>saveSpacePlacement(ctx,spaceId,mutation),
  arrange(state){spaceWorkbenchCards(state,spaceId).forEach((item,index)=>placeSpaceBlock(state,spaceId,item.id,{x:40+(index%3)*380,y:40+Math.floor(index/3)*350}));},
  undo(ctx,record){if(!record||JSON.stringify(snapshot(ctx.state,spaceId))!==JSON.stringify(record.after))return false;const now=snapshot(ctx.state,spaceId);try{restore(ctx.state,spaceId,record.before);ctx.save();return true;}catch(error){restore(ctx.state,spaceId,now);throw error;}},
  title:(state,id)=>spaceWorkbenchCatalog(state,spaceId).find(item=>item.id===id)?.title||'方块'
};}
