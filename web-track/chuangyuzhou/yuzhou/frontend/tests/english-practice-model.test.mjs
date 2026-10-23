import test from 'node:test';
import assert from 'node:assert/strict';
import {getReadingResult,getExerciseDraft,saveEnglishPractice,saveReadingAnswer,submitReadingPractice,resetReadingPractice,saveExerciseDraft,validateEnglishPracticeState} from '../src/english-practice-model.js';
import {validateBackup,mergeBackup} from '../src/backup.js';
import {validateWorkspace} from '../../backend/store.mjs';

const stamp='2026-10-09T12:00:00.000Z',date='2026-10-09';
const reading=(id,legacy=false)=>({id,legacy,title:`Reading ${id}`,questions:[0,1,2].map(n=>({id:legacy?`r${n+1}`:`${id}-q${n+1}`,text:`Question ${n+1}`,options:['one','two','three','four'],answer:n,explanation:`Explanation ${n+1}`}))});
const first=reading('original',true),second=reading('community'),third=reading('technology');
const oldPrompt={id:'original-writing',legacy:true},newPrompt={id:'writing-community'};
function fixture({fail=false}={}){
  let uid=0,writes=0;
  const en={plan:{examDate:'',target:550,dailyMinutes:30,focus:'reading'},words:[],sessions:[],mistakes:[],attempts:[],drafts:{writing:'old essay',translation:'old translation',listening:'old notes'},draftUpdatedAt:{writing:stamp},readingAnswers:{r1:0,r2:1,r3:2},readingResult:{correct:3,total:3,date:'2026-09-01'},audio:null};
  const state={schema:1,mode:'personal',profile:{name:'合成测试',major:'',provider:'deepseek'},courses:[],tasks:[],captures:[],english:en,updatedAt:stamp};
  const ctx={state,uid:()=>`test-generated-${++uid}`,save:()=>{writes++;state.updatedAt='save-attempt';if(fail)throw new Error('synthetic save failure');}};
  return {ctx,state,en,writes:()=>writes};
}
const answerAll=(en,exercise,answers=[0,1,2])=>exercise.questions.forEach((q,n)=>{en.readingAnswers[q.id]=answers[n];});
const backup=state=>({format:'lumi-backup',version:1,exportedAt:stamp,state,files:[]});

test('read helpers retain the first exercise aliases and never initialize or rewrite legacy data',()=>{
  const {en}=fixture(),before=structuredClone(en);
  assert.deepEqual(getReadingResult(en,first),en.readingResult);assert.equal(getReadingResult(en,second),null);
  assert.deepEqual(getExerciseDraft(en,'writing',oldPrompt),{text:'old essay',updatedAt:stamp});
  assert.deepEqual(getExerciseDraft(en,'writing',newPrompt),{text:'',updatedAt:''});assert.deepEqual(en,before);
  en.drafts.writing='AI confirmed revision';assert.equal(getExerciseDraft(en,'writing',oldPrompt).text,'AI confirmed revision');
  const result=getReadingResult(en,first);result.correct=0;assert.equal(en.readingResult.correct,3);
});

test('drafts for different prompts, legacy first exercises and listening save independently',()=>{
  const f=fixture();saveExerciseDraft(f.ctx,'writing',newPrompt,'second essay',{now:stamp});
  saveExerciseDraft(f.ctx,'translation',{id:'translation-project'},'second translation',{now:()=>stamp});
  saveExerciseDraft(f.ctx,'writing',oldPrompt,'first essay revised',{now:stamp});
  saveExerciseDraft(f.ctx,'listening',{id:'listening',legacy:true},'listen carefully',{now:stamp});
  assert.equal(f.en.drafts.writing,'first essay revised');assert.equal(f.en.drafts.translation,'old translation');assert.equal(f.en.drafts.listening,'listen carefully');
  assert.deepEqual(f.en.draftExercises,{writing:{'writing-community':{text:'second essay',updatedAt:stamp}},translation:{'translation-project':{text:'second translation',updatedAt:stamp}}});
  assert.equal(f.writes(),4);assert.throws(()=>saveExerciseDraft(f.ctx,'listening',{id:'new-listen'},'bad'),/写作或翻译/);assert.equal(f.writes(),4);
});

