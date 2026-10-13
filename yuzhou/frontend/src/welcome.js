import {getWelcomeModel} from './welcome-model.js';
import {mountWelcomeMotion} from './welcome-motion.js';
import {escapeHTML as esc} from './services.js';
import {icon} from './icons.js';

// A bounded, representative glimpse. The full workspace remains on the canvas.
export function selectWelcomeCards(cards) {
  const modules=cards.filter(card=>card.kind==='module'),spaces=cards.filter(card=>card.kind==='space'),blocks=cards.filter(card=>card.kind==='block');
  const selected=[...modules.slice(0,8),...spaces.slice(0,1),...blocks.slice(0,1)];
  for(const card of cards)if(selected.length<10&&!selected.some(item=>item.id===card.id))selected.push(card);
  return selected.slice(0,10);
}
function art(card){
  if(card.id==='ai')return `<div class="welcome-orbit"><i></i><i></i><span>${icon('sparkles',40)}</span></div>`;
  if(card.id==='courses')return '<div class="welcome-books"><i></i><i></i><i></i></div>';
  if(card.id==='english')return '<div class="welcome-letters">Aa<span>make it yours.</span></div>';
  if(card.id==='inbox')return '<div class="welcome-papers"><i></i><i></i><i><span>!</span></i></div>';
  if(card.id==='review'||card.id==='ledger'||card.id==='competitions')return `<div class="welcome-bars"><i></i><i></i><i></i><i></i>${icon('arrow-up-right',24)}</div>`;
  if(card.id==='tasks')return `<div class="welcome-checks"><span>${icon('check',15)}<i></i></span><span>${icon('check',15)}<i></i></span><span><b></b><i></i></span></div>`;
  if(card.id==='calendar'||card.id==='timetable')return `<div class="welcome-calendar">${Array.from({length:12},(_,i)=>`<i class="${i===5?'marked':''}"></i>`).join('')}</div>`;
  return `<div class="welcome-object">${icon(card.icon||'layers',54)}<i></i><i></i></div>`;
}
export function welcomeHTML(state){
  const model=getWelcomeModel(state),cards=selectWelcomeCards(model.cards);
  return `<section class="welcome" aria-labelledby="welcome-title">
    <header class="welcome-header"><a class="welcome-brand" href="#/welcome" aria-label="宇宙工作区入口"><img src="./icon.svg" alt="" width="34" height="34"><strong>宇宙</strong></a><div class="welcome-header-actions"><button type="button" data-welcome-action="builder">搭建我的工作台 ${icon('arrow-up-right',15)}</button><button type="button" class="welcome-account" data-welcome-action="settings" aria-label="查看当前账号设置"><span>${esc((model.owner||'我').slice(0,1))}</span><strong>${esc(model.owner||'我的账号')}</strong></button></div></header>
    <div class="welcome-stage">
      <div class="welcome-atmosphere" aria-hidden="true"></div>
      <div class="welcome-constellation" aria-hidden="true">${cards.map((card,index)=>`<div class="welcome-float welcome-slot-${index}" data-depth="${(.65+(index%4)*.24).toFixed(2)}" data-phase="${index}" style="--tile-color:${card.color};--tile-duration:${7+index%5}s;--tile-delay:-${index*1.7}s;--tile-index:${index}"><div class="welcome-float-motion"><div class="welcome-tile welcome-kind-${card.kind}"><div class="welcome-tile-wash"></div><div class="welcome-tile-top"><span>${icon(card.icon,16)}</span><small>${esc(card.kind==='module'?'工作台模块':card.kind==='space'?'我的空间':'自定义方块')}</small></div><strong class="welcome-tile-title">${esc(card.title)}</strong><div class="welcome-tile-art">${art(card)}</div><div class="welcome-tile-bottom"><span>${esc(card.metric)}</span>${icon('arrow-up-right',13)}</div></div></div></div>`).join('')}</div>
      <div class="welcome-center"><p class="welcome-eyebrow"><span></span>你的工作区，准备好了</p><h1 id="welcome-title" class="${model.title.length>20?'welcome-title-long':''}" title="${esc(model.title)}">${esc(model.title)}</h1><p class="welcome-description">把零散的想法，拼成自己的世界。</p><p class="welcome-inventory">${model.counts.modules} 个模块<span>·</span>${model.counts.spaces} 个空间<span>·</span>${model.counts.blocks} 个自定义方块</p><button type="button" class="welcome-enter" data-welcome-action="enter">进入工作台 <span>${icon('arrow-right',21)}</span></button><button type="button" class="welcome-companion" data-welcome-action="ai"><span class="welcome-pet" aria-hidden="true"><i></i><i></i></span><span>小宇也在这里，陪你一起搭建</span>${icon('arrow-up-right',13)}</button></div>
    </div>
    <footer class="welcome-footer"><span>由你搭建，随你生长。</span><button type="button" data-welcome-motion aria-pressed="false">${icon('pause',13)}<span data-welcome-motion-label>暂停浮动</span></button><span class="welcome-footer-hint">移动鼠标，看看你的方块</span></footer>
  </section>`;
}
export function mountWelcome(ctx){
  const {root}=ctx;let active=true;
  root.innerHTML=welcomeHTML(ctx.state);
  const scene=root.querySelector('.welcome');
  const stop=scene?mountWelcomeMotion({root:scene}):()=>{};
  function click(event){
    const button=event.target.closest?.('[data-welcome-action]');
    if(!active||!button||!root.contains(button)||ctx.isCurrent?.()===false)return;
    const action=button.dataset.welcomeAction;
    if(action==='enter')ctx.go('home');
    if(action==='builder')ctx.go('builder');
    if(action==='settings')ctx.go('settings');
    if(action==='ai')ctx.go('ai');
  }
  root.addEventListener('click',click);
  return ()=>{active=false;stop();root.removeEventListener('click',click);};
}
