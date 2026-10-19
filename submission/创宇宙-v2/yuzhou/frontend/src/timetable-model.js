// Shared browser/server rules for semester timetables, independent of calendar events.
import {isValidDate} from './ledger-model.js';

const DAY = 86400000;
const forbiddenIds = new Set(['__proto__', 'constructor', 'prototype']);
const fail = message => { throw new Error(message); };
const object = value => value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
function text(value, label, max = 200, required = false) {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail(`课表${label}格式无效。`);
  return value;
}
function identifier(value, label) {
  text(value, label, 128, true);
  if (forbiddenIds.has(value) || /[\u0000-\u001f\u007f]/.test(value)) fail(`课表${label}格式无效。`);
  return value;
}
function integer(value, label, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(`课表${label}须为 ${min} 至 ${max} 之间的整数。`);
  return value;
}
function records(value, label, max, normalize) {
  if (!Array.isArray(value) || value.length > max) fail(`课表${label}格式无效。`);
  const ids = new Set();
  return value.map(item => {
    if (!object(item)) fail(`课表${label}格式无效。`);
    const result = normalize(item);
    if (ids.has(result.id)) fail(`课表${label}存在重复编号。`);
    ids.add(result.id);
    return result;
  });
}
function dateStamp(value) {
  const day = value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : value;
  if (!isValidDate(day)) fail('请选择真实有效的课表日期。');
  return Date.parse(`${day}T00:00:00.000Z`);
}
function mondayStamp(term) {
  const stamp = dateStamp(term.weekOne);
  if (new Date(stamp).getUTCDay() !== 1) fail('学期第 1 周开始日期须为星期一。');
  return stamp;
}
function clock(value) {
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) fail('课表上课时间须为 HH:MM。');
  return value;
}
function weeksList(value, totalWeeks) {
  if (!Array.isArray(value) || !value.length || value.length > totalWeeks) fail('课程至少需要一个有效上课周。');
  const weeks = value.map(week => integer(week, '上课周', 1, totalWeeks));
  if (new Set(weeks).size !== weeks.length) fail('课程上课周不能重复。');
  return weeks.sort((a, b) => a - b);
}

