import test from 'node:test';
import assert from 'node:assert/strict';
import {createDreamEmitter,createDreamPlayback} from '../src/dream-flow.js';

const idea=id=>({id,text:`记下的念头 ${id}`,archived:false});
const ids=items=>items.map(item=>item.id);
function seededRandom(seed){return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}

test('emitter samples the complete pool, including old records beyond any visible page',()=>{
  const items=Array.from({length:503},(_,i)=>idea(`capture-${i}`));
  const emitter=createDreamEmitter(items,{random:seededRandom(19)});
  assert.equal(emitter.size,503);
  assert.equal(emitter.pick(ids(items.slice(0,-1))),items.at(-1));
  assert.equal(emitter.pick(ids(items.slice(1))),items[0]);
  const sampled=new Set();for(let i=0;i<10000;i++)sampled.add(emitter.pick().id);
  assert.equal(sampled.size,503,'this deterministic sample reaches the full pool, not a fixed first page');
});

test('independent random emergence is not a fixed deck or a requirement to finish one full round',()=>{
  const items=Array.from({length:30},(_,i)=>idea(String(i)));
  const emitter=createDreamEmitter(items,{random:seededRandom(19)});
  const sampled=Array.from({length:30},()=>emitter.pick().id);
  assert.ok(new Set(sampled).size<30,'a cooled-down idea can return before every record has appeared');
  const other=createDreamEmitter(items,{random:seededRandom(20)});
  assert.notDeepEqual(sampled,Array.from({length:30},()=>other.pick().id));
});

test('visible IDs stay excluded and the last eight emitted ideas cool down while alternatives exist',()=>{
  const items=Array.from({length:24},(_,i)=>idea(String(i)));
  const visible=['0','1','2'],emitter=createDreamEmitter(items,{random:seededRandom(27)}),recent=[];
  for(let i=0;i<200;i++){
    const item=emitter.pick(visible);assert.ok(!visible.includes(item.id));assert.ok(!recent.includes(item.id));
    recent.push(item.id);if(recent.length>8)recent.shift();
  }
});

test('small pools relax the oldest cooldowns while never reusing a visible idea',()=>{
  const items=[idea('a'),idea('b'),idea('c')],emitter=createDreamEmitter(items,{random:()=>0});
  assert.deepEqual(Array.from({length:7},()=>emitter.pick().id),['a','b','c','a','b','c','a']);
  for(let i=0;i<5;i++)assert.equal(emitter.pick(['a','b']),items[2]);
  assert.equal(emitter.pick(['a','b','c']),null);
  assert.equal(emitter.pick(new Set(['a','c'])),items[1]);
});

test('invalid, archived and duplicate entries never enter the emitter',()=>{
  const first=idea('same'),items=[null,{},idea(''),idea('  '),{id:0},
    {...idea('archived'),archived:true},{...idea('revived'),archived:true},
    first,{...idea('same'),text:'duplicate'},idea('revived'),idea('last')];
  const emitter=createDreamEmitter(items,{random:()=>.5}),sampled=[];
  assert.equal(emitter.size,3);for(let i=0;i<3;i++)sampled.push(emitter.pick(ids(sampled)));
  assert.deepEqual(ids(sampled).sort(),['last','revived','same']);assert.equal(sampled.find(item=>item.id==='same'),first);
});

test('empty and single-record emitters are stable and filters can rebuild an independent pool',()=>{
  for(const input of [undefined,null,{},[],[{...idea('old'),archived:true}]]){
    const emitter=createDreamEmitter(input);assert.equal(emitter.size,0);assert.equal(emitter.pick(),null);
  }
  const only=idea('only'),single=createDreamEmitter([only]);
  for(let i=0;i<5;i++){assert.equal(single.pick(),only);assert.equal(single.pick(['only']),null);}
  const items=freeze(Array.from({length:17},(_,i)=>({...idea(String(i)),tags:i%2?'工作':'创作'})));
  const before=structuredClone(items),visible=freeze(['0','2']),emitter=createDreamEmitter(items,{random:seededRandom(18)});
  for(let i=0;i<60;i++)assert.ok(items.includes(emitter.pick(visible)));
  const matching=items.filter(item=>item.tags==='创作'),filtered=createDreamEmitter(matching,{random:seededRandom(20)});
  const seen=[];for(let i=0;i<matching.length;i++)seen.push(filtered.pick(ids(seen)));
  assert.deepEqual(ids(seen).sort(),ids(matching).sort());assert.deepEqual(items,before);assert.deepEqual(visible,['0','2']);
});

