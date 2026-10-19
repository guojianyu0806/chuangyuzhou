import test from 'node:test';
import assert from 'node:assert/strict';
import {initializeLedger, parseAmount, formatMoney, localDate, isValidDate, validateLedger, selectEntries, summarizeEntries} from '../src/ledger-model.js';
import {initializeSpaces} from '../src/workspace-model.js';
import {validateBackup, mergeBackup} from '../src/backup.js';

const stamp = '2026-09-20T12:00:00.000Z';
const project = (id = 'p1') => ({id, title:'学生会活动', color:'#00b8b0', archived:false, createdAt:stamp, updatedAt:stamp});
const entry = (overrides = {}) => ({id:'e1', type:'expense', amountCents:29, date:'2026-09-20', category:'活动', projectId:'p1', note:'物料', archived:false, createdAt:stamp, updatedAt:stamp, ...overrides});
const ledger = () => ({version:1, currency:'CNY', projects:[project()], entries:[entry()]});
const workspace = (data) => ({schema:1, mode:'personal', profile:{name:'同学', major:'软件工程', provider:'deepseek'}, courses:[], tasks:[], captures:[], english:{}, ...(data ? {ledger:data} : {})});
const backup = state => ({format:'lumi-backup', version:1, exportedAt:stamp, state, files:[]});

test('decimal input is exact in fen and rejects rounding, zero, negative and exponent notation', () => {
  assert.equal(parseAmount('0.29'), 29);
  assert.equal(parseAmount(' 18.5 '), 1850);
  assert.equal(parseAmount('9999999.99'), 999999999);
  for (const input of ['0', '0.00', '-1.2', '+12', '1e2', '12.345', '12.', '.5', '1,000', '10000000', '', 'NaN']) assert.throws(() => parseAmount(input));
  assert.throws(() => parseAmount(1.2));
  assert.equal(formatMoney(29), '0.29');
  assert.equal(formatMoney(-123450), '-1,234.50');
  assert.equal(formatMoney(0), '0.00');
  assert.throws(() => formatMoney(0.5));
});

test('calendar validation handles leap years without UTC rollover', () => {
  for (const value of ['2024-02-29', '2000-02-29', '2026-09-30', '9999-12-31']) assert.equal(isValidDate(value), true);
  for (const value of ['1900-02-29', '2026-02-29', '2026-04-31', '2026-00-20', '2026-13-01', '2026-1-01', '2026-09-00', '1899-12-31', '2026-09-01T00:00:00Z']) assert.equal(isValidDate(value), false);
  const value = new Date(2026, 8, 20, 0, 3);
  assert.equal(localDate(value), '2026-09-20');
});

test('initialization is additive and never reseeds an existing cleared ledger', () => {
  const personal = {mode:'personal'};
  initializeSpaces(personal);
  assert.deepEqual(personal.ledger, {version:1, currency:'CNY', projects:[], entries:[]});
  const demo = {mode:'demo'};
  initializeLedger(demo);
  assert.ok(demo.ledger.entries.every(item => item.example && item.date.slice(0, 7) === localDate().slice(0, 7)));
  assert.doesNotThrow(() => validateLedger(demo.ledger));
  demo.ledger.entries = [];
  initializeLedger(demo);
  assert.deepEqual(demo.ledger.entries, []);
});

test('validation rejects broken references, duplicated IDs, invalid cents/dates and unsafe colors', () => {
  const good = ledger();
  assert.deepEqual(validateLedger(good), good);
  assert.notEqual(validateLedger(good), good);
  for (const change of [
    value => value.entries[0].amountCents = 0,
    value => value.entries[0].amountCents = 1.2,
    value => value.entries[0].amountCents = 1000000000,
    value => value.entries[0].date = '2026-04-31',
    value => value.entries[0].projectId = 'missing',
    value => value.entries.push({...value.entries[0]}),
    value => value.projects.push({...value.projects[0]}),
    value => value.projects[0].color = 'red;url(https://example.test)',
    value => value.entries[0].archived = 'false',
    value => value.entries[0].createdAt = '2026-02-30T12:00:00.000Z',
    value => value.currency = 'USD',
  ]) {
    const value = ledger(); change(value);
    assert.throws(() => validateLedger(value));
  }
  const unassigned = ledger(); unassigned.entries[0].projectId = '';
  assert.doesNotThrow(() => validateLedger(unassigned));
});

