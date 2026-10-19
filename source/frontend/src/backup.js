// Pure backup validation and additive merging. No browser storage or file writes.
import {validateOrganizedProposal} from './ai-organizer.js';
import {validateLedger} from './ledger-model.js';
const MAX_FILE_BYTES = 40 * 1024 * 1024;
const DRAFT_TYPES = ['writing', 'translation', 'listening'];
const PRACTICE_TYPES = ['reading', 'writing', 'translation', 'listening', 'vocabulary'];
const fail = label => { throw new Error(`备份中的${label}格式无效。`); };
const object = (value, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(label);
  return value;
};
const text = (value, label, fallback = '', required = false) => {
  if (value === undefined && !required) return fallback;
  if (typeof value !== 'string' || value.length > 2_000_000 || (required && !value.trim())) fail(label);
  return value;
};
const identifier = (value, label) => {
  const result = text(value, label, '', true);
  if (result.length > 512 || ['__proto__', 'constructor', 'prototype'].includes(result) || /[\u0000-\u001f]/.test(result)) fail(label);
  return result;
};
const boolean = (value, label, fallback = false) => {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') fail(label);
  return value;
};
const integer = (value, label, min = 0, max = Number.MAX_SAFE_INTEGER) => {
  if (!Number.isInteger(value) || value < min || value > max) fail(label);
  return value;
};
const finite = (value, label, min = -1_000_000, max = 1_000_000) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(label);
  return value;
};
const color = value => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value) ? value : '#7950f2';
const choice = (value, choices, label, fallback) => {
  if (value === undefined) return fallback;
  if (!choices.includes(value)) fail(label);
  return value;
};
function records(value, normalize, label, optional = false) {
  if (value === undefined && optional) return [];
  if (!Array.isArray(value) || value.length > 100_000) fail(label);
  const result = value.map((entry, index) => normalize(object(entry, `${label}第${index + 1}项`)));
  const ids = new Set();
  for (const entry of result) {
    if (entry.id !== undefined) {
      if (ids.has(entry.id)) fail(`${label}的重复编号`);
      ids.add(entry.id);
    }
  }
  return result;
}
function optionalFields(source, target, strings = [], flags = []) {
  for (const key of strings) if (source[key] !== undefined) target[key] = text(source[key], key);
  for (const key of flags) if (source[key] !== undefined) target[key] = boolean(source[key], key);
  return target;
}
function revision(value) {
  const result = {
    title: text(value.title, '修订标题', '', true), content: text(value.content, '修订正文'),
    chapter: text(value.chapter, '修订章节'), source: text(value.source, '修订来源'),
    updatedAt: text(value.updatedAt, '修订时间'), savedAt: text(value.savedAt, '修订保存时间'),
  };
  if (value.id !== undefined) result.id = identifier(value.id, '修订编号');
  return optionalFields(value, result, [], ['example']);
}
function note(value) {
  const result = {
    id: identifier(value.id, '笔记编号'), title: text(value.title, '笔记标题', '', true),
    content: text(value.content, '笔记正文'), chapter: text(value.chapter, '笔记章节'),
    source: text(value.source, '笔记来源'), updatedAt: text(value.updatedAt, '笔记时间'),
    example: boolean(value.example, '示例笔记标记'),
    revisions: records(value.revisions, revision, '笔记修订', true),
  };
  if (value.sourceRequestId !== undefined) result.sourceRequestId = identifier(value.sourceRequestId, '来源请求编号');
  return optionalFields(value, result, ['createdAt'], ['archived']);
}
function courseFile(value) {
  const result = {
    id: identifier(value.id, '资料编号'), blobId: identifier(value.blobId, '资料文件编号'),
    name: text(value.name, '资料名称', '', true), size: integer(value.size, '资料大小', 0, MAX_FILE_BYTES),
    type: text(value.type, '资料类型'), createdAt: text(value.createdAt, '资料创建时间'),
    ...(value.example === undefined ? {} : { example: boolean(value.example, '资料示例标记') }),
  };
  if (value.sourceRequestId !== undefined) result.sourceRequestId = identifier(value.sourceRequestId, '来源请求编号');
  return optionalFields(value, result, ['source']);
}
function course(value) {
  return {
    id: identifier(value.id, '课程编号'), title: text(value.title, '课程名称', '', true),
    subtitle: text(value.subtitle, '课程简介'), icon: text(value.icon, '课程图标', 'book'),
    color: typeof value.color === 'string' && /^#[\da-f]{6}$/i.test(value.color) ? value.color : '#7950f2',
    prompt: text(value.prompt, '助教偏好'), example: boolean(value.example, '示例课程标记'),
    updatedAt: text(value.updatedAt, '课程时间'),
    notes: records(value.notes, note, '课程笔记'), files: records(value.files, courseFile, '课程资料'),
  };
}
function task(value) {
  const result = {
    id: identifier(value.id, '待办编号'), title: text(value.title, '待办标题', '', true),
    description: text(value.description, '待办说明'), category: text(value.category, '待办分类', '个人'),
    date: text(value.date, '待办日期'), priority: choice(value.priority, ['normal', 'high'], '待办优先级', 'normal'),
    done: boolean(value.done, '完成状态'), archived: boolean(value.archived, '归档状态'),
    source: text(value.source, '待办来源'), createdAt: text(value.createdAt, '待办创建时间'),
  };
  if (value.completedAt !== undefined) result.completedAt = value.completedAt === null ? null : text(value.completedAt, '完成时间');
  if (value.captureId !== undefined) result.captureId = identifier(value.captureId, '来源碎片编号');
  for (const key of ['spaceId', 'sourceRequestId']) if (value[key] !== undefined) result[key] = identifier(value[key], key);
  return optionalFields(value, result, ['updatedAt'], ['example']);
}
function capture(value) {
  const result = {
    id: identifier(value.id, '碎片编号'), text: text(value.text, '碎片内容'),
    category: text(value.category, '碎片分类', '备忘'), tags: text(value.tags, '碎片标签'),
    archived: boolean(value.archived, '碎片归档状态'), createdAt: text(value.createdAt, '碎片创建时间'),
  };
  if (value.blobId !== undefined) result.blobId = identifier(value.blobId, '碎片文件编号');
  if (value.sourceRequestId !== undefined) result.sourceRequestId = identifier(value.sourceRequestId, '来源请求编号');
  return optionalFields(value, result, ['fileName', 'fileType', 'source', 'importedDraftKey'], ['example']);
}
function space(value) {
  return {
    id: identifier(value.id, '空间编号'), title: text(value.title, '空间名称', '', true),
    description: text(value.description, '空间用途'), type: choice(value.type, ['blank','course','affairs','project'], '空间模板', 'blank'),
    color: color(value.color), icon: text(value.icon, '空间图标', 'folder'),
    archived: boolean(value.archived, '空间归档状态'), example: boolean(value.example, '空间示例标记'),
    createdAt: text(value.createdAt, '空间创建时间'), updatedAt: text(value.updatedAt, '空间更新时间'),
    notes: records(value.notes, note, '空间笔记', true), files: records(value.files, courseFile, '空间资料', true),
  };
}
function destination(value) {
  const result = identifier(value, '目标工作区');
  if (!['auto','english','inbox','tasks'].includes(result) && !/^(space|course):[^\s]+$/.test(result)) fail('目标工作区');
  return result;
}
function aiRevision(value) {
  return {text: text(value.text, 'AI 请求修订内容'), targetId: destination(value.targetId ?? 'auto'), savedAt: text(value.savedAt, 'AI 请求修订时间')};
}
function receiptItem(value) {
  const collection = choice(value.collection, ['notes','files','tasks','captures'], '归档集合', undefined);
  if (!collection) fail('归档集合');
  const result = {
    id: identifier(value.id, '归档条目编号'), type: text(value.type, '归档条目类型'), title: text(value.title, '归档条目名称'),
    collection, containerId: identifier(value.containerId, '归档条目容器'), snapshot: text(value.snapshot, '归档撤回快照'),
  };
  if (result.snapshot) {
    let parsed;
    try { parsed = JSON.parse(result.snapshot); } catch { fail('归档撤回快照'); }
    const normalized = ({notes:note,files:courseFile,tasks:task,captures:capture}[collection])(object(parsed, '归档撤回快照'));
    if (normalized.id !== result.id) fail('归档快照编号');
    result.snapshot = JSON.stringify(normalized);
  }
  return result;
}
function receipt(value) {
  object(value, '归档回执');
  const destinationId = destination(value.destinationId);
  if (destinationId === 'auto') fail('归档回执目标');
  const result = { destinationId, destinationLabel: text(value.destinationLabel, '归档工作区名称'),
    createdAt: text(value.createdAt, '归档时间'), items: records(value.items, receiptItem, '归档条目') };
  if (value.engine !== undefined) result.engine = choice(value.engine, ['hermes'], 'AI 归档引擎');
  return result;
}
function aiRequest(value) {
  const result = {
    id: identifier(value.id, 'AI 请求编号'), text: text(value.text, 'AI 请求内容'),
    files: records(value.files, courseFile, 'AI 请求附件', true), targetId: destination(value.targetId ?? 'auto'),
    status: choice(value.status, ['waiting_model','filed','cancelled'], 'AI 请求状态', 'waiting_model'),
    createdAt: text(value.createdAt, 'AI 请求创建时间'), updatedAt: text(value.updatedAt, 'AI 请求更新时间'),
  };
  if (value.originalText !== undefined) result.originalText = text(value.originalText, 'AI 请求原文');
  if (value.revisions !== undefined) result.revisions = records(value.revisions, aiRevision, 'AI 请求修订');
  if (value.receipt !== undefined && value.receipt !== null) result.receipt = receipt(value.receipt);
  if (value.aiJobId !== undefined) result.aiJobId = identifier(value.aiJobId, 'AI 云端任务编号');
  if (value.aiStatus !== undefined) result.aiStatus = choice(value.aiStatus, ['queued','running','succeeded','failed'], 'AI 执行状态');
  if (value.aiProposal !== undefined) result.aiProposal = validateOrganizedProposal(value.aiProposal);
  if (value.aiError !== undefined) result.aiError = text(value.aiError, 'AI 错误说明');
  if (result.status === 'filed' && !result.receipt) fail('已归档请求的回执');
  return optionalFields(value, result, ['source', 'importedDraftKey']);
}
function aiDraft(value) {
  object(value, 'AI 收件草稿');
  return {text: text(value.text, 'AI 草稿内容'), files: records(value.files, courseFile, 'AI 草稿附件', true), targetId: destination(value.targetId ?? 'auto')};
}
function canvas(value, label = '主页画布') {
  object(value, label);
  const result = {
    cards: records(value.cards, item => ({id: identifier(item.id, '画布卡片编号'), x: finite(item.x, '卡片横坐标', -100_000, 100_000), y: finite(item.y, '卡片纵坐标', -100_000, 100_000),
      w: finite(item.w, '卡片宽度', 220, 1100), h: finite(item.h, '卡片高度', 220, 850), color: color(item.color)}), '画布卡片', true),
    snap: boolean(value.snap, '画布吸附', true), initialized: boolean(value.initialized, '画布初始化状态'),
  };
  if (value.view !== undefined) {
    const view = object(value.view, '画布视角');
    result.view = {x: finite(view.x, '画布视角横坐标'), y: finite(view.y, '画布视角纵坐标'), zoom: finite(view.zoom, '画布缩放', .3, 1.6)};
  }
  if (value.presentation !== undefined) result.presentation = choice(value.presentation, ['canvas','list'], '画布展示方式');
  return optionalFields(value, result, ['modifiedAt'], ['customized']);
}
function word(value) {
  return optionalFields(value, {
    id: identifier(value.id, '词汇编号'), word: text(value.word, '词汇', '', true),
    meaning: text(value.meaning, '词汇释义'), phonetic: text(value.phonetic, '音标'),
    example: text(value.example, '词汇例句'), translation: text(value.translation, '例句翻译'),
    status: choice(value.status, ['new', 'review', 'mastered'], '词汇掌握状态', 'new'),
    source: choice(value.source, ['builtin', 'personal'], '词汇来源', 'personal'),
  }, ['updatedAt']);
}
function session(value) {
  return optionalFields(value, {
    id: identifier(value.id, '学习记录编号'), date: text(value.date, '学习日期', '', true),
    minutes: integer(value.minutes, '学习时长', 1, 720),
    type: choice(value.type, PRACTICE_TYPES, '练习类型', 'reading'), note: text(value.note, '学习备注'),
  }, ['createdAt'], ['example']);
}
function mistake(value) {
  return optionalFields(value, {
    id: identifier(value.id, '错题编号'), questionId: identifier(value.questionId, '题目编号'),
    question: text(value.question, '题目正文', '', true), selected: text(value.selected, '所选答案'),
    correct: text(value.correct, '正确答案'), explanation: text(value.explanation, '题目解析'),
    source: text(value.source, '题目来源'), date: text(value.date, '错题日期'),
    reviewed: boolean(value.reviewed, '错题回顾状态'),
  }, [], ['example']);
}
function readingResult(value) {
  object(value, '阅读成绩');
  const total = integer(value.total, '阅读题数', 1, 100_000);
  return { correct: integer(value.correct, '阅读答对题数', 0, total), total, date: text(value.date, '阅读练习日期') };
}
function attempt(value) {
  return optionalFields(value, { id: identifier(value.id, '练习记录编号'), ...readingResult(value) }, [], ['example']);
}
function audio(value) {
  if (value === null || value === undefined) return null;
  object(value, '听力音频');
  const result = {
    blobId: identifier(value.blobId ?? value.id, '音频文件编号'), name: text(value.name, '音频名称', '', true),
    size: integer(value.size, '音频大小', 0, MAX_FILE_BYTES), persistent: boolean(value.persistent, '音频保存状态'),
  };
  if (value.id !== undefined) result.id = identifier(value.id, '音频编号');
  return result;
}
function english(value) {
  object(value, '六级数据');
  const plan = value.plan === undefined ? {} : object(value.plan, '六级计划');
  const numberOrEmpty = (input, label, max) => input === undefined || input === '' ? '' : integer(input, label, 0, max);
  const drafts = value.drafts === undefined ? {} : object(value.drafts, '英语草稿');
  const times = value.draftUpdatedAt === undefined ? {} : object(value.draftUpdatedAt, '草稿时间');
  const answers = value.readingAnswers === undefined ? {} : object(value.readingAnswers, '阅读答案');
  const normalizedAnswers = {};
  for (const [key, answer] of Object.entries(answers)) normalizedAnswers[identifier(key, '阅读题目编号')] = integer(answer, '阅读选项', 0, 3);
  return {
    plan: { examDate: text(plan.examDate, '考试日期'), target: numberOrEmpty(plan.target, '目标分数', 710),
      dailyMinutes: numberOrEmpty(plan.dailyMinutes, '每日时长', 720), focus: choice(plan.focus, [...PRACTICE_TYPES, ''], '优先练习', '') },
    words: records(value.words, word, '词汇', true), sessions: records(value.sessions, session, '学习记录', true),
    mistakes: records(value.mistakes, mistake, '错题', true), attempts: records(value.attempts, attempt, '练习历史', true),
    drafts: Object.fromEntries(DRAFT_TYPES.map(key => [key, text(drafts[key], '英语草稿内容')])),
    draftUpdatedAt: Object.fromEntries(DRAFT_TYPES.filter(key => times[key] !== undefined).map(key => [key, text(times[key], '草稿时间')])),
    audio: audio(value.audio), readingAnswers: normalizedAnswers,
    readingResult: value.readingResult == null ? null : readingResult(value.readingResult),
  };
}
function workspace(value) {
  object(value, '工作区');
  if (value.schema !== 1) fail('工作区版本');
  const profile = object(value.profile, '个人资料');
  const result = {
    schema: 1, mode: choice(value.mode, ['demo', 'personal'], '工作区类型', 'personal'),
    profile: { name: text(profile.name, '称呼', '同学'), major: text(profile.major, '专业', '软件工程'), provider: text(profile.provider, '模型偏好', 'deepseek') },
    courses: records(value.courses, course, '课程'), tasks: records(value.tasks, task, '待办'), captures: records(value.captures, capture, '碎片'),
    english: english(value.english), updatedAt: text(value.updatedAt, '工作区更新时间'),
  };
  if (value.spaces !== undefined) result.spaces = records(value.spaces, space, '自建工作区');
  if (value.ledger !== undefined) result.ledger = validateLedger(value.ledger);
  if (value.aiRequests !== undefined) result.aiRequests = records(value.aiRequests, aiRequest, 'AI 收件记录');
  if (value.aiDraft !== undefined) result.aiDraft = aiDraft(value.aiDraft);
  if (value.canvas !== undefined) result.canvas = canvas(value.canvas);
  if (value.courseCanvas !== undefined) result.courseCanvas = canvas(value.courseCanvas, '课程画布');
  if (value.boards !== undefined) {
    const boards = object(value.boards, '内页画布');
    if (Object.keys(boards).length > 10000) fail('内页画布数量');
    result.boards = Object.fromEntries(Object.entries(boards).map(([key, value]) => [identifier(key, '内页画布编号'), canvas(value, '内页画布')]));
  }
  if (value.ui !== undefined) {
    const ui = object(value.ui, '界面偏好');
    result.ui = {sidebarPinned: boolean(ui.sidebarPinned, '侧边栏固定状态')};
  }
  if (value.workspaceVersion !== undefined) result.workspaceVersion = integer(value.workspaceVersion, '空间版本', 1, 2);
  return result;
}
function attachment(value) {
  const id = identifier(value.id, '附件编号');
  if (typeof value.data !== 'string') fail('附件数据');
  const comma = value.data.indexOf(',');
  if (comma < 0 || !/^data:[^,\r\n]*;base64$/.test(value.data.slice(0, comma))) fail('附件编码');
  const payload = value.data.slice(comma + 1);
  if (payload.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) fail('附件编码');
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  if (payload.length / 4 * 3 - padding > MAX_FILE_BYTES) throw new Error('备份内单个附件超过 40 MB。');
  return { id, type: text(value.type, '附件类型', 'application/octet-stream'), data: value.data };
}

