import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBackup, mergeBackup } from '../src/backup.js';
import { seedCourses } from '../src/courses.js';
import { seedEnglish } from '../src/english.js';
import { routeContent, undoRoute } from '../src/workspace-model.js';

const stamp = '2026-09-20T00:00:00.000Z';
function state() {
  return { schema: 1, mode: 'personal', profile: { name: '当前用户', major: '软件工程', provider: 'deepseek' },
    courses: [], tasks: [], captures: [], english: seedEnglish(false), updatedAt: stamp };
}
function backup(value = state(), files = []) {
  return { format: 'lumi-backup', version: 1, exportedAt: stamp, state: value, files };
}
const file = { id: 'meta-1', blobId: 'blob-1', name: 'notes.txt', size: 3, type: 'text/plain', createdAt: stamp };

function ledgerState(projects) {
  const value = state();
  value.ledger = {version:1, currency:'CNY', projects:projects.map(project => ({title:'项目', color:'#00b8b0', archived:false, createdAt:stamp, updatedAt:stamp, ...project})), entries:[]};
  return value;
}

test('ledger backups retain separate accounting choices without changing legacy defaults', () => {
  const source = ledgerState([{id:'separate', includeInTotal:false}, {id:'included', includeInTotal:true}, {id:'legacy'}]);
  const before = structuredClone(source);
  const checked = validateBackup(JSON.parse(JSON.stringify(backup(source))));
  assert.deepEqual(checked.state.ledger, source.ledger);
  assert.equal(Object.hasOwn(checked.state.ledger.projects[2], 'includeInTotal'), false);
  const restored = mergeBackup(state(), checked);
  assert.deepEqual(restored.state.ledger, source.ledger);
  assert.deepEqual(source, before, 'backup validation and restore leave the source unchanged');
  const invalid = structuredClone(source); invalid.ledger.projects[0].includeInTotal = 'false';
  assert.throws(() => validateBackup(backup(invalid)));
});

test('ledger merge fills absent accounting choices but keeps explicit current choices and is idempotent', () => {
  const current = ledgerState([{id:'current-separate', includeInTotal:false}, {id:'current-included', includeInTotal:true}, {id:'legacy'}]);
  const source = ledgerState([{id:'current-separate', includeInTotal:true}, {id:'current-included', includeInTotal:false}, {id:'legacy', includeInTotal:false}, {id:'new-project', includeInTotal:false}]);
  const before = structuredClone(current);
  const merged = mergeBackup(current, validateBackup(backup(source)));
  const projects = new Map(merged.state.ledger.projects.map(project => [project.id, project]));
  assert.equal(projects.get('current-separate').includeInTotal, false);
  assert.equal(projects.get('current-included').includeInTotal, true);
  assert.equal(projects.get('legacy').includeInTotal, false);
  assert.equal(projects.get('new-project').includeInTotal, false);
  assert.equal(merged.count, 2, 'one newly restored setting and one new project are counted');
  assert.deepEqual(current, before);
  assert.equal(mergeBackup(merged.state, source).count, 0);
  const older = ledgerState([{id:'current-separate'}, {id:'current-included'}, {id:'legacy'}]);
  assert.deepEqual(mergeBackup(merged.state, older).state.ledger, merged.state.ledger, 'old backups cannot remove existing choices');
  assert.deepEqual(mergeBackup(merged.state, state()).state.ledger, merged.state.ledger, 'pre-ledger backups preserve all accounting data');
});

test('conversation history survives backups and additive imports without dropping newer messages',()=>{
  const current=state();current.aiRequests=[{id:'chat',text:'初始想法',files:[],targetId:'auto',status:'waiting_model',createdAt:stamp,updatedAt:stamp,conversation:{version:1,messages:[{id:'m1',role:'user',text:'初始想法',createdAt:stamp},{id:'m2',role:'assistant',text:'需要哪一天？',createdAt:stamp}]}}];
  const checked=validateBackup(backup(current));assert.deepEqual(checked.state.aiRequests[0].conversation,current.aiRequests[0].conversation);
  const newer=structuredClone(current);newer.aiRequests[0].conversation.messages.push({id:'m3',role:'user',text:'明天',createdAt:stamp});
  const merged=mergeBackup(newer,checked).state;assert.equal(merged.aiRequests[0].conversation.messages.length,3);
  const bad=structuredClone(current);bad.aiRequests[0].conversation.messages[0].role='system';assert.throws(()=>validateBackup(backup(bad)));
});

