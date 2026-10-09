// Whitelisted study/settings mutations. The action engine supplies an isolated
// workspace clone and commits it only after the complete reviewed plan passes.
import {validateCalendar} from './calendar-model.js';
import {validateTimetable} from './timetable-model.js';
import {isValidDate} from './ledger-model.js';
import {WRITING_PROMPTS,TRANSLATION_PROMPTS} from './english-content.js';

const fail = message => { throw new Error(message); };
const clone = value => structuredClone(value);
// Backups normalize property order. Compare structure, while still retaining
// every meaningful field so subsequent user edits block a destructive undo.
const equal = (a,b) => {
  if(a===b)return true;
  if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
  const first=Object.keys(a).sort(),second=Object.keys(b).sort();
  return first.length===second.length&&first.every((key,index)=>key===second[index]&&equal(a[key],b[key]));
};
const FORBIDDEN = new Set(['__proto__','constructor','prototype']);
const PRACTICES = ['reading','listening','writing','translation','vocabulary'];
const DRAFTS = ['writing','translation','listening'];
const OPS = ['create','update','archive','restore'];
const plain = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype,null].includes(Object.getPrototypeOf(value))) fail('操作内容须为普通对象。');
  return value;
};
const text = (value,max,required=false) => {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail('文本内容缺失或过长。');
  return value;
};
const id = value => {
  text(value,128,true);
  if (FORBIDDEN.has(value) || /[\u0000-\u001f\u007f]/.test(value)) fail('对象编号无效。');
  return value;
};
const bool = value => { if (typeof value !== 'boolean') fail('开关必须是 true 或 false。'); return value; };
const integer = (value,min,max) => { if (!Number.isSafeInteger(value) || value<min || value>max) fail(`数值须为 ${min}–${max} 的整数。`); return value; };
const number = (value,min,max) => { if (typeof value !== 'number' || !Number.isFinite(value) || value<min || value>max) fail(`数值须在 ${min}–${max} 范围内。`); return value; };
const choice = (value,values) => { if (!values.includes(value)) fail('选项不受支持。'); return value; };
const day = value => { if (!isValidDate(value)) fail('请明确提供真实有效的 YYYY-MM-DD 日期。'); return value; };
const clock = value => { if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) fail('时间须为 HH:MM。'); return value; };
const color = value => { if (typeof value !== 'string' || !/^#[\da-f]{6}$/i.test(value)) fail('颜色须为 #RRGGBB。'); return value; };
const stamp = value => { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value))) fail('记录时间无效。'); return value; };
const now = ctx => stamp(typeof ctx.now === 'function' ? ctx.now() : ctx.now);
const ref = (ctx,value,entities) => id(ctx.resolveReference ? ctx.resolveReference(value,entities) : value);
function fields(value,rules,required=[]) {
  plain(value);
  const result = {};
  for (const key of Object.keys(value)) {
    if (!Object.hasOwn(rules,key) || FORBIDDEN.has(key)) fail(`不支持字段 ${key}；不能更改账户、API 密钥或任意数据路径。`);
    result[key] = rules[key](value[key]);
  }
  for (const key of required) if (!Object.hasOwn(result,key)) fail(`请先补充 ${key}。`);
  return result;
}
function actionData(data,operation,rules,required=[],operations=OPS) {
  if (!operations.includes(operation)) fail('此对象不支持该操作；永久删除、账户与备份恢复不在 AI 操作范围内。');
  if (operation==='archive' || operation==='restore') return fields(data,{});
  const result = fields(data,rules,operation==='create'?required:[]);
  if (operation==='update' && !Object.keys(result).length) fail('请指定要修改的内容。');
  return result;
}
const recordFields = (value,rules,required=Object.keys(rules)) => fields(value,rules,required);
const snapshot = (entity,action,idValue,containerId,before,after) => ({entity,operation:action.operation,id:idValue,containerId,before:before===null?null:clone(before),after:clone(after)});
function today(ctx) { return new Date(now(ctx)).toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'}); }
function pastDay(value,ctx) { day(value); if (value>today(ctx)) fail('实际学习记录不能填写未来日期；计划请放在日历。'); return value; }
function evidence(state,data,ctx) {
  const quote = text(data.evidence??'',2000,true).trim();
  if (quote.length<4) fail('实际学习或掌握状态需要引用至少 4 个字符的用户原话。');
  const request = state.aiRequests?.find(item=>item.id===ctx.requestId);
  const messages = request?.conversation?.messages?.filter(item=>item.role==='user').map(item=>item.text)||[];
  const supplied = Array.isArray(ctx.userTexts)?ctx.userTexts:typeof ctx.userText==='string'?[ctx.userText]:[];
  if (![...supplied,request?.text||'',...messages].some(value=>typeof value==='string'&&value.includes(quote))) fail('学习记录需来自用户明确提供的实际情况，不能把计划或 AI 建议算作已完成。');
}
const evidenceRule = value => text(value,2000,true);
const withoutEvidence = data => Object.fromEntries(Object.entries(data).filter(([key])=>key!=='evidence'));

const calendarRules = {title:v=>text(v,160,true),kind:v=>choice(v,['plan','mark','note']),startDate:day,endDate:day,allDay:bool,startTime:v=>v===''?'':clock(v),endTime:v=>v===''?'':clock(v),location:v=>text(v,240),notes:v=>text(v,12000),important:bool,done:bool,color};
function calendarRecord(value) {
  fields(value,{id,...calendarRules,archived:bool,createdAt:stamp,updatedAt:stamp},['id','title','kind','startDate','endDate','allDay','startTime','endTime','location','notes','important','done','color','archived','createdAt','updatedAt']);
  if (value.allDay && (value.startTime || value.endTime)) fail('全天事件不应包含具体时间；定时事件请设置 allDay:false。');
  return validateCalendar({version:1,events:[value]}).events[0];
}
const periodRules = {id:v=>integer(v,1,24),start:clock,end:clock};
const periods = value => {
  if (!Array.isArray(value) || !value.length || value.length>24) fail('请明确提供 1–24 个节次和起止时间。');
  return value.map(item=>fields(item,periodRules,['id','start','end']));
};
const weeks = value => {
  if (!Array.isArray(value) || !value.length || value.length>53) fail('请明确提供上课周数组。');
  const result=value.map(v=>integer(v,1,53));
  if(new Set(result).size!==result.length)fail('上课周不能重复。');
  return result.sort((a,b)=>a-b);
};
const termRules={title:v=>text(v,160,true),campus:v=>text(v,100),weekOne:day,totalWeeks:v=>integer(v,1,53),teachingWeeks:v=>integer(v,0,53),notes:v=>text(v,10000),periods};
const entryRules={title:v=>text(v,160,true),teacher:v=>text(v,160),location:v=>text(v,300),weekday:v=>integer(v,1,7),startPeriod:v=>integer(v,1,24),endPeriod:v=>integer(v,1,24),weeks,color};
function entryRecord(value) {
  const clean=recordFields(value,{id,...entryRules,archived:bool});
  if(clean.endPeriod<clean.startPeriod)fail('结束节次不能早于开始节次。');
  return clean;
}
function termRecord(value) {
  const clean=recordFields(value,{id,...termRules,entries:value=>{
    if(!Array.isArray(value)||value.length>10000)fail('学期课程数量无效。');
    return value.map(entryRecord);
  }});
  return validateTimetable({version:1,activeTermId:clean.id,terms:[clean]}).terms[0];
}
const timetableOf=state=>state.timetable??{version:1,activeTermId:'',terms:[]};
function findTerm(state,containerId,ctx) {
  const termId=ref(ctx,containerId,['timetableTerm']);
  const term=timetableOf(state).terms.find(item=>item.id===termId);
  if(!term)fail('目标学期不存在。');
  return term;
}

function listAdapter({entity,label,capability,rules,required,operations=OPS,validateRecord,list,create,update,commit,canUndo}) {
  return {
    label,capability,operations,fields:Object.fromEntries(Object.keys(rules).map(key=>[key,key])),
    normalizeData:(data,operation)=>actionData(data,operation,rules,required,operations),list,validateRecord,
    apply(state,action,ctx) {
      const data=this.normalizeData(action.data||{},action.operation);
      if(entity==='timetableEntry'&&!action.containerId)fail('课表课程必须指定所属学期。');
      if(entity!=='timetableEntry'&&action.containerId)fail('此对象不支持指定其他容器。');
      const targetId=action.operation==='create'?id(ctx.uid()):ref(ctx,action.id,[entity]);
      const current=action.operation==='create'?null:list(state).find(item=>item.id===targetId&&(!action.containerId||item.containerId===ref(ctx,action.containerId,entity==='timetableEntry'?['timetableTerm']:[])));
      if(action.operation!=='create'&&!current)fail(`${label}不存在或所属位置不匹配。`);
      if(action.operation==='create'&&list(state).some(item=>item.id===targetId))fail('新增记录编号重复。');
      const before=current?.record??null;
      const containerId=current?.containerId??(entity==='timetableEntry'?findTerm(state,action.containerId,ctx).id:'');
      let proposed;
      if(action.operation==='create') proposed=create(state,data,targetId,ctx);
      else if(action.operation==='archive'||action.operation==='restore') proposed={...before,archived:action.operation==='archive',...(Object.hasOwn(before,'updatedAt')?{updatedAt:now(ctx)}:{})};
      else proposed=update?update(state,before,data,ctx):{...before,...data};
      const after=validateRecord(proposed);
      commit(state,targetId,containerId,after,action.operation,ctx);
      const stored=list(state).find(item=>item.id===targetId&&item.containerId===containerId)?.record;
      return snapshot(entity,action,targetId,containerId,before,stored??after);
    },
    undo(state,item,ctx) {
      const current=list(state).find(row=>row.id===item.id&&row.containerId===item.containerId);
      if(!current||!equal(current.record,item.after)||canUndo&&!canUndo(state,item))return false;
      const before=item.before===null?null:validateRecord(item.before);
      commit(state,item.id,item.containerId,before,before===null?'remove':'replace',ctx);
      return true;
    },
  };
}
function changeRows(rows,targetId,after) {
  const index=rows.findIndex(row=>row.id===targetId);
  if(after===null)return rows.filter(row=>row.id!==targetId);
  if(index<0)return [...rows,after];
  return rows.map((row,n)=>n===index?after:row);
}
const calendarAdapter=listAdapter({
  entity:'calendarEvent',label:'日历事件',rules:calendarRules,required:['title','startDate'],validateRecord:calendarRecord,
  capability:'create/update/archive/restore。data:title(必填),startDate(必填YYYY-MM-DD),endDate(默认同日),kind=plan|mark|note(默认plan),allDay(默认true),startTime/endTime(HH:MM，定时须allDay:false),location,notes,important,done,color(#RRGGBB)。与学期课表分开。',
  list:state=>(state.calendar?.events||[]).map(record=>({id:record.id,containerId:'',title:record.title,record})),
  create:(state,data,recordId,ctx)=>({id:recordId,title:data.title,kind:'plan',startDate:data.startDate,endDate:data.startDate,allDay:true,startTime:'',endTime:'',location:'',notes:'',important:false,done:false,...data,color:ctx.assignColor(state,data.color),archived:false,createdAt:now(ctx),updatedAt:now(ctx)}),
  update:(_state,before,data,ctx)=>({...before,...data,updatedAt:now(ctx)}),
  commit:(state,recordId,_containerId,after)=>{state.calendar=validateCalendar({version:1,events:changeRows(state.calendar?.events||[],recordId,after)});},
});
const termAdapter=listAdapter({
  entity:'timetableTerm',label:'课表学期',rules:termRules,required:['title','weekOne','totalWeeks','periods'],operations:['create','update'],validateRecord:termRecord,
  capability:'create/update。data必填title,weekOne(第1周星期一YYYY-MM-DD),totalWeeks(1–53),periods:[{id:1–24,start:HH:MM,end:HH:MM}]；可选teachingWeeks(默认totalWeeks),campus,notes。不得猜测学期和节次。当前学期用timetableSettings设置。',
  list:state=>timetableOf(state).terms.map(record=>({id:record.id,containerId:'',title:record.title,record})),
  create:(_state,data,recordId)=>({id:recordId,title:data.title,campus:'',weekOne:data.weekOne,totalWeeks:data.totalWeeks,teachingWeeks:data.totalWeeks,notes:'',...data,entries:[]}),
  commit:(state,recordId,_containerId,after)=>{
    const current=timetableOf(state),terms=changeRows(current.terms,recordId,after);
    if(after===null&&current.activeTermId===recordId)fail('该学期仍是当前学期，请先恢复当前学期设置再撤回。');
    state.timetable=validateTimetable({...current,terms});
  },
  canUndo:(state,item)=>!(item.before===null&&timetableOf(state).activeTermId===item.id),
});
const entryAdapter=listAdapter({
  entity:'timetableEntry',label:'课表课程',rules:entryRules,required:['title','weekday','startPeriod','endPeriod','weeks'],validateRecord:entryRecord,
  capability:'create/update/archive/restore；containerId须为学期id或$新学期ref。data必填title,weekday(周一1至周日7),startPeriod,endPeriod,weeks(上课周整数数组)；可选teacher,location,color。只写课表，不写日历。',
  list:state=>timetableOf(state).terms.flatMap(term=>term.entries.map(record=>({id:record.id,containerId:term.id,title:`${term.title} · ${record.title}`,record}))),
  create:(state,data,recordId,ctx)=>({id:recordId,title:data.title,teacher:'',location:'',...data,color:ctx.assignColor(state,data.color),archived:false}),
  commit:(state,recordId,containerId,after)=>{
    const current=timetableOf(state),term=current.terms.find(item=>item.id===containerId);
    if(!term)fail('目标学期不存在。');
    state.timetable=validateTimetable({...current,terms:current.terms.map(item=>item===term?{...item,entries:changeRows(item.entries,recordId,after)}:item)});
  },
});

function englishOf(state) {
  const source=state.english??{};
  // Older workspaces may have only a plan or a vocabulary list. Reading the
  // catalog must never initialize or mutate the user's workspace.
  return {words:[],sessions:[],mistakes:[],attempts:[],readingAnswers:{},readingResult:null,audio:null,...source,
    plan:{examDate:'',target:'',dailyMinutes:'',focus:'reading',...source.plan},
    drafts:{writing:'',translation:'',listening:'',...source.drafts},draftUpdatedAt:{...source.draftUpdatedAt}};
}
const targetScore=(value,min=.5)=>{
  const result=number(value,min,9999);
  if(!Number.isInteger(result*2))fail('目标分数请按 0.5 分为单位填写。');
  return result;
};
const planRules={examDate:v=>v===''?'':day(v),target:v=>v===''?'':targetScore(v),dailyMinutes:v=>v===''?'':integer(v,1,720),focus:v=>choice(v,['',...PRACTICES])};
const planRecord=value=>recordFields(value,{...planRules,target:v=>v===''?'':targetScore(v,0),dailyMinutes:v=>v===''?'':integer(v,0,720)});
const wordRules={word:v=>text(v,80,true),meaning:v=>text(v,200,true),phonetic:v=>text(v,200),example:v=>text(v,500),translation:v=>text(v,500),status:v=>choice(v,['new','review','mastered']),evidence:evidenceRule};
function wordRecord(value) {
  return fields(value,{id,...Object.fromEntries(Object.entries(wordRules).filter(([key])=>key!=='evidence')),source:v=>choice(v,['builtin','personal']),updatedAt:stamp,archived:bool},['id','word','meaning','phonetic','example','translation','status','source']);
}
const sessionRules={date:day,minutes:v=>integer(v,1,720),type:v=>choice(v,PRACTICES),note:v=>text(v,150),evidence:evidenceRule};
function sessionRecord(value) {return fields(value,{id,...Object.fromEntries(Object.entries(sessionRules).filter(([key])=>key!=='evidence')),createdAt:stamp,example:bool,archived:bool},['id','date','minutes','type','note']);}
const mistakeRules={question:v=>text(v,12000,true),selected:v=>text(v,6000,true),correct:v=>text(v,6000,true),explanation:v=>text(v,12000),source:v=>text(v,300),date:day,reviewed:bool,evidence:evidenceRule};
function mistakeRecord(value) {return fields(value,{id,questionId:id,...Object.fromEntries(Object.entries(mistakeRules).filter(([key])=>key!=='evidence')),example:bool,archived:bool},['id','questionId','question','selected','correct','explanation','source','date','reviewed']);}
function englishRowsAdapter(config,key) {
  return listAdapter({...config,
    list:state=>(englishOf(state)[key]||[]).map(record=>({id:record.id,containerId:'',title:record.word||record.question||`${record.date} ${record.minutes} 分钟`,record})),
    commit:(state,recordId,_containerId,after)=>{const en=englishOf(state);const rows=changeRows(en[key]||[],recordId,after);if(rows.length>100000)fail('英语记录数量超过上限。');state.english={...en,[key]:rows};},
  });
}
const wordAdapter=englishRowsAdapter({entity:'englishWord',label:'英语词汇',rules:wordRules,required:['word','meaning'],validateRecord:wordRecord,
  capability:'create/update/archive/restore。data必填word,meaning；可选phonetic,example,translation,status=new|review|mastered(默认new)。设置review/mastered必须附evidence(用户原话，至少4字符)，不得替用户假定已掌握。',
  create:(state,data,recordId,ctx)=>{if(data.status&&data.status!=='new')evidence(state,data,ctx);if(englishOf(state).words.some(item=>item.word.toLowerCase()===data.word.toLowerCase()))fail('这个词已存在，请修改已有词汇。');return {id:recordId,word:data.word,meaning:data.meaning,phonetic:'',example:'',translation:'',status:'new',source:'personal',...withoutEvidence(data),updatedAt:now(ctx),archived:false};},
  update:(state,before,data,ctx)=>{if(data.status&&data.status!==before.status&&data.status!=='new')evidence(state,data,ctx);if(data.word&&englishOf(state).words.some(item=>item.id!==before.id&&item.word.toLowerCase()===data.word.toLowerCase()))fail('这个词已存在。');return {...before,...withoutEvidence(data),updatedAt:now(ctx)};},
},'words');
const sessionAdapter=englishRowsAdapter({entity:'englishSession',label:'实际学习记录',rules:sessionRules,required:['date','minutes','type','evidence'],validateRecord:sessionRecord,
  capability:'create/update/archive/restore。data必填date(不晚于今天),minutes(实际1–720分钟),type=reading|listening|writing|translation|vocabulary,evidence(至少4字符的用户实际学习原话)；可选note。更新实际日期/分钟/类型也必须有evidence；不得把学习计划、目标或AI建议当作已完成。',
  create:(state,data,recordId,ctx)=>{evidence(state,data,ctx);pastDay(data.date,ctx);return {id:recordId,date:data.date,minutes:data.minutes,type:data.type,note:'',...withoutEvidence(data),createdAt:now(ctx),archived:false};},
  update:(state,before,data,ctx)=>{if(['date','minutes','type'].some(key=>Object.hasOwn(data,key)&&data[key]!==before[key]))evidence(state,data,ctx);pastDay(data.date??before.date,ctx);return {...before,...withoutEvidence(data)};},
},'sessions');
const mistakeAdapter=englishRowsAdapter({entity:'englishMistake',label:'英语错题',rules:mistakeRules,required:['question','selected','correct','date'],validateRecord:mistakeRecord,
  capability:'create/update/archive/restore。data必填question,selected(用户答案),correct(明确正确答案),date；可选explanation,source,reviewed(默认false)。reviewed=true须evidence(用户已回顾原话至少4字符)。不能修改阅读成绩或伪造答题历史。',
  create:(state,data,recordId,ctx)=>{if(data.reviewed)evidence(state,data,ctx);pastDay(data.date,ctx);return {id:recordId,questionId:recordId,question:data.question,selected:data.selected,correct:data.correct,explanation:'',source:'用户提供的错题',date:data.date,reviewed:false,...withoutEvidence(data),archived:false};},
  update:(state,before,data,ctx)=>{if(data.reviewed===true&&!before.reviewed)evidence(state,data,ctx);pastDay(data.date??before.date,ctx);return {...before,...withoutEvidence(data)};},
},'mistakes');

function singleton({entity,label,recordId,rules,validateRecord,read,write,capability,prepare}) {
  return {label,capability,operations:['update'],fields:Object.fromEntries(Object.keys(rules).map(key=>[key,key])),
    normalizeData:(data,operation)=>actionData(data,operation,rules,[],['update']),validateRecord,
    list:state=>[{id:recordId,containerId:'',title:label,record:read(state)}],
    apply(state,action,ctx) {
      if(action.id!==recordId||action.containerId)fail(`${label}目标编号无效。`);
      const data=this.normalizeData(action.data||{},action.operation),before=clone(read(state));
      const after=validateRecord({...before,...(prepare?prepare(state,data,ctx):data)});
      write(state,after,ctx);return snapshot(entity,action,recordId,'',before,after);
    },
    undo(state,item,ctx){if(item.id!==recordId||!equal(read(state),item.after))return false;write(state,validateRecord(item.before),ctx);return true;},
  };
}
const planAdapter=singleton({entity:'englishPlan',label:'英语学习计划',recordId:'english-plan',rules:planRules,validateRecord:planRecord,
  capability:'仅update，id=english-plan；data可含examDate(YYYY-MM-DD或空),target(可选自定目标分数，0.5–9999且以0.5为步进，或空),dailyMinutes(1–720或空),focus=reading|listening|writing|translation|vocabulary|空。分数不绑定任何官方考试标准，不自动换算旧分数。用户未确定日期/时长须追问或保持空，不能猜官方考试日。',
  read:state=>englishOf(state).plan,write:(state,record)=>{state.english={...englishOf(state),plan:record};},
});
const termSettingsAdapter=singleton({entity:'timetableSettings',label:'当前学期',recordId:'timetable-settings',rules:{activeTermId:v=>v===''?'':id(v)},validateRecord:value=>recordFields(value,{activeTermId:v=>v===''?'':id(v)}),
  capability:'仅update，id=timetable-settings；data:{activeTermId:现有学期id或$新学期ref或空}。只切换课表当前学期。',
  read:state=>({activeTermId:timetableOf(state).activeTermId}),prepare:(_state,data,ctx)=>({...data,activeTermId:data.activeTermId?ref(ctx,data.activeTermId,['timetableTerm']):''}),
  write:(state,record)=>{state.timetable=validateTimetable({...timetableOf(state),activeTermId:record.activeTermId});},
});
const draftRecord=value=>fields(value,{content:v=>text(v,100000),updatedAt:v=>v===''?'':stamp(v)},['content','updatedAt']);
const draftPrompts={writing:WRITING_PROMPTS,translation:TRANSLATION_PROMPTS};
const draftTargets=[...DRAFTS.map(type=>({id:type,type,legacy:true,title:type==='listening'?'听力笔记':`${type==='writing'?'写作':'翻译'} · ${draftPrompts[type].find(prompt=>prompt.legacy)?.title||'原有草稿'}`})),
  ...Object.entries(draftPrompts).flatMap(([type,prompts])=>prompts.filter(prompt=>!prompt.legacy).map(prompt=>({id:`${type}:${prompt.id}`,type,promptId:prompt.id,legacy:false,title:`${type==='writing'?'写作':'翻译'} · ${prompt.title}`})))];
const draftTarget=draftId=>{const target=draftTargets.find(target=>target.id===draftId);if(!target)fail('请选择已知题目的英语草稿编号。');return target;};
function readDraftRecord(state,target){
  const en=englishOf(state);
  if(target.legacy)return {content:en.drafts[target.type]||'',updatedAt:en.draftUpdatedAt[target.type]||''};
  const record=en.draftExercises?.[target.type]?.[target.promptId];
  return {content:record?.text||'',updatedAt:record?.updatedAt||''};
}
function writeDraftRecord(state,target,record){
  const en=englishOf(state);
  if(target.legacy){
    const times={...en.draftUpdatedAt};if(record.updatedAt)times[target.type]=record.updatedAt;else delete times[target.type];
    state.english={...en,drafts:{...en.drafts,[target.type]:record.content},draftUpdatedAt:times};return;
  }
  const exercises={...en.draftExercises},group={...exercises[target.type]};
  if(record.content||record.updatedAt)group[target.promptId]={text:record.content,updatedAt:record.updatedAt};
  else delete group[target.promptId];
  if(Object.keys(group).length)exercises[target.type]=group;else delete exercises[target.type];
  state.english={...en};
  if(Object.keys(exercises).length)state.english.draftExercises=exercises;else delete state.english.draftExercises;
}
const draftAdapter={label:'英语草稿',operations:['update'],capability:'仅update；data:{content:草稿完整正文}。先查询englishDraft获取题目和真实id：writing/translation是各自原有首题，listening是听力笔记；其它已知题使用writing:题目id或translation:题目id，必须与用户当前所选题一致。每题独立保存，不能把其它题稿写入首题或编造题号，不生成成绩或已完成学习记录。',fields:{content:'草稿正文'},
  normalizeData:(data,operation)=>actionData(data,operation,{content:v=>text(v,100000)},['content'],['update']),validateRecord:draftRecord,
  list:state=>draftTargets.map(target=>({id:target.id,containerId:'',title:target.title,record:readDraftRecord(state,target)})),
  apply(state,action,ctx){const target=draftTarget(action.id);if(action.containerId)fail('英语草稿位置无效。');const data=this.normalizeData(action.data||{},action.operation),before=readDraftRecord(state,target),after={content:data.content,updatedAt:now(ctx)};writeDraftRecord(state,target,after);return snapshot('englishDraft',action,action.id,'',before,after);},
  undo(state,item){const row=this.list(state).find(row=>row.id===item.id);if(!row||!equal(row.record,item.after))return false;writeDraftRecord(state,draftTarget(item.id),draftRecord(item.before));return true;},
};
const profileRules={name:v=>text(v,100,true),major:v=>text(v,200)};
const profileAdapter=singleton({entity:'profileSettings',label:'个人资料',recordId:'profile-settings',rules:profileRules,validateRecord:value=>recordFields(value,profileRules),
  capability:'仅update，id=profile-settings；data仅name(称呼),major(专业)。不能修改账号、登录、模型供应商或API密钥。',
  read:state=>({name:state.profile?.name??'同学',major:state.profile?.major??''}),write:(state,record)=>{state.profile={...state.profile,...record};},
});
const uiRules={sidebarPinned:bool,inboxView:v=>choice(v,['cards','dream'])};
const uiAdapter=singleton({entity:'uiSettings',label:'界面偏好',recordId:'ui-settings',rules:uiRules,validateRecord:value=>fields(value,uiRules,['sidebarPinned']),
  capability:'仅update，id=ui-settings；data:sidebarPinned(true展开/false收起),inboxView=cards|dream。网格吸附请用canvasSettings的snap。',
  read:state=>({sidebarPinned:state.ui?.sidebarPinned??false,...(state.ui?.inboxView?{inboxView:state.ui.inboxView}:{})}),write:(state,record)=>{const ui={...state.ui};delete ui.inboxView;state.ui={...ui,...record};},
});

const cardRules={x:v=>number(v,-100000,100000),y:v=>number(v,-100000,100000),w:v=>number(v,220,1100),h:v=>number(v,220,850),color};
const cardRecord=value=>recordFields(value,{id,...cardRules});
const viewRule=value=>fields(value,{x:v=>number(v,-150000,150000),y:v=>number(v,-150000,150000),zoom:v=>number(v,.3,1.6)},['x','y','zoom']);
const canvasRules={snap:bool,presentation:v=>choice(v,['canvas','list','grid-2','grid-3','stack']),stackPointer:v=>number(v,0,1),view:viewRule};
function canvasRecord(value) {
  return fields(value,{cards:value=>{if(!Array.isArray(value)||value.length>10000)fail('画布卡片数量无效。');const cards=value.map(cardRecord);if(new Set(cards.map(card=>card.id)).size!==cards.length)fail('画布卡片编号重复。');return cards;},...canvasRules,initialized:bool,modifiedAt:stamp,customized:bool},['cards','snap','initialized']);
}
const emptyCanvas=()=>({cards:[],snap:true,initialized:false});
function canvasLocation(state,canvasId) {
  id(canvasId);
  if(canvasId==='home')return {parent:state,key:'canvas'};
  if(canvasId==='courses')return {parent:state,key:'courseCanvas'};
  if(['tasks','inbox'].includes(canvasId))return {parent:state.boards,key:canvasId,board:true};
  const match=canvasId.match(/^(course|space):(.+):(overview|notes|files|tasks)$/);
  if(!match)fail('只能修改已知工作区画布，不能指定任意路径。');
  const [,kind,parentId,section]=match;
  id(parentId);
  const parent=(kind==='course'?state.courses:state.spaces)?.find(item=>item.id===parentId);
  if(!parent||kind==='course'&&!['notes','files'].includes(section))fail('画布所属工作区或分区不存在。');
  return {parent:state.boards,key:canvasId,board:true};
}
function readCanvas(state,canvasId){const location=canvasLocation(state,canvasId);const value=location.parent?.[location.key];return value?{...emptyCanvas(),...clone(value)}:null;}
function writeCanvas(state,canvasId,value){const location=canvasLocation(state,canvasId);if(location.board)state.boards??={};const parent=location.board?state.boards:state;if(value===null)delete parent[location.key];else parent[location.key]=canvasRecord(value);}
function canvasList(state) {
  const known=['home','courses','tasks','inbox',...Object.keys(state.boards||{}).filter(key=>!['tasks','inbox'].includes(key))];
  const result=[];
  for(const canvasId of known){try{const value=readCanvas(state,canvasId);result.push({id:canvasId,containerId:'',title:({'home':'主页画布','courses':'课程画布','tasks':'待办画布','inbox':'灵感画布'})[canvasId]||canvasId,record:value??emptyCanvas()});}catch{/* Ignore stale boards whose parent no longer exists. */}}
  return result;
}
const canvasAdapter={label:'画布显示设置',operations:['update'],fields:{snap:'网格吸附',presentation:'排列方式',stackPointer:'堆叠指针',view:'画布视角'},
  capability:'仅update；id=home|courses|tasks|inbox|course:课程id:notes或files|space:空间id:overview或notes或files或tasks。data:snap布尔,presentation=canvas|list|grid-2|grid-3|stack,stackPointer(0–1),view:{x,y,zoom(.3–1.6)}。不能删除或替换卡片集合。',
  normalizeData:(data,operation)=>actionData(data,operation,canvasRules,[],['update']),validateRecord:canvasRecord,list:canvasList,
  apply(state,action,ctx){if(action.containerId)fail('画布设置目标无效。');const data=this.normalizeData(action.data||{},action.operation),before=readCanvas(state,action.id),after=canvasRecord({...before??emptyCanvas(),...data,customized:true,modifiedAt:now(ctx)});writeCanvas(state,action.id,after);return snapshot('canvasSettings',action,action.id,'',before,after);},
  undo(state,item){let current;try{current=readCanvas(state,item.id);}catch{return false;}if(!equal(current,item.after))return false;writeCanvas(state,item.id,item.before===null?null:canvasRecord(item.before));return true;},
};
const canvasCardAdapter={label:'画布卡片摆放',operations:['update'],fields:{x:'横坐标',y:'纵坐标',w:'宽度',h:'高度',color:'颜色'},
  capability:'仅update；containerId=画布id(同canvasSettings)，id=该画布已有卡片id。data:x/y(-100000–100000),w(220–1100),h(220–850),color(#RRGGBB)。主页AI卡片至少390×350。不新增卡片或改来源数据。',
  normalizeData:(data,operation)=>actionData(data,operation,cardRules,[],['update']),validateRecord:cardRecord,
  list:state=>canvasList(state).flatMap(board=>board.record.cards.map(record=>({id:record.id,containerId:board.id,title:`${board.title} · ${record.id}`,record}))),
  apply(state,action,ctx){const data=this.normalizeData(action.data||{},action.operation),board=readCanvas(state,action.containerId),targetId=id(action.id),before=board?.cards.find(card=>card.id===targetId);if(!before)fail('画布卡片不存在，请先打开对应画布。');const after=cardRecord({...before,...data});if(action.containerId==='home'&&targetId==='ai'&&(after.w<390||after.h<350))fail('主页AI卡片至少需要390×350的空间。');writeCanvas(state,action.containerId,{...board,cards:changeRows(board.cards,targetId,after),customized:true,modifiedAt:now(ctx)});return snapshot('canvasCard',action,targetId,action.containerId,before,after);},
  undo(state,item){let board;try{board=readCanvas(state,item.containerId);}catch{return false;}const current=board?.cards.find(card=>card.id===item.id);if(!current||!equal(current,item.after))return false;writeCanvas(state,item.containerId,{...board,cards:changeRows(board.cards,item.id,cardRecord(item.before))});return true;},
};

const STUDY_LABELS={title:'名称',kind:'日历类型',startDate:'开始日期',endDate:'结束日期',allDay:'全天',startTime:'开始时间',endTime:'结束时间',location:'地点',notes:'说明',important:'重要标记',done:'完成状态',color:'颜色',campus:'校区',weekOne:'第一周星期一',totalWeeks:'学期总周数',teachingWeeks:'教学周数',periods:'节次时间',teacher:'教师',weekday:'星期',startPeriod:'开始节次',endPeriod:'结束节次',weeks:'上课周',activeTermId:'当前学期',examDate:'考试日期',target:'目标分数',dailyMinutes:'每日分钟',focus:'优先练习',word:'词汇',meaning:'释义',phonetic:'音标',example:'例句',translation:'译文',status:'掌握状态',evidence:'用户提供的依据',date:'实际日期',minutes:'实际学习分钟',type:'练习内容',note:'备注',question:'题干',selected:'用户答案',correct:'正确答案',explanation:'解析',source:'来源',reviewed:'已回顾',name:'称呼',major:'专业',sidebarPinned:'展开侧边栏',inboxView:'灵感显示方式'};
for(const adapter of [calendarAdapter,termAdapter,entryAdapter,termSettingsAdapter,planAdapter,wordAdapter,sessionAdapter,mistakeAdapter,profileAdapter,uiAdapter])adapter.fields=Object.fromEntries(Object.keys(adapter.fields).map(key=>[key,STUDY_LABELS[key]||key]));
export const STUDY_ACTION_ADAPTERS=Object.freeze({calendarEvent:calendarAdapter,timetableTerm:termAdapter,timetableEntry:entryAdapter,timetableSettings:termSettingsAdapter,englishPlan:planAdapter,englishWord:wordAdapter,englishSession:sessionAdapter,englishMistake:mistakeAdapter,englishDraft:draftAdapter,profileSettings:profileAdapter,uiSettings:uiAdapter,canvasSettings:canvasAdapter,canvasCard:canvasCardAdapter});
export const studyActionAdapters=STUDY_ACTION_ADAPTERS;
