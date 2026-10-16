import {getCustomBlocks,createCustomBlock,updateCustomBlock,validateBlockData} from './custom-blocks-model.js';
import {escapeHTML as esc} from './services.js';
import {mountMiniapp} from './miniapp-runtime.js';
import {getWorkbench,configureWorkbench} from './workbench-model.js';
import {placeBlock} from './placement-model.js';

const TYPES={note:'文本便签',checklist:'检查清单',links:'常用链接',progress:'目标进度',countdown:'日期倒计时',table:'数据表格',miniapp:'交互小程序'};
const clone=value=>structuredClone(value);
const entryId=()=>crypto.randomUUID();
const find=(state,id)=>getCustomBlocks(state).items.find(item=>item.id===id);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export const DEFAULT_MINIAPP_CODE=`let count=Number(app.getData().count)||0;
function draw(){
  app.render([
    {type:'heading',text:'我的计数器'},
    {type:'metric',label:'当前次数',value:count},
    {type:'button',id:'add',label:'加一次'}
  ]);
}
app.onEvent=async event=>{
  if(event.id==='add'&&event.type==='click'){
    const next={count:count+1};
    await app.setData(next);
    count=next.count;draw();
  }
};
draw();`;

export function customBlockType(kind){return TYPES[kind]||'自定义方块';}
export function customBlockSummary(block){
  const c=block.config||{};
  if(block.kind==='note')return (c.text||'写下想法，留在工作台上。').slice(0,180);
  if(block.kind==='checklist')return `${(c.items||[]).filter(item=>item.done).length} / ${(c.items||[]).length} 项已完成`;
  if(block.kind==='links')return `${(c.items||[]).length} 个常用链接`;
  if(block.kind==='progress')return `${c.value??0} / ${c.target??1} ${c.unit||''}`.trim();
  if(block.kind==='countdown')return `目标日期：${c.date||'尚未设置'}`;
  if(block.kind==='table')return `${(c.rows||[]).length} 行 · ${(c.columns||[]).length} 列`;
  return '按需运行的小程序，运行数据单独保存。';
}

/** A block mutation and its canvas geometry are saved together or both restored. */
export function saveCustomBlockChange(ctx,mutation){
  const keys=['customBlocks','canvas','workbench','updatedAt'],before=new Map(keys.map(key=>[key,{present:Object.hasOwn(ctx.state,key),value:clone(ctx.state[key]),reference:ctx.state[key]}]));
  try{const result=mutation(ctx.state);ctx.ensureCustomBlockLayout?.();const card=ctx.state.canvas?.cards?.find(item=>item.id===result?.id);if(card&&result.color)card.color=result.color;ctx.save();return result;}
  catch(error){for(const [key,record] of before){if(!record.present){delete ctx.state[key];continue;}if(key==='canvas'&&record.reference&&typeof record.reference==='object'&&!Array.isArray(record.reference)){for(const field of Object.keys(record.reference))delete record.reference[field];Object.assign(record.reference,record.value);ctx.state[key]=record.reference;}else ctx.state[key]=record.value;}throw error;}
}

/** Creating a real block begins the workbench without changing its chosen template. */
export function createCustomBlockOnWorkbench(ctx,input,{placement}={}){
  return saveCustomBlockChange(ctx,state=>{
    const record=createCustomBlock(state,input);
    configureWorkbench(state,{title:getWorkbench(state).title});
    if(placement)placeBlock(state,record.id,placement);
    return record;
  });
}

/** Each running program may update only the data version it most recently saved. */
export function createBlockDataWriter(ctx,id,{isActive=()=>true}={}){
  const initial=find(ctx.state,id);
  if(!initial||initial.kind!=='miniapp'||initial.archived)throw new Error('这个小程序已不存在或已收起。');
  const config=clone(initial.config);let expected=clone(initial.data);
  return data=>{
    const current=find(ctx.state,id);
    if(!isActive()||ctx.isCurrent?.()===false)throw new Error('运行已结束，未写入旧页面的数据。');
    if(!current||current.archived||current.kind!=='miniapp'||!same(current.config,config)||!same(current.data,expected))throw new Error('方块已被其他操作更新，请停止后重新运行。');
    const clean=validateBlockData(data);
    const result=saveCustomBlockChange(ctx,state=>updateCustomBlock(state,id,{data:clean}));
    expected=clone(result.data);return clone(result.data);
  };
}

