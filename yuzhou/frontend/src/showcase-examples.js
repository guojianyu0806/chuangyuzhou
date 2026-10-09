// Add a clearly labelled, connected rehearsal to the current workspace.
// This is authored sample content, never an AI response or a record of real work.
import {validateBackup} from './backup.js';
import {getWorkbench,validateWorkbench} from './workbench-model.js';
import {validateCompetitions} from './competitions-model.js';
import {validateLedger,localDate} from './ledger-model.js';
import {validateCustomBlocks} from './custom-blocks-model.js';

const PREFIX='showcase-dev012-';
export const SHOWCASE_SPACE_ID=PREFIX+'project';
export const SHOWCASE_COMPETITION_ID=PREFIX+'competition';
export const SHOWCASE_LEDGER_ID=PREFIX+'budget';
export const SHOWCASE_BLOCK_IDS=Object.freeze(['block:'+PREFIX+'narration','block:'+PREFIX+'observations']);
const NEEDED_MODULES=['tasks','calendar','competitions','ledger','inbox'];
const DOMAIN_KEYS=['spaces','tasks','captures','competitions','ledger','customBlocks','workbench','canvas','updatedAt'];
const clone=value=>structuredClone(value);
const fail=message=>{throw new Error(message);};
const countSummary=Object.freeze({spaces:1,notes:2,tasks:3,captures:1,competitions:1,milestones:2,competitionTasks:2,ledgerProjects:1,ledgerEntries:2,blocks:2});
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};

export function hasShowcaseExamples(state){
  return !!state?.spaces?.some(space=>space.id===SHOWCASE_SPACE_ID&&space.example===true);
}

function dates(now){
  if(!(now instanceof Date)||!Number.isFinite(now.getTime()))fail('示例日期无效。');
  const day=offset=>{const value=new Date(now.getFullYear(),now.getMonth(),now.getDate(),12);value.setDate(value.getDate()+offset);return localDate(value);};
  return {stamp:now.toISOString(),today:day(0),next:day(1),review:day(3),rehearsal:day(7)};
}