test('grading and resetting affect only the selected article and preserve earlier history, mistakes and first-article answers',()=>{
  const f=fixture(),oldResult=structuredClone(f.en.readingResult),oldAnswers=structuredClone(f.en.readingAnswers);
  const existing={id:'old-community-mistake',questionId:second.questions[0].id,question:'Earlier question',selected:'D. four',correct:'A. one',explanation:'Earlier',source:'Earlier source',date:'2026-09-01',reviewed:true};
  f.en.mistakes.push(existing,{id:'other-mistake',questionId:'another-question',question:'Retain',selected:'A',correct:'B',explanation:'Retain',source:'Retain',date:'2026-09-01',reviewed:true});
  const other=structuredClone(f.en.mistakes[1]);f.en.attempts.push({id:'old-attempt',correct:1,total:3,date:'2026-09-01'});
  answerAll(f.en,second,[3,1,2]);answerAll(f.en,third,[0,1,2]);
  const result=submitReadingPractice(f.ctx,second,{date});assert.deepEqual(result,{correct:2,total:3,date});
  assert.equal(f.en.mistakes[0].id,'old-community-mistake');assert.equal(f.en.mistakes[0].readingId,second.id);assert.equal(f.en.mistakes[0].reviewed,false);assert.deepEqual(f.en.mistakes[1],other);
  assert.equal(f.en.attempts.length,2);assert.equal(f.en.attempts[1].readingId,second.id);assert.equal(f.writes(),1);
  assert.deepEqual(submitReadingPractice(f.ctx,second,{date}),result);assert.equal(f.writes(),1,'repeated grading cannot invent another attempt');
  assert.throws(()=>saveReadingAnswer(f.ctx,second,second.questions[0].id,0),/本篇已批改/);
  resetReadingPractice(f.ctx,second);assert.equal(getReadingResult(f.en,second),null);
  assert.deepEqual(f.en.readingResult,oldResult);for(const [id,value] of Object.entries(oldAnswers))assert.equal(f.en.readingAnswers[id],value);
  for(const q of third.questions)assert.equal(f.en.readingAnswers[q.id],q.answer);
  for(const q of second.questions)assert.equal(Object.hasOwn(f.en.readingAnswers,q.id),false);
  assert.equal(f.en.mistakes.length,2);assert.equal(f.en.attempts.length,2);
});

test('legacy first-article redo keeps new results and grades through the unchanged readingResult field',()=>{
  const f=fixture();f.en.readingResults={[second.id]:{correct:1,total:3,date}};
  resetReadingPractice(f.ctx,first);assert.equal(f.en.readingResult,null);assert.deepEqual(f.en.readingResults,{[second.id]:{correct:1,total:3,date}});
  first.questions.forEach(q=>saveReadingAnswer(f.ctx,first,q.id,q.answer));
  assert.deepEqual(submitReadingPractice(f.ctx,first,{date}),{correct:3,total:3,date});
  assert.deepEqual(f.en.readingResult,{correct:3,total:3,date});assert.equal(Object.hasOwn(f.en.readingResults,first.id),false);
});

test('incomplete or out-of-range answers fail before saving or adding a result',()=>{
  const f=fixture(),before=structuredClone(f.state);
  assert.throws(()=>submitReadingPractice(f.ctx,second,{date}),/全部 3 道题/);
  for(const answer of [-1,4,NaN,1.2,'1'])assert.throws(()=>saveReadingAnswer(f.ctx,second,second.questions[0].id,answer),/有效的阅读答案/);
  assert.throws(()=>saveReadingAnswer(f.ctx,second,'not-this-article',1),/有效的阅读答案/);
  assert.deepEqual(f.state,before);assert.equal(f.writes(),0);
});

test('save failures restore every English field and timestamp while retaining the mounted English object',()=>{
  for(const operation of [f=>saveExerciseDraft(f.ctx,'writing',newPrompt,'changed',{now:stamp}),f=>saveExerciseDraft(f.ctx,'writing',oldPrompt,'changed',{now:stamp}),f=>saveReadingAnswer(f.ctx,second,second.questions[0].id,1),f=>submitReadingPractice(f.ctx,second,{date}),f=>resetReadingPractice(f.ctx,first),f=>saveEnglishPractice(f.ctx,en=>{en.words.push({id:'temporary-word'});})]){
    const f=fixture({fail:true});answerAll(f.en,second,[3,1,2]);const before=structuredClone(f.state),reference=f.en;
    assert.throws(()=>operation(f),/synthetic save failure/);assert.equal(f.state.english,reference);assert.deepEqual(f.state,before);
  }
  const f=fixture({fail:true});delete f.state.updatedAt;assert.throws(()=>saveExerciseDraft(f.ctx,'translation',{id:'new'},'draft',{now:stamp}));assert.equal(Object.hasOwn(f.state,'updatedAt'),false);
});

