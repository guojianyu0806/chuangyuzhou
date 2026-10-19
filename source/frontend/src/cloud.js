import {escapeHTML as esc, configureFileStore, getLocalFile} from './services.js';

const stamp = () => new Date().toISOString();
const clone = value => JSON.parse(JSON.stringify(value));
const read = key => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };
const apiMessages={unauthorized:'登录已过期，请重新登录。',invalid_credentials:'账号或密码不正确。',setup_token_invalid:'初始化口令不正确，请检查后重试。',setup_closed:'账号已经建立，请刷新页面后登录。',csrf_invalid:'登录信息已更新，请重新登录。',csrf_forbidden:'登录信息已更新，请重新登录。',rate_limited:'尝试次数较多，请稍后再试。',revision_conflict:'其他设备有新内容，请先处理同步冲突。',missing_files:'部分附件尚未上传完整，请保留本机副本后重试。',invalid_password:'密码需要包含 12 至 256 位字符。',invalid_username:'请使用 2 至 64 位用户名。',file_not_found:'附件暂时不可用。',model_not_configured:'请先在偏好与连接中配置 DeepSeek。'};
Object.assign(apiMessages,{authentication_required:'登录已过期，请重新登录。',too_many_attempts:'尝试次数较多，请稍后再试。',password_length_12_to_256:'密码需要包含 12 至 256 位字符。'});
function errorMessage(result,fallback){const value=typeof result.error==='string'?result.error:result.error?.message;return apiMessages[value]||result.message||value||fallback;}
const statusNames = {ready:'云端已就绪',saved:'已同步',saving:'正在同步',pending:'等待同步',offline:'离线 · 待同步',conflict:'同步冲突 · 已保留',remote:'其他设备有更新',auth:'请重新登录'};

