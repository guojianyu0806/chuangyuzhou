import test from 'node:test';
import assert from 'node:assert/strict';
import {CUSTOM_BLOCK_KINDS,createCustomBlock,updateCustomBlock,getCustomBlocks,validateCustomBlocks,validateBlockData,mergeCustomBlocks} from '../src/custom-blocks-model.js';
import {applyWorkspaceActions,previewWorkspaceActions,undoWorkspaceActions,validateWorkspaceActions,validateWorkspaceActionSnapshot} from '../src/workspace-actions.js';
import {validateBackup,mergeBackup} from '../src/backup.js';

const now='2026-10-09T10:00:00.000Z';
const state=()=>({schema:1,mode:'personal',profile:{},english:{},courses:[],spaces:[],tasks:[],captures:[],aiRequests:[],updatedAt:now});
const input=(extra={})=>({kind:'miniapp',title:'合成计数器',config:{code:'app.render([{type:"metric",value:app.getData().count||0}]);'},data:{count:3},...extra});
const create=(target,id='one',extra={})=>createCustomBlock(target,input(extra),{id:`block:${id}`,now});
const proposal=(data=input())=>({entity:'customBlock',operation:'create',data});
const options=()=>{let n=0;return {uid:()=>`test-${++n}`,now};};
const backup=target=>({format:'lumi-backup',version:1,exportedAt:now,state:target,files:[]});

test('legacy reads and type metadata are isolated; all seven valid block kinds round-trip',()=>{
  const target=state(),before=structuredClone(target);assert.deepEqual(getCustomBlocks(target),{version:1,items:[]});assert.deepEqual(target,before);
  assert.throws(()=>CUSTOM_BLOCK_KINDS.find(kind=>kind.id==='checklist').config.items.push({}));
  for(const kind of CUSTOM_BLOCK_KINDS){const config=kind.id==='countdown'?{date:'2026-11-01'}:structuredClone(kind.config);create(target,kind.id,{kind:kind.id,config});}
  assert.equal(target.customBlocks.items.length,7);assert.deepEqual(validateCustomBlocks(target.customBlocks),target.customBlocks);
  const read=getCustomBlocks(target);read.items[0].title='outside mutation';assert.notEqual(read.items[0].title,target.customBlocks.items[0].title);
});

test('config edits preserve private data, kind cannot change and invalid edits are atomic',()=>{
  const target=state(),record=create(target);const old=structuredClone(record.data);updateCustomBlock(target,record.id,{config:{code:'app.render([{type:"text",text:"新版"}]);'}});
  assert.deepEqual(getCustomBlocks(target).items[0].data,old);
  for(const patch of [{kind:'note'},{data:{count:NaN}},{config:{code:'x'.repeat(30001)}},{color:'url(bad)'},{config:{code:'ok',network:true}}]){
    const before=structuredClone(target);assert.throws(()=>updateCustomBlock(target,record.id,patch));assert.deepEqual(target,before);
  }
  const next=updateCustomBlock(target,record.id,{data:{count:4}});assert.equal(next.data.count,4);next.data.count=100;assert.equal(getCustomBlocks(target).items[0].data.count,4);
});

test('strict configurations reject unsafe links, invalid dates, duplicate rows and excessive collections',()=>{
  const cases=[
    {kind:'links',config:{items:[{id:'a',label:'bad',url:'javascript:alert(1)'}]}},
    {kind:'links',config:{items:[{id:'a',label:'bad',url:'https://user:password@example.org/'}]}},
    {kind:'countdown',config:{date:'2026-02-30'}},
    {kind:'progress',config:{value:1,target:0,unit:'项'}},
    {kind:'checklist',config:{items:[{id:'a',label:'one',done:false},{id:'a',label:'two',done:false}]}},
    {kind:'checklist',config:{items:Array.from({length:101},(_,i)=>({id:`r${i}`,label:'row',done:false}))}},
    {kind:'table',config:{columns:[{id:'a',label:'one'}],rows:[{id:'r',cells:[]}]}},
    {kind:'table',config:{columns:Array.from({length:11},(_,i)=>({id:`c${i}`,label:'col'})),rows:[]}},
    {kind:'note',config:{text:'ok',script:'bad'}},
  ];
  for(const extra of cases){const target=state(),before=structuredClone(target);assert.throws(()=>create(target,'bad',extra));assert.deepEqual(target,before);}
  const target=state();create(target,'link',{kind:'links',config:{items:[{id:'a',label:'安全链接',url:'https://example.org/?q=1#anchor'}]}});
  assert.equal(target.customBlocks.items[0].config.items[0].url,'https://example.org/?q=1#anchor');
});