function defaultConfig(kind){
  if(kind==='note')return {text:''};
  if(kind==='checklist'||kind==='links')return {items:[]};
  if(kind==='progress')return {value:0,target:100,unit:''};
  if(kind==='countdown')return {date:new Date(Date.now()+7*86400000).toISOString().slice(0,10)};
  if(kind==='table')return {columns:[{id:entryId(),label:'事项'},{id:entryId(),label:'备注'}],rows:[]};
  return {code:DEFAULT_MINIAPP_CODE};
}
function rowHTML(kind,item={}){
  const id=item.id||entryId();
  return `<div class="cb-edit-row" data-cb-row data-row-id="${esc(id)}">${kind==='checklist'?`<input type="checkbox" data-row-done aria-label="已完成" ${item.done?'checked':''}>`:''}<input data-row-label aria-label="${kind==='links'?'链接名称':'事项'}" placeholder="${kind==='links'?'链接名称':'写一个需要完成的事项'}" maxlength="200" value="${esc(item.label||'')}">${kind==='links'?`<input type="url" data-row-url aria-label="链接地址" placeholder="https://…" value="${esc(item.url||'')}">`:''}<button type="button" class="cb-row-remove" data-remove-row aria-label="移除这一行">×</button></div>`;
}
function configFields(kind,config){
  if(kind==='note')return `<label class="field">正文<textarea name="cb-text" rows="8" maxlength="20000" placeholder="写下要放在工作台上的内容">${esc(config.text||'')}</textarea></label>`;
  if(kind==='checklist'||kind==='links')return `<div class="cb-edit-rows">${(config.items?.length?config.items:[{}]).map(item=>rowHTML(kind,item)).join('')}</div><button type="button" class="btn" data-add-row>＋ 添加${kind==='links'?'链接':'事项'}</button><p class="muted small">空白行不会保存。${kind==='links'?'仅支持 http / https 网页链接。':'可以在方块页面直接勾选完成。'}</p>`;
  if(kind==='progress')return `<div class="form-grid"><label class="field">当前数值<input name="cb-value" type="number" step="any" min="0" required value="${esc(config.value??0)}"></label><label class="field">目标数值<input name="cb-target" type="number" step="any" min="0.000001" required value="${esc(config.target??100)}"></label></div><label class="field">单位<input name="cb-unit" maxlength="30" placeholder="例如：页、次、公里" value="${esc(config.unit||'')}"></label>`;
  if(kind==='countdown')return `<label class="field">目标日期<input name="cb-date" type="date" required value="${esc(config.date||'')}"></label><p class="muted small">按本机日期计算剩余天数。</p>`;
  if(kind==='table')return `<label class="field">列名（每行一个）<textarea name="cb-columns" rows="3" required>${esc((config.columns||[]).map(item=>item.label).join('\n'))}</textarea></label><label class="field">数据（每行一条，用制表符分列）<textarea name="cb-rows" rows="7" class="cb-table-input" placeholder="可从 Excel 复制单元格后粘贴到这里">${esc((config.rows||[]).map(item=>item.cells.join('\t')).join('\n'))}</textarea></label><p class="muted small">可直接增删数据行或修改列名；缺少的单元格留空。列数不足时请先补充列名。</p>`;
  return `<p class="cb-runtime-note">代码使用 app.render 显示界面，app.setData 保存本方块的数据。保存代码不会启动运行。</p><label class="field">小程序代码<textarea name="cb-code" rows="15" maxlength="30000" class="cb-code" spellcheck="false" required>${esc(config.code||DEFAULT_MINIAPP_CODE)}</textarea></label><div class="cb-run-toolbar"><button type="button" class="btn" data-cb-preview>预览草稿</button><button type="button" class="btn" data-cb-preview-stop>停止预览</button></div><p class="muted small">预览中的操作仅用于试用，不保存运行数据。代码修改后需重新预览。</p><div data-cb-preview-host></div><details class="cb-api-help"><summary>查看编写指引与接口</summary><p>app.getData() 读取数据；await app.setData(对象) 保存数据；app.render(组件数组) 更新界面；app.onEvent 接收交互。界面由平台组件构成，不接受 HTML 或外部脚本。</p><pre>${esc(DEFAULT_MINIAPP_CODE)}</pre></details>`;
}
function readConfig(form,kind,previous){
  const value=name=>form.querySelector(`[name="${name}"]`)?.value||'';
  if(kind==='note')return {text:value('cb-text')};
  if(kind==='checklist'||kind==='links')return {items:[...form.querySelectorAll('[data-cb-row]')].map(row=>({id:row.dataset.rowId,label:row.querySelector('[data-row-label]').value.trim(),...(kind==='checklist'?{done:row.querySelector('[data-row-done]').checked}:{url:row.querySelector('[data-row-url]').value.trim()})})).filter(item=>item.label||item.url)};
  if(kind==='progress')return {value:Number(value('cb-value')),target:Number(value('cb-target')),unit:value('cb-unit').trim()};
  if(kind==='countdown')return {date:value('cb-date')};
  if(kind==='table'){
    const columns=value('cb-columns').split(/\r?\n/).map(label=>label.trim()).filter(Boolean).map((label,index)=>({id:previous.columns?.[index]?.id||entryId(),label}));
    const rows=value('cb-rows').split(/\r?\n/).filter(line=>line.trim()).map((line,index)=>{const cells=line.split('\t');if(cells.length>columns.length)throw new Error(`第 ${index+1} 行的单元格多于列数，请补充列名。`);return {id:previous.rows?.[index]?.id||entryId(),cells:columns.map((_,column)=>cells[column]||'')};});
    return {columns,rows};
  }
  return {code:value('cb-code')};
}

