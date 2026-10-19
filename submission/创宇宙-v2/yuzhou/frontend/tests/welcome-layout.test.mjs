import test from 'node:test';
import assert from 'node:assert/strict';
import {getWelcomeLayouts,interpolateWelcomeLayout} from '../src/welcome-layout.js';

const keys=['x','y','w','h','angle'];
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
function corners(item){
  const angle=item.angle*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),cx=item.x+item.w/2,cy=item.y+item.h/2;
  return [[-1,-1],[1,-1],[-1,1],[1,1]].map(([x,y])=>({x:cx+x*item.w/2*c-y*item.h/2*s,y:cy+x*item.w/2*s+y*item.h/2*c}));
}
function inside(point,item){
  const angle=-item.angle*Math.PI/180,x=point.x-item.x-item.w/2,y=point.y-item.y-item.h/2;
  return Math.abs(x*Math.cos(angle)-y*Math.sin(angle))<item.w/2-.001&&Math.abs(x*Math.sin(angle)+y*Math.cos(angle))<item.h/2-.001;
}
const center=item=>({x:item.x+item.w/2,y:item.y+item.h/2});
const box=item=>{const points=corners(item),xs=points.map(p=>p.x),ys=points.map(p=>p.y);return {left:Math.min(...xs),right:Math.max(...xs),top:Math.min(...ys),bottom:Math.max(...ys)};};
const apart=(a,b)=>a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top;

test('layout endpoints preserve count and ordering, deterministic output and immutable input',()=>{
  for(const width of [320,390,600,601,800,1099,1100,1280,1800])for(const count of [0,1,2,7,20]){
    const input=freeze({width,height:660,count,centerHeight:300}),first=getWelcomeLayouts(input),second=getWelcomeLayouts(input);
    assert.deepEqual(first,second);assert.equal(first.grid.cards.length,count);assert.equal(first.scatter.cards.length,count);
    assert.equal(first.height>=660,true);
    assert.deepEqual(input,{width,height:660,count,centerHeight:300});
  }
});

test('zero and one select exact endpoints and a midpoint linearly interpolates every geometry field',()=>{
  const layouts=freeze(getWelcomeLayouts({width:1280,height:660,count:20}));
  assert.deepEqual(interpolateWelcomeLayout(layouts,0),{height:layouts.height,...layouts.scatter});
  assert.deepEqual(interpolateWelcomeLayout(layouts,1),{height:layouts.height,...layouts.grid});
  for(const t of [.125,.5,.875]){
    const blended=interpolateWelcomeLayout(layouts,t);
    for(const key of keys)near(blended.center[key],layouts.scatter.center[key]+(layouts.grid.center[key]-layouts.scatter.center[key])*t);
    for(let index=0;index<20;index++)for(const key of keys)near(blended.cards[index][key],layouts.scatter.cards[index][key]+(layouts.grid.cards[index][key]-layouts.scatter.cards[index][key])*t);
  }
  const result=interpolateWelcomeLayout(layouts,.5);result.cards[0].x=999999;
  assert.notEqual(layouts.scatter.cards[0].x,999999);
});

test('desktop grid has six columns and four rows around a central two-by-two card',()=>{
  const {grid}=getWelcomeLayouts({width:1280,height:660,count:20,centerHeight:300});
  const xs=[...new Set(grid.cards.map(card=>card.x))].sort((a,b)=>a-b),ys=[...new Set(grid.cards.map(card=>card.y))].sort((a,b)=>a-b);
  assert.equal(xs.length,6);assert.equal(ys.length,4);assert.equal(grid.center.x,xs[2]);assert.equal(grid.center.y,ys[1]);
  near(grid.center.w,2*grid.cards[0].w+(xs[1]-xs[0]-grid.cards[0].w));
  assert.ok(grid.center.h>=300);assert.ok(grid.cards.every(card=>card.angle===0));
});

test('medium grid has four columns and six rows with central space reserved and scrolling height',()=>{
  const layout=getWelcomeLayouts({width:800,height:600,count:20});
  const xs=[...new Set(layout.grid.cards.map(card=>card.x))].sort((a,b)=>a-b),ys=[...new Set(layout.grid.cards.map(card=>card.y))].sort((a,b)=>a-b);
  assert.equal(xs.length,4);assert.equal(ys.length,6);assert.equal(layout.grid.center.x,xs[1]);assert.equal(layout.grid.center.y,ys[1]);
  assert.ok(layout.height>600);assert.ok(layout.grid.center.h>=300);
});

