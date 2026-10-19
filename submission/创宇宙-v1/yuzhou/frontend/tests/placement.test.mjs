import test from 'node:test';
import assert from 'node:assert/strict';
import {placementHTML,placementViewport,placementPoint} from '../src/placement.js';
import {placementCards} from '../src/placement-model.js';
import {createWorkbench,configureWorkbench} from '../src/workbench-model.js';
import {workspaceFingerprint} from '../../backend/workspace-queries.mjs';

// Project a saved card anchor into a scrolled page, independently of pointer interpretation.
const screen=(view,rect,world)=>({x:rect.left+view.left+(world.x-view.x)*view.scale,y:rect.top+view.top+(world.y-view.y)*view.scale});
function tags(html) {
  return [...html.matchAll(/<([a-z][\w-]*)(\s[^<>]*?)?>/gi)].map(match=>{
    const attributes={};
    for(const attribute of (match[2]||'').matchAll(/([:\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g))attributes[attribute[1]]=attribute[2]??attribute[3]??attribute[4]??'';
    return {name:match[1].toLowerCase(),attributes};
  });
}

test('canvas fitting and pointer conversion round-trip positive and negative saved coordinates across viewport sizes',()=>{
  const cards=[{id:'first',x:-640,y:-360,w:540,h:380},{id:'second',x:1440,y:1200,w:310,h:272}];
  const rect={left:173,top:-240};
  for(const [width,height] of [[960,620],[350,510],[1800,900]]){
    const view=placementViewport(cards,width,height);
    assert.ok(Number.isFinite(view.scale)&&view.scale>0);
    for(const card of cards){
      const anchor=screen(view,rect,card),end=screen(view,rect,{x:card.x+card.w,y:card.y+card.h});
      assert.ok(anchor.x>=rect.left&&end.x<=rect.left+width);
      assert.ok(anchor.y>=rect.top&&end.y<=rect.top+height);
      assert.deepEqual(placementPoint(view,rect,anchor.x,anchor.y),{x:card.x,y:card.y});
    }
  }
});

test('drag grab offsets avoid jumps and screen movement produces the intended world-grid movement',()=>{
  const card={id:'task',x:-240,y:160,w:310,h:272},rect={left:91,top:325};
  const offset={x:93.5,y:61.25},view=placementViewport([card],750,550);
  const grabbed=screen(view,rect,{x:card.x+offset.x,y:card.y+offset.y});
  assert.deepEqual(placementPoint(view,rect,grabbed.x,grabbed.y,offset),{x:-240,y:160});
  assert.deepEqual(placementPoint(view,rect,grabbed.x+80*view.scale,grabbed.y-120*view.scale,offset),{x:-160,y:40});
  assert.deepEqual(placementPoint(view,rect,grabbed.x+11*view.scale,grabbed.y+29*view.scale,offset),{x:-240,y:200});
});

test('click placement centers differently sized cards on the chosen location before grid snapping',()=>{
  const view=placementViewport([],740,520),rect={left:88,top:220};
  for(const card of [{w:310,h:272},{w:540,h:380}]){
    const desired={x:320,y:240};
    const center=screen(view,rect,{x:desired.x+card.w/2,y:desired.y+card.h/2});
    assert.deepEqual(placementPoint(view,rect,center.x,center.y,{x:card.w/2,y:card.h/2}),desired);
  }
});

test('opening or fitting the visual builder neither creates saved geometry nor invalidates pending AI context',()=>{
  const state={workbench:createWorkbench('blank'),spaces:[{id:'space-one',title:'项目空间'}],tasks:[{id:'kept-task',title:'已有事项'}]};
  const before=structuredClone(state),fingerprint=workspaceFingerprint(state);
  placementHTML(state);
  for(const [width,height] of [[1000,620],[390,844]])placementViewport(placementCards(state),width,height);
  assert.deepEqual(state,before);assert.equal(workspaceFingerprint(state),fingerprint);
});

test('user-controlled names cannot introduce elements or executable attributes into palette buttons',()=>{
  const state={workbench:createWorkbench('blank'),spaces:[]};
  const name='\"><img src=x onerror=alert(1)>';
  configureWorkbench(state,{moduleId:'tasks',moduleTitle:name});
  const html=placementHTML(state),elements=tags(html);
  assert.ok(!elements.some(element=>['img','script','iframe'].includes(element.name)));
  assert.ok(elements.every(element=>Object.keys(element.attributes).every(attribute=>!/^on/i.test(attribute))));
  const button=elements.find(element=>element.attributes['data-place-source']==='tasks');
  assert.equal(button.name,'button');assert.ok(button.attributes['aria-label'].includes('&lt;img'));
  assert.ok(html.includes('&quot;&gt;&lt;img'));
});

test('keyboard placement guidance is attached to a focusable stage and status updates are announced',()=>{
  const elements=tags(placementHTML({workbench:createWorkbench('blank'),spaces:[]}));
  const stage=elements.find(element=>element.attributes.class==='wb-placement-stage');
  assert.equal(stage.attributes.tabindex,'0');
  const helpId=stage.attributes['aria-describedby'];
  assert.ok(helpId&&elements.some(element=>element.attributes.id===helpId));
  assert.ok(elements.some(element=>element.attributes.role==='status'&&element.attributes['aria-live']==='polite'));
  for(const action of ['left','right','up','down']){
    const button=elements.find(element=>element.attributes['data-place-action']===action);
    assert.equal(button.name,'button');assert.ok(button.attributes['aria-label']);assert.ok(Object.hasOwn(button.attributes,'disabled'));
  }
});

test('the initial palette exposes draggable modules while scenes offer drag-to-create without a second click handler',()=>{
  const elements=tags(placementHTML({workbench:createWorkbench('blank'),spaces:[]}));
  const tab=elements.find(element=>element.attributes['data-palette-tab']==='builtin');
  assert.equal(tab.attributes['aria-pressed'],'true');
  const modules=elements.filter(element=>element.attributes['data-palette-group']==='builtin');
  assert.equal(modules.length,10);assert.ok(modules.every(element=>element.attributes['data-place-source']&&!Object.hasOwn(element.attributes,'hidden')));
  const scenes=elements.filter(element=>element.attributes['data-palette-group']==='scene');
  assert.equal(scenes.length,14);assert.ok(scenes.every(element=>element.attributes['data-place-preset']&&Object.hasOwn(element.attributes,'hidden')));
  assert.ok(scenes.every(element=>!Object.hasOwn(element.attributes,'data-wb-action')),'a drag release must not bubble into a second creation handler');
});
