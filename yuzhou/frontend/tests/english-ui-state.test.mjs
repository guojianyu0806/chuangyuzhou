import test from 'node:test';
import assert from 'node:assert/strict';
import {mountEnglish,seedEnglish,missingBuiltinWords,addBuiltinWords} from '../src/english.js';
import {READINGS,WRITING_PROMPTS,TRANSLATION_PROMPTS,VOCABULARY} from '../src/english-content.js';

const stamp='2026-10-09T09:00:00.000Z';
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
function fixture(t,section='reading'){
  const state={mode:'personal',english:seedEnglish(false),captures:[],aiRequests:[],aiDraft:{text:'',files:[],targetId:'auto'},updatedAt:stamp};
  state.english.drafts.writing='Original technology draft.';state.english.drafts.translation='Original digital learning translation.';
  state.english.draftUpdatedAt={writing:stamp,translation:stamp};
  const messages=[],navigations=[],status={textContent:''},count={textContent:''},saves=[];let serial=0;
  const root={innerHTML:'',contains:()=>true,querySelector:selector=>selector==='#english-save-status'?status:selector==='#english-word-count'?count:null};
  const ctx={state,root,esc:escape,icon:()=>'',toast:message=>messages.push(message),go:(...args)=>navigations.push(args),modal(){throw new Error('unexpected dialog');},uid:()=>`english-ui-${++serial}`,save(){saves.push(structuredClone(state));state.updatedAt='saved';},isCurrent:()=>true};
  const cleanup=mountEnglish(ctx,section);t.after(cleanup);
  const change=(dataset,value)=>root.onchange({target:{dataset,value}});
  const input=(type,value)=>root.oninput({target:{dataset:{enDraft:type},value}});
  const click=async(action,key,extra={})=>{const button={dataset:{en:action,key,...extra}};await root.onclick({target:{closest:()=>button}});};
  const textarea=type=>root.innerHTML.match(new RegExp(`<textarea[^>]+data-en-draft="${type}"[^>]*>([\\s\\S]*?)<\\/textarea>`))?.[1];
  return {state,ctx,root,saves,messages,navigations,status,change,input,click,textarea};
}

test('reading difficulty and article switches do not save or apply another article’s answers and result',async t=>{
  const ui=fixture(t),legacy=READINGS[0],basic=READINGS.filter(item=>item.level==='基础');
  ui.state.english.readingAnswers[legacy.questions[0].id]=legacy.questions[0].answer;
  ui.state.english.readingResult={correct:1,total:3,date:'2026-10-08'};
  const before=structuredClone(ui.state);
  ui.change({enLevel:'reading'},'基础');assert.ok(ui.root.innerHTML.includes(`<h2>${escape(basic[0].title)}</h2>`));
  ui.change({enPrompt:'reading'},basic[1].id);
  assert.equal(ui.saves.length,0);assert.deepEqual(ui.state,before);assert.ok(!ui.root.innerHTML.includes('本地判分 · 仅代表本篇练习结果'));
  const question=basic[1].questions[0];ui.change({enAnswer:question.id},String(question.answer));
  assert.equal(ui.saves.length,1);assert.equal(ui.state.english.readingAnswers[question.id],question.answer);
  ui.change({enLevel:'reading'},'进阶');ui.change({enPrompt:'reading'},legacy.id);
  assert.equal(ui.saves.length,1);assert.deepEqual(ui.state.english.readingResult,before.english.readingResult);
  assert.ok(ui.root.innerHTML.includes(`data-en-answer="${legacy.questions[0].id}" checked disabled`));
  ui.change({enLevel:'reading'},'基础');assert.ok(!ui.root.innerHTML.includes(`data-en-answer="${question.id}"`));
  ui.change({enPrompt:'reading'},basic[1].id);
  assert.ok(ui.root.innerHTML.includes(`data-en-answer="${question.id}" checked`));
  assert.equal(ui.state.english.readingResults,undefined);assert.equal(ui.saves.length,1);
  assert.deepEqual(ui.state.english.attempts,[]);assert.deepEqual(ui.state.english.mistakes,[]);
});

test('writing input survives switching between new questions and the original draft without cross-writing',t=>{
  const ui=fixture(t,'writing'),first=WRITING_PROMPTS[1],second=WRITING_PROMPTS[2],legacyDraft=structuredClone(ui.state.english.drafts),legacyDates=structuredClone(ui.state.english.draftUpdatedAt);
  ui.change({enPrompt:'writing'},first.id);assert.equal(ui.textarea('writing'),'');assert.equal(ui.saves.length,0);
  ui.input('writing','Could we meet on Saturday instead?');assert.equal(ui.saves.length,1);
  ui.change({enPrompt:'writing'},second.id);assert.equal(ui.textarea('writing'),'');
  ui.input('writing','Would you like to practise our presentation?');assert.equal(ui.saves.length,2);
  ui.change({enPrompt:'writing'},WRITING_PROMPTS[0].id);assert.equal(ui.textarea('writing'),legacyDraft.writing);
  ui.change({enPrompt:'writing'},first.id);assert.equal(ui.textarea('writing'),'Could we meet on Saturday instead?');
  ui.change({enPrompt:'writing'},second.id);assert.equal(ui.textarea('writing'),'Would you like to practise our presentation?');
  assert.deepEqual(ui.state.english.drafts,legacyDraft);assert.deepEqual(ui.state.english.draftUpdatedAt,legacyDates);
  assert.deepEqual(Object.keys(ui.state.english.draftExercises.writing).sort(),[first.id,second.id].sort());
  assert.equal(ui.state.english.draftExercises.translation,undefined);assert.equal(ui.saves.length,2);
});

