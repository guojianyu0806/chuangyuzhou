import {getWelcomeModel} from './welcome-model.js';
import {mountWelcomeMotion} from './welcome-motion.js';
import {mountWelcomeLayout} from './welcome-layout-view.js';
import {escapeHTML as esc} from './services.js';
import {icon} from './icons.js';

// A bounded, representative glimpse. The full workspace remains on the canvas.
export function selectWelcomeCards(cards) {
  const selected=[],seen=new Set();
  const add=card=>{if(card&&selected.length<20&&!seen.has(card.id)){selected.push(card);seen.add(card.id);}};
  cards.filter(card=>card.kind==='module').forEach(add);
  add(cards.find(card=>card.kind==='space'));add(cards.find(card=>card.kind==='block'));
  cards.forEach(add);
  return selected;
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
    <header class="welcome-header"><a class="welcome-brand" href="#/welcome" aria-label="创宇宙工作区入口"><img src="./icon.svg" alt="" width="34" height="34"><strong>创宇宙</strong></a><div class="welcome-header-actions"><button type="button" data-welcome-action="builder">搭建我的工作台 ${icon('arrow-up-right',15)}</button><button type="button" class="welcome-account" data-welcome-action="settings" aria-label="查看当前账号设置"><span>${esc((model.owner||'我').slice(0,1))}</span><strong>${esc(model.owner||'我的账号')}</strong></button></div></header>
    <div class="welcome-stage">
      <div class="welcome-atmosphere" aria-hidden="true"></div>
      <div class="welcome-constellation">${cards.map((card,index)=>`<div class="welcome-float welcome-slot-${index}" data-depth="${(.65+(index%4)*.24).toFixed(2)}" data-phase="${index}" style="--tile-color:${card.color};--tile-duration:${(7.8+(index%5)*.83).toFixed(2)}s;--tile-sway-duration:${(10.9+(index%7)*.71).toFixed(2)}s;--tile-delay:-${(1.3+index*1.73).toFixed(2)}s;--tile-sway-delay:-${(2.1+index*2.37).toFixed(2)}s;--tile-sway-sign:${index%2?-1:1};--tile-drift:${(.78+(index%4)*.08).toFixed(2)};--tile-index:${index}"><div class="welcome-float-motion"><button type="button" class="welcome-tile welcome-kind-${card.kind}" data-welcome-card="${esc(card.id)}" title="${esc('进入'+card.title)}" aria-label="${esc('进入'+card.title)}"><div class="welcome-tile-wash" aria-hidden="true"></div><div class="welcome-tile-top"><span>${icon(card.icon,16)}</span><small>${esc(card.kind==='module'?'工作台模块':card.kind==='space'?'我的空间':'自定义方块')}</small></div><strong class="welcome-tile-title">${esc(card.title)}</strong><div class="welcome-tile-art" aria-hidden="true">${art(card)}</div><div class="welcome-tile-bottom"><span>${esc(card.metric)}</span>${icon('arrow-up-right',13)}</div></button></div></div>`).join('')}</div>
      <div class="welcome-float welcome-center-float" data-welcome-center data-depth="0.6"><div class="welcome-float-motion"><div class="welcome-center"><div class="welcome-center-content"><p class="welcome-eyebrow"><span></span>你的工作区，准备好了</p><h1 id="welcome-title" class="${model.title.length>20?'welcome-title-long':''}" title="${esc(model.title)}">${esc(model.title)}</h1><p class="welcome-description">把零散的想法，拼成自己的世界。</p><p class="welcome-inventory">${model.counts.modules} 个模块<span>·</span>${model.counts.spaces} 个空间<span>·</span>${model.counts.blocks} 个自定义方块</p><button type="button" class="welcome-enter" data-welcome-action="enter">进入工作台 <span>${icon('arrow-right',21)}</span></button><button type="button" class="welcome-companion" data-welcome-action="ai"><span class="welcome-pet" aria-hidden="true"><i></i><i></i></span><span>小宇也在这里，陪你一起搭建</span>${icon('arrow-up-right',13)}</button></div></div></div></div>
    </div>
    <footer class="welcome-footer"><div class="welcome-layout-caption"><span data-welcome-layout-status>形式 1 · 散落</span><span>浏览器缩放渐变 · 双击空白或中央卡片切换</span></div><button type="button" data-welcome-motion aria-pressed="false">${icon('pause',13)}<span data-welcome-motion-label>暂停浮动</span></button><span class="welcome-footer-hint">点击方块，直接进入</span></footer>
  </section>`;
}
export function mountWelcome(ctx){
  const {root}=ctx;let active=true;
  const displayedIds=new Set(selectWelcomeCards(getWelcomeModel(ctx.state).cards).map(card=>card.id));
  root.innerHTML=welcomeHTML(ctx.state);
  const scene=root.querySelector('.welcome');
  const stop=scene?mountWelcomeMotion({root:scene}):()=>{};
  const stopLayout=scene?mountWelcomeLayout({root:scene,motion:stop}):()=>{};
  function click(event){
    const button=event.target.closest?.('button[data-welcome-card],button[data-welcome-action]');
    if(!active||!button||!root.contains(button)||ctx.isCurrent?.()===false)return;
    if(Object.hasOwn(button.dataset,'welcomeCard')){
      const id=button.dataset.welcomeCard;
      if(!displayedIds.has(id))return;
      const cards=new Map(getWelcomeModel(ctx.state).cards.map(card=>[card.id,card]));
      const card=cards.get(id);
      if(card){if(card.subroute===undefined)ctx.go(card.route);else ctx.go(card.route,card.subroute);}
      return;
    }
    const action=button.dataset.welcomeAction;
    if(action==='enter')ctx.go('home');
    if(action==='builder')ctx.go('builder');
    if(action==='settings')ctx.go('settings');
    if(action==='ai')ctx.go('ai');
  }
  root.addEventListener('click',click);
  return ()=>{active=false;stopLayout();stop();root.removeEventListener('click',click);};
}
