// The vocabulary order defines persisted builtin-word IDs.
export const VOCABULARY = [
  ['perspective', '/pəˈspektɪv/', 'n. 观点；视角', 'A different perspective can lead to a better solution.', '换一个视角，可能就会找到更好的解决办法。'],
  ['sustainable', '/səˈsteɪnəbl/', 'adj. 可持续的', 'Small, consistent habits make learning sustainable.', '小而持续的习惯，让学习能够长久进行。'],
  ['allocate', '/ˈæləkeɪt/', 'v. 分配；拨出', 'We need to allocate enough time for testing.', '我们需要为测试留出足够的时间。'],
  ['substantial', '/səbˈstænʃl/', 'adj. 大量的；重要的', 'The new approach led to a substantial improvement.', '新的方法带来了显著的改善。'],
  ['retain', '/rɪˈteɪn/', 'v. 保留；记住', 'Explaining an idea helps us retain it.', '解释一个概念，有助于我们记住它。'],
  ['evaluate', '/ɪˈvæljueɪt/', 'v. 评价；评估', 'Evaluate the evidence before reaching a conclusion.', '得出结论前，先评估证据。'],
  ['confirm', '/kənˈfɜːm/', 'v. 确认', 'Please confirm the meeting time before Friday.', '请在周五之前确认会议时间。'],
  ['schedule', '/ˈʃedjuːl/', 'n. 时间安排；日程', 'The new schedule leaves ten minutes for questions.', '新的时间安排留出了十分钟提问。'],
  ['available', '/əˈveɪləbl/', 'adj. 有空的；可用的', 'Is this room available on Tuesday afternoon?', '这个房间周二下午可以使用吗？'],
  ['request', '/rɪˈkwest/', 'n. 请求；v. 请求', 'I sent a request for a later appointment.', '我发出了将预约时间延后的请求。'],
  ['clarify', '/ˈklærəfaɪ/', 'v. 澄清；说明', 'Could you clarify which file we should edit?', '你能说明一下我们应该编辑哪个文件吗？'],
  ['revise', '/rɪˈvaɪz/', 'v. 修改；修订', 'We revised the introduction after reading the feedback.', '阅读反馈后，我们修改了引言。'],
  ['priority', '/praɪˈɒrəti/', 'n. 优先事项', 'Fixing the broken link is our first priority.', '修复失效链接是我们的首要任务。'],
  ['deadline', '/ˈdedlaɪn/', 'n. 截止时间', 'The team agreed on a deadline for the first draft.', '团队商定了初稿的截止时间。'],
  ['progress', '/ˈprəʊɡres/', 'n. 进展；进步', 'We record our progress at the end of each week.', '我们在每周结束时记录进展。'],
  ['evidence', '/ˈevɪdəns/', 'n. 证据；依据', 'The report separates evidence from personal opinions.', '这份报告将证据与个人观点分开。'],
  ['reliable', '/rɪˈlaɪəbl/', 'adj. 可靠的', 'We need a reliable source for the opening hours.', '我们需要可靠的来源来确认开放时间。'],
  ['context', '/ˈkɒntekst/', 'n. 背景；语境', 'The full message provides context for the short reply.', '完整消息为那条简短回复提供了背景。'],
  ['feedback', '/ˈfiːdbæk/', 'n. 反馈', 'Her feedback helped us make the instructions clearer.', '她的反馈帮助我们把说明写得更清楚。'],
  ['assumption', '/əˈsʌmpʃn/', 'n. 假设；想当然的看法', 'We checked our assumption that everyone knew the shortcut.', '我们核查了“每个人都知道这个快捷方式”的假设。'],
  ['compare', '/kəmˈpeə/', 'v. 比较', 'Compare the two drafts and explain your choice.', '比较这两份草稿，并说明你的选择。'],
  ['practical', '/ˈpræktɪkl/', 'adj. 实用的；切实可行的', 'The guide offers practical advice for a first presentation.', '这份指南为首次展示提供了实用建议。'],
  ['consistent', '/kənˈsɪstənt/', 'adj. 一致的；持续的', 'Use consistent names for the same buttons on every page.', '在各个页面上，为相同按钮使用一致的名称。'],
  ['permission', '/pəˈmɪʃn/', 'n. 允许；许可', 'Ask for permission before sharing someone else’s notes.', '分享他人的笔记前，应先征得允许。']
];

export function localDate(date = new Date()) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function seedEnglish(demo = false) {
  const recent = (days) => { const d = new Date(); d.setDate(d.getDate() - days); return localDate(d); };
  return {
    plan: { examDate: '', target: demo ? 550 : '', dailyMinutes: demo ? 30 : '', focus: 'reading' },
    words: VOCABULARY.map((v, i) => ({ id: `builtin-word-${i}`, word: v[0], phonetic: v[1], meaning: v[2], example: v[3], translation: v[4], source: 'builtin', status: demo && i < 2 ? 'mastered' : demo && i === 2 ? 'review' : 'new' })),
    sessions: demo ? [
      { id: 'demo-en-1', date: recent(4), minutes: 20, type: 'reading', note: '演示记录：阅读理解' },
      { id: 'demo-en-2', date: recent(2), minutes: 15, type: 'vocabulary', note: '演示记录：词汇复习' },
      { id: 'demo-en-3', date: recent(1), minutes: 25, type: 'listening', note: '演示记录：听力精听' }
    ] : [],
    readingAnswers: {}, readingResult: null, attempts: [], mistakes: [],
    drafts: { writing: '', translation: '', listening: '' }, audio: null, draftUpdatedAt: {}
  };
}

