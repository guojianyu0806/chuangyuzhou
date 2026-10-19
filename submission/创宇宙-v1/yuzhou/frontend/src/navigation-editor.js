import {getNavigationItems,configureNavigation,resetNavigation} from './navigation-model.js';
import {escapeHTML as esc} from './services.js';
import {icon} from './icons.js';

const groups=[
  {id:'primary',title:'直接显示',hint:'常用入口，打开侧栏就能看见'},
  {id:'more',title:'收进更多',hint:'点击侧栏的“更多”后展开'},
  {id:'hidden',title:'不在侧栏显示',hint:'仍可从工作台进入，内容会保留'},
];
const mandatory=id=>id==='home'||id==='builder';
const kindLabel=kind=>kind==='space'?'自定义空间':kind==='core'?'基础入口':'工作台模块';
const glyph=item=>`<span class="wb-nav-glyph" style="--wb-nav-color:${/^#[0-9a-f]{6}$/i.test(item.color||'')?item.color:'#B3A0FF'}">${icon(item.icon||'layers',17)}</span>`;
const previewItem=item=>`<li>${icon(item.icon||'layers',16)}<span>${esc(item.title)}</span></li>`;

export function navigationEditorHTML(state,{expanded=false,message='调整后自动保存，只改变侧栏入口。'}={}) {
  const items=getNavigationItems(state),primary=items.filter(item=>item.placement==='primary'),more=items.filter(item=>item.placement==='more');
  return `<details class="wb-navigation" data-navigation-details ${expanded?'open':''}>
    <summary><span class="wb-nav-summary-icon" aria-hidden="true">${icon('menu',21)}</span><span class="wb-nav-summary-copy"><strong>侧栏导航</strong><span>调整顺序，以及哪些入口直接显示、收进更多或隐藏</span></span><span class="wb-nav-summary-count">${primary.length} 项直接显示 · ${more.length} 项更多</span><span class="wb-nav-summary-toggle" aria-hidden="true">${icon('chevron-down',17)}</span></summary>
    <div class="wb-nav-editor"><div class="wb-nav-editor-head"><p>拖动每行左边的手柄排列，也可以用上下按钮。工作台与搭建台会始终保留。</p><button type="button" class="wb-nav-reset" data-navigation-action="reset">${icon('refresh',15)} 恢复默认导航</button></div>
      <div class="wb-nav-columns"><div class="wb-nav-groups" data-navigation-scroll>${groups.map(group=>{
        const rows=items.filter(item=>item.placement===group.id);
        return `<section class="wb-nav-group" data-navigation-group="${group.id}" aria-labelledby="wb-nav-group-${group.id}"><div class="wb-nav-group-heading"><h3 id="wb-nav-group-${group.id}">${group.title}<span>${rows.length}</span></h3><p>${group.hint}</p></div><ol>${rows.map((item,index)=>`<li class="wb-nav-row" data-navigation-row="${esc(item.id)}">
          <button type="button" class="wb-nav-grip" data-navigation-grip="${esc(item.id)}" aria-label="拖动排列${esc(item.title)}" title="拖动排列；也可使用右边的上下按钮">${icon('menu',17)}</button>${glyph(item)}<span class="wb-nav-row-name"><strong>${esc(item.title)}</strong><small>${kindLabel(item.kind)}</small></span>
          <select data-navigation-placement="${esc(item.id)}" aria-label="${esc(item.title)}的侧栏位置" ${mandatory(item.id)?'disabled':''}>${groups.map(option=>`<option value="${option.id}" ${option.id===item.placement?'selected':''}>${option.title}</option>`).join('')}</select>
          <span class="wb-nav-row-moves"><button type="button" data-navigation-action="up" data-navigation-id="${esc(item.id)}" aria-label="上移${esc(item.title)}" ${index===0?'disabled':''}>${icon('arrow-left',15)}</button><button type="button" data-navigation-action="down" data-navigation-id="${esc(item.id)}" aria-label="下移${esc(item.title)}" ${index===rows.length-1?'disabled':''}>${icon('arrow-right',15)}</button></span>
        </li>`).join('')}</ol>${rows.length?'':`<p class="wb-nav-empty">${group.id==='primary'?'拖到这里，直接显示':group.id==='more'?'把不常用的入口收在这里':'把暂时不需要的入口拖到这里'}</p>`}</section>`;
      }).join('')}</div>
      <aside class="wb-nav-preview" aria-label="侧栏效果预览"><div class="wb-nav-preview-heading"><span>${icon('orbit',19)}</span><strong>侧栏效果</strong><small>同步预览</small></div><ul>${primary.map(previewItem).join('')}</ul>${more.length?`<details data-navigation-preview-more><summary>${icon('chevron-down',15)} 更多 <span>${more.length}</span></summary><ul>${more.map(previewItem).join('')}</ul></details>`:'<p class="wb-nav-preview-empty">暂时没有收进“更多”的入口</p>'}<p class="wb-nav-preview-note">隐藏入口不会移除首页方块，也不会删除资料。</p></aside></div>
      <p class="wb-nav-status" data-navigation-status role="status">${esc(message)}</p><p class="wb-nav-footnote">这里只管理已加入的模块与空间。新增模块后会自动出现；偏好与连接等底部工具保持固定。</p>
    </div></details>`;
}

