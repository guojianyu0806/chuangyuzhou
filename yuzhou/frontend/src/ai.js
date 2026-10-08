import {ensureConversation,validateConversation} from './ai-conversation-model.js';
import {mountConversationPage} from './ai-chat.js';
// The composer is a real local inbox. AI execution starts only after a backend is connected.
import {cloudAIEnabled, jobFor, jobWorking, startAIJob} from './ai-cloud.js';
const activityByState = new WeakMap();
const stamp = () => new Date().toISOString();
const sizeLabel = n => n < 1048576 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`;

function ensure(state) {
  state.aiRequests ||= [];
  state.aiDraft ||= { text: '', files: [], targetId: 'auto' };
  state.aiDraft.files ||= [];
  if (!activityByState.has(state)) activityByState.set(state, { uploading: 0, listeners: new Set() });
  return activityByState.get(state);
}

function destinations(state) {
  return [
    { id: 'auto', title: '由 AI 判断归属', group: '自动整理' },
    { id: 'workspace', title: '整个工作台 · 跨板块行动', group: '自动整理' },
    ...(state.spaces || []).filter(s => !s.archived).map(s => ({ id: `space:${s.id}`, title: s.title, group: '我的工作区' })),
    ...(state.courses || []).filter(s => !s.archived).map(s => ({ id: `course:${s.id}`, title: s.title, group: '课程空间' })),
    { id: 'ledger', title: '记账 · 日常零钱', matchTitle: '日常零钱', group: '记账项目' },
    ...(state.ledger?.projects || []).filter(p => !p.archived).map(p => ({ id: `ledger:${p.id}`, title: `记账 · ${p.title}`, matchTitle: p.title, group: '记账项目' })),
    { id: 'english', title: '六级空间', group: '常用空间' },
    { id: 'calendar', title: '日历安排', group: '常用空间' },
    { id: 'timetable', title: '学期课表', group: '常用空间' },
    { id: 'inbox', title: '收集箱', group: '常用空间' },
    { id: 'tasks', title: '备忘与待办', group: '常用空间' }
  ];
}

/** Prepare an editable, unsent conversation without replacing another draft. */
export function openAIConversation(ctx,{targetId='auto',text='',files=[]}={}){
  ensure(ctx.state);
  const previous=ctx.state.aiDraft, previousUpdatedAt=ctx.state.updatedAt;
  if(previous.text?.trim()||previous.files?.length){
    try{sessionStorage.removeItem('yuzhou-active-ai-'+ctx.state.mode);}catch{}
    ctx.toast('已保留你尚未发送的草稿，请先处理草稿，再加入这次内容。');
    ctx.go('ai',previous.targetId||'auto');return false;
  }
  if(files.length>12)throw new Error('每段对话最多携带 12 个附件，请分批选择。');
  if(text.length>30000)throw new Error('本次文字较长，请分段发送。');
  ctx.state.aiDraft={text,files:files.map(file=>({id:file.id,blobId:file.blobId||file.id,name:file.name,size:file.size||0,type:file.type||'',createdAt:file.createdAt||stamp()})),targetId};
  try{ctx.save(ctx.state);}catch(error){ctx.state.aiDraft=previous;ctx.state.updatedAt=previousUpdatedAt;throw error;}
  try{sessionStorage.removeItem('yuzhou-active-ai-'+ctx.state.mode);}catch{}
  ctx.go('ai',targetId);return true;
}

function destinationLabel(state, id) {
  return destinations(state).find(s => s.id === id)?.title || '原工作区已归档或不存在';
}

function options(ctx, selected = 'auto') {
  const { esc } = ctx;
  const list = destinations(ctx.state);
  let previousGroup = '';
  let result = '';
  for (const item of list) {
    if (item.group !== previousGroup) {
      if (previousGroup) result += '</optgroup>';
      result += `<optgroup label="${esc(item.group)}">`;
      previousGroup = item.group;
    }
    result += `<option value="${esc(item.id)}" ${selected === item.id ? 'selected' : ''}>${esc(item.title)}</option>`;
  }
  if (previousGroup) result += '</optgroup>';
  if (!list.some(d => d.id === selected)) result += `<option value="${esc(selected)}" selected disabled>原工作区已归档，请重新选择</option>`;
  return result;
}

function emit(state) { activityByState.get(state)?.listeners.forEach(fn => fn()); }

async function saveAttachments(ctx, files, owner=ctx.state, saveDraft=()=>ctx.save(ctx.state)) {
  const { state, uid, putFile, save, toast } = ctx;
  const activity = ensure(state);
  const selected = Array.from(files || []);
  if (!selected.length) return;
  activity.uploading++;
  emit(state);
  let count = 0;
  try {
    for (const file of selected) {
      if (file.size > 40 * 1024 * 1024) { toast(`${file.name} 超过 40 MB，未保存。`); continue; }
      try {
        const blobId = await putFile(file);
        const record = { id: uid(), blobId, name: file.name, size: file.size, type: file.type, createdAt: stamp() };
        owner.aiDraft.files.push(record);
        try { saveDraft(); } catch (error) { owner.aiDraft.files.splice(owner.aiDraft.files.indexOf(record), 1); throw error; }
        count++;
        emit(state);
      } catch (error) { toast(`${file.name}：${error.message || '保存失败，请重试。'}`); }
    }
  } finally {
    activity.uploading--;
    emit(state);
    if (count) toast(`${count} 个附件已保存到草稿${cloudAIEnabled(ctx) ? '，正在同步到云端' : ''}。`);
  }
}

async function downloadAttachment(ctx, file) {
  try {
    const data = await ctx.getFile(file.blobId || file.id);
    if (!data) return ctx.toast('没有找到这份原文件，请重新添加文件。');
    ctx.download(data, file.name);
  } catch (error) { ctx.toast(error.message || '文件读取失败，请重试。'); }
}

function matchedDestinations(state, text) {
  if (!text.trim()) return [];
  return destinations(state).filter(d => {const title=d.matchTitle||d.title;return d.id !== 'auto' && title.length >= 2 && text.toLowerCase().includes(title.toLowerCase());}).slice(0, 3);
}

/** Mount a standalone composer inside a canvas card, or inside the AI page. */
export function mountAIComposer(ctx, host, settings={}) {
  const { state, esc, icon, save, uid, toast, go } = ctx;
  const activity = ensure(state),followRequest=settings.request;
  const draftKey=ctx.cloud?.draftKey(`conversation-${followRequest?.id}`)||`yuzhou-conversation-${state.mode}-${followRequest?.id}`;
  const owner=followRequest?{aiDraft:{text:'',files:[],targetId:followRequest.targetId}}:state;
  if(followRequest)try{const cached=JSON.parse(localStorage.getItem(draftKey));if(cached&&typeof cached.text==='string'&&Array.isArray(cached.files))owner.aiDraft=cached;}catch{}
  const saveDraft=()=>{if(followRequest)localStorage.setItem(draftKey,JSON.stringify(owner.aiDraft));else save(state);};
  let alive = true;
  let dragDepth = 0;
  let sending = false;
  const localSave = () => { try { saveDraft(); return true; } catch (error) { toast(error.message || '草稿保存失败，请先复制内容。'); return false; } };
  host.classList.add('ai-composer-host');
  host.toggleAttribute('data-local-ai-draft',!!followRequest);
  host.innerHTML = `<form class="ai-composer" aria-label="AI 收件台">
    <span class="ai-card-label ai-compose-card-label">01 / 内容入口</span><div class="ai-compose-intro"><span class="ai-orb">${icon('sparkles', 23)}</span><div><span class="ai-eyebrow">YOUR PERSONAL ORGANIZER</span><h2>${followRequest?'继续聊这件事':'开始一段新对话'}</h2></div><span class="ai-local-status"><i></i>待连接</span></div>
    <p class="ai-compose-hint">课件、会议记录、突然冒出的想法，都可以放在这里。</p>
    <label class="ai-input-label" for="ai-instruction">消息</label>
    <textarea id="ai-instruction" name="instruction" maxlength="30000" placeholder="例如：这是迎新活动的会议记录，放进学生会，帮我整理分工和待办…" rows="4">${esc(owner.aiDraft.text)}</textarea>
    <div class="ai-match-hints" aria-live="polite"></div>
    <div class="ai-drop-target"><span>${icon('upload', 18)} 拖入文件、截图或课件</span><button type="button" class="ai-attach-button" data-ai="attach">选择附件 ${icon('plus', 15)}</button><input type="file" multiple hidden data-ai-files><small>每个文件最多 40 MB · 仅保存到当前浏览器</small></div>
    <div class="ai-attachment-chips" aria-live="polite"></div>
    <div class="ai-compose-footer"><label class="ai-destination"><span>放到</span><select name="destination" aria-label="内容归属">${options(ctx, owner.aiDraft.targetId)}</select></label><button class="btn ai-send" type="submit">${icon('sparkles', 17)}${followRequest?'发送补充':'发送'} ${icon('arrow-right', 16)}</button></div>
    <div class="ai-compose-note">${icon('shield', 13)} 先收好原文与附件，连接大模型后才能自动理解和整理。</div>
    <div class="ai-compose-live" role="status" aria-live="polite"></div>
  </form>`;
  const form = host.querySelector('form');
  const textarea = form.querySelector('textarea');
  const select = form.querySelector('select');
  const input = form.querySelector('input[type=file]');
  const sendButton = form.querySelector('[type=submit]');
  const refresh = () => {
    if (!alive) return;
    const draft = owner.aiDraft;
    if (cloudAIEnabled(ctx)) {
      form.querySelector('.ai-local-status').innerHTML = `<i></i>${ctx.cloud.modelStatus?.configured ? 'DeepSeek 已接入' : '云端已连接'}`;
      form.querySelector('.ai-drop-target small').textContent = '每个文件最多 40 MB · 登录后自动同步';
      form.querySelector('.ai-compose-note').textContent = '发送只用于对话。审核行动方案并点击「确认执行」后，才会改动工作区。';
    }
    const chips = form.querySelector('.ai-attachment-chips');
    chips.innerHTML = draft.files.map(f => `<span class="ai-attachment-chip" title="${esc(f.name)}">${icon('file', 14)}<span>${esc(f.name)}</span><small>${sizeLabel(f.size)}</small><button type="button" data-ai="remove-attachment" data-id="${esc(f.id)}" aria-label="移除附件 ${esc(f.name)}">${icon('close', 13)}</button></span>`).join('');
    form.querySelector('.ai-compose-live').textContent = activity.uploading ? '正在保存附件，请稍候…' : '';
    sendButton.disabled = !!activity.uploading || sending;
    const matches = matchedDestinations(state, draft.text || '');
    form.querySelector('.ai-match-hints').innerHTML = draft.targetId === 'auto' && matches.length ? `<span>本地名称匹配</span>${matches.map(d => `<button type="button" data-ai="match" data-id="${esc(d.id)}">${esc(d.title)} ${icon('arrow-right', 12)}</button>`).join('')}` : '';
  };
  activity.listeners.add(refresh);
  refresh();
  const onInput = event => {
    if (event.target === textarea) { owner.aiDraft.text = textarea.value; localSave(); refresh(); }
  };
  const onChange = event => {
    if (event.target === select) { owner.aiDraft.targetId = select.value; localSave(); refresh(); }
    if (event.target === input) { const files = Array.from(input.files); input.value = ''; saveAttachments(ctx, files, owner, saveDraft); }
  };
  const onClick = event => {
    const button = event.target.closest('[data-ai]');
    if (!button) return;
    if (button.dataset.ai === 'attach') input.click();
    if (button.dataset.ai === 'remove-attachment') {
      const oldFiles = owner.aiDraft.files;
      owner.aiDraft.files = oldFiles.filter(f => f.id !== button.dataset.id);
      if (!localSave()) owner.aiDraft.files = oldFiles;
      refresh();
    }
    if (button.dataset.ai === 'match') { owner.aiDraft.targetId = button.dataset.id; select.value = button.dataset.id; localSave(); refresh(); }
  };
  const onSubmit = event => {
    event.preventDefault();
    if (activity.uploading || sending) return;
    const draft = owner.aiDraft;
    if (!draft.text.trim() && !draft.files.length) { toast('写下一句话，或添加一份文件再交给 AI。'); textarea.focus(); return; }
    if (!destinations(state).some(d => d.id === draft.targetId)) { toast('原工作区已归档，请重新选择归属。'); select.focus(); return; }
    sending = true;
    refresh();
    const previous=followRequest?structuredClone(followRequest):null;
    const request = followRequest || { id: uid(), text: draft.text.trim(), originalText: draft.text.trim(), files: [], targetId: draft.targetId, status: 'waiting_model', createdAt: stamp(), updatedAt: stamp() };
    try{
      if(followRequest){
        if(request.status!=='waiting_model'||jobWorking(jobFor(state,request.id)))throw new Error('请等这一轮回复完成后再发送。');
        ensureConversation(request,uid).messages.push({id:uid(),role:'user',text:draft.text.trim()||'我补充了附件，请结合前文继续。',createdAt:stamp()});
      }else ensureConversation(request,uid);
      request.targetId=draft.targetId;request.updatedAt=stamp();
      request.files=[...(request.files||[]),...draft.files].filter((f,i,all)=>all.findIndex(x=>x.blobId===f.blobId)===i);
      if(request.files.length>12)throw new Error('每段对话最多 12 个附件，请另开对话。');
      delete request.conversation.proposal;delete request.conversation.pendingJobId;
      validateConversation(request.conversation);
      if(!followRequest)state.aiRequests.unshift(request);
      owner.aiDraft={text:'',files:[],targetId:followRequest?request.targetId:'auto'};
      save(state);if(followRequest)localStorage.removeItem(draftKey);
    }catch(error){
      if(previous){for(const key of Object.keys(request))delete request[key];Object.assign(request,previous);}
      else state.aiRequests=state.aiRequests.filter(r=>r!==request);
      owner.aiDraft=draft;sending=false;refresh();toast(error.message||'消息尚未保存，请重试。');return;
    }
    textarea.value = '';
    select.value = owner.aiDraft.targetId;
    sending = false;
    emit(state);
    if (cloudAIEnabled(ctx)) {
      toast('消息已发送，AI 正在结合前文回复。');
      startAIJob(ctx, request).catch(error => toast(error.message));
    } else toast('已收到，原文和附件已保存。连接 AI 后才能自动整理。');
    try{sessionStorage.setItem('yuzhou-active-ai-'+state.mode,request.id);}catch{}
    host.dispatchEvent(new CustomEvent('ai-request-added', { bubbles: true, detail: { id: request.id } }));
    if (alive && !host.closest('.ai-page')) go('ai');
  };
  const onDrag = event => {
    if (!Array.from(event.dataTransfer?.types || []).includes('Files')) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.type === 'dragenter') dragDepth++;
    if (event.type === 'dragleave') dragDepth = Math.max(0, dragDepth - 1);
    if (event.type === 'dragover') event.dataTransfer.dropEffect = 'copy';
    form.classList.toggle('is-dragging', dragDepth > 0);
    if (event.type === 'drop') { dragDepth = 0; form.classList.remove('is-dragging'); saveAttachments(ctx, event.dataTransfer.files, owner, saveDraft); }
  };
  form.addEventListener('input', onInput);
  form.addEventListener('change', onChange);
  form.addEventListener('click', onClick);
  form.addEventListener('submit', onSubmit);
  ['dragenter', 'dragleave', 'dragover', 'drop'].forEach(type => form.addEventListener(type, onDrag));
  return () => {
    alive = false;
    activity.listeners.delete(refresh);
    form.removeEventListener('input', onInput);
    form.removeEventListener('change', onChange);
    form.removeEventListener('click', onClick);
    form.removeEventListener('submit', onSubmit);
    ['dragenter', 'dragleave', 'dragover', 'drop'].forEach(type => form.removeEventListener(type, onDrag));
  };
}

export function mountAI(ctx,spaceId){return mountConversationPage(ctx,spaceId,{mountAIComposer,downloadAttachment,destinations,destinationLabel});}
