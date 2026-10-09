import test from 'node:test';
import assert from 'node:assert/strict';
import {createCustomBlock,getCustomBlocks,updateCustomBlock} from '../src/custom-blocks-model.js';
import {saveCustomBlockChange,createBlockDataWriter,customBlockSummary,createCustomBlockOnWorkbench,mountCustomBlockPage} from '../src/custom-blocks.js';
import {ensureCanvas,visibleCanvasCards} from '../src/canvas.js';
import {createWorkbench} from '../src/workbench-model.js';

function fixture(){
  const state={spaces:[],workbench:createWorkbench('blank'),updatedAt:'before'};
  const block=createCustomBlock(state,{kind:'miniapp',title:'计数器',config:{code:'app.render([]);'},data:{count:0}},{id:'block:counter'});
  ensureCanvas(state);let saves=0;
  const ctx={state,save(){saves++;state.updatedAt='saved';},ensureCustomBlockLayout:()=>ensureCanvas(state),isCurrent:()=>true};
  return {state,block,ctx,saves:()=>saves};
}

test('custom block transaction restores content, geometry and stamp on save failure',()=>{
  const {ctx,state,block}=fixture(),before=structuredClone(state),mountedCanvas=state.canvas;
  ctx.save=()=>{state.updatedAt='failed';throw new Error('quota');};
  assert.throws(()=>saveCustomBlockChange(ctx,workspace=>updateCustomBlock(workspace,block.id,{color:'#63E6DC',config:{code:'app.render([{type:"text",text:"changed"}]);'}})),/quota/);
  assert.deepEqual(state,before);assert.equal(state.canvas,mountedCanvas);
});

test('creation initializes real canvas position and save failure removes both new domains',()=>{
  const state={updatedAt:'old'},ctx={state,ensureCustomBlockLayout:()=>ensureCanvas(state),save(){throw new Error('conflict');}};
  assert.throws(()=>saveCustomBlockChange(ctx,workspace=>createCustomBlock(workspace,{kind:'note',title:'记录'})),/conflict/);
  assert.equal(Object.hasOwn(state,'customBlocks'),false);assert.equal(Object.hasOwn(state,'canvas'),false);assert.equal(state.updatedAt,'old');
});

test('success synchronizes the block color with its real canvas geometry',()=>{
  const {ctx,state,block,saves}=fixture();saveCustomBlockChange(ctx,workspace=>updateCustomBlock(workspace,block.id,{color:'#63E6DC'}));
  assert.equal(state.canvas.cards.find(card=>card.id===block.id).color,'#63E6DC');assert.equal(saves(),1);
});

test('running block accepts consecutive own writes without remount or config changes',()=>{
  const {ctx,state,block,saves}=fixture(),config=structuredClone(block.config),writer=createBlockDataWriter(ctx,block.id);
  writer({count:1});writer({count:2});assert.equal(saves(),2);
  const latest=getCustomBlocks(state).items[0];assert.deepEqual(latest.data,{count:2});assert.deepEqual(latest.config,config);
});

test('a failed runtime save rolls back and leaves the writer baseline retryable',()=>{
  const {ctx,state,block}=fixture(),writer=createBlockDataWriter(ctx,block.id);let fail=true;
  ctx.save=()=>{if(fail)throw new Error('quota');};assert.throws(()=>writer({count:1}),/quota/);
  assert.deepEqual(getCustomBlocks(state).items[0].data,{count:0});fail=false;writer({count:1});assert.deepEqual(getCustomBlocks(state).items[0].data,{count:1});
});

test('changed source code or external runtime data rejects the obsolete program',()=>{
  for(const patch of [{config:{code:'app.render([{type:"text",text:"new"}]);'}},{data:{count:7}},{archived:true}]){
    const {ctx,state,block,saves}=fixture(),writer=createBlockDataWriter(ctx,block.id);
    updateCustomBlock(state,block.id,patch);const before=structuredClone(state);
    assert.throws(()=>writer({count:1}),/更新/);assert.deepEqual(state,before);assert.equal(saves(),0);
  }
});

test('unmounted programs and a switched workspace cannot write to old state',()=>{
  for(const active of [false,true]){
    const {ctx,state,block,saves}=fixture();ctx.isCurrent=()=>!active;
    const writer=createBlockDataWriter(ctx,block.id,{isActive:()=>active}),before=structuredClone(state);
    assert.throws(()=>writer({count:1}),/结束/);assert.deepEqual(state,before);assert.equal(saves(),0);
  }
});