test('project total settings preserve explicit booleans and keep legacy absence distinct', () => {
  const value = ledger();
  value.projects.push({...project('included'), includeInTotal:true}, {...project('separate'), includeInTotal:false});
  const before = structuredClone(value);
  const checked = validateLedger(value);
  assert.equal(Object.hasOwn(checked.projects[0], 'includeInTotal'), false);
  assert.equal(checked.projects[1].includeInTotal, true);
  assert.equal(checked.projects[2].includeInTotal, false);
  assert.deepEqual(value, before, 'normalization must not mutate saved legacy projects');
  checked.projects[2].includeInTotal = true;
  assert.equal(value.projects[2].includeInTotal, false);
  for (const setting of ['false', 0, 1, null, {}, []]) {
    const invalid = ledger(); invalid.projects[0].includeInTotal = setting;
    assert.throws(() => validateLedger(invalid), `reject non-boolean setting ${JSON.stringify(setting)}`);
  }
});

function separatedLedger() {
  return {version:1, currency:'CNY', projects:[
    {...project('included'), title:'共同生活', includeInTotal:true},
    {...project('separate'), title:'国庆旅行', includeInTotal:false},
  ], entries:[
    entry({id:'daily-expense', projectId:'', amountCents:100, category:'餐饮', note:'日常早餐', date:'2026-10-01'}),
    entry({id:'included-expense', projectId:'included', amountCents:200, category:'交通', note:'共同车费', date:'2026-10-01'}),
    entry({id:'separate-expense', projectId:'separate', amountCents:300, category:'交通', note:'旅行车费', date:'2026-10-02'}),
  ]};
}

test('daily, project and total scopes count separate ledgers without double counting', () => {
  const value = separatedLedger(), before = structuredClone(value);
  const summary = scope => summarizeEntries(selectEntries(value, {scope}));
  assert.deepEqual(summary('daily'), {incomeCents:0, expenseCents:100, netCents:-100, count:1});
  assert.deepEqual(summary('projects'), {incomeCents:0, expenseCents:500, netCents:-500, count:2});
  assert.deepEqual(summary('total'), {incomeCents:0, expenseCents:300, netCents:-300, count:2});
  assert.deepEqual(summary('all'), {incomeCents:0, expenseCents:600, netCents:-600, count:3});
  assert.deepEqual(selectEntries(value), selectEntries(value, {scope:'all'}), 'legacy callers still receive all entries');
  for (const scope of ['all', 'projects']) {
    assert.deepEqual(selectEntries(value, {scope, projectId:'separate'}).map(item => item.id), ['separate-expense']);
  }
  assert.deepEqual(selectEntries(value, {scope:'total', projectId:'separate'}), []);
  assert.deepEqual(selectEntries(value, {scope:'daily', projectId:'included'}), []);
  assert.deepEqual(value, before, 'changing a summary scope cannot move or rewrite records');
  value.projects[1].includeInTotal = true;
  assert.equal(summary('total').expenseCents, 600, 'changing a project setting includes existing records without copying them');
  assert.equal(summary('projects').expenseCents, 500);
  assert.equal(summary('daily').expenseCents, 100);
});

test('total scope respects legacy settings, archived project history and income as well as expense', () => {
  const value = separatedLedger();
  value.projects.push(project('legacy'), {...project('archived-included'), archived:true, includeInTotal:true}, {...project('archived-separate'), archived:true, includeInTotal:false});
  value.entries.push(
    entry({id:'daily-income', projectId:'', type:'income', amountCents:1000}),
    entry({id:'included-income', projectId:'included', type:'income', amountCents:2000}),
    entry({id:'separate-income', projectId:'separate', type:'income', amountCents:3000}),
    entry({id:'legacy-expense', projectId:'legacy', amountCents:400}),
    entry({id:'archived-project-expense', projectId:'archived-included', amountCents:500}),
    entry({id:'archived-separate-expense', projectId:'archived-separate', amountCents:600}),
    entry({id:'archived-entry', projectId:'included', amountCents:700, archived:true})
  );
  assert.deepEqual(summarizeEntries(selectEntries(value, {scope:'total'})), {incomeCents:3000, expenseCents:1200, netCents:1800, count:6});
  assert.equal(summarizeEntries(selectEntries(value, {scope:'projects'})).expenseCents, 2000);
  assert.equal(summarizeEntries(selectEntries(value, {scope:'projects'})).incomeCents, 5000);
  assert.deepEqual(selectEntries(value, {scope:'total', archived:true}).map(item => item.id), ['archived-entry']);
  assert.equal(summarizeEntries(selectEntries(value, {scope:'total', archived:'all'})).expenseCents, 1900);
  assert.equal(selectEntries(value, {scope:'all', projectId:'archived-separate'}).length, 1, 'archiving a project must not hide its own spending');
});

