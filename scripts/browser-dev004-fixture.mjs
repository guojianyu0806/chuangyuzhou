// Local synthetic platform acceptance; the model transport never contacts a provider.
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createWorkbenchServer} from '../yuzhou/backend/server.mjs';
import {hashPassword} from '../yuzhou/backend/store.mjs';
import {createHermesService} from '../yuzhou/backend/hermes.mjs';
import {createDeepSeekRunner} from '../yuzhou/backend/deepseek.mjs';
import {RUNTIME_ROOT,assertRuntimePath} from '../yuzhou/runtime.mjs';
if(process.argv[2]!=='--offline-only')throw Error('This fixture requires --offline-only.');
assertRuntimePath(RUNTIME_ROOT);mkdirSync(RUNTIME_ROOT,{recursive:true});
const dataDir=mkdtempSync(join(RUNTIME_ROOT,'dev004-browser-'));
let calls=0;
const actions=[
 {entity:'workbenchSettings',operation:'update',id:'workbench',data:{title:'论文研究站（合成验收）'}},
 {entity:'workbenchModule',operation:'update',id:'courses',data:{enabled:true,title:'研究资料',position:1}},
 {entity:'workbenchModule',operation:'update',id:'tasks',data:{enabled:true,title:'研究清单',position:2}},
 {entity:'space',operation:'create',ref:'lab',data:{title:'实验记录（合成）',description:'仅用于搭建验收',type:'project'}},
 {entity:'note',operation:'create',containerId:'$lab',data:{title:'每周研究记录',content:'这是本机合成验收内容，不是真实研究材料。'}},
 {entity:'canvasCard',operation:'update',id:'ai',containerId:'home',data:{x:40,y:40}},
];
const runModel=createDeepSeekRunner({fetch:async()=>{
 calls++;
 const content=calls%2?{reply:'先核对当前工作台模块。',proposal:null,queries:[{kind:'get',entity:'workbenchModule',id:'courses'},{kind:'get',entity:'workbenchModule',id:'tasks'}]}:
 {reply:'已准备搭建方案，等待你审核确认。',proposal:{title:'搭建论文研究工作台',summary:'调整工作台名称与两个模块，创建一个含笔记的实验空间，并调整AI卡片位置。',destinationId:'workspace',reason:'合成验收请求',warnings:[],actions}};
 return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(content)}}]}),{headers:{'Content-Type':'application/json'}});
}});
const app=await createWorkbenchServer({dataDir,secureCookie:false,publicOrigin:'http://127.0.0.1:4398',setupToken:'synthetic-only-setup',
 modelFactory:({store})=>createHermesService({dataDir,store,engine:'deepseek-direct',runModel})});
app.store.createAccount('platform-test',await hashPassword('synthetic-platform-password'));
writeFileSync(join(dataDir,'ai/model-config.json'),JSON.stringify({provider:'deepseek',model:'deepseek-flash',apiKey:'synthetic-key-not-valid',baseUrl:'https://api.deepseek.com'}),{flag:'wx'});
await new Promise((done,reject)=>{app.server.once('error',reject);app.server.listen(4398,'127.0.0.1',done);});
console.log('DEV-004 offline platform QA: http://127.0.0.1:4398');
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>app.close().then(()=>process.exit(0)));
