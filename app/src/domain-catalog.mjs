// Serializable action schemas are documentation for both manual and AI clients.
// Referential, scope, layout and evidence checks are enforced by domain.mjs.
const str = maxLength => ({ type: 'string', minLength: 1, maxLength });
const id = str(100);
const ref = { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,49}$' };
const text = maxLength => ({ type: 'string', maxLength });
const list = (items, maxItems) => ({ type: 'array', items, maxItems });
const obj = (properties, required = []) => ({ type: 'object', additionalProperties: false, properties, required });
const nullable = schema => ({ anyOf: [schema, { type: 'null' }] });
const types = ['text', 'list', 'board', 'calendar', 'resources'];
const color = { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' };
const value = { anyOf: [{ type: 'null' }, { type: 'string', maxLength: 20000 }, { type: 'number' }, list(id, 100)] };
const values = { type: 'object', maxProperties: 50, additionalProperties: value, description: '键是字段ID或本批前序创建的$ref；select值是选项ID，relation值是记录ID数组' };
const option = obj({ label: str(100), ref }, ['label']);
const field = obj({ name: str(100), type: { enum: ['text', 'number', 'date', 'select', 'relation'] }, ref, options: { ...list(option, 100), minItems: 1 }, targetCollectionId: id }, ['name', 'type']);
const semantics = obj({ title: id, status: id, dueDate: id, start: id, end: id, doneOptions: list(id, 100) });
const binding = obj({ collectionId: id, statusFieldId: id, dateFieldId: id });
const filter = obj({ fieldId: id, operator: { enum: ['eq', 'contains', 'before', 'after'] }, value }, ['fieldId', 'operator', 'value']);
const sort = obj({ fieldId: id, direction: { enum: ['asc', 'desc'] } }, ['fieldId', 'direction']);
const props = obj({ content: text(100000), collapsed: { type: 'boolean' }, color, assetIds: list(id, 500), visibleFieldIds: list(id, 50), filter: nullable(filter), sort: nullable(sort) });
const layoutProperties = { x: { type: 'integer', minimum: 0, maximum: 11 }, y: { type: 'integer', minimum: 0, maximum: 500 }, w: { type: 'integer', minimum: 2, maximum: 12 }, h: { type: 'integer', minimum: 2, maximum: 24 } };
const preferences = obj({ density: { enum: ['comfortable', 'compact'] }, theme: { enum: ['light', 'dark'] }, accent: color, favoriteComponents: list({ enum: types }, 5), priorityText: text(500) });
const sourceRefs = list(obj({ assetId: id, hash: { type: 'string', pattern: '^[a-f0-9]{64}$' }, quote: str(10000), fieldId: id }, ['assetId', 'quote']), 100);
const record = { values, sourceRefs, assetIds: list(id, 100) };
const portable = { type: 'object', description: '仅接受 exportTemplate 返回的完整 structure-only v1 模板；全部内部引用会重建，禁止真实记录和资料。' };
const backup = obj({ format: { const: 'chuang-universe-export' }, version: { const: 1 }, exportedAt: { type: 'string', format: 'date-time', maxLength: 40 }, state: { type: 'object', description: '完整合法的创宇宙 v1 领域 state，严禁账号、模型配置及其他额外字段。' } }, ['format', 'version', 'exportedAt', 'state']);
const action = (op, properties, required) => obj({ op: { const: op }, ...properties }, ['op', ...required]);
const patch = (op, properties) => action(op, { id, patch: obj(properties) }, ['id', 'patch']);
const schemas = {
  'workspace.create': action('workspace.create', { name: str(160), template: { enum: ['blank', 'study', 'project', 'office'] }, timezone: str(100), ref }, ['name', 'template']),
  'workspace.update': patch('workspace.update', { name: str(160), timezone: str(100), preferences }),
  'page.create': action('page.create', { workspaceId: id, name: str(160), ref }, ['name']),
  'page.update': patch('page.update', { name: str(160) }),
  'component.create': action('component.create', { workspaceId: id, pageId: id, type: { enum: types }, title: str(160), layout: obj(layoutProperties, ['x', 'y', 'w', 'h']), props, binding, ref }, ['type']),
  'component.update': patch('component.update', { title: str(160), type: { enum: types }, pageId: id, layout: obj(layoutProperties), props, binding }),
  'collection.create': action('collection.create', { workspaceId: id, name: str(160), fields: { ...list(field, 50), minItems: 1 }, semanticBindings: semantics, ref }, ['name', 'fields']),
  'collection.update': patch('collection.update', { name: str(160), semanticBindings: semantics }),
  'collection.field.add': action('collection.field.add', { id, field, ref }, ['id', 'field']),
  'collection.field.update': action('collection.field.update', { id, fieldId: id, patch: obj({ name: str(100), options: { ...list(obj({ id, label: str(100), ref }, ['label']), 100), minItems: 1 } }) }, ['id', 'fieldId', 'patch']),
  'record.create': action('record.create', { collectionId: id, ...record, ref }, ['collectionId', 'values']),
  'record.update': patch('record.update', record),
  'asset.create': action('asset.create', { workspaceId: id, title: str(160), text: text(300000), linkUrl: text(4096), ref }, ['title']),
  'asset.update': patch('asset.update', { title: str(160), text: text(300000), linkUrl: text(4096) }),
  'template.import': action('template.import', { template: portable, name: str(160), ref }, ['template']),
  'backup.import': action('backup.import', { backup, sourceWorkspaceId: id, name: str(160), ref }, ['backup', 'sourceWorkspaceId'])
};
for (const entity of ['workspace', 'component', 'record', 'asset']) schemas[`${entity}.archive`] = action(`${entity}.archive`, { id, archived: { type: 'boolean' } }, ['id', 'archived']);
export function schemaForAction(op) { return structuredClone(schemas[op]); }
