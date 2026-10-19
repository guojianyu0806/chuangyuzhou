// Practice progress is stored separately from the source-controlled exercise bank.
const clone=value=>structuredClone(value);
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const DRAFT_TYPES=['writing','translation'];
const object=(value,label)=>{
  if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw new Error(`${label}格式无效。`);
  return value;
};
const identifier=(value,label='练习编号')=>{
  if(typeof value!=='string'||!value.trim()||value.length>512||/[\u0000-\u001f]/.test(value)||['__proto__','prototype','constructor'].includes(value))throw new Error(`${label}无效。`);
  return value;
};
const text=(value,label,maximum=2_000_000)=>{if(typeof value!=='string'||value.length>maximum)throw new Error(`${label}格式无效。`);return value;};
const boundedEntries=(value,label)=>{const entries=Object.entries(object(value,label));if(entries.length>10_000)throw new Error(`${label}数量过多。`);return entries;};
function result(value){
  object(value,'阅读成绩');
  if(Object.keys(value).some(key=>!['correct','total','date'].includes(key))||!Number.isInteger(value.total)||value.total<1||value.total>100_000||!Number.isInteger(value.correct)||value.correct<0||value.correct>value.total)throw new Error('阅读成绩格式无效。');
  return {correct:value.correct,total:value.total,date:text(value.date,'练习日期',100)};
}

/** Validate only the new optional fields; legacy state and AI snapshots remain valid. */
export function validateEnglishPracticeState(en){
  object(en,'英语数据');const clean={};
  if(en.readingResults!==undefined){
    clean.readingResults=Object.fromEntries(boundedEntries(en.readingResults,'分篇阅读成绩').map(([id,value])=>[identifier(id),result(value)]));
  }
  if(en.draftExercises!==undefined){
    const groups=boundedEntries(en.draftExercises,'分题英语草稿');
    if(groups.some(([type])=>!DRAFT_TYPES.includes(type)))throw new Error('分题英语草稿类型无效。');
    clean.draftExercises=Object.fromEntries(groups.map(([type,values])=>[type,Object.fromEntries(boundedEntries(values,'练习草稿').map(([id,value])=>{
      object(value,'练习草稿');
      if(Object.keys(value).some(key=>!['text','updatedAt'].includes(key)))throw new Error('练习草稿字段无效。');
      return [identifier(id),{text:text(value.text,'草稿内容'),updatedAt:text(value.updatedAt,'草稿时间',100)}];
    }))]));
  }
  return clean;
}

function descriptor(value){object(value,'练习');identifier(value.id);return value;}
function draftType(type,prompt){if(!DRAFT_TYPES.includes(type)&&!(type==='listening'&&prompt?.legacy))throw new Error('请选择写作或翻译练习。');return type;}
function reading(value){
  descriptor(value);const ids=new Set();
  if(!Array.isArray(value.questions)||!value.questions.length||value.questions.length>100)throw new Error('阅读题目无效。');
  for(const q of value.questions){
    object(q,'阅读题目');identifier(q.id,'题目编号');
    if(ids.has(q.id))throw new Error('阅读题目编号重复。');ids.add(q.id);
    if(!Array.isArray(q.options)||q.options.length<2||q.options.length>4||q.options.some(option=>typeof option!=='string')||!Number.isInteger(q.answer)||q.answer<0||q.answer>=q.options.length)throw new Error('阅读选项无效。');
    text(q.text,'题目正文');text(q.explanation||'','题目解析');
  }
  return value;
}
const localDate=()=>{const date=new Date();return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;};
const nowValue=now=>typeof now==='function'?now():now||new Date().toISOString();

export function getReadingResult(en,exercise){
  descriptor(exercise);const value=exercise.legacy?en?.readingResult:en?.readingResults?.[exercise.id];
  return value?clone(value):null;
}
export function getExerciseDraft(en,type,prompt){
  draftType(type,prompt);descriptor(prompt);
  if(prompt.legacy)return {text:en?.drafts?.[type]||'',updatedAt:en?.draftUpdatedAt?.[type]||''};
  return clone(en?.draftExercises?.[type]?.[prompt.id]||{text:'',updatedAt:''});
}

