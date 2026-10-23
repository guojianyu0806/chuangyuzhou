import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {mountMiniapp,miniappJSON,MINIAPP_CHANNEL} from '../src/miniapp-runtime.js';

const frameCode=readFileSync(new URL('../src/miniapp-frame.js',import.meta.url),'utf8');
const page=readFileSync(new URL('../miniapp-runtime.html',import.meta.url),'utf8');
const clone=value=>JSON.parse(JSON.stringify(value));
class Element{
  constructor(tag='div'){this.tagName=tag;this.children=[];this.listeners=new Map();this.attributes={};this.style={};this.value='';this.hidden=false;this.textContent='';}
  addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}
  removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
  setAttribute(key,value){this.attributes[key]=value;}
  append(...children){this.children.push(...children);for(const child of children)child.parentNode=this;}
  replaceChildren(...children){this.children=[];this.append(...children);}
  remove(){this.removed=true;if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(child=>child!==this);}
  async fire(type,extra={}){for(const fn of [...(this.listeners.get(type)||[])])await fn({target:this,preventDefault(){},...extra});}
}
function hostFixture(options={}){
  const win=new Element('window'),timers=new Map(),sent=[];let now=0;
  win.crypto=webcrypto;win.setInterval=fn=>{const id=++now;timers.set(id,fn);return id;};win.clearInterval=id=>timers.delete(id);
  const doc={defaultView:win,createElement:tag=>{const node=new Element(tag);node.ownerDocument=doc;if(tag==='iframe')node.contentWindow={postMessage:(message,target)=>sent.push({message,target})};return node;}},host=doc.createElement('main'),errors=[],writes=[];
  const cleanup=mountMiniapp(host,{code:"app.render([{type:'text',text:'hello'}]);",data:{count:0},onData:next=>writes.push(next),onError:error=>errors.push(error),...options});
  const shell=host.children[0],toolbar=shell.children[0],frame=shell.children[1],status=toolbar?.children[0],stop=toolbar?.children[1];
  const init=async()=>{await frame.fire('load');return sent[0]?.message.token;};
  const receive=async(message,extra={})=>win.fire('message',{source:frame.contentWindow,data:{channel:MINIAPP_CHANNEL,token:sent[0]?.message.token,...message},...extra});
  return {host,win,timers,sent,cleanup,frame,status,stop,errors,writes,init,receive};
}

test('JSON boundary rejects executable, non-JSON, oversized, cyclic and over-deep data',()=>{
  for(const value of [{x:()=>{}},{x:Infinity},{x:undefined},new Date(),{x:1n}])assert.throws(()=>miniappJSON(value));
  const cyclic={};cyclic.self=cyclic;assert.throws(()=>miniappJSON(cyclic));
  let deep={};for(let i=0;i<11;i++)deep={child:deep};assert.throws(()=>miniappJSON(deep));
  assert.throws(()=>miniappJSON({text:'字'.repeat(23000)}));
  const original={count:2,list:[true,null,'ok']},copy=miniappJSON(original);copy.list.push('changed');assert.equal(original.list.length,3);
});

test('host mounts a static opaque sandbox and sends only supplied code/data, never srcdoc',async()=>{
  const f=hostFixture();await f.init();
  assert.equal(f.frame.attributes.sandbox,'allow-scripts');assert.equal(f.frame.attributes.referrerpolicy,'no-referrer');assert.ok(f.frame.src.endsWith('/miniapp-runtime.html'));assert.equal(f.frame.srcdoc,undefined);
  assert.deepEqual(f.sent.map(item=>item.message.type),['init','code','data','run']);assert.match(f.sent[0].message.token,/^[a-f0-9]{48}$/);assert.deepEqual(f.sent[2].message.data,{count:0});
  assert.equal(page.includes('srcdoc'),false);assert.match(page,/script src="\.\/src\/miniapp-frame\.js"/);assert.match(page,/connect-src 'none'/);assert.match(page,/worker-src blob:/);assert.equal(page.includes('unsafe-eval'),false);f.cleanup();
});