test('optional record colors and creation cursor survive backup and merge without coloring legacy data',()=>{
  const source=state();source.ui={sidebarPinned:false,lastCreatedColor:'#Ab12Cd'};source.courses=[seedCourses()[0]];
  source.courses[0].notes[0].color='#AE88FF';source.courses[0].files=[{...file,color:'#63E6DC'}];
  source.tasks=[{id:'color-task',title:'有色任务',color:'#FF9CCE'},{id:'legacy-task',title:'旧任务'}];
  source.captures=[{id:'color-capture',text:'有色灵感',color:'#D8F649'},{id:'legacy-capture',text:'旧灵感'}];
  const imported=validateBackup(backup(source));
  assert.equal(imported.state.courses[0].notes[0].color,'#AE88FF');assert.equal(imported.state.courses[0].files[0].color,'#63E6DC');
  assert.equal(imported.state.tasks[0].color,'#FF9CCE');assert.equal(imported.state.captures[0].color,'#D8F649');
  assert.equal(imported.state.ui.lastCreatedColor,'#Ab12Cd');
  assert.equal(Object.hasOwn(imported.state.tasks[1],'color'),false);assert.equal(Object.hasOwn(imported.state.captures[1],'color'),false);
  assert.equal(Object.hasOwn(imported.state.courses[0].notes[1],'color'),false);
  const merged=mergeBackup(state(),imported).state;
  assert.equal(merged.ui.lastCreatedColor,'#Ab12Cd');assert.equal(merged.courses[0].files[0].color,'#63E6DC');
  const current=state();current.ui={lastCreatedColor:'#123456'};
  assert.equal(mergeBackup(current,imported).state.ui.lastCreatedColor,'#123456');
  for(const edit of [s=>{s.tasks[0].color='red;bad';},s=>{s.captures[0].color='#fff';},s=>{s.courses[0].notes[0].color='blue';},s=>{s.courses[0].files[0].color='url(x)';},s=>{s.ui.lastCreatedColor='red';}]){
    const invalid=structuredClone(source);edit(invalid);assert.throws(()=>validateBackup(backup(invalid)),/颜色/);
  }
});

test('dream preference roundtrips and restores only when the current choice is absent',()=>{
  const source=state();source.ui={sidebarPinned:false,inboxView:'dream'};
  const imported=validateBackup(backup(source));assert.equal(imported.state.ui.inboxView,'dream');
  const existing=state();existing.ui={sidebarPinned:true};assert.equal(mergeBackup(existing,imported).state.ui.inboxView,'dream');
  existing.ui.inboxView='cards';assert.equal(mergeBackup(existing,imported).state.ui.inboxView,'cards');
  source.ui.inboxView='unsupported';assert.throws(()=>validateBackup(backup(source)),/灵感显示方式/);
});

test('real example seed passes validation and unsafe course colors are normalized', () => {
  const source = state(); source.mode = 'demo'; source.courses = seedCourses(); source.english = seedEnglish(true);
  source.courses[0].color = 'red; background:url(attacker)';
  const normalized = validateBackup(backup(source));
  assert.equal(normalized.state.courses[0].color, '#7950f2');
  assert.equal(normalized.state.courses[0].example, true);
  assert.equal(normalized.state.courses[0].notes[0].example, true);
  assert.equal(typeof normalized.state.english.words[0].example, 'string');
  assert.notEqual(normalized.state, source);
});

test('nested import adds missing notes, files, revisions while preserving current title/content', () => {
  const current = state(); current.courses = [seedCourses()[0]];
  current.courses[0].title = 'My current course';
  current.courses[0].notes[0].content = 'My current note';
  const incoming = structuredClone(current);
  incoming.profile.name = 'Old profile';
  incoming.courses[0].title = 'Old title';
  incoming.courses[0].notes[0].content = 'Old text';
  incoming.courses[0].notes[0].revisions.push({ title: 'Revision', content: 'Historic text', chapter: '', source: '', updatedAt: stamp, savedAt: stamp });
  incoming.courses[0].notes.push({ id: 'extra-note', title: 'Missing note', content: 'Imported content', revisions: [] });
  incoming.courses[0].files.push(file);
  const before = structuredClone(current);
  const result = mergeBackup(current, validateBackup(backup(incoming)));
  assert.equal(result.count, 3);
  assert.equal(result.state.courses[0].title, 'My current course');
  assert.equal(result.state.courses[0].notes[0].content, 'My current note');
  assert.equal(result.state.courses[0].notes[0].revisions.length, 1);
  assert.equal(result.state.courses[0].files[0].blobId, 'blob-1');
  assert.equal(result.state.profile.name, '当前用户');
  assert.deepEqual(current, before);
  assert.equal(mergeBackup(result.state, incoming).count, 0);
});

