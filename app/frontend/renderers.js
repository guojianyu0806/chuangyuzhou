
export function getTodayRecords(state,workspaceId,today){
 const collections=state.collections.filter(c=>c.workspaceId===workspaceId);
 return state.records.filter(record=>{const collection=collections.find(c=>c.id===record.collectionId);if(!collection||record.archived)return false;const binding=collection.semanticBindings||{};return !!binding.status&&!!binding.doneOptions?.length&&!binding.doneOptions.includes(record.values[binding.status])&&[binding.dueDate,binding.start].some(field=>field&&String(record.values[field]||'').slice(0,10)===today);});
}
export function createRenderers(ctx){
 const {esc,icon}=ctx,arr=v=>Array.isArray(v)?v:[];
 const collection=c=>ctx.state().collections.find(x=>x.id===c.binding?.collectionId);
 const label=(record,col)=>String(record.values[col?.semanticBindings?.title]??Object.values(record.values).find(v=>typeof v==='string')??'未命名记录');
 const valueText=(value,field)=>{
  if(value==null||value==='')return '—';
  if(field.type==='select')return field.options?.find(o=>o.id===value)?.label||'未设置';
  if(field.type==='relation')return arr(value).map(id=>{const r=ctx.state().records.find(r=>r.id===id);return r?label(r,ctx.state().collections.find(c=>c.id===r.collectionId)):'关联已不可见';}).join('、')||'—';
  return String(value);
 };
 function records(c,col){
  let rows=ctx.state().records.filter(r=>r.collectionId===col.id&&!r.archived);
  const f=c.props?.filter;if(f){const field=col.fields.find(field=>field.id===f.fieldId);rows=rows.filter(r=>{const v=r.values[f.fieldId];if(f.operator==='eq')return JSON.stringify(v)===JSON.stringify(f.value);if(f.operator==='contains')return String(v??'').includes(String(f.value));if(v===null||v===undefined||v==='')return false;const left=field?.type==='number'?Number(v):String(v),right=field?.type==='number'?Number(f.value):String(f.value);return f.operator==='before'?left<right:left>right;});}
  const sort=c.props?.sort;if(sort){const field=col.fields.find(field=>field.id===sort.fieldId),missing=v=>v===null||v===undefined||v==='';rows.sort((a,b)=>{const av=a.values[sort.fieldId],bv=b.values[sort.fieldId];if(missing(av)||missing(bv))return missing(av)&&missing(bv)?0:missing(av)?1:-1;const compare=field?.type==='number'?Number(av)-Number(bv):field?.type==='select'?field.options.findIndex(o=>o.id===av)-field.options.findIndex(o=>o.id===bv):String(av).localeCompare(String(bv),'zh-CN');return compare*(sort.direction==='desc'?-1:1);});}
  return rows;
 }
 function empty(title,caption,action,id){return `<div class="module-empty"><span>${icon('spark')}</span><strong>${title}</strong><p>${caption}</p>${action?`<button class="text-button" data-action="${action}" data-id="${esc(id)}">${icon('plus')}开始添加</button>`:''}</div>`;}
 function body(c){
  if(c.props?.collapsed)return '<div class="collapsed-note">模块已折叠</div>';
  if(c.type==='text')return `<button class="note-content" data-action="note-edit" data-id="${esc(c.id)}">${c.props?.content?esc(c.props.content):'<span class="note-placeholder">写下一段想法、一个目标，或今天的开始。<small>点击编写笔记</small></span>'}</button>`;
  if(c.type==='resources'){
   const assets=ctx.state().assets.filter(a=>a.workspaceId===c.workspaceId&&!a.archived&&(!c.props?.assetIds?.length||c.props.assetIds.includes(a.id)));
   return `<div class="resource-list">${assets.map(a=>`<button class="resource-item" data-action="asset-edit" data-id="${esc(a.id)}"><span class="resource-icon">${icon(a.linkUrl?'link':'file')}</span><span><strong>${esc(a.title)}</strong><small>${esc(a.linkUrl||a.text?.slice(0,60)||'文字资料')}</small></span>${icon('chevron')}</button>`).join('')||empty('把线索放在手边','保存文字与链接，让记录有处可寻。','asset-new',c.id)}</div>`;
  }
  const col=collection(c);if(!col)return empty('给这个视图选择记录','在模块设置中连接一组记录，列表、看板和日历就能一起更新。','component-edit',c.id);
  const rows=records(c,col);
  if(c.type==='list')return listView(c,col,rows);
  if(c.type==='board')return boardView(c,col,rows);
  return calendarView(c,col,rows);
 }
 function listView(c,col,rows){
  const fields=col.fields.filter(f=>!c.props?.visibleFieldIds?.length||c.props.visibleFieldIds.includes(f.id));
  return `<div class="data-scroll"><table class="record-table" style="min-width:${fields.length*110}px"><thead><tr>${fields.map(f=>`<th>${esc(f.name)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${fields.map((f,i)=>`<td><button data-action="record-edit" data-id="${esc(r.id)}" class="record-cell ${f.type==='select'?'select-cell':''}">${f.type==='select'?`<span class="value-tag">${esc(valueText(r.values[f.id],f))}</span>`:esc(valueText(r.values[f.id],f))}</button></td>`).join('')}</tr>`).join('')}</tbody></table></div>${!rows.length?empty('第一条记录，从这里开始','这些记录可以同时显示在看板和日历中。','record-new',c.id):''}`;
 }
 function boardView(c,col,rows){
  const field=col.fields.find(f=>f.id===(c.binding?.statusFieldId||col.semanticBindings?.status)&&f.type==='select');
  if(!field)return empty('选择一个分组字段','看板需要一个单选字段来划分列。','component-edit',c.id);
  const options=[...(field.options||[])];if(rows.some(r=>!r.values[field.id]))options.push({id:'',label:'未分组'});
  return `<div class="kanban">${options.map((o,i)=>{const items=rows.filter(r=>(r.values[field.id]||'')===o.id);return `<section class="kanban-column tone-${i%4}" data-drop-record="${esc(o.id)}" data-field="${esc(field.id)}" data-collection="${esc(col.id)}"><header><i></i><strong>${esc(o.label)}</strong><span>${items.length}</span></header><div>${items.map(r=>`<button class="board-record" draggable="${!ctx.preview()}" data-drag-record="${esc(r.id)}" data-collection="${esc(col.id)}" data-action="record-edit" data-id="${esc(r.id)}"><span>${esc(label(r,col))}</span>${col.semanticBindings?.dueDate&&r.values[col.semanticBindings.dueDate]?`<small>${icon('calendar')}${esc(r.values[col.semanticBindings.dueDate])}</small>`:''}</button>`).join('')||'<div class="column-empty">拖入记录，或添加一件事</div>'}</div></section>`;}).join('')}</div>`;
 }
 function calendarView(c,col,rows){
  const field=col.fields.find(f=>f.id===(c.binding?.dateFieldId||col.semanticBindings?.dueDate||col.semanticBindings?.start)&&f.type==='date');
  if(!field)return empty('选择一个日期字段','日历按记录中的日期展示内容，不会复制记录。','component-edit',c.id);
  const month=ctx.month(c.id),[y,m]=month.split('-').map(Number),offset=(new Date(y,m-1,1).getDay()+6)%7;
  const cells=Array.from({length:42},(_,i)=>{const d=new Date(y,m-1,i-offset+1),day=[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');const items=rows.filter(r=>String(r.values[field.id]||'').slice(0,10)===day);return `<div class="mini-day ${d.getMonth()!==m-1?'outside':''}"><span>${d.getDate()}</span>${items.map(r=>`<button data-action="record-edit" data-id="${esc(r.id)}" title="${esc(label(r,col))}">${esc(label(r,col))}</button>`).join('')}</div>`;}).join('');
  const undated=rows.filter(r=>!r.values[field.id]).length;
  return `<div class="module-calendar-toolbar"><span>${y} 年 ${m} 月</span><div><button class="icon-button" data-action="calendar-month" data-id="${esc(c.id)}" data-offset="-1" aria-label="上个月">${icon('chevron','reverse')}</button><button class="icon-button" data-action="calendar-month" data-id="${esc(c.id)}" data-offset="1" aria-label="下个月">${icon('chevron')}</button></div></div><div class="mini-week">${['一','二','三','四','五','六','日'].map(d=>'<span>'+d+'</span>').join('')}</div><div class="mini-calendar">${cells}</div>${undated?`<p class="undated-note">${undated} 条记录尚未填写日期，可在列表中补充。</p>`:''}`;
 }
 return {body,label,valueText,records};
}

