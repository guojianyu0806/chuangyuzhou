import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {bootstrapCloud,browserSupportProblem,CloudClient} from '../src/cloud.js';

function replaceGlobal(t,name,value){
  const previous=Object.getOwnPropertyDescriptor(globalThis,name);
  Object.defineProperty(globalThis,name,{configurable:true,writable:true,value});
  t.after(()=>{if(previous)Object.defineProperty(globalThis,name,previous);else delete globalThis[name];});
}
function memoryStorage(){
  const values=new Map();
  return {get length(){return values.size;},getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
}
function fixture(t,{secure=true,crypto=webcrypto,authenticated=false}={}){
  const form={},retry={},requests=[],events=[],app={innerHTML:'',querySelector(selector){assert.equal(selector,'form');return form;}};
  const local=memoryStorage(),session=memoryStorage();
  replaceGlobal(t,'isSecureContext',secure);replaceGlobal(t,'crypto',crypto);
  replaceGlobal(t,'localStorage',local);replaceGlobal(t,'sessionStorage',session);replaceGlobal(t,'indexedDB',{});
  replaceGlobal(t,'location',{hostname:'workbench.example',origin:'https://workbench.example',reload(){events.push('reload');}});
  replaceGlobal(t,'window',{addEventListener(name){events.push(name);}});
  replaceGlobal(t,'document',{querySelector(selector){if(selector==='#app')return app;if(selector==='#browser-retry')return retry;throw Error('Unexpected selector: '+selector);}});
  replaceGlobal(t,'fetch',async(path,options)=>{requests.push({path,options});return new Response(JSON.stringify(path==='/api/health'?{mode:'cloud'}:{authenticated,username:'synthetic-web-user',csrfToken:'synthetic-csrf'}),{headers:{'Content-Type':'application/json'}});});
  return {form,retry,requests,events,app,local,session};
}
const settle=async()=>{for(let count=0;count<12;count++)await Promise.resolve();};

test('plain HTTP displays the HTTPS requirement before authentication, storage access or network requests',async t=>{
  const f=fixture(t,{secure:false});
  // This getter would fail if the guard reached persisted data in this mode.
  Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw Error('must not read insecure storage');}});
  let completed=false;bootstrapCloud().then(()=>{completed=true;});await settle();
  assert.match(f.app.innerHTML,/HTTPS/);assert.match(f.app.innerHTML,/尚未读取工作区/);
  assert.equal(f.app.innerHTML.includes('type="password"'),false);assert.deepEqual(f.requests,[]);assert.equal(completed,false);
  f.retry.onclick();assert.deepEqual(f.events,['reload']);
});

test('a secure browser without UUID or file hash support gets an explanation instead of an exception',async t=>{
  const f=fixture(t,{crypto:{}});bootstrapCloud();await settle();
  assert.match(f.app.innerHTML,/当前浏览器缺少必要功能/);assert.deepEqual(f.requests,[]);
});

test('denied browser storage gets a retry page without clearing existing data or calling the backend',async t=>{
  const f=fixture(t);f.session.setItem('synthetic-unsent-draft','保留草稿');
  Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw Error('synthetic denied storage');}});
  bootstrapCloud();await settle();assert.match(f.app.innerHTML,/存储权限/);assert.match(f.app.innerHTML,/请勿清除/);
  assert.equal(f.session.getItem('synthetic-unsent-draft'),'保留草稿');assert.deepEqual(f.requests,[]);
});

test('secure web startup keeps authenticated same-origin sessions and account cache identity',async t=>{
  const f=fixture(t,{authenticated:true});let prepared=false;
  const prepare=CloudClient.prototype.prepareStorage;
  CloudClient.prototype.prepareStorage=async function(){prepared=true;};t.after(()=>{CloudClient.prototype.prepareStorage=prepare;});
  const client=await bootstrapCloud();
  assert.ok(client instanceof CloudClient);assert.equal(prepared,true);assert.equal(client.account,'synthetic-web-user');
  assert.match(client.cacheKey,/^czb-yuzhou-cloud-v1-synthetic-web-user-/);
  assert.deepEqual(f.requests.map(call=>call.path),['/api/health','/api/auth/session']);
  assert.equal(f.requests[1].options.credentials,'same-origin');assert.equal(client.session.csrfToken,'synthetic-csrf');
});

test('secure remote login page preserves setup and login behavior without claiming local-only access',async t=>{
  const f=fixture(t);bootstrapCloud();await settle();
  assert.match(f.app.innerHTML,/欢迎回到创宇宙/);assert.match(f.app.innerHTML,/登录后访问你的工作区/);
  assert.equal(f.app.innerHTML.includes('当前仅本机访问'),false);assert.equal(typeof f.form.onsubmit,'function');
  assert.deepEqual(f.requests.map(call=>call.path),['/api/health','/api/auth/session']);
});

test('local secure contexts retain support while missing persistent storage is diagnosed',()=>{
  const supported={isSecureContext:true,crypto:webcrypto,indexedDB:{},localStorage:memoryStorage(),sessionStorage:memoryStorage()};
  assert.equal(browserSupportProblem(supported),null);
  assert.match(browserSupportProblem({...supported,indexedDB:undefined}).title,/存储暂不可用/);
  assert.match(browserSupportProblem({...supported,crypto:{randomUUID(){}}}).title,/缺少必要功能/);
});

test('web workspace writes keep relative URLs, same-origin cookies and the existing CSRF boundary',async t=>{
  const f=fixture(t),client=Object.assign(Object.create(CloudClient.prototype),{session:{csrfToken:'synthetic-write-token'}});
  await client.request('/api/workspace',{method:'PUT',body:{baseRevision:3,state:{synthetic:true}}});
  assert.equal(f.requests.length,1);const {path,options}=f.requests[0];
  assert.equal(path,'/api/workspace');assert.equal(options.credentials,'same-origin');
  assert.equal(options.headers['X-CSRF-Token'],'synthetic-write-token');assert.equal(options.headers['Content-Type'],'application/json');
  assert.deepEqual(JSON.parse(options.body),{baseRevision:3,state:{synthetic:true}});
});
