// DEV-017 browser acceptance fixture. Every record is synthetic and stays in this copy.
// Run explicitly with --offline-only. No model service, transport, or API key is configured.
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createWorkbenchServer} from '../yuzhou/backend/server.mjs';
import {digest,hashPassword} from '../yuzhou/backend/store.mjs';
import {createWorkbench,configureWorkbench} from '../yuzhou/frontend/src/workbench-model.js';
import {RUNTIME_ROOT,assertRuntimePath} from '../yuzhou/runtime.mjs';

if(process.argv[2]!=='--offline-only')throw Error('This fixture requires --offline-only.');
assertRuntimePath(RUNTIME_ROOT);mkdirSync(RUNTIME_ROOT,{recursive:true});
const dataDir=mkdtempSync(join(RUNTIME_ROOT,'dev017-browser-'));
assertRuntimePath(dataDir);
const stamp='2026-10-12T08:00:00.000Z';
// Dates are deliberately spread across months so older thoughts can resurface.
const ideas=[
  ['dev017-window','雨滴滑过窗户的时候，整座城市像一张还没写完的草稿。','备忘','合成,城市,观察','#FF9CCE','2026-03-18T10:12:00.000Z'],
  ['dev017-dialogue','让故事从一句被打断的对话开始。','学习灵感','合成,写作,开场','#D8F649','2026-04-02T13:40:00.000Z'],
  ['dev017-light','界面里的留白也许不是空的，是给下一个念头留的位置。','备忘','合成,设计,留白','#AE88FF','2026-04-19T02:30:00.000Z'],
  ['dev017-map','如果把一周的阅读画成地图，问题就是路口，例子就是路标。\n\n不急着把每本书归到某个文件夹：先找出两段文字里共同出现的疑问。下次重看时，可以从疑问出发，把原来很远的内容接起来。','学习灵感','合成,学习,地图','#63E6DC','2026-05-06T06:15:00.000Z'],
  ['dev017-sound','开场先听见钥匙转动，再看见门。','备忘','合成,声音,叙事','#FFBC7C','2026-05-28T11:48:00.000Z'],
  ['dev017-english','What if an old idea could surprise you again?\n这句英语可以放在创作页，提醒自己换一个角度看旧笔记。','英语','合成,表达,旧念头','#9DC5FF','2026-06-07T03:22:00.000Z'],
  ['dev017-margin','页边写下的问题，常常比被划线的答案更值得重读。','学习灵感','合成,学习,提问','#D8F649','2026-06-23T14:06:00.000Z'],
  ['dev017-link','给收藏夹里的每个链接留一句“为什么被它吸引”。\n合成资料链接：https://example.com/creative-notes','链接','合成,资料,收藏','#8EDBE8','2026-07-11T07:35:00.000Z'],
  ['dev017-dialogue-long','合成对话摘录：我们总在想怎样把页面装满，也许可以先问，人打开它的第一秒最需要什么。\n\n一个停下来的地方，一句还没完成的话，或者一个能继续昨天思路的入口。先让这些被看见，再讨论按钮应该放在哪儿。','消息摘录','合成,设计,入口','#FFBC7C','2026-07-29T04:20:00.000Z'],
  ['dev017-thread','把两个不相干的词放在一起：植物 × 时间。会不会长出一个记录成长的日历？','学习灵感','合成,组合,日历','#63E6DC','2026-08-13T12:05:00.000Z'],
  ['dev017-paper','纸张折痕也能成为导航。','备忘','合成,触感,设计','#FF9CCE','2026-08-27T09:51:00.000Z'],
  ['dev017-file','今天录下的风声，让我想起去年夏天没写完的那个故事。附件里留了三段场景草稿，之后再打开看看。','备忘','合成,附件,故事','#D8F649','2026-09-09T08:16:00.000Z'],
  ['dev017-html','纯文本验收：<img src=x onerror="window.__dev017Unsafe=true">\n这些符号是笔记正文，应该原样显示，不能变成图片或执行代码。','备忘','合成,安全验收,纯文本','#9DC5FF','2026-09-24T05:42:00.000Z'],
  ['dev017-restart','卡住的时候，先找一个曾经让自己好奇的小问题。','学习灵感','合成,创作,重新开始','#AE88FF','2026-10-11T15:20:00.000Z'],
  ['dev017-archived-grid','已归档合成想法：用非常密集的表格展示所有创作片段。暂时放下这个方向，保留原记录供恢复验收。','备忘','合成,归档,旧方案','#FF9CCE','2026-04-10T01:18:00.000Z'],
  ['dev017-archived-clock','已归档合成想法：为每个想法设置必须完成的倒计时。后来决定让未成熟的想法先自由生长。','学习灵感','合成,归档,旧方案','#8EDBE8','2026-08-01T10:04:00.000Z'],
];
const state={schema:1,mode:'personal',profile:{name:'梦境流动 · 合成验收',major:'全部内容为虚构的创作验收样本',provider:'deepseek'},
  workbench:createWorkbench('blank'),courses:[],spaces:[],english:{},aiRequests:[],
  captures:ideas.map(([id,text,category,tags,color,createdAt])=>({id,text,category,tags,color,archived:id.startsWith('dev017-archived-'),createdAt})),
  tasks:[{id:'dev017-linked-task',title:'合成待办：试写一个从对话开始的故事',description:'通过 captureId 关联原始灵感，用于验证重复转换保护。',category:'创作',date:'',priority:'normal',done:false,archived:false,source:'收集箱 · 学习灵感',captureId:'dev017-dialogue',createdAt:stamp}],
  ui:{inboxView:'dream',sidebarPinned:true},
  boards:{inbox:{presentation:'canvas',customized:true,initialized:true,snap:true,
    cards:[{id:'dev017-window',x:136,y:92,w:360,h:280,color:'#FF9CCE'},{id:'dev017-map',x:612,y:284,w:380,h:320,color:'#63E6DC'}],
    view:{x:28,y:-16,zoom:.8}}},updatedAt:stamp};
