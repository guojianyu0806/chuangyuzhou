import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, validateState, propose, applyProposal, undoReceipt, exportTemplate, getCatalog, getTemplates, assetHash, detectScheduleConflicts } from '../src/domain.mjs';

let sequence = 0;
function plan(state, actions, workspaceId) {
  const scope = workspaceId ?? (state.workspaces.length === 1 && !['workspace.create', 'template.import', 'backup.import'].includes(actions[0]?.op) ? state.workspaces[0].id : undefined);
  return propose(state, { requestId: `test-${++sequence}`, actions, ...(scope ? { workspaceId: scope } : {}) });
}
function commit(state, actions, workspaceId) { return applyProposal(state, plan(state, actions, workspaceId)); }
function fixture(template = 'project') { return commit(createState(), [{ op: 'workspace.create', name: '合成测试空间', template }]); }
function error(code) { return e => e.code === code; }
const field = (state, type) => state.collections[0].fields.find(f => f.type === type);
function recordFixture() {
  let { state } = fixture(); const c = state.collections[0], title = field(state, 'text'), status = field(state, 'select'), due = field(state, 'date');
  state = commit(state, [{ op: 'record.create', collectionId: c.id, values: { [title.id]: '合成任务', [status.id]: status.options[0].id, [due.id]: '2026-10-02' } }]).state;
  return { state, c, title, status, due, record: state.records[0] };
}

test('empty state and registered catalog are independent JSON values', () => {
  const s = createState(); assert.equal(validateState(s), s); assert.equal(s.productId, 'chuang-universe');
  assert.equal(getCatalog().components.length, 5); assert.deepEqual(getTemplates().map(t => t.id), ['office', 'study', 'project']);
  const cat = getCatalog(); cat.components[0].type = 'script'; assert.equal(getCatalog().components[0].type, 'text');
});
test('blank preview is pure and commit increments only its returned state', () => {
  const initial = createState(), saved = structuredClone(initial); const p = plan(initial, [{ op: 'workspace.create', name: '我的空间', template: 'blank' }]);
  assert.deepEqual(initial, saved); assert.equal(p.previewState.revision, 0); assert.equal(p.diff[0].entity, 'workspaces');
  const r = applyProposal(initial, { ...p, message: '展示元数据' }); assert.equal(r.state.revision, 1); assert.deepEqual(initial, saved); assert.equal(r.receipt.inverse[0].after, null);
});
test('both templates use shared records through several views without demo records', () => {
  for (const template of ['study', 'project']) { const { state } = fixture(template); assert.equal(state.records.length, 0); assert.equal(state.assets.length, 0); const bindings = state.components.filter(c => c.binding.collectionId); assert.ok(bindings.length >= 2); assert.equal(new Set(bindings.map(c => c.binding.collectionId)).size, 1); validateState(state); }
});

