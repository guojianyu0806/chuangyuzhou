import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCalendar,initializeCalendar,monthDays,shiftDate,shiftMonth,eventsOnDate} from '../src/calendar-model.js';
import {validateBackup,mergeBackup} from '../src/backup.js';
import {seedEnglish} from '../src/english.js';
const stamp='2026-09-20T00:00:00.000Z';
const entry=(patch={})=>({id:'event',title:'项目准备',kind:'plan',startDate:'2026-09-30',endDate:'2026-10-02',allDay:true,startTime:'',endTime:'',location:'',notes:'带资料',important:false,done:false,archived:false,color:'#ae88ff',createdAt:stamp,updatedAt:stamp,...patch});
test('calendar validates leap days, times, spans and unsafe input',()=>{
 assert.equal(validateCalendar({version:1,events:[entry()]}).events.length,1);
 assert.doesNotThrow(()=>validateCalendar({version:1,events:[entry({startDate:'2028-02-29',endDate:'2028-02-29'})]}));
 for(const patch of [{startDate:'2026-02-29'},{endDate:'2026-09-29'},{allDay:false,startTime:'10:00',endTime:'09:00',endDate:'2026-09-30'},{color:'red'},{kind:'constructor'},{id:'__proto__'},{important:'yes'}])assert.throws(()=>validateCalendar({version:1,events:[entry(patch)]}));
 assert.throws(()=>validateCalendar({version:1,events:[entry(),entry()]}));
});
test('Monday-first month and inclusive spanning events keep civil dates',()=>{
 assert.equal(monthDays('2026-09').length,42);assert.equal(monthDays('2026-09')[0],'2026-08-31');
 assert.equal(shiftDate('2028-02-28',1),'2028-02-29');assert.equal(shiftMonth('2026-12',1),'2027-01');
 assert.equal(shiftMonth('1900-01',-1),'1900-01');assert.equal(shiftMonth('9999-12',1),'9999-12');
 const cal={events:[entry(),entry({id:'old',archived:true}),entry({id:'note',kind:'note',important:true})]};
 assert.equal(eventsOnDate(cal,'2026-10-02')[0].id,'note');assert.equal(eventsOnDate(cal,'2026-10-03').length,0);
 assert.equal(eventsOnDate(cal,'2026-10-01',{kind:'plan'}).length,1);assert.equal(eventsOnDate(cal,'2026-10-01',{archived:true})[0].id,'old');
});
test('calendar backup adds missing events, preserves edits, and stays separate from timetable',()=>{
 const state={schema:1,mode:'personal',profile:{name:'测试',major:'软件工程',provider:'deepseek'},courses:[],tasks:[],captures:[],english:seedEnglish(false),updatedAt:stamp};
 initializeCalendar(state);assert.deepEqual(state.calendar.events,[]);assert.equal(state.timetable,undefined);
 state.calendar.events.push(entry());const backup=validateBackup({format:'lumi-backup',version:1,exportedAt:stamp,state,files:[]});
 const current=structuredClone(state);current.calendar.events[0].title='新修改';backup.state.calendar.events.push(entry({id:'new'}));
 const result=mergeBackup(current,backup).state;assert.equal(result.calendar.events.length,2);assert.equal(result.calendar.events[0].title,'新修改');assert.equal(result.timetable,undefined);
});
