import {openAIConversation} from './ai.js';
import {VOCABULARY,READINGS,WRITING_PROMPTS,TRANSLATION_PROMPTS} from './english-content.js';
import {getReadingResult,getExerciseDraft,saveReadingAnswer,submitReadingPractice,resetReadingPractice,saveExerciseDraft,saveEnglishPractice} from './english-practice-model.js';
const TYPES = { vocabulary: '词汇', reading: '阅读', listening: '听力', writing: '写作', translation: '翻译' };
export function missingBuiltinWords(en){
  const ids=new Set((en.words||[]).map(word=>word.id)),words=new Set((en.words||[]).map(word=>String(word.word).toLowerCase()));
  return VOCABULARY.map((v,index)=>({id:`builtin-word-${index}`,word:v[0],phonetic:v[1],meaning:v[2],example:v[3],translation:v[4],source:'builtin',status:'new'})).filter(word=>!ids.has(word.id)&&!words.has(word.word.toLowerCase()));
}
export function addBuiltinWords(ctx){
  const additions=missingBuiltinWords(ctx.state.english);if(!additions.length)return 0;
  if((ctx.state.english.words||[]).length+additions.length>100000)throw new Error('词汇数量已达上限，请先整理再添加。');
  saveEnglishPractice(ctx,en=>{en.words=[...(en.words||[]),...additions];});return additions.length;
}
function localDate(date = new Date()) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function seedEnglish(demo = false) {
  const recent = (days) => { const d = new Date(); d.setDate(d.getDate() - days); return localDate(d); };
  return {
    plan: { examDate: '', target: demo ? 550 : '', dailyMinutes: demo ? 30 : '', focus: 'reading' },
    words: VOCABULARY.map((v, i) => ({ id: `builtin-word-${i}`, word: v[0], phonetic: v[1], meaning: v[2], example: v[3], translation: v[4], source: 'builtin', status: demo && i < 2 ? 'mastered' : demo && i === 2 ? 'review' : 'new' })),
    sessions: demo ? [
      { id: 'demo-en-1', date: recent(4), minutes: 20, type: 'reading', note: '演示记录：阅读理解' },
      { id: 'demo-en-2', date: recent(2), minutes: 15, type: 'vocabulary', note: '演示记录：词汇复习' },
      { id: 'demo-en-3', date: recent(1), minutes: 25, type: 'listening', note: '演示记录：听力精听' }
    ] : [],
    readingAnswers: {}, readingResult: null, attempts: [], mistakes: [],
    drafts: { writing: '', translation: '', listening: '' }, audio: null, draftUpdatedAt: {}
  };
}

