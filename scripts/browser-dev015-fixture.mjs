// DEV-015 browser acceptance fixture. All records are synthetic and stay in this copy.
// Run explicitly with --offline-only. No model service, transport, or API key is configured.
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createWorkbenchServer} from '../yuzhou/backend/server.mjs';
import {digest,hashPassword} from '../yuzhou/backend/store.mjs';
import {createWorkbench,configureWorkbench} from '../yuzhou/frontend/src/workbench-model.js';
import {RUNTIME_ROOT,assertRuntimePath} from '../yuzhou/runtime.mjs';

if(process.argv[2]!=='--offline-only')throw Error('This fixture requires --offline-only.');
assertRuntimePath(RUNTIME_ROOT);mkdirSync(RUNTIME_ROOT,{recursive:true});
const dataDir=mkdtempSync(join(RUNTIME_ROOT,'dev015-browser-'));
assertRuntimePath(dataDir);
const stamp='2026-10-09T08:00:00.000Z';
const ideas=[
  ['dev015-spark','如果灵感可以先长出来，再慢慢整理呢？','备忘','演示,随手一想','#FF9CCE'],
  ['dev015-learn','演示想法：把学习笔记变成可以提问的小卡片。\n\n每张卡片先写一个自己还没讲清楚的问题，再补上例子。复习时不要先打开答案，而是试着用一句话说明，并把仍然模糊的地方留给下一次探索。','学习灵感','演示,学习方法','#D8F649'],
  ['dev015-english','演示英语练习：用三个英文句子介绍自己的工作台。先说明解决什么问题，再介绍一个操作，最后邀请对方试一试。','英语','演示,表达','#9DC5FF'],
  ['dev015-link','演示链接：https://example.com/idea-notes\n想给收藏的链接留下一句话：我为什么保存它？','链接','演示,资料整理','#8EDBE8'],
  ['dev015-message','演示消息摘录：先让一个陌生人完成“记下想法 → 整理 → 转为待办”，观察哪里需要解释。这里只是虚构的评审建议，不是真实聊天记录。','消息摘录','演示,体验观察','#FFBC7C'],
  ['dev015-light','留一点空白，新的念头才有地方落下。','备忘','演示,留白','#AE88FF'],
  ['dev015-project','演示项目构想：让 AI 先提出三种整理方式，人可以选择保留原样、按主题分组，或只把一条想法变成下一步。\n\n每次改变都能看见原因。零散的句子不必立刻被归类；也许过几天，同一句话会与另一条记录碰撞出新的方向。','学习灵感','演示,AI伙伴,创作','#63E6DC'],
  ['dev015-file','演示附件：一份手写思路的文字转录，保留原件用于下载验收。','备忘','演示,附件','#D8F649'],
  ['dev015-archived','已归档演示：上一轮考虑过按日期堆叠所有卡片，这条记录暂时收起，仍可以恢复。','备忘','演示,旧想法','#FF9CCE'],
];
const state={schema:1,mode:'personal',profile:{name:'灵感墙演示',major:'全部为合成验收内容',provider:'deepseek'},
  workbench:createWorkbench('blank'),courses:[],spaces:[],english:{},aiRequests:[],
  captures:ideas.map(([id,text,category,tags,color],index)=>({id,text,category,tags,color,archived:id==='dev015-archived',createdAt:new Date(Date.parse(stamp)+index*60000).toISOString()})),
  tasks:[{id:'dev015-linked-task',title:'演示待办：用三句话介绍工作台',description:'与英语灵感通过 captureId 关联，用于验证重复转换保护。',category:'英语',date:'',priority:'normal',done:false,archived:false,source:'收集箱 · 英语',captureId:'dev015-english',createdAt:stamp}],
  ui:{inboxView:'cards',sidebarPinned:true},
  boards:{inbox:{presentation:'canvas',customized:true,initialized:true,snap:true,
    cards:[{id:'dev015-spark',x:136,y:92,w:360,h:280,color:'#FF9CCE'},{id:'dev015-learn',x:612,y:284,w:380,h:320,color:'#D8F649'}],
    view:{x:28,y:-16,zoom:.8}}},updatedAt:stamp};
configureWorkbench(state,{title:'灵感墙 · 合成验收',moduleId:'inbox',enabled:true});
configureWorkbench(state,{moduleId:'tasks',enabled:true});

const app=await createWorkbenchServer({dataDir,secureCookie:false,publicOrigin:'http://127.0.0.1:4398',setupToken:'synthetic-only-setup'});
try{
  app.store.createAccount('platform-test',await hashPassword('synthetic-platform-password'));
  const original=Buffer.from('DEV-015 合成附件\n\n主题：灵感如何从碎片变成行动\n1. 先记录，不要求完整。\n2. 保留当时的上下文。\n3. 选择一条转成可以完成的小事。\n\n本文件没有真实个人信息，仅供本比赛复制件验收。\n','utf8');
  const temporary=join(app.store.tempDir,'dev015-inspiration.part');
  assertRuntimePath(temporary);writeFileSync(temporary,original,{flag:'wx'});
  app.store.commitFile('dev015-inspiration-text',temporary,{name:'灵感整理演示.txt',type:'text/plain',size:original.length,sha256:digest(original)});
  Object.assign(state.captures.find(c=>c.id==='dev015-file'),{blobId:'dev015-inspiration-text',fileName:'灵感整理演示.txt',fileType:'text/plain'});
  app.store.saveWorkspace(0,state);
  await new Promise((done,reject)=>{app.server.once('error',reject);app.server.listen(4398,'127.0.0.1',done);});
}catch(error){await app.close();throw error;}
console.log('DEV-015 offline inspiration QA: http://127.0.0.1:4398/#/inbox');
console.log(`Synthetic runtime only: ${dataDir}`);
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>app.close().then(()=>process.exit(0)));
