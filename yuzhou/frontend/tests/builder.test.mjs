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

test('the all-module sample entry appears above placement without replacing the existing project example',()=>{
  const f=galleryFixture(),before=structuredClone(f.state),html=builderHTML(f.state);
  assert.ok(html.indexOf('data-wb-action="add-gallery"')<html.indexOf('data-wb-placement-host'));
  assert.match(html,/加入全模块示例/);assert.match(html,/data-wb-action="add-showcase"/);
  assert.doesNotMatch(html,/data-wb-action="gallery-destination"/);
  assert.deepEqual(f.state,before);
});

test('gallery review is non-mutating until confirmation and then replaces the entry with a complete directory',()=>{
  const f=galleryFixture(),before=structuredClone(f.state);mountBuilder(f.ctx);f.click('add-gallery');
  assert.equal(f.ctx.dialog.title,'加入全模块示例');
  assert.match(f.ctx.dialog.body,/课表与课程分别维护/);assert.match(f.ctx.dialog.body,/已有答案和草稿保留/);
  assert.doesNotMatch(f.ctx.dialog.body,/undefined|NaN/);
  assert.deepEqual(f.state,before);assert.deepEqual(f.calls,[]);
  f.ctx.dialog.onSubmit();
  assert.equal(hasShowcaseGallery(f.state),true);assert.deepEqual(f.calls,['save']);
  assert.match(f.root.innerHTML,/data-wb-action="open-gallery"/);
  assert.equal((f.root.innerHTML.match(/data-wb-action="gallery-destination"/g)||[]).length,12);
  assert.deepEqual(f.state.tasks.find(task=>task.id==='kept-task'),before.tasks[0]);
});

test('a stale or unmounted gallery preview cannot append records into a different workbench',()=>{
  for(const reason of ['stale','unmounted']){
    const f=galleryFixture(),before=structuredClone(f.state),cleanup=mountBuilder(f.ctx);f.click('add-gallery');
    if(reason==='stale')f.ctx.isCurrent=()=>false;else cleanup();
    assert.throws(()=>f.ctx.dialog.onSubmit(),/工作台已更新/);
    assert.deepEqual(f.state,before);assert.deepEqual(f.calls,[]);
  }
});

test('gallery confirmation surfaces a save failure and preserves the original state for another attempt',()=>{
  const f=galleryFixture(),before=structuredClone(f.state),tasks=f.state.tasks;
  f.ctx.save=()=>{throw new Error('示例存储冲突');};mountBuilder(f.ctx);f.click('add-gallery');
  assert.throws(()=>f.ctx.dialog.onSubmit(),/示例存储冲突/);
  assert.deepEqual(f.state,before);assert.equal(f.state.tasks,tasks);
  assert.match(f.root.innerHTML,/data-wb-action="add-gallery"/);
  assert.deepEqual(f.messages,[]);
});

test('installed gallery navigation opens real module destinations and AI only prepares an unsent request',()=>{
  const f=galleryFixture();Object.assign(f.state,structuredClone(planShowcaseGallery(f.state,{now:new Date(2026,9,13,12)}).nextState));
  const before=structuredClone(f.state);f.ctx.cloud={request:()=>assert.fail('showcase navigation must not call a model')};
  mountBuilder(f.ctx);
  for(const id of ['courses','english','inbox','tasks','review','ledger','calendar','timetable','competitions','blocks','fitness'])f.click('gallery-destination',id);
  assert.deepEqual(f.calls,[['go','courses',SHOWCASE_GALLERY_COURSE_IDS[0]],['go','english','reading'],['go','inbox'],['go','tasks'],['go','review'],['go','ledger',SHOWCASE_LEDGER_ID],['go','calendar'],['go','timetable'],['go','competitions',SHOWCASE_COMPETITION_ID],['go','block',SHOWCASE_GALLERY_BLOCK_IDS[0]],['go','space',SHOWCASE_GALLERY_FITNESS_ID]]);
  f.click('gallery-destination','ai');assert.equal(f.calls.at(-1)[0],'ask');assert.match(f.calls.at(-1)[1],/审核确认/);
  assert.deepEqual(f.state,before);const callCount=f.calls.length;f.click('gallery-destination','missing');assert.equal(f.calls.length,callCount);
});

test('reopening an installed gallery preserves edited examples instead of installing it again',()=>{
  const f=galleryFixture();Object.assign(f.state,structuredClone(planShowcaseGallery(f.state,{now:new Date(2026,9,13,12)}).nextState));
  f.state.spaces.find(space=>space.id===SHOWCASE_GALLERY_SPACE_ID).title='我修改过的示例导览';
  const before=structuredClone(f.state);mountBuilder(f.ctx);f.click('open-gallery');f.click('add-gallery');
  assert.deepEqual(f.calls,[['go','space',SHOWCASE_GALLERY_SPACE_ID],['go','space',SHOWCASE_GALLERY_SPACE_ID]]);
  assert.deepEqual(f.state,before);assert.equal(f.ctx.dialog,undefined);
});

test('collapsing the gallery directory persists through builder redraws without changing workspace data',()=>{
  const f=galleryFixture();Object.assign(f.state,structuredClone(planShowcaseGallery(f.state,{now:new Date(2026,9,13,12)}).nextState));
  const cleanup=mountBuilder(f.ctx),before=structuredClone(f.state);
  assert.match(f.root.innerHTML,/data-wb-gallery-directory open/);
  f.events.toggle({target:{matches:selector=>selector==='[data-wb-gallery-directory]',open:false}});
  assert.deepEqual(f.state,before);assert.deepEqual(f.calls,[]);
  f.click('rename-workbench');f.ctx.dialog.onSubmit(new Map([['title','保留收起状态']]));
  assert.doesNotMatch(f.root.innerHTML,/data-wb-gallery-directory open/);
  assert.match(f.root.innerHTML,/data-wb-gallery-directory ><summary>/);
  cleanup();assert.equal(f.events.toggle,undefined);
});
