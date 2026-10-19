import test from 'node:test';
import assert from 'node:assert/strict';
import {CUSTOM_BLOCK_KINDS,createCustomBlock,updateCustomBlock,getCustomBlocks,validateCustomBlocks,validateBlockData,mergeCustomBlocks} from '../src/custom-blocks-model.js';
import {applyWorkspaceActions,previewWorkspaceActions,describeWorkspaceAction,undoWorkspaceActions,validateWorkspaceActions,validateWorkspaceActionSnapshot} from '../src/workspace-actions.js';
import {validateBackup,mergeBackup} from '../src/backup.js';
import {ensureCanvas} from '../src/canvas.js';

const now='2026-10-09T10:00:00.000Z';
const state=()=>({schema:1,mode:'personal',profile:{},english:{},courses:[],spaces:[],tasks:[],captures:[],aiRequests:[],updatedAt:now});
const input=(extra={})=>({kind:'miniapp',title:'合成计数器',config:{code:'app.render([{type:"metric",value:app.getData().count||0}]);'},data:{count:3},...extra});
const create=(target,id='one',extra={})=>createCustomBlock(target,input(extra),{id:`block:${id}`,now});
const proposal=(data=input())=>({entity:'customBlock',operation:'create',data});
const options=()=>{let n=0;return {uid:()=>`test-${++n}`,now};};
const backup=target=>({format:'lumi-backup',version:1,exportedAt:now,state:target,files:[]});

test('custom-block previews and descriptions use all seven Chinese kind names without changing calendar terminology',()=>{
  const names={note:'便签',checklist:'清单',links:'网址收藏',progress:'进度',countdown:'重要日期',table:'记录表',miniapp:'交互小程序'},target=state(),before=structuredClone(target);
  for(const kind of CUSTOM_BLOCK_KINDS){
    const config=kind.id==='countdown'?{date:'2026-11-01'}:structuredClone(kind.config),action=proposal(input({kind:kind.id,config}));
    const preview=previewWorkspaceActions(target,[action])[0],description=describeWorkspaceAction(action);
    assert.equal(preview.fields.find(field=>field.label==='方块类型').after,names[kind.id]);assert.equal(description.fields.find(field=>field.label==='方块类型').after,names[kind.id]);
  }
  const calendarAction={entity:'calendarEvent',operation:'create',data:{title:'合成提醒',kind:'note',startDate:'2026-11-01'}};
  assert.equal(previewWorkspaceActions(target,[calendarAction])[0].fields.find(field=>field.label==='日历类型').after,'注意事项');
  assert.equal(describeWorkspaceAction(calendarAction).fields.find(field=>field.label==='安排类型').after,'注意事项');assert.deepEqual(target,before);
});

test('review configuration text retains every checklist, link, progress, date, table and note value',()=>{
  const fixtures=[
    ['note',{text:'第一行\n第二行'},['正文：\n第一行\n第二行']],
    ['checklist',{items:[{id:'todo-1',label:'核对材料',done:false},{id:'todo-2',label:'复查',done:true}]},['todo-1','核对材料','未完成','todo-2','复查','已完成']],
    ['links',{items:[{id:'link-1',label:'官方页面',url:'https://example.org/path?a=1&b=2'}]},['link-1','官方页面','https://example.org/path?a=1&b=2']],
    ['progress',{value:12.5,target:40,unit:'页'},['当前值：12.5','目标值：40','单位：页']],
    ['countdown',{date:'2026-11-01'},['日期：2026-11-01']],
    ['table',{columns:[{id:'name',label:'名称'},{id:'memo',label:'备注'}],rows:[{id:'row-1',cells:['调研','含换行\n的备注']},{id:'row-2',cells:['复核','']}]},['name','名称','memo','备注','row-1','调研','含换行\n的备注','row-2','复核','备注：（空）']],
  ];
  for(const [kind,config,values] of fixtures){
    const action=proposal(input({kind,config})),copy=structuredClone(action);
    for(const review of [previewWorkspaceActions(state(),[action])[0],describeWorkspaceAction(action)]){
      const field=review.fields.find(field=>field.label==='方块配置与内容');assert.ok(field);
      for(const value of values)assert.ok(field.after.includes(value),`${kind} review must include ${value}`);
    }
    assert.deepEqual(action,copy);
  }
});

test('long miniapp code is fully reviewable with original line breaks in create, update and fallback descriptions',()=>{
  const code='// 第一行\nconst value = "含\\n字面转义";\n'+ '// marker\n'.repeat(1200)+'app.render([{type:"text",text:value}]);';
  const action=proposal(input({config:{code}})),preview=previewWorkspaceActions(state(),[action])[0];
  assert.equal(preview.fields.find(field=>field.label==='方块配置与内容').after,`程序代码：\n${code}`);
  assert.equal(describeWorkspaceAction(action).fields.find(field=>field.label==='方块配置与内容').after,`程序代码：\n${code}`);
  const target=state(),record=create(target),updated={entity:'customBlock',operation:'update',id:record.id,data:{config:{code}}},before=structuredClone(target);
  const difference=previewWorkspaceActions(target,[updated])[0].fields.find(field=>field.label==='方块配置与内容');
  assert.equal(difference.before,`程序代码：\n${record.config.code}`);assert.equal(difference.after,`程序代码：\n${code}`);
  assert.equal(describeWorkspaceAction(updated).fields.find(field=>field.label==='方块配置与内容').after,`程序代码：\n${code}`);assert.deepEqual(target,before);
});

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

