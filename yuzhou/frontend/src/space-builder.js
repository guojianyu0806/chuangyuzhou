import {placementHTML,mountPlacement} from './placement.js';
import {spaceWorkbenchCatalog,spacePlacementModel,hideSpaceBlock,saveSpacePlacement} from './space-workbench-model.js';
import {getCustomBlocks} from './custom-blocks-model.js';
import {createPresetInput} from './custom-block-presets.js';
import {builderScopeHTML,mountBuilderScope} from './builder-scope.js';

export function mountSpaceBuilder(ctx,spaceId){
  const {root,state,esc,icon,toast}=ctx,space=state.spaces.find(item=>item.id===spaceId);
  if(!space||space.archived){root.innerHTML='<div class="empty-state"><h2>这个空间暂时不能搭建</h2><p>空间已归档或不存在，请返回上级工作台。</p></div>';return ()=>{};}
  const session=ctx.builderSession||{},placementSession=session.placement||={},model=spacePlacementModel(spaceId);let dispose,active=true;
  const openCard=item=>item.kind==='section'?(item.id==='assistant'?ctx.askSpaceAI?.():ctx.go('space',spaceId,item.id)):item.kind==='module'?ctx.go(item.id.slice(7)):ctx.go(item.kind==='block'?'block':'space',item.id);
  const scoped={...ctx,spaceId,placementModel:model,openPlacementCard:openCard,createPresetAt:(id,placement)=>ctx.openCustomBlockEditor(createPresetInput(id),{placement,onCreated:()=>render()})};
  function render(){
    if(!active)return;dispose?.();const catalog=spaceWorkbenchCatalog(state,spaceId),config={modules:catalog};
    root.innerHTML=`<section class="wb-builder"><header class="wb-heading"><div><p class="wb-kicker">子空间搭建台</p><h1>${esc(space.title)}</h1><p class="wb-intro">这里的摆放、方块和下级空间独立保存。</p></div><button type="button" class="btn primary" data-sb-action="enter">进入空间画布 ${icon('arrow-right',17)}</button></header>${builderScopeHTML(state,spaceId)}<div data-space-placement>${placementHTML(state,{model,config,catalog:catalog.filter(item=>['section','module'].includes(item.kind)),blocks:getCustomBlocks(state).items.filter(block=>block.spaceId===spaceId),title:space.title,allowChildSpace:true})}</div><section class="panel"><h2>已放置的内容</h2><p class="muted">收起入口只调整展示，已有记录会保留。</p><div class="space-block-controls">${catalog.filter(item=>item.enabled).map(item=>`<span><strong>${esc(item.title)}</strong>${item.kind==='section'&&item.id!=='assistant'||item.kind==='module'?`<button class="text-btn" type="button" data-sb-action="hide" data-id="${esc(item.id)}">收起</button>`:''}${item.kind==='block'?`<button class="text-btn" type="button" data-sb-action="edit" data-id="${esc(item.id)}">编辑方块</button>`:''}</span>`).join('')}</div></section></section>`;
    dispose=mountPlacement({...scoped,root:root.querySelector('[data-space-placement]'),onPlacementSaved:render},placementSession);
  }
  const click=event=>{const button=event.target.closest('[data-sb-action],[data-wb-action]');if(!button)return;const action=button.dataset.sbAction||button.dataset.wbAction;
    try{if(action==='enter')ctx.go('space',spaceId);if(action==='ai'||action==='ask-ai'||action==='ask-miniapp')ctx.askSpaceAI?.(action==='ask-miniapp'?'miniapp':undefined);if(action==='child')ctx.createChildSpace?.();if(action==='create-block')ctx.openCustomBlockEditor();if(action==='edit')ctx.openCustomBlockEditor(button.dataset.id);if(action==='hide'){saveSpacePlacement(ctx,spaceId,state=>hideSpaceBlock(state,spaceId,button.dataset.id));render();toast('入口已收起，内容保留。');}}catch(error){toast(error.message);}};
  const disposeScope=mountBuilderScope(ctx,spaceId);
  root.addEventListener('click',click);render();if(session.scroll&&globalThis.requestAnimationFrame)requestAnimationFrame(()=>{if(active)globalThis.scrollTo?.(session.scroll);});
  return ()=>{session.scroll={left:globalThis.scrollX||0,top:globalThis.scrollY||0,behavior:'instant'};active=false;dispose?.();disposeScope();root.removeEventListener('click',click);};
}