test('office template expands atomically, keeps outer aliases and rejects duplicates without touching existing content', () => {
  const base = fixture('project').state, original = structuredClone(base);
  const actions = [{ op: 'workspace.create', name: '办公角色示例', template: 'office', timezone: 'Asia/Shanghai', ref: 'office_created' },
    { op: 'workspace.update', id: '$office_created', patch: { name: '可改名的办公示例' } }];
  const proposal = plan(base, actions);
  assert.deepEqual(base, original);
  const applied = applyProposal(base, proposal), office = applied.state.workspaces.at(-1);
  assert.equal(office.name, '可改名的办公示例');
  assert.deepEqual(office.pages.map(p => p.name), ['月度工作与会议', '部门活动筹备', '生活与个人安排']);
  assert.equal(applied.state.records.length - base.records.length, 20);
  assert.equal(applied.state.components.length - base.components.length, 15);
  for (const table of ['workspaces', 'components', 'collections', 'records', 'assets']) {
    const existingIds = new Set(base[table].map(item => item.id));
    assert.deepEqual(applied.state[table].filter(item => existingIds.has(item.id)), base[table]);
  }
  assert.throws(() => plan(applied.state, [{ op: 'workspace.create', name: '再建示例', template: 'office' }]), error('office_starter_exists'));
  const removed = undoReceipt(applied.state, applied.receipt).state;
  assert.deepEqual({ ...removed, revision: base.revision }, base);
  assert.doesNotThrow(() => plan(removed, [{ op: 'workspace.create', name: '撤销后新示例', template: 'office' }]));
  assert.throws(() => plan(base, [{ op: 'workspace.create', name: '非法附加属性', template: 'office', privateFile: 'forbidden' }]), error('domain_validation'));
  assert.deepEqual(base, original);
});
test('aliases resolve workspace/page/collection/fields/options/records and keep literal text', () => {
  const { state } = commit(createState(), [
    { op: 'workspace.create', name: '空白', template: 'blank', ref: 'home' },
    { op: 'page.create', workspaceId: '$home', name: '项目', ref: 'page' },
    { op: 'collection.create', name: '记录', ref: 'items', fields: [{ name: '标题', type: 'text', ref: 'title' }, { name: '状态', type: 'select', ref: 'status', options: [{ label: '完成', ref: 'done' }] }], semanticBindings: { title: '$title', status: '$status', doneOptions: ['$done'] } },
    { op: 'record.create', collectionId: '$items', values: { $title: '$literal not a reference', $status: '$done' }, ref: 'record' },
    { op: 'component.create', workspaceId: '$home', pageId: '$page', type: 'board', binding: { collectionId: '$items', statusFieldId: '$status' } }
  ]);
  assert.equal(state.records[0].values[state.collections[0].fields[0].id], '$literal not a reference'); assert.equal(state.components[0].pageId, state.workspaces[0].pages[1].id);
});
test('all steps fail atomically if a later action has an unknown property', () => {
  const state = createState(), before = structuredClone(state);
  assert.throws(() => plan(state, [{ op: 'workspace.create', name: '新空间', template: 'blank' }, { op: 'asset.create', title: '资料', serverPath: 'E:/private' }]), error('domain_validation')); assert.deepEqual(state, before);
});
test('unknown operation, nested unknown field, forbidden keys, overlong action list fail', () => {
  const { state } = fixture(); const w = state.workspaces[0].id;
  assert.throws(() => plan(state, [{ op: 'shell.run', command: 'echo nope' }], w), error('unknown_action'));
  assert.throws(() => plan(state, [{ op: 'component.create', type: 'text', props: { script: 'alert(1)' } }], w));
  assert.throws(() => plan(state, [{ op: 'workspace.update', id: w, patch: JSON.parse('{"__proto__":{"x":1}}') }], w));
  assert.throws(() => plan(state, Array.from({ length: 61 }, () => ({ op: 'asset.create', title: '超量' })), w));
});
test('new IDs cannot be supplied and aliases cannot point forward or collide', () => {
  const { state } = fixture('blank'); const w = state.workspaces[0].id;
  assert.throws(() => plan(state, [{ op: 'asset.create', title: '伪造', id: 'chosen' }], w));
  assert.throws(() => plan(state, [{ op: 'component.create', type: 'resources', props: { assetIds: ['$later'] } }, { op: 'asset.create', title: 'later', ref: 'later' }], w), error('unknown_reference'));
  assert.throws(() => plan(state, [{ op: 'asset.create', title: 'A', ref: 'same' }, { op: 'asset.create', title: 'B', ref: 'same' }], w));
});
test('global revision and baseline content invalidate stale proposals', () => {
  const { state } = fixture(); const w = state.workspaces[0].id;
  const p = plan(state, [{ op: 'workspace.update', id: w, patch: { name: '预览名' } }]);
  const latest = commit(state, [{ op: 'workspace.update', id: w, patch: { preferences: { density: 'compact' } } }]).state;
  assert.throws(() => applyProposal(latest, p), error('stale_proposal'));
  const changedWithoutRevision = structuredClone(state); changedWithoutRevision.workspaces[0].name = '并发编辑'; assert.throws(() => applyProposal(changedWithoutRevision, p), error('stale_proposal'));
});
test('preview tampering is rejected and repeat apply is stale', () => {
  const { state } = fixture(); const p = plan(state, [{ op: 'workspace.update', id: state.workspaces[0].id, patch: { name: '名字' } }]);
  const tampered = structuredClone(p); tampered.previewState.workspaces[0].name = '未经核对'; assert.throws(() => applyProposal(state, tampered), error('invalid_proposal'));
  const result = applyProposal(state, p); assert.throws(() => applyProposal(result.state, p), error('stale_proposal'));
});
test('field/option rename preserve IDs, used option deletion and type change fail', () => {
  const { state, c, status, record } = recordFixture();
  const r = commit(state, [{ op: 'collection.field.update', id: c.id, fieldId: status.id, patch: { name: '进展', options: status.options.map((o, i) => ({ id: o.id, label: i ? o.label : '未启动' })) } }]);
  assert.equal(r.state.records[0].values[status.id], record.values[status.id]); assert.equal(r.state.collections[0].fields.find(f => f.id === status.id).options[0].id, status.options[0].id);
  assert.throws(() => plan(state, [{ op: 'collection.field.update', id: c.id, fieldId: status.id, patch: { options: status.options.slice(1) } }]), error('unknown_reference'));
  assert.throws(() => plan(state, [{ op: 'collection.field.update', id: c.id, fieldId: status.id, patch: { type: 'text' } }]));
});
test('new fields and options can be referenced later in the same transaction', () => {
  const { state, c, status, record } = recordFixture();
  const r = commit(state, [{ op: 'collection.field.add', id: c.id, field: { name: '分数', type: 'number' }, ref: 'score' }, { op: 'collection.field.update', id: c.id, fieldId: status.id, patch: { options: [...status.options, { label: '暂停', ref: 'pause' }] } }, { op: 'record.update', id: record.id, patch: { values: { $score: 91, [status.id]: '$pause' } } }]);
  const score = r.state.collections[0].fields.find(f => f.name === '分数'); assert.equal(r.state.records[0].values[score.id], 91);
});
test('strict date and datetime validation rejects impossible or ambiguous dates', () => {
  const { state, due, record } = recordFixture();
  for (const invalid of ['明天', '10-01', '2026-02-29', '2026-04-31', '2026-01-01T24:00', '2026-01-01T09:60', '2026-01-01T10:00Z']) assert.throws(() => plan(state, [{ op: 'record.update', id: record.id, patch: { values: { [due.id]: invalid } } }]));
  for (const valid of ['2028-02-29', '2026-01-01T23:59', null]) assert.doesNotThrow(() => plan(state, [{ op: 'record.update', id: record.id, patch: { values: { [due.id]: valid } } }]));
});
test('interval semantic fields validate local date precision and ordering', () => {
  const { state } = fixture('blank'); const w = state.workspaces[0].id;
  const base = [{ op: 'collection.create', name: '安排', fields: [{ name: '开始', type: 'date', ref: 'start' }, { name: '结束', type: 'date', ref: 'end' }], semanticBindings: { start: '$start', end: '$end' }, ref: 'events' }];
  assert.throws(() => plan(state, [...base, { op: 'record.create', collectionId: '$events', values: { $start: '2026-10-02T12:00', $end: '2026-10-02T11:00' } }], w));
  assert.doesNotThrow(() => plan(state, [...base, { op: 'record.create', collectionId: '$events', values: { $start: '2026-10-02T23:00', $end: '2026-10-03T01:00' } }], w));
});
test('relations target records in the right collection with stable IDs', () => {
  const { state, c, record } = recordFixture();
  const r = commit(state, [{ op: 'collection.create', name: '备注', fields: [{ name: '事项', type: 'relation', targetCollectionId: c.id, ref: 'related' }], ref: 'notes' }, { op: 'record.create', collectionId: '$notes', values: { $related: [record.id] } }]);
  assert.deepEqual(Object.values(r.state.records[1].values)[0], [record.id]);
  assert.throws(() => plan(state, [{ op: 'collection.field.add', id: c.id, field: { name: '关联', type: 'relation', targetCollectionId: c.id }, ref: 'rel' }, { op: 'record.update', id: record.id, patch: { values: { $rel: ['missing-record'] } } }]), error('unknown_reference'));
});
test('all references and mixed action batches reject cross-space targets', () => {
  let { state } = fixture(); const first = state.workspaces[0].id; state = commit(state, [{ op: 'workspace.create', name: '第二空间', template: 'project' }]).state;
  const second = state.workspaces[1].id, other = state.collections[1];
  assert.throws(() => plan(state, [{ op: 'component.create', type: 'list', binding: { collectionId: other.id } }], first), error('cross_workspace_reference'));
  assert.throws(() => plan(state, [{ op: 'workspace.update', id: first, patch: { name: '一' } }, { op: 'workspace.update', id: second, patch: { name: '二' } }]), error('cross_workspace_reference'));
  assert.throws(() => plan(state, [{ op: 'collection.field.add', id: state.collections[0].id, field: { name: '跨空间关联', type: 'relation', targetCollectionId: other.id } }]), error('cross_workspace_reference'));
});
test('source hash ignores IDs/title; new aliases auto-fill hash and quote references verify', () => {
  const { state, c, title } = recordFixture();
  const r = commit(state, [{ op: 'asset.create', title: '合成通知', text: '请在10月2日提交报告。', ref: 'source' }, { op: 'record.create', collectionId: c.id, values: { [title.id]: '报告' }, assetIds: ['$source'], sourceRefs: [{ assetId: '$source', quote: '提交报告', fieldId: title.id }] }]);
  const a = r.state.assets[0]; assert.equal(a.hash, assetHash({ ...a, id: 'different', title: '新标题' })); assert.equal(r.state.records.at(-1).sourceRefs[0].hash, a.hash);
  for (const bad of [{ assetId: a.id, hash: a.hash, quote: '错误原文' }, { assetId: a.id, hash: 'bad', quote: '提交报告' }, { assetId: a.id, quote: '提交报告' }]) assert.throws(() => plan(r.state, [{ op: 'record.create', collectionId: c.id, values: {}, sourceRefs: [bad] }]));
});
test('editing referenced source requires coherent evidence update; link protocols are constrained', () => {
  const { state, c } = recordFixture(); const r = commit(state, [{ op: 'asset.create', title: '来源', text: '旧说明', ref: 'source' }, { op: 'record.create', collectionId: c.id, values: {}, sourceRefs: [{ assetId: '$source', quote: '旧说明' }] }]);
  assert.throws(() => plan(r.state, [{ op: 'asset.update', id: r.state.assets[0].id, patch: { text: '新说明' } }]), error('invalid_evidence'));
  for (const linkUrl of ['file:///C:/private', 'javascript:alert(1)', 'https://user:pass@example.com']) assert.throws(() => plan(state, [{ op: 'asset.create', title: '链接', linkUrl }]));
  assert.doesNotThrow(() => plan(state, [{ op: 'asset.create', title: '链接', linkUrl: 'https://example.test/path' }], state.workspaces[0].id));
});
test('automatic layout is deterministic and explicit overlap/out-of-bounds fail', () => {
  const { state } = fixture('blank'), w = state.workspaces[0].id;
  const actions = Array.from({ length: 6 }, (_, i) => ({ op: 'component.create', type: 'text', title: `笔记${i}` }));
  const one = plan(state, actions, w), two = plan(state, actions, w); assert.deepEqual(one.previewState.components.map(c => c.layout), two.previewState.components.map(c => c.layout));
  const populated = applyProposal(state, one).state;
  assert.throws(() => plan(populated, [{ op: 'component.update', id: populated.components[1].id, patch: { layout: { x: 0 } } }]), error('layout_overlap'));
  assert.throws(() => plan(state, [{ op: 'component.create', type: 'text', layout: { x: 11, y: 0, w: 4, h: 4 } }], w));
  assert.throws(() => plan(state, [{ op: 'component.create', type: 'calendar', layout: { x: 0, y: 0, w: 2, h: 2 } }], w));
});
test('view archive never deletes shared data; restore collision rejects cleanly', () => {
  const { state, record } = recordFixture(); const c = state.components[0];
  let latest = commit(state, [{ op: 'component.archive', id: c.id, archived: true }]).state; assert.ok(latest.records.some(r => r.id === record.id));
  latest = commit(latest, [{ op: 'component.create', type: c.type, title: '占位', layout: c.layout }], c.workspaceId).state;
  assert.throws(() => plan(latest, [{ op: 'component.archive', id: c.id, archived: false }]), error('layout_overlap'));
});
test('field-level undo preserves unrelated subsequent record edits', () => {
  const { state, record, title, due } = recordFixture();
  const first = commit(state, [{ op: 'record.update', id: record.id, patch: { values: { [title.id]: '第一修改' } } }]);
  const latest = commit(first.state, [{ op: 'record.update', id: record.id, patch: { values: { [due.id]: '2026-10-08' } } }]).state;
  const undone = undoReceipt(latest, { ...first.receipt, message: '额外展示信息' }); assert.equal(undone.state.records[0].values[title.id], '合成任务'); assert.equal(undone.state.records[0].values[due.id], '2026-10-08'); assert.equal(undone.state.revision, latest.revision + 1);
  assert.throws(() => undoReceipt(undone.state, undone.receipt), error('already_undone'));
});
test('same-field undo conflict stops the entire transaction without partial reversal', () => {
  const { state, record, title, due } = recordFixture();
  const first = commit(state, [{ op: 'record.update', id: record.id, patch: { values: { [title.id]: '已核对', [due.id]: '2026-10-05' } } }]);
  const latest = commit(first.state, [{ op: 'record.update', id: record.id, patch: { values: { [due.id]: '2026-10-10' } } }]).state, saved = structuredClone(latest);
  assert.throws(() => undoReceipt(latest, first.receipt), error('undo_conflict')); assert.deepEqual(latest, saved);
});
test('undo new collection rejects a later view dependency', () => {
  const { state } = fixture('blank'); const first = commit(state, [{ op: 'collection.create', name: '新集合', fields: [{ name: '标题', type: 'text' }] }], state.workspaces[0].id);
  const latest = commit(first.state, [{ op: 'component.create', type: 'list', binding: { collectionId: first.state.collections[0].id } }], state.workspaces[0].id).state;
  assert.throws(() => undoReceipt(latest, first.receipt), error('undo_dependency_conflict'));
});
test('undo new field rejects later values but preserves independent added fields', () => {
  const { state, c, record } = recordFixture();
  const first = commit(state, [{ op: 'collection.field.add', id: c.id, field: { name: '附注', type: 'text' } }]); const added = first.state.collections[0].fields.at(-1);
  const dependent = commit(first.state, [{ op: 'record.update', id: record.id, patch: { values: { [added.id]: '后来填写' } } }]).state; assert.throws(() => undoReceipt(dependent, first.receipt), error('undo_dependency_conflict'));
  const independent = commit(first.state, [{ op: 'collection.field.add', id: c.id, field: { name: '分数', type: 'number' } }]).state;
  const restored = undoReceipt(independent, first.receipt).state; assert.ok(restored.collections[0].fields.some(f => f.name === '分数')); assert.ok(!restored.collections[0].fields.some(f => f.id === added.id));
});
test('archive undo retains later unrelated content', () => {
  const { state, record, title } = recordFixture(); const archived = commit(state, [{ op: 'record.archive', id: record.id, archived: true }]);
  const latest = commit(archived.state, [{ op: 'record.update', id: record.id, patch: { values: { [title.id]: '归档后修正' } } }]).state;
  const undone = undoReceipt(latest, archived.receipt); assert.equal(undone.state.records[0].archived, false); assert.equal(undone.state.records[0].values[title.id], '归档后修正');
});
test('template export strips real records, assets and notes; import generates all new IDs', () => {
  let { state } = recordFixture(); const w = state.workspaces[0], text = state.components.find(c => c.type === 'text');
  state = commit(state, [{ op: 'component.update', id: text.id, patch: { props: { content: '仅本地私人笔记' } } }, { op: 'asset.create', title: '私人资料', text: '内容' }]).state;
  const portable = exportTemplate(state, w.id); assert.ok(!JSON.stringify(portable).includes('仅本地私人笔记')); assert.equal(portable.records, undefined); assert.equal(portable.assets, undefined);
  const imported = commit(state, [{ op: 'template.import', template: portable, name: '新的副本' }]).state;
  assert.equal(imported.workspaces.length, 2); assert.notEqual(imported.workspaces[1].id, w.id); assert.equal(imported.records.length, 1); assert.equal(imported.assets.length, 1);
  const newCollection = imported.collections[1]; assert.notEqual(newCollection.fields[0].id, state.collections[0].fields[0].id); assert.ok(imported.components.filter(c => c.workspaceId === imported.workspaces[1].id && c.binding.collectionId).every(c => c.binding.collectionId === newCollection.id));
});
test('template remaps option filters and relation field targets; malicious templates reject', () => {
  let { state } = recordFixture(); const c = state.collections[0], status = field(state, 'select'), view = state.components.find(c => c.type === 'list');
  state = commit(state, [{ op: 'collection.create', name: '关联', fields: [{ name: '目标', type: 'relation', targetCollectionId: c.id }] }, { op: 'component.update', id: view.id, patch: { props: { filter: { fieldId: status.id, operator: 'eq', value: status.options[0].id } } } }]).state;
  const portable = exportTemplate(state, state.workspaces[0].id); const imported = commit(createState(), [{ op: 'template.import', template: portable }]).state;
  assert.equal(imported.collections[1].fields[0].targetCollectionId, imported.collections[0].id); const newView = imported.components.find(c => c.type === 'list'); assert.equal(newView.props.filter.value, field(imported, 'select').options[0].id);
  portable.records = [{ secret: true }]; assert.throws(() => plan(createState(), [{ op: 'template.import', template: portable }]));
});
test('workspace archive keeps all objects and disallows edits until restored', () => {
  const { state } = fixture(), w = state.workspaces[0].id; const archived = commit(state, [{ op: 'workspace.archive', id: w, archived: true }]).state;
  assert.equal(archived.components.length, state.components.length); assert.throws(() => plan(archived, [{ op: 'component.create', type: 'text' }], w));
  const restored = commit(archived, [{ op: 'workspace.archive', id: w, archived: false }]).state; assert.equal(restored.workspaces[0].archived, false);
});
test('schema rejects dangling/cross-typed bindings and unrecognized preferences', () => {
  const { state } = fixture(), w = state.workspaces[0].id;
  assert.throws(() => plan(state, [{ op: 'workspace.update', id: w, patch: { timezone: 'Not/A_Zone' } }]));
  assert.throws(() => plan(state, [{ op: 'workspace.update', id: w, patch: { preferences: { aiKey: 'no' } } }]));
  assert.throws(() => plan(state, [{ op: 'component.create', type: 'calendar', binding: { collectionId: state.collections[0].id, dateFieldId: field(state, 'text').id } }], w));
  const corrupted = structuredClone(state); corrupted.components[0].pageId = 'missing'; assert.throws(() => validateState(corrupted));
});