test('phone grid keeps the central card after the first row and all twenty cards in document height',()=>{
  for(const width of [240,320,390,600]){
    const layout=getWelcomeLayouts({width,height:660,count:20}),{grid,scatter}=layout;
    assert.equal(new Set(grid.cards.map(card=>card.x)).size,2);
    for(const endpoint of [grid,scatter]){
      assert.ok(box(endpoint.cards[0]).bottom<box(endpoint.center).top);
      assert.ok(box(endpoint.cards[1]).bottom<box(endpoint.center).top);
      assert.ok(box(endpoint.cards[2]).top>box(endpoint.center).bottom);
      assert.ok(box(endpoint.cards[19]).bottom<=layout.height);
    }
    assert.ok(layout.height>1500);
  }
});

test('scattered cards materially differ in size, height and tilt instead of only nudging the grid',()=>{
  for(const width of [390,800,1280]){
    const layout=getWelcomeLayouts({width,height:660,count:20});
    assert.ok(new Set(layout.scatter.cards.map(card=>card.w.toFixed(2))).size>=4);
    assert.ok(new Set(layout.scatter.cards.map(card=>card.h.toFixed(2))).size>=4);
    assert.ok(new Set(layout.scatter.cards.map(card=>card.angle)).size>=4);
    assert.ok(layout.scatter.cards.filter((card,index)=>Math.hypot(card.x-layout.grid.cards[index].x,card.y-layout.grid.cards[index].y)>30).length>=8);
  }
});

test('both endpoints remain in stage bounds and protect the central card including rotated outlines',()=>{
  for(const width of [240,320,390,600,601,800,1099,1100,1280,1800])for(const centerHeight of [300,420]){
    const layouts=getWelcomeLayouts({width,height:660,count:20,centerHeight});
    for(const layout of [layouts.scatter,layouts.grid]){
      for(const item of [...layout.cards,layout.center])for(const point of corners(item)){
        assert.ok(point.x>=-.001&&point.x<=width+.001,`${width}: horizontal clip ${JSON.stringify(item)}`);
        assert.ok(point.y>=-.001&&point.y<=layouts.height+.001,`${width}: vertical clip ${JSON.stringify(item)}`);
      }
      const reserved=box(layout.center);
      assert.ok(layout.cards.every(card=>apart(box(card),reserved)),`${width}: center intersects a card`);
    }
  }
});

test('card centers and title centers stay directly reachable at endpoints and intermediate mixes',()=>{
  for(const width of [320,390,800,1280]){
    const layouts=getWelcomeLayouts({width,height:660,count:20});
    for(const t of [0,.25,.5,.75,1]){
      const layout=interpolateWelcomeLayout(layouts,t),items=[...layout.cards,layout.center];
      for(let index=0;index<items.length;index++){
        const item=items[index],point=center(item),angle=item.angle*Math.PI/180;
        const title={x:point.x+Math.sin(angle)*item.h*.27,y:point.y-Math.cos(angle)*item.h*.27};
        for(let other=0;other<items.length;other++)if(index!==other){
          assert.equal(inside(point,items[other]),false,`${width} mix ${t}: card ${index} center covered by ${other}`);
          assert.equal(inside(title,items[other]),false,`${width} mix ${t}: card ${index} title covered by ${other}`);
        }
      }
    }
  }
});

test('invalid dimensions and counts reject without silently creating phantom cards',()=>{
  for(const patch of [{width:0},{width:239},{width:NaN},{width:'1280'},{height:0},{height:Infinity},{count:-1},{count:21},{count:2.2},{centerHeight:NaN},{centerHeight:0}]){
    assert.throws(()=>getWelcomeLayouts({width:1280,height:660,count:20,...patch}),RangeError);
  }
  assert.throws(()=>getWelcomeLayouts(),RangeError);
});

test('mix clamps finite out-of-range values and rejects malformed endpoint geometry',()=>{
  const layouts=getWelcomeLayouts({width:800,height:660,count:20});
  assert.deepEqual(interpolateWelcomeLayout(layouts,-9),interpolateWelcomeLayout(layouts,0));
  assert.deepEqual(interpolateWelcomeLayout(layouts,9),interpolateWelcomeLayout(layouts,1));
  for(const t of [NaN,Infinity,'0.5',null])assert.throws(()=>interpolateWelcomeLayout(layouts,t),TypeError);
  assert.throws(()=>interpolateWelcomeLayout(null,.5),TypeError);
  const mismatch=structuredClone(layouts);mismatch.grid.cards.pop();assert.throws(()=>interpolateWelcomeLayout(mismatch,.5),TypeError);
  const malformed=structuredClone(layouts);malformed.scatter.center.x=NaN;assert.throws(()=>interpolateWelcomeLayout(malformed,.5),TypeError);
});