/** Return a detached known-shape timetable. No calendar/task records are generated. */
export function validateTimetable(input) {
  if (!object(input) || input.version !== 1) fail('课表版本不受支持。');
  const terms = records(input.terms, '学期', 100, value => {
    const totalWeeks = integer(value.totalWeeks, '学期周数', 1, 53);
    const teachingWeeks = integer(value.teachingWeeks, '教学周数', 0, totalWeeks);
    if (typeof value.weekOne !== 'string') fail('学期第 1 周日期须为 YYYY-MM-DD。');
    mondayStamp(value);
    if (new Date(dateStamp(value.weekOne) + (totalWeeks * 7 - 1) * DAY).getUTCFullYear() > 9999) fail('课表学期结束日期超出支持范围。');
    const periods = records(value.periods, '节次', 24, period => ({id:integer(period.id, '节次', 1, 24), start:clock(period.start), end:clock(period.end)}))
      .sort((a, b) => a.id - b.id);
    if (!periods.length) fail('课表至少需要一个节次。');
    for (let index = 0; index < periods.length; index++) {
      if (periods[index].start >= periods[index].end) fail('每一节的下课时间须晚于上课时间。');
      if (index && periods[index].start < periods[index - 1].end) fail('课表节次时间不能交叠。');
    }
    const periodIds = new Set(periods.map(period => period.id));
    const entries = records(value.entries, '课程', 10000, entry => {
      const startPeriod = integer(entry.startPeriod, '开始节次', 1, 24);
      const endPeriod = integer(entry.endPeriod, '结束节次', startPeriod, 24);
      for (let id = startPeriod; id <= endPeriod; id++) if (!periodIds.has(id)) fail('课程引用的节次不存在。');
      if (typeof entry.color !== 'string' || !/^#[\da-f]{6}$/i.test(entry.color)) fail('课表课程颜色格式无效。');
      if (entry.archived !== undefined && typeof entry.archived !== 'boolean') fail('课表课程归档状态无效。');
      return {id:identifier(entry.id, '课程编号'), title:text(entry.title, '课程名称', 160, true),
        teacher:text(entry.teacher, '授课教师', 160), location:text(entry.location, '上课地点', 300),
        weekday:integer(entry.weekday, '星期', 1, 7), startPeriod, endPeriod,
        weeks:weeksList(entry.weeks, totalWeeks), color:entry.color, archived:entry.archived ?? false,
        ...(entry.courseId===undefined||entry.courseId===''?{}:{courseId:identifier(entry.courseId,'关联课程编号')})};
    });
    return {id:identifier(value.id, '学期编号'), title:text(value.title, '学期名称', 160, true),
      campus:text(value.campus, '校区', 100), weekOne:value.weekOne, totalWeeks, teachingWeeks,
      notes:text(value.notes, '学期说明', 10000), periods, entries};
  });
  const activeTermId = input.activeTermId === '' ? '' : identifier(input.activeTermId, '当前学期');
  if (activeTermId && !terms.some(term => term.id === activeTermId)) fail('当前学期不存在。');
  return {version:1, activeTermId, terms};
}

export function initializeTimetable(state) {
  if (state.timetable === undefined) state.timetable = {version:1, activeTermId:'', terms:[]};
  return state.timetable;
}

/** Additive import: keep current edits, and never modify either input. */
export function mergeTimetables(current, incoming) {
  const timetable = validateTimetable(current ?? {version:1, activeTermId:'', terms:[]});
  const source = validateTimetable(incoming);
  let count = 0;
  const mergeRecords = (target, additions, onExisting) => {
    const byId = new Map(target.map(item => [item.id, item]));
    for (const item of additions) {
      const existing = byId.get(item.id);
      if (existing) { if (onExisting) onExisting(existing, item); }
      else { const copy = structuredClone(item); target.push(copy); byId.set(copy.id, copy); count++; }
    }
  };
  mergeRecords(timetable.terms, source.terms, (existing, item) => {
    mergeRecords(existing.periods, item.periods);
    mergeRecords(existing.entries, item.entries,(entry,incoming)=>{
      if(!entry.courseId&&incoming.courseId){entry.courseId=incoming.courseId;count++;}
    });
  });
  if (!timetable.activeTermId && source.activeTermId) timetable.activeTermId = source.activeTermId;
  // Conflicting term lengths/period definitions must be resolved explicitly, not silently discarded.
  return {timetable:validateTimetable(timetable), count};
}

/** Week numbers deliberately remain outside 1..totalWeeks during vacations. */
export function weekForDate(term, date) {
  return Math.floor((dateStamp(date) - mondayStamp(term)) / (7 * DAY)) + 1;
}

export function dateForWeek(term, week, weekday = 1) {
  integer(week, '周数', 1, term.totalWeeks);
  integer(weekday, '星期', 1, 7);
  const date = new Date(mondayStamp(term) + ((week - 1) * 7 + weekday - 1) * DAY);
  if (date.getUTCFullYear() > 9999) fail('课表日期超出支持范围。');
  return date.toISOString().slice(0, 10);
}

export function entriesForWeek(term, week) {
  if (!Number.isSafeInteger(week) || week < 1 || week > term.totalWeeks) return [];
  return term.entries.filter(entry => !entry.archived && entry.weeks.includes(week))
    .sort((a, b) => a.weekday - b.weekday || a.startPeriod - b.startPeriod || a.title.localeCompare(b.title, 'zh-CN') || a.id.localeCompare(b.id));
}

/** Accept ranges, selected weeks, and odd/even week qualifiers; never guess invalid input. */
export function parseWeeks(input, totalWeeks = 20) {
  integer(totalWeeks, '学期周数', 1, 53);
  if (typeof input !== 'string' || input.length > 1000) fail('请输入上课周，例如 1-18、1-17(单) 或 6-8(双)。');
  const source = input.trim().replace(/[（]/g, '(').replace(/[）]/g, ')').replace(/[—–~～至到]/g, '-')
    .replace(/第|周|\s/g, '').replace(/[，、；;]/g, ',');
  if (!source) fail('请填写上课周。');
  const result = new Set();
  for (const part of source.split(',')) {
    let first, last, parity;
    if (/^(?:全部|全|每)$/.test(part)) { first = 1; last = totalWeeks; }
    else if (/^(?:[单双]|\([单双]\))$/.test(part)) { first = 1; last = totalWeeks; parity = part.includes('单') ? '单' : '双'; }
    else {
      const match = part.match(/^(\d{1,2})(?:-(\d{1,2}))?(?:\(([单双])\)|([单双]))?$/);
      if (!match) fail('上课周格式无效，例如 1-18、1-17(单) 或 6-8(双)。');
      first = Number(match[1]); last = Number(match[2] ?? match[1]); parity = match[3] || match[4];
    }
    integer(first, '上课周', 1, totalWeeks); integer(last, '上课周', first, totalWeeks);
    for (let week = first; week <= last; week++) if (!parity || week % 2 === (parity === '单' ? 1 : 0)) result.add(week);
  }
  if (!result.size) fail('所选范围内没有符合条件的上课周。');
  return [...result].sort((a, b) => a - b);
}

export function formatWeeks(input) {
  if (!Array.isArray(input) || !input.length) return '未安排';
  const weeks = weeksList(input, 53);
  if (weeks.length > 1 && weeks.every((week, index) => index === 0 || week === weeks[index - 1] + 2)) {
    return `${weeks[0]}-${weeks.at(-1)}周（${weeks[0] % 2 ? '单' : '双'}）`;
  }
  const parts = [];
  for (let index = 0; index < weeks.length;) {
    let end = index;
    while (end + 1 < weeks.length && weeks[end + 1] === weeks[end] + 1) end++;
    parts.push(end === index ? String(weeks[index]) : `${weeks[index]}-${weeks[end]}`);
    index = end + 1;
  }
  return `${parts.join('、')}周`;
}

export function periodTime(term, entry) {
  const start = term.periods.find(period => period.id === entry.startPeriod)?.start;
  const end = term.periods.find(period => period.id === entry.endPeriod)?.end;
  if (!start || !end) fail('课程引用的节次不存在。');
  return {start, end, label:`${start}–${end}`};
}