test('new records merge by ID without overwriting existing tasks or captures', () => {
  const current = state();
  current.tasks = [{ id: 'task-1', title: 'Current', done: true }];
  current.captures = [{ id: 'capture-1', text: 'Current capture' }];
  const incoming = state();
  incoming.tasks = [{ id: 'task-1', title: 'Old', done: false }, { id: 'task-2', title: 'New task' }];
  incoming.captures = [{ id: 'capture-1', text: 'Old capture' }, { id: 'capture-2', text: 'New capture', example: true }];
  const result = mergeBackup(current, incoming);
  assert.equal(result.count, 2);
  assert.equal(result.state.tasks[0].title, 'Current');
  assert.equal(result.state.tasks[0].done, true);
  assert.equal(result.state.captures[0].text, 'Current capture');
  assert.equal(result.state.captures[1].example, true);
});

test('English drafts restore into empty fields and conflicts become labelled captures only once', () => {
  const current = state(); current.english.drafts.writing = 'Current essay';
  const incoming = state(); incoming.mode = 'demo';
  incoming.english.drafts = { writing: 'Earlier essay', translation: 'Earlier translation', listening: 'Audio notes' };
  incoming.english.draftUpdatedAt = { writing: stamp, translation: stamp };
  const result = mergeBackup(current, incoming);
  assert.equal(result.state.english.drafts.writing, 'Current essay');
  assert.equal(result.state.english.drafts.translation, 'Earlier translation');
  assert.equal(result.state.captures[0].source, '导入的英语草稿');
  assert.equal(result.state.captures[0].text, 'Earlier essay');
  assert.equal(result.state.captures[0].example, true);
  assert.equal(mergeBackup(result.state, incoming).count, 0);
});

test('English plan restores missing/zero values without overwriting filled values', () => {
  const current = state(); current.english.plan = { target: 0, dailyMinutes: 45, focus: 'listening', examDate: '' };
  const incoming = state(); incoming.english.plan = { target: 550, dailyMinutes: 30, focus: 'reading', examDate: '2026-12-12' };
  const result = mergeBackup(current, incoming);
  assert.deepEqual(result.state.english.plan, { target: 550, dailyMinutes: 45, focus: 'listening', examDate: '2026-12-12' });
});

test('builtin vocabulary status restores new cards but respects current studied status', () => {
  const current = state(); current.english.words[1].status = 'review';
  const incoming = state(); incoming.english.words[0].status = 'mastered'; incoming.english.words[1].status = 'mastered';
  const result = mergeBackup(current, incoming);
  assert.equal(result.state.english.words[0].status, 'mastered');
  assert.equal(result.state.english.words[1].status, 'review');
});

test('English records, attempts, audio, reading answers and results survive restore', () => {
  const incoming = state();
  incoming.english.sessions = [{ id: 'session-1', date: '2026-09-20', minutes: 15, type: 'reading', note: '' }];
  incoming.english.attempts = [{ id: 'attempt-1', correct: 2, total: 3, date: '2026-09-20' }];
  incoming.english.mistakes = [{ id: 'mistake-1', questionId: 'r1', question: 'Question?', selected: 'A', correct: 'B', explanation: 'Reason', reviewed: false }];
  incoming.english.readingAnswers = { r1: 0, r2: 2, r3: 0 };
  incoming.english.readingResult = { correct: 2, total: 3, date: '2026-09-20' };
  incoming.english.audio = { blobId: 'audio-1', name: 'Audio.mp3', size: 10, persistent: true };
  const result = mergeBackup(state(), incoming);
  assert.equal(result.state.english.sessions.length, 1);
  assert.equal(result.state.english.attempts.length, 1);
  assert.equal(result.state.english.mistakes.length, 1);
  assert.deepEqual(result.state.english.audio, incoming.english.audio);
  assert.deepEqual(result.state.english.readingAnswers, incoming.english.readingAnswers);
  const changed = structuredClone(incoming); changed.english.audio.name = 'Other.mp3'; changed.english.readingAnswers.r1 = 1;
  const repeat = mergeBackup(result.state, changed);
  assert.equal(repeat.state.english.audio.name, 'Audio.mp3');
  assert.equal(repeat.state.english.readingAnswers.r1, 0);
});

