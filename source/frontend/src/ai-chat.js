import {previewOrganizedContent} from './ai-organizer.js';
import {cloudAIEnabled,jobFor,jobWorking,startAIJob,watchAIJobs} from './ai-cloud.js';
import {ensureConversation} from './ai-conversation-model.js';

export function mountConversationPage(ctx,spaceId,helpers){
  const {root,state,esc,icon,toast,save,go,uid}=ctx;
  const {mountAIComposer,downloadAttachment,destinations,destinationLabel}=helpers;
  state.aiRequests||=[];state.aiDraft||={text:'',files:[],targetId:'auto'};
  if(spaceId&&destinations(state).some(d=>d.id===spaceId)&&!state.aiDraft.text&&!state.aiDraft.files.length)state.aiDraft.targetId=spaceId;
  const selectionKey='yuzhou-active-ai-'+state.mode;
  let active='',alive=true,disposeComposer=null,composerKey=null,busy=false,transcriptKey='';
  try{active=sessionStorage.getItem(selectionKey)||'';}catch{}
  if(active&&!state.aiRequests.some(r=>r.id===active))active='';
  root.innerHTML=`<section class="ai-page ai-chat-page"><header class="ai-chat-heading"><div><h1>AI 收件台<span>✳</span></h1><p>先对话，审核行动方案，再确认执行。</p></div><button class="btn" data-chat="settings" aria-label="模型设置" title="模型设置">${icon('settings',17)}<span>模型设置</span></button></header><div class="ai-chat-layout"><aside class="ai-chat-history"><div class="ai-chat-history-tools"><button class="btn primary" data-chat="new">${icon('plus',18)}新对话</button><button class="btn ai-chat-history-toggle" data-chat="history" aria-expanded="false" aria-controls="ai-chat-history-list">${icon('message',16)}历史对话 <span data-chat-count></span>${icon('chevron-down',14)}</button></div><h2>最近对话</h2><div id="ai-chat-history-list" data-chat-list></div></aside><section class="ai-chat-main" aria-label="当前对话"><div class="ai-chat-stages" data-chat-stages aria-label="行动进度"></div><div data-chat-thread tabindex="0" aria-label="当前对话内容"></div><div data-chat-state role="status" aria-live="polite"></div><div data-chat-composer></div></section></div></section>`;
  const page=root.querySelector('.ai-chat-page'),list=page.querySelector('[data-chat-list]'),thread=page.querySelector('[data-chat-thread]'),status=page.querySelector('[data-chat-state]'),composer=page.querySelector('[data-chat-composer]');
  const remember=()=>{try{sessionStorage.setItem(selectionKey,active);}catch{}};
  const toggleHistory=open=>{page.classList.toggle('is-history-open',open);page.querySelector('[data-chat="history"]').setAttribute('aria-expanded',String(open));};
  // Size the transcript from the space actually visible above the navigation and
  // software keyboard, rather than forcing the whole page beyond a phone screen.
  let viewportFrame=0;
  const fitViewport=()=>{
    cancelAnimationFrame(viewportFrame);viewportFrame=requestAnimationFrame(()=>{
      if(!alive)return;
      const viewport=window.visualViewport,height=viewport?.height||innerHeight,offset=viewport?.offsetTop||0;
      const typing=page.contains(document.activeElement)&&document.activeElement?.tagName==='TEXTAREA';
      page.classList.toggle('is-keyboard-open',typing&&(height<innerHeight-120||height<560));
      const nav=document.querySelector('.bottom-nav'),navRect=nav?.getBoundingClientRect();
      const navHeight=navRect&&getComputedStyle(nav).display!=='none'&&navRect.top<offset+height?Math.max(0,offset+height-Math.max(offset,navRect.top)):0;
      page.style.setProperty('--ai-chat-height',`${Math.max(220,height-Math.max(0,page.getBoundingClientRect().top-offset)-navHeight-10)}px`);
    });
  };
  const requestNow=()=>state.aiRequests.find(r=>r.id===active);
  const visit=target=>{if(target.startsWith('space:'))go('space',target.slice(6));else if(target.startsWith('course:'))go('courses',target.slice(7));else go(target,target==='english'?'materials':'');};
  const proposalHTML=p=>{
    let actions;try{actions=previewOrganizedContent(state,active,p);}catch(error){return `<div class="ai-chat-proposal"><strong>方案需要调整</strong><p>${esc(error.message)}</p><button class="btn" data-chat="revise">继续对话</button></div>`;}
    return `<section class="ai-chat-proposal" aria-label="行动审核单"><header><span>${icon('shield',18)}待你审核 · 尚未执行</span><strong>行动目标：${esc(p.title)}</strong></header><p>${esc(p.summary)}</p>${p.reason?`<p class="ai-chat-review-reason">方案依据：${esc(p.reason)}</p>`:''}<h3 class="ai-chat-review-title">确认后将执行 ${actions.length} 项操作</h3><ol class="ai-chat-actions">${actions.map((a,i)=>`<li><div class="ai-chat-action-heading"><b>${i+1}</b><span>${esc(a.type)} → ${esc(a.destination)}</span></div><strong>${esc(a.title)}</strong>${a.priority?`<p>日期：${esc(a.date||'未设日期')} · 优先级：${esc(a.priority)}</p>`:''}${a.content?`<details open><summary>查看完整内容</summary><div class="ai-chat-note">${esc(a.content)}</div></details>`:''}${a.fileName?`<p>原始附件：${esc(a.fileName)}</p>`:''}</li>`).join('')}</ol>${p.warnings.length?`<p class="ai-chat-warning">需要核对：<br>${p.warnings.map(esc).join('<br>')}</p>`:''}<footer><button class="btn primary" data-chat="confirm" ${busy?'disabled':''}>${icon('check-circle',16)}${busy?'正在执行…':'确认执行这 '+actions.length+' 项操作'}</button><button class="btn" data-chat="revise">继续修改方案</button><span>仅执行上面列出的新增操作。继续发送消息会使本方案失效，需重新审核。</span></footer></section>`;
  };
  function render(){
    if(!alive)return;
    const request=requestNow(),job=request?jobFor(state,request.id):null,working=jobWorking(job);
    const stage=request?.status==='filed'?3:request?.conversation?.proposal?2:1;
    page.querySelector('[data-chat-count]').textContent=String(state.aiRequests.length);
    page.querySelector('[data-chat-stages]').innerHTML=['对话沟通','审核方案','确认执行'].map((label,i)=>`<span ${stage===i+1?'aria-current=step':''} class="${stage>i+1?'complete':''}"><b>${i+1}</b>${label}</span>`).join('');
    list.innerHTML=state.aiRequests.length?state.aiRequests.map(r=>`<button data-chat="select" data-id="${esc(r.id)}" class="ai-chat-history-item ${r.id===active?'selected':''}" aria-pressed="${r.id===active}"><strong>${esc(r.text||r.files?.[0]?.name||'附件对话')}</strong><span>${r.status==='filed'?'已执行':r.status==='cancelled'?'已暂停':r.conversation?.proposal?'方案待确认':jobWorking(jobFor(state,r.id))?'正在回复':'继续对话'} · ${esc(new Date(r.updatedAt||r.createdAt).toLocaleDateString('zh-CN',{month:'numeric',day:'numeric'}))}</span></button>`).join(''):'<p class="muted small">你的对话会留在这里。</p>';
    const nextTranscript=JSON.stringify([request?.id,request?.status,request?.conversation,request?.receipt,request?.files,busy]);
    if(nextTranscript!==transcriptKey){
      transcriptKey=nextTranscript;
      if(!request)thread.innerHTML=`<div class="ai-chat-welcome"><span>${icon('message',30)}</span><h2>不必一次说完整。</h2><p>先自由聊聊你的想法，我会追问缺少的信息。目标明确后，我会列出行动审核单；你检查并点击「确认执行」，才会改动工作区。</p></div>`;
      else {
        const messages=request.conversation?.messages||[{role:'user',text:request.text||'请看看这些附件。'}];
        thread.innerHTML=`<div class="ai-chat-thread-heading"><h2>${esc(request.text?.slice(0,55)||'附件对话')}</h2>${request.conversation?.parentRequestId?'<span>接着上次的话题</span>':''}</div><div class="ai-chat-messages" role="log" aria-label="对话记录">${messages.map(m=>`<article class="ai-chat-message ${m.role}"><span>${m.role==='user'?'你':'宇宙 AI'}</span><div>${esc(m.text)}</div>${m.proposal?`<details class="ai-chat-past-proposal"><summary>查看这一轮方案</summary><div><strong>${esc(m.proposal.title)}</strong><p>${esc(m.proposal.summary)}</p>${m.proposal.notes.map(n=>`<h4>${esc(n.title)}</h4><p>${esc(n.content)}</p>`).join('')}${m.proposal.tasks.length?`<ul>${m.proposal.tasks.map(t=>`<li>${esc(t.title)}${t.date?' · '+esc(t.date):''}</li>`).join('')}</ul>`:''}</div></details>`:''}</article>`).join('')}</div>${request.files?.length?`<details class="ai-chat-files"><summary>${request.files.length} 个对话附件</summary>${request.files.map(f=>`<button data-chat="download" data-file="${esc(f.id)}">${icon('file',16)}${esc(f.name)}${icon('download',16)}</button>`).join('')}</details>`:''}${request.status==='waiting_model'&&request.conversation?.proposal?proposalHTML(request.conversation.proposal):''}${request.status==='filed'?`<div class="ai-chat-receipt"><strong>${icon('check-circle',18)}已执行 ${request.receipt?.items?.length||0} 项操作 · ${esc(request.receipt?.destinationLabel||'工作区')}</strong><p>这次对话和原始附件已保留。</p><ul class="ai-chat-executed">${(request.receipt?.items||[]).map(item=>`<li>${esc(item.type)} · ${esc(item.title)}</li>`).join('')}</ul><div><button class="btn primary" data-chat="visit">打开工作区</button><button class="btn" data-chat="continue">接着聊</button>${ctx.undoRoute?'<button class="text-btn" data-chat="undo">撤销本次归档</button>':''}</div></div>`:request.status==='cancelled'?'<div class="ai-chat-receipt"><p>对话已暂停，消息和附件仍保留。</p><button class="btn" data-chat="restore">恢复对话</button></div>':''}`;
        requestAnimationFrame(()=>{if(!alive)return;const review=thread.querySelector('.ai-chat-proposal');if(review)thread.scrollTop+=review.getBoundingClientRect().top-thread.getBoundingClientRect().top;else thread.scrollTop=thread.scrollHeight;});
      }
    }
    let message='';
    if(request?.status==='waiting_model'){
      if(working)message='正在结合前文和附件回复…';
      else if(job?.status==='failed')message=job.error?.message||'回复未完成，可以重试。';
      else if(job?.replyError)message=job.replyError;
      else if(job?.replySaved&&request.conversation?.messages.at(-1)?.role==='user')message='回复已完成，正在同步对话。';
      else if(!cloudAIEnabled(ctx))message='消息保存在本机。进入云端工作台并连接模型后，可以继续这段对话。';
    }
    const needsReply=request?.status==='waiting_model'&&(!request.conversation||request.conversation.messages.at(-1)?.role==='user');
    status.innerHTML=`${message?`<p>${esc(message)}</p>`:''}${needsReply&&cloudAIEnabled(ctx)&&!working?`<button class="btn" data-chat="retry" ${busy?'disabled':''}>${icon('refresh',16)}${job?.status==='failed'?'重试这一轮':'让 AI 回复'}</button>`:''}`;
    if(request?.status==='waiting_model'&&!working&&!request.conversation?.proposal)status.insertAdjacentHTML('beforeend','<button class="text-btn ai-chat-manual" data-chat="manual">直接归档原文</button>');
    const nextComposer=request&&request.status!=='waiting_model'?'closed':request?.id||'new';
    if(nextComposer!==composerKey){
      disposeComposer?.();composer.innerHTML='';composerKey=nextComposer;
      if(nextComposer!=='closed'){
        disposeComposer=mountAIComposer(ctx,composer,request?{request}:{});
        const attach=composer.querySelector('[data-ai="attach"]');
        attach?.setAttribute('aria-label','选择附件');attach?.setAttribute('title','选择附件');
      }
    }
    // A reply writes the conversation atomically on the server. Keep this
    // conversation's input still until it arrives; unsent text stays in a local draft.
    for(const el of composer.querySelectorAll('textarea,select,button,input'))el.disabled=working||busy;
    const input=composer.querySelector('textarea');if(input&&request)input.placeholder='补充信息、回答追问，或者告诉我哪里需要调整…';
    page.querySelector('[data-chat="new"]').disabled=busy;
    fitViewport();
  }
  async function onClick(event){
    const button=event.target.closest('[data-chat]');if(!button||busy)return;
    const action=button.dataset.chat,request=requestNow();
    if(action==='history'){toggleHistory(!page.classList.contains('is-history-open'));return;}
    if(action==='new'){active='';remember();toggleHistory(false);render();composer.querySelector('textarea')?.focus();return;}
    if(action==='select'){active=button.dataset.id;remember();toggleHistory(false);render();return;}
    if(action==='settings'){go('settings');return;}
    if(!request)return;
    try{
      if(action==='download'){const f=request.files?.find(f=>f.id===button.dataset.file);if(f)await downloadAttachment(ctx,f);return;}
      if(action==='visit'){visit(request.receipt?.destinationId||request.targetId);return;}
      if(action==='revise'){composer.querySelector('textarea')?.focus();toast('在输入框里告诉我哪里需要调整，发送后会重新生成审核单。');return;}
      if(action==='retry'){await startAIJob(ctx,request);render();return;}
      if(action==='manual'){
        ctx.modal({title:'直接归档原文',body:`<p>保存你发送过的文字和全部附件。</p><label class="field">归档到<select name="destination">${destinations(state).filter(d=>d.id!=='auto').map(d=>`<option value="${esc(d.id)}" ${d.id===(request.targetId==='auto'?'inbox':request.targetId)?'selected':''}>${esc(d.title)}</option>`).join('')}</select></label>`,submitLabel:'确认归档原文',onSubmit:async form=>{
          const text=request.conversation?.messages.filter(m=>m.role==='user').map(m=>m.text).join('\n\n')||request.text;
          await ctx.routeContent({text,files:request.files||[],targetId:String(form.get('destination')),requestId:request.id});render();
        }});return;
      }
      if(action==='continue'){
        if((request.conversation?.messages.length||0)>=78){toast('这段对话已较长，请点击新对话；旧消息仍完整保留。');return;}
        const copy={id:uid(),text:request.text,originalText:request.originalText||request.text,files:structuredClone(request.files||[]),targetId:request.targetId,status:'waiting_model',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
        const previous=ensureConversation(request,uid);
        copy.conversation={version:1,parentRequestId:request.id,messages:structuredClone(previous.messages)};
        if(copy.conversation.messages.at(-1)?.role==='user')copy.conversation.messages.push({id:uid(),role:'assistant',text:`上次内容已归档到${request.receipt?.destinationLabel||'工作区'}。这次想继续调整什么？`,createdAt:copy.createdAt});
        state.aiRequests.unshift(copy);try{save(state);}catch(error){state.aiRequests.shift();throw error;}
        active=copy.id;remember();render();composer.querySelector('textarea')?.focus();return;
      }
      if(action==='restore'){request.status='waiting_model';try{save(state);}catch(error){request.status='cancelled';throw error;}render();return;}
      if(action==='confirm'){
        if(composer.querySelector('textarea')?.value.trim()||composer.querySelector('.ai-attachment-chip')||composer.querySelector('select[name=destination]')?.value!==request.targetId||composer.querySelector('.ai-compose-live')?.textContent.trim())throw new Error('你还有未发送的补充或附件，请先发送并审核新方案，再确认执行。');
        const jobId=request.conversation?.pendingJobId;if(!jobId)throw new Error('请先等待最新一轮整理方案。');
        busy=true;render();await ctx.cloud.flush();
        await ctx.cloud.request(`/api/ai/jobs/${encodeURIComponent(jobId)}/confirm`,{method:'POST',body:{}});
        toast('已按审核单执行完成。');await ctx.cloud.poll();return;
      }
      if(action==='undo'&&ctx.undoRoute){
        busy=true;render();const result=await ctx.undoRoute(request.receipt,request.id);
        request.status='waiting_model';delete request.receipt;
        if(request.conversation){delete request.conversation.confirmedJobId;delete request.conversation.pendingJobId;delete request.conversation.proposal;}
        save(state);toast(result?.retained?'已撤销未修改的内容，编辑过的记录保留。':'归档已撤销，可以继续讨论。');
      }
    }catch(error){toast(error.message||'操作未完成，请重试。');}
    finally{busy=false;render();}
  }
  const onAdded=event=>{active=event.detail.id;remember();render();};
  const closeHistory=event=>{if(page.classList.contains('is-history-open')&&!event.target.closest('.ai-chat-history'))toggleHistory(false);};
  const onKey=event=>{if(event.key==='Escape'&&page.classList.contains('is-history-open')){toggleHistory(false);page.querySelector('[data-chat="history"]').focus();}};
  page.addEventListener('click',onClick);page.addEventListener('ai-request-added',onAdded);
  document.addEventListener('pointerdown',closeHistory);page.addEventListener('keydown',onKey);page.addEventListener('focusin',fitViewport);page.addEventListener('focusout',fitViewport);
  window.addEventListener('resize',fitViewport);window.visualViewport?.addEventListener('resize',fitViewport);window.visualViewport?.addEventListener('scroll',fitViewport);
  const disposeCloud=watchAIJobs(ctx,render);render();
  return ()=>{alive=false;cancelAnimationFrame(viewportFrame);disposeCloud();disposeComposer?.();page.removeEventListener('click',onClick);page.removeEventListener('ai-request-added',onAdded);document.removeEventListener('pointerdown',closeHistory);page.removeEventListener('keydown',onKey);page.removeEventListener('focusin',fitViewport);page.removeEventListener('focusout',fitViewport);window.removeEventListener('resize',fitViewport);window.visualViewport?.removeEventListener('resize',fitViewport);window.visualViewport?.removeEventListener('scroll',fitViewport);};
}
