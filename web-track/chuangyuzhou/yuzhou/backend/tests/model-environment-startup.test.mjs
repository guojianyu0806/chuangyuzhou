import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {startCompetitionWorkbench} from '../../start.mjs';
import {portFree} from '../../launch.mjs';
import {RUNTIME_ROOT,assertRuntimePath} from '../../runtime.mjs';

test('the real Web bootstrap supplies its environment to the authenticated model service without a local key file',async t=>{
  assert.equal(await portFree(4396),true,'Web port is occupied; this check never stops another service.');
  const parent=assertRuntimePath(join(RUNTIME_ROOT,'tests-temp'));mkdirSync(parent,{recursive:true});
  const dataDir=assertRuntimePath(mkdtempSync(join(parent,'environment-bootstrap-')));
  const setupToken='synthetic-startup-setup-token-2026';
  const key='synthetic-startup-key-no-provider-2026';
  const setupTokenFile=join(dataDir,'setup-code.txt');writeFileSync(setupTokenFile,setupToken,{flag:'wx'});
  const originalFetch=globalThis.fetch,originalLog=console.log,requests=[],startupLog=[];
  const syntheticFetch=async(url,options)=>{
    assert.equal(url,'https://api.deepseek.com/chat/completions');requests.push(options);
    return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({title:'合成整理',summary:'整理原文',notes:[{title:'复习安排',content:'明天复习数据结构。',sourceIds:['input']}],tasks:[],destinationId:'inbox',reason:'依据原文',warnings:[]})}}]});
  };
  let app;
  try{
    globalThis.fetch=syntheticFetch;
    console.log=(...values)=>startupLog.push(values.map(String).join(' '));
    app=await startCompetitionWorkbench({dataDir,setupTokenFile},{DEEPSEEK_API_KEY:key,DEEPSEEK_MODEL:'deepseek-reasoner'});
  }finally{globalThis.fetch=originalFetch;console.log=originalLog;}
  t.after(async()=>{await app?.close();rmSync(assertRuntimePath(dataDir),{recursive:true,force:true});});
  app.store.saveWorkspace(0,{schema:1,mode:'personal',profile:{name:'合成测试',major:'',provider:'deepseek'},courses:[],spaces:[],tasks:[],captures:[],english:{},calendar:{version:1,events:[]},ledger:{version:1,currency:'CNY',projects:[],entries:[]},aiRequests:[],aiDraft:{text:'',files:[],targetId:'auto'},updatedAt:'2026-10-23T00:00:00.000Z'});
  const origin='http://127.0.0.1:4396';let cookie='',csrf='';
  async function api(path,body){
    const response=await originalFetch(origin+path,{method:body===undefined?'GET':'POST',headers:{...(body!==undefined?{'Content-Type':'application/json',Origin:origin}:{}),...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
    if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
    const value=await response.json();if(value.csrfToken)csrf=value.csrfToken;
    assert.equal(JSON.stringify(value).includes(key),false);return {status:response.status,body:value};
  }
  assert.equal(requests.length,0);
  assert.equal(startupLog.join('\n').includes(key),false);
  assert.equal((await api('/api/auth/setup',{username:'startup-fixture',password:'synthetic-startup-password',setupToken})).status,201);
  const status=(await api('/api/model/status')).body;
  assert.equal(status.configured,true);assert.equal(status.configurationSource,'environment');assert.equal(status.configurationManaged,true);assert.equal(status.model,'deepseek-reasoner');
  assert.equal(requests.length,0);
  const started=await api('/api/ai/jobs',{requestId:'environment-bootstrap',text:'明天复习数据结构。',destinationId:'inbox'});assert.equal(started.status,202);
  let job;
  for(let attempt=0;attempt<200;attempt++){
    job=(await api('/api/ai/jobs/'+started.body.job.id)).body.job;
    if(['succeeded','failed'].includes(job.status))break;
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  assert.equal(job.status,'succeeded',JSON.stringify(job.error));assert.equal(requests.length,1);
  assert.equal(requests[0].headers.Authorization,'Bearer '+key);assert.equal(JSON.parse(requests[0].body).model,'deepseek-reasoner');
  assert.equal(existsSync(join(dataDir,'ai/model-config.json')),false);
});