test('invalid root, nested record types, dangerous IDs, duplicate IDs and numeric fields reject', () => {
  const variations = [
    data => { data.version = 2; }, data => { data.state.schema = 2; },
    data => { data.state.courses = [{ id: 'c', title: 'Course', notes: [{ id: 'n', title: 'Note', content: {} }], files: [] }]; },
    data => { data.state.english.drafts.writing = []; },
    data => { data.state.english.sessions = [{ id: 's', date: {}, minutes: 10 }]; },
    data => { data.state.english.words[0].word = {}; },
    data => { data.state.english.plan.dailyMinutes = 'not a number'; },
    data => { data.state.english.readingAnswers = { r1: 9 }; },
    data => { data.state.tasks = [{ id: '__proto__', title: 'Bad' }]; },
    data => { data.state.tasks = [{ id: 'same', title: 'A' }, { id: 'same', title: 'B' }]; },
    data => { data.state.courses = [{ id: 'c', title: 'Course', notes: [], files: [{ ...file, name: {} }] }]; },
  ];
  for (const change of variations) { const data = backup(); change(data); assert.throws(() => validateBackup(data)); }
});

test('only base64 data URL attachments under the size limit are accepted', () => {
  const valid = { id: 'blob-1', type: 'text/plain', data: 'data:text/plain;base64,YWJj' };
  assert.equal(validateBackup(backup(state(), [valid])).files[0].data, valid.data);
  for (const data of ['https://example.org/a', 'data:text/plain,abc', 'data:text/plain;base64,ab!!', 'data:;base64,abc', 'data:;base64,=abc']) {
    assert.throws(() => validateBackup(backup(state(), [{ ...valid, data }])));
  }
  const oversized = 'data:application/octet-stream;base64,' + 'A'.repeat(Math.ceil((40 * 1024 * 1024 + 1) / 3) * 4);
  assert.throws(() => validateBackup(backup(state(), [{ ...valid, data: oversized }])), /40 MB/);
});

test('prototype-shaped unknown properties never reach normalized records', () => {
  const data = JSON.parse(JSON.stringify(backup()));
  data.state.english.readingAnswers = JSON.parse('{"__proto__":0}');
  assert.throws(() => validateBackup(data));
  delete data.state.english.readingAnswers.__proto__;
  data.state.tasks = [JSON.parse('{"id":"safe","title":"task","__proto__":{"polluted":true}}')];
  const normalized = validateBackup(data);
  assert.equal(Object.hasOwn(normalized.state.tasks[0], '__proto__'), false);
  assert.equal({}.polluted, undefined);
});

function customSpace() {
  return { id:'student-union',title:'学生会',description:'活动、会议与工作安排',type:'affairs',color:'#00b8b0',icon:'flag',
    archived:false,example:false,createdAt:stamp,updatedAt:stamp,notes:[],files:[] };
}
function aiRecord(id = 'request-1') {
  return {id,text:'整理会议内容',originalText:'最初交代的内容',files:[{...file}],targetId:'space:student-union',status:'waiting_model',createdAt:stamp,updatedAt:stamp,
    revisions:[{text:'上一条指令',targetId:'auto',savedAt:stamp}]};
}
function layout(customized = false) {
  return {cards:[{id:'ai',x:30,y:45,w:510,h:560,color:'#7950f2'},{id:'student-union',x:600,y:20,w:280,h:240,color:'#00b8b0'}],
    view:{x:24,y:10,zoom:.8},snap:true,initialized:true,presentation:'canvas',customized,modifiedAt:stamp};
}

