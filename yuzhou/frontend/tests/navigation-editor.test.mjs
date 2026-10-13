import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkbench} from '../src/workbench-model.js';
import {configureNavigation,getNavigationItems} from '../src/navigation-model.js';
import {navigationEditorHTML,mountNavigationEditor} from '../src/navigation-editor.js';
import {saveWorkbenchChange} from '../src/builder.js';

function fixture(){
  const state={workbench:createWorkbench('full'),spaces:[{id:'project',title:'项目空间'}],canvas:{cards:[{id:'tasks',x:40,y:80}]},tasks:[{id:'kept',title:'保留记录'}],updatedAt:'before'};
  const listeners={},calls=[],messages=[],controls=new Map(),session={expanded:true},classes=new Set();let pointing=null,captured=null;
  const classList={add:(...names)=>names.forEach(name=>classes.add(name)),remove:(...names)=>names.forEach(name=>classes.delete(name))};
  const scroll={scrollTop:70,getBoundingClientRect:()=>({top:0,bottom:500})},preview={open:false};
  const root={innerHTML:'',classList,ownerDocument:{elementFromPoint:()=>pointing},contains:()=>true,
    querySelector:selector=>selector==='[data-navigation-scroll]'?scroll:selector==='[data-navigation-preview-more]'?preview:null,
    querySelectorAll:selector=>[...controls.values()].filter(el=>selector.startsWith('.')?el.classList:el.getAttribute(selector.slice(1,-1))!==null),
    addEventListener:(name,handler)=>{listeners[name]=handler;},removeEventListener:(name,handler)=>{if(listeners[name]===handler)delete listeners[name];},
    setPointerCapture:id=>{captured=id;},hasPointerCapture:id=>captured===id,releasePointerCapture:()=>{captured=null;}};
  function control(attributes){
    const key=JSON.stringify(attributes);if(controls.has(key))return controls.get(key);
    const data=Object.fromEntries(Object.entries(attributes).map(([name,value])=>[name.replace(/^data-/,'').replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase()),value]));
    const el={dataset:data,disabled:false,focused:false,classList,getAttribute:name=>attributes[name]??null,focus(){this.focused=true;},getBoundingClientRect:()=>({top:100,height:60}),closest(selector){return Object.hasOwn(attributes,selector.slice(1,-1))?this:null;}};
    controls.set(key,el);return el;
  }
  const ctx={root,state,save(){calls.push('save');state.updatedAt='saved';},toast:message=>messages.push(message),refresh:()=>assert.fail('editing navigation must not remount the whole builder')};
  ctx.saveChange=mutation=>saveWorkbenchChange(ctx,mutation);
  const fire=(name,target,more={})=>listeners[name]?.({target,button:0,pointerId:1,isPrimary:true,clientX:40,clientY:40,preventDefault(){},...more});
  const click=(action,id)=>fire('click',control({'data-navigation-action':action,...(id?{'data-navigation-id':id}:{})}));
  const placement=(id,value)=>{const el=control({'data-navigation-placement':id});el.value=value;fire('change',el);return el;};
  const target=(id,placement)=>{const group=control({'data-navigation-group':placement});if(!id){pointing=group;return group;}const row=control({'data-navigation-row':id});row.closest=selector=>selector==='[data-navigation-row]'?row:selector==='[data-navigation-group]'?group:null;pointing=row;return row;};
  return {state,root,session,ctx,controls,calls,messages,listeners,scroll,control,fire,click,placement,target};
}

test('navigation panel previews three placements, escapes labels and protects only core visibility',()=>{
  const f=fixture();f.state.spaces[0].title='<img src=x onerror=bad()>';
  configureNavigation(f.state,{id:'english',placement:'more'});configureNavigation(f.state,{id:'ledger',placement:'hidden'});
  const before=structuredClone(f.state),html=navigationEditorHTML(f.state,{expanded:true});
  assert.match(html,/data-navigation-details open/);assert.match(html,/data-navigation-group="more"/);assert.match(html,/data-navigation-group="hidden"/);
  assert.match(html,/data-navigation-placement="home"[^>]+disabled/);assert.match(html,/data-navigation-placement="builder"[^>]+disabled/);
  assert.doesNotMatch(html,/data-navigation-placement="ai"[^>]+disabled|<img/);assert.match(html,/&lt;img/);
  assert.match(html,/隐藏入口不会移除首页方块/);assert.deepEqual(f.state,before);
});

