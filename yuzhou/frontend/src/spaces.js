import {mountCanvas, canvasCardFill} from './canvas.js';
import {openAIConversation} from './ai.js';
import {mountFitness} from './fitness.js';
import {isFitnessSpace} from './fitness-model.js';
import {assignRecordColor, createColorDraft} from './creation-colors.js';
import {mountFileText,supportsFileText} from './file-text.js';
import {spaceWorkbenchCards,spaceWorkbenchLayout,spaceBoardKey} from './space-workbench-model.js';
import {blockCardPreview} from './card-previews.js';

export const SPACE_COLORS = ['#7950f2', '#009eab', '#ef3f92', '#78a500', '#f08025', '#4770f5'];
export const SPACE_ICONS = ['folder', 'book', 'flag', 'code', 'coffee', 'star', 'globe', 'target'];
const TEMPLATES = [
  ['blank', '自由空间', '灵感、生活和任何值得留下的事', 'folder'],
  ['course', '课程学习', '课件、学习笔记与复习安排', 'book'],
  ['affairs', '学生会 / 事务', '会议、活动资料与执行待办', 'flag'],
  ['project', '个人项目', '项目想法、文档与下一步行动', 'code'],
  ['fitness', '运动健身', '按日、周、月记录运动与查看统计', 'target']
];
const stamp = () => new Date().toISOString();
const dateLabel = value => { const date = new Date(value); return Number.isNaN(date.getTime()) ? '刚刚' : date.toLocaleDateString('zh-CN', {month:'long',day:'numeric'}); };
const sizeLabel = value => value < 1048576 ? `${Math.max(0,Math.ceil(value / 1024))} KB` : `${(value / 1048576).toFixed(1)} MB`;
const filename = value => String(value || '笔记').replace(/[<>:"/\\|?*]/g, '_').slice(0,120);
export const spaceColor = space => /^#[a-f\d]{6}$/i.test(space?.color || '') ? space.color : '#7950f2';
function foreground(color) {
  const channels = color.slice(1).match(/../g).map(value=>parseInt(value,16)/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4);
  return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722 > .179 ? '#05050b' : '#ffffff';
}

/** File bytes stay in IndexedDB; metadata is saved only after the write succeeds. */
export async function saveSpaceFiles(ctx, space, files) {
  let saved = 0, rejected = 0;
  space.files ||= [];
  for (const file of [...files]) {
    if (!file || file.size > 40 * 1024 * 1024) { rejected++; continue; }
    let blobId;
    try { blobId = await ctx.putFile(file); } catch { rejected++; continue; }
    const previousColor = ctx.state.ui?.lastCreatedColor, previousUpdatedAt = ctx.state.updatedAt;
    const entry = {id:ctx.uid(),blobId,name:file.name,size:file.size,type:file.type,createdAt:stamp(),color:assignRecordColor(ctx.state)};
    const previous = space.updatedAt;
    space.files.unshift(entry); space.updatedAt = stamp();
    try { ctx.save(); saved++; } catch(error) {
      space.files.splice(space.files.indexOf(entry),1); space.updatedAt = previous;
      ctx.state.updatedAt = previousUpdatedAt;
      if(previousColor===undefined)delete ctx.state.ui.lastCreatedColor;else ctx.state.ui.lastCreatedColor=previousColor;
      throw error;
    }
  }
  return {saved,rejected};
}

export function openSpaceDialog(ctx, space) {
  const {state, esc, icon, modal, toast, uid} = ctx;
  const colorDraft = space ? null : createColorDraft(state);
  let manualFitnessChoice=space?.fitnessEnabled!==undefined;
  const initial = {title:space?.title || '',description:space?.description || '',type:space?.type || 'blank',color:space ? spaceColor(space) : colorDraft.color,icon:space?.icon || 'folder'};
  modal({title:space ? '调整我的工作区' : '创建一个属于你的空间',submitLabel:space ? '保存设置' : '创建工作区',body:`
    <div class="sp-form-intro"><span>${icon(space?.icon || 'folder',26)}</span><p>给一件重要的事留个位置。<br><small>${ctx.parentSpaceId?'当前空间画布会出现对应卡片，可自由移动、缩放。':'主页会出现对应卡片，可自由移动、缩放。'}</small></p></div>
    <label class="field">空间名称<input name="title" required maxlength="60" value="${esc(initial.title)}" placeholder="例如：学生会宣传部、我的毕业项目"></label>
    <label class="field">这个空间用来做什么？<textarea name="description" maxlength="600" rows="3" placeholder="例如：存放学生会宣传部的会议、活动策划和我的执行任务。">${esc(initial.description)}</textarea><span class="small muted">接入 AI 后，这段说明会帮助它判断内容该放在哪里。</span></label>
    <fieldset class="sp-form-fieldset"><legend>空间模板</legend><div class="sp-template-options">${TEMPLATES.map(([type,label,hint,glyph])=>`<label><input type="radio" name="type" value="${type}" ${initial.type===type?'checked':''}><span>${icon(glyph,21)}<strong>${label}</strong><small>${hint}</small></span></label>`).join('')}</div></fieldset>
    <label class="fitness-enable-setting"><input type="checkbox" name="fitnessEnabled" ${isFitnessSpace(space,state)?'checked':''}><span><strong>启用运动统计</strong><small>按日、周、月记录运动时长、里程与消耗。关闭后记录仍保留，原有笔记、文件和待办不受影响。</small></span></label>
    <div class="form-grid"><label class="field">卡片主题色<div class="sp-color-field"><input type="color" name="color" value="${spaceColor(initial)}" aria-label="卡片主题色"><span>${space?'选择你喜欢的颜色':'自动配色，也可以手动选择'}</span></div></label><label class="field">空间图标<select name="icon">${SPACE_ICONS.map((item,i)=>`<option value="${item}" ${initial.icon===item?'selected':''}>${['文件夹','学习书本','事务旗帜','代码项目','生活咖啡','星标灵感','世界地图','目标'][i]}</option>`).join('')}</select></label></div>
    <p class="sp-form-tip">所有模板都能保存笔记、文件和待办，不会添加虚构内容。</p>`,onSubmit(data) {
      const title = String(data.get('title') || '').trim();
      if (!title) { toast('给工作区起个名字吧'); return false; }
      const type = String(data.get('type') || 'blank');
      const color = String(data.get('color') || '');
      const glyph = String(data.get('icon') || 'folder');
      const values = {title,description:String(data.get('description') || '').trim(),fitnessEnabled:data.has('fitnessEnabled'),type:TEMPLATES.some(x=>x[0]===type)?type:'blank',color:/^#[a-f\d]{6}$/i.test(color)?color:'#7950f2',icon:SPACE_ICONS.includes(glyph)?glyph:'folder',updatedAt:stamp()};
      state.spaces ||= [];
      if (space) {
        const previous = {...space};
        const previousUpdatedAt = state.updatedAt;
        const card = state.canvas?.cards?.find(item=>item.id===space.id);
        const hadCardColor = !!card && Object.prototype.hasOwnProperty.call(card,'color');
        const previousCardColor = card?.color;
        Object.assign(space,values);
        if(card)card.color=values.color;
        try { ctx.save(); } catch(error) {
          for(const key of Object.keys(values))if(!Object.prototype.hasOwnProperty.call(previous,key))delete space[key];
          Object.assign(space,previous);
          state.updatedAt = previousUpdatedAt;
          if(card){if(hadCardColor)card.color=previousCardColor;else delete card.color;}
          throw error;
        }
      } else {
        const previousColor = state.ui?.lastCreatedColor, previousUpdatedAt = state.updatedAt;
        if(ctx.parentSpaceId&&!state.spaces.some(item=>item.id===ctx.parentSpaceId&&!item.archived))throw Error('上级空间已不存在或已归档。');
        const created = {id:uid(),...values,...(ctx.parentSpaceId?{parentId:ctx.parentSpaceId}:{}),color:colorDraft.commit(color),createdAt:stamp(),archived:false,notes:[],files:[]};
        state.spaces.push(created);
        try { ctx.save(); } catch(error) { state.spaces.splice(state.spaces.indexOf(created),1);state.updatedAt=previousUpdatedAt;if(previousColor===undefined)delete state.ui.lastCreatedColor;else state.ui.lastCreatedColor=previousColor;throw error; }
      }
      toast(space?'空间设置已保存':ctx.parentSpaceId?'下级空间已创建，已放入当前空间画布':'工作区已创建，主页卡片已就位'); ctx.refresh?.();
    }});
  const form=document.querySelector('#modal form');
  colorDraft?.bind(form);
  form?.querySelector('[name=fitnessEnabled]')?.addEventListener('change',()=>{manualFitnessChoice=true;});
  form?.addEventListener('change',event=>{
    if(!event.target.matches('[name=type],[name=title]'))return;
    const enabled=form.querySelector('[name=fitnessEnabled]'),type=form.querySelector('[name=type]:checked')?.value||'blank';
    if(event.target.name==='type'&&type==='fitness'){enabled.checked=true;return;}
    if(!manualFitnessChoice)enabled.checked=isFitnessSpace({...space,id:space?.id||'',title:form.querySelector('[name=title]').value,type,fitnessEnabled:undefined},state);
  });
}

function prose(content, esc) {
  let result = '', list = false, code = false;
  for (const line of String(content || '').split('\n')) {
    if (line.startsWith('```')) { if(list){result+='</ul>';list=false;}result+=code?'</code></pre>':'<pre><code>';code=!code;continue; }
    if(code){result+=esc(line)+'\n';continue;}
    if(/^[-*]\s/.test(line)){if(!list){result+='<ul>';list=true;}result+=`<li>${esc(line.slice(2))}</li>`;continue;}
    if(list){result+='</ul>';list=false;}
    if(/^#{1,3}\s/.test(line))result+=`<h3>${esc(line.replace(/^#{1,3}\s/,''))}</h3>`;
    else if(line.trim())result+=`<p>${esc(line)}</p>`;
  }
  return result+(list?'</ul>':'')+(code?'</code></pre>':'');
}

export function mountSpace(ctx, id) {
  const {root,state,esc,icon,toast,modal,go,uid,download,getFile} = ctx;
  const space = (state.spaces || []).find(item=>item.id===id);
  let hadFitness=isFitnessSpace(space,state);
  let active = true, tab = ['workbench','overview','notes','files','tasks','fitness'].includes(ctx.routeDetail)?ctx.routeDetail:'workbench', selectedNote = tab==='notes'?ctx.routeItem||'':'', selectedFile = tab==='files'?ctx.routeItem||'':'', archivedNotes = false, archivedTasks = false;
  let objectUrl = '', previewRequest = 0, uploading = false, boardCleanup = null, fitnessCleanup = null;
  if(!space){root.innerHTML=`<div class="empty-state"><h2>暂时找不到这个空间</h2><p>回到主页选择一个空间，或创建新的工作区。</p><button class="btn primary" data-sp-action="home">回到空间主页</button></div>`;const back=()=>go('home');root.querySelector('button').addEventListener('click',back);return()=>{active=false;};}
  space.notes ||= []; space.files ||= []; state.tasks ||= [];
  const tasks = () => state.tasks.filter(item=>item.spaceId===space.id);
  const template = () => TEMPLATES.find(item=>item[0]===space.type) || TEMPLATES[0];
  const release = () => {previewRequest++;if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl='';};
  const localRefresh = () => {if(active)render();};
  const openSpaceAI = () => {try{return openAIConversation(ctx,{targetId:`space:${space.id}`});}catch(error){toast(error.message);}};
  // Keep the current in-memory state intact if another window won the save race.
  function commit(mutation) {
    const before = JSON.parse(JSON.stringify(space));
    const taskBefore = state.tasks.map(item=>({...item}));
    const previousColor = state.ui?.lastCreatedColor, previousUpdatedAt = state.updatedAt;
    try { mutation();space.updatedAt = stamp();ctx.save(); } catch(error) { for(const key of Object.keys(space))delete space[key];Object.assign(space,before);state.tasks=taskBefore;state.updatedAt=previousUpdatedAt;if(state.ui){if(previousColor===undefined)delete state.ui.lastCreatedColor;else state.ui.lastCreatedColor=previousColor;}throw error; }
  }
  const blank = (glyph,title,description,action,label) => `<div class="sp-empty">${icon(glyph,34)}<h3>${title}</h3><p>${description}</p>${action?`<button class="btn sp-primary" data-sp-action="${action}">${icon('plus',17)} ${label}</button>`:''}</div>`;
  const boardHost = () => '<div class="sp-collection" data-sp-board></div>';
  const boardColors = ['#AE88FF','#63E6DC','#FF9CCE','#D8F649','#9DC5FF','#FFBC7C'];
  const noteList = () => space.notes.filter(item=>archivedNotes||!item.archived);
  const fileList = () => space.files.filter(item=>!item.archived);
  const taskList = () => tasks().filter(item=>archivedTasks?item.archived:!item.archived);
  function mountSpaceCanvas(){
    const host=root.querySelector('[data-sp-board]');if(!host)return;
    const items=spaceWorkbenchCards(state,space.id);state.boards||={};const key=spaceBoardKey(space.id);state.boards[key]||=spaceWorkbenchLayout(state,space.id);
    const enter=itemId=>{const item=items.find(item=>item.id===itemId);if(!item)return;if(item.kind==='section'){if(item.id==='assistant')openSpaceAI();else go('space',space.id,item.id);}else if(item.kind==='module')go(item.id.slice(7));else go(item.kind==='block'?'block':'space',item.id);};
    boardCleanup=mountCanvas({...ctx,root:host,enterCard:enter,createSpace:()=>go('builder',space.id),editSpace:undefined,mountAIComposer:undefined},{layout:state.boards[key],items,hideHeader:true,title:space.title,cardLabel:'空间方块',createLabel:false,canDrop:false,enterLabel:item=>item.kind==='module'?'打开共享模块':'进入内容',footLabel:'双击或点击进入 · 长按摆放',renderCard:(_card,item)=>{
      const records=item.id==='notes'?noteList():item.id==='files'?fileList():item.id==='tasks'?taskList():[];
      return `<div class="cv-card-copy sp-board-copy"><span class="cv-card-kicker">${item.kind==='module'?'共享模块入口':item.kind==='block'?'本空间自定义方块':item.kind==='space'?'下级空间':'本空间内容'}</span><h2>${esc(item.title)}</h2><p>${esc(item.description||'自由摆放，按自己的方式使用。')}</p></div>${item.kind==='block'?blockCardPreview({...item,kind:item.blockKind}):records.length?`<ul class="sp-overview-preview">${records.slice(0,3).map(record=>`<li>${esc(record.title||record.name)}</li>`).join('')}</ul>`:''}`;
    }});
  }
  function overview() {
    return `<div class="sp-section-tools"><p>每类内容都有自己的卡片，可以像主页一样长按摆放。</p><button class="btn sp-primary" data-sp-action="new-note">${icon('plus',17)} 写一篇笔记</button></div>${boardHost()}`;
  }
  function notesView() {
    const note = noteList().find(item=>item.id===selectedNote);
    return `<div class="sp-section-tools"><label class="sp-check-label"><input type="checkbox" data-sp-notes-archive ${archivedNotes?'checked':''}>显示已归档笔记</label><button class="btn sp-primary" data-sp-action="new-note">${icon('plus',17)} 新建笔记</button></div>${note?`<div class="sp-reader-stage"><button class="sp-back sp-reader-back" data-sp-action="back-board">${icon('arrow-left',17)} 回到笔记卡片</button><section class="sp-reader sp-note-reader"><header class="sp-reader-head"><span class="sp-panel-kicker">${note.archived?'ARCHIVED NOTE':'YOUR NOTES'} · 仅本机</span><h2>${esc(note.title)}</h2><div class="sp-reader-meta"><span>${dateLabel(note.updatedAt)}</span><span>版本 ${(note.revisions?.length||0)+1}</span></div><div class="sp-reader-actions"><button class="btn" data-sp-action="edit-note" data-id="${esc(note.id)}">${icon('edit',16)} 编辑</button><button class="btn" data-sp-action="note-history" data-id="${esc(note.id)}">${icon('clock',16)} 修订记录</button><button class="icon-btn" data-sp-action="export-note" data-id="${esc(note.id)}" aria-label="导出笔记">${icon('download',18)}</button><button class="icon-btn" data-sp-action="archive-note" data-id="${esc(note.id)}" aria-label="${note.archived?'恢复':'归档'}笔记">${icon(note.archived?'refresh':'archive',18)}</button></div></header><div class="sp-source">${icon('link',16)}<span>${esc(note.source||'手动记录 · 尚未关联原始资料')}</span></div><article class="sp-prose">${prose(note.content,esc)}</article></section></div>`:boardHost()}`;
  }
  function filesView() {
    const file = fileList().find(item=>item.id===selectedFile);
    return `<div class="sp-section-tools"><p>拖入资料，或点卡片查看原件。</p><button class="btn sp-primary" data-sp-action="upload">${icon('upload',17)} 添加文件</button></div>${file?`<div class="sp-reader-stage"><button class="sp-back sp-reader-back" data-sp-action="back-board">${icon('arrow-left',17)} 回到文件卡片</button><section class="sp-reader sp-file-reader"><header class="sp-reader-head"><span class="sp-panel-kicker">ORIGINAL FILE · 仅本机</span><h2>${esc(file.name)}</h2><div class="sp-reader-actions"><span class="muted">${sizeLabel(file.size)}</span><button class="btn" data-sp-action="download-file" data-id="${esc(file.id)}">${icon('download',17)} 下载原件</button></div></header><div class="sp-preview" data-sp-preview><p>正在读取本机文件…</p></div></section></div>`:boardHost()}`;
  }
  function tasksView() {
    return `<div class="sp-section-tools"><label class="sp-check-label"><input type="checkbox" data-sp-tasks-archive ${archivedTasks?'checked':''}>查看已归档事项</label><button class="btn sp-primary" data-sp-action="new-task">${icon('plus',17)} 添加待办</button></div>${boardHost()}`;
  }
  function mountBoard() {
    const host=root.querySelector('[data-sp-board]');if(!host)return;
    const currentTab=tab;
    const summaries=[
      {id:'notes',title:'想法与笔记',subtitle:'留下每一次理解、会议记录与灵感。',color:'#AE88FF',icon:'book',count:space.notes.filter(item=>!item.archived).length,unit:'篇笔记',kicker:'THOUGHTS & NOTES'},
      {id:'files',title:'我的资料',subtitle:'课件、活动材料和项目原件，一起收好。',color:'#63E6DC',icon:'folder',count:fileList().length,unit:'份文件',kicker:'YOUR MATERIALS'},
      {id:'tasks',title:'下一步行动',subtitle:'把想做的事，变成可以完成的一步。',color:'#D8F649',icon:'check-circle',count:tasks().filter(item=>!item.done&&!item.archived).length,unit:'件待办',kicker:'ONE THING AT A TIME'},
      {id:'assistant',title:'交给 AI 整理',subtitle:'直接发来零散内容，指定归入这个空间。',color:'#FF9CCE',icon:'sparkles',kicker:'SPACE ASSISTANT'}
    ];
    const data=currentTab==='notes'?noteList():currentTab==='files'?fileList():currentTab==='tasks'?taskList():summaries;
    const items=currentTab==='overview'?summaries:data.map((item,index)=>({...item,title:currentTab==='files'?item.name:item.title,
      subtitle:currentTab==='notes'?item.content:currentTab==='files'?item.name:item.description,
      icon:currentTab==='notes'?(item.archived?'archive':'file'):currentTab==='files'?'folder':item.done?'check-circle':'target',
      color:item.color || boardColors[index%boardColors.length]}));
    state.boards ||= {};const key=`space:${space.id}:${currentTab}`;
    const layout=state.boards[key] ||= {};
    const enter=(itemId)=>{
      if(!active)return;
      if(currentTab==='overview'){if(itemId==='assistant')return openSpaceAI();go('space',space.id,itemId);return;}
      if(currentTab==='notes'){go('space',space.id,'notes',itemId);return;}
      if(currentTab==='files'){go('space',space.id,'files',itemId);return;}
      const task=tasks().find(item=>item.id===itemId);if(task)taskDialog(task);
    };
    const edit=currentTab==='notes'?itemId=>noteDialog(space.notes.find(item=>item.id===itemId)):currentTab==='tasks'?itemId=>taskDialog(tasks().find(item=>item.id===itemId)):undefined;
    const create=currentTab==='tasks'?()=>taskDialog():currentTab==='files'?()=>root.querySelector('[data-sp-file-input]').click():()=>noteDialog();
    const label={overview:'内容分区',notes:'空间笔记',files:'原始资料',tasks:'空间待办'}[currentTab];
    const empty=currentTab==='notes'?blank('book','第一篇笔记，从你的想法开始','会议记录、学习笔记或项目思路，都可以留下。','new-note','写一篇笔记'):currentTab==='files'?blank('upload','把文件放进这个空间','课件、会议材料、图片或文档，拖到这里即可。','upload','添加文件'):blank('check-circle',archivedTasks?'没有已归档的事项':'记下下一步行动','日期可以留空，等想清楚了再安排。',archivedTasks?'':'new-task','添加待办');
    boardCleanup=mountCanvas({...ctx,root:host,enterCard:enter,createSpace:create,editSpace:edit,mountAIComposer:undefined},
      {layout,items,sourceItems:currentTab==='overview'?[]:data,hideHeader:true,title:label,cardLabel:label,createLabel:false,canDrop:false,
      emptyHTML:empty,enterLabel:currentTab==='overview'?'打开分区':currentTab==='notes'?'阅读笔记':currentTab==='files'?'查看原件':'编辑事项',
      footLabel:currentTab==='overview'?'长按摆放 · 点击进入':currentTab==='tasks'?'长按摆放 · 点击编辑':'长按摆放 · 点击查看',
      renderCard:(card,item)=>{
        if(currentTab==='overview'){
          const records=item.id==='notes'?space.notes.filter(n=>!n.archived):item.id==='files'?fileList().filter(f=>!f.archived):item.id==='tasks'?tasks().filter(t=>!t.done&&!t.archived):[];
          const excerpt=records.length?`<ul class="sp-overview-preview">${records.slice(0,2).map(record=>`<li>${esc(String(record.title||record.name||'未命名').slice(0,120))}</li>`).join('')}</ul>`:'';
          return `<div class="cv-card-copy sp-board-copy"><span class="cv-card-kicker">${item.kicker}</span><h2>${esc(item.title)}</h2><p>${esc(item.subtitle)}</p></div>${excerpt}<div class="sp-board-summary">${item.count===undefined?`<span class="sp-board-large-icon" aria-hidden="true">${icon('sparkles',55)}</span><small>先讨论目标，审核后确认执行</small>`:`<strong>${item.count}</strong><span>${item.unit}</span>`}</div>`;
        }
        if(currentTab==='notes')return `<div class="cv-card-copy sp-board-copy"><span class="cv-card-kicker">${item.archived?'ARCHIVED NOTE':'YOUR NOTES'}</span><h2>${esc(item.title)}</h2><p class="sp-card-excerpt">${esc(item.content||'')}</p></div><div class="sp-card-meta"><span>${dateLabel(item.updatedAt)}</span><span>v${(item.revisions?.length||0)+1}</span>${item.archived?'<span>已归档</span>':''}</div>`;
        if(currentTab==='files'){const ext=item.name.split('.').pop().toUpperCase().slice(0,10);return `<div class="cv-card-copy sp-board-copy"><span class="cv-card-kicker">ORIGINAL FILE</span><h2>${esc(item.name)}</h2><p>原件保存在本机，可预览或下载。</p></div><div class="sp-file-mark"><strong>${esc(ext||'FILE')}</strong><span>${sizeLabel(item.size)}</span></div><div class="sp-card-meta"><span>${dateLabel(item.createdAt)}</span></div>`;}
        return `<div class="cv-card-copy sp-board-copy ${item.done?'sp-card-done':''}"><span class="cv-card-kicker">${item.archived?'ARCHIVED TASK':item.done?'COMPLETED':'NEXT THING'}</span><h2>${esc(item.title)}</h2><p class="sp-card-excerpt">${esc(item.description||'属于这个空间，也同步显示在全局待办中。')}</p></div><div class="sp-card-meta"><span>${item.date?esc(item.date):'时间待安排'}</span>${item.priority==='high'?'<b>优先处理</b>':''}</div><div class="sp-card-actions">${item.archived?`<button class="btn" data-sp-action="restore-task" data-id="${esc(item.id)}">${icon('refresh',16)} 恢复事项</button>`:`<button class="btn" data-sp-action="toggle-task" data-id="${esc(item.id)}" aria-pressed="${!!item.done}">${icon(item.done?'refresh':'check',16)} ${item.done?'取消完成':'标记完成'}</button>`}<button class="btn" data-sp-action="edit-task" data-id="${esc(item.id)}">${icon('edit',16)} 编辑</button></div>`;
      }});
  }  function render() {
    if(!active)return;boardCleanup?.();boardCleanup=null;fitnessCleanup?.();fitnessCleanup=null;release();
    const fitnessEnabled=isFitnessSpace(space,state);if(!fitnessEnabled&&tab==='fitness')tab='workbench';hadFitness=fitnessEnabled;
    const countNotes=space.notes.filter(item=>!item.archived).length;
    root.innerHTML=`<section class="sp-page ${fitnessEnabled?'has-fitness':''}" style="--sp-color:${spaceColor(space)};--sp-on-color:${foreground(spaceColor(space))}"><div class="sp-back-row"><button class="sp-back" data-sp-action="home">${icon('arrow-left',17)} ${space.parentId?'回到上级空间':'回到主工作台'}</button><span>${icon('shield',14)} ${ctx.cloud?.enabled&&state.mode==='personal'?'连接工作台服务':'仅本机保存'}</span></div><header class="sp-hero"><div class="sp-hero-copy"><span class="sp-hero-icon">${icon(space.icon||'folder',34)}</span><div><span class="sp-hero-kicker">${esc(template()[1])} / MY SPACE</span><h1>${esc(space.title)}</h1><p>${esc(space.description||'笔记、资料和下一步行动，都有自己的位置。')}</p></div></div><div class="sp-hero-actions"><button class="btn sp-primary" data-sp-action="builder">${icon('layers',17)} 搭建这个空间</button><button class="btn" data-sp-action="settings">${icon('settings',17)} 空间设置</button><button class="btn sp-primary" data-sp-action="ai">${icon('sparkles',18)} 交给 AI</button></div><div class="sp-hero-bottom"><span>${countNotes} 篇笔记</span><span>${fileList().length} 份文件</span><span>${tasks().filter(item=>!item.done&&!item.archived).length} 件待办</span><button data-sp-action="archive-space">${icon(space.archived?'refresh':'archive',15)} ${space.archived?'恢复到主页':'归档空间'}</button></div></header>${space.archived?'<div class="sp-archived-banner">这个空间已归档，资料完整保留。点击「恢复到主页」可重新放回画布。</div>':''}<nav class="sp-tabs" aria-label="工作区内容">${[...(fitnessEnabled?[['fitness','运动统计','chart']]:[]),['workbench','空间画布','orbit'],['overview','内容总览','layers'],['notes','笔记','book'],['files','文件','folder'],['tasks','待办','check-circle']].map(([key,label,glyph])=>`<button class="${tab===key?'active':''}" data-sp-action="tab" data-tab="${key}" aria-current="${tab===key?'page':'false'}">${icon(glyph,19)} ${label}</button>`).join('')}</nav><div class="sp-tab-content">${tab==='fitness'?'<div data-fitness-host></div>':tab==='workbench'?'<div class="sp-section-tools"><p>从搭建台加入方块，在这里自由移动、缩放和使用。</p><button class="btn" data-sp-action="builder">添加或摆放方块</button></div>'+boardHost():tab==='overview'?overview():tab==='notes'?notesView():tab==='files'?filesView():tasksView()}</div><div class="sp-drop-overlay" aria-hidden="true">${icon('upload',46)}<strong>放入「${esc(space.title)}」</strong><span>文件会保存在这个工作区</span></div><input type="file" hidden multiple data-sp-file-input aria-label="添加工作区文件"></section>`;
    root.querySelector('.sp-page').style.setProperty('--sp-fill',canvasCardFill(spaceColor(space)));
    if(tab==='fitness')fitnessCleanup=mountFitness({...ctx,root:root.querySelector('[data-fitness-host]')},space);else if(tab==='workbench')mountSpaceCanvas();else mountBoard();
    if(tab==='files'&&selectedFile){const file=fileList().find(item=>item.id===selectedFile);if(file)preview(file);}
  }
  async function preview(file) {
    const ticket=++previewRequest, host=root.querySelector('[data-sp-preview]');
    try {
      const blob=await getFile(file.blobId);if(!active||ticket!==previewRequest||!host?.isConnected)return;
      if(!blob)throw new Error('文件不在当前浏览器中，可能已经被清理。请重新添加原件。');
      const ext=file.name.split('.').pop().toLowerCase();
      if(['txt','md','csv','json','log','js','ts','py','java','c','cpp','css'].includes(ext)){
        const value=await blob.slice(0,500000).text();if(!active||ticket!==previewRequest||!host.isConnected)return;
        host.innerHTML=`<pre class="sp-text-preview">${esc(value)}</pre>${blob.size>500000?'<p class="muted">仅预览前 500 KB，请下载查看完整内容。</p>':''}`;
      }else if(['png','jpg','jpeg','gif','webp'].includes(ext)){
        objectUrl=URL.createObjectURL(new Blob([blob],{type:ext==='jpg'||ext==='jpeg'?'image/jpeg':`image/${ext}`}));host.innerHTML=`<img src="${esc(objectUrl)}" alt="${esc(file.name)}">`;
      }else if(ext==='pdf'){
        objectUrl=URL.createObjectURL(new Blob([blob],{type:'application/pdf'}));host.innerHTML=`<iframe sandbox="" src="${esc(objectUrl)}" title="${esc(file.name)}"></iframe><p class="muted">如果当前浏览器无法预览 PDF，请下载原件查看。</p>`;
      }else host.innerHTML=blank('file','原件已经收好',supportsFileText(file)?'此格式不直接展示原件，下方可提取正文。也可下载后使用对应软件打开。':'此格式暂不支持浏览器预览与正文提取，可下载后使用对应软件打开。')+`<button class="btn" data-sp-action="download-file" data-id="${esc(file.id)}">${icon('download',17)} 下载原件</button>`;
      mountFileText(ctx,host,file);
    }catch(error){if(active&&ticket===previewRequest&&host?.isConnected)host.innerHTML=blank('file','这份文件暂时无法读取',esc(error.message));}
  }
  function noteDialog(note) {
    modal({title:note?'编辑空间笔记':'写一篇空间笔记',submitLabel:note?'保存新修订':'保存笔记',body:`<label class="field">标题<input name="title" required maxlength="120" value="${esc(note?.title||'')}" placeholder="这次想记录什么？"></label><label class="field">正文<textarea name="content" required maxlength="200000" rows="12" placeholder="写下要点、自己的理解和下一步。支持 # 标题、- 列表和代码块。">${esc(note?.content||'')}</textarea></label><label class="field">来源说明<input name="source" maxlength="500" value="${esc(note?.source||'')}" placeholder="例如：9 月宣传部例会，或对应文件名"></label><p class="muted small">${note?'保存时保留当前版本，可在修订记录中查看。':(ctx.cloud?.enabled?'笔记保存到当前工作台。':'笔记仅保存在当前浏览器。')}</p>`,onSubmit(data){
      const title=String(data.get('title')||'').trim(),content=String(data.get('content')||'').trim();
      if(!title||!content){toast('请填写标题和正文');return false;}
      const values={title,content,source:String(data.get('source')||'').trim(),updatedAt:stamp()};
      const noteId=note?.id||uid();
      commit(()=>{if(note){const current=space.notes.find(item=>item.id===note.id);if(!current)throw new Error('这篇笔记已不可用');current.revisions||=[];current.revisions.push({title:current.title,content:current.content,source:current.source,updatedAt:current.updatedAt,savedAt:stamp()});Object.assign(current,values);}else space.notes.unshift({id:noteId,...values,color:assignRecordColor(state),revisions:[],archived:false});});
      go('space',space.id,'notes',noteId);toast('笔记已保存，原有修订已保留');
    }});
  }
  function taskDialog(task) {
    modal({title:task?'调整这件事':'给空间添加待办',submitLabel:'保存待办',body:`<label class="field">要做什么<input name="title" required maxlength="160" value="${esc(task?.title||'')}" placeholder="例如：整理活动物资清单"></label><div class="form-grid"><label class="field">日期<input name="date" type="date" value="${esc(task?.date||'')}"></label><label class="field">优先级<select name="priority"><option value="normal">按计划进行</option><option value="high" ${task?.priority==='high'?'selected':''}>优先处理</option></select></label></div><label class="field">补充说明<textarea name="description" maxlength="5000" rows="4">${esc(task?.description||'')}</textarea></label>${task?`<label class="sp-check-label"><input name="archived" type="checkbox" ${task.archived?'checked':''}>归档这件事（可恢复）</label>`:''}<p class="muted small">属于「${esc(space.title)}」，同时出现在全局备忘与待办中。没有确定的时间可以留空。</p>`,onSubmit(data){
      const title=String(data.get('title')||'').trim();if(!title){toast('请写下要做的事');return false;}
      const values={title,date:String(data.get('date')||''),priority:data.get('priority')==='high'?'high':'normal',description:String(data.get('description')||'').trim(),archived:data.get('archived')==='on'};
      commit(()=>{if(task)Object.assign(state.tasks.find(item=>item.id===task.id),values);else state.tasks.unshift({id:uid(),...values,color:assignRecordColor(state),spaceId:space.id,category:'个人',done:false,source:`工作区 · ${space.title}`,createdAt:stamp()});});
      go('space',space.id,'tasks');toast('事项已保存到这个空间');
    }});
  }
  async function upload(files) {
    if(uploading||!files.length)return;uploading=true;toast('正在把文件保存到这个空间…');
    try {const result=await saveSpaceFiles(ctx,space,files);if(result.saved){go('space',space.id,'files',fileList()[0]?.id||'');}toast(`已保存 ${result.saved} 份文件${result.rejected?`，${result.rejected} 份未保存，请检查 40 MB 大小限制和存储空间`:''}`);}
    catch(error){toast(error.message||'保存未完成，请重试');}finally{uploading=false;}
  }
  async function onClick(event) {
    const button=event.target.closest('[data-sp-action]');if(!button||!root.contains(button))return;
    const action=button.dataset.spAction,note=space.notes.find(item=>item.id===button.dataset.id),task=state.tasks.find(item=>item.id===button.dataset.id&&item.spaceId===space.id);
    try {
      if(action==='home')return space.parentId?go('space',space.parentId):go('home');
      if(action==='builder')return go('builder',space.id);
      if(action==='ai')return openSpaceAI();
      if(action==='settings')return openSpaceDialog({...ctx,refresh:localRefresh},space);
      if(action==='tab')return go('space',space.id,button.dataset.tab==='workbench'?'':button.dataset.tab);
      if(action==='back-board')return go('space',space.id,tab);
      if(action==='new-note')noteDialog();
      if(action==='edit-note'&&note)noteDialog(note);
      if(action==='select-note')return go('space',space.id,'notes',button.dataset.id);
      if(action==='archive-note'&&note){commit(()=>{note.archived=!note.archived;});render();toast(note.archived?'笔记已归档，可在「显示已归档笔记」中恢复':'笔记已恢复');}
      if(action==='export-note'&&note)download(new Blob([`# ${note.title}\n\n${note.content}\n\n---\n来源：${note.source||'手动记录'}\n`],{type:'text/markdown;charset=utf-8'}),`${filename(note.title)}.md`);
      if(action==='note-history'&&note)modal({title:'每一次想法，都留有记录',body:`<p class="muted">当前为版本 ${(note.revisions?.length||0)+1}。以下为编辑前保留的版本。</p><div class="sp-history">${[...(note.revisions||[])].reverse().map((revision,index)=>`<details><summary><strong>版本 ${note.revisions.length-index} · ${esc(revision.title)}</strong><small>${dateLabel(revision.updatedAt)}</small></summary><article class="sp-prose">${prose(revision.content,esc)}</article><p class="sp-source">${esc(revision.source||'手动记录')}</p></details>`).join('')||'<div class="sp-empty"><p>还没有历史修订，下次编辑保存时会保留当前内容。</p></div>'}</div>`});
      if(action==='upload')root.querySelector('[data-sp-file-input]').click();
      if(action==='select-file')return go('space',space.id,'files',button.dataset.id);
      if(action==='download-file'){const file=fileList().find(item=>item.id===button.dataset.id);if(!file)return;const blob=await getFile(file.blobId);if(!blob)throw new Error('本机找不到原件，请重新添加文件');download(blob,file.name);}
      if(action==='new-task')taskDialog();
      if(action==='edit-task'&&task)taskDialog(task);
      if(action==='toggle-task'&&task){commit(()=>{task.done=!task.done;task.completedAt=task.done?stamp():null;});render();}
      if(action==='restore-task'&&task){commit(()=>{task.archived=false;});render();toast('事项已恢复');}
      if(action==='archive-space')modal({title:space.archived?'把这个空间放回主页':'归档这个空间',submitLabel:space.archived?'恢复到主页':'归档空间',body:`<p>「${esc(space.title)}」${space.archived?'会重新出现在主页画布上。':'会从主页画布收起，可从已归档空间中恢复。'}</p><p class="muted">笔记、文件和关联待办都会完整保留。</p>`,onSubmit(){const archived=!space.archived;commit(()=>{space.archived=archived;});toast(archived?'空间已归档，资料已保留':'空间已恢复到主页');if(archived)space.parentId?go('space',space.parentId):go('home');else localRefresh();}});
    }catch(error){toast(error.message||'操作暂未完成，请重试');}
  }
  function onChange(event){if(event.target.matches('[data-sp-file-input]')){const files=[...event.target.files];event.target.value='';upload(files);}if(event.target.matches('[data-sp-notes-archive]')){archivedNotes=event.target.checked;render();}if(event.target.matches('[data-sp-tasks-archive]')){archivedTasks=event.target.checked;render();}}
  function onDragOver(event){if(event.dataTransfer?.types?.includes('Files')){event.preventDefault();event.dataTransfer.dropEffect='copy';root.querySelector('.sp-page')?.classList.add('is-dragging');}}
  function onDragLeave(event){if(!root.contains(event.relatedTarget))root.querySelector('.sp-page')?.classList.remove('is-dragging');}
  function onDrop(event){if(!event.dataTransfer?.types?.includes('Files'))return;event.preventDefault();root.querySelector('.sp-page')?.classList.remove('is-dragging');upload([...event.dataTransfer.files]);}
  root.addEventListener('click',onClick);root.addEventListener('change',onChange);root.addEventListener('dragover',onDragOver);root.addEventListener('dragleave',onDragLeave);root.addEventListener('drop',onDrop);
  render();
  return()=>{active=false;boardCleanup?.();boardCleanup=null;fitnessCleanup?.();fitnessCleanup=null;release();root.removeEventListener('click',onClick);root.removeEventListener('change',onChange);root.removeEventListener('dragover',onDragOver);root.removeEventListener('dragleave',onDragLeave);root.removeEventListener('drop',onDrop);};
}
