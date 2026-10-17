// Public synthetic UI acceptance; no formal data or model service.
import {mkdirSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {createWorkbenchServer} from '../yuzhou/backend/server.mjs';
import {hashPassword} from '../yuzhou/backend/store.mjs';
import {createWorkbench} from '../yuzhou/frontend/src/workbench-model.js';
import {RUNTIME_ROOT,assertRuntimePath} from '../yuzhou/runtime.mjs';
if(process.argv[2]!=='--offline-only')throw Error('Use --offline-only.');
const stamp=new Date().toISOString(),entry=(id,title,weekday)=>({id,title,weekday,startPeriod:1,endPeriod:2,weeks:[1,3,5,7],color:'#AE88FF',teacher:'测试教师',location:'教学楼101',archived:false});
const state={schema:1,mode:'personal',profile:{name:'课程关联验收',major:'合成数据',provider:'deepseek'},workbench:createWorkbench('full'),courses:[{id:'kept-course',title:'软件设计',subtitle:'原有课程',color:'#AE88FF',icon:'book',prompt:'保留偏好',updatedAt:stamp,files:[],notes:[{id:'kept-note',title:'保留的原笔记',chapter:'记录',source:'合成验收',content:'已有内容必须保留。',updatedAt:stamp,revisions:[]}]}],spaces:[],english:{},aiRequests:[],captures:[],tasks:[],ui:{sidebarPinned:false},updatedAt:stamp,timetable:{version:1,activeTermId:'qa-term',terms:[{id:'qa-term',title:'课程关联测试学期',weekOne:'2026-08-31',totalWeeks:18,teachingWeeks:18,campus:'',notes:'',periods:[{id:1,start:'08:30',end:'09:15'},{id:2,start:'09:25',end:'10:10'}],entries:[entry('qa-1','软件设计[02]',1),entry('qa-2','软件设计[02]',3),entry('qa-3','数据库[01]',4)]}]}};
assertRuntimePath(RUNTIME_ROOT);mkdirSync(RUNTIME_ROOT,{recursive:true});const dataDir=mkdtempSync(join(RUNTIME_ROOT,'dev037-browser-'));assertRuntimePath(dataDir);
const app=await createWorkbenchServer({dataDir,secureCookie:false,publicOrigin:'http://localhost:4398',setupToken:'synthetic-only-setup'});
try{app.store.createAccount('links-037',await hashPassword('synthetic-course-password'));app.store.saveWorkspace(0,state);await new Promise((done,reject)=>{app.server.once('error',reject);app.server.listen(4398,'127.0.0.1',done);});}catch(error){await app.close();throw error;}
console.log('DEV-037 offline QA: http://localhost:4398/#/timetable');console.log(`Synthetic runtime: ${dataDir}`);
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>app.close().then(()=>process.exit(0)));
