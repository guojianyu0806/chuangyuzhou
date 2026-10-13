import {WORKBENCH_MODULES,WORKBENCH_TEMPLATES,getWorkbench,getVisibleModules,configureWorkbench,applyWorkbenchTemplate} from './workbench-model.js';
import {escapeHTML as esc} from './services.js';
import {icon} from './icons.js';
import {placementHTML,mountPlacement} from './placement.js';
import {getCustomBlocks,CUSTOM_BLOCK_KINDS} from './custom-blocks-model.js';
import {createPresetInput} from './custom-block-presets.js';
import {hasShowcaseExamples,planShowcaseExamples,installShowcaseExamples,SHOWCASE_SPACE_ID,SHOWCASE_COMPETITION_ID,SHOWCASE_LEDGER_ID} from './showcase-examples.js';
import {hasShowcaseGallery,planShowcaseGallery,installShowcaseGallery,SHOWCASE_GALLERY_SPACE_ID,SHOWCASE_GALLERY_FITNESS_ID,SHOWCASE_GALLERY_COURSE_IDS,SHOWCASE_GALLERY_BLOCK_IDS} from './showcase-gallery.js';

const byId=id=>WORKBENCH_MODULES.find(module=>module.id===id);
const moduleTitle=(config,id)=>config.modules.find(module=>module.id===id)?.title||byId(id)?.title||id;
const galleryDestinations=[
  {id:'courses',hint:'主题笔记与整理方法',route:'courses',target:SHOWCASE_GALLERY_COURSE_IDS[0]},
  {id:'english',hint:'原创题目与写作参考',route:'english',target:'reading'},
  {id:'inbox',hint:'12 条创作念头 · 试试梦境',route:'inbox'},
  {id:'tasks',hint:'从想法到具体行动',route:'tasks'},
  {id:'review',hint:'查看模拟活动与完成记录',route:'review'},
  {id:'ledger',hint:'独立模拟账本',route:'ledger',target:SHOWCASE_LEDGER_ID},
  {id:'calendar',hint:'日程与待办的日期关联',route:'calendar'},
  {id:'timetable',hint:'进入后选择“本周练习学期 · 示例”',route:'timetable'},
  {id:'competitions',hint:'内部节点与准备清单',route:'competitions',target:SHOWCASE_COMPETITION_ID},
  {id:'blocks',title:'自定义方块',hint:'7 种类型 · 从便签到小工具',icon:'layers',color:'#63E6DC',route:'block',target:SHOWCASE_GALLERY_BLOCK_IDS[0]},
  {id:'fitness',title:'运动记录',hint:'一次活动怎样留下记录',icon:'chart',color:'#8EDBE8',route:'space',target:SHOWCASE_GALLERY_FITNESS_ID},
  {id:'ai',hint:'准备一条需求 · 由你发送',route:'ai'},
];

function showcaseGalleryHTML(state,expanded){
  const installed=hasShowcaseGallery(state),config=getWorkbench(state);
  return `<section class="wb-gallery" aria-labelledby="wb-gallery-heading"><div class="wb-gallery-heading"><span class="wb-gallery-mark" aria-hidden="true">${icon('layers',24)}</span><div><p class="wb-gallery-kicker">可编辑的示例导览</p><h2 id="wb-gallery-heading">${installed?'从一个例子，看看每块能做什么':'先逛一遍有内容的工作台'}</h2><p>${installed?'点击下面的入口查看示例，随时回到搭建台继续探索。':'课程、英语、灵感、生活与项目，放入一套可以打开、编辑和关联的示例。'}</p></div><button type="button" class="btn" data-wb-action="${installed?'open-gallery':'add-gallery'}">${icon(installed?'book':'plus',17)} ${installed?'打开示例导览':'加入全模块示例'}</button></div>${installed?`<details class="wb-gallery-directory" data-wb-gallery-directory ${expanded?'open':''}><summary>按模块浏览 <span>12 个入口</span></summary><nav class="wb-gallery-links" aria-label="全模块示例入口">${galleryDestinations.map(item=>{const module=byId(item.id)||item;return `<button type="button" data-wb-action="gallery-destination" data-id="${item.id}"><span class="wb-gallery-glyph" style="--wb-gallery-color:${module.color}">${icon(module.icon,18)}</span><span><strong>${esc(item.title||moduleTitle(config,item.id))}</strong><small>${esc(item.hint)}</small></span>${icon('arrow-right',14)}</button>`;}).join('')}</nav></details>`:'<div class="wb-gallery-topics" aria-label="示例覆盖场景"><span>学习与课程</span><span>灵感与创作</span><span>日常与运动</span><span>项目与日程</span><span>自定义方块与 AI</span></div>'}<p class="wb-gallery-note">${installed?'示例均已标注，可继续编辑；再次打开不会重置内容。AI 需求需自行发送，小工具需手动运行。':'加入前可以预览内容；保留已有资料和布局，模拟费用与活动记录会明确标注。'}</p></section>`;
}

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

