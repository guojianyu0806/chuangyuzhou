// Explicit, reviewed conversion of the shipped starter records. Never runs at login.
// Original provenance flags and note revisions remain; no achievement is fabricated.
import {validateBackup} from './backup.js';

const domains=['spaces','courses','captures','tasks','calendar','timetable','fitness','ledger','competitions','customBlocks'];
const owned=id=>/^(block:)?showcase-dev(012|019)-/.test(id||'');
const extraSpaces=new Set(['e7fbf09b-e914-4b0d-8c92-5fbc5cb85f49','c4c2f939-2e79-421e-acb0-e6676ce48c96']);
const marker=/示例|演示|模拟/;
const origin='平台起始资料，现作为可编辑的计划与参考；完成情况按实际使用记录。';
const titles={
  '全模块体验导览':'工作台使用手册','演示讲解提纲':'项目讲解提纲','预演观察表':'体验观察表',
  '本周练习学期':'自主学习计划','内容整理进度':'内容整理进度','工作台项目展示准备':'工作台参赛准备',
};
function clean(text){
  return text.replace(/\s*·\s*(示例|演示)/g,'').replace(/（演示灵感）/g,'')
    .replace(/【(?:录屏演示样例，可自由编辑|演示内容，待拍摄|演示内容|原创演示分镜，未实际拍摄)】/g,'')
    .replaceAll('演示计划：','计划：').replaceAll('演示关联：','关联：').replaceAll('演示灵感','创作灵感')
    .replaceAll('示例观察清单','观察清单').replaceAll('示例场景','使用场景').replaceAll('示例句式','参考句式').replaceAll('示例对照','表达对照')
    .replaceAll('模拟创作提示：','创作提示：').replaceAll('原创示例原文','原创参考原文')
    .replaceAll('演示路线','操作路线').replaceAll('演示讲解提纲','项目讲解提纲').replaceAll('演示录制','视频录制')
    .replaceAll('演示资料','项目资料').replaceAll('演示空间','项目空间').replaceAll('演示实际操作','展示实际操作')
    .replaceAll('内部演示预演','内部预演').replaceAll('自定示例：','内部计划：')
    .replaceAll('自定示例计划：','计划：').replaceAll('未完成的示例任务。','待完成。')
    .replaceAll('示例来源：','想法来源：').replaceAll('录屏演示样例','创作草稿')
    .replaceAll('原创演示素材','原创创作素材').replaceAll('原创演示草稿','原创创作草稿')
    .replaceAll('原创讨论问题，演示用','原创讨论问题').replaceAll('示例设计','设计设想')
    .replaceAll('预演观察表','体验观察表').replaceAll('示例自主学习','自主学习')
    .replaceAll('模拟：学习室 A','地点待定').replaceAll('模拟：学习室 B','地点待定').replaceAll('模拟：线上交流','线上交流')
    .replaceAll('模拟学习安排','自主安排').replaceAll('示例需求','需求草稿').replaceAll('示例草稿','讨论草稿')
    .replaceAll('示例：','').replaceAll('演示','展示').replaceAll('示例','参考').trim();
}
const noteBodies={
  'showcase-dev012-brief':['项目说明与操作路线','# 工作台参赛筹备\n\n目标：说明用户怎样按需组合模块，以及 AI 如何提出方案、经审核确认后执行。\n\n## 准备顺序\n1. 整理使用场景与项目定位。\n2. 核对空间待办、全局待办与日历关联。\n3. 整理开发过程中的关键对话、修订与 Git 提交。\n4. 编写视频脚本与技术文档。\n5. 按提交清单逐项验收。\n\n内部日期是个人准备计划，官方期限以赛事通知为准。'],
  'showcase-dev012-relations':['哪些内容会联动','# 关联说明\n\n- 空间待办与全局待办是同一条记录。\n- 带日期的待办、比赛节点和准备事项会显示在日历，修改时回到来源。\n- 比赛准备事项单独计算完成比例。\n- 讲解提纲、观察表和其他自定义方块由自己维护，不自动同步业务进度。\n- 将灵感转成待办后，仍保留来源；修改灵感不会自动重写待办。'],
  'showcase-dev019-guide-start':['从这里开始使用工作台','# 工作台使用手册\n\n## 收集与行动\n把念头放入灵感收集箱；需要行动时转成待办，填入日期后可在日历查看。\n\n## 资料与项目\n课程适合分章整理学习笔记；空间适合围绕项目集中存放笔记、文件与待办。\n\n## 自由搭建\n在搭建台拖入模块，双击打开内容；缩放和平移只改变观察视角。\n\n## AI 伙伴\n说清目标、范围与保留项，审核方案后确认。小工具保存后仍需手动运行。\n\n## 个人记录\n账目、运动与完成状态应在实际发生后填写。自主学习安排与学校课表分别维护。'],
  'showcase-dev019-guide-relations':['内容关联与独立维护','# 共享的内容\n\n- 收集箱中的英语资料，也会显示在英语“我的资料”。\n- 空间待办与全局待办共用记录；日期同步投影到日历。\n- 生活回顾读取实际完成的待办，运动图表按所属空间汇总。\n\n# 独立维护的内容\n\n- 课表条目与课程空间分别维护。\n- 日历原生日程与关联待办分别保存。\n- 自定义清单、进度与表格不会自动更新待办、账目或学习记录。'],
  'showcase-dev019-guide-ai':['和 AI 伙伴一起搭建','# 如何描述需求\n\n先说正在处理的事情，再说明希望如何调整、哪些内容需要保留。\n\n## 整理资料\n请阅读当前空间，归纳关键事项与尚未确定的问题，先给建议。\n\n## 调整布局\n请把课程、英语和灵感排到便于访问的位置，保留其他模块和记录，先让我审核。\n\n## 创建方块\n请创建会议准备清单，包含议题、需要阅读的资料和待确认事项，不预填完成状态。\n\n## 创建小工具\n先明确输入、结果与需要保存的数据，再生成受控小程序。审核源码、确认保存后手动运行。\n\n以上是可选的提问方式，发送前按当前需求修改。'],
  'showcase-dev019-guide-english':['英语素材与表达练习','# 学习路线\n\n1. 在“英语 → 我的资料”阅读收藏的原文。\n2. 在写作练习中介绍一个项目：问题、流程、当前限制和希望获得的反馈。\n3. 在翻译练习中尝试自己的译文，再对照参考。\n4. 按基础、进阶与挑战选择阅读材料。\n\n## 表达参考\nThis workbench lets people arrange tools around their own routines. A user can save an idea, turn it into a task, and view its planned date in the calendar. The AI assistant proposes changes for review before they are applied.\n\n保存自己的草稿后再回看改进，不自动生成成绩或学习时长。'],
  'showcase-dev019-fitness-guide':['记录每一次活动','# 活动记录\n\n实际运动后填写日期、类型和时长；里程、热量不知道时可留空。\n\n日、周、月视图用于观察自己的节奏，不替代健康建议。图表只汇总当前空间中未归档的记录。'],
};
export function planDailyWorkspace(state,{now=new Date()}={}){
  const next=structuredClone(state),changes=[],stamp=now.toISOString();
  const touch=(row,fn)=>{const before=JSON.stringify(row);fn(row);if(JSON.stringify(row)!==before){row.updatedAt=stamp;changes.push(row.title||row.activity||row.id);}};
  const tidy=row=>{for(const key of ['title','subtitle','description','text','content','notes','note','requirements','team','category','chapter','teacher','location','campus'])if(typeof row[key]==='string')row[key]=clean(row[key]);if(titles[row.title])row.title=titles[row.title];if(typeof row.tags==='string')row.tags=row.tags.split(/[,，]/).filter(tag=>!['示例','演示','体验导览'].includes(tag.trim())).join(',');};
  for(const space of next.spaces||[])if(owned(space.id)||extraSpaces.has(space.id)){
    touch(space,()=>{tidy(space);if(space.id==='showcase-dev019-guide')space.description='记录常用操作、内容关联和 AI 协作方法。';if(space.id==='showcase-dev019-fitness')space.description='记录实际活动，观察自己的运动节奏。';if(space.id==='showcase-dev012-project')space.description='集中准备项目说明、开发证据、提交材料与下一步行动。';if(extraSpaces.has(space.id))space.description=space.id.startsWith('e7fb')?'整理读书会的活动流程、讨论问题与准备事项。时间、地点和分工待确认。':'从一句灵感到一分钟短片，集中整理分镜、旁白和拍摄计划。';});
  }
  for(const course of next.courses||[])if(owned(course.id))touch(course,()=>tidy(course));
  for(const parent of [...(next.spaces||[]),...(next.courses||[])])if(owned(parent.id)||extraSpaces.has(parent.id))for(const note of parent.notes||[]){
    if(!marker.test(JSON.stringify([note.title,note.content,note.source])))continue;
    const revision={title:note.title,content:note.content,chapter:note.chapter||'',source:note.source||'',updatedAt:note.updatedAt||'',savedAt:stamp,example:note.example===true};
    touch(note,()=>{tidy(note);if(noteBodies[note.id]){[note.title,note.content]=noteBodies[note.id];}note.source=origin;note.revisions=[...(note.revisions||[]),revision];});
  }
  for(const row of next.tasks||[])if(owned(row.id)||extraSpaces.has(row.spaceId))touch(row,()=>{tidy(row);if(typeof row.source==='string')row.source=clean(row.source);if(row.id==='showcase-dev019-review-task'){row.archived=true;row.title='历史占位：创作提纲';row.description='起始资料中的占位完成记录，未实际发生，已退出日常统计。';}});
  for(const row of next.captures||[])if(owned(row.id)||row.text?.includes('（演示灵感）'))touch(row,()=>{tidy(row);row.source=origin;});
  for(const row of next.calendar?.events||[])if(owned(row.id))touch(row,()=>{tidy(row);row.location='';row.notes='个人计划，按实际安排调整。';if(row.id==='showcase-dev019-calendar-2')row.title='核对项目说明与证据';});
  for(const term of next.timetable?.terms||[])if(owned(term.id))touch(term,()=>{tidy(term);term.notes='自主学习安排，并非学校课表；时间与地点可按实际情况调整。';for(const row of term.entries||[])if(owned(row.id))tidy(row);});
  for(const row of next.fitness?.entries||[])if(owned(row.id))touch(row,()=>{row.archived=true;row.note='起始资料中的占位数值，未实际发生，已退出运动统计。';row.activity=row.activity.replace(/\s*·\s*模拟示例/,'');});
  for(const row of next.ledger?.entries||[])if(owned(row.id))touch(row,()=>{row.archived=true;row.note='起始资料中的占位金额，未实际支付，已退出账目统计。';});
  for(const row of next.ledger?.projects||[])if(owned(row.id))touch(row,()=>{row.title='参赛筹备';});
  for(const key of ['items','milestones','tasks'])for(const row of next.competitions?.[key]||[])if(owned(row.id))touch(row,()=>{tidy(row);if(key==='items'){row.category='个人项目';row.team='';row.requirements='准备代码仓库、开发过程、复现指南、视频与技术文档。';row.notes='个人准备计划，报名与官方期限需单独核实。';}});
  for(const row of next.customBlocks?.items||[])if(owned(row.id))touch(row,()=>{
    const wasMarked=marker.test(row.title+' '+row.description);tidy(row);
    if(wasMarked){
      const descriptions={note:'保留想法、讨论要点和下一步。',checklist:'按实际准备情况逐项勾选。',links:'常用参考资料，点击打开原网页。',progress:'按实际整理数量更新进度。',countdown:'个人安排，日期可随时调整。',table:'手动记录事项与下一步。',miniapp:'手动启动计算工具，输入与结果仅保存在本方块。'};
      row.description=descriptions[row.kind]||row.description;
      if(typeof row.config?.text==='string')row.config.text=clean(row.config.text).replace(/以上为.*草稿，按实际.*修改。/g,'按实际准备情况继续完善。');
      if(row.id==='block:showcase-dev012-narration')row.config.text='1. 使用场景：为什么需要自己搭建工作台。\n2. 搭建：选择模块，摆放方块。\n3. 关联：空间待办 → 全局待办 → 日历。\n4. AI：描述意图 → 审核方案 → 确认执行。\n5. 证据：说明已验证流程与尚未验证的限制。';
      if(row.id==='block:showcase-dev019-progress'&&row.config.unit==='篇（模拟）'){row.config.value=0;row.config.unit='篇';}
    }
  });
  if(changes.length){next.updatedAt=stamp;validateBackup({format:'lumi-backup',version:1,exportedAt:stamp,state:next,files:[]});}
  return {nextState:next,changes,base:JSON.stringify(domains.map(key=>state[key]))};
}
export function applyDailyWorkspace(ctx,plan){
  if(JSON.stringify(domains.map(key=>ctx.state[key]))!==plan.base)throw new Error('内容已变化，请重新预览整理。');
  const before=new Map([...domains,'updatedAt'].map(key=>[key,{exists:Object.hasOwn(ctx.state,key),value:ctx.state[key]}]));
  try{for(const key of domains)if(Object.hasOwn(plan.nextState,key))ctx.state[key]=structuredClone(plan.nextState[key]);ctx.save();}
  catch(error){for(const [key,old]of before)if(old.exists)ctx.state[key]=old.value;else delete ctx.state[key];throw error;}
  const after=JSON.stringify(domains.map(key=>ctx.state[key]));
  return ()=>{if(JSON.stringify(domains.map(key=>ctx.state[key]))!==after)throw new Error('整理后已有新修改，未覆盖当前内容。');const current=new Map([...domains,'updatedAt'].map(key=>[key,{exists:Object.hasOwn(ctx.state,key),value:ctx.state[key]}]));try{for(const [key,old]of before)if(old.exists)ctx.state[key]=old.value;else delete ctx.state[key];ctx.save();}catch(error){for(const [key,old]of current)if(old.exists)ctx.state[key]=old.value;else delete ctx.state[key];throw error;}};
}
