import test from 'node:test';
import assert from 'node:assert/strict';
import {createDreamMotion} from '../src/dream-motion.js';

const seeded=seed=>()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const xy=frame=>frame.transform.match(/^translate\(([-\d.e+]+)px, ([-\d.e+]+)px\)$/).slice(1).map(Number);
const separate=(a,b)=>a.x+a.w+12<=b.x+1e-8||b.x+b.w+12<=a.x+1e-8||
  a.y+a.h+12<=b.y+1e-8||b.y+b.h+12<=a.y+1e-8;
function verify(plan,position,width,height,occupied=[]){
  assert.ok(plan);
  assert.ok(plan.duration>=18000&&plan.duration<=28000);
  assert.deepEqual(plan.keyframes.map(frame=>frame.offset),[0,.25,.5,.75,1]);
  assert.deepEqual(xy(plan.keyframes[0]),[0,0]);
  assert.ok(plan.area.x>=22-1e-8&&plan.area.x+plan.area.w<=width-22+1e-8);
  assert.ok(plan.area.y>=22-1e-8&&plan.area.y+plan.area.h<=height-75+1e-8);
  for(const obstacle of occupied)assert.ok(separate(plan.area,obstacle),'reserved path crosses occupied area');
  for(let index=1;index<plan.keyframes.length;index++){
    const from=xy(plan.keyframes[index-1]),to=xy(plan.keyframes[index]);
    for(let step=0;step<=20;step++){
      const dx=from[0]+(to[0]-from[0])*step/20,dy=from[1]+(to[1]-from[1])*step/20;
      assert.ok(position.x+dx>=22-1e-8&&position.x+dx+position.w<=width-22+1e-8);
      assert.ok(position.y+dy>=22-1e-8&&position.y+dy+position.h<=height-75+1e-8);
      const rect={x:position.x+dx,y:position.y+dy,w:position.w,h:position.h};
      assert.ok(rect.x>=plan.area.x-1e-8&&rect.x+rect.w<=plan.area.x+plan.area.w+1e-8);
      assert.ok(rect.y>=plan.area.y-1e-8&&rect.y+rect.h<=plan.area.y+plan.area.h+1e-8);
      for(const obstacle of occupied)assert.ok(separate(rect,obstacle));
    }
  }
}

test('wide stages carry thoughts a visible distance instead of rocking in place',()=>{
  const position={x:440,y:190,w:250,h:150};
  for(let seed=0;seed<100;seed++){
    const plan=createDreamMotion({position,width:1200,height:600,random:seeded(seed)});
    verify(plan,position,1200,600);
    const [dx,dy]=xy(plan.keyframes.at(-1));
    assert.ok(Math.abs(dx)>=140&&Math.abs(dx)<=250);
    assert.ok(Math.abs(dx)>Math.abs(dy));
    for(let i=1;i<plan.keyframes.length;i++)assert.equal(Math.sign(xy(plan.keyframes[i])[0]),Math.sign(dx));
  }
});

test('narrow stages flow along available height without crossing the stage or footer',()=>{
  const position={x:28,y:35,w:260,h:152};
  const plan=createDreamMotion({position,width:320,height:560,random:()=>.25});
  verify(plan,position,320,560);
  const [dx,dy]=xy(plan.keyframes.at(-1));
  assert.ok(dy>=140&&Math.abs(dx)<Math.abs(dy));
});

test('a randomly chosen cramped side gives way to the longer available current',()=>{
  const position={x:120,y:140,w:250,h:150};
  const plan=createDreamMotion({position,width:1000,height:600,random:()=>0});
  verify(plan,position,1000,600);
  assert.equal(xy(plan.keyframes.at(-1))[0],140);
});

test('edge and corner starts move inward, including adversarial random draws',()=>{
  for(const randomValue of [0,1,-10,10,NaN,Infinity]){
    for(const x of [22,364,706])for(const y of [22,215,409]){
      const position={x,y,w:272,h:116};
      const plan=createDreamMotion({position,width:1000,height:600,random:()=>randomValue});
      verify(plan,position,1000,600);
      assert.ok(Math.hypot(...xy(plan.keyframes.at(-1)))>=140);
    }
  }
});

test('continuous interpolated paths stay bounded across wide and tiny valid spaces',()=>{
  for(const width of [244,260,320,390,600,1400])for(const height of [197,220,360,600])for(let seed=0;seed<20;seed++){
    const random=seeded(seed),w=200,h=100;
    const position={x:22+random()*(width-44-w),y:22+random()*(height-97-h),w,h};
    verify(createDreamMotion({position,width,height,random}),position,width,height);
  }
});

