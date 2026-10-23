import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createDreamEmitter,createDreamPlayback} from '../src/dream-flow.js';
import {placeDreamThought} from '../src/dream-layout.js';
import {createDreamMotion} from '../src/dream-motion.js';

// Execute the actual mounted view with deterministic browser event/timer surfaces.
// Fullscreen is a lifecycle stub; its browser behaviour has its own test suite.
const viewSource=fs.readFileSync(new URL('../src/dream.js',import.meta.url),'utf8')
  .replace(/^import .*;\r?$/gm,'').replace('export function mountDream','function mountDream');
const capture=(id,text=id)=>({id,text,category:'备忘',tags:'合成',archived:false,createdAt:'2026-10-12T00:00:00Z'});
const fixtures=()=>[capture('one','树叶与手写字'),capture('two','海风与旧照片'),capture('three','钟摆与时间'),...Array.from({length:12},(_,i)=>capture(`old-${i}`,`另一条旧念头 ${i}`))];
const tick=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
const fillScene=(h,count)=>{for(let attempt=0;attempt<20&&h.ids().length<count;attempt++){h.click('next');h.time.advance(740);}assert.equal(h.ids().length,count,'the roomy test scene reaches its capacity');};

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
    now(){return now;},
    nextAt(){return Math.min(...[...jobs.values()].map(job=>job.at));},
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
  const time=clock(),observers=[],animations=[],window=new Events(),document=new Events();
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
      if(selector==='[data-cloud]'&&this.children.some(node=>node.dataset.cloud))return this.children.find(node=>node.dataset.cloud);
      if(this===detail&&selector==='[data-dream="close"]')return detailClose;
      return selectors.get(selector)||null;
    }
    getBoundingClientRect(){
      if(String(this.className).includes('dream-cloud-slot')){
        const numeric=name=>parseFloat(this.style[name]??String(this.style.cssText||'').match(new RegExp(`(?:^|;)${name}:([^;]+)`))?.[1]);
        const width=numeric('width'),left=numeric('left'),top=numeric('top');
        return {width,height:width*176/300,left,top,right:left+width,bottom:top+width*176/300};
      }
      return {width:this.clientWidth,height:this.clientHeight,left:0,top:0};
    }
    animate(keyframes,options){
      const animation={element:this,keyframes,options,playState:'running',cancelled:false,finished:Promise.resolve(),
        pause(){this.playState='paused';},play(){this.playState='running';},cancel(){this.playState='idle';this.cancelled=true;}};
      animations.push(animation);return animation;
    }
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
    performance:{now:time.now},matchMedia:()=>media,setTimeout:time.setTimer,clearTimeout:time.clearTimer,queueMicrotask,
    IntersectionObserver:makeObserver('intersection'),ResizeObserver:makeObserver('resize'),MutationObserver:makeObserver('mutation'),
    createDreamEmitter:(input,options)=>createDreamEmitter(input,{random:math.random,...options}),
    placeDreamThought:options=>placeDreamThought({...options,random:math.random}),
    createDreamMotion:options=>createDreamMotion({...options,random:math.random}),
    createDreamPlayback:options=>createDreamPlayback({...options,setTimer:time.setTimer,clearTimer:time.clearTimer}),
    mountSurfaceFullscreen:()=>({toggle(){},destroy(){fullscreenDestroyed++;}}),
  });
  vm.runInContext(`${viewSource}\nglobalThis.mountDream=mountDream;`,context);
  const destroy=context.mountDream({root,icon:()=>'',esc:value=>String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;')},{items});
  return {time,root,surface,scene,dialog,detail,search,media,document,window,body,modal,ai,history,buttons,observers,animations,destroy,
    ids:()=>scene.children.map(slot=>slot.children[0]?.dataset.cloud),
    clouds:()=>scene.children.flatMap(slot=>slot.children),
    paused:()=>surface.classList.contains('dream-paused'),
    motion:slot=>animations.filter(animation=>animation.element===slot&&!animation.cancelled).at(-1),
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
  assert.ok(original.every(node=>h.motion(node)?.playState==='running'),'flow begins without a user gesture');
  h.time.advance(1799);assert.deepEqual(h.scene.children,original);
  h.time.advance(1401);assert.ok(h.scene.children.length>2);assert.ok(original.every(node=>h.scene.children.includes(node)));
  assert.deepEqual(original.map(node=>node.style.cssText),styles,'arrivals do not redraw or reposition existing thoughts');
  assert.equal(new Set(h.ids()).size,h.ids().length);assert.ok(h.ids().every(id=>fixtures().some(item=>item.id===id)));h.destroy();
});

test('manual pause freezes automatic arrivals and leaves the user able to request more inspiration',()=>{
  const h=harness();h.click('pause');const initial=h.ids();assert.equal(h.paused(),true);
  assert.ok(h.scene.children.every(node=>h.motion(node)?.playState==='paused'));
  assert.equal(h.buttons.get('pause').getAttribute('aria-pressed'),'true');h.time.advance(60000);assert.deepEqual(h.ids(),initial);
  h.click('next');assert.ok(h.ids().length>initial.length);assert.equal(h.paused(),true);const requested=h.ids();
  h.time.advance(60000);assert.deepEqual(h.ids(),requested);
  h.click('pause');assert.equal(h.paused(),false);assert.equal(h.time.pending(),1);
  assert.ok(h.scene.children.every(node=>h.motion(node)?.playState==='running'));h.destroy();
});

test('hover holds only the chosen thought while other thoughts keep moving and arriving',()=>{
  const h=harness(),[held,other]=h.scene.children,cloud=held.children[0];
  h.scene.emit('pointerover',{target:cloud,pointerType:'mouse'});
  assert.equal(h.paused(),false);assert.equal(h.motion(held).playState,'paused');assert.equal(h.motion(other).playState,'running');
  h.time.advance(6400);assert.ok(h.ids().length>2,'hover must not stop automatic arrivals');
  h.time.advance(60000);assert.ok(h.scene.children.includes(held));assert.ok(!held.classList.contains('dream-leaving'),'held thought does not expire during reading');
  assert.ok(other.classList.contains('dream-leaving'),'other thoughts still complete their own lifetime');
  h.scene.emit('pointerout',{target:cloud,relatedTarget:h.body});assert.equal(h.motion(held).playState,'running');
  h.time.advance(60000);assert.ok(held.classList.contains('dream-leaving'),'released thought resumes aging');h.destroy();
});

test('keyboard focus holds its own thought and search focus leaves the entire stream running',async()=>{
  const h=harness(),[held,other]=h.scene.children,cloud=held.children[0];
  h.focus(cloud);await tick();assert.equal(h.paused(),false);assert.equal(h.motion(held).playState,'paused');assert.equal(h.motion(other).playState,'running');
  h.time.advance(6400);assert.ok(h.ids().length>2);
  h.focus(h.search);await tick();assert.equal(h.paused(),false);assert.equal(h.motion(held).playState,'running');
  assert.ok(h.scene.children.every(node=>h.motion(node)?.playState==='running'));
  assert.equal(h.time.pending(),1);h.destroy();
});

test('leaving a hovered thought does not resume it while keyboard focus still holds it',async()=>{
  const h=harness(),held=h.scene.children[0],cloud=held.children[0];
  h.scene.emit('pointerover',{target:cloud,pointerType:'mouse'});h.focus(cloud);await tick();
  h.scene.emit('pointerout',{target:cloud,relatedTarget:h.body});assert.equal(h.motion(held).playState,'paused');
  h.focus(h.body);await tick();assert.equal(h.motion(held).playState,'running');h.destroy();
});

test('moving between thoughts transfers the hover hold and touch pointers do not leave a stuck hold',()=>{
  const h=harness(),[first,second]=h.scene.children,a=first.children[0],b=second.children[0];
  h.scene.emit('pointerover',{target:a,pointerType:'mouse'});assert.equal(h.motion(first).playState,'paused');
  h.scene.emit('pointerout',{target:a,relatedTarget:b});h.scene.emit('pointerover',{target:b,pointerType:'mouse'});
  assert.equal(h.motion(first).playState,'running');assert.equal(h.motion(second).playState,'paused');assert.equal(h.paused(),false);
  h.scene.emit('pointerout',{target:b,relatedTarget:h.body});h.scene.emit('pointerover',{target:a,pointerType:'touch'});
  assert.ok(h.scene.children.every(node=>h.motion(node)?.playState==='running'));h.destroy();
});

test('closing details keeps the returned focus safe without freezing the rest of the dream',async()=>{
  const h=harness(),original=h.ids(),[held,other]=h.scene.children;h.surface.emit('click',{target:held.children[0]});await tick();
  assert.equal(h.dialog.open,true);assert.equal(h.paused(),true);h.time.advance(60000);assert.deepEqual(h.ids(),original);
  assert.ok(h.scene.children.every(node=>h.motion(node)?.playState==='paused'));
  h.click('close');await tick();assert.equal(h.dialog.open,false);assert.equal(h.paused(),false);
  assert.equal(h.document.activeElement,held.children[0]);assert.equal(h.motion(held).playState,'paused');assert.equal(h.motion(other).playState,'running');
  h.time.advance(6400);assert.ok(h.ids().length>original.length);
  h.focus(h.body);await tick();assert.equal(h.motion(held).playState,'running');h.destroy();
});

test('global editor and AI overlays, hidden pages and offscreen surfaces pause both lifecycle and visual state',()=>{
  for(const reason of ['modal','ai','hidden','offscreen']){
    const h=harness(),original=h.ids();h.time.advance(900);
    const change=value=>{
      if(reason==='modal'){h.modal.open=value;h.overlayChange();}
      if(reason==='ai'){h.ai.hidden=!value;h.overlayChange();}
      if(reason==='hidden'){h.document.hidden=value;h.document.emit('visibilitychange');}
      if(reason==='offscreen')h.offscreen(value);
    };
    change(true);assert.equal(h.paused(),true,reason);h.time.advance(120000);assert.deepEqual(h.ids(),original,reason);
    assert.ok(h.scene.children.every(node=>h.motion(node)?.playState==='paused'),reason);
    assert.ok(h.scene.children.every(node=>!node.classList.contains('dream-leaving')));assert.equal(h.time.pending(),0);
    change(false);assert.equal(h.paused(),false,reason);assert.ok(h.scene.children.every(node=>h.motion(node)?.playState==='running'),reason);
    h.time.advance(1799);assert.deepEqual(h.ids(),original);
    h.time.advance(1401);assert.ok(h.ids().length>original.length);h.destroy();
  }
});

test('reduced motion stays static, permits requested arrivals and resumes scheduling when preference changes',()=>{
  const h=harness({reduced:true}),original=h.ids();assert.equal(h.paused(),true);assert.equal(h.buttons.get('pause').disabled,true);
  assert.ok(h.scene.children.every(node=>h.motion(node)?.playState!=='running'));
  h.time.advance(60000);assert.deepEqual(h.ids(),original);h.click('next');assert.ok(h.ids().length>original.length);const requested=h.ids();
  h.time.advance(60000);assert.deepEqual(h.ids(),requested);
  h.media.matches=false;h.media.emit('change');assert.equal(h.paused(),false);assert.equal(h.buttons.get('pause').disabled,false);
  assert.ok(h.scene.children.every(node=>h.motion(node)?.playState==='running'));
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
  const priorMotions=h.scene.children.map(node=>h.motion(node));
  h.search.value='not-present';h.search.emit('input');assert.deepEqual(h.ids(),[]);assert.equal(h.buttons.get('next').disabled,true);
  assert.ok(priorMotions.every(motion=>motion.cancelled),'filter replacement cleans up the previous animated nodes');
  h.time.advance(60000);assert.equal(h.time.pending(),0);
  h.search.value='海风';h.search.emit('input');assert.deepEqual(h.ids(),['two']);assert.equal(h.buttons.get('next').disabled,true);
  assert.equal(h.motion(h.scene.children[0]).playState,'running','one matching record still flows');
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
  assert.equal(h.motion(retiring),undefined,'completed departures cancel their position animation');
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
  assert.equal(h.motion(only).playState,'running');assert.equal(h.motion(only).options.iterations,Infinity,'a lone thought keeps flowing beyond one journey');
  assert.equal(h.buttons.get('next').disabled,true);assert.equal(h.time.pending(),0);h.destroy();
});

test('a requested arrival does not postpone the already-scheduled automatic deadline',()=>{
  const h=harness({width:1600,height:900});h.time.advance(300);const deadline=h.time.nextAt(),original=h.scene.children.slice();
  h.click('next');const incoming=h.scene.children.find(node=>!original.includes(node));assert.ok(incoming);
  assert.ok(!String(incoming.className).includes('dream-instant'));
  h.scene.emit('animationend',{target:incoming,animationName:'dream-arrive'});
  assert.equal(h.buttons.get('next').getAttribute('aria-busy'),'false');assert.equal(h.time.nextAt(),deadline,'manual feedback must not restart the automatic clock');h.destroy();
});

test('a manual request cannot alter the scene while a hard blocker owns attention',()=>{
  const h=harness();h.modal.open=true;h.overlayChange();const original=h.scene.children.slice();h.click('next');
  assert.deepEqual(h.scene.children,original);assert.notEqual(h.buttons.get('next').getAttribute('aria-busy'),'true');assert.equal(h.time.pending(),0);h.destroy();
});

test('requesting inspiration in a full scene fades one thought before arrival without restarting its neighbours',()=>{
  const h=harness({width:1600,height:900});fillScene(h,5);const before=h.scene.children.slice(),motions=before.map(node=>h.motion(node));
  h.click('next');assert.deepEqual(h.scene.children,before,'the full scene never deletes a thought on the click frame');
  const leaving=before.filter(node=>node.classList.contains('dream-leaving'));assert.equal(leaving.length,1);
  assert.equal(h.buttons.get('next').getAttribute('aria-busy'),'true');
  h.time.advance(419);assert.deepEqual(h.scene.children,before,'the departing thought remains through its fade');
  h.scene.emit('animationend',{target:leaving[0],animationName:'dream-depart'});
  assert.equal(h.ids().length,5);assert.equal(before.filter(node=>h.scene.children.includes(node)).length,4);
  const incoming=h.scene.children.find(node=>!before.includes(node));assert.ok(incoming);
  assert.ok(!String(incoming.className).includes('dream-instant'),'the new cloud has a real arrival animation');
  for(let i=0;i<before.length;i++)if(before[i]!==leaving[0])assert.equal(h.motion(before[i]),motions[i],'the other position animations are reused');
  h.time.advance(740);assert.equal(h.buttons.get('next').getAttribute('aria-busy'),'false');
  assert.equal(new Set(h.ids()).size,5);h.destroy();
});

test('repeated requests coalesce throughout departure and arrival while keyboard focus stays on the button',async()=>{
  const h=harness({width:1600,height:900});fillScene(h,5);h.focus(h.buttons.get('next'));await tick();const before=h.scene.children.slice();
  for(let i=0;i<15;i++)h.click('next');
  assert.equal(before.filter(node=>node.classList.contains('dream-leaving')).length,1);
  h.time.advance(480);const incoming=h.scene.children.find(node=>!before.includes(node));assert.ok(incoming);
  for(let i=0;i<15;i++)h.click('next');h.time.advance(740);
  assert.equal(before.filter(node=>h.scene.children.includes(node)).length,4);
  assert.equal(h.document.activeElement,h.buttons.get('next'));assert.equal(h.buttons.get('next').disabled,false);
  assert.equal(h.buttons.get('next').getAttribute('aria-busy'),'false');assert.equal(h.time.pending(),1);h.destroy();
});

test('a request joins an existing natural departure without restarting or removing its node',()=>{
  const h=harness({width:1600,height:900});h.time.advance(40000);h.click('pause');
  const before=h.scene.children.slice(),alreadyLeaving=before.filter(node=>node.classList.contains('dream-leaving'));
  assert.ok(alreadyLeaving.length);const motions=before.map(node=>h.motion(node));h.click('next');
  assert.deepEqual(h.scene.children,before);const waiting=before.find(node=>node.classList.contains('dream-manual-wait'));assert.ok(alreadyLeaving.includes(waiting));
  assert.equal(before.filter(node=>node.classList.contains('dream-leaving')).length,alreadyLeaving.length,'joining a departure does not retire an additional thought');
  before.forEach((node,i)=>assert.equal(h.motion(node),motions[i]));
  h.scene.emit('animationend',{target:waiting,animationName:'dream-depart'});h.time.advance(740);
  assert.equal(h.buttons.get('next').getAttribute('aria-busy'),'false');assert.ok(!h.scene.children.includes(waiting));h.destroy();
});

test('late animation events after the manual fallback cannot replace a second thought or finish the next phase',()=>{
  const h=harness({width:1600,height:900});fillScene(h,5);h.click('pause');const before=h.scene.children.slice();h.click('next');
  const leaving=before.find(node=>node.classList.contains('dream-leaving'));h.time.advance(480);
  const incoming=h.scene.children.find(node=>!before.includes(node));assert.ok(incoming);
  h.scene.emit('animationend',{target:leaving,animationName:'dream-depart'});
  assert.ok(h.scene.children.includes(incoming));assert.equal(h.buttons.get('next').getAttribute('aria-busy'),'true');
  h.time.advance(740);h.scene.emit('animationend',{target:incoming,animationName:'dream-arrive'});
  assert.equal(before.filter(node=>h.scene.children.includes(node)).length,4);assert.equal(h.buttons.get('next').getAttribute('aria-busy'),'false');assert.equal(h.time.pending(),0);h.destroy();
});

test('a two-record pool completes manual replacement when its only available record is the one just released',()=>{
  const h=harness({items:[capture('one'),capture('two')],width:1600,height:900});h.click('pause');assert.equal(h.ids().length,2);
  h.click('next');h.time.advance(1220);assert.deepEqual([...h.ids()].sort(),['one','two']);
  assert.equal(h.buttons.get('next').getAttribute('aria-busy'),'false');assert.equal(h.time.pending(),0);h.destroy();
});

test('requesting more inspiration preserves the thought held for reading',async()=>{
  const h=harness({width:1600,height:900});fillScene(h,5);const held=h.scene.children[0];
  h.focus(held.children[0]);await tick();const original=h.scene.children.slice();h.click('next');
  assert.equal(h.ids().length,5);assert.ok(h.scene.children.includes(held));assert.equal(h.motion(held).playState,'paused');
  assert.ok(!held.classList.contains('dream-leaving'));h.time.advance(1220);
  assert.equal(original.filter(node=>h.scene.children.includes(node)).length,4);assert.equal(h.paused(),false);h.destroy();
});

test('a paused scene can complete a requested transition while every movement and automatic clock remains paused',()=>{
  const h=harness({width:1600,height:900});fillScene(h,5);h.click('pause');const before=h.scene.children.slice();h.click('next');
  assert.deepEqual(h.scene.children,before);h.time.advance(1220);
  assert.equal(before.filter(node=>h.scene.children.includes(node)).length,4);assert.equal(h.paused(),true);
  assert.ok(h.scene.children.every(node=>h.motion(node).playState==='paused'));
  assert.equal(h.buttons.get('next').getAttribute('aria-busy'),'false');assert.equal(h.time.pending(),0);
  const after=h.ids();h.time.advance(60000);assert.deepEqual(h.ids(),after);h.destroy();
});

test('hard blockers freeze an in-flight manual transition and resume its remaining time',()=>{
  for(const reason of ['modal','ai','hidden','offscreen']){
    const h=harness({width:1600,height:900});fillScene(h,5);h.click('pause');h.click('next');h.time.advance(100);const before=h.scene.children.slice();
    const change=value=>{
      if(reason==='modal'){h.modal.open=value;h.overlayChange();}
      if(reason==='ai'){h.ai.hidden=!value;h.overlayChange();}
      if(reason==='hidden'){h.document.hidden=value;h.document.emit('visibilitychange');}
      if(reason==='offscreen')h.offscreen(value);
    };
    change(true);assert.ok(h.surface.classList.contains('dream-burst-blocked'));h.time.advance(60000);assert.deepEqual(h.scene.children,before,reason);assert.equal(h.time.pending(),0);
    change(false);h.time.advance(379);assert.deepEqual(h.scene.children,before,'hidden time does not consume the remaining transition');
    h.time.advance(741);assert.equal(before.filter(node=>h.scene.children.includes(node)).length,4);assert.equal(h.buttons.get('next').getAttribute('aria-busy'),'false');h.destroy();
  }
});

test('reading a manually departing thought freezes that transition until the pointer leaves',()=>{
  const h=harness({width:1600,height:900});fillScene(h,5);h.click('pause');h.click('next');
  const leaving=h.scene.children.find(node=>node.classList.contains('dream-leaving')),cloud=leaving.children[0];
  h.scene.emit('pointerover',{target:cloud,pointerType:'mouse'});const before=h.scene.children.slice();h.time.advance(60000);
  assert.deepEqual(h.scene.children,before);assert.equal(h.time.pending(),0);
  h.scene.emit('pointerout',{target:cloud,relatedTarget:h.body});h.time.advance(1220);
  assert.ok(!h.scene.children.includes(leaving));assert.equal(h.buttons.get('next').getAttribute('aria-busy'),'false');h.destroy();
});

test('search and resize cancel a pending request without a later arrival from the old view',()=>{
  for(const action of ['search','resize']){
    const h=harness({width:1600,height:900});fillScene(h,5);h.click('pause');h.click('next');
    if(action==='search'){h.search.value='海风';h.search.emit('input');}
    else{h.surface.clientWidth=1000;h.scene.clientWidth=1000;h.scene.clientHeight=600;h.window.emit('resize');}
    const after=h.ids();assert.equal(h.buttons.get('next').getAttribute('aria-busy'),'false');assert.equal(h.time.pending(),0);
    h.time.advance(60000);assert.deepEqual(h.ids(),after,action);assert.ok(h.scene.children.every(node=>!node.classList.contains('dream-manual-transition')));h.destroy();
  }
});

test('reducing motion completes a pending request immediately without leaving a busy button or transition timer',()=>{
  const h=harness({width:1600,height:900});fillScene(h,5);const before=h.scene.children.slice();h.click('next');
  h.media.matches=true;h.media.emit('change');assert.equal(before.filter(node=>h.scene.children.includes(node)).length,4);
  assert.equal(h.buttons.get('next').getAttribute('aria-busy'),'false');assert.equal(h.time.pending(),0);
  assert.ok(h.scene.children.every(node=>h.motion(node).playState==='paused'));h.destroy();
});

test('unmount cancels a pending manual request and cannot insert detached thoughts later',()=>{
  const h=harness({width:1600,height:900});fillScene(h,5);h.click('next');const before=h.scene.children.slice();
  h.destroy();assert.equal(h.time.pending(),0);h.time.advance(60000);assert.deepEqual(h.scene.children,before);
  assert.ok(h.animations.every(animation=>animation.cancelled));
});

test('mounted thought paths keep readable cloud rectangles apart even at different animation phases',()=>{
  const h=harness({width:1600,height:900});fillScene(h,5);
  const checkSeparated=()=>{
    const paths=h.scene.children.map(slot=>{
      const base=slot.getBoundingClientRect(),motion=h.motion(slot);assert.ok(motion,'every visible thought has a flow path');
      return motion.keyframes.map(frame=>{
        const [,dx,dy]=frame.transform.match(/^translate\(([-\d.e+]+)px, ([-\d.e+]+)px\)$/);
        return {x:base.left+Number(dx),y:base.top+Number(dy),w:base.width,h:base.height};
      });
    });
    for(let i=0;i<paths.length;i++)for(let j=i+1;j<paths.length;j++)for(const a of paths[i])for(const b of paths[j]){
      assert.ok(a.x+a.w<=b.x||b.x+b.w<=a.x||a.y+a.h<=b.y||b.y+b.h<=a.y,'separate thoughts must not cross through each other');
    }
  };
  checkSeparated();h.time.advance(6400);checkSeparated();
  h.surface.clientWidth=1000;h.scene.clientWidth=1000;h.scene.clientHeight=600;h.window.emit('resize');checkSeparated();h.destroy();
});

test('resize changes view positions without modifying the captured content',()=>{
  const items=fixtures(),before=structuredClone(items),h=harness({items}),initial=h.scene.children.slice();
  const originalMotions=initial.map(node=>h.motion(node));
  h.surface.clientWidth=500;h.scene.clientWidth=500;h.scene.clientHeight=700;h.window.emit('resize');
  assert.equal(h.surface.classList.contains('dream-compact'),true);assert.ok(h.scene.children.length>0);
  assert.ok(h.scene.children.every(node=>initial.includes(node)));assert.deepEqual(items,before);
  assert.ok(originalMotions.every(motion=>motion.cancelled),'motion paths for the former bounds are released');
  assert.ok(h.scene.children.every(node=>h.motion(node)?.playState==='running'));
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
  const h=harness({width:1600,height:900});fillScene(h,5);h.click('pause');
  for(const [width,height] of [[339,270],[248,215],[1000,600]]){
    h.surface.clientWidth=width;h.scene.clientWidth=width;h.scene.clientHeight=height;h.window.emit('resize');
    assert.ok(h.ids().length>=1,'a valid view must retain or replace at least one existing thought');
    assert.equal(h.paused(),true);assert.equal(h.time.pending(),0);
    assert.ok(h.scene.children.every(node=>h.motion(node)?.playState==='paused'),'replacement paths respect the existing pause state');
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
  assert.ok(h.animations.every(animation=>animation.cancelled),'no detached movement or detail animation survives unmount');
  h.time.advance(120000);h.document.emit('visibilitychange');h.media.emit('change');assert.deepEqual(h.ids(),ids);assert.equal(h.time.pending(),0);
});
