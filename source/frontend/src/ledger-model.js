// Shared browser/server ledger rules. Monetary values are integer fen (1/100 CNY).
export const MAX_AMOUNT_CENTS = 999_999_999;
const MAX_RECORDS = 100_000;
const forbiddenIds = new Set(['__proto__', 'constructor', 'prototype']);
const fail = message => { throw new Error(message); };

export function localDate(date = new Date()) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) fail('日期无效。');
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1900 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

export function parseAmount(text) {
  if (typeof text !== 'string' || !/^\d{1,8}(?:\.\d{1,2})?$/.test(text.trim())) fail('请输入有效金额，最多保留两位小数。');
  const [whole, fraction = ''] = text.trim().split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > MAX_AMOUNT_CENTS) fail('金额须大于 0，且不超过 9,999,999.99 元。');
  return cents;
}

export function formatMoney(cents) {
  if (!Number.isSafeInteger(cents)) fail('金额格式无效。');
  const absolute = Math.abs(cents);
  const whole = Math.floor(absolute / 100).toLocaleString('en-US');
  return `${cents < 0 ? '-' : ''}${whole}.${String(absolute % 100).padStart(2, '0')}`;
}

const object = value => value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
function text(value, label, max, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail(`记账${label}格式无效。`);
  return value;
}
function identifier(value, label) {
  text(value, label, 128, true);
  if (forbiddenIds.has(value) || /[\u0000-\u001f\u007f]/.test(value)) fail(`记账${label}格式无效。`);
  return value;
}
function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail('记账时间格式无效。');
  return value;
}
function flag(value, label) {
  if (typeof value !== 'boolean') fail(`记账${label}格式无效。`);
  return value;
}
function records(value, label, normalize) {
  if (!Array.isArray(value) || value.length > MAX_RECORDS) fail(`记账${label}格式无效。`);
  const seen = new Set();
  return value.map(item => {
    if (!object(item)) fail(`记账${label}格式无效。`);
    const result = normalize(item);
    if (seen.has(result.id)) fail(`记账${label}存在重复编号。`);
    seen.add(result.id);
    return result;
  });
}

/** Validate untrusted ledger content and return a detached, known-shape ledger. */
export function validateLedger(input) {
  if (!object(input) || input.version !== 1 || input.currency !== 'CNY') fail('记账版本或币种不受支持。');
  const projects = records(input.projects, '项目', value => {
    if (typeof value.color !== 'string' || !/^#[\da-f]{6}$/i.test(value.color)) fail('记账项目颜色格式无效。');
    return {id:identifier(value.id, '项目编号'), title:text(value.title, '项目名称', 80, true), color:value.color,
      archived:flag(value.archived, '项目归档状态'), createdAt:timestamp(value.createdAt), updatedAt:timestamp(value.updatedAt)};
  });
  const projectIds = new Set(projects.map(project => project.id));
  const entries = records(input.entries, '记录', value => {
    if (!['income', 'expense'].includes(value.type)) fail('记账收支类型无效。');
    if (!Number.isSafeInteger(value.amountCents) || value.amountCents <= 0 || value.amountCents > MAX_AMOUNT_CENTS) fail('记账金额须为有效的正数，精确到分。');
    if (!isValidDate(value.date)) fail('请输入真实有效的记账日期。');
    if (typeof value.projectId !== 'string' || (value.projectId !== '' && !projectIds.has(value.projectId))) fail('记账记录对应的项目不存在。');
    return {id:identifier(value.id, '记录编号'), type:value.type, amountCents:value.amountCents, date:value.date,
      category:text(value.category, '分类', 80, true), projectId:value.projectId, note:text(value.note, '备注', 2000),
      archived:flag(value.archived, '记录归档状态'), createdAt:timestamp(value.createdAt), updatedAt:timestamp(value.updatedAt),
      ...(value.example === undefined ? {} : {example:flag(value.example, '示例标记')})};
  });
  return {version:1, currency:'CNY', projects, entries};
}

export function initializeLedger(state) {
  if (state.ledger !== undefined) return state.ledger;
  state.ledger = {version:1, currency:'CNY', projects:[], entries:[]};
  if (state.mode !== 'demo') return state.ledger;
  const stamp = new Date().toISOString();
  const date = localDate();
  state.ledger.projects.push(
    {id:'ledger-campus-life', title:'校园生活 · 示例', color:'#f58b35', archived:false, createdAt:stamp, updatedAt:stamp},
    {id:'ledger-union-event', title:'学生会活动 · 示例', color:'#00b8b0', archived:false, createdAt:stamp, updatedAt:stamp}
  );
  state.ledger.entries.push(
    {id:'ledger-demo-allowance', type:'income', amountCents:150000, category:'生活费', projectId:'ledger-campus-life', note:'示例：本月生活费'},
    {id:'ledger-demo-lunch', type:'expense', amountCents:1850, category:'餐饮', projectId:'ledger-campus-life', note:'示例：食堂午餐'},
    {id:'ledger-demo-materials', type:'expense', amountCents:6800, category:'活动', projectId:'ledger-union-event', note:'示例：活动物料'}
  );
  for (const entry of state.ledger.entries) Object.assign(entry, {date, archived:false, createdAt:stamp, updatedAt:stamp, example:true});
  return state.ledger;
}

export function selectEntries(ledger, {start = '', end = '', projectId = 'all', type = 'all', archived = false, query = ''} = {}) {
  if ((start && !isValidDate(start)) || (end && !isValidDate(end)) || (start && end && start > end)) fail('请选择有效的起止日期，开始日期不能晚于结束日期。');
  const term = String(query).trim().toLocaleLowerCase('zh-CN');
  const projects = new Map(ledger.projects.map(project => [project.id, project.title]));
  return ledger.entries.filter(entry =>
    (archived === 'all' || entry.archived === archived)
    && (!start || entry.date >= start) && (!end || entry.date <= end)
    && (projectId === 'all' || entry.projectId === projectId)
    && (type === 'all' || entry.type === type)
    && (!term || `${entry.category}\n${entry.note}\n${projects.get(entry.projectId) || '未分项目'}`.toLocaleLowerCase('zh-CN').includes(term))
  ).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

export function summarizeEntries(entries) {
  let incomeCents = 0, expenseCents = 0;
  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.amountCents) || entry.amountCents <= 0) fail('记账金额格式无效。');
    if (entry.type === 'income') incomeCents += entry.amountCents;
    else if (entry.type === 'expense') expenseCents += entry.amountCents;
    else fail('记账收支类型无效。');
  }
  if (!Number.isSafeInteger(incomeCents) || !Number.isSafeInteger(expenseCents)) fail('汇总金额超出支持范围。');
  return {incomeCents, expenseCents, netCents:incomeCents - expenseCents, count:entries.length};
}
