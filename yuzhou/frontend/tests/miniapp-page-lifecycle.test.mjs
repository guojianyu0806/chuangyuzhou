import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {mountCustomBlockPage} from '../src/custom-blocks.js';
import {createCustomBlock,getCustomBlocks} from '../src/custom-blocks-model.js';
import {MINIAPP_CHANNEL} from '../src/miniapp-runtime.js';

// Keep the real page and sandbox host together; the DOM only supplies their
// browser events and elements, so a stopped iframe must update the actual page.
class Element {
  constructor(tag='div'){this.tagName=tag;this.children=[];this.listeners=new Map();this.attributes={};this.style={};this.dataset={};this.disabled=false;this.textContent='';}
  addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}
  removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
  setAttribute(key,value){this.attributes[key]=value;}
  append(...children){this.children.push(...children);for(const child of children)child.parentNode=this;}
  replaceChildren(...children){for(const child of this.children)child.parentNode=null;this.children=[];this.append(...children);}
  remove(){this.removed=true;if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(child=>child!==this);}
  closest(selector){return selector==='[data-cb-action]'&&this.dataset.cbAction?this:null;}
  async fire(type,extra={}){for(const fn of [...(this.listeners.get(type)||[])])await fn({target:this,preventDefault(){},...extra});}
}

function pageFixture({code='app.render([]);'}={}){
  const win=new Element('window'),timers=new Map(),frames=[],messages=[],state={};let timerId=0,saves=0,rejectSave=false;
  win.crypto=webcrypto;win.setInterval=fn=>{const id=++timerId;timers.set(id,fn);return id;};win.clearInterval=id=>timers.delete(id);
  const doc={defaultView:win,createElement:tag=>{
    const element=new Element(tag);element.ownerDocument=doc;
    if(tag==='iframe'){element.sent=[];element.contentWindow={postMessage:message=>element.sent.push(message)};frames.push(element);}
    return element;
  }};
  const root=doc.createElement('main');let controls=new Map();
  Object.defineProperty(root,'innerHTML',{set(html){
    controls=new Map();
    for(const action of ['run','stop'])if(html.includes(`data-cb-action="${action}"`)){
      const button=doc.createElement('button');button.dataset.cbAction=action;button.disabled=action==='stop';controls.set(`[data-cb-action="${action}"]`,button);
    }
    if(html.includes('data-cb-runtime'))controls.set('[data-cb-runtime]',doc.createElement('div'));
    if(html.includes('data-cb-status')){const status=doc.createElement('p');status.textContent='尚未运行。保存源码或打开页面不会自动运行。';controls.set('[data-cb-status]',status);}
  }});
  root.querySelector=selector=>controls.get(selector)||null;
  const block=createCustomBlock(state,{kind:'miniapp',title:'合成计数工具',config:{code},data:{count:0}},{id:'block:lifecycle'});
  const ctx={root,state,isCurrent:()=>true,save(){if(rejectSave)throw new Error('synthetic storage full');saves++;},toast:message=>messages.push(message)};
  let cleanup=mountCustomBlockPage(ctx,block.id);
  const click=async action=>{const button=controls.get(`[data-cb-action="${action}"]`);assert.ok(button,`${action} control exists`);assert.equal(button.disabled,false,`${action} control is usable`);await root.fire('click',{target:button});};
  const session=()=>{
    const frame=frames.at(-1),host=controls.get('[data-cb-runtime]'),shell=host.children[0],toolbar=shell?.children[0];
    return {frame,innerStop:toolbar?.children[1],
      init:()=>frame.fire('load'),
      receive:message=>win.fire('message',{source:frame.contentWindow,data:{channel:MINIAPP_CHANNEL,token:frame.sent[0]?.token,...message}})};
  };
  return {root,win,timers,frames,state,block,messages,cleanup:()=>cleanup(),remount:()=>{cleanup();cleanup=mountCustomBlockPage(ctx,block.id);},click,session,
    button:action=>controls.get(`[data-cb-action="${action}"]`),status:()=>controls.get('[data-cb-status]').textContent,
    saves:()=>saves,rejectSave:value=>rejectSave=value};
}

test('internal stop restores page controls and a fresh explicit run persists data',async t=>{
  const f=pageFixture();t.after(f.cleanup);assert.equal(f.frames.length,0,'opening the block does not execute it');
  await f.click('run');const first=f.session();await first.init();assert.equal(f.button('run').disabled,true);
  await first.innerStop.fire('click');assert.equal(first.frame.removed,true);assert.equal(f.timers.size,0);
  assert.equal(f.button('run').disabled,false);assert.equal(f.button('stop').disabled,true);assert.match(f.status(),/停止/);
  await f.click('run');const second=f.session();await second.init();assert.notEqual(second.frame,first.frame);assert.notEqual(second.frame.sent[0].token,first.frame.sent[0].token);
  await first.receive({type:'save',requestId:1,data:{count:99}});assert.equal(f.saves(),0,'obsolete frame cannot write');
  await second.receive({type:'save',requestId:1,data:{count:2}});assert.equal(f.saves(),1);assert.deepEqual(getCustomBlocks(f.state).items[0].data,{count:2});
});

test('fatal runtime failure remains visible and permits an explicit retry',async t=>{
  const f=pageFixture();t.after(f.cleanup);await f.click('run');const failed=f.session();await failed.init();
  await failed.receive({type:'error',message:'synthetic render error'});assert.equal(failed.frame.removed,true);assert.match(f.status(),/synthetic render error/);
  assert.equal(f.button('run').disabled,false);assert.equal(f.button('stop').disabled,true);
  await f.click('run');const retry=f.session();await retry.init();assert.equal(retry.frame.removed,undefined);assert.equal(f.timers.size,1);assert.equal(f.saves(),0);
});

