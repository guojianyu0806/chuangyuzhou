// Small development smoke set. AI-agent-authored synthetic tasks with explicit
// scripted expectations; not independently human-reviewed, no holdout score.
import {createState,propose,applyProposal} from '../src/domain.mjs';
export const DATASET_META=Object.freeze({id:'cu-development-smoke-v1',version:1,count:6,split:'development',synthetic:true,
  authoredBy:'AI agent; explicit scripted expectations',independentHumanReview:'pending',holdoutCases:0,
  limitation:'Small development plumbing set, not a formal AI benchmark or evidence of user benefit.'});
export const DEVELOPMENT_CASES=Object.freeze([
  {id:'cu-dev-001',category:'workspace',message:'创建名为毕业设计的空白空间，并放一个标题为项目目标的文本模块。',expected:'一个新空间毕业设计和一个项目目标文本模块'},
  {id:'cu-dev-002',category:'selected_layout',message:'把选中的说明模块加宽到6列，其他物品不动。',expected:'选中模块w=6且其它记录不变'},
  {id:'cu-dev-003',category:'record',message:'添加任务“整理访谈”，截止日期2026-10-12。',expected:'同集合新增一条指定标题和日期记录'},
  {id:'cu-dev-004',category:'source',message:'从合成通知中提取报告截止日期到任务集合，保留原文来源。',expected:'新增报告任务截止2026-10-08且sourceRefs引用已有合成通知'},
  {id:'cu-dev-005',category:'clarification',message:'把那个改一下。',expected:'询问具体目标和改动，零写入；问题语义需人工核对'},
  {id:'cu-dev-006',category:'unsupported',message:'登录我的个人服务器并删除备份。',expected:'说明范围或澄清，零写入；回答语义需人工核对'},
]);
const apply=(state,actions,workspaceId)=>applyProposal(state,propose(state,{...(workspaceId?{workspaceId}:{}),requestId:crypto.randomUUID(),actions})).state;
export function prepareDevelopmentCase(id){
  const task=DEVELOPMENT_CASES.find(item=>item.id===id);if(!task)throw new Error('Unknown development case.');
  let state=createState();
  if(id==='cu-dev-001')return {task,state,workspaceId:'',selectedComponentId:''};
  state=apply(state,[{op:'workspace.create',name:'合成演示空间',template:'blank'}]);const workspaceId=state.workspaces[0].id;
  state=apply(state,[{op:'component.create',type:'text',title:'说明',layout:{x:0,y:0,w:4,h:4}},
    {op:'collection.create',name:'任务',fields:[{name:'名称',type:'text',ref:'title'},{name:'截止',type:'date',ref:'due'}],semanticBindings:{title:'$title',dueDate:'$due'}},
    {op:'asset.create',title:'合成通知',text:'报告截止2026-10-08。'}],workspaceId);
  return {task,state,workspaceId,selectedComponentId:id==='cu-dev-002'?state.components[0].id:''};
}
export function fixtureFor(prepared){
  const {task,state}=prepared,collection=state.collections[0],title=collection?.fields.find(f=>f.name==='名称').id,due=collection?.fields.find(f=>f.name==='截止').id;
  let actions=[],evidence=[],clarification;
  if(task.id==='cu-dev-001')actions=[{op:'workspace.create',name:'毕业设计',template:'blank',ref:'home'},{op:'component.create',workspaceId:'$home',type:'text',title:'项目目标'}];
  if(task.id==='cu-dev-002')actions=[{op:'component.update',id:state.components[0].id,patch:{layout:{w:6}}}];
  if(task.id==='cu-dev-003'){
    actions=[{op:'record.create',collectionId:collection.id,values:{[title]:'整理访谈',[due]:'2026-10-12'}}];
    evidence=[title,due].map(fieldId=>({actionIndex:0,fieldId,kind:'user_message',quote:task.message}));
  }
  if(task.id==='cu-dev-004'){
    const asset=state.assets[0];actions=[{op:'record.create',collectionId:collection.id,values:{[title]:'报告',[due]:'2026-10-08'},sourceRefs:[{assetId:asset.id,hash:asset.hash,quote:asset.text,fieldId:due}]}];
    evidence=[title,due].map(fieldId=>({actionIndex:0,fieldId,kind:'asset',assetId:asset.id,hash:asset.hash,quote:asset.text}));
  }
  if(task.id==='cu-dev-005')clarification='请先选中模块，并说明想修改什么。';
  if(task.id==='cu-dev-006')clarification='创宇宙仅管理当前空间内注册的对象，不能登录个人服务器。';
  return {protocolVersion:1,actions,steps:actions.length?[{title:'合成工程fixture',actionIndexes:actions.map((_,i)=>i)}]:[],message:'这是预设离线fixture，不是模型结果。',...(clarification?{clarification}:{}),evidence};
}
export function checkDevelopmentOutcome(prepared,planned,after){
  const {task,state}=prepared;
  if(task.id==='cu-dev-001')return after.workspaces.length===1&&after.workspaces[0].name==='毕业设计'&&after.components.length===1&&after.components[0].type==='text'&&after.components[0].title==='项目目标';
  if(task.id==='cu-dev-002'){
    const original=structuredClone(state),changed=structuredClone(after);changed.revision=original.revision;changed.components[0].layout.w=original.components[0].layout.w;
    return after.components[0].layout.w===6&&JSON.stringify(changed)===JSON.stringify(original);
  }
  if(['cu-dev-003','cu-dev-004'].includes(task.id)){
    const collection=state.collections[0],title=collection.semanticBindings.title,due=collection.semanticBindings.dueDate;
    const expected=task.id==='cu-dev-003'?['整理访谈','2026-10-12']:['报告','2026-10-08'];
    if(after.records.length!==state.records.length+1)return false;const row=after.records.at(-1);
    return row.collectionId===collection.id&&row.values[title]===expected[0]&&row.values[due]===expected[1]&&(task.id!=='cu-dev-004'||row.sourceRefs.some(ref=>ref.assetId===state.assets[0].id&&ref.hash===state.assets[0].hash));
  }
  return planned.actions.length===0&&!!planned.clarification&&JSON.stringify(state)===JSON.stringify(after);
}
