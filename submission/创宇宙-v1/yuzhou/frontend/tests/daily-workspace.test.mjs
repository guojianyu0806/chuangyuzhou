import test from 'node:test';
import assert from 'node:assert/strict';
import {planShowcaseGallery} from '../src/showcase-gallery.js';
import {planDailyWorkspace,applyDailyWorkspace} from '../src/daily-workspace.js';
import {projectCalendarLinks} from '../src/calendar-links.js';
const now=new Date('2026-10-16T06:00:00Z');
function fixture(){return structuredClone(planShowcaseGallery({schema:1,mode:'personal',profile:{name:'Synthetic'},courses:[],spaces:[],tasks:[],captures:[],english:{},updatedAt:now.toISOString()},{now}).nextState);}
test('conversion is detached, preserves geometry, IDs, provenance and note revisions',()=>{
  const state=fixture(),before=structuredClone(state),plan=planDailyWorkspace(state,{now});
  assert.deepEqual(state,before);assert.ok(plan.changes.length>30);assert.deepEqual(plan.nextState.canvas,state.canvas);
  assert.deepEqual(plan.nextState.workbench,state.workbench);
  assert.deepEqual(plan.nextState.tasks.map(x=>[x.id,x.spaceId,x.captureId,x.date]),state.tasks.map(x=>[x.id,x.spaceId,x.captureId,x.date]));
  const note=plan.nextState.spaces[0].notes[0],old=state.spaces[0].notes[0];
  assert.equal(note.revisions.at(-1).content,old.content);assert.equal(note.example,true);assert.match(note.source,/平台起始资料/);
  assert.deepEqual(planDailyWorkspace(plan.nextState,{now}).changes,[]);
});
test('synthetic activity is archived, never promoted to actual history; untouched personal records survive',()=>{
  const state=fixture();state.tasks.push({...state.tasks[0],id:'real-task',title:'真实事项',example:false});
  state.fitness.entries.push({...state.fitness.entries[0],id:'real-activity',activity:'散步',note:'实际记录'});
  const next=planDailyWorkspace(state,{now}).nextState;
  assert.ok(next.ledger.entries.every(x=>x.archived));assert.ok(next.fitness.entries.filter(x=>x.id!=='real-activity').every(x=>x.archived));
  assert.equal(next.tasks.find(x=>x.id==='showcase-dev019-review-task').archived,true);
  assert.deepEqual(next.tasks.find(x=>x.id==='real-task'),state.tasks.at(-1));assert.deepEqual(next.fitness.entries.at(-1),state.fitness.entries.at(-1));
  assert.equal(next.customBlocks.items.find(x=>x.kind==='progress').config.value,0);
  assert.equal(projectCalendarLinks(next).filter(x=>x.source==='tasks'&&!x.archived).length,projectCalendarLinks(state).filter(x=>x.source==='tasks'&&!x.archived&&x.sourceId!=='showcase-dev019-review-task').length);
});
test('conversion saves once, rolls back failures, rejects stale previews and preserves later edits on undo',()=>{
  const state=fixture(),before=structuredClone(state),plan=planDailyWorkspace(state,{now});let saves=0;
  assert.throws(()=>applyDailyWorkspace({state,save(){throw Error('disk full');}},plan),/disk full/);assert.deepEqual(state,before);
  const ctx={state,save(){saves++;state.updatedAt=now.toISOString();}};
  const undo=applyDailyWorkspace(ctx,plan);assert.equal(saves,1);undo();assert.equal(saves,2);assert.deepEqual(state,before);
  const undo2=applyDailyWorkspace(ctx,plan);state.tasks[0].title='后来编辑';assert.throws(undo2,/已有新修改/);assert.equal(state.tasks[0].title,'后来编辑');
  assert.throws(()=>applyDailyWorkspace(ctx,plan),/内容已变化/);
});
