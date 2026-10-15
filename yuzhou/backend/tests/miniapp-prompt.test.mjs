import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {buildPrompt} from '../hermes.mjs';

const prompt=()=>buildPrompt({text:'创建可审核的小工具',sources:[],destinations:[],destinationId:'workspace',kind:'conversation'}).system;
const clone=value=>JSON.parse(JSON.stringify(value));
function exampleFixture(){
  // This executes only the fixed example authored in our production prompt,
  // never model output, a workspace record or an external script.
  const code=/小程序输入校验与显式保存示例[^\n]*\n```js\n([\s\S]*?)\n```/.exec(prompt())?.[1];
  assert.ok(code,'the production prompt includes a runnable input-validation example');
  const renders=[],writes=[];let stored={amount:5,retained:'keep'},finish,reject;
  const app={getData:()=>clone(stored),render:nodes=>renders.push(clone(nodes)),setData:next=>{
    writes.push(clone(next));return new Promise((resolve,fail)=>{finish=()=>{stored=clone(next);resolve();};reject=()=>fail(new Error('synthetic save rejected'));});
  }};
  new vm.Script(code,{filename:'owned-miniapp-prompt-example.js'}).runInNewContext({app},{timeout:1000});
  return {renders,writes,stored:()=>clone(stored),finish:()=>finish(),reject:()=>reject(),
    event:(type='click',amount='12.50',id='save')=>app.onEvent({id,type,values:{amount}})};
}

test('miniapp prompt identifies the injected app API and forbids substituting this or redeclaring it',()=>{
  const system=prompt();
  assert.match(system,/直接使用.*已注入.*app/);assert.match(system,/不能.*this.*app/);assert.match(system,/不要重新声明.*app/);
  assert.match(system,/输入不合法.*只.*render.*不.*setData/);assert.match(system,/显式.*事件.*校验.*setData/);
  assert.match(system,/提示.*不保证.*生成.*正确/);
});

test('owned prompt example starts without writes and ignores non-save events',async()=>{
  const f=exampleFixture();assert.deepEqual(f.writes,[]);assert.equal(f.renders.length,1);
  await f.event('change','99','amount');await f.event('click','99','other');await f.event('input','99');
  assert.deepEqual(f.writes,[]);assert.deepEqual(f.stored(),{amount:5,retained:'keep'});
});

test('owned prompt example renders invalid-input feedback without saving or changing stored data',async()=>{
  const f=exampleFixture();
  for(const amount of ['', '  ', '-1', 'bad', 'NaN', 'Infinity']){
    await f.event('click',amount);assert.deepEqual(f.writes,[]);assert.deepEqual(f.stored(),{amount:5,retained:'keep'});
    assert.ok(f.renders.at(-1).some(node=>node.type==='text'&&/请输入/.test(node.text)));
  }
});

test('owned prompt example converts values and shows success only after explicit save acknowledgement',async()=>{
  const f=exampleFixture(),pending=f.event('click','12.50');
  assert.deepEqual(f.writes,[{amount:12.5,retained:'keep'}]);assert.deepEqual(f.stored(),{amount:5,retained:'keep'});
  assert.ok(!f.renders.at(-1).some(node=>node.type==='text'&&node.text==='已保存'));
  await f.event('click','99');assert.equal(f.writes.length,1,'a pending save is not submitted again');
  f.finish();await pending;assert.deepEqual(f.stored(),{amount:12.5,retained:'keep'});assert.ok(f.renders.at(-1).some(node=>node.text==='已保存'));
  assert.equal(f.renders.at(-1).find(node=>node.id==='save').disabled,false);
  const zero=f.event('click','0');f.finish();await zero;assert.deepEqual(f.stored(),{amount:0,retained:'keep'});
});

test('owned prompt example keeps saved state on persistence failure and permits retry',async()=>{
  const f=exampleFixture(),pending=f.event('click','20');f.reject();await pending;
  assert.deepEqual(f.stored(),{amount:5,retained:'keep'});assert.ok(f.renders.at(-1).some(node=>/保存失败/.test(node.text||'')));
  assert.equal(f.renders.at(-1).find(node=>node.id==='save').disabled,false);
  const retry=f.event('click','25');f.finish();await retry;assert.deepEqual(f.stored(),{amount:25,retained:'keep'});
});
