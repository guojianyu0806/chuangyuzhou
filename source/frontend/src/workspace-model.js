import {initializeLedger} from './ledger-model.js';
import {initializeTimetable} from './timetable-model.js';
export const SPACE_COLORS = ['#7950f2','#00b8b0','#ec4899','#b2cf18','#f58b35','#4088f4'];

export function initializeSpaces(state) {
  initializeLedger(state);
  initializeTimetable(state);
  if (!Array.isArray(state.spaces)) {
    const now = new Date().toISOString();
    state.spaces = state.mode === 'demo' ? [
      {id:'student-union',title:'学生会',description:'活动策划、部门会议与团队协作，把每件事安排妥当。',type:'affairs',color:'#00b8b0',icon:'users',example:true,archived:false,createdAt:now,updatedAt:now,files:[],notes:[{id:'union-note',title:'活动筹备清单',content:'这是一份示例，供你体验事务空间。\n\n## 先明确这几件事\n- 活动目的与参与对象\n- 场地、物料与人员分工\n- 宣传节奏和现场流程\n- 结束后的复盘与资料归档',source:'内置示例，未导入真实学生会资料',example:true,updatedAt:now,revisions:[]}]},
      {id:'personal-project',title:'自己的小宇宙',description:'个人项目、生活清单和突然冒出来的好点子。',type:'project',color:'#ec4899',icon:'star',example:true,archived:false,createdAt:now,updatedAt:now,files:[],notes:[]}
    ] : [];
  }
  state.aiRequests ||= [];
  state.aiDraft ||= {text:'',files:[],targetId:'auto'};
  state.ui ||= {sidebarPinned:false};
  state.workspaceVersion = 2;
  return state;
}

export function spaceLabel(state, targetId) {
  if (targetId.startsWith('space:')) return state.spaces.find(s=>s.id===targetId.slice(6))?.title || '工作区';
  if (targetId.startsWith('course:')) return state.courses.find(c=>c.id===targetId.slice(7))?.title || '课程';
  return {english:'六级资料',inbox:'收集箱',tasks:'备忘与待办'}[targetId] || '工作区';
}

export function openDestination(ctx, targetId) {
  if(targetId.startsWith('space:'))ctx.go('space',targetId.slice(6));
  else if(targetId.startsWith('course:'))ctx.go('courses',targetId.slice(7));
  else ctx.go(targetId==='english'?'english':targetId==='tasks'?'tasks':'inbox',targetId==='english'?'materials':'');
}

/** File only the original content explicitly assigned by the user. No simulated model work. */
export async function routeContent(ctx, {text='',files=[],targetId,requestId}) {
  const {state,uid,save}=ctx;
  if(!targetId || targetId==='auto')throw new Error('请先指定一个工作区；自动判断需要连接模型。');
  if(!text.trim()&&!files.length)throw new Error('请先写下内容或添加文件。');
  const existing=state.aiRequests.find(r=>r.id===requestId&&r.status==='filed'&&r.receipt);
  if(existing)return existing.receipt;
  const now=new Date().toISOString();
  const receipt={destinationId:targetId,destinationLabel:spaceLabel(state,targetId),createdAt:now,items:[]};
  const changes=[];
  const insert=(list,item)=>{list.unshift(item);changes.push(()=>{const index=list.indexOf(item);if(index>=0)list.splice(index,1);});};
  const record=(collection,containerId,item)=>{
    receipt.items.push({id:item.id,type:collection==='files'?'文件':collection==='notes'?'原文笔记':collection==='tasks'?'待办':'原文记录',title:item.title||item.name||item.text?.slice(0,60)||'记录',collection,containerId,snapshot:JSON.stringify(item)});
    return item;
  };
  const sourceRequestId=requestId||uid();
  if(targetId.startsWith('space:') || targetId.startsWith('course:')){
    const isSpace=targetId.startsWith('space:');
    const destination=(isSpace?state.spaces:state.courses).find(s=>s.id===targetId.slice(isSpace?6:7)&&!s.archived);
    if(!destination)throw new Error('这个空间已归档或不存在，请重新选择。');
    destination.notes ||= [];destination.files ||= [];
    if(text.trim())insert(destination.notes,record('notes',targetId,{id:uid(),title:text.trim().split('\n')[0].slice(0,55),content:text.trim(),source:'从 AI 收件台手动归档的原文，未进行模型整理',sourceRequestId,updatedAt:now,example:false,revisions:[]}));
    for(const file of files)insert(destination.files,record('files',targetId,{...file,id:uid(),sourceRequestId,createdAt:now}));
    const previousUpdatedAt=destination.updatedAt;changes.push(()=>{destination.updatedAt=previousUpdatedAt;});
    destination.updatedAt=now;
  }else{
    if(!['english','inbox','tasks'].includes(targetId))throw new Error('无法识别目标空间。');
    let firstCapture;
    const addCapture=(content,file)=>{
      const item={id:uid(),text:content,category:targetId==='english'?'英语':'备忘',tags:targetId==='english'?'六级资料':'AI 收件台',archived:false,createdAt:now,sourceRequestId,...(file?{blobId:file.blobId,fileName:file.name,fileType:file.type}:{})};
      insert(state.captures,record('captures','inbox',item));firstCapture ||= item.id;
    };
    if(text.trim())addCapture(text.trim());
    files.forEach(f=>addCapture(f.name,f));
    if(targetId==='tasks'){
      const item={id:uid(),title:(text.trim()||files[0]?.name||'处理新资料').split('\n')[0].slice(0,100),description:text.trim(),date:'',priority:'normal',category:'个人',done:false,source:'AI 收件台 · 手动归档',captureId:firstCapture,sourceRequestId,createdAt:now};
      insert(state.tasks,record('tasks','tasks',item));
    }
  }
  // Destination entries and their receipt are one persisted transaction.
  const request=state.aiRequests.find(r=>r.id===requestId);
  if(request){const previous={...request};changes.push(()=>{for(const key of Object.keys(request))if(!Object.hasOwn(previous,key))delete request[key];Object.assign(request,previous);});Object.assign(request,{receipt,status:'filed',updatedAt:now});}
  try{save();}catch(error){changes.reverse().forEach(rollback=>rollback());throw error;}
  return receipt;
}

export async function undoRoute(ctx, receipt, requestId) {
  let removed=0,retained=0;
  const changes=[];
  for(const item of receipt.items||[]){
    let list;
    if(item.collection==='tasks')list=ctx.state.tasks;
    else if(item.collection==='captures')list=ctx.state.captures;
    else{
      const isSpace=item.containerId?.startsWith('space:');
      const container=(isSpace?ctx.state.spaces:ctx.state.courses).find(s=>s.id===item.containerId?.slice(isSpace?6:7));
      list=container?.[item.collection];
    }
    if(!Array.isArray(list))continue;
    const index=list.findIndex(v=>v.id===item.id && v.sourceRequestId===requestId);
    if(index<0)continue;
    if(JSON.stringify(list[index])!==item.snapshot){retained++;continue;}
    // Original input and file blobs remain in the AI request, so this is reversible.
    const [entry]=list.splice(index,1);changes.push(()=>list.splice(index,0,entry));removed++;
  }
  const request=ctx.state.aiRequests.find(r=>r.id===requestId);
  if(request){const previous={...request};changes.push(()=>Object.assign(request,previous));request.status='waiting_model';request.receipt=undefined;request.updatedAt=new Date().toISOString();}
  try{ctx.save();}catch(error){changes.reverse().forEach(rollback=>rollback());throw error;}
  return {removed,retained};
}
