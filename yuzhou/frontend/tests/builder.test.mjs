import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkbench,configureWorkbench,getVisibleModules} from '../src/workbench-model.js';
import {builderHTML,mountBuilder,saveWorkbenchChange,templateChanges} from '../src/builder.js';
import {hasShowcaseGallery,planShowcaseGallery,SHOWCASE_GALLERY_SPACE_ID,SHOWCASE_GALLERY_FITNESS_ID,SHOWCASE_GALLERY_COURSE_IDS,SHOWCASE_GALLERY_BLOCK_IDS} from '../src/showcase-gallery.js';
import {SHOWCASE_LEDGER_ID,SHOWCASE_COMPETITION_ID} from '../src/showcase-examples.js';

function fixture(template='blank') {
  const state={workbench:createWorkbench(template),spaces:[],tasks:[{id:'kept-task',title:'已有资料'}],updatedAt:'before'};
  const events={},messages=[],calls=[];
  const root={innerHTML:'',querySelector:()=>null,addEventListener:(name,fn)=>{events[name]=fn;},removeEventListener:(name,fn)=>{if(events[name]===fn)delete events[name];},contains:()=>true};
  const ctx={state,root,toast:value=>messages.push(value),save:()=>{calls.push('save');state.updatedAt='saved';},modal:value=>{ctx.dialog=value;},go:(...args)=>calls.push(['go',...args]),createSpace:()=>calls.push('new-space'),askAssistant:prompt=>calls.push(['ask',prompt])};
  const click=(action,id)=>{const button={dataset:{wbAction:action,id},disabled:false};events.click?.({target:{closest:()=>button}});};
  return {state,ctx,root,click,messages,calls,events};
}

test('blank builder keeps AI available, offers optional modules and a clear custom-space entry',()=>{
  const {state}=fixture(),html=builderHTML(state);
  assert.match(html,/从空白开始，也很好/);
  assert.match(html,/data-wb-module="ai"/);
  assert.doesNotMatch(html,/data-wb-action="hide" data-id="ai"/);
  assert.equal((html.match(/data-wb-action="add"/g)||[]).length,9);
  assert.match(html,/data-wb-action="new-space"/);
  assert.match(html,/已有资料仍然保留/);
});

test('builder stays in the current workbench even when a legacy example callback is supplied',()=>{
  const f=fixture('full'),before=structuredClone(f.state);
  f.ctx.showExample=()=>assert.fail('the retired example workspace must not be opened');
  const cleanup=mountBuilder(f.ctx);
  assert.doesNotMatch(f.root.innerHTML,/data-wb-action="example"|查看宇宙完整示例/);
  f.click('example');
  assert.deepEqual(f.state,before);assert.deepEqual(f.calls,[]);
  cleanup();
});

