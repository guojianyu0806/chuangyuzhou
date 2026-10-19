import test from 'node:test';
import assert from 'node:assert/strict';
import {getWelcomeModel,MAX_WELCOME_CARDS} from '../src/welcome-model.js';
import {createWorkbench,configureWorkbench} from '../src/workbench-model.js';
import {createCustomBlock,updateCustomBlock} from '../src/custom-blocks-model.js';
import {ensureCanvas,visibleCanvasCards} from '../src/canvas.js';

const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const basic=()=>({workbench:createWorkbench('full'),profile:{name:'观察者'},spaces:[],tasks:[],captures:[],courses:[]});
const addBlock=(state,kind='note',suffix=kind)=>createCustomBlock(state,{kind,title:`自建${suffix}`},{id:`block:${suffix}`,now:'2026-10-13T12:00:00.000Z'});

test('welcome reads new and legacy workspaces without initializing business state or canvas',()=>{
  const fresh=freeze({workbench:createWorkbench('blank')});
  assert.deepEqual(getWelcomeModel(fresh).cards.map(card=>card.id),['ai']);
  assert.equal(getWelcomeModel(fresh).owner,'');
  assert.equal(fresh.canvas,undefined);
  const legacy=freeze({});
  assert.equal(getWelcomeModel(legacy).cards.length,10);
  assert.deepEqual(legacy,{});
  assert.equal(getWelcomeModel(null).title,'我的工作台');
});

test('welcome follows canvas membership, module names/order and saved colors without modifying geometry',()=>{
  const state=basic();state.spaces.push({id:'research',title:'研究角',color:'#123456',icon:'book',notes:[]});
  addBlock(state);
  configureWorkbench(state,{title:'创作宇宙',moduleId:'courses',moduleTitle:'知识花园',position:0});
  configureWorkbench(state,{moduleId:'ledger',enabled:false});
  ensureCanvas(state);
  state.canvas.cards.find(card=>card.id==='courses').color='#654321';
  const before=structuredClone(state);
  freeze(state);
  const model=getWelcomeModel(state);
  assert.deepEqual(model.cards.map(card=>card.id),visibleCanvasCards(state).map(card=>card.id));
  assert.equal(model.title,'创作宇宙');assert.equal(model.owner,'观察者');
  assert.deepEqual([model.cards[0].title,model.cards[0].color],['知识花园','#654321']);
  assert.deepEqual(state,before);
});

test('sidebar hiding does not remove canvas contents from the entrance and archived cards stay absent',()=>{
  const state=basic();state.spaces=[{id:'active',title:'保留空间',notes:[]},{id:'gone',title:'已归档',archived:true}];
  const block=addBlock(state);addBlock(state,'checklist');updateCustomBlock(state,block.id,{archived:true});
  configureWorkbench(state,{moduleId:'english',enabled:false});
  state.workbench.navigation={version:1,items:[{id:'tasks',placement:'hidden'},{id:'inbox',placement:'more'}]};
  const model=getWelcomeModel(freeze(state));
  assert.ok(model.cards.some(card=>card.id==='tasks'));assert.ok(model.cards.some(card=>card.id==='inbox'));
  for(const id of ['gone','english',block.id])assert.ok(!model.cards.some(card=>card.id===id));
  assert.deepEqual(model.counts,{modules:9,spaces:1,blocks:1,total:11});
  assert.deepEqual(model.cards.find(card=>card.id==='active').route,'space');
  assert.equal(model.cards.find(card=>card.id==='block:checklist').subroute,'block:checklist');
});

test('catalogue returns aggregates, never record bodies, attachment references, URLs or executable source',()=>{
  const marker='DO_NOT_EXPOSE_PRIVATE_CONTENT';
  const state=basic();
  state.profile.provider=marker;
  state.tasks=[{title:marker,description:marker,done:false},{title:marker,done:true},{title:marker,archived:true}];
  state.captures=[{text:marker,blobId:marker,fileName:marker},{text:marker,archived:true}];
  state.courses=[{title:marker,notes:[{content:marker}]},{title:marker,archived:true}];
  state.english={words:[{word:marker},{word:marker,archived:true}]};
  state.spaces=[{id:'notes',title:'笔记空间',description:marker,notes:[{content:marker},{content:marker,archived:true}]}];
  const block=addBlock(state);updateCustomBlock(state,block.id,{config:{text:marker},description:marker,data:{secret:marker}});
  const miniapp=addBlock(state,'miniapp');updateCustomBlock(state,miniapp.id,{config:{code:`throw new Error('${marker}')`}});
  const link=addBlock(state,'links');updateCustomBlock(state,link.id,{config:{items:[{id:'link-one',label:marker,url:`https://example.com/${marker}`} ]}});
  const checklist=addBlock(state,'checklist');updateCustomBlock(state,checklist.id,{config:{items:[{id:'one',label:marker,done:true},{id:'two',label:marker,done:false}]}});
  state.canvas={cards:[{id:'courses',x:marker,y:marker,w:marker,h:marker,color:'#ABCDEF',image:`https://example.com/${marker}`} ]};
  const model=getWelcomeModel(freeze(state)),byId=new Map(model.cards.map(card=>[card.id,card]));
  assert.equal(JSON.stringify(model).includes(marker),false);
  for(const [id,metric] of [['tasks','1 项待办'],['review','1 项已完成'],['inbox','1 条灵感'],['courses','1 门课程'],['english','1 个词汇'],['notes','1 篇笔记'],['block:links','1 个入口'],['block:checklist','1 / 2 项完成']])assert.equal(byId.get(id).metric,metric);
  assert.equal(byId.get('courses').color,'#ABCDEF');
});

