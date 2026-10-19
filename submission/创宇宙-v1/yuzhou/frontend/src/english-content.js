// Authored practice material, not past exam questions or verified real events.
// Preserve the first reading/question IDs and the first six vocabulary indices
// so existing answers, mistakes and vocabulary progress keep their meaning.
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

export const READINGS = [
  {
    id:'quiet-progress', title:'A quieter kind of progress',legacy:true,
    subtitle:'学习方法 · 原创短文 · 3 道理解题', level:'进阶', topic:'校园学习',
    paragraphs:[
      'When a university library introduced a quiet study hour, its aim was simple: give students a place to work without notifications or conversations. Participation was voluntary, and phones were kept in bags rather than collected at the door. The library wanted students to choose attention, not feel that it had been imposed on them.',
      'After a month, the organisers asked participants about their experience. Many said they had completed fewer tasks than they had expected. Yet they understood difficult material more clearly and could explain it in their own words. One engineering student realised that repeatedly checking messages had made a short programming problem stretch across an entire afternoon.',
      'The findings did not prove that silence improves everyone’s performance. Students had chosen to attend, and the survey relied on their own reports. Some preferred background music, while others worked better with a partner. What the project offered was an opportunity to notice a habit and test a different one.',
      'The library therefore kept the quiet hour but added other options, including a discussion room and a short reflection sheet. Students could record what they tried and what helped. Progress, the organisers argued, should be measured not only by the number of tasks completed, but also by the quality of understanding gained.'
    ],
    questions:[
      {id:'r1',text:'Why did the library allow students to keep their phones?',options:['To help them answer the survey.','To encourage a voluntary choice to focus.','To let them discuss difficult questions.','To monitor how often they checked messages.'],answer:1,explanation:'第一段最后一句说明，活动希望学生主动选择专注，而不是感到被强制要求。'},
      {id:'r2',text:'What limitation of the findings does the passage mention?',options:['The study room was too small.','Only engineering students participated.','The results were based on self-reports from volunteers.','No participant finished a programming task.'],answer:2,explanation:'第三段指出，参与者自行选择参加，且调查依赖他们自己的反馈，因此不能据此推断对所有人都有效。'},
      {id:'r3',text:'Which statement best expresses the main idea?',options:['Understanding is an important part of learning progress.','Students should complete as many tasks as possible.','Quiet environments work equally well for everyone.','Libraries should remove phones from study rooms.'],answer:0,explanation:'最后一段强调，进步既包括任务数量，也包括理解的质量；全文围绕尝试适合自己的学习方式展开。'}
    ]
  },
  {
    id:'return-a-cup',title:'A cup to return',subtitle:'日常沟通 · 原创对话 · 3 道理解题',level:'基础',topic:'日常沟通',
    paragraphs:[
      'Mia: I would like a tea to take away, please. Can I use this reusable cup?',
      'Sam: Yes. It costs two pounds to borrow the cup, in addition to the price of your tea. We return the two pounds when you bring the cup back.',
      'Mia: Do I have to return it today?',
      'Sam: No. Any day this week is fine. Please bring it to this café before six in the evening. Other cafés cannot accept it.',
      'Mia: Great. I will be near here on Thursday, so I can return it then.'
    ],
    questions:[
      {id:'cup-q1',text:'What are the extra two pounds for?',options:['Buying a second tea.','Keeping the cup forever.','Borrowing the reusable cup.','Returning the cup late.'],answer:2,explanation:'Sam明确说借杯需要在茶价之外付两英镑，归还后退回；不是购杯或逾期费用。'},
      {id:'cup-q2',text:'Where should Mia return the cup?',options:['To the same café.','To any café in the city.','To a shop near her home.','To a station on Thursday.'],answer:0,explanation:'Sam说“this café”，并明确其他咖啡馆不接收，所以需回到同一家。'},
      {id:'cup-q3',text:'Which return plan follows Sam’s instructions?',options:['Next week at five in the afternoon.','This Thursday at seven in the evening.','Today at another café.','This Thursday at five in the afternoon.'],answer:3,explanation:'要求是本周、这家店、晚上六点前；本周四下午五点符合时间要求，另三项分别违反周次、时间或地点条件。'}
    ]
  },
  {
    id:'room-change',title:'The workshop has moved',subtitle:'校园学习 · 原创通知 · 3 道理解题',level:'基础',topic:'校园学习',
    paragraphs:[
      'Notice to workshop participants: Thursday’s study-planning workshop will begin at 3 p.m., as planned. However, it will take place in Room 204 of the library, not Room 102 of the teaching building. Room 102 is being painted.',
      'Please bring your weekly timetable and a pen. You do not need a laptop. At the workshop, you will choose one difficult task and divide it into smaller steps. There will be time to discuss your plan with a partner.',
      'If you cannot attend, please email the organiser before Wednesday evening. The organiser will then offer your place to a student on the waiting list.'
    ],
    questions:[
      {id:'room-q1',text:'What has changed about the workshop?',options:['Its starting time.','Its room and building.','The day of the week.','The organiser’s email address.'],answer:1,explanation:'第一段保留周四下午三点，但地点从教学楼102换到图书馆204。'},
      {id:'room-q2',text:'What should participants bring?',options:['A laptop and a paintbrush.','A completed project and a camera.','A library map and a partner’s plan.','Their weekly timetable and a pen.'],answer:3,explanation:'第二段直接要求weekly timetable和pen，并说明不需要电脑。'},
      {id:'room-q3',text:'Why should an absent participant email the organiser?',options:['So another student can take the place.','So the workshop can start earlier.','So Room 102 can be painted sooner.','So the organiser can buy a laptop.'],answer:0,explanation:'末段说明邮件使组织者能把名额提供给候补名单上的学生。'}
    ]
  },
  {
    id:'clear-handover',title:'A note for the next shift',subtitle:'职场协作 · 原创短文 · 3 道理解题',level:'进阶',topic:'职场协作',
    paragraphs:[
      'At a small design studio, the morning team often left messages such as “the poster is nearly ready” for the afternoon team. These messages sounded positive, but they did not explain which file was current or what still needed attention. As a result, people sometimes repeated work that a colleague had already done.',
      'The team tried a different handover note. Each note included a link to the current file, one completed change and the next unfinished action. For example, one note said: “The title has been shortened in poster-v3. Please check the date before sending it to the client.”',
      'The note did not give permission to send an unchecked design. It made the remaining decision visible. Team members still spoke directly when the message was unclear or when a deadline was at risk.'
    ],
    questions:[
      {id:'handover-q1',text:'What was the problem with the earlier messages?',options:['They included too many file links.','They were sent only to clients.','They did not identify the current file and remaining work.','They prohibited direct conversation.'],answer:2,explanation:'第一段的问题是没有指出当前文件与待处理事项，导致重复劳动。'},
      {id:'handover-q2',text:'According to the example note, what should happen next?',options:['Shorten the title again.','Check the date before sending the poster.','Delete all previous poster files.','Send poster-v3 without checking it.'],answer:1,explanation:'示例说明标题已经缩短，下一步是在发送前核对日期。'},
      {id:'handover-q3',text:'How does the team use direct conversation?',options:['It is no longer allowed after the new note is introduced.','It replaces every written note.','It is reserved for clients only.','It remains useful when a message is unclear or a deadline is at risk.'],answer:3,explanation:'末句明确保留直接沟通，用于说明不清或截止时间有风险的情况。'}
    ]
  },
  {
    id:'offline-demo',title:'Preparing for a quiet screen',subtitle:'项目展示 · 原创短文 · 3 道理解题',level:'进阶',topic:'项目展示',
    paragraphs:[
      'Lin was preparing to demonstrate a task-planning app at a student showcase. The live version needed an internet connection to generate suggestions. Rather than assume the connection would work, Lin also prepared a short recording of a previous test and a set of sample tasks.',
      'During practice, Lin disconnected the computer. The app still displayed saved tasks, but it could not generate a new suggestion. Lin changed the presentation notes to explain that difference. The recording was clearly labelled with the date of the test and described as a recording, not a live result.',
      'Lin also left a minute for questions about the app’s limits. The aim was to show what the app could do under the conditions of the demonstration. A backup recording could help explain the workflow, but it could not prove that a new request had succeeded.'
    ],
    questions:[
      {id:'demo-q1',text:'What could the app still do without an internet connection?',options:['Display saved tasks.','Generate a new online suggestion.','Upload a new recording.','Verify every sample task.'],answer:0,explanation:'第二段实测情境中能显示已保存任务，但无法生成新建议。'},
      {id:'demo-q2',text:'How did Lin describe the backup video?',options:['As proof that the current request had succeeded.','As a live stream from another computer.','As a dated recording of an earlier test.','As a replacement for all questions.'],answer:2,explanation:'第二段说明视频标注了测试日期，并明确是早先测试的录制内容。'},
      {id:'demo-q3',text:'What is the main lesson of the passage?',options:['Every demonstration should hide technical limits.','A demonstration should distinguish current capabilities from recorded examples.','Saved tasks are always more useful than new suggestions.','A recording guarantees that future requests will work.'],answer:1,explanation:'全文通过离线检查和录像标注，强调区分现场能力与历史示例，而不是用录像证明新请求成功。'}
    ]
  },
  {
    id:'headline-source',title:'Before sharing the headline',subtitle:'信息素养 · 原创短文 · 3 道理解题',level:'挑战',topic:'信息素养',
    paragraphs:[
      'A message in a neighbourhood chat claimed that the local library would close “for the whole summer”. It included a screenshot of a headline but no link. Several members began suggesting other places to study.',
      'Before forwarding the message, Noah found the library’s own notice. It said that the children’s room would close for repairs for two weeks in July. The main reading room would remain open. The notice also gave its publication date and a contact number for questions.',
      'Noah shared a link to the notice and explained the difference between the two messages. Noah did not claim that all future opening hours were certain: the library could publish another update. The useful correction was narrower. The available notice did not support the claim that the entire library would close for the whole summer.'
    ],
    questions:[
      {id:'source-q1',text:'What did the library’s notice actually announce?',options:['The whole library would close for the summer.','The main reading room would close for two weeks.','Every room would open later each morning.','The children’s room would close for two weeks in July.'],answer:3,explanation:'第二段限定了关闭范围为儿童阅览室，时段为七月中的两周。'},
      {id:'source-q2',text:'Why was the original notice more useful than the screenshot?',options:['It provided the scope, dates and a way to ask questions.','It promised that opening hours could never change.','It had already been forwarded by more people.','It removed the need to read the full announcement.'],answer:0,explanation:'原通知提供受影响区域、时间、发布日期和联系方式；转发量和永久保证均不是依据。'},
      {id:'source-q3',text:'Which conclusion is best supported?',options:['No part of the library will ever need repairs again.','Every message in the chat is false.','The current notice does not support a summer-long closure of the entire library.','The library is certain to publish another closure notice.'],answer:2,explanation:'末段明确把结论限定在当前通知不能支持全馆停业整个夏季，未推断未来永不变更或其他消息均假。'}
    ]
  },
  {
    id:'small-pilot',title:'What five trials can tell us',subtitle:'项目展示 · 原创短文 · 3 道理解题',level:'挑战',topic:'项目展示',
    paragraphs:[
      'A student team asked five volunteers to try a new booking form. All five completed the task, and four said the page felt easy to use. The team was pleased, but its notes included an important detail: the designer sat beside each volunteer and answered questions.',
      'For the next round, the team wanted to observe people using the form without that help. It wrote the task instructions in advance and decided to record where people paused, what they misunderstood and whether they finished. The volunteers would be told that the form was being tested, not their ability.',
      'The first round had still been useful. It had revealed confusing labels and suggested questions for further testing. However, the team could not separate the effect of the design from the effect of the designer’s help. Its report therefore described the five assisted trials and the planned next round, rather than claiming that all users would find the form easy.'
    ],
    questions:[
      {id:'pilot-q1',text:'What limits the conclusion drawn from the first round?',options:['None of the volunteers completed the task.','The designer helped participants during the trials.','The form was never shown to anyone.','All five volunteers disliked the page.'],answer:1,explanation:'第一段与末段都指出设计者提供了帮助，因此难以分离界面本身与现场协助的作用。'},
      {id:'pilot-q2',text:'What does the team plan to change in the next round?',options:['It will stop recording misunderstandings.','It will tell participants their ability is being graded.','It will guarantee that every participant finishes.','It will observe people using the form without the designer’s help.'],answer:3,explanation:'第二段明确计划不提供设计者现场帮助，并预先写好任务说明、记录停顿和误解。'},
      {id:'pilot-q3',text:'Which description of the first round is most accurate?',options:['It identified issues and informed further testing, but did not justify a claim about all users.','It proved that the form needed no more testing.','It established the exact time saved by every user.','It showed that assistance never affects a test.'],answer:0,explanation:'末段承认首轮发现了标签问题并帮助设计下一轮，同时拒绝据五次协助测试推广到所有用户。'}
    ]
  },
  {
    id:'shared-calendar',title:'One appointment, two views',subtitle:'职场协作 · 原创短文 · 3 道理解题',level:'进阶',topic:'职场协作',
    paragraphs:[
      'The campus media team used a task board and a calendar to prepare interviews. At first, members typed every appointment into both places. When an interview moved from Tuesday to Wednesday, one member updated the task board but forgot the calendar. Another member arrived a day early.',
      'The team then linked the calendar view to the dated tasks on the board. A task’s title and date were stored once, and both views used those values. Changing the date on the board therefore changed where that task appeared on the calendar.',
      'The team also kept personal reminders in the calendar. These were separate entries, so editing a task did not rewrite them. To avoid confusion, the calendar labelled each item as either a linked task or a personal reminder. Members could tell which record they needed to edit.'
    ],
    questions:[
      {id:'calendar-q1',text:'Why did a member arrive a day early?',options:['The interview date had never been decided.','The new calendar view changed dates at random.','The task board was updated but the separately typed calendar entry was not.','The team deleted every personal reminder.'],answer:2,explanation:'第一段说明采访从周二改到周三，但只有任务看板更新，独立日历条目遗漏修改。'},
      {id:'calendar-q2',text:'After linking the views, what happens when a task’s date changes on the board?',options:['Every personal reminder is moved to the same date.','The same task appears on the new date in the calendar.','A second task is created automatically.','The task’s title is permanently deleted.'],answer:1,explanation:'第二段说明两种视图读取同一份标题和日期，所以该任务在日历中的日期随之改变。'},
      {id:'calendar-q3',text:'Why are calendar items labelled by type?',options:['To prevent anyone from changing an appointment.','To make personal reminders part of every task.','To show that all items update together.','To show whether an item comes from a linked task or a separate reminder.'],answer:3,explanation:'第三段的标签用于区分关联任务与独立提醒，从而知道应编辑哪条记录。'}
    ]
  }
];

