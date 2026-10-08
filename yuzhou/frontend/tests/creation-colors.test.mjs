import test from 'node:test';
import assert from 'node:assert/strict';
import {CREATION_COLORS, isRecordColor, previewRecordColor, assignRecordColor, createColorDraft} from '../src/creation-colors.js';

test('automatic creations use safe bright colors and never repeat the previous creation', t => {
  const state={ui:{lastCreatedColor:CREATION_COLORS[0].toLowerCase()}};
  t.mock.method(Math,'random',()=>0);
  for(let i=0;i<80;i++){
    const previous=state.ui.lastCreatedColor.toLowerCase();
    const color=assignRecordColor(state);
    assert.ok(CREATION_COLORS.includes(color));
    assert.notEqual(color.toLowerCase(),previous);
    assert.equal(state.ui.lastCreatedColor,color);
  }
  assert.equal(isRecordColor('red;background:url(x)'),false);
  assert.equal(isRecordColor('#a1B2c3'),true);
  assert.equal(isRecordColor('#fff'),false);
});

test('manual colors are preserved even when repeated and the next automatic choice excludes them',()=>{
  const state={};
  const manual=CREATION_COLORS[2].toLowerCase();
  assert.equal(assignRecordColor(state,manual),manual);
  assert.equal(assignRecordColor(state,manual),manual);
  assert.notEqual(assignRecordColor(state).toLowerCase(),manual);
  assert.equal(assignRecordColor(state,'#123456'),'#123456');
});

test('opening, previewing, and cancelling a draft never advances the shared cursor',()=>{
  const state={ui:{sidebarPinned:true,lastCreatedColor:'#AE88FF'}};
  const before=structuredClone(state);
  for(let i=0;i<20;i++){
    assert.ok(isRecordColor(previewRecordColor(state)));
    const draft=createColorDraft(state);
    const unbind=draft.bind(new EventTarget());unbind();
  }
  assert.deepEqual(state,before);
  const untouched={};createColorDraft(untouched);assert.deepEqual(untouched,{});
});

test('draft keeps its visible preview unless another creation has used that exact color',t=>{
  t.mock.method(Math,'random',()=>0);
  const state={ui:{lastCreatedColor:CREATION_COLORS[0]}};
  const first=createColorDraft(state),second=createColorDraft(state);
  assert.equal(first.color,second.color);
  assert.equal(first.commit('#123456'),first.color,'unselected form defaults are not manual choices');
  const next=second.commit(second.color);
  assert.notEqual(next.toLowerCase(),first.color.toLowerCase());
  assert.equal(state.ui.lastCreatedColor,next);
});

test('a deliberate input/change choice wins over random preview and can match the last color',()=>{
  for(const eventName of ['input','change']){
    const state={ui:{lastCreatedColor:'#112233'}};
    const form=new EventTarget(),draft=createColorDraft(state);
    draft.bind(form);
    const event=new Event(eventName);
    Object.defineProperty(event,'target',{value:{matches:selector=>selector==='[name="color"]'}});
    form.dispatchEvent(event);
    assert.equal(draft.commit('#112233'),'#112233');
    assert.equal(state.ui.lastCreatedColor,'#112233');
  }
});

test('unrelated input changes do not turn the automatic preview into a manual color',()=>{
  const state={},draft=createColorDraft(state),form=new EventTarget();draft.bind(form);
  const event=new Event('input');Object.defineProperty(event,'target',{value:{matches:()=>false}});form.dispatchEvent(event);
  assert.equal(draft.commit('#112233'),draft.color);
});

test('restored manual form colors remain deliberate choices without input/change events',()=>{
  const state={ui:{lastCreatedColor:'#112233'}},draft=createColorDraft(state),form=new EventTarget();
  form.querySelector=selector=>selector==='[name="color"]'?{value:'#112233'}:null;
  draft.bind(form);
  assert.equal(draft.commit('#112233'),'#112233','restored manual choices may repeat the last color');
});

test('browser-normalized lowercase preview does not become a manual choice when binding',t=>{
  t.mock.method(Math,'random',()=>0);
  const state={},draft=createColorDraft(state),form=new EventTarget();
  form.querySelector=()=>({value:draft.color.toLowerCase()});draft.bind(form);
  assignRecordColor(state,draft.color);
  assert.notEqual(draft.commit(draft.color.toLowerCase()).toLowerCase(),draft.color.toLowerCase(),'automatic preview still redraws when another creation takes its color');
});
