import test from 'node:test';
import assert from 'node:assert/strict';
import {initializeTimetable, validateTimetable, mergeTimetables, weekForDate, dateForWeek, entriesForWeek, parseWeeks, formatWeeks, periodTime} from '../src/timetable-model.js';
import {initializeSpaces} from '../src/workspace-model.js';
import {validateBackup, mergeBackup} from '../src/backup.js';

const entry = (changes = {}) => ({id:'lesson-a',title:'测试课程',teacher:'测试教师',location:'测试教室',weekday:3,startPeriod:1,endPeriod:2,weeks:[1,3,5,7],color:'#7950f2',archived:false,...changes});
const term = (changes = {}) => ({id:'term-a',title:'测试学期',campus:'测试校区',weekOne:'2026-08-31',totalWeeks:20,teachingWeeks:18,notes:'示例测试数据',
  periods:[{id:1,start:'08:30',end:'09:15'},{id:2,start:'09:25',end:'10:10'}],entries:[entry()],...changes});
const timetable = () => ({version:1,activeTermId:'term-a',terms:[term()]});
const workspace = data => ({schema:1,mode:'personal',profile:{},english:{},courses:[],tasks:[],captures:[],...(data ? {timetable:data} : {})});
const backup = state => ({format:'lumi-backup',version:1,exportedAt:'2026-09-20T12:00:00.000Z',state,files:[]});

test('initialization is empty for personal and demo and preserves cleared/customized timetables', () => {
  for (const mode of ['personal','demo']) {
    const state = {mode}; initializeSpaces(state);
    assert.deepEqual(state.timetable,{version:1,activeTermId:'',terms:[]});
    state.timetable = timetable();
    assert.equal(initializeTimetable(state),state.timetable);
    assert.deepEqual(state.timetable,timetable());
  }
});

test('UTC calendar math preserves week boundaries, leap days, Sundays, and vacation numbers', () => {
  const value = term();
  assert.equal(weekForDate(value,'2026-08-30'),0);
  assert.equal(weekForDate(value,'2026-08-31'),1);
  assert.equal(weekForDate(value,'2026-09-06'),1);
  assert.equal(weekForDate(value,'2026-09-07'),2);
  assert.equal(weekForDate(value,'2027-01-17'),20);
  assert.equal(weekForDate(value,'2027-01-18'),21);
  assert.equal(weekForDate(value,new Date('2026-09-07T23:59:59.000Z')),2);
  assert.equal(dateForWeek(value,20,7),'2027-01-17');
  const leap = term({weekOne:'2024-02-26'});
  assert.equal(dateForWeek(leap,1,4),'2024-02-29');
  for (let week = 1; week <= value.totalWeeks; week++) for (let day = 1; day <= 7; day++) assert.equal(weekForDate(value,dateForWeek(value,week,day)),week);
  for (const date of ['2026-02-29','2026-04-31','2026-9-1','bad']) assert.throws(() => weekForDate(value,date));
  assert.throws(() => dateForWeek(value,0));
  assert.throws(() => dateForWeek(value,21));
  assert.throws(() => weekForDate(term({weekOne:'2026-09-01'}),'2026-09-01'));
});

test('week expressions handle bounded ranges, odd/even weeks and roundtrip display', () => {
  assert.deepEqual(parseWeeks('1-7周（单）',20),[1,3,5,7]);
  assert.deepEqual(parseWeeks('6-8周(双)',20),[6,8]);
  assert.deepEqual(parseWeeks('第1至3周，5、7;9周',20),[1,2,3,5,7,9]);
  assert.deepEqual(parseWeeks('单周',6),[1,3,5]);
  assert.deepEqual(parseWeeks('双周',6),[2,4,6]);
  assert.deepEqual(parseWeeks('全周',3),[1,2,3]);
  assert.deepEqual(parseWeeks('3,1,3',20),[1,3]);
  for (const input of ['','0-3','1-21','5-1','1.5','1,','-2','1-2垃圾','1(双)','NaN','(单','双)']) assert.throws(() => parseWeeks(input,20));
  for (const weeks of [[1],[1,2,3],[1,3,5,7],[6,8],[1,2,5,8,9]]) assert.deepEqual(parseWeeks(formatWeeks(weeks),20),weeks);
  assert.equal(formatWeeks([1,3,5]),'1-5周（单）');
  assert.equal(formatWeeks([6,8]),'6-8周（双）');
  assert.equal(formatWeeks([]),'未安排');
});

