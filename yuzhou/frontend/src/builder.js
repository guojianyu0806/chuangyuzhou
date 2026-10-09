import {WORKBENCH_MODULES,WORKBENCH_TEMPLATES,getWorkbench,getVisibleModules,configureWorkbench,applyWorkbenchTemplate} from './workbench-model.js';
import {escapeHTML as esc} from './services.js';
import {icon} from './icons.js';

const byId=id=>WORKBENCH_MODULES.find(module=>module.id===id);
const moduleTitle=(config,id)=>config.modules.find(module=>module.id===id)?.title||byId(id)?.title||id;

/** Only the workbench configuration changes; failed saves restore the previous configuration. */
export function saveWorkbenchChange(ctx,change) {
  const hadConfig=Object.hasOwn(ctx.state,'workbench'),previous=hadConfig?structuredClone(ctx.state.workbench):undefined;
  const hadStamp=Object.hasOwn(ctx.state,'updatedAt'),stamp=ctx.state.updatedAt;
  try { change(ctx.state);ctx.save(); }
  catch(error) {
    if(hadConfig)ctx.state.workbench=previous;else delete ctx.state.workbench;
    if(hadStamp)ctx.state.updatedAt=stamp;else delete ctx.state.updatedAt;
    throw error;
  }
}

/** The review uses the same catalog as the state mutation and never edits the workspace. */
export function templateChanges(state,id) {
  const template=WORKBENCH_TEMPLATES.find(item=>item.id===id);
  if(!template)throw new Error('这个模板已不存在，请刷新后重试。');
  const config=getWorkbench(state),before=config.modules.filter(module=>module.enabled).map(module=>module.id);
  const after=new Set(['ai',...template.moduleIds]);
  return {template,
    added:[...after].filter(moduleId=>!before.includes(moduleId)).map(moduleId=>moduleTitle(config,moduleId)),
    hidden:before.filter(moduleId=>!after.has(moduleId)).map(moduleId=>moduleTitle(config,moduleId)),
    names:[...after].map(moduleId=>moduleTitle(config,moduleId))};
}

