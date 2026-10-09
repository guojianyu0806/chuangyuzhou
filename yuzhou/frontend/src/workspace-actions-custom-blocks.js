import {getCustomBlocks,validateCustomBlock,validateCustomBlockConfig,createCustomBlock,updateCustomBlock,validateBlockData} from './custom-blocks-model.js';
const clone=value=>structuredClone(value),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const fail=message=>{throw new Error(message);};
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
function normalizeData(data,operation){
  if(!plain(data))fail('自定义方块行动内容无效。');
  if(['archive','restore'].includes(operation)){if(Object.keys(data).length)fail('归档或恢复无需内容字段。');return {};}
  const allowed=['title','description','color','config','data',...(operation==='create'?['kind']:[])];
  if(Object.keys(data).some(key=>!allowed.includes(key))||!Object.keys(data).length)fail('自定义方块行动包含不支持的字段。');
  if(operation==='create'&&(!data.kind||!data.title||data.config===undefined))fail('新建方块需要 kind、title 和 config。');
  // Full record validation on the isolated transaction also checks config against the actual kind.
  if(data.data!==undefined)validateBlockData(data.data);
  if(operation==='create')validateCustomBlockConfig(data.kind,data.config);
  return clone(data);
}
const adapter={label:'自定义方块',operations:['create','update','archive','restore'],fields:{kind:'方块类型',title:'名称',description:'用途说明',config:'方块配置与内容',data:'本方块私有数据'},
  capability:'create/update/archive/restore。create必填kind(note/checklist/links/progress/countdown/table/miniapp)、title、config；可description/color/data。id由程序生成block:前缀；update先get查询真实id，kind不能修改，config整包更新而data默认保留，显式data替换必须基于已完整查询的原数据。配置：note={text}; checklist={items:[{id,label,done}]}; links={items:[{id,label,url:HTTP(S)}]}; progress={value,target:正数,unit}; countdown={date:YYYY-MM-DD}; table={columns:[{id,label}],rows:[{id,cells:[字符串]}]}; miniapp={code:最多30000字符的JS}。data是本方块私有JSON对象≤64KiB/深度10，默认{}。最多50块，列表100条，表格10列100行。归档恢复data为空对象，不永久删除。miniapp只可调用app.getData()/await app.setData(next)/app.render(nodes)，设置app.onEvent=async(event)=>...；event={id,type:click|change,value,values}。nodes数组，每个type为heading/text/metric/input/number/select/button/progress/row/column/divider，字段仅id/label/text/value/options/min/max/children等受控属性，最多200节点深度8；不支持HTML、CSS、URL、DOM、网络、账号、密钥或其他方块访问。生成代码只在隔离Worker运行，创建或改代码同样必须先审核确认。',
  normalizeData,validateRecord:validateCustomBlock,
  list:state=>getCustomBlocks(state).items.map(record=>({id:record.id,containerId:'',title:record.title,record})),
  apply(state,action,ctx){
    if(action.containerId)fail('自定义方块不支持其他容器。');const data=normalizeData(action.data,action.operation);let before=null,after;
    if(action.operation==='create')after=createCustomBlock(state,{...data,sourceRequestId:ctx.requestId},{id:`block:${ctx.uid()}`,now:ctx.now});
    else{
      before=getCustomBlocks(state).items.find(item=>item.id===action.id);if(!before)fail('自定义方块不存在。');
      if(action.operation==='update'&&before.archived)fail('请先恢复归档的方块。');
      after=updateCustomBlock(state,action.id,['archive','restore'].includes(action.operation)?{archived:action.operation==='archive'}:data);
      after.updatedAt=ctx.now;state.customBlocks.items[state.customBlocks.items.findIndex(item=>item.id===after.id)]=validateCustomBlock(after);
    }
    return {entity:'customBlock',operation:action.operation,id:after.id,containerId:'',before,after:clone(after)};
  },
  undo(state,item){
    const current=getCustomBlocks(state),index=current.items.findIndex(record=>record.id===item.id);if(index<0||!same(current.items[index],item.after))return false;
    if(item.before===null)current.items.splice(index,1);else current.items[index]=validateCustomBlock(item.before);
    state.customBlocks=current;return true;
  },
};
export const CUSTOM_BLOCK_ACTION_ADAPTERS=Object.freeze({customBlock:adapter});