export function mountEnglish(ctx, initialSection = '') {
  const { root, state, save, esc, icon, toast, modal, go, uid } = ctx;
  if (!state.english) state.english = seedEnglish(state.mode === 'demo');
  const en = state.english;
  en.plan ||= { examDate: '', target: '', dailyMinutes: '', focus: 'reading' };
  en.drafts ||= { writing: '', translation: '', listening: '' };
  en.draftUpdatedAt ||= {};
  en.sessions ||= []; en.words ||= []; en.mistakes ||= []; en.attempts ||= []; en.readingAnswers ||= {};
  let section = ['vocabulary','materials','mistakes','records'].includes(initialSection) ? initialSection : 'practice';
  let exercise = ['reading', 'writing', 'listening', 'translation'].includes(initialSection) ? initialSection : 'reading';
  const selections={reading:READINGS[0].id,writing:WRITING_PROMPTS[0].id,translation:TRANSLATION_PROMPTS[0].id};
  const levels={reading:'all',writing:'all',translation:'all'};
  const catalog=type=>type==='reading'?READINGS:type==='writing'?WRITING_PROMPTS:TRANSLATION_PROMPTS;
  const currentPrompt=type=>catalog(type).find(item=>item.id===selections[type])||catalog(type)[0];
  const draftFor=type=>type==='listening'?{text:en.drafts.listening||'',updatedAt:en.draftUpdatedAt.listening||''}:getExerciseDraft(en,type,currentPrompt(type));
  let flipped = false, wordIndex = 0, wordFilter = 'all';
  let audioUrl = '', audioLoading = false, alive = true;
  const e = (value) => esc(String(value ?? ''));
  const i = (name, size = 20) => icon(({ sliders: 'settings', 'book-open': 'book', 'pen-line': 'edit', pencil: 'edit', 'arrow-up-right': 'arrow-right', languages: 'graduation', 'rotate-cw': 'refresh' })[name] || name, size);
  const persist = () => save();
  const today = () => localDate();
  const wordList = () => en.words.filter(w => !w.archived&&(wordFilter === 'all' || w.status === wordFilter));
  const visibleMistakes=()=>en.mistakes.filter(m=>!m.archived);
  const visibleSessions=()=>en.sessions.filter(s=>!s.archived);
  const dateLabel = (date) => date ? new Date(`${date}T12:00:00`).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' }) : '尚未设置';
  const recentDays = () => Array.from({ length: 7 }, (_, n) => { const d = new Date(); d.setDate(d.getDate() - (6 - n)); return localDate(d); });
  const minutesOn = date => visibleSessions().filter(s => s.date === date).reduce((n, s) => n + Number(s.minutes || 0), 0);
  const completedWords = () => en.words.filter(w => !w.archived&&w.status === 'mastered').length;
  function openCoach(type){
    let text='请结合我的英语学习目标、词汇和学习记录，先和我讨论需要调整什么，再列出学习计划或词汇卡片的行动方案。';
    if(type){const draft=draftFor(type).text;if(!draft.trim()){toast('先写下一些内容，再交给 AI 一起修改。');return;}const prompt=type==='listening'?null:currentPrompt(type),draftId=prompt&&!prompt.legacy?`${type}:${prompt.id}`:type;text=`请检查这份${TYPES[type]||'英语'}草稿，给出具体修改理由。${prompt?`题目：${prompt.title}\n要求：${prompt.prompt}\n`:''}仅针对 englishDraft 编号 ${draftId} 提议修改；不能改其他题目的草稿。先讨论并展示方案，等我审核确认再保存。\n当前草稿：\n${draft}`;}
    try{openAIConversation(ctx,{targetId:'english',text});}catch(error){toast(error.message);}
  }

  function render() {
    if (!alive) return;
    const weekMinutes = recentDays().reduce((n, d) => n + minutesOn(d), 0);
    const dayMinutes = minutesOn(today());
    const target = Number(en.plan.dailyMinutes) || 0;
    const dailyPercent = target ? Math.min(100, Math.round(dayMinutes / target * 100)) : 0;
    const daysLeft = en.plan.examDate ? Math.ceil((new Date(`${en.plan.examDate}T00:00:00`) - new Date(`${today()}T00:00:00`)) / 86400000) : null;
    root.innerHTML = `<div class="english-page english-card-workspace" data-section="${section}">
      <header class="page-head"><div><div class="eyebrow">A LITTLE EVERY DAY</div><h1>英语学习 <span class="english-title-dot"></span></h1><p class="muted">从日常沟通到项目表达，选择适合自己的练习。</p></div><div class="english-head-actions"><button class="btn soft" data-en="coach">${i('sparkles',17)} AI 教练</button><button class="btn soft" data-en="plan">${i('sliders')} 设置学习计划</button></div></header>
      <section class="english-hero">
        <div class="english-hero-copy"><span class="english-kicker">YOUR NEXT CHAPTER · ENGLISH</span><h2>慢慢积累，<br>也在稳稳向前<span>。</span></h2><p>${target ? `每天留出 ${e(target)} 分钟，从一项小练习开始。` : '不用急着填满计划。先从一次感兴趣的练习开始。'}</p><div class="english-goals"><span>目标分数 <b>${en.plan.target ? e(en.plan.target) : '待设置'}</b></span><span>考试日期 <b>${en.plan.examDate ? e(dateLabel(en.plan.examDate)) : '待设置'}</b></span>${daysLeft !== null ? `<span><b>${daysLeft >= 0 ? `还有 ${daysLeft} 天` : '日期已过'}</b></span>` : ''}</div><button class="btn primary" data-en="start">开始今日练习 ${i('arrow-right', 17)}</button></div>
        <div class="english-hero-art" aria-hidden="true"><span class="english-orbit orbit-one"></span><span class="english-orbit orbit-two"></span><span class="english-spark spark-one">✦</span><span class="english-spark spark-two">+</span><div class="english-book"><span class="english-book-line"></span><small>A LITTLE<br>EVERY DAY</small><strong>EN<span>↗</span></strong><span class="english-book-footer">ONE STEP CLOSER ↗</span></div><span class="english-note">Make it a habit.</span></div>
      </section>
      <div class="english-stat-row"><div class="english-stat"><span class="english-stat-icon lilac">${i('clock')}</span><div><small>近 7 天投入</small><strong>${weekMinutes}<em> 分钟</em></strong></div></div><div class="english-stat"><span class="english-stat-icon mint">${i('check')}</span><div><small>已标记掌握</small><strong>${completedWords()}<em> 个单词</em></strong></div></div><div class="english-stat"><span class="english-stat-icon pink">${i('book-open')}</span><div><small>待回顾错题</small><strong>${visibleMistakes().filter(m => !m.reviewed).length}<em> 道</em></strong></div></div></div>
      <div class="english-layout"><div class="english-main"><div class="english-main-tabs" role="tablist" aria-label="英语学习内容">${[['practice', '练习空间'], ['vocabulary', '词汇卡片'], ['mistakes', '错题本'], ['records', '学习记录'], ['materials', '我的资料']].map(([key, label]) => `<button role="tab" aria-selected="${section === key}" class="english-main-tab ${section === key ? 'active' : ''}" data-en="section" data-key="${key}">${label}${key === 'mistakes' && visibleMistakes().length ? `<span>${visibleMistakes().length}</span>` : ''}</button>`).join('')}</div>
      ${section === 'practice' ? renderPractice() : section === 'vocabulary' ? renderVocabulary() : section === 'mistakes' ? renderMistakes() : section === 'materials' ? renderMaterials() : renderRecords()}</div>
      <aside class="english-side"><section class="panel english-today"><span class="english-card-label">TODAY / 今日目标</span><div class="section-head"><h3>今天的小目标</h3><span class="badge">${dateLabel(today())}</span></div><div class="english-progress-row"><div class="english-progress-ring" style="--progress:${dailyPercent * 3.6}deg"><div><strong>${dayMinutes}</strong><span>已记录 / 分钟</span></div></div><div class="english-progress-copy"><strong>${target ? `${target} 分钟` : '按自己的节奏'}</strong><p>${target ? (dayMinutes >= target ? '今天的时长目标已完成' : `距离时长目标还有 ${Math.max(0, target - dayMinutes)} 分钟`) : '每日时长还未设置，可以先练起来。'}</p></div></div><button class="btn soft english-full" data-en="record">${i('plus', 17)} 记录一次学习</button><p class="english-footnote">时长由你手动记录，不会自动累计。</p></section>
      <section class="panel english-week"><span class="english-card-label">PROGRESS / 每周足迹</span><div class="section-head"><h3>近 7 天</h3><span class="muted">分钟</span></div><div class="english-chart" aria-label="近七天学习分钟数">${renderChart()}</div><p class="english-footnote">${weekMinutes ? '每一段投入，都有迹可循。' : '还没有学习记录。你的第一小步会出现在这里。'}</p></section>
      <section class="english-coach"><span class="english-card-label">COACH / 专属教练</span><span class="english-coach-icon">${i('sparkles', 22)}</span><h3>你的 AI 英语教练</h3><p>一起调整学习计划、整理词汇和回顾练习。先讨论，检查行动方案后再确认保存。</p><button class="btn" data-en="coach">和教练聊聊 ${i('arrow-up-right', 16)}</button></section>
      </aside></div></div>`;
    if (section === 'practice' && exercise === 'listening' && en.audio && !audioUrl && !audioLoading) restoreAudio();
  }

  function renderMaterials(){
    const materials=(state.captures||[]).filter(c=>c.category==='英语'&&!c.archived);
    return `<section class="panel english-materials"><div class="section-head"><div><span class="english-card-label">LIBRARY / 资料卡片</span><h3>我的英语资料</h3><p class="muted">从收件台归入这里的原文与文件。</p></div><button class="btn" data-go="ai" data-sub="english">添加资料</button></div>${materials.length?`<div class="english-material-grid">${materials.map((c,index)=>`<article class="material-card" data-kind="${c.blobId?'file':'note'}"><header><span class="english-material-icon">${i(c.blobId?'file':'edit',21)}</span><span class="english-card-label">${c.blobId?'FILE / 原始文件':'NOTE / 原文笔记'}</span><small>${String(index+1).padStart(2,'0')}</small></header><p>${e(c.text||c.fileName||'资料')}</p><footer><small>${e(c.tags||'英语资料')}</small>${c.blobId?`<button class="btn" data-en="material-download" data-id="${e(c.id)}">${i('download',16)}下载原文件</button>`:''}</footer></article>`).join('')}</div>`:'<div class="empty-state"><h3>为你的英语资料留一个位置</h3><p>把文章、学习笔记或文件交给收件台，选择英语资料即可保存到这里。</p></div>'}</section>`;
  }

  function renderChart() {
    const days = recentDays(), max = Math.max(30, ...days.map(minutesOn));
    return days.map((date, index) => { const value = minutesOn(date); return `<div class="english-chart-day ${index === 6 ? 'is-today' : ''}"><span class="english-chart-value">${value || ''}</span><div class="english-chart-track"><div style="height:${value ? Math.max(5, value / max * 100) : 0}%"></div></div><span>${index === 6 ? '今天' : ['日', '一', '二', '三', '四', '五', '六'][new Date(`${date}T12:00:00`).getDay()]}</span></div>`; }).join('');
  }

  function renderPractice() {
    return `<div class="english-practice-types" role="tablist" aria-label="练习类型">${[['reading', 'book-open', '阅读'], ['listening', 'headphones', '听力'], ['writing', 'pen-line', '写作'], ['translation', 'languages', '翻译']].map(([key, name, title]) => `<button class="english-practice-type ${exercise === key ? 'active' : ''}" data-en="exercise" data-key="${key}" role="tab" aria-selected="${exercise === key}">${i(name, 21)}<span>${title}</span></button>`).join('')}</div><section class="panel english-exercise" id="english-exercise" data-exercise="${exercise}">${exercise === 'reading' ? renderReading() : exercise === 'listening' ? renderListening() : renderDraft(exercise)}</section>`;
  }

  function promptPicker(type){
    const items=catalog(type).filter(item=>levels[type]==='all'||item.level===levels[type]);
    return `<div class="english-library-picker"><div><strong>原创题库</strong><small>${type==='reading'?READINGS.length+' 篇 · '+READINGS.reduce((n,item)=>n+item.questions.length,0)+' 道选择题':catalog(type).length+' 道表达练习'} · 各题进度独立保存</small></div><div class="english-library-selects"><label>难度<select data-en-level="${type}" aria-label="${TYPES[type]}难度"><option value="all">全部难度</option>${['基础','进阶','挑战'].map(level=>`<option value="${level}" ${levels[type]===level?'selected':''}>${level}</option>`).join('')}</select></label><label>选择题目<select data-en-prompt="${type}" aria-label="选择${TYPES[type]}题目">${items.map(item=>`<option value="${e(item.id)}" ${item.id===selections[type]?'selected':''}>${e(item.level)} · ${e(item.title)}</option>`).join('')}</select></label></div></div>`;
  }
  function renderReading() {
    const reading=currentPrompt('reading'),result=getReadingResult(en,reading);
    return `${promptPicker('reading')}<div class="english-exercise-head"><div><span class="english-source">原创练习 · ${e(reading.level)} · ${e(reading.topic)} · 非历年真题</span><h2>${e(reading.title)}</h2><p class="muted">${e(reading.subtitle)}</p></div><span class="english-round-icon">${i('book-open',25)}</span></div><div class="english-reading-text" lang="en" data-card-label="READ / 阅读材料">${reading.paragraphs.map((text,n)=>`<p><span>${String(n+1).padStart(2,'0')}</span>${e(text)}</p>`).join('')}</div><div class="english-questions">${reading.questions.map((q,n)=>`<fieldset class="english-question" data-question="${n+1}"><legend><span>${n+1}</span>${e(q.text)}</legend>${q.options.map((text,idx)=>`<label class="english-answer ${result&&idx===q.answer?'is-correct':result&&en.readingAnswers[q.id]===idx?'is-wrong':''}"><input type="radio" name="${e(q.id)}" value="${idx}" data-en-answer="${e(q.id)}" ${en.readingAnswers[q.id]===idx?'checked':''} ${result?'disabled':''}><span class="english-answer-letter">${'ABCD'[idx]}</span><span>${e(text)}</span></label>`).join('')}${result?`<p class="english-explanation"><strong>答案 ${'ABCD'[q.answer]}</strong> ${e(q.explanation)}</p>`:''}</fieldset>`).join('')}</div>${result?`<div class="english-reading-result"><div><strong>答对 ${result.correct} / ${reading.questions.length} 题</strong><p>本地判分 · 仅代表本篇练习结果</p></div><div class="row"><button class="btn soft" data-en="reading-reset">重做本篇</button><button class="btn primary" data-en="reading-next">下一篇</button></div></div>`:`<div class="english-exercise-footer"><span class="muted">答错的题目会自动加入错题本</span><button class="btn primary" data-en="reading-submit">提交并查看解析 ${i('arrow-right',16)}</button></div>`}`;
  }

  function renderDraft(type) {
    const writing=type==='writing',prompt=currentPrompt(type),draft=draftFor(type),text=draft.text;
    const words=text.trim()?text.trim().split(/\s+/).length:0;
    return `${promptPicker(type)}<div class="english-exercise-head"><div><span class="english-source">原创练习 · ${e(prompt.level)} · ${e(prompt.topic)}</span><h2>${e(prompt.title)}</h2><p class="muted">${writing?'表达观点，也练习组织思路。':'先完整表达，再对照参考译文。'}</p></div><span class="english-round-icon">${i(writing?'pen-line':'languages',25)}</span></div><div class="english-prompt" data-card-label="${writing?'WRITE / 写作任务':'TRANSLATE / 翻译任务'}"><strong>${writing?'写作任务':'翻译任务'}</strong><p>${e(prompt.prompt)}</p></div><section class="english-draft-card"><span class="english-card-label">YOUR DRAFT / 本题草稿</span><label class="english-draft-label" for="english-${type}">你的${writing?'文章':'译文'}</label><textarea id="english-${type}" class="english-draft" data-en-draft="${type}" maxlength="100000" placeholder="${writing?'Start with your main idea…':'Write your translation here…'}" spellcheck="true" lang="en">${e(text)}</textarea><div class="english-draft-meta"><span id="english-word-count">${words} 个英文词</span><span id="english-save-status">${draft.updatedAt?'本题草稿已保存':'输入后自动保存本题草稿'}</span></div></section><details class="english-reference"><summary>${writing?'查看写作提示':'查看参考译文与表达提示'}</summary>${writing?'':`<p lang="en">${e(prompt.reference)}</p><small>参考译文并非唯一答案；此处不自动评分。</small>`}<ul>${(writing?prompt.guide:prompt.notes).map(note=>`<li>${e(note)}</li>`).join('')}</ul></details><div class="english-feedback-placeholder">${i('sparkles',18)}<span>把本题草稿交给 AI 讨论修改；保存前先审核。</span><button class="btn compact" data-en="draft-review" data-key="${type}">一起修改</button></div><div class="english-exercise-footer"><button class="btn soft" data-en="draft-export" data-key="${type}">${i('download',16)} 导出草稿</button><button class="btn primary" data-en="draft-save" data-key="${type}">${i('check',16)} 保存草稿</button></div>`;
  }

  function renderListening() {
    return `<div class="english-exercise-head"><div><span class="english-source">使用你有权使用的音频材料</span><h2>留一段时间，认真听</h2><p class="muted">上传音频，边听边记下关键词与疑问。</p></div><span class="english-round-icon">${i('headphones', 25)}</span></div><section class="english-audio-card"><span class="english-card-label">LISTEN / 音频材料</span><label class="english-audio-upload"><input type="file" accept="audio/*,.mp3,.wav,.m4a,.ogg,.aac,.flac,.mp4" data-en-file="audio"><span class="english-audio-icon">${i('upload', 26)}</span><strong>${en.audio ? '更换练习音频' : '选择一段本地音频'}</strong><span>MP3、WAV、M4A 等 · 单个文件不超过 40 MB</span></label>${en.audio ? `<div class="english-audio-file"><strong>${e(en.audio.name)}</strong>${audioUrl ? `<audio controls preload="metadata" src="${e(audioUrl)}"></audio>` : '<p class="muted">音频正在读取；若无法播放，请重新选择本地文件。</p>'}<small>${en.audio.persistent ? '音频保存在本机浏览器，仅此设备可用。' : '音频仅在当前会话可用，刷新后需要重新选择。'}</small></div>` : '<p class="english-footnote">尚未上传音频，不会虚构听力题目或听力成绩。</p>'}</section><section class="english-draft-card"><span class="english-card-label">NOTES / 精听笔记</span><label class="english-draft-label" for="english-listening">听力笔记</label><textarea id="english-listening" class="english-draft listening" data-en-draft="listening" placeholder="听到了什么？哪些单词、句子需要再听一遍？">${e(en.drafts.listening || '')}</textarea></section><div class="english-exercise-footer"><span id="english-save-status" class="muted">${en.draftUpdatedAt.listening ? '笔记已保存在本机' : '输入后自动保存到本机'}</span><button class="btn primary" data-en="record" data-key="listening">记录这次学习</button></div>`;
  }

  function renderVocabulary() {
    const words = wordList();
    wordIndex = Math.min(wordIndex, Math.max(0, words.length - 1));
    const word = words[wordIndex];
    return `<section class="panel english-vocabulary"><div class="section-head"><div><span class="english-card-label">WORDS / 我的词汇</span><h3>把单词，放进语境</h3><p class="muted">先回忆，再翻面。按真实掌握情况标记。</p></div>${missingBuiltinWords(en).length?`<button class="btn soft" data-en="words-builtin">补充内置词汇（${missingBuiltinWords(en).length}）</button>`:''}<button class="btn soft" data-en="word-add">${i('plus', 16)} 添加</button></div><div class="english-word-filters">${[['all', '全部'], ['new', '未学习'], ['review', '待复习'], ['mastered', '已掌握']].map(([key, label]) => `<button data-en="word-filter" data-key="${key}" class="chip ${wordFilter === key ? 'is-active' : ''}">${label}</button>`).join('')}</div>${word ? `<button class="english-word-card ${flipped ? 'is-flipped' : ''}" data-en="word-flip" aria-label="${flipped ? '查看单词正面' : '翻面查看释义'}"><span class="english-word-source">${word.source === 'builtin' ? '内置练习' : '我的词汇'} · ${wordIndex + 1} / ${words.length}</span><strong lang="en">${e(word.word)}</strong>${flipped ? `<span class="english-word-meaning">${e(word.meaning)}</span>${word.example ? `<span class="english-word-example" lang="en">${e(word.example)}</span>` : ''}${word.translation ? `<span class="english-word-translation">${e(word.translation)}</span>` : ''}` : `<span class="english-phonetic">${e(word.phonetic || '试着回忆它的意思')}</span><span class="english-word-invite">${i('rotate-cw', 17)} 点击卡片，查看释义</span>`}</button><div class="english-word-actions"><button class="btn soft" data-en="word-mark" data-status="review" data-id="${e(word.id)}">${i('rotate-cw', 17)} 再复习</button><button class="btn primary" data-en="word-mark" data-status="mastered" data-id="${e(word.id)}">${i('check', 17)} 已掌握</button><button class="icon-btn" data-en="word-next" aria-label="下一张词汇卡片">${i('arrow-right', 20)}</button></div><p class="english-footnote">内置24张通用词汇卡，可继续添加自己的词汇。掌握状态由你自己标记。</p>` : '<div class="empty-state"><h3>这里暂时没有单词</h3><p>切换分类，或添加一个你想记住的词。</p></div>'}</section>`;
  }

  function renderMistakes() {
    return `<section class="panel english-records english-mistakes-board"><div class="section-head"><div><span class="english-card-label">REVISIT / 错题卡片</span><h3>回头看，也是在向前</h3><p class="muted">阅读错题保留原题、你的答案和解析。</p></div><span class="badge">${visibleMistakes().length} 道题</span></div>${visibleMistakes().length ? `<div class="english-mistake-list">${visibleMistakes().slice().reverse().map(m => `<article class="english-mistake" data-reviewed="${!!m.reviewed}"><div class="row"><span class="english-source">${e(m.source || '内置原创阅读')}</span><span class="muted">${e(dateLabel(m.date))}</span></div><h4>${e(m.question)}</h4><p class="english-your-answer">你的答案：${e(m.selected)}</p><p class="english-correct-answer">正确答案：${e(m.correct)}</p><p class="english-explanation">${e(m.explanation)}</p><button class="btn ${m.reviewed ? 'soft' : 'primary'}" data-en="mistake-review" data-id="${e(m.id)}">${i(m.reviewed ? 'rotate-cw' : 'check', 16)} ${m.reviewed ? '已回顾 · 标回待复习' : '标记已回顾'}</button></article>`).join('')}</div>` : `<div class="empty-state english-gentle-empty"><span>${i('book-open', 36)}</span><h3>错题本还是空的</h3><p>完成一篇阅读，答错的题目会在这里等你回顾。</p><button class="btn soft" data-en="exercise" data-key="reading">去做阅读练习</button></div>`}</section>`;
  }

  function renderRecords() {
    return `<section class="panel english-records english-records-board"><div class="section-head"><div><span class="english-card-label">HISTORY / 学习记录</span><h3>那些认真投入的时刻</h3><p class="muted">手动记录学习时长，积累可回看的足迹。</p></div><button class="btn soft" data-en="record">${i('plus', 16)} 记一笔</button></div>${visibleSessions().length ? `<div class="english-session-list">${visibleSessions().slice().sort((a, b) => b.date.localeCompare(a.date)).map(s => `<article class="english-session" data-type="${e(s.type)}"><span class="english-session-dot ${e(s.type)}">${i(s.type === 'listening' ? 'headphones' : s.type === 'vocabulary' ? 'languages' : 'book-open', 20)}</span><div><strong>${e(TYPES[s.type] || s.type)}练习</strong><span>${e(dateLabel(s.date))}${s.note ? ` · ${e(s.note)}` : ''}</span></div><b>${Number(s.minutes)} <small>分钟</small></b><button class="icon-btn" data-en="record-edit" data-id="${e(s.id)}" aria-label="编辑这条学习记录">${i('pencil', 16)}</button></article>`).join('')}</div>` : '<div class="empty-state english-gentle-empty"><h3>从第一条记录开始</h3><p>花了多少时间、练了什么，都由你自己记录。</p><button class="btn soft" data-en="record">记录一次学习</button></div>'}${en.attempts.length ? `<div class="english-attempt-summary"><span class="english-card-label">RESULTS / 阅读记录</span><strong>阅读练习历史</strong>${en.attempts.slice(-5).reverse().map(a => `<p>${e(a.source||'原有阅读练习')} · ${e(dateLabel(a.date))}<span>答对 ${a.correct} / ${a.total} 题</span></p>`).join('')}<small>内置原创题本地判分，不换算为考试成绩。</small></div>` : ''}</section>`;
  }

  function showPlan() {
    modal({ title: '设置英语学习计划', submitLabel: '保存计划', body: `<p class="muted">按你现在的节奏填写；每一项都可以暂时留空。</p><div class="form-grid"><label class="field">考试日期（选填）<input type="date" name="examDate" value="${e(en.plan.examDate)}"></label><label class="field">目标分数（选填）<input type="number" min="0.5" max="9999" step="0.5" name="target" placeholder="自定目标，也可留空" value="${e(en.plan.target)}"></label><label class="field">每日可用时间 / 分钟<input type="number" min="1" max="720" step="1" name="dailyMinutes" placeholder="之后再定也没关系" value="${e(en.plan.dailyMinutes)}"></label><label class="field">优先练习<select name="focus">${Object.entries(TYPES).map(([key, name]) => `<option value="${key}" ${en.plan.focus === key ? 'selected' : ''}>${name}</option>`).join('')}</select></label></div><p class="english-footnote">日期和分数都可留空，用于有考试目标时自行安排；不自动查询考试时间或换算成绩。</p>`, onSubmit(data) {
      en.plan = { examDate: data.get('examDate') || '', target: data.get('target') ? Number(data.get('target')) : '', dailyMinutes: data.get('dailyMinutes') ? Number(data.get('dailyMinutes')) : '', focus: data.get('focus') || 'reading' };
      persist(); render(); toast('学习计划已保存');
    } });
  }

  function showRecord(type, existingId) {
    const existing = en.sessions.find(s => s.id === existingId);
    const selected = existing?.type || type || (section === 'vocabulary' ? 'vocabulary' : exercise);
    modal({ title: existing ? '编辑学习记录' : '记录一次学习', submitLabel: '保存记录', body: `<div class="form-grid"><label class="field">学习日期<input type="date" name="date" value="${e(existing?.date || today())}" max="${today()}" required></label><label class="field">练习内容<select name="type">${Object.entries(TYPES).map(([key, name]) => `<option value="${key}" ${selected === key ? 'selected' : ''}>${name}</option>`).join('')}</select></label><label class="field">实际学习时长 / 分钟<input type="number" name="minutes" min="1" max="720" step="1" placeholder="填写实际投入的分钟数" value="${e(existing?.minutes || '')}" required></label><label class="field">备注，可选<input name="note" maxlength="150" value="${e(existing?.note || '')}" placeholder="例如：精听一段对话"></label></div><p class="english-footnote">只记录实际完成的学习，会同步计入本机的学习回顾。</p>`, onSubmit(data) {
      const value = { id: existing?.id || uid(), date: data.get('date'), type: data.get('type'), minutes: Number(data.get('minutes')), note: String(data.get('note') || '').trim() };
      if (!value.date || value.date > today() || !Number.isInteger(value.minutes) || value.minutes < 1 || value.minutes > 720) { toast('请填写有效日期和 1–720 分钟的时长'); return false; }
      if (existing) Object.assign(existing, value); else en.sessions.push(value);
      persist(); render(); toast('学习记录已保存');
    } });
  }

  function showAddWord() {
    modal({ title: '添加自己的词汇', submitLabel: '加入词汇卡片', body: '<div class="stack"><label class="field">单词或短语<input name="word" maxlength="80" required placeholder="例如：take into account"></label><label class="field">释义<input name="meaning" maxlength="200" required placeholder="你想记住的含义"></label><label class="field">例句，可选<textarea name="example" maxlength="500" rows="3" placeholder="把它放在你熟悉的语境里"></textarea></label></div>', onSubmit(data) {
      const word = String(data.get('word') || '').trim(), meaning = String(data.get('meaning') || '').trim();
      if (!word || !meaning) { toast('请填写单词与释义'); return false; }
      const duplicate=en.words.find(w => w.word.toLowerCase() === word.toLowerCase());if (duplicate) { toast(duplicate.archived?'这个词已归档，可以请 AI 恢复这张词汇卡片。':'这个词已在词汇卡片中'); return false; }
      en.words.push({ id: uid(), word, meaning, example: String(data.get('example') || '').trim(), phonetic: '', translation: '', status: 'new', source: 'personal' });
      wordFilter = 'all'; wordIndex = en.words.length - 1; flipped = false; persist(); render(); toast('新词已加入卡片');
    } });
  }

  function submitReading() {
    try{const reading=currentPrompt('reading'),result=submitReadingPractice(ctx,reading,{date:today(),uid});render();toast(`本次答对 ${result.correct} / ${reading.questions.length} 题，解析已展开`);}catch(error){toast(error.message);}
  }

  function updateDraft(target) {
    const type=target.dataset.enDraft;if(!type)return false;
    try{saveExerciseDraft(ctx,type,type==='listening'?{id:'listening',legacy:true}:currentPrompt(type),target.value,{now:new Date().toISOString()});}
    catch(error){const status=root.querySelector('#english-save-status');if(status)status.textContent='尚未保存，请保留文本并重试';toast(error.message);return false;}
    const count=root.querySelector('#english-word-count'),status=root.querySelector('#english-save-status');
    if(count)count.textContent=`${target.value.trim()?target.value.trim().split(/\s+/).length:0} 个英文词`;
    if(status)status.textContent='本题草稿已保存';return true;
  }

  async function restoreAudio() {
    const blobId = en.audio?.blobId || en.audio?.id;
    if (!ctx.getFile || !blobId || !en.audio.persistent) return;
    audioLoading = true;
    try {
      const stored = await ctx.getFile(blobId);
      const blob = stored instanceof Blob ? stored : stored?.file || stored?.blob;
      if (blob instanceof Blob && alive) { audioUrl = URL.createObjectURL(blob); render(); }
    } catch { if (alive) toast('未能读取本机音频，请重新选择文件'); }
    finally { audioLoading = false; }
  }

  async function uploadAudio(file) {
    if (!file) return;
    if (!file.type.startsWith('audio/') && !/\.(mp3|wav|m4a|ogg|aac|flac|mp4)$/i.test(file.name)) { toast('请选择音频文件'); return; }
    if (file.size > 40 * 1024 * 1024) { toast('请选择不超过 40 MB 的音频'); return; }
    let id = uid(), persistent = false;
    if (ctx.putFile) {
      try { const stored = await ctx.putFile(file); id = typeof stored === 'string' ? stored : stored?.id || stored?.key || id; persistent = !!stored; }
      catch { toast('浏览器未能保存音频，当前会话仍可播放'); }
    }
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    audioUrl = URL.createObjectURL(file);
    en.audio = { blobId: id, name: file.name, size: file.size, persistent };
    persist(); render(); toast(persistent ? '音频已保存在本机' : '音频已加载，可开始播放');
  }

  root.onclick = async (event) => {
    const button = event.target.closest('[data-en]');
    if (!button || !root.contains(button)) return;
    const action = button.dataset.en, key = button.dataset.key;
    if (action === 'material-download') { const file=state.captures.find(c=>c.id===button.dataset.id);try{const blob=await ctx.getFile(file?.blobId);if(!blob)throw new Error('原件已不在当前浏览器，请重新添加。');ctx.download(blob,file.fileName||'英语资料');}catch(error){toast(error.message);}return; }
    if (action === 'plan') return showPlan();
    if (action === 'coach') return openCoach();
    if (action === 'draft-review') return openCoach(key);
    if (action === 'record') return showRecord(key);
    if (action === 'record-edit') return showRecord('', button.dataset.id);
    if (action === 'settings') return go('settings');
    if (action === 'section') { section = key; render(); }
    else if (action === 'exercise') { section = 'practice'; exercise = key; render(); }
    else if (action === 'start') { section = en.plan.focus === 'vocabulary' ? 'vocabulary' : 'practice'; exercise = en.plan.focus === 'vocabulary' ? 'reading' : en.plan.focus || 'reading'; render(); root.querySelector('.english-main')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); }
    else if (action === 'reading-submit') submitReading();
    else if (action === 'reading-reset') { try{resetReadingPractice(ctx,currentPrompt('reading'));render();}catch(error){toast(error.message);} }
    else if(action==='reading-next'){const items=READINGS.filter(item=>levels.reading==='all'||item.level===levels.reading);selections.reading=items[(items.findIndex(item=>item.id===selections.reading)+1)%items.length].id;render();}
    else if (action === 'word-add') showAddWord();
    else if(action==='words-builtin'){try{const count=addBuiltinWords(ctx);render();toast(`已补充 ${count} 张内置词汇卡，原有掌握状态保持不变。`);}catch(error){toast(error.message);}}
    else if (action === 'word-flip') { flipped = !flipped; render(); }
    else if (action === 'word-filter') { wordFilter = key; wordIndex = 0; flipped = false; render(); }
    else if (action === 'word-next') { wordIndex = (wordIndex + 1) % Math.max(1, wordList().length); flipped = false; render(); }
    else if (action === 'word-mark') { const word = en.words.find(w => w.id === button.dataset.id); if (word) { word.status = button.dataset.status; word.updatedAt = new Date().toISOString(); if (wordFilter === 'all') wordIndex = (wordIndex + 1) % Math.max(1, wordList().length); flipped = false; persist(); render(); toast(word.status === 'mastered' ? '已标记掌握，继续下一个' : '已加入待复习'); } }
    else if (action === 'mistake-review') { const mistake = en.mistakes.find(m => m.id === button.dataset.id); if (mistake) { mistake.reviewed = !mistake.reviewed; persist(); render(); } }
    else if (action === 'draft-save') { const input = root.querySelector(`[data-en-draft="${key}"]`); if (input&&updateDraft(input)) toast('本题草稿已保存'); }
    else if (action === 'draft-export') {
      const text = draftFor(key).text;
      if (!text.trim()) return toast('先写下一些内容，再导出草稿');
      const blob = new Blob([`${TYPES[key]}练习草稿\n题目：${key==='listening'?'听力笔记':currentPrompt(key).title}\n${today()}\n来源：内置原创练习，未进行 AI 批改\n\n${text}`], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = `英语-${TYPES[key]}草稿-${today()}.txt`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  };
  root.onchange = (event) => {
    const target = event.target;
    if(target.dataset.enLevel){const type=target.dataset.enLevel;levels[type]=target.value;const items=catalog(type).filter(item=>levels[type]==='all'||item.level===levels[type]);if(!items.some(item=>item.id===selections[type]))selections[type]=items[0].id;render();return;}
    if(target.dataset.enPrompt){const type=target.dataset.enPrompt;if(catalog(type).some(item=>item.id===target.value))selections[type]=target.value;render();return;}
    if(target.dataset.enAnswer){try{saveReadingAnswer(ctx,currentPrompt('reading'),target.dataset.enAnswer,Number(target.value));}catch(error){toast(error.message);render();}}
    if (target.dataset.enDraft) updateDraft(target);
    if (target.dataset.enFile === 'audio') uploadAudio(target.files?.[0]);
  };
  root.oninput = (event) => { if (event.target.dataset.enDraft) updateDraft(event.target); };
  render();
  return () => { alive = false; if (audioUrl) URL.revokeObjectURL(audioUrl); root.onclick = null; root.onchange = null; root.oninput = null; };
}
