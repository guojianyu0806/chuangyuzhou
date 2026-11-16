import {parseAmount,isValidDate,validateLedger,validateLedgerEntry} from './ledger-model.js';
import {isRecordColor} from './creation-colors.js';
import {validateSpaceWorkbench} from './space-workbench-config.js';
import {spaceWorkbenchLayout} from './space-workbench-model.js';

const fail=message=>{throw new Error(message);};
const clone=value=>structuredClone(value);
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).filter(key=>value[key]!==undefined).sort().map(key=>[key,canonical(value[key])])):value;
function comparable(entity,record){
  if(!record)return record;
  const defaults={space:{description:'',type:'blank',color:'#7950f2',icon:'folder',archived:false,example:false,createdAt:'',updatedAt:'',notes:[],files:[]},course:{subtitle:'',icon:'book',color:'#7950f2',prompt:'',example:false,updatedAt:'',notes:[],files:[]},note:{content:'',chapter:'',source:'',updatedAt:'',example:false,revisions:[]},file:{type:'',createdAt:''},task:{description:'',category:'个人',date:'',priority:'normal',done:false,archived:false,source:'',createdAt:''},capture:{text:'',category:'备忘',tags:'',archived:false,createdAt:''}};
  const value={...defaults[entity],...record};
  if(entity==='space'||entity==='course'){value.notes=value.notes.map(row=>comparable('note',row));value.files=value.files.map(row=>comparable('file',row));}
  if(entity==='note')value.revisions=value.revisions.map(row=>({content:'',chapter:'',source:'',updatedAt:'',savedAt:'',...row}));
  return canonical(value);
}
const sameRecord=(entity,a,b)=>JSON.stringify(comparable(entity,a))===JSON.stringify(comparable(entity,b));
const object=value=>value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const text=(value,max=3000,required=false)=>{if(typeof value!=='string'||value.length>max||(required&&!value.trim()))fail('行动内容的文字无效。');return value.trim();};
const id=value=>{text(value,160,true);if(['__proto__','constructor','prototype'].includes(value)||/[\u0000-\u001f\u007f]/.test(value))fail('行动编号无效。');return value;};
const bool=value=>{if(typeof value!=='boolean')fail('行动开关必须是布尔值。');return value;};
const choice=(value,values)=>{if(!values.includes(value))fail('行动选项无效。');return value;};
const date=value=>{if(value!==''&&!isValidDate(value))fail('行动日期无效。');return value;};
const color=value=>{if(!isRecordColor(value))fail('卡片颜色无效。');return value;};
const title=value=>text(value,180,true);
const definitions={
  space:{label:'空间',collection:'spaces',required:['title'],fields:{title,description:v=>text(v,5000),type:v=>choice(v,['blank','course','affairs','project','fitness']),fitnessEnabled:bool,icon:v=>text(v,64,true),color}},
  course:{label:'课程',collection:'courses',required:['title'],fields:{title,subtitle:v=>text(v,5000),prompt:v=>text(v,30000),icon:v=>text(v,64,true),color}},
  note:{label:'笔记',collection:'notes',nested:true,required:['title','content'],fields:{title,content:v=>text(v,120000),chapter:v=>text(v,240),source:v=>text(v,3000),color,targetContainerId:id}},
  file:{label:'文件',collection:'files',nested:true,required:['blobId'],fields:{blobId:id,name:v=>text(v,240,true),source:v=>text(v,3000),color,targetContainerId:id}},
  task:{label:'待办',collection:'tasks',required:['title'],fields:{title,description:v=>text(v,12000),category:v=>text(v,80,true),date,priority:v=>choice(v,['normal','high']),done:bool,spaceId:v=>v===''?'':id(v),color}},
  capture:{label:'灵感／收集记录',collection:'captures',required:['text'],fields:{text:v=>text(v,120000,true),category:v=>text(v,80,true),tags:v=>text(v,1000),source:v=>text(v,3000),blobId:id,color}},
  ledgerProject:{label:'记账项目',collection:'projects',ledger:true,required:['title'],fields:{title:v=>text(v,80,true),color,includeInTotal:bool}},
  ledgerEntry:{label:'账目',collection:'entries',ledger:true,required:['type','amount','date','category'],fields:{type:v=>choice(v,['income','expense']),amount:v=>{const n=parseAmount(v);return (n/100).toFixed(2);},date:v=>{if(!isValidDate(v))fail('记账日期无效。');return v;},category:v=>text(v,80,true),note:v=>text(v,2000),projectId:v=>v===''?'':id(v)}},
};
const metadata=['id','createdAt','updatedAt','archived','example','color','sourceRequestId'];
const recordExtra={space:['notes','files','workbench','parentId'],course:['notes','files'],note:['revisions'],file:['size','type'],task:['source','completedAt','captureId'],capture:['fileName','fileType','importedDraftKey'],ledgerProject:[],ledgerEntry:['amountCents']};
const schemaDescriptions={
  space:'title非空字符串≤180（新建必填）；description字符串≤5000默认空；type仅blank|course|affairs|project|fitness，默认blank；fitnessEnabled可选布尔，true开启该空间运动记录，false明确关闭，type为fitness新建默认开启；icon图标名称字符串≤64，默认folder。新建空间的notes/files由后续note/file行动写入，不能直接替换数组；真实已完成运动由fitnessEntry行动写入，计划由calendarEvent写入。',
  course:'title非空字符串≤180（新建必填）；subtitle课程简介字符串≤5000默认空；prompt助教偏好完整字符串≤30000默认空；icon图标名称字符串≤64默认book。notes/files仅由note/file行动修改。',
  note:'title非空字符串≤180、content完整Markdown正文字符串≤120000（新建均必填，content可空）；chapter字符串≤240默认空；source来源说明字符串≤3000。update只写要变更的字段，但修改content须给完整新正文（不是补丁）。所属containerId必填space:真实id或course:真实id，可为前序space/course创建的$ref；data.targetContainerId以同格式移动已有笔记。',
  file:'blobId现有上传文件编号（新建必填，不能是URL）；name非空文件名字符串≤240可选，默认保留原名；source说明字符串≤3000可选。size和type由已有上传资料取得，禁止手填。所属containerId为space:id或course:id，data.targetContainerId可移动已有文件；两者可引用前序space/course的$ref。',
  task:'title非空字符串≤180（新建必填）；description完整字符串≤12000默认空；category非空字符串≤80默认个人；date为YYYY-MM-DD或空（未知日期必须空，不能猜）；priority仅normal|high，默认normal；done布尔默认false，仅用户明确已完成才设true；spaceId为已有空间id、前序space的$ref或空（移出空间）；不能引用course或其他类型。',
  capture:'text非空完整正文字符串≤120000（新建必填）；category非空字符串≤80默认灵感，可用灵感/备忘/英语等现有分类；tags为字符串≤1000，不是数组；source说明字符串≤3000；blobId可选且必须是当前对话或工作台已有上传资料编号。改分类用update的category，编辑正文给完整text。',
  ledgerProject:'title非空字符串≤80（新建必填）；includeInTotal必须为布尔true或false，新建默认false即独立核算。只有用户明确要求才修改总账开关；已有项目名先查询匹配，不要重复创建。',
  ledgerEntry:'新建必填type=expense|income、amount为大于0且最多2位小数的人民币元字符串（如"18.50"，最大9999999.99，不能传amountCents、负数或货币符号）、date为真实YYYY-MM-DD、category非空字符串≤80；note字符串≤2000默认空；projectId已有记账项目id或前序ledgerProject的$ref，空字符串/省略表示日常零钱。修改amount仍用元字符串；修改projectId可移动账本。金额/日期/收支/归属不清必须先追问，合计不能重复记作明细。',
};
function validateCoreRecord(entity,record){
  if(!object(record))fail('行动快照记录无效。');id(record.id);
  const definition=definitions[entity];
  const allowed=new Set([...Object.keys(definition.fields).filter(k=>!['targetContainerId','amount'].includes(k)),...metadata,...recordExtra[entity]]);
  if(Object.keys(record).some(key=>!allowed.has(key)))fail(`${definition.label}快照包含不支持的字段。`);
  if(entity==='ledgerEntry')return validateLedgerEntry(record);
  for(const [key,validate]of Object.entries(definition.fields))if(record[key]!==undefined&&key!=='targetContainerId')validate(record[key]);
  for(const key of ['archived','example'])if(record[key]!==undefined)bool(record[key]);
  for(const key of ['createdAt','updatedAt','sourceRequestId'])if(record[key]!==undefined)text(record[key],160);
  if(record.sourceRequestId!==undefined)id(record.sourceRequestId);
  for(const key of ['source','fileName','fileType','importedDraftKey','captureId'])if(record[key]!==undefined)text(record[key],key==='source'?3000:1000);
  if(record.completedAt!==undefined&&record.completedAt!==null)text(record.completedAt,160);
  for(const key of definition.required)if(key!=='blobId'&&record[key]===undefined)fail(`${definition.label}快照缺少必填字段。`);
  if(record.color!==undefined)color(record.color);
  if(entity==='space'){if(record.parentId!==undefined)id(record.parentId);if(record.workbench!==undefined)validateSpaceWorkbench(record.workbench);}
  if(entity==='space'||entity==='course')for(const key of ['notes','files']){
    if(!Array.isArray(record[key])||record[key].length>100000)fail('空间资料格式无效。');
    const seen=new Set();for(const value of record[key]){validateCoreRecord(key==='notes'?'note':'file',value);if(seen.has(value.id))fail('空间资料编号重复。');seen.add(value.id);}
  }
  if(entity==='note'){
    if(record.revisions!==undefined&&(!Array.isArray(record.revisions)||record.revisions.length>10000))fail('笔记历史格式无效。');
    for(const rev of record.revisions||[]){if(!object(rev))fail('笔记历史格式无效。');for(const key of Object.keys(rev))if(!['id','title','content','chapter','source','updatedAt','savedAt','example'].includes(key))fail('笔记历史字段无效。');text(rev.title,240,true);for(const key of ['content','chapter','source','updatedAt','savedAt'])if(rev[key]!==undefined)text(rev[key],key==='content'?120000:3000);if(rev.example!==undefined)bool(rev.example);if(rev.id!==undefined)id(rev.id);}
  }
  if(entity==='file'){
    id(record.blobId);text(record.name,240,true);if(!Number.isInteger(record.size)||record.size<0||record.size>40*1024*1024)fail('文件大小无效。');text(record.type,300);
  }
  if(entity==='ledgerProject')return validateLedger({version:1,currency:'CNY',projects:[record],entries:[]}).projects[0];
  return clone(record);
}
function owner(state,containerId,allowArchived=false){
  if(typeof containerId!=='string'||!/^(space|course):/.test(containerId))fail('请选择笔记或文件所属空间／课程。');
  const [type,...parts]=containerId.split(':');const entity=type==='space'?'spaces':'courses';
  const record=state[entity]?.find(row=>row.id===parts.join(':'));
  if(!record||(!allowArchived&&record.archived))fail('目标空间／课程已归档或不存在。');
  return record;
}
function resolveContainer(value,ctx){
  if(value?.startsWith('$')){
    const actual=ctx.resolveReference(value,['space','course']);
    return ctx.referenceEntity?.(value)==='course'?`course:${actual}`:`space:${actual}`;
  }
  return value;
}
function collection(state,entity,containerId,initialize=false,allowArchived=false){
  const d=definitions[entity];
  if(d.nested){const o=owner(state,containerId,allowArchived);if(initialize)o[d.collection]||=[];return o[d.collection]||[];}
  if(d.ledger){if(initialize)state.ledger||={version:1,currency:'CNY',projects:[],entries:[]};return state.ledger?.[d.collection]||[];}
  if(initialize)state[d.collection]||=[];return state[d.collection]||[];
}
function list(state,entity){
  const d=definitions[entity];
  const pack=(record,containerId)=>({id:record.id,containerId,title:record.title||record.name||record.text?.slice(0,80)||record.note||record.category||d.label,record});
  if(d.nested)return ['space','course'].flatMap(type=>(state[type==='space'?'spaces':'courses']||[]).flatMap(container=>(container[d.collection]||[]).map(record=>pack(record,`${type}:${container.id}`))));
  return collection(state,entity).map(record=>pack(record,entity==='ledgerEntry'?(record.projectId?'ledger:'+record.projectId:'ledger'):'workspace'));
}
function locate(state,entity,recordId,containerId){
  const matches=list(state,entity).filter(row=>row.id===recordId&&(!definitions[entity].nested||!containerId||row.containerId===containerId));
  if(matches.length!==1)fail(matches.length?'记录编号不唯一，请指定所属空间。':'要操作的记录不存在。');return matches[0];
}
function uploadedFile(state,blobId,requestId){
  const files=[...(state.aiRequests?.find(r=>r.id===requestId)?.files||[]),...(state.aiDraft?.files||[])];
  for(const container of [...state.spaces||[],...state.courses||[]])files.push(...container.files||[]);
  for(const capture of state.captures||[])if(capture.blobId)files.push({blobId:capture.blobId,name:capture.fileName||capture.text,size:capture.size||0,type:capture.fileType||''});
  const found=files.find(file=>file.blobId===blobId);if(!found)fail('文件必须是工作台或当前对话中已上传的附件。');return found;
}
function references(state,entity,data,ctx){
  if(entity==='task'&&data.spaceId){data.spaceId=ctx.resolveReference(data.spaceId,['space']);if(!state.spaces?.some(row=>row.id===data.spaceId&&!row.archived))fail('待办目标空间已归档或不存在。');}
  if(entity==='ledgerEntry'&&data.projectId){data.projectId=ctx.resolveReference(data.projectId,['ledgerProject']);if(!state.ledger?.projects?.some(row=>row.id===data.projectId&&!row.archived))fail('目标记账项目已归档或不存在。');}
  return data;
}
function defaults(entity,ctx){
  const base={id:ctx.uid(),createdAt:ctx.now,updatedAt:ctx.now,archived:false,sourceRequestId:ctx.requestId};
  return {...base,...({space:{description:'',type:'blank',icon:'folder',example:false,notes:[],files:[]},course:{subtitle:'',prompt:'',icon:'book',example:false,notes:[],files:[]},note:{content:'',chapter:'',source:'AI 工作台行动',example:false,revisions:[]},file:{source:'AI 工作台行动'},task:{description:'',category:'个人',date:'',priority:'normal',done:false,source:'AI 工作台行动'},capture:{category:'灵感',tags:'',source:'AI 工作台行动'},ledgerProject:{includeInTotal:false},ledgerEntry:{projectId:'',note:''}}[entity])};
}
function apply(state,entity,action,ctx){
  const d=definitions[entity],data=references(state,entity,clone(action.data),ctx);
  let containerId=resolveContainer(action.containerId,ctx),before=null,current;
  if(action.operation!=='create'){
    current=locate(state,entity,action.id,containerId);containerId=current.containerId;before=clone(current.record);
    if(d.nested)owner(state,containerId,action.operation==='restore'||action.operation==='archive');
    if(action.operation==='update'&&before.archived)fail('请先恢复归档记录，再修改内容。');
  }
  const oldContainerId=containerId;
  if(data.targetContainerId!==undefined){if(!d.nested)fail('此对象不能移动。');containerId=resolveContainer(data.targetContainerId,ctx);delete data.targetContainerId;}
  if(d.nested)owner(state,containerId,action.operation==='archive'||action.operation==='restore');
  let after=before?clone(before):defaults(entity,ctx);
  if(action.operation==='archive'||action.operation==='restore')after.archived=action.operation==='archive';
  else{
    if(entity==='file'&&data.blobId!==undefined){const file=uploadedFile(state,data.blobId,ctx.requestId);Object.assign(after,{blobId:file.blobId,name:file.name,size:file.size||0,type:file.type||''});}
    if(entity==='capture'&&data.blobId!==undefined){const file=uploadedFile(state,data.blobId,ctx.requestId);Object.assign(after,{fileName:file.name,fileType:file.type||''});}
    if(entity==='ledgerEntry'&&data.amount!==undefined){after.amountCents=parseAmount(data.amount);delete data.amount;}
    Object.assign(after,data);
    if(entity==='space'&&action.operation==='create'&&data.type==='fitness'&&data.fitnessEnabled===undefined)after.fitnessEnabled=true;
    if(action.operation==='create'&&entity!=='ledgerEntry')after.color=ctx.assignColor(state,data.color);
    if(entity==='task'&&data.done!==undefined)after.completedAt=data.done?(before?.completedAt||ctx.now):null;
    if(entity==='note'&&before&&(data.title!==undefined||data.content!==undefined||data.chapter!==undefined)){
      after.revisions=[...(before.revisions||[]),{title:before.title,content:before.content||'',chapter:before.chapter||'',source:before.source||'',updatedAt:before.updatedAt||ctx.now,savedAt:ctx.now,example:!!before.example}].slice(-1000);
    }
  }
  after.updatedAt=ctx.now;after=validateCoreRecord(entity,after);
  if(before){const prior=collection(state,entity,oldContainerId,false,true);const index=prior.findIndex(row=>row.id===before.id);prior.splice(index,1);}
  const target=collection(state,entity,containerId,true,true);if(target.some(row=>row.id===after.id))fail('目标中已有同编号记录。');target.unshift(after);
  if(d.ledger)state.ledger=validateLedger(state.ledger);
  const finalContainer=d.nested?containerId:entity==='ledgerEntry'?(after.projectId?'ledger:'+after.projectId:'ledger'):'workspace';
  return {entity,operation:action.operation,id:after.id,containerId:finalContainer,...(d.nested&&before&&oldContainerId!==containerId?{beforeContainerId:oldContainerId}:{}),before,after:clone(after)};
}
function containerBoards(state,entity,record,source=state){
  if(!['space','course'].includes(entity))return [];
  const prefix=`${entity}:${record.id}:`,parents=source[definitions[entity].collection]||[];
  // IDs may contain colons. A similarly named, distinct container owns its own boards.
  return Object.entries(state.boards||{}).filter(([key])=>key.startsWith(prefix)&&!parents.some(parent=>parent.id!==record.id&&parent.id.startsWith(record.id+':')&&key.startsWith(`${entity}:${parent.id}:`)));
}
function automaticBoard(key,board,entity,record,source){
  const section=key.slice(`${entity}:${record.id}:`.length),sections=entity==='space'?['workbench','overview','notes','files','tasks']:['notes','files'];
  if(!sections.includes(section)||!object(board))return false;
  // Browsing initializes geometry without marking customization. A missing flag
  // alone is insufficient: preserve legacy/unrecognized layouts conservatively.
  if(Object.keys(board).some(key=>!['cards','snap','initialized','view','stackPointer','customized'].includes(key))||board.customized||board.snap===false)return false;
  if(board.stackPointer!==undefined&&board.stackPointer!==.5)return false;
  if(board.view!==undefined){
    const view=board.view,close=(a,b)=>Number.isFinite(a)&&Math.abs(a-b)<1e-7;
    if(!object(view)||Object.keys(view).some(key=>!['x','y','zoom'].includes(key)))return false;
    const initial=Number.isFinite(view.zoom)&&view.zoom>=.55&&view.zoom<=1&&close(view.x,28-36*view.zoom)&&close(view.y,30-40*view.zoom);
    if(!initial&&!(!board.initialized&&close(view.x,0)&&close(view.y,0)&&view.zoom===1))return false;
  }
  const cards=board.cards??[];if(!Array.isArray(cards))return false;
  if(section==='workbench'){
    // The space's first tab uses a different preset from its content boards.
    // Recompute the real, untouched catalogue, including hidden built-in cards,
    // rather than treating every workbench board as disposable.
    const boards={...source.boards};delete boards[key];
    let expected;try{expected=spaceWorkbenchLayout({...source,boards},record.id).cards;}catch{return false;}
    return cards.length===expected.length&&cards.every((card,index)=>{
      if(!object(card)||Object.keys(card).some(field=>!['id','x','y','w','h','color'].includes(field)))return false;
      const preset=expected[index];
      return card.id===preset.id&&['x','y','w','h'].every(field=>card[field]===preset[field])
        &&typeof card.color==='string'&&card.color.toUpperCase()===preset.color.toUpperCase();
    });
  }
  if(!cards.length)return true;
  const parent=source[definitions[entity].collection]?.find(parent=>parent.id===record.id);
  const summaries=[{id:'notes',color:'#AE88FF'},{id:'files',color:'#63E6DC'},{id:'tasks',color:'#D8F649'},{id:'assistant',color:'#FF9CCE'}];
  const items=section==='overview'?summaries:section==='tasks'?(source.tasks||[]).filter(task=>task.spaceId===record.id):parent?.[section]||[];
  if(section==='overview'&&cards.length!==summaries.length)return false;
  const palette=[entity==='course'?'#B3A0FF':'#AE88FF','#63E6DC','#FF9CCE','#D8F649','#9DC5FF','#FFBC7C'];
  return cards.every((card,index)=>{
    if(!object(card)||Object.keys(card).some(key=>!['id','x','y','w','h','color'].includes(key)))return false;
    const item=items.find(item=>item.id===card.id);
    if(!item||section==='overview'&&summaries[index].id!==card.id)return false;
    const expectedColor=item.color||palette[index%palette.length];
    // These are mountCanvas's untouched collection presets, before user edits.
    return card.x===36+(index%3)*380&&card.y===40+Math.floor(index/3)*366&&card.w===340&&card.h===330&&typeof card.color==='string'&&card.color.toUpperCase()===expectedColor.toUpperCase();
  });
}
function dependent(state,entity,record,source=state){
  const boardDependency=containerBoards(state,entity,record,source).some(([key,board])=>!automaticBoard(key,board,entity,record,source));
  if(entity==='space')return !!((state.spaces||[]).some(space=>space.parentId===record.id)||(state.customBlocks?.items||[]).some(block=>block.spaceId===record.id)||record.notes?.length||record.files?.length||(state.tasks||[]).some(row=>row.spaceId===record.id)||(state.fitness?.entries||[]).some(row=>row.spaceId===record.id)||boardDependency);
  if(entity==='course')return !!(record.notes?.length||record.files?.length||boardDependency);
  if(entity==='ledgerProject')return !!state.ledger?.entries?.some(row=>row.projectId===record.id);
  return false;
}
function undo(state,entity,snapshot,ctx={}){
  let row;try{row=locate(state,entity,snapshot.id,snapshot.containerId);}catch{return false;}
  if(!sameRecord(entity,row.record,snapshot.after))return false;
  const source=ctx.undoSource||state;
  if(snapshot.before===null&&dependent(state,entity,row.record,source))return false;
  const restoreContainer=snapshot.beforeContainerId||snapshot.containerId;
  if(snapshot.before&&definitions[entity].nested){try{owner(state,restoreContainer,true);}catch{return false;}}
  if(snapshot.before&&entity==='ledgerEntry'&&snapshot.before.projectId&&!state.ledger?.projects?.some(p=>p.id===snapshot.before.projectId))return false;
  const from=collection(state,entity,snapshot.containerId,false,true),index=from.findIndex(record=>record.id===snapshot.id);
  if(snapshot.before){const target=collection(state,entity,restoreContainer,true,true);if(target!==from&&target.some(r=>r.id===snapshot.id))return false;from.splice(index,1);target.unshift(clone(snapshot.before));}else{
    from.splice(index,1);
    for(const [key] of containerBoards(state,entity,row.record,source))delete state.boards[key];
  }
  if(definitions[entity].ledger)state.ledger=validateLedger(state.ledger);return true;
}
export const CORE_ACTION_ADAPTERS=Object.fromEntries(Object.entries(definitions).map(([entity,d])=>[entity,{
  label:d.label,operations:['create','update','archive','restore'],
  capability:`可create新建、update修改、archive归档、restore恢复${d.label}；不永久删除。create不带id（系统生成），update/archive/restore必须带查询到的真实id，archive/restore的data为{}；update只传要改的字段。${schemaDescriptions[entity]}${entity==='ledgerEntry'?'': 'color可选#RRGGBB字符串，仅用户明确指定颜色时填写；省略由系统随机选择且不重复上一次颜色。'}`,
  normalizeData(data,operation){if(!object(data))fail('行动data必须是对象。');if(Object.keys(data).some(key=>!Object.hasOwn(d.fields,key)))fail(`${d.label}行动包含不支持字段。`);if(['archive','restore'].includes(operation)&&Object.keys(data).length)fail('归档／恢复无需data字段。');const result=Object.fromEntries(Object.entries(data).map(([key,value])=>[key,d.fields[key](value)]));if(operation==='create'&&d.required.some(key=>result[key]===undefined))fail(`${d.label}新建缺少${d.required.join('、')}。`);if(operation==='create'&&result.targetContainerId)fail('新建请使用containerId指定位置。');if(operation==='update'&&!Object.keys(result).length)fail('修改行动需要至少一个字段。');return result;},
  list:state=>list(state,entity),apply:(state,action,ctx)=>apply(state,entity,action,ctx),undo:(state,snapshot,ctx)=>undo(state,entity,snapshot,ctx),validateRecord:record=>validateCoreRecord(entity,record),
}]));