export function builderHTML(state,{galleryExpanded=true}={}) {
  const config=getWorkbench(state),visible=getVisibleModules(state),spaces=(state.spaces||[]).filter(space=>!space.archived);
  const optionalCount=visible.filter(module=>module.id!=='ai').length;
  const catalog=WORKBENCH_MODULES.filter(module=>module.id!=='ai');
  return `<section class="wb-builder" aria-labelledby="wb-heading">
    <header class="wb-heading"><div><p class="wb-kicker">搭建台</p><div class="wb-title-row"><h1 id="wb-heading">${esc(config.title)}</h1><button type="button" class="wb-icon-button" data-wb-action="rename-workbench" aria-label="修改工作台名称" title="修改工作台名称">${icon('edit',18)}</button></div><p class="wb-intro">选择需要的模块，把这里搭成适合自己的样子。</p></div><button class="btn primary" type="button" data-wb-action="home">进入我的画布 ${icon('arrow-right',17)}</button></header>
    <div class="wb-assistant-invite"><span class="wb-assistant-mark" aria-hidden="true">${icon('sparkles',26)}</span><div><strong>也可以和 AI 一起搭建</strong><p>告诉它你的场景，先看方案，再决定如何调整。</p></div><button type="button" class="btn" data-wb-action="ask-ai">${icon('message',17)} 让 AI 帮我搭建</button></div>
    ${showcaseGalleryHTML(state,galleryExpanded)}
    <div data-wb-placement-host>${placementHTML(state)}</div>
    <section class="wb-showcase" aria-label="项目示例"><div class="wb-section-head"><div><h2>把一个项目真正用起来</h2><p>资料、待办、日历与准备节点串成一条演示路线，在当前工作台里直接操作。</p></div><button type="button" class="btn" data-wb-action="${hasShowcaseExamples(state)?'open-showcase':'add-showcase'}">${hasShowcaseExamples(state)?'打开示例项目':'加入项目示例'}</button></div>${hasShowcaseExamples(state)?'<p class="muted small">空间待办与全局待办共用记录，带日期的待办和比赛事项自动显示在日历。模拟账本独立核算；讲解提纲与观察表由你编辑。</p><div class="wb-showcase-links"><button type="button" class="btn" data-wb-action="showcase-tasks">查看待办</button><button type="button" class="btn" data-wb-action="showcase-calendar">查看日历关联</button><button type="button" class="btn" data-wb-action="showcase-competition">查看准备节点</button><button type="button" class="btn" data-wb-action="showcase-ledger">查看模拟账本</button></div>':'<p class="muted small">将添加可编辑的“工作台参赛筹备”示例。日期是自定内部计划，费用为模拟数据。</p>'}</section>
    <section class="wb-custom-list" aria-label="我的自定义方块"><div class="wb-section-head"><div><h2>我的自定义方块</h2><p>同一场景可以创建多份；编辑内容、让 AI 改造，或收起后保留记录。</p></div><button type="button" class="btn" data-wb-action="create-block">${icon('plus',16)} 创建方块</button></div>${getCustomBlocks(state).items.length?`<ul>${getCustomBlocks(state).items.map(block=>`<li><span><strong>${esc(block.title)}</strong><small>${esc(CUSTOM_BLOCK_KINDS.find(item=>item.kind===block.kind||item.id===block.kind)?.title||block.kind)}${block.archived?' · 已收起':''}</small></span><button type="button" class="btn" data-wb-action="open-block" data-id="${esc(block.id)}">打开</button><button type="button" class="btn" data-wb-action="edit-block" data-id="${esc(block.id)}">编辑</button></li>`).join('')}</ul>`:'<p class="muted">从左侧场景创建第一个方块，或告诉 AI 你需要什么。</p>'}</section>
    <details class="wb-advanced"><summary>模板与更多设置 <span>更换组合、修改名称、管理模块和空间</span></summary><div class="wb-columns"><div class="wb-materials">
      <section class="wb-library" aria-labelledby="wb-library-heading"><div class="wb-section-head"><div><h2 id="wb-library-heading">模块库</h2><p>按需加入；收起后，已有资料仍然保留。</p></div><span class="wb-section-caption">${catalog.length} 种可选模块</span></div>
        <div class="wb-library-list">${catalog.map(module=>{
          const selected=config.modules.find(item=>item.id===module.id),enabled=!!selected?.enabled;
          return `<article class="wb-material ${enabled?'is-added':''}"><span class="wb-module-glyph" style="--wb-module-color:${module.color}">${icon(module.icon,21)}</span><div><h3>${esc(module.title)}</h3><p>${esc(module.description)}</p></div><button type="button" class="wb-add-button" data-wb-action="add" data-id="${esc(module.id)}" ${enabled?'disabled':''} aria-label="${enabled?'已加入':'加入'}${esc(module.title)}">${icon(enabled?'check':'plus',17)}<span>${enabled?'已加入':'加入'}</span></button></article>`;
        }).join('')}</div>
      </section>
      <section class="wb-template-section" aria-labelledby="wb-template-heading"><div class="wb-section-head"><div><h2 id="wb-template-heading">从一套组合开始</h2><p>模板提供起点，之后可以继续修改。</p></div></div><div class="wb-template-grid">${WORKBENCH_TEMPLATES.map(template=>`<button type="button" class="wb-template ${template.id==='blank'?'wb-template-blank':''}" data-wb-action="template" data-id="${esc(template.id)}"><span class="wb-template-title">${esc(template.title)}${icon('arrow-right',17)}</span><span class="wb-template-description">${esc(template.description)}</span><span class="wb-template-foot">${template.id==='blank'?'保留 AI，自由选择模块':`AI + ${template.moduleIds.filter(id=>id!=='ai').length} 个模块`}<span>预览组合</span></span></button>`).join('')}</div></section>
    </div>
    <aside class="wb-composition" aria-labelledby="wb-composition-heading"><div class="wb-section-head"><div><h2 id="wb-composition-heading">我的组合</h2><p>顺序对应导航与列表；画布位置可自由摆放。</p></div><span class="wb-count">${visible.length}</span></div>
      ${optionalCount===0?'<div class="wb-blank-hint"><strong>从空白开始，也很好。</strong><p>AI 已在这里。加入一个模块，或者为正在做的事新建空间。</p></div>':''}
      <ol class="wb-slot-list">${visible.map((module,index)=>`<li class="wb-slot" data-wb-module="${esc(module.id)}"><span class="wb-slot-index" aria-hidden="true">${String(index+1).padStart(2,'0')}</span><div class="wb-slot-body"><div class="wb-slot-top"><span class="wb-module-glyph" style="--wb-module-color:${module.color}">${icon(module.icon,18)}</span><div class="wb-slot-name"><strong>${esc(module.title)}</strong><small>${module.id==='ai'?'常驻智能助手':esc(byId(module.id).title)}</small></div><button type="button" class="wb-icon-button" data-wb-action="rename-module" data-id="${esc(module.id)}" aria-label="重命名${esc(module.title)}" title="重命名模块">${icon('edit',16)}</button></div><div class="wb-slot-controls"><button type="button" class="wb-order-button" data-wb-action="up" data-id="${esc(module.id)}" ${index===0?'disabled':''} aria-label="上移${esc(module.title)}">${icon('arrow-left',15)}<span>上移</span></button><button type="button" class="wb-order-button" data-wb-action="down" data-id="${esc(module.id)}" ${index===visible.length-1?'disabled':''} aria-label="下移${esc(module.title)}">${icon('arrow-right',15)}<span>下移</span></button>${module.id==='ai'?'<span class="wb-always">始终可用</span>':`<button type="button" class="wb-hide-button" data-wb-action="hide" data-id="${esc(module.id)}" aria-label="收起${esc(module.title)}">${icon('archive',15)} 收起</button>`}</div></div></li>`).join('')}</ol>
      <section class="wb-personal-spaces" aria-labelledby="wb-spaces-heading"><div class="wb-section-head"><div><h3 id="wb-spaces-heading">自定义空间</h3><p>围绕一个项目、目标或生活主题，收好笔记、文件和待办。</p></div></div>${spaces.length?`<ul class="wb-space-links">${spaces.map(space=>`<li><button type="button" data-wb-action="open-space" data-id="${esc(space.id)}">${icon('folder',16)}<span>${esc(space.title)}</span>${icon('arrow-right',16)}</button></li>`).join('')}</ul>`:''}<button type="button" class="wb-new-space" data-wb-action="new-space">${icon('plus',19)} 新建自定义空间</button></section>
    </aside></div></details>
  </section>`;
}