/** Restore the captured English object in place: the mounted UI holds its reference. */
export function saveEnglishPractice(ctx,mutation){
  const state=ctx.state,en=object(state.english,'英语数据'),before=clone(en),hadStamp=own(state,'updatedAt'),stamp=state.updatedAt;
  if(ctx.isCurrent?.()===false)throw new Error('当前工作台已更新，请重新打开英语空间。');
  try{const value=mutation(en);validateEnglishPracticeState(en);ctx.save();return value;}
  catch(error){for(const key of Object.keys(en))delete en[key];Object.assign(en,before);state.english=en;if(hadStamp)state.updatedAt=stamp;else delete state.updatedAt;throw error;}
}

export function saveExerciseDraft(ctx,type,prompt,value,{now}={}){
  draftType(type,prompt);descriptor(prompt);text(value,'草稿内容');const updatedAt=text(nowValue(now),'草稿时间',100);
  return saveEnglishPractice(ctx,en=>{
    if(prompt.legacy){en.drafts||={};en.draftUpdatedAt||={};en.drafts[type]=value;en.draftUpdatedAt[type]=updatedAt;}
    else{en.draftExercises||={};en.draftExercises[type]||={};en.draftExercises[type][prompt.id]={text:value,updatedAt};}
    return {text:value,updatedAt};
  });
}

export function saveReadingAnswer(ctx,exercise,questionId,answer){
  reading(exercise);const question=exercise.questions.find(item=>item.id===questionId);
  if(!question||!Number.isInteger(answer)||answer<0||answer>=question.options.length)throw new Error('请选择有效的阅读答案。');
  if(getReadingResult(ctx.state.english,exercise))throw new Error('本篇已批改；先选择重新练习，再修改答案。');
  return saveEnglishPractice(ctx,en=>{en.readingAnswers||={};en.readingAnswers[questionId]=answer;return answer;});
}

export function submitReadingPractice(ctx,exercise,{date=localDate(),uid=ctx.uid||(()=>crypto.randomUUID())}={}){
  reading(exercise);text(date,'练习日期',100);
  const previous=getReadingResult(ctx.state.english,exercise);if(previous)return previous;
  const answers=ctx.state.english.readingAnswers||{};
  if(exercise.questions.some(q=>!Number.isInteger(answers[q.id])||answers[q.id]<0||answers[q.id]>=q.options.length))throw new Error(`先完成本篇全部 ${exercise.questions.length} 道题，再查看解析。`);
  return saveEnglishPractice(ctx,en=>{
    en.mistakes||=[];en.attempts||=[];let correct=0;
    for(const q of exercise.questions){
      const selected=answers[q.id];if(selected===q.answer){correct++;continue;}
      const existing=en.mistakes.find(item=>item.questionId===q.id&&(!item.readingId||item.readingId===exercise.id));
      const value={questionId:q.id,readingId:exercise.id,question:q.text,selected:`${'ABCD'[selected]}. ${q.options[selected]}`,correct:`${'ABCD'[q.answer]}. ${q.options[q.answer]}`,explanation:q.explanation||'',source:`内置原创阅读 · ${exercise.title||exercise.id}`,date,reviewed:false};
      if(existing)Object.assign(existing,value);else en.mistakes.push({id:identifier(uid(),'错题编号'),...value});
    }
    const score={correct,total:exercise.questions.length,date};
    if(exercise.legacy)en.readingResult=score;else{en.readingResults||={};en.readingResults[exercise.id]=score;}
    en.attempts.push({id:identifier(uid(),'练习记录编号'),readingId:exercise.id,source:exercise.title||exercise.id,...score});
    return clone(score);
  });
}

export function resetReadingPractice(ctx,exercise){
  reading(exercise);
  return saveEnglishPractice(ctx,en=>{
    for(const q of exercise.questions)if(en.readingAnswers)delete en.readingAnswers[q.id];
    if(exercise.legacy)en.readingResult=null;else if(en.readingResults)delete en.readingResults[exercise.id];
  });
}
