/* Trusted renderer. Generated code is only placed in a dedicated Blob Worker. */
(()=>{
  'use strict';
  const CHANNEL='czb-miniapp-v1',MAX_BYTES=64*1024,root=document.getElementById('miniapp-root'),errorBox=document.getElementById('miniapp-error');
  let token=null,code=null,data=null,worker=null,workerURL=null,active=true,started=false,rateStart=Date.now(),rateCount=0;
  const values=Object.create(null);let controls=new Map(),declaredValues=new Map();
  function json(value,maxDepth=10){
    const ancestors=new Set();let count=0;
    const walk=(item,depth)=>{
      if(depth>maxDepth||++count>10000)throw Error('数据结构超出限制');
      if(item===null||typeof item==='string'||typeof item==='boolean'||(typeof item==='number'&&Number.isFinite(item)))return;
      if(typeof item!=='object'||ancestors.has(item))throw Error('只接受有限 JSON 数据');
      const proto=Object.getPrototypeOf(item);if(!Array.isArray(item)&&proto!==Object.prototype&&proto!==null)throw Error('只接受普通 JSON 对象');
      ancestors.add(item);for(const key of Object.keys(item))walk(item[key],depth+1);ancestors.delete(item);
    };
    walk(value,0);const result=JSON.stringify(value);if(new TextEncoder().encode(result).byteLength>MAX_BYTES)throw Error('消息超过 64 KiB 限制');return JSON.parse(result);
  }
  const send=message=>{if(token&&active)parent.postMessage({channel:CHANNEL,token,...message},'*');};
  function stop(){if(worker){worker.onmessage=null;worker.onerror=null;worker.terminate();worker=null;}if(workerURL){URL.revokeObjectURL(workerURL);workerURL=null;}}
  function fail(error){const message=String(error?.message||error||'小程序运行失败').slice(0,400);errorBox.hidden=false;errorBox.textContent=message;send({type:'error',message});stop();active=false;}
  const fields=new Set(['type','id','label','text','value','options','min','max','step','children','disabled','placeholder']);
  const kinds=new Set(['heading','text','metric','input','number','select','button','progress','row','column','divider']);
  function validateTree(input){
    const nodes=json(input,18);if(!Array.isArray(nodes))throw Error('app.render 需要组件数组');
    let count=0;const ids=new Set();
    const visit=(node,depth)=>{
      if(!node||Array.isArray(node)||typeof node!=='object'||++count>200||depth>8)throw Error('组件树最多 200 个节点、8 层');
      if(!kinds.has(node.type)||Object.keys(node).some(key=>!fields.has(key)))throw Error('组件包含不支持的类型或字段');
      for(const key of ['id','label','text','placeholder'])if(node[key]!==undefined&&(typeof node[key]!=='string'||node[key].length>(key==='id'?80:4000)))throw Error('组件文字字段无效');
      if(node.id!==undefined){if(!node.id||ids.has(node.id))throw Error('组件 id 需要非空且唯一');ids.add(node.id);}
      if(['input','number','select','button'].includes(node.type)&&!node.id)throw Error('交互组件必须提供 id');
      if(node.value!==undefined&&!['string','number','boolean'].includes(typeof node.value))throw Error('组件 value 必须是文字、数字或布尔值');
      if(typeof node.value==='string'&&node.value.length>4000)throw Error('组件 value 过长');
      if(node.disabled!==undefined&&typeof node.disabled!=='boolean')throw Error('disabled 必须为布尔值');
      for(const key of ['min','max','step'])if(node[key]!==undefined&&(typeof node[key]!=='number'||!Number.isFinite(node[key])))throw Error('组件数值范围无效');
      if(node.min!==undefined&&node.max!==undefined&&node.min>node.max)throw Error('组件最小值不能大于最大值');
      if(node.step!==undefined&&node.step<=0)throw Error('组件 step 必须大于零');
      if(node.options!==undefined){
        if(node.type!=='select'||!Array.isArray(node.options)||node.options.length>100)throw Error('select 最多接受 100 个选项');
        for(const item of node.options){
          if(typeof item==='string'){if(item.length>1000)throw Error('选项过长');continue;}
          if(!item||Array.isArray(item)||typeof item!=='object'||Object.keys(item).some(key=>!['label','value'].includes(key))||typeof item.label!=='string'||item.label.length>1000||!['string','number','boolean'].includes(typeof item.value)||String(item.value).length>1000)throw Error('选项只能包含 label 和 value');
        }
      }
      if(node.children!==undefined){if(!['row','column'].includes(node.type)||!Array.isArray(node.children))throw Error('只有 row/column 可以包含 children');for(const child of node.children)visit(child,depth+1);}
    };
    for(const node of nodes)visit(node,1);return nodes;
  }
  function render(input){
    const nodes=validateTree(input),nextValues=Object.create(null),nextControls=new Map(),nextDeclared=new Map();
    let focusedId=null,selection=null;
    for(const [id,control] of controls)if(control===document.activeElement){focusedId=id;try{selection=[control.selectionStart,control.selectionEnd,control.selectionDirection];}catch{}break;}
    const make=node=>{
      let element;
      if(node.type==='heading'||node.type==='text'){element=document.createElement(node.type==='heading'?'h2':'p');element.textContent=node.text??node.label??'';}
      else if(node.type==='metric'){
        element=document.createElement('div');element.className='mini-metric';const label=document.createElement('span'),value=document.createElement('strong');label.className='mini-metric-label';label.textContent=node.label??node.text??'';value.className='mini-metric-value';value.textContent=String(node.value??'');element.append(label,value);
      }else if(node.type==='row'||node.type==='column'){element=document.createElement('div');element.className='mini-'+node.type;for(const child of node.children||[])element.append(make(child));}
      else if(node.type==='divider')element=document.createElement('hr');
      else if(node.type==='button'){
        element=document.createElement('button');element.type='button';element.textContent=node.label??node.text??'确认';element.disabled=!!node.disabled;element.addEventListener('click',()=>dispatch({id:node.id,type:'click'}));
      }else if(node.type==='progress'){
        element=document.createElement('label');const label=document.createElement('span'),bar=document.createElement('progress');label.textContent=node.label??node.text??'';bar.max=Number(node.max)>0?Number(node.max):100;bar.value=Math.max(0,Math.min(bar.max,Number(node.value)||0));element.append(label,bar);
      }else{
        element=document.createElement('label');const label=document.createElement('span'),control=document.createElement(node.type==='select'?'select':'input');label.textContent=node.label??'';
        if(node.type==='select'){for(const option of node.options||[]){const item=document.createElement('option');item.value=String(typeof option==='string'?option:option.value);item.textContent=typeof option==='string'?option:option.label;control.append(item);}}
        else{control.type=node.type==='number'?'number':'text';if(node.placeholder!==undefined)control.placeholder=node.placeholder;for(const key of ['min','max','step'])if(node[key]!==undefined)control[key]=String(node[key]);}
        control.disabled=!!node.disabled;
        const declared={type:node.type,value:String(node.value??'')},previous=declaredValues.get(node.id);
        control.value=previous?.type===declared.type&&previous.value===declared.value&&Object.hasOwn(values,node.id)?values[node.id]:declared.value;
        nextValues[node.id]=control.value;nextControls.set(node.id,control);nextDeclared.set(node.id,declared);
        control.addEventListener('input',()=>{values[node.id]=control.value;});
        control.addEventListener('change',()=>{values[node.id]=control.value;dispatch({id:node.id,type:'change',value:control.value});});element.append(label,control);
      }
      return element;
    };
    const fragment=document.createDocumentFragment();for(const node of nodes)fragment.append(make(node));
    root.replaceChildren(fragment);for(const key of Object.keys(values))delete values[key];Object.assign(values,nextValues);controls=nextControls;declaredValues=nextDeclared;
    const focus=controls.get(focusedId);if(focus&&!focus.disabled){try{focus.focus({preventScroll:true});if(selection&&Number.isInteger(selection[0])&&Number.isInteger(selection[1]))focus.setSelectionRange(...selection);}catch{}}
  }
  function dispatch(event){if(!worker||!active)return;try{worker.postMessage({type:'event',event:json({...event,values:{...values}})});}catch(error){fail(error);}}
  function workerBootstrap(){
    'use strict';
    const send=self.postMessage.bind(self),listen=self.addEventListener.bind(self),setBeat=self.setInterval.bind(self),parse=JSON.parse.bind(JSON),stringify=JSON.stringify.bind(JSON),pending=new Map();
    let current={},handler=null,serial=0;
    const copy=value=>{
      const ancestors=new Set();let count=0;
      const inspect=(item,depth)=>{
        if(depth>10||++count>10000)throw Error('小程序数据层级或数量超出限制');
        if(item===null||typeof item==='string'||typeof item==='boolean'||(typeof item==='number'&&Number.isFinite(item)))return;
        if(typeof item!=='object'||ancestors.has(item))throw Error('小程序只接受有限 JSON 数据');
        const proto=Object.getPrototypeOf(item);if(!Array.isArray(item)&&proto!==Object.prototype&&proto!==null)throw Error('小程序只接受普通 JSON 对象');
        ancestors.add(item);for(const key of Object.keys(item))inspect(item[key],depth+1);ancestors.delete(item);
      };
      inspect(value,0);const encoded=stringify(value);if(new TextEncoder().encode(encoded).byteLength>64*1024)throw Error('小程序消息超过 64 KiB 限制');return parse(encoded);
    };
    // CSP remains the outer boundary. Seal inherited methods too, so generated code cannot
    // recover importScripts/fetch through WorkerGlobalScope.prototype after a shadowing delete.
    for(const name of ['fetch','XMLHttpRequest','WebSocket','EventSource','WebTransport','importScripts','Worker','SharedWorker','BroadcastChannel','RTCPeerConnection','caches','indexedDB','navigator']){
      for(let scope=self;scope;scope=Object.getPrototypeOf(scope)){
        if(scope!==self&&!Object.hasOwn(scope,name))continue;
        try{Object.defineProperty(scope,name,{value:undefined,writable:false,configurable:false});}
        catch{throw Error('当前环境无法隔离小程序能力：'+name);}
      }
    }
    const api={getData:()=>copy(current),setData(next){
      if(pending.size)return Promise.reject(Error('上一笔数据仍在保存，请等待完成'));
      let clone;try{clone=copy(next);}catch{return Promise.reject(Error('数据必须可序列化为 JSON'));}
      const requestId=++serial;
      return new Promise((resolve,reject)=>{pending.set(requestId,{resolve,reject,data:clone});send({type:'save',requestId,data:clone});});
    },render:nodes=>send({type:'render',nodes})};
    Object.defineProperty(api,'onEvent',{enumerable:true,get:()=>handler,set:value=>{if(value!==null&&typeof value!=='function')throw Error('app.onEvent 必须是函数');handler=value;}});
    Object.freeze(api);Object.defineProperty(self,'app',{value:api,writable:false,configurable:false});
    const problem=error=>send({type:'error',message:String(error?.message||error||'小程序运行错误').slice(0,400)});
    listen('message',event=>{
      const message=event.data;if(!message)return;
      if(message.type==='initial'){current=copy(message.data);send({type:'started'});return;}
      if(message.type==='saved'){
        const task=pending.get(message.requestId);if(!task)return;pending.delete(message.requestId);
        if(message.ok===true){current=task.data;task.resolve(copy(current));}else task.reject(Error(message.message||'数据保存失败'));return;
      }
      if(message.type==='event'&&handler){try{Promise.resolve(handler(copy(message.event))).catch(problem);}catch(error){problem(error);}}
    });
    listen('error',event=>{event.preventDefault();problem(event.error||event.message);});
    listen('unhandledrejection',event=>{event.preventDefault();problem(event.reason);});
    setBeat(()=>send({type:'heartbeat'}),500);
  }
  function start(){
    if(started||!active)return;if(typeof code!=='string'||!code.trim()||code.length>30000||data===null)throw Error('小程序启动信息不完整');started=true;
    // Initial data is supplied before code execution, without embedding it in source or HTML.
    const source=`(${workerBootstrap.toString()})();\nself.addEventListener('message',function begin(event){if(event.data?.type!=='initial')return;self.removeEventListener('message',begin);(async function(app){\n${code}\n})(self.app).catch(error=>self.postMessage({type:'error',message:String(error?.message||error).slice(0,400)}));});`;
    workerURL=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));worker=new Worker(workerURL,{name:'czb-miniapp'});
    worker.onerror=event=>{event.preventDefault();fail(Error(event.message||'小程序代码无法运行'));};
    worker.onmessage=event=>{
      if(!active||!worker)return;
      try{
        const now=Date.now();if(now-rateStart>=1000){rateStart=now;rateCount=0;}if(++rateCount>100)throw Error('小程序输出过于频繁，已停止');
        const message=json(event.data,20);
        if(message.type==='render'){render(message.nodes);return;}
        if(message.type==='heartbeat'||message.type==='started'){send({type:message.type});return;}
        if(message.type==='error'){fail(Error(String(message.message||'小程序运行失败').slice(0,400)));return;}
        if(message.type==='save'&&Number.isSafeInteger(message.requestId)&&message.requestId>0){const next=json(message.data);send({type:'save',requestId:message.requestId,data:next});}
      }catch(error){fail(error);}
    };
    worker.postMessage({type:'initial',data});
  }
  window.addEventListener('message',event=>{
    if(!active||event.source!==parent)return;const raw=event.data;if(!raw||raw.channel!==CHANNEL)return;
    if(token===null){if(raw.type!=='init'||typeof raw.token!=='string'||!/^[a-f0-9]{48}$/.test(raw.token))return;token=raw.token;return;}
    if(raw.token!==token)return;
    try{
      const message=json(raw,12);
      if(message.type==='stop'){stop();active=false;return;}
      if(message.type==='code'&&!started){if(typeof message.code!=='string'||message.code.length>30000)throw Error('小程序代码超过限制');code=message.code;return;}
      if(message.type==='data'&&!started){data=json(message.data);return;}
      if(message.type==='run'){start();return;}
      if(message.type==='saved'&&worker)worker.postMessage({type:'saved',requestId:message.requestId,ok:message.ok===true,message:typeof message.message==='string'?message.message.slice(0,300):''});
    }catch(error){fail(error);}
  });
  window.addEventListener('pagehide',()=>{stop();active=false;});
})();
