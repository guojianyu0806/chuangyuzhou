import {escapeHTML as esc} from './services.js';
import {icon} from './icons.js';

const currentHref=({route,subroute=''})=>['space','builder'].includes(route)&&subroute?`#/${route}/${encodeURIComponent(subroute)}`:`#/${route}`;
export function sidebarNavigationHTML(items,{route,subroute='',moreOpen=false}={}) {
  const current=currentHref({route,subroute});
  const link=item=>{
    const active=item.href===current;
    return `<a href="${esc(item.href)}" data-sidebar-id="${esc(item.id)}" ${item.kind==='space'?'':`data-nav="${esc(item.id)}"`} class="${active?'active':''}" ${active?'aria-current="page"':''} aria-label="${esc(item.title)}" title="${esc(item.title)}">${item.kind==='space'?`<i class="rail-space-symbol" aria-hidden="true" style="--space-color:${/^#[\da-f]{6}$/i.test(item.color)?item.color:'#7950f2'}">${icon(item.icon||'layers')}</i>`:icon(item.icon)}<span>${esc(item.title)}</span>${['inbox','tasks'].includes(item.id)?`<b data-count="${item.id}"></b>`:''}</a>`;
  };
  const primary=items.filter(item=>item.placement==='primary'),more=items.filter(item=>item.placement==='more');
  return `<nav class="primary-nav" aria-label="主导航">${primary.map(link).join('')}</nav>${more.length?`<details class="rail-more" ${moreOpen?'open':''}><summary aria-label="更多导航" title="更多导航"><span class="rail-more-symbol" aria-hidden="true">${icon('more',20)}</span><span class="rail-more-label">更多导航</span><b>${more.length}</b><i aria-hidden="true">${icon('chevron-right',14)}</i></summary><nav class="primary-nav rail-more-links" aria-label="折叠导航">${more.map(link).join('')}</nav></details>`:''}`;
}

/** Rebuild only when entries change; preserve disclosure and focus on ordinary saves. */
export function renderSidebarNavigation(holder,items,location) {
  if(!holder)return;
  const signature=JSON.stringify(items),href=currentHref(location),routeChanged=holder.dataset.route!==href;
  const activeMore=items.some(item=>item.placement==='more'&&item.href===href);
  if(holder.dataset.signature!==signature){
    const focus=holder.contains(document.activeElement)?document.activeElement?.closest?.('[data-sidebar-id]')?.dataset.sidebarId:null;
    const moreOpen=!!holder.querySelector('.rail-more')?.open||(routeChanged&&activeMore);
    holder.innerHTML=sidebarNavigationHTML(items,{...location,moreOpen});
    holder.dataset.signature=signature;
    if(focus)[...holder.querySelectorAll('[data-sidebar-id]')].find(link=>link.dataset.sidebarId===focus)?.focus({preventScroll:true});
  }
  holder.querySelectorAll('[data-sidebar-id]').forEach(link=>{
    const active=link.getAttribute('href')===href;
    link.classList.toggle('active',active);
    if(active)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
  });
  const more=holder.querySelector('.rail-more');
  if(more){
    more.classList.toggle('has-current',activeMore);
    if(routeChanged&&activeMore)more.open=true;
  }
  holder.dataset.route=href;
}