// Each tab owns its revision and pending snapshot. Sharing a browser cache must
// never make an old tab inherit a newer revision and overwrite another device.
export class CloudClient {
  enabled = true;
  authenticated = true;
  status = 'ready';
  revision = 0;
  pending = null;
  incoming = null;
  modelStatus = null;
  listeners = new Set();
  constructor(session) {
    this.session = session;
    this.account = encodeURIComponent(session.username);
    // A duplicated browser tab may inherit sessionStorage. Give every loaded
    // document its own cache, carrying the previous document's pending work.
    const previousTab=sessionStorage.getItem(`lumi-cloud-tab-${this.account}`);
    const reloading=performance.getEntriesByType('navigation')[0]?.type==='reload';
    const tab=reloading&&previousTab?previousTab:crypto.randomUUID();sessionStorage.setItem(`lumi-cloud-tab-${this.account}`,tab);
    this.prefix = `lumi-cloud-v1-${this.account}-${tab}`;
    this.cacheKey = `${this.prefix}-sync`;
    if(previousTab&&previousTab!==tab){
      const previousPrefix=`lumi-cloud-v1-${this.account}-${previousTab}`;
      for(const suffix of ['sync','workspace-personal','workspace-demo']){const value=localStorage.getItem(`${previousPrefix}-${suffix}`);if(value)localStorage.setItem(`${this.prefix}-${suffix}`,value);}
    }
    this.recoveryPrefix = `lumi-cloud-recovery-${this.account}-`;
    this.scope = `cloud-${this.account}`;
    this.mode = 'personal';
    this.setMode('personal');
    window.addEventListener('online',()=>{if(this.pending)this.flush().catch(()=>{});else this.poll();});
    window.addEventListener('offline',()=>{if(this.pending)this.setStatus('offline');});
    window.addEventListener('beforeunload',event=>{if(this.pending){event.preventDefault();event.returnValue='';}});
  }
  key(mode) {return `${this.prefix}-workspace-${mode}`;}
  draftKey(value) {return `${this.prefix}-draft-${value}`;}
  recoveryCopies() {
    const copies=[];
    const accountPrefix=`lumi-cloud-v1-${this.account}-`;
    for(const key of Object.keys(localStorage)){
      if(key.startsWith(this.recoveryPrefix)){const state=read(key);if(state)copies.push({key,state,label:'冲突恢复副本'});}
      else if(key!==this.cacheKey&&key.startsWith(accountPrefix)&&key.slice(accountPrefix.length).length===41&&key.endsWith('-sync')){
        const cached=read(key);if(cached?.pending?.state)copies.push({key,state:cached.pending.state,label:'其他窗口未同步副本'});
      }
    }
    return copies.sort((a,b)=>String(b.state.updatedAt).localeCompare(String(a.state.updatedAt)));
  }
  setMode(mode) {
    this.mode = mode;
    configureFileStore(`${this.scope}${mode==='demo'?'-demo':''}`,mode==='personal'?async id=>{
      try{const response = await this.request(`/api/files/${encodeURIComponent(id)}`,{raw:true});return response.blob();}
      catch(error){if(error.status===404)return undefined;throw error;}
    }:null);
  }
  subscribe(fn) {this.listeners.add(fn);return ()=>this.listeners.delete(fn);}
  setStatus(status,error='') {if(this.status===status&&this.error===error)return;this.status=status;this.error=error;for(const fn of this.listeners)fn(this);}
  get label(){return statusNames[this.status]||this.status;}
  persist() {
    localStorage.setItem(this.cacheKey,JSON.stringify({revision:this.revision,pending:this.pending,conflict:this.status==='conflict',updatedAt:stamp()}));
  }
  async request(path,{method='GET',body,headers={},raw=false,...options}={}) {
    const write = !['GET','HEAD'].includes(method);
    const response = await fetch(path,{...options,method,credentials:'same-origin',cache:'no-store',headers:{...(write?{'X-CSRF-Token':this.session.csrfToken}:{}),...(body!==undefined&&!(body instanceof Blob)?{'Content-Type':'application/json'}:{}),...headers},body:body===undefined?undefined:body instanceof Blob?body:JSON.stringify(body)});
    if(!response.ok){
      const result=await response.json().catch(()=>({}));
      const error=new Error(errorMessage(result,`请求失败（${response.status}）`));
      error.status=response.status;error.code=result.code||result.error;
      if(response.status===401||(response.status===403&&['csrf_invalid','csrf_forbidden'].includes(error.code))){this.authenticated=false;this.setStatus('auth','登录状态已更新，本窗口改动已保留，请重新登录。');}
      throw error;
    }
    return raw?response:response.status===204?{}:response.json();
  }
  async initialize(empty) {
    const cached=read(this.cacheKey);
    this.revision=cached?.revision||0;
    this.pending=cached?.pending||null;
    let remote;
    try{remote=await this.request('/api/workspace');}catch(error){
      const stored=read(this.key('personal'));
      if(error.status!==401)this.setStatus('offline','暂时无法连接云端，改动会留在此设备，恢复连接后再同步。');
      return this.pending?.state||stored||empty;
    }
    if(this.pending){
      if(cached.conflict||remote.revision!==this.revision){this.incoming=remote;this.conflict();}
      else{this.setStatus('pending');setTimeout(()=>this.flush().catch(()=>{}),500);}
      return this.pending.state;
    }
    this.revision=remote.revision;
    this.persist();
    this.setStatus(remote.state?'saved':'ready');
    return remote.state||empty;
  }
  enqueue(state) {
    if(state.mode!=='personal')return;
    this.pending={state:clone(state),id:crypto.randomUUID(),createdAt:stamp()};
    this.persist();
    if(this.status==='conflict'||!this.authenticated){if(this.status==='conflict')this.preserve();return;}
    this.setStatus(navigator.onLine?'pending':'offline');
    clearTimeout(this.timer);this.timer=setTimeout(()=>this.flush().catch(()=>{}),700);
  }
  preserve() {
    if(this.pending)localStorage.setItem(`${this.recoveryPrefix}${Date.now()}-${this.pending.id}`,JSON.stringify(this.pending.state));
  }
  conflict() {
    this.setStatus('conflict','其他设备已提交新内容。本设备改动已保留，请先导出，再加载云端内容。');
    this.preserve();this.persist();
  }
  async uploadFiles(state) {
    const refs=new Map();
    function scan(value){if(value&&typeof value==='object')for(const [key,item] of Object.entries(value)){if(typeof item==='string'&&/^(blobId|fileId|audioId)$/.test(key))refs.set(item,value);else if(item&&typeof item==='object')scan(item);}}
    scan(state);
    this.uploaded||=new Set();
    for(const [id,meta] of refs){
      if(this.uploaded.has(id))continue;
      // Read the personal database even when the user is viewing example cards.
      const blob=await getLocalFile(id, this.scope);
      let remote;
      try{remote=await this.request(`/api/files/${encodeURIComponent(id)}`,{method:'HEAD',raw:true});}
      catch(error){if(error.status!==404)throw error;}
      if(remote&&blob){
        const remoteHash=remote.headers.get('ETag')?.replaceAll('"','');
        if(remoteHash){const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),byte=>byte.toString(16).padStart(2,'0')).join('');if(hash!==remoteHash)throw new Error('本机附件与云端同名记录不同，请重新添加这份附件后同步。');}
      }
      if(!remote&&blob){
        await this.request(`/api/files/${encodeURIComponent(id)}`,{method:'PUT',body:blob,headers:{'Content-Type':blob.type||'application/octet-stream','X-File-Name':encodeURIComponent(blob.name||meta.name||meta.fileName||'附件')}});
      }else if(!remote)throw new Error(`附件「${meta.name||meta.fileName||id}」原件缺失，请重新添加。`);
      this.uploaded.add(id);
    }
  }
  async flush() {
    clearTimeout(this.timer);
    if(this.status==='conflict')throw new Error(this.error);
    if(!this.authenticated)throw new Error('请重新登录后继续同步。');
    if(this.sending)return this.sending;
    this.sending=(async()=>{
      while(this.pending){
        const current=this.pending;
        this.setStatus('saving');
        try{
          await this.uploadFiles(current.state);
          const result=await this.request('/api/workspace',{method:'PUT',body:{baseRevision:this.revision,state:current.state}});
          this.revision=result.revision;
          if(this.pending.id===current.id)this.pending=null;
          this.persist();
          this.setStatus(this.pending?'pending':'saved');
        }catch(error){
          if(error.status===409&&error.code==='revision_conflict')this.conflict();
          else if(this.authenticated)this.setStatus('offline',error.message||'暂时无法同步，改动已保存在此设备。');
          throw error;
        }
      }
      return this.revision;
    })();
    try{return await this.sending;}finally{this.sending=null;}
  }
  start(onRemote) {this.onRemote=onRemote;this.interval=setInterval(()=>this.poll(),5000);}
  async poll() {
    if(!this.authenticated||this.sending||this.polling||this.status==='conflict')return;
    if(this.pending){this.flush().catch(()=>{});return;}
    this.polling=true;
    try{
      const remote=await this.request(`/api/workspace?since=${encodeURIComponent(this.revision)}`);
      if(this.pending||this.sending)return;
      if(remote.revision!==this.revision){this.incoming=remote;this.setStatus('remote');this.onRemote?.(remote);}
      else if(this.status==='offline')this.setStatus('saved');
    }catch(error){if(error.status!==401)this.setStatus('offline','暂时无法连接云端。');}
    finally{this.polling=false;}
  }
  async acceptRemote(guard=()=>true) {
    if(this.sending)await this.sending;
    const pendingId=this.pending?.id;
    const remote=await this.request('/api/workspace');
    if(pendingId!==this.pending?.id||!guard())throw new Error('本设备刚有新的编辑，已暂缓加载云端内容。');
    if(this.pending)this.preserve();
    this.pending=null;this.revision=remote.revision;this.incoming=null;
    this.setStatus(remote.state?'saved':'ready');this.persist();
    return remote.state;
  }
  async logout() {await this.flush();await this.request('/api/auth/logout',{method:'POST'});location.reload();}
}

