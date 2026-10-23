// Authored, editable examples for the existing modules. No model call or file import.
import {validateBackup} from './backup.js';
import {getWorkbench,validateWorkbench,WORKBENCH_MODULES} from './workbench-model.js';
import {hasShowcaseExamples,planShowcaseExamples} from './showcase-examples.js';
import {createPresetInput} from './custom-block-presets.js';
import {READINGS,TRANSLATION_PROMPTS} from './english-content.js';
import {localDate} from './ledger-model.js';

const PREFIX='showcase-dev019-';
export const SHOWCASE_GALLERY_SPACE_ID=PREFIX+'guide';
export const SHOWCASE_GALLERY_FITNESS_ID=PREFIX+'fitness';
export const SHOWCASE_GALLERY_COURSE_IDS=Object.freeze([PREFIX+'course-design',PREFIX+'course-writing']);
export const SHOWCASE_GALLERY_BLOCK_IDS=Object.freeze(['note','checklist','links','progress','countdown','table','miniapp'].map(kind=>'block:'+PREFIX+kind));
const DOMAIN_KEYS=['courses','spaces','tasks','captures','calendar','timetable','fitness','competitions','ledger','customBlocks','workbench','canvas','updatedAt'];
const COUNTS=Object.freeze({spaces:2,notes:5,tasks:2,captures:12,competitions:0,milestones:0,competitionTasks:0,ledgerProjects:0,ledgerEntries:0,blocks:7,courses:2,courseNotes:4,timetableTerms:1,timetableEvents:3,calendarEvents:3,fitnessSessions:4,englishReferences:2});
const clone=value=>structuredClone(value);
const fail=message=>{throw new Error(message);};
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const colors=['#AE88FF','#63E6DC','#FF9CCE','#D8F649','#FFBC7C','#9DC5FF','#8EDBE8'];

export function hasShowcaseGallery(state){return !!state?.spaces?.some(space=>space.id===SHOWCASE_GALLERY_SPACE_ID&&space.example===true);}

function dateTools(now){
  if(!(now instanceof Date)||!Number.isFinite(now.getTime()))fail('示例日期无效。');
  const day=offset=>{const d=new Date(now.getFullYear(),now.getMonth(),now.getDate(),12);d.setDate(d.getDate()+offset);return localDate(d);};
  return {stamp:now.toISOString(),day,monday:day(-((now.getDay()+6)%7))};
}