/** Saving redraws only this panel: the canvas, scroll position and editor focus stay intact. */
export function mountNavigationEditor(ctx,session={}) {
  const {root,state}=ctx;
  let active=true,drag=null;
  const current=()=>active&&ctx.isCurrent?.()!==false;
  const clearMarks=()=>root.querySelectorAll('.is-drop-before,.is-drop-after,.is-drop-empty,.is-dragging').forEach(el=>el.classList.remove('is-drop-before','is-drop-after','is-drop-empty','is-dragging'));
  const locate=(attribute,id)=>[...root.querySelectorAll(`[${attribute}]`)].find(el=>el.getAttribute(attribute)===id);
  const focusAfter=focus=>{
    if(!focus)return;
    let control=focus.placement?locate('data-navigation-placement',focus.id):focus.grip?locate('data-navigation-grip',focus.id):[...root.querySelectorAll('[data-navigation-action]')].find(el=>el.dataset.navigationAction===focus.action&&(!focus.id||el.dataset.navigationId===focus.id));
    if(control?.disabled)control=locate('data-navigation-grip',focus.id);
    control?.focus({preventScroll:true});
  };
  function render(focus) {
    if(!active)return;
    const oldScroll=root.querySelector('[data-navigation-scroll]')?.scrollTop||0;
    const previewOpen=!!root.querySelector('[data-navigation-preview-more]')?.open;
    root.innerHTML=navigationEditorHTML(state,session);
    const scroller=root.querySelector('[data-navigation-scroll]');if(scroller)scroller.scrollTop=oldScroll;
    const preview=root.querySelector('[data-navigation-preview-more]');if(preview)preview.open=previewOpen;
    focusAfter(focus);
  }
  function change(mutation,message,focus) {
    if(!current()){ctx.toast?.('工作台已更新，请重新打开搭建台后调整。');render(focus);return;}
    try {
      ctx.saveChange(mutation);
      session.message=message;render(focus);
    }catch(error){ctx.toast?.(error.message||'未能保存导航调整，请重试。');render(focus);}
  }
  function move(id,direction) {
    const items=getNavigationItems(state),item=items.find(entry=>entry.id===id);if(!item)return;
    const peers=items.filter(entry=>entry.placement===item.placement),neighbor=peers[peers.findIndex(entry=>entry.id===id)+direction];if(!neighbor)return;
    change(workspace=>configureNavigation(workspace,{id,position:items.findIndex(entry=>entry.id===neighbor.id)}),`「${item.title}」已${direction<0?'上移':'下移'}，导航顺序已保存。`,{id,action:direction<0?'up':'down'});
  }
  function onClick(event) {
    const button=event.target.closest?.('[data-navigation-action]');if(!button||!root.contains(button)||button.disabled||!active)return;
    const {navigationAction:action,navigationId:id}=button.dataset;
    if(action==='up')move(id,-1);
    if(action==='down')move(id,1);
    if(action==='reset')change(workspace=>resetNavigation(workspace),'已恢复默认导航，全部可用入口直接显示。',{action:'reset'});
  }
  function onChange(event) {
    const select=event.target.closest?.('[data-navigation-placement]');if(!select||!root.contains(select)||select.disabled||!active)return;
    const id=select.dataset.navigationPlacement,item=getNavigationItems(state).find(entry=>entry.id===id);if(!item)return;
    const placement=select.value,label=groups.find(group=>group.id===placement)?.title;if(!label)return;
    change(workspace=>configureNavigation(workspace,{id,placement}),`「${item.title}」已设为${label}。`,{id,placement:true});
  }
  function onToggle(event){if(event.target?.matches?.('[data-navigation-details]'))session.expanded=event.target.open;}
  function stopDrag(){
    const pointerId=drag?.pointerId;drag=null;clearMarks();root.classList.remove('wb-nav-dragging');
    if(pointerId!==undefined&&root.hasPointerCapture?.(pointerId))root.releasePointerCapture(pointerId);
  }
  function onPointerDown(event) {
    const handle=event.target.closest?.('[data-navigation-grip]');
    if(!handle||!root.contains(handle)||!current()||drag||event.button!==0||event.isPrimary===false)return;
    event.preventDefault();handle.focus({preventScroll:true});
    drag={id:handle.dataset.navigationGrip,pointerId:event.pointerId,x:event.clientX,y:event.clientY,started:false,target:null};
    root.setPointerCapture?.(event.pointerId);
  }
  function onPointerMove(event) {
    if(!drag||drag.pointerId!==event.pointerId)return;
    if(!drag.started&&Math.hypot(event.clientX-drag.x,event.clientY-drag.y)<6)return;
    drag.started=true;event.preventDefault();clearMarks();root.classList.add('wb-nav-dragging');
    locate('data-navigation-row',drag.id)?.classList.add('is-dragging');
    const pointed=root.ownerDocument?.elementFromPoint?.(event.clientX,event.clientY),group=pointed?.closest?.('[data-navigation-group]');
    if(!group||!root.contains(group)){drag.target=null;return;}
    const placement=group.dataset.navigationGroup;
    if(mandatory(drag.id)&&placement!=='primary'){drag.target=null;return;}
    const row=pointed.closest?.('[data-navigation-row]');
    if(row&&row.dataset.navigationRow!==drag.id){
      const rect=row.getBoundingClientRect(),after=event.clientY>rect.top+rect.height/2;
      row.classList.add(after?'is-drop-after':'is-drop-before');drag.target={placement,id:row.dataset.navigationRow,after};
    }else if(!row){group.classList.add('is-drop-empty');drag.target={placement,id:null};}else drag.target=null;
    const scroll=root.querySelector('[data-navigation-scroll]');
    if(scroll){const bounds=scroll.getBoundingClientRect();if(event.clientY<bounds.top+28)scroll.scrollTop-=14;else if(event.clientY>bounds.bottom-28)scroll.scrollTop+=14;}
  }
  function onPointerUp(event){
    if(!drag||drag.pointerId!==event.pointerId)return;
    const {id,target,started}=drag;stopDrag();if(!started||!target||!current())return;
    const items=getNavigationItems(state),item=items.find(entry=>entry.id===id);if(!item)return;
    const remaining=items.filter(entry=>entry.id!==id);
    const position=target.id?remaining.findIndex(entry=>entry.id===target.id)+(target.after?1:0):(()=>{const peers=remaining.filter(entry=>entry.placement===target.placement);return peers.length?remaining.indexOf(peers.at(-1))+1:remaining.length;})();
    if(position<0)return;
    change(workspace=>configureNavigation(workspace,{id,placement:target.placement,position}),`「${item.title}」的导航位置已保存。`,{id,grip:true});
  }
  function onPointerCancel(event){if(drag?.pointerId===event.pointerId)stopDrag();}
  function onKeyDown(event){if(event.key==='Escape'&&drag){event.preventDefault();const id=drag.id;stopDrag();focusAfter({id,grip:true});}}
  const events={click:onClick,change:onChange,toggle:onToggle,pointerdown:onPointerDown,pointermove:onPointerMove,pointerup:onPointerUp,pointercancel:onPointerCancel,lostpointercapture:onPointerCancel,keydown:onKeyDown};
  for(const [name,handler]of Object.entries(events))root.addEventListener(name,handler,name==='toggle');
  render();
  return ()=>{active=false;stopDrag();for(const [name,handler]of Object.entries(events))root.removeEventListener(name,handler,name==='toggle');};
}
