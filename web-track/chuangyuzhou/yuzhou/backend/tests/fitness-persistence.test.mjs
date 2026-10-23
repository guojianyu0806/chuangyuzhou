import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createStore,validateWorkspace,digest} from '../store.mjs';

const stamp='2026-09-22T08:00:00.000Z';
const space=()=>({id:'sport',title:'运动健身',type:'blank',archived:false,notes:[{id:'note-1',title:'原有笔记',content:'记录照常保留'}],files:[]});
const entry=(id='fitness-1')=>({id,spaceId:'sport',date:'2026-09-22',activity:'跑步',minutes:35,distanceKm:5.2,caloriesKcal:null,note:'学校操场',source:'manual',archived:false,color:'#7950f2',createdAt:stamp,updatedAt:stamp});
const state=()=>({schema:1,mode:'personal',profile:{},english:{},courses:[],tasks:[{id:'task-1',title:'原有待办'}],captures:[],spaces:[space()],
  ledger:{version:1,currency:'CNY',projects:[],entries:[]}});
function temporaryStore(t) {
  const directory=mkdtempSync(join(tmpdir(),'yuzhou-fitness-test-'));
  const ref={store:createStore(directory),directory};
  t.after(()=>{
    ref.store.close();
    const target=resolve(directory),allowedPrefix=resolve(join(tmpdir(),'yuzhou-fitness-test-'));
    if(!target.startsWith(allowedPrefix))throw new Error('Unexpected fitness test cleanup target');
    rmSync(target,{recursive:true,force:true});
  });
  return ref;
}
test('server accepts optional fitness, archived target spaces and both activation flag values',()=>{
  const legacy=state();delete legacy.spaces;assert.doesNotThrow(()=>validateWorkspace(legacy));
  legacy.fitness={version:1,entries:[]};assert.doesNotThrow(()=>validateWorkspace(legacy));
  for(const enabled of [true,false]) {
    const input=state();input.spaces[0].fitnessEnabled=enabled;input.spaces[0].type='fitness';input.spaces[0].archived=true;
    input.fitness={version:1,entries:[entry(),{...entry('fitness-2'),source:'device',distanceKm:null,caloriesKcal:220,archived:true}]};
    const parsed=JSON.parse(validateWorkspace(input).serialized);
    assert.equal(parsed.spaces[0].fitnessEnabled,enabled);assert.deepEqual(parsed.fitness,input.fitness);
  }
});

test('server rejects malformed fitness, unknown space links and nonboolean activation fields',()=>{
  const fixture=()=>{const input=state();input.fitness={version:1,entries:[entry()]};return input;};
  for(const change of [
    value=>{value.fitness.entries[0].minutes=-1;},
    value=>{value.fitness.entries[0].date='2026-02-30';},
    value=>{value.fitness.entries[0].distanceKm='2';},
    value=>{value.fitness.entries[0].caloriesKcal=-1;},
    value=>{value.fitness.entries[0].source='made-up';},
  ]) {const invalid=fixture();change(invalid);assert.throws(()=>validateWorkspace(invalid),error=>error.code==='invalid_fitness'&&error.status===400);}
  for(const archived of [true,false]){
    const invalid=fixture();invalid.fitness.entries[0].spaceId='unknown';invalid.fitness.entries[0].archived=archived;
    assert.throws(()=>validateWorkspace(invalid),error=>error.code==='invalid_fitness_reference'&&error.status===400);
  }
  const noSpaces=fixture();delete noSpaces.spaces;
  assert.throws(()=>validateWorkspace(noSpaces),error=>error.code==='invalid_fitness_reference');
  for(const flag of [null,'false',0,{},[]]){
    const invalid=fixture();invalid.spaces[0].fitnessEnabled=flag;
    assert.throws(()=>validateWorkspace(invalid),error=>error.code==='invalid_space_fitness_enabled'&&error.status===400);
  }
});

