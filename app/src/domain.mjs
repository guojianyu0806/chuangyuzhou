import { createHash, randomUUID } from 'node:crypto';
import { schemaForAction } from './domain-catalog.mjs';
import { buildOfficeStarterActions } from './office-starter.mjs';

// Domain functions never write files, fetch links, or mutate caller-owned state.
const TYPES = ['text', 'list', 'board', 'calendar', 'resources'];
const FIELD_TYPES = ['text', 'number', 'date', 'select', 'relation'];
const TABLES = ['workspaces', 'components', 'collections', 'records', 'assets'];
const LIMITS = { workspaces: 30, components: 400, collections: 200, records: 10000, assets: 500 };
const clone = value => structuredClone(value);
const same = (a, b) => canonical(a) === canonical(b);
const own = (o, k) => Object.hasOwn(o, k);
const provided = (o, k, fallback) => own(o, k) ? o[k] : fallback;
const fail = (message, code = 'domain_validation') => { const e = new Error(message); e.code = code; e.status = 400; throw e; };
const expect = (condition, message, code) => { if (!condition) fail(message, code); };
const uid = prefix => `${prefix}_${randomUUID()}`;
function canonical(value) {
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
export const assetHash = asset => createHash('sha256').update(JSON.stringify({ text: asset.text ?? '', linkUrl: asset.linkUrl ?? '' })).digest('hex');
function jsonSafe(value, depth = 0) {
  expect(depth <= 30, '对象嵌套过深');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') { expect(Number.isFinite(value), '数字必须有限'); return; }
  expect(typeof value === 'object', '只接受 JSON 数据');
  expect(Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null, '只接受普通对象');
  for (const [key, item] of Object.entries(value)) {
    expect(!['__proto__', 'prototype', 'constructor'].includes(key), '对象包含禁止的键');
    jsonSafe(item, depth + 1);
  }
}
function shape(obj, keys, required = []) {
  expect(obj && typeof obj === 'object' && !Array.isArray(obj), '应为对象');
  for (const key of Object.keys(obj)) expect(keys.includes(key), `不允许字段 ${key}`);
  for (const key of required) expect(own(obj, key), `缺少字段 ${key}`);
}
function string(value, name, max = 160, empty = false) {
  expect(typeof value === 'string' && value.length <= max && (empty || value.trim().length > 0), `${name}应为${empty ? '长度有限的' : '非空'}文本（最多 ${max} 字符）`);
  return value;
}
function identifier(value, name = 'ID') { return string(value, name, 100); }
function bool(value, name) { expect(typeof value === 'boolean', `${name}应为布尔值`); }
function arr(value, name, max) { expect(Array.isArray(value) && value.length <= max, `${name}应为数组，最多 ${max} 项`); }
function unique(value, name) { expect(new Set(value).size === value.length, `${name}不能重复`); }
function timezone(value) { string(value, '时区', 100); try { new Intl.DateTimeFormat('en', { timeZone: value }); } catch { fail('时区必须为有效 IANA 名称'); } }
function dateValue(value) {
  expect(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(value), '日期必须为 YYYY-MM-DD 或 YYYY-MM-DDTHH:MM');
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  expect(y >= 1000 && date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d, '日期不存在');
  if (value.length > 10) expect(Number(value.slice(11, 13)) < 24 && Number(value.slice(14, 16)) < 60, '时刻不存在');
}
function preferences(p) {
  shape(p, ['density', 'theme', 'accent', 'favoriteComponents', 'priorityText'], ['density', 'theme']);
  expect(['comfortable', 'compact'].includes(p.density), '未知密度');
  expect(['light', 'dark'].includes(p.theme), '未知主题');
  if (own(p, 'accent')) expect(/^#[0-9a-fA-F]{6}$/.test(p.accent), '主题色应为 #RRGGBB');
  if (own(p, 'favoriteComponents')) { arr(p.favoriteComponents, '常用模块', 5); unique(p.favoriteComponents, '常用模块'); for (const type of p.favoriteComponents) expect(TYPES.includes(type), '未知常用模块'); }
  if (own(p, 'priorityText')) string(p.priorityText, '重点关注', 500, true);
}
function find(state, table, id) { const item = state[table].find(row => row.id === id); expect(item, `找不到 ${table} 对象 ${id}`, 'unknown_reference'); return item; }
function workspaceOf(state, table, obj) { return table === 'workspaces' ? obj.id : table === 'records' ? find(state, 'collections', obj.collectionId).workspaceId : obj.workspaceId; }
function fieldOf(collection, id) { const field = collection.fields.find(f => f.id === id); expect(field, `找不到字段 ${id}`, 'unknown_reference'); return field; }
function fieldValue(state, collection, field, value) {
  if (value === null) return;
  if (field.type === 'text') string(value, `字段 ${field.name}`, 20000, true);
  if (field.type === 'number') expect(typeof value === 'number' && Number.isFinite(value), `${field.name}必须为有限数字`);
  if (field.type === 'date') dateValue(value);
  if (field.type === 'select') expect(field.options.some(o => o.id === value), `${field.name}引用了未知选项`, 'unknown_reference');
  if (field.type === 'relation') {
    arr(value, '关联记录', 100); unique(value, '关联记录');
    for (const id of value) expect(find(state, 'records', id).collectionId === field.targetCollectionId, '关联记录不属于目标集合', 'cross_workspace_reference');
  }
}
function layoutValid(layout, type) {
  shape(layout, ['x', 'y', 'w', 'h'], ['x', 'y', 'w', 'h']);
  for (const n of Object.values(layout)) expect(Number.isInteger(n), '布局坐标和尺寸必须为整数');
  const min = ['board', 'calendar'].includes(type) ? 4 : 2;
  expect(layout.x >= 0 && layout.y >= 0 && layout.y <= 500 && layout.w >= min && layout.w <= 12 && layout.h >= min && layout.h <= 24 && layout.x + layout.w <= 12 && layout.y + layout.h <= 524, '布局超出 12 列网格或尺寸限制');
}
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
function propsValid(state, component, collection) {
  const p = component.props;
  const specific = component.type === 'text' ? ['content'] : component.type === 'resources' ? ['assetIds'] : ['visibleFieldIds', 'filter', 'sort'];
  shape(p, ['collapsed', 'color', ...specific]);
  if (own(p, 'collapsed')) bool(p.collapsed, '折叠');
  if (own(p, 'color')) expect(/^#[0-9a-fA-F]{6}$/.test(p.color), '模块色应为 #RRGGBB');
  if (component.type === 'text') { if (own(p, 'content')) string(p.content, '笔记', 100000, true); }
  if (component.type === 'resources' && own(p, 'assetIds')) {
    arr(p.assetIds, '资料', 500); unique(p.assetIds, '资料');
    for (const id of p.assetIds) expect(find(state, 'assets', id).workspaceId === component.workspaceId, '模块资料不能跨空间', 'cross_workspace_reference');
  }
  if (own(p, 'visibleFieldIds')) { expect(collection, '显示字段需要绑定集合'); arr(p.visibleFieldIds, '显示字段', 50); unique(p.visibleFieldIds, '显示字段'); for (const id of p.visibleFieldIds) fieldOf(collection, id); }
  if (own(p, 'filter')) {
    expect(collection, '筛选需要绑定集合'); shape(p.filter, ['fieldId', 'operator', 'value'], ['fieldId', 'operator', 'value']);
    const f = fieldOf(collection, p.filter.fieldId);
    expect(['eq', 'contains', 'before', 'after'].includes(p.filter.operator), '不支持的筛选');
    if (p.filter.operator === 'contains') expect(f.type === 'text', '包含筛选只适用于文本');
    if (['before', 'after'].includes(p.filter.operator)) expect(['number', 'date'].includes(f.type), '大小筛选只适用于日期或数字');
    fieldValue(state, collection, f, p.filter.value);
  }
  if (own(p, 'sort')) { expect(collection, '排序需要绑定集合'); shape(p.sort, ['fieldId', 'direction'], ['fieldId', 'direction']); fieldOf(collection, p.sort.fieldId); expect(['asc', 'desc'].includes(p.sort.direction), '排序方向无效'); }
}

export function createState() { return { schemaVersion: 1, productId: 'chuang-universe', revision: 0, workspaces: [], components: [], collections: [], records: [], assets: [] }; }
export function validateState(state) {
  jsonSafe(state); expect(JSON.stringify(state).length <= 24000000, '空间数据超出容量');
  shape(state, ['schemaVersion', 'productId', 'revision', ...TABLES], ['schemaVersion', 'productId', 'revision', ...TABLES]);
  expect(state.schemaVersion === 1 && state.productId === 'chuang-universe', '不是创宇宙 v1 数据');
  expect(Number.isSafeInteger(state.revision) && state.revision >= 0, '数据版本无效');
  const ids = new Set();
  const claim = id => { identifier(id); expect(!ids.has(id), `ID重复 ${id}`); ids.add(id); };
  for (const table of TABLES) { arr(state[table], table, LIMITS[table]); for (const obj of state[table]) claim(obj.id); }
  for (const w of state.workspaces) {
    shape(w, ['id', 'name', 'pages', 'preferences', 'timezone', 'archived'], ['id', 'name', 'pages', 'preferences', 'timezone', 'archived']);
    string(w.name, '空间名称'); timezone(w.timezone); bool(w.archived, '归档'); preferences(w.preferences);
    arr(w.pages, '页面', 30); expect(w.pages.length > 0, '空间至少保留一页');
    for (const page of w.pages) { shape(page, ['id', 'name'], ['id', 'name']); claim(page.id); string(page.name, '页面名称'); }
  }
  for (const c of state.collections) {
    shape(c, ['id', 'workspaceId', 'name', 'fields', 'semanticBindings'], ['id', 'workspaceId', 'name', 'fields', 'semanticBindings']);
    find(state, 'workspaces', c.workspaceId); string(c.name, '集合名称'); arr(c.fields, '字段', 50); expect(c.fields.length > 0, '集合至少需要一个字段');
    for (const f of c.fields) {
      shape(f, ['id', 'name', 'type', 'options', 'targetCollectionId'], ['id', 'name', 'type']); claim(f.id); string(f.name, '字段名称', 100); expect(FIELD_TYPES.includes(f.type), '未知字段类型');
      if (f.type === 'select') {
        arr(f.options, '单选项', 100); expect(f.options.length > 0, '单选字段至少需要一个选项');
        for (const o of f.options) { shape(o, ['id', 'label'], ['id', 'label']); claim(o.id); string(o.label, '选项名称', 100); }
      } else expect(!own(f, 'options'), '非单选字段不能有选项');
      if (f.type === 'relation') expect(find(state, 'collections', f.targetCollectionId).workspaceId === c.workspaceId, '关联集合不能跨空间', 'cross_workspace_reference');
      else expect(!own(f, 'targetCollectionId'), '只有关联字段能指定目标集合');
    }
    const b = c.semanticBindings; shape(b, ['title', 'status', 'dueDate', 'start', 'end', 'doneOptions']);
    for (const key of ['title', 'status', 'dueDate', 'start', 'end']) if (own(b, key)) {
      const type = key === 'title' ? 'text' : key === 'status' ? 'select' : 'date';
      expect(fieldOf(c, b[key]).type === type, `${key}语义字段类型不符`);
    }
    if (own(b, 'doneOptions')) { expect(b.status, '完成选项需要状态字段'); arr(b.doneOptions, '完成选项', 100); unique(b.doneOptions, '完成选项'); const f = fieldOf(c, b.status); for (const id of b.doneOptions) expect(f.options.some(o => o.id === id), '完成选项不存在'); }
    expect(Boolean(b.start) === Boolean(b.end), '安排起止字段必须成对设置');
  }
  for (const asset of state.assets) {
    shape(asset, ['id', 'workspaceId', 'title', 'text', 'linkUrl', 'hash', 'archived'], ['id', 'workspaceId', 'title', 'text', 'linkUrl', 'hash', 'archived']);
    find(state, 'workspaces', asset.workspaceId); string(asset.title, '资料标题'); string(asset.text, '资料文本', 300000, true); string(asset.linkUrl, '链接', 4096, true); bool(asset.archived, '归档');
    if (asset.linkUrl) { let url; try { url = new URL(asset.linkUrl); } catch { fail('资料链接无效'); } expect(['https:', 'http:'].includes(url.protocol) && !url.username && !url.password, '资料仅允许无凭据的 HTTP/HTTPS 链接'); }
    expect(asset.hash === assetHash(asset), '资料内容哈希不匹配');
  }
  for (const record of state.records) {
    shape(record, ['id', 'collectionId', 'values', 'sourceRefs', 'assetIds', 'archived'], ['id', 'collectionId', 'values', 'sourceRefs', 'assetIds', 'archived']);
    const collection = find(state, 'collections', record.collectionId); shape(record.values, collection.fields.map(f => f.id)); bool(record.archived, '归档');
    for (const [id, value] of Object.entries(record.values)) fieldValue(state, collection, fieldOf(collection, id), value);
    const b = collection.semanticBindings;
    if (b.start && record.values[b.start] != null && record.values[b.end] != null) {
      const start = record.values[b.start], end = record.values[b.end];
      expect(start.length === end.length, '安排起止日期的精度必须一致'); expect(end >= start, '安排结束不能早于开始');
      if (start.length > 10) expect(end > start, '安排结束时刻必须晚于开始');
    }
    arr(record.assetIds, '关联资料', 100); unique(record.assetIds, '关联资料');
    for (const id of record.assetIds) expect(find(state, 'assets', id).workspaceId === collection.workspaceId, '资料关联不能跨空间', 'cross_workspace_reference');
    arr(record.sourceRefs, '来源引用', 100);
    for (const ref of record.sourceRefs) {
      shape(ref, ['assetId', 'hash', 'quote', 'fieldId'], ['assetId', 'hash', 'quote']);
      const asset = find(state, 'assets', ref.assetId); expect(asset.workspaceId === collection.workspaceId, '来源不能跨空间', 'cross_workspace_reference');
      string(ref.quote, '来源原文', 10000); expect(ref.hash === asset.hash && asset.text.includes(ref.quote), '来源版本或原文不匹配', 'invalid_evidence');
      if (own(ref, 'fieldId')) fieldOf(collection, ref.fieldId);
    }
  }
  for (const c of state.components) {
    shape(c, ['id', 'workspaceId', 'pageId', 'type', 'title', 'layout', 'props', 'binding', 'archived'], ['id', 'workspaceId', 'pageId', 'type', 'title', 'layout', 'props', 'binding', 'archived']);
    const w = find(state, 'workspaces', c.workspaceId); expect(w.pages.some(p => p.id === c.pageId), '模块页面不属于该空间', 'cross_workspace_reference');
    expect(TYPES.includes(c.type), '未知模块类型'); string(c.title, '模块标题'); bool(c.archived, '归档'); layoutValid(c.layout, c.type);
    shape(c.binding, ['collectionId', 'statusFieldId', 'dateFieldId']); let collection;
    if (c.binding.collectionId) { expect(['list', 'board', 'calendar'].includes(c.type), '此模块不接受集合绑定'); collection = find(state, 'collections', c.binding.collectionId); expect(collection.workspaceId === c.workspaceId, '模块集合不能跨空间', 'cross_workspace_reference'); }
    for (const key of ['statusFieldId', 'dateFieldId']) if (own(c.binding, key)) { expect(collection, '字段绑定需要集合'); expect(fieldOf(collection, c.binding[key]).type === (key === 'statusFieldId' ? 'select' : 'date'), '绑定字段类型不符'); }
    if (collection && c.type === 'board') expect(c.binding.statusFieldId || collection.semanticBindings.status, '看板需要明确状态字段');
    if (collection && c.type === 'calendar') expect(c.binding.dateFieldId || collection.semanticBindings.dueDate || collection.semanticBindings.start, '日历需要明确日期字段');
    propsValid(state, c, collection);
  }
  const active = state.components.filter(c => !c.archived);
  for (let i = 0; i < active.length; i++) for (let j = i + 1; j < active.length; j++) if (active[i].pageId === active[j].pageId) expect(!overlaps(active[i].layout, active[j].layout), `模块“${active[i].title}”与“${active[j].title}”重叠`, 'layout_overlap');
  return state;
}

const componentDefinitions = TYPES.map(type => ({ type, label: { text: '文本与笔记', list: '记录列表', board: '看板', calendar: '日历', resources: '资料与链接' }[type], description: { text: '可编辑文字内容', list: '共享集合的列表视图', board: '按稳定选项 ID 展示共享记录', calendar: '按日期字段展示共享记录', resources: '展示关联资料和保存的链接' }[type], minW: ['board', 'calendar'].includes(type) ? 4 : 2, minH: ['board', 'calendar'].includes(type) ? 4 : 2, defaultW: ['board', 'calendar'].includes(type) ? 6 : 4, defaultH: ['board', 'calendar'].includes(type) ? 6 : 4, props: type === 'text' ? ['content', 'collapsed', 'color'] : type === 'resources' ? ['assetIds', 'collapsed', 'color'] : ['visibleFieldIds', 'filter', 'sort', 'collapsed', 'color'] }));
const actionKeys = {
  'workspace.create': ['name', 'template', 'timezone', 'ref'], 'workspace.update': ['id', 'patch'], 'workspace.archive': ['id', 'archived'],
  'page.create': ['workspaceId', 'name', 'ref'], 'page.update': ['id', 'patch'],
  'component.create': ['workspaceId', 'pageId', 'type', 'title', 'layout', 'props', 'binding', 'ref'], 'component.update': ['id', 'patch'], 'component.archive': ['id', 'archived'],
  'collection.create': ['workspaceId', 'name', 'fields', 'semanticBindings', 'ref'], 'collection.update': ['id', 'patch'], 'collection.field.add': ['id', 'field', 'ref'], 'collection.field.update': ['id', 'fieldId', 'patch'],
  'record.create': ['collectionId', 'values', 'sourceRefs', 'assetIds', 'ref'], 'record.update': ['id', 'patch'], 'record.archive': ['id', 'archived'],
  'asset.create': ['workspaceId', 'title', 'text', 'linkUrl', 'ref'], 'asset.update': ['id', 'patch'], 'asset.archive': ['id', 'archived'],
  'template.import': ['template', 'name', 'ref'], 'backup.import': ['backup', 'sourceWorkspaceId', 'name', 'ref']
};
const actionRequired = { 'workspace.create': ['name', 'template'], 'page.create': ['name'], 'component.create': ['type'], 'collection.create': ['name', 'fields'], 'collection.field.add': ['id', 'field'], 'collection.field.update': ['id', 'fieldId', 'patch'], 'record.create': ['collectionId', 'values'], 'asset.create': ['title'], 'template.import': ['template'], 'backup.import': ['backup', 'sourceWorkspaceId'] };
const description = { 'workspace.create': '从空白或内置模板创建新空间', 'workspace.update': '修改名称、显式偏好或时区', 'workspace.archive': '归档或恢复空间', 'page.create': '添加页面', 'page.update': '修改页面名称', 'component.create': '添加注册模块，省略布局时自动排列', 'component.update': '调整模块配置；layout/props/binding按字段合并', 'component.archive': '归档或恢复模块，保留底层记录', 'collection.create': '创建可被多视图共享的集合', 'collection.update': '修改集合名称或语义绑定', 'collection.field.add': '新增稳定 ID 字段', 'collection.field.update': '改字段名称或单选项，已用选项不可删除', 'record.create': '创建集合记录', 'record.update': '按字段更新记录', 'record.archive': '归档或恢复记录', 'asset.create': '保存文字或链接，不抓取链接', 'asset.update': '更新资料；已有来源引用需同步明确更新', 'asset.archive': '归档或恢复资料', 'template.import': '从不含真实记录和资料的模板创建新空间' };
description['backup.import'] = '仅限人工上传完整导出文件并确认恢复；AI不得生成此动作。从文件选择一个空间，保留内容并重建全部 ID，恢复为独立新空间；不导入凭据或覆盖既有空间';
export function getCatalog() {
  const actions = Object.keys(actionKeys).map(op => ({ op, description: description[op], ...(op === 'backup.import' ? { manualOnly: true } : {}), schema: schemaForAction(op) }));
  return clone({ version: 1, maxActions: 60, components: componentDefinitions, fieldTypes: FIELD_TYPES, actions, protocol: { references: '新对象用ref命名，后续ID/字段键/选项值使用$ref；不能提交自定新ID', dates: 'YYYY-MM-DD 或 YYYY-MM-DDTHH:MM（空间本地时间）', relationValue: '目标集合的记录ID数组', semanticBindings: ['title', 'status', 'dueDate', 'start', 'end', 'doneOptions'], sourceRefs: '{assetId,hash,quote,fieldId?}；新建$ref资产可省略hash', props: { text: { content: 'string', collapsed: 'boolean?', color: '#RRGGBB?' }, resources: { assetIds: 'id[]?', collapsed: 'boolean?', color: '#RRGGBB?' }, views: { visibleFieldIds: 'id[]?', filter: '{fieldId,operator:eq|contains|before|after,value}?', sort: '{fieldId,direction:asc|desc}?', collapsed: 'boolean?', color: '#RRGGBB?' } }, updatePatch: { workspace: ['name', 'preferences', 'timezone'], page: ['name'], component: ['title', 'type', 'pageId', 'layout', 'props', 'binding'], collection: ['name', 'semanticBindings'], field: ['name', 'options'], record: ['values', 'sourceRefs', 'assetIds'], asset: ['title', 'text', 'linkUrl'] }, fieldDefinition: '{name,type,ref?,options?:[{label,ref?}],targetCollectionId?}', optionUpdate: 'options为完整列表；已有项{id,label}，新增项{label,ref?}；不可删除已用ID', preferences: '{density:comfortable|compact,theme:light|dark,accent?:#RRGGBB,favoriteComponents?:type[],priorityText?:string(<=500)}' } });
}
export function getTemplates() { return [{ id: 'office', name: '普通上班族', description: '月度工作与会议、部门活动筹备、生活安排三页，含可编辑的虚构示例事务与资料', components: ['text', 'list', 'board', 'calendar', 'resources'], sampleDataPolicy: 'fictional-example' }, { id: 'study', name: '学习与备考', description: '目标说明、共享学习任务列表与日历、资料', components: ['text', 'list', 'calendar', 'resources'] }, { id: 'project', name: '个人项目推进', description: '项目说明、同一任务集合的列表、看板、日历及资料', components: ['text', 'list', 'board', 'calendar', 'resources'] }]; }

function autoLayout(state, pageId, type) {
  const def = componentDefinitions.find(d => d.type === type); expect(def, '未知模块类型');
  const occupied = state.components.filter(c => c.pageId === pageId && !c.archived);
  for (let y = 0; y <= 500; y++) for (let x = 0; x <= 12 - def.defaultW; x++) {
    const layout = { x, y, w: def.defaultW, h: def.defaultH };
    if (!occupied.some(c => overlaps(layout, c.layout))) return layout;
  }
  fail('此页面没有足够布局空间');
}
function templateContent(state, w, type) {
  const title = { id: uid('field'), name: '事项', type: 'text' };
  const status = { id: uid('field'), name: '状态', type: 'select', options: ['待办', '进行中', '已完成'].map(label => ({ id: uid('option'), label })) };
  const due = { id: uid('field'), name: '日期', type: 'date' };
  const collection = { id: uid('collection'), workspaceId: w.id, name: type === 'study' ? '学习任务' : '项目事项', fields: [title, status, due], semanticBindings: { title: title.id, status: status.id, dueDate: due.id, doneOptions: [status.options[2].id] } };
  state.collections.push(collection);
  const kinds = getTemplates().find(t => t.id === type).components;
  for (const kind of kinds) {
    const props = kind === 'text' ? { content: '' } : kind === 'resources' ? { assetIds: [] } : {};
    const binding = ['list', 'board', 'calendar'].includes(kind) ? { collectionId: collection.id } : {};
    state.components.push({ id: uid('component'), workspaceId: w.id, pageId: w.pages[0].id, type: kind, title: componentDefinitions.find(d => d.type === kind).label, layout: autoLayout(state, w.pages[0].id, kind), props, binding, archived: false });
  }
}

function executeActions(state, actions, initialWorkspaceId) {
  const aliases = new Map(); let currentWorkspaceId = initialWorkspaceId;
  const resolve = value => { if (typeof value !== 'string' || !value.startsWith('$')) return value; const id = aliases.get(value.slice(1)); expect(id, `临时引用 ${value} 不存在或尚未创建`, 'unknown_reference'); return id; };
  const register = (ref, id) => { if (ref === undefined) return; expect(typeof ref === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,49}$/.test(ref), 'ref须为字母开头的短标识'); expect(!aliases.has(ref), `ref ${ref} 重复`); aliases.set(ref, id); };
  const scope = id => { identifier(id); if (!currentWorkspaceId) currentWorkspaceId = id; expect(currentWorkspaceId === id, '单次方案只允许操作一个空间', 'cross_workspace_reference'); return find(state, 'workspaces', id); };
  const workspace = id => { const w = scope(resolve(id ?? currentWorkspaceId)); expect(!w.archived, '请先恢复已归档空间'); return w; };
  const target = (table, id) => { const obj = find(state, table, resolve(id)); workspace(workspaceOf(state, table, obj)); return obj; };
  const resolveBindings = b => { shape(b, ['title', 'status', 'dueDate', 'start', 'end', 'doneOptions']); return Object.fromEntries(Object.entries(b).map(([k, v]) => [k, k === 'doneOptions' ? (arr(v, '完成选项', 100), v.map(resolve)) : resolve(v)])); };
  const makeField = input => {
    shape(input, ['name', 'type', 'ref', 'options', 'targetCollectionId'], ['name', 'type']);
    const f = { id: uid('field'), name: input.name, type: input.type }; register(input.ref, f.id);
    if (own(input, 'options')) { arr(input.options, '选项', 100); f.options = input.options.map(o => { shape(o, ['label', 'ref'], ['label']); const result = { id: uid('option'), label: o.label }; register(o.ref, result.id); return result; }); }
    if (own(input, 'targetCollectionId')) f.targetCollectionId = resolve(input.targetCollectionId);
    return f;
  };
  const values = (collection, input) => { shape(input, Object.keys(input)); const out = {}; for (const [key, value] of Object.entries(input)) { const id = resolve(key); expect(!own(out, id), '同一字段重复赋值'); const f = fieldOf(collection, id); out[id] = f.type === 'select' ? resolve(value) : f.type === 'relation' && Array.isArray(value) ? value.map(resolve) : clone(value); } return out; };
  const refs = input => { arr(input, '来源', 100); return input.map(ref => {
    shape(ref, ['assetId', 'hash', 'quote', 'fieldId'], ['assetId', 'quote']); const assetId = resolve(ref.assetId); const r = { ...ref, assetId };
    if (typeof ref.assetId === 'string' && ref.assetId.startsWith('$') && !own(ref, 'hash')) r.hash = find(state, 'assets', assetId).hash;
    if (own(r, 'fieldId')) r.fieldId = resolve(r.fieldId); return r;
  }); };
  const componentProps = (props, collectionId) => {
    shape(props, ['content', 'assetIds', 'visibleFieldIds', 'filter', 'sort', 'collapsed', 'color']);
    const p = clone(props);
    if (Array.isArray(p.visibleFieldIds)) p.visibleFieldIds = p.visibleFieldIds.map(resolve);
    if (Array.isArray(p.assetIds)) p.assetIds = p.assetIds.map(resolve);
    if (p.sort?.fieldId) p.sort.fieldId = resolve(p.sort.fieldId);
    if (p.filter?.fieldId) {
      p.filter.fieldId = resolve(p.filter.fieldId);
      const collection = collectionId ? find(state, 'collections', collectionId) : undefined;
      const field = collection ? fieldOf(collection, p.filter.fieldId) : undefined;
      if (field?.type === 'select') p.filter.value = resolve(p.filter.value);
      if (field?.type === 'relation' && Array.isArray(p.filter.value)) p.filter.value = p.filter.value.map(resolve);
    }
    for (const key of ['filter', 'sort']) if (p[key] === null) delete p[key];
    return p;
  };
  const componentBinding = b => { shape(b, ['collectionId', 'statusFieldId', 'dateFieldId']); return Object.fromEntries(Object.entries(b).map(([k, v]) => [k, resolve(v)])); };
  for (const a of actions) {
    expect(a && typeof a.op === 'string' && own(actionKeys, a.op), `未注册动作 ${a?.op}`, 'unknown_action');
    shape(a, ['op', ...actionKeys[a.op]], ['op', ...(actionRequired[a.op] ?? (a.op.endsWith('.archive') ? ['id', 'archived'] : ['id', 'patch']))]);
    for (const key of ['workspaceId', 'pageId', 'ref']) if (own(a, key)) string(a[key], key, 100);
    if (a.op === 'workspace.create') {
      expect(!currentWorkspaceId, '不能在一个既有空间的方案中创建另一空间', 'cross_workspace_reference'); expect(['blank', 'study', 'project', 'office'].includes(a.template), '未知起始模板');
      if (a.template === 'office') {
        const starter = buildOfficeStarterActions({ state, name: a.name });
        if (own(a, 'timezone')) starter.actions[0].timezone = a.timezone;
        currentWorkspaceId = executeActions(state, starter.actions);
        const officeWorkspace = find(state, 'workspaces', currentWorkspaceId);
        officeWorkspace.pages[0].name = '月度工作与会议';
        register(a.ref, currentWorkspaceId);
        continue;
      }
      const w = { id: uid('workspace'), name: a.name, pages: [{ id: uid('page'), name: '主页' }], preferences: { density: 'comfortable', theme: 'light' }, timezone: provided(a, 'timezone', 'Asia/Shanghai'), archived: false };
      state.workspaces.push(w); currentWorkspaceId = w.id; register(a.ref, w.id); if (a.template !== 'blank') templateContent(state, w, a.template);
    } else if (a.op === 'workspace.archive') { const w = scope(resolve(a.id)); bool(a.archived, '归档'); w.archived = a.archived;
    } else if (a.op === 'workspace.update') { const w = target('workspaces', a.id); shape(a.patch, ['name', 'preferences', 'timezone']); if (own(a.patch, 'preferences')) { shape(a.patch.preferences, ['density', 'theme', 'accent', 'favoriteComponents', 'priorityText']); w.preferences = { ...w.preferences, ...clone(a.patch.preferences) }; } for (const k of ['name', 'timezone']) if (own(a.patch, k)) w[k] = a.patch[k];
    } else if (a.op === 'page.create') { const w = workspace(a.workspaceId); const p = { id: uid('page'), name: a.name }; w.pages.push(p); register(a.ref, p.id);
    } else if (a.op === 'page.update') { const id = resolve(a.id); const w = state.workspaces.find(w => w.pages.some(p => p.id === id)); expect(w, '页面不存在', 'unknown_reference'); workspace(w.id); shape(a.patch, ['name']); Object.assign(w.pages.find(p => p.id === id), a.patch);
    } else if (a.op === 'collection.create') { const w = workspace(a.workspaceId); arr(a.fields, '字段', 50); const c = { id: uid('collection'), workspaceId: w.id, name: a.name, fields: [], semanticBindings: {} }; register(a.ref, c.id); c.fields = a.fields.map(makeField); c.semanticBindings = resolveBindings(provided(a, 'semanticBindings', {})); state.collections.push(c);
    } else if (a.op === 'collection.update') { const c = target('collections', a.id); shape(a.patch, ['name', 'semanticBindings']); if (own(a.patch, 'name')) c.name = a.patch.name; if (own(a.patch, 'semanticBindings')) c.semanticBindings = resolveBindings(a.patch.semanticBindings);
    } else if (a.op === 'collection.field.add') { const c = target('collections', a.id); const f = makeField(a.field); register(a.ref, f.id); c.fields.push(f);
    } else if (a.op === 'collection.field.update') {
      const c = target('collections', a.id); const f = fieldOf(c, resolve(a.fieldId)); shape(a.patch, ['name', 'options']);
      if (own(a.patch, 'name')) f.name = a.patch.name;
      if (own(a.patch, 'options')) { expect(f.type === 'select', '只有单选字段能改选项'); arr(a.patch.options, '选项', 100); const oldIds = new Set(f.options.map(o => o.id)); f.options = a.patch.options.map(o => { shape(o, ['id', 'label', 'ref'], ['label']); const id = o.id === undefined ? uid('option') : resolve(o.id); expect(o.id === undefined || oldIds.has(id), '不能指定外来选项 ID'); register(o.ref, id); return { id, label: o.label }; }); }
    } else if (a.op === 'component.create') {
      const w = workspace(a.workspaceId); const pageId = resolve(a.pageId ?? w.pages[0].id); const def = componentDefinitions.find(d => d.type === a.type); expect(def, '未知模块类型');
      const binding = componentBinding(provided(a, 'binding', {}));
      const c = { id: uid('component'), workspaceId: w.id, pageId, type: a.type, title: provided(a, 'title', def.label), layout: own(a, 'layout') ? clone(a.layout) : autoLayout(state, pageId, a.type), props: componentProps(provided(a, 'props', a.type === 'text' ? { content: '' } : a.type === 'resources' ? { assetIds: [] } : {}), binding.collectionId), binding, archived: false }; state.components.push(c); register(a.ref, c.id);
    } else if (a.op === 'component.update') {
      const c = target('components', a.id); shape(a.patch, ['title', 'type', 'pageId', 'layout', 'props', 'binding']);
      if (own(a.patch, 'type') && a.patch.type !== c.type && !(['list', 'board', 'calendar'].includes(c.type) && ['list', 'board', 'calendar'].includes(a.patch.type))) {
        c.props = Object.fromEntries(Object.entries(c.props).filter(([key]) => ['collapsed', 'color'].includes(key)));
        if (['text', 'resources'].includes(a.patch.type)) c.binding = {};
      }
      for (const k of ['title', 'type']) if (own(a.patch, k)) c[k] = a.patch[k]; if (own(a.patch, 'pageId')) c.pageId = resolve(a.patch.pageId);
      if (own(a.patch, 'layout')) { shape(a.patch.layout, ['x', 'y', 'w', 'h']); c.layout = { ...c.layout, ...a.patch.layout }; }
      if (own(a.patch, 'binding')) c.binding = componentBinding(a.patch.binding);
      if (own(a.patch, 'props')) {
        shape(a.patch.props, ['content', 'assetIds', 'visibleFieldIds', 'filter', 'sort', 'collapsed', 'color']);
        c.props = { ...c.props, ...componentProps(a.patch.props, c.binding.collectionId) };
        for (const key of ['filter', 'sort']) if (a.patch.props[key] === null) delete c.props[key];
      }
    } else if (a.op === 'record.create') {
      const c = target('collections', a.collectionId); const assetIds = provided(a, 'assetIds', []); arr(assetIds, '关联资料', 100);
      const record = { id: uid('record'), collectionId: c.id, values: values(c, a.values), sourceRefs: refs(provided(a, 'sourceRefs', [])), assetIds: assetIds.map(resolve), archived: false }; state.records.push(record); register(a.ref, record.id);
    } else if (a.op === 'record.update') {
      const r = target('records', a.id); const c = find(state, 'collections', r.collectionId); shape(a.patch, ['values', 'sourceRefs', 'assetIds']);
      if (own(a.patch, 'values')) r.values = { ...r.values, ...values(c, a.patch.values) }; if (own(a.patch, 'sourceRefs')) r.sourceRefs = refs(a.patch.sourceRefs); if (own(a.patch, 'assetIds')) { arr(a.patch.assetIds, '关联资料', 100); r.assetIds = a.patch.assetIds.map(resolve); }
    } else if (a.op === 'asset.create') {
      const w = workspace(a.workspaceId); const asset = { id: uid('asset'), workspaceId: w.id, title: a.title, text: provided(a, 'text', ''), linkUrl: provided(a, 'linkUrl', ''), archived: false }; asset.hash = assetHash(asset); state.assets.push(asset); register(a.ref, asset.id);
    } else if (a.op === 'asset.update') { const asset = target('assets', a.id); shape(a.patch, ['title', 'text', 'linkUrl']); Object.assign(asset, clone(a.patch)); asset.hash = assetHash(asset);
    } else if (a.op.endsWith('.archive')) { const table = { component: 'components', record: 'records', asset: 'assets' }[a.op.split('.')[0]]; const obj = target(table, a.id); bool(a.archived, '归档'); obj.archived = a.archived;
    } else if (a.op === 'template.import') { expect(!currentWorkspaceId, '模板必须创建为新空间', 'cross_workspace_reference'); const w = importPortable(state, a.template, a.name); currentWorkspaceId = w.id; register(a.ref, w.id);
    } else if (a.op === 'backup.import') { expect(!currentWorkspaceId, '备份必须恢复为独立新空间', 'cross_workspace_reference'); const w = importBackup(state, a.backup, a.sourceWorkspaceId, a.name); currentWorkspaceId = w.id; register(a.ref, w.id); }
  }
  return currentWorkspaceId;
}

function differences(before, after) {
  const diff = [];
  for (const table of TABLES) {
    const first = new Map(before[table].map(o => [o.id, o])); const next = new Map(after[table].map(o => [o.id, o]));
    for (const id of new Set([...first.keys(), ...next.keys()])) {
      const b = first.get(id) ?? null, a = next.get(id) ?? null;
      if (!same(b, a)) diff.push({ entity: table, id, description: `${b === null ? '新增' : a === null ? '移除' : '修改'} ${a?.name ?? a?.title ?? b?.name ?? b?.title ?? id}`, before: clone(b), after: clone(a) });
    }
  }
  return diff;
}
const proposalIntegrity = p => digest({ id: p.id, requestId: p.requestId, workspaceId: p.workspaceId, baseRevision: p.baseRevision, baseHash: p.baseHash, actions: p.actions, diff: p.diff, previewState: p.previewState, createdAt: p.createdAt });
export function propose(state, input) {
  validateState(state); jsonSafe(input); shape(input, ['workspaceId', 'requestId', 'actions'], ['requestId', 'actions']); string(input.requestId, '请求 ID', 120);
  arr(input.actions, '动作', 60); expect(input.actions.length > 0, '方案至少需要一个动作');
  const backupCount = input.actions.filter(action => action?.op === 'backup.import').length;
  expect(backupCount <= 1, '单次方案只能恢复一个备份空间');
  expect(JSON.stringify(input.actions).length <= (backupCount ? 24001000 : 1000000), '方案内容过大');
  if (backupCount) expect(JSON.stringify(input.actions.filter(action => action.op !== 'backup.import')).length <= 1000000, '恢复之外的普通动作内容过大');
  if (input.workspaceId !== undefined) find(state, 'workspaces', input.workspaceId);
  const next = clone(state); const workspaceId = executeActions(next, input.actions, input.workspaceId); validateState(next);
  const recordedActions = clone(input.actions);
  for (const action of recordedActions) if (action.op === 'backup.import') action.backup.state = selectBackupWorkspace(action.backup.state, action.sourceWorkspaceId);
  const result = { id: uid('proposal'), requestId: input.requestId, workspaceId, baseRevision: state.revision, baseHash: digest(state), actions: recordedActions, diff: differences(state, next), previewState: next, createdAt: new Date().toISOString() };
  expect(result.diff.length > 0, '方案没有实际变化', 'no_changes'); result.integrity = proposalIntegrity(result); return result;
}
export function applyProposal(state, proposal) {
  validateState(state); jsonSafe(proposal);
  expect(proposal.integrity === proposalIntegrity(proposal), '方案内容发生变化，请重新预览', 'invalid_proposal');
  expect(state.revision === proposal.baseRevision && digest(state) === proposal.baseHash, '空间已变更，请重新生成方案', 'stale_proposal');
  validateState(proposal.previewState); expect(same(differences(state, proposal.previewState), proposal.diff), '方案差异不一致', 'invalid_proposal');
  const next = clone(proposal.previewState); next.revision = state.revision + 1; validateState(next);
  const receipt = { id: uid('receipt'), proposalId: proposal.id, requestId: proposal.requestId, workspaceId: proposal.workspaceId, baseRevision: state.revision, appliedRevision: next.revision, status: 'applied', changes: clone(proposal.diff), inverse: proposal.diff.map(d => ({ ...clone(d), before: clone(d.after), after: clone(d.before) })), createdAt: new Date().toISOString() };
  receipt.integrity = receiptIntegrity(receipt); return { state: next, receipt };
}
function receiptIntegrity(r) { return digest({ id: r.id, proposalId: r.proposalId, requestId: r.requestId, workspaceId: r.workspaceId, baseRevision: r.baseRevision, appliedRevision: r.appliedRevision, changes: r.changes, inverse: r.inverse, createdAt: r.createdAt }); }
const MISSING = Symbol('missing');
const equalMaybe = (a, b) => a === MISSING || b === MISSING ? a === b : same(a, b);
function reverseMerge(before, after, current, path) {
  if (equalMaybe(before, after)) return current;
  if (before === MISSING || after === MISSING) { expect(equalMaybe(current, after), `撤销冲突：${path}已有后续修改`, 'undo_conflict'); return before === MISSING ? MISSING : clone(before); }
  if (before && after && !Array.isArray(before) && !Array.isArray(after) && typeof before === 'object' && typeof after === 'object') {
    expect(current !== MISSING && current && typeof current === 'object' && !Array.isArray(current), `撤销冲突：${path}已被删除`, 'undo_conflict');
    const result = clone(current);
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const value = reverseMerge(own(before, key) ? before[key] : MISSING, own(after, key) ? after[key] : MISSING, own(current, key) ? current[key] : MISSING, `${path}.${key}`);
      if (value === MISSING) delete result[key]; else result[key] = value;
    }
    return result;
  }
  if (Array.isArray(before) && Array.isArray(after) && Array.isArray(current) && [...before, ...after, ...current].every(o => o && typeof o === 'object' && typeof o.id === 'string')) {
    const result = clone(current); const b = new Map(before.map(o => [o.id, o])), a = new Map(after.map(o => [o.id, o]));
    for (const id of new Set([...b.keys(), ...a.keys()])) {
      const index = result.findIndex(o => o.id === id); const value = reverseMerge(b.get(id) ?? MISSING, a.get(id) ?? MISSING, index < 0 ? MISSING : result[index], `${path}[${id}]`);
      if (value === MISSING && index >= 0) result.splice(index, 1); else if (value !== MISSING && index < 0) result.push(value); else if (value !== MISSING) result[index] = value;
    }
    const beforeCommon = before.filter(o => a.has(o.id)).map(o => o.id), afterCommon = after.filter(o => b.has(o.id)).map(o => o.id);
    if (!same(beforeCommon, afterCommon) || before.some(o => !a.has(o.id))) {
      const currentIds = new Set(current.map(o => o.id));
      expect(same(current.filter(o => a.has(o.id)).map(o => o.id), after.filter(o => currentIds.has(o.id)).map(o => o.id)), `撤销冲突：${path}顺序已有后续修改`, 'undo_conflict');
      const records = new Map(result.map(o => [o.id, o]));
      const ordered = before.filter(o => records.has(o.id)).map(o => records.get(o.id));
      let position = 0;
      for (let i = 0; i < result.length; i++) if (b.has(result[i].id)) result[i] = ordered[position++];
    }
    return result;
  }
  expect(equalMaybe(current, after), `撤销冲突：${path}已有后续修改`, 'undo_conflict'); return clone(before);
}
export function undoReceipt(state, receipt) {
  validateState(state); jsonSafe(receipt); expect(receipt.integrity === receiptIntegrity(receipt), '回执内容已变更', 'invalid_receipt');
  expect(receipt.status === 'applied', '回执已经撤销', 'already_undone'); expect(state.revision >= receipt.appliedRevision, '回执版本晚于当前空间', 'invalid_receipt');
  const next = clone(state);
  for (const change of receipt.changes) {
    expect(TABLES.includes(change.entity), '回执对象类型无效', 'invalid_receipt'); const rows = next[change.entity], index = rows.findIndex(o => o.id === change.id);
    const result = reverseMerge(change.before ?? MISSING, change.after ?? MISSING, index < 0 ? MISSING : rows[index], `${change.entity}.${change.id}`);
    if (result === MISSING && index >= 0) rows.splice(index, 1); else if (result !== MISSING && index < 0) rows.push(result); else if (result !== MISSING) rows[index] = result;
  }
  next.revision = state.revision + 1;
  try { validateState(next); } catch (error) { fail(`撤销被后续依赖或布局阻止：${error.message}。请先处理关联对象。`, 'undo_dependency_conflict'); }
  const updated = { ...clone(receipt), status: 'undone', undoneRevision: next.revision, undoneAt: new Date().toISOString() };
  return { state: next, receipt: updated };
}

export function exportTemplate(state, workspaceId) {
  validateState(state); const w = clone(find(state, 'workspaces', workspaceId));
  const collections = clone(state.collections.filter(c => c.workspaceId === workspaceId));
  const components = clone(state.components.filter(c => c.workspaceId === workspaceId && !c.archived));
  for (const c of components) { if (c.type === 'text') c.props.content = ''; if (c.type === 'resources') c.props.assetIds = []; if (c.props.filter) { const collection = collections.find(x => x.id === c.binding.collectionId); if (collection && fieldOf(collection, c.props.filter.fieldId).type === 'relation') delete c.props.filter; } }
  w.archived = false;
  return { format: 'chuang-universe-template', version: 1, name: w.name, workspace: w, collections, components, sampleDataPolicy: 'structure-only' };
}
function importPortable(state, template, name) {
  jsonSafe(template); shape(template, ['format', 'version', 'name', 'workspace', 'collections', 'components', 'sampleDataPolicy'], ['format', 'version', 'name', 'workspace', 'collections', 'components', 'sampleDataPolicy']);
  string(template.name, '模板名称');
  expect(template.format === 'chuang-universe-template' && template.version === 1 && template.sampleDataPolicy === 'structure-only', '模板格式或版本不支持');
  const test = createState(); test.workspaces = [clone(template.workspace)]; test.collections = clone(template.collections); test.components = clone(template.components); validateState(test);
  for (const component of test.components) { if (component.type === 'text') expect(!component.props.content, '结构模板不能携带笔记内容'); if (component.type === 'resources') expect(!component.props.assetIds?.length, '结构模板不能携带资料'); }
  const map = new Map(); const allocate = (id, prefix) => map.set(id, uid(prefix));
  for (const w of test.workspaces) { allocate(w.id, 'workspace'); for (const p of w.pages) allocate(p.id, 'page'); }
  for (const c of test.collections) { allocate(c.id, 'collection'); for (const f of c.fields) { allocate(f.id, 'field'); for (const o of f.options ?? []) allocate(o.id, 'option'); } }
  for (const c of test.components) allocate(c.id, 'component');
  const remap = value => { expect(map.has(value), `模板引用不完整 ${value}`); return map.get(value); };
  const w = test.workspaces[0]; w.id = remap(w.id); for (const p of w.pages) p.id = remap(p.id); if (name !== undefined) w.name = name; w.archived = false;
  for (const c of test.collections) {
    c.id = remap(c.id); c.workspaceId = w.id;
    for (const f of c.fields) { f.id = remap(f.id); if (f.options) for (const o of f.options) o.id = remap(o.id); if (f.targetCollectionId) f.targetCollectionId = remap(f.targetCollectionId); }
    for (const key of Object.keys(c.semanticBindings)) c.semanticBindings[key] = key === 'doneOptions' ? c.semanticBindings[key].map(remap) : remap(c.semanticBindings[key]);
  }
  for (const c of test.components) {
    c.id = remap(c.id); c.workspaceId = w.id; c.pageId = remap(c.pageId); for (const key of Object.keys(c.binding)) c.binding[key] = remap(c.binding[key]);
    if (c.props.visibleFieldIds) c.props.visibleFieldIds = c.props.visibleFieldIds.map(remap);
    if (c.props.sort) c.props.sort.fieldId = remap(c.props.sort.fieldId);
    if (c.props.filter) { c.props.filter.fieldId = remap(c.props.filter.fieldId); const col = test.collections.find(x => x.id === c.binding.collectionId); if (fieldOf(col, c.props.filter.fieldId).type === 'select' && c.props.filter.value !== null) c.props.filter.value = remap(c.props.filter.value); }
  }
  state.workspaces.push(w); state.collections.push(...test.collections); state.components.push(...test.components); return w;
}

function selectBackupWorkspace(source, workspaceId) {
  const selected = createState(); selected.revision = source.revision;
  selected.workspaces = [clone(find(source, 'workspaces', workspaceId))];
  for (const table of ['collections', 'components', 'assets']) selected[table] = clone(source[table].filter(row => row.workspaceId === workspaceId));
  const collectionIds = new Set(selected.collections.map(c => c.id));
  selected.records = clone(source.records.filter(record => collectionIds.has(record.collectionId)));
  return selected;
}

function importBackup(state, backup, sourceWorkspaceId, name) {
  shape(backup, ['format', 'version', 'exportedAt', 'state'], ['format', 'version', 'exportedAt', 'state']);
  expect(backup.format === 'chuang-universe-export' && backup.version === 1, '仅支持创宇宙完整导出 v1');
  string(backup.exportedAt, '导出时间', 40);
  expect(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(backup.exportedAt) && Number.isFinite(Date.parse(backup.exportedAt)) && new Date(backup.exportedAt).toISOString() === backup.exportedAt, '导出时间必须为有效的 ISO UTC 时间');
  identifier(sourceWorkspaceId, '原空间 ID'); if (name !== undefined) string(name, '新空间名称');
  // Validate the entire file first, including unselected workspaces. A file with
  // credentials, unsupported metadata or cross-workspace links cannot be imported.
  validateState(backup.state);
  const source = selectBackupWorkspace(backup.state, sourceWorkspaceId), copy = clone(source), map = new Map();
  const allocate = (id, prefix) => map.set(id, uid(prefix));
  for (const w of source.workspaces) { allocate(w.id, 'workspace'); for (const page of w.pages) allocate(page.id, 'page'); }
  for (const collection of source.collections) {
    allocate(collection.id, 'collection');
    for (const f of collection.fields) { allocate(f.id, 'field'); for (const option of f.options ?? []) allocate(option.id, 'option'); }
  }
  for (const [table, prefix] of [['components', 'component'], ['records', 'record'], ['assets', 'asset']]) for (const row of source[table]) allocate(row.id, prefix);
  const remap = id => { expect(map.has(id), `备份中存在无法恢复的引用 ${id}`, 'backup_reference'); return map.get(id); };
  const w = copy.workspaces[0]; w.id = remap(w.id); w.archived = false; if (name !== undefined) w.name = name;
  for (const page of w.pages) page.id = remap(page.id);
  for (const collection of copy.collections) {
    collection.id = remap(collection.id); collection.workspaceId = w.id;
    for (const f of collection.fields) { f.id = remap(f.id); if (f.targetCollectionId) f.targetCollectionId = remap(f.targetCollectionId); for (const option of f.options ?? []) option.id = remap(option.id); }
    for (const key of Object.keys(collection.semanticBindings)) collection.semanticBindings[key] = key === 'doneOptions' ? collection.semanticBindings[key].map(remap) : remap(collection.semanticBindings[key]);
  }
  for (const record of copy.records) {
    const originalCollection = find(source, 'collections', record.collectionId);
    record.id = remap(record.id); record.collectionId = remap(record.collectionId);
    record.values = Object.fromEntries(Object.entries(record.values).map(([fieldId, value]) => {
      const f = fieldOf(originalCollection, fieldId);
      return [remap(fieldId), value === null ? null : f.type === 'select' ? remap(value) : f.type === 'relation' ? value.map(remap) : clone(value)];
    }));
    record.assetIds = record.assetIds.map(remap);
    record.sourceRefs = record.sourceRefs.map(ref => ({ ...ref, assetId: remap(ref.assetId), ...(own(ref, 'fieldId') ? { fieldId: remap(ref.fieldId) } : {}) }));
  }
  for (const asset of copy.assets) { asset.id = remap(asset.id); asset.workspaceId = w.id; }
  for (const component of copy.components) {
    const originalCollection = component.binding.collectionId ? find(source, 'collections', component.binding.collectionId) : null;
    const filterField = component.props.filter ? fieldOf(originalCollection, component.props.filter.fieldId) : null;
    component.id = remap(component.id); component.workspaceId = w.id; component.pageId = remap(component.pageId);
    for (const key of Object.keys(component.binding)) component.binding[key] = remap(component.binding[key]);
    if (component.props.assetIds) component.props.assetIds = component.props.assetIds.map(remap);
    if (component.props.visibleFieldIds) component.props.visibleFieldIds = component.props.visibleFieldIds.map(remap);
    if (component.props.sort) component.props.sort.fieldId = remap(component.props.sort.fieldId);
    if (component.props.filter) {
      const filter = component.props.filter; filter.fieldId = remap(filter.fieldId);
      if (filter.value !== null && filterField.type === 'select') filter.value = remap(filter.value);
      if (filter.value !== null && filterField.type === 'relation') filter.value = filter.value.map(remap);
    }
  }
  validateState(copy);
  for (const table of TABLES) state[table].push(...copy[table]);
  return w;
}

// Compare local wall-clock intervals only within a single workspace/timezone.
// Date-only end values are inclusive natural days; exact datetime ends are exclusive.
export function detectScheduleConflicts(state, workspaceId) {
  validateState(state); const workspace = find(state, 'workspaces', workspaceId); if (workspace.archived) return [];
  const warnings = [], intervals = []; let truncated = false;
  const add = warning => { if (warnings.length < 500) warnings.push(warning); else truncated = true; };
  const minute = value => {
    const [year, month, day] = value.slice(0, 10).split('-').map(Number);
    return Date.UTC(year, month - 1, day, Number(value.slice(11, 13)) || 0, Number(value.slice(14, 16)) || 0) / 60000;
  };
  const collections = new Map(state.collections.filter(c => c.workspaceId === workspaceId && c.semanticBindings.start && c.semanticBindings.end).map(c => [c.id, c]));
  for (const record of state.records) {
    const collection = collections.get(record.collectionId); if (!collection || record.archived) continue;
    const b = collection.semanticBindings; if (b.status && b.doneOptions?.includes(record.values[b.status])) continue;
    const recordTitle = (b.title && record.values[b.title]) || collection.name;
    const start = record.values[b.start], end = record.values[b.end];
    // An ordinary deadline task can share a collection with meetings without
    // reserving a time interval. Warn only when an interval is partially set.
    if (start == null && end == null) continue;
    if (start == null || end == null) { add({ type: 'uncertain', code: 'schedule_missing_endpoint', workspaceId, recordId: record.id, recordTitle, message: `“${recordTitle}”缺少${start == null && end == null ? '开始和结束' : start == null ? '开始' : '结束'}日期，暂不能判断时间重叠。` }); continue; }
    intervals.push({ recordId: record.id, recordTitle, start, end, from: minute(start), to: minute(end) + (end.length === 10 ? 1440 : 0) });
  }
  intervals.sort((a, b) => a.from - b.from || a.to - b.to || a.recordId.localeCompare(b.recordId));
  let active = [];
  outer: for (const item of intervals) {
    active = active.filter(previous => previous.to > item.from);
    for (const other of active) {
      if (warnings.length >= 500) { truncated = true; break outer; }
      add({ type: 'overlap', code: 'schedule_overlap', workspaceId, recordId: other.recordId, recordTitle: other.recordTitle, otherRecordId: item.recordId, otherRecordTitle: item.recordTitle, start: item.start, end: item.end, message: `“${other.recordTitle}”与“${item.recordTitle}”在 ${item.start.replace('T', ' ')} 的安排区间重叠（${workspace.timezone}）。` });
    }
    active.push(item);
  }
  if (truncated) warnings.push({ type: 'uncertain', code: 'schedule_warnings_truncated', workspaceId, message: '时间提示超过 500 项，当前仅展示前 500 项；请缩小安排范围后继续检查。' });
  return warnings;
}