test('watchdog termination restores page controls without requiring an extra stop',async t=>{
  const original=Date.now;let time=100;Date.now=()=>time;t.after(()=>Date.now=original);
  const f=pageFixture();t.after(f.cleanup);await f.click('run');const hung=f.session();await hung.init();time+=4001;
  for(const tick of [...f.timers.values()])tick();assert.equal(hung.frame.removed,true);assert.match(f.status(),/4 秒/);
  assert.equal(f.button('run').disabled,false);assert.equal(f.button('stop').disabled,true);assert.equal(f.timers.size,0);
  await f.click('run');assert.equal(f.frames.length,2);assert.equal(f.timers.size,1);
});

test('startup envelope rejection leaves no iframe and restores the retry control',async t=>{
  const f=pageFixture({code:`//${'字'.repeat(23000)}`});t.after(f.cleanup);await f.click('run');
  assert.equal(f.frames.length,0);assert.equal(f.timers.size,0);assert.match(f.status(),/64 KiB/);
  assert.equal(f.button('run').disabled,false);assert.equal(f.button('stop').disabled,true);
  await f.click('run');assert.equal(f.frames.length,0,'retry still validates before any execution');
});

test('unexpected startup failure restores controls and does not leave a runtime behind',async t=>{
  const f=pageFixture();t.after(f.cleanup);f.win.crypto={getRandomValues(){throw new Error('synthetic startup failure');}};
  await f.click('run');assert.equal(f.frames.length,0);assert.equal(f.timers.size,0);assert.match(f.status(),/synthetic startup failure/);
  assert.equal(f.button('run').disabled,false);assert.equal(f.button('stop').disabled,true);f.win.crypto=webcrypto;
  await f.click('run');assert.equal(f.frames.length,1);assert.equal(f.button('run').disabled,true);
});

test('recoverable persistence errors keep the current runtime alive and allow another save',async t=>{
  const f=pageFixture();t.after(f.cleanup);await f.click('run');const current=f.session();await current.init();f.rejectSave(true);
  await current.receive({type:'save',requestId:1,data:{count:3}});assert.equal(current.frame.sent.at(-1).ok,false);assert.match(f.status(),/synthetic storage full/);
  assert.equal(f.button('run').disabled,true);assert.equal(f.button('stop').disabled,false);assert.equal(current.frame.removed,undefined);
  assert.deepEqual(getCustomBlocks(f.state).items[0].data,{count:0});f.rejectSave(false);
  await current.receive({type:'save',requestId:2,data:{count:3}});assert.equal(current.frame.sent.at(-1).ok,true);assert.equal(f.saves(),1);
  assert.deepEqual(getCustomBlocks(f.state).items[0].data,{count:3});assert.equal(f.frames.length,1);
});

test('outer stop and unmount invalidate old callbacks without stopping or relabeling a new run',async t=>{
  const f=pageFixture();t.after(f.cleanup);await f.click('run');const old=f.session();await old.init();
  const oldStop=[...old.innerStop.listeners.get('click')],oldTicks=[...f.timers.values()],oldMessages=[...f.win.listeners.get('message')];
  await f.click('stop');assert.equal(old.frame.removed,true);assert.equal(f.button('run').disabled,false);assert.equal(f.button('stop').disabled,true);
  await f.click('run');const current=f.session();await current.init();const status=f.status();
  for(const callback of oldStop)callback();for(const tick of oldTicks)tick();
  for(const receive of oldMessages)await receive({source:old.frame.contentWindow,data:{channel:MINIAPP_CHANNEL,token:old.frame.sent[0].token,type:'error',message:'obsolete error'}});
  assert.equal(f.status(),status);assert.equal(f.button('run').disabled,true);assert.equal(f.button('stop').disabled,false);assert.equal(current.frame.removed,undefined);
  const lastTicks=[...f.timers.values()];f.cleanup();assert.equal(current.frame.removed,true);assert.equal(f.timers.size,0);assert.equal(f.win.listeners.get('message').size,0);
  const ended=f.status();for(const tick of lastTicks)tick();await current.receive({type:'save',requestId:1,data:{count:99}});assert.equal(f.status(),ended);assert.equal(f.saves(),0);
});

test('callbacks retained across page unmount cannot affect the next mounted session',async t=>{
  const f=pageFixture();t.after(f.cleanup);await f.click('run');const old=f.session();await old.init();
  const oldStop=[...old.innerStop.listeners.get('click')],oldTicks=[...f.timers.values()],oldMessages=[...f.win.listeners.get('message')];
  f.remount();assert.equal(old.frame.removed,true);assert.equal(f.timers.size,0);assert.equal(f.frames.length,1,'remount does not run saved code');
  await f.click('run');const current=f.session();await current.init();const status=f.status();
  for(const callback of oldStop)callback();for(const tick of oldTicks)tick();
  for(const receive of oldMessages)await receive({source:old.frame.contentWindow,data:{channel:MINIAPP_CHANNEL,token:old.frame.sent[0].token,type:'save',requestId:1,data:{count:99}}});
  assert.equal(f.status(),status);assert.equal(f.button('run').disabled,true);assert.equal(f.button('stop').disabled,false);assert.equal(current.frame.removed,undefined);assert.equal(f.saves(),0);
  await current.receive({type:'save',requestId:1,data:{count:4}});assert.equal(f.saves(),1);assert.deepEqual(getCustomBlocks(f.state).items[0].data,{count:4});
});