export function builderHTML(state,{showExample=false}={}) {
  const config=getWorkbench(state),visible=getVisibleModules(state),spaces=(state.spaces||[]).filter(space=>!space.archived);
  const optionalCount=visible.filter(module=>module.id!=='ai').length;
  const catalog=WORKBENCH_MODULES.filter(module=>module.id!=='ai');
  return `<section class="wb-builder" aria-labelledby="wb-heading">
    <header class="wb-heading"><div><p class="wb-kicker">搭建台</p><div class="wb-title-row"><h1 id="wb-heading">${esc(config.title)}</h1><button type="button" class="wb-icon-button" data-wb-action="rename-workbench" aria-label="修改工作台名称" title="修改工作台名称">${icon('edit',18)}</button></div><p class="wb-intro">选择需要的模块，把这里搭成适合自己的样子。</p></div><button class="btn primary" type="button" data-wb-action="home">进入我的画布 ${icon('arrow-right',17)}</button></header>
    <div class="wb-assistant-invite"><span class="wb-assistant-mark" aria-hidden="true">${icon('sparkles',26)}</span><div><strong>也可以和 AI 一起搭建</strong><p>告诉它你的场景，先看方案，再决定如何调整。</p></div><button type="button" class="btn" data-wb-action="ask-ai">${icon('message',17)} 让 AI 帮我搭建</button></div>
    <div class="wb-columns"><div class="wb-materials">
      <section class="wb-library" aria-labelledby="wb-library-heading"><div class="wb-section-head"><div><h2 id="wb-library-heading">模块库</h2><p>按需加入；收起后，已有资料仍然保留。</p></div><span class="wb-section-caption">${catalog.length} 种可选模块</span></div>
        <div class="wb-library-list">${catalog.map(module=>{
          const selected=config.modules.find(item=>item.id===module.id),enabled=!!selected?.enabled;
          return `<article class="wb-material ${enabled?'is-added':''}"><span class="wb-module-glyph" style="--wb-module-color:${module.color}">${icon(module.icon,21)}</span><div><h3>${esc(module.title)}</h3><p>${esc(module.description)}</p></div><button type="button" class="wb-add-button" data-wb-action="add" data-id="${esc(module.id)}" ${enabled?'disabled':''} aria-label="${enabled?'已加入':'加入'}${esc(module.title)}">${icon(enabled?'check':'plus',17)}<span>${enabled?'已加入':'加入'}</span></button></article>`;
        }).join('')}</div>
      </section>
      <section class="wb-template-section" aria-labelledby="wb-template-heading"><div class="wb-section-head"><div><h2 id="wb-template-heading">从一套组合开始</h2><p>模板提供起点，之后可以继续修改。</p></div></div><div class="wb-template-grid">${WORKBENCH_TEMPLATES.map(template=>`<button type="button" class="wb-template ${template.id==='blank'?'wb-template-blank':''}" data-wb-action="template" data-id="${esc(template.id)}"><span class="wb-template-title">${esc(template.title)}${icon('arrow-right',17)}</span><span class="wb-template-description">${esc(template.description)}</span><span class="wb-template-foot">${template.id==='blank'?'保留 AI，自由选择模块':`AI + ${template.moduleIds.filter(id=>id!=='ai').length} 个模块`}<span>预览组合</span></span></button>`).join('')}</div>${showExample?'<button type="button" class="wb-example-link" data-wb-action="example">查看宇宙完整示例 →</button>':''}</section>
    </div>
    <aside class="wb-composition" aria-labelledby="wb-composition-heading"><div class="wb-section-head"><div><h2 id="wb-composition-heading">我的组合</h2><p>顺序对应导航与列表；画布位置可自由摆放。</p></div><span class="wb-count">${visible.length}</span></div>
      ${optionalCount===0?'<div class="wb-blank-hint"><strong>从空白开始，也很好。</strong><p>AI 已在这里。加入一个模块，或者为正在做的事新建空间。</p></div>':''}
      <ol class="wb-slot-list">${visible.map((module,index)=>`<li class="wb-slot" data-wb-module="${esc(module.id)}"><span class="wb-slot-index" aria-hidden="true">${String(index+1).padStart(2,'0')}</span><div class="wb-slot-body"><div class="wb-slot-top"><span class="wb-module-glyph" style="--wb-module-color:${module.color}">${icon(module.icon,18)}</span><div class="wb-slot-name"><strong>${esc(module.title)}</strong><small>${module.id==='ai'?'常驻智能助手':esc(byId(module.id).title)}</small></div><button type="button" class="wb-icon-button" data-wb-action="rename-module" data-id="${esc(module.id)}" aria-label="重命名${esc(module.title)}" title="重命名模块">${icon('edit',16)}</button></div><div class="wb-slot-controls"><button type="button" class="wb-order-button" data-wb-action="up" data-id="${esc(module.id)}" ${index===0?'disabled':''} aria-label="上移${esc(module.title)}">${icon('arrow-left',15)}<span>上移</span></button><button type="button" class="wb-order-button" data-wb-action="down" data-id="${esc(module.id)}" ${index===visible.length-1?'disabled':''} aria-label="下移${esc(module.title)}">${icon('arrow-right',15)}<span>下移</span></button>${module.id==='ai'?'<span class="wb-always">始终可用</span>':`<button type="button" class="wb-hide-button" data-wb-action="hide" data-id="${esc(module.id)}" aria-label="收起${esc(module.title)}">${icon('archive',15)} 收起</button>`}</div></div></li>`).join('')}</ol>
      <section class="wb-personal-spaces" aria-labelledby="wb-spaces-heading"><div class="wb-section-head"><div><h3 id="wb-spaces-heading">自定义空间</h3><p>围绕一个项目、目标或生活主题，收好笔记、文件和待办。</p></div></div>${spaces.length?`<ul class="wb-space-links">${spaces.map(space=>`<li><button type="button" data-wb-action="open-space" data-id="${esc(space.id)}">${icon('folder',16)}<span>${esc(space.title)}</span>${icon('arrow-right',16)}</button></li>`).join('')}</ul>`:''}<button type="button" class="wb-new-space" data-wb-action="new-space">${icon('plus',19)} 新建自定义空间</button></section>
    </aside></div>
  </section>`;
}

