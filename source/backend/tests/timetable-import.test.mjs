import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createStore} from '../store.mjs';
import {importTimetable} from '../../deployment/import-timetable.mjs';

const input=()=>({version:1,activeTermId:'fixture-term',terms:[{id:'fixture-term',title:'测试学期',campus:'测试校区',weekOne:'2026-08-31',totalWeeks:20,teachingWeeks:18,notes:'',periods:[{id:1,start:'08:30',end:'09:15'}],entries:[{id:'fixture-course',title:'测试课程',teacher:'待填写',location:'测试地点',weekday:1,startPeriod:1,endPeriod:1,weeks:[1,3,5],color:'#82BDFF',archived:false}]}]});

test('private timetable import is idempotent and preserves all non-timetable records',t=>{
 const dir=mkdtempSync(join(tmpdir(),'yuzhou-timetable-import-')),store=createStore(dir);
 t.after(()=>{store.close();if(!resolve(dir).startsWith(resolve(join(tmpdir(),'yuzhou-timetable-import-'))))throw Error('Unexpected cleanup path');rmSync(dir,{recursive:true,force:true});});
 const initial={schema:1,mode:'personal',profile:{name:'fixture'},english:{},courses:[],tasks:[{id:'event',title:'重要事件',date:'2026-09-20'}],captures:[],calendar:{events:[{id:'separate-event',title:'独立日历事件'}]},canvas:{cards:[{id:'tasks',x:12,y:34,w:300,h:200}]}};
 store.saveWorkspace(0,initial);
 assert.equal(importTimetable(store,input(),{dryRun:true}).dryRun,true);assert.deepEqual(store.getWorkspace().state,initial);
 const first=importTimetable(store,input());assert.equal(first.changed,true);
 const snapshot=store.getWorkspace();const {timetable,...unrelated}=snapshot.state;assert.deepEqual(unrelated,initial);assert.equal(timetable.terms[0].entries.length,1);
 assert.equal(importTimetable(store,input()).changed,false);assert.equal(store.getWorkspace().revision,snapshot.revision);
 snapshot.state.timetable.terms[0].entries[0].location='用户修改后的地点';store.saveWorkspace(snapshot.revision,snapshot.state);
 assert.equal(importTimetable(store,input()).changed,false);assert.equal(store.getWorkspace().state.timetable.terms[0].entries[0].location,'用户修改后的地点');
 const invalid=input();invalid.terms[0].entries[0].weeks=[21];const before=store.getWorkspace();assert.throws(()=>importTimetable(store,invalid));assert.deepEqual(store.getWorkspace(),before);
});
