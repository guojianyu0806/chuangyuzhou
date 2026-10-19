// Competition actions are applied only inside the reviewed workspace transaction.
import {validateCompetitionItem,validateCompetitionMilestone,validateCompetitionTask,validateCompetitions,COMPETITION_STATUSES} from './competitions-model.js';
import {isValidDate} from './ledger-model.js';

const fail=message=>{throw new Error(message);};
const clone=value=>structuredClone(value);
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const text=(value,max,required=false)=>{if(typeof value!=='string'||value.length>max||(required&&!value.trim()))fail('比赛行动文字缺失或过长。');return value.trim();};
const bool=value=>{if(typeof value!=='boolean')fail('比赛完成状态须为true或false。');return value;};
const day=value=>{if(!isValidDate(value))fail('比赛日期须为真实的YYYY-MM-DD。');return value;};
const time=value=>{if(value!==''&&(typeof value!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)))fail('比赛时间须为HH:mm，未知时留空。');return value;};
const color=value=>{if(typeof value!=='string'||!/^#[\da-f]{6}$/i.test(value))fail('卡片颜色须为#RRGGBB。');return value;};
const url=value=>{text(value,2000);if(value){let parsed;try{parsed=new URL(value);}catch{fail('比赛链接须为有效网址。');}if(!['https:','http:'].includes(parsed.protocol)||parsed.username||parsed.password)fail('比赛链接仅支持不含登录凭据的HTTP或HTTPS网址。');}return value;};
const status=value=>{if(!Object.hasOwn(COMPETITION_STATUSES,value))fail('比赛状态无效。');return value;};
const operations=['create','update','archive','restore'];
const dataOf=state=>state.competitions||{version:1,items:[],milestones:[],tasks:[]};
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const equal=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const itemRules={title:v=>text(v,120,true),organizer:v=>text(v,120),category:v=>text(v,80),url,team:v=>text(v,2000),requirements:v=>text(v,12000),notes:v=>text(v,12000),status,color};
const milestoneRules={title:v=>text(v,120,true),date:day,time,done:bool};
const taskRules={title:v=>text(v,120,true),date:v=>v===''?'':day(v),notes:v=>text(v,4000),done:bool};
function normalize(data,operation,rules,required){
  if(!plain(data)||!operations.includes(operation))fail('比赛行动格式无效。');
  if(Object.keys(data).some(key=>!Object.hasOwn(rules,key)))fail('比赛行动包含不支持字段。');
  if(['archive','restore'].includes(operation)){if(Object.keys(data).length)fail('归档或恢复的data应为空。');return {};}
  const result=Object.fromEntries(Object.entries(data).map(([key,value])=>[key,rules[key](value)]));
  if(operation==='create'&&required.some(key=>result[key]===undefined))fail('请补充比赛行动所需的名称或日期。');
  if(operation==='update'&&!Object.keys(result).length)fail('请指定需要修改的比赛信息。');
  return result;
}
function replace(state,collection,id,after){
  const data=dataOf(state),rows=data[collection];
  const next=after===null?rows.filter(row=>row.id!==id):rows.some(row=>row.id===id)?rows.map(row=>row.id===id?after:row):[after,...rows];
  state.competitions=validateCompetitions({...data,[collection]:next});
}
function adapter({entity,label,collection,rules,required,validateRecord,defaults,fields,capability}){
  const isParent=entity==='competition';
  return {
    label,operations,fields,capability,validateRecord,
    normalizeData:(data,operation)=>normalize(data,operation,rules,required),
    list:state=>dataOf(state)[collection].map(record=>({id:record.id,containerId:isParent?'':record.competitionId,title:record.title,record})),
    apply(state,action,ctx){
      const data=normalize(action.data||{},action.operation,rules,required),workspace=dataOf(state);
      if(isParent&&action.containerId!==undefined)fail('比赛本身无需指定containerId。');
      if(!isParent&&!action.containerId)fail('比赛节点和任务必须指定所属比赛containerId。');
      const containerId=isParent?'':ctx.resolveReference(action.containerId,['competition']);
      const parent=isParent?null:workspace.items.find(row=>row.id===containerId);
      if(!isParent&&(!parent||parent.archived))fail('所属比赛不存在或已归档，请先恢复比赛。');
      const before=action.operation==='create'?null:workspace[collection].find(row=>row.id===action.id);
      if(action.operation!=='create'&&!before)fail('要操作的比赛记录不存在。');
      if(before&&!isParent&&before.competitionId!==containerId)fail('记录不属于指定比赛，不能跨比赛修改。');
      if(before?.archived&&action.operation==='update')fail('请先恢复比赛记录，再修改内容。');
      let after=before?clone(before):{id:ctx.uid(),...defaults,...data,...(!isParent?{competitionId:containerId}:{color:ctx.assignColor(state,data.color)}),archived:false,createdAt:ctx.now,updatedAt:ctx.now,...(ctx.requestId?{sourceRequestId:ctx.requestId}:{})};
      if(['archive','restore'].includes(action.operation))after.archived=action.operation==='archive';
      else Object.assign(after,data);
      after.updatedAt=ctx.now;after=validateRecord(after);replace(state,collection,after.id,after);
      return {entity,operation:action.operation,id:after.id,containerId,before:before?clone(before):null,after:clone(after)};
    },
    undo(state,snapshot){
      const workspace=dataOf(state),current=workspace[collection].find(row=>row.id===snapshot.id);
      if(!current||!equal(current,snapshot.after)||(!isParent&&current.competitionId!==snapshot.containerId))return false;
      if(snapshot.before===null&&isParent&&[...workspace.milestones,...workspace.tasks].some(row=>row.competitionId===snapshot.id))return false;
      if(!isParent&&!workspace.items.some(row=>row.id===current.competitionId))return false;
      replace(state,collection,snapshot.id,snapshot.before===null?null:validateRecord(snapshot.before));return true;
    },
  };
}
export const COMPETITION_ACTION_ADAPTERS={
  competition:adapter({entity:'competition',label:'比赛',collection:'items',rules:itemRules,required:['title'],validateRecord:validateCompetitionItem,
    defaults:{organizer:'',category:'',url:'',team:'',requirements:'',notes:'',status:'watching'},
    fields:{organizer:'主办方',category:'比赛类别',url:'官方或资料链接',team:'团队信息',requirements:'参赛要求',notes:'比赛备注',status:'比赛状态'},
    capability:'create/update/archive/restore比赛。data.title必填非空≤120字；organizer主办方≤120字、category类别≤80字、url为空或http/https网址≤2000字、team团队文字≤2000字、requirements要求及notes备注各≤12000字。status=watching|preparing|submitted|finished（关注中/准备中/已提交/已结束，默认watching），未知信息默认空串；不得编造官方信息。color仅用户手选才填#RRGGBB，否则省略由程序随机。比赛本身不填containerId；用ref供后续节点或任务引用。不能把milestones/tasks数组塞入data，也不能指定新id。归档仅隐藏父比赛、不删除子项；恢复后可继续编辑。归档/恢复data为空。'}),
  competitionMilestone:adapter({entity:'competitionMilestone',label:'比赛节点',collection:'milestones',rules:milestoneRules,required:['title','date'],validateRecord:validateCompetitionMilestone,
    defaults:{time:'',done:false},fields:{competitionId:'所属比赛',date:'节点日期（北京时间）',time:'节点时间（北京时间）',done:'节点已完成'},
    capability:'create/update/archive/restore比赛节点；containerId必须为已有未归档比赛真实id或前序competition创建的$ref。create data.title必填非空≤120字，date必填真实YYYY-MM-DD，time可选HH:mm或空串（默认空，日期当天结束前不逾期），done布尔默认false。官方日期/精确时间须有用户提供通知依据，否则先追问；仅有日期不得猜时间。自定计划名称明确自定，不能冒充官方截止。数据没有颜色或notes字段；需要细则改父比赛备注。不支持移动到另一比赛；归档/恢复data为空，父比赛归档后先恢复父对象。'}),
  competitionTask:adapter({entity:'competitionTask',label:'比赛任务',collection:'tasks',rules:taskRules,required:['title'],validateRecord:validateCompetitionTask,
    defaults:{date:'',notes:'',done:false},fields:{competitionId:'所属比赛',date:'任务计划日期',notes:'任务说明',done:'任务已完成'},
    capability:'create/update/archive/restore比赛任务；containerId必须为已有未归档比赛真实id或前序competition创建的$ref。create data.title必填非空≤120字；date为YYYY-MM-DD或空串（默认空，不知道就留空），notes说明≤4000字默认空，done布尔默认false。不得把建议任务标成已完成。比赛任务独立于全局待办，不会自动复制日历；不支持修改competitionId或移动归属。任务无颜色字段；归档/恢复data为空，父比赛归档后先恢复父对象。'}),
};