test('filters and sorting can be cleared and text dollar values are preserved', () => {
  const { state, title } = recordFixture(); const view = state.components.find(c => c.type === 'list');
  const first = commit(state, [{ op: 'component.update', id: view.id, patch: { props: { filter: { fieldId: title.id, operator: 'eq', value: '$literal' }, sort: { fieldId: title.id, direction: 'asc' }, visibleFieldIds: [title.id] } } }]);
  assert.equal(first.state.components.find(c => c.id === view.id).props.filter.value, '$literal');
  const cleared = commit(first.state, [{ op: 'component.update', id: view.id, patch: { props: { filter: null, sort: null, visibleFieldIds: [] } } }]); const props = cleared.state.components.find(c => c.id === view.id).props;
  assert.equal(props.filter, undefined); assert.equal(props.sort, undefined); assert.deepEqual(props.visibleFieldIds, []);
});
test('type conversion preserves common props and shared data without obsolete properties', () => {
  let { state } = recordFixture(); const list = state.components.find(c => c.type === 'list');
  state = commit(state, [{ op: 'component.update', id: list.id, patch: { type: 'text', props: { content: '新的笔记', collapsed: true } } }]).state;
  const converted = state.components.find(c => c.id === list.id); assert.deepEqual(converted.binding, {}); assert.equal(converted.props.content, '新的笔记'); assert.equal(state.records.length, 1);
});