test('invalid runtime payload and unrelated block updates cannot corrupt program data',()=>{
  const {ctx,state,block,saves}=fixture(),writer=createBlockDataWriter(ctx,block.id);
  assert.throws(()=>writer({count:Infinity}));assert.equal(saves(),0);
  createCustomBlock(state,{kind:'note',title:'别的方块'});writer({count:1});assert.equal(saves(),1);assert.equal(getCustomBlocks(state).items.length,2);
});

test('home canvas uses independent block identities and hides archived blocks without deleting coordinates',()=>{
  const {state,block}=fixture(),card=state.canvas.cards.find(item=>item.id===block.id);Object.assign(card,{x:4000,y:-280,w:512,h:330});
  assert.equal(visibleCanvasCards(state).some(item=>item.id===block.id),true);
  updateCustomBlock(state,block.id,{archived:true});ensureCanvas(state);
  assert.equal(visibleCanvasCards(state).some(item=>item.id===block.id),false);assert.equal(state.canvas.cards.find(item=>item.id===block.id).x,4000);
  updateCustomBlock(state,block.id,{archived:false});assert.equal(visibleCanvasCards(state).find(item=>item.id===block.id).w,512);
});

test('home summaries expose plain text only and do not execute program source',()=>{
  assert.equal(customBlockSummary({kind:'checklist',config:{items:[{done:true},{done:false}]}}),'1 / 2 项已完成');
  assert.equal(customBlockSummary({kind:'progress',config:{value:3,target:10,unit:'页'}}),'3 / 10 页');
  assert.equal(customBlockSummary({kind:'miniapp',config:{code:'throw new Error("must not execute")'}}),'按需运行的小程序，运行数据单独保存。');
});

test('first saved custom block completes onboarding without replacing the chosen layout, and failed creation rolls it all back',()=>{
  for(const template of ['blank','project']){
    const state={spaces:[],workbench:createWorkbench(template),updatedAt:'before'};
    state.workbench.title='自己定义的工作台';state.workbench.onboardingComplete=false;
    const before=structuredClone(state);let reject=true;
    const ctx={state,ensureCustomBlockLayout:()=>ensureCanvas(state),save(){if(reject)throw new Error('quota');}};
    assert.throws(()=>createCustomBlockOnWorkbench(ctx,{kind:'note',title:'第一个方块'}),/quota/);assert.deepEqual(state,before);
    reject=false;const created=createCustomBlockOnWorkbench(ctx,{kind:'note',title:'第一个方块'});
    assert.equal(state.workbench.onboardingComplete,true);assert.equal(state.workbench.title,before.workbench.title);assert.equal(state.workbench.templateId,template);assert.deepEqual(state.workbench.modules,before.workbench.modules);
    assert.equal(state.canvas.cards.some(card=>card.id===created.id),true);assert.equal(getCustomBlocks(state).items.length,1);
  }
});

test('archived miniapp page can open its editor without absent run controls or runtime startup',t=>{
  const previous={window:globalThis.window,document:globalThis.document},events={},messages=[],dialogs=[];
  const kindInput={addEventListener(){}},form={querySelector:()=>kindInput,addEventListener(){}};
  globalThis.window={addEventListener(){},removeEventListener(){}};
  globalThis.document={querySelector:()=>({querySelector:()=>form})};
  t.after(()=>{for(const [key,value] of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});
  const {state,ctx,block}=fixture();updateCustomBlock(state,block.id,{archived:true});const before=structuredClone(state);
  const root={innerHTML:'',querySelector:()=>null,addEventListener:(name,handler)=>events[name]=handler,removeEventListener:(name,handler)=>{if(events[name]===handler)delete events[name];}};
  const cleanup=mountCustomBlockPage({...ctx,root,toast:message=>messages.push(message),modal:dialog=>dialogs.push(dialog)},block.id);
  events.click({target:{closest:()=>({dataset:{cbAction:'edit'}})}});
  assert.equal(dialogs.length,1);assert.equal(dialogs[0].title,'编辑自定义方块');assert.match(dialogs[0].body,/name="cb-visible"/);assert.deepEqual(messages,[]);assert.deepEqual(state,before);
  dialogs[0].onClose();cleanup();
});
