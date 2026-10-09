import {ensureCanvas,visibleCanvasCards} from './canvas.js';
import {WORKBENCH_MODULES,getWorkbench,configureWorkbench} from './workbench-model.js';
import {getCustomBlocks,CUSTOM_BLOCK_KINDS} from './custom-blocks-model.js';

const clone=value=>structuredClone(value);
const knownModules=new Map(WORKBENCH_MODULES.map(module=>[module.id,module]));
const has=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const snapshot=state=>Object.fromEntries(['workbench','canvas'].map(key=>[key,{present:has(state,key),...(has(state,key)?{value:clone(state[key])}:{})}]));
function restore(state,record){for(const key of ['workbench','canvas']){if(record[key].present)state[key]=clone(record[key].value);else delete state[key];}}
function stamp(state){return {present:has(state,'updatedAt'),value:state.updatedAt};}
function restoreStamp(state,previous){if(previous.present)state.updatedAt=previous.value;else delete state.updatedAt;}
function markLayout(canvas){canvas.presentation='canvas';canvas.initialized=true;canvas.customized=true;canvas.modifiedAt=new Date().toISOString();}

/** Read geometry without initializing or normalizing the user's saved workspace. */
export function placementLayout(state) {
  const copy={canvas:clone(state?.canvas),spaces:(state?.spaces||[]).map(space=>({id:space.id,color:space.color})),customBlocks:getCustomBlocks(state)};
  return ensureCanvas(copy);
}

/** These are the real home-canvas coordinates, enriched only for the builder's rendering. */
export function placementCards(state) {
  const modules=new Map(getWorkbench(state).modules.map(module=>[module.id,module]));
  const spaces=new Map((state?.spaces||[]).map(space=>[space.id,space]));
  const blocks=new Map(getCustomBlocks(state).items.map(block=>[block.id,block]));
  return visibleCanvasCards(state,placementLayout(state)).map(card=>{
    const block=blocks.get(card.id);
    if(block){const type=CUSTOM_BLOCK_KINDS.find(type=>type.kind===block.kind||type.id===block.kind);return {...card,title:block.title,icon:type?.icon||'layers',description:block.description||type?.description||'自定义方块',kind:'block'};}
    const module=knownModules.get(card.id),item=module?modules.get(card.id):spaces.get(card.id);
    return {...card,title:item?.title||module?.title||'未命名空间',icon:module?.icon||item?.icon||'folder',description:module?.description||item?.description||'保存这个主题的文件、笔记与待办。',kind:module?'module':'space'};
  });
}

function position(value){
  if(typeof value!=='number'||!Number.isFinite(value)||value < -100000||value > 100000)throw new Error('放置位置须在画布范围内。');
  return Math.round(value/40)*40;
}

/** Commit one drop atomically; other cards, including hidden modules, retain their positions. */
export function placeBlock(state,id,point) {
  const module=knownModules.get(id),space=(state?.spaces||[]).find(item=>item.id===id&&!item.archived);
  const block=getCustomBlocks(state).items.find(item=>item.id===id&&!item.archived);
  if(!module&&!space&&!block)throw new Error('这个方块已不存在或已归档。');
  if(!point||typeof point!=='object'||Array.isArray(point))throw new Error('请先选择画布上的位置。');
  const x=position(point.x),y=position(point.y),next={workbench:getWorkbench(state),canvas:placementLayout(state)};
  const card=next.canvas.cards.find(item=>item.id===id);
  if(!card)throw new Error('这个方块暂时不能放置。');
  configureWorkbench(next,module?{moduleId:id,enabled:true}:{title:next.workbench.title});
  card.x=x;card.y=y;markLayout(next.canvas);
  state.workbench=next.workbench;state.canvas=next.canvas;
  return clone(card);
}

/** Arrange visible cards only. Fixed column widths prevent overlaps across mixed card sizes. */
export function arrangeBlocks(state) {
  const next={workbench:getWorkbench(state),canvas:placementLayout(state),spaces:state.spaces||[],customBlocks:getCustomBlocks(state)};
  const cards=visibleCanvasCards(next,next.canvas),widths=[0,0,0];
  cards.forEach((card,index)=>{widths[index%3]=Math.max(widths[index%3],card.w);});
  let y=40;
  for(let start=0;start<cards.length;start+=3){
    const row=cards.slice(start,start+3);let x=40;
    if(y>100000)throw new Error('方块过多，已超出自动排列范围，请分批整理。');
    row.forEach((card,column)=>{card.x=x;card.y=y;x+=widths[column]+40;});
    y+=Math.max(...row.map(card=>card.h))+40;
  }
  configureWorkbench(next,{title:next.workbench.title});markLayout(next.canvas);
  state.workbench=next.workbench;state.canvas=next.canvas;
  return clone(cards);
}

/** App saves are synchronous local commits; cloud synchronization remains in the existing queue. */
export function savePlacement(ctx,mutation) {
  const before=snapshot(ctx.state),previousStamp=stamp(ctx.state);
  try{mutation(ctx.state);ctx.save();return {before,after:snapshot(ctx.state)};}
  catch(error){restore(ctx.state,before);restoreStamp(ctx.state,previousStamp);throw error;}
}

/** Never erase later manual or AI layout/configuration changes. Business records are untouched. */
export function undoPlacement(ctx,record) {
  if(!record?.before||!record?.after||!equal(snapshot(ctx.state),record.after))return false;
  const current=snapshot(ctx.state),previousStamp=stamp(ctx.state);
  try{restore(ctx.state,record.before);ctx.save();return true;}
  catch(error){restore(ctx.state,current);restoreStamp(ctx.state,previousStamp);throw error;}
}