test('accounting scopes compose with date, type, project, query and archive filters', () => {
  const value = separatedLedger();
  value.entries.push(entry({id:'included-income', projectId:'included', type:'income', amountCents:500, date:'2026-10-01', category:'收入', note:'退款'}));
  assert.deepEqual(selectEntries(value, {scope:'total', start:'2026-10-01', end:'2026-10-01', type:'expense', query:'交通'}).map(item => item.id), ['included-expense']);
  assert.deepEqual(selectEntries(value, {scope:'projects', start:'2026-10-02', end:'2026-10-02', type:'expense', query:'国庆旅行'}).map(item => item.id), ['separate-expense']);
  assert.deepEqual(selectEntries(value, {scope:'daily', query:'早餐'}).map(item => item.id), ['daily-expense']);
  assert.deepEqual(selectEntries(value, {scope:'total', type:'income', projectId:'included'}).map(item => item.id), ['included-income']);
  assert.deepEqual(selectEntries(value, {scope:'total', start:'2026-10-02', end:'2026-10-02'}), []);
});

test('inclusive date/project filters and archived selection produce precise independent summaries', () => {
  const value = ledger();
  value.entries.push(
    entry({id:'e2', type:'income', amountCents:101, date:'2026-09-21'}),
    entry({id:'e3', amountCents:11, date:'2026-08-31', projectId:''}),
    entry({id:'e4', amountCents:500, archived:true})
  );
  const selected = selectEntries(value, {start:'2026-09-20', end:'2026-09-21', projectId:'p1'});
  assert.deepEqual(selected.map(item => item.id), ['e2','e1']);
  assert.deepEqual(summarizeEntries(selected), {incomeCents:101, expenseCents:29, netCents:72, count:2});
  assert.equal(selectEntries(value, {archived:true}).length, 1);
  assert.equal(selectEntries(value, {archived:'all'}).length, 4);
  assert.equal(selectEntries(value, {projectId:''}).length, 1);
  assert.equal(selectEntries(value, {query:'学生会'}).length, 2);
  assert.equal(selectEntries(value, {type:'income'}).length, 1);
  assert.throws(() => selectEntries(value, {start:'2026-09-21', end:'2026-09-20'}));
  assert.throws(() => selectEntries(value, {start:'2026-02-29'}));
  assert.equal(value.entries[0].id, 'e1', 'filtering must not reorder source');
  assert.deepEqual(summarizeEntries([]), {incomeCents:0, expenseCents:0, netCents:0, count:0});
});

test('backup roundtrip keeps cents, projects and archive/example markers without mutating source', () => {
  const value = ledger(); value.entries[0].archived = true; value.entries[0].example = true;
  const result = validateBackup(JSON.parse(JSON.stringify(backup(workspace(value)))));
  assert.deepEqual(result.state.ledger, value);
  result.state.ledger.entries[0].amountCents = 100;
  assert.equal(value.entries[0].amountCents, 29);
});

test('backup merge is additive and idempotent, retains conflicts and preserves ledger through old backups', () => {
  const current = workspace(ledger());
  const incoming = workspace(ledger());
  incoming.ledger.projects[0].title = 'Old title';
  incoming.ledger.entries[0].amountCents = 200;
  incoming.ledger.projects.push(project('p2'));
  incoming.ledger.entries.push(entry({id:'e2', projectId:'p2', amountCents:31}));
  const merged = mergeBackup(current, incoming);
  assert.equal(merged.count, 2);
  assert.equal(merged.state.ledger.projects[0].title, '学生会活动');
  assert.equal(merged.state.ledger.entries[0].amountCents, 29);
  assert.equal(mergeBackup(merged.state, incoming).count, 0);
  assert.deepEqual(mergeBackup(merged.state, workspace()).state.ledger, merged.state.ledger);
  assert.deepEqual(current.ledger, ledger());
  assert.deepEqual(mergeBackup(workspace(), incoming).state.ledger, incoming.ledger);
  incoming.ledger.entries[1].projectId = 'missing';
  assert.throws(() => mergeBackup(current, incoming));
});
