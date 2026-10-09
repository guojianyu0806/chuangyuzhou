import {previewOrganizedContent} from './ai-organizer.js';
import {cloudAIEnabled,jobFor,jobWorking,startAIJob,watchAIJobs} from './ai-cloud.js';
import {ensureConversation} from './ai-conversation-model.js';
import {formatMoney,parseAmount} from './ledger-model.js';
import {describeWorkspaceAction} from './workspace-actions.js';

export function mountConversationPage(ctx,spaceId,helpers){
  const {root,state,esc,icon,toast,save,go,uid}=ctx;
  const {mountAIComposer,downloadAttachment,destinations,destinationLabel}=helpers;
  state.aiRequests||=[];state.aiDraft||={text:'',files:[],targetId:'auto'};
  if(spaceId&&destinations(state).some(d=>d.id===spaceId)&&!state.aiDraft.text&&!state.aiDraft.files.length)state.aiDraft.targetId=spaceId;
  const selectionKey='czb-yuzhou-active-ai-'+state.mode;
  let active='',alive=true,disposeComposer=null,composerKey=null,busy=false,transcriptKey='';
  try{active=sessionStorage.getItem(selectionKey)||'';}catch{}
  if(active&&!state.aiRequests.some(r=>r.id===active))active='';
  root.innerHTML=`<section class="ai-page ai-chat-page"><header class="ai-chat-heading"><div><h1>小宇 · AI伙伴<span>✳</span></h1><p>搭建工作台，创建方块与交互小工具。先审核，再执行。</p></div><button class="btn" data-chat="settings" aria-label="模型设置" title="模型设置">${icon('settings',17)}<span>模型设置</span></button></header><div class="ai-chat-layout"><aside class="ai-chat-history"><div class="ai-chat-history-tools"><button class="btn primary" data-chat="new">${icon('plus',18)}新对话</button><button class="btn ai-chat-history-toggle" data-chat="history" aria-expanded="false" aria-controls="ai-chat-history-list">${icon('message',16)}历史对话 <span data-chat-count></span>${icon('chevron-down',14)}</button><button class="btn ai-chat-capabilities" data-chat="capabilities" aria-label="查看 AI 能力" title="查看 AI 能力">${icon('info',16)}<span>能力</span></button></div><h2>最近对话</h2><div id="ai-chat-history-list" data-chat-list></div></aside><section class="ai-chat-main" aria-label="当前对话"><div class="ai-chat-stages" data-chat-stages aria-label="行动进度"></div><div data-chat-thread tabindex="0" aria-label="当前对话内容"></div><div data-chat-state role="status" aria-live="polite"></div><div data-chat-composer></div></section></div></section>`;
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
  const ledgerTarget=target=>target==='ledger'||target?.startsWith('ledger:');
  const manualTarget=target=>['inbox','tasks','english'].includes(target)||target?.startsWith('space:')||target?.startsWith('course:');
  const visit=(target,receipt)=>{if(target==='ledger')go('ledger','daily');else if(target?.startsWith('ledger:'))go('ledger',target.slice(7));else if(target?.startsWith('space:'))go('space',target.slice(6));else if(target?.startsWith('course:'))go('courses',target.slice(7));else if(!target||target==='workspace'||target==='auto')go('home');else go(target,target==='english'&&!receipt?.items?.some(item=>item.collection==='actions')?'materials':'');};
  const money=cents=>`¥${formatMoney(cents)}`;
  const ledgerSummary=actions=>{
    const entries=actions.filter(a=>a.ledger);if(!entries.length)return '';
    const sum=income=>entries.filter(a=>(a.type==='新增收入')===income).reduce((total,a)=>total+a.amountCents,0);
    return `<div class="ai-chat-ledger-summary" aria-label="本次记账汇总"><div><span>本次支出</span><strong>${money(sum(false))}</strong></div><div><span>本次收入</span><strong>${money(sum(true))}</strong></div><div><span>待记入</span><strong>${entries.length}<small> 笔</small></strong></div></div>`;
  };
  const ledgerDetails=a=>`<div class="ai-chat-ledger-amount ${a.type==='新增收入'?'income':'expense'}"><strong>${a.type==='新增收入'?'+':'−'}${money(a.amountCents)}</strong><span>${esc(a.category)}</span></div><dl class="ai-chat-ledger-meta"><div><dt>日期</dt><dd>${esc(a.date)}</dd></div>${typeof a.includeInTotal==='boolean'?`<div><dt>总账</dt><dd>${a.includeInTotal?'计入总账单':'项目独立核算 · 不计入总账'}</dd></div>`:''}<div><dt>备注</dt><dd>${esc(a.content||'无')}</dd></div></dl>`;
  const pastLedgerHTML=p=>{
    if(!p.ledgerEntries?.length)return '';
    try{
      const actions=p.ledgerEntries.map(e=>({ledger:true,type:e.type==='income'?'新增收入':'新增支出',amountCents:parseAmount(e.amount),date:e.date,category:e.category,content:e.note}));
      return `${ledgerSummary(actions)}<p class="ai-chat-ledger-history-target">账本：${esc(destinationLabel(state,p.destinationId))}</p><div class="ai-chat-ledger-history">${actions.map(a=>`<section>${ledgerDetails(a)}</section>`).join('')}</div>`;
    }catch{return '<p>这轮记账方案格式已变化，请以最新审核单为准。</p>';}
  };
  const fieldText=value=>value===undefined||value===null||value===''?'未填写':typeof value==='boolean'?(value?'是':'否'):Array.isArray(value)?value.join('、'):String(value);
  const actionFields=a=>{
    const fields=Array.isArray(a.fields)?a.fields:[];if(!fields.length)return '';
    const created=/^(新增|新建|创建)/.test(a.type||'');
    return `<dl class="ai-chat-field-changes">${fields.map(field=>`<div><dt>${esc(field.label)}</dt><dd>${!a.historical&&!created&&field.before!==undefined?`<div class="ai-chat-before"><small>更改前</small><span>${esc(fieldText(field.before))}</span></div><span class="ai-chat-change-arrow" aria-hidden="true">→</span>`:''}<div class="ai-chat-after"><small>${a.historical?'方案内容':created?'新增内容':'更改后'}</small><span>${esc(fieldText(field.after))}</span></div></dd></div>`).join('')}</dl>`;
  };
  const actionBody=a=>`${a.ledger?ledgerDetails(a):`<strong>${esc(a.title)}</strong>${actionFields(a)}${a.priority?`<p>日期：${esc(a.date||'未设日期')} · 优先级：${esc(a.priority)}</p>`:''}${a.content&&!a.fields?.length?`<details open><summary>查看完整内容</summary><div class="ai-chat-note">${esc(a.content)}</div></details>`:''}${a.fileName?`<p>原始附件：${esc(a.fileName)}</p>`:''}`}`;
  const pastActionsHTML=p=>{
    if(!p.actions?.length)return '';
    try{return `<ol class="ai-chat-actions ai-chat-historical-actions">${p.actions.map(action=>{const item={...describeWorkspaceAction(action),historical:true};return `<li><div class="ai-chat-action-heading">${esc(item.type)} · ${esc(item.destination)}</div>${actionBody(item)}</li>`;}).join('')}</ol><p class="muted small">历史方案仅供回看，执行结果以完成清单为准。</p>`;}
    catch{return '<p>这份历史方案暂时无法展开，原对话仍完整保留。</p>';}
  };
  async function showCapabilities(){
    ctx.modal({title:'AI 目前能做什么',body:'<div class="ai-capabilities" data-ai-capabilities><p role="status">正在读取服务器能力清单…</p></div>'});
    const host=document.querySelector('[data-ai-capabilities]');if(!host)return;
    if(!ctx.cloud?.enabled){host.innerHTML='<p>连接云端工作台后，可查看服务器实际接通的能力。</p>';return;}
    try{
      const value=await ctx.cloud.request('/api/ai/capabilities');if(!alive||!host.isConnected)return;
      const operations={create:'新增',update:'修改',archive:'归档',restore:'恢复'};
      const descriptions={workbenchSettings:'为你的工作台命名。',workbenchModule:'启用、收起、改名并调整模块顺序，已有资料保留。',canvasSettings:'切换画布排列方式与视图。',canvasCard:'调整已存在卡片的位置、大小与颜色。',competition:'管理比赛档案、参赛要求、团队与进度。',competitionMilestone:'按你提供的日期记录报名、提交等截止节点。',competitionTask:'整理比赛准备清单并更新完成情况。',ledgerProject:'项目可独立核算，也可计入总账单。',ledgerEntry:'按你提供的真实金额、日期和账本记录收支。',fitnessEntry:'按你提供的实际运动记录保存时长、里程和热量消耗；未知数值保留为未记录。',englishSession:'学习时长和完成情况以你的实际记录为准。',file:'整理已上传资料的名称和所属位置。'};
      const queryDescriptions={'competitions.summary':'按北京时间汇总比赛节点、临近截止与待完成事项。',search:'按关键词寻找工作台中的已有内容。',get:'阅读指定记录，核对完整内容。','ledger.summary':'按日期、分类或项目计算收支，遵守总账设置。','fitness.summary':'按日、周、月汇总指定运动空间，区分未记录的消耗与已知数值。','calendar.range':'查看一段时间里的计划、标注和注意事项。','timetable.week':'查看指定教学周的课程和上课时间。','english.status':'汇总英语目标、词汇、错题和已记录的学习时长。','file.read':'读取已经上传的资料文字，帮助讨论和整理。'};
      host.innerHTML=`<p class="ai-capabilities-intro">查询资料用于理解你的需求；改动会先列成审核单，点击「确认执行」后才保存。</p><h3>可以操作</h3><div class="ai-capability-list">${(value.capabilities||[]).map(item=>`<section><strong>${esc(item.label)}</strong><span>${(item.operations||[]).map(op=>esc(operations[op]||op)).join(' · ')}</span>${descriptions[item.entity]?`<p>${esc(descriptions[item.entity])}</p>`:''}</section>`).join('')||'<p>服务器暂未提供可执行能力。</p>'}</div>${value.queries?.length?`<h3>可以查询</h3><div class="ai-capability-list">${value.queries.map(item=>`<section><strong>${esc(item.label)}</strong><p>${esc(queryDescriptions[item.kind]||'读取工作台中已有的信息，帮助理解你的需求。')}</p></section>`).join('')}</div>`:''}<h3>暂未接通</h3><div class="ai-capability-list is-unavailable">${(value.unavailable||[]).map(item=>`<section><strong>${esc(item.label)}</strong><p>${esc(item.reason||'尚未接通')}</p></section>`).join('')||'<p>服务器未提供额外连接信息。</p>'}</div>`;
    }catch(error){if(host.isConnected)host.innerHTML=`<p>能力清单暂时无法读取。</p><p class="muted">${esc(error.message||'请稍后重试。')}</p>`;}
  }
  const proposalHTML=p=>{
    let actions;try{actions=previewOrganizedContent(state,active,p);}catch(error){return `<div class="ai-chat-proposal"><strong>方案需要调整</strong><p>${esc(error.message)}</p><button class="btn" data-chat="revise">继续对话</button></div>`;}
    return `<section class="ai-chat-proposal" aria-label="行动审核单"><header><span>${icon('shield',18)}待你审核 · 尚未执行</span><strong>行动目标：${esc(p.title)}</strong></header>${ledgerSummary(actions)}<p>${esc(p.summary)}</p>${p.reason?`<p class="ai-chat-review-reason">方案依据：${esc(p.reason)}</p>`:''}<h3 class="ai-chat-review-title">确认后将执行 ${actions.length} 项操作</h3><ol class="ai-chat-actions">${actions.map((a,i)=>`<li><div class="ai-chat-action-heading"><b>${i+1}</b><span>${esc(a.type)} → ${esc(a.destination)}</span></div>${actionBody(a)}</li>`).join('')}</ol>${actions.length&&actions.every(a=>a.ledger)&&requestNow()?.files?.length?'<p class="ai-chat-ledger-files-note">原始账单附件保留在这段对话中，方便核对。</p>':''}${p.warnings.length?`<p class="ai-chat-warning">需要核对：<br>${p.warnings.map(esc).join('<br>')}</p>`:''}<footer><button class="btn primary" data-chat="confirm" ${busy?'disabled':''}>${icon('check-circle',16)}${busy?'正在执行…':'确认执行这 '+actions.length+' 项操作'}</button><button class="btn" data-chat="revise">继续修改方案</button><span>仅执行上面列出的操作。继续发送消息会使本方案失效，需重新审核。</span></footer></section>`;
  };
  function render(){
    if(!alive)return;
    const request=requestNow(),job=request?jobFor(state,request.id):null,working=jobWorking(job)||!!job?.starting;
    const stage=request?.status==='filed'?3:request?.conversation?.proposal?2:1;
    page.querySelector('[data-chat-count]').textContent=String(state.aiRequests.length);
    page.querySelector('[data-chat-stages]').innerHTML=['对话沟通','审核方案','确认执行'].map((label,i)=>`<span ${stage===i+1?'aria-current=step':''} class="${stage>i+1?'complete':''}"><b>${i+1}</b>${label}</span>`).join('');
    list.innerHTML=state.aiRequests.length?state.aiRequests.map(r=>`<button data-chat="select" data-id="${esc(r.id)}" class="ai-chat-history-item ${r.id===active?'selected':''}" aria-pressed="${r.id===active}"><strong>${esc(r.text||r.files?.[0]?.name||'附件对话')}</strong><span>${r.status==='filed'?'已执行':r.status==='cancelled'?'已暂停':r.conversation?.proposal?'方案待确认':jobWorking(jobFor(state,r.id))?'正在回复':'继续对话'} · ${esc(new Date(r.updatedAt||r.createdAt).toLocaleDateString('zh-CN',{month:'numeric',day:'numeric'}))}</span></button>`).join(''):'<p class="muted small">你的对话会留在这里。</p>';
    const nextTranscript=JSON.stringify([request?.id,request?.status,request?.conversation,request?.receipt,request?.files,busy]);
    if(nextTranscript!==transcriptKey){
      transcriptKey=nextTranscript;
      if(!request)thread.innerHTML=`<div class="ai-chat-welcome"><span>${icon('message',30)}</span><h2>你的想法，我帮你搭起来。</h2><p>告诉我你想管理什么。我可以挑选模块、创建空间和自定义方块，也能制作交互小工具、调整布局、整理资料与待办。每次改动先给你审核，确认后再执行。</p><div class="companion-ideas"><button type="button" data-chat="starter" data-starter="build">搭建一个工作台</button><button type="button" data-chat="starter" data-starter="arrange">调整模块与排列</button><button type="button" data-chat="starter" data-starter="organize">整理资料与待办</button><button type="button" data-chat="starter" data-starter="create">创建方块或小工具</button></div></div>`;
      else {
        const messages=request.conversation?.messages||[{role:'user',text:request.text||'请看看这些附件。'}];
        thread.innerHTML=`<div class="ai-chat-thread-heading"><h2>${esc(request.text?.slice(0,55)||'附件对话')}</h2>${request.conversation?.parentRequestId?'<span>接着上次的话题</span>':''}</div><div class="ai-chat-messages" role="log" aria-label="对话记录">${messages.map(m=>`<article class="ai-chat-message ${m.role}"><span>${m.role==='user'?'你':'宇宙 AI'}</span><div>${esc(m.text)}</div>${m.proposal?`<details class="ai-chat-past-proposal"><summary>查看这一轮方案</summary><div><strong>${esc(m.proposal.title)}</strong><p>${esc(m.proposal.summary)}</p>${pastLedgerHTML(m.proposal)}${pastActionsHTML(m.proposal)}${(m.proposal.notes||[]).map(n=>`<h4>${esc(n.title)}</h4><p>${esc(n.content)}</p>`).join('')}${m.proposal.tasks?.length?`<ul>${m.proposal.tasks.map(t=>`<li>${esc(t.title)}${t.date?' · '+esc(t.date):''}</li>`).join('')}</ul>`:''}</div></details>`:''}</article>`).join('')}</div>${request.files?.length?`<details class="ai-chat-files"><summary>${request.files.length} 个对话附件</summary>${request.files.map(f=>`<button data-chat="download" data-file="${esc(f.id)}">${icon('file',16)}${esc(f.name)}${icon('download',16)}</button>`).join('')}</details>`:''}${request.status==='waiting_model'&&request.conversation?.proposal?proposalHTML(request.conversation.proposal):''}${request.status==='filed'?`<div class="ai-chat-receipt"><strong>${icon('check-circle',18)}已执行 ${request.receipt?.items?.length||0} 项操作 · ${esc(request.receipt?.destinationLabel||'工作区')}</strong><p>这次对话和原始附件已保留。</p><ul class="ai-chat-executed">${(request.receipt?.items||[]).map(item=>`<li>${esc(item.type)} · ${esc(item.title)}</li>`).join('')}</ul><div><button class="btn primary" data-chat="visit">${ledgerTarget(request.receipt?.destinationId)?'打开账本':request.receipt?.destinationId==='workspace'?'回到空间主页':'打开工作区'}</button><button class="btn" data-chat="continue">接着聊</button>${ctx.undoRoute?'<button class="text-btn" data-chat="undo">撤销本次操作</button>':''}</div></div>`:request.status==='cancelled'?'<div class="ai-chat-receipt"><p>对话已暂停，消息和附件仍保留。</p><button class="btn" data-chat="restore">恢复对话</button></div>':''}`;
        requestAnimationFrame(()=>{if(!alive)return;const review=thread.querySelector('.ai-chat-proposal');if(review)thread.scrollTop+=review.getBoundingClientRect().top-thread.getBoundingClientRect().top;else thread.scrollTop=thread.scrollHeight;});
      }
    }
    let message='';
    if(request?.status==='waiting_model'){
      if(job?.status==='checking')message='消息已保存，正在检查 AI 调用条件…';
      else if(working)message=job?.phase==='querying'?'正在查询工作台资料…':job?.phase==='repairing'?'正在校正回复格式（2/2），无需重复发送…':'正在结合前文和附件回复…';
      else if(job?.status==='failed')message=job.error?.message||'回复未完成，可以重试。';
      else if(job?.replyError)message=job.replyError;
      else if(job?.replySaved&&request.conversation?.messages.at(-1)?.role==='user')message='回复已完成，正在同步对话。';
      else if(!cloudAIEnabled(ctx))message='消息保存在本机。进入云端工作台并连接模型后，可以继续这段对话。';
    }
    const needsReply=request?.status==='waiting_model'&&(!request.conversation||request.conversation.messages.at(-1)?.role==='user');
    status.innerHTML=`${message?`<p>${esc(message)}</p>`:''}${needsReply&&cloudAIEnabled(ctx)&&!working?`<button class="btn" data-chat="retry" ${busy?'disabled':''}>${icon('refresh',16)}${job?.status==='failed'?'重试这一轮':'让 AI 回复'}</button>`:''}`;
    if(request?.status==='waiting_model'&&!working&&!request.conversation?.proposal&&manualTarget(request.targetId==='auto'?'inbox':request.targetId))status.insertAdjacentHTML('beforeend','<button class="text-btn ai-chat-manual" data-chat="manual">直接归档原文</button>');
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
    if(action==='starter'){ctx.askAssistant(({build:'请先了解我的用途，帮我搭建适合自己的工作台；根据需要选择模块并创建空间，先给出审核方案。',arrange:'请查看当前工作台，帮我调整模块显示、名称、顺序与画布排列。先了解我常用什么，再给方案。',organize:'我想整理工作台中的资料和待办，请先确认整理范围和目标，再给操作方案。',create:'我想创建一个适合自己的方块或交互小工具。请先了解用途、需要填写的输入、希望得到的输出，以及需要记住的数据。请先给出可审核的方案，等我确认后再创建。'})[button.dataset.starter]||'');return;}
    if(action==='settings'){go('settings');return;}
    if(action==='capabilities'){await showCapabilities();return;}
    if(!request)return;
    try{
      if(action==='download'){const f=request.files?.find(f=>f.id===button.dataset.file);if(f)await downloadAttachment(ctx,f);return;}
      if(action==='visit'){visit(request.receipt?.destinationId||request.targetId,request.receipt);return;}
      if(action==='revise'){composer.querySelector('textarea')?.focus();toast('在输入框里告诉我哪里需要调整，发送后会重新生成审核单。');return;}
      if(action==='retry'){await startAIJob(ctx,request);render();return;}
      if(action==='manual'){
        ctx.modal({title:'直接归档原文',body:`<p>保存你发送过的文字和全部附件。</p><label class="field">归档到<select name="destination">${destinations(state).filter(d=>manualTarget(d.id)).map(d=>`<option value="${esc(d.id)}" ${d.id===(request.targetId==='auto'?'inbox':request.targetId)?'selected':''}>${esc(d.title)}</option>`).join('')}</select></label>`,submitLabel:'确认归档原文',onSubmit:async form=>{
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
        busy=true;render();
        const result=await ctx.confirmAI(jobId);
        toast(result.applied?'已按审核单执行完成。':'已执行完成；期间的新编辑已保留，请加载操作结果。');return;
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
