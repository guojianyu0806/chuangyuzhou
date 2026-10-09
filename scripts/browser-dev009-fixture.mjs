// Synthetic DEV-009 acceptance only: all model transport is injected and stays offline.
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createWorkbenchServer} from '../yuzhou/backend/server.mjs';
import {hashPassword} from '../yuzhou/backend/store.mjs';
import {createHermesService} from '../yuzhou/backend/hermes.mjs';
import {createDeepSeekRunner} from '../yuzhou/backend/deepseek.mjs';
import {createPresetInput} from '../yuzhou/frontend/src/custom-block-presets.js';
import {RUNTIME_ROOT,assertRuntimePath} from '../yuzhou/runtime.mjs';

if(process.argv[2]!=='--offline-only')throw Error('This fixture requires --offline-only.');
assertRuntimePath(RUNTIME_ROOT);mkdirSync(RUNTIME_ROOT,{recursive:true});
const dataDir=mkdtempSync(join(RUNTIME_ROOT,'dev009-browser-'));
assertRuntimePath(dataDir);
const calculator={...createPresetInput('calculator'),title:'AI计算器（合成验收）',description:'固定离线方案生成的计算工具，仅使用本方块输入和数据。'};
const actions=[
  {entity:'customBlock',operation:'create',ref:'synthetic_note',data:{kind:'note',title:'AI项目说明（合成验收）',description:'固定离线方案生成的文字方块。',config:{text:'这是本机合成验收内容。\n\n目标：先审核方案，再创建文字方块与交互工具。\n\n不包含真实个人资料，不代表真实模型效果。'},data:{}}},
  {entity:'customBlock',operation:'create',ref:'synthetic_calculator',data:calculator},
];
let calls=0;
const runModel=createDeepSeekRunner({fetch:async()=>{
  calls++;
  const content=calls%2?
    {reply:'先核对当前自定义方块目录，避免误用其他内容。',proposal:null,queries:[{kind:'search',entity:'customBlock'}]}:
    {reply:'已准备一个文字方块和一个交互计算器，请先检查方案再确认。',proposal:{title:'创建项目说明与计算工具',summary:'创建两个独立方块；计算器代码仅在你主动运行后进入隔离运行器。',destinationId:'workspace',reason:'本机离线合成验收',warnings:['这是固定合成输出，不代表真实模型效果。','创建方块不会自动执行小程序代码。'],actions}};
  return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(content)}}]}),{headers:{'Content-Type':'application/json'}});
}});
const app=await createWorkbenchServer({dataDir,secureCookie:false,publicOrigin:'http://127.0.0.1:4398',setupToken:'synthetic-only-setup',
  modelFactory:({store})=>createHermesService({dataDir,store,engine:'deepseek-direct',runModel})});
app.store.createAccount('platform-test',await hashPassword('synthetic-platform-password'));
writeFileSync(join(dataDir,'ai/model-config.json'),JSON.stringify({provider:'deepseek',model:'deepseek-flash',apiKey:'synthetic-key-not-valid',baseUrl:'https://api.deepseek.com'}),{flag:'wx'});
try{await new Promise((done,reject)=>{app.server.once('error',reject);app.server.listen(4398,'127.0.0.1',done);});}
catch(error){await app.close();throw error;}
console.log('DEV-009 offline custom-block QA: http://127.0.0.1:4398');
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>app.close().then(()=>process.exit(0)));