function authView(setup,error='') {
  const app=document.querySelector('#app');
  app.innerHTML=`<main class="cloud-entry" id="main"><section class="cloud-welcome"><img src="./icon.svg" alt="" width="56" height="56"><span class="eyebrow">宇宙 · YOUR OWN UNIVERSE</span><h1>你的每一种日常，<br>都在这里相遇。</h1><p>课程、灵感、学生会和自己的小计划。<br>登录后，在每台设备上继续。</p><div class="cloud-entry-tags"><span>课程空间</span><span>六级计划</span><span>AI 收件台</span></div></section><section class="cloud-login-card"><span class="cloud-entry-mark">✳</span><h2>${setup?'建立你的私人宇宙':'欢迎回到宇宙'}</h2><p class="muted">${setup?'设置一个账号，用于你的电脑、手机与平板。':'用同一个账号，连接你的空间。'}</p><form id="cloud-auth-form"><label class="field">账号<input name="username" required minlength="2" maxlength="64" autocomplete="username" placeholder="例如 yuzhou"></label><label class="field">密码<input name="password" type="password" required ${setup?'minlength="12"':''} maxlength="256" autocomplete="${setup?'new-password':'current-password'}" placeholder="${setup?'至少 12 位字符':'输入你的密码'}"></label>${setup?'<label class="field">初始化口令<input name="setupToken" type="password" required autocomplete="off" placeholder="部署时生成的初始化口令"></label><p class="small muted">口令仅用于首次建立账号，不会保存到浏览器。</p>':''}<p id="cloud-auth-error" class="cloud-error" role="alert">${esc(error)}</p><button class="btn primary full" type="submit">${setup?'创建账号并进入':'登录工作台'} →</button></form><p class="cloud-entry-foot">资料归你 · 各设备同步 · 独立私人空间</p></section></main>`;
  return app.querySelector('form');
}