function galleryState(now){
  const d=dateTools(now),meta={archived:false,createdAt:d.stamp,updatedAt:d.stamp};
  const note=(suffix,title,content,chapter='体验指引')=>({id:PREFIX+suffix,title:title+' · 示例',content,chapter,source:'平台编写的可编辑示例；不是用户真实记录或模型回复。',example:true,revisions:[],...meta});
  const root={id:SHOWCASE_GALLERY_SPACE_ID,title:'全模块体验导览 · 示例',description:'从搭建、课程、英语、灵感到日程与生活，用明确标注的模拟内容体验各个模块。可以编辑；日期都是自定计划。',type:'project',icon:'layers',color:colors[0],example:true,...meta,files:[],notes:[
    note('guide-start','从这里开始看工作台',`# 全模块体验导览\n\n这组资料是平台编写的示例，供你观看、修改和练习。它不代表真实学习、消费、报名、模型调用或已通过的验收。\n\n## 推荐路线\n1. 首页／搭建台：查看所有内置模块，拖动方块；双击打开内容。已有方块位置保持，新增方块放在画布下方，可用“看全画布”查看。\n2. 课程空间：打开“交互产品设计 · 示例”和“项目英语表达 · 示例”，查看分章笔记与待思考问题；可以编辑原文。示例没有伪造附件。\n3. 英语：练习空间已有原创阅读、写作与翻译题；“我的资料”显示两条从收集箱共享的英语原文。不会替你答题、评分或写入草稿。\n4. 灵感收集箱：查看纸片、便笺和长短不同的想法，进入梦境看它们持续流动；搜索、暂停、点开阅读或编辑。\n5. 待办／日历／比赛／记账：按“关联路线”笔记修改一个日期，观察同一来源在相关页面如何更新。\n6. 生活回顾：时间线有一条明确标注的模拟完成任务，仅为演示，不是你的真实完成记录。\n7. 学期课表：选择“本周练习学期 · 示例”，查看三项独立安排；它不是学校正式课表。\n8. “活动与运动 · 示例”：查看四条模拟活动记录及图表；所有数值只用于展示，不代表健康建议或真实测量。\n9. 七类示例方块：便笺、清单、收藏、进度、倒计时、表格可直接编辑；计算器需手动运行。\n\n## 日期说明\n示例以加入当天 ${d.day(0)} 为参考，倒计时目标为 ${d.day(7)}。都是自定练习计划，并非官方截止。`),
    note('guide-relations','关联路线与独立内容',`# 可亲手核对的关联\n\n- 本导览空间的“观察英语素材共享”待办与全局待办是同一条记录，通过 spaceId 关联；它还通过 captureId 指向英语原文。修改日期或完成状态后，日历的关联视图同步读取该待办。\n- 收集箱中分类为“英语”的两条原文，也显示在英语的“我的资料”；没有复制第二份正文。可修改一条原文，再查看英语资料。\n- 模拟回顾任务在全局待办与生活回顾读取同一记录；取消完成会改变时间线，不代表真实任务已经发生。\n- 健身图表只汇总“活动与运动 · 示例”空间所属的模拟记录，修改时长后可查看变化。\n- 参赛筹备示例中的比赛节点和准备事项，由日历投影展示；项目账本独立核算，不计入日常总账。旧示例如已被修改或删除，不会为了本次展示恢复。\n\n# 保持独立的内容\n\n- 课表中的课程名称与课程空间可对应阅读，但当前没有结构性课程关联，改名／改期不会自动同步，也不会自动写入日历。\n- 日历新增的三条原生日程是独立记录；日历中的关联待办、比赛节点仍在来源模块修改。\n- 自定义清单、进度、倒计时和表格是手工维护的内容，不自动同步待办、账目、课表或比赛进度。\n- 课程笔记与英语题库内容用于参考；没有自动生成附件、学习成绩、用户草稿、AI回执或真实消费凭据。`),
    note('guide-ai','和 AI 伙伴一起搭建',`# 可复制给 AI 的练习意图\n\n以下是平台编写的示例需求，不是已经发出的请求，也没有预设模型回复。\n\n## 整理已有内容\n请阅读“全模块体验导览 · 示例”空间的笔记，先提出一个三分钟体验路线，并说明哪些关联可以操作验证、哪些内容独立维护。只给建议，先不要改动。\n\n## 调整工作台\n请把课程、英语和灵感模块排在便于访问的位置，保留其他模块和已有记录。请先列出变更方案，等待我审核确认。\n\n## 创建自定义方块\n请设计一个会议准备清单方块，包含议题、需要阅读的资料和待确认事项。用明确的示例数据，不把事项标记为已经完成。先让我查看方案。\n\n## 创建可交互小工具\n请在受控的小程序组件 API 内做一个两数计算工具，保留输入并展示结果；不访问网络、账号或其他方块数据。先展示源码和修改方案，由我确认保存并手动运行。\n\n## 操作规则\n打开 AI 伙伴只准备对话；需要你手动发送。真实模型取决于本实例专用 Key 与额度，方案通过审核并确认后才执行。这里没有模拟成真实请求的 AI 历史。`),
    note('guide-english','英语素材与原创练习',`# 一个可操作的学习场景\n\n1. 到“英语 → 我的资料”，阅读“给初次体验者的项目介绍”和“礼貌地调整约定”两条示例原文，它们与灵感收集箱共享记录。\n2. 到“练习空间 → 写作”，选择 Explain a project to a new visitor：先说明问题，再描述一条流程，最后说明一个尚未验证的限制。\n3. 到“练习空间 → 翻译”，选择“礼貌地调整约定”，尝试自己的译文后查看原题内参考。\n4. 阅读空间已有 ${READINGS.length} 篇原创短文，可按基础、进阶、挑战选择。标签是练习编排，不是考试认证。\n\n## 一段原创表达示例\nThis workbench lets people arrange tools around their own routines. For example, a visitor can save an idea, turn it into a task, and view its planned date in the calendar. The AI assistant proposes changes for review before they are applied. We still need to test the workflow with more people.\n\n这是写作参考，不是你的已提交作文，也不代表已经做过真人效果测试。本次不写入词汇掌握状态、答题记录、学习时长或草稿。听力需要你提供可用音频，没有虚构可播放的音频附件。`)
  ]};
  const fitnessSpace={id:SHOWCASE_GALLERY_FITNESS_ID,title:'活动与运动 · 示例',description:'四条模拟活动记录，用于体验按日、周、月查看时长和里程；非真实测量、训练建议或健康效果。',type:'fitness',fitnessEnabled:true,icon:'chart',color:colors[1],example:true,...meta,files:[],notes:[
    note('fitness-guide','怎样查看模拟运动记录','这四条记录全是模拟数值。打开本空间的运动统计，切换日／周／月、时长／里程，再编辑某条记录的数值，观察统计变化。热量没有填写时保留未知，不根据运动类型估算。图表仅汇总本空间记录；不会从其他账号或设备读取运动数据。','活动记录')
  ]};
  const courses=[
    {id:SHOWCASE_GALLERY_COURSE_IDS[0],title:'交互产品设计 · 示例',subtitle:'从用户场景到可验证原型的两章原创参考笔记。',icon:'layers',color:colors[0],prompt:'先区分笔记中的事实、假设和待验证问题；提出方案后等待确认。',example:true,...meta,files:[],notes:[
      note('design-note-scenario','从一句需求拆成使用场景','## 示例场景\n一位创作者希望在思路卡住时重新看到以前的想法。\n\n## 意图与操作\n意图：获得联想线索。操作：进入梦境，随机遇见旧念头，暂停阅读，然后继续记录。\n\n## 待验证问题\n移动速度是否便于阅读？长短内容能否同时看清？用户能否找到编辑入口？\n\n这些是设计假设和问题，并不是已完成的用户研究。','第一章 · 场景'),
      note('design-note-observation','把体验感受写成观察问题','## 示例观察清单\n- 能否从搭建台拖入一个模块？\n- 双击后能否进入实际内容？\n- 修改一条待办日期后，日历是否显示同一日期？\n\n## 记录方式\n操作步骤 → 实际看到的情况 → 困惑点 → 下一次改进。\n\n这里没有预填通过结论；请在真正试用后补充。','第二章 · 验证')
    ]},
    {id:SHOWCASE_GALLERY_COURSE_IDS[1],title:'项目英语表达 · 示例',subtitle:'用英语解释工作流与边界，参考现有原创题库。',icon:'graduation',color:colors[3],prompt:'优先解释表达意图，再提出可选改写；保留不确定性，不替用户编造效果。',example:true,...meta,files:[],notes:[
      note('writing-note-structure','把项目说明写清楚','## 参考结构\nProblem → Workflow → Current limit → A question for the visitor.\n\n## 示例句式\nA user can save an idea and turn it into a task.\nThe assistant proposes a plan before changing the workspace.\nWe still need to evaluate the result with real users.\n\n可以在英语写作题 Explain a project to a new visitor 中练习，保存的是你自己的草稿；本笔记不会自动填写答案。','第一章 · 项目介绍'),
      note('writing-note-check','核对时间与证据表达','## 示例对照\nWe plan to test the workflow. 表示计划。\nWe tested the workflow. 表示已经做过，必须有对应记录。\n\n## 修改练习\n将“所有人都觉得很好用”改写为一个待验证问题：Which step is hardest for a first-time visitor?\n\n本段为原创表达练习，不是考试标准答案。','第二章 · 表达边界')
    ]}
  ];
  const ideas=[
    ['让念头像窗边光斑','创作卡住时，让旧念头轻轻经过，而不是强迫自己一次读完所有笔记。','学习灵感'],
    ['把“待确认”也放上桌','工作台不仅保存答案，也应该给还没想清楚的问题留一个位置。','备忘'],
    ['一次只邀请一个动作','首次使用时，是否可以先让人放下一块便笺，再慢慢介绍其他工具？','学习灵感'],
    ['会议结束的两分钟','讨论之后，把已经决定的事和还缺信息的事分开写；它们应有不同的下一步。','工作'],
    ['从一张卡片走到日历','把想法转成待办，只在需要安排时间时填日期；日历显示来源，让人知道去哪里修改。','学习灵感'],
    ['颜色也可以讲述用途','同样是卡片，资料、想法与行动能否通过轻微的层次变化更容易辨认？','学习灵感'],
    ['散步之后写下一句','模拟创作提示：不用完整叙述，先留住一个画面、一句听到的话或者一个问题。','生活'],
    ['给未来的自己一条线索','记录时补上一点背景：为什么重要、当时想到什么。几周后重看，仍能接上原来的思路。','备忘'],
    ['一个可逆的尝试','如果一次整理容易撤回，用户也许会更愿意试试新的排列。先观察，不把这句话当作已验证结论。','学习灵感'],
    ['理想的 AI 助手','能够理解我想做什么，说明它准备改变什么；有疑问时保留问题，让我决定是否执行。','学习灵感'],
    ['给初次体验者的项目介绍','This workbench brings ideas, tasks and plans into a space you can arrange yourself. Try saving one idea, turning it into a task, and choosing a date. The assistant can propose changes, but you review them before they are applied.\n\n原创示例原文，可在“英语 → 我的资料”看到同一条记录；不是用户作文或模型答复。','英语'],
    ['礼貌地调整约定',`${TRANSLATION_PROMPTS.find(item=>item.id==='changing-plans').prompt}\n\n参考表达：\n${TRANSLATION_PROMPTS.find(item=>item.id==='changing-plans').reference}\n\n来自应用已有原创练习，仅作参考；等义表达也可成立。`,'英语']
  ];
  const captures=ideas.map(([title,body,category],index)=>({id:PREFIX+'idea-'+(index+1),text:title+' · 示例\n'+body,category,tags:'示例,体验导览'+(category==='英语'?',英语素材':''),source:'平台编写的示例想法，不代表真实用户经历。',example:true,color:colors[index%colors.length],...meta}));
  const task=(suffix,title,date,description,extra={})=>({id:PREFIX+suffix,title,description,date,priority:'normal',category:'个人',done:false,source:'全模块体验导览 · 示例',example:true,spaceId:SHOWCASE_GALLERY_SPACE_ID,color:colors[1],...meta,...extra});
  const tasks=[task('shared-material-task','观察英语素材共享 · 示例',d.day(1),'自定练习计划：编辑收集箱中的“给初次体验者的项目介绍 · 示例”，再到英语“我的资料”查看同一正文；此待办日期也投影到日历。',{captureId:captures[10].id}),task('review-task','模拟回顾 · 示例：整理一次创作提纲',d.day(-1),'仅用于展示生活回顾的时间线；没有真实完成这项活动。可取消完成、编辑或归档，不代表学习成绩。',{done:true,completedAt:d.day(-1)+'T12:00:00.000Z'})];
  const calendar={version:1,events:[
    ['plan','留二十分钟整理灵感',0,'19:00','19:20',false,'练习安排；独立日程，不会自动生成待办。'],
    ['mark','下次小组交流',2,'','',true,'自定示例日期，不是实际会议通知；可尝试修改日期。'],
    ['note','准备展示时说明边界',3,'','',true,'提醒：区分模拟内容、真实记录、已验证结果和待验证内容。']
  ].map(([kind,title,offset,startTime,endTime,allDay,notes],index)=>({id:PREFIX+'calendar-'+index,title:title+' · 示例',kind,startDate:d.day(offset),endDate:d.day(offset),startTime,endTime,allDay,location:'自定练习场景',notes:'示例：'+notes,important:index===1,done:false,color:colors[index+2],...meta}))};
  const timetable={version:1,activeTermId:PREFIX+'term',terms:[{id:PREFIX+'term',title:'本周练习学期 · 示例',campus:'模拟学习安排',weekOne:d.monday,totalWeeks:4,teachingWeeks:4,notes:'示例课表：日期与地点为自定安排，不是学校正式课表。与课程空间同名的条目保持独立，当前不会自动同步课程笔记、改名或日历。',periods:[{id:1,start:'09:00',end:'09:45'},{id:2,start:'09:55',end:'10:40'},{id:3,start:'14:00',end:'14:45'}],entries:[
    {id:PREFIX+'tt-design',title:'交互产品设计 · 示例',teacher:'示例自主学习',location:'模拟：学习室 A',weekday:2,startPeriod:1,endPeriod:2,weeks:[1,2,3,4],color:colors[0],archived:false},
    {id:PREFIX+'tt-writing',title:'项目英语表达 · 示例',teacher:'示例自主学习',location:'模拟：学习室 B',weekday:4,startPeriod:3,endPeriod:3,weeks:[1,2,3,4],color:colors[3],archived:false},
    {id:PREFIX+'tt-review',title:'创作回顾与分享 · 示例',teacher:'示例自主学习',location:'模拟：线上交流',weekday:6,startPeriod:1,endPeriod:1,weeks:[1,3],color:colors[2],archived:false}
  ]}]};
  const fitness={version:1,entries:[['散步',-3,25,1.6],['拉伸',-2,12,null],['散步',-1,30,2.1],['轻松活动',0,18,null]].map(([activity,offset,minutes,distanceKm],index)=>({id:PREFIX+'fitness-'+index,spaceId:SHOWCASE_GALLERY_FITNESS_ID,date:d.day(offset),activity:activity+' · 模拟示例',minutes,distanceKm,caloriesKcal:null,note:'模拟数值，仅用于体验图表和编辑，不是实际运动、设备测量或健康建议。未估算热量。',source:'manual',color:colors[index],...meta}))};
  const block=(kind,title,description,config,index)=>({id:SHOWCASE_GALLERY_BLOCK_IDS[index],kind,title:title+' · 示例',description:'示例：'+description,color:colors[index],config,data:{},...meta});
  const customBlocks={version:1,items:[
    block('note','会议记录便笺','可编辑的假设场景，不代表已举行会议。',{text:'主题：怎样让新用户找到第一块积木。\n讨论问题：入口是否清楚？空白工作台需要什么提示？\n待确认：先观察一位体验者，再决定下一步。\n\n这是一份可编辑的示例草稿，未开展真实会议。'},0),
    block('checklist','出门前检查','手工维护的清单，不同步全局待办。',{items:[{id:PREFIX+'check-notes',label:'带上需要讨论的笔记',done:false},{id:PREFIX+'check-power',label:'检查设备电量',done:false},{id:PREFIX+'check-time',label:'确认实际时间与地点',done:false}]},1),
    block('links','常用资料入口','保存公开网页入口；不会自动抓取正文，链接内容以打开时为准。',{items:[{id:PREFIX+'link-mdn',label:'MDN Web 文档 · 参考入口',url:'https://developer.mozilla.org/zh-CN/'},{id:PREFIX+'link-contest',label:'传智杯赛道页面 · 以官方通知为准',url:'https://www.boxuegu.com/matchTrack/detail/?id=10039'}]},2),
    block('progress','内容整理进度','模拟 2/5 数值，仅展示进度样式；手动维护，不代表真实完成或业务汇总。',{value:2,target:5,unit:'篇（模拟）'},3),
    block('countdown','下一次创作回顾','加入后七天的自定练习日期；不是官方截止，也不自动创建日历事项。',{date:d.day(7)},4),
    block('table','阅读与表达清单','可编辑记录表，不自动同步课程或英语学习记录。',{columns:[{id:PREFIX+'col-topic',label:'主题'},{id:PREFIX+'col-next',label:'下一步'},{id:PREFIX+'col-state',label:'状态'}],rows:[{id:PREFIX+'row-reading',cells:['交互产品设计笔记','补一个待验证问题','待体验']},{id:PREFIX+'row-writing',cells:['项目英语表达','写一段自己的介绍','待体验']}]},5),
    {...createPresetInput('calculator',now),id:SHOWCASE_GALLERY_BLOCK_IDS[6],title:'随手计算器 · 示例',description:'示例：复用内置计算器源码，点击“运行”才启动。只能访问本方块数据，不会读取账号、其他资料或访问网络。可计算 12 + 28，再停止。',...meta}
  ]};
  const raw={schema:1,mode:'personal',profile:{name:'',major:'',provider:'deepseek'},courses,spaces:[root,fitnessSpace],tasks,captures,calendar,timetable,fitness,customBlocks,english:{},updatedAt:d.stamp};
  return validateBackup({format:'lumi-backup',version:1,exportedAt:d.stamp,state:raw,files:[]}).state;
}

