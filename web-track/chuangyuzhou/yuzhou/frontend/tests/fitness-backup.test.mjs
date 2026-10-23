import test from 'node:test';
import assert from 'node:assert/strict';
import {validateBackup,mergeBackup} from '../src/backup.js';

const stamp='2026-09-22T08:00:00.000Z';
const space=()=>({id:'sport',title:'运动健身',description:'自己的运动记录',type:'blank',color:'#7950f2',icon:'target',archived:false,
  notes:[{id:'sport-note',title:'训练笔记',content:'保留原来的笔记',revisions:[]}],
  files:[{id:'sport-file',blobId:'sport-blob',name:'training.txt',size:3,type:'text/plain',createdAt:stamp}]});
const entry=(id='fitness-1')=>({id,spaceId:'sport',date:'2026-09-22',activity:'跑步',minutes:35,distanceKm:5.2,caloriesKcal:null,note:'学校操场',
  source:'manual',archived:false,color:'#7950f2',createdAt:stamp,updatedAt:stamp});
const state=()=>({schema:1,mode:'personal',profile:{},english:{},courses:[],tasks:[],captures:[],spaces:[space()],
  ledger:{version:1,currency:'CNY',projects:[],entries:[]},updatedAt:stamp});
const backup=value=>({format:'lumi-backup',version:1,state:value,files:[{id:'sport-blob',type:'text/plain',data:'data:text/plain;base64,YWJj'}]});

test('fitness backup roundtrip retains space settings, reference IDs, metric nulls and device origin',()=>{
  const input=state();input.spaces[0].type='fitness';input.spaces[0].fitnessEnabled=true;
  input.fitness={version:1,entries:[entry(),{...entry('fitness-2'),date:'2026-09-21',activity:'力量训练',source:'device',distanceKm:null,caloriesKcal:123.5,archived:true}]};
  const expected=structuredClone(input),normalized=validateBackup(backup(input));
  assert.deepEqual(normalized.state.fitness,input.fitness);
  assert.equal(normalized.state.spaces[0].type,'fitness');assert.equal(normalized.state.spaces[0].fitnessEnabled,true);
  assert.equal(normalized.state.spaces[0].notes[0].content,'保留原来的笔记');
  assert.equal(normalized.state.spaces[0].files[0].blobId,'sport-blob');
  assert.deepEqual(normalized.state.ledger,input.ledger);
  assert.deepEqual(validateBackup(JSON.parse(JSON.stringify(normalized))).state.fitness,input.fitness);
  assert.deepEqual(input,expected,'validation does not mutate the input');
});

test('legacy/partial states remain valid, omitted fitness is not initialized and empty fitness is retained',()=>{
  const input=state();delete input.spaces;
  assert.equal(Object.hasOwn(validateBackup(backup(input)).state,'fitness'),false);
  input.fitness={version:1,entries:[]};
  assert.deepEqual(validateBackup(backup(input)).state.fitness,input.fitness);
  assert.deepEqual(mergeBackup(state(),input).state.fitness,input.fitness);
  const withField=state();withField.spaces[0].fitnessEnabled=false;
  assert.equal(validateBackup(backup(withField)).state.spaces[0].fitnessEnabled,false);
});

test('fitness backup accepts archived spaces but rejects missing references and invalid feature flags',()=>{
  const input=state();input.spaces[0].archived=true;input.fitness={version:1,entries:[entry()]};
  assert.doesNotThrow(()=>validateBackup(backup(input)));
  for(const change of [
    value=>{value.fitness.entries[0].spaceId='missing';},
    value=>{delete value.spaces;},
    value=>{value.spaces[0].fitnessEnabled='true';},
    value=>{value.fitness.entries[0].minutes=-1;},
    value=>{value.fitness.entries[0].date='2026-02-30';},
    value=>{value.fitness.entries[0].distanceKm='5';},
    value=>{value.fitness.entries.push({...entry()});},
  ]) {const invalid=structuredClone(input);change(invalid);assert.throws(()=>validateBackup(backup(invalid)));}
  input.fitness.entries[0].spaceId='missing';input.fitness.entries[0].archived=true;
  assert.throws(()=>validateBackup(backup(input)),/关联工作区/,'archiving a record does not legalize an unknown space reference');
});

test('fitness import merges by ID, keeps current edits and is idempotent without touching notes/files/ledger',()=>{
  const current=state();current.spaces[0].fitnessEnabled=true;current.fitness={version:1,entries:[entry()]};
  const incoming=structuredClone(current);incoming.fitness.entries[0].minutes=88;incoming.fitness.entries[0].note='旧备份里的备注';
  incoming.fitness.entries.push({...entry('fitness-2'),minutes:15,activity:'拉伸',distanceKm:null});
  const before=structuredClone(current),result=mergeBackup(current,validateBackup(backup(incoming)));
  assert.equal(result.count,1);assert.equal(result.state.fitness.entries.length,2);
  assert.equal(result.state.fitness.entries[0].minutes,35);assert.equal(result.state.fitness.entries[0].note,'学校操场');
  assert.deepEqual(result.state.spaces,current.spaces);assert.deepEqual(result.state.ledger,current.ledger);
  assert.deepEqual(current,before,'merge keeps caller state intact');
  assert.equal(mergeBackup(result.state,incoming).count,0);
  assert.deepEqual(mergeBackup(result.state,incoming).state.fitness,result.state.fitness);
});

test('fitness import preserves explicit activation and fills only absent activation flags',()=>{
  const incoming=state();incoming.spaces[0].fitnessEnabled=true;incoming.fitness={version:1,entries:[entry()]};
  const legacy=state();const merged=mergeBackup(legacy,incoming);
  assert.equal(merged.state.spaces[0].fitnessEnabled,true);
  assert.equal(merged.state.spaces[0].type,'blank','existing space template is preserved');
  assert.equal(merged.state.fitness.entries[0].spaceId,'sport');
  const disabled=state();disabled.spaces[0].fitnessEnabled=false;
  assert.equal(mergeBackup(disabled,incoming).state.spaces[0].fitnessEnabled,false);
  const absent=state();absent.spaces=[];
  assert.equal(mergeBackup(absent,incoming).state.spaces[0].fitnessEnabled,true);
  assert.equal(mergeBackup(merged.state,incoming).count,0);
});
