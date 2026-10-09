import {WORKBENCH_MODULES,createWorkbench,validateWorkbench,configureWorkbench} from './workbench-model.js';

const fail=message=>{throw new Error(message);};
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const moduleIds=()=>WORKBENCH_MODULES.map(module=>module.id);
const read=state=>validateWorkbench(state.workbench??createWorkbench('full'));
function shape(value,keys,required=keys){
  if(!plain(value)||Object.keys(value).some(key=>!keys.includes(key))||required.some(key=>!Object.hasOwn(value,key)))fail('工作台设置格式无效。');
  return value;
}
function title(value){if(typeof value!=='string'||!value.trim()||value.length>80||/[\u0000-\u001f\u007f]/.test(value))fail('工作台名称须为1至80个可见字符。');return value.trim();}
function moduleTitle(value){const result=title(value);if(value.length>60)fail('板块名称不能超过60个字符。');return result;}
function enabled(value){if(typeof value!=='boolean')fail('板块显示状态无效。');return value;}
function position(value){if(!Number.isSafeInteger(value)||value<0||value>=moduleIds().length)fail('板块位置超出范围。');return value;}
function moduleId(value){if(!moduleIds().includes(value))fail('只能操作物品库中的现有板块。');return value;}
function normalize(data,operation,rules){
  if(operation!=='update')fail('工作台配置只支持修改。');shape(data,Object.keys(rules),[]);
  if(!Object.keys(data).length)fail('请指定需要修改的配置。');
  return Object.fromEntries(Object.entries(data).map(([key,value])=>[key,rules[key](value)]));
}
function moduleRecord(value){
  shape(value,['id','title','enabled','position','configuration']);
  const record={id:moduleId(value.id),title:moduleTitle(value.title),enabled:enabled(value.enabled),position:position(value.position),configuration:validateWorkbench(value.configuration)};
  const target=record.configuration.modules[record.position];
  if(target.id!==record.id||target.title!==record.title||target.enabled!==record.enabled)fail('板块配置快照与显示字段不一致。');
  return record;
}
function readModule(state,id){
  const config=read(state),index=config.modules.findIndex(module=>module.id===moduleId(id));
  return moduleRecord({...config.modules[index],position:index,configuration:config});
}
function snapshot(entity,action,before,after){return {entity,operation:action.operation,id:action.id,containerId:'',before,after};}
const settings={label:'工作台名称',operations:['update'],fields:{title:'工作台名称'},
  capability:'仅update，id=workbench，data:{title:工作台名称}。更改工作台名称，不改个人身份、登录、密钥或业务记录。',
  normalizeData:(data,operation)=>normalize(data,operation,{title}),
  validateRecord(value){shape(value,['title','configuration']);const configuration=validateWorkbench(value.configuration);if(title(value.title)!==configuration.title)fail('工作台名称快照不一致。');return {title:configuration.title,configuration};},
  list:state=>[{id:'workbench',containerId:'',title:'工作台名称',record:{title:read(state).title}}],
  apply(state,action){if(action.id!=='workbench'||action.containerId)fail('工作台名称目标无效。');const data=this.normalizeData(action.data,action.operation),config=read(state),before={title:config.title,configuration:config};configureWorkbench(state,data);const after=read(state);return snapshot('workbenchSettings',action,before,{title:after.title,configuration:after});},
  undo(state,item){const before=this.validateRecord(item.before),after=this.validateRecord(item.after);if(item.id!=='workbench'||!same(read(state),after.configuration))return false;state.workbench=before.configuration;return true;},
};
const modules={label:'工作台板块',operations:['update'],fields:{title:'板块名称',enabled:'显示板块',position:'排列位置'},
  capability:'仅update，id须查询workbenchModule所得的固定板块id，data:{enabled:布尔,title:显示名称,position:从0开始的完整板块序号}，至少一个字段。enabled:false仅隐藏入口，保留业务内容；AI板块必须可见。position会移动该板块并保留其他板块相对顺序。自定义空间使用space行动；卡片摆放使用canvasCard或canvasSettings。',
  normalizeData:(data,operation)=>normalize(data,operation,{title:moduleTitle,enabled,position}),validateRecord:moduleRecord,
  list:state=>read(state).modules.map((module,position)=>({id:module.id,containerId:'',title:module.title,record:{...module,position}})),
  apply(state,action){if(action.containerId)fail('顶级板块不能指定所属位置。');const data=this.normalizeData(action.data,action.operation),before=readModule(state,action.id);configureWorkbench(state,{moduleId:action.id,...(data.title===undefined?{}:{moduleTitle:data.title}),...(data.enabled===undefined?{}:{enabled:data.enabled}),...(data.position===undefined?{}:{position:data.position})});return snapshot('workbenchModule',action,before,readModule(state,action.id));},
  undo(state,item){const before=moduleRecord(item.before),after=moduleRecord(item.after);if(item.id!==before.id||item.id!==after.id||!same(read(state),after.configuration))return false;
    state.workbench=before.configuration;return true;
  },
};
export const PLATFORM_ACTION_ADAPTERS=Object.freeze({workbenchSettings:settings,workbenchModule:modules});