configureWorkbench(state,{title:'梦境流动 · 合成验收',moduleId:'inbox',enabled:true});
configureWorkbench(state,{moduleId:'tasks',enabled:true});

const app=await createWorkbenchServer({dataDir,secureCookie:false,publicOrigin:'http://127.0.0.1:4398',setupToken:'synthetic-only-setup'});
try{
  app.store.createAccount('platform-test',await hashPassword('synthetic-platform-password'));
  const original=Buffer.from('DEV-017 合成附件\n\n主题：风声里的三个场景\n1. 空教室里翻动的书页，人物还没出场。\n2. 屋檐下停了一辆旧自行车，车铃被风碰响。\n3. 夜里打开窗，远处传来一段听不完整的旋律。\n\n以上片段全部虚构，仅供本比赛复制件验收。\n','utf8');
  const temporary=join(app.store.tempDir,'dev017-dream.part');
  assertRuntimePath(temporary);writeFileSync(temporary,original,{flag:'wx'});
  app.store.commitFile('dev017-dream-text',temporary,{name:'梦境场景合成草稿.txt',type:'text/plain',size:original.length,sha256:digest(original)});
  Object.assign(state.captures.find(c=>c.id==='dev017-file'),{blobId:'dev017-dream-text',fileName:'梦境场景合成草稿.txt',fileType:'text/plain'});
  app.store.saveWorkspace(0,state);
  await new Promise((done,reject)=>{app.server.once('error',reject);app.server.listen(4398,'127.0.0.1',done);});
}catch(error){await app.close();throw error;}
console.log('DEV-017 offline dream QA: http://127.0.0.1:4398/#/inbox');
console.log(`Synthetic runtime only: ${dataDir}`);
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>app.close().then(()=>process.exit(0)));
