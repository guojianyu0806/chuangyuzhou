// Explicit synthetic browser fixture. Never uses a real model or existing data.
import {mkdirSync,mkdtempSync} from 'node:fs';
import {resolve} from 'node:path';
import {createApp} from '../app/src/server.mjs';
import {RUNTIME_ROOT} from '../app/src/runtime.mjs';
import {planWithAI} from '../app/src/ai-planner.mjs';

if(process.argv[2]!=='--offline-only')throw Error('仅供离线浏览器验证：追加 --offline-only；不是正常启动入口。');
mkdirSync(RUNTIME_ROOT,{recursive:true});
const dataDir=mkdtempSync(resolve(RUNTIME_ROOT,'browser-fixture-'));
const app=createApp({port:4396,dataDir,setupCode:'synthetic-browser-setup',
 modelChecker:async()=>{throw Error('离线验证实例禁用模型连接测试。');},
 planner:input=>planWithAI({...input,provider:async()=>{
  if(input.message==='模拟失败')throw Error('Intentional offline failure');
  const clarify=input.message==='需要澄清';
  const content=input.message.includes('周五')?'合成安排：周五提交材料。':'合成安排：周四提交材料。';
  const actions=clarify?[]:[...(!input.workspaceId?[{op:'workspace.create',name:'离线验证空间',template:'blank',ref:'home'}]:[]),
   {op:'component.create',...(!input.workspaceId?{workspaceId:'$home'}:{}),type:'text',title:'合成材料安排',props:{content}}];
  return {text:JSON.stringify({protocolVersion:1,actions,steps:actions.length?[{title:'合成测试步骤',actionIndexes:actions.map((_,i)=>i)}]:[],
   message:clarify?'离线测试问题：请补充日期。':'离线固定输出：'+content, ...(clarify?{clarification:'请补充日期。'}:{}),evidence:[]}),model:'offline-fixture-not-ai'};
 }})});
app.store.initialize('synthetic-browser-password');
app.store.setModel({provider:'deepseek',model:'deepseek-flash',apiKey:'synthetic-never-sent'});
await app.listen();
console.log('OFFLINE FIXTURE ONLY '+app.runtime.origin);
console.log('新建合成数据目录：'+dataDir);
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>app.close().then(()=>process.exit(0)));
