import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkbench,configureWorkbench,applyWorkbenchTemplate,validateWorkbench,MAX_NAVIGATION_ITEMS} from '../src/workbench-model.js';
import {getNavigationItems,configureNavigation,resetNavigation,validateNavigation} from '../src/navigation-model.js';
import {ensureCanvas,visibleCanvasCards} from '../src/canvas.js';

const fixture=()=>({workbench:createWorkbench('full'),spaces:[{id:'project-a',title:'项目 A',icon:'folder',color:'#123456',notes:[{id:'note-a',title:'保留笔记'}]},{id:'project-b',title:'项目 B',archived:false},{id:'archived',title:'归档项目',archived:true}],tasks:[{id:'task-a',title:'保留待办'}]});
const ids=state=>getNavigationItems(state).map(item=>item.id);

test('legacy navigation reads in existing order without adding configuration or mutating metadata',()=>{
  const state=fixture();delete state.workbench;const before=structuredClone(state);
  assert.deepEqual(ids(state),['home','builder','ai','courses','english','inbox','tasks','review','ledger','calendar','timetable','competitions','space:project-a','space:project-b']);
  assert.ok(getNavigationItems(state).every(item=>item.placement==='primary'));
  assert.deepEqual(state,before);
  const result=getNavigationItems(state);result[0].title='只改读取副本';assert.deepEqual(state,before);
});

test('placement and order change navigation only and persist through JSON without changing canvas visibility',()=>{
  const state=fixture();ensureCanvas(state);const canvas=structuredClone(state.canvas),visible=visibleCanvasCards(state).map(item=>item.id),data=structuredClone({tasks:state.tasks,spaces:state.spaces}),modules=structuredClone(state.workbench.modules);
  configureNavigation(state,{id:'tasks',placement:'more',position:0});
  configureNavigation(state,{id:'space:project-a',placement:'hidden',position:2});
  assert.deepEqual(ids(state).slice(0,4),['tasks','home','space:project-a','builder']);
  assert.equal(getNavigationItems(state)[0].placement,'more');assert.equal(getNavigationItems(state)[2].placement,'hidden');
  assert.deepEqual(getNavigationItems(JSON.parse(JSON.stringify(state))),getNavigationItems(state));
  assert.deepEqual(state.canvas,canvas);assert.deepEqual(visibleCanvasCards(state).map(item=>item.id),visible);assert.deepEqual(state.workbench.modules,modules);assert.deepEqual({tasks:state.tasks,spaces:state.spaces},data);
});

test('home and builder remain recoverable, reorderable primary entries and invalid edits are atomic',()=>{
  const state=fixture();configureNavigation(state,{id:'builder',position:0});assert.deepEqual(ids(state).slice(0,2),['builder','home']);
  for(const patch of [{id:'home',placement:'hidden'},{id:'builder',placement:'more'},{id:'tasks',placement:'missing'},{id:'space:archived',placement:'primary'},{id:'missing',position:0},{id:'tasks',placement:'hidden',position:-1},{id:'tasks',position:100},{id:'tasks',position:1.5},{id:'tasks',position:NaN},{id:'tasks'},{id:'tasks',placement:'more',href:'https://example.org'}]){
    const before=structuredClone(state);assert.throws(()=>configureNavigation(state,patch));assert.deepEqual(state,before);
  }
  const readOnly=Object.freeze(structuredClone(state));assert.throws(()=>configureNavigation(readOnly,{id:'tasks',placement:'more'}));assert.throws(()=>resetNavigation(readOnly));
});

test('disabled and archived entries retain preferences while new entries receive primary placement',()=>{
  const state=fixture();configureNavigation(state,{id:'tasks',placement:'more',position:0});configureNavigation(state,{id:'space:project-a',placement:'hidden',position:1});
  configureWorkbench(state,{moduleId:'tasks',enabled:false});state.spaces[0].archived=true;
  assert.ok(!ids(state).includes('tasks'));assert.ok(!ids(state).includes('space:project-a'));
  assert.throws(()=>configureNavigation(state,{id:'tasks',placement:'primary'}));
  configureNavigation(state,{id:'english',position:0});
  state.spaces.push({id:'new-project',title:'新工作区'});
  assert.equal(getNavigationItems(state).at(-1).id,'space:new-project');assert.equal(getNavigationItems(state).at(-1).placement,'primary');
  configureWorkbench(state,{moduleId:'tasks',enabled:true});state.spaces[0].archived=false;
  assert.equal(getNavigationItems(state).find(item=>item.id==='tasks').placement,'more');assert.equal(getNavigationItems(state).find(item=>item.id==='space:project-a').placement,'hidden');
  assert.ok(ids(state).indexOf('tasks')<ids(state).indexOf('space:project-a'));
  const prefs=structuredClone(state.workbench.navigation);state.spaces=state.spaces.filter(space=>space.id!=='project-a');assert.ok(!ids(state).includes('space:project-a'));assert.deepEqual(state.workbench.navigation,prefs);
});

