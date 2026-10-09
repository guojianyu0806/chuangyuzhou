// Shared, bounded platform configuration. Hiding a module never removes its data.
const freezeRows = rows => Object.freeze(rows.map(row => Object.freeze(row)));

export const WORKBENCH_MODULES = freezeRows([
  {id:'ai',title:'AI伙伴',description:'通过对话搭建、整理和操作工作台，重要修改先审核再执行。',icon:'sparkles',color:'#B3A0FF',category:'核心'},
  {id:'courses',title:'课程空间',description:'按课程或研究主题保存资料与笔记。',icon:'book',color:'#AE88FF',category:'学习'},
  {id:'english',title:'六级随身练',description:'词汇、阅读、听力和学习记录。',icon:'graduation',color:'#D8F649',category:'学习'},
  {id:'inbox',title:'灵感收集箱',description:'随手保存文字、链接和附件，稍后整理。',icon:'inbox',color:'#FF9CCE',category:'通用'},
  {id:'tasks',title:'备忘与待办',description:'记录要做的事，安排日期与优先级。',icon:'check-circle',color:'#63E6DC',category:'通用'},
  {id:'review',title:'生活回顾',description:'查看完成记录与学习活动。',icon:'chart',color:'#9DC5FF',category:'生活'},
  {id:'ledger',title:'记账',description:'管理日常收支与独立项目账本。',icon:'wallet',color:'#FFBC7C',category:'生活'},
  {id:'calendar',title:'日历',description:'安排计划、标注日期并查看关联事项。',icon:'calendar',color:'#FF9CCE',category:'通用'},
  {id:'timetable',title:'学期课表',description:'按教学周和节次管理上课安排。',icon:'timetable',color:'#8EDBE8',category:'学习'},
  {id:'competitions',title:'比赛',description:'跟踪截止节点、准备清单与参赛资料。',icon:'flag',color:'#D8F649',category:'项目'},
]);

const templates = [
  {id:'blank',title:'从空白开始',description:'只保留 AI伙伴，按自己的需要逐步添加模块。',moduleIds:['ai']},
  {id:'project',title:'项目推进',description:'从任务、日程、灵感和项目收支开始。',moduleIds:['ai','tasks','calendar','inbox','ledger']},
  {id:'research',title:'研究与创作',description:'围绕资料、笔记、灵感与推进计划搭建。',moduleIds:['ai','courses','inbox','tasks','calendar']},
  {id:'student',title:'学习与课程',description:'连接课程资料、学期课表、待办与英语练习。',moduleIds:['ai','courses','timetable','tasks','calendar','english']},
  {id:'life',title:'日常生活',description:'把日程、待办、收支和生活记录放在一起。',moduleIds:['ai','tasks','calendar','ledger','inbox','review']},
  {id:'full',title:'完整宇宙',description:'启用原宇宙的全部内置模块，保留完整个人工作台。',moduleIds:WORKBENCH_MODULES.map(module=>module.id)},
];
export const WORKBENCH_TEMPLATES = freezeRows(templates.map(template=>({...template,moduleIds:Object.freeze([...template.moduleIds])})));
const moduleById = new Map(WORKBENCH_MODULES.map(module=>[module.id,module]));
const templateById = new Map(WORKBENCH_TEMPLATES.map(template=>[template.id,template]));
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype,null].includes(Object.getPrototypeOf(value));
const fail = label => {throw new Error(`${label}无效。`);};
function fields(value, allowed, label) {
  if(!plain(value)||Object.keys(value).some(key=>!allowed.includes(key)))fail(label);
}
function name(value,label,limit) {
  if(typeof value!=='string'||!value.trim()||value.length>limit||/[\u0000-\u001f\u007f]/.test(value))fail(label);
  return value.trim();
}
function templateFor(id) {
  const template=templateById.get(id);
  if(!template)fail('工作台模板');
  return template;
}

