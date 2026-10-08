import {createServer} from 'node:http';
import {readFileSync,writeFileSync,existsSync,statSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {createRuntime,runtimePath,projectPath} from './runtime.mjs';
import {createStore,AppError,digest,secretEqual,AI_CONTEXT_LIMITS} from './store.mjs';
import {getCatalog,getTemplates,propose,applyProposal,undoReceipt,exportTemplate,detectScheduleConflicts} from './domain.mjs';
import {planWithAI} from './ai-planner.mjs';
import {SUPPORTED_MODELS} from './deepseek-provider.mjs';
import {checkModelConnection} from './model-check.mjs';
import {getOfficeStarterStatus} from './office-starter.mjs';

const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.ico':'image/x-icon','.webmanifest':'application/manifest+json'};
const APP_VERSION='0.3.0';
const safeId=value=>typeof value==='string'&&value.length>0&&value.length<=160;
const operationScope=(workspaceId,actions)=>workspaceId&&!['workspace.create','template.import','backup.import'].includes(actions?.[0]?.op)?{workspaceId}:{};
const scheduleWarnings=state=>state.workspaces.filter(workspace=>!workspace.archived).flatMap(workspace=>detectScheduleConflicts(state,workspace.id));
export function createApp(options={}){
  const runtime=createRuntime(options),store=createStore(runtime.dataDir),planner=options.planner||planWithAI,modelChecker=options.modelChecker||checkModelConnection;
  let planning=false;
  const setupFile=runtimePath(resolve(runtime.dataDir,'setup-code.txt'));
  let setupCode=options.setupCode;
  if(!store.hasAccount()&&!setupCode){
    if(existsSync(setupFile))setupCode=readFileSync(setupFile,'utf8').trim();
    else {setupCode=randomBytes(18).toString('base64url');writeFileSync(setupFile,setupCode+'\n',{flag:'wx',mode:0o600});}
  }
  const attempts=new Map();
  function authRate(kind){
    const now=Date.now(),list=(attempts.get(kind)||[]).filter(time=>time>now-60000);
    if(list.length>=10)throw new AppError('auth_rate','尝试过于频繁，请一分钟后再试。',429);
    list.push(now);attempts.set(kind,list);
  }
  function json(res,status,value){
    res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));
  }
  function cookie(req){
    const part=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(runtime.cookieName+'='));
    return part?.slice(runtime.cookieName.length+1)||'';
  }
  function sessionResponse(res){
    const session=store.newSession();
    res.setHeader('Set-Cookie',runtime.cookieName+'='+session.token+'; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800');
    json(res,200,{authenticated:true,setupRequired:false,csrfToken:session.csrfToken});
  }
  async function readJson(req,maxBytes=2*1024*1024){
    if(!(req.headers['content-type']||'').startsWith('application/json'))throw new AppError('content_type','请使用JSON请求。',415);
    const chunks=[];let size=0;
    for await(const chunk of req){size+=chunk.length;if(size>maxBytes)throw new AppError('request_limit','请求内容过大。',413);chunks.push(chunk);}
    try{
      const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(!body||typeof body!=='object'||Array.isArray(body))throw 0;
      return body;
    }catch{throw new AppError('invalid_json','请求内容无法识别。');}
  }
  function modelStatus(){
    const config=store.getModel();
    return {configured:!!config?.apiKey,model:config?.model||SUPPORTED_MODELS[0],models:SUPPORTED_MODELS,connectionCheck:config?.connectionCheck||null};
  }
  function requireRevision(body,state){
    if(!Number.isSafeInteger(body.baseRevision)||body.baseRevision!==state.revision)throw new AppError('stale_revision','空间已变化，请刷新或重新核对后再操作。',409);
  }
  function respondChange(res,result,receipt){json(res,200,{state:result.state,receipt,history:store.history(),warnings:scheduleWarnings(result.state),officeStarter:getOfficeStarterStatus(result.state)});}
  async function route(req,res){
    if(req.headers.host!=='127.0.0.1:'+runtime.port)throw new AppError('host_rejected','请通过创宇宙本地地址访问。',403);
    if(req.headers.origin&&req.headers.origin!==runtime.origin)throw new AppError('origin_rejected','此请求来自其他应用。',403);
    if(req.headers['sec-fetch-site']==='cross-site')throw new AppError('origin_rejected','此请求来自其他应用。',403);
    const url=new URL(req.url,runtime.origin),path=url.pathname;
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if(path==='/api/health'&&req.method==='GET'){json(res,200,{productId:'chuang-universe',version:APP_VERSION,mode:'local-independent'});return;}
    const token=cookie(req),session=store.getSession(token);
    if(path==='/api/auth'&&req.method==='GET'){json(res,200,{setupRequired:!store.hasAccount(),authenticated:!!session,...(session?{csrfToken:session.csrfToken}:{})});return;}
    if(path==='/api/setup'&&req.method==='POST'){
      authRate('setup');
      if(store.hasAccount())throw new AppError('setup_closed','实例已经初始化。',409);
      const body=await readJson(req);
      if(!secretEqual(body.setupCode,setupCode))throw new AppError('setup_invalid','初始化口令不正确，请查看本实例的口令文件。',403);
      store.initialize(body.password);sessionResponse(res);return;
    }
    if(path==='/api/login'&&req.method==='POST'){
      authRate('login');const body=await readJson(req);
      if(!store.checkPassword(body.password))throw new AppError('login_invalid','密码不正确。',403);
      if(token)store.revokeSession(token);
      sessionResponse(res);return;
    }
    if(!path.startsWith('/api/')){
      if(req.method!=='GET'&&req.method!=='HEAD')throw new AppError('method_invalid','此地址不支持该操作。',405);
      const allowed=path==='/'?'index.html':decodeURIComponent(path).replace(/^\//,'');
      if(!allowed||allowed.includes('..')||allowed.includes('\\')||allowed.startsWith('.')||!MIME[extname(allowed)])throw new AppError('not_found','页面不存在。',404);
      const file=projectPath(resolve(runtime.frontendDir,allowed));
      if(!file.startsWith(runtime.frontendDir+String.fromCharCode(92))&&!file.startsWith(runtime.frontendDir+'/'))throw new AppError('not_found','页面不存在。',404);
      if(!existsSync(file)||!statSync(file).isFile())throw new AppError('not_found','页面不存在。',404);
      res.writeHead(200,{'Content-Type':MIME[extname(file)],'Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:readFileSync(file));return;
    }
    if(!session)throw new AppError('authentication_required','请先登录这个创宇宙实例。',401);
    if(req.method!=='GET'&&!secretEqual(req.headers['x-csrf-token'],session.csrfToken))throw new AppError('csrf_invalid','登录状态已变化，请刷新页面。',403);
    if(path==='/api/logout'&&req.method==='POST'){
      store.revokeSession(token);res.setHeader('Set-Cookie',runtime.cookieName+'=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');json(res,200,{ok:true});return;
    }
    if(path==='/api/state'&&req.method==='GET'){const state=store.getState();json(res,200,{state,catalog:getCatalog(),templates:getTemplates(),history:store.history(),model:modelStatus(),warnings:scheduleWarnings(state),officeStarter:getOfficeStarterStatus(state)});return;}
    if(path==='/api/history'&&req.method==='GET'){json(res,200,{history:store.history()});return;}
    if(path==='/api/ai/runs'&&req.method==='GET'){json(res,200,{runs:store.aiRuns()});return;}
    if(path.startsWith('/api/proposals/')&&req.method==='GET'){
      const id=path.slice('/api/proposals/'.length),proposal=store.getProposal(id);
      if(!proposal)throw new AppError('proposal_missing','找不到这个方案。',404);
      json(res,200,{proposal});return;
    }
    if(path==='/api/model'&&req.method==='GET'){json(res,200,modelStatus());return;}
    if(path==='/api/model'&&req.method==='POST'){
      const body=await readJson(req);
      if(!SUPPORTED_MODELS.includes(body.model))throw new AppError('model_invalid','请选择支持的DeepSeek型号。');
      const old=store.getModel();
      if(body.apiKey!==undefined&&typeof body.apiKey!=='string')throw new AppError('key_invalid','请输入有效的专用API Key。');
      const apiKey=body.apiKey?.trim()||old?.apiKey;
      if(typeof apiKey!=='string'||apiKey.length<8||apiKey.length>1024||/\s/.test(apiKey))throw new AppError('key_invalid','请输入有效的专用API Key。');
      store.setModel({provider:'deepseek',model:body.model,apiKey});json(res,200,modelStatus());return;
    }
    if(path==='/api/model/test'&&req.method==='POST'){
      await readJson(req);
      const config=store.getModel();
      if(!config?.apiKey)throw new AppError('model_not_configured','请先保存创宇宙专用模型配置。',503);
      if(planning)throw new AppError('planning_busy','还有一个模型请求正在处理，请稍候。',409);
      planning=true;
      const sameConfig=()=>{const current=store.getModel();return current?.apiKey===config.apiKey&&current?.model===config.model;};
      try{
        const check=await modelChecker({config});
        if(!sameConfig()){const error=new AppError('model_changed','测试期间模型配置已变化，请对新配置重新测试。',409);error.measurement=check.measurement;throw error;}
        store.setModel({...config,connectionCheck:check});store.recordAIRun({status:'connection_passed',measurement:check.measurement});
        json(res,200,{model:modelStatus(),check});return;
      }catch(error){
        if(sameConfig()&&error.measurement){
          store.setModel({...config,connectionCheck:{status:'failed',checkedAt:new Date().toISOString(),model:config.model,errorCode:error.code,measurement:error.measurement}});
        }
        if(error.measurement)store.recordAIRun({status:'connection_failed',errorCode:error.code,measurement:error.measurement});
        throw error;
      }finally{planning=false;}
    }
    if(path==='/api/actions/preview'&&req.method==='POST'){
      const body=await readJson(req,18*1024*1024);
      if(!safeId(body.requestId))throw new AppError('request_id','操作缺少请求编号。');
      const fingerprint=digest(JSON.stringify({workspaceId:body.workspaceId,actions:body.actions}));
      const existing=store.getProposalByRequestId(body.requestId);
      if(existing){
        if(existing.origin!=='manual'||existing.requestFingerprint!==fingerprint)throw new AppError('request_conflict','此请求编号已用于其他操作。',409);
        json(res,200,{proposal:existing,message:existing.message,replayed:true});return;
      }
      const state=store.getState();requireRevision(body,state);
      if(store.pendingCount()>=30)throw new AppError('proposal_limit','待核对方案过多，请先处理已有方案。',409);
      const proposal={...propose(state,{...operationScope(body.workspaceId,body.actions),requestId:body.requestId,actions:body.actions}),origin:'manual',requestFingerprint:fingerprint,
        message:'创建内容已准备好，请先核对预览，确认后才会保存。',explanation:'这是按你的手动选择生成的预览，没有调用AI。',steps:[],evidence:[],measurement:null,status:'pending'};
      if(Buffer.byteLength(JSON.stringify(proposal.previewState))>8*1024*1024)throw new AppError('storage_limit','恢复后的数据将超过8MB上限，请先导出整理。',413);
      proposal.warnings=scheduleWarnings(proposal.previewState);store.addProposal(proposal);
      json(res,200,{proposal,message:proposal.message});return;
    }
    if(path==='/api/actions'&&req.method==='POST'){
      const body=await readJson(req);
      if(!safeId(body.requestId))throw new AppError('request_id','操作缺少请求编号。');
      const fingerprint=digest(JSON.stringify({workspaceId:body.workspaceId,actions:body.actions}));
      const replay=store.request(body.requestId,fingerprint);
      if(replay){const state=store.getState();json(res,200,{state,receipt:replay,replayed:true,history:store.history(),officeStarter:getOfficeStarterStatus(state)});return;}
      const state=store.getState();requireRevision(body,state);
      const proposal=propose(state,{...operationScope(body.workspaceId,body.actions),requestId:body.requestId,actions:body.actions});
      const result=applyProposal(state,proposal);
      const receipt=store.commit({expectedRevision:state.revision,...result,requestId:body.requestId,fingerprint});
      respondChange(res,result,receipt);return;
    }
    if(path==='/api/ai/plan'&&req.method==='POST'){
      const body=await readJson(req);
      if(Object.keys(body).some(key=>!['baseRevision','workspaceId','selectedComponentId','message','contextId'].includes(key)))throw new AppError('ai_request_fields','请求包含不支持的字段；历史由服务器保存，请仅提交本轮请求和话题编号。');
      if(body.contextId!==undefined&&body.contextId!==''&&!safeId(body.contextId))throw new AppError('ai_context_invalid','话题编号无效。');
      const workspaceId=body.workspaceId??'',selectedComponentId=body.selectedComponentId??'';
      if(typeof workspaceId!=='string'||typeof selectedComponentId!=='string')throw new AppError('ai_invalid_target','所选空间或模块无效。');
      const state=store.getState();requireRevision(body,state);
      if(planning)throw new AppError('planning_busy','伙伴正在处理上一个请求，请稍候。',409);
      if(typeof body.message!=='string'||!body.message.trim()||body.message.length>12000)throw new AppError('message_invalid','请用1至12000个字符描述请求。');
      const parent=body.contextId?store.requireAIContext(body.contextId,{workspaceId,baseRevision:state.revision}):null;
      if(parent?.turns.length>=AI_CONTEXT_LIMITS.turns)throw new AppError('ai_context_limit','这个话题已达到8轮，请确认当前方案或开始新话题。',409);
      if(store.pendingCount()-(parent?.proposalId?1:0)>=30)throw new AppError('proposal_limit','待核对方案过多，请先处理已有方案。',409);
      const contextId=randomUUID(),messageId=randomUUID(),expiresAt=parent?.expiresAt||new Date(Date.now()+AI_CONTEXT_LIMITS.lifetimeMs).toISOString();
      const metadata={contextId,contextWorkspaceId:workspaceId,contextBaseRevision:state.revision,contextExpiresAt:expiresAt};
      planning=true;
      let lastMeasurement=null;
      try{
        const planned=await planner({state,workspaceId,message:body.message.trim(),messageId,previousTurns:structuredClone(parent?.turns||[]),selectedComponentId,config:store.getModel()});
        lastMeasurement=planned.measurement||null;
        if(store.getState().revision!==state.revision)throw new AppError('stale_revision','伙伴思考期间空间发生变化，请根据最新内容重新提出请求。',409);
        const turn={messageId,message:body.message.trim(),selectedComponentId,plan:Object.fromEntries(['actions','steps','message','explanation','clarification','evidence'].filter(key=>planned[key]!==undefined).map(key=>[key,structuredClone(planned[key])]))};
        const context={id:contextId,parentContextId:parent?.id||null,workspaceId,baseRevision:state.revision,createdAt:new Date().toISOString(),expiresAt,turns:[...(parent?.turns||[]),turn],proposalId:null};
        if(!Array.isArray(planned.actions)||planned.clarification||planned.actions.length===0){
          store.saveAIResult(context);store.recordAIRun({status:'clarification',contextId,measurement:lastMeasurement});
          json(res,200,{...metadata,proposal:null,message:planned.message,clarification:planned.clarification||true,measurement:planned.measurement,history:store.history()});return;
        }
        const proposal={...propose(state,{...operationScope(workspaceId,planned.actions),requestId:randomUUID(),actions:planned.actions}),...metadata,origin:'ai',message:planned.message||'',steps:planned.steps||[],explanation:planned.explanation||'',evidence:planned.evidence||[],measurement:planned.measurement||null,preferenceContext:state.workspaces.find(w=>w.id===workspaceId)?.preferences||null,status:'pending'};
        proposal.warnings=scheduleWarnings(proposal.previewState);
        context.proposalId=proposal.id;
        store.saveAIResult(context,proposal);store.recordAIRun({status:'proposed',contextId,proposalId:proposal.id,measurement:lastMeasurement});json(res,200,{...metadata,proposal,message:planned.message,measurement:planned.measurement,history:store.history()});return;
      }catch(error){
        const measurement=lastMeasurement||error.measurement||null;
        if(measurement){error.measurement=measurement;store.recordAIRun({status:'failed',errorCode:typeof error.code==='string'?error.code:'internal_error',measurement});}
        throw error;
      }finally{planning=false;}
    }
    if(path==='/api/ai/context/cancel'&&req.method==='POST'){
      const body=await readJson(req);
      if(!safeId(body.contextId))throw new AppError('ai_context_invalid','话题编号无效。');
      store.cancelAIContext(body.contextId);json(res,200,{ok:true,history:store.history()});return;
    }
    if(path==='/api/proposals/cancel'&&req.method==='POST'){
      const body=await readJson(req),proposal=store.getProposal(body.proposalId||'');
      if(!proposal)throw new AppError('proposal_missing','找不到这个方案。',404);
      if(proposal.status!=='pending'&&proposal.status!=='stale')throw new AppError('proposal_closed','这个方案已处理。',409);
      store.setProposalStatus(proposal.id,'cancelled');json(res,200,{ok:true,history:store.history()});return;
    }
    if(path==='/api/proposals/confirm'&&req.method==='POST'){
      const body=await readJson(req),proposal=store.getProposal(body.proposalId||'');
      if(!proposal)throw new AppError('proposal_missing','找不到这个方案。',404);
      const requestId='confirm:'+proposal.id,fingerprint=digest(requestId),replay=store.request(requestId,fingerprint);
      if(replay){const state=store.getState();json(res,200,{state,receipt:replay,replayed:true,history:store.history(),officeStarter:getOfficeStarterStatus(state)});return;}
      const state=store.getState();
      if(proposal.status!=='pending')throw new AppError('proposal_closed','这个方案不能再执行。',409);
      if(proposal.baseRevision!==state.revision){store.setProposalStatus(proposal.id,'stale');throw new AppError('stale_revision','方案生成后空间已改变，请重新提出请求。',409);}
      if(proposal.contextId)store.requireAIContext(proposal.contextId,{workspaceId:proposal.contextWorkspaceId,baseRevision:state.revision});
      const result=applyProposal(state,proposal);
      result.receipt={...result.receipt,origin:proposal.origin,message:proposal.message,steps:proposal.steps,explanation:proposal.explanation,measurement:proposal.measurement,evidence:proposal.evidence,preferenceContext:proposal.preferenceContext};
      const receipt=store.commit({expectedRevision:state.revision,...result,requestId,fingerprint,proposalId:proposal.id});
      respondChange(res,result,receipt);return;
    }
    if(path==='/api/undo'&&req.method==='POST'){
      const body=await readJson(req),original=store.getReceipt(body.receiptId||'');
      if(!original)throw new AppError('receipt_missing','找不到这次修改。',404);
      const requestId='undo:'+original.id,fingerprint=digest(requestId),replay=store.request(requestId,fingerprint);
      if(replay){const state=store.getState();json(res,200,{state,receipt:replay,replayed:true,history:store.history(),officeStarter:getOfficeStarterStatus(state)});return;}
      if(original.undoneBy||original.undoOf)throw new AppError('already_undone','这条记录不能再次撤销。',409);
      const state=store.getState(),result=undoReceipt(state,original);
      const receipt=store.commit({expectedRevision:state.revision,...result,requestId,fingerprint,undoOf:original.id});
      respondChange(res,result,receipt);return;
    }
    if(path==='/api/template'&&req.method==='GET'){
      const template=exportTemplate(store.getState(),url.searchParams.get('workspaceId'));
      res.setHeader('Content-Disposition','attachment; filename="chuang-universe-template.json"');json(res,200,template);return;
    }
    if(path==='/api/export'&&req.method==='GET'){
      res.setHeader('Content-Disposition','attachment; filename="chuang-universe-data.json"');json(res,200,{format:'chuang-universe-export',version:1,exportedAt:new Date().toISOString(),state:store.getState()});return;
    }
    throw new AppError('not_found','接口不存在。',404);
  }
  const server=createServer((req,res)=>route(req,res).catch(error=>{
    if(res.headersSent){res.destroy();return;}
    const safe=typeof error.code==='string'&&/^[a-z][a-z0-9_]+$/.test(error.code);
    json(res,safe?(error.status||400):500,{error:{code:safe?error.code:'internal_error',message:safe?error.message:'操作未完成，请重新打开页面后再试。'},...(safe&&error.measurement?{measurement:error.measurement}:{})});
  }));
  server.requestTimeout=120000;server.headersTimeout=15000;
  return {server,store,runtime,listen:()=>new Promise((resolveListen,reject)=>{server.once('error',reject);server.listen(runtime.port,runtime.host,()=>{server.removeListener('error',reject);resolveListen(runtime.origin);});}),close:()=>new Promise((done,reject)=>{server.close(error=>{store.close();error?reject(error):done();});server.closeIdleConnections();})};
}