/** Validate untrusted parsed JSON; return a new, known-shape backup. */
export function validateBackup(backup) {
  object(backup, '备份');
  if (backup.format !== 'lumi-backup' || backup.version !== 1) fail('备份版本');
  return { format: 'lumi-backup', version: 1, exportedAt: text(backup.exportedAt, '备份时间'),
    state: workspace(backup.state), files: records(backup.files, attachment, '附件') };
}

const isEmpty = value => value === undefined || value === null || value === '' || value === 0;
const revisionKey = value => value.id ? `id:${value.id}` : JSON.stringify([
  value.title || '', value.content || '', value.chapter || '', value.source || '', value.updatedAt || '', value.savedAt || '',
]);

/** Accept a validated backup or its state; never overwrite existing user text. */
export function mergeBackup(current, incoming) {
  const state = structuredClone(current);
  const source = workspace(incoming?.format === 'lumi-backup' ? incoming.state : incoming);
  let count = 0;
  const mergeRecords = (target, additions, onExisting) => {
    const byId = new Map(target.map(item => [item.id, item]));
    for (const item of additions) {
      const existing = byId.get(item.id);
      if (existing) { if (onExisting) onExisting(existing, item); }
      else { const copy = structuredClone(item); target.push(copy); byId.set(copy.id, copy); count++; }
    }
  };
  const mergeContainer = (existing, item) => {
    existing.notes ||= []; existing.files ||= [];
    mergeRecords(existing.notes, item.notes, (currentNote, incomingNote) => {
      currentNote.revisions ||= [];
      const known = new Set(currentNote.revisions.map(revisionKey));
      for (const old of incomingNote.revisions) {
        const key = revisionKey(old);
        if (!known.has(key)) { currentNote.revisions.push(structuredClone(old)); known.add(key); count++; }
      }
    });
    mergeRecords(existing.files, item.files);
  };
  mergeRecords(state.courses, source.courses, mergeContainer);
  if (source.spaces) mergeRecords(state.spaces ||= [], source.spaces, mergeContainer);
  mergeRecords(state.tasks, source.tasks);
  mergeRecords(state.captures, source.captures);
  if (source.ledger) {
    state.ledger ||= {version:1, currency:'CNY', projects:[], entries:[]};
    mergeRecords(state.ledger.projects, source.ledger.projects);
    mergeRecords(state.ledger.entries, source.ledger.entries);
    state.ledger = validateLedger(state.ledger);
  }
  if (source.aiRequests) mergeRecords(state.aiRequests ||= [], source.aiRequests, (existing, item) => {
    mergeRecords(existing.files ||= [], item.files);
    const revisions = existing.revisions ||= [];
    const known = new Set(revisions.map(r => JSON.stringify([r.text,r.targetId,r.savedAt])));
    const candidates = [...(item.revisions || [])];
    if (existing.text !== item.text || existing.targetId !== item.targetId) candidates.push({text:item.text,targetId:item.targetId,savedAt:item.updatedAt || item.createdAt || ''});
    for (const old of candidates) {
      const key = JSON.stringify([old.text,old.targetId,old.savedAt]);
      if (!known.has(key)) { revisions.push(structuredClone(old)); known.add(key); count++; }
    }
    if (existing.originalText === undefined && item.originalText !== undefined) { existing.originalText = item.originalText; count++; }
  });
  if (source.aiDraft) {
    const payload = draft => JSON.stringify([draft.text || '', draft.targetId || 'auto', (draft.files || []).map(f => [f.blobId,f.name,f.size,f.type])]);
    const hasContent = draft => !!draft && (!!draft.text?.trim() || !!draft.files?.length);
    if (hasContent(source.aiDraft) && !hasContent(state.aiDraft)) { state.aiDraft = structuredClone(source.aiDraft); count++; }
    else if (hasContent(source.aiDraft) && payload(source.aiDraft) !== payload(state.aiDraft)) {
      state.aiRequests ||= [];
      if (!state.aiRequests.some(r => r.source === '导入的 AI 草稿' && payload(r) === payload(source.aiDraft))) {
        let suffix = 1;
        while (state.aiRequests.some(r => r.id === `imported-ai-draft-${suffix}`)) suffix++;
        state.aiRequests.push({id:`imported-ai-draft-${suffix}`, ...structuredClone(source.aiDraft), originalText: source.aiDraft.text,
          status:'waiting_model', source:'导入的 AI 草稿', createdAt:source.updatedAt || '',updatedAt:source.updatedAt || ''});
        count++;
      }
    }
  }
  for (const key of ['canvas', 'courseCanvas']) {
    if (!source[key]) continue;
    if (!state[key]?.customized) {
      if (JSON.stringify(state[key]) !== JSON.stringify(source[key])) { state[key] = structuredClone(source[key]); count++; }
    } else mergeRecords(state[key].cards ||= [], source[key].cards);
  }
  if (source.boards) {
    state.boards ||= {};
    for (const [key, board] of Object.entries(source.boards)) {
      if (!state.boards[key]?.customized) {
        if (JSON.stringify(state.boards[key]) !== JSON.stringify(board)) { state.boards[key] = structuredClone(board); count++; }
      } else mergeRecords(state.boards[key].cards ||= [], board.cards);
    }
  }
  if (!state.ui && source.ui) { state.ui = structuredClone(source.ui); count++; }
  if (source.workspaceVersion && (!state.workspaceVersion || state.workspaceVersion < source.workspaceVersion)) state.workspaceVersion = source.workspaceVersion;
  const en = state.english ||= english({});
  const imported = source.english;
  for (const key of ['sessions', 'mistakes', 'attempts']) mergeRecords(en[key] ||= [], imported[key]);
  mergeRecords(en.words ||= [], imported.words, (existing, item) => {
    if (existing.source === 'builtin' && item.source === 'builtin' && existing.status === 'new'
        && ['mastered', 'review'].includes(item.status)) {
      existing.status = item.status;
      if (item.updatedAt) existing.updatedAt = item.updatedAt;
      count++;
    }
  });
  en.plan ||= {};
  for (const [key, value] of Object.entries(imported.plan)) {
    if (isEmpty(en.plan[key]) && !isEmpty(value)) { en.plan[key] = value; count++; }
  }
  en.drafts ||= {}; en.draftUpdatedAt ||= {};
  for (const key of DRAFT_TYPES) {
    const draft = imported.drafts[key];
    if (!draft.trim()) continue;
    if (!en.drafts[key]?.trim()) {
      en.drafts[key] = draft;
      if (imported.draftUpdatedAt[key]) en.draftUpdatedAt[key] = imported.draftUpdatedAt[key];
      count++;
    } else if (en.drafts[key] !== draft && !state.captures.some(item => item.source === '导入的英语草稿' && item.importedDraftKey === key && item.text === draft)) {
      // Deterministic, collision-free ID makes repeated imports idempotent.
      let suffix = 1;
      while (state.captures.some(item => item.id === `imported-english-draft-${key}-${suffix}`)) suffix++;
      state.captures.push({ id: `imported-english-draft-${key}-${suffix}`, text: draft, category: '英语',
        tags: `导入的英语草稿 · ${{ writing: '写作', translation: '翻译', listening: '听力' }[key]}`,
        source: '导入的英语草稿', importedDraftKey: key, example: source.mode === 'demo', archived: false,
        createdAt: imported.draftUpdatedAt[key] || source.updatedAt || '' });
      count++;
    }
  }
  if (!en.audio && imported.audio) { en.audio = structuredClone(imported.audio); count++; }
  if (!en.readingResult && imported.readingResult) { en.readingResult = structuredClone(imported.readingResult); count++; }
  if (!en.readingAnswers || Object.keys(en.readingAnswers).length === 0) {
    if (Object.keys(imported.readingAnswers).length) { en.readingAnswers = structuredClone(imported.readingAnswers); count++; }
  }
  return { state, count };
}
