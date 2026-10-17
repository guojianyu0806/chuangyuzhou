import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {workspaceRoute} from '../src/return-navigation.js';
import {mountWelcome,selectWelcomeCards,welcomeHTML} from '../src/welcome.js';
import {getWelcomeModel} from '../src/welcome-model.js';
import {createWorkbench,configureWorkbench} from '../src/workbench-model.js';
import {createCustomBlock} from '../src/custom-blocks-model.js';

const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const workspace=()=>({workbench:createWorkbench('full'),profile:{name:'测试观察者'},spaces:[{id:'my-project',title:'自己的项目',notes:[]}],tasks:[],courses:[],captures:[]});
function withBlock(state,title='自己的小工具'){
  createCustomBlock(state,{kind:'miniapp',title,config:{code:'throw new Error("must never execute from the entrance")'}},{id:'block:own-tool',now:'2026-10-13T12:00:00.000Z'});
  return state;
}

test('welcome uses the current workspace and escapes every displayed user-supplied name',()=>{
  const state=withBlock(workspace(),'<svg onload="bad()">方块');
  configureWorkbench(state,{title:'研究 <img src=x onerror="bad()">',moduleId:'courses',moduleTitle:'课程 <script>bad()</script>'});
  state.profile.name='用户 "><iframe src=x>';
  state.spaces[0].title='项目 </strong><script>bad()</script>';
  const before=structuredClone(state),html=welcomeHTML(freeze(state));
  assert.match(html,/<h1 id="welcome-title"[^>]*>研究 &lt;img src=x onerror=&quot;bad\(\)&quot;&gt;<\/h1>/);
  assert.ok(html.includes('用户 &quot;&gt;&lt;iframe src=x&gt;'));
  assert.ok(html.includes('课程 &lt;script&gt;bad()&lt;/script&gt;'));
  assert.ok(html.includes('项目 &lt;/strong&gt;&lt;script&gt;bad()&lt;/script&gt;'));
  assert.ok(html.includes('&lt;svg onload=&quot;bad()&quot;&gt;方块'));
  assert.doesNotMatch(html,/<script|<iframe|<svg\s+onload|<img src=x/);
  assert.deepEqual(state,before);
});

test('entrance shows at most twenty real cards, prioritizing all modules and representing spaces and custom blocks',()=>{
  const state=withBlock(workspace());
  for(let index=0;index<30;index++)state.spaces.push({id:`more-${index}`,title:`空间${index}`});
  const cards=getWelcomeModel(state).cards,before=structuredClone(cards),selected=selectWelcomeCards(freeze(cards));
  assert.equal(selected.length,20);assert.equal(new Set(selected.map(card=>card.id)).size,20);
  assert.deepEqual(selected.slice(0,10).map(card=>card.id),state.workbench.modules.map(module=>module.id));
  assert.ok(selected.some(card=>card.kind==='space'));assert.ok(selected.some(card=>card.kind==='block'));
  assert.equal((welcomeHTML(state).match(/class="welcome-float welcome-slot-\d+"/g)||[]).length,20);
  assert.deepEqual(selectWelcomeCards([cards[0],...cards,cards[1]]).map(card=>card.id),selected.map(card=>card.id));
  assert.ok(selected.every(card=>cards.includes(card)));
  assert.deepEqual(cards,before);
});

test('bounded large catalogues still provide a custom-block representative and accurate workspace totals',()=>{
  const state=withBlock(workspace());state.spaces=Array.from({length:150},(_,index)=>({id:`project-${index}`,title:`项目${index}`}));
  const html=welcomeHTML(freeze(state));
  assert.ok(html.includes('自己的小工具'));
  assert.match(html,/10 个模块<span>·<\/span>150 个空间<span>·<\/span>1 个自定义方块/);
  assert.equal((html.match(/class="welcome-float welcome-slot-\d+"/g)||[]).length,20);
});

test('small or empty card catalogues do not invent duplicate modules or decorative records',()=>{
  assert.deepEqual(selectWelcomeCards([]),[]);
  const state={workbench:createWorkbench('blank')},html=welcomeHTML(freeze(state));
  assert.equal((html.match(/class="welcome-float welcome-slot-\d+"/g)||[]).length,1);
  assert.match(html,/1 个模块<span>·<\/span>0 个空间<span>·<\/span>0 个自定义方块/);
  assert.match(html,/data-welcome-action="builder"/);
  assert.doesNotMatch(html,/welcome-kind-space|welcome-kind-block/);
});