function idsOf(value){
  const ids=new Set(),seen=new Set();
  const visit=row=>{if(!row||typeof row!=='object'||seen.has(row))return;seen.add(row);if(typeof row.id==='string')ids.add(row.id);Object.values(row).forEach(visit);};visit(value);return ids;
}
function addCards(next,sample){
  const canvas=next.canvas?clone(next.canvas):{cards:[],view:{x:0,y:0,zoom:1},snap:true};
  if(!Array.isArray(canvas.cards))fail('画布配置无效，请先修复后再加入示例。');
  const known=new Set(canvas.cards.map(card=>card.id));
  const additions=[...WORKBENCH_MODULES,...sample.spaces,...sample.customBlocks.items].filter(row=>!known.has(row.id));
  const bottom=canvas.cards.reduce((max,row)=>Number.isFinite(row.y)&&Number.isFinite(row.h)?Math.max(max,row.y+row.h):max,0)+40;
  if(bottom+Math.ceil(additions.length/3)*320>100000)fail('画布下方没有足够空间，请先调整布局后再加入示例。');
  additions.forEach((row,index)=>canvas.cards.push({id:row.id,x:40+(index%3)*380,y:bottom+Math.floor(index/3)*320,w:340,h:280,color:row.color}));
  next.canvas=canvas;
}

