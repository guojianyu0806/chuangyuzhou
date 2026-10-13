// DEV-019 offline acceptance only. No credentials or data from the formal service.
import {mkdirSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {createWorkbenchServer} from '../yuzhou/backend/server.mjs';
import {hashPassword} from '../yuzhou/backend/store.mjs';
import {createWorkbench} from '../yuzhou/frontend/src/workbench-model.js';
import {RUNTIME_ROOT,assertRuntimePath} from '../yuzhou/runtime.mjs';

if(process.argv[2]!=='--offline-only')throw Error('Use --offline-only.');
assertRuntimePath(RUNTIME_ROOT);mkdirSync(RUNTIME_ROOT,{recursive:true});
const dataDir=mkdtempSync(join(RUNTIME_ROOT,'dev019-browser-'));
assertRuntimePath(dataDir);
const stamp=new Date().toISOString();
const state={schema:1,mode:'personal',profile:{name:'示例导览 · 合成验收',major:'本实例所有记录均为合成数据',provider:'deepseek'},
  workbench:createWorkbench('blank'),courses:[],spaces:[],english:{},aiRequests:[],
  captures:[{id:'dev019-existing-capture',text:'既有合成记录：导入示例后仍应完整保留。',category:'备忘',tags:'保留检查',archived:false,createdAt:stamp}],
  tasks:[{id:'dev019-existing-task',title:'既有合成待办：不能被示例覆盖',description:'验收原记录完整保留。',category:'个人',date:'',priority:'normal',done:false,archived:false,createdAt:stamp}],
  ui:{sidebarPinned:true},canvas:{cards:[{id:'ai',x:120,y:80,w:400,h:300,color:'#B3A0FF'}],view:{x:0,y:0,zoom:1},snap:true},updatedAt:stamp};
const app=await createWorkbenchServer({dataDir,secureCookie:false,publicOrigin:'http://127.0.0.1:4398',setupToken:'synthetic-only-setup'});
try{
  app.store.createAccount('platform-test',await hashPassword('synthetic-platform-password'));
  app.store.saveWorkspace(0,state);
  await new Promise((done,reject)=>{app.server.once('error',reject);app.server.listen(4398,'127.0.0.1',done);});
}catch(error){await app.close();throw error;}
console.log('DEV-019 offline gallery QA: http://127.0.0.1:4398/#/builder');
console.log(`Synthetic runtime only: ${dataDir}`);
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>app.close().then(()=>process.exit(0)));
