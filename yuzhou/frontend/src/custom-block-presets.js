// Public starter structures: no personal records or completed activity is fabricated.
const calculator=`let state = {a:0,b:0,op:'add',result:'',...app.getData()};
function draw(){app.render([
 {type:'heading',text:'随手计算'},
 {type:'number',id:'a',label:'第一个数',value:state.a},
 {type:'select',id:'op',label:'运算',value:state.op,options:[{value:'add',label:'加'},{value:'subtract',label:'减'},{value:'multiply',label:'乘'},{value:'divide',label:'除'}]},
 {type:'number',id:'b',label:'第二个数',value:state.b},
 {type:'button',id:'calculate',label:'计算并记住结果'},
 {type:'metric',label:'结果',value:String(state.result===''?'等待输入':state.result)}
]);}
app.onEvent = async event => {
 if(event.id!=='calculate')return;
 const a=Number(event.values.a),b=Number(event.values.b),op=event.values.op;
 let result=op==='subtract'?a-b:op==='multiply'?a*b:op==='divide'?(b===0?'不能除以零':a/b):a+b;
 if(typeof result==='number'&&!Number.isFinite(result))result='数值超出范围';
 state={a,b,op,result};await app.setData(state);draw();
};draw();`;

const focusTimer=`let state={minutes:25,remaining:1500,endAt:0,...app.getData()};
function left(){return state.endAt?Math.max(0,Math.ceil((state.endAt-Date.now())/1000)):Math.max(0,state.remaining);}
function draw(){const seconds=left();app.render([
 {type:'heading',text:'专注计时'},
 {type:'metric',label:state.endAt?'专注中':'待开始 / 已暂停',value:String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0')},
 {type:'number',id:'minutes',label:'本次时长（分钟）',min:1,max:180,value:state.minutes},
 {type:'row',children:[{type:'button',id:'start',label:'开始 / 继续'},{type:'button',id:'pause',label:'暂停'},{type:'button',id:'reset',label:'按时长重置'}]},
 {type:'text',text:'停止小工具会停止刷新；重新运行时按保存的结束时间恢复。不会自动创建专注完成记录。'}
]);}
app.onEvent=async event=>{
 if(event.type!=='click')return;
 if(event.id==='reset'){state.minutes=Math.max(1,Math.min(180,Number(event.values.minutes)||25));state.remaining=Math.round(state.minutes*60);state.endAt=0;}
 if(event.id==='start'&&!state.endAt){if(left()===0)state.remaining=state.minutes*60;state.endAt=Date.now()+state.remaining*1000;}
 if(event.id==='pause'){state.remaining=left();state.endAt=0;}
 await app.setData(state);draw();
};
setInterval(()=>{if(!state.endAt)return;if(left()===0){state.remaining=0;state.endAt=0;app.setData(state).catch(()=>{});}draw();},1000);draw();`;

const presets=[
 {id:'quick-note',kind:'note',title:'随手便笺',description:'随时补充想法、提醒和临时信息。',icon:'edit',color:'#B3A0FF',category:'记录',config:{text:''}},
 {id:'meeting',kind:'note',title:'会议记录',description:'围绕议题、结论和下一步行动记录。',icon:'message',color:'#9DC5FF',category:'工作',config:{text:'议题：\n\n讨论记录：\n\n结论：\n\n下一步行动：'}},
 {id:'weekly-review',kind:'note',title:'每周复盘',description:'记录本周收获、阻碍和下周重点。',icon:'edit',color:'#B4E6B9',category:'记录',config:{text:'本周做了什么：\n\n有哪些收获：\n\n遇到了哪些阻碍：\n\n下周最重要的事：'}},
 {id:'checklist',kind:'checklist',title:'项目检查清单',description:'把一个项目拆成可勾选的检查项。',icon:'check-circle',color:'#63E6DC',category:'工作',config:{items:[]}},
 {id:'shopping',kind:'checklist',title:'购物与出行清单',description:'准备购物、行李或一次出行需要的物品。',icon:'check-circle',color:'#FFBC7C',category:'生活',config:{items:[]}},
 {id:'links',kind:'links',title:'常用链接',description:'集中收藏项目、工具和资料的网址。',icon:'link',color:'#AE88FF',category:'资料',config:{items:[]}},
 {id:'project-progress',kind:'progress',title:'目标进度',description:'自定当前值、目标和单位，看到推进情况。',icon:'chart',color:'#63E6DC',category:'工作',config:{value:0,target:100,unit:'%'}},
 {id:'countdown',kind:'countdown',title:'日期倒计时',description:'为交付、出行或重要日期保留倒计时。',icon:'calendar',color:'#FF9CCE',category:'生活',config:{date:'2000-01-01'}},
 {id:'reading',kind:'table',title:'阅读清单',description:'整理书目、阅读状态和摘录。',icon:'book',color:'#D8F649',category:'资料',config:{columns:[{id:'name',label:'书目 / 文章'},{id:'status',label:'阅读状态'},{id:'note',label:'摘录 / 感想'}],rows:[]}},
 {id:'publishing',kind:'table',title:'内容排期',description:'安排选题、发布渠道、计划日期和状态。',icon:'calendar',color:'#9DC5FF',category:'工作',config:{columns:[{id:'topic',label:'选题'},{id:'channel',label:'渠道'},{id:'date',label:'计划日期'},{id:'status',label:'状态'}],rows:[]}},
 {id:'job-search',kind:'table',title:'求职跟进',description:'记录公司、岗位、当前进展和下一步。',icon:'flag',color:'#FFBC7C',category:'工作',config:{columns:[{id:'company',label:'公司'},{id:'role',label:'岗位'},{id:'stage',label:'进展'},{id:'next',label:'下一步'}],rows:[]}},
 {id:'custom-table',kind:'table',title:'自定义记录表',description:'按自己的用途定义列，管理任意主题记录。',icon:'layers',color:'#B4E6B9',category:'记录',config:{columns:[{id:'name',label:'名称'},{id:'note',label:'备注'}],rows:[]}},
 {id:'calculator',kind:'miniapp',title:'随手计算器',description:'带输入和计算逻辑的小工具，可以继续让AI改造。',icon:'code',color:'#AE88FF',category:'小工具',config:{code:calculator}},
 {id:'focus-timer',kind:'miniapp',title:'专注计时器',description:'可暂停、恢复和调整时长的专注小工具。',icon:'clock',color:'#63E6DC',category:'小工具',config:{code:focusTimer}},
];
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
export const CUSTOM_BLOCK_PRESETS=freeze(presets);
export function createPresetInput(id,now=new Date()){
  const preset=presets.find(item=>item.id===id);
  if(!preset)throw new Error('未找到这个场景方块。');
  const {kind,title,description,color,config}=structuredClone(preset);
  if(kind==='countdown'){
    const date=new Date(now);date.setDate(date.getDate()+7);
    config.date=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  }
  return {kind,title,description,color,config,data:{}};
}