test('undo of untouched new blocks removes their automatic canvas entries and preserves every other card',async()=>{
  const target=state();ensureCanvas(target);
  target.canvas.cards.push({id:'unrelated-layout',x:3000,y:3000,w:250,h:250,color:'#123456'});
  target.canvas.customized=true;target.canvas.modifiedAt='2026-10-08T10:00:00.000Z';
  const originalCanvas=structuredClone(target.canvas);
  const receipt=applyWorkspaceActions(target,'request',[proposal(input({kind:'note',title:'说明',config:{text:'正文'}})),proposal()],options());
  const ids=target.customBlocks.items.map(block=>block.id);ensureCanvas(target);
  assert.ok(ids.every(id=>target.canvas.cards.some(card=>card.id===id)));
  const reloaded=JSON.parse(JSON.stringify(target));
  assert.deepEqual(await undoWorkspaceActions({state:reloaded,save:()=>{}},receipt,'request'),{removed:2,retained:0});
  assert.deepEqual(reloaded.customBlocks.items,[]);assert.deepEqual(reloaded.canvas,originalCanvas);
  ensureCanvas(reloaded);assert.ok(ids.every(id=>!reloaded.canvas.cards.some(card=>card.id===id)));
});

test('undo removes an untouched earlier block while retaining a later same-batch block with new private data',async()=>{
  const target=state(),receipt=applyWorkspaceActions(target,'request',[proposal(input({kind:'note',title:'未修改便签',config:{text:'原文'}})),proposal()],options());
  ensureCanvas(target);
  const [earlier,later]=target.customBlocks.items.map(block=>block.id);updateCustomBlock(target,later,{data:{count:9}});
  const reloaded=JSON.parse(JSON.stringify(target)),before=structuredClone(reloaded);
  await assert.rejects(undoWorkspaceActions({state:reloaded,save:()=>{throw Error('synthetic save failed');}},receipt,'request'),/synthetic save failed/);
  assert.deepEqual(reloaded,before);
  assert.deepEqual(await undoWorkspaceActions({state:reloaded,save:()=>{}},receipt,'request'),{removed:1,retained:1});
  assert.deepEqual(reloaded.customBlocks.items,[before.customBlocks.items[1]]);
  assert.deepEqual(reloaded.canvas.cards,before.canvas.cards.filter(card=>card.id!==earlier));
  assert.equal(reloaded.customBlocks.items[0].id,later);assert.equal(reloaded.customBlocks.items[0].data.count,9);
});

test('later cards outside the creation batch are not removed from the automatic-layout comparison',async()=>{
  const target=state(),receipt=applyWorkspaceActions(target,'request',[proposal()],options());ensureCanvas(target);
  createCustomBlock(target,input({title:'另一次独立创建'}),{id:'block:later-independent',now:'2026-10-09T10:00:00.000Z'});ensureCanvas(target);
  const before=structuredClone(target);
  assert.deepEqual(await undoWorkspaceActions({state:target,save:()=>{}},receipt,'request'),{removed:0,retained:1});
  assert.deepEqual(target.customBlocks,before.customBlocks);assert.deepEqual(target.canvas,before.canvas);
});

test('later manual or unrecognized canvas placement preserves the new block and all its layout',async()=>{
  const edits=[
    (canvas,card)=>card.x+=40,(canvas,card)=>card.y+=40,(canvas,card)=>card.w+=20,(canvas,card)=>card.h+=20,
    (canvas,card)=>card.color='#123456',(canvas,card)=>card.presentation='grid-2',(canvas,card)=>card.futureLayout=true,
    canvas=>{canvas.customized=true;canvas.modifiedAt='2026-10-09T10:00:01.000Z';},
    canvas=>{canvas.customized=true;delete canvas.modifiedAt;},
    canvas=>{canvas.modifiedAt='unknown';},
    (canvas,card)=>canvas.cards.push(structuredClone(card)),
  ];
  for(const edit of edits){
    const target=state(),receipt=applyWorkspaceActions(target,'request',[proposal()],options());ensureCanvas(target);
    edit(target.canvas,target.canvas.cards.find(card=>card.id===target.customBlocks.items[0].id));
    const before=structuredClone(target);
    assert.deepEqual(await undoWorkspaceActions({state:target,save:()=>{}},receipt,'request'),{removed:0,retained:1});
    assert.deepEqual(target.customBlocks,before.customBlocks);assert.deepEqual(target.canvas,before.canvas);
  }
});

test('new block data edited after creation protects both the record and its automatic canvas entry',async()=>{
  const target=state(),receipt=applyWorkspaceActions(target,'request',[proposal()],options());ensureCanvas(target);
  updateCustomBlock(target,target.customBlocks.items[0].id,{data:{count:4}});const before=structuredClone(target);
  assert.deepEqual(await undoWorkspaceActions({state:target,save:()=>{}},receipt,'request'),{removed:0,retained:1});
  assert.deepEqual(target.customBlocks,before.customBlocks);assert.deepEqual(target.canvas,before.canvas);
});

test('undo before any canvas visit removes the new block without constructing a canvas',async()=>{
  const target=state(),receipt=applyWorkspaceActions(target,'request',[proposal()],options());
  assert.equal(Object.hasOwn(target,'canvas'),false);
  assert.deepEqual(await undoWorkspaceActions({state:target,save:()=>{}},receipt,'request'),{removed:1,retained:0});
  assert.deepEqual(target.customBlocks.items,[]);assert.equal(Object.hasOwn(target,'canvas'),false);
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
  const target=state(),receipt=applyWorkspaceActions(target,'request',[proposal()],options());ensureCanvas(target);const before=structuredClone(target);
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