test('all card presentations and normalized pointer positions survive backup export and import', () => {
  for (const presentation of ['canvas','list','grid-2','grid-3','stack']) {
    for (const stackPointer of [0,.37,1]) {
      const source=state();
      source.canvas={...layout(true),presentation,stackPointer};
      source.courseCanvas={...layout(false),presentation,stackPointer};
      source.boards={tasks:{...layout(true),presentation,stackPointer},'course:one:notes':{...layout(true),presentation,stackPointer}};
      const before=structuredClone(source);
      const normalized=validateBackup(backup(source));
      const restored=mergeBackup(state(),normalized).state;
      for(const key of ['canvas','courseCanvas','boards'])assert.deepEqual(restored[key],source[key]);
      assert.deepEqual(source,before,'backup normalization never rewrites free-canvas geometry');
    }
  }
  const legacy=state();legacy.canvas=layout();delete legacy.canvas.presentation;
  const restored=validateBackup(backup(legacy)).state.canvas;
  assert.equal(restored.presentation,undefined);
  assert.equal(restored.stackPointer,undefined,'old backups remain valid without adding an unsolicited layout preference');
});

test('restoring a backup preserves current custom layouts and pointer heights while adding missing cards', () => {
  const current=state();
  current.canvas={...layout(true),presentation:'stack',stackPointer:.68};
  current.courseCanvas={...layout(true),presentation:'grid-2',stackPointer:.18};
  current.boards={tasks:{...layout(true),presentation:'grid-3',stackPointer:.9}};
  const incoming=structuredClone(current);
  for(const [active,saved] of [[current.canvas,incoming.canvas],[current.courseCanvas,incoming.courseCanvas],[current.boards.tasks,incoming.boards.tasks]]){
    active.cards=active.cards.slice(0,1);
    active.cards[0].x=988;
    active.view={x:-12,y:34,zoom:1.2};
    saved.presentation='list';saved.stackPointer=.5;
  }
  const before=structuredClone(current);
  const result=mergeBackup(current,validateBackup(backup(incoming)));
  for(const [saved,restored] of [[current.canvas,result.state.canvas],[current.courseCanvas,result.state.courseCanvas],[current.boards.tasks,result.state.boards.tasks]]){
    assert.equal(restored.presentation,saved.presentation);
    assert.equal(restored.stackPointer,saved.stackPointer);
    assert.deepEqual(restored.cards[0],saved.cards[0]);
    assert.deepEqual(restored.view,saved.view);
    assert.equal(restored.cards.length,2);
  }
  assert.deepEqual(current,before);
  assert.equal(mergeBackup(result.state,validateBackup(backup(incoming))).count,0);
});

test('backup validation rejects unsupported layouts and unsafe pointer positions on every board type', () => {
  for(const invalid of [{presentation:'grid-99'},...[-.01,1.01,NaN,Infinity,'0.5',null].map(stackPointer=>({stackPointer}))]){
    for(const key of ['canvas','courseCanvas','boards']){
      const source=state(),board={...layout(),...invalid};
      source[key]=key==='boards'?{tasks:board}:board;
      assert.throws(()=>validateBackup(backup(source)),/画布展示方式|堆叠指针位置/);
    }
  }
});

test('new spaces, archived notes, task relations, AI drafts and layout survive backup validation', () => {
  const source = state();
  source.spaces = [customSpace()];
  source.spaces[0].notes = [{id:'space-note',title:'会议记录',content:'原文',archived:true,sourceRequestId:'request-1',revisions:[{title:'第一稿',content:'旧内容',savedAt:stamp}]}];
  source.spaces[0].files = [{...file,sourceRequestId:'request-1'}];
  source.tasks = [{id:'space-task',title:'联系场地',spaceId:'student-union',sourceRequestId:'request-1'}];
  source.captures = [{id:'ai-capture',text:'原文',sourceRequestId:'request-1'}];
  source.aiRequests = [aiRecord()];
  source.aiDraft = {text:'还没有交代完的事情',targetId:'space:student-union',files:[{...file}]};
  source.canvas = layout(true); source.ui = {sidebarPinned:true}; source.workspaceVersion = 2;
  const normalized = validateBackup(backup(source)).state;
  assert.equal(normalized.spaces[0].description, source.spaces[0].description);
  assert.equal(normalized.spaces[0].notes[0].archived, true);
  assert.equal(normalized.spaces[0].notes[0].sourceRequestId, 'request-1');
  assert.equal(normalized.spaces[0].files[0].sourceRequestId, 'request-1');
  assert.equal(normalized.tasks[0].spaceId, 'student-union');
  assert.equal(normalized.captures[0].sourceRequestId, 'request-1');
  assert.deepEqual(normalized.aiRequests[0].revisions, source.aiRequests[0].revisions);
  assert.equal(normalized.aiRequests[0].originalText, source.aiRequests[0].originalText);
  assert.deepEqual(normalized.aiDraft, source.aiDraft);
  assert.deepEqual(normalized.canvas, source.canvas);
  assert.deepEqual(normalized.ui, source.ui);
  assert.equal(normalized.workspaceVersion, 2);
  assert.equal(validateBackup(backup(state())).state.spaces, undefined, 'old backups remain valid without the new fields');
});

