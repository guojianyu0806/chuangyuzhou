import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {createStore, validateWorkspace} from '../store.mjs';

const stamp = '2026-09-20T12:00:00.000Z';
const ledger = () => ({version:1, currency:'CNY', projects:[{id:'p1', title:'项目', color:'#00b8b0', archived:false, createdAt:stamp, updatedAt:stamp}],
  entries:[{id:'e1', type:'expense', amountCents:29, date:'2026-09-20', category:'活动', projectId:'p1', note:'物料', archived:false, createdAt:stamp, updatedAt:stamp}]});
const state = data => ({schema:1, mode:'personal', profile:{}, english:{}, courses:[], tasks:[], captures:[], ...(data ? {ledger:data} : {})});

test('workspace accepts old schemas and rejects malformed money/calendar/project references', () => {
  assert.doesNotThrow(() => validateWorkspace(state()));
  const saved = JSON.parse(validateWorkspace(state(ledger())).serialized);
  assert.equal(saved.ledger.entries[0].amountCents, 29);
  for (const change of [
    data => data.entries[0].amountCents = 0.29,
    data => data.entries[0].amountCents = -1,
    data => data.entries[0].date = '2026-02-29',
    data => data.entries[0].projectId = 'missing',
  ]) {
    const data = ledger(); change(data);
    assert.throws(() => validateWorkspace(state(data)), error => error.code === 'invalid_ledger' && error.status === 400);
  }
});

test('ledger persists across clients, revision conflicts and old-client field loss are rejected atomically', t => {
  const directory = mkdtempSync(join(tmpdir(), 'yuzhou-ledger-test-'));
  const store = createStore(directory);
  t.after(() => {
    store.close();
    const target = resolve(directory);
    if (!target.startsWith(resolve(join(tmpdir(), 'yuzhou-ledger-test-')))) throw new Error('Unexpected test cleanup target');
    rmSync(target, {recursive:true, force:true});
  });
  store.saveWorkspace(0, state());
  store.saveWorkspace(1, state(ledger()));
  const secondClient = store.getWorkspace();
  assert.equal(secondClient.revision, 2);
  assert.equal(secondClient.state.ledger.entries[0].amountCents, 29);
  assert.throws(() => store.saveWorkspace(1, state()), error => error.code === 'revision_conflict');
  assert.throws(() => store.saveWorkspace(2, state()), error => error.code === 'workspace_update_required');
  assert.equal(store.getWorkspace().revision, 2);
  assert.equal(store.getWorkspace().state.ledger.entries[0].amountCents, 29);
  secondClient.state.ledger.entries[0].amountCents = 31;
  store.saveWorkspace(2, secondClient.state);
  assert.equal(store.getWorkspace().state.ledger.entries[0].amountCents, 31);
  const invalid = store.getWorkspace().state;
  invalid.ledger.entries[0].date = '2026-02-30';
  assert.throws(() => store.saveWorkspace(3, invalid), error => error.code === 'invalid_ledger');
  assert.equal(store.getWorkspace().revision, 3);
});

test('workspace validation preserves explicit project total settings and rejects non-booleans', () => {
  for (const includeInTotal of [false, true]) {
    const data = ledger(); data.projects[0].includeInTotal = includeInTotal;
    const saved = JSON.parse(validateWorkspace(state(data)).serialized);
    assert.equal(saved.ledger.projects[0].includeInTotal, includeInTotal);
  }
  for (const includeInTotal of ['false', 0, null, {}]) {
    const data = ledger(); data.projects[0].includeInTotal = includeInTotal;
    assert.throws(() => validateWorkspace(state(data)), error => error.code === 'invalid_ledger' && error.status === 400);
  }
});

test('an old client cannot erase an explicit total setting while editing another field', t => {
  const directory = mkdtempSync(join(tmpdir(), 'yuzhou-ledger-test-'));
  const store = createStore(directory);
  t.after(() => {
    store.close();
    const target = resolve(directory);
    if (!target.startsWith(resolve(join(tmpdir(), 'yuzhou-ledger-test-')))) throw new Error('Unexpected test cleanup target');
    rmSync(target, {recursive:true, force:true});
  });
  const original = state(ledger());
  original.ledger.projects[0].includeInTotal = false;
  store.saveWorkspace(0, original);
  for (const expected of [false, true]) {
    const snapshot = store.getWorkspace();
    assert.equal(snapshot.state.ledger.projects[0].includeInTotal, expected);
    const outdated = structuredClone(snapshot.state);
    delete outdated.ledger.projects[0].includeInTotal;
    outdated.ledger.entries[0].note = '旧客户端中改过的备注';
    assert.throws(() => store.saveWorkspace(snapshot.revision, outdated), error => error.code === 'workspace_update_required' && error.status === 409);
    assert.deepEqual(store.getWorkspace(), snapshot, 'rejected write leaves revision, note and project setting unchanged');
    const updated = structuredClone(snapshot.state);
    updated.ledger.projects[0].includeInTotal = !expected;
    store.saveWorkspace(snapshot.revision, updated);
    const secondClient = store.getWorkspace();
    assert.equal(secondClient.revision, snapshot.revision + 1);
    assert.equal(secondClient.state.ledger.projects[0].includeInTotal, !expected, 'explicit setting changes continue to synchronize');
  }
  const current = store.getWorkspace();
  const legacyProject = {...current.state.ledger.projects[0], id:'legacy-project'};
  delete legacyProject.includeInTotal;
  current.state.ledger.projects.push(legacyProject);
  store.saveWorkspace(current.revision, current.state);
  const legacyEdit = store.getWorkspace();
  legacyEdit.state.ledger.projects.find(item => item.id === 'legacy-project').title = '旧项目仍可编辑';
  store.saveWorkspace(legacyEdit.revision, legacyEdit.state);
  assert.equal(Object.hasOwn(store.getWorkspace().state.ledger.projects[1], 'includeInTotal'), false, 'legacy projects without an explicit choice remain editable');
});