test('invalid random samples are bounded and cannot return outside the eligible pool',()=>{
  for(const value of [1,-1,NaN,Infinity]){
    const emitter=createDreamEmitter([idea('a'),idea('b'),idea('c')],{random:()=>value});
    for(let i=0;i<20;i++)assert.ok(['a','b'].includes(emitter.pick(['c']).id));
  }
});
function clock(){
  let time=0,sequence=0;const jobs=new Map();
  return {
    setTimer(callback,delay){const id=++sequence;jobs.set(id,{at:time+delay,callback});return id;},
    clearTimer(id){jobs.delete(id);},
    advance(duration){
      const target=time+duration;
      for(;;){
        const next=[...jobs].filter(([,job])=>job.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];
        if(!next)break;
        const [id,job]=next;time=job.at;jobs.delete(id);job.callback();
      }
      time=target;
    },
    pending(){return jobs.size;},
  };
}

test('playback starts paused, advances on a full reading interval, and repeated resume calls preserve it',()=>{
  const time=clock();let advances=0;
  const playback=createDreamPlayback({...time,delay:12000,advance:()=>advances++});
  time.advance(60000);assert.equal(advances,0);assert.equal(time.pending(),0);
  playback.setPaused(false);assert.equal(time.pending(),1);
  time.advance(8000);playback.setPaused(false);assert.equal(time.pending(),1);
  time.advance(3999);assert.equal(advances,0);
  time.advance(1);assert.equal(advances,1);assert.equal(time.pending(),1);
  time.advance(12000);assert.equal(advances,2);assert.equal(time.pending(),1);
  playback.destroy();assert.equal(time.pending(),0);
});

test('pause removes pending work and resume gives the reader a complete new interval without catching up',()=>{
  const time=clock();let advances=0;
  const playback=createDreamPlayback({...time,delay:12000,advance:()=>advances++});
  playback.setPaused(false);time.advance(11000);playback.setPaused(true);playback.setPaused(true);
  assert.equal(time.pending(),0);time.advance(600000);assert.equal(advances,0);
  playback.setPaused(false);time.advance(11999);assert.equal(advances,0);
  time.advance(1);assert.equal(advances,1);assert.equal(time.pending(),1);playback.destroy();
});

test('manual navigation resets the reading interval but cannot resume a paused or destroyed dream',()=>{
  const time=clock();let advances=0;
  const playback=createDreamPlayback({...time,delay:12000,advance:()=>advances++});
  playback.reset();assert.equal(time.pending(),0);
  playback.setPaused(false);time.advance(10000);playback.reset();assert.equal(time.pending(),1);
  time.advance(11999);assert.equal(advances,0);time.advance(1);assert.equal(advances,1);
  playback.setPaused(true);playback.reset();assert.equal(time.pending(),0);
  playback.destroy();playback.setPaused(false);playback.reset();time.advance(60000);
  assert.equal(advances,1);assert.equal(time.pending(),0);
});

test('a pause or destroy during an advance cannot schedule orphaned continuation work',()=>{
  for(const action of ['pause','destroy']){
    const time=clock();let advances=0,playback;
    playback=createDreamPlayback({...time,delay:100,advance:()=>{
      advances++;if(action==='pause')playback.setPaused(true);else playback.destroy();
    }});
    playback.setPaused(false);time.advance(5000);
    assert.equal(advances,1);assert.equal(time.pending(),0);
    playback.destroy();assert.equal(time.pending(),0);
  }
});

test('advance handlers may reset or briefly pause and resume while retaining exactly one timer',()=>{
  for(const action of ['reset','pause-resume']){
    const time=clock();let advances=0,playback;
    playback=createDreamPlayback({...time,delay:100,advance:()=>{
      advances++;
      if(action==='reset')playback.reset();
      else {playback.setPaused(true);playback.setPaused(false);}
    }});
    playback.setPaused(false);time.advance(350);
    assert.equal(advances,3);assert.equal(time.pending(),1);
    playback.destroy();playback.destroy();time.advance(5000);
    assert.equal(advances,3);assert.equal(time.pending(),0);
  }
});

test('a delay function is sampled anew for each emergence, pause resume and manual reset',()=>{
  const time=clock(),delays=[3000,6000,4000,5000];let advances=0,samples=0;
  const playback=createDreamPlayback({...time,delay:()=>delays[samples++]||3000,advance:()=>advances++});
  assert.equal(samples,0);playback.setPaused(false);assert.equal(samples,1);
  time.advance(2999);assert.equal(advances,0);time.advance(1);assert.equal(advances,1);assert.equal(samples,2);
  time.advance(5999);assert.equal(advances,1);time.advance(1);assert.equal(advances,2);assert.equal(samples,3);
  playback.setPaused(true);time.advance(60000);assert.equal(advances,2);assert.equal(samples,3);
  playback.setPaused(false);assert.equal(samples,4);time.advance(4999);assert.equal(advances,2);
  playback.reset();assert.equal(samples,5);time.advance(3000);assert.equal(advances,3);playback.destroy();
});