test('merging existing spaces preserves current settings and only adds missing notes/files/history', () => {
  const current = state(); current.spaces = [customSpace()];
  current.spaces[0].notes = [{id:'n',title:'Current title',content:'Current text',revisions:[]}];
  const incoming = structuredClone(current);
  incoming.spaces[0].title = 'Old space title'; incoming.spaces[0].color = '#ff0000'; incoming.spaces[0].archived = true;
  incoming.spaces[0].notes[0].content = 'Old content'; incoming.spaces[0].notes[0].revisions.push({title:'History',content:'Original',savedAt:stamp});
  incoming.spaces[0].notes.push({id:'n2',title:'Missing note',content:'Imported'});
  incoming.spaces[0].files.push(file);
  const result = mergeBackup(current, incoming);
  assert.equal(result.state.spaces[0].title, '学生会');
  assert.equal(result.state.spaces[0].color, '#00b8b0');
  assert.equal(result.state.spaces[0].archived, false);
  assert.equal(result.state.spaces[0].notes[0].content, 'Current text');
  assert.equal(result.state.spaces[0].notes[0].revisions.length, 1);
  assert.equal(result.state.spaces[0].notes.length, 2);
  assert.equal(result.state.spaces[0].files.length, 1);
  assert.equal(mergeBackup(result.state, incoming).count, 0);
});

test('AI draft conflicts become recoverable waiting requests including attachments only once', () => {
  const current = state(); current.aiDraft = {text:'Current unsent text',targetId:'auto',files:[]};
  const incoming = state(); incoming.aiDraft = {text:'Earlier unsent text',targetId:'inbox',files:[file]};
  const result = mergeBackup(current, incoming);
  assert.equal(result.state.aiDraft.text, 'Current unsent text');
  assert.equal(result.state.aiRequests[0].text, 'Earlier unsent text');
  assert.equal(result.state.aiRequests[0].originalText, 'Earlier unsent text');
  assert.equal(result.state.aiRequests[0].status, 'waiting_model');
  assert.equal(result.state.aiRequests[0].files[0].blobId, 'blob-1');
  assert.equal(mergeBackup(result.state, incoming).count, 0);
  const empty = state(); empty.aiDraft = {text:'',files:[],targetId:'auto'};
  assert.deepEqual(mergeBackup(empty, incoming).state.aiDraft, incoming.aiDraft);
});

test('existing AI requests preserve current instructions and keep conflicting incoming text in history', () => {
  const current = state(); current.aiRequests = [aiRecord()];
  current.aiRequests[0].text = 'Current instructions'; current.aiRequests[0].status = 'cancelled';
  const incoming = state(); incoming.aiRequests = [aiRecord()];
  incoming.aiRequests[0].text = 'Imported instructions';
  incoming.aiRequests[0].files.push({...file,id:'extra-file',blobId:'extra-blob'});
  const result = mergeBackup(current, incoming);
  assert.equal(result.state.aiRequests[0].text, 'Current instructions');
  assert.equal(result.state.aiRequests[0].status, 'cancelled');
  assert.equal(result.state.aiRequests[0].files.length, 2);
  assert.ok(result.state.aiRequests[0].revisions.some(r => r.text === 'Imported instructions'));
  assert.equal(mergeBackup(result.state, incoming).count, 0);
});