function sampleState(now){
  const d=dates(now),meta={archived:false,createdAt:d.stamp,updatedAt:d.stamp};
  const note=(suffix,title,content)=>({id:PREFIX+suffix,title,content,chapter:'展示准备',source:'平台编写的示例材料，用于演示关联流程；非真实使用记录。',example:true,revisions:[],...meta});
  const captureId=PREFIX+'idea';
  const space={id:SHOWCASE_SPACE_ID,title:'工作台参赛筹备 · 示例',description:'以工作台项目的展示准备为场景：资料、空间待办、比赛节点与预算。内容为可编辑示例，日期是内部预演计划，不是官方截止时间。',type:'project',icon:'flag',color:'#AE88FF',example:true,...meta,files:[],notes:[
    note('brief','项目说明与演示路线 · 示例',`# 工作台参赛筹备\n\n这是一套根据常见参赛准备流程编写的示例，供你直接操作和修改。它不代表已经报名、已完成任务、真实支出或官方要求。\n\n## 演示目标\n说明用户怎样组合模块，以及 AI 怎样提出方案并在确认后执行。\n\n## 建议路线\n1. 从搭建台打开本空间，查看笔记和下一步行动。\n2. 在本空间完成一项待办，再到全局待办和日历查看同一记录。\n3. 到比赛模块修改内部预演节点，回日历查看日期变化。\n4. 到记账查看独立示例预算；它不计入日常总账。\n5. 打开“演示讲解提纲”和“预演观察表”，按实际试用继续编辑。\n\n## 自定内部计划\n${d.next} 整理演示路线；${d.review} 核对模块关联；${d.rehearsal} 完成一次内部预演。以上日期仅作演示，不是官方截止。`),
    note('relations','哪些内容会联动 · 示例',`# 关联核对说明\n\n## 已共享的记录\n- 空间的三项待办与全局待办读取同一记录；修改标题、日期或完成状态后，应在两处一致显示。\n- 日历关联视图读取带日期的待办、比赛节点和比赛准备事项，不另外复制一条日历记录；编辑时回到来源。\n- 比赛准备事项属于本比赛，完成比例从这些事项计算，不会自动成为全局待办。\n- 示例账目属于“参赛展示预算 · 示例”，独立核算，不计入总账。\n\n## 有意保持独立\n- “演示讲解提纲”和“预演观察表”是手动维护的自定义方块，不自动读取业务任务或完成进度。\n- 收集箱保留一个原始想法，其中一项空间待办保存了来源编号；待办正文是转写副本，修改碎片不会自动重写待办。\n- 本空间没有放入伪造附件、模型回执、完成记录或真实消费凭据。\n\n请根据实际操作填写观察表；预设内容不等于测试已经通过。`)
  ]};
  const task=(suffix,title,date,description,extra={})=>({id:PREFIX+suffix,title,description,date,priority:'normal',category:'个人',done:false,source:'工作台参赛筹备 · 示例',example:true,spaceId:SHOWCASE_SPACE_ID,color:'#63E6DC',...meta,...extra});
  const competition={id:SHOWCASE_COMPETITION_ID,title:'工作台项目展示准备 · 示例',organizer:'',category:'内部演示练习',url:'',team:'示例：由项目作者准备演示，具体分工按实际情况填写。',requirements:'示例练习目标：能解释项目用途、操作一条关联流程，并保留尚未验证的限制。此处不是赛事官方通知。',notes:`本条为展示流程示例，不代表报名或提交事实。两个节点均为自定内部计划：${d.review} 核对关联、${d.rehearsal} 内部预演；并非官方截止时间。准备事项独立于全局待办，但会投影到日历。`,status:'preparing',color:'#D8F649',...meta};
  const milestone=(suffix,title,date)=>({id:PREFIX+suffix,competitionId:SHOWCASE_COMPETITION_ID,title,date,time:'',done:false,...meta});
  const competitionTask=(suffix,title,date,notes)=>({id:PREFIX+suffix,competitionId:SHOWCASE_COMPETITION_ID,title,date,notes,done:false,...meta});
  const ledgerProject={id:SHOWCASE_LEDGER_ID,title:'参赛展示预算 · 示例',color:'#FFBC7C',includeInTotal:false,...meta};
  const ledgerEntry=(suffix,amountCents,category,note)=>({id:PREFIX+suffix,type:'expense',amountCents,date:d.today,category,projectId:SHOWCASE_LEDGER_ID,note,example:true,...meta});
  const block=(id,kind,title,description,color,config)=>({id,kind,title,description,color,config,data:{},...meta});
  const value={schema:1,mode:'personal',profile:{name:'',major:'',provider:'deepseek'},courses:[],english:{},updatedAt:d.stamp,spaces:[space],
    tasks:[
      task('route-task','整理三分钟演示路线 · 示例',d.next,'自定示例计划：从搭建、记录到 AI 确认执行，写下讲解顺序。此待办同时出现在本空间、全局待办和日历。',{priority:'high'}),
      task('relation-task','核对一次空间待办联动 · 示例',d.review,'自定示例计划：修改本条日期或完成状态，检查空间、全局待办与日历显示同一结果；实际检查后再标记完成。'),
      task('idea-task','把预演想法整理成观察问题 · 示例',d.rehearsal,'示例来源：观察新用户能否找到搭建入口，能否理解 AI 方案需要确认。将观察问题写入预演观察表；这条记录不会自动填表。',{captureId})
    ],captures:[{id:captureId,text:'预演观察想法 · 示例\n请一位体验者从搭建台选择模块，再查看一项空间待办如何出现在日历。记录卡住的步骤与原话，暂不预设成功率。此内容为示例设计，不代表已经开展真人试用。',category:'学习灵感',tags:'示例,参赛展示,体验观察',source:'平台编写的示例想法',example:true,color:'#FF9CCE',...meta}],
    competitions:{version:1,items:[competition],milestones:[milestone('review-milestone','自定示例：模块关联核对',d.review),milestone('rehearsal-milestone','自定示例：内部演示预演',d.rehearsal)],tasks:[competitionTask('story-task','编写讲解脚本 · 示例',d.next,'未完成的示例任务。先解释使用场景，再演示实际操作。'),competitionTask('recording-task','准备演示录制清单 · 示例',d.review,'未完成的示例任务。核对入口、画面、演示资料与尚未验证的限制，不视为已经录制。')]},
    ledger:{version:1,currency:'CNY',projects:[ledgerProject],entries:[ledgerEntry('printing-entry',1200,'打印','模拟支出：演示流程草稿打印 12 元，仅用于核对独立账本汇总，没有真实消费凭据。'),ledgerEntry('material-entry',2800,'物料','模拟支出：展示说明卡 28 元，仅用于演示，未实际付款。')]},
    customBlocks:{version:1,items:[block(SHOWCASE_BLOCK_IDS[0],'note','演示讲解提纲 · 示例','可编辑的讲解草稿，与待办进度独立维护。','#AE88FF',{text:'1. 使用场景：为什么需要自己搭建工作台。\n2. 搭建：选择模块，摆放方块。\n3. 关联：空间待办 → 全局待办 → 日历。\n4. AI：描述意图 → 审核方案 → 确认执行。\n5. 限制：真实模型效果需另行试测；自定义方块不自动同步业务进度。\n\n以上为示例草稿，按实际演示修改。'}),block(SHOWCASE_BLOCK_IDS[1],'table','预演观察表 · 示例','手动记录实际体验，初始结果均为待观察；不会自动同步业务状态。','#8EDBE8',{columns:[{id:'step',label:'操作步骤'},{id:'expected',label:'观察问题'},{id:'result',label:'实际结果'}],rows:[{id:'placement',cells:['选择并摆放方块','能否找到入口并理解落点？','待观察']},{id:'relations',cells:['修改空间待办','全局待办与日历是否一致？','待观察']},{id:'ai-review',cells:['检查 AI 方案','是否理解确认前不会写入？','待观察']}]})]}
  };
  return validateBackup({format:'lumi-backup',version:1,exportedAt:d.stamp,state:value,files:[]}).state;
}

