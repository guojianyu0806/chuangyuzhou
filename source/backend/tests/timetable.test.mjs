import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {createStore, validateWorkspace} from '../store.mjs';

const timetable = () => ({version:1,activeTermId:'term-test',terms:[{id:'term-test',title:'Test semester',campus:'Test campus',weekOne:'2026-08-31',totalWeeks:20,teachingWeeks:18,notes:'',
  periods:[{id:1,start:'08:30',end:'09:15'},{id:2,start:'09:25',end:'10:10'}],
  entries:[{id:'lesson-test',title:'Test lesson',teacher:'Test teacher',location:'Test room',weekday:3,startPeriod:1,endPeriod:2,weeks:[1,3,5],color:'#7950f2',archived:false}]}]});
const state = data => ({schema:1,mode:'personal',profile:{},english:{},courses:[],tasks:[{id:'event-a',title:'Important event'}],captures:[],...(data ? {timetable:data} : {})});

test('server validates timetable lesson dates, periods, weeks and semester references', () => {
  assert.doesNotThrow(()=>validateWorkspace(state()));
  assert.deepEqual(JSON.parse(validateWorkspace(state(timetable())).serialized).timetable,timetable());
  for (const mutate of [
    value => value.terms[0].entries[0].weeks = [21],
    value => value.terms[0].entries[0].endPeriod = 3,
    value => value.terms[0].weekOne = '2026-09-01',
    value => value.activeTermId = 'missing',
  ]) {
    const value = timetable(); mutate(value);
    assert.throws(()=>validateWorkspace(state(value)),error=>error.code==='invalid_timetable'&&error.status===400);
  }
});

test('SQLite sync survives restarts, prevents stale writes and old-client timetable loss without touching events', t => {
  const directory = mkdtempSync(join(tmpdir(),'yuzhou-timetable-test-'));
  let store = createStore(directory);
  t.after(()=>{
    store.close();
    const target = resolve(directory),allowedPrefix = resolve(join(tmpdir(),'yuzhou-timetable-test-'));
    if (!target.startsWith(allowedPrefix)) throw new Error('Unexpected timetable test cleanup target');
    rmSync(target,{recursive:true,force:true});
  });
  store.saveWorkspace(0,state());
  store.saveWorkspace(1,state(timetable()));
  const phone = store.getWorkspace();
  phone.state.timetable.terms[0].entries[0].location = 'Updated room';
  store.saveWorkspace(phone.revision,phone.state);
  assert.throws(()=>store.saveWorkspace(2,state(timetable())),error=>error.code==='revision_conflict');
  assert.throws(()=>store.saveWorkspace(3,state()),error=>error.code==='workspace_update_required');
  const invalid = store.getWorkspace(); invalid.state.timetable.terms[0].entries[0].weeks = [1,55];
  assert.throws(()=>store.saveWorkspace(invalid.revision,invalid.state),error=>error.code==='invalid_timetable');
  assert.equal(store.getWorkspace().revision,3);
  store.close(); store = createStore(directory);
  const tablet = store.getWorkspace();
  assert.equal(tablet.state.timetable.terms[0].entries[0].location,'Updated room');
  assert.deepEqual(tablet.state.tasks,state().tasks);
  assert.equal(tablet.revision,3);
});
