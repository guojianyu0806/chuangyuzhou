import test from 'node:test';
import assert from 'node:assert/strict';
import {WORKBENCH_MODULES,WORKBENCH_TEMPLATES,createWorkbench,initializeWorkbench,validateWorkbench,getWorkbench,getVisibleModules,configureWorkbench,applyWorkbenchTemplate} from '../src/workbench-model.js';
import {ensureCanvas,visibleCanvasCards} from '../src/canvas.js';

test('explicit fresh seeds start with the AI partner, while unconfigured legacy states keep all modules',()=>{
  const fresh={mode:'personal'},legacy={mode:'personal',courses:[],tasks:[],captures:[]};
  initializeWorkbench(fresh,{fresh:true});initializeWorkbench(legacy);
  assert.deepEqual(getVisibleModules(fresh).map(module=>module.id),['ai']);
  assert.equal(fresh.workbench.onboardingComplete,false);
  assert.equal(legacy.workbench.templateId,'full');
  assert.equal(getVisibleModules(legacy).length,10);
  const same=fresh.workbench;initializeWorkbench(fresh);assert.equal(fresh.workbench,same);
  const readOnly={courses:[]},before=structuredClone(readOnly);
  assert.equal(getWorkbench(readOnly).modules.length,10);assert.deepEqual(readOnly,before);
});

test('every template has a unique bounded catalogue and always retains the AI partner',()=>{
  assert.deepEqual(WORKBENCH_TEMPLATES.map(template=>template.id),['blank','project','research','student','life','full']);
  assert.equal(new Set(WORKBENCH_MODULES.map(module=>module.id)).size,10);
  for(const template of WORKBENCH_TEMPLATES){
    const config=createWorkbench(template.id);
    assert.deepEqual(validateWorkbench(config),config);
    assert.deepEqual(getVisibleModules({workbench:config}).map(module=>module.id),template.moduleIds);
    assert.equal(config.modules.find(module=>module.id==='ai').enabled,true);
  }
  const one=createWorkbench(),two=createWorkbench();one.modules[0].title='只改一份';assert.equal(two.modules[0].title,'AI伙伴');
  assert.throws(()=>createWorkbench('external-template'));
});

test('invalid storage and imported configuration are rejected instead of silently enabling or dropping modules',()=>{
  const original=createWorkbench('full');
  for(const corrupt of [
    config=>config.version=2,
    config=>config.extra='unknown',
    config=>config.title='',
    config=>config.title='坏\n名称',
    config=>config.title='a'.repeat(81),
    config=>config.templateId='unknown',
    config=>config.onboardingComplete='yes',
    config=>config.modules.pop(),
    config=>config.modules.push({...config.modules[0]}),
    config=>config.modules[1].id=config.modules[0].id,
    config=>config.modules[1].id='__proto__',
    config=>config.modules[0].enabled=false,
    config=>config.modules[1].enabled=1,
    config=>config.modules[1].title=' '.repeat(4),
    config=>config.modules[1].title='a'.repeat(61),
    config=>config.modules[1].order=0,
  ]){
    const value=structuredClone(original);corrupt(value);assert.throws(()=>validateWorkbench(value));
  }
  assert.throws(()=>validateWorkbench(Object.create({version:1})));
  const checked=validateWorkbench(original);checked.modules[0].title='另一个名称';assert.equal(original.modules[0].title,'AI伙伴');
});

test('configuration changes are atomic, retain data, and use stable module IDs despite renamed labels',()=>{
  const state={workbench:createWorkbench('blank'),tasks:[{id:'task-one',title:'已有任务'}],spaces:[{id:'my-space',notes:[{id:'note-one',content:'已有笔记'}]}]};
  const data=structuredClone({tasks:state.tasks,spaces:state.spaces});
  configureWorkbench(state,{title:'  研究工作台  ',moduleId:'tasks',enabled:true,moduleTitle:'  研究进度  ',position:1});
  assert.equal(state.workbench.title,'研究工作台');assert.equal(state.workbench.onboardingComplete,true);
  assert.equal(state.workbench.templateId,'blank');
  assert.deepEqual(getVisibleModules(state).map(module=>[module.id,module.title]),[['ai','AI伙伴'],['tasks','研究进度']]);
  assert.deepEqual({tasks:state.tasks,spaces:state.spaces},data);
  for(const patch of [{title:'被拒绝',moduleId:'ai',enabled:false},{title:'被拒绝',moduleId:'unknown',enabled:true},{title:'被拒绝',moduleId:'tasks',position:10},{title:'被拒绝',moduleId:'tasks',position:-1},{moduleId:'tasks',position:1.5},{enabled:true},{moduleId:'tasks'},{unknown:'value'},{}]){
    const before=structuredClone(state);assert.throws(()=>configureWorkbench(state,patch));assert.deepEqual(state,before);
  }
});