test('host rejects forged source/token and malformed data before invoking persistence',async()=>{
  const f=hostFixture();await f.init();const save={type:'save',requestId:1,data:{count:1}};
  await f.receive(save,{source:{}});await f.receive({...save,token:'wrong'});assert.deepEqual(f.writes,[]);
  await f.receive({...save,data:{count:()=>{}}});assert.equal(f.errors.length,1);assert.equal(f.frame.removed,true);assert.deepEqual(f.writes,[]);f.cleanup();
});

test('asynchronous persistence is acknowledged only after success and failures remain errors',async()=>{
  let finish;const f=hostFixture({onData:()=>new Promise(resolve=>finish=resolve)});await f.init();
  const waiting=f.receive({type:'save',requestId:1,data:{count:2}});assert.equal(f.sent.some(item=>item.message.type==='saved'),false);assert.equal(f.status.textContent.includes('已保存'),false);
  finish();await waiting;assert.equal(f.sent.at(-1).message.ok,true);assert.match(f.status.textContent,/已保存/);f.cleanup();
  const failed=hostFixture({onData:async()=>{throw Error('synthetic disk failure');}});await failed.init();await failed.receive({type:'save',requestId:2,data:{count:3}});
  assert.equal(failed.sent.at(-1).message.ok,false);assert.match(failed.status.textContent,/保存失败/);assert.equal(failed.errors.length,1);failed.cleanup();
});

test('preview only acknowledges session data and cleanup rejects late asynchronous results',async()=>{
  const preview=hostFixture({preview:true});await preview.init();await preview.receive({type:'save',requestId:1,data:{count:9}});assert.deepEqual(preview.writes,[]);assert.match(preview.status.textContent,/预览/);preview.cleanup();
  let finish;const f=hostFixture({onData:()=>new Promise(resolve=>finish=resolve)});await f.init();const waiting=f.receive({type:'save',requestId:1,data:{count:2}});f.cleanup();const count=f.sent.length;finish();await waiting;assert.equal(f.sent.length,count);assert.equal(f.timers.size,0);assert.equal(f.win.listeners.get('message').size,0);f.cleanup();
});

test('stop and four-second watchdog remove the execution surface and its listeners',async t=>{
  const f=hostFixture();await f.init();await f.stop.fire('click');assert.equal(f.frame.removed,true);assert.match(f.status.textContent,/已停止/);assert.equal(f.timers.size,0);f.cleanup();
  const original=Date.now;let time=100;t.after(()=>Date.now=original);Date.now=()=>time;const hung=hostFixture();await hung.init();time+=4001;for(const tick of [...hung.timers.values()])tick();
  assert.equal(hung.frame.removed,true);assert.match(hung.status.textContent,/4 秒/);assert.equal(hung.errors.length,1);assert.equal(hung.win.listeners.get('message').size,0);hung.cleanup();
});

test('terminal notification fires once for internal stop or fatal failure, never for parent cleanup or recoverable save errors',async()=>{
  const stopped=[],f=hostFixture({onStop:message=>stopped.push(message)});await f.init();const stopCallback=[...f.stop.listeners.get('click')][0];
  await f.stop.fire('click');stopCallback();f.cleanup();assert.deepEqual(stopped,['小程序已停止']);
  const failed=[],bad=hostFixture({onStop:message=>failed.push(message)});await bad.init();await bad.receive({type:'error',message:'synthetic worker failure'});bad.cleanup();assert.deepEqual(failed,['synthetic worker failure']);
  const recoverable=[],retry=hostFixture({onData:()=>{throw new Error('synthetic persistence failure');},onStop:message=>recoverable.push(message)});await retry.init();await retry.receive({type:'save',requestId:1,data:{count:1}});assert.deepEqual(recoverable,[]);assert.equal(retry.frame.removed,undefined);retry.cleanup();assert.deepEqual(recoverable,[]);
});