export function mountBuilder(ctx) {
  const {root,state,modal,toast}=ctx;
  let active=true;
  const render=()=>{if(active)root.innerHTML=builderHTML(state,{showExample:typeof ctx.showExample==='function'});};
  function change(mutation,message,focus) {
    saveWorkbenchChange(ctx,mutation);
    toast(message);
    if(ctx.refresh)ctx.refresh();else render();
    if(focus)setTimeout(()=>{
      const button=root.querySelector(`[data-wb-action="${focus.action}"][data-id="${focus.id}"]`);
      if(button&&!button.disabled)button.focus();
      else root.querySelector(`[data-wb-action="rename-module"][data-id="${focus.id}"]`)?.focus();
    },0);
  }
  function rename(moduleId) {
    const config=getWorkbench(state),current=moduleId?moduleTitle(config,moduleId):config.title;
    modal({title:moduleId?'给模块换个名字':'工作台叫什么？',submitLabel:'保存名称',body:`<label class="field">${moduleId?'模块名称':'工作台名称'}<input name="title" value="${esc(current)}" required maxlength="${moduleId?60:80}" autocomplete="off"></label><p class="muted small">${moduleId?'名称会同步显示在导航和画布，模块内容保持原样。':'用一个你熟悉的名字，让它成为自己的地方。'}</p>`,onSubmit(data){
      const title=String(data.get('title')||'').trim();
      if(!title){toast('请填写名称');return false;}
      change(workspace=>configureWorkbench(workspace,moduleId?{moduleId,moduleTitle:title}:{title}),'名称已保存');
    }});
  }
  function reviewTemplate(id) {
    const changes=templateChanges(state,id);
    const list=items=>items.length?items.map(name=>`<span>${esc(name)}</span>`).join(''):'<span class="wb-no-change">无</span>';
    modal({title:`使用「${changes.template.title}」组合`,submitLabel:'应用这套组合',body:`<div class="wb-template-review"><p>${esc(changes.template.description)}</p><dl><div><dt>将加入</dt><dd>${list(changes.added)}</dd></div><div><dt>将收起</dt><dd>${list(changes.hidden)}</dd></div><div><dt>应用后的顺序</dt><dd>${changes.names.map((name,index)=>`<span>${index+1}. ${esc(name)}</span>`).join('')}</dd></div></dl><p class="wb-review-preserve">仅调整模块的显示和顺序。已有资料、自定义空间及画布位置会保留；不会添加示例记录。</p></div>`,onSubmit(){
      change(workspace=>applyWorkbenchTemplate(workspace,id),`已应用「${changes.template.title}」组合`);
    }});
  }
  function move(id,direction) {
    const visible=getVisibleModules(state),index=visible.findIndex(module=>module.id===id),neighbor=visible[index+direction];
    if(index<0||!neighbor)return;
    const position=getWorkbench(state).modules.findIndex(module=>module.id===neighbor.id);
    change(workspace=>configureWorkbench(workspace,{moduleId:id,position}),'模块顺序已保存',{action:direction<0?'up':'down',id});
  }
  function onClick(event) {
    const button=event.target.closest('[data-wb-action]');
    if(!active||!button||!root.contains(button)||button.disabled)return;
    const action=button.dataset.wbAction,id=button.dataset.id;
    try {
      if(action==='home'){
        const config=getWorkbench(state);
        if(!config.onboardingComplete)saveWorkbenchChange(ctx,workspace=>configureWorkbench(workspace,{title:config.title}));
        ctx.go('home');
      }
      if(action==='ask-ai'){
        if(ctx.askAssistant)ctx.askAssistant('我想搭建适合自己的工作台，请先了解我的使用场景和目标，再给出模块组合与安排建议。');
        else ctx.go('ai');
      }
      if(action==='rename-workbench')rename();
      if(action==='rename-module')rename(id);
      if(action==='template')reviewTemplate(id);
      if(action==='add')change(workspace=>configureWorkbench(workspace,{moduleId:id,enabled:true}),'模块已加入，原有资料可继续使用',{action:'rename-module',id});
      if(action==='hide')change(workspace=>configureWorkbench(workspace,{moduleId:id,enabled:false}),'模块已收起，资料保留，可从模块库重新加入',{action:'add',id});
      if(action==='up')move(id,-1);
      if(action==='down')move(id,1);
      if(action==='new-space')ctx.createSpace?.();
      if(action==='open-space')ctx.go('space',id);
      if(action==='example')ctx.showExample?.();
    }catch(error){toast(error.message||'未能保存这次调整，请重试。');}
  }
  root.addEventListener('click',onClick);
  render();
  return ()=>{active=false;root.removeEventListener('click',onClick);};
}
