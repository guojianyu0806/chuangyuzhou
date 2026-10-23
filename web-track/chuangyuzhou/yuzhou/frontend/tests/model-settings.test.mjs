import test from 'node:test';
import assert from 'node:assert/strict';
import {mountModelSettings} from '../src/cloud.js';

const status = (changes={}) => ({configured:false,provider:'deepseek',model:'deepseek-flash',engine:'deepseek-direct',engineAvailable:true,configurationSource:'none',configurationManaged:false,...changes});
const deferred = () => {let resolve,reject;const promise=new Promise((done,fail)=>{resolve=done;reject=fail;});return {promise,resolve,reject};};
const settle = async () => {await Promise.resolve();await Promise.resolve();await Promise.resolve();};

// The settings form only needs named fields, a submit button and text hosts.
// The select rejects values without an authored option, as a browser does.
function fixture(request) {
  const hosts=new Map(),key={value:'',disabled:false,placeholder:''},button={disabled:false};
  let selected='',options=[];
  const model={disabled:false,get value(){return selected;},set value(value){selected=options.includes(value)?value:'';}};
  const form={elements:{apiKey:key,model},querySelector:selector=>{assert.equal(selector,'button');return button;}};
  const container={isConnected:true,_html:'',get innerHTML(){return this._html;},set innerHTML(html){
    this._html=html;options=[...html.matchAll(/<option value="([^"]+)"/g)].map(match=>match[1]);selected=options[0];
    key.disabled=/<input[^>]*name="apiKey"[^>]*\bdisabled\b/.test(html);
    model.disabled=/<select[^>]*name="model"[^>]*\bdisabled\b/.test(html);
    button.disabled=/<button[^>]*type="submit"[^>]*\bdisabled\b/.test(html);
  },querySelector(selector){if(selector==='form')return form;if(!hosts.has(selector))hosts.set(selector,{textContent:''});return hosts.get(selector);}};
  const calls=[],toasts=[],client={request:async(path,configuration)=>{calls.push({path,configuration});return request(path,configuration);}};
  mountModelSettings(container,client,message=>toasts.push(message));
  return {container,form,key,model,button,calls,toasts,client,options:()=>options,
    text:selector=>container.querySelector(selector).textContent,
    submit:()=>form.onsubmit({preventDefault(){}})};
}

function assertLocked(view,expected=true) {
  for(const control of [view.key,view.model,view.button])assert.equal(control.disabled,expected);
}

test('settings stay locked before the initial source check and synthetic submit cannot bypass it',async()=>{
  const pending=deferred(),view=fixture(()=>pending.promise);
  assertLocked(view);
  await view.submit();assert.equal(view.calls.length,1);
  pending.resolve(status());await settle();assertLocked(view,false);
});

test('environment settings display source and all supported models without a key or writable controls',async()=>{
  for(const name of ['deepseek-flash','deepseek-v4-pro','deepseek-chat','deepseek-reasoner']){
    const view=fixture(()=>status({configured:true,model:name,configurationSource:'environment',configurationManaged:true}));
    await settle();assertLocked(view);assert.equal(view.model.value,name);assert.equal(view.key.value,'');
    assert.equal(view.options().includes(name),true);
    assert.match(view.text('#cloud-model-configuration'),/由启动环境配置，修改后重启/);
    assert.match(view.text('#cloud-model-badge'),/环境变量已配置/);
    assert.match(view.key.placeholder,/不会返回页面/);
    await view.submit();assert.equal(view.calls.length,1);assert.deepEqual(view.toasts,[]);
  }
});

test('a failed or malformed initial source check keeps unknown configuration locked',async()=>{
  for(const result of [()=>Promise.reject(new Error('合成连接失败')),()=>({})]){
    const view=fixture(result);await settle();assertLocked(view);
    assert.ok(view.text('.cloud-error'));await view.submit();assert.equal(view.calls.length,1);
  }
});

test('local settings preserve the save contract, clear the typed key and prevent overlapping submits',async()=>{
  const saved=deferred();
  const view=fixture((path,configuration)=>path==='/api/model/status'?status():saved.promise);
  await settle();assertLocked(view,false);view.key.value='synthetic-local-key';view.model.value='deepseek-v4-pro';
  const saving=view.submit();assertLocked(view);await view.submit();assert.equal(view.calls.length,2);
  assert.deepEqual(view.calls[1],{path:'/api/model/config',configuration:{method:'PUT',body:{provider:'deepseek',apiKey:'synthetic-local-key',model:'deepseek-v4-pro'}}});
  saved.resolve(status({configured:true,model:'deepseek-v4-pro',configurationSource:'local'}));await saving;
  assertLocked(view,false);assert.equal(view.key.value,'');assert.equal(view.toasts.length,1);
  assert.equal(view.container.innerHTML.includes('synthetic-local-key'),false);
});

test('known local save failures allow retry while retaining the unsaved key',async()=>{
  const view=fixture(path=>path==='/api/model/status'?status():Promise.reject(new Error('合成保存失败')));
  await settle();view.key.value='synthetic-unsaved-key';await view.submit();
  assertLocked(view,false);assert.equal(view.key.value,'synthetic-unsaved-key');assert.equal(view.text('.cloud-error'),'合成保存失败');assert.deepEqual(view.toasts,[]);
});

test('a server managed-config rejection locks a stale editable form and finally cannot unlock it',async()=>{
  const rejection=Object.assign(new Error('模型由启动环境配置，修改后重启工作台。'),{code:'MODEL_CONFIG_MANAGED',status:409});
  const view=fixture(path=>path==='/api/model/status'?status({configured:true,configurationSource:'local'}):Promise.reject(rejection));
  await settle();view.key.value='synthetic-stale-local-key';await view.submit();
  assertLocked(view);assert.equal(view.key.value,'');assert.match(view.text('#cloud-model-configuration'),/启动环境/);
  await view.submit();assert.equal(view.calls.length,2);assert.deepEqual(view.toasts,[]);
});

test('a managed response arriving during save remains read only after the handler completes',async()=>{
  const view=fixture(path=>path==='/api/model/status'?status():status({configured:true,configurationSource:'environment',configurationManaged:true,model:'deepseek-chat'}));
  await settle();view.key.value='synthetic-local-key';await view.submit();
  assertLocked(view);assert.equal(view.model.value,'deepseek-chat');assert.equal(view.key.value,'');
  assert.match(view.toasts[0],/启动环境配置/);assert.equal(view.toasts[0].includes('已保存'),false);
});

test('a malformed save response cannot unlock an unknown configuration',async()=>{
  const view=fixture(path=>path==='/api/model/status'?status():({}));
  await settle();view.key.value='synthetic-local-key';await view.submit();
  assertLocked(view);assert.match(view.text('.cloud-error'),/状态暂时无法确认/);assert.deepEqual(view.toasts,[]);
});
