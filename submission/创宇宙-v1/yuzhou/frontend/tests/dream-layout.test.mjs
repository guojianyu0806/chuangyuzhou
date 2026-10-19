import test from 'node:test';
import assert from 'node:assert/strict';
import {placeDreamThought} from '../src/dream-layout.js';

const seeded=seed=>()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const separate=(a,b)=>a.x+a.w+12<=b.x||b.x+b.w+12<=a.x||a.y+a.h+12<=b.y||b.y+b.h+12<=a.y;
function inside(rect,width,height){
  assert.ok(rect.x>=22&&rect.y>=22);
  assert.ok(rect.x+rect.w<=width-22+1e-8);
  assert.ok(rect.y+rect.h<=height-75+1e-8);
  assert.ok(rect.w>=200&&rect.w<=Math.min(width-48,width<600?260:310));
  assert.ok(Math.abs(rect.h/rect.w-176/300)<1e-10);
}

test('random bursts remain inside every supported size without overlapping existing clouds',()=>{
  for(const width of [280,320,390,480,600,800,1000,1400])for(const height of [400,500,600,700])for(let seed=0;seed<8;seed++){
    const occupied=[],random=seeded(seed);
    for(let i=0;i<7;i++){
      const placed=placeDreamThought({width,height,occupied,random});
      if(!placed)break;
      inside(placed,width,height);
      for(const previous of occupied)assert.ok(separate(placed,previous),`${width}x${height} collision`);
      occupied.push(placed);
    }
    assert.ok(occupied.length>=1);
  }
});

test('fallback fills available space even if random repeatedly selects the same occupied corner',()=>{
  const first=placeDreamThought({width:1000,height:600,random:()=>0});
  const second=placeDreamThought({width:1000,height:600,occupied:[first],random:()=>0});
  assert.ok(first&&second);assert.ok(separate(first,second));
  inside(second,1000,600);
});

test('narrow views admit fewer clouds instead of overlaps or clipping',()=>{
  const occupied=[];
  for(let i=0;i<5;i++){
    const next=placeDreamThought({width:280,height:400,occupied,random:()=>0});
    if(!next)break;
    occupied.push(next);
  }
  assert.equal(occupied.length,2);
  assert.equal(placeDreamThought({width:280,height:400,occupied}),null);
});

test('full and too-small stages return null with finite work',()=>{
  assert.equal(placeDreamThought({width:1000,height:600,occupied:[{x:0,y:0,w:1000,h:600}]}),null);
  for(const [width,height] of [[247,600],[280,200],[0,600],[-1,400],[Infinity,500],[500,NaN]]){
    assert.equal(placeDreamThought({width,height}),null);
  }
});

test('placement does not mutate frozen input and malformed rectangles are ignored',()=>{
  const rect=Object.freeze({x:22,y:22,w:240,h:140});
  const occupied=Object.freeze([rect,null,Object.freeze({x:0,y:0,w:-100,h:100}),Object.freeze({x:NaN,y:0,w:100,h:100})]);
  const result=placeDreamThought(Object.freeze({width:1000,height:600,occupied,random:()=>.7}));
  assert.ok(result);assert.ok(separate(result,rect));
  assert.deepEqual(rect,{x:22,y:22,w:240,h:140});
});

test('different random draws produce different positions and malformed random values remain bounded',()=>{
  const a=placeDreamThought({width:1000,height:600,random:()=>.2});
  const b=placeDreamThought({width:1000,height:600,random:()=>.8});
  assert.notDeepEqual(a,b);
  for(const value of [NaN,Infinity,-100,100])inside(placeDreamThought({width:1000,height:600,random:()=>value}),1000,600);
});
