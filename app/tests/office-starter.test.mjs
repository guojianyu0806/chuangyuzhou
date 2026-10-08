import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, validateState, propose, applyProposal, undoReceipt } from '../src/domain.mjs';
import { buildOfficeStarterActions, getOfficeStarterStatus, shanghaiToday, OFFICE_STARTER_MARKER, OFFICE_STARTER_DEFAULT_DATE } from '../src/office-starter.mjs';

let sequence = 0;
const today = OFFICE_STARTER_DEFAULT_DATE;
function plan(state, actions, workspaceId) {
  return propose(state, { requestId: `office-starter-test-${++sequence}`, actions, ...(workspaceId ? { workspaceId } : {}) });
}
function starter(state = createState(), day = today) {
  const data = buildOfficeStarterActions({ state, today: day });
  return { data, proposal: plan(state, data.actions) };
}
function commit(state, actions, workspaceId) { return applyProposal(state, plan(state, actions, workspaceId)); }
const code = value => error => error.code === value;
function allIds(state) {
  return [
    ...['workspaces', 'components', 'collections', 'records', 'assets'].flatMap(table => state[table].map(item => item.id)),
    ...state.workspaces.flatMap(item => item.pages.map(page => page.id)),
    ...state.collections.flatMap(item => item.fields.flatMap(field => [field.id, ...(field.options ?? []).map(option => option.id)]))
  ];
}

test('office starter content is reproducible, synthetic and within one transaction limit', () => {
  const first = buildOfficeStarterActions({ today }), second = buildOfficeStarterActions({ today });
  assert.deepEqual(first, second);
  assert.equal(first.fictional, true); assert.equal(first.timezone, 'Asia/Shanghai');
  assert.equal(first.actions.length, 48); assert.ok(first.actions.length <= 60);
  assert.equal(first.actions.filter(action => action.op === 'workspace.create').length, 1);
  assert.equal(first.actions.filter(action => action.op === 'page.create').length, 2);
  assert.equal(first.actions.filter(action => action.op === 'record.create').length, 20);
  assert.equal(first.actions.filter(action => action.op === 'component.create').length, 15);
  assert.equal(first.actions.filter(action => action.op === 'asset.create').length, 6);
  assert.deepEqual(first.pages.map(page => page.recordCount), [9, 6, 5]);
  for (const action of first.actions.filter(action => action.op === 'asset.create')) assert.match(action.text, /虚构/);
  assert.ok(first.actions.every(action => !['backup.import', 'template.import', 'record.update', 'asset.update'].includes(action.op)));
  first.actions[0].name = 'caller edited'; assert.notEqual(buildOfficeStarterActions({ today }).actions[0].name, first.actions[0].name);
});

test('one confirmed starter adds three pages without modifying existing workspaces or records', () => {
  let base = commit(createState(), [{ op: 'workspace.create', name: '已存在的自定义空间', template: 'project' }]).state;
  const collection = base.collections[0], title = collection.fields.find(field => field.type === 'text');
  base = commit(base, [{ op: 'record.create', collectionId: collection.id, values: { [title.id]: '原有用户事项' } }], base.workspaces[0].id).state;
  const saved = structuredClone(base), oldIds = new Set(allIds(base));
  const { proposal } = starter(base);
  assert.deepEqual(base, saved); assert.equal(proposal.previewState.revision, base.revision);
  for (const change of proposal.diff) { assert.equal(change.before, null); assert.ok(!oldIds.has(change.id)); }
  const result = applyProposal(base, proposal), status = getOfficeStarterStatus(result.state);
  assert.equal(result.state.revision, base.revision + 1);
  assert.equal(status.pageCount, 3); assert.equal(status.componentCount, 15); assert.equal(status.collectionCount, 3);
  assert.equal(status.recordCount, 20); assert.equal(status.assetCount, 6);
  for (const table of ['workspaces', 'collections', 'records', 'components', 'assets']) {
    assert.deepEqual(result.state[table].filter(item => saved[table].some(old => old.id === item.id)), saved[table]);
  }
  const newIds = allIds(result.state).filter(id => !oldIds.has(id));
  assert.equal(new Set(newIds).size, newIds.length); validateState(result.state);
});

test('each page shares its records among list, board and calendar with stable status and date semantics', () => {
  const initial = createState(), { proposal } = starter(initial), state = applyProposal(initial, proposal).state;
  const workspace = state.workspaces[0];
  for (const page of workspace.pages) {
    const components = state.components.filter(item => item.pageId === page.id);
    assert.deepEqual(components.map(item => item.type).sort(), ['board', 'calendar', 'list', 'resources', 'text']);
    const views = components.filter(item => item.binding.collectionId);
    assert.equal(new Set(views.map(item => item.binding.collectionId)).size, 1);
    const collection = state.collections.find(item => item.id === views[0].binding.collectionId);
    assert.equal(views.find(item => item.type === 'board').binding.statusFieldId, collection.semanticBindings.status);
    assert.equal(views.find(item => item.type === 'calendar').binding.dateFieldId, collection.semanticBindings.dueDate);
    assert.equal(views.find(item => item.type === 'list').props.visibleFieldIds.length, 6);
    const records = state.records.filter(item => item.collectionId === collection.id);
    assert.ok(records.length >= 5);
    for (const record of records) {
      assert.ok(record.values[collection.semanticBindings.dueDate]);
      const status = collection.fields.find(field => field.id === collection.semanticBindings.status);
      assert.ok(status.options.some(option => option.id === record.values[status.id]));
    }
  }
});

