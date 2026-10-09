import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {CUSTOM_BLOCK_PRESETS,createPresetInput} from '../src/custom-block-presets.js';

test('scene presets are independent editable starters and do not create fictitious completed records',()=>{
  assert.equal(new Set(CUSTOM_BLOCK_PRESETS.map(item=>item.id)).size,CUSTOM_BLOCK_PRESETS.length);
  for(const preset of CUSTOM_BLOCK_PRESETS){
    const input=createPresetInput(preset.id),copy=createPresetInput(preset.id);
    assert.equal(input.kind,preset.kind);assert.deepEqual(input.data,{});
    if(input.kind==='table')assert.deepEqual(input.config.rows,[]);
    if(input.kind==='checklist')assert.deepEqual(input.config.items,[]);
    input.title='Changed';input.config.extra='changed';assert.notDeepEqual(input,copy);
    assert.equal(CUSTOM_BLOCK_PRESETS.find(item=>item.id===preset.id).config.extra,undefined);
  }
  assert.throws(()=>createPresetInput('unregistered'));
});

test('countdown proposes an editable date seven local days later across month boundaries',()=>{
  assert.equal(createPresetInput('countdown',new Date(2026,9,29,12)).config.date,'2026-11-05');
});

function runPreset(id,data={}){
  let rendered,saved,interval;
  const app={getData:()=>structuredClone(data),render:nodes=>{rendered=nodes;},setData:async next=>{saved=JSON.parse(JSON.stringify(next));}};
  // This VM only exercises trusted source-controlled examples; generated code uses the separate Worker runtime.
  vm.runInNewContext(createPresetInput(id).config.code,{app,Date,setInterval:callback=>{interval=callback;}},{timeout:100});
  return {app,rendered:()=>rendered,saved:()=>saved,tick:()=>interval?.()};
}

test('calculator example computes finite results and renders zero rather than an empty-state label',async()=>{
  const fixture=runPreset('calculator');
  await fixture.app.onEvent({id:'calculate',type:'click',values:{a:'3',b:'3',op:'subtract'}});
  assert.equal(fixture.saved().result,0);assert.equal(fixture.rendered().find(node=>node.type==='metric').value,'0');
  await fixture.app.onEvent({id:'calculate',type:'click',values:{a:'3',b:'0',op:'divide'}});
  assert.equal(fixture.saved().result,'不能除以零');
});

test('focus timer example persists only user changes and never fabricates a finished task',async()=>{
  const fixture=runPreset('focus-timer');assert.equal(fixture.saved(),undefined);
  await fixture.app.onEvent({id:'reset',type:'click',values:{minutes:'12'}});
  assert.deepEqual(fixture.saved(),{minutes:12,remaining:720,endAt:0});
  await fixture.app.onEvent({id:'start',type:'click',values:{minutes:'12'}});
  assert.ok(fixture.saved().endAt>Date.now());
  await fixture.app.onEvent({id:'pause',type:'click',values:{minutes:'12'}});
  assert.equal(fixture.saved().endAt,0);assert.ok(fixture.saved().remaining<=720);
  assert.deepEqual(Object.keys(fixture.saved()).sort(),['endAt','minutes','remaining']);
});
