import test from 'node:test';
import assert from 'node:assert/strict';
import {PLACEMENT_MIN_SCALE,PLACEMENT_MAX_SCALE,zoomPlacementView,panPlacementView} from '../src/placement-camera.js';
import {placementPoint,placementViewport} from '../src/placement.js';

const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} should equal ${expected}`);
const project=(view,point)=>({x:view.left+(point.x-view.x)*view.scale,y:view.top+(point.y-view.y)*view.scale});
const unproject=(view,point)=>({x:(point.x-view.left)/view.scale+view.x,y:(point.y-view.top)/view.scale+view.y});
const camera=()=>({x:-360,y:120,scale:0.4,left:16,top:32});

test('zoom keeps the world point beneath an off-center pointer fixed at every zoom level',()=>{
  for(const anchor of [{x:17,y:33},{x:453,y:261},{x:-30,y:700}]){
    let view=camera();
    const held=unproject(view,anchor);
    for(const scale of [0.8,1.6,0.001,0.35,0.4]){
      view=zoomPlacementView(view,scale,anchor);
      const screen=project(view,held);
      close(screen.x,anchor.x);close(screen.y,anchor.y);
    }
  }
});

test('panning moves every projected point by the requested screen displacement at any zoom',()=>{
  const delta={x:137.25,y:-94.75};
  for(const scale of [0.001,0.4,1.6]){
    const view={...camera(),scale},moved=panPlacementView(view,delta.x,delta.y);
    for(const point of [{x:0,y:0},{x:1200,y:-840}]){
      const before=project(view,point),after=project(moved,point);
      close(after.x-before.x,delta.x);close(after.y-before.y,delta.y);
    }
    const restored=panPlacementView(moved,-delta.x,-delta.y);
    close(restored.x,view.x);close(restored.y,view.y);
    assert.equal(restored.scale,scale);
  }
});

test('zoom clamps at both limits while retaining the pointer anchor, including an extremely small fit',()=>{
  assert.equal(PLACEMENT_MIN_SCALE,0.001);assert.equal(PLACEMENT_MAX_SCALE,1.6);
  const view={...camera(),scale:PLACEMENT_MIN_SCALE},anchor={x:490,y:300};
  const held=unproject(view,anchor);
  for(const [requested,expected] of [[-4,0.001],[0,0.001],[0.0001,0.001],[100,1.6]]){
    const next=zoomPlacementView(view,requested,anchor),screen=project(next,held);
    assert.equal(next.scale,expected);close(screen.x,anchor.x);close(screen.y,anchor.y);
  }
});

test('zoom then pan still places a grabbed card on the intended 40-unit grid in a scrolled page',()=>{
  const card={x:-240,y:160,w:310,h:272};
  let view=placementViewport([card],900,500);
  view=zoomPlacementView(view,1.2,{x:375,y:212});
  view=panPlacementView(view,-81,119);
  const rect={left:244,top:-173},offset={x:93.5,y:61.25};
  const desired={x:320,y:-280},grab=project(view,{x:desired.x+offset.x,y:desired.y+offset.y});
  assert.deepEqual(placementPoint(view,rect,rect.left+grab.x,rect.top+grab.y,offset),desired);
  assert.deepEqual(placementPoint(view,rect,rect.left+grab.x+11*view.scale,rect.top+grab.y+29*view.scale,offset),{x:320,y:-240});
});

test('camera changes return new values and never mutate frozen input or unrelated metadata',()=>{
  const metadata=Object.freeze({source:'builder'}),view=Object.freeze({...camera(),metadata});
  const anchor=Object.freeze({x:252,y:165}),before={...view};
  for(const next of [zoomPlacementView(view,0.8,anchor),panPlacementView(view,60,-80),zoomPlacementView(view,view.scale,anchor)]){
    assert.notEqual(next,view);assert.equal(next.metadata,metadata);
    assert.equal(next.left,view.left);assert.equal(next.top,view.top);
  }
  assert.deepEqual(view,before);assert.deepEqual(anchor,{x:252,y:165});
});

test('nonfinite, missing and nonnumeric camera inputs are rejected before a result can be stored',()=>{
  for(const bad of [null,undefined,{},[],{...camera(),scale:0},{...camera(),scale:-1}]){
    assert.throws(()=>zoomPlacementView(bad,0.8,{x:10,y:20}),TypeError);
    assert.throws(()=>panPlacementView(bad,10,20),TypeError);
  }
  for(const value of [NaN,Infinity,-Infinity,'1',undefined]){
    for(const key of ['x','y','scale','left','top']){
      assert.throws(()=>zoomPlacementView({...camera(),[key]:value},0.8,{x:10,y:20}),TypeError);
      assert.throws(()=>panPlacementView({...camera(),[key]:value},10,20),TypeError);
    }
    assert.throws(()=>zoomPlacementView(camera(),value,{x:10,y:20}),TypeError);
    assert.throws(()=>zoomPlacementView(camera(),0.8,{x:value,y:20}),TypeError);
    assert.throws(()=>zoomPlacementView(camera(),0.8,{x:10,y:value}),TypeError);
    assert.throws(()=>panPlacementView(camera(),value,20),TypeError);
    assert.throws(()=>panPlacementView(camera(),10,value),TypeError);
  }
  assert.throws(()=>zoomPlacementView(camera(),0.8,null),TypeError);
});

test('finite inputs whose arithmetic would overflow are rejected without mutating the last usable view',()=>{
  const view=Object.freeze({...camera(),scale:0.001}),before={...view};
  assert.throws(()=>panPlacementView(view,Number.MAX_VALUE,0),RangeError);
  assert.throws(()=>zoomPlacementView(view,1.6,{x:Number.MAX_VALUE,y:0}),RangeError);
  assert.deepEqual(view,before);
});
