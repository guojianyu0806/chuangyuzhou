// Synthetic QA only. Every model response comes from a local injected transport.
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createWorkbenchServer} from '../yuzhou/backend/server.mjs';
import {hashPassword} from '../yuzhou/backend/store.mjs';
import {createHermesService} from '../yuzhou/backend/hermes.mjs';
import {createDeepSeekRunner} from '../yuzhou/backend/deepseek.mjs';
import {createDocumentExtractor,loadExtractorConfig} from '../yuzhou/backend/extractor.mjs';
import {RUNTIME_ROOT,assertRuntimePath} from '../yuzhou/runtime.mjs';
if(process.argv[2]!=='--offline-only')throw Error('This fixture requires --offline-only.');
assertRuntimePath(RUNTIME_ROOT);mkdirSync(RUNTIME_ROOT,{recursive:true});
const dataDir=mkdtempSync(join(RUNTIME_ROOT,'dev003-browser-'));
const extractor=createDocumentExtractor(loadExtractorConfig());
let calls=0;
const runModel=createDeepSeekRunner({fetch:async()=>{
 calls++;
 const proposal={title:'核对比赛说明',summary:'这是离线合成验收建议，确认后新增一条待办。',destinationId:'tasks',reason:'依据测试请求。',warnings:[],notes:[],tasks:[{title:'核对比赛说明',date:'',priority:'normal',description:'仅用于DEV-003离线验收'}]};
 return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({reply:'已整理一条待办，请审核后确认执行。',proposal})}}]}),{headers:{'Content-Type':'application/json'}});
}});
const app=await createWorkbenchServer({dataDir,secureCookie:false,publicOrigin:'http://127.0.0.1:4398',setupToken:'synthetic-only-setup',extractFile:extractor.extractFile,
 modelFactory:({store})=>createHermesService({dataDir,store,engine:'deepseek-direct',runModel,extractFile:extractor.extractFile,extractionCapabilities:extractor.capabilities})});
app.store.createAccount('browser-test',await hashPassword('synthetic-browser-password'));
writeFileSync(join(dataDir,'ai/model-config.json'),JSON.stringify({provider:'deepseek',model:'deepseek-flash',apiKey:'synthetic-key-not-valid',baseUrl:'https://api.deepseek.com'}),{flag:'wx'});
await new Promise((done,reject)=>{app.server.once('error',reject);app.server.listen(4398,'127.0.0.1',done);});
console.log('DEV-003 offline QA on http://127.0.0.1:4398 (no external model requests).');
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>app.close().then(()=>{console.log('Offline simulated model calls: '+calls);process.exit(0);}));
