export const MINIAPP_CHANNEL='czb-miniapp-v1';
export const MINIAPP_MESSAGE_BYTES=64*1024;
export const MINIAPP_TIMEOUT_MS=4000;

// This boundary accepts JSON, never general structured-clone objects or executable values.
export function miniappJSON(value,maxBytes=MINIAPP_MESSAGE_BYTES,maxDepth=10){
  const ancestors=new Set();let count=0;
  const visit=(item,depth)=>{
    if(depth>maxDepth||++count>10000)throw new Error('小程序数据层级或数量超出限制');
    if(item===null||typeof item==='string'||typeof item==='boolean')return;
    if(typeof item==='number'&&Number.isFinite(item))return;
    if(typeof item!=='object'||ancestors.has(item))throw new Error('小程序只接受有限的 JSON 数据');
    const proto=Object.getPrototypeOf(item);
    if(!Array.isArray(item)&&proto!==Object.prototype&&proto!==null)throw new Error('小程序只接受普通 JSON 对象');
    ancestors.add(item);
    for(const key of Object.keys(item))visit(item[key],depth+1);
    ancestors.delete(item);
  };
  visit(value,0);const json=JSON.stringify(value);
  if(typeof json!=='string'||new TextEncoder().encode(json).byteLength>maxBytes)throw new Error('小程序消息超过 64 KiB 限制');
  return JSON.parse(json);
}

export function mountMiniapp(host,{code,data,onData,onError,preview=false}={}){
  if(!host?.ownerDocument)throw new Error('缺少小程序运行容器');
  const doc=host.ownerDocument,win=doc.defaultView;
  let initial;
  try{
    if(typeof code!=='string'||!code.trim()||code.length>30000)throw new Error('小程序代码需为 1—30000 字符');
    initial=miniappJSON(data??{});
    // Validate the actual envelopes before creating any executing surface.
    miniappJSON({channel:MINIAPP_CHANNEL,token:'x'.repeat(48),type:'code',code});
    miniappJSON({channel:MINIAPP_CHANNEL,token:'x'.repeat(48),type:'data',data:initial},MINIAPP_MESSAGE_BYTES,12);
  }catch(error){
    const message=doc.createElement('p');message.setAttribute('role','alert');message.textContent=error.message;host.replaceChildren(message);
    try{onError?.(error);}catch{}
    return ()=>message.remove();
  }
  const bytes=new Uint8Array(24);win.crypto.getRandomValues(bytes);
  const token=Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
  const shell=doc.createElement('section'),toolbar=doc.createElement('div'),status=doc.createElement('span'),stop=doc.createElement('button'),frame=doc.createElement('iframe');
  shell.className='miniapp-runtime';toolbar.className='miniapp-runtime-toolbar';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  status.textContent=preview?'正在启动预览…':'正在启动小程序…';stop.type='button';stop.textContent='停止小程序';
  frame.title=preview?'小程序隔离预览':'小程序隔离运行';frame.setAttribute('sandbox','allow-scripts');frame.setAttribute('referrerpolicy','no-referrer');
  frame.setAttribute('allow',"camera 'none'; microphone 'none'; geolocation 'none'; payment 'none'; usb 'none'");
  frame.src=new URL('../miniapp-runtime.html',import.meta.url).href;frame.style.width='100%';frame.style.height='360px';frame.style.border='0';
  toolbar.append(status,stop);shell.append(toolbar,frame);
  let active=true,saving=false,lastBeat=Date.now(),windowStart=Date.now(),messages=0;
  const send=(message)=>{if(active)frame.contentWindow?.postMessage({channel:MINIAPP_CHANNEL,token,...message},'*');};
  const notify=error=>{try{onError?.(error);}catch{}};
  const dispose=(message)=>{
    if(!active)return;active=false;win.clearInterval(timer);win.removeEventListener('message',receive);stop.removeEventListener('click',stopRun);frame.removeEventListener('load',init);
    try{frame.contentWindow?.postMessage({channel:MINIAPP_CHANNEL,token,type:'stop'},'*');}catch{}
    frame.remove();stop.disabled=true;if(message)status.textContent=message;
  };
  const fail=error=>{dispose(error.message);status.setAttribute('role','alert');notify(error);};
  const stopRun=()=>dispose('小程序已停止');
  const receive=async event=>{
    if(!active||event.source!==frame.contentWindow)return;
    const raw=event.data;if(!raw||raw.channel!==MINIAPP_CHANNEL||raw.token!==token)return;
    let message;
    try{message=miniappJSON(raw,MINIAPP_MESSAGE_BYTES,12);}catch(error){fail(error);return;}
    const now=Date.now();if(now-windowStart>=1000){windowStart=now;messages=0;}
    if(++messages>120){fail(new Error('小程序消息过于频繁，已停止'));return;}
    if(message.type==='heartbeat'){lastBeat=now;return;}
    if(message.type==='started'){lastBeat=now;status.textContent=preview?'预览运行中 · 数据仅在本次预览保留':'小程序运行中';return;}
    if(message.type==='error'){fail(new Error(String(message.message||'小程序运行失败').slice(0,400)));return;}
    if(message.type!=='save'||!Number.isSafeInteger(message.requestId)||message.requestId<1)return;
    if(saving){send({type:'saved',requestId:message.requestId,ok:false,message:'上一笔数据仍在保存，请稍后再试'});return;}
    saving=true;
    try{
      const next=miniappJSON(message.data);
      if(!preview){if(typeof onData!=='function')throw new Error('当前小程序没有可用的数据保存入口');const result=await onData(next);if(result===false)throw new Error('小程序数据未保存');}
      if(!active)return;
      status.textContent=preview?'预览运行中 · 数据仅在本次预览保留':'小程序运行中 · 数据已保存';
      send({type:'saved',requestId:message.requestId,ok:true});
    }catch(error){
      if(!active)return;const problem=error instanceof Error?error:new Error('小程序数据保存失败');
      status.textContent=`保存失败：${problem.message.slice(0,300)}`;notify(problem);send({type:'saved',requestId:message.requestId,ok:false,message:problem.message.slice(0,300)});
    }finally{saving=false;}
  };
  const init=()=>{
    if(!active)return;
    send({type:'init',preview});send({type:'code',code});send({type:'data',data:initial});send({type:'run'});
  };
  const timer=win.setInterval(()=>{if(active&&Date.now()-lastBeat>MINIAPP_TIMEOUT_MS)fail(new Error('小程序超过 4 秒未响应，已停止'));},250);
  win.addEventListener('message',receive);stop.addEventListener('click',stopRun);frame.addEventListener('load',init);host.replaceChildren(shell);
  return ()=>{dispose();shell.remove();};
}