test('custom workbench, module and space names are escaped in text and attributes',()=>{
  const {state}=fixture();
  configureWorkbench(state,{title:'<img src=x onerror=alert(1)>'});
  configureWorkbench(state,{moduleId:'tasks',enabled:true,moduleTitle:'"><script>bad()</script>'});
  state.spaces.push({id:'"><svg onload=x>',title:'<iframe src=x>'});
  const html=builderHTML(state);
  for(const tag of ['<img','<script','<iframe','<svg onload'])assert.ok(!html.includes(tag));
  assert.match(html,/&lt;img/);
  assert.match(html,/&lt;script&gt;/);
  assert.match(html,/data-id="&quot;&gt;&lt;svg/);
});

test('template review is read-only until confirmed and preserves existing records and spaces',()=>{
  const f=fixture('full');
  f.state.spaces.push({id:'project',title:'我的项目',archived:false});
  const tasks=f.state.tasks,spaces=f.state.spaces,before=structuredClone(f.state);
  mountBuilder(f.ctx);f.click('template','blank');
  assert.deepEqual(f.state,before);
  assert.deepEqual(f.calls,[]);
  assert.match(f.ctx.dialog.body,/将收起/);
  assert.match(f.ctx.dialog.body,/已有资料、自定义空间及画布位置会保留/);
  f.ctx.dialog.onSubmit();
  assert.deepEqual(getVisibleModules(f.state).map(module=>module.id),['ai']);
  assert.equal(f.state.tasks,tasks);
  assert.equal(f.state.spaces,spaces);
  assert.deepEqual(f.calls,['save']);
});

test('hiding and re-adding a module retains its name and business records',()=>{
  const f=fixture('full');
  configureWorkbench(f.state,{moduleId:'tasks',moduleTitle:'项目行动'});
  const tasks=f.state.tasks;
  mountBuilder(f.ctx);f.click('hide','tasks');
  assert.equal(getVisibleModules(f.state).some(module=>module.id==='tasks'),false);
  f.click('add','tasks');
  assert.equal(getVisibleModules(f.state).find(module=>module.id==='tasks').title,'项目行动');
  assert.equal(f.state.tasks,tasks);
  assert.equal(tasks.length,1);
});

test('moving one visible module crosses hidden positions without enabling hidden modules',()=>{
  const f=fixture();
  configureWorkbench(f.state,{moduleId:'tasks',enabled:true});
  configureWorkbench(f.state,{moduleId:'calendar',enabled:true});
  mountBuilder(f.ctx);f.click('up','calendar');
  assert.deepEqual(getVisibleModules(f.state).map(module=>module.id),['ai','calendar','tasks']);
  f.click('down','calendar');
  assert.deepEqual(getVisibleModules(f.state).map(module=>module.id),['ai','tasks','calendar']);
  assert.equal(f.state.workbench.modules.filter(module=>!module.enabled).length,7);
});

test('failed persistence restores the prior configuration and timestamp without losing data',()=>{
  const f=fixture('full'),before=structuredClone(f.state);
  f.ctx.save=()=>{f.state.updatedAt='failed-save';throw new Error('合成存储冲突');};
  mountBuilder(f.ctx);f.click('hide','tasks');
  assert.deepEqual(f.state,before);
  assert.deepEqual(f.messages,['合成存储冲突']);
  const legacy={tasks:[{title:'keep'}]};
  assert.throws(()=>saveWorkbenchChange({state:legacy,save:()=>{legacy.updatedAt='bad';throw new Error('fail');}},workspace=>configureWorkbench(workspace,{title:'new'})),/fail/);
  assert.deepEqual(legacy,{tasks:[{title:'keep'}]});
});

test('renaming through the dialog saves the module title without changing its content',()=>{
  const f=fixture('full');mountBuilder(f.ctx);f.click('rename-module','tasks');
  assert.match(f.ctx.dialog.body,/模块内容保持原样/);
  assert.equal(f.ctx.dialog.onSubmit(new Map([['title','   ']])),false);
  assert.deepEqual(f.calls,[]);
  f.ctx.dialog.onSubmit(new Map([['title','今日行动']]));
  assert.equal(getVisibleModules(f.state).find(module=>module.id==='tasks').title,'今日行动');
  assert.deepEqual(f.state.tasks,[{id:'kept-task',title:'已有资料'}]);
});

test('assistant entry only prepares the conversation and unmounted views ignore actions',()=>{
  const f=fixture(),before=structuredClone(f.state),cleanup=mountBuilder(f.ctx);
  f.ctx.cloud={request:()=>assert.fail('builder must not call a model')};
  f.click('ask-ai');
  assert.equal(f.calls[0][0],'ask');
  assert.match(f.calls[0][1],/先了解我的使用场景/);
  assert.deepEqual(f.state,before);
  cleanup();f.click('add','tasks');
  assert.deepEqual(f.state,before);
});

test('template impact uses current custom labels and rejects unknown templates',()=>{
  const {state}=fixture('full');
  configureWorkbench(state,{moduleId:'courses',moduleTitle:'论文资料'});
  const before=structuredClone(state),review=templateChanges(state,'life');
  assert.ok(review.hidden.includes('论文资料'));
  assert.ok(!review.hidden.includes('课程空间'));
  assert.deepEqual(state,before);
  assert.throws(()=>templateChanges(state,'unknown'),/模板已不存在/);
});

test('choosing the blank canvas completes onboarding without enabling optional modules',()=>{
  const f=fixture();mountBuilder(f.ctx);f.click('home');
  assert.equal(f.state.workbench.onboardingComplete,true);
  assert.deepEqual(getVisibleModules(f.state).map(module=>module.id),['ai']);
  assert.deepEqual(f.calls,['save',['go','home','layout']]);
});

function galleryFixture(){
  const f=fixture();
  Object.assign(f.state,{schema:1,mode:'personal',profile:{name:'合成示例测试'},courses:[],captures:[],english:{}});
  return f;
}

test('daily builder exposes no sample import controls and preserves optional modules',()=>{
  const f=galleryFixture(),before=structuredClone(f.state),html=builderHTML(f.state);
  assert.doesNotMatch(html,/data-wb-action="(?:add-gallery|add-showcase|open-gallery)"|演示路线|全模块示例/);
  assert.match(html,/data-wb-action="daily-review"/);assert.match(html,/data-wb-placement-host/);
  assert.deepEqual(f.state,before);
});

test('daily review remains non-mutating until save and can undo in the same mount',()=>{
  const f=galleryFixture();Object.assign(f.state,structuredClone(planShowcaseGallery(f.state).nextState));
  const before=structuredClone(f.state);mountBuilder(f.ctx);f.click('daily-review');
  assert.equal(f.ctx.dialog.title,'整理为日常工作台');assert.deepEqual(f.state,before);
  f.ctx.dialog.onSubmit();assert.equal(f.state.spaces.find(x=>x.id===SHOWCASE_GALLERY_SPACE_ID).title,'工作台使用手册');
  f.click('daily-undo');assert.deepEqual({...f.state,updatedAt:before.updatedAt},before);
  assert.deepEqual(f.calls,['save','save']);
});

test('stale and unmounted daily previews refuse to save',()=>{
  for(const reason of ['stale','unmounted']){
    const f=galleryFixture();Object.assign(f.state,structuredClone(planShowcaseGallery(f.state).nextState));
    const before=structuredClone(f.state),cleanup=mountBuilder(f.ctx);f.click('daily-review');
    if(reason==='stale')f.ctx.isCurrent=()=>false;else cleanup();
    assert.throws(()=>f.ctx.dialog.onSubmit(),/工作台已更新/);assert.deepEqual(f.state,before);assert.deepEqual(f.calls,[]);
  }
});

test('daily save failure preserves source records and reports the actual error',()=>{
  const f=galleryFixture();Object.assign(f.state,structuredClone(planShowcaseGallery(f.state).nextState));
  const before=structuredClone(f.state);f.ctx.save=()=>{throw Error('保存失败');};
  mountBuilder(f.ctx);f.click('daily-review');assert.throws(()=>f.ctx.dialog.onSubmit(),/保存失败/);assert.deepEqual(f.state,before);
});

test('ordinary workspace has no conversion to save and obsolete import actions do nothing',()=>{
  const f=galleryFixture(),before=structuredClone(f.state);mountBuilder(f.ctx);f.click('daily-review');
  assert.equal(f.ctx.dialog.onSubmit,undefined);
  f.click('add-gallery');f.click('add-showcase');assert.deepEqual(f.state,before);assert.deepEqual(f.calls,[]);
});