test('cards are labelled native buttons with no hidden ancestor or DOM-supplied routes and use only local imagery',()=>{
  const state=withBlock(workspace());
  state.spaces[0].description='https://external.example/private-image.png';
  const html=welcomeHTML(freeze(state));
  assert.match(html,/<div class="welcome-constellation">/);
  const buttons=[...html.matchAll(/<button\b[^>]*data-welcome-card="[^"]+"[^>]*>/g)].map(match=>match[0]);
  assert.equal(buttons.length,12);
  for(const button of buttons){
    assert.match(button,/type="button"/);assert.match(button,/title="进入[^\"]+"/);assert.match(button,/aria-label="进入[^\"]+"/);
    assert.doesNotMatch(button,/aria-hidden|tabindex="-1"|disabled|data-(?:go|route|subroute)=/);
  }
  assert.deepEqual([...html.matchAll(/<(?:img|iframe|script)[^>]*\bsrc="([^"]+)"/g)].map(match=>match[1]),['./icon.svg']);
  assert.doesNotMatch(html,/https:\/\/external\.example|must never execute/);
  assert.match(html,/<button type="button" class="welcome-enter" data-welcome-action="enter">/);
  assert.match(html,/<button type="button" data-welcome-motion aria-pressed="false">/);
});

// Real view and motion handlers run against a minimal event surface. Browser
// checks separately cover the native layout and pointer-animation appearance.
class Surface {
  constructor(){
    this.listeners=new Map();this.dataset={};this.attributes={};this.style={transform:''};
    const names=new Set();this.classList={contains:name=>names.has(name),toggle:(name,on)=>on?names.add(name):names.delete(name)};
  }
  addEventListener(name,fn){if(!this.listeners.has(name))this.listeners.set(name,new Set());this.listeners.get(name).add(fn);}
  removeEventListener(name,fn){this.listeners.get(name)?.delete(fn);}
  fire(name,properties={}){for(const fn of [...(this.listeners.get(name)||[])])fn({target:this,...properties});}
  setAttribute(name,value){this.attributes[name]=String(value);}
  getAttribute(name){return this.attributes[name]??null;}
  removeAttribute(name){delete this.attributes[name];}
  count(){return [...this.listeners.values()].reduce((sum,list)=>sum+list.size,0);}
  getBoundingClientRect(){return {left:0,top:0,width:1200,height:800};}
}

function mounted(t,{state:providedState,freezeState=true,go}={}){
  const old=new Map(['window','document','fetch'].map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  const win=new Surface(),doc=new Surface(),media=new Surface(),observers=[],frames=new Map(),calls=[];
  doc.hidden=false;media.matches=false;win.matchMedia=()=>media;
  let frameId=0;
  win.requestAnimationFrame=callback=>{frames.set(++frameId,callback);return frameId;};win.cancelAnimationFrame=id=>frames.delete(id);
  win.ResizeObserver=win.IntersectionObserver=class{constructor(){observers.push(this);}observe(){}disconnect(){this.disconnected=true;}};
  Object.defineProperty(globalThis,'window',{value:win,writable:true,configurable:true});
  Object.defineProperty(globalThis,'document',{value:doc,writable:true,configurable:true});
  Object.defineProperty(globalThis,'fetch',{value:()=>{calls.push('network');throw new Error('No network allowed in entrance test');},writable:true,configurable:true});
  const root=new Surface(),scene=new Surface(),stage=new Surface(),motion=new Surface(),label={textContent:'暂停浮动'},pause=new Surface(),tile=new Surface();
  tile.dataset={depth:'1',phase:'0'};tile.querySelector=selector=>selector==='.welcome-float-motion'?motion:null;
  pause.disabled=false;pause.querySelector=()=>label;pause.setAttribute('aria-pressed','false');
  scene.querySelector=selector=>selector==='.welcome-stage'?stage:selector==='[data-welcome-motion]'?pause:null;
  scene.querySelectorAll=selector=>selector==='.welcome-float'?[tile]:[];
  root.querySelector=selector=>selector==='.welcome'?scene:null;
  const buttons={};
  for(const action of ['enter','builder','settings','ai','unknown']){
    const button={dataset:{welcomeAction:action},inside:true};button.closest=()=>button;buttons[action]=button;
  }
  root.contains=button=>button.inside===true;
  let current=true;
  const state=providedState||withBlock(workspace());if(freezeState)freeze(state);
  const before=structuredClone(state);
  const cleanup=mountWelcome({root,state,go:(...args)=>{calls.push(['go',...args]);go?.(...args);},isCurrent:()=>current,save:()=>calls.push('save'),requestAI:()=>calls.push('AI'),executeActions:()=>calls.push('execute')});
  t.after(()=>{cleanup();for(const [name,descriptor]of old){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}});
  const card=(id,extra={})=>({dataset:{welcomeCard:id,...extra},inside:true,closest(){return this;}});
  return {root,scene,win,doc,media,frames,motion,pause,label,buttons,observers,calls,state,before,cleanup,card,setCurrent:value=>current=value,click:(button,properties={})=>root.fire('click',{target:button,...properties})};
}

test('mounted entry actions use existing routes without saving state, executing code or calling a model',t=>{
  const f=mounted(t);
  assert.ok(f.root.innerHTML.includes('自己的小工具'));
  assert.deepEqual(f.calls,[]);
  for(const action of ['enter','builder','settings','ai'])f.click({closest:()=>f.buttons[action]});
  assert.deepEqual(f.calls,[['go','home'],['go','builder'],['go','settings'],['go','ai']]);
  f.pause.fire('click');assert.equal(f.label.textContent,'继续浮动');
  f.pause.fire('click');assert.equal(f.label.textContent,'暂停浮动');
  assert.deepEqual(f.state,f.before);
  assert.ok(!f.calls.some(call=>typeof call==='string'));
});

test('delegated routes ignore unrelated buttons, detached targets and stale views',t=>{
  const f=mounted(t);
  f.click({});f.click(f.buttons.unknown);f.click({inside:false,dataset:{welcomeAction:'enter'},closest(){return this;}});
  f.setCurrent(false);f.click(f.buttons.enter);
  assert.deepEqual(f.calls,[]);
  f.setCurrent(true);f.click(f.buttons.enter);assert.deepEqual(f.calls,[['go','home']]);
});

test('native card activation routes modules, spaces and blocks using current catalogue identities only',t=>{
  const f=mounted(t);
  // Native Enter/Space activation dispatches a click with detail=0. There is no
  // custom keydown handler to trigger a second navigation.
  f.click(f.card('courses',{route:'settings',subroute:'forged'}),{detail:0});
  f.click(f.card('my-project',{route:'https://external.example',subroute:'forged'}),{detail:0});
  f.click(f.card('block:own-tool'),{detail:0});
  assert.deepEqual(f.calls,[['go','courses'],['go','space','my-project'],['go','block','block:own-tool']]);
  assert.equal(f.root.listeners.get('keydown')?.size||0,0);
  assert.deepEqual(f.state,f.before);assert.ok(!f.calls.some(call=>typeof call==='string'));
});

test('space and block identities reach the actual app router once and are correctly URL encoded',t=>{
  const state=withBlock(workspace());state.spaces[0].id='研究 / A?#%';
  const source=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
  const router=source.match(/^function go\(page,id=''[^\n]*\}\s*$/m)?.[0];
  assert.ok(router,'test must run the actual app route encoder');
  const location={hash:''},renders=[];
  const go=runInNewContext(`${router};go`,{location,workspaceRoute,render:()=>renders.push('render')});
  const f=mounted(t,{state,go});
  f.click(f.card(state.spaces[0].id));
  assert.equal(location.hash,'#/space/%E7%A0%94%E7%A9%B6%20%2F%20A%3F%23%25');
  f.click(f.card('block:own-tool'));assert.equal(location.hash,'#/block/block%3Aown-tool');
  f.click(f.card('block:own-tool'));assert.deepEqual(renders,['render']);
});

test('unknown, unrendered and detached card identities cannot navigate',t=>{
  const state=withBlock(workspace());
  for(let index=0;index<30;index++)state.spaces.push({id:`more-${index}`,title:`空间${index}`});
  const f=mounted(t,{state});
  for(const id of ['missing','constructor','__proto__','settings','more-29'])f.click(f.card(id,{route:'home'}));
  const external=f.card('courses');external.inside=false;f.click(external);
  f.setCurrent(false);f.click(f.card('my-project'));
  assert.deepEqual(f.calls,[]);
});

test('cards removed, archived or disabled after mounting cannot act through a stale button',t=>{
  const state=withBlock(workspace()),f=mounted(t,{state,freezeState:false});
  configureWorkbench(state,{moduleId:'courses',enabled:false});state.spaces[0].archived=true;state.customBlocks.items[0].archived=true;
  for(const id of ['courses','my-project','block:own-tool'])f.click(f.card(id));
  assert.deepEqual(f.calls,[]);
  f.click(f.card('tasks'));assert.deepEqual(f.calls,[['go','tasks']]);
});

test('view cleanup stops pending pointer motion, observers and handlers and prevents late navigation',t=>{
  const f=mounted(t),handler=[...f.root.listeners.get('click')][0];
  f.scene.fire('pointermove',{clientX:900,clientY:350,pointerType:'mouse',isPrimary:true,buttons:0});
  assert.equal(f.frames.size,1);
  f.cleanup();f.cleanup();
  assert.equal(f.frames.size,0);assert.equal(f.motion.style.transform,'');
  assert.ok(f.observers.every(observer=>observer.disconnected));
  for(const surface of [f.root,f.scene,f.win,f.doc,f.media,f.pause])assert.equal(surface.count(),0);
  f.click(f.buttons.enter);handler({target:f.buttons.enter});f.click(f.card('my-project'));handler({target:f.card('my-project')});
  assert.deepEqual(f.calls,[]);assert.deepEqual(f.state,f.before);
});