function scheduleFixture(items) {
  return commit(createState(), [
    { op: 'workspace.create', name: '日程合成空间', template: 'blank' },
    { op: 'collection.create', name: '个人安排', ref: 'events', fields: [{ name: '名称', type: 'text', ref: 'title' }, { name: '开始', type: 'date', ref: 'start' }, { name: '结束', type: 'date', ref: 'end' }, { name: '状态', type: 'select', ref: 'status', options: [{ label: '待办', ref: 'todo' }, { label: '完成', ref: 'done' }] }], semanticBindings: { title: '$title', start: '$start', end: '$end', status: '$status', doneOptions: ['$done'] } },
    ...items.map((item, index) => ({ op: 'record.create', collectionId: '$events', values: { $title: item.title ?? `安排${index}`, $start: item.start ?? null, $end: item.end ?? null, $status: item.done ? '$done' : '$todo' } }))
  ]).state;
}
test('schedule overlap is precise across midnight; adjacent intervals do not overlap', () => {
  const state = scheduleFixture([{ start: '2026-10-01T23:00', end: '2026-10-02T01:00' }, { start: '2026-10-02T00:30', end: '2026-10-02T02:00' }, { start: '2026-10-02T02:00', end: '2026-10-02T03:00' }]);
  const snapshot = structuredClone(state), warnings = detectScheduleConflicts(state, state.workspaces[0].id);
  assert.equal(warnings.length, 1); assert.equal(warnings[0].type, 'overlap'); assert.ok(warnings[0].message.includes('2026-10-02')); assert.deepEqual(state, snapshot);
});
test('all-day schedules occupy complete inclusive days; later days remain free', () => {
  const state = scheduleFixture([{ start: '2026-10-01', end: '2026-10-02' }, { start: '2026-10-02T23:30', end: '2026-10-03T00:00' }, { start: '2026-10-03T00:00', end: '2026-10-03T01:00' }]);
  assert.equal(detectScheduleConflicts(state, state.workspaces[0].id).length, 1);
});
test('schedule ignores done/archived records, reports missing endpoint, never treats dueDate as occupancy', () => {
  let state = scheduleFixture([{ start: '2026-10-01T10:00', end: '2026-10-01T11:00' }, { start: '2026-10-01T10:00', end: '2026-10-01T11:00', done: true }, { start: '2026-10-01T10:00' }]);
  assert.deepEqual(detectScheduleConflicts(state, state.workspaces[0].id).map(w => w.type), ['uncertain']);
  state = commit(state, [{ op: 'record.archive', id: state.records[2].id, archived: true }]).state; assert.equal(detectScheduleConflicts(state, state.workspaces[0].id).length, 0);
  const deadlines = recordFixture().state; assert.deepEqual(detectScheduleConflicts(deadlines, deadlines.workspaces[0].id), []);
});
test('deadline tasks and meetings can share interval fields without warnings for an unset interval', () => {
  const state = scheduleFixture([
    { start: null, end: null },
    { start: '2026-10-02T10:00', end: '2026-10-02T11:00' },
    { start: '2026-10-02T10:30', end: '2026-10-02T11:30' },
    { start: '2026-10-02T15:00', end: null }
  ]);
  const warnings = detectScheduleConflicts(state, state.workspaces[0].id);
  assert.equal(warnings.some(w => w.recordId === state.records[0].id), false);
  assert.equal(warnings.filter(w => w.code === 'schedule_overlap').length, 1);
  assert.equal(warnings.filter(w => w.code === 'schedule_missing_endpoint').length, 1);
  assert.equal(warnings.find(w => w.code === 'schedule_missing_endpoint').recordId, state.records[3].id);
});
test('catalog includes typed nested schemas and excludes external execution capabilities', () => {
  const cat = getCatalog(); const op = cat.actions.find(a => a.op === 'record.update'); assert.equal(op.schema.properties.patch.additionalProperties, false); assert.equal(op.schema.properties.patch.properties.assetIds.type, 'array');
  assert.ok(!cat.actions.some(a => /script|shell|sql|fetch|delete/.test(a.op)));
});
test('wrong optional types fail with domain errors rather than being silently replaced', () => {
  const { state, c } = recordFixture();
  for (const action of [
    { op: 'component.create', type: 'text', layout: null },
    { op: 'component.create', type: 'text', props: null },
    { op: 'component.create', type: 'text', binding: null },
    { op: 'component.create', type: 'text', workspaceId: null },
    { op: 'asset.create', title: '资料', text: null },
    { op: 'record.create', collectionId: c.id, values: {}, assetIds: {} },
    { op: 'record.create', collectionId: c.id, values: {}, sourceRefs: null },
    { op: 'workspace.update', id: state.workspaces[0].id, patch: { preferences: null } }
  ]) assert.throws(() => plan(state, [action]), error('domain_validation'));
});
test('undo option reorder restores order and preserves later independent new option', () => {
  const { state, c, status } = recordFixture();
  const first = commit(state, [{ op: 'collection.field.update', id: c.id, fieldId: status.id, patch: { options: [...status.options].reverse() } }]);
  const laterOptions = [...first.state.collections[0].fields.find(f => f.id === status.id).options, { label: '稍后' }];
  const latest = commit(first.state, [{ op: 'collection.field.update', id: c.id, fieldId: status.id, patch: { options: laterOptions } }]).state;
  const restored = undoReceipt(latest, first.receipt).state.collections[0].fields.find(f => f.id === status.id).options;
  assert.deepEqual(restored.slice(0, 3).map(o => o.id), status.options.map(o => o.id)); assert.equal(restored.at(-1).label, '稍后');
});
test('undo entire new template preserves an independently edited older workspace', () => {
  const { state } = fixture('study'); const originalId = state.workspaces[0].id;
  const created = commit(state, [{ op: 'workspace.create', name: '新项目', template: 'project' }]);
  const latest = commit(created.state, [{ op: 'workspace.update', id: originalId, patch: { name: '旧空间的新名字' } }], originalId).state;
  const restored = undoReceipt(latest, created.receipt).state;
  assert.equal(restored.workspaces.length, 1); assert.equal(restored.workspaces[0].name, '旧空间的新名字'); assert.equal(restored.collections.length, state.collections.length); assert.equal(restored.components.length, state.components.length);
});

