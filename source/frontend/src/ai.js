// The composer is a real local inbox. AI execution starts only after a backend is connected.
import {cloudAIEnabled, jobFor, jobWorking, startAIJob, watchAIJobs} from './ai-cloud.js';
import {applyOrganizedContent} from './ai-organizer.js';
const activityByState = new WeakMap();
const busyRequests = new Set();
const stamp = () => new Date().toISOString();
const sizeLabel = n => n < 1048576 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`;
const labels = { waiting_model: '等待连接 AI', filed: '已手动归档', cancelled: '已取消处理' };

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
    ...(state.spaces || []).filter(s => !s.archived).map(s => ({ id: `space:${s.id}`, title: s.title, group: '我的工作区' })),
    ...(state.courses || []).filter(s => !s.archived).map(s => ({ id: `course:${s.id}`, title: s.title, group: '课程空间' })),
    { id: 'english', title: '六级空间', group: '常用空间' },
    { id: 'inbox', title: '收集箱', group: '常用空间' },
    { id: 'tasks', title: '备忘与待办', group: '常用空间' }
  ];
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

function dateLabel(date) {
  const value = new Date(date);
  return Number.isNaN(value.getTime()) ? '' : value.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function emit(state) { activityByState.get(state)?.listeners.forEach(fn => fn()); }

async function saveAttachments(ctx, files) {
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
        state.aiDraft.files.push(record);
        try { save(state); } catch (error) { state.aiDraft.files.splice(state.aiDraft.files.indexOf(record), 1); throw error; }
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
  return destinations(state).filter(d => d.id !== 'auto' && d.title.length >= 2 && text.toLowerCase().includes(d.title.toLowerCase())).slice(0, 3);
}

/** Mount a standalone composer inside a canvas card, or inside the AI page. */
export function mountAIComposer(ctx, host) {
  const { state, esc, icon, save, uid, toast, go } = ctx;
  const activity = ensure(state);
  let alive = true;
  let dragDepth = 0;
  let sending = false;
  const localSave = () => { try { save(state); return true; } catch (error) { toast(error.message || '草稿保存失败，请先复制内容。'); return false; } };
  host.classList.add('ai-composer-host');
  host.innerHTML = `<form class="ai-composer" aria-label="AI 收件台">
    <span class="ai-card-label ai-compose-card-label">01 / 内容入口</span><div class="ai-compose-intro"><span class="ai-orb">${icon('sparkles', 23)}</span><div><span class="ai-eyebrow">YOUR PERSONAL ORGANIZER</span><h2>向 AI 交代一件事</h2></div><span class="ai-local-status"><i></i>待连接</span></div>
    <p class="ai-compose-hint">课件、会议记录、突然冒出的想法，都可以放在这里。</p>
    <label class="ai-input-label" for="ai-instruction">整理指令</label>
    <textarea id="ai-instruction" name="instruction" maxlength="100000" placeholder="例如：这是迎新活动的会议记录，放进学生会，帮我整理分工和待办…" rows="4">${esc(state.aiDraft.text)}</textarea>
    <div class="ai-match-hints" aria-live="polite"></div>
    <div class="ai-drop-target"><span>${icon('upload', 18)} 拖入文件、截图或课件</span><button type="button" class="ai-attach-button" data-ai="attach">选择附件 ${icon('plus', 15)}</button><input type="file" multiple hidden data-ai-files><small>每个文件最多 40 MB · 仅保存到当前浏览器</small></div>
    <div class="ai-attachment-chips" aria-live="polite"></div>
    <div class="ai-compose-footer"><label class="ai-destination"><span>放到</span><select name="destination" aria-label="内容归属">${options(ctx, state.aiDraft.targetId)}</select></label><button class="btn ai-send" type="submit">${icon('sparkles', 17)}交给 AI ${icon('arrow-right', 16)}</button></div>
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
    const draft = state.aiDraft;
    if (cloudAIEnabled(ctx)) {
      form.querySelector('.ai-local-status').innerHTML = `<i></i>${ctx.cloud.modelStatus?.configured ? 'DeepSeek 已接入' : '云端已连接'}`;
      form.querySelector('.ai-drop-target small').textContent = '每个文件最多 40 MB · 登录后自动同步';
      form.querySelector('.ai-compose-note').textContent = '自动整理到工作区，保留原文、附件和归档回执。';
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
    if (event.target === textarea) { state.aiDraft.text = textarea.value; localSave(); refresh(); }
  };
  const onChange = event => {
    if (event.target === select) { state.aiDraft.targetId = select.value; localSave(); refresh(); }
    if (event.target === input) { const files = Array.from(input.files); input.value = ''; saveAttachments(ctx, files); }
  };
  const onClick = event => {
    const button = event.target.closest('[data-ai]');
    if (!button) return;
    if (button.dataset.ai === 'attach') input.click();
    if (button.dataset.ai === 'remove-attachment') {
      const oldFiles = state.aiDraft.files;
      state.aiDraft.files = oldFiles.filter(f => f.id !== button.dataset.id);
      if (!localSave()) state.aiDraft.files = oldFiles;
      refresh();
    }
    if (button.dataset.ai === 'match') { state.aiDraft.targetId = button.dataset.id; select.value = button.dataset.id; localSave(); refresh(); }
  };
  const onSubmit = event => {
    event.preventDefault();
    if (activity.uploading || sending) return;
    const draft = state.aiDraft;
    if (!draft.text.trim() && !draft.files.length) { toast('写下一句话，或添加一份文件再交给 AI。'); textarea.focus(); return; }
    if (!destinations(state).some(d => d.id === draft.targetId)) { toast('原工作区已归档，请重新选择归属。'); select.focus(); return; }
    sending = true;
    refresh();
    const request = { id: uid(), text: draft.text.trim(), originalText: draft.text.trim(), files: [...draft.files], targetId: draft.targetId, status: 'waiting_model', createdAt: stamp(), updatedAt: stamp() };
    state.aiRequests.unshift(request);
    state.aiDraft = { text: '', files: [], targetId: 'auto' };
    if (!localSave()) {
      state.aiRequests.splice(state.aiRequests.indexOf(request), 1);
      state.aiDraft = draft;
      sending = false;
      refresh();
      return;
    }
    textarea.value = '';
    select.value = 'auto';
    sending = false;
    emit(state);
    if (cloudAIEnabled(ctx)) {
      toast('已收到，正在提交到云端整理。');
      startAIJob(ctx, request).catch(error => toast(error.message));
    } else toast('已收到，原文和附件已保存。连接 AI 后才能自动整理。');
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
    if (event.type === 'drop') { dragDepth = 0; form.classList.remove('is-dragging'); saveAttachments(ctx, event.dataTransfer.files); }
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

export function mountAI(ctx, spaceId) {
  const { root, state, esc, icon, toast, save, modal, go } = ctx;
  ensure(state);
  if (spaceId && destinations(state).some(s => s.id === spaceId) && !state.aiDraft.text && !state.aiDraft.files.length) state.aiDraft.targetId = spaceId;
  let active = state.aiRequests[0]?.id || '';
  let filter = 'all';
  let alive = true;
  root.innerHTML = `<section class="ai-page">
    <header class="ai-page-heading"><div><span class="ai-eyebrow">LESS SORTING. MORE LIVING.</span><h1>你的 AI 收件台<span class="ai-heading-star">✳</span></h1><p>先把事情交代清楚，余下的整理，交给你的专属助手。</p></div><button class="btn" data-ai="settings">${icon('settings', 17)} 连接大模型</button></header>
    <div class="ai-page-grid"><div class="ai-compose-column"><div data-ai-composer></div><section class="ai-how"><span class="ai-card-label">HOW IT WORKS / 整理路径</span><span class="ai-eyebrow">从一句话，到各就各位</span><div><span>01</span><p><strong>说出来，或者拖进来</strong>课程资料、活动安排和生活琐事，都从这里开始。</p></div><div><span>02</span><p><strong>理解上下文，找到空间</strong>接入模型后，结合工作区说明判断归属；不确定的地方会再问你。</p></div><div><span>03</span><p><strong>整理结果，有据可查</strong>保留原件，展示去向；现在也可以手动选择空间归档。</p></div></section></div>
    <div class="ai-review-column"><section class="ai-queue-panel"><header class="ai-queue-head"><div><span class="ai-card-label">02 / 收件卡片</span><h2>收件记录 <span data-ai-count></span></h2><p>每一份交代，都留有来处。</p></div><span class="ai-local-badge">${icon('shield', 13)} 仅本机</span></header><nav class="ai-queue-filters" aria-label="按整理状态筛选"><button class="active" data-ai-filter="all">全部</button><button data-ai-filter="waiting_model">待处理</button><button data-ai-filter="filed">已归档</button><button data-ai-filter="cancelled">已取消</button></nav><div class="ai-queue-list" data-ai-queue></div></section><section class="ai-request-detail" data-ai-detail aria-label="所选收件内容与处理结果"></section></div></div>
  </section>`;
  const page = root.querySelector('.ai-page');
  const disposeComposer = mountAIComposer(ctx, page.querySelector('[data-ai-composer]'));
  const list = page.querySelector('[data-ai-queue]');
  const detail = page.querySelector('[data-ai-detail]');
  const receiptItems = receipt => (receipt?.items || []).map(item => typeof item === 'string' ? item : item.title || item.name || ({ note: '原文记录', file: '附件', task: '待办事项' }[item.type]) || '归档内容');
  function render() {
    if (!alive) return;
    const items = state.aiRequests.filter(r => filter === 'all' || r.status === filter);
    if (!items.some(r => r.id === active)) active = items[0]?.id || '';
    page.querySelector('[data-ai-count]').textContent = state.aiRequests.length;
    if (cloudAIEnabled(ctx)) page.querySelector('.ai-local-badge').textContent = '私人云同步';
    page.querySelectorAll('[data-ai-filter]').forEach(b => { b.classList.toggle('active', b.dataset.aiFilter === filter); b.setAttribute('aria-pressed', String(b.dataset.aiFilter === filter)); });
    list.innerHTML = items.length ? items.map(r => `<button class="ai-request-row ${active === r.id ? 'selected' : ''}" data-status="${esc(r.status)}" aria-pressed="${active === r.id}" data-ai="select" data-id="${esc(r.id)}"><span class="ai-request-symbol ${r.status}">${icon(r.status === 'filed' ? 'archive' : r.status === 'cancelled' ? 'pause' : 'message', 18)}</span><span class="ai-request-summary"><strong>${esc(r.text || r.files?.[0]?.name || '附件整理')}</strong><small>${esc(destinationLabel(state, r.targetId))} · ${dateLabel(r.createdAt)}${r.files?.length ? ` · ${r.files.length} 个附件` : ''}</small></span><span class="ai-request-status ${r.status}">${labels[r.status] || '待处理'}</span></button>`).join('') : `<div class="ai-queue-empty">${icon(filter === 'all' ? 'inbox' : 'check-circle', 34)}<h3>${filter === 'all' ? '把第一件事交给这里' : '这个分类下还没有记录'}</h3><p>${filter === 'all' ? '可以先写一段话，或拖入一份文件。<br>内容会保存在本机，等 AI 接入后继续整理。' : '原文和附件会随收件记录一起保留。'}</p></div>`;
    for (const row of list.querySelectorAll('.ai-request-row')) {
      const r=state.aiRequests.find(r=>r.id===row.dataset.id), job=jobFor(state,row.dataset.id);
      if (r?.status==='filed'&&r.receipt?.engine==='hermes') row.querySelector('.ai-request-status').textContent='AI 已归档';
      else if (r?.status==='waiting_model'&&job) row.querySelector('.ai-request-status').textContent=({queued:'排队中',running:'正在整理',succeeded:job.autoFiled?'正在同步':'结果待确认',failed:'需要处理'})[job.status]||'待处理';
    }
    const request = state.aiRequests.find(r => r.id === active);
    detail.hidden = !request;
    detail.dataset.status = request?.status || 'empty';
    if (!request) { detail.innerHTML = ''; return; }
    const busy = busyRequests.has(request.id);
    detail.innerHTML = `<span class="ai-card-label">03 / 内容与处理结果</span><header class="ai-detail-head"><h3>${request.originalText !== undefined && request.originalText !== request.text ? '当前内容与指令' : '原始内容'}</h3><span>${dateLabel(request.createdAt)}</span></header><p class="ai-original-text">${esc(request.text || '这份请求只有附件，没有附加文字。')}</p>
      ${request.originalText !== undefined && request.originalText !== request.text ? `<details class="ai-original-history"><summary>查看最初提交的原文</summary><p>${esc(request.originalText || '最初只提交了附件。')}</p></details>` : ''}
      ${request.files?.length ? `<div class="ai-original-files">${request.files.map(f => `<button data-ai="download" data-file="${esc(f.id)}">${icon('file', 18)}<span>${esc(f.name)}<small>${sizeLabel(f.size)}</small></span>${icon('download', 16)}</button>`).join('')}</div>` : ''}
      <div class="ai-target-summary">${icon('folder', 16)}<span>归属：<strong>${esc(destinationLabel(state, request.targetId))}</strong></span></div>
      ${request.status === 'filed' ? `<div class="ai-receipt"><span>${icon('check-circle', 19)} 归档回执</span><strong>原文与附件已放入 ${esc(request.receipt?.destinationLabel || destinationLabel(state, request.receipt?.destinationId || request.targetId))}</strong><p>这是按你指定位置完成的手动归档，未调用 AI 生成摘要。</p>${receiptItems(request.receipt).length ? `<ul>${receiptItems(request.receipt).map(item => `<li>${esc(item)}</li>`).join('')}</ul>` : ''}</div><div class="ai-detail-actions"><button class="btn primary" data-ai="visit">打开工作区 ${icon('arrow-right', 16)}</button>${ctx.undoRoute ? `<button class="btn" data-ai="undo" ${busy ? 'disabled' : ''}>撤销本次归档</button>` : ''}</div>` : request.status === 'cancelled' ? `<div class="ai-wait-note">${icon('pause', 17)}<p>已停止这份请求。原文和附件仍完整保留，可随时恢复。</p></div><div class="ai-detail-actions"><button class="btn" data-ai="restore">${icon('refresh', 15)} 恢复到待处理</button></div>` : `<div class="ai-wait-note">${icon('clock', 17)}<p>内容已保存，等待连接大模型。当前没有自动分类、提炼笔记或创建待办。</p></div><div class="ai-detail-actions"><button class="btn" data-ai="edit" ${busy ? 'disabled' : ''}>${icon('edit', 15)} 修改指令与归属</button><button class="btn primary" data-ai="file" ${busy ? 'disabled' : ''}>${icon('archive', 15)} ${busy ? '正在归档…' : '手动归档'}</button><button class="text-btn" data-ai="cancel" ${busy ? 'disabled' : ''}>取消处理</button></div>`}`;
    if (request.status==='filed'&&request.receipt?.engine==='hermes') {
      detail.querySelector('.ai-receipt strong').textContent=`整理结果与原文件已放入 ${request.receipt.destinationLabel}`;
      detail.querySelector('.ai-receipt p').textContent='由 Hermes 调用 DeepSeek 整理。原文与附件保留，可以撤回尚未修改的归档内容。';
      const warnings=request.aiProposal?.warnings||[];
      if(warnings.length)detail.querySelector('.ai-receipt').insertAdjacentHTML('beforeend',`<p>${warnings.map(esc).join('<br>')}</p>`);
    }
    if (cloudAIEnabled(ctx)&&request.status==='waiting_model') {
      const job=jobFor(state,request.id), working=jobWorking(job), proposal=job?.proposal;
      const message=working?(job.status==='queued'?'任务已进入云端队列，完成后自动归档。':'Hermes 正在整理，关闭页面后仍会继续。'):job?.status==='failed'?(job.error?.message||'整理未完成，原文和附件已保留。'):job?.status==='succeeded'?(job.autoFiled?(request.aiProposal?'上次归档已撤销，可以重新整理或重用结果。':'云端已完成归档，正在同步最新内容。'):job.autoFileError||'整理结果已生成，请检查后归档。'):'可以自动提炼笔记、拆分待办，并放入对应工作区。';
      detail.querySelector('.ai-wait-note').innerHTML=`${icon(working?'clock':'sparkles',17)}<p>${esc(message)}</p>`;
      const actions=detail.querySelector('.ai-detail-actions');
      actions.insertAdjacentHTML('afterbegin',`<button class="btn primary" data-ai="run" ${working?'disabled':''}>${icon('sparkles',16)} ${working?'正在整理…':job?'重新整理':'开始 AI 整理'}</button>`);
      for(const action of ['edit','file'])actions.querySelector(`[data-ai="${action}"]`).disabled=working||busy;
      if (working) actions.querySelector('[data-ai="cancel"]').textContent='停止归档';
      if (proposal&&!job.autoFiled) {
        const html=`<div class="ai-receipt"><strong>${esc(proposal.title)}</strong><p>${esc(proposal.summary)}</p><p>建议放入：${esc(destinationLabel(state,proposal.destinationId))}</p>${(proposal.notes||[]).map(n=>`<details class="ai-original-history"><summary>${esc(n.title)}</summary><p style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(n.content)}</p></details>`).join('')}${proposal.tasks?.length?`<ul>${proposal.tasks.map(t=>`<li>${esc(t.title)}${t.date?' · '+esc(t.date):''}</li>`).join('')}</ul>`:''}${proposal.warnings?.length?`<p>${proposal.warnings.map(esc).join('<br>')}</p>`:''}</div>`;
        actions.insertAdjacentHTML('beforebegin',html);
        actions.insertAdjacentHTML('afterbegin',`<button class="btn primary" data-ai="apply">${icon('archive',16)} 保存整理结果</button>`);
      }
    }
  }

  function editRequest(request, fileAfter = false) {
    modal({ title: fileAfter ? '选择归档工作区' : '修改整理指令', submitLabel: fileAfter ? '保存原文并归档' : '保存修改', body: `<div class="ai-edit-form"><span class="ai-card-label">EDIT / 整理指令</span><p>${fileAfter ? '原文和附件会放入所选工作区，不会自动总结或拆分。' : '保留原始附件；这份请求仍会等待连接大模型。'}</p><label>原文与整理指令<textarea class="field" name="text" rows="7" maxlength="100000">${esc(request.text)}</textarea></label><label>目标工作区<select class="field" name="destination">${options(ctx, request.targetId)}</select></label></div>`, onSubmit: async form => {
      const text = String(form.get('text') || '').trim();
      const targetId = String(form.get('destination') || 'auto');
      if (!text && !request.files?.length) { toast('请保留一些文字，或返回添加附件。'); return false; }
      if (!destinations(state).some(d => d.id === targetId)) { toast('请选择一个现有工作区。'); return false; }
      if (fileAfter && targetId === 'auto') { toast('手动归档需要选择一个明确的工作区。'); return false; }
      request.originalText ??= request.text;
      request.revisions ||= [];
      if (request.text !== text || request.targetId !== targetId) request.revisions.push({text: request.text, targetId: request.targetId, savedAt: stamp()});
      request.text = text;
      request.targetId = targetId;
      request.updatedAt = stamp();
      save(state);
      if (fileAfter) return await fileRequest(request);
      render();
      toast('整理指令和归属已更新。');
    } });
  }

  async function fileRequest(request) {
    if (busyRequests.has(request.id) || request.status !== 'waiting_model') return false;
    if (typeof ctx.routeContent !== 'function') { toast('归档功能尚未就绪，请稍后重试。'); return false; }
    if (request.targetId === 'auto' || !destinations(state).some(d => d.id === request.targetId)) { editRequest(request, true); return false; }
    busyRequests.add(request.id);
    render();
    try {
      const receipt = await ctx.routeContent({ text: request.text, files: request.files || [], targetId: request.targetId, requestId: request.id });
      request.receipt = receipt;
      request.status = 'filed';
      request.updatedAt = stamp();
      save(state);
      toast('原文与附件已归档，原始收件记录仍保留。');
      return true;
    } catch (error) { toast(error.message || '归档失败，请重试。'); return false; }
    finally { busyRequests.delete(request.id); render(); }
  }

  async function onClick(event) {
    const filterButton = event.target.closest('[data-ai-filter]');
    if (filterButton) { filter = filterButton.dataset.aiFilter; render(); return; }
    const button = event.target.closest('[data-ai]');
    if (!button || !page.contains(button)) return;
    const action = button.dataset.ai;
    if (action === 'settings') { go('settings'); return; }
    if (action === 'select') { active = button.dataset.id; render(); return; }
    const request = state.aiRequests.find(r => r.id === active);
    if (!request) return;
    if (action === 'download') { const file = request.files?.find(f => f.id === button.dataset.file); if (file) await downloadAttachment(ctx, file); return; }
    if (action === 'visit') {
      const target = request.receipt?.destinationId || request.targetId;
      if (target.startsWith('space:')) go('space', target.slice(6));
      else if (target.startsWith('course:')) go('courses', target.slice(7));
      else go(target, target === 'english' ? 'materials' : '');
      return;
    }
    if (busyRequests.has(request.id)) return;
    try {
      if (action === 'run' && request.status==='waiting_model') {
        await startAIJob(ctx,request);render();return;
      }
      if (action === 'apply' && request.status==='waiting_model') {
        const proposal=jobFor(state,request.id)?.proposal;
        if (!proposal) throw new Error('整理结果尚未就绪。');
        await ctx.cloud.flush();
        const previous=structuredClone(state);
        try {applyOrganizedContent(state,request.id,proposal,{uid:ctx.uid});save(state);}
        catch(error){for(const key of Object.keys(state))delete state[key];Object.assign(state,previous);throw error;}
        await ctx.cloud.flush();render();toast('整理结果已保存到工作区。');return;
      }
      if (action === 'edit' && request.status === 'waiting_model') editRequest(request);
      if (action === 'file' && request.status === 'waiting_model') editRequest(request, true);
      if (action === 'cancel' || action === 'restore') {
        const oldStatus = request.status;
        request.status = action === 'cancel' ? 'cancelled' : 'waiting_model';
        request.updatedAt = stamp();
        try { save(state); } catch (error) { request.status = oldStatus; throw error; }
        render();
        if(cloudAIEnabled(ctx))await ctx.cloud.flush();
        toast(action === 'cancel' ? '已停止自动归档，原文和附件保留。' : '已恢复，可以再次整理。');
      }
      if (action === 'undo' && request.status === 'filed' && ctx.undoRoute) {
        busyRequests.add(request.id); render();
        try {
          const result = await ctx.undoRoute(request.receipt, request.id);
          request.status = 'waiting_model';
          request.receipt = undefined;
          request.updatedAt = stamp();
          save(state);
          toast(result?.retained ? `已撤回未修改的归档内容；${result.retained} 项已编辑内容保留。原件已回到待处理记录。` : '本次归档已撤销，原件已保留在待处理记录中。');
        } finally { busyRequests.delete(request.id); render(); }
      }
    } catch (error) { toast(error.message || '操作没有完成，请重试。'); }
  }
  const onAdded = event => { active = event.detail.id; filter = 'all'; render(); };
  page.addEventListener('click', onClick);
  page.addEventListener('ai-request-added', onAdded);
  const disposeCloud=watchAIJobs(ctx,render);
  render();
  return () => { alive = false; disposeCloud(); disposeComposer(); page.removeEventListener('click', onClick); page.removeEventListener('ai-request-added', onAdded); };
}