test('JSON data enforces byte, nesting and finite-value boundaries without executing or retaining input references',()=>{
  const valid={text:'中文',nested:{items:[1,true,null]}},copy=validateBlockData(valid);assert.deepEqual(copy,valid);copy.nested.items.push(2);assert.equal(valid.nested.items.length,3);
  const cycle={};cycle.self=cycle;let deep={};for(let n=0;n<11;n++)deep={next:deep};
  for(const bad of [[],null,{value:undefined},{value:Infinity},{value:()=>{}},cycle,deep,{list:new Array(1)},JSON.parse('{"__proto__":{"polluted":true}}'),{text:'中'.repeat(22000)}])assert.throws(()=>validateBlockData(bad));
  assert.equal({}.polluted,undefined);
});

test('block count, reserved ID namespace and duplicate IDs fail before changing the state',()=>{
  const target=state();for(let i=0;i<50;i++)create(target,`b${i}`);const before=structuredClone(target);
  assert.throws(()=>create(target,'overflow'));assert.deepEqual(target,before);
  const fresh=state();assert.throws(()=>createCustomBlock(fresh,input(),{id:'tasks',now}));assert.equal(fresh.customBlocks,undefined);
  create(fresh);const saved=structuredClone(fresh);assert.throws(()=>create(fresh));assert.deepEqual(fresh,saved);
});

test('AI review is read-only, confirmed actions commit the new domain, and later private-data edits prevent destructive undo',async()=>{
  const target=state(),before=structuredClone(target),actions=[proposal()];const review=previewWorkspaceActions(target,actions,{requestId:'request'});
  assert.equal(review[0].after.kind,'miniapp');assert.deepEqual(target,before);
  const receipt=applyWorkspaceActions(target,'request',actions,options());assert.equal(target.customBlocks.items.length,1);assert.ok(target.customBlocks.items[0].id.startsWith('block:'));
  assert.equal(validateWorkspaceActionSnapshot(JSON.parse(receipt.items[0].snapshot)).entity,'customBlock');
  updateCustomBlock(target,target.customBlocks.items[0].id,{data:{count:4}});
  const result=await undoWorkspaceActions({state:target,save:()=>{},uid:()=>crypto.randomUUID()},receipt,'request');
  assert.deepEqual(result,{removed:0,retained:1});assert.equal(target.customBlocks.items[0].data.count,4);
});

test('AI archive, restore and same-kind config updates preserve data and invalid batches never partially commit',async()=>{
  const target=state(),record=create(target);const data=structuredClone(record.data);
  for(const operation of ['archive','restore']){applyWorkspaceActions(target,'request',[{entity:'customBlock',operation,id:record.id,data:{}}],options());assert.equal(target.customBlocks.items[0].archived,operation==='archive');assert.deepEqual(target.customBlocks.items[0].data,data);}
  const receipt=applyWorkspaceActions(target,'request',[{entity:'customBlock',operation:'update',id:record.id,data:{config:{code:'app.render([]);'}}}],options());assert.deepEqual(target.customBlocks.items[0].data,data);
  assert.equal((await undoWorkspaceActions({state:target,save:()=>{},uid:()=>crypto.randomUUID()},receipt,'request')).removed,1);assert.equal(target.customBlocks.items[0].config.code,record.config.code);
  const before=structuredClone(target);assert.throws(()=>applyWorkspaceActions(target,'request',[proposal(),{entity:'customBlock',operation:'update',id:record.id,data:{kind:'note'}}],options()));assert.deepEqual(target,before);
  assert.throws(()=>validateWorkspaceActions([{...proposal(),id:'block:chosen-by-model'}]));
});

test('failed undo persistence restores both the new domain and timestamp',async()=>{
  const target=state(),receipt=applyWorkspaceActions(target,'request',[proposal()],options()),before=structuredClone(target);
  await assert.rejects(undoWorkspaceActions({state:target,uid:()=>crypto.randomUUID(),save:()=>{throw new Error('synthetic failure');}},receipt,'request'),/synthetic/);
  assert.deepEqual(target,before);
});

test('backups preserve code and private data, merge new IDs, and never overwrite current block contents',()=>{
  const current=state(),incoming=state();create(current,'same');create(incoming,'same',{title:'旧备份',data:{count:1}});create(incoming,'other',{kind:'note',config:{text:'新增资料'}});
  const checked=validateBackup(JSON.parse(JSON.stringify(backup(current))));assert.deepEqual(checked.state.customBlocks,current.customBlocks);
  const before=structuredClone(current),result=mergeBackup(current,backup(incoming));assert.equal(result.count,1);assert.equal(result.state.customBlocks.items.length,2);assert.equal(result.state.customBlocks.items[0].title,'合成计数器');assert.equal(result.state.customBlocks.items[0].data.count,3);assert.deepEqual(current,before);
  assert.deepEqual(mergeCustomBlocks(undefined,current.customBlocks),current.customBlocks);
  assert.equal(Object.hasOwn(validateBackup(backup(state())).state,'customBlocks'),false);
  const invalid=structuredClone(backup(current));invalid.state.customBlocks.items[0].config.code='x'.repeat(30001);assert.throws(()=>validateBackup(invalid));
});