export const WRITING_PROMPTS = [
  {id:'technology-learning',title:'Does technology make learning easier?',legacy:true,level:'进阶',topic:'校园学习',prompt:'Write an essay discussing how technology can support independent learning. Give examples and explain one possible limitation. Suggested length: 150–200 words.',guide:['先说明你对技术辅助自主学习的看法。','给出一至两个具体使用情境，解释如何帮助学习。','讨论一个限制，并提出相应做法；避免笼统保证效果。']},
  {id:'appointment-email',title:'Could we change the time?',level:'基础',topic:'日常沟通',prompt:'You have an appointment with a classmate at 2 p.m. on Friday, but you now have a class at that time. Write a polite message asking to move the appointment. Suggest two alternative times and ask your classmate to confirm one. Suggested length: 60–90 words.',guide:['交代原约定和需要调整的原因。','提出两个具体备选时间；它们是你为练习自定的安排。','用礼貌的请求和确认语句结束，不把建议写成对方已经同意。']},
  {id:'study-invitation',title:'An invitation to study together',level:'基础',topic:'校园学习',prompt:'Invite a classmate to a short study session before a course presentation. Explain what you want to practise, suggest a place and a time, and say what each person should bring. Suggested length: 80–110 words.',guide:['明确邀请对方练习哪项内容。','提供时间、地点及需要携带的材料。','给对方调整安排或婉拒的空间。']},
  {id:'meeting-followup',title:'What happens after the meeting?',level:'进阶',topic:'职场协作',prompt:'Imagine your team has discussed a small website project. Write a follow-up email summarising two agreed actions, who will handle each action, and their planned dates. Include one question that still needs clarification. Suggested length: 120–160 words.',guide:['开头说明邮件目的，用简短背景帮助读者定位。','为两项虚构行动分别写清负责人和计划日期。','将已经商定的事项与待澄清问题分开，不编造真实工作记录。']},
  {id:'project-introduction',title:'Explain a project to a new visitor',level:'进阶',topic:'项目展示',prompt:'Introduce a small app or project to someone who has never used it. Explain the problem it addresses, describe one short workflow, and state one current limitation. End with a question you would ask a first-time user. Suggested length: 150–180 words.',guide:['先讲使用者和具体问题，再介绍功能。','按操作顺序描述一条流程，避免只罗列技术名词。','区分已经具备的能力与计划中的能力。','结尾提出可通过实际体验回答的问题。']},
  {id:'sharing-information',title:'Before forwarding a claim',level:'挑战',topic:'信息素养',prompt:'Write a short article for a student newsletter about checking information before sharing it. Discuss how the original source, publication date and missing context can affect a claim. Give a made-up example and explain what you would do if you could not verify it. Suggested length: 180–220 words.',guide:['围绕来源、日期和语境组织论点。','明确例子是假设情境，不冒充已经发生的新闻。','说明证据不足时如何保留不确定性。','提出具体检查步骤，避免声称某一种来源绝对不会出错。']}
];

