import test from 'node:test';
import assert from 'node:assert/strict';
import {mountPlacement,placementPoint} from '../src/placement.js';
import {placementLayout} from '../src/placement-model.js';
import {createWorkbench} from '../src/workbench-model.js';
import {workspaceFingerprint} from '../../backend/workspace-queries.mjs';

// Minimal event surface, like the builder tests: real handlers and models run without
// a browser dependency. Browser evidence separately covers native pointer capture.
class Element {
  constructor(tag='div',className=''){
    this.tagName=tag.toUpperCase();this.className=className;this.children=[];this.dataset={};this.attributes={};this.listeners=new Map();this.captures=new Set();
    this.style={setProperty(name,value){this[name]=value;}};
    const classes=new Set();this.classList={add:(...names)=>names.forEach(name=>classes.add(name)),remove:(...names)=>names.forEach(name=>classes.delete(name)),toggle:(name,on)=>on?classes.add(name):classes.delete(name),contains:name=>classes.has(name)};
  }
  matches(selector){
    if(selector.startsWith('.'))return this.className.split(' ').includes(selector.slice(1))||this.classList.contains(selector.slice(1));
    const attr=selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
    if(attr){const key=attr[1].replace(/^data-/,'').replace(/-([a-z])/g,(_,c)=>c.toUpperCase());const value=attr[1].startsWith('data-')?this.dataset[key]:this.attributes[attr[1]];return value!==undefined&&(attr[2]===undefined||value===attr[2]);}
    return selector.toUpperCase()===this.tagName;
  }
  closest(selector){return selector.split(',').some(part=>this.matches(part.trim()))?this:this.parent?.closest(selector)||null;}
  contains(element){return element===this||this.children.some(child=>child.contains(element));}
  querySelectorAll(selector){return this.children.flatMap(child=>[...(selector.split(',').some(part=>child.matches(part.trim()))?[child]:[]),...child.querySelectorAll(selector)]);}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  append(child){child.parent=this;this.children.push(child);return child;}
  insertBefore(child,before){child.parent=this;this.children.splice(this.children.indexOf(before),0,child);}
  remove(){if(this.parent)this.parent.children.splice(this.parent.children.indexOf(this),1);this.parent=null;}
  setAttribute(name,value){this.attributes[name]=value;}
  addEventListener(name,listener){if(!this.listeners.has(name))this.listeners.set(name,new Set());this.listeners.get(name).add(listener);}
  removeEventListener(name,listener){this.listeners.get(name)?.delete(listener);}
  setPointerCapture(id){this.captures.add(id);}
  hasPointerCapture(id){return this.captures.has(id);}
  releasePointerCapture(id){this.captures.delete(id);}
  getBoundingClientRect(){return {left:240,top:180,width:900,height:500,right:1140,bottom:680};}
  focus(){this.focused=true;}
  fire(type,properties={}){
    const event={type,target:this,pointerId:1,button:0,clientX:600,clientY:400,detail:1,deltaMode:0,deltaX:0,deltaY:0,prevented:false,preventDefault(){this.prevented=true;},...properties};
    for(const listener of this.listeners.get(type)||[])listener(event);
    return event;
  }
}
function fixture(t){
  const previous={document:globalThis.document,window:globalThis.window,ResizeObserver:globalThis.ResizeObserver};
  const browserWindow=new Element(),observers=[];
  globalThis.document={createElement:tag=>new Element(tag)};globalThis.window=browserWindow;
  globalThis.ResizeObserver=class{constructor(callback){this.callback=callback;observers.push(this);}observe(){}disconnect(){this.disconnected=true;}};
  const root=new Element(),stage=root.append(new Element('div','wb-placement-stage')),ghost=stage.append(new Element('div','wb-placement-ghost'));
  ghost.hidden=true;stage.append(new Element('p','wb-stage-empty'));root.append(new Element('p','wb-placement-hint'));root.append(new Element('span','wb-placement-count'));
  const selection=root.append(new Element('span'));selection.dataset.placeSelection='';
  const actions={};for(const name of ['zoom-in','zoom-out','zoom-reset','fit','arrange','undo','left','right','up','down','cancel']){const button=root.append(new Element('button'));button.dataset.placeAction=name;actions[name]=button;}
  const sources={};for(const id of ['tasks','calendar']){sources[id]=root.append(new Element('button'));sources[id].dataset.placeSource=id;}const source=sources.tasks;
  const state={workbench:createWorkbench('blank'),spaces:[],tasks:[{id:'existing',title:'keep'}],updatedAt:'before'},session={},calls=[];
  const cleanup=mountPlacement({root,state,toast:message=>calls.push(['toast',message]),save:()=>{calls.push('save');state.updatedAt='saved';}},session);
  t.after(()=>{cleanup();for(const [name,value] of Object.entries(previous)){if(value===undefined)delete globalThis[name];else globalThis[name]=value;}});
  const click=(target,extra={})=>root.fire('click',{target,...extra});
  const pointer=(type,target,extra={})=>root.fire(type,{target,...extra});
  return {root,stage,ghost,actions,source,sources,state,session,calls,cleanup,observers,browserWindow,click,pointer,saveCount:()=>calls.filter(call=>call==='save').length};
}
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const worldAt=(view,point)=>({x:view.x+(point.x-view.left)/view.scale,y:view.y+(point.y-view.top)/view.scale});

