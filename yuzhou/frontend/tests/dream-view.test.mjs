import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createDreamEmitter,createDreamPlayback} from '../src/dream-flow.js';
import {placeDreamThought} from '../src/dream-layout.js';

// Execute the actual mounted view with deterministic browser event/timer surfaces.
// Fullscreen is a lifecycle stub; its browser behaviour has its own test suite.
const viewSource=fs.readFileSync(new URL('../src/dream.js',import.meta.url),'utf8')
  .replace(/^import .*;\r?$/gm,'').replace('export function mountDream','function mountDream');
const capture=(id,text=id)=>({id,text,category:'备忘',tags:'合成',archived:false,createdAt:'2026-10-12T00:00:00Z'});
const fixtures=()=>[capture('one','树叶与手写字'),capture('two','海风与旧照片'),capture('three','钟摆与时间'),...Array.from({length:12},(_,i)=>capture(`old-${i}`,`另一条旧念头 ${i}`))];
const tick=async()=>{await Promise.resolve();await Promise.resolve();};

function clock(){
  let now=0,sequence=0;const jobs=new Map();
  return {
    setTimer(callback,delay=0){const id=++sequence;jobs.set(id,{at:now+delay,callback});return id;},
    clearTimer(id){jobs.delete(id);},
    advance(duration){
      const end=now+duration;let count=0;
      for(;;){
        const next=[...jobs].filter(([,job])=>job.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
        if(!next)break;
        if(++count>1000)throw new Error('Unbounded timer scheduling');
        const [id,job]=next;now=job.at;jobs.delete(id);job.callback();
      }
      now=end;
    },
    pending(){return jobs.size;},
  };
}
class Events {
  listeners=new Map();
  addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}
  removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
  emit(type,values={}){for(const fn of [...(this.listeners.get(type)||[])])fn({type,target:this,preventDefault(){},...values});}
  listenerCount(){return [...this.listeners.values()].reduce((n,set)=>n+set.size,0);}
}
function harness({items=fixtures(),reduced=false,width=1000,height=600}={}){
  const time=clock(),observers=[],window=new Events(),document=new Events();
  const media=new Events();media.matches=reduced;
  let fullscreenDestroyed=0,seed=3;
  class Element extends Events {
    constructor(name,parent=null){super();this.name=name;this.parentElement=parent;this.children=[];this.attributes=new Map();this.dataset={};this.value='';this.disabled=false;this.hidden=false;this.isConnected=true;this.open=false;this._html='';this.textContent='';this.clientWidth=1000;this.clientHeight=600;this.style={setProperty(){},removeProperty(){}};const classes=new Set();this.classList={add:(...names)=>names.forEach(n=>classes.add(n)),remove:(...names)=>names.forEach(n=>classes.delete(n)),contains:n=>classes.has(n),toggle:(name,value)=>{if(value===undefined)value=!classes.has(name);value?classes.add(name):classes.delete(name);return value;}};}
    set innerHTML(value){
      this._html=value;
      for(const child of this.children)child.isConnected=false;
      this.children=[...value.matchAll(/data-cloud="([^"]+)"/g)].map(([,id])=>{const node=new Element('cloud',this);node.dataset.cloud=id;return node;});
    }
    get innerHTML(){return this._html;}
    setAttribute(name,value){this.attributes.set(name,String(value));}
    removeAttribute(name){this.attributes.delete(name);}
    getAttribute(name){return this.attributes.get(name)??null;}
    contains(node){for(let current=node;current;current=current.parentElement)if(current===this)return true;return false;}
    append(child){child.parentElement=this;child.isConnected=true;this.children.push(child);}
    remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);this.isConnected=false;for(const child of this.children)child.isConnected=false;this.parentElement=null;}
    closest(selector){if(selector==='[data-cloud]')return this.dataset.cloud?this:this.parentElement?.closest(selector);if(selector==='[data-dream]')return this.dataset.dream?this:this.parentElement?.closest(selector);if(selector==='.dream-cloud-slot')return String(this.className).includes('dream-cloud-slot')?this:this.parentElement?.closest(selector);return null;}
    querySelector(selector){
      if(this===scene){const exact=selector.match(/^\[data-cloud="([^"]+)"\]$/);const clouds=this.children.flatMap(child=>child.children);return exact?clouds.find(node=>node.dataset.cloud===exact[1])||null:clouds[0]||null;}
      if(this===detail&&selector==='[data-dream="close"]')return detailClose;
      return selectors.get(selector)||null;
    }
    getBoundingClientRect(){return {width:this.clientWidth,height:this.clientHeight,left:0,top:0};}
    focus(){document.activeElement=this;surface.emit('focusin',{target:this});}
    showModal(){this.open=true;}
    close(){this.open=false;this.emit('close');}
  }
  // Selectors represent the fixed view shell; scene children follow actual output HTML.
  const selectors=new Map(),root=new Element('root'),surface=new Element('surface',root);
  const scene=new Element('scene',surface),dialog=new Element('dialog',surface),detail=new Element('detail',dialog),search=new Element('search',surface),detailClose=new Element('close',detail);
  surface.clientWidth=width;scene.clientWidth=width;scene.clientHeight=height;
  detailClose.dataset.dream='close';
  for(const [selector,node] of [['.dream-surface',surface],['.dream-scene',scene],['.dream-dialog',dialog],['.dream-detail',detail],['.dream-search input',search]])selectors.set(selector,node);
  for(const name of ['count','motion-note','empty','sky-note','current'])selectors.set(`.dream-${name}`,new Element(name,surface));
  const buttons=new Map();for(const action of ['exit','pause','fullscreen','create','next','clear','close','edit','archive','download']){const node=new Element(action,surface);node.dataset.dream=action;buttons.set(action,node);selectors.set(`[data-dream="${action}"]`,node);}
  const body=new Element('body'),modal=new Element('modal'),ai=new Element('ai');ai.hidden=true;document.activeElement=body;document.hidden=false;
  document.querySelector=()=>modal.open||!ai.hidden?modal:null;
  document.querySelectorAll=()=>[modal,ai];
  document.createElement=tag=>new Element(tag);
  const makeObserver=kind=>class {
    constructor(callback){this.kind=kind;this.callback=callback;this.disconnected=false;this.targets=[];observers.push(this);}
    observe(target){this.targets.push(target);}
    disconnect(){this.disconnected=true;}
    emit(entries){if(!this.disconnected)this.callback(entries);}
  };
  const history={state:{},previous:null,pushState(state){this.previous=this.state;this.state=state;},replaceState(state){this.state=state;},back(){this.state=this.previous||{};window.emit('popstate');}};
  const math=Object.create(Math);math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const context=vm.createContext({document,window,history,location:{href:'http://synthetic.test/#/inbox'},CSS:{escape:value=>String(value)},Math:math,
    matchMedia:()=>media,setTimeout:time.setTimer,clearTimeout:time.clearTimer,queueMicrotask,
    IntersectionObserver:makeObserver('intersection'),ResizeObserver:makeObserver('resize'),MutationObserver:makeObserver('mutation'),
    createDreamEmitter:(input,options)=>createDreamEmitter(input,{random:math.random,...options}),
    placeDreamThought:options=>placeDreamThought({...options,random:math.random}),
    createDreamPlayback:options=>createDreamPlayback({...options,setTimer:time.setTimer,clearTimer:time.clearTimer}),
    mountSurfaceFullscreen:()=>({toggle(){},destroy(){fullscreenDestroyed++;}}),
  });
  vm.runInContext(`${viewSource}\nglobalThis.mountDream=mountDream;`,context);
  const destroy=context.mountDream({root,icon:()=>'',esc:value=>String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;')},{items});
  return {time,root,surface,scene,dialog,detail,search,media,document,window,body,modal,ai,history,buttons,observers,destroy,
    ids:()=>scene.children.map(slot=>slot.children[0]?.dataset.cloud),
    clouds:()=>scene.children.flatMap(slot=>slot.children),
    paused:()=>surface.classList.contains('dream-paused'),
    click:action=>surface.emit('click',{target:buttons.get(action)}),
    focus:node=>{document.activeElement=node;surface.emit('focusout',{target:node});},
    overlayChange:()=>observers.find(item=>item.kind==='mutation').emit([]),
    offscreen:value=>observers.find(item=>item.kind==='intersection').emit([{isIntersecting:!value}]),
    fullscreenDestroyed:()=>fullscreenDestroyed,
  };
}

test('new thoughts emerge independently after a variable delay while existing DOM and positions remain intact',()=>{
  const h=harness(),original=h.scene.children.slice(),styles=original.map(node=>node.style.cssText);
  assert.equal(original.length,2);assert.equal(h.paused(),false);
  h.time.advance(2999);assert.deepEqual(h.scene.children,original);
  h.time.advance(3501);assert.ok(h.scene.children.length>2);assert.ok(original.every(node=>h.scene.children.includes(node)));
  assert.deepEqual(original.map(node=>node.style.cssText),styles,'arrivals do not redraw or reposition existing thoughts');
  assert.equal(new Set(h.ids()).size,h.ids().length);assert.ok(h.ids().every(id=>fixtures().some(item=>item.id===id)));h.destroy();
});

test('manual pause freezes automatic arrivals and leaves the user able to request more inspiration',()=>{
  const h=harness();h.click('pause');const initial=h.ids();assert.equal(h.paused(),true);
  assert.equal(h.buttons.get('pause').getAttribute('aria-pressed'),'true');h.time.advance(60000);assert.deepEqual(h.ids(),initial);
  h.click('next');assert.ok(h.ids().length>initial.length);assert.equal(h.paused(),true);const requested=h.ids();
  h.time.advance(60000);assert.deepEqual(h.ids(),requested);
  h.click('pause');assert.equal(h.paused(),false);assert.equal(h.time.pending(),1);h.destroy();
});

test('hover and keyboard reading suspend arrivals and lifetimes until reading ends',async()=>{
  const h=harness(),original=h.ids(),cloud=h.clouds()[0];
  h.time.advance(2000);h.scene.emit('pointerover',{target:cloud,pointerType:'mouse'});assert.equal(h.paused(),true);
  h.time.advance(30000);assert.deepEqual(h.ids(),original);assert.ok(h.scene.children.every(node=>!node.classList.contains('dream-leaving')));
  h.scene.emit('pointerout',{target:cloud,relatedTarget:h.body});assert.equal(h.paused(),false);
  h.time.advance(2999);assert.deepEqual(h.ids(),original);
  h.focus(cloud);await tick();assert.equal(h.paused(),true);h.time.advance(30000);assert.deepEqual(h.ids(),original);
  h.focus(h.search);await tick();assert.equal(h.paused(),true);h.time.advance(30000);assert.deepEqual(h.ids(),original);
  h.focus(h.body);await tick();assert.equal(h.paused(),false);h.time.advance(6500);assert.ok(h.ids().length>original.length);h.destroy();
});

test('opened thoughts stay present until details close and their returned focus leaves the thought',async()=>{
  const h=harness(),original=h.ids();h.surface.emit('click',{target:h.clouds()[0]});await tick();
  assert.equal(h.dialog.open,true);assert.equal(h.paused(),true);h.time.advance(60000);assert.deepEqual(h.ids(),original);
  h.click('close');await tick();assert.equal(h.dialog.open,false);assert.equal(h.paused(),true,'focus returns to the captured cloud');
  h.focus(h.body);await tick();assert.equal(h.paused(),false);h.time.advance(6500);assert.ok(h.ids().length>original.length);h.destroy();
});

test('global editor and AI overlays, hidden pages and offscreen surfaces pause both lifecycle and visual state',()=>{
  for(const reason of ['modal','ai','hidden','offscreen']){
    const h=harness(),original=h.ids();h.time.advance(2000);
    const change=value=>{
      if(reason==='modal'){h.modal.open=value;h.overlayChange();}
      if(reason==='ai'){h.ai.hidden=!value;h.overlayChange();}
      if(reason==='hidden'){h.document.hidden=value;h.document.emit('visibilitychange');}
      if(reason==='offscreen')h.offscreen(value);
    };
    change(true);assert.equal(h.paused(),true,reason);h.time.advance(120000);assert.deepEqual(h.ids(),original,reason);
    assert.ok(h.scene.children.every(node=>!node.classList.contains('dream-leaving')));assert.equal(h.time.pending(),0);
    change(false);assert.equal(h.paused(),false,reason);h.time.advance(2999);assert.deepEqual(h.ids(),original);
    h.time.advance(3501);assert.ok(h.ids().length>original.length);h.destroy();
  }
});

test('reduced motion stays static, permits requested arrivals and resumes scheduling when preference changes',()=>{
  const h=harness({reduced:true}),original=h.ids();assert.equal(h.paused(),true);assert.equal(h.buttons.get('pause').disabled,true);
  h.time.advance(60000);assert.deepEqual(h.ids(),original);h.click('next');assert.ok(h.ids().length>original.length);const requested=h.ids();
  h.time.advance(60000);assert.deepEqual(h.ids(),requested);
  h.media.matches=false;h.media.emit('change');assert.equal(h.paused(),false);assert.equal(h.buttons.get('pause').disabled,false);
  assert.equal(h.time.pending(),1);h.destroy();
});

test('switching to reduced motion removes already-departing thoughts without relying on animationend',()=>{
  const h=harness();h.time.advance(40000);
  const leaving=h.scene.children.filter(node=>node.classList.contains('dream-leaving'));
  assert.ok(leaving.length>0);const retained=h.scene.children.filter(node=>!leaving.includes(node));
  h.media.matches=true;h.media.emit('change');
  assert.ok(leaving.every(node=>!h.scene.children.includes(node)));assert.deepEqual(h.scene.children,retained);
  assert.equal(h.paused(),true);assert.equal(h.time.pending(),0);
  h.time.advance(120000);assert.deepEqual(h.scene.children,retained);
  h.click('next');assert.ok(h.scene.children.length>retained.length,'cancelled departures no longer occupy the scene capacity');h.destroy();
});

test('search rebuilds empty and single-record surfaces without timers or editing source records',async()=>{
  const items=fixtures(),before=structuredClone(items),h=harness({items});
  h.search.value='not-present';h.search.emit('input');assert.deepEqual(h.ids(),[]);assert.equal(h.buttons.get('next').disabled,true);
  h.time.advance(60000);assert.equal(h.time.pending(),0);
  h.search.value='海风';h.search.emit('input');assert.deepEqual(h.ids(),['two']);assert.equal(h.buttons.get('next').disabled,true);
  h.time.advance(60000);assert.deepEqual(h.ids(),['two']);assert.equal(h.time.pending(),0);
  h.search.value='';h.search.emit('input');h.focus(h.body);await tick();assert.equal(h.buttons.get('next').disabled,false);assert.equal(h.ids().length,2);
  h.time.advance(6500);assert.ok(h.ids().length>2);assert.deepEqual(items,before);h.destroy();
});

test('each thought retires on its own departure animation and frees space without replacing remaining thoughts',()=>{
  const h=harness();h.time.advance(40000);
  const retiring=h.scene.children.find(node=>node.classList.contains('dream-leaving'));assert.ok(retiring);
  const retained=h.scene.children.filter(node=>node!==retiring),departedId=retiring.children[0].dataset.cloud;
  h.scene.emit('animationend',{target:retiring,animationName:'unrelated'});assert.ok(h.scene.children.includes(retiring));
  h.scene.emit('animationend',{target:retiring,animationName:'dream-depart'});assert.ok(!h.scene.children.includes(retiring));
  assert.ok(!h.ids().includes(departedId));assert.ok(retained.every(node=>h.scene.children.includes(node)));
  const count=h.ids().length;h.click('next');assert.ok(h.ids().length>=count);assert.equal(new Set(h.ids()).size,h.ids().length);h.destroy();
});

test('a narrow one-slot scene keeps emitting new ideas after the sole visible thought completes its lifetime',()=>{
  const h=harness({width:339,height:270});assert.equal(h.ids().length,1,'the actual placement engine can fit only one thought');
  const seen=new Set(h.ids());
  for(let cycle=0;cycle<5;cycle++){
    const previous=h.scene.children[0],id=h.ids()[0];h.time.advance(50000);
    assert.equal(h.ids().length,1);assert.ok(previous.classList.contains('dream-leaving'),'a multi-record pool must not pin its sole visible thought forever');
    h.scene.emit('animationend',{target:previous,animationName:'dream-depart'});
    assert.equal(h.ids().length,1,'completing the last departure immediately fills the empty scene');
    assert.notEqual(h.scene.children[0],previous);assert.notEqual(h.ids()[0],id);seen.add(h.ids()[0]);
  }
  assert.equal(seen.size,6);h.destroy();
});

test('a genuinely single-record pool stays visible without automatic departure in the same narrow scene',()=>{
  const h=harness({items:[capture('only')],width:339,height:270}),only=h.scene.children[0];
  assert.deepEqual(h.ids(),['only']);assert.equal(h.time.pending(),0);
  h.time.advance(600000);assert.equal(h.scene.children[0],only);assert.ok(!only.classList.contains('dream-leaving'));
  assert.equal(h.buttons.get('next').disabled,true);assert.equal(h.time.pending(),0);h.destroy();
});

test('requesting inspiration in a full scene removes only the oldest visible thought and keeps other nodes',()=>{
  const h=harness();while(h.ids().length<5)h.click('next');const before=h.scene.children.slice();
  h.click('next');assert.equal(h.ids().length,5);assert.equal(before.filter(node=>h.scene.children.includes(node)).length,4);
  assert.equal(new Set(h.ids()).size,5);h.destroy();
});

test('resize changes view positions without modifying the captured content',()=>{
  const items=fixtures(),before=structuredClone(items),h=harness({items}),initial=h.scene.children.slice();
  h.surface.clientWidth=500;h.scene.clientWidth=500;h.scene.clientHeight=700;h.window.emit('resize');
  assert.equal(h.surface.classList.contains('dream-compact'),true);assert.ok(h.scene.children.length>0);
  assert.ok(h.scene.children.every(node=>initial.includes(node)));assert.deepEqual(items,before);
  assert.ok(h.scene.children.every(node=>typeof node.style.left==='string'));
  const positions=h.scene.children.map(node=>[node.style.left,node.style.top,node.style.width]);
  h.observers.find(observer=>observer.kind==='resize').emit([]);
  assert.deepEqual(h.scene.children.map(node=>[node.style.left,node.style.top,node.style.width]),positions,'duplicate observer notifications cannot reshuffle the current thoughts');h.destroy();
});

test('temporarily unmeasurable or too-small surfaces keep paused thoughts until valid dimensions return',()=>{
  const h=harness();h.click('pause');const existing=h.scene.children.slice(),ids=h.ids();
  for(const [width,height] of [[0,0],[200,600],[339,180]]){
    h.surface.clientWidth=width;h.scene.clientWidth=width;h.scene.clientHeight=height;
    h.observers.find(observer=>observer.kind==='resize').emit([]);
    assert.deepEqual(h.scene.children,existing,'a transient non-layout measurement must not retire existing thoughts');
    assert.deepEqual(h.ids(),ids);assert.equal(h.paused(),true);assert.equal(h.time.pending(),0);
  }
  h.surface.clientWidth=1000;h.scene.clientWidth=1000;h.scene.clientHeight=600;h.window.emit('resize');
  assert.deepEqual(h.ids(),ids);assert.equal(h.paused(),true);h.time.advance(60000);assert.deepEqual(h.ids(),ids);assert.equal(h.time.pending(),0);h.destroy();
});

test('resizing a paused full scene down to a valid single slot keeps at least one thought without restarting time',()=>{
  const h=harness();while(h.ids().length<5)h.click('next');h.click('pause');
  for(const [width,height] of [[339,270],[248,215],[1000,600]]){
    h.surface.clientWidth=width;h.scene.clientWidth=width;h.scene.clientHeight=height;h.window.emit('resize');
    assert.ok(h.ids().length>=1,'a valid view must retain or replace at least one existing thought');
    assert.equal(h.paused(),true);assert.equal(h.time.pending(),0);
  }
  const shown=h.ids();h.time.advance(60000);assert.deepEqual(h.ids(),shown);assert.equal(h.time.pending(),0);h.destroy();
});

test('restoring a measurable viewport fills an initially empty paused scene without resuming automatic arrivals',()=>{
  const h=harness({width:0,height:0});h.click('pause');assert.deepEqual(h.ids(),[]);assert.equal(h.time.pending(),0);
  h.surface.clientWidth=339;h.scene.clientWidth=339;h.scene.clientHeight=270;h.window.emit('resize');
  assert.equal(h.ids().length,1);assert.equal(h.paused(),true);assert.equal(h.time.pending(),0);
  const shown=h.ids();h.time.advance(60000);assert.deepEqual(h.ids(),shown);h.destroy();
});

test('unmount clears timers, observer subscriptions, listeners and pending detail state',async()=>{
  const h=harness();h.surface.emit('click',{target:h.clouds()[0]});await tick();assert.equal(h.dialog.open,true);
  h.destroy();await tick();assert.equal(h.dialog.open,false);assert.equal(h.time.pending(),0);
  assert.ok(h.observers.every(item=>item.disconnected));assert.equal(h.fullscreenDestroyed(),1);
  for(const target of [h.surface,h.scene,h.dialog,h.search,h.document,h.window,h.media])assert.equal(target.listenerCount(),0,target.name||'external');
  assert.equal(h.history.state.__czbYuzhouDream,undefined);const ids=h.ids();
  h.time.advance(120000);h.document.emit('visibilitychange');h.media.emit('change');assert.deepEqual(h.ids(),ids);assert.equal(h.time.pending(),0);
});
