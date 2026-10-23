import {escapeHTML as esc, configureFileStore, getLocalFile} from './services.js';
import {modelStatusLabel,modelEngineDescription} from './model-status.js';
import {createWorkspaceStorage,sameWorkspaceContent} from './workspace-storage.js';

const stamp = () => new Date().toISOString();
const isLocalInstance=()=>['127.0.0.1','localhost','[::1]'].includes(globalThis.location?.hostname);
const connectionUnavailable=()=>isLocalInstance()?'暂时无法连接本机工作台。电脑重启或服务窗口关闭后，请运行比赛目录中的“启动创宇宙.cmd”，再重试；本设备改动仍保留。':'暂时无法连接工作台，请检查网络后重试；本设备改动仍保留。';
const clone = value => JSON.parse(JSON.stringify(value));
const read = (key,storage=localStorage) => { try { return JSON.parse(storage.getItem(key) || 'null'); } catch { return null; } };
const apiMessages={unauthorized:'登录已过期，请重新登录。',invalid_credentials:'账号或密码不正确。',setup_token_invalid:'初始化口令不正确，请检查后重试。',setup_closed:'账号已经建立，请刷新页面后登录。',csrf_invalid:'登录信息已更新，请重新登录。',csrf_forbidden:'登录信息已更新，请重新登录。',rate_limited:'尝试次数较多，请稍后再试。',revision_conflict:'其他设备有新内容，请先处理同步冲突。',missing_files:'部分附件尚未上传完整，请保留本机副本后重试。',invalid_password:'密码需要包含 12 至 256 位字符。',invalid_username:'请使用 2 至 64 位用户名。',file_not_found:'附件暂时不可用。',model_not_configured:'请先在偏好与连接中配置 DeepSeek。'};
Object.assign(apiMessages,{invalid_calendar:'日历格式有误，请检查日期、时间及内容。',authentication_required:'登录已过期，请重新登录。',too_many_attempts:'尝试次数较多，请稍后再试。',password_length_12_to_256:'密码需要包含 12 至 256 位字符。'});
Object.assign(apiMessages,{invalid_ledger:'账目格式有误，请检查金额、日期及所属项目。',invalid_timetable:'课表格式有误，请检查学期、周次与节次。',workspace_update_required:'此页面缺少新版资料。请先导出本设备改动，再刷新页面并加载云端内容。'});
Object.assign(apiMessages,{invalid_fitness:'运动记录格式有误，请检查日期、时长、里程和热量。',invalid_fitness_reference:'运动记录关联的空间已不存在，请同步最新工作区后重试。',invalid_space_fitness_enabled:'运动统计开关格式有误，请重新保存空间设置。'});
Object.assign(apiMessages,{invalid_competitions:'比赛记录格式有误，请检查比赛、截止日期和准备事项的关联。'});
function errorMessage(result,fallback){const value=typeof result.error==='string'?result.error:result.error?.message;return apiMessages[value]||result.message||value||fallback;}
const statusNames = {ready:'工作台已连接',saved:'已同步',saving:'正在同步',pending:'等待同步',offline:'离线 · 待同步',conflict:'同步冲突 · 已保留',remote:'其他设备有更新',result:'本次操作结果待加载',storage:'本机保存待重试',auth:'请重新登录'};

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
    const previousTab=sessionStorage.getItem(`czb-yuzhou-cloud-tab-${this.account}`);
    const reloading=performance.getEntriesByType('navigation')[0]?.type==='reload';
    const tab=reloading&&previousTab?previousTab:crypto.randomUUID();sessionStorage.setItem(`czb-yuzhou-cloud-tab-${this.account}`,tab);
    this.prefix = `czb-yuzhou-cloud-v1-${this.account}-${tab}`;
    this.cacheKey = `${this.prefix}-sync`;
    this.previousPrefix=previousTab&&previousTab!==tab?`czb-yuzhou-cloud-v1-${this.account}-${previousTab}`:null;
    this.recoveryPrefix = `czb-yuzhou-cloud-recovery-${this.account}-`;
    this.scope = `cloud-${this.account}`;
    this.mode = 'personal';
    this.setMode('personal');
    window.addEventListener('online',()=>{if(this.pending)this.flush().catch(()=>{});else this.poll();});
    window.addEventListener('offline',()=>{if(this.pending)this.setStatus('offline');});
    window.addEventListener('beforeunload',event=>{if(this.pending||this.storage?.dirty){event.preventDefault();event.returnValue='';}});
  }
  async prepareStorage(){
    this.storage=await createWorkspaceStorage(this.account);
    this.storage.onError=error=>this.setStatus('storage',error.message);
    // Carry only real unsynced work when a browser duplicates a tab. Clean tabs
    // obtain the latest server state instead of copying another full cache.
    if(this.previousPrefix){
      const cached=read(`${this.previousPrefix}-sync`,this.storage);
      if(cached?.pending){this.storage.setItem(this.cacheKey,JSON.stringify(cached));this.storage.setItem(this.key('personal'),JSON.stringify(cached.pending.state));}
    }
    await this.waitForStorage();
  }
  async waitForStorage(){await this.storage?.settled();}
  async finishInitialization(state,status){
    try{await this.waitForStorage();if(status)this.setStatus(status);}
    catch(error){this.setStatus('storage',error.message);}
    // An unavailable disk must not turn successfully read business data into a
    // blank page. Keep this document open and expose retry/export controls.
    return state;
  }
  key(mode) {return `${this.prefix}-workspace-${mode}`;}
  draftKey(value) {return `${this.prefix}-draft-${value}`;}
  recoveryCopies() {
    const copies=[];
    const accountPrefix=`czb-yuzhou-cloud-v1-${this.account}-`;
    const storage=this.storage||localStorage;
    const known=new Set();
    const add=(key,state,label)=>{if(!state||typeof state!=='object')return;const signature=JSON.stringify(state);if(!known.has(signature)){known.add(signature);copies.push({key,state,label});}};
    for(const key of storage.keys?storage.keys():Object.keys(storage)){
      if(key.startsWith(this.recoveryPrefix)){let state=read(key,storage);if(state?.cacheRecovery){try{const old=JSON.parse(state.raw);state=old.pending?.state||(old.schema===1?old:null);}catch{state=null;}}add(key,state,'冲突恢复副本');}
      else if(key!==this.cacheKey&&key.startsWith(accountPrefix)&&key.slice(accountPrefix.length).length===41&&key.endsWith('-sync')){
        const cached=read(key,storage);if(cached?.pending?.state)add(key,cached.pending.state,'其他窗口未同步副本');
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
    (this.storage||localStorage).setItem(this.cacheKey,JSON.stringify({revision:this.revision,pending:this.pending,conflict:this.status==='conflict',updatedAt:stamp()}));
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
    const cached=read(this.cacheKey,this.storage||localStorage);
    this.revision=cached?.revision||0;
    this.pending=cached?.pending||null;
    let remote;
    try{remote=await this.request('/api/workspace');}catch(error){
      const stored=read(this.key('personal'),this.storage||localStorage);
      if(error.status!==401)this.setStatus('offline',connectionUnavailable());
      return this.pending?.state||stored||empty;
    }
    if(this.pending){
      if(remote.state&&sameWorkspaceContent(this.pending.state,remote.state)){
        this.pending=null;this.revision=remote.revision;this.incoming=null;this.persist();return this.finishInitialization(remote.state,'saved');
      }
      if(cached.conflict||remote.revision!==this.revision){this.incoming=remote;this.conflict();}
      else{this.setStatus('pending');setTimeout(()=>this.flush().catch(()=>{}),500);}
      return this.finishInitialization(this.pending.state);
    }
    this.revision=remote.revision;
    this.persist();
    return this.finishInitialization(remote.state||empty,remote.state?'saved':'ready');
  }
  enqueue(state) {
    if(state.mode!=='personal')return;
    const previousPending=this.pending;
    this.pending={state:clone(state),id:crypto.randomUUID(),createdAt:stamp()};
    let persisted=false;
    try{
      this.persist();persisted=true;
      if(['conflict','result'].includes(this.status))this.preserve();
    }catch(error){
      // A failed setItem is atomic: retain the previous in-memory outbox and
      // leave its existing timer/status alone, so rejected edits cannot upload.
      this.pending=previousPending;
      if(persisted){
        try{this.persist();}catch(rollbackError){
          throw new AggregateError([error,rollbackError],'同步缓存写入失败，恢复原待同步缓存也失败；请保留并导出本机内容。');
        }
      }
      throw error;
    }
    if(['conflict','result'].includes(this.status)||!this.authenticated)return;
    if(this.mutation)return;
    this.setStatus(navigator.onLine?'pending':'offline');
    clearTimeout(this.timer);this.timer=setTimeout(()=>this.flush().catch(()=>{}),700);
  }
  preserve() {
    if(this.pending)(this.storage||localStorage).setItem(`${this.recoveryPrefix}${this.pending.id}`,JSON.stringify(this.pending.state));
  }
  conflict() {
    this.setStatus('conflict','其他设备已提交新内容。本设备改动已保留，请先导出，再加载云端内容。');
    this.preserve();this.persist();
  }
  async uploadFiles(state) {
    const refs=new Map();
    function scan(value,root=false){
      if(value&&typeof value==='object')for(const [key,item] of Object.entries(value)){
        // Match the server's domain boundary: custom-block JSON contains no
        // host attachments, even when private fields share attachment names.
        if(root&&key==='customBlocks')continue;
        if(typeof item==='string'&&/^(blobId|fileId|audioId)$/.test(key))refs.set(item,value);
        else if(item&&typeof item==='object')scan(item);
      }
    }
    scan(state,true);
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
  async flush({duringMutation=false}={}) {
    if(this.mutation&&!duringMutation)await this.mutation;
    clearTimeout(this.timer);
    if(['conflict','result'].includes(this.status))throw new Error(this.error);
    if(!this.authenticated)throw new Error('请重新登录后继续同步。');
    if(this.sending)return this.sending;
    this.sending=(async()=>{
      if(this.storage?.error)await this.storage.retry();
      await this.waitForStorage();
      while(this.pending){
        const current=this.pending;
        this.setStatus('saving');
        try{
          if(this.storage?.error)await this.storage.retry();
          await this.waitForStorage();
          await this.uploadFiles(current.state);
          const result=await this.request('/api/workspace',{method:'PUT',body:{baseRevision:this.revision,state:current.state}});
          this.revision=result.revision;
          if(this.pending.id===current.id)this.pending=null;
          this.persist();
          await this.waitForStorage();
          this.setStatus(this.pending?'pending':'saved');
        }catch(error){
          if(error.status===409&&error.code==='revision_conflict'){
            const remote=await this.request('/api/workspace');
            // A response may be lost after the server has accepted the write.
            // Treat the retry as acknowledged only when its full content agrees.
            if(sameWorkspaceContent(current.state,remote.state)){
              this.revision=remote.revision;if(this.pending?.id===current.id)this.pending=null;this.persist();await this.waitForStorage();this.setStatus(this.pending?'pending':'saved');continue;
            }
            this.incoming=remote;this.conflict();
          }
          else if(error.status===409&&error.code==='workspace_update_required'){this.setStatus('conflict',error.message);this.preserve();this.persist();}
          else if(error.name==='WorkspaceStorageError')this.setStatus('storage',error.message);
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
    if(!this.authenticated||this.sending||this.polling||this.mutation||['conflict','result'].includes(this.status))return;
    if(this.pending){this.flush().catch(()=>{});return;}
    this.polling=true;
    try{
      const remote=await this.request(`/api/workspace?since=${encodeURIComponent(this.revision)}`);
      if(this.pending||this.sending||this.mutation)return;
      if(remote.revision>this.revision){this.incoming=remote;this.setStatus('remote');this.onRemote?.(remote);}
      else if(['offline','storage'].includes(this.status)&&!this.storage?.error)this.setStatus('saved');
    }catch(error){if(error.status!==401)this.setStatus('offline',connectionUnavailable());}
    finally{this.polling=false;}
  }
  async acceptRemote(guard=()=>true) {
    if(this.mutation)throw new Error('本次操作正在执行，请稍后加载结果。');
    if(this.sending)await this.sending;
    const pendingId=this.pending?.id;
    const remote=await this.request('/api/workspace');
    if(this.mutation||pendingId!==this.pending?.id||!guard())throw new Error('本设备刚有新的编辑，已暂缓加载云端内容。');
    if(this.pending){
      this.preserve();await this.waitForStorage();
      if(this.mutation||pendingId!==this.pending?.id||!guard())throw new Error('本设备刚有新的编辑，已暂缓加载云端内容。');
    }
    this.pending=null;this.revision=remote.revision;this.incoming=null;
    this.setStatus(remote.state?'saved':'ready');this.persist();
    await this.waitForStorage();
    return remote.state;
  }
  async runWorkspaceMutation(operation,{canApply=()=>true,apply=()=>{}}={}) {
    if(this.mutation)throw new Error('上一项操作还未完成，请稍候。');
    let release;
    this.mutation=new Promise(resolve=>{release=resolve;});
    try {
      // Flush the reviewed state first, then stop layout/autosave snapshots from
      // racing a server-side write. Edits made during the request stay pending.
      await this.flush({duringMutation:true});
      const result=await operation();
      const remote=await this.request('/api/workspace');
      if(this.pending||!canApply()){
        this.incoming=remote;
        this.setStatus('result','本次操作已完成。期间的新编辑已保留，请先保存或导出本设备改动，再加载操作结果。');
        if(this.pending)this.preserve();
        this.persist();
        await this.waitForStorage();
        return {result,applied:false};
      }
      this.revision=remote.revision;this.incoming=null;
      this.setStatus(remote.state?'saved':'ready');this.persist();
      await this.waitForStorage();
      if(this.pending||!canApply()){
        this.incoming=remote;this.setStatus('result','本次操作已完成。期间的新编辑已保留，请先保存或导出本设备改动，再加载操作结果。');
        if(this.pending)this.preserve();this.persist();await this.waitForStorage();return {result,applied:false};
      }
      apply(remote.state);
      return {result,applied:true};
    } finally {
      this.mutation=null;release();
      if(this.pending&&!['conflict','result'].includes(this.status)){
        clearTimeout(this.timer);this.timer=setTimeout(()=>this.flush().catch(()=>{}),700);
      }
    }
  }
  async logout() {await this.flush();await this.request('/api/auth/logout',{method:'POST'});location.reload();}
}

function authView(setup,error='') {
  const app=document.querySelector('#app');
  app.innerHTML=`<main class="cloud-entry" id="main"><section class="cloud-welcome"><img src="./icon.svg" alt="" width="56" height="56"><span class="eyebrow">创宇宙</span><h1>搭建一个，<br>属于你的工作台。</h1><p>从空白或模板开始，组合你需要的模块。<br>让 AI 伙伴帮你搭建、排列和管理。</p><div class="cloud-entry-tags"><span>自由组合</span><span>场景模板</span><span>AI 伙伴</span></div></section><section class="cloud-login-card"><span class="cloud-entry-mark">✳</span><h2>${setup?'建立你的工作台':'欢迎回到创宇宙'}</h2><p class="muted">${setup?'设置账号，开始建立自己的工作台。':'登录账号，继续你的记录与计划。'}</p><form id="cloud-auth-form"><label class="field">账号<input name="username" required minlength="2" maxlength="64" autocomplete="username" placeholder="例如 yuzhou"></label><label class="field">密码<input name="password" type="password" required ${setup?'minlength="12"':''} maxlength="256" autocomplete="${setup?'new-password':'current-password'}" placeholder="${setup?'至少 12 位字符':'输入你的密码'}"></label>${setup?'<label class="field">初始化口令<input name="setupToken" type="password" required autocomplete="off" placeholder="部署时生成的初始化口令"></label><p class="small muted">口令仅用于首次建立账号，不会保存到浏览器。</p>':''}<p id="cloud-auth-error" class="cloud-error" role="alert">${esc(error)}</p><button class="btn primary full" type="submit">${setup?'创建账号并进入':'登录工作台'} →</button></form><p class="cloud-entry-foot">私人工作台 · 当前仅本机访问</p></section></main>`;
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
    if(health.mode!=='cloud'){sessionStorage.removeItem('czb-yuzhou-cloud-server');return null;}
    sessionStorage.setItem('czb-yuzhou-cloud-server','1');
  }catch(error){
    if(['127.0.0.1','localhost','[::1]'].includes(location.hostname)&&!sessionStorage.getItem('czb-yuzhou-cloud-server'))return null;
    const hint=connectionUnavailable();
    document.querySelector('#app').innerHTML=`<main class="cloud-entry cloud-unavailable"><section class="cloud-login-card"><h1>暂时无法连接工作台</h1><p>${esc(hint)}</p><button class="btn primary" id="cloud-retry">重新连接</button></section></main>`;
    document.querySelector('#cloud-retry').onclick=()=>location.reload();return new Promise(()=>{});
  }
  let session;
  try{const res=await fetch('/api/auth/session',{cache:'no-store',credentials:'same-origin'});if(!res.ok)throw new Error();session=await res.json();}
  catch{const form=authView(false,'暂时无法检查登录状态，请重试。');form.onsubmit=event=>{event.preventDefault();location.reload();};return new Promise(()=>{});}
  if(!session.authenticated)session=await authenticate(session);
  const client=new CloudClient(session);
  try{await client.prepareStorage();return client;}
  catch{
    document.querySelector('#app').innerHTML='<main class="cloud-entry cloud-unavailable"><section class="cloud-login-card"><h1>本机数据存储暂不可用</h1><p>旧缓存仍保留。请保留原页面，检查浏览器存储权限后重试；请勿清除浏览器数据。</p><button class="btn primary" id="storage-retry">重试加载</button></section></main>';
    document.querySelector('#storage-retry').onclick=()=>location.reload();return new Promise(()=>{});
  }
}

export function mountModelSettings(container,client,toast) {
  container.innerHTML=`<div class="section-head"><h2>DeepSeek 与 AI 管家</h2><span class="badge" id="cloud-model-badge">检查连接中</span></div><p class="muted">专用 API 密钥仅保存在本机工作台。保存密钥不会触发模型调用，也不代表真实连接验证已通过。</p><form id="cloud-model-form" autocomplete="off"><label class="field">DeepSeek API Key<input type="password" name="apiKey" autocomplete="new-password" spellcheck="false" placeholder="输入新的 API Key；留空保留现有密钥"></label><label class="field">模型<select name="model"><option value="deepseek-flash">DeepSeek Flash</option><option value="deepseek-v4-pro">DeepSeek V4 Pro</option></select></label><p class="small muted" id="cloud-hermes-state"></p><p class="small muted" id="cloud-extraction-state"></p><p class="cloud-error" role="alert"></p><button class="btn primary" type="submit">保存连接</button></form>`;
  const form=container.querySelector('form');
  function show(info){client.modelStatus=info;if(!container.isConnected)return;container.querySelector('#cloud-model-badge').textContent=modelStatusLabel(info);container.querySelector('#cloud-hermes-state').textContent=modelEngineDescription(info);const formats=Object.entries(info.extractionCapabilities||{}).filter(([,available])=>available===true).map(([name])=>name.toUpperCase());container.querySelector('#cloud-extraction-state').textContent=formats.length?`本地正文提取支持：${formats.join('、')}。可在资料预览中提取，不消耗模型额度。`:'本地正文提取能力尚未确认，可在资料预览中查看结果或具体原因。';if(info.model)form.elements.model.value=info.model;}
  client.request('/api/model/status').then(show).catch(error=>{if(container.isConnected)container.querySelector('.cloud-error').textContent=error.message;});
  form.onsubmit=async event=>{
    event.preventDefault();const button=form.querySelector('button');button.disabled=true;
    try{const result=await client.request('/api/model/config',{method:'PUT',body:{provider:'deepseek',apiKey:form.elements.apiKey.value,model:form.elements.model.value}});form.elements.apiKey.value='';show(result);toast('模型配置已保存到本机工作台，未触发模型调用。');container.querySelector('.cloud-error').textContent='';}
    catch(error){container.querySelector('.cloud-error').textContent=error.message;}
    finally{button.disabled=false;}
  };
}
