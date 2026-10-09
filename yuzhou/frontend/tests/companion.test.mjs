import test from 'node:test';
import assert from 'node:assert/strict';
import {openCompanion} from '../src/companion.js';
import {openAIConversation} from '../src/ai.js';
import {createWorkbench} from '../src/workbench-model.js';
import {escapeHTML} from '../src/services.js';

function fixture(t,{existingDraft='',saveError=false}={}){
  const previousDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
  t.after(()=>{if(previousDocument)Object.defineProperty(globalThis,'document',previousDocument);else delete globalThis.document;});
  const input={value:'帮我搭建研究资料空间'},links=[{},{}];
  const host={querySelectorAll:()=>[],querySelector:selector=>selector==='[data-companion-chat]'?links[0]:links[1]};
  globalThis.document={querySelector:()=>host};
  const calls=[],state={mode:'personal',workbench:createWorkbench(),aiDraft:{text:existingDraft,files:[],targetId:'workspace'},updatedAt:'before'};
  let dialog,open=false;
  const ctx={state,esc:escapeHTML,modal:options=>{dialog=options;open=true;},closeModal:()=>{calls.push('close');open=false;input.value='';},go:(...args)=>calls.push(['go',...args]),toast:message=>calls.push(['toast',message]),save:()=>{calls.push('save');if(saveError){state.updatedAt='failed';throw new Error('合成保存失败');}}};
  ctx.askAssistant=text=>openAIConversation(ctx,{text,targetId:'workspace'});
  openCompanion(ctx);
  return {state,calls,input,isOpen:()=>open,submit:()=>dialog.onSubmit(new Map([['intent',input.value]]))};
}

test('companion closes only after its input has become a saved, unsent AI draft',async t=>{
  const f=fixture(t),text=f.input.value;
  assert.equal(await f.submit(),true);
  assert.equal(f.state.aiDraft.text,text);
  assert.equal(f.state.aiDraft.targetId,'workspace');
  assert.equal(f.isOpen(),false);
  assert.deepEqual(f.calls,['save',['go','ai','workspace'],'close']);
});

test('an existing AI draft leaves the companion dialog and new input intact',async t=>{
  const f=fixture(t,{existingDraft:'原来还没发送的草稿'}),oldDraft=f.state.aiDraft,newText=f.input.value;
  assert.equal(await f.submit(),false);
  assert.equal(f.state.aiDraft,oldDraft);
  assert.equal(f.state.aiDraft.text,'原来还没发送的草稿');
  assert.equal(f.input.value,newText);
  assert.equal(f.isOpen(),true);
  assert.ok(!f.calls.includes('close'));
  assert.ok(!f.calls.includes('save'));
});

test('a save exception restores the AI draft and preserves companion input for retry',async t=>{
  const f=fixture(t,{saveError:true}),oldDraft=f.state.aiDraft,newText=f.input.value;
  await assert.rejects(f.submit(),/合成保存失败/);
  assert.equal(f.state.aiDraft,oldDraft);
  assert.equal(f.state.updatedAt,'before');
  assert.equal(f.input.value,newText);
  assert.equal(f.isOpen(),true);
  assert.deepEqual(f.calls,['save']);
});

test('empty companion input neither opens a conversation nor closes the dialog',async t=>{
  const f=fixture(t);f.input.value='   ';
  assert.equal(await f.submit(),false);
  assert.equal(f.isOpen(),true);
  assert.deepEqual(f.calls,[]);
});