async function authenticate(session) {
  return new Promise(resolve=>{
    const form=authView(!!session.setupRequired);
    form.onsubmit=async event=>{
      event.preventDefault();const button=form.querySelector('button');button.disabled=true;
      const data=new FormData(form);
      try{
        const response=await fetch(session.setupRequired?'/api/auth/setup':'/api/auth/login',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(data))});
        const result=await response.json();
        if(!response.ok)throw new Error(errorMessage(result,'登录未成功，请检查账号信息。'));
        form.reset();
        const check=await fetch('/api/auth/session',{cache:'no-store',credentials:'same-origin'});
        if(!check.ok)throw new Error('暂时无法确认登录状态，请重试。');
        const verified=await check.json();if(!verified.authenticated)throw new Error('登录状态尚未建立，请重试。');
        resolve(verified);
      }catch(error){form.querySelector('#cloud-auth-error').textContent=error.message;button.disabled=false;}
    };
  });
}

export async function bootstrapCloud() {
  let health;
  try{
    const response=await fetch('/api/health',{cache:'no-store',signal:AbortSignal.timeout(6000)});
    if(!response.ok)throw new Error('云端服务暂时无法连接。');health=await response.json();
    if(health.mode!=='cloud'){sessionStorage.removeItem('lumi-cloud-server');return null;}
    sessionStorage.setItem('lumi-cloud-server','1');
  }catch(error){
    if(['127.0.0.1','localhost','[::1]'].includes(location.hostname)&&!sessionStorage.getItem('lumi-cloud-server'))return null;
    document.querySelector('#app').innerHTML='<main class="cloud-entry cloud-unavailable"><section class="cloud-login-card"><h1>暂时无法连接工作台</h1><p>请检查网络后重新加载。你的设备缓存仍然保留。</p><button class="btn primary" id="cloud-retry">重新连接</button></section></main>';
    document.querySelector('#cloud-retry').onclick=()=>location.reload();return new Promise(()=>{});
  }
  let session;
  try{const res=await fetch('/api/auth/session',{cache:'no-store',credentials:'same-origin'});if(!res.ok)throw new Error();session=await res.json();}
  catch{const form=authView(false,'暂时无法检查登录状态，请重试。');form.onsubmit=event=>{event.preventDefault();location.reload();};return new Promise(()=>{});}
  if(!session.authenticated)session=await authenticate(session);
  return new CloudClient(session);
}

export function mountModelSettings(container,client,toast) {
  container.innerHTML=`<div class="section-head"><h2>DeepSeek 与 AI 管家</h2><span class="badge" id="cloud-model-badge">检查连接中</span></div><p class="muted">API 密钥仅保存在你的服务器。课程整理与碎片归档共用这个连接。</p><form id="cloud-model-form" autocomplete="off"><label class="field">DeepSeek API Key<input type="password" name="apiKey" autocomplete="new-password" spellcheck="false" placeholder="输入新的 API Key；留空保留现有密钥"></label><label class="field">模型<select name="model"><option value="deepseek-flash">DeepSeek Flash</option><option value="deepseek-v4-pro">DeepSeek V4 Pro</option></select></label><p class="small muted" id="cloud-hermes-state"></p><p class="cloud-error" role="alert"></p><button class="btn primary" type="submit">保存连接</button></form>`;
  const form=container.querySelector('form');
  function show(info){client.modelStatus=info;if(!container.isConnected)return;container.querySelector('#cloud-model-badge').textContent=info.configured?'已配置':'尚未接入';container.querySelector('#cloud-hermes-state').textContent=info.hermesAvailable?'Hermes 已就绪':'Hermes 尚未就绪';if(info.model)form.elements.model.value=info.model;}
  client.request('/api/model/status').then(show).catch(error=>{if(container.isConnected)container.querySelector('.cloud-error').textContent=error.message;});
  form.onsubmit=async event=>{
    event.preventDefault();const button=form.querySelector('button');button.disabled=true;
    try{const result=await client.request('/api/model/config',{method:'PUT',body:{provider:'deepseek',apiKey:form.elements.apiKey.value,model:form.elements.model.value}});form.elements.apiKey.value='';show(result);toast('模型连接配置已保存到服务器。');container.querySelector('.cloud-error').textContent='';}
    catch(error){container.querySelector('.cloud-error').textContent=error.message;}
    finally{button.disabled=false;}
  };
}