test('backup roundtrip and server validation retain new result/draft maps and their article metadata',()=>{
  const f=fixture();answerAll(f.en,second,[3,1,2]);submitReadingPractice(f.ctx,second,{date});saveExerciseDraft(f.ctx,'writing',newPrompt,'new essay',{now:stamp});
  const before=structuredClone(f.state),checked=validateBackup(backup(f.state));
  assert.deepEqual(checked.state.english.readingResults,f.en.readingResults);assert.deepEqual(checked.state.english.draftExercises,f.en.draftExercises);
  assert.deepEqual(checked.state.english.attempts,f.en.attempts);assert.deepEqual(checked.state.english.mistakes,f.en.mistakes);
  assert.deepEqual(checked.state.english.readingAnswers,f.en.readingAnswers);assert.deepEqual(f.state,before);assert.doesNotThrow(()=>validateWorkspace(checked.state));
  const fresh=fixture().state,merged=mergeBackup(fresh,checked).state;
  assert.deepEqual(merged.english.readingResults,f.en.readingResults);assert.deepEqual(merged.english.draftExercises,f.en.draftExercises);
  const legacy=fixture().state;assert.equal(Object.hasOwn(validateBackup(backup(legacy)).state.english,'readingResults'),false);assert.doesNotThrow(()=>validateWorkspace(legacy));
});

test('additive backup merge keeps current prompt text/results and preserves conflicting imported content exactly once',()=>{
  const current=fixture().state,incoming=fixture().state;
  current.english.draftExercises={writing:{shared:{text:'Current essay',updatedAt:stamp},cleared:{text:'',updatedAt:stamp}}};
  incoming.english.draftExercises={writing:{shared:{text:'Older essay',updatedAt:'old'},cleared:{text:'Restore only as a copy',updatedAt:'old'},new:{text:'New prompt text',updatedAt:'old'}},translation:{new:{text:'A translation',updatedAt:'old'}}};
  current.english.readingResults={shared:{correct:3,total:3,date}};incoming.english.readingResults={shared:{correct:1,total:3,date:'2026-09-01'},added:{correct:2,total:3,date}};
  current.english.readingAnswers['shared-q1']=1;incoming.english.readingAnswers['shared-q1']=2;incoming.english.readingAnswers['added-q1']=0;
  const before=structuredClone(current),merged=mergeBackup(current,incoming);
  assert.equal(merged.state.english.draftExercises.writing.shared.text,'Current essay');assert.equal(merged.state.english.draftExercises.writing.cleared.text,'');
  assert.equal(merged.state.english.draftExercises.writing.new.text,'New prompt text');assert.equal(merged.state.english.readingResults.shared.correct,3);
  assert.ok(merged.state.english.attempts.some(item=>item.readingId==='shared'&&item.correct===1));assert.equal(merged.state.english.readingResults.added.correct,2);
  assert.equal(merged.state.english.readingAnswers['shared-q1'],1);assert.equal(merged.state.english.readingAnswers['added-q1'],0);
  assert.ok(merged.state.captures.some(item=>item.text==='Older essay'));assert.ok(merged.state.captures.some(item=>item.text==='Restore only as a copy'));
  assert.ok(merged.state.captures.some(item=>item.importedDraftKey==='shared-q1'&&item.text.includes('C')));
  assert.deepEqual(current,before);assert.equal(mergeBackup(merged.state,incoming).count,0);
  assert.deepEqual(mergeBackup(merged.state,fixture().state).state.english.draftExercises,merged.state.english.draftExercises);
  assert.doesNotThrow(()=>validateBackup(backup(merged.state)));
});

test('new practice maps reject malformed records and dangerous keys at both import and server boundaries',()=>{
  const bad=[{readingResults:[]},{readingResults:{bad:{correct:4,total:3,date}}},{readingResults:{bad:{correct:1,total:3,date,html:'bad'}}},{draftExercises:{listening:{}}},{draftExercises:{writing:{bad:{text:5,updatedAt:stamp}}}},{draftExercises:{writing:{bad:{text:'x',updatedAt:stamp,html:'bad'}}}},JSON.parse('{"readingResults":{"__proto__":{"correct":1,"total":3,"date":""}}}')];
  for(const addition of bad){
    const {state}=fixture();Object.assign(state.english,addition);
    assert.throws(()=>validateEnglishPracticeState(state.english));assert.throws(()=>validateBackup(backup(state)));assert.throws(()=>validateWorkspace(state));
  }
});

test('backup accepts legacy zero and integer targets as well as optional new half-point targets',()=>{
  for(const target of ['',0,.5,6.5,550,710,9999]){const {state}=fixture();state.english.plan.target=target;assert.equal(validateBackup(backup(state)).state.english.plan.target,target);}
  for(const target of [-1,.25,6.25,9999.5,Infinity,'6.5']){const {state}=fixture();state.english.plan.target=target;assert.throws(()=>validateBackup(backup(state)),/目标分数/);}
});