test('validation checks semester, lesson ranges, clocks, safe values, and detached defaults', () => {
  const good = timetable();
  assert.deepEqual(validateTimetable(good),good);
  const normalized = validateTimetable(good); normalized.terms[0].entries[0].weeks.push(9);
  assert.deepEqual(good.terms[0].entries[0].weeks,[1,3,5,7]);
  for (const change of [
    value => value.version = 2,
    value => value.activeTermId = 'missing',
    value => value.terms[0].weekOne = '2026-09-01',
    value => value.terms[0].weekOne = '2026-02-30',
    value => value.terms[0].weekOne = new Date('2026-08-31T00:00:00.000Z'),
    value => value.terms[0].totalWeeks = 0,
    value => value.terms[0].teachingWeeks = 21,
    value => value.terms[0].periods[0].end = '25:00',
    value => value.terms[0].periods[0].start = '9:00',
    value => value.terms[0].periods[0].end = '08:00',
    value => value.terms[0].periods[1].start = '09:00',
    value => value.terms[0].entries[0].endPeriod = 3,
    value => value.terms[0].entries[0].weekday = 0,
    value => value.terms[0].entries[0].weeks = [],
    value => value.terms[0].entries[0].weeks = [1,1],
    value => value.terms[0].entries[0].weeks = [1,21],
    value => value.terms[0].entries[0].archived = 'false',
    value => value.terms[0].entries[0].color = 'red;url(x)',
    value => value.terms[0].entries[0].id = '__proto__',
    value => value.terms[0].entries.push({...value.terms[0].entries[0]}),
    value => value.terms.push({...value.terms[0]}),
  ]) { const data = timetable(); change(data); assert.throws(() => validateTimetable(data)); }
  const legacy = timetable(); delete legacy.terms[0].notes; delete legacy.terms[0].entries[0].archived;
  const result = validateTimetable(legacy);
  assert.equal(result.terms[0].notes,''); assert.equal(result.terms[0].entries[0].archived,false);
});

test('week selection omits archived/other weeks, preserves collisions and reports lesson times', () => {
  const value = term();
  value.entries.push(entry({id:'earlier',weekday:1}),entry({id:'same-slot'}),entry({id:'hidden',archived:true}),entry({id:'even',weeks:[2,4]}));
  assert.deepEqual(entriesForWeek(value,1).map(value=>value.id),['earlier','lesson-a','same-slot']);
  assert.deepEqual(entriesForWeek(value,2).map(value=>value.id),['even']);
  assert.deepEqual(entriesForWeek(value,21),[]);
  assert.equal(value.entries[0].id,'lesson-a');
  assert.deepEqual(periodTime(value,value.entries[0]),{start:'08:30',end:'10:10',label:'08:30–10:10'});
});

test('additive timetable merges retain current edits, add new lessons and semesters, and are idempotent', () => {
  const current = timetable(), incoming = timetable();
  current.terms[0].title = 'Current title';
  current.terms[0].entries[0].location = 'Current room';
  incoming.terms[0].entries.push(entry({id:'lesson-b',weekday:5}));
  incoming.terms.push(term({id:'term-b',title:'Next term',weekOne:'2027-02-22'}));
  const {timetable:merged,count} = mergeTimetables(current,incoming);
  assert.equal(count,2);
  assert.equal(merged.terms[0].title,'Current title');
  assert.equal(merged.terms[0].entries[0].location,'Current room');
  assert.equal(merged.terms[0].entries.length,2);
  assert.equal(merged.terms.length,2);
  assert.equal(mergeTimetables(merged,incoming).count,0);
  assert.equal(current.terms[0].entries.length,1);
  assert.equal(incoming.terms[0].title,'测试学期');
  assert.deepEqual(mergeTimetables(undefined,incoming).timetable,incoming);
});

test('backup import/export preserves lessons independently from calendar/tasks and accepts old backups', () => {
  const current = workspace(timetable());
  current.tasks = [{id:'important-event',title:'重要事件',date:'2026-09-20'}];
  current.calendar = {events:[{id:'event-a',title:'独立事件'}]};
  const snapshot = JSON.stringify(current);
  const incoming = workspace(timetable());
  incoming.timetable.terms[0].entries.push(entry({id:'lesson-b',weekday:6}));
  const restored = validateBackup(JSON.parse(JSON.stringify(backup(incoming))));
  assert.deepEqual(restored.state.timetable,incoming.timetable);
  const merged = mergeBackup(current,restored);
  assert.equal(merged.state.timetable.terms[0].entries.length,2);
  assert.deepEqual(merged.state.tasks,current.tasks);
  assert.deepEqual(merged.state.calendar,current.calendar);
  assert.equal(JSON.stringify(current),snapshot);
  assert.deepEqual(mergeBackup(merged.state,workspace()).state.timetable,merged.state.timetable);
  assert.equal(validateBackup(backup(workspace())).state.timetable,undefined);
  assert.equal(mergeBackup(merged.state,incoming).count,0);
});
