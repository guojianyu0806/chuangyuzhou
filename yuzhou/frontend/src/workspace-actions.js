// A bounded in-workspace transaction engine. No shell, network, arbitrary
// property paths, account settings, or model-selected new record identifiers.
import {CORE_ACTION_ADAPTERS} from './workspace-actions-core.js';
import {STUDY_ACTION_ADAPTERS} from './workspace-actions-study.js';
import {FITNESS_ACTION_ADAPTERS} from './workspace-actions-fitness.js';
import {COMPETITION_ACTION_ADAPTERS} from './workspace-actions-competitions.js';
import {PLATFORM_ACTION_ADAPTERS} from './workspace-actions-platform.js';
import {CUSTOM_BLOCK_ACTION_ADAPTERS} from './workspace-actions-custom-blocks.js';
import {CUSTOM_BLOCK_KINDS} from './custom-blocks-model.js';
import {assignRecordColor} from './creation-colors.js';
import {formatMoney} from './ledger-model.js';

const ADAPTERS={...CORE_ACTION_ADAPTERS,...STUDY_ACTION_ADAPTERS,...FITNESS_ACTION_ADAPTERS,...COMPETITION_ACTION_ADAPTERS,...PLATFORM_ACTION_ADAPTERS,...CUSTOM_BLOCK_ACTION_ADAPTERS};
const DOMAIN_KEYS=['spaces','courses','tasks','captures','ledger','calendar','timetable','english','fitness','competitions','profile','ui','canvas','courseCanvas','boards','workbench','customBlocks'];
const OPERATIONS=['create','update','archive','restore'];
const OP_LABEL={create:'新建',update:'修改',archive:'归档',restore:'恢复'};
const fail=message=>{throw new Error(message);};
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
function identifier(value,label='编号'){
  if(typeof value!=='string'||!value||value.length>240||/[\u0000-\u001f\u007f]/.test(value)||['__proto__','constructor','prototype'].includes(value))fail(`${label}无效。`);return value;
}
function safeJSON(value){
  if(JSON.stringify(value).length>4_000_000)fail('行动内容过大，请分批处理。');
  const check=(v,depth=0)=>{if(depth>30)fail('行动内容嵌套过深。');if(Array.isArray(v)){if(v.length>100000)fail('行动内容过多。');for(const row of v)check(row,depth+1);}else if(v&&typeof v==='object'){if(!plain(v))fail('行动对象格式无效。');for(const [key,row]of Object.entries(v)){if(['__proto__','constructor','prototype'].includes(key))fail('行动字段无效。');check(row,depth+1);}}else if(![null,undefined].includes(v)&&(!['string','number','boolean'].includes(typeof v)||(typeof v==='number'&&!Number.isFinite(v))))fail('行动值无效。');};check(value);
}
export function validateWorkspaceActions(input){
  if(!Array.isArray(input)||!input.length||input.length>50)fail('一次行动须为1至50项。');safeJSON(input);
  const aliases=new Map();
  return input.map(action=>{
    if(!plain(action)||Object.keys(action).some(key=>!['entity','operation','id','containerId','ref','data'].includes(key)))fail('行动结构包含不支持字段。');
    const adapter=Object.hasOwn(ADAPTERS,action.entity)?ADAPTERS[action.entity]:null;if(!adapter||!OPERATIONS.includes(action.operation)||!(adapter.operations||OPERATIONS).includes(action.operation))fail('此工作台操作暂不支持。');
    if(action.operation==='create'&&action.id!==undefined)fail('新记录编号由系统生成，不能自行指定。');
    if(action.operation!=='create')identifier(action.id,'待操作记录编号');
    if(action.containerId!==undefined)identifier(action.containerId,'所属位置');
    if(action.ref!==undefined&&(action.operation!=='create'||typeof action.ref!=='string'||!/^[A-Za-z][A-Za-z0-9_-]{0,47}$/.test(action.ref)||aliases.has(action.ref)))fail('新建记录引用名无效或重复。');
    const checkRefs=value=>{if(typeof value==='string'&&value.startsWith('$')){if(!/^\$[A-Za-z][A-Za-z0-9_-]{0,47}$/.test(value)||!aliases.has(value.slice(1)))fail('只能引用本批次前面已经新建的记录。');}else if(Array.isArray(value))value.forEach(checkRefs);else if(plain(value))Object.values(value).forEach(checkRefs);};
    // Only identity fields carry references; normal prose may contain '$'.
    for(const key of ['id','containerId'])if(action[key]?.startsWith('$'))checkRefs(action[key]);
    for(const key of ['projectId','spaceId','termId','courseId','activeTermId','targetContainerId','containerId'])if(action.data?.[key]?.startsWith('$'))checkRefs(action.data[key]);
    if(action.id?.startsWith('$')&&aliases.get(action.id.slice(1))!==action.entity)fail('引用的记录类型与行动不匹配。');
    const normalized={entity:action.entity,operation:action.operation,...(action.id===undefined?{}:{id:action.id}),...(action.containerId===undefined?{}:{containerId:action.containerId}),...(action.ref===undefined?{}:{ref:action.ref}),data:adapter.normalizeData(action.data??{},action.operation)};
    if(action.ref)aliases.set(action.ref,action.entity);return normalized;
  });
}

