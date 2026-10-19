import {escapeHTML as esc} from './services.js';
import {getWorkbench} from './workbench-model.js';

/** Only reachable, active spaces are offered. Reading the catalogue never saves data. */
export function builderScopes(state){
  const spaces=(state.spaces||[]).filter(space=>!space.archived),children=new Map(),seen=new Set();
  for(const space of spaces){const parent=space.parentId||'';if(!children.has(parent))children.set(parent,[]);children.get(parent).push(space);}
  const result=[{id:'',title:'主画布',path:getWorkbench(state).title,depth:0}],stack=[...(children.get('')||[])].reverse().map(space=>({space,parents:[]}));
  while(stack.length){const {space,parents}=stack.pop();if(seen.has(space.id))continue;seen.add(space.id);const path=[...parents,space.title];result.push({id:space.id,title:space.title,path:path.join(' / '),depth:parents.length+1});for(const child of [...(children.get(space.id)||[])].reverse())stack.push({space:child,parents:path});}
  return result;
}

export function builderScopeId(state,{route,subroute=''}){
  let id=['space','builder'].includes(route)?subroute:route==='block'?state.customBlocks?.items?.find(block=>block.id===subroute)?.spaceId:route==='ai'?(subroute.startsWith('space:')?subroute.slice(6):subroute):'';
  return id&&builderScopes(state).some(item=>item.id===id)?id:'';
}

export function builderScopeHTML(state,currentId=''){
  const scopes=builderScopes(state),current=scopes.find(item=>item.id===currentId);
  return `<section class="wb-scope-switcher" aria-label="搭建画布切换"><label><span>选择搭建画布</span><select data-builder-scope aria-label="选择搭建画布">${scopes.map(item=>`<option value="${esc(item.id)}" ${item.id===currentId?'selected':''}>${esc(item.id?`${'　'.repeat(Math.min(4,item.depth-1))}${item.depth>1?'↳ ':''}${item.title}`:'主画布 · '+item.path)}</option>`).join('')}</select></label><div><strong>${esc(currentId?current?.path||'当前空间':'正在搭建主画布')}</strong><p>${currentId?'左侧拖入的方块会放进这个空间；主画布保持原样。':'想调整子空间？在左侧选择它，直接进入它自己的搭建画布。'}</p></div></section>`;
}

export function mountBuilderScope(ctx,currentId=''){
  const change=event=>{const select=event.target.closest?.('[data-builder-scope]');if(!select||!ctx.root.contains(select))return;const id=select.value;if(!builderScopes(ctx.state).some(item=>item.id===id)){select.value=currentId;ctx.toast('这个空间已不可用，请重新选择。');return;}if(id!==currentId)ctx.go('builder',id);};
  ctx.root.addEventListener('change',change);return ()=>ctx.root.removeEventListener('change',change);
}