test('exact-fit stages remain finite and start without a visual jump',()=>{
  const position={x:22,y:22,w:200,h:100};
  const plan=createDreamMotion({position,width:244,height:197,random:()=>1});
  verify(plan,position,244,197);
  for(const frame of plan.keyframes)assert.equal(frame.transform,'translate(0px, 0px)');
});

test('invalid or already clipped positions are rejected instead of hiding a jump',()=>{
  for(const position of [null,{x:21,y:22,w:200,h:100},{x:22,y:21,w:200,h:100},
    {x:22,y:22,w:0,h:100},{x:NaN,y:22,w:200,h:100},{x:100,y:22,w:250,h:100},
    {x:22,y:350,w:200,h:100}])assert.equal(createDreamMotion({position,width:320,height:500}),null);
  assert.equal(createDreamMotion(),null);
  assert.equal(createDreamMotion({position:{x:22,y:22,w:200,h:100},width:Infinity,height:500}),null);
});

test('motion plans are deterministic for a seed, vary by direction, and never change positions',()=>{
  const position=Object.freeze({x:440,y:190,w:250,h:150});
  const a=createDreamMotion({position,width:1200,height:600,random:()=>.1});
  const b=createDreamMotion({position,width:1200,height:600,random:()=>.9});
  assert.ok(xy(a.keyframes.at(-1))[0]<0);
  assert.ok(xy(b.keyframes.at(-1))[0]>0);
  assert.notDeepEqual(a,b);
  assert.deepEqual(createDreamMotion({position,width:1200,height:600,random:seeded(7)}),
    createDreamMotion({position,width:1200,height:600,random:seeded(7)}));
  assert.deepEqual(position,{x:440,y:190,w:250,h:150});
});

test('a current that would cross another text region finds a safe direction',()=>{
  const position={x:22,y:140,w:200,h:100},occupied=[{x:250,y:120,w:200,h:160}];
  const plan=createDreamMotion({position,width:900,height:600,occupied,random:()=>0});
  verify(plan,position,900,600,occupied);
  assert.ok(Math.hypot(...xy(plan.keyframes.at(-1)))>=80);
});

test('later clouds reserve against whole previous paths rather than just starting positions',()=>{
  const firstPosition={x:22,y:200,w:200,h:100};
  const first=createDreamMotion({position:firstPosition,width:1100,height:600,random:()=>1});
  const position={x:560,y:200,w:200,h:100},occupied=[first.area];
  const second=createDreamMotion({position,width:1100,height:600,occupied,random:()=>0});
  verify(first,firstPosition,1100,600);
  verify(second,position,1100,600,occupied);
  assert.ok(xy(second.keyframes.at(-1))[0]>0,'opposing paths must not meet over their lifetimes');
});

test('short paths and stationary exact-clearance pockets remain bounded and readable',()=>{
  for(const gap of [12,20,40]){
    const position={x:120,y:120,w:200,h:100};
    const occupied=[{x:22,y:22,w:98-gap,h:300},{x:320+gap,y:22,w:200,h:300},
      {x:120,y:22,w:200,h:98-gap},{x:120,y:220+gap,w:200,h:200}];
    const plan=createDreamMotion({position,width:800,height:600,occupied,random:()=>.5});
    verify(plan,position,800,600,occupied);
    if(gap===12)for(const frame of plan.keyframes)assert.deepEqual(xy(frame),[0,0]);
    else assert.ok(Math.hypot(...xy(plan.keyframes.at(-1)))<=gap-12+1e-8);
  }
});

test('already unsafe starts return null and invalid occupied entries cannot corrupt a plan',()=>{
  const position=Object.freeze({x:22,y:22,w:200,h:100});
  assert.equal(createDreamMotion({position,width:800,height:600,occupied:[{x:225,y:22,w:200,h:100}]}),null);
  const occupied=Object.freeze([null,Object.freeze({x:NaN,y:22,w:200,h:100}),
    Object.freeze({x:250,y:22,w:-1,h:100}),Object.freeze({x:600,y:400,w:100,h:100})]);
  const plan=createDreamMotion({position,width:800,height:600,occupied,random:()=>.25});
  verify(plan,position,800,600,[occupied[3]]);
  assert.deepEqual(position,{x:22,y:22,w:200,h:100});
  assert.equal(occupied.length,4);
});