test('module names, templates and new spaces coexist with saved navigation; reset restores current defaults',()=>{
  const state=fixture();configureNavigation(state,{id:'english',placement:'more',position:0});configureNavigation(state,{id:'space:project-b',placement:'hidden',position:2});const prefs=structuredClone(state.workbench.navigation);
  configureWorkbench(state,{title:'创作基地',moduleId:'english',moduleTitle:'我的英语',position:0});applyWorkbenchTemplate(state,'blank');assert.deepEqual(state.workbench.navigation,prefs);assert.ok(!ids(state).includes('english'));
  applyWorkbenchTemplate(state,'full');assert.deepEqual(state.workbench.navigation,prefs);assert.equal(getNavigationItems(state).find(item=>item.id==='english').title,'我的英语');assert.equal(getNavigationItems(state).find(item=>item.id==='home').title,'创作基地');
  state.spaces[1].title='改名项目';assert.equal(getNavigationItems(state).find(item=>item.id==='space:project-b').title,'改名项目');
  const before=structuredClone(state);resetNavigation(state);assert.equal(state.workbench.navigation,undefined);delete before.workbench.navigation;assert.deepEqual(state,before);assert.ok(getNavigationItems(state).every(item=>item.placement==='primary'));
});

test('navigation validation bounds structures, rejects duplicates and fixed-entry hiding without accepting arbitrary routes',()=>{
  const good={version:1,items:[{id:'tasks',placement:'more'},{id:'space:a b/<tag>?',placement:'hidden'}]};assert.deepEqual(validateNavigation(good),good);
  const checked=validateNavigation(good);checked.items[0].placement='primary';assert.equal(good.items[0].placement,'more');
  const invalid=[null,[],{version:2,items:[]},{version:1,items:[],extra:true},{version:1,items:{}},{version:1,items:[{id:'tasks',placement:'more',href:'javascript:alert(1)'}]},
    ...['constructor','unknown','space:','space:__proto__','space:\n','space:'+ 'a'.repeat(513),'space:\ud800'].map(id=>({version:1,items:[{id,placement:'primary'}]})),
    {version:1,items:[{id:'home',placement:'hidden'}]},{version:1,items:[{id:'tasks',placement:'more'},{id:'tasks',placement:'hidden'}]},
    {version:1,items:Array.from({length:MAX_NAVIGATION_ITEMS+1},(_,i)=>({id:`space:s-${i}`,placement:'primary'}))}];
  for(const value of invalid)assert.throws(()=>validateNavigation(value));
  assert.throws(()=>validateNavigation(Object.create({version:1,items:[]})));
  const state=fixture();state.workbench.navigation=good;assert.deepEqual(validateWorkbench(state.workbench).navigation,good);
  state.spaces.push({id:'a b/<tag>?',title:'安全不等于 HTML 转义'});assert.equal(getNavigationItems(state).find(item=>item.id==='space:a b/<tag>?').href,'#/space/a%20b%2F%3Ctag%3E%3F');
});

test('partial saved preferences synthesize missing core entries and cannot mutate shared input objects',()=>{
  const state=fixture();state.workbench.navigation={version:1,items:[{id:'tasks',placement:'hidden'}]};
  const before=structuredClone(state),items=getNavigationItems(state);assert.equal(items[0].id,'tasks');assert.deepEqual(items.filter(item=>item.kind==='core').map(item=>[item.id,item.placement]),[['home','primary'],['builder','primary']]);assert.deepEqual(state,before);
  items[0].placement='primary';assert.deepEqual(state,before);
});
