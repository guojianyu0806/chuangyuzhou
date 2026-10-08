// Scripted DEVELOPMENT replies only. These are not predictions or measured AI results.
// Never used in live mode, and never used as a reason to bypass domain validation.
export function fixturePlatformPlan(task,state){
  let actions=[],clarification;
  const evidence=[];
  const set=(id,patch)=>({op:'component.update',id,patch});
  const id=task.id;
  switch(id){
    case 'cu-platform-dev-001':
      actions=[{op:'workspace.create',name:'阅读角',template:'blank',ref:'home'},{op:'component.create',workspaceId:'$home',type:'text',title:'阅读目标'}];break;
    case 'cu-platform-dev-002':
      actions=[{op:'workspace.create',name:'期末复习',template:'study'}];break;
    case 'cu-platform-dev-003':
      actions=[{op:'workspace.create',name:'志愿活动',template:'blank',ref:'home'},
        {op:'collection.create',workspaceId:'$home',name:'活动',ref:'activities',fields:[{name:'名称',type:'text',ref:'title'},{name:'状态',type:'select',ref:'status',options:[{label:'待办',ref:'todo'},{label:'完成',ref:'done'}]},{name:'日期',type:'date',ref:'date'}],semanticBindings:{title:'$title',status:'$status',dueDate:'$date',doneOptions:['$done']}},
        {op:'component.create',workspaceId:'$home',type:'list',title:'活动列表',binding:{collectionId:'$activities'}},
        {op:'component.create',workspaceId:'$home',type:'board',title:'活动看板',binding:{collectionId:'$activities',statusFieldId:'$status'}}];break;
    case 'cu-platform-dev-004':
      actions=[{op:'page.create',name:'资料页',ref:'resourcespage'},set('cmp_note',{pageId:'$resourcespage'}),set('cmp_resources',{pageId:'$resourcespage'})];break;
    case 'cu-platform-dev-005':
      actions=[{op:'template.import',template:structuredClone(task.attachments.find(a=>a.id==='portable-main-v1').content),name:'设计小组副本'}];break;
    case 'cu-platform-dev-006': actions=[set('cmp_resources',{layout:{x:0,y:14,w:4,h:4}})];break;
    case 'cu-platform-dev-007':
      // Move resources first: every intermediate proposal state must be valid too.
      actions=[set('cmp_resources',{layout:{x:0,y:10,w:4,h:4}}),set('cmp_list',{layout:{x:4,y:0,w:8,h:4}})];break;
    case 'cu-platform-dev-008': actions=[{op:'workspace.update',id:'w_main',patch:{preferences:{density:'compact',theme:'dark'}}}];break;
    case 'cu-platform-dev-009': actions=[set('cmp_resources',{props:{collapsed:true}})];break;
    case 'cu-platform-dev-010': actions=[set('cmp_list',{props:{filter:{fieldId:'f_status',operator:'eq',value:'o_todo'},sort:{fieldId:'f_due',direction:'asc'}}})];break;
    case 'cu-platform-dev-011':
      actions=[{op:'collection.field.add',id:'c_tasks',field:{name:'预计分钟',type:'number'},ref:'minutes'},{op:'record.update',id:'task_a',patch:{values:{'$minutes':30}}}];break;
    case 'cu-platform-dev-012': actions=[{op:'collection.field.update',id:'c_tasks',fieldId:'f_due',patch:{name:'提交日期'}}];break;
    case 'cu-platform-dev-013':
      actions=[{op:'collection.field.update',id:'c_tasks',fieldId:'f_status',patch:{options:[{id:'o_todo',label:'待启动'},{id:'o_doing',label:'进行中'},{id:'o_done',label:'完成'}]}}];break;
    case 'cu-platform-dev-014': actions=[{op:'record.update',id:'task_a',patch:{values:{f_due:'2026-10-20'}}}];break;
    case 'cu-platform-dev-015': actions=[{op:'record.archive',id:'task_b',archived:true}];break;
    case 'cu-platform-dev-016': actions=[{op:'component.create',type:'calendar',title:'截止总览',binding:{collectionId:'c_tasks',dateFieldId:'f_due'}}];break;
    case 'cu-platform-dev-017':
      actions=[{op:'collection.field.add',id:'c_tasks',field:{name:'关联说明',type:'relation',targetCollectionId:'c_refs'},ref:'reference'},{op:'record.update',id:'task_a',patch:{values:{'$reference':['ref_a']}}}];break;
    case 'cu-platform-dev-018': actions=[{op:'record.update',id:'task_a',patch:{assetIds:['asset_notice']}}];break;
    case 'cu-platform-dev-019':
    case 'cu-platform-dev-020': {
      const asset=state.assets.find(a=>a.id==='asset_notice');
      const values=id.endsWith('019')?{f_title:'设计评审',f_start:'2026-10-15T15:00',f_end:'2026-10-15T16:00'}:{f_title:'调研记录',f_due:'2026-10-20'};
      const quote=id.endsWith('019')?'设计评审于2026年10月15日15:00至16:00进行。':'截止要求：调研记录应于2026-10-20提交。';
      const sourceRefs=Object.keys(values).filter(fieldId=>fieldId!=='f_title').map(fieldId=>({assetId:asset.id,hash:asset.hash,quote,fieldId}));
      actions=[{op:'record.create',collectionId:'c_tasks',values,sourceRefs}];
      for(const fieldId of Object.keys(values))evidence.push({actionIndex:0,fieldId,kind:'asset',assetId:asset.id,hash:asset.hash,quote});
      break;
    }
    case 'cu-platform-dev-021': clarification='你指的是文本“说明”还是资料“说明”模块？希望修改标题、内容还是布局？';break;
    case 'cu-platform-dev-022': clarification='请提供当前基准日期和下周哪一天，或直接给出新的截止日期。';break;
    case 'cu-platform-dev-023': actions=[set('cmp_note',{title:'本周重点'})];break;
    case 'cu-platform-dev-024':
      actions=[{op:'collection.create',name:'临时清单',fields:[{name:'名称',type:'text',ref:'tempname'}],ref:'templist',semanticBindings:{title:'$tempname'}},{op:'component.create',type:'list',title:'临时列表',binding:{collectionId:'$templist'}}];break;
    default: {const error=new Error('此开发题尚无离线回放。');error.code='fixture_unavailable';throw error;}
  }
  // A literal user-instruction quote is sufficient for protocol plumbing; the
  // semantic correctness of every evidence mapping remains a human review item.
  actions.forEach((action,actionIndex)=>{
    const values=action.op==='record.create'?action.values:action.op==='record.update'?action.patch?.values:null;
    for(const fieldId of Object.keys(values||{}))if(!evidence.some(e=>e.actionIndex===actionIndex&&e.fieldId===fieldId))evidence.push({actionIndex,fieldId,kind:'user_message',quote:task.message});
  });
  return {protocolVersion:1,actions,steps:actions.length?[{title:'合成开发任务的离线预设方案',actionIndexes:actions.map((_,i)=>i)}]:[],message:clarification||'以下为待确认的离线预设方案。',...(clarification?{clarification}:{}),evidence};
}
