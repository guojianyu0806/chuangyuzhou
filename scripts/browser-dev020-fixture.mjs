// DEV-020 offline acceptance only. Uses generated examples, never the formal runtime.
import {mkdirSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {createWorkbenchServer} from '../yuzhou/backend/server.mjs';
import {hashPassword} from '../yuzhou/backend/store.mjs';
import {createWorkbench} from '../yuzhou/frontend/src/workbench-model.js';
import {planShowcaseGallery} from '../yuzhou/frontend/src/showcase-gallery.js';
import {RUNTIME_ROOT,assertRuntimePath} from '../yuzhou/runtime.mjs';

if(process.argv[2]!=='--offline-only')throw Error('Use --offline-only.');
const now=new Date(),stamp=now.toISOString();
const blank={schema:1,mode:'personal',profile:{name:'卡片自适应 · 合成验收',major:'本实例所有记录均为合成数据',provider:'deepseek'},
  workbench:createWorkbench('blank'),courses:[],spaces:[],english:{},aiRequests:[],captures:[],tasks:[],
  ui:{sidebarPinned:false},canvas:{cards:[],view:{x:24,y:24,zoom:1},snap:false,presentation:'canvas',initialized:true},updatedAt:stamp};
const state=structuredClone(planShowcaseGallery(blank,{now}).nextState);
// Three columns keep the illustrated home cards near the first viewport. The AI
// card gets its own last row, so its wider form does not overlap another card.
const firstIds=['review','courses','english','inbox','tasks','ledger','calendar','timetable','competitions'];
const byId=new Map(state.canvas.cards.map(card=>[card.id,card]));
const cards=[...firstIds.map(id=>byId.get(id)),...state.canvas.cards.filter(card=>!firstIds.includes(card.id)&&card.id!=='ai')];
cards.forEach((card,index)=>Object.assign(card,{x:(index%3)*370,y:Math.floor(index/3)*420,w:320,h:card.id==='review'?238:card.id==='english'?344:300}));
const ai=byId.get('ai');
Object.assign(ai,{x:0,y:Math.ceil(cards.length/3)*420,w:540,h:380});
state.canvas={...state.canvas,cards:[...cards,ai],view:{x:24,y:24,zoom:1},snap:false,presentation:'canvas',initialized:true};

assertRuntimePath(RUNTIME_ROOT);mkdirSync(RUNTIME_ROOT,{recursive:true});
const dataDir=mkdtempSync(join(RUNTIME_ROOT,'dev020-browser-'));
assertRuntimePath(dataDir);
// No modelService/modelFactory is supplied: all model requests remain offline.
const app=await createWorkbenchServer({dataDir,secureCookie:false,publicOrigin:'http://127.0.0.1:4398',setupToken:'synthetic-only-setup'});
try{
  app.store.createAccount('platform-test',await hashPassword('synthetic-platform-password'));
  app.store.saveWorkspace(0,state);
  await new Promise((done,reject)=>{app.server.once('error',reject);app.server.listen(4398,'127.0.0.1',done);});
}catch(error){await app.close();throw error;}
console.log('DEV-020 offline card resize QA: http://127.0.0.1:4398/#/home');
console.log(`Synthetic runtime only: ${dataDir}`);
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>app.close().then(()=>process.exit(0)));