const backupOf = state => ({ format: 'chuang-universe-export', version: 1, exportedAt: '2026-09-30T12:00:00.000Z', state: structuredClone(state) });
function richBackupFixture() {
  let { state, c, title, status, record } = recordFixture(); const w = state.workspaces[0], note = state.components.find(c => c.type === 'text'), list = state.components.find(c => c.type === 'list'), resources = state.components.find(c => c.type === 'resources');
  state = commit(state, [
    { op: 'workspace.update', id: w.id, patch: { timezone: 'America/New_York', preferences: { density: 'compact', theme: 'dark', accent: '#123456', favoriteComponents: ['calendar', 'text'], priorityText: '先完成资料核验，再安排写作。' } } },
    { op: 'page.create', name: '第二页', ref: 'secondPage' },
    { op: 'component.update', id: note.id, patch: { pageId: '$secondPage', props: { content: '完整保留的笔记正文 $literal' } } },
    { op: 'asset.create', title: '合成来源', text: '合成任务由用户明确提出。', ref: 'source' },
    { op: 'asset.create', title: '链接', linkUrl: 'https://example.test/resource', ref: 'link' },
    { op: 'component.update', id: resources.id, patch: { props: { assetIds: ['$source', '$link'] } } },
    { op: 'collection.create', name: '关联目录', fields: [{ name: '标题', type: 'text', ref: 'refTitle' }, { name: '反向关联', type: 'relation', targetCollectionId: c.id, ref: 'backLink' }], semanticBindings: { title: '$refTitle' }, ref: 'references' },
    { op: 'record.create', collectionId: '$references', values: { $refTitle: '归档参考', $backLink: [record.id] }, ref: 'referenceRecord' },
    { op: 'collection.field.add', id: c.id, field: { name: '说明', type: 'relation', targetCollectionId: '$references', ref: 'referencesField' } },
    { op: 'record.update', id: record.id, patch: { values: { $referencesField: ['$referenceRecord'] }, assetIds: ['$source', '$link'], sourceRefs: [{ assetId: '$source', quote: '合成任务', fieldId: title.id }] } },
    { op: 'component.update', id: list.id, patch: { props: { visibleFieldIds: [title.id, status.id], filter: { fieldId: status.id, operator: 'eq', value: status.options[0].id }, sort: { fieldId: title.id, direction: 'asc' } } } },
    { op: 'record.archive', id: '$referenceRecord', archived: true },
    { op: 'asset.archive', id: '$source', archived: true },
    { op: 'component.archive', id: resources.id, archived: true },
    { op: 'workspace.archive', id: w.id, archived: true }
  ]).state;
  state = commit(state, [{ op: 'workspace.create', name: '不应进入恢复方案的其他空间', template: 'blank' }]).state;
  return { backup: backupOf(state), sourceWorkspaceId: w.id };
}
test('backup import round-trips content, pages, preferences, cycles, source hashes and archive states with fresh IDs', () => {
  const { backup, sourceWorkspaceId } = richBackupFixture(), snapshot = structuredClone(backup), target = fixture('study').state;
  const original = structuredClone(target); const p = plan(target, [{ op: 'backup.import', backup, sourceWorkspaceId, name: '恢复的空间', ref: 'restored' }]);
  assert.deepEqual(target, original); assert.deepEqual(backup, snapshot);
  const state = applyProposal(target, p).state, w = state.workspaces.at(-1), src = backup.state.workspaces.find(w => w.id === sourceWorkspaceId);
  assert.equal(w.name, '恢复的空间'); assert.equal(w.archived, false); assert.equal(w.timezone, src.timezone); assert.deepEqual(w.preferences, src.preferences); assert.deepEqual(w.pages.map(p => p.name), src.pages.map(p => p.name));
  assert.equal(state.workspaces.length, target.workspaces.length + 1); assert.deepEqual(state.workspaces[0], target.workspaces[0]);
  const collections = state.collections.filter(c => c.workspaceId === w.id), main = collections.find(c => c.name === '项目事项'), refs = collections.find(c => c.name === '关联目录');
  const mainRecord = state.records.find(r => r.collectionId === main.id), refRecord = state.records.find(r => r.collectionId === refs.id);
  assert.deepEqual(mainRecord.values[main.fields.find(f => f.type === 'relation').id], [refRecord.id]); assert.deepEqual(refRecord.values[refs.fields.find(f => f.type === 'relation').id], [mainRecord.id]); assert.equal(refRecord.archived, true);
  const sourceAsset = state.assets.find(a => a.workspaceId === w.id && a.title === '合成来源'); assert.equal(sourceAsset.text, '合成任务由用户明确提出。'); assert.equal(sourceAsset.archived, true); assert.equal(sourceAsset.hash, backup.state.assets.find(a => a.title === '合成来源').hash);
  assert.equal(mainRecord.sourceRefs[0].assetId, sourceAsset.id); assert.equal(mainRecord.sourceRefs[0].fieldId, main.semanticBindings.title); assert.equal(mainRecord.sourceRefs[0].hash, sourceAsset.hash);
  const components = state.components.filter(c => c.workspaceId === w.id), note = components.find(c => c.type === 'text'), resource = components.find(c => c.type === 'resources'), list = components.find(c => c.type === 'list');
  assert.equal(note.props.content, '完整保留的笔记正文 $literal'); assert.equal(note.pageId, w.pages[1].id); assert.equal(resource.archived, true); assert.ok(resource.props.assetIds.includes(sourceAsset.id));
  assert.equal(list.props.filter.fieldId, main.semanticBindings.status); assert.equal(list.props.filter.value, main.fields.find(f => f.type === 'select').options[0].id); assert.equal(list.props.sort.fieldId, main.semanticBindings.title);
  const sourceIds = new Set(); const visit = value => { if (!value || typeof value !== 'object') return; if (value.id) sourceIds.add(value.id); for (const child of Object.values(value)) visit(child); }; visit(backup.state);
  const imported = { w, collections, components, records: [mainRecord, refRecord], assets: state.assets.filter(a => a.workspaceId === w.id) };
  const assertFresh = value => { if (!value || typeof value !== 'object') return; if (value.id) assert.ok(!sourceIds.has(value.id), 'source ID was reused'); for (const child of Object.values(value)) assertFresh(child); }; assertFresh(imported); validateState(state);
});
test('backup proposal stores only selected workspace while validating the entire original file', () => {
  const { backup, sourceWorkspaceId } = richBackupFixture(); const p = plan(createState(), [{ op: 'backup.import', backup, sourceWorkspaceId }]);
  assert.equal(p.actions[0].backup.state.workspaces.length, 1); assert.ok(!JSON.stringify(p.actions).includes('不应进入恢复方案')); assert.equal(backup.state.workspaces.length, 2); validateState(p.actions[0].backup.state);
  const corrupted = structuredClone(backup); corrupted.state.workspaces[1].preferences.secret = 'not-a-real-key';
  assert.throws(() => plan(createState(), [{ op: 'backup.import', backup: corrupted, sourceWorkspaceId }]), error('domain_validation'));
});
test('backup rejects private configuration, extra properties, invalid dates and foreign application state', () => {
  const { backup, sourceWorkspaceId } = richBackupFixture();
  const bads = [
    { ...backup, model: { apiKey: 'synthetic-secret' } },
    { ...backup, exportedAt: '2026-02-30T12:00:00.000Z' },
    { ...backup, state: { ...backup.state, account: {} } },
    { ...backup, state: { ...backup.state, productId: 'personal-universe' } },
    { ...backup, format: 'chuang-universe-template' }
  ];
  for (const bad of bads) assert.throws(() => plan(createState(), [{ op: 'backup.import', backup: bad, sourceWorkspaceId }]), error('domain_validation'));
  assert.throws(() => plan(createState(), [{ op: 'backup.import', backup, sourceWorkspaceId: 'missing' }]), error('unknown_reference'));
});
test('backup rejects cross-space links, dangling references and wrong source hashes before any state change', () => {
  const { backup, sourceWorkspaceId } = richBackupFixture(), target = fixture('blank').state, snapshot = structuredClone(target);
  const cross = structuredClone(backup); cross.state.assets[0].workspaceId = cross.state.workspaces[1].id;
  assert.throws(() => plan(target, [{ op: 'backup.import', backup: cross, sourceWorkspaceId }]), error('cross_workspace_reference'));
  const dangling = structuredClone(backup); dangling.state.records[0].assetIds.push('missing-asset'); assert.throws(() => plan(target, [{ op: 'backup.import', backup: dangling, sourceWorkspaceId }]), error('unknown_reference'));
  const wrongHash = structuredClone(backup); wrongHash.state.records[0].sourceRefs[0].hash = 'bad'; assert.throws(() => plan(target, [{ op: 'backup.import', backup: wrongHash, sourceWorkspaceId }]), error('invalid_evidence'));
  assert.deepEqual(target, snapshot);
});
test('backup import follows creation scope, atomic batches, stale protection and once-only apply', () => {
  const target = fixture('blank').state, backup = backupOf(recordFixture().state), sourceWorkspaceId = backup.state.workspaces[0].id;
  const action = { op: 'backup.import', backup, sourceWorkspaceId, ref: 'recovered' };
  assert.throws(() => plan(target, [action], target.workspaces[0].id), error('cross_workspace_reference'));
  assert.throws(() => plan(target, [action, action]), error('domain_validation'));
  const snapshot = structuredClone(target); assert.throws(() => plan(target, [action, { op: 'unknown.failure' }]), error('unknown_action')); assert.deepEqual(target, snapshot);
  const p = plan(target, [action, { op: 'page.create', workspaceId: '$recovered', name: '补充页面' }]); const saved = applyProposal(target, p);
  assert.equal(saved.state.workspaces.at(-1).pages.at(-1).name, '补充页面'); assert.throws(() => applyProposal(saved.state, p), error('stale_proposal'));
  const latest = commit(target, [{ op: 'workspace.update', id: target.workspaces[0].id, patch: { name: '后来手动修改' } }]).state; assert.throws(() => applyProposal(latest, p), error('stale_proposal'));
});
test('undo restored backup preserves existing spaces and refuses later dependencies', () => {
  const target = fixture('blank').state, { backup, sourceWorkspaceId } = richBackupFixture();
  const imported = commit(target, [{ op: 'backup.import', backup, sourceWorkspaceId }]);
  const latest = commit(imported.state, [{ op: 'workspace.update', id: target.workspaces[0].id, patch: { name: '原空间后续编辑' } }], target.workspaces[0].id).state;
  const undone = undoReceipt(latest, imported.receipt).state; assert.equal(undone.workspaces.length, 1); assert.equal(undone.workspaces[0].name, '原空间后续编辑'); assert.equal(undone.records.length, 0); assert.equal(undone.assets.length, 0);
  const restoredWorkspace = imported.state.workspaces.at(-1), collection = imported.state.collections.find(c => c.workspaceId === restoredWorkspace.id);
  const linked = commit(imported.state, [{ op: 'component.create', type: 'list', title: '后来增加的视图', binding: { collectionId: collection.id } }], restoredWorkspace.id).state;
  const saved = structuredClone(linked); assert.throws(() => undoReceipt(linked, imported.receipt), error('undo_dependency_conflict')); assert.deepEqual(linked, saved);
});
test('backup restores source limits without the ordinary 1 MB action ceiling, but destination caps still apply', () => {
  const state = fixture('blank').state, w = state.workspaces[0].id;
  for (let i = 0; i < 5; i++) { const asset = { id: `source-large-${i}`, workspaceId: w, title: `资料${i}`, text: 'x'.repeat(250000), linkUrl: '', archived: false }; asset.hash = assetHash(asset); state.assets.push(asset); }
  const backup = backupOf(state); assert.ok(JSON.stringify(backup).length > 1000000);
  assert.doesNotThrow(() => plan(createState(), [{ op: 'backup.import', backup, sourceWorkspaceId: w }]));
  const full = createState(); full.workspaces = Array.from({ length: 30 }, (_, i) => ({ id: 'full-w-' + i, name: '空间', pages: [{ id: 'full-p-' + i, name: '主页' }], preferences: { density: 'comfortable', theme: 'light' }, timezone: 'Asia/Shanghai', archived: false }));
  const saved = structuredClone(full); assert.throws(() => plan(full, [{ op: 'backup.import', backup, sourceWorkspaceId: w }]), error('domain_validation')); assert.deepEqual(full, saved);
});
test('explicit priorities validate, round-trip through templates, and reset through all supported default fields', () => {
  let { state } = fixture(); const id = state.workspaces[0].id;
  state = commit(state, [{ op: 'workspace.update', id, patch: { preferences: { priorityText: '优先准备答辩', favoriteComponents: ['board'], density: 'compact', theme: 'dark', accent: '#112233' } } }]).state;
  const template = exportTemplate(state, id), copy = commit(createState(), [{ op: 'template.import', template }]).state; assert.deepEqual(copy.workspaces[0].preferences, state.workspaces[0].preferences);
  const defaults = { density: 'comfortable', theme: 'light', accent: '#8b74bd', favoriteComponents: [], priorityText: '' };
  const reset = commit(state, [{ op: 'workspace.update', id, patch: { preferences: defaults } }]).state; assert.deepEqual(reset.workspaces[0].preferences, defaults);
  for (const priorityText of [null, 123, 'x'.repeat(501)]) assert.throws(() => plan(state, [{ op: 'workspace.update', id, patch: { preferences: { priorityText } } }]), error('domain_validation'));
  assert.equal(getCatalog().actions.find(a => a.op === 'backup.import').schema.properties.backup.additionalProperties, false);
  assert.equal(getCatalog().actions.find(a => a.op === 'backup.import').manualOnly, true);
});