test('template application keeps custom names and all business records, including disabled module data',()=>{
  const state={workbench:createWorkbench('full'),courses:[{id:'old-course',notes:[{content:'保留'}]}],tasks:[{id:'old-task'}],ledger:{entries:[{id:'old-ledger'}]},fitness:{entries:[{id:'old-fitness'}]},spaces:[{id:'custom'}]};
  configureWorkbench(state,{title:'我的研究世界',moduleId:'courses',moduleTitle:'资料图书馆'});
  ensureCanvas(state);state.canvas.cards.find(card=>card.id==='courses').x=-390;
  const original=structuredClone(state);
  applyWorkbenchTemplate(state,'life');
  assert.equal(state.workbench.title,'我的研究世界');
  assert.equal(state.workbench.modules.find(module=>module.id==='courses').title,'资料图书馆');
  assert.equal(state.workbench.modules.find(module=>module.id==='courses').enabled,false);
  const {workbench,...others}=state,{workbench:oldWorkbench,...oldOthers}=original;
  assert.deepEqual(others,oldOthers);
  applyWorkbenchTemplate(state,'blank');assert.equal(state.workbench.onboardingComplete,true);
  applyWorkbenchTemplate(state,'student');assert.equal(getVisibleModules(state).find(module=>module.id==='courses').title,'资料图书馆');
  const before=structuredClone(state);assert.throws(()=>applyWorkbenchTemplate(state,'unknown'));assert.deepEqual(state,before);
});

test('hiding and restoring modules retains free-canvas geometry, viewport and underlying records',()=>{
  const state={workbench:createWorkbench('full'),spaces:[{id:'custom',archived:false},{id:'archived-space',archived:true}],tasks:[{id:'kept-task'}]};
  ensureCanvas(state);
  const card=state.canvas.cards.find(card=>card.id==='tasks');Object.assign(card,{x:-200,y:1200,w:500,h:400,color:'#123456'});
  state.canvas.view={x:80,y:-30,zoom:.8};state.canvas.presentation='stack';state.canvas.stackPointer=.2;
  const before=structuredClone(state.canvas);
  configureWorkbench(state,{moduleId:'tasks',enabled:false});ensureCanvas(state);
  assert.ok(!visibleCanvasCards(state).some(card=>card.id==='tasks'));
  assert.ok(visibleCanvasCards(state).some(card=>card.id==='custom'));
  assert.ok(!visibleCanvasCards(state).some(card=>card.id==='archived-space'));
  assert.deepEqual(state.canvas,before);assert.equal(state.tasks[0].id,'kept-task');
  configureWorkbench(state,{moduleId:'tasks',enabled:true});ensureCanvas(state);
  assert.deepEqual(visibleCanvasCards(state).find(card=>card.id==='tasks'),before.cards.find(card=>card.id==='tasks'));
  assert.deepEqual(state.canvas,before);
});

test('module order controls list and stack presentation without reordering stored cards or custom spaces',()=>{
  const state={workbench:createWorkbench('full'),spaces:[{id:'custom-first'},{id:'custom-second'}]};ensureCanvas(state);
  const original=structuredClone(state.canvas.cards);
  configureWorkbench(state,{moduleId:'tasks',position:0});
  assert.equal(visibleCanvasCards(state)[0].id,'tasks');
  assert.deepEqual(visibleCanvasCards(state).slice(-2).map(card=>card.id),['custom-first','custom-second']);
  assert.deepEqual(state.canvas.cards,original);
  configureWorkbench(state,{moduleId:'tasks',position:9});
  assert.equal(visibleCanvasCards(state)[9].id,'tasks');
  assert.deepEqual(state.canvas.cards,original);
});

test('collection canvases do not inherit platform visibility or the module catalogue',()=>{
  const state={spaces:[],canvas:{cards:[{id:'kept',x:-18,y:55,w:280,h:230,color:'#123456'}],view:{x:8,y:9,zoom:.7},initialized:true}};
  const preset={kept:{x:0,y:0,w:280,h:230,color:'#123456'},added:{x:320,y:0,w:280,h:230,color:'#123456'}};
  ensureCanvas(state,preset);
  assert.deepEqual(state.canvas.cards.map(card=>card.id),['kept','added']);
  assert.equal(state.canvas.cards[0].x,-18);assert.equal(state.workbench,undefined);
  assert.deepEqual(state.canvas.view,{x:8,y:9,zoom:.7});
});