function ownedIds(sample){
  return new Set([...sample.spaces,...sample.spaces.flatMap(space=>space.notes),...sample.tasks,...sample.captures,...sample.competitions.items,...sample.competitions.milestones,...sample.competitions.tasks,...sample.ledger.projects,...sample.ledger.entries,...sample.customBlocks.items].map(row=>row.id));
}
function conflictIds(state,reserved){
  const found=new Set(),seen=new Set();
  const visit=value=>{if(!value||typeof value!=='object'||seen.has(value))return;seen.add(value);if(typeof value.id==='string'&&reserved.has(value.id))found.add(value.id);for(const child of Object.values(value))visit(child);};
  visit(state);return [...found];
}

// Place new sample cards below existing geometry; never normalize/move old cards.
function addCanvasCards(next,sample){
  const previous=next.canvas;
  const canvas=previous?clone(previous):{cards:[],view:{x:0,y:0,zoom:1},snap:true};
  if(!Array.isArray(canvas.cards))fail('画布配置无效，请先修复画布后添加示例。');
  const known=new Set(canvas.cards.map(card=>card.id));
  const definitions=[...NEEDED_MODULES.map(id=>({id,color:next.workbench.modules.find(module=>module.id===id)?.id==='competitions'?'#D8F649':'#63E6DC'})),{id:SHOWCASE_SPACE_ID,color:sample.spaces[0].color},...sample.customBlocks.items];
  const additions=definitions.filter(row=>!known.has(row.id));
  let bottom=canvas.cards.reduce((max,card)=>Number.isFinite(card.y)&&Number.isFinite(card.h)?Math.max(max,card.y+card.h):max,0)+40;
  if(bottom+Math.ceil(additions.length/3)*320>100000)fail('画布下方没有足够空间，请先调整布局后再添加示例。');
  additions.forEach((row,index)=>canvas.cards.push({id:row.id,x:40+(index%3)*380,y:bottom+Math.floor(index/3)*320,w:340,h:280,color:row.color}));
  next.canvas=canvas;
}

