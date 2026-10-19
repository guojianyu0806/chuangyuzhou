// Shared by the private-cloud worker and browser. Only these records can be
// created by an AI proposal; model output never becomes executable code.
import {assignRecordColor} from './creation-colors.js';
export function validateOrganizedProposal(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('AI 整理结果格式不正确。');
  const string = (v, max, required = false) => {
    if (typeof v !== 'string' || v.length > max || (required && !v.trim())) throw new Error('AI 整理结果包含无效文字。');
    return v.trim();
  };
  const destinationId = string(value.destinationId, 256, true);
  if (!['english', 'inbox', 'tasks'].includes(destinationId) && !/^(space|course):[^\s]+$/.test(destinationId)) throw new Error('AI 返回了无效的工作区。');
  if (!Array.isArray(value.notes) || value.notes.length > 30 || !Array.isArray(value.tasks) || value.tasks.length > 50) throw new Error('AI 整理条目数量无效。');
  const notes = value.notes.map(n => ({
    title: string(n.title, 240, true), content: string(n.content, 120000, true),
    sourceIds: Array.isArray(n.sourceIds) && n.sourceIds.length <= 40 ? n.sourceIds.map(id => string(id, 128, true)) : [],
  }));
  const tasks = value.tasks.map(t => {
    const date = string(t.date ?? '', 10);
    if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) throw new Error('AI 返回了无效日期。');
    return { title: string(t.title, 240, true), description: string(t.description ?? '', 12000), date, priority: t.priority === 'high' ? 'high' : 'normal' };
  });
  const warnings = Array.isArray(value.warnings) && value.warnings.length <= 30 ? value.warnings.map(w => string(w, 2000)) : [];
  return {title: string(value.title, 240, true), summary: string(value.summary ?? '', 30000), destinationId, notes, tasks, reason: string(value.reason ?? '', 5000), warnings};
}

export function applyOrganizedContent(state, requestId, input, {uid = () => crypto.randomUUID(), now = new Date().toISOString()} = {}) {
  const request = state.aiRequests?.find(r => r.id === requestId);
  if (!request) throw new Error('原始收件记录已不存在。');
  if (request.status === 'filed' && request.receipt) return request.receipt;
  if (request.status !== 'waiting_model') throw new Error('这份请求已经取消，整理结果尚未归档。');
  const proposal = validateOrganizedProposal(input);
  const target = proposal.destinationId;
  const isSpace = target.startsWith('space:');
  const isCourse = target.startsWith('course:');
  const container = isSpace ? state.spaces?.find(s => s.id === target.slice(6) && !s.archived)
    : isCourse ? state.courses?.find(s => s.id === target.slice(7) && !s.archived) : null;
  if ((isSpace || isCourse) && !container) throw new Error('目标工作区已归档或不存在，请重新选择。');
  if (request.targetId !== 'auto' && request.targetId !== target) throw new Error('AI 返回的归属与指定工作区不一致。');
  const files = request.files || [];
  const sourceNames = new Map(files.flatMap(f => [[f.blobId, f.name], [f.id, f.name]]));
  sourceNames.set('input', '用户原文');
  for (const note of proposal.notes) {
    if (note.sourceIds.some(id => !sourceNames.has(id))) throw new Error('AI 引用了一份不存在的原文件，结果已保留供检查。');
  }
  const title = container?.title || {english: '六级资料', inbox: '收集箱', tasks: '备忘与待办'}[target];
  const receipt = {destinationId: target, destinationLabel: title, createdAt: now, engine: 'hermes', items: []};
  const pending = [];
  const add = (collection, containerId, item) => {
    pending.push({collection, containerId, item});
    receipt.items.push({id: item.id, type: {notes:'AI 笔记', files:'原文件', tasks:'待办', captures:'整理记录'}[collection],
      title: item.title || item.name || item.text?.slice(0, 60) || '记录', collection, containerId});
  };
  const notes = proposal.notes.length ? proposal.notes : proposal.summary ? [{title: proposal.title, content: proposal.summary, sourceIds: []}] : [];
  for (const note of notes) {
    const sources = [...new Set(note.sourceIds.map(id => sourceNames.get(id)))];
    const source = `Hermes · DeepSeek 整理${sources.length ? ' · ' + sources.join('、') : ' · 原文见 AI 收件记录'}`;
    if (container) add('notes', target, {id:uid(), title:note.title, content:note.content, source, sourceRequestId:requestId, updatedAt:now, example:false, revisions:[]});
    else add('captures', 'inbox', {id:uid(), text:`${note.title}\n\n${note.content}`, category:target==='english'?'英语':'备忘', tags:target==='english'?'六级资料':'AI 整理', source, sourceRequestId:requestId, archived:false, createdAt:now});
  }
  for (const file of files) {
    if (container) add('files', target, {...file, id:uid(), sourceRequestId:requestId, createdAt:now});
    else add('captures', 'inbox', {id:uid(), text:file.name, blobId:file.blobId, fileName:file.name, fileType:file.type, category:target==='english'?'英语':'备忘', tags:target==='english'?'六级资料':'AI 原文件', sourceRequestId:requestId, archived:false, createdAt:now});
  }
  for (const task of proposal.tasks) add('tasks', 'tasks', {id:uid(), title:task.title, description:task.description, date:task.date, priority:task.priority,
    category:isCourse?'课程':target==='english'?'英语':isSpace?container.title:'个人', done:false, archived:false,
    source:`AI 整理 · ${title}`, sourceRequestId:requestId, ...(isSpace?{spaceId:container.id}:{}), createdAt:now});
  if (!pending.length) throw new Error('AI 没有返回可以归档的内容。');
  // Validation finishes before modifying the workspace. The caller commits the
  // entire workspace and receipt in one revision-checked transaction.
  for (const [index, {collection, containerId, item}] of pending.entries()) {
    item.color = assignRecordColor(state);
    receipt.items[index].snapshot = JSON.stringify(item);
    const owner = containerId === target && container && ['notes','files'].includes(collection) ? container : state;
    owner[collection] ||= [];
    owner[collection].unshift(item);
  }
  if (container) container.updatedAt = now;
  Object.assign(request, {status:'filed', aiStatus:'succeeded', aiProposal:proposal, receipt, updatedAt:now});
  delete request.aiError;
  state.updatedAt = now;
  return receipt;
}

// Use the same bounded writer on an isolated copy so review includes every
// actual operation, including summary fallback, attachments and task routing.
export function previewOrganizedContent(state,requestId,input){
  const copy=structuredClone(state);let sequence=0;
  const receipt=applyOrganizedContent(copy,requestId,input,{uid:()=>`review-${++sequence}`});
  return receipt.items.map(item=>{
    const record=JSON.parse(item.snapshot);
    const container=item.containerId.startsWith('space:')?state.spaces?.find(s=>s.id===item.containerId.slice(6)):item.containerId.startsWith('course:')?state.courses?.find(c=>c.id===item.containerId.slice(7)):null;
    const destination=container?.title||(item.collection==='tasks'?'备忘与待办':record.category==='英语'?'收集箱 · 六级资料':'收集箱');
    return {type:item.collection==='files'||record.blobId?'保存原文件':item.collection==='tasks'?'新增待办':item.collection==='notes'?'新增笔记':'新增整理记录',title:item.title,destination,content:record.content||record.text||record.description||'',date:record.date||'',priority:item.collection==='tasks'?(record.priority==='high'?'重要':'普通'):'',fileName:record.name||record.fileName||''};
  });
}
