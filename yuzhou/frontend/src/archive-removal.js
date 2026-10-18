import {escapeHTML as esc} from './services.js';

/** Explicit selections only. Read-only plan includes every descendant and owned record. */
export function planArchivedRemoval(state,{spaceIds=[],eventIds=[]}={}){
  const roots=[...new Set(spaceIds)],events=[...new Set(eventIds)];
  if(!roots.length&&!events.length)throw Error('请先选择要删除的内容。');
  for(const id of roots)if(!state.spaces?.some(s=>s.id===id&&s.archived))throw Error('只能清理仍处于归档状态的空间，请重新核对。');
  for(const id of events)if(!state.calendar?.events?.some(e=>e.id===id))throw Error('所选日程已变化，请重新核对。');
  const ids=new Set(roots);let grew=true;
  while(grew){grew=false;for(const s of state.spaces||[])if(ids.has(s.parentId)&&!ids.has(s.id)){ids.add(s.id);grew=true;}}
  const spaces=(state.spaces||[]).filter(s=>ids.has(s.id)),blocks=(state.customBlocks?.items||[]).filter(b=>ids.has(b.spaceId));
  // Files can be shared. This cleanup never deletes attachment metadata or bytes.
  if(spaces.some(s=>s.files?.length)||blocks.some(b=>b.files?.length))throw Error('所选空间含附件，请先单独处理文件后再清理。');
  const tasks=(state.tasks||[]).filter(t=>ids.has(t.spaceId)),blockIds=new Set(blocks.map(b=>b.id));
  const cards=new Set([...ids,...[...ids].map(id=>'space:'+id),...blockIds,...[...blockIds].map(id=>'block:'+id)]);
  const next=structuredClone(state);
  next.spaces=next.spaces.filter(s=>!ids.has(s.id));
  if(next.tasks)next.tasks=next.tasks.filter(t=>!ids.has(t.spaceId));
  if(next.customBlocks)next.customBlocks.items=next.customBlocks.items.filter(b=>!blockIds.has(b.id));
  if(next.fitness)next.fitness.entries=next.fitness.entries.filter(e=>!ids.has(e.spaceId));
  if(next.calendar)next.calendar.events=next.calendar.events.filter(e=>!events.includes(e.id));
  const trim=layout=>{if(layout?.cards)layout.cards=layout.cards.filter(card=>!cards.has(card.id));};
  trim(next.canvas);
  for(const key of Object.keys(next.boards||{})){
    if([...ids].some(id=>key.startsWith('space:'+id+':')))delete next.boards[key];else trim(next.boards[key]);
  }
  if(next.workbench?.navigation)next.workbench.navigation.items=next.workbench.navigation.items.filter(item=>!cards.has(item.id));
  if(next.aiDraft?.targetId?.startsWith('space:')&&ids.has(next.aiDraft.targetId.slice(6)))next.aiDraft.targetId='auto';
  return {snapshot:JSON.stringify(state),next,spaceIds:roots,eventIds:events,spaces:spaces.map(({id,title})=>({id,title})),counts:{spaces:spaces.length,notes:spaces.reduce((n,s)=>n+(s.notes?.length||0),0),tasks:tasks.length,blocks:blocks.length,events:events.length}};
}

export async function applyArchivedRemoval(ctx,plan){
  if(ctx.isCurrent?.()===false||JSON.stringify(ctx.state)!==plan.snapshot)throw Error('工作台内容已更新，请关闭后重新核对删除范围。');
  const fresh=planArchivedRemoval(ctx.state,{spaceIds:plan.spaceIds,eventIds:plan.eventIds}),before=structuredClone(ctx.state);
  // Recompute instead of trusting a caller-provided next-state object.
  const replace=value=>{for(const key of Object.keys(ctx.state))delete ctx.state[key];Object.assign(ctx.state,value);};
  try{replace(fresh.next);await ctx.save();return fresh.counts;}catch(error){replace(before);throw error;}
}

export function openArchivedRemoval(ctx){
  const before=structuredClone(ctx.state),spaces=(before.spaces||[]).filter(s=>s.archived),events=before.calendar?.events||[];
  const choices=spaces.map(s=>{try{const p=planArchivedRemoval(before,{spaceIds:[s.id]});return `<label class="archive-removal-choice"><input type="checkbox" name="removeSpace" value="${esc(s.id)}"><span><strong>${esc(s.title)}</strong><small>${p.counts.spaces} 个空间 · ${p.counts.notes} 篇笔记 · ${p.counts.tasks} 条待办 · ${p.counts.blocks} 个方块</small></span></label>`;}catch(error){return `<p>${esc(s.title)}：${esc(error.message)}</p>`;}}).join('');
  ctx.modal({title:'清理已归档空间',submitLabel:'永久删除所选内容',body:`<p>先导出完整备份。删除后不能从归档中恢复；附属笔记、待办、方块、下级空间和画布入口会一同删除。有附件的空间需先单独处理文件。AI历史记录保留；独立日程只有勾选后才删除。</p><fieldset><legend>已归档空间</legend>${choices||'<p>没有已归档空间。</p>'}</fieldset><details><summary>独立日程（可选，不会自动勾选）</summary>${events.map(e=>`<label class="archive-removal-choice"><input type="checkbox" name="removeEvent" value="${esc(e.id)}"><span>${esc(e.title)}<small>${esc(e.startDate)}</small></span></label>`).join('')}</details><label class="archive-removal-choice"><input type="checkbox" name="confirmed" required><strong>我已核对所选内容并保存备份，确认永久删除</strong></label>`,async onSubmit(form){
    if(!form.has('confirmed'))throw Error('请先核对并确认删除。');
    const plan=planArchivedRemoval(before,{spaceIds:form.getAll('removeSpace'),eventIds:form.getAll('removeEvent')});
    await applyArchivedRemoval(ctx,plan);ctx.refresh?.();ctx.toast('所选归档内容已删除。');
  }});
}