test('every custom block kind yields a usable descriptor without running generated code',()=>{
  const state={workbench:createWorkbench('blank')};
  for(const kind of ['note','checklist','links','progress','countdown','table','miniapp']){
    const input={kind,title:kind};if(kind==='countdown')input.config={date:'2026-12-31'};
    createCustomBlock(state,input,{id:`block:${kind}`,now:'2026-10-13T12:00:00.000Z'});
  }
  const model=getWelcomeModel(freeze(state));
  assert.equal(model.counts.blocks,7);
  for(const card of model.cards.filter(card=>card.kind==='block')){
    assert.equal(card.route,'block');assert.equal(card.subroute,card.id);assert.ok(card.summary&&card.metric&&card.icon);
    assert.deepEqual(Object.keys(card).sort(),['color','icon','id','kind','metric','route','subroute','summary','title'].sort());
  }
});

test('bounded catalogue retains accurate totals and does not change long input names',()=>{
  const state={workbench:createWorkbench('blank'),profile:{name:'名'.repeat(500)},spaces:Array.from({length:180},(_,i)=>({id:`space-${i}`,title:'长'.repeat(500),notes:[]}))};
  const model=getWelcomeModel(freeze(state));
  assert.equal(model.cards.length,MAX_WELCOME_CARDS);assert.equal(model.totalCount,181);
  assert.deepEqual(model.counts,{modules:1,spaces:180,blocks:0,total:181});assert.equal(model.truncated,true);
  assert.equal(model.owner.length,80);assert.equal(model.cards[1].title.length,80);assert.equal(state.spaces[0].title.length,500);
});

test('untrusted decorative values are reduced to local icon names and hex colors',()=>{
  const state={workbench:createWorkbench('blank'),spaces:[{id:'local-space',title:'<img src=x onerror=alert(1)>',icon:'https://example.com/image.svg',color:'url(https://example.com/image)',notes:[]}]};
  state.canvas={cards:[{id:'local-space',color:'red; background:url(https://example.com/image)'}]};
  const card=getWelcomeModel(freeze(state)).cards[1];
  assert.equal(card.color,'#AE88FF');assert.equal(card.icon,'folder');
  // Titles remain plain text for the view to escape, never HTML or image sources.
  assert.equal(card.title,state.spaces[0].title);
  assert.equal(card.route,'space');assert.equal(card.subroute,'local-space');
  assert.ok(!Object.keys(card).some(key=>/html|image|url|src/i.test(key)));
});

test('bounded catalogue retains a representative of every kind even beyond the first hundred canvas cards',()=>{
  const state={workbench:createWorkbench('full'),spaces:Array.from({length:150},(_,index)=>({id:`space-${index}`,title:`空间${index}`}))};
  addBlock(state);
  const model=getWelcomeModel(freeze(state));
  assert.equal(model.cards.length,MAX_WELCOME_CARDS);
  assert.equal(model.totalCount,161);
  assert.deepEqual(model.counts,{modules:10,spaces:150,blocks:1,total:161});
  assert.deepEqual(new Set(model.cards.map(card=>card.kind)),new Set(['module','space','block']));
  assert.equal(model.cards.at(-1).id,'block:note');
  assert.equal(model.cards[10].id,'space-0');
});

test('extra cards preserve saved order and ignore stale, duplicate or malformed canvas references',()=>{
  const state={workbench:createWorkbench('blank'),spaces:[{id:'a',title:'A'},{id:'b',title:'B'},{id:'a',title:'Duplicate'},{id:'',title:'Invalid'},{id:'ai',title:'Collision'}]};
  state.canvas={cards:[null,{id:'b'},{id:'b'},{id:'missing'},{id:'a'}]};
  assert.deepEqual(getWelcomeModel(freeze(state)).cards.map(card=>card.id),['ai','b','a']);
  assert.deepEqual(getWelcomeModel(state).counts,{modules:1,spaces:2,blocks:0,total:3});
});

test('invalid persisted platform settings are rejected without repairing or mutating stored state',()=>{
  const state={workbench:{version:88,title:'bad'}};freeze(state);
  assert.throws(()=>getWelcomeModel(state));assert.deepEqual(state,{workbench:{version:88,title:'bad'}});
});