export function mountBuilder(ctx) {
  const {root,state,modal,toast}=ctx;
  let active=true,disposePlacement=null,galleryExpanded=true;
  const placementSession={};
  const createPresetAt=(id,placement)=>ctx.openCustomBlockEditor?.(createPresetInput(id),placement?{placement,onCreated(record){
    if(!active){ctx.refresh?.();return;}
    placementSession.selectedId=record.id;placementSession.landingId=record.id;
    placementSession.message=`「${record.title}」已放好，双击可以打开内容。`;render();
    // The app closes the creation dialog after its submit callback returns.
    setTimeout(()=>{if(active)[...root.querySelectorAll('[data-place-card]')].find(button=>button.dataset.placeCard===record.id)?.focus({preventScroll:true});},0);
  }}:undefined);
  const render=()=>{if(active){disposePlacement?.();root.innerHTML=builderHTML(state,{galleryExpanded});const host=root.querySelector('[data-wb-placement-host]');if(host)disposePlacement=mountPlacement({...ctx,root:host,createPresetAt,onPlacementSaved:render},placementSession);}};
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
  function reviewShowcase(){
    const now=new Date(),plan=planShowcaseExamples(state,{now});
    if(plan.alreadyInstalled){ctx.go('space',SHOWCASE_SPACE_ID);return;}
    const s=plan.summary;
    modal({title:'加入项目示例',submitLabel:'加入当前工作台',body:`<p>围绕“工作台参赛筹备”，添加一套可以继续编辑的内容：</p><ul class="wb-showcase-summary"><li>${s.spaces} 个项目空间、${s.notes} 篇笔记、${s.tasks} 项空间待办和 ${s.captures} 条原始想法</li><li>${s.competitions} 个展示准备项目、${s.milestones} 个内部节点和 ${s.competitionTasks} 项准备事项</li><li>${s.ledgerProjects} 个独立模拟账本、${s.ledgerEntries} 条模拟支出，合计 40 元，不计入总账</li><li>${s.blocks} 个自定义方块：演示讲解提纲、预演观察表</li></ul><p class="muted small">日期为加入后第 1、3、7 天的内部计划，不是官方截止时间。将显示相关模块，保留已有内容与方块位置，重复加入不会重置编辑结果。</p>`,onSubmit(){
      if(ctx.isCurrent?.()===false)throw new Error('工作台已更新，请重新打开示例预览。');
      installShowcaseExamples(ctx,{now});
      toast('项目示例已加入当前工作台');
      if(ctx.refresh)ctx.refresh();else render();
    }});
  }
  function reviewGallery(){
    const now=new Date(),plan=planShowcaseGallery(state,{now});
    if(plan.alreadyInstalled){ctx.go('space',SHOWCASE_GALLERY_SPACE_ID);return;}
    const s=plan.summary;
    modal({title:'加入全模块示例',submitLabel:'加入当前工作台',body:`<p>追加一套有明确标识的示例，方便逐块查看和动手尝试：</p><ul class="wb-showcase-summary"><li>学习：${s.courses} 个课程、${s.courseNotes} 篇课程笔记，附英语练习参考；已有答案和草稿保留</li><li>创作与行动：${s.captures} 条灵感、${s.tasks} 项待办、${s.spaces} 个空间与 ${s.notes} 篇空间笔记</li><li>计划：${s.calendarEvents} 条日程、${s.timetableEvents} 项课表安排，以及 ${s.competitions} 个准备项目、${s.milestones} 个节点和 ${s.competitionTasks} 项事项</li><li>生活：${s.fitnessSessions} 条模拟运动记录，${s.ledgerProjects} 个独立模拟账本与 ${s.ledgerEntries} 条模拟账目</li><li>搭建：${s.blocks} 个自定义方块，包含便签、清单、收藏、进度、日期、记录表和小工具</li></ul><p class="wb-gallery-review-note">已有内容与布局会保留。只追加尚未加入的整套示例，不会重置已经编辑过的示例；相关模块会显示在工作台。</p><p class="muted small">日期为相对今天安排的内部示范，不是官方截止时间。课表与课程分别维护；进入课表后请选择“本周练习学期 · 示例”，原活动学期保留。模拟记录不代表你的真实活动。AI 仅提供需求示范，小工具需手动运行。</p>`,onSubmit(){
      if(!active||ctx.isCurrent?.()===false)throw new Error('工作台已更新，请重新打开示例预览。');
      const result=installShowcaseGallery(ctx,{now});
      toast(result.alreadyInstalled?'示例已在工作台中，保留现有内容':'全模块示例已加入，可从上方目录开始探索');
      if(ctx.refresh)ctx.refresh();else render();
    }});
  }
  function onClick(event) {
    const button=event.target.closest('[data-wb-action]');
    if(!active||!button||!root.contains(button)||button.disabled)return;
    const action=button.dataset.wbAction,id=button.dataset.id;
    try {
      if(action==='home'){
        const config=getWorkbench(state);
        if(!config.onboardingComplete)saveWorkbenchChange(ctx,workspace=>configureWorkbench(workspace,{title:config.title}));
        ctx.go('home','layout');
      }
      if(action==='ask-ai'){
        if(ctx.askAssistant)ctx.askAssistant('我想搭建适合自己的工作台，请先了解我的使用场景和目标，再建议现有模块或创建自定义方块。普通内容可使用笔记、清单、链接、进度、倒计时、记录表；有新交互需求时可提出小工具方案。先展示方案，等我确认后再写入。');
        else ctx.go('ai');
      }
      if(action==='ask-miniapp'){
        if(ctx.askAssistant)ctx.askAssistant('我想为工作台创建一个可以交互的小工具。请先帮我明确用途、需要输入什么、显示什么结果，以及哪些数据需要记住。根据这些要求设计界面和操作，先给出可审核的方案，等我确认后创建。');else ctx.go('ai');
      }
      if(action==='create-block')ctx.openCustomBlockEditor?.();
      if(action==='create-preset')ctx.openCustomBlockEditor?.(createPresetInput(id));
      if(action==='edit-block')ctx.openCustomBlockEditor?.(id);
      if(action==='open-block')ctx.go('block',id);
      if(action==='rename-workbench')rename();
      if(action==='rename-module')rename(id);
      if(action==='template')reviewTemplate(id);
      if(action==='add')change(workspace=>configureWorkbench(workspace,{moduleId:id,enabled:true}),'模块已加入，原有资料可继续使用',{action:'rename-module',id});
      if(action==='hide')change(workspace=>configureWorkbench(workspace,{moduleId:id,enabled:false}),'模块已收起，资料保留，可从模块库重新加入',{action:'add',id});
      if(action==='up')move(id,-1);
      if(action==='down')move(id,1);
      if(action==='new-space')ctx.createSpace?.();
      if(action==='open-space')ctx.go('space',id);
      if(action==='add-showcase')reviewShowcase();
      if(action==='open-showcase')ctx.go('space',SHOWCASE_SPACE_ID);
      if(action==='showcase-tasks')ctx.go('tasks');
      if(action==='showcase-calendar')ctx.go('calendar');
      if(action==='showcase-competition')ctx.go('competitions',SHOWCASE_COMPETITION_ID);
      if(action==='showcase-ledger')ctx.go('ledger');
      if(action==='add-gallery')reviewGallery();
      if(action==='open-gallery')ctx.go('space',SHOWCASE_GALLERY_SPACE_ID);
      if(action==='gallery-destination'){
        const destination=galleryDestinations.find(item=>item.id===id);
        if(!destination)return;
        if(id==='ai'&&ctx.askAssistant)ctx.askAssistant('这是一次工作台示例练习。请先查看带有“示例”标记的记录，梳理“灵感、待办与日历”的关联，再提出一项小范围调整。请说明修改理由并展示方案，等待我审核确认后再保存；不要修改其他记录。');
        else ctx.go(destination.route,...(destination.target?[destination.target]:[]));
      }

    }catch(error){toast(error.message||'未能保存这次调整，请重试。');}
  }
  function onToggle(event){if(active&&event.target?.matches?.('[data-wb-gallery-directory]'))galleryExpanded=event.target.open;}
  root.addEventListener('click',onClick);
  root.addEventListener('toggle',onToggle,true);
  render();
  return ()=>{active=false;disposePlacement?.();root.removeEventListener('click',onClick);root.removeEventListener('toggle',onToggle,true);};
}