test('selecting a placement saves immediately while preserving records, layout, focus and panel scroll',()=>{
  const f=fixture(),modules=structuredClone(f.state.workbench.modules),canvas=f.state.canvas,tasks=f.state.tasks;
  const cleanup=mountNavigationEditor(f.ctx,f.session),select=f.placement('english','more');
  assert.equal(getNavigationItems(f.state).find(item=>item.id==='english').placement,'more');assert.deepEqual(f.calls,['save']);
  assert.deepEqual(f.state.workbench.modules,modules);assert.equal(f.state.canvas,canvas);assert.equal(f.state.tasks,tasks);
  assert.equal(select.focused,true);assert.equal(f.scroll.scrollTop,70);assert.match(f.root.innerHTML,/data-navigation-details open/);cleanup();
});

test('up and down reorder within a display group across intervening hidden entries',()=>{
  const f=fixture();configureNavigation(f.state,{id:'english',placement:'more'});configureNavigation(f.state,{id:'ledger',placement:'more'});
  mountNavigationEditor(f.ctx,f.session);f.click('up','ledger');
  assert.deepEqual(getNavigationItems(f.state).filter(item=>item.placement==='more').map(item=>item.id),['ledger','english']);
  f.click('down','ledger');assert.deepEqual(getNavigationItems(f.state).filter(item=>item.placement==='more').map(item=>item.id),['english','ledger']);
  assert.deepEqual(f.calls,['save','save']);
});

test('a failed save rolls back navigation and timestamp without changing business data',()=>{
  const f=fixture(),before=structuredClone(f.state);f.ctx.save=()=>{f.state.updatedAt='failed';throw Error('存储已满');};
  mountNavigationEditor(f.ctx,f.session);f.placement('courses','hidden');
  assert.deepEqual(f.state,before);assert.deepEqual(f.messages,['存储已满']);assert.doesNotMatch(f.root.innerHTML,/课程空间」已设为/);
});

test('reset restores defaults and a stale or unmounted editor cannot save',()=>{
  const f=fixture();configureNavigation(f.state,{id:'english',placement:'hidden',position:0});
  const cleanup=mountNavigationEditor(f.ctx,f.session);f.click('reset');assert.equal(f.state.workbench.navigation,undefined);assert.deepEqual(f.calls,['save']);
  const before=structuredClone(f.state);f.ctx.isCurrent=()=>false;f.placement('courses','more');assert.deepEqual(f.state,before);assert.deepEqual(f.calls,['save']);assert.match(f.messages.at(-1),/工作台已更新/);
  cleanup();f.click('down','home');assert.deepEqual(f.calls,['save']);assert.deepEqual(Object.keys(f.listeners),[]);
});

test('pointer drag previews without saving and commits a cross-group move only at release',()=>{
  const f=fixture();configureNavigation(f.state,{id:'calendar',placement:'more'});
  mountNavigationEditor(f.ctx,f.session);const before=structuredClone(f.state),handle=f.control({'data-navigation-grip':'english'});
  f.fire('pointerdown',handle);f.target('calendar','more');f.fire('pointermove',handle,{clientY:150});
  assert.deepEqual(f.state,before);assert.deepEqual(f.calls,[]);f.fire('pointerup',handle,{clientY:150});
  assert.deepEqual(getNavigationItems(f.state).filter(item=>item.placement==='more').map(item=>item.id),['calendar','english']);assert.deepEqual(f.calls,['save']);
  assert.equal(f.control({'data-navigation-grip':'english'}).focused,true);
});

test('cancelled drags, secondary pointers and core drops outside primary leave navigation unchanged',()=>{
  const f=fixture();mountNavigationEditor(f.ctx,f.session);const before=structuredClone(f.state),handle=f.control({'data-navigation-grip':'courses'});
  f.fire('pointerdown',handle,{isPrimary:false});f.target(null,'hidden');f.fire('pointermove',handle,{clientY:170});f.fire('pointerup',handle);
  f.fire('pointerdown',handle);f.target(null,'hidden');f.fire('pointermove',handle,{clientY:170});f.fire('keydown',handle,{key:'Escape'});f.fire('pointerup',handle);
  const core=f.control({'data-navigation-grip':'home'});f.fire('pointerdown',core);f.target(null,'hidden');f.fire('pointermove',core,{clientY:170});f.fire('pointerup',core);
  assert.deepEqual(f.state,before);assert.deepEqual(f.calls,[]);
});

test('opening or closing the editor remains session-only and does not write workspace state',()=>{
  const f=fixture(),before=structuredClone(f.state);mountNavigationEditor(f.ctx,f.session);
  f.fire('toggle',{matches:selector=>selector==='[data-navigation-details]',open:false});assert.equal(f.session.expanded,false);
  assert.deepEqual(f.state,before);assert.deepEqual(f.calls,[]);
});