test('canvas import uses saved layout until customized, then only fills missing cards', () => {
  const incoming = state(); incoming.canvas = layout(true); incoming.ui = {sidebarPinned:true};
  const initial = mergeBackup(state(), incoming);
  assert.deepEqual(initial.state.canvas, incoming.canvas);
  assert.deepEqual(initial.state.ui, incoming.ui);
  const current = state(); current.canvas = layout(true); current.canvas.cards = [current.canvas.cards[0]];
  current.canvas.cards[0].x = 999; current.canvas.view.zoom = 1.4; current.ui = {sidebarPinned:false};
  const result = mergeBackup(current, incoming);
  assert.equal(result.state.canvas.cards[0].x, 999);
  assert.equal(result.state.canvas.view.zoom, 1.4);
  assert.equal(result.state.canvas.cards.length, 2);
  assert.equal(result.state.ui.sidebarPinned, false);
  assert.equal(mergeBackup(result.state, incoming).count, 0);
});

test('course canvas restores from backups independently of the home canvas and remains optional', () => {
  const incoming = state(); incoming.courseCanvas = layout(true);
  incoming.courseCanvas.cards = incoming.courseCanvas.cards.map((card, index) => ({...card,id:`course-${index}`}));
  const validated = validateBackup(backup(incoming));
  assert.deepEqual(validated.state.courseCanvas, incoming.courseCanvas);
  const current = state(); current.canvas = layout(true); current.courseCanvas = layout(false);
  current.courseCanvas.view.zoom = 1.2;
  const before = structuredClone(current);
  const result = mergeBackup(current, validated);
  assert.deepEqual(result.state.courseCanvas, incoming.courseCanvas);
  assert.deepEqual(result.state.canvas, current.canvas);
  assert.deepEqual(current, before, 'restore does not mutate the current state');
  assert.deepEqual(mergeBackup(state(), validated).state.courseCanvas, incoming.courseCanvas);
  assert.equal(validateBackup(backup(state())).state.courseCanvas, undefined, 'legacy backups need no course canvas');
  assert.equal(mergeBackup(result.state, validated).count, 0);
});

test('customized course canvas preserves current geometry and view, adding only missing courses', () => {
  const incoming = state(); incoming.courseCanvas = layout(true);
  incoming.courseCanvas.cards = incoming.courseCanvas.cards.map((card, index) => ({...card,id:`course-${index}`}));
  const current = state(); current.courseCanvas = structuredClone(incoming.courseCanvas);
  current.courseCanvas.cards = [{...current.courseCanvas.cards[0],x:999,y:-100,w:650,h:700,color:'#ff44aa'}];
  current.courseCanvas.view = {x:-200,y:100,zoom:1.3};
  current.courseCanvas.presentation = 'list';
  current.courseCanvas.snap = false;
  const preserved = structuredClone(current.courseCanvas);
  const result = mergeBackup(current, validateBackup(backup(incoming)));
  assert.deepEqual(result.state.courseCanvas.cards[0], preserved.cards[0]);
  assert.deepEqual(result.state.courseCanvas.view, preserved.view);
  assert.equal(result.state.courseCanvas.presentation, 'list');
  assert.equal(result.state.courseCanvas.snap, false);
  assert.deepEqual(result.state.courseCanvas.cards[1], incoming.courseCanvas.cards[1]);
  assert.equal(result.count, 1);
  assert.equal(mergeBackup(result.state, incoming).count, 0);
});

test('inner boards restore independently and retain customized geometry on repeated import', () => {
  const incoming=state();incoming.boards={'course:example:notes':layout(true),'space:student-union:files':layout(false),tasks:layout(true)};
  const normalized=validateBackup(backup(incoming));
  assert.deepEqual(normalized.state.boards,incoming.boards);
  const current=state();current.boards={tasks:layout(true)};
  current.boards.tasks.cards=[{...current.boards.tasks.cards[0],x:1500,color:'#ff0099'}];
  const restored=mergeBackup(current,normalized);
  assert.deepEqual(restored.state.boards['course:example:notes'],incoming.boards['course:example:notes']);
  assert.equal(restored.state.boards.tasks.cards[0].x,1500);
  assert.equal(restored.state.boards.tasks.cards[0].color,'#ff0099');
  assert.equal(restored.state.boards.tasks.cards.length,2);
  assert.equal(mergeBackup(restored.state,normalized).count,0);
  assert.equal(validateBackup(backup(state())).state.boards,undefined);
});