function frameFixture(){
  const root=new Element('main'),error=new Element('p'),win=new Element('window'),out=[],workers=[],urls=new Map(),revoked=[];
  let context;
  const inFrame=value=>vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify(value))})`,context);
  const parent={postMessage:message=>out.push(clone(message))},doc={getElementById:id=>id==='miniapp-root'?root:error,createElement:tag=>{const node=new Element(tag);node.focus=()=>doc.activeElement=node;node.setSelectionRange=(start,end,direction)=>Object.assign(node,{selectionStart:start,selectionEnd:end,selectionDirection:direction});return node;},createDocumentFragment:()=>new Element('fragment')};
  class BlobStub{constructor(parts){this.source=parts.join('');}}
  class WorkerStub{
    constructor(url){this.url=url;this.messages=[];this.terminated=false;workers.push(this);}
    postMessage(message){this.messages.push(clone(message));}
    terminate(){this.terminated=true;}
    emit(message){this.onmessage?.({data:inFrame(message)});}
  }
  context=vm.createContext({window:win,parent,document:doc,TextEncoder,Blob:BlobStub,Worker:WorkerStub,URL:{createObjectURL:blob=>{const id='blob:synthetic-'+urls.size;urls.set(id,blob.source);return id;},revokeObjectURL:url=>revoked.push(url)}});vm.runInContext(frameCode,context);
  const token='a'.repeat(48),post=(message,extra={})=>win.fire('message',{source:parent,data:inFrame({channel:MINIAPP_CHANNEL,token,...message}),...extra});
  const start=async(code="app.render([{type:'text',text:'ready'}]);",data={count:0})=>{await post({type:'init'});await post({type:'code',code});await post({type:'data',data});await post({type:'run'});return workers.at(-1);};
  return {root,error,win,out,workers,urls,revoked,parent,post,start,doc};
}
const descendants=node=>[node,...node.children.flatMap(descendants)];

test('trusted frame creates a worker only after parent handshake and embeds no data in worker source',async()=>{
  const f=frameFixture();await f.post({type:'init'},{source:{}});await f.post({type:'run'});assert.equal(f.workers.length,0);
  const worker=await f.start('app.render([]);',{privateSynthetic:'only-through-message'});assert.equal(f.workers.length,1);
  const source=f.urls.get(worker.url);assert.ok(source.includes('app.render([])'));assert.equal(source.includes('only-through-message'),false);assert.deepEqual(worker.messages[0],{type:'initial',data:{privateSynthetic:'only-through-message'}});
  await f.post({type:'stop'});assert.equal(worker.terminated,true);assert.deepEqual(f.revoked,[worker.url]);
});

test('trusted renderer renders HTML-looking strings literally and sends string input snapshots',async()=>{
  const f=frameFixture(),worker=await f.start();worker.emit({type:'render',nodes:[{type:'heading',text:'<img src=x onerror=fetch(1)>'},{type:'number',id:'a',label:'A',value:0},{type:'select',id:'op',value:'add',options:[{value:'add',label:'加'}]},{type:'button',id:'calculate',label:'计算'}]});
  const nodes=descendants(f.root),heading=nodes.find(node=>node.tagName==='h2'),input=nodes.find(node=>node.tagName==='input'),button=nodes.find(node=>node.tagName==='button');
  assert.equal(heading.textContent,'<img src=x onerror=fetch(1)>');assert.equal(nodes.some(node=>node.tagName==='img'||node.tagName==='script'),false);input.value='3';await input.fire('input');await button.fire('click');
  assert.deepEqual(worker.messages.at(-1),{type:'event',event:{id:'calculate',type:'click',values:{a:'3',op:'add'}}});await input.fire('change');assert.deepEqual(worker.messages.at(-1).event,{id:'a',type:'change',value:'3',values:{a:'3',op:'add'}});
});

test('renderer rejects HTML/URL fields, unknown nodes, duplicate IDs and oversized trees',async()=>{
  let deep={type:'text',text:'end'};for(let i=0;i<8;i++)deep={type:'column',children:[deep]};
  for(const nodes of [[{type:'text',html:'<script/>'}],[{type:'button',id:'x',href:'https://invalid.test'}],[{type:'iframe'}],[{type:'button',id:'x'},{type:'input',id:'x'}],Array.from({length:201},()=>({type:'text'})),[deep]]){
    const f=frameFixture(),worker=await f.start();worker.emit({type:'render',nodes});assert.equal(worker.terminated,true);assert.equal(f.out.at(-1).type,'error');assert.equal(f.root.children.length,0);
  }
});

test('timer-driven renders preserve uncommitted input and focus until the declared value changes',async()=>{
  const f=frameFixture(),worker=await f.start();
  const paint=value=>worker.emit({type:'render',nodes:[{type:'input',id:'title',label:'标题',value},{type:'metric',value:Date.now()}]});
  paint('initial');let input=descendants(f.root).find(node=>node.tagName==='input');input.value='editing';input.selectionStart=2;input.selectionEnd=5;input.selectionDirection='forward';input.focus();await input.fire('input');
  paint('initial');input=descendants(f.root).find(node=>node.tagName==='input');assert.equal(input.value,'editing');assert.equal(f.doc.activeElement,input);assert.equal(input.selectionStart,2);assert.equal(input.selectionEnd,5);
  paint('changed by app');input=descendants(f.root).find(node=>node.tagName==='input');assert.equal(input.value,'changed by app');
});

test('worker message flooding terminates and revokes the dedicated worker',async()=>{
  const f=frameFixture(),worker=await f.start();for(let i=0;i<101;i++)worker.emit({type:'heartbeat'});assert.equal(worker.terminated,true);assert.equal(f.revoked.length,1);assert.match(f.out.at(-1).message,/频繁/);
});

test('worker API runs new interaction logic, waits for saved acknowledgement and has no network/DOM globals',async()=>{
  const f=frameFixture(),worker=await f.start("app.onEvent=async event=>{await app.setData({total:Number(event.values.a)+2});app.render([{type:'metric',value:app.getData().total}]);};app.render([{type:'text',text:typeof fetch+'/'+typeof importScripts+'/'+typeof navigator+'/'+typeof document+'/'+typeof Worker+'/'+typeof Object.getPrototypeOf(self).fetch+'/'+typeof Object.getPrototypeOf(self).importScripts}]);",{total:0});
  const listeners=new Map(),emitted=[],intervals=[];const self={postMessage:message=>emitted.push(clone(message)),addEventListener:(type,fn)=>{if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},removeEventListener:(type,fn)=>listeners.get(type)?.delete(fn),setInterval:fn=>intervals.push(fn),fetch:()=>{throw Error('must not run');},navigator:{},importScripts:()=>{},Worker:()=>{}};
  Object.setPrototypeOf(self,{fetch:()=>{throw Error('inherited fetch must not run');},importScripts:()=>{throw Error('inherited importScripts must not run');}});
  self.self=self;self.TextEncoder=TextEncoder;const context=vm.createContext(self);vm.runInContext(f.urls.get(worker.url),context,{timeout:100});
  const deliver=message=>{const data=vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify(message))})`,context);for(const fn of [...(listeners.get('message')||[])])fn({data});};deliver(worker.messages[0]);
  assert.equal(emitted.find(message=>message.type==='render').nodes[0].text,'undefined/undefined/undefined/undefined/undefined/undefined/undefined');
  deliver({type:'event',event:{id:'calculate',type:'click',values:{a:'3'}}});const save=emitted.find(message=>message.type==='save');assert.deepEqual(save.data,{total:5});assert.equal(emitted.filter(message=>message.type==='render').length,1);
  deliver({type:'saved',requestId:save.requestId,ok:true});await new Promise(resolve=>setImmediate(resolve));assert.equal(emitted.at(-1).nodes[0].value,5);intervals[0]();assert.equal(emitted.at(-1).type,'heartbeat');
});