test('review prepares an unsent AI draft for the selected English exercise and preserves other drafts',async t=>{
  const ui=fixture(t,'translation'),prompt=TRANSLATION_PROMPTS[1];let requests=0;
  const original=Object.getOwnPropertyDescriptor(globalThis,'fetch');Object.defineProperty(globalThis,'fetch',{configurable:true,value:()=>{requests++;throw new Error('model must not be called');}});
  t.after(()=>{if(original)Object.defineProperty(globalThis,'fetch',original);else delete globalThis.fetch;});
  ui.change({enPrompt:'translation'},prompt.id);ui.input('translation','Could we meet on Saturday morning instead?');
  const englishBefore=structuredClone(ui.state.english),savedBefore=ui.saves.length;
  await ui.click('draft-review','translation');
  assert.equal(requests,0);assert.equal(ui.saves.length,savedBefore+1);assert.equal(ui.state.aiDraft.targetId,'english');
  assert.ok(ui.state.aiDraft.text.includes(`englishDraft 编号 translation:${prompt.id}`));
  assert.ok(ui.state.aiDraft.text.includes(prompt.prompt));assert.ok(ui.state.aiDraft.text.includes('Could we meet on Saturday morning instead?'));
  assert.deepEqual(ui.state.english,englishBefore);assert.deepEqual(ui.state.aiRequests,[]);assert.deepEqual(ui.navigations.at(-1),['ai','english']);
  const firstDraft=structuredClone(ui.state.aiDraft);ui.change({enPrompt:'translation'},TRANSLATION_PROMPTS[0].id);
  await ui.click('draft-review','translation');
  assert.deepEqual(ui.state.aiDraft,firstDraft);assert.equal(ui.saves.length,savedBefore+1);assert.equal(requests,0);
  assert.ok(ui.messages.some(message=>message.includes('保留你尚未发送的草稿')));
});

function legacyWords(){
  const en=seedEnglish(false);en.words=en.words.slice(0,6);
  en.words[0].status='mastered';en.words[0].updatedAt=stamp;
  en.words[1].status='review';en.words[1].meaning='我补充的旧释义';
  en.words[2].archived=true;
  en.words.push({id:'my-confirm',word:'CONFIRM',phonetic:'',meaning:'我自己整理的确认',example:'My own example.',translation:'自定义译文',source:'personal',status:'mastered',archived:true});
  en.words.push({id:'my-phrase',word:'take a break',phonetic:'',meaning:'休息一下',example:'',translation:'',source:'personal',status:'review'});
  return en;
}

test('supplementing built-in vocabulary preserves edited, mastered, custom and archived words with one save',()=>{
  const english=legacyWords(),before=structuredClone(english),state={english,updatedAt:stamp},snapshots=[];
  const additions=missingBuiltinWords(english);assert.deepEqual(english,before);assert.equal(additions.length,17);
  assert.ok(additions.every(word=>word.status==='new'&&word.source==='builtin'&&word.word!=='confirm'));
  const count=addBuiltinWords({state,save:()=>snapshots.push(structuredClone(state))});
  assert.equal(count,17);assert.equal(snapshots.length,1);assert.equal(state.english,english);
  assert.deepEqual(english.words.slice(0,before.words.length),before.words);
  assert.equal(english.words.filter(word=>word.word.toLowerCase()==='confirm').length,1);
  assert.equal(english.words.find(word=>word.id==='builtin-word-2').archived,true);
  assert.equal(missingBuiltinWords(english).length,0);
  assert.equal(addBuiltinWords({state,save:()=>snapshots.push(structuredClone(state))}),0);assert.equal(snapshots.length,1);
  assert.equal(english.words.length,before.words.length+VOCABULARY.length-7);
});

test('a failed vocabulary supplement restores the mounted English object and old timestamp before retry',()=>{
  const english=legacyWords(),state={english,updatedAt:stamp},before=structuredClone(state);let calls=0;
  assert.throws(()=>addBuiltinWords({state,save:()=>{calls++;state.updatedAt='failed';throw new DOMException('synthetic quota','QuotaExceededError');}}),{name:'QuotaExceededError'});
  assert.equal(calls,1);assert.equal(state.english,english);assert.deepEqual(state,before);
  assert.equal(missingBuiltinWords(state.english).length,17);
  assert.equal(addBuiltinWords({state,save:()=>calls++}),17);assert.equal(calls,2);
  assert.deepEqual(state.english.words.slice(0,before.english.words.length),before.english.words);
});