export const WORKSPACE_ACTION_CAPABILITIES=Object.entries(ADAPTERS).map(([entity,adapter])=>({entity,label:adapter.label||entity,operations:adapter.operations||OPERATIONS,description:adapter.capability||''}));
export function listWorkspaceRecords(state){
  return Object.entries(ADAPTERS).flatMap(([entity,adapter])=>adapter.list(state).map(row=>({entity,...row,record:structuredClone(row.record)})));
}
export function validateWorkspaceActionSnapshot(value){
  if(!plain(value)||Object.keys(value).some(key=>!['entity','operation','id','containerId','beforeContainerId','before','after'].includes(key)))fail('行动回执快照格式无效。');safeJSON(value);
  const adapter=Object.hasOwn(ADAPTERS,value.entity)?ADAPTERS[value.entity]:null;if(!adapter||!OPERATIONS.includes(value.operation)||!(adapter.operations||OPERATIONS).includes(value.operation))fail('行动回执类型无效。');
  identifier(value.id);if(value.containerId!=='')identifier(value.containerId,'回执位置');if(value.beforeContainerId!==undefined)identifier(value.beforeContainerId);
  if((value.operation==='create')!==(value.before===null)&&!(value.entity==='canvasSettings'&&value.operation==='update'&&value.before===null))fail('行动回执前后状态无效。');
  const before=value.before===null?null:adapter.validateRecord(value.before),after=adapter.validateRecord(value.after);
  for(const record of [before,after])if(record?.id!==undefined&&record.id!==value.id)fail('行动回执记录编号不一致。');
  if(value.operation==='archive'&&after.archived!==true)fail('归档行动快照无效。');
  if(value.operation==='restore'&&after.archived!==false)fail('恢复行动快照无效。');
  return {...value,before,after};
}
function actionContext(state,requestId,{uid=()=>crypto.randomUUID(),now=new Date().toISOString()}={}){
  const refs=new Map(),used=new Set(listWorkspaceRecords(state).map(row=>row.id));
  const request=state.aiRequests?.find(row=>row.id===requestId);
  const ctx={requestId,now:typeof now==='function'?now():now,userTexts:[request?.text||'',...(request?.conversation?.messages||[]).filter(message=>message.role==='user').map(message=>message.text||'')],
    uid:()=>{const value=identifier(uid());if(used.has(value))fail('系统生成了重复记录编号，请重试。');used.add(value);return value;},
    assignColor:(workspace,explicit)=>assignRecordColor(workspace,explicit),
    resolveReference:(value,allowedEntities)=>{if(typeof value!=='string'||!value.startsWith('$'))return value;const record=refs.get(value.slice(1));if(!record||!allowedEntities.includes(record.entity))fail('行动引用的前序记录类型无效。');return record.id;},
    referenceEntity:value=>refs.get(value.slice(1))?.entity,
  };
  return {ctx,refs};
}
function run(state,requestId,actions,options){
  const normalized=validateWorkspaceActions(actions),copy=structuredClone(state),{ctx,refs}=actionContext(copy,requestId,options),snapshots=[];
  for(const action of normalized){
    const adapter=ADAPTERS[action.entity],resolved={...action};if(action.id)resolved.id=ctx.resolveReference(action.id,[action.entity]);
    const snapshot=validateWorkspaceActionSnapshot(adapter.apply(copy,resolved,ctx));
    if(snapshot.entity!==action.entity||snapshot.operation!==action.operation)fail('行动适配器结果不匹配。');
    snapshots.push(snapshot);if(action.ref)refs.set(action.ref,{entity:action.entity,id:snapshot.id});
  }
  safeJSON(snapshots);return {copy,snapshots,now:ctx.now,uid:ctx.uid};
}
function commit(state,next){for(const key of DOMAIN_KEYS){if(Object.hasOwn(next,key))state[key]=next[key];else delete state[key];}}
const recordTitle=record=>record?.title||record?.name||record?.word||(record?.activity?`${record.date} · ${record.activity} · ${record.minutes} 分钟`:'')||record?.question?.slice(0,80)||record?.text?.slice(0,80)||record?.note||record?.category||record?.topic||record?.id||'设置';
export function applyWorkspaceActions(state,requestId,actions,options={}){
  const {copy,snapshots,now,uid}=run(state,requestId,actions,options);
  const receipt={destinationId:'workspace',destinationLabel:'工作台',engine:'hermes',createdAt:now,items:snapshots.map(snapshot=>({id:uid(),type:`${OP_LABEL[snapshot.operation]}${ADAPTERS[snapshot.entity].label||snapshot.entity}`,title:recordTitle(snapshot.after),collection:'actions',containerId:'workspace',snapshot:JSON.stringify(snapshot)}))};
  commit(state,copy);state.updatedAt=now;return receipt;
}
const FIELD_LABEL={title:'名称',description:'说明',subtitle:'课程简介',prompt:'助教偏好',content:'正文',chapter:'章节',source:'来源',color:'卡片颜色',type:'类型',text:'内容',tags:'标签',category:'分类',date:'日期',priority:'优先级',done:'完成状态',archived:'归档状态',spaceId:'所属空间',projectId:'所属账本',amount:'金额',amountCents:'金额',includeInTotal:'计入总账单',name:'文件名称',blobId:'原文件',size:'文件大小',icon:'图标',note:'备注',targetContainerId:'移动到',containerId:'所属位置',startDate:'开始日期',endDate:'结束日期',startTime:'开始时间',endTime:'结束时间',allDay:'全天',kind:'安排类型',important:'重要标记',location:'地点',notes:'备注',teacher:'教师',room:'教室',weeks:'周次',day:'星期',weekday:'星期',startPeriod:'开始节次',endPeriod:'结束节次',campus:'校区',word:'单词',meaning:'释义',phonetic:'音标',example:'例句',translation:'译文',status:'学习状态',duration:'学习时长',minutes:'学习分钟',reviewed:'已回顾',targetScore:'目标分数',examDate:'考试日期',dailyMinutes:'每日时长',vocabularyTarget:'词汇目标',contentGoal:'学习内容',enabled:'启用',scale:'缩放',x:'横向位置',y:'纵向位置',w:'宽度',h:'高度',width:'宽度',height:'高度',layout:'排列方式',snap:'网格吸附',sidebarPinned:'固定侧边栏',displayName:'显示名称'};
const SKIP_FIELDS=new Set(['id','updatedAt','createdAt','sourceRequestId','revisions','completedAt','configuration']);
Object.assign(FIELD_LABEL,{major:'专业',weekOne:'第一周开始日期',totalWeeks:'学期总周数',teachingWeeks:'教学周数',periods:'节次时间',entries:'课程安排',activeTermId:'当前学期',target:'目标分数',focus:'练习重点',question:'题目',selected:'作答内容',correct:'正确答案',explanation:'解析',questionId:'题目编号',fileName:'附件名称',fileType:'文件类型',files:'文件',cards:'卡片',snap:'网格吸附',initialized:'画布已初始化',customized:'已自定义布局',presentation:'排列方式',stackPointer:'堆叠指针',view:'画布视角',zoom:'缩放',inboxView:'灵感显示方式',evidence:'用户原话依据',fitnessEnabled:'开启运动记录',activity:'运动项目',distanceKm:'距离（公里）',caloriesKcal:'消耗热量（千卡）'});
function blockConfigText(value){
  if(!plain(value))return typeof value==='object'?JSON.stringify(value,null,2):String(value);
  const display=value=>value===''?'（空）':String(value);
  if(typeof value.code==='string')return `程序代码：\n${value.code}`;
  if(typeof value.text==='string')return `正文：\n${display(value.text)}`;
  if(Array.isArray(value.items))return value.items.length?value.items.map((item,index)=>{
    const lines=[`${index+1}. ${display(item.label)}`,`编号：${display(item.id)}`];
    if(Object.hasOwn(item,'done'))lines.push(`完成状态：${item.done?'已完成':'未完成'}`);
    if(Object.hasOwn(item,'url'))lines.push(`网址：${display(item.url)}`);
    return lines.join('\n');
  }).join('\n\n'):'条目：（空）';
  if(Object.hasOwn(value,'target'))return `当前值：${value.value}\n目标值：${value.target}\n单位：${display(value.unit)}`;
  if(typeof value.date==='string')return `日期：${display(value.date)}`;
  if(Array.isArray(value.columns)&&Array.isArray(value.rows)){
    const columns=value.columns.map((column,index)=>`${index+1}. ${display(column.label)}（编号：${display(column.id)}）`).join('\n')||'（空）';
    const rows=value.rows.map((row,index)=>[`${index+1}. 行编号：${display(row.id)}`,...row.cells.map((cell,column)=>`${value.columns[column]?.label||`第${column+1}列`}：${display(cell)}`)].join('\n')).join('\n\n')||'（空）';
    return `表头：\n${columns}\n\n记录：\n${rows}`;
  }
  return JSON.stringify(value,null,2);
}
function human(value,key,state,entity){
  if(key==='position'&&Number.isSafeInteger(value))return `第 ${value+1} 位`;
  if(key==='projectId'&&value==='')return '日常零钱';
  if(['distanceKm','caloriesKcal'].includes(key)&&value===null)return '未提供（不计入已知合计）';
  if(value===undefined||value===null||value==='')return '未设置';
  if(entity==='customBlock'){
    if(key==='kind')return CUSTOM_BLOCK_KINDS.find(kind=>kind.id===value)?.title||String(value);
    if(key==='config')return blockConfigText(value);
    if(key==='data')return JSON.stringify(value,null,2);
  }
  if(key==='amountCents')return `¥${formatMoney(value)}`;
  if(key==='amount')return `¥${value}`;
  if(typeof value==='boolean')return value?'是':'否';
  if(key==='projectId')return state?.ledger?.projects?.find(project=>project.id===value)?.title||value;
  if(key==='spaceId')return state?.spaces?.find(space=>space.id===value)?.title||value;
  if(key==='type'&&['expense','income'].includes(value))return value==='expense'?'支出':'收入';
  if(key==='priority')return value==='high'?'重要':'普通';
  if(key==='status'&&['watching','preparing','submitted','finished'].includes(value))return {watching:'关注中',preparing:'准备中',submitted:'已提交',finished:'已结束'}[value];
  if(key==='competitionId')return state?.competitions?.items?.find(item=>item.id===value)?.title||value;
  const practices={reading:'阅读',writing:'写作',listening:'听力',translation:'翻译',vocabulary:'词汇'};
  const named={kind:{plan:'计划',mark:'标注',note:'注意事项'},type:{blank:'空白空间',course:'课程',affairs:'事务',project:'项目',fitness:'运动健身',...practices},focus:practices,source:{personal:'用户添加',builtin:'内置',manual:'手动提供',device:'设备读数'},status:{new:'未学习',learning:'学习中',review:'待复习',mastered:'已掌握'},layout:{free:'自由画布',auto:'自适应',two:'两列',three:'三列',stack:'堆叠'},presentation:{canvas:'自由画布',list:'自适应','grid-2':'两列','grid-3':'三列',stack:'堆叠'},inboxView:{cards:'灵感墙',canvas:'自由画布',dream:'梦境模式'}};
  if(named[key]?.[value])return named[key][value];
  if(Array.isArray(value))return value.length?JSON.stringify(value):'空';
  return typeof value==='object'?JSON.stringify(value):String(value);
}
function destinationLabel(state,containerId,entity){
  if(entity==='competition')return '比赛空间';
  if(['competitionMilestone','competitionTask'].includes(entity))return state.competitions?.items?.find(item=>item.id===containerId)?.title||'比赛空间';
  if(containerId?.startsWith('space:'))return state.spaces?.find(row=>row.id===containerId.slice(6))?.title||'空间';
  if(containerId?.startsWith('course:'))return state.courses?.find(row=>row.id===containerId.slice(7))?.title||'课程';
  if(containerId?.startsWith('ledger:'))return state.ledger?.projects?.find(row=>row.id===containerId.slice(7))?.title||'项目账本';
  if(containerId==='ledger')return '日常零钱';
  return {space:'空间主页',course:'课程空间',task:'待办',capture:'灵感／收集箱',ledgerProject:'记账项目',calendarEvent:'日历',timetableTerm:'学期课表',timetableEntry:'学期课表'}[entity]||(entity.startsWith('english')?'英语学习':'工作台');
}
function fields(before,after,entity,state){
  const labels={...FIELD_LABEL,...(['space','course'].includes(entity)?{notes:'笔记'}:{}),...(entity==='profileSettings'?{name:'称呼'}:{}),...Object.fromEntries(Object.entries(ADAPTERS[entity].fields||{}).filter(([key,label])=>key!==label))};
  return [...new Set([...Object.keys(before||{}),...Object.keys(after||{})])].filter(key=>!SKIP_FIELDS.has(key)&&JSON.stringify(before?.[key])!==JSON.stringify(after?.[key])).map(key=>({label:labels[key]||key,before:human(before?.[key],key,state,entity),after:human(after?.[key],key,state,entity)}));
}
export function previewWorkspaceActions(state,actions,options={}){
  const requestId=options.requestId||state.aiRequests?.findLast(row=>row.status==='waiting_model')?.id;
  let sequence=0;const {copy,snapshots}=run(state,requestId,actions,{...options,uid:()=>`action-preview-${++sequence}`});
  return snapshots.map(snapshot=>({type:`${OP_LABEL[snapshot.operation]}${ADAPTERS[snapshot.entity].label||snapshot.entity}`,title:recordTitle(snapshot.after),destination:destinationLabel(copy,snapshot.containerId,snapshot.entity),content:snapshot.after.content||snapshot.after.text||snapshot.after.note||snapshot.after.description||'',before:snapshot.before,after:snapshot.after,
    fields:[...fields(snapshot.before,snapshot.after,snapshot.entity,copy),...(snapshot.beforeContainerId?[{label:'所属位置',before:destinationLabel(state,snapshot.beforeContainerId,snapshot.entity),after:destinationLabel(copy,snapshot.containerId,snapshot.entity)}]:[])]}));
}
export function describeWorkspaceAction(action){
  const adapter=Object.hasOwn(ADAPTERS,action?.entity)?ADAPTERS[action.entity]:null;if(!adapter)return {type:'工作台操作',title:'未知操作',destination:'工作台',fields:[]};
  const data=action.data||{};return {type:`${OP_LABEL[action.operation]||'操作'}${adapter.label||action.entity}`,title:recordTitle({...data,id:action.id||data.id||adapter.label}),destination:action.containerId||'工作台',fields:Object.entries(data).map(([key,value])=>({label:(action.entity==='customBlock'?adapter.fields?.[key]:null)||FIELD_LABEL[key]||adapter.fields?.[key]||key,before:'',after:human(value,key,undefined,action.entity)}))};
}
export async function undoWorkspaceActions(ctx,receipt,requestId){
  if(!receipt||receipt.destinationId!=='workspace'||!Array.isArray(receipt.items)||receipt.items.length>50)fail('行动回执无效。');
  const copy=structuredClone(ctx.state),{ctx:actionCtx}=actionContext(copy,requestId,{uid:ctx.uid}),snapshots=receipt.items.map(item=>{if(item.collection!=='actions')fail('不能混合撤回不同格式的操作。');identifier(item.id,'回执条目编号');return validateWorkspaceActionSnapshot(JSON.parse(item.snapshot));});
  let removed=0,retained=0;
  for(const snapshot of snapshots.reverse()){if(ADAPTERS[snapshot.entity].undo(copy,snapshot,actionCtx))removed++;else retained++;}
  const previous={};for(const key of DOMAIN_KEYS)if(Object.hasOwn(ctx.state,key))previous[key]=ctx.state[key];const updatedAt=ctx.state.updatedAt;
  commit(ctx.state,copy);ctx.state.updatedAt=actionCtx.now;
  try{await ctx.save();}catch(error){commit(ctx.state,previous);ctx.state.updatedAt=updatedAt;throw error;}
  return {removed,retained};
}