test('SQLite fitness survives client edits and restart while original notes, file bytes, tasks and ledger remain intact',t=>{
  const ref=temporaryStore(t),original=state();
  const bytes=Buffer.from('original training file');const temporary=join(ref.store.tempDir,'training.txt');
  writeFileSync(temporary,bytes);
  ref.store.commitFile('training-blob',temporary,{name:'training.txt',type:'text/plain',size:bytes.length,sha256:digest(bytes)});
  original.spaces[0].files=[{id:'training-meta',blobId:'training-blob',name:'training.txt',type:'text/plain',size:bytes.length,createdAt:stamp}];
  ref.store.saveWorkspace(0,original);
  const enabled=structuredClone(original);enabled.spaces[0].fitnessEnabled=true;enabled.fitness={version:1,entries:[entry()]};
  ref.store.saveWorkspace(1,enabled);
  const phone=ref.store.getWorkspace();phone.state.fitness.entries[0].minutes=42;phone.state.fitness.entries[0].note='手机上修改';
  ref.store.saveWorkspace(phone.revision,phone.state);
  assert.throws(()=>ref.store.saveWorkspace(2,enabled),error=>error.code==='revision_conflict');
  const snapshot=ref.store.getWorkspace(),invalid=structuredClone(snapshot.state);invalid.fitness.entries[0].spaceId='missing';
  assert.throws(()=>ref.store.saveWorkspace(snapshot.revision,invalid),error=>error.code==='invalid_fitness_reference');
  assert.deepEqual(ref.store.getWorkspace(),snapshot,'rejected reference leaves SQLite state and revision unchanged');
  ref.store.close();ref.store=createStore(ref.directory);
  const tablet=ref.store.getWorkspace();assert.equal(tablet.revision,3);
  assert.equal(tablet.state.fitness.entries[0].minutes,42);assert.equal(tablet.state.fitness.entries[0].note,'手机上修改');
  assert.deepEqual(tablet.state.spaces[0].notes,original.spaces[0].notes);
  assert.deepEqual(tablet.state.spaces[0].files,original.spaces[0].files);
  assert.deepEqual(readFileSync(ref.store.filePath('training-blob')),bytes);
  assert.deepEqual(tablet.state.tasks,original.tasks);assert.deepEqual(tablet.state.ledger,original.ledger);
});

test('old clients cannot drop populated fitness or an existing same-space activation flag',t=>{
  const {store}=temporaryStore(t),initial=state();initial.spaces[0].fitnessEnabled=false;initial.fitness={version:1,entries:[entry()]};
  store.saveWorkspace(0,initial);
  for(const flag of [false,true]) {
    const snapshot=store.getWorkspace();assert.equal(snapshot.state.spaces[0].fitnessEnabled,flag);
    for(const remove of [
      value=>{delete value.fitness;},
      value=>{delete value.spaces[0].fitnessEnabled;},
      value=>{delete value.fitness;delete value.spaces[0].fitnessEnabled;},
    ]) {
      const outdated=structuredClone(snapshot.state);outdated.tasks[0].title='旧客户端的变更';remove(outdated);
      assert.throws(()=>store.saveWorkspace(snapshot.revision,outdated),error=>error.code==='workspace_update_required'&&error.status===409);
      assert.deepEqual(store.getWorkspace(),snapshot,'old-client rejection is atomic');
    }
    const updated=structuredClone(snapshot.state);updated.spaces[0].fitnessEnabled=!flag;
    store.saveWorkspace(snapshot.revision,updated);
  }
  const renamed=store.getWorkspace();renamed.state.spaces.push({...space(),id:'legacy',title:'没有启用健身的旧空间'});
  store.saveWorkspace(renamed.revision,renamed.state);
  const legacyEdit=store.getWorkspace();legacyEdit.state.spaces.find(space=>space.id==='legacy').title='旧空间照常编辑';
  assert.doesNotThrow(()=>store.saveWorkspace(legacyEdit.revision,legacyEdit.state));
});

test('empty feature data may be omitted and removing a different space does not trigger same-ID field protection',t=>{
  const {store}=temporaryStore(t),initial=state();initial.fitness={version:1,entries:[]};
  initial.spaces.push({...space(),id:'empty-sport',fitnessEnabled:true});store.saveWorkspace(0,initial);
  const next=store.getWorkspace();delete next.state.fitness;next.state.spaces=next.state.spaces.filter(space=>space.id!=='empty-sport');
  assert.doesNotThrow(()=>store.saveWorkspace(next.revision,next.state));
  assert.equal(Object.hasOwn(store.getWorkspace().state,'fitness'),false);
  assert.equal(store.getWorkspace().state.spaces.length,1);
});