export function customBlockEditor(ctx,inputOrId={},options={}){
  const existing=typeof inputOrId==='string'?find(ctx.state,inputOrId):null;
  if(typeof inputOrId==='string'&&!existing){ctx.toast('这个方块已不存在，请刷新后重试。');return;}
  const initial=existing||inputOrId||{},configs=new Map();let kind=TYPES[initial.kind]?initial.kind:'note';
  let disposePreview=null,previewHost=null;
  const stopPreview=()=>{disposePreview?.();disposePreview=null;previewHost?.replaceChildren();};
  const previewExit=()=>stopPreview();window.addEventListener('hashchange',previewExit);
  configs.set(kind,clone(initial.config||defaultConfig(kind)));
  const initialVersion=existing?JSON.stringify(existing):null;
  ctx.modal({title:existing?'编辑自定义方块':'创建自己的方块',submitLabel:existing?'保存修改':'创建方块',onClose(){stopPreview();window.removeEventListener('hashchange',previewExit);},body:`<div class="cb-editor"><label class="field">方块名称<input name="cb-title" maxlength="80" required value="${esc(initial.title||'')}"></label><div class="form-grid"><label class="field">方块类型<select name="cb-kind" ${existing?'disabled':''}>${Object.entries(TYPES).map(([id,label])=>`<option value="${id}" ${id===kind?'selected':''}>${label}</option>`).join('')}</select></label><label class="field">颜色<input name="cb-color" type="color" value="${/^#[\da-f]{6}$/i.test(initial.color||'')?initial.color:'#AE88FF'}"></label></div><label class="field">简短说明<input name="cb-description" maxlength="2000" value="${esc(initial.description||'')}"></label>${existing?`<label class="cb-check-item"><input name="cb-visible" type="checkbox" ${existing.archived?'':'checked'}><span>显示在工作台（取消后保留内容与运行数据）</span></label>`:''}<div data-cb-config>${configFields(kind,configs.get(kind))}</div></div>`,onSubmit(_data,form){
    if(ctx.isCurrent?.()===false)throw new Error('工作区已切换，请在当前工作区重新编辑。');
    if(existing&&JSON.stringify(find(ctx.state,existing.id))!==initialVersion)throw new Error('方块已被其他操作更新，请关闭后重新编辑。');
    stopPreview();const config=readConfig(form,kind,configs.get(kind)),patch={title:form.querySelector('[name="cb-title"]').value.trim(),description:form.querySelector('[name="cb-description"]').value.trim(),color:form.querySelector('[name="cb-color"]').value,config,...(existing?{archived:!form.querySelector('[name="cb-visible"]').checked}:{})};
    const record=existing?saveCustomBlockChange(ctx,state=>updateCustomBlock(state,existing.id,patch)):createCustomBlockOnWorkbench(ctx,{...patch,kind,data:clone(initial.data||{})},options);
    ctx.toast(existing?'方块已更新，运行数据保留。':options.placement?'方块已创建并放到选定位置，双击可以打开。':'方块已创建，可在搭建台摆放。');
    if(!existing&&options.placement&&options.onCreated)options.onCreated(record);
    else if(existing||options.placement)ctx.refresh?.();else ctx.go('block',record.id);
  }});
  const dialog=document.querySelector('#modal'),form=dialog.querySelector('form');
  const kindInput=form.querySelector('[name="cb-kind"]');kindInput.value=kind;
  kindInput.addEventListener('change',()=>{
    stopPreview();
    try{configs.set(kind,readConfig(form,kind,configs.get(kind)));}catch{}
    kind=kindInput.value;if(!configs.has(kind))configs.set(kind,defaultConfig(kind));
    form.querySelector('[data-cb-config]').innerHTML=configFields(kind,configs.get(kind));
  });
  form.addEventListener('click',event=>{
    if(event.target.closest('[data-add-row]'))form.querySelector('.cb-edit-rows').insertAdjacentHTML('beforeend',rowHTML(kind));
    if(event.target.closest('[data-remove-row]'))event.target.closest('[data-cb-row]')?.remove();
    if(event.target.closest('[data-cb-preview-stop]'))stopPreview();
    if(event.target.closest('[data-cb-preview]')){stopPreview();previewHost=form.querySelector('[data-cb-preview-host]');disposePreview=mountMiniapp(previewHost,{code:form.querySelector('[name="cb-code"]').value,data:clone(initial.data||{}),preview:true});}
  });
  form.addEventListener('input',event=>{if(event.target.name==='cb-code')stopPreview();});
}