/** Read-only, detached installation plan. No user records or dates are rewritten. */
export function planShowcaseExamples(state,{now=new Date()}={}){
  if(!state||typeof state!=='object'||Array.isArray(state))fail('工作台数据无效。');
  if(hasShowcaseExamples(state))return freeze({nextState:clone(state),summary:Object.fromEntries(Object.keys(countSummary).map(key=>[key,0])),alreadyInstalled:true,rootSpaceId:SHOWCASE_SPACE_ID});
  const sample=sampleState(now),conflicts=conflictIds(state,ownedIds(sample));
  if(conflicts.length)fail('示例编号已被占用或已有部分示例，未覆盖任何内容；请先检查已有记录。');
  const next=clone(state);
  for(const key of ['spaces','tasks','captures']){if(next[key]!==undefined&&!Array.isArray(next[key]))fail('工作台记录格式无效。');next[key]=[...(next[key]||[]),...sample[key]];}
  const competitions=next.competitions||{version:1,items:[],milestones:[],tasks:[]};
  next.competitions={...competitions,...Object.fromEntries(['items','milestones','tasks'].map(key=>[key,[...competitions[key],...sample.competitions[key]]]))};
  validateCompetitions(next.competitions);
  const ledger=next.ledger||{version:1,currency:'CNY',projects:[],entries:[]};
  next.ledger={...ledger,projects:[...ledger.projects,...sample.ledger.projects],entries:[...ledger.entries,...sample.ledger.entries]};
  validateLedger(next.ledger);
  next.customBlocks={...(next.customBlocks||{version:1,items:[]}),items:[...(next.customBlocks?.items||[]),...sample.customBlocks.items]};
  validateCustomBlocks(next.customBlocks);
  const workbench=getWorkbench(state);for(const module of workbench.modules)if(NEEDED_MODULES.includes(module.id))module.enabled=true;
  workbench.onboardingComplete=true;next.workbench=validateWorkbench(workbench);
  addCanvasCards(next,sample);next.updatedAt=now.toISOString();
  // Validate transport/backup compatibility, but retain existing records verbatim.
  validateBackup({format:'lumi-backup',version:1,exportedAt:next.updatedAt,state:next,files:[]});
  return freeze({nextState:next,summary:{...countSummary},alreadyInstalled:false,rootSpaceId:SHOWCASE_SPACE_ID});
}

/** Persist exactly once using the app's synchronous local-storage/outbox save. */
export function installShowcaseExamples(ctx,options={}){
  if(!ctx?.state||typeof ctx.save!=='function')fail('示例保存入口无效。');
  const plan=planShowcaseExamples(ctx.state,options);if(plan.alreadyInstalled)return plan;
  const state=ctx.state,previous=new Map(DOMAIN_KEYS.map(key=>[key,{exists:Object.hasOwn(state,key),value:state[key]}]));
  try{
    for(const key of DOMAIN_KEYS)if(Object.hasOwn(plan.nextState,key))state[key]=clone(plan.nextState[key]);
    const result=ctx.save();
    if(result&&typeof result.then==='function')fail('示例导入需要同步保存入口。');
  }catch(error){for(const [key,before]of previous)if(before.exists)state[key]=before.value;else delete state[key];throw error;}
  return plan;
}