/** Read-only plan. Existing records retain their exact content, order and geometry. */
export function planShowcaseGallery(state,{now=new Date()}={}){
  if(!state||typeof state!=='object'||Array.isArray(state))fail('工作台数据无效。');
  if(hasShowcaseGallery(state))return freeze({nextState:clone(state),summary:Object.fromEntries(Object.keys(COUNTS).map(key=>[key,0])),alreadyInstalled:true,rootSpaceId:SHOWCASE_GALLERY_SPACE_ID});
  const sample=galleryState(now),reserved=idsOf(sample),existing=idsOf(state);
  // Do not let append fallbacks turn malformed/null existing collections into empty ones.
  validateBackup({format:'lumi-backup',version:1,exportedAt:now.toISOString(),state,files:[]});
  if([...reserved].some(id=>existing.has(id)))fail('示例编号已被占用或存在部分示例，未覆盖任何内容；请先检查已有记录。');
  // A removed legacy guide is not permission to re-create its edited/deleted children.
  const legacyPresent=hasShowcaseExamples(state)||[...existing].some(id=>id.startsWith('showcase-dev012-')||id.startsWith('block:showcase-dev012-'));
  const legacy=legacyPresent?null:planShowcaseExamples(state,{now});
  const next=clone(legacy?.nextState||state);
  for(const key of ['courses','spaces','tasks','captures']){if(next[key]!==undefined&&!Array.isArray(next[key]))fail('工作台记录格式无效。');next[key]=[...(next[key]||[]),...sample[key]];}
  next.calendar={...(next.calendar||{version:1,events:[]}),events:[...(next.calendar?.events||[]),...sample.calendar.events]};
  next.fitness={...(next.fitness||{version:1,entries:[]}),entries:[...(next.fitness?.entries||[]),...sample.fitness.entries]};
  next.timetable={...(next.timetable||{version:1,activeTermId:'',terms:[]}),activeTermId:next.timetable?.activeTermId||sample.timetable.activeTermId,terms:[...(next.timetable?.terms||[]),...sample.timetable.terms]};
  next.customBlocks={...(next.customBlocks||{version:1,items:[]}),items:[...(next.customBlocks?.items||[]),...sample.customBlocks.items]};
  const workbench=getWorkbench(next);workbench.modules.forEach(module=>{module.enabled=true;});workbench.onboardingComplete=true;next.workbench=validateWorkbench(workbench);
  addCards(next,sample);next.updatedAt=now.toISOString();
  validateBackup({format:'lumi-backup',version:1,exportedAt:next.updatedAt,state:next,files:[]});
  const summary=Object.fromEntries(Object.entries(COUNTS).map(([key,count])=>[key,count+(legacy?.summary[key]||0)]));
  return freeze({nextState:next,summary,alreadyInstalled:false,rootSpaceId:SHOWCASE_GALLERY_SPACE_ID});
}

/** One synchronous save, with every changed domain restored on failure. */
export function installShowcaseGallery(ctx,options={}){
  if(!ctx?.state||typeof ctx.save!=='function')fail('示例保存入口无效。');
  const plan=planShowcaseGallery(ctx.state,options);if(plan.alreadyInstalled)return plan;
  const state=ctx.state,previous=new Map(DOMAIN_KEYS.map(key=>[key,{exists:Object.hasOwn(state,key),value:state[key]}]));
  try{
    for(const key of DOMAIN_KEYS)if(Object.hasOwn(plan.nextState,key))state[key]=clone(plan.nextState[key]);
    const result=ctx.save();if(result&&typeof result.then==='function')fail('示例导入需要同步保存入口。');
  }catch(error){for(const [key,before]of previous)if(before.exists)state[key]=before.value;else delete state[key];throw error;}
  return plan;
}