export function mountCustomBlockPage(ctx,id){
  const {root,state,toast}=ctx;let active=true,disposeRuntime=null,runId=0,timer=null;
  const get=()=>find(state,id);
  function stop(){runId++;disposeRuntime?.();disposeRuntime=null;const host=root.querySelector('[data-cb-runtime]');if(host)host.replaceChildren();}
  function status(message){const el=root.querySelector('[data-cb-status]');if(el)el.textContent=message;}
  function running(value){const run=root.querySelector('[data-cb-action="run"]'),stopButton=root.querySelector('[data-cb-action="stop"]');if(run)run.disabled=value;if(stopButton)stopButton.disabled=!value;}
  function mutate(patch){const result=saveCustomBlockChange(ctx,workspace=>updateCustomBlock(workspace,id,patch));return result;}
  function content(block){
    const c=block.config;
    if(block.kind==='note')return `<article class="cb-note">${esc(c.text||'还没有正文，点击编辑开始记录。')}</article>`;
    if(block.kind==='checklist')return `<div class="cb-checklist">${c.items.map(item=>`<label class="cb-check-item ${item.done?'is-done':''}"><input type="checkbox" data-cb-check="${esc(item.id)}" ${item.done?'checked':''}><span>${esc(item.label)}</span></label>`).join('')||'<p class="muted">还没有事项，点击编辑添加。</p>'}</div>`;
    if(block.kind==='links')return `<div class="cb-links">${c.items.map(item=>`<a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer"><strong>${esc(item.label)}</strong><small>${esc(item.url)}</small><span aria-hidden="true">↗</span></a>`).join('')||'<p class="muted">还没有链接，点击编辑添加。</p>'}</div>`;
    if(block.kind==='progress')return `<div class="cb-progress"><strong>${esc(c.value)} <small>/ ${esc(c.target)} ${esc(c.unit||'')}</small></strong><progress value="${Math.min(c.value,c.target)}" max="${c.target}"></progress><form data-cb-progress><label class="field">更新当前数值<input type="number" name="value" step="any" min="0" required value="${esc(c.value)}"></label><button class="btn primary" type="submit">保存进度</button></form></div>`;
    if(block.kind==='countdown'){const today=new Date(),start=Date.UTC(today.getFullYear(),today.getMonth(),today.getDate()),target=Date.parse(`${c.date}T00:00:00Z`),days=Math.round((target-start)/86400000);return `<div class="cb-countdown"><span>${days<0?'距目标日期已过去':days===0?'目标就在今天':'距离目标还有'}</span><strong>${Math.abs(days)}<small>天</small></strong><p>${esc(c.date)}</p></div>`;}
    if(block.kind==='table')return `<div class="cb-table-scroll"><table><thead><tr>${c.columns.map(column=>`<th scope="col">${esc(column.label)}</th>`).join('')}</tr></thead><tbody>${c.rows.map(row=>`<tr>${row.cells.map(cell=>`<td>${esc(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>${c.rows.length?'':'<p class="muted">暂无数据，点击编辑粘贴或录入。</p>'}</div>`;
    return `<div class="cb-run-toolbar"><button type="button" class="btn primary" data-cb-action="run">运行小程序</button><button type="button" class="btn" data-cb-action="stop" disabled>停止</button><span>由平台组件显示界面，只保存本方块的数据。</span></div><p class="cb-runtime-status" data-cb-status role="status">尚未运行。保存源码或打开页面不会自动运行。</p><div class="cb-runtime-host" data-cb-runtime></div><details class="cb-saved-code"><summary>查看已保存的代码</summary><pre>${esc(c.code)}</pre></details>`;
  }
  function render(){
    stop();if(!active)return;const block=get();
    if(!block){root.innerHTML='<div class="empty-state"><h2>暂时找不到这个方块</h2><button class="btn" data-cb-action="home">回到工作台</button></div>';return;}
    root.innerHTML=`<section class="cb-page" style="--cb-color:${block.color}"><div class="cb-back"><button type="button" class="text-btn" data-cb-action="home">← 回到工作台</button><button type="button" class="text-btn" data-cb-action="builder">在搭建台摆放</button></div><header class="cb-page-head"><div><span class="cb-type">${customBlockType(block.kind)}</span><h1>${esc(block.title)}</h1><p>${esc(block.description||'按自己的需要创建和使用。')}</p></div><div class="cb-actions"><button type="button" class="btn" data-cb-action="edit">编辑方块</button><button type="button" class="btn" data-cb-action="archive">${block.archived?'恢复到工作台':'收起方块'}</button></div></header>${block.archived?'<p class="cb-archive-note">这个方块已收起，内容和运行数据保留。恢复后可继续使用。</p>':''}<section class="panel cb-content">${block.archived?'':content(block)}</section></section>`;
  }
  function onClick(event){
    const action=event.target.closest('[data-cb-action]')?.dataset.cbAction;if(!action||!active)return;
    try{
      if(action==='home')ctx.go('home');
      if(action==='builder')ctx.go('builder');
      if(action==='edit'){stop();if(get()?.kind==='miniapp'){status('已停止，保存代码后可重新运行。');running(false);}customBlockEditor(ctx,id);}
      if(action==='archive'){stop();mutate({archived:!get().archived});render();}
      if(action==='stop'){stop();status('已停止，最近一次保存的运行数据保留。');running(false);}
      if(action==='run'){
        stop();const block=get();if(!block||block.archived)return;
        const generation=runId,write=createBlockDataWriter(ctx,id,{isActive:()=>active&&generation===runId});
        running(true);status('正在启动运行会话，操作成功后保存数据。');
        disposeRuntime=mountMiniapp(root.querySelector('[data-cb-runtime]'),{code:block.config.code,data:clone(block.data),onData:data=>{const result=write(data);status('运行中 · 数据已保存');return result;},onError:error=>{if(active&&generation===runId)status(`运行提示：${error?.message||String(error)}`);},onStop:message=>{if(!active||generation!==runId)return;runId++;running(false);status(message);}});
      }
    }catch(error){if(action==='run'){stop();running(false);}toast(error.message||'操作未完成，请重试。');status(error.message);}
  }
  function onChange(event){
    if(!event.target.matches('[data-cb-check]')||!active)return;
    const block=get(),config=clone(block.config),item=config.items.find(row=>row.id===event.target.dataset.cbCheck);if(!item)return;
    try{item.done=event.target.checked;mutate({config});render();}catch(error){event.target.checked=!event.target.checked;toast(error.message);}
  }
  function onSubmit(event){
    if(!event.target.matches('[data-cb-progress]')||!active)return;event.preventDefault();
    try{mutate({config:{...get().config,value:Number(new FormData(event.target).get('value'))}});render();toast('进度已保存。');}catch(error){toast(error.message);}
  }
  root.addEventListener('click',onClick);root.addEventListener('change',onChange);root.addEventListener('submit',onSubmit);render();
  if(get()?.kind==='countdown')timer=setInterval(()=>{if(active&&get()?.kind==='countdown')render();},60000);
  return ()=>{active=false;stop();clearInterval(timer);root.removeEventListener('click',onClick);root.removeEventListener('change',onChange);root.removeEventListener('submit',onSubmit);};
}
