// Synthetic starter content only: no I/O, model calls, caller-state mutation or
// persistent IDs. The domain allocates IDs and enforces preview/commit/undo.
export const OFFICE_STARTER_ID = 'office-starter-v1';
export const OFFICE_STARTER_MARKER = '创宇宙 · 普通上班族示例工作台（示例数据 v1）';
export const OFFICE_STARTER_DEFAULT_DATE = '2026-10-02';
export const OFFICE_STARTER_NAME = '普通上班族 · 示例工作台';

function fail(code, message) {
  const error = new Error(message); error.code = code; error.status = 400; throw error;
}

export function shanghaiToday(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(date.getTime())) fail('office_date_invalid', '示例基准日期无效。');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const value = type => parts.find(part => part.type === type).value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function dayDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('office_date_invalid', '示例基准日期应为 YYYY-MM-DD。');
  const [year, month, day] = value.split('-').map(Number);
  const result = new Date(Date.UTC(year, month - 1, day));
  if (year < 1000 || result.getUTCFullYear() !== year || result.getUTCMonth() !== month - 1 || result.getUTCDate() !== day) {
    fail('office_date_invalid', '示例基准日期不存在。');
  }
  return result;
}

function dateAt(today, offset = 0) {
  const date = dayDate(today); date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
function monthEnd(today) {
  const date = dayDate(today);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
}

export function getOfficeStarterStatus(state) {
  const workspaces = state?.workspaces ?? [], assets = state?.assets ?? [];
  const marker = assets.find(asset => typeof asset.text === 'string' && asset.text.split('\n')[0] === OFFICE_STARTER_MARKER
    && workspaces.some(workspace => workspace.id === asset.workspaceId));
  if (!marker) return { id: OFFICE_STARTER_ID, installed: false, workspaceId: null, pageCount: 0, componentCount: 0, collectionCount: 0, recordCount: 0, assetCount: 0 };
  const workspace = workspaces.find(item => item.id === marker.workspaceId);
  const collections = (state.collections ?? []).filter(item => item.workspaceId === workspace.id);
  const collectionIds = new Set(collections.map(item => item.id));
  return {
    id: OFFICE_STARTER_ID, installed: true, workspaceId: workspace.id, name: workspace.name,
    archived: workspace.archived, pageCount: workspace.pages.length,
    componentCount: (state.components ?? []).filter(item => item.workspaceId === workspace.id).length,
    collectionCount: collections.length,
    recordCount: (state.records ?? []).filter(item => collectionIds.has(item.collectionId)).length,
    assetCount: assets.filter(item => item.workspaceId === workspace.id).length
  };
}

function task(title, status, due, category, priority, notes, interval = null, owner = '本人（示例）') {
  return { title, status, due, category, priority, notes, start: interval?.[0] ?? null, end: interval?.[1] ?? null, owner };
}

function pageData(today) {
  const d = offset => dateAt(today, offset);
  return [
    {
      key: 'work', name: '本月工作与会议', pageRef: null, collection: '工作事项与会议（示例）',
      categories: ['日常工作', '会议', '跟进'], color: '#7950f2',
      note: `这是普通上班族的虚构示例，日期从 ${today} 起安排。\n本月目标：按时完成工作报告、把会议结论变成待办、及时跟进反馈。\n列表、看板和日历展示同一份记录；在任一视图修改，其他视图同步。\n可以删减模块、调整排列，再把示例换成自己的事务。示例日期不代表真实工作日或节假日安排。`,
      referenceTitle: '工作报告与会议纪要范例（示例）',
      referenceText: '所有内容均为虚构示例。\n工作报告结构：本月进展、存在问题、下月安排。\n会议纪要结构：议题、已达成结论、待办事项、责任人、截止日期。\n示例结论：先核对工作数据，再完成报告初稿；收到反馈后更新内容并提交。\n可对宇宙伙伴说：汇总还没完成的事项，或把会议纪要整理成待办；核对方案后再确认执行。',
      tasks: [
        task('整理本月工作重点', 'done', d(0), '日常工作', '高', '示例已完成：确定报告、会议跟进和资料整理三个重点。'),
        task('补齐上月工作数据', 'doing', d(0), '日常工作', '高', '示例：核对统计表中的缺项，完成后供报告使用。'),
        task('填写本周工作简报', 'todo', d(0), '日常工作', '中', '示例：用三条要点说明进展、问题和下周计划。'),
        task('参加部门例会', 'todo', `${d(0)}T15:00`, '会议', '中', '示例：讨论本月安排；会后记录结论和待办。', [`${d(0)}T14:00`, `${d(0)}T15:00`]),
        task('发送会议纪要', 'todo', d(1), '跟进', '中', '示例：整理例会结论，请同事确认分工及截止日期。'),
        task('跟进工作报告反馈', 'waiting', d(2), '跟进', '高', '示例：等待同事A（虚构）确认资料是否齐全。', null, '同事A（虚构）'),
        task('完成月度报告初稿', 'doing', d(3), '日常工作', '高', '示例：按“进展、问题、下月安排”编写初稿。'),
        task('提交月度工作报告', 'todo', d(5), '日常工作', '高', '示例：在初稿核对和反馈处理完成后提交。'),
        task('月底工作复盘', 'todo', monthEnd(today), '会议', '低', '示例：回顾完成事项，整理未完成原因及下月重点。', [`${monthEnd(today)}T16:00`, `${monthEnd(today)}T16:30`])
      ]
    },
    {
      key: 'event', name: '部门活动筹备', pageRef: 'office_page_event', collection: '部门活动任务（示例）',
      categories: ['准备', '执行', '复盘'], color: '#63e6dc',
      note: `虚构项目：组织一次 12 人的部门交流活动。\n活动时间：${d(10)} 14:00–16:00；地点：部门会议室A（虚构）。\n目标：轻松交流并整理大家的建议；示例预算上限 800 元。\n本页的列表、看板和日历共用活动任务。预算、人数和日期都是示例，可自由修改。`,
      referenceTitle: '活动预算与执行清单（示例）',
      referenceText: `全部为虚构示例，不代表真实费用或订单。\n预算估算：饮品 240 元、物料 120 元、奖品 200 元、备用 100 元，共 660 元，低于 800 元上限。\n活动当天：提前检查设备、准备签到清单、确认物料、按流程组织交流。\n收尾：归还物料、整理费用、收集反馈。\n示例活动时间为 ${d(10)} 14:00–16:00，具体日期可自行调整。`,
      tasks: [
        task('确认活动目标与预算', 'done', d(0), '准备', '高', '示例已完成：12 人交流活动，预算上限 800 元。'),
        task('统计参加意向', 'waiting', d(2), '准备', '中', '示例：等同事A（虚构）补充参加人数。', null, '同事A（虚构）'),
        task('预订活动场地', 'doing', d(3), '准备', '高', '示例：确认会议室A的时间和设备；当前没有真实预订。'),
        task('采购与核对活动物料', 'todo', d(6), '准备', '中', '示例预计支出 660 元；检查饮品、物料和奖品清单。'),
        task('组织部门交流活动', 'todo', `${d(10)}T16:00`, '执行', '高', '示例：按流程签到、交流、收集建议。', [`${d(10)}T14:00`, `${d(10)}T16:00`]),
        task('整理费用与活动复盘', 'todo', d(11), '复盘', '中', '示例：记录实际费用和反馈，整理下一次可复用经验。')
      ]
    },
    {
      key: 'life', name: '生活与个人安排', pageRef: 'office_page_life', collection: '个人生活事项（示例）',
      categories: ['生活事务', '运动', '家庭'], color: '#ff9cce',
      note: `个人安排也可以放在同一个工作台的独立页面。\n从 ${today} 开始的虚构示例：购物、散步、家庭聚餐、缴费提醒和周末整理。\n本页不记录真实账单、个人住址或联系人。按自己的习惯保留需要的模块即可。`,
      referenceTitle: '生活安排使用说明（示例）',
      referenceText: '全部为虚构示例。\n购物清单示例：纸巾、清洁用品和水果。\n家庭聚餐示例：先确认时间、人数和地点，再补充需要准备的物品。\n缴费提醒仅用于演示，不表示真实账单、金额或付款要求。\n可对宇宙伙伴说：整理这周的生活安排，或把购物清单拆成几条事项；所有调整先核对再确认。',
      tasks: [
        task('购买日用品', 'todo', `${d(0)}T19:00`, '生活事务', '中', '示例购物清单：纸巾、清洁用品、水果。', [`${d(0)}T18:30`, `${d(0)}T19:00`]),
        task('晚间散步', 'doing', `${d(0)}T20:00`, '运动', '低', '示例：留出半小时走动，时间可自由调整。', [`${d(0)}T19:30`, `${d(0)}T20:00`]),
        task('确认家庭聚餐安排', 'waiting', d(2), '家庭', '中', '示例：确认大家方便的时间、人数与地点。'),
        task('检查本月缴费提醒', 'todo', d(4), '生活事务', '中', '示例：查看需要处理的账单；当前没有真实金额或付款要求。'),
        task('周末整理房间', 'todo', d(7), '生活事务', '低', '示例：整理桌面和储物区，补充需要购买的物品。')
      ]
    }
  ];
}

function fieldsFor(page) {
  const prefix = `office_${page.key}`;
  return [
    { name: '事项', type: 'text', ref: `${prefix}_title` },
    { name: '状态', type: 'select', ref: `${prefix}_status`, options: [
      { label: '待开始', ref: `${prefix}_todo` }, { label: '进行中', ref: `${prefix}_doing` },
      { label: '待反馈', ref: `${prefix}_waiting` }, { label: '已完成', ref: `${prefix}_done` }
    ] },
    { name: '截止日期', type: 'date', ref: `${prefix}_due` },
    { name: '开始时间', type: 'date', ref: `${prefix}_start` },
    { name: '结束时间', type: 'date', ref: `${prefix}_end` },
    { name: '类别', type: 'select', ref: `${prefix}_category`, options: page.categories.map((label, index) => ({ label, ref: `${prefix}_category_${index}` })) },
    { name: '优先级', type: 'select', ref: `${prefix}_priority`, options: ['高', '中', '低'].map((label, index) => ({ label, ref: `${prefix}_priority_${index}` })) },
    { name: '负责人', type: 'text', ref: `${prefix}_owner` },
    { name: '说明', type: 'text', ref: `${prefix}_notes` }
  ];
}

function pageActions(page, today, marker = false) {
  const prefix = `office_${page.key}`, ref = suffix => `$${prefix}_${suffix}`;
  const labels = { todo: '待开始', doing: '进行中', waiting: '待反馈', done: '已完成' };
  const taskText = [
    ...(marker ? [OFFICE_STARTER_MARKER] : []),
    `普通上班族合成示例｜${page.name}｜基准日期 ${today}`,
    '所有人物、事务、日期和金额均为虚构示例，不表示真实通知、预订或账单。',
    '列表、看板和日历中的记录由以下示例清单预先录入：',
    ...page.tasks.map(item => `${item.title}｜${labels[item.status]}｜截止 ${item.due}｜${item.notes}`)
  ].join('\n');
  const actions = [
    { op: 'asset.create', workspaceId: '$office_workspace', title: `${page.name}事务清单（示例）`, text: taskText, ref: `${prefix}_source` },
    { op: 'asset.create', workspaceId: '$office_workspace', title: page.referenceTitle, text: page.referenceText, ref: `${prefix}_reference` },
    { op: 'collection.create', workspaceId: '$office_workspace', name: page.collection, ref: `${prefix}_items`, fields: fieldsFor(page),
      semanticBindings: { title: ref('title'), status: ref('status'), dueDate: ref('due'), start: ref('start'), end: ref('end'), doneOptions: [ref('done')] } },
    ...page.tasks.map((item, index) => ({
      op: 'record.create', collectionId: ref('items'), ref: `${prefix}_record_${index}`,
      values: {
        [ref('title')]: item.title, [ref('status')]: ref(item.status), [ref('due')]: item.due,
        [ref('start')]: item.start, [ref('end')]: item.end,
        [ref('category')]: ref(`category_${page.categories.indexOf(item.category)}`),
        [ref('priority')]: ref(`priority_${['高', '中', '低'].indexOf(item.priority)}`),
        [ref('owner')]: item.owner, [ref('notes')]: item.notes
      },
      assetIds: [ref('source'), ref('reference')], sourceRefs: [{ assetId: ref('source'), quote: item.title, fieldId: ref('title') }]
    }))
  ];
  const scope = { workspaceId: '$office_workspace', ...(page.pageRef ? { pageId: `$${page.pageRef}` } : {}) };
  const visibleFieldIds = ['title', 'status', 'due', 'category', 'priority', 'owner'].map(ref);
  const viewProps = { visibleFieldIds, sort: { fieldId: ref('due'), direction: 'asc' }, color: page.color };
  actions.push(
    { op: 'component.create', ...scope, type: 'text', title: page.name, layout: { x: 0, y: 0, w: 4, h: 4 }, props: { content: page.note, color: page.color } },
    { op: 'component.create', ...scope, type: 'list', title: page.key === 'work' ? '工作待办与会议' : page.key === 'event' ? '活动任务清单' : '生活待办',
      layout: { x: 4, y: 0, w: 8, h: 4 }, binding: { collectionId: ref('items') }, props: structuredClone(viewProps) },
    { op: 'component.create', ...scope, type: 'board', title: page.key === 'work' ? '本月工作进度' : page.key === 'event' ? '筹备进度' : '生活事务进度',
      layout: { x: 0, y: 4, w: 12, h: 4 }, binding: { collectionId: ref('items'), statusFieldId: ref('status') }, props: structuredClone(viewProps) },
    { op: 'component.create', ...scope, type: 'calendar', title: page.key === 'work' ? '会议与截止日期' : page.key === 'event' ? '活动日程' : '个人安排',
      layout: { x: 0, y: 8, w: 7, h: 5 }, binding: { collectionId: ref('items'), dateFieldId: ref('due') }, props: structuredClone(viewProps) },
    { op: 'component.create', ...scope, type: 'resources', title: '说明与常用资料', layout: { x: 7, y: 8, w: 5, h: 5 },
      props: { assetIds: [ref('source'), ref('reference')], color: page.color } }
  );
  return actions;
}

export function buildOfficeStarterActions({ state, today = shanghaiToday(), name = OFFICE_STARTER_NAME } = {}) {
  dayDate(today);
  if (typeof name !== 'string' || !name.trim() || name.length > 160) fail('office_name_invalid', '示例工作台名称应为 1 至 160 个字符。');
  const installed = getOfficeStarterStatus(state);
  if (installed.installed) fail('office_starter_exists', '这个实例已经添加普通上班族示例，可以继续修改已有工作台。');
  const pages = pageData(today);
  const actions = [
    { op: 'workspace.create', name, template: 'blank', timezone: 'Asia/Shanghai', ref: 'office_workspace' },
    { op: 'workspace.update', id: '$office_workspace', patch: { preferences: {
      density: 'comfortable', theme: 'light', accent: '#7950f2', favoriteComponents: ['text', 'list', 'board', 'calendar', 'resources'],
      priorityText: '普通上班族示例：关注今日待办、会议结论、项目进度与生活安排；所有示例均为虚构。'
    } } },
    ...pages.filter(page => page.pageRef).map(page => ({ op: 'page.create', workspaceId: '$office_workspace', name: page.name, ref: page.pageRef })),
    ...pages.flatMap((page, index) => pageActions(page, today, index === 0))
  ];
  return {
    id: OFFICE_STARTER_ID, name, today, timezone: 'Asia/Shanghai', fictional: true,
    description: '普通上班族的工作、部门活动与生活安排示例，所有内容均为虚构，创建后可自由修改。',
    workspaceCount: 1, pageCount: 3, collectionCount: 3, componentCount: 15, recordCount: 20, assetCount: 6,
    pages: pages.map(page => ({ name: page.name, recordCount: page.tasks.length, componentCount: 5 })), actions
  };
}