/** Validate a configuration from storage, backup, or an action without changing it. */
export function validateWorkbench(value) {
  fields(value,['version','title','templateId','onboardingComplete','modules'],'工作台配置');
  if(value.version!==1)fail('工作台版本');
  const title=name(value.title,'工作台名称',80);
  templateFor(value.templateId);
  if(typeof value.onboardingComplete!=='boolean')fail('工作台搭建状态');
  if(!Array.isArray(value.modules)||value.modules.length!==WORKBENCH_MODULES.length)fail('工作台模块列表');
  const seen=new Set();
  const modules=value.modules.map(module=>{
    fields(module,['id','enabled','title'],'工作台模块');
    if(!moduleById.has(module.id)||seen.has(module.id))fail('工作台模块编号');
    seen.add(module.id);
    if(typeof module.enabled!=='boolean'||(module.id==='ai'&&!module.enabled))fail('模块显示状态');
    return {id:module.id,enabled:module.enabled,title:name(module.title,'模块名称',60)};
  });
  return {version:1,title,templateId:value.templateId,onboardingComplete:value.onboardingComplete,modules};
}

export function createWorkbench(templateId='blank') {
  const template=templateFor(templateId),enabled=new Set(template.moduleIds);
  const order=[...template.moduleIds,...WORKBENCH_MODULES.map(module=>module.id).filter(id=>!enabled.has(id))];
  return {version:1,title:'我的工作台',templateId,onboardingComplete:templateId!=='blank',modules:order.map(id=>({id,enabled:enabled.has(id),title:moduleById.get(id).title}))};
}

/** Legacy workspaces keep all modules; only an explicitly fresh seed starts blank. */
export function initializeWorkbench(state,{fresh=false}={}) {
  if(!plain(state))fail('工作区');
  if(state.workbench===undefined)state.workbench=createWorkbench(fresh?'blank':'full');
  else validateWorkbench(state.workbench);
  return state.workbench;
}

/** Read-only fallback for old workspaces, including AI context generation. */
export function getWorkbench(state) {
  return state?.workbench===undefined?createWorkbench('full'):validateWorkbench(state.workbench);
}

export function getVisibleModules(state) {
  return getWorkbench(state).modules.filter(module=>module.enabled).map(module=>({...moduleById.get(module.id),...module}));
}

/** Apply one validated settings change atomically. Position is a zero-based full-list index. */
export function configureWorkbench(state,patch) {
  if(!plain(state))fail('工作区');
  fields(patch,['title','moduleId','enabled','moduleTitle','position'],'工作台修改');
  if(!Object.keys(patch).length)fail('工作台修改');
  const hasModuleFields=['enabled','moduleTitle','position'].some(key=>Object.hasOwn(patch,key));
  if(hasModuleFields&&!Object.hasOwn(patch,'moduleId'))fail('待修改模块');
  const next=getWorkbench(state);
  if(Object.hasOwn(patch,'title'))next.title=name(patch.title,'工作台名称',80);
  if(Object.hasOwn(patch,'moduleId')){
    const index=next.modules.findIndex(module=>module.id===patch.moduleId);
    if(index<0||!hasModuleFields)fail('待修改模块');
    const module=next.modules[index];
    if(Object.hasOwn(patch,'enabled')){
      if(typeof patch.enabled!=='boolean'||(module.id==='ai'&&!patch.enabled))fail('模块显示状态');
      module.enabled=patch.enabled;
    }
    if(Object.hasOwn(patch,'moduleTitle'))module.title=name(patch.moduleTitle,'模块名称',60);
    if(Object.hasOwn(patch,'position')){
      if(!Number.isInteger(patch.position)||patch.position<0||patch.position>=next.modules.length)fail('模块位置');
      next.modules.splice(index,1);next.modules.splice(patch.position,0,module);
    }
  }
  next.onboardingComplete=true;
  state.workbench=validateWorkbench(next);
  return state.workbench;
}

/** Templates arrange modules only. All original records, files and card coordinates remain. */
export function applyWorkbenchTemplate(state,templateId) {
  if(!plain(state))fail('工作区');
  const current=getWorkbench(state),next=createWorkbench(templateId),titles=new Map(current.modules.map(module=>[module.id,module.title]));
  next.title=current.title;next.onboardingComplete=true;
  for(const module of next.modules)module.title=titles.get(module.id)||module.title;
  state.workbench=validateWorkbench(next);
  return state.workbench;
}