test('starter task evidence resolves to its own synthetic source with verified content hashes', () => {
  const initial = createState(), { proposal } = starter(initial), state = applyProposal(initial, proposal).state;
  for (const record of state.records) {
    assert.equal(record.sourceRefs.length, 1); assert.equal(record.assetIds.length, 2);
    const source = state.assets.find(asset => asset.id === record.sourceRefs[0].assetId);
    assert.ok(source.text.includes(record.sourceRefs[0].quote));
    assert.equal(source.hash, record.sourceRefs[0].hash);
    assert.match(source.text, /合成示例/);
    const collection = state.collections.find(item => item.id === record.collectionId);
    assert.equal(record.sourceRefs[0].fieldId, collection.semanticBindings.title);
    assert.ok(record.assetIds.includes(source.id));
  }
  validateState(state);
});

test('duplicate detection survives workspace renaming and archive and does not confuse a same-name user workspace', () => {
  const initial = createState(), { proposal } = starter(initial);
  let state = applyProposal(initial, proposal).state;
  assert.throws(() => buildOfficeStarterActions({ state, today }), code('office_starter_exists'));
  const workspaceId = state.workspaces[0].id;
  state = commit(state, [{ op: 'workspace.update', id: workspaceId, patch: { name: '重命名后的示例' } },
    { op: 'asset.archive', id: state.assets.find(asset => asset.text.startsWith(OFFICE_STARTER_MARKER)).id, archived: true },
    { op: 'workspace.archive', id: workspaceId, archived: true }], workspaceId).state;
  assert.equal(getOfficeStarterStatus(state).workspaceId, workspaceId);
  assert.equal(getOfficeStarterStatus(state).archived, true);
  assert.throws(() => buildOfficeStarterActions({ state, today: '2026-11-01' }), code('office_starter_exists'));
  const user = commit(createState(), [{ op: 'workspace.create', name: '普通上班族 · 示例工作台', template: 'blank' }]).state;
  assert.equal(getOfficeStarterStatus(user).installed, false);
  assert.doesNotThrow(() => buildOfficeStarterActions({ state: user, today }));
});

test('undo removes only the starter batch and allows a later fresh creation', () => {
  const base = commit(createState(), [{ op: 'workspace.create', name: '保留空间', template: 'blank' }]).state;
  const { proposal } = starter(base), applied = applyProposal(base, proposal), removed = undoReceipt(applied.state, applied.receipt).state;
  assert.deepEqual({ ...removed, revision: base.revision }, base);
  assert.equal(getOfficeStarterStatus(removed).installed, false);
  const replacement = applyProposal(removed, starter(removed).proposal).state;
  const firstId = getOfficeStarterStatus(applied.state).workspaceId, secondId = getOfficeStarterStatus(replacement).workspaceId;
  assert.notEqual(firstId, secondId); assert.equal(getOfficeStarterStatus(replacement).recordCount, 20);
});

test('date arithmetic respects leap years and month boundaries and rejects impossible base dates', () => {
  for (const day of ['2028-02-27', '2026-12-29']) {
    const initial = createState(), { proposal } = starter(initial, day), state = applyProposal(initial, proposal).state;
    assert.doesNotThrow(() => validateState(state));
    const work = state.collections.find(item => item.name === '工作事项与会议（示例）');
    const review = state.records.find(item => item.collectionId === work.id && item.values[work.semanticBindings.title] === '月底工作复盘');
    assert.equal(review.values[work.semanticBindings.dueDate], day === '2028-02-27' ? '2028-02-29' : '2026-12-31');
    const event = state.collections.find(item => item.name === '部门活动任务（示例）');
    const activity = state.records.find(item => item.collectionId === event.id && item.values[event.semanticBindings.title] === '组织部门交流活动');
    assert.equal(activity.values[event.semanticBindings.start], day === '2028-02-27' ? '2028-03-08T14:00' : '2027-01-08T14:00');
  }
  for (const invalid of ['2026-02-29', '2026-04-31', '2026-1-02', '2026-10-02T14:00', '昨天', '', null]) {
    assert.throws(() => buildOfficeStarterActions({ today: invalid }), code('office_date_invalid'));
  }
});

test('today is resolved in Asia/Shanghai rather than the execution host timezone', () => {
  assert.equal(shanghaiToday(new Date('2026-10-01T15:59:59Z')), '2026-10-01');
  assert.equal(shanghaiToday(new Date('2026-10-01T16:00:00Z')), '2026-10-02');
  assert.equal(shanghaiToday('2028-02-28T16:00:00Z'), '2028-02-29');
  assert.throws(() => shanghaiToday('bad'), code('office_date_invalid'));
  assert.deepEqual(getOfficeStarterStatus(createState()), { id: 'office-starter-v1', installed: false, workspaceId: null, pageCount: 0, componentCount: 0, collectionCount: 0, recordCount: 0, assetCount: 0 });
});