test('camera controls preserve workspace and pending AI fingerprint while enforcing zoom limits',t=>{
  const f=fixture(t),before=structuredClone(f.state),fingerprint=workspaceFingerprint(f.state);
  f.click(f.actions['zoom-reset']);assert.equal(f.session.viewport.view.scale,1);
  f.click(f.actions['zoom-in']);assert.equal(f.session.viewport.view.scale,1.2);
  f.click(f.actions['zoom-out']);near(f.session.viewport.view.scale,1);
  f.stage.fire('wheel',{ctrlKey:true,deltaY:-100000});assert.equal(f.session.viewport.view.scale,1.6);assert.equal(f.actions['zoom-in'].disabled,true);
  f.stage.fire('wheel',{ctrlKey:true,deltaY:100000});assert.equal(f.session.viewport.view.scale,0.001);assert.equal(f.actions['zoom-out'].disabled,true);
  f.click(f.actions.fit);assert.ok(f.session.viewport.view.scale>0.001);assert.equal(f.actions['zoom-out'].disabled,false);
  assert.deepEqual(f.state,before);assert.equal(workspaceFingerprint(f.state),fingerprint);assert.equal(f.saveCount(),0);
});

test('ordinary, shift and line-mode wheel events pan with the expected direction without saving',t=>{
  const f=fixture(t);f.click(f.actions['zoom-reset']);const initial={...f.session.viewport.view};
  assert.equal(f.stage.fire('wheel',{deltaX:20,deltaY:40}).prevented,true);
  near(f.session.viewport.view.x,initial.x+20);near(f.session.viewport.view.y,initial.y+40);
  f.stage.fire('wheel',{shiftKey:true,deltaY:15});near(f.session.viewport.view.x,initial.x+35);near(f.session.viewport.view.y,initial.y+40);
  f.stage.fire('wheel',{deltaMode:1,deltaX:2,deltaY:-3});near(f.session.viewport.view.x,initial.x+67);near(f.session.viewport.view.y,initial.y-8);
  assert.equal(f.saveCount(),0);
});

test('modifier-wheel zoom retains the pointed world location and is ignored during an active drag',t=>{
  const f=fixture(t),rect=f.stage.getBoundingClientRect(),point={x:375,y:205};
  const held=worldAt(f.session.viewport.view,point);
  f.stage.fire('wheel',{metaKey:true,clientX:rect.left+point.x,clientY:rect.top+point.y,deltaY:-90});
  const after=worldAt(f.session.viewport.view,point);near(after.x,held.x);near(after.y,held.y);
  f.pointer('pointerdown',f.stage);const dragStart={...f.session.viewport.view};
  f.stage.fire('wheel',{ctrlKey:true,deltaY:-100});assert.deepEqual(f.session.viewport.view,dragStart);
  f.pointer('pointerup',f.stage);assert.equal(f.saveCount(),0);
});

test('background drag suppresses its trailing drop click but immediately allows picking a different block',t=>{
  const f=fixture(t),before=structuredClone(f.state);f.click(f.source);
  const originalLeft=parseFloat(f.ghost.style.left),originalTop=parseFloat(f.ghost.style.top);
  f.pointer('pointerdown',f.stage,{clientX:700,clientY:450});
  f.pointer('pointermove',f.stage,{clientX:770,clientY:480});
  near(parseFloat(f.ghost.style.left),originalLeft+70);near(parseFloat(f.ghost.style.top),originalTop+30);
  f.pointer('pointerup',f.stage,{clientX:770,clientY:480});f.click(f.stage,{clientX:770,clientY:480});
  assert.equal(f.session.placingId,'tasks');assert.equal(f.ghost.hidden,false);assert.equal(f.saveCount(),0);assert.deepEqual(f.state,before);
  f.click(f.sources.calendar);assert.equal(f.session.placingId,'calendar');assert.equal(f.saveCount(),0);assert.deepEqual(f.state,before);
  f.click(f.stage,{clientX:720,clientY:425});assert.equal(f.saveCount(),1);assert.equal(f.session.placingId,null);
  assert.equal(f.state.workbench.modules.find(module=>module.id==='calendar').enabled,true);assert.equal(f.state.workbench.modules.find(module=>module.id==='tasks').enabled,false);
});

