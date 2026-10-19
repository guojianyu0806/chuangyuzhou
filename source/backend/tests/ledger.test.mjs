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
