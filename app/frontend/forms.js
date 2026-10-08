
export function createForms(ctx){
 const {esc,icon,openDialog,dialog,toast}=ctx,arr=v=>Array.isArray(v)?v:[];
 const state=()=>ctx.state(),work=()=>ctx.workspace(),cols=()=>state().collections.filter(c=>c.workspaceId===work()?.id),assets=()=>state().assets.filter(a=>a.workspaceId===work()?.id&&!a.archived);
 const option=(id,label,selected)=>`<option value="${esc(id)}"${selected?' selected':''}>${esc(label)}</option>`;
 const foot=(text='保存')=>`<p class="form-error" role="alert"></p><button class="button primary full" type="submit">${text}</button>`;
 const begin=(kind,id='')=>`<form data-cu-form="${kind}" data-id="${esc(id)}" data-revision="${state().revision}">`;
 const textField=(label,name,value='',extra='')=>`<label class="field">${label}<input name="${name}" value="${esc(value)}" ${extra}></label>`;
 function workspaceCreate(template='blank'){
  const existing=state().workspaces.find(w=>w.id===ctx.meta().officeStarter?.workspaceId),templates=(ctx.meta().templates||[]).filter(t=>t.id!=='office'||!existing);
  if(template==='office'&&existing&&!existing.archived){ctx.openWorkspace(existing.id);if(dialog.open)dialog.close();return;}
  if(template==='office'&&existing)template='blank';
  openDialog('创建你的空间',`<p class="dialog-intro">从一点空白开始，或借一套结构。普通上班族模板带有虚构事务，方便你先试用；其他模板仅创建结构。模板会先生成草稿，核对后再保存。</p>${existing?`<div class="cu-existing-starter"><span><strong>普通上班族 · 示例工作台${existing.archived?'已归档':'已建立'}</strong><small>${existing.archived?'恢复后继续使用原有事务和资料。':'打开后可以自由删改示例内容。'}</small></span><button class="button secondary" type="button" data-action="office-starter-open">${existing.archived?'恢复示例工作台':'打开示例工作台'}</button></div>`:''}${begin('workspace-create')}${textField('空间名称','name',template==='office'?'普通上班族 · 示例工作台':'','required maxlength="120" placeholder="给这个空间起个名字"')}<div class="template-picks"><label class="template-pick"><input type="radio" name="template" value="blank"${template==='blank'?' checked':''}><span>${icon('plus')}<strong>空白空间</strong><small>亲手放下第一块积木</small></span></label>${templates.map(t=>`<label class="template-pick"><input type="radio" name="template" value="${esc(t.id)}"${template===t.id?' checked':''}><span>${icon(t.id==='study'?'book':t.id==='office'?'columns':'board')}<strong>${esc(t.name)}</strong><small>${esc(t.description)}</small>${t.id==='office'?'<b class="cu-template-example">含虚构示例 · 工作 / 项目 / 生活</b>':''}<em>${arr(t.components).map(type=>ctx.typeLabel(type)).join(' · ')}</em></span></label>`).join('')}</div><p class="small-note">新空间不会覆盖已有空间，也不会读取你的个人工作台。</p>${foot(template==='blank'?'创建空白空间':'预览并核对')}</form>`);
 }
 function workspaceEdit(){
  const w=work();if(!w)return;
  openDialog('空间设置',`${begin('workspace-edit',w.id)}${textField('空间名称','name',w.name,'required maxlength="120"')}${textField('时区','timezone',w.timezone||'Asia/Shanghai','required placeholder="Asia/Shanghai"')}<div class="field-pair"><label class="field">内容密度<select name="density">${option('comfortable','舒展',w.preferences?.density!=='compact')}${option('compact','紧凑',w.preferences?.density==='compact')}</select></label><label class="field">画布主题<select name="theme">${option('light','浅色',w.preferences?.theme!=='dark')}${option('dark','深色',w.preferences?.theme==='dark')}</select></label></div><label class="field">强调色<input name="accent" type="color" value="${esc(w.preferences?.accent||'#8b74bd')}"></label><label class="field">常用模块<select name="favoriteComponents" multiple size="5">${ctx.meta().catalog.components.map(c=>option(c.type,c.label,w.preferences?.favoriteComponents?.includes(c.type))).join('')}</select><span class="small-note">常用模块会在模块库中优先排列。</span></label><label class="field">优先展示内容<textarea name="priorityText" rows="3" maxlength="500" placeholder="例如：先看未完成事项，资料放在右侧">${esc(w.preferences?.priorityText||'')}</textarea><span class="small-note">最多 500 字；作为显式偏好提供给伙伴。</span></label><button class="text-button" type="button" data-form-command="preferences-reset" data-id="${esc(w.id)}">恢复默认偏好</button><div class="dialog-divider"></div><button class="text-button danger" type="button" data-form-command="archive" data-op="workspace.archive" data-id="${esc(w.id)}" data-archived="true">归档这个空间</button><p class="small-note">归档后仍可从空间列表恢复。</p>${foot('保存空间设置')}</form>`);
 }
 function pageEditor(id=''){
  const p=work()?.pages.find(p=>p.id===id);
  openDialog(id?'重命名页面':'添加页面',`${begin(id?'page-edit':'page-new',id)}${textField('页面名称','name',p?.name||'','required maxlength="100" placeholder="例如：灵感地图"')}${foot(id?'保存名称':'添加页面')}</form>`);
 }
 function moduleLibrary(){
  if(!work()){workspaceCreate();return;}
  const favorites=work().preferences?.favoriteComponents||[],definitions=[...ctx.meta().catalog.components].sort((a,b)=>Number(favorites.includes(b.type))-Number(favorites.includes(a.type)));
  openDialog('放入一块新模块',`<p class="dialog-intro">同一组记录可以出现在多个视图里，改动始终同步。</p><div class="module-library">${definitions.map(c=>`<button data-form-command="component-new" data-type="${esc(c.type)}"><span class="library-symbol type-${esc(c.type)}">${icon(c.type)}</span><span><strong>${esc(c.label)}${favorites.includes(c.type)?' · 常用':''}</strong><small>${esc(c.description)}</small></span>${icon('plus')}</button>`).join('')}</div>`);
 }
 function componentEditor(id='',type='text'){
  const c=state().components.find(c=>c.id===id);if(c)type=c.type;
  const bound=cols().find(col=>col.id===c?.binding?.collectionId),isData=['list','board','calendar'].includes(type);
  openDialog(id?'模块设置':'添加'+ctx.typeLabel(type),`${begin(id?'component-edit':'component-new',id)}<input type="hidden" name="type" value="${esc(type)}">${textField('模块标题','title',c?.title||ctx.typeLabel(type),'required maxlength="160"')}
  ${id&&work()?.pages.length>1?`<label class="field">放在哪个页面<select name="pageId">${work().pages.map(p=>option(p.id,p.name,p.id===c.pageId)).join('')}</select></label>`:''}
  ${isData?`<label class="field">显示方式<select name="viewType">${['list','board','calendar'].map(t=>option(t,ctx.typeLabel(t),t===type)).join('')}</select></label><label class="field">使用哪组记录<select name="collectionId">${option('__new__','建立一组新记录',!bound)}${cols().map(col=>option(col.id,col.name,col.id===bound?.id)).join('')}</select></label><label class="field new-collection-name"${bound?' hidden':''}>记录组名称<input name="collectionName" value="${esc((c?.title||ctx.typeLabel(type))+'记录')}" maxlength="120"></label><div class="binding-options"${!bound?' hidden':''}><div class="field-pair"><label class="field">看板分组字段<select name="statusFieldId"></select></label><label class="field">日历日期字段<select name="dateFieldId"></select></label></div><label class="field">显示字段<select name="visibleFieldIds" multiple size="4"></select><span class="small-note">不选择时显示全部字段。Ctrl / Command 可多选。</span></label><details class="form-details"><summary>筛选与排序</summary><div class="field-pair"><label class="field">筛选字段<select name="filterFieldId"></select></label><label class="field">条件<select name="filterOperator">${['eq','contains','before','after'].map((v,i)=>option(v,['等于','包含','早于 / 小于','晚于 / 大于'][i],v===(c?.props?.filter?.operator||'eq'))).join('')}</select></label></div>${textField('筛选值','filterValue',c?.props?.filter?.value??'','placeholder="单选字段填选项标签"')}<div class="field-pair"><label class="field">排序字段<select name="sortFieldId"></select></label><label class="field">顺序<select name="sortDirection">${option('asc','升序',c?.props?.sort?.direction!=='desc')}${option('desc','降序',c?.props?.sort?.direction==='desc')}</select></label></div></details></div><p class="small-note">新建记录组包含标题、状态和日期字段，稍后可以自行增加字段。</p>`:''}
  ${type==='text'?`<label class="field">笔记内容<textarea name="content" rows="7" maxlength="40000">${esc(c?.props?.content||'')}</textarea></label>`:''}
  ${type==='resources'?`<label class="field">显示的资料<select name="assetIds" multiple size="5">${assets().map(a=>option(a.id,a.title,c?.props?.assetIds?.includes(a.id))).join('')}</select><span class="small-note">不选择时显示本空间全部资料。</span></label>`:''}
  ${id?`<details class="form-details"${ctx.arrange()?' open':''}><summary>位置与尺寸 · 12 列画布</summary><div class="layout-fields">${[['x','横向位置',0,11],['y','纵向位置',0,500],['w','宽度',2,12],['h','高度',2,24]].map(([key,label,min,max])=>textField(label,key,c.layout[key],`type="number" required min="${min}" max="${max}" step="1"`)).join('')}</div><p class="small-note">位置从 0 开始；与其他模块重叠时不会保存。看板和日历至少 4 × 4。</p></details><label class="check-field"><input type="checkbox" name="collapsed"${c.props?.collapsed?' checked':''}>折叠模块内容</label><button class="text-button danger" type="button" data-form-command="archive" data-op="component.archive" data-id="${esc(id)}" data-archived="true">归档这个模块</button><p class="small-note">只收起视图，底层记录仍然保留。</p>`:''}${foot(id?'保存模块':'放入画布')}</form>`);
  if(isData)updateBindingInputs(dialog.querySelector('form'),bound?.id||'__new__',c);
 }
 function updateBindingInputs(form,id,c){
  const col=cols().find(col=>col.id===id);
  form.querySelector('.binding-options').hidden=!col;form.querySelector('.new-collection-name').hidden=!!col;
  if(!col)return;
  const fill=(name,fields,selected,empty='不设置')=>{form.elements[name].innerHTML=(name==='visibleFieldIds'?'':option('',empty,!selected))+fields.map(f=>option(f.id,f.name,Array.isArray(selected)?selected.includes(f.id):selected===f.id)).join('');};
  fill('statusFieldId',col.fields.filter(f=>f.type==='select'),c?.binding?.statusFieldId||col.semanticBindings?.status);
  fill('dateFieldId',col.fields.filter(f=>f.type==='date'),c?.binding?.dateFieldId||col.semanticBindings?.dueDate||col.semanticBindings?.start);
  fill('visibleFieldIds',col.fields,c?.props?.visibleFieldIds||[]);
  fill('filterFieldId',col.fields,c?.props?.filter?.fieldId);fill('sortFieldId',col.fields,c?.props?.sort?.fieldId);
 }
 function noteEditor(id){const c=state().components.find(c=>c.id===id);openDialog(c.title,`${begin('note',id)}<label class="field">内容<textarea name="content" class="large-textarea" rows="12" maxlength="40000">${esc(c.props?.content||'')}</textarea></label>${foot('保存笔记')}</form>`);}
 function fieldInput(f,value){
  const name='value:'+f.id,label=esc(f.name),v=value??'';
  if(f.type==='select')return `<label class="field">${label}<select name="${esc(name)}">${option('','未填写',!v)}${f.options.map(o=>option(o.id,o.label,o.id===v)).join('')}</select></label>`;
  if(f.type==='relation'){
   const target=state().collections.find(c=>c.id===f.targetCollectionId),records=state().records.filter(r=>r.collectionId===target?.id&&!r.archived);
   return `<label class="field">${label}<select name="${esc(name)}" multiple size="4">${records.map(r=>option(r.id,ctx.recordLabel(r,target),arr(v).includes(r.id))).join('')}</select><span class="small-note">可选择多条记录。</span></label>`;
  }
  if(f.type==='date'){const parts=String(v).split('T');return `<div class="field-pair"><label class="field">${label}<input type="date" name="${esc(name)}" value="${esc(parts[0])}"></label><label class="field">具体时刻（选填）<input type="time" name="time:${esc(f.id)}" value="${esc(parts[1]||'')}"></label></div>`;}
  return f.type==='number'?textField(label,name,v,'type="number" step="any"'):`<label class="field">${label}<textarea name="${esc(name)}" rows="2" maxlength="12000">${esc(v)}</textarea></label>`;
 }
 function recordEditor(id='',componentId='',collectionId=''){
  const r=state().records.find(r=>r.id===id),c=state().components.find(c=>c.id===componentId),col=state().collections.find(col=>col.id===(r?.collectionId||collectionId||c?.binding?.collectionId));
  if(!col){toast('请先为模块选择一组记录。',true);return;}
  openDialog(id?'编辑记录':'添加记录',`<p class="dialog-intro">${esc(col.name)} · 保存后，连接这组记录的所有视图都会同步。</p>${begin(id?'record-edit':'record-new',id)}<input type="hidden" name="collectionId" value="${esc(col.id)}">${col.fields.map(f=>fieldInput(f,r?.values[f.id])).join('')}<label class="field">关联资料<select name="assetIds" multiple size="4">${assets().map(a=>option(a.id,a.title,r?.assetIds?.includes(a.id))).join('')}</select></label>${arr(r?.sourceRefs).length?`<details class="form-details"><summary>原文依据</summary>${r.sourceRefs.map(ref=>`<blockquote><strong>${esc(state().assets.find(a=>a.id===ref.assetId)?.title||'资料')}</strong><p>${esc(ref.quote)}</p></blockquote>`).join('')}</details>`:''}${id?`<button type="button" class="text-button danger" data-form-command="archive" data-op="record.archive" data-id="${esc(id)}" data-archived="true">归档这条记录</button>`:''}${foot('保存记录')}</form>`);
 }
 function assetEditor(id=''){
  const a=state().assets.find(a=>a.id===id)||{};
  openDialog(id?'编辑资料':'保存一份资料',`${begin(id?'asset-edit':'asset-new',id)}${textField('资料标题','title',a.title||'','required maxlength="160"')}<label class="field">文字内容<textarea name="text" rows="9" maxlength="100000" placeholder="粘贴要保留的文字；AI提取内容时可以回看这里。">${esc(a.text||'')}</textarea></label>${textField('网页链接（选填）','linkUrl',a.linkUrl||'','type="url" placeholder="https://…"')}<p class="small-note">保存链接不会自动读取网页。</p>${a.linkUrl?`<a class="text-button" href="${esc(a.linkUrl)}" target="_blank" rel="noopener noreferrer">${icon('link')}打开链接</a>`:''}${id?`<button class="text-button danger" type="button" data-form-command="archive" data-op="asset.archive" data-id="${esc(id)}" data-archived="true">归档资料</button>`:''}${foot('保存资料')}</form>`);
 }
 function collectionEditor(id){
  const col=cols().find(c=>c.id===id);if(!col)return;
  openDialog('字段与记录组',`<div class="collection-heading"><span>${icon('list')}${esc(col.name)}</span><button class="button secondary" data-form-command="field-new" data-id="${esc(id)}">${icon('plus')}增加字段</button></div><div class="field-list">${col.fields.map(f=>`<button data-form-command="field-edit" data-id="${esc(id)}" data-field="${esc(f.id)}"><strong>${esc(f.name)}</strong><small>${{text:'文字',number:'数字',date:'日期',select:'单选',relation:'关联'}[f.type]}</small>${icon('chevron')}</button>`).join('')}</div>${begin('collection-edit',id)}${textField('记录组名称','name',col.name,'required maxlength="120"')}<details class="form-details" open><summary>这些字段分别表示什么？</summary><p class="small-note">明确后，标题、待办与日期才能在不同视图中保持一致。</p>${[['title','记录标题'],['status','状态'],['dueDate','截止日期'],['start','安排开始'],['end','安排结束']].map(([key,label])=>`<label class="field">${label}<select name="binding:${key}">${option('','不设置',!col.semanticBindings?.[key])}${col.fields.filter(f=>key==='status'?f.type==='select':['dueDate','start','end'].includes(key)?f.type==='date':f.type==='text').map(f=>option(f.id,f.name,col.semanticBindings?.[key]===f.id)).join('')}</select></label>`).join('')}<label class="field">哪些状态表示完成？<select name="doneOptions" multiple size="3">${(col.fields.find(f=>f.id===col.semanticBindings?.status)?.options||[]).map(o=>option(o.id,o.label,col.semanticBindings?.doneOptions?.includes(o.id))).join('')}</select></label></details>${foot('保存记录组设置')}</form>`);
 }
 function fieldEditor(collectionId,fieldId=''){
  const col=cols().find(c=>c.id===collectionId),f=col.fields.find(f=>f.id===fieldId);
  openDialog(f?'编辑字段':'增加字段',`${begin(f?'field-edit':'field-new',collectionId)}<input type="hidden" name="fieldId" value="${esc(fieldId)}">${textField('字段名称','name',f?.name||'','required maxlength="100"')}<label class="field">字段类型<select name="fieldType"${f?' disabled':''}>${[['text','文字'],['number','数字'],['date','日期'],['select','单选'],['relation','关联记录']].map(([id,label])=>option(id,label,id===(f?.type||'text'))).join('')}</select></label><div class="select-field-settings"${f?.type==='select'?'':' hidden'}>${f?.type==='select'?`<p class="small-note">修改标签会保留原选项与记录的对应关系。</p>${f.options.map(o=>textField('已有选项','option:'+o.id,o.label,'required maxlength="100"')).join('')}`:''}<label class="field">${f?'添加选项':'单选选项'} · 每行一个<textarea name="optionsText" rows="4" placeholder="每行填写一个选项"></textarea></label></div><label class="field relation-field-settings"${f?.type==='relation'?'':' hidden'}>关联到哪组记录<select name="targetCollectionId"${f?' disabled':''}>${cols().map(c=>option(c.id,c.name,c.id===f?.targetCollectionId)).join('')}</select></label>${f?'<p class="small-note">已有字段类型保持不变；本版不提供删除字段。</p>':''}${foot(f?'保存字段':'添加字段')}</form>`);
 }
 function archives(){
  const w=work(),groups=[['空间','workspace',state().workspaces.filter(w=>w.archived)],['模块','component',state().components.filter(c=>c.workspaceId===w?.id&&c.archived)],['记录','record',state().records.filter(r=>r.archived&&cols().some(c=>c.id===r.collectionId))],['资料','asset',state().assets.filter(a=>a.workspaceId===w?.id&&a.archived)]];
  openDialog('已归档内容',`<p class="dialog-intro">归档保留内容和关系。恢复时会重新检查布局与引用。</p>${groups.map(([label,op,rows])=>`<section class="archive-group"><h3>${label} <span>${rows.length}</span></h3>${rows.map(r=>`<div><strong>${esc(r.name||r.title||(r.values?ctx.recordLabel(r,state().collections.find(c=>c.id===r.collectionId)):'未命名'))}</strong><button class="text-button" data-form-command="archive" data-op="${op}.archive" data-id="${esc(r.id)}" data-archived="false">恢复</button></div>`).join('')||'<p class="small-note">暂无归档内容</p>'}</section>`).join('')}`);
 }
 function defaultCollection(name){
  return {op:'collection.create',name,ref:'newCollection',fields:[{name:'标题',type:'text',ref:'titleField'},{name:'状态',type:'select',ref:'statusField',options:[{label:'待办',ref:'todoOption'},{label:'进行中',ref:'doingOption'},{label:'已完成',ref:'doneOption'}]},{name:'日期',type:'date',ref:'dateField'}],semanticBindings:{title:'$titleField',status:'$statusField',dueDate:'$dateField',doneOptions:['$doneOption']}};
 }
 async function submit(form){
  const kind=form.dataset.cuForm,v=Object.fromEntries(new FormData(form)),id=form.dataset.id,selected=name=>[...form.elements[name].selectedOptions].map(o=>o.value),actions=[];
  try{
   if(kind==='workspace-create')actions.push({op:'workspace.create',name:v.name,template:v.template});
   else if(kind==='workspace-edit'){const w=work();actions.push({op:'workspace.update',id,patch:{name:v.name,timezone:v.timezone,preferences:{...w.preferences,density:v.density,theme:v.theme,accent:v.accent,favoriteComponents:selected('favoriteComponents'),priorityText:v.priorityText}}});}
   else if(kind==='page-new')actions.push({op:'page.create',name:v.name,workspaceId:work().id});
   else if(kind==='page-edit')actions.push({op:'page.update',id,patch:{name:v.name}});
   else if(kind==='note'){const c=state().components.find(c=>c.id===id);actions.push({op:'component.update',id,patch:{props:{...c.props,content:v.content}}});}
   else if(kind.startsWith('component-')){
    const c=state().components.find(c=>c.id===id),type=v.viewType||v.type,props={...(c?.props||{})},binding={};
    if(['list','board','calendar'].includes(type)){
     if(v.collectionId==='__new__'){actions.push(defaultCollection(v.collectionName||v.title+'记录'));binding.collectionId='$newCollection';binding.statusFieldId='$statusField';binding.dateFieldId='$dateField';props.visibleFieldIds=[];props.filter=null;props.sort=null;}
     else{
      binding.collectionId=v.collectionId;if(v.statusFieldId)binding.statusFieldId=v.statusFieldId;if(v.dateFieldId)binding.dateFieldId=v.dateFieldId;
      props.visibleFieldIds=selected('visibleFieldIds');props.filter=null;props.sort=null;
      if(v.filterFieldId){const f=cols().find(x=>x.id===v.collectionId).fields.find(f=>f.id===v.filterFieldId);let value=v.filterValue;if(f.type==='select')value=f.options.find(o=>o.label===v.filterValue||o.id===v.filterValue)?.id||v.filterValue;if(f.type==='number'&&value!=='')value=Number(value);props.filter={fieldId:v.filterFieldId,operator:v.filterOperator,value};}
      if(v.sortFieldId)props.sort={fieldId:v.sortFieldId,direction:v.sortDirection};
     }
    }else if(type==='text')props.content=v.content;else props.assetIds=selected('assetIds');
    if(c){props.collapsed=form.elements.collapsed.checked;actions.push({op:'component.update',id,patch:{title:v.title,type,...(v.pageId?{pageId:v.pageId}:{}),props,binding,layout:Object.fromEntries(['x','y','w','h'].map(k=>[k,Number(v[k])]))}});}
    else actions.push({op:'component.create',workspaceId:work().id,pageId:ctx.pageId(),type,title:v.title,props,binding});
   }else if(kind.startsWith('record-')){
    const col=state().collections.find(c=>c.id===v.collectionId),values={};
    for(const f of col.fields){const el=form.elements['value:'+f.id];let value=el?.value??'';if(f.type==='relation')value=[...el.selectedOptions].map(o=>o.value);else if(value==='')value=null;else if(f.type==='number')value=Number(value);else if(f.type==='date'&&form.elements['time:'+f.id].value)value+='T'+form.elements['time:'+f.id].value;values[f.id]=value;}
    const patch={values,assetIds:selected('assetIds')};actions.push(id?{op:'record.update',id,patch}:{op:'record.create',collectionId:col.id,...patch});
   }else if(kind.startsWith('asset-'))actions.push(id?{op:'asset.update',id,patch:{title:v.title,text:v.text,linkUrl:v.linkUrl}}:{op:'asset.create',workspaceId:work().id,title:v.title,text:v.text,linkUrl:v.linkUrl});
   else if(kind==='collection-edit'){
    const semanticBindings={};for(const key of ['title','status','dueDate','start','end'])if(v['binding:'+key])semanticBindings[key]=v['binding:'+key];if(semanticBindings.status)semanticBindings.doneOptions=selected('doneOptions');actions.push({op:'collection.update',id,patch:{name:v.name,semanticBindings}});
   }else if(kind.startsWith('field-')){
    const col=cols().find(c=>c.id===id),f=col.fields.find(f=>f.id===v.fieldId),type=f?.type||v.fieldType,newOptions=v.optionsText.split(/\r?\n/).map(s=>s.trim()).filter(Boolean).map(label=>({label}));
    if(f){const patch={name:v.name};if(type==='select')patch.options=[...f.options.map(o=>({id:o.id,label:v['option:'+o.id]})),...newOptions];actions.push({op:'collection.field.update',id,fieldId:f.id,patch});}
    else{const field={name:v.name,type};if(type==='select')field.options=newOptions;if(type==='relation')field.targetCollectionId=v.targetCollectionId;actions.push({op:'collection.field.add',id,field});}
   }
   const button=form.querySelector('[type=submit]');button.disabled=true;button.textContent='正在保存…';
   if(kind==='workspace-create'&&v.template!=='blank'){await ctx.preview(actions,{baseRevision:Number(form.dataset.revision)});return;}
   const result=await ctx.run(actions,{baseRevision:Number(form.dataset.revision),success:'已保存。'});dialog.close();if(kind==='workspace-create')ctx.openWorkspace(result.state.workspaces.at(-1)?.id);if(kind==='page-new')ctx.openPage(result.state.workspaces.find(w=>w.id===work()?.id)?.pages.at(-1)?.id);
  }catch(e){const error=form.querySelector('.form-error');if(error)error.textContent=e.message;const button=form.querySelector('[type=submit]');if(button){button.disabled=false;button.textContent='重新保存';}if(['revision_conflict','stale_revision','stale_proposal'].includes(e.code)){if(button)button.disabled=true;error.textContent+=' 请保留需要的输入，关闭后重新打开最新内容。';}}
 }
 document.addEventListener('submit',e=>{if(!e.target.dataset.cuForm)return;e.preventDefault();submit(e.target);});
 dialog.addEventListener('change',e=>{
  const form=e.target.form;if(!form?.dataset.cuForm)return;
  if(e.target.name==='template'){form.querySelector('[type=submit]').textContent=e.target.value==='blank'?'创建空白空间':'预览并核对';if(e.target.value==='office'&&!form.elements.name.value.trim())form.elements.name.value='普通上班族 · 示例工作台';}
  if(e.target.name==='collectionId')updateBindingInputs(form,e.target.value);
  if(e.target.name==='fieldType'){form.querySelector('.select-field-settings').hidden=e.target.value!=='select';form.querySelector('.relation-field-settings').hidden=e.target.value!=='relation';}
  if(e.target.name==='binding:status'){const col=cols().find(c=>c.id===form.dataset.id),f=col.fields.find(f=>f.id===e.target.value);form.elements.doneOptions.innerHTML=(f?.options||[]).map(o=>option(o.id,o.label,false)).join('');}
 });
 document.addEventListener('click',async e=>{
  const b=e.target.closest('[data-form-command]');if(!b)return;e.preventDefault();const action=b.dataset.formCommand;
  if(action==='component-new')componentEditor('',b.dataset.type);
  if(action==='field-new')fieldEditor(b.dataset.id);
  if(action==='field-edit')fieldEditor(b.dataset.id,b.dataset.field);
  if(action==='preferences-reset'){try{b.disabled=true;await ctx.run([{op:'workspace.update',id:b.dataset.id,patch:{preferences:{density:'comfortable',theme:'light',accent:'#8b74bd',favoriteComponents:[],priorityText:''}}}],{baseRevision:Number(b.closest('form').dataset.revision),success:'已恢复默认偏好。'});workspaceEdit();}catch(error){toast(error.message,true);b.disabled=false;}}
  if(action==='archive'){try{b.disabled=true;await ctx.run([{op:b.dataset.op,id:b.dataset.id,archived:b.dataset.archived==='true'}],{baseRevision:state().revision,success:b.dataset.archived==='true'?'已归档。':'已恢复。'});dialog.close();}catch(error){toast(error.message,true);b.disabled=false;}}
 });
 return {workspaceCreate,workspaceEdit,pageEditor,moduleLibrary,componentEditor,noteEditor,recordEditor,assetEditor,collectionEditor,archives};
}

