import test from 'node:test';
import assert from 'node:assert/strict';
import {WRITING_PROMPTS,TRANSLATION_PROMPTS} from '../src/english-content.js';
import {seedEnglish} from '../src/english.js';
import {applyWorkspaceActions,previewWorkspaceActions,undoWorkspaceActions} from '../src/workspace-actions.js';
import {validateBackup} from '../src/backup.js';
import {runWorkspaceQuery,workspaceFingerprint} from '../../backend/workspace-queries.mjs';

const NOW='2026-10-09T08:00:00.000Z';
const writing=WRITING_PROMPTS.filter(row=>!row.legacy),translation=TRANSLATION_PROMPTS.filter(row=>!row.legacy);
const draftId=(type,prompt)=>`${type}:${prompt.id}`;
const action=(id,content)=>({entity:'englishDraft',operation:'update',id,data:{content}});
function fixture(){
  const english=seedEnglish(false);english.drafts={writing:'旧首题写作',translation:'旧首题翻译',listening:'旧听力笔记'};
  return {schema:1,mode:'personal',profile:{name:'合成验证',major:'',provider:'deepseek'},spaces:[],courses:[],tasks:[],captures:[],aiRequests:[],english,updatedAt:NOW};
}
function apply(state,actions){let index=0;return applyWorkspaceActions(state,'draft-slots',actions,{now:NOW,uid:()=>`draft-receipt-${++index}`});}
const undo=(state,receipt)=>undoWorkspaceActions({state,save:()=>{}},receipt,'draft-slots');

test('known exercise drafts are discoverable by real title and ID without creating empty slots or changing the fingerprint',async()=>{
  const state=fixture(),before=structuredClone(state),fingerprint=workspaceFingerprint(state),id=draftId('writing',writing[0]);
  const result=await runWorkspaceQuery(state,{kind:'search',entity:'englishDraft',text:writing[0].title});
  assert.ok(result.items.some(row=>row.id===id&&row.title.includes(writing[0].title)));
  const selected=await runWorkspaceQuery(state,{kind:'get',entity:'englishDraft',id});
  assert.equal(selected.id,id);assert.deepEqual(selected.record,{content:'',updatedAt:''});
  const original=await runWorkspaceQuery(state,{kind:'get',entity:'englishDraft',id:'writing'});
  assert.equal(original.record.content,'旧首题写作');assert.ok(original.title.includes(WRITING_PROMPTS.find(row=>row.legacy).title));
  assert.deepEqual(state,before);assert.equal(workspaceFingerprint(state),fingerprint);
});

test('reviewed multi-exercise actions save and back up only their selected drafts and undo missing slots cleanly',async()=>{
  const state=fixture(),before=structuredClone(state.english),actions=[
    action(draftId('writing',writing[0]),'Appointment draft.'),
    action(draftId('writing',writing[1]),'Invitation draft.'),
    action(draftId('translation',translation[0]),'Change-of-plan translation.'),
  ];
  const preview=previewWorkspaceActions(state,actions,{now:NOW});assert.equal(preview.length,3);assert.deepEqual(state.english,before);
  const receipt=apply(state,actions);
  assert.equal(state.english.draftExercises.writing[writing[0].id].text,'Appointment draft.');
  assert.equal(state.english.draftExercises.writing[writing[1].id].text,'Invitation draft.');
  assert.equal(state.english.draftExercises.translation[translation[0].id].text,'Change-of-plan translation.');
  assert.deepEqual(state.english.drafts,before.drafts);
  const restored=validateBackup({format:'lumi-backup',version:1,exportedAt:NOW,state,files:[]}).state;
  assert.deepEqual(restored.english.draftExercises,state.english.draftExercises);
  assert.deepEqual(await undo(state,receipt),{removed:3,retained:0});
  assert.equal(state.english.draftExercises,undefined);assert.deepEqual(state.english.drafts,before.drafts);
  assert.deepEqual(state.english.sessions,before.sessions);assert.deepEqual(state.english.attempts,before.attempts);
});

test('later manual edits block undo only for the changed exercise and never overwrite a different draft',async()=>{
  const state=fixture(),first=draftId('writing',writing[0]),second=draftId('writing',writing[1]);
  const receipt=apply(state,[action(first,'AI first draft.'),action(second,'AI second draft.')]);
  state.english.draftExercises.writing[writing[0].id]={text:'Later manual revision.',updatedAt:'2026-10-09T09:00:00.000Z'};
  state.english.draftExercises.translation={[translation[1].id]:{text:'Unrelated translation.',updatedAt:NOW}};
  assert.deepEqual(await undo(state,receipt),{removed:1,retained:1});
  assert.equal(state.english.draftExercises.writing[writing[0].id].text,'Later manual revision.');
  assert.equal(state.english.draftExercises.writing[writing[1].id],undefined);
  assert.equal(state.english.draftExercises.translation[translation[1].id].text,'Unrelated translation.');
  assert.equal(state.english.drafts.writing,'旧首题写作');
});

test('legacy first exercises and listening keep their existing IDs while unknown or disguised targets are rejected atomically',async()=>{
  const state=fixture(),before=structuredClone(state);
  for(const id of ['writing:missing-exercise','translation:__proto__',`writing:${WRITING_PROMPTS.find(row=>row.legacy).id}`]){
    assert.throws(()=>apply(state,[action(draftId('writing',writing[0]),'Must roll back.'),action(id,'Invalid target.')]));
    assert.deepEqual(state,before);
  }
  const receipt=apply(state,[action('writing','New legacy essay.'),action('translation','New legacy translation.'),action('listening','New listening note.')]);
  assert.deepEqual(state.english.drafts,{writing:'New legacy essay.',translation:'New legacy translation.',listening:'New listening note.'});
  assert.equal(state.english.draftExercises,undefined);
  assert.deepEqual(await undo(state,receipt),{removed:3,retained:0});assert.deepEqual(state.english.drafts,before.english.drafts);
});