test('a second pointer cannot alter an active preview or pan, and zooming a preview preserves its world position',t=>{
  const f=fixture(t),before=structuredClone(f.state);f.click(f.source);
  const ghostWorld=()=>worldAt(f.session.viewport.view,{x:parseFloat(f.ghost.style.left),y:parseFloat(f.ghost.style.top)});
  const point=ghostWorld();f.click(f.actions['zoom-in']);near(ghostWorld().x,point.x);near(ghostWorld().y,point.y);
  f.click(f.actions.fit);near(ghostWorld().x,point.x);near(ghostWorld().y,point.y);
  f.pointer('pointerdown',f.stage,{pointerId:1});const view={...f.session.viewport.view},left=f.ghost.style.left,top=f.ghost.style.top;
  f.pointer('pointermove',f.stage,{pointerId:2,clientX:930,clientY:525});f.pointer('pointerup',f.stage,{pointerId:2});
  assert.deepEqual(f.session.viewport.view,view);assert.equal(f.ghost.style.left,left);assert.equal(f.ghost.style.top,top);assert.equal(f.stage.hasPointerCapture(1),true);
  f.pointer('pointercancel',f.stage,{pointerId:1});assert.deepEqual(f.state,before);assert.equal(f.saveCount(),0);
});

test('a stationary background click still places the selected block correctly after zoom and pan; navigation does not block undo',t=>{
  const f=fixture(t),before=structuredClone(f.state);f.click(f.actions['zoom-reset']);f.stage.fire('wheel',{deltaX:65,deltaY:-35});f.click(f.source);
  const card=placementLayout(f.state).cards.find(row=>row.id==='tasks'),rect=f.stage.getBoundingClientRect();
  const target={clientX:725,clientY:428},viewBeforeDrop={...f.session.viewport.view};
  const expected=placementPoint(viewBeforeDrop,rect,target.clientX,target.clientY,{x:card.w/2,y:card.h/2});
  f.pointer('pointerdown',f.stage,target);f.pointer('pointerup',f.stage,target);f.click(f.stage,target);
  const saved=f.state.canvas.cards.find(row=>row.id==='tasks');assert.deepEqual({x:saved.x,y:saved.y},expected);assert.equal(f.saveCount(),1);
  f.stage.fire('wheel',{deltaX:190,deltaY:70});f.click(f.actions['zoom-in']);f.click(f.actions.undo);
  assert.deepEqual(f.state.workbench,before.workbench);assert.equal(Object.hasOwn(f.state,'canvas'),false);assert.deepEqual(f.state.tasks,before.tasks);
  assert.deepEqual(f.session.viewport.view,viewBeforeDrop);assert.equal(f.saveCount(),2);
});

test('pointer cancellation and Escape restore an in-progress pan without changing stored cards',t=>{
  const f=fixture(t),before=structuredClone(f.state),view={...f.session.viewport.view};
  f.pointer('pointerdown',f.stage);f.pointer('pointermove',f.stage,{clientX:720,clientY:480});f.pointer('pointercancel',f.stage);
  assert.deepEqual(f.session.viewport.view,view);assert.equal(f.stage.hasPointerCapture(1),false);
  f.pointer('pointerdown',f.stage);f.pointer('pointermove',f.stage,{clientX:750,clientY:430});f.root.fire('keydown',{target:f.stage,key:'Escape'});
  assert.deepEqual(f.session.viewport.view,view);assert.deepEqual(f.state,before);assert.equal(f.saveCount(),0);assert.equal(f.stage.hasPointerCapture(1),false);
});

test('middle-button and Space-drag over a card pan the camera instead of moving the card',t=>{
  const f=fixture(t),before=structuredClone(f.state),card=f.stage.querySelector('[data-place-card]'),initial={...f.session.viewport.view};
  f.pointer('pointerdown',card,{button:1});f.pointer('pointermove',card,{clientX:660,clientY:400});f.pointer('pointerup',card,{button:1,clientX:660,clientY:400});
  near(f.session.viewport.view.x,initial.x-60/initial.scale);
  f.root.fire('keydown',{target:card,key:' ',code:'Space'});f.pointer('pointerdown',card);f.pointer('pointermove',card,{clientX:600,clientY:450});f.pointer('pointerup',card,{clientX:600,clientY:450});
  f.browserWindow.fire('keyup',{target:card,key:' ',code:'Space'});
  near(f.session.viewport.view.y,initial.y-50/initial.scale);assert.equal(f.stage.classList.contains('can-pan'),false);
  assert.deepEqual(f.state,before);assert.equal(f.saveCount(),0);
});

test('unmount releases pointer capture and removes wheel, keyboard, resize and root handlers',t=>{
  const f=fixture(t),before=structuredClone(f.state);f.pointer('pointerdown',f.stage);assert.equal(f.stage.hasPointerCapture(1),true);
  f.cleanup();const view={...f.session.viewport.view};
  f.stage.fire('wheel',{ctrlKey:true,deltaY:-200});f.click(f.actions['zoom-in']);f.pointer('pointermove',f.stage,{clientX:900});
  assert.equal(f.stage.hasPointerCapture(1),false);assert.deepEqual(f.session.viewport.view,view);assert.deepEqual(f.state,before);assert.equal(f.saveCount(),0);
  assert.ok([...f.root.listeners.values(),...f.stage.listeners.values(),...f.browserWindow.listeners.values()].every(set=>set.size===0));assert.ok(f.observers.every(observer=>observer.disconnected));
});