// References illustrate one possible translation; equivalent wording is valid.
export const TRANSLATION_PROMPTS = [
  {id:'digital-learning',title:'把熟悉的日常，写成英语',legacy:true,level:'进阶',topic:'校园学习',prompt:'近年来，越来越多的大学生开始使用数字工具管理学习资料。他们把课堂笔记、阅读材料和个人想法保存在同一个地方，以便随时查找。然而，收集资料只是第一步。只有定期回顾并尝试用自己的语言解释所学内容，知识才能真正成为自己的。',reference:'In recent years, more and more university students have begun using digital tools to manage their study materials. They keep class notes, reading materials and personal ideas in one place so that they can find them whenever needed. However, collecting materials is only the first step. Only by reviewing them regularly and trying to explain what they have learned in their own words can students truly make that knowledge their own.',notes:['“以便”可用 so that 或 to 表达目的。','“用自己的语言”可表达为 in their own words。','参考译文使用 Only by…can… 倒装，也可通过调整句式准确传达条件关系；不要求逐字一致。']},
  {id:'changing-plans',title:'礼貌地调整约定',level:'基础',topic:'日常沟通',prompt:'抱歉，我周五下午有课，不能按原计划与你见面。我们可以改到周六上午或者周日下午吗？如果这两个时间都不方便，请告诉我你什么时候有空。',reference:'I’m sorry, but I have a class on Friday afternoon and cannot meet you as planned. Could we meet on Saturday morning or Sunday afternoon instead? If neither time works for you, please let me know when you are available.',notes:['保留道歉、解释、备选安排和询问四层信息。','“不方便”在时间安排中可用 does not work for you，不必直译为 inconvenient。','Could we… 比直接命令更符合原文的商量语气。']},
  {id:'study-review',title:'一次简短的学习回顾',level:'基础',topic:'校园学习',prompt:'小组计划在周三课后回顾本周的学习内容。每个人带来一个仍然不理解的问题。大家先尝试解释，再查阅笔记。没有解决的问题会被记录下来，留到下次向老师请教。',reference:'The group plans to review this week’s learning after class on Wednesday. Each person will bring one question they still do not understand. They will first try to explain it and then check their notes. Any questions they cannot answer will be written down so they can ask the teacher next time.',notes:['原文是计划，不应翻译成已经完成的学习记录。','“先……再……”可用 first…then… 保留顺序。','末句可用主动或被动语态，只要保留记录问题与下次请教的目的。']},
  {id:'handover-note',title:'把交接信息写清楚',level:'进阶',topic:'职场协作',prompt:'交接说明不必很长，但应该让下一位同事知道当前使用哪个文件、哪些部分已经完成，以及接下来需要做什么。如果截止时间还没有确定，应当写明“待确认”，而不是猜测一个日期。',reference:'A handover note does not have to be long, but it should tell the next colleague which file is current, which parts are complete and what needs to be done next. If the deadline has not been decided, the note should say “to be confirmed” rather than give a guessed date.',notes:['三个并列信息应完整保留，不要漏掉当前文件。','“不必”可用 does not have to 或 need not。','“待确认”可用 to be confirmed；不要将未知日期改写成确定承诺。']},
  {id:'demo-boundary',title:'说明现场演示的边界',level:'进阶',topic:'项目展示',prompt:'为了准备展示，我们录制了一段测试视频，并标注了录制日期。如果现场网络不可用，我们会播放这段视频解释操作流程，同时说明它不是本次现场请求的结果。展示结束后，我们还会介绍尚未验证的功能。',reference:'To prepare for the demonstration, we recorded a test video and labelled it with the recording date. If the internet connection is unavailable during the event, we will play the video to explain the workflow and make clear that it is not the result of the current live request. After the demonstration, we will also describe the features that have not yet been tested.',notes:['区分已经录制的过去动作和现场可能采取的未来动作。','“如果”条件不能省略，否则会改变预案含义。','“尚未验证”可用 not yet tested 或 not yet verified，不等于“已经失效”。']},
  {id:'pilot-evidence',title:'谨慎解读一次小范围试用',level:'挑战',topic:'信息素养',prompt:'五位志愿者在设计者的帮助下完成了任务。这说明该流程值得进一步测试，但不能证明所有用户都能独立完成。报告应该保留参与人数、提供帮助的方式以及尚未解决的问题，以便读者理解结论的适用范围。',reference:'Five volunteers completed the task with help from the designer. This suggests that the workflow is worth testing further, but it does not prove that all users can complete it independently. The report should retain the number of participants, the way assistance was provided and the unresolved issues, so that readers can understand the limits of the conclusion.',notes:['“说明……值得”用 suggests…is worth… 可保留审慎语气。','必须保留“在帮助下”与“独立完成”的对比条件。','“适用范围”可表达为 limits 或 scope；不能把小范围结果扩写成普遍成功结论。']}
];