test('inner boards reject unsafe names and invalid card geometry', () => {
  for(const boards of [JSON.parse('{"__proto__":{}}'),{constructor:layout()},{tasks:{...layout(),view:{x:0,y:0,zoom:20}}},{tasks:{...layout(),cards:[{...layout().cards[0],w:-8}]}}]){
    const value=backup();value.state.boards=boards;assert.throws(()=>validateBackup(value));
  }
});

test('validated receipts still undo imported unchanged content while preserving edited records and original files', async () => {
  const source = state(); source.spaces = [customSpace()]; source.aiRequests = [aiRecord()];
  let sequence = 0;
  const ctx = {state:source,uid:()=>`generated-${++sequence}`,save:()=>{}};
  const request = source.aiRequests[0];
  request.receipt = await routeContent(ctx, {...request,requestId:request.id}); request.status = 'filed';
  const normalized = validateBackup(backup(source)).state;
  const restored = mergeBackup(state(), normalized).state;
  restored.spaces[0].notes[0].content += '\nMy own edits after import';
  const originalFileCount = restored.aiRequests[0].files.length;
  const outcome = await undoRoute({state:restored,save:()=>{}},restored.aiRequests[0].receipt,request.id);
  assert.deepEqual(outcome, {removed:1,retained:1});
  assert.equal(restored.spaces[0].files.length, 0);
  assert.equal(restored.spaces[0].notes.length, 1);
  assert.equal(restored.aiRequests[0].files.length, originalFileCount);
  assert.equal(restored.aiRequests[0].originalText, request.originalText);
});

test('task and capture receipt snapshots survive normalization and remain reversible', async () => {
  const source = state(); source.spaces = []; source.aiRequests = [{...aiRecord(),targetId:'tasks'}];
  let sequence = 0; const ctx = {state:source,uid:()=>`task-route-${++sequence}`,save:()=>{}};
  const request = source.aiRequests[0]; request.receipt = await routeContent(ctx,{...request,requestId:request.id}); request.status = 'filed';
  const normalized = validateBackup(backup(source)).state;
  const outcome = await undoRoute({state:normalized,save:()=>{}},normalized.aiRequests[0].receipt,request.id);
  assert.deepEqual(outcome, {removed:3,retained:0});
  assert.equal(normalized.tasks.length, 0); assert.equal(normalized.captures.length, 0);
});

test('unsafe new field types, invalid geometry, invalid states and receipt containers reject', () => {
  const changes = [
    data => {data.state.spaces = [{...customSpace(),notes:[{id:'n',title:'Note',archived:'yes'}]}];},
    data => {data.state.aiRequests = [{...aiRecord(),status:'pretend-running'}];},
    data => {data.state.aiRequests = [{...aiRecord(),status:'filed'}];},
    data => {data.state.aiDraft = {text:{},files:[],targetId:'auto'};},
    data => {data.state.aiDraft = {text:'x',files:[],targetId:'javascript:alert(1)'};},
    data => {data.state.canvas = layout();data.state.canvas.cards[0].w = -1;},
    data => {data.state.canvas = layout();data.state.canvas.view.zoom = Infinity;},
    data => {data.state.canvas = layout();data.state.canvas.cards[0].id = '__proto__';},
    data => {data.state.courseCanvas = layout();data.state.courseCanvas.cards[0].w = -1;},
    data => {data.state.courseCanvas = layout();data.state.courseCanvas.view.zoom = Infinity;},
    data => {data.state.courseCanvas = layout();data.state.courseCanvas.cards[0].id = '__proto__';},
    data => {data.state.ui = {sidebarPinned:'yes'};},
    data => {data.state.tasks = [{id:'t',title:'Task',spaceId:'__proto__'}];},
    data => {data.state.aiRequests = [{...aiRecord(),status:'filed',receipt:{destinationId:'inbox',items:[{id:'x',collection:'__proto__',containerId:'inbox'}]}}];},
    data => {data.state.aiRequests = [{...aiRecord(),status:'filed',receipt:{destinationId:'inbox',items:[{id:'x',collection:'captures',containerId:'inbox',snapshot:'{"id":"different","text":"x"}'}]}}];},
  ];
  for (const change of changes) {const data = backup();change(data);assert.throws(()=>validateBackup(data));}
});
